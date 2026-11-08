import { FramePolarity } from '../math/SubFrustum';

/**
 * Sintetizador WebAudio 100% procedural acoplado à dilatação temporal (`timeScale`).
 *
 * Técnica especial:
 * Um filtro passa-baixas mestre (`BiquadFilterNode`) modula sua frequência de corte
 * exponencialmente com `timeScale` (de ~110 Hz em câmera congelada a ~9.500 Hz em tempo real),
 * fazendo toda a paisagem sonora "mergulhar no vácuo" quando o jogador para de se mover.
 */
export class ProceduralAudio {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private worldFilter: BiquadFilterNode | null = null;
  private droneOscA: OscillatorNode | null = null;
  private droneOscB: OscillatorNode | null = null;
  private droneGain: GainNode | null = null;
  private muted = false;

  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') {
        void this.ctx.resume();
      }
      return;
    }

    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioCtx) return;

    const ctx = new AudioCtx();
    this.ctx = ctx;

    const master = ctx.createGain();
    master.gain.value = 0.42;
    master.connect(ctx.destination);
    this.masterGain = master;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 400;
    filter.Q.value = 1.35;
    filter.connect(master);
    this.worldFilter = filter;

    // Drone harmônico sutil do ambiente dilatado
    const droneGain = ctx.createGain();
    droneGain.gain.value = 0.055;
    droneGain.connect(filter);
    this.droneGain = droneGain;

    const oscA = ctx.createOscillator();
    oscA.type = 'triangle';
    oscA.frequency.value = 55;
    oscA.connect(droneGain);
    oscA.start();
    this.droneOscA = oscA;

    const oscB = ctx.createOscillator();
    oscB.type = 'sine';
    oscB.frequency.value = 110.4;
    oscB.connect(droneGain);
    oscB.start();
    this.droneOscB = oscB;
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(
        this.muted ? 0 : 0.42,
        this.ctx.currentTime,
        0.03
      );
    }
    return this.muted;
  }

  isMuted(): boolean {
    return this.muted;
  }

  /**
   * Atualiza continuamente o filtro espectral e o pitch do drone conforme `timeScale`.
   */
  updateTimeScale(timeScale: number): void {
    if (!this.ctx || !this.worldFilter || !this.droneOscA || !this.droneOscB) return;
    const now = this.ctx.currentTime;
    const t = Math.min(1, Math.max(0, timeScale));
    // Escala logarítmica de 125 Hz (imóvel) até 9200 Hz (movimento total)
    const cutoff = 125 * Math.pow(74, t);
    this.worldFilter.frequency.setTargetAtTime(cutoff, now, 0.04);
    this.droneOscA.frequency.setTargetAtTime(52 + t * 18, now, 0.06);
    this.droneOscB.frequency.setTargetAtTime(104.3 + t * 36, now, 0.06);
    if (this.droneGain) {
      this.droneGain.gain.setTargetAtTime(0.045 + t * 0.03, now, 0.06);
    }
  }

  playShot(): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;

    // Transiente percussivo grave + estalo sintético
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(290, now);
    osc.frequency.exponentialRampToValueAtTime(46, now + 0.14);

    gain.gain.setValueAtTime(0.32, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.16);

    this.playNoiseBurst(0.055, 2400, 0.18, false);
  }

  playTurretFire(): void {
    if (!this.ctx || !this.worldFilter || this.muted) return;
    const now = this.ctx.currentTime;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(520, now);
    osc.frequency.exponentialRampToValueAtTime(135, now + 0.11);

    gain.gain.setValueAtTime(0.11, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);

    osc.connect(gain);
    gain.connect(this.worldFilter);
    osc.start(now);
    osc.stop(now + 0.13);
  }

  playFrameCut(capturedCount: number): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;

    // Clique mecânico de obturador fotográfico + sucção espacial
    this.playNoiseBurst(0.032, 3800, 0.24, false);

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    const baseFreq = 440 + Math.min(capturedCount, 6) * 55;
    osc.frequency.setValueAtTime(baseFreq, now);
    osc.frequency.exponentialRampToValueAtTime(78, now + 0.19);

    gain.gain.setValueAtTime(0.28, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.21);
  }

  playFramePaste(polarity: FramePolarity): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;

    const notes = polarity === 'inverted' ? [260, 520, 780] : [196, 294, 392];
    notes.forEach((freq, idx) => {
      if (!this.ctx || !this.masterGain) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = polarity === 'inverted' ? 'triangle' : 'sine';
      osc.frequency.setValueAtTime(freq * 0.7, now + idx * 0.018);
      osc.frequency.exponentialRampToValueAtTime(freq * 1.25, now + idx * 0.018 + 0.14);

      gain.gain.setValueAtTime(0.14, now + idx * 0.018);
      gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.018 + 0.16);

      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(now + idx * 0.018);
      osc.stop(now + idx * 0.018 + 0.17);
    });
  }

  playPolarityFlip(polarity: FramePolarity): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(polarity === 'inverted' ? 380 : 660, now);
    osc.frequency.exponentialRampToValueAtTime(
      polarity === 'inverted' ? 760 : 330,
      now + 0.08
    );

    gain.gain.setValueAtTime(0.16, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.095);
  }

  playCrystalShatter(): void {
    if (!this.ctx || !this.worldFilter || this.muted) return;
    const now = this.ctx.currentTime;

    // Ressonância vítrea/cristalina multifrequencial + estilhaço de ruído agudo
    const freqs = [1180, 1640, 2210, 2890, 3420];
    freqs.forEach((f, idx) => {
      if (!this.ctx || !this.worldFilter) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      const start = now + idx * 0.012;
      osc.frequency.setValueAtTime(f * (0.96 + Math.random() * 0.08), start);
      osc.frequency.exponentialRampToValueAtTime(f * 0.62, start + 0.24);

      gain.gain.setValueAtTime(0.11, start);
      gain.gain.exponentialRampToValueAtTime(0.0008, start + 0.26);

      osc.connect(gain);
      gain.connect(this.worldFilter);
      osc.start(start);
      osc.stop(start + 0.27);
    });

    this.playNoiseBurst(0.11, 5200, 0.2, true);
  }

  playRicochet(): void {
    if (!this.ctx || !this.worldFilter || this.muted) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(1480, now);
    osc.frequency.exponentialRampToValueAtTime(620, now + 0.09);
    gain.gain.setValueAtTime(0.13, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
    osc.connect(gain);
    gain.connect(this.worldFilter);
    osc.start(now);
    osc.stop(now + 0.11);
  }

  private playNoiseBurst(
    duration: number,
    bandFreq: number,
    volume: number,
    routedThroughWorld: boolean
  ): void {
    if (!this.ctx || !this.masterGain || !this.worldFilter) return;
    const sampleCount = Math.max(1, Math.floor(this.ctx.sampleRate * duration));
    const buffer = this.ctx.createBuffer(1, sampleCount, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < sampleCount; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp((-i / sampleCount) * 4);
    }

    const src = this.ctx.createBufferSource();
    src.buffer = buffer;

    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = bandFreq;
    bp.Q.value = 1.4;

    const gain = this.ctx.createGain();
    gain.gain.value = volume;

    src.connect(bp);
    bp.connect(gain);
    gain.connect(routedThroughWorld ? this.worldFilter : this.masterGain);
    src.start();
  }
}
