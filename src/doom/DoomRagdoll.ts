import * as THREE from 'three';
import { StaticColliderBox } from '../engine/physics/SpatialSweep';
import {
  gridCellToWorld,
  isSolidCell,
  LABYRINTH_MAP,
  WALL_HEIGHT,
  worldToGridCell,
} from './DoomMazeBuilder';

export interface RagdollParticle {
  pos: THREE.Vector3;
  prev: THREE.Vector3;
  radius: number;
  invMass: number;
}

interface DistanceConstraint {
  a: number;
  b: number;
  restLength: number;
  stiffness: number;
}

/** Índices anatômicos das 11 massas pontuais do Ragdoll 3D do Astronauta */
export const RAGDOLL_IDX = {
  PELVIS: 0,
  CHEST: 1,
  HEAD: 2,
  ELBOW_L: 3,
  HAND_L: 4,
  ELBOW_R: 5,
  HAND_R: 6,
  KNEE_L: 7,
  FOOT_L: 8,
  KNEE_R: 9,
  FOOT_R: 10,
} as const;

/**
 * Motor físico Verlet 3D para o Astronauta Desmaiado (Ragdoll):
 * - Simula gravidade, inércia real, atrito com o piso, colisão contra paredes/móveis
 *   e tração dos 4 tentáculos da Aranha Gigante nos tornozelos, quadril e tórax!
 * - Zero NaN / explosão numérica garantido por substeps com clamp de velocidade.
 */
export class AstronautRagdoll {
  readonly particles: RagdollParticle[] = [];
  private readonly constraints: DistanceConstraint[] = [];
  private active = false;
  /** Direção lateral base do tronco (+1 = de costas olhando para cima, preservando articulação natural) */
  private readonly tmpA = new THREE.Vector3();
  private readonly tmpB = new THREE.Vector3();
  private readonly tmpRight = new THREE.Vector3(1, 0, 0);

  constructor() {
    const specs: Array<{ r: number; invM: number }> = [
      { r: 0.16, invM: 0.85 }, // 0 PELVIS
      { r: 0.19, invM: 0.72 }, // 1 CHEST (mochila PLSS pesada)
      { r: 0.16, invM: 1.05 }, // 2 HEAD (capacete solto/desmaiado)
      { r: 0.09, invM: 1.35 }, // 3 ELBOW_L
      { r: 0.08, invM: 1.55 }, // 4 HAND_L
      { r: 0.09, invM: 1.35 }, // 5 ELBOW_R
      { r: 0.08, invM: 1.55 }, // 6 HAND_R
      { r: 0.11, invM: 1.15 }, // 7 KNEE_L
      { r: 0.1, invM: 1.2 },   // 8 FOOT_L
      { r: 0.11, invM: 1.15 }, // 9 KNEE_R
      { r: 0.1, invM: 1.2 },   // 10 FOOT_R
    ];

    for (const s of specs) {
      this.particles.push({
        pos: new THREE.Vector3(),
        prev: new THREE.Vector3(),
        radius: s.r,
        invMass: s.invM,
      });
    }

    const link = (a: number, b: number, restLength: number, stiffness = 0.92) => {
      this.constraints.push({ a, b, restLength, stiffness });
    };

    // Coluna vertebral e pescoço
    link(RAGDOLL_IDX.PELVIS, RAGDOLL_IDX.CHEST, 0.44, 0.96);
    link(RAGDOLL_IDX.CHEST, RAGDOLL_IDX.HEAD, 0.3, 0.94);
    link(RAGDOLL_IDX.PELVIS, RAGDOLL_IDX.HEAD, 0.71, 0.45); // Evita dobra impossível de 180° no pescoço

    // Braços (ancorados nos ombros derivados do CHEST + restrições de comprimento)
    link(RAGDOLL_IDX.ELBOW_L, RAGDOLL_IDX.HAND_L, 0.26, 0.92);
    link(RAGDOLL_IDX.ELBOW_R, RAGDOLL_IDX.HAND_R, 0.26, 0.92);

    // Pernas
    link(RAGDOLL_IDX.KNEE_L, RAGDOLL_IDX.FOOT_L, 0.39, 0.94);
    link(RAGDOLL_IDX.KNEE_R, RAGDOLL_IDX.FOOT_R, 0.39, 0.94);
    // Afastamento mínimo natural entre joelhos e botas
    link(RAGDOLL_IDX.KNEE_L, RAGDOLL_IDX.KNEE_R, 0.24, 0.35);
    link(RAGDOLL_IDX.FOOT_L, RAGDOLL_IDX.FOOT_R, 0.26, 0.32);
  }

  get isActive(): boolean {
    return this.active;
  }

  get pelvisPos(): THREE.Vector3 {
    return this.particles[RAGDOLL_IDX.PELVIS].pos;
  }

