import * as THREE from 'three';
import {
  resolveCylinderWorldCollisions,
  StaticColliderBox,
} from '../engine/physics/SpatialSweep';

export interface PlayerActions {
  firePressed: boolean;
  frameActionPressed: boolean;
  flipPolarityPressed: boolean;
  toggleGizmoPressed: boolean;
  toggleInspectorPressed: boolean;
  resetChamberPressed: boolean;
  cycleChronoPressed: boolean;
  toggleMutePressed: boolean;
}

/**
 * Controlador Cinemático em Primeira Pessoa.
 *
 * Observação arquitetural importante:
 * A rotação da câmera opera sempre em `realDt` (tempo humano real) para que o jogador possa
 * mirar livremente mesmo quando o mundo está congelado em `0.025x`.
 * Já o deslocamento físico calcula `motionFactor` [0..1] que alimenta o `ChronoKernel`.
 */
export class PlayerController {
  readonly position = new THREE.Vector3(0, 0, 10.5);
  readonly velocity = new THREE.Vector3();
  readonly eyeOffset = 1.66;
  readonly radius = 0.42;
  readonly height = 1.82;
  readonly moveSpeed = 6.8;

  yaw = 0;
  pitch = 0;
  grounded = true;
  pointerLocked = false;
  isEngaged = false;

  private keys = new Set<string>();
  private accumulatedLookDeltaSq = 0;
  private lastAngularSpeed = 0;
  private isDraggingFallback = false;
  private lastPointerX = 0;
  private lastPointerY = 0;

