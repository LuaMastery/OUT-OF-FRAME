import * as THREE from 'three';
import { StaticColliderBox } from '../engine/physics/SpatialSweep';
import {
  CELL_SIZE,
  gridCellToWorld,
  isSolidCell,
  LABYRINTH_MAP,
  STONE_SECTOR_START_ROW,
} from './DoomMazeBuilder';
import { createDoomSurfaceMaterial, DoomSharedUniforms } from './DoomShader';
import { DoomTextureSet } from './DoomTextures';
import { getThemedRoomAtCell } from './DoomRooms';

export type DoomObstacleKind =
  | 'iron_barrel_cluster'
  | 'wooden_barrel_cluster'
  | 'metal_shelving_rack'
  | 'wooden_shelving_rack'
  | 'wooden_crate_stack'
  | 'mixed_cargo_depot'
  | 'steel_barricade'
  | 'stone_rubble_barricade'
  | 'low_crawl_obstruction';

export type ObstaclePlacementRole = 'wall' | 'island' | 'crawl';

export interface ObstaclePlacement {
  id: string;
  kind: DoomObstacleKind;
  role: ObstaclePlacementRole;
  gx: number;
  gz: number;
  worldX: number;
  worldZ: number;
  /** Rotação Y em radianos (eixo local -Z é o fundo encostado na parede; +Z aponta para o corredor) */
  yaw: number;
  variant: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

export interface GenerateObstaclesInput {
  rng: () => number;
  reservedCellKeys: ReadonlySet<string>;
  usedCrateCellKeys: ReadonlySet<string>;
  initialWebTrapCells: ReadonlyArray<{ gx: number; gz: number }>;
  lairCell: { gx: number; gz: number };
  existingRoomFurniture?: ReadonlyArray<{
    gx: number;
    gz: number;
    minX: number;
    maxX: number;
    minZ: number;
    maxZ: number;
  }>;
}

/** Células com plafons de teto em `DoomMazeBuilder.ts` (mantidas livres de estantes altas e vigas arriadas) */
const CEILING_LIGHT_CELL_KEYS = new Set<string>([
  '5,1',
  '22,3',
  '22,7',
  '14,9',
  '14,13',
  '10,11',
  '18,11',
  '9,15',
  '19,15',
  '5,19',
  '23,19',
  '14,19',
  '14,27',
]);

function isLightWallCell(gx: number, gz: number): boolean {
  if (gz < 0 || gz >= LABYRINTH_MAP.length) return false;
  if (gx < 0 || gx >= LABYRINTH_MAP[gz].length) return false;
  return LABYRINTH_MAP[gz][gx] === 'L';
}

function isNearReactorCollar(gx: number, gz: number): boolean {
  return (
    Math.abs(gx - 22) + Math.abs(gz - 4) <= 1 ||
    Math.abs(gx - 22) + Math.abs(gz - 6) <= 1
  );
}

function getTimberPostAxis(gx: number, gz: number): 'WE' | 'NS' | null {
  if (gz < STONE_SECTOR_START_ROW) return null;
  const solidN = isSolidCell(LABYRINTH_MAP, gx, gz - 1);
  const solidS = isSolidCell(LABYRINTH_MAP, gx, gz + 1);
  const solidW = isSolidCell(LABYRINTH_MAP, gx - 1, gz);
  const solidE = isSolidCell(LABYRINTH_MAP, gx + 1, gz);

  const canWE =
    solidW &&
    solidE &&
    !isLightWallCell(gx - 1, gz) &&
    !isLightWallCell(gx + 1, gz) &&
    (gx * 3 + gz * 5) % 4 === 0;
  if (canWE) return 'WE';

  const canNS =
    solidN &&
    solidS &&
    !isLightWallCell(gx, gz - 1) &&
    !isLightWallCell(gx, gz + 1) &&
    (gx * 5 + gz * 3) % 4 === 0;
  if (canNS) return 'NS';

  return null;
}

interface Aabb2D {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

function aabb2DOverlaps(a: Aabb2D, b: Aabb2D): boolean {
  return (
    a.minX < b.maxX &&
    a.maxX > b.minX &&
    a.minZ < b.maxZ &&
    a.maxZ > b.minZ
  );
}

function aabb2DDistance(a: Aabb2D, b: Aabb2D): number {
  const dx = Math.max(0, a.minX - b.maxX, b.minX - a.maxX);
  const dz = Math.max(0, a.minZ - b.maxZ, b.minZ - a.maxZ);
  return Math.hypot(dx, dz);
}

/**
 * Constrói todas as zonas frontais de proteção das arandelas de LED ('L')
 * para que nenhum obstáculo bloqueie luminárias de parede nem falhe nos testes geométricos.
 */
function buildLightPanelKeepoutBoxes(): Aabb2D[] {
  const boxes: Aabb2D[] = [];
  const half = CELL_SIZE * 0.5;
  const dirs = [
    { nx: 0, nz: -1 },
    { nx: 0, nz: 1 },
    { nx: -1, nz: 0 },
    { nx: 1, nz: 0 },
  ];

  for (let gz = 0; gz < LABYRINTH_MAP.length; gz++) {
    const row = LABYRINTH_MAP[gz];
    for (let gx = 0; gx < row.length; gx++) {
      if (row[gx] !== 'L') continue;
      const w = gridCellToWorld(gx, gz);
      for (const d of dirs) {
        const adjCh = LABYRINTH_MAP[gz + d.nz]?.[gx + d.nx];
        if (adjCh !== '.' && adjCh !== 'P') continue;
        const faceX = w.x + d.nx * half;
        const faceZ = w.z + d.nz * half;
        if (d.nz !== 0) {
          const z0 = faceZ;
          const z1 = faceZ + d.nz * 1.08;
          boxes.push({
            minX: faceX - 0.66,
            maxX: faceX + 0.66,
            minZ: Math.min(z0, z1),
            maxZ: Math.max(z0, z1),
          });
        } else {
          const x0 = faceX;
          const x1 = faceX + d.nx * 1.08;
          boxes.push({
            minX: Math.min(x0, x1),
            maxX: Math.max(x0, x1),
            minZ: faceZ - 0.66,
            maxZ: faceZ + 0.66,
          });
        }
      }
    }
  }
  return boxes;
}

function getObstacleLocalDimensions(
  kind: DoomObstacleKind,
  role: ObstaclePlacementRole
): { width: number; depth: number; minY: number; maxY: number } {
  if (role === 'crawl') {
    return { width: 2.92, depth: 0.54, minY: 1.18, maxY: 2.14 };
  }
  if (role === 'island') {
    switch (kind) {
      case 'iron_barrel_cluster':
        return { width: 1.16, depth: 1.08, minY: 0, maxY: 0.98 };
      case 'wooden_barrel_cluster':
        return { width: 1.18, depth: 1.1, minY: 0, maxY: 1.0 };
      case 'wooden_crate_stack':
        return { width: 1.28, depth: 1.16, minY: 0, maxY: 1.54 };
      case 'mixed_cargo_depot':
        return { width: 1.34, depth: 1.08, minY: 0, maxY: 1.36 };
      case 'steel_barricade':
        return { width: 1.38, depth: 0.76, minY: 0, maxY: 1.14 };
      case 'stone_rubble_barricade':
        return { width: 1.36, depth: 0.96, minY: 0, maxY: 1.18 };
      default:
        return { width: 1.24, depth: 1.06, minY: 0, maxY: 1.4 };
    }
  }

  // Obstáculo encostado à parede ('wall'): profundidade <= 0.78m deixa >= 2.18m de vão livre no corredor de 3.0m!
  switch (kind) {
    case 'iron_barrel_cluster':
      return { width: 1.24, depth: 0.72, minY: 0, maxY: 0.98 };
    case 'wooden_barrel_cluster':
      return { width: 1.26, depth: 0.74, minY: 0, maxY: 1.0 };
    case 'metal_shelving_rack':
      return { width: 1.46, depth: 0.66, minY: 0, maxY: 2.16 };
    case 'wooden_shelving_rack':
      return { width: 1.46, depth: 0.68, minY: 0, maxY: 2.1 };
    case 'wooden_crate_stack':
      return { width: 1.3, depth: 0.78, minY: 0, maxY: 1.52 };
    case 'mixed_cargo_depot':
      return { width: 1.34, depth: 0.76, minY: 0, maxY: 1.34 };
    case 'steel_barricade':
      return { width: 1.34, depth: 0.68, minY: 0, maxY: 1.12 };
    case 'stone_rubble_barricade':
      return { width: 1.34, depth: 0.74, minY: 0, maxY: 1.16 };
    default:
      return { width: 1.24, depth: 0.72, minY: 0, maxY: 1.0 };
  }
}

function computeRotatedAabb2D(
  cx: number,
  cz: number,
  width: number,
  depth: number,
  yaw: number
): Aabb2D {
  const hw = width * 0.5;
  const hd = depth * 0.5;
  const c = Math.abs(Math.cos(yaw));
  const s = Math.abs(Math.sin(yaw));
  const ex = hw * c + hd * s;
  const ez = hw * s + hd * c;
  return {
    minX: cx - ex,
    maxX: cx + ex,
    minZ: cz - ez,
    maxZ: cz + ez,
  };
}

function shuffleWithRng<T>(arr: T[], rng: () => number): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

/**
 * Gera de forma 100% determinística (por `worldSeed`) ~95 obstáculos táticos variados
 * distribuídos pelos 5 setores do labirinto 29x29:
 * - Barris de ferro industriais (em pé e tombados)
 * - Barris/tonéis de madeira aduelada com arcos de ferro
 * - Prateleiras metálicas altas e estantes rústicas de madeira carregadas
 * - Pilhas de caixotes reforçados e estrados mistos de carga
 * - Barricadas blindadas de aço e barricadas de pedra/escoras
 * - Vigas/tubulações arriadas transversais para agachar [Ctrl] ou deslizar [Shift+Ctrl] por baixo!
 *
 * Mantém folga estrita de passagem (>= 1.44m entre obstáculos vizinhos e >= 2.18m em corredores),
 * nunca bloqueando portas/arcos ('A'), luzes ('L'), caixotes de itens nem o Ninho da Aranha.
 */
export function generateArenaObstacles(
  input: GenerateObstaclesInput
): ObstaclePlacement[] {
  const {
    rng,
    reservedCellKeys,
    usedCrateCellKeys,
    initialWebTrapCells,
    lairCell,
    existingRoomFurniture = [],
  } = input;
  const rows = LABYRINTH_MAP.length;
  const cols = LABYRINTH_MAP[0].length;
  const lightKeepouts = buildLightPanelKeepoutBoxes();
  const webTrapKeys = new Set(
    initialWebTrapCells.map((t) => `${t.gx},${t.gz}`)
  );

  const placements: ObstaclePlacement[] = [];
  const occupiedCells = new Set<string>();
  for (let i = 0; i < existingRoomFurniture.length; i++) {
    const rf = existingRoomFurniture[i];
    occupiedCells.add(`${rf.gx},${rf.gz}`);
  }

  const hitsAnyLightKeepout = (box: Aabb2D): boolean => {
    const padded: Aabb2D = {
      minX: box.minX - 0.06,
      maxX: box.maxX + 0.06,
      minZ: box.minZ - 0.06,
      maxZ: box.maxZ + 0.06,
    };
    for (let i = 0; i < lightKeepouts.length; i++) {
      if (aabb2DOverlaps(padded, lightKeepouts[i])) return true;
    }
    return false;
  };

  const hasSafeClearanceFromExisting = (
    box: Aabb2D,
    minGap: number
  ): boolean => {
    for (let i = 0; i < existingRoomFurniture.length; i++) {
      if (aabb2DDistance(box, existingRoomFurniture[i]) < Math.max(minGap, 1.48)) {
        return false;
      }
    }
    for (let i = 0; i < placements.length; i++) {
      const p = placements[i];
      if (p.role === 'crawl') continue;
      if (aabb2DDistance(box, p) < minGap) return false;
    }
    return true;
  };

  const isCellEligibleBase = (gx: number, gz: number): boolean => {
    if (gx <= 0 || gx >= cols - 1 || gz <= 0 || gz >= rows - 1) return false;
    const ch = LABYRINTH_MAP[gz][gx];
    if (ch !== '.') return false; // Preserva arcos 'A' e fallback 'P' (2,1)
    const key = `${gx},${gz}`;
    if (occupiedCells.has(key)) return false;
    if (reservedCellKeys.has(key)) return false;
    if (usedCrateCellKeys.has(key)) return false;
    if (webTrapKeys.has(key)) return false;
    if (isNearReactorCollar(gx, gz)) return false;
    if (Math.hypot(gx - lairCell.gx, gz - lairCell.gz) <= 2.4) return false;
    const room = getThemedRoomAtCell(gx, gz);
    if (
      room &&
      (room.id === 'library_room' ||
        room.id === 'biology_lab' ||
        room.id === 'vegetation_room')
    ) {
      return false;
    }
    return true;
  };

  // ==========================================================================
  // FASE 1: Vigas / Tubulações Arriadas Transversais (Agachar / Slide por baixo!)
  // ==========================================================================
  const crawlCandidates: Array<{ gx: number; gz: number; yaw: number }> = [];
  for (let gz = 1; gz < rows - 1; gz++) {
    for (let gx = 1; gx < cols - 1; gx++) {
      if (!isCellEligibleBase(gx, gz)) continue;
      if (getThemedRoomAtCell(gx, gz) !== null) continue;
      if (CEILING_LIGHT_CELL_KEYS.has(`${gx},${gz}`)) continue;
      if (getTimberPostAxis(gx, gz) !== null) continue;

      const solidN = isSolidCell(LABYRINTH_MAP, gx, gz - 1);
      const solidS = isSolidCell(LABYRINTH_MAP, gx, gz + 1);
      const solidW = isSolidCell(LABYRINTH_MAP, gx - 1, gz);
      const solidE = isSolidCell(LABYRINTH_MAP, gx + 1, gz);

      // Corredor reto Leste-Oeste (paredes N e S sólidas, sem luminária 'L')
      if (
        solidN &&
        solidS &&
        !solidW &&
        !solidE &&
        !isLightWallCell(gx, gz - 1) &&
        !isLightWallCell(gx, gz + 1) &&
        LABYRINTH_MAP[gz][gx - 1] === '.' &&
        LABYRINTH_MAP[gz][gx + 1] === '.'
      ) {
        crawlCandidates.push({ gx, gz, yaw: Math.PI * 0.5 });
      }
      // Corredor reto Norte-Sul (paredes W e E sólidas, sem luminária 'L')
      else if (
        solidW &&
        solidE &&
        !solidN &&
        !solidS &&
        !isLightWallCell(gx - 1, gz) &&
        !isLightWallCell(gx + 1, gz) &&
        LABYRINTH_MAP[gz - 1][gx] === '.' &&
        LABYRINTH_MAP[gz + 1][gx] === '.'
      ) {
        crawlCandidates.push({ gx, gz, yaw: 0 });
      }
    }
  }

  shuffleWithRng(crawlCandidates, rng);
  const chosenCrawls: Array<{ gx: number; gz: number }> = [];
  for (const cand of crawlCandidates) {
    if (chosenCrawls.length >= 11) break;
    if (
      chosenCrawls.some(
        (c) => Math.hypot(c.gx - cand.gx, c.gz - cand.gz) < 5.0
      )
    ) {
      continue;
    }
    const w = gridCellToWorld(cand.gx, cand.gz);
    const dims = getObstacleLocalDimensions('low_crawl_obstruction', 'crawl');
    const aabb = computeRotatedAabb2D(
      w.x,
      w.z,
      dims.width,
      dims.depth,
      cand.yaw
    );
    if (hitsAnyLightKeepout(aabb)) continue;

    occupiedCells.add(`${cand.gx},${cand.gz}`);
    chosenCrawls.push({ gx: cand.gx, gz: cand.gz });
    placements.push({
      id: `obs-crawl-${placements.length}`,
      kind: 'low_crawl_obstruction',
      role: 'crawl',
      gx: cand.gx,
      gz: cand.gz,
      worldX: w.x,
      worldZ: w.z,
      yaw: cand.yaw,
      variant: Math.floor(rng() * 3),
      minX: aabb.minX,
      maxX: aabb.maxX,
      minY: dims.minY,
      maxY: dims.maxY,
      minZ: aabb.minZ,
      maxZ: aabb.maxZ,
    });
  }

  // ==========================================================================
  // FASE 2: Ilhas Táticas Centrais em Salões Amplos, Átrio e Galerias Abertas
  // ==========================================================================
  const islandCandidates: Array<{ gx: number; gz: number }> = [];
  for (let gz = 2; gz < rows - 2; gz++) {
    for (let gx = 2; gx < cols - 2; gx++) {
      if (!isCellEligibleBase(gx, gz)) continue;
      if (CEILING_LIGHT_CELL_KEYS.has(`${gx},${gz}`)) continue;

      const cardOpen =
        !isSolidCell(LABYRINTH_MAP, gx - 1, gz) &&
        !isSolidCell(LABYRINTH_MAP, gx + 1, gz) &&
        !isSolidCell(LABYRINTH_MAP, gx, gz - 1) &&
        !isSolidCell(LABYRINTH_MAP, gx, gz + 1);
      if (!cardOpen) continue;

      let diagOpen = 0;
      for (const [dx, dz] of [
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1],
      ] as const) {
        if (!isSolidCell(LABYRINTH_MAP, gx + dx, gz + dz)) diagOpen++;
      }
      if (diagOpen >= 3) {
        islandCandidates.push({ gx, gz });
      }
    }
  }

