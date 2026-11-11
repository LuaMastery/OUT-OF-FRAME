import * as THREE from 'three';
import {
  CELL_SIZE,
  worldToGridCell,
} from '../doom/DoomMazeBuilder';
import { isWalkableArenaCell } from '../doom/DoomRooms';

export type VoiceActivationMode = 'PTT' | 'OPEN' | 'MUTED';

export type MicPermissionState = 'idle' | 'requesting' | 'granted' | 'denied' | 'unavailable';

/** Distância máxima (em metros) em que a voz de um amigo ainda pode ser ouvida (~6,5 células do labirinto). */
export const MAX_PROXIMITY_VOICE_DISTANCE = 22.0;

/** Raio próximo (em metros) onde a voz soa em volume pleno sem atenuação de distância. */
export const FULL_VOLUME_VOICE_DISTANCE = 2.8;

/** Limiar base de abertura do gate de voz em modo Microfone Aberto (ignora chiado leve de fundo). */
export const VOICE_NOISE_GATE_THRESHOLD = 0.032;

/** Tempo de sustentação vocal (hangover) em segundos para NUNCA cortar sílabas ou pausas de respiração! */
export const VOICE_GATE_HOLD_OPEN_SEC = 0.38;
export const VOICE_GATE_HOLD_PTT_SEC = 0.56;

/** Taxa de amostragem e duração (~108 ms = ~9,2 pacotes/s) do codec retrô 8-bit μ-law sem inundar a rede. */
const RETRO_RELAY_SAMPLE_RATE = 8_512;
const RETRO_RELAY_CHUNK_SAMPLES = 920; // ~108.1 ms por pacote (evita rate-limit e cortes no WebSocket!)
const INITIAL_JITTER_BUFFER_SEC = 0.095;
const MAX_JITTER_LEAD_SEC = 0.48;

export interface VoiceSignalPayload {
  fromId: string;
  toId: string;
  kind: 'offer' | 'answer' | 'ice';
  sdp?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
}

export interface VoiceRelayChunkPayload {
  fromId: string;
  seq: number;
  sampleRate: number;
  muLawB64: string;
}

export interface ProximityVoiceAcoustics {
  gain: number;
  lowpassHz: number;
  audible: boolean;
  viaRadio?: boolean;
}

export type RadioVoiceLinkMode = 'none' | 'simplex' | 'duplex';

export interface SpiderVoiceAlertResult {
  heard: boolean;
  effectiveRadius: number;
  intensity: number;
}

export interface VoiceGateState {
  smoothedLevel: number;
  gateOpen: boolean;
  holdRemainingSec: number;
}

const RTC_ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
];

/**
 * Cria o estado inicial do Gate Vocal com histerese (Schmitt Trigger) + tempo de sustentação (Hangover).
 */
export function createInitialVoiceGateState(): VoiceGateState {
  return {
    smoothedLevel: 0,
    gateOpen: false,
    holdRemainingSec: 0,
  };
}

/**
 * Avança o Gate Vocal de forma pura e à prova de cortes bruscos no meio das palavras:
 * - Ataque rápido (`22/s`) para nunca comer o início da primeira sílaba;
 * - Histerese dupla (limiar de fechamento é 45% menor que o de abertura);
 * - Sustentação vocal (`holdRemainingSec`: 380ms em `OPEN`, 560ms em `PTT`) que mantém a voz
 *   contínua durante consoantes surdas, respirações curtas e transições entre palavras!
 */
export function stepVoiceGateState(
  state: VoiceGateState,
  rawLevel: number,
  dtSec: number,
  isMicArmed: boolean,
  isPttHeld: boolean
): VoiceGateState {
  const safeDt = Math.max(0, Math.min(0.25, Number.isFinite(dtSec) ? dtSec : 0));
  if (!isMicArmed) {
    const decayed = Math.max(0, state.smoothedLevel - safeDt * 12);
    return {
      smoothedLevel: decayed,
      gateOpen: false,
      holdRemainingSec: 0,
    };
  }

  const clampedRaw = Math.max(0, Math.min(1, Number.isFinite(rawLevel) ? rawLevel : 0));
  const rate = clampedRaw > state.smoothedLevel ? 22.0 : 9.5;
  const smoothedLevel =
    state.smoothedLevel + (clampedRaw - state.smoothedLevel) * Math.min(1, safeDt * rate);

  const openThreshold = isPttHeld
    ? VOICE_NOISE_GATE_THRESHOLD * 0.35
    : VOICE_NOISE_GATE_THRESHOLD;
  const closeThreshold = openThreshold * 0.45;
  const holdDuration = isPttHeld ? VOICE_GATE_HOLD_PTT_SEC : VOICE_GATE_HOLD_OPEN_SEC;

  let gateOpen = state.gateOpen;
  let holdRemainingSec = Math.max(0, state.holdRemainingSec - safeDt);

  if (!gateOpen) {
    if (smoothedLevel >= openThreshold) {
      gateOpen = true;
      holdRemainingSec = holdDuration;
    }
  } else {
    if (smoothedLevel >= closeThreshold) {
      holdRemainingSec = holdDuration;
    } else if (holdRemainingSec <= 0) {
      gateOpen = false;
    }
  }

  return {
    smoothedLevel,
    gateOpen,
    holdRemainingSec,
  };
}

/**
 * Desduplicador O(1) de pacotes de áudio por `seq` para impedir 100% que entregas duplas
 * (`BroadcastChannel` + `Supabase Realtime` ou retransmissões de rede) dupliquem a voz!
 */
export class RelaySeqDeduplicator {
  private readonly seenSeqs = new Set<number>();
  private readonly orderQueue: number[] = [];
  private highestSeq = -1;

  constructor(private readonly windowSize = 128) {}

  accept(seq: number): boolean {
    if (!Number.isFinite(seq) || seq < 0) return false;
    const cleanSeq = Math.floor(seq);

    if (this.seenSeqs.has(cleanSeq)) {
      return false;
    }

    // Se o remetente reiniciou a sessão (ex.: reconectou do zero com seq baixo), reseta janela
    if (this.highestSeq > 200 && cleanSeq <= 8) {
      this.reset();
    } else if (this.highestSeq >= 0 && cleanSeq < this.highestSeq - 24) {
      // Descarta pacote extremamente atrasado que causaria eco/repetição fora de hora
      return false;
    }

    if (cleanSeq > this.highestSeq) {
      this.highestSeq = cleanSeq;
    }

    this.seenSeqs.add(cleanSeq);
    this.orderQueue.push(cleanSeq);
    while (this.orderQueue.length > this.windowSize) {
      const oldest = this.orderQueue.shift();
      if (oldest !== undefined) {
        this.seenSeqs.delete(oldest);
      }
    }
    return true;
  }

  reset(): void {
    this.seenSeqs.clear();
    this.orderQueue.length = 0;
    this.highestSeq = -1;
  }
}

/**
 * Gera a curva de transferência do processador **Retro 8-Bit EVA Comm** (`WaveShaperNode`):
 * - Zona morta limpa no zero (`|x| < deadzone`) para **zero chiado** quando o aliado está em silêncio;
 * - Companding logarítmico suave + degraus de quantização 8-bit calibrados para preservar 100% da
 *   inteligibilidade das palavras enquanto entrega a textura crocante clássica dos rádios retrô!
 */
export function buildRetro8BitQuantizerCurve(
  steps = 56,
  drive = 1.18,
  samples = 2048
): Float32Array<ArrayBuffer> {
  const n = Math.max(256, samples | 0);
  const cleanSteps = Math.max(12, Math.min(256, steps));
  const curve = new Float32Array(new ArrayBuffer(n * 4));
  const deadzone = 0.0035;
  const mu = 24.0;
  const invLogMu = 1 / Math.log(1 + mu);

  for (let i = 0; i < n; i++) {
    const x = (i * 2) / (n - 1) - 1;
    const absX = Math.abs(x);
    if (absX <= deadzone) {
      curve[i] = 0;
      continue;
    }

    const sign = x < 0 ? -1 : 1;
    const norm = Math.min(1, ((absX - deadzone) / (1 - deadzone)) * drive);
    // Compressão logarítmica antes da quantização (mantém sussurros nítidos sem virar onda quadrada!)
    const companded = Math.log(1 + mu * norm) * invLogMu;
    const quantized = Math.round(companded * cleanSteps) / cleanSteps;
    // Expansão suave + mescla sutil (78% quantizado 8-bit + 22% fundamental limpa para clareza vocal)
    const expanded = (Math.pow(1 + mu, quantized) - 1) / mu;
    const softLimited = Math.tanh(expanded * 1.12) / Math.tanh(1.12);
    curve[i] = sign * (softLimited * 0.78 + norm * 0.22) * 0.94;
  }
  return curve;
}

