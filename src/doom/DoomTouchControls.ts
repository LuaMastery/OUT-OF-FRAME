import './touch.css';

export interface VirtualJoystickVector {
  /** Strafe lateral normalizado [-1 = esquerda, +1 = direita] */
  moveX: number;
  /** Avanço frontal normalizado [+1 = frente (arrastar p/ cima), -1 = ré (arrastar p/ baixo)] */
  moveY: number;
  /** Magnitude contínua [0..1] pós-deadzone para caminhada furtiva analógica */
  magnitude: number;
  /** Deslocamento visual do pino em pixels (limitado a maxRadius) */
  clampedDx: number;
  clampedDy: number;
}

/**
 * Calcula vetor analógico 360° suave com zona morta radial reescalonada.
 * Permite caminhar devagar e silenciosamente (baixa magnitude) ou correr no talo.
 */
export function computeVirtualJoystickVector(
  dxPx: number,
  dyPx: number,
  maxRadiusPx = 44,
  deadzone = 0.12
): VirtualJoystickVector {
  const safeRadius = Math.max(12, maxRadiusPx);
  const rawDist = Math.hypot(dxPx, dyPx);
  if (rawDist < 1e-4) {
    return { moveX: 0, moveY: 0, magnitude: 0, clampedDx: 0, clampedDy: 0 };
  }

  const clampedDist = Math.min(safeRadius, rawDist);
  const dirX = dxPx / rawDist;
  const dirY = dyPx / rawDist;
  const clampedDx = dirX * clampedDist;
  const clampedDy = dirY * clampedDist;

  const norm = clampedDist / safeRadius;
  if (norm <= deadzone) {
    return {
      moveX: 0,
      moveY: 0,
      magnitude: 0,
      clampedDx,
      clampedDy,
    };
  }

  const rescaled = Math.min(1, (norm - deadzone) / Math.max(0.05, 1 - deadzone));
  return {
    moveX: dirX * rescaled,
    moveY: -dirY * rescaled,
    magnitude: rescaled,
    clampedDx,
    clampedDy,
  };
}

/**
 * Calcula o FOV vertical adaptativo da câmera 3D e do Viewmodel (lanterna/braços)
 * para manter um campo de visão horizontal natural em telas retrato de smartphones,
 * preservando exatamente o FOV original em monitores Desktop e celulares em paisagem!
 */
export function computeAdaptiveVerticalFov(
  aspect: number,
  baseDesktopVerticalFovDeg = 74,
  maxPortraitVerticalFovDeg = 98
): number {
  const safeAspect = Math.max(0.35, aspect);
  if (safeAspect >= 1.15) {
    return baseDesktopVerticalFovDeg;
  }
  // Preserva fração saudável do FOV horizontal conforme o aspect ratio estreita (< 1.15)
  const refAspect = 1.15;
  const baseRad = (baseDesktopVerticalFovDeg * Math.PI) / 180;
  const targetHorizTan = Math.tan(baseRad * 0.5) * refAspect;
  // Blend suave (expoente 0.72 evita distorção olho-de-peixe excessiva no topo/base)
  const effectiveAspect = Math.pow(safeAspect / refAspect, 0.72) * refAspect;
  const adaptedRad = 2 * Math.atan(targetHorizTan / Math.max(0.35, effectiveAspect));
  const adaptedDeg = (adaptedRad * 180) / Math.PI;
  return Math.max(
    baseDesktopVerticalFovDeg,
    Math.min(maxPortraitVerticalFovDeg, adaptedDeg)
  );
}

export function isTouchCapableEnvironment(): boolean {
  if (typeof window === 'undefined') return false;
  if ('ontouchstart' in window) return true;
  if (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0) {
    return true;
  }
  if (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(pointer: coarse)').matches
  ) {
    return true;
  }
  return false;
}

export type TouchInteractContext = 'NONE' | 'ITEM' | 'ALLY' | 'WEB';

export interface DoomTouchStateSync {
  overlayBlocked: boolean;
  inCaptureSequence: boolean;
  isSprinting: boolean;
  isCrouchedOrSliding: boolean;
  canTriggerSlide: boolean;
  interactContext: TouchInteractContext;
  inMultiplayer: boolean;
  isPushToTalkActive: boolean;
  /** Jogador está executando uma coreografia de dança (3ª pessoa) */
  isDancing?: boolean;
}

