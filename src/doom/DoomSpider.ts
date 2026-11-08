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
  | 'CAPTURE_COIL'
  | 'FLEE_RETREAT';

const RING_SIDES = 6;
const CURVE_SAMPLES = 15;
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

/**
 * Resolve cadeia IK multi-segmento via FABRIK (mesmo algoritmo `SolveChain` de `sh_ik.lua`).
 */
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

/**
 * Cria BufferGeometry pré-alocado para um tubo orgânico de `CURVE_SAMPLES` anéis x `RING_SIDES` lados.
 */
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
  // Evita frustum culling prematuro em patas muito longas esticadas pelo corredor
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 60);

  return { geometry, posAttr, normAttr, colAttr };
}

/**
 * Aranha Procedural de Terror baseada diretamente nas referências de "Evil crawling thing"
 * (Garry's Mod Workshop #3818771209):
 * - 8 patas negras longas, arqueadas, articuladas por IK (FABRIK) + tubos Catmull-Rom afilados até agulhas ósseas
 * - Escala livremente chão, paredes e teto (inclusive emboscadas de cabeça para baixo)
 * - Tece armadilhas de teia pelos corredores
 * - Anda bem devagar patrulhando, mas dispara em velocidade absurda ao encontrar o jogador ou sentir vibração na teia!
 */
export class DoomSpider {
  private readonly rootGroup = new THREE.Group();
  private readonly bodyGroup = new THREE.Group();
  private readonly mandibleGroup = new THREE.Group();
  private readonly chitinMat: THREE.ShaderMaterial;

  private readonly limbSpecs: SpiderLimbSpec[] = [];
  private readonly limbs: SpiderLimbRuntime[] = [];

  // Posição no plano XZ e altura vertical do centro da aranha
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
  private churnYaw = 0;

  private pathWaypoints: Array<{ x: number; z: number }> = [];
  private pathRepathTimer = 0;
  private readonly lastKnownPlayerPos = new THREE.Vector3();

  private captureProgress = 0;
  private struggleEscapeAccum = 0;

  // Vetores temporários reutilizáveis (zero GC por frame)
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

