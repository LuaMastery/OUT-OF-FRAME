import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { createRandomArenaLayout } from '../src/doom/DoomArenaRandomizer';
import { buildShotgunPickup, createShotgunPickupMaterials, type ShotgunPickupId } from '../src/doom/DoomShotgunPickups';
import { SHOTGUN_PART_IDS } from '../src/doom/DoomShotgun';
import { DoomWorldItems } from '../src/doom/DoomWorldItems';
import type { DoomInventory } from '../src/doom/DoomInventory';
import { buildDoomLabyrinth, gridCellToWorld } from '../src/doom/DoomMazeBuilder';
import { createDoomTextures } from '../src/doom/DoomTextures';
import { createDoomSharedUniforms } from '../src/doom/DoomShader';
import { getThemedRoomAtCell, getThemedRoomMiniMapTile, THEMED_ROOMS } from '../src/doom/DoomRooms';
import { sweepSegmentVsBox } from '../src/engine/physics/SpatialSweep';

const ids: ShotgunPickupId[] = [...SHOTGUN_PART_IDS, 'shotgun_shells'];

describe('Modelos das peças e cartuchos', () => {
  it('valida vértices, normais, apoios e dimensões de todos os modelos em quatro orientações', () => {
    const materials = createShotgunPickupMaterials();
    for (const id of ids) for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      const model = buildShotgunPickup(id, materials);
      model.rotation.y = yaw;
      model.updateMatrixWorld(true);
      const bounds = new THREE.Box3().setFromObject(model);
      expect(Math.abs(bounds.min.y)).toBeLessThan(.00001);
      expect(bounds.max.y).toBeLessThan(.15);
      expect(bounds.getSize(new THREE.Vector3()).length()).toBeLessThan(.5);
      let vertices = 0;
      model.traverse(node => {
        const mesh = node as THREE.Mesh;
        if (!mesh.isMesh) return;
        const pos = mesh.geometry.getAttribute('position');
        const normal = mesh.geometry.getAttribute('normal');
        expect(pos.count).toBeGreaterThan(0);
        expect(normal.count).toBe(pos.count);
        for (let i = 0; i < pos.count; i++) {
          for (const value of [pos.getX(i), pos.getY(i), pos.getZ(i), normal.getX(i), normal.getY(i), normal.getZ(i)])
            expect(Number.isFinite(value)).toBe(true);
        }
        vertices += pos.count;
      });
      expect(vertices).toBeGreaterThan(100);
    }
  });

  it('mantém cano e guarda-mão ocos, guarda-mato aberto e três cartuchos detalhados', () => {
    const materials = createShotgunPickupMaterials();
    const barrel = buildShotgunPickup('shotgun_barrel', materials);
    const pump = buildShotgunPickup('shotgun_pump', materials);
    expect(((barrel.getObjectByName('BarrelOuter') as THREE.Mesh).geometry as THREE.CylinderGeometry).parameters.openEnded).toBe(true);
    expect(((pump.getObjectByName('PumpBody') as THREE.Mesh).geometry as THREE.CylinderGeometry).parameters.openEnded).toBe(true);
    expect(barrel.getObjectByName('MuzzleRim')).toBeDefined();
    expect(pump.getObjectByName('PumpBore')).toBeDefined();
    const receiver = buildShotgunPickup('shotgun_receiver', materials);
    for (const name of ['EjectionPort', 'Bolt', 'GuardFront', 'GuardBottom', 'Trigger']) expect(receiver.getObjectByName(name)).toBeDefined();
    const shells = buildShotgunPickup('shotgun_shells', materials);
    for (const name of ['ShellHull', 'ShellBrass', 'ShellPrimer', 'ShellCrimp'])
      expect(shells.children.filter(node => node.name === name)).toHaveLength(3);
  });
});

