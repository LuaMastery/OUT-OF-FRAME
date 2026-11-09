import * as THREE from 'three';
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
import { DoomMultiplayerCoordinator } from '../multiplayer/DoomMultiplayerCoordinator';
import {
  ActiveRoomSession,
  isPlayerConsideredAfk,
} from '../multiplayer/MultiplayerService';
import {
  createRandomArenaLayout,
  createRandomArenaSeed,
  hashArenaSeed,
} from './DoomArenaRandomizer';
import { DoomAstronaut } from './DoomAstronaut';
import { DoomFlashlight } from './DoomFlashlight';
import { DoomInventory } from './DoomInventory';
import {
  buildDoomLabyrinth,
  DoomLightSource,
  evaluateDoomLightFlicker,
  isStoneSectorWorld,
  syncLightPanelEmissionAttribute,
  worldToGridCell,
} from './DoomMazeBuilder';
import { DoomPauseMenu } from './DoomPauseMenu';
import { DoomRadar } from './DoomRadar';
import {
  AstronautRagdoll,
  computeCollisionSafeRagdollCamera,
  computeWalkableDragPolyline,
  DragPolylinePath,
  sampleDragPolyline,
} from './DoomRagdoll';
import { DoomRoomId, getThemedRoomAtCell } from './DoomRooms';
import {
  DoomGameSettings,
  DoomSettingsStore,
  resolutionPresetToHeight,
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
  private lightPanelEmissionAttr: THREE.BufferAttribute | null = null;
  private prevLightDimState: boolean[] = [];

  private readonly position = new THREE.Vector3();
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
  private suppressAutoPauseOnUnlockUntilMs = 0;
  private ignoreEscapeKeyUntilMs = 0;
  private currentBaseDesktopFov = 74;
  private readonly staminaState = createInitialStaminaState();
  private staminaChestHeaveY = 0;
  private staminaBreathPitch = 0;
  private readonly slideState = createInitialSlideState();

  // Sinais vitais
  private playerHealth = 100;
  private playerSanity = 100;
  private lanternBattery = 100;
  private playerBleeding = false;
  private cameraShake = 0;

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
  private currentAbductionMode: SpiderCinematicMode | null = null;
  private currentAbductionProgress = 0;
  private readonly currentAbductionSpiderPos = new THREE.Vector3();
  private permadeathTimerId = 0;

  private keys = new Set<string>();
  private interactQueued = false;
  private struggleQueued = false;
  private engaged = false;
  private pointerLocked = false;
  private wasFullscreen = false;
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
  private readonly cocoonHudEl: HTMLDivElement;
  private readonly cocoonTitleEl: HTMLDivElement;
  private readonly cocoonSubEl: HTMLDivElement;
  private readonly cocoonBarFillEl: HTMLDivElement;
  private readonly cocoonHintEl: HTMLDivElement;
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
      '[E / ESPAÇO] Pedir Socorro no Rádio  •  [B] Gritar por Voz 3D';
    this.cocoonHudEl.append(
      this.cocoonTitleEl,
      this.cocoonSubEl,
      barTrack,
      this.cocoonHintEl
    );
    this.viewportEl.appendChild(this.cocoonHudEl);

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: false,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setClearColor(0x000000, 1);

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

    // Gera layout aleatório a cada partida (caixas, itens, spawn do jogador, ninho, teias e aranha),
    // mantendo o mundo sincronizado por código de sala no Co-op enquanto o spawn de cada jogador varia!
    const arenaLayout = createRandomArenaLayout(
      initialMultiplayerSession
        ? {
            worldSeed: hashArenaSeed(
              `oof-arena-world:${initialMultiplayerSession.roomCode}`
            ),
            playerSeed: createRandomArenaSeed(),
          }
        : {}
    );

    const textures = createDoomTextures();
    const maze = buildDoomLabyrinth(
      this.scene,
      textures,
      this.sharedUniforms,
      arenaLayout
    );

    this.colliders = maze.colliders;
    this.lights = maze.lights;
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
      onUseFlare: () => {
        if (this.webManager.isLockedInMultiplayerCocoon) {
          this.sound.playStruggleEffort();
          this.multiplayer?.emitCocoonDistressCall(
            this.position,
            this.cocoonDevourTimerSec
          );
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
          this.multiplayer?.emitCocoonDistressCall(
            this.position,
            this.cocoonDevourTimerSec
          );
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
        const interruptedDrag =
          this.multiplayer?.tryInterruptSpiderAbduction(
            this.position,
            this.spider.position,
            'knife'
          ) ?? false;
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
            interruptedDrag ||
            rescuedAlly,
        };
      },
      onUseKey: () => {
        this.flashlight.triggerQuickItemAction('key');
        this.astronaut.setArmInUse('left', true);
      },
      onToggleRadar: () => {
        return this.toggleRadarHud();
      },
      onOpenRequest: () => {
        if (
          this.activeSequence !== 'NONE' ||
          this.inventory.gameOverVisible ||
          this.pauseMenu.open
        ) {
          return;
        }
        this.suppressAutoPauseOnUnlockUntilMs = performance.now() + 350;
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
    });

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
        this.interactQueued = true;
        this.struggleQueued = true;
      },
      onPushToTalkHoldChange: (held) => {
        this.multiplayer?.setPushToTalkHeld(held);
      },
      onPingPress: () => {
        if (!this.multiplayer) return;
        const camDir = new THREE.Vector3(0, 0, -1).applyQuaternion(
          this.camera.quaternion
        );
        this.multiplayer.emitTacticalPing(
          this.camera.position,
          camDir,
          this.spider.position,
          this.elapsed
        );
      },
      onRadioChatPress: () => {
        if (!this.multiplayer || this.pauseMenu.open) return;
        this.suppressAutoPauseOnUnlockUntilMs = performance.now() + 350;
        this.keys.clear();
        this.touchControls.resetTransientInputs();
        this.multiplayer.openRadioChatInput();
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
    this.unsubscribeSettings = this.settingsStore.subscribe((s) => {
      this.applySettings(s);
    });
    this.applySettings(this.settingsStore.value);

    this.syncCamera(0);
    this.bindInput();
    window.addEventListener('resize', () => this.onResize(), {
      signal: this.abortCtrl.signal,
    });
  }

  private applySettings(s: Readonly<DoomGameSettings>): void {
    const targetH = resolutionPresetToHeight(s.resolutionHeight);
    if (this.compositor.getResolution().height !== targetH) {
      const w = Math.max(1, this.viewportEl.clientWidth || window.innerWidth);
      const h = Math.max(1, this.viewportEl.clientHeight || window.innerHeight);
      this.compositor.setTargetHeight(targetH, w, h);
    }
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
    this.flashlight.setHeadBobMultiplier(s.headBobIntensity / 100);
    this.inventory.setUserInterfaceSettings({
      hubIdleOpacityPercent: s.shortcutsHubIdleOpacity,
      bloodOverlayPercent: s.bloodOverlayScale,
    });

    if (this.activeSequence === 'NONE') {
      this.setCameraFov(s.fov + this.slideState.slideAmount * 5.5);
    }

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
    this.suppressAutoPauseOnUnlockUntilMs = performance.now() + 950;
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
    this.suppressAutoPauseOnUnlockUntilMs = performance.now() + 950;
    this.attachMultiplayerSession(multiplayerSession);
    this.pauseMenu.setMultiplayerMode(Boolean(multiplayerSession));
    this.pauseMenu.setOpen(false, 'main', true);
    this.pauseMenu.setHudSuppressed(false);
    this.inventory.setPauseMenuHidden(false);
    this.sound.setWorldPaused(false);
    this.engaged = true;
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

  private finalizePermanentDeath(): void {
    if (this.disposed) return;
    if (this.permadeathTimerId) {
      window.clearTimeout(this.permadeathTimerId);
      this.permadeathTimerId = 0;
    }
    this.sound.setWorldPaused(false);
    this.cocoonHudEl.classList.remove('is-visible', 'is-critical');
    this.onPermanentDeathExit?.();
  }

  private closeInventoryAndLock(fromPointerGesture = false): void {
    this.suppressAutoPauseOnUnlockUntilMs = performance.now() + 950;
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
    this.suppressAutoPauseOnUnlockUntilMs = performance.now() + 950;
    this.ignoreEscapeKeyUntilMs = performance.now() + 260;
    this.inventory.setOpen(false, true);
    this.keys.clear();
    this.touchControls.resetTransientInputs();
    this.isDragging = false;
    this.pauseMenu.setOpen(true, 'main');
  }

  private requestCanvasPointerLockOnly(): void {
    if (
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
    this.suppressAutoPauseOnUnlockUntilMs = Math.max(
      this.suppressAutoPauseOnUnlockUntilMs,
      performance.now() + 950
    );
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

        if (e.code === 'Tab' && !e.repeat) {
          const opened = this.inventory.toggle();
          this.keys.clear();
          this.isDragging = false;
          if (opened) {
            this.suppressAutoPauseOnUnlockUntilMs = performance.now() + 450;
            try {
              document.exitPointerLock?.();
            } catch {
              // ignorar
            }
          } else {
            this.suppressAutoPauseOnUnlockUntilMs = performance.now() + 950;
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

        // Teclas [Esc] ou [P] durante o jogo abrem a Tela de Pausa & Configurações
        if (
          (e.code === 'Escape' || e.code === 'KeyP') &&
          !this.inventory.open &&
          !e.repeat
        ) {
          e.preventDefault();
          e.stopPropagation();
          if (
            e.code === 'Escape' &&
            performance.now() <= this.ignoreEscapeKeyUntilMs
          ) {
            return;
          }
          this.ignoreEscapeKeyUntilMs = performance.now() + 260;
          this.pauseMenu.setOpen(true);
          return;
        }

        // Atalho Multiplayer Co-op: [T] Rádio / Chat rápido (fecha o inventário automaticamente se estiver aberto)
        if (this.multiplayer && e.code === 'KeyT' && !e.repeat) {
          e.preventDefault();
          e.stopPropagation();
          this.suppressAutoPauseOnUnlockUntilMs = performance.now() + 350;
          this.keys.clear();
          this.isDragging = false;
          this.inventory.setOpen(false);
          this.multiplayer.setPushToTalkHeld(false);
          this.multiplayer.openRadioChatInput();
          return;
        }

        if (this.inventory.open) {
          return;
        }

        // Atalhos rápidos [1], [2], [3]: pega e usa o item imediatamente sem abrir o Tab!
        if (
          !e.repeat &&
          (e.code === 'Digit1' ||
            e.code === 'Numpad1' ||
            e.code === 'Digit2' ||
            e.code === 'Numpad2' ||
            e.code === 'Digit3' ||
            e.code === 'Numpad3')
        ) {
          const quickIdx =
            e.code === 'Digit1' || e.code === 'Numpad1'
              ? 0
              : e.code === 'Digit2' || e.code === 'Numpad2'
                ? 1
                : 2;
          this.inventory.useQuickSlot(quickIdx);
          return;
        }

        // Tecla [Q]: aciona imediatamente o atalho destacado na HUB inferior
        if (e.code === 'KeyQ' && !e.repeat) {
          this.inventory.useSelectedQuickSlot();
          return;
        }

        // Atalho Multiplayer Co-op: [V] Sinalizador 3D de posição!
        if (this.multiplayer && e.code === 'KeyV' && !e.repeat) {
          const camDir = new THREE.Vector3(0, 0, -1).applyQuaternion(
            this.camera.quaternion
          );
          this.multiplayer.emitTacticalPing(
            this.camera.position,
            camDir,
            this.spider.position,
            this.elapsed
          );
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
      },
      { capture: true, passive: false, signal: this.abortCtrl.signal }
    );

    // Roda do mouse seleciona/percorre os atalhos [1]–[3] na HUB inferior, tornando-a bem visível!
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
        const wheelDir: 1 | -1 =
          (e.deltaY > 0 ? 1 : -1) *
            (this.settingsStore.value.invertWheelShortcuts ? -1 : 1) >
          0
            ? 1
            : -1;
        this.inventory.cycleQuickSlotSelection(wheelDir);
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
        // Quando o jogador pressiona Esc durante o jogo, o navegador solta o Pointer Lock:
        // abrimos imediatamente a Tela de Pausa para que ele veja o cursor e todas as opções!
        if (
          wasLocked &&
          !this.pointerLocked &&
          this.engaged &&
          !this.disposed &&
          !this.pauseMenu.open &&
          !this.inventory.open &&
          !this.inventory.gameOverVisible &&
          !this.multiplayer?.isChatTyping &&
          this.activeSequence === 'NONE' &&
          performance.now() > this.suppressAutoPauseOnUnlockUntilMs
        ) {
          this.ignoreEscapeKeyUntilMs = performance.now() + 260;
          this.pauseMenu.setOpen(true);
        }
      },
      sig
    );

    document.addEventListener(
      'fullscreenchange',
      () => {
        const prevFs = this.wasFullscreen;
        this.wasFullscreen = Boolean(document.fullscreenElement);
        // Caso o navegador consuma o Esc apenas saindo da Tela Cheia (sem Pointer Lock ativo),
        // abre o Menu de Pausa de forma confiável logo no primeiro toque!
        if (
          prevFs &&
          !this.wasFullscreen &&
          this.engaged &&
          !this.disposed &&
          !this.pauseMenu.open &&
          !this.inventory.open &&
          !this.inventory.gameOverVisible &&
          !this.multiplayer?.isChatTyping &&
          this.activeSequence === 'NONE' &&
          performance.now() > this.suppressAutoPauseOnUnlockUntilMs
        ) {
          this.ignoreEscapeKeyUntilMs = performance.now() + 260;
          this.pauseMenu.setOpen(true);
        }
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
        if (
          e.button === 2 &&
          this.inventory.hasWheelSelectedQuickSlot()
        ) {
          e.preventDefault();
          this.inventory.clearWheelQuickSlotSelection();
          return;
        }
        if (e.button === 0) {
          if (
            this.inventory.hasWheelSelectedQuickSlot() &&
            (hadPointerLockBeforeClick || this.inventory.isWheelSelectionRecent())
          ) {
            this.inventory.useWheelSelectedQuickSlot();
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
    this.renderer.setSize(w, h);
    this.compositor.resize(w, h);
  }

  start(): void {
    this.lastRaf = performance.now();
    const loop = (now: number) => {
      if (this.disposed) return;
      const realDt = Math.max(0.0005, (now - this.lastRaf) / 1000);
      const dt = Math.min(0.08, realDt);
      this.lastRaf = now;

      const res = this.compositor.getResolution();
      this.pauseMenu.updateTelemetry(realDt, res.width, res.height);
      this.pauseMenu.setHudSuppressed(
        !this.engaged ||
          this.inventory.gameOverVisible ||
          this.activeSequence !== 'NONE'
      );

      // Em Modo Solo, abrir a Tela de Pausa congela 100% da simulação física/IA/tempo (dt),
      // mantendo apenas a renderização do quadro 3D para pré-visualizar ajustes de Vídeo em tempo real!
      const soloSimulationPaused = this.pauseMenu.open && !this.multiplayer;
      if (!soloSimulationPaused) {
        this.update(dt);
      }

      // Durante o desmaio, arrasto pela aranha, casulo ou morte, nenhum modelo 3D em 1ª pessoa pode aparecer na tela!
      const showViewmodel =
        this.activeSequence === 'NONE' ||
        (this.activeSequence !== 'DEAD_TERMINATED' &&
          this.seqTime < 0.42 &&
          this.flashlight.isVisibleInView);
      this.compositor.render(
        this.renderer,
        this.scene,
        this.camera,
        showViewmodel ? this.flashlight.viewScene : undefined,
        showViewmodel ? this.flashlight.viewCamera : undefined
      );
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  /**
   * Acionado quando a Aranha Gigante alcança o jogador!
   * - Em Multiplayer (se ainda não estava preso no Casulo do Ninho): Derruba em Ragdoll desmaiado ->
   *   Estende os 4 Tentáculos -> Puxa pelos corredores até prender na Teia (exigindo resgate dos amigos antes de ser devorado)!
   * - Se já estava preso no Casulo sem ser salvo a tempo (ou <=36% vida no Modo Solo): DEVORADO / MORTE PERMANENTE!
   */
  private triggerSpiderCatch(overrideSpiderPos?: THREE.Vector3): void {
    if (this.activeSequence !== 'NONE') return;

    const wasLockedInCocoon = this.webManager.isLockedInMultiplayerCocoon;

    this.suppressAutoPauseOnUnlockUntilMs = performance.now() + 950;
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

    const shouldAbductToWeb = this.multiplayer
      ? !wasLockedInCocoon
      : this.playerHealth > 36;

    if (shouldAbductToWeb) {
      this.activeSequence = 'ABDUCTION_TO_WEB';
      this.syncInventoryVitals();
      this.sound.playSpiderBrutalAttack();
    } else {
      this.activeSequence = 'PERMADEATH_EXECUTION';
      this.playerHealth = 0;
      this.playerBleeding = true;
      if (wasLockedInCocoon) {
        this.multiplayer?.notifyLocalPlayerDevoured();
      }
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
        this.inventory.showGameOver();
        this.permadeathTimerId = window.setTimeout(() => {
          this.finalizePermanentDeath();
        }, 3800);
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
    // ESTÁGIO 1 (0.00s -> 1.25s): BOTE BRUTAL, QUEDA EM RAGDOLL & TENTÁCULOS AGARRANDO!
    // ------------------------------------------------------------------------
    if (t < 1.25) {
      const u = t / 1.25;
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
    // ESTÁGIO 2 (1.25s -> 1.95s): DESMAIO & TENTÁCULOS TENSIONANDO O RAGDOLL
    // ------------------------------------------------------------------------
    if (t < 1.95) {
      const u = (t - 1.25) / 0.7;
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
    // ESTÁGIO 3 (1.95s -> 5.15s): TENTÁCULOS PUXANDO O RAGDOLL PELOS CORREDORES ATÉ A TEIA!
    // ------------------------------------------------------------------------
    if (t < 5.15) {
      const u = (t - 1.95) / 3.2;
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
    // ESTÁGIO 4 (5.15s -> 6.35s): TENTÁCULOS PRENDENDO O RAGDOLL NA TEIA & TECENDO CASULO!
    // ------------------------------------------------------------------------
    if (t < 6.35) {
      const u = (t - 5.15) / 1.2;
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
    // ESTÁGIO 5 (6.35s -> 7.65s): DESPERTAR PRESO NA TEIA DO NINHO!
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
        this.multiplayer.notifyLocalAbductionFinished();
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

    const uWake = Math.min(1, (t - 6.35) / 1.3);
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

    if (t >= 7.65) {
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

  private update(dt: number): void {
    if (!this.engaged || this.disposed) return;

    const isLocalAfk = this.refreshLocalAfkStatus();

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

    if (this.activeSequence !== 'NONE') {
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
      const beingDragged =
        this.currentAbductionMode === 'DRAGGING_TO_WEB' ||
        this.currentAbductionMode === 'STRIKE_ATTACK';
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
            this.seqTime >= 6.35,
          cocoonLocked: Boolean(this.multiplayer) && this.seqTime >= 6.35,
          devourSecondsLeft: this.cocoonDevourTimerSec,
          inSequence: this.seqTime < 6.35,
          beingDragged,
          abductionMode: this.currentAbductionMode,
          abductionProgress: this.currentAbductionProgress,
          abductionSpiderPos: this.currentAbductionSpiderPos,
          dead: this.activeSequence === 'PERMADEATH_EXECUTION',
          afk: isLocalAfk,
        },
        this.spider.getNetworkSnapshot(this.multiplayer?.localPlayerId ?? null),
        true
      );
      this.updateFlickeringLightsAndAudio();
      return;
    }

    if (this.inventory.gameOverVisible) {
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

    const hasKnife = this.inventory.hasItem('rusty_knife');

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
      }
    );
    if (strugglePressed && this.webManager.isPlayerEnsnared) {
      this.sound.playStruggleEffort();
    }

    // Em Multiplayer, enquanto estiver 100% preso no Casulo de Teia do Ninho:
    // - Não pode sair sozinho; conta regressiva até a Aranha voltar faminta para devorá-lo!
    // - [E] ou [Espaço] emite alerta SOS no rádio para os amigos virem cortá-lo a tempo!
    if (this.webManager.isLockedInMultiplayerCocoon) {
      if (this.cocoonDevourTimerSec <= 0) {
        this.cocoonDevourMaxSec = this.multiplayer?.hasLivingAllies() ? 45 : 14;
        this.cocoonDevourTimerSec = this.cocoonDevourMaxSec;
      }
      this.cocoonDevourTimerSec = Math.max(0, this.cocoonDevourTimerSec - dt);
      const ratio = Math.max(
        0,
        Math.min(
          1,
          this.cocoonDevourTimerSec / Math.max(1, this.cocoonDevourMaxSec)
        )
      );
      const isCrit = this.cocoonDevourTimerSec <= 14;
      this.cocoonHudEl.classList.add('is-visible');
      this.cocoonHudEl.classList.toggle('is-critical', isCrit);
      this.cocoonBarFillEl.style.width = `${(ratio * 100).toFixed(1)}%`;
      this.cocoonSubEl.textContent = isCrit
        ? `A ARANHA ESTÁ VOLTANDO PARA DEVORAR VOCÊ (${Math.ceil(this.cocoonDevourTimerSec)}s)! GRITE PELO RÁDIO [E / ESPAÇO]!`
        : `CHAME UM AMIGO PARA CORTAR A TEIA [E / FACA] — DEVORAÇÃO EM ${Math.ceil(this.cocoonDevourTimerSec)}s ([ESPAÇO] RÁDIO SOS)`;

      if (interactPressed || strugglePressed) {
        this.sound.playStruggleEffort();
        this.multiplayer?.emitCocoonDistressCall(
          this.position,
          this.cocoonDevourTimerSec
        );
      }

      if (isCrit && !this.cocoonReturnTriggered) {
        this.cocoonReturnTriggered = true;
        this.spider.commandReturnToDevourVictim(this.position);
      }

      if (this.cocoonDevourTimerSec <= 0) {
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
    }

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

    if (this.flashlight.isEquipped && this.lanternBattery > 0) {
      this.lanternBattery = Math.max(0, this.lanternBattery - dt * 0.62);
    }

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

    const spiderHearsSprint =
      sprinting || (isSliding && this.slideState.slideTimer < 0.2);
    const localVoiceLvl = this.multiplayer?.localVoiceLevel ?? 0;

    let spiderOut: { cameraShakeAmount: number; playerDistance: number };
    const remoteAbduction =
      this.multiplayer?.getActiveRemoteAbduction() ?? null;
    const activeFlares = this.worldItems.getActiveFlares();

    // Se houver um sinalizador aceso perto de um aliado sendo arrastado, salva-o automaticamente!
    if (remoteAbduction && this.multiplayer) {
      for (const flItem of activeFlares) {
        if (
          Math.hypot(
            flItem.position.x - remoteAbduction.spiderPos.x,
            flItem.position.z - remoteAbduction.spiderPos.z
          ) <= 5.2 ||
          Math.hypot(
            flItem.position.x - remoteAbduction.victimPos.x,
            flItem.position.z - remoteAbduction.victimPos.z
          ) <= 5.2
        ) {
          this.multiplayer.tryInterruptSpiderAbduction(
            flItem.position,
            remoteAbduction.spiderPos,
            'flare'
          );
          break;
        }
      }
    }

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

    if (interactPressed && this.multiplayer) {
      this.multiplayer.tryRescueNearbyTrappedAlly(
        this.position,
        this.spider.position,
        hasKnife
      );
    }

    const camForward = new THREE.Vector3(0, 0, -1).applyQuaternion(
      this.camera.quaternion
    );
    this.worldItems.updateAndCheckPickups(
      dt,
      this.elapsed,
      this.position,
      this.camera.position,
      camForward,
      interactPressed,
      this.inventory,
      (pickedItemId) => {
        if (pickedItemId === 'field_radar') {
          this.radar.unlockAndActivate();
          this.flashlight.triggerQuickItemAction('radar');
          this.sound.playRadarPing(true);
          this.syncInventoryVitals();
        }
      }
    );

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
      this.worldItems.hasInteractableItemInSight(
        this.position,
        this.camera.position,
        camForward
      )
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
        flashlightOn: fl.beamIntensity > 0.05,
        flashDir: this.sharedUniforms.uFlashlightDir.value,
        health: this.playerHealth,
        bleeding: this.playerBleeding,
        ensnared: this.webManager.isPlayerEnsnared,
        cocoonLocked: this.webManager.isLockedInMultiplayerCocoon,
        devourSecondsLeft: this.cocoonDevourTimerSec,
        inSequence: false,
        dead: false,
        afk: isLocalAfk,
      },
      this.spider.getNetworkSnapshot(
        updatedRemoteAbduction?.allyId ?? null
      ),
      !this.engaged ||
        this.pauseMenu.open ||
        this.inventory.open ||
        this.inventory.gameOverVisible
    );

    this.sharedUniforms.uFlashlightIntensity.value = fl.beamIntensity;
    if (fl.beamIntensity > 0.005) {
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
        this.pitch + fl.aimPitchOffset,
        this.yaw + fl.aimYawOffset,
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
      fl.beamIntensity > 0.05
    );
    this.updateFlickeringLightsAndAudio();
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

  private syncInventoryVitals(): void {
    this.inventory.updateVitalsAndDiegeticFX({
      health: this.playerHealth,
      sanity: this.playerSanity,
      battery: this.lanternBattery,
      flashlightEquipped: this.flashlight.isEquipped,
      radarActive: this.radar.isActive,
      trappedInWeb: this.webManager.isPlayerEnsnared,
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

    // Impulso dinâmico sutil de FOV durante o deslize no chão
    this.setCameraFov(this.settingsStore.value.fov + slideAmt * 5.5);

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

    this.camera.position.set(
      this.position.x + shakeX,
      currentEyeHeight + bobOffset + this.staminaChestHeaveY + shakeY,
      this.position.z
    );
    const euler = new THREE.Euler(
      this.pitch + this.staminaBreathPitch,
      this.yaw,
      woundedSway + slideTilt,
      'YXZ'
    );
    this.camera.quaternion.setFromEuler(euler);
  }

  private readonly rankedLightScratch: Array<{
    position: THREE.Vector3;
    intensity: number;
    d2: number;
  }> = [];

  private updateFlickeringLightsAndAudio(): void {
    let nearestLamp: THREE.Vector3 | null = null;
    let nearestDist = Infinity;
    let nearestJustFlickered = false;

    while (this.rankedLightScratch.length < this.lights.length) {
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

      const dx = src.position.x - this.position.x;
      const dz = src.position.z - this.position.z;
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

    this.rankedLightScratch.length = this.lights.length;
    this.rankedLightScratch.sort((a, b) => a.d2 - b.d2);

    const flares = this.worldItems.getActiveFlares();
    const allyFlashLights =
      this.multiplayer?.getActiveAllyFlashlightLights() ?? [];
    const reservedForDynamic = Math.min(
      flares.length + allyFlashLights.length,
      10
    );
    const staticSlots = Math.min(
      this.rankedLightScratch.length,
      MAX_DOOM_LIGHTS - reservedForDynamic
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
        fl.position.x - this.position.x,
        fl.position.z - this.position.z
      );
      if (d < nearestFlareDist) {
        nearestFlareDist = d;
        nearestFlarePos = fl.position;
        nearestFlareLife = fl.remainingSec;
      }
    }

    for (let f = 0; f < flares.length && totalLights < MAX_DOOM_LIGHTS; f++) {
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
      a < allyFlashLights.length && totalLights < MAX_DOOM_LIGHTS;
      a++
    ) {
      const al = allyFlashLights[a];
      this.sharedUniforms.uLightPositions.value[totalLights].copy(al.position);
      this.sharedUniforms.uLightIntensities.value[totalLights] = al.intensity;
      totalLights++;
    }
    this.sharedUniforms.uLightCount.value = totalLights;

    if (!(this.pauseMenu.open && !this.multiplayer)) {
      this.sound.updateSpatialLampAudio(
        this.position,
        this.yaw,
        nearestLamp,
        nearestDist,
        nearestJustFlickered
      );
      this.sound.updateSpatialFlareAudio(
        this.position,
        this.yaw,
        nearestFlarePos,
        nearestFlareDist,
        nearestFlareLife
      );
    }
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
    this.cocoonHudEl.remove();
    this.pauseMenu.destroy();
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
