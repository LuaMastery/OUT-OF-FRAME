import { afterEach, describe, expect, it } from 'vitest';
import { installInventoryHarness, type InventoryHarness } from './doom_inventory_harness';
import { DoomInventory } from '../src/doom/DoomInventory';
import { SoundEngine } from '../src/engine/audio/SoundEngine';

/**
 * CINTO TÁTICO NO INVENTÁRIO (integração)
 * ============================================================================
 * O modelo puro das regras está em `doom_hotbar.test.ts`. Aqui o foco é a
 * COLA entre as regras e o inventário de verdade: o que acontece com o cinto
 * quando se recolhe, usa, consome e larga um item — inclusive o repasse para
 * o mundo no descarte.
 */

let harness: InventoryHarness | null = null;
let inventory: DoomInventory | null = null;

interface Counters {
  lantern: number;
  heal: number;
  flare: number;
  knife: number;
  radar: number;
  battery: number;
  dropped: string[];
  acceptDrop: boolean;
}

function build(counters: Partial<Counters> = {}): {
  inv: DoomInventory;
  c: Counters;
} {
  const c: Counters = {
    lantern: 0,
    heal: 0,
    flare: 0,
    knife: 0,
    radar: 0,
    battery: 0,
    dropped: [],
    acceptDrop: true,
    ...counters,
  };
  harness = installInventoryHarness();
  const sound = new SoundEngine();
  const inv = new DoomInventory(harness.viewport as unknown as HTMLElement, sound, {
    onToggleFlashlightFromUI: () => {
      c.lantern += 1;
    },
    onUseHeal: () => {
      c.heal += 1;
      return true;
    },
    onUseBattery: () => {
      c.battery += 1;
      return true;
    },
    onUseFlare: () => {
      c.flare += 1;
      return true;
    },
    onUseKnife: () => {
      c.knife += 1;
      return { cutWeb: true };
    },
    onToggleRadar: () => {
      c.radar += 1;
      return c.radar % 2 === 1;
    },
    onDropHeldItem: (itemId) => {
      if (!c.acceptDrop) return false;
      c.dropped.push(itemId);
      return true;
    },
    onCloseRequest: () => {},
    onPermanentDeathTerminate: () => {},
  });
  inventory = inv;
  return { inv, c };
}

afterEach(() => {
  inventory?.destroy();
  inventory = null;
  harness?.restore();
  harness = null;
});

describe('cinto no inventário — recolher', () => {
  it('preenche os encaixes na ordem e manda o excedente para a mochila', () => {
    const { inv } = build();
    inv.addItem('rusty_knife', 1, true);
    inv.addItem('sterile_bandage', 2, true);
    inv.addItem('magnesium_flare', 1, true);
    inv.addItem('industrial_battery', 1, true);

    expect(inv.getHotbarSlots().map((s) => s.itemId)).toEqual([
      'rusty_knife',
      'sterile_bandage',
      'magnesium_flare',
      'industrial_battery',
    ]);

    // Cinto cheio: o quinto suprimento continua entrando, mas na mochila.
    expect(inv.addItem('old_morphine', 3, true)).toBe(true);
    expect(inv.hasItem('old_morphine')).toBe(true);
    expect(inv.getHotbarSlots().map((s) => s.itemId)).toHaveLength(4);
    expect(inv.getBeltIndexOfItem('old_morphine')).toBe(-1);
  });

  it('traz para a mão o primeiro item recolhido', () => {
    const { inv } = build();
    expect(inv.getHeldItem()).toBeNull();
    inv.addItem('magnesium_flare', 4, true);
    expect(inv.getHeldSlot()).toBe(0);
    expect(inv.getHeldItem()).toMatchObject({
      itemId: 'magnesium_flare',
      quantity: 4,
    });
  });

  it('deixa fora do cinto o que já tem tecla própria', () => {
    const { inv } = build();
    inv.addItem('tactical_lantern', 1, true);
    inv.addItem('field_radar', 1, true);
    inv.addItem('sector_b_key', 1, true);

    expect(inv.hasItem('tactical_lantern')).toBe(true);
    expect(inv.hasItem('field_radar')).toBe(true);
    expect(inv.hasItem('sector_b_key')).toBe(true);
    expect(inv.hasBeltItems()).toBe(false);
    expect(inv.getHotbarSlots()).toHaveLength(0);
  });

  it('mostra a quantidade certa quando a pilha cresce', () => {
    const { inv } = build();
    inv.addItem('sterile_bandage', 2, true);
    inv.addItem('sterile_bandage', 3, true);
    expect(inv.getHeldItem()?.quantity).toBe(5);
  });
});

