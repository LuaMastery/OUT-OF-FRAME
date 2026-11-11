import * as THREE from 'three';
import { planSpiderObstaclePath, SpiderNavigationSpace, spiderColliderBlocks } from './DoomSpiderNavigation';
import { SoundEngine } from '../engine/audio/SoundEngine';
import { StaticColliderBox } from '../engine/physics/SpatialSweep';
import {
  computeSpiderVoiceHearingAlert,
  countLabyrinthWallsBetween,
} from '../multiplayer/ProximityVoiceChat';
import {
  DoomArenaLayout,
  getOrCreateSceneArenaLayout,
  pickRandomWalkableCellFarFrom,
} from './DoomArenaRandomizer';
import {
  CELL_SIZE,
  gridCellToWorld,
  isArchCell,
  isSolidCell,
  LABYRINTH_MAP,
  WALL_HEIGHT,
  worldToGridCell,
} from './DoomMazeBuilder';
import {
  ANNEX_MAX_GRID,
  ANNEX_MIN_GRID,
  isThemedRoomDoorCell,
  isWalkableArenaCell,
} from './DoomRooms';
import {
  createSpiderChitinMaterial,
  createSpiderEyeMaterial,
  DoomSharedUniforms,
} from './DoomShader';
import { DoomSpiderWebManager } from './DoomSpiderWebs';
import { ActiveMagnesiumFlare } from './DoomWorldItems';

/**
 * Presa inteiriça, afilada e fechada, espelhada em direção ao centro da boca.
 * A raiz fica dentro do paturon: ela acompanha a quelícera inteira sem vãos
 * nem segmentos flutuantes, inclusive durante o bote e no teto.
 */
