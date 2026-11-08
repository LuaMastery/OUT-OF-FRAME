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
 * Mapa 15x15 do Labirinto Subterrâneo estilo DOOM Clássico:
 * - '#' : Parede industrial escura STARTAN (Setor Norte)
 * - 'B' : Alvenaria subterrânea de pedra STONE (Catacumbas Sul & Ninho)
 * - 'M' : Coluna blindada estrutural central
 * - 'L' : Bloco com arandela gradeada LITE5 iluminando o corredor
 * - 'A' : Pórtico estrutural em arco com viga I, mãos-francesas e batentes de ferro
 * - 'P' : Ponto inicial do jogador
 * - '.' : Corredor / câmara aberta
 */
export const LABYRINTH_MAP: string[] = [
  '###L#####L#####',
  '#P..A...#.....#',
  '###.###.#.###.#',
  'L...#...A.#.L.#',
  '#.###.###.#.#.#',
  '#...A.....A...L',
  '###.#..M..#.###',
  'L...A.....A...L',
  '#.###.#L#.###.#',
  'B.B...B.B...B.B',
  'B.A.BBB.BBB.A.B',
  'L.B.........B.L',
  'B.BBB.BAB.BBB.B',
  'B.....B.B.....B',
  'BBBLBBBLBBBLBBB',
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

  // Divisão limpa de piso e teto entre o Bunker Norte (linhas 0..8) e as Catacumbas Sul (linhas 9..14)
  const totalW = cols * CELL_SIZE;
  const northRows = 9;
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
        const isSouthStone = gz >= 9;

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

        // Escoras antigas de madeira nas galerias de pedra sul
        if (
          isSouthStone &&
          solidN &&
          solidW &&
          !(gx === 7 && gz === 11) &&
          (gx + gz) % 2 === 0
        ) {
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
      const isStoneBlock = ch === 'B' || (ch === 'L' && gz >= 9);
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

      // Pilastras estruturais nos cantos externos expostos E em toda a divisória Norte-Sul (gz === 8)
      const isTransitionRow = gz === 8;
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

          if (lights.length < MAX_DOOM_LIGHTS) {
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
  }

  // ==========================================================================
  // 5. PLAFONS INDUSTRIAIS DA CÂMARA CENTRAL & PENDENTE DO NINHO DA ARANHA
  // ==========================================================================
  const centerX = cellToWorldX(7);
  const centerZ = cellToWorldZ(6);
  for (const offset of [
    [-3.0, 0],
    [3.0, 0],
  ]) {
    const lx = centerX + offset[0];
    const lz = centerZ + offset[1];

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

    if (lights.length < MAX_DOOM_LIGHTS) {
      lights.push({
        position: new THREE.Vector3(lx, 2.35, lz),
        baseIntensity: 0.56,
        flicker: false,
        phase: 0,
      });
    }
  }

  // Luminária industrial antiga suspensa e torta no teto do Ninho da Aranha (7, 11)
  const lairX = cellToWorldX(7);
  const lairZ = cellToWorldZ(11);
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

  if (lights.length < MAX_DOOM_LIGHTS) {
    lights.push({
      position: new THREE.Vector3(lairX, 2.35, lairZ),
      baseIntensity: 0.48,
      flicker: true,
      phase: 5.1,
    });
  }

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

  sharedUniforms.uLightCount.value = Math.min(lights.length, MAX_DOOM_LIGHTS);
  for (let i = 0; i < sharedUniforms.uLightCount.value; i++) {
    sharedUniforms.uLightPositions.value[i].copy(lights[i].position);
    sharedUniforms.uLightIntensities.value[i] = lights[i].baseIntensity;
  }

  return {
    colliders,
    spawnPosition,
    spawnYaw,
    lights,
  };
}
