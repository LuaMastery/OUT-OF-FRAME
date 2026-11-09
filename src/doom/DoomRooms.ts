import * as THREE from 'three';
import { StaticColliderBox } from '../engine/physics/SpatialSweep';
import {
  CELL_SIZE,
  gridCellToWorld,
  isSolidCell,
  LABYRINTH_MAP,
  WALL_HEIGHT,
} from './DoomMazeBuilder';
import {
  createDoomPropMaterial,
  createDoomSurfaceMaterial,
  DoomSharedUniforms,
} from './DoomShader';
import {
  createSpecialRoomDoorIconTexture,
  createSpecialRoomMiniMapTexture,
  DoomTextureSet,
} from './DoomTextures';

export type DoomRoomId =
  | 'computer_room'
  | 'biology_lab'
  | 'crew_quarters'
  | 'medical_ward'
  | 'vegetation_room'
  | 'library_room'
  | 'reactor_hall';

export type SpecialRoomKeyItemId =
  | 'key_computer_room'
  | 'key_biology_lab'
  | 'key_crew_quarters'
  | 'key_medical_ward'
  | 'key_vegetation_room'
  | 'key_library_room'
  | 'reactor_hall_key_alias_unused'
  | 'key_reactor_hall';

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
  /** Código setorial exibido na placa luminosa do pórtico (ex: CPU-01) */
  doorCode: string;
  /** Cor temática hexadecimal do ícone, chave e mini-mapa mural */
  accentHex: number;
  /** ID exclusivo da chave necessária para destrancar esta Sala Especial */
  keyItemId: string;
  /** Nome legível da chave específica desta Sala Especial */
  keyName: string;
  /** Limites em células de grade da Ala Externa 7x7 (100% fora de 0..28 x 0..28 e desconectada das demais!) */
  minGx: number;
  maxGx: number;
  minGz: number;
  maxGz: number;
  /** Planta baixa interna 7x7 ('.' = corredor/sub-sala, '#' = parede interna annexWall, 'C' = núcleo sólido) */
  miniMap: ReadonlyArray<string>;
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

export interface SpecialRoomDoorInstance {
  room: ThemedRoomDefinition;
  keyItemId: string;
  keyName: string;
  doorWorldPos: THREE.Vector3;
  unlocked: boolean;
  openProgress: number;
  collider: StaticColliderBox;
  leftLeaf: THREE.Group;
  rightLeaf: THREE.Group;
  ledMaterials: THREE.ShaderMaterial[];
}

export interface DoomSpecialRoomDoorController {
  readonly doors: ReadonlyArray<SpecialRoomDoorInstance>;
  isUnlocked(roomId: DoomRoomId): boolean;
  unlockRoom(roomId: DoomRoomId): boolean;
  findNearbyLockedDoor(
    playerPos: THREE.Vector3,
    maxDistance?: number
  ): SpecialRoomDoorInstance | null;
  findMatchingDoorForKey(
    keyItemId: string,
    playerPos: THREE.Vector3,
    maxDistance?: number
  ): SpecialRoomDoorInstance | null;
  update(dt: number): void;
  dispose(): void;
}

/** Limites estendidos de grade abrangendo o mapa 29x29 (0..28) + todas as 7 Salas Externas 7x7 (-7..35) */
export const ANNEX_MIN_GRID = -8;
export const ANNEX_MAX_GRID = 36;

/**
 * Catálogo oficial das 7 Salas Especiais Externas 7x7 ("Fora do Mapa" — Mini-Mapas Anexos Isolados):
 * - Nenhuma sala toca ou se conecta a outra sala especial (>= 1 célula de vazio estrutural entre todas);
 * - Cada sala possui um mini-mapa interno 7x7 próprio com sub-câmaras, divisórias e corredores;
 * - Todas começam TRANCADAS por portas blindadas duplas, exigindo sua chave específica!
 */
export const THEMED_ROOMS: ReadonlyArray<ThemedRoomDefinition> = [
  {
    id: 'computer_room',
    name: 'SALA DOS COMPUTADORES',
    subtitle: 'Ala Norte — Mainframe Central, Cofre de Fitas & Telemetria CRT',
    doorCode: 'CPU-01',
    accentHex: 0x42d4ff,
    keyItemId: 'key_computer_room',
    keyName: 'Chave — Sala dos Computadores',
    minGx: 8,
    maxGx: 14,
    minGz: -7,
    maxGz: -1,
    miniMap: [
      '..#.#..',
      '.......',
      '..#.#..',
      '###.###',
      '..#.#..',
      '.......',
      '..#.#..',
    ],
    doorGx: 11,
    doorGz: 0,
    innerGx: 11,
    innerGz: 1,
    outwardDir: 'N',
  },
  {
    id: 'reactor_hall',
    name: 'SALÃO DOS REATORES',
    subtitle: 'Ala Nordeste — Anel Tokamak, Galerias Blindadas & Capacitores',
    doorCode: 'REA-07',
    accentHex: 0xff9238,
    keyItemId: 'key_reactor_hall',
    keyName: 'Chave — Salão dos Reatores',
    minGx: 22,
    maxGx: 28,
    minGz: -7,
    maxGz: -1,
    miniMap: [
      '..#.#..',
      '.......',
      '#.#.#.#',
      '.......',
      '.#.C.#.',
      '.#...#.',
      '.......',
    ],
    doorGx: 25,
    doorGz: 0,
    innerGx: 25,
    innerGz: 1,
    outwardDir: 'N',
  },
  {
    id: 'biology_lab',
    name: 'LABORATÓRIO BIOLÓGICO',
    subtitle: 'Ala Noroeste — Câmaras Xenobiológicas, Criogenia & Autópsia',
    doorCode: 'BIO-02',
    accentHex: 0x3ef09a,
    keyItemId: 'key_biology_lab',
    keyName: 'Chave — Laboratório Biológico',
    minGx: -7,
    maxGx: -1,
    minGz: 2,
    maxGz: 8,
    miniMap: [
      '..#..#.',
      '.....#.',
      '#.##.#.',
      '.......',
      '#.##.#.',
      '.....#.',
      '..#..#.',
    ],
    doorGx: 0,
    doorGz: 5,
    innerGx: 1,
    innerGz: 5,
    outwardDir: 'W',
  },
  {
    id: 'crew_quarters',
    name: 'QUARTOS DA EQUIPE',
    subtitle: 'Ala Oeste — Cabines de Beliches, Vestiário & Refeitório',
    doorCode: 'HAB-03',
    accentHex: 0xf4b942,
    keyItemId: 'key_crew_quarters',
    keyName: 'Chave — Quartos da Equipe',
    minGx: -7,
    maxGx: -1,
    minGz: 10,
    maxGz: 16,
    miniMap: [
      '..#.#..',
      '.......',
      '###...#',
      '.....#.',
      '..##...',
      '#....#.',
      '#.#..#.',
    ],
    doorGx: 0,
    doorGz: 11,
    innerGx: 1,
    innerGz: 11,
    outwardDir: 'W',
  },
  {
    id: 'medical_ward',
    name: 'ENFERMARIA & QUARENTENA',
    subtitle: 'Ala Leste — Isolamento Clínico, UTI, Farmácia & Cirurgia',
    doorCode: 'MED-04',
    accentHex: 0xff5a6e,
    keyItemId: 'key_medical_ward',
    keyName: 'Chave — Enfermaria & Quarentena',
    minGx: 29,
    maxGx: 35,
    minGz: 9,
    maxGz: 15,
    miniMap: [
      '.#..#..',
      '...#..#',
      '##.#.##',
      '.......',
      '##.#.##',
      '...#..#',
      '.#..#..',
    ],
    doorGx: 28,
    doorGz: 12,
    innerGx: 27,
    innerGz: 12,
    outwardDir: 'E',
  },
  {
    id: 'library_room',
    name: 'BIBLIOTECA & ARQUIVOS',
    subtitle: 'Ala Sudeste — Labirinto de Estantes, Salão de Leitura & Cofre Raro',
    doorCode: 'ARC-06',
    accentHex: 0xd89c52,
    keyItemId: 'key_library_room',
    keyName: 'Chave — Biblioteca & Arquivos',
    minGx: 29,
    maxGx: 35,
    minGz: 17,
    maxGz: 23,
    miniMap: [
      '...#...',
      '.#.#.#.',
      '.#...#.',
      '....#..',
      '.#...#.',
      '.#.#.#.',
      '...#...',
    ],
    doorGx: 28,
    doorGz: 20,
    innerGx: 27,
    innerGz: 20,
    outwardDir: 'E',
  },
  {
    id: 'vegetation_room',
    name: 'SALA DE VEGETAÇÃO',
    subtitle: 'Ala Sul — Terraços Hidropônicos, Estufa Central & Banco de Sementes',
    doorCode: 'ECO-05',
    accentHex: 0x6ce85b,
    keyItemId: 'key_vegetation_room',
    keyName: 'Chave — Sala de Vegetação',
    minGx: 3,
    maxGx: 9,
    minGz: 29,
    maxGz: 35,
    miniMap: [
      '..#.#..',
      '.......',
      '#.#.#.#',
      '.......',
      '.##.##.',
      '.......',
      '..#.#..',
    ],
    doorGx: 6,
    doorGz: 28,
    innerGx: 6,
    innerGz: 27,
    outwardDir: 'S',
  },
];

export const SPECIAL_ROOM_KEY_ITEM_IDS: ReadonlyArray<string> = THEMED_ROOMS.map(
  (r) => r.keyItemId
);

/** Estado global sincronizado das portas trancadas/destrancadas das Salas Especiais da partida atual */
const unlockedRoomIds = new Set<DoomRoomId>();

export function resetThemedRoomLocks(): void {
  unlockedRoomIds.clear();
}

export function unlockThemedRoom(roomId: DoomRoomId): boolean {
  if (unlockedRoomIds.has(roomId)) return false;
  unlockedRoomIds.add(roomId);
  return true;
}

export function isThemedRoomUnlocked(roomId: DoomRoomId): boolean {
  return unlockedRoomIds.has(roomId);
}

export function getThemedRoomByKeyItemId(
  itemId: string
): ThemedRoomDefinition | null {
  for (const r of THEMED_ROOMS) {
    if (r.keyItemId === itemId) return r;
  }
  return null;
}

/**
 * Retorna o caractere da planta baixa interna 7x7 (`'.'`, `'#'` ou `'C'`) de uma Sala Especial,
 * ou `null` caso `(gx, gz)` não pertença ao interior 7x7 de nenhuma sala.
 */
export function getThemedRoomMiniMapTile(
  gx: number,
  gz: number
): '.' | '#' | 'C' | null {
  for (const r of THEMED_ROOMS) {
    if (gx >= r.minGx && gx <= r.maxGx && gz >= r.minGz && gz <= r.maxGz) {
      const row = r.miniMap[gz - r.minGz];
      const ch = row?.[gx - r.minGx];
      if (ch === '#') return '#';
      if (ch === 'C') return 'C';
      return '.';
    }
  }
  return null;
}

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
 * Indica se uma célula `(gx, gz)` é transitável considerando o labirinto 29x29,
 * o estado de trancamento dos 7 pórticos blindados e o mini-mapa interno 7x7 de cada Sala Especial!
 */