  get chestPos(): THREE.Vector3 {
    return this.particles[RAGDOLL_IDX.CHEST].pos;
  }

  get headPos(): THREE.Vector3 {
    return this.particles[RAGDOLL_IDX.HEAD].pos;
  }

  resetInactive(): void {
    this.active = false;
  }

  /**
   * Inicializa o Ragdoll em pé na posição exata do jogador capturado e aplica o impacto
   * brutal da Aranha que o derruba desmaiado (inconsciente) para trás no chão!
   */
  spawnFromStandingAndCollapse(
    playerFloorPos: THREE.Vector3,
    playerYaw: number,
    spiderPos: THREE.Vector3
  ): void {
    this.active = true;
    const awayX = playerFloorPos.x - spiderPos.x;
    const awayZ = playerFloorPos.z - spiderPos.z;
    const awayLen = Math.hypot(awayX, awayZ);
    const backDirX =
      awayLen > 1e-3 ? awayX / awayLen : Math.sin(playerYaw);
    const backDirZ =
      awayLen > 1e-3 ? awayZ / awayLen : Math.cos(playerYaw);
    const rightX = -backDirZ;
    const rightZ = backDirX;

    const setPart = (
      idx: number,
      x: number,
      y: number,
      z: number,
      vx = 0,
      vy = 0,
      vz = 0
    ) => {
      const p = this.particles[idx];
      p.pos.set(x, y, z);
      // dt nominal de 1/60s codifica a velocidade inicial Verlet!
      p.prev.set(x - vx / 60, y - vy / 60, z - vz / 60);
    };

    const px = playerFloorPos.x;
    const pz = playerFloorPos.z;

    // Impulso do golpe derruba o tronco e a cabeça para trás enquanto os pés escorregam à frente (rumo à aranha)
    setPart(
      RAGDOLL_IDX.PELVIS,
      px + backDirX * 0.06,
      0.86,
      pz + backDirZ * 0.06,
      backDirX * 1.4,
      -1.8,
      backDirZ * 1.4
    );
    setPart(
      RAGDOLL_IDX.CHEST,
      px + backDirX * 0.16,
      1.28,
      pz + backDirZ * 0.16,
      backDirX * 3.1,
      -2.2,
      backDirZ * 3.1
    );
    setPart(
      RAGDOLL_IDX.HEAD,
      px + backDirX * 0.24 + rightX * 0.04,
      1.56,
      pz + backDirZ * 0.24 + rightZ * 0.04,
      backDirX * 3.8 + rightX * 0.5,
      -2.4,
      backDirZ * 3.8 + rightZ * 0.5
    );

    setPart(
      RAGDOLL_IDX.ELBOW_L,
      px - rightX * 0.34 + backDirX * 0.12,
      1.12,
      pz - rightZ * 0.34 + backDirZ * 0.12,
      backDirX * 2.4 - rightX * 1.1,
      -1.5,
      backDirZ * 2.4 - rightZ * 1.1
    );
    setPart(
      RAGDOLL_IDX.HAND_L,
      px - rightX * 0.44 + backDirX * 0.18,
      0.92,
      pz - rightZ * 0.44 + backDirZ * 0.18,
      backDirX * 2.8 - rightX * 1.5,
      -1.2,
      backDirZ * 2.8 - rightZ * 1.5
    );

    setPart(
      RAGDOLL_IDX.ELBOW_R,
      px + rightX * 0.34 + backDirX * 0.12,
      1.12,
      pz + rightZ * 0.34 + backDirZ * 0.12,
      backDirX * 2.4 + rightX * 1.1,
      -1.5,
      backDirZ * 2.4 + rightZ * 1.1
    );
    setPart(
      RAGDOLL_IDX.HAND_R,
      px + rightX * 0.44 + backDirX * 0.18,
      0.92,
      pz + rightZ * 0.44 + backDirZ * 0.18,
      backDirX * 2.8 + rightX * 1.5,
      -1.2,
      backDirZ * 2.8 + rightZ * 1.5
    );

    setPart(
      RAGDOLL_IDX.KNEE_L,
      px - rightX * 0.12 - backDirX * 0.08,
      0.48,
      pz - rightZ * 0.12 - backDirZ * 0.08,
      -backDirX * 0.9,
      -1.0,
      -backDirZ * 0.9
    );
    setPart(
      RAGDOLL_IDX.FOOT_L,
      px - rightX * 0.13 - backDirX * 0.18,
      0.12,
      pz - rightZ * 0.13 - backDirZ * 0.18,
      -backDirX * 1.5,
      0.4,
      -backDirZ * 1.5
    );

    setPart(
      RAGDOLL_IDX.KNEE_R,
      px + rightX * 0.12 - backDirX * 0.08,
      0.48,
      pz + rightZ * 0.12 - backDirZ * 0.08,
      -backDirX * 0.9,
      -1.0,
      -backDirZ * 0.9
    );
    setPart(
      RAGDOLL_IDX.FOOT_R,
      px + rightX * 0.13 - backDirX * 0.18,
      0.12,
      pz + rightZ * 0.13 - backDirZ * 0.18,
      -backDirX * 1.5,
      0.4,
      -backDirZ * 1.5
    );
  }

