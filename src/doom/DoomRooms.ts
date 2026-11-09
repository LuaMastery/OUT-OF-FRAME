import * as THREE from 'three';
import { StaticColliderBox } from '../engine/physics/SpatialSweep';
import {
  CELL_SIZE,
  gridCellToWorld,
  isSolidCell,
  LABYRINTH_MAP,
  WALL_HEIGHT,
} from './DoomMazeBuilder';
import { createDoomSurfaceMaterial, DoomSharedUniforms } from './DoomShader';
import { DoomTextureSet } from './DoomTextures';

export type DoomRoomId =
  | 'computer_room'
  | 'biology_lab'
  | 'crew_quarters'
  | 'medical_ward'
  | 'vegetation_room'
  | 'library_room'
  | 'reactor_hall';

export type RoomFurnitureKind =
  | 'server_rack_bank'
  | 'crt_workstation_desk'
  | 'bio_specimen_tank'
  | 'autopsy_surgical_table'
  | 'xenobio_lab_bench'
  | 'cryo_biohazard_cabinet'
  | 'astronaut_bunk_bed'
  | 'crew_locker_bank'
  | 'crew_mess_table'
  | 'cabin_nightstand_desk'
  | 'medical_gurney_bed'
  | 'medical_supply_cabinet'
  | 'vitals_monitor_cart'
  | 'hydroponic_tree_planter'
  | 'botanical_fern_trough'
  | 'irrigation_nutrient_tank'
  | 'oak_bookshelf_tall'
  | 'library_reading_table'
  | 'archive_catalog_cabinet'
  | 'reactor_capacitor_console';

export type AnnexOutwardDir = 'N' | 'S' | 'W' | 'E';

export interface ThemedRoomDefinition {
  id: DoomRoomId;
  name: string;
  subtitle: string;
  /** Limites em células de grade da Ala Externa (100% fora de 0..28 x 0..28!) */
  minGx: number;
  maxGx: number;
  minGz: number;
  maxGz: number;
  /** Célula do muro perimetral (0 ou 28) aberta como Pórtico Blindado de Acesso */
  doorGx: number;
  doorGz: number;
  /** Célula aberta interna do labirinto (1..27) imediatamente em frente ao pórtico */
  innerGx: number;
  innerGz: number;
  /** Direção cardeal para fora do mapa 29x29 */
  outwardDir: AnnexOutwardDir;
}

