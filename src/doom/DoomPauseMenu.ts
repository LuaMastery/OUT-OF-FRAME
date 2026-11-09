import { SoundEngine } from '../engine/audio/SoundEngine';
import { unlockSystemKeyboardKeys } from '../engine/input/BrowserShortcutGuard';
import {
  CursorProximityFX,
  ProximityTargetRect,
} from '../terminal/CursorProximityFX';
import {
  DOOM_SETTINGS_DESCRIPTORS,
  DoomGameSettings,
  DoomSettingsStore,
  SETTINGS_CATEGORIES,
  SettingControlSpec,
  SettingsCategoryId,
} from './DoomSettings';

export type PauseSubView = 'main' | 'settings' | 'controls';
export type SettingsTabFilter = 'all' | SettingsCategoryId;

export interface DoomPauseMenuCallbacks {
  onPauseOpened: () => void;
  onResumeRequest: () => void;
  onToggleFullscreen: () => void;
  onRestartSessionRequest: () => void;
  onExitToDesktopRequest: () => void;
}

interface BoundSettingControlUpdater {
  category: SettingsCategoryId;
  rowEl: HTMLDivElement;
  sync: (settings: Readonly<DoomGameSettings>) => void;
}

export class DoomPauseMenu {
  private readonly triggerBtnEl: HTMLButtonElement;
  private readonly crosshairEl: HTMLDivElement;
  private readonly fpsBadgeEl: HTMLDivElement;
  private readonly overlayEl: HTMLDivElement;
  private readonly modeBadgeEl: HTMLSpanElement;
  private readonly mainViewEl: HTMLDivElement;
  private readonly settingsViewEl: HTMLDivElement;
  private readonly controlsViewEl: HTMLDivElement;

  private readonly statModeEl: HTMLElement;
  private readonly statResEl: HTMLElement;
  private readonly statFovEl: HTMLElement;
  private readonly statVolEl: HTMLElement;

  private readonly restartBtnEl: HTMLButtonElement;
  private readonly restartHintEl: HTMLSpanElement;
  private readonly exitBtnEl: HTMLButtonElement;
  private readonly exitHintEl: HTMLSpanElement;

  private readonly tabButtons = new Map<SettingsTabFilter, HTMLButtonElement>();
  private readonly settingRows: BoundSettingControlUpdater[] = [];
  private readonly proximityFX: CursorProximityFX;
  private readonly unsubscribeSettings: () => void;

  private isOpen = false;
  private currentView: PauseSubView = 'main';
  private activeCategory: SettingsTabFilter = 'all';
  private hudSuppressed = false;
  private hoveredButtonId: string | null = null;

  private confirmRestartArmed = false;
  private confirmExitArmed = false;
  private confirmResetTimerId = 0;

  private fpsSmoothed = 60;
  private fpsRefreshAccum = 0;
  private currentRenderW = 444;
  private currentRenderH = 250;

