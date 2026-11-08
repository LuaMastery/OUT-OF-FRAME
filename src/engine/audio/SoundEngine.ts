import * as THREE from 'three';

export type FloorMaterialKind = 'tech' | 'stone';

/**
 * Motor de Áudio Unificado (SoundEngine) — combina e processa em um único barramento
 * todos os sons do Terminal, da Convergência Binária e do Labirinto estilo DOOM Clássico.
 *
 * Cadeia de processamento (DSP):
 *   [Vozes / Foley / Espacialização Estéreo]
 *      ├── Dry Bus ──────────────────────┐
 *      └── Convolver Reverb (Corredor) ──┼──► Soft Saturation ─► Compressor ─► Master
 */
export class SoundEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private terminalBus: GainNode | null = null;
  private worldDryBus: GainNode | null = null;
  private reverbSend: GainNode | null = null;

  private noiseBuffer: AudioBuffer | null = null;
  private grittyNoiseBuffer: AudioBuffer | null = null;

  // Tensão contínua da Convergência Binária
  private coalesceDroneGain: GainNode | null = null;
  private coalesceDroneFilter: BiquadFilterNode | null = null;
  private coalesceOscA: OscillatorNode | null = null;
  private coalesceOscB: OscillatorNode | null = null;
  private lastGrainMs = 0;

  // Ambiência espacial e industrial do Labirinto DOOM
  private dungeonStarted = false;
  private lampBuzzGain: GainNode | null = null;
  private lampBuzzPanner: StereoPannerNode | null = null;
  private pulseTimerId = 0;
  private lastWallThudMs = 0;
  private lastSparkMs = 0;

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
    master.gain.value = 0.78;
    master.connect(ctx.destination);
    this.masterGain = master;

    // Compressor mestre para colar transientes e evitar qualquer saturação digital ríspida
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 14;
    comp.ratio.value = 3.5;
    comp.attack.value = 0.004;
    comp.release.value = 0.18;
    comp.connect(master);

    // Leve saturação analógica quente (estilo placa de som anos 90)
    const shaper = ctx.createWaveShaper();
    shaper.curve = this.createWarmCurve(512);
    shaper.oversample = '2x';
    shaper.connect(comp);

    const terminalBus = ctx.createGain();
    terminalBus.gain.value = 0.9;
    terminalBus.connect(shaper);
    this.terminalBus = terminalBus;

    const worldDry = ctx.createGain();
    worldDry.gain.value = 0.92;
    worldDry.connect(shaper);
    this.worldDryBus = worldDry;

    // Reverb convolucional sintético de corredor de pedra/metal (1.35s)
    const convolver = ctx.createConvolver();
    convolver.buffer = this.buildStoneCorridorImpulse(ctx, 1.35);

    const reverbSend = ctx.createGain();
    reverbSend.gain.value = 0.42;
    reverbSend.connect(convolver);

    const reverbReturn = ctx.createGain();
    reverbReturn.gain.value = 0.65;
    convolver.connect(reverbReturn);
    reverbReturn.connect(shaper);
    this.reverbSend = reverbSend;

    // Buffers reutilizáveis de ruído (fino e "gritty" 11kHz estilo SoundBlaster DOOM)
    this.noiseBuffer = this.buildNoiseBuffer(ctx, 1.0, 1);
    this.grittyNoiseBuffer = this.buildNoiseBuffer(ctx, 1.0, 4);
  }

  private createWarmCurve(samples: number): Float32Array<ArrayBuffer> {
    const buf = new ArrayBuffer(samples * 4);
    const curve = new Float32Array(buf);
    const k = 1.6;
    const norm = Math.tanh(k);
    for (let i = 0; i < samples; i++) {
      const x = (i * 2) / (samples - 1) - 1;
      curve[i] = Math.tanh(k * x) / norm;
    }
    return curve;
  }

  /**
   * Gera resposta ao impulso estéreo simulando reflexões curtas de paredes de pedra
   * seguidas de cauda difusa escura.
   */
  private buildStoneCorridorImpulse(
    ctx: AudioContext,
    seconds: number
  ): AudioBuffer {
    const rate = ctx.sampleRate;
    const length = Math.floor(rate * seconds);
    const impulse = ctx.createBuffer(2, length, rate);

    const earlyDelays = [0.013, 0.024, 0.039, 0.058, 0.083];

    for (let ch = 0; ch < 2; ch++) {
      const data = impulse.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < length; i++) {
        const t = i / rate;
        const env = Math.pow(1 - t / seconds, 2.6);
        const white = Math.random() * 2 - 1;
        // Filtro passa-baixas progressivo: paredes de pedra absorvem agudos rápido
        const damp = Math.max(0.08, 0.48 - t * 0.28);
        lp += (white - lp) * damp;
        data[i] = lp * env * 0.48;
      }

      // Reflexões iniciais discretas dos corredores estreitos
      earlyDelays.forEach((delaySec, idx) => {
        const offset = Math.floor((delaySec + ch * 0.0035) * rate);
        if (offset < length) {
          data[offset] += (idx % 2 === 0 ? 1 : -1) * (0.38 / (idx + 1));
        }
      });
    }

    return impulse;
  }

  private buildNoiseBuffer(
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
        // Quantização de amplitude sutil estilo PCM 8-bit dos anos 90
        current = Math.round((Math.random() * 2 - 1) * 16) / 16;
      }
      data[i] = current;
    }
    return buffer;
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
      1800,
      2.2,
      0.09,
      false
    );

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(460, now);
    osc.frequency.exponentialRampToValueAtTime(210, now + 0.026);

    gain.gain.setValueAtTime(0.065, now);
    gain.gain.exponentialRampToValueAtTime(0.0008, now + 0.03);

    osc.connect(gain);
    gain.connect(this.terminalBus);
    osc.start(now);
    osc.stop(now + 0.032);
  }

  /** Avanço da barra de progresso combinando pulso harmônico + micro-seek de disco */
  loadingStep(pct: number): void {
    if (!this.isRunning() || !this.ctx || !this.terminalBus) return;
    const now = this.ctx.currentTime;

    // Duplo estalido sutil de atuador de disco rígido clássico
    this.triggerFilteredNoise(
      this.terminalBus,
      now,
      0.012,
      1350 + pct * 6,
      3.0,
      0.08,
      false
    );
    this.triggerFilteredNoise(
      this.terminalBus,
      now + 0.028,
      0.01,
      1650 + pct * 5,
      3.2,
      0.055,
      false
    );

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(260 + pct * 2.4, now);

    gain.gain.setValueAtTime(0.06, now);
    gain.gain.exponentialRampToValueAtTime(0.0008, now + 0.042);

    osc.connect(gain);
    gain.connect(this.terminalBus);
    osc.start(now);
    osc.stop(now + 0.045);
  }

  /** Acorde curto e limpo de inicialização concluída ao abrir a Área de Trabalho */
  desktopReady(): void {
    if (!this.isRunning() || !this.ctx || !this.terminalBus) return;
    const now = this.ctx.currentTime;

    const notes = [330, 495, 660];
    notes.forEach((freq, idx) => {
      if (!this.ctx || !this.terminalBus) return;
      const t = now + idx * 0.065;

      const osc = this.ctx.createOscillator();
      const filter = this.ctx.createBiquadFilter();
      const gain = this.ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, t);

      filter.type = 'lowpass';
      filter.frequency.value = 2100;

      gain.gain.setValueAtTime(0.075, t);
      gain.gain.exponentialRampToValueAtTime(0.0008, t + 0.18);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(this.terminalBus);
      osc.start(t);
      osc.stop(t + 0.19);
    });
  }

  /** Tecla mecânica multicamada (click do switch + corpo plástico + micro-variação) */
  keyType(isSpace = false): void {
    if (!this.isRunning() || !this.ctx || !this.terminalBus) return;
    const now = this.ctx.currentTime;
    const jitter = 0.95 + Math.random() * 0.1;

    // Camada 1: Click agudo do switch mecânico
    this.triggerFilteredNoise(
      this.terminalBus,
      now,
      0.009,
      (isSpace ? 2200 : 3300) * jitter,
      2.4,
      0.13,
      false
    );

    // Camada 2: Ressonância grave da tecla batendo na base ("thock")
    const body = this.ctx.createOscillator();
    const bodyGain = this.ctx.createGain();
    body.type = 'triangle';
    const f0 = (isSpace ? 155 : 225) * jitter;
    body.frequency.setValueAtTime(f0, now);
    body.frequency.exponentialRampToValueAtTime(68, now + 0.024);

    bodyGain.gain.setValueAtTime(isSpace ? 0.095 : 0.075, now);
    bodyGain.gain.exponentialRampToValueAtTime(0.0008, now + 0.026);

    body.connect(bodyGain);
    bodyGain.connect(this.terminalBus);
    body.start(now);
    body.stop(now + 0.028);
  }

  keyBackspace(): void {
    if (!this.isRunning() || !this.ctx || !this.terminalBus) return;
    const now = this.ctx.currentTime;

    this.triggerFilteredNoise(
      this.terminalBus,
      now,
      0.014,
      1850,
      2.0,
      0.12,
      false
    );

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(165, now);
    osc.frequency.exponentialRampToValueAtTime(62, now + 0.032);

    gain.gain.setValueAtTime(0.085, now);
    gain.gain.exponentialRampToValueAtTime(0.0008, now + 0.035);

    osc.connect(gain);
    gain.connect(this.terminalBus);
    osc.start(now);
    osc.stop(now + 0.038);
  }

  keyEnter(): void {
    if (!this.isRunning() || !this.ctx || !this.terminalBus) return;
    const now = this.ctx.currentTime;

    this.triggerFilteredNoise(
      this.terminalBus,
      now,
      0.018,
      2450,
      1.8,
      0.15,
      false
    );

    // Duplo harmônico tátil de confirmação
    const freqs = [290, 435];
    freqs.forEach((f, idx) => {
      if (!this.ctx || !this.terminalBus) return;
      const t = now + idx * 0.022;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(f, t);
      osc.frequency.exponentialRampToValueAtTime(f * 0.72, t + 0.045);

      gain.gain.setValueAtTime(0.075, t);
      gain.gain.exponentialRampToValueAtTime(0.0008, t + 0.05);

      osc.connect(gain);
      gain.connect(this.terminalBus);
      osc.start(t);
      osc.stop(t + 0.055);
    });
  }

  menuMove(): void {
    if (!this.isRunning() || !this.ctx || !this.terminalBus) return;
    const now = this.ctx.currentTime;

    this.triggerFilteredNoise(
      this.terminalBus,
      now,
      0.007,
      3600,
      3.5,
      0.075,
      false
    );

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(780, now);
    osc.frequency.exponentialRampToValueAtTime(520, now + 0.018);

    gain.gain.setValueAtTime(0.05, now);
    gain.gain.exponentialRampToValueAtTime(0.0008, now + 0.02);

    osc.connect(gain);
    gain.connect(this.terminalBus);
    osc.start(now);
    osc.stop(now + 0.022);
  }

  windowOpen(): void {
    if (!this.isRunning() || !this.ctx || !this.terminalBus) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(320, now);
    osc.frequency.exponentialRampToValueAtTime(540, now + 0.055);

    gain.gain.setValueAtTime(0.075, now);
    gain.gain.exponentialRampToValueAtTime(0.0008, now + 0.06);

    osc.connect(gain);
    gain.connect(this.terminalBus);
    osc.start(now);
    osc.stop(now + 0.065);
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
      osc.frequency.setValueAtTime(140, t);

      filter.type = 'lowpass';
      filter.frequency.value = 680;

      gain.gain.setValueAtTime(0.085, t);
      gain.gain.exponentialRampToValueAtTime(0.0008, t + 0.06);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(this.terminalBus);
      osc.start(t);
      osc.stop(t + 0.065);
    }
  }

  // ==========================================================================
  // 2. CONVERGÊNCIA BINÁRIA & INTERFACE SUPERHOT (out_of_frame.exe)
  // ==========================================================================

  startBinaryProgramSequence(): void {
    if (!this.isRunning() || !this.ctx || !this.terminalBus) return;
    const now = this.ctx.currentTime;

    // Pulso grave inicial quando surge "Este programa ainda está em desenvolvimento."
    const sub = this.ctx.createOscillator();
    const subGain = this.ctx.createGain();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(146.8, now); // D3
    sub.frequency.exponentialRampToValueAtTime(73.4, now + 0.45); // D2
    subGain.gain.setValueAtTime(0.14, now);
    subGain.gain.exponentialRampToValueAtTime(0.0008, now + 0.5);
    sub.connect(subGain);
    subGain.connect(this.terminalBus);
    sub.start(now);
    sub.stop(now + 0.52);

    // Prepara drone magnético crescente que acompanha a junção dos bits 0 e 1
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
    oscA.frequency.value = 73.42; // D2
    oscA.connect(filter);
    oscA.start(now);
    this.coalesceOscA = oscA;

    const oscB = this.ctx.createOscillator();
    oscB.type = 'triangle';
    oscB.frequency.value = 110.0; // A2 (quinta justa)
    oscB.connect(filter);
    oscB.start(now);
    this.coalesceOscB = oscB;
  }

  /**
   * Atualiza o drone magnético e dispara grãos cristalinos estéreo conforme os '0' e '1'
   * despertam aos poucos e se encaixam na grade.
   */
  binaryCoalesceGrain(progress: number, lockedFraction: number): void {
    if (!this.isRunning() || !this.ctx || !this.terminalBus) return;
    const now = this.ctx.currentTime;

    if (this.coalesceDroneGain && this.coalesceDroneFilter) {
      this.coalesceDroneGain.gain.setTargetAtTime(
        0.015 + progress * 0.055,
        now,
        0.06
      );
      this.coalesceDroneFilter.frequency.setTargetAtTime(
        120 + Math.pow(progress, 1.7) * 1450,
        now,
        0.06
      );
    }

    const nowMs = performance.now();
    const minGapMs = 170 - progress * 134;
    if (nowMs - this.lastGrainMs < minGapMs) return;
    this.lastGrainMs = nowMs;

    // Escala harmônica pentatônica/menor cristalina para os bits 0/1 se agrupando
    const scale = [293.66, 329.63, 440.0, 587.33, 659.25, 880.0, 1174.66];
    const maxIdx = Math.min(
      scale.length - 1,
      Math.floor(1 + lockedFraction * (scale.length - 1))
    );
    const freq = scale[Math.floor(Math.random() * (maxIdx + 1))];

    const panner = this.ctx.createStereoPanner();
    // Começa espalhado nas bordas do estéreo e converge para o centro quando trava!
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

  /** Travamento magnético final quando a interface estilo Superhot termina de montar */
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
      false
    );

    // Impacto grave + quinta cristalina
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
      false
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
  // 3. TRANSIÇÃO E PAISAGEM SONORA DO LABIRINTO ESTILO DOOM CLÁSSICO
  // ==========================================================================

  /**
   * Crossfade contínuo do Terminal para a atmosfera reverberante do Labirinto DOOM.
   */
  enterDoomLabyrinth(): void {
    this.stopCoalesceDrone();
    if (!this.isRunning() || !this.ctx || !this.worldDryBus || !this.reverbSend) {
      return;
    }
    const ctx = this.ctx;
    const now = ctx.currentTime;

    // Impacto dramático estilo abertura de porta/elevador pesado do DOOM clássico
    this.triggerFilteredNoise(
      this.worldDryBus,
      now,
      0.38,
      260,
      1.2,
      0.28,
      true,
      this.reverbSend
    );

    const boom = ctx.createOscillator();
    const boomGain = ctx.createGain();
    boom.type = 'sawtooth';
    boom.frequency.setValueAtTime(82.41, now); // E2
    boom.frequency.exponentialRampToValueAtTime(41.2, now + 0.55); // E1

    const boomFilter = ctx.createBiquadFilter();
    boomFilter.type = 'lowpass';
    boomFilter.frequency.setValueAtTime(620, now);
    boomFilter.frequency.exponentialRampToValueAtTime(140, now + 0.55);

    boomGain.gain.setValueAtTime(0.22, now);
    boomGain.gain.exponentialRampToValueAtTime(0.0008, now + 0.6);

    boom.connect(boomFilter);
    boomFilter.connect(boomGain);
    boomGain.connect(this.worldDryBus);
    boomGain.connect(this.reverbSend);
    boom.start(now);
    boom.stop(now + 0.62);

    if (!this.dungeonStarted) {
      this.dungeonStarted = true;
      this.startDungeonAtmosphere(ctx);
    }
  }

  /**
   * Atmosfera sombria estilo DOOM (E1M2 / E1M8):
   * Sub-drone industrial em Mi Frígio (E1 + B1), ar subterrâneo nos corredores
   * e zumbido elétrico espacializado para as luminárias LITE5 próximas.
   */
  private startDungeonAtmosphere(ctx: AudioContext): void {
    if (!this.worldDryBus || !this.reverbSend) return;

    const bus = ctx.createGain();
    bus.gain.setValueAtTime(0.001, ctx.currentTime);
    bus.gain.setTargetAtTime(1.0, ctx.currentTime + 0.15, 0.8);
    bus.connect(this.worldDryBus);

    // 1. Drone escuro subterrâneo filtrado (E1 = 41.2Hz + B1 = 61.74Hz)
    const droneFilter = ctx.createBiquadFilter();
    droneFilter.type = 'lowpass';
    droneFilter.frequency.value = 145;
    droneFilter.Q.value = 2.8;

    const droneGain = ctx.createGain();
    droneGain.gain.value = 0.055;
    droneFilter.connect(droneGain);
    droneGain.connect(bus);
    droneGain.connect(this.reverbSend);

    // LFO lento modulando o filtro do drone para sensação orgânica de masmorra/base
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.type = 'sine';
    lfo.frequency.value = 0.11;
    lfoGain.gain.value = 55;
    lfo.connect(lfoGain);
    lfoGain.connect(droneFilter.frequency);
    lfo.start();

    const d1 = ctx.createOscillator();
    d1.type = 'sawtooth';
    d1.frequency.value = 41.2;
    d1.connect(droneFilter);
    d1.start();

    const d2 = ctx.createOscillator();
    d2.type = 'triangle';
    d2.frequency.value = 61.74;
    d2.connect(droneFilter);
    d2.start();

    // 2. Corrente de ar sombria nos túneis
    if (this.noiseBuffer) {
      const air = ctx.createBufferSource();
      air.buffer = this.noiseBuffer;
      air.loop = true;

      const airFilter = ctx.createBiquadFilter();
      airFilter.type = 'bandpass';
      airFilter.frequency.value = 190;
      airFilter.Q.value = 1.4;

      const airGain = ctx.createGain();
      airGain.gain.value = 0.032;

      air.connect(airFilter);
      airFilter.connect(airGain);
      airGain.connect(this.reverbSend);
      air.start();
    }

    // 3. Zumbido de reator elétrico 120Hz das luminárias LITE5 próximas (espacializado!)
    const lampGain = ctx.createGain();
    lampGain.gain.value = 0;
    const lampPan = ctx.createStereoPanner();
    lampGain.connect(lampPan);
    lampPan.connect(bus);
    this.lampBuzzGain = lampGain;
    this.lampBuzzPanner = lampPan;

    const buzzOsc = ctx.createOscillator();
    buzzOsc.type = 'sawtooth';
    buzzOsc.frequency.value = 120;
    const buzzFilter = ctx.createBiquadFilter();
    buzzFilter.type = 'bandpass';
    buzzFilter.frequency.value = 480;
    buzzFilter.Q.value = 3.2;
    buzzOsc.connect(buzzFilter);
    buzzFilter.connect(lampGain);
    buzzOsc.start();

    // 4. Pulsos industriais distantes ocasionais ecoando no labirinto
    this.pulseTimerId = window.setInterval(() => {
      if (!this.ctx || this.ctx.state !== 'running' || !this.reverbSend) return;
      if (Math.random() > 0.55) return;
      const t = this.ctx.currentTime;
      const pan = this.ctx.createStereoPanner();
      pan.pan.value = (Math.random() * 2 - 1) * 0.75;
      pan.connect(this.reverbSend);

      // Batida metálica distante na estrutura da base
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      const notes = [41.2, 43.65, 55.0, 61.74]; // Mi Frígio (E, F, A, B)
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(
        notes[Math.floor(Math.random() * notes.length)],
        t
      );
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.075, t + 0.12);
      g.gain.exponentialRampToValueAtTime(0.0008, t + 1.8);

      osc.connect(g);
      g.connect(pan);
      osc.start(t);
      osc.stop(t + 1.85);
    }, 4200);
  }

  /**
   * Passo pesado com reverberação de corredor e textura diferente para piso metálico vs pedra.
   */
  playLabyrinthFootstep(
    altFoot: boolean,
    surface: FloorMaterialKind,
    sprinting: boolean
  ): void {
    if (
      !this.isRunning() ||
      !this.ctx ||
      !this.worldDryBus ||
      !this.reverbSend
    ) {
      return;
    }
    const now = this.ctx.currentTime;
    const pitchJitter = (altFoot ? 1.04 : 0.96) * (0.97 + Math.random() * 0.06);
    const volScale = sprinting ? 1.22 : 1.0;

    // 1. Impacto grave da bota no piso
    const heel = this.ctx.createOscillator();
    const heelGain = this.ctx.createGain();
    heel.type = 'sine';
    const baseHz = (surface === 'tech' ? 96 : 78) * pitchJitter;
    heel.frequency.setValueAtTime(baseHz, now);
    heel.frequency.exponentialRampToValueAtTime(32, now + 0.085);

    heelGain.gain.setValueAtTime(0.16 * volScale, now);
    heelGain.gain.exponentialRampToValueAtTime(0.0008, now + 0.09);

    heel.connect(heelGain);
    heelGain.connect(this.worldDryBus);
    heelGain.connect(this.reverbSend);
    heel.start(now);
    heel.stop(now + 0.095);

    // 2. Textura granular 11kHz (raspado de cascalho/pedra vs estalo de placa metálica)
    const scrapeFreq = (surface === 'tech' ? 1450 : 880) * pitchJitter;
    const scrapeQ = surface === 'tech' ? 2.6 : 1.3;
    this.triggerFilteredNoise(
      this.worldDryBus,
      now + 0.006,
      surface === 'tech' ? 0.048 : 0.062,
      scrapeFreq,
      scrapeQ,
      0.13 * volScale,
      true,
      this.reverbSend
    );
  }

  /**
   * Batida/raspão pesado de ombro/armadura ao esbarrar em velocidade numa parede sólida.
   */
  playWallBump(): void {
    const nowMs = performance.now();
    if (nowMs - this.lastWallThudMs < 380) return;
    this.lastWallThudMs = nowMs;

    if (
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
    osc.frequency.setValueAtTime(68, now);
    osc.frequency.exponentialRampToValueAtTime(28, now + 0.12);

    gain.gain.setValueAtTime(0.18, now);
    gain.gain.exponentialRampToValueAtTime(0.0008, now + 0.13);

    osc.connect(gain);
    gain.connect(this.worldDryBus);
    gain.connect(this.reverbSend);
    osc.start(now);
    osc.stop(now + 0.14);

    this.triggerFilteredNoise(
      this.worldDryBus,
      now,
      0.065,
      520,
      1.4,
      0.12,
      true,
      this.reverbSend
    );
  }

  /**
   * Atualiza a espacialização estéreo do zumbido das luminárias LITE5 próximas
   * e dispara estalos elétricos suaves quando uma luminária pisca perto do jogador!
   */
  updateSpatialLampAudio(
    playerPos: THREE.Vector3,
    playerYaw: number,
    nearestLampPos: THREE.Vector3 | null,
    nearestDist: number,
    justFlickeredDim: boolean
  ): void {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime;

    if (!nearestLampPos || nearestDist > 7.5) {
      this.lampBuzzGain?.gain.setTargetAtTime(0, now, 0.08);
      return;
    }

    // Vetor direita da câmera para calcular panorama estéreo [-1..+1]
    const rightX = Math.cos(playerYaw);
    const rightZ = -Math.sin(playerYaw);
    const dx = nearestLampPos.x - playerPos.x;
    const dz = nearestLampPos.z - playerPos.z;
    const len = Math.max(0.001, Math.hypot(dx, dz));
    const pan = Math.max(-0.9, Math.min(0.9, (dx * rightX + dz * rightZ) / len));

    const proximity = Math.pow(Math.max(0, 1 - nearestDist / 7.5), 2);
    this.lampBuzzPanner?.pan.setTargetAtTime(pan, now, 0.05);
    this.lampBuzzGain?.gain.setTargetAtTime(proximity * 0.026, now, 0.06);

    // Estalo fluorescente quando uma luminária LITE5 próxima falha/pisca!
    if (
      justFlickeredDim &&
      nearestDist < 6.0 &&
      performance.now() - this.lastSparkMs > 260 &&
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
        0.028,
        2900,
        2.8,
        0.09 * proximity,
        true
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
    useGrittyBuffer: boolean,
    extraSend?: AudioNode
  ): void {
    const buf = useGrittyBuffer ? this.grittyNoiseBuffer : this.noiseBuffer;
    if (!this.ctx || !buf) return;

    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    // Escolhe um trecho aleatório do buffer de 1s para variar cada passo/tecla naturalmente
    const maxOffset = Math.max(0, 0.9 - duration);
    const offset = Math.random() * maxOffset;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = freq;
    filter.Q.value = q;

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(volume, startTime);
    gain.gain.exponentialRampToValueAtTime(0.0008, startTime + duration);

    src.connect(filter);
    filter.connect(gain);
    gain.connect(dest);
    if (extraSend) {
      gain.connect(extraSend);
    }

    src.start(startTime, offset, duration + 0.01);
  }

  dispose(): void {
    if (this.pulseTimerId) {
      window.clearInterval(this.pulseTimerId);
      this.pulseTimerId = 0;
    }
    this.stopCoalesceDrone();
    if (this.ctx) {
      void this.ctx.close();
      this.ctx = null;
    }
  }
}
