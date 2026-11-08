import { SoundEngine } from '../engine/audio/SoundEngine';

export type TerminalPhase =
  | 'idle'
  | 'booting'
  | 'desktop'
  | 'program_starting'
  | 'binary_interface'
  | 'powered_off';

export interface TerminalBootOptions {
  sound: SoundEngine;
  /**
   * Acionado sincronamente dentro do gesto do usuário ao iniciar pela interface binária,
   * abrindo o ambiente 3D sem modais extras.
   */
  onLaunchImmediateGesture: () => void;
}

type DesktopItemId = 'out_of_frame' | 'terminal' | 'notas' | 'desligar';

interface DesktopItemDef {
  id: DesktopItemId;
  label: string;
  glyph: string;
}

const DESKTOP_ITEMS: DesktopItemDef[] = [
  {
    id: 'out_of_frame',
    label: 'out_of_frame.exe',
    glyph: '+-------+\n| [EXE] |\n+-------+',
  },
  {
    id: 'terminal',
    label: 'terminal',
    glyph: '+-------+\n|  >_   |\n+-------+',
  },
  {
    id: 'notas',
    label: 'notas.txt',
    glyph: '+-------+\n| [TXT] |\n+-------+',
  },
  {
    id: 'desligar',
    label: 'desligar',
    glyph: '+-------+\n|  (I)  |\n+-------+',
  },
];

interface OpenWindowState {
  id: 'terminal' | 'notas';
  title: string;
  el: HTMLElement;
  bodyEl: HTMLElement;
  z: number;
}

interface BinarySlot {
  sx: number;
  sy: number;
  tx: number;
  ty: number;
  finalChar: string;
  isBinaryBorder: boolean;
  isMenuSeed: boolean;
  wakeAt: number;
  travelSpan: number;
  bit: '0' | '1';
}

interface MenuHitbox {
  index: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Sistema de Terminal:
 * 1. Carregamento normal de inicialização do terminal.
 * 2. Área de trabalho versão terminal interativa (ícones ASCII, janelas em modo texto,
 *    barra de tarefas com menu e relógio, linha de comando).
 * 3. Ao abrir `out_of_frame.exe`: exibe aviso de desenvolvimento e une código binário
 *    aos poucos formando a interface estilo Superhot.
 */
export class TerminalBootController {
  private phase: TerminalPhase = 'idle';
  private readonly sound: SoundEngine;

  private rootEl!: HTMLElement;
  private bootLayerEl!: HTMLElement;
  private desktopEl!: HTMLElement;
  private workspaceEl!: HTMLElement;
  private iconGridEl!: HTMLElement;
  private startPopupEl!: HTMLElement;
  private startBtnEl!: HTMLButtonElement;
  private taskWindowsEl!: HTMLElement;
  private clockEl!: HTMLElement;

  private hiddenInputEl!: HTMLInputElement;
  private typedSpanEl: HTMLElement | null = null;
  private promptRowEl: HTMLElement | null = null;
  private prevInputLen = 0;

  // Estado da Área de Trabalho em modo Terminal
  private selectedIconIndex = 0;
  private startMenuOpen = false;
  private windows = new Map<'terminal' | 'notas', OpenWindowState>();
  private focusedWindowId: 'terminal' | 'notas' | null = null;
  private topZ = 10;
  private clockIntervalId = 0;

  // Arrasto de janelas na área de trabalho
  private draggingWin: {
    el: HTMLElement;
    offsetX: number;
    offsetY: number;
  } | null = null;

  // Canvas da convergência binária (out_of_frame.exe)
  private canvasEl!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private timers: number[] = [];
  private rafId = 0;

  private coalescingStart = 0;
  private readonly devNoticeHoldMs = 1500;
  private readonly coalesceDurationMs = 4200;
  private slots: BinarySlot[] = [];
  private gridCols = 80;
  private gridRows = 30;
  private boxTop = 6;
  private cellW = 10;
  private cellH = 20;
  private menuIndex = 0;
  private menuHitboxes: MenuHitbox[] = [];

  private boundKeyCapture!: (e: KeyboardEvent) => void;
  private boundPointerUnlock!: () => void;
  private boundMouseMove!: (e: MouseEvent) => void;
  private boundMouseUp!: () => void;
  private boundResize!: () => void;

  constructor(
    private readonly mountParent: HTMLElement,
    private readonly options: TerminalBootOptions
  ) {
    this.sound = options.sound;
    this.buildDom();
    this.bindEvents();
  }

  get currentPhase(): TerminalPhase {
    return this.phase;
  }