/**
 * Downsampling com filtro anti-aliasing por média de janela (Boxcar) + leve pré-ênfase vocal
 * para que a voz 8-bit em ~8.5 kHz soe limpa, encorpada e sem chiado metálico de aliasing!
 */
export function downsamplePcmWithAntiAlias(
  input: Float32Array,
  srcRate: number,
  targetRate: number
): Float32Array {
  if (input.length === 0) return new Float32Array(0);
  const safeSrc = Math.max(targetRate, Number.isFinite(srcRate) ? srcRate : 48_000);
  const ratio = safeSrc / targetRate;
  if (ratio <= 1.01) {
    return new Float32Array(input);
  }

  const outLen = Math.max(1, Math.floor(input.length / ratio));
  const out = new Float32Array(outLen);
  let prevSample = input[0];

  for (let i = 0; i < outLen; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(input.length, Math.max(start + 1, Math.floor((i + 1) * ratio)));
    let sum = 0;
    for (let j = start; j < end; j++) {
      sum += input[j];
    }
    const avg = sum / (end - start);
    // Leve realce de consoantes (+0.22 high-shelf) + soft clip protetor [-0.98..0.98]
    const preEmph = avg + (avg - prevSample) * 0.22;
    prevSample = avg;
    out[i] = Math.max(-0.98, Math.min(0.98, preEmph));
  }
  return out;
}

/**
 * Aplica micro-envelope cosseno (3ms) nas bordas de um bloco de áudio para eliminar 100%
 * qualquer estalo/clique caso ocorra variação de rede entre dois pacotes consecutivos.
 */
export function applyChunkMicroFade(
  samples: Float32Array,
  sampleRate: number,
  fadeSec = 0.003
): void {
  const fadeSamples = Math.min(
    Math.floor(samples.length * 0.25),
    Math.max(4, Math.floor(sampleRate * fadeSec))
  );
  for (let i = 0; i < fadeSamples; i++) {
    const gain = 0.5 - 0.5 * Math.cos((Math.PI * i) / fadeSamples);
    samples[i] *= gain;
    samples[samples.length - 1 - i] *= gain;
  }
}

/**
 * Conta quantas células sólidas de parede existem no segmento horizontal entre dois pontos do labirinto.
 * Ignora transições dentro da mesma parede contínua para medir o número real de barreiras físicas!
 */
export function countLabyrinthWallsBetween(
  ax: number,
  az: number,
  bx: number,
  bz: number
): number {
  const dx = bx - ax;
  const dz = bz - az;
  const dist = Math.hypot(dx, dz);
  if (dist < 0.25) return 0;

  const step = Math.min(0.45, CELL_SIZE * 0.14);
  const samples = Math.max(1, Math.ceil(dist / step));
  let wallBarriers = 0;
  let insideSolid = false;

  for (let i = 1; i < samples; i++) {
    const t = i / samples;
    const sx = ax + dx * t;
    const sz = az + dz * t;
    const cell = worldToGridCell(sx, sz);
    const solid = !isWalkableArenaCell(cell.gx, cell.gz);
    if (solid && !insideSolid) {
      wallBarriers++;
      insideSolid = true;
    } else if (!solid) {
      insideSolid = false;
    }
  }

  return wallBarriers;
}

/**
 * ============================================================================
 * ROTEAMENTO DO CANAL VHF (RÁDIO COMUNICADOR DE LONGA DISTÂNCIA)
 * ============================================================================
 * O canal de rádio é um enlace RECEPTOR-EMITENTE:
 * - `none`   : o ouvinte NÃO tem o rádio ligado -> a voz do aliado só chega
 *              pelo AR (distância + oclusão de paredes). É o que garante que
 *              DESLIGAR o rádio realmente cale a voz de rádio do esquadrão;
 * - `simplex` : o ouvinte tem o rádio ligado e o aliado não (escuta o canal
 *              como um monitor de frequência);
 * - `duplex`  : os dois têm o rádio ligado (conversa VHF de verdade).
 *
 * BUG CORRIGIDO: antes, bastava UM aliado ter o rádio ligado (`peerRadio`) para
 * que o canal fosse aberto para todos — inclusive para quem havia DESLIGADO o
 * seu rádio ou sequer possuía o item. O jogador continuava ouvindo a voz dos
 * outros "no rádio" indefinidamente, mesmo com o rádio desligado.
 */
export function computeRadioVoiceLinkMode(
  localRadioActive: boolean,
  peerRadioActive: boolean
): RadioVoiceLinkMode {
  if (!localRadioActive) return 'none';
  return peerRadioActive ? 'duplex' : 'simplex';
}

/**
 * Calcula de forma pura o ganho de volume por distância + abafamento acústico (filtro passa-baixa)
 * provocado pelas paredes de concreto/metal do labirinto entre dois jogadores!
 */
export function computeProximityVoiceAcousticParams(
  distanceMeters: number,
  wallCount: number,
  radioLinkMode: RadioVoiceLinkMode = 'none'
): ProximityVoiceAcoustics {
  let proxGain = 0;
  let proxLowpassHz = 400;

  if (
    Number.isFinite(distanceMeters) &&
    distanceMeters < MAX_PROXIMITY_VOICE_DISTANCE
  ) {
    const clampedDist = Math.max(0, distanceMeters);
    let distFactor = 1.0;
    if (clampedDist > FULL_VOLUME_VOICE_DISTANCE) {
      const u =
        (clampedDist - FULL_VOLUME_VOICE_DISTANCE) /
        (MAX_PROXIMITY_VOICE_DISTANCE - FULL_VOLUME_VOICE_DISTANCE);
      // Queda acústica natural suave: nítido perto, sumindo gradualmente pelo corredor até 22m
      const inv = Math.max(0, 1 - u);
      distFactor = inv * inv * (0.82 + 0.18 * inv);
    }

    const cleanWalls = Math.max(0, Math.floor(wallCount));
    let occlusionGain = 1.0;
    proxLowpassHz = 16_500;

    if (cleanWalls === 1) {
      occlusionGain = 0.56;
      proxLowpassHz = 1_900;
    } else if (cleanWalls === 2) {
      occlusionGain = 0.3;
      proxLowpassHz = 920;
    } else if (cleanWalls >= 3) {
      occlusionGain = 0.14;
      proxLowpassHz = 520;
    }

    // Absorção suave de agudos pelo ar em grandes distâncias no corredor
    if (cleanWalls === 0 && clampedDist > 8) {
      const airT = Math.min(1, (clampedDist - 8) / 14);
      proxLowpassHz = Math.round(16_500 - airT * 8_500);
    }

    const rawGain = distFactor * occlusionGain;
    proxGain = rawGain < 0.004 ? 0 : rawGain;
  }

  // Transmissão de longa distância pelo Rádio Comunicador VHF (atravessa todo o complexo e Salas Especiais!)
  if (radioLinkMode !== 'none') {
    const radioGain = radioLinkMode === 'duplex' ? 0.88 : 0.78;
    const radioLowpassHz = radioLinkMode === 'duplex' ? 2_950 : 2_600;
    if (proxGain < radioGain) {
      return {
        gain: radioGain,
        lowpassHz: radioLowpassHz,
        audible: true,
        viaRadio: true,
      };
    }
  }

  return {
    gain: proxGain,
    lowpassHz: proxLowpassHz,
    audible: proxGain >= 0.004,
    viaRadio: false,
  };
}

/**
 * Avalia se a Aranha Gigante escuta a voz do jogador no microfone (estilo Lethal Company / Phasmophobia):
 * - Silêncio / mudo (`voiceLevel < 0.08`): 0m (totalmente seguro).
 * - Sussurro baixo (`0.08 .. 0.30`): alcance curtíssimo (~2.6m, seguro exceto colado na Aranha).
 * - Fala normal (`0.30 .. 0.62`): eco moderado pelo corredor (~3.5m a 10.5m).
 * - Fala alta / grito (`>= 0.62`): eco forte até ~19m nos corredores, atraindo a Aranha imediatamente!
 */
