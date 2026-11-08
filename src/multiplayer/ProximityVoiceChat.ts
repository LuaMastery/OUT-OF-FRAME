import * as THREE from 'three';
import {
  CELL_SIZE,
  isSolidCell,
  LABYRINTH_MAP,
  worldToGridCell,
} from '../doom/DoomMazeBuilder';

export type VoiceActivationMode = 'PTT' | 'OPEN' | 'MUTED';

export type MicPermissionState = 'idle' | 'requesting' | 'granted' | 'denied' | 'unavailable';

/** Distância máxima (em metros) em que a voz de um amigo ainda pode ser ouvida (~6,5 células do labirinto). */
export const MAX_PROXIMITY_VOICE_DISTANCE = 22.0;

/** Raio próximo (em metros) onde a voz soa em volume pleno sem atenuação de distância. */
export const FULL_VOLUME_VOICE_DISTANCE = 2.8;

/** Limiar mínimo de energia vocal para abrir o gate de voz (ignora chiado de fundo do microfone). */
export const VOICE_NOISE_GATE_THRESHOLD = 0.045;

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
}

export interface SpiderVoiceAlertResult {
  heard: boolean;
  effectiveRadius: number;
  intensity: number;
}

const RTC_ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
];

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
    const solid = isSolidCell(LABYRINTH_MAP, cell.gx, cell.gz);
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
 * Calcula de forma pura o ganho de volume por distância + abafamento acústico (filtro passa-baixa)
 * provocado pelas paredes de concreto/metal do labirinto entre dois jogadores!
 */