  constructor(
    parentViewport: HTMLElement,
    private readonly settingsStore: DoomSettingsStore,
    private readonly sound: SoundEngine,
    private readonly callbacks: DoomPauseMenuCallbacks
  ) {
    // 1. Retículo central configurável
    this.crosshairEl = document.createElement('div');
    this.crosshairEl.id = 'doom-crosshair-hud';
    this.crosshairEl.dataset.style = settingsStore.value.showCrosshair;
    parentViewport.appendChild(this.crosshairEl);

    // 2. Telemetria opcional de FPS & Resolução
    this.fpsBadgeEl = document.createElement('div');
    this.fpsBadgeEl.id = 'doom-fps-badge';
    this.fpsBadgeEl.className = settingsStore.value.showFpsCounter
      ? ''
      : 'hidden';
    this.fpsBadgeEl.textContent = '60 FPS · 250p';
    parentViewport.appendChild(this.fpsBadgeEl);

    // 3. Botão visível de Pausa no topo central da tela (funciona em Desktop e Mobile!)
    this.triggerBtnEl = document.createElement('button');
    this.triggerBtnEl.id = 'doom-pause-trigger-btn';
    this.triggerBtnEl.type = 'button';
    this.triggerBtnEl.title = 'Pausar jogo e abrir configurações [Esc / P]';
    this.triggerBtnEl.innerHTML = `
      <span class="pause-trigger-icon" aria-hidden="true"><span></span><span></span></span>
      <span>PAUSA</span>
      <span class="pause-trigger-key">[ESC]</span>
    `;
    parentViewport.appendChild(this.triggerBtnEl);

    let lastTouchPauseMs = 0;
    this.triggerBtnEl.addEventListener(
      'touchstart',
      (e) => {
        e.stopPropagation();
      },
      { passive: true }
    );
    this.triggerBtnEl.addEventListener(
      'touchend',
      (e) => {
        e.stopPropagation();
        lastTouchPauseMs = performance.now();
        this.setOpen(true);
      },
      { passive: true }
    );
    this.triggerBtnEl.addEventListener('click', (e) => {
      e.stopPropagation();
      if (performance.now() - lastTouchPauseMs < 400) return;
      this.setOpen(true);
    });
    this.bindHoverSound(this.triggerBtnEl, 'hud-pause-trigger');

    // 4. Overlay Completo da Tela de Pausa + 26 Configurações + Guia de Controles
    this.overlayEl = document.createElement('div');
    this.overlayEl.id = 'doom-pause-overlay';
    this.overlayEl.innerHTML = `
      <div class="pause-shell" role="dialog" aria-modal="true" aria-label="Menu de Pausa">
        <header class="pause-header">
          <div class="pause-header-left">
            <span class="pause-title">PAUSA // OUT-OF-FRAME</span>
            <span class="pause-subtitle" data-pause-subtitle>Subnível de Contenção · Sistemas Táticos</span>
          </div>
          <span class="pause-mode-badge" data-pause-mode-badge>SOLO · SIMULAÇÃO CONGELADA</span>
        </header>

        <div class="pause-body">
          <!-- VIEW 1: MENU PRINCIPAL -->
          <section class="pause-view active" data-pause-view="main">
            <div class="pause-main-wrap">
              <div class="pause-menu-list">
                <button type="button" class="pause-menu-btn primary" data-pause-action="resume">
                  <span>▶ Continuar Jogo</span>
                  <span class="pause-btn-hint">[Esc / P]</span>
                </button>
                <button type="button" class="pause-menu-btn" data-pause-action="open-settings">
                  <span>⚙ Configurações</span>
                  <span class="pause-btn-hint">${DOOM_SETTINGS_DESCRIPTORS.length} opções</span>
                </button>
                <button type="button" class="pause-menu-btn" data-pause-action="open-controls">
                  <span>⌨ Controles & Atalhos</span>
                  <span class="pause-btn-hint">guia rápido</span>
                </button>
                <button type="button" class="pause-menu-btn" data-pause-action="fullscreen">
                  <span>⛶ Alternar Tela Cheia</span>
                  <span class="pause-btn-hint">janela / tela</span>
                </button>
                <button type="button" class="pause-menu-btn danger" data-pause-action="restart">
                  <span>↺ Reiniciar Incursão</span>
                  <span class="pause-btn-hint" data-restart-hint>novo mapa</span>
                </button>
                <button type="button" class="pause-menu-btn danger" data-pause-action="exit">
                  <span>⏻ Sair do Jogo</span>
                  <span class="pause-btn-hint" data-exit-hint>área de trabalho</span>
                </button>
              </div>

              <aside class="pause-side-brief">
                <div class="pause-brief-heading">Estado da Sessão</div>
                <div class="pause-brief-copy">
                  Ajuste vídeo, áudio binaural, sensibilidade de mira, comportamento de corrida/agachar e acessibilidade em tempo real. Todas as preferências ficam salvas automaticamente.
                </div>
                <div class="pause-quick-stats">
                  <div class="pause-stat-box">
                    <span class="pause-stat-k">Modo</span>
                    <span class="pause-stat-v" data-stat-mode>Solo</span>
                  </div>
                  <div class="pause-stat-box">
                    <span class="pause-stat-k">Framebuffer</span>
                    <span class="pause-stat-v" data-stat-res>250p</span>
                  </div>
                  <div class="pause-stat-box">
                    <span class="pause-stat-k">Campo de Visão</span>
                    <span class="pause-stat-v" data-stat-fov>74°</span>
                  </div>
                  <div class="pause-stat-box">
                    <span class="pause-stat-k">Volume Geral</span>
                    <span class="pause-stat-v" data-stat-vol>82%</span>
                  </div>
                </div>
              </aside>
            </div>
          </section>

          <!-- VIEW 2: CONFIGURAÇÕES (26 OPÇÕES REAIS) -->
          <section class="pause-view" data-pause-view="settings">
            <div class="pause-subbar">
              <div class="pause-tabs" data-settings-tabs></div>
            </div>
            <div class="pause-settings-list" data-settings-list></div>
            <footer class="pause-footer">
              <span class="pause-footer-note">${DOOM_SETTINGS_DESCRIPTORS.length} opções ativas · alterações aplicadas instantaneamente</span>
              <div class="pause-footer-actions">
                <button type="button" class="pause-small-btn" data-settings-reset>Restaurar Padrões</button>
                <button type="button" class="pause-small-btn" data-settings-back>← Voltar ao Menu</button>
              </div>
            </footer>
          </section>

          <!-- VIEW 3: CONTROLES & ATALHOS -->
          <section class="pause-view" data-pause-view="controls">
            <div class="pause-controls-grid">
              <div class="pause-ctrl-card">
                <div class="pause-ctrl-title">Movimentação & Furtividade</div>
                <div class="pause-ctrl-line"><span>Mover-se</span><span class="pause-ctrl-key">W A S D</span></div>
                <div class="pause-ctrl-line"><span>Correr (gasta fôlego)</span><span class="pause-ctrl-key">Shift</span></div>
                <div class="pause-ctrl-line"><span>Agachar silencioso</span><span class="pause-ctrl-key">Ctrl / C</span></div>
                <div class="pause-ctrl-line"><span>Deslizar (Slide em corrida)</span><span class="pause-ctrl-key">Shift + Ctrl</span></div>
                <div class="pause-ctrl-line"><span>Interagir / Debater na teia</span><span class="pause-ctrl-key">E</span></div>
              </div>

              <div class="pause-ctrl-card">
                <div class="pause-ctrl-title">Equipamentos & Atalhos</div>
                <div class="pause-ctrl-line"><span>Abrir Bolsos / Inventário</span><span class="pause-ctrl-key">Tab</span></div>
                <div class="pause-ctrl-line"><span>Selecionar atalho rápido</span><span class="pause-ctrl-key">Rolinha do Mouse</span></div>
                <div class="pause-ctrl-line"><span>Usar atalho destacado</span><span class="pause-ctrl-key">Botão Esq. / Q</span></div>
                <div class="pause-ctrl-line"><span>Atalhos diretos</span><span class="pause-ctrl-key">1 · 2 · 3</span></div>
                <div class="pause-ctrl-line"><span>Lanterna / Radar / Zoom</span><span class="pause-ctrl-key">F · M · N</span></div>
              </div>

              <div class="pause-ctrl-card">
                <div class="pause-ctrl-title">Cooperativo & Voz 3D</div>
                <div class="pause-ctrl-line"><span>Falar no Rádio/Proximidade</span><span class="pause-ctrl-key">Segurar B</span></div>
                <div class="pause-ctrl-line"><span>Alternar Modo do Microfone</span><span class="pause-ctrl-key">Z</span></div>
                <div class="pause-ctrl-line"><span>Chat de Texto por Rádio</span><span class="pause-ctrl-key">T</span></div>
                <div class="pause-ctrl-line"><span>Sinalizador Tático 3D (Ping)</span><span class="pause-ctrl-key">V</span></div>
              </div>

              <div class="pause-ctrl-card">
                <div class="pause-ctrl-title">Sistema & Sobrevivência</div>
                <div class="pause-ctrl-line"><span>Pausar / Menu Principal</span><span class="pause-ctrl-key">Esc / P</span></div>
                <div class="pause-ctrl-line"><span>Voz alta atrai a criatura</span><span class="pause-ctrl-key">Sussurre perto!</span></div>
                <div class="pause-ctrl-line"><span>Cortar teia instantâneo</span><span class="pause-ctrl-key">Canivete</span></div>
                <div class="pause-ctrl-line"><span>Espantar aranha / Resgatar</span><span class="pause-ctrl-key">Magnésio</span></div>
              </div>
            </div>
            <footer class="pause-footer">
              <span class="pause-footer-note">Dica: gire a rolinha do mouse e clique com o botão esquerdo para acionar itens sem soltar o WASD.</span>
              <div class="pause-footer-actions">
                <button type="button" class="pause-small-btn" data-controls-back>← Voltar ao Menu</button>
              </div>
            </footer>
          </section>
        </div>
      </div>
    `;
    parentViewport.appendChild(this.overlayEl);

    this.modeBadgeEl = this.overlayEl.querySelector(
      '[data-pause-mode-badge]'
    ) as HTMLSpanElement;
    this.mainViewEl = this.overlayEl.querySelector(
      '[data-pause-view="main"]'
    ) as HTMLDivElement;
    this.settingsViewEl = this.overlayEl.querySelector(
      '[data-pause-view="settings"]'
    ) as HTMLDivElement;
    this.controlsViewEl = this.overlayEl.querySelector(
      '[data-pause-view="controls"]'
    ) as HTMLDivElement;

    this.statModeEl = this.overlayEl.querySelector(
      '[data-stat-mode]'
    ) as HTMLElement;
    this.statResEl = this.overlayEl.querySelector(
      '[data-stat-res]'
    ) as HTMLElement;
    this.statFovEl = this.overlayEl.querySelector(
      '[data-stat-fov]'
    ) as HTMLElement;
    this.statVolEl = this.overlayEl.querySelector(
      '[data-stat-vol]'
    ) as HTMLElement;

    this.restartBtnEl = this.overlayEl.querySelector(
      '[data-pause-action="restart"]'
    ) as HTMLButtonElement;
    this.restartHintEl = this.overlayEl.querySelector(
      '[data-restart-hint]'
    ) as HTMLSpanElement;
    this.exitBtnEl = this.overlayEl.querySelector(
      '[data-pause-action="exit"]'
    ) as HTMLButtonElement;
    this.exitHintEl = this.overlayEl.querySelector(
      '[data-exit-hint]'
    ) as HTMLSpanElement;

    this.buildSettingsTabsAndRows();
    this.bindMainButtons();

    this.proximityFX = new CursorProximityFX(
      parentViewport,
      () => this.isOpen,
      () => this.collectInteractiveRects()
    );

    this.unsubscribeSettings = this.settingsStore.subscribe((s) => {
      this.applyAllSettingsToUi(s);
    });
    this.applyAllSettingsToUi(this.settingsStore.value);
  }

