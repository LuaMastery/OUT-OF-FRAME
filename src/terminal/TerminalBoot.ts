import { SoundEngine } from '../engine/audio/SoundEngine';
import { MultiplayerMenuModal } from '../multiplayer/MultiplayerMenuModal';
import {
  ActiveRoomSession,
  normalizeRoomCode,
} from '../multiplayer/MultiplayerService';
import { CursorProximityFX } from './CursorProximityFX';
import { TitleGameBackdrop } from './TitleGameBackdrop';
import {
  createTitleParticleLayer,
  TITLE_PARTICLES_TOTAL_MS,
  TitleParticleLayer,
} from './TitleParticles';
import { playTitleTerminalIntro, TitleTerminalIntroHandle } from './TitleTerminalIntro';
import { TITLE_MENU_ITEMS, TITLE_MENU_MARKUP } from './titleMenuMarkup';

export { TITLE_MENU_ITEMS };

export type TerminalPhase =
  | 'idle'
  | 'booting'
  | 'desktop'
  | 'title_menu'
  | 'powered_off';

export interface TerminalBootOptions {
  sound: SoundEngine;
  /**
   * Acionado ao iniciar pela menu principal (Solo ou conectado a uma Sala Multiplayer),
   * abrindo o ambiente 3D sem modais extras.
   */
  onLaunchImmediateGesture: (multiplayerSession?: ActiveRoomSession) => void;
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
];

const START_MENU_ITEMS: Array<{ id: DesktopItemId; label: string }> = [
  {
    id: 'out_of_frame',
    label: 'out_of_frame.exe',
  },
  {
    id: 'desligar',
    label: 'desligar',
  },
];

interface OpenWindowState {
  id: 'terminal' | 'notas';
  title: string;
  el: HTMLElement;
  bodyEl: HTMLElement;
  z: number;
}

