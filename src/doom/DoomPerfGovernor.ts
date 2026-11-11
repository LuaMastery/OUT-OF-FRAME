/**
 * Sistema inteligente de otimização do OUT-OF-FRAME.
 *
 * A ideia: o jogo não sabe de antemão em qual máquina vai rodar, então em vez
 * de adivinhar ele *mede*. A cada janela de tempo o governador olha quanto
 * tempo cada quadro levou, compara com o orçamento do alvo de FPS escolhido e
 * sobe ou desce um degrau numa escada de qualidade.
 *
 * Três decisões que fazem o sistema parecer inteligente em vez de só reativo:
 *
 * 1. **Descobre onde está o gargalo.** Comparamos o tempo de JavaScript por
 *    quadro (simulação + submissão de desenho) com o tempo total do quadro.
 *    Se a CPU domina, cortamos primeiro o que custa CPU (luzes dinâmicas,
 *    reavaliação de luminárias, sombras de contato, radar). Se a GPU domina,
 *    cortamos primeiro resolução interna. A ordem da escada muda com isso —
 *    tem duas escadas, uma para cada caso.
 *
 * 2. **Decide por janelas, nunca por quadro.** Um soluço isolado não derruba
 *    a qualidade; é preciso pressão sustentada. E a recuperação é mais
 *    cautelosa que a queda, para não ficar oscilando.
 *
 * 3. **Aprende o teto da máquina.** Se o governador sobe para um degrau e cai
 *    de novo rapidamente duas vezes, ele entende que aquele degrau é demais
 *    para esse hardware e passa a tratá-lo como teto. O jogador não fica
 *    vendo a imagem piscar entre duas qualidades.
 *
 * Este arquivo é lógica pura: sem DOM, sem THREE, sem `performance.now()`
 * escondido. O `nowMs` entra pelos parâmetros, então dá para testar o
 * comportamento do governador com um relógio fictício.
 */

import { MAX_DOOM_LIGHTS } from './DoomShader';

/** Alavancas que o governador pode mexer. */
export interface PerfLevers {
  /** Escala da resolução interna, em % da escolha do jogador. */
  renderScalePercent: number;
  /** Quantas luzes dinâmicas o shader percorre por pixel. */
  maxDynamicLights: number;
  /** Atualizações por segundo das sombras de contato dos objetos (0 = desliga). */
  contactShadowHz: number;
  /** Sombra real (shadow map) no modelo de 1ª pessoa. */
  viewmodelShadowMap: boolean;
  /** Redesenhos por segundo do minimapa do radar. */
  radarHz: number;
  /** Intervalo mínimo entre reavaliações do ranking de luminárias, em ms. */
  lightRankMs: number;
}

export type PerfAggressiveness = 'gentle' | 'balanced' | 'aggressive';

export type PerfBottleneck = 'cpu' | 'gpu' | 'balanced';

export type PerfStatus =
  | 'off'
  | 'warming'
  | 'stable'
  | 'dropping'
  | 'recovering'
  | 'at-floor'
  | 'at-ceiling';

/** Um degrau da escada: o que piorar ao descer para ele. */
export interface PerfLadderStep {
  readonly scaleFactor?: number;
  readonly lightFactor?: number;
  readonly contactShadowHz?: number;
  readonly viewmodelShadowMap?: boolean;
  readonly radarHz?: number;
  readonly lightRankMs?: number;
}

/**
 * Escada para quando a GPU é o gargalo: resolução primeiro, porque é o que
 * mais alivia fragmento/pixel sem tocar na simulação.
 */
export const GPU_FIRST_LADDER: readonly PerfLadderStep[] = [
  { scaleFactor: 0.86 },
  { scaleFactor: 0.86, radarHz: 15 },
  { scaleFactor: 0.88, lightFactor: 0.7, contactShadowHz: 20 },
  { scaleFactor: 0.9, lightFactor: 0.8, contactShadowHz: 10, viewmodelShadowMap: false },
  { scaleFactor: 0.88, lightFactor: 0.7, contactShadowHz: 0, radarHz: 8, lightRankMs: 100 },
];

/**
 * Escada para quando a CPU é o gargalo: luzes e trabalho auxiliar primeiro.
 * Cortar resolução não adianta nada se o processador é quem não dá conta.
 */
