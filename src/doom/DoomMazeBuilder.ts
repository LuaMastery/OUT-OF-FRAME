import * as THREE from 'three';
import { StaticColliderBox } from '../engine/physics/SpatialSweep';
import {
  DoomArenaLayout,
  getOrCreateSceneArenaLayout,
} from './DoomArenaRandomizer';
import {
  createDoomSurfaceMaterial,
  DoomSharedUniforms,
  MAX_DOOM_LIGHTS,
} from './DoomShader';
import { DoomTextureSet } from './DoomTextures';

export interface DoomLightSource {
  position: THREE.Vector3;
  baseIntensity: number;
  flicker: boolean;
  phase: number;
  panelVertexStart: number;
  panelVertexCount: number;
}

export interface DoomLightFlickerSample {
  intensity: number;
  panelEmission: number;
  isDim: boolean;
}

/**
 * Avalia de forma determinística o estado instantâneo de piscada de uma luminária,
 * sincronizando exatamente a intensidade da luz projetada no ambiente E o brilho
 * do próprio painel/tubo de LED físico na parede ou no teto!
 */
export function evaluateDoomLightFlicker(
  src: Pick<DoomLightSource, 'baseIntensity' | 'flicker' | 'phase'>,
  elapsedSec: number
): DoomLightFlickerSample {
  if (!src.flicker) {
    return {
      intensity: src.baseIntensity,
      panelEmission: 1.0,
      isDim: false,
    };
  }

  const tick = Math.floor(elapsedSec * 12);
  const hash = Math.sin(tick * 12.9898 + src.phase * 78.233) * 43758.5453;
  const r = hash - Math.floor(hash);

  if (r < 0.06) {
    // Corte elétrico momentâneo: luz do corredor e painel de LED apagam juntos!
    return {
      intensity: src.baseIntensity * 0.05,
      panelEmission: 0.02,
      isDim: true,
    };
  }
  if (r < 0.17) {
    // Oscilação/queda forte de tensão: luz do corredor e LED enfraquecem juntos!
    return {
      intensity: src.baseIntensity * 0.34,
      panelEmission: 0.32,
      isDim: true,
    };
  }
  if (r < 0.22) {
    // Micro-tremulação sutil de reator cansado
    return {
      intensity: src.baseIntensity * 0.74,
      panelEmission: 0.72,
      isDim: false,
    };
  }

  return {
    intensity: src.baseIntensity,
    panelEmission: 1.0,
    isDim: false,
  };
}

/**
 * Atualiza os vértices do painel de LED correspondente a `src` em `MazeLightPanels`
 * para que o tubo/painel de LED pisque exatamente junto com a luz projetada no cenário.
 */
export function syncLightPanelEmissionAttribute(
  attr: THREE.BufferAttribute | null,
  src: Pick<DoomLightSource, 'panelVertexStart' | 'panelVertexCount'>,
  panelEmission: number
): boolean {
  if (!attr || src.panelVertexCount <= 0) return false;
  const arr = attr.array as Float32Array;
  const end = Math.min(arr.length, src.panelVertexStart + src.panelVertexCount);
  let changed = false;
  for (let v = src.panelVertexStart; v < end; v++) {
    if (Math.abs(arr[v] - panelEmission) > 1e-4) {
      arr[v] = panelEmission;
      changed = true;
    }
  }
  if (changed) {
    attr.needsUpdate = true;
  }
  return changed;
}

export interface DoomMazeResult {
  colliders: StaticColliderBox[];
  spawnPosition: THREE.Vector3;
  spawnYaw: number;
  lights: DoomLightSource[];
  lightPanelEmissionAttr: THREE.BufferAttribute | null;
  arenaLayout: DoomArenaLayout;
}

/**
 * Mapa 29x29 (87m x 87m — 451 células transitáveis em 5 grandes setores interligados)
 * do Complexo Subterrâneo estilo DOOM Clássico:
 * - Setor Noroeste (gx 0..10, gz 0..8)   : Esclusa de Chegada & Enfermaria Médica (STARTAN '#')
 * - Setor Nordeste (gx 18..28, gz 0..8)  : Salão dos Reatores & Subestação Energética (STARTAN '#' + 'M')
 * - Eixo Central   (gx 8..20, gz 8..15)  : Átrio de Comando, Logística Oeste & Paiol Leste
 * - Setor Sudoeste (gx 0..10, gz 16..28) : Galerias de Escavação & Cisterna Antiga (STONE 'B' + Madeira)
 * - Catacumbas Sul & Ala B (gx 11..28, gz 16..28): Grande Ninho da Aranha (14, 23) & Cripta Abobadada Leste
 *
 * Legenda:
 * - '#' : Parede industrial escura STARTAN (Complexo Técnico Norte, linhas 0..15)
 * - 'B' : Alvenaria subterrânea de pedra STONE (Escavações & Catacumbas Sul, linhas 16..28)
 * - 'M' : Coluna blindada estrutural de contenção
 * - 'L' : Bloco com arandela gradeada LITE5 iluminando os corredores adjacentes
 * - 'A' : Pórtico estrutural em arco com viga I, mãos-francesas e batentes de ferro
 * - 'P' : Ponto inicial do jogador (Esclusa Noroeste)
 * - '.' : Corredor / salão / câmara aberta
 */
export const LABYRINTH_MAP: string[] = [
  '###L#####L###L###L#####L#####', // 00
  '#.P.A...#.....#...#.A.......#', // 01
  '###.###.#.###.#.#.#.#.#####.#', // 02
  'L...#.....#.L...L.#.......#.L', // 03
  '#.#.#..M..#.#####.#...M...#.#', // 04
  '#.#.#.....A...#...A.......#.#', // 05
  '#.A.###L###.#.#.###.#.M.#L#.L', // 06
  '#.#...#.....#.......#...#.#.#', // 07
  '#.###.#.###L##A##L###.###.#.#', // 08
  'L.....A.#...........#.A...#.#', // 09
  '#.#####.#.#.M...M.#.#.#.###.L', // 10
  '#.....L.#.A.......A.#.L...#.#', // 11
  '###A#.#.#.#.M...M.#.#.###.#.#', // 12
  'L...#...#.#.......#.#...M...#', // 13
  '#.#.###.#.###LAL###.###.###.#', // 14
  '#.#.....A...........A.......L', // 15
  'B.BLBBBBB.BBBL.LBBBBB.BBBBBLB', // 16 — Divisória blindada Norte-Sul (início das Catacumbas)
  'B...B.....B.........B.......B', // 17
  'B.BBB.BBB.B.BB.BB.B.BBB.BBB.L', // 18
  'L.B.......A.......A.......B.B', // 19
  'B.B..B..B.BBBBABBBB.B...B.B.B', // 20
  'B.B.....L...BB.BB...L.....B.B', // 21 — (14, 21): Início do corredor reto de arrasto para o Ninho
  'B.BBB.BBBBB.BB.BB.BBB.B.B.B.L', // 22
  'L.......A...........A.....B.B', // 23 — (14, 23): Câmara Central do Grande Ninho da Aranha
  'B.BBB.BBBBB.BBABB.BBB.B...B.B', // 24
  'B...B...L...BB.BB...L.BBB.B.B', // 25
  'B.B.BBB.B.BBB...BBB.....B...B', // 26
  'B.......A...A...A...BBB...B.L', // 27
  'BBBLBBBBBLBBBBBBBLBBBBBLBBBBB', // 28
];

