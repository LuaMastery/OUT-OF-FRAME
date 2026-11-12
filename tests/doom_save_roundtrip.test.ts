/**
 * IDA E VOLTA DO SAVE PELO INVENTÁRIO E PELO MUNDO
 * ============================================================================
 * O modelo de slots (`doom_save_slots.test.ts`) garante que o ARQUIVO do save
 * sobrevive. Aqui o teste é o outro lado, o que costuma estragar de verdade:
 * a conversão entre o mundo vivo (objetos THREE, catálogo de itens) e os dados
 * simples do save.
 *
 * Os dois defeitos clássicos que estes testes perseguem:
 *  - carregar um save DUPLICAR itens em vez de substituir a mochila;
 *  - o cinto apontar para um item que não está mais no bolso.
 */

import { afterEach, describe, expect, it } from 'vitest';
import {
  installInventoryHarness,
  type InventoryHarness,
} from './doom_inventory_harness';
import { DoomInventory } from '../src/doom/DoomInventory';
import { DoomWorldItems } from '../src/doom/DoomWorldItems';
import { SoundEngine } from '../src/engine/audio/SoundEngine';
import {
  createRandomArenaLayout,
  type DoomArenaLayout,
} from '../src/doom/DoomArenaRandomizer';
import { createDoomSharedUniforms } from '../src/doom/DoomShader';
import * as THREE from 'three';

let harness: InventoryHarness | null = null;
let inventory: DoomInventory | null = null;

function noopCallbacks() {
  return {
    onToggleFlashlightFromUI: () => {},
    onUseHeal: () => true,
    onUseBattery: () => true,
    onUseFlare: () => true,
    onUseKnife: () => ({ cutWeb: true }),
    onToggleRadar: () => true,
    onToggleWalkieTalkie: () => true,
    onToggleShotgun: () => {},
    onDropHeldItem: () => true,
    onUseKey: () => true,
    onOpenRequest: () => {},
    onCloseRequest: () => {},
    onOpenPauseRequest: () => {},
    onPermanentDeathTerminate: () => {},
    onVictoryRestart: () => {},
    onVictoryExit: () => {},
  };
}

function buildInventory(): DoomInventory {
  harness = installInventoryHarness();
  const sound = new SoundEngine();
  const inv = new DoomInventory(
    harness.viewport as unknown as HTMLElement,
    sound,
    noopCallbacks()
  );
  inventory = inv;
  return inv;
}

afterEach(() => {
  inventory?.destroy();
  inventory = null;
  harness?.restore();
  harness = null;
});

describe('save — ida e volta pelo inventário', () => {
  it('um save vazio esvazia a mochila — inclusive o kit inicial', () => {
    const inv = buildInventory();
    // O operador já nasce com a lanterna: carregar um save sem itens precisa
    // tirá-la, porque carregar é SUBSTITUIR, não somar.
    expect(inv.getTotalItemCount()).toBeGreaterThan(0);

    inv.importInventoryState({ slots: [], hotbar: [null, null, null, null], heldSlot: 0 });
    expect(inv.getTotalItemCount()).toBe(0);
    expect(inv.getHotbarSlots()).toHaveLength(0);
    expect(inv.hasBeltItems()).toBe(false);
  });

  it('itens e quantidades voltam exatamente iguais', () => {
    const inv = buildInventory();
    inv.addItem('sterile_bandage', 3, true);
    inv.addItem('tactical_lantern', 1, true);
    inv.addItem('shotgun_shells', 8, true);

    const state = inv.exportInventoryState();
    inv.importInventoryState(state);

    // A lanterna do kit inicial mora no bolso 0; os itens novos vêm depois.
    expect(state.slots[0]).toEqual({ id: 'tactical_lantern', quantity: 1 });
    expect(inv.getItemCount('sterile_bandage')).toBe(3);
    expect(inv.getItemCount('shotgun_shells')).toBe(8);
    // 3 bandagens + 8 cartuchos + a lanterna do kit inicial. Pedir uma
    // segunda lanterna não duplica: ela já está na mochila.
    expect(inv.getTotalItemCount()).toBe(12);
  });

  it('o cinto volta apontando para os mesmos itens e na mesma mão', () => {
    const inv = buildInventory();
    inv.addItem('rusty_knife', 1, true);
    inv.addItem('sterile_bandage', 2, true);
    inv.addItem('magnesium_flare', 1, true);
    inv.selectHotbarSlot(1);

    const state = inv.exportInventoryState();
    expect(state.heldSlot).toBe(1);
    expect(state.hotbar[0]).toBe('rusty_knife');
    expect(state.hotbar[1]).toBe('sterile_bandage');

    inv.importInventoryState(state);
    expect(inv.getHeldSlot()).toBe(1);
    expect(inv.getHeldItem()?.itemId).toBe('sterile_bandage');
    expect(inv.getBeltIndexOfItem('rusty_knife')).toBe(0);
    expect(inv.getBeltIndexOfItem('magnesium_flare')).toBe(2);
  });

  it('carregar SUBSTITUI a mochila — nunca soma em cima do que já havia', () => {
    const inv = buildInventory();
    inv.addItem('sterile_bandage', 2, true);

    // Estado "vindo do disco" com um item completamente diferente.
    inv.importInventoryState({
      slots: [{ id: 'old_morphine', quantity: 1 }, null],
      hotbar: ['old_morphine', null, null, null],
      heldSlot: 0,
    });

    // A bandagem anterior se foi: carregar save é voltar no tempo.
    expect(inv.hasItem('sterile_bandage')).toBe(false);
    expect(inv.getItemCount('old_morphine')).toBe(1);
    expect(inv.getTotalItemCount()).toBe(1);
  });

  it('ignora ids que não existem mais no catálogo', () => {
    const inv = buildInventory();
    inv.importInventoryState({
      slots: [
        { id: 'item_que_nao_existe', quantity: 5 },
        { id: 'sterile_bandage', quantity: 2 },
      ],
      hotbar: ['item_que_nao_existe', 'sterile_bandage', null, null],
      heldSlot: 0,
    });

    expect(inv.getTotalItemCount()).toBe(2);
    // O encaixe órfão é limpo; a bandagem continua no encaixe 1.
    expect(inv.getHotbarSlots()).toHaveLength(1);
    expect(inv.getBeltIndexOfItem('item_que_nao_existe')).toBe(-1);
    expect(inv.getBeltIndexOfItem('sterile_bandage')).toBe(1);
  });

  it('conserta quantidade torta vinda de um save adulterado', () => {
    const inv = buildInventory();
    inv.importInventoryState({
      slots: [{ id: 'sterile_bandage', quantity: -4 }],
      hotbar: [null, null, null, null],
      heldSlot: 0,
    });
    // Ninguém carrega -4 bandagens: o mínimo saudável é 1.
    expect(inv.getItemCount('sterile_bandage')).toBe(1);
  });

  it('encaixe na mão fora da faixa não derruba a restauração', () => {
    const inv = buildInventory();
    inv.addItem('rusty_knife', 1, true);
    inv.importInventoryState({
      slots: [{ id: 'rusty_knife', quantity: 1 }],
      hotbar: ['rusty_knife', null, null, null],
      heldSlot: 99,
    });
    expect(inv.getHeldSlot()).toBeLessThanOrEqual(3);
    expect(inv.getHeldSlot()).toBeGreaterThanOrEqual(0);
  });
});

