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
 * - 'A' : Passagem em arco com viga superior e batentes metálicos
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

export function gridCellToWorld(gx: number, gz: number): { x: number; z: number } {
  const rows = LABYRINTH_MAP.length;
  const cols = LABYRINTH_MAP[0].length;
  const halfW = cols * CELL_SIZE * 0.5;
  const halfD = rows * CELL_SIZE * 0.5;
  return {
    x: (gx + 0.5) * CELL_SIZE - halfW,
    z: (gz + 0.5) * CELL_SIZE - halfD,
  };
}

export function worldToGridCell(wx: number, wz: number): { gx: number; gz: number } {
  const rows = LABYRINTH_MAP.length;
  const cols = LABYRINTH_MAP[0].length;
  const halfW = cols * CELL_SIZE * 0.5;
  const halfD = rows * CELL_SIZE * 0.5;
  return {
    gx: Math.floor((wx + halfW) / CELL_SIZE),
    gz: Math.floor((wz + halfD) / CELL_SIZE),
  };
}

export function buildDoomLabyrinth(
  scene: THREE.Scene,
  textures: DoomTextureSet,
  sharedUniforms: DoomSharedUniforms
): DoomMazeResult {
  const rows = LABYRINTH_MAP.length;
  const cols = LABYRINTH_MAP[0].length;
  const halfW = (cols * CELL_SIZE) * 0.5;
  const halfD = (rows * CELL_SIZE) * 0.5;

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

  // Piso e teto contínuos do labirinto (subdivididos para precisão de vértices)
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

  const wallGeo = new THREE.BoxGeometry(CELL_SIZE, WALL_HEIGHT, CELL_SIZE);
  const pilasterGeo = new THREE.BoxGeometry(0.28, WALL_HEIGHT, 0.28);

  let spawnPosition = new THREE.Vector3(0, 0, 0);
  const spawnYaw = -Math.PI * 0.5; // Olhando para Leste (+X) ao longo do corredor inicial

  for (let gz = 0; gz < rows; gz++) {
    for (let gx = 0; gx < cols; gx++) {
      const ch = LABYRINTH_MAP[gz][gx];
      const wx = cellToWorldX(gx);
      const wz = cellToWorldZ(gz);

      if (ch === 'P') {
        spawnPosition = new THREE.Vector3(wx, 0, wz);
        continue;
      }

      // Passagem em arco estilo setor DOOM (viga superior + batentes laterais metálicos)
      if (ch === 'A') {
        const northSouthWalls =
          isSolidCell(LABYRINTH_MAP, gx, gz - 1) &&
          isSolidCell(LABYRINTH_MAP, gx, gz + 1);

        const lintelH = 0.72;
        const lintelGeo = northSouthWalls
          ? new THREE.BoxGeometry(0.55, lintelH, CELL_SIZE)
          : new THREE.BoxGeometry(CELL_SIZE, lintelH, 0.55);
        const lintel = new THREE.Mesh(lintelGeo, matMetal);
        lintel.position.set(wx, WALL_HEIGHT - lintelH * 0.5, wz);
        root.add(lintel);

        // Batentes metálicos finos nas laterais do vão
        const jambThickness = 0.26;
        if (northSouthWalls) {
          for (const sign of [-1, 1]) {
            const jamb = new THREE.Mesh(
              new THREE.BoxGeometry(0.46, WALL_HEIGHT - lintelH, jambThickness),
              matMetal
            );
            jamb.position.set(
              wx,
              (WALL_HEIGHT - lintelH) * 0.5,
              wz + sign * (CELL_SIZE * 0.5 - jambThickness * 0.5)
            );
            root.add(jamb);
          }
        } else {
          for (const sign of [-1, 1]) {
            const jamb = new THREE.Mesh(
              new THREE.BoxGeometry(jambThickness, WALL_HEIGHT - lintelH, 0.46),
              matMetal
            );
            jamb.position.set(
              wx + sign * (CELL_SIZE * 0.5 - jambThickness * 0.5),
              (WALL_HEIGHT - lintelH) * 0.5,
              wz
            );
            root.add(jamb);
          }
        }
        continue;
      }

      if (!isSolidCell(LABYRINTH_MAP, gx, gz)) {
        continue;
      }

      // Seleciona textura da parede conforme o setor do labirinto
      let wallMat = matStartan;
      if (ch === 'B' || (ch === 'L' && gz >= 9)) {
        wallMat = matStone;
      } else if (ch === 'M') {
        wallMat = matMetal;
      }

      const block = new THREE.Mesh(wallGeo, wallMat);
      block.position.set(wx, WALL_HEIGHT * 0.5, wz);
      root.add(block);

      const half = CELL_SIZE * 0.5;
      colliders.push({
        id: `wall-${gx}-${gz}`,
        box: new THREE.Box3(
          new THREE.Vector3(wx - half, 0, wz - half),
          new THREE.Vector3(wx + half, WALL_HEIGHT, wz + half)
        ),
      });

      // Pilastras metálicas de acabamento nos cantos expostos ao corredor
      const openN = !isSolidCell(LABYRINTH_MAP, gx, gz - 1);
      const openS = !isSolidCell(LABYRINTH_MAP, gx, gz + 1);
      const openW = !isSolidCell(LABYRINTH_MAP, gx - 1, gz);
      const openE = !isSolidCell(LABYRINTH_MAP, gx + 1, gz);

      const corners: Array<[boolean, number, number]> = [
        [openN && openW, -half, -half],
        [openN && openE, half, -half],
        [openS && openW, -half, half],
        [openS && openE, half, half],
      ];
      for (const [exposed, ox, oz] of corners) {
        if (!exposed) continue;
        const pilaster = new THREE.Mesh(pilasterGeo, matMetal);
        pilaster.position.set(wx + ox, WALL_HEIGHT * 0.5, wz + oz);
        root.add(pilaster);
      }

      // Luminárias embutidas LITE5 nas faces de 'L' voltadas para corredores abertos
      if (ch === 'L') {
        const dirs: Array<{
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

        let placedLight = false;
        for (const d of dirs) {
          if (!d.open) continue;
          const panel = new THREE.Mesh(
            new THREE.PlaneGeometry(0.95, 2.2),
            matLightPanel
          );
          panel.position.set(
            wx + d.nx * (half + 0.015),
            WALL_HEIGHT * 0.5,
            wz + d.nz * (half + 0.015)
          );
          panel.rotation.y = d.rotY;
          root.add(panel);

          if (!placedLight && lights.length < MAX_DOOM_LIGHTS) {
            placedLight = true;
            lights.push({
              position: new THREE.Vector3(
                wx + d.nx * (half + 1.1),
                WALL_HEIGHT * 0.55,
                wz + d.nz * (half + 1.1)
              ),
              baseIntensity: 0.55,
              // Algumas luminárias piscam sutilmente como setores clássicos do DOOM
              flicker: (gx + gz) % 4 === 0,
              phase: gx * 1.7 + gz * 2.3,
            });
          }
        }
      }
    }
  }

  // Plafons luminosos no teto da câmara central ao redor do pilar 'M'
  const centerX = cellToWorldX(7);
  const centerZ = cellToWorldZ(6);
  for (const offset of [
    [-3.0, 0],
    [3.0, 0],
  ]) {
    const ceilLight = new THREE.Mesh(
      new THREE.PlaneGeometry(1.4, 1.4),
      matLightPanel
    );
    ceilLight.rotation.x = Math.PI * 0.5;
    ceilLight.position.set(
      centerX + offset[0],
      WALL_HEIGHT - 0.015,
      centerZ + offset[1]
    );
    root.add(ceilLight);
  }
  if (lights.length < MAX_DOOM_LIGHTS) {
    lights.push({
      position: new THREE.Vector3(centerX, 2.2, centerZ),
      baseIntensity: 0.65,
      flicker: false,
      phase: 0,
    });
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
