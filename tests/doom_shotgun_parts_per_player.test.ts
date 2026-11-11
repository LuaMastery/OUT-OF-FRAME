import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { createRandomArenaLayout } from '../src/doom/DoomArenaRandomizer';
import {
  getAvailableShotgunPartIds,
  getMissingShotgunParts,
  getRequiredShotgunPartIds,
  MAX_SHOTGUN_PART_SLOTS,
  normalizeShotgunPartSlotCount,
  resolveShotgunPartSetCount,
  resolveShotgunPartSlotCount,
  SHOTGUN_PARTS_PER_SET,
  SHOTGUN_PART_IDS,
  SHOTGUN_ITEM_ID,
} from '../src/doom/DoomShotgun';
import { DoomWorldItems } from '../src/doom/DoomWorldItems';
import { gridCellToWorld } from '../src/doom/DoomMazeBuilder';
import { createDoomSharedUniforms } from '../src/doom/DoomShader';
import { formatShotgunObjective } from '../src/doom/DoomObjective';

const isPart = (itemId: string) => SHOTGUN_PART_IDS.some((id) => id === itemId);

describe('Peças da shotgun: um conjunto completo por jogador', () => {
  it('mantém as quatro peças no solo', () => {
    expect(resolveShotgunPartSlotCount(1, false)).toBe(4);
    expect(resolveShotgunPartSlotCount(1)).toBe(4);
    expect(resolveShotgunPartSlotCount(9, false)).toBe(4);
    expect(resolveShotgunPartSetCount(9, false)).toBe(1);
  });

  it.each([
    [1, 4],
    [2, 8],
    [3, 12],
    [4, 16],
    [7, 28],
    [8, 32],
    [12, 32],
  ])('em co-op com %i jogador(es) prepara %i peça(s) — 4 para cada um', (players, slots) => {
    expect(resolveShotgunPartSlotCount(players, true)).toBe(slots);
    expect(resolveShotgunPartSetCount(players, true)).toBe(slots / SHOTGUN_PARTS_PER_SET);
    const layout = createRandomArenaLayout({
      worldSeed: 4242,
      playerSeed: 7,
      isMultiplayer: true,
      playerCount: players,
    });
    expect(layout.shotgunPartSlotCount).toBe(slots);
    expect(layout.shotgunRoomPlacements).toHaveLength(slots);
    // Cada jogador recebe um conjunto COMPLETO: nunca meias armações.
    for (let i = 0; i < slots; i += SHOTGUN_PARTS_PER_SET) {
      expect(layout.shotgunRoomPlacements.slice(i, i + SHOTGUN_PARTS_PER_SET).map((p) => p.itemId))
        .toEqual([...SHOTGUN_PART_IDS]);
    }
    // Cada peça fica numa célula própria e nunca em caixote.
    expect(new Set(layout.shotgunRoomPlacements.map((p) => `${p.gx},${p.gz}`)).size).toBe(slots);
    expect(layout.cratePlacements.some((p) => isPart(p.itemId))).toBe(false);
    // Ninguém monta a arma com uma peça só.
    expect(new Set(layout.shotgunRoomPlacements.map((p) => p.itemId)).size).toBe(
      SHOTGUN_PARTS_PER_SET
    );
  });

  it('permite forçar a contagem para o mundo ser idêntico para todos da sala', () => {
    const a = createRandomArenaLayout({
      worldSeed: 99,
      playerSeed: 1,
      isMultiplayer: true,
      shotgunPartSlots: 12,
    });
    const b = createRandomArenaLayout({
      worldSeed: 99,
      playerSeed: 2,
      isMultiplayer: true,
      shotgunPartSlots: 12,
    });
    expect(a.shotgunRoomPlacements).toEqual(b.shotgunRoomPlacements);
    expect(a.shotgunPartSlotCount).toBe(12);
  });

  it('arredonda qualquer contagem para conjuntos fechados de quatro peças', () => {
    expect(normalizeShotgunPartSlotCount(1)).toBe(4);
    expect(normalizeShotgunPartSlotCount(4)).toBe(4);
    expect(normalizeShotgunPartSlotCount(5)).toBe(8);
    expect(normalizeShotgunPartSlotCount(13)).toBe(16);
    expect(normalizeShotgunPartSlotCount(9999)).toBe(MAX_SHOTGUN_PART_SLOTS);
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

  it('cria os modelos 3D de um conjunto completo para cada jogador', () => {
    const scene = new THREE.Scene();
    const layout = createRandomArenaLayout({
      worldSeed: 321,
      playerSeed: 5,
      isMultiplayer: true,
      playerCount: 2,
    });
    const items = new DoomWorldItems(scene, createDoomSharedUniforms(), layout);
    const snapshot = items.getPickupsSnapshot();
    expect(snapshot.filter((p) => isPart(p.itemId))).toHaveLength(8);
    expect(items.getShotgunPartSlotCount()).toBe(8);
    expect(items.getShotgunPartSetCount()).toBe(2);
    // A primeira peça de cada tipo mantém o nome canônico...
    for (const id of SHOTGUN_PART_IDS) {
      expect(scene.getObjectByName(`RoomShotgun_${id}`)).toBeDefined();
    }
    // ...e a segunda fornada é numerada, para ninguém se perder no mundo.
    expect(scene.getObjectByName('RoomShotgun_shotgun_receiver_2')).toBeDefined();
    expect(scene.getObjectByName('RoomShotgun_shotgun_stock_2')).toBeDefined();
    expect(scene.getObjectByName('RoomShotgun_shotgun_receiver_3')).toBeUndefined();
  });

  it('acrescenta conjuntos inteiros quando mais gente entra, sem remover as antigas', () => {
    const scene = new THREE.Scene();
    const layout = createRandomArenaLayout({
      worldSeed: 777,
      playerSeed: 2,
      isMultiplayer: true,
      playerCount: 1,
    });
    const items = new DoomWorldItems(scene, createDoomSharedUniforms(), layout);
    expect(items.getShotgunPartSlotCount()).toBe(4);

    // Entram mais dois jogadores: mais dois conjuntos completos no mundo.
    expect(items.syncShotgunPartSlots(12)).toBe(12);
    const parts = items.getPickupsSnapshot().filter((p) => isPart(p.itemId));
    expect(parts).toHaveLength(12);
    for (const id of SHOTGUN_PART_IDS) {
      expect(parts.filter((p) => p.itemId === id)).toHaveLength(3);
    }
    // Salas distintas para cada peça.
    expect(new Set(parts.map((p) => p.position.toArray().join(','))).size).toBe(12);
    // As quatro peças originais continuam exatamente onde estavam.
    const originalPositions = layout.shotgunRoomPlacements.map((p) => {
      const world = gridCellToWorld(p.gx, p.gz);
      return `${p.itemId}@${world.x},${world.z}`;
    });
    expect(parts.slice(0, 4).map((p) => `${p.itemId}@${p.position.x},${p.position.z}`))
      .toEqual(originalPositions);

    // Pedir menos não remove peças já criadas.
    expect(items.syncShotgunPartSlots(4)).toBe(12);
    expect(items.getPickupsSnapshot().filter((p) => isPart(p.itemId))).toHaveLength(12);
  });

  it('exige sempre as quatro peças para montar a arma', () => {
    // Oito peças no mundo = dois conjuntos completos, não oito peças diferentes.
    expect(getAvailableShotgunPartIds(8)).toEqual([...SHOTGUN_PART_IDS, ...SHOTGUN_PART_IDS]);
    expect(getAvailableShotgunPartIds(4)).toEqual([...SHOTGUN_PART_IDS]);
    expect(getRequiredShotgunPartIds()).toEqual([...SHOTGUN_PART_IDS]);
    expect(getRequiredShotgunPartIds()).toEqual([...SHOTGUN_PART_IDS]);

    const owned = new Set(['shotgun_receiver', 'shotgun_barrel']);
    const hasItem = (id: string) => owned.has(id);
    // Repetir uma peça não adianta: faltam bomba e coronha.
    expect(getMissingShotgunParts(hasItem, getAvailableShotgunPartIds(8))).toEqual([
      'shotgun_pump',
      'shotgun_stock',
    ]);
    for (const id of SHOTGUN_PART_IDS) owned.add(id);
    expect(getMissingShotgunParts(hasItem, getAvailableShotgunPartIds(8))).toEqual([]);
  });

  it('reflete a contagem real no objetivo exibido', () => {
    expect(formatShotgunObjective(false, false, 1, 0, 4)).toBe(
      'PEÇAS NAS SALAS ESPECIAIS · 1/4'
    );
    expect(formatShotgunObjective(false, false, 4, 0, 4)).toBe('MONTE A SHOTGUN · [TAB]');
    expect(formatShotgunObjective(false, false, 3, 0, 4)).toBe(
      'PEÇAS NAS SALAS ESPECIAIS · 3/4'
    );
    // Compatível com o comportamento antigo quando o total é omitido.
    expect(formatShotgunObjective(false, false, 2, 0)).toContain('/4');
  });

  it('mantém a arma montada intacta e consome um conjunto por montagem', () => {
    const inventory = {
      parts: new Map<string, number>([
        ['shotgun_receiver', 2],
        ['shotgun_barrel', 1],
        ['shotgun_pump', 1],
        ['shotgun_stock', 1],
      ]),
      items: new Set<string>(),
      hasItem(id: string) {
        return (this.parts.get(id) ?? 0) > 0 || this.items.has(id);
      },
      addItem: vi.fn(),
    };
    const available = getRequiredShotgunPartIds();
    const missing = available.filter((id) => !inventory.hasItem(id));
    expect(missing).toHaveLength(0);
    // Uma montagem consome UMA peça de cada tipo; as repetidas ficam no inventário.
    for (const id of available) {
      const left = (inventory.parts.get(id) ?? 0) - 1;
      if (left > 0) inventory.parts.set(id, left);
      else inventory.parts.delete(id);
    }
    inventory.items.add(SHOTGUN_ITEM_ID);
    expect(inventory.parts.get('shotgun_receiver')).toBe(1);
    expect(inventory.parts.size).toBe(1);
    expect(inventory.hasItem(SHOTGUN_ITEM_ID)).toBe(true);
  });
});