  shuffleWithRng(islandCandidates, rng);
  const northIslandPool: DoomObstacleKind[] = [
    'wooden_crate_stack',
    'iron_barrel_cluster',
    'mixed_cargo_depot',
    'steel_barricade',
    'wooden_barrel_cluster',
  ];
  const southIslandPool: DoomObstacleKind[] = [
    'wooden_barrel_cluster',
    'wooden_crate_stack',
    'stone_rubble_barricade',
    'mixed_cargo_depot',
    'iron_barrel_cluster',
  ];

  const chosenIslands: Array<{ gx: number; gz: number }> = [];
  for (const cand of islandCandidates) {
    if (chosenIslands.length >= 26) break;
    if (
      chosenIslands.some(
        (c) => Math.hypot(c.gx - cand.gx, c.gz - cand.gz) < 2.05
      )
    ) {
      continue;
    }

    const pool =
      cand.gz >= STONE_SECTOR_START_ROW ? southIslandPool : northIslandPool;
    const kind = pool[Math.floor(rng() * pool.length)];
    const dims = getObstacleLocalDimensions(kind, 'island');
    const w = gridCellToWorld(cand.gx, cand.gz);
    const ox = (rng() - 0.5) * 0.44;
    const oz = (rng() - 0.5) * 0.44;
    const yaw =
      Math.floor(rng() * 4) * (Math.PI * 0.5) + (rng() - 0.5) * 0.28;
    const aabb = computeRotatedAabb2D(
      w.x + ox,
      w.z + oz,
      dims.width,
      dims.depth,
      yaw
    );
    if (hitsAnyLightKeepout(aabb)) continue;
    if (!hasSafeClearanceFromExisting(aabb, 1.55)) continue;

    occupiedCells.add(`${cand.gx},${cand.gz}`);
    chosenIslands.push(cand);
    placements.push({
      id: `obs-island-${placements.length}`,
      kind,
      role: 'island',
      gx: cand.gx,
      gz: cand.gz,
      worldX: w.x + ox,
      worldZ: w.z + oz,
      yaw,
      variant: Math.floor(rng() * 3),
      minX: aabb.minX,
      maxX: aabb.maxX,
      minY: dims.minY,
      maxY: dims.maxY,
      minZ: aabb.minZ,
      maxZ: aabb.maxZ,
    });
  }

