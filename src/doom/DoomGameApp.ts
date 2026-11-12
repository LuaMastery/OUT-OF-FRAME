import * as THREE from 'three';
import './shotgun.css';
import { formatShotgunObjective } from './DoomObjective';
import { SoundEngine } from '../engine/audio/SoundEngine';
import {
  acquireFullscreenAndKeyboardLock,
  installSessionTabGuard,
  lockSystemKeyboardKeys,
  shouldPreventBrowserShortcut,
  unlockSystemKeyboardKeys,
} from '../engine/input/BrowserShortcutGuard';
import {
  resolveCylinderWorldCollisions,
  StaticColliderBox,
} from '../engine/physics/SpatialSweep';
import {
  cycleSpectatorTargetId,
  DoomMultiplayerCoordinator,
  SpectatorTarget,
  TACTICAL_PING_DURATION_SECONDS,
} from '../multiplayer/DoomMultiplayerCoordinator';
import {
  ActiveRoomSession,
  isPlayerConsideredAfk,
} from '../multiplayer/MultiplayerService';
import {
  createRandomArenaLayout,
  createRandomArenaSeed,
  DoomArenaLayout,
  hashArenaSeed,
} from './DoomArenaRandomizer';
import { DoomAstronaut } from './DoomAstronaut';
import { DoomAmbientZoneTracker } from './DoomAmbientZones';
import {
  computeDoomDancePose,
  DoomDanceId,
  getDoomDanceBeatIndex,
  getDoomDanceDefinition,
  getNextDoomDanceId,
  isDoomDanceId,
} from './DoomDance';
import { DoomDanceMenu } from './DoomDanceMenu';
import { resolveSpiderCaptureOutcome } from './DoomDeathRules';
import { DoomFlashlight } from './DoomFlashlight';
import { DoomShotgunViewmodel, SHOTGUN_ITEM_ID, SHOTGUN_AMMO_ITEM_ID, shotgunImpactDistance, computeShotgunBlastDamage } from './DoomShotgun';
import { DoomInventory, ITEM_CATALOG } from './DoomInventory';
import { QUICK_ITEM_DURATIONS, QuickHandheldKind } from './DoomItemAction';
import {
  buildDoomLabyrinth,
  DoomLightSource,
  evaluateDoomLightFlicker,
  isStoneSectorWorld,
  syncLightPanelEmissionAttribute,
  worldToGridCell,
} from './DoomMazeBuilder';
import { DoomPauseMenu } from './DoomPauseMenu';
import { resolveBrowserControlRelease } from './DoomPauseInput';
import { getGameConsole, isGameConsoleOpen } from '../console/GameConsole';
import { DoomRadar } from './DoomRadar';
import {
  AstronautRagdoll,
  computeCollisionSafeRagdollCamera,
  computeWalkableDragPolyline,
  DragPolylinePath,
  sampleDragPolyline,
} from './DoomRagdoll';
import {
  DoomPerfGovernor,
  PERF_LIGHTS_MIN,
  PerfGovernorSnapshot,
  PerfLevers,
  snapFrameCapToVsync,
} from './DoomPerfGovernor';
import { DoomPerfHud } from './DoomPerfHud';
import {
  DoomAnnexLightSpec,
  DoomRoomId,
  DoomSpecialRoomDoorController,
  getThemedRoomAtCell,
  isWalkableArenaCell,
} from './DoomRooms';
import {
  DoomGameSettings,
  DoomSettingsStore,
  resolutionPresetToHeight,
  viewmodelShadowMapSize,
} from './DoomSettings';
import {
  createDoomSharedUniforms,
  DoomRetroCompositor,
  DoomSharedUniforms,
  MAX_DOOM_LIGHTS,
} from './DoomShader';
import {
  DoomSpider,
  SpiderCinematicMode,
} from './DoomSpider';
import { DoomSpiderWebManager } from './DoomSpiderWebs';
import { computeWebDanger, WebStruggleState } from './DoomWebStruggle';
import {
  boostPlayerStamina,
  canPlayerSlideWithStamina,
  canPlayerSprintWithStamina,
  createInitialStaminaState,
  STAMINA_EXHAUSTION_RECOVERY_THRESHOLD,
  stepPlayerStaminaState,
} from './DoomStamina';
import { createDoomTextures } from './DoomTextures';
import {
  computeAdaptiveVerticalFov,
  DoomTouchControls,
  isTouchCapableEnvironment,
  TouchInteractContext,
} from './DoomTouchControls';
import { DoomWorldItems } from './DoomWorldItems';
import { getOrCreateLocalPlayerProfile } from '../multiplayer/MultiplayerService';

type ActiveHorrorSequence =
  | 'NONE'
  | 'ABDUCTION_TO_WEB'
  | 'PERMADEATH_EXECUTION'
  | 'DEAD_TERMINATED';

export interface PlayerSlideRuntimeState {
  isSliding: boolean;
  slideTimer: number;
  slideCooldown: number;
  slideSpeed: number;
  slideDirX: number;
  slideDirZ: number;
  slideAmount: number;
  wasHoldingCtrl: boolean;
  wasSprinting: boolean;
}

export function createInitialSlideState(): PlayerSlideRuntimeState {
  return {
    isSliding: false,
    slideTimer: 0,
    slideCooldown: 0,
    slideSpeed: 0,
    slideDirX: 0,
    slideDirZ: -1,
    slideAmount: 0,
    wasHoldingCtrl: false,
    wasSprinting: false,
  };
}

export interface SlideStepInput {
  dt: number;
  holdingCtrl: boolean;
  holdingShift: boolean;
  wishX: number;
  wishZ: number;
  forwardX: number;
  forwardZ: number;
  velX: number;
  velZ: number;
  canStandUp: boolean;
  ensnared: boolean;
  injurySlow: number;
  webSpeedMultiplier: number;
  canSprint?: boolean;
  canSlide?: boolean;
}

export interface SlideStepResult {
  startedSlide: boolean;
  isSliding: boolean;
  isCrouching: boolean;
  sprinting: boolean;
  overrideVelocity: boolean;
  outVelX: number;
  outVelZ: number;
}

/**
 * Máquina de estados pura para Corrida + Segurar Ctrl => Deslizar no chão (`Slide`):
 * - Quando o jogador está correndo (`Shift` + movimento ou velocidade de sprint) e segura `Ctrl`,
 *   entra num deslize rápido rente ao chão com impulso inicial e desaceleração por atrito;
 * - Ao terminar o deslize mantendo `Ctrl` pressionado, transiciona suavemente para o agachamento furtivo!
 */
export function stepPlayerSlideState(
  state: PlayerSlideRuntimeState,
  input: SlideStepInput
): SlideStepResult {
  const {
    dt,
    holdingCtrl,
    holdingShift,
    wishX,
    wishZ,
    forwardX,
    forwardZ,
    velX,
    velZ,
    canStandUp,
    ensnared,
    injurySlow,
    webSpeedMultiplier,
    canSprint = true,
    canSlide = true,
  } = input;

  state.slideCooldown = Math.max(0, state.slideCooldown - dt);

  const wishLenSq = wishX * wishX + wishZ * wishZ;
  const planarSpeed = Math.hypot(velX, velZ);
  const justPressedCtrl = holdingCtrl && !state.wasHoldingCtrl;

  const runningNow =
    !ensnared &&
    ((holdingShift && canSprint && wishLenSq > 0.01) ||
      (state.wasSprinting && planarSpeed > 5.0) ||
      planarSpeed >= 6.8);

  let startedSlide = false;

  if (
    !state.isSliding &&
    canSlide &&
    justPressedCtrl &&
    runningNow &&
    state.slideCooldown <= 0
  ) {
    startedSlide = true;
    state.isSliding = true;
    state.slideTimer = 0;

    if (planarSpeed > 2.2) {
      state.slideDirX = velX / planarSpeed;
      state.slideDirZ = velZ / planarSpeed;
    } else if (wishLenSq > 0.01) {
      const wl = Math.sqrt(wishLenSq);
      state.slideDirX = wishX / wl;
      state.slideDirZ = wishZ / wl;
    } else {
      const fl = Math.hypot(forwardX, forwardZ) || 1;
      state.slideDirX = forwardX / fl;
      state.slideDirZ = forwardZ / fl;
    }

    state.slideSpeed =
      Math.max(planarSpeed * 1.18, 11.5 * injurySlow) * webSpeedMultiplier;
  }

  if (state.isSliding) {
    if (ensnared || (!holdingCtrl && canStandUp)) {
      state.isSliding = false;
      state.slideCooldown = 0.35;
    } else {
      state.slideTimer += dt;

      if (wishLenSq > 0.01) {
        const wl = Math.sqrt(wishLenSq);
        const steer = Math.min(1, 2.2 * dt);
        state.slideDirX += (wishX / wl - state.slideDirX) * steer;
        state.slideDirZ += (wishZ / wl - state.slideDirZ) * steer;
        const dl = Math.hypot(state.slideDirX, state.slideDirZ) || 1;
        state.slideDirX /= dl;
        state.slideDirZ /= dl;
      }

      const endFloorSpeed = 2.85 * injurySlow * webSpeedMultiplier;
      state.slideSpeed = Math.max(
        endFloorSpeed,
        state.slideSpeed - 10.2 * dt
      );

      const hitSolidObstacle =
        !startedSlide && state.slideTimer > 0.14 && planarSpeed < 1.9;
      if (
        state.slideTimer >= 0.82 ||
        state.slideSpeed <= endFloorSpeed + 0.05 ||
        hitSolidObstacle
      ) {
        state.isSliding = false;
        state.slideCooldown = 0.42;
      }
    }
  }

  const slideTarget = state.isSliding ? 1 : 0;
  const slideRate = state.isSliding ? 18.0 : 12.0;
  state.slideAmount +=
    (slideTarget - state.slideAmount) * (1 - Math.exp(-slideRate * dt));

  const isCrouching = state.isSliding || holdingCtrl;
  const sprinting =
    !isCrouching && !ensnared && canSprint && holdingShift && wishLenSq > 0.01;

  state.wasHoldingCtrl = holdingCtrl;
  state.wasSprinting = sprinting;

  if (state.isSliding) {
    return {
      startedSlide,
      isSliding: true,
      isCrouching: true,
      sprinting: false,
      overrideVelocity: true,
      outVelX: state.slideDirX * state.slideSpeed,
      outVelZ: state.slideDirZ * state.slideSpeed,
    };
  }

  return {
    startedSlide,
    isSliding: false,
    isCrouching,
    sprinting,
    overrideVelocity: false,
    outVelX: velX,
    outVelZ: velZ,
  };
}

/**
 * Aplicação 3D do Labirinto estilo DOOM Clássico integrada a:
 * - Lanterna 3D simples (Tecla F) + Agachamento furtivo (Segurar Ctrl)
 * - Inventário sombrio estilo Amnesia (Tecla Tab) + Objetos 3D coletáveis
 * - Aranha Gigante Procedural (Evil Crawling Thing) + Armadilhas de Teia + Ninho Principal
 * - Sequência visceral em 1ª pessoa de Ataque -> Desmaio -> Sendo Puxado até a Teia -> Acordar Ferido
 * - Morte Permanente Real (Permadeath) caso o jogador morra!
 */
export class DoomGameApp {
  private readonly viewportEl: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly compositor: DoomRetroCompositor;
  private readonly sharedUniforms: DoomSharedUniforms;
  private readonly astronaut: DoomAstronaut;
  private readonly flashlight: DoomFlashlight;
  private readonly shotgun: DoomShotgunViewmodel;
  private arenaLayout!: DoomArenaLayout;
  private shotgunNextShotMs = 0;
  private readonly inventory: DoomInventory;
  private readonly radar: DoomRadar;
  private readonly worldItems: DoomWorldItems;
  private readonly webManager: DoomSpiderWebManager;
  private readonly spider: DoomSpider;
  private readonly touchControls: DoomTouchControls;
  private readonly settingsStore: DoomSettingsStore;
  private readonly pauseMenu: DoomPauseMenu;
  private unsubscribeSettings: (() => void) | null = null;
  private multiplayer: DoomMultiplayerCoordinator | null = null;

  private colliders: StaticColliderBox[] = [];
  private lights: DoomLightSource[] = [];
  private annexLights: DoomAnnexLightSpec[] = [];
  private specialRoomDoors: DoomSpecialRoomDoorController;
  private walkieTalkieActive = false;
  private lightPanelEmissionAttr: THREE.BufferAttribute | null = null;
  private prevLightDimState: boolean[] = [];

  private readonly position = new THREE.Vector3();
  private ambientZoneTracker!: DoomAmbientZoneTracker;
  private readonly velocity = new THREE.Vector3();
  private yaw = 0;
  private pitch = 0;
  private roll = 0;
  private bobPhase = 0;
  private lastBobHalfCycle = 0;

  private readonly standingEyeHeight = 1.62;
  private readonly crouchEyeHeight = 0.88;
  private readonly slideEyeHeight = 0.64;
  private readonly playerRadius = 0.52;
  private readonly standingPlayerHeight = 1.8;
  private readonly crouchPlayerHeight = 1.05;
  private crouchAmount = 0;
  private wasCrouching = false;
  private touchCrouchLatched = false;
  private touchAutoUnlatchAfterSlide = false;
  private desktopCrouchLatched = false;
  private desktopAutoUnlatchAfterSlide = false;
  private desktopSprintLatched = false;
  private ignoreEscapeKeyUntilMs = 0;
  private suppressReleasePauseUntilMs = 0;
  private wasFullscreen = false;
  private currentBaseDesktopFov = 74;
  private readonly staminaState = createInitialStaminaState();
  private staminaChestHeaveY = 0;
  private staminaBreathPitch = 0;
  private readonly slideState = createInitialSlideState();
  private spiderHuntingLogged = false;

  // Sinais vitais
  private playerHealth = 100;
  private playerSanity = 100;
  private lanternBattery = 100;
  private playerBleeding = false;
  private cameraShake = 0;
  /** Luta do jogador local contra a teia (alimenta câmera, braços e seda). */
  private readonly webStruggle = new WebStruggleState();
  private webStruggleDanger = 0;

  // Estado da animação cinemática de Ataque / Ragdoll Desmaiado / Tentáculos Puxando / Teia / Morte Permanente
  private activeSequence: ActiveHorrorSequence = 'NONE';
  private seqTime = 0;
  private seqStagedWake = false;
  private seqGaspPlayed = false;
  private lastDragPullStep = -1;
  private lastWebSpinStep = -1;
  private readonly strikeOriginPos = new THREE.Vector3();
  private readonly strikeSpiderPos = new THREE.Vector3();
  private readonly localRagdoll = new AstronautRagdoll();
  private dragPath: DragPolylinePath | null = null;
  private readonly ragdollCamPosScratch = new THREE.Vector3();
  private readonly ragdollLookAtScratch = new THREE.Vector3();
  private readonly ragdollPathPosScratch = new THREE.Vector3();
  private readonly ragdollPathTanScratch = new THREE.Vector3();
  private cocoonDevourTimerSec = 0;
  private cocoonDevourMaxSec = 45;
  private cocoonReturnTriggered = false;
  private pendingAbductionLairNotify = false;
  /** Fim de partida: o esquadrão inteiro foi amarrado no Ninho. */
  private squadDevouredActive = false;
  private squadDevouredTime = 0;
  private squadDevouredFinalized = false;
  private currentAbductionMode: SpiderCinematicMode | null = null;
  private currentAbductionProgress = 0;
  private readonly currentAbductionSpiderPos = new THREE.Vector3();
  private permadeathTimerId = 0;

  private keys = new Set<string>();
  private interactQueued = false;
  private struggleQueued = false;
  private engaged = false;
  private pointerLocked = false;
  private isDragging = false;
  private lastMouseX = 0;
  private lastMouseY = 0;
  private lastWheelSelectMs = 0;
  private lastUserActivityMs = performance.now();
  private tabHiddenSinceMs: number | null = null;
  private localAfk = false;
  private readonly localAfkBannerEl: HTMLDivElement;
  private readonly roomBannerEl: HTMLDivElement;
  private readonly roomBannerTitleEl: HTMLDivElement;
  private readonly roomBannerSubEl: HTMLDivElement;
  private readonly doorLockPromptEl: HTMLDivElement;
  private readonly doorLockTitleEl: HTMLDivElement;
  private readonly doorLockSubEl: HTMLDivElement;
  private readonly cocoonHudEl: HTMLDivElement;
  private readonly cocoonTitleEl: HTMLDivElement;
  private readonly cocoonSubEl: HTMLDivElement;
  private readonly cocoonBarFillEl: HTMLDivElement;
  private readonly cocoonHintEl: HTMLDivElement;
  private readonly spectatorHudEl: HTMLDivElement;
  private readonly spectatorTargetEl: HTMLDivElement;
  private readonly spectatorStatusEl: HTMLDivElement;
  private readonly spectatorHintEl: HTMLDivElement;
  private readonly spectatorCameraAnchorScratch = new THREE.Vector3();
  private readonly spectatorCameraDesiredScratch = new THREE.Vector3();
  private readonly spectatorCameraSafeScratch = new THREE.Vector3();
  private readonly spectatorCameraLookScratch = new THREE.Vector3();
  private spectatorMode = false;
  private spectatorTargetId: string | null = null;
  private readonly danceMenu: DoomDanceMenu;
  private readonly danceHudEl: HTMLDivElement;
  private readonly shotgunObjectiveEl: HTMLDivElement;
  private readonly danceHudIconEl: HTMLSpanElement;
  private readonly danceHudNameEl: HTMLDivElement;
  private readonly danceHudHintEl: HTMLDivElement;
  private danceId: DoomDanceId | null = null;
  private danceTime = 0;
  private danceFacingYaw = 0;
  private danceCameraDistance = 2.72;
  private danceBeatIndex = -1;
  private readonly danceCamTargetScratch = new THREE.Vector3();
  private readonly danceCamPosScratch = new THREE.Vector3();
  private readonly danceCamLookScratch = new THREE.Vector3();
  private wasSpiderDead = false;
  private victoryPending = false;
  private victoryShown = false;
  private victoryElapsedSec = 0;
  private shotgunShotsFired = 0;
  private localPlayerName = 'VOCÊ';
  private currentThemedRoomId: DoomRoomId | null = null;
  private roomBannerHideAtSec = 0;
  private elapsed = 0;
  private lastRaf = performance.now();
  private rafId = 0;
  private disposed = false;

  private readonly abortCtrl = new AbortController();

