import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { StaticColliderBox } from '../src/engine/physics/SpatialSweep';
import { SoundEngine } from '../src/engine/audio/SoundEngine';
import { DoomSpider } from '../src/doom/DoomSpider';
import { SpiderNavigationSpace, planSpiderObstaclePath } from '../src/doom/DoomSpiderNavigation';
import { DoomSpiderWebManager } from '../src/doom/DoomSpiderWebs';
import { createDoomSharedUniforms } from '../src/doom/DoomShader';
import { buildDoomLabyrinth, gridCellToWorld, LABYRINTH_MAP } from '../src/doom/DoomMazeBuilder';
import { createDoomTextures } from '../src/doom/DoomTextures';
import { createRandomArenaLayout } from '../src/doom/DoomArenaRandomizer';
import { isWalkableArenaCell, resetThemedRoomLocks } from '../src/doom/DoomRooms';

function openCell(): { x: number; z: number } {
  for (let z = 2; z < LABYRINTH_MAP.length - 2; z++) {
    for (let x = 2; x < LABYRINTH_MAP[z].length - 2; x++) {
      if (isWalkableArenaCell(x,z) && isWalkableArenaCell(x+1,z) && isWalkableArenaCell(x-1,z) &&
          isWalkableArenaCell(x,z+1) && isWalkableArenaCell(x,z-1)) return gridCellToWorld(x,z);
    }
  }
  throw new Error('Mapa sem área aberta para o teste');
}
function collider(id: string, x: number, z: number, width: number, depth: number, height = 1.4): StaticColliderBox {
  return { id, isObstacle: true, box: new THREE.Box3(new THREE.Vector3(x - width/2, 0, z - depth/2), new THREE.Vector3(x + width/2, height, z + depth/2)) };
}
const mockSound = {
  playSpiderFootstep() {}, playSpiderHiss() {}, playSpiderScream() {}, playSpiderStrike() {},
  playSpiderDragPull() {}, playSpiderWebSpin() {}, playWebTrapSnap() {}, playSpiderChitter() {},
} as unknown as SoundEngine;

function makeSpider(colliders: StaticColliderBox[]) {
  const scene = new THREE.Scene();
  const shared = createDoomSharedUniforms();
  const spider = new DoomSpider(scene, shared, colliders, new DoomSpiderWebManager(scene, shared), mockSound);
  return spider as any;
}

function distanceToBox(x: number, z: number, box: THREE.Box3): number {
  return Math.hypot(x - Math.max(box.min.x, Math.min(x, box.max.x)), z - Math.max(box.min.z, Math.min(z, box.max.z)));
}

