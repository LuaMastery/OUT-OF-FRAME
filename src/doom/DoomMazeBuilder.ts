import * as THREE from 'three';
import { StaticColliderBox } from '../engine/physics/SpatialSweep';
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
}

export interface DoomMazeResult {
  colliders: StaticColliderBox[];
  spawnPosition: THREE.Vector3;
  spawnYaw: number;
  lights: DoomLightSource[];
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
  sharedUniforms: DoomSharedUniforms
): DoomMazeResult {
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
  // IMPORTANTE: useLocalUv = true garante que toda luminária fique 100% centralizada na moldura!
  const matLightPanel = createDoomSurfaceMaterial(
    textures.lightPanel,
    sharedUniforms,
    { useLocalUv: true, fullBright: true }
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

  let spawnPosition = new THREE.Vector3(0, 0, 0);
  const spawnYaw = -Math.PI * 0.5; // Olhando para Leste (+X) ao longo do corredor inicial

  const half = CELL_SIZE * 0.5;

  for (let gz = 0; gz < rows; gz++) {
    for (let gx = 0; gx < cols; gx++) {
      const ch = LABYRINTH_MAP[gz][gx];
      const wx = cellToWorldX(gx);
      const wz = cellToWorldZ(gz);

      if (ch === 'P') {
        spawnPosition = new THREE.Vector3(wx, 0, wz);
      }

      // ======================================================================
      // 1. VÃOS ABERTOS ('.' / 'P'): VIGAS ESPAÇADAS E ELETRODUTOS SEM COLISÃO VISUAL
      // ======================================================================
      if (ch === '.' || ch === 'P') {
        const solidN = isSolidCell(LABYRINTH_MAP, gx, gz - 1);
        const solidS = isSolidCell(LABYRINTH_MAP, gx, gz + 1);
        const solidW = isSolidCell(LABYRINTH_MAP, gx - 1, gz);
        const solidE = isSolidCell(LABYRINTH_MAP, gx + 1, gz);
        const isSouthStone = gz >= STONE_SECTOR_START_ROW;
        const isLairCenter =
          gx === LAIR_GRID_CELL.gx && gz === LAIR_GRID_CELL.gz;

        if (solidN && solidS) {
          // Viga transversal em células alternadas para ritmo limpo sem poluição visual
          if ((gx + gz) % 2 === 0) {
            pushBox(
              isSouthStone ? stoneGeos : metalGeos,
              0.22,
              0.18,
              CELL_SIZE - 0.12,
              wx,
              WALL_HEIGHT - 0.09,
              wz
            );
            pushBox(
              darkIronGeos,
              0.28,
              0.045,
              CELL_SIZE - 0.1,
              wx,
              WALL_HEIGHT - 0.19,
              wz
            );
          }
          // Tubulação industrial correndo abaixo do nível da viga (y = WALL_HEIGHT - 0.27 -> zero colisão!)
          if (!isSouthStone) {
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
              0.24,
              0.11,
              wx,
              WALL_HEIGHT - 0.14,
              wz - half + 0.22
            );
          }
        } else if (solidW && solidE) {
          if ((gx + gz) % 2 === 0) {
            pushBox(
              isSouthStone ? stoneGeos : metalGeos,
              CELL_SIZE - 0.12,
              0.18,
              0.22,
              wx,
              WALL_HEIGHT - 0.09,
              wz
            );
            pushBox(
              darkIronGeos,
              CELL_SIZE - 0.1,
              0.045,
              0.28,
              wx,
              WALL_HEIGHT - 0.19,
              wz
            );
          }
          if (!isSouthStone) {
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
              0.24,
              0.07,
              wx - half + 0.22,
              WALL_HEIGHT - 0.14,
              wz
            );
          }
        }

        // Escoras e pórticos antigos de madeira nas galerias de escavação e catacumbas sul
        if (isSouthStone && !isLairCenter) {
          if (solidN && solidW && (gx + gz) % 2 === 0) {
            pushBox(
              woodGeos,
              0.16,
              WALL_HEIGHT - 0.18,
              0.16,
              wx - half + 0.14,
              (WALL_HEIGHT - 0.18) * 0.5,
              wz - half + 0.14
            );
          }
          // Vigas transversais de escoramento de mina no teto (y = WALL_HEIGHT - 0.12 -> zero obstrução!)
          if (solidW && solidE && (gx * 3 + gz * 5) % 4 === 0) {
            pushBox(
              woodGeos,
              CELL_SIZE - 0.16,
              0.17,
              0.18,
              wx,
              WALL_HEIGHT - 0.11,
              wz
            );
            pushBox(
              woodGeos,
              0.15,
              WALL_HEIGHT - 0.2,
              0.15,
              wx - half + 0.12,
              (WALL_HEIGHT - 0.2) * 0.5,
              wz
            );
            pushBox(
              woodGeos,
              0.15,
              WALL_HEIGHT - 0.2,
              0.15,
              wx + half - 0.12,
              (WALL_HEIGHT - 0.2) * 0.5,
              wz
            );
          } else if (solidN && solidS && (gx * 5 + gz * 3) % 4 === 0) {
            pushBox(
              woodGeos,
              0.18,
              0.17,
              CELL_SIZE - 0.16,
              wx,
              WALL_HEIGHT - 0.11,
              wz
            );
            pushBox(
              woodGeos,
              0.15,
              WALL_HEIGHT - 0.2,
              0.15,
              wx,
              (WALL_HEIGHT - 0.2) * 0.5,
              wz - half + 0.12
            );
            pushBox(
              woodGeos,
              0.15,
              WALL_HEIGHT - 0.2,
              0.15,
              wx,
              (WALL_HEIGHT - 0.2) * 0.5,
              wz + half - 0.12
            );
          }
        }
        continue;
      }

      // ======================================================================
      // 2. PÓRTICOS EM ARCO ESCULPIDOS EM AÇO ESCURO ('A')
      // ======================================================================
      if (ch === 'A') {
        const northSouthWalls =
          isSolidCell(LABYRINTH_MAP, gx, gz - 1) &&
          isSolidCell(LABYRINTH_MAP, gx, gz + 1);

        const lintelH = 0.64;
        const jambH = WALL_HEIGHT - lintelH;
        const jambThickness = 0.26;

        if (northSouthWalls) {
          pushBox(
            metalGeos,
            0.48,
            lintelH,
            CELL_SIZE - 0.04,
            wx,
            WALL_HEIGHT - lintelH * 0.5,
            wz
          );
          pushBox(
            darkIronGeos,
            0.58,
            0.09,
            CELL_SIZE - 0.02,
            wx,
            WALL_HEIGHT - lintelH + 0.045,
            wz
          );
          // Chave central rebitada no topo do arco
          pushBox(
            darkIronGeos,
            0.62,
            lintelH + 0.06,
            0.34,
            wx,
            WALL_HEIGHT - lintelH * 0.5,
            wz
          );

          for (const sign of [-1, 1]) {
            const jz = wz + sign * (half - jambThickness * 0.5);
            pushBox(metalGeos, 0.44, jambH, jambThickness, wx, jambH * 0.5, jz);
            pushBox(
              darkIronGeos,
              0.52,
              0.24,
              jambThickness + 0.06,
              wx,
              0.12,
              jz - sign * 0.02
            );
            pushBox(
              darkIronGeos,
              0.48,
              0.09,
              jambThickness + 0.04,
              wx,
              1.35,
              jz - sign * 0.015
            );
            // Mão-francesa chanfrada 45° no canto superior (livre da cápsula do jogador)
            pushBox(
              darkIronGeos,
              0.38,
              0.42,
              0.16,
              wx,
              WALL_HEIGHT - lintelH - 0.1,
              wz + sign * (half - jambThickness - 0.08),
              sign * (Math.PI * 0.25),
              0,
              0
            );
          }
        } else {
          pushBox(
            metalGeos,
            CELL_SIZE - 0.04,
            lintelH,
            0.48,
            wx,
            WALL_HEIGHT - lintelH * 0.5,
            wz
          );
          pushBox(
            darkIronGeos,
            CELL_SIZE - 0.02,
            0.09,
            0.58,
            wx,
            WALL_HEIGHT - lintelH + 0.045,
            wz
          );
          pushBox(
            darkIronGeos,
            0.34,
            lintelH + 0.06,
            0.62,
            wx,
            WALL_HEIGHT - lintelH * 0.5,
            wz
          );

          for (const sign of [-1, 1]) {
            const jx = wx + sign * (half - jambThickness * 0.5);
            pushBox(metalGeos, jambThickness, jambH, 0.44, jx, jambH * 0.5, wz);
            pushBox(
              darkIronGeos,
              jambThickness + 0.06,
              0.24,
              0.52,
              jx - sign * 0.02,
              0.12,
              wz
            );
            pushBox(
              darkIronGeos,
              jambThickness + 0.04,
              0.09,
              0.48,
              jx - sign * 0.015,
              1.35,
              wz
            );
            pushBox(
              darkIronGeos,
              0.16,
              0.42,
              0.38,
              wx + sign * (half - jambThickness - 0.08),
              WALL_HEIGHT - lintelH - 0.1,
              wz,
              0,
              0,
              -sign * (Math.PI * 0.25)
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

      // Rodapés e sancas em ferro escuro limpo (recuados 0.01m nas pontas para ZERO Z-fighting!)
      for (const fd of faceDirs) {
        if (!fd.open) continue;
        const fx = wx + fd.nx * (half + 0.026);
        const fz = wz + fd.nz * (half + 0.026);
        const span = CELL_SIZE - 0.02;
        const sx = fd.nx === 0 ? span : 0.052;
        const sz = fd.nz === 0 ? span : 0.052;

        // Rodapé inferior escuro
        pushBox(darkIronGeos, sx, 0.16, sz, fx, 0.08, fz);
        // Sanca superior escura
        pushBox(darkIronGeos, sx, 0.15, sz, fx, WALL_HEIGHT - 0.075, fz);

        // Tubulação vertical com caixa de passagem em ferro escuro (SEM listras amarelas!)
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
            WALL_HEIGHT - 0.32,
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
      // 4. ARANDELAS DE PAREDE 3D GRADEADAS ('L' — 100% CENTRALIZADAS E ILUMINADAS)
      // ======================================================================
      if (ch === 'L') {
        // Filtra apenas faces voltadas para dentro do mapa (ignora borda externa do labirinto!)
        const interiorOpenFaces = faceDirs.filter((d) => {
          if (!d.open) return false;
          const nGx = gx + d.nx;
          const nGz = gz + d.nz;
          return nGx >= 0 && nGx < cols && nGz >= 0 && nGz < rows;
        });

        // Coloca no máximo 2 luminárias por bloco 'L', cada uma com sua própria luz real!
        const activeFaces = interiorOpenFaces.slice(0, 2);
        for (const d of activeFaces) {
          // Painel emissor LITE5 usando UV local 0..1 (sempre perfeitamente enquadrado!)
          const panel = new THREE.PlaneGeometry(0.78, 1.74);
          if (d.rotY !== 0) panel.rotateY(d.rotY);
          panel.translate(
            wx + d.nx * (half + 0.022),
            1.64,
            wz + d.nz * (half + 0.022)
          );
          lightGeos.push(panel);

          // Gaiola metálica 3D escura de proteção (coifa superior/inferior, laterais e 3 barras)
          const frameDepth = 0.085;
          const outX = wx + d.nx * (half + frameDepth * 0.5);
          const outZ = wz + d.nz * (half + frameDepth * 0.5);

          if (d.nx === 0) {
            pushBox(darkIronGeos, 0.92, 0.09, frameDepth + 0.025, outX, 2.55, outZ);
            pushBox(darkIronGeos, 0.92, 0.09, frameDepth + 0.025, outX, 0.73, outZ);
            pushBox(darkIronGeos, 0.07, 1.88, frameDepth, outX - 0.42, 1.64, outZ);
            pushBox(darkIronGeos, 0.07, 1.88, frameDepth, outX + 0.42, 1.64, outZ);
            for (const gy of [1.18, 1.64, 2.1]) {
              pushBox(
                darkIronGeos,
                0.86,
                0.032,
                0.032,
                wx + d.nx * (half + frameDepth),
                gy,
                wz + d.nz * (half + frameDepth)
              );
            }
          } else {
            pushBox(darkIronGeos, frameDepth + 0.025, 0.09, 0.92, outX, 2.55, outZ);
            pushBox(darkIronGeos, frameDepth + 0.025, 0.09, 0.92, outX, 0.73, outZ);
            pushBox(darkIronGeos, frameDepth, 1.88, 0.07, outX, 1.64, outZ - 0.42);
            pushBox(darkIronGeos, frameDepth, 1.88, 0.07, outX, 1.64, outZ + 0.42);
            for (const gy of [1.18, 1.64, 2.1]) {
              pushBox(
                darkIronGeos,
                0.032,
                0.032,
                0.86,
                wx + d.nx * (half + frameDepth),
                gy,
                wz + d.nz * (half + frameDepth)
              );
            }
          }

          // Eletroduto vertical ligando o topo da luminária à sanca
          pushCylinder(
            darkIronGeos,
            0.028,
            0.028,
            0.52,
            6,
            wx + d.nx * (half + 0.038),
            2.84,
            wz + d.nz * (half + 0.038)
          );

          lights.push({
            position: new THREE.Vector3(
              wx + d.nx * (half + 1.05),
              1.72,
              wz + d.nz * (half + 1.05)
            ),
            baseIntensity: 0.62,
            flicker: (gx + gz) % 3 === 0,
            phase: gx * 1.7 + gz * 2.3 + d.nx * 0.8 + d.nz * 1.1,
          });
        }
      }
    }
  }

  // ==========================================================================
  // 5. MARCOS ARQUITETÔNICOS 3D & PLAFONS INDUSTRIAIS NOS 5 GRANDES SETORES
  // ==========================================================================
  const addCeilingFixture = (
    lx: number,
    lz: number,
    intensity: number,
    flicker: boolean,
    phase: number
  ) => {
    const ceilLight = new THREE.PlaneGeometry(1.24, 1.24);
    ceilLight.rotateX(Math.PI * 0.5);
    ceilLight.translate(lx, WALL_HEIGHT - 0.07, lz);
    lightGeos.push(ceilLight);

    pushBox(darkIronGeos, 1.44, 0.09, 0.09, lx, WALL_HEIGHT - 0.045, lz - 0.67);
    pushBox(darkIronGeos, 1.44, 0.09, 0.09, lx, WALL_HEIGHT - 0.045, lz + 0.67);
    pushBox(darkIronGeos, 0.09, 0.09, 1.26, lx - 0.67, WALL_HEIGHT - 0.045, lz);
    pushBox(darkIronGeos, 0.09, 0.09, 1.26, lx + 0.67, WALL_HEIGHT - 0.045, lz);
    pushBox(darkIronGeos, 1.3, 0.035, 0.05, lx, WALL_HEIGHT - 0.085, lz);
    pushBox(darkIronGeos, 0.05, 0.035, 1.3, lx, WALL_HEIGHT - 0.085, lz);

    lights.push({
      position: new THREE.Vector3(lx, 2.35, lz),
      baseIntensity: intensity,
      flicker,
      phase,
    });
  };

  // A) Grande Átrio Central de Comando (gx=14, gz=11 — nave 7x5 com pórticos suspensos)
  const atriumX = cellToWorldX(14);
  const atriumZ = cellToWorldZ(11);
  pushBox(metalGeos, 17.8, 0.18, 0.34, atriumX, WALL_HEIGHT - 0.1, atriumZ);
  pushBox(metalGeos, 0.34, 0.18, 13.8, atriumX, WALL_HEIGHT - 0.1, atriumZ);
  pushBox(darkIronGeos, 17.8, 0.05, 0.44, atriumX, WALL_HEIGHT - 0.2, atriumZ);
  pushBox(darkIronGeos, 0.44, 0.05, 13.8, atriumX, WALL_HEIGHT - 0.2, atriumZ);
  for (const [ox, oz, ph] of [
    [-3.0, -3.0, 0.4],
    [3.0, -3.0, 1.2],
    [-3.0, 3.0, 2.1],
    [3.0, 3.0, 2.9],
  ] as const) {
    addCeilingFixture(atriumX + ox, atriumZ + oz, 0.58, false, ph);
  }

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
  // Dutos gêmeos de turbina no teto interligando os dois núcleos do reator (y = 2.86m -> livre abaixo!)
  for (const busOx of [-0.65, 0.65]) {
    pushCylinder(
      darkIronGeos,
      0.16,
      0.16,
      CELL_SIZE * 2.1,
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
      0.26,
      0.28,
      reactorX + busOx,
      WALL_HEIGHT - 0.16,
      reactorMidZ
    );
  }
  for (const [ox, oz, ph] of [
    [-4.2, -3.0, 0.7],
    [4.2, -3.0, 1.9],
    [-4.2, 3.0, 3.1],
    [4.2, 3.0, 4.3],
  ] as const) {
    addCeilingFixture(reactorX + ox, reactorMidZ + oz, 0.6, true, ph);
  }

  // C) Enfermaria Médica Noroeste (em torno da coluna M em (7, 4))
  const infirmaryX = cellToWorldX(7);
  const infirmaryZ = cellToWorldZ(4);
  addCeilingFixture(infirmaryX - 3.0, infirmaryZ, 0.56, false, 0.9);
  addCeilingFixture(infirmaryX + 3.0, infirmaryZ, 0.54, true, 3.7);

  // D) Nervuras de abóbada de pedra na Cisterna Sudoeste (6, 20) e Cripta Sudeste Ala B (23, 22)
  for (const [cgx, cgz, spanW, spanD, ph] of [
    [6, 20, 8.6, 8.6, 2.6],
    [23, 22, 11.6, 11.6, 4.8],
  ] as const) {
    const vx = cellToWorldX(cgx);
    const vz = cellToWorldZ(cgz);
    pushBox(stoneGeos, spanW, 0.24, 0.36, vx, WALL_HEIGHT - 0.12, vz);
    pushBox(stoneGeos, 0.36, 0.24, spanD, vx, WALL_HEIGHT - 0.12, vz);
    addCeilingFixture(vx, vz - 3.0, 0.46, true, ph);
  }

  // E) Luminária industrial antiga suspensa e torta no teto do Grande Ninho da Aranha (LAIR_GRID_CELL)
  const lairX = cellToWorldX(LAIR_GRID_CELL.gx);
  const lairZ = cellToWorldZ(LAIR_GRID_CELL.gz);
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
  const tiltMat = new THREE.Matrix4().makeRotationFromEuler(
    new THREE.Euler(0.06, 0.18, -0.05, 'YXZ')
  );
  lairCeilLight.applyMatrix4(tiltMat);
  lairCeilLight.translate(lairX, WALL_HEIGHT - 0.302, lairZ);
  lightGeos.push(lairCeilLight);

  lights.push({
    position: new THREE.Vector3(lairX, 2.35, lairZ),
    baseIntensity: 0.48,
    flicker: true,
    phase: 5.1,
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

  for (const [geos, mat, name] of buckets) {
    const merged = mergeStaticGeometries(geos);
    if (merged) {
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
  };
}