describe('Peças nas salas especiais', () => {
  it('mantém posições determinísticas, acessíveis e fora das caixas em diversas partidas', () => {
    for (const seed of [1, 2, 3, 42, 91, 500, 9011, 75012, 123456]) {
      const layout = createRandomArenaLayout({ worldSeed: seed, playerSeed: 7 });
      const other = createRandomArenaLayout({ worldSeed: seed, playerSeed: 8 });
      expect(layout.shotgunRoomPlacements).toEqual(other.shotgunRoomPlacements);
      expect(new Set(layout.shotgunRoomPlacements.map(p => p.roomId)).size).toBe(4);
      expect(layout.cratePlacements.some(p => SHOTGUN_PART_IDS.some(id => id === p.itemId))).toBe(false);
      const scene = new THREE.Scene();
      const items = new DoomWorldItems(scene, createDoomSharedUniforms(), layout);
      const addItem = vi.fn(() => true);
      for (const p of layout.shotgunRoomPlacements) {
        expect(getThemedRoomAtCell(p.gx, p.gz)?.id).toBe(p.roomId);
        const pickup = items.getPickupsSnapshot().find(item => item.itemId === p.itemId)!;
        expect(pickup.position.x).toBe(gridCellToWorld(p.gx, p.gz).x);
        const group = scene.getObjectByName(`RoomShotgun_${p.itemId}`)!;
        expect(group).toBeDefined();
        expect(group.getObjectByName('ShotgunPickup_' + p.itemId)).toBeDefined();
        expect(group.children).toHaveLength(1); // sem caixote
        items.updateAndCheckPickups(.016, 0, pickup.position, pickup.position, new THREE.Vector3(0, 0, -1), false, {addItem} as unknown as DoomInventory);
        expect(addItem).toHaveBeenCalledWith(p.itemId, 1, false);
        expect(items.getPickupsSnapshot().find(item => item.itemId === p.itemId)?.collected).toBe(true);
      }
    }
  });

  it('mantém a munição sobre o forro e dentro das bordas das caixas, inclusive junto ao Taser', () => {
    for (const seed of [1, 42, 500, 9011, 75012]) {
      const layout = createRandomArenaLayout({ worldSeed: seed, playerSeed: 2 });
      const scene = new THREE.Scene();
      new DoomWorldItems(scene, createDoomSharedUniforms(), layout);
      scene.updateMatrixWorld(true);
      const shells: THREE.Object3D[] = [];
      scene.traverse(node => { if (node.name === 'ShotgunPickup_shotgun_shells') shells.push(node); });
      expect(shells.length).toBeGreaterThanOrEqual(2);
      for (const model of shells) {
        const crate = model.parent!.parent!;
        const inverse = crate.matrixWorld.clone().invert();
        const relative = new THREE.Matrix4().multiplyMatrices(inverse, model.matrixWorld);
        const box = new THREE.Box3();
        model.traverse(node => {
          const mesh = node as THREE.Mesh;
          if (!mesh.isMesh) return;
          mesh.geometry.computeBoundingBox();
          const local = new THREE.Matrix4().multiplyMatrices(relative, new THREE.Matrix4().multiplyMatrices(model.matrixWorld.clone().invert(), mesh.matrixWorld));
          box.union(mesh.geometry.boundingBox!.clone().applyMatrix4(local));
        });
        expect(box.min.y).toBeGreaterThanOrEqual(.094 - 1e-4);
        expect(box.max.y).toBeLessThan(.158);
        expect(Math.max(Math.abs(box.min.x), Math.abs(box.max.x))).toBeLessThan(.215);
        expect(Math.max(Math.abs(box.min.z), Math.abs(box.max.z))).toBeLessThan(.165);
      }
    }
  });

  it('tem rota livre de colisores reais a partir do vestíbulo de cada sala sorteada', () => {
    const layout = createRandomArenaLayout({ worldSeed: 42, playerSeed: 10 });
    const maze = buildDoomLabyrinth(new THREE.Scene(), createDoomTextures(), createDoomSharedUniforms(), layout);
    try {
      const placements = Array.from({ length: 12 }, (_, seed) =>
        createRandomArenaLayout({ worldSeed: seed + 1, playerSeed: 10 }).shotgunRoomPlacements
      ).flat();
      expect(new Set(placements.map(p => p.roomId)).size).toBeGreaterThanOrEqual(6);
      for (const p of placements) {
        const room = THEMED_ROOMS.find(r => r.id === p.roomId)!;
        const dx = room.outwardDir === 'E' ? 1 : room.outwardDir === 'W' ? -1 : 0;
        const dz = room.outwardDir === 'S' ? 1 : room.outwardDir === 'N' ? -1 : 0;
        const queue = [{gx: room.doorGx + dx, gz: room.doorGz + dz}];
        const seen = new Set<string>();
        let found = false;
        while (queue.length) {
          const cell = queue.shift()!;
          const key = `${cell.gx},${cell.gz}`;
          if (seen.has(key)) continue;
          seen.add(key);
          if (getThemedRoomAtCell(cell.gx, cell.gz)?.id !== room.id || getThemedRoomMiniMapTile(cell.gx, cell.gz) !== '.') continue;
          if (cell.gx === p.gx && cell.gz === p.gz) { found = true; break; }
          const a = gridCellToWorld(cell.gx, cell.gz);
          for (const [x, z] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const next = {gx: cell.gx + x, gz: cell.gz + z};
            if (getThemedRoomAtCell(next.gx, next.gz)?.id !== room.id || getThemedRoomMiniMapTile(next.gx, next.gz) !== '.') continue;
            const b = gridCellToWorld(next.gx, next.gz);
            const start = new THREE.Vector3(a.x, 1, a.z), end = new THREE.Vector3(b.x, 1, b.z);
            if (!maze.colliders.some(c => sweepSegmentVsBox(start, end, c.box, .52))) queue.push(next);
          }
        }
        expect(found, `rota até ${p.itemId} em ${p.roomId}`).toBe(true);
      }
    } finally { maze.specialRoomDoors.dispose(); }
  });
});
