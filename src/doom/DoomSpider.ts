import * as THREE from 'three';
import { SoundEngine } from '../engine/audio/SoundEngine';
import { StaticColliderBox } from '../engine/physics/SpatialSweep';
import {
  CELL_SIZE,
  gridCellToWorld,
  isArchCell,
  isSolidCell,
  LABYRINTH_MAP,
  WALL_HEIGHT,
  worldToGridCell,
} from './DoomMazeBuilder';
import { createSpiderChitinMaterial, DoomSharedUniforms } from './DoomShader';
import { DoomSpiderWebManager } from './DoomSpiderWebs';
import { ActiveMagnesiumFlare } from './DoomWorldItems';

export type SpiderSurfaceMode = 'FLOOR' | 'WALL' | 'CEILING';

export type SpiderBehaviorState =
  | 'STALK_PATROL'
  | 'CEILING_AMBUSH'
  | 'SPINNING_WEB'
  | 'ALERT_WINDUP'
  | 'FRENZY_CHASE'
  | 'CINEMATIC_SEQUENCE'
  | 'FLEE_RETREAT';

export type SpiderCinematicMode =
  | 'STRIKE_ATTACK'
  | 'DRAGGING_TO_WEB'
  | 'WEBBING_IN_LAIR'
  | 'FATAL_EXECUTION';

const RING_SIDES = 6;
const CURVE_SAMPLES = 16;
const IK_ITERATIONS = 3;

interface SpiderLimbSpec {
  index: number;
  rootLocal: THREE.Vector3;
  angleRad: number;
  spread: number;
  segments: number;
  lengths: number[];
  totalLength: number;
  baseWidth: number;
  stepDistance: number;
  stepTime: number;
  stepHeight: number;
  phase: number;
  freq: number;
  shade: number;
  neighbourIndices: number[];
}

