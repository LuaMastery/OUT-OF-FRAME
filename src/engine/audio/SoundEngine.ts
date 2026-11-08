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
  private dungeonBus: GainNode | null = null;
  private lampBuzzGain: GainNode | null = null;
  private lampBuzzPanner: StereoPannerNode | null = null;
  private pulseTimerId = 0;
  private lastWallThudMs = 0;
  private lastCrouchMs = 0;
  private lastSlideMs = 0;
  private lastSparkMs = 0;
  private lastSpiderStepMs = 0;
  private lastHeartbeatMs = 0;

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

  /** Estalido discreto em degraus para cada quadro da moldura DOS expandindo/recolhendo */
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
    } else if (this.dungeonBus) {
      this.dungeonBus.gain.setTargetAtTime(1.0, now + 0.1, 0.5);
    }
  }

  stopDungeonAtmosphere(): void {
    if (this.ctx && this.dungeonBus) {
      const now = this.ctx.currentTime;
      this.dungeonBus.gain.setTargetAtTime(0.0001, now, 0.12);
      this.lampBuzzGain?.gain.setTargetAtTime(0, now, 0.08);
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
    this.dungeonBus = bus;

    // 1. Drone escuro subterrâneo filtrado bem sutil (E1 = 41.2Hz + B1 = 61.74Hz)
    const droneFilter = ctx.createBiquadFilter();
    droneFilter.type = 'lowpass';
    droneFilter.frequency.value = 125;
    droneFilter.Q.value = 1.6;

    const droneGain = ctx.createGain();
    droneGain.gain.value = 0.012;
    droneFilter.connect(droneGain);
    droneGain.connect(bus);

    // LFO lento modulando o filtro do drone para sensação orgânica de masmorra/base
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.type = 'sine';
    lfo.frequency.value = 0.1;
    lfoGain.gain.value = 32;
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

    // 2. Corrente de ar subterrânea bem baixa nos túneis
    if (this.noiseBuffer) {
      const air = ctx.createBufferSource();
      air.buffer = this.noiseBuffer;
      air.loop = true;

      const airFilter = ctx.createBiquadFilter();
      airFilter.type = 'lowpass';
      airFilter.frequency.value = 210;

      const airGain = ctx.createGain();
      airGain.gain.value = 0.0055;

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
    buzzOsc.type = 'triangle';
    buzzOsc.frequency.value = 120;
    const buzzFilter = ctx.createBiquadFilter();
    buzzFilter.type = 'bandpass';
    buzzFilter.frequency.value = 360;
    buzzFilter.Q.value = 2.5;
    buzzOsc.connect(buzzFilter);
    buzzFilter.connect(lampGain);
    buzzOsc.start();

    // 4. Pulsos industriais distantes ocasionais e discretos ecoando no labirinto
    this.pulseTimerId = window.setInterval(() => {
      if (!this.ctx || this.ctx.state !== 'running' || !this.reverbSend) return;
      if (Math.random() > 0.5) return;
      const t = this.ctx.currentTime;
      const pan = this.ctx.createStereoPanner();
      pan.pan.value = (Math.random() * 2 - 1) * 0.75;
      pan.connect(this.reverbSend);

      // Batida metálica distante na estrutura da base
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      const notes = [41.2, 43.65, 55.0, 61.74]; // Mi Frígio (E, F, A, B)
      osc.type = 'sine';
      osc.frequency.setValueAtTime(
        notes[Math.floor(Math.random() * notes.length)],
        t
      );
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.018, t + 0.16);
      g.gain.exponentialRampToValueAtTime(0.0008, t + 1.8);

      osc.connect(g);
      g.connect(pan);
      osc.start(t);
      osc.stop(t + 1.85);
    }, 6500);
  }

  /**
   * Passo pesado com reverberação de corredor e textura diferente para piso metálico vs pedra.
   */
  playLabyrinthFootstep(
    altFoot: boolean,
    surface: FloorMaterialKind,
    sprinting: boolean,
    crouching = false
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
    const volScale = crouching ? 0.42 : sprinting ? 1.22 : 1.0;

    // 1. Impacto grave da bota no piso (mais abafado ao andar agachado)
    const heel = this.ctx.createOscillator();
    const heelGain = this.ctx.createGain();
    heel.type = 'sine';
    const baseHz =
      (surface === 'tech' ? 96 : 78) *
      (crouching ? 0.84 : 1.0) *
      pitchJitter;
    heel.frequency.setValueAtTime(baseHz, now);
    heel.frequency.exponentialRampToValueAtTime(28, now + 0.085);

    heelGain.gain.setValueAtTime(0.16 * volScale, now);
    heelGain.gain.exponentialRampToValueAtTime(0.0008, now + 0.09);

    heel.connect(heelGain);
    heelGain.connect(this.worldDryBus);
    heelGain.connect(this.reverbSend);
    heel.start(now);
    heel.stop(now + 0.095);

    // 2. Textura granular 11kHz (suave e controlada quando agachado)
    const scrapeFreq =
      (surface === 'tech' ? 1450 : 880) *
      (crouching ? 0.68 : 1.0) *
      pitchJitter;
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

  /** Som sutil de roupa/joelho ao agachar ou levantar (Tecla Ctrl) */
  playCrouchMovement(crouchingDown: boolean): void {
    const nowMs = performance.now();
    if (nowMs - this.lastCrouchMs < 160) return;
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

    this.triggerFilteredNoise(
      this.worldDryBus,
      now,
      0.095,
      crouchingDown ? 420 : 540,
      1.15,
      0.055,
      false,
      this.reverbSend
    );
  }

  /**
   * Som tático de deslizar pelo chão (Corrida + segurar Ctrl):
   * impacto abafado de joelheira/traje seguido de atrito contínuo sobre metal ou pedra.
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

    // 1. Toque grave inicial da bota/joelheira entrando no deslize
    const thud = this.ctx.createOscillator();
    const thudGain = this.ctx.createGain();
    thud.type = 'triangle';
    thud.frequency.setValueAtTime(surface === 'tech' ? 108 : 88, now);
    thud.frequency.exponentialRampToValueAtTime(32, now + 0.14);

    thudGain.gain.setValueAtTime(0.16, now);
    thudGain.gain.exponentialRampToValueAtTime(0.0008, now + 0.15);

    thud.connect(thudGain);
    thudGain.connect(this.worldDryBus);
    thudGain.connect(this.reverbSend);
    thud.start(now);
    thud.stop(now + 0.16);

    // 2. Arrasto prolongado de atrito no piso desacelerando suavemente
    const src = this.ctx.createBufferSource();
    src.buffer = this.grittyNoiseBuffer;
    const dur = 0.52;
    const offset = Math.random() * 0.35;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = surface === 'tech' ? 1.55 : 1.15;
    filter.frequency.setValueAtTime(surface === 'tech' ? 1520 : 1040, now);
    filter.frequency.exponentialRampToValueAtTime(
      surface === 'tech' ? 390 : 280,
      now + dur
    );

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.16, now + 0.035);
    gain.gain.exponentialRampToValueAtTime(0.0008, now + dur);

    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.worldDryBus);
    gain.connect(this.reverbSend);
    src.start(now, offset, dur + 0.02);
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

  /** Roçar rápido de empunhadura ao sacar ou guardar a lanterna (Tecla F) */
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

    this.triggerFilteredNoise(
      this.worldDryBus,
      now,
      0.085,
      equipping ? 680 : 480,
      1.2,
      0.075,
      false,
      this.reverbSend
    );
  }

  /** Clique mecânico duplo do botão superior da lanterna (ligar / desligar) */
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

    // 1. Transiente metálico seco do interruptor
    this.triggerFilteredNoise(
      this.worldDryBus,
      now,
      0.014,
      turningOn ? 3400 : 2500,
      3.0,
      0.13,
      false,
      this.reverbSend
    );

    // 2. Mola interna (dois pulsos curtos característicos de botão de lanterna)
    const freqs = turningOn ? [520, 920] : [860, 440];
    freqs.forEach((f, i) => {
      if (!this.ctx || !this.worldDryBus || !this.reverbSend) return;
      const t = now + i * 0.022;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(f, t);
      osc.frequency.exponentialRampToValueAtTime(f * 0.65, t + 0.024);

      gain.gain.setValueAtTime(0.08, t);
      gain.gain.exponentialRampToValueAtTime(0.0008, t + 0.028);

      osc.connect(gain);
      gain.connect(this.worldDryBus);
      gain.connect(this.reverbSend);
      osc.start(t);
      osc.stop(t + 0.03);
    });
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
    this.lampBuzzGain?.gain.setTargetAtTime(proximity * 0.006, now, 0.06);

    // Estalo fluorescente discreto quando uma luminária LITE5 próxima falha/pisca
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
        0.024,
        2600,
        2.8,
        0.028 * proximity,
        true
      );
    }
  }

  // ==========================================================================
  // 4. INVENTÁRIO DE TERROR (ESTILO AMNESIA) & ITENS COLETÁVEIS
  // ==========================================================================

  /** Abrir / fechar a bolsa do inventário (Tecla Tab): couro pesado + fecho escuro */
  playInventoryToggle(opening: boolean): void {
    if (!this.isRunning() || !this.ctx || !this.terminalBus) return;
    const now = this.ctx.currentTime;

    // Roçar grave de tecido/couro desgastado
    this.triggerFilteredNoise(
      this.terminalBus,
      now,
      0.16,
      opening ? 480 : 360,
      0.95,
      0.11,
      false,
      this.reverbSend ?? undefined
    );

    // Estalo metálico abafado da fivela
    const clasp = this.ctx.createOscillator();
    const claspGain = this.ctx.createGain();
    clasp.type = 'triangle';
    clasp.frequency.setValueAtTime(opening ? 240 : 340, now + 0.03);
    clasp.frequency.exponentialRampToValueAtTime(
      opening ? 390 : 175,
      now + 0.085
    );
    claspGain.gain.setValueAtTime(0.055, now + 0.03);
    claspGain.gain.exponentialRampToValueAtTime(0.0008, now + 0.095);

    clasp.connect(claspGain);
    claspGain.connect(this.terminalBus);
    clasp.start(now + 0.03);
    clasp.stop(now + 0.1);
  }

  /** Toque seco e sutil ao selecionar/passar por um slot do inventário */
  playInventorySelect(heavy = false): void {
    if (!this.isRunning() || !this.ctx || !this.terminalBus) return;
    const now = this.ctx.currentTime;

    this.triggerFilteredNoise(
      this.terminalBus,
      now,
      heavy ? 0.024 : 0.012,
      heavy ? 1450 : 2100,
      2.2,
      heavy ? 0.085 : 0.045,
      false
    );

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(heavy ? 310 : 520, now);
    osc.frequency.exponentialRampToValueAtTime(heavy ? 165 : 330, now + 0.035);
    gain.gain.setValueAtTime(heavy ? 0.065 : 0.032, now);
    gain.gain.exponentialRampToValueAtTime(0.0008, now + 0.038);

    osc.connect(gain);
    gain.connect(this.terminalBus);
    osc.start(now);
    osc.stop(now + 0.04);
  }

  /** Guardar objeto coletado no labirinto dentro da bolsa */
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

    // Pegada rápida no objeto + acomodação na bolsa
    this.triggerFilteredNoise(
      this.worldDryBus,
      now,
      0.09,
      920,
      1.3,
      0.13,
      false,
      this.reverbSend
    );
    this.triggerFilteredNoise(
      this.worldDryBus,
      now + 0.055,
      0.11,
      460,
      1.0,
      0.1,
      false
    );

    const notes = [295, 440];
    notes.forEach((f, idx) => {
      if (!this.ctx || !this.worldDryBus) return;
      const t = now + idx * 0.045;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(f, t);
      osc.frequency.exponentialRampToValueAtTime(f * 0.85, t + 0.075);
      gain.gain.setValueAtTime(0.055, t);
      gain.gain.exponentialRampToValueAtTime(0.0008, t + 0.08);
      osc.connect(gain);
      gain.connect(this.worldDryBus);
      osc.start(t);
      osc.stop(t + 0.085);
    });
  }

  /** Efeito sonoro de uso de item dentro do inventário */
  playItemUse(kind: 'heal' | 'battery' | 'flare' | 'note' | 'blade'): void {
    if (!this.isRunning() || !this.ctx || !this.worldDryBus) return;
    const now = this.ctx.currentTime;

    if (kind === 'heal') {
      // Rasgo de gaze / rolha de frasco + suspiro grave de alívio
      this.triggerFilteredNoise(
        this.worldDryBus,
        now,
        0.18,
        1250,
        1.4,
        0.12,
        false
      );
      const warm = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      warm.type = 'sine';
      warm.frequency.setValueAtTime(196, now + 0.05);
      warm.frequency.exponentialRampToValueAtTime(293.66, now + 0.34);
      g.gain.setValueAtTime(0.07, now + 0.05);
      g.gain.exponentialRampToValueAtTime(0.0008, now + 0.42);
      warm.connect(g);
      g.connect(this.worldDryBus);
      warm.start(now + 0.05);
      warm.stop(now + 0.44);
    } else if (kind === 'battery') {
      // Encaixe metálico de pilha + carga sutil de capacitor
      this.triggerFilteredNoise(
        this.worldDryBus,
        now,
        0.025,
        2900,
        2.5,
        0.13,
        false
      );
      const cap = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      cap.type = 'sine';
      cap.frequency.setValueAtTime(420, now + 0.02);
      cap.frequency.exponentialRampToValueAtTime(1280, now + 0.24);
      g.gain.setValueAtTime(0.05, now + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0008, now + 0.26);
      cap.connect(g);
      g.connect(this.worldDryBus);
      cap.start(now + 0.02);
      cap.stop(now + 0.28);
    } else if (kind === 'flare') {
      // Riscar ignitor + chiado intenso de magnésio
      this.triggerFilteredNoise(
        this.worldDryBus,
        now,
        0.04,
        3400,
        2.0,
        0.18,
        true,
        this.reverbSend ?? undefined
      );
      this.triggerFilteredNoise(
        this.worldDryBus,
        now + 0.035,
        0.48,
        1950,
        0.85,
        0.16,
        true,
        this.reverbSend ?? undefined
      );
    } else if (kind === 'blade') {
      // Saque metálico da lâmina + golpe rápido rasgando o ar/teia
      this.triggerFilteredNoise(
        this.worldDryBus,
        now,
        0.045,
        4400,
        3.8,
        0.15,
        false,
        this.reverbSend ?? undefined
      );
      this.triggerFilteredNoise(
        this.worldDryBus,
        now + 0.04,
        0.11,
        1850,
        1.4,
        0.14,
        false,
        this.reverbSend ?? undefined
      );
      const ring = this.ctx.createOscillator();
      const rg = this.ctx.createGain();
      ring.type = 'triangle';
      ring.frequency.setValueAtTime(2480, now);
      ring.frequency.exponentialRampToValueAtTime(1120, now + 0.09);
      rg.gain.setValueAtTime(0.05, now);
      rg.gain.exponentialRampToValueAtTime(0.0008, now + 0.095);
      ring.connect(rg);
      rg.connect(this.worldDryBus);
      ring.start(now);
      ring.stop(now + 0.1);
    } else {
      // Papel antigo desdobrando
      this.triggerFilteredNoise(
        this.worldDryBus,
        now,
        0.14,
        1750,
        1.2,
        0.09,
        false
      );
    }
  }

  // ==========================================================================
  // 5. ARANHA PROCEDURAL (EVIL CRAWLER) & ARMADILHAS DE TEIA
  // ==========================================================================

  /**
   * Passo quitinoso pontiagudo da aranha (no chão, parede ou grade metálica do teto),
   * espacializado em estéreo conforme a direção e distância ao jogador.
   */
  playSpiderFootstep(
    pan: number,
    distance: number,
    frantic: boolean,
    onMetalOrCeiling: boolean
  ): void {
    const nowMs = performance.now();
    const minGap = frantic ? 28 : 55;
    if (nowMs - this.lastSpiderStepMs < minGap) return;
    this.lastSpiderStepMs = nowMs;

    if (
      !this.isRunning() ||
      !this.ctx ||
      !this.worldDryBus ||
      !this.reverbSend ||
      distance > 22
    ) {
      return;
    }

    const now = this.ctx.currentTime;
    const atten = Math.pow(Math.max(0, 1 - distance / 22), 1.65);
    const vol = atten * (frantic ? 0.22 : 0.11);
    if (vol < 0.004) return;

    const panner = this.ctx.createStereoPanner();
    panner.pan.value = Math.max(-0.95, Math.min(0.95, pan));
    panner.connect(this.worldDryBus);
    panner.connect(this.reverbSend);

    const jitter = 0.88 + Math.random() * 0.26;

    // Estalo agudo de ponta óssea/quitina tocando pedra ou grade do teto
    this.triggerFilteredNoise(
      panner,
      now,
      frantic ? 0.026 : 0.034,
      (onMetalOrCeiling ? 2750 : 1850) * jitter * (frantic ? 1.15 : 1.0),
      onMetalOrCeiling ? 3.8 : 2.6,
      vol,
      true
    );

    // Ressonância seca de articulação aracnídea
    const click = this.ctx.createOscillator();
    const clickGain = this.ctx.createGain();
    click.type = onMetalOrCeiling ? 'triangle' : 'sine';
    const f0 = (onMetalOrCeiling ? 360 : 210) * jitter;
    click.frequency.setValueAtTime(f0, now);
    click.frequency.exponentialRampToValueAtTime(58, now + 0.038);

    clickGain.gain.setValueAtTime(vol * 0.85, now);
    clickGain.gain.exponentialRampToValueAtTime(0.0008, now + 0.042);

    click.connect(clickGain);
    clickGain.connect(panner);
    click.start(now);
    click.stop(now + 0.045);
  }

  /**
   * Guincho/sibilo aterrorizante da aranha ao avistar o jogador ou sentir vibração na teia,
   * anunciando a disparada em velocidade absurda!
   */
  playSpiderScream(pan: number, distance: number): void {
    if (
      !this.isRunning() ||
      !this.ctx ||
      !this.worldDryBus ||
      !this.reverbSend
    ) {
      return;
    }
    const now = this.ctx.currentTime;
    const atten = Math.max(0.22, Math.pow(Math.max(0, 1 - distance / 30), 1.2));

    const panner = this.ctx.createStereoPanner();
    panner.pan.value = Math.max(-0.92, Math.min(0.92, pan));
    panner.connect(this.worldDryBus);
    panner.connect(this.reverbSend);

    // Sibilo gutural rasgado
    this.triggerFilteredNoise(
      panner,
      now,
      0.62,
      1650,
      1.6,
      0.24 * atten,
      true
    );

    // Duas vozes dissonantes moduladas (grito orgânico aracnídeo)
    const freqs: Array<[number, number, number]> = [
      [640, 1180, 290],
      [685, 1310, 245],
    ];
    freqs.forEach(([fStart, fPeak, fEnd], idx) => {
      if (!this.ctx) return;
      const osc = this.ctx.createOscillator();
      const filter = this.ctx.createBiquadFilter();
      const g = this.ctx.createGain();

      osc.type = idx === 0 ? 'sawtooth' : 'square';
      osc.frequency.setValueAtTime(fStart, now);
      osc.frequency.exponentialRampToValueAtTime(fPeak, now + 0.11);
      osc.frequency.exponentialRampToValueAtTime(fEnd, now + 0.58);

      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(1350, now);
      filter.frequency.exponentialRampToValueAtTime(620, now + 0.58);
      filter.Q.value = 2.4;

      g.gain.setValueAtTime(0.001, now);
      g.gain.linearRampToValueAtTime(0.14 * atten, now + 0.04);
      g.gain.exponentialRampToValueAtTime(0.0008, now + 0.62);

      osc.connect(filter);
      filter.connect(g);
      g.connect(panner);
      osc.start(now);
      osc.stop(now + 0.64);
    });
  }

  /** Som úmido/tenso de fiandeiras tecendo armadilha de teia no corredor */
  playSpiderWebSpin(pan: number, distance: number): void {
    if (
      !this.isRunning() ||
      !this.ctx ||
      !this.worldDryBus ||
      !this.reverbSend ||
      distance > 18
    ) {
      return;
    }
    const now = this.ctx.currentTime;
    const atten = Math.pow(Math.max(0, 1 - distance / 18), 1.5);
    if (atten < 0.04) return;

    const panner = this.ctx.createStereoPanner();
    panner.pan.value = Math.max(-0.9, Math.min(0.9, pan));
    panner.connect(this.worldDryBus);
    panner.connect(this.reverbSend);

    this.triggerFilteredNoise(
      panner,
      now,
      0.14,
      2400,
      3.4,
      0.085 * atten,
      false
    );
  }

  /** Estalo viscoso quando o jogador pisa e fica preso numa armadilha de teia! */
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

    // Fio tenso vibrando como corda + aderência pegajosa
    const twang = this.ctx.createOscillator();
    const twangGain = this.ctx.createGain();
    twang.type = 'triangle';
    twang.frequency.setValueAtTime(280, now);
    twang.frequency.exponentialRampToValueAtTime(92, now + 0.24);
    twangGain.gain.setValueAtTime(0.2, now);
    twangGain.gain.exponentialRampToValueAtTime(0.0008, now + 0.26);
    twang.connect(twangGain);
    twangGain.connect(this.worldDryBus);
    twangGain.connect(this.reverbSend);
    twang.start(now);
    twang.stop(now + 0.28);

    this.triggerFilteredNoise(
      this.worldDryBus,
      now,
      0.22,
      1450,
      1.5,
      0.18,
      true,
      this.reverbSend
    );
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
    sub.frequency.setValueAtTime(115, now);
    sub.frequency.exponentialRampToValueAtTime(32, now + 0.36);

    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 380;

    subGain.gain.setValueAtTime(0.28, now);
    subGain.gain.exponentialRampToValueAtTime(0.0008, now + 0.38);

    sub.connect(lp);
    lp.connect(subGain);
    subGain.connect(this.worldDryBus);
    subGain.connect(this.reverbSend);
    sub.start(now);
    sub.stop(now + 0.4);

    this.triggerFilteredNoise(
      this.worldDryBus,
      now,
      0.26,
      980,
      1.3,
      0.22,
      true,
      this.reverbSend
    );
  }

  /**
   * Ataque brutal em 1ª pessoa quando a Aranha Gigante alcança o jogador:
   * Rasgo quitinoso + impacto corporal grave + guincho próximo + zumbido de desmaio (tinnitus).
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

    // 1. Impacto físico pesado derrubando o jogador no chão
    const slam = this.ctx.createOscillator();
    const slamGain = this.ctx.createGain();
    slam.type = 'sawtooth';
    slam.frequency.setValueAtTime(145, now);
    slam.frequency.exponentialRampToValueAtTime(26, now + 0.55);

    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(560, now);
    lp.frequency.exponentialRampToValueAtTime(120, now + 0.55);

    slamGain.gain.setValueAtTime(0.36, now);
    slamGain.gain.exponentialRampToValueAtTime(0.0008, now + 0.58);

    slam.connect(lp);
    lp.connect(slamGain);
    slamGain.connect(this.worldDryBus);
    slamGain.connect(this.reverbSend);
    slam.start(now);
    slam.stop(now + 0.6);

    // 2. Rasgo duplo das garras/quelíceras (esquerda -> direita)
    const slashes: Array<[number, number, number]> = [
      [0.02, -0.65, 2150],
      [0.16, 0.65, 1680],
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
        1.7,
        0.28,
        true
      );
    }

    // 3. Guincho gutural da aranha bem no rosto do jogador
    this.playSpiderScream(0, 0.8);

    // 4. Zumbido agudo abafado de choque/desmaio (estilo Amnesia)
    const ring = this.ctx.createOscillator();
    const ringGain = this.ctx.createGain();
    ring.type = 'sine';
    ring.frequency.setValueAtTime(2860, now + 0.18);
    ring.frequency.exponentialRampToValueAtTime(2540, now + 1.85);

    ringGain.gain.setValueAtTime(0.0001, now + 0.18);
    ringGain.gain.linearRampToValueAtTime(0.045, now + 0.36);
    ringGain.gain.exponentialRampToValueAtTime(0.0008, now + 1.9);

    ring.connect(ringGain);
    ringGain.connect(this.worldDryBus);
    ring.start(now + 0.18);
    ring.stop(now + 1.95);
  }

  /**
   * Som rítmico do corpo desacordado sendo arrastado pela pedra fria enquanto a aranha puxa até a teia!
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

    // Raspão grave de roupa/corpo contra o chão de pedra
    this.triggerFilteredNoise(
      this.worldDryBus,
      now,
      0.34,
      340,
      0.9,
      0.19,
      true,
      this.reverbSend
    );

    // Puxão seco das garras dianteiras
    const thud = this.ctx.createOscillator();
    const thudGain = this.ctx.createGain();
    thud.type = 'triangle';
    thud.frequency.setValueAtTime(76, now);
    thud.frequency.exponentialRampToValueAtTime(30, now + 0.22);
    thudGain.gain.setValueAtTime(0.16, now);
    thudGain.gain.exponentialRampToValueAtTime(0.0008, now + 0.24);

    thud.connect(thudGain);
    thudGain.connect(this.worldDryBus);
    thudGain.connect(this.reverbSend);
    thud.start(now);
    thud.stop(now + 0.25);
  }

  /** Fôlego pesado e rasgo de fios viscosos ao acordar ferido dentro da teia da aranha */
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

    // Inspiração ofegante filtrada
    this.triggerFilteredNoise(
      this.worldDryBus,
      now,
      0.38,
      680,
      1.35,
      0.15,
      false,
      this.reverbSend
    );

    // Estalo sutil de seda colada soltando
    this.triggerFilteredNoise(
      this.worldDryBus,
      now + 0.14,
      0.18,
      1900,
      2.4,
      0.085,
      true
    );
  }

  /** Morte permanente real: golpe letal + queda abissal + sinal vital encerrando */
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

    // Queda sub-grave final
    const abyss = this.ctx.createOscillator();
    const abyssGain = this.ctx.createGain();
    abyss.type = 'sine';
    abyss.frequency.setValueAtTime(92, now + 0.12);
    abyss.frequency.exponentialRampToValueAtTime(22, now + 1.8);
    abyssGain.gain.setValueAtTime(0.32, now + 0.12);
    abyssGain.gain.exponentialRampToValueAtTime(0.0008, now + 1.9);

    abyss.connect(abyssGain);
    abyssGain.connect(this.worldDryBus);
    abyss.start(now + 0.12);
    abyss.stop(now + 1.95);

    // Linha reta fria de sinal vital perdido
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

  /** Esforço físico ao se debater contra a teia ou contra o abraço da aranha */
  playStruggleEffort(): void {
    if (!this.isRunning() || !this.ctx || !this.worldDryBus) return;
    const now = this.ctx.currentTime;
    this.triggerFilteredNoise(
      this.worldDryBus,
      now,
      0.075,
      780 + Math.random() * 420,
      1.4,
      0.11,
      true,
      this.reverbSend ?? undefined
    );
  }

  /** Bip tático de sonar CRT ao ligar, recolher ou calibrar o Radar Topográfico */
  playRadarPing(activating: boolean): void {
    if (!this.isRunning() || !this.ctx || !this.worldDryBus) return;
    const now = this.ctx.currentTime;
    const notes: Array<[number, number, number]> = activating
      ? [
          [0, 660, 0.055],
          [0.065, 990, 0.07],
        ]
      : [[0, 520, 0.05]];

    for (const [delay, freq, vol] of notes) {
      const t = now + delay;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, t);
      osc.frequency.exponentialRampToValueAtTime(freq * 1.04, t + 0.09);

      gain.gain.setValueAtTime(vol, t);
      gain.gain.exponentialRampToValueAtTime(0.0008, t + 0.14);

      osc.connect(gain);
      gain.connect(this.worldDryBus);
      osc.start(t);
      osc.stop(t + 0.15);
    }
  }

  /** Batimento cardíaco abafado e discreto durante perseguição intensa ou saúde crítica */
  playTensionHeartbeat(intensity: number): void {
    const clamped = Math.max(0, Math.min(1, intensity));
    if (clamped < 0.12) return;

    const nowMs = performance.now();
    const beatIntervalMs = 920 - clamped * 470; // ~65 BPM -> ~133 BPM em pânico extremo
    if (nowMs - this.lastHeartbeatMs < beatIntervalMs) return;
    this.lastHeartbeatMs = nowMs;

    if (!this.isRunning() || !this.ctx || !this.worldDryBus) return;
    const now = this.ctx.currentTime;

    // Duplo pulso cardíaco ("lub-dub") bem abafado para não poluir o áudio
    const pulses: Array<[number, number, number]> = [
      [0, 62, 0.11 * clamped],
      [0.16, 52, 0.075 * clamped],
    ];
    for (const [delay, freq, vol] of pulses) {
      const t = now + delay;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, t);
      osc.frequency.exponentialRampToValueAtTime(28, t + 0.11);

      gain.gain.setValueAtTime(vol, t);
      gain.gain.exponentialRampToValueAtTime(0.0008, t + 0.12);

      osc.connect(gain);
      gain.connect(this.worldDryBus);
      osc.start(t);
      osc.stop(t + 0.13);
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
