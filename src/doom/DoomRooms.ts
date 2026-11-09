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

export interface ThemedRoomDefinition {
  id: DoomRoomId;
  name: string;
  subtitle: string;
  minGx: number;
  maxGx: number;
  minGz: number;
  maxGz: number;
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

/**
 * Catálogo oficial das 7 Salas Especiais do Complexo Subterrâneo 29x29.
 */
export const THEMED_ROOMS: ReadonlyArray<ThemedRoomDefinition> = [
  {
    id: 'computer_room',
    name: 'SALA DOS COMPUTADORES',
    subtitle: 'Mainframe Central, Servidores & Telemetria CRT',
    minGx: 9,
    maxGx: 17,
    minGz: 1,
    maxGz: 5,
  },
  {
    id: 'biology_lab',
    name: 'LABORATÓRIO BIOLÓGICO',
    subtitle: 'Contenção Xenobiológica & Tanques de Espécimes',
    minGx: 5,
    maxGx: 9,
    minGz: 3,
    maxGz: 5,
  },
  {
    id: 'reactor_hall',
    name: 'SALÃO DOS REATORES',
    subtitle: 'Núcleos Energéticos & Bancos de Capacitores',
    minGx: 20,
    maxGx: 26,
    minGz: 1,
    maxGz: 7,
  },
  {
    id: 'crew_quarters',
    name: 'QUARTOS DA EQUIPE',
    subtitle: 'Dormitórios de Beliches, Armários & Refeitório',
    minGx: 1,
    maxGx: 7,
    minGz: 9,
    maxGz: 15,
  },
  {
    id: 'medical_ward',
    name: 'ENFERMARIA & QUARENTENA',
    subtitle: 'Leitos Clínicos, Triagem & Suprimentos Médicos',
    minGx: 21,
    maxGx: 26,
    minGz: 9,
    maxGz: 13,
  },
  {
    id: 'vegetation_room',
    name: 'SALA DE VEGETAÇÃO',
    subtitle: 'Estufa Hidropônica Subterrânea & Flora Experimental',
    minGx: 3,
    maxGx: 8,
    minGz: 17,
    maxGz: 21,
  },
  {
    id: 'library_room',
    name: 'BIBLIOTECA & ARQUIVOS',
    subtitle: 'Acervo Científico, Estantes de Carvalho & Sala de Leitura',
    minGx: 20,
    maxGx: 26,
    minGz: 17,
    maxGz: 21,
  },
];

/**
 * Retorna a Sala Especial correspondente à célula `(gx, gz)`, ou `null` se estiver em corredores/galerias gerais.
 */
export function getThemedRoomAtCell(
  gx: number,
  gz: number
): ThemedRoomDefinition | null {
  for (const r of THEMED_ROOMS) {
    if (
      gx >= r.minGx &&
      gx <= r.maxGx &&
      gz >= r.minGz &&
      gz <= r.maxGz
    ) {
      // Evita classificar o arco de transição (10,5) do Lab Biológico como Sala de Computadores
      if (r.id === 'computer_room' && gx === 10 && gz >= 3) continue;
      return r;
    }
  }
  return null;
}

// ============================================================================
// GERADOR DE MOBILIÁRIO 3D ESPECÍFICO POR SALA (COM VERIFICAÇÃO GEOMÉTRICA)
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

function buildLightKeepoutBoxes(): Aabb2D[] {
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
          const z1 = faceZ + d.nz * 1.05;
          boxes.push({
            minX: faceX - 0.64,
            maxX: faceX + 0.64,
            minZ: Math.min(z0, z1),
            maxZ: Math.max(z0, z1),
          });
        } else {
          const x0 = faceX;
          const x1 = faceX + d.nx * 1.05;
          boxes.push({
            minX: Math.min(x0, x1),
            maxX: Math.max(x0, x1),
            minZ: faceZ - 0.64,
            maxZ: faceZ + 0.64,
          });
        }
      }
    }
  }
  return boxes;
}