export interface DoomTouchCallbacks {
  onActivity: () => void;
  onCrouchOrSlidePress: () => void;
  onInteractPress: () => void;
  onPushToTalkHoldChange: (held: boolean) => void;
  onPingPress: () => void;
  onRadioChatPress: () => void;
  /** Abre o menu de danças / alterna a coreografia em cena */
  onDancePress: () => void;
}

/**
 * Controlador Multi-Touch independente para smartphones e tablets (Android & iOS):
 * - Analógico virtual esquerdo com rastreamento por `Touch.identifier`;
 * - Área livre de câmera 360° à direita/centro com suporte simultâneo a múltiplos dedos;
 * - Toque rápido na tela para interagir/coletar itens ou se debater na teia;
 * - Botões táticos de Correr (toque/trava ou segurar), Agachar/Slide e Usar/Debater;
 * - Barra tática Co-op (Push-to-Talk 3D, Ping e Rádio).
 */
export class DoomTouchControls {
  private readonly rootEl: HTMLDivElement;
  private readonly joyZoneEl: HTMLDivElement;
  private readonly joyKnobEl: HTMLDivElement;
  private readonly sprintBtnEl: HTMLButtonElement;
  private readonly crouchBtnEl: HTMLButtonElement;
  private readonly crouchLabelEl: HTMLSpanElement;
  private readonly useBtnEl: HTMLButtonElement;
  private readonly useIconEl: HTMLSpanElement;
  private readonly useLabelEl: HTMLSpanElement;
  private readonly danceBtnEl: HTMLButtonElement;
  private readonly danceLabelEl: HTMLSpanElement;
  private readonly coopBarEl: HTMLDivElement;
  private readonly pttBtnEl: HTMLButtonElement;

  private enabled = false;
  private joyTouchId: number | null = null;
  private joyCenterX = 0;
  private joyCenterY = 0;
  private joyMaxRadius = 42;
  private joyVec: VirtualJoystickVector = {
    moveX: 0,
    moveY: 0,
    magnitude: 0,
    clampedDx: 0,
    clampedDy: 0,
  };

  private lookTouchId: number | null = null;
  private lookLastX = 0;
  private lookLastY = 0;
  private lookStartX = 0;
  private lookStartY = 0;
  private lookStartMs = 0;
  private pendingYawDelta = 0;
  private pendingPitchDelta = 0;

  private sprintHeldByFinger = false;
  private sprintLatched = false;
  private pttTouchId: number | null = null;
  private lastInteractContext: TouchInteractContext = 'NONE';

  private readonly onViewportTouchStartBound: (e: TouchEvent) => void;
  private readonly onWindowTouchMoveBound: (e: TouchEvent) => void;
  private readonly onWindowTouchEndBound: (e: TouchEvent) => void;

