import * as THREE from 'three';
import { SoundEngine } from '../engine/audio/SoundEngine';
import {
  resolveCylinderWorldCollisions,
  StaticColliderBox,
} from '../engine/physics/SpatialSweep';
import { DoomFlashlight } from './DoomFlashlight';
import {
  buildDoomLabyrinth,
  DoomLightSource,
} from './DoomMazeBuilder';
import {
  createDoomSharedUniforms,
  DoomRetroCompositor,
  DoomSharedUniforms,
} from './DoomShader';
import { createDoomTextures } from './DoomTextures';

/**
 * Aplicação 3D do Labirinto estilo DOOM Clássico integrada ao SoundEngine unificado
 * e à lanterna 3D simples acionada pela tecla F.
 */
export class DoomGameApp {
  private readonly canvas: HTMLCanvasElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly compositor: DoomRetroCompositor;
  private readonly sharedUniforms: DoomSharedUniforms;
  private readonly flashlight: DoomFlashlight;

  private colliders: StaticColliderBox[] = [];
  private lights: DoomLightSource[] = [];
  private prevLightDimState: boolean[] = [];

  private readonly position = new THREE.Vector3();
  private readonly velocity = new THREE.Vector3();
  private yaw = 0;
  private pitch = 0;
  private bobPhase = 0;
  private lastBobHalfCycle = 0;

  private readonly eyeHeight = 1.62;
  private readonly playerRadius = 0.52;
  private readonly playerHeight = 1.8;

  private keys = new Set<string>();
  private engaged = false;
  private pointerLocked = false;
  private isDragging = false;
  private lastMouseX = 0;
  private lastMouseY = 0;
  private elapsed = 0;
  private lastRaf = performance.now();

  constructor(private readonly sound: SoundEngine) {
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
    this.position.copy(maze.spawnPosition);
    this.yaw = maze.spawnYaw;

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

  private tryPointerLock(): void {
    try {
      const maybe = this.canvas.requestPointerLock?.() as
        | Promise<void>
        | undefined;
      if (maybe && typeof maybe.catch === 'function') {
        maybe.catch(() => {});
      }
    } catch {
      // Fallback por setas ou arrasto permanece disponível
    }
  }

  private bindInput(): void {
    window.addEventListener('keydown', (e) => {
      this.keys.add(e.code);
      this.sound.unlock();

      if (this.engaged && e.code === 'KeyF' && !e.repeat) {
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

    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === this.canvas;
    });

    this.canvas.addEventListener('mousedown', (e) => {
      this.sound.unlock();
      if (!this.pointerLocked) {
        this.tryPointerLock();
      }
      this.isDragging = true;
      this.lastMouseX = e.clientX;
      this.lastMouseY = e.clientY;
    });

    window.addEventListener('mouseup', () => {
      this.isDragging = false;
    });

    window.addEventListener('mousemove', (e) => {
      const sens = 0.0022;
      if (this.pointerLocked) {
        const dYaw = -e.movementX * sens;
        const prevPitch = this.pitch;
        this.yaw += dYaw;
        this.pitch = Math.max(
          -0.38,
          Math.min(0.38, this.pitch - e.movementY * sens * 0.7)
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
          -0.38,
          Math.min(0.38, this.pitch - dy * sens * 0.8)
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
    this.elapsed += dt;

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

    const sprinting = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
    const maxSpeed = sprinting ? 8.6 : 6.2;

    const accel = wish.lengthSq() > 0 ? 18.0 : 12.0;
    const blend = 1 - Math.exp(-accel * dt);
    this.velocity.x += (wish.x * maxSpeed - this.velocity.x) * blend;
    this.velocity.z += (wish.z * maxSpeed - this.velocity.z) * blend;

    const speedBeforeCol = Math.hypot(this.velocity.x, this.velocity.z);
    const intendedX = this.position.x + this.velocity.x * dt;
    const intendedZ = this.position.z + this.velocity.z * dt;
    this.position.x = intendedX;
    this.position.z = intendedZ;

    resolveCylinderWorldCollisions(
      this.position,
      this.velocity,
      this.playerRadius,
      this.playerHeight,
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
    if (planarSpeed > 0.35) {
      this.bobPhase += dt * (7.5 + planarSpeed * 0.75);
      bobOffset = Math.sin(this.bobPhase) * 0.055 * Math.min(1, planarSpeed / 5.5);

      const halfCycle = Math.floor(this.bobPhase / Math.PI);
      if (halfCycle !== this.lastBobHalfCycle) {
        this.lastBobHalfCycle = halfCycle;
        const surface = this.position.z >= 4.5 ? 'stone' : 'tech';
        this.sound.playLabyrinthFootstep(
          halfCycle % 2 === 0,
          surface,
          sprinting
        );
      }
    } else {
      this.bobPhase = 0;
      this.lastBobHalfCycle = 0;
    }

    this.syncCamera(bobOffset);

    // Atualiza modelagem/animação da lanterna (F) e projeta seu feixe no mundo 3D
    const fl = this.flashlight.update(dt, this.bobPhase, planarSpeed, () => {
      this.sound.playFlashlightClick(true);
    });

    this.sharedUniforms.uFlashlightIntensity.value = fl.beamIntensity;
    if (fl.beamIntensity > 0.005) {
      // Origem do feixe levemente à direita/abaixo da câmera (posição da mão)
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

    this.updateFlickeringLightsAndAudio();
  }

  private syncCamera(bobOffset: number): void {
    this.camera.position.set(
      this.position.x,
      this.eyeHeight + bobOffset,
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

    for (let i = 0; i < this.lights.length; i++) {
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

    this.sound.updateSpatialLampAudio(
      this.position,
      this.yaw,
      nearestLamp,
      nearestDist,
      nearestJustFlickered
    );
  }
}
