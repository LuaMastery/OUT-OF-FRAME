import type { StaticColliderBox } from '../engine/physics/SpatialSweep';
import { CELL_SIZE, gridCellToWorld, worldToGridCell } from './DoomMazeBuilder';
import { ANNEX_MAX_GRID, ANNEX_MIN_GRID, isWalkableArenaCell } from './DoomRooms';

export type SpiderNavigationSurface = 'FLOOR' | 'WALL' | 'CEILING';
export interface SpiderNavPoint { x: number; z: number }

/** Vigas de passagem são tratadas separadamente pela postura de rastejo. */
export function spiderColliderBlocks(col: StaticColliderBox, surface: SpiderNavigationSurface, bodyY: number): boolean {
  if (col.isCrawlUnder) return false;
  const box = col.box;
  if (box.max.y < 0.5 || box.min.y > bodyY + 0.45) return false;
  if (col.isObstacle && surface !== 'FLOOR' && box.max.y < bodyY - 0.45) return false;
  return true;
}

/** Índice local reconstruído ao planejar: portas e colisores alterados são sempre consultados no estado atual. */
export class SpiderNavigationSpace {
  private readonly buckets = new Map<string, StaticColliderBox[]>();
  constructor(colliders: readonly StaticColliderBox[], private readonly surface: SpiderNavigationSurface, private readonly bodyY: number) {
    for (const col of colliders) {
      if (!spiderColliderBlocks(col, surface, bodyY)) continue;
      const b = col.box;
      const minX = Math.floor((b.min.x - 0.65) / CELL_SIZE);
      const maxX = Math.floor((b.max.x + 0.65) / CELL_SIZE);
      const minZ = Math.floor((b.min.z - 0.65) / CELL_SIZE);
      const maxZ = Math.floor((b.max.z + 0.65) / CELL_SIZE);
      for (let x = minX; x <= maxX; x++) for (let z = minZ; z <= maxZ; z++) {
        const key = `${x},${z}`;
        let list = this.buckets.get(key);
        if (!list) this.buckets.set(key, list = []);
        list.push(col);
      }
    }
  }

  isClear(x: number, z: number): boolean {
    const cell = worldToGridCell(x, z);
    if (!isWalkableArenaCell(cell.gx, cell.gz)) return false;
    const nearby = this.buckets.get(`${Math.floor(x / CELL_SIZE)},${Math.floor(z / CELL_SIZE)}`);
    if (!nearby) return true;
    for (const col of nearby) {
      // A porta pode ter sido aberta depois da construção do índice.
      if (!spiderColliderBlocks(col, this.surface, this.bodyY)) continue;
      const b = col.box;
      const cx = Math.max(b.min.x, Math.min(x, b.max.x));
      const cz = Math.max(b.min.z, Math.min(z, b.max.z));
      const radius = col.isObstacle ? 0.48 : 0.59;
      if ((x - cx) ** 2 + (z - cz) ** 2 < radius ** 2) return false;
    }
    return true;
  }

  isSegmentClear(a: SpiderNavPoint, b: SpiderNavPoint): boolean {
    const d = Math.hypot(b.x - a.x, b.z - a.z);
    const steps = Math.max(1, Math.ceil(d / 0.18));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      if (!this.isClear(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t)) return false;
    }
    return true;
  }
}

interface QueueEntry { id: number; score: number }
class MinHeap {
  private readonly values: QueueEntry[] = [];
  push(entry: QueueEntry): void {
    const values = this.values;
    let i = values.length;
    values.push(entry);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (values[p].score <= entry.score) break;
      values[i] = values[p]; i = p;
    }
    values[i] = entry;
  }
  pop(): QueueEntry | undefined {
    const values = this.values;
    if (!values.length) return undefined;
    const first = values[0];
    const last = values.pop()!;
    if (values.length) {
      let i = 0;
      while (i * 2 + 1 < values.length) {
        let child = i * 2 + 1;
        if (child + 1 < values.length && values[child + 1].score < values[child].score) child++;
        if (values[child].score >= last.score) break;
        values[i] = values[child]; i = child;
      }
      values[i] = last;
    }
    return first;
  }
}

