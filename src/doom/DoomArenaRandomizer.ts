import * as THREE from 'three';
import {
  gridCellToWorld,
  isArchCell,
  isSolidCell,
  LABYRINTH_MAP,
  STONE_SECTOR_START_ROW,
} from './DoomMazeBuilder';

export interface GridCoord {
  gx: number;
  gz: number;
}

export interface CrateRandomPlacement {
  gx: number;
  gz: number;
  ox: number;
  oz: number;
  crateYaw: number;
  itemTiltYaw: number;
  radarJitterX: number;
  radarJitterZ: number;
  itemId: string;
}

export type InitialSpiderSurface = 'FLOOR' | 'WALL' | 'CEILING';

export interface DoomArenaLayout {
  readonly worldSeed: number;
  readonly playerSeed: number;
  readonly playerSpawnCell: GridCoord;
  readonly playerSpawnPosition: THREE.Vector3;
  readonly playerSpawnYaw: number;
  readonly lairCell: GridCoord;
  readonly dragStartCell: GridCoord;
  /** Vetor unitário 2D (no plano XZ) apontando de `dragStartCell` para `lairCell` */
  readonly dragDirection: THREE.Vector3;
  readonly spiderInitialSpawnCell: GridCoord;
  readonly spiderInitialSurfaceMode: InitialSpiderSurface;
  readonly spiderPostAbductionCell: GridCoord;
  readonly initialWebTrapCells: ReadonlyArray<GridCoord>;
  readonly cratePlacements: ReadonlyArray<CrateRandomPlacement>;
}

export interface CreateArenaLayoutOptions {
  /** Semente determinística para o mundo compartilhado (Ninho, Caixas, Itens, Teias). Se omitida, gera aleatória criptográfica. */
  worldSeed?: number;
  /** Semente independente para o ponto de spawn do jogador. Se omitida, deriva de nova entropia ou de `worldSeed`. */
  playerSeed?: number;
  /** Quantidade total de caixotes espalhados pela arena (padrão: 25). */
  crateCount?: number;
}

const SCENE_LAYOUT_USERDATA_KEY = 'doomArenaLayout';

/**
 * Gera uma semente inteira de 32 bits não-determinística de alta entropia a cada partida.
 */
export function createRandomArenaSeed(): number {
  if (
    typeof globalThis.crypto !== 'undefined' &&
    typeof globalThis.crypto.getRandomValues === 'function'
  ) {
    const buf = new Uint32Array(1);
    globalThis.crypto.getRandomValues(buf);
    return buf[0] >>> 0 || 0x9e3779b9;
  }
  const fallback =
    ((Math.random() * 0xffffffff) >>> 0) ^
    ((Date.now() & 0xffffffff) >>> 0);
  return fallback >>> 0 || 0x85ebca6b;
}

/**
 * Converte uma chave textual (ex.: código de sala multiplayer) em semente 32-bit reproduzível.
 */
export function hashArenaSeed(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0 || 1;
}

/**
 * PRNG rápido e uniforme de 32 bits (Mulberry32).
 */
