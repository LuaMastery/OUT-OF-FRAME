import './gameConsole.css';
import {
  CHANNEL_LABELS,
  ConsoleChannel,
  ConsoleEntry,
  ConsoleFilter,
  ConsoleLevel,
  CONSOLE_CHANNELS,
  CommandContext,
  ConsoleLog,
  createDefaultCommands,
  defaultConsoleFilter,
  formatConsoleClock,
  LEVEL_LABELS,
  stringifyConsoleArg,
} from './ConsoleLog';

/**
 * Console de diagnóstico do jogo.
 *
 * Existe para responder "o que o jogo está fazendo?" e "o que acabou de
 * quebrar?" sem exigir que o jogador abra as ferramentas do navegador.
 *
 * Três fontes alimentam o console:
 *  - chamadas a `console.*` feitas pelo próprio jogo (capturadas e repassadas
 *    ao console original, para não esconder nada de quem estiver depurando);
 *  - erros e promessas rejeitadas que escaparam, via `window`;
 *  - eventos de atividade que o jogo registra explicitamente.
 *
 * O console é criado antes de qualquer outra coisa na inicialização, então
 * alcança inclusive as falhas que acontecem durante o boot do terminal.
 */

/** Fornece linhas de informação ao vivo para os comandos. */
export type ConsoleInfoProvider = (arg: string) => readonly string[];

type PatchedMethod = 'log' | 'info' | 'warn' | 'error' | 'debug';

const PATCHED: ReadonlyArray<[PatchedMethod, ConsoleLevel]> = [
  ['log', 'info'],
  ['info', 'info'],
  ['warn', 'warn'],
  ['error', 'error'],
  ['debug', 'debug'],
];

/** Linhas mantidas no DOM; o buffer em memória pode guardar mais. */
const RENDER_LIMIT = 400;
/** Intervalo mínimo entre redesenhos, em ms. */
const RENDER_INTERVAL_MS = 100;
/** Distância do fim, em px, para considerar que o usuário está no rodapé. */
const STICK_THRESHOLD_PX = 48;

/** Tecla que abre e fecha o console. */
export const CONSOLE_TOGGLE_CODE = 'Backquote';

const HEAD_MARKUP = `
  <div class="oof-console__head">
    <span class="oof-console__title">CONSOLE <i>OUT-OF-FRAME</i></span>
    <span class="oof-console__counts" data-console-counts></span>
    <span class="oof-console__spacer"></span>
    <div class="oof-console__tools">
      <input class="oof-console__search" data-console-search type="text"
             placeholder="filtrar texto" aria-label="Filtrar linhas do console" />
      <button type="button" class="oof-console__btn" data-console-level-toggle
              title="Incluir mensagens de depuração">DEP</button>
      <button type="button" class="oof-console__btn" data-console-wrap
              title="Mostrar cada registro em uma linha só (melhor para varrer, pior para rastros de pilha)">1 LINHA</button>
      <button type="button" class="oof-console__btn" data-console-copy
              title="Copiar as linhas visíveis">COPIAR</button>
      <button type="button" class="oof-console__btn" data-console-clear
              title="Apagar todas as linhas">LIMPAR</button>
      <button type="button" class="oof-console__btn" data-console-close
              title="Fechar o console [crase]">FECHAR</button>
    </div>
  </div>
  <div class="oof-console__channels" data-console-channels></div>
  <div class="oof-console__body" data-console-body></div>
  <div class="oof-console__foot">
    <span class="oof-console__prompt">&gt;</span>
    <input class="oof-console__input" data-console-input type="text"
           placeholder="digite 'ajuda' para ver os comandos"
           aria-label="Comando do console" autocomplete="off" spellcheck="false" />
    <span class="oof-console__hint" data-console-hint>[\`] fecha</span>
  </div>
`;

function pick<T extends HTMLElement>(root: HTMLElement, name: string): T {
  return root.querySelector(`[data-console-${name}]`) as T;
}

