import * as THREE from 'three';
import type { DoomAmbientZone } from '../../doom/DoomAmbientZones';

export type FloorMaterialKind = 'tech' | 'stone';

export interface LabyrinthSoundAcoustics {
  dryGain: number;
  wetSendGain: number;
  lowpassHz: number;
  audible: boolean;
}

export interface FootstepLayerProfile {
  heelBaseHz: number;
  heelEndHz: number;
  heelGain: number;
  surfaceModesHz: readonly [number, number, number];
  gritBandHz: number;
  gritGain: number;
  suitRustleGain: number;
  reverbSendRatio: number;
  lowpassCutoffHz: number;
  limpScuffGain: number;
}

export interface SpiderStepLayerProfile {
  subWeightHz: number;
  subWeightGain: number;
  clawStrikeHz: number;
  clawStrikeQ: number;
  clawStrikeGain: number;
  jointClickHz: number;
  jointDelaySec: number;
  metallicModesHz: readonly [number, number, number] | null;
  lowpassHz: number;
  dryGain: number;
  wetSendGain: number;
  audible: boolean;
}

/**
 * Calcula de forma pura a atenuação por distância, o corte de agudos por oclusão de paredes
 * (`wallCount`) e o balanço Dry / Reverb (Wet) de qualquer som 3D propagando pelos corredores!
 */
export function computeLabyrinthSoundAcoustics(
  distanceMeters: number,
  maxDistanceMeters: number,
  wallCount = 0
): LabyrinthSoundAcoustics {
  if (
    !Number.isFinite(distanceMeters) ||
    !Number.isFinite(maxDistanceMeters) ||
    maxDistanceMeters <= 0 ||
    distanceMeters >= maxDistanceMeters
  ) {
    return {
      dryGain: 0,
      wetSendGain: 0,
      lowpassHz: 320,
      audible: false,
    };
  }

  const d = Math.max(0, distanceMeters);
  const norm = Math.min(1, d / maxDistanceMeters);
  // Queda acústica natural com presença nítida a curta distância e cauda suave no corredor
  const inv = 1 - norm;
  const distCurve = Math.pow(inv, 1.58) * (0.84 + 0.16 * inv);

  const walls = Math.max(0, Math.floor(wallCount));
  let wallDryMul = 1.0;
  let wallWetMul = 1.0;
  let lowpassHz = 15_800;

  if (walls === 0) {
    // Absorção natural do ar ao longo do corredor aberto
    const airT = Math.min(1, Math.max(0, (d - 4.0) / Math.max(4.0, maxDistanceMeters - 4.0)));
    lowpassHz = Math.round(15_800 - airT * 8_600);
  } else if (walls === 1) {
    wallDryMul = 0.44;
    wallWetMul = 0.76;
    lowpassHz = 1_650;
  } else if (walls === 2) {
    wallDryMul = 0.2;
    wallWetMul = 0.52;
    lowpassHz = 820;
  } else {
    wallDryMul = 0.085;
    wallWetMul = 0.3;
    lowpassHz = 430;
  }

  // Quanto mais distante no corredor, maior a proporção relativa de reverberação das paredes
  const distanceWetBoost = 0.42 + 0.58 * Math.min(1, norm * 1.35);
  const dryGain = distCurve * wallDryMul;
  const wetSendGain = distCurve * distanceWetBoost * wallWetMul;

  return {
    dryGain,
    wetSendGain,
    lowpassHz,
    audible: dryGain > 0.0025 || wetSendGain > 0.0035,
  };
}

/**
 * Calcula o perfil físico multicamada de um passo humano em traje EVA sobre piso metálico (`tech`) ou pedra (`stone`).
 */
export function computeFootstepLayerProfile(
  surface: FloorMaterialKind,
  sprinting: boolean,
  crouching: boolean,
  altFoot: boolean,
  stepVariantIndex = 0,
  injured = false
): FootstepLayerProfile {
  const footRatio = altFoot ? 1.035 : 0.968;
  const variantMod = 0.97 + ((Math.abs(stepVariantIndex) % 5) * 0.015);
  const pitchScale = footRatio * variantMod;

  const stanceGain = crouching ? 0.36 : sprinting ? 1.3 : 1.0;
  const heelBaseHz =
    (surface === 'tech' ? 118 : 92) *
    (crouching ? 0.82 : sprinting ? 1.08 : 1.0) *
    pitchScale;
  const heelEndHz = surface === 'tech' ? 35 : 27;

  const surfaceModesHz: readonly [number, number, number] =
    surface === 'tech'
      ? [
          Math.round(216 * pitchScale),
          Math.round(372 * pitchScale),
          Math.round(598 * pitchScale),
        ]
      : [
          Math.round(142 * pitchScale),
          Math.round(238 * pitchScale),
          Math.round(364 * pitchScale),
        ];

  const gritBandHz =
    (surface === 'tech' ? 2_380 : 1_720) *
    (crouching ? 0.64 : sprinting ? 1.14 : 1.0) *
    pitchScale;

  return {
    heelBaseHz,
    heelEndHz,
    heelGain: 0.21 * stanceGain,
    surfaceModesHz,
    gritBandHz,
    gritGain: (surface === 'tech' ? 0.135 : 0.155) * stanceGain,
    suitRustleGain: crouching ? 0.022 : sprinting ? 0.072 : 0.044,
    reverbSendRatio: crouching ? 0.22 : sprinting ? 0.85 : 0.56,
    lowpassCutoffHz: crouching ? 1_350 : sprinting ? 11_500 : 7_800,
    limpScuffGain: injured && altFoot && !crouching ? 0.085 * stanceGain : 0,
  };
}

/**
 * Calcula o perfil acústico de uma pata quitinosa da Aranha Gigante tocando pedra ou grade metálica/teto,
 * incluindo peso sub-grave, impacto de garra, estalo articular e oclusão pelas paredes!
 */
export function computeSpiderStepLayerProfile(
  distanceMeters: number,
  frantic: boolean,
  onMetalOrCeiling: boolean,
  wallCount = 0
): SpiderStepLayerProfile {
  const maxDist = frantic ? 26.0 : 22.0;
  const acoustics = computeLabyrinthSoundAcoustics(
    distanceMeters,
    maxDist,
    wallCount
  );

  if (!acoustics.audible) {
    return {
      subWeightHz: 68,
      subWeightGain: 0,
      clawStrikeHz: 2_000,
      clawStrikeQ: 2.5,
      clawStrikeGain: 0,
      jointClickHz: 260,
      jointDelaySec: 0.014,
      metallicModesHz: null,
      lowpassHz: acoustics.lowpassHz,
      dryGain: 0,
      wetSendGain: 0,
      audible: false,
    };
  }

  const energy = frantic ? 1.65 : 1.0;
  return {
    subWeightHz: frantic ? 82 : 66,
    subWeightGain: (frantic ? 0.19 : 0.095),
    clawStrikeHz: (onMetalOrCeiling ? 3_150 : 2_180) * (frantic ? 1.14 : 1.0),
    clawStrikeQ: onMetalOrCeiling ? 3.6 : 2.3,
    clawStrikeGain: 0.145 * energy,
    jointClickHz: onMetalOrCeiling ? 410 : 255,
    jointDelaySec: frantic ? 0.011 : 0.016,
    metallicModesHz: onMetalOrCeiling ? [442, 836, 1_490] : null,
    lowpassHz: acoustics.lowpassHz,
    dryGain: acoustics.dryGain,
    wetSendGain: acoustics.wetSendGain,
    audible: true,
  };
}

/** Subtle procedural room tones: electrical hum, ventilation and pressure variation. */
export interface DoomAmbientProfile {
  fundamental: number;
  harmonic: number;
  noiseFrequency: number;
  noiseQ: number;
  humGain: number;
  noiseGain: number;
  modulationHz: number;
}

export const DOOM_AMBIENT_PROFILES: Readonly<Record<DoomAmbientZone, DoomAmbientProfile>> = {
  industrial:      { fundamental: 48, harmonic: 72, noiseFrequency: 230, noiseQ: 0.75, humGain: 0.010, noiseGain: 0.012, modulationHz: 0.11 },
  atrium:          { fundamental: 55, harmonic: 83, noiseFrequency: 330, noiseQ: 0.65, humGain: 0.009, noiseGain: 0.015, modulationHz: 0.09 },
  catacombs:       { fundamental: 36, harmonic: 54, noiseFrequency: 140, noiseQ: 0.65, humGain: 0.009, noiseGain: 0.012, modulationHz: 0.06 },
  nest:            { fundamental: 32, harmonic: 48.5, noiseFrequency: 100, noiseQ: 0.8, humGain: 0.016, noiseGain: 0.016, modulationHz: 0.18 },
  computer_room:   { fundamental: 60, harmonic: 120, noiseFrequency: 620, noiseQ: 1.4, humGain: 0.013, noiseGain: 0.014, modulationHz: 0.28 },
  biology_lab:     { fundamental: 72, harmonic: 108, noiseFrequency: 370, noiseQ: 1.0, humGain: 0.009, noiseGain: 0.017, modulationHz: 0.15 },
  crew_quarters:   { fundamental: 44, harmonic: 66, noiseFrequency: 170, noiseQ: 0.65, humGain: 0.007, noiseGain: 0.008, modulationHz: 0.07 },
  medical_ward:    { fundamental: 98, harmonic: 147, noiseFrequency: 490, noiseQ: 0.85, humGain: 0.008, noiseGain: 0.012, modulationHz: 0.12 },
  vegetation_room: { fundamental: 42, harmonic: 63, noiseFrequency: 820, noiseQ: 0.6, humGain: 0.006, noiseGain: 0.021, modulationHz: 0.21 },
  library_room:    { fundamental: 38, harmonic: 57, noiseFrequency: 190, noiseQ: 0.6, humGain: 0.005, noiseGain: 0.007, modulationHz: 0.05 },
  reactor_hall:    { fundamental: 56, harmonic: 112, noiseFrequency: 155, noiseQ: 1.8, humGain: 0.018, noiseGain: 0.019, modulationHz: 0.32 },
};

/**
 * Motor de Áudio Unificado (SoundEngine) — síntese física e Foley procedural multicamada
 * em tempo real para o Terminal TUI, Convergência Binária, Labirinto DOOM, Sobrevivência e Co-op.
 *
 * Cadeia de processamento (DSP):
 *   [Vozes / Foley / Oclusão de Paredes + Pan Estéreo]
 *      ├── Dry Bus ───────────────────────────────────────┐
 *      └── Convolver Reverb (Corredor 1.65s + HPF 68Hz) ──┼──► Analog Saturation ─► Compressor ─► Master
 */