interface SpiderLimbRuntime {
  ikPoints: THREE.Vector3[];
  curvePoints: THREE.Vector3[];
  footWorld: THREE.Vector3;
  stepFrom: THREE.Vector3;
  targetWorld: THREE.Vector3;
  stepping: boolean;
  stepT: number;
  onMetalOrCeiling: boolean;
  raiseThreat: number;
  twitch: THREE.Vector3;
  mesh: THREE.Mesh;
  posAttr: THREE.BufferAttribute;
  normAttr: THREE.BufferAttribute;
  colAttr: THREE.BufferAttribute;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function smoothStep01(t: number): number {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
}

function catmullRomVec3(
  p0: THREE.Vector3,
  p1: THREE.Vector3,
  p2: THREE.Vector3,
  p3: THREE.Vector3,
  t: number,
  out: THREE.Vector3
): THREE.Vector3 {
  const t2 = t * t;
  const t3 = t2 * t;
  out.x =
    0.5 *
    (2 * p1.x +
      (-p0.x + p2.x) * t +
      (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
      (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3);
  out.y =
    0.5 *
    (2 * p1.y +
      (-p0.y + p2.y) * t +
      (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
      (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3);
  out.z =
    0.5 *
    (2 * p1.z +
      (-p0.z + p2.z) * t +
      (2 * p0.z - 5 * p1.z + 4 * p2.z - p3.z) * t2 +
      (-p0.z + 3 * p1.z - 3 * p2.z + p3.z) * t3);
  return out;
}

function solveFabrikChain(
  points: THREE.Vector3[],
  lengths: number[],
  root: THREE.Vector3,
  target: THREE.Vector3,
  iterations: number
): void {
  const n = points.length;
  const dir = new THREE.Vector3();

  for (let iter = 0; iter < iterations; iter++) {
    points[n - 1].copy(target);
    for (let i = n - 2; i >= 0; i--) {
      dir.subVectors(points[i], points[i + 1]);
      const len = dir.length();
      if (len < 1e-5) {
        dir.set(0, 1, 0);
      } else {
        dir.multiplyScalar(1 / len);
      }
      points[i].copy(points[i + 1]).addScaledVector(dir, lengths[i]);
    }

    points[0].copy(root);
    for (let i = 1; i < n; i++) {
      dir.subVectors(points[i], points[i - 1]);
      const len = dir.length();
      if (len < 1e-5) {
        dir.set(0, -1, 0);
      } else {
        dir.multiplyScalar(1 / len);
      }
      points[i].copy(points[i - 1]).addScaledVector(dir, lengths[i - 1]);
    }
  }
}

function createDynamicTubeGeometry(): {
  geometry: THREE.BufferGeometry;
  posAttr: THREE.BufferAttribute;
  normAttr: THREE.BufferAttribute;
  colAttr: THREE.BufferAttribute;
} {
  const vertCount = CURVE_SAMPLES * RING_SIDES;
  const positions = new Float32Array(vertCount * 3);
  const normals = new Float32Array(vertCount * 3);
  const colors = new Float32Array(vertCount * 3);
  const indices: number[] = [];

  for (let j = 0; j < CURVE_SAMPLES - 1; j++) {
    for (let k = 0; k < RING_SIDES; k++) {
      const k2 = (k + 1) % RING_SIDES;
      const a = j * RING_SIDES + k;
      const b = j * RING_SIDES + k2;
      const c = (j + 1) * RING_SIDES + k2;
      const d = (j + 1) * RING_SIDES + k;
      indices.push(a, b, c, a, c, d);
    }
  }

  const geometry = new THREE.BufferGeometry();
  const posAttr = new THREE.BufferAttribute(positions, 3);
  posAttr.setUsage(THREE.DynamicDrawUsage);
  const normAttr = new THREE.BufferAttribute(normals, 3);
  normAttr.setUsage(THREE.DynamicDrawUsage);
  const colAttr = new THREE.BufferAttribute(colors, 3);
  colAttr.setUsage(THREE.DynamicDrawUsage);

  geometry.setAttribute('position', posAttr);
  geometry.setAttribute('normal', normAttr);
  geometry.setAttribute('color', colAttr);
  geometry.setIndex(indices);
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 80);

  return { geometry, posAttr, normAttr, colAttr };
}

/**
 * Aranha Gigante Procedural de Terror ("Evil Crawling Thing" — escala imponente):
 * - Corpo volumoso elevado (~1.42m no piso) e 8 patas negras longas (~3.65m - 4.17m) arqueadas até quase o teto!
 * - Escala chão, paredes e teto livremente, tece armadilhas de teia e dispara em velocidade absurda ao avistar o jogador.
 * - Ao alcançar o jogador: desfere ataque brutal, arrasta o corpo desacordado até seu Ninho de Teias (ou executa fatalmente se já ferido)!
 */
export class DoomSpider {
  private readonly rootGroup = new THREE.Group();
  private readonly bodyGroup = new THREE.Group();
  private readonly mandibleGroup = new THREE.Group();
  private readonly chitinMat: THREE.ShaderMaterial;

  private readonly limbSpecs: SpiderLimbSpec[] = [];
  private readonly limbs: SpiderLimbRuntime[] = [];

  private readonly bodyPos = new THREE.Vector3();
  private readonly smoothVel = new THREE.Vector3();
  private readonly prevBodyPos = new THREE.Vector3();

  private readonly currentUp = new THREE.Vector3(0, 1, 0);
  private readonly targetUp = new THREE.Vector3(0, 1, 0);
  private readonly currentForward = new THREE.Vector3(0, 0, -1);

  private surfaceMode: SpiderSurfaceMode = 'CEILING';
  private state: SpiderBehaviorState = 'STALK_PATROL';
  private stateTimer = 0;
  private surfaceDecisionTimer = 3.5;
  private webCooldownTimer = 6.0;
  private lostSightTimer = 0;
  private postAbductionGraceTimer = 0;
  private churnYaw = 0;

  private cinematicMode: SpiderCinematicMode | null = null;
  private lastCinematicMode: SpiderCinematicMode | null = null;
  private readonly cinematicVictimPos = new THREE.Vector3();
  private cinematicProgress = 0;

  private pathWaypoints: Array<{ x: number; z: number }> = [];
  private pathRepathTimer = 0;
  private readonly lastKnownPlayerPos = new THREE.Vector3();

  private readonly tmpA = new THREE.Vector3();
  private readonly tmpB = new THREE.Vector3();
  private readonly tmpC = new THREE.Vector3();
  private readonly tmpRight = new THREE.Vector3();

  constructor(
    scene: THREE.Scene,
    sharedUniforms: DoomSharedUniforms,
    private readonly colliders: StaticColliderBox[],
    private readonly webManager: DoomSpiderWebManager,
    private readonly sound: SoundEngine
  ) {
    this.rootGroup.name = 'EvilCrawlingSpider';
    scene.add(this.rootGroup);

    this.chitinMat = createSpiderChitinMaterial(sharedUniforms);

    this.buildBodyCore();
    this.buildProceduralLimbs();

    this.respawnFarFromPlayer();
  }

  get currentState(): SpiderBehaviorState {
    return this.state;
  }

  get isChasingOrAlert(): boolean {
    return (
      this.state === 'ALERT_WINDUP' ||
      this.state === 'FRENZY_CHASE' ||
      this.state === 'CINEMATIC_SEQUENCE'
    );
  }

  get position(): THREE.Vector3 {
    return this.bodyPos;
  }

  respawnFarFromPlayer(): void {
    const startCell = gridCellToWorld(11, 11);
    this.placeAtCell(startCell.x, startCell.z, 'CEILING');
  }

  /**
   * Reposiciona a aranha longe do Ninho após ela deixar o jogador preso na teia!
   */
  relocateAwayAfterAbduction(): void {
    const farNorth = gridCellToWorld(7, 3);
    this.placeAtCell(farNorth.x, farNorth.z, 'CEILING');
    this.postAbductionGraceTimer = 7.5;
  }

  /**
   * Garante que a aranha saia de qualquer estado cinemático caso ainda esteja nele.
   */
  ensureExitedCinematic(): void {
    if (this.state === 'CINEMATIC_SEQUENCE') {
      this.relocateAwayAfterAbduction();
    }
  }

  private placeAtCell(
    wx: number,
    wz: number,
    mode: SpiderSurfaceMode
  ): void {
    this.cinematicMode = null;
    this.lastCinematicMode = null;
    this.surfaceMode = mode;
    const initY = mode === 'CEILING' ? WALL_HEIGHT - 1.08 : 1.42;
    this.bodyPos.set(wx, initY, wz);
    this.prevBodyPos.copy(this.bodyPos);
    this.smoothVel.set(0, 0, 0);
    this.currentUp.set(0, mode === 'CEILING' ? -1 : 1, 0);
    this.targetUp.copy(this.currentUp);
    this.currentForward.set(0, 0, -1);

    this.state = 'STALK_PATROL';
    this.stateTimer = 0;
    this.pathWaypoints = [];

    this.snapAllFeetAroundBody();
    this.updateBodyAndLimbsIK(0.016, 0, this.bodyPos, 0, 20);
  }

  /**
   * Reposiciona imediatamente as 8 patas ao redor da posição e orientação atuais do corpo
   * (evita que patas fiquem esticadas a dezenas de metros após cortes de câmera/teleporte!).
   */
  private snapAllFeetAroundBody(): void {
    const up = this.currentUp;
    const fwd = new THREE.Vector3().copy(this.currentForward);
    fwd.addScaledVector(up, -fwd.dot(up));
    if (fwd.lengthSq() < 1e-5) {
      fwd.set(0, 0, -1);
      fwd.addScaledVector(up, -fwd.dot(up));
    }
    fwd.normalize();
    const right = new THREE.Vector3().crossVectors(fwd, up).normalize();

    for (let i = 0; i < this.limbs.length; i++) {
      const spec = this.limbSpecs[i];
      const rt = this.limbs[i];

      const rootWorld = new THREE.Vector3(
        this.bodyPos.x +
          right.x * spec.rootLocal.x +
          up.x * spec.rootLocal.y -
          fwd.x * spec.rootLocal.z,
        this.bodyPos.y +
          right.y * spec.rootLocal.x +
          up.y * spec.rootLocal.y -
          fwd.y * spec.rootLocal.z,
        this.bodyPos.z +
          right.z * spec.rootLocal.x +
          up.z * spec.rootLocal.y -
          fwd.z * spec.rootLocal.z
      );

      const cosA = Math.cos(spec.angleRad);
      const sinA = Math.sin(spec.angleRad);
      const ringDir = new THREE.Vector3(
        fwd.x * cosA + right.x * sinA,
        fwd.y * cosA + right.y * sinA,
        fwd.z * cosA + right.z * sinA
      ).normalize();

      const reachHoriz = spec.totalLength * spec.spread;
      const restCandidate = new THREE.Vector3(
        this.bodyPos.x + ringDir.x * reachHoriz,
        this.bodyPos.y + ringDir.y * reachHoriz,
        this.bodyPos.z + ringDir.z * reachHoriz
      );

      const { hitPos, isMetalOrCeiling } = this.findSurfaceFootTarget(
        rootWorld,
        restCandidate,
        up,
        spec.totalLength * 0.88
      );

      rt.footWorld.copy(hitPos);
      rt.stepFrom.copy(hitPos);
      rt.targetWorld.copy(hitPos);
      rt.onMetalOrCeiling = isMetalOrCeiling;
      rt.stepping = false;
      rt.stepT = 0;
      rt.raiseThreat = 0;
    }
  }

  alertToWebTrap(trapWorldPos: THREE.Vector3, playerPos: THREE.Vector3): void {
    if (this.state === 'CINEMATIC_SEQUENCE') return;

    this.lastKnownPlayerPos.copy(trapWorldPos);
    this.pathRepathTimer = 0;

    const pan = this.computeStereoPan(playerPos, 0);
    const dist = this.bodyPos.distanceTo(playerPos);
    this.sound.playSpiderScream(pan, dist);

    this.state = 'FRENZY_CHASE';
    this.stateTimer = 0;
    this.lostSightTimer = 0;
  }

  /**
   * Conduz a aranha gigante durante a animação em 1ª pessoa:
   * - STRIKE_ATTACK: Bote violento rasgando diante da câmera
   * - DRAGGING_TO_WEB: Andando de costas enquanto puxa o jogador desacordado pelas 2 patas dianteiras até o ninho!
   * - WEBBING_IN_LAIR: De pé sobre o jogador tecendo fios no Ninho de Teias
   * - FATAL_EXECUTION: Execução final letal (morte permanente)
   */
  updateCinematicSequence(
    dt: number,
    elapsed: number,
    mode: SpiderCinematicMode,
    progress: number,
    spiderWorldPos: THREE.Vector3,
    faceTargetPos: THREE.Vector3,
    victimHookPos: THREE.Vector3
  ): void {
    const modeChanged = this.lastCinematicMode !== mode;
    const jumpedFar =
      this.state !== 'CINEMATIC_SEQUENCE' ||
      spiderWorldPos.distanceTo(this.prevBodyPos) > 1.6;

    this.state = 'CINEMATIC_SEQUENCE';
    this.surfaceMode = 'FLOOR';
    this.cinematicMode = mode;
    this.lastCinematicMode = mode;
    this.cinematicProgress = progress;
    this.cinematicVictimPos.copy(victimHookPos);
    this.churnYaw = 0;

    this.bodyPos.copy(spiderWorldPos);
    // Garante postura 100% ereta no piso (sem singularidade ao vir do teto!)
    this.currentUp.set(0, 1, 0);
    this.targetUp.set(0, 1, 0);

    this.faceHorizontalToward(faceTargetPos.x, faceTargetPos.z, 1.0);

    if (modeChanged || jumpedFar) {
      this.prevBodyPos.copy(this.bodyPos);
      this.smoothVel.set(0, 0, 0);
      this.snapAllFeetAroundBody();
    } else {
      this.tmpA
        .subVectors(this.bodyPos, this.prevBodyPos)
        .multiplyScalar(1 / Math.max(0.0005, dt));
      this.smoothVel.lerp(this.tmpA, Math.min(1, dt * 16));
      this.prevBodyPos.copy(this.bodyPos);
    }

    this.chitinMat.uniforms.uRageGlow.value = 1.0;

    this.updateBodyAndLimbsIK(dt, elapsed, victimHookPos, 0, 1.4);
  }

  /**
   * Constrói o corpo gigante e imponente da Aranha (~1.7x maior, carapaça negra brilhante).
   */
  private buildBodyCore(): void {
    const paintBlackBody = (
      geo: THREE.BufferGeometry,
      r: number,
      g: number,
      b: number
    ) => {
      const count = geo.attributes.position.count;
      const cols = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) {
        cols[i * 3] = r;
        cols[i * 3 + 1] = g;
        cols[i * 3 + 2] = b;
      }
      geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
      return geo;
    };

    // 1. Cefalotórax negro maciço onde convergem as 8 patas gigantes
    const thoraxGeo = paintBlackBody(
      new THREE.IcosahedronGeometry(0.38, 1),
      0.03,
      0.03,
      0.036
    );
    thoraxGeo.scale(0.95, 0.78, 1.36);
    const thorax = new THREE.Mesh(thoraxGeo, this.chitinMat);
    this.bodyGroup.add(thorax);

    // 2. Abdômen negro alongado erguido (crista ameaçadora estilo Evil Crawling Thing)
    const abdomenGeo = paintBlackBody(
      new THREE.ConeGeometry(0.28, 1.18, 7, 3),
      0.024,
      0.024,
      0.03
    );
    abdomenGeo.scale(0.78, 1.02, 1.08);
    const abdomen = new THREE.Mesh(abdomenGeo, this.chitinMat);
    abdomen.rotation.x = -Math.PI * 0.34;
    abdomen.position.set(0, 0.42, 0.48);
    this.bodyGroup.add(abdomen);

    const bellyGeo = paintBlackBody(
      new THREE.SphereGeometry(0.29, 7, 6),
      0.028,
      0.026,
      0.033
    );
    bellyGeo.scale(0.82, 0.88, 1.42);
    const belly = new THREE.Mesh(bellyGeo, this.chitinMat);
    belly.position.set(0, 0.14, 0.34);
    this.bodyGroup.add(belly);

    // 3. Seis quelíceras/presas predatórias inferiores maiores
    for (let i = 0; i < 6; i++) {
      const ang = (i / 6) * Math.PI * 2;
      const fangGeo = paintBlackBody(
        new THREE.ConeGeometry(0.045, 0.39, 5),
        i < 2 ? 0.52 : 0.09,
        i < 2 ? 0.46 : 0.08,
        i < 2 ? 0.4 : 0.08
      );
      const fang = new THREE.Mesh(fangGeo, this.chitinMat);
      fang.position.set(
        Math.cos(ang) * 0.155,
        -0.23,
        -0.28 + Math.sin(ang) * 0.13
      );
      fang.rotation.x = Math.PI + 0.34;
      fang.rotation.z = Math.cos(ang) * 0.3;
      this.mandibleGroup.add(fang);
    }
    this.bodyGroup.add(this.mandibleGroup);

    // 4. Ocelos frontais reluzentes sob luz/lanterna
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xb58d7c });
    const eyeOffsets: Array<[number, number, number, number]> = [
      [-0.095, 0.05, -0.44, 0.026],
      [0.095, 0.05, -0.44, 0.026],
      [-0.16, 0.095, -0.39, 0.019],
      [0.16, 0.095, -0.39, 0.019],
      [-0.052, 0.115, -0.42, 0.016],
      [0.052, 0.115, -0.42, 0.016],
    ];
    for (const [ex, ey, ez, er] of eyeOffsets) {
      const eye = new THREE.Mesh(new THREE.OctahedronGeometry(er, 0), eyeMat);
      eye.position.set(ex, ey, ez);
      this.bodyGroup.add(eye);
    }

    this.rootGroup.add(this.bodyGroup);
  }

  /**
   * Constrói as 8 patas colossais (~3.65m a 4.18m de envergadura cada!) que alcançam
   * simultaneamente piso, paredes e teto dos corredores!
   */
  private buildProceduralLimbs(): void {
    const rand = mulberry32(38187712);
    const baseDegs = [-28, 28, -64, 64, -106, 106, -146, 146];

    for (let i = 0; i < 8; i++) {
      const deg = baseDegs[i] + (rand() - 0.5) * 9;
      const angleRad = (deg * Math.PI) / 180;
      const segments = 4;
      const totalLength = 3.65 + rand() * 0.52;

      const rawSegs = [0.74, 1.28, 1.2, 0.96].map(
        (w) => w * (0.9 + rand() * 0.2)
      );
      const sum = rawSegs.reduce((a, b) => a + b, 0);
      const lengths = rawSegs.map((w) => (w / sum) * totalLength);

      const sideSign = deg < 0 ? -1 : 1;
      const rootLocal = new THREE.Vector3(
        sideSign * (0.19 + rand() * 0.045),
        -0.03 + (rand() - 0.5) * 0.06,
        Math.cos(angleRad) * -0.24
      );

      this.limbSpecs.push({
        index: i,
        rootLocal,
        angleRad,
        spread: 0.48 + rand() * 0.1,
        segments,
        lengths,
        totalLength,
        baseWidth: 0.092 + rand() * 0.02,
        stepDistance: 0.82 + rand() * 0.26,
        stepTime: 0.27 + rand() * 0.08,
        stepHeight: 0.5 + rand() * 0.18,
        phase: rand() * 100,
        freq: 0.8 + rand() * 1.4,
        shade: 0.85 + rand() * 0.3,
        neighbourIndices: [],
      });
    }

    for (let i = 0; i < this.limbSpecs.length; i++) {
      for (let j = 0; j < this.limbSpecs.length; j++) {
        if (i === j) continue;
        let diff = Math.abs(
          this.limbSpecs[i].angleRad - this.limbSpecs[j].angleRad
        );
        if (diff > Math.PI) diff = Math.PI * 2 - diff;
        if (diff < 0.85) {
          this.limbSpecs[i].neighbourIndices.push(j);
        }
      }
    }

    for (let i = 0; i < this.limbSpecs.length; i++) {
      const spec = this.limbSpecs[i];
      const { geometry, posAttr, normAttr, colAttr } =
        createDynamicTubeGeometry();
      const mesh = new THREE.Mesh(geometry, this.chitinMat);
      mesh.frustumCulled = false;
      this.rootGroup.add(mesh);

      const ikPoints: THREE.Vector3[] = [];
      for (let k = 0; k <= spec.segments; k++) {
        ikPoints.push(new THREE.Vector3());
      }
      const curvePoints: THREE.Vector3[] = [];
      for (let s = 0; s < CURVE_SAMPLES; s++) {
        curvePoints.push(new THREE.Vector3());
      }

      this.limbs.push({
        ikPoints,
        curvePoints,
        footWorld: new THREE.Vector3(),
        stepFrom: new THREE.Vector3(),
        targetWorld: new THREE.Vector3(),
        stepping: false,
        stepT: 0,
        onMetalOrCeiling: false,
        raiseThreat: 0,
        twitch: new THREE.Vector3(),
        mesh,
        posAttr,
        normAttr,
        colAttr,
      });
    }
  }

  update(
    dt: number,
    elapsed: number,
    playerPos: THREE.Vector3,
    playerYaw: number,
    playerSprinting: boolean,
    playerCrouching: boolean,
    flashlightOn: boolean,
    flashlightDir: THREE.Vector3,
    activeFlares: readonly ActiveMagnesiumFlare[],
    onCatchPlayer: () => void
  ): {
    cameraShakeAmount: number;
    playerDistance: number;
  } {
    if (this.state === 'CINEMATIC_SEQUENCE') {
      return { cameraShakeAmount: 0, playerDistance: 0 };
    }

    this.stateTimer += dt;
    this.webCooldownTimer = Math.max(0, this.webCooldownTimer - dt);
    this.pathRepathTimer = Math.max(0, this.pathRepathTimer - dt);
    this.postAbductionGraceTimer = Math.max(
      0,
      this.postAbductionGraceTimer - dt
    );

    const distToPlayer = Math.hypot(
      playerPos.x - this.bodyPos.x,
      playerPos.z - this.bodyPos.z
    );
    const stereoPan = this.computeStereoPan(playerPos, playerYaw);

    // 1. Repulsão por Sinalizador de Magnésio aceso no chão!
    if (this.state !== 'FLEE_RETREAT') {
      for (const fl of activeFlares) {
        const dFlare = Math.hypot(
          fl.position.x - this.bodyPos.x,
          fl.position.z - this.bodyPos.z
        );
        if (dFlare < 4.5) {
          this.sound.playSpiderScream(stereoPan, distToPlayer);
          this.state = 'FLEE_RETREAT';
          this.stateTimer = 0;
          this.surfaceMode = 'CEILING';
          this.pickFarRetreatPath(fl.position);
          break;
        }
      }
    }

    // 2. Visão e Audição
    const canSeePlayer =
      this.postAbductionGraceTimer <= 0 &&
      this.detectPlayer(
        playerPos,
        distToPlayer,
        playerSprinting,
        playerCrouching,
        flashlightOn,
        flashlightDir
      );

    if (canSeePlayer) {
      this.lastKnownPlayerPos.copy(playerPos);
      this.lostSightTimer = 0;
    } else {
      this.lostSightTimer += dt;
    }

    let cameraShakeAmount = 0;

    if (this.state === 'FLEE_RETREAT') {
      this.moveAlongPath(dt, 7.6);
      if (this.stateTimer > 5.8) {
        this.state = 'STALK_PATROL';
        this.stateTimer = 0;
        this.pathWaypoints = [];
      }
    } else if (this.state === 'ALERT_WINDUP') {
      this.faceHorizontalToward(playerPos.x, playerPos.z, dt * 10);
      if (this.stateTimer >= 0.42) {
        this.state = 'FRENZY_CHASE';
        this.stateTimer = 0;
        this.pathRepathTimer = 0;
      }
    } else if (this.state === 'FRENZY_CHASE') {
      if (this.pathRepathTimer <= 0) {
        this.pathRepathTimer = 0.3;
        this.buildGridPathTo(
          this.lastKnownPlayerPos.x,
          this.lastKnownPlayerPos.z
        );
      }

      if (distToPlayer < 6.0) {
        this.surfaceMode = 'FLOOR';
      } else if (Math.random() < dt * 0.45) {
        const roll = Math.random();
        this.surfaceMode =
          roll < 0.55 ? 'FLOOR' : roll < 0.8 ? 'CEILING' : 'WALL';
      }

      const chaseSpeed = this.webManager.isPlayerEnsnared ? 10.2 : 9.35;
      if (canSeePlayer && distToPlayer < 5.8) {
        this.moveDirectlyToward(playerPos.x, playerPos.z, dt, chaseSpeed);
      } else {
        this.moveAlongPath(dt, chaseSpeed);
      }

      if (distToPlayer < 10.0) {
        cameraShakeAmount = (1 - distToPlayer / 10.0) * 0.026;
      }

      // Alcançou o jogador -> Inicia Ataque Brutal + Sequestro até a Teia (ou Morte Real)!
      if (distToPlayer < 1.58) {
        onCatchPlayer();
        return {
          cameraShakeAmount: 0.12,
          playerDistance: distToPlayer,
        };
      }

      const giveUpTime = playerCrouching && !flashlightOn ? 5.2 : 7.8;
      if (this.lostSightTimer > giveUpTime) {
        this.state = 'STALK_PATROL';
        this.stateTimer = 0;
        this.surfaceMode = Math.random() < 0.65 ? 'CEILING' : 'WALL';
        this.pathWaypoints = [];
      }
    } else if (this.state === 'SPINNING_WEB') {
      this.surfaceMode = 'FLOOR';
      this.churnYaw += dt * 2.4;
      if (
        Math.floor((this.stateTimer - dt) * 3) !==
        Math.floor(this.stateTimer * 3)
      ) {
        this.sound.playSpiderWebSpin(stereoPan, distToPlayer);
      }

      if (canSeePlayer) {
        this.triggerAlertScream(stereoPan, distToPlayer);
      } else if (this.stateTimer >= 2.3) {
        const { gx, gz } = worldToGridCell(this.bodyPos.x, this.bodyPos.z);
        const cellCenter = gridCellToWorld(gx, gz);
        this.webManager.spawnWebTrap(cellCenter.x, cellCenter.z, false);
        this.webCooldownTimer = 15.0;
        this.state = 'STALK_PATROL';
        this.stateTimer = 0;
        this.surfaceMode = Math.random() < 0.7 ? 'CEILING' : 'WALL';
      }
    } else if (this.state === 'CEILING_AMBUSH') {
      this.surfaceMode = 'CEILING';
      this.churnYaw += dt * 0.25 * Math.sin(elapsed * 0.6);

      if (canSeePlayer) {
        this.triggerAlertScream(stereoPan, distToPlayer);
      } else if (this.stateTimer >= 5.5) {
        this.state = 'STALK_PATROL';
        this.stateTimer = 0;
      }
    } else {
      if (canSeePlayer) {
        this.triggerAlertScream(stereoPan, distToPlayer);
      } else {
        if (this.pathWaypoints.length === 0) {
          this.pickRandomPatrolPath();
        }
        this.moveAlongPath(dt, 1.18);

        this.surfaceDecisionTimer -= dt;
        if (this.surfaceDecisionTimer <= 0) {
          this.surfaceDecisionTimer = 4.0 + Math.random() * 4.5;
          const roll = Math.random();
          if (roll < 0.36) {
            this.surfaceMode = 'CEILING';
          } else if (roll < 0.68) {
            this.surfaceMode = 'WALL';
          } else {
            this.surfaceMode = 'FLOOR';
          }

          if (this.surfaceMode === 'CEILING' && Math.random() < 0.28) {
            this.state = 'CEILING_AMBUSH';
            this.stateTimer = 0;
          } else if (
            this.webCooldownTimer <= 0 &&
            distToPlayer > 7.5 &&
            !this.webManager.hasTrapNear(this.bodyPos.x, this.bodyPos.z, 3.6) &&
            Math.random() < 0.38
          ) {
            this.state = 'SPINNING_WEB';
            this.stateTimer = 0;
          }
        }
      }
    }

    this.updateSurfaceAttachment(dt, elapsed);

    this.tmpA
      .subVectors(this.bodyPos, this.prevBodyPos)
      .multiplyScalar(1 / Math.max(0.0005, dt));
    this.smoothVel.lerp(this.tmpA, Math.min(1, dt * 16));
    this.prevBodyPos.copy(this.bodyPos);

    const targetRage = this.isChasingOrAlert ? 1.0 : 0.0;
    this.chitinMat.uniforms.uRageGlow.value +=
      (targetRage - this.chitinMat.uniforms.uRageGlow.value) *
      Math.min(1, dt * 6);

    this.updateBodyAndLimbsIK(dt, elapsed, playerPos, stereoPan, distToPlayer);

    return {
      cameraShakeAmount,
      playerDistance: distToPlayer,
    };
  }

  private triggerAlertScream(stereoPan: number, distToPlayer: number): void {
    this.sound.playSpiderScream(stereoPan, distToPlayer);
    this.state = 'ALERT_WINDUP';
    this.stateTimer = 0;
  }

  private detectPlayer(
    playerPos: THREE.Vector3,
    dist: number,
    playerSprinting: boolean,
    playerCrouching: boolean,
    flashlightOn: boolean,
    flashlightDir: THREE.Vector3
  ): boolean {
    if (playerSprinting && dist < 9.5) {
      return true;
    }
    if (!playerCrouching && dist < 2.9) {
      return true;
    }

    let sightRange = 15.8;
    if (flashlightOn) {
      sightRange = 21.0;
      const toSpider = this.tmpA
        .subVectors(this.bodyPos, playerPos)
        .normalize();
      if (toSpider.dot(flashlightDir) > 0.86 && dist < 23.5) {
        if (this.hasLineOfSight(this.bodyPos, playerPos)) return true;
      }
    } else if (playerCrouching) {
      sightRange = 5.4;
    }

    if (dist > sightRange) return false;

    const toPrey = this.tmpA
      .set(playerPos.x - this.bodyPos.x, 0, playerPos.z - this.bodyPos.z)
      .normalize();
    const fwdFlat = this.tmpB.set(
      this.currentForward.x,
      0,
      this.currentForward.z
    );
    if (fwdFlat.lengthSq() > 0.01) {
      fwdFlat.normalize();
      if (toPrey.dot(fwdFlat) < -0.42 && dist > 4.2) {
        return false;
      }
    }

    return this.hasLineOfSight(this.bodyPos, playerPos);
  }

  private hasLineOfSight(from: THREE.Vector3, to: THREE.Vector3): boolean {
    const startY = Math.min(2.15, Math.max(0.85, from.y));
    const endY = 1.15;
    const dx = to.x - from.x;
    const dy = endY - startY;
    const dz = to.z - from.z;
    const steps = Math.max(4, Math.ceil(Math.hypot(dx, dz) / 0.55));

    for (let s = 1; s < steps; s++) {
      const f = s / steps;
      const px = from.x + dx * f;
      const py = startY + dy * f;
      const pz = from.z + dz * f;

      for (let c = 0; c < this.colliders.length; c++) {
        const b = this.colliders[c].box;
        if (
          px >= b.min.x &&
          px <= b.max.x &&
          py >= b.min.y &&
          py <= b.max.y &&
          pz >= b.min.z &&
          pz <= b.max.z
        ) {
          return false;
        }
      }
    }
    return true;
  }

  private buildGridPathTo(targetX: number, targetZ: number): void {
    const rows = LABYRINTH_MAP.length;
    const cols = LABYRINTH_MAP[0].length;
    const start = worldToGridCell(this.bodyPos.x, this.bodyPos.z);
    const goal = worldToGridCell(targetX, targetZ);

    const clampG = (v: number, max: number) =>
      Math.max(1, Math.min(max - 2, v));
    const sx = clampG(start.gx, cols);
    const sz = clampG(start.gz, rows);
    const gxGoal = clampG(goal.gx, cols);
    const gzGoal = clampG(goal.gz, rows);

    const total = rows * cols;
    const visited = new Uint8Array(total);
    const parent = new Int16Array(total).fill(-1);
    const queue: number[] = [];

    const startIdx = sz * cols + sx;
    const goalIdx = gzGoal * cols + gxGoal;
    visited[startIdx] = 1;
    queue.push(startIdx);

    const dirs = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ];

    let head = 0;
    let found = false;
    while (head < queue.length) {
      const cur = queue[head++];
      if (cur === goalIdx) {
        found = true;
        break;
      }
      const cx = cur % cols;
      const cz = Math.floor(cur / cols);

      for (const [ox, oz] of dirs) {
        const nx = cx + ox;
        const nz = cz + oz;
        if (isSolidCell(LABYRINTH_MAP, nx, nz)) continue;
        const nIdx = nz * cols + nx;
        if (visited[nIdx]) continue;
        visited[nIdx] = 1;
        parent[nIdx] = cur;
        queue.push(nIdx);
      }
    }

    if (!found) {
      this.pathWaypoints = [{ x: targetX, z: targetZ }];
      return;
    }

    const rev: Array<{ x: number; z: number }> = [];
    let trace = goalIdx;
    while (trace !== -1 && trace !== startIdx) {
      const tx = trace % cols;
      const tz = Math.floor(trace / cols);
      rev.push(gridCellToWorld(tx, tz));
      trace = parent[trace];
    }
    rev.reverse();
    if (rev.length > 0) {
      rev[rev.length - 1] = { x: targetX, z: targetZ };
    } else {
      rev.push({ x: targetX, z: targetZ });
    }
    this.pathWaypoints = rev;
  }