export const CPU_FIRST_LADDER: readonly PerfLadderStep[] = [
  { lightFactor: 0.7, lightRankMs: 66 },
  { contactShadowHz: 15, radarHz: 15, lightFactor: 0.8 },
  { scaleFactor: 0.85, contactShadowHz: 8, viewmodelShadowMap: false },
  { lightFactor: 0.7, scaleFactor: 0.85, radarHz: 8, lightRankMs: 100 },
  { scaleFactor: 0.8, contactShadowHz: 0 },
];

/** Degrau 0 é a qualidade cheia; o último é o modo emergência. */
export const PERF_MAX_STEP = GPU_FIRST_LADDER.length;

export const PERF_STEP_LABELS: readonly string[] = [
  'MÁXIMA',
  'ALTA',
  'MÉDIA',
  'BAIXA',
  'MÍNIMA',
  'EMERGÊNCIA',
];

/** Limites duros: nada fica mais feio ou mais pesado do que isto. */
export const PERF_SCALE_MIN = 45;
export const PERF_SCALE_MAX = 160;
export const PERF_LIGHTS_MIN = 6;

export interface PerfGovernorThresholds {
  /** p95 acima de `budget × downP95` conta como pressão. */
  readonly downP95: number;
  /** p95 abaixo de `budget × upP95` e mediana abaixo de `budget × upMedian` contam como alívio. */
  readonly upP95: number;
  readonly upMedian: number;
  /** Janelas consecutivas de pressão antes de descer. */
  readonly windowsToDrop: number;
  /** Janelas consecutivas de alívio antes de subir. */
  readonly windowsToRaise: number;
  readonly windowMs: number;
  /** Silêncio depois de uma mudança, para não medir o soluço da própria troca. */
  readonly settleMs: number;
}

export const PERF_THRESHOLDS: Readonly<Record<PerfAggressiveness, PerfGovernorThresholds>> = {
  gentle: {
    downP95: 1.35,
    upP95: 0.62,
    upMedian: 0.68,
    windowsToDrop: 3,
    windowsToRaise: 5,
    windowMs: 900,
    settleMs: 1400,
  },
  balanced: {
    downP95: 1.22,
    upP95: 0.7,
    upMedian: 0.75,
    windowsToDrop: 2,
    windowsToRaise: 4,
    windowMs: 750,
    settleMs: 1000,
  },
  aggressive: {
    downP95: 1.1,
    upP95: 0.78,
    upMedian: 0.82,
    windowsToDrop: 1,
    windowsToRaise: 3,
    windowMs: 500,
    settleMs: 700,
  },
};

export interface PerfSample {
  /** Tempo real entre este quadro e o anterior, em ms. */
  readonly frameMs: number;
  /** Tempo de JavaScript dentro do quadro (simulação + submissão), em ms. */
  readonly cpuMs: number;
  /** Relógio monotônico em ms, o mesmo usado em todas as chamadas. */
  readonly nowMs: number;
}

export interface PerfGovernorSnapshot {
  readonly fps: number;
  readonly frameMsMedian: number;
  readonly frameMsP95: number;
  readonly cpuMsMean: number;
  /** Fração do quadro gasta em JavaScript (0..1). */
  readonly cpuShare: number;
  readonly bottleneck: PerfBottleneck;
  readonly step: number;
  readonly stepLabel: string;
  readonly levers: PerfLevers;
  /** Muda de valor a cada vez que as alavancas mudam — o app usa para reaplicar. */
  readonly leversRevision: number;
  readonly status: PerfStatus;
  readonly budgetMs: number;
  readonly estimatedRefreshHz: number;
  /** Quantas vezes o governador já reduziu a qualidade nesta sessão. */
  readonly drops: number;
  /** Quantas vezes já conseguiu recuperar. */
  readonly raises: number;
}

export interface PerfGovernorOptions {
  /** Alvo de FPS. 0 = sem limite (usa a taxa estimada do monitor). */
  targetFps: number;
  aggressiveness: PerfAggressiveness;
  enabled: boolean;
}

/** Taxas de atualização conhecidas, para arredondar a estimativa do monitor. */
const COMMON_REFRESH_HZ = [60, 75, 90, 100, 120, 144, 165, 240, 360];