function isLightWallCell(gx: number, gz: number): boolean {
  if (gz < 0 || gz >= LABYRINTH_MAP.length) return false;
  if (gx < 0 || gx >= LABYRINTH_MAP[gz].length) return false;
  return LABYRINTH_MAP[gz][gx] === 'L';
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

function getFurnitureDimensions(kind: RoomFurnitureKind): {
  width: number;
  depth: number;
  maxY: number;
} {
  switch (kind) {
    case 'server_rack_bank':
      return { width: 1.56, depth: 0.72, maxY: 2.24 };
    case 'crt_workstation_desk':
      return { width: 1.52, depth: 0.82, maxY: 1.38 };
    case 'bio_specimen_tank':
      return { width: 1.04, depth: 0.96, maxY: 2.34 };
    case 'autopsy_surgical_table':
      return { width: 1.66, depth: 0.82, maxY: 1.62 };
    case 'xenobio_lab_bench':
      return { width: 1.56, depth: 0.76, maxY: 1.44 };
    case 'cryo_biohazard_cabinet':
      return { width: 1.36, depth: 0.7, maxY: 2.12 };
    case 'astronaut_bunk_bed':
      return { width: 1.84, depth: 0.86, maxY: 1.82 };
    case 'crew_locker_bank':
      return { width: 1.5, depth: 0.64, maxY: 2.08 };
    case 'crew_mess_table':
      return { width: 1.58, depth: 0.88, maxY: 0.92 };
    case 'cabin_nightstand_desk':
      return { width: 1.32, depth: 0.72, maxY: 1.28 };
    case 'medical_gurney_bed':
      return { width: 1.78, depth: 0.84, maxY: 1.68 };
    case 'medical_supply_cabinet':
      return { width: 1.44, depth: 0.66, maxY: 2.06 };
    case 'vitals_monitor_cart':
      return { width: 1.22, depth: 0.72, maxY: 1.54 };
    case 'hydroponic_tree_planter':
      return { width: 1.48, depth: 0.84, maxY: 2.38 };
    case 'botanical_fern_trough':
      return { width: 1.52, depth: 0.78, maxY: 1.56 };
    case 'irrigation_nutrient_tank':
      return { width: 1.32, depth: 0.74, maxY: 1.86 };
    case 'oak_bookshelf_tall':
      return { width: 1.62, depth: 0.66, maxY: 2.32 };
    case 'library_reading_table':
      return { width: 1.36, depth: 1.04, maxY: 1.26 };
    case 'archive_catalog_cabinet':
      return { width: 1.48, depth: 0.68, maxY: 1.64 };
    case 'reactor_capacitor_console':
      return { width: 1.54, depth: 0.76, maxY: 1.88 };
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
  /** Parede onde encosta ('N' | 'S' | 'W' | 'E' | 'CENTER') */
  attach: 'N' | 'S' | 'W' | 'E' | 'CENTER';
}

const CURATED_ROOM_SPECS: ReadonlyArray<RawRoomFurnitureSpec> = [
  // 1. SALA DOS COMPUTADORES (gx 9..17, gz 1..5)
  { roomId: 'computer_room', kind: 'server_rack_bank', gx: 10, gz: 1, attach: 'N' },
  { roomId: 'computer_room', kind: 'server_rack_bank', gx: 12, gz: 1, attach: 'N' },
  { roomId: 'computer_room', kind: 'crt_workstation_desk', gx: 11, gz: 1, attach: 'S' },
  { roomId: 'computer_room', kind: 'server_rack_bank', gx: 15, gz: 1, attach: 'W' },
  { roomId: 'computer_room', kind: 'crt_workstation_desk', gx: 16, gz: 1, attach: 'N' },
  { roomId: 'computer_room', kind: 'server_rack_bank', gx: 13, gz: 3, attach: 'S' },
  { roomId: 'computer_room', kind: 'crt_workstation_desk', gx: 14, gz: 3, attach: 'S' },
  { roomId: 'computer_room', kind: 'crt_workstation_desk', gx: 12, gz: 5, attach: 'N' },
  { roomId: 'computer_room', kind: 'server_rack_bank', gx: 16, gz: 5, attach: 'N' },

  // 2. LABORATÓRIO BIOLÓGICO (gx 5..9, gz 3..5)
  { roomId: 'biology_lab', kind: 'bio_specimen_tank', gx: 5, gz: 3, attach: 'N' },
  { roomId: 'biology_lab', kind: 'cryo_biohazard_cabinet', gx: 6, gz: 3, attach: 'N' },
  { roomId: 'biology_lab', kind: 'bio_specimen_tank', gx: 9, gz: 3, attach: 'E' },
  { roomId: 'biology_lab', kind: 'xenobio_lab_bench', gx: 5, gz: 4, attach: 'W' },
  { roomId: 'biology_lab', kind: 'autopsy_surgical_table', gx: 9, gz: 4, attach: 'E' },
  { roomId: 'biology_lab', kind: 'bio_specimen_tank', gx: 5, gz: 5, attach: 'S' },
  { roomId: 'biology_lab', kind: 'bio_specimen_tank', gx: 8, gz: 5, attach: 'S' },

  // 3. QUARTOS DA EQUIPE / DORMITÓRIOS (gx 1..7, gz 9..15)
  { roomId: 'crew_quarters', kind: 'crew_locker_bank', gx: 3, gz: 9, attach: 'S' },
  { roomId: 'crew_quarters', kind: 'cabin_nightstand_desk', gx: 4, gz: 9, attach: 'N' },
  { roomId: 'crew_quarters', kind: 'astronaut_bunk_bed', gx: 2, gz: 11, attach: 'N' },
  { roomId: 'crew_quarters', kind: 'astronaut_bunk_bed', gx: 4, gz: 11, attach: 'N' },
  { roomId: 'crew_quarters', kind: 'astronaut_bunk_bed', gx: 2, gz: 13, attach: 'N' },
  { roomId: 'crew_quarters', kind: 'cabin_nightstand_desk', gx: 3, gz: 13, attach: 'E' },
  { roomId: 'crew_quarters', kind: 'astronaut_bunk_bed', gx: 6, gz: 13, attach: 'S' },
  { roomId: 'crew_quarters', kind: 'crew_mess_table', gx: 5, gz: 15, attach: 'N' },
  { roomId: 'crew_quarters', kind: 'crew_locker_bank', gx: 6, gz: 15, attach: 'S' },

  // 4. ENFERMARIA & QUARENTENA (gx 21..26, gz 9..13)
  { roomId: 'medical_ward', kind: 'medical_gurney_bed', gx: 24, gz: 9, attach: 'N' },
  { roomId: 'medical_ward', kind: 'medical_supply_cabinet', gx: 25, gz: 9, attach: 'S' },
  { roomId: 'medical_ward', kind: 'medical_gurney_bed', gx: 24, gz: 11, attach: 'N' },
  { roomId: 'medical_ward', kind: 'vitals_monitor_cart', gx: 25, gz: 11, attach: 'E' },
  { roomId: 'medical_ward', kind: 'medical_gurney_bed', gx: 22, gz: 13, attach: 'N' },
  { roomId: 'medical_ward', kind: 'medical_supply_cabinet', gx: 25, gz: 13, attach: 'S' },

  // 5. SALA DE VEGETAÇÃO / ESTUFA HIDROPÔNICA (gx 3..8, gz 17..21)
  { roomId: 'vegetation_room', kind: 'hydroponic_tree_planter', gx: 6, gz: 17, attach: 'N' },
  { roomId: 'vegetation_room', kind: 'botanical_fern_trough', gx: 7, gz: 17, attach: 'S' },
  { roomId: 'vegetation_room', kind: 'botanical_fern_trough', gx: 4, gz: 19, attach: 'N' },
  { roomId: 'vegetation_room', kind: 'irrigation_nutrient_tank', gx: 7, gz: 19, attach: 'N' },
  { roomId: 'vegetation_room', kind: 'hydroponic_tree_planter', gx: 3, gz: 20, attach: 'W' },
  { roomId: 'vegetation_room', kind: 'hydroponic_tree_planter', gx: 6, gz: 20, attach: 'W' },
  { roomId: 'vegetation_room', kind: 'botanical_fern_trough', gx: 4, gz: 21, attach: 'S' },

  // 6. BIBLIOTECA & ARQUIVOS (gx 20..26, gz 17..21)
  { roomId: 'library_room', kind: 'oak_bookshelf_tall', gx: 22, gz: 17, attach: 'N' },
  { roomId: 'library_room', kind: 'oak_bookshelf_tall', gx: 24, gz: 17, attach: 'N' },
  { roomId: 'library_room', kind: 'oak_bookshelf_tall', gx: 25, gz: 17, attach: 'S' },
  { roomId: 'library_room', kind: 'oak_bookshelf_tall', gx: 21, gz: 19, attach: 'N' },
  { roomId: 'library_room', kind: 'oak_bookshelf_tall', gx: 25, gz: 19, attach: 'N' },
  { roomId: 'library_room', kind: 'oak_bookshelf_tall', gx: 21, gz: 20, attach: 'W' },
  { roomId: 'library_room', kind: 'library_reading_table', gx: 22, gz: 20, attach: 'CENTER' },
  { roomId: 'library_room', kind: 'oak_bookshelf_tall', gx: 23, gz: 20, attach: 'E' },
  { roomId: 'library_room', kind: 'archive_catalog_cabinet', gx: 22, gz: 21, attach: 'S' },
  { roomId: 'library_room', kind: 'oak_bookshelf_tall', gx: 24, gz: 21, attach: 'S' },

  // 7. SALÃO DOS REATORES (gx 20..26, gz 1..5)
  { roomId: 'reactor_hall', kind: 'reactor_capacitor_console', gx: 22, gz: 1, attach: 'N' },
  { roomId: 'reactor_hall', kind: 'reactor_capacitor_console', gx: 24, gz: 1, attach: 'S' },
  { roomId: 'reactor_hall', kind: 'crt_workstation_desk', gx: 25, gz: 3, attach: 'E' },
];

export function generateThemedRoomFurnishings(opts: {
  reservedLairCellKeys: ReadonlySet<string>;
  lairCell: { gx: number; gz: number };
}): RoomFurniturePlacement[] {
  const lightKeepouts = buildLightKeepoutBoxes();
  const out: RoomFurniturePlacement[] = [];
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
    const key = `${spec.gx},${spec.gz}`;
    if (opts.reservedLairCellKeys.has(key)) continue;
    if (
      Math.hypot(spec.gx - opts.lairCell.gx, spec.gz - opts.lairCell.gz) <= 2.2
    ) {
      continue;
    }
    if (LABYRINTH_MAP[spec.gz]?.[spec.gx] !== '.') continue;

    const dims = getFurnitureDimensions(spec.kind);
    const cellCenter = gridCellToWorld(spec.gx, spec.gz);
    let wx = cellCenter.x;
    let wz = cellCenter.z;
    let yaw = 0;

    if (spec.attach !== 'CENTER') {
      const dir = attachMap[spec.attach];
      const wallCh = LABYRINTH_MAP[spec.gz + dir.nz]?.[spec.gx + dir.nx];
      if (wallCh !== '#' && wallCh !== 'B') continue;

      const timberAxis = getTimberPostAxis(spec.gx, spec.gz);
      if (timberAxis === 'WE' && dir.nx !== 0) continue;
      if (timberAxis === 'NS' && dir.nz !== 0) continue;

      const wallGap = 0.045;
      const distFromWall = wallGap + dims.depth * 0.5;
      wx = cellCenter.x + dir.nx * (halfCell - distFromWall);
      wz = cellCenter.z + dir.nz * (halfCell - distFromWall);
      yaw = dir.yaw;
    }

    const aabb = computeRotatedAabb(wx, wz, dims.width, dims.depth, yaw);
    const padded: Aabb2D = {
      minX: aabb.minX - 0.06,
      maxX: aabb.maxX + 0.06,
      minZ: aabb.minZ - 0.06,
      maxZ: aabb.maxZ + 0.06,
    };
    if (lightKeepouts.some((lk) => aabb2DOverlaps(padded, lk))) {
      continue;
    }

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

function clampByte(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}

function hash2i(x: number, y: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + seed * 1442695041) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
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
  // 1. Gabinete de Mainframe com blades, grelhas e LEDs indicadores
  const serverTex = makeRoomPixelTex(64, 128, (px) => {
    for (let y = 0; y < 128; y++) {
      const bay = y % 16;
      for (let x = 0; x < 64; x++) {
        const border = x < 4 || x >= 60 || bay === 0 || bay === 15;
        if (border) {
          px(x, y, 26, 30, 36);
          continue;
        }
        // LEDs luminosos do servidor
        if ((bay === 5 || bay === 6) && x >= 8 && x <= 26 && x % 4 < 2) {
          const h = hash2i(x >> 2, y >> 4, 101);
          if (h < 0.55) px(x, y, 52, 238, 124);
          else if (h < 0.82) px(x, y, 245, 186, 56);
          else px(x, y, 64, 198, 248);
          continue;
        }
        // Frestas de ventilação
        if (bay >= 9 && bay <= 13 && x >= 32 && x <= 55 && bay % 2 === 1) {
          px(x, y, 14, 16, 20);
          continue;
        }
        const n = (hash2i(x, y, 103) - 0.5) * 6;
        px(x, y, 42 + n, 47 + n, 56 + n);
      }
    }
  });

  // 2. Tela CRT Fosforescente com linhas de telemetria e gráficos
  const crtTex = makeRoomPixelTex(64, 64, (px) => {
    for (let y = 0; y < 64; y++) {
      for (let x = 0; x < 64; x++) {
        if (x < 3 || x >= 61 || y < 3 || y >= 61) {
          px(x, y, 18, 24, 20);
          continue;
        }
        const scan = y % 2 === 0 ? 1.0 : 0.76;
        const waveY = 38 + Math.round(Math.sin(x * 0.28) * 7 + Math.cos(x * 0.11) * 4);
        const isWave = Math.abs(y - waveY) <= 1;
        const isText =
          y >= 8 &&
          y <= 24 &&
          y % 4 !== 0 &&
          x >= 7 &&
          x <= 54 &&
          hash2i(x >> 1, y >> 2, 211) > 0.38;
        if (isWave) {
          px(x, y, 130 * scan, 255 * scan, 168 * scan);
        } else if (isText) {
          px(x, y, 68 * scan, 232 * scan, 118 * scan);
        } else {
          px(x, y, 12 * scan, 46 * scan, 26 * scan);
        }
      }
    }
  });

  // 3. Estante de Biblioteca repleta de lombadas coloridas encadernadas em couro
  const bookshelfTex = makeRoomPixelTex(128, 128, (px) => {
    const palettes: Array<[number, number, number]> = [
      [136, 42, 38],
      [42, 74, 118],
      [44, 98, 62],
      [138, 96, 44],
      [96, 54, 92],
      [118, 82, 54],
      [164, 146, 108],
    ];
    for (let y = 0; y < 128; y++) {
      const shelfRow = Math.floor(y / 32);
      const ly = y % 32;
      for (let x = 0; x < 128; x++) {
        // Prateleira horizontal de carvalho
        if (ly >= 28 || ly <= 1 || x < 4 || x >= 124) {
          const wood = 68 + (hash2i(x, y, 307) - 0.5) * 10;
          px(x, y, wood * 1.12, wood * 0.74, wood * 0.46);
          continue;
        }
        const bookIdx = Math.floor((x + shelfRow * 11) / 7);
        const bx = (x + shelfRow * 11) % 7;
        const topGap = 3 + Math.floor(hash2i(bookIdx, shelfRow, 311) * 5);
        if (ly < topGap || bx === 0) {
          px(x, y, 18, 14, 12);
          continue;
        }
        const pal =
          palettes[
            Math.floor(hash2i(bookIdx, shelfRow, 313) * palettes.length) %
              palettes.length
          ];
        const shade = bx === 1 ? 1.16 : bx === 6 ? 0.78 : 1.0;
        const goldBand = ly === topGap + 3 || ly === 24;
        if (goldBand && bx >= 2 && bx <= 5) {
          px(x, y, 204, 172, 86);
        } else {
          px(x, y, pal[0] * shade, pal[1] * shade, pal[2] * shade);
        }
      }
    }
  });

  // 4. Tapete Bordô Persa Clássico da Biblioteca
  const rugTex = makeRoomPixelTex(64, 64, (px) => {
    for (let y = 0; y < 64; y++) {
      for (let x = 0; x < 64; x++) {
        const edge = Math.min(x, y, 63 - x, 63 - y);
        const weave = (hash2i(x, y, 401) - 0.5) * 9;
        if (edge < 3) {
          px(x, y, 92 + weave, 68 + weave, 34 + weave);
        } else if (edge === 5 || edge === 6) {
          px(x, y, 168 + weave, 132 + weave, 62 + weave);
        } else {
          const motif =
            ((x - 32) * (x - 32) + (y - 32) * (y - 32)) % 29 < 5 ? 18 : 0;
          px(x, y, 112 + motif + weave, 28 + motif * 0.4 + weave * 0.4, 34 + weave * 0.4);
        }
      }
    }
  });

  // 5. Folhagem Botânica Densa da Sala de Vegetação
  const foliageTex = makeRoomPixelTex(64, 64, (px) => {
    for (let y = 0; y < 64; y++) {
      for (let x = 0; x < 64; x++) {
        const cluster = hash2i(x >> 2, y >> 2, 503);
        const detail = hash2i(x, y, 509);
        const vein = (x + y) % 7 === 0 ? 12 : 0;
        const baseG = 78 + cluster * 64 + detail * 22 + vein;
        const baseR = 26 + cluster * 28 + detail * 10;
        const baseB = 24 + cluster * 18;
        px(x, y, baseR, baseG, baseB);
      }
    }
  });

  // 6. Terra Úmida & Musgo do Biodomo
  const mossSoilTex = makeRoomPixelTex(64, 64, (px) => {
    for (let y = 0; y < 64; y++) {
      for (let x = 0; x < 64; x++) {
        const isMoss = hash2i(x >> 2, y >> 2, 521) > 0.46;
        const n = (hash2i(x, y, 523) - 0.5) * 14;
        if (isMoss) {
          px(x, y, 36 + n * 0.5, 76 + n, 34 + n * 0.5);
        } else {
          px(x, y, 58 + n, 44 + n * 0.8, 30 + n * 0.6);
        }
      }
    }
  });

  // 7. Fluido Bioluminescente de Contenção Xenobiológica
  const bioFluidTex = makeRoomPixelTex(64, 128, (px) => {
    for (let y = 0; y < 128; y++) {
      for (let x = 0; x < 64; x++) {
        const centerDist = Math.hypot((x - 32) * 1.1, (y - 64) * 0.55);
        const bubble =
          hash2i(x >> 1, y >> 1, 607) > 0.93 ? 75 : 0;
        if (centerDist < 13) {
          // Silhueta orgânica suspensa no centro do tanque!
          px(x, y, 22, 68, 58);
        } else {
          const glow = 1.0 - Math.min(0.45, Math.abs(y - 64) / 140);
          px(
            x,
            y,
            (36 + bubble) * glow,
            Math.min(255, (214 + bubble) * glow),
            Math.min(255, (186 + bubble) * glow)
          );
        }
      }
    }
  });

  // 8. Piso Cerâmico Estéril do Laboratório Biológico & Enfermaria
  const labTileTex = makeRoomPixelTex(64, 64, (px) => {
    for (let y = 0; y < 64; y++) {
      for (let x = 0; x < 64; x++) {
        const grout = x % 16 === 0 || y % 16 === 0;
        const n = (hash2i(x, y, 701) - 0.5) * 7;
        if (grout) {
          px(x, y, 52, 68, 72);
        } else {
          px(x, y, 126 + n, 144 + n, 146 + n);
        }
      }
    }
  });

  // 9. Piso Elevado Antiestático da Sala dos Computadores
  const techFloorTex = makeRoomPixelTex(64, 64, (px) => {
    for (let y = 0; y < 64; y++) {
      for (let x = 0; x < 64; x++) {
        const seam = x % 32 === 0 || y % 32 === 0;
        const perf = x % 4 === 2 && y % 4 === 2 && x > 4 && x < 28;
        const n = (hash2i(x, y, 733) - 0.5) * 6;
        if (seam) px(x, y, 20, 28, 38);
        else if (perf) px(x, y, 28, 38, 52);
        else px(x, y, 48 + n, 62 + n, 82 + n);
      }
    }
  });

  // 10. Tecido Acolchoado Verde-Oliva dos Beliches & Roupa de Cama Clara
  const bunkFabricTex = makeRoomPixelTex(64, 64, (px) => {
    for (let y = 0; y < 64; y++) {
      for (let x = 0; x < 64; x++) {
        const stitch = (x + y) % 12 === 0 || (x - y + 64) % 12 === 0;
        const n = (hash2i(x, y, 809) - 0.5) * 8;
        const v = stitch ? -10 : 0;
        px(x, y, 66 + v + n, 82 + v + n, 62 + v + n);
      }
    }
  });

  const cleanLinenTex = makeRoomPixelTex(32, 32, (px) => {
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 32; x++) {
        const n = (hash2i(x, y, 821) - 0.5) * 8;
        px(x, y, 188 + n, 190 + n, 184 + n);
      }
    }
  });

  // 11. Armário Médico Branco com Cruz Vermelha
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

  // 12. Abajur / Luminária Quente de Leitura e Grow-Light
  const warmLampTex = makeRoomPixelTex(16, 16, (px) => {
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        px(x, y, 255, 224, 146);
      }
    }
  });

  return {
    serverRack: createDoomSurfaceMaterial(serverTex, sharedUniforms, {
      useLocalUv: true,
      baseLight: 0.16,
    }),
    crtScreen: createDoomSurfaceMaterial(crtTex, sharedUniforms, {
      fullBright: true,
      useLocalUv: true,
    }),
    bookshelf: createDoomSurfaceMaterial(bookshelfTex, sharedUniforms, {
      useLocalUv: true,
    }),
    libraryRug: createDoomSurfaceMaterial(rugTex, sharedUniforms, {
      useLocalUv: true,
    }),
    foliage: createDoomSurfaceMaterial(foliageTex, sharedUniforms, {
      useLocalUv: true,
    }),
    mossSoil: createDoomSurfaceMaterial(mossSoilTex, sharedUniforms, {
      tileScaleXZ: 1.5,
    }),
    bioFluid: createDoomSurfaceMaterial(bioFluidTex, sharedUniforms, {
      fullBright: true,
      useLocalUv: true,
    }),
    labTile: createDoomSurfaceMaterial(labTileTex, sharedUniforms, {
      tileScaleXZ: 1.5,
    }),
    techFloor: createDoomSurfaceMaterial(techFloorTex, sharedUniforms, {
      tileScaleXZ: 1.5,
    }),
    bunkFabric: createDoomSurfaceMaterial(bunkFabricTex, sharedUniforms, {
      useLocalUv: true,
    }),
    cleanLinen: createDoomSurfaceMaterial(cleanLinenTex, sharedUniforms, {
      useLocalUv: true,
    }),
    medicalCross: createDoomSurfaceMaterial(medCrossTex, sharedUniforms, {
      useLocalUv: true,
    }),
    warmLampGlow: createDoomSurfaceMaterial(warmLampTex, sharedUniforms, {
      fullBright: true,
      useLocalUv: true,
    }),
    oakWood: createDoomSurfaceMaterial(textures.cratePlanks, sharedUniforms, {
      useLocalUv: true,
    }),
    weatheredWood: createDoomSurfaceMaterial(
      textures.weatheredWood,
      sharedUniforms,
      { useLocalUv: true }
    ),
    metalTrim: createDoomSurfaceMaterial(textures.metalTrim, sharedUniforms, {
      useLocalUv: true,
    }),
    darkIron: createDoomSurfaceMaterial(textures.darkIron, sharedUniforms, {
      useLocalUv: true,
    }),
    stone: createDoomSurfaceMaterial(textures.stoneWall, sharedUniforms, {
      useLocalUv: true,
    }),
  };
}