    // Nasce longe do jogador na galeria sul (gx=7, gz=11), inicialmente no teto!
    this.respawnFarFromPlayer();
  }

  get currentState(): SpiderBehaviorState {
    return this.state;
  }

  get isChasingOrAlert(): boolean {
    return (
      this.state === 'ALERT_WINDUP' ||
      this.state === 'FRENZY_CHASE' ||
      this.state === 'CAPTURE_COIL'
    );
  }

  get isCapturingPlayer(): boolean {
    return this.state === 'CAPTURE_COIL';
  }

  get position(): THREE.Vector3 {
    return this.bodyPos;
  }

  respawnFarFromPlayer(): void {
    const startCell = gridCellToWorld(7, 11);
    this.surfaceMode = 'CEILING';
    this.bodyPos.set(startCell.x, WALL_HEIGHT - 0.92, startCell.z);
    this.prevBodyPos.copy(this.bodyPos);
    this.smoothVel.set(0, 0, 0);
    this.currentUp.set(0, -1, 0);
    this.targetUp.set(0, -1, 0);
    this.currentForward.set(0, 0, -1);

    this.state = 'STALK_PATROL';
    this.stateTimer = 0;
    this.pathWaypoints = [];
    this.captureProgress = 0;
    this.struggleEscapeAccum = 0;

    // Reinicializa pés próximos à posição inicial
    for (let i = 0; i < this.limbs.length; i++) {
      const spec = this.limbSpecs[i];
      const rt = this.limbs[i];
      const ang = spec.angleRad;
      rt.footWorld.set(
        this.bodyPos.x + Math.cos(ang) * 1.15,
        WALL_HEIGHT - 0.03,
        this.bodyPos.z + Math.sin(ang) * 1.15
      );
      rt.stepFrom.copy(rt.footWorld);
      rt.targetWorld.copy(rt.footWorld);
      rt.stepping = false;
      rt.stepT = 0;
    }
  }

  /**
   * Chamado imediatamente quando o jogador pisa numa armadilha de teia!
   */
  alertToWebTrap(trapWorldPos: THREE.Vector3, playerPos: THREE.Vector3): void {
    if (this.state === 'CAPTURE_COIL') return;

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
   * Constrói o núcleo escuro compacto + abdômen alongado erguido + quelíceras/olhos
   * seguindo exatamente a silhueta sombria de `image-4.png` e `Evil crawling thing`.
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

    // 1. Cefalotórax negro compacto onde convergem as 8 patas
    const thoraxGeo = paintBlackBody(
      new THREE.IcosahedronGeometry(0.22, 1),
      0.032,
      0.032,
      0.038
    );
    thoraxGeo.scale(0.88, 0.72, 1.28);
    const thorax = new THREE.Mesh(thoraxGeo, this.chitinMat);
    this.bodyGroup.add(thorax);

    // 2. Abdômen alongado e inclinado para cima/trás (idêntico à crista escura de image-4.png!)
    const abdomenGeo = paintBlackBody(
      new THREE.ConeGeometry(0.16, 0.68, 7, 3),
      0.025,
      0.025,
      0.031
    );
    abdomenGeo.scale(0.76, 1.0, 1.05);
    const abdomen = new THREE.Mesh(abdomenGeo, this.chitinMat);
    abdomen.rotation.x = -Math.PI * 0.34;
    abdomen.position.set(0, 0.24, 0.28);
    this.bodyGroup.add(abdomen);

    // Cápsula inferior do abdômen para volume orgânico sem arestas secas
    const bellyGeo = paintBlackBody(
      new THREE.SphereGeometry(0.165, 7, 6),
      0.03,
      0.028,
      0.034
    );
    bellyGeo.scale(0.78, 0.85, 1.35);
    const belly = new THREE.Mesh(bellyGeo, this.chitinMat);
    belly.position.set(0, 0.08, 0.19);
    this.bodyGroup.add(belly);

    // 3. Seis pontas bucais/quelíceras inferiores móveis (`MOUTH_TIPS` de cl_init.lua)
    for (let i = 0; i < 6; i++) {
      const ang = (i / 6) * Math.PI * 2;
      const fangGeo = paintBlackBody(
        new THREE.ConeGeometry(0.026, 0.22, 5),
        i < 2 ? 0.42 : 0.08,
        i < 2 ? 0.38 : 0.07,
        i < 2 ? 0.34 : 0.07
      );
      const fang = new THREE.Mesh(fangGeo, this.chitinMat);
      fang.position.set(
        Math.cos(ang) * 0.09,
        -0.14,
        -0.16 + Math.sin(ang) * 0.08
      );
      fang.rotation.x = Math.PI + 0.32;
      fang.rotation.z = Math.cos(ang) * 0.28;
      this.mandibleGroup.add(fang);
    }
    this.bodyGroup.add(this.mandibleGroup);

    // 4. Ocelos frontais pálidos/rubros discretos que brilham sob o foco da lanterna
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0x9e8878 });
    const eyeOffsets: Array<[number, number, number, number]> = [
      [-0.055, 0.03, -0.255, 0.016],
      [0.055, 0.03, -0.255, 0.016],
      [-0.095, 0.055, -0.23, 0.011],
      [0.095, 0.055, -0.23, 0.011],
      [-0.03, 0.068, -0.245, 0.01],
      [0.03, 0.068, -0.245, 0.01],
    ];
    for (const [ex, ey, ez, er] of eyeOffsets) {
      const eye = new THREE.Mesh(new THREE.OctahedronGeometry(er, 0), eyeMat);
      eye.position.set(ex, ey, ez);
      this.bodyGroup.add(eye);
    }

    this.rootGroup.add(this.bodyGroup);
  }

  /**
   * Gera as 8 patas longas assimétricas estilo `EvilCrawler.Grow(seed)`.
   */
  private buildProceduralLimbs(): void {
    const rand = mulberry32(38187712);
    // 4 pares bilaterais (frente -> trás) com variações orgânicas sutis
    const baseDegs = [-28, 28, -64, 64, -106, 106, -146, 146];

    for (let i = 0; i < 8; i++) {
      const deg = baseDegs[i] + (rand() - 0.5) * 9;
      const angleRad = (deg * Math.PI) / 180;
      const segments = 4;
      const totalLength = 2.48 + rand() * 0.42; // patas bem longas e imponentes (~2.5m - 2.9m)

      const rawSegs = [0.72, 1.25, 1.18, 0.95].map(
        (w) => w * (0.9 + rand() * 0.2)
      );
      const sum = rawSegs.reduce((a, b) => a + b, 0);
      const lengths = rawSegs.map((w) => (w / sum) * totalLength);

      const sideSign = deg < 0 ? -1 : 1;
      const rootLocal = new THREE.Vector3(
        sideSign * (0.11 + rand() * 0.03),
        -0.02 + (rand() - 0.5) * 0.04,
        Math.cos(angleRad) * -0.14
      );

      this.limbSpecs.push({
        index: i,
        rootLocal,
        angleRad,
        spread: 0.5 + rand() * 0.1,
        segments,
        lengths,
        totalLength,
        baseWidth: 0.056 + rand() * 0.012,
        stepDistance: 0.62 + rand() * 0.22,
        stepTime: 0.26 + rand() * 0.08,
        stepHeight: 0.36 + rand() * 0.14,
        phase: rand() * 100,
        freq: 0.8 + rand() * 1.4,
        shade: 0.85 + rand() * 0.3,
        neighbourIndices: [],
      });
    }

    // Conecta patas vizinhas para impedir que duas patas adjacentes levantem juntas!
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

  /**
   * Atualização principal de IA, superfície (chão/parede/teto), armadilhas de teia,
   * captura/luta e cinemática inversa (IK) das 8 patas.
   */
  update(
    dt: number,
    elapsed: number,
    playerPos: THREE.Vector3,
    playerYaw: number,
    playerSprinting: boolean,
    playerCrouching: boolean,
    flashlightOn: boolean,
    flashlightDir: THREE.Vector3,
    hasKnife: boolean,
    struggleInput: boolean,
    activeFlares: readonly ActiveMagnesiumFlare[],
    onDealDamageToPlayer: (damage: number, causeBleeding: boolean) => void
  ): {
    capturePullTarget: THREE.Vector3 | null;
    cameraShakeAmount: number;
    playerDistance: number;
  } {
    this.stateTimer += dt;
    this.webCooldownTimer = Math.max(0, this.webCooldownTimer - dt);
    this.pathRepathTimer = Math.max(0, this.pathRepathTimer - dt);

    const distToPlayer = Math.hypot(
      playerPos.x - this.bodyPos.x,
      playerPos.z - this.bodyPos.z
    );
    const stereoPan = this.computeStereoPan(playerPos, playerYaw);

    // 1. Verifica repulsão por Sinalizador de Magnésio aceso no chão!
    if (this.state !== 'FLEE_RETREAT' && this.state !== 'CAPTURE_COIL') {
      for (const fl of activeFlares) {
        const dFlare = Math.hypot(
          fl.position.x - this.bodyPos.x,
          fl.position.z - this.bodyPos.z
        );
        if (dFlare < 4.3) {
          this.sound.playSpiderScream(stereoPan, distToPlayer);
          this.state = 'FLEE_RETREAT';
          this.stateTimer = 0;
          this.surfaceMode = 'CEILING';
          this.pickFarRetreatPath(fl.position);
          break;
        }
      }
    }

    // 2. Sensores de Visão e Audição da Aranha
    const canSeePlayer = this.detectPlayer(
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

    // 3. Máquina de Estados da Aranha
    let capturePullTarget: THREE.Vector3 | null = null;
    let cameraShakeAmount = 0;

    if (this.state === 'CAPTURE_COIL') {
      // Aranha capturou o jogador e enrola as patas dianteiras ao redor dele (`Coil`)!
      this.captureProgress = Math.min(1, this.captureProgress + dt * 2.8);
      cameraShakeAmount = 0.055;

      // Posiciona a câmera levemente puxada na direção da aranha
      const toSpider = this.tmpA
        .subVectors(this.bodyPos, playerPos)
        .setY(0);
      const len = toSpider.length();
      if (len > 0.001) toSpider.multiplyScalar(1 / len);

      capturePullTarget = new THREE.Vector3(
        this.bodyPos.x - toSpider.x * 1.08,
        playerPos.y,
        this.bodyPos.z - toSpider.z * 1.08
      );

      // Processa tentativa do jogador de escapar
      const baseEscapeRate = hasKnife ? 1.15 : 0.46;
      const mashBonus = struggleInput ? (hasKnife ? 1.45 : 0.72) : 0;
      this.struggleEscapeAccum += dt * (baseEscapeRate + mashBonus);

      if (struggleInput && Math.random() < dt * 9) {
        this.sound.playStruggleEffort();
      }

      if (this.struggleEscapeAccum >= 1.0) {
        // Jogador escapou do bote! Aranha recua pelo teto por alguns segundos
        if (hasKnife) {
          this.sound.playItemUse('blade');
        }
        this.webManager.clearEnsnarement();
        this.state = 'FLEE_RETREAT';
        this.stateTimer = 0;
        this.surfaceMode = 'CEILING';
        this.pickFarRetreatPath(playerPos);
      } else if (this.stateTimer > 2.35) {
        // Segundo golpe pesado caso o jogador não reaja
        onDealDamageToPlayer(34, true);
        this.webManager.clearEnsnarement();
        this.state = 'FLEE_RETREAT';
        this.stateTimer = 0;
        this.surfaceMode = 'CEILING';
        this.pickFarRetreatPath(playerPos);
      }
    } else if (this.state === 'FLEE_RETREAT') {
      this.moveAlongPath(dt, 7.6);
      if (this.stateTimer > 5.8) {
        this.state = 'STALK_PATROL';
        this.stateTimer = 0;
        this.pathWaypoints = [];
      }
    } else if (this.state === 'ALERT_WINDUP') {
      // Congela 0.42s erguendo as patas dianteiras antes de disparar em velocidade absurda!
      this.faceHorizontalToward(playerPos.x, playerPos.z, dt * 10);
      if (this.stateTimer >= 0.42) {
        this.state = 'FRENZY_CHASE';
        this.stateTimer = 0;
        this.pathRepathTimer = 0;
      }
    } else if (this.state === 'FRENZY_CHASE') {
      // VELOCIDADE ABSURDA DE PERSEGUIÇÃO! ("correr pela sua vida para tentar fugir")
      if (this.pathRepathTimer <= 0) {
        this.pathRepathTimer = 0.32;
        this.buildGridPathTo(
          this.lastKnownPlayerPos.x,
          this.lastKnownPlayerPos.z
        );
      }

      // Ao chegar perto do jogador, desce do teto/parede para dar o bote!
      if (distToPlayer < 5.4) {
        this.surfaceMode = 'FLOOR';
      } else if (Math.random() < dt * 0.45) {
        // Durante a corrida pode alternar entre chão, paredes e teto!
        const roll = Math.random();
        this.surfaceMode =
          roll < 0.55 ? 'FLOOR' : roll < 0.8 ? 'CEILING' : 'WALL';
      }

      const chaseSpeed = this.webManager.isPlayerEnsnared ? 10.2 : 9.35;
      if (canSeePlayer && distToPlayer < 5.5) {
        this.moveDirectlyToward(playerPos.x, playerPos.z, dt, chaseSpeed);
      } else {
        this.moveAlongPath(dt, chaseSpeed);
      }

      if (distToPlayer < 8.5) {
        cameraShakeAmount = (1 - distToPlayer / 8.5) * 0.018;
      }

      // Alcançou o jogador -> Captura!
      if (distToPlayer < 1.28) {
        this.surfaceMode = 'FLOOR';
        this.state = 'CAPTURE_COIL';
        this.stateTimer = 0;
        this.captureProgress = 0;
        this.struggleEscapeAccum = 0;
        this.sound.playSpiderCaptureImpact();
        onDealDamageToPlayer(38, true);
      } else {
        // Perdeu o jogador de vista após ele correr e se esconder pelas esquinas
        const giveUpTime = playerCrouching && !flashlightOn ? 5.2 : 7.8;
        if (this.lostSightTimer > giveUpTime) {
          this.state = 'STALK_PATROL';
          this.stateTimer = 0;
          this.surfaceMode = Math.random() < 0.65 ? 'CEILING' : 'WALL';
          this.pathWaypoints = [];
        }
      }
    } else if (this.state === 'SPINNING_WEB') {
      // Tece uma armadilha de teia no corredor atual
      this.surfaceMode = 'FLOOR';
      this.churnYaw += dt * 2.4;
      if (Math.floor((this.stateTimer - dt) * 3) !== Math.floor(this.stateTimer * 3)) {
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
      // Fica imóvel de cabeça para baixo no teto esperando alguém passar!
      this.surfaceMode = 'CEILING';
      this.churnYaw += dt * 0.25 * Math.sin(elapsed * 0.6);

      if (canSeePlayer) {
        this.triggerAlertScream(stereoPan, distToPlayer);
      } else if (this.stateTimer >= 5.5) {
        this.state = 'STALK_PATROL';
        this.stateTimer = 0;
      }
    } else {
      // STALK_PATROL — Anda bem devagar (~1.18 m/s), livre para escalar paredes, teto ou chão!
      if (canSeePlayer) {
        this.triggerAlertScream(stereoPan, distToPlayer);
      } else {
        if (this.pathWaypoints.length === 0) {
          this.pickRandomPatrolPath();
        }
        this.moveAlongPath(dt, 1.18);

        // Liberdade autônoma para trocar entre Teto, Parede, Chão, Emboscada ou Tecer Teia!
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

          // Às vezes para no teto em emboscada silenciosa
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

    // 4. Ajusta altura vertical e normal da superfície (Chão, Parede ou Teto!)
    this.updateSurfaceAttachment(dt, elapsed);

    // 5. Atualiza velocidade suavizada e brilho sutil de fúria
    this.tmpA
      .subVectors(this.bodyPos, this.prevBodyPos)
      .multiplyScalar(1 / Math.max(0.0005, dt));
    this.smoothVel.lerp(this.tmpA, Math.min(1, dt * 16));
    this.prevBodyPos.copy(this.bodyPos);

    const targetRage = this.isChasingOrAlert ? 1.0 : 0.0;
    this.chitinMat.uniforms.uRageGlow.value +=
      (targetRage - this.chitinMat.uniforms.uRageGlow.value) *
      Math.min(1, dt * 6);

    // 6. Posiciona o corpo central e resolve IK + malhas tubulares das 8 patas
    this.updateBodyAndLimbsIK(dt, elapsed, playerPos, stereoPan, distToPlayer);

    return {
      capturePullTarget,
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
    // Audição aguçada: correr (Shift) perto da aranha denuncia sua posição!
    if (playerSprinting && dist < 9.2) {
      return true;
    }
    if (!playerCrouching && dist < 2.8) {
      return true;
    }

    // Alcance visual depende da lanterna e de estar agachado furtivamente (Ctrl)
    let sightRange = 15.5;
    if (flashlightOn) {
      sightRange = 20.5;
      // Se o jogador apontar a lanterna diretamente na direção da aranha, ela percebe de longe!
      const toSpider = this.tmpA
        .subVectors(this.bodyPos, playerPos)
        .normalize();
      if (toSpider.dot(flashlightDir) > 0.86 && dist < 23.0) {
        if (this.hasLineOfSight(this.bodyPos, playerPos)) return true;
      }
    } else if (playerCrouching) {
      sightRange = 5.4;
    }

    if (dist > sightRange) return false;

    // Verifica cone visual amplo da aranha (230 graus; aranhas sentem quase tudo à frente/lados)
    const toPrey = this.tmpA
      .set(playerPos.x - this.bodyPos.x, 0, playerPos.z - this.bodyPos.z)
      .normalize();
    const fwdFlat = this.tmpB
      .set(this.currentForward.x, 0, this.currentForward.z);
    if (fwdFlat.lengthSq() > 0.01) {
      fwdFlat.normalize();
      if (toPrey.dot(fwdFlat) < -0.42 && dist > 4.2) {
        return false;
      }
    }

    return this.hasLineOfSight(this.bodyPos, playerPos);
  }

  private hasLineOfSight(from: THREE.Vector3, to: THREE.Vector3): boolean {
    const startY = Math.min(2.1, Math.max(0.8, from.y));
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

  /**
   * Calcula caminho em grade (BFS sobre células abertas de `LABYRINTH_MAP`)
   * para perseguição implacável pelos corredores sem nunca travar em quinas!
   */
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
    let bestWorld = gridCellToWorld(7, 11);
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

    if (dist < 0.48) {
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

    // Respeita paredes sólidas mantendo margem orgânica para o corpo central
    const bodyRadius = 0.44;
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

  /**
   * Adapta suavemente a altura do corpo e o vetor `up` conforme a aranha caminha
   * pelo CHÃO, escala uma PAREDE lateral ou fica de cabeça para baixo no TETO!
   */
  private updateSurfaceAttachment(dt: number, elapsed: number): void {
    const { gx, gz } = worldToGridCell(this.bodyPos.x, this.bodyPos.z);
    const inArch = isArchCell(LABYRINTH_MAP, gx, gz);
    const bob = Math.sin(elapsed * 2.6) * 0.035;

    let desiredY = 1.04 + bob;
    this.targetUp.set(0, 1, 0);

    if (this.surfaceMode === 'CEILING') {
      this.targetUp.set(0, -1, 0);
      // Passa por baixo da viga superior ('A') sem atravessar o metal!
      desiredY = (inArch ? 1.88 : WALL_HEIGHT - 0.92) + bob;
    } else if (this.surfaceMode === 'WALL') {
      // Procura a parede sólida mais próxima ao redor da célula atual para escalar lateralmente!
      const wallDirs: Array<[number, number, number, number]> = [
        [-1, 0, 1, 0], // parede a Oeste -> normal aponta +X
        [1, 0, -1, 0], // parede a Leste -> normal aponta -X
        [0, -1, 0, 1], // parede ao Norte -> normal aponta +Z
        [0, 1, 0, -1], // parede ao Sul -> normal aponta -Z
      ];

      let foundWall = false;
      const cellWorld = gridCellToWorld(gx, gz);
      for (const [ogx, ogz, nx, nz] of wallDirs) {
        if (isSolidCell(LABYRINTH_MAP, gx + ogx, gz + ogz)) {
          foundWall = true;
          // Inclina entre a parede e o chão/teto para escalada aracnídea realista
          this.targetUp.set(nx * 0.92, 0.25, nz * 0.92).normalize();
          desiredY = 1.66 + Math.sin(elapsed * 1.9) * 0.18;

          // Aproxima suavemente o corpo da face da parede escalada
          const wallTouchX = cellWorld.x + ogx * (CELL_SIZE * 0.5 - 0.78);
          const wallTouchZ = cellWorld.z + ogz * (CELL_SIZE * 0.5 - 0.78);
          if (ogx !== 0) {
            this.bodyPos.x += (wallTouchX - this.bodyPos.x) * Math.min(1, dt * 3.5);
          } else {
            this.bodyPos.z += (wallTouchZ - this.bodyPos.z) * Math.min(1, dt * 3.5);
          }
          break;
        }
      }

      if (!foundWall) {
        // Câmara aberta sem parede colada -> sobe para o teto!
        this.targetUp.set(0, -1, 0);
        desiredY = WALL_HEIGHT - 0.92 + bob;
      }
    }

    const vertLerp = 1 - Math.exp(-7.5 * dt);
    this.bodyPos.y += (desiredY - this.bodyPos.y) * vertLerp;
    this.currentUp.lerp(this.targetUp, vertLerp).normalize();
  }

  /**
   * Atualiza orientação 3D do corpo, movimentos das quelíceras, alvos de pisada
   * em múltiplas superfícies (chão + paredes + teto), FABRIK IK e geometria Catmull-Rom!
   */
  private updateBodyAndLimbsIK(
    dt: number,
    elapsed: number,
    playerPos: THREE.Vector3,
    stereoPan: number,
    distToPlayer: number
  ): void {
    // Ortogonaliza base 3D do corpo (Right, Up, Forward)
    const up = this.currentUp;
    const fwd = this.tmpA.copy(this.currentForward);
    fwd.addScaledVector(up, -fwd.dot(up));
    if (fwd.lengthSq() < 1e-5) {
      fwd.set(0, 0, -1);
      fwd.addScaledVector(up, -fwd.dot(up));
    }
    fwd.normalize();

    const right = this.tmpRight.crossVectors(fwd, up).normalize();

    // Aplica leve rotação orgânica (`churn` de cl_init.lua) quando parada/espreitando
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

    // Vibração das quelíceras inferiores
    const agit = this.isChasingOrAlert ? 1.0 : 0.2;
    this.mandibleGroup.rotation.y = Math.sin(elapsed * (6 + agit * 14)) * 0.12;
    this.mandibleGroup.scale.setScalar(
      1 + Math.sin(elapsed * (4 + agit * 12)) * 0.06
    );

    const frantic = this.state === 'FRENZY_CHASE' || this.state === 'FLEE_RETREAT';
    const maxAirborne = frantic ? 4 : 2;

    let airborneCount = 0;
    for (let i = 0; i < this.limbs.length; i++) {
      if (this.limbs[i].stepping) airborneCount++;
    }

    // Avanço preditivo da pisada (`LEAD_TIME` de cl_init.lua)
    const lead = this.tmpC.copy(this.smoothVel).multiplyScalar(0.15);
    if (lead.length() > 0.85) lead.setLength(0.85);

    for (let i = 0; i < this.limbs.length; i++) {
      const spec = this.limbSpecs[i];
      const rt = this.limbs[i];

      // Tremor nervoso esporádico (`twitch` de cl_init.lua)
      rt.twitch.multiplyScalar(Math.exp(-dt * 8));
      if (Math.random() < dt * (0.35 + agit * 1.8)) {
        rt.twitch.set(
          (Math.random() - 0.5) * 0.14,
          (Math.random() - 0.5) * 0.14,
          (Math.random() - 0.5) * 0.14
        );
      }

      // Raiz da pata no mundo
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

      // Posição ideal de apoio em superfície real (Chão, Parede ou Teto!)
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

      // Patas dianteiras erguidas ameaçadoramente no ALERT_WINDUP (`THREAT_ARC`)
      const isFrontPair = i === 0 || i === 1;
      const wantRaise =
        this.state === 'ALERT_WINDUP' && isFrontPair ? 1.0 : 0.0;
      rt.raiseThreat += (wantRaise - rt.raiseThreat) * Math.min(1, dt * 12);

      // Passo assíncrono das patas
      if (this.state === 'CAPTURE_COIL' && i < 4) {
        // Durante captura, as 4 patas frontais envolvem helicoidalmente o jogador (`Coil`)!
        rt.stepping = false;
      } else if (rt.stepping) {
        const hurry = frantic ? 0.36 : 1.0;
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
          ? spec.stepDistance * 0.72
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

      // Posição instantânea da ponta da pata
      const activeFoot = new THREE.Vector3().copy(rt.footWorld);
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
          .multiplyScalar(spec.totalLength * 0.62)
          .add(rootWorld)
          .addScaledVector(up, 0.55);
        activeFoot.lerp(threatAim, smoothStep01(rt.raiseThreat));
      }

      if (this.state === 'CAPTURE_COIL' && i < 4) {
        // Enrola as 4 patas dianteiras ao redor do tronco do jogador (`Coil` de cl_init.lua)!
        const side = i % 2 === 0 ? -1 : 1;
        const tier = i < 2 ? 1.32 : 0.86;
        const wrapAngle =
          Math.atan2(
            this.bodyPos.z - playerPos.z,
            this.bodyPos.x - playerPos.x
          ) +
          side * (0.95 + this.captureProgress * 1.65);
        const coilRadius = 0.44;
        const coilPoint = new THREE.Vector3(
          playerPos.x + Math.cos(wrapAngle) * coilRadius,
          tier + Math.sin(elapsed * 18 + i) * 0.06,
          playerPos.z + Math.sin(wrapAngle) * coilRadius
        );
        activeFoot.lerp(coilPoint, smoothStep01(this.captureProgress));
      }

      // Arco elevado característico de Evil Crawling Thing + image-4.png (`bow`)!
      const nJoints = rt.ikPoints.length;
      const bowHeight = spec.totalLength * (frantic ? 0.34 : 0.45);
      for (let j = 0; j < nJoints; j++) {
        const f = j / (nJoints - 1);
        const arch = Math.sin(f * Math.PI);
        const wobX =
          Math.sin(elapsed * spec.freq + spec.phase + j * 1.7) * 0.045;
        const wobY =
          Math.cos(elapsed * spec.freq * 1.3 + spec.phase + j) * 0.045;
        const wobZ =
          Math.sin(elapsed * spec.freq * 0.9 + spec.phase * 1.4) * 0.045;

        rt.ikPoints[j]
          .lerpVectors(rootWorld, activeFoot, f)
          .addScaledVector(up, bowHeight * arch)
          .addScaledVector(ringDir, spec.totalLength * 0.12 * arch)
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
   * Projeta o alvo de apoio de cada pata em pisos, grades do teto OU faces verticais das paredes!
   */
  private findSurfaceFootTarget(
    root: THREE.Vector3,
    restCandidate: THREE.Vector3,
    up: THREE.Vector3,
    maxReach: number
  ): { hitPos: THREE.Vector3; isMetalOrCeiling: boolean } {
    const hit = new THREE.Vector3().copy(restCandidate);
    let isMetalOrCeiling = restCandidate.z < 4.5;

    // 1. Puxa em direção à superfície principal da postura atual (Chão, Teto ou Parede)
    if (this.surfaceMode === 'CEILING') {
      hit.y = WALL_HEIGHT - 0.025;
      isMetalOrCeiling = true;
    } else if (this.surfaceMode === 'FLOOR') {
      hit.y = 0.025;
    } else {
      // Na parede, distribui patas em alturas variadas da alvenaria/metal
      hit.y = Math.max(0.08, Math.min(WALL_HEIGHT - 0.08, restCandidate.y - up.y * 0.4));
    }

    // 2. Se o ponto de descanso entrou num bloco de parede sólida, apoia a pata exatamente na face da parede!
    for (let c = 0; c < this.colliders.length; c++) {
      const b = this.colliders[c].box;
      if (
        hit.x > b.min.x - 0.06 &&
        hit.x < b.max.x + 0.06 &&
        hit.z > b.min.z - 0.06 &&
        hit.z < b.max.z + 0.06
      ) {
        // Projeta para a face externa do bloco mais próxima da raiz da pata
        const dMinX = Math.abs(root.x - b.min.x);
        const dMaxX = Math.abs(root.x - b.max.x);
        const dMinZ = Math.abs(root.z - b.min.z);
        const dMaxZ = Math.abs(root.z - b.max.z);
        const minD = Math.min(dMinX, dMaxX, dMinZ, dMaxZ);

        if (minD === dMinX) hit.x = b.min.x - 0.03;
        else if (minD === dMaxX) hit.x = b.max.x + 0.03;
        else if (minD === dMinZ) hit.z = b.min.z - 0.03;
        else hit.z = b.max.z + 0.03;

        // Ao encostar numa parede lateral, eleva/abaixa levemente a garra na parede!
        if (this.surfaceMode === 'FLOOR') {
          hit.y = Math.min(1.35, 0.32 + (1.0 - Math.min(1, minD / 1.4)) * 0.85);
        } else if (this.surfaceMode === 'CEILING') {
          hit.y = Math.max(1.85, WALL_HEIGHT - 0.35 - (1.0 - Math.min(1, minD / 1.4)) * 0.75);
        }
        break;
      }
    }

    // Garante que nunca ultrapasse o alcance máximo da pata
    const dist = hit.distanceTo(root);
    if (dist > maxReach) {
      hit.sub(root).multiplyScalar(maxReach / dist).add(root);
      hit.y = Math.max(0.02, Math.min(WALL_HEIGHT - 0.02, hit.y));
    }

    return { hitPos: hit, isMetalOrCeiling };
  }

  /**
   * Impede que os joelhos/articulações intermediárias entrem em paredes, teto ou piso (`Unclip`).
   */
  private unclipIntermediateJoints(pts: THREE.Vector3[]): void {
    for (let i = 1; i < pts.length - 1; i++) {
      const p = pts[i];
      p.y = Math.max(0.05, Math.min(WALL_HEIGHT - 0.05, p.y));

      for (let c = 0; c < this.colliders.length; c++) {
        const b = this.colliders[c].box;
        const pad = 0.06;
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
   * Reconstrói in-place os vértices/normais/cores do tubo Catmull-Rom de 6 faces da pata
   * (`Flesh.Tube` + `LimbRadius` + `LimbColor` de `cl_init.lua`).
   */
  private rebuildLimbTubeMesh(
    spec: SpiderLimbSpec,
    rt: SpiderLimbRuntime
  ): void {
    const ik = rt.ikPoints;
    const nIk = ik.length;

    // 1. Amostra curva suave Catmull-Rom ao longo das articulações IK
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

      // Transporte paralelo da normal ao longo da pata curva (evita torções!)
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

      // Perfil de raio com leves nós articulares + ponta fina de agulha (`LimbRadius`)
      let radius = spec.baseWidth * (1 - 0.91 * Math.pow(f, 1.3));
      for (let k = 1; k < spec.segments; k++) {
        const d = (f - k / spec.segments) / 0.045;
        radius += spec.baseWidth * 0.16 * Math.exp(-d * d);
      }
      radius = Math.max(0.0055, radius);

      // Cor negra quitinosa que transita na ponta (`f^3`) para osso pálido (`BONE`)!
      const boneBlend = Math.pow(f, 3.2);
      const fleshR = 0.032 * spec.shade;
      const fleshG = 0.032 * spec.shade;
      const fleshB = 0.038 * spec.shade;
      const boneR = 0.62 * spec.shade;
      const boneG = 0.58 * spec.shade;
      const boneB = 0.52 * spec.shade;

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