  private pickRandomPatrolPath(): void {
    const candidates: Array<[number, number]> = [];
    for (let gz = 1; gz < LABYRINTH_MAP.length - 1; gz++) {
      for (let gx = 1; gx < LABYRINTH_MAP[gz].length - 1; gx++) {
        if (!isSolidCell(LABYRINTH_MAP, gx, gz)) {
          candidates.push([gx, gz]);
        }
      }
    }
    const [rx, rz] = candidates[Math.floor(Math.random() * candidates.length)];
    const w = gridCellToWorld(rx, rz);
    this.buildGridPathTo(w.x, w.z);
  }

  private pickFarRetreatPath(awayFrom: THREE.Vector3): void {
    let bestWorld = gridCellToWorld(7, 3);
    let bestDist = -1;

    for (let gz = 1; gz < LABYRINTH_MAP.length - 1; gz++) {
      for (let gx = 1; gx < LABYRINTH_MAP[gz].length - 1; gx++) {
        if (isSolidCell(LABYRINTH_MAP, gx, gz)) continue;
        const w = gridCellToWorld(gx, gz);
        const d = Math.hypot(w.x - awayFrom.x, w.z - awayFrom.z);
        if (d > bestDist) {
          bestDist = d;
          bestWorld = w;
        }
      }
    }
    this.buildGridPathTo(bestWorld.x, bestWorld.z);
  }