  private buildDom(): void {
    this.rootEl = document.createElement('div');
    this.rootEl.id = 'terminal-root';

    this.bootLayerEl = document.createElement('div');
    this.bootLayerEl.id = 'terminal-boot-layer';

    this.desktopEl = document.createElement('div');
    this.desktopEl.id = 'terminal-desktop';
    this.desktopEl.innerHTML = `
      <div class="tui-workspace">
        <div class="tui-icon-grid"></div>
        <div class="tui-start-popup"></div>
      </div>
      <div class="tui-taskbar">
        <div class="tui-taskbar-left">
          <button type="button" class="tui-task-btn" id="tui-start-btn">[ MENU ]</button>
          <div id="tui-task-windows" style="display:flex;gap:6px;"></div>
        </div>
        <div class="tui-clock" id="tui-clock">00:00:00</div>
      </div>
    `;

    this.workspaceEl = this.desktopEl.querySelector('.tui-workspace') as HTMLElement;
    this.iconGridEl = this.desktopEl.querySelector('.tui-icon-grid') as HTMLElement;
    this.startPopupEl = this.desktopEl.querySelector('.tui-start-popup') as HTMLElement;
    this.startBtnEl = this.desktopEl.querySelector('#tui-start-btn') as HTMLButtonElement;
    this.taskWindowsEl = this.desktopEl.querySelector('#tui-task-windows') as HTMLElement;
    this.clockEl = this.desktopEl.querySelector('#tui-clock') as HTMLElement;

    this.hiddenInputEl = document.createElement('input');
    this.hiddenInputEl.id = 'terminal-hidden-input';
    this.hiddenInputEl.type = 'text';
    this.hiddenInputEl.autocomplete = 'off';
    this.hiddenInputEl.spellcheck = false;

    this.canvasEl = document.createElement('canvas');
    this.canvasEl.id = 'binary-ui-canvas';

    this.rootEl.append(
      this.bootLayerEl,
      this.desktopEl,
      this.hiddenInputEl,
      this.canvasEl
    );
    this.mountParent.appendChild(this.rootEl);

    const context = this.canvasEl.getContext('2d');
    if (!context) {
      throw new Error('Contexto 2D indisponível para a interface binária.');
    }
    this.ctx = context;

    this.renderDesktopIcons();
    this.renderStartMenu();
  }

  private renderDesktopIcons(): void {
    this.iconGridEl.innerHTML = '';
    DESKTOP_ITEMS.forEach((item, index) => {
      const iconEl = document.createElement('div');
      iconEl.className =
        index === this.selectedIconIndex ? 'tui-icon selected' : 'tui-icon';
      iconEl.dataset.index = String(index);

      const glyphEl = document.createElement('div');
      glyphEl.className = 'tui-icon-glyph';
      glyphEl.textContent = item.glyph;

      const labelEl = document.createElement('div');
      labelEl.className = 'tui-icon-label';
      labelEl.textContent = item.label;

      iconEl.append(glyphEl, labelEl);

      iconEl.addEventListener('mouseenter', () => {
        if (this.phase !== 'desktop') return;
        if (this.selectedIconIndex !== index) {
          this.selectedIconIndex = index;
          this.syncIconSelection();
          this.sound.menuMove();
        }
      });

      iconEl.addEventListener('click', (e) => {
        e.stopPropagation();
        if (this.phase !== 'desktop') return;
        this.sound.unlock();
        this.selectedIconIndex = index;
        this.syncIconSelection();
        this.closeStartMenu();
        this.sound.keyEnter();
        this.activateDesktopItem(item.id);
      });

      this.iconGridEl.appendChild(iconEl);
    });
  }

  private syncIconSelection(): void {
    const nodes = this.iconGridEl.querySelectorAll('.tui-icon');
    nodes.forEach((node, idx) => {
      node.classList.toggle(
        'selected',
        idx === this.selectedIconIndex && this.focusedWindowId === null
      );
    });
  }

  private renderStartMenu(): void {
    this.startPopupEl.innerHTML = '';
    DESKTOP_ITEMS.forEach((item, idx) => {
      if (item.id === 'desligar' && idx > 0) {
        const div = document.createElement('div');
        div.className = 'tui-start-divider';
        this.startPopupEl.appendChild(div);
      }

      const row = document.createElement('div');
      row.className = 'tui-start-item';
      row.textContent = item.label;

      row.addEventListener('mouseenter', () => {
        this.sound.menuMove();
      });

      row.addEventListener('click', (e) => {
        e.stopPropagation();
        this.sound.unlock();
        this.closeStartMenu();
        this.sound.keyEnter();
        this.activateDesktopItem(item.id);
      });

      this.startPopupEl.appendChild(row);
    });
  }

