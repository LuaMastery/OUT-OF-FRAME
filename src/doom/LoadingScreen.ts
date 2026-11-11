import './loading.css';

/**
 * Tela de carregamento animada da incursão.
 *
 * O motivo de existir: montar o labirinto é um trecho síncrono e pesado
 * (`DoomGameApp` constrói texturas, geometria, itens e o astronauta de uma
 * vez). Enquanto a thread principal está ocupada ali, nada mais desenha —
 * então a tela de carregamento precisa existir no DOM *antes* do trabalho
 * começar e precisa se animar sem depender de JavaScript.
 *
 * Por isso:
 *  - `step()` só escreve um alvo; quem persegue o alvo é o `requestAnimationFrame`.
 *  - toda a animação de ambiente (scanlines, varredura, grade, spinner,
 *    pontinhos, equalizador, glitch do título) é CSS puro em `transform` e
 *    `opacity`, o que o navegador mantém rodando na thread de composição mesmo
 *    com a thread principal travada.
 *  - entre uma etapa e outra cedemos um frame real para o navegador pintar.
 */

/** Uma etapa do carregamento: rótulo e fração concluída ao terminá-la. */
export interface LoadingStep {
  readonly label: string;
  readonly to: number;
}

/**
 * Roteiro padrão. Os rótulos combinam com o que o construtor de
 * `DoomGameApp` realmente faz, na ordem em que faz.
 */
export const DEFAULT_LOADING_STEPS: readonly LoadingStep[] = [
  { label: 'MONTANDO O TERMINAL DE INCURSÃO', to: 0.1 },
  { label: 'SINTETIZANDO AS TEXTURAS', to: 0.2 },
  { label: 'CONSTRUINDO O LABIRINTO', to: 0.55 },
  { label: 'ESPAÇANDO O ESPÓLIO', to: 0.7 },
  { label: 'EQUIPANDO O ASTRONAUTA', to: 0.84 },
  { label: 'ARMANDO A ESPINGARDA', to: 0.94 },
  { label: 'ABRINDO AS PORTAS', to: 1 },
];

/** Situação de uma linha do registro de inicialização. */
export type LogState = 'pending' | 'done' | 'failed';

const FRAME_SETTLE_MS = 34;

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/** Espera o navegador pintar de verdade (rAF + volta da fila de tarefas). */
export function nextPaint(): Promise<void> {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      setTimeout(resolve, 0);
    });
  });
}

/** Pequena pausa para a tela respirar entre etapas. */
export function settleFrames(count = 1): Promise<void> {
  const total = Math.max(1, Math.round(count));
  return new Promise<void>((resolve) => {
    const tick = (left: number): void => {
      void nextPaint().then(() => {
        if (left <= 1) {
          resolve();
          return;
        }
        setTimeout(() => tick(left - 1), FRAME_SETTLE_MS);
      });
    };
    tick(total);
  });
}

const TEMPLATE = `
<div class="oof-loading__layer oof-loading__grid"></div>
<div class="oof-loading__layer oof-loading__sweep"></div>
<div class="oof-loading__layer oof-loading__scan"></div>
<div class="oof-loading__layer oof-loading__vignette"></div>
<div class="oof-loading__layer oof-loading__flicker"></div>
<div class="oof-loading__layer oof-loading__flash"></div>
<div class="oof-loading__inner">
  <div class="oof-loading__brand">
    <span class="oof-loading__eyebrow">SISTEMA DE INCURSÃO</span>
    <h1 class="oof-loading__title" data-text="OUT OF FRAME">OUT OF FRAME</h1>
    <span class="oof-loading__sub">Carregando a incursão</span>
  </div>

  <div class="oof-loading__panel">
    <div class="oof-loading__loghead">
      <span class="oof-loading__loghead-text">Registro de inicialização</span>
      <span class="oof-loading__spinner"></span>
    </div>
    <ul class="oof-loading__log" data-log></ul>
  </div>

  <div class="oof-loading__meter">
    <div class="oof-loading__pct">
      <span data-pct>0</span><i>%</i>
    </div>
    <div class="oof-loading__bar">
      <div class="oof-loading__fill" data-fill></div>
      <div class="oof-loading__ticks"></div>
      <div class="oof-loading__head" data-head></div>
    </div>
    <div class="oof-loading__statusline">
      <span class="oof-loading__status-text" data-status>Preparando a incursão</span>
      <span class="oof-loading__dots"><i></i><i></i><i></i></span>
    </div>
  </div>

  <div class="oof-loading__footer">
    <span class="oof-loading__eq"><i></i><i></i><i></i><i></i><i></i></span>
    <span>Não desconecte a alimentação</span>
  </div>
</div>
`;