export class GameConsole {
  private readonly root: HTMLDivElement;
  private readonly pillEl: HTMLButtonElement;
  private readonly bodyEl: HTMLDivElement;
  private readonly countsEl: HTMLElement;
  private readonly channelsEl: HTMLElement;
  private readonly searchEl: HTMLInputElement;
  private readonly inputEl: HTMLInputElement;
  private readonly levelToggleEl: HTMLButtonElement;
  private readonly wrapBtnEl: HTMLButtonElement;
  private readonly hintEl: HTMLElement;

  private readonly log = new ConsoleLog(600);
  private readonly registry = createDefaultCommands();
  private readonly providers = new Map<string, ConsoleInfoProvider>();
  private readonly originals = new Map<PatchedMethod, (...args: unknown[]) => void>();
  /** Desliga de uma vez todos os escutadores instalados pela captura. */
  private readonly captureCtrl = new AbortController();
  private readonly rows = new Map<number, HTMLElement>();

  private filter: ConsoleFilter = defaultConsoleFilter();
  private isOpen = false;
  private captureInstalled = false;
  private lastRenderedId = 0;
  private lastRenderMs = -1;
  private lastFilterKey = '';
  private dirty = false;
  private pillAcknowledged = 0;
  private readonly visibilityListeners = new Set<(open: boolean) => void>();
  private history: string[] = [];
  private historyIndex = -1;
  private commandContext: CommandContext;

  constructor(parent: HTMLElement = document.body) {
    this.root = document.createElement('div');
    this.root.className = 'oof-console';
    this.root.setAttribute('role', 'region');
    this.root.setAttribute('aria-label', 'Console do jogo');
    this.root.hidden = true;
    this.root.innerHTML = HEAD_MARKUP;
    parent.appendChild(this.root);

    this.bodyEl = pick(this.root, 'body');
    this.countsEl = pick(this.root, 'counts');
    this.channelsEl = pick(this.root, 'channels');
    this.searchEl = pick(this.root, 'search');
    this.inputEl = pick(this.root, 'input');
    this.levelToggleEl = pick(this.root, 'level-toggle');
    this.wrapBtnEl = pick(this.root, 'wrap');
    this.hintEl = pick(this.root, 'hint');
    this.hintEl.textContent = '[`] fecha · [Tab] completa';

    this.pillEl = document.createElement('button');
    this.pillEl.type = 'button';
    this.pillEl.className = 'oof-console-pill';
    this.pillEl.hidden = true;
    this.pillEl.title = 'Abrir o console do jogo';
    parent.appendChild(this.pillEl);

    this.commandContext = {
      print: (text, level = 'info') => this.push(level, 'geral', text),
      info: (topic) => this.requestInfo(topic),
      clear: () => {
        this.log.clear();
        this.rows.clear();
        this.bodyEl.textContent = '';
        this.lastRenderedId = 0;
        this.dirty = true;
      },
      setFilter: (patch) => this.applyFilterPatch(patch),
      getFilter: () => this.filter,
      copy: (text) => this.copyToClipboard(text),
    };

    this.buildChannelChips();
    this.bindUi();
    this.registerBuiltinProviders();

    // Registra a tecla em captura: precisa chegar antes do terminal e do jogo.
    window.addEventListener('keydown', this.onKeyDown, true);
  }

  // ---------------------------------------------------------------- API ----

  /**
   * Avisa quando o console abre ou fecha. O jogo usa isto para devolver a
   * trava do mouse quando o console sai da frente.
   */
  onVisibilityChange(listener: (open: boolean) => void): () => void {
    this.visibilityListeners.add(listener);
    return () => this.visibilityListeners.delete(listener);
  }

  /** Registra uma linha. */
  push(level: ConsoleLevel, channel: ConsoleChannel, ...parts: unknown[]): void {
    const text = parts.map(stringifyConsoleArg).join(' ');
    if (text.length === 0) return;
    this.log.push(level, channel, text, performance.now(), Date.now());
    this.dirty = true;
    this.refreshPill();
    this.scheduleRender();
  }