export function computeSpiderVoiceHearingAlert(
  voiceLevel: number,
  distanceMeters: number,
  wallCount: number,
  crouching = false
): SpiderVoiceAlertResult {
  const lvl = Math.max(0, Math.min(1, Number.isFinite(voiceLevel) ? voiceLevel : 0));
  if (lvl < 0.08) {
    return { heard: false, effectiveRadius: 0, intensity: 0 };
  }

  let baseRadius: number;
  if (lvl < 0.3) {
    const t = (lvl - 0.08) / 0.22;
    baseRadius = 1.4 + t * 2.1; // 1.4m .. 3.5m (sussurro)
  } else if (lvl < 0.62) {
    const t = (lvl - 0.3) / 0.32;
    baseRadius = 3.5 + t * 7.5; // 3.5m .. 11.0m (conversa normal)
  } else {
    const t = (lvl - 0.62) / 0.38;
    baseRadius = 11.0 + t * 8.0; // 11.0m .. 19.0m (grito / voz alta!)
  }

  // Paredes grossas do labirinto amortecem parte do alcance sonoro até a Aranha
  const wallPenalty =
    wallCount <= 0
      ? 1.0
      : wallCount === 1
        ? 0.72
        : wallCount === 2
          ? 0.48
          : 0.28;
  const crouchFactor = crouching && lvl < 0.55 ? 0.85 : 1.0;
  const effectiveRadius = baseRadius * wallPenalty * crouchFactor;
  const heard = distanceMeters <= effectiveRadius;
  const intensity = heard
    ? Math.max(0.1, Math.min(1, lvl * (1 - (distanceMeters / Math.max(0.5, effectiveRadius)) * 0.45)))
    : 0;

  return {
    heard,
    effectiveRadius,
    intensity,
  };
}

// ============================================================================
// CODEC COMPACTO G.711 μ-LAW (8-BIT DIGITAL COMM) — Codificação logarítmica 8-bit
// ============================================================================

function linearSampleToMuLawByte(sample: number): number {
  const BIAS = 0x84;
  const CLIP = 32635;
  let s = Math.max(-1, Math.min(1, sample)) * 32767;
  let sign = 0;
  if (s < 0) {
    sign = 0x80;
    s = -s;
  }
  if (s > CLIP) s = CLIP;
  s = s + BIAS;

  let exponent = 7;
  for (let expMask = 0x4000; (s & expMask) === 0 && exponent > 0; exponent--, expMask >>= 1) {
    // Busca segmento logarítmico
  }
  const mantissa = (s >> (exponent + 3)) & 0x0f;
  return ~(sign | (exponent << 4) | mantissa) & 0xff;
}

function muLawByteToLinearSample(muLawByte: number): number {
  const u = ~muLawByte & 0xff;
  const sign = u & 0x80;
  const exponent = (u >> 4) & 0x07;
  const mantissa = u & 0x0f;
  let sample = ((mantissa << 3) + 0x84) << exponent;
  sample -= 0x84;
  return (sign ? -sample : sample) / 32768;
}

const BASE64_CHARS =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function encodePcmToMuLawBase64(samples: Float32Array): string {
  const bytes = new Uint8Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    bytes[i] = linearSampleToMuLawByte(samples[i]);
  }
  if (typeof btoa === 'function') {
    let bin = '';
    for (let i = 0; i < bytes.length; i++) {
      bin += String.fromCharCode(bytes[i]);
    }
    return btoa(bin);
  }
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += BASE64_CHARS[b0 >> 2];
    out += BASE64_CHARS[((b0 & 3) << 4) | (b1 >> 4)];
    out += i + 1 < bytes.length ? BASE64_CHARS[((b1 & 15) << 2) | (b2 >> 6)] : '=';
    out += i + 2 < bytes.length ? BASE64_CHARS[b2 & 63] : '=';
  }
  return out;
}

export function decodeMuLawBase64ToPcm(b64: string): Float32Array {
  let bytes: Uint8Array;
  if (typeof atob === 'function') {
    const bin = atob(b64);
    bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) {
      bytes[i] = bin.charCodeAt(i);
    }
  } else {
    const clean = b64.replace(/[^A-Za-z0-9+/]/g, '');
    const outBytes: number[] = [];
    for (let i = 0; i < clean.length; i += 4) {
      const c0 = BASE64_CHARS.indexOf(clean[i]);
      const c1 = i + 1 < clean.length ? BASE64_CHARS.indexOf(clean[i + 1]) : 0;
      const c2 = i + 2 < clean.length ? BASE64_CHARS.indexOf(clean[i + 2]) : -1;
      const c3 = i + 3 < clean.length ? BASE64_CHARS.indexOf(clean[i + 3]) : -1;
      outBytes.push((c0 << 2) | (c1 >> 4));
      if (c2 >= 0) outBytes.push(((c1 & 15) << 4) | (c2 >> 2));
      if (c3 >= 0) outBytes.push(((c2 & 3) << 6) | c3);
    }
    bytes = new Uint8Array(outBytes);
  }
  const out = new Float32Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    out[i] = muLawByteToLinearSample(bytes[i]);
  }
  return out;
}

interface RemotePeerAudioEntry {
  peerId: string;
  pc: RTCPeerConnection | null;
  makingOffer: boolean;
  ignoreOffer: boolean;
  iceConnected: boolean;
  pcConnected: boolean;
  remoteTrackLive: boolean;
  usingWebRtcPath: boolean;
  pendingIce: RTCIceCandidateInit[];
  pullAudioEl: HTMLAudioElement | null;
  streamSourceNode: MediaStreamAudioSourceNode | null;
  webrtcBranchGain: GainNode;
  relayBranchGain: GainNode;
  highpassNode: BiquadFilterNode | null;
  presenceNode: BiquadFilterNode | null;
  retroToneNode: BiquadFilterNode | null;
  retro8BitShaper: WaveShaperNode | null;
  filterNode: BiquadFilterNode;
  pannerNode: PannerNode;
  gainNode: GainNode;
  deduplicator: RelaySeqDeduplicator;
  activeRelaySources: Set<AudioBufferSourceNode>;
  nextRelayPlayTime: number;
  lastAudibleGain: number;
}

export interface ProximityVoiceChatHooks {
  localPlayerId: string;
  sendSignal: (payload: VoiceSignalPayload) => void;
  sendRelayChunk: (payload: VoiceRelayChunkPayload) => void;
  onStatusChanged?: () => void;
}

/**
 * Gerenciador de Voz 3D + **Motor de Voz Retro 8-Bit EVA Comm Aprimorado**:
 * - Timbre 8-bit digital retrô consistente, nítido e sem ruído de fundo (companding + WaveShaper + EQ vocal);
 * - Arbitragem estritamente exclusiva entre WebRTC e Relay + desduplicação `seq` (ZERO voz duplicada!);
 * - Gate vocal com Histerese + Hangover de 380–560ms + Pre-Roll (ZERO cortes no meio da fala!);
 * - Reuso limpo de `RTCRtpTransceiver` (`replaceTrack` sem renegociação colidente) + pacotes de ~108ms
 *   (~9 pkt/s) para NUNCA travar ou bugar o microfone dos outros jogadores da sala!
 * - Chave de privacidade local: desligar o recurso libera a captura e silencia
 *   entrada/saída sem derrubar a conexão do jogador com a sala.
 */
export class ProximityVoiceChatManager {
  private mode: VoiceActivationMode = 'PTT';
  private pttHeld = false;
  /** Preferência local: desliga captura E reprodução da comunicação por voz. */
  private voiceEnabled = true;
  private forceSilenced = false;
  private permissionState: MicPermissionState = 'idle';

  private audioCtx: AudioContext | null = null;
  private sharedRetroCurve: Float32Array<ArrayBuffer> | null = null;
  private micStream: MediaStream | null = null;
  private micSourceNode: MediaStreamAudioSourceNode | null = null;
  private micHighpassNode: BiquadFilterNode | null = null;
  private micCompressorNode: DynamicsCompressorNode | null = null;
  private outboundGateGain: GainNode | null = null;
  private outboundDestNode: MediaStreamAudioDestinationNode | null = null;
  private analyserNode: AnalyserNode | null = null;
  private relayProcessorNode: ScriptProcessorNode | null = null;
  private silentZeroGain: GainNode | null = null;
  private readonly analyserScratch = new Float32Array(512);

