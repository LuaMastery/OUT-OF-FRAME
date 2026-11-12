import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createRandomArenaLayout } from '../src/doom/DoomArenaRandomizer';
import { buildDoomLabyrinth, gridCellToWorld } from '../src/doom/DoomMazeBuilder';
import { createDoomTextures } from '../src/doom/DoomTextures';
import { createDoomSharedUniforms } from '../src/doom/DoomShader';
import { DoomWorldItems } from '../src/doom/DoomWorldItems';
import type { DoomInventory } from '../src/doom/DoomInventory';

/**
 * DESCARTE DO CINTO NO MUNDO
 * ============================================================================
 * Largar um item só vale se ele VOLTAR a existir como objeto pegável. Estes
 * testes garantem exatamente o ciclo: [Q] cria o objeto no chão, e o objeto
 * pode ser recolhido de novo pela coleta normal de pickups.
 */

/** Inventário falso: só precisa responder se conseguiu guardar o item. */
const fakeInventory = (accept = true): DoomInventory =>
  ({
    addItem: () => accept,
  }) as unknown as DoomInventory;

function world(): {
  items: DoomWorldItems;
  scene: THREE.Scene;
} {
  const layout = createRandomArenaLayout({ worldSeed: 1, playerSeed: 7 });
  const scene = new THREE.Scene();
  const shared = createDoomSharedUniforms();
  buildDoomLabyrinth(scene, createDoomTextures(), shared, layout);
  return { items: new DoomWorldItems(scene, shared, layout), scene };
}

describe('largar item do cinto no chão', () => {
  it('cria um objeto pegável no ponto indicado', () => {
    const { items, scene } = world();
    const before = items.getPickupsSnapshot().length;

    const spot = gridCellToWorld(3, 3);
    expect(items.spawnDroppedItem('sterile_bandage', spot.x, spot.z, 0.4)).toBe(
      true
    );

    const after = items.getPickupsSnapshot();
    expect(after).toHaveLength(before + 1);
    const dropped = after[after.length - 1];
    expect(dropped.itemId).toBe('sterile_bandage');
    expect(dropped.collected).toBe(false);
    expect(dropped.position.x).toBeCloseTo(spot.x, 6);
    expect(dropped.position.z).toBeCloseTo(spot.z, 6);
    // Nasce rente ao chão, não flutuando nem enterrado.
    expect(dropped.position.y).toBeGreaterThan(0);
    expect(dropped.position.y).toBeLessThan(0.3);

    // O modelo 3D existe na cena, com nome próprio para não colidir.
    expect(scene.getObjectByName('Dropped_sterile_bandage_1')).toBeDefined();
  });

  it('dá nomes únicos a objetos largados em sequência', () => {
    const { items, scene } = world();
    items.spawnDroppedItem('magnesium_flare', 1, 1, 0);
    items.spawnDroppedItem('magnesium_flare', 2, 2, 0);
    items.spawnDroppedItem('magnesium_flare', 3, 3, 0);
    expect(scene.getObjectByName('Dropped_magnesium_flare_1')).toBeDefined();
    expect(scene.getObjectByName('Dropped_magnesium_flare_2')).toBeDefined();
    expect(scene.getObjectByName('Dropped_magnesium_flare_3')).toBeDefined();
  });

  it('permite recolher de volta o que foi largado', () => {
    const { items } = world();
    const spot = gridCellToWorld(3, 3);
    items.spawnDroppedItem('sterile_bandage', spot.x, spot.z, 0);

    const inventory = fakeInventory(true);
    let collected: string | null = null;
    const playerPos = new THREE.Vector3(spot.x, 0, spot.z);
    const camPos = new THREE.Vector3(spot.x, 1.6, spot.z);
    const camDir = new THREE.Vector3(0, 0, -1);

    items.updateAndCheckPickups(
      0.016,
      0,
      playerPos,
      camPos,
      camDir,
      true,
      inventory,
      (itemId) => {
        collected = itemId;
      }
    );

    expect(collected).toBe('sterile_bandage');
    const dropped = items.getPickupsSnapshot().find((p) => p.itemId === 'sterile_bandage' && p.collected);
    expect(dropped).toBeDefined();
  });

  it('não gasta o objeto quando o bolso recusa o item', () => {
    const { items } = world();
    const spot = gridCellToWorld(3, 3);
    items.spawnDroppedItem('industrial_battery', spot.x, spot.z, 0);

    let collected: string | null = null;
    items.updateAndCheckPickups(
      0.016,
      0,
      new THREE.Vector3(spot.x, 0, spot.z),
      new THREE.Vector3(spot.x, 1.6, spot.z),
      new THREE.Vector3(0, 0, -1),
      true,
      fakeInventory(false),
      (itemId) => {
        collected = itemId;
      }
    );

    expect(collected).toBeNull();
    const stillThere = items
      .getPickupsSnapshot()
      .find((p) => p.itemId === 'industrial_battery');
    expect(stillThere?.collected).toBe(false);
  });
});