export function isWalkableArenaCell(
  gx: number,
  gz: number,
  options?: { ignoreRoomLocks?: boolean }
): boolean {
  const rows = LABYRINTH_MAP.length;
  const cols = LABYRINTH_MAP[0].length;
  if (gx >= 0 && gx < cols && gz >= 0 && gz < rows) {
    if (!isSolidCell(LABYRINTH_MAP, gx, gz)) return true;
    const doorRoom = getThemedRoomByDoorCell(gx, gz);
    if (!doorRoom) return false;
    return options?.ignoreRoomLocks ? true : unlockedRoomIds.has(doorRoom.id);
  }
  const tile = getThemedRoomMiniMapTile(gx, gz);
  return tile === '.';
}

// ============================================================================
// GERADOR DE MOBILIÁRIO 3D ESPECÍFICO NAS SALAS EXTERNAS 7x7
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
      return { width: 1.54, depth: 1.24, maxY: 1.32 };
    case 'archive_catalog_cabinet':
      return { width: 1.5, depth: 0.7, maxY: 1.98 };
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
  /** Parede externa ou divisória '#' onde encosta ('N' | 'S' | 'W' | 'E') ou ilha central ('CENTER') */
  attach: 'N' | 'S' | 'W' | 'E' | 'CENTER';
  /** Rotação opcional para peças centrais */
  centerYaw?: number;
}