// ============================================================================
// CONSTRUTORES GEOMÉTRICOS 3D DAS SALAS ESPECIAIS
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

function emitRoomFurniturePiece(
  p: RoomFurniturePlacement,
  b: GeoBuckets
): void {
  const xf: LocalXf = { cx: p.worldX, cz: p.worldZ, yaw: p.yaw };

  switch (p.kind) {
    case 'server_rack_bank': {
      // Par de gabinetes Mainframe 2.22m com bobinas de fita magnética e painel de LEDs
      for (const ox of [-0.38, 0.38]) {
        pushRoomBox(b.darkIron, xf, 0.72, 0.08, 0.66, ox, 0.04, 0);
        pushRoomBox(b.serverRack, xf, 0.7, 2.08, 0.62, ox, 1.12, 0);
        pushRoomBox(b.metalTrim, xf, 0.74, 0.06, 0.66, ox, 2.19, 0);
        // Bobinas duplas de fita magnética na metade superior
        pushRoomCyl(b.metalTrim, xf, 0.11, 0.11, 0.03, 10, ox - 0.14, 1.72, 0.32, Math.PI * 0.5, 0, 0);
        pushRoomCyl(b.metalTrim, xf, 0.11, 0.11, 0.03, 10, ox + 0.14, 1.72, 0.32, Math.PI * 0.5, 0, 0);
      }
      // Eletroduto superior conectando os racks ao barramento de dados
      pushRoomCyl(b.darkIron, xf, 0.055, 0.055, 0.72, 8, 0, 2.56, -0.18);
      break;
    }

    case 'crt_workstation_desk': {
      // Mesa técnica de aço + 2 monitores CRT verdes acesos + teclados + cadeira giratória
      pushRoomBox(b.metalTrim, xf, 1.48, 0.06, 0.72, 0, 0.75, -0.02);
      pushRoomBox(b.darkIron, xf, 0.07, 0.74, 0.68, -0.68, 0.37, -0.02);
      pushRoomBox(b.darkIron, xf, 0.07, 0.74, 0.68, 0.68, 0.37, -0.02);
      pushRoomBox(b.darkIron, xf, 1.32, 0.52, 0.04, 0, 0.42, -0.32);
      // Gabinete torre CPU sob a mesa
      pushRoomBox(b.serverRack, xf, 0.24, 0.48, 0.48, 0.46, 0.24, -0.04);

      for (const mx of [-0.34, 0.28]) {
        // Carcaça do monitor CRT tubo + tela fosforescente
        pushRoomBox(b.metalTrim, xf, 0.44, 0.38, 0.36, mx, 1.02, -0.08);
        pushRoomBox(b.darkIron, xf, 0.22, 0.08, 0.22, mx, 0.81, -0.08);
        pushRoomBox(b.crtScreen, xf, 0.36, 0.28, 0.02, mx, 1.03, 0.105);
        // Teclado mecânico inclinado
        pushRoomBox(b.darkIron, xf, 0.38, 0.035, 0.16, mx, 0.8, 0.22, 0.1, 0, 0);
      }

      // Cadeira giratória recuada ao lado para não obstruir o corredor
      pushRoomCyl(b.darkIron, xf, 0.04, 0.04, 0.42, 8, -0.04, 0.21, 0.36);
      pushRoomBox(b.bunkFabric, xf, 0.42, 0.06, 0.4, -0.04, 0.44, 0.36);
      pushRoomBox(b.bunkFabric, xf, 0.4, 0.38, 0.06, -0.04, 0.66, 0.54);
      break;
    }

    case 'bio_specimen_tank': {
      // Tanque cilíndrico de contenção biológica (fluido bioluminescente + espécime suspenso)
      pushRoomCyl(b.darkIron, xf, 0.44, 0.48, 0.24, 12, 0, 0.12, 0);
      pushRoomCyl(b.metalTrim, xf, 0.42, 0.42, 0.08, 12, 0, 0.27, 0);
      // Coluna iluminada de bio-fluido
      pushRoomCyl(b.bioFluid, xf, 0.36, 0.36, 1.62, 12, 0, 1.12, 0);
      // Núcleo escuro orgânico suspenso no interior
      pushRoomCyl(b.darkIron, xf, 0.12, 0.08, 0.52, 8, 0, 1.14, 0, 0.18, 0, 0.12);
      // Cúpula superior de pressão + hastes metálicas de contenção
      pushRoomCyl(b.metalTrim, xf, 0.42, 0.42, 0.08, 12, 0, 1.97, 0);
      pushRoomCyl(b.darkIron, xf, 0.38, 0.44, 0.24, 12, 0, 2.13, 0);
      pushRoomCyl(b.darkIron, xf, 0.07, 0.07, 0.65, 8, 0, 2.56, -0.1);
      for (const ang of [0.6, 2.54, 3.74, 5.68]) {
        pushRoomCyl(
          b.darkIron,
          xf,
          0.024,
          0.024,
          1.72,
          6,
          Math.cos(ang) * 0.4,
          1.12,
          Math.sin(ang) * 0.4
        );
      }
      break;
    }

    case 'autopsy_surgical_table': {
      // Mesa cirúrgica/autópsia de inox com calha e braço de refletor médico
      pushRoomBox(b.darkIron, xf, 0.52, 0.76, 0.42, 0, 0.38, 0);
      pushRoomBox(b.metalTrim, xf, 1.62, 0.08, 0.74, 0, 0.8, 0);
      pushRoomBox(b.cleanLinen, xf, 1.48, 0.04, 0.62, 0, 0.86, 0);
      pushRoomBox(b.cleanLinen, xf, 0.28, 0.07, 0.46, -0.56, 0.91, 0);
      // Haste articulada com foco cirúrgico
      pushRoomCyl(b.metalTrim, xf, 0.03, 0.03, 1.56, 8, -0.68, 0.78, -0.28);
      pushRoomBox(b.metalTrim, xf, 0.62, 0.04, 0.04, -0.38, 1.56, -0.14, 0, 0, -0.12);
      pushRoomCyl(b.metalTrim, xf, 0.16, 0.22, 0.09, 10, -0.1, 1.48, -0.04);
      pushRoomCyl(b.warmLampGlow, xf, 0.18, 0.18, 0.02, 10, -0.1, 1.43, -0.04);
      break;
    }

    case 'xenobio_lab_bench': {
      // Bancada científica com microscópio, centrífuga e estante de tubos bioluminescentes
      pushRoomBox(b.metalTrim, xf, 1.52, 0.84, 0.68, 0, 0.42, 0);
      pushRoomBox(b.darkIron, xf, 1.56, 0.06, 0.72, 0, 0.86, 0);
      // Microscópio 3D
      pushRoomBox(b.darkIron, xf, 0.2, 0.04, 0.22, -0.42, 0.91, 0.04);
      pushRoomBox(b.metalTrim, xf, 0.06, 0.28, 0.08, -0.42, 1.06, -0.02);
      pushRoomCyl(b.darkIron, xf, 0.028, 0.032, 0.22, 8, -0.42, 1.22, 0.04, 0.42, 0, 0);
      // Grade de tubos de ensaio brilhantes + centrífuga
      pushRoomBox(b.darkIron, xf, 0.34, 0.08, 0.16, 0.08, 0.93, 0.02);
      for (const tx of [-0.08, 0.0, 0.08, 0.16, 0.24]) {
        pushRoomCyl(b.bioFluid, xf, 0.022, 0.022, 0.18, 6, tx, 1.02, 0.02);
      }
      pushRoomBox(b.cleanLinen, xf, 0.34, 0.24, 0.3, 0.5, 1.01, -0.02);
      pushRoomBox(b.crtScreen, xf, 0.18, 0.1, 0.02, 0.5, 1.04, 0.14);
      break;
    }

    case 'cryo_biohazard_cabinet': {
      pushRoomBox(b.metalTrim, xf, 1.32, 2.08, 0.64, 0, 1.04, 0);
      pushRoomBox(b.darkIron, xf, 1.2, 1.82, 0.04, 0, 1.06, 0.31);
      pushRoomBox(b.bioFluid, xf, 0.44, 0.92, 0.05, -0.28, 1.24, 0.315);
      pushRoomBox(b.bioFluid, xf, 0.44, 0.92, 0.05, 0.28, 1.24, 0.315);
      break;
    }

    case 'astronaut_bunk_bed': {
      // Beliche duplo militar/espacial com 2 colchões, cobertores, travesseiros e escada lateral
      const w = 1.8;
      const d = 0.82;
      const hw = w * 0.5 - 0.04;
      const hd = d * 0.5 - 0.04;
      for (const sx of [-hw, hw]) {
        for (const sz of [-hd, hd]) {
          pushRoomBox(b.darkIron, xf, 0.065, 1.8, 0.065, sx, 0.9, sz);
        }
      }
      for (const bedY of [0.38, 1.26]) {
        pushRoomBox(b.darkIron, xf, w, 0.07, d, 0, bedY, 0);
        // Colchão claro + cobertor verde-oliva dobrado + travesseiro
        pushRoomBox(b.cleanLinen, xf, w - 0.1, 0.13, d - 0.1, 0, bedY + 0.1, 0);
        pushRoomBox(b.bunkFabric, xf, w - 0.54, 0.145, d - 0.08, 0.2, bedY + 0.105, 0);
        pushRoomBox(b.cleanLinen, xf, 0.32, 0.09, 0.52, -0.64, bedY + 0.2, 0, 0, 0, -0.08);
      }
      // Escada metálica lateral de acesso ao beliche superior
      pushRoomBox(b.metalTrim, xf, 0.04, 1.45, 0.04, 0.58, 0.76, hd + 0.03);
      pushRoomBox(b.metalTrim, xf, 0.04, 1.45, 0.04, 0.82, 0.76, hd + 0.03);
      for (const ry of [0.32, 0.64, 0.96, 1.28]) {
        pushRoomBox(b.metalTrim, xf, 0.26, 0.035, 0.035, 0.7, ry, hd + 0.03);
      }
      break;
    }

    case 'crew_locker_bank': {
      // Conjunto de 3 armários vestiários de tripulação
      pushRoomBox(b.metalTrim, xf, 1.46, 2.04, 0.58, 0, 1.02, 0);
      for (const lx of [-0.46, 0, 0.46]) {
        pushRoomBox(b.darkIron, xf, 0.42, 1.86, 0.03, lx, 1.02, 0.29);
        pushRoomBox(b.metalTrim, xf, 0.38, 1.82, 0.035, lx, 1.02, 0.295);
        pushRoomBox(b.cleanLinen, xf, 0.18, 0.07, 0.04, lx, 1.68, 0.305);
        pushRoomBox(b.darkIron, xf, 0.03, 0.14, 0.05, lx + 0.14, 1.04, 0.31);
      }
      break;
    }

    case 'crew_mess_table': {
      // Mesa de refeitório / convivência com bancos nos dois lados
      pushRoomBox(b.oakWood, xf, 1.52, 0.07, 0.62, 0, 0.76, 0);
      pushRoomBox(b.darkIron, xf, 0.08, 0.74, 0.54, -0.62, 0.37, 0);
      pushRoomBox(b.darkIron, xf, 0.08, 0.74, 0.54, 0.62, 0.37, 0);
      pushRoomBox(b.weatheredWood, xf, 1.38, 0.05, 0.24, 0, 0.44, 0.36);
      pushRoomBox(b.darkIron, xf, 0.06, 0.42, 0.2, -0.52, 0.21, 0.36);
      pushRoomBox(b.darkIron, xf, 0.06, 0.42, 0.2, 0.52, 0.21, 0.36);
      // Bandeja e canecas metálicas sobre a mesa
      pushRoomBox(b.metalTrim, xf, 0.34, 0.025, 0.24, -0.28, 0.81, 0.02);
      pushRoomCyl(b.metalTrim, xf, 0.045, 0.045, 0.1, 8, 0.24, 0.84, -0.05);
      break;
    }

    case 'cabin_nightstand_desk': {
      pushRoomBox(b.oakWood, xf, 1.26, 0.76, 0.64, 0, 0.38, 0);
      pushRoomBox(b.weatheredWood, xf, 1.3, 0.06, 0.68, 0, 0.78, 0);
      // Abajur quente sobre a escrivaninha do quarto
      pushRoomCyl(b.darkIron, xf, 0.08, 0.1, 0.04, 8, 0.38, 0.83, -0.06);
      pushRoomCyl(b.metalTrim, xf, 0.022, 0.022, 0.24, 6, 0.38, 0.96, -0.06);
      pushRoomCyl(b.warmLampGlow, xf, 0.11, 0.17, 0.16, 10, 0.38, 1.14, -0.06);
      break;
    }

    case 'medical_gurney_bed': {
      // Leito / maca hospitalar com cabeceira, lençol branco e suporte de soro (IV)
      pushRoomBox(b.metalTrim, xf, 1.68, 0.07, 0.76, 0, 0.68, 0);
      for (const sx of [-0.74, 0.74]) {
        for (const sz of [-0.32, 0.32]) {
          pushRoomCyl(b.metalTrim, xf, 0.03, 0.03, 0.66, 8, sx, 0.33, sz);
        }
      }
      pushRoomBox(b.metalTrim, xf, 0.05, 0.42, 0.76, -0.82, 0.88, 0);
      pushRoomBox(b.cleanLinen, xf, 1.6, 0.14, 0.7, 0, 0.78, 0);
      pushRoomBox(b.medicalCross, xf, 0.92, 0.15, 0.72, 0.24, 0.785, 0);
      pushRoomBox(b.cleanLinen, xf, 0.3, 0.08, 0.5, -0.58, 0.89, 0, 0, 0, -0.1);
      // Suporte vertical de soro hospitalar
      pushRoomCyl(b.metalTrim, xf, 0.02, 0.02, 1.64, 6, -0.78, 0.82, 0.36);
      pushRoomBox(b.bioFluid, xf, 0.09, 0.18, 0.05, -0.78, 1.52, 0.36);
      break;
    }

    case 'medical_supply_cabinet': {
      pushRoomBox(b.cleanLinen, xf, 1.4, 2.02, 0.6, 0, 1.01, 0);
      pushRoomBox(b.medicalCross, xf, 0.62, 0.62, 0.03, -0.32, 1.32, 0.3);
      pushRoomBox(b.medicalCross, xf, 0.62, 0.62, 0.03, 0.32, 1.32, 0.3);
      pushRoomBox(b.metalTrim, xf, 1.44, 0.07, 0.64, 0, 2.03, 0);
      break;
    }

    case 'vitals_monitor_cart': {
      pushRoomBox(b.metalTrim, xf, 1.14, 0.86, 0.64, 0, 0.43, 0);
      pushRoomBox(b.darkIron, xf, 0.54, 0.44, 0.42, -0.18, 1.12, -0.04);
      pushRoomBox(b.crtScreen, xf, 0.44, 0.32, 0.02, -0.18, 1.14, 0.18);
      pushRoomBox(b.medicalCross, xf, 0.38, 0.28, 0.34, 0.32, 1.02, 0);
      break;
    }

    case 'hydroponic_tree_planter': {
      // Canteiro elevado de pedra e madeira + Árvore subterrânea 3D copada + Grow-light!
      pushRoomBox(b.stone, xf, 1.44, 0.46, 0.78, 0, 0.23, 0);
      pushRoomBox(b.weatheredWood, xf, 1.5, 0.07, 0.84, 0, 0.47, 0);
      pushRoomBox(b.mossSoil, xf, 1.34, 0.06, 0.68, 0, 0.46, 0);

      // Tronco retorcido + galhos de madeira + 4 massas frondosas de copa verde!
      pushRoomCyl(b.weatheredWood, xf, 0.09, 0.15, 1.22, 8, -0.06, 1.04, -0.02, 0.05, 0, -0.06);
      pushRoomCyl(b.weatheredWood, xf, 0.05, 0.08, 0.62, 6, -0.26, 1.52, 0.04, 0.12, 0, 0.52);
      pushRoomCyl(b.weatheredWood, xf, 0.05, 0.08, 0.58, 6, 0.2, 1.48, -0.04, -0.1, 0, -0.48);

      pushRoomBox(b.foliage, xf, 0.96, 0.52, 0.68, -0.04, 1.88, 0.0, 0.06, 0.2, 0.04);
      pushRoomBox(b.foliage, xf, 0.72, 0.44, 0.56, -0.34, 1.66, 0.04, -0.05, -0.3, 0.08);
      pushRoomBox(b.foliage, xf, 0.68, 0.42, 0.54, 0.32, 1.64, -0.02, 0.08, 0.35, -0.06);
      pushRoomBox(b.foliage, xf, 0.58, 0.36, 0.48, 0.0, 2.16, -0.02, 0, 0.5, 0);

      // Arbustos baixos na base do canteiro
      pushRoomBox(b.foliage, xf, 0.38, 0.28, 0.34, 0.44, 0.62, 0.08, 0, 0.4, 0);
      pushRoomBox(b.foliage, xf, 0.34, 0.24, 0.32, -0.46, 0.6, 0.06, 0, -0.3, 0);
      break;
    }

    case 'botanical_fern_trough': {
      // Canteiro hidropônico com samambaias gigantes em leque + cogumelos bioluminescentes + calha UV
      pushRoomBox(b.weatheredWood, xf, 1.48, 0.42, 0.72, 0, 0.21, 0);
      pushRoomBox(b.darkIron, xf, 1.52, 0.05, 0.76, 0, 0.38, 0);
      pushRoomBox(b.mossSoil, xf, 1.38, 0.05, 0.64, 0, 0.42, 0);

      for (const fx of [-0.44, 0.0, 0.44]) {
        for (const ang of [-0.55, 0, 0.55]) {
          pushRoomBox(
            b.foliage,
            xf,
            0.16,
            0.56,
            0.06,
            fx + Math.sin(ang) * 0.14,
            0.68,
            0.02,
            0.28,
            ang,
            ang * 0.65
          );
        }
      }
      // Cogumelos / cápsulas bioluminescentes nos cantos do canteiro
      pushRoomCyl(b.cleanLinen, xf, 0.02, 0.028, 0.16, 6, -0.22, 0.52, 0.16);
      pushRoomCyl(b.bioFluid, xf, 0.08, 0.09, 0.05, 8, -0.22, 0.61, 0.16);
      pushRoomCyl(b.cleanLinen, xf, 0.02, 0.028, 0.14, 6, 0.26, 0.51, -0.14);
      pushRoomCyl(b.bioFluid, xf, 0.07, 0.08, 0.045, 8, 0.26, 0.59, -0.14);

      // Pórtico superior de cultivo hidropônico
      pushRoomBox(b.darkIron, xf, 0.05, 1.12, 0.05, -0.68, 0.98, -0.24);
      pushRoomBox(b.darkIron, xf, 0.05, 1.12, 0.05, 0.68, 0.98, -0.24);
      pushRoomBox(b.metalTrim, xf, 1.44, 0.06, 0.22, 0, 1.52, -0.16);
      pushRoomBox(b.warmLampGlow, xf, 1.28, 0.025, 0.12, 0, 1.48, -0.16);
      break;
    }

    case 'irrigation_nutrient_tank': {
      pushRoomBox(b.stone, xf, 1.28, 0.16, 0.68, 0, 0.08, 0);
      pushRoomCyl(b.metalTrim, xf, 0.28, 0.28, 1.58, 12, -0.3, 0.95, 0);
      pushRoomCyl(b.bioFluid, xf, 0.29, 0.29, 0.34, 12, -0.3, 1.02, 0);
      pushRoomCyl(b.darkIron, xf, 0.26, 0.26, 1.42, 12, 0.32, 0.87, 0);
      // Trepadeira subindo pelo reservatório
      pushRoomBox(b.foliage, xf, 0.22, 0.88, 0.16, 0.32, 0.96, 0.24, 0, 0, 0.12);
      break;
    }

    case 'oak_bookshelf_tall': {
      // Estante monumental de carvalho entalhado da Biblioteca (2.30m) abarrotada de livros!
      const w = 1.58;
      const d = 0.6;
      const h = 2.28;
      // Zócalo inferior, corpo de livros e cornija clássica superior
      pushRoomBox(b.weatheredWood, xf, w + 0.04, 0.14, d + 0.04, 0, 0.07, 0);
      pushRoomBox(b.oakWood, xf, w, h - 0.22, d - 0.06, 0, 1.14, -0.03);
      pushRoomBox(b.bookshelf, xf, w - 0.14, h - 0.28, 0.08, 0, 1.14, d * 0.5 - 0.04);
      // Pilastras laterais e central de madeira entalhada
      for (const px of [-w * 0.5 + 0.045, 0, w * 0.5 - 0.045]) {
        pushRoomBox(b.weatheredWood, xf, 0.085, h - 0.16, d, px, 1.14, 0);
      }
      // Cornija superior saliente
      pushRoomBox(b.weatheredWood, xf, w + 0.08, 0.12, d + 0.08, 0, h - 0.04, 0.01);
      break;
    }

    case 'library_reading_table': {
      // Mesa central de leitura em carvalho + abajur clássico de banqueiro + livros abertos + cadeiras!
      pushRoomBox(b.oakWood, xf, 1.32, 0.08, 0.94, 0, 0.76, 0);
      for (const sx of [-0.56, 0.56]) {
        for (const sz of [-0.38, 0.38]) {
          pushRoomBox(b.weatheredWood, xf, 0.09, 0.74, 0.09, sx, 0.37, sz);
        }
      }
      // Livros empilhados e pergaminho aberto sobre a mesa
      pushRoomBox(b.cleanLinen, xf, 0.36, 0.035, 0.26, -0.28, 0.82, 0.14, 0, 0.12, 0);
      pushRoomBox(b.bookshelf, xf, 0.26, 0.12, 0.2, 0.34, 0.86, -0.16, 0, -0.2, 0);
      // Abajur clássico de biblioteca
      pushRoomCyl(b.metalTrim, xf, 0.09, 0.11, 0.04, 8, 0, 0.82, 0);
      pushRoomCyl(b.metalTrim, xf, 0.022, 0.022, 0.28, 6, 0, 0.98, 0);
      pushRoomBox(b.foliage, xf, 0.28, 0.1, 0.18, 0, 1.14, 0);
      pushRoomBox(b.warmLampGlow, xf, 0.24, 0.04, 0.14, 0, 1.09, 0);

      // Duas cadeiras de carvalho encaixadas junto à mesa
      for (const czSign of [-1, 1]) {
        pushRoomBox(b.weatheredWood, xf, 0.44, 0.05, 0.4, 0, 0.45, czSign * 0.46);
        pushRoomBox(b.weatheredWood, xf, 0.44, 0.46, 0.05, 0, 0.68, czSign * 0.64);
      }
      break;
    }

    case 'archive_catalog_cabinet': {
      // Fichário de arquivo antigo de carvalho com dezenas de gavetas e puxadores metálicos
      pushRoomBox(b.oakWood, xf, 1.44, 1.56, 0.62, 0, 0.78, 0);
      pushRoomBox(b.weatheredWood, xf, 1.48, 0.07, 0.66, 0, 1.58, 0);
      for (const rowY of [0.32, 0.68, 1.04, 1.38]) {
        for (const colX of [-0.44, 0, 0.44]) {
          pushRoomBox(b.weatheredWood, xf, 0.38, 0.26, 0.03, colX, rowY, 0.31);
          pushRoomBox(b.cleanLinen, xf, 0.14, 0.06, 0.04, colX, rowY + 0.04, 0.32);
          pushRoomBox(b.metalTrim, xf, 0.08, 0.03, 0.05, colX, rowY - 0.04, 0.325);
        }
      }
      break;
    }

    case 'reactor_capacitor_console': {
      // Banco energético de capacitores + console de controle do Salão dos Reatores
      pushRoomBox(b.darkIron, xf, 1.5, 0.92, 0.7, 0, 0.46, 0);
      pushRoomBox(b.serverRack, xf, 1.42, 0.36, 0.42, 0, 1.08, -0.1, -0.35, 0, 0);
      pushRoomBox(b.crtScreen, xf, 0.46, 0.24, 0.03, -0.34, 1.12, 0.12, -0.35, 0, 0);
      for (const cx of [0.16, 0.48]) {
        pushRoomCyl(b.bioFluid, xf, 0.11, 0.11, 0.72, 10, cx, 1.28, -0.14);
        pushRoomCyl(b.metalTrim, xf, 0.13, 0.13, 0.06, 10, cx, 1.66, -0.14);
      }
      break;
    }
  }
}