  constructor(
    private readonly sound: SoundEngine,
    private readonly onPermanentDeathExit?: () => void,
    initialMultiplayerSession?: ActiveRoomSession,
    private readonly onRestartRequested?: () => void
  ) {
    this.viewportEl = document.getElementById('game-viewport') as HTMLElement;
    this.canvas = document.getElementById('webgl-canvas') as HTMLCanvasElement;

    this.localAfkBannerEl = document.createElement('div');
    this.localAfkBannerEl.className = 'oof-local-afk-banner hidden';
    this.localAfkBannerEl.innerHTML =
      '<span class="oof-afk-badge">' +
      '<svg class="oof-afk-icon-svg" viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">' +
      '<circle cx="8" cy="8" r="6.5" fill="rgba(45,30,4,0.9)" stroke="#ffca63" stroke-width="1.5"/>' +
      '<rect x="5.2" y="4.8" width="2" height="6.4" rx="0.5" fill="#ffd980"/>' +
      '<rect x="8.8" y="4.8" width="2" height="6.4" rx="0.5" fill="#ffd980"/>' +
      '</svg>' +
      '<span>AFK</span>' +
      '</span>' +
      '<span>AUSENTE / INDISPONÍVEL</span>' +
      '<span class="oof-local-afk-sub">• Mova o mouse ou pressione qualquer tecla para retomar</span>';
    this.viewportEl.appendChild(this.localAfkBannerEl);

    this.roomBannerEl = document.createElement('div');
    this.roomBannerEl.id = 'doom-room-banner';
    this.roomBannerEl.className = 'doom-room-banner';
    const roomKicker = document.createElement('div');
    roomKicker.className = 'doom-room-banner-kicker';
    roomKicker.textContent = 'SETOR IDENTIFICADO';
    this.roomBannerTitleEl = document.createElement('div');
    this.roomBannerTitleEl.className = 'doom-room-banner-title';
    this.roomBannerSubEl = document.createElement('div');
    this.roomBannerSubEl.className = 'doom-room-banner-sub';
    this.roomBannerEl.append(
      roomKicker,
      this.roomBannerTitleEl,
      this.roomBannerSubEl
    );
    this.viewportEl.appendChild(this.roomBannerEl);

    this.doorLockPromptEl = document.createElement('div');
    this.doorLockPromptEl.id = 'doom-door-lock-prompt';
    this.doorLockPromptEl.className = 'doom-door-lock-prompt';
    this.doorLockTitleEl = document.createElement('div');
    this.doorLockTitleEl.className = 'doom-door-lock-title';
    this.doorLockSubEl = document.createElement('div');
    this.doorLockSubEl.className = 'doom-door-lock-sub';
    this.doorLockPromptEl.append(this.doorLockTitleEl, this.doorLockSubEl);
    this.viewportEl.appendChild(this.doorLockPromptEl);

    this.cocoonHudEl = document.createElement('div');
    this.cocoonHudEl.id = 'doom-cocoon-devour-hud';
    this.cocoonHudEl.className = 'doom-cocoon-devour-hud';
    this.cocoonTitleEl = document.createElement('div');
    this.cocoonTitleEl.className = 'doom-cocoon-title';
    this.cocoonTitleEl.textContent =
      '🕸️ PRESO NA TEIA DO NINHO — IMPOSSÍVEL ESCAPAR SOZINHO!';
    this.cocoonSubEl = document.createElement('div');
    this.cocoonSubEl.className = 'doom-cocoon-sub';
    this.cocoonSubEl.textContent =
      'Seus amigos precisam cortar a teia [E / Faca] antes da Aranha devorar você!';
    const barTrack = document.createElement('div');
    barTrack.className = 'doom-cocoon-bar-track';
    this.cocoonBarFillEl = document.createElement('div');
    this.cocoonBarFillEl.className = 'doom-cocoon-bar-fill';
    barTrack.appendChild(this.cocoonBarFillEl);
    this.cocoonHintEl = document.createElement('div');
    this.cocoonHintEl.className = 'doom-cocoon-hint';
    this.cocoonHintEl.textContent =
      '[E / ESPAÇO] Resistir  •  [B] Falar por Voz 3D';
    this.cocoonHudEl.append(
      this.cocoonTitleEl,
      this.cocoonSubEl,
      barTrack,
      this.cocoonHintEl
    );
    this.viewportEl.appendChild(this.cocoonHudEl);

    // HUD persistente do modo espectador: aparece só depois da morte no Co-op.
    this.spectatorHudEl = document.createElement('div');
    this.spectatorHudEl.id = 'doom-spectator-hud';
    this.spectatorHudEl.className = 'doom-spectator-hud';
    const spectatorKicker = document.createElement('div');
    spectatorKicker.className = 'doom-spectator-kicker';
    spectatorKicker.textContent = 'SINAL DE VIDA ENCERRADO';
    this.spectatorTargetEl = document.createElement('div');
    this.spectatorTargetEl.className = 'doom-spectator-target';
    this.spectatorStatusEl = document.createElement('div');
    this.spectatorStatusEl.className = 'doom-spectator-status';
    this.spectatorHintEl = document.createElement('div');
    this.spectatorHintEl.className = 'doom-spectator-hint';
    this.spectatorHintEl.textContent =
      '[A / ←] anterior  ·  [D / →] próximo  ·  [ESC] sair da sala';
    this.spectatorHudEl.append(
      spectatorKicker,
      this.spectatorTargetEl,
      this.spectatorStatusEl,
      this.spectatorHintEl
    );
    this.viewportEl.appendChild(this.spectatorHudEl);

    // HUD de dança em 3ª pessoa (nome da coreografia + dicas de controle)
    this.danceHudEl = document.createElement('div');
    this.danceHudEl.id = 'doom-dance-hud';
    this.danceHudEl.className = 'doom-dance-hud';
    this.danceHudIconEl = document.createElement('span');
    this.danceHudIconEl.className = 'doom-dance-hud-icon';
    this.danceHudIconEl.textContent = '🎭';
    this.danceHudNameEl = document.createElement('div');
    this.danceHudNameEl.className = 'doom-dance-hud-name';
    this.danceHudHintEl = document.createElement('div');
    this.danceHudHintEl.className = 'doom-dance-hud-hint';
    this.danceHudHintEl.textContent =
      '[G] trocar · mover para parar';
    this.danceHudEl.append(
      this.danceHudIconEl,
      this.danceHudNameEl,
      this.danceHudHintEl
    );
    this.viewportEl.appendChild(this.danceHudEl);
    this.shotgunObjectiveEl = document.createElement('div');
    this.shotgunObjectiveEl.className = 'doom-shotgun-objective';
    this.shotgunObjectiveEl.setAttribute('aria-live', 'polite');
    this.viewportEl.appendChild(this.shotgunObjectiveEl);

    this.danceMenu = new DoomDanceMenu(
      this.viewportEl,
      (id) => this.startDance(id),
      () => this.closeDanceMenu()
    );

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: false,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setClearColor(0x000000, 1);
    // Sombra real só existe na cena do viewmodel (lanterna/mãos em 1ª pessoa):
    // o labirinto é desenhado inteiro pelos shaders DOOM e não projeta sombra.
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const aspect =
      Math.max(1, window.innerWidth) / Math.max(1, window.innerHeight);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(
      computeAdaptiveVerticalFov(aspect, 74, 98),
      aspect,
      0.12,
      125
    );

    this.compositor = new DoomRetroCompositor(
      window.innerWidth,
      window.innerHeight
    );
    this.sharedUniforms = createDoomSharedUniforms();
    this.flashlight = new DoomFlashlight(aspect);
    this.shotgun = new DoomShotgunViewmodel(aspect);

    // Gera layout aleatório a cada partida (caixas, itens, spawn do jogador, ninho, teias e aranha),
    // mantendo o mundo sincronizado por código de sala no Co-op enquanto o spawn de cada jogador varia!
    // Peças da shotgun: a arma completa exige sempre as quatro peças (corpo,
    // cano, bomba e coronha). O servidor prepara um conjunto inteiro por
    // jogador — solo = 4 peças, dois jogadores = 8 — para que cada um tenha a
    // sua própria shotgun para montar. A contagem é fixada agora e entra no
    // layout, então todos os clientes da sala recebem as mesmas peças.
    const arenaLayout = createRandomArenaLayout(
      initialMultiplayerSession
        ? {
            worldSeed: hashArenaSeed(
              `oof-arena-world:${initialMultiplayerSession.roomCode}`
            ),
            playerSeed: createRandomArenaSeed(),
            isMultiplayer: true,
            playerCount: Math.max(
              1,
              initialMultiplayerSession.playerCount ||
                initialMultiplayerSession.playersSummary?.length ||
                1
            ),
          }
        : {}
    );

    this.arenaLayout = arenaLayout;
    this.ambientZoneTracker = new DoomAmbientZoneTracker(arenaLayout.lairCell);
    const textures = createDoomTextures();
    const maze = buildDoomLabyrinth(
      this.scene,
      textures,
      this.sharedUniforms,
      arenaLayout
    );

    this.colliders = maze.colliders;
    this.lights = maze.lights;
    this.annexLights = maze.annexLights;
    this.specialRoomDoors = maze.specialRoomDoors;
    this.lightPanelEmissionAttr = maze.lightPanelEmissionAttr;
    this.prevLightDimState = maze.lights.map(() => false);
    this.position.copy(maze.spawnPosition);
    this.yaw = maze.spawnYaw;

    this.astronaut = new DoomAstronaut(this.scene, this.sharedUniforms);
    this.astronaut.updateFirstPersonBody(
      this.position,
      this.yaw,
      0,
      0,
      0,
      false,
      false
    );
    this.worldItems = new DoomWorldItems(
      this.scene,
      this.sharedUniforms,
      arenaLayout
    );
    this.radar = new DoomRadar(this.viewportEl, arenaLayout.lairCell);
    this.radar.markExploredAtWorld(this.position.x, this.position.z);
    this.webManager = new DoomSpiderWebManager(
      this.scene,
      this.sharedUniforms,
      arenaLayout
    );
    this.spider = new DoomSpider(
      this.scene,
      this.sharedUniforms,
      this.colliders,
      this.webManager,
      this.sound,
      arenaLayout
    );
    this.spider.onWebTrapSpawned = (x, z) => {
      this.multiplayer?.notifyWebTrapSpawned(x, z);
    };

    this.inventory = new DoomInventory(this.viewportEl, this.sound, {
      onToggleFlashlightFromUI: () => {
        const equipping = this.flashlight.toggle();
        this.sound.playFlashlightMotion(equipping);
        if (!equipping) {
          this.sound.playFlashlightClick(false);
        }
        this.syncInventoryVitals();
      },
      onUseHeal: (healAmount, calmAmount, itemKind) => {
        const canBoostStamina =
          itemKind === 'morphine' && this.staminaState.stamina < 85;
        if (
          this.playerHealth >= 99.5 &&
          !this.playerBleeding &&
          this.playerSanity >= 96 &&
          !canBoostStamina
        ) {
          return false;
        }
        this.flashlight.triggerQuickItemAction(itemKind);
        this.playerHealth = Math.min(100, this.playerHealth + healAmount);
        this.playerSanity = Math.min(100, this.playerSanity + calmAmount);
        if (itemKind === 'morphine') {
          boostPlayerStamina(this.staminaState, 55);
        }
        this.playerBleeding = false;
        this.syncInventoryVitals();
        return true;
      },
      onUseBattery: (chargeAmount) => {
        if (this.lanternBattery >= 99.5) return false;
        this.flashlight.triggerQuickItemAction('battery');
        this.lanternBattery = Math.min(100, this.lanternBattery + chargeAmount);
        this.syncInventoryVitals();
        return true;
      },
      onToggleShotgun: () => this.toggleShotgun(),
      onDropHeldItem: (itemId) => this.dropHeldItemIntoWorld(itemId),
      onUseFlare: () => {
        if (this.webManager.isLockedInMultiplayerCocoon) {
          this.sound.playStruggleEffort();
          return false;
        }
        this.flashlight.triggerQuickItemAction('flare');
        this.worldItems.spawnLitFlare(this.position, this.yaw);
        this.multiplayer?.notifyFlareSpawned(
          this.position,
          this.yaw,
          this.spider.position
        );
        return true;
      },
      onUseKnife: () => {
        if (this.webManager.isLockedInMultiplayerCocoon) {
          this.sound.playStruggleEffort();
          return { cutWeb: false };
        }
        this.flashlight.triggerQuickItemAction('knife');
        this.flashlight.addLookImpulse(0.018, -0.012);
        this.sound.playItemUse('blade');

        const lookForward = new THREE.Vector3(
          -Math.sin(this.yaw),
          0,
          -Math.cos(this.yaw)
        );
        const res = this.webManager.slashWebWithKnife(
          this.position,
          lookForward,
          this.sound
        );
        if (res.cutNearbyTrap && res.cutTrapPos) {
          this.multiplayer?.notifyWebTrapCut(
            res.cutTrapPos.x,
            res.cutTrapPos.z
          );
        }
        const struckSpiderCarapace =
          this.multiplayer?.tryStrikeCapturingSpider(
            this.position,
            this.spider.position,
            'knife'
          ) ?? false;
        if (struckSpiderCarapace) {
          this.cameraShake = Math.max(this.cameraShake, 0.09);
        }
        const rescuedAlly =
          this.multiplayer?.tryRescueNearbyTrappedAlly(
            this.position,
            this.spider.position,
            true
          ) ?? false;
        if (res.cutActiveSnare) {
          this.inventory.setAbductionScreenFX(0, 0, 0, 0);
          this.syncInventoryVitals();
        }
        return {
          cutWeb:
            res.cutActiveSnare ||
            res.cutNearbyTrap ||
            rescuedAlly,
        };
      },
      onUseKey: (itemId) => {
        this.flashlight.triggerQuickItemAction('key');
        this.astronaut.setArmInUse('left', true);
        if (!itemId) {
          this.sound.playBlastDoorUnlock(false);
          return false;
        }
        const matchingDoor = this.specialRoomDoors.findMatchingDoorForKey(
          itemId,
          this.position,
          3.85
        );
        if (matchingDoor) {
          const unlocked = this.specialRoomDoors.unlockRoom(
            matchingDoor.room.id
          );
          if (unlocked) {
            this.sound.playBlastDoorUnlock(true);
            this.multiplayer?.broadcastRoomUnlocked(
              matchingDoor.room.id,
              matchingDoor.room.name
            );
            this.syncInventoryVitals();
            return true;
          }
        }
        this.sound.playBlastDoorUnlock(false);
        return false;
      },
      onToggleRadar: () => {
        return this.toggleRadarHud();
      },
      onToggleWalkieTalkie: () => {
        return this.toggleWalkieTalkieHud();
      },
      onOpenRequest: () => {
        if (
          this.activeSequence !== 'NONE' ||
          this.inventory.gameOverVisible ||
          this.inventory.victoryVisible ||
          this.pauseMenu.open
        ) {
          return;
        }
        this.suppressReleasePause();
        this.inventory.setOpen(true);
        this.keys.clear();
        this.touchControls.resetTransientInputs();
        this.isDragging = false;
        try {
          document.exitPointerLock?.();
        } catch {
          // ignorar
        }
      },
      onCloseRequest: () => {
        this.closeInventoryAndLock(true);
      },
      onOpenPauseRequest: () => {
        this.openPauseFromInventory();
      },
      onPermanentDeathTerminate: () => {
        this.finalizePermanentDeath();
      },
      onVictoryRestart: () => {
        this.sound.setWorldPaused(false);
        this.pauseMenu.setOpen(false, 'main', true);
        if (this.onRestartRequested) this.onRestartRequested();
        else this.finalizePermanentDeath();
      },
      onVictoryExit: () => {
        this.sound.setWorldPaused(false);
        this.pauseMenu.setOpen(false, 'main', true);
        this.finalizePermanentDeath();
      },
    });

    // A tela de vitória só entra depois de a aranha terminar de cair.
    this.spider.onDeathAnimationFinished = () => {
      if (this.disposed) return;
      this.showVictoryScreen();
    };

    this.touchControls = new DoomTouchControls(this.viewportEl, {
      onActivity: () => {
        this.registerUserActivity();
        this.sound.unlock();
      },
      onCrouchOrSlidePress: () => {
        const horizVel = Math.hypot(this.velocity.x, this.velocity.z);
        const sprintingNow =
          !this.wasCrouching &&
          canPlayerSlideWithStamina(this.staminaState) &&
          (this.touchControls.isSprintRequested ||
            this.keys.has('ShiftLeft') ||
            this.keys.has('ShiftRight')) &&
          horizVel > 5.8;
        if (sprintingNow && !this.slideState.isSliding) {
          this.touchCrouchLatched = true;
          this.touchAutoUnlatchAfterSlide = true;
        } else {
          this.touchCrouchLatched = !this.touchCrouchLatched;
          this.touchAutoUnlatchAfterSlide = false;
        }
      },
      onInteractPress: () => {
        // Mesma regra do [E] e do clique no celular: com item na mão e nada
        // para interagir na mira, o botão USA o item.
        if (!this.tryUseHeldItem()) {
          this.interactQueued = true;
        }
        this.struggleQueued = true;
      },
      onPushToTalkHoldChange: (held) => {
        this.multiplayer?.setPushToTalkHeld(held);
      },
      onPingPress: () => {
        this.emitTacticalPingFromCamera();
      },
      onRadioChatPress: () => {
        if (!this.multiplayer || this.pauseMenu.open) return;
        this.keys.clear();
        this.touchControls.resetTransientInputs();
        this.suppressReleasePause();
        this.multiplayer.openRadioChatInput();
      },
      onShotgunPress: () => {
        if (this.shotgun.isEquipped) this.fireShotgun();
        else this.toggleShotgun();
      },
      onDancePress: () => {
        // No celular: abre o menu de danças; se já estiver dançando, troca
        // direto para a próxima coreografia do catálogo.
        if (this.danceMenu.isOpen) {
          this.closeDanceMenu();
          return;
        }
        if (this.danceId) {
          this.cycleDance();
          return;
        }
        this.openDanceMenu();
      },
    });

    this.settingsStore = new DoomSettingsStore();
    this.pauseMenu = new DoomPauseMenu(
      this.viewportEl,
      this.settingsStore,
      this.sound,
      {
        onPauseOpened: () => {
          this.inventory.setOpen(false);
          this.inventory.setPauseMenuHidden(true);
          this.multiplayer?.closeRadioChatInput(false);
          this.keys.clear();
          this.isDragging = false;
          this.touchControls.resetTransientInputs();
          this.multiplayer?.setPushToTalkHeld(false);
          if (!this.multiplayer) {
            this.sound.setWorldPaused(true);
          }
        },
        onPauseClosed: () => {
          this.inventory.setPauseMenuHidden(false);
          this.sound.setWorldPaused(false);
        },
        onResumeRequest: (fromPointerGesture = false) => {
          this.resumeFromPause(fromPointerGesture);
        },
        onToggleFullscreen: () => {
          try {
            if (document.fullscreenElement) {
              void document.exitFullscreen?.();
            } else {
              const root = document.documentElement as HTMLElement & {
                webkitRequestFullscreen?: () => Promise<void>;
              };
              if (typeof root.requestFullscreen === 'function') {
                void root
                  .requestFullscreen({ navigationUI: 'hide' })
                  .catch(() => {});
              } else if (typeof root.webkitRequestFullscreen === 'function') {
                void root.webkitRequestFullscreen()?.catch?.(() => {});
              }
            }
          } catch {
            // Ignorar restrições do navegador
          }
        },
        onRestartSessionRequest: () => {
          this.sound.setWorldPaused(false);
          this.pauseMenu.setOpen(false, 'main', true);
          this.inventory.setPauseMenuHidden(false);
          if (this.onRestartRequested) {
            this.onRestartRequested();
          } else {
            this.finalizePermanentDeath();
          }
        },
        onExitToDesktopRequest: () => {
          this.sound.setWorldPaused(false);
          this.pauseMenu.setOpen(false, 'main', true);
          this.inventory.setPauseMenuHidden(false);
          this.finalizePermanentDeath();
        },
      }
    );
    this.pauseMenu.setHudSuppressed(true);
    this.pauseMenu.setMultiplayerMode(Boolean(initialMultiplayerSession));
    this.perfHud = new DoomPerfHud(this.viewportEl);
    this.perfGovernor = new DoomPerfGovernor(
      this.buildBasePerfLevers(this.settingsStore.value),
      {
        targetFps: this.settingsStore.value.targetFps,
        aggressiveness: this.settingsStore.value.optimizerAggressiveness,
        enabled: this.settingsStore.value.autoOptimizer,
      }
    );

    this.registerConsoleDiagnostics();

    this.unsubscribeSettings = this.settingsStore.subscribe((s) => {
      this.applySettings(s);
    });
    this.applySettings(this.settingsStore.value);

    // O foco da janela decide se vale a pena renderizar a plena carga.
    window.addEventListener('blur', () => this.refreshFocusPenalty(), {
      signal: this.abortCtrl.signal,
    });
    window.addEventListener('focus', () => this.refreshFocusPenalty(), {
      signal: this.abortCtrl.signal,
    });
    document.addEventListener(
      'visibilitychange',
      () => {
        this.refreshFocusPenalty();
        // Voltar de uma aba oculta traz um quadro gigantesco que não diz nada
        // sobre o hardware: joga as medidas fora e recomeça a janela limpa.
        if (!document.hidden) this.perfGovernor.resetWindow();
      },
      { signal: this.abortCtrl.signal }
    );

    this.syncCamera(0);
    this.bindInput();
    window.addEventListener('resize', () => this.onResize(), {
      signal: this.abortCtrl.signal,
    });
  }

  private applySettings(s: Readonly<DoomGameSettings>): void {
    this.compositor.setPostFXOptions({
      brightness: s.brightness / 100,
      contrast: s.contrast / 100,
      ditherMode: s.ditherMode,
      scanlineIntensity:
        s.crtScanlines === 'strong'
          ? 0.24
          : s.crtScanlines === 'subtle'
            ? 0.11
            : 0,
    });

    // Passa porcentagens [0..100] diretamente — SoundEngine já converte internamente sem dupla divisão!
    this.sound.setUserAudioSettings({
      masterVolume: s.masterVolume,
      sfxVolume: s.sfxVolume,
      uiVolume: s.uiVolume,
      reverbAmount: s.reverbAmount,
    });
    // A preferência altera somente o filtro/coloração retro da voz. Captura,
    // relay/WebRTC, rádio e proximidade continuam ativos.
    this.multiplayer?.setRetroVoiceEffectEnabled(s.retroVoiceEffectEnabled);
    this.syncAudioFocusMute();

    if (s.crouchMode === 'hold') {
      this.desktopCrouchLatched = false;
      this.desktopAutoUnlatchAfterSlide = false;
    }
    if (s.sprintMode === 'hold') {
      this.desktopSprintLatched = false;
    }
    this.touchControls.setLookSensitivityScale(s.touchLookSensitivity / 100);

    this.flashlight.setHandedness(s.viewmodelHand);
    this.shotgun.setHandedness(s.viewmodelHand);
    this.flashlight.setHeadBobMultiplier(s.headBobIntensity / 100);
    this.inventory.setUserInterfaceSettings({
      hubIdleOpacityPercent: s.shortcutsHubIdleOpacity,
      bloodOverlayPercent: s.bloodOverlayScale,
    });

    if (this.activeSequence === 'NONE') {
      this.setCameraFov(s.fov + this.slideState.slideAmount * 5.5);
    }

    this.applyPerformanceSettings(s);

    if (this.pauseMenu.open && !this.multiplayer) {
      this.flashlight.update(
        0.001,
        this.bobPhase,
        0,
        () => {},
        this.crouchAmount,
        this.lanternBattery,
        this.slideState.slideAmount
      );
      this.updateFlickeringLightsAndAudio();
    }
  }

  // ==========================================================================
  // CONSOLE DE DIAGNÓSTICO
  // ==========================================================================