  get open(): boolean {
    return this.isOpen;
  }

  get subView(): PauseSubView {
    return this.currentView;
  }

  setMultiplayerMode(isCoop: boolean): void {
    if (isCoop) {
      this.modeBadgeEl.textContent = 'CO-OP ONLINE · TEMPO REAL';
      this.modeBadgeEl.classList.add('coop');
      this.statModeEl.textContent = 'Co-op Online';
    } else {
      this.modeBadgeEl.textContent = 'SOLO · SIMULAÇÃO CONGELADA';
      this.modeBadgeEl.classList.remove('coop');
      this.statModeEl.textContent = 'Solo';
    }
  }

  setHudSuppressed(suppressed: boolean): void {
    if (this.hudSuppressed === suppressed) return;
    this.hudSuppressed = suppressed;
    this.syncAuxHudVisibility();
  }

  updateTelemetry(dtRealSec: number, renderW: number, renderH: number): void {
    this.currentRenderW = renderW;
    this.currentRenderH = renderH;
    if (dtRealSec > 0.0005 && dtRealSec < 0.5) {
      const instFps = 1 / dtRealSec;
      this.fpsSmoothed = this.fpsSmoothed * 0.9 + instFps * 0.1;
    }
    if (!this.settingsStore.value.showFpsCounter) return;
    this.fpsRefreshAccum += dtRealSec;
    if (this.fpsRefreshAccum >= 0.35) {
      this.fpsRefreshAccum = 0;
      this.fpsBadgeEl.textContent = `${Math.round(this.fpsSmoothed)} FPS · ${this.currentRenderW}×${this.currentRenderH}`;
    }
  }