  /**
   * Inicializa o Ragdoll diretamente já caído no chão (usado quando um observador Multiplayer
   * começa a ver um aliado que já estava no meio do arrasto).
   */
  spawnSupineOnFloor(
    pelvisFloorPos: THREE.Vector3,
    spiderPos: THREE.Vector3
  ): void {
    this.active = true;
    let dx = spiderPos.x - pelvisFloorPos.x;
    let dz = spiderPos.z - pelvisFloorPos.z;
    const len = Math.hypot(dx, dz);
    if (len > 1e-3) {
      dx /= len;
      dz /= len;
    } else {
      dx = 0;
      dz = -1;
    }
    const rx = -dz;
    const rz = dx;

    const place = (idx: number, x: number, y: number, z: number) => {
      this.particles[idx].pos.set(x, y, z);
      this.particles[idx].prev.set(x, y, z);
    };

    const px = pelvisFloorPos.x;
    const pz = pelvisFloorPos.z;
    place(RAGDOLL_IDX.PELVIS, px, 0.17, pz);
    place(RAGDOLL_IDX.CHEST, px - dx * 0.43, 0.2, pz - dz * 0.43);
    place(RAGDOLL_IDX.HEAD, px - dx * 0.72, 0.17, pz - dz * 0.72);
    place(RAGDOLL_IDX.ELBOW_L, px - dx * 0.56 - rx * 0.28, 0.11, pz - dz * 0.56 - rz * 0.28);
    place(RAGDOLL_IDX.HAND_L, px - dx * 0.8 - rx * 0.34, 0.09, pz - dz * 0.8 - rz * 0.34);
    place(RAGDOLL_IDX.ELBOW_R, px - dx * 0.56 + rx * 0.28, 0.11, pz - dz * 0.56 + rz * 0.28);
    place(RAGDOLL_IDX.HAND_R, px - dx * 0.8 + rx * 0.34, 0.09, pz - dz * 0.8 + rz * 0.34);
    place(RAGDOLL_IDX.KNEE_L, px + dx * 0.36 - rx * 0.13, 0.18, pz + dz * 0.36 - rz * 0.13);
    place(RAGDOLL_IDX.FOOT_L, px + dx * 0.73 - rx * 0.15, 0.24, pz + dz * 0.73 - rz * 0.15);
    place(RAGDOLL_IDX.KNEE_R, px + dx * 0.36 + rx * 0.13, 0.18, pz + dz * 0.36 + rz * 0.13);
    place(RAGDOLL_IDX.FOOT_R, px + dx * 0.73 + rx * 0.15, 0.24, pz + dz * 0.73 + rz * 0.15);
  }

  /**
   * Simula a queda livre em Ragdoll durante o nocaute inicial (`STRIKE_ATTACK`).
   */
  stepKnockoutCollapse(
    dt: number,
    spiderPos: THREE.Vector3,
    tentacleGrabFactor: number,
    colliders: readonly StaticColliderBox[]
  ): void {
    if (!this.active) return;
    const clampedDt = Math.min(0.04, Math.max(0.001, dt));
    const substeps = 4;
    const subDt = clampedDt / substeps;

    for (let s = 0; s < substeps; s++) {
      this.integrateVerlet(subDt, -16.5);

      if (tentacleGrabFactor > 0.01) {
        // Quando os tentáculos se agarram nos tornozelos no fim do bote, já erguem levemente as botas!
        const pelvis = this.particles[RAGDOLL_IDX.PELVIS].pos;
        let dx = spiderPos.x - pelvis.x;
        let dz = spiderPos.z - pelvis.z;
        const d = Math.hypot(dx, dz) || 1;
        dx /= d;
        dz /= d;
        const rx = -dz;
        const rz = dx;

        const pullFootL = this.tmpA.set(
          pelvis.x + dx * 0.68 - rx * 0.14,
          0.26,
          pelvis.z + dz * 0.68 - rz * 0.14
        );
        const pullFootR = this.tmpB.set(
          pelvis.x + dx * 0.68 + rx * 0.14,
          0.26,
          pelvis.z + dz * 0.68 + rz * 0.14
        );
        this.particles[RAGDOLL_IDX.FOOT_L].pos.lerp(
          pullFootL,
          tentacleGrabFactor * 0.25
        );
        this.particles[RAGDOLL_IDX.FOOT_R].pos.lerp(
          pullFootR,
          tentacleGrabFactor * 0.25
        );
      }

      this.solveAnatomicalConstraints(colliders);
    }
  }