  private moveAlongPath(dt: number, speed: number): void {
    if (this.pathWaypoints.length === 0) return;
    const wp = this.pathWaypoints[0];
    const dist = Math.hypot(wp.x - this.bodyPos.x, wp.z - this.bodyPos.z);

    if (dist < 0.52) {
      this.pathWaypoints.shift();
      if (this.pathWaypoints.length === 0) return;
    }

    const next = this.pathWaypoints[0];
    this.moveDirectlyToward(next.x, next.z, dt, speed);
  }

  private moveDirectlyToward(
    tx: number,
    tz: number,
    dt: number,
    speed: number
  ): void {
    const dx = tx - this.bodyPos.x;
    const dz = tz - this.bodyPos.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 1e-4) return;

    const nx = dx / dist;
    const nz = dz / dist;

    this.faceHorizontalToward(tx, tz, dt * (speed > 5 ? 11 : 4.5));

    const step = Math.min(dist, speed * dt);
    const nextX = this.bodyPos.x + nx * step;
    const nextZ = this.bodyPos.z + nz * step;

    const bodyRadius = 0.56;
    this.bodyPos.x = nextX;
    this.bodyPos.z = nextZ;

    for (let i = 0; i < this.colliders.length; i++) {
      const b = this.colliders[i].box;
      if (b.max.y < 0.5) continue;
      const cx = Math.max(b.min.x, Math.min(this.bodyPos.x, b.max.x));
      const cz = Math.max(b.min.z, Math.min(this.bodyPos.z, b.max.z));
      const ox = this.bodyPos.x - cx;
      const oz = this.bodyPos.z - cz;
      const dSq = ox * ox + oz * oz;
      if (dSq < bodyRadius * bodyRadius) {
        const d = Math.sqrt(Math.max(1e-6, dSq));
        const push = bodyRadius - d;
        this.bodyPos.x += (ox / d) * push;
        this.bodyPos.z += (oz / d) * push;
      }
    }
  }

  private faceHorizontalToward(tx: number, tz: number, rate: number): void {
    const dx = tx - this.bodyPos.x;
    const dz = tz - this.bodyPos.z;
    const len = Math.hypot(dx, dz);
    if (len < 1e-4) return;
    this.tmpC.set(dx / len, 0, dz / len);
    this.currentForward.lerp(this.tmpC, Math.min(1, rate)).normalize();
  }

  private updateSurfaceAttachment(dt: number, elapsed: number): void {
    const { gx, gz } = worldToGridCell(this.bodyPos.x, this.bodyPos.z);
    const inArch = isArchCell(LABYRINTH_MAP, gx, gz);
    const bob = Math.sin(elapsed * 2.4) * 0.045;

    // Corpo bem mais alto e imponente (~1.42m acima do chão!)
    let desiredY = 1.42 + bob;
    this.targetUp.set(0, 1, 0);

    if (this.surfaceMode === 'CEILING') {
      this.targetUp.set(0, -1, 0);
      desiredY = (inArch ? 1.78 : WALL_HEIGHT - 1.08) + bob;
    } else if (this.surfaceMode === 'WALL') {
      const wallDirs: Array<[number, number, number, number]> = [
        [-1, 0, 1, 0],
        [1, 0, -1, 0],
        [0, -1, 0, 1],
        [0, 1, 0, -1],
      ];

      let foundWall = false;
      const cellWorld = gridCellToWorld(gx, gz);
      for (const [ogx, ogz, nx, nz] of wallDirs) {
        if (isSolidCell(LABYRINTH_MAP, gx + ogx, gz + ogz)) {
          foundWall = true;
          this.targetUp.set(nx * 0.9, 0.28, nz * 0.9).normalize();
          desiredY = 1.72 + Math.sin(elapsed * 1.9) * 0.2;

          const wallTouchX = cellWorld.x + ogx * (CELL_SIZE * 0.5 - 0.88);
          const wallTouchZ = cellWorld.z + ogz * (CELL_SIZE * 0.5 - 0.88);
          if (ogx !== 0) {
            this.bodyPos.x +=
              (wallTouchX - this.bodyPos.x) * Math.min(1, dt * 3.5);
          } else {
            this.bodyPos.z +=
              (wallTouchZ - this.bodyPos.z) * Math.min(1, dt * 3.5);
          }
          break;
        }
      }

      if (!foundWall) {
        this.targetUp.set(0, -1, 0);
        desiredY = WALL_HEIGHT - 1.08 + bob;
      }
    }

    const vertLerp = 1 - Math.exp(-7.5 * dt);
    this.bodyPos.y += (desiredY - this.bodyPos.y) * vertLerp;
    // Evita singularidade antipodal ao descer direto do teto (0,-1,0) para o piso (0,1,0)
    if (this.currentUp.dot(this.targetUp) < -0.75) {
      this.currentUp.x += 0.45;
      this.currentUp.normalize();
    }
    this.currentUp.lerp(this.targetUp, vertLerp).normalize();
  }

  private updateBodyAndLimbsIK(
    dt: number,
    elapsed: number,
    playerPos: THREE.Vector3,
    stereoPan: number,
    distToPlayer: number
  ): void {
    const up = this.currentUp;
    const fwd = this.tmpA.copy(this.currentForward);
    fwd.addScaledVector(up, -fwd.dot(up));
    if (fwd.lengthSq() < 1e-5) {
      fwd.set(0, 0, -1);
      fwd.addScaledVector(up, -fwd.dot(up));
    }
    fwd.normalize();

    const right = this.tmpRight.crossVectors(fwd, up).normalize();

    if (this.churnYaw !== 0) {
      const c = Math.cos(Math.sin(this.churnYaw) * 0.14);
      const s = Math.sin(Math.sin(this.churnYaw) * 0.14);
      const fx = fwd.x * c + right.x * s;
      const fy = fwd.y * c + right.y * s;
      const fz = fwd.z * c + right.z * s;
      fwd.set(fx, fy, fz).normalize();
      right.crossVectors(fwd, up).normalize();
    }

    const basisMat = new THREE.Matrix4().makeBasis(
      right,
      up,
      this.tmpB.copy(fwd).negate()
    );
    this.bodyGroup.position.copy(this.bodyPos);
    this.bodyGroup.quaternion.setFromRotationMatrix(basisMat);

    const agit = this.isChasingOrAlert ? 1.0 : 0.2;
    this.mandibleGroup.rotation.y = Math.sin(elapsed * (6 + agit * 15)) * 0.14;
    this.mandibleGroup.scale.setScalar(
      1 + Math.sin(elapsed * (4 + agit * 14)) * 0.08
    );

    const frantic =
      this.state === 'FRENZY_CHASE' ||
      this.state === 'FLEE_RETREAT' ||
      this.cinematicMode === 'DRAGGING_TO_WEB';
    const maxAirborne = frantic ? 4 : 2;

    let airborneCount = 0;
    for (let i = 0; i < this.limbs.length; i++) {
      if (this.limbs[i].stepping) airborneCount++;
    }

    const lead = this.tmpC.copy(this.smoothVel).multiplyScalar(0.15);
    if (lead.length() > 1.05) lead.setLength(1.05);

    for (let i = 0; i < this.limbs.length; i++) {
      const spec = this.limbSpecs[i];
      const rt = this.limbs[i];

      rt.twitch.multiplyScalar(Math.exp(-dt * 8));
      if (Math.random() < dt * (0.35 + agit * 1.9)) {
        rt.twitch.set(
          (Math.random() - 0.5) * 0.18,
          (Math.random() - 0.5) * 0.18,
          (Math.random() - 0.5) * 0.18
        );
      }

      const rootWorld = new THREE.Vector3(
        this.bodyPos.x +
          right.x * spec.rootLocal.x +
          up.x * spec.rootLocal.y -
          fwd.x * spec.rootLocal.z,
        this.bodyPos.y +
          right.y * spec.rootLocal.x +
          up.y * spec.rootLocal.y -
          fwd.y * spec.rootLocal.z,
        this.bodyPos.z +
          right.z * spec.rootLocal.x +
          up.z * spec.rootLocal.y -
          fwd.z * spec.rootLocal.z
      );

      const cosA = Math.cos(spec.angleRad);
      const sinA = Math.sin(spec.angleRad);
      const ringDir = new THREE.Vector3(
        fwd.x * cosA + right.x * sinA,
        fwd.y * cosA + right.y * sinA,
        fwd.z * cosA + right.z * sinA
      ).normalize();

      const reachHoriz = spec.totalLength * spec.spread;
      const restCandidate = new THREE.Vector3(
        this.bodyPos.x + ringDir.x * reachHoriz + lead.x,
        this.bodyPos.y + ringDir.y * reachHoriz + lead.y,
        this.bodyPos.z + ringDir.z * reachHoriz + lead.z
      );

      const { hitPos, isMetalOrCeiling } = this.findSurfaceFootTarget(
        rootWorld,
        restCandidate,
        up,
        spec.totalLength * 0.94
      );
      rt.targetWorld.copy(hitPos);

      const isFrontPair = i === 0 || i === 1;
      const wantRaise =
        this.state === 'ALERT_WINDUP' && isFrontPair ? 1.0 : 0.0;
      rt.raiseThreat += (wantRaise - rt.raiseThreat) * Math.min(1, dt * 12);

      // Verifica se esta pata está sob pose cinemática especial (Ataque / Arrastando até a Teia!)
      const overriddenFoot = this.computeCinematicLimbFoot(
        i,
        elapsed,
        right,
        fwd
      );

      const activeFoot = new THREE.Vector3();

      if (overriddenFoot) {
        rt.stepping = false;
        rt.footWorld.copy(overriddenFoot);
        activeFoot.copy(overriddenFoot);
      } else {
        // Guarda física absoluta: impede qualquer pata de ficar esticada longe do corpo
        if (rt.footWorld.distanceTo(rootWorld) > spec.totalLength * 1.04) {
          rt.footWorld.copy(rt.targetWorld);
          rt.stepFrom.copy(rt.targetWorld);
          rt.stepping = false;
          rt.stepT = 0;
        }
        if (rt.stepping && rt.stepFrom.distanceTo(rootWorld) > spec.totalLength * 1.08) {
          rt.stepFrom.copy(rt.targetWorld);
        }

        if (rt.stepping) {
          const hurry = frantic ? 0.38 : 1.0;
          rt.stepT += dt / (spec.stepTime * hurry);
          if (rt.stepT >= 1) {
            rt.stepping = false;
            rt.stepT = 0;
            rt.footWorld.copy(rt.targetWorld);
            rt.onMetalOrCeiling = isMetalOrCeiling;
            airborneCount--;

            this.sound.playSpiderFootstep(
              stereoPan,
              distToPlayer,
              frantic,
              rt.onMetalOrCeiling
            );
          }
        } else if (rt.raiseThreat < 0.1) {
          const drift = rt.footWorld.distanceTo(rt.targetWorld);
          const overstretched =
            rt.footWorld.distanceTo(rootWorld) > spec.totalLength * 0.96;
          const neighboursPlanted = spec.neighbourIndices.every(
            (nIdx) => !this.limbs[nIdx].stepping
          );

          const triggerDist = frantic
            ? spec.stepDistance * 0.7
            : spec.stepDistance;

          if (
            overstretched ||
            (drift > triggerDist &&
              airborneCount < maxAirborne &&
              neighboursPlanted)
          ) {
            rt.stepping = true;
            rt.stepT = 0;
            rt.stepFrom.copy(rt.footWorld);
            rt.onMetalOrCeiling = isMetalOrCeiling;
            airborneCount++;
          }
        }

        activeFoot.copy(rt.footWorld);
        if (rt.stepping) {
          const s = smoothStep01(rt.stepT);
          activeFoot.lerpVectors(rt.stepFrom, rt.targetWorld, s);
          const liftScale = frantic ? 0.58 : 1.0;
          activeFoot.addScaledVector(
            up,
            Math.sin(rt.stepT * Math.PI) * spec.stepHeight * liftScale
          );
        }

        if (rt.raiseThreat > 0.01) {
          const threatAim = new THREE.Vector3()
            .subVectors(playerPos, rootWorld)
            .normalize()
            .multiplyScalar(spec.totalLength * 0.6)
            .add(rootWorld)
            .addScaledVector(up, 0.72);
          activeFoot.lerp(threatAim, smoothStep01(rt.raiseThreat));
        }
      }

      // Arco alto imponente das 8 patas gigantes!
      const nJoints = rt.ikPoints.length;
      const bowHeight = spec.totalLength * (frantic ? 0.34 : 0.44);
      for (let j = 0; j < nJoints; j++) {
        const f = j / (nJoints - 1);
        const arch = Math.sin(f * Math.PI);
        const wobX =
          Math.sin(elapsed * spec.freq + spec.phase + j * 1.7) * 0.055;
        const wobY =
          Math.cos(elapsed * spec.freq * 1.3 + spec.phase + j) * 0.055;
        const wobZ =
          Math.sin(elapsed * spec.freq * 0.9 + spec.phase * 1.4) * 0.055;

        rt.ikPoints[j]
          .lerpVectors(rootWorld, activeFoot, f)
          .addScaledVector(up, bowHeight * arch)
          .addScaledVector(ringDir, spec.totalLength * 0.11 * arch)
          .add(
            new THREE.Vector3(
              (wobX + rt.twitch.x) * arch,
              (wobY + rt.twitch.y) * arch,
              (wobZ + rt.twitch.z) * arch
            )
          );
      }

      solveFabrikChain(
        rt.ikPoints,
        spec.lengths,
        rootWorld,
        activeFoot,
        IK_ITERATIONS
      );
      this.unclipIntermediateJoints(rt.ikPoints);

      this.rebuildLimbTubeMesh(spec, rt);
    }
  }

  /**
   * Poses dedicadas das patas dianteiras durante:
   * - O Bote Brutal (rasgando na frente da câmera)
   * - O Sequestro / Arrasto até a Teia (2 patas enganchadas no corpo do jogador puxando!)
   * - Colocando o jogador na Teia (tecendo fios sobre o peito dele)
   * - Execução Fatal (Morte Permanente)
   */
  private computeCinematicLimbFoot(
    limbIndex: number,
    elapsed: number,
    right: THREE.Vector3,
    fwd: THREE.Vector3
  ): THREE.Vector3 | null {
    if (this.state !== 'CINEMATIC_SEQUENCE' || !this.cinematicMode) {
      return null;
    }

    const side = limbIndex % 2 === 0 ? -1 : 1;
    const u = this.cinematicProgress;

    if (this.cinematicMode === 'STRIKE_ATTACK' && limbIndex < 4) {
      // As 4 patas dianteiras gigantes golpeiam e fecham ao redor do rosto/tronco do jogador!
      const tierY = limbIndex < 2 ? 1.25 : 0.72;
      const slashSwing = Math.sin(u * Math.PI * 2.4 + limbIndex * 1.2) * 0.42;
      return new THREE.Vector3()
        .copy(this.cinematicVictimPos)
        .addScaledVector(right, side * (0.36 - slashSwing * 0.35))
        .addScaledVector(fwd, -0.22)
        .setY(tierY + Math.cos(elapsed * 22 + limbIndex) * 0.08);
    }

    if (this.cinematicMode === 'DRAGGING_TO_WEB' && limbIndex < 2) {
      // As 2 patas frontais da aranha engancham nas pernas/cintura do jogador e puxam pelo corredor!
      const pullPulse = Math.sin(elapsed * 6.5 + side * 0.5) * 0.08;
      return new THREE.Vector3()
        .copy(this.cinematicVictimPos)
        .addScaledVector(right, side * 0.28)
        .addScaledVector(fwd, -0.55 + pullPulse)
        .setY(0.24 + Math.abs(pullPulse) * 0.5);
    }

    if (this.cinematicMode === 'WEBBING_IN_LAIR' && limbIndex < 4) {
      // No ninho, cada pata frontal permanece do seu lado anatômico tecendo fios sobre o jogador!
      const phase = elapsed * 8.0 + limbIndex * 1.35;
      const lat =
        side *
        (0.38 + (limbIndex >= 2 ? 0.24 : 0) + Math.sin(phase) * 0.14);
      const fore = (limbIndex < 2 ? -0.15 : 0.28) + Math.cos(phase) * 0.22;
      return new THREE.Vector3()
        .copy(this.cinematicVictimPos)
        .addScaledVector(right, lat)
        .addScaledVector(fwd, fore)
        .setY(0.32 + Math.abs(Math.sin(phase * 1.2)) * 0.26);
    }

    if (this.cinematicMode === 'FATAL_EXECUTION' && limbIndex < 4) {
      // Golpe letal cravando as pontas ósseas diretamente para baixo!
      const plunge = Math.min(1, u * 2.2);
      const yStrike = 1.65 * (1 - plunge) + 0.18 * plunge;
      return new THREE.Vector3()
        .copy(this.cinematicVictimPos)
        .addScaledVector(right, side * 0.22 * (1 - plunge * 0.4))
        .setY(yStrike);
    }

    return null;
  }

  private findSurfaceFootTarget(
    root: THREE.Vector3,
    restCandidate: THREE.Vector3,
    up: THREE.Vector3,
    maxReach: number
  ): { hitPos: THREE.Vector3; isMetalOrCeiling: boolean } {
    const hit = new THREE.Vector3().copy(restCandidate);
    let isMetalOrCeiling = restCandidate.z < 4.5;

    if (this.surfaceMode === 'CEILING') {
      hit.y = WALL_HEIGHT - 0.025;
      isMetalOrCeiling = true;
    } else if (this.surfaceMode === 'FLOOR') {
      hit.y = 0.025;
    } else {
      hit.y = Math.max(
        0.08,
        Math.min(WALL_HEIGHT - 0.08, restCandidate.y - up.y * 0.45)
      );
    }

    // Apoia as garras gigantes diretamente nas paredes laterais (respeitando altura Y de arcos!)
    for (let pass = 0; pass < 2; pass++) {
      for (let c = 0; c < this.colliders.length; c++) {
        const b = this.colliders[c].box;
        if (hit.y < b.min.y - 0.06 || hit.y > b.max.y + 0.06) continue;
        if (
          hit.x > b.min.x - 0.08 &&
          hit.x < b.max.x + 0.08 &&
          hit.z > b.min.z - 0.08 &&
          hit.z < b.max.z + 0.08
        ) {
          const dMinX = Math.abs(root.x - b.min.x);
          const dMaxX = Math.abs(root.x - b.max.x);
          const dMinZ = Math.abs(root.z - b.min.z);
          const dMaxZ = Math.abs(root.z - b.max.z);
          const minD = Math.min(dMinX, dMaxX, dMinZ, dMaxZ);

          if (minD === dMinX) hit.x = b.min.x - 0.05;
          else if (minD === dMaxX) hit.x = b.max.x + 0.05;
          else if (minD === dMinZ) hit.z = b.min.z - 0.05;
          else hit.z = b.max.z + 0.05;

          if (pass === 0 && b.min.y <= 0.1) {
            if (this.surfaceMode === 'FLOOR') {
              hit.y = Math.min(
                1.75,
                0.36 + (1.0 - Math.min(1, minD / 1.65)) * 1.15
              );
            } else if (this.surfaceMode === 'CEILING') {
              hit.y = Math.max(
                1.5,
                WALL_HEIGHT - 0.35 - (1.0 - Math.min(1, minD / 1.65)) * 1.1
              );
            }
          }
        }
      }
    }

    const dist = hit.distanceTo(root);
    if (dist > maxReach) {
      hit.sub(root).multiplyScalar(maxReach / dist).add(root);
      hit.y = Math.max(0.02, Math.min(WALL_HEIGHT - 0.02, hit.y));
    }

    return { hitPos: hit, isMetalOrCeiling };
  }

  private unclipIntermediateJoints(pts: THREE.Vector3[]): void {
    for (let i = 1; i < pts.length - 1; i++) {
      const p = pts[i];
      p.y = Math.max(0.06, Math.min(WALL_HEIGHT - 0.06, p.y));

      for (let c = 0; c < this.colliders.length; c++) {
        const b = this.colliders[c].box;
        const pad = 0.08;
        if (p.y < b.min.y - pad || p.y > b.max.y + pad) continue;
        if (
          p.x > b.min.x - pad &&
          p.x < b.max.x + pad &&
          p.z > b.min.z - pad &&
          p.z < b.max.z + pad
        ) {
          const dL = Math.abs(p.x - (b.min.x - pad));
          const dR = Math.abs(b.max.x + pad - p.x);
          const dN = Math.abs(p.z - (b.min.z - pad));
          const dS = Math.abs(p.z - (b.max.z + pad));
          const m = Math.min(dL, dR, dN, dS);
          if (m === dL) p.x = b.min.x - pad;
          else if (m === dR) p.x = b.max.x + pad;
          else if (m === dN) p.z = b.min.z - pad;
          else p.z = b.max.z + pad;
        }
      }
    }
  }

  private rebuildLimbTubeMesh(
    spec: SpiderLimbSpec,
    rt: SpiderLimbRuntime
  ): void {
    const ik = rt.ikPoints;
    const nIk = ik.length;

    for (let s = 0; s < CURVE_SAMPLES; s++) {
      const u = (s / (CURVE_SAMPLES - 1)) * (nIk - 1);
      const seg = Math.min(Math.floor(u), nIk - 2);
      const localT = u - seg;
      const p0 = ik[Math.max(0, seg - 1)];
      const p1 = ik[seg];
      const p2 = ik[seg + 1];
      const p3 = ik[Math.min(nIk - 1, seg + 2)];
      catmullRomVec3(p0, p1, p2, p3, localT, rt.curvePoints[s]);
    }

    const posArr = rt.posAttr.array as Float32Array;
    const normArr = rt.normAttr.array as Float32Array;
    const colArr = rt.colAttr.array as Float32Array;

    let nx = 0;
    let ny = 0;
    let nz = 0;
    let hasFrame = false;

    for (let j = 0; j < CURVE_SAMPLES; j++) {
      const prevP = rt.curvePoints[Math.max(0, j - 1)];
      const nextP = rt.curvePoints[Math.min(CURVE_SAMPLES - 1, j + 1)];
      const curP = rt.curvePoints[j];

      let tx = nextP.x - prevP.x;
      let ty = nextP.y - prevP.y;
      let tz = nextP.z - prevP.z;
      let tl = Math.hypot(tx, ty, tz);
      if (tl < 1e-6) {
        tx = 0;
        ty = -1;
        tz = 0;
        tl = 1;
      } else {
        tx /= tl;
        ty /= tl;
        tz /= tl;
      }

      if (!hasFrame) {
        hasFrame = true;
        if (Math.abs(ty) < 0.9) {
          nx = 0;
          ny = 1;
          nz = 0;
        } else {
          nx = 1;
          ny = 0;
          nz = 0;
        }
      }

      const dot = nx * tx + ny * ty + nz * tz;
      nx -= tx * dot;
      ny -= ty * dot;
      nz -= tz * dot;
      let nl = Math.hypot(nx, ny, nz);
      if (nl < 1e-6) {
        nx = -ty;
        ny = tx;
        nz = 0;
        nl = Math.hypot(nx, ny, nz) || 1;
      }
      nx /= nl;
      ny /= nl;
      nz /= nl;

      const bx = ty * nz - tz * ny;
      const by = tz * nx - tx * nz;
      const bz = tx * ny - ty * nx;

      const f = j / (CURVE_SAMPLES - 1);

      let radius = spec.baseWidth * (1 - 0.91 * Math.pow(f, 1.3));
      for (let k = 1; k < spec.segments; k++) {
        const d = (f - k / spec.segments) / 0.045;
        radius += spec.baseWidth * 0.17 * Math.exp(-d * d);
      }
      radius = Math.max(0.0085, radius);

      const boneBlend = Math.pow(f, 3.2);
      const fleshR = 0.03 * spec.shade;
      const fleshG = 0.03 * spec.shade;
      const fleshB = 0.036 * spec.shade;
      const boneR = 0.64 * spec.shade;
      const boneG = 0.6 * spec.shade;
      const boneB = 0.53 * spec.shade;

      const cr = fleshR + (boneR - fleshR) * boneBlend;
      const cg = fleshG + (boneG - fleshG) * boneBlend;
      const cb = fleshB + (boneB - fleshB) * boneBlend;

      for (let k = 0; k < RING_SIDES; k++) {
        const ang = (k / RING_SIDES) * Math.PI * 2;
        const ca = Math.cos(ang);
        const sa = Math.sin(ang);

        const dx = nx * ca + bx * sa;
        const dy = ny * ca + by * sa;
        const dz = nz * ca + bz * sa;

        const vIdx = (j * RING_SIDES + k) * 3;
        posArr[vIdx] = curP.x + dx * radius;
        posArr[vIdx + 1] = curP.y + dy * radius;
        posArr[vIdx + 2] = curP.z + dz * radius;

        normArr[vIdx] = dx;
        normArr[vIdx + 1] = dy;
        normArr[vIdx + 2] = dz;

        colArr[vIdx] = cr;
        colArr[vIdx + 1] = cg;
        colArr[vIdx + 2] = cb;
      }
    }

    rt.posAttr.needsUpdate = true;
    rt.normAttr.needsUpdate = true;
    rt.colAttr.needsUpdate = true;
  }

  private computeStereoPan(playerPos: THREE.Vector3, playerYaw: number): number {
    const rightX = Math.cos(playerYaw);
    const rightZ = -Math.sin(playerYaw);
    const dx = this.bodyPos.x - playerPos.x;
    const dz = this.bodyPos.z - playerPos.z;
    const len = Math.max(0.001, Math.hypot(dx, dz));
    return Math.max(-0.95, Math.min(0.95, (dx * rightX + dz * rightZ) / len));
  }
}
