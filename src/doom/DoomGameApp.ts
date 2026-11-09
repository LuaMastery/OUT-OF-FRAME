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
} from './DoomMazeBuilder';
import { DoomRadar } from './DoomRadar';
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

  // Estado da animação cinemática de Ataque / Sequestro para a Teia / Morte Permanente
  private activeSequence: ActiveHorrorSequence = 'NONE';
  private seqTime = 0;
  private seqStagedDrag = false;
  private seqStagedWake = false;
  private seqGaspPlayed = false;
  private lastDragPullStep = -1;
  private lastWebSpinStep = -1;
  private readonly strikeOriginPos = new THREE.Vector3();
  private readonly strikeSpiderPos = new THREE.Vector3();
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
  private elapsed = 0;
  private lastRaf = performance.now();
  private rafId = 0;
  private disposed = false;

  private readonly abortCtrl = new AbortController();

  constructor(
    private readonly sound: SoundEngine,
    private readonly onPermanentDeathExit?: () => void,
    initialMultiplayerSession?: ActiveRoomSession
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
        if (this.activeSequence !== 'NONE' || this.inventory.gameOverVisible) {
          return;
        }
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
        this.closeInventoryAndLock();
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
        if (!this.multiplayer) return;
        this.keys.clear();
        this.touchControls.resetTransientInputs();
        this.multiplayer.openRadioChatInput();
      },
    });

    this.syncCamera(0);
    this.bindInput();
    window.addEventListener('resize', () => this.onResize(), {
      signal: this.abortCtrl.signal,
    });
  }

  engageFromTerminal(multiplayerSession?: ActiveRoomSession): void {
    this.lastUserActivityMs = performance.now();
    this.tabHiddenSinceMs = document.hidden ? performance.now() : null;
    this.localAfk = false;
    this.localAfkBannerEl.classList.add('hidden');
    this.attachMultiplayerSession(multiplayerSession);
    this.engaged = true;
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
          this.webManager.clearEnsnarement();
          const lookForward = new THREE.Vector3(
            -Math.sin(this.yaw),
            0,
            -Math.cos(this.yaw)
          );
          this.webManager.slashWebWithKnife(
            this.position,
            lookForward,
            this.sound
          );
          this.sound.playWebCut();
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
    this.onPermanentDeathExit?.();
  }

  private closeInventoryAndLock(): void {
    this.inventory.setOpen(false);
    this.keys.clear();
    this.tryPointerLock(true);
  }

  private requestCanvasPointerLockOnly(): void {
    if (
      this.inventory.open ||
      this.inventory.gameOverVisible ||
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

  private tryPointerLock(fromUserGesture = false): void {
    if (
      this.inventory.open ||
      this.inventory.gameOverVisible ||
      this.activeSequence !== 'NONE'
    ) {
      return;
    }
    if (fromUserGesture) {
      acquireFullscreenAndKeyboardLock(() => {
        this.requestCanvasPointerLockOnly();
      });
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
      this.abortCtrl.signal
    );

    window.addEventListener(
      'keydown',
      (e) => {
        if (!this.engaged || this.disposed) return;
        this.registerUserActivity();

        // Se estiver digitando mensagem de rádio multiplayer, não captura teclas de movimento!
        if (this.multiplayer?.isChatTyping) {
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

        if (e.code === 'Tab' && !e.repeat) {
          const opened = this.inventory.toggle();
          this.keys.clear();
          this.isDragging = false;
          if (opened) {
            try {
              document.exitPointerLock?.();
            } catch {
              // ignorar
            }
          } else {
            this.tryPointerLock(true);
          }
          return;
        }

        if (e.code === 'Escape' && this.inventory.open && !e.repeat) {
          this.closeInventoryAndLock();
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

        // Atalhos Multiplayer Co-op: [T] Rádio / Chat rápido e [V] Sinalizador 3D de posição!
        if (this.multiplayer && e.code === 'KeyT' && !e.repeat) {
          e.preventDefault();
          this.keys.clear();
          this.multiplayer.setPushToTalkHeld(false);
          this.multiplayer.openRadioChatInput();
          return;
        }
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
          this.inventory.open ||
          this.inventory.gameOverVisible ||
          this.activeSequence !== 'NONE'
        ) {
          return;
        }
        if (Math.abs(e.deltaY) < 1) return;
        const now = performance.now();
        if (now - this.lastWheelSelectMs < 75) return;
        this.lastWheelSelectMs = now;
        this.sound.unlock();
        this.inventory.cycleQuickSlotSelection(e.deltaY > 0 ? 1 : -1);
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
        this.pointerLocked = document.pointerLockElement === this.canvas;
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
          this.inventory.open ||
          this.inventory.gameOverVisible ||
          this.activeSequence !== 'NONE'
        ) {
          return;
        }
        this.sound.unlock();
        if (!this.pointerLocked || !document.fullscreenElement) {
          this.tryPointerLock(true);
        }
        if (e.button === 0) {
          this.interactQueued = true;
          this.struggleQueued = true;
        }
        this.isDragging = true;
        this.lastMouseX = e.clientX;
        this.lastMouseY = e.clientY;
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
          this.inventory.open ||
          this.inventory.gameOverVisible ||
          this.activeSequence !== 'NONE'
        ) {
          this.lastMouseX = e.clientX;
          this.lastMouseY = e.clientY;
          return;
        }

        const sens = 0.0022;
        const maxPitch = 1.12;
        if (this.pointerLocked) {
          const dYaw = -e.movementX * sens;
          const prevPitch = this.pitch;
          this.yaw += dYaw;
          this.pitch = Math.max(
            -maxPitch,
            Math.min(maxPitch, this.pitch - e.movementY * sens * 0.78)
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
            Math.min(maxPitch, this.pitch - dy * sens * 0.85)
          );
          this.flashlight.addLookImpulse(dYaw, this.pitch - prevPitch);
        }
      },
      sig
    );
  }

  private onResize(): void {
    if (this.disposed) return;
    const w = window.innerWidth;
    const h = window.innerHeight;
    const aspect = Math.max(1, w) / Math.max(1, h);
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
      const dt = Math.min(0.08, Math.max(0.0005, (now - this.lastRaf) / 1000));
      this.lastRaf = now;
      this.update(dt);
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
   * - Se ainda houver reserva vital (>36%): Ataque brutal -> Desmaio -> Puxado até o Ninho de Teia -> Acorda bem ferido na teia!
   * - Se já estiver gravemente ferido (<=36%): MORTE REAL PERMANENTE!
   */
  private triggerSpiderCatch(overrideSpiderPos?: THREE.Vector3): void {
    if (this.activeSequence !== 'NONE') return;

    this.inventory.setOpen(false);
    this.keys.clear();
    this.touchControls.resetTransientInputs();
    this.touchCrouchLatched = false;
    this.touchAutoUnlatchAfterSlide = false;
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

    this.seqTime = 0;
    this.seqStagedDrag = false;
    this.seqStagedWake = false;
    this.seqGaspPlayed = false;
    this.lastDragPullStep = -1;
    this.lastWebSpinStep = -1;

    if (this.playerHealth > 36) {
      this.activeSequence = 'ABDUCTION_TO_WEB';
      this.syncInventoryVitals();
      this.sound.playSpiderBrutalAttack();
    } else {
      this.activeSequence = 'PERMADEATH_EXECUTION';
      this.playerHealth = 0;
      this.playerBleeding = true;
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
    this.webManager.clearEnsnarement();
    this.spider.interruptAbductionAndFlee(this.position);
    this.inventory.setAbductionScreenFX(0, 0, 0, 0);

    this.roll = 0;
    this.pitch = 0;
    this.cameraShake = 0.06;
    this.setCameraFov(74);
    this.playerHealth = Math.max(this.playerHealth, 38);
    this.playerSanity = Math.max(this.playerSanity, 40);
    boostPlayerStamina(this.staminaState, 65);
    this.sound.playWakeUpGasp();
    this.syncInventoryVitals();
    this.syncCamera(0);
  }

  /**
   * Executa quadro a quadro a cena em 1ª pessoa:
   * 1) Ataque visceral com rasgos de garras e queda no chão (lanterna cai das mãos e apaga!)
   * 2) Desmaio com pálpebras pesadas
   * 3) Visão entreaberta sendo arrastado pelas patas da Aranha Gigante até o Ninho de Teia
   * 4) Aranha colocando o jogador na teia e tecendo seda sobre ele
   * 5) Despertar bem ferido no meio da teia para escapar livremente!
   */
  private updateHorrorSequence(dt: number): void {
    this.seqTime += dt;
    const t = this.seqTime;
    const dropFl = this.flashlight.updateKnockoutDrop(dt, this.lanternBattery);
    if (t >= 0.42) {
      this.flashlight.forceStowImmediate();
    }

    if (this.activeSequence === 'PERMADEATH_EXECUTION') {
      this.astronaut.updateSupineAbductionPose(this.position, this.yaw, 0, false);
      const u = Math.min(1, t / 1.45);
      const slash =
        t < 0.35
          ? 1.0 - t / 0.35
          : t < 0.7
            ? Math.max(0, 0.85 - (t - 0.35) * 2.4)
            : 0;
      const lid = Math.min(1, Math.pow(t / 1.15, 1.5));
      const black = Math.max(0, Math.min(1, (t - 0.55) / 0.85));

      this.inventory.setAbductionScreenFX(slash, lid, black, 0);

      const eyeY = 1.62 * (1 - u) + 0.18 * u;
      this.pitch = 0.38 * u;
      this.roll = -0.32 * u;
      this.cameraShake = 0.14 * (1 - u * 0.5);
      this.setCameraFov(74 + Math.sin(u * Math.PI) * 14);

      this.currentAbductionMode = 'FATAL_EXECUTION';
      this.currentAbductionProgress = u;
      this.currentAbductionSpiderPos.copy(this.strikeSpiderPos);
      this.spider.updateCinematicSequence(
        dt,
        this.elapsed,
        'FATAL_EXECUTION',
        u,
        this.strikeSpiderPos,
        this.strikeOriginPos,
        this.strikeOriginPos
      );

      this.syncCustomSequenceCamera(this.strikeOriginPos, eyeY);
      this.syncDroppedFlashlightBeam(dropFl);

      if (t >= 1.5) {
        this.flashlight.forceStowImmediate();
        this.sharedUniforms.uFlashlightIntensity.value = 0;
        this.activeSequence = 'DEAD_TERMINATED';
        this.setCameraFov(74);
        try {
          document.exitPointerLock?.();
        } catch {
          // ignorar
        }
        this.inventory.showGameOver();
        // Encerra o processo automaticamente após 3.8s caso o jogador não clique antes
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

    // ------------------------------------------------------------------------
    // ESTÁGIO 1 (0.00s -> 1.25s): O BOTE BRUTAL & QUEDA NO CHÃO
    // ------------------------------------------------------------------------
    if (t < 1.25) {
      this.astronaut.updateSupineAbductionPose(this.position, this.yaw, 0, false);
      const u = t / 1.25;
      // Duplo clarão rubro de garras rasgando a tela
      const slashA = t < 0.28 ? 1 - t / 0.28 : 0;
      const slashB =
        t >= 0.18 && t < 0.55 ? 0.92 * (1 - (t - 0.18) / 0.37) : 0;
      const slash = Math.max(slashA, slashB);

      const lid = u > 0.45 ? (u - 0.45) / 0.55 : 0;
      const black = u > 0.72 ? (u - 0.72) / 0.28 : 0;

      this.inventory.setAbductionScreenFX(slash, lid * 0.92, black * 0.65, 0);

      const fallEase = 1 - Math.pow(1 - u, 2.4);
      const eyeY = 1.62 * (1 - fallEase) + 0.3 * fallEase;
      this.pitch = 0.26 * fallEase + Math.sin(t * 28) * 0.06 * (1 - u);
      this.roll = 0.26 * fallEase;
      this.cameraShake = 0.13 * (1 - u * 0.65);
      this.setCameraFov(74 + Math.sin(u * Math.PI) * 16);

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

      this.currentAbductionMode = 'STRIKE_ATTACK';
      this.currentAbductionProgress = u;
      this.currentAbductionSpiderPos.copy(lungePos);
      this.spider.updateCinematicSequence(
        dt,
        this.elapsed,
        'STRIKE_ATTACK',
        u,
        lungePos,
        this.strikeOriginPos,
        this.strikeOriginPos
      );

      this.syncCustomSequenceCamera(this.strikeOriginPos, eyeY);
      this.syncDroppedFlashlightBeam(dropFl);
      return;
    }

    // A partir do desmaio/arrasto/casulo/despertar, garante que o foco e o modelo 3D estejam 100% desligados e guardados!
    this.flashlight.forceStowImmediate();
    this.sharedUniforms.uFlashlightIntensity.value = 0;

    // ------------------------------------------------------------------------
    // ESTÁGIO 2 (1.25s -> 2.05s): DESMAIO PROFUNDO
    // ------------------------------------------------------------------------
    if (t < 2.05) {
      const u = (t - 1.25) / 0.8;
      this.inventory.setAbductionScreenFX(
        0,
        0.92 + 0.08 * Math.min(1, u * 2),
        0.65 + 0.35 * Math.min(1, u * 1.8),
        0
      );

      if (!this.seqStagedDrag && u > 0.65) {
        this.seqStagedDrag = true;
        this.position.copy(this.webManager.dragCorridorStart);
      }

      const dragDir = this.webManager.dragDirection;
      this.currentAbductionMode = 'DRAGGING_TO_WEB';
      this.currentAbductionProgress = 0;
      this.currentAbductionSpiderPos.set(
        this.position.x + dragDir.x * 2.15,
        1.38,
        this.position.z + dragDir.z * 2.15
      );
      if (this.seqStagedDrag) {
        this.spider.updateCinematicSequence(
          dt,
          this.elapsed,
          'DRAGGING_TO_WEB',
          0,
          this.currentAbductionSpiderPos,
          this.position,
          this.position
        );
      }
      this.setCameraFov(68);
      this.astronaut.updateSupineAbductionPose(this.position, this.yaw, 0, false);
      this.syncCustomSequenceCamera(this.position, 0.28);
      return;
    }

    // ------------------------------------------------------------------------
    // ESTÁGIO 3 (2.05s -> 4.65s): ARANHA GIGANTE TE PUXANDO PELO CHÃO ATÉ A TEIA!
    // ------------------------------------------------------------------------
    if (t < 4.65) {
      const u = (t - 2.05) / 2.6;
      const dragDir = this.webManager.dragDirection;
      const lookAtSpiderYaw = Math.atan2(-dragDir.x, -dragDir.z);
      // Movimento em puxões rítmicos ("heave-and-drag") ao longo do corredor até o Ninho!
      const pullCycles = u * 4.0;
      const pullStep = Math.floor(pullCycles);
      if (pullStep !== this.lastDragPullStep) {
        this.lastDragPullStep = pullStep;
        this.sound.playBodyDragPull();
      }
      const frac = pullCycles - pullStep;
      const steppedU = Math.min(
        1,
        (pullStep + frac * frac * (3 - 2 * frac)) / 4.0
      );

      this.position.lerpVectors(
        this.webManager.dragCorridorStart,
        this.webManager.lairCenter,
        steppedU
      );

      // Pálpebras entreabertas grogues com uma piscada pesada no meio do arrasto
      const openFadeIn = Math.min(1, u / 0.18);
      const midBlink = Math.exp(-Math.pow((u - 0.52) / 0.09, 2)) * 0.58;
      const lidClosed = 1 - openFadeIn * 0.66 + midBlink;
      const black = Math.max(0.08, (1 - openFadeIn) * 0.85 + midBlink * 0.4);

      this.inventory.setAbductionScreenFX(
        0,
        Math.min(1, lidClosed),
        Math.min(1, black),
        u > 0.78 ? ((u - 0.78) / 0.22) * 0.3 : 0
      );

      // Olhando direto para a Aranha Gigante andando de costas puxando suas pernas!
      const jolt = Math.sin(pullCycles * Math.PI * 2) * 0.035;
      this.yaw = lookAtSpiderYaw + Math.sin(t * 2.3) * 0.05;
      this.pitch = 0.22 + jolt * 0.9;
      this.roll = -0.17 + Math.sin(pullCycles * Math.PI * 2) * 0.05;
      this.cameraShake = 0.022;
      this.setCameraFov(68);

      const lateralSway = Math.sin(t * 2.1) * 0.08;
      const spiderDragPos = new THREE.Vector3(
        this.position.x + dragDir.x * 2.15 - dragDir.z * lateralSway,
        1.38 + Math.abs(jolt) * 0.8,
        this.position.z + dragDir.z * 2.15 + dragDir.x * lateralSway
      );

      this.currentAbductionMode = 'DRAGGING_TO_WEB';
      this.currentAbductionProgress = u;
      this.currentAbductionSpiderPos.copy(spiderDragPos);
      this.spider.updateCinematicSequence(
        dt,
        this.elapsed,
        'DRAGGING_TO_WEB',
        u,
        spiderDragPos,
        this.position,
        this.position
      );

      this.astronaut.updateSupineAbductionPose(
        this.position,
        this.yaw,
        pullCycles,
        true
      );
      this.syncCustomSequenceCamera(this.position, 0.28 + Math.abs(jolt) * 0.5);
      this.sound.playTensionHeartbeat(0.75);
      return;
    }

    // ------------------------------------------------------------------------
    // ESTÁGIO 4 (4.65s -> 5.85s): COLOCANDO VOCÊ NO NINHO DE TEIA & TECENDO FIOS
    // ------------------------------------------------------------------------
    if (t < 5.85) {
      const u = (t - 4.65) / 1.2;
      const dragDir = this.webManager.dragDirection;
      const lookAtSpiderYaw = Math.atan2(-dragDir.x, -dragDir.z);
      this.position.copy(this.webManager.lairCenter);

      const spinStep = Math.floor(u * 4);
      if (spinStep !== this.lastWebSpinStep) {
        this.lastWebSpinStep = spinStep;
        this.sound.playSpiderWebSpin(0, 1.0);
      }

      // Fios de seda vão cobrindo as bordas enquanto as pálpebras voltam a pesar
      const closeOut = u > 0.58 ? (u - 0.58) / 0.42 : 0;
      const lidClosed = 0.36 + closeOut * 0.64;
      const black = 0.12 + closeOut * 0.88;
      const cocoon = 0.3 + u * 0.58;

      this.inventory.setAbductionScreenFX(0, lidClosed, black, cocoon);

      this.yaw = lookAtSpiderYaw + Math.sin(t * 4.5) * 0.04;
      this.pitch = 0.46;
      this.roll = -0.1 * (1 - u);
      this.cameraShake = 0.015;

      const spiderOverLair = new THREE.Vector3(
        this.position.x + dragDir.x * 1.05,
        1.36,
        this.position.z + dragDir.z * 1.05
      );

      this.currentAbductionMode = 'WEBBING_IN_LAIR';
      this.currentAbductionProgress = u;
      this.currentAbductionSpiderPos.copy(spiderOverLair);
      this.spider.updateCinematicSequence(
        dt,
        this.elapsed,
        'WEBBING_IN_LAIR',
        u,
        spiderOverLair,
        this.position,
        this.position
      );

      this.astronaut.updateSupineAbductionPose(
        this.position,
        this.yaw,
        u * 2,
        true
      );
      this.syncCustomSequenceCamera(this.position, 0.28);
      return;
    }

    // ------------------------------------------------------------------------
    // ESTÁGIO 5 (5.85s -> 7.35s): ACORDANDO BEM FERIDO NO MEIO DA TEIA!
    // (Executado APÓS WEBBING_IN_LAIR terminar 100%, nunca sobrescrevendo o estado!)
    // ------------------------------------------------------------------------
    this.astronaut.updateSupineAbductionPose(this.position, this.yaw, 0, false);
    if (!this.seqStagedWake) {
      this.seqStagedWake = true;
      this.currentAbductionMode = null;
      this.currentAbductionProgress = 0;
      if (this.multiplayer) {
        const observers = this.multiplayer.getObserverWorldPositions(
          this.position,
          this.multiplayer.localPlayerId
        );
        this.spider.finishAbductionRetreat(observers);
        this.multiplayer.notifyLocalAbductionFinished();
      } else {
        this.spider.relocateAwayAfterAbduction();
      }
      this.webManager.placePlayerInWakingLairWeb();
      this.playerHealth = 22;
      this.playerBleeding = true;
      this.playerSanity = 25;
      boostPlayerStamina(this.staminaState, 80);
      // Acorda olhando para o corredor aberto de saída do ninho
      const dragDir = this.webManager.dragDirection;
      this.yaw = Math.atan2(dragDir.x, dragDir.z);
      this.syncInventoryVitals();
    }

    if (!this.seqGaspPlayed) {
      this.seqGaspPlayed = true;
      this.sound.playWakeUpGasp();
    }

    const uWake = Math.min(1, (t - 5.85) / 1.5);
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

    if (t >= 7.35) {
      this.activeSequence = 'NONE';
      this.spider.ensureExitedCinematic(
        this.multiplayer?.getObserverWorldPositions(
          this.position,
          this.multiplayer.localPlayerId
        )
      );
      this.roll = 0;
      this.setCameraFov(74);
      this.astronaut.updateFirstPersonBody(
        this.position,
        this.yaw,
        this.bobPhase,
        0,
        this.crouchAmount,
        this.flashlight.isEquipped,
        this.flashlight.isLeftArmAnimating
      );
      // Mantém os fios do casulo visíveis até o jogador caminhar e rasgar para fora da teia!
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
    const shakeX =
      this.cameraShake > 0.001
        ? (Math.random() - 0.5) * 2 * this.cameraShake
        : 0;
    const shakeY =
      this.cameraShake > 0.001
        ? (Math.random() - 0.5) * 2 * this.cameraShake
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
          ensnared: this.currentAbductionMode === 'WEBBING_IN_LAIR' || this.seqTime >= 5.85,
          inSequence: this.seqTime < 5.85,
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
      this.inventory.open || Boolean(this.multiplayer?.isChatTyping);

    const interactPressed = overlayInputLocked ? false : this.interactQueued;
    const strugglePressed = overlayInputLocked ? false : this.struggleQueued;
    this.interactQueued = false;
    this.struggleQueued = false;

    const touchLook = this.touchControls.consumeLookDelta();
    if (
      !overlayInputLocked &&
      (touchLook.yawDelta !== 0 || touchLook.pitchDelta !== 0)
    ) {
      this.yaw += touchLook.yawDelta;
      this.pitch = Math.max(
        -1.25,
        Math.min(1.25, this.pitch + touchLook.pitchDelta)
      );
      this.flashlight.addLookImpulse(
        touchLook.yawDelta * 22,
        touchLook.pitchDelta * 22
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

    const holdingCtrl =
      !overlayInputLocked &&
      (this.keys.has('ControlLeft') ||
        this.keys.has('ControlRight') ||
        this.keys.has('KeyC') ||
        this.touchCrouchLatched);
    const holdingShift =
      !overlayInputLocked &&
      (this.keys.has('ShiftLeft') ||
        this.keys.has('ShiftRight') ||
        touchSprint);

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
        Math.min(1, planarSpeed / (isCrouching ? 2.75 : 5.5));

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
      // Todos os jogadores assistem em 3ª pessoa a Aranha atacando/arrastando/tecendo sobre o aliado!
      this.spider.updateRemoteCinematicSequence(
        dt,
        this.elapsed,
        updatedRemoteAbduction.mode,
        updatedRemoteAbduction.progress,
        updatedRemoteAbduction.spiderPos,
        updatedRemoteAbduction.victimPos
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
      const candidates = this.multiplayer.buildSpiderPlayerCandidates({
        pos: this.position,
        yaw: this.yaw,
        sprinting: spiderHearsSprint,
        crouching: isCrouching,
        flashlightOn: fl.beamIntensity > 0.05,
        flashlightDir: this.sharedUniforms.uFlashlightDir.value,
        voiceLevel: localVoiceLvl,
        ensnared: this.webManager.isPlayerEnsnared,
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

    this.radar.update(
      this.position.x,
      this.position.z,
      this.yaw,
      this.elapsed,
      this.worldItems.getUncollectedEquipmentSignals(),
      !this.engaged || this.inventory.open || this.inventory.gameOverVisible,
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
        inSequence: false,
        dead: false,
        afk: isLocalAfk,
      },
      this.spider.getNetworkSnapshot(
        updatedRemoteAbduction?.allyId ?? null
      ),
      !this.engaged || this.inventory.open || this.inventory.gameOverVisible
    );

    this.sharedUniforms.uFlashlightIntensity.value = fl.beamIntensity;
    if (fl.beamIntensity > 0.005) {
      const camRight = new THREE.Vector3(1, 0, 0).applyQuaternion(
        this.camera.quaternion
      );
      const camUp = new THREE.Vector3(0, 1, 0).applyQuaternion(
        this.camera.quaternion
      );
      this.sharedUniforms.uFlashlightPos.value
        .copy(this.camera.position)
        .addScaledVector(camRight, 0.18)
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
    this.setCameraFov(74 + slideAmt * 5.5);

    const shakeX =
      this.cameraShake > 0.001
        ? (Math.random() - 0.5) * 2 * this.cameraShake
        : 0;
    const shakeY =
      this.cameraShake > 0.001
        ? (Math.random() - 0.5) * 2 * this.cameraShake
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

    for (let i = 0; i < this.lights.length; i++) {
      const src = this.lights[i];
      const sample = evaluateDoomLightFlicker(src, this.elapsed);
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

  destroy(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.permadeathTimerId) {
      window.clearTimeout(this.permadeathTimerId);
      this.permadeathTimerId = 0;
    }
    cancelAnimationFrame(this.rafId);
    this.abortCtrl.abort();
    unlockSystemKeyboardKeys();
    this.localAfkBannerEl.remove();
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