/** A* em subcélulas de 1m; também encontra rotas quando origem e alvo estão na mesma célula. */
export function planSpiderObstaclePath(space: SpiderNavigationSpace, start: SpiderNavPoint, goal: SpiderNavPoint): SpiderNavPoint[] {
  if (space.isSegmentClear(start, goal)) return [{ ...goal }];
  const span = (ANNEX_MAX_GRID - ANNEX_MIN_GRID + 1) * 3;
  const first = gridCellToWorld(ANNEX_MIN_GRID, ANNEX_MIN_GRID);
  const originX = first.x - 1;
  const originZ = first.z - 1;
  const count = span * span;
  const costs = new Float64Array(count); costs.fill(Infinity);
  const parents = new Int32Array(count); parents.fill(-1);
  const closed = new Uint8Array(count);
  const clearance = new Int8Array(count);
  const heap = new MinHeap();
  const point = (id: number): SpiderNavPoint => ({ x: originX + id % span, z: originZ + Math.floor(id / span) });
  const heuristic = (x: number, z: number) => Math.hypot(goal.x - x, goal.z - z);
  const clearNode = (id: number, x: number, z: number): boolean => {
    if (clearance[id] === 0) clearance[id] = space.isClear(x, z) ? 1 : -1;
    return clearance[id] === 1;
  };
  const goalClear = space.isClear(goal.x, goal.z);
  const sx = Math.round(start.x - originX), sz = Math.round(start.z - originZ);

  // Várias conexões de entrada evitam escolher o centro de célula ocupado por um objeto.
  for (let z = Math.max(0, sz - 2); z <= Math.min(span - 1, sz + 2); z++) {
    for (let x = Math.max(0, sx - 2); x <= Math.min(span - 1, sx + 2); x++) {
      const p = { x: originX + x, z: originZ + z };
      const d = Math.hypot(p.x - start.x, p.z - start.z);
      const id = z * span + x;
      if (d > 2.1 || !clearNode(id, p.x, p.z) || !space.isSegmentClear(start, p)) continue;
      costs[id] = d; heap.push({ id, score: d + heuristic(p.x, p.z) });
    }
  }

  let best = -1, bestDistance = Infinity, goalNode = -1;
  const directions = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];
  for (let entry = heap.pop(); entry; entry = heap.pop()) {
    const id = entry.id;
    if (closed[id]) continue;
    closed[id] = 1;
    const p = point(id), h = heuristic(p.x, p.z);
    if (h < bestDistance) { best = id; bestDistance = h; }
    if (goalClear && h <= 1.5 && space.isSegmentClear(p, goal)) { goalNode = id; break; }
    const x = id % span, z = Math.floor(id / span);
    for (const [dx, dz] of directions) {
      const nx = x + dx, nz = z + dz;
      if (nx < 0 || nx >= span || nz < 0 || nz >= span) continue;
      const next = nz * span + nx;
      if (closed[next]) continue;
      const np = { x: originX + nx, z: originZ + nz };
      const nextCost = costs[id] + (dx && dz ? Math.SQRT2 : 1);
      if (nextCost >= costs[next] || !clearNode(next, np.x, np.z) || !space.isSegmentClear(p, np)) continue;
      costs[next] = nextCost;
      parents[next] = id;
      heap.push({ id: next, score: nextCost + heuristic(np.x, np.z) });
    }
  }
  let current = goalNode >= 0 ? goalNode : best;
  if (current < 0) return [];
  const path: SpiderNavPoint[] = [];
  while (current >= 0) { path.push(point(current)); current = parents[current]; }
  path.reverse();
  if (goalNode >= 0) path.push({ ...goal });

  // Remove pontos intermediários somente se o cilindro percorrer o atalho inteiro sem colisão.
  const result: SpiderNavPoint[] = [];
  let from = start;
  for (let i = 0; i < path.length;) {
    let furthest = i;
    for (let j = i + 1; j < path.length; j++) {
      if (!space.isSegmentClear(from, path[j])) break;
      furthest = j;
    }
    result.push(path[furthest]); from = path[furthest]; i = furthest + 1;
  }
  return result;
}