function createSpiderFangGeometry(side: -1 | 1): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-side * 0.005, -0.140, -0.095),
    new THREE.Vector3(-side * 0.014, -0.220, -0.125),
    new THREE.Vector3(-side * 0.040, -0.310, -0.120),
    new THREE.Vector3(-side * 0.068, -0.385, -0.075),
    new THREE.Vector3(-side * 0.075, -0.410, -0.035),
  ], false, 'centripetal');
  const segments = 24;
  const radialSegments = 12;
  const frames = curve.computeFrenetFrames(segments, false);
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const point = new THREE.Vector3();
  const radial = new THREE.Vector3();

  const addColor = (u: number) => {
    const tint = THREE.MathUtils.smoothstep(u, 0.08, 1);
    colors.push(
      THREE.MathUtils.lerp(0.28, 0.76, tint),
      THREE.MathUtils.lerp(0.23, 0.68, tint),
      THREE.MathUtils.lerp(0.20, 0.58, tint)
    );
  };
  for (let i = 0; i < segments; i++) {
    const u = i / segments;
    curve.getPointAt(u, point);
    const radius = 0.038 * Math.pow(1 - u, 1.12);
    for (let j = 0; j < radialSegments; j++) {
      const theta = j * Math.PI * 2 / radialSegments;
      radial.copy(frames.normals[i]).multiplyScalar(Math.cos(theta))
        .addScaledVector(frames.binormals[i], Math.sin(theta));
      positions.push(point.x + radial.x * radius, point.y + radial.y * radius, point.z + radial.z * radius);
      addColor(u);
    }
  }
  const rootIndex = positions.length / 3;
  curve.getPointAt(0, point);
  positions.push(point.x, point.y, point.z);
  addColor(0);
  const tipIndex = positions.length / 3;
  curve.getPointAt(1, point);
  positions.push(point.x, point.y, point.z);
  addColor(1);
  for (let j = 0; j < radialSegments; j++) {
    const next = (j + 1) % radialSegments;
    indices.push(rootIndex, next, j);
    for (let i = 0; i < segments - 1; i++) {
      const a = i * radialSegments + j;
      const b = i * radialSegments + next;
      const c = (i + 1) * radialSegments + j;
      const d = (i + 1) * radialSegments + next;
      indices.push(a, b, c, b, d, c);
    }
    const last = (segments - 1) * radialSegments;
    indices.push(last + j, last + next, tipIndex);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

export type SpiderSurfaceMode = 'FLOOR' | 'WALL' | 'CEILING';

export type SpiderBehaviorState =
  | 'STALK_PATROL'
  | 'CEILING_AMBUSH'
  | 'SPINNING_WEB'
  | 'ALERT_WINDUP'
  | 'FRENZY_CHASE'
  | 'CINEMATIC_SEQUENCE'
  | 'FLEE_RETREAT'
  | 'DEAD';

export type SpiderCinematicMode =
  | 'STRIKE_ATTACK'
  | 'DRAGGING_TO_WEB'
  | 'WEBBING_IN_LAIR'
  | 'FATAL_EXECUTION';

export interface SpiderPlayerCandidate {
  id: string;
  pos: THREE.Vector3;
  yaw: number;
  sprinting: boolean;
  crouching: boolean;
  flashlightOn: boolean;
  flashlightDir: THREE.Vector3;
  voiceLevel?: number;
  ensnared: boolean;
  cocoonLocked?: boolean;
  devourSecondsLeft?: number;
  afk: boolean;
  isLocal: boolean;
}

const RING_SIDES = 10;
const CURVE_SAMPLES = 34;
const IK_ITERATIONS = 4;
const TENTACLE_SIDES = 8;
const TENTACLE_SAMPLES = 26;

interface SpiderTentacleRuntime {
  index: number;
  curvePoints: THREE.Vector3[];
  mesh: THREE.Mesh;
  posAttr: THREE.BufferAttribute;
  normAttr: THREE.BufferAttribute;
  colAttr: THREE.BufferAttribute;
}

/** Ângulos anatômicos canônicos (graus) das 8 coxas ao redor do cefalotórax */
const CANONICAL_LIMB_ANGLES_DEG = [
  -27, 27, -62, 62, -104, 104, -144, 144,
] as const;

interface SpiderLimbSpec {
  index: number;
  /** Âncora do pivô da Coxa no espaço local do `bodyGroup` */
  hipSocketLocal: THREE.Vector3;
  /** Ponto exato de saída do Fêmur a partir do Trocânter no espaço local do `bodyGroup` */
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

/** Duração da queda/carcaça da aranha até liberar a tela de vitória. */
export const SPIDER_DEATH_SECONDS = 3.4;

/** Altura em que o corpo morto repousa, conforme a superfície em que morreu. */
export function deathRestHeightForSurface(mode: SpiderSurfaceMode): number {
  if (mode === 'CEILING') return 0.34;
  if (mode === 'WALL') return 0.24;
  return 0.3;
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

/**
 * Interpola a cadeia IK de podômeros rígidos (Coxa-Fêmur, Patela-Tíbia, Metatarso, Tarso)
 * com articulação de dobradiça controlada nos joelhos — elimina 100% os laços/overshoots
 * de borracha que o Catmull-Rom uniforme causava entre segmentos de comprimentos diferentes!
 */
function sampleArticulatedPodomereChain(
  ik: readonly THREE.Vector3[],
  uNorm: number,
  out: THREE.Vector3
): THREE.Vector3 {
  const nSegs = ik.length - 1;
  const clampedU = Math.max(0, Math.min(1, uNorm));
  const scaled = clampedU * nSegs;
  const seg = Math.min(Math.floor(scaled), nSegs - 1);
  const localT = scaled - seg;

  const pA = ik[seg];
  const pB = ik[seg + 1];
  out.lerpVectors(pA, pB, localT);

  // Chanfro anatômico curvo apenas na zona imediata de cada junta articular (dobradiça de quitina)
  const cornerZone = 0.2;
  if (localT < cornerZone && seg > 0) {
    const pPrev = ik[seg - 1];
    const blend = 1 - localT / cornerZone;
    const w = 0.22 * blend * blend;
    const midPrevX = 0.5 * (pPrev.x + pA.x);
    const midPrevY = 0.5 * (pPrev.y + pA.y);
    const midPrevZ = 0.5 * (pPrev.z + pA.z);
    const midNextX = 0.5 * (pA.x + pB.x);
    const midNextY = 0.5 * (pA.y + pB.y);
    const midNextZ = 0.5 * (pA.z + pB.z);
    out.x += (0.5 * (midPrevX + midNextX) - pA.x) * w;
    out.y += (0.5 * (midPrevY + midNextY) - pA.y) * w;
    out.z += (0.5 * (midPrevZ + midNextZ) - pA.z) * w;
  } else if (localT > 1 - cornerZone && seg < nSegs - 1) {
    const pNext = ik[seg + 2];
    const blend = (localT - (1 - cornerZone)) / cornerZone;
    const w = 0.22 * blend * blend;
    const midCurX = 0.5 * (pA.x + pB.x);
    const midCurY = 0.5 * (pA.y + pB.y);
    const midCurZ = 0.5 * (pA.z + pB.z);
    const midNextX = 0.5 * (pB.x + pNext.x);
    const midNextY = 0.5 * (pB.y + pNext.y);
    const midNextZ = 0.5 * (pB.z + pNext.z);
    out.x += (0.5 * (midCurX + midNextX) - pB.x) * w;
    out.y += (0.5 * (midCurY + midNextY) - pB.y) * w;
    out.z += (0.5 * (midCurZ + midNextZ) - pB.z) * w;
  }

  return out;
}

/**
 * Constrói a carapaça esculpida do Cefalotórax (Prossoma) com fóvea torácica central,
 * sulcos radiais musculares entre os 4 pares de patas e domo cefálico elevado (Caput).
 */
function buildSculptedProsomaGeometry(): THREE.BufferGeometry {
  const geo = new THREE.SphereGeometry(1, 22, 16);
  const pos = geo.attributes.position;
  const count = pos.count;
  const cols = new Float32Array(count * 3);

  for (let i = 0; i < count; i++) {
    const ux = pos.getX(i);
    const uy = pos.getY(i);
    const uz = pos.getZ(i);

    // Base ovalada alongada em Z (-Z = frente da cabeça, +Z = cintura do pedicelo)
    const foreFactor = Math.max(0, -uz);
    const aftFactor = Math.max(0, uz);
    const widthScale = 0.37 * (1.0 - foreFactor * 0.24 - aftFactor * 0.16);
    let x = ux * widthScale;
    let z = uz * 0.53;

    // Achatamento ventral + domo cefálico anterior (caput) + aba marginal blindada
    let y = uy * (uy > 0 ? 0.25 : 0.17);
    if (uy > 0.1) {
      // Caput elevado na metade frontal onde se alojam as glândulas de veneno
      const caputLift =
        Math.exp(-Math.pow((uz + 0.45) / 0.42, 2)) *
        Math.exp(-Math.pow(ux / 0.62, 2)) *
        0.095;
      // Fóvea torácica profunda (depressão dorsal central real das aranhas gigantes!)
      const foveaPit =
        Math.exp(-Math.pow((uz - 0.12) / 0.18, 2)) *
        Math.exp(-Math.pow(ux / 0.19, 2)) *
        0.065;
      // 4 sulcos radiais de cada lado marcando os feixes musculares das 8 patas
      const radialAngle = Math.atan2(Math.abs(ux), -uz + 0.08);
      const furrow =
        uy > 0.22 && Math.abs(ux) > 0.16
          ? Math.sin(radialAngle * 9.5) * 0.016
          : 0;
      y += caputLift - foveaPit + furrow;
    }

    // Borda marginal lateral afiada (carina) sobre a inserção das coxas
    const rimFactor = Math.exp(-Math.pow(uy / 0.24, 2));
    x *= 1.0 + rimFactor * 0.08;

    pos.setXYZ(i, x, y, z);

    // Paleta quitinosa de alto contraste para leitura 3D nítida sob lanterna e lâmpadas
    const dorsal = Math.max(0, uy);
    const crestHighlight =
      Math.max(0, Math.abs(ux) - 0.55) * 0.35 +
      (uz < -0.35 && uy > 0.25 ? 0.18 : 0);
    const shade = 0.062 + dorsal * 0.068 + crestHighlight * 0.16;
    cols[i * 3] = shade * 1.04;
    cols[i * 3 + 1] = shade * 0.98;
    cols[i * 3 + 2] = shade * 1.08;
  }

  geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  geo.computeVertexNormals();
  return geo;
}

/**
 * Constrói o Abdômen (Opistossoma) inteiriço com 6 placas tergitas sobrepostas,
 * marca cardíaca dorsal e opérculos pulmonares ventrais — substitui os antigos Torus
 * abertos que flutuavam soltos para fora do corpo!
 */
function buildSculptedOpisthosomaGeometry(): THREE.BufferGeometry {
  const geo = new THREE.SphereGeometry(1, 24, 18);
  const pos = geo.attributes.position;
  const count = pos.count;
  const cols = new Float32Array(count * 3);

  for (let i = 0; i < count; i++) {
    const ux = pos.getX(i);
    const uy = pos.getY(i);
    const uz = pos.getZ(i);

    // Formato de gota predatória: estreito no pedicelo (uz = -1), bojo médio, afilado nas fiandeiras (uz = +1)
    const u01 = (uz + 1) * 0.5; // 0 na cintura, 1 nas fiandeiras
    const profile =
      0.32 + Math.sin(Math.pow(u01, 0.78) * Math.PI) * 0.74 * (1 - u01 * 0.18);

    // 6 placas tergitas transversais esculpidas diretamente na malha dorsal/lateral
    const tergiteWave = Math.sin(u01 * Math.PI * 12.0);
    const dorsalMask = Math.max(0, uy * 0.75 + 0.25);
    const plateRidge = tergiteWave * 0.026 * dorsalMask;

    // Crista cardíaca longitudinal no centro do dorso
    const cardiacCrest =
      uy > 0.25 && u01 > 0.1 && u01 < 0.72
        ? Math.exp(-Math.pow(ux / 0.22, 2)) * 0.028 * (1 - u01)
        : 0;

    const x = ux * (0.34 * profile + plateRidge * 0.7);
    const y =
      uy * (0.31 * profile) +
      plateRidge +
      cardiacCrest -
      (uy < 0 ? 0.02 : 0);
    const z = u01 * 1.06; // Origem exata (0,0,0) no pedicelo estendendo até z = +1.06!

    pos.setXYZ(i, x, y, z);

    // Sulcos entre tergitos escuros/avermelhados e cristas quitinosas cinza-ósseas sutis
    const ridgeBright = Math.max(0, tergiteWave) * dorsalMask;
    const grooveIchor = Math.max(0, -tergiteWave) * dorsalMask;
    const cardiacTone = cardiacCrest > 0.01 ? 0.09 : 0;

    cols[i * 3] = 0.055 + ridgeBright * 0.095 + grooveIchor * 0.045 + cardiacTone;
    cols[i * 3 + 1] = 0.052 + ridgeBright * 0.085 + cardiacTone * 0.7;
    cols[i * 3 + 2] = 0.062 + ridgeBright * 0.082 + cardiacTone * 0.55;
  }

  geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  geo.computeVertexNormals();
  return geo;
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
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 160);

  return { geometry, posAttr, normAttr, colAttr };
}

function createTentacleTubeGeometry(): {
  geometry: THREE.BufferGeometry;
  posAttr: THREE.BufferAttribute;
  normAttr: THREE.BufferAttribute;
  colAttr: THREE.BufferAttribute;
} {
  const vertCount = TENTACLE_SAMPLES * TENTACLE_SIDES;
  const positions = new Float32Array(vertCount * 3);
  const normals = new Float32Array(vertCount * 3);
  const colors = new Float32Array(vertCount * 3);
  const indices: number[] = [];

  for (let j = 0; j < TENTACLE_SAMPLES - 1; j++) {
    for (let k = 0; k < TENTACLE_SIDES; k++) {
      const k2 = (k + 1) % TENTACLE_SIDES;
      const a = j * TENTACLE_SIDES + k;
      const b = j * TENTACLE_SIDES + k2;
      const c = (j + 1) * TENTACLE_SIDES + k2;
      const d = (j + 1) * TENTACLE_SIDES + k;
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
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 160);

  return { geometry, posAttr, normAttr, colAttr };
}

/**
 * Aranha Gigante Procedural de Terror ("Evil Crawling Thing" — escala imponente):
 * - Corpo volumoso elevado (~1.42m no piso) e 8 patas negras longas (~3.65m - 4.17m) arqueadas até quase o teto!
 * - Escala chão, paredes e teto livremente, tece armadilhas de teia e dispara em velocidade absurda ao avistar o jogador.
 * - Ao alcançar o jogador: desfere ataque brutal, projeta seus 4 tentáculos orgânicos para puxar o Ragdoll desacordado até o Ninho de Teias!
 */

export class DoomSpider {
  private readonly rootGroup = new THREE.Group();
  private readonly tentaclesGroup = new THREE.Group();
  private readonly bodyGroup = new THREE.Group();
  private readonly leftCheliceraPivot = new THREE.Group();
  private readonly rightCheliceraPivot = new THREE.Group();
  private readonly leftPalpPivot = new THREE.Group();
  private readonly rightPalpPivot = new THREE.Group();
  private readonly abdomenPivot = new THREE.Group();
  private readonly leftSpinneretPivot = new THREE.Group();
  private readonly rightSpinneretPivot = new THREE.Group();
  private readonly coxaPivots: THREE.Group[] = [];
  private readonly chitinMat: THREE.ShaderMaterial;
  private readonly eyeMat: THREE.ShaderMaterial;

  private readonly limbSpecs: SpiderLimbSpec[] = [];
  private readonly limbs: SpiderLimbRuntime[] = [];
  private readonly tentacles: SpiderTentacleRuntime[] = [];

  /** Progresso (0→1) da animação de morte; usado para liberar a tela de vitória. */
  private deathTime = 0;
  private deathFootWorld: THREE.Vector3[] = [];
  private deathPlayed = false;
  onDeathAnimationFinished?: () => void;

  private readonly bodyPos = new THREE.Vector3();
  private readonly smoothVel = new THREE.Vector3();
  private readonly prevBodyPos = new THREE.Vector3();

  private readonly currentUp = new THREE.Vector3(0, 1, 0);
  private readonly targetUp = new THREE.Vector3(0, 1, 0);
  private readonly currentForward = new THREE.Vector3(0, 0, -1);

  private surfaceMode: SpiderSurfaceMode = 'CEILING';
  private state: SpiderBehaviorState = 'STALK_PATROL';
  private shotgunHealth = 100;
  private stateTimer = 0;
  private surfaceDecisionTimer = 3.5;
  private webCooldownTimer = 14.0;
  private lostSightTimer = 0;
  private postAbductionGraceTimer = 0;
  private chitterTimer = 2.6;
  private churnYaw = 0;

  private cinematicMode: SpiderCinematicMode | null = null;
  private lastCinematicMode: SpiderCinematicMode | null = null;
  private readonly cinematicVictimPos = new THREE.Vector3();
  private cinematicRagdollHooks:
    | readonly [THREE.Vector3, THREE.Vector3, THREE.Vector3, THREE.Vector3]
    | null = null;
  private cinematicProgress = 0;
  private remoteDrivenCinematic = false;
  private tentacleExtension = 0;

  onWebTrapSpawned?: (x: number, z: number) => void;

  private pathWaypoints: Array<{ x: number; z: number }> = [];
  private pathRepathTimer = 0;
  private readonly lastKnownPlayerPos = new THREE.Vector3();
  private searchingAroundLastKnown = false;

  // Controle físico de escalada lateral em paredes + anti-travamento em cantos
  private readonly climbedWallNormal = new THREE.Vector3();
  private climbedWallFaceCoord = 0;
  private readonly desiredMoveDir = new THREE.Vector3(0, 0, -1);
  private commandedSpeed = 0;
  private stuckTimer = 0;
  private crawlClearanceHeight: number | null = null;
  private lastRemotePacketRef: object | null = null;
  private remotePacketAgeSec = 0;

  private readonly tmpA = new THREE.Vector3();
  private readonly tmpB = new THREE.Vector3();
  private readonly tmpC = new THREE.Vector3();
  private readonly tmpRotAxis = new THREE.Vector3();
  private readonly tmpRight = new THREE.Vector3();
  private readonly tmpInvBodyQuat = new THREE.Quaternion();
  private readonly tmpCoxaDir = new THREE.Vector3();
  private readonly tmpUnitZ = new THREE.Vector3(0, 0, 1);
  private readonly arenaLayout: DoomArenaLayout;

  constructor(
    scene: THREE.Scene,
    sharedUniforms: DoomSharedUniforms,
    private readonly colliders: StaticColliderBox[],
    private readonly webManager: DoomSpiderWebManager,
    private readonly sound: SoundEngine,
    explicitArenaLayout?: DoomArenaLayout
  ) {
    this.arenaLayout = getOrCreateSceneArenaLayout(scene, explicitArenaLayout);
    this.rootGroup.name = 'EvilCrawlingSpider';
    this.tentaclesGroup.name = 'SpiderCaptureTentacles';
    this.tentaclesGroup.visible = false;
    scene.add(this.rootGroup);
    scene.add(this.tentaclesGroup);

    this.chitinMat = createSpiderChitinMaterial(sharedUniforms);
    this.eyeMat = createSpiderEyeMaterial(sharedUniforms);

    this.buildProceduralLimbSpecs();
    this.buildBodyCore();
    this.buildProceduralLimbMeshes();
    this.buildProceduralTentacleMeshes();

    this.respawnFarFromPlayer();
  }

  get isDead(): boolean { return this.state === 'DEAD'; }

  /** During abduction the victim remains attached until the nest, never dropped. */
  applyShotgunDamage(damage: number): boolean {
    if (this.isDead || this.state === 'CINEMATIC_SEQUENCE' || !Number.isFinite(damage) || damage <= 0) return false;
    this.shotgunHealth = Math.max(0, this.shotgunHealth - damage);
    if (this.shotgunHealth <= 0) {
      this.beginDeathAnimation();
    }
    return true;
  }

  /**
   * Inicia a queda da aranha ao ser destruída.
   *
   * A morte é encenada em três tempos: as pernas dobram uma a uma (perdendo a
   * força), o corpo despenca do teto/parede até o chão e o opistossoma desaba,
   * com as quelíceras abrindo devagar. A carcaça continua no mapa, inerte, para
   * quem chegar depois ver que a ameaça foi eliminada.
   */
  private beginDeathAnimation(): void {
    if (this.state === 'DEAD') return;
    this.state = 'DEAD';
    this.deathTime = 0;
    this.deathPlayed = false;
    this.shotgunHealth = 0;
    this.smoothVel.set(0, 0, 0);
    this.commandedSpeed = 0;
    this.cinematicMode = null;
    this.cinematicRagdollHooks = null;
    this.remoteDrivenCinematic = false;
    this.hideCaptureTentacles();
    this.rootGroup.visible = true;
    // Guarda onde cada pata estava no instante da morte para as pernas
    // desabarem a partir da posição real, sem "puxão" visual.
    this.deathFootWorld = this.limbs.map((rt) => rt.footWorld.clone());
    for (const rt of this.limbs) {
      rt.stepping = false;
      rt.stepT = 0;
      rt.raiseThreat = 0;
    }
    this.sound.playSpiderDeath?.();
  }

  /** Grupo raiz do modelo (permite verificar a carcaça depois da morte). */
  get sceneRoot(): THREE.Group {
    return this.rootGroup;
  }

  /** Progresso da queda (0 a 1) para a tela de vitória esperar a cena terminar. */
  get deathProgress(): number {
    return this.state === 'DEAD' ? Math.min(1, this.deathTime / SPIDER_DEATH_SECONDS) : 0;
  }

  get isDeathAnimationComplete(): boolean {
    return this.state === 'DEAD' && this.deathTime >= SPIDER_DEATH_SECONDS;
  }

  /**
   * Desenha a carcaça caindo. Chamado todo quadro enquanto o estado é DEAD; é o
   * único caminho que move o corpo depois da morte (a IA não roda mais).
   */
  private updateDeathAnimation(dt: number, elapsed: number): void {
    this.deathTime = Math.min(SPIDER_DEATH_SECONDS + 1, this.deathTime + dt);
    const u = Math.min(1, this.deathTime / SPIDER_DEATH_SECONDS);

    // 1. Colapso das patas: os joelhos cedem em ordem, da frente para trás.
    const collapse = smoothStep01(Math.min(1, u / 0.62));
    const twitchAmount = Math.max(0, 1 - u * 2.4);
    for (let i = 0; i < this.limbs.length; i++) {
      const rt = this.limbs[i];
      const spec = this.limbSpecs[i];
      const start = this.deathFootWorld[i];
      if (!start) continue;
      // A pata dobra para dentro do corpo, como quem perde a força nas juntas.
      const foldDelay = (i % 4) * 0.08 + (i >= 4 ? 0.12 : 0);
      const local = Math.max(0, Math.min(1, (collapse - foldDelay) / Math.max(0.2, 1 - foldDelay)));
      const target = this.tmpA
        .copy(this.bodyPos)
        .addScaledVector(this.currentUp, 0.06)
        .addScaledVector(
          this.tmpB.copy(start).sub(this.bodyPos).normalize(),
          spec.totalLength * 0.34
        );
      rt.footWorld.lerpVectors(start, target, smoothStep01(local));
      // Tremor final dos tarsos nos primeiros instantes.
      if (twitchAmount > 0.01) {
        rt.footWorld.x += Math.sin(elapsed * 34 + i * 2.1) * 0.025 * twitchAmount;
        rt.footWorld.z += Math.cos(elapsed * 29 + i * 1.7) * 0.025 * twitchAmount;
      }
      rt.targetWorld.copy(rt.footWorld);
    }

    // 2. Queda do corpo até o piso, com quique curto ao tocar o chão.
    const fall = smoothStep01(Math.min(1, u / 0.55));
    const restY = Math.max(0.16, deathRestHeightForSurface(this.surfaceMode));
    const bounce = Math.sin(Math.min(1, Math.max(0, (u - 0.5) / 0.5)) * Math.PI) * 0.045 * (1 - u);
    this.bodyPos.y += (restY - this.bodyPos.y) * fall + bounce * (1 - fall);
    if (this.bodyPos.y < 0.1) this.bodyPos.y = 0.1;

    // 3. Corpo tomba de lado e o abdômen desaba sobre as patas dobradas.
    const roll = smoothStep01(Math.min(1, u / 0.75)) * 1.05;
    this.currentUp.lerp(this.tmpA.set(0, 1, 0), Math.min(1, dt * 3)).normalize();
    this.currentForward.addScaledVector(this.tmpB.set(0, 1, 0), -this.currentForward.y).normalize();

    this.bodyGroup.position.copy(this.bodyPos);
    const basisMat = new THREE.Matrix4().makeBasis(
      this.tmpRight.crossVectors(this.currentForward, this.currentUp).normalize(),
      this.currentUp,
      this.tmpB.copy(this.currentForward).negate()
    );
    this.bodyGroup.quaternion.setFromRotationMatrix(basisMat);
    // Giro de tombo em torno do eixo do corpo.
    this.bodyGroup.rotateZ(roll);
    this.bodyGroup.position.y -= 0.12 * smoothStep01(Math.min(1, u / 0.8));
    this.tmpInvBodyQuat.copy(this.bodyGroup.quaternion).invert();

    // Quelíceras abrem e travam; palpos param de bater; respiração cessa.
    const gape = 0.5 * smoothStep01(Math.min(1, u / 0.35));
    this.leftCheliceraPivot.rotation.set(0.34 * gape, 0.2 * gape, -gape * 0.7);
    this.rightCheliceraPivot.rotation.set(0.34 * gape, -0.2 * gape, gape * 0.7);
    this.leftPalpPivot.rotation.set(-0.16, 0.18, 0.05);
    this.rightPalpPivot.rotation.set(-0.16, -0.18, -0.05);
    this.abdomenPivot.rotation.set(0.06 - 0.1 * u, 0.05 * Math.sin(u * 6), 0.22 * u);
    const limpScale = 1 - 0.06 * u;
    this.abdomenPivot.scale.set(limpScale, limpScale, 1);
    this.leftSpinneretPivot.rotation.set(0, 0.1, 0);
    this.rightSpinneretPivot.rotation.set(0, -0.1, 0);

    // O brilho de raiva morre junto com o bicho.
    this.chitinMat.uniforms.uRageGlow.value = Math.max(0, 0.0);
    this.eyeMat.uniforms.uRageGlow.value = 0;

    // Recalcula as patas a partir das posições já dobradas.
    for (let i = 0; i < this.limbs.length; i++) {
      const spec = this.limbSpecs[i];
      const rt = this.limbs[i];
      const rootWorld = this.tmpA
        .copy(this.bodyPos)
        .addScaledVector(this.tmpRight.crossVectors(this.currentForward, this.currentUp).normalize(), spec.rootLocal.x)
        .addScaledVector(this.currentUp, spec.rootLocal.y)
        .addScaledVector(this.currentForward, -spec.rootLocal.z);
      for (let j = 0; j < rt.ikPoints.length; j++) {
        const f = j / (rt.ikPoints.length - 1);
        rt.ikPoints[j].lerpVectors(rootWorld, rt.footWorld, f);
        rt.ikPoints[j].y += Math.sin(f * Math.PI) * 0.06 * u;
      }
      solveFabrikChain(rt.ikPoints, spec.lengths, rootWorld, rt.footWorld, IK_ITERATIONS);
      this.unclipIntermediateJoints(rt.ikPoints);
      const ringDir = this.tmpC.copy(rt.footWorld).sub(this.bodyPos).setY(0);
      if (ringDir.lengthSq() < 1e-5) ringDir.set(0, 0, 1);
      ringDir.normalize();
      this.rebuildLimbTubeMesh(spec, rt, this.currentUp, ringDir);
    }

    if (!this.deathPlayed && u >= 1) {
      this.deathPlayed = true;
      this.onDeathAnimationFinished?.();
    }
  }

  get currentState(): SpiderBehaviorState {
    return this.state;
  }

  get areCaptureTentaclesVisible(): boolean {
    return this.tentaclesGroup.visible && this.tentacleExtension > 0.02;
  }

  get currentSurfaceMode(): SpiderSurfaceMode {
    return this.surfaceMode;
  }

  get isChasingOrAlert(): boolean {
    return (
      this.state === 'ALERT_WINDUP' ||
      this.state === 'FRENZY_CHASE' ||
      this.state === 'CINEMATIC_SEQUENCE'
    );
  }

  /**
   * Verdadeiro quando o jogador quebrou a linha de visão direta e parou de correr,
   * fazendo a aranha continuar correndo e vasculhando os corredores próximos!
   */
  get isSearchingHiddenPlayer(): boolean {
    return this.state === 'FRENZY_CHASE' && this.searchingAroundLastKnown;
  }

  get position(): THREE.Vector3 {
    return this.bodyPos;
  }

  respawnFarFromPlayer(): void {
    const startCell = gridCellToWorld(
      this.arenaLayout.spiderInitialSpawnCell.gx,
      this.arenaLayout.spiderInitialSpawnCell.gz
    );
    this.placeAtCell(
      startCell.x,
      startCell.z,
      this.arenaLayout.spiderInitialSurfaceMode
    );
  }

  /**
   * Reposiciona a aranha em um ponto aleatório distante do Ninho (e de quaisquer observadores vivos)
   * durante o apagão de inconsciência!
   */
  relocateAwayAfterAbduction(
    avoidWorldPositions?: readonly THREE.Vector3[]
  ): void {
    if (this.isDead) return;
    let bestCell = pickRandomWalkableCellFarFrom(
      this.webManager.lairCenter.x,
      this.webManager.lairCenter.z,
      24.0
    );

    if (avoidWorldPositions && avoidWorldPositions.length > 0) {
      let bestMinDist = -1;
      for (let attempt = 0; attempt < 24; attempt++) {
        const cand = pickRandomWalkableCellFarFrom(
          this.webManager.lairCenter.x,
          this.webManager.lairCenter.z,
          22.0
        );
        const cw = gridCellToWorld(cand.gx, cand.gz);
        let minObsDist = Infinity;
        for (const obs of avoidWorldPositions) {
          const d = Math.hypot(cw.x - obs.x, cw.z - obs.z);
          if (d < minObsDist) minObsDist = d;
        }
        if (minObsDist > bestMinDist) {
          bestMinDist = minObsDist;
          bestCell = cand;
          if (minObsDist >= 22.0) break;
        }
      }
    }

    const farWorld = gridCellToWorld(bestCell.gx, bestCell.gz);
    const hasWall = this.hasWallForWebAt(farWorld.x, farWorld.z);
    this.hideCaptureTentacles();
    this.placeAtCell(
      farWorld.x,
      farWorld.z,
      hasWall && Math.random() < 0.65 ? 'CEILING' : 'FLOOR'
    );
    this.postAbductionGraceTimer = 7.5;
  }

  /**
   * Finaliza uma abdução/sequestro em Multiplayer sem JAMAIS teletransportar a Aranha
   * na frente de aliados vivos que estejam observando ou próximos!
   */
  finishAbductionRetreat(
    observerPositions?: readonly THREE.Vector3[]
  ): void {
    if (this.isDead) return;
    this.cinematicMode = null;
    this.lastCinematicMode = null;
    this.cinematicRagdollHooks = null;
    this.remoteDrivenCinematic = false;
    this.searchingAroundLastKnown = false;
    this.hideCaptureTentacles();

    const hasNearbyOrWatchingObserver = Boolean(
      observerPositions?.some((obs) => {
        const d = Math.hypot(obs.x - this.bodyPos.x, obs.z - this.bodyPos.z);
        return d < 25.0 || this.hasLineOfSight(this.bodyPos, obs, false);
      })
    );

    if (hasNearbyOrWatchingObserver) {
      // Sai correndo fisicamente pelos corredores a partir da posição atual (ZERO teleporte!)
      this.state = 'FLEE_RETREAT';
      this.stateTimer = 0;
      this.surfaceMode = 'FLOOR';
      this.climbedWallNormal.set(0, 0, 0);
      this.postAbductionGraceTimer = 7.5;
      this.pickFarRetreatPath(this.webManager.lairCenter);
      return;
    }

    this.relocateAwayAfterAbduction(observerPositions);
  }

  /**
   * Snapshot completo do estado da Aranha Gigante (incluindo velocidade e abdução cinemática)
   * para replicação multiplayer em tempo real sem engasgos nem saltos.
   */
  getNetworkSnapshot(victimId: string | null = null): {
    x: number;
    y: number;
    z: number;
    vx: number;
    vy: number;
    vz: number;
    upX: number;
    upY: number;
    upZ: number;
    fwdX: number;
    fwdY: number;
    fwdZ: number;
    state: SpiderBehaviorState;
    shotgunHealth: number;
    surfaceMode: SpiderSurfaceMode;
    cinematicMode: SpiderCinematicMode | null;
    cinematicProgress: number;
    victimId: string | null;
    victimX: number;
    victimY: number;
    victimZ: number;
  } {
    return {
      x: this.bodyPos.x,
      y: this.bodyPos.y,
      z: this.bodyPos.z,
      vx: this.smoothVel.x,
      vy: this.smoothVel.y,
      vz: this.smoothVel.z,
      upX: this.currentUp.x,
      upY: this.currentUp.y,
      upZ: this.currentUp.z,
      fwdX: this.currentForward.x,
      fwdY: this.currentForward.y,
      fwdZ: this.currentForward.z,
      state: this.state,
      shotgunHealth: this.shotgunHealth,
      surfaceMode: this.surfaceMode,
      cinematicMode:
        this.state === 'CINEMATIC_SEQUENCE' ? this.cinematicMode : null,
      cinematicProgress: this.cinematicProgress,
      victimId:
        this.state === 'CINEMATIC_SEQUENCE' ? victimId : null,
      victimX: this.cinematicVictimPos.x,
      victimY: this.cinematicVictimPos.y,
      victimZ: this.cinematicVictimPos.z,
    };
  }

  /**
   * Avalia TODOS os jogadores conectados na sala (visão direta, lanterna, corrida, teia)
   * para escolher dinamicamente quem a Aranha enxerga/ouve ou está prestes a capturar!
   */
  selectBestMultiplayerCandidate(
    candidates: readonly SpiderPlayerCandidate[]
  ): SpiderPlayerCandidate {
    let best = candidates[0];
    let bestScore = Infinity;

    for (const c of candidates) {
      const dist = Math.hypot(
        c.pos.x - this.bodyPos.x,
        c.pos.z - this.bodyPos.z
      );

      // Vítima já presa no Casulo do Ninho em Multiplayer:
      // - Enquanto ainda faltam > 14s para devorar, a Aranha prioriza caçar os amigos livres (dando chance de resgate!).
      // - Nos últimos <= 14s do cronômetro, a fome aperta e a Aranha corre de volta ao Ninho para DEVORAR a vítima!
      if (c.cocoonLocked) {
        const secsLeft = c.devourSecondsLeft ?? 30;
        let score: number;
        if (secsLeft <= 14) {
          score =
            dist < 1.52 && this.hasLineOfSight(this.bodyPos, c.pos, false)
              ? -620 + dist
              : -260 + dist * 0.45;
        } else {
          score = 2600 + dist;
        }
        if (score < bestScore) {
          bestScore = score;
          best = c;
        }
        continue;
      }

      const inCatchReach =
        dist < 1.52 && this.hasLineOfSight(this.bodyPos, c.pos, c.crouching);
      const voiceLvl = c.voiceLevel ?? 0;
      const detected =
        inCatchReach ||
        (this.postAbductionGraceTimer <= 0 &&
          this.detectPlayer(
            c.pos,
            dist,
            c.sprinting,
            c.crouching,
            c.flashlightOn,
            c.flashlightDir,
            voiceLvl
          ));

      // Alvos em alcance imediato de bote (<1.52m com LOS) têm prioridade máxima (-500),
      // seguidos por alvos ativamente vistos/ouvidos (incluindo quem fala alto/grita no microfone!), e por fim não detectados (1000+).
      let score: number;
      if (inCatchReach) {
        score = -500 + dist + (c.afk ? 4 : 0);
      } else if (detected) {
        score =
          dist -
          (c.ensnared ? 2.8 : 0) -
          voiceLvl * 2.5 +
          (c.afk ? 10 : 0);
      } else {
        score = 1000 + dist - (c.ensnared ? 4.0 : 0) + (c.afk ? 14 : 0);
      }

      if (score < bestScore) {
        bestScore = score;
        best = c;
      }
    }

    return best;
  }

  /**
   * Comanda a Aranha a correr faminta de volta ao Ninho Principal para devorar um jogador
   * que permaneceu preso na teia sem ser salvo pelos amigos a tempo!
   */
  commandReturnToDevourVictim(
    lairPos: THREE.Vector3,
    listenerPos?: THREE.Vector3,
    listenerYaw = 0
  ): void {
    if (this.isDead || this.state === 'CINEMATIC_SEQUENCE') return;
    this.postAbductionGraceTimer = 0;
    this.lastKnownPlayerPos.copy(lairPos);
    this.searchingAroundLastKnown = false;
    this.lostSightTimer = 0;
    if (this.state !== 'FRENZY_CHASE' && this.state !== 'ALERT_WINDUP') {
      const audioPos = listenerPos ?? lairPos;
      const pan = this.computeStereoPan(audioPos, listenerYaw);
      const dist = this.bodyPos.distanceTo(audioPos);
      const wallCount =
        dist < 30
          ? countLabyrinthWallsBetween(
              this.bodyPos.x,
              this.bodyPos.z,
              audioPos.x,
              audioPos.z
            )
          : 3;
      this.sound.playSpiderScream(pan, dist, wallCount);
      this.state = 'FRENZY_CHASE';
      this.stateTimer = 0;
      this.pathRepathTimer = 0;
    }
  }

  private hideCaptureTentacles(): void {
    this.tentacleExtension = 0;
    this.tentaclesGroup.visible = false;
  }

  /**
   * Interrompe imediatamente um ataque/arrasto cinemático quando um aliado salva a vítima
   * com Sinalizador de Magnésio ou golpe de Faca, fazendo a Aranha gritar e fugir pelo teto!
   */
  interruptAbductionAndFlee(
    threatPos: THREE.Vector3,
    listenerPos?: THREE.Vector3,
    listenerYaw = 0
  ): void {
    if (this.isDead) return;
    this.hideCaptureTentacles();
    this.cinematicRagdollHooks = null;
    const audioPos = listenerPos ?? threatPos;
    const dist = Math.hypot(
      audioPos.x - this.bodyPos.x,
      audioPos.z - this.bodyPos.z
    );
    const pan = listenerPos ? this.computeStereoPan(listenerPos, listenerYaw) : 0;
    const wallCount =
      dist < 28
        ? countLabyrinthWallsBetween(
            this.bodyPos.x,
            this.bodyPos.z,
            audioPos.x,
            audioPos.z
          )
        : 3;
    if (this.sound.playSpiderPainRecoil) {
      this.sound.playSpiderPainRecoil(pan, dist, wallCount);
    } else {
      this.sound.playSpiderScream?.(pan, dist, wallCount);
    }
    this.cinematicMode = null;
    this.lastCinematicMode = null;
    this.remoteDrivenCinematic = false;
    this.searchingAroundLastKnown = false;
    this.state = 'FLEE_RETREAT';
    this.stateTimer = 0;
    // Se já estava no piso durante bote/arrasto, foge correndo pelo piso antes de escalar parede/teto
    // (evita que as 8 patas saltem 3.3m para o teto instantaneamente num único quadro!)
    if (this.currentUp.y > 0.25) {
      this.surfaceMode = 'FLOOR';
    } else if (this.hasWallForWebAt(this.bodyPos.x, this.bodyPos.z)) {
      this.surfaceMode = 'CEILING';
    } else {
      this.surfaceMode = 'FLOOR';
    }
    this.climbedWallNormal.set(0, 0, 0);
    this.postAbductionGraceTimer = 5.0;
    this.resolveBodyMazeCollision();
    this.pickFarRetreatPath(threatPos);
  }

  /**
   * Aplica suavemente o estado da Aranha recebido pela rede nos clientes conectados,
   * incluindo extrapolação curta de velocidade sem saltos e animação em 3ª pessoa!
   */
  applyRemoteNetworkState(
    dt: number,
    elapsed: number,
    pkt: {
      x: number;
      y: number;
      z: number;
      vx?: number;
      vy?: number;
      vz?: number;
      upX: number;
      upY: number;
      upZ: number;
      fwdX: number;
      fwdY: number;
      fwdZ: number;
      state: string;
      shotgunHealth?: number;
      surfaceMode: 'FLOOR' | 'WALL' | 'CEILING';
      cinematicMode?: SpiderCinematicMode | null;
      cinematicProgress?: number;
      victimId?: string | null;
      victimX?: number;
      victimY?: number;
      victimZ?: number;
    },
    localPlayerPos: THREE.Vector3,
    localPlayerYaw: number,
    onCatchLocalPlayer: () => void
  ): { cameraShakeAmount: number; playerDistance: number } {
    const safeDt = Math.min(0.05, Math.max(0.0005, dt));

    if (typeof pkt.shotgunHealth === 'number' && Number.isFinite(pkt.shotgunHealth)) {
      this.shotgunHealth = Math.max(0, Math.min(100, pkt.shotgunHealth));
    }
    if (pkt.state === 'DEAD') {
      this.shotgunHealth = 0;
      // O host já tocou a morte; os clientes veem a mesma queda da carcaça.
      if (this.state !== 'DEAD') this.beginDeathAnimation();
      this.updateDeathAnimation(safeDt, elapsed);
      return { cameraShakeAmount: 0, playerDistance: 0 };
    }
    if (this.isDead) return { cameraShakeAmount: 0, playerDistance: 0 };
    // Se a própria máquina local está sofrendo a cena em 1ª pessoa, não sobrescreve
    if (this.state === 'CINEMATIC_SEQUENCE' && !this.remoteDrivenCinematic) {
      return { cameraShakeAmount: 0, playerDistance: 0 };
    }

    // Replicação em 3ª pessoa da Aranha atacando/arrastando/tecendo sobre um aliado!
    if (pkt.state === 'CINEMATIC_SEQUENCE' && pkt.cinematicMode) {
      this.remoteDrivenCinematic = true;
      const spiderPos = this.tmpB.set(pkt.x, pkt.y, pkt.z);
      const victimPos = this.tmpC.set(
        pkt.victimX ?? pkt.x,
        pkt.victimY ?? 0.25,
        pkt.victimZ ?? pkt.z
      );
      this.updateCinematicSequence(
        safeDt,
        elapsed,
        pkt.cinematicMode,
        pkt.cinematicProgress ?? 0.5,
        spiderPos,
        victimPos,
        victimPos
      );
      const d = Math.hypot(
        localPlayerPos.x - this.bodyPos.x,
        localPlayerPos.z - this.bodyPos.z
      );
      const shake = d < 9.0 ? (1 - d / 9.0) * 0.022 : 0;
      return { cameraShakeAmount: shake, playerDistance: d };
    }

    if (this.remoteDrivenCinematic) {
      this.remoteDrivenCinematic = false;
      this.cinematicMode = null;
      this.lastCinematicMode = null;
      this.cinematicRagdollHooks = null;
      this.hideCaptureTentacles();
      this.state = (pkt.state as SpiderBehaviorState) || 'STALK_PATROL';
    }

    if (this.lastRemotePacketRef !== pkt) {
      this.lastRemotePacketRef = pkt;
      this.remotePacketAgeSec = 0;
    } else {
      this.remotePacketAgeSec = Math.min(0.18, this.remotePacketAgeSec + safeDt);
    }

    this.surfaceMode = pkt.surfaceMode;
    const blend = 1 - Math.exp(-15 * safeDt);
    const targetPos = this.tmpB.set(
      pkt.x + (pkt.vx ?? 0) * this.remotePacketAgeSec,
      pkt.y + (pkt.vy ?? 0) * this.remotePacketAgeSec * 0.5,
      pkt.z + (pkt.vz ?? 0) * this.remotePacketAgeSec
    );
    const distSqToTarget = this.bodyPos.distanceToSquared(targetPos);
    if (distSqToTarget > 196) {
      // Apenas sincroniza corte longo (>14m, ex.: reconexão ou relocação durante apagão)
      this.bodyPos.set(pkt.x, pkt.y, pkt.z);
      this.prevBodyPos.copy(this.bodyPos);
      this.snapAllFeetAroundBody();
    } else {
      this.bodyPos.lerp(targetPos, blend);
      this.resolveBodyMazeCollision();
    }

    this.targetUp.set(pkt.upX, pkt.upY, pkt.upZ).normalize();
    this.rotateUpToward(this.targetUp, 7.5 * safeDt);
    this.tmpC.set(pkt.fwdX, 0, pkt.fwdZ);
    if (this.tmpC.lengthSq() > 1e-4) {
      this.turnHorizontalToward(
        this.bodyPos.x + pkt.fwdX,
        this.bodyPos.z + pkt.fwdZ,
        9.0 * safeDt
      );
    }

    const prevRemoteState = this.state;
    if (pkt.state !== 'CINEMATIC_SEQUENCE') {
      this.state = pkt.state as SpiderBehaviorState;
    }
    this.crawlClearanceHeight = this.findNearbyCrawlClearance();

    this.tmpA
      .subVectors(this.bodyPos, this.prevBodyPos)
      .multiplyScalar(1 / safeDt);
    this.smoothVel.lerp(this.tmpA, Math.min(1, safeDt * 16));
    this.prevBodyPos.copy(this.bodyPos);

    const distToPlayer = Math.hypot(
      localPlayerPos.x - this.bodyPos.x,
      localPlayerPos.z - this.bodyPos.z
    );
    const stereoPan = this.computeStereoPan(localPlayerPos, localPlayerYaw);
    const wallCount =
      distToPlayer < 28
        ? countLabyrinthWallsBetween(
            this.bodyPos.x,
            this.bodyPos.z,
            localPlayerPos.x,
            localPlayerPos.z
          )
        : 3;

    // Dispara grito/recuo nos clientes conectados quando o estado autoritativo da Aranha muda!
    if (
      (this.state === 'ALERT_WINDUP' || this.state === 'FRENZY_CHASE') &&
      prevRemoteState !== 'ALERT_WINDUP' &&
      prevRemoteState !== 'FRENZY_CHASE'
    ) {
      this.sound.playSpiderScream(stereoPan, distToPlayer, wallCount);
    } else if (
      this.state === 'FLEE_RETREAT' &&
      prevRemoteState !== 'FLEE_RETREAT'
    ) {
      if (this.sound.playSpiderPainRecoil) {
        this.sound.playSpiderPainRecoil(stereoPan, distToPlayer, wallCount);
      } else {
        this.sound.playSpiderScream(stereoPan, distToPlayer, wallCount);
      }
    }

    this.chitterTimer -= safeDt;
    if (this.chitterTimer <= 0) {
      this.chitterTimer = this.isChasingOrAlert
        ? 1.8 + Math.random() * 1.4
        : 2.8 + Math.random() * 2.4;
      if (distToPlayer < 18.0) {
        this.sound.playSpiderChitter?.(
          stereoPan,
          distToPlayer,
          wallCount,
          this.isChasingOrAlert
        );
      }
    }

    const targetRage = this.isChasingOrAlert ? 1.0 : 0.0;
    this.chitinMat.uniforms.uRageGlow.value +=
      (targetRage - this.chitinMat.uniforms.uRageGlow.value) *
      Math.min(1, safeDt * 6);
    this.eyeMat.uniforms.uRageGlow.value =
      this.chitinMat.uniforms.uRageGlow.value;

    this.updateBodyAndLimbsIK(
      safeDt,
      elapsed,
      localPlayerPos,
      stereoPan,
      distToPlayer,
      wallCount
    );

    let cameraShakeAmount = 0;
    if (this.isChasingOrAlert && distToPlayer < 10.0) {
      cameraShakeAmount = (1 - distToPlayer / 10.0) * 0.026;
    }

    if (
      this.state === 'FRENZY_CHASE' &&
      distToPlayer < 1.52 &&
      this.hasLineOfSight(this.bodyPos, localPlayerPos, false)
    ) {
      onCatchLocalPlayer();
      return { cameraShakeAmount: 0.12, playerDistance: distToPlayer };
    }

    return { cameraShakeAmount, playerDistance: distToPlayer };
  }

  /**
   * Conduz a Aranha em 3ª pessoa para representar um aliado remoto sendo atacado/arrastado,
   * marcando `remoteDrivenCinematic = true` para transição suave quando o evento terminar ou for interrompido!
   */
  updateRemoteCinematicSequence(
    dt: number,
    elapsed: number,
    mode: SpiderCinematicMode,
    progress: number,
    spiderWorldPos: THREE.Vector3,
    victimWorldPos: THREE.Vector3,
    ragdollHooks?:
      | readonly [THREE.Vector3, THREE.Vector3, THREE.Vector3, THREE.Vector3]
      | null
  ): void {
    if (this.isDead) return;
    this.remoteDrivenCinematic = true;
    this.updateCinematicSequence(
      dt,
      elapsed,
      mode,
      progress,
      spiderWorldPos,
      victimWorldPos,
      victimWorldPos,
      ragdollHooks
    );
  }

  ensureExitedCinematic(
    observerPositions?: readonly THREE.Vector3[]
  ): void {
    if (this.state === 'CINEMATIC_SEQUENCE') {
      this.finishAbductionRetreat(observerPositions);
    }
  }

  private placeAtCell(
    wx: number,
    wz: number,
    mode: SpiderSurfaceMode
  ): void {
    this.cinematicMode = null;
    this.lastCinematicMode = null;
    this.cinematicRagdollHooks = null;
    this.hideCaptureTentacles();
    this.surfaceMode = mode;
    this.climbedWallNormal.set(0, 0, 0);
    this.climbedWallFaceCoord = 0;
    this.commandedSpeed = 0;
    this.stuckTimer = 0;
    this.crawlClearanceHeight = null;
    const initY = mode === 'CEILING' ? WALL_HEIGHT - 1.08 : 1.42;
    this.bodyPos.set(wx, initY, wz);
    this.prevBodyPos.copy(this.bodyPos);
    this.smoothVel.set(0, 0, 0);
    this.currentUp.set(0, mode === 'CEILING' ? -1 : 1, 0);
    this.targetUp.copy(this.currentUp);
    this.currentForward.set(0, 0, -1);
    this.desiredMoveDir.set(0, 0, -1);

    this.state = 'STALK_PATROL';
    this.stateTimer = 0;
    this.searchingAroundLastKnown = false;
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

  alertToWebTrap(
    trapWorldPos: THREE.Vector3,
    playerPos: THREE.Vector3,
    listenerPos?: THREE.Vector3,
    listenerYaw = 0
  ): void {
    if (this.isDead || this.state === 'CINEMATIC_SEQUENCE') return;

    this.lastKnownPlayerPos.copy(trapWorldPos);
    this.searchingAroundLastKnown = false;
    this.pathRepathTimer = 0;

    const audioPos = listenerPos ?? playerPos;
    const pan = this.computeStereoPan(audioPos, listenerYaw);
    const dist = this.bodyPos.distanceTo(audioPos);
    const wallCount =
      dist < 30
        ? countLabyrinthWallsBetween(
            this.bodyPos.x,
            this.bodyPos.z,
            audioPos.x,
            audioPos.z
          )
        : 3;
    this.sound.playSpiderScream(pan, dist, wallCount);

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
    victimHookPos: THREE.Vector3,
    ragdollHooks?:
      | readonly [THREE.Vector3, THREE.Vector3, THREE.Vector3, THREE.Vector3]
      | null
  ): void {
    if (this.isDead) return;
    const modeChanged = this.lastCinematicMode !== mode;
    const jumpedFar =
      this.state !== 'CINEMATIC_SEQUENCE' ||
      spiderWorldPos.distanceTo(this.prevBodyPos) > 1.6;

    this.state = 'CINEMATIC_SEQUENCE';
    this.surfaceMode = 'FLOOR';
    this.climbedWallNormal.set(0, 0, 0);
    this.commandedSpeed = 0;
    this.stuckTimer = 0;
    this.cinematicMode = mode;
    this.lastCinematicMode = mode;
    this.cinematicProgress = progress;
    this.cinematicVictimPos.copy(victimHookPos);
    this.cinematicRagdollHooks = ragdollHooks ?? null;
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
    this.eyeMat.uniforms.uRageGlow.value = 1.0;

    this.updateBodyAndLimbsIK(dt, elapsed, victimHookPos, 0, 1.4);
  }

  /**
   * Define primeiro as especificações anatômicas exatas das 8 patas para que as
   * 8 cápsulas articulares Coxa-Trocânter no corpo e as 8 cadeias IK compartilhem
   * exatamente a mesma posição e ângulo — sem desvios, buracos nem dobras quebradas!
   */
  private buildProceduralLimbSpecs(): void {
    const rand = mulberry32(38187712);

    for (let i = 0; i < 8; i++) {
      const deg = CANONICAL_LIMB_ANGLES_DEG[i] + (rand() - 0.5) * 4.5;
      const angleRad = (deg * Math.PI) / 180;
      const segments = 4;
      // Patas anteriores (par I) e posteriores (par IV) ligeiramente mais longas como em aranhas caçadoras reais
      const pairIdx = Math.floor(i / 2);
      const pairLenBias =
        pairIdx === 0 ? 0.14 : pairIdx === 3 ? 0.18 : pairIdx === 1 ? 0.04 : -0.04;
      const totalLength = 3.68 + pairLenBias + rand() * 0.36;

      // Proporções aracnídeas reais: Fêmur robusto, Patela+Tíbia longa, Metatarso esguio, Tarso em garra
      const rawSegs = [1.18, 1.24, 0.98, 0.68].map(
        (w) => w * (0.94 + rand() * 0.12)
      );
      const sum = rawSegs.reduce((a, b) => a + b, 0);
      const lengths = rawSegs.map((w) => (w / sum) * totalLength);

      const sinA = Math.sin(angleRad);
      const cosA = Math.cos(angleRad);
      // Borda elíptica real do cefalotórax (-Z = frente da cabeça, +X = direita)
      const hipSocketLocal = new THREE.Vector3(
        sinA * 0.255,
        -0.048,
        -cosA * 0.305
      );
      // A cadeia IK parte de dentro do anel do Trocânter (0.14m adiante da coxa)
      const rootLocal = new THREE.Vector3(
        hipSocketLocal.x + sinA * 0.135,
        hipSocketLocal.y - 0.005,
        hipSocketLocal.z - cosA * 0.135
      );

      this.limbSpecs.push({
        index: i,
        hipSocketLocal,
        rootLocal,
        angleRad,
        spread: 0.49 + rand() * 0.08,
        segments,
        lengths,
        totalLength,
        baseWidth: 0.088 + rand() * 0.016,
        stepDistance: 0.82 + rand() * 0.24,
        stepTime: 0.26 + rand() * 0.07,
        stepHeight: 0.48 + rand() * 0.16,
        phase: rand() * 100,
        freq: 0.85 + rand() * 1.3,
        shade: 0.88 + rand() * 0.24,
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
  }

  /**
   * Constrói a anatomia aracnídea esculpida da Aranha Gigante:
   * - Cefalotórax (Prossoma) com fóvea torácica, sulcos musculares radiais, crista marginal e esterno;
   * - 8 cápsulas articulares Coxa + Trocânter motorizadas (`coxaPivots`) orientadas para cada fêmur;
   * - Pedicelo articulado + Opistossoma (Abdômen) inteiriço com placas tergitas, espinhos dorso-laterais e fiandeiras móveis;
   * - Par de Quelíceras independentes em tesoura (`leftCheliceraPivot`/`rightCheliceraPivot`) com presas curvas em 3 estágios;
   * - Par de Pedipalpos táteis articulados independentes (`leftPalpPivot`/`rightPalpPivot`) sem vãos entre juntas;
   * - Torre ocular blindada com 8 ocelos engastados e brilho Tapetum Lucidum (`eyeMat`).
   */
  private buildBodyCore(): void {
    const paintBody = (
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

    // 1. CEFALOTÓRAX ESCULPIDO (PROSSOMA COM FÓVEA E SULCOS RADIAIS) + ESTERNO VENTRAL
    const prosomaMesh = new THREE.Mesh(
      buildSculptedProsomaGeometry(),
      this.chitinMat
    );
    prosomaMesh.position.set(0, 0.04, -0.02);
    this.bodyGroup.add(prosomaMesh);

    // Cristas quitinosas dorso-cefálicas (par de carenas que convergem do caput à fóvea)
    for (const side of [-1, 1]) {
      const crestGeo = paintBody(
        new THREE.BoxGeometry(0.045, 0.042, 0.36),
        0.18,
        0.165,
        0.155
      );
      const crest = new THREE.Mesh(crestGeo, this.chitinMat);
      crest.position.set(side * 0.095, 0.255, -0.21);
      crest.rotation.y = side * -0.18;
      crest.rotation.x = 0.14;
      this.bodyGroup.add(crest);
    }

    // Placa Esternal Ventral onde convergem as 8 coxas + Lábio/Enditos bucais
    const sternumGeo = paintBody(
      new THREE.CylinderGeometry(0.22, 0.17, 0.09, 8),
      0.055,
      0.05,
      0.058
    );
    sternumGeo.scale(0.92, 1.0, 1.38);
    const sternum = new THREE.Mesh(sternumGeo, this.chitinMat);
    sternum.position.set(0, -0.115, -0.03);
    this.bodyGroup.add(sternum);

    // 8 Cápsulas Articulares Coxa + Trocânter sincronizadas 1:1 com `limbSpecs`!
    // O eixo +Z local de cada `coxaPivot` aponta diretamente para `ikPoints[1]` a cada quadro!
    this.coxaPivots.length = 0;
    for (let i = 0; i < this.limbSpecs.length; i++) {
      const spec = this.limbSpecs[i];
      const coxaPivot = new THREE.Group();
      coxaPivot.position.copy(spec.hipSocketLocal);

      // Membrana artrodial esférica flexível na raiz (veda qualquer ângulo sem vão!)
      const membrane = new THREE.Mesh(
        paintBody(new THREE.SphereGeometry(0.088, 8, 6), 0.14, 0.055, 0.048),
        this.chitinMat
      );
      membrane.position.set(0, 0, 0.015);

      // Podômero da Coxa (alongado no eixo +Z local)
      const coxaPod = new THREE.Mesh(
        paintBody(
          new THREE.CylinderGeometry(0.074, 0.098, 0.2, 8),
          0.082,
          0.076,
          0.088
        ),
        this.chitinMat
      );
      coxaPod.rotation.x = Math.PI * 0.5;
      coxaPod.position.set(0, 0, 0.095);

      // Colar condilar do Trocânter envolvendo exatamente a saída do Fêmur
      const trochanterCollar = new THREE.Mesh(
        paintBody(
          new THREE.TorusGeometry(0.074, 0.021, 6, 10),
          0.24,
          0.215,
          0.19
        ),
        this.chitinMat
      );
      trochanterCollar.position.set(0, 0, 0.185);

      // Esporão dorsal quitinoso da coxa
      const coxaSpur = new THREE.Mesh(
        paintBody(new THREE.ConeGeometry(0.024, 0.095, 5), 0.42, 0.38, 0.33),
        this.chitinMat
      );
      coxaSpur.position.set(0, 0.082, 0.155);
      coxaSpur.rotation.x = 0.35;

      coxaPivot.add(membrane, coxaPod, trochanterCollar, coxaSpur);
      this.coxaPivots.push(coxaPivot);
      this.bodyGroup.add(coxaPivot);
    }

    // 2. PEDICELO ANELADO + ABDÔMEN (OPISTOSSOMA) ARTICULADO COM ESPINHOS DORSO-LATERAIS E FIANDEIRAS
    const pedicel = new THREE.Mesh(
      paintBody(
        new THREE.CylinderGeometry(0.095, 0.115, 0.24, 8),
        0.11,
        0.048,
        0.045
      ),
      this.chitinMat
    );
    pedicel.rotation.x = Math.PI * 0.46;
    pedicel.position.set(0, 0.045, 0.31);
    this.bodyGroup.add(pedicel);

    this.abdomenPivot.position.set(0, 0.065, 0.36);
    this.abdomenPivot.rotation.x = 0.24;

    const opisthosomaMesh = new THREE.Mesh(
      buildSculptedOpisthosomaGeometry(),
      this.chitinMat
    );
    this.abdomenPivot.add(opisthosomaMesh);

    // 4 pares de espinhos osteodérmicos curvos dorso-laterais (perfil predatório agressivo sem atravessar arcos!)
    const spineStations: Array<[number, number, number, number]> = [
      [0.24, 0.16, 0.22, 0.17],
      [0.44, 0.21, 0.26, 0.21],
      [0.64, 0.19, 0.24, 0.19],
      [0.81, 0.13, 0.18, 0.15],
    ];
    for (const [zPos, xSpread, yHeight, len] of spineStations) {
      for (const side of [-1, 1]) {
        const thorn = new THREE.Mesh(
          paintBody(
            new THREE.ConeGeometry(0.028, len, 5),
            0.54,
            0.49,
            0.42
          ),
          this.chitinMat
        );
        thorn.position.set(side * xSpread, yHeight, zPos);
        thorn.rotation.x = -0.58;
        thorn.rotation.z = -side * 0.42;
        this.abdomenPivot.add(thorn);
      }
    }

    // Placas Ventrais dos Pulmões Foliáceos (Book Lungs) sob a base do abdômen
    for (const side of [-1, 1]) {
      const lungPlate = new THREE.Mesh(
        paintBody(new THREE.BoxGeometry(0.13, 0.03, 0.16), 0.19, 0.165, 0.14),
        this.chitinMat
      );
      lungPlate.position.set(side * 0.11, -0.17, 0.26);
      lungPlate.rotation.x = -0.16;
      this.abdomenPivot.add(lungPlate);
    }

    // Par de Fiandeiras Articuladas (2 segmentos cada) na extremidade posterior do abdômen
    const buildSpinneret = (pivot: THREE.Group, side: number) => {
      pivot.position.set(side * 0.075, -0.045, 1.01);
      const basalSeg = new THREE.Mesh(
        paintBody(
          new THREE.CylinderGeometry(0.032, 0.046, 0.13, 6),
          0.14,
          0.125,
          0.12
        ),
        this.chitinMat
      );
      basalSeg.rotation.x = Math.PI * 0.54;
      basalSeg.position.set(0, -0.01, 0.055);

      const apicalCone = new THREE.Mesh(
        paintBody(new THREE.ConeGeometry(0.028, 0.14, 6), 0.42, 0.38, 0.34),
        this.chitinMat
      );
      apicalCone.rotation.x = Math.PI * 0.58;
      apicalCone.position.set(0, -0.025, 0.165);

      pivot.add(basalSeg, apicalCone);
      pivot.rotation.y = side * 0.16;
      this.abdomenPivot.add(pivot);
    };
    buildSpinneret(this.leftSpinneretPivot, -1);
    buildSpinneret(this.rightSpinneretPivot, 1);
    this.bodyGroup.add(this.abdomenPivot);

    // 3. QUELÍCERAS INDEPENDENTES EM TESOURA + PRESAS VENENOSAS CURVAS
    const buildChelicera = (pivot: THREE.Group, side: -1 | 1) => {
      pivot.position.set(side * 0.102, -0.042, -0.415);

      // Paturon basal musculoso (tronco da quelícera)
      const paturon = new THREE.Mesh(
        paintBody(new THREE.SphereGeometry(0.098, 10, 8), 0.088, 0.078, 0.086),
        this.chitinMat
      );
      paturon.name = side < 0 ? 'SpiderLeftChelicera' : 'SpiderRightChelicera';
      paturon.scale.set(0.84, 1.32, 1.12);
      paturon.position.set(0, -0.055, -0.055);

      // Sulco articular vermelho-escuro na dobra da presa
      const fangFold = new THREE.Mesh(
        paintBody(
          new THREE.TorusGeometry(0.048, 0.014, 5, 8),
          0.26,
          0.065,
          0.055
        ),
        this.chitinMat
      );
      fangFold.rotation.x = Math.PI * 0.45;
      fangFold.position.set(-side * 0.008, -0.155, -0.085);

      // Uma única malha curva, com raiz embutida no paturon e ponta orientada
      // para dentro; não há cones ou cilindros soltos entre as articulações.
      const fang = new THREE.Mesh(
        createSpiderFangGeometry(side),
        this.chitinMat
      );
      fang.name = side < 0 ? 'SpiderLeftFang' : 'SpiderRightFang';

      // Dentes internos pequenos, com as bases embutidas na quelícera.
      for (let d = 0; d < 3; d++) {
        const tooth = new THREE.Mesh(
          paintBody(new THREE.ConeGeometry(0.009, 0.045, 5), 0.48, 0.42, 0.36),
          this.chitinMat
        );
        tooth.name = `Spider${side < 0 ? 'Left' : 'Right'}MouthTooth${d}`;
        tooth.position.set(-side * 0.058, -0.085 - d * 0.03, -0.07);
        tooth.rotation.z = side * 1.1;
        pivot.add(tooth);
      }

      pivot.add(paturon, fangFold, fang);
      this.bodyGroup.add(pivot);
    };
    buildChelicera(this.leftCheliceraPivot, -1);
    buildChelicera(this.rightCheliceraPivot, 1);

    // 4. PEDIPALPOS FRONTAIS ARTICULADOS INDEPENDENTES (JUNTAS CONTÍNUAS SEM VÃOS!)
    const buildPedipalp = (pivot: THREE.Group, side: number) => {
      pivot.position.set(side * 0.205, -0.048, -0.365);
      pivot.rotation.y = side * -0.22;

      const p0 = new THREE.Vector3(0, 0, 0);
      const p1 = new THREE.Vector3(side * 0.03, 0.11, -0.2);
      const p2 = new THREE.Vector3(side * 0.01, 0.01, -0.42);
      const p3 = new THREE.Vector3(-side * 0.02, -0.16, -0.5);

      const addSegment = (
        a: THREE.Vector3,
        b: THREE.Vector3,
        rTop: number,
        rBot: number,
        cr: number,
        cg: number,
        cb: number,
        isCone = false
      ) => {
        const dir = new THREE.Vector3().subVectors(b, a);
        const len = dir.length();
        const geo = isCone
          ? paintBody(new THREE.ConeGeometry(rBot, len, 7), cr, cg, cb)
          : paintBody(
              new THREE.CylinderGeometry(rTop, rBot, len, 7),
              cr,
              cg,
              cb
            );
        const m = new THREE.Mesh(geo, this.chitinMat);
        m.position.lerpVectors(a, b, 0.5);
        m.quaternion.setFromUnitVectors(
          new THREE.Vector3(0, 1, 0),
          dir.normalize()
        );
        pivot.add(m);
      };

      const addJointCondyle = (pt: THREE.Vector3, r: number) => {
        const jMesh = new THREE.Mesh(
          paintBody(new THREE.SphereGeometry(r, 7, 6), 0.24, 0.21, 0.185),
          this.chitinMat
        );
        jMesh.position.copy(pt);
        pivot.add(jMesh);
      };

      addJointCondyle(p0, 0.042);
      addSegment(p0, p1, 0.032, 0.04, 0.085, 0.08, 0.092);
      addJointCondyle(p1, 0.038);
      addSegment(p1, p2, 0.026, 0.034, 0.11, 0.1, 0.112);
      addJointCondyle(p2, 0.03);
      addSegment(p2, p3, 0.006, 0.026, 0.62, 0.56, 0.48, true);

      this.bodyGroup.add(pivot);
    };
    buildPedipalp(this.leftPalpPivot, -1);
    buildPedipalp(this.rightPalpPivot, 1);

    // 5. TORRE OCULAR BLINDADA + 8 OCELOS ENGASTADOS COM BRILHO TAPETUM LUCIDUM
    const ocularTurret = new THREE.Mesh(
      paintBody(
        new THREE.CylinderGeometry(0.14, 0.18, 0.095, 8),
        0.095,
        0.088,
        0.1
      ),
      this.chitinMat
    );
    ocularTurret.scale.set(1.15, 0.85, 0.72);
    ocularTurret.position.set(0, 0.145, -0.435);
    ocularTurret.rotation.x = 0.28;
    this.bodyGroup.add(ocularTurret);

    const browCrest = new THREE.Mesh(
      paintBody(new THREE.BoxGeometry(0.3, 0.036, 0.09), 0.22, 0.195, 0.175),
      this.chitinMat
    );
    browCrest.position.set(0, 0.182, -0.455);
    browCrest.rotation.x = 0.18;
    this.bodyGroup.add(browCrest);

    const eyeOffsets: Array<[number, number, number, number, boolean]> = [
      // Fileira anterior: 2 grandes Olhos Medianos Anteriores (AME) + 2 Laterais Anteriores (ALE)
      [-0.052, 0.118, -0.512, 0.032, true],
      [0.052, 0.118, -0.512, 0.032, true],
      [-0.132, 0.124, -0.482, 0.023, false],
      [0.132, 0.124, -0.482, 0.023, false],
      // Fileira posterior superior: 2 Medianos Posteriores (PME) + 2 Laterais Posteriores (PLE)
      [-0.044, 0.168, -0.486, 0.019, false],
      [0.044, 0.168, -0.486, 0.019, false],
      [-0.176, 0.158, -0.428, 0.022, false],
      [0.176, 0.158, -0.428, 0.022, false],
    ];
    for (const [ex, ey, ez, er, primary] of eyeOffsets) {
      // Cálice quitinoso escuro ao redor de cada olho
      const socketRim = new THREE.Mesh(
        paintBody(
          new THREE.TorusGeometry(er * 0.96, er * 0.28, 5, 8),
          0.04,
          0.038,
          0.045
        ),
        this.chitinMat
      );
      socketRim.position.set(ex, ey, ez + er * 0.2);
      socketRim.rotation.y = ex * -1.4;
      this.bodyGroup.add(socketRim);

      const eyeGeo = paintBody(
        new THREE.SphereGeometry(er, 8, 6),
        primary ? 0.78 : 0.56,
        primary ? 0.62 : 0.44,
        primary ? 0.48 : 0.36
      );
      const eye = new THREE.Mesh(eyeGeo, this.eyeMat);
      eye.position.set(ex, ey, ez);
      this.bodyGroup.add(eye);
    }

    this.rootGroup.add(this.bodyGroup);
  }

  /**
   * Constrói as 8 malhas tubulares articuladas dinâmicas (`spiderRoot.children[1..8]`)
   * que alcançam piso, paredes e teto dos corredores.
   */
  private buildProceduralLimbMeshes(): void {
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

  /**
   * Constrói os 4 Tentáculos Orgânicos de Captura e Arrasto (`SpiderCaptureTentacles`)
   * que emergem sob o esterno/quelíceras da Aranha, enrolam-se no Ragdoll desmaiado
   * e o puxam até colocá-lo preso na Teia do Ninho!
   */
  private buildProceduralTentacleMeshes(): void {
    for (let i = 0; i < 4; i++) {
      const { geometry, posAttr, normAttr, colAttr } =
        createTentacleTubeGeometry();
      const mesh = new THREE.Mesh(geometry, this.chitinMat);
      mesh.name = `SpiderTentacle_${i}`;
      mesh.frustumCulled = false;
      this.tentaclesGroup.add(mesh);

      const curvePoints: THREE.Vector3[] = [];
      for (let s = 0; s < TENTACLE_SAMPLES; s++) {
        curvePoints.push(new THREE.Vector3());
      }
      this.tentacles.push({
        index: i,
        curvePoints,
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
    onCatchPlayer: () => void,
    playerVoiceLevel = 0,
    listenerPos?: THREE.Vector3,
    listenerYaw?: number
  ): {
    cameraShakeAmount: number;
    playerDistance: number;
  } {
    if (this.state === 'DEAD') {
      this.updateDeathAnimation(Math.min(0.05, Math.max(0.0005, dt)), elapsed);
      return { cameraShakeAmount: 0, playerDistance: 0 };
    }
    if (this.state === 'CINEMATIC_SEQUENCE') {
      return { cameraShakeAmount: 0, playerDistance: 0 };
    }

    const safeDt = Math.min(0.05, Math.max(0.0005, dt));
    const frameStartX = this.bodyPos.x;
    const frameStartY = this.bodyPos.y;
    const frameStartZ = this.bodyPos.z;

    this.stateTimer += safeDt;
    this.webCooldownTimer = Math.max(0, this.webCooldownTimer - safeDt);
    this.pathRepathTimer = Math.max(0, this.pathRepathTimer - safeDt);
    this.postAbductionGraceTimer = Math.max(
      0,
      this.postAbductionGraceTimer - safeDt
    );

    const distToPlayer = Math.hypot(
      playerPos.x - this.bodyPos.x,
      playerPos.z - this.bodyPos.z
    );
    const audioListenerPos = listenerPos ?? playerPos;
    const audioListenerYaw = listenerYaw ?? playerYaw;
    const distToListener = Math.hypot(
      audioListenerPos.x - this.bodyPos.x,
      audioListenerPos.z - this.bodyPos.z
    );
    const stereoPan = this.computeStereoPan(audioListenerPos, audioListenerYaw);
    const listenerWallCount =
      distToListener < 28
        ? countLabyrinthWallsBetween(
            this.bodyPos.x,
            this.bodyPos.z,
            audioListenerPos.x,
            audioListenerPos.z
          )
        : 3;

    // 1. Repulsão por Sinalizador de Magnésio aceso no chão!
    if (this.state !== 'FLEE_RETREAT') {
      for (const fl of activeFlares) {
        const dFlare = Math.hypot(
          fl.position.x - this.bodyPos.x,
          fl.position.z - this.bodyPos.z
        );
        if (dFlare < 4.5) {
          if (this.sound.playSpiderPainRecoil) {
            this.sound.playSpiderPainRecoil(
              stereoPan,
              distToListener,
              listenerWallCount
            );
          } else {
            this.sound.playSpiderScream(
              stereoPan,
              distToListener,
              listenerWallCount
            );
          }
          this.state = 'FLEE_RETREAT';
          this.stateTimer = 0;
          if (this.hasWallForWebAt(this.bodyPos.x, this.bodyPos.z)) {
            this.surfaceMode = 'CEILING';
          } else {
            this.surfaceMode = 'FLOOR';
          }
          this.pickFarRetreatPath(fl.position);
          break;
        }
      }
    }

    // 2. Visão e Audição (incluindo corrida e gritos/fala alta no microfone!)
    const canSeePlayer =
      this.postAbductionGraceTimer <= 0 &&
      this.detectPlayer(
        playerPos,
        distToPlayer,
        playerSprinting,
        playerCrouching,
        flashlightOn,
        flashlightDir,
        playerVoiceLevel
      );

    if (canSeePlayer) {
      this.lastKnownPlayerPos.copy(playerPos);
      this.lostSightTimer = 0;
      if (this.searchingAroundLastKnown) {
        this.searchingAroundLastKnown = false;
        this.pathRepathTimer = 0;
      }
    } else {
      this.lostSightTimer += safeDt;
    }

    let cameraShakeAmount = 0;
    this.commandedSpeed = 0;
    const prevMoveX = this.bodyPos.x;
    const prevMoveZ = this.bodyPos.z;

    if (this.state === 'FLEE_RETREAT') {
      this.commandedSpeed = 7.2;
      this.moveAlongPath(safeDt, 7.2);
      if (this.stateTimer > 5.8) {
        this.state = 'STALK_PATROL';
        this.stateTimer = 0;
        this.searchingAroundLastKnown = false;
        this.pathWaypoints = [];
      }
    } else if (this.state === 'ALERT_WINDUP') {
      this.surfaceMode = 'FLOOR';
      this.climbedWallNormal.set(0, 0, 0);
      this.turnHorizontalToward(playerPos.x, playerPos.z, safeDt * 8.5);
      if (this.stateTimer >= 0.42) {
        this.state = 'FRENZY_CHASE';
        this.stateTimer = 0;
        this.searchingAroundLastKnown = false;
        this.pathRepathTimer = 0;
      }
    } else if (this.state === 'FRENZY_CHASE') {
      // Durante toda a perseguição permanece firme no chão (ZERO flips aleatórios chão/teto no ar!)
      this.surfaceMode = 'FLOOR';
      this.climbedWallNormal.set(0, 0, 0);

      // Se ainda está vendo/ouvindo o jogador ou indo até o último ponto avistado:
      if (!this.searchingAroundLastKnown) {
        if (this.pathRepathTimer <= 0) {
          this.pathRepathTimer = 0.28;
          this.buildGridPathTo(
            this.lastKnownPlayerPos.x,
            this.lastKnownPlayerPos.z
          );
        }

        const distToLastKnown = Math.hypot(
          this.lastKnownPlayerPos.x - this.bodyPos.x,
          this.lastKnownPlayerPos.z - this.bodyPos.z
        );
        if (
          !canSeePlayer &&
          (distToLastKnown < 1.15 || this.pathWaypoints.length === 0)
        ) {
          // O jogador quebrou a visão direta e se escondeu!
          // A aranha NÃO sabe onde ele parou: ela continua correndo e vasculhando os corredores próximos!
          this.searchingAroundLastKnown = true;
          this.pickSearchPathNear(this.lastKnownPlayerPos);
        }
      } else if (this.pathWaypoints.length === 0) {
        this.pickSearchPathNear(this.lastKnownPlayerPos);
      }

      // Velocidade rápida e ameaçadora, porém um pouco reduzida para dar chance justa de fuga correndo/deslizando!
      const chaseSpeed = this.webManager.isPlayerEnsnared
        ? 8.45
        : this.searchingAroundLastKnown
          ? 7.2
          : 7.75;
      this.commandedSpeed = chaseSpeed;

      // Só avança em linha reta para o jogador se todo o corredor varrido pelo corpo (raio 0.60m) estiver livre de quinas!
      if (
        canSeePlayer &&
        distToPlayer < 5.6 &&
        this.hasClearBodySweep(
          this.bodyPos.x,
          this.bodyPos.z,
          playerPos.x,
          playerPos.z,
          0.6
        )
      ) {
        this.moveDirectlyToward(playerPos.x, playerPos.z, safeDt, chaseSpeed);
      } else {
        this.moveAlongPath(safeDt, chaseSpeed);
      }

      if (distToListener < 10.0) {
        cameraShakeAmount = (1 - distToListener / 10.0) * 0.026;
      }

      // Alcançou o jogador COM linha de visão direta -> Inicia Ataque Brutal (nunca atravessa paredes!)
      if (
        distToPlayer < 1.52 &&
        this.hasLineOfSight(this.bodyPos, playerPos, playerCrouching)
      ) {
        onCatchPlayer();
        return {
          cameraShakeAmount: distToListener < 2.2 ? 0.12 : cameraShakeAmount,
          playerDistance: distToListener,
        };
      }

      const giveUpTime = playerCrouching && !flashlightOn ? 6.0 : 8.2;
      if (this.lostSightTimer > giveUpTime) {
        this.state = 'STALK_PATROL';
        this.stateTimer = 0;
        this.searchingAroundLastKnown = false;
        if (this.hasWallForWebAt(this.bodyPos.x, this.bodyPos.z)) {
          this.surfaceMode = Math.random() < 0.65 ? 'CEILING' : 'WALL';
        } else {
          this.surfaceMode = 'FLOOR';
        }
        this.pathWaypoints = [];
      }
    } else if (this.state === 'SPINNING_WEB') {
      this.surfaceMode = 'FLOOR';
      this.churnYaw += safeDt * 2.4;
      if (
        Math.floor((this.stateTimer - safeDt) * 3) !==
        Math.floor(this.stateTimer * 3)
      ) {
        this.sound.playSpiderWebSpin(
          stereoPan,
          distToListener,
          listenerWallCount
        );
      }

      if (canSeePlayer) {
        this.triggerAlertScream(stereoPan, distToListener, listenerWallCount);
      } else if (this.stateTimer >= 2.3) {
        const walkable = this.findNearestWalkableCell(
          this.bodyPos.x,
          this.bodyPos.z
        );
        const cellCenter = gridCellToWorld(walkable.gx, walkable.gz);
        const spawned = this.webManager.spawnWebTrap(
          cellCenter.x,
          cellCenter.z,
          false
        );
        if (spawned) {
          this.onWebTrapSpawned?.(cellCenter.x, cellCenter.z);
        }
        this.webCooldownTimer = 42.0;
        this.state = 'STALK_PATROL';
        this.stateTimer = 0;
        if (this.hasWallForWebAt(this.bodyPos.x, this.bodyPos.z)) {
          this.surfaceMode = Math.random() < 0.7 ? 'CEILING' : 'WALL';
        } else {
          this.surfaceMode = 'FLOOR';
        }
      }
    } else if (this.state === 'CEILING_AMBUSH') {
      this.surfaceMode = 'CEILING';
      this.churnYaw += safeDt * 0.25 * Math.sin(elapsed * 0.6);

      if (canSeePlayer) {
        this.triggerAlertScream(stereoPan, distToListener, listenerWallCount);
      } else if (this.stateTimer >= 5.5) {
        this.state = 'STALK_PATROL';
        this.stateTimer = 0;
      }
    } else {
      if (canSeePlayer) {
        this.triggerAlertScream(stereoPan, distToListener, listenerWallCount);
      } else {
        if (this.pathWaypoints.length === 0) {
          this.pickRandomPatrolPath();
        }
        this.commandedSpeed = 1.18;
        this.moveAlongPath(safeDt, 1.18);

        this.surfaceDecisionTimer -= safeDt;
        if (this.surfaceDecisionTimer <= 0) {
          this.surfaceDecisionTimer = 4.5 + Math.random() * 4.5;
          const hasClimbWall = this.hasWallForWebAt(
            this.bodyPos.x,
            this.bodyPos.z
          );
          const roll = Math.random();
          if (hasClimbWall && roll < 0.36) {
            this.surfaceMode = 'CEILING';
          } else if (hasClimbWall && roll < 0.68) {
            this.surfaceMode = 'WALL';
          } else {
            this.surfaceMode = 'FLOOR';
          }

          if (this.surfaceMode === 'CEILING' && Math.random() < 0.28) {
            this.state = 'CEILING_AMBUSH';
            this.stateTimer = 0;
          } else if (
            this.webCooldownTimer <= 0 &&
            distToPlayer > 11.0 &&
            hasClimbWall &&
            !this.webManager.hasTrapNear(this.bodyPos.x, this.bodyPos.z, 9.5) &&
            Math.random() < 0.14
          ) {
            this.state = 'SPINNING_WEB';
            this.stateTimer = 0;
          }
        }
      }
    }

    this.updateSurfaceAttachment(safeDt, elapsed);
    this.resolveBodyMazeCollision();

    // Guarda anti-travamento SUAVE (ZERO teletransporte de `bodyPos`!):
    // Se comandada a andar mas presa numa quina, desce para o chão e insere o centro do corredor
    // como próximo waypoint para contornar a quina caminhando continuamente!
    if (this.commandedSpeed > 0.5 && safeDt > 1e-4) {
      const planarMoved = Math.hypot(
        this.bodyPos.x - prevMoveX,
        this.bodyPos.z - prevMoveZ
      );
      if (planarMoved < this.commandedSpeed * safeDt * 0.22) {
        this.stuckTimer += safeDt;
        if (this.stuckTimer > 0.32) {
          this.stuckTimer = 0;
          this.surfaceMode = 'FLOOR';
          this.climbedWallNormal.set(0, 0, 0);
          const walkable = this.findNearestWalkableCell(
            this.bodyPos.x,
            this.bodyPos.z
          );
          const cw = gridCellToWorld(walkable.gx, walkable.gz);
          const distToCenter = Math.hypot(
            cw.x - this.bodyPos.x,
            cw.z - this.bodyPos.z
          );
          if (this.state === 'STALK_PATROL' && this.pathWaypoints.length <= 1) {
            this.pickRandomPatrolPath();
          } else if (this.state === 'FRENZY_CHASE') {
            this.pathRepathTimer = 0;
            this.buildGridPathTo(
              this.lastKnownPlayerPos.x,
              this.lastKnownPlayerPos.z
            );
          }
          if (this.pathWaypoints.length === 0 && distToCenter > 0.18 &&
              this.hasClearBodySweep(this.bodyPos.x, this.bodyPos.z, cw.x, cw.z)) {
            this.pathWaypoints.push({ x: cw.x, z: cw.z });
          }
        }
      } else {
        this.stuckTimer = Math.max(0, this.stuckTimer - safeDt * 3.0);
      }
    } else {
      this.stuckTimer = 0;
    }

    // Guarda física anti-teletransporte absoluta por quadro: garante continuidade C0 estrita de posição!
    const maxPlanarStep = Math.max(0.24, this.commandedSpeed * safeDt * 1.45);
    const frameDx = this.bodyPos.x - frameStartX;
    const frameDz = this.bodyPos.z - frameStartZ;
    const framePlanar = Math.hypot(frameDx, frameDz);
    if (framePlanar > maxPlanarStep && framePlanar > 1e-6) {
      const clampScale = maxPlanarStep / framePlanar;
      this.bodyPos.x = frameStartX + frameDx * clampScale;
      this.bodyPos.z = frameStartZ + frameDz * clampScale;
      this.resolveBodyMazeCollision();
    }
    const maxVertStep = Math.max(0.18, 5.2 * safeDt);
    const frameDy = this.bodyPos.y - frameStartY;
    if (Math.abs(frameDy) > maxVertStep) {
      this.bodyPos.y = frameStartY + Math.sign(frameDy) * maxVertStep;
    }

    this.tmpA
      .subVectors(this.bodyPos, this.prevBodyPos)
      .multiplyScalar(1 / safeDt);
    this.smoothVel.lerp(this.tmpA, Math.min(1, safeDt * 16));
    this.prevBodyPos.copy(this.bodyPos);

    // Estalidos orgânicos de quelíceras/mandíbulas quando a Aranha espreita perto do ouvinte!
    this.chitterTimer -= safeDt;
    if (this.chitterTimer <= 0) {
      this.chitterTimer = this.isChasingOrAlert
        ? 1.8 + Math.random() * 1.4
        : 2.8 + Math.random() * 2.4;
      if (distToListener < 18.0) {
        this.sound.playSpiderChitter?.(
          stereoPan,
          distToListener,
          listenerWallCount,
          this.isChasingOrAlert
        );
      }
    }

    const targetRage = this.isChasingOrAlert ? 1.0 : 0.0;
    this.chitinMat.uniforms.uRageGlow.value +=
      (targetRage - this.chitinMat.uniforms.uRageGlow.value) *
      Math.min(1, safeDt * 6);
    this.eyeMat.uniforms.uRageGlow.value =
      this.chitinMat.uniforms.uRageGlow.value;

    this.updateBodyAndLimbsIK(
      safeDt,
      elapsed,
      playerPos,
      stereoPan,
      distToListener,
      listenerWallCount
    );

    return {
      cameraShakeAmount,
      playerDistance: distToListener,
    };
  }

  private hasWallForWebAt(wx: number, wz: number): boolean {
    const { gx, gz } = worldToGridCell(wx, wz);
    if (isSolidCell(LABYRINTH_MAP, gx, gz)) return false;
    return (
      isSolidCell(LABYRINTH_MAP, gx, gz - 1) ||
      isSolidCell(LABYRINTH_MAP, gx, gz + 1) ||
      isSolidCell(LABYRINTH_MAP, gx - 1, gz) ||
      isSolidCell(LABYRINTH_MAP, gx + 1, gz)
    );
  }

  private triggerAlertScream(
    stereoPan: number,
    distToListener: number,
    wallCount = 0
  ): void {
    this.sound.playSpiderScream(stereoPan, distToListener, wallCount);
    this.state = 'ALERT_WINDUP';
    this.stateTimer = 0;
  }

  private detectPlayer(
    playerPos: THREE.Vector3,
    dist: number,
    playerSprinting: boolean,
    playerCrouching: boolean,
    flashlightOn: boolean,
    flashlightDir: THREE.Vector3,
    playerVoiceLevel = 0
  ): boolean {
    const directLOS = this.hasLineOfSight(
      this.bodyPos,
      playerPos,
      playerCrouching
    );

    // Audição pelo Microfone por Distância (estilo Lethal Company):
    // Sussurros passam despercebidos de longe, mas falar alto ou gritar ecoa pelos corredores e atrai a Aranha!
    if (playerVoiceLevel >= 0.08) {
      const wallCount = directLOS
        ? 0
        : countLabyrinthWallsBetween(
            this.bodyPos.x,
            this.bodyPos.z,
            playerPos.x,
            playerPos.z
          );
      const voiceAlert = computeSpiderVoiceHearingAlert(
        playerVoiceLevel,
        dist,
        wallCount,
        playerCrouching
      );
      if (voiceAlert.heard) {
        return true;
      }
    }

    // Sem linha de visão direta (paredes, esquinas ou colunas entre a aranha e o jogador):
    // Se o jogador parar de correr, calar a voz e se esconder, a aranha NÃO consegue enxergá-lo nem saber onde está!
    if (!directLOS) {
      return playerSprinting && dist < 8.0;
    }

    if (playerSprinting && dist < 16.5) {
      return true;
    }
    if (!playerCrouching && dist < 2.8) {
      return true;
    }

    let sightRange = 15.2;
    if (flashlightOn) {
      sightRange = 20.5;
      const toSpider = this.tmpA
        .subVectors(this.bodyPos, playerPos)
        .normalize();
      if (toSpider.dot(flashlightDir) > 0.86 && dist < 23.0) {
        return true;
      }
    } else if (playerCrouching) {
      sightRange = 4.6;
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
      const dotFwd = toPrey.dot(fwdFlat);
      if (playerCrouching && !flashlightOn) {
        if (dotFwd < 0.22 && dist > 1.65) {
          return false;
        }
      } else if (dotFwd < -0.42 && dist > 3.8) {
        return false;
      }
    }

    return true;
  }

  private hasLineOfSight(
    from: THREE.Vector3,
    to: THREE.Vector3,
    targetCrouching = false
  ): boolean {
    const startY = Math.min(2.15, Math.max(0.85, from.y));
    const endY = targetCrouching ? 0.72 : 1.22;
    const dx = to.x - from.x;
    const dy = endY - startY;
    const dz = to.z - from.z;
    const steps = Math.max(6, Math.ceil(Math.hypot(dx, dz) / 0.28));

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

  /**
   * Encontra sempre a célula caminhável válida mais próxima de `(wx, wz)`,
   * garantindo que o pathfinding jamais inicie ou termine dentro de um bloco sólido `#`.
   */
  private findNearestWalkableCell(
    wx: number,
    wz: number
  ): { gx: number; gz: number } {
    const raw = worldToGridCell(wx, wz);
    const gx0 = Math.max(ANNEX_MIN_GRID, Math.min(ANNEX_MAX_GRID, raw.gx));
    const gz0 = Math.max(ANNEX_MIN_GRID, Math.min(ANNEX_MAX_GRID, raw.gz));
    if (isWalkableArenaCell(gx0, gz0)) {
      return { gx: gx0, gz: gz0 };
    }

    let bestGx = 1;
    let bestGz = 1;
    let bestDistSq = Infinity;
    for (let radius = 1; radius <= 8; radius++) {
      for (let dz = -radius; dz <= radius; dz++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const nx = gx0 + dx;
          const nz = gz0 + dz;
          if (
            nx < ANNEX_MIN_GRID ||
            nx > ANNEX_MAX_GRID ||
            nz < ANNEX_MIN_GRID ||
            nz > ANNEX_MAX_GRID
          ) {
            continue;
          }
          if (!isWalkableArenaCell(nx, nz)) continue;
          const cw = gridCellToWorld(nx, nz);
          const dSq = (cw.x - wx) * (cw.x - wx) + (cw.z - wz) * (cw.z - wz);
          if (dSq < bestDistSq) {
            bestDistSq = dSq;
            bestGx = nx;
            bestGz = nz;
          }
        }
      }
      if (bestDistSq < Infinity) {
        return { gx: bestGx, gz: bestGz };
      }
    }

    return { gx: bestGx, gz: bestGz };
  }

  /**
   * Verifica se o cilindro físico do corpo da Aranha (`radius`) consegue percorrer em linha reta
   * `(fromX, fromZ) -> (toX, toZ)` sem esbarrar em nenhuma quina ou parede sólida.
   */
  private hasClearBodySweep(
    fromX: number,
    fromZ: number,
    toX: number,
    toZ: number,
    radius = 0.58
  ): boolean {
    const dx = toX - fromX;
    const dz = toZ - fromZ;
    const dist = Math.hypot(dx, dz);
    if (dist < 1e-4) return true;

    const steps = Math.max(2, Math.ceil(dist / 0.22));
    for (let s = 1; s <= steps; s++) {
      const f = s / steps;
      const px = fromX + dx * f;
      const pz = fromZ + dz * f;
      for (let i = 0; i < this.colliders.length; i++) {
        const col = this.colliders[i];
        if (!spiderColliderBlocks(col, this.surfaceMode, this.bodyPos.y)) continue;
        const b = col.box;
        const effR = col.isObstacle ? Math.max(radius, 0.48) : Math.max(radius, 0.59);
        const cx = Math.max(b.min.x, Math.min(px, b.max.x));
        const cz = Math.max(b.min.z, Math.min(pz, b.max.z));
        const ox = px - cx;
        const oz = pz - cz;
        if (ox * ox + oz * oz < effR * effR) {
          return false;
        }
      }
    }
    return true;
  }

  private buildGridPathTo(targetX: number, targetZ: number): void {
    const space = new SpiderNavigationSpace(this.colliders, this.surfaceMode, this.bodyPos.y);
    this.pathWaypoints = planSpiderObstaclePath(
      space,
      { x: this.bodyPos.x, z: this.bodyPos.z },
      { x: targetX, z: targetZ }
    );
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

  /**
   * Escolhe um corredor próximo ao último ponto conhecido do jogador para que a aranha
   * continue correndo e procurando ativamente enquanto o jogador permanece escondido fora de visão!
   */
  private pickSearchPathNear(anchorWorld: THREE.Vector3): void {
    const anchorCell = worldToGridCell(anchorWorld.x, anchorWorld.z);
    const curCell = worldToGridCell(this.bodyPos.x, this.bodyPos.z);
    const candidates: Array<[number, number]> = [];

    for (let dz = -8; dz <= 8; dz++) {
      for (let dx = -8; dx <= 8; dx++) {
        const gx = anchorCell.gx + dx;
        const gz = anchorCell.gz + dz;
        if (
          gz < ANNEX_MIN_GRID ||
          gz > ANNEX_MAX_GRID ||
          gx < ANNEX_MIN_GRID ||
          gx > ANNEX_MAX_GRID
        ) {
          continue;
        }
        if (!isWalkableArenaCell(gx, gz)) continue;
        const distFromSpider = Math.abs(gx - curCell.gx) + Math.abs(gz - curCell.gz);
        const distFromAnchor = Math.abs(dx) + Math.abs(dz);
        if (distFromSpider >= 3 && distFromAnchor <= 9) {
          candidates.push([gx, gz]);
        }
      }
    }

    if (candidates.length === 0) {
      this.pickRandomPatrolPath();
      return;
    }

    const [sx, sz] = candidates[Math.floor(Math.random() * candidates.length)];
    const w = gridCellToWorld(sx, sz);
    this.buildGridPathTo(w.x, w.z);
  }

  private pickFarRetreatPath(awayFrom: THREE.Vector3): void {
    const retreatCell = pickRandomWalkableCellFarFrom(
      awayFrom.x,
      awayFrom.z,
      22.0
    );
    const bestWorld = gridCellToWorld(retreatCell.gx, retreatCell.gz);
    this.buildGridPathTo(bestWorld.x, bestWorld.z);
  }

  /**
   * Avalia se existe uma parede LATERAL contínua e segura para escalar na célula atual,
   * sem puxar a aranha contra cantos frontais/traseiros nem prendê-la em curvas de 90°.
   */
  private resolveLateralWallForMovement(
    gx: number,
    gz: number,
    moveDirX: number,
    moveDirZ: number,
    turningCornerSoon: boolean
  ): boolean {
    if (
      turningCornerSoon ||
      gx <= 0 ||
      gx >= LABYRINTH_MAP[0].length - 1 ||
      gz <= 0 ||
      gz >= LABYRINTH_MAP.length - 1 ||
      isArchCell(LABYRINTH_MAP, gx, gz) ||
      isSolidCell(LABYRINTH_MAP, gx, gz)
    ) {
      this.climbedWallNormal.set(0, 0, 0);
      return false;
    }

    const wallDirs: Array<[number, number, number, number]> = [
      [-1, 0, 1, 0],
      [1, 0, -1, 0],
      [0, -1, 0, 1],
      [0, 1, 0, -1],
    ];

    const cellWorld = gridCellToWorld(gx, gz);
    const stepGx = Math.abs(moveDirX) > 0.45 ? Math.sign(moveDirX) : 0;
    const stepGz = Math.abs(moveDirZ) > 0.45 ? Math.sign(moveDirZ) : 0;
    // Se já passou do centro da célula rumo à próxima, exige que a parede continue na célula seguinte!
    const progressInCell =
      (this.bodyPos.x - cellWorld.x) * moveDirX +
      (this.bodyPos.z - cellWorld.z) * moveDirZ;

    let bestScore = -Infinity;
    let bestNx = 0;
    let bestNz = 0;
    let bestFaceCoord = 0;

    for (const [ogx, ogz, nx, nz] of wallDirs) {
      if (!isSolidCell(LABYRINTH_MAP, gx + ogx, gz + ogz)) continue;

      // A parede PRECISA ser lateral ao deslocamento (normal perpendicular a moveDir)!
      const dotMove = Math.abs(nx * moveDirX + nz * moveDirZ);
      if (dotMove > 0.38) continue;

      // Se a parede lateral acaba logo à frente (esquina externa / abertura), solta antes de flutuar no vazio!
      if (
        progressInCell > 0.15 &&
        (stepGx !== 0 || stepGz !== 0) &&
        !isSolidCell(LABYRINTH_MAP, gx + stepGx + ogx, gz + stepGz + ogz)
      ) {
        continue;
      }

      const faceCoord =
        ogx !== 0
          ? cellWorld.x + ogx * (CELL_SIZE * 0.5)
          : cellWorld.z + ogz * (CELL_SIZE * 0.5);
      const distToFace =
        ogx !== 0
          ? Math.abs(this.bodyPos.x - faceCoord)
          : Math.abs(this.bodyPos.z - faceCoord);

      // Forte histerese para manter a mesma parede já escalada sem oscilar de um lado ao outro do corredor
      const sameAsCurrent =
        this.climbedWallNormal.x === nx && this.climbedWallNormal.z === nz
          ? 2.5
          : 0;
      const score = sameAsCurrent - distToFace;
      if (score > bestScore) {
        bestScore = score;
        bestNx = nx;
        bestNz = nz;
        bestFaceCoord = faceCoord;
      }
    }

    if (bestScore === -Infinity) {
      this.climbedWallNormal.set(0, 0, 0);
      return false;
    }

    this.climbedWallNormal.set(bestNx, 0, bestNz);
    this.climbedWallFaceCoord = bestFaceCoord;
    return true;
  }

  private computeCorridorMoveContext(gx: number, gz: number): {
    dirX: number;
    dirZ: number;
    turningCornerSoon: boolean;
  } {
    const cellCenter = gridCellToWorld(gx, gz);
    if (this.pathWaypoints.length > 0) {
      const wp0 = this.pathWaypoints[0];
      let dx = wp0.x - cellCenter.x;
      let dz = wp0.z - cellCenter.z;
      let len = Math.hypot(dx, dz);

      if (len < 0.25 && this.pathWaypoints.length >= 2) {
        dx = this.pathWaypoints[1].x - wp0.x;
        dz = this.pathWaypoints[1].z - wp0.z;
        len = Math.hypot(dx, dz);
      }
      if (len < 0.05) {
        dx = wp0.x - this.bodyPos.x;
        dz = wp0.z - this.bodyPos.z;
        len = Math.hypot(dx, dz);
      }

      const dirX = len > 1e-4 ? dx / len : this.currentForward.x;
      const dirZ = len > 1e-4 ? dz / len : this.currentForward.z;

      let turningCornerSoon = false;
      if (this.pathWaypoints.length >= 2) {
        const wp1 = this.pathWaypoints[1];
        const s1x = wp1.x - wp0.x;
        const s1z = wp1.z - wp0.z;
        const s1Len = Math.hypot(s1x, s1z);
        if (s1Len > 0.2) {
          const dotTurn = (dirX * s1x + dirZ * s1z) / s1Len;
          const distToTurn = Math.hypot(
            wp0.x - this.bodyPos.x,
            wp0.z - this.bodyPos.z
          );
          if (dotTurn < 0.5 && distToTurn < 2.05) {
            turningCornerSoon = true;
          }
        }
      }

      return { dirX, dirZ, turningCornerSoon };
    }

    const fLen = Math.hypot(this.currentForward.x, this.currentForward.z);
    return {
      dirX: fLen > 1e-4 ? this.currentForward.x / fLen : 0,
      dirZ: fLen > 1e-4 ? this.currentForward.z / fLen : -1,
      turningCornerSoon: false,
    };
  }

  private computeSurfaceAdjustedAim(wp: { x: number; z: number }): {
    x: number;
    z: number;
  } {
    if (this.surfaceMode === 'WALL' && this.climbedWallNormal.lengthSq() > 0.5) {
      const wallStandOff = 0.62;
      const aim = this.climbedWallNormal.x !== 0
        ? { x: this.climbedWallFaceCoord + this.climbedWallNormal.x * wallStandOff, z: wp.z }
        : { x: wp.x, z: this.climbedWallFaceCoord + this.climbedWallNormal.z * wallStandOff };
      // Aderir à parede não pode substituir uma rota livre por um trajeto através de móveis.
      if (this.hasClearBodySweep(this.bodyPos.x, this.bodyPos.z, aim.x, aim.z)) return aim;
      this.surfaceMode = 'FLOOR';
      this.climbedWallNormal.set(0, 0, 0);
    }
    return wp;
  }

  private moveAlongPath(dt: number, speed: number): void {
    if (this.pathWaypoints.length === 0) return;

    const { gx, gz } = worldToGridCell(this.bodyPos.x, this.bodyPos.z);
    let ctx = this.computeCorridorMoveContext(gx, gz);
    this.desiredMoveDir.set(ctx.dirX, 0, ctx.dirZ);

    if (this.surfaceMode === 'WALL') {
      const canClimb = this.resolveLateralWallForMovement(
        gx,
        gz,
        ctx.dirX,
        ctx.dirZ,
        ctx.turningCornerSoon
      );
      if (!canClimb) {
        // Transiciona suavemente para chão ou teto ao dobrar esquinas ou sair de paredes!
        this.surfaceMode = this.currentUp.y < -0.15 ? 'CEILING' : 'FLOOR';
      }
    } else {
      this.climbedWallNormal.set(0, 0, 0);
    }

    let aim = this.computeSurfaceAdjustedAim(this.pathWaypoints[0]);
    const dist = Math.hypot(aim.x - this.bodyPos.x, aim.z - this.bodyPos.z);

    const nextWaypoint = this.pathWaypoints[1];
    const canSkip = nextWaypoint && dist < 0.56 && this.hasClearBodySweep(
      this.bodyPos.x, this.bodyPos.z, nextWaypoint.x, nextWaypoint.z
    );
    if (dist < 0.16 || canSkip) {
      this.pathWaypoints.shift();
      if (this.pathWaypoints.length === 0) return;

      ctx = this.computeCorridorMoveContext(gx, gz);
      this.desiredMoveDir.set(ctx.dirX, 0, ctx.dirZ);
      if (this.surfaceMode === 'WALL') {
        const canClimb = this.resolveLateralWallForMovement(
          gx,
          gz,
          ctx.dirX,
          ctx.dirZ,
          ctx.turningCornerSoon
        );
        if (!canClimb) {
          this.surfaceMode = this.currentUp.y < -0.15 ? 'CEILING' : 'FLOOR';
        }
      }
      aim = this.computeSurfaceAdjustedAim(this.pathWaypoints[0]);
    }

    this.moveDirectlyToward(aim.x, aim.z, dt, speed);
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

    this.turnHorizontalToward(tx, tz, dt * (speed > 5 ? 9.5 : 4.2));

    const totalStep = Math.min(dist, speed * dt);
    const subSteps = Math.max(1, Math.ceil(totalStep / 0.26));
    const stepPerSub = totalStep / subSteps;
    for (let s = 0; s < subSteps; s++) {
      this.bodyPos.x += nx * stepPerSub;
      this.bodyPos.z += nz * stepPerSub;
      this.resolveBodyMazeCollision();
    }
  }

  /**
   * Resolve colisão cilíndrica 2D contra todos os blocos do labirinto expulsando ESTRITAMENTE
   * para faces abertas (caminháveis), impedindo 100% atravessar ou tunelar entre blocos adjacentes!
   */
  private resolveBodyMazeCollision(): void {
    const bodyRadius = 0.56;
    for (let pass = 0; pass < 3; pass++) {
      for (let i = 0; i < this.colliders.length; i++) {
        const col = this.colliders[i];
        const b = col.box;
        const blockedCrawl = col.isCrawlUnder && this.bodyPos.y + 0.52 > b.min.y;
        if (!blockedCrawl && !spiderColliderBlocks(col, this.surfaceMode, this.bodyPos.y)) continue;
        const curRadius = col.isObstacle ? 0.44 : bodyRadius;
        const cx = Math.max(b.min.x, Math.min(this.bodyPos.x, b.max.x));
        const cz = Math.max(b.min.z, Math.min(this.bodyPos.z, b.max.z));
        const ox = this.bodyPos.x - cx;
        const oz = this.bodyPos.z - cz;
        const dSq = ox * ox + oz * oz;
        if (dSq < curRadius * curRadius) {
          if (dSq > 1e-8) {
            const d = Math.sqrt(dSq);
            const push = curRadius - d;
            this.bodyPos.x += (ox / d) * push;
            this.bodyPos.z += (oz / d) * push;
          } else if (col.isObstacle) {
            // Se o centro nascer/for empurrado para dentro de um objeto, sai pela face livre mais próxima.
            const exits = [
              { x: b.min.x - curRadius, z: this.bodyPos.z },
              { x: b.max.x + curRadius, z: this.bodyPos.z },
              { x: this.bodyPos.x, z: b.min.z - curRadius },
              { x: this.bodyPos.x, z: b.max.z + curRadius },
            ].sort((a, c) => Math.hypot(a.x - this.bodyPos.x, a.z - this.bodyPos.z) - Math.hypot(c.x - this.bodyPos.x, c.z - this.bodyPos.z));
            const clear = exits.find(p => {
              const cell = worldToGridCell(p.x, p.z);
              if (!isWalkableArenaCell(cell.gx, cell.gz)) return false;
              return !this.colliders.some(other => {
                if (other === col || !spiderColliderBlocks(other, this.surfaceMode, this.bodyPos.y)) return false;
                const box = other.box;
                const x = Math.max(box.min.x, Math.min(p.x, box.max.x));
                const z = Math.max(box.min.z, Math.min(p.z, box.max.z));
                const r = other.isObstacle ? 0.44 : bodyRadius;
                return (p.x - x) ** 2 + (p.z - z) ** 2 < r ** 2 - 1e-8;
              });
            });
            if (clear) { this.bodyPos.x = clear.x; this.bodyPos.z = clear.z; }
          } else {
            // Centro caiu exatamente dentro de um bloco sólido: expulsa SOMENTE por uma face vizinha ABERTA!
            const midX = (b.min.x + b.max.x) * 0.5;
            const midZ = (b.min.z + b.max.z) * 0.5;
            const blockCell = worldToGridCell(midX, midZ);

            let bestPen = Infinity;
            let resolved = false;
            let outX = this.bodyPos.x;
            let outZ = this.bodyPos.z;

            if (!isSolidCell(LABYRINTH_MAP, blockCell.gx - 1, blockCell.gz)) {
              const p = this.bodyPos.x - b.min.x;
              if (p < bestPen) {
                bestPen = p;
                outX = b.min.x - bodyRadius;
                outZ = this.bodyPos.z;
                resolved = true;
              }
            }
            if (!isSolidCell(LABYRINTH_MAP, blockCell.gx + 1, blockCell.gz)) {
              const p = b.max.x - this.bodyPos.x;
              if (p < bestPen) {
                bestPen = p;
                outX = b.max.x + bodyRadius;
                outZ = this.bodyPos.z;
                resolved = true;
              }
            }
            if (!isSolidCell(LABYRINTH_MAP, blockCell.gx, blockCell.gz - 1)) {
              const p = this.bodyPos.z - b.min.z;
              if (p < bestPen) {
                bestPen = p;
                outX = this.bodyPos.x;
                outZ = b.min.z - bodyRadius;
                resolved = true;
              }
            }
            if (!isSolidCell(LABYRINTH_MAP, blockCell.gx, blockCell.gz + 1)) {
              const p = b.max.z - this.bodyPos.z;
              if (p < bestPen) {
                bestPen = p;
                outX = this.bodyPos.x;
                outZ = b.max.z + bodyRadius;
                resolved = true;
              }
            }

            if (resolved) {
              this.bodyPos.x = outX;
              this.bodyPos.z = outZ;
            } else {
              const safeCell = this.findNearestWalkableCell(
                this.bodyPos.x,
                this.bodyPos.z
              );
              const safeW = gridCellToWorld(safeCell.gx, safeCell.gz);
              this.bodyPos.x = safeW.x;
              this.bodyPos.z = safeW.z;
            }
          }
        }
      }
    }
  }

  private turnHorizontalToward(
    tx: number,
    tz: number,
    maxAngleRad: number
  ): void {
    const dx = tx - this.bodyPos.x;
    const dz = tz - this.bodyPos.z;
    const len = Math.hypot(dx, dz);
    if (len < 1e-4) return;

    const curLen = Math.hypot(this.currentForward.x, this.currentForward.z);
    if (curLen < 1e-4) {
      this.currentForward.set(dx / len, 0, dz / len);
      return;
    }

    const curAng = Math.atan2(this.currentForward.x, this.currentForward.z);
    const dstAng = Math.atan2(dx / len, dz / len);
    let diff = ((dstAng - curAng + Math.PI) % (Math.PI * 2)) - Math.PI;
    if (diff < -Math.PI) diff += Math.PI * 2;

    const stepAng =
      Math.abs(diff) <= maxAngleRad ? diff : Math.sign(diff) * maxAngleRad;
    const nextAng = curAng + stepAng;
    this.currentForward.set(Math.sin(nextAng), 0, Math.cos(nextAng)).normalize();
  }

  private rotateUpToward(
    desiredUp: THREE.Vector3,
    maxAngleRad: number
  ): void {
    const dot = Math.max(-1, Math.min(1, this.currentUp.dot(desiredUp)));
    const angle = Math.acos(dot);
    if (angle < 1e-4) {
      this.currentUp.copy(desiredUp).normalize();
      return;
    }

    this.tmpRotAxis.crossVectors(this.currentUp, desiredUp);
    if (this.tmpRotAxis.lengthSq() < 1e-5) {
      // Vetores antipodais (ex.: descendo do teto para o piso): gira pelo eixo lateral da própria Aranha!
      this.tmpRotAxis.crossVectors(this.currentForward, this.currentUp);
      if (this.tmpRotAxis.lengthSq() < 1e-5) {
        this.tmpRotAxis.set(1, 0, 0);
      }
    }
    this.tmpRotAxis.normalize();
    this.currentUp
      .applyAxisAngle(this.tmpRotAxis, Math.min(angle, maxAngleRad))
      .normalize();
  }

  private faceHorizontalToward(tx: number, tz: number, rate: number): void {
    if (rate >= 0.999) {
      const dx = tx - this.bodyPos.x;
      const dz = tz - this.bodyPos.z;
      const len = Math.hypot(dx, dz);
      if (len < 1e-4) return;
      this.currentForward.set(dx / len, 0, dz / len);
      return;
    }
    this.turnHorizontalToward(tx, tz, rate);
  }

  private findNearbyCrawlClearance(): number | null {
    let height: number | null = null;
    for (const col of this.colliders) {
      if (!col.isCrawlUnder) continue;
      const b = col.box;
      const x = Math.max(b.min.x, Math.min(this.bodyPos.x, b.max.x));
      const z = Math.max(b.min.z, Math.min(this.bodyPos.z, b.max.z));
      if (Math.hypot(this.bodyPos.x - x, this.bodyPos.z - z) < 2.15) {
        height = Math.min(height ?? Infinity, Math.max(0.38, b.min.y - 0.56));
      }
    }
    return height;
  }

  private updateSurfaceAttachment(dt: number, elapsed: number): void {
    const { gx, gz } = worldToGridCell(this.bodyPos.x, this.bodyPos.z);
    const inArch =
      isArchCell(LABYRINTH_MAP, gx, gz) ||
      isThemedRoomDoorCell(gx, gz) ||
      gx <= 0 ||
      gx >= LABYRINTH_MAP[0].length - 1 ||
      gz <= 0 ||
      gz >= LABYRINTH_MAP.length - 1;
    const bob = Math.sin(elapsed * 2.4) * 0.045;

    if (this.surfaceMode === 'WALL') {
      const ctx = this.computeCorridorMoveContext(gx, gz);
      const hasValidWall = this.resolveLateralWallForMovement(
        gx,
        gz,
        ctx.dirX,
        ctx.dirZ,
        ctx.turningCornerSoon
      );
      if (!hasValidWall) {
        this.surfaceMode = this.currentUp.y < -0.15 ? 'CEILING' : 'FLOOR';
      }
    } else {
      this.climbedWallNormal.set(0, 0, 0);
    }

    // A aranha abaixa antes de atravessar vigas baixas; não atravessa a barra em pé.
    this.crawlClearanceHeight = this.findNearbyCrawlClearance();
    if (this.crawlClearanceHeight !== null) {
      this.surfaceMode = 'FLOOR';
      this.climbedWallNormal.set(0, 0, 0);
    }

    // Corpo bem mais alto e imponente (~1.42m acima do chão!)
    let desiredY = this.crawlClearanceHeight ?? 1.42 + bob;
    this.targetUp.set(0, 1, 0);

    if (this.surfaceMode === 'CEILING') {
      this.targetUp.set(0, -1, 0);
      desiredY = (inArch ? 1.78 : WALL_HEIGHT - 1.08) + bob;
    } else if (
      this.surfaceMode === 'WALL' &&
      this.climbedWallNormal.lengthSq() > 0.5
    ) {
      const nx = this.climbedWallNormal.x;
      const nz = this.climbedWallNormal.z;
      this.targetUp.set(nx * 0.92, 0.24, nz * 0.92).normalize();
      desiredY = 1.56 + Math.sin(elapsed * 1.9) * 0.14;

      // Encosta suavemente apenas no eixo transversal da parede (sem JAMAIS puxar contra o avanço!)
      const wallStandOff = 0.62;
      const targetCoord =
        this.climbedWallFaceCoord + (nx !== 0 ? nx : nz) * wallStandOff;
      const latLerp = Math.min(1, dt * 5.0);
      if (nx !== 0) {
        this.bodyPos.x += (targetCoord - this.bodyPos.x) * latLerp;
      } else {
        this.bodyPos.z += (targetCoord - this.bodyPos.z) * latLerp;
      }
    }

    const vertLerp = 1 - Math.exp(-7.5 * dt);
    this.bodyPos.y += (desiredY - this.bodyPos.y) * vertLerp;
    // Rotação angular suave e contínua sem singularidades ao transicionar entre Piso, Parede e Teto!
    this.rotateUpToward(this.targetUp, 6.2 * dt);
  }

  private updateBodyAndLimbsIK(
    dt: number,
    elapsed: number,
    playerPos: THREE.Vector3,
    stereoPan: number,
    distToPlayer: number,
    wallCount = 0
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

    // Inclinação corporal sutil conforme aceleração/estado de ameaça (sem comprometer verticalidade no piso!)
    const isCinematicStrike =
      this.cinematicMode === 'STRIKE_ATTACK' ||
      this.cinematicMode === 'FATAL_EXECUTION';
    const isWebSpinning =
      this.state === 'SPINNING_WEB' ||
      this.cinematicMode === 'WEBBING_IN_LAIR';

    const basisMat = new THREE.Matrix4().makeBasis(
      right,
      up,
      this.tmpB.copy(fwd).negate()
    );
    this.bodyGroup.position.copy(this.bodyPos);
    this.bodyGroup.quaternion.setFromRotationMatrix(basisMat);
    this.tmpInvBodyQuat.copy(this.bodyGroup.quaternion).invert();

    const agit = this.isChasingOrAlert ? 1.0 : 0.22;

    // Animação simétrica em TESOURA real das Quelíceras + Presas Venenosas!
    const biteSnap = isCinematicStrike
      ? Math.sin(elapsed * 26) * 0.34 + 0.28
      : Math.max(0, Math.sin(elapsed * (4.2 + agit * 13))) * (0.1 + agit * 0.24);
    const threatGape =
      this.state === 'ALERT_WINDUP' ? 0.36 : agit * 0.14;
    const scissorAngle = threatGape + biteSnap;
    const cheliceraLift =
      (this.state === 'ALERT_WINDUP' ? 0.26 : agit * 0.12) +
      Math.sin(elapsed * (5.5 + agit * 11)) * 0.06;

    this.leftCheliceraPivot.rotation.set(
      cheliceraLift,
      scissorAngle * 0.45,
      -scissorAngle
    );
    this.rightCheliceraPivot.rotation.set(
      cheliceraLift,
      -scissorAngle * 0.45,
      scissorAngle
    );

    // Pedipalpos frontais táteis batendo em fase alternada (esquerda vs direita)
    const palpSpeed = 4.6 + agit * 11.5;
    const leftWave = Math.sin(elapsed * palpSpeed);
    const rightWave = Math.sin(elapsed * palpSpeed + Math.PI * 0.85);
    this.leftPalpPivot.rotation.set(
      -0.12 - agit * 0.22 + leftWave * (0.08 + agit * 0.14),
      0.22 + Math.cos(elapsed * palpSpeed * 0.7) * 0.08,
      leftWave * 0.06
    );
    this.rightPalpPivot.rotation.set(
      -0.12 - agit * 0.22 + rightWave * (0.08 + agit * 0.14),
      -0.22 - Math.cos(elapsed * palpSpeed * 0.7 + 1.1) * 0.08,
      -rightWave * 0.06
    );

    // Respiração orgânica, elevação de ameaça e tecelagem ativa do Opistossoma + Fiandeiras!
    const breath = Math.sin(elapsed * (2.4 + agit * 4.2)) * 0.035;
    const abdomenRearUp =
      this.state === 'ALERT_WINDUP'
        ? 0.42
        : isWebSpinning
          ? 0.12 + Math.sin(elapsed * 9.0) * 0.08
          : 0.24 + agit * 0.09 + breath;
    const abdomenSwayY = isWebSpinning
      ? Math.sin(elapsed * 7.5) * 0.22
      : Math.sin(elapsed * 2.1) * 0.03;
    this.abdomenPivot.rotation.set(abdomenRearUp, abdomenSwayY, 0);
    const breathScale = 1 + breath * 0.45;
    this.abdomenPivot.scale.set(breathScale, breathScale, 1.0);

    const spinTwitch = isWebSpinning ? 0.34 : 0.07;
    this.leftSpinneretPivot.rotation.y =
      -0.16 + Math.sin(elapsed * 14.0) * spinTwitch;
    this.rightSpinneretPivot.rotation.y =
      0.16 - Math.sin(elapsed * 14.0 + 0.9) * spinTwitch;
    this.leftSpinneretPivot.rotation.x =
      Math.cos(elapsed * 12.0) * spinTwitch * 0.6;
    this.rightSpinneretPivot.rotation.x =
      Math.sin(elapsed * 12.0) * spinTwitch * 0.6;

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
        // Apenas em cortes reais de cena (>1.42x alcance) faz snap; durante corrida/descida as patas dão passos rápidos reais!
        const footDistFromRoot = rt.footWorld.distanceTo(rootWorld);
        if (footDistFromRoot > spec.totalLength * 1.42) {
          rt.footWorld.copy(rt.targetWorld);
          rt.stepFrom.copy(rt.targetWorld);
          rt.stepping = false;
          rt.stepT = 0;
        }
        if (rt.stepping && rt.stepFrom.distanceTo(rootWorld) > spec.totalLength * 1.48) {
          rt.stepFrom.copy(rt.targetWorld);
        }

        if (rt.stepping) {
          const stepSpan = rt.stepFrom.distanceTo(rt.targetWorld);
          const longTransition =
            stepSpan > 2.0 ? 0.38 : stepSpan > 1.35 ? 0.56 : 1.0;
          const hurry = (frantic ? 0.36 : 1.0) * longTransition;
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
              rt.onMetalOrCeiling,
              wallCount
            );
          }
        } else if (rt.raiseThreat < 0.1) {
          const drift = rt.footWorld.distanceTo(rt.targetWorld);
          const overstretched = footDistFromRoot > spec.totalLength * 0.89;
          const urgentSurfaceShift = drift > 1.55 && airborneCount < 4;
          const neighboursPlanted = spec.neighbourIndices.every(
            (nIdx) => !this.limbs[nIdx].stepping
          );

          const triggerDist = frantic
            ? spec.stepDistance * 0.7
            : spec.stepDistance;

          if (
            overstretched ||
            urgentSurfaceShift ||
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
      const bowHeight = spec.totalLength * (this.crawlClearanceHeight !== null ? 0.12 : frantic ? 0.34 : 0.44);
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

      // Orienta a cápsula articular Coxa+Trocânter diretamente para o Fêmur (`ikPoints[1]`)!
      const coxaPivot = this.coxaPivots[i];
      if (coxaPivot) {
        this.tmpCoxaDir
          .subVectors(rt.ikPoints[1], rootWorld)
          .applyQuaternion(this.tmpInvBodyQuat);
        if (this.tmpCoxaDir.lengthSq() > 1e-6) {
          this.tmpCoxaDir.normalize();
          coxaPivot.quaternion.setFromUnitVectors(
            this.tmpUnitZ,
            this.tmpCoxaDir
          );
        }
      }

      this.rebuildLimbTubeMesh(spec, rt, up, ringDir);
    }

    this.updateCaptureTentacles(elapsed, right, up, fwd);
  }

  /**
   * Atualiza os 4 Tentáculos Orgânicos Musculares que a Aranha estende para agarrar,
   * puxar o Ragdoll desmaiado pelo chão e erguê-lo para prendê-lo na Teia!
   */
  private updateCaptureTentacles(
    elapsed: number,
    right: THREE.Vector3,
    up: THREE.Vector3,
    fwd: THREE.Vector3
  ): void {
    if (this.state !== 'CINEMATIC_SEQUENCE' || !this.cinematicMode) {
      if (this.tentaclesGroup.visible || this.tentacleExtension > 0) {
        this.hideCaptureTentacles();
      }
      return;
    }

    const u = this.cinematicProgress;
    let ext = 0;
    if (this.cinematicMode === 'STRIKE_ATTACK') {
      ext = u < 0.28 ? 0 : smoothStep01((u - 0.28) / 0.56);
    } else if (this.cinematicMode === 'DRAGGING_TO_WEB') {
      ext = 1.0;
    } else if (this.cinematicMode === 'WEBBING_IN_LAIR') {
      ext = u < 0.78 ? 1.0 : 1.0 - smoothStep01((u - 0.78) / 0.22);
    } else if (this.cinematicMode === 'FATAL_EXECUTION') {
      ext = smoothStep01(Math.min(1, u * 2.6));
    }

    this.tentacleExtension = ext;
    if (ext <= 0.01) {
      this.tentaclesGroup.visible = false;
      return;
    }

    this.tentaclesGroup.visible = true;

    const lateralRoots = [-0.15, 0.15, -0.075, 0.075] as const;
    const vertRoots = [-0.11, -0.11, -0.16, -0.16] as const;
    const hooks = this.cinematicRagdollHooks;
    const pullWave =
      this.cinematicMode === 'DRAGGING_TO_WEB'
        ? 0.5 + 0.5 * Math.sin(u * Math.PI * 8.0)
        : 0.35;

    for (let tIdx = 0; tIdx < this.tentacles.length; tIdx++) {
      const tent = this.tentacles[tIdx];
      const sideSign = tIdx % 2 === 0 ? -1 : 1;

      const rootWorld = new THREE.Vector3(
        this.bodyPos.x +
          right.x * lateralRoots[tIdx] +
          up.x * vertRoots[tIdx] +
          fwd.x * 0.28,
        this.bodyPos.y +
          right.y * lateralRoots[tIdx] +
          up.y * vertRoots[tIdx] +
          fwd.y * 0.28,
        this.bodyPos.z +
          right.z * lateralRoots[tIdx] +
          up.z * vertRoots[tIdx] +
          fwd.z * 0.28
      );

      const fullTarget = new THREE.Vector3();
      if (hooks && hooks[tIdx]) {
        fullTarget.copy(hooks[tIdx]);
      } else {
        // Pontos anatômicos padrão no Ragdoll (tornozelos 0..1, cintura 2, tórax 3)
        if (tIdx < 2) {
          fullTarget
            .copy(this.cinematicVictimPos)
            .addScaledVector(fwd, -0.46)
            .addScaledVector(right, sideSign * 0.15)
            .setY(Math.max(0.22, this.cinematicVictimPos.y + 0.22));
        } else if (tIdx === 2) {
          fullTarget
            .copy(this.cinematicVictimPos)
            .addScaledVector(right, -0.1)
            .setY(Math.max(0.2, this.cinematicVictimPos.y + 0.18));
        } else {
          fullTarget
            .copy(this.cinematicVictimPos)
            .addScaledVector(fwd, 0.34)
            .addScaledVector(right, 0.1)
            .setY(Math.max(0.24, this.cinematicVictimPos.y + 0.2));
        }
      }

      const activeTip = new THREE.Vector3().lerpVectors(
        rootWorld,
        fullTarget,
        ext
      );
      const coilRadius = tIdx < 2 ? 0.085 : 0.165;
      // Quando tensionado no puxão, o arco e a ondulação diminuem (tentáculo esticado sob força!)
      const slack = 1.0 - pullWave * 0.58;

      for (let s = 0; s < TENTACLE_SAMPLES; s++) {
        const f = s / (TENTACLE_SAMPLES - 1);
        const pt = tent.curvePoints[s];
        pt.lerpVectors(rootWorld, activeTip, f);

        const midEnv = Math.sin(f * Math.PI);
        const wriggleA =
          Math.sin(f * 8.5 - elapsed * 9.5 + tIdx * 1.7) * 0.14 * slack * midEnv;
        const wriggleB =
          Math.cos(f * 6.2 - elapsed * 7.8 + tIdx * 2.3) * 0.09 * slack * midEnv;
        // Curva orgânica descendo do esterno da aranha até envolver o corpo no chão
        const sagY = -0.16 * slack * midEnv + wriggleB;

        pt.addScaledVector(right, wriggleA + sideSign * 0.08 * midEnv);
        pt.y = Math.max(0.06, pt.y + sagY);

        // Espiral de apreensão na extremidade distal enrolada no membro/tronco do Ragdoll!
        if (ext > 0.72 && f > 0.8) {
          const coilT = (f - 0.8) / 0.2;
          const coilAng = coilT * Math.PI * 2.4 + sideSign * 0.8;
          const cr = coilRadius * Math.sin(coilT * Math.PI * 0.85) * ((ext - 0.72) / 0.28);
          pt.addScaledVector(right, Math.cos(coilAng) * cr);
          pt.y = Math.max(0.05, pt.y + Math.sin(coilAng) * cr * 0.85);
        }
      }

      // Reconstrói anéis tubulares e normais do tentáculo
      const posArr = tent.posAttr.array as Float32Array;
      const normArr = tent.normAttr.array as Float32Array;
      const colArr = tent.colAttr.array as Float32Array;
      const tang = new THREE.Vector3();
      const nrm = new THREE.Vector3();
      const bin = new THREE.Vector3();

      for (let s = 0; s < TENTACLE_SAMPLES; s++) {
        const f = s / (TENTACLE_SAMPLES - 1);
        const center = tent.curvePoints[s];
        if (s === 0) {
          tang.subVectors(tent.curvePoints[1], tent.curvePoints[0]);
        } else if (s === TENTACLE_SAMPLES - 1) {
          tang.subVectors(tent.curvePoints[s], tent.curvePoints[s - 1]);
        } else {
          tang.subVectors(tent.curvePoints[s + 1], tent.curvePoints[s - 1]);
        }
        if (tang.lengthSq() < 1e-6) tang.set(0, 0, -1);
        else tang.normalize();

        bin.crossVectors(tang, up);
        if (bin.lengthSq() < 1e-5) bin.crossVectors(tang, right);
        bin.normalize();
        nrm.crossVectors(bin, tang).normalize();

        const segRing = 1.0 + Math.sin(f * Math.PI * 24.0) * 0.14;
        const baseRad =
          s === TENTACLE_SAMPLES - 1
            ? 0.006
            : (0.068 * (1 - f * 0.64) + 0.014) * segRing;

        const muscleBand = 0.5 + 0.5 * Math.sin(f * Math.PI * 24.0);

        for (let k = 0; k < TENTACLE_SIDES; k++) {
          const ang = (k / TENTACLE_SIDES) * Math.PI * 2;
          const ca = Math.cos(ang);
          const sa = Math.sin(ang);
          const nx = bin.x * ca + nrm.x * sa;
          const ny = bin.y * ca + nrm.y * sa;
          const nz = bin.z * ca + nrm.z * sa;

          const vIdx = (s * TENTACLE_SIDES + k) * 3;
          posArr[vIdx] = center.x + nx * baseRad;
          posArr[vIdx + 1] = center.y + ny * baseRad;
          posArr[vIdx + 2] = center.z + nz * baseRad;

          normArr[vIdx] = nx;
          normArr[vIdx + 1] = ny;
          normArr[vIdx + 2] = nz;

          // Ventosas claras ventrais e anéis musculares carmesim-quitinosos!
          const ventral = Math.max(0, -sa);
          colArr[vIdx] = 0.24 + muscleBand * 0.16 + ventral * 0.22;
          colArr[vIdx + 1] = 0.055 + muscleBand * 0.045 + ventral * 0.16;
          colArr[vIdx + 2] = 0.095 + muscleBand * 0.065 + ventral * 0.14;
        }
      }

      tent.posAttr.needsUpdate = true;
      tent.normAttr.needsUpdate = true;
      tent.colAttr.needsUpdate = true;
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
    let anchoredPlane: 'FLOOR' | 'CEILING' | 'WALL_X' | 'WALL_Z' = 'FLOOR';

    if (this.surfaceMode === 'CEILING') {
      hit.y = WALL_HEIGHT - 0.025;
      isMetalOrCeiling = true;
      anchoredPlane = 'CEILING';
    } else if (
      this.surfaceMode === 'WALL' &&
      this.climbedWallNormal.lengthSq() > 0.5
    ) {
      const wn = this.climbedWallNormal;
      const intoWall =
        (restCandidate.x - this.bodyPos.x) * -wn.x +
        (restCandidate.z - this.bodyPos.z) * -wn.z;

      let anchoredOnClimbedWall = false;
      if (intoWall >= -0.35) {
        const probeX =
          wn.x !== 0 ? this.climbedWallFaceCoord - wn.x * 0.25 : hit.x;
        const probeZ =
          wn.z !== 0 ? this.climbedWallFaceCoord - wn.z * 0.25 : hit.z;
        const wallCell = worldToGridCell(probeX, probeZ);
        if (isSolidCell(LABYRINTH_MAP, wallCell.gx, wallCell.gz)) {
          anchoredOnClimbedWall = true;
          hit.y = Math.max(
            0.14,
            Math.min(WALL_HEIGHT - 0.14, restCandidate.y - up.y * 0.22)
          );
          if (wn.x !== 0) {
            hit.x = this.climbedWallFaceCoord + wn.x * 0.045;
            anchoredPlane = 'WALL_X';
          } else {
            hit.z = this.climbedWallFaceCoord + wn.z * 0.045;
            anchoredPlane = 'WALL_Z';
          }
        }
      }

      // Patas do lado aberto do corredor (ou além da quina onde a parede acaba) apoiam no chão/teto real — NUNCA no ar!
      if (!anchoredOnClimbedWall) {
        if (restCandidate.y > WALL_HEIGHT * 0.54) {
          hit.y = WALL_HEIGHT - 0.025;
          isMetalOrCeiling = true;
          anchoredPlane = 'CEILING';
        } else {
          hit.y = 0.025;
          anchoredPlane = 'FLOOR';
        }
      }
    } else {
      hit.y = 0.025;
      anchoredPlane = 'FLOOR';
    }

    // Apoia as garras gigantes diretamente nas paredes laterais (respeitando altura Y de arcos!)
    for (let pass = 0; pass < 2; pass++) {
      for (let c = 0; c < this.colliders.length; c++) {
        if (this.colliders[c].isObstacle) continue;
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

          if (minD === dMinX) {
            hit.x = b.min.x - 0.05;
            anchoredPlane = 'WALL_X';
          } else if (minD === dMaxX) {
            hit.x = b.max.x + 0.05;
            anchoredPlane = 'WALL_X';
          } else if (minD === dMinZ) {
            hit.z = b.min.z - 0.05;
            anchoredPlane = 'WALL_Z';
          } else {
            hit.z = b.max.z + 0.05;
            anchoredPlane = 'WALL_Z';
          }

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

    // Limita alcance máximo preservando a garra colada na superfície física (sem puxar para o ar!)
    const dist = hit.distanceTo(root);
    if (dist > maxReach) {
      if (anchoredPlane === 'FLOOR' || anchoredPlane === 'CEILING') {
        const dy = hit.y - root.y;
        const maxPlanar = Math.sqrt(Math.max(0.04, maxReach * maxReach - dy * dy));
        const dx = hit.x - root.x;
        const dz = hit.z - root.z;
        const planar = Math.hypot(dx, dz);
        if (planar > maxPlanar && planar > 1e-5) {
          const s = maxPlanar / planar;
          hit.x = root.x + dx * s;
          hit.z = root.z + dz * s;
        }
      } else if (anchoredPlane === 'WALL_X') {
        const dx = hit.x - root.x;
        const maxTangential = Math.sqrt(
          Math.max(0.04, maxReach * maxReach - dx * dx)
        );
        const dy = hit.y - root.y;
        const dz = hit.z - root.z;
        const tang = Math.hypot(dy, dz);
        if (tang > maxTangential && tang > 1e-5) {
          const s = maxTangential / tang;
          hit.y = Math.max(0.04, Math.min(WALL_HEIGHT - 0.04, root.y + dy * s));
          hit.z = root.z + dz * s;
        }
      } else {
        const dz = hit.z - root.z;
        const maxTangential = Math.sqrt(
          Math.max(0.04, maxReach * maxReach - dz * dz)
        );
        const dy = hit.y - root.y;
        const dx = hit.x - root.x;
        const tang = Math.hypot(dy, dx);
        if (tang > maxTangential && tang > 1e-5) {
          const s = maxTangential / tang;
          hit.y = Math.max(0.04, Math.min(WALL_HEIGHT - 0.04, root.y + dy * s));
          hit.x = root.x + dx * s;
        }
      }
    }

    // Guarda final absoluta: se o clamp tangencial puxou a garra para além da quina de uma parede, ancora no chão/teto!
    if (hit.y > 0.08 && hit.y < WALL_HEIGHT - 0.08) {
      let touchesWall = false;
      for (let c = 0; c < this.colliders.length; c++) {
        if (this.colliders[c].isObstacle) continue;
        const b = this.colliders[c].box;
        if (hit.y < b.min.y - 0.06 || hit.y > b.max.y + 0.06) continue;
        const dx = Math.max(b.min.x - hit.x, 0, hit.x - b.max.x);
        const dz = Math.max(b.min.z - hit.z, 0, hit.z - b.max.z);
        if (dx <= 0.1 && dz <= 0.1) {
          touchesWall = true;
          break;
        }
      }
      if (!touchesWall) {
        if (hit.y > WALL_HEIGHT * 0.54) {
          hit.y = WALL_HEIGHT - 0.025;
          isMetalOrCeiling = true;
        } else {
          hit.y = 0.025;
        }
      }
    }

    return { hitPos: hit, isMetalOrCeiling };
  }

  private unclipIntermediateJoints(pts: THREE.Vector3[]): void {
    const bodyRepelRadius = 0.42;
    for (let i = 1; i < pts.length - 1; i++) {
      const p = pts[i];
      p.y = Math.max(0.06, Math.min(WALL_HEIGHT - 0.06, p.y));

      // Impede joelhos/fêmures de atravessarem o próprio cefalotórax ou abdômen da aranha!
      const bx = p.x - this.bodyPos.x;
      const by = p.y - this.bodyPos.y;
      const bz = p.z - this.bodyPos.z;
      const bDistSq = bx * bx + by * by + bz * bz;
      if (bDistSq < bodyRepelRadius * bodyRepelRadius && bDistSq > 1e-6) {
        const bDist = Math.sqrt(bDistSq);
        const pushOut = (bodyRepelRadius - bDist) / bDist;
        p.x += bx * pushOut;
        p.y += by * pushOut;
        p.z += bz * pushOut;
      }

      for (let c = 0; c < this.colliders.length; c++) {
        const col = this.colliders[c];
        const b = col.box;
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
          const dS = Math.abs(b.max.z + pad - p.z);
          const m = Math.min(dL, dR, dN, dS);
          if (m === dL) p.x = b.min.x - pad;
          else if (m === dR) p.x = b.max.x + pad;
          else if (m === dN) p.z = b.min.z - pad;
          else p.z = b.max.z + pad;
        }
      }
    }
  }

  /**
   * Reconstrói a malha exoesquelética de cada pata com:
   * - Referencial anatômico no plano radial da pata (`ringDir × bodyUp`), eliminando 100%
   *   torções súbitas de 90° e inversão de garras/espinhos no teto e nas paredes;
   * - Podômeros rígidos (Fêmur, Patela-Tíbia, Metatarso, Tarso) com esporões patelares nos joelhos,
   *   3 pares de espinhos raptoriais ventrais na tíbia/metatarso e garra tarsal curva selada na ponta;
   * - Normais 3D reais calculadas pela superfície vizinha para iluminação nítida.
   */
  private rebuildLimbTubeMesh(
    spec: SpiderLimbSpec,
    rt: SpiderLimbRuntime,
    bodyUp: THREE.Vector3,
    ringDir: THREE.Vector3
  ): void {
    const ik = rt.ikPoints;

    for (let s = 0; s < CURVE_SAMPLES; s++) {
      const u = s / (CURVE_SAMPLES - 1);
      sampleArticulatedPodomereChain(ik, u, rt.curvePoints[s]);
    }

    const posArr = rt.posAttr.array as Float32Array;
    const normArr = rt.normAttr.array as Float32Array;
    const colArr = rt.colAttr.array as Float32Array;

    // Eixo lateral perpétuo ao plano anatômico da pata (`ringDir × bodyUp`):
    // garante zero singularidade e zero giro abrupto quando a pata cruza a vertical!
    let planeSideX = ringDir.y * bodyUp.z - ringDir.z * bodyUp.y;
    let planeSideY = ringDir.z * bodyUp.x - ringDir.x * bodyUp.z;
    let planeSideZ = ringDir.x * bodyUp.y - ringDir.y * bodyUp.x;
    let psLen = Math.hypot(planeSideX, planeSideY, planeSideZ);
    if (psLen < 1e-5) {
      planeSideX = 1;
      planeSideY = 0;
      planeSideZ = 0;
      psLen = 1;
    }
    planeSideX /= psLen;
    planeSideY /= psLen;
    planeSideZ /= psLen;

    let prevBx = planeSideX;
    let prevBy = planeSideY;
    let prevBz = planeSideZ;

    for (let j = 0; j < CURVE_SAMPLES; j++) {
      const prevP = rt.curvePoints[Math.max(0, j - 1)];
      const nextP = rt.curvePoints[Math.min(CURVE_SAMPLES - 1, j + 1)];
      const curP = rt.curvePoints[j];

      let tx = nextP.x - prevP.x;
      let ty = nextP.y - prevP.y;
      let tz = nextP.z - prevP.z;
      const tl = Math.hypot(tx, ty, tz);
      if (tl < 1e-6) {
        tx = ringDir.x;
        ty = ringDir.y;
        tz = ringDir.z;
      } else {
        tx /= tl;
        ty /= tl;
        tz /= tl;
      }

      // Projeta o vetor lateral `planeSide = ringDir × bodyUp` ortogonalmente à tangente `t`
      const dotSide = planeSideX * tx + planeSideY * ty + planeSideZ * tz;
      let bx = planeSideX - tx * dotSide;
      let by = planeSideY - ty * dotSide;
      let bz = planeSideZ - tz * dotSide;
      let bLen = Math.hypot(bx, by, bz);
      if (bLen < 1e-4) {
        const dotPrev = prevBx * tx + prevBy * ty + prevBz * tz;
        bx = prevBx - tx * dotPrev;
        by = prevBy - ty * dotPrev;
        bz = prevBz - tz * dotPrev;
        bLen = Math.hypot(bx, by, bz) || 1;
      }
      bx /= bLen;
      by /= bLen;
      bz /= bLen;

      if (bx * prevBx + by * prevBy + bz * prevBz < 0) {
        bx = -bx;
        by = -by;
        bz = -bz;
      }
      prevBx = bx;
      prevBy = by;
      prevBz = bz;

      // Identidade algébrica exata: `n = b × t` com `b = ringDir × bodyUp` aponta SEMPRE
      // para o dorso convexo externo da pata (no fêmur ascendente, no topo do joelho `+bodyUp`
      // e na tíbia descendente `+ringDir`, curvando a garra `-n` para dentro rumo à presa/superfície)!
      let nx = by * tz - bz * ty;
      let ny = bz * tx - bx * tz;
      let nz = bx * ty - by * tx;
      const nLen = Math.hypot(nx, ny, nz) || 1;
      nx /= nLen;
      ny /= nLen;
      nz /= nLen;

      const f = j / (CURVE_SAMPLES - 1);

      // Perfil anatômico: Fêmur musculoso -> Patela/Tíbia -> Metatarso -> Garra Tarsal selada na ponta
      const rootCap = j === 0 ? 0.68 : 1.0;
      const femurMuscle =
        f < 0.28 ? Math.sin((f / 0.28) * Math.PI) * spec.baseWidth * 0.34 : 0;
      const tibiaMuscle =
        f > 0.28 && f < 0.54
          ? Math.sin(((f - 0.28) / 0.26) * Math.PI) * spec.baseWidth * 0.15
          : 0;

      let radius =
        (spec.baseWidth * (1 - 0.92 * Math.pow(f, 1.24)) +
          femurMuscle +
          tibiaMuscle) *
        rootCap;

      // Côndilos articulares + detecção de proximidade das juntas (joelho patelar principal em k=1 e k=2)
      let jointGlow = 0;
      let kneeHornFactor = 0;
      for (let k = 1; k < spec.segments; k++) {
        const jf = k / spec.segments;
        const d = (f - jf) / 0.036;
        const bell = Math.exp(-d * d);
        radius += spec.baseWidth * (k === 1 ? 0.26 : 0.19) * bell;
        jointGlow = Math.max(jointGlow, bell);
        if (k === 1 || k === 2) {
          const hornD = (f - (jf - 0.01)) / 0.026;
          kneeHornFactor = Math.max(
            kneeHornFactor,
            Math.exp(-hornD * hornD) * (k === 1 ? 1.0 : 0.72)
          );
        }
      }

      // 3 pares de espinhos raptoriais na face ventral da tíbia/metatarso
      let ventralSpineFactor = 0;
      for (const sf of [0.39, 0.53, 0.67]) {
        const sd = (f - sf) / 0.019;
        ventralSpineFactor = Math.max(ventralSpineFactor, Math.exp(-sd * sd));
      }

      // Selamento afiado na ponta distal (j = CURVE_SAMPLES - 1 -> ponta de agulha óssea sem furo!)
      if (j === CURVE_SAMPLES - 1) {
        radius = 0.0014;
      } else if (f > 0.88) {
        const tipT = (f - 0.88) / 0.12;
        radius = Math.max(0.0025, radius * (1 - tipT * 0.82));
      } else {
        radius = Math.max(0.008, radius);
      }

      // Garra óssea distal curvando anatomicamente para dentro (-n = direção ventral de agarrar superfície/presa!)
      const clawHook =
        f > 0.84 ? Math.pow((f - 0.84) / 0.16, 2.1) * 0.055 : 0;

      const boneBlend = Math.pow(f, 2.75);
      const fleshR = 0.068 * spec.shade;
      const fleshG = 0.064 * spec.shade;
      const fleshB = 0.074 * spec.shade;
      const boneR = 0.72 * spec.shade;
      const boneG = 0.66 * spec.shade;
      const boneB = 0.56 * spec.shade;

      const baseCr =
        fleshR + (boneR - fleshR) * boneBlend + jointGlow * 0.075;
      const baseCg =
        fleshG + (boneG - fleshG) * boneBlend + jointGlow * 0.032;
      const baseCb =
        fleshB + (boneB - fleshB) * boneBlend + jointGlow * 0.026;

      for (let k = 0; k < RING_SIDES; k++) {
        const ang = (k / RING_SIDES) * Math.PI * 2;
        const ca = Math.cos(ang); // +1 = dorsal (topo da pata), -1 = ventral (face interna)
        const sa = Math.sin(ang); // ±1 = faces laterais

        // Secção transversal quitinosa comprimida lateralmente + quilha dorsal + esporão no joelho + espinhos ventrais!
        let profileScale = 1.0;
        if (ca > 0.72) {
          profileScale = 1.24 + kneeHornFactor * 0.78;
        } else if (ca < -0.68) {
          profileScale = 0.94 + ventralSpineFactor * 0.85;
        } else if (Math.abs(sa) > 0.78) {
          profileScale = 0.82;
        }

        const rLocal = j === CURVE_SAMPLES - 1 ? radius : radius * profileScale;

        const dx = nx * ca + bx * sa;
        const dy = ny * ca + by * sa;
        const dz = nz * ca + bz * sa;

        const vIdx = (j * RING_SIDES + k) * 3;
        posArr[vIdx] = curP.x + dx * rLocal - nx * clawHook;
        posArr[vIdx + 1] = curP.y + dy * rLocal - ny * clawHook;
        posArr[vIdx + 2] = curP.z + dz * rLocal - nz * clawHook;

        // Pontas dos esporões de joelho, espinhos ventrais e quilha dorsal recebem tom ósseo pálido!
        const spurHighlight = Math.min(
          1,
          (ca > 0.72 ? kneeHornFactor * 0.85 + 0.14 : 0) +
            (ca < -0.68 ? ventralSpineFactor * 0.9 : 0)
        );
        colArr[vIdx] = baseCr + (0.68 - baseCr) * spurHighlight;
        colArr[vIdx + 1] = baseCg + (0.62 - baseCg) * spurHighlight;
        colArr[vIdx + 2] = baseCb + (0.52 - baseCb) * spurHighlight;
      }
    }

    // Calcula normais geométricas 3D reais a partir dos anéis e vértices adjacentes da superfície
    for (let j = 0; j < CURVE_SAMPLES; j++) {
      const jPrev = Math.max(0, j - 1);
      const jNext = Math.min(CURVE_SAMPLES - 1, j + 1);
      for (let k = 0; k < RING_SIDES; k++) {
        const kPrev = (k - 1 + RING_SIDES) % RING_SIDES;
        const kNext = (k + 1) % RING_SIDES;

        const iPrevU = (jPrev * RING_SIDES + k) * 3;
        const iNextU = (jNext * RING_SIDES + k) * 3;
        const iPrevV = (j * RING_SIDES + kPrev) * 3;
        const iNextV = (j * RING_SIDES + kNext) * 3;

        const ux = posArr[iNextU] - posArr[iPrevU];
        const uy = posArr[iNextU + 1] - posArr[iPrevU + 1];
        const uz = posArr[iNextU + 2] - posArr[iPrevU + 2];

        const vx = posArr[iNextV] - posArr[iPrevV];
        const vy = posArr[iNextV + 1] - posArr[iPrevV + 1];
        const vz = posArr[iNextV + 2] - posArr[iPrevV + 2];

        // Normal externa garantida: u × v alinhada ao vetor radial real do anel!
        let snx = uy * vz - uz * vy;
        let sny = uz * vx - ux * vz;
        let snz = ux * vy - uy * vx;
        const outIdx = (j * RING_SIDES + k) * 3;
        const rx = posArr[outIdx] - rt.curvePoints[j].x;
        const ry = posArr[outIdx + 1] - rt.curvePoints[j].y;
        const rz = posArr[outIdx + 2] - rt.curvePoints[j].z;
        if (snx * rx + sny * ry + snz * rz < 0) {
          snx = -snx;
          sny = -sny;
          snz = -snz;
        }
        const snLen = Math.hypot(snx, sny, snz);
        if (snLen > 1e-8) {
          normArr[outIdx] = snx / snLen;
          normArr[outIdx + 1] = sny / snLen;
          normArr[outIdx + 2] = snz / snLen;
        } else {
          normArr[outIdx] = 0;
          normArr[outIdx + 1] = 1;
          normArr[outIdx + 2] = 0;
        }
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
