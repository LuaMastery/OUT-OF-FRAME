import * as THREE from 'three';
import { ProceduralAudio } from '../../engine/audio/ProceduralAudio';
import { World } from '../../engine/ecs/World';
import {
  resolveCylinderWorldCollisions,
  StaticColliderBox,
  sweepSegmentVsSphere,
  sweepStaticWorld,
} from '../../engine/physics/SpatialSweep';
import {
  CrystalTarget,
  EphemeralShard,
  FrameCapturable,
  Kinematics,
  PocketStasis,
  Projectile,
  Transform,
} from '../components';
import { spawnCrystalShards } from '../EntityPrefabs';
import { CombatSystem } from './CombatSystem';

/**
 * Sistema Determinístico de Cinemática e Colisão Contínua (CCD).
 *
 * Executa exclusivamente dentro do callback de passo fixo (`simDt = 1/120s`) do `ChronoKernel`.
 */
export class KinematicsSystem {
  constructor(
    private readonly world: World,
    private readonly scene: THREE.Scene,
    private readonly audio: ProceduralAudio,
    private readonly combat: CombatSystem,
    private readonly onPlayerGrazed: () => void
  ) {}

  stepSimulation(
    simDt: number,
    colliders: readonly StaticColliderBox[],
    playerFootPos: THREE.Vector3
  ): void {
    // 1. Salva estado anterior para interpolação de renderização (`alpha`)
    const allTransforms = this.world.query(Transform.bit, PocketStasis.bit);
    for (const e of allTransforms) {
      const tr = this.world.getRequired(e, Transform);
      tr.prevPosition.copy(tr.position);
      tr.prevQuaternion.copy(tr.quaternion);
    }

    // 2. Integra projéteis com CCD por segmento varrido
    const projectiles = this.world.query(
      Transform.bit | Kinematics.bit | Projectile.bit,
      PocketStasis.bit
    );
    const targets = this.world.query(
      Transform.bit | CrystalTarget.bit,
      PocketStasis.bit
    );

    const playerTorsoCenter = playerFootPos.clone().add(new THREE.Vector3(0, 1.05, 0));

    for (const e of projectiles) {
      if (!this.world.isAlive(e)) continue;
      const tr = this.world.getRequired(e, Transform);
      const kin = this.world.getRequired(e, Kinematics);
      const proj = this.world.getRequired(e, Projectile);

      const start = tr.position.clone();
      const end = start.clone().addScaledVector(kin.velocity, simDt);

      // 2a. Choque no ar projétil-contra-projétil!
      let clashed = false;
      if (proj.faction !== 'enemy') {
        for (const other of projectiles) {
          if (other === e || !this.world.isAlive(other)) continue;
          const oProj = this.world.getRequired(other, Projectile);
          if (oProj.faction !== 'enemy') continue;
          const oTr = this.world.getRequired(other, Transform);
          const hitBullet = sweepSegmentVsSphere(start, end, oTr.position, 0.32);
          if (hitBullet) {
            spawnCrystalShards(
              this.world,
              this.scene,
              hitBullet.point,
              kin.velocity.clone().normalize(),
              7,
              0x00d2ff
            );
            this.audio.playRicochet();
            this.world.destroyEntity(other);
            this.world.destroyEntity(e);
            clashed = true;
            break;
          }
        }
      }
      if (clashed) continue;

      // 2b. Interseção contra Sentinelas Cristalinas e Núcleos Explosivos
      let hitTarget = false;
      for (const targetId of targets) {
        if (!this.world.isAlive(targetId)) continue;
        const tTr = this.world.getRequired(targetId, Transform);
        const tData = this.world.getRequired(targetId, CrystalTarget);

        // Evita auto-colisão imediata no frame de saída do cano da própria sentinela
        if (proj.faction === 'enemy' && proj.ttl > 8.38) {
          if (tTr.position.distanceToSquared(start) < 1.35) continue;
        }

        let hit = null;
        if (tData.isExplosiveCore) {
          hit = sweepSegmentVsSphere(start, end, tTr.position, 0.56);
        } else {
          const lowerCenter = tTr.position.clone().add(new THREE.Vector3(0, 0.72, 0));
          const upperCenter = tTr.position.clone().add(new THREE.Vector3(0, 1.56, 0));
          hit =
            sweepSegmentVsSphere(start, end, upperCenter, 0.52) ??
            sweepSegmentVsSphere(start, end, lowerCenter, 0.52);
        }

        if (hit) {
          const dir = kin.velocity.clone().normalize();
          this.combat.shatterTarget(targetId, dir);
          this.world.destroyEntity(e);
          hitTarget = true;
          break;
        }
      }
      if (hitTarget) continue;

      // 2c. Projétil inimigo contra o corpo do jogador na Sala de Testes
      if (proj.faction === 'enemy') {
        const hitPlayer = sweepSegmentVsSphere(start, end, playerTorsoCenter, 0.5);
        if (hitPlayer) {
          spawnCrystalShards(
            this.world,
            this.scene,
            hitPlayer.point,
            kin.velocity.clone().negate().normalize(),
            6,
            0xff1e2d
          );
          this.onPlayerGrazed();
          this.world.destroyEntity(e);
          continue;
        }
      }

      // 2d. Colisão varrida contra paredes e painéis defletores
      const wallHit = sweepStaticWorld(start, end, colliders, kin.radius);
      if (wallHit) {
        if (wallHit.collider?.reflective && proj.bouncesLeft > 0) {
          proj.bouncesLeft--;
          const n = wallHit.normal;
          kin.velocity.reflect(n);
          tr.position.copy(wallHit.point).addScaledVector(n, 0.04);

          const dir = kin.velocity.clone().normalize();
          const m = new THREE.Matrix4().lookAt(
            new THREE.Vector3(),
            dir,
            new THREE.Vector3(0, 1, 0)
          );
          tr.quaternion.setFromRotationMatrix(m);
          proj.trailHistory.push(tr.position.clone());
          this.audio.playRicochet();
          continue;
        } else {
          spawnCrystalShards(
            this.world,
            this.scene,
            wallHit.point,
            wallHit.normal,
            4,
            proj.faction === 'enemy' ? 0xff1e2d : 0x00d2ff
          );
          this.world.destroyEntity(e);
          continue;
        }
      }

      // Avanço livre
      tr.position.copy(end);
      this.integrateAngular(tr.quaternion, kin.angularVelocity, simDt);

      proj.trailHistory.push(tr.position.clone());
      if (proj.trailHistory.length > 18) {
        proj.trailHistory.shift();
      }
    }

    // 3. Integra corpos físicos não-balísticos (Cubos, Sentinelas reposicionadas, Estilhaços)
    const bodies = this.world.query(
      Transform.bit | Kinematics.bit,
      PocketStasis.bit | Projectile.bit
    );

    for (const e of bodies) {
      if (!this.world.isAlive(e)) continue;
      const tr = this.world.getRequired(e, Transform);
      const kin = this.world.getRequired(e, Kinematics);
      const isShard = this.world.has(e, EphemeralShard);
      const cap = this.world.get(e, FrameCapturable);
      const isSentinel = cap?.kind === 'sentinel';

      kin.velocity.y -= kin.gravity * simDt;
      if (kin.drag > 0) {
        kin.velocity.multiplyScalar(Math.exp(-kin.drag * simDt));
      }

      const start = tr.position.clone();
      const next = start.clone().addScaledVector(kin.velocity, simDt);

      if (isSentinel) {
        tr.position.copy(next);
        const res = resolveCylinderWorldCollisions(
          tr.position,
          kin.velocity,
          kin.radius,
          2.1,
          colliders
        );
        if (res.grounded && kin.groundFriction > 0) {
          const f = Math.exp(-kin.groundFriction * simDt);
          kin.velocity.x *= f;
          kin.velocity.z *= f;
        }
      } else {
        // Estilhaços e Cubos Cinéticos com quique elástico contra o mundo
        const hit = sweepStaticWorld(start, next, colliders, kin.radius);
        if (hit) {
          tr.position.copy(hit.point).addScaledVector(hit.normal, 0.015);
          const vn = kin.velocity.dot(hit.normal);
          if (vn < 0) {
            kin.velocity.addScaledVector(hit.normal, -(1 + kin.restitution) * vn);
          }
          if (hit.normal.y > 0.7 && kin.groundFriction > 0) {
            const f = Math.exp(-kin.groundFriction * simDt);
            kin.velocity.x *= f;
            kin.velocity.z *= f;
            kin.angularVelocity.multiplyScalar(f);
          }
        } else {
          tr.position.copy(next);
        }

        // Piso y = radius para cubos e estilhaços
        if (tr.position.y < kin.radius) {
          tr.position.y = kin.radius;
          if (kin.velocity.y < 0) {
            kin.velocity.y = -kin.velocity.y * kin.restitution;
            if (Math.abs(kin.velocity.y) < 0.45) kin.velocity.y = 0;
          }
          const f = Math.exp(-kin.groundFriction * simDt);
          kin.velocity.x *= f;
          kin.velocity.z *= f;
          kin.angularVelocity.multiplyScalar(f);
        }

        // Cubo cinético veloz esmaga Sentinelas Cristalinas no impacto!
        if (!isShard && cap?.kind === 'cube' && kin.velocity.lengthSq() > 16.0) {
          for (const targetId of targets) {
            if (targetId === e || !this.world.isAlive(targetId)) continue;
            const tTr = this.world.getRequired(targetId, Transform);
            const tCenter = tTr.position.clone().add(new THREE.Vector3(0, 1.0, 0));
            if (tr.position.distanceToSquared(tCenter) < 1.1) {
              this.combat.shatterTarget(
                targetId,
                kin.velocity.clone().normalize()
              );
            }
          }
        }
      }

      this.integrateAngular(tr.quaternion, kin.angularVelocity, simDt);
    }
  }

  private integrateAngular(
    quat: THREE.Quaternion,
    angVel: THREE.Vector3,
    dt: number
  ): void {
    const lenSq = angVel.lengthSq();
    if (lenSq < 1e-6) return;
    const angle = Math.sqrt(lenSq) * dt;
    const axis = angVel.clone().normalize();
    const dq = new THREE.Quaternion().setFromAxisAngle(axis, angle);
    quat.premultiply(dq).normalize();
  }
}