  // Acumulador de ~108ms (920 amostras @ 8.5kHz) + pre-roll de 1 quadro para nunca cortar sílabas iniciais
  private readonly relayAccumBuf = new Float32Array(RETRO_RELAY_CHUNK_SAMPLES);
  private relayAccumWritePos = 0;
  private prevIdlePreRollChunk: Float32Array | null = null;
  private preRollFlushedForPhrase = false;
  private lastAudioCallbackMs = 0;

  private gateState: VoiceGateState = createInitialVoiceGateState();
  private relaySeq = 0;
  private disposed = false;

  private readonly peers = new Map<string, RemotePeerAudioEntry>();
  private readonly forwardScratch = new THREE.Vector3();

  constructor(private readonly hooks: ProximityVoiceChatHooks) {}

  get activationMode(): VoiceActivationMode {
    return this.mode;
  }

  get isVoiceEnabled(): boolean {
    return this.voiceEnabled;
  }

  /**
   * Preferência de privacidade do jogador. Ao desligar, interrompe a captura,
   * solta a trilha enviada aos pares e corta imediatamente todas as vozes
   * recebidas — sem deixar o ícone de microfone ativo no navegador.
   */
  setVoiceEnabled(enabled: boolean): void {
    if (this.disposed || this.voiceEnabled === Boolean(enabled)) return;
    this.voiceEnabled = Boolean(enabled);

    if (!this.voiceEnabled) {
      this.pttHeld = false;
      this.gateState = createInitialVoiceGateState();
      this.releaseMicrophoneInput();
      this.detachOutboundTrackFromPeers();
      for (const peer of this.peers.values()) {
        peer.lastAudibleGain = 0;
        peer.gainNode.gain.setValueAtTime(0, this.audioCtx?.currentTime ?? 0);
      }
    } else if (this.mode === 'OPEN') {
      this.resumeAudioContextIfNeeded();
      void this.ensureMicrophoneInitialized();
    }

    this.syncOutboundGate();
    this.hooks.onStatusChanged?.();
  }

  get isPushToTalkHeld(): boolean {
    return this.pttHeld;
  }

  get micPermission(): MicPermissionState {
    return this.permissionState;
  }

  get isSpeaking(): boolean {
    return this.voiceEnabled && this.gateState.gateOpen && !this.forceSilenced;
  }

  get voiceLevel(): number {
    return !this.voiceEnabled || this.forceSilenced
      ? 0
      : this.gateState.smoothedLevel;
  }

  /**
   * Indica se o microfone está armado para captar voz agora (segurando [B] ou em modo ABERTO).
   */
  get isMicArmed(): boolean {
    if (!this.voiceEnabled || this.forceSilenced) return false;
    if (this.mode === 'OPEN') return true;
    return this.pttHeld;
  }

  setForceSilenced(silenced: boolean): void {
    if (this.forceSilenced === silenced) return;
    this.forceSilenced = silenced;
    if (silenced) {
      this.pttHeld = false;
      this.gateState = createInitialVoiceGateState();
    }
    this.syncOutboundGate();
  }

  setPushToTalkHeld(held: boolean): void {
    if (this.disposed || !this.voiceEnabled) return;
    if (this.pttHeld === held) return;
    this.pttHeld = held;
    if (held) {
      this.resumeAudioContextIfNeeded();
      void this.ensureMicrophoneInitialized();
    }
    this.syncOutboundGate();
    this.hooks.onStatusChanged?.();
  }

  cycleVoiceMode(): VoiceActivationMode {
    if (this.disposed || !this.voiceEnabled) return this.mode;
    if (this.mode === 'PTT') {
      this.mode = 'OPEN';
      this.resumeAudioContextIfNeeded();
      void this.ensureMicrophoneInitialized();
    } else if (this.mode === 'OPEN') {
      this.mode = 'MUTED';
    } else {
      this.mode = 'PTT';
    }
    this.syncOutboundGate();
    this.hooks.onStatusChanged?.();
    return this.mode;
  }

  setVoiceMode(nextMode: VoiceActivationMode): void {
    if (this.disposed || !this.voiceEnabled || this.mode === nextMode) return;
    this.mode = nextMode;
    if (nextMode === 'OPEN') {
      this.resumeAudioContextIfNeeded();
      void this.ensureMicrophoneInitialized();
    }
    this.syncOutboundGate();
    this.hooks.onStatusChanged?.();
  }

  resumeAudioContextIfNeeded(): void {
    const ctx = this.ensureAudioContext();
    if (ctx && ctx.state === 'suspended') {
      void ctx.resume().catch(() => {});
    }
  }

  private ensureAudioContext(): AudioContext | null {
    if (this.disposed || typeof window === 'undefined') return null;
    if (this.audioCtx) return this.audioCtx;

    const AudioCtxCtor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioCtxCtor) return null;