describe('cinto no inventário — sacar e usar', () => {
  it('sacar não gasta o item; usar gasta uma unidade', () => {
    const { inv, c } = build();
    inv.addItem('sterile_bandage', 2, true);
    inv.addItem('magnesium_flare', 1, true);

    // Sacar o sinalizador não acende nada.
    inv.selectHotbarSlot(1);
    expect(inv.getHeldSlot()).toBe(1);
    expect(c.flare).toBe(0);

    // Voltar para a gaze e usar: uma unidade a menos.
    inv.selectHotbarSlot(0);
    expect(inv.useHeldItem()).toBe(true);
    expect(c.heal).toBe(1);
    expect(inv.getHeldItem()?.quantity).toBe(1);
  });

  it('usa o canivete sem gastá-lo (ferramenta reutilizável)', () => {
    const { inv, c } = build();
    inv.addItem('rusty_knife', 1, true);
    inv.useHeldItem();
    inv.useHeldItem();
    expect(c.knife).toBe(2);
    expect(inv.getHeldItem()?.itemId).toBe('rusty_knife');
  });

  it('esvazia o encaixe quando a última unidade acaba', () => {
    const { inv, c } = build();
    inv.addItem('magnesium_flare', 1, true);
    expect(inv.useHeldItem()).toBe(true);
    expect(c.flare).toBe(1);
    expect(inv.getHeldItem()).toBeNull();
    expect(inv.hasItem('magnesium_flare')).toBe(false);
    expect(inv.hasBeltItems()).toBe(false);
  });

  it('passa o encaixe para outra pilha igual na mochila', () => {
    const { inv, c } = build();
    inv.addItem('sterile_bandage', 1, true);
    // Segunda pilha do mesmo item direto na mochila (como ocorre depois de
    // reorganizar os bolsos): o encaixe do cinto não deve ficar vazio.
    const internals = inv as unknown as {
      slots: Array<{ def: { id: string }; quantity: number } | null>;
    };
    const first = internals.slots.findIndex(
      (s) => s?.def.id === 'sterile_bandage'
    );
    internals.slots[first + 1] = {
      def: internals.slots[first]!.def,
      quantity: 2,
    };

    inv.useHeldItem();
    expect(c.heal).toBe(1);
    expect(inv.getHeldItem()).toMatchObject({
      itemId: 'sterile_bandage',
      quantity: 2,
    });
  });

  it('acende a lanterna quando ela é sacada pelo cinto', () => {
    const { inv, c } = build();
    inv.addItem('tactical_lantern', 1, true);
    inv.assignHotbarSlot(0, 'tactical_lantern');
    inv.selectHotbarSlot(0);
    expect(c.lantern).toBe(1);
  });

  it('dá a volta completa nos quatro encaixes com a roda do mouse', () => {
    const { inv } = build();
    inv.addItem('rusty_knife', 1, true);
    inv.addItem('sterile_bandage', 1, true);
    const seen: number[] = [];
    for (let i = 0; i < 4; i++) seen.push(inv.cycleHotbarSlot(1));
    expect(seen).toEqual([1, 2, 3, 0]);
    expect(inv.cycleHotbarSlot(-1)).toBe(3);
  });

  it('marca o encaixe da mão na barra inferior', () => {
    const { inv } = build();
    inv.addItem('rusty_knife', 1, true);
    inv.addItem('magnesium_flare', 1, true);
    const hubBar = harness!.viewport.querySelector('[data-hub-bar]')!;
    const slot0 = hubBar.querySelector('[data-hub-quick="0"]')!;
    const slot1 = hubBar.querySelector('[data-hub-quick="1"]')!;
    expect(slot0.classList.contains('selected')).toBe(true);
    inv.selectHotbarSlot(1);
    expect(slot0.classList.contains('selected')).toBe(false);
    expect(slot1.classList.contains('selected')).toBe(true);
  });
});