export class SoundEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private terminalBus: GainNode | null = null;
  private worldDryBus: GainNode | null = null;
  private reverbSend: GainNode | null = null;
  private reverbReturn: GainNode | null = null;

  private noiseBuffer: AudioBuffer | null = null;
  private pinkNoiseBuffer: AudioBuffer | null = null;
  private grittyNoiseBuffer: AudioBuffer | null = null;
  private crackleNoiseBuffer: AudioBuffer | null = null;

  // Tensão contínua da Convergência Binária
  private coalesceDroneGain: GainNode | null = null;
  private coalesceDroneFilter: BiquadFilterNode | null = null;
  private coalesceOscA: OscillatorNode | null = null;
  private coalesceOscB: OscillatorNode | null = null;
  private lastGrainMs = 0;

  // Ambiência da abertura do terminal (aba abrindo -> tela inicial)
  private bootBedGain: GainNode | null = null;
  private bootBedFilter: BiquadFilterNode | null = null;
  private bootBedOscA: OscillatorNode | null = null;
  private bootBedOscB: OscillatorNode | null = null;
  private terminalHumGain: GainNode | null = null;
  private terminalHumOsc: OscillatorNode | null = null;
  private terminalHumOscB: OscillatorNode | null = null;
  private titlePadGain: GainNode | null = null;
  private titlePadOscillators: OscillatorNode[] = [];
  private titleThemeBus: GainNode | null = null;
  private titlePadFilter: BiquadFilterNode | null = null;
  private titlePadNoise: AudioBufferSourceNode | null = null;
  private titleMelodyTimer = 0;
  private titleMelodyOscillators: OscillatorNode[] = [];
  private titleThemeToken = 0;
  private readonly titleThemeLevel = 1.0;

  // Ambiência espacial e industrial do Labirinto DOOM
  private dungeonStarted = false;
  private dungeonActive = false;
  private dungeonPendingActivation = false;
  private dungeonBus: GainNode | null = null;
  private dungeonAirGain: GainNode | null = null;
  private ambientZone: DoomAmbientZone | null = null;
  private ambientOscA: OscillatorNode | null = null;
  private ambientOscB: OscillatorNode | null = null;
  private ambientHumGain: GainNode | null = null;
  private ambientNoiseFilter: BiquadFilterNode | null = null;
  private ambientNoiseGain: GainNode | null = null;
  private ambientLfo: OscillatorNode | null = null;
  private ambientLfoDepth: GainNode | null = null;
  private lampBuzzGain: GainNode | null = null;
  private lampBuzzPanner: StereoPannerNode | null = null;
  private flareBurnGain: GainNode | null = null;
  private flareBurnPanner: StereoPannerNode | null = null;
  private flareBurnFilter: BiquadFilterNode | null = null;
  private pulseTimerId = 0;

  // Controle de cadência e variação orgânica (evita repetição mecânica)
  private footstepVariantCounter = 0;
  private spiderStepVariantCounter = 0;
  private lastWallThudMs = 0;
  private lastCrouchMs = 0;
  private lastSlideMs = 0;
  private lastSparkMs = 0;
  private lastFlarePopMs = 0;
  private lastSpiderStepMs = 0;
  private lastSpiderChitterMs = 0;
  private lastSpiderScreamMs = 0;
  private lastHeartbeatMs = 0;
  private lastSprintBreathMs = 0;
  private lastRadioSquelchMs = 0;

  // Preferências do menu de Configurações (0..1)
  private userMasterGain = 0.82;
  private userSfxGain = 0.94;
  private userUiGain = 0.9;
  private userReverbSendGain = 0.4624;
  private mutedByFocusLoss = false;
  private worldPaused = false;

  get isWorldPaused(): boolean {
    return this.worldPaused;
  }

  get debugGainState(): {
    masterGain: number;
    sfxGain: number;
    uiGain: number;
    reverbSendGain: number;
    effectiveWorldDryGain: number;
    effectiveReverbSendGain: number;
    effectiveUiGain: number;
    worldPaused: boolean;
    mutedByFocusLoss: boolean;
  } {
    return {
      masterGain: this.mutedByFocusLoss ? 0 : this.userMasterGain,
      sfxGain: this.userSfxGain,
      uiGain: this.userUiGain,
      reverbSendGain: this.userReverbSendGain,
      effectiveWorldDryGain: this.worldPaused ? 0 : this.userSfxGain,
      effectiveReverbSendGain: this.worldPaused ? 0 : this.userReverbSendGain,
      effectiveUiGain: this.userUiGain,
      worldPaused: this.worldPaused,
      mutedByFocusLoss: this.mutedByFocusLoss,
    };
  }

  /**
   * Atualiza os volumes configurados pelo jogador em porcentagem `[0..100]`.
   */
  setUserAudioSettings(opts: {
    masterVolume: number;
    sfxVolume: number;
    uiVolume: number;
    reverbAmount: number;
    mutedByFocus?: boolean;
  }): void {
    const clampPct01 = (v: number): number =>
      Number.isFinite(v) ? Math.max(0, Math.min(1, v / 100)) : 0.8;
    this.userMasterGain = clampPct01(opts.masterVolume);
    this.userSfxGain = clampPct01(opts.sfxVolume);
    this.userUiGain = clampPct01(opts.uiVolume);
    this.userReverbSendGain = clampPct01(opts.reverbAmount) * 0.68;
    if (typeof opts.mutedByFocus === 'boolean') {
      this.mutedByFocusLoss = opts.mutedByFocus;
    }
    this.applyUserGainsToGraph();
  }

  setFocusMuted(muted: boolean): void {
    if (this.mutedByFocusLoss === muted) return;
    this.mutedByFocusLoss = muted;
    this.applyUserGainsToGraph();
  }

  /**
   * Congela/silencia suavemente todos os barramentos do mundo 3D (`worldDryBus`, `reverbSend`,
   * zumbido de lâmpadas, sinalizadores e vento subterrâneo) enquanto o Menu de Pausa Solo está aberto,
   * preservando 100% de nitidez nos sons táteis de interface (`terminalBus`)!
   */
  setWorldPaused(paused: boolean): void {
    if (this.worldPaused === paused) return;
    this.worldPaused = paused;
    this.applyUserGainsToGraph();
    if (this.ctx) {
      const now = this.ctx.currentTime;
      if (paused) {
        this.rampGainParam(this.lampBuzzGain?.gain ?? null, 0, now, 0.012);
        this.rampGainParam(this.flareBurnGain?.gain ?? null, 0, now, 0.012);
        this.rampGainParam(this.dungeonAirGain?.gain ?? null, 0, now, 0.015);
      } else if (this.dungeonActive) {
        this.rampGainParam(
          this.dungeonAirGain?.gain ?? null,
          0.0085,
          now,
          0.04
        );
      }
    }
  }

  private rampGainParam(
    param: AudioParam | null,
    target: number,
    now: number,
    timeConstantSec = 0.014
  ): void {
    if (!param) return;
    const safeTarget = Number.isFinite(target)
      ? Math.max(0, Math.min(2, target))
      : 0;
    try {
      param.cancelScheduledValues(now);
      const cur = Number.isFinite(param.value) ? param.value : safeTarget;
      param.setValueAtTime(cur, now);
      if (this.ctx && this.ctx.state === 'running' && timeConstantSec > 0.001) {
        param.setTargetAtTime(safeTarget, now, timeConstantSec);
      } else {
        param.value = safeTarget;
      }
    } catch {
      param.value = safeTarget;
    }
  }

  private applyUserGainsToGraph(immediate = false): void {
    const now = this.ctx ? this.ctx.currentTime : 0;
    const tc = immediate ? 0 : 0.014;

    const targetMaster = this.mutedByFocusLoss ? 0 : this.userMasterGain;
    const targetWorldDry = this.worldPaused ? 0 : this.userSfxGain;
    const targetUi = this.userUiGain;
    const targetReverb = this.worldPaused ? 0 : this.userReverbSendGain;
    const targetReverbReturn = this.worldPaused ? 0 : 0.68;

    this.rampGainParam(this.masterGain?.gain ?? null, targetMaster, now, tc);
    this.rampGainParam(
      this.worldDryBus?.gain ?? null,
      targetWorldDry,
      now,
      tc
    );
    this.rampGainParam(this.terminalBus?.gain ?? null, targetUi, now, tc);
    this.rampGainParam(this.reverbSend?.gain ?? null, targetReverb, now, tc);
    this.rampGainParam(
      this.reverbReturn?.gain ?? null,
      targetReverbReturn,
      now,
      tc
    );
  }

  unlock(): void {
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!AudioCtx) return;

      const ctx = new AudioCtx();
      this.ctx = ctx;
      this.setupMasterGraph(ctx);
    }

    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
  }

  private isRunning(): boolean {
    this.unlock();
    return Boolean(this.ctx && this.ctx.state === 'running');
  }

  private setupMasterGraph(ctx: AudioContext): void {
    const master = ctx.createGain();
    master.gain.value = 0.82;
    master.connect(ctx.destination);
    this.masterGain = master;

    // Compressor mestre transparente para colar transientes pesados sem distorção digital
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -15;
    comp.knee.value = 14;
    comp.ratio.value = 3.6;
    comp.attack.value = 0.003;
    comp.release.value = 0.16;
    comp.connect(master);

    // Saturação analógica quente (harmônicos pares/ímpares suaves)
    const shaper = ctx.createWaveShaper();
    shaper.curve = this.createWarmCurve(1024);
    shaper.oversample = '2x';
    shaper.connect(comp);

    const terminalBus = ctx.createGain();
    terminalBus.gain.value = 0.9;
    terminalBus.connect(shaper);
    this.terminalBus = terminalBus;

    const worldDry = ctx.createGain();
    worldDry.gain.value = 0.94;
    worldDry.connect(shaper);
    this.worldDryBus = worldDry;

    // Reverb convolucional estéreo realista de corredor subterrâneo de pedra e aço (1.65s)
    const convolver = ctx.createConvolver();
    convolver.buffer = this.buildStoneCorridorImpulse(ctx, 1.65);

    const reverbSend = ctx.createGain();
    reverbSend.gain.value = 0.46;
    reverbSend.connect(convolver);

    // Filtro passa-altas no retorno do reverb para manter os sub-graves dos passos secos e firmes!
    const reverbHpf = ctx.createBiquadFilter();
    reverbHpf.type = 'highpass';
    reverbHpf.frequency.value = 68;
    reverbHpf.Q.value = 0.7;

    const reverbReturn = ctx.createGain();
    reverbReturn.gain.value = 0.68;
    convolver.connect(reverbHpf);
    reverbHpf.connect(reverbReturn);
    reverbReturn.connect(shaper);
    this.reverbSend = reverbSend;
    this.reverbReturn = reverbReturn;
    this.applyUserGainsToGraph(true);

    // Quatro buffers procedurais com texturas físicas distintas (1.4s cada, zero alocação em runtime)
    this.noiseBuffer = this.buildWhiteNoiseBuffer(ctx, 1.4);
    this.pinkNoiseBuffer = this.buildPinkNoiseBuffer(ctx, 1.4);
    this.grittyNoiseBuffer = this.buildGrittyNoiseBuffer(ctx, 1.4, 3);
    this.crackleNoiseBuffer = this.buildCrackleNoiseBuffer(ctx, 1.4);
  }

  private createWarmCurve(samples: number): Float32Array<ArrayBuffer> {
    const buf = new ArrayBuffer(samples * 4);
    const curve = new Float32Array(buf);
    const k = 1.65;
    const norm = Math.tanh(k);
    for (let i = 0; i < samples; i++) {
      const x = (i * 2) / (samples - 1) - 1;
      curve[i] = Math.tanh(k * x) / norm;
    }
    return curve;
  }

  /**
   * Resposta ao impulso binaural/estéreo com reflexões iniciais descorrelacionadas L/R
   * (simulando paredes laterais de um corredor de 3.4m) + cauda escura com absorção progressiva.
   */
  private buildStoneCorridorImpulse(
    ctx: AudioContext,
    seconds: number
  ): AudioBuffer {
    const rate = ctx.sampleRate;
    const length = Math.floor(rate * seconds);
    const impulse = ctx.createBuffer(2, length, rate);

    const earlyTaps: ReadonlyArray<readonly [number, number, number]> = [
      [0.009, 0.42, -0.35],
      [0.017, -0.36, 0.39],
      [0.028, 0.31, 0.27],
      [0.043, -0.25, -0.29],
      [0.064, 0.2, -0.22],
      [0.091, -0.15, 0.17],
    ];

    for (let ch = 0; ch < 2; ch++) {
      const data = impulse.getChannelData(ch);
      let lpFast = 0;
      let lpWarm = 0;
      for (let i = 0; i < length; i++) {
        const t = i / rate;
        const u = t / seconds;
        const envHigh = Math.pow(Math.max(0, 1 - u * 1.65), 3.1);
        const envLowMid = Math.pow(Math.max(0, 1 - u), 2.35);
        const white = Math.random() * 2 - 1;

        const dampFast = Math.max(0.06, 0.54 - u * 0.38);
        lpFast += (white - lpFast) * dampFast;
        lpWarm += (lpFast - lpWarm) * 0.12;

        data[i] = (lpFast * envHigh * 0.26 + lpWarm * envLowMid * 0.34);
      }

      for (const [delaySec, gainL, gainR] of earlyTaps) {
        const jitterSec = ch === 0 ? 0 : 0.0029;
        const offset = Math.floor((delaySec + jitterSec) * rate);
        const tapGain = ch === 0 ? gainL : gainR;
        if (offset < length) {
          data[offset] += tapGain;
          if (offset + 1 < length) data[offset + 1] += tapGain * 0.45;
        }
      }
    }

    return impulse;
  }

  private buildWhiteNoiseBuffer(ctx: AudioContext, seconds: number): AudioBuffer {
    const len = Math.floor(ctx.sampleRate * seconds);
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    return buffer;
  }

  /** Ruído rosa (-3dB/oitava, algoritmo Paul Kellet) natural para tecido, fôlego, vento e ambiência */
  private buildPinkNoiseBuffer(ctx: AudioContext, seconds: number): AudioBuffer {
    const len = Math.floor(ctx.sampleRate * seconds);
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let b0 = 0;
    let b1 = 0;
    let b2 = 0;
    let b3 = 0;
    let b4 = 0;
    let b5 = 0;
    let b6 = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.96900 * b2 + white * 0.1538520;
      b3 = 0.86650 * b3 + white * 0.3104856;
      b4 = 0.55000 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.0168980;
      const pink = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362;
      b6 = white * 0.115926;
      data[i] = Math.max(-1, Math.min(1, pink * 0.18));
    }
    return buffer;
  }

  private buildGrittyNoiseBuffer(
    ctx: AudioContext,
    seconds: number,
    holdSamples: number
  ): AudioBuffer {
    const len = Math.floor(ctx.sampleRate * seconds);
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let current = 0;
    for (let i = 0; i < len; i++) {
      if (i % holdSamples === 0) {
        current = Math.round((Math.random() * 2 - 1) * 20) / 20;
      }
      data[i] = current;
    }
    return buffer;
  }

  /** Buffer granular esparso para pedregulhos sob a bota, faíscas, estalos de quitina e seda rasgando */
  private buildCrackleNoiseBuffer(ctx: AudioContext, seconds: number): AudioBuffer {
    const len = Math.floor(ctx.sampleRate * seconds);
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let env = 0;
    let sign = 1;
    for (let i = 0; i < len; i++) {
      if (Math.random() < 0.018) {
        env = 0.45 + Math.random() * 0.55;
        sign = Math.random() < 0.5 ? -1 : 1;
      }
      env *= 0.86;
      const fine = (Math.random() * 2 - 1) * 0.22;
      data[i] = Math.max(-1, Math.min(1, sign * env + fine));
    }
    return buffer;
  }

  /**
   * Cria um nó espacializado descartável com Pan Estéreo + Filtro Passa-Baixas de Oclusão de Parede
   * + envios separados Dry / Reverb Wet!
   */
  private createSpatialWorldSink(
    pan: number,
    acoustics: LabyrinthSoundAcoustics
  ): AudioNode | null {
    if (
      this.worldPaused ||
      !this.ctx ||
      !this.worldDryBus ||
      !this.reverbSend ||
      !acoustics.audible
    ) {
      return null;
    }

    const occlusionFilter = this.ctx.createBiquadFilter();
    occlusionFilter.type = 'lowpass';
    occlusionFilter.frequency.value = acoustics.lowpassHz;
    occlusionFilter.Q.value = 0.65;

    const panner = this.ctx.createStereoPanner();
    panner.pan.value = Math.max(-0.95, Math.min(0.95, pan));

    const dryGain = this.ctx.createGain();
    dryGain.gain.value = acoustics.dryGain;

    const wetGain = this.ctx.createGain();
    wetGain.gain.value = acoustics.wetSendGain;

    occlusionFilter.connect(panner);
    panner.connect(dryGain);
    panner.connect(wetGain);
    dryGain.connect(this.worldDryBus);
    wetGain.connect(this.reverbSend);

    return occlusionFilter;
  }

  // ==========================================================================
  // 1. EFEITOS SONOROS DO TERMINAL & ÁREA DE TRABALHO TUI
  // ==========================================================================

  /** Tique mecânico de cabeça de leitura + impressão de linha no boot */
  bootLine(): void {
    if (!this.isRunning() || !this.ctx || !this.terminalBus) return;
    const now = this.ctx.currentTime;

    this.triggerFilteredNoise(
      this.terminalBus,
      now,
      0.018,
      1950,
      2.4,
      0.095,
      'white'
    );

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(480, now);
    osc.frequency.exponentialRampToValueAtTime(195, now + 0.026);

    gain.gain.setValueAtTime(0.068, now);
    gain.gain.exponentialRampToValueAtTime(0.0008, now + 0.03);

    osc.connect(gain);
    gain.connect(this.terminalBus);
    osc.start(now);
    osc.stop(now + 0.032);
  }

  // --------------------------------------------------------------------------
  // Ambiência contínua da abertura: cada camada entra devagar e sustenta o som
  // enquanto a janela, as partículas e o menu se formam na tela.
  // --------------------------------------------------------------------------

  /**
   * Zumbido de fundo do terminal. Entra com fade longo e vai ganhando corpo
   * conforme a janela/aba termina de abrir (`intensity` de 0 a 1).
   */
  startTerminalPowerBed(intensity = 0.35): void {
    if (!this.isRunning() || !this.ctx || !this.terminalBus) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    this.stopTerminalPowerBed(0.4);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(0.008 + intensity * 0.028, now + 1.2);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(220, now);
    filter.frequency.linearRampToValueAtTime(420 + intensity * 260, now + 1.6);
    filter.Q.value = 1.2;

    const oscA = ctx.createOscillator();
    oscA.type = 'sawtooth';
    oscA.frequency.setValueAtTime(48.5, now);
    oscA.frequency.linearRampToValueAtTime(54.5, now + 1.4);

    const oscB = ctx.createOscillator();
    oscB.type = 'triangle';
    oscB.frequency.setValueAtTime(72.8, now);

    oscA.connect(filter);
    oscB.connect(filter);
    filter.connect(gain);
    gain.connect(this.terminalBus);
    oscA.start(now);
    oscB.start(now);

    this.terminalHumGain = gain;
    this.terminalHumOsc = oscA;
    this.terminalHumOscB = oscB;
  }

  /** Encerra o zumbido do terminal com fade (usado ao trocar de camada). */
  stopTerminalPowerBed(fadeSeconds = 0.6): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const gain = this.terminalHumGain;
    const oscA = this.terminalHumOsc;
    const oscB = this.terminalHumOscB;
    this.terminalHumGain = null;
    this.terminalHumOsc = null;
    this.terminalHumOscB = null;
    if (!gain) return;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setTargetAtTime(0.0001, now, Math.max(0.02, fadeSeconds / 3));
    window.setTimeout(() => {
      try {
        oscA?.stop();
        oscB?.stop();
        gain.disconnect();
      } catch {
        // já encerrados
      }
    }, Math.ceil(fadeSeconds * 1000) + 120);
  }

  /**
   * Sopro/ruído de formação: acompanha as partículas que condensam o cenário.
   * O `progress` (0 a 1) abre o filtro e sobe o volume devagar.
   */
  startBootBed(progress = 0): void {
    if (!this.isRunning() || !this.ctx || !this.terminalBus) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    this.stopBootBed(0.5);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(0.012 + progress * 0.05, now + 1.5);

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 0.9;
    filter.frequency.setValueAtTime(320, now);
    filter.frequency.linearRampToValueAtTime(900 + progress * 1500, now + 1.8);

    const oscA = ctx.createOscillator();
    oscA.type = 'sine';
    oscA.frequency.setValueAtTime(110, now);
    oscA.frequency.linearRampToValueAtTime(146.8, now + 2.4);

    const oscB = ctx.createOscillator();
    oscB.type = 'triangle';
    oscB.frequency.setValueAtTime(164.8, now);

    oscA.connect(filter);
    filter.connect(gain);
    gain.connect(this.terminalBus);
    oscA.start(now);

    this.bootBedGain = gain;
    this.bootBedFilter = filter;
    this.bootBedOscA = oscA;
    this.bootBedOscB = oscB;
  }

  /** Atualiza a intensidade do sopro de formação (0 a 1). */
  updateBootBed(progress: number): void {
    if (!this.ctx || !this.bootBedGain || !this.bootBedFilter) return;
    const now = this.ctx.currentTime;
    const p = Math.max(0, Math.min(1, progress));
    this.bootBedGain.gain.setTargetAtTime(0.012 + p * 0.055, now, 0.35);
    this.bootBedFilter.frequency.setTargetAtTime(320 + p * 2100, now, 0.35);
  }

  stopBootBed(fadeSeconds = 0.8): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const gain = this.bootBedGain;
    const oscA = this.bootBedOscA;
    const oscB = this.bootBedOscB;
    this.bootBedGain = null;
    this.bootBedFilter = null;
    this.bootBedOscA = null;
    this.bootBedOscB = null;
    if (!gain) return;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setTargetAtTime(0.0001, now, Math.max(0.02, fadeSeconds / 3));
    window.setTimeout(() => {
      try {
        oscA?.stop();
        oscB?.stop();
        gain.disconnect();
      } catch {
        // já encerrados
      }
    }, Math.ceil(fadeSeconds * 1000) + 120);
  }

  /**
   * Trilha da tela inicial.
   *
   * Um acorde de Lá menor aberto (fundamental, quinta, oitava, terça e nona)
   * entra por baixo do menu em camadas: cada voz tem o próprio envelope, um
   * `detune` levemente desafinado (coro analógico) e a respiração de um LFO
   * lento. O filtro abre devagar e o convolver do corredor de pedra dá a cauda,
   * então a tela ganha um ambiente contínuo em vez de um zumbido estático.
   *
   * A trilha vive no próprio `titleThemeBus`, o que permite mantê-la tocando
   * durante a navegação do menu e silenciá-la com fade quando a partida começa.
   */
  startTitlePad(volume = 0.55): void {
    if (!this.isRunning() || !this.ctx || !this.terminalBus) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    this.stopTitlePad(0.6);

    // O tema tem um barramento próprio (usado para abafar sem interromper) e,
    // dentro dele, um nível para o colchão harmônico e outro para o motivo.
    const themeBus = ctx.createGain();
    themeBus.gain.value = 0.0001;
    themeBus.gain.linearRampToValueAtTime(1, now + 3.2);
    themeBus.connect(this.terminalBus);
    this.titleThemeBus = themeBus;

    // Nível calibrado para o pad ficar audível sem mascarar os efeitos de UI.
    const padBus = ctx.createGain();
    padBus.gain.value = 0.028 + volume * 0.062;
    padBus.connect(themeBus);

    // Colchão grave: filtro abre aos poucos e o LFO dá a respiração do ambiente.
    const bodyFilter = ctx.createBiquadFilter();
    bodyFilter.type = 'lowpass';
    bodyFilter.frequency.setValueAtTime(210, now);
    bodyFilter.frequency.linearRampToValueAtTime(760, now + 5.4);
    bodyFilter.Q.value = 0.92;
    bodyFilter.connect(padBus);
    this.titlePadFilter = bodyFilter;

    const airFilter = ctx.createBiquadFilter();
    airFilter.type = 'bandpass';
    airFilter.Q.value = 0.62;
    airFilter.frequency.setValueAtTime(480, now);
    airFilter.frequency.linearRampToValueAtTime(1650, now + 6.2);
    const airGain = ctx.createGain();
    airGain.gain.setValueAtTime(0.0001, now);
    airGain.gain.linearRampToValueAtTime(0.16, now + 5.0);
    airFilter.connect(airGain);
    airGain.connect(padBus);

    // Envelopes por voz: o acorde se monta de baixo para cima, sem ataque.
    const voices: Array<{
      freq: number;
      type: OscillatorType;
      level: number;
      pan: number;
      detune: number;
      delay: number;
    }> = [
      { freq: 55.0, type: 'sine', level: 0.95, pan: 0, detune: -4, delay: 0 },
      { freq: 82.41, type: 'triangle', level: 0.42, pan: -0.26, detune: 3, delay: 0.7 },
      { freq: 110.0, type: 'sine', level: 0.4, pan: 0.22, detune: -6, delay: 1.3 },
      { freq: 164.81, type: 'sine', level: 0.26, pan: -0.34, detune: 5, delay: 1.9 },
      { freq: 220.0, type: 'triangle', level: 0.16, pan: 0.3, detune: -3, delay: 2.5 },
      { freq: 261.63, type: 'sine', level: 0.09, pan: -0.12, detune: 7, delay: 3.1 },
    ];

    const oscillators: OscillatorNode[] = [];
    for (const voice of voices) {
      const osc = ctx.createOscillator();
      osc.type = voice.type;
      osc.frequency.setValueAtTime(voice.freq, now);
      osc.detune.setValueAtTime(voice.detune, now);

      const panner = ctx.createStereoPanner();
      panner.pan.setValueAtTime(voice.pan, now);

      const voiceGain = ctx.createGain();
      voiceGain.gain.setValueAtTime(0.0001, now + voice.delay);
      voiceGain.gain.linearRampToValueAtTime(voice.level, now + voice.delay + 3.4);

      // Coro lento: cada voz respira em um ritmo próprio.
      const lfo = ctx.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.setValueAtTime(0.045 + voice.delay * 0.012, now);
      const lfoDepth = ctx.createGain();
      lfoDepth.gain.setValueAtTime(4.5, now);
      lfo.connect(lfoDepth);
      lfoDepth.connect(osc.detune);
      lfo.start(now);
      oscillators.push(lfo);

      osc.connect(voiceGain);
      voiceGain.connect(panner);
      if (voice.freq > 200) {
        panner.connect(airFilter);
      } else {
        panner.connect(bodyFilter);
      }
      osc.start(now);
      oscillators.push(osc);
    }

    // Sopro sutil de ar da sala, só para o pad não soar sintético demais.
    if (this.pinkNoiseBuffer) {
      const air = ctx.createBufferSource();
      air.buffer = this.pinkNoiseBuffer;
      air.loop = true;
      const noiseFilter = ctx.createBiquadFilter();
      noiseFilter.type = 'bandpass';
      noiseFilter.frequency.setValueAtTime(620, now);
      noiseFilter.frequency.linearRampToValueAtTime(1180, now + 7.5);
      noiseFilter.Q.value = 0.7;
      const noiseGain = ctx.createGain();
      noiseGain.gain.setValueAtTime(0.0001, now);
      noiseGain.gain.linearRampToValueAtTime(0.052, now + 6.4);
      air.connect(noiseFilter);
      noiseFilter.connect(noiseGain);
      noiseGain.connect(padBus);
      air.start(now);
      this.titlePadNoise = air;
    }

    if (this.reverbSend) themeBus.connect(this.reverbSend);
    this.titlePadGain = themeBus;
    this.titlePadOscillators = oscillators;

    this.startTitleThemeMelody(volume, now);
  }

  /**
   * Motivo lento e esparso sobre o pad: uma nota a cada poucos segundos, em
   * Lá menor natural, com eco no corredor. Entra depois do acorde, como um
   * instrumento distante na trilha.
   */
  private startTitleThemeMelody(volume: number, now: number): void {
    if (!this.ctx || !this.titleThemeBus) return;
    const ctx = this.ctx;
    const melody: Array<[number, number, number]> = [
      [0, 440.0, 0.09],
      [3.6, 329.63, 0.078],
      [7.4, 392.0, 0.072],
      [11.2, 349.23, 0.066],
      [15.0, 440.0, 0.08],
      [19.2, 293.66, 0.07],
      [23.4, 329.63, 0.064],
    ];
    const startAt = now + 2.4;
    const token = ++this.titleThemeToken;
    let loopOffset = 0;
    const played: OscillatorNode[] = [];
    const schedulePass = (): void => {
      if (!this.ctx || !this.titleThemeBus || token !== this.titleThemeToken) return;
      for (const [offset, freq, level] of melody) {
        const at = startAt + loopOffset + offset;
        const osc = ctx.createOscillator();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, at);
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.0001, at);
        gain.gain.linearRampToValueAtTime(level * (0.34 + volume * 0.45), at + 0.9);
        gain.gain.exponentialRampToValueAtTime(0.0001, at + 3.6);
        const panner = ctx.createStereoPanner();
        panner.pan.setValueAtTime(0.18, at);
        osc.connect(gain);
        gain.connect(panner);
        panner.connect(this.titleThemeBus);
        if (this.reverbSend) panner.connect(this.reverbSend);
        osc.start(at);
        osc.stop(at + 3.8);
        played.push(osc);
      }
      loopOffset += 26.5;
      this.titleMelodyTimer = window.setTimeout(() => {
        if (token !== this.titleThemeToken) return;
        schedulePass();
      }, 25_500);
    };
    this.titleMelodyOscillators = played;
    schedulePass();
  }

  stopTitlePad(fadeSeconds = 1.2): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const gain = this.titlePadGain;
    const oscillators = this.titlePadOscillators;
    const noise = this.titlePadNoise;
    this.titlePadGain = null;
    this.titlePadOscillators = [];
    this.titlePadNoise = null;
    this.titleThemeBus = null;
    this.titlePadFilter = null;
    this.titleThemeToken += 1;
    const melody = this.titleMelodyOscillators;
    if (this.titleMelodyTimer) {
      window.clearTimeout(this.titleMelodyTimer);
      this.titleMelodyTimer = 0;
    }
    this.titleMelodyOscillators = [];
    if (!gain) return;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setTargetAtTime(0.0001, now, Math.max(0.02, fadeSeconds / 3));
    window.setTimeout(() => {
      for (const osc of [...oscillators, ...melody]) {
        try {
          osc.stop();
        } catch {
          // já encerrados
        }
      }
      try {
        noise?.stop();
        gain.disconnect();
      } catch {
        // já desconectado
      }
    }, Math.ceil(fadeSeconds * 1000) + 150);
  }

  /** Abafa a trilha (sem encerrá-la) enquanto um submenu cobre a tela. */
  duckTitleTheme(amount = 0.45, seconds = 0.5): void {
    if (!this.ctx || !this.titleThemeBus) return;
    const now = this.ctx.currentTime;
    const target = Math.max(0.0001, this.titleThemeLevel * amount);
    this.titleThemeBus.gain.cancelScheduledValues(now);
    this.titleThemeBus.gain.setTargetAtTime(target, now, Math.max(0.05, seconds / 3));
    // Abafar também escurece o timbre: a trilha vira fundo, não compete com o submenu.
    this.titlePadFilter?.frequency.setTargetAtTime(430, now, Math.max(0.05, seconds / 3));
  }

  /** Devolve a trilha ao volume normal depois de fechar o submenu. */
  unduckTitleTheme(seconds = 0.7): void {
    if (!this.ctx || !this.titleThemeBus) return;
    const now = this.ctx.currentTime;
    this.titleThemeBus.gain.cancelScheduledValues(now);
    this.titleThemeBus.gain.setTargetAtTime(this.titleThemeLevel, now, Math.max(0.05, seconds / 3));
    this.titlePadFilter?.frequency.setTargetAtTime(760, now, Math.max(0.05, seconds / 3));
  }

  /** Nota curta de hover/seleção do menu, afinada com a trilha da tela inicial. */
  titleMenuGlide(direction: 1 | -1 = 1): void {
    if (!this.isRunning() || !this.ctx || !this.terminalBus) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const base = direction > 0 ? 440.0 : 329.63;
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(base, now);
    osc.frequency.exponentialRampToValueAtTime(direction > 0 ? base * 1.5 : base * 0.75, now + 0.16);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(0.05, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.28);
    const panner = ctx.createStereoPanner();
    panner.pan.setValueAtTime(direction > 0 ? 0.22 : -0.22, now);
    osc.connect(gain);
    gain.connect(panner);
    panner.connect(this.terminalBus);
    if (this.reverbSend) panner.connect(this.reverbSend);
    osc.start(now);
    osc.stop(now + 0.3);
  }

  /** Avanço da barra de progresso combinando pulso harmônico + micro-seek de disco rígido */
  loadingStep(pct: number): void {
    if (!this.isRunning() || !this.ctx || !this.terminalBus) return;
    const now = this.ctx.currentTime;

    this.triggerFilteredNoise(
      this.terminalBus,
      now,
      0.012,
      1380 + pct * 6,
      3.1,
      0.085,
      'crackle'
    );
    this.triggerFilteredNoise(
      this.terminalBus,
      now + 0.026,
      0.01,
      1720 + pct * 5,
      3.3,
      0.06,
      'white'
    );

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(255 + pct * 2.5, now);

    gain.gain.setValueAtTime(0.062, now);
    gain.gain.exponentialRampToValueAtTime(0.0008, now + 0.044);

    osc.connect(gain);
    gain.connect(this.terminalBus);
    osc.start(now);
    osc.stop(now + 0.048);
  }

  /** Acorde curto e limpo de inicialização concluída ao abrir a Área de Trabalho */
  desktopReady(): void {
    if (!this.isRunning() || !this.ctx || !this.terminalBus) return;
    const now = this.ctx.currentTime;

    const notes = [330, 495, 660, 990];
    notes.forEach((freq, idx) => {
      if (!this.ctx || !this.terminalBus) return;
      const t = now + idx * 0.058;

      const osc = this.ctx.createOscillator();
      const filter = this.ctx.createBiquadFilter();
      const gain = this.ctx.createGain();

      osc.type = idx === 3 ? 'sine' : 'triangle';
      osc.frequency.setValueAtTime(freq, t);

      filter.type = 'lowpass';
      filter.frequency.value = 2400;

      gain.gain.setValueAtTime(idx === 3 ? 0.045 : 0.075, t);
      gain.gain.exponentialRampToValueAtTime(0.0008, t + 0.21);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(this.terminalBus);
      osc.start(t);
      osc.stop(t + 0.22);
    });
  }

  /** Tecla mecânica IBM Model-M / switch tátil multicamada (click + mola + "thock" no chassi) */
  keyType(isSpace = false): void {
    if (!this.isRunning() || !this.ctx || !this.terminalBus) return;
    const now = this.ctx.currentTime;
    const jitter = 0.94 + Math.random() * 0.12;

    // Camada 1: Atuação nítida da folha metálica do switch
    this.triggerFilteredNoise(
      this.terminalBus,
      now,
      0.008,
      (isSpace ? 2350 : 3550) * jitter,
      2.7,
      0.135,
      'white'
    );

    // Camada 2: Impacto grave ("thock") da keycap em PBT batendo na chapa
    const body = this.ctx.createOscillator();
    const bodyGain = this.ctx.createGain();
    body.type = 'triangle';
    const f0 = (isSpace ? 148 : 228) * jitter;
    body.frequency.setValueAtTime(f0, now);
    body.frequency.exponentialRampToValueAtTime(62, now + 0.026);

    bodyGain.gain.setValueAtTime(isSpace ? 0.105 : 0.08, now);
    bodyGain.gain.exponentialRampToValueAtTime(0.0008, now + 0.028);

    body.connect(bodyGain);
    bodyGain.connect(this.terminalBus);
    body.start(now);
    body.stop(now + 0.03);
  }

  keyBackspace(): void {
    if (!this.isRunning() || !this.ctx || !this.terminalBus) return;
    const now = this.ctx.currentTime;

    this.triggerFilteredNoise(
      this.terminalBus,
      now,
      0.015,
      1900,
      2.1,
      0.125,
      'white'
    );

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(172, now);
    osc.frequency.exponentialRampToValueAtTime(58, now + 0.034);

    gain.gain.setValueAtTime(0.09, now);
    gain.gain.exponentialRampToValueAtTime(0.0008, now + 0.036);

    osc.connect(gain);
    gain.connect(this.terminalBus);
    osc.start(now);
    osc.stop(now + 0.039);
  }

  keyEnter(): void {
    if (!this.isRunning() || !this.ctx || !this.terminalBus) return;
    const now = this.ctx.currentTime;

    this.triggerFilteredNoise(
      this.terminalBus,
      now,
      0.019,
      2550,
      1.9,
      0.15,
      'white'
    );

    const freqs = [295, 442];
    freqs.forEach((f, idx) => {
      if (!this.ctx || !this.terminalBus) return;
      const t = now + idx * 0.021;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(f, t);
      osc.frequency.exponentialRampToValueAtTime(f * 0.72, t + 0.046);

      gain.gain.setValueAtTime(0.078, t);
      gain.gain.exponentialRampToValueAtTime(0.0008, t + 0.052);

      osc.connect(gain);
      gain.connect(this.terminalBus);
      osc.start(t);
      osc.stop(t + 0.056);
    });
  }

  menuMove(): void {
    if (!this.isRunning() || !this.ctx || !this.terminalBus) return;
    const now = this.ctx.currentTime;

    this.triggerFilteredNoise(
      this.terminalBus,
      now,
      0.007,
      3650,
      3.4,
      0.075,
      'white'
    );

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(810, now);
    osc.frequency.exponentialRampToValueAtTime(510, now + 0.019);

    gain.gain.setValueAtTime(0.052, now);
    gain.gain.exponentialRampToValueAtTime(0.0008, now + 0.021);

    osc.connect(gain);
    gain.connect(this.terminalBus);
    osc.start(now);
    osc.stop(now + 0.023);
  }

  windowOpen(): void {
    if (!this.isRunning() || !this.ctx || !this.terminalBus) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(320, now);
    osc.frequency.exponentialRampToValueAtTime(560, now + 0.058);

    gain.gain.setValueAtTime(0.078, now);
    gain.gain.exponentialRampToValueAtTime(0.0008, now + 0.062);

    osc.connect(gain);
    gain.connect(this.terminalBus);
    osc.start(now);
    osc.stop(now + 0.066);
  }

  windowFrameStep(
    stepIndex: number,
    totalSteps: number,
    expanding = true
  ): void {
    if (!this.isRunning() || !this.ctx || !this.terminalBus) return;
    const now = this.ctx.currentTime;
    const u =
      totalSteps > 1 ? stepIndex / (totalSteps - 1) : expanding ? 1 : 0;
    const ratio = expanding ? u : 1 - u;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(220 + ratio * 310, now);

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 1250;

    gain.gain.setValueAtTime(0.024, now);
    gain.gain.exponentialRampToValueAtTime(0.0008, now + 0.018);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.terminalBus);
    osc.start(now);
    osc.stop(now + 0.02);
  }

  invalidInput(): void {
    if (!this.isRunning() || !this.ctx || !this.terminalBus) return;
    const now = this.ctx.currentTime;
    for (let i = 0; i < 2; i++) {
      const t = now + i * 0.08;
      const osc = this.ctx.createOscillator();
      const filter = this.ctx.createBiquadFilter();
      const gain = this.ctx.createGain();

      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(145 - i * 18, t);

      filter.type = 'lowpass';
      filter.frequency.value = 680;

      gain.gain.setValueAtTime(0.088, t);
      gain.gain.exponentialRampToValueAtTime(0.0008, t + 0.062);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(this.terminalBus);
      osc.start(t);
      osc.stop(t + 0.066);
    }
  }

  // ==========================================================================
  // 2. CONVERGÊNCIA BINÁRIA & INTERFACE SUPERHOT (out_of_frame.exe)
  // ==========================================================================

  startBinaryProgramSequence(): void {
    if (!this.isRunning() || !this.ctx || !this.terminalBus) return;
    const now = this.ctx.currentTime;

    const sub = this.ctx.createOscillator();
    const subGain = this.ctx.createGain();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(146.8, now);
    sub.frequency.exponentialRampToValueAtTime(73.4, now + 0.45);
    subGain.gain.setValueAtTime(0.14, now);
    subGain.gain.exponentialRampToValueAtTime(0.0008, now + 0.5);
    sub.connect(subGain);
    subGain.connect(this.terminalBus);
    sub.start(now);
    sub.stop(now + 0.52);

    this.stopCoalesceDrone();
    const droneGain = this.ctx.createGain();
    droneGain.gain.value = 0.0001;
    droneGain.connect(this.terminalBus);
    this.coalesceDroneGain = droneGain;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 110;
    filter.Q.value = 2.4;
    filter.connect(droneGain);
    this.coalesceDroneFilter = filter;

    const oscA = this.ctx.createOscillator();
    oscA.type = 'sawtooth';
    oscA.frequency.value = 73.42;
    oscA.connect(filter);
    oscA.start(now);
    this.coalesceOscA = oscA;

    const oscB = this.ctx.createOscillator();
    oscB.type = 'triangle';
    oscB.frequency.value = 110.0;
    oscB.connect(filter);
    oscB.start(now);
    this.coalesceOscB = oscB;
  }

  binaryCoalesceGrain(progress: number, lockedFraction: number): void {
    if (!this.isRunning() || !this.ctx || !this.terminalBus) return;
    const now = this.ctx.currentTime;

    if (this.coalesceDroneGain && this.coalesceDroneFilter) {
      this.coalesceDroneGain.gain.setTargetAtTime(
        0.005 + progress * 0.016,
        now,
        0.06
      );
      this.coalesceDroneFilter.frequency.setTargetAtTime(
        110 + Math.pow(progress, 1.7) * 950,
        now,
        0.06
      );
    }

    const nowMs = performance.now();
    const minGapMs = 170 - progress * 134;
    if (nowMs - this.lastGrainMs < minGapMs) return;
    this.lastGrainMs = nowMs;

    const scale = [293.66, 329.63, 440.0, 587.33, 659.25, 880.0, 1174.66];
    const maxIdx = Math.min(
      scale.length - 1,
      Math.floor(1 + lockedFraction * (scale.length - 1))
    );
    const freq = scale[Math.floor(Math.random() * (maxIdx + 1))];

    const panner = this.ctx.createStereoPanner();
    const spread = (1 - lockedFraction) * 0.85;
    panner.pan.value = (Math.random() * 2 - 1) * spread;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = lockedFraction > 0.6 ? 'triangle' : 'sine';
    osc.frequency.setValueAtTime(freq, now);

    const vol = 0.028 + progress * 0.04;
    gain.gain.setValueAtTime(vol, now);
    gain.gain.exponentialRampToValueAtTime(0.0008, now + 0.045);

    osc.connect(gain);
    gain.connect(panner);
    panner.connect(this.terminalBus);
    if (this.reverbSend) {
      panner.connect(this.reverbSend);
    }
    osc.start(now);
    osc.stop(now + 0.05);
  }

  interfaceLocked(): void {
    this.stopCoalesceDrone();
    if (!this.isRunning() || !this.ctx || !this.terminalBus) return;
    const now = this.ctx.currentTime;

    this.triggerFilteredNoise(
      this.terminalBus,
      now,
      0.032,
      2900,
      1.6,
      0.16,
      'white'
    );

    const chord = [73.42, 146.83, 220.0, 440.0];
    chord.forEach((f, idx) => {
      if (!this.ctx || !this.terminalBus) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = idx === 0 ? 'sine' : 'triangle';
      osc.frequency.setValueAtTime(f, now);

      gain.gain.setValueAtTime(idx === 0 ? 0.16 : 0.065, now);
      gain.gain.exponentialRampToValueAtTime(0.0008, now + 0.34);

      osc.connect(gain);
      gain.connect(this.terminalBus);
      if (this.reverbSend && idx > 0) {
        gain.connect(this.reverbSend);
      }
      osc.start(now);
      osc.stop(now + 0.36);
    });
  }

  stopCoalesceDrone(): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    if (this.coalesceDroneGain) {
      this.coalesceDroneGain.gain.setTargetAtTime(0.0001, now, 0.04);
    }
    const a = this.coalesceOscA;
    const b = this.coalesceOscB;
    this.coalesceOscA = null;
    this.coalesceOscB = null;
    this.coalesceDroneGain = null;
    this.coalesceDroneFilter = null;
    window.setTimeout(() => {
      try {
        a?.stop();
        b?.stop();
      } catch {
        // já encerrados
      }
    }, 140);
  }

  shutdown(): void {
    this.stopCoalesceDrone();
    if (!this.isRunning() || !this.ctx || !this.terminalBus) return;
    const now = this.ctx.currentTime;

    this.triggerFilteredNoise(
      this.terminalBus,
      now,
      0.025,
      1400,
      1.8,
      0.15,
      'white'
    );

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(310, now);
    osc.frequency.exponentialRampToValueAtTime(34, now + 0.52);

    gain.gain.setValueAtTime(0.15, now);
    gain.gain.exponentialRampToValueAtTime(0.0008, now + 0.55);

    osc.connect(gain);
    gain.connect(this.terminalBus);
    osc.start(now);
    osc.stop(now + 0.56);

    if (this.masterGain) {
      this.masterGain.gain.setTargetAtTime(0.0001, now + 0.35, 0.08);
    }
  }

  // ==========================================================================
  // 3. TRANSIÇÃO E PAISAGEM SONORA DO LABIRINTO ESTILO DOOM / TERROR ESPACIAL
  // ==========================================================================

  enterDoomLabyrinth(): void {
    this.stopCoalesceDrone();
    this.worldPaused = false;
    this.dungeonActive = true;
    this.dungeonPendingActivation = true;
    if (!this.isRunning() || !this.ctx || !this.worldDryBus || !this.reverbSend) {
      this.applyUserGainsToGraph(true);
      return;
    }
    const ctx = this.ctx;
    const now = ctx.currentTime;

    this.applyUserGainsToGraph();

    // Comporta hidráulica pesada de airlock/elevador fechando atrás do jogador
    this.triggerFilteredNoise(
      this.worldDryBus,
      now,
      0.44,
      280,
      1.15,
      0.28,
      'gritty',
      this.reverbSend
    );
    this.triggerFilteredNoise(
      this.worldDryBus,
      now + 0.08,
      0.18,
      1650,
      2.4,
      0.11,
      'pink',
      this.reverbSend
    );

    const boom = ctx.createOscillator();
    const boomGain = ctx.createGain();
    boom.type = 'sawtooth';
    boom.frequency.setValueAtTime(86.0, now);
    boom.frequency.exponentialRampToValueAtTime(38.0, now + 0.62);

    const boomFilter = ctx.createBiquadFilter();
    boomFilter.type = 'lowpass';
    boomFilter.frequency.setValueAtTime(640, now);
    boomFilter.frequency.exponentialRampToValueAtTime(125, now + 0.62);

    boomGain.gain.setValueAtTime(0.24, now);
    boomGain.gain.exponentialRampToValueAtTime(0.0008, now + 0.66);

    boom.connect(boomFilter);
    boomFilter.connect(boomGain);
    boomGain.connect(this.worldDryBus);
    boomGain.connect(this.reverbSend);
    boom.start(now);
    boom.stop(now + 0.68);

    this.activateDungeonAtmosphere(ctx);
  }

  private activateDungeonAtmosphere(ctx: AudioContext): void {
    if (!this.dungeonStarted) {
      this.dungeonStarted = true;
      this.startDungeonAtmosphere(ctx);
    } else if (this.dungeonBus) {
      const now = ctx.currentTime;
      this.rampGainParam(this.dungeonBus.gain, 1.0, now + 0.08, 0.35);
      if (!this.worldPaused) {
        this.rampGainParam(this.dungeonAirGain?.gain ?? null, 0.0085, now + 0.08, 0.35);
      }
      this.ensureDungeonPulseTimer();
    }
    this.dungeonPendingActivation = false;
  }

  stopDungeonAtmosphere(): void {
    this.dungeonActive = false;
    this.dungeonPendingActivation = false;
    this.ambientZone = null;
    this.worldPaused = false;
    if (this.pulseTimerId) {
      window.clearInterval(this.pulseTimerId);
      this.pulseTimerId = 0;
    }
    this.applyUserGainsToGraph();
    if (this.ctx && this.dungeonBus) {
      const now = this.ctx.currentTime;
      this.rampGainParam(this.dungeonBus.gain, 0.0001, now, 0.1);
      this.rampGainParam(this.dungeonAirGain?.gain ?? null, 0, now, 0.08);
      this.rampGainParam(this.lampBuzzGain?.gain ?? null, 0, now, 0.06);
      this.rampGainParam(this.flareBurnGain?.gain ?? null, 0, now, 0.06);
    }
  }

  /**
   * Atmosfera subterrânea densa:
   * - Sub-drone industrial escuro (E1 + B1);
   * - Corrente de ar de ventilação nos túneis (ruído rosa filtrado);
   * - Zumbido espacializado de reator fluorescente 120Hz/240Hz nas luminárias LITE5;
   * - Combustão contínua espacializada quando há sinalizador de magnésio aceso no chão;
   * - Eventos distantes ocasionais (rangido estrutural metálico ou gota d'água na pedra).
   */
  private startDungeonAtmosphere(ctx: AudioContext): void {
    if (!this.worldDryBus || !this.reverbSend) return;

    const bus = ctx.createGain();
    bus.gain.setValueAtTime(0.001, ctx.currentTime);
    bus.gain.setTargetAtTime(1.0, ctx.currentTime + 0.15, 0.8);
    bus.connect(this.worldDryBus);
    this.dungeonBus = bus;

    // 1. Sub-drone escuro subterrâneo
    const droneFilter = ctx.createBiquadFilter();
    droneFilter.type = 'lowpass';
    droneFilter.frequency.value = 118;
    droneFilter.Q.value = 1.65;

    const droneGain = ctx.createGain();
    droneGain.gain.value = 0.012;
    droneFilter.connect(droneGain);
    droneGain.connect(bus);

    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.type = 'sine';
    lfo.frequency.value = 0.09;
    lfoGain.gain.value = 30;
    lfo.connect(lfoGain);
    lfoGain.connect(droneFilter.frequency);
    lfo.start();

    const d1 = ctx.createOscillator();
    d1.type = 'sine';
    d1.frequency.value = 41.2;
    d1.connect(droneFilter);
    d1.start();

    const d2 = ctx.createOscillator();
    d2.type = 'triangle';
    d2.frequency.value = 61.74;
    d2.connect(droneFilter);
    d2.start();

    // 2. Corrente de ar subterrânea suave em ruído rosa
    if (this.pinkNoiseBuffer) {
      const air = ctx.createBufferSource();
      air.buffer = this.pinkNoiseBuffer;
      air.loop = true;

      const airFilter = ctx.createBiquadFilter();
      airFilter.type = 'bandpass';
      airFilter.frequency.value = 195;
      airFilter.Q.value = 0.75;

      const airGain = ctx.createGain();
      airGain.gain.value = 0.0085;
      this.dungeonAirGain = airGain;

      air.connect(airFilter);
      airFilter.connect(airGain);
      airGain.connect(this.reverbSend);
      air.start();
    }

    // 3. Zumbido de reator elétrico (120Hz + harmônico 240Hz) das luminárias LITE5
    const lampGain = ctx.createGain();
    lampGain.gain.value = 0;
    const lampPan = ctx.createStereoPanner();
    lampGain.connect(lampPan);
    lampPan.connect(bus);
    this.lampBuzzGain = lampGain;
    this.lampBuzzPanner = lampPan;

    const buzzFilter = ctx.createBiquadFilter();
    buzzFilter.type = 'bandpass';
    buzzFilter.frequency.value = 320;
    buzzFilter.Q.value = 2.2;
    buzzFilter.connect(lampGain);

    const buzzOscA = ctx.createOscillator();
    buzzOscA.type = 'sawtooth';
    buzzOscA.frequency.value = 120;
    const buzzAWeight = ctx.createGain();
    buzzAWeight.gain.value = 0.65;
    buzzOscA.connect(buzzAWeight);
    buzzAWeight.connect(buzzFilter);
    buzzOscA.start();

    const buzzOscB = ctx.createOscillator();
    buzzOscB.type = 'triangle';
    buzzOscB.frequency.value = 240.3;
    const buzzBWeight = ctx.createGain();
    buzzBWeight.gain.value = 0.35;
    buzzOscB.connect(buzzBWeight);
    buzzBWeight.connect(buzzFilter);
    buzzOscB.start();

    // 4. Canal espacializado para combustão contínua de Sinalizador de Magnésio no chão!
    if (this.pinkNoiseBuffer) {
      const flareSrc = ctx.createBufferSource();
      flareSrc.buffer = this.pinkNoiseBuffer;
      flareSrc.loop = true;

      const flareFilter = ctx.createBiquadFilter();
      flareFilter.type = 'bandpass';
      flareFilter.frequency.value = 2_150;
      flareFilter.Q.value = 0.95;

      const flareGain = ctx.createGain();
      flareGain.gain.value = 0;

      const flarePan = ctx.createStereoPanner();
      flareSrc.connect(flareFilter);
      flareFilter.connect(flareGain);
      flareGain.connect(flarePan);
      flarePan.connect(bus);
      flarePan.connect(this.reverbSend);
      flareSrc.start();

      this.flareBurnFilter = flareFilter;
      this.flareBurnGain = flareGain;
      this.flareBurnPanner = flarePan;
    }

    // Fonte única por mundo, reutilizada em todas as transições de sala.
    this.startAmbientZoneGraph(ctx, bus);

    // 5. Micro-eventos ambientais distantes nos corredores (gotas na pedra / dilatação metálica)
    this.ensureDungeonPulseTimer();
  }

  private startAmbientZoneGraph(ctx: AudioContext, bus: GainNode): void {
    const hum = ctx.createGain();
    hum.gain.value = 0;
    hum.connect(bus);
    const oscA = ctx.createOscillator();
    oscA.type = 'sine';
    oscA.frequency.value = 48;
    oscA.connect(hum);
    oscA.start();
    const oscB = ctx.createOscillator();
    oscB.type = 'triangle';
    oscB.frequency.value = 72;
    const harmonicWeight = ctx.createGain();
    harmonicWeight.gain.value = 0.35;
    oscB.connect(harmonicWeight);
    harmonicWeight.connect(hum);
    oscB.start();
    this.ambientOscA = oscA;
    this.ambientOscB = oscB;
    this.ambientHumGain = hum;

    if (this.pinkNoiseBuffer) {
      const source = ctx.createBufferSource();
      source.buffer = this.pinkNoiseBuffer;
      source.loop = true;
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 230;
      filter.Q.value = 0.75;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      source.connect(filter);
      filter.connect(gain);
      gain.connect(bus);
      source.start();
      const lfo = ctx.createOscillator();
      const depth = ctx.createGain();
      depth.gain.value = 0;
      lfo.frequency.value = 0.11;
      lfo.connect(depth);
      depth.connect(gain.gain);
      lfo.start();
      this.ambientNoiseFilter = filter;
      this.ambientNoiseGain = gain;
      this.ambientLfo = lfo;
      this.ambientLfoDepth = depth;
    }
  }

  /** Called locally per listener; no network state or extra audio sources per transition. */
  setDoomAmbientZone(zone: DoomAmbientZone): void {
    if (!this.dungeonActive || !DOOM_AMBIENT_PROFILES[zone]) return;
    // A browser may finish unlocking the context after the game was entered.
    if (this.dungeonPendingActivation || !this.dungeonStarted) {
      if (!this.isRunning() || !this.ctx || !this.worldDryBus || !this.reverbSend) return;
      this.activateDungeonAtmosphere(this.ctx);
    }
    if (!this.ctx || this.ambientZone === zone) return;
    this.ambientZone = zone;
    const profile = DOOM_AMBIENT_PROFILES[zone];
    const now = this.ctx.currentTime;
    const ramp = (param: AudioParam | undefined, target: number) => {
      if (!param) return;
      param.cancelScheduledValues(now);
      param.setValueAtTime(param.value, now);
      param.setTargetAtTime(target, now, 1.2);
    };
    ramp(this.ambientOscA?.frequency, profile.fundamental);
    ramp(this.ambientOscB?.frequency, profile.harmonic);
    ramp(this.ambientHumGain?.gain, profile.humGain);
    ramp(this.ambientNoiseFilter?.frequency, profile.noiseFrequency);
    ramp(this.ambientNoiseFilter?.Q, profile.noiseQ);
    ramp(this.ambientNoiseGain?.gain, profile.noiseGain);
    ramp(this.ambientLfo?.frequency, profile.modulationHz);
    ramp(this.ambientLfoDepth?.gain, profile.noiseGain * 0.28);
  }

  private ensureDungeonPulseTimer(): void {
    if (this.pulseTimerId) return;
    this.pulseTimerId = window.setInterval(() => {
      if (
        !this.ctx ||
        this.ctx.state !== 'running' ||
        !this.reverbSend ||
        !this.dungeonBus ||
        !this.dungeonActive ||
        this.worldPaused
      ) {
        return;
      }
      if (this.dungeonBus.gain.value < 0.2) return;
      const roll = Math.random();
      if (roll > 0.62) return;

      const t = this.ctx.currentTime;
      const pan = this.ctx.createStereoPanner();
      pan.pan.value = (Math.random() * 2 - 1) * 0.82;
      pan.connect(this.reverbSend);

      if (roll < 0.28) {
        // Gota d'água distante pingando em poça de pedra fria
        const drop = this.ctx.createOscillator();
        const dg = this.ctx.createGain();
        const f0 = 920 + Math.random() * 680;
        drop.type = 'sine';
        drop.frequency.setValueAtTime(f0 * 0.72, t);
        drop.frequency.exponentialRampToValueAtTime(f0 * 1.48, t + 0.042);
        dg.gain.setValueAtTime(0.0001, t);
        dg.gain.linearRampToValueAtTime(0.016, t + 0.006);
        dg.gain.exponentialRampToValueAtTime(0.0006, t + 0.065);
        drop.connect(dg);
        dg.connect(pan);
        drop.start(t);
        drop.stop(t + 0.07);
      } else {
        // Rangido/pulso estrutural metálico distante na tubulação da base
        const notes = [41.2, 43.65, 55.0, 61.74];
        const baseF = notes[Math.floor(Math.random() * notes.length)];
        const osc = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(baseF * 1.02, t);
        osc.frequency.exponentialRampToValueAtTime(baseF * 0.96, t + 1.75);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(0.017, t + 0.18);
        g.gain.exponentialRampToValueAtTime(0.0006, t + 1.85);
        osc.connect(g);
        g.connect(pan);
        osc.start(t);
        osc.stop(t + 1.9);
      }
    }, 5800);
  }

  // ==========================================================================
  // 4. PASSOS MULTICAMADA DO JOGADOR, TRAJE EVA & ALIADOS 3D
  // ==========================================================================

  /**
   * Passo em 1ª pessoa multicamada com física de superfície real (`tech` vs `stone`),
   * postura (`crouching`, caminhada, `sprinting`), micro-variação orgânica e arrasto sutil se ferido!
   *
   * As 4 micro-camadas físicas:
   *  1. Impacto grave do calcanhar da bota pesada EVA (0ms);
   *  2. Ressonância modal da chapa metálica (`tech`) ou corpo da alvenaria (`stone`) (+4ms);
   *  3. Textura de sola/pedregulhos sob pressão (+14ms) + arrasto de pé ferido opcional (+28ms);
   *  4. Roçar orgânico do tecido pressurizado e fivelas do traje de astronauta (+20ms).
   */
  playLabyrinthFootstep(
    altFoot: boolean,
    surface: FloorMaterialKind,
    sprinting: boolean,
    crouching = false,
    injured = false
  ): void {
    if (
      this.worldPaused ||
      !this.isRunning() ||
      !this.ctx ||
      !this.worldDryBus ||
      !this.reverbSend
    ) {
      return;
    }

    const variant = this.footstepVariantCounter++;
    const profile = computeFootstepLayerProfile(
      surface,
      sprinting,
      crouching,
      altFoot,
      variant,
      injured
    );

    const now = this.ctx.currentTime;
    const microPan = altFoot ? 0.08 : -0.08;

    const stepLowpass = this.ctx.createBiquadFilter();
    stepLowpass.type = 'lowpass';
    stepLowpass.frequency.value = profile.lowpassCutoffHz;
    stepLowpass.Q.value = 0.7;

    const panner = this.ctx.createStereoPanner();
    panner.pan.value = microPan;

    const dryOut = this.ctx.createGain();
    dryOut.gain.value = 1.0;

    const wetOut = this.ctx.createGain();
    wetOut.gain.value = profile.reverbSendRatio;

    stepLowpass.connect(panner);
    panner.connect(dryOut);
    panner.connect(wetOut);
    dryOut.connect(this.worldDryBus);
    wetOut.connect(this.reverbSend);

    // Camada 1: Impacto grave da bota (ataque suave se agachado, pancada firme ao correr)
    const heel = this.ctx.createOscillator();
    const heelGain = this.ctx.createGain();
    heel.type = surface === 'tech' ? 'triangle' : 'sine';
    heel.frequency.setValueAtTime(profile.heelBaseHz, now);
    heel.frequency.exponentialRampToValueAtTime(
      profile.heelEndHz,
      now + (crouching ? 0.095 : 0.082)
    );

    if (crouching) {
      heelGain.gain.setValueAtTime(0.001, now);
      heelGain.gain.linearRampToValueAtTime(profile.heelGain, now + 0.009);
    } else {
      heelGain.gain.setValueAtTime(profile.heelGain, now);
    }
    heelGain.gain.exponentialRampToValueAtTime(0.0008, now + 0.098);

    heel.connect(heelGain);
    heelGain.connect(stepLowpass);
    heel.start(now);
    heel.stop(now + 0.104);

    // Camada 2: Ressonância modal do piso (chapa oca de aço em `tech` vs impacto abafado de pedra em `stone`)
    const modeDur = surface === 'tech' ? 0.068 : 0.044;
    const modeBaseGain =
      (surface === 'tech' ? 0.036 : 0.022) *
      (crouching ? 0.28 : sprinting ? 1.25 : 0.85);
    profile.surfaceModesHz.forEach((hz, idx) => {
      if (!this.ctx) return;
      const tMode = now + 0.003 + idx * 0.002;
      const modeOsc = this.ctx.createOscillator();
      const modeGain = this.ctx.createGain();
      modeOsc.type = surface === 'tech' && idx === 1 ? 'triangle' : 'sine';
      modeOsc.frequency.setValueAtTime(hz, tMode);
      modeOsc.frequency.exponentialRampToValueAtTime(
        hz * (surface === 'tech' ? 0.92 : 0.74),
        tMode + modeDur
      );

      modeGain.gain.setValueAtTime(modeBaseGain / (idx + 1), tMode);
      modeGain.gain.exponentialRampToValueAtTime(0.0006, tMode + modeDur);

      modeOsc.connect(modeGain);
      modeGain.connect(stepLowpass);
      modeOsc.start(tMode);
      modeOsc.stop(tMode + modeDur + 0.006);
    });

    // Camada 3: Aderência da sola + micro-grãos de areia/pedra (`crackle`) ou grade metálica (`gritty`)
    const soleDelay = crouching ? 0.016 : 0.011;
    this.triggerFilteredNoise(
      stepLowpass,
      now + soleDelay,
      surface === 'tech' ? 0.046 : 0.058,
      profile.gritBandHz,
      surface === 'tech' ? 2.4 : 1.45,
      profile.gritGain,
      surface === 'stone' ? 'crackle' : 'gritty'
    );

    if (surface === 'tech' && !crouching) {
      // Tinido agudo discreto de grelha industrial sob o peso da bota
      this.triggerFilteredNoise(
        stepLowpass,
        now + 0.004,
        0.024,
        3_450 + (variant % 3) * 240,
        4.2,
        sprinting ? 0.055 : 0.032,
        'white'
      );
    }

    // Arrasto sutil da ponta da bota quando gravemente ferido (mancando)
    if (profile.limpScuffGain > 0.001) {
      this.triggerFilteredNoise(
        stepLowpass,
        now + 0.032,
        0.095,
        surface === 'stone' ? 980 : 1_320,
        1.2,
        profile.limpScuffGain,
        'gritty'
      );
    }

    // Camada 4: Roçar orgânico do tecido pesado do traje EVA + micro-tilintar de equipamento na corrida
    this.triggerFilteredNoise(
      stepLowpass,
      now + 0.018,
      crouching ? 0.075 : 0.062,
      540 + (variant % 4) * 45,
      0.95,
      profile.suitRustleGain,
      'pink'
    );

    if (sprinting) {
      this.triggerFilteredNoise(
        stepLowpass,
        now + 0.028,
        0.018,
        4_200,
        4.8,
        0.022,
        'white'
      );
    }
  }

  /**
   * Passo espacializado 3D de um aliado no Multiplayer Co-op:
   * inclui pan estéreo, queda por distância até 20m e abafamento real pelas paredes do labirinto!
   */
  playRemoteAllyFootstep(
    pan: number,
    distance: number,
    wallCount: number,
    altFoot: boolean,
    surface: FloorMaterialKind,
    sprinting: boolean,
    crouching: boolean
  ): void {
    const maxDist = crouching ? 9.5 : sprinting ? 21.0 : 16.0;
    const acoustics = computeLabyrinthSoundAcoustics(distance, maxDist, wallCount);
    const sink = this.createSpatialWorldSink(pan, acoustics);
    if (!sink || !this.ctx) return;

    const now = this.ctx.currentTime;
    const profile = computeFootstepLayerProfile(
      surface,
      sprinting,
      crouching,
      altFoot,
      this.footstepVariantCounter++
    );

    const heel = this.ctx.createOscillator();
    const heelGain = this.ctx.createGain();
    heel.type = surface === 'tech' ? 'triangle' : 'sine';
    heel.frequency.setValueAtTime(profile.heelBaseHz * 0.96, now);
    heel.frequency.exponentialRampToValueAtTime(profile.heelEndHz, now + 0.085);
    heelGain.gain.setValueAtTime(profile.heelGain * 0.85, now);
    heelGain.gain.exponentialRampToValueAtTime(0.0006, now + 0.09);

    heel.connect(heelGain);
    heelGain.connect(sink);
    heel.start(now);
    heel.stop(now + 0.095);

    this.triggerFilteredNoise(
      sink,
      now + 0.01,
      0.05,
      profile.gritBandHz,
      surface === 'tech' ? 2.3 : 1.4,
      profile.gritGain * 0.85,
      surface === 'stone' ? 'crackle' : 'gritty'
    );
  }

  /**
   * Respiração diegética dentro do capacete EVA refletindo em tempo real a estamina restante
   * (sem poluir a tela com barras ou medidores de HUD!).
   */
  playSprintBreath(exertion01: number, exhausted = false): void {
    const level = Math.max(0, Math.min(1, exertion01));
    if (level < 0.14 && !exhausted) return;

    const nowMs = performance.now();
    const intervalMs = exhausted
      ? 680
      : 1_360 - level * 610;
    if (nowMs - this.lastSprintBreathMs < intervalMs) return;
    this.lastSprintBreathMs = nowMs;

    if (this.worldPaused || !this.isRunning() || !this.ctx || !this.worldDryBus) {
      return;
    }
    const now = this.ctx.currentTime;

    const gainMul = exhausted ? 1.38 : 1.0;
    // Expiração + inspiração com ressonância acústica interna de capacete fechado
    const phases: ReadonlyArray<readonly [number, number, number, number]> = [
      [0, exhausted ? 0.25 : 0.28, exhausted ? 680 : 720, 0.036 * level * gainMul],
      [
        exhausted ? 0.29 : 0.36,
        exhausted ? 0.22 : 0.24,
        exhausted ? 1_040 : 960,
        0.028 * level * gainMul,
      ],
    ];
    for (const [delay, dur, freq, peakGain] of phases) {
      if (!this.pinkNoiseBuffer) continue;
      const t = now + delay;
      const src = this.ctx.createBufferSource();
      src.buffer = this.pinkNoiseBuffer;
      const offset = Math.random() * 0.6;

      const bp = this.ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = freq;
      bp.Q.value = exhausted ? 1.45 : 1.65;

      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0005, t);
      g.gain.linearRampToValueAtTime(peakGain, t + dur * 0.35);
      g.gain.exponentialRampToValueAtTime(0.0005, t + dur);

      src.connect(bp);
      bp.connect(g);
      g.connect(this.worldDryBus);
      src.start(t, offset, dur + 0.02);
    }
  }

  /**
   * Arquejo pesado imediato dentro do capacete quando a estamina esgota completamente (0%),
   * comunicando ao jogador sem qualquer HUD que ele precisa recuperar o fôlego!
   */
  playExhaustionGasp(): void {
    if (!this.isRunning() || !this.ctx || !this.worldDryBus) return;
    const now = this.ctx.currentTime;

    // Expiração pesada seguida de puxada funda de ar + pulsação surda no ouvido
    this.triggerFilteredNoise(
      this.worldDryBus,
      now,
      0.32,
      640,
      1.35,
      0.072,
      'pink'
    );
    this.triggerFilteredNoise(
      this.worldDryBus,
      now + 0.34,
      0.36,
      1_080,
      1.55,
      0.056,
      'pink'
    );

    const pulse = this.ctx.createOscillator();
    const pulseGain = this.ctx.createGain();
    pulse.type = 'sine';
    pulse.frequency.setValueAtTime(62, now);
    pulse.frequency.exponentialRampToValueAtTime(28, now + 0.22);
    pulseGain.gain.setValueAtTime(0.085, now);
    pulseGain.gain.exponentialRampToValueAtTime(0.0008, now + 0.24);
    pulse.connect(pulseGain);
    pulseGain.connect(this.worldDryBus);
    pulse.start(now);
    pulse.stop(now + 0.25);
  }

  /** Movimento tátil do traje e equipamento ao agachar ou levantar (Ctrl / C) */
  playCrouchMovement(crouchingDown: boolean): void {
    const nowMs = performance.now();
    if (nowMs - this.lastCrouchMs < 150) return;
    this.lastCrouchMs = nowMs;

    if (
      !this.isRunning() ||
      !this.ctx ||
      !this.worldDryBus ||
      !this.reverbSend
    ) {
      return;
    }
    const now = this.ctx.currentTime;

    // Dobra de tecido pesado pressurizado
    this.triggerFilteredNoise(
      this.worldDryBus,
      now,
      0.115,
      crouchingDown ? 410 : 560,
      1.05,
      0.068,
      'pink',
      this.reverbSend
    );

    // Acomodação suave de joelheira / junta do traje
    const joint = this.ctx.createOscillator();
    const jg = this.ctx.createGain();
    joint.type = 'sine';
    joint.frequency.setValueAtTime(crouchingDown ? 132 : 84, now + 0.015);
    joint.frequency.exponentialRampToValueAtTime(
      crouchingDown ? 56 : 126,
      now + 0.095
    );
    jg.gain.setValueAtTime(0.048, now + 0.015);
    jg.gain.exponentialRampToValueAtTime(0.0006, now + 0.1);
    joint.connect(jg);
    jg.connect(this.worldDryBus);
    joint.start(now + 0.015);
    joint.stop(now + 0.105);
  }

  /**
   * Deslize tático pelo chão (Corrida + Ctrl):
   * impacto firme de joelheira + atrito contínuo sobre chapa metálica/pedra + pedregulhos/faíscas!
   */
  playFloorSlide(surface: FloorMaterialKind = 'tech'): void {
    const nowMs = performance.now();
    if (nowMs - this.lastSlideMs < 240) return;
    this.lastSlideMs = nowMs;

    if (
      !this.isRunning() ||
      !this.ctx ||
      !this.worldDryBus ||
      !this.reverbSend ||
      !this.grittyNoiseBuffer
    ) {
      return;
    }
    const now = this.ctx.currentTime;

    // 1. Impacto inicial pesado da joelheira/bota entrando no slide
    const thud = this.ctx.createOscillator();
    const thudGain = this.ctx.createGain();
    thud.type = 'triangle';
    thud.frequency.setValueAtTime(surface === 'tech' ? 122 : 96, now);
    thud.frequency.exponentialRampToValueAtTime(30, now + 0.15);

    thudGain.gain.setValueAtTime(0.2, now);
    thudGain.gain.exponentialRampToValueAtTime(0.0008, now + 0.16);

    thud.connect(thudGain);
    thudGain.connect(this.worldDryBus);
    thudGain.connect(this.reverbSend);
    thud.start(now);
    thud.stop(now + 0.17);

    // 2. Varredura longa de atrito desacelerando no chão
    const src = this.ctx.createBufferSource();
    src.buffer = this.grittyNoiseBuffer;
    const dur = 0.56;
    const offset = Math.random() * 0.5;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = surface === 'tech' ? 1.65 : 1.15;
    filter.frequency.setValueAtTime(surface === 'tech' ? 1_950 : 1_240, now);
    filter.frequency.exponentialRampToValueAtTime(
      surface === 'tech' ? 380 : 260,
      now + dur
    );

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.175, now + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0008, now + dur);

    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.worldDryBus);
    gain.connect(this.reverbSend);
    src.start(now, offset, dur + 0.02);

    // 3. Faíscas de atrito na grade metálica ou cascalho espirrando na pedra
    this.triggerFilteredNoise(
      this.worldDryBus,
      now + 0.025,
      0.34,
      surface === 'tech' ? 3_800 : 2_300,
      2.2,
      0.085,
      'crackle',
      this.reverbSend
    );
  }

  /**
   * Batida/raspão pesado de ombro do traje EVA contra parede sólida em velocidade.
   */
  playWallBump(): void {
    const nowMs = performance.now();
    if (nowMs - this.lastWallThudMs < 360) return;
    this.lastWallThudMs = nowMs;

    if (
      this.worldPaused ||
      !this.isRunning() ||
      !this.ctx ||
      !this.worldDryBus ||
      !this.reverbSend
    ) {
      return;
    }
    const now = this.ctx.currentTime;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(84, now);
    osc.frequency.exponentialRampToValueAtTime(27, now + 0.135);

    gain.gain.setValueAtTime(0.2, now);
    gain.gain.exponentialRampToValueAtTime(0.0008, now + 0.145);

    osc.connect(gain);
    gain.connect(this.worldDryBus);
    gain.connect(this.reverbSend);
    osc.start(now);
    osc.stop(now + 0.15);

    // Raspão áspero da ombreira contra a parede + leve vibração metálica
    this.triggerFilteredNoise(
      this.worldDryBus,
      now,
      0.085,
      680,
      1.35,
      0.13,
      'gritty',
      this.reverbSend
    );
    this.triggerFilteredNoise(
      this.worldDryBus,
      now + 0.01,
      0.04,
      2_100,
      2.6,
      0.055,
      'crackle'
    );
  }

  /** Sacar ou guardar a lanterna tática de alumínio (Tecla F) */
  playFlashlightMotion(equipping: boolean): void {
    if (
      !this.isRunning() ||
      !this.ctx ||
      !this.worldDryBus ||
      !this.reverbSend
    ) {
      return;
    }
    const now = this.ctx.currentTime;

    // Roçar rápido no coldre do traje
    this.triggerFilteredNoise(
      this.worldDryBus,
      now,
      0.095,
      equipping ? 760 : 490,
      1.15,
      0.08,
      'pink',
      this.reverbSend
    );

    // Toque metálico discreto do corpo de alumínio anodizado
    const clink = this.ctx.createOscillator();
    const cg = this.ctx.createGain();
    clink.type = 'sine';
    clink.frequency.setValueAtTime(equipping ? 1_420 : 1_080, now + 0.024);
    clink.frequency.exponentialRampToValueAtTime(
      equipping ? 1_860 : 790,
      now + 0.056
    );
    cg.gain.setValueAtTime(0.026, now + 0.024);
    cg.gain.exponentialRampToValueAtTime(0.0006, now + 0.06);
    clink.connect(cg);
    cg.connect(this.worldDryBus);
    clink.start(now + 0.024);
    clink.stop(now + 0.065);
  }

  /** Clique mecânico duplo realista do interruptor da lanterna + carga sutil do refletor */
  playFlashlightClick(turningOn: boolean): void {
    if (
      !this.isRunning() ||
      !this.ctx ||
      !this.worldDryBus ||
      !this.reverbSend
    ) {
      return;
    }
    const now = this.ctx.currentTime;

    // 1. Estalo nítido da trava mecânica do botão
    this.triggerFilteredNoise(
      this.worldDryBus,
      now,
      0.012,
      turningOn ? 3_850 : 2_750,
      3.2,
      0.145,
      'white',
      this.reverbSend
    );

    // 2. Duplo degrau da mola interna ("click-clack")
    const freqs = turningOn ? [560, 1_040] : [940, 460];
    freqs.forEach((f, i) => {
      if (!this.ctx || !this.worldDryBus || !this.reverbSend) return;
      const t = now + i * 0.019;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(f, t);
      osc.frequency.exponentialRampToValueAtTime(f * 0.66, t + 0.022);

      gain.gain.setValueAtTime(0.088, t);
      gain.gain.exponentialRampToValueAtTime(0.0008, t + 0.026);

      osc.connect(gain);
      gain.connect(this.worldDryBus);
      gain.connect(this.reverbSend);
      osc.start(t);
      osc.stop(t + 0.029);
    });

    // 3. Carga finíssima do circuito da lâmpada ao acender
    if (turningOn) {
      const whine = this.ctx.createOscillator();
      const wg = this.ctx.createGain();
      whine.type = 'sine';
      whine.frequency.setValueAtTime(2_600, now + 0.025);
      whine.frequency.exponentialRampToValueAtTime(5_400, now + 0.16);
      wg.gain.setValueAtTime(0.014, now + 0.025);
      wg.gain.exponentialRampToValueAtTime(0.0004, now + 0.17);
      whine.connect(wg);
      wg.connect(this.worldDryBus);
      whine.start(now + 0.025);
      whine.stop(now + 0.18);
    }
  }

  /**
   * Atualiza espacialização do zumbido das luminárias LITE5 e dispara centelha elétrica realista ao piscar!
   */
  updateSpatialLampAudio(
    playerPos: THREE.Vector3,
    playerYaw: number,
    nearestLampPos: THREE.Vector3 | null,
    nearestDist: number,
    justFlickeredDim: boolean
  ): void {
    if (!this.ctx || this.ctx.state !== 'running' || this.worldPaused) return;
    const now = this.ctx.currentTime;

    if (!nearestLampPos || nearestDist > 7.8) {
      this.lampBuzzGain?.gain.setTargetAtTime(0, now, 0.08);
      return;
    }

    const rightX = Math.cos(playerYaw);
    const rightZ = -Math.sin(playerYaw);
    const dx = nearestLampPos.x - playerPos.x;
    const dz = nearestLampPos.z - playerPos.z;
    const len = Math.max(0.001, Math.hypot(dx, dz));
    const pan = Math.max(-0.9, Math.min(0.9, (dx * rightX + dz * rightZ) / len));

    const proximity = Math.pow(Math.max(0, 1 - nearestDist / 7.8), 2);
    this.lampBuzzPanner?.pan.setTargetAtTime(pan, now, 0.05);
    this.lampBuzzGain?.gain.setTargetAtTime(proximity * 0.0075, now, 0.06);

    if (
      justFlickeredDim &&
      nearestDist < 6.4 &&
      performance.now() - this.lastSparkMs > 240 &&
      this.worldDryBus &&
      this.reverbSend
    ) {
      this.lastSparkMs = performance.now();
      const sparkPan = this.ctx.createStereoPanner();
      sparkPan.pan.value = pan;
      sparkPan.connect(this.worldDryBus);
      sparkPan.connect(this.reverbSend);

      this.triggerFilteredNoise(
        sparkPan,
        now,
        0.032,
        3_100,
        2.9,
        0.038 * proximity,
        'crackle'
      );

      const zap = this.ctx.createOscillator();
      const zg = this.ctx.createGain();
      zap.type = 'sawtooth';
      zap.frequency.setValueAtTime(180, now);
      zap.frequency.exponentialRampToValueAtTime(95, now + 0.028);
      zg.gain.setValueAtTime(0.022 * proximity, now);
      zg.gain.exponentialRampToValueAtTime(0.0005, now + 0.03);
      zap.connect(zg);
      zg.connect(sparkPan);
      zap.start(now);
      zap.stop(now + 0.034);
    }
  }

  /**
   * Atualiza o chiado contínuo + estalos químicos de magnésio dos sinalizadores acesos no chão!
   */
  updateSpatialFlareAudio(
    playerPos: THREE.Vector3,
    playerYaw: number,
    nearestFlarePos: THREE.Vector3 | null,
    nearestFlareDist: number,
    remainingLifeSec = 10
  ): void {
    if (!this.ctx || this.ctx.state !== 'running' || this.worldPaused) return;
    const now = this.ctx.currentTime;

    if (!nearestFlarePos || nearestFlareDist > 14.5 || remainingLifeSec <= 0.05) {
      this.flareBurnGain?.gain.setTargetAtTime(0, now, 0.08);
      return;
    }

    const rightX = Math.cos(playerYaw);
    const rightZ = -Math.sin(playerYaw);
    const dx = nearestFlarePos.x - playerPos.x;
    const dz = nearestFlarePos.z - playerPos.z;
    const len = Math.max(0.001, Math.hypot(dx, dz));
    const pan = Math.max(-0.92, Math.min(0.92, (dx * rightX + dz * rightZ) / len));

    const lifeFade = Math.min(1, remainingLifeSec / 2.2);
    const proximity = Math.pow(Math.max(0, 1 - nearestFlareDist / 14.5), 1.65) * lifeFade;

    this.flareBurnPanner?.pan.setTargetAtTime(pan, now, 0.05);
    this.flareBurnGain?.gain.setTargetAtTime(proximity * 0.055, now, 0.06);
    if (this.flareBurnFilter) {
      const sputterHz = 1_950 + Math.sin(now * 23) * 320;
      this.flareBurnFilter.frequency.setTargetAtTime(sputterHz, now, 0.04);
    }

    // Estalos esporádicos de faísca de magnésio quando perto do sinalizador
    const nowMs = performance.now();
    if (
      proximity > 0.15 &&
      nowMs - this.lastFlarePopMs > 190 &&
      Math.random() < 0.28 &&
      this.worldDryBus &&
      this.reverbSend
    ) {
      this.lastFlarePopMs = nowMs;
      const popPan = this.ctx.createStereoPanner();
      popPan.pan.value = pan;
      popPan.connect(this.worldDryBus);
      popPan.connect(this.reverbSend);

      this.triggerFilteredNoise(
        popPan,
        now,
        0.022,
        3_600 + Math.random() * 1_400,
        2.8,
        0.045 * proximity,
        'crackle'
      );
    }
  }

  // ==========================================================================
  // 5. INVENTÁRIO TÁTICO DE SOBREVIVÊNCIA, MENU DE PAUSA & USO DE ITENS
  // ==========================================================================

  /**
   * Som analógico tátil dedicado para abrir/fechar o Menu de Pausa (`terminalBus` puro,
   * sem vazamento para o reverb dos corredores nem conflito com o som da mochila!).
   */
  playPauseToggle(opening: boolean): void {
    if (!this.isRunning() || !this.ctx || !this.terminalBus) return;
    const now = this.ctx.currentTime;

    // Clique seco de relé mecânico do visor
    this.triggerFilteredNoise(
      this.terminalBus,
      now,
      0.014,
      opening ? 2_450 : 2_950,
      2.8,
      0.065,
      'white'
    );

    const notes: ReadonlyArray<readonly [number, number]> = opening
      ? [
          [0, 392],
          [0.036, 261.63],
        ]
      : [
          [0, 293.66],
          [0.034, 440],
        ];

    for (const [delay, freq] of notes) {
      const t = now + delay;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, t);
      osc.frequency.exponentialRampToValueAtTime(freq * 0.94, t + 0.055);
      gain.gain.setValueAtTime(0.058, t);
      gain.gain.exponentialRampToValueAtTime(0.0007, t + 0.062);
      osc.connect(gain);
      gain.connect(this.terminalBus);
      osc.start(t);
      osc.stop(t + 0.066);
    }
  }

  /** Abrir / fechar a bolsa tática (Tab): deslizar de zíper + lona pesada + fivela metálica */
  playInventoryToggle(opening: boolean): void {
    if (!this.isRunning() || !this.ctx || !this.terminalBus) return;
    const now = this.ctx.currentTime;

    // Lona pesada da mochila tática
    this.triggerFilteredNoise(
      this.terminalBus,
      now,
      0.16,
      opening ? 520 : 370,
      0.95,
      0.115,
      'pink',
      this.reverbSend ?? undefined
    );

    // Dentes do zíper correndo rápido
    for (let z = 0; z < 4; z++) {
      const tz = now + 0.014 + z * 0.018;
      const fz = opening ? 2_100 + z * 280 : 3_000 - z * 260;
      this.triggerFilteredNoise(
        this.terminalBus,
        tz,
        0.011,
        fz,
        3.6,
        0.048,
        'crackle'
      );
    }

    // Fivela metálica da bolsa
    const clasp = this.ctx.createOscillator();
    const claspGain = this.ctx.createGain();
    clasp.type = 'triangle';
    clasp.frequency.setValueAtTime(opening ? 250 : 360, now + 0.035);
    clasp.frequency.exponentialRampToValueAtTime(
      opening ? 420 : 175,
      now + 0.095
    );
    claspGain.gain.setValueAtTime(0.058, now + 0.035);
    claspGain.gain.exponentialRampToValueAtTime(0.0008, now + 0.105);

    clasp.connect(claspGain);
    claspGain.connect(this.terminalBus);
    clasp.start(now + 0.035);
    clasp.stop(now + 0.11);
  }

  playInventorySelect(heavy = false): void {
    if (!this.isRunning() || !this.ctx || !this.terminalBus) return;
    const now = this.ctx.currentTime;

    this.triggerFilteredNoise(
      this.terminalBus,
      now,
      heavy ? 0.022 : 0.011,
      heavy ? 1_550 : 2_350,
      2.4,
      heavy ? 0.09 : 0.048,
      'white'
    );

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(heavy ? 320 : 540, now);
    osc.frequency.exponentialRampToValueAtTime(heavy ? 160 : 330, now + 0.036);
    gain.gain.setValueAtTime(heavy ? 0.068 : 0.035, now);
    gain.gain.exponentialRampToValueAtTime(0.0008, now + 0.04);

    osc.connect(gain);
    gain.connect(this.terminalBus);
    osc.start(now);
    osc.stop(now + 0.042);
  }

  /** Pegar equipamento no chão do labirinto: pegada tátil + tilintar metálico + acomodação no cinto */
  playItemPickup(): void {
    if (
      !this.isRunning() ||
      !this.ctx ||
      !this.worldDryBus ||
      !this.reverbSend
    ) {
      return;
    }
    const now = this.ctx.currentTime;

    this.triggerFilteredNoise(
      this.worldDryBus,
      now,
      0.085,
      1_050,
      1.35,
      0.13,
      'pink',
      this.reverbSend
    );
    this.triggerFilteredNoise(
      this.worldDryBus,
      now + 0.048,
      0.11,
      480,
      1.05,
      0.105,
      'pink'
    );

    // Tilintar tátil de equipamento + confirmação harmônica limpa
    const notes = [310, 465, 698];
    notes.forEach((f, idx) => {
      if (!this.ctx || !this.worldDryBus) return;
      const t = now + idx * 0.038;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = idx === 2 ? 'sine' : 'triangle';
      osc.frequency.setValueAtTime(f, t);
      osc.frequency.exponentialRampToValueAtTime(f * 0.9, t + 0.075);
      gain.gain.setValueAtTime(idx === 2 ? 0.038 : 0.058, t);
      gain.gain.exponentialRampToValueAtTime(0.0008, t + 0.085);
      osc.connect(gain);
      gain.connect(this.worldDryBus);
      osc.start(t);
      osc.stop(t + 0.09);
    });
  }

  /** Efeitos Foley detalhados de uso de item dentro do jogo */
  playItemUse(kind: 'heal' | 'battery' | 'flare' | 'note' | 'blade'): void {
    if (!this.isRunning() || !this.ctx || !this.worldDryBus) return;
    const now = this.ctx.currentTime;

    if (kind === 'heal') {
      // Pressurização de autoinjetor / rasgo de atadura estéril + alívio vital quente
      this.triggerFilteredNoise(
        this.worldDryBus,
        now,
        0.045,
        2_850,
        2.4,
        0.11,
        'white'
      );
      this.triggerFilteredNoise(
        this.worldDryBus,
        now + 0.04,
        0.22,
        1_180,
        1.25,
        0.125,
        'pink'
      );
      const chord = [196, 293.66, 392];
      chord.forEach((f, idx) => {
        if (!this.ctx || !this.worldDryBus) return;
        const t = now + 0.06 + idx * 0.045;
        const warm = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        warm.type = 'sine';
        warm.frequency.setValueAtTime(f, t);
        warm.frequency.exponentialRampToValueAtTime(f * 1.03, t + 0.34);
        g.gain.setValueAtTime(0.052, t);
        g.gain.exponentialRampToValueAtTime(0.0006, t + 0.38);
        warm.connect(g);
        g.connect(this.worldDryBus);
        warm.start(t);
        warm.stop(t + 0.4);
      });
    } else if (kind === 'battery') {
      // Destrava compartimento + deslize da célula de lítio + trava metálica + carga do capacitor
      this.triggerFilteredNoise(
        this.worldDryBus,
        now,
        0.02,
        2_600,
        2.8,
        0.12,
        'white'
      );
      this.triggerFilteredNoise(
        this.worldDryBus,
        now + 0.055,
        0.022,
        3_400,
        3.2,
        0.135,
        'white'
      );
      const cap = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      cap.type = 'sine';
      cap.frequency.setValueAtTime(380, now + 0.065);
      cap.frequency.exponentialRampToValueAtTime(1_480, now + 0.29);
      g.gain.setValueAtTime(0.058, now + 0.065);
      g.gain.exponentialRampToValueAtTime(0.0006, now + 0.32);
      cap.connect(g);
      g.connect(this.worldDryBus);
      cap.start(now + 0.065);
      cap.stop(now + 0.34);
    } else if (kind === 'flare') {
      // Destampar cápsula + riscar ignitor de fósforo + explosão sibilante de magnésio!
      this.triggerFilteredNoise(
        this.worldDryBus,
        now,
        0.032,
        3_900,
        2.6,
        0.19,
        'crackle',
        this.reverbSend ?? undefined
      );
      this.triggerFilteredNoise(
        this.worldDryBus,
        now + 0.028,
        0.55,
        2_050,
        0.85,
        0.19,
        'pink',
        this.reverbSend ?? undefined
      );
      const whoosh = this.ctx.createOscillator();
      const wg = this.ctx.createGain();
      whoosh.type = 'triangle';
      whoosh.frequency.setValueAtTime(195, now + 0.025);
      whoosh.frequency.exponentialRampToValueAtTime(58, now + 0.24);
      wg.gain.setValueAtTime(0.14, now + 0.025);
      wg.gain.exponentialRampToValueAtTime(0.0008, now + 0.26);
      whoosh.connect(wg);
      wg.connect(this.worldDryBus);
      if (this.reverbSend) wg.connect(this.reverbSend);
      whoosh.start(now + 0.025);
      whoosh.stop(now + 0.28);
    } else if (kind === 'blade') {
      // Tinido harmônico de aço da lâmina + corte veloz rasgando o ar ("whoosh-zing!")
      this.triggerFilteredNoise(
        this.worldDryBus,
        now,
        0.038,
        4_600,
        4.2,
        0.145,
        'white',
        this.reverbSend ?? undefined
      );
      this.triggerFilteredNoise(
        this.worldDryBus,
        now + 0.028,
        0.125,
        1_650,
        1.25,
        0.155,
        'pink',
        this.reverbSend ?? undefined
      );
      const steelModes = [2_620, 3_940];
      steelModes.forEach((hz, idx) => {
        if (!this.ctx || !this.worldDryBus) return;
        const ring = this.ctx.createOscillator();
        const rg = this.ctx.createGain();
        ring.type = idx === 0 ? 'triangle' : 'sine';
        ring.frequency.setValueAtTime(hz, now);
        ring.frequency.exponentialRampToValueAtTime(hz * 0.56, now + 0.11);
        rg.gain.setValueAtTime(idx === 0 ? 0.055 : 0.028, now);
        rg.gain.exponentialRampToValueAtTime(0.0006, now + 0.12);
        ring.connect(rg);
        rg.connect(this.worldDryBus);
        ring.start(now);
        ring.stop(now + 0.125);
      });
    } else {
      // Folha de registro/papel antigo sendo desdobrada
      this.triggerFilteredNoise(
        this.worldDryBus,
        now,
        0.09,
        2_100,
        1.4,
        0.095,
        'crackle'
      );
      this.triggerFilteredNoise(
        this.worldDryBus,
        now + 0.06,
        0.13,
        1_350,
        1.1,
        0.08,
        'pink'
      );
    }
  }

  // ==========================================================================
  // 6. ARANHA GIGANTE (PASSOS PESADOS + GARRAS + OCLUSÃO + MANDÍBULAS + GRITO)
  // ==========================================================================

  /**
   * Passo visceral da Aranha Gigante de 8 patas:
   *  1. Impacto sub-grave do peso monstruoso fazendo vibrar o corredor;
   *  2. Batida perfurante de garra quitinosa (pedra áspera no chão vs clangor metálico oco na grade do teto!);
   *  3. Estalo articular secundário do exoesqueleto (+11ms–16ms);
   *  4. Oclusão acústica real pelas paredes do labirinto (`wallCount`)!
   */
  playSpiderFootstep(
    pan: number,
    distance: number,
    frantic: boolean,
    onMetalOrCeiling: boolean,
    wallCount = 0
  ): void {
    const nowMs = performance.now();
    const minGap = frantic ? 26 : 52;
    if (nowMs - this.lastSpiderStepMs < minGap) return;
    this.lastSpiderStepMs = nowMs;

    if (!this.isRunning() || !this.ctx) return;

    const profile = computeSpiderStepLayerProfile(
      distance,
      frantic,
      onMetalOrCeiling,
      wallCount
    );
    if (!profile.audible) return;

    const sink = this.createSpatialWorldSink(pan, {
      dryGain: profile.dryGain,
      wetSendGain: profile.wetSendGain,
      lowpassHz: profile.lowpassHz,
      audible: true,
    });
    if (!sink) return;

    const now = this.ctx.currentTime;
    const variant = this.spiderStepVariantCounter++;
    const jitter = (0.9 + ((variant * 37) % 19) * 0.011) * (0.96 + Math.random() * 0.08);

    // Camada 1: Peso físico sub-grave do predador gigante pisando no corredor
    const sub = this.ctx.createOscillator();
    const subGain = this.ctx.createGain();
    sub.type = 'triangle';
    sub.frequency.setValueAtTime(profile.subWeightHz * jitter, now);
    sub.frequency.exponentialRampToValueAtTime(26, now + (frantic ? 0.075 : 0.065));
    subGain.gain.setValueAtTime(profile.subWeightGain, now);
    subGain.gain.exponentialRampToValueAtTime(0.0006, now + 0.082);
    sub.connect(subGain);
    subGain.connect(sink);
    sub.start(now);
    sub.stop(now + 0.088);

    // Camada 2: Impacto pontiagudo da ponta da garra quitinosa
    this.triggerFilteredNoise(
      sink,
      now,
      frantic ? 0.03 : 0.038,
      profile.clawStrikeHz * jitter,
      profile.clawStrikeQ,
      profile.clawStrikeGain,
      onMetalOrCeiling ? 'gritty' : 'crackle'
    );

    // Ressonância metálica oca arrepiante quando a aranha caminha na grade do teto/parede metálica!
    if (profile.metallicModesHz) {
      profile.metallicModesHz.forEach((hz, idx) => {
        if (!this.ctx) return;
        const mOsc = this.ctx.createOscillator();
        const mGain = this.ctx.createGain();
        mOsc.type = idx === 0 ? 'triangle' : 'sine';
        mOsc.frequency.setValueAtTime(hz * jitter, now);
        mOsc.frequency.exponentialRampToValueAtTime(
          hz * 0.86,
          now + 0.075
        );
        mGain.gain.setValueAtTime(
          (frantic ? 0.052 : 0.034) / (idx + 1),
          now
        );
        mGain.gain.exponentialRampToValueAtTime(0.0005, now + 0.08);
        mOsc.connect(mGain);
        mGain.connect(sink);
        mOsc.start(now);
        mOsc.stop(now + 0.085);
      });
    }

    // Camada 3: Duplo estalo articular seco de quitina / tarso se travando (+11ms–16ms)
    const tJoint = now + profile.jointDelaySec;
    const click = this.ctx.createOscillator();
    const clickGain = this.ctx.createGain();
    click.type = onMetalOrCeiling ? 'triangle' : 'sine';
    click.frequency.setValueAtTime(profile.jointClickHz * jitter, tJoint);
    click.frequency.exponentialRampToValueAtTime(64, tJoint + 0.034);

    clickGain.gain.setValueAtTime(profile.clawStrikeGain * 0.72, tJoint);
    clickGain.gain.exponentialRampToValueAtTime(0.0006, tJoint + 0.038);

    click.connect(clickGain);
    clickGain.connect(sink);
    click.start(tJoint);
    click.stop(tJoint + 0.042);
  }

  /**
   * Estalidos úmidos de quelíceras / mandíbulas e respiração traqueal da Aranha
   * quando ela espreita pelos corredores ou pelo teto perto do jogador!
   */
  playSpiderChitter(
    pan: number,
    distance: number,
    wallCount = 0,
    agitated = false
  ): void {
    const nowMs = performance.now();
    if (nowMs - this.lastSpiderChitterMs < (agitated ? 900 : 1_800)) return;
    this.lastSpiderChitterMs = nowMs;

    if (!this.isRunning() || !this.ctx) return;

    const acoustics = computeLabyrinthSoundAcoustics(distance, 18.5, wallCount);
    const sink = this.createSpatialWorldSink(pan, acoustics);
    if (!sink) return;

    const now = this.ctx.currentTime;
    const clicks = agitated ? 6 : 4;

    // Sopro traqueal áspero de fundo
    this.triggerFilteredNoise(
      sink,
      now,
      0.24,
      agitated ? 1_150 : 820,
      1.7,
      agitated ? 0.075 : 0.045,
      'pink'
    );

    // Sequência rápida e orgânica de estalidos úmidos de mandíbulas
    let cursor = 0.01;
    for (let i = 0; i < clicks; i++) {
      const t = now + cursor;
      cursor += 0.026 + Math.random() * 0.032;
      const f0 = (1_280 + Math.random() * 980) * (agitated ? 1.15 : 1.0);

      this.triggerFilteredNoise(
        sink,
        t,
        0.018,
        f0,
        4.2,
        agitated ? 0.095 : 0.062,
        'crackle'
      );

      const mand = this.ctx.createOscillator();
      const mg = this.ctx.createGain();
      mand.type = 'triangle';
      mand.frequency.setValueAtTime(f0 * 0.32, t);
      mand.frequency.exponentialRampToValueAtTime(95, t + 0.024);
      mg.gain.setValueAtTime(agitated ? 0.055 : 0.036, t);
      mg.gain.exponentialRampToValueAtTime(0.0005, t + 0.026);
      mand.connect(mg);
      mg.connect(sink);
      mand.start(t);
      mand.stop(t + 0.03);
    }
  }

  /**
   * Grito / guincho orgânico aterrorizante da Aranha Gigante:
   * combina rugido sub-grave + trato vocal com formantes móveis modulados por trinado de mandíbula (FM 31Hz)
   * + jato sibilante pressurizado + oclusão realista pelas paredes!
   */
  playSpiderScream(pan: number, distance: number, wallCount = 0): void {
    const nowMs = performance.now();
    if (nowMs - this.lastSpiderScreamMs < 220) return;
    this.lastSpiderScreamMs = nowMs;

    if (!this.isRunning() || !this.ctx) return;

    const rawAcoustics = computeLabyrinthSoundAcoustics(distance, 34.0, wallCount);
    // Mesmo distante no labirinto, o grito da aranha ecoa pelos corredores como alerta mortal!
    const screamAcoustics: LabyrinthSoundAcoustics = {
      dryGain: Math.max(wallCount === 0 ? 0.16 : 0.07, rawAcoustics.dryGain),
      wetSendGain: Math.max(0.2, rawAcoustics.wetSendGain * 1.25),
      lowpassHz: Math.max(580, rawAcoustics.lowpassHz),
      audible: true,
    };

    const sink = this.createSpatialWorldSink(pan, screamAcoustics);
    if (!sink) return;

    const now = this.ctx.currentTime;

    // 1. Rugido torácico sub-grave
    const chest = this.ctx.createOscillator();
    const chestGain = this.ctx.createGain();
    chest.type = 'sawtooth';
    chest.frequency.setValueAtTime(118, now);
    chest.frequency.exponentialRampToValueAtTime(152, now + 0.09);
    chest.frequency.exponentialRampToValueAtTime(38, now + 0.68);

    const chestLp = this.ctx.createBiquadFilter();
    chestLp.type = 'lowpass';
    chestLp.frequency.value = 340;

    chestGain.gain.setValueAtTime(0.001, now);
    chestGain.gain.linearRampToValueAtTime(0.22, now + 0.035);
    chestGain.gain.exponentialRampToValueAtTime(0.0008, now + 0.72);

    chest.connect(chestLp);
    chestLp.connect(chestGain);
    chestGain.connect(sink);
    chest.start(now);
    chest.stop(now + 0.75);

    // 2. Sibilo pressurizado rasgado
    this.triggerFilteredNoise(
      sink,
      now,
      0.68,
      1_850,
      1.35,
      0.24,
      'gritty'
    );

    // 3. LFO de vibração/trinado aracnídeo (31 Hz) modulando duas cordas vocais dissonantes em formantes móveis
    const trillLfo = this.ctx.createOscillator();
    const trillGain = this.ctx.createGain();
    trillLfo.type = 'sine';
    trillLfo.frequency.value = 31;
    trillGain.gain.value = 46;
    trillLfo.connect(trillGain);
    trillLfo.start(now);
    trillLfo.stop(now + 0.74);

    const voices: ReadonlyArray<
      readonly [OscillatorType, number, number, number, number, number]
    > = [
      ['sawtooth', 580, 1_240, 275, 1_180, 520],
      ['square', 635, 1_390, 232, 2_250, 890],
    ];
    for (const [wave, fStart, fPeak, fEnd, formStart, formEnd] of voices) {
      const osc = this.ctx.createOscillator();
      const formant = this.ctx.createBiquadFilter();
      const g = this.ctx.createGain();

      osc.type = wave;
      osc.frequency.setValueAtTime(fStart, now);
      osc.frequency.exponentialRampToValueAtTime(fPeak, now + 0.11);
      osc.frequency.exponentialRampToValueAtTime(fEnd, now + 0.68);
      trillGain.connect(osc.frequency);

      formant.type = 'bandpass';
      formant.frequency.setValueAtTime(formStart, now);
      formant.frequency.exponentialRampToValueAtTime(formEnd, now + 0.68);
      formant.Q.value = 2.6;

      g.gain.setValueAtTime(0.001, now);
      g.gain.linearRampToValueAtTime(0.15, now + 0.038);
      g.gain.exponentialRampToValueAtTime(0.0008, now + 0.7);

      osc.connect(formant);
      formant.connect(g);
      g.connect(sink);
      osc.start(now);
      osc.stop(now + 0.73);
    }
  }

  /**
   * Fanfarra curta e solene da tela de vitória: acorde aberto em Lá maior
   * subindo, com sino cristalino por cima e cauda longa no corredor.
   */
  winSurvivors(): void {
    if (!this.isRunning() || !this.ctx || !this.terminalBus) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const bus = this.terminalBus;

    const busGain = ctx.createGain();
    busGain.gain.value = 0.001;
    busGain.gain.linearRampToValueAtTime(0.34, now + 0.5);
    busGain.gain.setTargetAtTime(0.0001, now + 3.6, 0.9);
    busGain.connect(bus);
    if (this.reverbSend) busGain.connect(this.reverbSend);

    // Acorde maior com nona, entrando em cascata ascendente.
    const notes: Array<[number, number]> = [
      [220.0, 0.0],
      [277.18, 0.1],
      [329.63, 0.2],
      [440.0, 0.3],
      [493.88, 0.42],
    ];
    for (const [freq, delay] of notes) {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, now + delay);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, now + delay);
      gain.gain.linearRampToValueAtTime(0.12, now + delay + 0.5);
      gain.gain.exponentialRampToValueAtTime(0.0008, now + delay + 4.2);
      const panner = ctx.createStereoPanner();
      panner.pan.setValueAtTime((Math.random() * 2 - 1) * 0.32, now);
      osc.connect(gain);
      gain.connect(panner);
      panner.connect(busGain);
      osc.start(now + delay);
      osc.stop(now + delay + 4.4);
    }

    // Sino de confirmação no topo, com brilho metálico.
    const bell = ctx.createOscillator();
    bell.type = 'sine';
    bell.frequency.setValueAtTime(1318.5, now + 0.25);
    const bellGain = ctx.createGain();
    bellGain.gain.setValueAtTime(0.0001, now + 0.25);
    bellGain.gain.linearRampToValueAtTime(0.09, now + 0.3);
    bellGain.gain.exponentialRampToValueAtTime(0.0008, now + 3.0);
    bell.connect(bellGain);
    bellGain.connect(busGain);
    bell.start(now + 0.25);
    bell.stop(now + 3.1);

    this.triggerFilteredNoise(bus, now + 0.05, 1.6, 5200, 0.9, 0.05, 'white');
  }

  /**
   * Morte da aranha: o grito final desce de afinação, o corpo despenca com um
   * baque grave e a carcaça chia enquanto as pernas tremem e param.
   */
  playSpiderDeath(): void {
    if (!this.isRunning() || !this.ctx || !this.terminalBus) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const bus = this.terminalBus;

    // 1. Grito final: duas vozes dissonantes caindo de tom até o silêncio.
    const screamFilter = ctx.createBiquadFilter();
    screamFilter.type = 'bandpass';
    screamFilter.frequency.setValueAtTime(1400, now);
    screamFilter.frequency.exponentialRampToValueAtTime(320, now + 1.9);
    screamFilter.Q.value = 1.6;
    const screamGain = ctx.createGain();
    screamGain.gain.setValueAtTime(0.0001, now);
    screamGain.gain.linearRampToValueAtTime(0.2, now + 0.06);
    screamGain.gain.exponentialRampToValueAtTime(0.0008, now + 2.1);
    screamFilter.connect(screamGain);
    screamGain.connect(bus);
    if (this.reverbSend) screamGain.connect(this.reverbSend);

    for (const [type, start, end, detune] of [
      ['sawtooth', 520, 92, -7],
      ['square', 585, 118, 9],
    ] as const) {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.setValueAtTime(start, now);
      osc.frequency.exponentialRampToValueAtTime(end, now + 1.85);
      osc.detune.setValueAtTime(detune, now);
      const vibrato = ctx.createOscillator();
      vibrato.type = 'sine';
      vibrato.frequency.setValueAtTime(19, now);
      vibrato.frequency.exponentialRampToValueAtTime(6, now + 1.8);
      const depth = ctx.createGain();
      depth.gain.value = 26;
      vibrato.connect(depth);
      depth.connect(osc.frequency);
      vibrato.start(now);
      vibrato.stop(now + 2.0);
      osc.connect(screamFilter);
      osc.start(now);
      osc.stop(now + 2.1);
    }

    // 2. Baque do corpo no chão.
    const thud = ctx.createOscillator();
    thud.type = 'sine';
    thud.frequency.setValueAtTime(88, now + 1.2);
    thud.frequency.exponentialRampToValueAtTime(38, now + 1.75);
    const thudGain = ctx.createGain();
    thudGain.gain.setValueAtTime(0.0001, now + 1.2);
    thudGain.gain.linearRampToValueAtTime(0.26, now + 1.24);
    thudGain.gain.exponentialRampToValueAtTime(0.0008, now + 1.85);
    thud.connect(thudGain);
    thudGain.connect(bus);
    thud.start(now + 1.2);
    thud.stop(now + 1.9);
    this.triggerFilteredNoise(bus, now + 1.2, 0.42, 210, 0.8, 0.16, 'gritty');

    // 3. Quitina rachando e pernas tremendo até parar.
    this.triggerFilteredNoise(bus, now + 0.5, 0.9, 2400, 1.4, 0.075, 'crackle');
    for (let i = 0; i < 7; i++) {
      const at = now + 0.35 + i * 0.19;
      const click = ctx.createOscillator();
      const clickGain = ctx.createGain();
      click.type = 'triangle';
      click.frequency.setValueAtTime(240 + i * 26, at);
      click.frequency.exponentialRampToValueAtTime(120, at + 0.09);
      clickGain.gain.setValueAtTime(0.0001, at);
      clickGain.gain.linearRampToValueAtTime(0.05 * (1 - i / 9), at + 0.012);
      clickGain.gain.exponentialRampToValueAtTime(0.0001, at + 0.12);
      click.connect(clickGain);
      clickGain.connect(bus);
      click.start(at);
      click.stop(at + 0.14);
    }
  }

  /**
   * Guincho agudo de dor e recuo quando a Aranha é cegada por um Sinalizador de Magnésio ou golpeada pela Faca!
   */
  playSpiderPainRecoil(pan: number, distance: number, wallCount = 0): void {
    if (!this.isRunning() || !this.ctx) return;

    const raw = computeLabyrinthSoundAcoustics(distance, 32.0, wallCount);
    const sink = this.createSpatialWorldSink(pan, {
      dryGain: Math.max(0.14, raw.dryGain),
      wetSendGain: Math.max(0.22, raw.wetSendGain),
      lowpassHz: Math.max(700, raw.lowpassHz),
      audible: true,
    });
    if (!sink) return;

    const now = this.ctx.currentTime;

    this.triggerFilteredNoise(sink, now, 0.48, 2_650, 1.8, 0.24, 'crackle');

    const shriek = this.ctx.createOscillator();
    const sg = this.ctx.createGain();
    shriek.type = 'sawtooth';
    shriek.frequency.setValueAtTime(1_420, now);
    shriek.frequency.exponentialRampToValueAtTime(880, now + 0.14);
    shriek.frequency.exponentialRampToValueAtTime(1_680, now + 0.24);
    shriek.frequency.exponentialRampToValueAtTime(340, now + 0.54);

    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1_550;
    bp.Q.value = 2.2;

    sg.gain.setValueAtTime(0.18, now);
    sg.gain.exponentialRampToValueAtTime(0.0008, now + 0.56);

    shriek.connect(bp);
    bp.connect(sg);
    sg.connect(sink);
    shriek.start(now);
    shriek.stop(now + 0.58);
  }

  /** Fiandeiras secretando e esticando seda viscosa no corredor */
  playSpiderWebSpin(pan: number, distance: number, wallCount = 0): void {
    if (!this.isRunning() || !this.ctx) return;

    const acoustics = computeLabyrinthSoundAcoustics(distance, 19.0, wallCount);
    const sink = this.createSpatialWorldSink(pan, acoustics);
    if (!sink) return;

    const now = this.ctx.currentTime;

    this.triggerFilteredNoise(sink, now, 0.18, 2_550, 3.2, 0.11, 'crackle');

    const silk = this.ctx.createOscillator();
    const sg = this.ctx.createGain();
    silk.type = 'sine';
    silk.frequency.setValueAtTime(420, now);
    silk.frequency.exponentialRampToValueAtTime(790, now + 0.16);
    sg.gain.setValueAtTime(0.045, now);
    sg.gain.exponentialRampToValueAtTime(0.0006, now + 0.17);
    silk.connect(sg);
    sg.connect(sink);
    silk.start(now);
    silk.stop(now + 0.18);
  }

  /** Estalo viscoso e chicote de tensão quando o jogador pisa e fica preso numa armadilha de teia! */
  playWebTrapSnap(): void {
    if (
      !this.isRunning() ||
      !this.ctx ||
      !this.worldDryBus ||
      !this.reverbSend
    ) {
      return;
    }
    const now = this.ctx.currentTime;

    // 1. Corda elástica de seda disparando sob tensão
    const twang = this.ctx.createOscillator();
    const twangGain = this.ctx.createGain();
    twang.type = 'triangle';
    twang.frequency.setValueAtTime(325, now);
    twang.frequency.exponentialRampToValueAtTime(78, now + 0.27);
    twangGain.gain.setValueAtTime(0.24, now);
    twangGain.gain.exponentialRampToValueAtTime(0.0008, now + 0.29);
    twang.connect(twangGain);
    twangGain.connect(this.worldDryBus);
    twangGain.connect(this.reverbSend);
    twang.start(now);
    twang.stop(now + 0.31);

    // 2. Aderência pegajosa envolvendo as botas/traje
    this.triggerFilteredNoise(
      this.worldDryBus,
      now,
      0.24,
      1_520,
      1.6,
      0.2,
      'crackle',
      this.reverbSend
    );
    this.triggerFilteredNoise(
      this.worldDryBus,
      now + 0.04,
      0.18,
      580,
      1.2,
      0.14,
      'pink'
    );
  }

  /**
   * Som nítido e satisfatório de fios tensos de teia se rompendo/sendo cortados pela lâmina!
   */
  playWebCut(): void {
    if (
      !this.isRunning() ||
      !this.ctx ||
      !this.worldDryBus ||
      !this.reverbSend
    ) {
      return;
    }
    const now = this.ctx.currentTime;

    // Chicote agudo de fio esticado arrebentando e aliviando tensão
    const snap = this.ctx.createOscillator();
    const snapGain = this.ctx.createGain();
    snap.type = 'triangle';
    snap.frequency.setValueAtTime(480, now);
    snap.frequency.exponentialRampToValueAtTime(1_120, now + 0.055);
    snap.frequency.exponentialRampToValueAtTime(240, now + 0.16);

    snapGain.gain.setValueAtTime(0.16, now);
    snapGain.gain.exponentialRampToValueAtTime(0.0008, now + 0.17);

    snap.connect(snapGain);
    snapGain.connect(this.worldDryBus);
    snapGain.connect(this.reverbSend);
    snap.start(now);
    snap.stop(now + 0.18);

    this.triggerFilteredNoise(
      this.worldDryBus,
      now,
      0.12,
      2_850,
      2.3,
      0.15,
      'crackle',
      this.reverbSend
    );
  }

  playTaserDischarge(): void {
    if (!this.isRunning() || !this.ctx || !this.worldDryBus || !this.reverbSend) return;
    const now = this.ctx.currentTime;
    this.triggerFilteredNoise(this.worldDryBus, now, 0.22, 3100, 2.2, 0.22, 'crackle', this.reverbSend);
    const oscillator = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    oscillator.type = 'sawtooth';
    oscillator.frequency.setValueAtTime(1500, now);
    oscillator.frequency.exponentialRampToValueAtTime(500, now + 0.16);
    gain.gain.setValueAtTime(0.1, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
    oscillator.connect(gain); gain.connect(this.worldDryBus);
    oscillator.start(now); oscillator.stop(now + 0.21);
  }

  /**
   * Choque do taser na aranha: estalo elétrico seco, zumbido de rede e o
   * guincho do bicho travando as patas. Dura mais que o disparo da arma para
   * cobrir a convulsão inteira.
   */
  playSpiderShock(pan: number, distance: number, wallCount = 0): void {
    if (!this.isRunning() || !this.ctx || !this.worldDryBus) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const acoustics = computeLabyrinthSoundAcoustics(distance, 30, wallCount);
    const sink = this.createSpatialWorldSink(pan, {
      ...acoustics,
      dryGain: Math.max(0.12, acoustics.dryGain),
      wetSendGain: Math.max(0.16, acoustics.wetSendGain),
      audible: true,
    });
    if (!sink) return;

    // Estalo seco da descarga.
    this.triggerFilteredNoise(sink, now, 0.28, 3400, 2.6, 0.26, 'crackle');
    // Zumbido de 60 Hz modulado, como rede elétrica entrando na carcaça.
    const hum = ctx.createOscillator();
    const humGain = ctx.createGain();
    hum.type = 'sawtooth';
    hum.frequency.setValueAtTime(120, now);
    hum.frequency.exponentialRampToValueAtTime(74, now + 1.2);
    const humFilter = ctx.createBiquadFilter();
    humFilter.type = 'lowpass';
    humFilter.frequency.setValueAtTime(900, now);
    humFilter.frequency.exponentialRampToValueAtTime(320, now + 1.1);
    const stutter = ctx.createOscillator();
    const stutterGain = ctx.createGain();
    stutter.type = 'square';
    stutter.frequency.setValueAtTime(13, now);
    stutterGain.gain.value = 0.5;
    stutter.connect(stutterGain);
    stutterGain.connect(humGain.gain);
    humGain.gain.setValueAtTime(0.0001, now);
    humGain.gain.linearRampToValueAtTime(0.14, now + 0.05);
    humGain.gain.exponentialRampToValueAtTime(0.0008, now + 1.3);
    hum.connect(humFilter);
    humFilter.connect(humGain);
    humGain.connect(sink);
    hum.start(now);
    hum.stop(now + 1.35);
    stutter.start(now);
    stutter.stop(now + 1.35);

    // Guincho curto de dor/travamento.
    const cry = ctx.createOscillator();
    const cryGain = ctx.createGain();
    cry.type = 'sawtooth';
    cry.frequency.setValueAtTime(680, now + 0.06);
    cry.frequency.exponentialRampToValueAtTime(240, now + 0.9);
    const cryFilter = ctx.createBiquadFilter();
    cryFilter.type = 'bandpass';
    cryFilter.frequency.setValueAtTime(1300, now);
    cryFilter.frequency.exponentialRampToValueAtTime(600, now + 0.9);
    cryFilter.Q.value = 2.2;
    cryGain.gain.setValueAtTime(0.0001, now + 0.06);
    cryGain.gain.linearRampToValueAtTime(0.09, now + 0.12);
    cryGain.gain.exponentialRampToValueAtTime(0.0008, now + 0.95);
    cry.connect(cryFilter);
    cryFilter.connect(cryGain);
    cryGain.connect(sink);
    cry.start(now + 0.06);
    cry.stop(now + 1.0);
  }

  playShotgunBlast(): void {
    if (!this.isRunning() || !this.ctx || !this.worldDryBus || !this.reverbSend) return;
    const now = this.ctx.currentTime;
    this.triggerFilteredNoise(this.worldDryBus, now, 0.42, 1600, 0.8, 0.5, 'crackle', this.reverbSend);
    const osc = this.ctx.createOscillator(), gain = this.ctx.createGain();
    osc.type = 'sine'; osc.frequency.setValueAtTime(110, now);
    osc.frequency.exponentialRampToValueAtTime(35, now + 0.2);
    gain.gain.setValueAtTime(0.4, now); gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
    osc.connect(gain); gain.connect(this.worldDryBus); gain.connect(this.reverbSend);
    osc.start(now); osc.stop(now + 0.31);
  }

  /** Bote e aperto das patas longas da aranha capturando o jogador */
  playSpiderCaptureImpact(): void {
    if (
      !this.isRunning() ||
      !this.ctx ||
      !this.worldDryBus ||
      !this.reverbSend
    ) {
      return;
    }
    const now = this.ctx.currentTime;

    const sub = this.ctx.createOscillator();
    const subGain = this.ctx.createGain();
    sub.type = 'sawtooth';
    sub.frequency.setValueAtTime(124, now);
    sub.frequency.exponentialRampToValueAtTime(30, now + 0.38);

    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 390;

    subGain.gain.setValueAtTime(0.3, now);
    subGain.gain.exponentialRampToValueAtTime(0.0008, now + 0.4);

    sub.connect(lp);
    lp.connect(subGain);
    subGain.connect(this.worldDryBus);
    subGain.connect(this.reverbSend);
    sub.start(now);
    sub.stop(now + 0.42);

    this.triggerFilteredNoise(
      this.worldDryBus,
      now,
      0.26,
      1_120,
      1.35,
      0.23,
      'crackle',
      this.reverbSend
    );
  }

  /**
   * Ataque brutal em 1ª pessoa quando a Aranha Gigante alcança o jogador:
   * pancada corporal sub-grave + rasgo duplo de quelíceras L/R + grito no rosto + tinnitus de choque!
   */
  playSpiderBrutalAttack(): void {
    if (
      !this.isRunning() ||
      !this.ctx ||
      !this.worldDryBus ||
      !this.reverbSend
    ) {
      return;
    }
    const now = this.ctx.currentTime;

    const slam = this.ctx.createOscillator();
    const slamGain = this.ctx.createGain();
    slam.type = 'sawtooth';
    slam.frequency.setValueAtTime(155, now);
    slam.frequency.exponentialRampToValueAtTime(24, now + 0.58);

    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(620, now);
    lp.frequency.exponentialRampToValueAtTime(110, now + 0.58);

    slamGain.gain.setValueAtTime(0.38, now);
    slamGain.gain.exponentialRampToValueAtTime(0.0008, now + 0.62);

    slam.connect(lp);
    lp.connect(slamGain);
    slamGain.connect(this.worldDryBus);
    slamGain.connect(this.reverbSend);
    slam.start(now);
    slam.stop(now + 0.64);

    const slashes: ReadonlyArray<readonly [number, number, number]> = [
      [0.02, -0.72, 2_350],
      [0.15, 0.72, 1_780],
    ];
    for (const [delay, panVal, freq] of slashes) {
      const panner = this.ctx.createStereoPanner();
      panner.pan.value = panVal;
      panner.connect(this.worldDryBus);
      panner.connect(this.reverbSend);

      this.triggerFilteredNoise(
        panner,
        now + delay,
        0.24,
        freq,
        1.75,
        0.3,
        'crackle'
      );
    }

    this.lastSpiderScreamMs = 0;
    this.playSpiderScream(0, 0.6, 0);

    const ring = this.ctx.createOscillator();
    const ringGain = this.ctx.createGain();
    ring.type = 'sine';
    ring.frequency.setValueAtTime(2_920, now + 0.18);
    ring.frequency.exponentialRampToValueAtTime(2_580, now + 1.9);

    ringGain.gain.setValueAtTime(0.0001, now + 0.18);
    ringGain.gain.linearRampToValueAtTime(0.046, now + 0.36);
    ringGain.gain.exponentialRampToValueAtTime(0.0008, now + 1.95);

    ring.connect(ringGain);
    ringGain.connect(this.worldDryBus);
    ring.start(now + 0.18);
    ring.stop(now + 2.0);
  }

  /**
   * Puxão rítmico do corpo sendo arrastado pela pedra fria pelas garras dianteiras da Aranha!
   */
  playBodyDragPull(): void {
    if (
      !this.isRunning() ||
      !this.ctx ||
      !this.worldDryBus ||
      !this.reverbSend
    ) {
      return;
    }
    const now = this.ctx.currentTime;

    // Atrito pesado do traje contra a pedra + pedregulhos espalhando
    this.triggerFilteredNoise(
      this.worldDryBus,
      now,
      0.36,
      360,
      0.9,
      0.2,
      'gritty',
      this.reverbSend
    );
    this.triggerFilteredNoise(
      this.worldDryBus,
      now + 0.04,
      0.24,
      1_650,
      1.8,
      0.095,
      'crackle',
      this.reverbSend
    );

    const thud = this.ctx.createOscillator();
    const thudGain = this.ctx.createGain();
    thud.type = 'triangle';
    thud.frequency.setValueAtTime(82, now);
    thud.frequency.exponentialRampToValueAtTime(28, now + 0.24);
    thudGain.gain.setValueAtTime(0.18, now);
    thudGain.gain.exponentialRampToValueAtTime(0.0008, now + 0.26);

    thud.connect(thudGain);
    thudGain.connect(this.worldDryBus);
    thudGain.connect(this.reverbSend);
    thud.start(now);
    thud.stop(now + 0.27);
  }

  /** Fôlego ofegante no capacete + rasgo de fios viscosos ao despertar no ninho ou ser resgatado */
  playWakeUpGasp(): void {
    if (
      !this.isRunning() ||
      !this.ctx ||
      !this.worldDryBus ||
      !this.reverbSend
    ) {
      return;
    }
    const now = this.ctx.currentTime;

    this.triggerFilteredNoise(
      this.worldDryBus,
      now,
      0.4,
      740,
      1.35,
      0.16,
      'pink',
      this.reverbSend
    );
    this.triggerFilteredNoise(
      this.worldDryBus,
      now + 0.14,
      0.2,
      2_050,
      2.3,
      0.095,
      'crackle'
    );
  }

  /** Morte permanente: golpe letal + queda abissal + sinal vital do traje encerrando */
  playPermanentDeath(): void {
    if (
      !this.isRunning() ||
      !this.ctx ||
      !this.worldDryBus ||
      !this.reverbSend
    ) {
      return;
    }
    const now = this.ctx.currentTime;

    this.playSpiderBrutalAttack();

    const abyss = this.ctx.createOscillator();
    const abyssGain = this.ctx.createGain();
    abyss.type = 'sine';
    abyss.frequency.setValueAtTime(96, now + 0.12);
    abyss.frequency.exponentialRampToValueAtTime(21, now + 1.85);
    abyssGain.gain.setValueAtTime(0.34, now + 0.12);
    abyssGain.gain.exponentialRampToValueAtTime(0.0008, now + 1.95);

    abyss.connect(abyssGain);
    abyssGain.connect(this.worldDryBus);
    abyss.start(now + 0.12);
    abyss.stop(now + 2.0);

    const flat = this.ctx.createOscillator();
    const flatGain = this.ctx.createGain();
    flat.type = 'sine';
    flat.frequency.setValueAtTime(988, now + 0.55);
    flatGain.gain.setValueAtTime(0.0001, now + 0.55);
    flatGain.gain.linearRampToValueAtTime(0.055, now + 0.75);
    flatGain.gain.exponentialRampToValueAtTime(0.0008, now + 3.2);

    flat.connect(flatGain);
    flatGain.connect(this.worldDryBus);
    flat.start(now + 0.55);
    flat.stop(now + 3.25);
  }

  /** Esforço físico e tensão nos fios ao tentar se soltar da teia */
  playStruggleEffort(): void {
    if (!this.isRunning() || !this.ctx || !this.worldDryBus) return;
    const now = this.ctx.currentTime;
    this.triggerFilteredNoise(
      this.worldDryBus,
      now,
      0.085,
      820 + Math.random() * 440,
      1.45,
      0.115,
      'crackle',
      this.reverbSend ?? undefined
    );
  }

  // ==========================================================================
  // 7. RADAR TOPOGRÁFICO, RÁDIO CO-OP, PING 3D & BATIMENTO CARDÍACO ANATÔMICO
  // ==========================================================================

  /** Bip de sonar CRT com clique de relé e harmônico cristalino */
  playRadarPing(activating: boolean): void {
    if (!this.isRunning() || !this.ctx || !this.worldDryBus) return;
    const now = this.ctx.currentTime;

    this.triggerFilteredNoise(
      this.worldDryBus,
      now,
      0.008,
      2_900,
      3.0,
      0.045,
      'white'
    );

    const notes: ReadonlyArray<readonly [number, number, number]> = activating
      ? [
          [0, 660, 0.058],
          [0.068, 990, 0.072],
        ]
      : [[0, 510, 0.052]];

    for (const [delay, freq, vol] of notes) {
      const t = now + delay;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, t);
      osc.frequency.exponentialRampToValueAtTime(freq * 1.035, t + 0.1);

      gain.gain.setValueAtTime(vol, t);
      gain.gain.exponentialRampToValueAtTime(0.0008, t + 0.16);

      osc.connect(gain);
      gain.connect(this.worldDryBus);
      if (this.reverbSend) gain.connect(this.reverbSend);
      osc.start(t);
      osc.stop(t + 0.17);
    }
  }

  /**
   * Trilha percussiva rítmica das danças do Astronauta:
   * um "tum-tum" grave do traje (impacto do capacete no colarinho) com um
   * clique metálico curto, mantendo o timbre do laboratório (sintético 8-bit).
   */
  playDanceBeat(danceId: string, accent = false): void {
    if (
      this.worldPaused ||
      !this.isRunning() ||
      !this.ctx ||
      !this.worldDryBus
    ) {
      return;
    }
    const now = this.ctx.currentTime;
    const heavy = danceId === 'robot' || danceId === 'jog';
    const baseHz = heavy ? 96 : 132;

    const thump = this.ctx.createOscillator();
    const thumpGain = this.ctx.createGain();
    thump.type = 'sine';
    thump.frequency.setValueAtTime(baseHz * (accent ? 1.22 : 1), now);
    thump.frequency.exponentialRampToValueAtTime(baseHz * 0.55, now + 0.11);

    thumpGain.gain.setValueAtTime(accent ? 0.075 : 0.05, now);
    thumpGain.gain.exponentialRampToValueAtTime(0.0006, now + 0.13);

    const thumpFilter = this.ctx.createBiquadFilter();
    thumpFilter.type = 'lowpass';
    thumpFilter.frequency.value = 520;

    thump.connect(thumpFilter);
    thumpFilter.connect(thumpGain);
    thumpGain.connect(this.worldDryBus);
    if (this.reverbSend) thumpGain.connect(this.reverbSend);
    thump.start(now);
    thump.stop(now + 0.14);

    // Clique metálico do capacete (colarinho pressurizado) no ataque
    this.triggerFilteredNoise(
      this.worldDryBus,
      now,
      0.024,
      accent ? 3_400 : 2_500,
      4.2,
      accent ? 0.036 : 0.024,
      'white'
    );
  }

  /**
   * Pequena fanfarra ascendente (caixa de música do capacete) ao começar uma
   * coreografia nova.
   */
  playDanceStart(danceId: string): void {
    if (
      this.worldPaused ||
      !this.isRunning() ||
      !this.ctx ||
      !this.worldDryBus
    ) {
      return;
    }
    const now = this.ctx.currentTime;
    const roots: Record<string, number> = {
      robot: 392,
      samba: 330,
      march: 294,
      spin: 349,
      floss: 440,
      jog: 370,
    };
    const root = roots[danceId] ?? 349;
    const steps = [0, 4, 7, 12];

    steps.forEach((semi, idx) => {
      const t = now + idx * 0.062;
      const osc = this.ctx!.createOscillator();
      const gain = this.ctx!.createGain();
      osc.type = idx % 2 === 0 ? 'square' : 'triangle';
      const freq = root * Math.pow(2, semi / 12);
      osc.frequency.setValueAtTime(freq, t);

      gain.gain.setValueAtTime(0.001, t);
      gain.gain.linearRampToValueAtTime(0.036, t + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0006, t + 0.19);

      const filter = this.ctx!.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 2_600;

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(this.worldDryBus!);
      if (this.reverbSend) gain.connect(this.reverbSend);
      osc.start(t);
      osc.stop(t + 0.2);
    });
  }

  /** Desligamento da coreografia: dois tons descendentes (capacete desligando). */
  playDanceStop(): void {
    if (
      this.worldPaused ||
      !this.isRunning() ||
      !this.ctx ||
      !this.worldDryBus
    ) {
      return;
    }
    const now = this.ctx.currentTime;
    const notes: ReadonlyArray<readonly [number, number]> = [
      [0, 520],
      [0.07, 330],
    ];
    for (const [delay, freq] of notes) {
      const t = now + delay;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, t);
      osc.frequency.exponentialRampToValueAtTime(freq * 0.72, t + 0.12);

      gain.gain.setValueAtTime(0.03, t);
      gain.gain.exponentialRampToValueAtTime(0.0006, t + 0.15);

      osc.connect(gain);
      gain.connect(this.worldDryBus);
      if (this.reverbSend) gain.connect(this.reverbSend);
      osc.start(t);
      osc.stop(t + 0.16);
    }
  }

  /**
   * Clique autêntico de câmbio / squelch de rádio do capacete EVA ao apertar/soltar Push-to-Talk `[B]`
   * ou ao receber transmissão de texto no esquadrão!
   */
  playRadioSquelch(opening: boolean): void {
    const nowMs = performance.now();
    if (nowMs - this.lastRadioSquelchMs < 55) return;
    this.lastRadioSquelchMs = nowMs;

    if (!this.isRunning() || !this.ctx || !this.terminalBus) return;
    const now = this.ctx.currentTime;

    // Curto chiado VHF filtrado + bip NASA discreto (Quindar-style micro-tone)
    this.triggerFilteredNoise(
      this.terminalBus,
      now,
      opening ? 0.018 : 0.026,
      2_250,
      2.6,
      0.052,
      'white'
    );

    const tone = this.ctx.createOscillator();
    const tg = this.ctx.createGain();
    tone.type = 'sine';
    tone.frequency.setValueAtTime(opening ? 2_525 : 2_475, now);
    tg.gain.setValueAtTime(0.024, now);
    tg.gain.exponentialRampToValueAtTime(0.0005, now + 0.032);
    tone.connect(tg);
    tg.connect(this.terminalBus);
    tone.start(now);
    tone.stop(now + 0.036);
  }

  /** Destravamento eletromagnético + sopro pneumático de comporta blindada (ou bip de acesso negado) */
  playBlastDoorUnlock(unlocked: boolean): void {
    if (!this.isRunning() || !this.ctx || !this.worldDryBus) return;
    const now = this.ctx.currentTime;

    if (!unlocked) {
      for (const delay of [0, 0.09]) {
        const t = now + delay;
        const osc = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(195, t);
        g.gain.setValueAtTime(0.055, t);
        g.gain.exponentialRampToValueAtTime(0.0008, t + 0.068);
        osc.connect(g);
        g.connect(this.worldDryBus);
        osc.start(t);
        osc.stop(t + 0.072);
      }
      return;
    }

    // 1. Bip duplo de autorização da chave codificada
    for (const [delay, freq] of [
      [0, 740],
      [0.065, 1_110],
    ] as const) {
      const t = now + delay;
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, t);
      g.gain.setValueAtTime(0.062, t);
      g.gain.exponentialRampToValueAtTime(0.0008, t + 0.09);
      osc.connect(g);
      g.connect(this.worldDryBus);
      if (this.reverbSend) g.connect(this.reverbSend);
      osc.start(t);
      osc.stop(t + 0.095);
    }

    // 2. Destravamento metálico pesado + sopro hidráulico da comporta deslizando
    this.triggerFilteredNoise(
      this.worldDryBus,
      now + 0.12,
      0.045,
      360,
      2.2,
      0.11,
      'gritty',
      this.reverbSend ?? undefined
    );
    this.triggerFilteredNoise(
      this.worldDryBus,
      now + 0.16,
      0.46,
      1_450,
      1.3,
      0.075,
      'pink',
      this.reverbSend ?? undefined
    );
  }

  /**
   * Abrir um caixote de suprimento lacrado: estalo da fivela de latão, ranger
   * seco das dobradiças de ferro e a tampa batendo no batente de madeira.
   */
  playCrateOpen(): void {
    if (
      !this.isRunning() ||
      !this.ctx ||
      !this.worldDryBus ||
      !this.reverbSend
    ) {
      return;
    }
    const now = this.ctx.currentTime;

    // 1. Fivela de latão saltando.
    for (const [delay, freq] of [
      [0, 900],
      [0.045, 1_340],
    ] as const) {
      const t = now + delay;
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = 'square';
      osc.frequency.setValueAtTime(freq, t);
      osc.frequency.exponentialRampToValueAtTime(freq * 0.62, t + 0.055);
      g.gain.setValueAtTime(0.05, t);
      g.gain.exponentialRampToValueAtTime(0.0008, t + 0.07);
      osc.connect(g);
      g.connect(this.worldDryBus);
      osc.start(t);
      osc.stop(t + 0.075);
    }

    // 2. Dobradiça de ferro rangendo ao levantar a tampa.
    const hinge = this.ctx.createOscillator();
    const hingeGain = this.ctx.createGain();
    hinge.type = 'sawtooth';
    hinge.frequency.setValueAtTime(158, now + 0.06);
    hinge.frequency.linearRampToValueAtTime(232, now + 0.34);
    hingeGain.gain.setValueAtTime(0.001, now + 0.06);
    hingeGain.gain.linearRampToValueAtTime(0.032, now + 0.16);
    hingeGain.gain.exponentialRampToValueAtTime(0.0008, now + 0.42);
    hinge.connect(hingeGain);
    hingeGain.connect(this.worldDryBus);
    hingeGain.connect(this.reverbSend);
    hinge.start(now + 0.06);
    hinge.stop(now + 0.44);

    // 3. Madeira raspando e a tampa encostando para trás.
    this.triggerFilteredNoise(
      this.worldDryBus,
      now + 0.08,
      0.22,
      780,
      1.2,
      0.075,
      'gritty',
      this.reverbSend
    );
    this.triggerFilteredNoise(
      this.worldDryBus,
      now + 0.36,
      0.11,
      240,
      1.9,
      0.1,
      'pink',
      this.reverbSend
    );
  }

  /** Sinalizador acústico tático 3D (`[V]`): tom duplo limpo para posição ou alerta urgente para PERIGO! */
  playTacticalPingSound(danger: boolean, pan = 0): void {
    if (!this.isRunning() || !this.ctx || !this.worldDryBus) return;
    const now = this.ctx.currentTime;

    const panner = this.ctx.createStereoPanner();
    panner.pan.value = Math.max(-0.9, Math.min(0.9, pan));
    panner.connect(this.worldDryBus);
    if (this.reverbSend) panner.connect(this.reverbSend);

    const seq: ReadonlyArray<readonly [number, number]> = danger
      ? [
          [0, 880],
          [0.075, 1_320],
          [0.15, 880],
        ]
      : [
          [0, 740],
          [0.08, 1_110],
        ];

    for (const [delay, hz] of seq) {
      const t = now + delay;
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = danger ? 'triangle' : 'sine';
      osc.frequency.setValueAtTime(hz, t);
      g.gain.setValueAtTime(danger ? 0.072 : 0.055, t);
      g.gain.exponentialRampToValueAtTime(0.0006, t + 0.11);
      osc.connect(g);
      g.connect(panner);
      osc.start(t);
      osc.stop(t + 0.12);
    }
  }

  /**
   * Batimento cardíaco anatômico ("lub-dub") com fluxo arterial grave e respiração trêmula no visor
   * durante perseguição próxima da Aranha ou saúde crítica!
   */
  playTensionHeartbeat(intensity: number): void {
    const clamped = Math.max(0, Math.min(1, intensity));
    if (clamped < 0.12) return;

    const nowMs = performance.now();
    const beatIntervalMs = 920 - clamped * 470;
    if (nowMs - this.lastHeartbeatMs < beatIntervalMs) return;
    this.lastHeartbeatMs = nowMs;

    if (this.worldPaused || !this.isRunning() || !this.ctx || !this.worldDryBus) {
      return;
    }
    const now = this.ctx.currentTime;

    const pulses: ReadonlyArray<readonly [number, number, number]> = [
      [0, 64, 0.135 * clamped],
      [0.165, 51, 0.095 * clamped],
    ];
    for (const [delay, freq, vol] of pulses) {
      const t = now + delay;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, t);
      osc.frequency.exponentialRampToValueAtTime(26, t + 0.12);

      gain.gain.setValueAtTime(vol, t);
      gain.gain.exponentialRampToValueAtTime(0.0008, t + 0.13);

      osc.connect(gain);
      gain.connect(this.worldDryBus);
      osc.start(t);
      osc.stop(t + 0.14);

      // Ressonância sanguínea abafada interna no ouvido
      this.triggerFilteredNoise(
        this.worldDryBus,
        t,
        0.09,
        145,
        1.1,
        vol * 0.42,
        'pink'
      );
    }

    // Fôlego curto de adrenalina no capacete em pânico alto
    if (clamped > 0.58) {
      this.triggerFilteredNoise(
        this.worldDryBus,
        now + 0.28,
        0.19,
        840,
        1.5,
        0.028 * clamped,
        'pink'
      );
    }
  }

  private triggerFilteredNoise(
    dest: AudioNode,
    startTime: number,
    duration: number,
    freq: number,
    q: number,
    volume: number,
    texture: 'white' | 'pink' | 'gritty' | 'crackle',
    extraSend?: AudioNode
  ): void {
    const buf =
      texture === 'pink'
        ? this.pinkNoiseBuffer
        : texture === 'gritty'
          ? this.grittyNoiseBuffer
          : texture === 'crackle'
            ? this.crackleNoiseBuffer
            : this.noiseBuffer;
    if (!this.ctx || !buf || volume <= 0.0004) return;

    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const maxOffset = Math.max(0, buf.duration - duration - 0.05);
    const offset = Math.random() * maxOffset;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = Math.max(40, Math.min(18_000, freq));
    filter.Q.value = q;

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(volume, startTime);
    gain.gain.exponentialRampToValueAtTime(0.0006, startTime + duration);

    src.connect(filter);
    filter.connect(gain);
    gain.connect(dest);
    if (extraSend) {
      gain.connect(extraSend);
    }

    src.start(startTime, offset, duration + 0.015);
  }

  dispose(): void {
    if (this.pulseTimerId) {
      window.clearInterval(this.pulseTimerId);
      this.pulseTimerId = 0;
    }
    this.stopCoalesceDrone();
    // Encerra também a trilha da tela inicial (e o motivo que se reagenda).
    this.stopTitlePad(0.2);
    this.stopBootBed(0.2);
    this.stopTerminalPowerBed(0.2);
    if (this.ctx) {
      void this.ctx.close();
      this.ctx = null;
    }
  }
}