/**
 * Sistema de Terminal:
 * 1. Carregamento normal de inicialização do terminal.
 * 2. Área de trabalho versão terminal interativa (ícones ASCII, janelas em modo texto,
 *    barra de tarefas com menu e relógio, linha de comando).
 * 3. Ao abrir `out_of_frame.exe`: mostra diretamente o menu do jogo.
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
  private zoomLayerEl!: HTMLElement;
  private proximityFx: CursorProximityFX | null = null;
  private multiplayerModal: MultiplayerMenuModal | null = null;

  private hiddenInputEl!: HTMLInputElement;
  private typedSpanEl: HTMLElement | null = null;
  private promptRowEl: HTMLElement | null = null;
  private prevInputLen = 0;

  // Estado da Área de Trabalho em modo Terminal
  private selectedIconIndex = 0;
  private startMenuOpen = false;
  private windows = new Map<'terminal' | 'notas', OpenWindowState>();
  private openingWindows = new Set<'terminal' | 'notas'>();
  private transientTaskTab: string | null = null;
  private newlyOpenedTabId: string | null = null;
  private zoomTimers: number[] = [];
  private focusedWindowId: 'terminal' | 'notas' | null = null;
  private topZ = 10;
  private clockIntervalId = 0;

  // Arrasto de janelas na área de trabalho
  private draggingWin: {
    el: HTMLElement;
    offsetX: number;
    offsetY: number;
  } | null = null;

  private mainMenuEl!: HTMLElement;
  private mainMenuButtons: HTMLButtonElement[] = [];
  private titleBackdrop: TitleGameBackdrop | null = null;
  private titleBackdropStartFrame = 0;
  private openingProgram = false;
  private titleParticles: TitleParticleLayer | null = null;
  private titleIntro: TitleTerminalIntroHandle | null = null;
  private titleIntroTimer = 0;
  private timers: number[] = [];
  private menuIndex = 0;

  private boundKeyCapture!: (e: KeyboardEvent) => void;
  private boundPointerUnlock!: () => void;
  private boundMouseMove!: (e: PointerEvent) => void;
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
    this.hiddenInputEl.setAttribute('autocapitalize', 'none');
    this.hiddenInputEl.setAttribute('autocorrect', 'off');
    this.hiddenInputEl.setAttribute('enterkeyhint', 'send');

    this.mainMenuEl = document.createElement('main');
    this.mainMenuEl.className = 'oof-title-screen';
    this.mainMenuEl.setAttribute('aria-label', 'Menu principal de OUT-OF-FRAME');
    this.mainMenuEl.hidden = true;
    this.mainMenuEl.innerHTML = TITLE_MENU_MARKUP;
    this.mainMenuButtons = Array.from(this.mainMenuEl.querySelectorAll<HTMLButtonElement>('[data-title-index]'));
    this.mainMenuButtons.forEach((button, index) => {
      button.addEventListener('pointerenter', (event) => {
        if (this.phase !== 'title_menu' || this.multiplayerModal?.visible || event.pointerType === 'touch') return;
        this.finishTitleIntro();
        if (this.menuIndex !== index) {
          this.menuIndex = index;
          this.syncMainMenuSelection();
          this.sound.menuMove();
        }
      });
      button.addEventListener('focus', () => {
        if (this.phase !== 'title_menu' || this.multiplayerModal?.visible) return;
        this.finishTitleIntro();
        this.menuIndex = index;
        this.syncMainMenuSelection();
      });
      button.addEventListener('click', () => {
        if (this.phase !== 'title_menu' || this.multiplayerModal?.visible) return;
        this.sound.unlock();
        this.menuIndex = index;
        this.executeMenuSelection();
      });
    });

    this.zoomLayerEl = document.createElement('div');
    this.zoomLayerEl.id = 'tui-zoom-layer';

    this.rootEl.append(
      this.bootLayerEl,
      this.desktopEl,
      this.hiddenInputEl,
      this.mainMenuEl,
      this.zoomLayerEl
    );
    this.mountParent.appendChild(this.rootEl);

    this.renderDesktopIcons();
    this.renderStartMenu();

    this.proximityFx = new CursorProximityFX(
      this.rootEl,
      () => this.phase === 'desktop',
      () => []
    );

    this.multiplayerModal = new MultiplayerMenuModal(this.rootEl, {
      sound: this.sound,
      onJoinSuccess: (session) => {
        this.destroy(false);
        this.options.onLaunchImmediateGesture(session);
      },
      onClose: () => {
        if (this.phase === 'title_menu') this.mainMenuButtons[this.menuIndex]?.focus();
      },
    });
  }

  private renderDesktopIcons(): void {
    this.iconGridEl.innerHTML = '';
    DESKTOP_ITEMS.forEach((item, index) => {
      const iconEl = document.createElement('div');
      iconEl.className =
        index === this.selectedIconIndex ? 'tui-icon selected' : 'tui-icon';
      iconEl.dataset.index = String(index);
      iconEl.dataset.itemId = item.id;

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
    START_MENU_ITEMS.forEach((item, idx) => {
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

    // Clicar/tocar no fundo vazio da área de trabalho desfoca janelas e fecha o menu
    this.workspaceEl.addEventListener('pointerdown', (e) => {
      if (this.phase !== 'desktop') return;
      if (
        e.target === this.workspaceEl ||
        e.target === this.iconGridEl
      ) {
        this.closeStartMenu();
        this.focusWindow(null);
      }
    });

    // Movimento de arrasto de janelas TUI (mouse e toque!)
    this.boundMouseMove = (e: PointerEvent) => {
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
    window.addEventListener('pointermove', this.boundMouseMove);

    this.boundMouseUp = () => {
      this.draggingWin = null;
      document.body.classList.remove('tui-dragging-window');
    };
    window.addEventListener('pointerup', this.boundMouseUp);
    window.addEventListener('pointercancel', this.boundMouseUp);

    // Entrada de texto na janela "terminal" (incluindo teclado virtual de celulares)
    this.hiddenInputEl.addEventListener('input', () => {
      if (
        this.phase !== 'desktop' ||
        this.focusedWindowId !== 'terminal' ||
        !this.typedSpanEl
      ) {
        return;
      }
      const rawVal = this.hiddenInputEl.value;
      if (rawVal.includes('\n') || rawVal.includes('\r')) {
        const clean = rawVal.replace(/[\r\n]+/g, '');
        this.hiddenInputEl.value = clean;
        this.sound.keyEnter();
        this.submitTerminalWindowCommand(clean);
        return;
      }
      if (rawVal.length > this.prevInputLen) {
        const lastChar = rawVal[rawVal.length - 1];
        this.sound.keyType(lastChar === ' ');
      }
      this.prevInputLen = rawVal.length;
      this.typedSpanEl.textContent = rawVal;
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
      if (this.multiplayerModal?.visible) {
        return;
      }
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
          if (DESKTOP_ITEMS.length > 1) {
            this.selectedIconIndex =
              (this.selectedIconIndex + 1) % DESKTOP_ITEMS.length;
            this.syncIconSelection();
            this.sound.menuMove();
          }
        } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
          e.preventDefault();
          if (DESKTOP_ITEMS.length > 1) {
            this.selectedIconIndex =
              (this.selectedIconIndex - 1 + DESKTOP_ITEMS.length) %
              DESKTOP_ITEMS.length;
            this.syncIconSelection();
            this.sound.menuMove();
          }
        } else if (e.key === 'Enter') {
          e.preventDefault();
          this.closeStartMenu();
          this.sound.keyEnter();
          this.activateDesktopItem(DESKTOP_ITEMS[this.selectedIconIndex].id);
        }
      } else if (this.phase === 'title_menu') {
        const count = TITLE_MENU_ITEMS.length;
        // Qualquer tecla conclui a impressão do terminal antes de navegar.
        this.finishTitleIntro();
        if (e.key === 'ArrowUp' || e.code === 'KeyW') {
          e.preventDefault();
          this.menuIndex = (this.menuIndex - 1 + count) % count;
          this.syncMainMenuSelection(true);
          this.sound.menuMove();
        } else if (e.key === 'ArrowDown' || e.code === 'KeyS') {
          e.preventDefault();
          this.menuIndex = (this.menuIndex + 1) % count;
          this.syncMainMenuSelection(true);
          this.sound.menuMove();
        } else if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          this.executeMenuSelection();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          this.returnToDesktopFromTitle();
        }
      }
    };
    window.addEventListener('keydown', this.boundKeyCapture, true);

    this.boundResize = () => {
      if (this.phase === 'desktop') {
        const wsRect = this.workspaceEl.getBoundingClientRect();
        for (const [id, win] of this.windows.entries()) {
          const isCmd = id === 'terminal';
          const desiredW = Math.min(
            isCmd ? 480 : 400,
            Math.max(250, Math.floor(wsRect.width - 16))
          );
          const desiredH = Math.min(
            isCmd ? 290 : 210,
            Math.max(150, Math.floor(wsRect.height - 16))
          );
          win.el.style.width = `${desiredW}px`;
          win.el.style.height = `${desiredH}px`;
          const curLeft = parseFloat(win.el.style.left) || 8;
          const curTop = parseFloat(win.el.style.top) || 8;
          win.el.style.left = `${Math.max(4, Math.min(curLeft, Math.max(4, wsRect.width - desiredW - 4)))}px`;
          win.el.style.top = `${Math.max(4, Math.min(curTop, Math.max(4, wsRect.height - desiredH - 4)))}px`;
        }
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
   * Reabre imediatamente a Área de Trabalho versão Terminal (usado quando o processo
   * encerra por morte permanente do jogador).
   */
  startAtDesktop(): void {
    this.clearTimers();
    this.enterDesktopPhase();
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

  private getIconScreenRect(id: DesktopItemId): {
    x: number;
    y: number;
    w: number;
    h: number;
  } {
    const el = this.iconGridEl.querySelector(
      `[data-item-id="${id}"]`
    ) as HTMLElement | null;
    if (el) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        return { x: r.left, y: r.top, w: r.width, h: r.height };
      }
    }
    return { x: 36, y: 36, w: 120, h: 72 };
  }

  private clearZoomLayer(): void {
    for (const id of this.zoomTimers) {
      window.clearTimeout(id);
    }
    this.zoomTimers = [];
    if (this.zoomLayerEl) {
      this.zoomLayerEl.innerHTML = '';
    }
  }

  /**
   * Animação retrô em degraus (estilo ZoomRect DOS / Terminal):
   * desenha quadros discretos interpolados do retângulo inicial até o final,
   * deixando 1 quadro fantasma pontilhado atrás e avançando em passos nítidos.
   */
  private runSteppedFrameSequence(opts: {
    from: { x: number; y: number; w: number; h: number };
    to: { x: number; y: number; w: number; h: number };
    steps: number;
    stepMs: number;
    title: string;
    expanding: boolean;
    onComplete: () => void;
  }): void {
    const { from, to, steps, stepMs, title, expanding, onComplete } = opts;
    const snap = (v: number) => Math.round(v / 4) * 4;

    let prevBox: { x: number; y: number; w: number; h: number } | null = null;

    for (let k = 0; k < steps; k++) {
      const tid = window.setTimeout(() => {
        const u = (k + 1) / steps;
        const cur = {
          x: k === steps - 1 ? Math.round(to.x) : snap(from.x + (to.x - from.x) * u),
          y: k === steps - 1 ? Math.round(to.y) : snap(from.y + (to.y - from.y) * u),
          w: Math.max(
            24,
            k === steps - 1 ? Math.round(to.w) : snap(from.w + (to.w - from.w) * u)
          ),
          h: Math.max(
            18,
            k === steps - 1 ? Math.round(to.h) : snap(from.h + (to.h - from.h) * u)
          ),
        };

        this.zoomLayerEl.innerHTML = '';

        if (prevBox) {
          const trailEl = document.createElement('div');
          trailEl.className = 'tui-zoom-rect trail';
          trailEl.style.left = `${prevBox.x}px`;
          trailEl.style.top = `${prevBox.y}px`;
          trailEl.style.width = `${prevBox.w}px`;
          trailEl.style.height = `${prevBox.h}px`;
          this.zoomLayerEl.appendChild(trailEl);
        }

        const curEl = document.createElement('div');
        curEl.className = 'tui-zoom-rect current';
        curEl.style.left = `${cur.x}px`;
        curEl.style.top = `${cur.y}px`;
        curEl.style.width = `${cur.w}px`;
        curEl.style.height = `${cur.h}px`;

        if (cur.w >= 136 && cur.h >= 42) {
          const hdr = document.createElement('div');
          hdr.className = 'tui-zoom-rect-header';
          const leftSpan = document.createElement('span');
          leftSpan.textContent = `[ ${title} ]`;
          const rightSpan = document.createElement('span');
          rightSpan.textContent = '[X]';
          hdr.append(leftSpan, rightSpan);
          curEl.appendChild(hdr);
        }

        this.zoomLayerEl.appendChild(curEl);
        prevBox = cur;
        this.sound.windowFrameStep(k, steps, expanding);
      }, k * stepMs);

      this.zoomTimers.push(tid);
    }

    const doneId = window.setTimeout(() => {
      this.zoomLayerEl.innerHTML = '';
      onComplete();
    }, steps * stepMs);
    this.zoomTimers.push(doneId);
  }

  private openOrFocusWindow(id: 'terminal' | 'notas'): void {
    const existing = this.windows.get(id);
    if (existing) {
      this.focusWindow(id);
      return;
    }
    if (this.openingWindows.has(id)) return;
    this.openingWindows.add(id);

    const isCmd = id === 'terminal';
    const title = isCmd ? 'terminal' : 'notas.txt';
    const wsRect = this.workspaceEl.getBoundingClientRect();
    const winW = Math.min(
      isCmd ? 480 : 400,
      Math.max(250, Math.floor(wsRect.width - 16))
    );
    const winH = Math.min(
      isCmd ? 290 : 210,
      Math.max(160, Math.floor(wsRect.height - 18))
    );

    const isCompactMobile = wsRect.width < 640;
    const targetLeft = isCompactMobile
      ? Math.max(6, Math.floor((wsRect.width - winW) * 0.5))
      : Math.min(
          isCmd ? 220 : 260,
          Math.max(12, wsRect.width - winW - 12)
        );
    const targetTop = isCompactMobile
      ? Math.max(8, Math.min(isCmd ? 28 : 48, Math.floor(wsRect.height - winH - 8)))
      : Math.min(
          isCmd ? 48 : 96,
          Math.max(12, wsRect.height - winH - 12)
        );

    const fromRect = this.getIconScreenRect(id);
    const toRect = {
      x: wsRect.left + targetLeft,
      y: wsRect.top + targetTop,
      w: winW,
      h: winH,
    };

    this.runSteppedFrameSequence({
      from: fromRect,
      to: toRect,
      steps: 5,
      stepMs: 36,
      title,
      expanding: true,
      onComplete: () => {
        this.openingWindows.delete(id);
        if (this.phase !== 'desktop') return;

        this.sound.windowOpen();
        const winEl = document.createElement('div');
        winEl.className = 'tui-window opening';

        winEl.style.width = `${winW}px`;
        winEl.style.height = `${winH}px`;
        winEl.style.left = `${targetLeft}px`;
        winEl.style.top = `${targetTop}px`;

        window.setTimeout(() => {
          winEl.classList.remove('opening');
        }, 140);

        const titlebar = document.createElement('div');
        titlebar.className = 'tui-window-titlebar';

        const titleSpan = document.createElement('span');
        titleSpan.textContent = `[ ${title} ]`;

        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.className = 'tui-window-close';
        closeBtn.textContent = '[X]';
        closeBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
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

        if (isCmd) {
          // Barra tátil de comandos rápidos para facilitar no celular (sem remover a digitação livre!)
          const quickBar = document.createElement('div');
          quickBar.className = 'tui-cmd-quickbar';
          for (const cmd of ['ajuda', 'executar', 'notas', 'limpar']) {
            const chip = document.createElement('button');
            chip.type = 'button';
            chip.className = 'tui-cmd-chip';
            chip.textContent = `[${cmd}]`;
            chip.addEventListener('pointerdown', (e) => e.stopPropagation());
            chip.addEventListener('click', (e) => {
              e.stopPropagation();
              this.sound.unlock();
              this.sound.keyEnter();
              this.focusWindow('terminal');
              if (this.typedSpanEl) this.typedSpanEl.textContent = cmd;
              this.submitTerminalWindowCommand(cmd);
            });
            quickBar.appendChild(chip);
          }
          winEl.appendChild(quickBar);

          bodyEl.addEventListener('click', () => {
            this.focusWindow('terminal');
            try {
              this.hiddenInputEl.focus({ preventScroll: true });
            } catch {
              this.hiddenInputEl.focus();
            }
          });
        }

        this.workspaceEl.appendChild(winEl);

        winEl.addEventListener('pointerdown', (e) => {
          e.stopPropagation();
          this.closeStartMenu();
          this.focusWindow(id);
        });

        titlebar.addEventListener('pointerdown', (e) => {
          if (e.pointerType === 'mouse' && e.button !== 0) return;
          this.closeStartMenu();
          this.focusWindow(id);
          const rect = winEl.getBoundingClientRect();
          this.draggingWin = {
            el: winEl,
            offsetX: e.clientX - rect.left,
            offsetY: e.clientY - rect.top,
          };
          document.body.classList.add('tui-dragging-window');
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
            '- out_of_frame.exe';
        }

        this.newlyOpenedTabId = id;
        this.focusWindow(id);
        this.newlyOpenedTabId = null;
      },
    });
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

    const r = state.el.getBoundingClientRect();
    const fromRect = { x: r.left, y: r.top, w: r.width, h: r.height };
    const toRect = this.getIconScreenRect(id);

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

    this.runSteppedFrameSequence({
      from: fromRect,
      to: toRect,
      steps: 4,
      stepMs: 28,
      title: state.title,
      expanding: false,
      onComplete: () => {},
    });
  }

  private renderTaskbarWindows(): void {
    this.taskWindowsEl.innerHTML = '';
    for (const [id, state] of this.windows.entries()) {
      const btn = document.createElement('button');
      btn.type = 'button';
      const classes = ['tui-task-btn'];
      if (this.focusedWindowId === id && !this.transientTaskTab) {
        classes.push('active');
      }
      if (this.newlyOpenedTabId === id) {
        classes.push('tab-opening');
      }
      btn.className = classes.join(' ');
      btn.textContent = state.title;
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.closeStartMenu();
        this.sound.menuMove();
        this.focusWindow(id);
      });
      this.taskWindowsEl.appendChild(btn);
    }

    if (this.transientTaskTab) {
      const appBtn = document.createElement('button');
      appBtn.type = 'button';
      appBtn.className = 'tui-task-btn active tab-opening';
      appBtn.textContent = this.transientTaskTab;
      this.taskWindowsEl.appendChild(appBtn);
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
    this.clearZoomLayer();
    this.sound.stopBootBed(0.4);
    this.sound.stopTitlePad(0.4);
    this.sound.stopTerminalPowerBed(0.4);
    this.proximityFx?.destroy();
    this.proximityFx = null;
    this.openingProgram = false;
    this.transientTaskTab = null;
    this.phase = 'powered_off';
    this.closeStartMenu();
    this.hiddenInputEl.blur();
    if (this.clockIntervalId) window.clearInterval(this.clockIntervalId);

    this.desktopEl.classList.remove('active');
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
   * Abre o menu do jogo a partir do ícone da área de trabalho:
   * primeiro a aba do aplicativo abre em quadros retrô (degraus DOS), depois o
   * menu toma a tela com as partículas e a impressão do terminal.
   */
  private startProgramSequence(): void {
    if (this.openingProgram || this.phase !== 'desktop') return;
    this.openingProgram = true;
    this.closeStartMenu();
    this.hiddenInputEl.blur();

    const wsRect = this.workspaceEl.getBoundingClientRect();
    const midW = Math.min(520, Math.max(280, wsRect.width - 48));
    const midH = Math.min(280, Math.max(180, wsRect.height - 48));
    const midLocalLeft = Math.floor((wsRect.width - midW) * 0.5);
    const midLocalTop = Math.floor((wsRect.height - midH) * 0.5);
    const iconRect = this.getIconScreenRect('out_of_frame');
    const midScreenRect = {
      x: wsRect.left + midLocalLeft,
      y: wsRect.top + midLocalTop,
      w: midW,
      h: midH,
    };

    // Etapa 1: a janela/aba se abre do ícone em quadros discretos.
    this.runSteppedFrameSequence({
      from: iconRect,
      to: midScreenRect,
      steps: 6,
      stepMs: 92,
      title: 'out_of_frame.exe',
      expanding: true,
      onComplete: () => {
        if (this.phase !== 'desktop') {
          this.openingProgram = false;
          return;
        }

        this.sound.windowOpen();
        // Zumbido do terminal entra devagar enquanto a aba termina de abrir.
        this.sound.startTerminalPowerBed(0.5);
        this.transientTaskTab = 'out_of_frame.exe';
        this.renderTaskbarWindows();

        // A aba aparece já "aberta", com o corpo do terminal em degraus.
        const appWinEl = document.createElement('div');
        appWinEl.className = 'tui-window focused opening';
        appWinEl.style.width = `${midW}px`;
        appWinEl.style.height = `${midH}px`;
        appWinEl.style.left = `${midLocalLeft}px`;
        appWinEl.style.top = `${midLocalTop}px`;
        appWinEl.style.zIndex = String(++this.topZ);

        const titlebar = document.createElement('div');
        titlebar.className = 'tui-window-titlebar';
        const titleSpan = document.createElement('span');
        titleSpan.textContent = '[ out_of_frame.exe ]';
        const controlsSpan = document.createElement('span');
        controlsSpan.textContent = '[□] [X]';
        titlebar.append(titleSpan, controlsSpan);

        const body = document.createElement('div');
        body.className = 'tui-window-body';
        body.textContent = '> Executando out_of_frame.exe...';

        appWinEl.append(titlebar, body);
        this.workspaceEl.appendChild(appWinEl);

        // Etapa 2: a aba latcheia e o menu ocupa a tela inteira.
        const latchId = window.setTimeout(() => {
          appWinEl.remove();
          if (this.phase !== 'desktop') {
            this.openingProgram = false;
            this.transientTaskTab = null;
            this.renderTaskbarWindows();
            return;
          }
          this.runSteppedFrameSequence({
            from: midScreenRect,
            to: { x: 0, y: 0, w: window.innerWidth, h: window.innerHeight },
            steps: 7,
            stepMs: 78,
            title: 'out_of_frame.exe',
            expanding: true,
            onComplete: () => {
              this.openingProgram = false;
              this.transientTaskTab = null;
              this.renderTaskbarWindows();
              this.openTitleMenu();
            },
          });
        }, 420);

        this.zoomTimers.push(latchId);
      },
    });
  }

  /** Exibe o menu com a condensação de partículas e a impressão do terminal. */
  private openTitleMenu(): void {
    if (this.phase !== 'desktop') return;
    this.phase = 'title_menu';
    this.menuIndex = 0;
    try {
      const params = new URLSearchParams(window.location.search);
      if (normalizeRoomCode(params.get('room') || '').length >= 4) this.menuIndex = 1;
    } catch {
      // Uma URL inválida não impede abrir o menu.
    }
    this.mainMenuEl.hidden = false;

    // 1. As partículas se condensam e formam o fundo do jogo.
    this.sound.stopTerminalPowerBed(1.1);
    this.sound.startBootBed(0);
    this.playTitleParticles();

    // 2. Somente depois da condensação o terminal imprime o texto e as opções.
    window.clearTimeout(this.titleIntroTimer);
    this.titleIntroTimer = window.setTimeout(() => {
      this.titleIntroTimer = 0;
      if (this.phase !== 'title_menu') return;
      this.startTitleTerminalIntro();
    }, TITLE_PARTICLES_TOTAL_MS);
  }

  /** Reinicia o campo de partículas que forma o cenário do jogo. */
  private playTitleParticles(): void {
    this.titleParticles?.destroy();
    this.titleParticles = null;
    const container = this.mainMenuEl.querySelector<HTMLElement>('.oof-title-screen__particles');
    if (!container) return;
    container.innerHTML = '';
    try {
      this.titleParticles = createTitleParticleLayer(container, (progress) => {
        this.sound.updateBootBed(progress);
      });
    } catch (error) {
      // Sem canvas 2D o menu continua utilizável, sem imagem fabricada.
      console.warn('Não foi possível exibir as partículas do menu:', error);
    }
  }

  /** O terminal digita o título e, em seguida, cada opção do menu. */
  private startTitleTerminalIntro(): void {
    this.titleIntro?.destroy();
    // O sopro das partículas cede lugar ao pad lento da tela inicial.
    this.sound.stopBootBed(1.4);
    this.sound.startTitlePad(0.55);
    this.titleIntro = playTitleTerminalIntro(this.mainMenuEl, this.sound, {
      onComplete: () => {
        this.syncMainMenuSelection(true);
      },
    });
    this.syncMainMenuSelection(false);
    this.titleBackdropStartFrame = requestAnimationFrame(() => {
      this.titleBackdropStartFrame = 0;
      if (this.phase !== 'title_menu' || this.titleBackdrop) return;
      const container = this.mainMenuEl.querySelector<HTMLElement>('.oof-title-screen__background');
      if (!container) return;
      try {
        this.titleBackdrop = new TitleGameBackdrop(container);
        this.titleBackdrop.start();
      } catch (error) {
        // Sem WebGL o menu continua utilizável, sem imagem fabricada.
        console.warn('Não foi possível exibir o cenário do menu:', error);
      }
    });
  }

  /** Conclui imediatamente a abertura do menu (clique, tecla ou saída). */
  private finishTitleIntro(): void {
    if (this.titleIntroTimer) {
      window.clearTimeout(this.titleIntroTimer);
      this.titleIntroTimer = 0;
      this.startTitleTerminalIntro();
    }
    this.titleIntro?.skip();
  }

  private returnToDesktopFromTitle(): void {
    this.sound.stopCoalesceDrone();
    this.sound.stopBootBed(0.5);
    this.sound.stopTitlePad(0.6);
    this.sound.stopTerminalPowerBed(0.5);
    this.openingProgram = false;
    this.transientTaskTab = null;
    this.mainMenuEl.hidden = true;
    this.disposeTitleBackdrop();
    this.disposeTitleEffects();
    document.body.classList.remove('tui-dragging-window');
    this.phase = 'desktop';
    this.sound.keyBackspace();

    const fullRect = {
      x: 0,
      y: 0,
      w: window.innerWidth,
      h: window.innerHeight,
    };
    const iconRect = this.getIconScreenRect('out_of_frame');
    this.runSteppedFrameSequence({
      from: fullRect,
      to: iconRect,
      steps: 5,
      stepMs: 30,
      title: 'out_of_frame.exe',
      expanding: false,
      onComplete: () => {
        if (this.focusedWindowId === 'terminal') {
          window.setTimeout(() => this.hiddenInputEl.focus(), 0);
        }
      },
    });
  }

  private syncMainMenuSelection(focus = false): void {
    this.mainMenuButtons.forEach((button, index) => {
      const selected = index === this.menuIndex;
      button.classList.toggle('is-selected', selected);
    });
    if (focus) this.mainMenuButtons[this.menuIndex]?.focus({ preventScroll: true });
  }

  private executeMenuSelection(): void {
    this.finishTitleIntro();
    this.sound.stopTitlePad(0.8);
    this.sound.stopBootBed(0.4);
    if (this.menuIndex === 0) {
      // INICIAR (Modo Solo) — mantém o SoundEngine vivo para crossfade contínuo com o Labirinto DOOM!
      this.destroy(false);
      this.options.onLaunchImmediateGesture();
    } else if (this.menuIndex === 1) {
      // MULTIPLAYER — abre a Central de Salas, Servidores, Número da Sala e Senha!
      let urlRoom = '';
      try {
        const params = new URLSearchParams(window.location.search);
        urlRoom = normalizeRoomCode(params.get('room') || '');
      } catch {
        urlRoom = '';
      }
      this.sound.windowOpen();
      this.multiplayerModal?.open(urlRoom || undefined);
    } else {
      // SAIR retorna para a Área de Trabalho versão Terminal
      this.returnToDesktopFromTitle();
    }
  }

  private disposeTitleEffects(): void {
    this.sound.stopBootBed(0.4);
    this.sound.stopTitlePad(0.4);
    this.sound.stopTerminalPowerBed(0.4);
    if (this.titleIntroTimer) {
      window.clearTimeout(this.titleIntroTimer);
      this.titleIntroTimer = 0;
    }
    this.titleIntro?.destroy();
    this.titleIntro = null;
    this.titleParticles?.destroy();
    this.titleParticles = null;
    this.mainMenuEl.classList.remove('oof-title-screen--booting');
  }

  private disposeTitleBackdrop(): void {
    if (this.titleBackdropStartFrame) cancelAnimationFrame(this.titleBackdropStartFrame);
    this.titleBackdropStartFrame = 0;
    this.titleBackdrop?.destroy();
    this.titleBackdrop = null;
  }

  destroy(disposeAudio = false): void {
    this.openingProgram = false;
    this.disposeTitleEffects();
    this.disposeTitleBackdrop();
    this.clearTimers();
    this.clearZoomLayer();
    this.multiplayerModal?.destroy();
    this.multiplayerModal = null;
    this.proximityFx?.destroy();
    this.proximityFx = null;
    if (this.clockIntervalId) window.clearInterval(this.clockIntervalId);
    window.removeEventListener('keydown', this.boundKeyCapture, true);
    window.removeEventListener('pointerdown', this.boundPointerUnlock);
    window.removeEventListener('pointermove', this.boundMouseMove);
    window.removeEventListener('pointerup', this.boundMouseUp);
    window.removeEventListener('pointercancel', this.boundMouseUp);
    window.removeEventListener('resize', this.boundResize);
    if (disposeAudio) {
      this.sound.dispose();
    }
    this.rootEl.remove();
  }
}