export interface RoomFurniturePlacement {
  id: string;
  roomId: DoomRoomId;
  kind: RoomFurnitureKind;
  gx: number;
  gz: number;
  worldX: number;
  worldZ: number;
  yaw: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

export interface DoomAnnexLightSpec {
  position: THREE.Vector3;
  baseIntensity: number;
  flicker: boolean;
  phase: number;
}

/** Limites estendidos de grade abrangendo o mapa 29x29 (0..28) + todas as 7 Salas Externas (-5..33) */
export const ANNEX_MIN_GRID = -6;
export const ANNEX_MAX_GRID = 34;

/**
 * Catálogo oficial das 7 Salas Especiais Externas ("Fora do Mapa" — Alas Anexas ao redor do perímetro 29x29):
 * Cada sala projeta-se para fora da muralha externa através de um pórtico blindado exclusivo
 * e possui arquitetura 3D própria com novas texturas de Parede, Chão e Teto!
 */
export const THEMED_ROOMS: ReadonlyArray<ThemedRoomDefinition> = [
  {
    id: 'computer_room',
    name: 'SALA DOS COMPUTADORES',
    subtitle: 'Ala Norte — Mainframe Central, Servidores & Telemetria CRT',
    minGx: 9,
    maxGx: 13,
    minGz: -5,
    maxGz: -1,
    doorGx: 11,
    doorGz: 0,
    innerGx: 11,
    innerGz: 1,
    outwardDir: 'N',
  },
  {
    id: 'reactor_hall',
    name: 'SALÃO DOS REATORES',
    subtitle: 'Ala Nordeste — Núcleo Tokamak & Bancos de Capacitores',
    minGx: 23,
    maxGx: 27,
    minGz: -5,
    maxGz: -1,
    doorGx: 25,
    doorGz: 0,
    innerGx: 25,
    innerGz: 1,
    outwardDir: 'N',
  },
  {
    id: 'biology_lab',
    name: 'LABORATÓRIO BIOLÓGICO',
    subtitle: 'Ala Noroeste — Contenção Xenobiológica & Tanques de Espécimes',
    minGx: -5,
    maxGx: -1,
    minGz: 3,
    maxGz: 7,
    doorGx: 0,
    doorGz: 5,
    innerGx: 1,
    innerGz: 5,
    outwardDir: 'W',
  },
  {
    id: 'crew_quarters',
    name: 'QUARTOS DA EQUIPE',
    subtitle: 'Ala Oeste — Dormitórios de Beliches, Armários & Refeitório',
    minGx: -5,
    maxGx: -1,
    minGz: 10,
    maxGz: 14,
    doorGx: 0,
    doorGz: 11,
    innerGx: 1,
    innerGz: 11,
    outwardDir: 'W',
  },
  {
    id: 'medical_ward',
    name: 'ENFERMARIA & QUARENTENA',
    subtitle: 'Ala Leste — Leitos Clínicos, Triagem & Suprimentos Médicos',
    minGx: 29,
    maxGx: 33,
    minGz: 10,
    maxGz: 14,
    doorGx: 28,
    doorGz: 12,
    innerGx: 27,
    innerGz: 12,
    outwardDir: 'E',
  },
  {
    id: 'library_room',
    name: 'BIBLIOTECA & ARQUIVOS',
    subtitle: 'Ala Sudeste — Acervo Científico, Estantes de Carvalho & Leitura',
    minGx: 29,
    maxGx: 33,
    minGz: 18,
    maxGz: 22,
    doorGx: 28,
    doorGz: 20,
    innerGx: 27,
    innerGz: 20,
    outwardDir: 'E',
  },
  {
    id: 'vegetation_room',
    name: 'SALA DE VEGETAÇÃO',
    subtitle: 'Ala Sul — Biodomo Hidropônico Subterrâneo & Flora Experimental',
    minGx: 4,
    maxGx: 8,
    minGz: 29,
    maxGz: 33,
    doorGx: 6,
    doorGz: 28,
    innerGx: 6,
    innerGz: 27,
    outwardDir: 'S',
  },
];

/**
 * Retorna a Sala Especial correspondente à célula `(gx, gz)` (incluindo seu pórtico de entrada),
 * ou `null` caso esteja nos corredores gerais do labirinto 29x29.
 */
export function getThemedRoomAtCell(
  gx: number,
  gz: number
): ThemedRoomDefinition | null {
  for (const r of THEMED_ROOMS) {
    if (
      (gx >= r.minGx && gx <= r.maxGx && gz >= r.minGz && gz <= r.maxGz) ||
      (gx === r.doorGx && gz === r.doorGz)
    ) {
      return r;
    }
  }
  return null;
}

/**
 * Retorna a Sala Especial cujo pórtico corta a célula perimetral `(gx, gz)`, ou `null`.
 */
export function getThemedRoomByDoorCell(
  gx: number,
  gz: number
): ThemedRoomDefinition | null {
  for (const r of THEMED_ROOMS) {
    if (gx === r.doorGx && gz === r.doorGz) return r;
  }
  return null;
}

export function isThemedRoomDoorCell(gx: number, gz: number): boolean {
  return getThemedRoomByDoorCell(gx, gz) !== null;
}

/**
 * Indica se `(gx, gz)` faz parte do vão de acesso imediato (corredor interno, pórtico ou vestíbulo)
 * de alguma Sala Especial Externa, impedindo bloqueios por caixotes ou obstáculos.
 */
export function isThemedRoomThresholdCell(gx: number, gz: number): boolean {
  for (const r of THEMED_ROOMS) {
    if (gx === r.doorGx && gz === r.doorGz) return true;
    if (gx === r.innerGx && gz === r.innerGz) return true;
    const ox = r.outwardDir === 'E' ? 1 : r.outwardDir === 'W' ? -1 : 0;
    const oz = r.outwardDir === 'S' ? 1 : r.outwardDir === 'N' ? -1 : 0;
    if (gx === r.doorGx + ox && gz === r.doorGz + oz) return true;
  }
  return false;
}

/**
 * Indica se uma célula `(gx, gz)` é transitável considerando tanto o labirinto 29x29
 * quanto os 7 pórticos perimetrais e o interior das 7 Salas Externas!
 */
export function isWalkableArenaCell(gx: number, gz: number): boolean {
  const rows = LABYRINTH_MAP.length;
  const cols = LABYRINTH_MAP[0].length;
  if (gx >= 0 && gx < cols && gz >= 0 && gz < rows) {
    if (!isSolidCell(LABYRINTH_MAP, gx, gz)) return true;
    return isThemedRoomDoorCell(gx, gz);
  }
  const room = getThemedRoomAtCell(gx, gz);
  if (!room) return false;
  // No Salão dos Reatores, o centro exato (25, -3) abriga o Núcleo Tokamak sólido
  if (room.id === 'reactor_hall' && gx === 25 && gz === -3) {
    return false;
  }
  return true;
}

// ============================================================================
// GERADOR DE MOBILIÁRIO 3D ESPECÍFICO NAS SALAS EXTERNAS
// ============================================================================

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

function getFurnitureDimensions(kind: RoomFurnitureKind): {
  width: number;
  depth: number;
  maxY: number;
} {
  switch (kind) {
    case 'server_rack_bank':
      return { width: 1.58, depth: 0.76, maxY: 2.34 };
    case 'crt_workstation_desk':
      return { width: 1.56, depth: 0.88, maxY: 1.42 };
    case 'bio_specimen_tank':
      return { width: 1.08, depth: 1.02, maxY: 2.48 };
    case 'autopsy_surgical_table':
      return { width: 1.72, depth: 0.88, maxY: 1.72 };
    case 'xenobio_lab_bench':
      return { width: 1.6, depth: 0.78, maxY: 1.48 };
    case 'cryo_biohazard_cabinet':
      return { width: 1.44, depth: 0.72, maxY: 2.18 };
    case 'astronaut_bunk_bed':
      return { width: 1.88, depth: 0.88, maxY: 1.88 };
    case 'crew_locker_bank':
      return { width: 1.54, depth: 0.72, maxY: 2.14 };
    case 'crew_mess_table':
      return { width: 1.62, depth: 1.06, maxY: 0.96 };
    case 'cabin_nightstand_desk':
      return { width: 1.36, depth: 0.76, maxY: 1.34 };
    case 'medical_gurney_bed':
      return { width: 1.82, depth: 0.88, maxY: 1.72 };
    case 'medical_supply_cabinet':
      return { width: 1.48, depth: 0.68, maxY: 2.12 };
    case 'vitals_monitor_cart':
      return { width: 1.24, depth: 0.74, maxY: 1.58 };
    case 'hydroponic_tree_planter':
      return { width: 1.54, depth: 0.92, maxY: 2.52 };
    case 'botanical_fern_trough':
      return { width: 1.54, depth: 0.8, maxY: 1.64 };
    case 'irrigation_nutrient_tank':
      return { width: 1.38, depth: 0.78, maxY: 1.94 };
    case 'oak_bookshelf_tall':
      return { width: 1.64, depth: 0.72, maxY: 2.38 };
    case 'library_reading_table':
      return { width: 1.54, depth: 1.16, maxY: 1.32 };
    case 'archive_catalog_cabinet':
      return { width: 1.5, depth: 0.7, maxY: 1.76 };
    case 'reactor_capacitor_console':
      return { width: 1.58, depth: 0.8, maxY: 2.04 };
  }
}

function computeRotatedAabb(
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

interface RawRoomFurnitureSpec {
  roomId: DoomRoomId;
  kind: RoomFurnitureKind;
  gx: number;
  gz: number;
  /** Parede da sala onde encosta ('N' | 'S' | 'W' | 'E') ou ilha central ('CENTER') */
  attach: 'N' | 'S' | 'W' | 'E' | 'CENTER';
  /** Rotação opcional para peças centrais */
  centerYaw?: number;
}

const CURATED_ROOM_SPECS: ReadonlyArray<RawRoomFurnitureSpec> = [
  // 1. SALA DOS COMPUTADORES — Ala Norte (gx 9..13, gz -5..-1, entrada em (11, -1))
  { roomId: 'computer_room', kind: 'server_rack_bank', gx: 9, gz: -5, attach: 'N' },
  { roomId: 'computer_room', kind: 'server_rack_bank', gx: 11, gz: -5, attach: 'N' },
  { roomId: 'computer_room', kind: 'server_rack_bank', gx: 13, gz: -5, attach: 'N' },
  { roomId: 'computer_room', kind: 'server_rack_bank', gx: 9, gz: -3, attach: 'W' },
  { roomId: 'computer_room', kind: 'server_rack_bank', gx: 13, gz: -3, attach: 'E' },
  { roomId: 'computer_room', kind: 'crt_workstation_desk', gx: 10, gz: -4, attach: 'CENTER', centerYaw: 0 },
  { roomId: 'computer_room', kind: 'crt_workstation_desk', gx: 12, gz: -4, attach: 'CENTER', centerYaw: 0 },
  { roomId: 'computer_room', kind: 'crt_workstation_desk', gx: 9, gz: -1, attach: 'S' },
  { roomId: 'computer_room', kind: 'crt_workstation_desk', gx: 13, gz: -1, attach: 'S' },

  // 2. SALÃO DOS REATORES — Ala Nordeste (gx 23..27, gz -5..-1, entrada em (25, -1), núcleo Tokamak em (25, -3))
  { roomId: 'reactor_hall', kind: 'reactor_capacitor_console', gx: 23, gz: -5, attach: 'N' },
  { roomId: 'reactor_hall', kind: 'crt_workstation_desk', gx: 25, gz: -5, attach: 'N' },
  { roomId: 'reactor_hall', kind: 'reactor_capacitor_console', gx: 27, gz: -5, attach: 'N' },
  { roomId: 'reactor_hall', kind: 'reactor_capacitor_console', gx: 23, gz: -3, attach: 'W' },
  { roomId: 'reactor_hall', kind: 'reactor_capacitor_console', gx: 27, gz: -3, attach: 'E' },
  { roomId: 'reactor_hall', kind: 'crt_workstation_desk', gx: 23, gz: -1, attach: 'S' },
  { roomId: 'reactor_hall', kind: 'crt_workstation_desk', gx: 27, gz: -1, attach: 'S' },

  // 3. LABORATÓRIO BIOLÓGICO — Ala Noroeste (gx -5..-1, gz 3..7, entrada em (-1, 5))
  { roomId: 'biology_lab', kind: 'bio_specimen_tank', gx: -5, gz: 3, attach: 'N' },
  { roomId: 'biology_lab', kind: 'bio_specimen_tank', gx: -3, gz: 3, attach: 'N' },
  { roomId: 'biology_lab', kind: 'xenobio_lab_bench', gx: -1, gz: 3, attach: 'N' },
  { roomId: 'biology_lab', kind: 'cryo_biohazard_cabinet', gx: -5, gz: 4, attach: 'W' },
  { roomId: 'biology_lab', kind: 'autopsy_surgical_table', gx: -3, gz: 5, attach: 'CENTER', centerYaw: 0 },
  { roomId: 'biology_lab', kind: 'cryo_biohazard_cabinet', gx: -5, gz: 6, attach: 'W' },
  { roomId: 'biology_lab', kind: 'bio_specimen_tank', gx: -5, gz: 7, attach: 'S' },
  { roomId: 'biology_lab', kind: 'bio_specimen_tank', gx: -3, gz: 7, attach: 'S' },
  { roomId: 'biology_lab', kind: 'xenobio_lab_bench', gx: -1, gz: 7, attach: 'S' },

  // 4. QUARTOS DA EQUIPE — Ala Oeste (gx -5..-1, gz 10..14, entrada em (-1, 11))
  { roomId: 'crew_quarters', kind: 'astronaut_bunk_bed', gx: -5, gz: 10, attach: 'N' },
  { roomId: 'crew_quarters', kind: 'astronaut_bunk_bed', gx: -3, gz: 10, attach: 'N' },
  { roomId: 'crew_quarters', kind: 'cabin_nightstand_desk', gx: -1, gz: 10, attach: 'N' },
  { roomId: 'crew_quarters', kind: 'astronaut_bunk_bed', gx: -5, gz: 12, attach: 'W' },
  { roomId: 'crew_quarters', kind: 'crew_mess_table', gx: -3, gz: 12, attach: 'CENTER', centerYaw: 0 },
  { roomId: 'crew_quarters', kind: 'crew_locker_bank', gx: -1, gz: 13, attach: 'E' },
  { roomId: 'crew_quarters', kind: 'astronaut_bunk_bed', gx: -5, gz: 14, attach: 'S' },
  { roomId: 'crew_quarters', kind: 'cabin_nightstand_desk', gx: -3, gz: 14, attach: 'S' },
  { roomId: 'crew_quarters', kind: 'crew_locker_bank', gx: -1, gz: 14, attach: 'S' },

  // 5. ENFERMARIA & QUARENTENA — Ala Leste (gx 29..33, gz 10..14, entrada em (29, 12))
  { roomId: 'medical_ward', kind: 'medical_supply_cabinet', gx: 29, gz: 10, attach: 'N' },
  { roomId: 'medical_ward', kind: 'medical_gurney_bed', gx: 31, gz: 10, attach: 'N' },
  { roomId: 'medical_ward', kind: 'medical_gurney_bed', gx: 33, gz: 10, attach: 'N' },
  { roomId: 'medical_ward', kind: 'vitals_monitor_cart', gx: 31, gz: 12, attach: 'CENTER', centerYaw: Math.PI * 0.5 },
  { roomId: 'medical_ward', kind: 'medical_supply_cabinet', gx: 33, gz: 12, attach: 'E' },
  { roomId: 'medical_ward', kind: 'medical_supply_cabinet', gx: 29, gz: 14, attach: 'S' },
  { roomId: 'medical_ward', kind: 'medical_gurney_bed', gx: 31, gz: 14, attach: 'S' },
  { roomId: 'medical_ward', kind: 'medical_gurney_bed', gx: 33, gz: 14, attach: 'S' },
  { roomId: 'medical_ward', kind: 'vitals_monitor_cart', gx: 33, gz: 13, attach: 'E' },

  // 6. BIBLIOTECA & ARQUIVOS — Ala Sudeste (gx 29..33, gz 18..22, entrada em (29, 20))
  { roomId: 'library_room', kind: 'archive_catalog_cabinet', gx: 29, gz: 18, attach: 'N' },
  { roomId: 'library_room', kind: 'oak_bookshelf_tall', gx: 31, gz: 18, attach: 'N' },
  { roomId: 'library_room', kind: 'oak_bookshelf_tall', gx: 33, gz: 18, attach: 'N' },
  { roomId: 'library_room', kind: 'oak_bookshelf_tall', gx: 33, gz: 19, attach: 'E' },
  { roomId: 'library_room', kind: 'library_reading_table', gx: 31, gz: 19, attach: 'CENTER', centerYaw: 0 },
  { roomId: 'library_room', kind: 'library_reading_table', gx: 31, gz: 21, attach: 'CENTER', centerYaw: 0 },
  { roomId: 'library_room', kind: 'oak_bookshelf_tall', gx: 33, gz: 21, attach: 'E' },
  { roomId: 'library_room', kind: 'archive_catalog_cabinet', gx: 29, gz: 22, attach: 'S' },
  { roomId: 'library_room', kind: 'oak_bookshelf_tall', gx: 31, gz: 22, attach: 'S' },
  { roomId: 'library_room', kind: 'oak_bookshelf_tall', gx: 33, gz: 22, attach: 'S' },

  // 7. SALA DE VEGETAÇÃO — Ala Sul (gx 4..8, gz 29..33, entrada em (6, 29))
  { roomId: 'vegetation_room', kind: 'irrigation_nutrient_tank', gx: 4, gz: 29, attach: 'N' },
  { roomId: 'vegetation_room', kind: 'irrigation_nutrient_tank', gx: 8, gz: 29, attach: 'N' },
  { roomId: 'vegetation_room', kind: 'hydroponic_tree_planter', gx: 4, gz: 30, attach: 'W' },
  { roomId: 'vegetation_room', kind: 'hydroponic_tree_planter', gx: 8, gz: 30, attach: 'E' },
  { roomId: 'vegetation_room', kind: 'hydroponic_tree_planter', gx: 6, gz: 31, attach: 'CENTER', centerYaw: 0 },
  { roomId: 'vegetation_room', kind: 'botanical_fern_trough', gx: 4, gz: 32, attach: 'W' },
  { roomId: 'vegetation_room', kind: 'botanical_fern_trough', gx: 8, gz: 32, attach: 'E' },
  { roomId: 'vegetation_room', kind: 'hydroponic_tree_planter', gx: 4, gz: 33, attach: 'S' },
  { roomId: 'vegetation_room', kind: 'botanical_fern_trough', gx: 6, gz: 33, attach: 'S' },
  { roomId: 'vegetation_room', kind: 'hydroponic_tree_planter', gx: 8, gz: 33, attach: 'S' },
];

export function generateThemedRoomFurnishings(_opts: {
  reservedLairCellKeys: ReadonlySet<string>;
  lairCell: { gx: number; gz: number };
}): RoomFurniturePlacement[] {
  const out: RoomFurniturePlacement[] = [];
  const placedPadded: Aabb2D[] = [];
  const halfCell = CELL_SIZE * 0.5;

  const attachMap: Record<
    Exclude<RawRoomFurnitureSpec['attach'], 'CENTER'>,
    { nx: number; nz: number; yaw: number }
  > = {
    N: { nx: 0, nz: -1, yaw: 0 },
    S: { nx: 0, nz: 1, yaw: Math.PI },
    W: { nx: -1, nz: 0, yaw: -Math.PI * 0.5 },
    E: { nx: 1, nz: 0, yaw: Math.PI * 0.5 },
  };

  for (let i = 0; i < CURATED_ROOM_SPECS.length; i++) {
    const spec = CURATED_ROOM_SPECS[i];
    const room = THEMED_ROOMS.find((r) => r.id === spec.roomId);
    if (!room) continue;
    if (isThemedRoomThresholdCell(spec.gx, spec.gz)) continue;

    const dims = getFurnitureDimensions(spec.kind);
    const cellCenter = gridCellToWorld(spec.gx, spec.gz);
    let wx = cellCenter.x;
    let wz = cellCenter.z;
    let yaw = spec.centerYaw ?? 0;

    if (spec.attach !== 'CENTER') {
      const dir = attachMap[spec.attach];
      // Revestimento interno extra (0.20m) na parede que encosta no perímetro do labirinto; 0.08m nas demais paredes externas
      const touchesEntrySide =
        (room.outwardDir === 'N' && spec.attach === 'S') ||
        (room.outwardDir === 'S' && spec.attach === 'N') ||
        (room.outwardDir === 'W' && spec.attach === 'E') ||
        (room.outwardDir === 'E' && spec.attach === 'W');
      const wallLining = touchesEntrySide ? 0.22 : 0.08;
      const distFromEdge = wallLining + dims.depth * 0.5;
      wx = cellCenter.x + dir.nx * (halfCell - distFromEdge);
      wz = cellCenter.z + dir.nz * (halfCell - distFromEdge);
      yaw = dir.yaw;
    }

    const aabb = computeRotatedAabb(wx, wz, dims.width, dims.depth, yaw);
    const padded: Aabb2D = {
      minX: aabb.minX - 0.08,
      maxX: aabb.maxX + 0.08,
      minZ: aabb.minZ - 0.08,
      maxZ: aabb.maxZ + 0.08,
    };
    if (placedPadded.some((prev) => aabb2DOverlaps(padded, prev))) {
      continue;
    }
    placedPadded.push(padded);

    out.push({
      id: `room-prop-${spec.roomId}-${i}`,
      roomId: spec.roomId,
      kind: spec.kind,
      gx: spec.gx,
      gz: spec.gz,
      worldX: wx,
      worldZ: wz,
      yaw,
      minX: aabb.minX,
      maxX: aabb.maxX,
      minY: 0,
      maxY: dims.maxY,
      minZ: aabb.minZ,
      maxZ: aabb.maxZ,
    });
  }

  return out;
}

// ============================================================================
// TEXTURAS PIXEL-ART EXCLUSIVAS DAS SALAS ESPECIAIS
// ============================================================================

function hash2i(x: number, y: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + seed * 1442695041) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function clampByte(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}

function makeRoomPixelTex(
  w: number,
  h: number,
  draw: (px: (x: number, y: number, r: number, g: number, b: number) => void) => void
): THREE.DataTexture {
  const data = new Uint8Array(w * h * 4);
  const px = (x: number, y: number, r: number, g: number, b: number) => {
    const wx = ((x % w) + w) % w;
    const wy = ((y % h) + h) % h;
    const idx = ((h - 1 - wy) * w + wx) * 4;
    data[idx] = clampByte(r);
    data[idx + 1] = clampByte(g);
    data[idx + 2] = clampByte(b);
    data[idx + 3] = 255;
  };
  draw(px);
  const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

interface RoomMaterials {
  annexWall: THREE.ShaderMaterial;
  annexFloor: THREE.ShaderMaterial;
  annexCeiling: THREE.ShaderMaterial;
  serverRack: THREE.ShaderMaterial;
  crtScreen: THREE.ShaderMaterial;
  bookshelf: THREE.ShaderMaterial;
  libraryRug: THREE.ShaderMaterial;
  foliage: THREE.ShaderMaterial;
  mossSoil: THREE.ShaderMaterial;
  bioFluid: THREE.ShaderMaterial;
  labTile: THREE.ShaderMaterial;
  techFloor: THREE.ShaderMaterial;
  bunkFabric: THREE.ShaderMaterial;
  cleanLinen: THREE.ShaderMaterial;
  medicalCross: THREE.ShaderMaterial;
  warmLampGlow: THREE.ShaderMaterial;
  oakWood: THREE.ShaderMaterial;
  weatheredWood: THREE.ShaderMaterial;
  metalTrim: THREE.ShaderMaterial;
  darkIron: THREE.ShaderMaterial;
  stone: THREE.ShaderMaterial;
}

function createRoomMaterials(
  textures: DoomTextureSet,
  sharedUniforms: DoomSharedUniforms
): RoomMaterials {
  // 1. Painel Frontal de Mainframe / Rack de Servidores (LEDs de telemetria + baias ventiladas)
  const serverTex = makeRoomPixelTex(128, 128, (px) => {
    for (let y = 0; y < 128; y++) {
      for (let x = 0; x < 128; x++) {
        const border = x < 6 || x >= 122 || y < 5 || y >= 123;
        const unitY = y % 16;
        const n = (hash2i(x, y, 101) - 0.5) * 8;
        if (border) {
          px(x, y, 36 + n, 40 + n, 46 + n);
          continue;
        }
        if (unitY === 0 || unitY === 15) {
          px(x, y, 18, 20, 24);
          continue;
        }
        if (x >= 12 && x <= 74 && unitY >= 4 && unitY <= 11) {
          const slot = (x + unitY) % 4 === 0 ? 14 : 28;
          px(x, y, slot, slot + 3, slot + 6);
          continue;
        }
        if (x >= 84 && x <= 114 && unitY >= 5 && unitY <= 9) {
          const ledIdx = Math.floor((x - 84) / 6);
          const ledLocal = (x - 84) % 6;
          if (ledLocal >= 1 && ledLocal <= 3) {
            const seed = hash2i(ledIdx, Math.floor(y / 16), 777);
            if (seed > 0.72) {
              px(x, y, 240, 176, 48);
              continue;
            }
            if (seed > 0.28) {
              px(x, y, 52, 232, 132);
              continue;
            }
            if (seed > 0.14) {
              px(x, y, 226, 58, 58);
              continue;
            }
          }
        }
        px(x, y, 30 + n, 34 + n, 40 + n);
      }
    }
  });

  // 2. Tela de Monitor CRT Fosforescente (linhas de código/telemetria verde/âmbar + scanlines)
  const crtTex = makeRoomPixelTex(64, 64, (px) => {
    for (let y = 0; y < 64; y++) {
      for (let x = 0; x < 64; x++) {
        if (x < 4 || x >= 60 || y < 4 || y >= 60) {
          px(x, y, 28, 32, 34);
          continue;
        }
        const scan = y % 2 === 0 ? 1.0 : 0.72;
        const wave = Math.round(32 + Math.sin(x * 0.28) * 8);
        const isGraph = y >= 36 && Math.abs(y - wave - 12) <= 1 && x > 8 && x < 56;
        const isTextLine =
          y < 34 &&
          y > 7 &&
          y % 4 !== 0 &&
          x > 7 &&
          x < 14 + Math.floor(hash2i(0, Math.floor(y / 4), 303) * 40) &&
          hash2i(Math.floor(x / 3), y, 309) > 0.25;

        if (isGraph) {
          px(x, y, 90 * scan, 255 * scan, 178 * scan);
        } else if (isTextLine) {
          px(x, y, 64 * scan, 236 * scan, 146 * scan);
        } else {
          px(x, y, 10 * scan, 42 * scan, 28 * scan);
        }
      }
    }
  });

  // 3. Estante Clássica de Livros (fileiras coloridas de lombadas antigas encadernadas)
  const bookshelfTex = makeRoomPixelTex(128, 128, (px) => {
    const palette: Array<[number, number, number]> = [
      [126, 38, 34],
      [42, 78, 56],
      [44, 62, 104],
      [118, 82, 42],
      [88, 52, 38],
      [132, 106, 52],
      [68, 44, 76],
    ];
    for (let y = 0; y < 128; y++) {
      const shelfRow = Math.floor(y / 32);
      const ly = y % 32;
      for (let x = 0; x < 128; x++) {
        const n = (hash2i(x, y, 401) - 0.5) * 9;
        if (ly < 4 || x < 4 || x >= 124) {
          px(x, y, 78 + n, 50 + n * 0.7, 28 + n * 0.5);
          continue;
        }
        const bookIdx = Math.floor((x + shelfRow * 7) / 8);
        const bx = (x + shelfRow * 7) % 8;
        const topGap = 3 + Math.floor(hash2i(bookIdx, shelfRow, 419) * 5);
        if (ly >= 32 - topGap || bx === 0) {
          px(x, y, 18, 13, 10);
          continue;
        }
        const [cr, cg, cb] = palette[(bookIdx * 5 + shelfRow * 3) % palette.length];
        const goldBand = ly === 9 || ly === 21 ? 46 : 0;
        const shade = bx === 1 ? 12 : bx === 7 ? -14 : 0;
        px(
          x,
          y,
          cr + shade + goldBand + n * 0.6,
          cg + shade + goldBand * 0.85 + n * 0.6,
          cb + shade + goldBand * 0.35 + n * 0.6
        );
      }
    }
  });

  // 4. Tapete Persa / Bordô de Biblioteca
  const rugTex = makeRoomPixelTex(128, 128, (px) => {
    for (let y = 0; y < 128; y++) {
      for (let x = 0; x < 128; x++) {
        const dx = Math.min(x, 127 - x);
        const dy = Math.min(y, 127 - y);
        const edge = Math.min(dx, dy);
        const weave = ((x + y) % 2 === 0 ? 3 : -3) + (hash2i(x, y, 503) - 0.5) * 5;
        if (edge < 5) {
          px(x, y, 138 + weave, 108 + weave, 52 + weave);
        } else if (edge < 13) {
          const pat = (x % 8 < 4) !== (y % 8 < 4) ? 22 : -12;
          px(x, y, 96 + pat + weave, 32 + weave, 28 + weave);
        } else {
          const cx = x - 64;
          const cy = y - 64;
          const med = Math.abs(cx) + Math.abs(cy);
          if (med < 26 && med > 18) {
            px(x, y, 146 + weave, 114 + weave, 56 + weave);
          } else {
            px(x, y, 108 + weave, 28 + weave, 30 + weave);
          }
        }
      }
    }
  });

  // 5. Copa Densa de Folhagem / Samambaia Subterrânea
  const foliageTex = makeRoomPixelTex(64, 64, (px) => {
    for (let y = 0; y < 64; y++) {
      for (let x = 0; x < 64; x++) {
        const cluster = hash2i(x >> 2, y >> 2, 601);
        const detail = hash2i(x, y, 607);
        const vein = (x + y) % 7 === 0 ? 14 : 0;
        const g = 74 + cluster * 56 + detail * 24 + vein;
        const r = 24 + cluster * 24 + detail * 10;
        const b = 26 + cluster * 18;
        px(x, y, r, g, b);
      }
    }
  });

  // 6. Terra Úmida e Musgo Hidropônico
  const mossSoilTex = makeRoomPixelTex(64, 64, (px) => {
    for (let y = 0; y < 64; y++) {
      for (let x = 0; x < 64; x++) {
        const moss = hash2i(x >> 2, y >> 2, 613);
        const grit = (hash2i(x, y, 619) - 0.5) * 16;
        if (moss > 0.56) {
          px(x, y, 36 + grit * 0.5, 78 + moss * 34 + grit, 32 + grit * 0.4);
        } else {
          px(x, y, 56 + grit, 40 + grit * 0.8, 26 + grit * 0.6);
        }
      }
    }
  });

  // 7. Fluido Bioluminescente Ciano-Esmeralda de Tanque de Espécimes
  const bioFluidTex = makeRoomPixelTex(64, 64, (px) => {
    for (let y = 0; y < 64; y++) {
      for (let x = 0; x < 64; x++) {
        const bubble =
          hash2i(x >> 1, (y + (x % 3)) >> 1, 701) > 0.91 ? 65 : 0;
        const grad = 1 - Math.abs(y - 32) / 48;
        px(
          x,
          y,
          36 + bubble * 0.7,
          178 * grad + 44 + bubble,
          162 * grad + 48 + bubble
        );
      }
    }
  });

  // 8. Ladrilho Cerâmico Clínico (Enfermaria & Lab Biológico)
  const labTileTex = makeRoomPixelTex(64, 64, (px) => {
    for (let y = 0; y < 64; y++) {
      const ly = y % 16;
      for (let x = 0; x < 64; x++) {
        const lx = x % 16;
        const grime = (hash2i(x, y, 809) - 0.5) * 8;
        if (lx === 0 || ly === 0) {
          px(x, y, 54, 64, 66);
          continue;
        }
        const checker = ((Math.floor(x / 16) + Math.floor(y / 16)) % 2) * 8;
        const base = 112 + checker + grime;
        px(x, y, base * 0.92, base * 1.0, base * 1.02);
      }
    }
  });

  // 9. Piso Elevado Antiestático Perfurado (Sala dos Computadores & Reator)
  const techFloorTex = makeRoomPixelTex(64, 64, (px) => {
    for (let y = 0; y < 64; y++) {
      const ly = y % 32;
      for (let x = 0; x < 64; x++) {
        const lx = x % 32;
        if (lx === 0 || ly === 0 || lx === 31 || ly === 31) {
          px(x, y, 22, 28, 34);
          continue;
        }
        const hole =
          lx > 5 && lx < 26 && ly > 5 && ly < 26 && lx % 4 === 0 && ly % 4 === 0;
        if (hole) {
          px(x, y, 16, 22, 28);
        } else {
          const n = (hash2i(x, y, 821) - 0.5) * 6;
          px(x, y, 50 + n, 58 + n, 68 + n);
        }
      }
    }
  });

  // 10. Tecido Militar Acolchoado de Beliche (Quartos da Equipe)
  const bunkFabricTex = makeRoomPixelTex(64, 64, (px) => {
    for (let y = 0; y < 64; y++) {
      for (let x = 0; x < 64; x++) {
        const seam = (x + y) % 16 === 0 || (x - y + 64) % 16 === 0 ? -10 : 0;
        const weave = (hash2i(x, y, 839) - 0.5) * 8;
        px(x, y, 58 + seam + weave, 78 + seam + weave, 62 + seam + weave);
      }
    }
  });

  // 11. Lençol Clínico Claro & Travesseiros (Enfermaria / Dormitórios)
  const cleanLinenTex = makeRoomPixelTex(64, 64, (px) => {
    for (let y = 0; y < 64; y++) {
      for (let x = 0; x < 64; x++) {
        const fold = Math.sin(x * 0.22) * 6;
        const n = (hash2i(x, y, 851) - 0.5) * 6;
        const v = 166 + fold + n;
        px(x, y, v * 0.96, v * 0.98, v);
      }
    }
  });

  // 12. Emblema Cruz Médica (Armários de Suprimentos Clínicos)
  const medCrossTex = makeRoomPixelTex(64, 64, (px) => {
    for (let y = 0; y < 64; y++) {
      for (let x = 0; x < 64; x++) {
        const border = x < 3 || x >= 61 || y < 3 || y >= 61;
        const inCross =
          (x >= 27 && x <= 36 && y >= 16 && y <= 47) ||
          (y >= 27 && y <= 36 && x >= 16 && x <= 47);
        const n = (hash2i(x, y, 853) - 0.5) * 6;
        if (border) px(x, y, 76, 84, 88);
        else if (inCross) px(x, y, 196 + n, 38, 38);
        else px(x, y, 168 + n, 176 + n, 178 + n);
      }
    }
  });

  // 13. Abajur / Luminária Arquitetônica Quente e Grow-Light
  const warmLampTex = makeRoomPixelTex(16, 16, (px) => {
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        px(x, y, 255, 224, 146);
      }
    }
  });

  return {
    annexWall: createDoomSurfaceMaterial(textures.annexWall, sharedUniforms, {
      useLocalUv: true,
      baseLight: 0.23,
    }),
    annexFloor: createDoomSurfaceMaterial(textures.annexFloor, sharedUniforms, {
      tileScaleXZ: CELL_SIZE,
      baseLight: 0.22,
    }),
    annexCeiling: createDoomSurfaceMaterial(
      textures.annexCeiling,
      sharedUniforms,
      {
        tileScaleXZ: CELL_SIZE,
        baseLight: 0.19,
      }
    ),
    serverRack: createDoomSurfaceMaterial(serverTex, sharedUniforms, {
      useLocalUv: true,
      baseLight: 0.18,
    }),
    crtScreen: createDoomSurfaceMaterial(crtTex, sharedUniforms, {
      fullBright: true,
      useLocalUv: true,
    }),
    bookshelf: createDoomSurfaceMaterial(bookshelfTex, sharedUniforms, {
      useLocalUv: true,
      baseLight: 0.22,
    }),
    libraryRug: createDoomSurfaceMaterial(rugTex, sharedUniforms, {
      useLocalUv: true,
      baseLight: 0.22,
    }),
    foliage: createDoomSurfaceMaterial(foliageTex, sharedUniforms, {
      useLocalUv: true,
      baseLight: 0.23,
    }),
    mossSoil: createDoomSurfaceMaterial(mossSoilTex, sharedUniforms, {
      tileScaleXZ: 1.5,
      baseLight: 0.2,
    }),
    bioFluid: createDoomSurfaceMaterial(bioFluidTex, sharedUniforms, {
      fullBright: true,
      useLocalUv: true,
    }),
    labTile: createDoomSurfaceMaterial(labTileTex, sharedUniforms, {
      tileScaleXZ: 1.5,
      baseLight: 0.23,
    }),
    techFloor: createDoomSurfaceMaterial(techFloorTex, sharedUniforms, {
      tileScaleXZ: 1.5,
      baseLight: 0.21,
    }),
    bunkFabric: createDoomSurfaceMaterial(bunkFabricTex, sharedUniforms, {
      useLocalUv: true,
      baseLight: 0.22,
    }),
    cleanLinen: createDoomSurfaceMaterial(cleanLinenTex, sharedUniforms, {
      useLocalUv: true,
      baseLight: 0.24,
    }),
    medicalCross: createDoomSurfaceMaterial(medCrossTex, sharedUniforms, {
      useLocalUv: true,
      baseLight: 0.23,
    }),
    warmLampGlow: createDoomSurfaceMaterial(warmLampTex, sharedUniforms, {
      fullBright: true,
      useLocalUv: true,
    }),
    oakWood: createDoomSurfaceMaterial(textures.cratePlanks, sharedUniforms, {
      useLocalUv: true,
      baseLight: 0.22,
    }),
    weatheredWood: createDoomSurfaceMaterial(
      textures.weatheredWood,
      sharedUniforms,
      { useLocalUv: true, baseLight: 0.21 }
    ),
    metalTrim: createDoomSurfaceMaterial(textures.metalTrim, sharedUniforms, {
      useLocalUv: true,
      baseLight: 0.22,
    }),
    darkIron: createDoomSurfaceMaterial(textures.darkIron, sharedUniforms, {
      useLocalUv: true,
      baseLight: 0.2,
    }),
    stone: createDoomSurfaceMaterial(textures.stoneWall, sharedUniforms, {
      useLocalUv: true,
      baseLight: 0.2,
    }),
  };
}

// ============================================================================
// CONSTRUTORES GEOMÉTRICOS 3D DAS ALAS EXTERNAS E MOBILIÁRIO APRIMORADO
// ============================================================================

interface LocalXf {
  cx: number;
  cz: number;
  yaw: number;
}

type GeoBuckets = Record<keyof RoomMaterials, THREE.BufferGeometry[]>;

interface RoomMetricUvRule {
  metersPerTile: number;
  alignLongAxis: boolean;
  /** Quando definido, mapeia altura vertical 0..wallHeight em V = 0..1 (ex.: painéis de parede com rodapé e sanca) */
  wallPanelHeight?: number;
}

const roomBucketMetricUv = new WeakMap<
  THREE.BufferGeometry[],
  RoomMetricUvRule
>();

function applyRoomBoxMetricUv(
  geo: THREE.BoxGeometry,
  sx: number,
  sy: number,
  sz: number,
  rule: RoomMetricUvRule
): void {
  const tile = Math.max(0.08, rule.metersPerTile);
  const normAttr = geo.getAttribute('normal');
  const uvAttr = geo.getAttribute('uv');
  if (!normAttr || !uvAttr) return;

  for (let i = 0; i < uvAttr.count; i++) {
    const nx = Math.abs(normAttr.getX(i));
    const ny = Math.abs(normAttr.getY(i));
    const rawU = uvAttr.getX(i);
    const rawV = uvAttr.getY(i);

    let faceW = sx;
    let faceH = sy;
    if (nx > 0.5) {
      faceW = sz;
      faceH = sy;
    } else if (ny > 0.5) {
      faceW = sx;
      faceH = sz;
    }

    if (rule.wallPanelHeight && ny < 0.5) {
      uvAttr.setXY(
        i,
        rawU * (faceW / tile),
        rawV * Math.min(1.0, faceH / rule.wallPanelHeight)
      );
      continue;
    }

    if (rule.alignLongAxis && faceH > faceW * 1.15) {
      uvAttr.setXY(i, rawV * (faceH / tile), rawU * (faceW / tile));
    } else {
      uvAttr.setXY(i, rawU * (faceW / tile), rawV * (faceH / tile));
    }
  }
  uvAttr.needsUpdate = true;
}

function applyRoomCylMetricUv(
  geo: THREE.CylinderGeometry,
  rTop: number,
  rBot: number,
  h: number,
  rule: RoomMetricUvRule
): void {
  const posAttr = geo.getAttribute('position');
  const normAttr = geo.getAttribute('normal');
  const uvAttr = geo.getAttribute('uv');
  if (!posAttr || !normAttr || !uvAttr) return;

  const tile = Math.max(0.08, rule.metersPerTile);
  const uRep = Math.max(1, Math.round((Math.PI * (rTop + rBot)) / tile));
  const vMax = Math.max(0.04, h / tile);

  for (let i = 0; i < uvAttr.count; i++) {
    if (Math.abs(normAttr.getY(i)) > 0.9) {
      uvAttr.setXY(
        i,
        0.5 + posAttr.getX(i) / tile,
        0.5 + posAttr.getZ(i) / tile
      );
    } else {
      uvAttr.setXY(i, uvAttr.getX(i) * uRep, uvAttr.getY(i) * vMax);
    }
  }
  uvAttr.needsUpdate = true;
}

function pushRoomBox(
  bucket: THREE.BufferGeometry[],
  xf: LocalXf,
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
  const uvRule = roomBucketMetricUv.get(bucket);
  if (uvRule) {
    applyRoomBoxMetricUv(g, sx, sy, sz, uvRule);
  }
  if (rx !== 0 || ry !== 0 || rz !== 0) {
    g.applyMatrix4(
      new THREE.Matrix4().makeRotationFromEuler(
        new THREE.Euler(rx, ry, rz, 'YXZ')
      )
    );
  }
  g.translate(lx, ly, lz);
  if (xf.yaw !== 0) g.rotateY(xf.yaw);
  g.translate(xf.cx, 0, xf.cz);
  bucket.push(g);
}

function pushRoomCyl(
  bucket: THREE.BufferGeometry[],
  xf: LocalXf,
  rTop: number,
  rBot: number,
  h: number,
  segs: number,
  lx: number,
  ly: number,
  lz: number,
  rx = 0,
  ry = 0,
  rz = 0
): void {
  const g = new THREE.CylinderGeometry(rTop, rBot, h, segs);
  const uvRule = roomBucketMetricUv.get(bucket);
  if (uvRule) {
    applyRoomCylMetricUv(g, rTop, rBot, h, uvRule);
  }
  if (rx !== 0 || ry !== 0 || rz !== 0) {
    g.applyMatrix4(
      new THREE.Matrix4().makeRotationFromEuler(
        new THREE.Euler(rx, ry, rz, 'YXZ')
      )
    );
  }
  g.translate(lx, ly, lz);
  if (xf.yaw !== 0) g.rotateY(xf.yaw);
  g.translate(xf.cx, 0, xf.cz);
  bucket.push(g);
}

function pushWorldPlaneXZ(
  bucket: THREE.BufferGeometry[],
  sx: number,
  sz: number,
  cx: number,
  y: number,
  cz: number,
  faceDown: boolean
): void {
  const g = new THREE.PlaneGeometry(sx, sz);
  g.rotateX(faceDown ? Math.PI * 0.5 : -Math.PI * 0.5);
  g.translate(cx, y, cz);
  bucket.push(g);
}

function addSolidCollider(
  colliders: StaticColliderBox[],
  id: string,
  cx: number,
  cz: number,
  sx: number,
  sz: number,
  maxY: number
): void {
  colliders.push({
    id,
    box: new THREE.Box3(
      new THREE.Vector3(cx - sx * 0.5, 0, cz - sz * 0.5),
      new THREE.Vector3(cx + sx * 0.5, maxY, cz + sz * 0.5)
    ),
  });
}

/**
 * Constrói a arquitetura 3D completa de cada Sala Externa (Fora do Mapa):
 * - Piso exclusivo (`annexFloor`) + incrustações temáticas sem Z-fighting;
 * - Teto arquitetônico caixotado em dois níveis (`3.20m` na sanca perimetral -> `3.74m` no vão central `annexCeiling`);
 * - Paredes modulares (`annexWall`) nos 4 lados com pilastras 3D, rodapés e vigamento aéreo;
 * - Pórtico Blindado de Acesso atravessando a muralha externa do mapa 29x29;
 * - Luminárias suspensas + marcos arquitetônicos temáticos (como o Núcleo Tokamak no Salão dos Reatores!).
 */
function emitAnnexRoomsArchitecture(
  b: GeoBuckets,
  colliders: StaticColliderBox[],
  annexLights: DoomAnnexLightSpec[]
): void {
  const rows = LABYRINTH_MAP.length;
  const cols = LABYRINTH_MAP[0].length;
  const halfMapW = cols * CELL_SIZE * 0.5;
  const halfMapD = rows * CELL_SIZE * 0.5;

  const vaultTopY = WALL_HEIGHT; // 3.20m no domo central caixotado (alinhado ao teto estrutural sem vazamentos!)
  const soffitY = 2.86; // Sanca perimetral rebaixada de 3.0m ao redor do caixotão central!
  const portalClearW = 2.16;
  const portalClearH = 2.58;
  const jambW = (CELL_SIZE - portalClearW) * 0.5; // 0.42m
  const outerWallT = 0.42;
  const entryCladT = 0.18;

  for (let rIdx = 0; rIdx < THEMED_ROOMS.length; rIdx++) {
    const r = THEMED_ROOMS[rIdx];
    const roomMinX = r.minGx * CELL_SIZE - halfMapW;
    const roomMaxX = (r.maxGx + 1) * CELL_SIZE - halfMapW;
    const roomMinZ = r.minGz * CELL_SIZE - halfMapD;
    const roomMaxZ = (r.maxGz + 1) * CELL_SIZE - halfMapD;

    const roomW = roomMaxX - roomMinX; // 15.0m
    const roomD = roomMaxZ - roomMinZ; // 15.0m
    const roomCx = (roomMinX + roomMaxX) * 0.5;
    const roomCz = (roomMinZ + roomMaxZ) * 0.5;
    const doorWorld = gridCellToWorld(r.doorGx, r.doorGz);

    const worldXf: LocalXf = { cx: 0, cz: 0, yaw: 0 };
    const roomCenterXf: LocalXf = { cx: roomCx, cz: roomCz, yaw: 0 };

    // 1. PISO EXCLUSIVO DA SALA EXTERNA (`annexFloor`) — estritamente fora de [-halfMapW..+halfMapW, -halfMapD..+halfMapD]
    pushWorldPlaneXZ(
      b.annexFloor,
      roomW - 0.01,
      roomD - 0.01,
      roomCx,
      0,
      roomCz,
      false
    );

    // Tapetes / pisos embutidos temáticos no coração da sala
    switch (r.id) {
      case 'computer_room':
        pushRoomBox(b.techFloor, roomCenterXf, 10.6, 0.016, 10.6, 0, 0.008, 0);
        pushRoomBox(b.darkIron, roomCenterXf, 10.8, 0.022, 0.09, 0, 0.011, -5.34);
        pushRoomBox(b.darkIron, roomCenterXf, 10.8, 0.022, 0.09, 0, 0.011, 5.34);
        break;
      case 'reactor_hall':
        pushRoomBox(b.techFloor, roomCenterXf, 11.2, 0.016, 11.2, 0, 0.008, 0);
        break;
      case 'biology_lab':
      case 'medical_ward':
        pushRoomBox(b.labTile, roomCenterXf, 11.4, 0.016, 11.4, 0, 0.008, 0);
        break;
      case 'library_room':
        pushRoomBox(b.oakWood, roomCenterXf, 13.4, 0.012, 13.4, 0, 0.006, 0);
        pushRoomBox(b.libraryRug, roomCenterXf, 8.6, 0.02, 10.2, 0.4, 0.012, 0);
        break;
      case 'vegetation_room':
        pushRoomBox(b.mossSoil, roomCenterXf, 10.8, 0.018, 10.8, 0, 0.009, 0);
        pushRoomBox(b.weatheredWood, roomCenterXf, 11.04, 0.05, 0.12, 0, 0.025, -5.44);
        pushRoomBox(b.weatheredWood, roomCenterXf, 11.04, 0.05, 0.12, 0, 0.025, 5.44);
        pushRoomBox(b.weatheredWood, roomCenterXf, 0.12, 0.05, 10.8, -5.44, 0.025, 0);
        pushRoomBox(b.weatheredWood, roomCenterXf, 0.12, 0.05, 10.8, 5.44, 0.025, 0);
        break;
      case 'crew_quarters':
        pushRoomBox(b.oakWood, roomCenterXf, 10.8, 0.015, 10.8, 0, 0.0075, 0);
        break;
    }

    // 2. TETO ARQUITETÔNICO EM DOIS NÍVEIS (`annexCeiling`):
    // Sanca perimetral de 3.0m a y = 3.20m + Domo/Caixotão central 9.0m x 9.0m elevado a y = 3.74m!
    const baySpan = 9.0; // 3x3 células centrais
    const soffitBand = (roomW - baySpan) * 0.5; // 3.0m
    // 4 faixas de sanca perimetral em y = 3.20m
    pushWorldPlaneXZ(
      b.annexCeiling,
      roomW,
      soffitBand,
      roomCx,
      soffitY,
      roomMinZ + soffitBand * 0.5,
      true
    );
    pushWorldPlaneXZ(
      b.annexCeiling,
      roomW,
      soffitBand,
      roomCx,
      soffitY,
      roomMaxZ - soffitBand * 0.5,
      true
    );
    pushWorldPlaneXZ(
      b.annexCeiling,
      soffitBand,
      baySpan,
      roomMinX + soffitBand * 0.5,
      soffitY,
      roomCz,
      true
    );
    pushWorldPlaneXZ(
      b.annexCeiling,
      soffitBand,
      baySpan,
      roomMaxX - soffitBand * 0.5,
      soffitY,
      roomCz,
      true
    );
    // Teto central elevado em y = 3.74m
    pushWorldPlaneXZ(
      b.annexCeiling,
      baySpan,
      baySpan,
      roomCx,
      vaultTopY,
      roomCz,
      true
    );

    // Claraboia/fáscia vertical contornando a transição 3.20m -> 3.74m + vigas cruzadas 3D
    const fasciaH = vaultTopY - soffitY;
    const fasciaMidY = soffitY + fasciaH * 0.5;
    const trimMatBucket =
      r.id === 'library_room' || r.id === 'vegetation_room'
        ? b.weatheredWood
        : b.metalTrim;
    pushRoomBox(trimMatBucket, roomCenterXf, baySpan + 0.18, fasciaH, 0.14, 0, fasciaMidY, -baySpan * 0.5);
    pushRoomBox(trimMatBucket, roomCenterXf, baySpan + 0.18, fasciaH, 0.14, 0, fasciaMidY, baySpan * 0.5);
    pushRoomBox(trimMatBucket, roomCenterXf, 0.14, fasciaH, baySpan - 0.1, -baySpan * 0.5, fasciaMidY, 0);
    pushRoomBox(trimMatBucket, roomCenterXf, 0.14, fasciaH, baySpan - 0.1, baySpan * 0.5, fasciaMidY, 0);

    // Treliças/vigas mestras cruzando o teto elevado
    for (const offset of [-1.5, 1.5]) {
      pushRoomBox(trimMatBucket, roomCenterXf, baySpan - 0.12, 0.16, 0.2, 0, vaultTopY - 0.1, offset);
      pushRoomBox(b.darkIron, roomCenterXf, 0.18, 0.14, baySpan - 0.12, offset, vaultTopY - 0.11, 0);
    }

    // 4 Luminárias Arquitetônicas Suspensas no teto da sala + fontes reais de luz pontual
    const isCoolLight =
      r.id === 'computer_room' || r.id === 'biology_lab' || r.id === 'reactor_hall';
    const lampGlowBucket = isCoolLight ? b.crtScreen : b.warmLampGlow;
    for (const [lxOff, lzOff] of [
      [-3.0, -3.0],
      [3.0, -3.0],
      [-3.0, 3.0],
      [3.0, 3.0],
    ] as const) {
      // Hastes pendentes + moldura metálica + difusor luminoso
      pushRoomCyl(b.darkIron, roomCenterXf, 0.025, 0.025, 0.36, 6, lxOff - 0.36, vaultTopY - 0.18, lzOff);
      pushRoomCyl(b.darkIron, roomCenterXf, 0.025, 0.025, 0.36, 6, lxOff + 0.36, vaultTopY - 0.18, lzOff);
      pushRoomBox(b.darkIron, roomCenterXf, 1.04, 0.08, 0.54, lxOff, vaultTopY - 0.38, lzOff);
      pushRoomBox(lampGlowBucket, roomCenterXf, 0.92, 0.03, 0.42, lxOff, vaultTopY - 0.425, lzOff);
    }

    annexLights.push(
      {
        position: new THREE.Vector3(roomCx - 3.2, 2.74, roomCz - 3.2),
        baseIntensity: 0.66,
        flicker: false,
        phase: rIdx * 1.3 + 0.4,
      },
      {
        position: new THREE.Vector3(roomCx + 3.2, 2.74, roomCz + 3.2),
        baseIntensity: 0.66,
        flicker: rIdx % 2 === 1,
        phase: rIdx * 1.9 + 1.7,
      },
      {
        position: new THREE.Vector3(doorWorld.x, 2.42, doorWorld.z),
        baseIntensity: 0.58,
        flicker: false,
        phase: rIdx * 0.9 + 2.5,
      }
    );

    // 3. AS 4 PAREDES MODULARES (`annexWall`) + PÓRTICO BLINDADO DE ACESSO + COLISORES SÓLIDOS
    const wallH = WALL_HEIGHT;
    const wallMidY = wallH * 0.5;

    // Parede Norte da Sala
    if (r.outwardDir === 'S') {
      // Sala ao Sul: a face Norte (roomMinZ) encosta na muralha Sul do mapa em (doorGx, 28)
      const leftSpan = doorWorld.x - portalClearW * 0.5 - roomMinX;
      const rightSpan = roomMaxX - (doorWorld.x + portalClearW * 0.5);
      const zClad = roomMinZ + entryCladT * 0.5 + 0.004;
      if (leftSpan > 0.05) {
        const cx = roomMinX + leftSpan * 0.5;
        pushRoomBox(b.annexWall, worldXf, leftSpan, wallH, entryCladT, cx, wallMidY, zClad);
        addSolidCollider(colliders, `room-arch-${r.id}-entryL`, cx, zClad, leftSpan, entryCladT, wallH);
      }
      if (rightSpan > 0.05) {
        const cx = roomMaxX - rightSpan * 0.5;
        pushRoomBox(b.annexWall, worldXf, rightSpan, wallH, entryCladT, cx, wallMidY, zClad);
        addSolidCollider(colliders, `room-arch-${r.id}-entryR`, cx, zClad, rightSpan, entryCladT, wallH);
      }
      pushRoomBox(
        b.annexWall,
        worldXf,
        portalClearW,
        wallH - portalClearH,
        entryCladT,
        doorWorld.x,
        portalClearH + (wallH - portalClearH) * 0.5,
        zClad
      );
    } else {
      const zOut = roomMinZ - outerWallT * 0.5;
      pushRoomBox(b.annexWall, worldXf, roomW + outerWallT * 2, wallH, outerWallT, roomCx, wallMidY, zOut);
      addSolidCollider(colliders, `room-arch-${r.id}-N`, roomCx, zOut, roomW + outerWallT * 2, outerWallT, wallH);
    }

    // Parede Sul da Sala
    if (r.outwardDir === 'N') {
      // Sala ao Norte: a face Sul (roomMaxZ) encosta na muralha Norte do mapa em (doorGx, 0)
      const leftSpan = doorWorld.x - portalClearW * 0.5 - roomMinX;
      const rightSpan = roomMaxX - (doorWorld.x + portalClearW * 0.5);
      const zClad = roomMaxZ - entryCladT * 0.5 - 0.004;
      if (leftSpan > 0.05) {
        const cx = roomMinX + leftSpan * 0.5;
        pushRoomBox(b.annexWall, worldXf, leftSpan, wallH, entryCladT, cx, wallMidY, zClad);
        addSolidCollider(colliders, `room-arch-${r.id}-entryL`, cx, zClad, leftSpan, entryCladT, wallH);
      }
      if (rightSpan > 0.05) {
        const cx = roomMaxX - rightSpan * 0.5;
        pushRoomBox(b.annexWall, worldXf, rightSpan, wallH, entryCladT, cx, wallMidY, zClad);
        addSolidCollider(colliders, `room-arch-${r.id}-entryR`, cx, zClad, rightSpan, entryCladT, wallH);
      }
      pushRoomBox(
        b.annexWall,
        worldXf,
        portalClearW,
        wallH - portalClearH,
        entryCladT,
        doorWorld.x,
        portalClearH + (wallH - portalClearH) * 0.5,
        zClad
      );
    } else {
      const zOut = roomMaxZ + outerWallT * 0.5;
      pushRoomBox(b.annexWall, worldXf, roomW + outerWallT * 2, wallH, outerWallT, roomCx, wallMidY, zOut);
      addSolidCollider(colliders, `room-arch-${r.id}-S`, roomCx, zOut, roomW + outerWallT * 2, outerWallT, wallH);
    }

    // Parede Oeste da Sala
    if (r.outwardDir === 'E') {
      // Sala a Leste: a face Oeste (roomMinX) encosta na muralha Leste do mapa em (28, doorGz)
      const topSpan = doorWorld.z - portalClearW * 0.5 - roomMinZ;
      const botSpan = roomMaxZ - (doorWorld.z + portalClearW * 0.5);
      const xClad = roomMinX + entryCladT * 0.5 + 0.004;
      if (topSpan > 0.05) {
        const cz = roomMinZ + topSpan * 0.5;
        pushRoomBox(b.annexWall, worldXf, entryCladT, wallH, topSpan, xClad, wallMidY, cz);
        addSolidCollider(colliders, `room-arch-${r.id}-entryL`, xClad, cz, entryCladT, topSpan, wallH);
      }
      if (botSpan > 0.05) {
        const cz = roomMaxZ - botSpan * 0.5;
        pushRoomBox(b.annexWall, worldXf, entryCladT, wallH, botSpan, xClad, wallMidY, cz);
        addSolidCollider(colliders, `room-arch-${r.id}-entryR`, xClad, cz, entryCladT, botSpan, wallH);
      }
      pushRoomBox(
        b.annexWall,
        worldXf,
        entryCladT,
        wallH - portalClearH,
        portalClearW,
        xClad,
        portalClearH + (wallH - portalClearH) * 0.5,
        doorWorld.z
      );
    } else {
      const xOut = roomMinX - outerWallT * 0.5;
      pushRoomBox(b.annexWall, worldXf, outerWallT, wallH, roomD, xOut, wallMidY, roomCz);
      addSolidCollider(colliders, `room-arch-${r.id}-W`, xOut, roomCz, outerWallT, roomD, wallH);
    }

    // Parede Leste da Sala
    if (r.outwardDir === 'W') {
      // Sala a Oeste: a face Leste (roomMaxX) encosta na muralha Oeste do mapa em (0, doorGz)
      const topSpan = doorWorld.z - portalClearW * 0.5 - roomMinZ;
      const botSpan = roomMaxZ - (doorWorld.z + portalClearW * 0.5);
      const xClad = roomMaxX - entryCladT * 0.5 - 0.004;
      if (topSpan > 0.05) {
        const cz = roomMinZ + topSpan * 0.5;
        pushRoomBox(b.annexWall, worldXf, entryCladT, wallH, topSpan, xClad, wallMidY, cz);
        addSolidCollider(colliders, `room-arch-${r.id}-entryL`, xClad, cz, entryCladT, topSpan, wallH);
      }
      if (botSpan > 0.05) {
        const cz = roomMaxZ - botSpan * 0.5;
        pushRoomBox(b.annexWall, worldXf, entryCladT, wallH, botSpan, xClad, wallMidY, cz);
        addSolidCollider(colliders, `room-arch-${r.id}-entryR`, xClad, cz, entryCladT, botSpan, wallH);
      }
      pushRoomBox(
        b.annexWall,
        worldXf,
        entryCladT,
        wallH - portalClearH,
        portalClearW,
        xClad,
        portalClearH + (wallH - portalClearH) * 0.5,
        doorWorld.z
      );
    } else {
      const xOut = roomMaxX + outerWallT * 0.5;
      pushRoomBox(b.annexWall, worldXf, outerWallT, wallH, roomD, xOut, wallMidY, roomCz);
      addSolidCollider(colliders, `room-arch-${r.id}-E`, xOut, roomCz, outerWallT, roomD, wallH);
    }

    // Pilastras estruturais 3D nos 4 cantos internos da Sala Externa
    for (const [cxSign, czSign] of [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ] as const) {
      const px = roomCx + cxSign * (roomW * 0.5 - 0.14);
      const pz = roomCz + czSign * (roomD * 0.5 - 0.14);
      pushRoomBox(trimMatBucket, worldXf, 0.26, soffitY, 0.26, px, soffitY * 0.5, pz);
      pushRoomBox(b.darkIron, worldXf, 0.32, 0.22, 0.32, px, 0.11, pz);
      pushRoomBox(b.darkIron, worldXf, 0.32, 0.18, 0.32, px, soffitY - 0.09, pz);
    }

    // 4. PÓRTICO BLINDADO DE ESCLUSA NA CÉLULA PERIMETRAL (doorGx, doorGz)
    const isNS = r.outwardDir === 'N' || r.outwardDir === 'S';
    const doorXf: LocalXf = {
      cx: doorWorld.x,
      cz: doorWorld.z,
      yaw: isNS ? 0 : Math.PI * 0.5,
    };
    const jambOffset = portalClearW * 0.5 + jambW * 0.5; // 1.29m
    for (const side of [-1, 1] as const) {
      // Batente blindado maciço ocupando os 3.0m de espessura da muralha perimetral
      pushRoomBox(b.metalTrim, doorXf, jambW, WALL_HEIGHT, CELL_SIZE - 0.01, side * jambOffset, WALL_HEIGHT * 0.5, 0);
      pushRoomBox(b.darkIron, doorXf, jambW + 0.05, 0.24, CELL_SIZE, side * jambOffset, 0.12, 0);
      pushRoomBox(b.darkIron, doorXf, jambW + 0.04, WALL_HEIGHT - 0.3, 0.26, side * jambOffset, WALL_HEIGHT * 0.5, -1.24);
      pushRoomBox(b.darkIron, doorXf, jambW + 0.04, WALL_HEIGHT - 0.3, 0.26, side * jambOffset, WALL_HEIGHT * 0.5, 1.24);

      if (isNS) {
        addSolidCollider(
          colliders,
          `room-arch-${r.id}-jamb-${side}`,
          doorWorld.x + side * jambOffset,
          doorWorld.z,
          jambW,
          CELL_SIZE,
          WALL_HEIGHT
        );
      } else {
        addSolidCollider(
          colliders,
          `room-arch-${r.id}-jamb-${side}`,
          doorWorld.x,
          doorWorld.z + side * jambOffset,
          CELL_SIZE,
          jambW,
          WALL_HEIGHT
        );
      }
    }
    // Verga superior blindada sobre o vão de 2.58m + visor luminoso sinalizando a entrada da Sala Nova!
    const lintelH = WALL_HEIGHT - portalClearH;
    pushRoomBox(
      b.metalTrim,
      doorXf,
      portalClearW + 0.02,
      lintelH,
      CELL_SIZE - 0.01,
      0,
      portalClearH + lintelH * 0.5,
      0
    );
    pushRoomBox(b.darkIron, doorXf, portalClearW + 0.06, 0.09, CELL_SIZE + 0.02, 0, portalClearH + 0.045, 0);
    // Painéis luminosos de identificação nos dois lados da verga do pórtico
    pushRoomBox(lampGlowBucket, doorXf, 1.42, 0.16, 0.04, 0, portalClearH + 0.28, -1.5);
    pushRoomBox(lampGlowBucket, doorXf, 1.42, 0.16, 0.04, 0, portalClearH + 0.28, 1.5);
    // Soleira metálica chanfrada no piso do pórtico
    pushRoomBox(b.darkIron, doorXf, portalClearW, 0.024, 0.42, 0, 0.012, 0);

    // 5. MARCOS ARQUITETÔNICOS EXCLUSIVOS DE CADA SALA EXTERNA
    if (r.id === 'reactor_hall') {
      // NÚCLEO TOKAMAK DE FUSÃO / CONTENÇÃO MAGNÉTICA CENTRAL em (25, -3)
      pushRoomCyl(b.darkIron, roomCenterXf, 1.28, 1.38, 0.24, 16, 0, 0.12, 0);
      pushRoomCyl(b.metalTrim, roomCenterXf, 1.06, 1.16, 0.22, 16, 0, 0.34, 0);
      // Coluna central de plasma bioluminescente + anéis magnéticos toroidais
      pushRoomCyl(b.bioFluid, roomCenterXf, 0.68, 0.68, 2.28, 16, 0, 1.56, 0);
      pushRoomCyl(b.crtScreen, roomCenterXf, 0.74, 0.74, 0.24, 16, 0, 1.56, 0);
      for (const ringY of [0.72, 1.26, 1.88, 2.42]) {
        pushRoomCyl(b.darkIron, roomCenterXf, 0.92, 0.92, 0.14, 16, 0, ringY, 0);
      }
      // 6 Bobinas C verticais abraçando o núcleo até o teto de 3.20m
      for (let c = 0; c < 6; c++) {
        const ang = (c * Math.PI) / 3;
        const bx = Math.cos(ang) * 0.98;
        const bz = Math.sin(ang) * 0.98;
        pushRoomBox(b.metalTrim, roomCenterXf, 0.18, 2.52, 0.28, bx, 1.54, bz, 0, -ang, 0);
      }
      pushRoomCyl(b.darkIron, roomCenterXf, 1.14, 0.96, 0.44, 16, 0, 2.98, 0);
      addSolidCollider(colliders, 'room-arch-reactor-tokamak', roomCx, roomCz, 2.32, 2.32, WALL_HEIGHT);
    } else if (r.id === 'computer_room') {
      // Calhas aéreas de cabos de dados interligando as fileiras de servidores
      pushRoomBox(b.darkIron, roomCenterXf, 11.4, 0.08, 0.36, 0, 2.62, -2.8);
      pushRoomBox(b.darkIron, roomCenterXf, 11.4, 0.08, 0.36, 0, 2.62, 0.2);
      pushRoomBox(b.metalTrim, roomCenterXf, 0.34, 0.08, 8.8, -2.8, 2.7, -1.2);
      pushRoomBox(b.metalTrim, roomCenterXf, 0.34, 0.08, 8.8, 2.8, 2.7, -1.2);
    } else if (r.id === 'library_room') {
      // Lustre clássico suspenso de latão e madeira no centro do Salão de Leitura
      pushRoomCyl(b.darkIron, roomCenterXf, 0.04, 0.04, 0.64, 8, 0, vaultTopY - 0.32, 0);
      pushRoomCyl(b.weatheredWood, roomCenterXf, 0.62, 0.56, 0.1, 12, 0, vaultTopY - 0.66, 0);
      for (const [lx, lz] of [
        [-0.52, 0],
        [0.52, 0],
        [0, -0.52],
        [0, 0.52],
      ] as const) {
        pushRoomCyl(b.warmLampGlow, roomCenterXf, 0.1, 0.14, 0.18, 8, lx, vaultTopY - 0.58, lz);
      }
    } else if (r.id === 'vegetation_room') {
      // Pérgola hidropônica aérea com tubulação de névoa e trepadeiras pendentes
      for (const gzOff of [-2.4, 0, 2.4]) {
        pushRoomCyl(b.metalTrim, roomCenterXf, 0.045, 0.045, 10.6, 8, 0, 2.74, gzOff, 0, 0, Math.PI * 0.5);
        pushRoomBox(b.foliage, roomCenterXf, 0.42, 0.56, 0.28, -1.8, 2.52, gzOff, 0, 0.3, 0.08);
        pushRoomBox(b.foliage, roomCenterXf, 0.38, 0.5, 0.26, 2.1, 2.55, gzOff, 0, -0.25, -0.06);
      }
    }
  }
}

/**
 * Emite a modelagem 3D rica e detalhada de todas as 20 peças de mobiliário temático das 7 Salas!
 */
function emitRoomFurniturePiece(
  p: RoomFurniturePlacement,
  b: GeoBuckets
): void {
  const xf: LocalXf = { cx: p.worldX, cz: p.worldZ, yaw: p.yaw };

  switch (p.kind) {
    case 'server_rack_bank': {
      // Banco duplo Mainframe 42U com moldura chanfrada, bobinas de fita, exaustores superiores e barramentos
      for (const ox of [-0.39, 0.39]) {
        pushRoomBox(b.darkIron, xf, 0.74, 0.1, 0.68, ox, 0.05, 0);
        pushRoomBox(b.metalTrim, xf, 0.72, 2.1, 0.64, ox, 1.15, -0.02);
        pushRoomBox(b.serverRack, xf, 0.66, 2.02, 0.08, ox, 1.15, 0.28);
        // Pilastras laterais frisadas do gabinete
        pushRoomBox(b.darkIron, xf, 0.05, 2.08, 0.66, ox - 0.35, 1.15, 0);
        pushRoomBox(b.darkIron, xf, 0.05, 2.08, 0.66, ox + 0.35, 1.15, 0);
        // Topo blindado + turbina de exaustão superior
        pushRoomBox(b.metalTrim, xf, 0.76, 0.07, 0.7, ox, 2.23, 0);
        pushRoomCyl(b.darkIron, xf, 0.19, 0.21, 0.09, 10, ox, 2.31, -0.04);
        // Bobinas duplas de fita magnética + visor de diagnóstico CRT
        pushRoomCyl(b.metalTrim, xf, 0.11, 0.11, 0.035, 12, ox - 0.14, 1.76, 0.33, Math.PI * 0.5, 0, 0);
        pushRoomCyl(b.metalTrim, xf, 0.11, 0.11, 0.035, 12, ox + 0.14, 1.76, 0.33, Math.PI * 0.5, 0, 0);
        pushRoomBox(b.crtScreen, xf, 0.42, 0.12, 0.02, ox, 1.44, 0.325);
      }
      // Eletrodutos gêmeos subindo para o teto técnico
      pushRoomCyl(b.darkIron, xf, 0.05, 0.05, 0.88, 8, -0.24, 2.74, -0.18);
      pushRoomCyl(b.darkIron, xf, 0.05, 0.05, 0.88, 8, 0.24, 2.74, -0.18);
      break;
    }

    case 'crt_workstation_desk': {
      // Console de comando técnico em L com 2 monitores CRT tubo completo, CPU torre, luminária e cadeira giratória 5 pontas!
      pushRoomBox(b.metalTrim, xf, 1.52, 0.065, 0.76, 0, 0.75, -0.04);
      pushRoomBox(b.darkIron, xf, 1.56, 0.04, 0.05, 0, 0.74, 0.34);
      pushRoomBox(b.darkIron, xf, 0.08, 0.74, 0.7, -0.7, 0.37, -0.04);
      pushRoomBox(b.darkIron, xf, 0.08, 0.74, 0.7, 0.7, 0.37, -0.04);
      pushRoomBox(b.darkIron, xf, 1.34, 0.54, 0.04, 0, 0.42, -0.36);
      // Gabinete torre workstation + estabilizador sob a bancada
      pushRoomBox(b.serverRack, xf, 0.25, 0.52, 0.5, 0.48, 0.26, -0.06);
      pushRoomBox(b.darkIron, xf, 0.22, 0.22, 0.36, -0.48, 0.11, -0.1);

      for (const [mx, yawTilt] of [
        [-0.36, 0.14],
        [0.28, -0.14],
      ] as const) {
        // Base articulada + carcaça de monitor CRT profundo com tubo traseiro + tela fosforescente
        pushRoomCyl(b.darkIron, xf, 0.11, 0.14, 0.06, 8, mx, 0.81, -0.1);
        pushRoomBox(b.metalTrim, xf, 0.46, 0.39, 0.32, mx, 1.04, -0.08, 0, yawTilt, 0);
        pushRoomBox(b.darkIron, xf, 0.26, 0.24, 0.18, mx - Math.sin(yawTilt) * 0.2, 1.02, -0.26, 0, yawTilt, 0);
        pushRoomBox(b.crtScreen, xf, 0.38, 0.29, 0.025, mx + Math.sin(yawTilt) * 0.16, 1.05, 0.08, 0, yawTilt, 0);
        // Teclado mecânico esculpido + mouse
        pushRoomBox(b.darkIron, xf, 0.38, 0.035, 0.16, mx, 0.8, 0.19, 0.1, yawTilt * 0.4, 0);
        pushRoomBox(b.cleanLinen, xf, 0.34, 0.02, 0.11, mx, 0.818, 0.19, 0.1, yawTilt * 0.4, 0);
      }
      // Luminária articulada de bancada
      pushRoomCyl(b.metalTrim, xf, 0.018, 0.018, 0.38, 6, -0.66, 0.96, -0.24, 0.2, 0, -0.18);
      pushRoomBox(b.warmLampGlow, xf, 0.18, 0.03, 0.09, -0.58, 1.15, -0.16);

      // Cadeira giratória ergonômica com estrela de 5 pés, pistão, braços e encosto curvo
      const chairX = -0.04;
      const chairZ = 0.34;
      for (let leg = 0; leg < 5; leg++) {
        const a = (leg * Math.PI * 2) / 5;
        pushRoomBox(
          b.darkIron,
          xf,
          0.045,
          0.035,
          0.26,
          chairX + Math.sin(a) * 0.12,
          0.04,
          chairZ + Math.cos(a) * 0.12,
          0,
          a,
          0
        );
      }
      pushRoomCyl(b.darkIron, xf, 0.038, 0.045, 0.38, 8, chairX, 0.23, chairZ);
      pushRoomBox(b.bunkFabric, xf, 0.44, 0.07, 0.42, chairX, 0.44, chairZ);
      pushRoomBox(b.bunkFabric, xf, 0.42, 0.42, 0.07, chairX, 0.69, chairZ + 0.19, -0.1, 0, 0);
      pushRoomBox(b.darkIron, xf, 0.04, 0.2, 0.28, chairX - 0.23, 0.55, chairZ + 0.02);
      pushRoomBox(b.darkIron, xf, 0.04, 0.2, 0.28, chairX + 0.23, 0.55, chairZ + 0.02);
      break;
    }

    case 'bio_specimen_tank': {
      // Câmara cilíndrica de contenção xenobiológica com pedestal de válvulas, bio-fluido, espécime aracnídeo suspenso e duto superior
      pushRoomCyl(b.darkIron, xf, 0.48, 0.52, 0.22, 14, 0, 0.11, 0);
      pushRoomCyl(b.metalTrim, xf, 0.45, 0.47, 0.12, 14, 0, 0.28, 0);
      // Painel frontal de telemetria na base do tanque
      pushRoomBox(b.crtScreen, xf, 0.26, 0.11, 0.04, 0, 0.18, 0.48, -0.2, 0, 0);
      // Coluna iluminada de bio-fluido
      pushRoomCyl(b.bioFluid, xf, 0.38, 0.38, 1.66, 14, 0, 1.17, 0);
      // Espécime orgânico multi-segmentado suspenso em estase no interior
      pushRoomCyl(b.darkIron, xf, 0.13, 0.09, 0.46, 8, 0, 1.22, 0, 0.22, 0, 0.14);
      pushRoomCyl(b.darkIron, xf, 0.09, 0.12, 0.28, 8, 0.03, 0.92, -0.02, -0.18, 0, -0.1);
      for (const limbAng of [-1.1, -0.4, 0.4, 1.1]) {
        pushRoomBox(
          b.darkIron,
          xf,
          0.03,
          0.34,
          0.03,
          Math.cos(limbAng) * 0.14,
          1.16,
          Math.sin(limbAng) * 0.14,
          0.35,
          limbAng,
          0.42
        );
      }
      // Cúpula superior blindada + 4 tirantes estruturais + duto de exaustão até a sanca
      pushRoomCyl(b.metalTrim, xf, 0.45, 0.45, 0.1, 14, 0, 2.05, 0);
      pushRoomCyl(b.darkIron, xf, 0.4, 0.47, 0.26, 14, 0, 2.23, 0);
      pushRoomCyl(b.darkIron, xf, 0.085, 0.085, 0.72, 8, 0, 2.68, -0.08);
      for (const ang of [0.6, 2.54, 3.74, 5.68]) {
        pushRoomCyl(
          b.darkIron,
          xf,
          0.028,
          0.028,
          1.78,
          6,
          Math.cos(ang) * 0.43,
          1.17,
          Math.sin(ang) * 0.43
        );
      }
      break;
    }

    case 'autopsy_surgical_table': {
      // Mesa cirúrgica/autópsia hidráulica em inox com calha perimetral, bandeja Mayo e refletor cirúrgico duplo!
      pushRoomBox(b.darkIron, xf, 0.66, 0.1, 0.5, 0, 0.05, 0);
      pushRoomCyl(b.metalTrim, xf, 0.16, 0.2, 0.66, 10, 0, 0.42, 0);
      pushRoomBox(b.metalTrim, xf, 1.66, 0.08, 0.78, 0, 0.8, 0);
      // Bordas laterais elevadas de contenção em inox
      pushRoomBox(b.darkIron, xf, 1.68, 0.04, 0.04, 0, 0.85, 0.38);
      pushRoomBox(b.darkIron, xf, 1.68, 0.04, 0.04, 0, 0.85, -0.38);
      pushRoomBox(b.cleanLinen, xf, 1.5, 0.045, 0.64, 0.04, 0.86, 0);
      pushRoomBox(b.cleanLinen, xf, 0.3, 0.08, 0.5, -0.58, 0.91, 0, 0, 0, -0.12);
      // Mesa auxiliar lateral de instrumentos cirúrgicos
      pushRoomCyl(b.metalTrim, xf, 0.022, 0.022, 0.88, 6, 0.56, 0.44, 0.38);
      pushRoomBox(b.metalTrim, xf, 0.38, 0.03, 0.26, 0.56, 0.89, 0.32);
      // Coluna articulada com cúpula cirúrgica scialítica dupla
      pushRoomCyl(b.metalTrim, xf, 0.034, 0.04, 1.66, 8, -0.72, 0.83, -0.3);
      pushRoomBox(b.metalTrim, xf, 0.74, 0.045, 0.045, -0.38, 1.64, -0.14, 0, 0, -0.08);
      for (const lx of [-0.22, 0.12]) {
        pushRoomCyl(b.metalTrim, xf, 0.16, 0.23, 0.09, 10, lx, 1.56, -0.02);
        pushRoomCyl(b.warmLampGlow, xf, 0.19, 0.19, 0.025, 10, lx, 1.51, -0.02);
      }
      break;
    }

    case 'xenobio_lab_bench': {
      // Bancada laboratorial completa com cuba inox + torneira pescoço de ganso, microscópio binocular, tubos brilhantes e centrífuga
      pushRoomBox(b.metalTrim, xf, 1.54, 0.84, 0.7, 0, 0.42, 0);
      pushRoomBox(b.darkIron, xf, 1.58, 0.065, 0.74, 0, 0.87, 0);
      // Portas e gavetas frontais do gabinete
      for (const gx of [-0.5, 0, 0.5]) {
        pushRoomBox(b.darkIron, xf, 0.44, 0.66, 0.03, gx, 0.42, 0.355);
        pushRoomBox(b.metalTrim, xf, 0.12, 0.03, 0.04, gx, 0.64, 0.37);
      }
      // Cuba de pia laboratorial + torneira alta curva
      pushRoomBox(b.darkIron, xf, 0.32, 0.04, 0.28, -0.54, 0.905, 0.04);
      pushRoomCyl(b.metalTrim, xf, 0.018, 0.018, 0.28, 6, -0.54, 1.04, -0.1);
      pushRoomBox(b.metalTrim, xf, 0.03, 0.03, 0.14, -0.54, 1.17, -0.04);
      // Microscópio binocular 3D
      pushRoomBox(b.darkIron, xf, 0.22, 0.045, 0.24, -0.14, 0.92, 0.04);
      pushRoomBox(b.metalTrim, xf, 0.06, 0.3, 0.09, -0.14, 1.08, -0.03);
      pushRoomBox(b.darkIron, xf, 0.14, 0.025, 0.14, -0.14, 1.04, 0.05);
      pushRoomCyl(b.darkIron, xf, 0.026, 0.03, 0.22, 8, -0.16, 1.25, 0.04, 0.45, 0, 0);
      pushRoomCyl(b.darkIron, xf, 0.026, 0.03, 0.22, 8, -0.11, 1.25, 0.04, 0.45, 0, 0);
      // Estante escalonada de tubos bioluminescentes + centrífuga digital
      pushRoomBox(b.darkIron, xf, 0.36, 0.09, 0.18, 0.2, 0.94, 0.02);
      for (const tx of [0.06, 0.13, 0.2, 0.27, 0.34]) {
        pushRoomCyl(b.bioFluid, xf, 0.022, 0.022, 0.2, 6, tx, 1.04, 0.02);
      }
      pushRoomBox(b.cleanLinen, xf, 0.34, 0.25, 0.32, 0.56, 1.02, -0.02);
      pushRoomBox(b.crtScreen, xf, 0.18, 0.1, 0.025, 0.56, 1.05, 0.145);
      break;
    }

    case 'cryo_biohazard_cabinet': {
      // Câmara dupla criogênica de risco biológico + cilindro externo de Nitrogênio Líquido
      pushRoomBox(b.darkIron, xf, 1.22, 0.1, 0.66, -0.08, 0.05, 0);
      pushRoomBox(b.metalTrim, xf, 1.18, 1.98, 0.62, -0.08, 1.09, 0);
      pushRoomBox(b.darkIron, xf, 1.12, 1.78, 0.04, -0.08, 1.06, 0.31);
      pushRoomBox(b.crtScreen, xf, 0.52, 0.11, 0.03, -0.08, 1.98, 0.315);
      for (const wxOff of [-0.35, 0.19]) {
        pushRoomBox(b.bioFluid, xf, 0.38, 0.98, 0.05, wxOff, 1.22, 0.315);
        pushRoomBox(b.metalTrim, xf, 0.035, 0.26, 0.06, wxOff + (wxOff < 0 ? 0.21 : -0.21), 1.12, 0.335);
      }
      // Cilindro criogênico Dewar acoplado na lateral direita + tubulação isolada
      pushRoomCyl(b.metalTrim, xf, 0.16, 0.16, 1.56, 10, 0.56, 0.78, 0);
      pushRoomCyl(b.darkIron, xf, 0.17, 0.17, 0.06, 10, 0.56, 0.45, 0);
      pushRoomCyl(b.darkIron, xf, 0.17, 0.17, 0.06, 10, 0.56, 1.15, 0);
      pushRoomBox(b.darkIron, xf, 0.18, 0.05, 0.05, 0.44, 1.62, 0);
      break;
    }

    case 'astronaut_bunk_bed': {
      // Beliche duplo espacial/subterrâneo com cabeceiras, colchões acolchoados, guarda-corpo, luzes individuais e baús sob a cama
      const w = 1.84;
      const d = 0.84;
      const hw = w * 0.5 - 0.045;
      const hd = d * 0.5 - 0.045;
      for (const sx of [-hw, hw]) {
        for (const sz of [-hd, hd]) {
          pushRoomBox(b.darkIron, xf, 0.07, 1.86, 0.07, sx, 0.93, sz);
        }
        // Barras de cabeceira/peseira
        pushRoomBox(b.metalTrim, xf, 0.05, 0.28, d - 0.06, sx, 0.64, 0);
        pushRoomBox(b.metalTrim, xf, 0.05, 0.28, d - 0.06, sx, 1.54, 0);
      }
      // Dois baús metálicos de bagagem sob o beliche inferior
      pushRoomBox(b.metalTrim, xf, 0.68, 0.26, 0.62, -0.42, 0.13, 0);
      pushRoomBox(b.metalTrim, xf, 0.68, 0.26, 0.62, 0.42, 0.13, 0);

      for (const bedY of [0.38, 1.28]) {
        pushRoomBox(b.darkIron, xf, w, 0.075, d, 0, bedY, 0);
        pushRoomBox(b.cleanLinen, xf, w - 0.12, 0.13, d - 0.1, 0, bedY + 0.1, 0);
        pushRoomBox(b.bunkFabric, xf, w - 0.56, 0.145, d - 0.08, 0.22, bedY + 0.108, 0);
        pushRoomBox(b.cleanLinen, xf, 0.34, 0.095, 0.54, -0.64, bedY + 0.2, 0, 0, 0, -0.09);
        // Luminária individual quente de leitura na cabeceira
        pushRoomBox(b.warmLampGlow, xf, 0.04, 0.08, 0.16, -hw + 0.05, bedY + 0.34, -0.18);
      }
      // Guarda-corpo de proteção no beliche superior + escada de 5 degraus
      pushRoomBox(b.metalTrim, xf, 1.04, 0.04, 0.04, -0.22, 1.58, hd + 0.02);
      pushRoomBox(b.metalTrim, xf, 0.045, 1.54, 0.045, 0.56, 0.79, hd + 0.035);
      pushRoomBox(b.metalTrim, xf, 0.045, 1.54, 0.045, 0.82, 0.79, hd + 0.035);
      for (const ry of [0.28, 0.56, 0.84, 1.12, 1.4]) {
        pushRoomBox(b.metalTrim, xf, 0.28, 0.035, 0.035, 0.69, ry, hd + 0.035);
      }
      break;
    }

    case 'crew_locker_bank': {
      // Conjunto de 3 armários vestiários com banco de madeira integrado à frente e maletas no topo
      pushRoomBox(b.darkIron, xf, 1.5, 0.1, 0.58, 0, 0.05, -0.06);
      pushRoomBox(b.metalTrim, xf, 1.48, 1.98, 0.54, 0, 1.08, -0.06);
      for (const lx of [-0.47, 0, 0.47]) {
        pushRoomBox(b.darkIron, xf, 0.43, 1.84, 0.03, lx, 1.08, 0.215);
        pushRoomBox(b.metalTrim, xf, 0.39, 1.78, 0.035, lx, 1.08, 0.222);
        // Venezianas de ventilação + plaqueta nominal + maçaneta
        pushRoomBox(b.cleanLinen, xf, 0.18, 0.065, 0.04, lx, 1.72, 0.232);
        pushRoomBox(b.darkIron, xf, 0.24, 0.025, 0.042, lx, 1.84, 0.232);
        pushRoomBox(b.darkIron, xf, 0.24, 0.025, 0.042, lx, 0.36, 0.232);
        pushRoomBox(b.darkIron, xf, 0.032, 0.16, 0.05, lx + 0.14, 1.08, 0.24);
      }
      // Banco de vestiário em madeira na frente + caixas estocadas em cima
      pushRoomBox(b.weatheredWood, xf, 1.42, 0.05, 0.22, 0, 0.42, 0.34);
      pushRoomBox(b.darkIron, xf, 0.06, 0.4, 0.18, -0.56, 0.2, 0.34);
      pushRoomBox(b.darkIron, xf, 0.06, 0.4, 0.18, 0.56, 0.2, 0.34);
      pushRoomBox(b.bunkFabric, xf, 0.52, 0.22, 0.38, -0.36, 2.18, -0.06, 0, 0.08, 0);
      break;
    }

    case 'crew_mess_table': {
      // Mesa de refeitório da tripulação com bancos duplos nos DOIS lados, bandejas, garrafa térmica e canecas
      pushRoomBox(b.oakWood, xf, 1.56, 0.075, 0.64, 0, 0.76, 0);
      pushRoomBox(b.weatheredWood, xf, 1.6, 0.04, 0.68, 0, 0.74, 0);
      pushRoomBox(b.darkIron, xf, 0.1, 0.73, 0.52, -0.62, 0.365, 0);
      pushRoomBox(b.darkIron, xf, 0.1, 0.73, 0.52, 0.62, 0.365, 0);
      for (const bz of [-0.42, 0.42]) {
        pushRoomBox(b.weatheredWood, xf, 1.44, 0.055, 0.24, 0, 0.44, bz);
        pushRoomBox(b.darkIron, xf, 0.065, 0.42, 0.2, -0.54, 0.21, bz);
        pushRoomBox(b.darkIron, xf, 0.065, 0.42, 0.2, 0.54, 0.21, bz);
      }
      // Bandejas inox, jarra e canecas sobre a mesa
      pushRoomBox(b.metalTrim, xf, 0.36, 0.025, 0.24, -0.36, 0.81, 0.12);
      pushRoomBox(b.metalTrim, xf, 0.36, 0.025, 0.24, 0.34, 0.81, -0.12);
      pushRoomCyl(b.metalTrim, xf, 0.045, 0.045, 0.11, 8, -0.12, 0.85, 0.1);
      pushRoomCyl(b.darkIron, xf, 0.065, 0.075, 0.2, 8, 0.04, 0.89, -0.02);
      break;
    }

    case 'cabin_nightstand_desk': {
      // Escrivaninha de cabine com gaveteiro lateral, nicho de livros, abajur quente e cadeira de madeira
      pushRoomBox(b.weatheredWood, xf, 1.32, 0.065, 0.68, 0, 0.76, -0.02);
      pushRoomBox(b.oakWood, xf, 0.46, 0.72, 0.62, 0.4, 0.36, -0.02);
      pushRoomBox(b.weatheredWood, xf, 0.075, 0.72, 0.6, -0.58, 0.36, -0.02);
      for (const dy of [0.2, 0.42, 0.62]) {
        pushRoomBox(b.weatheredWood, xf, 0.38, 0.16, 0.03, 0.4, dy, 0.3);
        pushRoomBox(b.metalTrim, xf, 0.1, 0.025, 0.04, 0.4, dy, 0.32);
      }
      // Nicho traseiro com livros pessoais + tablet + abajur quente
      pushRoomBox(b.weatheredWood, xf, 0.72, 0.28, 0.2, -0.24, 0.93, -0.24);
      pushRoomBox(b.bookshelf, xf, 0.64, 0.22, 0.16, -0.24, 0.93, -0.22);
      pushRoomCyl(b.darkIron, xf, 0.085, 0.105, 0.04, 8, 0.42, 0.81, -0.08);
      pushRoomCyl(b.metalTrim, xf, 0.022, 0.022, 0.26, 6, 0.42, 0.96, -0.08);
      pushRoomCyl(b.warmLampGlow, xf, 0.11, 0.18, 0.17, 10, 0.42, 1.15, -0.08);
      // Cadeira encaixada na escrivaninha
      pushRoomBox(b.weatheredWood, xf, 0.42, 0.05, 0.38, -0.18, 0.44, 0.24);
      pushRoomBox(b.weatheredWood, xf, 0.42, 0.42, 0.05, -0.18, 0.66, 0.41);
      break;
    }

    case 'medical_gurney_bed': {
      // Maca hospitalar sobre rodízios com grades laterais articuladas, cilindro de O2 inferior e suporte duplo de soro (IV)
      pushRoomBox(b.metalTrim, xf, 1.72, 0.075, 0.78, 0, 0.68, 0);
      pushRoomBox(b.darkIron, xf, 1.36, 0.04, 0.54, 0, 0.24, 0);
      pushRoomCyl(b.metalTrim, xf, 0.07, 0.07, 0.58, 8, 0.12, 0.33, 0, 0, 0, Math.PI * 0.5);
      for (const sx of [-0.74, 0.74]) {
        for (const sz of [-0.32, 0.32]) {
          pushRoomCyl(b.metalTrim, xf, 0.03, 0.03, 0.58, 8, sx, 0.37, sz);
          pushRoomCyl(b.darkIron, xf, 0.055, 0.055, 0.04, 8, sx, 0.055, sz, Math.PI * 0.5, 0, 0);
        }
      }
      // Cabeceira, peseira com prontuário e grades laterais tubulares
      pushRoomBox(b.metalTrim, xf, 0.05, 0.46, 0.78, -0.84, 0.9, 0);
      pushRoomBox(b.metalTrim, xf, 0.045, 0.34, 0.78, 0.84, 0.84, 0);
      pushRoomBox(b.cleanLinen, xf, 0.03, 0.24, 0.3, 0.87, 0.88, 0);
      for (const rz of [-0.4, 0.4]) {
        pushRoomBox(b.metalTrim, xf, 1.06, 0.035, 0.035, -0.06, 0.98, rz);
        pushRoomBox(b.metalTrim, xf, 0.03, 0.24, 0.03, -0.52, 0.85, rz);
        pushRoomBox(b.metalTrim, xf, 0.03, 0.24, 0.03, 0.4, 0.85, rz);
      }
      pushRoomBox(b.cleanLinen, xf, 1.62, 0.14, 0.72, 0, 0.78, 0);
      pushRoomBox(b.medicalCross, xf, 0.96, 0.15, 0.74, 0.24, 0.785, 0);
      pushRoomBox(b.cleanLinen, xf, 0.32, 0.09, 0.52, -0.58, 0.9, 0, 0, 0, -0.12);
      // Haste inox de soro IV com duas bolsas suspensas
      pushRoomCyl(b.metalTrim, xf, 0.02, 0.02, 1.68, 6, -0.8, 0.84, 0.37);
      pushRoomBox(b.metalTrim, xf, 0.24, 0.025, 0.025, -0.8, 1.66, 0.37);
      pushRoomBox(b.bioFluid, xf, 0.085, 0.18, 0.045, -0.88, 1.52, 0.37);
      pushRoomBox(b.cleanLinen, xf, 0.08, 0.16, 0.045, -0.72, 1.53, 0.37);
      break;
    }

    case 'medical_supply_cabinet': {
      // Armário farmacêutico e cirúrgico duplo com vitrine superior, gaveteiro inferior e maleta de emergência lateral
      pushRoomBox(b.darkIron, xf, 1.44, 0.1, 0.64, 0, 0.05, 0);
      pushRoomBox(b.cleanLinen, xf, 1.4, 1.96, 0.6, 0, 1.08, 0);
      pushRoomBox(b.metalTrim, xf, 1.46, 0.08, 0.66, 0, 2.08, 0);
      for (const dx of [-0.33, 0.33]) {
        pushRoomBox(b.medicalCross, xf, 0.6, 0.62, 0.035, dx, 1.46, 0.305);
        pushRoomBox(b.darkIron, xf, 0.6, 0.3, 0.03, dx, 0.66, 0.305);
        pushRoomBox(b.darkIron, xf, 0.6, 0.3, 0.03, dx, 0.31, 0.305);
        pushRoomBox(b.metalTrim, xf, 0.14, 0.03, 0.045, dx, 0.66, 0.325);
        pushRoomBox(b.metalTrim, xf, 0.14, 0.03, 0.045, dx, 0.31, 0.325);
      }
      pushRoomBox(b.medicalCross, xf, 0.08, 0.34, 0.28, 0.73, 1.24, 0);
      break;
    }

    case 'vitals_monitor_cart': {
      // Carrinho hospitalar de parada cardíaca (Crash-Cart) com 4 rodízios, gavetas, monitor ECG CRT, desfibrilador e cilindro O2
      for (const sx of [-0.46, 0.46]) {
        for (const sz of [-0.26, 0.26]) {
          pushRoomCyl(b.darkIron, xf, 0.05, 0.05, 0.04, 8, sx, 0.05, sz, Math.PI * 0.5, 0, 0);
        }
      }
      pushRoomBox(b.metalTrim, xf, 1.06, 0.82, 0.62, -0.04, 0.48, 0);
      for (const dy of [0.24, 0.46, 0.68]) {
        pushRoomBox(b.medicalCross, xf, 0.94, 0.17, 0.03, -0.04, dy, 0.315);
        pushRoomBox(b.darkIron, xf, 0.26, 0.03, 0.045, -0.04, dy, 0.33);
      }
      // Alça lateral de empurrar + cilindro de O2 acoplado
      pushRoomBox(b.metalTrim, xf, 0.04, 0.04, 0.52, -0.62, 0.84, 0);
      pushRoomCyl(b.bioFluid, xf, 0.085, 0.085, 0.68, 8, 0.55, 0.48, 0);
      // Monitor ECG giratório + pás de desfibrilador no topo
      pushRoomBox(b.darkIron, xf, 0.54, 0.44, 0.4, -0.2, 1.16, -0.04, 0, 0.12, 0);
      pushRoomBox(b.crtScreen, xf, 0.44, 0.32, 0.025, -0.18, 1.18, 0.165, 0, 0.12, 0);
      pushRoomBox(b.cleanLinen, xf, 0.34, 0.16, 0.28, 0.28, 0.98, 0.02);
      pushRoomBox(b.darkIron, xf, 0.1, 0.06, 0.14, 0.22, 1.08, 0.04);
      pushRoomBox(b.darkIron, xf, 0.1, 0.06, 0.14, 0.35, 1.08, 0.04);
      break;
    }

    case 'hydroponic_tree_planter': {
      // Canteiro monumental de pedra e madeira + Árvore subterrânea ramificada com raízes expostas, 7 volumes de copa e halo de luz UV!
      pushRoomBox(b.stone, xf, 1.44, 0.48, 0.84, 0, 0.24, 0);
      pushRoomBox(b.weatheredWood, xf, 1.54, 0.075, 0.9, 0, 0.49, 0);
      pushRoomBox(b.mossSoil, xf, 1.38, 0.06, 0.74, 0, 0.48, 0);

      // Raízes aparentes + tronco retorcido + 3 galhos estruturais
      pushRoomBox(b.weatheredWood, xf, 0.42, 0.1, 0.12, -0.12, 0.54, 0.04, 0, 0.3, -0.2);
      pushRoomBox(b.weatheredWood, xf, 0.38, 0.1, 0.12, 0.14, 0.54, -0.04, 0, -0.4, 0.22);
      pushRoomCyl(b.weatheredWood, xf, 0.095, 0.16, 1.32, 8, -0.04, 1.12, -0.02, 0.05, 0, -0.06);
      pushRoomCyl(b.weatheredWood, xf, 0.055, 0.085, 0.68, 6, -0.28, 1.62, 0.04, 0.12, 0, 0.52);
      pushRoomCyl(b.weatheredWood, xf, 0.055, 0.085, 0.64, 6, 0.24, 1.58, -0.04, -0.1, 0, -0.48);
      pushRoomCyl(b.weatheredWood, xf, 0.045, 0.07, 0.52, 6, 0.02, 1.72, 0.18, -0.44, 0, 0.08);

      // Copa frondosa volumétrica em múltiplas camadas
      pushRoomBox(b.foliage, xf, 1.04, 0.54, 0.76, -0.02, 1.94, 0.0, 0.06, 0.2, 0.04);
      pushRoomBox(b.foliage, xf, 0.78, 0.46, 0.62, -0.38, 1.72, 0.04, -0.05, -0.3, 0.08);
      pushRoomBox(b.foliage, xf, 0.74, 0.44, 0.6, 0.36, 1.7, -0.02, 0.08, 0.35, -0.06);
      pushRoomBox(b.foliage, xf, 0.68, 0.4, 0.58, 0.0, 2.26, -0.02, 0, 0.5, 0);
      pushRoomBox(b.foliage, xf, 0.56, 0.36, 0.52, 0.04, 1.78, 0.26, 0.14, 0.15, 0);
      // Vegetação rasteira nos cantos do canteiro
      pushRoomBox(b.foliage, xf, 0.4, 0.28, 0.36, 0.46, 0.64, 0.1, 0, 0.4, 0);
      pushRoomBox(b.foliage, xf, 0.36, 0.26, 0.34, -0.48, 0.62, 0.08, 0, -0.3, 0);
      break;
    }

    case 'botanical_fern_trough': {
      // Canteiro hidropônico de dois níveis com tubulação de gotejamento, samambaias em leque, flora bioluminescente e coifa Grow-Light
      pushRoomBox(b.weatheredWood, xf, 1.5, 0.44, 0.76, 0, 0.22, 0);
      pushRoomBox(b.darkIron, xf, 1.54, 0.055, 0.8, 0, 0.4, 0);
      pushRoomBox(b.mossSoil, xf, 1.4, 0.055, 0.68, 0, 0.44, 0);

      for (const fx of [-0.46, 0.0, 0.46]) {
        for (const ang of [-0.62, -0.2, 0.2, 0.62]) {
          pushRoomBox(
            b.foliage,
            xf,
            0.17,
            0.6,
            0.065,
            fx + Math.sin(ang) * 0.15,
            0.72,
            Math.cos(ang) * 0.06 - 0.04,
            0.3,
            ang,
            ang * 0.62
          );
        }
      }
      // Cogumelos / bulbos bioluminescentes
      for (const [mx, mz, mh] of [
        [-0.24, 0.18, 0.17],
        [0.26, -0.16, 0.15],
        [0.04, 0.2, 0.13],
      ] as const) {
        pushRoomCyl(b.cleanLinen, xf, 0.02, 0.028, mh, 6, mx, 0.45 + mh * 0.5, mz);
        pushRoomCyl(b.bioFluid, xf, 0.08, 0.095, 0.05, 8, mx, 0.46 + mh, mz);
      }

      // Pórtico superior com coifa luminosa UV e tubo irrigador
      pushRoomBox(b.darkIron, xf, 0.055, 1.18, 0.055, -0.7, 1.02, -0.26);
      pushRoomBox(b.darkIron, xf, 0.055, 1.18, 0.055, 0.7, 1.02, -0.26);
      pushRoomBox(b.metalTrim, xf, 1.48, 0.07, 0.26, 0, 1.58, -0.16);
      pushRoomBox(b.warmLampGlow, xf, 1.32, 0.03, 0.15, 0, 1.535, -0.16);
      pushRoomCyl(b.metalTrim, xf, 0.022, 0.022, 1.38, 6, 0, 1.12, -0.26, 0, 0, Math.PI * 0.5);
      break;
    }

    case 'irrigation_nutrient_tank': {
      // Estação hidropônica dupla com visor bioluminescente, bomba centrífuga, tubulação cruzada e controlador digital
      pushRoomBox(b.stone, xf, 1.34, 0.16, 0.74, 0, 0.08, 0);
      pushRoomCyl(b.metalTrim, xf, 0.29, 0.29, 1.64, 12, -0.32, 0.98, -0.02);
      pushRoomCyl(b.bioFluid, xf, 0.302, 0.302, 0.42, 12, -0.32, 1.06, -0.02);
      pushRoomCyl(b.darkIron, xf, 0.26, 0.26, 1.48, 12, 0.32, 0.9, -0.02);
      // Coletor superior interligando os dois reservatórios + bomba inferior + painel pH/EC
      pushRoomCyl(b.metalTrim, xf, 0.045, 0.045, 0.68, 8, 0, 1.84, -0.02, 0, 0, Math.PI * 0.5);
      pushRoomCyl(b.darkIron, xf, 0.04, 0.04, 0.22, 8, -0.32, 1.82, -0.02);
      pushRoomCyl(b.darkIron, xf, 0.04, 0.04, 0.28, 8, 0.32, 1.72, -0.02);
      pushRoomBox(b.darkIron, xf, 0.28, 0.24, 0.26, 0.02, 0.28, 0.2);
      pushRoomBox(b.crtScreen, xf, 0.22, 0.14, 0.03, 0.32, 1.24, 0.25);
      pushRoomBox(b.foliage, xf, 0.24, 0.92, 0.18, 0.34, 0.98, 0.24, 0, 0, 0.12);
      break;
    }

    case 'oak_bookshelf_tall': {
      // Estante monumental clássica da Biblioteca (2.36m) com pilastras entalhadas, volumes salientes 3D e escada de correr em trilho!
      const w = 1.6;
      const d = 0.62;
      const h = 2.34;
      pushRoomBox(b.weatheredWood, xf, w + 0.06, 0.15, d + 0.06, 0, 0.075, -0.03);
      pushRoomBox(b.oakWood, xf, w, h - 0.22, d - 0.06, 0, 1.18, -0.06);
      pushRoomBox(b.bookshelf, xf, w - 0.14, h - 0.3, 0.09, 0, 1.18, d * 0.5 - 0.08);
      // Prateleiras intermediárias salientes em madeira escura + pilastras
      for (const sy of [0.64, 1.16, 1.68]) {
        pushRoomBox(b.weatheredWood, xf, w - 0.06, 0.045, d - 0.02, 0, sy, -0.02);
      }
      for (const px of [-w * 0.5 + 0.048, 0, w * 0.5 - 0.048]) {
        pushRoomBox(b.weatheredWood, xf, 0.09, h - 0.16, d, px, 1.18, -0.02);
      }
      // Cornija clássica superior escalonada + livros inclinados 3D
      pushRoomBox(b.weatheredWood, xf, w + 0.1, 0.13, d + 0.1, 0, h - 0.04, 0);
      pushRoomBox(b.bookshelf, xf, 0.22, 0.26, 0.18, -0.36, 0.8, 0.2, 0, 0, 0.18);
      // Trilho metálico superior + escada inclinada de biblioteca
      pushRoomCyl(b.metalTrim, xf, 0.018, 0.018, w - 0.04, 6, 0, 2.08, 0.31, 0, 0, Math.PI * 0.5);
      pushRoomBox(b.weatheredWood, xf, 0.038, 2.1, 0.045, 0.32, 1.04, 0.34, -0.1, 0, 0);
      pushRoomBox(b.weatheredWood, xf, 0.038, 2.1, 0.045, 0.62, 1.04, 0.34, -0.1, 0, 0);
      for (let step = 0; step < 6; step++) {
        const ly = 0.28 + step * 0.31;
        const lz = 0.44 - step * 0.031;
        pushRoomBox(b.weatheredWood, xf, 0.32, 0.03, 0.055, 0.47, ly, lz);
      }
      break;
    }

    case 'library_reading_table': {
      // Mesa nobre de leitura da Biblioteca com 2 abajures de banqueiro, tomos abertos e 4 cadeiras de espaldar alto!
      pushRoomBox(b.oakWood, xf, 1.48, 0.08, 0.98, 0, 0.77, 0);
      pushRoomBox(b.weatheredWood, xf, 1.38, 0.09, 0.88, 0, 0.7, 0);
      for (const sx of [-0.62, 0.62]) {
        for (const sz of [-0.4, 0.4]) {
          pushRoomBox(b.weatheredWood, xf, 0.095, 0.74, 0.095, sx, 0.37, sz);
        }
        pushRoomBox(b.weatheredWood, xf, 0.07, 0.06, 0.78, sx, 0.18, 0);
      }
      pushRoomBox(b.weatheredWood, xf, 1.24, 0.06, 0.07, 0, 0.18, 0);

      // Livros abertos, pilhas encadernadas e 2 abajures clássicos verdes/dourados
      pushRoomBox(b.cleanLinen, xf, 0.36, 0.04, 0.26, -0.34, 0.83, 0.22, 0, 0.12, 0);
      pushRoomBox(b.bookshelf, xf, 0.28, 0.14, 0.22, 0.38, 0.88, -0.22, 0, -0.18, 0);
      for (const lx of [-0.36, 0.36]) {
        pushRoomCyl(b.metalTrim, xf, 0.085, 0.105, 0.04, 8, lx, 0.83, 0);
        pushRoomCyl(b.metalTrim, xf, 0.022, 0.022, 0.28, 6, lx, 0.98, 0);
        pushRoomBox(b.foliage, xf, 0.26, 0.1, 0.17, lx, 1.14, 0);
        pushRoomBox(b.warmLampGlow, xf, 0.22, 0.04, 0.13, lx, 1.09, 0);
      }

      // 4 cadeiras clássicas de carvalho (2 de cada lado)
      for (const czSign of [-1, 1]) {
        for (const cxOff of [-0.36, 0.36]) {
          pushRoomBox(b.weatheredWood, xf, 0.42, 0.05, 0.38, cxOff, 0.45, czSign * 0.46);
          pushRoomBox(b.weatheredWood, xf, 0.42, 0.5, 0.05, cxOff, 0.7, czSign * 0.63);
          pushRoomBox(b.weatheredWood, xf, 0.05, 0.44, 0.05, cxOff - 0.17, 0.22, czSign * 0.61);
          pushRoomBox(b.weatheredWood, xf, 0.05, 0.44, 0.05, cxOff + 0.17, 0.22, czSign * 0.61);
        }
      }
      break;
    }

    case 'archive_catalog_cabinet': {
      // Fichário catalográfico de carvalho (12 gavetas com porta-etiquetas) + caixas de arquivo e globo terrestre no topo
      pushRoomBox(b.weatheredWood, xf, 1.48, 0.1, 0.66, 0, 0.05, 0);
      pushRoomBox(b.oakWood, xf, 1.44, 1.5, 0.62, 0, 0.84, 0);
      pushRoomBox(b.weatheredWood, xf, 1.5, 0.08, 0.68, 0, 1.62, 0);
      for (const rowY of [0.32, 0.68, 1.04, 1.38]) {
        for (const colX of [-0.44, 0, 0.44]) {
          pushRoomBox(b.weatheredWood, xf, 0.39, 0.27, 0.035, colX, rowY, 0.315);
          pushRoomBox(b.cleanLinen, xf, 0.14, 0.06, 0.042, colX, rowY + 0.045, 0.325);
          pushRoomBox(b.metalTrim, xf, 0.085, 0.03, 0.05, colX, rowY - 0.045, 0.33);
        }
      }
      // Caixas de pergaminhos + pequeno globo científico no topo
      pushRoomBox(b.bookshelf, xf, 0.46, 0.18, 0.34, -0.34, 1.75, -0.04, 0, 0.08, 0);
      pushRoomCyl(b.metalTrim, xf, 0.09, 0.11, 0.04, 8, 0.38, 1.68, 0);
      pushRoomCyl(b.foliage, xf, 0.14, 0.14, 0.22, 10, 0.38, 1.84, 0, 0.35, 0, 0.2);
      break;
    }

    case 'reactor_capacitor_console': {
      // Banco de capacitores de alta tensão com aletas radiadoras, console inclinado e 3 buchas isoladoras cerâmicas!
      pushRoomBox(b.darkIron, xf, 1.54, 0.94, 0.74, 0, 0.47, 0);
      // Aletas verticais de resfriamento frontal/lateral
      for (const fx of [-0.62, -0.36, -0.1, 0.16, 0.42, 0.64]) {
        pushRoomBox(b.metalTrim, xf, 0.04, 0.72, 0.78, fx, 0.46, 0);
      }
      pushRoomBox(b.serverRack, xf, 1.46, 0.38, 0.44, 0, 1.1, 0.12, -0.38, 0, 0);
      pushRoomBox(b.crtScreen, xf, 0.48, 0.24, 0.03, -0.36, 1.15, 0.33, -0.38, 0, 0);
      pushRoomBox(b.crtScreen, xf, 0.36, 0.18, 0.03, 0.34, 1.14, 0.33, -0.38, 0, 0);
      // 3 Isoladores de alta tensão com discos cerâmicos empilhados + esferas corona
      for (const cx of [-0.46, 0.0, 0.46]) {
        pushRoomCyl(b.bioFluid, xf, 0.1, 0.1, 0.78, 10, cx, 1.38, -0.18);
        for (const dy of [1.14, 1.34, 1.54, 1.74]) {
          pushRoomCyl(b.cleanLinen, xf, 0.15, 0.16, 0.045, 10, cx, dy, -0.18);
        }
        pushRoomCyl(b.metalTrim, xf, 0.12, 0.12, 0.14, 10, cx, 1.9, -0.18);
      }
      break;
    }
  }
}

function mergeRoomGeos(
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
 * Constrói todas as 7 Salas Especiais Externas 3D (arquitetura própria fora do mapa 29x29
 * com novas texturas de Parede, Chão e Teto, pórticos blindados, mobiliário 3D aprimorado e colisores).
 */
export function buildDoomThemedRooms(
  parentGroup: THREE.Group,
  placements: ReadonlyArray<RoomFurniturePlacement>,
  textures: DoomTextureSet,
  sharedUniforms: DoomSharedUniforms,
  colliders: StaticColliderBox[]
): DoomAnnexLightSpec[] {
  const mats = createRoomMaterials(textures, sharedUniforms);
  const buckets: GeoBuckets = {
    annexWall: [],
    annexFloor: [],
    annexCeiling: [],
    serverRack: [],
    crtScreen: [],
    bookshelf: [],
    libraryRug: [],
    foliage: [],
    mossSoil: [],
    bioFluid: [],
    labTile: [],
    techFloor: [],
    bunkFabric: [],
    cleanLinen: [],
    medicalCross: [],
    warmLampGlow: [],
    oakWood: [],
    weatheredWood: [],
    metalTrim: [],
    darkIron: [],
    stone: [],
  };

  roomBucketMetricUv.set(buckets.annexWall, {
    metersPerTile: CELL_SIZE,
    alignLongAxis: false,
    wallPanelHeight: WALL_HEIGHT,
  });
  roomBucketMetricUv.set(buckets.oakWood, {
    metersPerTile: 0.85,
    alignLongAxis: true,
  });
  roomBucketMetricUv.set(buckets.weatheredWood, {
    metersPerTile: 0.85,
    alignLongAxis: true,
  });
  roomBucketMetricUv.set(buckets.metalTrim, {
    metersPerTile: 0.85,
    alignLongAxis: true,
  });
  roomBucketMetricUv.set(buckets.darkIron, {
    metersPerTile: 0.8,
    alignLongAxis: true,
  });
  roomBucketMetricUv.set(buckets.stone, {
    metersPerTile: 1.45,
    alignLongAxis: false,
  });

  const annexLights: DoomAnnexLightSpec[] = [];
  emitAnnexRoomsArchitecture(buckets, colliders, annexLights);

  for (const p of placements) {
    emitRoomFurniturePiece(p, buckets);
    colliders.push({
      id: p.id,
      box: new THREE.Box3(
        new THREE.Vector3(p.minX, p.minY, p.minZ),
        new THREE.Vector3(p.maxX, p.maxY, p.maxZ)
      ),
      isObstacle: true,
    });
  }

  const keys = Object.keys(buckets) as Array<keyof RoomMaterials>;
  for (const k of keys) {
    const merged = mergeRoomGeos(buckets[k]);
    if (merged) {
      const mesh = new THREE.Mesh(merged, mats[k]);
      mesh.name = `MazeRoom_${k}`;
      parentGroup.add(mesh);
    }
  }

  return annexLights;
}