export class LoadingScreen {
  private readonly root: HTMLElement;
  private readonly pctEl: HTMLElement;
  private readonly statusEl: HTMLElement;
  private readonly fillEl: HTMLElement;
  private readonly headEl: HTMLElement;
  private readonly logEl: HTMLElement;

  private steps: readonly LoadingStep[] = DEFAULT_LOADING_STEPS;
  private stepIndex = -1;
  private target = 0;
  private shown = 0;
  private rafId = 0;
  private runningLine: HTMLElement | null = null;
  private finishing: Promise<void> | null = null;
  /** Sobe a cada `show()`: saídas da geração anterior perdem o efeito. */
  private generation = 0;

  constructor(parent: HTMLElement = document.body) {
    this.root = document.createElement('div');
    this.root.className = 'oof-loading';
    this.root.setAttribute('role', 'status');
    this.root.setAttribute('aria-live', 'polite');
    this.root.setAttribute('aria-label', 'Carregando a incursão');
    this.root.hidden = true;
    this.root.innerHTML = TEMPLATE;

    this.pctEl = this.root.querySelector('[data-pct]') as HTMLElement;
    this.statusEl = this.root.querySelector('[data-status]') as HTMLElement;
    this.fillEl = this.root.querySelector('[data-fill]') as HTMLElement;
    this.headEl = this.root.querySelector('[data-head]') as HTMLElement;
    this.logEl = this.root.querySelector('[data-log]') as HTMLElement;

    parent.appendChild(this.root);
  }

  /** Recomeça do zero e mostra a tela. */
  show(steps: readonly LoadingStep[] = DEFAULT_LOADING_STEPS): void {
    this.generation += 1;
    this.steps = steps.length > 0 ? steps : DEFAULT_LOADING_STEPS;
    this.stepIndex = -1;
    this.target = 0;
    this.shown = 0;
    this.runningLine = null;
    this.finishing = null;
    this.logEl.textContent = '';

    this.root.classList.remove('is-leaving', 'is-flashing', 'is-failed');
    this.root.style.removeProperty('animation');
    this.root.hidden = false;
    // Força o navegador a calcular o layout antes de ligar as animações,
    // garantindo que o primeiro frame já apareça completo.
    void this.root.offsetHeight;
    this.root.classList.add('is-running');

    this.paintProgress(0);
    this.setStatus('Preparando a incursão');
    this.startLoop();
  }

  /** Avança para a próxima etapa do roteiro (ou para um rótulo avulso). */
  step(label?: string, to?: number): void {
    const index = Math.min(this.stepIndex + 1, this.steps.length);
    const preset = this.steps[index];
    const text = (label ?? preset?.label ?? 'CARREGANDO').toUpperCase();
    const target = clamp01(to ?? preset?.to ?? Math.min(1, this.target + 0.12));

    this.stepIndex = index;
    this.completeRunningLine('done');
    this.addLogLine(text, 'pending');
    this.setStatus(text);
    this.setProgress(target);
  }

  /** Define manualmente a fração concluída (0..1). */
  setProgress(value: number): void {
    this.target = clamp01(value);
    this.startLoop();
  }

  /** Conclui: 100%, clarão e saída. Resolve quando a tela já saiu. */
  finish(): Promise<void> {
    if (this.finishing) return this.finishing;

    this.stepIndex = this.steps.length;
    this.completeRunningLine('done');
    this.addLogLine('INCURSÃO PRONTA', 'done');
    this.setStatus('Incursão pronta');
    this.target = 1;
    this.shown = 1;
    this.paintProgress(1);
    this.stopLoop();
    this.root.classList.remove('is-running');

    this.finishing = this.exit(this.generation, 210, true);
    return this.finishing;
  }

