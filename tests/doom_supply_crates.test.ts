import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { createRandomArenaLayout } from '../src/doom/DoomArenaRandomizer';
import { buildDoomLabyrinth, gridCellToWorld } from '../src/doom/DoomMazeBuilder';
import { createDoomTextures } from '../src/doom/DoomTextures';
import { createDoomSharedUniforms } from '../src/doom/DoomShader';
import {
  CRATE_LID_CLOSED_ROTATION,
  CRATE_LID_OPEN_ROTATION,
  DoomWorldItems,
} from '../src/doom/DoomWorldItems';
import { resolveCylinderWorldCollisions, sweepSegmentVsBox } from '../src/engine/physics/SpatialSweep';
import type { DoomInventory } from '../src/doom/DoomInventory';

describe('Estojos de suprimentos sobre obstáculos', () => {
  it('seleciona suportes reais, elevados e determinísticos em diversas partidas', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const a = createRandomArenaLayout({ worldSeed: seed, playerSeed: 1 });
      const b = createRandomArenaLayout({ worldSeed: seed, playerSeed: 2, isMultiplayer: true });
      expect(a.cratePlacements).toHaveLength(25);
      expect(new Set(a.cratePlacements.map(c => c.supportObstacleId)).size).toBe(25);
      for (let i = 0; i < a.cratePlacements.length; i++) {
        const c = a.cratePlacements[i];
        const other = b.cratePlacements[i];
        expect([c.gx, c.gz, c.ox, c.oz, c.baseY, c.crateYaw, c.supportObstacleId])
          .toEqual([other.gx, other.gz, other.ox, other.oz, other.baseY, other.crateYaw, other.supportObstacleId]);
        const support = a.obstaclePlacements.find(o => o.id === c.supportObstacleId)!;
        expect(support.supplyTop).toBe(true);
        expect(c.baseY).toBeGreaterThan(.7);
        expect(support.maxY).toBeCloseTo(c.baseY + .0025);
        expect([support.gx, support.gz]).toEqual([c.gx, c.gz]);
      }
    }
    // A opção de quantidades maiores também precisa de suportes, não de caixas no chão.
    const large = createRandomArenaLayout({worldSeed: 2, crateCount: 110});
    expect(large.cratePlacements.length).toBeGreaterThan(25);
    expect(large.cratePlacements.every(c => c.baseY > 0 && c.supportObstacleId)).toBe(true);
  });

  it('verifica todas as malhas, apoios, colisões e coleta a partir do corredor', () => {
    for (const seed of [1, 2, 42, 500, 9011]) {
      const layout = createRandomArenaLayout({worldSeed: seed, playerSeed: 7});
      const scene = new THREE.Scene();
      const shared = createDoomSharedUniforms();
      const maze = buildDoomLabyrinth(scene, createDoomTextures(), shared, layout);
      const items = new DoomWorldItems(scene, shared, layout);
      scene.updateMatrixWorld(true);
      for (let i = 0; i < layout.cratePlacements.length; i++) {
        const c = layout.cratePlacements[i];
        const support = layout.obstaclePlacements.find(o => o.id === c.supportObstacleId)!;
        const crate = scene.getObjectByName(`SupplyLocation_${i}`)!.getObjectByName('SupplyCrate')!;
        expect(crate.getObjectByName('SupplyLid')).toBeDefined();
        expect(crate.getObjectByName('SupplyHinge')).toBeDefined();
        const skids = crate.children.filter(node => node.name === 'SupplySkid');
        expect(skids).toHaveLength(2);
        for (const skid of skids) {
          const box = new THREE.Box3().setFromObject(skid);
          expect(box.min.y).toBeCloseTo(c.baseY, 5);
          // Os dois trilhos cabem na superfície superior de madeira.
          const local = skid.position;
          expect(Math.abs(local.x) + .03).toBeLessThan(support.kind === 'wooden_crate_stack' ? .32 : support.kind === 'mixed_cargo_depot' ? .29 : .36);
          expect(Math.abs(local.z) + .22).toBeLessThan(support.kind === 'wooden_crate_stack' ? .30 : support.kind === 'mixed_cargo_depot' ? .28 : .32);
        }
        let meshes = 0;
        crate.traverse(node => {
          const mesh = node as THREE.Mesh;
          if (!mesh.isMesh || !mesh.name.startsWith('Supply')) return;
          meshes++;
          const positions = mesh.geometry.getAttribute('position');
          const normals = mesh.geometry.getAttribute('normal');
          expect(normals.count).toBe(positions.count);
          let finite = true;
          for (let j = 0; j < positions.count; j++) {
            finite &&= Number.isFinite(positions.getX(j) + positions.getY(j) + positions.getZ(j)) &&
              Number.isFinite(normals.getX(j) + normals.getY(j) + normals.getZ(j));
          }
          expect(finite, `${seed}/${i}: ${mesh.name}`).toBe(true);
          const bounds = new THREE.Box3().setFromObject(mesh);
          const collision = maze.colliders.find(collider => collider.id !== support.id && bounds.intersectsBox(collider.box));
          expect(collision, `${seed}/${i}: ${mesh.name} x ${collision?.id}`).toBeUndefined();
        });
        expect(meshes).toBeGreaterThan(20);
        const w = gridCellToWorld(c.gx, c.gz);
        const front = new THREE.Vector3(Math.sin(c.crateYaw), 0, Math.cos(c.crateYaw));
        const player = new THREE.Vector3(w.x + c.ox, 0, w.z + c.oz).addScaledVector(front, .98);
        const before = player.clone();
        resolveCylinderWorldCollisions(player, new THREE.Vector3(), .52, 1.8, maze.colliders);
        expect(player.distanceTo(before), `${seed}/${i}: posição acessível`).toBeLessThan(.025);
        const pickup = items.getPickupsSnapshot().find(p => p.id === `pickup-${i}`)!;
        const camera = player.clone().add(new THREE.Vector3(0, 1.72, 0));
        const obstruction = maze.colliders.find(collider => sweepSegmentVsBox(camera, pickup.position, collider.box));
        expect(obstruction, `${seed}/${i}: visão ${obstruction?.id}`).toBeUndefined();
        const inventory = { addItem: vi.fn(() => true) } as unknown as DoomInventory;
        const lookAt = pickup.position.clone().sub(camera).normalize();
        // Caixote lacrado: encostar não basta, é preciso interagir para abrir.
        items.updateAndCheckPickups(.016, 0, player, camera, lookAt, false, inventory);
        expect(items.getPickupsSnapshot().find(p => p.id === `pickup-${i}`)!.collected).toBe(false);
        const crateNode = scene.getObjectByName(`SupplyLocation_${i}`)!.getObjectByName('SupplyCrate')!;
        const lid = crateNode.getObjectByName('SupplyLid')!;
        // Portinhola fechada: assentada na boca do baú, sem fresta.
        expect(lid.rotation.x).toBeCloseTo(CRATE_LID_CLOSED_ROTATION, 5);
        expect(inventory.addItem).not.toHaveBeenCalled();
        // Interagir abre a tampa...
        let opened = 0;
        items.updateAndCheckPickups(.016, 0, player, camera, lookAt, true, inventory, undefined, () => { opened++; });
        expect(opened).toBe(1);
        expect(inventory.addItem).not.toHaveBeenCalled();
        // ...e o conteúdo só pode ser recolhido depois que a tampa termina de subir.
        for (let frame = 0; frame < 40; frame++) {
          items.updateAndCheckPickups(.016, 0, player, camera, lookAt, false, inventory);
        }
        expect(lid.rotation.x).toBeLessThan(CRATE_LID_OPEN_ROTATION * 0.8);
        expect(items.getPickupsSnapshot().find(p => p.id === `pickup-${i}`)!.collected).toBe(true);
      }
    }
  });
});
