import './perfhud.css';
import type { PerfBottleneck, PerfStatus } from './DoomPerfGovernor';

/**
 * Painel de telemetria ao vivo.
 *
 * Uma ironia fácil de cair: um medidor de desempenho que custa desempenho.
 * Então o painel se redesenha a 8 Hz e mantém o texto em nós fixos — nenhuma
 * reconstrução de DOM por quadro, nenhum `innerHTML` em loop. O gráfico é um
 * canvas pequeno redesenhado junto com o texto.
 */

export interface PerfHudModel {
  readonly fps: number;
  readonly targetFps: number;
  readonly frameMsMedian: number;
  readonly frameMsP95: number;
  readonly cpuShare: number;
  readonly bottleneck: PerfBottleneck;
  readonly status: PerfStatus;
  readonly step: number;
  readonly stepLabel: string;
  readonly scalePercent: number;
  readonly lights: number;
  readonly budgetMs: number;
  readonly autoEnabled: boolean;
  readonly drops: number;
  readonly raises: number;
}

const STATUS_LABELS: Readonly<Record<PerfStatus, string>> = {
  off: 'DESLIGADO',
  warming: 'CALIBRANDO',
  stable: 'ESTÁVEL',
  dropping: 'REDUZINDO',
  recovering: 'RECUPERANDO',
  'at-floor': 'NO MÍNIMO',
  'at-ceiling': 'TETO ATINGIDO',
};

const BOTTLENECK_LABELS: Readonly<Record<PerfBottleneck, string>> = {
  cpu: 'PROCESSADOR',
  gpu: 'PLACA DE VÍDEO',
  balanced: 'EQUILIBRADO',
};

/** Intervalo entre redenhos do painel (ms). */
const REDRAW_INTERVAL_MS = 125;
/** Amostras no gráfico de tempo de quadro. */
const GRAPH_SAMPLES = 128;
/** Topo do gráfico, em ms. Acima disso desenha no teto. */
const GRAPH_CEILING_MS = 50;

const MARKUP = `
  <div class="doom-perf-hud__head">
    <span class="doom-perf-hud__title">DESEMPENHO</span>
    <span class="doom-perf-hud__state" data-perf-state>ESTÁVEL</span>
  </div>
  <div class="doom-perf-hud__fps">
    <b data-perf-fps>60</b><i>FPS</i><u data-perf-target>alvo 60</u>
  </div>
  <div class="doom-perf-hud__budget">
    <div class="doom-perf-hud__budget-fill" data-perf-budget></div>
  </div>
  <div class="doom-perf-hud__rows">
    <span>quadro</span><span data-perf-frame>—</span>
    <span>p95</span><span data-perf-p95>—</span>
    <span>cpu</span><span data-perf-cpu>—</span>
    <span>gargalo</span><span data-perf-bottleneck>—</span>
    <span>escala</span><span data-perf-scale>—</span>
    <span>luzes</span><span data-perf-lights>—</span>
    <span>qualidade</span><span data-perf-step>—</span>
  </div>
  <canvas class="doom-perf-hud__graph" data-perf-graph width="256" height="48"></canvas>
  <div class="doom-perf-hud__foot" data-perf-foot>ajuste automático · 0 quedas</div>
`;

function pick<T extends HTMLElement>(root: HTMLElement, attr: string): T {
  return root.querySelector(`[data-perf-${attr}]`) as T;
}

export class DoomPerfHud {
  private readonly root: HTMLDivElement;
  private readonly stateEl: HTMLElement;
  private readonly fpsEl: HTMLElement;
  private readonly targetEl: HTMLElement;
  private readonly budgetEl: HTMLElement;
  private readonly frameEl: HTMLElement;
  private readonly p95El: HTMLElement;
  private readonly cpuEl: HTMLElement;
  private readonly bottleneckEl: HTMLElement;
  private readonly scaleEl: HTMLElement;
  private readonly lightsEl: HTMLElement;
  private readonly stepEl: HTMLElement;
  private readonly footEl: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D | null;

  private readonly samples: number[] = [];
  private sampleCursor = 0;
  private lastRedrawMs = -1;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'doom-perf-hud';
    this.root.setAttribute('aria-hidden', 'true');
    this.root.hidden = true;
    this.root.innerHTML = MARKUP;