    try {
      this.audioCtx = new AudioCtxCtor();
      return this.audioCtx;
    } catch {
      return null;
    }
  }

  private getRetroQuantizerCurve(): Float32Array<ArrayBuffer> {
    if (!this.sharedRetroCurve) {
      this.sharedRetroCurve = buildRetro8BitQuantizerCurve(56, 1.18, 2048);
    }
    return this.sharedRetroCurve;
  }

  async ensureMicrophoneInitialized(): Promise<boolean> {
    if (this.disposed || !this.voiceEnabled) return false;
    if (this.micStream && this.permissionState === 'granted') {
      this.resumeAudioContextIfNeeded();
      return true;
    }
    if (this.permissionState === 'requesting') {
      return false;
    }

    if (
      typeof navigator === 'undefined' ||
      !navigator.mediaDevices ||
      typeof navigator.mediaDevices.getUserMedia !== 'function'
    ) {
      this.permissionState = 'unavailable';
      this.hooks.onStatusChanged?.();
      return false;
    }

    this.permissionState = 'requesting';
    this.hooks.onStatusChanged?.();

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
        video: false,
      });

      if (this.disposed || !this.voiceEnabled) {
        for (const tr of stream.getTracks()) tr.stop();
        return false;
      }

      const ctx = this.ensureAudioContext();
      if (!ctx) {
        for (const tr of stream.getTracks()) tr.stop();
        this.permissionState = 'unavailable';
        this.hooks.onStatusChanged?.();
        return false;
      }

      this.micStream = stream;
      this.permissionState = 'granted';

      this.micSourceNode = ctx.createMediaStreamSource(stream);

      // Condicionamento vocal de saída: corta grave/sopro (<155 Hz) + nivela volume sem distorcer os outros!
      let conditionedNode: AudioNode = this.micSourceNode;
      if (typeof ctx.createBiquadFilter === 'function') {
        const hp = ctx.createBiquadFilter();
        hp.type = 'highpass';
        hp.frequency.value = 155;
        hp.Q.value = 0.707;
        conditionedNode.connect(hp);
        conditionedNode = hp;
        this.micHighpassNode = hp;
      }
      if (typeof ctx.createDynamicsCompressor === 'function') {
        const comp = ctx.createDynamicsCompressor();
        comp.threshold.value = -19;
        comp.knee.value = 12;
        comp.ratio.value = 4.5;
        comp.attack.value = 0.003;
        comp.release.value = 0.16;
        conditionedNode.connect(comp);
        conditionedNode = comp;
        this.micCompressorNode = comp;
      }

      this.analyserNode = ctx.createAnalyser();
      this.analyserNode.fftSize = 512;
      this.analyserNode.smoothingTimeConstant = 0.35;

      this.outboundGateGain = ctx.createGain();
      this.outboundGateGain.gain.value = 0;

      this.outboundDestNode = ctx.createMediaStreamDestination();

      conditionedNode.connect(this.analyserNode);
      conditionedNode.connect(this.outboundGateGain);
      this.outboundGateGain.connect(this.outboundDestNode);

      // Captura em blocos estáveis de ~108ms (pré-gate para pre-roll limpo sem cortar início de frase!)
      this.setupFallbackRelayCapture(ctx, conditionedNode);

      // CRÍTICO: Reutiliza o transceiver de áudio já negociado (`replaceTrack` sem criar 2ª trilha nem colidir SDP!)
      const outTrack = this.outboundDestNode.stream.getAudioTracks()[0];
      if (outTrack) {
        for (const peer of this.peers.values()) {
          this.attachOutboundTrackToPeer(peer, outTrack);
        }
      }

      this.syncOutboundGate();
      this.hooks.onStatusChanged?.();
      return true;
    } catch {
      this.permissionState = 'denied';
      this.hooks.onStatusChanged?.();
      return false;
    }
  }

  /** Interrompe apenas a entrada do microfone; o contexto continua vivo para ouvir o jogo. */
  private releaseMicrophoneInput(): void {
    if (this.relayProcessorNode) {
      try {
        this.relayProcessorNode.onaudioprocess = null;
        this.relayProcessorNode.disconnect();
      } catch {
        // Ignorar
      }
      this.relayProcessorNode = null;
    }
    if (this.silentZeroGain) {
      try {
        this.silentZeroGain.disconnect();
      } catch {
        // Ignorar
      }
      this.silentZeroGain = null;
    }
    for (const node of [
      this.micSourceNode,
      this.micHighpassNode,
      this.micCompressorNode,
      this.analyserNode,
      this.outboundGateGain,
    ]) {
      try {
        node?.disconnect();
      } catch {
        // Ignorar
      }
    }
    this.micSourceNode = null;
    this.micHighpassNode = null;
    this.micCompressorNode = null;
    this.analyserNode = null;
    this.outboundGateGain = null;

    if (this.micStream) {
      for (const track of this.micStream.getTracks()) {
        try {
          track.stop();
        } catch {
          // Ignorar
        }
      }
      this.micStream = null;
    }
    this.outboundDestNode = null;
    this.permissionState = 'idle';
    this.relayAccumWritePos = 0;
    this.prevIdlePreRollChunk = null;
    this.preRollFlushedForPhrase = false;
    this.lastAudioCallbackMs = 0;
  }

  /** Remove a trilha de envio sem fechar as conexões WebRTC de recepção. */
  private detachOutboundTrackFromPeers(): void {
    for (const peer of this.peers.values()) {
      try {
        for (const sender of peer.pc?.getSenders?.() ?? []) {
          if (sender.track?.kind === 'audio') {
            void sender.replaceTrack(null).catch(() => {});
          }
        }
      } catch {
        // A conexão pode estar fechando durante a troca da configuração.
      }
    }
  }

  private attachOutboundTrackToPeer(
    peer: RemotePeerAudioEntry,
    outTrack: MediaStreamTrack
  ): void {
    const pc = peer.pc;
    if (!pc || !this.outboundDestNode) return;

    try {
      if (typeof pc.getTransceivers === 'function') {
        const audioTransceiver = pc
          .getTransceivers()
          .find(
            (t) =>
              t.receiver?.track?.kind === 'audio' ||
              t.sender?.track?.kind === 'audio'
          );
        if (audioTransceiver) {
          if (audioTransceiver.direction === 'recvonly') {
            audioTransceiver.direction = 'sendrecv';
          }
          void audioTransceiver.sender.replaceTrack(outTrack).catch(() => {});
          return;
        }
      }

      const senders = pc.getSenders?.() ?? [];
      const existingAudioSender = senders.find(
        (s) => !s.track || s.track.kind === 'audio'
      );
      if (existingAudioSender) {
        void existingAudioSender.replaceTrack(outTrack).catch(() => {});
      } else {
        pc.addTrack(outTrack, this.outboundDestNode.stream);
      }
    } catch {
      // Ignorar caso a conexão já esteja encerrada
    }
  }

  private setupFallbackRelayCapture(
    ctx: AudioContext,
    conditionedInput: AudioNode
  ): void {
    if (typeof ctx.createScriptProcessor !== 'function') return;
    try {
      const proc = ctx.createScriptProcessor(2048, 1, 1);
      const zero = ctx.createGain();
      zero.gain.value = 0;
      conditionedInput.connect(proc);
      proc.connect(zero);
      zero.connect(ctx.destination);

      this.relayProcessorNode = proc;
      this.silentZeroGain = zero;

      proc.onaudioprocess = (ev) => {
        if (this.disposed) return;

        const input = ev.inputBuffer.getChannelData(0);
        const nowMs =
          typeof performance !== 'undefined' ? performance.now() : Date.now();
        const dtAudio =
          this.lastAudioCallbackMs > 0
            ? Math.min(0.15, (nowMs - this.lastAudioCallbackMs) * 0.001)
            : input.length / (ev.inputBuffer.sampleRate || 48_000);
        this.lastAudioCallbackMs = nowMs;

        // Mantém o gate atualizado diretamente na thread de áudio mesmo se o FPS 3D oscilar!
        if (this.isMicArmed && this.permissionState === 'granted') {
          let sumSq = 0;
          let peak = 0;
          for (let i = 0; i < input.length; i++) {
            const s = input[i];
            sumSq += s * s;
            const a = Math.abs(s);
            if (a > peak) peak = a;
          }
          const rms = Math.sqrt(sumSq / Math.max(1, input.length));
          const rawLevel = Math.min(1, Math.max(rms * 4.2, peak * 1.35));
          const prevOpen = this.gateState.gateOpen;
          this.gateState = stepVoiceGateState(
            this.gateState,
            rawLevel,
            dtAudio,
            true,
            this.pttHeld
          );
          if (this.gateState.gateOpen !== prevOpen) {
            this.syncOutboundGate();
          }
        }

        if (!this.isMicArmed || this.peers.size === 0) {
          this.relayAccumWritePos = 0;
          this.preRollFlushedForPhrase = false;
          return;
        }

        // Só codifica pacotes de Relay se pelo menos 1 aliado ainda não estiver com áudio WebRTC ativo
        let anyPeerNeedsRelay = false;
        for (const p of this.peers.values()) {
          if (!p.usingWebRtcPath) {
            anyPeerNeedsRelay = true;
            break;
          }
        }
        if (!anyPeerNeedsRelay) {
          this.relayAccumWritePos = 0;
          return;
        }

        const srcRate = ev.inputBuffer.sampleRate || ctx.sampleRate || 48_000;
        const downsampled = downsamplePcmWithAntiAlias(
          input,
          srcRate,
          RETRO_RELAY_SAMPLE_RATE
        );

        let readOffset = 0;
        while (readOffset < downsampled.length) {
          const space = RETRO_RELAY_CHUNK_SAMPLES - this.relayAccumWritePos;
          const toCopy = Math.min(space, downsampled.length - readOffset);
          this.relayAccumBuf.set(
            downsampled.subarray(readOffset, readOffset + toCopy),
            this.relayAccumWritePos
          );
          this.relayAccumWritePos += toCopy;
          readOffset += toCopy;

          if (this.relayAccumWritePos >= RETRO_RELAY_CHUNK_SAMPLES) {
            this.relayAccumWritePos = 0;
            this.emitAccumulatedRelayFrame(this.relayAccumBuf);
          }
        }
      };
    } catch {
      // Ambientes sem ScriptProcessor continuam via WebRTC padrão
    }
  }

  private emitAccumulatedRelayFrame(frame: Float32Array): void {
    if (!this.isSpeaking) {
      // Guarda 1 quadro de pre-roll (~108ms) para não engolir a primeira consoante quando começar a falar!
      if (!this.prevIdlePreRollChunk) {
        this.prevIdlePreRollChunk = new Float32Array(frame.length);
      }
      this.prevIdlePreRollChunk.set(frame);
      this.preRollFlushedForPhrase = false;
      return;
    }

    if (!this.preRollFlushedForPhrase) {
      this.preRollFlushedForPhrase = true;
      if (this.prevIdlePreRollChunk) {
        let prePeak = 0;
        for (let i = 0; i < this.prevIdlePreRollChunk.length; i++) {
          const a = Math.abs(this.prevIdlePreRollChunk[i]);
          if (a > prePeak) prePeak = a;
        }
        if (prePeak >= 0.008) {
          const preCopy = new Float32Array(this.prevIdlePreRollChunk);
          applyChunkMicroFade(preCopy, RETRO_RELAY_SAMPLE_RATE);
          this.hooks.sendRelayChunk({
            fromId: this.hooks.localPlayerId,
            seq: ++this.relaySeq,
            sampleRate: RETRO_RELAY_SAMPLE_RATE,
            muLawB64: encodePcmToMuLawBase64(preCopy),
          });
        }
      }
    }

    const outFrame = new Float32Array(frame);
    applyChunkMicroFade(outFrame, RETRO_RELAY_SAMPLE_RATE);
    this.hooks.sendRelayChunk({
      fromId: this.hooks.localPlayerId,
      seq: ++this.relaySeq,
      sampleRate: RETRO_RELAY_SAMPLE_RATE,
      muLawB64: encodePcmToMuLawBase64(outFrame),
    });
  }

  private syncOutboundGate(): void {
    const armed = this.isMicArmed && this.permissionState === 'granted';
    if (this.micStream) {
      for (const track of this.micStream.getAudioTracks()) {
        track.enabled = armed;
      }
    }
    if (this.outboundGateGain && this.audioCtx) {
      // Em Push-to-Talk ([B] pressionado), mantém o ganho aberto continuamente sem risco de cortar sussurros!
      const shouldPassAudio =
        armed && (this.pttHeld || this.gateState.gateOpen);
      const target = shouldPassAudio ? 1.0 : 0.0;
      const timeConstant = shouldPassAudio ? 0.008 : 0.042;
      this.outboundGateGain.gain.setTargetAtTime(
        target,
        this.audioCtx.currentTime,
        timeConstant
      );
    }
  }

  /**
   * Garante cadeia de áudio 3D + DSP Retro 8-Bit EVA Comm isolada para cada aliado da sala.
   */
  ensurePeer(peerId: string): void {
    if (
      this.disposed ||
      !this.voiceEnabled ||
      !peerId ||
      peerId === this.hooks.localPlayerId ||
      this.peers.has(peerId)
    ) {
      return;
    }

    const ctx = this.ensureAudioContext();
    if (!ctx) return;

    // 2 ramos de entrada ESTRITAMENTE MUTUAMENTE EXCLUSIVOS (impede 100% voz duplicada WebRTC + Relay!)
    const webrtcBranchGain = ctx.createGain();
    webrtcBranchGain.gain.value = 0;

    const relayBranchGain = ctx.createGain();
    relayBranchGain.gain.value = 1;

    // Estágio 8-Bit Retro Digital Comm para o ramo WebRTC (o ramo Relay já é 8-bit μ-law nativo!)
    let retro8BitShaper: WaveShaperNode | null = null;
    if (typeof ctx.createWaveShaper === 'function') {
      retro8BitShaper = ctx.createWaveShaper();
      retro8BitShaper.curve = this.getRetroQuantizerCurve();
      retro8BitShaper.oversample = '2x';
      webrtcBranchGain.connect(retro8BitShaper);
    }

    // Filtro anti-estrondo + presença de capacete EVA + suavizador harmônico 8-bit (6.2 kHz) compartilhado
    let highpassNode: BiquadFilterNode | null = null;
    let presenceNode: BiquadFilterNode | null = null;
    let retroToneNode: BiquadFilterNode | null = null;

    const filterNode = ctx.createBiquadFilter();
    filterNode.type = 'lowpass';
    filterNode.frequency.value = 16_500;
    filterNode.Q.value = 0.7;

    if (typeof ctx.createBiquadFilter === 'function') {
      highpassNode = ctx.createBiquadFilter();
      highpassNode.type = 'highpass';
      highpassNode.frequency.value = 175;
      highpassNode.Q.value = 0.707;

      presenceNode = ctx.createBiquadFilter();
      presenceNode.type = 'peaking';
      presenceNode.frequency.value = 1_950;
      presenceNode.Q.value = 0.88;
      if (presenceNode.gain) {
        presenceNode.gain.value = 2.8;
      }

      retroToneNode = ctx.createBiquadFilter();
      retroToneNode.type = 'lowpass';
      retroToneNode.frequency.value = 6_200;
      retroToneNode.Q.value = 0.65;

      if (retro8BitShaper) {
        retro8BitShaper.connect(highpassNode);
      } else {
        webrtcBranchGain.connect(highpassNode);
      }
      relayBranchGain.connect(highpassNode);
      highpassNode.connect(presenceNode);
      presenceNode.connect(retroToneNode);
      retroToneNode.connect(filterNode);
    } else {
      if (retro8BitShaper) {
        retro8BitShaper.connect(filterNode);
      } else {
        webrtcBranchGain.connect(filterNode);
      }
      relayBranchGain.connect(filterNode);
    }

    const pannerNode = ctx.createPanner();
    pannerNode.panningModel = 'HRTF';
    pannerNode.distanceModel = 'linear';
    pannerNode.refDistance = 1;
    pannerNode.maxDistance = 10_000;
    pannerNode.rolloffFactor = 0;
    pannerNode.coneInnerAngle = 360;
    pannerNode.coneOuterAngle = 360;

    const gainNode = ctx.createGain();
    gainNode.gain.value = 0;

    filterNode.connect(pannerNode);
    pannerNode.connect(gainNode);
    gainNode.connect(ctx.destination);

    const entry: RemotePeerAudioEntry = {
      peerId,
      pc: null,
      makingOffer: false,
      ignoreOffer: false,
      iceConnected: false,
      pcConnected: false,
      remoteTrackLive: false,
      usingWebRtcPath: false,
      pendingIce: [],
      pullAudioEl: null,
      streamSourceNode: null,
      webrtcBranchGain,
      relayBranchGain,
      highpassNode,
      presenceNode,
      retroToneNode,
      retro8BitShaper,
      filterNode,
      pannerNode,
      gainNode,
      deduplicator: new RelaySeqDeduplicator(128),
      activeRelaySources: new Set(),
      nextRelayPlayTime: 0,
      lastAudibleGain: 0,
    };
    this.peers.set(peerId, entry);

    this.initWebRtcForPeer(entry);
  }

  private syncPeerExclusiveAudioSource(entry: RemotePeerAudioEntry): void {
    const shouldUseWebRtc =
      (entry.iceConnected || entry.pcConnected) &&
      entry.remoteTrackLive &&
      entry.streamSourceNode !== null;

    if (entry.usingWebRtcPath === shouldUseWebRtc) return;
    entry.usingWebRtcPath = shouldUseWebRtc;

    const now = this.audioCtx?.currentTime ?? 0;
    if (shouldUseWebRtc) {
      // Silencia IMEDIATAMENTE qualquer bloco de Relay agendado antes de abrir o WebRTC (ZERO eco duplo!)
      this.stopQueuedRelaySources(entry);
      entry.relayBranchGain.gain.setTargetAtTime(0, now, 0.01);
      entry.webrtcBranchGain.gain.setTargetAtTime(1, now, 0.018);
    } else {
      entry.webrtcBranchGain.gain.setTargetAtTime(0, now, 0.01);
      entry.relayBranchGain.gain.setTargetAtTime(1, now, 0.018);
    }
  }

  private stopQueuedRelaySources(entry: RemotePeerAudioEntry): void {
    for (const src of entry.activeRelaySources) {
      try {
        src.onended = null;
        src.stop();
        src.disconnect();
      } catch {
        // Ignorar
      }
    }
    entry.activeRelaySources.clear();
    entry.nextRelayPlayTime = 0;
  }

  private isPoliteWith(peerId: string): boolean {
    return this.hooks.localPlayerId < peerId;
  }

  private initWebRtcForPeer(entry: RemotePeerAudioEntry): void {
    if (typeof RTCPeerConnection === 'undefined') return;

    try {
      const pc = new RTCPeerConnection({ iceServers: RTC_ICE_SERVERS });
      entry.pc = pc;

      if (this.outboundDestNode) {
        const track = this.outboundDestNode.stream.getAudioTracks()[0];
        if (track) {
          pc.addTrack(track, this.outboundDestNode.stream);
        } else {
          pc.addTransceiver('audio', { direction: 'sendrecv' });
        }
      } else {
        pc.addTransceiver('audio', { direction: 'sendrecv' });
      }

      pc.onicecandidate = (ev) => {
        if (this.disposed || !ev.candidate) return;
        this.hooks.sendSignal({
          fromId: this.hooks.localPlayerId,
          toId: entry.peerId,
          kind: 'ice',
          candidate: ev.candidate.toJSON(),
        });
      };

      pc.onnegotiationneeded = async () => {
        if (this.disposed || entry.pc !== pc) return;
        try {
          entry.makingOffer = true;
          const offer = await pc.createOffer();
          if (pc.signalingState !== 'stable') return;
          await pc.setLocalDescription(offer);
          if (pc.localDescription) {
            this.hooks.sendSignal({
              fromId: this.hooks.localPlayerId,
              toId: entry.peerId,
              kind: 'offer',
              sdp: pc.localDescription,
            });
          }
        } catch {
          // Silencioso
        } finally {
          entry.makingOffer = false;
        }
      };

      pc.onconnectionstatechange = () => {
        entry.pcConnected = pc.connectionState === 'connected';
        if (
          pc.connectionState === 'failed' ||
          pc.connectionState === 'closed'
        ) {
          entry.iceConnected = false;
        }
        this.syncPeerExclusiveAudioSource(entry);
      };

      pc.oniceconnectionstatechange = () => {
        if (
          pc.iceConnectionState === 'connected' ||
          pc.iceConnectionState === 'completed'
        ) {
          entry.iceConnected = true;
        } else if (
          pc.iceConnectionState === 'failed' ||
          pc.iceConnectionState === 'disconnected' ||
          pc.iceConnectionState === 'closed'
        ) {
          entry.iceConnected = false;
        }
        this.syncPeerExclusiveAudioSource(entry);
      };

      pc.ontrack = (ev) => {
        if (this.disposed) return;
        const track = ev.track;
        entry.remoteTrackLive = track.readyState === 'live';
        track.onended = () => {
          entry.remoteTrackLive = false;
          this.syncPeerExclusiveAudioSource(entry);
        };
        track.onmute = () => {
          entry.remoteTrackLive = false;
          this.syncPeerExclusiveAudioSource(entry);
        };
        track.onunmute = () => {
          entry.remoteTrackLive = track.readyState === 'live';
          this.syncPeerExclusiveAudioSource(entry);
        };

        const stream =
          ev.streams && ev.streams[0]
            ? ev.streams[0]
            : new MediaStream([track]);
        this.attachRemoteMediaStream(entry, stream);
      };
    } catch {
      entry.pc = null;
    }
  }

  private attachRemoteMediaStream(
    entry: RemotePeerAudioEntry,
    stream: MediaStream
  ): void {
    const ctx = this.ensureAudioContext();
    if (!ctx) return;
    this.resumeAudioContextIfNeeded();

    // Workaround do Chromium totalmente silenciado (`muted = true` + `volume = 0`) para JAMAIS duplicar áudio 2D!
    if (typeof Audio !== 'undefined') {
      try {
        if (entry.pullAudioEl) {
          entry.pullAudioEl.pause();
          entry.pullAudioEl.srcObject = null;
        }
        const pull = new Audio();
        pull.muted = true;
        pull.volume = 0;
        pull.srcObject = stream;
        pull.setAttribute('playsinline', '');
        void pull.play().catch(() => {});
        entry.pullAudioEl = pull;
      } catch {
        // Ignorar
      }
    }

    try {
      entry.streamSourceNode?.disconnect();
      const srcNode = ctx.createMediaStreamSource(stream);
      srcNode.connect(entry.webrtcBranchGain);
      entry.streamSourceNode = srcNode;
      entry.remoteTrackLive = true;
      this.syncPeerExclusiveAudioSource(entry);
    } catch {
      // Ignorar
    }
  }

  async handleIncomingSignal(payload: VoiceSignalPayload): Promise<void> {
    if (
      this.disposed ||
      !this.voiceEnabled ||
      !payload ||
      payload.toId !== this.hooks.localPlayerId ||
      payload.fromId === this.hooks.localPlayerId
    ) {
      return;
    }

    this.ensurePeer(payload.fromId);
    const entry = this.peers.get(payload.fromId);
    if (!entry || !entry.pc) return;
    const pc = entry.pc;

    try {
      if (payload.kind === 'offer' && payload.sdp) {
        const polite = this.isPoliteWith(payload.fromId);
        const offerCollision =
          entry.makingOffer || pc.signalingState !== 'stable';
        entry.ignoreOffer = !polite && offerCollision;
        if (entry.ignoreOffer) return;

        await pc.setRemoteDescription(payload.sdp);
        await this.flushPendingIce(entry);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        if (pc.localDescription) {
          this.hooks.sendSignal({
            fromId: this.hooks.localPlayerId,
            toId: payload.fromId,
            kind: 'answer',
            sdp: pc.localDescription,
          });
        }
      } else if (payload.kind === 'answer' && payload.sdp) {
        if (pc.signalingState === 'have-local-offer') {
          await pc.setRemoteDescription(payload.sdp);
          await this.flushPendingIce(entry);
        }
      } else if (payload.kind === 'ice' && payload.candidate) {
        if (entry.ignoreOffer) return;
        if (pc.remoteDescription && pc.remoteDescription.type) {
          await pc.addIceCandidate(payload.candidate);
        } else {
          entry.pendingIce.push(payload.candidate);
        }
      }
    } catch {
      // Ignora corrida transitória de SDP/ICE
    }
  }

  private async flushPendingIce(entry: RemotePeerAudioEntry): Promise<void> {
    if (!entry.pc || entry.pendingIce.length === 0) return;
    const queued = entry.pendingIce.splice(0, entry.pendingIce.length);
    for (const cand of queued) {
      try {
        await entry.pc.addIceCandidate(cand);
      } catch {
        // Ignorar
      }
    }
  }

  handleIncomingRelayChunk(payload: VoiceRelayChunkPayload): void {
    if (
      this.disposed ||
      !this.voiceEnabled ||
      !payload ||
      payload.fromId === this.hooks.localPlayerId ||
      !payload.muLawB64
    ) {
      return;
    }

    this.ensurePeer(payload.fromId);
    const entry = this.peers.get(payload.fromId);
    if (!entry) return;

    // 1. Filtra entregas duplicadas (ex.: BroadcastChannel + Supabase Realtime entregando o mesmo `seq`!)
    if (!entry.deduplicator.accept(payload.seq)) {
      return;
    }

    // 2. Se o canal WebRTC já está ativo e saudável, descarta o Relay (ZERO duplicação!)
    if (entry.usingWebRtcPath) return;
    if (entry.lastAudibleGain <= 0.002) return;

    const ctx = this.ensureAudioContext();
    if (!ctx) return;
    this.resumeAudioContextIfNeeded();

    try {
      const pcm = decodeMuLawBase64ToPcm(payload.muLawB64);
      if (pcm.length === 0) return;
      const rate = Math.max(4000, Math.min(48000, payload.sampleRate || RETRO_RELAY_SAMPLE_RATE));
      applyChunkMicroFade(pcm, rate, 0.0025);

      const audioBuf = ctx.createBuffer(1, pcm.length, rate);
      audioBuf.getChannelData(0).set(pcm);

      const now = ctx.currentTime;
      if (entry.nextRelayPlayTime > now + MAX_JITTER_LEAD_SEC) {
        // Caso uma rajada de rede tenha acumulado atraso excessivo, limpa a fila antes de ressincronizar
        // para JAMAIS tocar dois trechos da voz do jogador sobrepostos!
        this.stopQueuedRelaySources(entry);
      }
      if (entry.nextRelayPlayTime < now + 0.004) {
        entry.nextRelayPlayTime = now + INITIAL_JITTER_BUFFER_SEC;
      }

      const src = ctx.createBufferSource();
      src.buffer = audioBuf;
      src.connect(entry.relayBranchGain);
      entry.activeRelaySources.add(src);
      src.onended = () => {
        entry.activeRelaySources.delete(src);
        try {
          src.disconnect();
        } catch {
          // Ignorar
        }
      };

      src.start(entry.nextRelayPlayTime);
      entry.nextRelayPlayTime += audioBuf.duration;
    } catch {
      // Silencioso
    }
  }

  removePeer(peerId: string): void {
    const entry = this.peers.get(peerId);
    if (!entry) return;
    this.peers.delete(peerId);

    this.stopQueuedRelaySources(entry);

    try {
      entry.streamSourceNode?.disconnect();
      entry.webrtcBranchGain.disconnect();
      entry.relayBranchGain.disconnect();
      entry.retro8BitShaper?.disconnect();
      entry.highpassNode?.disconnect();
      entry.presenceNode?.disconnect();
      entry.retroToneNode?.disconnect();
      entry.filterNode.disconnect();
      entry.pannerNode.disconnect();
      entry.gainNode.disconnect();
    } catch {
      // Ignorar
    }
    if (entry.pullAudioEl) {
      try {
        entry.pullAudioEl.pause();
        entry.pullAudioEl.srcObject = null;
      } catch {
        // Ignorar
      }
    }
    if (entry.pc) {
      try {
        entry.pc.close();
      } catch {
        // Ignorar
      }
    }
  }

  /**
   * Atualiza quadro a quadro:
   * 1) Medidor de energia vocal do microfone local + gate com histerese e sustentação;
   * 2) Posição e orientação 3D do ouvinte (`AudioListener`);
   * 3) Posição 3D HRTF, distância, oclusão por paredes e canal VHF de longa distância!
   */
  update(
    dt: number,
    listenerPos: THREE.Vector3,
    listenerYaw: number,
    listenerPitch: number,
    remotePeers: ReadonlyArray<{
      id: string;
      pos: THREE.Vector3;
      dead: boolean;
      radioActive?: boolean;
    }>,
    localRadioActive = false
  ): void {
    if (this.disposed) return;

    const nowPerfMs =
      typeof performance !== 'undefined' ? performance.now() : Date.now();
    const audioThreadRecentlyUpdated =
      nowPerfMs - this.lastAudioCallbackMs < 95;

    // 1. Mede nível de voz local caso o callback de áudio não tenha acabado de rodar neste instante
    if (
      this.isMicArmed &&
      this.permissionState === 'granted' &&
      this.analyserNode
    ) {
      if (!audioThreadRecentlyUpdated) {
        this.analyserNode.getFloatTimeDomainData(this.analyserScratch);
        let sumSq = 0;
        let peak = 0;
        for (let i = 0; i < this.analyserScratch.length; i++) {
          const s = this.analyserScratch[i];
          sumSq += s * s;
          const a = Math.abs(s);
          if (a > peak) peak = a;
        }
        const rms = Math.sqrt(sumSq / this.analyserScratch.length);
        const rawLevel = Math.min(1, Math.max(rms * 4.2, peak * 1.35));
        const prevOpen = this.gateState.gateOpen;
        this.gateState = stepVoiceGateState(
          this.gateState,
          rawLevel,
          dt,
          true,
          this.pttHeld
        );
        if (this.gateState.gateOpen !== prevOpen) {
          this.syncOutboundGate();
        }
      }
    } else {
      const prevOpen = this.gateState.gateOpen;
      this.gateState = stepVoiceGateState(this.gateState, 0, dt, false, false);
      if (this.gateState.gateOpen !== prevOpen) {
        this.syncOutboundGate();
      }
    }

    // Não cria nem acorda um AudioContext quando a preferência de voz está
    // desligada — isso também evita qualquer pedido indireto de áudio ao
    // navegador durante uma partida sem comunicação por voz.
    if (!this.voiceEnabled) return;

    const ctx =
      remotePeers.length > 0 ? this.ensureAudioContext() : this.audioCtx;
    if (!ctx) return;

    // 2. Atualiza posição e direção 3D do ouvinte (câmera do jogador local)
    const listener = ctx.listener;
    const cosPitch = Math.cos(listenerPitch);
    this.forwardScratch
      .set(
        -Math.sin(listenerYaw) * cosPitch,
        Math.sin(listenerPitch),
        -Math.cos(listenerYaw) * cosPitch
      )
      .normalize();

    const tNow = ctx.currentTime;
    if (typeof listener.positionX !== 'undefined') {
      listener.positionX.setValueAtTime(listenerPos.x, tNow);
      listener.positionY.setValueAtTime(listenerPos.y, tNow);
      listener.positionZ.setValueAtTime(listenerPos.z, tNow);
      listener.forwardX.setValueAtTime(this.forwardScratch.x, tNow);
      listener.forwardY.setValueAtTime(this.forwardScratch.y, tNow);
      listener.forwardZ.setValueAtTime(this.forwardScratch.z, tNow);
      listener.upX.setValueAtTime(0, tNow);
      listener.upY.setValueAtTime(1, tNow);
      listener.upZ.setValueAtTime(0, tNow);
    } else {
      listener.setPosition(listenerPos.x, listenerPos.y, listenerPos.z);
      listener.setOrientation(
        this.forwardScratch.x,
        this.forwardScratch.y,
        this.forwardScratch.z,
        0,
        1,
        0
      );
    }

    // 3. Atualiza posição 3D HRTF, volume por distância e oclusão de paredes de cada aliado
    for (const rp of remotePeers) {
      this.ensurePeer(rp.id);
      const entry = this.peers.get(rp.id);
      if (!entry) continue;

      const headX = rp.pos.x;
      const headY = rp.pos.y + 1.55;
      const headZ = rp.pos.z;

      if (rp.dead || !this.voiceEnabled) {
        entry.lastAudibleGain = 0;
        entry.gainNode.gain.setTargetAtTime(0, tNow, 0.02);
        continue;
      }

      const dist = Math.hypot(
        headX - listenerPos.x,
        headY - listenerPos.y,
        headZ - listenerPos.z
      );
      const walls =
        dist < MAX_PROXIMITY_VOICE_DISTANCE
          ? countLabyrinthWallsBetween(
              listenerPos.x,
              listenerPos.z,
              headX,
              headZ
            )
          : 4;
      const peerRadio = Boolean(rp.radioActive);
      // O canal VHF SÓ é recebido por quem está com o próprio rádio LIGADO.
      // Sem o rádio ligado, a voz do aliado só chega pelo AR (distância +
      // oclusão de paredes) e some além do alcance normal.
      const radioLinkMode = computeRadioVoiceLinkMode(
        localRadioActive,
        peerRadio
      );
      const acoustics = computeProximityVoiceAcousticParams(
        dist,
        walls,
        radioLinkMode
      );

      // Quando a voz chega pelo Rádio VHF de longa distância, posiciona a fonte no transceptor do próprio ouvinte!
      const srcX = acoustics.viaRadio ? listenerPos.x : headX;
      const srcY = acoustics.viaRadio ? listenerPos.y + 0.12 : headY;
      const srcZ = acoustics.viaRadio ? listenerPos.z : headZ;
      if (typeof entry.pannerNode.positionX !== 'undefined') {
        entry.pannerNode.positionX.setTargetAtTime(srcX, tNow, 0.03);
        entry.pannerNode.positionY.setTargetAtTime(srcY, tNow, 0.03);
        entry.pannerNode.positionZ.setTargetAtTime(srcZ, tNow, 0.03);
      } else {
        entry.pannerNode.setPosition(srcX, srcY, srcZ);
      }

      entry.lastAudibleGain = acoustics.gain;
      entry.gainNode.gain.setTargetAtTime(acoustics.gain * 1.25, tNow, 0.035);
      entry.filterNode.frequency.setTargetAtTime(
        acoustics.lowpassHz,
        tNow,
        0.045
      );
    }
  }

  destroy(): void {
    if (this.disposed) return;
    this.disposed = true;

    for (const peerId of Array.from(this.peers.keys())) {
      this.removePeer(peerId);
    }

    if (this.relayProcessorNode) {
      try {
        this.relayProcessorNode.onaudioprocess = null;
        this.relayProcessorNode.disconnect();
      } catch {
        // Ignorar
      }
      this.relayProcessorNode = null;
    }

    if (this.silentZeroGain) {
      try {
        this.silentZeroGain.disconnect();
      } catch {
        // Ignorar
      }
      this.silentZeroGain = null;
    }

    if (this.micCompressorNode) {
      try {
        this.micCompressorNode.disconnect();
      } catch {
        // Ignorar
      }
      this.micCompressorNode = null;
    }

    if (this.micHighpassNode) {
      try {
        this.micHighpassNode.disconnect();
      } catch {
        // Ignorar
      }
      this.micHighpassNode = null;
    }

    if (this.micSourceNode) {
      try {
        this.micSourceNode.disconnect();
      } catch {
        // Ignorar
      }
      this.micSourceNode = null;
    }

    if (this.outboundGateGain) {
      try {
        this.outboundGateGain.disconnect();
      } catch {
        // Ignorar
      }
      this.outboundGateGain = null;
    }

    if (this.micStream) {
      for (const track of this.micStream.getTracks()) {
        try {
          track.stop();
        } catch {
          // Ignorar
        }
      }
      this.micStream = null;
    }

    if (this.audioCtx) {
      try {
        void this.audioCtx.close();
      } catch {
        // Ignorar
      }
      this.audioCtx = null;
    }
  }
}