  /**
   * Simula a Aranha puxando o Ragdoll desmaiado pelos tentáculos ao longo dos corredores até a teia!
   */
  stepTentacleDrag(
    dt: number,
    spiderPos: THREE.Vector3,
    targetPelvisFloorPos: THREE.Vector3,
    pullTension01: number,
    colliders: readonly StaticColliderBox[]
  ): void {
    if (!this.active) {
      this.spawnSupineOnFloor(targetPelvisFloorPos, spiderPos);
    }
    const clampedDt = Math.min(0.04, Math.max(0.001, dt));
    const substeps = 4;
    const subDt = clampedDt / substeps;

    let toSpiderX = spiderPos.x - targetPelvisFloorPos.x;
    let toSpiderZ = spiderPos.z - targetPelvisFloorPos.z;
    const toSpiderLen = Math.hypot(toSpiderX, toSpiderZ);
    if (toSpiderLen > 1e-3) {
      toSpiderX /= toSpiderLen;
      toSpiderZ /= toSpiderLen;
    } else {
      toSpiderX = 0;
      toSpiderZ = -1;
    }
    const rx = -toSpiderZ;
    const rz = toSpiderX;

    const footLiftY = 0.25 + pullTension01 * 0.14;
    const pelvisTargetY = 0.18 + pullTension01 * 0.05;

    for (let s = 0; s < substeps; s++) {
      this.integrateVerlet(subDt, -16.0);

      // Tentáculos 0 e 1 puxam os dois tornozelos erguidos na direção da Aranha;
      // Tentáculo 2 puxa o quadril (pelvis) ao longo da trilha real do corredor;
      // Tórax, cabeça desmaiada e braços arrastam passivamente atrás pela física Verlet!
      const pelvisAlpha = Math.min(1, subDt * (15.0 + pullTension01 * 12.0));
      const pelvis = this.particles[RAGDOLL_IDX.PELVIS].pos;
      pelvis.x += (targetPelvisFloorPos.x - pelvis.x) * pelvisAlpha;
      pelvis.y += (pelvisTargetY - pelvis.y) * (pelvisAlpha * 0.85);
      pelvis.z += (targetPelvisFloorPos.z - pelvis.z) * pelvisAlpha;

      const footAlpha = Math.min(1, subDt * (18.0 + pullTension01 * 14.0));
      const targetFootLX = pelvis.x + toSpiderX * 0.72 - rx * 0.15;
      const targetFootLZ = pelvis.z + toSpiderZ * 0.72 - rz * 0.15;
      const targetFootRX = pelvis.x + toSpiderX * 0.72 + rx * 0.15;
      const targetFootRZ = pelvis.z + toSpiderZ * 0.72 + rz * 0.15;

      const footL = this.particles[RAGDOLL_IDX.FOOT_L].pos;
      footL.x += (targetFootLX - footL.x) * footAlpha;
      footL.y += (footLiftY - footL.y) * footAlpha;
      footL.z += (targetFootLZ - footL.z) * footAlpha;

      const footR = this.particles[RAGDOLL_IDX.FOOT_R].pos;
      footR.x += (targetFootRX - footR.x) * footAlpha;
      footR.y += (footLiftY - footR.y) * footAlpha;
      footR.z += (targetFootRZ - footR.z) * footAlpha;

      this.solveAnatomicalConstraints(colliders);
    }
  }

