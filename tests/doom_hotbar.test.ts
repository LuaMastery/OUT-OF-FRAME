import { describe, it, expect } from 'vitest';
import {
  canDropHotbarItem,
  createHotbarSlots,
  cycleHotbarIndex,
  firstEmptyHotbarSlot,
  formatHeldItemLabel,
  goesToHotbarAutomatically,
  HOTBAR_SLOT_COUNT,
  hotbarIndexOfItem,
  hotbarKeyToIndex,
  isHotbarFull,
  planHotbarPickup,
  pruneHotbar,
  resolveHotbarAfterItemGone,
  swapHotbarSlots,
  type HotbarItemLike,
} from '../src/doom/DoomHotbar';

const item = (
  id: string,
  kind: string,
  droppable = true
): HotbarItemLike => ({ id, kind, usable: true, droppable });

describe('cinto tático — forma', () => {
  it('tem quatro encaixes, como no Lethal Company', () => {
    expect(HOTBAR_SLOT_COUNT).toBe(4);
    expect(createHotbarSlots()).toHaveLength(4);
  });

  it('nasce vazio e vai enchendo da esquerda para a direita', () => {
    const belt = createHotbarSlots();
    expect(firstEmptyHotbarSlot(belt)).toBe(0);
    expect(isHotbarFull(belt)).toBe(false);

    belt[0] = 'knife';
    expect(firstEmptyHotbarSlot(belt)).toBe(1);

    belt[1] = 'bandage';
    belt[2] = 'flare';
    belt[3] = 'battery';
    expect(firstEmptyHotbarSlot(belt)).toBe(-1);
    expect(isHotbarFull(belt)).toBe(true);
  });

  it('converte as teclas [1]–[4] nos índices e recusa o que estiver fora', () => {
    expect(hotbarKeyToIndex(1)).toBe(0);
    expect(hotbarKeyToIndex(4)).toBe(3);
    expect(hotbarKeyToIndex(0)).toBe(-1);
    expect(hotbarKeyToIndex(5)).toBe(-1);
  });
});

describe('cinto tático — o que entra sozinho', () => {
  it('guarda suprimentos e ferramentas de uso manual', () => {
    for (const kind of ['knife', 'bandage', 'morphine', 'battery', 'flare']) {
      expect(goesToHotbarAutomatically({ kind, usable: true })).toBe(true);
    }
  });

  it('deixa de fora o que já tem tecla própria ou não se usa pela mão', () => {
    for (const kind of [
      'lantern',
      'radar',
      'walkie',
      'key',
      'note',
      'shotgun_part',
      'shotgun',
    ]) {
      expect(goesToHotbarAutomatically({ kind, usable: true })).toBe(false);
    }
  });

  it('nunca coloca no cinto um item que não pode ser usado', () => {
    expect(goesToHotbarAutomatically({ kind: 'note', usable: false })).toBe(
      false
    );
  });
});

describe('cinto tático — recolher itens', () => {
  it('preenche o primeiro encaixe livre', () => {
    const belt = createHotbarSlots();
    expect(planHotbarPickup(belt, item('rusty_knife', 'knife'))).toBe(0);

    const half = ['rusty_knife', null, null, null];
    expect(planHotbarPickup(half, item('sterile_bandage', 'bandage'))).toBe(1);
  });

  it('não ocupa dois encaixes com o mesmo item', () => {
    const belt = ['sterile_bandage', 'rusty_knife', null, null];
    expect(planHotbarPickup(belt, item('sterile_bandage', 'bandage'))).toBe(-1);
  });

  it('manda para a mochila quando o cinto está cheio', () => {
    const belt = ['a', 'b', 'c', 'd'];
    expect(isHotbarFull(belt)).toBe(true);
    expect(planHotbarPickup(belt, item('e', 'bandage'))).toBe(-1);
  });

  it('manda para a mochila o que não pertence ao cinto', () => {
    const belt = createHotbarSlots();
    expect(planHotbarPickup(belt, item('sector_b_key', 'key'))).toBe(-1);
    expect(planHotbarPickup(belt, item('tactical_lantern', 'lantern'))).toBe(
      -1
    );
  });

  it('encontra em qual encaixe um item está', () => {
    const belt = ['a', 'b', 'c', null];
    expect(hotbarIndexOfItem(belt, 'c')).toBe(2);
    expect(hotbarIndexOfItem(belt, 'd')).toBe(-1);
  });
});

