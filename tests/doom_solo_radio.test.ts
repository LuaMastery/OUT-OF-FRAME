import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { createRandomArenaLayout, hashArenaSeed } from '../src/doom/DoomArenaRandomizer';
import { DoomWorldItems } from '../src/doom/DoomWorldItems';
import { createDoomSharedUniforms } from '../src/doom/DoomShader';
import type { DoomInventory } from '../src/doom/DoomInventory';
import { THEMED_ROOMS } from '../src/doom/DoomRooms';

const radio = 'field_walkie_talkie';

describe('Rádio no modo solo e no cooperativo', () => {
  it('substitui somente o rádio por uma bateria útil no solo, preservando caixas e outros itens', () => {
    for (const seed of [1, 2, 42, 500, 9011, 75012]) {
      const solo = createRandomArenaLayout({ worldSeed: seed, playerSeed: 1 });
      const coop = createRandomArenaLayout({ worldSeed: seed, playerSeed: 1, isMultiplayer: true });
      expect(solo.cratePlacements).toHaveLength(25);
      expect(solo.cratePlacements.some(p => p.itemId === radio)).toBe(false);
      expect(coop.cratePlacements.filter(p => p.itemId === radio)).toHaveLength(1);
      for (let i = 0; i < solo.cratePlacements.length; i++) {
        const expected = { ...coop.cratePlacements[i] };
        if (expected.itemId === radio) expected.itemId = 'industrial_battery';
        expect(solo.cratePlacements[i]).toEqual(expected);
      }
      for (const room of THEMED_ROOMS) expect(solo.cratePlacements.some(p => p.itemId === room.keyItemId)).toBe(true);
      expect(solo.cratePlacements.filter(p => p.itemId === 'shotgun_shells').length).toBeGreaterThanOrEqual(2);
      // Solo mantém as 4 peças; o co-op começa com 1 jogador (1 peça), então
      // apenas a primeira peça coincide — as demais são o que o esquadrão junta.
      expect(solo.shotgunRoomPlacements).toHaveLength(4);
      expect(coop.shotgunRoomPlacements).toHaveLength(1);
      expect(coop.shotgunRoomPlacements[0]).toEqual(solo.shotgunRoomPlacements[0]);
      const items = new DoomWorldItems(new THREE.Scene(), createDoomSharedUniforms(), solo);
      expect(items.getPickupsSnapshot().some(p => p.itemId === radio)).toBe(false);
      expect(items.getUncollectedEquipmentSignals()).toHaveLength(29);
    }
  });

  it('mantém o rádio coletável e o mesmo mundo para anfitrião e convidado no co-op', () => {
    const worldSeed = hashArenaSeed('oof-arena-world:TESTE77');
    const host = createRandomArenaLayout({ worldSeed, playerSeed: 11, isMultiplayer: true });
    const guest = createRandomArenaLayout({ worldSeed, playerSeed: 22, isMultiplayer: true });
    expect(host.cratePlacements).toEqual(guest.cratePlacements);
    const hostItems = new DoomWorldItems(new THREE.Scene(), createDoomSharedUniforms(), host);
    const guestItems = new DoomWorldItems(new THREE.Scene(), createDoomSharedUniforms(), guest);
    const pickup = hostItems.getPickupsSnapshot().find(p => p.itemId === radio)!;
    const guestPickup = guestItems.getPickupsSnapshot().find(p => p.itemId === radio)!;
    expect(pickup).toBeDefined();
    expect(guestPickup.position.toArray()).toEqual(pickup.position.toArray());
    const addItem = vi.fn(() => true);
    const hostCamera = pickup.position.clone().add(new THREE.Vector3(0.35, 0.8, 0.35));
    const hostLook = pickup.position.clone().sub(hostCamera).normalize();
    // Caixote lacrado: interage para abrir, espera a tampa subir e então recolhe.
    hostItems.updateAndCheckPickups(.016, 0, pickup.position, hostCamera, hostLook, true, { addItem } as unknown as DoomInventory);
    for (let frame = 0; frame < 40; frame++) {
      hostItems.updateAndCheckPickups(.016, 0, pickup.position, hostCamera, hostLook, false, { addItem } as unknown as DoomInventory);
    }
    expect(addItem).toHaveBeenCalledWith(radio, 1, false);
    expect(hostItems.getPickupsSnapshot().find(p => p.itemId === radio)?.collected).toBe(true);
    expect(guestItems.getPickupsSnapshot().find(p => p.itemId === radio)?.collected).toBe(false);
  });
});