  /**
   * Simula os tentáculos da Aranha erguendo o Ragdoll desmaiado e prendendo-o na Teia do Ninho!
   */
  stepWebPlacementLift(
    dt: number,
    lairCenter: THREE.Vector3,
    spiderPos: THREE.Vector3,
    liftProgress01: number,
    colliders: readonly StaticColliderBox[]
  ): void {
    if (!this.active) {
      this.spawnSupineOnFloor(lairCenter, spiderPos);
    }
    const clampedDt = Math.min(0.04, Math.max(0.001, dt));
    const substeps = 4;
    const subDt = clampedDt / substeps;
    const ease =
      liftProgress01 * liftProgress01 * (3 - 2 * liftProgress01);

    let dx = spiderPos.x - lairCenter.x;
    let dz = spiderPos.z - lairCenter.z;
    const len = Math.hypot(dx, dz) || 1;
    dx /= len;
    dz /= len;
    const rx = -dz;
    const rz = dx;

    for (let s = 0; s < substeps; s++) {
      this.integrateVerlet(subDt, -13.5);

      const alpha = Math.min(1, subDt * 14.0);
      // Ergue o tronco e quadril do ragdoll desacordado para dentro do casulo vertical/inclinado na teia!
      const pPelvis = this.particles[RAGDOLL_IDX.PELVIS].pos;
      pPelvis.x += (lairCenter.x - pPelvis.x) * alpha;
      pPelvis.y += (0.2 + ease * 0.44 - pPelvis.y) * alpha;
      pPelvis.z += (lairCenter.z - pPelvis.z) * alpha;

      const pChest = this.particles[RAGDOLL_IDX.CHEST].pos;
      pChest.x += (lairCenter.x - dx * (0.34 * (1 - ease * 0.72)) - pChest.x) * alpha;
      pChest.y += (0.22 + ease * 0.82 - pChest.y) * alpha;
      pChest.z += (lairCenter.z - dz * (0.34 * (1 - ease * 0.72)) - pChest.z) * alpha;

      // Braços vão sendo juntados junto ao tronco conforme a seda é tecida!
      if (ease > 0.25) {
        const bindAlpha = alpha * ease * 0.75;
        this.particles[RAGDOLL_IDX.HAND_L].pos.lerp(
          this.tmpA.set(
            pChest.x - rx * 0.22 + dx * 0.12,
            pPelvis.y + 0.12,
            pChest.z - rz * 0.22 + dz * 0.12
          ),
          bindAlpha
        );
        this.particles[RAGDOLL_IDX.HAND_R].pos.lerp(
          this.tmpB.set(
            pChest.x + rx * 0.22 + dx * 0.12,
            pPelvis.y + 0.12,
            pChest.z + rz * 0.22 + dz * 0.12
          ),
          bindAlpha
        );
      }

      this.solveAnatomicalConstraints(colliders);
    }
  }

  /**
   * Retorna os 4 pontos anatômicos exatos onde os 4 tentáculos da Aranha se prendem no Ragdoll:
   * `[Tornozelo Esquerdo, Tornozelo Direito, Quadril/Cintura, Tórax]`.
   */
  getTentacleAttachmentPoints(): [
    THREE.Vector3,
    THREE.Vector3,
    THREE.Vector3,
    THREE.Vector3,
  ] {
    return [
      this.particles[RAGDOLL_IDX.FOOT_L].pos,
      this.particles[RAGDOLL_IDX.FOOT_R].pos,
      this.particles[RAGDOLL_IDX.PELVIS].pos,
      this.particles[RAGDOLL_IDX.CHEST].pos,
    ];
  }