  handleEscapeOrBack(): void {
    if (!this.isOpen) {
      this.setOpen(true);
      return;
    }
    if (this.currentView !== 'main') {
      this.switchView('main');
      this.sound.playInventorySelect(true);
      return;
    }
    this.callbacks.onResumeRequest();
  }

  setOpen(next: boolean, initialView: PauseSubView = 'main'): void {
    if (this.isOpen === next) {
      if (next && this.currentView !== initialView) {
        this.switchView(initialView);
      }
      return;
    }

    this.isOpen = next;
    this.hoveredButtonId = null;
    this.disarmConfirmations();

    if (next) {
      this.switchView(initialView);
      this.overlayEl.classList.add('open');
      unlockSystemKeyboardKeys();
      try {
        if (document.pointerLockElement) {
          document.exitPointerLock?.();
        }
      } catch {
        // Ignorar
      }
      this.callbacks.onPauseOpened();
    } else {
      this.overlayEl.classList.remove('open');
      this.switchView('main');
    }

    this.syncAuxHudVisibility();
    this.sound.playInventoryToggle(next);
  }

  private syncAuxHudVisibility(): void {
    const hideAux = this.isOpen || this.hudSuppressed;
    this.triggerBtnEl.classList.toggle('hidden-by-ui', hideAux);
    this.crosshairEl.classList.toggle('hidden-by-ui', hideAux);
  }

