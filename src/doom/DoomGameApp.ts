import * as THREE from 'three';
import { SoundEngine } from '../engine/audio/SoundEngine';
import {
  resolveCylinderWorldCollisions,
  StaticColliderBox,
} from '../engine/physics/SpatialSweep';
import { DoomFlashlight } from './DoomFlashlight';
import { DoomInventory } from './DoomInventory';
import {
  buildDoomLabyrinth,
  DoomLightSource,
} from './DoomMazeBuilder';
import {
  createDoomSharedUniforms,
  DoomRetroCompositor,
  DoomSharedUniforms,
  MAX_DOOM_LIGHTS,
} from './DoomShader';
import { DoomSpider } from './DoomSpider';
import { DoomSpiderWebManager } from './DoomSpiderWebs';
import { createDoomTextures } from './DoomTextures';
import { DoomWorldItems } from './DoomWorldItems';

/**
 * Aplicação 3D do Labirinto estilo DOOM Clássico integrada a:
 * - Lanterna 3D simples (Tecla F)
 * - Agachamento furtivo contínuo (Segurar Ctrl)
 * - Inventário sombrio estilo Amnesia (Tecla Tab) + Objetos 3D coletáveis (E / Clique / Aproximação)
 * - Aranha Procedural (Evil Crawling Thing) escalando chão, paredes e teto + Armadilhas de Teia!
 */
export class DoomGameApp {
  private readonly viewportEl: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly compositor: DoomRetroCompositor;
  private readonly sharedUniforms: DoomSharedUniforms;
  private readonly flashlight: DoomFlashlight;
  private readonly inventory: DoomInventory;
  private readonly worldItems: DoomWorldItems;
  private readonly webManager: DoomSpiderWebManager;
  private readonly spider: DoomSpider;

  private colliders: StaticColliderBox[] = [];
  private lights: DoomLightSource[] = [];
  private prevLightDimState: boolean[] = [];
  private spawnPosition = new THREE.Vector3();
  private spawnYaw = 0;

  private readonly position = new THREE.Vector3();
  private readonly velocity = new THREE.Vector3();
  private yaw = 0;
  private pitch = 0;
  private bobPhase = 0;
  private lastBobHalfCycle = 0;

  private readonly standingEyeHeight = 1.62;
  private readonly crouchEyeHeight = 0.88;
  private readonly playerRadius = 0.52;
  private readonly standingPlayerHeight = 1.8;
  private readonly crouchPlayerHeight = 1.05;
  private crouchAmount = 0;
  private wasCrouching = false;

  // Sinais vitais e equipamentos (visíveis no Inventário [Tab] estilo Amnesia)
  private playerHealth = 100;
  private playerSanity = 100;
  private lanternBattery = 100;
  private playerBleeding = false;
  private cameraShake = 0;

  private keys = new Set<string>();
  private interactQueued = false;
  private struggleQueued = false;
  private engaged = false;
  private pointerLocked = false;
  private isDragging = false;
  private lastMouseX = 0;
  private lastMouseY = 0;
  private elapsed = 0;
  private lastRaf = performance.now();