  private integrateVerlet(subDt: number, gravityY: number): void {
    const dtSq = subDt * subDt;
    const maxStep = 0.42;

    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      if (p.invMass <= 0) continue;

      const onFloor = p.pos.y <= p.radius + 0.025;
      const damp = onFloor ? 0.84 : 0.965;

      let vx = (p.pos.x - p.prev.x) * damp;
      let vy = (p.pos.y - p.prev.y) * 0.96;
      let vz = (p.pos.z - p.prev.z) * damp;

      // Micro-trepidação física das placas do piso quando arrastado rente ao chão
      const planarStep = Math.hypot(vx, vz);
      if (onFloor && planarStep > 0.004) {
        const seamBump =
          Math.sin(p.pos.x * 7.5 + p.pos.z * 6.3 + i * 1.9) * 0.0045;
        vy += Math.max(0, seamBump);
      }

      p.prev.copy(p.pos);

      vx = Math.max(-maxStep, Math.min(maxStep, vx));
      vy = Math.max(-maxStep, Math.min(maxStep, vy + gravityY * dtSq));
      vz = Math.max(-maxStep, Math.min(maxStep, vz));

      p.pos.x += vx;
      p.pos.y += vy;
      p.pos.z += vz;

      if (!Number.isFinite(p.pos.x) || !Number.isFinite(p.pos.y) || !Number.isFinite(p.pos.z)) {
        p.pos.copy(p.prev);
      }
    }
  }

  private solveAnatomicalConstraints(
    colliders: readonly StaticColliderBox[]
  ): void {
    const pelvis = this.particles[RAGDOLL_IDX.PELVIS];
    const chest = this.particles[RAGDOLL_IDX.CHEST];

    // Calcula eixo lateral direito do tronco no plano horizontal para ancorar ombros e quadris sem torção!
    const spineX = chest.pos.x - pelvis.pos.x;
    const spineZ = chest.pos.z - pelvis.pos.z;
    const spinePlanar = Math.hypot(spineX, spineZ);
    if (spinePlanar > 1e-3) {
      // Deitado de costas (supino): +X anatômico fica a +90° da direção pelvis->chest
      this.tmpRight.set(-spineZ / spinePlanar, 0, spineX / spinePlanar);
    }

    for (let iter = 0; iter < 5; iter++) {
      // 1. Restrições de distância da coluna, antebraços e canelas
      for (let c = 0; c < this.constraints.length; c++) {
        const con = this.constraints[c];
        const pa = this.particles[con.a];
        const pb = this.particles[con.b];
        const dx = pb.pos.x - pa.pos.x;
        const dy = pb.pos.y - pa.pos.y;
        const dz = pb.pos.z - pa.pos.z;
        const dist = Math.hypot(dx, dy, dz);
        if (dist < 1e-5) continue;
        const wSum = pa.invMass + pb.invMass;
        if (wSum <= 0) continue;
        const diff = ((dist - con.restLength) / dist) * con.stiffness;
        const wa = pa.invMass / wSum;
        const wb = pb.invMass / wSum;
        pa.pos.x += dx * diff * wa;
        pa.pos.y += dy * diff * wa;
        pa.pos.z += dz * diff * wa;
        pb.pos.x -= dx * diff * wb;
        pb.pos.y -= dy * diff * wb;
        pb.pos.z -= dz * diff * wb;
      }

      // 2. Ancoragem anatômica dos cotovelos aos ombros (±0.25m do CHEST) e joelhos aos quadris (±0.12m do PELVIS)
      this.solveSocketDistance(
        chest.pos.x - this.tmpRight.x * 0.25,
        chest.pos.y,
        chest.pos.z - this.tmpRight.z * 0.25,
        this.particles[RAGDOLL_IDX.ELBOW_L],
        0.28,
        0.92
      );
      this.solveSocketDistance(
        chest.pos.x + this.tmpRight.x * 0.25,
        chest.pos.y,
        chest.pos.z + this.tmpRight.z * 0.25,
        this.particles[RAGDOLL_IDX.ELBOW_R],
        0.28,
        0.92
      );
      this.solveSocketDistance(
        pelvis.pos.x - this.tmpRight.x * 0.12,
        pelvis.pos.y,
        pelvis.pos.z - this.tmpRight.z * 0.12,
        this.particles[RAGDOLL_IDX.KNEE_L],
        0.38,
        0.94
      );
      this.solveSocketDistance(
        pelvis.pos.x + this.tmpRight.x * 0.12,
        pelvis.pos.y,
        pelvis.pos.z + this.tmpRight.z * 0.12,
        this.particles[RAGDOLL_IDX.KNEE_R],
        0.38,
        0.94
      );

      // 3. Piso, teto e paredes/móveis sólidos
      for (let i = 0; i < this.particles.length; i++) {
        const p = this.particles[i];
        if (p.pos.y < p.radius) {
          p.pos.y = p.radius;
        } else if (p.pos.y > WALL_HEIGHT - 0.25) {
          p.pos.y = WALL_HEIGHT - 0.25;
        }
      }
    }

    // Colisão horizontal contra paredes e móveis nas massas centrais (rápido e suave)
    for (const idx of [
      RAGDOLL_IDX.PELVIS,
      RAGDOLL_IDX.CHEST,
      RAGDOLL_IDX.HEAD,
      RAGDOLL_IDX.FOOT_L,
      RAGDOLL_IDX.FOOT_R,
    ]) {
      const p = this.particles[idx];
      resolveSphereHorizontalColliders(p.pos, p.radius + 0.08, colliders);
    }
  }

  private solveSocketDistance(
    sx: number,
    sy: number,
    sz: number,
    limbPart: RagdollParticle,
    restLen: number,
    stiffness: number
  ): void {
    const dx = limbPart.pos.x - sx;
    const dy = limbPart.pos.y - sy;
    const dz = limbPart.pos.z - sz;
    const d = Math.hypot(dx, dy, dz);
    if (d < 1e-5) return;
    const corr = ((d - restLen) / d) * stiffness;
    limbPart.pos.x -= dx * corr;
    limbPart.pos.y -= dy * corr;
    limbPart.pos.z -= dz * corr;
  }
}

function resolveSphereHorizontalColliders(
  pos: THREE.Vector3,
  radius: number,
  colliders: readonly StaticColliderBox[]
): void {
  const rSq = radius * radius;
  for (let i = 0; i < colliders.length; i++) {
    const c = colliders[i];
    if (c.isCrawlUnder) continue;
    const b = c.box;
    if (pos.y + radius < b.min.y || pos.y - radius > b.max.y) continue;
    if (
      pos.x < b.min.x - radius ||
      pos.x > b.max.x + radius ||
      pos.z < b.min.z - radius ||
      pos.z > b.max.z + radius
    ) {
      continue;
    }
    const cx = Math.max(b.min.x, Math.min(pos.x, b.max.x));
    const cz = Math.max(b.min.z, Math.min(pos.z, b.max.z));
    const ox = pos.x - cx;
    const oz = pos.z - cz;
    const dSq = ox * ox + oz * oz;
    if (dSq < rSq) {
      if (dSq > 1e-6) {
        const d = Math.sqrt(dSq);
        const push = radius - d;
        pos.x += (ox / d) * push;
        pos.z += (oz / d) * push;
      } else {
        pos.y = Math.max(pos.y, radius);
      }
    }
  }
}