describe('cinto tático — percorrer os encaixes', () => {
  it('dá a volta no fim da lista nos dois sentidos', () => {
    expect(cycleHotbarIndex(0, 1)).toBe(1);
    expect(cycleHotbarIndex(3, 1)).toBe(0);
    expect(cycleHotbarIndex(0, -1)).toBe(3);
    expect(cycleHotbarIndex(2, -1)).toBe(1);
  });

  it('nunca sai da faixa válida, mesmo com índice corrompido', () => {
    for (let i = -3; i <= 6; i++) {
      const next = cycleHotbarIndex(i, 1);
      expect(next).toBeGreaterThanOrEqual(0);
      expect(next).toBeLessThan(HOTBAR_SLOT_COUNT);
    }
    expect(cycleHotbarIndex(Number.NaN, 1)).toBe(1);
  });

  it('volta ao ponto de partida depois de uma volta completa', () => {
    let idx = 2;
    for (let i = 0; i < HOTBAR_SLOT_COUNT; i++) idx = cycleHotbarIndex(idx, 1);
    expect(idx).toBe(2);
  });
});

describe('cinto tático — consumir e largar', () => {
  it('esvazia o encaixe quando o item acaba de vez', () => {
    const belt = ['sterile_bandage', 'rusty_knife', null, null];
    const next = resolveHotbarAfterItemGone(belt, [], 'sterile_bandage');
    expect(next[0]).toBeNull();
    expect(next[1]).toBe('rusty_knife');
  });

  it('reaproveita o encaixe quando ainda há outra pilha igual na mochila', () => {
    const belt = ['sterile_bandage', 'rusty_knife', null, null];
    const backpack = [null, 'sterile_bandage', null];
    const next = resolveHotbarAfterItemGone(
      belt,
      backpack,
      'sterile_bandage'
    );
    expect(next[0]).toBe('sterile_bandage');
  });

  it('ignora itens que não estavam no cinto', () => {
    const belt = ['a', null, null, null];
    expect(resolveHotbarAfterItemGone(belt, [], 'z')).toEqual(belt);
  });

  it('larga no chão o que é descartável e segura o que não é', () => {
    expect(canDropHotbarItem(item('rusty_knife', 'knife'))).toBe(true);
    expect(canDropHotbarItem(item('tactical_lantern', 'lantern', false))).toBe(
      false
    );
  });
});

describe('cinto tático — organizar pelo inventário', () => {
  it('troca dois encaixes de posição', () => {
    const belt = ['a', 'b', 'c', null];
    expect(swapHotbarSlots(belt, 0, 2)).toEqual(['c', 'b', 'a', null]);
    expect(swapHotbarSlots(belt, 1, 1)).toEqual(belt);
  });

  it('ignora trocas com índices fora da faixa', () => {
    const belt = ['a', 'b', 'c', null];
    expect(swapHotbarSlots(belt, 0, 9)).toEqual(belt);
    expect(swapHotbarSlots(belt, -1, 2)).toEqual(belt);
  });

  it('limpa encaixes cujo item sumiu do mundo (peças consumidas pela arma)', () => {
    const belt = ['shotgun_barrel', 'rusty_knife', 'note_1', null];
    const available = new Set(['rusty_knife']);
    expect(pruneHotbar(belt, (id) => available.has(id))).toEqual([
      null,
      'rusty_knife',
      null,
      null,
    ]);
  });
});

describe('cinto tático — rótulo do item na mão', () => {
  it('mostra a quantidade só quando o item empilha', () => {
    expect(formatHeldItemLabel('Rolo de gaze', 1)).toBe('Rolo de gaze');
    expect(formatHeldItemLabel('Rolo de gaze', 3)).toBe('Rolo de gaze ×3');
  });

  it('não mostra nada quando a mão está vazia', () => {
    expect(formatHeldItemLabel('', 1)).toBe('');
  });
});