  private switchView(view: PauseSubView): void {
    this.currentView = view;
    this.disarmConfirmations();
    this.mainViewEl.classList.toggle('active', view === 'main');
    this.settingsViewEl.classList.toggle('active', view === 'settings');
    this.controlsViewEl.classList.toggle('active', view === 'controls');
  }

  private bindHoverSound(el: HTMLElement, id: string): void {
    el.addEventListener('mouseenter', () => {
      if (this.hoveredButtonId === id) return;
      this.hoveredButtonId = id;
      this.sound.playInventorySelect(false);
    });
    el.addEventListener('mouseleave', () => {
      if (this.hoveredButtonId === id) {
        this.hoveredButtonId = null;
      }
    });
  }

  private disarmConfirmations(): void {
    if (this.confirmResetTimerId) {
      window.clearTimeout(this.confirmResetTimerId);
      this.confirmResetTimerId = 0;
    }
    this.confirmRestartArmed = false;
    this.confirmExitArmed = false;
    this.restartBtnEl.classList.remove('confirm-armed');
    this.exitBtnEl.classList.remove('confirm-armed');
    this.restartHintEl.textContent = 'novo mapa';
    this.exitHintEl.textContent = 'área de trabalho';
  }

  private scheduleConfirmTimeout(): void {
    if (this.confirmResetTimerId) {
      window.clearTimeout(this.confirmResetTimerId);
    }
    this.confirmResetTimerId = window.setTimeout(() => {
      this.disarmConfirmations();
    }, 3500);
  }