describe('Navegação da aranha entre obstáculos', () => {
  it('planeja desvio no interior da mesma célula, sem cortar a caixa', () => {
    const c = openCell();
    const box = collider('caixote', c.x, c.z, 0.65, 0.65);
    const space = new SpiderNavigationSpace([box], 'FLOOR', 1.42);
    const start = { x: c.x - 1.2, z: c.z }, goal = { x: c.x + 1.2, z: c.z };
    expect(space.isSegmentClear(start, goal)).toBe(false);
    const path = planSpiderObstaclePath(space, start, goal);
    expect(path.length).toBeGreaterThan(1);
    let previous = start;
    for (const point of path) {
      expect(space.isSegmentClear(previous, point)).toBe(true);
      previous = point;
    }
    expect(previous).toEqual(goal);
  });

  it('persegue contornando objetos sem entrar neles nem teleportar', () => {
    const c = openCell();
    const box = collider('barril', c.x, c.z, 0.65, 0.65);
    const spider = makeSpider([box]);
    spider.placeAtCell(c.x - 1.2, c.z, 'FLOOR');
    const target = new THREE.Vector3(c.x + 1.2, 1.6, c.z);
    spider.alertToWebTrap(target, target);
    let maxStep = 0, caught = false;
    for (let i = 0; i < 360 && !caught; i++) {
      const prev = spider.position.clone();
      spider.update(1/60, i/60, target, 0, true, false, true, new THREE.Vector3(0,0,-1), [], () => { caught = true; });
      maxStep = Math.max(maxStep, Math.hypot(spider.position.x - prev.x, spider.position.z - prev.z));
      expect(distanceToBox(spider.position.x, spider.position.z, box.box)).toBeGreaterThanOrEqual(0.439);
    }
    expect(maxStep).toBeLessThan(0.28);
    expect(caught).toBe(true);
  });

  it('sai de um objeto que envolve o centro sem atravessar o cenário', () => {
    const c = openCell();
    const box = collider('móvel', c.x, c.z, 0.7, 0.7);
    const spider = makeSpider([box]);
    spider.position.set(c.x, 1.42, c.z);
    spider.surfaceMode = 'FLOOR';
    spider.resolveBodyMazeCollision();
    expect(distanceToBox(spider.position.x, spider.position.z, box.box)).toBeGreaterThanOrEqual(0.439);
  });

  it('se abaixa sob vigas baixas e continua a perseguição sem atravessá-las em pé', () => {
    const c = openCell();
    const beam = collider('viga-baixa', c.x, c.z, 0.55, 2.92, 2.14);
    beam.box.min.y = 1.18;
    beam.isCrawlUnder = true;
    const spider = makeSpider([beam]);
    spider.placeAtCell(c.x - 3.0, c.z, 'FLOOR');
    const target = new THREE.Vector3(c.x + 3.0, 1.6, c.z);
    spider.alertToWebTrap(target, target);
    let caught = false, lowest = 2, crossed = false;
    for (let i = 0; i < 360 && !caught; i++) {
      const prev = spider.position.clone();
      spider.update(1/60, i/60, target, 0, true, false, true, new THREE.Vector3(0,0,-1), [], () => { caught = true; });
      expect(Math.hypot(spider.position.x - prev.x, spider.position.z - prev.z)).toBeLessThan(0.28);
      lowest = Math.min(lowest, spider.position.y);
      if (distanceToBox(spider.position.x, spider.position.z, beam.box) < 0.43) {
        expect(spider.position.y + 0.52).toBeLessThanOrEqual(beam.box.min.y + 0.01);
      }
      if (spider.position.x > c.x + 0.8) crossed = true;
    }
    expect(lowest).toBeLessThan(0.70);
    expect(crossed).toBe(true);
    expect(caught).toBe(true);
  });

  it('considera a altura dos móveis no chão, na parede e no teto', () => {
    const c = openCell(), start = {x:c.x - 1.2, z:c.z}, end = {x:c.x + 1.2, z:c.z};
    const short = collider('mesa', c.x, c.z, 0.6, 0.6, 0.9);
    const tall = collider('armário', c.x, c.z, 0.6, 0.6, 2.5);
    expect(new SpiderNavigationSpace([short], 'FLOOR', 1.42).isSegmentClear(start, end)).toBe(false);
    expect(new SpiderNavigationSpace([short], 'CEILING', 2.12).isSegmentClear(start, end)).toBe(true);
    expect(new SpiderNavigationSpace([tall], 'CEILING', 2.12).isSegmentClear(start, end)).toBe(false);
    expect(new SpiderNavigationSpace([tall], 'WALL', 1.56).isSegmentClear(start, end)).toBe(false);
    const spider = makeSpider([tall]);
    spider.position.set(c.x - 0.5, 2.12, c.z);
    spider.surfaceMode = 'CEILING';
    spider.resolveBodyMazeCollision();
    expect(distanceToBox(spider.position.x, spider.position.z, tall.box)).toBeGreaterThanOrEqual(0.439);
  });

  it('planeja rotas seguras no labirinto e mobiliário gerados de verdade', () => {
    const scene = new THREE.Scene(), shared = createDoomSharedUniforms();
    const maze = buildDoomLabyrinth(scene, createDoomTextures(), shared, createRandomArenaLayout({worldSeed: 137}));
    try {
      const space = new SpiderNavigationSpace(maze.colliders, 'FLOOR', 1.42);
      const candidates: Array<{x:number; z:number}> = [];
      for (let gz = 1; gz < LABYRINTH_MAP.length - 1; gz++) {
        for (let gx = 1; gx < LABYRINTH_MAP[gz].length - 1; gx++) {
          const p = gridCellToWorld(gx, gz);
          if (space.isClear(p.x, p.z)) candidates.push(p);
        }
      }
      expect(candidates.length).toBeGreaterThan(50);
      for (let i = 0; i < 12; i++) {
        const start = candidates[(i * 79) % candidates.length];
        const goal = candidates[(i * 131 + 128) % candidates.length];
        const path = planSpiderObstaclePath(space, start, goal);
        expect(path.length).toBeGreaterThan(0);
        expect(Math.hypot(path.at(-1)!.x - goal.x, path.at(-1)!.z - goal.z)).toBeLessThan(0.01);
        let last = start;
        for (const point of path) {
          expect(space.isSegmentClear(last, point)).toBe(true);
          last = point;
        }
      }
    } finally { resetThemedRoomLocks(); }
  });

  it('se aproxima de um alvo inacessível sem atravessar o obstáculo', () => {
    const c = openCell(), goal = {x:c.x, z:c.z};
    const box = collider('objetivo bloqueado', c.x, c.z, 1, 1);
    const start = {x:c.x - 3.0, z:c.z};
    const space = new SpiderNavigationSpace([box], 'FLOOR', 1.42);
    const path = planSpiderObstaclePath(space, start, goal);
    expect(path.length).toBeGreaterThan(0);
    let last = start;
    for (const point of path) {
      expect(space.isSegmentClear(last, point)).toBe(true);
      last = point;
    }
    expect(Math.hypot(last.x - goal.x, last.z - goal.z)).toBeLessThan(3);
    expect(space.isClear(last.x, last.z)).toBe(true);
  });

  it('respeita as sete portas reais, liberando a passagem após a chave', () => {
    const scene = new THREE.Scene(), shared = createDoomSharedUniforms();
    const maze = buildDoomLabyrinth(scene, createDoomTextures(), shared, createRandomArenaLayout({worldSeed: 27}));
    try {
      for (const door of maze.specialRoomDoors.doors) {
        const room = door.room;
        const dx = room.outwardDir === 'E' ? 1 : room.outwardDir === 'W' ? -1 : 0;
        const dz = room.outwardDir === 'S' ? 1 : room.outwardDir === 'N' ? -1 : 0;
        const from = gridCellToWorld(room.innerGx, room.innerGz);
        const to = gridCellToWorld(room.doorGx + dx, room.doorGz + dz);
        expect(new SpiderNavigationSpace(maze.colliders, 'FLOOR', 1.42).isSegmentClear(from, to)).toBe(false);
        expect(maze.specialRoomDoors.unlockRoom(room.id)).toBe(true);
        expect(new SpiderNavigationSpace(maze.colliders, 'FLOOR', 1.42).isSegmentClear(from, to)).toBe(true);
      }
    } finally { resetThemedRoomLocks(); }
  });

  it('reage às portas dinâmicas sem entrar em salas trancadas', () => {
    const c = openCell();
    const door = collider('door', c.x, c.z, 0.6, 1.0, 3.2);
    door.isObstacle = false;
    const start = {x: c.x-1.2, z:c.z}, goal = {x:c.x+1.2,z:c.z};
    expect(new SpiderNavigationSpace([door], 'FLOOR', 1.42).isSegmentClear(start, goal)).toBe(false);
    door.box.min.set(0,60,0); door.box.max.set(0,60.05,0);
    expect(new SpiderNavigationSpace([door], 'FLOOR', 1.42).isSegmentClear(start, goal)).toBe(true);
  });
});