/**
 * Emite tapetes, pisos cerâmicos, piso antiestático de TI e terra musgosa nas Salas Especiais
 * para diferenciar visualmente o chão de cada ambiente assim que o jogador cruza a porta!
 */
function emitThemedRoomFloors(b: GeoBuckets): void {
  const rows = LABYRINTH_MAP.length;
  const cols = LABYRINTH_MAP[0].length;
  const tileSize = CELL_SIZE - 0.14;

  for (let gz = 1; gz < rows - 1; gz++) {
    for (let gx = 1; gx < cols - 1; gx++) {
      if (isSolidCell(LABYRINTH_MAP, gx, gz)) continue;
      const room = getThemedRoomAtCell(gx, gz);
      if (!room) continue;

      const w = gridCellToWorld(gx, gz);
      const xf: LocalXf = { cx: w.x, cz: w.z, yaw: 0 };

      switch (room.id) {
        case 'computer_room':
          pushRoomBox(b.techFloor, xf, tileSize, 0.016, tileSize, 0, 0.008, 0);
          break;
        case 'biology_lab':
        case 'medical_ward':
          pushRoomBox(b.labTile, xf, tileSize, 0.016, tileSize, 0, 0.008, 0);
          break;
        case 'library_room':
          pushRoomBox(b.libraryRug, xf, tileSize - 0.18, 0.018, tileSize - 0.18, 0, 0.009, 0);
          break;
        case 'vegetation_room':
          pushRoomBox(b.mossSoil, xf, tileSize - 0.1, 0.018, tileSize - 0.1, 0, 0.009, 0);
          break;
        case 'crew_quarters':
          pushRoomBox(b.oakWood, xf, tileSize - 0.24, 0.014, tileSize - 0.24, 0, 0.007, 0);
          break;
        default:
          break;
      }
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
 * Constrói todas as Salas Especiais 3D (pisos temáticos, mobiliário esculpido, iluminação própria e colisores sólidos).
 */
export function buildDoomThemedRooms(
  parentGroup: THREE.Group,
  placements: ReadonlyArray<RoomFurniturePlacement>,
  textures: DoomTextureSet,
  sharedUniforms: DoomSharedUniforms,
  colliders: StaticColliderBox[]
): void {
  const mats = createRoomMaterials(textures, sharedUniforms);
  const buckets: GeoBuckets = {
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

  emitThemedRoomFloors(buckets);

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
}