export const STONE_SECTOR_START_ROW = 16;
export const LAIR_GRID_CELL = { gx: 14, gz: 23 } as const;
export const DRAG_START_GRID_CELL = { gx: 14, gz: 21 } as const;
export const SPIDER_INITIAL_SPAWN_CELL = { gx: 23, gz: 23 } as const;
export const SPIDER_POST_ABDUCTION_CELL = { gx: 21, gz: 5 } as const;
export const INITIAL_WEB_TRAP_CELLS: ReadonlyArray<{ gx: number; gz: number }> = [
  { gx: 9, gz: 3 },
  { gx: 20, gz: 5 },
  { gx: 5, gz: 11 },
  { gx: 23, gz: 11 },
  { gx: 7, gz: 19 },
  { gx: 21, gz: 21 },
];

export const CELL_SIZE = 3.0;
export const WALL_HEIGHT = 3.2;

export function isSolidCell(grid: string[], gx: number, gz: number): boolean {
  if (gz < 0 || gz >= grid.length) return true;
  if (gx < 0 || gx >= grid[gz].length) return true;
  const ch = grid[gz][gx];
  return ch === '#' || ch === 'B' || ch === 'M' || ch === 'L';
}

export function isArchCell(grid: string[], gx: number, gz: number): boolean {
  if (gz < 0 || gz >= grid.length) return false;
  if (gx < 0 || gx >= grid[gz].length) return false;
  return grid[gz][gx] === 'A';
}

export function gridCellToWorld(
  gx: number,
  gz: number
): { x: number; z: number } {
  const rows = LABYRINTH_MAP.length;
  const cols = LABYRINTH_MAP[0].length;
  const halfW = cols * CELL_SIZE * 0.5;
  const halfD = rows * CELL_SIZE * 0.5;
  return {
    x: (gx + 0.5) * CELL_SIZE - halfW,
    z: (gz + 0.5) * CELL_SIZE - halfD,
  };
}

export function worldToGridCell(
  wx: number,
  wz: number
): { gx: number; gz: number } {
  const rows = LABYRINTH_MAP.length;
  const cols = LABYRINTH_MAP[0].length;
  const halfW = cols * CELL_SIZE * 0.5;
  const halfD = rows * CELL_SIZE * 0.5;
  return {
    gx: Math.floor((wx + halfW) / CELL_SIZE),
    gz: Math.floor((wz + halfD) / CELL_SIZE),
  };
}

export function isStoneSectorWorld(wx: number, wz: number): boolean {
  const { gz } = worldToGridCell(wx, wz);
  return gz >= STONE_SECTOR_START_ROW;
}

/**
 * Seleciona e envia para os uniforms do shader as luzes mais próximas do observador,
 * garantindo que todos os setores de um complexo enorme recebam iluminação real sem estourar MAX_DOOM_LIGHTS.
 */
export function syncNearestDoomLightsToUniforms(
  lights: ReadonlyArray<{ position: THREE.Vector3; intensity: number }>,
  viewerPos: THREE.Vector3,
  sharedUniforms: DoomSharedUniforms,
  maxSlots: number = MAX_DOOM_LIGHTS
): number {
  const limit = Math.max(0, Math.min(maxSlots, MAX_DOOM_LIGHTS));
  if (lights.length <= limit) {
    for (let i = 0; i < lights.length; i++) {
      sharedUniforms.uLightPositions.value[i].copy(lights[i].position);
      sharedUniforms.uLightIntensities.value[i] = lights[i].intensity;
    }
    sharedUniforms.uLightCount.value = lights.length;
    return lights.length;
  }

  const ranked = lights
    .map((l, idx) => {
      const dx = l.position.x - viewerPos.x;
      const dz = l.position.z - viewerPos.z;
      return { idx, d2: dx * dx + dz * dz };
    })
    .sort((a, b) => a.d2 - b.d2);

  for (let i = 0; i < limit; i++) {
    const src = lights[ranked[i].idx];
    sharedUniforms.uLightPositions.value[i].copy(src.position);
    sharedUniforms.uLightIntensities.value[i] = src.intensity;
  }
  sharedUniforms.uLightCount.value = limit;
  return limit;
}

/**
 * Funde BufferGeometries estáticas já transformadas em uma única malha por material,
 * mantendo alta riqueza arquitetônica 3D com custo mínimo de draw calls.
 */
function mergeStaticGeometries(
  geos: THREE.BufferGeometry[]
): THREE.BufferGeometry | null {
  if (geos.length === 0) return null;

  let totalVerts = 0;
  let totalIndices = 0;

  const nonIndexedFlags: boolean[] = [];
  for (const g of geos) {
    const pos = g.getAttribute('position');
    totalVerts += pos.count;
    const idx = g.getIndex();
    if (idx) {
      totalIndices += idx.count;
      nonIndexedFlags.push(false);
    } else {
      totalIndices += pos.count;
      nonIndexedFlags.push(true);
    }
  }

  const positions = new Float32Array(totalVerts * 3);
  const normals = new Float32Array(totalVerts * 3);
  const uvs = new Float32Array(totalVerts * 2);
  const indices =
    totalVerts > 65535
      ? new Uint32Array(totalIndices)
      : new Uint16Array(totalIndices);

  let vOffset = 0;
  let iOffset = 0;

  for (let gIdx = 0; gIdx < geos.length; gIdx++) {
    const g = geos[gIdx];
    const pos = g.getAttribute('position');
    const norm = g.getAttribute('normal');
    const uv = g.getAttribute('uv');
    const count = pos.count;

    for (let i = 0; i < count; i++) {
      positions[(vOffset + i) * 3] = pos.getX(i);
      positions[(vOffset + i) * 3 + 1] = pos.getY(i);
      positions[(vOffset + i) * 3 + 2] = pos.getZ(i);

      if (norm) {
        normals[(vOffset + i) * 3] = norm.getX(i);
        normals[(vOffset + i) * 3 + 1] = norm.getY(i);
        normals[(vOffset + i) * 3 + 2] = norm.getZ(i);
      } else {
        normals[(vOffset + i) * 3 + 1] = 1;
      }

      if (uv) {
        uvs[(vOffset + i) * 2] = uv.getX(i);
        uvs[(vOffset + i) * 2 + 1] = uv.getY(i);
      }
    }

    if (nonIndexedFlags[gIdx]) {
      for (let i = 0; i < count; i++) {
        indices[iOffset + i] = vOffset + i;
      }
      iOffset += count;
    } else {
      const idxAttr = g.getIndex()!;
      const ic = idxAttr.count;
      for (let i = 0; i < ic; i++) {
        indices[iOffset + i] = vOffset + idxAttr.getX(i);
      }
      iOffset += ic;
    }

    vOffset += count;
    g.dispose();
  }

  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  merged.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  merged.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  merged.setIndex(new THREE.BufferAttribute(indices, 1));
  merged.computeBoundingSphere();
  return merged;
}