  constructor(
    private readonly viewportEl: HTMLElement,
    private readonly callbacks: DoomTouchCallbacks
  ) {
    this.rootEl = document.createElement('div');
    this.rootEl.className = 'oof-touch-root hidden';
    this.rootEl.innerHTML = `
      <div class="oof-touch-joy-zone" data-touch-joy>
        <div class="oof-touch-joy-crosshair"></div>
        <div class="oof-touch-joy-knob" data-touch-knob>+</div>
      </div>

      <div class="oof-touch-coop-bar hidden" data-touch-coop-bar>
        <div class="oof-touch-coop-row">
          <button type="button" class="oof-touch-coop-btn" data-touch-ping>[📍 PING]</button>
          <button type="button" class="oof-touch-coop-btn" data-touch-chat>[💬 RÁDIO]</button>
        </div>
        <button type="button" class="oof-touch-coop-btn" data-touch-ptt>[🎙 SEGURE P/ FALAR]</button>
      </div>

      <div class="oof-touch-actions">
        <button type="button" class="oof-touch-btn" data-area="sprint" data-touch-sprint>
          <span class="oof-touch-btn-icon">»</span>
          <span class="oof-touch-btn-label">CORRER</span>
        </button>
        <button type="button" class="oof-touch-btn" data-area="use" data-touch-use>
          <span class="oof-touch-btn-icon" data-touch-use-icon>◈</span>
          <span class="oof-touch-btn-label" data-touch-use-label>USAR</span>
        </button>
        <button type="button" class="oof-touch-btn" data-area="crouch" data-touch-crouch>
          <span class="oof-touch-btn-icon">⌄</span>
          <span class="oof-touch-btn-label" data-touch-crouch-label>AGACHAR</span>
        </button>
        <button type="button" class="oof-touch-btn" data-area="dance" data-touch-dance>
          <span class="oof-touch-btn-icon">🎭</span>
          <span class="oof-touch-btn-label" data-touch-dance-label>DANÇAR</span>
        </button>
      </div>
    `;
    this.viewportEl.appendChild(this.rootEl);

    this.joyZoneEl = this.rootEl.querySelector('[data-touch-joy]') as HTMLDivElement;
    this.joyKnobEl = this.rootEl.querySelector('[data-touch-knob]') as HTMLDivElement;
    this.sprintBtnEl = this.rootEl.querySelector('[data-touch-sprint]') as HTMLButtonElement;
    this.crouchBtnEl = this.rootEl.querySelector('[data-touch-crouch]') as HTMLButtonElement;
    this.crouchLabelEl = this.rootEl.querySelector('[data-touch-crouch-label]') as HTMLSpanElement;
    this.useBtnEl = this.rootEl.querySelector('[data-touch-use]') as HTMLButtonElement;
    this.useIconEl = this.rootEl.querySelector('[data-touch-use-icon]') as HTMLSpanElement;
    this.useLabelEl = this.rootEl.querySelector('[data-touch-use-label]') as HTMLSpanElement;
    this.danceBtnEl = this.rootEl.querySelector('[data-touch-dance]') as HTMLButtonElement;
    this.danceLabelEl = this.rootEl.querySelector(
      '[data-touch-dance-label]'
    ) as HTMLSpanElement;
    this.coopBarEl = this.rootEl.querySelector('[data-touch-coop-bar]') as HTMLDivElement;
    this.pttBtnEl = this.rootEl.querySelector('[data-touch-ptt]') as HTMLButtonElement;

    if (isTouchCapableEnvironment()) {
      this.enableTouchUi();
    }

    this.bindButtonControls();

    this.onViewportTouchStartBound = (e: TouchEvent) => this.handleViewportTouchStart(e);
    this.onWindowTouchMoveBound = (e: TouchEvent) => this.handleWindowTouchMove(e);
    this.onWindowTouchEndBound = (e: TouchEvent) => this.handleWindowTouchEnd(e);

    this.viewportEl.addEventListener('touchstart', this.onViewportTouchStartBound, {
      passive: false,
    });
    window.addEventListener('touchmove', this.onWindowTouchMoveBound, {
      passive: false,
    });
    window.addEventListener('touchend', this.onWindowTouchEndBound, {
      passive: true,
    });
    window.addEventListener('touchcancel', this.onWindowTouchEndBound, {
      passive: true,
    });
  }

  get isActive(): boolean {
    return this.enabled;
  }

  /**
   * Vetor analógico atual [-1..1] do joystick esquerdo.
   */
  getMoveVector(): { moveX: number; moveY: number; magnitude: number } {
    return {
      moveX: this.joyVec.moveX,
      moveY: this.joyVec.moveY,
      magnitude: this.joyVec.magnitude,
    };
  }

  /**
   * Verdadeiro quando o jogador ativou/segurou CORRER no mobile com o analógico empurrado.
   */
  get isSprintRequested(): boolean {
    if (this.sprintHeldByFinger) return true;
    if (this.sprintLatched && this.joyVec.magnitude > 0.35) return true;
    return false;
  }

  private lookSensitivityScale = 1.0;

  setLookSensitivityScale(scale: number): void {
    this.lookSensitivityScale = Math.max(0.25, Math.min(3.0, scale));
  }

  /**
   * Consome o delta acumulado de rotação de câmera pelo dedo de visão livre.
   */
  consumeLookDelta(): { yawDelta: number; pitchDelta: number } {
    const yawDelta = this.pendingYawDelta;
    const pitchDelta = this.pendingPitchDelta;
    this.pendingYawDelta = 0;
    this.pendingPitchDelta = 0;
    return { yawDelta, pitchDelta };
  }