  debug(channel: ConsoleChannel, ...parts: unknown[]): void {
    this.push('debug', channel, ...parts);
  }

  info(channel: ConsoleChannel, ...parts: unknown[]): void {
    this.push('info', channel, ...parts);
  }

  warn(channel: ConsoleChannel, ...parts: unknown[]): void {
    this.push('warn', channel, ...parts);
  }

  error(channel: ConsoleChannel, ...parts: unknown[]): void {
    this.push('error', channel, ...parts);
  }

  system(channel: ConsoleChannel, ...parts: unknown[]): void {
    this.push('system', channel, ...parts);
  }

  /** Liga um provedor de informação usado pelos comandos. */
  registerInfoProvider(topic: string, provider: ConsoleInfoProvider): void {
    this.providers.set(topic, provider);
  }

  open(): void {
    if (this.isOpen) return;
    this.isOpen = true;
    setGameConsoleOpen(true);
    for (const listener of this.visibilityListeners) listener(true);
    this.root.hidden = false;
    this.pillEl.hidden = true;
    this.dirty = true;
    this.render(true);
    // Sem pointer lock o mouse fica livre para clicar nos filtros e botões.
    // Quem devolve a trava é o jogo, ao ver o console fechado.
    if (document.pointerLockElement) {
      try {
        document.exitPointerLock();
      } catch {
        // Alguns navegadores recusam fora de um gesto do usuário.
      }
    }
    // Foca no fim: o console pede digitação, então o cursor vai para o prompt.
    this.inputEl.focus({ preventScroll: true });
    this.scrollToBottom();
  }

  close(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    setGameConsoleOpen(false);
    for (const listener of this.visibilityListeners) listener(false);
    this.root.hidden = true;
    this.inputEl.blur();
    this.pillAcknowledged = this.log.totals().error;
    this.refreshPill();
  }

  toggle(): void {
    if (this.isOpen) this.close();
    else this.open();
  }

  get opened(): boolean {
    return this.isOpen;
  }

  /** Instala a captura de `console.*` e dos erros que escapam. */
  installCapture(): void {
    if (this.captureInstalled) return;
    this.captureInstalled = true;

    for (const [method, level] of PATCHED) {
      const original = console[method].bind(console);
      this.originals.set(method, original);
      console[method] = (...args: unknown[]) => {
        original(...args);
        // Qualquer falha aqui nunca pode derrubar o jogo: o console é
        // observador, nunca participante.
        try {
          this.pushFromConsole(level, args);
        } catch {
          /* silencioso de propósito */
        }
      };
    }

    const signal = this.captureCtrl.signal;

    window.addEventListener(
      'error',
      (event) => {
        const err = event.error;
        const where = event.filename
          ? ` em ${event.filename.split('/').pop()}:${event.lineno}:${event.colno}`
          : '';
        this.push(
          'error',
          'geral',
          `Exceção não tratada${where}: ${
            err instanceof Error ? stringifyConsoleArg(err) : event.message
          }`
        );
      },
      { signal }
    );

    window.addEventListener(
      'unhandledrejection',
      (event) => {
        this.push(
          'error',
          'geral',
          `Promessa rejeitada sem tratamento: ${stringifyConsoleArg(event.reason)}`
        );
      },
      { signal }
    );

    // O contexto WebGL não propaga o evento: capturar no documento alcança o
    // canvas mesmo assim, porque a fase de captura desce até o alvo.
    document.addEventListener(
      'webglcontextlost',
      () => {
        this.push('error', 'webgl', 'Contexto WebGL perdido — a placa de vídeo reiniciou.');
      },
      { capture: true, signal }
    );
    document.addEventListener(
      'webglcontextrestored',
      () => {
        this.push('warn', 'webgl', 'Contexto WebGL restaurado; os recursos foram reciclados.');
      },
      { capture: true, signal }
    );

    window.addEventListener(
      'online',
      () => this.push('info', 'rede', 'Conexão com a internet restabelecida.'),
      { signal }
    );
    window.addEventListener(
      'offline',
      () => this.push('warn', 'rede', 'Conexão com a internet perdida.'),
      { signal }
    );
  }

