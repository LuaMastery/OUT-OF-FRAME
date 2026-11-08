export type ChronoOverrideMode = 'superhot' | 'frozen' | 'realtime';

export interface ChronoTelemetry {
  realTime: number;
  simTime: number;
  realDt: number;
  timeScale: number;
  targetTimeScale: number;
  alpha: number;
  stepsLastFrame: number;
  totalSimSteps: number;
  mode: ChronoOverrideMode;
}

export interface ChronoConfig {
  /** Passo fixo determinístico do mundo dilatado (padrão: 1/120s) */
  fixedSimStep?: number;
  /** Escala mínima quando o jogador está totalmente imóvel (micro-crawl estilo Superhot) */
  idleTimeScale?: number;
  /** Escala máxima em movimento pleno */
  activeTimeScale?: number;
  /** Ganho de resposta ao acelerar o tempo (ataque rápido) */
  attackRate?: number;
  /** Ganho de desaceleração ao parar (cauda suave) */
  releaseRate?: number;
  /** Teto de sub-passos por quadro para evitar spiral-of-death */
  maxSubSteps?: number;
}

/**
 * Núcleo Temporal Dual-Clock (ChronoKernel).
 *
 * Separa rigorosamente:
 * 1. `realDt`: Tempo humano não-escalado (câmera FPS, HUD, viewfinder, transições).
 * 2. `simDt`: Passo fixo determinístico (`1/120s`) alimentado por um acumulador dilatado
 *    (`realDt * timeScale`), acompanhado de `alpha` residual para interpolação C0 contínua
 *    entre `prevTransform` e `currTransform`.
 *
 * Resultado: A `0.025x` (câmera quase congelada), a física executa ~3 ticks/segundo sem custo
 * extra e sem perda de precisão numérica, enquanto a renderização interpola a 60–144 FPS
 * com fluidez absoluta e zero tunneling balístico.
 */
export class ChronoKernel {
  readonly fixedSimStep: number;
  readonly idleTimeScale: number;
  readonly activeTimeScale: number;
  readonly attackRate: number;
  readonly releaseRate: number;
  readonly maxSubSteps: number;

  private accumulator = 0;
  private currentScale: number;
  private targetScale: number;
  private actionPulse = 0;
  private overrideMode: ChronoOverrideMode = 'superhot';

  private realElapsed = 0;
  private simElapsed = 0;
  private lastRealDt = 0;
  private lastSteps = 0;
  private totalSteps = 0;

  constructor(config: ChronoConfig = {}) {
    this.fixedSimStep = config.fixedSimStep ?? 1 / 120;
    this.idleTimeScale = config.idleTimeScale ?? 0.025;
    this.activeTimeScale = config.activeTimeScale ?? 1.0;
    this.attackRate = config.attackRate ?? 26.0;
    this.releaseRate = config.releaseRate ?? 10.5;
    this.maxSubSteps = config.maxSubSteps ?? 12;

    this.currentScale = this.idleTimeScale;
    this.targetScale = this.idleTimeScale;
  }

  /**
   * Injeta um pulso curto de tempo (ex.: disparar, saltar, recortar/colar a moldura),
   * reproduzindo o avanço tático de tempo por ação do Superhot.
   */
  injectActionPulse(intensity = 0.85): void {
    this.actionPulse = Math.min(1.15, Math.max(this.actionPulse, intensity));
  }

  setMode(mode: ChronoOverrideMode): void {
    this.overrideMode = mode;
  }

  getMode(): ChronoOverrideMode {
    return this.overrideMode;
  }

  cycleMode(): ChronoOverrideMode {
    const order: ChronoOverrideMode[] = ['superhot', 'frozen', 'realtime'];
    const next = order[(order.indexOf(this.overrideMode) + 1) % order.length];
    this.overrideMode = next;
    return next;
  }

  /**
   * Avança um quadro real e executa 0..N sub-passos fixos determinísticos no mundo simulado.
   *
   * @param rawRealDt Delta de tempo real em segundos vindo do `requestAnimationFrame`
   * @param motionFactor Velocidade normalizada [0..1] de locomoção do jogador
   * @param angularSpeed Velocidade angular da câmera (rad/s) — gera leve micro-tempo ao olhar
   * @param onFixedSimStep Callback determinístico chamado com `fixedSimStep`
   */
  tick(
    rawRealDt: number,
    motionFactor: number,
    angularSpeed: number,
    onFixedSimStep: (simDt: number) => void
  ): ChronoTelemetry {
    const realDt = Math.min(Math.max(rawRealDt, 0), 0.1);
    this.lastRealDt = realDt;
    this.realElapsed += realDt;

    // Decaimento exponencial do pulso de ação no tempo real
    this.actionPulse *= Math.exp(-7.5 * realDt);
    if (this.actionPulse < 0.005) this.actionPulse = 0;

    if (this.overrideMode === 'frozen') {
      this.targetScale = 0.005;
    } else if (this.overrideMode === 'realtime') {
      this.targetScale = 1.0;
    } else {
      const clampedMotion = Math.min(1, Math.max(0, motionFactor));
      // Olhar ao redor avança sutilmente o tempo até ~0.11x (fiel ao Superhot original)
      const lookContribution = Math.min(0.095, angularSpeed * 0.022);
      const baseScale =
        this.idleTimeScale +
        (this.activeTimeScale - this.idleTimeScale) * clampedMotion;
      this.targetScale = Math.min(
        1.1,
        Math.max(baseScale, this.idleTimeScale + lookContribution, this.actionPulse)
      );
    }

    // Amortecimento exponencial assimétrico independente de FPS
    const rate =
      this.targetScale > this.currentScale ? this.attackRate : this.releaseRate;
    const blend = 1 - Math.exp(-rate * realDt);
    this.currentScale += (this.targetScale - this.currentScale) * blend;

    // Acumulador determinístico em tempo dilatado
    const dilatedBudget = realDt * this.currentScale;
    this.accumulator += dilatedBudget;

    let steps = 0;
    while (this.accumulator >= this.fixedSimStep && steps < this.maxSubSteps) {
      onFixedSimStep(this.fixedSimStep);
      this.accumulator -= this.fixedSimStep;
      this.simElapsed += this.fixedSimStep;
      steps++;
      this.totalSteps++;
    }

    // Evita acúmulo infinito caso atinja o teto de segurança
    if (steps === this.maxSubSteps && this.accumulator > this.fixedSimStep) {
      this.accumulator = this.accumulator % this.fixedSimStep;
    }

    this.lastSteps = steps;

    return this.telemetry;
  }

  get timeScale(): number {
    return this.currentScale;
  }

  get alpha(): number {
    return Math.min(1, Math.max(0, this.accumulator / this.fixedSimStep));
  }

  get telemetry(): ChronoTelemetry {
    return {
      realTime: this.realElapsed,
      simTime: this.simElapsed,
      realDt: this.lastRealDt,
      timeScale: this.currentScale,
      targetTimeScale: this.targetScale,
      alpha: this.alpha,
      stepsLastFrame: this.lastSteps,
      totalSimSteps: this.totalSteps,
      mode: this.overrideMode,
    };
  }
}