function pushBox(
  bucket: THREE.BufferGeometry[],
  sx: number,
  sy: number,
  sz: number,
  px: number,
  py: number,
  pz: number,
  rx = 0,
  ry = 0,
  rz = 0
): void {
  const g = new THREE.BoxGeometry(sx, sy, sz);
  if (rx !== 0 || ry !== 0 || rz !== 0) {
    const m = new THREE.Matrix4().makeRotationFromEuler(
      new THREE.Euler(rx, ry, rz, 'YXZ')
    );
    g.applyMatrix4(m);
  }
  g.translate(px, py, pz);
  bucket.push(g);
}

function pushCylinder(
  bucket: THREE.BufferGeometry[],
  rTop: number,
  rBot: number,
  height: number,
  radialSegs: number,
  px: number,
  py: number,
  pz: number,
  rx = 0,
  ry = 0,
  rz = 0
): void {
  const g = new THREE.CylinderGeometry(rTop, rBot, height, radialSegs);
  if (rx !== 0 || ry !== 0 || rz !== 0) {
    const m = new THREE.Matrix4().makeRotationFromEuler(
      new THREE.Euler(rx, ry, rz, 'YXZ')
    );
    g.applyMatrix4(m);
  }
  g.translate(px, py, pz);
  bucket.push(g);
}