describe('save — ida e volta pelo mundo', () => {
  function buildWorld(seed = 4242): {
    world: DoomWorldItems;
    layout: DoomArenaLayout;
  } {
    const layout = createRandomArenaLayout({ worldSeed: seed, playerSeed: seed });
    const scene = new THREE.Scene();
    const shared = createDoomSharedUniforms();
    const world = new DoomWorldItems(scene, shared, layout);
    return { world, layout };
  }

  it('nada recolhido, nada aberto: o progresso nasce zerado', () => {
    const { world } = buildWorld();
    const state = world.exportWorldProgressState();
    expect(state.collectedPickupIds).toEqual([]);
    expect(state.openedCrateIndices).toEqual([]);
    expect(state.droppedItems).toEqual([]);
  });

  it('marcar como recolhido esconde o objeto de verdade', () => {
    const { world } = buildWorld(11);
    const before = world.getPickupsSnapshot();
    expect(before.length).toBeGreaterThan(0);

    const victim = before[0];
    world.importWorldProgressState({ collectedPickupIds: [victim.id] });

    const after = world.getPickupsSnapshot();
    expect(after.find((p) => p.id === victim.id)?.collected).toBe(true);
  });

  it('caixote aberto volta aberto e com o item de dentro à vista', () => {
    const { world } = buildWorld(77);
    const crated = world
      .getPickupsSnapshot()
      .map((p, index) => ({ p, index }))
      .filter(({ p }) => p.id.startsWith('pickup-'));
    expect(crated.length).toBeGreaterThan(0);

    const target = crated[0];
    world.importWorldProgressState({ openedCrateIndices: [target.index] });

    // O item do caixote aberto continua visível porque ainda não foi pego.
    const after = world.getPickupsSnapshot();
    expect(after[target.index].collected).toBe(false);
  });

  it('objetos largados renascem no mesmo lugar ao carregar', () => {
    const { world } = buildWorld(99);
    const dropped: Array<{
      id: string;
      itemId: string;
      x: number;
      z: number;
      yaw: number;
    }> = [
      {
        id: 'dropped-old_morphine-1',
        itemId: 'old_morphine',
        x: 12.5,
        z: -7.25,
        yaw: 0.5,
      },
      {
        id: 'dropped-sterile_bandage-2',
        itemId: 'sterile_bandage',
        x: -3,
        z: 8,
        yaw: -1.2,
      },
    ];

    world.importWorldProgressState({ droppedItems: dropped });

    const snapshot = world.getPickupsSnapshot().filter((p) => p.id.startsWith('dropped-'));
    expect(snapshot).toHaveLength(2);
    // A posição é preservada (o id muda porque é um objeto novo no mundo).
    expect(snapshot[0].position.x).toBeCloseTo(12.5, 4);
    expect(snapshot[0].position.z).toBeCloseTo(-7.25, 4);
    expect(snapshot.map((p) => p.itemId).sort()).toEqual([
      'old_morphine',
      'sterile_bandage',
    ]);
  });

  it('largar, exportar e reaplicar não duplica o objeto no chão', () => {
    const { world } = buildWorld(555);
    world.spawnDroppedItem('sterile_bandage', 5, 5, 0);

    const first = world.exportWorldProgressState();
    expect(first.droppedItems).toHaveLength(1);

    world.importWorldProgressState(first);
    const second = world
      .getPickupsSnapshot()
      .filter((p) => p.id.startsWith('dropped-') && !p.collected);
    expect(second).toHaveLength(1);
  });

  it('ignora objetos largados sem item, sem perder os válidos', () => {
    const { world } = buildWorld(1234);
    world.importWorldProgressState({
      droppedItems: [
        { id: 'a', itemId: 'old_morphine', x: 1, z: 2, yaw: 0 },
        { id: 'b', itemId: '', x: 1, z: 2, yaw: 0 },
        { id: 'c', itemId: 'old_morphine', x: 3, z: 4, yaw: 0 },
      ],
    });
    const dropped = world
      .getPickupsSnapshot()
      .filter((p) => p.id.startsWith('dropped-'));
    expect(dropped).toHaveLength(2);
  });
});