/**
 * Encaixa um teto de tempo de quadro nos múltiplos do vsync do monitor.
 *
 * O tempo de um quadro só pode ser múltiplo do intervalo de atualização da
 * tela: num monitor de 144 Hz (6,94 ms) não existe "16,67 ms", só 13,88 ms ou
 * 20,8 ms. Sem esse arredondamento, um alvo de 60 FPS num monitor de 144 Hz
 * entrega 48 — o limitador esperaria o primeiro múltiplo acima do alvo em vez
 * do mais próximo.
 *
 * A tolerância devolvida é a margem para decidir se o quadro atual já serve:
 * metade de um vsync, o suficiente para absorver o jitter do relógio sem
 * adiantar um quadro inteiro.
 *
 * @param capMs teto desejado em ms; 0 significa "sem limitador".
 * @param displayIntervalMs intervalo do vsync; 0 significa "ainda não medido".
 */
export function snapFrameCapToVsync(
  capMs: number,
  displayIntervalMs: number
): { capMs: number; toleranceMs: number } {
  if (capMs <= 0) return { capMs: 0, toleranceMs: 0 };
  if (displayIntervalMs <= 0) return { capMs, toleranceMs: 1 };

  const steps = Math.max(1, Math.round(capMs / displayIntervalMs));
  return {
    capMs: steps * displayIntervalMs,
    toleranceMs: Math.max(1, displayIntervalMs * 0.5),
  };
}