const CURATED_ROOM_SPECS: ReadonlyArray<RawRoomFurnitureSpec> = [
  // 1. SALA DOS COMPUTADORES — Ala Norte 7x7 (gx 8..14, gz -7..-1, entrada em (11, -1))
  { roomId: 'computer_room', kind: 'server_rack_bank', gx: 8, gz: -7, attach: 'N' },
  { roomId: 'computer_room', kind: 'server_rack_bank', gx: 9, gz: -7, attach: 'N' },
  { roomId: 'computer_room', kind: 'server_rack_bank', gx: 8, gz: -6, attach: 'W' },
  { roomId: 'computer_room', kind: 'server_rack_bank', gx: 14, gz: -6, attach: 'E' },
  { roomId: 'computer_room', kind: 'server_rack_bank', gx: 13, gz: -7, attach: 'N' },
  { roomId: 'computer_room', kind: 'crt_workstation_desk', gx: 14, gz: -7, attach: 'N' },
  { roomId: 'computer_room', kind: 'crt_workstation_desk', gx: 8, gz: -3, attach: 'N' },
  { roomId: 'computer_room', kind: 'crt_workstation_desk', gx: 14, gz: -3, attach: 'N' },
  { roomId: 'computer_room', kind: 'crt_workstation_desk', gx: 8, gz: -1, attach: 'S' },
  { roomId: 'computer_room', kind: 'server_rack_bank', gx: 14, gz: -1, attach: 'S' },

  // 2. SALÃO DOS REATORES — Ala Nordeste 7x7 (gx 22..28, gz -7..-1, entrada em (25, -1), Tokamak em (25, -3))
  { roomId: 'reactor_hall', kind: 'reactor_capacitor_console', gx: 22, gz: -7, attach: 'N' },
  { roomId: 'reactor_hall', kind: 'reactor_capacitor_console', gx: 23, gz: -7, attach: 'E' },
  { roomId: 'reactor_hall', kind: 'crt_workstation_desk', gx: 25, gz: -7, attach: 'N' },
  { roomId: 'reactor_hall', kind: 'reactor_capacitor_console', gx: 28, gz: -7, attach: 'N' },
  { roomId: 'reactor_hall', kind: 'reactor_capacitor_console', gx: 22, gz: -3, attach: 'W' },
  { roomId: 'reactor_hall', kind: 'reactor_capacitor_console', gx: 28, gz: -3, attach: 'E' },
  { roomId: 'reactor_hall', kind: 'crt_workstation_desk', gx: 22, gz: -1, attach: 'S' },
  { roomId: 'reactor_hall', kind: 'crt_workstation_desk', gx: 28, gz: -1, attach: 'S' },

  // 3. LABORATÓRIO BIOLÓGICO — Ala Noroeste 7x7 (gx -7..-1, gz 2..8, entrada em (-1, 5))
  { roomId: 'biology_lab', kind: 'cryo_biohazard_cabinet', gx: -7, gz: 2, attach: 'N' },
  { roomId: 'biology_lab', kind: 'bio_specimen_tank', gx: -4, gz: 2, attach: 'N' },
  { roomId: 'biology_lab', kind: 'xenobio_lab_bench', gx: -3, gz: 2, attach: 'N' },
  { roomId: 'biology_lab', kind: 'cryo_biohazard_cabinet', gx: -1, gz: 2, attach: 'N' },
  { roomId: 'biology_lab', kind: 'bio_specimen_tank', gx: -6, gz: 2, attach: 'E' },
  { roomId: 'biology_lab', kind: 'autopsy_surgical_table', gx: -4, gz: 5, attach: 'N' },
  { roomId: 'biology_lab', kind: 'cryo_biohazard_cabinet', gx: -7, gz: 8, attach: 'S' },
  { roomId: 'biology_lab', kind: 'bio_specimen_tank', gx: -4, gz: 8, attach: 'S' },
  { roomId: 'biology_lab', kind: 'xenobio_lab_bench', gx: -3, gz: 8, attach: 'S' },
  { roomId: 'biology_lab', kind: 'bio_specimen_tank', gx: -1, gz: 8, attach: 'S' },

  // 4. QUARTOS DA EQUIPE — Ala Oeste 7x7 (gx -7..-1, gz 10..16, entrada em (-1, 11))
  { roomId: 'crew_quarters', kind: 'astronaut_bunk_bed', gx: -7, gz: 10, attach: 'N' },
  { roomId: 'crew_quarters', kind: 'cabin_nightstand_desk', gx: -6, gz: 10, attach: 'E' },
  { roomId: 'crew_quarters', kind: 'astronaut_bunk_bed', gx: -4, gz: 10, attach: 'N' },
  { roomId: 'crew_quarters', kind: 'crew_locker_bank', gx: -2, gz: 10, attach: 'N' },
  { roomId: 'crew_quarters', kind: 'crew_mess_table', gx: -2, gz: 12, attach: 'E' },
  { roomId: 'crew_quarters', kind: 'astronaut_bunk_bed', gx: -7, gz: 14, attach: 'W' },
  { roomId: 'crew_quarters', kind: 'crew_locker_bank', gx: -1, gz: 13, attach: 'N' },
  { roomId: 'crew_quarters', kind: 'astronaut_bunk_bed', gx: -4, gz: 16, attach: 'S' },
  { roomId: 'crew_quarters', kind: 'cabin_nightstand_desk', gx: -3, gz: 16, attach: 'S' },
  { roomId: 'crew_quarters', kind: 'crew_locker_bank', gx: -1, gz: 16, attach: 'S' },

  // 5. ENFERMARIA & QUARENTENA — Ala Leste 7x7 (gx 29..35, gz 9..15, entrada em (29, 12))
  { roomId: 'medical_ward', kind: 'medical_supply_cabinet', gx: 29, gz: 9, attach: 'N' },
  { roomId: 'medical_ward', kind: 'medical_gurney_bed', gx: 32, gz: 9, attach: 'N' },
  { roomId: 'medical_ward', kind: 'vitals_monitor_cart', gx: 34, gz: 9, attach: 'W' },
  { roomId: 'medical_ward', kind: 'medical_gurney_bed', gx: 35, gz: 9, attach: 'N' },
  { roomId: 'medical_ward', kind: 'vitals_monitor_cart', gx: 30, gz: 12, attach: 'N' },
  { roomId: 'medical_ward', kind: 'medical_supply_cabinet', gx: 29, gz: 15, attach: 'S' },
  { roomId: 'medical_ward', kind: 'medical_gurney_bed', gx: 32, gz: 15, attach: 'S' },
  { roomId: 'medical_ward', kind: 'medical_gurney_bed', gx: 35, gz: 15, attach: 'S' },

  // 6. BIBLIOTECA & ARQUIVOS — Ala Sudeste 7x7 (gx 29..35, gz 17..23, entrada em (29, 20))
  { roomId: 'library_room', kind: 'archive_catalog_cabinet', gx: 29, gz: 17, attach: 'N' },
  { roomId: 'library_room', kind: 'oak_bookshelf_tall', gx: 30, gz: 17, attach: 'N' },
  { roomId: 'library_room', kind: 'oak_bookshelf_tall', gx: 33, gz: 17, attach: 'N' },
  { roomId: 'library_room', kind: 'oak_bookshelf_tall', gx: 35, gz: 17, attach: 'N' },
  { roomId: 'library_room', kind: 'library_reading_table', gx: 32, gz: 19, attach: 'N' },
  { roomId: 'library_room', kind: 'library_reading_table', gx: 32, gz: 21, attach: 'S' },
  { roomId: 'library_room', kind: 'archive_catalog_cabinet', gx: 29, gz: 23, attach: 'S' },
  { roomId: 'library_room', kind: 'oak_bookshelf_tall', gx: 30, gz: 23, attach: 'S' },
  { roomId: 'library_room', kind: 'oak_bookshelf_tall', gx: 33, gz: 23, attach: 'S' },
  { roomId: 'library_room', kind: 'oak_bookshelf_tall', gx: 35, gz: 23, attach: 'S' },

  // 7. SALA DE VEGETAÇÃO — Ala Sul 7x7 (gx 3..9, gz 29..35, entrada em (6, 29))
  { roomId: 'vegetation_room', kind: 'irrigation_nutrient_tank', gx: 3, gz: 29, attach: 'N' },
  { roomId: 'vegetation_room', kind: 'irrigation_nutrient_tank', gx: 9, gz: 29, attach: 'N' },
  { roomId: 'vegetation_room', kind: 'hydroponic_tree_planter', gx: 3, gz: 30, attach: 'W' },
  { roomId: 'vegetation_room', kind: 'hydroponic_tree_planter', gx: 9, gz: 30, attach: 'E' },
  { roomId: 'vegetation_room', kind: 'botanical_fern_trough', gx: 3, gz: 33, attach: 'W' },
  { roomId: 'vegetation_room', kind: 'botanical_fern_trough', gx: 9, gz: 33, attach: 'E' },
  { roomId: 'vegetation_room', kind: 'hydroponic_tree_planter', gx: 3, gz: 35, attach: 'S' },
  { roomId: 'vegetation_room', kind: 'botanical_fern_trough', gx: 4, gz: 35, attach: 'E' },
  { roomId: 'vegetation_room', kind: 'botanical_fern_trough', gx: 8, gz: 35, attach: 'W' },
  { roomId: 'vegetation_room', kind: 'hydroponic_tree_planter', gx: 9, gz: 35, attach: 'S' },
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
    // Norte (-Z): costas (-Z) na parede Norte, frente (+Z) para Sul (+Z) -> yaw = 0
    N: { nx: 0, nz: -1, yaw: 0 },
    // Sul (+Z): costas (-Z) na parede Sul, frente (+Z) para Norte (-Z) -> yaw = PI
    S: { nx: 0, nz: 1, yaw: Math.PI },
    // Oeste (-X): costas (-Z) na parede Oeste, frente (+Z) para Leste (+X) -> yaw = +PI/2
    W: { nx: -1, nz: 0, yaw: Math.PI * 0.5 },
    // Leste (+X): costas (-Z) na parede Leste, frente (+Z) para Oeste (-X) -> yaw = -PI/2
    E: { nx: 1, nz: 0, yaw: -Math.PI * 0.5 },
  };

  for (let i = 0; i < CURATED_ROOM_SPECS.length; i++) {
    const spec = CURATED_ROOM_SPECS[i];
    const room = THEMED_ROOMS.find((r) => r.id === spec.roomId);
    if (!room) continue;
    if (isThemedRoomThresholdCell(spec.gx, spec.gz)) continue;
    if (getThemedRoomMiniMapTile(spec.gx, spec.gz) !== '.') continue;

    const dims = getFurnitureDimensions(spec.kind);
    const cellCenter = gridCellToWorld(spec.gx, spec.gz);
    let wx = cellCenter.x;
    let wz = cellCenter.z;
    let yaw = spec.centerYaw ?? 0;

    if (spec.attach !== 'CENTER') {
      const dir = attachMap[spec.attach];
      // Revestimento interno extra (0.22m) apenas na parede perimetral que encosta no labirinto 29x29; 0.08m nas demais paredes externas e divisórias '#'
      const touchesEntrySide =
        (room.outwardDir === 'N' &&
          spec.attach === 'S' &&
          spec.gz === room.maxGz) ||
        (room.outwardDir === 'S' &&
          spec.attach === 'N' &&
          spec.gz === room.minGz) ||
        (room.outwardDir === 'W' &&
          spec.attach === 'E' &&
          spec.gx === room.maxGx) ||
        (room.outwardDir === 'E' &&
          spec.attach === 'W' &&
          spec.gx === room.minGx);
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
  computerScreen: THREE.ShaderMaterial;
  lampShade: THREE.ShaderMaterial;
  bankerShade: THREE.ShaderMaterial;
  bookshelf: THREE.ShaderMaterial;
  libraryRug: THREE.ShaderMaterial;
  foliage: THREE.ShaderMaterial;
  mossSoil: THREE.ShaderMaterial;
  bioFluid: THREE.ShaderMaterial;
  specimenGlass: THREE.ShaderMaterial;
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

  // A cúpula é opaca; somente o difusor debaixo dela emite luz.
  const shadeTex = makeRoomPixelTex(16, 16, (px) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const n = (hash2i(x, y, 810) - 0.5) * 12;
      px(x, y, 198 + n, 177 + n, 142 + n);
    }
  });
  const greenShadeTex = makeRoomPixelTex(16, 16, (px) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const n = (hash2i(x, y, 811) - 0.5) * 9;
      px(x, y, 35 + n, 112 + n, 76 + n);
    }
  });
  const computerScreen = createDoomSurfaceMaterial(crtTex, sharedUniforms, {
    fullBright: true, useLocalUv: true,
  });
  computerScreen.uniforms.uComputerTime = { value: 0 };
  computerScreen.fragmentShader = computerScreen.fragmentShader
    .replace('uniform sampler2D uMap;', 'uniform sampler2D uMap;\n      uniform float uComputerTime;')
    .replace('vec4 texel = texture2D(uMap, uv);', `
        vec4 texel = texture2D(uMap, uv);
        // Texto desloca em saltos de pixel, cursor pisca e feixe percorre o vidro.
        // As bordas permanecem fixas; não afeta luminárias que usam crtScreen.
        if (uv.x > 0.065 && uv.x < 0.935 && uv.y > 0.53 && uv.y < 0.88) {
          vec2 textUv = vec2(uv.x, 0.53 + mod(uv.y - 0.53 + floor(uComputerTime * 2.0) / 64.0, 0.35));
          texel = texture2D(uMap, textUv);
          if (uv.x > 0.16 && uv.x < 0.21 && uv.y > 0.58 && uv.y < 0.62 && mod(floor(uComputerTime * 2.0), 2.0) < 1.0)
            texel.rgb = vec3(0.35, 1.0, 0.62);
        }
        if (uv.x > 0.13 && uv.x < 0.87 && uv.y > 0.12 && uv.y < 0.48) {
          vec2 graphUv = vec2(0.13 + mod(uv.x - 0.13 + floor(uComputerTime * 3.0) / 64.0, 0.74), uv.y);
          texel = texture2D(uMap, graphUv);
        }
        float sweep = 1.0 - smoothstep(0.0, 0.035, abs(uv.y - fract(uComputerTime * 0.16)));
        texel.rgb *= 0.92 + 0.16 * sweep;
      `);
  // Fluido semitransparente permite ver o espécime no tanque, sem alterar os demais materiais.
  const specimenGlass = createDoomSurfaceMaterial(bioFluidTex, sharedUniforms, { fullBright: true, useLocalUv: true });
  specimenGlass.transparent = true;
  specimenGlass.depthWrite = false;
  specimenGlass.side = THREE.DoubleSide;
  specimenGlass.fragmentShader = specimenGlass.fragmentShader.replace(
    'vec4(clamp(max(glowRgb, passiveRgb), 0.0, 1.0), 1.0)',
    'vec4(clamp(max(glowRgb, passiveRgb), 0.0, 1.0), 0.26)'
  );
  const lampShade = createDoomSurfaceMaterial(shadeTex, sharedUniforms, { useLocalUv: true, baseLight: 0.25 });
  const bankerShade = createDoomSurfaceMaterial(greenShadeTex, sharedUniforms, { useLocalUv: true, baseLight: 0.25 });
  lampShade.side = THREE.DoubleSide;
  bankerShade.side = THREE.DoubleSide;

  return {
    computerScreen,
    specimenGlass,
    lampShade,
    bankerShade,
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

/** Casca aberta: nenhuma tampa sólida atravessa o difusor do abajur. */
function pushRoomLampShell(
  bucket: THREE.BufferGeometry[], xf: LocalXf,
  top: number, bottom: number, height: number,
  x: number, y: number, z: number,
  rotationZ = 0, arc = Math.PI * 2
): void {
  const geometry = new THREE.CylinderGeometry(top, bottom, height, 16, 1, true, 0, arc);
  if (rotationZ) geometry.rotateZ(rotationZ);
  geometry.translate(x, y, z);
  if (xf.yaw) geometry.rotateY(xf.yaw);
  geometry.translate(xf.cx, 0, xf.cz);
  bucket.push(geometry);
}

function pushRoomSphere(
  bucket: THREE.BufferGeometry[], xf: LocalXf,
  radius: number, x: number, y: number, z: number
): void {
  const geometry = new THREE.SphereGeometry(radius, 16, 10);
  geometry.translate(x, y, z);
  if (xf.yaw) geometry.rotateY(xf.yaw);
  geometry.translate(xf.cx, 0, xf.cz);
  bucket.push(geometry);
}

function pushRoomRod(
  bucket: THREE.BufferGeometry[], xf: LocalXf, radius: number,
  start: THREE.Vector3, end: THREE.Vector3
): void {
  const direction = end.clone().sub(start);
  const geometry = new THREE.CylinderGeometry(radius, radius, direction.length(), 6);
  geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 1, 0), direction.normalize()
  ));
  const midpoint = start.clone().add(end).multiplyScalar(0.5);
  geometry.translate(midpoint.x, midpoint.y, midpoint.z);
  if (xf.yaw) geometry.rotateY(xf.yaw);
  geometry.translate(xf.cx, 0, xf.cz);
  bucket.push(geometry);
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
 * Constrói a arquitetura 3D completa de cada Sala Especial Externa 7x7 (Fora do Mapa):
 * - Piso exclusivo (`annexFloor`) + incrustações temáticas por câmara sem Z-fighting;
 * - Teto arquitetônico (`annexCeiling`) + sancas/cornijas e nervuras escalonadas (ZERO Z-fighting — corrige image-22 e image-23);
 * - Paredes externas + paredes divisórias internas `'#'` do mini-mapa 7x7 (`annexWall`) com rodapés e colisores;
 * - Pórtico Blindado de Acesso sem coplanaridade na verga (corrige image-21);
 * - Luminárias suspensas em células transitáveis + marcos arquitetônicos temáticos.
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

  const vaultTopY = WALL_HEIGHT; // 3.20m
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

    const roomW = roomMaxX - roomMinX; // 21.0m (7x7 células)
    const roomD = roomMaxZ - roomMinZ; // 21.0m (7x7 células)
    const roomCx = (roomMinX + roomMaxX) * 0.5;
    const roomCz = (roomMinZ + roomMaxZ) * 0.5;
    const doorWorld = gridCellToWorld(r.doorGx, r.doorGz);

    const worldXf: LocalXf = { cx: 0, cz: 0, yaw: 0 };

    // 1. PISO (`annexFloor`) e TETO (`annexCeiling`) EXCLUSIVOS DA SALA EXTERNA 7x7
    pushWorldPlaneXZ(
      b.annexFloor,
      roomW - 0.01,
      roomD - 0.01,
      roomCx,
      0,
      roomCz,
      false
    );
    pushWorldPlaneXZ(
      b.annexCeiling,
      roomW - 0.01,
      roomD - 0.01,
      roomCx,
      vaultTopY,
      roomCz,
      true
    );

    const trimMatBucket =
      r.id === 'library_room' || r.id === 'vegetation_room'
        ? b.weatheredWood
        : b.metalTrim;
    const isCoolLight =
      r.id === 'computer_room' ||
      r.id === 'biology_lab' ||
      r.id === 'reactor_hall';
    const lampGlowBucket = isCoolLight ? b.crtScreen : b.warmLampGlow;

    const isRoomWallOrOutside = (gx: number, gz: number): boolean => {
      if (gx === r.doorGx && gz === r.doorGz) return false;
      if (gx < r.minGx || gx > r.maxGx || gz < r.minGz || gz > r.maxGz) {
        return true;
      }
      return getThemedRoomMiniMapTile(gx, gz) === '#';
    };

    const openCellsWorld: THREE.Vector3[] = [];

    // 2. MINI-MAPA INTERNO 7x7: DIVISÓRIAS '#', PISOS TEMÁTICOS, SANCAS ESCALONADAS E NERVURAS SEM Z-FIGHTING
    const intWallH = WALL_HEIGHT - 0.008; // 0.004..3.196 -> jamais toca piso (0.000) ou teto (3.200)!
    const intWallMidY = WALL_HEIGHT * 0.5;

    for (let gz = r.minGz; gz <= r.maxGz; gz++) {
      for (let gx = r.minGx; gx <= r.maxGx; gx++) {
        const tile = getThemedRoomMiniMapTile(gx, gz);
        const cellW = gridCellToWorld(gx, gz);
        const cellXf: LocalXf = { cx: cellW.x, cz: cellW.z, yaw: 0 };

        if (tile === '#') {
          // Bloco divisório interno sólido da Sala Especial (`annexWall`)
          pushRoomBox(
            b.annexWall,
            worldXf,
            CELL_SIZE,
            intWallH,
            CELL_SIZE,
            cellW.x,
            intWallMidY,
            cellW.z
          );
          addSolidCollider(
            colliders,
            `room-arch-${r.id}-miniwall-${gx}-${gz}`,
            cellW.x,
            cellW.z,
            CELL_SIZE,
            CELL_SIZE,
            WALL_HEIGHT
          );

          // Rodapés metálicos limpos apenas nas faces voltadas para corredores/sub-salas transitáveis '.'
          const dirs = [
            { dx: 0, dz: -1, ox: 0, oz: -1.518, sx: 2.92, sz: 0.036 },
            { dx: 0, dz: 1, ox: 0, oz: 1.518, sx: 2.92, sz: 0.036 },
            { dx: -1, dz: 0, ox: -1.518, oz: 0, sx: 0.036, sz: 2.92 },
            { dx: 1, dz: 0, ox: 1.518, oz: 0, sx: 0.036, sz: 2.92 },
          ] as const;
          for (const d of dirs) {
            if (getThemedRoomMiniMapTile(gx + d.dx, gz + d.dz) === '.') {
              pushRoomBox(
                b.darkIron,
                cellXf,
                d.sx,
                0.15,
                d.sz,
                d.ox,
                0.08,
                d.oz
              );
            }
          }
          continue;
        }

        if (tile === '.') {
          openCellsWorld.push(new THREE.Vector3(cellW.x, 0, cellW.z));
        }

        // Tapetes / pisos embutidos temáticos APENAS nas células abertas (com alturas escalonadas sem Z-fighting!)
        const insetSpan = CELL_SIZE - 0.36; // 2.64m dentro da célula 3x3
        switch (r.id) {
          case 'computer_room':
          case 'reactor_hall':
            if (tile === '.') {
              pushRoomBox(
                b.techFloor,
                cellXf,
                insetSpan,
                0.012,
                insetSpan,
                0,
                0.006,
                0
              );
            }
            break;
          case 'biology_lab':
          case 'medical_ward':
            pushRoomBox(
              b.labTile,
              cellXf,
              insetSpan,
              0.012,
              insetSpan,
              0,
              0.006,
              0
            );
            break;
          case 'library_room':
            pushRoomBox(
              b.oakWood,
              cellXf,
              insetSpan,
              0.01,
              insetSpan,
              0,
              0.005,
              0
            );
            if (gx >= r.minGx + 2 && gx <= r.maxGx - 2) {
              // Tapete elevado claramente acima do assoalho de carvalho (bottomY = 0.011 > topY = 0.010)
              pushRoomBox(
                b.libraryRug,
                cellXf,
                insetSpan - 0.36,
                0.012,
                insetSpan - 0.36,
                0,
                0.017,
                0
              );
            }
            break;
          case 'vegetation_room':
            if ((gx + gz) % 2 === 0) {
              pushRoomBox(
                b.mossSoil,
                cellXf,
                insetSpan - 0.16,
                0.014,
                insetSpan - 0.16,
                0,
                0.007,
                0
              );
            }
            break;
          case 'crew_quarters':
            pushRoomBox(
              b.oakWood,
              cellXf,
              insetSpan,
              0.012,
              insetSpan,
              0,
              0.006,
              0
            );
            break;
        }

        // Cornijas/fáscias superiores contornando paredes adjacentes (bottomY = 2.94m, topY = 3.194m -> ZERO coplanaridade com teto 3.200m!)
        const wallN = isRoomWallOrOutside(gx, gz - 1);
        const wallS = isRoomWallOrOutside(gx, gz + 1);
        const wallW = isRoomWallOrOutside(gx - 1, gz);
        const wallE = isRoomWallOrOutside(gx + 1, gz);
        const corniceH = 0.254;
        const corniceMidY = vaultTopY - 0.006 - corniceH * 0.5; // 3.067m (2.940..3.194)
        const corniceSpan = CELL_SIZE - 0.38; // Recuado 0.19m nas pontas para nunca cruzar nos cantos!
        if (wallN) {
          pushRoomBox(
            trimMatBucket,
            cellXf,
            corniceSpan,
            corniceH,
            0.15,
            0,
            corniceMidY,
            -CELL_SIZE * 0.5 + 0.085
          );
        }
        if (wallS) {
          pushRoomBox(
            trimMatBucket,
            cellXf,
            corniceSpan,
            corniceH,
            0.15,
            0,
            corniceMidY,
            CELL_SIZE * 0.5 - 0.085
          );
        }
        if (wallW) {
          pushRoomBox(
            trimMatBucket,
            cellXf,
            0.15,
            corniceH,
            corniceSpan,
            -CELL_SIZE * 0.5 + 0.085,
            corniceMidY,
            0
          );
        }
        if (wallE) {
          pushRoomBox(
            trimMatBucket,
            cellXf,
            0.15,
            corniceH,
            corniceSpan,
            CELL_SIZE * 0.5 - 0.085,
            corniceMidY,
            0
          );
        }

        // Nervura transversal recuada (bottomY = 3.07m > 2.94m, contida em 2.36m -> NUNCA cruza outras vigas! Corrige image-23!)
        if ((gx + gz) % 2 === 0) {
          pushRoomBox(
            b.darkIron,
            cellXf,
            CELL_SIZE - 0.64,
            0.12,
            0.16,
            0,
            vaultTopY - 0.07,
            0
          );
        }
      }
    }

    // 4 Luminárias Arquitetônicas Suspensas garantidamente em células abertas '.' da sala
    const lampTargetCoords: Array<[number, number]> = [
      [r.minGx + 1, r.minGz + 1],
      [r.maxGx - 1, r.minGz + 1],
      [r.minGx + 1, r.maxGz - 1],
      [r.maxGx - 1, r.maxGz - 1],
    ];
    const findNearestOpenCell = (tgx: number, tgz: number): THREE.Vector3 => {
      if (getThemedRoomMiniMapTile(tgx, tgz) === '.') {
        const w = gridCellToWorld(tgx, tgz);
        return new THREE.Vector3(w.x, 0, w.z);
      }
      const tw = gridCellToWorld(tgx, tgz);
      let best = openCellsWorld[0] ?? new THREE.Vector3(roomCx, 0, roomCz);
      let bestDist = Infinity;
      for (const c of openCellsWorld) {
        const d = Math.hypot(c.x - tw.x, c.z - tw.z);
        if (d < bestDist) {
          bestDist = d;
          best = c;
        }
      }
      return best;
    };

    const chosenLampWorlds = lampTargetCoords.map(([lgx, lgz]) =>
      findNearestOpenCell(lgx, lgz)
    );
    const emittedLampKeys = new Set<string>();
    for (const lw of chosenLampWorlds) {
      const key = `${lw.x.toFixed(1)},${lw.z.toFixed(1)}`;
      if (emittedLampKeys.has(key)) continue;
      emittedLampKeys.add(key);
      const lXf: LocalXf = { cx: lw.x, cz: lw.z, yaw: 0 };
      pushRoomCyl(
        b.darkIron,
        lXf,
        0.024,
        0.024,
        0.3,
        6,
        -0.34,
        vaultTopY - 0.22,
        0
      );
      pushRoomCyl(
        b.darkIron,
        lXf,
        0.024,
        0.024,
        0.3,
        6,
        0.34,
        vaultTopY - 0.22,
        0
      );
      pushRoomBox(b.darkIron, lXf, 0.96, 0.07, 0.48, 0, vaultTopY - 0.4, 0);
      pushRoomBox(
        lampGlowBucket,
        lXf,
        0.84,
        0.028,
        0.36,
        0,
        vaultTopY - 0.452,
        0
      );
    }

    // Exatamente 3 luzes dinâmicas por Sala Especial (7 x 3 = 21 annexLights!)
    const lightA = chosenLampWorlds[0] ?? new THREE.Vector3(roomCx, 0, roomCz);
    const lightB = chosenLampWorlds[3] ?? new THREE.Vector3(roomCx, 0, roomCz);
    annexLights.push(
      {
        position: new THREE.Vector3(lightA.x, 2.68, lightA.z),
        baseIntensity: 0.68,
        flicker: false,
        phase: rIdx * 1.3 + 0.4,
      },
      {
        position: new THREE.Vector3(lightB.x, 2.68, lightB.z),
        baseIntensity: 0.68,
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

    // 3. AS 4 PAREDES PERIMETRAIS (`annexWall`) + VERGA ESCALONADA SEM Z-FIGHTING + COLISORES SÓLIDOS
    const wallH = WALL_HEIGHT - 0.008;
    const wallMidY = WALL_HEIGHT * 0.5;
    const soffitTrimTopY = portalClearH + 0.08; // 2.66m (separa a verga superior de y=2.58m! Corrige image-21!)
    const cladLintelH = WALL_HEIGHT - 0.004 - soffitTrimTopY;
    const cladLintelMidY = soffitTrimTopY + cladLintelH * 0.5;

    // Parede Norte da Sala
    if (r.outwardDir === 'S') {
      const leftSpan = doorWorld.x - portalClearW * 0.5 - roomMinX;
      const rightSpan = roomMaxX - (doorWorld.x + portalClearW * 0.5);
      const zClad = roomMinZ + entryCladT * 0.5 + 0.004;
      if (leftSpan > 0.05) {
        const cx = roomMinX + leftSpan * 0.5;
        pushRoomBox(
          b.annexWall,
          worldXf,
          leftSpan,
          wallH,
          entryCladT,
          cx,
          wallMidY,
          zClad
        );
        addSolidCollider(
          colliders,
          `room-arch-${r.id}-entryL`,
          cx,
          zClad,
          leftSpan,
          entryCladT,
          WALL_HEIGHT
        );
      }
      if (rightSpan > 0.05) {
        const cx = roomMaxX - rightSpan * 0.5;
        pushRoomBox(
          b.annexWall,
          worldXf,
          rightSpan,
          wallH,
          entryCladT,
          cx,
          wallMidY,
          zClad
        );
        addSolidCollider(
          colliders,
          `room-arch-${r.id}-entryR`,
          cx,
          zClad,
          rightSpan,
          entryCladT,
          WALL_HEIGHT
        );
      }
      pushRoomBox(
        b.annexWall,
        worldXf,
        portalClearW - 0.02,
        cladLintelH,
        entryCladT,
        doorWorld.x,
        cladLintelMidY,
        zClad
      );
    } else {
      const zOut = roomMinZ - outerWallT * 0.5;
      pushRoomBox(
        b.annexWall,
        worldXf,
        roomW + outerWallT * 2,
        wallH,
        outerWallT,
        roomCx,
        wallMidY,
        zOut
      );
      addSolidCollider(
        colliders,
        `room-arch-${r.id}-N`,
        roomCx,
        zOut,
        roomW + outerWallT * 2,
        outerWallT,
        WALL_HEIGHT
      );
    }

    // Parede Sul da Sala
    if (r.outwardDir === 'N') {
      const leftSpan = doorWorld.x - portalClearW * 0.5 - roomMinX;
      const rightSpan = roomMaxX - (doorWorld.x + portalClearW * 0.5);
      const zClad = roomMaxZ - entryCladT * 0.5 - 0.004;
      if (leftSpan > 0.05) {
        const cx = roomMinX + leftSpan * 0.5;
        pushRoomBox(
          b.annexWall,
          worldXf,
          leftSpan,
          wallH,
          entryCladT,
          cx,
          wallMidY,
          zClad
        );
        addSolidCollider(
          colliders,
          `room-arch-${r.id}-entryL`,
          cx,
          zClad,
          leftSpan,
          entryCladT,
          WALL_HEIGHT
        );
      }
      if (rightSpan > 0.05) {
        const cx = roomMaxX - rightSpan * 0.5;
        pushRoomBox(
          b.annexWall,
          worldXf,
          rightSpan,
          wallH,
          entryCladT,
          cx,
          wallMidY,
          zClad
        );
        addSolidCollider(
          colliders,
          `room-arch-${r.id}-entryR`,
          cx,
          zClad,
          rightSpan,
          entryCladT,
          WALL_HEIGHT
        );
      }
      pushRoomBox(
        b.annexWall,
        worldXf,
        portalClearW - 0.02,
        cladLintelH,
        entryCladT,
        doorWorld.x,
        cladLintelMidY,
        zClad
      );
    } else {
      const zOut = roomMaxZ + outerWallT * 0.5;
      pushRoomBox(
        b.annexWall,
        worldXf,
        roomW + outerWallT * 2,
        wallH,
        outerWallT,
        roomCx,
        wallMidY,
        zOut
      );
      addSolidCollider(
        colliders,
        `room-arch-${r.id}-S`,
        roomCx,
        zOut,
        roomW + outerWallT * 2,
        outerWallT,
        WALL_HEIGHT
      );
    }

    // Parede Oeste da Sala
    if (r.outwardDir === 'E') {
      const topSpan = doorWorld.z - portalClearW * 0.5 - roomMinZ;
      const botSpan = roomMaxZ - (doorWorld.z + portalClearW * 0.5);
      const xClad = roomMinX + entryCladT * 0.5 + 0.004;
      if (topSpan > 0.05) {
        const cz = roomMinZ + topSpan * 0.5;
        pushRoomBox(
          b.annexWall,
          worldXf,
          entryCladT,
          wallH,
          topSpan,
          xClad,
          wallMidY,
          cz
        );
        addSolidCollider(
          colliders,
          `room-arch-${r.id}-entryL`,
          xClad,
          cz,
          entryCladT,
          topSpan,
          WALL_HEIGHT
        );
      }
      if (botSpan > 0.05) {
        const cz = roomMaxZ - botSpan * 0.5;
        pushRoomBox(
          b.annexWall,
          worldXf,
          entryCladT,
          wallH,
          botSpan,
          xClad,
          wallMidY,
          cz
        );
        addSolidCollider(
          colliders,
          `room-arch-${r.id}-entryR`,
          xClad,
          cz,
          entryCladT,
          botSpan,
          WALL_HEIGHT
        );
      }
      pushRoomBox(
        b.annexWall,
        worldXf,
        entryCladT,
        cladLintelH,
        portalClearW - 0.02,
        xClad,
        cladLintelMidY,
        doorWorld.z
      );
    } else {
      const xOut = roomMinX - outerWallT * 0.5;
      pushRoomBox(
        b.annexWall,
        worldXf,
        outerWallT,
        wallH,
        roomD,
        xOut,
        wallMidY,
        roomCz
      );
      addSolidCollider(
        colliders,
        `room-arch-${r.id}-W`,
        xOut,
        roomCz,
        outerWallT,
        roomD,
        WALL_HEIGHT
      );
    }

    // Parede Leste da Sala
    if (r.outwardDir === 'W') {
      const topSpan = doorWorld.z - portalClearW * 0.5 - roomMinZ;
      const botSpan = roomMaxZ - (doorWorld.z + portalClearW * 0.5);
      const xClad = roomMaxX - entryCladT * 0.5 - 0.004;
      if (topSpan > 0.05) {
        const cz = roomMinZ + topSpan * 0.5;
        pushRoomBox(
          b.annexWall,
          worldXf,
          entryCladT,
          wallH,
          topSpan,
          xClad,
          wallMidY,
          cz
        );
        addSolidCollider(
          colliders,
          `room-arch-${r.id}-entryL`,
          xClad,
          cz,
          entryCladT,
          topSpan,
          WALL_HEIGHT
        );
      }
      if (botSpan > 0.05) {
        const cz = roomMaxZ - botSpan * 0.5;
        pushRoomBox(
          b.annexWall,
          worldXf,
          entryCladT,
          wallH,
          botSpan,
          xClad,
          wallMidY,
          cz
        );
        addSolidCollider(
          colliders,
          `room-arch-${r.id}-entryR`,
          xClad,
          cz,
          entryCladT,
          botSpan,
          WALL_HEIGHT
        );
      }
      pushRoomBox(
        b.annexWall,
        worldXf,
        entryCladT,
        cladLintelH,
        portalClearW - 0.02,
        xClad,
        cladLintelMidY,
        doorWorld.z
      );
    } else {
      const xOut = roomMaxX + outerWallT * 0.5;
      pushRoomBox(
        b.annexWall,
        worldXf,
        outerWallT,
        wallH,
        roomD,
        xOut,
        wallMidY,
        roomCz
      );
      addSolidCollider(
        colliders,
        `room-arch-${r.id}-E`,
        xOut,
        roomCz,
        outerWallT,
        roomD,
        WALL_HEIGHT
      );
    }

    // 4. PÓRTICO BLINDADO DE ESCLUSA NA CÉLULA PERIMETRAL (doorGx, doorGz) — ZERO Z-FIGHTING (corrige image-21!)
    const isNS = r.outwardDir === 'N' || r.outwardDir === 'S';
    const doorXf: LocalXf = {
      cx: doorWorld.x,
      cz: doorWorld.z,
      yaw: isNS ? 0 : Math.PI * 0.5,
    };
    const jambOffset = portalClearW * 0.5 + jambW * 0.5; // 1.29m
    for (const side of [-1, 1] as const) {
      pushRoomBox(
        b.metalTrim,
        doorXf,
        jambW,
        WALL_HEIGHT - 0.01,
        CELL_SIZE - 0.02,
        side * jambOffset,
        WALL_HEIGHT * 0.5,
        0
      );
      pushRoomBox(
        b.darkIron,
        doorXf,
        jambW + 0.04,
        0.22,
        CELL_SIZE - 0.01,
        side * jambOffset,
        0.115,
        0
      );
      pushRoomBox(
        b.darkIron,
        doorXf,
        jambW + 0.036,
        WALL_HEIGHT - 0.34,
        0.24,
        side * jambOffset,
        WALL_HEIGHT * 0.5,
        -1.22
      );
      pushRoomBox(
        b.darkIron,
        doorXf,
        jambW + 0.036,
        WALL_HEIGHT - 0.34,
        0.24,
        side * jambOffset,
        WALL_HEIGHT * 0.5,
        1.22
      );

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

    // Sanca inferior do pórtico (y = 2.58..2.66m) EXCLUSIVA em darkIron + Verga superior (y = 2.66..3.195m) em metalTrim!
    pushRoomBox(
      b.darkIron,
      doorXf,
      portalClearW - 0.008,
      0.08,
      CELL_SIZE - 0.04,
      0,
      portalClearH + 0.04,
      0
    );
    const upperLintelH = WALL_HEIGHT - 0.005 - soffitTrimTopY;
    pushRoomBox(
      b.metalTrim,
      doorXf,
      portalClearW - 0.004,
      upperLintelH,
      CELL_SIZE - 0.02,
      0,
      soffitTrimTopY + upperLintelH * 0.5,
      0
    );
    // Molduras metálicas 3D ressaltadas para as placas de ícone (corredor interno + face da Sala Especial)
    const corridorSign = r.outwardDir === 'N' || r.outwardDir === 'W' ? 1 : -1;
    const corridorPlaqueZ = corridorSign * 1.526;
    const annexPlaqueZ = -corridorSign * (1.5 + entryCladT + 0.03);
    pushRoomBox(
      b.darkIron,
      doorXf,
      1.38,
      0.42,
      0.044,
      0,
      portalClearH + 0.31,
      corridorPlaqueZ
    );
    pushRoomBox(
      b.darkIron,
      doorXf,
      1.38,
      0.42,
      0.044,
      0,
      portalClearH + 0.31,
      annexPlaqueZ
    );
    // Soleira metálica chanfrada no piso do pórtico
    pushRoomBox(b.darkIron, doorXf, portalClearW - 0.01, 0.024, 0.44, 0, 0.012, 0);

    // 5. MARCOS ARQUITETÔNICOS EXCLUSIVOS DE CADA SALA EXTERNA
    if (r.id === 'reactor_hall') {
      // NÚCLEO TOKAMAK DE FUSÃO / CONTENÇÃO MAGNÉTICA em (25, -3)
      const tokamakW = gridCellToWorld(25, -3);
      const tokamakXf: LocalXf = { cx: tokamakW.x, cz: tokamakW.z, yaw: 0 };
      pushRoomCyl(b.darkIron, tokamakXf, 1.22, 1.32, 0.24, 16, 0, 0.12, 0);
      pushRoomCyl(b.metalTrim, tokamakXf, 1.02, 1.12, 0.22, 16, 0, 0.34, 0);
      pushRoomCyl(b.bioFluid, tokamakXf, 0.64, 0.64, 2.26, 16, 0, 1.56, 0);
      pushRoomCyl(b.crtScreen, tokamakXf, 0.7, 0.7, 0.24, 16, 0, 1.56, 0);
      for (const ringY of [0.72, 1.26, 1.88, 2.42]) {
        pushRoomCyl(b.darkIron, tokamakXf, 0.88, 0.88, 0.14, 16, 0, ringY, 0);
      }
      for (let c = 0; c < 6; c++) {
        const ang = (c * Math.PI) / 3;
        const bx = Math.cos(ang) * 0.94;
        const bz = Math.sin(ang) * 0.94;
        pushRoomBox(
          b.metalTrim,
          tokamakXf,
          0.17,
          2.5,
          0.26,
          bx,
          1.54,
          bz,
          0,
          -ang,
          0
        );
      }
      pushRoomCyl(b.darkIron, tokamakXf, 1.1, 0.92, 0.42, 16, 0, 2.97, 0);
      addSolidCollider(
        colliders,
        'room-arch-reactor-tokamak',
        tokamakW.x,
        tokamakW.z,
        2.28,
        2.28,
        WALL_HEIGHT
      );
    } else if (r.id === 'computer_room') {
      // Calhas aéreas de cabos na espinha central aberta (gx = 11, gz = -6..-2)
      const spineW = gridCellToWorld(11, -3);
      const spineXf: LocalXf = { cx: spineW.x, cz: spineW.z, yaw: 0 };
      pushRoomBox(b.darkIron, spineXf, 0.42, 0.08, 11.4, 0, 2.66, -1.5);
    } else if (r.id === 'library_room') {
      // Lustre clássico suspenso no Salão de Leitura aberto em (31, 20)
      const salonW = gridCellToWorld(31, 20);
      const salonXf: LocalXf = { cx: salonW.x, cz: salonW.z, yaw: 0 };
      pushRoomCyl(
        b.darkIron,
        salonXf,
        0.04,
        0.04,
        0.58,
        8,
        0,
        vaultTopY - 0.3,
        0
      );
      pushRoomCyl(
        b.weatheredWood,
        salonXf,
        0.58,
        0.52,
        0.1,
        12,
        0,
        vaultTopY - 0.62,
        0
      );
      for (const [lx, lz] of [
        [-0.48, 0],
        [0.48, 0],
        [0, -0.48],
        [0, 0.48],
      ] as const) {
        pushRoomCyl(
          b.warmLampGlow,
          salonXf,
          0.09,
          0.13,
          0.16,
          8,
          lx,
          vaultTopY - 0.54,
          lz
        );
      }
    } else if (r.id === 'vegetation_room') {
      // Tubulação de névoa e folhagem pendente na Estufa Central aberta em (6, 31)
      const groveW = gridCellToWorld(6, 31);
      const groveXf: LocalXf = { cx: groveW.x, cz: groveW.z, yaw: 0 };
      pushRoomCyl(
        b.metalTrim,
        groveXf,
        0.045,
        0.045,
        2.3,
        8,
        0,
        2.74,
        0,
        0,
        0,
        Math.PI * 0.5
      );
      pushRoomBox(b.foliage, groveXf, 0.38, 0.5, 0.26, -0.6, 2.52, 0, 0, 0.3, 0.08);
      pushRoomBox(b.foliage, groveXf, 0.36, 0.48, 0.24, 0.6, 2.54, 0, 0, -0.25, -0.06);
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
      // Banco duplo Mainframe 42U com frente escalonada em Z (ZERO sobreposição entre gabinete, painel e visor CRT!)
      for (const ox of [-0.39, 0.39]) {
        pushRoomBox(b.darkIron, xf, 0.74, 0.1, 0.68, ox, 0.05, 0);
        pushRoomBox(b.metalTrim, xf, 0.72, 2.1, 0.6, ox, 1.15, -0.02);
        pushRoomBox(b.serverRack, xf, 0.66, 2.02, 0.032, ox, 1.15, 0.298);
        // Pilastras laterais frisadas do gabinete
        pushRoomBox(b.darkIron, xf, 0.048, 2.08, 0.63, ox - 0.35, 1.15, -0.005);
        pushRoomBox(b.darkIron, xf, 0.048, 2.08, 0.63, ox + 0.35, 1.15, -0.005);
        // Topo blindado + turbina de exaustão superior
        pushRoomBox(b.metalTrim, xf, 0.76, 0.07, 0.68, ox, 2.23, 0);
        pushRoomCyl(b.darkIron, xf, 0.19, 0.21, 0.09, 10, ox, 2.31, -0.04);
        // Bobinas duplas de fita magnética + visor de diagnóstico CRT ressaltado
        pushRoomCyl(b.metalTrim, xf, 0.11, 0.11, 0.028, 12, ox - 0.14, 1.76, 0.332, Math.PI * 0.5, 0, 0);
        pushRoomCyl(b.metalTrim, xf, 0.11, 0.11, 0.028, 12, ox + 0.14, 1.76, 0.332, Math.PI * 0.5, 0, 0);
        pushRoomBox(b.computerScreen, xf, 0.42, 0.12, 0.016, ox, 1.44, 0.324);
      }
      // Eletrodutos gêmeos subindo para o teto técnico
      pushRoomCyl(b.darkIron, xf, 0.05, 0.05, 0.72, 8, -0.24, 2.66, -0.18);
      pushRoomCyl(b.darkIron, xf, 0.05, 0.05, 0.72, 8, 0.24, 2.66, -0.18);
      break;
    }

    case 'crt_workstation_desk': {
      // Console de comando técnico com 2 monitores CRT (bezel escuro + vidro fosforescente + tubo traseiro), teclados e cadeira 5 pontas!
      pushRoomBox(b.metalTrim, xf, 1.52, 0.06, 0.72, 0, 0.75, -0.08);
      pushRoomBox(b.darkIron, xf, 1.54, 0.036, 0.03, 0, 0.745, 0.285);
      pushRoomBox(b.darkIron, xf, 0.075, 0.72, 0.68, -0.7, 0.36, -0.08);
      pushRoomBox(b.darkIron, xf, 0.075, 0.72, 0.68, 0.7, 0.36, -0.08);
      pushRoomBox(b.darkIron, xf, 1.34, 0.52, 0.035, 0, 0.44, -0.41);
      // Gabinete torre workstation + estabilizador sob a bancada
      pushRoomBox(b.serverRack, xf, 0.24, 0.52, 0.48, 0.48, 0.26, -0.12);
      pushRoomBox(b.darkIron, xf, 0.22, 0.22, 0.34, -0.48, 0.11, -0.16);

      for (const [mx, yawTilt] of [
        [-0.36, 0.14],
        [0.28, -0.14],
      ] as const) {
        const pivZ = -0.14;
        const s = Math.sin(yawTilt);
        const c = Math.cos(yawTilt);
        // Pedestal giratório + carcaça principal + tubo catódico traseiro + moldura + vidro CRT verde brilhante!
        pushRoomCyl(b.darkIron, xf, 0.105, 0.13, 0.06, 8, mx, 0.81, pivZ);
        pushRoomBox(b.metalTrim, xf, 0.45, 0.38, 0.24, mx, 1.03, pivZ, 0, yawTilt, 0);
        pushRoomBox(b.darkIron, xf, 0.24, 0.22, 0.14, mx - s * 0.18, 1.01, pivZ - c * 0.18, 0, yawTilt, 0);
        pushRoomBox(b.darkIron, xf, 0.46, 0.39, 0.022, mx + s * 0.128, 1.03, pivZ + c * 0.128, 0, yawTilt, 0);
        pushRoomBox(b.computerScreen, xf, 0.38, 0.29, 0.016, mx + s * 0.143, 1.035, pivZ + c * 0.143, 0, yawTilt, 0);
        // Teclado mecânico esculpido apoiado na superfície da mesa
        const kx = mx + s * 0.28;
        const kz = pivZ + c * 0.28;
        pushRoomBox(b.darkIron, xf, 0.38, 0.028, 0.15, kx, 0.795, kz, 0.08, yawTilt * 0.5, 0);
        // Teclas separadas sobre o corpo escuro, com a mesma orientação do teclado.
        const keyYaw = yawTilt * 0.5;
        for (let row = 0; row < 3; row++) {
          for (let col = 0; col < 9; col++) {
            const dx = (col - 4) * 0.036;
            const dz = (row - 1) * 0.032;
            pushRoomBox(b.cleanLinen, xf, 0.027, 0.009, 0.023,
              kx + Math.cos(keyYaw) * dx + Math.sin(keyYaw) * dz,
              0.816 - dz * Math.sin(0.08),
              kz - Math.sin(keyYaw) * dx + Math.cos(keyYaw) * dz,
              0.08, keyYaw, 0);
          }
        }
      }
      // Luminária presa à bancada: base, haste, cúpula e difusor separado.
      pushRoomCyl(b.darkIron, xf, 0.055, 0.065, 0.025, 10, -0.66, 0.7925, -0.31);
      pushRoomCyl(b.metalTrim, xf, 0.012, 0.012, 0.31, 8, -0.66, 0.96, -0.31);
      pushRoomBox(b.darkIron, xf, 0.17, 0.055, 0.09, -0.66, 1.13, -0.31);
      pushRoomBox(b.warmLampGlow, xf, 0.14, 0.008, 0.07, -0.66, 1.099, -0.31);

      // Cadeira giratória ergonômica com estrela de 5 pés contida dentro da caixa de colisão
      const chairX = -0.04;
      const chairZ = 0.23;
      for (let leg = 0; leg < 5; leg++) {
        const a = (leg * Math.PI * 2) / 5;
        pushRoomBox(
          b.darkIron,
          xf,
          0.042,
          0.034,
          0.24,
          chairX + Math.sin(a) * 0.11,
          0.04,
          chairZ + Math.cos(a) * 0.11,
          0,
          a,
          0
        );
      }
      pushRoomCyl(b.darkIron, xf, 0.036, 0.044, 0.38, 8, chairX, 0.23, chairZ);
      pushRoomBox(b.bunkFabric, xf, 0.44, 0.068, 0.4, chairX, 0.44, chairZ);
      pushRoomBox(b.bunkFabric, xf, 0.42, 0.42, 0.065, chairX, 0.69, chairZ + 0.18, -0.1, 0, 0);
      pushRoomBox(b.darkIron, xf, 0.038, 0.2, 0.26, chairX - 0.23, 0.55, chairZ + 0.02);
      pushRoomBox(b.darkIron, xf, 0.038, 0.2, 0.26, chairX + 0.23, 0.55, chairZ + 0.02);
      break;
    }

    case 'bio_specimen_tank': {
      // Câmara cilíndrica de contenção xenobiológica com pedestal de válvulas, bio-fluido, espécime aracnídeo suspenso e duto superior
      pushRoomCyl(b.darkIron, xf, 0.48, 0.52, 0.22, 14, 0, 0.11, 0);
      pushRoomCyl(b.metalTrim, xf, 0.45, 0.47, 0.12, 14, 0, 0.28, 0);
      // Painel frontal de telemetria na base do tanque
      pushRoomBox(b.computerScreen, xf, 0.26, 0.11, 0.04, 0, 0.18, 0.48, -0.2, 0, 0);
      // Coluna de vidro com espécime visível através do fluido
      pushRoomCyl(b.specimenGlass, xf, 0.38, 0.38, 1.66, 14, 0, 1.17, 0);
      // Corpo e oito patas visíveis, inteiramente dentro do vidro.
      pushRoomSphere(b.darkIron, xf, 0.115, 0, 1.16, -0.10);
      pushRoomSphere(b.darkIron, xf, 0.075, 0, 1.16, 0.075);
      for (const side of [-1, 1]) {
        for (const z of [-0.12, -0.05, 0.04, 0.11]) {
          const spread = z * 0.35;
          pushRoomRod(b.darkIron, xf, 0.012,
            new THREE.Vector3(side * 0.055, 1.16, z),
            new THREE.Vector3(side * 0.19, 1.20, z + spread));
          pushRoomRod(b.darkIron, xf, 0.01,
            new THREE.Vector3(side * 0.19, 1.20, z + spread),
            new THREE.Vector3(side * 0.29, 1.05, z + spread * 2));
        }
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
        pushRoomCyl(b.bioFluid, xf, 0.022, 0.022, 0.2, 8, tx, 1.04, 0.02);
        pushRoomCyl(b.metalTrim, xf, 0.024, 0.024, 0.014, 8, tx, 1.147, 0.02);
      }
      pushRoomBox(b.cleanLinen, xf, 0.34, 0.25, 0.32, 0.56, 1.02, -0.02);
      pushRoomBox(b.computerScreen, xf, 0.18, 0.1, 0.025, 0.56, 1.05, 0.145);
      break;
    }

    case 'cryo_biohazard_cabinet': {
      // Câmara dupla criogênica de risco biológico + cilindro externo de Nitrogênio Líquido
      pushRoomBox(b.darkIron, xf, 1.22, 0.1, 0.66, -0.08, 0.05, 0);
      pushRoomBox(b.metalTrim, xf, 1.18, 1.98, 0.62, -0.08, 1.09, 0);
      pushRoomBox(b.darkIron, xf, 1.12, 1.78, 0.04, -0.08, 1.06, 0.31);
      pushRoomBox(b.computerScreen, xf, 0.52, 0.11, 0.03, -0.08, 1.98, 0.315);
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
      // Ranhuras reais nas portas dos armários, sem prolongar o banco.
      for (const lx of [-0.47, 0, 0.47]) for (const y of [1.79, 1.77, 0.41, 0.39]) {
        pushRoomBox(b.darkIron, xf, 0.18, 0.007, 0.006, lx, y, 0.243);
      }
      break;
    }

    case 'crew_mess_table': {
      // Mesa de refeitório da tripulação com tampo limpo apoiado sobre saia inferior (ZERO Z-fighting!), bancos duplos e utensílios
      pushRoomBox(b.oakWood, xf, 1.56, 0.06, 0.64, 0, 0.775, 0);
      pushRoomBox(b.weatheredWood, xf, 1.46, 0.045, 0.56, 0, 0.722, 0);
      pushRoomBox(b.darkIron, xf, 0.1, 0.7, 0.5, -0.62, 0.35, 0);
      pushRoomBox(b.darkIron, xf, 0.1, 0.7, 0.5, 0.62, 0.35, 0);
      for (const bz of [-0.4, 0.4]) {
        pushRoomBox(b.weatheredWood, xf, 1.44, 0.055, 0.22, 0, 0.44, bz);
        pushRoomBox(b.darkIron, xf, 0.065, 0.42, 0.18, -0.54, 0.21, bz);
        pushRoomBox(b.darkIron, xf, 0.065, 0.42, 0.18, 0.54, 0.21, bz);
      }
      // Bandejas inox, jarra e canecas sobre a mesa (topo exato em 0.805)
      pushRoomBox(b.metalTrim, xf, 0.36, 0.022, 0.24, -0.36, 0.817, 0.12);
      pushRoomBox(b.metalTrim, xf, 0.36, 0.022, 0.24, 0.34, 0.817, -0.12);
      pushRoomCyl(b.metalTrim, xf, 0.045, 0.045, 0.11, 8, -0.12, 0.86, 0.1);
      pushRoomCyl(b.darkIron, xf, 0.065, 0.075, 0.2, 8, 0.04, 0.905, -0.02);
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
      // Base sobre o tampo; haste encontra a cúpula aberta, com luz somente por baixo.
      pushRoomCyl(b.darkIron, xf, 0.085, 0.105, 0.04, 12, 0.42, 0.8125, -0.08);
      pushRoomCyl(b.metalTrim, xf, 0.018, 0.018, 0.29, 10, 0.42, 0.9775, -0.08);
      pushRoomLampShell(b.lampShade, xf, 0.10, 0.17, 0.18, 0.42, 1.16, -0.08);
      pushRoomCyl(b.warmLampGlow, xf, 0.135, 0.135, 0.012, 16, 0.42, 1.077, -0.08);
      // Cadeira encaixada na escrivaninha
      pushRoomBox(b.weatheredWood, xf, 0.42, 0.05, 0.38, -0.18, 0.44, 0.24);
      pushRoomBox(b.weatheredWood, xf, 0.42, 0.42, 0.05, -0.18, 0.66, 0.41);
      for (const x of [-0.34, -0.02]) for (const z of [0.09, 0.35]) {
        pushRoomBox(b.weatheredWood, xf, 0.04, 0.415, 0.04, x, 0.2075, z);
      }
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
      // Prancheta clínica presa à peseira, com linhas de registro.
      for (const y of [0.82, 0.87, 0.92]) {
        pushRoomBox(b.darkIron, xf, 0.004, 0.008, 0.19, 0.887, y, 0);
      }
      for (const rz of [-0.4, 0.4]) {
        pushRoomBox(b.metalTrim, xf, 1.06, 0.035, 0.035, -0.06, 0.98, rz);
        pushRoomBox(b.metalTrim, xf, 0.03, 0.24, 0.03, -0.52, 0.85, rz);
        pushRoomBox(b.metalTrim, xf, 0.03, 0.24, 0.03, 0.4, 0.85, rz);
      }
      pushRoomBox(b.cleanLinen, xf, 1.62, 0.12, 0.7, 0, 0.78, 0);
      pushRoomBox(b.medicalCross, xf, 0.92, 0.02, 0.714, 0.24, 0.85, 0);
      pushRoomBox(b.cleanLinen, xf, 0.32, 0.085, 0.52, -0.58, 0.885, 0, 0, 0, -0.12);
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
      pushRoomBox(b.computerScreen, xf, 0.44, 0.32, 0.025, -0.18, 1.18, 0.165, 0, 0.12, 0);
      pushRoomBox(b.cleanLinen, xf, 0.34, 0.16, 0.28, 0.28, 0.98, 0.02);
      pushRoomBox(b.darkIron, xf, 0.1, 0.06, 0.14, 0.22, 1.08, 0.04);
      pushRoomBox(b.darkIron, xf, 0.1, 0.06, 0.14, 0.35, 1.08, 0.04);
      break;
    }

    case 'hydroponic_tree_planter': {
      // Canteiro monumental de pedra com borda vazada de madeira + substrato interno limpo (ZERO sobreposição!) + Árvore ramificada
      pushRoomBox(b.stone, xf, 1.44, 0.48, 0.84, 0, 0.24, 0);
      pushRoomBox(b.weatheredWood, xf, 1.5, 0.06, 0.09, 0, 0.51, 0.405);
      pushRoomBox(b.weatheredWood, xf, 1.5, 0.06, 0.09, 0, 0.51, -0.405);
      pushRoomBox(b.weatheredWood, xf, 0.09, 0.06, 0.72, -0.705, 0.51, 0);
      pushRoomBox(b.weatheredWood, xf, 0.09, 0.06, 0.72, 0.705, 0.51, 0);
      pushRoomBox(b.mossSoil, xf, 1.32, 0.04, 0.72, 0, 0.5, 0);

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
      // Canteiro hidropônico com colar perimetral de ferro + substrato elevado limpo + samambaias e coifa Grow-Light
      pushRoomBox(b.weatheredWood, xf, 1.5, 0.42, 0.76, 0, 0.21, 0);
      pushRoomBox(b.darkIron, xf, 1.54, 0.05, 0.06, 0, 0.445, 0.37);
      pushRoomBox(b.darkIron, xf, 1.54, 0.05, 0.06, 0, 0.445, -0.37);
      pushRoomBox(b.darkIron, xf, 0.06, 0.05, 0.68, -0.74, 0.445, 0);
      pushRoomBox(b.darkIron, xf, 0.06, 0.05, 0.68, 0.74, 0.445, 0);
      pushRoomBox(b.mossSoil, xf, 1.42, 0.04, 0.68, 0, 0.44, 0);

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
      pushRoomBox(b.computerScreen, xf, 0.22, 0.14, 0.03, 0.32, 1.24, 0.25);
      // O visor fica desobstruído; a antiga folhagem atravessava o painel.
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
      // Trilho metálico superior + escada inclinada de biblioteca com degraus 100% alinhados às longarinas!
      pushRoomCyl(b.metalTrim, xf, 0.018, 0.018, w - 0.04, 6, 0, 2.08, 0.31, 0, 0, Math.PI * 0.5);
      pushRoomBox(b.weatheredWood, xf, 0.038, 2.08, 0.045, 0.32, 1.04, 0.34, -0.1, 0, 0);
      pushRoomBox(b.weatheredWood, xf, 0.038, 2.08, 0.045, 0.62, 1.04, 0.34, -0.1, 0, 0);
      for (let step = 0; step < 6; step++) {
        const ly = 0.28 + step * 0.3;
        const lz = 0.34 + (1.04 - ly) * Math.tan(0.1);
        pushRoomBox(b.weatheredWood, xf, 0.28, 0.028, 0.046, 0.47, ly, lz);
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
      pushRoomBox(b.cleanLinen, xf, 0.36, 0.04, 0.26, -0.34, 0.83, 0.27, 0, 0.12, 0);
      pushRoomBox(b.bookshelf, xf, 0.28, 0.14, 0.22, 0.48, 0.88, -0.31, 0, -0.18, 0);
      for (const lx of [-0.36, 0.36]) {
        pushRoomCyl(b.metalTrim, xf, 0.085, 0.105, 0.04, 12, lx, 0.83, 0);
        pushRoomCyl(b.metalTrim, xf, 0.018, 0.018, 0.25, 10, lx, 0.975, 0);
        // Semicilindro verde aberto para baixo, em vez de dois blocos sobrepostos.
        pushRoomLampShell(b.bankerShade, xf, 0.095, 0.095, 0.26, lx, 1.10, 0, Math.PI * 0.5, Math.PI);
        pushRoomBox(b.warmLampGlow, xf, 0.22, 0.008, 0.15, lx, 1.104, 0);
      }

      // 4 cadeiras clássicas de carvalho (2 de cada lado)
      for (const czSign of [-1, 1]) {
        for (const cxOff of [-0.36, 0.36]) {
          pushRoomBox(b.weatheredWood, xf, 0.42, 0.05, 0.38, cxOff, 0.45, czSign * 0.42);
          pushRoomBox(b.weatheredWood, xf, 0.42, 0.5, 0.05, cxOff, 0.7, czSign * 0.58);
          for (const legX of [-0.17, 0.17]) for (const legZ of [0.28, 0.56]) {
            pushRoomBox(b.weatheredWood, xf, 0.05, 0.425, 0.05, cxOff + legX, 0.2125, czSign * legZ);
          }
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
      pushRoomCyl(b.metalTrim, xf, 0.018, 0.018, 0.06, 8, 0.38, 1.73, 0);
      pushRoomSphere(b.foliage, xf, 0.14, 0.38, 1.90, 0);
      break;
    }

    case 'reactor_capacitor_console': {
      // Banco de capacitores de alta tensão com aletas radiadoras, console inclinado e 3 buchas isoladoras cerâmicas!
      pushRoomBox(b.darkIron, xf, 1.54, 0.94, 0.74, 0, 0.47, 0);
      // Aletas verticais de resfriamento frontal/lateral
      for (const fx of [-0.62, -0.36, -0.1, 0.16, 0.42, 0.64]) {
        pushRoomBox(b.metalTrim, xf, 0.04, 0.72, 0.78, fx, 0.46, 0);
      }
      pushRoomBox(b.serverRack, xf, 1.46, 0.38, 0.4, 0, 1.1, 0.12, -0.38, 0, 0);
      pushRoomBox(b.computerScreen, xf, 0.48, 0.24, 0.018, -0.36, 1.178, 0.314, -0.38, 0, 0);
      pushRoomBox(b.computerScreen, xf, 0.36, 0.18, 0.018, 0.34, 1.178, 0.314, -0.38, 0, 0);
      // Sinalizadores de estado na face frontal da base do reator.
      for (const x of [-0.18, 0, 0.29]) {
        pushRoomBox(b.warmLampGlow, xf, 0.055, 0.035, 0.012, x, 0.72, 0.377);
      }
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

function getVestibuleMiniMapMount(r: ThemedRoomDefinition): {
  x: number;
  z: number;
  yaw: number;
  doorSide: 'N' | 'S' | 'W' | 'E';
} {
  switch (r.id) {
    case 'computer_room': {
      const c = gridCellToWorld(11, -1);
      return { x: c.x - 1.465, z: c.z, yaw: Math.PI * 0.5, doorSide: 'S' };
    }
    case 'reactor_hall': {
      const c = gridCellToWorld(26, -1);
      return { x: c.x, z: c.z + 1.29, yaw: Math.PI, doorSide: 'S' };
    }
    case 'biology_lab': {
      const c = gridCellToWorld(-1, 4);
      return { x: c.x + 1.29, z: c.z, yaw: -Math.PI * 0.5, doorSide: 'E' };
    }
    case 'crew_quarters': {
      const c = gridCellToWorld(-1, 11);
      return { x: c.x, z: c.z + 1.465, yaw: Math.PI, doorSide: 'E' };
    }
    case 'medical_ward': {
      const c = gridCellToWorld(29, 12);
      return { x: c.x, z: c.z - 1.465, yaw: 0, doorSide: 'W' };
    }
    case 'library_room': {
      const c = gridCellToWorld(29, 19);
      return { x: c.x - 1.29, z: c.z, yaw: Math.PI * 0.5, doorSide: 'W' };
    }
    case 'vegetation_room': {
      const c = gridCellToWorld(6, 29);
      return { x: c.x - 1.465, z: c.z, yaw: Math.PI * 0.5, doorSide: 'N' };
    }
  }
}

function createWhitePixelTexture(): THREE.DataTexture {
  const data = new Uint8Array([255, 255, 255, 255]);
  const tex = new THREE.DataTexture(data, 1, 1, THREE.RGBAFormat);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
}

function buildSpecialRoomDoorsAndPlaques(
  parentGroup: THREE.Group,
  mats: RoomMaterials,
  sharedUniforms: DoomSharedUniforms,
  colliders: StaticColliderBox[]
): DoomSpecialRoomDoorController {
  resetThemedRoomLocks();

  const portalClearW = 2.16;
  const portalClearH = 2.58;
  const entryCladT = 0.18;

  const disposableGeometries: THREE.BufferGeometry[] = [];
  const disposableMaterials: THREE.Material[] = [];
  const disposableTextures: THREE.Texture[] = [];

  const whiteTex = createWhitePixelTexture();
  disposableTextures.push(whiteTex);

  const plaquePlaneGeo = new THREE.PlaneGeometry(1.3, 0.36);
  const miniMapPlaneGeo = new THREE.PlaneGeometry(0.76, 0.76);
  const miniMapFrameGeo = new THREE.BoxGeometry(0.86, 0.86, 0.048);
  const leafMainGeo = new THREE.BoxGeometry(1.075, portalClearH - 0.03, 0.22);
  const leafInsetGeo = new THREE.BoxGeometry(0.84, 1.96, 0.25);
  const leafBarGeo = new THREE.BoxGeometry(1.06, 0.16, 0.27);
  const leafLedGeo = new THREE.BoxGeometry(0.22, 0.08, 0.285);
  disposableGeometries.push(
    plaquePlaneGeo,
    miniMapPlaneGeo,
    miniMapFrameGeo,
    leafMainGeo,
    leafInsetGeo,
    leafBarGeo,
    leafLedGeo
  );

  const doors: SpecialRoomDoorInstance[] = [];

  for (const r of THEMED_ROOMS) {
    const doorWorld = gridCellToWorld(r.doorGx, r.doorGz);
    const isNS = r.outwardDir === 'N' || r.outwardDir === 'S';
    const doorYaw = isNS ? 0 : Math.PI * 0.5;
    const corridorSign = r.outwardDir === 'N' || r.outwardDir === 'W' ? 1 : -1;

    // 1. PLACAS LUMINOSAS DE ÍCONE + CÓDIGO SETORIAL (NOS DOIS LADOS DO PÓRTICO — CORRIGE image-21!)
    const iconTex = createSpecialRoomDoorIconTexture(
      r.id,
      r.doorCode,
      r.accentHex
    );
    disposableTextures.push(iconTex);
    const iconMat = createDoomSurfaceMaterial(iconTex, sharedUniforms, {
      useLocalUv: true,
      fullBright: true,
      baseLight: 0.95,
    });
    disposableMaterials.push(iconMat);

    const doorGroup = new THREE.Group();
    doorGroup.name = `MazeRoomPortal_${r.id}`;
    doorGroup.position.set(doorWorld.x, 0, doorWorld.z);
    doorGroup.rotation.y = doorYaw;
    parentGroup.add(doorGroup);

    const corridorPlaque = new THREE.Mesh(plaquePlaneGeo, iconMat);
    corridorPlaque.name = `MazeRoomDoorPlaque_${r.id}_corridor`;
    corridorPlaque.position.set(
      0,
      portalClearH + 0.31,
      corridorSign * (1.526 + 0.026)
    );
    corridorPlaque.rotation.y = corridorSign > 0 ? 0 : Math.PI;
    doorGroup.add(corridorPlaque);

    const annexPlaque = new THREE.Mesh(plaquePlaneGeo, iconMat);
    annexPlaque.name = `MazeRoomDoorPlaque_${r.id}_annex`;
    annexPlaque.position.set(
      0,
      portalClearH + 0.31,
      -corridorSign * (1.5 + entryCladT + 0.03 + 0.026)
    );
    annexPlaque.rotation.y = -corridorSign > 0 ? 0 : Math.PI;
    doorGroup.add(annexPlaque);

    // 2. TERMINAL MURAL DE MINI-MAPA INTERNO 7x7 NO VESTÍBULO DA SALA ESPECIAL
    const miniTex = createSpecialRoomMiniMapTexture(
      r.miniMap,
      getVestibuleMiniMapMount(r).doorSide,
      r.accentHex
    );
    disposableTextures.push(miniTex);
    const miniMat = createDoomSurfaceMaterial(miniTex, sharedUniforms, {
      useLocalUv: true,
      fullBright: true,
      baseLight: 0.94,
    });
    disposableMaterials.push(miniMat);

    const mount = getVestibuleMiniMapMount(r);
    const miniGroup = new THREE.Group();
    miniGroup.name = `MazeRoomMiniMap_${r.id}`;
    miniGroup.position.set(mount.x, 1.54, mount.z);
    miniGroup.rotation.y = mount.yaw;

    const frameMesh = new THREE.Mesh(miniMapFrameGeo, mats.darkIron);
    miniGroup.add(frameMesh);
    const screenMesh = new THREE.Mesh(miniMapPlaneGeo, miniMat);
    screenMesh.position.z = 0.028;
    miniGroup.add(screenMesh);
    parentGroup.add(miniGroup);

    // 3. PORTA BLINDADA DUPLA DE CONTENÇÃO (COMEÇA FECHADA E TRANCADA!)
    const ledMat = createDoomPropMaterial(whiteTex, sharedUniforms, {
      baseLight: 0.95,
      emissiveBoost: 0.65,
      tint: new THREE.Color(0xff3344),
    });
    disposableMaterials.push(ledMat);

    const buildDoorLeaf = (side: -1 | 1): THREE.Group => {
      const leaf = new THREE.Group();
      leaf.position.set(side * 0.54, portalClearH * 0.5, 0);

      const mainPanel = new THREE.Mesh(leafMainGeo, mats.metalTrim);
      leaf.add(mainPanel);

      const armorInset = new THREE.Mesh(leafInsetGeo, mats.darkIron);
      leaf.add(armorInset);

      const lockBar = new THREE.Mesh(leafBarGeo, mats.darkIron);
      lockBar.position.y = -0.06;
      leaf.add(lockBar);

      const ledIndicator = new THREE.Mesh(leafLedGeo, ledMat);
      ledIndicator.position.set(-side * 0.3, 0.14, 0);
      leaf.add(ledIndicator);

      return leaf;
    };

    const leftLeaf = buildDoorLeaf(-1);
    const rightLeaf = buildDoorLeaf(1);
    leftLeaf.name = `MazeRoomBlastDoor_${r.id}_L`;
    rightLeaf.name = `MazeRoomBlastDoor_${r.id}_R`;
    doorGroup.add(leftLeaf);
    doorGroup.add(rightLeaf);

    const sx = isNS ? portalClearW + 0.08 : 0.44;
    const sz = isNS ? 0.44 : portalClearW + 0.08;
    const lockCollider: StaticColliderBox = {
      id: `room-door-lock-${r.id}`,
      box: new THREE.Box3(
        new THREE.Vector3(doorWorld.x - sx * 0.5, 0, doorWorld.z - sz * 0.5),
        new THREE.Vector3(
          doorWorld.x + sx * 0.5,
          WALL_HEIGHT,
          doorWorld.z + sz * 0.5
        )
      ),
    };
    colliders.push(lockCollider);

    doors.push({
      room: r,
      keyItemId: r.keyItemId,
      keyName: r.keyName,
      doorWorldPos: new THREE.Vector3(doorWorld.x, 0, doorWorld.z),
      unlocked: false,
      openProgress: 0,
      collider: lockCollider,
      leftLeaf,
      rightLeaf,
      ledMaterials: [ledMat],
    });
  }

  const controller: DoomSpecialRoomDoorController = {
    doors,
    isUnlocked(roomId: DoomRoomId): boolean {
      return doors.some((d) => d.room.id === roomId && d.unlocked);
    },
    unlockRoom(roomId: DoomRoomId): boolean {
      const inst = doors.find((d) => d.room.id === roomId);
      if (!inst || inst.unlocked) return false;
      inst.unlocked = true;
      unlockThemedRoom(roomId);
      // Desativa imediatamente o colisor físico para travessia livre
      inst.collider.box.min.set(0, 60, 0);
      inst.collider.box.max.set(0, 60.05, 0);
      for (const m of inst.ledMaterials) {
        m.uniforms.uTint.value.setHex(0x32f08c);
      }
      return true;
    },
    findNearbyLockedDoor(
      playerPos: THREE.Vector3,
      maxDistance = 2.85
    ): SpecialRoomDoorInstance | null {
      let best: SpecialRoomDoorInstance | null = null;
      let bestDist = maxDistance;
      for (const d of doors) {
        if (d.unlocked) continue;
        const dist = Math.hypot(
          playerPos.x - d.doorWorldPos.x,
          playerPos.z - d.doorWorldPos.z
        );
        if (dist <= bestDist) {
          bestDist = dist;
          best = d;
        }
      }
      return best;
    },
    findMatchingDoorForKey(
      keyItemId: string,
      playerPos: THREE.Vector3,
      maxDistance = 3.1
    ): SpecialRoomDoorInstance | null {
      for (const d of doors) {
        if (d.unlocked || d.keyItemId !== keyItemId) continue;
        const dist = Math.hypot(
          playerPos.x - d.doorWorldPos.x,
          playerPos.z - d.doorWorldPos.z
        );
        if (dist <= maxDistance) return d;
      }
      return null;
    },
    update(dt: number): void {
      const step = Math.min(1, Math.max(0, dt) * 1.85);
      for (const d of doors) {
        if (!d.unlocked || d.openProgress >= 1) continue;
        d.openProgress = Math.min(1, d.openProgress + step);
        const eased = 1 - Math.pow(1 - d.openProgress, 3);
        const slideOffset = 0.54 + eased * 1.02;
        d.leftLeaf.position.x = -slideOffset;
        d.rightLeaf.position.x = slideOffset;
      }
    },
    dispose(): void {
      for (const g of disposableGeometries) g.dispose();
      for (const m of disposableMaterials) m.dispose();
      for (const t of disposableTextures) t.dispose();
    },
  };

  return controller;
}

/**
 * Constrói todas as 7 Salas Especiais Externas 3D 7x7 (mini-mapas internos desconectados,
 * placas de ícone sem Z-fighting, portas blindadas trancadas por chaves específicas e mobiliário 3D).
 */
export function buildDoomThemedRooms(
  parentGroup: THREE.Group,
  placements: ReadonlyArray<RoomFurniturePlacement>,
  textures: DoomTextureSet,
  sharedUniforms: DoomSharedUniforms,
  colliders: StaticColliderBox[]
): {
  annexLights: DoomAnnexLightSpec[];
  specialRoomDoors: DoomSpecialRoomDoorController;
} {
  const mats = createRoomMaterials(textures, sharedUniforms);
  const buckets: GeoBuckets = {
    annexWall: [],
    annexFloor: [],
    annexCeiling: [],
    serverRack: [],
    crtScreen: [],
    computerScreen: [],
    lampShade: [],
    bankerShade: [],
    bookshelf: [],
    libraryRug: [],
    foliage: [],
    mossSoil: [],
    bioFluid: [],
    specimenGlass: [],
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

  const specialRoomDoors = buildSpecialRoomDoorsAndPlaques(
    parentGroup,
    mats,
    sharedUniforms,
    colliders
  );

  // Um relógio por mundo, sem timers ou atualizações de textura por monitor.
  const updateDoors = specialRoomDoors.update.bind(specialRoomDoors);
  specialRoomDoors.update = (dt: number) => {
    if (Number.isFinite(dt) && dt > 0) {
      mats.computerScreen.uniforms.uComputerTime.value =
        (mats.computerScreen.uniforms.uComputerTime.value + dt) % 400;
    }
    updateDoors(Number.isFinite(dt) ? Math.max(0, dt) : 0);
  };

  const disposeDoors = specialRoomDoors.dispose.bind(specialRoomDoors);
  specialRoomDoors.dispose = () => {
    disposeDoors();
    mats.computerScreen.dispose();
    mats.specimenGlass.dispose();
    for (const shade of [mats.lampShade, mats.bankerShade]) {
      (shade.uniforms.uMap.value as THREE.Texture).dispose();
      shade.dispose();
    }
  };

  return { annexLights, specialRoomDoors };
}