export function computeProximityVoiceAcousticParams(
  distanceMeters: number,
  wallCount: number
): ProximityVoiceAcoustics {
  if (
    !Number.isFinite(distanceMeters) ||
    distanceMeters >= MAX_PROXIMITY_VOICE_DISTANCE
  ) {
    return { gain: 0, lowpassHz: 400, audible: false };
  }

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
  let lowpassHz = 16_500;

  if (cleanWalls === 1) {
    occlusionGain = 0.56;
    lowpassHz = 1_900;
  } else if (cleanWalls === 2) {
    occlusionGain = 0.3;
    lowpassHz = 920;
  } else if (cleanWalls >= 3) {
    occlusionGain = 0.14;
    lowpassHz = 520;
  }

  // Leve absorção de agudos pelo ar em grandes distâncias no corredor
  if (cleanWalls === 0 && clampedDist > 8) {
    const airT = Math.min(1, (clampedDist - 8) / 14);
    lowpassHz = Math.round(16_500 - airT * 8_500);
  }

  const finalGain = distFactor * occlusionGain;
  return {
    gain: finalGain < 0.004 ? 0 : finalGain,
    lowpassHz,
    audible: finalGain >= 0.004,
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
// CODEC COMPACTO G.711 μ-LAW (8 kHz) — Fallback universal instantâneo caso o
// WebRTC P2P esteja negociando ICE, atrás de NAT simétrico estrito ou entre abas!
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
  rtcConnected: boolean;
  pendingIce: RTCIceCandidateInit[];
  pullAudioEl: HTMLAudioElement | null;
  streamSourceNode: MediaStreamAudioSourceNode | null;
  filterNode: BiquadFilterNode;
  pannerNode: PannerNode;
  gainNode: GainNode;
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
 * Gerenciador Completo de Voz por Proximidade 3D (HRTF + Oclusão por Paredes + WebRTC Opus + Fallback Relay):
 * - Modo padrão: Push-to-Talk `[B]` (`PTT`), alternável a qualquer momento no `[Z]` para `OPEN` ou `MUTED`.
 * - Espacialização binaural real (esquerda/direita/frente/costas) via `PannerNode` HRTF + filtro de paredes.
 * - Medidor em tempo real de volume vocal (`localVoiceLevel`) para HUD e audição da Aranha Gigante!
 */
export class ProximityVoiceChatManager {
  private mode: VoiceActivationMode = 'PTT';
  private pttHeld = false;
  private forceSilenced = false;
  private permissionState: MicPermissionState = 'idle';

  private audioCtx: AudioContext | null = null;
  private micStream: MediaStream | null = null;
  private micSourceNode: MediaStreamAudioSourceNode | null = null;
  private outboundGateGain: GainNode | null = null;
  private outboundDestNode: MediaStreamAudioDestinationNode | null = null;
  private analyserNode: AnalyserNode | null = null;
  private relayProcessorNode: ScriptProcessorNode | null = null;
  private silentZeroGain: GainNode | null = null;
  private readonly analyserScratch = new Float32Array(512);

  private smoothedVoiceLevel = 0;
  private speakingNow = false;
  private relaySeq = 0;
  private disposed = false;

  private readonly peers = new Map<string, RemotePeerAudioEntry>();
  private readonly forwardScratch = new THREE.Vector3();

  constructor(private readonly hooks: ProximityVoiceChatHooks) {}

  get activationMode(): VoiceActivationMode {
    return this.mode;
  }

  get isPushToTalkHeld(): boolean {
    return this.pttHeld;
  }

  get micPermission(): MicPermissionState {
    return this.permissionState;
  }

  get isSpeaking(): boolean {
    return this.speakingNow && !this.forceSilenced;
  }

  get voiceLevel(): number {
    return this.forceSilenced ? 0 : this.smoothedVoiceLevel;
  }

  /**
   * Indica se o microfone está armado para captar voz agora (segurando [B] ou em modo ABERTO).
   */
  get isMicArmed(): boolean {
    if (this.forceSilenced) return false;
    if (this.mode === 'OPEN') return true;
    // Tanto em PTT quanto em MUTED, segurar [B] funciona como Push-to-Talk imediato!
    return this.pttHeld;
  }

  setForceSilenced(silenced: boolean): void {
    this.forceSilenced = silenced;
    if (silenced) {
      this.pttHeld = false;
      this.speakingNow = false;
      this.smoothedVoiceLevel = 0;
    }
    this.syncOutboundGate();
  }

  setPushToTalkHeld(held: boolean): void {
    if (this.disposed) return;
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
    if (this.disposed) return this.mode;
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
    if (this.disposed || this.mode === nextMode) return;
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

  async ensureMicrophoneInitialized(): Promise<boolean> {
    if (this.disposed) return false;
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

      if (this.disposed) {
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
      this.analyserNode = ctx.createAnalyser();
      this.analyserNode.fftSize = 512;
      this.analyserNode.smoothingTimeConstant = 0.45;

      this.outboundGateGain = ctx.createGain();
      this.outboundGateGain.gain.value = 0;

      this.outboundDestNode = ctx.createMediaStreamDestination();

      this.micSourceNode.connect(this.analyserNode);
      this.micSourceNode.connect(this.outboundGateGain);
      this.outboundGateGain.connect(this.outboundDestNode);

      // Canal compacto μ-law 8kHz de fallback para conexões sem P2P direto (NAT simétrico / abas locais)
      this.setupFallbackRelayCapture(ctx, this.outboundGateGain);

      // Anexa a trilha de voz com gate aos peers WebRTC já conectados
      const outTrack = this.outboundDestNode.stream.getAudioTracks()[0];
      if (outTrack) {
        for (const peer of this.peers.values()) {
          if (peer.pc) {
            const senders = peer.pc.getSenders();
            const audioSender = senders.find(
              (s) => s.track && s.track.kind === 'audio'
            );
            if (audioSender) {
              void audioSender.replaceTrack(outTrack);
            } else {
              peer.pc.addTrack(outTrack, this.outboundDestNode.stream);
            }
          }
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

  private setupFallbackRelayCapture(
    ctx: AudioContext,
    gatedInput: GainNode
  ): void {
    if (typeof ctx.createScriptProcessor !== 'function') return;
    try {
      const proc = ctx.createScriptProcessor(2048, 1, 1);
      const zero = ctx.createGain();
      zero.gain.value = 0;
      gatedInput.connect(proc);
      proc.connect(zero);
      zero.connect(ctx.destination);

      this.relayProcessorNode = proc;
      this.silentZeroGain = zero;

      const targetRate = 8000;
      proc.onaudioprocess = (ev) => {
        if (this.disposed || !this.isSpeaking || this.peers.size === 0) return;

        // Só envia fallback caso algum aliado ainda não tenha canal WebRTC P2P conectado
        let anyPeerNeedsRelay = false;
        for (const p of this.peers.values()) {
          if (!p.rtcConnected) {
            anyPeerNeedsRelay = true;
            break;
          }
        }
        if (!anyPeerNeedsRelay) return;

        const input = ev.inputBuffer.getChannelData(0);
        const srcRate = ev.inputBuffer.sampleRate || ctx.sampleRate || 48000;
        const ratio = Math.max(1, srcRate / targetRate);
        const outLen = Math.max(1, Math.floor(input.length / ratio));
        const downsampled = new Float32Array(outLen);

        let peak = 0;
        for (let i = 0; i < outLen; i++) {
          const idx = Math.min(input.length - 1, Math.floor(i * ratio));
          const v = input[idx];
          downsampled[i] = v;
          const av = Math.abs(v);
          if (av > peak) peak = av;
        }
        if (peak < 0.015) return;

        const muLawB64 = encodePcmToMuLawBase64(downsampled);
        this.hooks.sendRelayChunk({
          fromId: this.hooks.localPlayerId,
          seq: ++this.relaySeq,
          sampleRate: targetRate,
          muLawB64,
        });
      };
    } catch {
      // Ambientes sem ScriptProcessor continuam via WebRTC padrão
    }
  }

  private syncOutboundGate(): void {
    const armed = this.isMicArmed && this.permissionState === 'granted';
    if (this.micStream) {
      for (const track of this.micStream.getAudioTracks()) {
        // Mantém a trilha ativa quando armado para zero latência no Push-to-Talk!
        track.enabled = armed;
      }
    }
    if (this.outboundGateGain && this.audioCtx) {
      const target = armed && this.speakingNow ? 1.0 : 0.0;
      this.outboundGateGain.gain.setTargetAtTime(
        target,
        this.audioCtx.currentTime,
        0.018
      );
    }
  }

  /**
   * Garante conexão de áudio 3D para cada aliado presente na sala.
   */
  ensurePeer(peerId: string): void {
    if (
      this.disposed ||
      !peerId ||
      peerId === this.hooks.localPlayerId ||
      this.peers.has(peerId)
    ) {
      return;
    }

    const ctx = this.ensureAudioContext();
    if (!ctx) return;

    const filterNode = ctx.createBiquadFilter();
    filterNode.type = 'lowpass';
    filterNode.frequency.value = 16_500;
    filterNode.Q.value = 0.7;

    const pannerNode = ctx.createPanner();
    pannerNode.panningModel = 'HRTF';
    // Atenuação de distância e oclusão é controlada com curva acústica exata no GainNode!
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
      rtcConnected: false,
      pendingIce: [],
      pullAudioEl: null,
      streamSourceNode: null,
      filterNode,
      pannerNode,
      gainNode,
      nextRelayPlayTime: 0,
      lastAudibleGain: 0,
    };
    this.peers.set(peerId, entry);

    this.initWebRtcForPeer(entry);
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
        }
      } else {
        // Garante transceiver bidirecional de áudio mesmo antes do jogador local ligar o próprio mic!
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
        entry.rtcConnected = pc.connectionState === 'connected';
      };

      pc.oniceconnectionstatechange = () => {
        if (
          pc.iceConnectionState === 'connected' ||
          pc.iceConnectionState === 'completed'
        ) {
          entry.rtcConnected = true;
        } else if (
          pc.iceConnectionState === 'failed' ||
          pc.iceConnectionState === 'disconnected' ||
          pc.iceConnectionState === 'closed'
        ) {
          entry.rtcConnected = false;
        }
      };

      pc.ontrack = (ev) => {
        if (this.disposed) return;
        const stream =
          ev.streams && ev.streams[0]
            ? ev.streams[0]
            : new MediaStream([ev.track]);
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

    // Workaround essencial do Chromium: um HTMLAudioElement mutado precisa puxar o fluxo WebRTC
    // para que `createMediaStreamSource` receba amostras continuamente no Web Audio 3D!
    if (typeof Audio !== 'undefined') {
      try {
        if (entry.pullAudioEl) {
          entry.pullAudioEl.srcObject = null;
        }
        const pull = new Audio();
        pull.srcObject = stream;
        pull.muted = true;
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
      srcNode.connect(entry.filterNode);
      entry.streamSourceNode = srcNode;
    } catch {
      // Ignorar
    }
  }

  async handleIncomingSignal(payload: VoiceSignalPayload): Promise<void> {
    if (
      this.disposed ||
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
      !payload ||
      payload.fromId === this.hooks.localPlayerId ||
      !payload.muLawB64
    ) {
      return;
    }

    this.ensurePeer(payload.fromId);
    const entry = this.peers.get(payload.fromId);
    if (!entry || entry.rtcConnected) return;
    if (entry.lastAudibleGain <= 0.002) return;

    const ctx = this.ensureAudioContext();
    if (!ctx) return;
    this.resumeAudioContextIfNeeded();

    try {
      const pcm = decodeMuLawBase64ToPcm(payload.muLawB64);
      if (pcm.length === 0) return;
      const rate = Math.max(4000, Math.min(48000, payload.sampleRate || 8000));
      const audioBuf = ctx.createBuffer(1, pcm.length, rate);
      audioBuf.getChannelData(0).set(pcm);

      const src = ctx.createBufferSource();
      src.buffer = audioBuf;
      src.connect(entry.filterNode);

      const now = ctx.currentTime;
      if (
        entry.nextRelayPlayTime < now ||
        entry.nextRelayPlayTime > now + 0.45
      ) {
        entry.nextRelayPlayTime = now + 0.035;
      }
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

    try {
      entry.streamSourceNode?.disconnect();
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
   * 1) Medidor de energia vocal do microfone local + gate anti-ruído;
   * 2) Posição e orientação 3D do ouvinte (`AudioListener`);
   * 3) Posição 3D HRTF, distância e abafamento por paredes de cada aliado conectado!
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
    }>
  ): void {
    if (this.disposed) return;

    // 1. Mede nível de voz local se o microfone estiver armado e autorizado
    if (
      this.isMicArmed &&
      this.permissionState === 'granted' &&
      this.analyserNode
    ) {
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
      // Combina RMS + pico vocal com curva sensível para fala natural e gritos
      const rawLevel = Math.min(1, Math.max(rms * 4.2, peak * 1.35));
      const smoothing = rawLevel > this.smoothedVoiceLevel ? 18 : 8.5;
      this.smoothedVoiceLevel +=
        (rawLevel - this.smoothedVoiceLevel) * Math.min(1, dt * smoothing);

      const gateThreshold =
        this.mode === 'PTT' || this.pttHeld
          ? VOICE_NOISE_GATE_THRESHOLD * 0.65
          : VOICE_NOISE_GATE_THRESHOLD;
      const nextSpeaking = this.smoothedVoiceLevel >= gateThreshold;
      if (nextSpeaking !== this.speakingNow) {
        this.speakingNow = nextSpeaking;
        this.syncOutboundGate();
      }
    } else {
      this.smoothedVoiceLevel = Math.max(0, this.smoothedVoiceLevel - dt * 10);
      if (this.speakingNow) {
        this.speakingNow = false;
        this.syncOutboundGate();
      }
    }

    const ctx = this.audioCtx;
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

      // Posição da boca/capacete do aliado (~1.58m de altura quando em pé)
      const headX = rp.pos.x;
      const headY = rp.pos.y + 1.55;
      const headZ = rp.pos.z;

      if (typeof entry.pannerNode.positionX !== 'undefined') {
        entry.pannerNode.positionX.setTargetAtTime(headX, tNow, 0.03);
        entry.pannerNode.positionY.setTargetAtTime(headY, tNow, 0.03);
        entry.pannerNode.positionZ.setTargetAtTime(headZ, tNow, 0.03);
      } else {
        entry.pannerNode.setPosition(headX, headY, headZ);
      }

      if (rp.dead) {
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
      const acoustics = computeProximityVoiceAcousticParams(dist, walls);

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