  destroy(): void {
    for (const [method, original] of this.originals) {
      console[method] = original;
    }
    this.originals.clear();
    this.captureCtrl.abort();
    this.visibilityListeners.clear();
    window.removeEventListener('keydown', this.onKeyDown, true);
    this.root.remove();
    this.pillEl.remove();
  }

  // ------------------------------------------------------------ interno ----

  private pushFromConsole(level: ConsoleLevel, args: readonly unknown[]): void {
    this.push(level, 'geral', ...args);
  }

  private requestInfo(topic: string): readonly string[] {
    const direct = this.providers.get(topic);
    if (direct) return this.safeProvider(direct, '');

    // Tópicos com argumento, como `config:fov`.
    const colon = topic.indexOf(':');
    if (colon > 0) {
      const base = topic.slice(0, colon);
      const arg = topic.slice(colon + 1);
      const provider = this.providers.get(base);
      if (provider) return this.safeProvider(provider, arg);
    }

    return [`Nenhuma informação disponível para "${topic}".`];
  }

  private safeProvider(
    provider: ConsoleInfoProvider,
    arg: string
  ): readonly string[] {
    try {
      return provider(arg);
    } catch (err) {
      return [`Falha ao consultar informação: ${stringifyConsoleArg(err)}`];
    }
  }

  private registerBuiltinProviders(): void {
    this.registerInfoProvider('versao', () => {
      const nav = typeof navigator === 'undefined' ? null : navigator;
      const screen = typeof window === 'undefined' ? null : window.screen;
      return [
        `Origem: ${typeof location === 'undefined' ? 'local' : location.hostname}`,
        `Navegador: ${nav?.userAgent ?? 'desconhecido'}`,
        `Tela: ${screen?.width ?? '?'}×${screen?.height ?? '?'} (DPR ${
          typeof window === 'undefined' ? '?' : window.devicePixelRatio
        })`,
        `Memória usada: ${this.describeMemory()}`,
      ];
    });

    this.registerInfoProvider('exportar', () => [this.log.exportText(this.filter)]);
  }

