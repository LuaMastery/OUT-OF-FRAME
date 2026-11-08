import * as THREE from 'three';
import { ProceduralAudio } from '../../engine/audio/ProceduralAudio';
import { EntityId } from '../../engine/ecs/types';
import { World } from '../../engine/ecs/World';
import { ChronoKernel } from '../../engine/time/ChronoKernel';
import {
  CrystalTarget,
  EphemeralShard,
  PocketStasis,
  Projectile,
  Renderable,
  Transform,
  TurretEmitter,
} from '../components';
import {
  spawnCrystalSentinel,
  spawnCrystalShards,
  spawnKineticProp,
  spawnProjectile,
} from '../EntityPrefabs';

interface PendingRespawn {
  timer: number;
  stationId: string;
  position: THREE.Vector3;
  isExplosiveCore: boolean;
  armed: boolean;
  trackPlayer: boolean;
  fireInterval: number;
  projectileSpeed: number;
}

/**
 * Sistema de Combate, Estilhaçamento Cristalino e Recristalização da Sala de Testes.
 */
export class CombatSystem {
  private respawnQueue: PendingRespawn[] = [];
  shatteredTotal = 0;

  constructor(
    private readonly world: World,
    private readonly scene: THREE.Scene,
    private readonly audio: ProceduralAudio,
    private readonly chrono: ChronoKernel
  ) {}

  clearRespawns(): void {
    this.respawnQueue = [];
  }

  /**
   * Disparo cinético primário do jogador (LMB / tecla F).
   */
  firePlayerPulse(eyePos: THREE.Vector3, aimDir: THREE.Vector3): void {
    const muzzle = eyePos
      .clone()
      .addScaledVector(aimDir, 0.68)
      .add(new THREE.Vector3(0, -0.1, 0));
    const velocity = aimDir.clone().multiplyScalar(32.0);

    spawnProjectile(this.world, this.scene, muzzle, velocity, 'player', 1);
    this.audio.playShot();
    this.chrono.injectActionPulse(0.78);
  }

  /**
   * Estilhaça uma entidade `CrystalTarget` em dezenas de fragmentos 3D que flutuam no tempo dilatado.
   */
  shatterTarget(targetEntity: EntityId, impactDir: THREE.Vector3): void {
    if (!this.world.isAlive(targetEntity)) return;
    const target = this.world.get(targetEntity, CrystalTarget);
    const tr = this.world.get(targetEntity, Transform);
    if (!target || !tr) return;

    const center = tr.position.clone();
    const turret = this.world.get(targetEntity, TurretEmitter);

    // Agenda recristalização automática na Sala de Testes após 3.2s de tempo simulado
    if (target.respawnAnchor) {
      this.respawnQueue.push({
        timer: 3.2,
        stationId: target.stationId,
        position: target.respawnAnchor.clone(),
        isExplosiveCore: Boolean(target.isExplosiveCore),
        armed: Boolean(turret),
        trackPlayer: turret ? turret.trackPlayer : true,
        fireInterval: turret ? turret.interval : 1.9,
        projectileSpeed: turret ? turret.projectileSpeed : 14.5,
      });
    }

    const isCore = Boolean(target.isExplosiveCore);
    const color = target.color;
    const shardCount = target.shardCount;

    this.world.destroyEntity(targetEntity);
    this.shatteredTotal++;

    spawnCrystalShards(
      this.world,
      this.scene,
      center,
      impactDir,
      shardCount,
      color
    );
    this.audio.playCrystalShatter();

    // Reação em cadeia caso seja um Núcleo Explosivo!
    if (isCore) {
      this.detonateCoreShockwave(center);
    }
  }

  private detonateCoreShockwave(origin: THREE.Vector3): void {
    const blastRadius = 5.5;
    const candidates = this.world.query(
      Transform.bit | CrystalTarget.bit,
      PocketStasis.bit
    );
    for (const other of candidates) {
      const otr = this.world.getRequired(other, Transform);
      const delta = otr.position.clone().sub(origin);
      const dist = delta.length();
      if (dist <= blastRadius) {
        const dir =
          dist > 1e-3 ? delta.normalize() : new THREE.Vector3(0, 1, 0);
        this.shatterTarget(other, dir);
      }
    }
  }

  /**
   * Atualiza tempo de vida dos estilhaços, projéteis e fila de recristalização em `simDt`.
   */
  stepSimulation(simDt: number): void {
    // 1. Envelhecimento de estilhaços cristalinos
    const shards = this.world.query(
      EphemeralShard.bit | Transform.bit,
      PocketStasis.bit
    );
    for (const e of shards) {
      const shard = this.world.getRequired(e, EphemeralShard);
      shard.age += simDt;
      if (shard.age >= shard.maxAge) {
        this.world.destroyEntity(e);
        continue;
      }
      // Encolhe suavemente no último segundo simulado
      const remaining = shard.maxAge - shard.age;
      if (remaining < 1.0) {
        const tr = this.world.getRequired(e, Transform);
        const factor = Math.max(0.01, remaining) * shard.initialScale;
        tr.scale.setScalar(factor);
      }
    }

    // 2. Expiração de projéteis antigos
    const projectiles = this.world.query(Projectile.bit, PocketStasis.bit);
    for (const e of projectiles) {
      const p = this.world.getRequired(e, Projectile);
      p.ttl -= simDt;
      if (p.ttl <= 0) {
        this.world.destroyEntity(e);
      }
    }

    // 3. Recristalização automática das estações de teste
    for (let i = this.respawnQueue.length - 1; i >= 0; i--) {
      const item = this.respawnQueue[i];
      item.timer -= simDt;
      if (item.timer <= 0) {
        this.respawnQueue.splice(i, 1);
        if (item.isExplosiveCore) {
          spawnKineticProp(this.world, this.scene, item.position, true);
        } else {
          spawnCrystalSentinel(this.world, this.scene, item.position, {
            stationId: item.stationId,
            armed: item.armed,
            trackPlayer: item.trackPlayer,
            fireInterval: item.fireInterval,
            projectileSpeed: item.projectileSpeed,
            respawn: true,
          });
        }
      }
    }
  }

  /**
   * Registra hook de limpeza automática de objetos 3D quando entidades são destruídas no ECS.
   */
  registerSceneCleanup(): void {
    this.world.onEntityDestroyed((entity, w) => {
      const rend = w.get(entity, Renderable);
      if (rend) {
        this.scene.remove(rend.object3d);
        if (rend.disposeGeometry) {
          rend.object3d.traverse((obj) => {
            if (obj instanceof THREE.Mesh) {
              obj.geometry.dispose();
            }
          });
        }
        if (rend.disposeMaterial) {
          rend.object3d.traverse((obj) => {
            if (obj instanceof THREE.Mesh) {
              if (Array.isArray(obj.material)) {
                obj.material.forEach((m) => m.dispose());
              } else {
                obj.material.dispose();
              }
            }
          });
        }
      }

      const proj = w.get(entity, Projectile);
      if (proj) {
        this.scene.remove(proj.trailMesh);
        proj.trailMesh.geometry.dispose();
        (proj.trailMesh.material as THREE.Material).dispose();
      }
    });
  }
}