  /** Faz a saída animada; ignora o pedido se uma carga nova já começou. */
  private exit(generation: number, flashDelay: number, flash: boolean): Promise<void> {
    return new Promise<void>((resolve) => {
      if (flash) this.root.classList.add('is-flashing');
      setTimeout(() => {
        if (generation !== this.generation) {
          resolve();
          return;
        }
        this.root.classList.add('is-leaving');
        setTimeout(() => {
          if (generation !== this.generation) {
            resolve();
            return;
          }
          this.dispose();
          resolve();
        }, 540);
      }, flashDelay);
    });
  }

  /** Mostra uma falha e sai; o erro segue no console para diagnóstico. */
  fail(message: string, error?: unknown): Promise<void> {
    if (error !== undefined) {
      console.error('[OUT OF FRAME] falha ao iniciar a incursão:', error);
    }
    this.setStatus(message.toUpperCase());
    this.completeRunningLine('failed');
    this.addLogLine(message.toUpperCase(), 'failed');
    this.stopLoop();
    this.root.classList.remove('is-running');
    this.root.classList.add('is-failed');

    // Sem clarão na falha: a tela apenas escurece e sai.
    return this.exit(this.generation, 1600, false);
  }

  /** Remove a sobreposição imediatamente, sem animação de saída. */
  dispose(): void {
    this.stopLoop();
    this.root.classList.remove('is-running', 'is-flashing', 'is-leaving', 'is-failed');
    this.root.hidden = true;
    this.finishing = null;
  }

  private setStatus(text: string): void {
    this.statusEl.textContent = text;
  }

  private addLogLine(text: string, state: LogState): void {
    const line = document.createElement('li');
    const mark = document.createElement('span');
    mark.className = 'oof-loading__log-mark';
    const label = document.createElement('span');
    label.className = 'oof-loading__log-text';
    label.textContent = text;
    const stateEl = document.createElement('span');
    stateEl.className = 'oof-loading__log-state';

    line.append(mark, label, stateEl);
    this.logEl.appendChild(line);
    this.runningLine = state === 'pending' ? line : null;
    this.paintLogLine(line, state);

    // Mantém o registro enxuto: descarta as linhas mais antigas.
    while (this.logEl.childElementCount > 8) {
      this.logEl.firstElementChild?.remove();
    }
  }

  private completeRunningLine(state: Exclude<LogState, 'pending'>): void {
    if (!this.runningLine) return;
    const line = this.runningLine;
    this.runningLine = null;
    this.paintLogLine(line, state);
  }

  private paintLogLine(line: HTMLElement, state: LogState): void {
    const mark = line.querySelector('.oof-loading__log-mark');
    const stateEl = line.querySelector('.oof-loading__log-state');
    if (mark) {
      mark.textContent = state === 'done' ? '▸' : state === 'failed' ? '!' : '·';
    }
    if (stateEl) {
      stateEl.textContent = state === 'done' ? 'OK' : state === 'failed' ? 'FALHA' : '···';
    }
    line.classList.toggle('is-done', state === 'done');
    line.classList.toggle('is-failed', state === 'failed');
  }

  private startLoop(): void {
    if (this.rafId !== 0) return;

    const tick = (): void => {
      const distance = this.target - this.shown;
      if (Math.abs(distance) < 0.001) {
        this.shown = this.target;
        this.paintProgress(this.shown);
        this.rafId = 0;
        return;
      }
      // Aproximação exponencial: começa rápido e desacelera, então a barra
      // nunca "teleporta" mesmo quando a etapa termina de supetão.
      this.shown += distance * 0.22;
      this.paintProgress(this.shown);
      this.rafId = requestAnimationFrame(tick);
    };

    this.rafId = requestAnimationFrame(tick);
  }

  private stopLoop(): void {
    if (this.rafId !== 0) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
  }

  private paintProgress(value: number): void {
    this.fillEl.style.transform = `scaleX(${value.toFixed(4)})`;
    this.headEl.style.left = `${(value * 100).toFixed(2)}%`;
    this.pctEl.textContent = String(Math.round(value * 100));
  }
}

let sharedScreen: LoadingScreen | null = null;

/** Instância única, reaproveitada entre incursões. */
export function getLoadingScreen(): LoadingScreen {
  if (!sharedScreen) {
    sharedScreen = new LoadingScreen(document.body);
  }
  return sharedScreen;
}