/** Arredonda uma taxa medida para o valor de monitor mais próximo. */
export function snapRefreshHz(measuredHz: number): number {
  if (!Number.isFinite(measuredHz) || measuredHz <= 0) return 60;
  let best = COMMON_REFRESH_HZ[0];
  let bestErr = Math.abs(best - measuredHz);
  for (const candidate of COMMON_REFRESH_HZ) {
    const err = Math.abs(candidate - measuredHz);
    if (err < bestErr) {
      best = candidate;
      bestErr = err;
    }
  }
  // Só aceita o valor tabelado se estiver a menos de 12% dele; senão usa o medido.
  return bestErr / best <= 0.12 ? best : Math.round(measuredHz);
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/**
 * Aplica os degraus 0..`step - 1` da escada sobre a qualidade base escolhida
 * pelo jogador. Absolutos (Hz, ms) usam o pior valor entre o que já vinha e o
 * que o degrau pede, garantindo que descer nunca melhore nada.
 */
export function resolvePerfLevers(
  base: PerfLevers,
  step: number,
  ladder: readonly PerfLadderStep[] = GPU_FIRST_LADDER
): PerfLevers {
  const clampedStep = clamp(Math.round(step), 0, ladder.length);
  let renderScalePercent = base.renderScalePercent;
  let maxDynamicLights = base.maxDynamicLights;
  let contactShadowHz = base.contactShadowHz;
  let viewmodelShadowMap = base.viewmodelShadowMap;
  let radarHz = base.radarHz;
  let lightRankMs = base.lightRankMs;

  for (let i = 0; i < clampedStep; i++) {
    const rung = ladder[i];
    if (rung.scaleFactor !== undefined) {
      renderScalePercent *= rung.scaleFactor;
    }
    if (rung.lightFactor !== undefined) {
      maxDynamicLights *= rung.lightFactor;
    }
    if (rung.contactShadowHz !== undefined) {
      contactShadowHz = Math.min(contactShadowHz, rung.contactShadowHz);
    }
    if (rung.viewmodelShadowMap !== undefined && rung.viewmodelShadowMap === false) {
      viewmodelShadowMap = false;
    }
    if (rung.radarHz !== undefined) {
      radarHz = Math.min(radarHz, rung.radarHz);
    }
    if (rung.lightRankMs !== undefined) {
      lightRankMs = Math.max(lightRankMs, rung.lightRankMs);
    }
  }

  return {
    renderScalePercent: Math.round(
      clamp(renderScalePercent, PERF_SCALE_MIN, PERF_SCALE_MAX)
    ),
    maxDynamicLights: Math.round(
      clamp(maxDynamicLights, PERF_LIGHTS_MIN, MAX_DOOM_LIGHTS)
    ),
    contactShadowHz: Math.max(0, Math.round(contactShadowHz)),
    viewmodelShadowMap,
    radarHz: Math.max(4, Math.round(radarHz)),
    lightRankMs: clamp(Math.round(lightRankMs), 0, 200),
  };
}

function percentileOf(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = clamp(Math.ceil(p * sorted.length) - 1, 0, sorted.length - 1);
  return sorted[idx];
}

function meanOf(values: readonly number[]): number {
  if (values.length === 0) return 0;
  let total = 0;
  for (const v of values) total += v;
  return total / values.length;
}

/** Tamanho da janela de amostras: cabe bastante coisa sem ficar lento. */
const RING_CAPACITY = 180;
/** Quadros ignorados no começo (compilação de shader, primeiro desenho). */
const WARMUP_FRAMES = 45;

export class DoomPerfGovernor {
  private readonly frameRing: number[] = [];
  private readonly cpuRing: number[] = [];
  private ringCursor = 0;

  private options: PerfGovernorOptions;
  private base: PerfLevers;
  private applied: PerfLevers;

  private warmupLeft = WARMUP_FRAMES;
  private windowStartMs = 0;
  private windowFrames = 0;

  private step = 0;
  /** Melhor degrau que esta máquina já provou aguentar (anti-oscilação). */
  private ceilingStep = 0;
  private pressure = 0;
  private relief = 0;
  private settleUntilMs = 0;

  /** Contador de subidas seguidas de queda rápida, por degrau. */
  private readonly fastFallsByStep = new Map<number, number>();
  private lastRaiseMs = 0;
  private lastRaiseStep = 0;

  private drops = 0;
  private raises = 0;
  private revisionCounter = 0;

  private cpuShare = 0.5;
  private estimatedRefreshHz = 60;
  private fastestFrameMs = Number.POSITIVE_INFINITY;

  private lastStatus: PerfStatus = 'warming';
  private lastFrameMsMedian = 0;
  private lastFrameMsP95 = 0;
  private lastCpuMsMean = 0;
  private lastFps = 0;

  constructor(base: PerfLevers, options: PerfGovernorOptions) {
    this.base = base;
    this.options = options;
    this.applied = resolvePerfLevers(base, 0, GPU_FIRST_LADDER);
  }

  /** Alavancas já resolvidas para o degrau atual. */
  get currentLevers(): PerfLevers {
    return this.applied;
  }

  get currentStep(): number {
    return this.step;
  }

  /** Contador que muda a cada vez que as alavancas resolvidas mudam. */
  get leversRevision(): number {
    return this.revisionCounter;
  }

  get learnedCeiling(): number {
    return this.ceilingStep;
  }

  /** Troca a qualidade base (quando o jogador mexe nas opções). */
  setBase(base: PerfLevers): void {
    this.base = base;
    this.recompute();
  }

  setOptions(patch: Partial<PerfGovernorOptions>): void {
    const fpsChanged =
      patch.targetFps !== undefined && patch.targetFps !== this.options.targetFps;
    this.options = { ...this.options, ...patch };
    if (fpsChanged) {
      // Um novo alvo invalida o que foi medido: recomeça a janela limpa.
      this.resetWindow();
      this.windowStartMs = 0;
    }
  }

  /** Orçamento por quadro, em ms. */
  budgetMs(): number {
    const target = this.options.targetFps;
    if (target > 0) return 1000 / target;
    // Sem limite: mira na taxa real do monitor com 6% de folga.
    return (1000 / Math.max(30, this.estimatedRefreshHz)) * 1.06;
  }

  /** Alimenta o governador com um quadro. Devolve o retrato atual. */
  update(sample: PerfSample): PerfGovernorSnapshot {
    // A taxa do monitor só pode ser estimada quando não há limitador ativo,
    // senão o próprio limitador viraria a "taxa do monitor".
    if (this.options.targetFps <= 0 && sample.frameMs > 0) {
      if (sample.frameMs < this.fastestFrameMs) {
        this.fastestFrameMs = sample.frameMs;
        // Só sobe a estimativa: quedas são soluços, não um monitor mais lento.
        const snapped = snapRefreshHz(1000 / this.fastestFrameMs);
        if (snapped > this.estimatedRefreshHz) this.estimatedRefreshHz = snapped;
      }
    }

    if (!this.options.enabled) {
      this.lastStatus = 'off';
      return this.snapshot();
    }

    if (this.warmupLeft > 0) {
      this.warmupLeft -= 1;
      this.lastStatus = 'warming';
      return this.snapshot();
    }

    // Período de silêncio depois de uma mudança: descarta as medidas para não
    // confundir o soluço da própria troca com lentidão do hardware.
    if (sample.nowMs < this.settleUntilMs) {
      this.lastStatus = this.statusForHold();
      return this.snapshot();
    }

    if (this.windowStartMs === 0) this.windowStartMs = sample.nowMs;
    this.pushSample(sample.frameMs, sample.cpuMs);
    this.windowFrames += 1;

    const thresholds =
      PERF_THRESHOLDS[this.options.aggressiveness] ?? PERF_THRESHOLDS.balanced;
    const elapsed = sample.nowMs - this.windowStartMs;
    if (this.windowFrames < 12 || elapsed < thresholds.windowMs) {
      return this.snapshot();
    }

    this.evaluateWindow(sample.nowMs, thresholds);
    return this.snapshot();
  }

  /**
   * Descarta as amostras da janela atual, preservando a pressão e o alívio já
   * acumulados — são eles que decidem a próxima troca.
   */
  private clearSamples(): void {
    this.frameRing.length = 0;
    this.cpuRing.length = 0;
    this.ringCursor = 0;
    this.windowFrames = 0;
    this.windowStartMs = 0;
  }

  /** Zera medidas e contadores (ao voltar de uma aba oculta, por exemplo). */
  resetWindow(): void {
    this.clearSamples();
    this.pressure = 0;
    this.relief = 0;
  }

  /** Recomeça do zero, inclusive o aprendizado de teto. */
  reset(): void {
    this.resetWindow();
    this.warmupLeft = WARMUP_FRAMES;
    this.step = 0;
    this.ceilingStep = 0;
    this.drops = 0;
    this.raises = 0;
    this.settleUntilMs = 0;
    this.fastestFrameMs = Number.POSITIVE_INFINITY;
    this.fastFallsByStep.clear();
    this.lastRaiseMs = 0;
    this.lastStatus = 'warming';
    this.recompute();
  }

  private pushSample(frameMs: number, cpuMs: number): void {
    if (this.frameRing.length < RING_CAPACITY) {
      this.frameRing.push(frameMs);
      this.cpuRing.push(cpuMs);
    } else {
      this.frameRing[this.ringCursor] = frameMs;
      this.cpuRing[this.ringCursor] = cpuMs;
      this.ringCursor = (this.ringCursor + 1) % RING_CAPACITY;
    }
  }

  private evaluateWindow(
    nowMs: number,
    thresholds: PerfGovernorThresholds
  ): void {
    const sorted = [...this.frameRing].sort((a, b) => a - b);
    const median = percentileOf(sorted, 0.5);
    const p95 = percentileOf(sorted, 0.95);
    const cpuMean = meanOf(this.cpuRing);

    this.lastFrameMsMedian = median;
    this.lastFrameMsP95 = p95;
    this.lastCpuMsMean = cpuMean;
    this.lastFps = median > 0 ? 1000 / median : 0;

    // O quadro inclui o tempo em que o navegador fica esperando a GPU. Quando
    // o JavaScript ocupa mais da metade do quadro, o gargalo é a CPU.
    this.cpuShare = p95 > 0 ? clamp(cpuMean / p95, 0, 1) : 0.5;

    const budget = this.budgetMs();

    if (p95 > budget * thresholds.downP95) {
      this.pressure += 1;
      this.relief = 0;
    } else if (
      p95 < budget * thresholds.upP95 &&
      median < budget * thresholds.upMedian
    ) {
      this.relief += 1;
      this.pressure = 0;
    } else {
      // Zona morta: nem bom nem ruim o bastante para justificar uma troca.
      this.pressure = Math.max(0, this.pressure - 1);
      this.relief = Math.max(0, this.relief - 1);
    }

    this.clearSamples();
    this.windowStartMs = nowMs;

    if (this.pressure >= thresholds.windowsToDrop && this.step < PERF_MAX_STEP) {
      this.pressure = 0;
      // A ordem importa: o registro da queda compara com o degrau já aplicado.
      this.applyStep(this.step + 1, nowMs, thresholds);
      this.registerDrop(nowMs);
      this.lastStatus = 'dropping';
      return;
    }

    if (this.relief >= thresholds.windowsToRaise && this.step > this.ceilingStep) {
      this.relief = 0;
      this.raises += 1;
      this.lastRaiseMs = nowMs;
      // Guarda o degrau para o qual estamos subindo: se ele cair de novo
      // rápido, é ele que vira o teto aprendido desta máquina.
      this.lastRaiseStep = Math.max(this.ceilingStep, this.step - 1);
      this.applyStep(this.step - 1, nowMs, thresholds);
      this.lastStatus = 'recovering';
      return;
    }

    this.lastStatus = this.statusForHold();
  }

  /**
   * Se subimos para um degrau e ele caiu de novo rápido duas vezes, esse
   * degrau fica marcado como teto e não é mais tentado nesta sessão.
   */
  private registerDrop(nowMs: number): void {
    this.drops += 1;
    const raisedRecently =
      this.lastRaiseMs > 0 && nowMs - this.lastRaiseMs < 8000;
    if (raisedRecently && this.lastRaiseStep < this.step) {
      const falls = (this.fastFallsByStep.get(this.lastRaiseStep) ?? 0) + 1;
      this.fastFallsByStep.set(this.lastRaiseStep, falls);
      if (falls >= 2) {
        this.ceilingStep = Math.max(this.ceilingStep, this.lastRaiseStep + 1);
      }
    }
    this.lastRaiseMs = 0;
  }

  private statusForHold(): PerfStatus {
    if (this.step >= PERF_MAX_STEP) return 'at-floor';
    // "Teto" só é novidade quando o governador aprendeu um limite; no degrau
    // zero ele simplesmente está na melhor qualidade possível.
    if (this.ceilingStep > 0 && this.step <= this.ceilingStep) {
      return 'at-ceiling';
    }
    return 'stable';
  }

  private applyStep(
    next: number,
    nowMs: number,
    thresholds: PerfGovernorThresholds
  ): void {
    this.step = clamp(Math.round(next), this.ceilingStep, PERF_MAX_STEP);
    this.recompute();
    this.revisionCounter += 1;
    this.settleUntilMs = nowMs + thresholds.settleMs;
    this.resetWindow();
    this.windowStartMs = nowMs;
  }

  /** Recalcula as alavancas do degrau atual usando a escada do gargalo atual. */
  private recompute(): void {
    const ladder: readonly PerfLadderStep[] = this.preferredLadder();
    const next = resolvePerfLevers(this.base, this.step, ladder);
    if (!leversEqual(next, this.applied)) {
      this.applied = next;
      this.revisionCounter += 1;
    }
  }

  private preferredLadder(): readonly PerfLadderStep[] {
    return this.cpuShare > 0.55 ? CPU_FIRST_LADDER : GPU_FIRST_LADDER;
  }

  private snapshot(): PerfGovernorSnapshot {
    return {
      fps: this.lastFps,
      frameMsMedian: this.lastFrameMsMedian,
      frameMsP95: this.lastFrameMsP95,
      cpuMsMean: this.lastCpuMsMean,
      cpuShare: this.cpuShare,
      bottleneck:
        this.cpuShare > 0.55 ? 'cpu' : this.cpuShare < 0.32 ? 'gpu' : 'balanced',
      step: this.step,
      stepLabel:
        PERF_STEP_LABELS[clamp(this.step, 0, PERF_STEP_LABELS.length - 1)],
      levers: this.applied,
      leversRevision: this.revisionCounter,
      status: this.options.enabled ? this.lastStatus : 'off',
      budgetMs: this.budgetMs(),
      estimatedRefreshHz: this.estimatedRefreshHz,
      drops: this.drops,
      raises: this.raises,
    };
  }
}

/** Compara duas alavancas campo a campo. */
export function leversEqual(a: PerfLevers, b: PerfLevers): boolean {
  return (
    a.renderScalePercent === b.renderScalePercent &&
    a.maxDynamicLights === b.maxDynamicLights &&
    a.contactShadowHz === b.contactShadowHz &&
    a.viewmodelShadowMap === b.viewmodelShadowMap &&
    a.radarHz === b.radarHz &&
    a.lightRankMs === b.lightRankMs
  );
}