  constructor(private readonly sound: SoundEngine) {
    this.viewportEl = document.getElementById('game-viewport') as HTMLElement;
    this.canvas = document.getElementById('webgl-canvas') as HTMLCanvasElement;

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
    this.camera = new THREE.PerspectiveCamera(74, aspect, 0.12, 55);

    this.compositor = new DoomRetroCompositor(
      window.innerWidth,
      window.innerHeight
    );
    this.sharedUniforms = createDoomSharedUniforms();
    this.flashlight = new DoomFlashlight(aspect);

    const textures = createDoomTextures();
    const maze = buildDoomLabyrinth(
      this.scene,
      textures,
      this.sharedUniforms
    );

    this.colliders = maze.colliders;
    this.lights = maze.lights;
    this.prevLightDimState = maze.lights.map(() => false);
    this.spawnPosition.copy(maze.spawnPosition);
    this.spawnYaw = maze.spawnYaw;
    this.position.copy(maze.spawnPosition);
    this.yaw = maze.spawnYaw;

    this.worldItems = new DoomWorldItems(this.scene, this.sharedUniforms);
    this.webManager = new DoomSpiderWebManager(this.scene, this.sharedUniforms);
    this.spider = new DoomSpider(
      this.scene,
      this.sharedUniforms,
      this.colliders,
      this.webManager,
      this.sound
    );

    this.inventory = new DoomInventory(this.viewportEl, this.sound, {
      onToggleFlashlightFromUI: () => {
        const equipping = this.flashlight.toggle();
        this.sound.playFlashlightMotion(equipping);
        if (!equipping) {
          this.sound.playFlashlightClick(false);
        }
      },
      onUseHeal: (healAmount, calmAmount) => {
        if (this.playerHealth >= 99.5 && !this.playerBleeding && this.playerSanity >= 96) {
          return false;
        }
        this.playerHealth = Math.min(100, this.playerHealth + healAmount);
        this.playerSanity = Math.min(100, this.playerSanity + calmAmount);
        this.playerBleeding = false;
        this.syncInventoryVitals();
        return true;
      },
      onUseBattery: (chargeAmount) => {
        if (this.lanternBattery >= 99.5) return false;
        this.lanternBattery = Math.min(100, this.lanternBattery + chargeAmount);
        this.syncInventoryVitals();
        return true;
      },
      onUseFlare: () => {
        this.worldItems.spawnLitFlare(this.position, this.yaw);
        return true;
      },
      onCloseRequest: () => {
        this.closeInventoryAndLock();
      },
      onRespawnAfterCapture: () => {
        this.respawnPlayer();
      },
    });

    this.syncCamera(0);
    this.bindInput();
    window.addEventListener('resize', () => this.onResize());
  }

  engageFromTerminal(): void {
    this.engaged = true;
    this.onResize();
    this.sound.unlock();
    this.sound.enterDoomLabyrinth();
    this.tryPointerLock();
    this.compositor.render(
      this.renderer,
      this.scene,
      this.camera,
      this.flashlight.viewScene,
      this.flashlight.viewCamera
    );
  }

  private closeInventoryAndLock(): void {
    this.inventory.setOpen(false);
    this.keys.clear();
    this.tryPointerLock();
  }

  private respawnPlayer(): void {
    this.playerHealth = 100;
    this.playerSanity = 100;
    this.playerBleeding = false;
    this.lanternBattery = Math.max(60, this.lanternBattery);
    this.position.copy(this.spawnPosition);
    this.velocity.set(0, 0, 0);
    this.yaw = this.spawnYaw;
    this.pitch = 0;
    this.webManager.clearEnsnarement();
    this.spider.respawnFarFromPlayer();
    this.syncInventoryVitals();
    this.tryPointerLock();
  }

