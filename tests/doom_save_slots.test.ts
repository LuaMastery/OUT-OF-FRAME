/**
 * Testes do sistema de saves (modelo puro).
 *
 * A ideia aqui é proteger as partes que dão prejuízo real quando quebram:
 * um save corrompido virar um mundo torto, um slot cheio derrubar o menu, ou
 * o jogo achar que o jogador é novato quando ele já tem progresso.
 */

import { describe, expect, it } from 'vitest';
import {
  clearSaveSlot,
  createMemorySaveStorage,
  DoomSavePayload,
  formatHealthLabel,
  formatSaveDuration,
  formatSlotLabel,
  hasAnySave,
  listSaveSlots,
  readSaveSlot,
  SAVE_FORMAT_VERSION,
  SAVE_SLOT_COUNT,
  saveSlotStorageKey,
  summarizeSave,
  sanitizeSavePayload,
  writeSaveSlot,
  type SaveStorageLike,
} from '../src/doom/DoomSaveSlots';

/** Um save de mentira, válido o bastante para passar pela sanitização. */
function makePayload(overrides: Partial<DoomSavePayload> = {}): DoomSavePayload {
  const base: DoomSavePayload = {
    version: SAVE_FORMAT_VERSION,
    worldSeed: 123456,
    playerSeed: 654321,
    shotgunPartSlots: 4,
    player: { x: 1, y: 1.62, z: 2, yaw: 0.5, pitch: 0 },
    vitals: { health: 80, sanity: 65, battery: 40, bleeding: false, stamina: 70 },
    inventory: {
      slots: [
        { id: 'sterile_bandage', quantity: 2 },
        { id: 'tactical_lantern', quantity: 1 },
        null,
        null,
      ],
      hotbar: ['sterile_bandage', 'tactical_lantern', null, null],
      heldSlot: 0,
    },
    world: {
      collectedPickupIds: ['pickup-part-1'],
      openedCrateIndices: [0, 3],
      droppedItems: [
        { id: 'dropped-old_morphine-1', itemId: 'old_morphine', x: 4, z: 5, yaw: 0.2 },
      ],
    },
    unlockedRoomIds: ['computer_room'],
    gear: {
      flashlightOn: true,
      radarOn: false,
      walkieOn: true,
      shotgunEquipped: false,
    },
    run: { elapsedSec: 754, deaths: 2, sector: 'SETOR DE PEDRA' },
    meta: { createdAt: 1_700_000_000_000, updatedAt: 1_700_000_060_000 },
  };
  return { ...base, ...overrides };
}

/** Armazenamento que estoura a cota em qualquer gravação. */
function createFailingStorage(): SaveStorageLike {
  return {
    getItem: () => null,
    setItem: () => {
      throw new Error('QuotaExceededError');
    },
    removeItem: () => {},
  };
}

describe('saves — chave e contagem de slots', () => {
  it('oferece exatamente cinco slots', () => {
    expect(SAVE_SLOT_COUNT).toBe(5);
  });

  it('cada slot tem uma chave própria, sem colisão', () => {
    const keys = new Set<string>();
    for (let slot = 0; slot < SAVE_SLOT_COUNT; slot++) {
      keys.add(saveSlotStorageKey(slot));
    }
    expect(keys.size).toBe(SAVE_SLOT_COUNT);
  });
});

describe('saves — ir e vir do armazenamento', () => {
  it('grava e lê de volta sem perder nada', () => {
    const storage = createMemorySaveStorage();
    const payload = makePayload();

    expect(writeSaveSlot(storage, 2, payload).ok).toBe(true);
    expect(readSaveSlot(storage, 2)).toEqual(payload);
  });

  it('slot nunca gravado vale por vazio', () => {
    const storage = createMemorySaveStorage();
    expect(readSaveSlot(storage, 0)).toBeNull();
  });

  it('gravar em um slot não encosta nos vizinhos', () => {
    const storage = createMemorySaveStorage();
    writeSaveSlot(storage, 1, makePayload({ worldSeed: 111 }));
    writeSaveSlot(storage, 3, makePayload({ worldSeed: 333 }));

    expect(readSaveSlot(storage, 1)?.worldSeed).toBe(111);
    expect(readSaveSlot(storage, 3)?.worldSeed).toBe(333);
    expect(readSaveSlot(storage, 0)).toBeNull();
    expect(readSaveSlot(storage, 2)).toBeNull();
    expect(readSaveSlot(storage, 4)).toBeNull();
  });

  it('apagar devolve o slot ao vazio', () => {
    const storage = createMemorySaveStorage();
    writeSaveSlot(storage, 4, makePayload());
    expect(hasAnySave(storage)).toBe(true);

    clearSaveSlot(storage, 4);
    expect(readSaveSlot(storage, 4)).toBeNull();
    expect(hasAnySave(storage)).toBe(false);
  });

  it('reescrever o mesmo slot substitui o conteúdo', () => {
    const storage = createMemorySaveStorage();
    writeSaveSlot(storage, 0, makePayload({ worldSeed: 1 }));
    writeSaveSlot(storage, 0, makePayload({ worldSeed: 2 }));

    expect(readSaveSlot(storage, 0)?.worldSeed).toBe(2);
  });
});