    this.stateEl = pick(this.root, 'state');
    this.fpsEl = pick(this.root, 'fps');
    this.targetEl = pick(this.root, 'target');
    this.budgetEl = pick(this.root, 'budget');
    this.frameEl = pick(this.root, 'frame');
    this.p95El = pick(this.root, 'p95');
    this.cpuEl = pick(this.root, 'cpu');
    this.bottleneckEl = pick(this.root, 'bottleneck');
    this.scaleEl = pick(this.root, 'scale');
    this.lightsEl = pick(this.root, 'lights');
    this.stepEl = pick(this.root, 'step');
    this.footEl = pick(this.root, 'foot');
    this.canvas = pick(this.root, 'graph');
    this.ctx = this.canvas.getContext('2d');

    parent.appendChild(this.root);
  }

  setVisible(visible: boolean): void {
    this.root.hidden = !visible;
  }

  get visible(): boolean {
    return !this.root.hidden;
  }

  /** Guarda o tempo do quadro para o gráfico. Barato o suficiente por quadro. */
  pushFrameTime(frameMs: number): void {
    if (this.samples.length < GRAPH_SAMPLES) {
      this.samples.push(frameMs);
    } else {
      this.samples[this.sampleCursor] = frameMs;
      this.sampleCursor = (this.sampleCursor + 1) % GRAPH_SAMPLES;
    }
  }

  /** Redesenha se já passou o intervalo. Devolve true quando redesenhou. */
  update(model: PerfHudModel, nowMs: number): boolean {
    if (this.root.hidden) return false;
    if (this.lastRedrawMs >= 0 && nowMs - this.lastRedrawMs < REDRAW_INTERVAL_MS) {
      return false;
    }
    this.lastRedrawMs = nowMs;

    const statusLabel = STATUS_LABELS[model.status] ?? 'ESTÁVEL';
    this.stateEl.textContent = statusLabel;
    this.stateEl.dataset.state = model.status;

    this.fpsEl.textContent = String(Math.round(model.fps));
    this.targetEl.textContent =
      model.targetFps > 0 ? `alvo ${model.targetFps}` : 'alvo livre';

    this.frameEl.textContent = `${model.frameMsMedian.toFixed(1)} ms`;
    this.p95El.textContent = `${model.frameMsP95.toFixed(1)} ms`;
    this.cpuEl.textContent = `${Math.round(model.cpuShare * 100)}%`;
    this.bottleneckEl.textContent = BOTTLENECK_LABELS[model.bottleneck];
    this.scaleEl.textContent = `${model.scalePercent}%`;
    this.lightsEl.textContent = String(model.lights);
    this.stepEl.textContent = `${model.stepLabel} · ${model.step}`;

    // A barra mostra quanta parte do orçamento do alvo está consumida.
    const load = model.budgetMs > 0 ? model.frameMsP95 / model.budgetMs : 0;
    this.budgetEl.style.transform = `scaleX(${Math.max(0, Math.min(1, load)).toFixed(3)})`;

    const auto = model.autoEnabled
      ? `ajuste automático · ${model.drops} quedas · ${model.raises} recuperações`
      : 'ajuste automático desligado';
    this.footEl.textContent = auto;

    this.drawGraph(model.budgetMs);
    return true;
  }

  private drawGraph(budgetMs: number): void {
    const ctx = this.ctx;
    if (!ctx) return;

    const w = this.canvas.width;
    const h = this.canvas.height;

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#0a0f0d';
    ctx.fillRect(0, 0, w, h);

    // Linha do orçamento: acima dela o quadro está atrasado.
    if (budgetMs > 0) {
      const y = h - Math.min(1, budgetMs / GRAPH_CEILING_MS) * h;
      ctx.fillStyle = 'rgba(240, 184, 70, 0.45)';
      ctx.fillRect(0, Math.max(0, y - 1), w, 2);
    }

    const count = this.samples.length;
    if (count === 0) return;

    // O buffer é circular: lê do mais antigo para o mais novo.
    const ordered = new Array<number>(count);
    for (let i = 0; i < count; i++) {
      ordered[i] = this.samples[(this.sampleCursor + i) % count];
    }

    const barW = w / GRAPH_SAMPLES;
    for (let i = 0; i < count; i++) {
      const ms = ordered[i];
      const norm = Math.min(1, ms / GRAPH_CEILING_MS);
      const barH = Math.max(1, norm * h);
      const over = budgetMs > 0 && ms > budgetMs * 1.05;
      ctx.fillStyle = over ? '#f0b846' : ms > budgetMs ? '#8fd8b4' : '#57d69b';
      ctx.fillRect(i * barW, h - barH, Math.max(1, barW - 1), barH);
    }
  }

  dispose(): void {
    this.root.remove();
  }
}