  private bindMainButtons(): void {
    this.overlayEl.addEventListener('mousedown', (e) => {
      e.stopPropagation();
    });

    const resumeBtn = this.overlayEl.querySelector(
      '[data-pause-action="resume"]'
    ) as HTMLButtonElement;
    this.bindHoverSound(resumeBtn, 'pause-resume');
    resumeBtn.addEventListener('click', () => {
      this.sound.playInventorySelect(true);
      this.callbacks.onResumeRequest();
    });

    const openSettingsBtn = this.overlayEl.querySelector(
      '[data-pause-action="open-settings"]'
    ) as HTMLButtonElement;
    this.bindHoverSound(openSettingsBtn, 'pause-settings');
    openSettingsBtn.addEventListener('click', () => {
      this.sound.playInventorySelect(true);
      this.switchView('settings');
    });

    const openControlsBtn = this.overlayEl.querySelector(
      '[data-pause-action="open-controls"]'
    ) as HTMLButtonElement;
    this.bindHoverSound(openControlsBtn, 'pause-controls');
    openControlsBtn.addEventListener('click', () => {
      this.sound.playInventorySelect(true);
      this.switchView('controls');
    });

    const fullscreenBtn = this.overlayEl.querySelector(
      '[data-pause-action="fullscreen"]'
    ) as HTMLButtonElement;
    this.bindHoverSound(fullscreenBtn, 'pause-fullscreen');
    fullscreenBtn.addEventListener('click', () => {
      this.sound.playInventorySelect(true);
      this.callbacks.onToggleFullscreen();
    });

    this.bindHoverSound(this.restartBtnEl, 'pause-restart');
    this.restartBtnEl.addEventListener('click', () => {
      if (!this.confirmRestartArmed) {
        this.disarmConfirmations();
        this.confirmRestartArmed = true;
        this.restartBtnEl.classList.add('confirm-armed');
        this.restartHintEl.textContent = 'CLIQUE P/ CONFIRMAR';
        this.sound.playInventorySelect(true);
        this.scheduleConfirmTimeout();
        return;
      }
      this.disarmConfirmations();
      this.sound.playInventorySelect(true);
      this.setOpen(false);
      this.callbacks.onRestartSessionRequest();
    });

    this.bindHoverSound(this.exitBtnEl, 'pause-exit');
    this.exitBtnEl.addEventListener('click', () => {
      if (!this.confirmExitArmed) {
        this.disarmConfirmations();
        this.confirmExitArmed = true;
        this.exitBtnEl.classList.add('confirm-armed');
        this.exitHintEl.textContent = 'CONFIRMAR SAÍDA?';
        this.sound.playInventorySelect(true);
        this.scheduleConfirmTimeout();
        return;
      }
      this.disarmConfirmations();
      this.sound.playInventorySelect(true);
      this.setOpen(false);
      this.callbacks.onExitToDesktopRequest();
    });

    const resetBtn = this.overlayEl.querySelector(
      '[data-settings-reset]'
    ) as HTMLButtonElement;
    this.bindHoverSound(resetBtn, 'settings-reset');
    resetBtn.addEventListener('click', () => {
      this.settingsStore.resetToDefaults();
      this.sound.playInventorySelect(true);
    });

    const backFromSettings = this.overlayEl.querySelector(
      '[data-settings-back]'
    ) as HTMLButtonElement;
    this.bindHoverSound(backFromSettings, 'settings-back');
    backFromSettings.addEventListener('click', () => {
      this.sound.playInventorySelect(true);
      this.switchView('main');
    });

    const backFromControls = this.overlayEl.querySelector(
      '[data-controls-back]'
    ) as HTMLButtonElement;
    this.bindHoverSound(backFromControls, 'controls-back');
    backFromControls.addEventListener('click', () => {
      this.sound.playInventorySelect(true);
      this.switchView('main');
    });
  }