describe('cinto no inventário — largar no chão [Q]', () => {
  it('avisa o mundo e tira o item do bolso', () => {
    const { inv, c } = build();
    inv.addItem('sterile_bandage', 2, true);
    expect(inv.dropHeldItem()).toBe(true);
    expect(c.dropped).toEqual(['sterile_bandage']);
    expect(inv.getHeldItem()?.quantity).toBe(1);
  });

  it('não perde o item quando o mundo recusa o descarte', () => {
    const { inv, c } = build({ acceptDrop: false });
    inv.addItem('magnesium_flare', 1, true);
    expect(inv.dropHeldItem()).toBe(false);
    expect(c.dropped).toEqual([]);
    expect(inv.hasItem('magnesium_flare')).toBe(true);
    expect(inv.getHeldItem()?.itemId).toBe('magnesium_flare');
  });

  it('mantém no bolso o que é essencial (canivete e lanterna)', () => {
    const { inv, c } = build();
    inv.addItem('rusty_knife', 1, true);
    expect(inv.dropHeldItem()).toBe(false);
    expect(c.dropped).toEqual([]);
    expect(inv.hasItem('rusty_knife')).toBe(true);
  });

  it('não faz nada quando a mão está vazia', () => {
    const { inv, c } = build();
    expect(inv.dropHeldItem()).toBe(false);
    expect(inv.useHeldItem()).toBe(false);
    expect(c.dropped).toEqual([]);
  });
});

describe('cinto no inventário — organizar pelo [Tab]', () => {
  it('atribui, troca de lugar e limpa encaixes', () => {
    const { inv } = build();
    inv.addItem('rusty_knife', 1, true);
    inv.addItem('sterile_bandage', 1, true);

    // Passa o canivete para o encaixe [3].
    expect(inv.assignHotbarSlot(2, 'rusty_knife')).toBe(true);
    expect(inv.getBeltIndexOfItem('rusty_knife')).toBe(2);

    // Limpar devolve o encaixe ao estado vazio.
    expect(inv.assignHotbarSlot(2, null)).toBe(true);
    expect(inv.getBeltIndexOfItem('rusty_knife')).toBe(-1);
    expect(inv.hasItem('rusty_knife')).toBe(true); // continua na mochila
  });

  it('troca dois encaixes quando o item já estava em outro', () => {
    const { inv } = build();
    inv.addItem('rusty_knife', 1, true); // [1]
    inv.addItem('sterile_bandage', 1, true); // [2]
    inv.assignHotbarSlot(1, 'rusty_knife');
    expect(inv.getHotbarSlots().map((s) => s.itemId)).toEqual([
      'sterile_bandage',
      'rusty_knife',
    ]);
  });

  it('recusa encaixe inexistente e item que não está no bolso', () => {
    const { inv } = build();
    inv.addItem('rusty_knife', 1, true);
    expect(inv.assignHotbarSlot(4, 'rusty_knife')).toBe(false);
    expect(inv.assignHotbarSlot(-1, 'rusty_knife')).toBe(false);
    expect(inv.assignHotbarSlot(1, 'old_morphine')).toBe(false);
  });

  it('liga e desliga o item no encaixe com o mesmo botão', () => {
    const { inv } = build();
    inv.addItem('rusty_knife', 1, true);
    inv.toggleHotbarSlotForItem('rusty_knife', 0);
    expect(inv.getBeltIndexOfItem('rusty_knife')).toBe(-1);
    inv.toggleHotbarSlotForItem('rusty_knife', 0);
    expect(inv.getBeltIndexOfItem('rusty_knife')).toBe(0);
  });

  it('esquece do cinto um item que saiu do bolso por outra via', () => {
    const { inv } = build();
    inv.addItem('rusty_knife', 1, true);
    inv.addItem('sterile_bandage', 1, true);
    inv.consumeItemById('rusty_knife', 1);
    inv.syncHotbarWithBackpack();
    expect(inv.getBeltIndexOfItem('rusty_knife')).toBe(-1);
    expect(inv.getBeltIndexOfItem('sterile_bandage')).toBe(1);
  });
});