  clearSprintLatch(): void {
    this.sprintLatched = false;
    this.sprintHeldByFinger = false;
  }

  resetTransientInputs(): void {
    this.joyTouchId = null;
    this.lookTouchId = null;
    this.sprintHeldByFinger = false;
    this.sprintLatched = false;
    this.pendingYawDelta = 0;
    this.pendingPitchDelta = 0;
    this.joyVec = {
      moveX: 0,
      moveY: 0,
      magnitude: 0,
      clampedDx: 0,
      clampedDy: 0,
    };
    this.joyZoneEl.classList.remove('active', 'sprinting');
    this.joyKnobEl.style.transform = 'translate3d(0px, 0px, 0)';
    if (this.pttTouchId !== null) {
      this.pttTouchId = null;
      this.pttBtnEl.classList.remove('talking');
      this.callbacks.onPushToTalkHoldChange(false);
    }
  }

  syncState(state: DoomTouchStateSync): void {
    if (!this.enabled) return;

    this.rootEl.classList.toggle('overlay-blocked', state.overlayBlocked);
    this.rootEl.classList.toggle('sequence-locked', state.inCaptureSequence);
    this.coopBarEl.classList.toggle('hidden', !state.inMultiplayer);

    const sprintVisual =
      state.isSprinting || this.sprintHeldByFinger || this.sprintLatched;
    this.sprintBtnEl.classList.toggle('toggled', sprintVisual);
    this.joyZoneEl.classList.toggle('sprinting', state.isSprinting);

    this.crouchBtnEl.classList.toggle('toggled', state.isCrouchedOrSliding);
    this.crouchLabelEl.textContent = state.canTriggerSlide ? 'SLIDE' : 'AGACHAR';

    const dancing = Boolean(state.isDancing);
    this.danceBtnEl.classList.toggle('dancing', dancing);
    this.danceLabelEl.textContent = dancing ? 'TROCAR' : 'DANÇAR';

    this.pttBtnEl.classList.toggle('talking', state.isPushToTalkActive);

    if (this.lastInteractContext !== state.interactContext) {
      this.lastInteractContext = state.interactContext;
      this.useBtnEl.classList.remove(
        'context-item',
        'context-ally',
        'context-web'
      );
      if (state.interactContext === 'WEB') {
        this.useBtnEl.classList.add('context-web');
        this.useIconEl.textContent = '🕸';
        this.useLabelEl.textContent = 'DEBATER!';
      } else if (state.interactContext === 'ALLY') {
        this.useBtnEl.classList.add('context-ally');
        this.useIconEl.textContent = '✚';
        this.useLabelEl.textContent = 'SALVAR!';
      } else if (state.interactContext === 'ITEM') {
        this.useBtnEl.classList.add('context-item');
        this.useIconEl.textContent = '◈';
        this.useLabelEl.textContent = 'PEGAR';
      } else {
        this.useIconEl.textContent = '◈';
        this.useLabelEl.textContent = 'USAR';
      }
    }
  }

  destroy(): void {
    this.resetTransientInputs();
    this.viewportEl.removeEventListener('touchstart', this.onViewportTouchStartBound);
    window.removeEventListener('touchmove', this.onWindowTouchMoveBound);
    window.removeEventListener('touchend', this.onWindowTouchEndBound);
    window.removeEventListener('touchcancel', this.onWindowTouchEndBound);
    this.rootEl.remove();
  }

  private enableTouchUi(): void {
    if (this.enabled) return;
    this.enabled = true;
    this.rootEl.classList.remove('hidden');
  }