// ============================================================================
// SOLUCIONADOR DE CAMINHO REAL DE ARRASTO PELO LABIRINTO (ZERO TELETRANSPORTE!)
// ============================================================================

export interface DragPolylinePath {
  points: THREE.Vector3[];
  cumulativeLengths: number[];
  totalLength: number;
}

/**
 * Calcula o caminho real transitável pelo labirinto desde o local exato onde o jogador foi
 * capturado até o centro do Ninho de Teia (`lairCenter`), permitindo que a Aranha puxe o
 * Ragdoll continuamente por todos os corredores e portas sem teletransportar!
 */
export function computeWalkableDragPolyline(
  startWorld: THREE.Vector3,
  lairCenter: THREE.Vector3
): DragPolylinePath {
  const rows = LABYRINTH_MAP.length;
  const cols = LABYRINTH_MAP[0].length;
  const startCell = worldToGridCell(startWorld.x, startWorld.z);
  const endCell = worldToGridCell(lairCenter.x, lairCenter.z);

  const clampWalkable = (gx: number, gz: number): { gx: number; gz: number } => {
    const cx = Math.max(1, Math.min(cols - 2, gx));
    const cz = Math.max(1, Math.min(rows - 2, gz));
    if (!isSolidCell(LABYRINTH_MAP, cx, cz)) return { gx: cx, gz: cz };
    for (let r = 1; r <= 4; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          const nx = cx + dx;
          const nz = cz + dz;
          if (
            nx > 0 &&
            nx < cols - 1 &&
            nz > 0 &&
            nz < rows - 1 &&
            !isSolidCell(LABYRINTH_MAP, nx, nz)
          ) {
            return { gx: nx, gz: nz };
          }
        }
      }
    }
    return { gx: cx, gz: cz };
  };

  const s = clampWalkable(startCell.gx, startCell.gz);
  const e = clampWalkable(endCell.gx, endCell.gz);

  const totalCells = rows * cols;
  const visited = new Uint8Array(totalCells);
  const parent = new Int32Array(totalCells).fill(-1);
  const queue = new Int32Array(totalCells);
  let head = 0;
  let tail = 0;

  const sIdx = s.gz * cols + s.gx;
  const eIdx = e.gz * cols + e.gx;
  visited[sIdx] = 1;
  queue[tail++] = sIdx;

  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const;

  while (head < tail) {
    const cur = queue[head++];
    if (cur === eIdx) break;
    const cgx = cur % cols;
    const cgz = (cur / cols) | 0;
    for (const [dx, dz] of dirs) {
      const ngx = cgx + dx;
      const ngz = cgz + dz;
      if (ngx <= 0 || ngx >= cols - 1 || ngz <= 0 || ngz >= rows - 1) continue;
      if (isSolidCell(LABYRINTH_MAP, ngx, ngz)) continue;
      const nIdx = ngz * cols + ngx;
      if (visited[nIdx]) continue;
      visited[nIdx] = 1;
      parent[nIdx] = cur;
      queue[tail++] = nIdx;
    }
  }

  const rawPoints: THREE.Vector3[] = [
    new THREE.Vector3(startWorld.x, 0, startWorld.z),
  ];

  if (visited[eIdx]) {
    const cellChain: number[] = [];
    let cur = eIdx;
    while (cur !== -1 && cur !== sIdx) {
      cellChain.push(cur);
      cur = parent[cur];
    }
    cellChain.reverse();
    for (let i = 0; i < cellChain.length - 1; i++) {
      const idx = cellChain[i];
      const gx = idx % cols;
      const gz = (idx / cols) | 0;
      const w = gridCellToWorld(gx, gz);
      rawPoints.push(new THREE.Vector3(w.x, 0, w.z));
    }
  }
  rawPoints.push(new THREE.Vector3(lairCenter.x, 0, lairCenter.z));

  // Suavização leve de curvas em "L" (chanfro interno de 22% sem invadir quinas sólidas!)
  const smoothed: THREE.Vector3[] = [rawPoints[0].clone()];
  for (let i = 1; i < rawPoints.length - 1; i++) {
    const prev = rawPoints[i - 1];
    const curr = rawPoints[i];
    const next = rawPoints[i + 1];
    smoothed.push(new THREE.Vector3().lerpVectors(curr, prev, 0.2));
    smoothed.push(new THREE.Vector3().lerpVectors(curr, next, 0.2));
  }
  if (rawPoints.length > 1) {
    smoothed.push(rawPoints[rawPoints.length - 1].clone());
  }

  const cumulativeLengths: number[] = [0];
  let totalLength = 0;
  for (let i = 1; i < smoothed.length; i++) {
    const seg = smoothed[i].distanceTo(smoothed[i - 1]);
    totalLength += seg;
    cumulativeLengths.push(totalLength);
  }

  return {
    points: smoothed,
    cumulativeLengths,
    totalLength: Math.max(0.01, totalLength),
  };
}

