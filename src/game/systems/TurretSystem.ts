import * as THREE from 'three';
import { ProceduralAudio } from '../../engine/audio/ProceduralAudio';
import { World } from '../../engine/ecs/World';
import {
  PocketStasis,
  Transform,
  TurretEmitter,
} from '../components';
import { spawnProjectile } from '../EntityPrefabs';

/**
 * Sistema de Emissores Balísticos e IA das Sentinelas Cristalinas.
 *
 * Opera estritamente sobre `simDt` e exclui `PocketStasis.bit`:
 * sentinelas recortadas na moldura pausam sua mira e recarga sem nenhum `if` especial.
 */
export class TurretSystem {
  turretsEnabled = true;

  constructor(
    private readonly world: World,
    private readonly scene: THREE.Scene,
    private readonly audio: ProceduralAudio
  ) {}

  stepSimulation(simDt: number, playerChestPos: THREE.Vector3): void {
    if (!this.turretsEnabled) return;

    const emitters = this.world.query(
      Transform.bit | TurretEmitter.bit,
      PocketStasis.bit
    );

    for (const e of emitters) {
      const tr = this.world.getRequired(e, Transform);
      const emitter = this.world.getRequired(e, TurretEmitter);
      if (!emitter.enabled) continue;

      let aimDir = emitter.fireDirection.clone();
      if (emitter.trackPlayer) {
        const origin = tr.position.clone().add(emitter.muzzleOffset);
        aimDir = playerChestPos.clone().sub(origin);
        if (aimDir.lengthSq() > 1e-4) {
          aimDir.normalize();
          // Gira suavemente o corpo da sentinela em torno de Y rumo ao jogador
          const yaw = Math.atan2(-aimDir.x, -aimDir.z);
          const targetQuat = new THREE.Quaternion().setFromAxisAngle(
            new THREE.Vector3(0, 1, 0),
            yaw
          );
          tr.quaternion.slerp(targetQuat, Math.min(1, simDt * 4.5));
        } else {
          aimDir.set(0, 0, 1);
        }
      }

      emitter.cooldown -= simDt;
      if (emitter.cooldown <= 0) {
        emitter.cooldown = emitter.interval;
        const spawnOrigin = tr.position
          .clone()
          .add(emitter.muzzleOffset)
          .addScaledVector(aimDir, 0.72);
        const vel = aimDir.clone().multiplyScalar(emitter.projectileSpeed);
        spawnProjectile(this.world, this.scene, spawnOrigin, vel, 'enemy', 1);
        this.audio.playTurretFire();
      }
    }
  }
}