  /**
   * Constrói UMA ÚNICA VEZ as abas e todas as 26 linhas de configuração com nós DOM persistentes!
   */
  private buildSettingsTabsAndRows(): void {
    const tabsRoot = this.overlayEl.querySelector(
      '[data-settings-tabs]'
    ) as HTMLDivElement;
    const listRoot = this.overlayEl.querySelector(
      '[data-settings-list]'
    ) as HTMLDivElement;

    const allTabs: Array<{ id: SettingsTabFilter; label: string }> = [
      { id: 'all', label: `Todas (${DOOM_SETTINGS_DESCRIPTORS.length})` },
      ...SETTINGS_CATEGORIES.map((c) => {
        const count = DOOM_SETTINGS_DESCRIPTORS.filter(
          (d) => d.category === c.id
        ).length;
        return { id: c.id, label: `${c.label} (${count})` };
      }),
    ];

    for (const tab of allTabs) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `pause-tab-btn${tab.id === this.activeCategory ? ' active' : ''}`;
      btn.dataset.settingsTab = tab.id;
      btn.textContent = tab.label;
      this.bindHoverSound(btn, `tab-${tab.id}`);
      btn.addEventListener('click', () => {
        this.setActiveCategory(tab.id);
        this.sound.playInventorySelect(true);
      });
      tabsRoot.appendChild(btn);
      this.tabButtons.set(tab.id, btn);
    }