/**
 * Amostra uma posição e direção tangente ao longo da polilinha de arrasto.
 */
export function sampleDragPolyline(
  path: DragPolylinePath,
  distanceAlong: number,
  outPos: THREE.Vector3,
  outDirToLair?: THREE.Vector3
): void {
  const pts = path.points;
  const lens = path.cumulativeLengths;
  if (pts.length === 1) {
    outPos.copy(pts[0]);
    outDirToLair?.set(0, 0, 1);
    return;
  }

  const clamped = Math.max(0, Math.min(path.totalLength, distanceAlong));
  let segIdx = 0;
  for (let i = 0; i < lens.length - 1; i++) {
    if (clamped <= lens[i + 1] || i === lens.length - 2) {
      segIdx = i;
      break;
    }
  }

  const l0 = lens[segIdx];
  const l1 = lens[segIdx + 1];
  const span = Math.max(1e-5, l1 - l0);
  const t = Math.max(0, Math.min(1, (clamped - l0) / span));
  outPos.lerpVectors(pts[segIdx], pts[segIdx + 1], t);

  if (outDirToLair) {
    outDirToLair.subVectors(pts[segIdx + 1], pts[segIdx]);
    outDirToLair.y = 0;
    if (outDirToLair.lengthSq() > 1e-6) {
      outDirToLair.normalize();
    } else {
      outDirToLair.set(0, 0, 1);
    }
  }
}

/**
 * Posiciona a câmera em 3ª pessoa de Ragdoll sem jamais atravessar paredes ou móveis,
 * enquadrando tanto o Astronauta desmaiado em Ragdoll quanto a Aranha puxando seus tentáculos!
 */
export function computeCollisionSafeRagdollCamera(
  ragdoll: AstronautRagdoll,
  spiderPos: THREE.Vector3,
  colliders: readonly StaticColliderBox[],
  outCamPos: THREE.Vector3,
  outLookTarget: THREE.Vector3
): void {
  const pelvis = ragdoll.pelvisPos;
  const head = ragdoll.headPos;

  // Olha para o ponto médio entre o Ragdoll desmaiado e os tentáculos da Aranha!
  outLookTarget.set(
    pelvis.x * 0.62 + spiderPos.x * 0.38,
    Math.max(0.42, pelvis.y * 0.5 + 0.38),
    pelvis.z * 0.62 + spiderPos.z * 0.38
  );

  // Direção preferencial da câmera: atrás da cabeça do Ragdoll, olhando por cima do corpo rumo à Aranha!
  let backX = head.x - spiderPos.x;
  let backZ = head.z - spiderPos.z;
  const len = Math.hypot(backX, backZ);
  if (len > 1e-3) {
    backX /= len;
    backZ /= len;
  } else {
    backX = 0;
    backZ = 1;
  }

  const desiredDist = 1.68;
  const desiredY = 1.32;
  const startX = pelvis.x;
  const startY = Math.max(0.55, pelvis.y + 0.42);
  const startZ = pelvis.z;

  let safeFrac = 0.15;
  const steps = 10;
  for (let s = 1; s <= steps; s++) {
    const f = s / steps;
    const cx = startX + backX * desiredDist * f;
    const cy = startY + (desiredY - startY) * f;
    const cz = startZ + backZ * desiredDist * f;

    let blocked = false;
    for (let i = 0; i < colliders.length; i++) {
      if (colliders[i].isCrawlUnder) continue;
      const b = colliders[i].box;
      if (cy < b.min.y - 0.18 || cy > b.max.y + 0.18) continue;
      if (
        cx >= b.min.x - 0.24 &&
        cx <= b.max.x + 0.24 &&
        cz >= b.min.z - 0.24 &&
        cz <= b.max.z + 0.24
      ) {
        blocked = true;
        break;
      }
    }
    if (blocked) break;
    safeFrac = f;
  }

  outCamPos.set(
    startX + backX * desiredDist * safeFrac,
    Math.min(WALL_HEIGHT - 0.35, startY + (desiredY - startY) * safeFrac),
    startZ + backZ * desiredDist * safeFrac
  );
}