  // ==========================================================================
  // FASE 3: Obstáculos de Corredor & Perímetro (Barris, Prateleiras, Caixotes, Barricadas)
  // ==========================================================================
  interface WallSlotCandidate {
    gx: number;
    gz: number;
    wallNx: number;
    wallNz: number;
    yaw: number;
  }

  const wallCandidates: WallSlotCandidate[] = [];
  const wallDirs: Array<{ nx: number; nz: number; yaw: number }> = [
    // Parede ao Norte (z - 1.5): fundo local -Z aponta para Norte -> yaw = 0
    { nx: 0, nz: -1, yaw: 0 },
    // Parede ao Sul (z + 1.5): fundo local -Z aponta para Sul -> yaw = PI
    { nx: 0, nz: 1, yaw: Math.PI },
    // Parede a Oeste (x - 1.5): fundo local -Z aponta para Oeste -> yaw = -PI/2
    { nx: -1, nz: 0, yaw: -Math.PI * 0.5 },
    // Parede a Leste (x + 1.5): fundo local -Z aponta para Leste -> yaw = +PI/2
    { nx: 1, nz: 0, yaw: Math.PI * 0.5 },
  ];

  for (let gz = 1; gz < rows - 1; gz++) {
    for (let gx = 1; gx < cols - 1; gx++) {
      if (!isCellEligibleBase(gx, gz)) continue;
      const timberAxis = getTimberPostAxis(gx, gz);
      const validWalls: WallSlotCandidate[] = [];

      for (const wd of wallDirs) {
        const wgx = gx + wd.nx;
        const wgz = gz + wd.nz;
        const wallCh = LABYRINTH_MAP[wgz]?.[wgx];
        if (wallCh !== '#' && wallCh !== 'B') continue;
        if (timberAxis === 'WE' && wd.nx !== 0) continue;
        if (timberAxis === 'NS' && wd.nz !== 0) continue;
        // Não coloca obstáculo se o lado oposto imediato for um arco estreito 'A'
        const oppCh = LABYRINTH_MAP[gz - wd.nz]?.[gx - wd.nx];
        if (oppCh === 'A') continue;

        validWalls.push({
          gx,
          gz,
          wallNx: wd.nx,
          wallNz: wd.nz,
          yaw: wd.yaw,
        });
      }

      if (validWalls.length > 0) {
        // Escolhe determinísticamente 1 face de parede desta célula (alternando lados ao longo de corredores!)
        const pickIdx = (gx * 7 + gz * 13 + Math.floor(rng() * validWalls.length)) % validWalls.length;
        wallCandidates.push(validWalls[pickIdx]);
      }
    }
  }