  private describeMemory(): string {
    const perf = performance as Performance & {
      memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number };
    };
    const mem = perf.memory;
    if (!mem) return 'não disponível neste navegador';
    const mb = (bytes: number): string => `${(bytes / 1048576).toFixed(1)} MB`;
    return `${mb(mem.usedJSHeapSize)} de ${mb(mem.jsHeapSizeLimit)}`;
  }

  private buildChannelChips(): void {
    const all = document.createElement('button');
    all.type = 'button';
    all.className = 'oof-console__chip is-on';
    all.dataset.channel = '';
    all.textContent = 'TODOS';
    all.addEventListener('click', () => this.setChannels(new Set()));
    this.channelsEl.appendChild(all);

    for (const channel of CONSOLE_CHANNELS) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'oof-console__chip';
      chip.dataset.channel = channel;
      chip.textContent = CHANNEL_LABELS[channel];
      chip.addEventListener('click', () =>
        this.setChannels(new Set<ConsoleChannel>([channel]))
      );
      this.channelsEl.appendChild(chip);
    }
  }

  private setChannels(channels: ReadonlySet<ConsoleChannel>): void {
    this.filter = { ...this.filter, channels: new Set(channels) };
    for (const chip of this.channelsEl.querySelectorAll<HTMLElement>('.oof-console__chip')) {
      const value = chip.dataset.channel ?? '';
      const on =
        value === ''
          ? this.filter.channels.size === 0
          : this.filter.channels.size === 1 && this.filter.channels.has(value as ConsoleChannel);
      chip.classList.toggle('is-on', on);
    }
    this.dirty = true;
    this.render(true);
  }

  private applyFilterPatch(patch: Partial<ConsoleFilter>): void {
    this.filter = { ...this.filter, ...patch };
    this.syncFilterControls();
    this.dirty = true;
    this.render(true);
  }

  private syncFilterControls(): void {
    this.searchEl.value = this.filter.query;
    this.levelToggleEl.classList.toggle('is-on', this.filter.levels.has('debug'));
    for (const chip of this.channelsEl.querySelectorAll<HTMLElement>('.oof-console__chip')) {
      const value = chip.dataset.channel ?? '';
      const on =
        value === ''
          ? this.filter.channels.size === 0
          : this.filter.channels.size === 1 && this.filter.channels.has(value as ConsoleChannel);
      chip.classList.toggle('is-on', on);
    }
  }

  private filterKey(): string {
    const levels = [...this.filter.levels].sort().join(',');
    const channels = [...this.filter.channels].sort().join(',');
    return `${levels}|${channels}|${this.filter.query.trim().toLowerCase()}`;
  }

  private bindUi(): void {
    this.searchEl.addEventListener('input', () => {
      this.filter = { ...this.filter, query: this.searchEl.value };
      this.dirty = true;
      this.scheduleRender();
    });

    this.levelToggleEl.addEventListener('click', () => {
      const levels = new Set(this.filter.levels);
      if (levels.has('debug')) levels.delete('debug');
      else levels.add('debug');
      this.applyFilterPatch({ levels });
    });

    this.wrapBtnEl.addEventListener('click', () => {
      // O padrão é quebrar a linha (melhor para rastros de pilha); o botão
      // alterna para "uma linha por registro", que facilita varrer o log.
      const singleLine = this.bodyEl.classList.toggle('is-single-line');
      this.wrapBtnEl.classList.toggle('is-on', singleLine);
    });

    this.root.querySelector('[data-console-copy]')?.addEventListener('click', () => {
      const ok = this.copyToClipboard(this.log.exportText(this.filter));
      this.push(ok ? 'system' : 'warn', 'geral', ok ? 'Linhas copiadas.' : 'Não foi possível copiar.');
    });

    this.root.querySelector('[data-console-clear]')?.addEventListener('click', () => {
      this.commandContext.clear();
    });

    this.root.querySelector('[data-console-close]')?.addEventListener('click', () => {
      this.close();
    });

    this.pillEl.addEventListener('click', () => this.open());

    // Enquanto o console está aberto, as teclas digitadas são dele: o jogo
    // escuta em `window` na fase de bolha, e isto impede que cheguem lá.
    this.inputEl.addEventListener('keydown', (e) => e.stopPropagation());

    this.inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.runCommand(this.inputEl.value);
        this.inputEl.value = '';
        return;
      }
      if (e.key === 'Tab') {
        e.preventDefault();
        this.completeInput();
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        this.recallHistory(-1);
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        this.recallHistory(1);
      }
    });
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    // `Backquote` abre e fecha de qualquer lugar: no menu, no terminal ou
    // dentro da partida. Consumido aqui para não virar texto em nenhum campo.
    if (e.code === CONSOLE_TOGGLE_CODE) {
      e.preventDefault();
      e.stopImmediatePropagation();
      this.toggle();
      return;
    }

    if (!this.isOpen) return;

    if (e.code === 'Escape') {
      e.preventDefault();
      e.stopImmediatePropagation();
      this.close();
      return;
    }

    // Qualquer digitação com o console aberto vai para o prompt.
    const typingKey =
      e.key.length === 1 || e.code === 'Backspace' || e.code === 'Enter';
    if (typingKey && document.activeElement !== this.inputEl && !e.ctrlKey && !e.metaKey && !e.altKey) {
      this.inputEl.focus({ preventScroll: true });
    }
  };

  private runCommand(raw: string): void {
    const line = raw.trim();
    this.push('system', 'geral', `> ${line}`);
    if (line.length === 0) return;

    this.history.push(line);
    if (this.history.length > 40) this.history.shift();
    this.historyIndex = this.history.length;

    const ok = this.registry.execute(line, this.commandContext);
    if (!ok) {
      const suggestion = this.registry.complete(line)[0];
      this.push(
        'warn',
        'geral',
        suggestion
          ? `Comando desconhecido "${line}". Você quis dizer "${suggestion}"?`
          : `Comando desconhecido "${line}". Digite "ajuda" para ver a lista.`
      );
    }
  }

  private completeInput(): void {
    const value = this.inputEl.value;
    const parts = value.split(/\s+/);
    const isFirstWord = parts.length === 1;
    const prefix = parts[parts.length - 1] ?? '';

    const pool = isFirstWord
      ? this.registry.complete(prefix)
      : this.registry
          .list()
          .flatMap((cmd) => cmd.complete ?? [])
          .filter((opt) => opt.startsWith(prefix.toLowerCase()));

    if (pool.length === 0) return;
    if (pool.length === 1) {
      parts[parts.length - 1] = pool[0];
      this.inputEl.value = `${parts.join(' ')} `;
      return;
    }
    this.push('system', 'geral', `Sugestões: ${pool.join(', ')}`);
  }

  private recallHistory(direction: number): void {
    if (this.history.length === 0) return;
    this.historyIndex = Math.max(
      0,
      Math.min(this.history.length, this.historyIndex + direction)
    );
    this.inputEl.value =
      this.historyIndex >= this.history.length ? '' : this.history[this.historyIndex];
    this.inputEl.setSelectionRange(this.inputEl.value.length, this.inputEl.value.length);
  }

  private copyToClipboard(text: string): boolean {
    try {
      void navigator.clipboard?.writeText(text);
      return true;
    } catch {
      return false;
    }
  }

  private scheduleRender(): void {
    if (!this.isOpen || !this.dirty) return;
    const now = performance.now();
    if (this.lastRenderMs >= 0 && now - this.lastRenderMs < RENDER_INTERVAL_MS) return;
    this.render(false);
  }

  private render(force: boolean): void {
    if (!this.isOpen) return;
    const key = this.filterKey();
    const filterChanged = force || key !== this.lastFilterKey;

    if (filterChanged) {
      this.lastFilterKey = key;
      this.rebuildAll();
    } else {
      this.appendNew();
    }

    this.renderCounts();
    this.dirty = false;
    this.lastRenderMs = performance.now();
  }

  private rebuildAll(): void {
    const visible = this.log.query(this.filter, RENDER_LIMIT);
    this.bodyEl.textContent = '';
    this.rows.clear();
    if (visible.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'oof-console__empty';
      empty.textContent =
        this.log.size === 0
          ? 'Nenhuma atividade registrada ainda.'
          : 'Nenhuma linha casa com o filtro atual.';
      this.bodyEl.appendChild(empty);
      this.lastRenderedId = 0;
      return;
    }
    for (const entry of visible) this.appendChildRow(entry);
    this.lastRenderedId = visible[visible.length - 1].id;
    this.scrollToBottom();
  }

  private appendNew(): void {
    const stick = this.isAtBottom();
    const fresh = this.log.query(this.filter, RENDER_LIMIT);
    const empty = this.bodyEl.querySelector('.oof-console__empty');
    if (empty) empty.remove();

    let added = 0;
    for (const entry of fresh) {
      if (entry.id <= this.lastRenderedId) continue;
      this.appendChildRow(entry);
      this.lastRenderedId = entry.id;
      added += 1;
    }
    if (added === 0) return;

    // A última linha é a que pode ter acumulado repetições.
    const last = fresh[fresh.length - 1];
    if (last) this.updateRepeatBadge(last);

    // Buffer circular: descarta as linhas mais antigas do DOM.
    while (this.bodyEl.childElementCount > RENDER_LIMIT) {
      const first = this.bodyEl.firstElementChild as HTMLElement | null;
      if (!first) break;
      const id = Number(first.dataset.id ?? '0');
      this.rows.delete(id);
      first.remove();
    }

    if (stick) this.scrollToBottom();
  }

  private appendChildRow(entry: ConsoleEntry): void {
    const row = document.createElement('div');
    row.className = 'oof-console__line';
    row.dataset.level = entry.level;
    row.dataset.id = String(entry.id);

    const time = document.createElement('span');
    time.className = 'oof-console__time';
    time.textContent = formatConsoleClock(entry.wall).slice(0, 12);

    const tag = document.createElement('span');
    tag.className = 'oof-console__tag';
    tag.textContent = LEVEL_LABELS[entry.level];

    const chan = document.createElement('span');
    chan.className = 'oof-console__chan';
    chan.textContent = CHANNEL_LABELS[entry.channel];

    const text = document.createElement('span');
    text.className = 'oof-console__text';
    text.textContent = entry.text;

    row.append(time, tag, chan, text);
    this.bodyEl.appendChild(row);
    this.rows.set(entry.id, row);
    this.updateRepeatBadge(entry);
  }

  private updateRepeatBadge(entry: ConsoleEntry): void {
    const row = this.rows.get(entry.id);
    if (!row) return;
    const existing = row.querySelector('.oof-console__repeat');
    if (entry.repeat <= 1) {
      existing?.remove();
      return;
    }
    const badge = existing ?? document.createElement('span');
    badge.className = 'oof-console__repeat';
    badge.textContent = `×${entry.repeat}`;
    if (!existing) row.appendChild(badge);
  }

  private renderCounts(): void {
    const totals = this.log.totals();
    const parts: string[] = [];
    for (const level of ['error', 'warn', 'info', 'debug'] as const) {
      const count = totals[level] + (level === 'info' ? totals.system : 0);
      parts.push(
        `<span class="oof-console__count" data-level="${level}">${count}</span>`
      );
    }
    this.countsEl.innerHTML = parts.join('');
  }

  private refreshPill(): void {
    if (this.isOpen) {
      this.pillEl.hidden = true;
      return;
    }
    const errors = this.log.totals().error;
    const unseen = errors - this.pillAcknowledged;
    this.pillEl.hidden = unseen <= 0;
    if (unseen > 0) {
      this.pillEl.innerHTML = `<i>!</i><span>${unseen} ERRO${
        unseen === 1 ? '' : 'S'
      }</span>`;
    }
  }

  private isAtBottom(): boolean {
    const distance =
      this.bodyEl.scrollHeight - this.bodyEl.scrollTop - this.bodyEl.clientHeight;
    return distance <= STICK_THRESHOLD_PX;
  }

  private scrollToBottom(): void {
    this.bodyEl.scrollTop = this.bodyEl.scrollHeight;
  }
}

// ============================================================================
// INSTÂNCIA COMPARTILHADA
// ============================================================================

let sharedConsole: GameConsole | null = null;
let sharedOpenState = false;

/** Console único do jogo, criado na primeira vez que alguém precisar dele. */
export function getGameConsole(): GameConsole {
  if (!sharedConsole) {
    sharedConsole = new GameConsole(document.body);
    sharedConsole.installCapture();
  }
  return sharedConsole;
}

/**
 * O console aberto precisa suspender atalhos do jogo e do terminal. Consultar
 * um estado compartilhado evita que cada sistema tenha uma referência ao
 * objeto inteiro.
 */
export function isGameConsoleOpen(): boolean {
  return sharedOpenState;
}

/** Chamado pelo console ao abrir e fechar; atualiza o estado compartilhado. */
export function setGameConsoleOpen(open: boolean): void {
  sharedOpenState = open;
}

/** Atalho para registrar atividade sem precisar buscar a instância. */
export function logActivity(
  channel: ConsoleChannel,
  ...parts: unknown[]
): void {
  getGameConsole().info(channel, ...parts);
}

export function logConsoleError(channel: ConsoleChannel, ...parts: unknown[]): void {
  getGameConsole().error(channel, ...parts);
}
