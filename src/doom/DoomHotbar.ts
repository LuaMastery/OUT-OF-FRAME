/**
 * CINTO TÁTICO — MODELO PURO DOS ATALHOS [1]–[4]
 * ============================================================================
 *
 * Regras do cinto, no estilo Lethal Company:
 *
 *  1. O cinto tem QUATRO encaixes e um deles está sempre selecionado — mesmo
 *     vazio. Não existe "atalho desativado": apertar [3] só troca o que está
 *     na mão, nunca gasta o item.
 *  2. O que você recolhe vai para o PRIMEIRO ENCAIXE LIVRE, da esquerda para a
 *     direita, sem precisar abrir o inventário. Só quando os quatro estão
 *     ocupados o item cai na mochila (a grade de 20 bolsos do [Tab]).
 *  3. A roda do mouse percorre os encaixes em círculo, inclusive os vazios.
 *  4. [Q] larga o item da mão no chão, e ele volta a ser um objeto pegável.
 *
 * Este módulo é PURO (só números e nomes): nenhuma função aqui toca no DOM nem
 * no motor de áudio, então o comportamento do cinto pode ser verificado por
 * testes sem precisar montar a interface.
 */

/** Quantidade de encaixes do cinto: teclas [1], [2], [3] e [4]. */
export const HOTBAR_SLOT_COUNT = 4;

/**
 * Tipos que NUNCA ocupam o cinto sozinhos.
 *
 * Cada um tem tecla própria ([F] lanterna, [M] radar, [R] rádio) ou não se usa
 * pela mão (chaves, bilhetes e peças de arma saem da mochila). Deixar esses
 * itens tomarem os quatro encaixes automaticamente faria o cinto entupir de
 * coisa que o jogador não usa com clique.
 */
const NON_BELT_KINDS: readonly string[] = [
  'lantern',
  'radar',
  'walkie',
  'key',
  'note',
  'shotgun_part',
  'shotgun',
];

/** O identificador do item em cada encaixe (null = encaixe vazio). */
export type HotbarSlots = ReadonlyArray<string | null>;

export interface HotbarItemLike {
  readonly id: string;
  readonly kind: string;
  readonly usable: boolean;
  /** Itens sem este campo (ou com true) podem ser largados no chão. */
  readonly droppable?: boolean;
}

/** Um cinto novo, com todos os encaixes vazios. */
export function createHotbarSlots(): Array<string | null> {
  return new Array<string | null>(HOTBAR_SLOT_COUNT).fill(null);
}

/** Verdadeiro quando o tipo de item entra no cinto sozinho ao ser recolhido. */
export function goesToHotbarAutomatically(item: {
  kind: string;
  usable: boolean;
}): boolean {
  if (!item.usable) return false;
  return !NON_BELT_KINDS.includes(item.kind);
}

/** Primeiro encaixe livre (-1 quando o cinto está cheio). */
export function firstEmptyHotbarSlot(slots: HotbarSlots): number {
  return slots.findIndex((s) => s === null);
}

/** Em qual encaixe o item já está (-1 quando não está no cinto). */
export function hotbarIndexOfItem(
  slots: HotbarSlots,
  itemId: string
): number {
  return slots.findIndex((s) => s === itemId);
}

/** Verdadeiro quando não há nenhum encaixe livre. */
export function isHotbarFull(slots: HotbarSlots): boolean {
  return firstEmptyHotbarSlot(slots) < 0;
}

/**
 * Decide onde um item recolhido deve parar.
 *
 * Devolve o encaixe a preencher ou -1, meaning "vai para a mochila": quando o
 * item já está no cinto, quando não é do tipo que ocupa o cinto sozinho, ou
 * quando os quatro encaixes já estão cheios.
 */
export function planHotbarPickup(
  slots: HotbarSlots,
  item: HotbarItemLike
): number {
  if (hotbarIndexOfItem(slots, item.id) >= 0) return -1;
  if (!goesToHotbarAutomatically(item)) return -1;
  return firstEmptyHotbarSlot(slots);
}

/**
 * Percorre os encaixes em círculo (roda do mouse / teclas de ciclo).
 *
 * O índice volta ao começo depois do último e vice-versa, exatamente como no
 * Lethal Company: não há "fim de lista".
 */
export function cycleHotbarIndex(current: number, direction: 1 | -1): number {
  const count = HOTBAR_SLOT_COUNT;
  const safe = Number.isFinite(current) ? Math.trunc(current) : 0;
  const step = direction >= 0 ? 1 : -1;
  return (((safe + step) % count) + count) % count;
}

/** Converte a tecla numérica [1]–[4] no índice do encaixe. */
export function hotbarKeyToIndex(keyNumber: number): number {
  const idx = Math.trunc(keyNumber) - 1;
  if (idx < 0 || idx >= HOTBAR_SLOT_COUNT) return -1;
  return idx;
}

/** Verdadeiro quando o item pode ser largado no chão. */
export function canDropHotbarItem(item: HotbarItemLike): boolean {
  return item.droppable !== false;
}

/**
 * Recoloca o cinto depois que um item acabou (pilha zerada, item consumido).
 *
 * Se o item sumiu de vez, o encaixe fica vazio; se ainda existe outra pilha
 * igual na mochila, o encaixe passa a apontar para ela, para o jogador não
 * precisar reatribuir o atalho toda vez que termina um curativo.
 *
 * `backpackIds` é o conteúdo da mochila na mesma ordem da grade do [Tab]; o
 * índice devolvido aponta para uma posição dela.
 */
export function resolveHotbarAfterItemGone(
  slots: HotbarSlots,
  backpackIds: ReadonlyArray<string | null>,
  goneItemId: string
): Array<string | null> {
  const next = [...slots];
  const beltIdx = hotbarIndexOfItem(next, goneItemId);
  if (beltIdx < 0) return next;

  const stillInBackpack = backpackIds.findIndex((id) => id === goneItemId);
  next[beltIdx] = stillInBackpack >= 0 ? goneItemId : null;
  return next;
}

/**
 * Remove do cinto as referências quebradas (bolsos que esvaziaram por outra
 * via, como a montagem da arma consumindo as peças).
 */
export function pruneHotbar(
  slots: HotbarSlots,
  isItemAvailable: (itemId: string) => boolean
): Array<string | null> {
  return slots.map((id) => (id !== null && isItemAvailable(id) ? id : null));
}

/**
 * Troca dois encaixes de posição (arrastar um item para outro número).
 * Devolve o cinto inalterado quando algum índice é inválido.
 */
export function swapHotbarSlots(
  slots: HotbarSlots,
  from: number,
  to: number
): Array<string | null> {
  if (from === to) return [...slots];
  if (from < 0 || from >= HOTBAR_SLOT_COUNT) return [...slots];
  if (to < 0 || to >= HOTBAR_SLOT_COUNT) return [...slots];
  const next = [...slots];
  const moved = next[from];
  next[from] = next[to];
  next[to] = moved;
  return next;
}

/**
 * O texto do que está na mão, do jeito que aparece acima da barra.
 * Encaixe vazio não tem nome: a barra fica limpa, sem rótulo algum.
 */
export function formatHeldItemLabel(
  name: string,
  quantity: number
): string {
  if (!name) return '';
  return quantity > 1 ? `${name} ×${quantity}` : name;
}