  private pendingActions: PlayerActions = {
    firePressed: false,
    frameActionPressed: false,
    flipPolarityPressed: false,
    toggleGizmoPressed: false,
    toggleInspectorPressed: false,
    resetChamberPressed: false,
    cycleChronoPressed: false,
    toggleMutePressed: false,
  };

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly domElement: HTMLElement
  ) {
    this.bindEvents();
    this.syncCamera();
  }

  private bindEvents(): void {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);

      if (e.code === 'Tab') {
        e.preventDefault();
        this.pendingActions.toggleInspectorPressed = true;
      } else if (e.code === 'KeyR') {
        this.pendingActions.flipPolarityPressed = true;
      } else if (e.code === 'KeyE') {
        this.pendingActions.frameActionPressed = true;
      } else if (e.code === 'KeyF') {
        this.pendingActions.firePressed = true;
      } else if (e.code === 'KeyV') {
        this.pendingActions.toggleGizmoPressed = true;
      } else if (e.code === 'KeyT') {
        this.pendingActions.resetChamberPressed = true;
      } else if (e.code === 'KeyC') {
        this.pendingActions.cycleChronoPressed = true;
      } else if (e.code === 'KeyM') {
        this.pendingActions.toggleMutePressed = true;
      }
    });

    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
    });

    window.addEventListener('blur', () => {
      this.keys.clear();
      this.isDraggingFallback = false;
    });

    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === this.domElement;
      if (this.pointerLocked) {
        this.isEngaged = true;
      }
    });

    this.domElement.addEventListener('contextmenu', (e) => e.preventDefault());

    this.domElement.addEventListener('mousedown', (e) => {
      if (!this.isEngaged) {
        this.engage();
        return;
      }

      if (!this.pointerLocked) {
        this.tryPointerLock();
      }

      if (e.button === 0) {
        this.pendingActions.firePressed = true;
        this.isDraggingFallback = true;
        this.lastPointerX = e.clientX;
        this.lastPointerY = e.clientY;
      } else if (e.button === 2) {
        this.pendingActions.frameActionPressed = true;
      }
    });

    window.addEventListener('mouseup', () => {
      this.isDraggingFallback = false;
    });

    window.addEventListener('mousemove', (e) => {
      if (!this.isEngaged) return;

      const sensitivity = 0.0021;
      if (this.pointerLocked) {
        this.applyLookDelta(-e.movementX * sensitivity, -e.movementY * sensitivity);
      } else if (this.isDraggingFallback) {
        const dx = e.clientX - this.lastPointerX;
        const dy = e.clientY - this.lastPointerY;
        this.lastPointerX = e.clientX;
        this.lastPointerY = e.clientY;
        this.applyLookDelta(-dx * sensitivity * 1.35, -dy * sensitivity * 1.35);
      }
    });
  }

  engage(): void {
    this.isEngaged = true;
    this.tryPointerLock();
  }

  private tryPointerLock(): void {
    try {
      const maybePromise = this.domElement.requestPointerLock?.() as
        | Promise<void>
        | undefined;
      if (maybePromise && typeof maybePromise.catch === 'function') {
        maybePromise.catch(() => {
          // Iframe sem permissão de Pointer Lock: fallback por setas/arrasto permanece ativo
        });
      }
    } catch {
      // Ignora caso bloqueado pela sandbox do navegador
    }
  }

  private applyLookDelta(dYaw: number, dPitch: number): void {
    this.yaw += dYaw;
    this.pitch = Math.max(
      -Math.PI * 0.47,
      Math.min(Math.PI * 0.47, this.pitch + dPitch)
    );
    this.accumulatedLookDeltaSq += dYaw * dYaw + dPitch * dPitch;
  }

  consumeActions(): PlayerActions {
    const out = { ...this.pendingActions };
    this.pendingActions.firePressed = false;
    this.pendingActions.frameActionPressed = false;
    this.pendingActions.flipPolarityPressed = false;
    this.pendingActions.toggleGizmoPressed = false;
    this.pendingActions.toggleInspectorPressed = false;
    this.pendingActions.resetChamberPressed = false;
    this.pendingActions.cycleChronoPressed = false;
    this.pendingActions.toggleMutePressed = false;
    return out;
  }

  resetPose(spawn: THREE.Vector3): void {
    this.position.copy(spawn);
    this.velocity.set(0, 0, 0);
    this.yaw = 0;
    this.pitch = -0.03;
    this.syncCamera();
  }

  /**
   * Atualiza locomoção e câmera do jogador em tempo real (`realDt`) e retorna métricas
   * cinemáticas para alimentar o `ChronoKernel`.
   */
  update(
    realDt: number,
    colliders: readonly StaticColliderBox[]
  ): { motionFactor: number; angularSpeed: number; jumped: boolean } {
    // Rotação opcional por setas do teclado (acessibilidade + fallback sem pointer lock)
    const keyTurnSpeed = 1.95;
    let kdYaw = 0;
    let kdPitch = 0;
    if (this.keys.has('ArrowLeft')) kdYaw += keyTurnSpeed * realDt;
    if (this.keys.has('ArrowRight')) kdYaw -= keyTurnSpeed * realDt;
    if (this.keys.has('ArrowUp')) kdPitch += keyTurnSpeed * 0.75 * realDt;
    if (this.keys.has('ArrowDown')) kdPitch -= keyTurnSpeed * 0.75 * realDt;
    if (kdYaw !== 0 || kdPitch !== 0) {
      this.applyLookDelta(kdYaw, kdPitch);
    }

    const angularDist = Math.sqrt(this.accumulatedLookDeltaSq);
    this.accumulatedLookDeltaSq = 0;
    this.lastAngularSpeed = realDt > 1e-5 ? angularDist / realDt : 0;

    // Direções planas XZ derivadas de yaw
    const forward = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));

    const wishDir = new THREE.Vector3();
    if (this.isEngaged) {
      if (this.keys.has('KeyW')) wishDir.add(forward);
      if (this.keys.has('KeyS')) wishDir.sub(forward);
      if (this.keys.has('KeyD')) wishDir.add(right);
      if (this.keys.has('KeyA')) wishDir.sub(right);
    }

    if (wishDir.lengthSq() > 0) {
      wishDir.normalize();
    }

    // Resposta horizontal ágil para que parar no lugar acione o slow-mo imediatamente
    const accel = wishDir.lengthSq() > 0 ? 22.0 : 18.0;
    const blend = 1 - Math.exp(-accel * realDt);
    this.velocity.x += (wishDir.x * this.moveSpeed - this.velocity.x) * blend;
    this.velocity.z += (wishDir.z * this.moveSpeed - this.velocity.z) * blend;

    let jumped = false;
    if (this.isEngaged && this.grounded && this.keys.has('Space')) {
      this.velocity.y = 7.4;
      this.grounded = false;
      jumped = true;
    }

    // Gravidade vertical do jogador
    this.velocity.y -= 19.5 * realDt;

    this.position.addScaledVector(this.velocity, realDt);
    const colResult = resolveCylinderWorldCollisions(
      this.position,
      this.velocity,
      this.radius,
      this.height,
      colliders
    );
    this.grounded = colResult.grounded;

    this.syncCamera();

    const planarSpeed = Math.hypot(this.velocity.x, this.velocity.z);
    const verticalContribution = Math.abs(this.velocity.y) * 0.45;
    const totalEffectiveSpeed = Math.hypot(planarSpeed, verticalContribution);
    const motionFactor = Math.min(1, totalEffectiveSpeed / this.moveSpeed);

    return {
      motionFactor: motionFactor < 0.02 ? 0 : motionFactor,
      angularSpeed: this.lastAngularSpeed,
      jumped,
    };
  }

  syncCamera(): void {
    this.camera.position.set(
      this.position.x,
      this.position.y + this.eyeOffset,
      this.position.z
    );
    const euler = new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ');
    this.camera.quaternion.setFromEuler(euler);
  }

  getEyePosition(): THREE.Vector3 {
    return this.camera.position.clone();
  }

  getAimDirection(): THREE.Vector3 {
    return new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion).normalize();
  }
}