  private tryPointerLock(): void {
    if (this.inventory.open || this.inventory.gameOverVisible) return;
    try {
      const maybe = this.canvas.requestPointerLock?.() as
        | Promise<void>
        | undefined;
      if (maybe && typeof maybe.catch === 'function') {
        maybe.catch(() => {});
      }
      const kb = (
        navigator as Navigator & {
          keyboard?: { lock?: (codes?: string[]) => Promise<void> };
        }
      ).keyboard;
      kb
        ?.lock?.(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ControlLeft', 'Tab'])
        ?.catch(() => {});
    } catch {
      // Fallback por setas ou arrasto permanece disponível
    }
  }

  private bindInput(): void {
    const gameCodes = new Set([
      'KeyW',
      'KeyA',
      'KeyS',
      'KeyD',
      'KeyE',
      'KeyF',
      'Tab',
      'Space',
      'ControlLeft',
      'ControlRight',
      'ShiftLeft',
      'ShiftRight',
      'ArrowUp',
      'ArrowDown',
      'ArrowLeft',
      'ArrowRight',
    ]);

    window.addEventListener('keydown', (e) => {
      if (!this.engaged) return;

      if (gameCodes.has(e.code)) {
        e.preventDefault();
      }
      this.sound.unlock();

      if (this.inventory.gameOverVisible) {
        if (e.code === 'Enter' || e.code === 'Space') {
          this.inventory.hideGameOver();
          this.respawnPlayer();
        }
        return;
      }

      // Alterna Inventário estilo Amnesia na tecla Tab!
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
          this.tryPointerLock();
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
      }
    });

    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
    });

    window.addEventListener('blur', () => {
      this.keys.clear();
      this.isDragging = false;
    });

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.keys.clear();
        this.isDragging = false;
      }
    });

    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === this.canvas;
    });

    this.canvas.addEventListener('mousedown', (e) => {
      if (this.inventory.open || this.inventory.gameOverVisible) return;
      this.sound.unlock();
      if (!this.pointerLocked) {
        this.tryPointerLock();
      }
      if (e.button === 0) {
        this.interactQueued = true;
        this.struggleQueued = true;
      }
      this.isDragging = true;
      this.lastMouseX = e.clientX;
      this.lastMouseY = e.clientY;
    });

    window.addEventListener('mouseup', () => {
      this.isDragging = false;
    });

    window.addEventListener('mousemove', (e) => {
      if (this.inventory.open || this.inventory.gameOverVisible) return;

      const sens = 0.0022;
      // Permite olhar bem para o alto (teto) e para baixo (armadilhas de teia no piso)!
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
    });
  }

  private onResize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const aspect = Math.max(1, w) / Math.max(1, h);
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    this.flashlight.setAspect(aspect);
    this.renderer.setSize(w, h);
    this.compositor.resize(w, h);
  }

  start(): void {
    this.lastRaf = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(0.08, Math.max(0.0005, (now - this.lastRaf) / 1000));
      this.lastRaf = now;
      this.update(dt);
      this.compositor.render(
        this.renderer,
        this.scene,
        this.camera,
        this.flashlight.viewScene,
        this.flashlight.viewCamera
      );
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  private update(dt: number): void {
    if (!this.engaged) return;

    // Pausa o mundo de jogo enquanto o jogador inspeciona o Inventário [Tab] ou tela de morte
    if (this.inventory.open || this.inventory.gameOverVisible) {
      this.interactQueued = false;
      this.struggleQueued = false;
      return;
    }

    this.elapsed += dt;

    const interactPressed = this.interactQueued;
    const strugglePressed = this.struggleQueued;
    this.interactQueued = false;
    this.struggleQueued = false;

    const turnSpeed = 2.35;
    if (this.keys.has('ArrowLeft')) {
      const dYaw = turnSpeed * dt;
      this.yaw += dYaw;
      this.flashlight.addLookImpulse(dYaw * 0.35, 0);
    }
    if (this.keys.has('ArrowRight')) {
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
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) wish.add(forward);
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) wish.sub(forward);
    if (this.keys.has('KeyD')) wish.add(right);
    if (this.keys.has('KeyA')) wish.sub(right);

    if (wish.lengthSq() > 0) wish.normalize();

    // Agachamento contínuo segurando Ctrl (verifica espaço acima antes de levantar)
    const holdingCtrl =
      this.keys.has('ControlLeft') || this.keys.has('ControlRight');
    const isCrouching =
      holdingCtrl || (this.wasCrouching && !this.canStandUp());

    if (isCrouching !== this.wasCrouching) {
      this.sound.playCrouchMovement(isCrouching);
      this.wasCrouching = isCrouching;
    }

    const crouchTarget = isCrouching ? 1 : 0;
    this.crouchAmount +=
      (crouchTarget - this.crouchAmount) * (1 - Math.exp(-12.5 * dt));

    const hasKnife = this.inventory.hasItem('rusty_knife');

    // Verifica armadilhas de teia no corredor!
    const webState = this.webManager.update(
      dt,
      this.position,
      strugglePressed,
      hasKnife,
      this.sound,
      (trapPos) => {
        this.spider.alertToWebTrap(trapPos, this.position);
      }
    );

    const sprinting =
      !isCrouching &&
      !this.webManager.isPlayerEnsnared &&
      !this.spider.isCapturingPlayer &&
      (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight'));

    const baseMaxSpeed = isCrouching ? 2.65 : sprinting ? 8.6 : 6.2;
    const maxSpeed = this.spider.isCapturingPlayer
      ? 0.35
      : baseMaxSpeed * webState.speedMultiplier;

    const accel = wish.lengthSq() > 0 ? 18.0 : 12.0;
    const blend = 1 - Math.exp(-accel * dt);
    this.velocity.x += (wish.x * maxSpeed - this.velocity.x) * blend;
    this.velocity.z += (wish.z * maxSpeed - this.velocity.z) * blend;

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
    if (planarSpeed > 0.28 && !this.spider.isCapturingPlayer) {
      const bobRate = isCrouching
        ? 4.6 + planarSpeed * 0.9
        : 7.5 + planarSpeed * 0.75;
      const bobAmp = isCrouching ? 0.028 : 0.055;
      this.bobPhase += dt * bobRate;
      bobOffset =
        Math.sin(this.bobPhase) *
        bobAmp *
        Math.min(1, planarSpeed / (isCrouching ? 2.65 : 5.5));

      const halfCycle = Math.floor(this.bobPhase / Math.PI);
      if (halfCycle !== this.lastBobHalfCycle) {
        this.lastBobHalfCycle = halfCycle;
        const surface = this.position.z >= 4.5 ? 'stone' : 'tech';
        this.sound.playLabyrinthFootstep(
          halfCycle % 2 === 0,
          surface,
          sprinting,
          isCrouching
        );
      }
    } else {
      this.bobPhase = 0;
      this.lastBobHalfCycle = 0;
    }

    // Consumo suave da bateria quando a lanterna está ligada
    if (this.flashlight.isEquipped && this.lanternBattery > 0) {
      this.lanternBattery = Math.max(0, this.lanternBattery - dt * 0.62);
    }

    // Atualiza modelagem/animação da lanterna (F) e projeta seu feixe no mundo 3D
    const fl = this.flashlight.update(
      dt,
      this.bobPhase,
      planarSpeed,
      () => {
        this.sound.playFlashlightClick(true);
      },
      this.crouchAmount,
      this.lanternBattery
    );

    // Atualiza a Aranha Procedural (Evil Crawling Thing)!
    const spiderOut = this.spider.update(
      dt,
      this.elapsed,
      this.position,
      this.yaw,
      sprinting,
      isCrouching,
      fl.beamIntensity > 0.05,
      this.sharedUniforms.uFlashlightDir.value,
      hasKnife,
      strugglePressed,
      this.worldItems.getActiveFlares(),
      (damage, causeBleeding) => {
        this.applySpiderDamage(damage, causeBleeding);
      }
    );

    if (spiderOut.capturePullTarget) {
      this.position.lerp(spiderOut.capturePullTarget, Math.min(1, dt * 8));
      resolveCylinderWorldCollisions(
        this.position,
        this.velocity,
        this.playerRadius,
        currentHeight,
        this.colliders
      );
      // Vira suavemente o olhar na direção da aranha durante o bote!
      const desiredYaw = Math.atan2(
        -(this.spider.position.x - this.position.x),
        -(this.spider.position.z - this.position.z)
      );
      let diff = desiredYaw - this.yaw;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      this.yaw += diff * Math.min(1, dt * 7);
      this.pitch += (-0.12 - this.pitch) * Math.min(1, dt * 6);
    }

    this.cameraShake = Math.max(
      this.cameraShake * Math.exp(-8 * dt),
      spiderOut.cameraShakeAmount
    );

    this.syncCamera(bobOffset);

    // Atualiza coleta de objetos 3D e sinalizadores no labirinto
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
      this.inventory
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

    // Atualiza evolução de sangramento, nervos/sanidade e batimentos cardíacos
    this.updateSurvivalVitals(dt, spiderOut.playerDistance, fl.beamIntensity > 0.05);
    this.updateFlickeringLightsAndAudio();
  }

  private applySpiderDamage(damage: number, causeBleeding: boolean): void {
    this.playerHealth = Math.max(0, this.playerHealth - damage);
    this.playerSanity = Math.max(0, this.playerSanity - 26);
    if (causeBleeding && this.playerHealth > 0) {
      this.playerBleeding = true;
    }
    this.cameraShake = 0.095;
    this.syncInventoryVitals();

    if (this.playerHealth <= 0) {
      try {
        document.exitPointerLock?.();
      } catch {
        // ignorar
      }
      this.inventory.showGameOver();
    }
  }

  private updateSurvivalVitals(
    dt: number,
    spiderDist: number,
    flashlightOn: boolean
  ): void {
    // Sangramento drena saúde lentamente até um piso crítico (16%) até usar bandagem/analgésico
    if (this.playerBleeding && this.playerHealth > 16) {
      this.playerHealth = Math.max(16, this.playerHealth - dt * 0.75);
    }

    // Sanidade / Nervos caem na perseguição ou no escuro perto da aranha, e recuperam em segurança
    if (this.spider.isChasingOrAlert || this.webManager.isPlayerEnsnared) {
      this.playerSanity = Math.max(6, this.playerSanity - dt * 7.5);
    } else if (!flashlightOn && spiderDist < 11) {
      this.playerSanity = Math.max(24, this.playerSanity - dt * 2.4);
    } else {
      this.playerSanity = Math.min(100, this.playerSanity + dt * 2.2);
    }

    // Batimento cardíaco abafado proporcional ao perigo/ferimento
    const dangerChase = this.spider.isChasingOrAlert
      ? Math.max(0.35, 1 - spiderDist / 16)
      : 0;
    const dangerInjury = Math.max(0, (55 - this.playerHealth) / 55);
    const heartIntensity = Math.max(dangerChase, dangerInjury);
    this.sound.playTensionHeartbeat(heartIntensity);

    this.syncInventoryVitals();
  }

  private syncInventoryVitals(): void {
    this.inventory.updateVitalsAndDiegeticFX({
      health: this.playerHealth,
      sanity: this.playerSanity,
      battery: this.lanternBattery,
      flashlightEquipped: this.flashlight.isEquipped,
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
    const currentEyeHeight =
      this.standingEyeHeight +
      (this.crouchEyeHeight - this.standingEyeHeight) * this.crouchAmount;

    const shakeX =
      this.cameraShake > 0.001
        ? (Math.random() - 0.5) * 2 * this.cameraShake
        : 0;
    const shakeY =
      this.cameraShake > 0.001
        ? (Math.random() - 0.5) * 2 * this.cameraShake
        : 0;

    this.camera.position.set(
      this.position.x + shakeX,
      currentEyeHeight + bobOffset + shakeY,
      this.position.z
    );
    const euler = new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ');
    this.camera.quaternion.setFromEuler(euler);
  }

  private updateFlickeringLightsAndAudio(): void {
    const tick = Math.floor(this.elapsed * 10);
    let nearestLamp: THREE.Vector3 | null = null;
    let nearestDist = Infinity;
    let nearestJustFlickered = false;

    const baseCount = Math.min(this.lights.length, MAX_DOOM_LIGHTS);
    for (let i = 0; i < baseCount; i++) {
      const src = this.lights[i];
      let isDim = false;

      if (!src.flicker) {
        this.sharedUniforms.uLightIntensities.value[i] = src.baseIntensity;
      } else {
        const hash = Math.sin(tick * 12.9898 + src.phase * 78.233) * 43758.5453;
        const r = hash - Math.floor(hash);
        isDim = r < 0.16;
        this.sharedUniforms.uLightIntensities.value[i] = isDim
          ? src.baseIntensity * 0.35
          : src.baseIntensity;
      }

      const justFlickered = isDim && !this.prevLightDimState[i];
      this.prevLightDimState[i] = isDim;

      const d = Math.hypot(
        src.position.x - this.position.x,
        src.position.z - this.position.z
      );
      if (d < nearestDist) {
        nearestDist = d;
        nearestLamp = src.position;
        nearestJustFlickered = justFlickered;
      }
    }

    // Injeta a luz quente dos Sinalizadores de Magnésio acesos no chão nos slots livres do shader!
    const flares = this.worldItems.getActiveFlares();
    let totalLights = baseCount;
    for (let f = 0; f < flares.length && totalLights < MAX_DOOM_LIGHTS; f++) {
      const fl = flares[f];
      const fade = Math.min(1, fl.remainingSec / 2.5);
      const jitter = 0.84 + 0.16 * Math.sin(this.elapsed * 31 + f * 2);
      this.sharedUniforms.uLightPositions.value[totalLights].copy(fl.position);
      this.sharedUniforms.uLightIntensities.value[totalLights] =
        0.92 * fade * jitter;
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
  }
}