  shuffleWithRng(wallCandidates, rng);

  const northWallPool: DoomObstacleKind[] = [
    'iron_barrel_cluster',
    'iron_barrel_cluster',
    'metal_shelving_rack',
    'metal_shelving_rack',
    'wooden_crate_stack',
    'mixed_cargo_depot',
    'steel_barricade',
    'wooden_barrel_cluster',
    'wooden_shelving_rack',
  ];
  const southWallPool: DoomObstacleKind[] = [
    'wooden_barrel_cluster',
    'wooden_barrel_cluster',
    'wooden_shelving_rack',
    'wooden_crate_stack',
    'stone_rubble_barricade',
    'iron_barrel_cluster',
    'mixed_cargo_depot',
    'metal_shelving_rack',
  ];

  const halfCell = CELL_SIZE * 0.5;
  for (const slot of wallCandidates) {
    if (placements.length >= 138) break;
    const key = `${slot.gx},${slot.gz}`;
    if (occupiedCells.has(key)) continue;

    // Não encosta em célula de viga arriada vizinha para deixar espaço confortável de corrida/slide
    if (
      chosenCrawls.some(
        (c) => Math.abs(c.gx - slot.gx) + Math.abs(c.gz - slot.gz) <= 1
      )
    ) {
      continue;
    }

    const isSouth = slot.gz >= STONE_SECTOR_START_ROW;
    const pool = isSouth ? southWallPool : northWallPool;
    let kind = pool[Math.floor(rng() * pool.length)];

    // Sob plafons de teto, prefere obstáculos baixos/médios em vez de estantes altas
    if (
      CEILING_LIGHT_CELL_KEYS.has(key) &&
      (kind === 'metal_shelving_rack' || kind === 'wooden_shelving_rack')
    ) {
      kind = isSouth ? 'wooden_barrel_cluster' : 'iron_barrel_cluster';
    }

    const dims = getObstacleLocalDimensions(kind, 'wall');
    const cellCenter = gridCellToWorld(slot.gx, slot.gz);
    const wallGap = 0.045;
    const centerDistFromWall = wallGap + dims.depth * 0.5;
    const maxSlideAlong = Math.max(0, 1.32 - dims.width * 0.5);
    const slideAlong = (rng() - 0.5) * 2 * Math.min(0.28, maxSlideAlong);

    const perpX = -slot.wallNz;
    const perpZ = slot.wallNx;

    const wx =
      cellCenter.x +
      slot.wallNx * (halfCell - centerDistFromWall) +
      perpX * slideAlong;
    const wz =
      cellCenter.z +
      slot.wallNz * (halfCell - centerDistFromWall) +
      perpZ * slideAlong;

    const aabb = computeRotatedAabb2D(
      wx,
      wz,
      dims.width,
      dims.depth,
      slot.yaw
    );
    if (hitsAnyLightKeepout(aabb)) continue;
    // Garante gargalo horizontal >= 1.42m entre quaisquer dois obstáculos vizinhos!
    if (!hasSafeClearanceFromExisting(aabb, 1.42)) continue;

    occupiedCells.add(key);
    placements.push({
      id: `obs-wall-${placements.length}`,
      kind,
      role: 'wall',
      gx: slot.gx,
      gz: slot.gz,
      worldX: wx,
      worldZ: wz,
      yaw: slot.yaw,
      variant: Math.floor(rng() * 3),
      minX: aabb.minX,
      maxX: aabb.maxX,
      minY: dims.minY,
      maxY: dims.maxY,
      minZ: aabb.minZ,
      maxZ: aabb.maxZ,
    });
  }