  /**
   * Entrega ao console os dados ao vivo que os comandos mostram, devolve a
   * trava do mouse quando o console fecha e registra a atividade da incursão.
   */
  private registerConsoleDiagnostics(): void {
    const gameConsole = getGameConsole();

    gameConsole.onVisibilityChange((open) => {
      if (open || this.disposed) return;
      // Só devolve a trava se o jogo estiver de fato na frente de tudo.
      if (this.engaged && !this.pauseMenu.open && !this.inventory.open) {
        this.requestCanvasPointerLockOnly();
      }
    });

    gameConsole.registerInfoProvider('desempenho', () => {
      const snap = this.lastPerfSnapshot;
      if (!snap) return ['O ajuste automático ainda está calibrando (aquecimento).'];
      const levers = this.perfGovernor.currentLevers;
      return [
        `Quadros por segundo: ${snap.fps.toFixed(1)} (alvo ${
          this.settingsStore.value.targetFps > 0
            ? `${this.settingsStore.value.targetFps} FPS`
            : 'sem limite'
        }, monitor ~${snap.estimatedRefreshHz} Hz)`,
        `Tempo de quadro: mediana ${snap.frameMsMedian.toFixed(2)} ms · p95 ${snap.frameMsP95.toFixed(2)} ms · orçamento ${snap.budgetMs.toFixed(2)} ms`,
        `JavaScript por quadro: ${snap.cpuMsMean.toFixed(2)} ms (${Math.round(
          snap.cpuShare * 100
        )}% do quadro) · gargalo: ${snap.bottleneck.toUpperCase()}`,
        `Qualidade: degrau ${snap.step} (${snap.stepLabel}) · escala ${levers.renderScalePercent}% · ${levers.maxDynamicLights} luzes`,
        `Ajuste automático: ${snap.status} · ${snap.drops} quedas e ${snap.raises} recuperações`,
        `Sombras: ${levers.viewmodelShadowMap ? 'ligadas' : 'desligadas'} · contato ${levers.contactShadowHz} Hz · radar ${levers.radarHz} Hz`,
        `Resolução interna: ${this.compositor.getResolution().width}×${this.compositor.getResolution().height}`,
      ];
    });

    gameConsole.registerInfoProvider('jogo', () => {
      const lines = [
        `Fase: ${this.activeSequence} · engajado: ${this.engaged ? 'sim' : 'não'} · espectador: ${this.spectatorMode ? 'sim' : 'não'}`,
        `Vida ${Math.round(this.playerHealth)}% · sanidade ${Math.round(
          this.playerSanity
        )}% · bateria da lanterna ${Math.round(this.lanternBattery)}%`,
        `Posição: [${this.position.x.toFixed(1)}, ${this.position.z.toFixed(1)}] · tempo de incursão ${this.victoryElapsedSec.toFixed(1)} s`,
        `Aranha: ${this.spider.isDead ? 'morta' : this.spider.isChasingOrAlert ? 'caçando' : 'patrulhando'}`,
        `Inventário: ${this.inventory.open ? 'aberto' : 'fechado'} · pausa: ${this.pauseMenu.open ? 'aberta' : 'fechada'}`,
      ];
      return lines;
    });

    gameConsole.registerInfoProvider('webgl', () => {
      const gl = this.renderer.getContext();
      const info = this.renderer.info;
      let gpu = 'não identificada';
      try {
        const ext = gl.getExtension('WEBGL_debug_renderer_info');
        if (ext) {
          gpu = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) ?? 'não identificada');
        }
      } catch {
        // Extensão bloqueada por privacidade: nome genérico basta.
      }
      return [
        `Placa de vídeo: ${gpu}`,
        `Desenhos por quadro: ${info.render.calls} · triângulos: ${info.render.triangles}`,
        `Geometrias: ${info.memory.geometries} · texturas: ${info.memory.textures}`,
        `Programas de shader: ${info.programs?.length ?? 0}`,
        `Sombra real: ${this.renderer.shadowMap.enabled ? 'ligada' : 'desligada'}`,
      ];
    });

    gameConsole.registerInfoProvider('rede', () => {
      const mp = this.multiplayer;
      if (!mp) return ['Sessão solo: sem conexão de sala.'];
      return [
        `Jogadores na sala: ${mp.rosterPlayerCount} de ${mp.totalRosterCount}`,
        `Anfitrião: ${mp.isHost ? 'você' : mp.hostPlayerId} · seu id: ${mp.localPlayerId}`,
        `Voz por proximidade: ${mp.isVoiceChatEnabled ? 'ativa' : 'inativa'} · efeito retro: ${
          mp.isRetroVoiceEffectEnabled ? 'ligado' : 'desligado'
        }`,
        `Bate-papo de rádio: ${mp.isChatTyping ? 'digitando agora' : 'fechado'}`,
      ];
    });

    gameConsole.registerInfoProvider('config', (term) => {
      const settings = this.settingsStore.value as unknown as Record<string, unknown>;
      const needle = term.trim().toLowerCase();
      const keys = Object.keys(settings)
        .filter((key) => key.toLowerCase().includes(needle))
        .sort();
      return keys.map((key) => `  ${key} = ${String(settings[key])}`);
    });

    gameConsole.info('jogo', 'Incursão criada — mundo montado e pronto.');
  }

  // ==========================================================================
  // SISTEMA DE OTIMIZAÇÃO
  // ==========================================================================

  /** Qualidade pedida pelo jogador, antes de o governador mexer em nada. */
  private buildBasePerfLevers(s: Readonly<DoomGameSettings>): PerfLevers {
    return {
      renderScalePercent: s.renderScalePercent,
      maxDynamicLights: s.maxDynamicLights,
      contactShadowHz: s.contactShadowRate,
      viewmodelShadowMap: viewmodelShadowMapSize(s.viewmodelShadowQuality) > 0,
      radarHz: 24,
      lightRankMs: 0,
    };
  }

  /**
   * Recalcula a altura do framebuffer: resolução escolhida × escala do
   * governador × penalidade de falta de foco.
   */
  private syncRenderScale(): void {
    const s = this.settingsStore.value;
    const baseH = resolutionPresetToHeight(s.resolutionHeight);
    const scale = this.perfGovernor
      ? this.perfGovernor.currentLevers.renderScalePercent
      : s.renderScalePercent;
    const penalty = this.unfocusedPenalty ? 0.6 : 1;
    const targetH = Math.round((baseH * scale * penalty) / 100);
    // Mesmos limites do compositor, para a comparação abaixo não divergir.
    const clamped = Math.max(140, Math.min(1080, targetH));
    if (this.compositor.getResolution().height === clamped) return;
    const w = Math.max(1, this.viewportEl.clientWidth || window.innerWidth);
    const h = Math.max(1, this.viewportEl.clientHeight || window.innerHeight);
    this.compositor.setTargetHeight(clamped, w, h);
  }

  /** Teto de tempo por quadro já encaixado na taxa do monitor. */
  private effectiveFrameCap(): { capMs: number; toleranceMs: number } {
    return snapFrameCapToVsync(this.frameCapMs, this.displayIntervalMs);
  }

  /** Teto de tempo por quadro. Zero significa "deixa o monitor mandar". */
  private updateFrameCap(): void {
    const s = this.settingsStore.value;
    let cap = s.targetFps > 0 ? 1000 / s.targetFps : 0;
    if (this.unfocusedPenalty) {
      // Sem foco não tem ninguém olhando: 15 quadros por segundo bastam.
      cap = Math.max(cap, 1000 / 15);
    }
    this.frameCapMs = cap;
  }

  /** Aplica as alavancas decididas pelo governador nos subsistemas. */
  private applyPerfLevers(levers: PerfLevers): void {
    this.perfLightsBudget = Math.max(
      PERF_LIGHTS_MIN,
      Math.min(MAX_DOOM_LIGHTS, Math.round(levers.maxDynamicLights))
    );

    if (this.lightRankIntervalMs !== levers.lightRankMs) {
      this.lightRankIntervalMs = levers.lightRankMs;
      this.lastLightRankMs = -1;
    }

    this.radar.setRefreshIntervalMs(1000 / Math.max(1, levers.radarHz));
    this.worldItems.setContactShadowHz(levers.contactShadowHz);
    this.flashlight.setViewmodelShadowQuality(
      levers.viewmodelShadowMap
        ? viewmodelShadowMapSize(
            this.settingsStore.value.viewmodelShadowQuality
          )
        : 0
    );
    this.syncRenderScale();
  }

  /**
   * Janela sem foco: corta resolução e quadros em vez de queimar máquina.
   *
   * Só entra em ação depois de um instante sem foco, porque alternar de janela
   * por um segundo não deveria mexer na qualidade de quem está jogando — e
   * porque `document.hasFocus()` pode demorar a confirmar em algumas
   * incorporações, o atraso evita rebaixar o jogo à toa.
   */
  private refreshFocusPenalty(): void {
    const s = this.settingsStore.value;
    const hidden = Boolean(document.hidden);
    const unfocused =
      hidden ||
      (typeof document.hasFocus === 'function' && !document.hasFocus());

    if (!s.reduceWhenUnfocused || !unfocused) {
      if (this.focusLostAtMs !== 0) this.focusLostAtMs = 0;
      this.setFocusPenalty(false);
      return;
    }

    if (this.focusLostAtMs === 0) {
      this.focusLostAtMs = performance.now();
      window.setTimeout(() => {
        if (!this.disposed) this.refreshFocusPenalty();
      }, 2600);
      return;
    }

    if (performance.now() - this.focusLostAtMs < 2000) return;
    this.setFocusPenalty(true);
  }

  private setFocusPenalty(on: boolean): void {
    if (this.unfocusedPenalty === on) return;
    this.unfocusedPenalty = on;
    this.updateFrameCap();
    this.syncRenderScale();
  }

  /** Chamado uma vez por quadro, depois de desenhar. */
  private updatePerfFrame(
    nowMs: number,
    realDtMs: number,
    cpuMs: number,
    measuring: boolean
  ): void {
    if (this.disposed) return;

    if (measuring) {
      const snapshot = this.perfGovernor.update({
        frameMs: realDtMs,
        cpuMs,
        nowMs,
      });
      this.lastPerfSnapshot = snapshot;
      if (snapshot.leversRevision !== this.appliedLeversRevision) {
        const previous = this.appliedLeversRevision;
        this.appliedLeversRevision = snapshot.leversRevision;
        this.applyPerfLevers(snapshot.levers);
        // Só registra depois do primeiro ajuste, senão o console anunciaria a
        // qualidade inicial como se fosse uma mudança.
        if (previous >= 0) {
          getGameConsole().info(
            'desempenho',
            `Qualidade em ${snapshot.stepLabel} (degrau ${snapshot.step}): escala ${
              snapshot.levers.renderScalePercent
            }% · ${snapshot.levers.maxDynamicLights} luzes · gargalo ${snapshot.bottleneck.toUpperCase()}`
          );
        }
      }
    }

    const snap = this.lastPerfSnapshot;
    if (this.perfHud.visible && snap) {
      this.perfHud.pushFrameTime(realDtMs);
      this.perfHud.update(
        {
          fps: snap.fps,
          targetFps: this.settingsStore.value.targetFps,
          frameMsMedian: snap.frameMsMedian,
          frameMsP95: snap.frameMsP95,
          cpuShare: snap.cpuShare,
          bottleneck: snap.bottleneck,
          status: snap.status,
          step: snap.step,
          stepLabel: snap.stepLabel,
          scalePercent: this.perfGovernor.currentLevers.renderScalePercent,
          lights: this.perfLightsBudget,
          budgetMs: snap.budgetMs,
          autoEnabled: this.settingsStore.value.autoOptimizer,
          drops: snap.drops,
          raises: snap.raises,
        },
        nowMs
      );
    }
  }

  /** Aplica as opções de desempenho vindas das configurações. */
  private applyPerformanceSettings(s: Readonly<DoomGameSettings>): void {
    this.perfGovernor.setBase(this.buildBasePerfLevers(s));
    this.perfGovernor.setOptions({
      targetFps: s.targetFps,
      aggressiveness: s.optimizerAggressiveness,
      enabled: s.autoOptimizer,
    });
    this.updateFrameCap();

    const far = Math.max(1, s.drawDistance);
    if (this.camera.far !== far) {
      this.camera.far = far;
      this.camera.updateProjectionMatrix();
    }

    this.flashlight.setViewmodelShadowQuality(
      viewmodelShadowMapSize(s.viewmodelShadowQuality)
    );
    this.worldItems.setContactShadowHz(s.contactShadowRate);
    this.radar.setRefreshIntervalMs(1000 / 24);
    this.perfHud.setVisible(s.showPerfHud);

    // As alavancas resolvidas mandam: reaplica por cima do que foi pedido.
    this.applyPerfLevers(this.perfGovernor.currentLevers);
    this.appliedLeversRevision = this.perfGovernor.leversRevision;
  }

  private syncAudioFocusMute(): void {
    const unfocused =
      Boolean(document.hidden) ||
      (typeof document.hasFocus === 'function' && !document.hasFocus());
    this.sound.setFocusMuted(
      this.settingsStore.value.muteWhenUnfocused && unfocused
    );
  }

  private resumeFromPause(fromPointerGesture = false): void {
    if (!this.pauseMenu.open) return;
    this.suppressReleasePause();
    this.ignoreEscapeKeyUntilMs = performance.now() + 260;
    this.pauseMenu.setOpen(false);
    this.inventory.setPauseMenuHidden(false);
    this.sound.setWorldPaused(false);
    this.keys.clear();
    this.isDragging = false;
    this.lastRaf = performance.now();
    this.tryPointerLock(fromPointerGesture);
  }

  engageFromTerminal(multiplayerSession?: ActiveRoomSession): void {
    this.lastUserActivityMs = performance.now();
    this.tabHiddenSinceMs = document.hidden ? performance.now() : null;
    this.localAfk = false;
    this.localAfkBannerEl.classList.add('hidden');
    this.attachMultiplayerSession(multiplayerSession);
    this.pauseMenu.setMultiplayerMode(Boolean(multiplayerSession));
    this.pauseMenu.setOpen(false, 'main', true);
    this.pauseMenu.setHudSuppressed(false);
    this.inventory.setPauseMenuHidden(false);
    this.sound.setWorldPaused(false);
    this.engaged = true;
    this.victoryElapsedSec = 0;
    try {
      const name = getOrCreateLocalPlayerProfile().name;
      if (name) this.localPlayerName = name;
    } catch {
      // Perfil indisponível: mantém o rótulo padrão.
    }
    this.wasFullscreen = Boolean(document.fullscreenElement);
    this.syncAudioFocusMute();
    this.onResize();
    this.sound.unlock();
    this.sound.enterDoomLabyrinth();
    this.tryPointerLock(true);
    this.compositor.render(
      this.renderer,
      this.scene,
      this.camera,
      this.flashlight.viewScene,
      this.flashlight.viewCamera
    );
  }

  private attachMultiplayerSession(session?: ActiveRoomSession): void {
    if (this.multiplayer) {
      this.multiplayer.destroy();
      this.multiplayer = null;
    }
    if (!session) return;

    this.multiplayer = new DoomMultiplayerCoordinator(
      session,
      this.scene,
      this.sharedUniforms,
      this.viewportEl,
      this.sound,
      {
        createQuickItemProps: () => this.flashlight.createThirdPersonQuickProps(),
        createWeaponProps: () => ({ shotgun: this.shotgun.createThirdPersonWeapon() }),
        onShotgunShot: (origin, direction) => { this.applyShotgunHit(origin, direction); },
        getLocalShotgunPartSlots: () => this.worldItems.getShotgunPartSlotCount(),
        onShotgunPartSlotsChanged: (slots) => {
          // O anfitrião define a quantidade de peças: um conjunto completo das
          // quatro para cada jogador da sala. Quem entrou depois passa a ver as
          // mesmas peças nas salas especiais.
          const applied = this.worldItems.syncShotgunPartSlots(slots);
          this.arenaLayout = { ...this.arenaLayout, shotgunPartSlotCount: applied };
        },
        getLairCenter: () => this.webManager.lairCenter,
        getDragDirection: () => this.webManager.dragDirection,
        onSquadDevoured: (victimId, victimName) => {
          this.beginSquadDevouredSequence(victimId, victimName);
        },
        onReceiveFlare: (pos, yaw) => {
          this.worldItems.spawnLitFlare(pos, yaw);
          if (
            Math.hypot(pos.x - this.position.x, pos.z - this.position.z) < 15.0
          ) {
            this.sound.playItemUse('flare');
          }
        },
        onRescuedByAlly: () => {
          this.cocoonDevourTimerSec = 0;
          this.cocoonReturnTriggered = false;
          this.cocoonHudEl.classList.remove('is-visible', 'is-critical');
          this.webManager.clearEnsnarement();
          this.sound.playWebCut();
          this.sound.playWakeUpGasp();
          boostPlayerStamina(this.staminaState, 75);
          this.inventory.setAbductionScreenFX(0, 0, 0, 0);
          this.syncInventoryVitals();
        },
        onAbductionInterruptedByAlly: () => {
          this.abortAbductionByAllyRescue();
        },
        onSpiderInterruptedAndFlees: (threatPos) => {
          this.spider.interruptAbductionAndFlee(
            threatPos,
            this.position,
            this.yaw
          );
        },
        onCaughtByAuthoritativeSpider: (spiderPos) => {
          if (this.activeSequence === 'NONE') {
            this.triggerSpiderCatch(spiderPos);
          }
        },
        onRemoteVictimFinishedAbduction: () => {
          this.maybeStartSquadDevouredSequence();
          const observers = this.multiplayer?.getObserverWorldPositions(
            this.position
          );
          this.spider.finishAbductionRetreat(observers);
        },
        onRemoteWebTrapSpawned: (x, z) => {
          this.webManager.spawnWebTrap(x, z, false);
        },
        onRemoteWebTrapTriggered: (trapPos, playerPos) => {
          this.webManager.collapseTrapNearWorld(trapPos.x, trapPos.z);
          if (
            Math.hypot(
              trapPos.x - this.position.x,
              trapPos.z - this.position.z
            ) < 14.0
          ) {
            this.sound.playWebTrapSnap();
          }
          if (!this.multiplayer || this.multiplayer.isHost) {
            this.spider.alertToWebTrap(
              trapPos,
              playerPos,
              this.position,
              this.yaw
            );
          }
        },
        onRemoteWebTrapCut: (x, z) => {
          const collapsed = this.webManager.collapseTrapNearWorld(x, z);
          if (
            collapsed &&
            Math.hypot(x - this.position.x, z - this.position.z) < 12.0
          ) {
            this.sound.playWebCut();
          }
        },
        onRemoteRoomUnlocked: (roomId) => {
          const unlocked = this.specialRoomDoors.unlockRoom(
            roomId as DoomRoomId
          );
          if (unlocked) {
            this.sound.playBlastDoorUnlock(true);
          }
        },
        onNotifyHud: (text) => {
          this.multiplayer?.pushHudNotice(text);
        },
        onRadioChatClosed: () => {
          this.keys.clear();
          this.isDragging = false;
          if (document.fullscreenElement) {
            lockSystemKeyboardKeys();
          }
          this.requestCanvasPointerLockOnly();
        },
        onLeaveRoomRequested: () => {
          this.finalizePermanentDeath();
        },
      }
    );
    this.multiplayer.setRetroVoiceEffectEnabled(
      this.settingsStore.value.retroVoiceEffectEnabled
    );
    this.multiplayer.seedInitialLocalPose(this.position, this.yaw);
  }

  private registerUserActivity(): void {
    this.lastUserActivityMs = performance.now();
    if (!document.hidden) {
      this.tabHiddenSinceMs = null;
      if (this.localAfk) {
        this.localAfk = false;
        this.localAfkBannerEl.classList.add('hidden');
      }
    }
  }

  private refreshLocalAfkStatus(): boolean {
    const now = performance.now();
    const hidden = Boolean(document.hidden);
    if (hidden) {
      if (this.tabHiddenSinceMs === null) {
        this.tabHiddenSinceMs = now;
      }
    } else {
      this.tabHiddenSinceMs = null;
    }
    const hiddenDur =
      hidden && this.tabHiddenSinceMs !== null
        ? now - this.tabHiddenSinceMs
        : 0;
    const nextAfk = isPlayerConsideredAfk(
      now - this.lastUserActivityMs,
      hidden,
      hiddenDur
    );
    this.localAfk = nextAfk;
    this.localAfkBannerEl.classList.toggle(
      'hidden',
      !nextAfk || !this.engaged || this.inventory.gameOverVisible
    );
    return nextAfk;
  }

  reacquirePointerLockAfterFullscreen(): void {
    if (!this.engaged || this.disposed) return;
    this.requestCanvasPointerLockOnly();
  }

  /** Entra no modo espectador após a animação de morte da Aranha no Co-op. */
  private enterSpectatorMode(): void {
    if (!this.multiplayer || this.spectatorMode || this.disposed) return;
    this.spectatorMode = true;
    this.spectatorTargetId = null;
    this.activeSequence = 'DEAD_TERMINATED';
    this.permadeathTimerId = 0;
    this.multiplayer.closeRadioChatInput(false);
    this.inventory.setOpen(false);
    this.pauseMenu.setOpen(false, 'main', true);
    this.cocoonHudEl.classList.remove('is-visible', 'is-critical');
    this.doorLockPromptEl.classList.remove('is-visible', 'can-unlock');
    this.inventory.setAbductionScreenFX(0, 0, 0, 0);
    this.keys.clear();
    this.touchControls.resetTransientInputs();
    this.touchControls.syncState({
      overlayBlocked: true,
      inCaptureSequence: true,
      isSprinting: false,
      isCrouchedOrSliding: false,
      canTriggerSlide: false,
      interactContext: 'NONE',
      inMultiplayer: true,
      isPushToTalkActive: false,
    });
    this.flashlight.forceStowImmediate();
    this.shotgun.stow();
    this.astronaut.setFirstPersonMode(true);
    this.sharedUniforms.uFlashlightIntensity.value = 0;
    this.cameraShake = 0;
    this.setCameraFov(this.settingsStore.value.fov);
    this.spectatorHudEl.classList.add('is-visible');
    this.selectSpectatorTarget(1);
  }

  private leaveSpectatorMode(): void {
    this.spectatorMode = false;
    this.spectatorTargetId = null;
    this.spectatorHudEl.classList.remove('is-visible');
  }

  private selectSpectatorTarget(direction: 1 | -1): void {
    if (!this.multiplayer) return;
    const targets = this.multiplayer.getSpectatorTargets();
    if (targets.length === 0) {
      this.spectatorTargetId = null;
      return;
    }
    this.spectatorTargetId = cycleSpectatorTargetId(
      targets.map((target) => target.id),
      this.spectatorTargetId,
      direction
    );
  }

  private resolveSpectatorTarget(): SpectatorTarget | null {
    if (!this.multiplayer) return null;
    const targets = this.multiplayer.getSpectatorTargets();
    if (targets.length === 0) return null;
    let target = targets.find((item) => item.id === this.spectatorTargetId) ?? null;
    if (!target) {
      target = targets[0];
      this.spectatorTargetId = target.id;
    }
    return target;
  }

  private updateSpectatorHud(target: SpectatorTarget | null): void {
    if (!target) {
      this.spectatorTargetEl.textContent = 'NENHUM OPERADOR VIVO';
      this.spectatorStatusEl.textContent = 'O sinal da equipe foi perdido.';
      return;
    }
    this.spectatorTargetEl.textContent = `OBSERVANDO: ${target.name}`;
    this.spectatorStatusEl.textContent = target.cocoonLocked
      ? 'PRESO NA TEIA DO NINHO'
      : target.beingDragged
        ? 'SENDO ARRASTADO PELA ARANHA'
        : target.inSequence
          ? 'EM CENA DE CAPTURA'
          : `OPERADOR ATIVO · ${Math.max(0, Math.round(target.health))}%`;
  }

  private updateSpectatorCamera(dt: number, target: SpectatorTarget | null): void {
    const desired = this.spectatorCameraDesiredScratch;
    const anchor = this.spectatorCameraAnchorScratch;
    const safe = this.spectatorCameraSafeScratch;
    const lookAt = this.spectatorCameraLookScratch;

    if (target) {
      const forwardX = -Math.sin(target.yaw);
      const forwardZ = -Math.cos(target.yaw);
      anchor.set(target.position.x, target.position.y + 1.05, target.position.z);
      desired.set(
        target.position.x - forwardX * 3.55,
        target.position.y + 2.15,
        target.position.z - forwardZ * 3.55
      );
      lookAt.copy(anchor);
    } else {
      const spiderPos = this.spider.position;
      anchor.set(spiderPos.x, Math.max(0.85, spiderPos.y), spiderPos.z);
      desired.set(spiderPos.x, spiderPos.y + 3.1, spiderPos.z + 4.6);
      lookAt.set(spiderPos.x, spiderPos.y + 0.85, spiderPos.z);
    }

    // A câmera não atravessa as paredes do labirinto nem os móveis sólidos.
    // O alvo é o ponto de partida; se o enquadramento traseiro estiver bloqueado,
    // ele encurta até o último ponto livre, em vez de saltar para dentro da parede.
    safe.copy(anchor);
    const dx = desired.x - anchor.x;
    const dy = desired.y - anchor.y;
    const dz = desired.z - anchor.z;
    let safeFraction = 1;
    for (let step = 1; step <= 16; step++) {
      const fraction = step / 16;
      const x = anchor.x + dx * fraction;
      const y = Math.max(0.24, Math.min(5.8, anchor.y + dy * fraction));
      const z = anchor.z + dz * fraction;
      const blocked = this.colliders.some((collider) => {
        const box = collider.box;
        return (
          y >= box.min.y - 0.2 &&
          y <= box.max.y + 0.2 &&
          x >= box.min.x - 0.22 &&
          x <= box.max.x + 0.22 &&
          z >= box.min.z - 0.22 &&
          z <= box.max.z + 0.22
        );
      });
      if (blocked) {
        safeFraction = (step - 1) / 16;
        break;
      }
    }
    safe.set(
      anchor.x + dx * safeFraction,
      Math.max(0.24, Math.min(5.8, anchor.y + dy * safeFraction)),
      anchor.z + dz * safeFraction
    );
    this.camera.position.lerp(safe, 1 - Math.exp(-8.5 * Math.max(0, dt)));
    this.camera.lookAt(lookAt);
    this.sharedUniforms.uFlashlightIntensity.value = 0;
  }

  /**
   * Mantém o mundo vivo enquanto a câmera morta acompanha o esquadrão. Se o
   * antigo anfitrião morreu, ele ainda transmite a Aranha até a sala escolher
   * outro anfitrião; o cadáver nunca volta a ser candidato da IA.
   */
  private updateSpectatorMode(dt: number): void {
    if (!this.multiplayer) return;
    this.elapsed += dt;
    this.specialRoomDoors.update(dt);
    const target = this.resolveSpectatorTarget();
    this.updateSpectatorHud(target);
    this.updateSpectatorCamera(dt, target);
    this.radar.update(
      this.position.x,
      this.position.z,
      this.yaw,
      this.elapsed,
      [],
      true
    );

    const remoteAbduction = this.multiplayer.getActiveRemoteAbduction();
    if (remoteAbduction) {
      this.spider.updateRemoteCinematicSequence(
        dt,
        this.elapsed,
        remoteAbduction.mode,
        remoteAbduction.progress,
        remoteAbduction.spiderPos,
        remoteAbduction.victimPos,
        remoteAbduction.ragdollHooks
      );
    } else if (this.multiplayer.isHost) {
      this.spider.ensureExitedCinematic(
        this.multiplayer.getObserverWorldPositions(
          this.position,
          this.multiplayer.localPlayerId,
          true
        )
      );
      const starvingVictimPos = this.multiplayer.getStarvingCocoonVictimPos(
        this.position,
        false,
        0
      );
      if (starvingVictimPos) {
        this.spider.commandReturnToDevourVictim(starvingVictimPos);
      }
      const candidates = this.multiplayer.buildSpiderPlayerCandidates({
        pos: this.position,
        yaw: this.yaw,
        sprinting: false,
        crouching: false,
        flashlightOn: false,
        flashlightDir: new THREE.Vector3(0, 0, -1),
        voiceLevel: 0,
        ensnared: false,
        afk: false,
        localDead: true,
      });
      if (candidates.length > 0) {
        const chosen = this.spider.selectBestMultiplayerCandidate(candidates);
        this.spider.update(
          dt,
          this.elapsed,
          chosen.pos,
          chosen.yaw,
          chosen.sprinting,
          chosen.crouching,
          chosen.flashlightOn,
          chosen.flashlightDir,
          this.worldItems.getActiveFlares(),
          () => {
            if (!chosen.isLocal) {
              this.multiplayer?.notifyAuthoritativeSpiderCaughtAlly(
                chosen.id,
                this.spider.position
              );
            }
          },
          chosen.voiceLevel ?? 0,
          this.position,
          this.yaw
        );
      }
    } else {
      const remotePacket = this.multiplayer.getFreshRemoteSpiderPacket(3500);
      if (remotePacket) {
        this.spider.applyRemoteNetworkState(
          dt,
          this.elapsed,
          remotePacket,
          this.camera.position,
          0,
          () => {}
        );
      }
    }

    this.multiplayer.update(
      dt,
      this.elapsed,
      this.camera,
      {
        pos: this.position,
        yaw: this.yaw,
        pitch: this.pitch,
        speed: 0,
        bobPhase: 0,
        crouch: 0,
        flashlightOn: false,
        flashDir: new THREE.Vector3(0, 0, -1),
        health: 0,
        bleeding: false,
        ensnared: false,
        inSequence: false,
        dead: true,
        afk: false,
        walkieTalkieActive: false,
      },
        this.spider.getNetworkSnapshot(remoteAbduction?.allyId ?? null),
      false
    );
    this.updateFlickeringLightsAndAudio();
  }

  private finalizePermanentDeath(): void {
    if (this.disposed) return;
    if (this.permadeathTimerId) {
      window.clearTimeout(this.permadeathTimerId);
      this.permadeathTimerId = 0;
    }
    getGameConsole().info('jogo', 'Fim de incursão — retornando ao Terminal.');
    this.sound.setWorldPaused(false);
    this.cocoonHudEl.classList.remove('is-visible', 'is-critical');
    this.leaveSpectatorMode();
    this.onPermanentDeathExit?.();
  }

  private closeInventoryAndLock(fromPointerGesture = false): void {
    this.suppressReleasePause();
    this.ignoreEscapeKeyUntilMs = performance.now() + 240;
    this.inventory.setOpen(false);
    this.keys.clear();
    this.tryPointerLock(fromPointerGesture);
  }

  private openPauseFromInventory(): void {
    if (
      !this.engaged ||
      this.disposed ||
      this.inventory.gameOverVisible ||
      this.activeSequence !== 'NONE'
    ) {
      return;
    }
    this.suppressReleasePause();
    this.ignoreEscapeKeyUntilMs = performance.now() + 260;
    this.inventory.setOpen(false, true);
    this.keys.clear();
    this.touchControls.resetTransientInputs();
    this.isDragging = false;
    this.pauseMenu.setOpen(true, 'main');
  }

  /** Ignora liberações iniciadas pelo próprio jogo ao trocar de interface. */
  private suppressReleasePause(): void {
    this.suppressReleasePauseUntilMs = performance.now() + 500;
  }

  private openPauseFromGameplay(): void {
    this.ignoreEscapeKeyUntilMs = performance.now() + 260;
    this.stopDance('pause');
    this.pauseMenu.setOpen(true, 'main');
  }

  /** Esc pode ser consumido pelo navegador ao sair de pointer lock ou tela cheia. */
  private handleBrowserControlRelease(): void {
    const action = resolveBrowserControlRelease({
      engaged: this.engaged, disposed: this.disposed, paused: this.pauseMenu.open,
      inventoryOpen: this.inventory.open, gameOver: this.inventory.gameOverVisible,
      chatOpen: Boolean(this.multiplayer?.isChatTyping), danceMenuOpen: this.danceMenu.isOpen,
      inSequence: this.activeSequence !== 'NONE', consoleOpen: isGameConsoleOpen(),
      intentionalRelease: performance.now() <= this.suppressReleasePauseUntilMs,
      dancing: this.danceId !== null,
    });
    if (action !== 'ignore') this.suppressReleasePause();
    if (action === 'pause') this.openPauseFromGameplay();
    if (action === 'stop-dance') {
      this.ignoreEscapeKeyUntilMs = performance.now() + 260;
      this.stopDance('menu');
    }
  }

  private requestCanvasPointerLockOnly(): void {
    if (
      isGameConsoleOpen() ||
      this.pauseMenu.open ||
      this.inventory.open ||
      this.inventory.gameOverVisible ||
      this.multiplayer?.isChatTyping ||
      this.activeSequence !== 'NONE'
    ) {
      return;
    }
    if (isTouchCapableEnvironment() && this.touchControls?.isActive) {
      return;
    }
    try {
      const maybe = this.canvas.requestPointerLock?.() as
        | Promise<void>
        | undefined;
      if (maybe && typeof maybe.catch === 'function') {
        maybe.catch(() => {});
      }
      lockSystemKeyboardKeys();
    } catch {
      // Fallback por setas ou arrasto permanece disponível
    }
  }

  private tryPointerLock(fromPointerGesture = false): void {
    if (
      this.pauseMenu.open ||
      this.inventory.open ||
      this.inventory.gameOverVisible ||
      this.multiplayer?.isChatTyping ||
      this.activeSequence !== 'NONE'
    ) {
      return;
    }
    if (
      fromPointerGesture &&
      this.settingsStore.value.autoFullscreenOnResume &&
      typeof document !== 'undefined' &&
      !document.fullscreenElement
    ) {
      let settled = false;
      acquireFullscreenAndKeyboardLock(() => {
        settled = true;
        this.requestCanvasPointerLockOnly();
      });
      // Caso o navegador recuse Fullscreen (ex.: iframe/janela), trava o mouse no canvas logo em seguida sem conflito!
      window.setTimeout(() => {
        if (!settled && !this.disposed) {
          this.requestCanvasPointerLockOnly();
        }
      }, 220);
      return;
    }
    this.requestCanvasPointerLockOnly();
  }

  private bindInput(): void {
    const sig = { signal: this.abortCtrl.signal };

    // Proteção máxima contra fechamento acidental por Ctrl+W fora ou dentro de Tela Cheia
    installSessionTabGuard(
      () =>
        this.engaged &&
        !this.disposed &&
        !this.inventory.gameOverVisible &&
        this.activeSequence !== 'DEAD_TERMINATED',
      this.abortCtrl.signal,
      () => !this.multiplayer?.isChatTyping
    );

    window.addEventListener(
      'keydown',
      (e) => {
        if (!this.engaged || this.disposed) return;
        // Com o console aberto as teclas pertencem a ele, não ao jogo.
        if (isGameConsoleOpen()) return;
        this.registerUserActivity();

        // Enquanto o chat de rádio [T] está aberto: garante saída limpa em Esc/Enter
        // mesmo se o input perder foco, protege Ctrl+W e direciona digitação direto ao campo!
        if (this.multiplayer?.isChatTyping) {
          if (e.code === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            this.multiplayer.closeRadioChatInput(true);
            return;
          }
          if (e.code === 'Enter' || e.code === 'NumpadEnter') {
            e.preventDefault();
            e.stopPropagation();
            this.multiplayer.submitAndCloseRadioChat(true);
            return;
          }
          if (e.code === 'Tab') {
            e.preventDefault();
            e.stopPropagation();
            this.multiplayer.focusChatInput();
            return;
          }
          if ((e.ctrlKey || e.metaKey) && e.code === 'KeyW') {
            e.preventDefault();
            e.stopPropagation();
            return;
          }
          if (document.activeElement !== this.multiplayer.chatInputElement) {
            this.multiplayer.focusChatInput();
          }
          return;
        }

        if (shouldPreventBrowserShortcut(e)) {
          e.preventDefault();
          if (!this.inventory.open) {
            e.stopPropagation();
          }
        }
        this.sound.unlock();

        if (this.spectatorMode) {
          if (e.code === 'ArrowRight' || e.code === 'KeyD') {
            e.preventDefault();
            this.selectSpectatorTarget(1);
          } else if (e.code === 'ArrowLeft' || e.code === 'KeyA') {
            e.preventDefault();
            this.selectSpectatorTarget(-1);
          } else if (e.code === 'Escape') {
            e.preventDefault();
            this.finalizePermanentDeath();
          }
          return;
        }

        if (this.inventory.gameOverVisible) {
          if (e.code === 'Enter' || e.code === 'Space' || e.code === 'Escape') {
            this.finalizePermanentDeath();
          }
          return;
        }

        // Microfone por Distância (Push-to-Talk [B] e Modo [Z]):
        // Funciona inclusive enquanto o jogador está sendo arrastado pela Aranha para gritar por socorro!
        if (
          this.multiplayer &&
          this.activeSequence !== 'DEAD_TERMINATED' &&
          e.code === 'KeyB'
        ) {
          if (!e.repeat) {
            this.multiplayer.setPushToTalkHeld(true);
          }
          return;
        }
        if (
          this.multiplayer &&
          this.activeSequence !== 'DEAD_TERMINATED' &&
          e.code === 'KeyZ' &&
          !e.repeat
        ) {
          this.multiplayer.cycleVoiceMode();
          return;
        }

        // Durante a animação de desmaio / arrasto pela aranha, o jogador está incapacitado
        if (this.activeSequence !== 'NONE') {
          return;
        }

        // Enquanto a Tela de Pausa está aberta: Esc volta à visão anterior ou retoma o jogo; P retoma imediatamente
        if (this.pauseMenu.open) {
          if (e.code === 'Escape' && !e.repeat) {
            e.preventDefault();
            e.stopPropagation();
            if (performance.now() <= this.ignoreEscapeKeyUntilMs) {
              return;
            }
            this.pauseMenu.handleEscapeOrBack();
            return;
          }
          if (e.code === 'KeyP' && !e.repeat) {
            e.preventDefault();
            e.stopPropagation();
            this.resumeFromPause(false);
            return;
          }
          return;
        }

        // ==========================================================================
        // SISTEMA DE DANÇA [G]: menu de coreografias + cancelamento por [Esc]
        // ==========================================================================
        if (this.danceMenu.isOpen) {
          if (e.code === 'KeyG' || e.code === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            this.closeDanceMenu();
            return;
          }
          if (!e.repeat && this.danceMenu.handleKey(e.code)) {
            e.preventDefault();
            e.stopPropagation();
            return;
          }
          return;
        }

        if (e.code === 'KeyH' && !e.repeat && !this.inventory.open) {
          e.preventDefault();
          this.toggleShotgun();
          return;
        }
        if (e.code === 'KeyG' && !e.repeat) {
          e.preventDefault();
          e.stopPropagation();
          this.toggleDanceMenu();
          return;
        }

        // [Esc] durante uma coreografia cancela a dança e devolve a 1ª pessoa
        if (e.code === 'Escape' && this.danceId && !e.repeat) {
          e.preventDefault();
          e.stopPropagation();
          this.suppressReleasePause();
          this.stopDance('menu');
          return;
        }

        if (e.code === 'Tab' && !e.repeat) {
          const opened = this.inventory.toggle();
          this.keys.clear();
          this.isDragging = false;
          if (opened) {
            this.suppressReleasePause();
            // Abrir o Inventário cancela a coreografia (volta à 1ª pessoa)
            this.stopDance('pause');
            try {
              document.exitPointerLock?.();
            } catch {
              // ignorar
            }
          } else {
            this.tryPointerLock(false);
          }
          return;
        }

        if (e.code === 'Escape' && this.inventory.open && !e.repeat) {
          this.closeInventoryAndLock(false);
          return;
        }

        if (e.code === 'KeyP' && this.inventory.open && !e.repeat) {
          e.preventDefault();
          e.stopPropagation();
          this.openPauseFromInventory();
          return;
        }

        // Esc e P pausam a exploração, sem recolocar um botão na HUD.
        if ((e.code === 'Escape' || e.code === 'KeyP') && !this.inventory.open && !e.repeat) {
          e.preventDefault();
          e.stopPropagation();
          if (e.code === 'Escape' && performance.now() <= this.ignoreEscapeKeyUntilMs) return;
          this.openPauseFromGameplay();
          return;
        }

        // Atalho Multiplayer Co-op: [T] Rádio / Chat rápido (fecha o inventário automaticamente se estiver aberto)
        if (this.multiplayer && e.code === 'KeyT' && !e.repeat) {
          e.preventDefault();
          e.stopPropagation();
          this.keys.clear();
          this.isDragging = false;
          this.inventory.setOpen(false);
          this.multiplayer.setPushToTalkHeld(false);
          this.suppressReleasePause();
          this.multiplayer.openRadioChatInput();
          return;
        }

        if (this.inventory.open) {
          return;
        }

        // Cinto [1]–[4]: SÓ troca o que está na mão (nunca gasta o item).
        // Usar é com o clique esquerdo ou [E] — é o que evita beber um
        // láudano por engano no meio de uma fuga.
        const beltKey = /^(Digit|Numpad)([1-4])$/.exec(e.code);
        if (beltKey && !e.repeat) {
          // Sacar a escopeta cancela a coreografia (volta para a 1ª pessoa)
          if (this.danceId) {
            this.stopDance('action');
          }
          this.inventory.selectHotbarSlot(Number(beltKey[2]) - 1);
          return;
        }

        // Tecla [Q]: larga no chão o item da mão (volta a ser objeto pegável)
        if (e.code === 'KeyQ' && !e.repeat) {
          this.inventory.dropHeldItem();
          return;
        }

        // Atalho Multiplayer Co-op: [V] Sinalizador 3D de posição!
        if (this.multiplayer && e.code === 'KeyV' && !e.repeat) {
          this.emitTacticalPingFromCamera();
          return;
        }

        this.keys.add(e.code);

        if (
          !e.repeat &&
          this.settingsStore.value.crouchMode === 'toggle' &&
          (e.code === 'ControlLeft' ||
            e.code === 'ControlRight' ||
            e.code === 'KeyC')
        ) {
          const horizVel = Math.hypot(this.velocity.x, this.velocity.z);
          const sprintingNow =
            !this.wasCrouching &&
            canPlayerSlideWithStamina(this.staminaState) &&
            (this.desktopSprintLatched ||
              this.keys.has('ShiftLeft') ||
              this.keys.has('ShiftRight')) &&
            horizVel > 5.8;
          if (sprintingNow && !this.slideState.isSliding) {
            this.desktopCrouchLatched = true;
            this.desktopAutoUnlatchAfterSlide = true;
          } else {
            this.desktopCrouchLatched = !this.desktopCrouchLatched;
            this.desktopAutoUnlatchAfterSlide = false;
          }
        }

        if (
          !e.repeat &&
          this.settingsStore.value.sprintMode === 'toggle' &&
          (e.code === 'ShiftLeft' || e.code === 'ShiftRight')
        ) {
          this.desktopSprintLatched = !this.desktopSprintLatched;
          if (
            this.desktopSprintLatched &&
            this.desktopCrouchLatched &&
            !this.slideState.isSliding
          ) {
            this.desktopCrouchLatched = false;
          }
        }

        if (e.code === 'KeyE' && !e.repeat) {
          this.interactQueued = true;
          this.struggleQueued = true;
        }
        if (
          (e.code === 'Space' ||
            e.code === 'KeyA' ||
            e.code === 'KeyD' ||
            e.code === 'KeyW' ||
            e.code === 'KeyS') &&
          !e.repeat
        ) {
          this.struggleQueued = true;
        }

        if (e.code === 'KeyF' && !e.repeat) {
          // Com as duas mãos na shotgun não há mão livre: a lanterna de apoio
          // presa sob o cano é a fonte de luz, então a lanterna avulsa não pode
          // ser empunhada enquanto a arma estiver equipada.
          if (this.shotgun.isEquipped) {
            this.sound.invalidInput();
            this.inventory.wakeShortcutsHub(
              2600,
              'MÃOS OCUPADAS · LANTERNA DE APOIO ACOPLADA SOB O CANO'
            );
            return;
          }
          const equipping = this.flashlight.toggle();
          this.sound.playFlashlightMotion(equipping);
          if (!equipping) {
            this.sound.playFlashlightClick(false);
          }
          this.syncInventoryVitals();
          this.inventory.notifyEquipmentShortcutUsed('lantern', equipping);
        }

        if (e.code === 'KeyM' && !e.repeat && this.radar.hasRadar) {
          const nowActive = this.toggleRadarHud();
          this.inventory.notifyEquipmentShortcutUsed('radar', nowActive);
        }

        if (e.code === 'KeyN' && !e.repeat && this.radar.isActive) {
          this.radar.cycleScaleMode();
          this.sound.playRadarPing(true);
          this.inventory.notifyEquipmentShortcutUsed('radar_zoom', true);
        }

        if (
          e.code === 'KeyR' &&
          !e.repeat &&
          this.inventory.hasItem('field_walkie_talkie')
        ) {
          const nowActive = this.toggleWalkieTalkieHud();
          this.inventory.notifyEquipmentShortcutUsed('walkie', nowActive);
        }
      },
      { capture: true, passive: false, signal: this.abortCtrl.signal }
    );

    // Roda do mouse troca o item de mão nos encaixes [1]–[4] do cinto, acordando a barra inferior!
    window.addEventListener(
      'wheel',
      (e) => {
        if (this.engaged && !this.disposed) {
          this.registerUserActivity();
        }
        if (
          !this.engaged ||
          this.pauseMenu.open ||
          this.inventory.open ||
          this.inventory.gameOverVisible ||
          this.multiplayer?.isChatTyping ||
          this.activeSequence !== 'NONE'
        ) {
          return;
        }
        if (Math.abs(e.deltaY) < 1) return;
        const now = performance.now();
        if (now - this.lastWheelSelectMs < 75) return;
        this.lastWheelSelectMs = now;
        this.sound.unlock();
        // Durante a dança a roleta aproxima/afasta a câmera de 3ª pessoa
        if (this.danceId && !this.danceMenu.isOpen) {
          const zoomDir = e.deltaY > 0 ? 1 : -1;
          this.danceCameraDistance = Math.max(
            1.55,
            Math.min(4.2, this.danceCameraDistance + zoomDir * 0.22)
          );
          return;
        }
        const wheelDir: 1 | -1 =
          (e.deltaY > 0 ? 1 : -1) *
            (this.settingsStore.value.invertWheelShortcuts ? -1 : 1) >
          0
            ? 1
            : -1;
        this.inventory.cycleHotbarSlot(wheelDir);
      },
      { passive: true, signal: this.abortCtrl.signal }
    );

    window.addEventListener(
      'keyup',
      (e) => {
        this.keys.delete(e.code);
        if (e.code === 'KeyB') {
          this.multiplayer?.setPushToTalkHeld(false);
        }
      },
      sig
    );

    window.addEventListener(
      'blur',
      () => {
        this.keys.clear();
        this.isDragging = false;
        this.touchControls.resetTransientInputs();
        this.multiplayer?.setPushToTalkHeld(false);
        this.syncAudioFocusMute();
      },
      sig
    );

    window.addEventListener(
      'focus',
      () => {
        this.syncAudioFocusMute();
      },
      sig
    );

    document.addEventListener(
      'visibilitychange',
      () => {
        if (document.hidden) {
          this.keys.clear();
          this.isDragging = false;
          this.touchControls.resetTransientInputs();
          this.tabHiddenSinceMs = performance.now();
        } else {
          this.tabHiddenSinceMs = null;
          this.refreshLocalAfkStatus();
        }
        this.syncAudioFocusMute();
      },
      sig
    );

    window.addEventListener(
      'pointerdown',
      () => {
        if (this.engaged && !this.disposed) {
          this.registerUserActivity();
        }
      },
      sig
    );

    window.addEventListener(
      'touchstart',
      () => {
        if (this.engaged && !this.disposed) {
          this.registerUserActivity();
        }
      },
      { passive: true, signal: this.abortCtrl.signal }
    );

    document.addEventListener(
      'pointerlockchange',
      () => {
        const wasLocked = this.pointerLocked;
        this.pointerLocked = document.pointerLockElement === this.canvas;
        if (this.pointerLocked) this.suppressReleasePauseUntilMs = 0;
        if (wasLocked && !this.pointerLocked) {
          this.keys.clear();
          this.isDragging = false;
          this.handleBrowserControlRelease();
        }
      },
      sig
    );

    document.addEventListener(
      'fullscreenchange',
      () => {
        const wasFullscreen = this.wasFullscreen;
        this.wasFullscreen = Boolean(document.fullscreenElement);
        if (wasFullscreen && !this.wasFullscreen) this.handleBrowserControlRelease();
      },
      sig
    );

    this.canvas.addEventListener(
      'mousedown',
      (e) => {
        const srcCap = (
          e as MouseEvent & {
            sourceCapabilities?: { firesTouchEvents?: boolean };
          }
        ).sourceCapabilities;
        if (srcCap?.firesTouchEvents) {
          return;
        }
        if (
          this.pauseMenu.open ||
          this.inventory.open ||
          this.inventory.gameOverVisible ||
          this.activeSequence !== 'NONE'
        ) {
          return;
        }
        if (this.multiplayer?.isChatTyping) {
          // Clicar de volta na visão 3D fecha suavemente o chat e retoma o controle do jogo!
          this.multiplayer.closeRadioChatInput(false);
          this.sound.unlock();
          this.tryPointerLock(true);
          this.lastMouseX = e.clientX;
          this.lastMouseY = e.clientY;
          return;
        }
        this.sound.unlock();
        const hadPointerLockBeforeClick = this.pointerLocked;
        if (!this.pointerLocked || !document.fullscreenElement) {
          this.tryPointerLock(true);
        }
        if (e.button === 0) {
          if (this.shotgun.isEquipped && hadPointerLockBeforeClick) {
            this.fireShotgun();
            return;
          }
          // Com algo na mão e nada interagível na mira, o clique USA o item
          // (como no Lethal Company). Com algo na frente — item no chão,
          // caixote, aliado preso — o clique continua INTERAGINDO, para não
          // desperdiçar um curativo tentando pegar uma chave.
          // O clique que só captura o mouse não gasta nada: usar o item exige
          // que o ponteiro já estivesse preso, como no tiro da escopeta.
          if (hadPointerLockBeforeClick && this.tryUseHeldItem()) {
            this.struggleQueued = true;
            this.isDragging = true;
            this.lastMouseX = e.clientX;
            this.lastMouseY = e.clientY;
            return;
          }
          this.interactQueued = true;
          this.struggleQueued = true;
        }
        this.isDragging = true;
        this.lastMouseX = e.clientX;
        this.lastMouseY = e.clientY;
      },
      sig
    );

    this.canvas.addEventListener(
      'contextmenu',
      (e) => {
        if (
          !this.pauseMenu.open &&
          !this.inventory.open &&
          !this.multiplayer?.isChatTyping
        ) {
          e.preventDefault();
        }
      },
      sig
    );

    window.addEventListener(
      'mouseup',
      () => {
        this.isDragging = false;
      },
      sig
    );

    window.addEventListener(
      'mousemove',
      (e) => {
        if (
          this.engaged &&
          !this.disposed &&
          (Math.abs(e.movementX) + Math.abs(e.movementY) > 0 ||
            e.clientX !== this.lastMouseX ||
            e.clientY !== this.lastMouseY)
        ) {
          this.registerUserActivity();
        }
        if (
          this.pauseMenu.open ||
          this.inventory.open ||
          this.inventory.gameOverVisible ||
          this.multiplayer?.isChatTyping ||
          this.activeSequence !== 'NONE'
        ) {
          this.lastMouseX = e.clientX;
          this.lastMouseY = e.clientY;
          return;
        }

        const sens =
          0.0022 * (this.settingsStore.value.mouseSensitivity / 100);
        const yDir = this.settingsStore.value.invertMouseY ? -1 : 1;
        const maxPitch = 1.12;
        if (this.pointerLocked) {
          const dYaw = -e.movementX * sens;
          const prevPitch = this.pitch;
          this.yaw += dYaw;
          this.pitch = Math.max(
            -maxPitch,
            Math.min(maxPitch, this.pitch - e.movementY * sens * 0.78 * yDir)
          );
          this.flashlight.addLookImpulse(dYaw, this.pitch - prevPitch);
        } else if (this.isDragging) {
          const dx = e.clientX - this.lastMouseX;
          const dy = e.clientY - this.lastMouseY;
          this.lastMouseX = e.clientX;
          this.lastMouseY = e.clientY;
          const dYaw = -dx * sens * 1.3;
          const prevPitch = this.pitch;
          this.yaw += dYaw;
          this.pitch = Math.max(
            -maxPitch,
            Math.min(maxPitch, this.pitch - dy * sens * 0.85 * yDir)
          );
          this.flashlight.addLookImpulse(dYaw, this.pitch - prevPitch);
        }
      },
      sig
    );
  }

  private onResize(): void {
    if (this.disposed) return;
    const w = Math.max(1, this.viewportEl.clientWidth || window.innerWidth);
    const h = Math.max(1, this.viewportEl.clientHeight || window.innerHeight);
    const aspect = w / h;
    this.camera.aspect = aspect;
    this.camera.fov = computeAdaptiveVerticalFov(
      aspect,
      this.currentBaseDesktopFov,
      this.currentBaseDesktopFov + 24
    );
    this.camera.updateProjectionMatrix();
    this.flashlight.setAspect(aspect);
    this.shotgun.setAspect(aspect);
    this.renderer.setSize(w, h);
    this.compositor.resize(w, h);
  }

  start(): void {
    this.lastRaf = performance.now();
    const loop = (now: number) => {
      if (this.disposed) return;
      // Reagenda já: mesmo que este quadro seja descartado pelo limitador, a
      // próxima chance continua garantida.
      this.rafId = requestAnimationFrame(loop);

      // Descobre o intervalo real do monitor: o `requestAnimationFrame` nunca
      // dispara mais rápido que o vsync, então o menor intervalo observado é
      // a taxa de atualização da tela.
      if (this.lastRafCallbackMs > 0) {
        const sinceCallback = now - this.lastRafCallbackMs;
        if (
          sinceCallback > 4 &&
          (this.displayIntervalMs === 0 || sinceCallback < this.displayIntervalMs)
        ) {
          this.displayIntervalMs = sinceCallback;
        }
      }
      this.lastRafCallbackMs = now;

      // Limitador de quadros. Quando ainda falta tempo para o próximo quadro
      // do alvo, devolve o controle ao navegador sem simular e sem desenhar.
      // É o que transforma uma enxurrada de quadros irregulares numa entrega
      // constante: a máquina esquenta menos e o jogo para de engasgar.
      const { capMs, toleranceMs } = this.effectiveFrameCap();
      if (capMs > 0 && now - this.lastRaf < capMs - toleranceMs) return;

      const realDt = Math.max(0.0005, (now - this.lastRaf) / 1000);
      const dt = Math.min(0.08, realDt);
      this.lastRaf = now;
      const cpuStartMs = performance.now();

      const res = this.compositor.getResolution();
      this.pauseMenu.updateTelemetry(realDt, res.width, res.height);
      this.pauseMenu.setHudSuppressed(
        !this.engaged ||
          this.inventory.gameOverVisible ||
          this.inventory.victoryVisible ||
          this.activeSequence !== 'NONE'
      );

      // Em Modo Solo, abrir a Tela de Pausa congela 100% da simulação física/IA/tempo (dt),
      // mantendo apenas a renderização do quadro 3D para pré-visualizar ajustes de Vídeo em tempo real!
      const soloSimulationPaused = this.pauseMenu.open && !this.multiplayer;
      if (!soloSimulationPaused) {
        this.update(dt);
      }

      // Durante o desmaio, arrasto pela aranha, casulo, morte ou DANÇA (3ª pessoa),
      // nenhum modelo 3D em 1ª pessoa pode aparecer na tela!
      const showViewmodel =
        !this.danceId &&
        (this.activeSequence === 'NONE' ||
          (this.activeSequence !== 'DEAD_TERMINATED' &&
            this.seqTime < 0.42 &&
            this.flashlight.isVisibleInView));
      const showShotgun = this.activeSequence === 'NONE' && this.shotgun.isVisibleInView;
      this.compositor.render(
        this.renderer,
        this.scene,
        this.camera,
        showViewmodel ? (showShotgun ? this.shotgun.viewScene : this.flashlight.viewScene) : undefined,
        showViewmodel ? (showShotgun ? this.shotgun.viewCamera : this.flashlight.viewCamera) : undefined
      );

      // Este tempo inclui a submissão de desenho, mas não a espera pela GPU:
      // a diferença entre os dois é justamente o que diz onde está o gargalo,
      // e é isso que o governador usa para escolher o que cortar primeiro.
      const cpuMs = performance.now() - cpuStartMs;
      // Com a simulação congelada (pausa solo) o tempo de quadro não mede o
      // custo real do jogo, então o governador fica de fora desse período.
      this.updatePerfFrame(now, realDt * 1000, cpuMs, !soloSimulationPaused);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  /**
   * Acompanha a morte da aranha: dispara o pedido de vitória assim que a queda
   * termina e mantém o relógio da incursão para o resumo final.
   */
  private monitorSpiderDeath(dt: number): void {
    if (!this.victoryShown) this.victoryElapsedSec += dt;
    const dead = this.spider.isDead;
    if (dead && !this.wasSpiderDead) {
      this.wasSpiderDead = true;
      this.victoryPending = true;
      // Aviso curto: a tela cheia só entra depois da animação de morte.
      this.inventory.wakeShortcutsHub(10_000, 'ARANHA DESTRUÍDA · AGUARDE O CORPO CAIR');
    }
    if (this.victoryPending && this.spider.isDeathAnimationComplete) {
      this.victoryPending = false;
      this.showVictoryScreen();
    }
  }

  /** Monta o resumo da incursão e exibe a tela de vitória. */
  private showVictoryScreen(): void {
    if (this.victoryShown || this.disposed || this.activeSequence === 'DEAD_TERMINATED') return;
    this.victoryShown = true;
    getGameConsole().info('jogo', 'Aranha destruída — vitória registrada.');
    this.sound.stopDungeonAtmosphere?.();
    this.sound.winSurvivors?.();
    this.shotgun.stow();
    this.inventory.setPauseMenuHidden(true);
    const survivors = this.multiplayer
      ? this.multiplayer.getSurvivingPlayerNames(this.localPlayerName, false)
      : [this.localPlayerName];
    this.inventory.showVictory({
      survivors,
      totalPlayers: this.multiplayer?.totalRosterCount ?? 1,
      everyoneSurvived: !this.multiplayer || survivors.length >= (this.multiplayer?.totalRosterCount ?? 1),
      elapsedSeconds: this.victoryElapsedSec,
      shots: this.shotgunShotsFired,
    });
    try {
      document.exitPointerLock?.();
    } catch {
      // ignorar
    }
  }

  private updateShotgunObjective(): void {
    const availableParts = this.inventory.getAvailableShotgunParts();
    const found = availableParts.filter(id => this.inventory.hasItem(id)).length;
    const assembled = this.inventory.hasItem(SHOTGUN_ITEM_ID);
    const ammo = this.inventory.getItemCount(SHOTGUN_AMMO_ITEM_ID);
    const text = formatShotgunObjective(
      this.spider.isDead,
      assembled,
      found,
      ammo,
      availableParts.length
    );
    if (this.shotgunObjectiveEl.textContent !== text) this.shotgunObjectiveEl.textContent = text;
    this.shotgunObjectiveEl.classList.toggle('hidden', !this.engaged || this.inventory.open || this.pauseMenu.open || Boolean(this.danceId) || this.activeSequence !== 'NONE');
  }

  /**
   * Sinal tático [V]: marca um ponto à frente da mira por alguns segundos.
   * Tem duração limitada e exige recarga entre os usos — nunca fica fixo.
   */
  private emitTacticalPingFromCamera(): void {
    if (!this.multiplayer) return;
    if (!this.multiplayer.canEmitTacticalPing()) {
      const left = Math.ceil(this.multiplayer.tacticalPingCooldownRemainingSec);
      this.inventory.wakeShortcutsHub(1800, `SINAL RECARREGANDO · ${left}s`);
      return;
    }
    const camDir = new THREE.Vector3(0, 0, -1).applyQuaternion(
      this.camera.quaternion
    );
    this.multiplayer.emitTacticalPing(
      this.camera.position,
      camDir,
      this.spider.position,
      this.elapsed
    );
    this.inventory.wakeShortcutsHub(
      2200,
      `SINAL MARCADO · EXPIRA EM ${TACTICAL_PING_DURATION_SECONDS}s`
    );
  }

  /**
   * Verdadeiro quando existe algo para INTERAGIR na mira (item no chão,
   * caixote lacrado, porta trancada cuja chave você tem).
   *
   * É o que decide se o clique esquerdo e o [E] usam o item da mão ou
   * interagem com o mundo: com algo na frente, interagir ganha sempre.
   */
  /**
   * Usa o item da mão quando NÃO há nada para interagir na mira.
   *
   * Preso na teia, nunca: aí o comando é luta, e perder uma gaze tentando se
   * soltar seria cruel. Devolve true quando o item foi usado, avisando quem
   * chamou que não deve interagir.
   */
  private tryUseHeldItem(): boolean {
    if (this.webManager.isPlayerEnsnared) return false;
    const held = this.inventory.getHeldItem();
    if (!held?.usable) return false;
    if (this.hasInteractableInSight()) return false;
    this.inventory.useHeldItem();
    return true;
  }

  private hasInteractableInSight(): boolean {
    if (this.webManager.isPlayerEnsnared) return false;
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(
      this.camera.quaternion
    );
    if (
      this.worldItems.hasLockedCrateInSight(
        this.position,
        this.camera.position,
        forward
      )
    ) {
      return true;
    }
    if (
      this.worldItems.hasInteractableItemInSight(
        this.position,
        this.camera.position,
        forward
      )
    ) {
      return true;
    }
    if (
      this.multiplayer?.hasTrappedAllyInRescueRange(
        this.position,
        this.spider.position,
        this.inventory.hasItem('rusty_knife')
      )
    ) {
      return true;
    }
    // Porta trancada de sala especial: com a chave na mão, interagir abre a
    // porta — e isso tem de ganhar do clique que usa o item.
    const door = this.specialRoomDoors.findNearbyLockedDoor(this.position, 3.05);
    return Boolean(door && this.inventory.hasItem(door.keyItemId));
  }

  /**
   * [Q] Solta o item da mão no chão, na frente do jogador.
   *
   * Procura o primeiro ponto LIVRE (na frente, depois nos lados, depois aos
   * pés) para o objeto nunca surgir dentro de uma parede, de onde não haveria
   * como pegá-lo de volta. Devolve false quando não há chão livre por perto —
   * e aí o item fica no bolso.
   */
  private dropHeldItemIntoWorld(itemId: string): boolean {
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(
      this.camera.quaternion
    );
    forward.y = 0;
    if (forward.lengthSq() < 1e-6) return false;
    forward.normalize();

    // À frente, à direita, à esquerda e, por último, bem aos pés.
    const right = new THREE.Vector3(-forward.z, 0, forward.x);
    const candidates: THREE.Vector3[] = [
      new THREE.Vector3(
        this.position.x + forward.x * 0.85,
        0,
        this.position.z + forward.z * 0.85
      ),
      new THREE.Vector3(
        this.position.x + right.x * 0.7,
        0,
        this.position.z + right.z * 0.7
      ),
      new THREE.Vector3(
        this.position.x - right.x * 0.7,
        0,
        this.position.z - right.z * 0.7
      ),
      new THREE.Vector3(this.position.x, 0, this.position.z),
    ];

    for (const spot of candidates) {
      const cell = worldToGridCell(spot.x, spot.z);
      if (!isWalkableArenaCell(cell.gx, cell.gz, { ignoreRoomLocks: true })) {
        continue;
      }
      const yaw = Math.atan2(-forward.x, -forward.z) + Math.random() * 0.7 - 0.35;
      return this.worldItems.spawnDroppedItem(itemId, spot.x, spot.z, yaw);
    }
    return false;
  }

  private toggleShotgun(): void {
    if (!this.engaged || this.pauseMenu.open || this.inventory.open || this.activeSequence !== 'NONE' || this.danceMenu.isOpen) return;
    if (!this.inventory.hasItem(SHOTGUN_ITEM_ID)) {
      const availableParts = this.inventory.getAvailableShotgunParts();
      const count = availableParts.filter(id => this.inventory.hasItem(id)).length;
      this.inventory.wakeShortcutsHub(5000, `SHOTGUN ${count}/${availableParts.length} PEÇAS · MONTE NO INVENTÁRIO [TAB]`);
      return;
    }
    if (this.shotgun.isEquipped) {
      this.shotgun.stow();
      this.inventory.wakeShortcutsHub(2500, 'SHOTGUN GUARDADA · [H] EQUIPAR');
    } else {
      this.stopDance('action');
        // As duas mãos passam a segurar a arma: a lanterna avulsa é guardada e
      // vira iluminação acoplada sob o cano.
      if (this.flashlight.isEquipped) this.flashlight.forceStowImmediate();
      this.shotgun.equip();
      this.inventory.wakeShortcutsHub(4500, `SHOTGUN · ${this.inventory.getItemCount(SHOTGUN_AMMO_ITEM_ID)} CARTUCHOS · CLIQUE PARA ATIRAR`);
    }
  }

  private fireShotgun(): void {
    if (!this.engaged || !this.shotgun.isEquipped || this.pauseMenu.open || this.inventory.open || this.inventory.victoryVisible || this.danceMenu.isOpen || this.danceId || this.activeSequence !== 'NONE' || this.multiplayer?.isChatTyping) return;
    const now = performance.now();
    if (now < this.shotgunNextShotMs) return;
    if (!this.inventory.consumeItemById(SHOTGUN_AMMO_ITEM_ID)) {
      this.inventory.wakeShortcutsHub(3500, 'SEM CARTUCHOS · PROCURE MUNIÇÃO NOS CAIXOTES');
      this.sound.invalidInput(); this.shotgunNextShotMs = now + 500; return;
    }
    this.shotgunNextShotMs = now + 700;
    this.shotgun.fire(); this.sound.playShotgunBlast();
    this.shotgunShotsFired += 1;
    const direction = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion).normalize();
    const hit = !this.multiplayer || this.multiplayer.isHost
      ? this.applyShotgunHit(this.camera.position, direction) : false;
    if (this.multiplayer && !this.multiplayer.isHost) this.multiplayer.emitShotgunShot(this.camera.position, direction);
    if (!hit) this.inventory.wakeShortcutsHub(3000, `SHOTGUN · ${this.inventory.getItemCount(SHOTGUN_AMMO_ITEM_ID)} CARTUCHOS`);
  }

  /** Host performs its own intersection and occlusion test; clients never choose damage. */
  private applyShotgunHit(origin: THREE.Vector3, direction: THREE.Vector3): boolean {
    if (this.spider.isDead) return false;
    const distance = shotgunImpactDistance(origin, direction, this.spider.position, this.colliders.map(collider => collider.box));
    if (distance === null) return false;
    if (this.spider.applyShotgunDamage(computeShotgunBlastDamage(distance))) {
      if (this.spider.isDead) this.inventory.wakeShortcutsHub(10000, 'ARANHA DESTRUÍDA!');
      else this.inventory.wakeShortcutsHub(2500, 'ACERTOU A ARANHA!');
      return true;
    }
    return false;
  }

  /** Inicia a captura; no cooperativo a vítima só pode ser resgatada no ninho. */
  private triggerSpiderCatch(overrideSpiderPos?: THREE.Vector3): void {
    if (this.activeSequence !== 'NONE' || this.spider.isDead) return;

    this.suppressReleasePause();
    this.shotgun.stow();
    // A prévia não pode bloquear a cena nem permitir iniciar dança durante a captura.
    this.danceMenu.setOpen(false);
    // A Aranha arrancando o jogador cancela qualquer coreografia em andamento
    this.stopDance('capture');

    const wasLockedInCocoon = this.webManager.isLockedInMultiplayerCocoon;

    this.pauseMenu.setOpen(false, 'main', true);
    this.inventory.setPauseMenuHidden(false);
    this.sound.setWorldPaused(false);
    this.cocoonHudEl.classList.remove('is-visible', 'is-critical');
    this.cocoonDevourTimerSec = 0;
    this.cocoonReturnTriggered = false;
    this.multiplayer?.closeRadioChatInput(false);
    this.inventory.setOpen(false);
    this.keys.clear();
    this.touchControls.resetTransientInputs();
    this.touchCrouchLatched = false;
    this.touchAutoUnlatchAfterSlide = false;
    this.desktopCrouchLatched = false;
    this.desktopAutoUnlatchAfterSlide = false;
    this.desktopSprintLatched = false;
    this.pendingAbductionLairNotify = false;
    this.velocity.set(0, 0, 0);
    this.slideState.isSliding = false;
    this.slideState.slideAmount = 0;
    this.slideState.wasHoldingCtrl = false;
    this.slideState.wasSprinting = false;
    this.webManager.clearEnsnarement();

    // Derruba imediatamente a lanterna / itens em 1ª pessoa para que o jogador não fique segurando nada desmaiado!
    this.flashlight.beginKnockoutDrop();
    this.sharedUniforms.uFlashlightIntensity.value = 0;

    this.strikeOriginPos.copy(this.position);

    const spiderSource = overrideSpiderPos ?? this.spider.position;
    const rawDist = Math.hypot(
      spiderSource.x - this.position.x,
      spiderSource.z - this.position.z
    );
    const toSpider = new THREE.Vector3()
      .subVectors(spiderSource, this.position)
      .setY(0);
    if (toSpider.lengthSq() < 0.01) {
      toSpider.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    } else {
      toSpider.normalize();
    }

    // Garante que a posição do bote jamais jogue o corpo da Aranha para trás através de uma parede!
    const desiredStrikeDist = Math.min(1.44, Math.max(0.96, rawDist));
    let safeStrikeDist = 0.92;
    for (let d = 0.72; d <= desiredStrikeDist + 0.001; d += 0.12) {
      const px = this.position.x + toSpider.x * d;
      const pz = this.position.z + toSpider.z * d;
      let hitWall = false;
      for (let i = 0; i < this.colliders.length; i++) {
        if (this.colliders[i].isCrawlUnder) continue;
        const b = this.colliders[i].box;
        if (b.max.y < 0.5) continue;
        const cx = Math.max(b.min.x, Math.min(px, b.max.x));
        const cz = Math.max(b.min.z, Math.min(pz, b.max.z));
        const ox = px - cx;
        const oz = pz - cz;
        if (ox * ox + oz * oz < 0.52 * 0.52) {
          hitWall = true;
          break;
        }
      }
      if (hitWall) break;
      safeStrikeDist = d;
    }

    this.strikeSpiderPos
      .copy(this.position)
      .addScaledVector(toSpider, safeStrikeDist)
      .setY(1.38);

    // Gira o olhar para encarar a aranha gigante no instante do bote!
    this.yaw = Math.atan2(-toSpider.x, -toSpider.z);

    // Inicializa imediatamente a física Verlet 3D de Ragdoll desmaiado + rota real pelos corredores até o Ninho!
    this.localRagdoll.spawnFromStandingAndCollapse(
      this.strikeOriginPos,
      this.yaw,
      this.strikeSpiderPos
    );
    this.dragPath = computeWalkableDragPolyline(
      this.strikeOriginPos,
      this.webManager.lairCenter
    );

    this.seqTime = 0;
    this.seqStagedWake = false;
    this.seqGaspPlayed = false;
    this.lastDragPullStep = -1;
    this.lastWebSpinStep = -1;

    // Um operador à beira da morte não é arrastado para a teia: o bote o executa
    // ali mesmo. Vale em solo e no cooperativo — antes, no co-op, todo mundo era
    // levado ao Ninho, mesmo sangrando com pouquíssima vida.
    const shouldAbductToWeb =
      resolveSpiderCaptureOutcome(this.playerHealth, { lockedInCocoon: wasLockedInCocoon }) ===
      'ABDUCTION_TO_WEB';

    if (shouldAbductToWeb) {
      this.activeSequence = 'ABDUCTION_TO_WEB';
      this.syncInventoryVitals();
      this.sound.playSpiderBrutalAttack();
    } else {
      this.activeSequence = 'PERMADEATH_EXECUTION';
      this.playerHealth = 0;
      this.playerBleeding = true;
      // Em cooperativo os aliados precisam ver o corpo no chão e saber que ele
      // não volta: a execução é anunciada como morte para a sala inteira.
      this.multiplayer?.notifyLocalPlayerDevoured();
      this.multiplayer?.pushHudNotice(
        wasLockedInCocoon
          ? '🕸️ A ARANHA DEVOROU VOCÊ NO NINHO.'
          : '💀 SEM FÔLEGO PARA O ARRASTO: A ARANHA EXECUTOU VOCÊ NO CORREDOR.'
      );
      this.syncInventoryVitals();
      this.sound.playPermanentDeath();
    }
  }

  private syncDroppedFlashlightBeam(dropFl: {
    beamIntensity: number;
    aimYawOffset: number;
    aimPitchOffset: number;
  }): void {
    this.sharedUniforms.uFlashlightIntensity.value = dropFl.beamIntensity;
    if (dropFl.beamIntensity > 0.005) {
      const camRight = new THREE.Vector3(1, 0, 0).applyQuaternion(
        this.camera.quaternion
      );
      const camUp = new THREE.Vector3(0, 1, 0).applyQuaternion(
        this.camera.quaternion
      );
      this.sharedUniforms.uFlashlightPos.value
        .copy(this.camera.position)
        .addScaledVector(camRight, 0.22)
        .addScaledVector(camUp, -0.22);

      const beamEuler = new THREE.Euler(
        this.pitch + dropFl.aimPitchOffset,
        this.yaw + dropFl.aimYawOffset,
        this.roll,
        'YXZ'
      );
      this.sharedUniforms.uFlashlightDir.value
        .set(0, 0, -1)
        .applyEuler(beamEuler)
        .normalize();
    }
  }

  /**
   * Interrompe imediatamente o sequestro/arrasto quando um aliado usa Sinalizador ou Faca perto da Aranha,
   * devolvendo o controle ao jogador no próprio corredor sem levá-lo ao ninho!
   */
  private abortAbductionByAllyRescue(): void {
    if (
      this.activeSequence !== 'ABDUCTION_TO_WEB' &&
      !(this.activeSequence === 'PERMADEATH_EXECUTION' && this.seqTime < 1.45)
    ) {
      return;
    }

    if (this.permadeathTimerId) {
      window.clearTimeout(this.permadeathTimerId);
      this.permadeathTimerId = 0;
    }

    this.activeSequence = 'NONE';
    this.seqTime = 0;
    this.pendingAbductionLairNotify = false;
    this.currentAbductionMode = null;
    this.currentAbductionProgress = 0;
    this.cocoonDevourTimerSec = 0;
    this.cocoonReturnTriggered = false;
    this.cocoonHudEl.classList.remove('is-visible', 'is-critical');
    this.localRagdoll.resetInactive();
    this.webManager.clearEnsnarement();
    this.spider.interruptAbductionAndFlee(this.position);
    this.inventory.setAbductionScreenFX(0, 0, 0, 0);

    this.roll = 0;
    this.pitch = 0;
    this.cameraShake = 0.06;
    this.setCameraFov(this.settingsStore.value.fov);
    this.playerHealth = Math.max(this.playerHealth, 38);
    this.playerSanity = Math.max(this.playerSanity, 40);
    boostPlayerStamina(this.staminaState, 65);
    this.astronaut.updateFirstPersonBody(
      this.position,
      this.yaw,
      this.bobPhase,
      0,
      this.crouchAmount,
      this.flashlight.isEquipped,
      this.flashlight.isLeftArmAnimating
    );
    this.sound.playWakeUpGasp();
    this.syncInventoryVitals();
    this.syncCamera(0);
  }

  private applyCollisionSafeRagdollView(
    spiderFocusPos: THREE.Vector3,
    rollTilt = 0
  ): void {
    computeCollisionSafeRagdollCamera(
      this.localRagdoll,
      spiderFocusPos,
      this.colliders,
      this.ragdollCamPosScratch,
      this.ragdollLookAtScratch
    );
    const dx = this.ragdollLookAtScratch.x - this.ragdollCamPosScratch.x;
    const dy = this.ragdollLookAtScratch.y - this.ragdollCamPosScratch.y;
    const dz = this.ragdollLookAtScratch.z - this.ragdollCamPosScratch.z;
    const horiz = Math.max(0.001, Math.hypot(dx, dz));
    this.yaw = Math.atan2(-dx, -dz);
    this.pitch = Math.max(-0.85, Math.min(0.85, Math.atan2(dy, horiz)));
    this.roll = rollTilt;
    this.syncCustomSequenceCamera(
      this.ragdollCamPosScratch,
      this.ragdollCamPosScratch.y
    );
  }

  /**
   * Executa quadro a quadro a cena física e visceral de Captura:
   * 1) Ataque brutal -> Jogador desmaia e vira Ragdoll Verlet 3D no chão + Aranha lança seus 4 Tentáculos
   * 2) Visão turva de desmaio enquanto os Tentáculos envolvem botas, cintura e tórax do Ragdoll
   * 3) Aranha puxa o Ragdoll desmaiado pelos corredores reais até o Ninho de Teia usando os Tentáculos
   * 4) Tentáculos erguem e prendem o Ragdoll dentro da Teia do Ninho enquanto a Aranha tece o casulo
   * 5) Despertar preso na Teia (em Multiplayer fica 100% imobilizado até um amigo salvá-lo antes de ser devorado!)
   */
  private updateHorrorSequence(dt: number): void {
    const simDt = Math.max(0.001, dt);
    this.seqTime += dt;
    const t = this.seqTime;
    const dropFl = this.flashlight.updateKnockoutDrop(dt, this.lanternBattery);
    if (t >= 0.42) {
      this.flashlight.forceStowImmediate();
    }

    if (this.activeSequence === 'PERMADEATH_EXECUTION') {
      const u = Math.min(1, t / 1.45);
      if (dt > 0) {
        this.localRagdoll.stepKnockoutCollapse(
          simDt,
          this.strikeSpiderPos,
          Math.min(1, u * 1.4),
          this.colliders
        );
      }
      this.astronaut.applyRagdollPose(this.localRagdoll, false);
      const hooks = this.localRagdoll.getTentacleAttachmentPoints();
      const slash =
        t < 0.35
          ? 1.0 - t / 0.35
          : t < 0.7
            ? Math.max(0, 0.85 - (t - 0.35) * 2.4)
            : 0;
      const lid = Math.min(1, Math.pow(t / 1.15, 1.5));
      const black = Math.max(0, Math.min(0.92, (t - 0.55) / 0.85));

      this.inventory.setAbductionScreenFX(slash, lid, black, 0);

      const eyeY = 1.62 * (1 - u) + 0.22 * u;
      this.pitch = 0.38 * u;
      this.roll = -0.32 * u;
      this.cameraShake = 0.14 * (1 - u * 0.5);
      this.setCameraFov(74 + Math.sin(u * Math.PI) * 14);

      this.currentAbductionMode = 'FATAL_EXECUTION';
      this.currentAbductionProgress = u;
      this.currentAbductionSpiderPos.copy(this.strikeSpiderPos);
      this.spider.updateCinematicSequence(
        simDt,
        this.elapsed,
        'FATAL_EXECUTION',
        u,
        this.strikeSpiderPos,
        this.strikeOriginPos,
        this.localRagdoll.pelvisPos,
        hooks
      );

      this.syncCustomSequenceCamera(this.strikeOriginPos, eyeY);
      this.syncDroppedFlashlightBeam(dropFl);

      if (t >= 1.5) {
        this.flashlight.forceStowImmediate();
        this.sharedUniforms.uFlashlightIntensity.value = 0;
        this.localRagdoll.resetInactive();
        this.activeSequence = 'DEAD_TERMINATED';
        this.setCameraFov(this.settingsStore.value.fov);
        try {
          document.exitPointerLock?.();
        } catch {
          // ignorar
        }
        if (this.multiplayer) {
          // No Co-op, a morte encerra o controle local, mas não expulsa o
          // operador da sala: ele passa a assistir os sobreviventes.
          this.enterSpectatorMode();
        } else {
          this.inventory.showGameOver();
          this.permadeathTimerId = window.setTimeout(() => {
            this.finalizePermanentDeath();
          }, 3800);
        }
      }
      return;
    }

    if (this.activeSequence !== 'ABDUCTION_TO_WEB') {
      this.sharedUniforms.uFlashlightIntensity.value = 0;
      return;
    }

    if (!this.dragPath) {
      this.dragPath = computeWalkableDragPolyline(
        this.strikeOriginPos,
        this.webManager.lairCenter
      );
    }
    const activeDragPath = this.dragPath;

    // ------------------------------------------------------------------------
    // ESTÁGIO 1 (0.00s -> 2.15s): BOTE BRUTAL, CAPTURA EM CURSO & TENTÁCULOS AGARRANDO!
    // ------------------------------------------------------------------------
    if (t < 2.15) {
      const u = t / 2.15;
      const lungePos = new THREE.Vector3()
        .copy(this.strikeSpiderPos)
        .lerp(
          new THREE.Vector3(
            this.strikeOriginPos.x,
            1.28,
            this.strikeOriginPos.z
          ),
          0.22 * Math.sin(u * Math.PI)
        );
      const tentacleGrab = u > 0.28 ? (u - 0.28) / 0.72 : 0;
      if (dt > 0) {
        this.localRagdoll.stepKnockoutCollapse(
          simDt,
          lungePos,
          tentacleGrab,
          this.colliders
        );
      }
      this.astronaut.applyRagdollPose(this.localRagdoll, false);
      const hooks = this.localRagdoll.getTentacleAttachmentPoints();

      const slashA = t < 0.28 ? 1 - t / 0.28 : 0;
      const slashB =
        t >= 0.18 && t < 0.55 ? 0.92 * (1 - (t - 0.18) / 0.37) : 0;
      const slash = Math.max(slashA, slashB);

      const lid = u > 0.45 ? (u - 0.45) / 0.55 : 0;
      const black = u > 0.72 ? (u - 0.72) / 0.28 : 0;

      this.inventory.setAbductionScreenFX(slash, lid * 0.9, black * 0.58, 0);

      const fallEase = 1 - Math.pow(1 - u, 2.4);
      this.cameraShake = 0.13 * (1 - u * 0.65);
      this.setCameraFov(74 + Math.sin(u * Math.PI) * 14);

      this.currentAbductionMode = 'STRIKE_ATTACK';
      this.currentAbductionProgress = u;
      this.currentAbductionSpiderPos.copy(lungePos);
      this.spider.updateCinematicSequence(
        simDt,
        this.elapsed,
        'STRIKE_ATTACK',
        u,
        lungePos,
        this.strikeOriginPos,
        this.localRagdoll.pelvisPos,
        hooks
      );

      computeCollisionSafeRagdollCamera(
        this.localRagdoll,
        lungePos,
        this.colliders,
        this.ragdollCamPosScratch,
        this.ragdollLookAtScratch
      );
      const standCam = new THREE.Vector3(
        this.strikeOriginPos.x,
        1.62,
        this.strikeOriginPos.z
      );
      standCam.lerp(this.ragdollCamPosScratch, fallEase);
      const dx = lungePos.x - standCam.x;
      const dy = lungePos.y * 0.78 - standCam.y;
      const dz = lungePos.z - standCam.z;
      this.yaw = Math.atan2(-dx, -dz);
      this.pitch =
        Math.atan2(dy, Math.max(0.01, Math.hypot(dx, dz))) * fallEase +
        Math.sin(t * 26) * 0.05 * (1 - u);
      this.roll = 0.24 * fallEase;

      this.syncCustomSequenceCamera(standCam, standCam.y);
      this.syncDroppedFlashlightBeam(dropFl);
      return;
    }

    // A partir do desmaio/arrasto/casulo/despertar, garante que o foco e o modelo 3D estejam 100% desligados e guardados!
    this.flashlight.forceStowImmediate();
    this.sharedUniforms.uFlashlightIntensity.value = 0;

    // ------------------------------------------------------------------------
    // ESTÁGIO 2 (2.15s -> 2.85s): DESMAIO & TENTÁCULOS TENSIONANDO O RAGDOLL
    // ------------------------------------------------------------------------
    if (t < 2.85) {
      const u = (t - 2.15) / 0.7;
      this.inventory.setAbductionScreenFX(
        0,
        0.88 + 0.1 * Math.min(1, u * 1.8),
        0.55 + 0.35 * Math.min(1, u * 1.6),
        0
      );

      sampleDragPolyline(
        activeDragPath,
        0.04 * activeDragPath.totalLength,
        this.ragdollPathPosScratch,
        this.ragdollPathTanScratch
      );
      const spiderStartPos = new THREE.Vector3(
        this.ragdollPathPosScratch.x + this.ragdollPathTanScratch.x * 1.85,
        1.38,
        this.ragdollPathPosScratch.z + this.ragdollPathTanScratch.z * 1.85
      );
      resolveCylinderWorldCollisions(
        spiderStartPos,
        new THREE.Vector3(),
        0.48,
        1.6,
        this.colliders
      );
      spiderStartPos.y = 1.38;

      if (dt > 0) {
        this.localRagdoll.stepTentacleDrag(
          simDt,
          spiderStartPos,
          this.ragdollPathPosScratch,
          0.35 * u,
          this.colliders
        );
      }
      const pelvis = this.localRagdoll.pelvisPos;
      this.position.set(pelvis.x, 0, pelvis.z);
      this.astronaut.applyRagdollPose(this.localRagdoll, false);
      const hooks = this.localRagdoll.getTentacleAttachmentPoints();

      this.currentAbductionMode = 'DRAGGING_TO_WEB';
      this.currentAbductionProgress = 0;
      this.currentAbductionSpiderPos.copy(spiderStartPos);
      this.spider.updateCinematicSequence(
        simDt,
        this.elapsed,
        'DRAGGING_TO_WEB',
        0,
        spiderStartPos,
        this.position,
        pelvis,
        hooks
      );
      this.setCameraFov(69);
      this.applyCollisionSafeRagdollView(spiderStartPos, -0.08 * u);
      return;
    }

    // ------------------------------------------------------------------------
    // ESTÁGIO 3 (2.85s -> 6.05s): TENTÁCULOS PUXANDO O RAGDOLL PELOS CORREDORES ATÉ A TEIA!
    // ------------------------------------------------------------------------
    if (t < 6.05) {
      const u = (t - 2.85) / 3.2;
      const pullCycles = u * 5.0;
      const pullStep = Math.floor(pullCycles);
      if (pullStep !== this.lastDragPullStep) {
        this.lastDragPullStep = pullStep;
        this.sound.playBodyDragPull();
      }
      const frac = pullCycles - pullStep;
      const pullWave = 0.5 + 0.5 * Math.sin(frac * Math.PI);
      const steppedU = Math.min(
        1,
        (pullStep + frac * frac * (3 - 2 * frac)) / 5.0
      );

      sampleDragPolyline(
        activeDragPath,
        steppedU * activeDragPath.totalLength,
        this.ragdollPathPosScratch,
        this.ragdollPathTanScratch
      );

      const lateralSway = Math.sin(t * 2.2) * 0.08;
      const spiderLead = Math.min(1, steppedU + 0.14);
      const spiderPathPt = new THREE.Vector3();
      const spiderTan = new THREE.Vector3();
      sampleDragPolyline(
        activeDragPath,
        spiderLead * activeDragPath.totalLength,
        spiderPathPt,
        spiderTan
      );
      const spiderDragPos = new THREE.Vector3(
        spiderPathPt.x +
          spiderTan.x * (1 - steppedU) * 1.15 -
          spiderTan.z * lateralSway,
        1.38 + pullWave * 0.04,
        spiderPathPt.z +
          spiderTan.z * (1 - steppedU) * 1.15 +
          spiderTan.x * lateralSway
      );
      if (
        Math.hypot(
          spiderDragPos.x - this.ragdollPathPosScratch.x,
          spiderDragPos.z - this.ragdollPathPosScratch.z
        ) < 1.35
      ) {
        spiderDragPos.x =
          this.ragdollPathPosScratch.x + this.ragdollPathTanScratch.x * 1.55;
        spiderDragPos.z =
          this.ragdollPathPosScratch.z + this.ragdollPathTanScratch.z * 1.55;
      }
      resolveCylinderWorldCollisions(
        spiderDragPos,
        new THREE.Vector3(),
        0.46,
        1.6,
        this.colliders
      );
      spiderDragPos.y = 1.38 + pullWave * 0.04;

      if (dt > 0) {
        this.localRagdoll.stepTentacleDrag(
          simDt,
          spiderDragPos,
          this.ragdollPathPosScratch,
          pullWave,
          this.colliders
        );
      }
      const pelvis = this.localRagdoll.pelvisPos;
      this.position.set(pelvis.x, 0, pelvis.z);
      this.astronaut.applyRagdollPose(this.localRagdoll, u > 0.55);
      const hooks = this.localRagdoll.getTentacleAttachmentPoints();

      const openFadeIn = Math.min(1, u / 0.16);
      const midBlink = Math.exp(-Math.pow((u - 0.54) / 0.08, 2)) * 0.48;
      const lidClosed = 1 - openFadeIn * 0.72 + midBlink;
      const black = Math.max(0.05, (1 - openFadeIn) * 0.78 + midBlink * 0.34);

      this.inventory.setAbductionScreenFX(
        0,
        Math.min(1, lidClosed),
        Math.min(1, black),
        u > 0.76 ? ((u - 0.76) / 0.24) * 0.32 : 0
      );

      this.cameraShake = 0.022;
      this.setCameraFov(70);

      this.currentAbductionMode = 'DRAGGING_TO_WEB';
      this.currentAbductionProgress = u;
      this.currentAbductionSpiderPos.copy(spiderDragPos);
      this.spider.updateCinematicSequence(
        simDt,
        this.elapsed,
        'DRAGGING_TO_WEB',
        u,
        spiderDragPos,
        this.position,
        pelvis,
        hooks
      );

      this.applyCollisionSafeRagdollView(
        spiderDragPos,
        -0.1 + Math.sin(pullCycles * Math.PI * 2) * 0.045
      );
      this.sound.playTensionHeartbeat(0.75);
      return;
    }

    // ------------------------------------------------------------------------
    // ESTÁGIO 4 (6.05s -> 7.25s): TENTÁCULOS PRENDENDO O RAGDOLL NA TEIA & TECENDO CASULO!
    // ------------------------------------------------------------------------
    if (t < 7.25) {
      const u = (t - 6.05) / 1.2;
      const dragDir = this.webManager.dragDirection;
      this.position.copy(this.webManager.lairCenter);
      const spiderOverLair = new THREE.Vector3(
        this.position.x + dragDir.x * 1.15,
        1.36,
        this.position.z + dragDir.z * 1.15
      );

      if (dt > 0) {
        this.localRagdoll.stepWebPlacementLift(
          simDt,
          this.webManager.lairCenter,
          spiderOverLair,
          u,
          this.colliders
        );
      }
      const pelvis = this.localRagdoll.pelvisPos;
      this.astronaut.applyRagdollPose(this.localRagdoll, true);
      const hooks = this.localRagdoll.getTentacleAttachmentPoints();

      const spinStep = Math.floor(u * 4);
      if (spinStep !== this.lastWebSpinStep) {
        this.lastWebSpinStep = spinStep;
        this.sound.playSpiderWebSpin(0, 1.0);
      }

      const closeOut = u > 0.58 ? (u - 0.58) / 0.42 : 0;
      const lidClosed = 0.32 + closeOut * 0.68;
      const black = 0.1 + closeOut * 0.88;
      const cocoon = 0.32 + u * 0.56;

      this.inventory.setAbductionScreenFX(0, lidClosed, black, cocoon);
      this.cameraShake = 0.015;

      this.currentAbductionMode = 'WEBBING_IN_LAIR';
      this.currentAbductionProgress = u;
      this.currentAbductionSpiderPos.copy(spiderOverLair);
      this.spider.updateCinematicSequence(
        simDt,
        this.elapsed,
        'WEBBING_IN_LAIR',
        u,
        spiderOverLair,
        this.position,
        pelvis,
        hooks
      );

      this.applyCollisionSafeRagdollView(spiderOverLair, -0.06 * (1 - u));
      return;
    }

    // ------------------------------------------------------------------------
    // ESTÁGIO 5 (7.25s -> 8.55s): DESPERTAR PRESO NA TEIA DO NINHO!
    // ------------------------------------------------------------------------
    this.localRagdoll.resetInactive();
    this.astronaut.updateSupineAbductionPose(this.position, this.yaw, 0, false);
    if (!this.seqStagedWake) {
      this.seqStagedWake = true;
      this.currentAbductionMode = null;
      this.currentAbductionProgress = 0;
      const isCoop = Boolean(this.multiplayer);
      if (this.multiplayer) {
        const observers = this.multiplayer.getObserverWorldPositions(
          this.position,
          this.multiplayer.localPlayerId
        );
        this.spider.finishAbductionRetreat(observers);
        this.pendingAbductionLairNotify = true;
        this.cocoonDevourMaxSec = this.multiplayer.hasLivingAllies() ? 45 : 14;
        this.cocoonDevourTimerSec = this.cocoonDevourMaxSec;
        this.cocoonReturnTriggered = false;
        this.multiplayer.pushHudNotice(
          `🕸️ VOCÊ ESTÁ PRESO NA TEIA DO NINHO! Seus amigos precisam cortá-la [E / Faca] em ${this.cocoonDevourMaxSec}s antes da Aranha devorar você!`
        );
      } else {
        this.spider.relocateAwayAfterAbduction();
      }
      this.webManager.placePlayerInWakingLairWeb(isCoop);
      if (this.pendingAbductionLairNotify && this.multiplayer) {
        this.pendingAbductionLairNotify = false;
        this.multiplayer.notifyLocalAbductionFinished();
        this.maybeStartSquadDevouredSequence();
      }
      this.playerHealth = 22;
      this.playerBleeding = true;
      this.playerSanity = 25;
      boostPlayerStamina(this.staminaState, 80);
      const dragDir = this.webManager.dragDirection;
      this.yaw = Math.atan2(dragDir.x, dragDir.z);
      this.syncInventoryVitals();
    }

    if (!this.seqGaspPlayed) {
      this.seqGaspPlayed = true;
      this.sound.playWakeUpGasp();
    }

    const uWake = Math.min(1, (t - 7.25) / 1.3);
    const wakeEase = uWake * uWake * (3 - 2 * uWake);

    const lidClosed = Math.max(0, 1 - wakeEase * 1.15);
    const black = Math.max(0, 1 - wakeEase * 1.35);
    const cocoon = 0.85;

    this.inventory.setAbductionScreenFX(0, lidClosed, black, cocoon);

    const eyeY = 0.32 + (this.standingEyeHeight - 0.32) * wakeEase;
    this.pitch = -0.22 * (1 - wakeEase);
    this.roll = 0.14 * Math.sin(uWake * Math.PI) * (1 - wakeEase);
    this.setCameraFov(68 + 6 * wakeEase);

    this.syncCustomSequenceCamera(this.position, eyeY);
    this.sound.playTensionHeartbeat(0.85);

    if (t >= 8.55) {
      this.activeSequence = 'NONE';
      this.spider.ensureExitedCinematic(
        this.multiplayer?.getObserverWorldPositions(
          this.position,
          this.multiplayer.localPlayerId
        )
      );
      this.roll = 0;
      this.setCameraFov(this.settingsStore.value.fov);
      this.astronaut.updateFirstPersonBody(
        this.position,
        this.yaw,
        this.bobPhase,
        0,
        this.crouchAmount,
        this.flashlight.isEquipped,
        this.flashlight.isLeftArmAnimating
      );
      this.inventory.setAbductionScreenFX(
        0,
        0,
        0,
        this.webManager.getWakingLairSilkFactor(this.position)
      );
      this.syncInventoryVitals();
    }
  }

  /**
   * Fim de partida no cooperativo: não há mais ninguém solto no complexo.
   * O anfitrião confirma e a sala toda entra na cena final de devoração.
   */
  private maybeStartSquadDevouredSequence(): void {
    if (!this.multiplayer || this.squadDevouredActive) return;
    if (this.inventory.gameOverVisible || this.inventory.victoryVisible) return;
    if (!this.multiplayer.checkSquadCaptured()) return;
    this.beginSquadDevouredSequence(
      this.multiplayer.localPlayerId,
      this.multiplayer.firstCaptiveName
    );
  }

  /**
   * Cena final: o Ninho está cheio. A Aranha come um por um na frente dos
   * outros presos e o esquadrão inteiro perde. Todos os clientes rodam a mesma
   * cena (mesma duração), sem depender de mais pacotes.
   */
  private beginSquadDevouredSequence(victimId: string, victimName: string): void {
    if (this.squadDevouredActive || this.disposed) return;
    this.squadDevouredActive = true;
    this.squadDevouredTime = 0;
    this.squadDevouredFinalized = false;
    this.sound.playSpiderBrutalAttack();
    this.sound.playTensionHeartbeat(0.95);
    if (this.multiplayer) {
      this.multiplayer.pushHudNotice(
        `🕷️ O NINHO ESTÁ CHEIO! A Aranha vai DEVORAR ${victimName} enquanto vocês estão amarrados na teia...`
      );
    }
    this.cocoonHudEl.classList.remove('is-visible', 'is-critical');
    this.inventory.setOpen(false);
    this.pauseMenu.setOpen(false, 'main', true);
    this.keys.clear();
    this.touchControls.resetTransientInputs();
    this.shotgun.stow();
    this.stopDance('capture');
    void victimId;
  }

  /** Roda os ~4,2 s finais: seda descendo, escurecimento e o fim da partida. */
  private updateSquadDevouredSequence(dt: number): void {
    if (!this.squadDevouredActive || this.squadDevouredFinalized) return;
    this.squadDevouredTime += dt;
    const t = this.squadDevouredTime;
    if (t < 0.35) {
      this.cameraShake = 0.12;
    } else {
      this.cameraShake = Math.max(0.02, this.cameraShake * Math.exp(-4 * dt));
    }
    const u = Math.max(0, Math.min(1, (t - 0.35) / 2.2));
    const cocoon = Math.min(1, 0.55 + u * 0.45);
    this.inventory.setAbductionScreenFX(
      0,
      Math.min(1, 0.25 + u * 0.75),
      Math.min(1, 0.05 + u * 0.88),
      cocoon
    );
    this.sound.playTensionHeartbeat(Math.min(1, 0.85 + u * 0.15));
    if (t >= 3.4) {
      this.squadDevouredFinalized = true;
      this.squadDevouredActive = false;
      this.finishSquadDevoured();
    }
  }

  private finishSquadDevoured(): void {
    if (this.disposed) return;
    this.inventory.setAbductionScreenFX(0, 0, 0, 0);
    this.cameraShake = 0;
    this.setCameraFov(this.settingsStore.value.fov);
    this.touchControls.syncState({
      overlayBlocked: true,
      inCaptureSequence: true,
      isSprinting: false,
      isCrouchedOrSliding: false,
      canTriggerSlide: false,
      interactContext: 'NONE',
      inMultiplayer: Boolean(this.multiplayer),
      isPushToTalkActive: false,
    });
    this.inventory.showGameOver({
      title: 'O ninho está cheio',
      sub: 'A Aranha amarrou o esquadrão inteiro na teia e devorou um por um. Não sobrou ninguém para cortar os fios.',
      note: 'fim da partida — o esquadrão foi capturado',
    });
    if (this.permadeathTimerId) window.clearTimeout(this.permadeathTimerId);
    this.permadeathTimerId = window.setTimeout(() => {
      this.finalizePermanentDeath();
    }, 4200);
  }

  private setCameraFov(fov: number): void {
    this.currentBaseDesktopFov = fov;
    const adaptedFov = computeAdaptiveVerticalFov(
      this.camera.aspect,
      fov,
      fov + 24
    );
    if (Math.abs(this.camera.fov - adaptedFov) > 0.05) {
      this.camera.fov = adaptedFov;
      this.camera.updateProjectionMatrix();
    }
  }

  private syncCustomSequenceCamera(pos: THREE.Vector3, eyeY: number): void {
    const shakeScale = this.settingsStore.value.screenShakeIntensity / 100;
    const shakeX =
      this.cameraShake > 0.001
        ? (Math.random() - 0.5) * 2 * this.cameraShake * shakeScale
        : 0;
    const shakeY =
      this.cameraShake > 0.001
        ? (Math.random() - 0.5) * 2 * this.cameraShake * shakeScale
        : 0;

    this.camera.position.set(pos.x + shakeX, eyeY + shakeY, pos.z);
    const euler = new THREE.Euler(this.pitch, this.yaw, this.roll, 'YXZ');
    this.camera.quaternion.setFromEuler(euler);
  }

  /** Só registra a mudança de humor da aranha, não cada quadro em que ela caça. */
  private trackSpiderActivity(): void {
    const hunting = this.spider.isDead ? false : this.spider.isChasingOrAlert;
    if (hunting === this.spiderHuntingLogged) return;
    this.spiderHuntingLogged = hunting;
    getGameConsole().info(
      'jogo',
      hunting
        ? 'A aranha percebeu o esquadrão e começou a caçar.'
        : this.spider.isDead
          ? 'A aranha caiu — a ameaça acabou.'
          : 'A aranha perdeu o rastro e voltou a patrulhar.'
    );
  }

  private update(dt: number): void {
    if (!this.engaged || this.disposed) return;

    this.trackSpiderActivity();

    const ambientCell = worldToGridCell(this.position.x, this.position.z);
    this.sound.setDoomAmbientZone(this.ambientZoneTracker.update(ambientCell.gx, ambientCell.gz, dt));
    this.updateShotgunObjective();
    this.monitorSpiderDeath(dt);
    if (this.inventory.victoryVisible) {
      // Com a tela de vitória na frente o mundo congela: nada de andar, atirar
      // ou ser pego enquanto o esquadrão respira.
      this.touchControls.syncState({
        overlayBlocked: true,
        inCaptureSequence: true,
        isSprinting: false,
        isCrouchedOrSliding: false,
        canTriggerSlide: false,
        interactContext: 'NONE',
        inMultiplayer: Boolean(this.multiplayer),
        isPushToTalkActive: false,
      });
      return;
    }
    const isLocalAfk = this.refreshLocalAfkStatus();

    if (this.spectatorMode) {
      this.updateSpectatorMode(dt);
      return;
    }

    if (this.activeSequence === 'DEAD_TERMINATED') {
      this.touchControls.syncState({
        overlayBlocked: true,
        inCaptureSequence: true,
        isSprinting: false,
        isCrouchedOrSliding: false,
        canTriggerSlide: false,
        interactContext: 'NONE',
        inMultiplayer: Boolean(this.multiplayer),
        isPushToTalkActive: false,
      });
      return;
    }

    this.elapsed += dt;
    this.specialRoomDoors.update(dt);

    // Anfitrião confere a cada quadro se o Ninho encheu (todos os vivos
    // amarrados). Quem está preso não joga mais, então a checagem precisa rodar
    // aqui e não só quando alguém entra no casulo.
    if (this.multiplayer?.isHost && !this.inventory.gameOverVisible) {
      this.maybeStartSquadDevouredSequence();
    }

    // Fim de partida cooperativo: o Ninho está cheio e a Aranha devora o
    // esquadrão. Nada mais importa enquanto a cena roda.
    if (this.squadDevouredActive) {
      this.updateSquadDevouredSequence(dt);
      this.updateFlickeringLightsAndAudio();
      return;
    }

    if (this.activeSequence !== 'NONE') {
      this.doorLockPromptEl.classList.remove('is-visible', 'can-unlock');
      this.cocoonHudEl.classList.remove('is-visible', 'is-critical');
      this.interactQueued = false;
      this.struggleQueued = false;
      this.touchControls.consumeLookDelta();
      this.touchControls.syncState({
        overlayBlocked: this.inventory.gameOverVisible,
        inCaptureSequence: true,
        isSprinting: false,
        isCrouchedOrSliding: false,
        canTriggerSlide: false,
        interactContext: 'NONE',
        inMultiplayer: Boolean(this.multiplayer),
        isPushToTalkActive: Boolean(this.multiplayer?.localVoiceSpeaking),
      });
      this.updateHorrorSequence(dt);
      const beingDragged = this.currentAbductionMode === 'DRAGGING_TO_WEB';
      this.multiplayer?.update(
        dt,
        this.elapsed,
        this.camera,
        {
          pos: this.position,
          yaw: this.yaw,
          pitch: this.pitch,
          speed: 0,
          bobPhase: this.bobPhase,
          crouch: this.crouchAmount,
          flashlightOn: false,
          flashDir: this.sharedUniforms.uFlashlightDir.value,
          health: this.playerHealth,
          bleeding: this.playerBleeding,
          ensnared:
            this.currentAbductionMode === 'WEBBING_IN_LAIR' ||
            this.seqTime >= 7.25,
          cocoonLocked: Boolean(this.multiplayer) && this.seqTime >= 7.25,
          devourSecondsLeft: this.cocoonDevourTimerSec,
          walkieTalkieActive:
            this.walkieTalkieActive &&
            this.inventory.hasItem('field_walkie_talkie'),
          inSequence: this.seqTime < 7.25,
          beingDragged,
          danceId: this.danceId,
          danceTime: this.danceTime,
          abductionMode: this.currentAbductionMode,
          abductionProgress: this.currentAbductionProgress,
          abductionSpiderPos: this.currentAbductionSpiderPos,
          dead:
            this.activeSequence === 'PERMADEATH_EXECUTION' ||
            this.spectatorMode,
          afk: isLocalAfk,
        },
        this.spider.getNetworkSnapshot(this.multiplayer?.localPlayerId ?? null),
        true
      );
      this.updateFlickeringLightsAndAudio();
      return;
    }

    if (this.inventory.gameOverVisible) {
      this.doorLockPromptEl.classList.remove('is-visible', 'can-unlock');
      this.interactQueued = false;
      this.struggleQueued = false;
      this.touchControls.consumeLookDelta();
      this.touchControls.syncState({
        overlayBlocked: true,
        inCaptureSequence: false,
        isSprinting: false,
        isCrouchedOrSliding: false,
        canTriggerSlide: false,
        interactContext: 'NONE',
        inMultiplayer: Boolean(this.multiplayer),
        isPushToTalkActive: Boolean(this.multiplayer?.localVoiceSpeaking),
      });
      this.multiplayer?.update(
        dt,
        this.elapsed,
        this.camera,
        {
          pos: this.position,
          yaw: this.yaw,
          pitch: this.pitch,
          speed: 0,
          bobPhase: this.bobPhase,
          crouch: this.crouchAmount,
          flashlightOn: this.sharedUniforms.uFlashlightIntensity.value > 0.05,
          flashDir: this.sharedUniforms.uFlashlightDir.value,
          health: this.playerHealth,
          bleeding: this.playerBleeding,
          ensnared: this.webManager.isPlayerEnsnared,
          inSequence: false,
          dead: false,
          afk: isLocalAfk,
        },
        this.spider.getNetworkSnapshot(),
        true
      );
      this.updateFlickeringLightsAndAudio();
      return;
    }

    const overlayInputLocked =
      this.pauseMenu.open ||
      this.inventory.open ||
      this.danceMenu.isOpen ||
      Boolean(this.multiplayer?.isChatTyping);

    const interactPressed = overlayInputLocked ? false : this.interactQueued;
    const strugglePressed = overlayInputLocked ? false : this.struggleQueued;
    this.interactQueued = false;
    this.struggleQueued = false;

    const touchLook = this.touchControls.consumeLookDelta();
    if (
      !overlayInputLocked &&
      (touchLook.yawDelta !== 0 || touchLook.pitchDelta !== 0)
    ) {
      const yDir = this.settingsStore.value.invertMouseY ? -1 : 1;
      const pitchDelta = touchLook.pitchDelta * yDir;
      this.yaw += touchLook.yawDelta;
      this.pitch = Math.max(
        -1.25,
        Math.min(1.25, this.pitch + pitchDelta)
      );
      this.flashlight.addLookImpulse(
        touchLook.yawDelta * 22,
        pitchDelta * 22
      );
    }

    const turnSpeed = 2.35;
    if (!overlayInputLocked && this.keys.has('ArrowLeft')) {
      const dYaw = turnSpeed * dt;
      this.yaw += dYaw;
      this.flashlight.addLookImpulse(dYaw * 0.35, 0);
    }
    if (!overlayInputLocked && this.keys.has('ArrowRight')) {
      const dYaw = -turnSpeed * dt;
      this.yaw += dYaw;
      this.flashlight.addLookImpulse(dYaw * 0.35, 0);
    }

    const forward = new THREE.Vector3(
      -Math.sin(this.yaw),
      0,
      -Math.cos(this.yaw)
    );
    const right = new THREE.Vector3(
      Math.cos(this.yaw),
      0,
      -Math.sin(this.yaw)
    );

    const wish = new THREE.Vector3();
    if (!overlayInputLocked) {
      if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) wish.add(forward);
      if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) wish.sub(forward);
      if (this.keys.has('KeyD')) wish.add(right);
      if (this.keys.has('KeyA')) wish.sub(right);

      const touchMove = this.touchControls.getMoveVector();
      if (wish.lengthSq() > 0) {
        wish.normalize();
      } else if (touchMove.magnitude > 0) {
        wish
          .addScaledVector(forward, touchMove.moveY)
          .addScaledVector(right, touchMove.moveX);
        if (wish.lengthSq() > 1) {
          wish.normalize();
        }
      }
    }

    if (wish.lengthSq() < 0.001 && this.desktopSprintLatched) {
      this.desktopSprintLatched = false;
    }

    // ==========================================================================
    // DANÇA: qualquer intenção de movimento cancela a coreografia e devolve a
    // 1ª pessoa na hora (o movimento normal do jogo segue imediatamente).
    // ==========================================================================
    if (this.danceId && !this.danceMenu.isOpen && wish.lengthSq() > 0.001) {
      this.stopDance('movement');
    }

    const touchSprint = !overlayInputLocked && this.touchControls.isSprintRequested;
    if (
      touchSprint &&
      this.touchCrouchLatched &&
      !this.touchAutoUnlatchAfterSlide &&
      !this.slideState.isSliding
    ) {
      // Se estava agachado furtivamente e ativou CORRER no celular, levanta para correr!
      this.touchCrouchLatched = false;
    }

    const ctrlKeyActive =
      this.settingsStore.value.crouchMode === 'toggle'
        ? this.desktopCrouchLatched
        : this.keys.has('ControlLeft') ||
          this.keys.has('ControlRight') ||
          this.keys.has('KeyC');
    const shiftKeyActive =
      this.settingsStore.value.sprintMode === 'toggle'
        ? this.desktopSprintLatched
        : this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');

    const holdingCtrl =
      !overlayInputLocked && (ctrlKeyActive || this.touchCrouchLatched);
    const holdingShift =
      !overlayInputLocked && (shiftKeyActive || touchSprint);

    // Agachar, correr ou interagir também cancelam a coreografia
    if (
      this.danceId &&
      !this.danceMenu.isOpen &&
      (ctrlKeyActive || shiftKeyActive || interactPressed)
    ) {
      this.stopDance('action');
    }

    const hasKnife = this.inventory.hasItem('rusty_knife');

    // Luta contra a teia: o perigo vem da Aranha (perto e caçando) e da
    // contagem para a devoração no casulo; apertar/manter o botão dá o puxão.
    const spiderPlanarDist = Math.hypot(
      this.spider.position.x - this.position.x,
      this.spider.position.z - this.position.z
    );
    this.webStruggleDanger = computeWebDanger({
      spiderDistance: spiderPlanarDist,
      spiderHunting: this.spider.isChasingOrAlert,
      devourSecondsLeft: this.cocoonDevourTimerSec,
      devourMaxSeconds: this.cocoonDevourMaxSec,
    });
    const struggleHeld =
      !overlayInputLocked &&
      (this.keys.has('KeyE') ||
        this.keys.has('Space') ||
        this.keys.has('KeyW') ||
        this.keys.has('KeyA') ||
        this.keys.has('KeyS') ||
        this.keys.has('KeyD') ||
        this.touchControls.getMoveVector().magnitude > 0.25);
    const webStrugglePose = this.webStruggle.step({
      ensnared:
        this.webManager.isPlayerEnsnared && this.activeSequence === 'NONE',
      strugglePressed,
      struggleHeld,
      hasKnife,
      danger01: this.webStruggleDanger,
      dt,
    });
    this.flashlight.setWebStruggle(webStrugglePose);

    const webState = this.webManager.update(
      dt,
      this.position,
      strugglePressed,
      hasKnife,
      this.sound,
      (trapPos) => {
        this.spider.alertToWebTrap(
          trapPos,
          this.position,
          this.position,
          this.yaw
        );
        this.multiplayer?.notifyWebTrapTriggered(
          trapPos.x,
          trapPos.z,
          this.position
        );
      },
      webStrugglePose
    );
    if (strugglePressed && this.webManager.isPlayerEnsnared) {
      this.sound.playStruggleEffort();
    }

    // Em Multiplayer, enquanto estiver 100% preso no Casulo de Teia do Ninho:
    // - Não pode sair sozinho; conta regressiva até a Aranha voltar faminta para devorá-lo!
    // - Nenhuma coordenada ou alerta automático é transmitido: os operadores precisam procurar.
    if (this.webManager.isLockedInMultiplayerCocoon) {
      if (this.cocoonDevourTimerSec <= 0 && !this.cocoonReturnTriggered) {
        this.cocoonDevourMaxSec = this.multiplayer?.hasLivingAllies() ? 45 : 14;
        this.cocoonDevourTimerSec = this.cocoonDevourMaxSec;
      }
      const nestIsFull = Boolean(this.multiplayer) && !this.multiplayer!.hasFreeLivingPlayer();
      if (!this.spider.isDead && !nestIsFull) {
        this.cocoonDevourTimerSec = Math.max(0, this.cocoonDevourTimerSec - dt);
      }
      const ratio = Math.max(
        0,
        Math.min(
          1,
          this.cocoonDevourTimerSec / Math.max(1, this.cocoonDevourMaxSec)
        )
      );
      const isCrit = !this.spider.isDead && this.cocoonDevourTimerSec <= 14;
      this.cocoonHudEl.classList.add('is-visible');
      this.cocoonHudEl.classList.toggle('is-critical', isCrit);
      this.cocoonBarFillEl.style.width = `${(ratio * 100).toFixed(1)}%`;
      this.cocoonSubEl.textContent = nestIsFull
        ? 'A EQUIPE INTEIRA ESTÁ IMOBILIZADA'
        : this.spider.isDead
        ? 'ARANHA DESTRUÍDA · UM OPERADOR PODE CORTAR A TEIA'
        : isCrit
        ? `A ARANHA ESTÁ VOLTANDO PARA DEVORAR VOCÊ (${Math.ceil(this.cocoonDevourTimerSec)}s)!`
        : `A TEIA SEGURA VOCÊ — DEVORAÇÃO EM ${Math.ceil(this.cocoonDevourTimerSec)}s`;

      if (interactPressed || strugglePressed) {
        this.sound.playStruggleEffort();
      }

      if (isCrit && !this.cocoonReturnTriggered) {
        this.cocoonReturnTriggered = true;
        this.spider.commandReturnToDevourVictim(this.position);
      }

      if (
        !nestIsFull &&
        !this.spider.isDead &&
        this.cocoonDevourTimerSec <= 0
      ) {
        const devourSpiderPos = new THREE.Vector3(
          this.position.x + this.webManager.dragDirection.x * 1.08,
          1.38,
          this.position.z + this.webManager.dragDirection.z * 1.08
        );
        this.triggerSpiderCatch(devourSpiderPos);
        return;
      }
    } else {
      this.cocoonHudEl.classList.remove('is-visible', 'is-critical');
      // Alguém pode ter sido amarrado no Ninho agora: se não sobrou ninguém
      // solto, a partida termina (o anfitrião confirma para a sala).
      if (this.multiplayer) this.maybeStartSquadDevouredSequence();
    }

    // Com o esquadrão inteiro preso, a Aranha se alimenta de um por um: nada de
    // devolver o controle, a cena final assume a partir daqui.
    if (this.squadDevouredActive) return;

    // Atualiza transparência dos fios do casulo enquanto o jogador sai caminhando do Ninho!
    this.inventory.setAbductionScreenFX(
      0,
      0,
      0,
      this.webManager.getWakingLairSilkFactor(this.position)
    );

    // Levemente mais lento quando gravemente ferido (<28% vida) para reforçar sensação de ferimento
    const injurySlow = this.playerHealth < 28 ? 0.88 : 1.0;
    const canStand = this.canStandUp();
    const canSprintNow = canPlayerSprintWithStamina(this.staminaState);
    const canSlideNow = canPlayerSlideWithStamina(this.staminaState);

    const slideStep = stepPlayerSlideState(this.slideState, {
      dt,
      holdingCtrl,
      holdingShift,
      wishX: wish.x,
      wishZ: wish.z,
      forwardX: forward.x,
      forwardZ: forward.z,
      velX: this.velocity.x,
      velZ: this.velocity.z,
      canStandUp: canStand,
      ensnared: this.webManager.isPlayerEnsnared,
      injurySlow,
      webSpeedMultiplier: webState.speedMultiplier,
      canSprint: canSprintNow,
      canSlide: canSlideNow,
    });

    const isSliding = slideStep.isSliding;
    if (this.touchAutoUnlatchAfterSlide && !isSliding && !slideStep.startedSlide) {
      this.touchAutoUnlatchAfterSlide = false;
      this.touchCrouchLatched = false;
    }
    if (
      this.desktopAutoUnlatchAfterSlide &&
      !isSliding &&
      !slideStep.startedSlide
    ) {
      this.desktopAutoUnlatchAfterSlide = false;
      this.desktopCrouchLatched = false;
    }
    const isCrouching =
      slideStep.isCrouching || (this.wasCrouching && !canStand);

    if (slideStep.startedSlide) {
      const surface = isStoneSectorWorld(this.position.x, this.position.z)
        ? 'stone'
        : 'tech';
      this.sound.playFloorSlide(surface);
      this.wasCrouching = true;
    } else if (isCrouching !== this.wasCrouching) {
      this.sound.playCrouchMovement(isCrouching);
      this.wasCrouching = isCrouching;
    }

    const crouchTarget = isCrouching ? 1 : 0;
    this.crouchAmount +=
      (crouchTarget - this.crouchAmount) *
      (1 - Math.exp(-(isSliding ? 18.0 : 12.5) * dt));

    const sprinting = !isCrouching && slideStep.sprinting;

    const sprintFatigueMul =
      this.staminaState.stamina >= 22
        ? 1.0
        : 0.82 + 0.18 * Math.max(0, this.staminaState.stamina / 22);
    const walkExhaustionMul = this.staminaState.exhausted
      ? 0.86 +
        0.14 *
          Math.min(
            1,
            this.staminaState.stamina / STAMINA_EXHAUSTION_RECOVERY_THRESHOLD
          )
      : 1.0;

    if (slideStep.overrideVelocity) {
      this.velocity.x = slideStep.outVelX;
      this.velocity.z = slideStep.outVelZ;
    } else {
      const baseMaxSpeed =
        (isCrouching
          ? 2.75
          : sprinting
            ? 9.1 * sprintFatigueMul
            : 6.2 * walkExhaustionMul) * injurySlow;
      const maxSpeed = baseMaxSpeed * webState.speedMultiplier;

      const accel = wish.lengthSq() > 0 ? 18.5 : 12.5;
      const blend = 1 - Math.exp(-accel * dt);
      this.velocity.x += (wish.x * maxSpeed - this.velocity.x) * blend;
      this.velocity.z += (wish.z * maxSpeed - this.velocity.z) * blend;
    }

    const speedBeforeCol = Math.hypot(this.velocity.x, this.velocity.z);
    const intendedX = this.position.x + this.velocity.x * dt;
    const intendedZ = this.position.z + this.velocity.z * dt;
    this.position.x = intendedX;
    this.position.z = intendedZ;

    const currentHeight =
      this.standingPlayerHeight +
      (this.crouchPlayerHeight - this.standingPlayerHeight) * this.crouchAmount;

    resolveCylinderWorldCollisions(
      this.position,
      this.velocity,
      this.playerRadius,
      currentHeight,
      this.colliders
    );

    const pushDist = Math.hypot(
      this.position.x - intendedX,
      this.position.z - intendedZ
    );
    if (speedBeforeCol > 3.2 && pushDist > 0.028) {
      this.sound.playWallBump();
    }

    const planarSpeed = Math.hypot(this.velocity.x, this.velocity.z);
    let bobOffset = 0;
    if (isSliding) {
      // Durante o deslize no chão, não há quique de passos — apenas deslize rente ao piso!
      this.bobPhase = 0;
      this.lastBobHalfCycle = 0;
    } else if (planarSpeed > 0.28) {
      const bobRate = isCrouching
        ? 4.6 + planarSpeed * 0.9
        : 7.5 + planarSpeed * 0.75;
      const bobAmp = isCrouching ? 0.028 : 0.055;
      this.bobPhase += dt * bobRate;
      bobOffset =
        Math.sin(this.bobPhase) *
        bobAmp *
        Math.min(1, planarSpeed / (isCrouching ? 2.75 : 5.5)) *
        (this.settingsStore.value.headBobIntensity / 100);

      const halfCycle = Math.floor(this.bobPhase / Math.PI);
      if (halfCycle !== this.lastBobHalfCycle) {
        this.lastBobHalfCycle = halfCycle;
        const surface = isStoneSectorWorld(this.position.x, this.position.z)
          ? 'stone'
          : 'tech';
        this.sound.playLabyrinthFootstep(
          halfCycle % 2 === 0,
          surface,
          sprinting,
          isCrouching,
          this.playerHealth < 35
        );
      }
    } else {
      this.bobPhase = 0;
      this.lastBobHalfCycle = 0;
    }

    // Sistema diegético de Estamina (100% sem HUD na tela — sentido pelo fôlego no capacete e movimento do tórax!)
    const stamStep = stepPlayerStaminaState(this.staminaState, {
      dt,
      isSprinting: sprinting,
      startedSlide: slideStep.startedSlide,
      isSliding,
      isCrouching,
      planarSpeed,
    });
    this.staminaChestHeaveY = stamStep.chestHeaveOffsetY;
    this.staminaBreathPitch = stamStep.breathPitchOffset;
    if (stamStep.becameExhausted) {
      this.sound.playExhaustionGasp();
      this.touchControls.clearSprintLatch();
    }
    this.sound.playSprintBreath(stamStep.fatigue01, stamStep.exhausted);

    if ((this.flashlight.isEquipped || this.shotgun.isEquipped) && this.lanternBattery > 0) {
      // A lanterna de apoio gasta a mesma célula da lanterna avulsa.
      this.lanternBattery = Math.max(0, this.lanternBattery - dt * 0.62);
    }

    // Lanterna de apoio: com a shotgun nas duas mãos o feixe continua saindo
    // da arma, alimentado pela bateria, mesmo sem a lanterna empunhada.
    const shotgunMounted = this.shotgun.isEquipped;
    this.shotgun.setMountedFlashlight(
      shotgunMounted && this.lanternBattery > 0.2,
      this.lanternBattery < 15
    );

    const fl = this.flashlight.update(
      dt,
      this.bobPhase,
      planarSpeed,
      () => {
        this.sound.playFlashlightClick(true);
      },
      this.crouchAmount,
      this.lanternBattery,
      this.slideState.slideAmount
    );

    // Preso na teia: as armas também são arrastadas pela seda (nada de seguir
    // firme na mão como se o operador estivesse livre).
    this.shotgun.setWebStruggle(webStrugglePose);
    this.shotgun.update(dt, this.bobPhase, planarSpeed, this.slideState.slideAmount);

    const spiderHearsSprint =
      sprinting || (isSliding && this.slideState.slideTimer < 0.2);
    const localVoiceLvl = this.multiplayer?.localVoiceLevel ?? 0;

    let spiderOut: { cameraShakeAmount: number; playerDistance: number };
    const activeFlares = this.worldItems.getActiveFlares();
    const updatedRemoteAbduction =
      this.multiplayer?.getActiveRemoteAbduction() ?? null;

    if (updatedRemoteAbduction && this.multiplayer) {
      // Todos os jogadores assistem em 3ª pessoa a Aranha atacando/arrastando com os 4 Tentáculos/tecendo sobre o aliado!
      this.spider.updateRemoteCinematicSequence(
        dt,
        this.elapsed,
        updatedRemoteAbduction.mode,
        updatedRemoteAbduction.progress,
        updatedRemoteAbduction.spiderPos,
        updatedRemoteAbduction.victimPos,
        updatedRemoteAbduction.ragdollHooks
      );
      const distToSpider = Math.hypot(
        this.position.x - this.spider.position.x,
        this.position.z - this.spider.position.z
      );
      spiderOut = {
        cameraShakeAmount:
          distToSpider < 9.0 ? (1 - distToSpider / 9.0) * 0.024 : 0,
        playerDistance: distToSpider,
      };
    } else if (this.multiplayer && !this.multiplayer.isHost) {
      const remotePkt = this.multiplayer.getFreshRemoteSpiderPacket(3500);
      if (remotePkt) {
        spiderOut = this.spider.applyRemoteNetworkState(
          dt,
          this.elapsed,
          remotePkt,
          this.position,
          this.yaw,
          () => {
            this.triggerSpiderCatch();
          }
        );
      } else {
        this.spider.ensureExitedCinematic(
          this.multiplayer.getObserverWorldPositions(this.position)
        );
        spiderOut = this.spider.update(
          dt,
          this.elapsed,
          this.position,
          this.yaw,
          spiderHearsSprint,
          isCrouching,
          fl.beamIntensity > 0.05,
          this.sharedUniforms.uFlashlightDir.value,
          activeFlares,
          () => {
            this.triggerSpiderCatch();
          },
          localVoiceLvl
        );
      }
    } else if (this.multiplayer && this.multiplayer.isHost) {
      this.spider.ensureExitedCinematic(
        this.multiplayer.getObserverWorldPositions(this.position)
      );
      const starvingVictimPos = this.multiplayer.getStarvingCocoonVictimPos(
        this.position,
        this.webManager.isLockedInMultiplayerCocoon,
        this.cocoonDevourTimerSec
      );
      if (starvingVictimPos) {
        this.spider.commandReturnToDevourVictim(starvingVictimPos);
      }
      const candidates = this.multiplayer.buildSpiderPlayerCandidates({
        pos: this.position,
        yaw: this.yaw,
        sprinting: spiderHearsSprint,
        crouching: isCrouching,
        flashlightOn: fl.beamIntensity > 0.05,
        flashlightDir: this.sharedUniforms.uFlashlightDir.value,
        voiceLevel: localVoiceLvl,
        ensnared: this.webManager.isPlayerEnsnared,
        cocoonLocked: this.webManager.isLockedInMultiplayerCocoon,
        devourSecondsLeft: this.cocoonDevourTimerSec,
        afk: isLocalAfk,
      });
      const chosen = this.spider.selectBestMultiplayerCandidate(candidates);
      spiderOut = this.spider.update(
        dt,
        this.elapsed,
        chosen.pos,
        chosen.yaw,
        chosen.sprinting,
        chosen.crouching,
        chosen.flashlightOn,
        chosen.flashlightDir,
        activeFlares,
        () => {
          if (chosen.isLocal) {
            this.triggerSpiderCatch();
          } else {
            this.multiplayer?.notifyAuthoritativeSpiderCaughtAlly(
              chosen.id,
              this.spider.position
            );
          }
        },
        chosen.voiceLevel ?? 0,
        this.position,
        this.yaw
      );
    } else {
      spiderOut = this.spider.update(
        dt,
        this.elapsed,
        this.position,
        this.yaw,
        spiderHearsSprint,
        isCrouching,
        fl.beamIntensity > 0.05,
        this.sharedUniforms.uFlashlightDir.value,
        activeFlares,
        () => {
          this.triggerSpiderCatch();
        },
        localVoiceLvl
      );
    }

    if (this.activeSequence !== 'NONE') {
      this.radar.update(
        this.position.x,
        this.position.z,
        this.yaw,
        this.elapsed,
        [],
        true
      );
      this.updateHorrorSequence(0);
      this.updateFlickeringLightsAndAudio();
      return;
    }

    this.cameraShake = Math.max(
      this.cameraShake * Math.exp(-8 * dt),
      spiderOut.cameraShakeAmount
    );

    if (this.danceId) {
      // Dançando: o traje aparece em 3ª pessoa e a câmera orbita o personagem
      this.updateDance(dt);
    } else {
      this.astronaut.updateFirstPersonBody(
        this.position,
        this.yaw,
        this.bobPhase,
        planarSpeed,
        this.crouchAmount,
        this.flashlight.isEquipped,
        this.flashlight.isLeftArmAnimating,
        this.pitch
      );

      this.syncCamera(bobOffset);
    }

    if (interactPressed && this.multiplayer) {
      const struckSpider = this.multiplayer.tryStrikeCapturingSpider(
        this.position,
        this.spider.position,
        hasKnife ? 'knife' : 'shove'
      );
      if (struckSpider) {
        if (hasKnife) {
          this.flashlight.triggerQuickItemAction('knife');
          this.sound.playItemUse('blade');
        } else {
          this.astronaut.setArmInUse('left', true);
        }
        this.cameraShake = Math.max(this.cameraShake, 0.09);
      } else {
        const rescued = this.multiplayer.tryRescueNearbyTrappedAlly(
          this.position,
          this.spider.position,
          hasKnife
        );
        if (rescued) {
          if (hasKnife) {
            this.flashlight.triggerQuickItemAction('knife');
          } else {
            this.astronaut.setArmInUse('left', true);
          }
          this.sound.playWebCut();
        }
      }
    }

    const camForward = new THREE.Vector3(0, 0, -1).applyQuaternion(
      this.camera.quaternion
    );
    let pickedUpAnyItem = false;
    this.worldItems.updateAndCheckPickups(
      dt,
      this.elapsed,
      this.position,
      this.camera.position,
      camForward,
      interactPressed,
      this.inventory,
      (openedItemId) => {
        this.sound.playCrateOpen();
        this.inventory.wakeShortcutsHub(
          3400,
          openedItemId === SHOTGUN_AMMO_ITEM_ID
            ? 'CAIXOTE ABERTO · CARTUCHOS 12 GAUGE À VISTA'
            : 'CAIXOTE ABERTO · SUPRIMENTO À VISTA'
        );
      },
      (pickedItemId) => {
        pickedUpAnyItem = true;
        getGameConsole().debug('jogo', `Item recolhido: ${pickedItemId}`);
        const pickedKind = Object.hasOwn(QUICK_ITEM_DURATIONS, pickedItemId) ? pickedItemId
          : ITEM_CATALOG[pickedItemId]?.kind;
        if (pickedKind && Object.hasOwn(QUICK_ITEM_DURATIONS, pickedKind) && pickedKind !== 'radar' && pickedKind !== 'walkie') {
          this.flashlight.triggerQuickItemAction(pickedKind as QuickHandheldKind, 'pickup');
        }
        if (this.inventory.getAvailableShotgunParts().some(id => id === pickedItemId)) {
          const availableParts = this.inventory.getAvailableShotgunParts();
          const count = availableParts.filter(id => this.inventory.hasItem(id)).length;
          this.inventory.wakeShortcutsHub(6500, count === availableParts.length
            ? `${availableParts.length}/${availableParts.length} PEÇAS · ABRA [TAB] E MONTE A SHOTGUN`
            : `SHOTGUN: ${count}/${availableParts.length} PEÇAS · PROCURE AS OUTRAS NAS SALAS ESPECIAIS`);
        } else if (pickedItemId === SHOTGUN_AMMO_ITEM_ID) {
          this.inventory.wakeShortcutsHub(5000, `CARTUCHOS: ${this.inventory.getItemCount(SHOTGUN_AMMO_ITEM_ID)} · [H] EQUIPAR`);
        } else if (pickedItemId === 'field_radar') {
          this.radar.unlockAndActivate();
          this.flashlight.triggerQuickItemAction('radar');
          this.sound.playRadarPing(true);
          this.syncInventoryVitals();
        } else if (pickedItemId === 'field_walkie_talkie') {
          // O rádio é EQUIPADO (aparece na mão), mas o canal VHF começa
          // DESLIGADO: só entra em funcionamento após o jogador apertar [R].
          // Isso evita que a voz dos amigos "caia" no ouvido do jogador
          // instantaneamente ao pegar o item, sem que ele tenha pedido.
          this.walkieTalkieActive = false;
          this.flashlight.triggerQuickItemAction('walkie');
          this.astronaut.setArmInUse('left', true);
          this.sound.playRadioSquelch(false);
          this.inventory.notifyEquipmentShortcutUsed('walkie', false);
          this.inventory.notifyRadioEquipped();
          this.syncInventoryVitals();
        }
      }
    );

    let nearbyLockedDoor = this.specialRoomDoors.findNearbyLockedDoor(
      this.position,
      3.05
    );
    if (interactPressed && !pickedUpAnyItem && nearbyLockedDoor) {
      if (this.inventory.hasItem(nearbyLockedDoor.keyItemId)) {
        this.flashlight.triggerQuickItemAction('key');
        this.astronaut.setArmInUse('left', true);
        this.unlockSpecialRoomWithKey(
          nearbyLockedDoor.room.id,
          nearbyLockedDoor.keyItemId,
          nearbyLockedDoor.room.name
        );
        nearbyLockedDoor = null;
      } else {
        this.sound.playBlastDoorUnlock(false);
      }
    }

    const showDoorLockPrompt =
      Boolean(nearbyLockedDoor) &&
      this.engaged &&
      !this.pauseMenu.open &&
      !this.inventory.open &&
      !this.inventory.gameOverVisible;
    if (showDoorLockPrompt && nearbyLockedDoor) {
      const hasMatchingKey = this.inventory.hasItem(nearbyLockedDoor.keyItemId);
      this.doorLockPromptEl.classList.toggle('can-unlock', hasMatchingKey);
      this.doorLockPromptEl.classList.add('is-visible');
      if (hasMatchingKey) {
        this.doorLockTitleEl.textContent = `[E] DESTRANCAR ${nearbyLockedDoor.room.name} [${nearbyLockedDoor.room.doorCode}]`;
        this.doorLockSubEl.textContent = `Usar ${nearbyLockedDoor.keyName}`;
      } else {
        this.doorLockTitleEl.textContent = `🔒 COMPORTA SELADA [${nearbyLockedDoor.room.doorCode}] — ${nearbyLockedDoor.room.name}`;
        this.doorLockSubEl.textContent = `Requer ${nearbyLockedDoor.keyName} (procure nas caixas do labirinto)`;
      }
    } else {
      this.doorLockPromptEl.classList.remove('is-visible', 'can-unlock');
    }

    let touchInteractContext: TouchInteractContext = 'NONE';
    if (this.webManager.isPlayerEnsnared) {
      touchInteractContext = 'WEB';
    } else if (
      this.multiplayer?.hasTrappedAllyInRescueRange(
        this.position,
        this.spider.position,
        hasKnife
      )
    ) {
      touchInteractContext = 'ALLY';
    } else if (
      this.worldItems.hasLockedCrateInSight(
        this.position,
        this.camera.position,
        camForward
      )
    ) {
      touchInteractContext = 'CRATE';
    } else if (
      this.worldItems.hasInteractableItemInSight(
        this.position,
        this.camera.position,
        camForward
      ) ||
      Boolean(nearbyLockedDoor && this.inventory.hasItem(nearbyLockedDoor.keyItemId))
    ) {
      touchInteractContext = 'ITEM';
    }

    this.touchControls.syncState({
      overlayBlocked: overlayInputLocked,
      inCaptureSequence: false,
      isSprinting: sprinting,
      isCrouchedOrSliding: isCrouching || isSliding,
      canTriggerSlide:
        !overlayInputLocked &&
        sprinting &&
        planarSpeed > 6.0 &&
        !isSliding &&
        canPlayerSlideWithStamina(this.staminaState),
      interactContext: overlayInputLocked ? 'NONE' : touchInteractContext,
      inMultiplayer: Boolean(this.multiplayer),
      isPushToTalkActive: Boolean(this.multiplayer?.localVoiceSpeaking),
      isDancing: this.danceId !== null,
    });

    const curGrid = worldToGridCell(this.position.x, this.position.z);
    const curThemedRoom = getThemedRoomAtCell(curGrid.gx, curGrid.gz);
    const nextRoomId = curThemedRoom?.id ?? null;
    if (nextRoomId !== this.currentThemedRoomId) {
      this.currentThemedRoomId = nextRoomId;
      if (curThemedRoom) {
        this.roomBannerTitleEl.textContent = curThemedRoom.name;
        this.roomBannerSubEl.textContent = curThemedRoom.subtitle;
        this.roomBannerHideAtSec = this.elapsed + 3.1;
      }
    }
    const shouldShowRoomBanner =
      this.engaged &&
      !this.pauseMenu.open &&
      !this.inventory.open &&
      !this.inventory.gameOverVisible &&
      this.elapsed < this.roomBannerHideAtSec &&
      this.currentThemedRoomId !== null;
    this.roomBannerEl.classList.toggle('is-visible', shouldShowRoomBanner);

    this.radar.update(
      this.position.x,
      this.position.z,
      this.yaw,
      this.elapsed,
      this.worldItems.getUncollectedEquipmentSignals(),
      !this.engaged ||
        this.pauseMenu.open ||
        this.inventory.open ||
        this.inventory.gameOverVisible,
      this.multiplayer?.getRadarAllyBlips()
    );

    if (this.multiplayer) {
      // Todos os capturados ficam amarrados JUNTOS na teia do Ninho.
      this.webManager.syncLairCaptives(
        this.webManager.isLockedInMultiplayerCocoon,
        this.multiplayer.getLairCaptiveAllies()
      );
    }

    this.multiplayer?.update(
      dt,
      this.elapsed,
      this.camera,
      {
        pos: this.position,
        yaw: this.yaw,
        pitch: this.pitch,
        speed: planarSpeed,
        bobPhase: this.bobPhase,
        crouch: this.crouchAmount,
        slide: this.slideState.slideAmount,
        quickItemAction: this.flashlight.quickItemAction,
        heldWeapon: this.shotgun.isEquipped ? 'shotgun' : null,
        flashlightOn: fl.beamIntensity > 0.05,
        flashDir: this.sharedUniforms.uFlashlightDir.value,
        health: this.playerHealth,
        bleeding: this.playerBleeding,
        ensnared: this.webManager.isPlayerEnsnared,
        cocoonLocked: this.webManager.isLockedInMultiplayerCocoon,
        devourSecondsLeft: this.cocoonDevourTimerSec,
        walkieTalkieActive:
          this.walkieTalkieActive &&
          this.inventory.hasItem('field_walkie_talkie'),
        inSequence: false,
        dead: false,
        afk: isLocalAfk,
        danceId: this.danceId,
        danceTime: this.danceTime,
      },
      this.spider.getNetworkSnapshot(
        updatedRemoteAbduction?.allyId ?? null
      ),
      !this.engaged ||
        this.pauseMenu.open ||
        this.inventory.open ||
        this.inventory.gameOverVisible
    );

    // O feixe da lanterna de apoio acoplada substitui o da lanterna avulsa
    // enquanto a shotgun estiver nas duas mãos.
    const beamIntensity = shotgunMounted
      ? this.lanternBattery > 0.2
        ? this.lanternBattery < 15
          ? 0.6
          : 1
        : 0
      : fl.beamIntensity;
    this.sharedUniforms.uFlashlightIntensity.value = beamIntensity;
    if (beamIntensity > 0.005) {
      const camRight = new THREE.Vector3(1, 0, 0).applyQuaternion(
        this.camera.quaternion
      );
      const camUp = new THREE.Vector3(0, 1, 0).applyQuaternion(
        this.camera.quaternion
      );
      const handRightOffset =
        this.settingsStore.value.viewmodelHand === 'left' ? -0.18 : 0.18;
      this.sharedUniforms.uFlashlightPos.value
        .copy(this.camera.position)
        .addScaledVector(camRight, handRightOffset)
        .addScaledVector(camUp, -0.14);

      const beamEuler = new THREE.Euler(
        this.pitch + (shotgunMounted ? -0.05 : fl.aimPitchOffset),
        this.yaw + (shotgunMounted ? 0 : fl.aimYawOffset),
        0,
        'YXZ'
      );
      this.sharedUniforms.uFlashlightDir.value
        .set(0, 0, -1)
        .applyEuler(beamEuler)
        .normalize();
    }

    this.updateSurvivalVitals(
      dt,
      spiderOut.playerDistance,
      beamIntensity > 0.05
    );
    this.updateFlickeringLightsAndAudio();
    this.worldItems.updatePropShadows(dt);
  }

  private updateSurvivalVitals(
    dt: number,
    spiderDist: number,
    flashlightOn: boolean
  ): void {
    // Sangramento drena até piso crítico (16%), mantendo o jogador vulnerável a morte permanente se atacado de novo!
    if (this.playerBleeding && this.playerHealth > 16) {
      this.playerHealth = Math.max(16, this.playerHealth - dt * 0.65);
    }

    if (this.spider.isChasingOrAlert || this.webManager.isPlayerEnsnared) {
      this.playerSanity = Math.max(6, this.playerSanity - dt * 7.5);
    } else if (!flashlightOn && spiderDist < 11) {
      this.playerSanity = Math.max(24, this.playerSanity - dt * 2.4);
    } else {
      this.playerSanity = Math.min(100, this.playerSanity + dt * 2.2);
    }

    const dangerChase = this.spider.isChasingOrAlert
      ? Math.max(0.35, 1 - spiderDist / 16)
      : 0;
    const dangerInjury = Math.max(0, (55 - this.playerHealth) / 55);
    const dangerExhaustion = this.staminaState.exhausted
      ? 0.42
      : Math.max(0, (24 - this.staminaState.stamina) / 24) * 0.32;
    const heartIntensity = Math.max(
      dangerChase,
      dangerInjury,
      dangerExhaustion
    );
    this.sound.playTensionHeartbeat(heartIntensity);

    this.syncInventoryVitals();
  }

  private toggleRadarHud(): boolean {
    if (!this.radar.hasRadar) return false;
    const nowActive = this.radar.toggleActive();
    this.sound.playRadarPing(nowActive);
    if (nowActive) {
      this.flashlight.triggerQuickItemAction('radar');
    }
    this.syncInventoryVitals();
    return nowActive;
  }

  private toggleWalkieTalkieHud(): boolean {
    if (!this.inventory.hasItem('field_walkie_talkie')) return false;
    this.walkieTalkieActive = !this.walkieTalkieActive;
    this.sound.playRadioSquelch(this.walkieTalkieActive);
    this.flashlight.triggerQuickItemAction('walkie');
    this.astronaut.setArmInUse('left', true);
    this.syncInventoryVitals();
    return this.walkieTalkieActive;
  }

  /* ==========================================================================
     SISTEMA DE DANÇA DO JOGADOR (DANÇAS MÚLTIPLAS + CÂMERA EM 3ª PESSOA)
     ========================================================================== */

  /** Abre/fecha o menu de danças ([G]). */
  private toggleDanceMenu(): void {
    if (this.danceMenu.isOpen) {
      this.closeDanceMenu();
      return;
    }
    this.openDanceMenu();
  }

  private openDanceMenu(): void {
    if (!this.engaged || this.disposed || this.danceMenu.isOpen || this.activeSequence !== 'NONE' ||
        this.pauseMenu.open || this.inventory.open || this.inventory.gameOverVisible) return;
    this.suppressReleasePause();
    this.danceMenu.setOpen(true);
    this.danceMenu.setActiveDance(this.danceId);
    this.keys.clear();
    this.isDragging = false;
    this.sound.playInventoryToggle(true);
    try {
      document.exitPointerLock?.();
    } catch {
      // ignorar
    }
  }

  private closeDanceMenu(): void {
    if (!this.danceMenu.isOpen) return;
    this.suppressReleasePause();
    this.danceMenu.setOpen(false);
    this.sound.playInventoryToggle(false);
    this.tryPointerLock(false);
  }

  /** Começa (ou troca) a coreografia do jogador e entra em 3ª pessoa. */
  private startDance(id: DoomDanceId): void {
    if (!isDoomDanceId(id) || this.activeSequence !== 'NONE' || this.inventory.gameOverVisible) return;
    const def = getDoomDanceDefinition(id);
    const wasDancing = this.danceId !== null;
    this.danceId = id;
    this.danceTime = 0;
    this.danceBeatIndex = -1;
    if (!wasDancing) {
      // O personagem passa a encarar a direção em que o jogador já olhava
      this.danceFacingYaw = this.yaw;
    }
    this.closeDanceMenu();
    this.syncDanceHud();
    this.sound.playDanceStart(def.id);
    this.multiplayer?.notifyDanceChanged(id);
  }

  /** Encerra a coreografia e devolve o jogador para a 1ª pessoa. */
  private stopDance(reason: 'movement' | 'menu' | 'action' | 'capture' | 'pause'): void {
    if (!this.danceId) {
      if (reason === 'menu') this.closeDanceMenu();
      return;
    }
    this.danceId = null;
    this.danceTime = 0;
    this.danceBeatIndex = -1;
    this.syncDanceHud();
    this.astronaut.updateFirstPersonBody(
      this.position,
      this.yaw,
      this.bobPhase,
      0,
      this.crouchAmount,
      this.flashlight.isEquipped,
      this.flashlight.isLeftArmAnimating,
      this.pitch
    );
    this.sound.playDanceStop();
    this.multiplayer?.notifyDanceChanged(null);
    if (reason === 'menu') {
      this.closeDanceMenu();
    }
  }

  /** Alterna para a próxima dança do catálogo (botão rápido do HUD). */
  private cycleDance(): void {
    const next = getNextDoomDanceId(this.danceId);
    this.startDance(next);
  }

  private syncDanceHud(): void {
    const active = this.danceId !== null;
    this.danceHudEl.classList.toggle('is-visible', active);
    if (this.danceId) {
      const def = getDoomDanceDefinition(this.danceId);
      this.danceHudIconEl.textContent = def.icon;
      this.danceHudNameEl.textContent = def.label;
    } else {
      this.danceHudNameEl.textContent = '';
    }
    this.danceMenu.setActiveDance(this.danceId);
  }

  /**
   * Avança a coreografia, aplica a pose 3D no traje e posiciona a câmera de
   * 3ª pessoa orbitando o personagem (com colisão de paredes/teto).
   */
  private updateDance(dt: number): void {
    if (!this.danceId) return;
    this.danceTime += dt;

    const pose = computeDoomDancePose(this.danceId, this.danceTime);
    this.astronaut.applyDancePose(pose, this.position, this.danceFacingYaw);
    this.syncDanceCamera();

    const beat = getDoomDanceBeatIndex(this.danceId, this.danceTime);
    if (beat !== this.danceBeatIndex) {
      this.danceBeatIndex = beat;
      this.sound.playDanceBeat(this.danceId, beat % 4 === 0);
    }
  }

  /**
   * Câmera de 3ª pessoa orbital da dança:
   * - O mouse (ou o toque livre) gira a câmera ao redor do personagem,
   *   permitindo assistir a coreografia pela frente, lateral ou por trás;
   * - A câmera NUNCA atravessa paredes, móveis ou o teto do setor;
   * - O alvo é o peito do personagem, mantendo o traje sempre enquadrado.
   */
  private syncDanceCamera(): void {
    const focusY = 1.16;
    this.danceCamTargetScratch.set(
      this.position.x,
      this.position.y + focusY,
      this.position.z
    );

    const pitch = Math.max(-0.42, Math.min(0.78, this.pitch));
    const horizDist = this.danceCameraDistance * Math.cos(pitch);
    const offsetX = Math.sin(this.yaw) * horizDist;
    const offsetZ = Math.cos(this.yaw) * horizDist;
    const camY = Math.max(
      0.42,
      Math.min(3.0, this.position.y + focusY + this.danceCameraDistance * Math.sin(pitch))
    );

    // Colisão: percorre o segmento alvo -> câmera e para antes de qualquer
    // parede/móvel (com folga de 0.22m para a câmera não encostar na geometria).
    let safeFrac = 1;
    const steps = 12;
    for (let s = steps; s >= 1; s--) {
      const f = s / steps;
      const cx = this.danceCamTargetScratch.x + offsetX * f;
      const cz = this.danceCamTargetScratch.z + offsetZ * f;
      const cy = this.position.y + focusY + (camY - (this.position.y + focusY)) * f;
      if (!this.isDanceCameraBlocked(cx, cy, cz)) {
        safeFrac = f;
        break;
      }
      safeFrac = 0;
    }

    this.danceCamPosScratch.set(
      this.danceCamTargetScratch.x + offsetX * safeFrac,
      this.position.y + focusY + (camY - (this.position.y + focusY)) * safeFrac,
      this.danceCamTargetScratch.z + offsetZ * safeFrac
    );

    // Garantia extra: a câmera NUNCA fica colada dentro do traje (evita
    // lookAt degenerado e a câmera "dentro" do capacete em becos sem saída)
    const minCamDist = 0.34;
    const camDx = this.danceCamPosScratch.x - this.danceCamTargetScratch.x;
    const camDy = this.danceCamPosScratch.y - this.danceCamTargetScratch.y;
    const camDz = this.danceCamPosScratch.z - this.danceCamTargetScratch.z;
    const camLen = Math.hypot(camDx, camDy, camDz);
    if (camLen < minCamDist) {
      const desiredLen = Math.hypot(offsetX, camY - (this.position.y + focusY), offsetZ);
      const scale = desiredLen > 1e-4 ? minCamDist / desiredLen : 0;
      this.danceCamPosScratch.set(
        this.danceCamTargetScratch.x + offsetX * scale,
        this.position.y + focusY + (camY - (this.position.y + focusY)) * scale,
        this.danceCamTargetScratch.z + offsetZ * scale
      );
    }
    this.danceCamPosScratch.y = Math.max(0.35, Math.min(3.0, this.danceCamPosScratch.y));

    const shakeScale = this.settingsStore.value.screenShakeIntensity / 100;
    const shakeX =
      this.cameraShake > 0.001
        ? (Math.random() - 0.5) * 2 * this.cameraShake * shakeScale
        : 0;
    const shakeY =
      this.cameraShake > 0.001
        ? (Math.random() - 0.5) * 2 * this.cameraShake * shakeScale
        : 0;

    this.camera.position.set(
      this.danceCamPosScratch.x + shakeX,
      this.danceCamPosScratch.y + shakeY,
      this.danceCamPosScratch.z
    );
    this.danceCamLookScratch.copy(this.danceCamTargetScratch);
    this.danceCamLookScratch.y -= 0.06;
    this.camera.lookAt(this.danceCamLookScratch);
    this.setCameraFov(this.settingsStore.value.fov);
  }

  /** Verdadeiro quando o ponto da câmera está dentro de parede/móvel do setor. */
  private isDanceCameraBlocked(x: number, y: number, z: number): boolean {
    for (let i = 0; i < this.colliders.length; i++) {
      const col = this.colliders[i];
      if (col.isCrawlUnder) continue;
      const b = col.box;
      if (y < b.min.y - 0.12 || y > b.max.y + 0.12) continue;
      if (
        x >= b.min.x - 0.22 &&
        x <= b.max.x + 0.22 &&
        z >= b.min.z - 0.22 &&
        z <= b.max.z + 0.22
      ) {
        return true;
      }
    }
    return false;
  }

  private unlockSpecialRoomWithKey(
    roomId: DoomRoomId,
    keyItemId: string,
    roomName: string
  ): boolean {
    const unlocked = this.specialRoomDoors.unlockRoom(roomId);
    if (!unlocked) return false;
    this.inventory.consumeItemById(keyItemId);
    this.sound.playBlastDoorUnlock(true);
    this.multiplayer?.broadcastRoomUnlocked(roomId, roomName);
    this.syncInventoryVitals();
    return true;
  }

  private syncInventoryVitals(): void {
    this.inventory.updateVitalsAndDiegeticFX({
      health: this.playerHealth,
      sanity: this.playerSanity,
      battery: this.lanternBattery,
      flashlightEquipped: this.flashlight.isEquipped,
      radarActive: this.radar.isActive,
      walkieActive:
        this.walkieTalkieActive &&
        this.inventory.hasItem('field_walkie_talkie'),
      trappedInWeb: this.webManager.isPlayerEnsnared,
      webStruggle01: this.webStruggle.current.effort01,
      webDanger01: this.webStruggleDanger,
      bleeding: this.playerBleeding,
      crouching: this.wasCrouching,
      beingChased: this.spider.isChasingOrAlert,
    });
  }

  private canStandUp(): boolean {
    const footY = this.position.y;
    const crouchTop = footY + this.crouchPlayerHeight;
    const standTop = footY + this.standingPlayerHeight;

    for (const col of this.colliders) {
      const b = col.box;
      if (b.min.y < crouchTop - 0.02 || b.min.y >= standTop) continue;
      const closestX = Math.max(b.min.x, Math.min(this.position.x, b.max.x));
      const closestZ = Math.max(b.min.z, Math.min(this.position.z, b.max.z));
      const dx = this.position.x - closestX;
      const dz = this.position.z - closestZ;
      if (dx * dx + dz * dz < this.playerRadius * this.playerRadius) {
        return false;
      }
    }
    return true;
  }

  private syncCamera(bobOffset: number): void {
    const baseCrouchEye =
      this.standingEyeHeight +
      (this.crouchEyeHeight - this.standingEyeHeight) * this.crouchAmount;
    const slideAmt = this.slideState.slideAmount;
    const currentEyeHeight =
      baseCrouchEye + (this.slideEyeHeight - baseCrouchEye) * slideAmt;

    // Impulso dinâmico sutil de FOV durante o deslize no chão (+ a seda
    // fechando o campo de visão enquanto o operador está amarrado).
    const webBound = this.webStruggle.current.bound01;
    const webStrain =
      Math.max(0, Math.min(1, this.webStruggle.current.strain01)) * webBound;
    this.setCameraFov(
      this.settingsStore.value.fov + slideAmt * 5.5 - webBound * 3.4 + webStrain * 2.6
    );

    const shakeScale = this.settingsStore.value.screenShakeIntensity / 100;
    const shakeX =
      this.cameraShake > 0.001
        ? (Math.random() - 0.5) * 2 * this.cameraShake * shakeScale
        : 0;
    const shakeY =
      this.cameraShake > 0.001
        ? (Math.random() - 0.5) * 2 * this.cameraShake * shakeScale
        : 0;

    // Leve oscilação sutil quando muito ferido (<26% vida) + inclinação tática do deslize
    const woundedSway =
      this.playerHealth < 26 ? Math.sin(this.elapsed * 2.1) * 0.016 : 0;
    const slideTilt = -0.058 * slideAmt;

    // Luta contra a teia: o capacete tomba, afunda no casulo e é sacudido a
    // cada arranco — tudo proporcional ao quanto o operador está preso.
    const web = this.webStruggle.current;
    let webPitch = 0;
    let webYaw = 0;
    let webRoll = 0;
    let webLift = 0;
    let webForward = 0;
    let webSide = 0;
    if (webBound > 0.001) {
      const yank = web.yank * webBound;
      const breath = web.breath * webBound;
      const tremor = web.tremor * webBound;
      const sway = web.sway * webBound;
      webPitch = -0.05 * webStrain + 0.055 * yank + breath * 0.007 + tremor * 0.005;
      webYaw = sway * 0.014 + tremor * 0.01;
      webRoll = sway * 0.02 + tremor * 0.014 + yank * 0.022;
      webLift = -0.055 - webStrain * 0.03 + Math.max(0, yank) * 0.05 + breath * 0.005;
      // A seda segura o tronco; no arranco o corpo avança e volta esticado.
      webForward = 0.03 * webBound - yank * 0.07;
      webSide = sway * 0.02;
    }

    const sinYaw = Math.sin(this.yaw);
    const cosYaw = Math.cos(this.yaw);
    this.camera.position.set(
      this.position.x + shakeX - sinYaw * webForward + cosYaw * webSide,
      currentEyeHeight + bobOffset + this.staminaChestHeaveY + shakeY + webLift,
      this.position.z - cosYaw * webForward - sinYaw * webSide
    );
    const euler = new THREE.Euler(
      this.pitch + this.staminaBreathPitch + webPitch,
      this.yaw + webYaw,
      woundedSway + slideTilt + webRoll,
      'YXZ'
    );
    this.camera.quaternion.setFromEuler(euler);
  }

  private readonly rankedLightScratch: Array<{
    position: THREE.Vector3;
    intensity: number;
    d2: number;
  }> = [];

  // ===== Sistema inteligente de otimização =====
  /** Mede o tempo de quadro e decide quanta qualidade o hardware aguenta. */
  private readonly perfGovernor: DoomPerfGovernor;
  /** Painel opcional de telemetria ao vivo. */
  private readonly perfHud: DoomPerfHud;
  /** Revisão já aplicada: evita reescrever estado a cada quadro. */
  private appliedLeversRevision = -1;
  private perfLightsBudget: number = MAX_DOOM_LIGHTS;
  private lightRankIntervalMs = 0;
  private lastLightRankMs = -1;
  private nearestFlarePos: THREE.Vector3 | null = null;
  private nearestFlareDist = Infinity;
  private nearestFlareLife = 0;
  /** Teto de quadros por segundo; 0 = sem limitador. */
  private frameCapMs = 0;
  /** Penalidade aplicada quando a janela perde o foco. */
  private unfocusedPenalty = false;
  /** Quando o foco foi perdido, para não penalizar uma alternada rápida. */
  private focusLostAtMs = 0;
  /** Menor intervalo entre chamadas do rAF observado: o vsync da tela. */
  private displayIntervalMs = 0;
  private lastRafCallbackMs = 0;
  /** Último retrato do governador, para o painel continuar legível na pausa. */
  private lastPerfSnapshot: PerfGovernorSnapshot | null = null;

  /** Direção (espaço de câmera) da lâmpada que mais ilumina o jogador. */
  private readonly viewmodelLightDir = new THREE.Vector3();
  private readonly cameraInverseQuat = new THREE.Quaternion();

  private updateFlickeringLightsAndAudio(): void {
    const listenerPos = this.spectatorMode ? this.camera.position : this.position;
    let nearestLamp: THREE.Vector3 | null = null;
    let nearestDist = Infinity;
    let nearestJustFlickered = false;

    const totalLightPool = this.lights.length + this.annexLights.length;
    while (this.rankedLightScratch.length < totalLightPool) {
      this.rankedLightScratch.push({
        position: new THREE.Vector3(),
        intensity: 0,
        d2: 0,
      });
    }

    const allowFlicker = this.settingsStore.value.lightFlicker;
    for (let i = 0; i < this.lights.length; i++) {
      const src = this.lights[i];
      const sample = allowFlicker
        ? evaluateDoomLightFlicker(src, this.elapsed)
        : {
            intensity: src.baseIntensity,
            isDim: false,
            panelEmission: 1.0,
          };
      const isDim = sample.isDim;
      const curIntensity = sample.intensity;

      // Sincroniza o brilho emissivo do próprio painel/tubo de LED físico na parede ou no teto!
      syncLightPanelEmissionAttribute(
        this.lightPanelEmissionAttr,
        src,
        sample.panelEmission
      );

      const justFlickered = isDim && !this.prevLightDimState[i];
      this.prevLightDimState[i] = isDim;

      const dx = src.position.x - listenerPos.x;
      const dz = src.position.z - listenerPos.z;
      const d2 = dx * dx + dz * dz;
      const d = Math.sqrt(d2);
      if (d < nearestDist) {
        nearestDist = d;
        nearestLamp = src.position;
        nearestJustFlickered = justFlickered;
      }

      const slot = this.rankedLightScratch[i];
      slot.position = src.position;
      slot.intensity = curIntensity;
      slot.d2 = d2;
    }

    for (let j = 0; j < this.annexLights.length; j++) {
      const aSrc = this.annexLights[j];
      const sample = allowFlicker
        ? evaluateDoomLightFlicker(aSrc, this.elapsed)
        : {
            intensity: aSrc.baseIntensity,
            isDim: false,
            panelEmission: 1.0,
          };
      const dx = aSrc.position.x - listenerPos.x;
      const dz = aSrc.position.z - listenerPos.z;
      const d2 = dx * dx + dz * dz;
      const slot = this.rankedLightScratch[this.lights.length + j];
      slot.position = aSrc.position;
      slot.intensity = sample.intensity;
      slot.d2 = d2;
    }

    this.rankedLightScratch.length = totalLightPool;

    // Ranking e envio para a GPU: amostrados conforme o orçamento atual.
    const rankNowMs = this.elapsed * 1000;
    if (
      this.lightRankIntervalMs <= 0 ||
      this.lastLightRankMs < 0 ||
      rankNowMs - this.lastLightRankMs >= this.lightRankIntervalMs
    ) {
      this.lastLightRankMs = rankNowMs;
      this.rankAndUploadLights(listenerPos);
    }

    if (!(this.pauseMenu.open && !this.multiplayer)) {
      this.sound.updateSpatialLampAudio(
        listenerPos,
        this.yaw,
        nearestLamp,
        nearestDist,
        nearestJustFlickered
      );
      this.sound.updateSpatialFlareAudio(
        listenerPos,
        this.yaw,
        this.nearestFlarePos,
        this.nearestFlareDist,
        this.nearestFlareLife
      );
    }
  }

  /**
   * Ordena as luminárias por distância, preenche os uniformes do shader e
   * calcula de onde vem a luz que está batendo no jogador.
   *
   * Pode rodar mais devagar que o quadro: o ranking e o envio para a GPU são
   * caros (ordenação + escrita em uniformes), mas a cena muda pouco em 100 ms.
   */
  private rankAndUploadLights(listenerPos: THREE.Vector3): void {
    this.rankedLightScratch.sort((a, b) => a.d2 - b.d2);

    const flares = this.worldItems.getActiveFlares();
    const allyFlashLights =
      this.multiplayer?.getActiveAllyFlashlightLights() ?? [];
    const reservedForDynamic = Math.min(
      flares.length + allyFlashLights.length,
      10
    );
    const lightBudget = Math.max(
      PERF_LIGHTS_MIN,
      Math.min(MAX_DOOM_LIGHTS, this.perfLightsBudget)
    );
    const staticSlots = Math.max(
      0,
      Math.min(this.rankedLightScratch.length, lightBudget - reservedForDynamic)
    );

    let totalLights = 0;
    for (let i = 0; i < staticSlots; i++) {
      const chosen = this.rankedLightScratch[i];
      this.sharedUniforms.uLightPositions.value[totalLights].copy(
        chosen.position
      );
      this.sharedUniforms.uLightIntensities.value[totalLights] =
        chosen.intensity;
      totalLights++;
    }

    let nearestFlarePos: THREE.Vector3 | null = null;
    let nearestFlareDist = Infinity;
    let nearestFlareLife = 0;
    for (let f = 0; f < flares.length; f++) {
      const fl = flares[f];
      const d = Math.hypot(
        fl.position.x - listenerPos.x,
        fl.position.z - listenerPos.z
      );
      if (d < nearestFlareDist) {
        nearestFlareDist = d;
        nearestFlarePos = fl.position;
        nearestFlareLife = fl.remainingSec;
      }
    }

    for (let f = 0; f < flares.length && totalLights < lightBudget; f++) {
      const fl = flares[f];
      const fade = Math.min(1, fl.remainingSec / 2.5);
      const jitter = 0.84 + 0.16 * Math.sin(this.elapsed * 31 + f * 2);
      this.sharedUniforms.uLightPositions.value[totalLights].copy(fl.position);
      this.sharedUniforms.uLightIntensities.value[totalLights] =
        0.92 * fade * jitter;
      totalLights++;
    }

    for (
      let a = 0;
      a < allyFlashLights.length && totalLights < lightBudget;
      a++
    ) {
      const al = allyFlashLights[a];
      this.sharedUniforms.uLightPositions.value[totalLights].copy(al.position);
      this.sharedUniforms.uLightIntensities.value[totalLights] = al.intensity;
      totalLights++;
    }
    this.sharedUniforms.uLightCount.value = totalLights;

    // Quanta luz está chegando ao jogador e de onde ela vem. O modelo em 1ª
    // pessoa (lanterna e mãos) usa isso para ficar iluminado perto das
    // arandelas/plafons e afundar no escuro junto com o cenário.
    let playerLight = 0;
    let bestPlayerLight = 0;
    let lampDirX = 0;
    let lampDirY = 0.5;
    let lampDirZ = 0.5;
    for (let i = 0; i < totalLights; i++) {
      const lp = this.sharedUniforms.uLightPositions.value[i];
      const li = this.sharedUniforms.uLightIntensities.value[i];
      const dx = lp.x - listenerPos.x;
      const dy = lp.y - listenerPos.y;
      const dz = lp.z - listenerPos.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const atten = Math.max(0, Math.min(1, 1 - d / 9.2));
      const contribution = atten * atten * li;
      playerLight += contribution;
      if (contribution > bestPlayerLight) {
        bestPlayerLight = contribution;
        const len = Math.max(d, 0.0001);
        lampDirX = dx / len;
        lampDirY = dy / len;
        lampDirZ = dz / len;
      }
    }
    this.viewmodelLightDir
      .set(lampDirX, lampDirY, lampDirZ)
      .applyQuaternion(
        this.cameraInverseQuat.copy(this.camera.quaternion).invert()
      );
    this.flashlight.applyWorldLighting(
      playerLight,
      this.viewmodelLightDir.x,
      this.viewmodelLightDir.y,
      this.viewmodelLightDir.z
    );

    // Guardado para o áudio espacial, que roda em todo quadro mesmo quando o
    // ranking das luzes é amostrado num ritmo menor.
    this.nearestFlarePos = nearestFlarePos;
    this.nearestFlareDist = nearestFlareDist;
    this.nearestFlareLife = nearestFlareLife;
  }


  destroy(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.permadeathTimerId) {
      window.clearTimeout(this.permadeathTimerId);
      this.permadeathTimerId = 0;
    }
    cancelAnimationFrame(this.rafId);
    this.abortCtrl.abort();
    this.unsubscribeSettings?.();
    this.unsubscribeSettings = null;
    this.sound.setWorldPaused(false);
    this.sound.setFocusMuted(false);
    unlockSystemKeyboardKeys();
    this.localAfkBannerEl.remove();
    this.roomBannerEl.remove();
    this.doorLockPromptEl.remove();
    this.cocoonHudEl.remove();
    this.spectatorHudEl.remove();
    this.danceHudEl.remove();
    this.shotgunObjectiveEl.remove();
    this.danceMenu.destroy();
    this.shotgun.dispose();
    this.specialRoomDoors.dispose();
    this.pauseMenu.destroy();
    this.perfHud.dispose();
    this.touchControls.destroy();
    this.multiplayer?.destroy();
    this.multiplayer = null;
    this.radar.destroy();
    this.inventory.destroy();
    this.compositor.dispose();
    this.renderer.dispose();
    this.sound.stopDungeonAtmosphere();
  }
}