    for (const spec of DOOM_SETTINGS_DESCRIPTORS) {
      const updater = this.createPersistentSettingRow(spec);
      listRoot.appendChild(updater.rowEl);
      this.settingRows.push(updater);
    }
  }

  private setActiveCategory(cat: SettingsTabFilter): void {
    this.activeCategory = cat;
    for (const [id, btn] of this.tabButtons.entries()) {
      btn.classList.toggle('active', id === cat);
    }
    for (const item of this.settingRows) {
      const visible = cat === 'all' || item.category === cat;
      item.rowEl.classList.toggle('hidden-cat', !visible);
    }
  }

  private createPersistentSettingRow(
    spec: SettingControlSpec
  ): BoundSettingControlUpdater {
    const rowEl = document.createElement('div');
    rowEl.className = 'setting-row';
    rowEl.dataset.settingKey = spec.key;

    const metaEl = document.createElement('div');
    metaEl.className = 'setting-meta';

    const labelEl = document.createElement('div');
    labelEl.className = 'setting-label';
    labelEl.textContent = spec.label;

    const descEl = document.createElement('div');
    descEl.className = 'setting-desc';
    descEl.textContent = spec.description;

    metaEl.appendChild(labelEl);
    metaEl.appendChild(descEl);

    const ctrlEl = document.createElement('div');
    ctrlEl.className = 'setting-control';

    rowEl.appendChild(metaEl);
    rowEl.appendChild(ctrlEl);

    if (spec.kind === 'range') {
      const wrap = document.createElement('div');
      wrap.className = 'setting-range-wrap';

      const input = document.createElement('input');
      input.type = 'range';
      input.className = 'setting-range-input';
      input.min = String(spec.min);
      input.max = String(spec.max);
      input.step = String(spec.step);

      const valBadge = document.createElement('span');
      valBadge.className = 'setting-range-val';

      input.addEventListener('input', () => {
        const num = Number(input.value);
        this.settingsStore.set(
          spec.key,
          num as DoomGameSettings[typeof spec.key]
        );
      });

      wrap.appendChild(input);
      wrap.appendChild(valBadge);
      ctrlEl.appendChild(wrap);

      return {
        category: spec.category,
        rowEl,
        sync: (s) => {
          const cur = Number(s[spec.key]);
          input.value = String(cur);
          valBadge.textContent = `${cur}${spec.unit}`;
        },
      };
    }

    if (spec.kind === 'toggle') {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'setting-toggle-btn';
      this.bindHoverSound(btn, `toggle-${spec.key}`);

      btn.addEventListener('click', () => {
        const next = !Boolean(this.settingsStore.value[spec.key]);
        this.settingsStore.set(
          spec.key,
          next as DoomGameSettings[typeof spec.key]
        );
        this.sound.playInventorySelect(true);
      });

      ctrlEl.appendChild(btn);

      return {
        category: spec.category,
        rowEl,
        sync: (s) => {
          const isOn = Boolean(s[spec.key]);
          btn.classList.toggle('is-on', isOn);
          btn.textContent = isOn
            ? `[ ${spec.onLabel ?? 'LIGADO'} ]`
            : `[ ${spec.offLabel ?? 'DESLIGADO'} ]`;
        },
      };
    }

    // spec.kind === 'choice'
    const group = document.createElement('div');
    group.className = 'setting-seg-group';
    const choiceBtns: Array<{
      value: DoomGameSettings[typeof spec.key];
      btn: HTMLButtonElement;
    }> = [];

    for (const ch of spec.choices) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'setting-seg-btn';
      btn.textContent = ch.label;
      this.bindHoverSound(btn, `choice-${spec.key}-${String(ch.value)}`);
      btn.addEventListener('click', () => {
        this.settingsStore.set(spec.key, ch.value);
        this.sound.playInventorySelect(true);
      });
      group.appendChild(btn);
      choiceBtns.push({ value: ch.value, btn });
    }

    ctrlEl.appendChild(group);

    return {
      category: spec.category,
      rowEl,
      sync: (s) => {
        const cur = s[spec.key];
        for (const item of choiceBtns) {
          item.btn.classList.toggle('is-selected', item.value === cur);
        }
      },
    };
  }

  private applyAllSettingsToUi(s: Readonly<DoomGameSettings>): void {
    this.crosshairEl.dataset.style = s.showCrosshair;
    this.fpsBadgeEl.classList.toggle('hidden', !s.showFpsCounter);
    if (s.showFpsCounter) {
      this.fpsBadgeEl.textContent = `${Math.round(this.fpsSmoothed)} FPS · ${this.currentRenderW}×${this.currentRenderH}`;
    }

    this.statResEl.textContent = s.resolutionHeight;
    this.statFovEl.textContent = `${s.fov}°`;
    this.statVolEl.textContent = `${s.masterVolume}%`;

    for (const row of this.settingRows) {
      row.sync(s);
    }
  }

  private collectInteractiveRects(): ProximityTargetRect[] {
    const rects: ProximityTargetRect[] = [];
    if (!this.isOpen) return rects;

    const selector =
      this.currentView === 'main'
        ? '.pause-menu-btn'
        : this.currentView === 'settings'
          ? '.pause-tab-btn, .setting-toggle-btn, .setting-seg-btn, .pause-small-btn'
          : '.pause-small-btn';

    const nodes = this.overlayEl.querySelectorAll(selector);
    nodes.forEach((node) => {
      const el = node as HTMLElement;
      const r = el.getBoundingClientRect();
      if (r.width > 2 && r.height > 2) {
        rects.push({ x: r.left, y: r.top, w: r.width, h: r.height });
      }
    });
    return rects;
  }

  destroy(): void {
    if (this.confirmResetTimerId) {
      window.clearTimeout(this.confirmResetTimerId);
    }
    this.unsubscribeSettings();
    this.proximityFX.destroy();
    this.triggerBtnEl.remove();
    this.crosshairEl.remove();
    this.fpsBadgeEl.remove();
    this.overlayEl.remove();
  }
}
