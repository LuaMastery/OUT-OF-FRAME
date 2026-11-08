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
 * Mapa 15x15 do Labirinto de Teste estilo DOOM Clássico:
 * - '#' : Parede industrial STARTAN
 * - 'B' : Parede de blocos de pedra STONE
 * - 'M' : Coluna estrutural de ferro rebitado METAL
 * - 'L' : Bloco com luminárias gradeadas LITE5 nas faces voltadas ao corredor
 * - 'A' : Passagem em arco com viga superior, mãos-francesas e batentes metálicos
 * - 'P' : Ponto inicial do jogador
 * - '.' : Corredor / sala aberta
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
 * Funde um conjunto de BufferGeometries estáticas já transformadas em uma única malha
 * por material, garantindo riqueza arquitetônica 3D sem custo extra de draw calls.
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

  const matStartan = createDoomSurfaceMaterial(
    textures.startanWall,
    sharedUniforms,
    { tileScaleXZ: CELL_SIZE, wallHeight: WALL_HEIGHT, baseLight: 0.52 }
  );
  const matStone = createDoomSurfaceMaterial(
    textures.stoneWall,
    sharedUniforms,
    { tileScaleXZ: CELL_SIZE, wallHeight: WALL_HEIGHT, baseLight: 0.46 }
  );
  const matMetal = createDoomSurfaceMaterial(
    textures.metalTrim,
    sharedUniforms,
    { tileScaleXZ: CELL_SIZE * 0.5, wallHeight: WALL_HEIGHT, baseLight: 0.5 }
  );
  const matDarkIron = createDoomSurfaceMaterial(
    textures.darkIron,
    sharedUniforms,
    { tileScaleXZ: 1.5, wallHeight: 1.6, baseLight: 0.44 }
  );
  const matWood = createDoomSurfaceMaterial(
    textures.weatheredWood,
    sharedUniforms,
    { tileScaleXZ: 1.4, wallHeight: 1.4, baseLight: 0.48 }
  );
  const matLightPanel = createDoomSurfaceMaterial(
    textures.lightPanel,
    sharedUniforms,
    { tileScaleXZ: 1.2, wallHeight: WALL_HEIGHT, fullBright: true }
  );
  const matFloor = createDoomSurfaceMaterial(
    textures.floorTile,
    sharedUniforms,
    { tileScaleXZ: CELL_SIZE * 0.75, wallHeight: WALL_HEIGHT, baseLight: 0.48 }
  );
  const matCeiling = createDoomSurfaceMaterial(
    textures.ceilingGrate,
    sharedUniforms,
    { tileScaleXZ: CELL_SIZE, wallHeight: WALL_HEIGHT, baseLight: 0.4 }
  );

  const root = new THREE.Group();
  root.name = 'DoomLabyrinth';
  scene.add(root);

  const colliders: StaticColliderBox[] = [];
  const lights: DoomLightSource[] = [];

  // Buckets de detalhes 3D fundidos por material (zero custo extra de draw calls!)
  const startanGeos: THREE.BufferGeometry[] = [];
  const stoneGeos: THREE.BufferGeometry[] = [];
  const metalGeos: THREE.BufferGeometry[] = [];
  const darkIronGeos: THREE.BufferGeometry[] = [];
  const woodGeos: THREE.BufferGeometry[] = [];
  const lightGeos: THREE.BufferGeometry[] = [];

  // Piso e teto contínuos do labirinto
  const totalW = cols * CELL_SIZE;
  const totalD = rows * CELL_SIZE;

  const floorGeo = new THREE.PlaneGeometry(totalW, totalD, cols * 2, rows * 2);
  floorGeo.rotateX(-Math.PI * 0.5);
  const floorMesh = new THREE.Mesh(floorGeo, matFloor);
  floorMesh.position.set(0, 0, 0);
  root.add(floorMesh);

  const ceilGeo = new THREE.PlaneGeometry(totalW, totalD, cols * 2, rows * 2);
  ceilGeo.rotateX(Math.PI * 0.5);
  const ceilMesh = new THREE.Mesh(ceilGeo, matCeiling);
  ceilMesh.position.set(0, WALL_HEIGHT, 0);
  root.add(ceilMesh);

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
      // 1. VÃOS ABERTOS ('.' / 'P'): VIGAS DE TETO, NERVURAS E TUBULAÇÕES 3D
      // ======================================================================
      if (ch === '.' || ch === 'P') {
        const solidN = isSolidCell(LABYRINTH_MAP, gx, gz - 1);
        const solidS = isSolidCell(LABYRINTH_MAP, gx, gz + 1);
        const solidW = isSolidCell(LABYRINTH_MAP, gx - 1, gz);
        const solidE = isSolidCell(LABYRINTH_MAP, gx + 1, gz);
        const isSouthStone = gz >= 9;
        const ribBucket = isSouthStone ? stoneGeos : darkIronGeos;

        // Viga estrutural transversal no teto cruzando corredores Leste-Oeste
        if (solidN && solidS) {
          pushBox(
            ribBucket,
            0.24,
            0.22,
            CELL_SIZE - 0.08,
            wx - half + 0.14,
            WALL_HEIGHT - 0.11,
            wz
          );
          pushBox(
            darkIronGeos,
            0.32,
            0.06,
            CELL_SIZE - 0.06,
            wx - half + 0.14,
            WALL_HEIGHT - 0.21,
            wz
          );
          // Tubulação industrial longitudinal suspensa rente à sanca norte do teto
          if (!isSouthStone) {
            pushCylinder(
              darkIronGeos,
              0.055,
              0.055,
              CELL_SIZE,
              8,
              wx,
              WALL_HEIGHT - 0.16,
              wz - half + 0.24,
              0,
              0,
              Math.PI * 0.5
            );
            // Abraçadeira de fixação do duto
            pushBox(
              metalGeos,
              0.09,
              0.18,
              0.16,
              wx,
              WALL_HEIGHT - 0.11,
              wz - half + 0.24
            );
          }
        } else if (solidW && solidE) {
          // Viga estrutural transversal cruzando corredores Norte-Sul
          pushBox(
            ribBucket,
            CELL_SIZE - 0.08,
            0.22,
            0.24,
            wx,
            WALL_HEIGHT - 0.11,
            wz - half + 0.14
          );
          pushBox(
            darkIronGeos,
            CELL_SIZE - 0.06,
            0.06,
            0.32,
            wx,
            WALL_HEIGHT - 0.21,
            wz - half + 0.14
          );
          if (!isSouthStone) {
            pushCylinder(
              darkIronGeos,
              0.055,
              0.055,
              CELL_SIZE,
              8,
              wx - half + 0.24,
              WALL_HEIGHT - 0.16,
              wz,
              Math.PI * 0.5,
              0,
              0
            );
            pushBox(
              metalGeos,
              0.16,
              0.18,
              0.09,
              wx - half + 0.24,
              WALL_HEIGHT - 0.11,
              wz
            );
          }
        } else if ((gx + gz) % 2 === 0 && !(gx === 7 && gz === 11)) {
          // Câmaras amplas / cruzamentos: nervuras discretas no teto
          pushBox(
            darkIronGeos,
            CELL_SIZE,
            0.14,
            0.18,
            wx,
            WALL_HEIGHT - 0.07,
            wz - half + 0.09
          );
        }

        // Vigas de escora de madeira envelhecida nas galerias de pedra sul (quinas não obstrutivas)
        if (
          isSouthStone &&
          solidN &&
          solidW &&
          !(gx === 7 && gz === 11) &&
          (gx + gz) % 3 === 0
        ) {
          pushBox(
            woodGeos,
            0.16,
            WALL_HEIGHT - 0.2,
            0.16,
            wx - half + 0.14,
            (WALL_HEIGHT - 0.2) * 0.5,
            wz - half + 0.14
          );
        }
        continue;
      }

      // ======================================================================
      // 2. PASSAGEM EM ARCO ESCULPIDA EM 3D ('A')
      //    Viga I dupla, mãos-francesas chanfradas 45°, batentes escalonados e chave central
      // ======================================================================
      if (ch === 'A') {
        const northSouthWalls =
          isSolidCell(LABYRINTH_MAP, gx, gz - 1) &&
          isSolidCell(LABYRINTH_MAP, gx, gz + 1);

        const lintelH = 0.72;
        const jambH = WALL_HEIGHT - lintelH;
        const jambThickness = 0.28;

        if (northSouthWalls) {
          // Viga superior principal + abas inferior/superior de perfil I + chave central
          pushBox(
            metalGeos,
            0.54,
            lintelH,
            CELL_SIZE,
            wx,
            WALL_HEIGHT - lintelH * 0.5,
            wz
          );
          pushBox(
            darkIronGeos,
            0.66,
            0.1,
            CELL_SIZE,
            wx,
            WALL_HEIGHT - lintelH + 0.05,
            wz
          );
          pushBox(
            darkIronGeos,
            0.68,
            lintelH + 0.08,
            0.38,
            wx,
            WALL_HEIGHT - lintelH * 0.5,
            wz
          );

          for (const sign of [-1, 1]) {
            const jz = wz + sign * (half - jambThickness * 0.5);
            // Coluna lateral do batente
            pushBox(metalGeos, 0.48, jambH, jambThickness, wx, jambH * 0.5, jz);
            // Sapata pesada na base do batente + cinta intermediária
            pushBox(
              darkIronGeos,
              0.58,
              0.28,
              jambThickness + 0.08,
              wx,
              0.14,
              jz - sign * 0.03
            );
            pushBox(
              darkIronGeos,
              0.54,
              0.12,
              jambThickness + 0.05,
              wx,
              1.32,
              jz - sign * 0.02
            );
            // Mão-francesa diagonal (corbel 45°) no canto superior do vão (y ~ 2.34m, livre para colisão!)
            pushBox(
              darkIronGeos,
              0.42,
              0.46,
              0.18,
              wx,
              WALL_HEIGHT - lintelH - 0.12,
              wz + sign * (half - jambThickness - 0.09),
              sign * (Math.PI * 0.25),
              0,
              0
            );
          }
        } else {
          pushBox(
            metalGeos,
            CELL_SIZE,
            lintelH,
            0.54,
            wx,
            WALL_HEIGHT - lintelH * 0.5,
            wz
          );
          pushBox(
            darkIronGeos,
            CELL_SIZE,
            0.1,
            0.66,
            wx,
            WALL_HEIGHT - lintelH + 0.05,
            wz
          );
          pushBox(
            darkIronGeos,
            0.38,
            lintelH + 0.08,
            0.68,
            wx,
            WALL_HEIGHT - lintelH * 0.5,
            wz
          );

          for (const sign of [-1, 1]) {
            const jx = wx + sign * (half - jambThickness * 0.5);
            pushBox(metalGeos, jambThickness, jambH, 0.48, jx, jambH * 0.5, wz);
            pushBox(
              darkIronGeos,
              jambThickness + 0.08,
              0.28,
              0.58,
              jx - sign * 0.03,
              0.14,
              wz
            );
            pushBox(
              darkIronGeos,
              jambThickness + 0.05,
              0.12,
              0.54,
              jx - sign * 0.02,
              1.32,
              wz
            );
            pushBox(
              darkIronGeos,
              0.18,
              0.46,
              0.42,
              wx + sign * (half - jambThickness - 0.09),
              WALL_HEIGHT - lintelH - 0.12,
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
      // 3. BLOCOS SÓLIDOS DE PAREDE + RODAPÉS, SANCAS, TUBOS E PILASTRAS 3D
      // ======================================================================
      const isStoneBlock = ch === 'B' || (ch === 'L' && gz >= 9);
      const isMetalPillar = ch === 'M';
      const wallBucket = isMetalPillar
        ? metalGeos
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

      // Rodapé inferior escalonado + sanca superior em todas as faces expostas ao corredor!
      const trimBucket = isStoneBlock ? darkIronGeos : metalGeos;
      for (const fd of faceDirs) {
        if (!fd.open) continue;
        const fx = wx + fd.nx * (half + 0.035);
        const fz = wz + fd.nz * (half + 0.035);
        const sx = fd.nx === 0 ? CELL_SIZE : 0.07;
        const sz = fd.nz === 0 ? CELL_SIZE : 0.07;

        // Rodapé pesado na base
        pushBox(trimBucket, sx, 0.22, sz, fx, 0.11, fz);
        // Friso chanfrado acima do rodapé
        pushBox(
          darkIronGeos,
          fd.nx === 0 ? CELL_SIZE : 0.095,
          0.045,
          fd.nz === 0 ? CELL_SIZE : 0.095,
          wx + fd.nx * (half + 0.045),
          0.23,
          wz + fd.nz * (half + 0.045)
        );
        // Sanca estrutural no topo da parede
        pushBox(trimBucket, sx, 0.2, sz, fx, WALL_HEIGHT - 0.1, fz);

        // Tubulação vertical e caixa de inspeção em paredes industriais alternadas (sem 'L')
        if (
          ch === '#' &&
          (gx * 3 + gz * 5 + (fd.nx + 2) + (fd.nz + 2)) % 5 === 0
        ) {
          const pipeOff = 0.62;
          const px =
            wx + fd.nx * (half + 0.055) + (fd.nz !== 0 ? pipeOff : 0);
          const pz =
            wz + fd.nz * (half + 0.055) + (fd.nx !== 0 ? pipeOff : 0);
          pushCylinder(
            darkIronGeos,
            0.048,
            0.048,
            WALL_HEIGHT - 0.24,
            8,
            px,
            WALL_HEIGHT * 0.5,
            pz
          );
          // Flanges de união do tubo + caixa de passagem rebitada
          pushCylinder(darkIronGeos, 0.072, 0.072, 0.08, 8, px, 1.05, pz);
          pushCylinder(darkIronGeos, 0.072, 0.072, 0.08, 8, px, 2.25, pz);
          pushBox(
            metalGeos,
            fd.nx === 0 ? 0.34 : 0.09,
            0.42,
            fd.nz === 0 ? 0.34 : 0.09,
            wx + fd.nx * (half + 0.045) - (fd.nz !== 0 ? 0.45 : 0),
            1.48,
            wz + fd.nz * (half + 0.045) - (fd.nx !== 0 ? 0.45 : 0)
          );
        }

        // Reforços estruturais extras no pilar central de ferro 'M'
        if (isMetalPillar) {
          pushBox(
            darkIronGeos,
            fd.nx === 0 ? 1.5 : 0.11,
            0.22,
            fd.nz === 0 ? 1.5 : 0.11,
            wx + fd.nx * (half + 0.05),
            WALL_HEIGHT * 0.5,
            wz + fd.nz * (half + 0.05)
          );
        }
      }

      // Pilastras 3D esculpidas (base escalonada + fuste + anel central + capitel) nos cantos expostos
      const corners: Array<[boolean, number, number]> = [
        [openN && openW, -half, -half],
        [openN && openE, half, -half],
        [openS && openW, -half, half],
        [openS && openE, half, half],
      ];
      for (const [exposed, ox, oz] of corners) {
        if (!exposed) continue;
        const cx = wx + ox;
        const cz = wz + oz;
        pushBox(metalGeos, 0.28, WALL_HEIGHT, 0.28, cx, WALL_HEIGHT * 0.5, cz);
        pushBox(darkIronGeos, 0.38, 0.34, 0.38, cx, 0.17, cz);
        pushBox(darkIronGeos, 0.34, 0.14, 0.34, cx, WALL_HEIGHT * 0.5, cz);
        pushBox(
          darkIronGeos,
          0.38,
          0.28,
          0.38,
          cx,
          WALL_HEIGHT - 0.14,
          cz
        );
      }

      // ======================================================================
      // 4. LUMINÁRIAS DE PAREDE 3D GRADEADAS ('L' — CAIXA, GRADES E ELETRODUTO)
      // ======================================================================
      if (ch === 'L') {
        let placedLight = false;
        for (const d of faceDirs) {
          if (!d.open) continue;

          // Painel emissor LITE5
          const panel = new THREE.PlaneGeometry(0.92, 2.12);
          if (d.rotY !== 0) panel.rotateY(d.rotY);
          panel.translate(
            wx + d.nx * (half + 0.024),
            WALL_HEIGHT * 0.5,
            wz + d.nz * (half + 0.024)
          );
          lightGeos.push(panel);

          // Moldura metálica 3D ao redor da luminária (coifa superior/inferior + abas laterais + 4 grades)
          const frameDepth = 0.095;
          const outX = wx + d.nx * (half + frameDepth * 0.5);
          const outZ = wz + d.nz * (half + frameDepth * 0.5);

          if (d.nx === 0) {
            // Parede voltada para Norte ou Sul
            pushBox(darkIronGeos, 1.08, 0.11, frameDepth + 0.03, outX, 2.69, outZ);
            pushBox(darkIronGeos, 1.08, 0.11, frameDepth + 0.03, outX, 0.51, outZ);
            pushBox(metalGeos, 0.08, 2.24, frameDepth, outX - 0.5, WALL_HEIGHT * 0.5, outZ);
            pushBox(metalGeos, 0.08, 2.24, frameDepth, outX + 0.5, WALL_HEIGHT * 0.5, outZ);
            // 4 barras horizontais 3D de proteção sobre o vidro luminoso
            for (const gy of [0.92, 1.38, 1.84, 2.3]) {
              pushBox(
                darkIronGeos,
                1.02,
                0.038,
                0.038,
                wx + d.nx * (half + frameDepth),
                gy,
                wz + d.nz * (half + frameDepth)
              );
            }
          } else {
            // Parede voltada para Leste ou Oeste
            pushBox(darkIronGeos, frameDepth + 0.03, 0.11, 1.08, outX, 2.69, outZ);
            pushBox(darkIronGeos, frameDepth + 0.03, 0.11, 1.08, outX, 0.51, outZ);
            pushBox(metalGeos, frameDepth, 2.24, 0.08, outX, WALL_HEIGHT * 0.5, outZ - 0.5);
            pushBox(metalGeos, frameDepth, 2.24, 0.08, outX, WALL_HEIGHT * 0.5, outZ + 0.5);
            for (const gy of [0.92, 1.38, 1.84, 2.3]) {
              pushBox(
                darkIronGeos,
                0.038,
                0.038,
                1.02,
                wx + d.nx * (half + frameDepth),
                gy,
                wz + d.nz * (half + frameDepth)
              );
            }
          }

          // Eletroduto curto ligando o topo da luminária ao teto
          pushCylinder(
            darkIronGeos,
            0.032,
            0.032,
            0.46,
            6,
            wx + d.nx * (half + 0.045),
            2.96,
            wz + d.nz * (half + 0.045)
          );

          if (!placedLight && lights.length < MAX_DOOM_LIGHTS) {
            placedLight = true;
            lights.push({
              position: new THREE.Vector3(
                wx + d.nx * (half + 1.1),
                WALL_HEIGHT * 0.55,
                wz + d.nz * (half + 1.1)
              ),
              baseIntensity: 0.55,
              flicker: (gx + gz) % 4 === 0,
              phase: gx * 1.7 + gz * 2.3,
            });
          }
        }
      }
    }
  }

  // ==========================================================================
  // 5. PLAFONS 3D INDUSTRIAIS NO TETO DA CÂMARA CENTRAL & LUMINÁRIA PENDENTE DO NINHO
  // ==========================================================================
  const centerX = cellToWorldX(7);
  const centerZ = cellToWorldZ(6);
  for (const offset of [
    [-3.0, 0],
    [3.0, 0],
  ]) {
    const lx = centerX + offset[0];
    const lz = centerZ + offset[1];

    const ceilLight = new THREE.PlaneGeometry(1.36, 1.36);
    ceilLight.rotateX(Math.PI * 0.5);
    ceilLight.translate(lx, WALL_HEIGHT - 0.075, lz);
    lightGeos.push(ceilLight);

    // Caixa metálica rebitada 3D + grelha cruzada no teto
    pushBox(darkIronGeos, 1.56, 0.09, 0.1, lx, WALL_HEIGHT - 0.045, lz - 0.73);
    pushBox(darkIronGeos, 1.56, 0.09, 0.1, lx, WALL_HEIGHT - 0.045, lz + 0.73);
    pushBox(darkIronGeos, 0.1, 0.09, 1.36, lx - 0.73, WALL_HEIGHT - 0.045, lz);
    pushBox(darkIronGeos, 0.1, 0.09, 1.36, lx + 0.73, WALL_HEIGHT - 0.045, lz);
    pushBox(metalGeos, 1.42, 0.04, 0.06, lx, WALL_HEIGHT - 0.09, lz);
    pushBox(metalGeos, 0.06, 0.04, 1.42, lx, WALL_HEIGHT - 0.09, lz);
  }
  if (lights.length < MAX_DOOM_LIGHTS) {
    lights.push({
      position: new THREE.Vector3(centerX, 2.2, centerZ),
      baseIntensity: 0.65,
      flicker: false,
      phase: 0,
    });
  }

  // Luminária industrial antiga suspensa e levemente torta no teto do Ninho da Aranha (7, 11)
  const lairX = cellToWorldX(7);
  const lairZ = cellToWorldZ(11);
  pushCylinder(
    darkIronGeos,
    0.04,
    0.04,
    0.26,
    6,
    lairX,
    WALL_HEIGHT - 0.13,
    lairZ
  );
  pushBox(
    darkIronGeos,
    1.26,
    0.1,
    1.26,
    lairX,
    WALL_HEIGHT - 0.25,
    lairZ,
    0.06,
    0.18,
    -0.05
  );
  const lairCeilLight = new THREE.PlaneGeometry(1.06, 1.06);
  lairCeilLight.rotateX(Math.PI * 0.5);
  const tiltMat = new THREE.Matrix4().makeRotationFromEuler(
    new THREE.Euler(0.06, 0.18, -0.05, 'YXZ')
  );
  lairCeilLight.applyMatrix4(tiltMat);
  lairCeilLight.translate(lairX, WALL_HEIGHT - 0.305, lairZ);
  lightGeos.push(lairCeilLight);

  if (lights.length < MAX_DOOM_LIGHTS) {
    lights.push({
      position: new THREE.Vector3(lairX, 2.35, lairZ),
      baseIntensity: 0.52,
      flicker: true,
      phase: 5.1,
    });
  }

  // Adiciona as malhas estáticas consolidadas à cena
  const buckets: Array<[THREE.BufferGeometry[], THREE.Material, string]> = [
    [startanGeos, matStartan, 'MazeWallsStartan'],
    [stoneGeos, matStone, 'MazeWallsStone'],
    [metalGeos, matMetal, 'MazeTrimMetal'],
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

  // Sincroniza estado inicial dos uniforms de luz
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
