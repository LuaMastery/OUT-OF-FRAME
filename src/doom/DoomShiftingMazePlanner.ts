/** A cell in the fixed core map (the seven external annexes are not modified). */
export interface ShiftingMazeCell {
  gx: number;
  gz: number;
}

export interface ShiftingMazePlanOptions {
  /** Cells that must remain open, including occupied cells and objective routes. */
  protectedCells: ReadonlyArray<ShiftingMazeCell>;
  /** Number of whole-cell closures to attempt. A smaller safe set may be returned. */
  maxClosures: number;
  /** Deterministic random source supplied by the caller. */
  random: () => number;
}

const key = (x: number, z: number): string => `${x},${z}`;
const neighbors = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;

function isOpen(grid: readonly string[], x: number, z: number): boolean {
  if (z < 0 || z >= grid.length || x < 0 || x >= grid[z].length) return false;
  const cell = grid[z][x];
  return cell !== '#' && cell !== 'B' && cell !== 'M' && cell !== 'L';
}

/**
 * Plans closures only when all other originally open core cells remain connected.
 * Pure planning only: callers must still coordinate a safe, authoritative world
 * transition, collision meshes, AI navigation, radar, and late-joining clients.
 */
export function planShiftingMazeClosures(
  grid: readonly string[],
  options: ShiftingMazePlanOptions
): ShiftingMazeCell[] {
  const protectedKeys = new Set(options.protectedCells.map(c => key(c.gx, c.gz)));
  const openCells: ShiftingMazeCell[] = [];
  const candidates: ShiftingMazeCell[] = [];
  for (let z = 0; z < grid.length; z++) {
    for (let x = 0; x < grid[z].length; x++) {
      if (!isOpen(grid, x, z)) continue;
      const cell = { gx: x, gz: z };
      openCells.push(cell);
      // Never replace arches, the spawn marker, or an outer/perimeter cell.
      if (grid[z][x] === '.' && x > 0 && z > 0 &&
          z < grid.length - 1 && x < grid[z].length - 1 &&
          !protectedKeys.has(key(x, z))) candidates.push(cell);
    }
  }
  if (openCells.length === 0) return [];

  const blocked = new Set<string>();
  const connected = (): boolean => {
    const start = openCells.find(c => !blocked.has(key(c.gx, c.gz)));
    if (!start) return false;
    const seen = new Set<string>([key(start.gx, start.gz)]);
    const queue = [start];
    for (let i = 0; i < queue.length; i++) {
      const cell = queue[i];
      for (const [dx, dz] of neighbors) {
        const x = cell.gx + dx, z = cell.gz + dz;
        const k = key(x, z);
        if (!seen.has(k) && !blocked.has(k) && isOpen(grid, x, z)) {
          seen.add(k);
          queue.push({ gx: x, gz: z });
        }
      }
    }
    return seen.size === openCells.length - blocked.size;
  };
  // Do not claim to preserve connectivity if the supplied map is already split.
  if (!connected()) return [];
  for (let i = candidates.length - 1; i > 0; i--) {
    const r = options.random();
    const bounded = Number.isFinite(r) ? Math.max(0, Math.min(0.999999999, r)) : 0;
    const j = Math.floor(bounded * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }
  const result: ShiftingMazeCell[] = [];
  const max = Number.isFinite(options.maxClosures) ? Math.max(0, Math.floor(options.maxClosures)) : 0;
  for (const cell of candidates) {
    if (result.length >= max) break;
    const k = key(cell.gx, cell.gz);
    blocked.add(k);
    if (connected()) result.push(cell);
    else blocked.delete(k);
  }
  return result;
}