export function createSeededRng(seed: number): () => number {
  let state = seed >>> 0 || 0x6d2b79f5;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function rngRange(rng: () => number, min: number, max: number): number {
  return min + rng() * (max - min);
}

function rngInt(rng: () => number, minInclusive: number, maxExclusive: number): number {
  if (maxExclusive <= minInclusive) return minInclusive;
  return minInclusive + Math.floor(rng() * (maxExclusive - minInclusive));
}

function shuffleInPlace<T>(arr: T[], rng: () => number): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

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

/**
 * Verifica se a célula no setor sul recebe esteios laterais de madeira (para não encostar caixotes neles).
 */
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

/**
 * Verifica se o teto de `(gx, gz)` possui vigas aéreas do Átrio ou plafons fixos,
 * garantindo que a luminária suspensa do Ninho da Aranha nunca cruze geometrias existentes.
 */
function hasFixedOverheadStructure(gx: number, gz: number): boolean {
  // Vigas cruzadas do Átrio Central em gx=14 (gz 9..13) e gz=11 (gx 10..18)
  if (gz === 11 && gx >= 10 && gx <= 18) return true;
  if (gx === 14 && gz >= 9 && gz <= 13) return true;
  // Barramento aéreo entre os núcleos de reator (22, 4..6)
  if (gx >= 21 && gx <= 23 && gz >= 3 && gz <= 6) return true;
  // Plafons fixos de teto
  const fixedFixtures: ReadonlyArray<[number, number]> = [
    [13, 10],
    [15, 10],
    [13, 12],
    [15, 12],
    [21, 3],
    [23, 3],
    [21, 5],
    [23, 5],
    [6, 4],
    [8, 4],
    [6, 19],
    [23, 21],
  ];
  for (const [fx, fz] of fixedFixtures) {
    if (fx === gx && fz === gz) return true;
  }
  return false;
}

interface LairChamberCandidate {
  lairCell: GridCoord;
  dragDirs: Array<{ dx: number; dz: number }>;
}

/**
 * Descobre todas as câmaras de encruzilhada 4-vias da arena onde o Grande Ninho 3D
 * ancora 100% nas 4 quinas sólidas diagonais e possui corredor reto de arrasto livre.
 */
export function findValidLairChambers(): LairChamberCandidate[] {
  const rows = LABYRINTH_MAP.length;
  const cols = LABYRINTH_MAP[0].length;
  const candidates: LairChamberCandidate[] = [];

  const cardinals: ReadonlyArray<{ dx: number; dz: number }> = [
    { dx: 0, dz: -1 },
    { dx: 0, dz: 1 },
    { dx: -1, dz: 0 },
    { dx: 1, dz: 0 },
  ];

  for (let gz = 2; gz < rows - 2; gz++) {
    for (let gx = 2; gx < cols - 2; gx++) {
      const ch = LABYRINTH_MAP[gz][gx];
      if (ch !== '.' && ch !== 'P') continue;
      if (hasFixedOverheadStructure(gx, gz)) continue;

      // Exige 4 quinas diagonais sólidas para ancoragem física dos mantos e casulos
      if (
        !isSolidCell(LABYRINTH_MAP, gx - 1, gz - 1) ||
        !isSolidCell(LABYRINTH_MAP, gx + 1, gz - 1) ||
        !isSolidCell(LABYRINTH_MAP, gx - 1, gz + 1) ||
        !isSolidCell(LABYRINTH_MAP, gx + 1, gz + 1)
      ) {
        continue;
      }

      // Exige as 4 saídas cardeais abertas para que o manto 3.75m x 3.75m nunca atravesse paredes
      const allFourOpen = cardinals.every(
        ({ dx, dz }) => !isSolidCell(LABYRINTH_MAP, gx + dx, gz + dz)
      );
      if (!allFourOpen) continue;

      // Direções de arrasto: 2 células livres atrás (`lair - 2*dir` -> `lair - dir` -> `lair`)
      // sem arcos estreitos no caminho do arrasto, e saída frontal (`lair + dir`) também aberta
      const validDragDirs: Array<{ dx: number; dz: number }> = [];
      for (const { dx, dz } of cardinals) {
        const startGx = gx - dx * 2;
        const startGz = gz - dz * 2;
        const midGx = gx - dx;
        const midGz = gz - dz;
        const beyondGx = gx + dx;
        const beyondGz = gz + dz;

        if (
          !isSolidCell(LABYRINTH_MAP, startGx, startGz) &&
          !isSolidCell(LABYRINTH_MAP, midGx, midGz) &&
          !isSolidCell(LABYRINTH_MAP, beyondGx, beyondGz) &&
          !isArchCell(LABYRINTH_MAP, startGx, startGz) &&
          !isArchCell(LABYRINTH_MAP, midGx, midGz)
        ) {
          validDragDirs.push({ dx, dz });
        }
      }

      if (validDragDirs.length > 0) {
        candidates.push({
          lairCell: { gx, gz },
          dragDirs: validDragDirs,
        });
      }
    }
  }

  return candidates;
}

/**
 * Verifica se duas células possuem linha reta desobstruída no mesmo eixo (para evitar que
 * a aranha enxergue o jogador instantaneamente no primeiro milissegundo de jogo).
 */
function hasDirectGridSightline(a: GridCoord, b: GridCoord): boolean {
  if (a.gx === b.gx) {
    const minZ = Math.min(a.gz, b.gz);
    const maxZ = Math.max(a.gz, b.gz);
    for (let z = minZ; z <= maxZ; z++) {
      if (isSolidCell(LABYRINTH_MAP, a.gx, z)) return false;
    }
    return true;
  }
  if (a.gz === b.gz) {
    const minX = Math.min(a.gx, b.gx);
    const maxX = Math.max(a.gx, b.gx);
    for (let x = minX; x <= maxX; x++) {
      if (isSolidCell(LABYRINTH_MAP, x, a.gz)) return false;
    }
    return true;
  }
  return false;
}

/**
 * Monta o pool aleatório de itens que aparecerão nas caixas da partida:
 * - Garante os 5 equipamentos/documentos únicos essenciais em caixas imprevisíveis;
 * - Sorteia aleatoriamente a composição dos demais caixotes entre baterias, gazes,
 *   sinalizadores de magnésio e frascos de láudano (com piso mínimo de segurança);
 * - Embaralha tudo com Fisher-Yates para que qualquer caixa possa conter qualquer item!
 */
export function buildRandomCrateLootPool(
  totalCrates: number,
  rng: () => number
): string[] {
  const uniqueEssentials = [
    'field_radar',
    'rusty_knife',
    'sector_b_key',
    'torn_log_04',
    'arachnid_report_09',
  ];

  const pool: string[] = [];
  for (const id of uniqueEssentials) {
    if (pool.length < totalCrates) {
      pool.push(id);
    }
  }

  // Piso mínimo de sobrevivência (1 de cada suprimento consumível antes da rolagem livre)
  const consumableTypes = [
    'industrial_battery',
    'sterile_bandage',
    'magnesium_flare',
    'old_morphine',
  ];
  for (const cId of consumableTypes) {
    if (pool.length < totalCrates) {
      pool.push(cId);
    }
  }

  // Todos os caixotes restantes são sorteados livremente por pesos aleatórios a cada run!
  const weightedTable: ReadonlyArray<{ itemId: string; weight: number }> = [
    { itemId: 'industrial_battery', weight: 0.31 },
    { itemId: 'sterile_bandage', weight: 0.27 },
    { itemId: 'magnesium_flare', weight: 0.23 },
    { itemId: 'old_morphine', weight: 0.19 },
  ];

  while (pool.length < totalCrates) {
    const r = rng();
    let acc = 0;
    let picked = weightedTable[0].itemId;
    for (const entry of weightedTable) {
      acc += entry.weight;
      if (r <= acc) {
        picked = entry.itemId;
        break;
      }
    }
    pool.push(picked);
  }

  return shuffleInPlace(pool, rng);
}

/**
 * Escolhe uma célula aberta aleatória na arena a pelo menos `minDistMeters` de `(originX, originZ)`.
 */
export function pickRandomWalkableCellFarFrom(
  originX: number,
  originZ: number,
  minDistMeters = 22.0,
  rng: () => number = Math.random
): GridCoord {
  const spaciousCandidates: GridCoord[] = [];
  const allCandidates: GridCoord[] = [];
  let fallbackBest: GridCoord = { gx: 21, gz: 5 };
  let fallbackBestDist = -1;

  for (let gz = 1; gz < LABYRINTH_MAP.length - 1; gz++) {
    for (let gx = 1; gx < LABYRINTH_MAP[gz].length - 1; gx++) {
      const ch = LABYRINTH_MAP[gz][gx];
      if (ch !== '.' && ch !== 'P') continue;
      if (isNearReactorCollar(gx, gz)) continue;

      const openSpanX =
        !isSolidCell(LABYRINTH_MAP, gx - 1, gz) &&
        !isSolidCell(LABYRINTH_MAP, gx + 1, gz);

      const w = gridCellToWorld(gx, gz);
      const d = Math.hypot(w.x - originX, w.z - originZ);
      if (d > fallbackBestDist && openSpanX) {
        fallbackBestDist = d;
        fallbackBest = { gx, gz };
      }
      if (d >= minDistMeters) {
        allCandidates.push({ gx, gz });
        if (openSpanX) {
          spaciousCandidates.push({ gx, gz });
        }
      }
    }
  }

  if (spaciousCandidates.length > 0) {
    return spaciousCandidates[rngInt(rng, 0, spaciousCandidates.length)];
  }
  if (allCandidates.length > 0) {
    return allCandidates[rngInt(rng, 0, allCandidates.length)];
  }
  return fallbackBest;
}

/**
 * Gera todo o layout dinâmico aleatório da partida mantendo o mapa 29x29 (`LABYRINTH_MAP`) fixo:
 * - Câmara aleatória para o Grande Ninho da Aranha + corredor de arrasto;
 * - Ponto aleatório seguro na arena para o Spawn do Jogador + direção inicial;
 * - Ponto e superfície aleatórios para o Spawn Inicial da Aranha Gigante e seu recuo;
 * - Pontos aleatórios para as armadilhas iniciais de teia;
 * - Pontos aleatórios encostados às paredes para os caixotes + itens sorteados aleatoriamente!
 */
export function createRandomArenaLayout(
  options: CreateArenaLayoutOptions = {}
): DoomArenaLayout {
  const worldSeed =
    options.worldSeed !== undefined
      ? options.worldSeed >>> 0 || 1
      : createRandomArenaSeed();
  const worldRng = createSeededRng(worldSeed);

  const playerSeed =
    options.playerSeed !== undefined
      ? options.playerSeed >>> 0 || 1
      : options.worldSeed !== undefined
        ? (worldSeed ^ 0x9e3779b9) >>> 0 || 2
        : createRandomArenaSeed();
  const playerRng = createSeededRng(playerSeed);

  const crateCount = options.crateCount ?? 25;

  // 1. Sorteia a câmara do Grande Ninho da Aranha e a direção do corredor de arrasto
  const lairChambers = findValidLairChambers();
  const chosenLair =
    lairChambers.length > 0
      ? lairChambers[rngInt(worldRng, 0, lairChambers.length)]
      : {
          lairCell: { gx: 14, gz: 23 },
          dragDirs: [{ dx: 0, dz: 1 }],
        };
  const chosenDragDir =
    chosenLair.dragDirs[rngInt(worldRng, 0, chosenLair.dragDirs.length)];
  const lairCell = chosenLair.lairCell;
  const dragMidCell: GridCoord = {
    gx: lairCell.gx - chosenDragDir.dx,
    gz: lairCell.gz - chosenDragDir.dz,
  };
  const dragStartCell: GridCoord = {
    gx: lairCell.gx - chosenDragDir.dx * 2,
    gz: lairCell.gz - chosenDragDir.dz * 2,
  };
  const dragDirection = new THREE.Vector3(
    chosenDragDir.dx,
    0,
    chosenDragDir.dz
  ).normalize();

  const reservedLairKeys = new Set<string>([
    `${lairCell.gx},${lairCell.gz}`,
    `${dragMidCell.gx},${dragMidCell.gz}`,
    `${dragStartCell.gx},${dragStartCell.gz}`,
    `${lairCell.gx + chosenDragDir.dx},${lairCell.gz + chosenDragDir.dz}`,
  ]);

  // 2. Sorteia as armadilhas iniciais de teia exclusivamente por `worldSeed` (sincronizadas no Co-op!)
  const trapCount = rngInt(worldRng, 6, 9); // 6 a 8 armadilhas iniciais
  const allOpenTrapCandidates: GridCoord[] = [];
  for (let gz = 1; gz < LABYRINTH_MAP.length - 1; gz++) {
    for (let gx = 1; gx < LABYRINTH_MAP[gz].length - 1; gx++) {
      if (isSolidCell(LABYRINTH_MAP, gx, gz)) continue;
      if (reservedLairKeys.has(`${gx},${gz}`)) continue;
      if (Math.hypot(gx - lairCell.gx, gz - lairCell.gz) < 3.0) continue;
      allOpenTrapCandidates.push({ gx, gz });
    }
  }
  shuffleInPlace(allOpenTrapCandidates, worldRng);

  const initialWebTrapCells: GridCoord[] = [];
  for (const cand of allOpenTrapCandidates) {
    if (initialWebTrapCells.length >= trapCount) break;
    const tooClose = initialWebTrapCells.some(
      (t) => Math.hypot(t.gx - cand.gx, t.gz - cand.gz) < 3.8
    );
    if (!tooClose) {
      initialWebTrapCells.push(cand);
    }
  }

  // 3. Sorteia os pontos aleatórios dos Caixotes de Suprimentos + Itens exclusivamente por `worldSeed`
  interface WallSlotCandidate {
    gx: number;
    gz: number;
    walls: Array<{ nx: number; nz: number }>;
  }
  const crateCellCandidates: WallSlotCandidate[] = [];

  for (let gz = 1; gz < LABYRINTH_MAP.length - 1; gz++) {
    for (let gx = 1; gx < LABYRINTH_MAP[gz].length - 1; gx++) {
      const ch = LABYRINTH_MAP[gz][gx];
      if (ch !== '.' && ch !== 'P') continue;
      if (isNearReactorCollar(gx, gz)) continue;
      if (reservedLairKeys.has(`${gx},${gz}`)) continue;

      const timberAxis = getTimberPostAxis(gx, gz);
      const validWalls: Array<{ nx: number; nz: number }> = [];

      for (const [nx, nz] of [
        [0, -1],
        [0, 1],
        [-1, 0],
        [1, 0],
      ] as const) {
        const adjGx = gx + nx;
        const adjGz = gz + nz;
        if (adjGz < 0 || adjGz >= LABYRINTH_MAP.length) continue;
        if (adjGx < 0 || adjGx >= LABYRINTH_MAP[adjGz].length) continue;
        const adjCh = LABYRINTH_MAP[adjGz][adjGx];
        if (adjCh !== '#' && adjCh !== 'B') continue;
        if (timberAxis === 'WE' && nx !== 0) continue;
        if (timberAxis === 'NS' && nz !== 0) continue;
        validWalls.push({ nx, nz });
      }

      if (validWalls.length > 0) {
        crateCellCandidates.push({ gx, gz, walls: validWalls });
      }
    }
  }

  shuffleInPlace(crateCellCandidates, worldRng);

  // Seleção em duas passagens: prioriza bom espaçamento (>= 2.2 células) e completa se necessário
  const selectedCrateCells: WallSlotCandidate[] = [];
  const usedCrateKeys = new Set<string>();

  for (const minCellSpacing of [2.2, 1.0]) {
    for (const cand of crateCellCandidates) {
      if (selectedCrateCells.length >= crateCount) break;
      const key = `${cand.gx},${cand.gz}`;
      if (usedCrateKeys.has(key)) continue;
      const tooClose = selectedCrateCells.some(
        (s) => Math.hypot(s.gx - cand.gx, s.gz - cand.gz) < minCellSpacing
      );
      if (!tooClose) {
        selectedCrateCells.push(cand);
        usedCrateKeys.add(key);
      }
    }
  }

  const lootPool = buildRandomCrateLootPool(selectedCrateCells.length, worldRng);
  const cratePlacements: CrateRandomPlacement[] = selectedCrateCells.map(
    (slot, idx) => {
      const wall = slot.walls[rngInt(worldRng, 0, slot.walls.length)];
      const wallDepth = rngRange(worldRng, 0.48, 0.56);
      const alongWall = rngRange(worldRng, -0.36, 0.36);

      // Vetor tangente paralelo à parede (-nz, nx)
      const tx = -wall.nz;
      const tz = wall.nx;
      const ox = wall.nx * wallDepth + tx * alongWall;
      const oz = wall.nz * wallDepth + tz * alongWall;

      // Frente da bandeja aponta para dentro do corredor aberto (-wall.nx, -wall.nz)
      const crateYaw =
        Math.atan2(-wall.nx, -wall.nz) + rngRange(worldRng, -0.14, 0.14);

      return {
        gx: slot.gx,
        gz: slot.gz,
        ox,
        oz,
        crateYaw,
        itemTiltYaw: rngRange(worldRng, -0.22, 0.22),
        radarJitterX: rngRange(worldRng, -0.42, 0.42),
        radarJitterZ: rngRange(worldRng, -0.42, 0.42),
        itemId: lootPool[idx],
      };
    }
  );

  const lairWorld = gridCellToWorld(lairCell.gx, lairCell.gz);
  const spiderPostAbductionCell = pickRandomWalkableCellFarFrom(
    lairWorld.x,
    lairWorld.z,
    24.0,
    worldRng
  );

  // 4. Sorteia o ponto seguro de Spawn do Jogador por `playerSeed` (livre de Ninho, Teias e Caixotes!)
  const spawnCandidates: GridCoord[] = [];
  for (let gz = 1; gz < LABYRINTH_MAP.length - 1; gz++) {
    for (let gx = 1; gx < LABYRINTH_MAP[gz].length - 1; gx++) {
      const ch = LABYRINTH_MAP[gz][gx];
      if (ch !== '.' && ch !== 'P') continue;
      if (isNearReactorCollar(gx, gz)) continue;
      if (reservedLairKeys.has(`${gx},${gz}`)) continue;
      if (usedCrateKeys.has(`${gx},${gz}`)) continue;

      const distCellsToLair = Math.hypot(gx - lairCell.gx, gz - lairCell.gz);
      if (distCellsToLair < 4.0) continue;

      const nearWebTrap = initialWebTrapCells.some(
        (t) => Math.hypot(t.gx - gx, t.gz - gz) < 2.6
      );
      if (nearWebTrap) continue;

      spawnCandidates.push({ gx, gz });
    }
  }

  const playerSpawnCell =
    spawnCandidates.length > 0
      ? spawnCandidates[rngInt(playerRng, 0, spawnCandidates.length)]
      : { gx: 2, gz: 1 };

  const spawnCellWorld = gridCellToWorld(
    playerSpawnCell.gx,
    playerSpawnCell.gz
  );
  const spawnSubOx = rngRange(playerRng, -0.26, 0.26);
  const spawnSubOz = rngRange(playerRng, -0.26, 0.26);
  const playerSpawnPosition = new THREE.Vector3(
    spawnCellWorld.x + spawnSubOx,
    0,
    spawnCellWorld.z + spawnSubOz
  );

  // Orienta o olhar inicial do jogador para um corredor aberto adjacente (nunca de cara na parede!)
  const openFacingDirs: Array<{ dx: number; dz: number }> = [];
  for (const [dx, dz] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const) {
    if (
      !isSolidCell(
        LABYRINTH_MAP,
        playerSpawnCell.gx + dx,
        playerSpawnCell.gz + dz
      )
    ) {
      openFacingDirs.push({ dx, dz });
    }
  }
  const facingDir =
    openFacingDirs.length > 0
      ? openFacingDirs[rngInt(playerRng, 0, openFacingDirs.length)]
      : { dx: 1, dz: 0 };
  const playerSpawnYaw =
    Math.atan2(-facingDir.dx, -facingDir.dz) + rngRange(playerRng, -0.18, 0.18);

  // 5. Sorteia o ponto inicial da Aranha Gigante em salão/galeria ampla (longe >= 18m do jogador e sem visão reta)
  const spaciousSpiderCandidates: GridCoord[] = [];
  const allSpiderCandidates: GridCoord[] = [];
  for (let gz = 1; gz < LABYRINTH_MAP.length - 1; gz++) {
    for (let gx = 1; gx < LABYRINTH_MAP[gz].length - 1; gx++) {
      const ch = LABYRINTH_MAP[gz][gx];
      if (ch !== '.' && ch !== 'P') continue;
      if (isNearReactorCollar(gx, gz)) continue;

      const w = gridCellToWorld(gx, gz);
      const distToPlayer = Math.hypot(
        w.x - playerSpawnPosition.x,
        w.z - playerSpawnPosition.z
      );
      if (distToPlayer < 18.0) continue;
      if (hasDirectGridSightline({ gx, gz }, playerSpawnCell)) continue;
      allSpiderCandidates.push({ gx, gz });
      if (
        !isSolidCell(LABYRINTH_MAP, gx - 1, gz) &&
        !isSolidCell(LABYRINTH_MAP, gx + 1, gz)
      ) {
        spaciousSpiderCandidates.push({ gx, gz });
      }
    }
  }

  const spiderRng = createSeededRng((worldSeed ^ playerSeed ^ 0xa5a5a5a5) >>> 0 || 7);
  const spiderPool =
    spaciousSpiderCandidates.length > 0
      ? spaciousSpiderCandidates
      : allSpiderCandidates;
  const spiderInitialSpawnCell =
    spiderPool.length > 0
      ? spiderPool[rngInt(spiderRng, 0, spiderPool.length)]
      : pickRandomWalkableCellFarFrom(
          playerSpawnPosition.x,
          playerSpawnPosition.z,
          18.0,
          spiderRng
        );

  const hasAdjacentClimbWall = [
    [0, -1],
    [0, 1],
    [-1, 0],
    [1, 0],
  ].some(([dx, dz]) =>
    isSolidCell(
      LABYRINTH_MAP,
      spiderInitialSpawnCell.gx + dx,
      spiderInitialSpawnCell.gz + dz
    )
  );
  const modeRoll = spiderRng();
  const spiderInitialSurfaceMode: InitialSpiderSurface =
    modeRoll < 0.52
      ? 'CEILING'
      : modeRoll < 0.8 && hasAdjacentClimbWall
        ? 'WALL'
        : 'FLOOR';

  return {
    worldSeed,
    playerSeed,
    playerSpawnCell,
    playerSpawnPosition,
    playerSpawnYaw,
    lairCell,
    dragStartCell,
    dragDirection,
    spiderInitialSpawnCell,
    spiderInitialSurfaceMode,
    spiderPostAbductionCell,
    initialWebTrapCells,
    cratePlacements,
  };
}

/**
 * Obtém (ou cria e registra em `scene.userData`) o `DoomArenaLayout` associado a uma cena 3D,
 * garantindo que Labirinto, Caixotes, Teias e Aranha na mesma cena usem sempre pontos coerentes.
 */
export function getOrCreateSceneArenaLayout(
  scene: THREE.Scene,
  explicitLayout?: DoomArenaLayout
): DoomArenaLayout {
  if (explicitLayout) {
    scene.userData[SCENE_LAYOUT_USERDATA_KEY] = explicitLayout;
    return explicitLayout;
  }
  const existing = scene.userData[SCENE_LAYOUT_USERDATA_KEY] as
    | DoomArenaLayout
    | undefined;
  if (existing) {
    return existing;
  }
  const fresh = createRandomArenaLayout();
  scene.userData[SCENE_LAYOUT_USERDATA_KEY] = fresh;
  return fresh;
}