  private bindEvents(): void {
    this.boundPointerUnlock = () => this.sound.unlock();
    window.addEventListener('pointerdown', this.boundPointerUnlock, {
      passive: true,
    });

    this.startBtnEl.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.phase !== 'desktop') return;
      this.sound.unlock();
      this.sound.menuMove();
      this.startMenuOpen = !this.startMenuOpen;
      this.startPopupEl.classList.toggle('open', this.startMenuOpen);
      this.startBtnEl.classList.toggle('active', this.startMenuOpen);
    });

    // Clicar no fundo vazio da área de trabalho desfoca janelas e fecha o menu
    this.workspaceEl.addEventListener('mousedown', (e) => {
      if (this.phase !== 'desktop') return;
      if (
        e.target === this.workspaceEl ||
        e.target === this.iconGridEl
      ) {
        this.closeStartMenu();
        this.focusWindow(null);
      }
    });

    this.canvasEl.addEventListener('mousedown', (e) => {
      this.sound.unlock();
      if (this.phase === 'binary_interface') {
        this.handleCanvasClick(e.clientX, e.clientY);
      }
    });

    this.canvasEl.addEventListener('mousemove', (e) => {
      if (this.phase !== 'binary_interface') return;
      for (const box of this.menuHitboxes) {
        if (
          e.clientX >= box.x &&
          e.clientX <= box.x + box.w &&
          e.clientY >= box.y &&
          e.clientY <= box.y + box.h
        ) {
          if (this.menuIndex !== box.index) {
            this.menuIndex = box.index;
            this.sound.menuMove();
          }
          this.canvasEl.style.cursor = 'pointer';
          return;
        }
      }
      this.canvasEl.style.cursor = 'default';
    });

    // Movimento de arrasto de janelas TUI
    this.boundMouseMove = (e: MouseEvent) => {
      if (!this.draggingWin || this.phase !== 'desktop') return;
      const wsRect = this.workspaceEl.getBoundingClientRect();
      const maxX = Math.max(0, wsRect.width - this.draggingWin.el.offsetWidth);
      const maxY = Math.max(0, wsRect.height - this.draggingWin.el.offsetHeight);

      const nextX = Math.min(
        maxX,
        Math.max(0, e.clientX - wsRect.left - this.draggingWin.offsetX)
      );
      const nextY = Math.min(
        maxY,
        Math.max(0, e.clientY - wsRect.top - this.draggingWin.offsetY)
      );

      this.draggingWin.el.style.left = `${nextX}px`;
      this.draggingWin.el.style.top = `${nextY}px`;
    };
    window.addEventListener('mousemove', this.boundMouseMove);

    this.boundMouseUp = () => {
      this.draggingWin = null;
    };
    window.addEventListener('mouseup', this.boundMouseUp);

    // Entrada de texto na janela "terminal"
    this.hiddenInputEl.addEventListener('input', () => {
      if (
        this.phase !== 'desktop' ||
        this.focusedWindowId !== 'terminal' ||
        !this.typedSpanEl
      ) {
        return;
      }
      const val = this.hiddenInputEl.value;
      if (val.length > this.prevInputLen) {
        const lastChar = val[val.length - 1];
        this.sound.keyType(lastChar === ' ');
      }
      this.prevInputLen = val.length;
      this.typedSpanEl.textContent = val;
    });

    this.hiddenInputEl.addEventListener('keydown', (e) => {
      if (this.phase !== 'desktop' || this.focusedWindowId !== 'terminal') return;
      if (e.key === 'Enter') {
        e.preventDefault();
        this.sound.keyEnter();
        this.submitTerminalWindowCommand(this.hiddenInputEl.value);
      } else if (e.key === 'Backspace') {
        this.sound.keyBackspace();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.closeWindow('terminal');
      }
    });

    // Teclado global para navegar na Área de Trabalho ou na Interface Binária
    this.boundKeyCapture = (e: KeyboardEvent) => {
      this.sound.unlock();

      if (this.phase === 'desktop') {
        if (e.key === 'Escape') {
          if (this.startMenuOpen) {
            e.preventDefault();
            this.closeStartMenu();
            this.sound.keyBackspace();
            return;
          }
          if (this.focusedWindowId) {
            e.preventDefault();
            this.closeWindow(this.focusedWindowId);
            return;
          }
        }

        // Se a janela "terminal" estiver focada, encaminha digitação para ela
        if (this.focusedWindowId === 'terminal') {
          if (document.activeElement !== this.hiddenInputEl) {
            this.hiddenInputEl.focus();
            if (e.key === 'Enter') {
              e.preventDefault();
              this.sound.keyEnter();
              this.submitTerminalWindowCommand(this.hiddenInputEl.value);
            } else if (e.key === 'Backspace') {
              e.preventDefault();
              this.sound.keyBackspace();
              this.hiddenInputEl.value = this.hiddenInputEl.value.slice(0, -1);
              this.prevInputLen = this.hiddenInputEl.value.length;
              if (this.typedSpanEl) {
                this.typedSpanEl.textContent = this.hiddenInputEl.value;
              }
            } else if (
              e.key.length === 1 &&
              !e.ctrlKey &&
              !e.metaKey &&
              !e.altKey
            ) {
              e.preventDefault();
              this.sound.keyType(e.key === ' ');
              this.hiddenInputEl.value += e.key;
              this.prevInputLen = this.hiddenInputEl.value.length;
              if (this.typedSpanEl) {
                this.typedSpanEl.textContent = this.hiddenInputEl.value;
              }
            }
          }
          return;
        }

        // Navegação por teclado nos ícones da área de trabalho
        if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
          e.preventDefault();
          this.selectedIconIndex =
            (this.selectedIconIndex + 1) % DESKTOP_ITEMS.length;
          this.syncIconSelection();
          this.sound.menuMove();
        } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
          e.preventDefault();
          this.selectedIconIndex =
            (this.selectedIconIndex - 1 + DESKTOP_ITEMS.length) %
            DESKTOP_ITEMS.length;
          this.syncIconSelection();
          this.sound.menuMove();
        } else if (e.key === 'Enter') {
          e.preventDefault();
          this.closeStartMenu();
          this.sound.keyEnter();
          this.activateDesktopItem(DESKTOP_ITEMS[this.selectedIconIndex].id);
        }
      } else if (this.phase === 'binary_interface') {
        if (e.key === 'ArrowUp' || e.code === 'KeyW') {
          e.preventDefault();
          this.menuIndex = (this.menuIndex + 1) % 2;
          this.sound.menuMove();
        } else if (e.key === 'ArrowDown' || e.code === 'KeyS') {
          e.preventDefault();
          this.menuIndex = (this.menuIndex + 1) % 2;
          this.sound.menuMove();
        } else if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          this.executeMenuSelection();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          this.returnToDesktopFromBinary();
        }
      }
    };
    window.addEventListener('keydown', this.boundKeyCapture, true);

    this.boundResize = () => {
      if (
        this.phase === 'program_starting' ||
        this.phase === 'binary_interface'
      ) {
        this.setupCanvasMetrics();
        this.rebuildBinaryBlueprint(this.phase === 'binary_interface');
      }
    };
    window.addEventListener('resize', this.boundResize);
  }

  private closeStartMenu(): void {
    this.startMenuOpen = false;
    this.startPopupEl.classList.remove('open');
    this.startBtnEl.classList.remove('active');
  }

  private schedule(fn: () => void, ms: number): void {
    const id = window.setTimeout(fn, ms);
    this.timers.push(id);
  }

  private clearTimers(): void {
    for (const id of this.timers) {
      window.clearTimeout(id);
    }
    this.timers = [];
  }

  private appendBootLine(text: string): HTMLElement {
    const line = document.createElement('div');
    line.textContent = text;
    this.bootLayerEl.appendChild(line);
    return line;
  }

  /**
   * 1. Inicialização normal do terminal -> entra direto na Área de Trabalho versão Terminal.
   */
  startSequence(): void {
    this.clearTimers();
    this.sound.unlock();
    this.phase = 'booting';
    this.bootLayerEl.classList.remove('hidden');
    this.desktopEl.classList.remove('active');
    this.bootLayerEl.innerHTML = '';

    this.schedule(() => {
      this.appendBootLine('Iniciando terminal...');
      this.sound.bootLine();
    }, 250);

    let barLine: HTMLElement | null = null;
    this.schedule(() => {
      barLine = this.appendBootLine('Carregando [....................] 0%');
      this.sound.bootLine();
    }, 620);

    const totalBlocks = 20;
    const steps = [18, 38, 58, 78, 92, 100];
    steps.forEach((pct, idx) => {
      this.schedule(() => {
        if (!barLine) return;
        const filled = Math.round((pct / 100) * totalBlocks);
        const bar = '#'.repeat(filled) + '.'.repeat(totalBlocks - filled);
        barLine.textContent = `Carregando [${bar}] ${pct}%`;
        this.sound.loadingStep(pct);
      }, 900 + idx * 250);
    });

    const readyTime = 900 + steps.length * 250 + 300;
    this.schedule(() => {
      this.enterDesktopPhase();
    }, readyTime);
  }

  /**
   * 2. Abre a Área de Trabalho versão Terminal.
   */
  private enterDesktopPhase(): void {
    this.phase = 'desktop';
    this.bootLayerEl.classList.add('hidden');
    this.desktopEl.classList.add('active');
    this.sound.desktopReady();

    this.updateClock();
    if (this.clockIntervalId) window.clearInterval(this.clockIntervalId);
    this.clockIntervalId = window.setInterval(() => this.updateClock(), 1000);

    this.syncIconSelection();
  }

  private updateClock(): void {
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const ss = String(now.getSeconds()).padStart(2, '0');
    this.clockEl.textContent = `${hh}:${mm}:${ss}`;
  }

  private activateDesktopItem(id: DesktopItemId): void {
    if (id === 'out_of_frame') {
      this.startProgramSequence();
    } else if (id === 'terminal') {
      this.openOrFocusWindow('terminal');
    } else if (id === 'notas') {
      this.openOrFocusWindow('notas');
    } else if (id === 'desligar') {
      this.shutdownSystem();
    }
  }

  private openOrFocusWindow(id: 'terminal' | 'notas'): void {
    const existing = this.windows.get(id);
    if (existing) {
      this.focusWindow(id);
      return;
    }

    this.sound.windowOpen();
    const winEl = document.createElement('div');
    winEl.className = 'tui-window';

    const isCmd = id === 'terminal';
    const title = isCmd ? 'terminal' : 'notas.txt';

    winEl.style.width = isCmd ? '480px' : '400px';
    winEl.style.height = isCmd ? '290px' : '210px';
    winEl.style.left = isCmd ? '220px' : '260px';
    winEl.style.top = isCmd ? '48px' : '96px';

    const titlebar = document.createElement('div');
    titlebar.className = 'tui-window-titlebar';

    const titleSpan = document.createElement('span');
    titleSpan.textContent = `[ ${title} ]`;

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'tui-window-close';
    closeBtn.textContent = '[X]';
    closeBtn.addEventListener('mousedown', (e) => e.stopPropagation());
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.closeWindow(id);
    });

    titlebar.append(titleSpan, closeBtn);

    const bodyEl = document.createElement('div');
    bodyEl.className = isCmd
      ? 'tui-window-body tui-cmd-body'
      : 'tui-window-body';

    winEl.append(titlebar, bodyEl);
    this.workspaceEl.appendChild(winEl);

    winEl.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      this.closeStartMenu();
      this.focusWindow(id);
    });

    titlebar.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      this.closeStartMenu();
      this.focusWindow(id);
      const rect = winEl.getBoundingClientRect();
      this.draggingWin = {
        el: winEl,
        offsetX: e.clientX - rect.left,
        offsetY: e.clientY - rect.top,
      };
    });

    const state: OpenWindowState = {
      id,
      title,
      el: winEl,
      bodyEl,
      z: ++this.topZ,
    };
    winEl.style.zIndex = String(state.z);
    this.windows.set(id, state);

    if (isCmd) {
      this.appendCmdLine(bodyEl, 'Digite "ajuda" para ver os comandos.');
      this.openCmdPrompt(bodyEl);
    } else {
      bodyEl.textContent =
        'ARQUIVO: notas.txt\n' +
        '------------------------------------\n' +
        'Sistema operacional em modo terminal.\n\n' +
        'Aplicativo disponível:\n' +
        '- out_of_frame.exe (em desenvolvimento)';
    }

    this.focusWindow(id);
    this.renderTaskbarWindows();
  }

  private focusWindow(id: 'terminal' | 'notas' | null): void {
    this.focusedWindowId = id;
    for (const [winId, state] of this.windows.entries()) {
      const isFocused = winId === id;
      if (isFocused) {
        state.z = ++this.topZ;
        state.el.style.zIndex = String(state.z);
      }
      state.el.classList.toggle('focused', isFocused);
    }

    this.syncIconSelection();
    this.renderTaskbarWindows();

    if (id === 'terminal') {
      window.setTimeout(() => this.hiddenInputEl.focus(), 0);
    } else {
      this.hiddenInputEl.blur();
    }
  }

  private closeWindow(id: 'terminal' | 'notas'): void {
    const state = this.windows.get(id);
    if (!state) return;

    this.sound.keyBackspace();
    state.el.remove();
    this.windows.delete(id);

    if (id === 'terminal') {
      this.promptRowEl = null;
      this.typedSpanEl = null;
      this.hiddenInputEl.value = '';
      this.prevInputLen = 0;
    }

    if (this.focusedWindowId === id) {
      const remaining = Array.from(this.windows.keys());
      this.focusWindow(
        remaining.length > 0 ? remaining[remaining.length - 1] : null
      );
    } else {
      this.renderTaskbarWindows();
    }
  }

  private renderTaskbarWindows(): void {
    this.taskWindowsEl.innerHTML = '';
    for (const [id, state] of this.windows.entries()) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className =
        this.focusedWindowId === id ? 'tui-task-btn active' : 'tui-task-btn';
      btn.textContent = state.title;
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.closeStartMenu();
        this.sound.menuMove();
        this.focusWindow(id);
      });
      this.taskWindowsEl.appendChild(btn);
    }
  }

  private appendCmdLine(container: HTMLElement, text: string): void {
    const div = document.createElement('div');
    div.textContent = text;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
  }

  private openCmdPrompt(container: HTMLElement): void {
    this.hiddenInputEl.value = '';
    this.prevInputLen = 0;

    const row = document.createElement('div');
    row.className = 'term-prompt-row';

    const prefix = document.createElement('span');
    prefix.className = 'term-prefix';
    prefix.textContent = '>';

    const typed = document.createElement('span');
    typed.className = 'term-typed';

    const cursor = document.createElement('span');
    cursor.className = 'term-block-cursor';

    row.append(prefix, typed, cursor);
    container.appendChild(row);
    container.scrollTop = container.scrollHeight;

    this.promptRowEl = row;
    this.typedSpanEl = typed;
    this.hiddenInputEl.focus();
  }

  private submitTerminalWindowCommand(rawInput: string): void {
    const cmdWin = this.windows.get('terminal');
    if (!cmdWin) return;

    if (this.promptRowEl) {
      this.promptRowEl.innerHTML = '';
      this.promptRowEl.textContent = `> ${rawInput}`;
      this.promptRowEl = null;
      this.typedSpanEl = null;
    }
    this.hiddenInputEl.value = '';
    this.prevInputLen = 0;

    const clean = rawInput.trim();
    const lower = clean.toLowerCase();

    if (clean === '') {
      this.openCmdPrompt(cmdWin.bodyEl);
      return;
    }

    if (lower === 'ajuda' || lower === 'help') {
      this.appendCmdLine(
        cmdWin.bodyEl,
        'Comandos: ls, out_of_frame.exe, notas.txt, limpar, fechar, desligar'
      );
    } else if (lower === 'ls' || lower === 'dir') {
      this.appendCmdLine(
        cmdWin.bodyEl,
        'out_of_frame.exe   notas.txt'
      );
    } else if (
      lower === 'out_of_frame.exe' ||
      lower === './out_of_frame.exe' ||
      lower === 'abrir out_of_frame.exe' ||
      lower === 'out_of_frame'
    ) {
      this.openCmdPrompt(cmdWin.bodyEl);
      this.startProgramSequence();
      return;
    } else if (
      lower === 'notas.txt' ||
      lower === 'cat notas.txt' ||
      lower === 'abrir notas.txt'
    ) {
      this.openCmdPrompt(cmdWin.bodyEl);
      this.openOrFocusWindow('notas');
      return;
    } else if (lower === 'limpar' || lower === 'clear' || lower === 'cls') {
      cmdWin.bodyEl.innerHTML = '';
    } else if (lower === 'fechar' || lower === 'exit') {
      this.closeWindow('terminal');
      return;
    } else if (lower === 'desligar' || lower === 'shutdown') {
      this.shutdownSystem();
      return;
    } else {
      this.sound.invalidInput();
      this.appendCmdLine(
        cmdWin.bodyEl,
        `Comando não reconhecido: "${clean}". Digite "ajuda".`
      );
    }

    this.openCmdPrompt(cmdWin.bodyEl);
  }

  private shutdownSystem(): void {
    this.phase = 'powered_off';
    this.closeStartMenu();
    this.hiddenInputEl.blur();
    if (this.clockIntervalId) window.clearInterval(this.clockIntervalId);

    this.desktopEl.classList.remove('active');
    this.canvasEl.classList.remove('active');
    this.bootLayerEl.classList.remove('hidden');
    this.bootLayerEl.innerHTML = '';
    this.appendBootLine('Desligando...');
    this.sound.shutdown();

    this.schedule(() => {
      this.bootLayerEl.innerHTML = '';
      this.sound.dispose();
    }, 650);
  }

  /**
   * 3. Abre o aplicativo `out_of_frame.exe`:
   *    mostra que ainda está em desenvolvimento e junta os dígitos binários na interface Superhot.
   */
  private startProgramSequence(): void {
    this.phase = 'program_starting';
    this.closeStartMenu();
    this.hiddenInputEl.blur();

    this.setupCanvasMetrics();
    this.rebuildBinaryBlueprint(false);
    this.canvasEl.classList.add('active');
    this.sound.startBinaryProgramSequence();

    this.coalescingStart = performance.now();
    const tick = (now: number) => {
      if (
        this.phase !== 'program_starting' &&
        this.phase !== 'binary_interface'
      ) {
        return;
      }
      this.renderBinaryFrame(now);
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  private returnToDesktopFromBinary(): void {
    cancelAnimationFrame(this.rafId);
    this.sound.stopCoalesceDrone();
    this.canvasEl.classList.remove('active');
    this.canvasEl.style.cursor = 'default';
    this.phase = 'desktop';
    this.sound.keyBackspace();
    if (this.focusedWindowId === 'terminal') {
      window.setTimeout(() => this.hiddenInputEl.focus(), 0);
    }
  }

  private setupCanvasMetrics(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth;
    const h = window.innerHeight;

    this.canvasEl.width = Math.floor(w * dpr);
    this.canvasEl.height = Math.floor(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    this.ctx.font = '16px Consolas, "Courier New", monospace';
    const measured = this.ctx.measureText('0');
    this.cellW = Math.max(8, Math.ceil(measured.width));
    this.cellH = 20;

    this.gridCols = Math.max(44, Math.floor(w / this.cellW));
    this.gridRows = Math.max(20, Math.floor(h / this.cellH));
  }

  private rebuildBinaryBlueprint(alreadyLocked: boolean): void {
    const cols = this.gridCols;
    const rows = this.gridRows;

    const boxW = Math.min(58, cols - 6);
    const boxH = 16;
    const left = Math.floor((cols - boxW) * 0.5);
    const top = Math.floor((rows - boxH) * 0.5);
    this.boxTop = top;

    const right = left + boxW - 1;
    const bottom = top + boxH - 1;
    const headerDividerY = top + 3;

    const map = new Map<
      string,
      { tx: number; ty: number; ch: string; isBorder: boolean; isMenu: boolean }
    >();

    const put = (
      x: number,
      y: number,
      ch: string,
      isBorder: boolean,
      isMenu = false
    ) => {
      if (x < 0 || x >= cols || y < 0 || y >= rows) return;
      map.set(`${x},${y}`, { tx: x, ty: y, ch, isBorder, isMenu });
    };

    const writeText = (startX: number, y: number, text: string, isMenu = false) => {
      for (let i = 0; i < text.length; i++) {
        if (text[i] !== ' ') {
          put(startX + i, y, text[i], false, isMenu);
        }
      }
    };

    for (let x = left; x <= right; x++) {
      put(x, top, Math.random() < 0.5 ? '0' : '1', true);
      put(x, bottom, Math.random() < 0.5 ? '0' : '1', true);
      put(x, headerDividerY, Math.random() < 0.5 ? '0' : '1', true);
    }

    for (let y = top; y <= bottom; y++) {
      put(left, y, Math.random() < 0.5 ? '0' : '1', true);
      put(left + 1, y, Math.random() < 0.5 ? '0' : '1', true);
      put(right - 1, y, Math.random() < 0.5 ? '0' : '1', true);
      put(right, y, Math.random() < 0.5 ? '0' : '1', true);
    }

    const title = 'OUT-OF-FRAME';
    writeText(left + 4, top + 1, title);

    const statusTag = '[ EM DESENVOLVIMENTO ]';
    if (boxW >= title.length + statusTag.length + 10) {
      writeText(right - 3 - statusTag.length, top + 1, statusTag);
    }

    const devLine = 'Em desenvolvimento';
    writeText(
      Math.floor((cols - devLine.length) * 0.5),
      headerDividerY + 2,
      devLine
    );

    const opt0 = 'INICIAR';
    const opt1 = 'SAIR';
    writeText(Math.floor((cols - opt0.length) * 0.5), top + 8, opt0, true);
    writeText(Math.floor((cols - opt1.length) * 0.5), top + 10, opt1, true);

    const hint = '[SETAS] MOVER   [ENTER] CONFIRMAR';
    writeText(Math.floor((cols - hint.length) * 0.5), bottom - 2, hint);

    const entries = Array.from(map.values());
    for (let i = entries.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = entries[i];
      entries[i] = entries[j];
      entries[j] = tmp;
    }

    this.slots = entries.map((item, idx) => {
      const u = entries.length > 1 ? idx / (entries.length - 1) : 0;
      const wakeAt = alreadyLocked ? 0 : Math.pow(u, 1.9) * 0.64;
      const travelSpan = 0.31 + Math.random() * 0.05;

      return {
        sx: Math.floor(Math.random() * cols),
        sy: Math.floor(Math.random() * rows),
        tx: item.tx,
        ty: item.ty,
        finalChar: item.ch,
        isBinaryBorder: item.isBorder,
        isMenuSeed: item.isMenu,
        wakeAt,
        travelSpan,
        bit: Math.random() < 0.5 ? '0' : '1',
      };
    });
  }

  private renderBinaryFrame(now: number): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const ctx = this.ctx;

    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, w, h);

    ctx.font = '16px Consolas, "Courier New", monospace';
    ctx.textBaseline = 'top';

    const elapsed = now - this.coalescingStart;

    if (elapsed < this.devNoticeHoldMs && this.phase === 'program_starting') {
      this.drawInitialDevNotice(1.0, 0);
      return;
    }

    const rawT =
      this.phase === 'binary_interface'
        ? 1.0
        : Math.min(
            1.0,
            (elapsed - this.devNoticeHoldMs) / this.coalesceDurationMs
          );

    if (rawT >= 1.0 && this.phase === 'program_starting') {
      this.phase = 'binary_interface';
      this.sound.interfaceLocked();
    }

    if (rawT < 0.5) {
      const fade = 1 - rawT / 0.5;
      this.drawInitialDevNotice(fade, rawT * 1.7);
    }

    let lockedCount = 0;

    for (let i = 0; i < this.slots.length; i++) {
      const s = this.slots[i];
      if (rawT < s.wakeAt) continue;

      if (this.phase === 'binary_interface' && s.isMenuSeed) continue;

      const localT =
        this.phase === 'binary_interface'
          ? 1.0
          : Math.min(1.0, (rawT - s.wakeAt) / s.travelSpan);

      if (localT >= 1.0) lockedCount++;

      const eased =
        localT < 0.5
          ? 4 * localT * localT * localT
          : 1 - Math.pow(-2 * localT + 2, 3) / 2;

      const gx = Math.round(s.sx + (s.tx - s.sx) * eased);
      const gy = Math.round(s.sy + (s.ty - s.sy) * eased);

      if (localT < 1.0) {
        if (Math.random() < 0.18) {
          s.bit = s.bit === '0' ? '1' : '0';
        }
      } else if (s.isBinaryBorder && Math.random() < 0.008) {
        s.bit = s.bit === '0' ? '1' : '0';
      }

      const ch = localT >= 1.0 && !s.isBinaryBorder ? s.finalChar : s.bit;
      const alpha =
        localT < 1.0 ? 0.42 + 0.58 * localT : s.isBinaryBorder ? 0.8 : 1.0;

      ctx.fillStyle = `rgba(229, 229, 229, ${alpha.toFixed(2)})`;
      ctx.fillText(ch, gx * this.cellW, gy * this.cellH);
    }

    if (this.phase === 'program_starting') {
      const lockedFrac =
        this.slots.length > 0 ? lockedCount / this.slots.length : 0;
      this.sound.binaryCoalesceGrain(rawT, lockedFrac);
    }

    if (this.phase === 'binary_interface') {
      this.drawAssembledMenuItems();
    }
  }

  private drawInitialDevNotice(alpha: number, binaryCorruption: number): void {
    const msg = 'Este programa ainda está em desenvolvimento.';
    const startCol = Math.floor((this.gridCols - msg.length) * 0.5);
    const row = Math.floor(this.gridRows * 0.5);

    this.ctx.fillStyle = `rgba(229, 229, 229, ${alpha.toFixed(2)})`;
    for (let i = 0; i < msg.length; i++) {
      let ch = msg[i];
      if (ch !== ' ' && Math.random() < binaryCorruption) {
        ch = Math.random() < 0.5 ? '0' : '1';
      }
      this.ctx.fillText(ch, (startCol + i) * this.cellW, row * this.cellH);
    }
  }

  private drawAssembledMenuItems(): void {
    const items = ['INICIAR', 'SAIR'];
    const baseRow = this.boxTop + 8;
    this.menuHitboxes = [];

    for (let idx = 0; idx < items.length; idx++) {
      const selected = idx === this.menuIndex;
      const label = selected ? `> ${items[idx]} <` : `  ${items[idx]}  `;
      const col = Math.floor((this.gridCols - label.length) * 0.5);
      const row = baseRow + idx * 2;

      const px = col * this.cellW - 6;
      const py = row * this.cellH - 1;
      const pw = label.length * this.cellW + 12;
      const ph = this.cellH;

      this.menuHitboxes.push({ index: idx, x: px, y: py, w: pw, h: ph });

      if (selected) {
        this.ctx.fillStyle = '#e5e5e5';
        this.ctx.fillRect(px, py, pw, ph);
        this.ctx.fillStyle = '#000000';
      } else {
        this.ctx.fillStyle = '#e5e5e5';
      }

      this.ctx.fillText(label, col * this.cellW, row * this.cellH);
    }
  }

  private handleCanvasClick(clientX: number, clientY: number): void {
    for (const box of this.menuHitboxes) {
      if (
        clientX >= box.x &&
        clientX <= box.x + box.w &&
        clientY >= box.y &&
        clientY <= box.y + box.h
      ) {
        this.menuIndex = box.index;
        this.executeMenuSelection();
        return;
      }
    }
  }

  private executeMenuSelection(): void {
    if (this.menuIndex === 0) {
      // Mantém o SoundEngine vivo para fazer o crossfade contínuo com o Labirinto DOOM!
      this.destroy(false);
      this.options.onLaunchImmediateGesture();
    } else {
      // SAIR retorna para a Área de Trabalho versão Terminal
      this.returnToDesktopFromBinary();
    }
  }

  destroy(disposeAudio = false): void {
    this.clearTimers();
    if (this.clockIntervalId) window.clearInterval(this.clockIntervalId);
    cancelAnimationFrame(this.rafId);
    window.removeEventListener('keydown', this.boundKeyCapture, true);
    window.removeEventListener('pointerdown', this.boundPointerUnlock);
    window.removeEventListener('mousemove', this.boundMouseMove);
    window.removeEventListener('mouseup', this.boundMouseUp);
    window.removeEventListener('resize', this.boundResize);
    if (disposeAudio) {
      this.sound.dispose();
    }
    this.rootEl.remove();
  }
}