  return placements;
}

// ============================================================================
// CONSTRUÇÃO GEOMÉTRICA 3D EM LOTE (BATCHED MESHES DE ALTA PERFORMANCE)
// ============================================================================

interface LocalTransform {
  cx: number;
  cz: number;
  yaw: number;
}

function addLocalBox(
  bucket: THREE.BufferGeometry[],
  xf: LocalTransform,
  sx: number,
  sy: number,
  sz: number,
  lx: number,
  ly: number,
  lz: number,
  rx = 0,
  ry = 0,
  rz = 0
): void {
  const g = new THREE.BoxGeometry(sx, sy, sz);
  if (rx !== 0 || ry !== 0 || rz !== 0) {
    g.applyMatrix4(
      new THREE.Matrix4().makeRotationFromEuler(
        new THREE.Euler(rx, ry, rz, 'YXZ')
      )
    );
  }
  g.translate(lx, ly, lz);
  if (xf.yaw !== 0) {
    g.rotateY(xf.yaw);
  }
  g.translate(xf.cx, 0, xf.cz);
  bucket.push(g);
}

function addLocalCylinder(
  bucket: THREE.BufferGeometry[],
  xf: LocalTransform,
  rTop: number,
  rBot: number,
  height: number,
  segs: number,
  lx: number,
  ly: number,
  lz: number,
  rx = 0,
  ry = 0,
  rz = 0
): void {
  const g = new THREE.CylinderGeometry(rTop, rBot, height, segs);
  if (rx !== 0 || ry !== 0 || rz !== 0) {
    g.applyMatrix4(
      new THREE.Matrix4().makeRotationFromEuler(
        new THREE.Euler(rx, ry, rz, 'YXZ')
      )
    );
  }
  g.translate(lx, ly, lz);
  if (xf.yaw !== 0) {
    g.rotateY(xf.yaw);
  }
  g.translate(xf.cx, 0, xf.cz);
  bucket.push(g);
}

interface ObstacleGeoBuckets {
  ironBarrel: THREE.BufferGeometry[];
  oakWood: THREE.BufferGeometry[];
  weatheredWood: THREE.BufferGeometry[];
  metalTrim: THREE.BufferGeometry[];
  darkIron: THREE.BufferGeometry[];
  stone: THREE.BufferGeometry[];
}

/** Tambor industrial de ferro de 200L em pé com aros frisados e bujões na tampa */
function emitUprightIronBarrel(
  b: ObstacleGeoBuckets,
  xf: LocalTransform,
  lx: number,
  lz: number,
  rotY = 0,
  scale = 1.0
): void {
  const r = 0.265 * scale;
  const h = 0.92 * scale;
  // Corpo principal de aço pintado/oxidado
  addLocalCylinder(b.ironBarrel, xf, r, r, h, 12, lx, h * 0.5, lz, 0, rotY, 0);
  // 4 aros de reforço de ferro escuro (base, 1/3, 2/3 e borda superior)
  for (const frac of [0.035, 0.34, 0.67, 0.965]) {
    addLocalCylinder(
      b.darkIron,
      xf,
      r * 1.045,
      r * 1.045,
      0.032 * scale,
      12,
      lx,
      h * frac,
      lz,
      0,
      rotY,
      0
    );
  }
  // Tampa interna rebaixada + bujão sextavado e respiro metálico
  addLocalCylinder(
    b.darkIron,
    xf,
    r * 0.88,
    r * 0.88,
    0.02 * scale,
    12,
    lx,
    h - 0.008 * scale,
    lz
  );
  const bx = lx + Math.cos(rotY) * (r * 0.46);
  const bz = lz + Math.sin(rotY) * (r * 0.46);
  addLocalCylinder(
    b.metalTrim,
    xf,
    0.038 * scale,
    0.038 * scale,
    0.036 * scale,
    6,
    bx,
    h + 0.012 * scale,
    bz
  );
  addLocalCylinder(
    b.metalTrim,
    xf,
    0.022 * scale,
    0.022 * scale,
    0.028 * scale,
    6,
    lx - Math.cos(rotY) * (r * 0.42),
    h + 0.008 * scale,
    lz - Math.sin(rotY) * (r * 0.42)
  );
}

/** Tambor industrial de ferro tombado no chão sobre calços */
function emitFallenIronBarrel(
  b: ObstacleGeoBuckets,
  xf: LocalTransform,
  lx: number,
  lz: number,
  axisYaw = 0.12
): void {
  const r = 0.255;
  const h = 0.88;
  const cy = r + 0.015;
  // Calços de madeira sob o barril deitado
  addLocalBox(b.weatheredWood, xf, 0.14, 0.06, 0.48, lx - 0.2, 0.03, lz, 0, axisYaw, 0);
  addLocalBox(b.weatheredWood, xf, 0.14, 0.06, 0.48, lx + 0.2, 0.03, lz, 0, axisYaw, 0);
  // Cilindro deitado no eixo X (rz = PI/2)
  addLocalCylinder(
    b.ironBarrel,
    xf,
    r,
    r,
    h,
    12,
    lx,
    cy,
    lz,
    0,
    axisYaw,
    Math.PI * 0.5
  );
  for (const off of [-0.39, -0.13, 0.13, 0.39]) {
    addLocalCylinder(
      b.darkIron,
      xf,
      r * 1.045,
      r * 1.045,
      0.032,
      12,
      lx + Math.cos(axisYaw) * off,
      cy,
      lz - Math.sin(axisYaw) * off,
      0,
      axisYaw,
      Math.PI * 0.5
    );
  }
}

/** Tonel abaulado de madeira aduelada (carvalho) com 4 cintas de ferro forjado */
function emitUprightWoodenBarrel(
  b: ObstacleGeoBuckets,
  xf: LocalTransform,
  lx: number,
  lz: number,
  rotY = 0,
  scale = 1.0
): void {
  const rEnd = 0.235 * scale;
  const rBelly = 0.295 * scale;
  const h = 0.94 * scale;

  // Silhueta abaulada em 3 seções troncocônicas (fundo -> bojo -> topo)
  addLocalCylinder(
    b.oakWood,
    xf,
    rBelly,
    rEnd,
    h * 0.34,
    12,
    lx,
    h * 0.17,
    lz,
    0,
    rotY,
    0
  );
  addLocalCylinder(
    b.oakWood,
    xf,
    rBelly,
    rBelly,
    h * 0.32,
    12,
    lx,
    h * 0.5,
    lz,
    0,
    rotY,
    0
  );
  addLocalCylinder(
    b.oakWood,
    xf,
    rEnd,
    rBelly,
    h * 0.34,
    12,
    lx,
    h * 0.83,
    lz,
    0,
    rotY,
    0
  );

  // 4 arcos/cintas de ferro escuro envolvendo o tonel
  const hoops: Array<[number, number]> = [
    [0.09, rEnd * 1.05],
    [0.32, rBelly * 1.025],
    [0.68, rBelly * 1.025],
    [0.91, rEnd * 1.05],
  ];
  for (const [fy, hr] of hoops) {
    addLocalCylinder(
      b.darkIron,
      xf,
      hr,
      hr,
      0.036 * scale,
      12,
      lx,
      h * fy,
      lz,
      0,
      rotY,
      0
    );
  }

  // Tampo superior de tábuas rebaixado + batoque/rolha de madeira
  addLocalCylinder(
    b.weatheredWood,
    xf,
    rEnd * 0.9,
    rEnd * 0.9,
    0.025 * scale,
    10,
    lx,
    h - 0.012 * scale,
    lz
  );
  addLocalCylinder(
    b.darkIron,
    xf,
    0.032 * scale,
    0.026 * scale,
    0.034 * scale,
    8,
    lx + rEnd * 0.32,
    h + 0.008 * scale,
    lz
  );
}

/** Tonel de madeira tombado sobre calços */
function emitFallenWoodenBarrel(
  b: ObstacleGeoBuckets,
  xf: LocalTransform,
  lx: number,
  lz: number,
  axisYaw = -0.1
): void {
  const rBelly = 0.275;
  const rEnd = 0.225;
  const cy = rBelly + 0.01;
  addLocalBox(b.weatheredWood, xf, 0.14, 0.06, 0.48, lx - 0.2, 0.03, lz, 0, axisYaw, 0);
  addLocalBox(b.weatheredWood, xf, 0.14, 0.06, 0.48, lx + 0.2, 0.03, lz, 0, axisYaw, 0);

  const cos = Math.cos(axisYaw);
  const sin = Math.sin(axisYaw);
  addLocalCylinder(
    b.oakWood,
    xf,
    rBelly,
    rBelly,
    0.34,
    12,
    lx,
    cy,
    lz,
    0,
    axisYaw,
    Math.PI * 0.5
  );
  addLocalCylinder(
    b.oakWood,
    xf,
    rEnd,
    rBelly,
    0.27,
    12,
    lx + cos * 0.3,
    cy,
    lz - sin * 0.3,
    0,
    axisYaw,
    Math.PI * 0.5
  );
  addLocalCylinder(
    b.oakWood,
    xf,
    rBelly,
    rEnd,
    0.27,
    12,
    lx - cos * 0.3,
    cy,
    lz + sin * 0.3,
    0,
    axisYaw,
    Math.PI * 0.5
  );
  for (const [off, hr] of [
    [-0.36, rEnd * 1.05],
    [-0.14, rBelly * 1.03],
    [0.14, rBelly * 1.03],
    [0.36, rEnd * 1.05],
  ] as const) {
    addLocalCylinder(
      b.darkIron,
      xf,
      hr,
      hr,
      0.034,
      12,
      lx + cos * off,
      cy,
      lz - sin * off,
      0,
      axisYaw,
      Math.PI * 0.5
    );
  }
}

/** Caixote industrial pesado fechado com moldura saliente, mão-francesa diagonal e cantoneiras de ferro */
function emitHeavyWoodenCrate(
  b: ObstacleGeoBuckets,
  xf: LocalTransform,
  sx: number,
  sy: number,
  sz: number,
  lx: number,
  baseY: number,
  lz: number,
  localYaw = 0
): void {
  const cy = baseY + sy * 0.5;
  // Miolo de tábuas
  addLocalBox(
    b.oakWood,
    xf,
    sx - 0.04,
    sy - 0.03,
    sz - 0.04,
    lx,
    cy,
    lz,
    0,
    localYaw,
    0
  );
  // Molduras superior e inferior de madeira grossa
  addLocalBox(
    b.weatheredWood,
    xf,
    sx,
    0.055,
    sz,
    lx,
    baseY + 0.028,
    lz,
    0,
    localYaw,
    0
  );
  addLocalBox(
    b.weatheredWood,
    xf,
    sx,
    0.055,
    sz,
    lx,
    baseY + sy - 0.028,
    lz,
    0,
    localYaw,
    0
  );

  // 4 colunas verticais de canto + ferragens escuras nos vértices
  const cos = Math.cos(localYaw);
  const sin = Math.sin(localYaw);
  const hx = sx * 0.5 - 0.028;
  const hz = sz * 0.5 - 0.028;
  for (const cxSign of [-1, 1]) {
    for (const czSign of [-1, 1]) {
      const px = lx + cxSign * hx * cos + czSign * hz * sin;
      const pz = lz - cxSign * hx * sin + czSign * hz * cos;
      addLocalBox(
        b.weatheredWood,
        xf,
        0.06,
        sy - 0.1,
        0.06,
        px,
        cy,
        pz,
        0,
        localYaw,
        0
      );
      addLocalBox(
        b.darkIron,
        xf,
        0.078,
        0.075,
        0.078,
        px,
        baseY + sy - 0.038,
        pz,
        0,
        localYaw,
        0
      );
      addLocalBox(
        b.darkIron,
        xf,
        0.078,
        0.075,
        0.078,
        px,
        baseY + 0.038,
        pz,
        0,
        localYaw,
        0
      );
    }
  }

  // Travessa diagonal nas faces frontal e traseira
  const diagLen = Math.hypot(sx - 0.12, sy - 0.12);
  const diagTilt = Math.atan2(sy - 0.12, sx - 0.12);
  for (const zSign of [-1, 1]) {
    const fz = zSign * (sz * 0.5 - 0.012);
    const fx = lx + fz * sin;
    const fzz = lz + fz * cos;
    addLocalBox(
      b.weatheredWood,
      xf,
      diagLen,
      0.052,
      0.032,
      fx,
      cy,
      fzz,
      0,
      localYaw,
      diagTilt * zSign
    );
  }
}

function emitObstacleGeometry(
  p: ObstaclePlacement,
  b: ObstacleGeoBuckets
): void {
  const xf: LocalTransform = { cx: p.worldX, cz: p.worldZ, yaw: p.yaw };

  switch (p.kind) {
    case 'iron_barrel_cluster': {
      if (p.role === 'island') {
        emitUprightIronBarrel(b, xf, -0.27, -0.2, 0.4, 1.02);
        emitUprightIronBarrel(b, xf, 0.28, -0.14, 2.1, 0.98);
        if (p.variant === 0) {
          emitFallenIronBarrel(b, xf, 0.0, 0.26, 0.18);
        } else {
          emitUprightIronBarrel(b, xf, 0.02, 0.27, 1.1, 0.95);
        }
      } else if (p.variant === 0) {
        emitUprightIronBarrel(b, xf, -0.32, -0.04, 0.5, 1.0);
        emitFallenIronBarrel(b, xf, 0.18, 0.04, 0.08);
      } else {
        emitUprightIronBarrel(b, xf, -0.31, -0.05, 0.3, 1.02);
        emitUprightIronBarrel(b, xf, 0.25, -0.06, 1.9, 0.96);
        // Galão metálico menor encostado na frente
        addLocalBox(b.ironBarrel, xf, 0.24, 0.38, 0.18, 0.0, 0.19, 0.18, 0, 0.25, 0);
        addLocalBox(b.darkIron, xf, 0.12, 0.05, 0.05, 0.0, 0.4, 0.18, 0, 0.25, 0);
      }
      break;
    }

    case 'wooden_barrel_cluster': {
      if (p.role === 'island') {
        emitUprightWoodenBarrel(b, xf, -0.28, -0.2, 0.2, 1.02);
        emitUprightWoodenBarrel(b, xf, 0.29, -0.15, 1.7, 0.98);
        if (p.variant === 0) {
          emitFallenWoodenBarrel(b, xf, 0.0, 0.26, -0.14);
        } else {
          emitUprightWoodenBarrel(b, xf, 0.01, 0.27, 0.9, 0.92);
        }
      } else if (p.variant === 0) {
        emitUprightWoodenBarrel(b, xf, 0.31, -0.04, 0.8, 1.0);
        emitFallenWoodenBarrel(b, xf, -0.17, 0.04, -0.06);
      } else {
        emitUprightWoodenBarrel(b, xf, -0.3, -0.04, 0.4, 1.02);
        emitUprightWoodenBarrel(b, xf, 0.28, -0.05, 2.2, 0.95);
        emitHeavyWoodenCrate(b, xf, 0.36, 0.34, 0.32, 0.0, 0, 0.14, 0.18);
      }
      break;
    }

    case 'metal_shelving_rack': {
      const rackW = 1.42;
      const rackD = 0.6;
      const rackH = 2.14;
      const hw = rackW * 0.5 - 0.03;
      const hd = rackD * 0.5 - 0.03;

      // 4 colunas cantoneiras verticais de ferro escuro
      for (const sx of [-hw, hw]) {
        for (const sz of [-hd, hd]) {
          addLocalBox(b.darkIron, xf, 0.058, rackH, 0.058, sx, rackH * 0.5, sz);
        }
        // Contraventamento diagonal em X nas laterais
        addLocalBox(b.darkIron, xf, 0.028, 1.06, 0.032, sx, 0.62, 0, 0.48, 0, 0);
        addLocalBox(b.darkIron, xf, 0.028, 1.06, 0.032, sx, 1.56, 0, -0.48, 0, 0);
      }
      // Travessa traseira em X
      addLocalBox(b.darkIron, xf, 1.48, 0.035, 0.026, 0, 1.12, -hd, 0, 0, 0.46);
      addLocalBox(b.darkIron, xf, 1.48, 0.035, 0.026, 0, 1.12, -hd, 0, 0, -0.46);

      // 4 bandejas metálicas com bordas dobradas
      const shelfLevels = [0.16, 0.78, 1.4, 2.02];
      for (const sy of shelfLevels) {
        addLocalBox(b.metalTrim, xf, rackW, 0.042, rackD, 0, sy, 0);
        addLocalBox(b.darkIron, xf, rackW + 0.01, 0.058, 0.028, 0, sy, hd + 0.01);
        addLocalBox(b.darkIron, xf, rackW + 0.01, 0.058, 0.028, 0, sy, -hd - 0.01);
      }

      // Carga estocada nas prateleiras (caixas fechadas, tambores técnicos, maletas de ferro)
      emitHeavyWoodenCrate(b, xf, 0.48, 0.44, 0.44, -0.36, 0.185, 0.0, 0.06);
      addLocalCylinder(b.ironBarrel, xf, 0.16, 0.16, 0.48, 10, 0.28, 0.425, -0.02);
      addLocalCylinder(b.darkIron, xf, 0.168, 0.168, 0.03, 10, 0.28, 0.56, -0.02);

      addLocalBox(b.ironBarrel, xf, 0.42, 0.34, 0.42, -0.34, 0.97, 0.02, 0, -0.08, 0);
      emitHeavyWoodenCrate(b, xf, 0.52, 0.42, 0.44, 0.26, 0.805, -0.01, -0.05);

      addLocalBox(b.darkIron, xf, 0.46, 0.28, 0.38, -0.28, 1.56, 0.0, 0, 0.1, 0);
      addLocalBox(b.metalTrim, xf, 0.48, 0.04, 0.4, -0.28, 1.71, 0.0, 0, 0.1, 0);
      if (p.variant !== 1) {
        addLocalCylinder(
          b.ironBarrel,
          xf,
          0.13,
          0.13,
          0.44,
          10,
          0.32,
          1.55,
          0.02,
          0,
          0.12,
          Math.PI * 0.5
        );
      }
      break;
    }

    case 'wooden_shelving_rack': {
      const rackW = 1.42;
      const rackD = 0.62;
      const rackH = 2.08;
      const hw = rackW * 0.5 - 0.045;
      const hd = rackD * 0.5 - 0.045;

      // 4 montantes grossos de madeira envelhecida + cintas de ferro
      for (const sx of [-hw, hw]) {
        for (const sz of [-hd, hd]) {
          addLocalBox(b.weatheredWood, xf, 0.082, rackH, 0.082, sx, rackH * 0.5, sz);
          addLocalBox(b.darkIron, xf, 0.095, 0.06, 0.095, sx, 0.98, sz);
          addLocalBox(b.darkIron, xf, 0.095, 0.06, 0.095, sx, 1.78, sz);
        }
        addLocalBox(b.weatheredWood, xf, 0.05, 0.07, rackD, sx, 0.2, 0);
        addLocalBox(b.weatheredWood, xf, 0.05, 0.07, rackD, sx, 0.98, 0);
        addLocalBox(b.weatheredWood, xf, 0.05, 0.07, rackD, sx, 1.78, 0);
      }

      // 3 pranchões pesados de madeira
      for (const sy of [0.22, 1.0, 1.8]) {
        addLocalBox(b.oakWood, xf, rackW, 0.058, rackD - 0.02, 0, sy, 0);
      }

      // Carga rústica: barrilzinho de madeira, caixotes e blocos
      emitUprightWoodenBarrel(b, xf, -0.34, 0.0, 0.5, 0.68);
      emitHeavyWoodenCrate(b, xf, 0.5, 0.48, 0.44, 0.28, 0.25, 0.0, -0.07);
      emitHeavyWoodenCrate(b, xf, 0.46, 0.44, 0.42, -0.26, 1.03, 0.02, 0.09);
      addLocalCylinder(
        b.oakWood,
        xf,
        0.15,
        0.15,
        0.44,
        10,
        0.3,
        1.18,
        0.0,
        0,
        0.1,
        Math.PI * 0.5
      );
      break;
    }

    case 'wooden_crate_stack': {
      // Estrado/pallet de madeira no chão
      const palW = p.role === 'island' ? 1.2 : 1.24;
      const palD = p.role === 'island' ? 1.04 : 0.72;
      for (const sz of [-palD * 0.38, 0, palD * 0.38]) {
        addLocalBox(b.weatheredWood, xf, palW, 0.06, 0.09, 0, 0.03, sz);
      }
      for (let i = -2; i <= 2; i++) {
        addLocalBox(
          b.oakWood,
          xf,
          palW * 0.17,
          0.03,
          palD,
          i * (palW * 0.2),
          0.075,
          0
        );
      }

      const mainD = p.role === 'island' ? 0.76 : 0.66;
      emitHeavyWoodenCrate(b, xf, 0.74, 0.78, mainD, -0.22, 0.09, -0.02, 0.04);
      emitHeavyWoodenCrate(b, xf, 0.46, 0.52, mainD * 0.82, 0.37, 0.09, 0.02, -0.12);
      // Segundo andar de caixote empilhado!
      emitHeavyWoodenCrate(
        b,
        xf,
        0.58,
        0.6,
        mainD * 0.84,
        -0.16,
        0.87,
        -0.01,
        p.variant === 0 ? -0.16 : 0.19
      );
      break;
    }

    case 'mixed_cargo_depot': {
      const palW = 1.28;
      const palD = p.role === 'island' ? 0.96 : 0.7;
      addLocalBox(b.weatheredWood, xf, palW, 0.07, palD, 0, 0.035, 0);
      addLocalBox(b.darkIron, xf, palW + 0.02, 0.04, 0.04, 0, 0.04, palD * 0.5);
      addLocalBox(b.darkIron, xf, palW + 0.02, 0.04, 0.04, 0, 0.04, -palD * 0.5);

      emitHeavyWoodenCrate(b, xf, 0.66, 0.72, palD * 0.88, -0.28, 0.07, 0, 0.05);
      emitHeavyWoodenCrate(b, xf, 0.48, 0.48, palD * 0.76, -0.26, 0.79, 0, -0.14);
      if (p.gz >= STONE_SECTOR_START_ROW) {
        emitUprightWoodenBarrel(b, xf, 0.34, 0.0, 0.6, 0.94);
      } else {
        emitUprightIronBarrel(b, xf, 0.34, 0.0, 1.2, 0.94);
      }
      break;
    }

    case 'steel_barricade': {
      const bw = 1.3;
      // Trilhos inferiores em viga I de ferro escuro
      for (const sx of [-0.46, 0.46]) {
        addLocalBox(b.darkIron, xf, 0.1, 0.08, 0.62, sx, 0.04, 0);
        // Escoras traseiras inclinadas
        addLocalBox(b.darkIron, xf, 0.075, 0.96, 0.075, sx, 0.48, -0.12, 0.34, 0, 0);
      }
      // Chapa blindada principal levemente inclinada + fresta tática superior
      addLocalBox(b.metalTrim, xf, bw, 0.78, 0.09, 0, 0.45, 0.12, -0.14, 0, 0);
      addLocalBox(b.ironBarrel, xf, bw - 0.08, 0.22, 0.1, 0, 0.52, 0.13, -0.14, 0, 0);
      // Escudo superior com fresta de observação
      addLocalBox(b.darkIron, xf, 0.44, 0.22, 0.09, -0.43, 0.98, 0.05, -0.14, 0, 0);
      addLocalBox(b.darkIron, xf, 0.44, 0.22, 0.09, 0.43, 0.98, 0.05, -0.14, 0, 0);
      addLocalBox(b.metalTrim, xf, bw + 0.04, 0.07, 0.12, 0, 1.08, 0.04);
      break;
    }

    case 'stone_rubble_barricade': {
      // Blocos pesados de alvenaria desmoronada + pranchões cruzados + barril encostado
      addLocalBox(b.stone, xf, 0.68, 0.56, 0.58, -0.28, 0.28, -0.04, 0, 0.08, 0);
      addLocalBox(b.stone, xf, 0.52, 0.48, 0.48, -0.24, 0.78, -0.06, 0.05, -0.14, 0.04);
      addLocalBox(b.stone, xf, 0.48, 0.42, 0.5, 0.28, 0.21, 0.06, 0, 0.22, 0);
      // Pranchões de escoramento cruzados
      addLocalBox(b.weatheredWood, xf, 1.28, 0.14, 0.07, 0, 0.62, 0.18, 0, 0.04, 0.14);
      addLocalBox(b.weatheredWood, xf, 1.22, 0.13, 0.07, 0.04, 0.92, 0.12, 0, -0.05, -0.11);
      emitUprightWoodenBarrel(b, xf, 0.36, -0.06, 0.9, 0.88);
      break;
    }

    case 'low_crawl_obstruction': {
      // Vão livre inferior garantido y = 0..1.18m para agachar [Ctrl] ou deslizar [Shift+Ctrl]!
      const span = 2.92;
      const isSouth = p.gz >= STONE_SECTOR_START_ROW;

      if (isSouth) {
        // Escoramento pesado de madeira arriado entre as paredes de pedra das Catacumbas
        for (const sx of [-1.39, 1.39]) {
          addLocalBox(b.darkIron, xf, 0.14, 0.92, 0.36, sx, 1.66, 0);
          addLocalBox(b.weatheredWood, xf, 0.18, 0.52, 0.28, sx * 0.93, 1.82, 0, 0, 0, sx < 0 ? -0.35 : 0.35);
        }
        // Viga mestra de madeira arriada (base em y ~ 1.20m) + segunda tora cruzada acima
        addLocalBox(b.weatheredWood, xf, span, 0.24, 0.28, 0, 1.34, -0.06, 0, 0, 0.035);
        addLocalBox(b.oakWood, xf, span - 0.06, 0.2, 0.22, 0, 1.66, 0.08, 0, 0, -0.045);
        // Cintas de ferro prendendo a viga rachada
        for (const bx of [-0.85, 0, 0.85]) {
          addLocalBox(b.darkIron, xf, 0.09, 0.28, 0.32, bx, 1.34, -0.06);
        }
      } else {
        // Tubulação industrial rompida + Viga I metálica arriada no Complexo Técnico Norte
        for (const sx of [-1.39, 1.39]) {
          addLocalBox(b.darkIron, xf, 0.14, 0.94, 0.42, sx, 1.67, 0);
          addLocalBox(b.metalTrim, xf, 0.18, 0.12, 0.46, sx, 1.24, 0);
        }
        // Viga I arriada (base em y ~ 1.20m -> bloqueia corrida em pé, livre agachado!)
        addLocalBox(b.metalTrim, xf, span, 0.22, 0.24, 0, 1.33, -0.08, 0, 0, -0.03);
        addLocalBox(b.darkIron, xf, span, 0.05, 0.3, 0, 1.22, -0.08, 0, 0, -0.03);
        addLocalBox(b.darkIron, xf, span, 0.05, 0.3, 0, 1.44, -0.08, 0, 0, -0.03);
        // Duto/cano pressurizado paralelo com flanges rebitados
        addLocalCylinder(
          b.ironBarrel,
          xf,
          0.135,
          0.135,
          span - 0.04,
          10,
          0,
          1.66,
          0.1,
          0,
          0,
          Math.PI * 0.5
        );
        for (const fx of [-0.9, 0, 0.9]) {
          addLocalCylinder(
            b.darkIron,
            xf,
            0.175,
            0.175,
            0.06,
            10,
            fx,
            1.66,
            0.1,
            0,
            0,
            Math.PI * 0.5
          );
        }
      }
      break;
    }
  }
}

function mergeObstacleBucket(
  geos: THREE.BufferGeometry[]
): THREE.BufferGeometry | null {
  if (geos.length === 0) return null;

  let totalVerts = 0;
  let totalIndices = 0;
  for (const g of geos) {
    const pos = g.getAttribute('position');
    totalVerts += pos.count;
    const idx = g.getIndex();
    totalIndices += idx ? idx.count : pos.count;
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

  for (const g of geos) {
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

    const idxAttr = g.getIndex();
    if (idxAttr) {
      const ic = idxAttr.count;
      for (let i = 0; i < ic; i++) {
        indices[iOffset + i] = vOffset + idxAttr.getX(i);
      }
      iOffset += ic;
    } else {
      for (let i = 0; i < count; i++) {
        indices[iOffset + i] = vOffset + i;
      }
      iOffset += count;
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

/**
 * Constrói e acopla à cena todas as malhas 3D em lote dos obstáculos do mapa,
 * registrando seus colisores físicos sólidos (`StaticColliderBox`) no vetor `colliders`.
 */
export function buildDoomMapObstacles(
  parentGroup: THREE.Group,
  placements: ReadonlyArray<ObstaclePlacement>,
  textures: DoomTextureSet,
  sharedUniforms: DoomSharedUniforms,
  colliders: StaticColliderBox[]
): void {
  if (placements.length === 0) return;

  const buckets: ObstacleGeoBuckets = {
    ironBarrel: [],
    oakWood: [],
    weatheredWood: [],
    metalTrim: [],
    darkIron: [],
    stone: [],
  };

  for (const p of placements) {
    emitObstacleGeometry(p, buckets);
    colliders.push({
      id: p.id,
      box: new THREE.Box3(
        new THREE.Vector3(p.minX, p.minY, p.minZ),
        new THREE.Vector3(p.maxX, p.maxY, p.maxZ)
      ),
      isObstacle: true,
      isCrawlUnder: p.role === 'crawl',
    });
  }

  const matIronBarrel = createDoomSurfaceMaterial(
    textures.ironBarrel,
    sharedUniforms
  );
  const matOakWood = createDoomSurfaceMaterial(
    textures.oakStave,
    sharedUniforms
  );
  const matWeatheredWood = createDoomSurfaceMaterial(
    textures.weatheredWood,
    sharedUniforms
  );
  const matMetalTrim = createDoomSurfaceMaterial(
    textures.metalTrim,
    sharedUniforms
  );
  const matDarkIron = createDoomSurfaceMaterial(
    textures.darkIron,
    sharedUniforms
  );
  const matStone = createDoomSurfaceMaterial(
    textures.stoneWall,
    sharedUniforms
  );

  const meshDefs: Array<[THREE.BufferGeometry[], THREE.Material, string]> = [
    [buckets.ironBarrel, matIronBarrel, 'MazeObstaclesIronBarrel'],
    [buckets.oakWood, matOakWood, 'MazeObstaclesOakWood'],
    [buckets.weatheredWood, matWeatheredWood, 'MazeObstaclesWood'],
    [buckets.metalTrim, matMetalTrim, 'MazeObstaclesMetal'],
    [buckets.darkIron, matDarkIron, 'MazeObstaclesDarkIron'],
    [buckets.stone, matStone, 'MazeObstaclesStone'],
  ];

  for (const [geos, mat, name] of meshDefs) {
    const merged = mergeObstacleBucket(geos);
    if (merged) {
      const m = new THREE.Mesh(merged, mat);
      m.name = name;
      parentGroup.add(m);
    }
  }
}
