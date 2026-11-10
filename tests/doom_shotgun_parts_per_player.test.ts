import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { createRandomArenaLayout } from '../src/doom/DoomArenaRandomizer';
import {
  getAvailableShotgunPartIds,
  getMissingShotgunParts,
  resolveShotgunPartSlotCount,
  SHOTGUN_PART_IDS,
  SHOTGUN_ITEM_ID,
} from '../src/doom/DoomShotgun';
import { DoomWorldItems } from '../src/doom/DoomWorldItems';
import { createDoomSharedUniforms } from '../src/doom/DoomShader';
import { formatShotgunObjective } from '../src/doom/DoomObjective';

describe('Peças da shotgun por jogador do servidor', () => {
  it('mantém as quatro peças no solo', () => {
    expect(resolveShotgunPartSlotCount(1, false)).toBe(4);
    expect(resolveShotgunPartSlotCount(1)).toBe(4);
    expect(resolveShotgunPartSlotCount(9, false)).toBe(4);
  });

  it.each([
    [1, 1],
    [2, 2],
    [3, 3],
    [4, 4],
    [7, 4],
  ])('em co-op com %i jogador(es) prepara %i peça(s)', (players, slots) => {
    expect(resolveShotgunPartSlotCount(players, true)).toBe(slots);
    const layout = createRandomArenaLayout({
      worldSeed: 4242,
      playerSeed: 7,
      isMultiplayer: true,
      playerCount: players,
    });
    expect(layout.shotgunPartSlotCount).toBe(slots);
    expect(layout.shotgunRoomPlacements).toHaveLength(slots);
    expect(layout.shotgunRoomPlacements.map((p) => p.itemId)).toEqual(
      SHOTGUN_PART_IDS.slice(0, slots)
    );
    // Cada peça fica numa sala diferente e nunca em caixote.
    expect(new Set(layout.shotgunRoomPlacements.map((p) => p.roomId)).size).toBe(slots);
    expect(
      layout.cratePlacements.some((p) => SHOTGUN_PART_IDS.some((id) => id === p.itemId))
    ).toBe(false);
  });

  it('permite forçar a contagem para o mundo ser idêntico para todos da sala', () => {
    const a = createRandomArenaLayout({
      worldSeed: 99,
      playerSeed: 1,
      isMultiplayer: true,
      shotgunPartSlots: 3,
    });
    const b = createRandomArenaLayout({
      worldSeed: 99,
      playerSeed: 2,
      isMultiplayer: true,
      shotgunPartSlots: 3,
    });
    expect(a.shotgunRoomPlacements).toEqual(b.shotgunRoomPlacements);
    expect(a.shotgunPartSlotCount).toBe(3);
  });

  it('continua determinístico por semente', () => {
    for (const players of [1, 2, 3, 4]) {
      const one = createRandomArenaLayout({
        worldSeed: 5150,
        playerSeed: 3,
        isMultiplayer: true,
        playerCount: players,
      });
      const two = createRandomArenaLayout({
        worldSeed: 5150,
        playerSeed: 8,
        isMultiplayer: true,
        playerCount: players,
      });
      expect(one.shotgunRoomPlacements).toEqual(two.shotgunRoomPlacements);
    }
  });

  it('cria os modelos 3D apenas para as peças da partida', () => {
    const scene = new THREE.Scene();
    const layout = createRandomArenaLayout({
      worldSeed: 321,
      playerSeed: 5,
      isMultiplayer: true,
      playerCount: 2,
    });
    const items = new DoomWorldItems(scene, createDoomSharedUniforms(), layout);
    const snapshot = items.getPickupsSnapshot();
    expect(snapshot.filter((p) => SHOTGUN_PART_IDS.includes(p.itemId as never))).toHaveLength(2);
    expect(items.getShotgunPartSlotCount()).toBe(2);
    expect(scene.getObjectByName('RoomShotgun_shotgun_receiver')).toBeDefined();
    expect(scene.getObjectByName('RoomShotgun_shotgun_barrel')).toBeDefined();
    expect(scene.getObjectByName('RoomShotgun_shotgun_pump')).toBeUndefined();
    expect(scene.getObjectByName('RoomShotgun_shotgun_stock')).toBeUndefined();
  });

  it('acrescenta as peças que faltam quando mais gente entra, sem remover as antigas', () => {
    const scene = new THREE.Scene();
    const layout = createRandomArenaLayout({
      worldSeed: 777,
      playerSeed: 2,
      isMultiplayer: true,
      playerCount: 1,
    });
    const items = new DoomWorldItems(scene, createDoomSharedUniforms(), layout);
    expect(items.getShotgunPartSlotCount()).toBe(1);

    expect(items.syncShotgunPartSlots(3)).toBe(3);
    const parts = items
      .getPickupsSnapshot()
      .filter((p) => SHOTGUN_PART_IDS.includes(p.itemId as never));
    expect(parts).toHaveLength(3);
    expect(new Set(parts.map((p) => p.itemId)).size).toBe(3);
    // Salas distintas para cada peça.
    expect(new Set(parts.map((p) => p.position.toArray().join(','))).size).toBe(3);

    // Pedir menos não remove peças já criadas.
    expect(items.syncShotgunPartSlots(2)).toBe(3);
    expect(
      items.getPickupsSnapshot().filter((p) => SHOTGUN_PART_IDS.includes(p.itemId as never))
    ).toHaveLength(3);
  });

  it('monta a arma apenas com as peças existentes no servidor', () => {
    expect(getAvailableShotgunPartIds(1)).toEqual(['shotgun_receiver']);
    expect(getAvailableShotgunPartIds(2)).toEqual(['shotgun_receiver', 'shotgun_barrel']);
    expect(getAvailableShotgunPartIds(4)).toEqual([...SHOTGUN_PART_IDS]);
    expect(getAvailableShotgunPartIds(0)).toEqual(['shotgun_receiver']);

    const owned = new Set(['shotgun_receiver', 'shotgun_barrel']);
    const hasItem = (id: string) => owned.has(id);
    expect(getMissingShotgunParts(hasItem, getAvailableShotgunPartIds(2))).toEqual([]);
    expect(getMissingShotgunParts(hasItem, getAvailableShotgunPartIds(3))).toEqual([
      'shotgun_pump',
    ]);
  });

  it('reflete a contagem real no objetivo exibido', () => {
    expect(formatShotgunObjective(false, false, 1, 0, 2)).toBe(
      'PEÇAS NAS SALAS ESPECIAIS · 1/2'
    );
    expect(formatShotgunObjective(false, false, 2, 0, 2)).toBe('MONTE A SHOTGUN · [TAB]');
    expect(formatShotgunObjective(false, false, 3, 0, 4)).toBe(
      'PEÇAS NAS SALAS ESPECIAIS · 3/4'
    );
    // Compatível com o comportamento antigo quando o total é omitido.
    expect(formatShotgunObjective(false, false, 2, 0)).toContain('/4');
  });

  it('mantém a arma montada intacta e consome somente as peças disponíveis', () => {
    const inventory = {
      parts: new Set<string>(['shotgun_receiver', 'shotgun_barrel']),
      items: new Set<string>(),
      hasItem(id: string) {
        return this.parts.has(id) || this.items.has(id);
      },
      addItem: vi.fn(),
    };
    // A montagem usa a lista de peças disponíveis, não a lista fixa de quatro.
    const available = getAvailableShotgunPartIds(2);
    const missing = available.filter((id) => !inventory.hasItem(id));
    expect(missing).toHaveLength(0);
    for (const id of available) inventory.parts.delete(id);
    inventory.items.add(SHOTGUN_ITEM_ID);
    expect(inventory.parts.size).toBe(0);
    expect(inventory.hasItem(SHOTGUN_ITEM_ID)).toBe(true);
  });
});