  private bindButtonControls(): void {
    // Analógico esquerdo
    this.joyZoneEl.addEventListener(
      'touchstart',
      (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.enableTouchUi();
        this.callbacks.onActivity();
        if (this.joyTouchId !== null || e.changedTouches.length === 0) return;
        const t = e.changedTouches[0];
        this.joyTouchId = t.identifier;
        const rect = this.joyZoneEl.getBoundingClientRect();
        this.joyCenterX = rect.left + rect.width * 0.5;
        this.joyCenterY = rect.top + rect.height * 0.5;
        this.joyMaxRadius = Math.max(28, rect.width * 0.36);
        this.joyZoneEl.classList.add('active');
        this.updateJoystickFromPoint(t.clientX, t.clientY);
      },
      { passive: false }
    );

    // CORRER (toque alterna trava de corrida + segurar mantém corrida)
    this.sprintBtnEl.addEventListener(
      'touchstart',
      (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.enableTouchUi();
        this.callbacks.onActivity();
        this.sprintHeldByFinger = true;
        this.sprintLatched = !this.sprintLatched;
        this.sprintBtnEl.classList.add('pressed');
      },
      { passive: false }
    );
    const releaseSprintFinger = (e: TouchEvent) => {
      e.stopPropagation();
      this.sprintHeldByFinger = false;
      this.sprintBtnEl.classList.remove('pressed');
    };
    this.sprintBtnEl.addEventListener('touchend', releaseSprintFinger, {
      passive: true,
    });
    this.sprintBtnEl.addEventListener('touchcancel', releaseSprintFinger, {
      passive: true,
    });

    // AGACHAR / SLIDE TÁTICO
    this.crouchBtnEl.addEventListener(
      'touchstart',
      (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.enableTouchUi();
        this.callbacks.onActivity();
        this.crouchBtnEl.classList.add('pressed');
        this.callbacks.onCrouchOrSlidePress();
      },
      { passive: false }
    );
    const releaseCrouchBtn = () => this.crouchBtnEl.classList.remove('pressed');
    this.crouchBtnEl.addEventListener('touchend', releaseCrouchBtn, {
      passive: true,
    });
    this.crouchBtnEl.addEventListener('touchcancel', releaseCrouchBtn, {
      passive: true,
    });

    // USAR / PEGAR / DEBATER NA TEIA
    this.useBtnEl.addEventListener(
      'touchstart',
      (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.enableTouchUi();
        this.callbacks.onActivity();
        this.useBtnEl.classList.add('pressed');
        this.callbacks.onInteractPress();
      },
      { passive: false }
    );
    const releaseUseBtn = () => this.useBtnEl.classList.remove('pressed');
    this.useBtnEl.addEventListener('touchend', releaseUseBtn, {
      passive: true,
    });
    this.useBtnEl.addEventListener('touchcancel', releaseUseBtn, {
      passive: true,
    });

    // DANÇAR (abre o menu de coreografias / troca a dança em cena)
    this.danceBtnEl.addEventListener(
      'touchstart',
      (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.enableTouchUi();
        this.callbacks.onActivity();
        this.danceBtnEl.classList.add('pressed');
        this.callbacks.onDancePress();
      },
      { passive: false }
    );
    const releaseDanceBtn = () => this.danceBtnEl.classList.remove('pressed');
    this.danceBtnEl.addEventListener('touchend', releaseDanceBtn, {
      passive: true,
    });
    this.danceBtnEl.addEventListener('touchcancel', releaseDanceBtn, {
      passive: true,
    });

    // CO-OP: Push-to-Talk [🎙 SEGURE P/ FALAR] (multi-touch independente!)
    this.pttBtnEl.addEventListener(
      'touchstart',
      (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.enableTouchUi();
        this.callbacks.onActivity();
        if (this.pttTouchId === null && e.changedTouches.length > 0) {
          this.pttTouchId = e.changedTouches[0].identifier;
          this.pttBtnEl.classList.add('talking');
          this.callbacks.onPushToTalkHoldChange(true);
        }
      },
      { passive: false }
    );

    const pingBtn = this.rootEl.querySelector('[data-touch-ping]');
    pingBtn?.addEventListener(
      'touchstart',
      (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.callbacks.onActivity();
        this.callbacks.onPingPress();
      },
      { passive: false }
    );

    const chatBtn = this.rootEl.querySelector('[data-touch-chat]');
    let lastChatTouchMs = 0;
    chatBtn?.addEventListener(
      'touchstart',
      (e) => {
        // Não chama preventDefault() em touchstart para permitir abertura do teclado virtual mobile em touchend/click!
        e.stopPropagation();
      },
      { passive: true }
    );
    chatBtn?.addEventListener(
      'touchend',
      (e) => {
        e.stopPropagation();
        lastChatTouchMs = performance.now();
        this.callbacks.onActivity();
        this.callbacks.onRadioChatPress();
      },
      { passive: true }
    );
    chatBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (performance.now() - lastChatTouchMs < 400) return;
      this.callbacks.onActivity();
      this.callbacks.onRadioChatPress();
    });
  }

  private isUiInteractiveTarget(target: EventTarget | null): boolean {
    if (!(target instanceof Element)) return false;
    return Boolean(
      target.closest(
        '.oof-touch-joy-zone, .oof-touch-btn, .oof-touch-coop-btn, ' +
          '#doom-shortcuts-hub, #doom-inventory-overlay, .oof-coop-hud, ' +
          '.doom-radar-hud, #doom-capture-gameover, #doom-pause-trigger-btn, #doom-pause-overlay'
      )
    );
  }

  private handleViewportTouchStart(e: TouchEvent): void {
    this.enableTouchUi();
    this.callbacks.onActivity();

    if (
      this.rootEl.classList.contains('overlay-blocked') ||
      this.rootEl.classList.contains('sequence-locked')
    ) {
      return;
    }

    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      if (this.isUiInteractiveTarget(t.target)) continue;
      if (this.lookTouchId === null) {
        e.preventDefault();
        this.lookTouchId = t.identifier;
        this.lookLastX = t.clientX;
        this.lookLastY = t.clientY;
        this.lookStartX = t.clientX;
        this.lookStartY = t.clientY;
        this.lookStartMs = performance.now();
        break;
      }
    }
  }

  private handleWindowTouchMove(e: TouchEvent): void {
    if (!this.enabled) return;
    let handled = false;

    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      if (t.identifier === this.joyTouchId) {
        handled = true;
        this.updateJoystickFromPoint(t.clientX, t.clientY);
      } else if (t.identifier === this.lookTouchId) {
        handled = true;
        const dx = t.clientX - this.lookLastX;
        const dy = t.clientY - this.lookLastY;
        this.lookLastX = t.clientX;
        this.lookLastY = t.clientY;
        // Sensibilidade tátil calibrada para rotação 1ª pessoa rápida e precisa
        const sens = 0.0048 * this.lookSensitivityScale;
        this.pendingYawDelta -= dx * sens;
        this.pendingPitchDelta -= dy * sens * 0.88;
      }
    }

    if (handled && !this.rootEl.classList.contains('overlay-blocked')) {
      e.preventDefault();
    }
  }

  private handleWindowTouchEnd(e: TouchEvent): void {
    if (!this.enabled) return;

    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      if (t.identifier === this.joyTouchId) {
        this.joyTouchId = null;
        this.joyVec = {
          moveX: 0,
          moveY: 0,
          magnitude: 0,
          clampedDx: 0,
          clampedDy: 0,
        };
        if (!this.sprintHeldByFinger) {
          this.sprintLatched = false;
        }
        this.joyZoneEl.classList.remove('active', 'sprinting');
        this.joyKnobEl.style.transform = 'translate3d(0px, 0px, 0)';
      }

      if (t.identifier === this.lookTouchId) {
        const dtMs = performance.now() - this.lookStartMs;
        const travel = Math.hypot(
          t.clientX - this.lookStartX,
          t.clientY - this.lookStartY
        );
        this.lookTouchId = null;
        // Toque curto na visão 3D interage/coleta item à frente ou ajuda a se debater na teia!
        if (dtMs < 240 && travel < 12) {
          this.callbacks.onInteractPress();
        }
      }

      if (t.identifier === this.pttTouchId) {
        this.pttTouchId = null;
        this.pttBtnEl.classList.remove('talking');
        this.callbacks.onPushToTalkHoldChange(false);
      }
    }
  }

  private updateJoystickFromPoint(clientX: number, clientY: number): void {
    const dx = clientX - this.joyCenterX;
    const dy = clientY - this.joyCenterY;
    this.joyVec = computeVirtualJoystickVector(dx, dy, this.joyMaxRadius, 0.12);
    this.joyKnobEl.style.transform = `translate3d(${this.joyVec.clampedDx.toFixed(1)}px, ${this.joyVec.clampedDy.toFixed(1)}px, 0)`;
    if (this.joyVec.magnitude < 0.15 && !this.sprintHeldByFinger) {
      this.sprintLatched = false;
    }
  }
}