describe('saves — quando o navegador recusa gravar', () => {
  it('avisa a falha em vez de estourar', () => {
    const result = writeSaveSlot(createFailingStorage(), 0, makePayload());
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('ler de um armazenamento que explode devolve vazio', () => {
    const hostile: SaveStorageLike = {
      getItem: () => {
        throw new Error('acesso negado');
      },
      setItem: () => {},
      removeItem: () => {},
    };
    expect(readSaveSlot(hostile, 0)).toBeNull();
  });
});

describe('saves — leitura defensiva de saves estragados', () => {
  const readRaw = (raw: unknown) => sanitizeSavePayload(raw);

  it('recusa o que não for objeto', () => {
    expect(readRaw(null)).toBeNull();
    expect(readRaw(42)).toBeNull();
    expect(readRaw('save')).toBeNull();
  });

  it('recusa uma versão de formato desconhecida', () => {
    expect(readRaw({ ...makePayload(), version: 99 })).toBeNull();
  });

  it('recusa um save sem semente do mundo — sem ela não há como reconstruir o labirinto', () => {
    const broken = makePayload();
    expect(readRaw({ ...broken, worldSeed: undefined })).toBeNull();
  });

  it('completa o que estiver faltando com valores seguros', () => {
    const partial = sanitizeSavePayload({
      version: SAVE_FORMAT_VERSION,
      worldSeed: 777,
    });

    expect(partial).not.toBeNull();
    expect(partial!.playerSeed).toBe(777); // cai na semente do mundo
    expect(partial!.inventory.slots).toEqual([]);
    expect(partial!.inventory.hotbar).toEqual([null, null, null, null]);
    expect(partial!.vitals.health).toBe(100);
    expect(partial!.world.collectedPickupIds).toEqual([]);
    expect(partial!.run.elapsedSec).toBe(0);
  });

  it('corta vida e sanidade para a faixa válida', () => {
    const wild = sanitizeSavePayload({
      ...makePayload(),
      vitals: { health: 5000, sanity: -80, battery: 1e9, bleeding: false, stamina: 10 },
    });
    expect(wild!.vitals.health).toBe(100);
    expect(wild!.vitals.sanity).toBe(0);
    expect(wild!.vitals.battery).toBe(100);
  });

  it('esquece itens do cinto que não existem nos bolsos', () => {
    const tampered = sanitizeSavePayload({
      ...makePayload(),
      inventory: {
        slots: [{ id: 'sterile_bandage', quantity: 1 }, null, null, null],
        hotbar: ['sterile_bandage', 'combat_shotgun', null, null],
        heldSlot: 1,
      },
    });
    expect(tampered!.inventory.hotbar[0]).toBe('sterile_bandage');
    expect(tampered!.inventory.hotbar[1]).toBeNull();
  });

  it('sempre devolve quatro encaixes no cinto, mesmo com o save torto', () => {
    const tampered = sanitizeSavePayload({
      ...makePayload(),
      inventory: { slots: [], hotbar: ['a', 'b', 'c', 'd', 'e', 'f'], heldSlot: 99 },
    });
    expect(tampered!.inventory.hotbar).toHaveLength(4);
    expect(tampered!.inventory.hotbar.every((id) => id === null)).toBe(true);
    expect(tampered!.inventory.heldSlot).toBeLessThanOrEqual(3);
  });

  it('joga fora objetos largados sem id ou sem item', () => {
    const dirty = sanitizeSavePayload({
      ...makePayload(),
      world: {
        collectedPickupIds: [1, null, 'ok'],
        openedCrateIndices: ['x', 2.7, 4],
        droppedItems: [
          { id: 'd1', itemId: 'old_morphine', x: 1, z: 2, yaw: 0 },
          { id: '', itemId: 'old_morphine', x: 1, z: 2, yaw: 0 },
          { id: 'd3', itemId: '', x: 1, z: 2, yaw: 0 },
          null,
        ],
      },
    });
    expect(dirty!.world.droppedItems).toHaveLength(1);
    expect(dirty!.world.collectedPickupIds).toEqual(['ok']);
    // Texto é descartado e o índice fracionário é arredondado: caixote é
    // contado por posição inteira, nunca por fração.
    expect(dirty!.world.openedCrateIndices).toEqual([3, 4]);
  });

  it('descarta quantidade de item absurda ou negativa', () => {
    const dirty = sanitizeSavePayload({
      ...makePayload(),
      inventory: {
        slots: [{ id: 'old_morphine', quantity: -5 }, { id: 'old_morphine', quantity: 2.9 }],
        hotbar: [null, null, null, null],
        heldSlot: 0,
      },
    });
    // Negativa vira 1 (o mínimo saudável); 2.9 vira 2 (sem inventar fração).
    expect(dirty!.inventory.slots[0]!.quantity).toBe(1);
    expect(dirty!.inventory.slots[1]!.quantity).toBe(2);
  });

  it('um JSON cortado no meio não derruba a leitura', () => {
    const storage = createMemorySaveStorage();
    storage.setItem(saveSlotStorageKey(0), '{"version":1,"worldSeed":12');
    expect(readSaveSlot(storage, 0)).toBeNull();
  });
});

describe('saves — resumo para a lista', () => {
  it('um slot vazio aparece como vazio e sem números', () => {
    const summary = summarizeSave(0, null);
    expect(summary.empty).toBe(true);
    expect(summary.itemCount).toBe(0);
    expect(summary.shotgunReady).toBe(false);
    expect(summary.health).toBe(0);
  });

  it('soma as pilhas dos bolsos na contagem de itens', () => {
    const summary = summarizeSave(0, makePayload());
    // 2 bandagens + 1 lanterna
    expect(summary.itemCount).toBe(3);
  });

  it('marca a escopeta pronta quando ela está na mochila', () => {
    const withShotgun = makePayload({
      inventory: {
        slots: [{ id: 'combat_shotgun', quantity: 1 }, { id: 'shotgun_shells', quantity: 6 }],
        hotbar: ['combat_shotgun', null, null, null],
        heldSlot: 0,
      },
    });
    expect(summarizeSave(0, withShotgun).shotgunReady).toBe(true);
    expect(summarizeSave(0, withShotgun).itemCount).toBe(7);
  });

  it('repassa vida, sanidade, setor e mortes', () => {
    const summary = summarizeSave(1, makePayload());
    expect(summary.slot).toBe(1);
    expect(summary.health).toBe(80);
    expect(summary.sanity).toBe(65);
    expect(summary.sector).toBe('SETOR DE PEDRA');
    expect(summary.deaths).toBe(2);
    expect(summary.bleeding).toBe(false);
  });
});

describe('saves — a lista completa dos cinco slots', () => {
  it('lista sempre cinco, na ordem, mesmo sem nada gravado', () => {
    const list = listSaveSlots(createMemorySaveStorage());
    expect(list).toHaveLength(5);
    expect(list.map((s) => s.slot)).toEqual([0, 1, 2, 3, 4]);
    expect(list.every((s) => s.empty)).toBe(true);
  });

  it('mistura slots cheios e vazios na ordem certa', () => {
    const storage = createMemorySaveStorage();
    writeSaveSlot(storage, 0, makePayload({ worldSeed: 10 }));
    writeSaveSlot(storage, 3, makePayload({ worldSeed: 40 }));

    const list = listSaveSlots(storage);
    expect(list[0].empty).toBe(false);
    expect(list[1].empty).toBe(true);
    expect(list[3].empty).toBe(false);
    expect(list[0].updatedAt).toBeGreaterThan(0);
  });
});

describe('saves — é novato?', () => {
  it('sem nenhum save, é novato', () => {
    expect(hasAnySave(createMemorySaveStorage())).toBe(false);
  });

  it('com qualquer slot ocupado, deixa o jogador em paz', () => {
    const storage = createMemorySaveStorage();
    writeSaveSlot(storage, 4, makePayload());
    expect(hasAnySave(storage)).toBe(true);
  });

  it('slot corrompido NÃO conta como progresso', () => {
    const storage = createMemorySaveStorage();
    storage.setItem(saveSlotStorageKey(2), 'lixo que não é JSON');
    expect(hasAnySave(storage)).toBe(false);
  });
});

describe('saves — rótulos da interface', () => {
  it('numera os slots com dois dígitos', () => {
    expect(formatSlotLabel(0)).toBe('SAVE 01');
    expect(formatSlotLabel(4)).toBe('SAVE 05');
  });

  it('formata a duração curta e a longa', () => {
    expect(formatSaveDuration(0)).toBe('0:00');
    expect(formatSaveDuration(9)).toBe('0:09');
    expect(formatSaveDuration(754)).toBe('12:34');
    expect(formatSaveDuration(3725)).toBe('1:02:05');
  });

  it('nunca mostra duração negativa', () => {
    expect(formatSaveDuration(-100)).toBe('0:00');
  });

  it('mostra a hemorragia junto da vida', () => {
    const bleeding = summarizeSave(0, makePayload({
      vitals: { health: 42, sanity: 10, battery: 5, bleeding: true, stamina: 1 },
    }));
    expect(formatHealthLabel(bleeding)).toBe('42% · sangrando');
    expect(formatHealthLabel(summarizeSave(1, makePayload()))).toBe('80%');
    expect(formatHealthLabel(summarizeSave(2, null))).toBe('vazio');
  });
});