export function buildDoomLabyrinth(
  scene: THREE.Scene,
  textures: DoomTextureSet,
  sharedUniforms: DoomSharedUniforms,
  explicitArenaLayout?: DoomArenaLayout
): DoomMazeResult {
  const arenaLayout = getOrCreateSceneArenaLayout(scene, explicitArenaLayout);
  const rows = LABYRINTH_MAP.length;
  const cols = LABYRINTH_MAP[0].length;
  const halfW = cols * CELL_SIZE * 0.5;
  const halfD = rows * CELL_SIZE * 0.5;

  const cellToWorldX = (gx: number) => (gx + 0.5) * CELL_SIZE - halfW;
  const cellToWorldZ = (gz: number) => (gz + 0.5) * CELL_SIZE - halfD;

  // Materiais sombrios calibrados com luz base baixa para atmosfera real de terror e lanterna dramática
  const matStartan = createDoomSurfaceMaterial(
    textures.startanWall,
    sharedUniforms,
    { tileScaleXZ: CELL_SIZE, wallHeight: WALL_HEIGHT, baseLight: 0.21 }
  );
  const matStone = createDoomSurfaceMaterial(
    textures.stoneWall,
    sharedUniforms,
    { tileScaleXZ: CELL_SIZE, wallHeight: WALL_HEIGHT, baseLight: 0.19 }
  );
  const matMetal = createDoomSurfaceMaterial(
    textures.metalTrim,
    sharedUniforms,
    { tileScaleXZ: CELL_SIZE * 0.5, wallHeight: WALL_HEIGHT * 0.5, baseLight: 0.21 }
  );
  const matPillar = createDoomSurfaceMaterial(
    textures.pillarBulkhead,
    sharedUniforms,
    { tileScaleXZ: CELL_SIZE, wallHeight: WALL_HEIGHT, baseLight: 0.22 }
  );
  const matDarkIron = createDoomSurfaceMaterial(
    textures.darkIron,
    sharedUniforms,
    { tileScaleXZ: 1.5, wallHeight: 1.6, baseLight: 0.2 }
  );
  const matWood = createDoomSurfaceMaterial(
    textures.weatheredWood,
    sharedUniforms,
    { tileScaleXZ: 1.5, wallHeight: 1.6, baseLight: 0.2 }
  );
  // IMPORTANTE: useLocalUv = true garante que toda luminária fique 100% centralizada na moldura,
  // e useVertexEmission = true faz o próprio painel de LED piscar junto quando a luz falha!
  const matLightPanel = createDoomSurfaceMaterial(
    textures.lightPanel,
    sharedUniforms,
    {
      useLocalUv: true,
      fullBright: true,
      useVertexEmission: true,
      baseLight: 0.2,
    }
  );

  // Setor Norte (Bunker Industrial, linhas 0..8) vs Setor Sul (Catacumbas de Pedra & Ninho, linhas 9..14)
  const matNorthFloor = createDoomSurfaceMaterial(
    textures.floorTile,
    sharedUniforms,
    { tileScaleXZ: CELL_SIZE, wallHeight: WALL_HEIGHT, baseLight: 0.2 }
  );
  const matSouthFloor = createDoomSurfaceMaterial(
    textures.stoneFloor,
    sharedUniforms,
    { tileScaleXZ: CELL_SIZE, wallHeight: WALL_HEIGHT, baseLight: 0.18 }
  );
  const matNorthCeiling = createDoomSurfaceMaterial(
    textures.ceilingGrate,
    sharedUniforms,
    { tileScaleXZ: CELL_SIZE, wallHeight: WALL_HEIGHT, baseLight: 0.17 }
  );
  const matSouthCeiling = createDoomSurfaceMaterial(
    textures.stoneVaultCeiling,
    sharedUniforms,
    { tileScaleXZ: CELL_SIZE, wallHeight: WALL_HEIGHT, baseLight: 0.15 }
  );

  const root = new THREE.Group();
  root.name = 'DoomLabyrinth';
  scene.add(root);

  const colliders: StaticColliderBox[] = [];
  const lights: DoomLightSource[] = [];

  const startanGeos: THREE.BufferGeometry[] = [];
  const stoneGeos: THREE.BufferGeometry[] = [];
  const metalGeos: THREE.BufferGeometry[] = [];
  const pillarGeos: THREE.BufferGeometry[] = [];
  const darkIronGeos: THREE.BufferGeometry[] = [];
  const woodGeos: THREE.BufferGeometry[] = [];
  const lightGeos: THREE.BufferGeometry[] = [];
  let lightPanelVertexCursor = 0;

  // Divisão limpa de piso e teto entre o Complexo Industrial Norte (linhas 0..15) e as Catacumbas Sul (linhas 16..28)
  const totalW = cols * CELL_SIZE;
  const northRows = STONE_SECTOR_START_ROW;
  const southRows = rows - northRows;
  const northD = northRows * CELL_SIZE;
  const southD = southRows * CELL_SIZE;
  const northCenterZ = -halfD + northD * 0.5;
  const southCenterZ = -halfD + northD + southD * 0.5;

  const northFloorGeo = new THREE.PlaneGeometry(totalW, northD, cols * 2, northRows * 2);
  northFloorGeo.rotateX(-Math.PI * 0.5);
  const northFloorMesh = new THREE.Mesh(northFloorGeo, matNorthFloor);
  northFloorMesh.position.set(0, 0, northCenterZ);
  root.add(northFloorMesh);

  const southFloorGeo = new THREE.PlaneGeometry(totalW, southD, cols * 2, southRows * 2);
  southFloorGeo.rotateX(-Math.PI * 0.5);
  const southFloorMesh = new THREE.Mesh(southFloorGeo, matSouthFloor);
  southFloorMesh.position.set(0, 0, southCenterZ);
  root.add(southFloorMesh);

  const northCeilGeo = new THREE.PlaneGeometry(totalW, northD, cols * 2, northRows * 2);
  northCeilGeo.rotateX(Math.PI * 0.5);
  const northCeilMesh = new THREE.Mesh(northCeilGeo, matNorthCeiling);
  northCeilMesh.position.set(0, WALL_HEIGHT, northCenterZ);
  root.add(northCeilMesh);

  const southCeilGeo = new THREE.PlaneGeometry(totalW, southD, cols * 2, southRows * 2);
  southCeilGeo.rotateX(Math.PI * 0.5);
  const southCeilMesh = new THREE.Mesh(southCeilGeo, matSouthCeiling);
  southCeilMesh.position.set(0, WALL_HEIGHT, southCenterZ);
  root.add(southCeilMesh);

  const spawnPosition = arenaLayout.playerSpawnPosition.clone();
  const spawnYaw = arenaLayout.playerSpawnYaw;

  const half = CELL_SIZE * 0.5;

  // Células abertas verificadas que recebem plafons industriais no teto (livres de paredes, vigas e arcos!)
  const ceilingFixtureSpecs: ReadonlyArray<{
    gx: number;
    gz: number;
    intensity: number;
    flicker: boolean;
    phase: number;
  }> = [
    // Grande Átrio Central de Comando (7x5)
    { gx: 13, gz: 10, intensity: 0.58, flicker: false, phase: 0.4 },
    { gx: 15, gz: 10, intensity: 0.58, flicker: false, phase: 1.2 },
    { gx: 13, gz: 12, intensity: 0.58, flicker: false, phase: 2.1 },
    { gx: 15, gz: 12, intensity: 0.58, flicker: false, phase: 2.9 },
    // Salão dos Reatores Nordeste
    { gx: 21, gz: 3, intensity: 0.6, flicker: true, phase: 0.7 },
    { gx: 23, gz: 3, intensity: 0.6, flicker: false, phase: 1.9 },
    { gx: 21, gz: 5, intensity: 0.6, flicker: false, phase: 3.1 },
    { gx: 23, gz: 5, intensity: 0.6, flicker: true, phase: 4.3 },
    // Enfermaria Médica Noroeste
    { gx: 6, gz: 4, intensity: 0.56, flicker: false, phase: 0.9 },
    { gx: 8, gz: 4, intensity: 0.54, flicker: true, phase: 3.7 },
    // Cisterna Sudoeste & Cripta Abobadada Sudeste (Ala B)
    { gx: 6, gz: 19, intensity: 0.46, flicker: true, phase: 2.6 },
    { gx: 23, gz: 21, intensity: 0.46, flicker: true, phase: 4.8 },
  ];

  const ceilingFixtureCellKeys = new Set<string>(
    ceilingFixtureSpecs.map((s) => `${s.gx},${s.gz}`)
  );
  ceilingFixtureCellKeys.add(
    `${arenaLayout.lairCell.gx},${arenaLayout.lairCell.gz}`
  );

  const isLightCell = (cx: number, cz: number): boolean =>
    cz >= 0 && cz < rows && cx >= 0 && cx < cols && LABYRINTH_MAP[cz][cx] === 'L';

  for (let gz = 0; gz < rows; gz++) {
    for (let gx = 0; gx < cols; gx++) {
      const ch = LABYRINTH_MAP[gz][gx];
      const wx = cellToWorldX(gx);
      const wz = cellToWorldZ(gz);

      // ======================================================================
      // 1. VÃOS ABERTOS ('.' / 'P'): VIGAS, TUBULAÇÕES E QUADROS DE MINA SEM COLISÃO
      // ======================================================================
      if (ch === '.' || ch === 'P') {
        if (ceilingFixtureCellKeys.has(`${gx},${gz}`)) {
          continue;
        }

        const solidN = isSolidCell(LABYRINTH_MAP, gx, gz - 1);
        const solidS = isSolidCell(LABYRINTH_MAP, gx, gz + 1);
        const solidW = isSolidCell(LABYRINTH_MAP, gx - 1, gz);
        const solidE = isSolidCell(LABYRINTH_MAP, gx + 1, gz);
        const isSouthStone = gz >= STONE_SECTOR_START_ROW;

        // Verifica se é possível erguer um quadro de madeira de mina sem jamais tocar em luminárias 'L'
        const canPlaceTimberWE =
          isSouthStone &&
          solidW &&
          solidE &&
          !isLightCell(gx - 1, gz) &&
          !isLightCell(gx + 1, gz) &&
          (gx * 3 + gz * 5) % 4 === 0;

        const canPlaceTimberNS =
          isSouthStone &&
          !canPlaceTimberWE &&
          solidN &&
          solidS &&
          !isLightCell(gx, gz - 1) &&
          !isLightCell(gx, gz + 1) &&
          (gx * 5 + gz * 3) % 4 === 0;

        if (canPlaceTimberWE || canPlaceTimberNS) {
          // Quadro de escoramento de madeira com carpintaria limpa (sapatas de ferro, esteios recuados do rodapé,
          // viga mestra apoiada sobre os esteios abaixo da sanca, mãos-francesas e cintas de ferro — ZERO Z-fighting!)
          const postOffset = half - 0.14; // [1.28..1.44] -> livre do rodapé de 0.052m!
          const shoeH = 0.1;
          const postH = 2.74; // y: 0.10 .. 2.84
          const capH = 0.18; // y: 2.84 .. 3.02 (abaixo da sanca superior 3.05..3.20!)
          const spanLen = postOffset * 2 + 0.18; // 2.90m cobrindo exatamente o topo dos dois esteios!

          if (canPlaceTimberWE) {
            pushBox(woodGeos, spanLen, capH, 0.18, wx, shoeH + postH + capH * 0.5, wz);
            for (const sign of [-1, 1]) {
              const px = wx + sign * postOffset;
              pushBox(darkIronGeos, 0.19, shoeH, 0.21, px, shoeH * 0.5, wz);
              pushBox(woodGeos, 0.16, postH, 0.17, px, shoeH + postH * 0.5, wz);
              // Cinta de ferro abraçando o encontro esteio-viga
              pushBox(darkIronGeos, 0.19, 0.06, 0.2, px, shoeH + postH, wz);
              // Mão-francesa escalonada interna sem rotação diagonal quebrada
              pushBox(
                woodGeos,
                0.16,
                0.14,
                0.13,
                px - sign * 0.16,
                shoeH + postH - 0.07,
                wz
              );
              pushBox(
                woodGeos,
                0.09,
                0.11,
                0.13,
                px - sign * 0.125,
                shoeH + postH - 0.195,
                wz
              );
            }
          } else {
            pushBox(woodGeos, 0.18, capH, spanLen, wx, shoeH + postH + capH * 0.5, wz);
            for (const sign of [-1, 1]) {
              const pz = wz + sign * postOffset;
              pushBox(darkIronGeos, 0.21, shoeH, 0.19, wx, shoeH * 0.5, pz);
              pushBox(woodGeos, 0.17, postH, 0.16, wx, shoeH + postH * 0.5, pz);
              pushBox(darkIronGeos, 0.2, 0.06, 0.19, wx, shoeH + postH, pz);
              pushBox(
                woodGeos,
                0.13,
                0.14,
                0.16,
                wx,
                shoeH + postH - 0.07,
                pz - sign * 0.16
              );
              pushBox(
                woodGeos,
                0.13,
                0.11,
                0.09,
                wx,
                shoeH + postH - 0.195,
                pz - sign * 0.125
              );
            }
          }
          continue;
        }

        if (solidN && solidS) {
          // Viga transversal de teto apenas quando NÃO há luminária 'L' nas paredes onde apoia
          if (
            (gx + gz) % 2 === 0 &&
            !isLightCell(gx, gz - 1) &&
            !isLightCell(gx, gz + 1)
          ) {
            pushBox(
              isSouthStone ? stoneGeos : metalGeos,
              0.22,
              0.16,
              CELL_SIZE - 0.14,
              wx,
              WALL_HEIGHT - 0.085,
              wz
            );
            pushBox(
              darkIronGeos,
              0.26,
              0.04,
              CELL_SIZE - 0.12,
              wx,
              WALL_HEIGHT - 0.185,
              wz
            );
          }
          if (!isSouthStone && !isLightCell(gx, gz - 1)) {
            pushCylinder(
              darkIronGeos,
              0.045,
              0.045,
              CELL_SIZE,
              8,
              wx,
              WALL_HEIGHT - 0.27,
              wz - half + 0.22,
              0,
              0,
              Math.PI * 0.5
            );
            pushBox(
              darkIronGeos,
              0.07,
              0.22,
              0.11,
              wx,
              WALL_HEIGHT - 0.15,
              wz - half + 0.22
            );
          }
        } else if (solidW && solidE) {
          if (
            (gx + gz) % 2 === 0 &&
            !isLightCell(gx - 1, gz) &&
            !isLightCell(gx + 1, gz)
          ) {
            pushBox(
              isSouthStone ? stoneGeos : metalGeos,
              CELL_SIZE - 0.14,
              0.16,
              0.22,
              wx,
              WALL_HEIGHT - 0.085,
              wz
            );
            pushBox(
              darkIronGeos,
              CELL_SIZE - 0.12,
              0.04,
              0.26,
              wx,
              WALL_HEIGHT - 0.185,
              wz
            );
          }
          if (!isSouthStone && !isLightCell(gx - 1, gz)) {
            pushCylinder(
              darkIronGeos,
              0.045,
              0.045,
              CELL_SIZE,
              8,
              wx - half + 0.22,
              WALL_HEIGHT - 0.27,
              wz,
              Math.PI * 0.5,
              0,
              0
            );
            pushBox(
              darkIronGeos,
              0.11,
              0.22,
              0.07,
              wx - half + 0.22,
              WALL_HEIGHT - 0.15,
              wz
            );
          }
        }
        continue;
      }

      // ======================================================================
      // 2. PÓRTICOS EM ARCO ESCULPIDOS ('A' — GEOMETRIA LIMPA SEM Z-FIGHTING)
      // ======================================================================
      if (ch === 'A') {
        const northSouthWalls =
          isSolidCell(LABYRINTH_MAP, gx, gz - 1) &&
          isSolidCell(LABYRINTH_MAP, gx, gz + 1);

        // Alturas não-sobrepostas milimetricamente para eliminar 100% de Z-fighting:
        // Plinto: [0.004..0.22] | Coluna: [0.22..2.56] | Flange inf.: [2.56..2.63] | Viga: [2.63..3.194]
        const plinthH = 0.216;
        const jambBottom = 0.22;
        const archClearH = 2.56;
        const jambH = archClearH - jambBottom; // 2.34m
        const flangeH = 0.07; // [2.56..2.63]
        const lintelTop = WALL_HEIGHT - 0.006; // 3.194m (abaixo do teto!)
        const lintelH = lintelTop - (archClearH + flangeH); // 0.564m
        const jambThick = 0.25;
        const spanFull = CELL_SIZE - 0.012; // 2.988m (encosta nas paredes sem coplanaridade)

        if (northSouthWalls) {
          pushBox(
            metalGeos,
            0.46,
            lintelH,
            spanFull,
            wx,
            archClearH + flangeH + lintelH * 0.5,
            wz
          );
          pushBox(
            darkIronGeos,
            0.52,
            flangeH,
            spanFull - 0.004,
            wx,
            archClearH + flangeH * 0.5,
            wz
          );
          // Chave central rebitada (estritamente dentro de [2.54..3.19], mais larga em X para zero Z-fighting)
          pushBox(
            darkIronGeos,
            0.56,
            lintelTop - 2.54 - 0.004,
            0.34,
            wx,
            (2.54 + lintelTop - 0.004) * 0.5,
            wz
          );

          for (const sign of [-1, 1]) {
            const jz = wz + sign * (half - jambThick * 0.5 - 0.004);
            pushBox(
              metalGeos,
              0.44,
              jambH,
              jambThick,
              wx,
              jambBottom + jambH * 0.5,
              jz
            );
            // Plinto inferior mais largo que o rodapé da parede para acabamento limpo
            pushBox(
              darkIronGeos,
              0.52,
              plinthH,
              jambThick + 0.05,
              wx,
              0.004 + plinthH * 0.5,
              wz + sign * (half - (jambThick + 0.05) * 0.5 - 0.004)
            );
            // Anel mediano rebitado
            pushBox(
              darkIronGeos,
              0.48,
              0.08,
              jambThick + 0.03,
              wx,
              1.36,
              wz + sign * (half - (jambThick + 0.03) * 0.5 - 0.004)
            );
            // Mísulas escalonadas brutalistas nos cantos superiores (sem caixas giradas atravessando faces!)
            const innerFaceZ = wz + sign * (half - jambThick - 0.004);
            pushBox(
              darkIronGeos,
              0.4,
              0.12,
              0.22,
              wx,
              archClearH - 0.06,
              innerFaceZ - sign * 0.11
            );
            pushBox(
              darkIronGeos,
              0.38,
              0.11,
              0.12,
              wx,
              archClearH - 0.175,
              innerFaceZ - sign * 0.06
            );
          }
        } else {
          pushBox(
            metalGeos,
            spanFull,
            lintelH,
            0.46,
            wx,
            archClearH + flangeH + lintelH * 0.5,
            wz
          );
          pushBox(
            darkIronGeos,
            spanFull - 0.004,
            flangeH,
            0.52,
            wx,
            archClearH + flangeH * 0.5,
            wz
          );
          pushBox(
            darkIronGeos,
            0.34,
            lintelTop - 2.54 - 0.004,
            0.56,
            wx,
            (2.54 + lintelTop - 0.004) * 0.5,
            wz
          );

          for (const sign of [-1, 1]) {
            const jx = wx + sign * (half - jambThick * 0.5 - 0.004);
            pushBox(
              metalGeos,
              jambThick,
              jambH,
              0.44,
              jx,
              jambBottom + jambH * 0.5,
              wz
            );
            pushBox(
              darkIronGeos,
              jambThick + 0.05,
              plinthH,
              0.52,
              wx + sign * (half - (jambThick + 0.05) * 0.5 - 0.004),
              0.004 + plinthH * 0.5,
              wz
            );
            pushBox(
              darkIronGeos,
              jambThick + 0.03,
              0.08,
              0.48,
              wx + sign * (half - (jambThick + 0.03) * 0.5 - 0.004),
              1.36,
              wz
            );
            const innerFaceX = wx + sign * (half - jambThick - 0.004);
            pushBox(
              darkIronGeos,
              0.22,
              0.12,
              0.4,
              innerFaceX - sign * 0.11,
              archClearH - 0.06,
              wz
            );
            pushBox(
              darkIronGeos,
              0.12,
              0.11,
              0.38,
              innerFaceX - sign * 0.06,
              archClearH - 0.175,
              wz
            );
          }
        }
        continue;
      }

      if (!isSolidCell(LABYRINTH_MAP, gx, gz)) {
        continue;
      }

      // ======================================================================
      // 3. BLOCOS SÓLIDOS DE PAREDE + RODAPÉS, SANCAS E PILASTRAS SEM Z-FIGHTING
      // ======================================================================
      const isStoneBlock =
        ch === 'B' || (ch === 'L' && gz >= STONE_SECTOR_START_ROW);
      const isMetalPillar = ch === 'M';
      const wallBucket = isMetalPillar
        ? pillarGeos
        : isStoneBlock
          ? stoneGeos
          : startanGeos;

      pushBox(
        wallBucket,
        CELL_SIZE,
        WALL_HEIGHT,
        CELL_SIZE,
        wx,
        WALL_HEIGHT * 0.5,
        wz
      );

      colliders.push({
        id: `wall-${gx}-${gz}`,
        box: new THREE.Box3(
          new THREE.Vector3(wx - half, 0, wz - half),
          new THREE.Vector3(wx + half, WALL_HEIGHT, wz + half)
        ),
      });

      const openN = !isSolidCell(LABYRINTH_MAP, gx, gz - 1);
      const openS = !isSolidCell(LABYRINTH_MAP, gx, gz + 1);
      const openW = !isSolidCell(LABYRINTH_MAP, gx - 1, gz);
      const openE = !isSolidCell(LABYRINTH_MAP, gx + 1, gz);

      const faceDirs: Array<{
        open: boolean;
        nx: number;
        nz: number;
        rotY: number;
      }> = [
        { open: openN, nx: 0, nz: -1, rotY: Math.PI },
        { open: openS, nx: 0, nz: 1, rotY: 0 },
        { open: openW, nx: -1, nz: 0, rotY: -Math.PI * 0.5 },
        { open: openE, nx: 1, nz: 0, rotY: Math.PI * 0.5 },
      ];

      // Rodapés e sancas em ferro escuro limpo (recuados nas pontas e sem cruzar pórticos 'A'!)
      for (const fd of faceDirs) {
        if (!fd.open) continue;
        const nGx = gx + fd.nx;
        const nGz = gz + fd.nz;
        const neighborCh =
          nGz >= 0 && nGz < rows && nGx >= 0 && nGx < cols
            ? LABYRINTH_MAP[nGz][nGx]
            : '#';
        const facesArch = neighborCh === 'A';

        const fx = wx + fd.nx * (half + 0.026);
        const fz = wz + fd.nz * (half + 0.026);

        if (facesArch) {
          // Nas paredes laterais de um arco 'A', divide o rodapé/sanca nos dois vãos externos ao redor da coluna central (0.54m)
          const segSpan = (CELL_SIZE - 0.56) * 0.5 - 0.01;
          const segOffset = 0.28 + segSpan * 0.5;
          for (const side of [-1, 1]) {
            const ox = fd.nx === 0 ? side * segOffset : 0;
            const oz = fd.nz === 0 ? side * segOffset : 0;
            const sx = fd.nx === 0 ? segSpan : 0.052;
            const sz = fd.nz === 0 ? segSpan : 0.052;
            pushBox(darkIronGeos, sx, 0.16, sz, fx + ox, 0.08, fz + oz);
            pushBox(
              darkIronGeos,
              sx,
              0.15,
              sz,
              fx + ox,
              WALL_HEIGHT - 0.075,
              fz + oz
            );
          }
          continue;
        }

        const span = CELL_SIZE - 0.02;
        const sx = fd.nx === 0 ? span : 0.052;
        const sz = fd.nz === 0 ? span : 0.052;

        // Rodapé inferior escuro
        pushBox(darkIronGeos, sx, 0.16, sz, fx, 0.08, fz);
        // Sanca superior escura
        pushBox(darkIronGeos, sx, 0.15, sz, fx, WALL_HEIGHT - 0.075, fz);

        // Tubulação vertical com caixa de passagem em ferro escuro (apenas em paredes '#' livres)
        if (
          ch === '#' &&
          (gx * 3 + gz * 5 + (fd.nx + 2) + (fd.nz + 2)) % 6 === 0
        ) {
          const pipeOff = 0.64;
          const px =
            wx + fd.nx * (half + 0.048) + (fd.nz !== 0 ? pipeOff : 0);
          const pz =
            wz + fd.nz * (half + 0.048) + (fd.nx !== 0 ? pipeOff : 0);
          pushCylinder(
            darkIronGeos,
            0.042,
            0.042,
            WALL_HEIGHT - 0.34,
            8,
            px,
            WALL_HEIGHT * 0.5,
            pz
          );
          pushCylinder(darkIronGeos, 0.064, 0.064, 0.07, 8, px, 1.05, pz);
          pushCylinder(darkIronGeos, 0.064, 0.064, 0.07, 8, px, 2.22, pz);
          pushBox(
            darkIronGeos,
            fd.nx === 0 ? 0.28 : 0.075,
            0.34,
            fd.nz === 0 ? 0.28 : 0.075,
            wx + fd.nx * (half + 0.038) - (fd.nz !== 0 ? 0.44 : 0),
            1.44,
            wz + fd.nz * (half + 0.038) - (fd.nx !== 0 ? 0.44 : 0)
          );
        }
      }

      // Pilastras estruturais nos cantos externos expostos E em toda a divisória Norte-Sul (gz === 15/16)
      const isTransitionRow =
        gz === STONE_SECTOR_START_ROW - 1 || gz === STONE_SECTOR_START_ROW;
      const corners: Array<[boolean, number, number]> = [
        [(openN && openW) || (isTransitionRow && (openN || openW)), -half, -half],
        [(openN && openE) || (isTransitionRow && (openN || openE)), half, -half],
        [(openS && openW) || (isTransitionRow && (openS || openW)), -half, half],
        [(openS && openE) || (isTransitionRow && (openS || openE)), half, half],
      ];
      for (const [exposed, ox, oz] of corners) {
        if (!exposed) continue;
        const cx = wx + ox;
        const cz = wz + oz;
        pushBox(metalGeos, 0.24, WALL_HEIGHT, 0.24, cx, WALL_HEIGHT * 0.5, cz);
        pushBox(darkIronGeos, 0.31, 0.24, 0.31, cx, 0.12, cz);
        pushBox(
          darkIronGeos,
          0.31,
          0.22,
          0.31,
          cx,
          WALL_HEIGHT - 0.11,
          cz
        );
      }

      // ======================================================================
      // 4. ARANDELAS DE PAREDE 3D GRADEADAS ('L' — MOLDURA REFINADA E SEM COLISÃO)
      // ======================================================================
      if (ch === 'L') {
        // Monta luminárias APENAS para corredores abertos '.' ou 'P' (nunca dentro de pórticos 'A' nem fora da borda!)
        const interiorOpenFaces = faceDirs.filter((d) => {
          if (!d.open) return false;
          const nGx = gx + d.nx;
          const nGz = gz + d.nz;
          if (nGx < 0 || nGx >= cols || nGz < 0 || nGz >= rows) return false;
          const nCh = LABYRINTH_MAP[nGz][nGx];
          return nCh === '.' || nCh === 'P';
        });

        const activeFaces = interiorOpenFaces.slice(0, 2);
        for (const d of activeFaces) {
          // Geometria sem sobreposição de cantos:
          // Painel LITE5: largura 0.72 ([-0.36..+0.36]), altura 1.64 ([0.82..2.46])
          // Montantes laterais: [-0.44..-0.36] e [+0.36..+0.44], altura exata 1.64 ([0.82..2.46])
          // Coifas superior/inferior: [-0.46..+0.46], y=[2.46..2.55] e y=[0.73..0.82] (ZERO interseção!)
          const glassW = 0.72;
          const glassH = 1.64;
          const centerY = 1.64;
          const jambW = 0.08;
          const frameDepth = 0.078;

          const panel = new THREE.PlaneGeometry(glassW, glassH);
          if (d.rotY !== 0) panel.rotateY(d.rotY);
          panel.translate(
            wx + d.nx * (half + 0.02),
            centerY,
            wz + d.nz * (half + 0.02)
          );
          const panelVertCount = panel.getAttribute('position').count;
          const panelVertStart = lightPanelVertexCursor;
          lightPanelVertexCursor += panelVertCount;
          lightGeos.push(panel);

          const outX = wx + d.nx * (half + frameDepth * 0.5 + 0.002);
          const outZ = wz + d.nz * (half + frameDepth * 0.5 + 0.002);
          const hoodOutX = wx + d.nx * (half + (frameDepth + 0.024) * 0.5 + 0.002);
          const hoodOutZ = wz + d.nz * (half + (frameDepth + 0.024) * 0.5 + 0.002);
          const trimOutX = wx + d.nx * (half + 0.034);
          const trimOutZ = wz + d.nz * (half + 0.034);
          const louverOutX = wx + d.nx * (half + frameDepth - 0.016);
          const louverOutZ = wz + d.nz * (half + frameDepth - 0.016);

          if (d.nx === 0) {
            // Coifas superior e inferior chanfradas em degrau (sem invadir os montantes laterais!)
            pushBox(darkIronGeos, 0.92, 0.09, frameDepth + 0.024, hoodOutX, 2.505, hoodOutZ);
            pushBox(darkIronGeos, 0.92, 0.09, frameDepth + 0.024, hoodOutX, 0.775, hoodOutZ);
            pushBox(metalGeos, 0.76, 0.024, 0.032, trimOutX, 2.448, trimOutZ);
            pushBox(metalGeos, 0.76, 0.024, 0.032, trimOutX, 0.832, trimOutZ);

            // Montantes verticais esquerdo e direito (estritamente entre 0.82 e 2.46)
            pushBox(darkIronGeos, jambW, glassH, frameDepth, outX - 0.4, centerY, outZ);
            pushBox(darkIronGeos, jambW, glassH, frameDepth, outX + 0.4, centerY, outZ);

            // Aletas horizontais embutidas dentro do vão livre (0.716m < 0.72m -> sem pontas saltando para fora!)
            for (const gy of [1.22, 1.64, 2.06]) {
              pushBox(darkIronGeos, glassW - 0.004, 0.032, 0.026, louverOutX, gy, louverOutZ);
            }
          } else {
            pushBox(darkIronGeos, frameDepth + 0.024, 0.09, 0.92, hoodOutX, 2.505, hoodOutZ);
            pushBox(darkIronGeos, frameDepth + 0.024, 0.09, 0.92, hoodOutX, 0.775, hoodOutZ);
            pushBox(metalGeos, 0.032, 0.024, 0.76, trimOutX, 2.448, trimOutZ);
            pushBox(metalGeos, 0.032, 0.024, 0.76, trimOutX, 0.832, trimOutZ);

            pushBox(darkIronGeos, frameDepth, glassH, jambW, outX, centerY, outZ - 0.4);
            pushBox(darkIronGeos, frameDepth, glassH, jambW, outX, centerY, outZ + 0.4);

            for (const gy of [1.22, 1.64, 2.06]) {
              pushBox(darkIronGeos, 0.026, 0.032, glassW - 0.004, louverOutX, gy, louverOutZ);
            }
          }

          // Eletroduto vertical ligando a coifa superior (2.55) até a base da sanca (3.05) + bucha de união
          const condX = wx + d.nx * (half + 0.038);
          const condZ = wz + d.nz * (half + 0.038);
          pushCylinder(darkIronGeos, 0.026, 0.026, 0.49, 6, condX, 2.8, condZ);
          pushCylinder(metalGeos, 0.042, 0.042, 0.045, 6, condX, 2.575, condZ);

          lights.push({
            position: new THREE.Vector3(
              wx + d.nx * (half + 1.05),
              1.72,
              wz + d.nz * (half + 1.05)
            ),
            baseIntensity: 0.62,
            flicker: (gx + gz) % 3 === 0,
            phase: gx * 1.7 + gz * 2.3 + d.nx * 0.8 + d.nz * 1.1,
            panelVertexStart: panelVertStart,
            panelVertexCount: panelVertCount,
          });
        }
      }
    }
  }

  // ==========================================================================
  // 5. MARCOS ARQUITETÔNICOS 3D & PLAFONS INDUSTRIAIS NOS 5 GRANDES SETORES
  // ==========================================================================
  const addCeilingFixture = (
    gx: number,
    gz: number,
    intensity: number,
    flicker: boolean,
    phase: number
  ) => {
    const lx = cellToWorldX(gx);
    const lz = cellToWorldZ(gz);

    // Painel 1.16 x 1.16 centralizado em célula aberta 3.0 x 3.0 (folga > 0.84m de qualquer parede!)
    const panelSize = 1.16;
    const frameThick = 0.08;
    const halfPanel = panelSize * 0.5; // 0.58m
    const railOffset = halfPanel + frameThick * 0.5; // 0.62m
    const outerSpan = panelSize + frameThick * 2; // 1.32m

    const ceilLight = new THREE.PlaneGeometry(panelSize, panelSize);
    ceilLight.rotateX(Math.PI * 0.5);
    ceilLight.translate(lx, WALL_HEIGHT - 0.062, lz);
    const ceilVertCount = ceilLight.getAttribute('position').count;
    const ceilVertStart = lightPanelVertexCursor;
    lightPanelVertexCursor += ceilVertCount;
    lightGeos.push(ceilLight);

    // Moldura externa sem interseção nos 4 cantos: trilhos N/S cobrem outerSpan, L/O ficam estritamente entre eles
    pushBox(darkIronGeos, outerSpan, 0.085, frameThick, lx, WALL_HEIGHT - 0.044, lz - railOffset);
    pushBox(darkIronGeos, outerSpan, 0.085, frameThick, lx, WALL_HEIGHT - 0.044, lz + railOffset);
    pushBox(darkIronGeos, frameThick, 0.085, panelSize, lx - railOffset, WALL_HEIGHT - 0.044, lz);
    pushBox(darkIronGeos, frameThick, 0.085, panelSize, lx + railOffset, WALL_HEIGHT - 0.044, lz);

    // Cruzeta interna embutida sem atravessar os trilhos externos
    pushBox(darkIronGeos, panelSize - 0.008, 0.028, 0.044, lx, WALL_HEIGHT - 0.078, lz);
    pushBox(darkIronGeos, 0.044, 0.028, panelSize - 0.008, lx, WALL_HEIGHT - 0.078, lz);

    lights.push({
      position: new THREE.Vector3(lx, 2.35, lz),
      baseIntensity: intensity,
      flicker,
      phase,
      panelVertexStart: ceilVertStart,
      panelVertexCount: ceilVertCount,
    });
  };

  for (const spec of ceilingFixtureSpecs) {
    addCeilingFixture(spec.gx, spec.gz, spec.intensity, spec.flicker, spec.phase);
  }

  // A) Grande Átrio Central de Comando (gx=14, gz=11 — vigas aéreas estritamente nos eixos livres gx=14 e gz=11)
  const atriumX = cellToWorldX(14);
  const atriumZ = cellToWorldZ(11);
  pushBox(metalGeos, 20.4, 0.17, 0.32, atriumX, WALL_HEIGHT - 0.09, atriumZ);
  pushBox(metalGeos, 0.32, 0.17, 14.4, atriumX, WALL_HEIGHT - 0.09, atriumZ);
  pushBox(darkIronGeos, 20.4, 0.045, 0.4, atriumX, WALL_HEIGHT - 0.195, atriumZ);
  pushBox(darkIronGeos, 0.4, 0.045, 14.4, atriumX, WALL_HEIGHT - 0.195, atriumZ);

  // B) Salão dos Reatores Nordeste (colunas M em (22, 4) e (22, 6) com barramento energético aéreo)
  const reactorX = cellToWorldX(22);
  const reactorMidZ = cellToWorldZ(5);
  for (const rgz of [4, 6]) {
    const rz = cellToWorldZ(rgz);
    for (const ry of [0.55, 1.6, 2.65]) {
      pushBox(darkIronGeos, 3.36, 0.16, 3.36, reactorX, ry, rz);
      pushBox(metalGeos, 3.44, 0.07, 3.44, reactorX, ry + 0.09, rz);
    }
  }
  // Dutos gêmeos de turbina no teto interligando os dois núcleos do reator (y = 2.86m -> livre de plafons!)
  for (const busOx of [-0.65, 0.65]) {
    pushCylinder(
      darkIronGeos,
      0.16,
      0.16,
      CELL_SIZE * 1.9,
      10,
      reactorX + busOx,
      WALL_HEIGHT - 0.34,
      reactorMidZ,
      Math.PI * 0.5,
      0,
      0
    );
    pushBox(
      metalGeos,
      0.42,
      0.24,
      0.28,
      reactorX + busOx,
      WALL_HEIGHT - 0.15,
      reactorMidZ
    );
  }

  // E) Luminária industrial antiga suspensa e torta no teto do Grande Ninho da Aranha (câmara aleatória da partida)
  const lairX = cellToWorldX(arenaLayout.lairCell.gx);
  const lairZ = cellToWorldZ(arenaLayout.lairCell.gz);
  pushCylinder(
    darkIronGeos,
    0.036,
    0.036,
    0.26,
    6,
    lairX,
    WALL_HEIGHT - 0.13,
    lairZ
  );
  pushBox(
    darkIronGeos,
    1.16,
    0.09,
    1.16,
    lairX,
    WALL_HEIGHT - 0.25,
    lairZ,
    0.06,
    0.18,
    -0.05
  );
  const lairCeilLight = new THREE.PlaneGeometry(0.98, 0.98);
  lairCeilLight.rotateX(Math.PI * 0.5);
  lairCeilLight.translate(0, -0.052, 0);
  const tiltMat = new THREE.Matrix4().makeRotationFromEuler(
    new THREE.Euler(0.06, 0.18, -0.05, 'YXZ')
  );
  lairCeilLight.applyMatrix4(tiltMat);
  lairCeilLight.translate(lairX, WALL_HEIGHT - 0.25, lairZ);
  const lairVertCount = lairCeilLight.getAttribute('position').count;
  const lairVertStart = lightPanelVertexCursor;
  lightPanelVertexCursor += lairVertCount;
  lightGeos.push(lairCeilLight);

  lights.push({
    position: new THREE.Vector3(lairX, 2.35, lairZ),
    baseIntensity: 0.48,
    flicker: true,
    phase: 5.1,
    panelVertexStart: lairVertStart,
    panelVertexCount: lairVertCount,
  });

  // Consolida as malhas estáticas na cena
  const buckets: Array<[THREE.BufferGeometry[], THREE.Material, string]> = [
    [startanGeos, matStartan, 'MazeWallsStartan'],
    [stoneGeos, matStone, 'MazeWallsStone'],
    [metalGeos, matMetal, 'MazeTrimMetal'],
    [pillarGeos, matPillar, 'MazeBulkheadPillar'],
    [darkIronGeos, matDarkIron, 'MazeDetailsDarkIron'],
    [woodGeos, matWood, 'MazePropsWood'],
    [lightGeos, matLightPanel, 'MazeLightPanels'],
  ];

  let lightPanelEmissionAttr: THREE.BufferAttribute | null = null;
  for (const [geos, mat, name] of buckets) {
    const merged = mergeStaticGeometries(geos);
    if (merged) {
      if (name === 'MazeLightPanels') {
        const totalLightVerts = merged.getAttribute('position').count;
        const emissionData = new Float32Array(totalLightVerts);
        emissionData.fill(1.0);
        lightPanelEmissionAttr = new THREE.BufferAttribute(emissionData, 1);
        lightPanelEmissionAttr.setUsage(THREE.DynamicDrawUsage);
        merged.setAttribute('aLightEmission', lightPanelEmissionAttr);
      }
      const m = new THREE.Mesh(merged, mat);
      m.name = name;
      root.add(m);
    }
  }

  syncNearestDoomLightsToUniforms(
    lights.map((l) => ({ position: l.position, intensity: l.baseIntensity })),
    spawnPosition,
    sharedUniforms,
    MAX_DOOM_LIGHTS
  );

  return {
    colliders,
    spawnPosition,
    spawnYaw,
    lights,
    lightPanelEmissionAttr,
    arenaLayout,
  };
}
