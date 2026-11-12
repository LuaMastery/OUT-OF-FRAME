/**
 * Sistema de Saves do OUT-OF-FRAME — cinco slots de incursão no navegador.
 *
 * Aqui mora só o MODELO: os tipos do que é gravado, a leitura/escrita e o
 * resumo de cada slot para a lista. Nenhuma linha deste arquivo toca em THREE,
 * no DOM ou na engine — é de propósito, para que a regra de negócio (o que faz
 * um save ser válido, o que acontece quando ele estraga, como os slots se
 * organizam) possa ser testada sem subir o jogo inteiro.
 *
 * Quem conversa com o jogo é o `DoomGameApp`, que transforma o mundo vivo em
 * um `DoomSavePayload` e o transforma de volta. Este arquivo apenas guarda,
 * lista, valida e apaga.
 */

/** Quantos saves o jogador pode ter ao mesmo tempo. */
export const SAVE_SLOT_COUNT = 5;

/**
 * Versão do formato. Se o formato mudar de forma incompatível no futuro,
 * o número sobe e os saves antigos são ignorados em vez de carregados tortos.
 */
export const SAVE_FORMAT_VERSION = 1;

/** Prefixo das chaves no armazenamento local. */
export const SAVE_STORAGE_PREFIX = 'oof_doom_save_v1';

/** Tamanho máximo (em caracteres) aceito por slot, para não estourar a cota. */
export const SAVE_MAX_CHARS = 512_000;

/**
 * O que um save guarda de verdade.
 *
 * Tudo aqui é dado simples — números, textos e listas — porque o save precisa
 * sobreviver a um `JSON.stringify`. Nenhum objeto do THREE entra: o labirinto
 * é reconstruído a partir das SEMENTES (`worldSeed`/`playerSeed`), e só o que
 * o jogador MUDOU no mundo é gravado por cima.
 */
export interface DoomSavePayload {
  readonly version: number;
  /** Semente do mundo: com ela o labirinto, caixotes e espólio renascem iguais. */
  readonly worldSeed: number;
  /** Semente de spawn do jogador (só influencia onde ele nasce). */
  readonly playerSeed: number;
  /** Quantas peças de escopeta o mundo gerou (4 por jogador). */
  readonly shotgunPartSlots: number;

  /** Onde o jogador está e para onde olha. */
  readonly player: {
    x: number;
    y: number;
    z: number;
    yaw: number;
    pitch: number;
  };

  /** Sobrevivência: vida, sanidade, bateria da lanterna, hemorragia. */
  readonly vitals: {
    health: number;
    sanity: number;
    battery: number;
    bleeding: boolean;
    stamina: number;
  };

  /** O que o jogador carrega. */
  readonly inventory: {
    /** Um item por bolso, na ordem; `null` é bolso vazio. */
    readonly slots: ReadonlyArray<{ id: string; quantity: number } | null>;
    /** Cinto: quatro posições, cada uma com a referência a um item dos bolsos. */
    readonly hotbar: ReadonlyArray<string | null>;
    /** Qual encaixe do cinto está na mão (0..3). */
    readonly heldSlot: number;
  };

  /** O que o jogador já mudou no mundo. */
  readonly world: {
    /** ids dos objetos já recolhidos — renascem escondidos. */
    readonly collectedPickupIds: ReadonlyArray<string>;
    /** índices dos caixotes já abertos. */
    readonly openedCrateIndices: ReadonlyArray<number>;
    /** Objetos largados no chão pelo jogador (não existem no layout original). */
    readonly droppedItems: ReadonlyArray<{
      id: string;
      itemId: string;
      x: number;
      z: number;
      yaw: number;
    }>;
  };

  /** Salas especiais já destrancadas com a chave. */
  readonly unlockedRoomIds: ReadonlyArray<string>;

  /** Estado dos equipamentos de tecla própria. */
  readonly gear: {
    flashlightOn: boolean;
    radarOn: boolean;
    walkieOn: boolean;
    shotgunEquipped: boolean;
  };

  /** Progresso e estatística da incursão. */
  readonly run: {
    /** Segundos de incursão (o cronômetro do HUD). */
    elapsedSec: number;
    /** Quantas vezes este mesmo save já morreu. */
    deaths: number;
    /** Setor/sala onde o jogador estava, para a lista de saves. */
    sector: string;
  };

  /** Só para a lista: quando o save nasceu e quando foi gravado. */
  readonly meta: {
    createdAt: number;
    updatedAt: number;
  };
}

/**
 * Como um slot aparece na LISTA de saves.
 *
 * A lista não precisa carregar o payload inteiro de cada slot toda vez que
 * abre o menu, então o resumo guarda só o que aparece na tela. Ainda assim é
 * derivado do payload real, para nunca mentir sobre o que tem dentro.
 */
export interface SaveSlotSummary {
  readonly slot: number;
  readonly empty: boolean;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly elapsedSec: number;
  readonly health: number;
  readonly sanity: number;
  readonly bleeding: boolean;
  /** Quantos itens (somando as pilhas) o jogador carrega. */
  readonly itemCount: number;
  /** A escopeta já está montada e na mochila. */
  readonly shotgunReady: boolean;
  readonly sector: string;
  readonly deaths: number;
}

/** O mínimo de `localStorage` que este módulo precisa — e nada mais. */
export interface SaveStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Resultado de uma gravação — gravar pode falhar por cota cheia. */
export interface SaveWriteResult {
  ok: boolean;
  /** Motivo legível para o jogador quando `ok` é falso. */
  error?: string;
}

/** Chave de armazenamento de um slot. */
export function saveSlotStorageKey(slot: number): string {
  return `${SAVE_STORAGE_PREFIX}_slot${slot}`;
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const entry of value) {
    if (typeof entry === 'string' && entry.length > 0) out.push(entry);
  }
  return out;
}

function asNumberArray(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  const out: number[] = [];
  for (const entry of value) {
    if (typeof entry === 'number' && Number.isFinite(entry)) out.push(entry);
  }
  return out;
}

/**
 * Converte qualquer coisa que veio do armazenamento em um payload confiável.
 *
 * Esta função é a muralha do sistema: um save pode ter sido escrito por outra
 * versão do jogo, cortado no meio por falta de espaço ou editado à mão pelo
 * jogador curioso. Em vez de confiar, cada campo é conferido e recebe um valor
 * seguro quando está torto — e se o save estiver irreconhecível, devolvemos
 * `null` e o slot passa a valer por vazio.
 */
export function sanitizeSavePayload(raw: unknown): DoomSavePayload | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const data = raw as Record<string, unknown>;

  // A versão precisa bater: um save de um formato que não entendemos é
  // descartado com educação, nunca interpretado pela metade.
  if (clampNumber(data.version, 0, 1e6, -1) !== SAVE_FORMAT_VERSION) return null;

  const worldSeed = clampNumber(data.worldSeed, 0, 0xffffffff, -1);
  if (worldSeed < 0) return null; // sem semente não há como reconstruir o mundo

  const playerRaw = (data.player ?? {}) as Record<string, unknown>;
  const vitalsRaw = (data.vitals ?? {}) as Record<string, unknown>;
  const invRaw = (data.inventory ?? {}) as Record<string, unknown>;
  const worldRaw = (data.world ?? {}) as Record<string, unknown>;
  const gearRaw = (data.gear ?? {}) as Record<string, unknown>;
  const runRaw = (data.run ?? {}) as Record<string, unknown>;
  const metaRaw = (data.meta ?? {}) as Record<string, unknown>;

  // Bolsos: ids conhecidos entram, quantidade negativa ou zero vira 1.
  const slotsRaw = Array.isArray(invRaw.slots) ? invRaw.slots : [];
  const slots: Array<{ id: string; quantity: number } | null> = [];
  for (const entry of slotsRaw) {
    if (typeof entry !== 'object' || entry === null) {
      slots.push(null);
      continue;
    }
    const slot = entry as Record<string, unknown>;
    const id = typeof slot.id === 'string' && slot.id.length > 0 ? slot.id : null;
    if (!id) {
      slots.push(null);
      continue;
    }
    const quantity = Math.max(
      1,
      Math.floor(clampNumber(slot.quantity, 1, 999, 1))
    );
    slots.push({ id, quantity });
  }

  // Cinto: quatro posições. Um item no cinto que não existe nos bolsos é
  // esquecido (acontece se o save for adulterado).
  const bagIds = new Set(
    slots.filter((s): s is { id: string; quantity: number } => s !== null).map((s) => s.id)
  );
  const hotbarRaw = Array.isArray(invRaw.hotbar) ? invRaw.hotbar : [];
  const hotbar: Array<string | null> = [];
  for (let i = 0; i < 4; i++) {
    const value = hotbarRaw[i];
    const id = typeof value === 'string' && bagIds.has(value) ? value : null;
    hotbar.push(id);
  }

  const droppedRaw = Array.isArray(worldRaw.droppedItems) ? worldRaw.droppedItems : [];
  const droppedItems = droppedRaw
    .map((entry) => {
      if (typeof entry !== 'object' || entry === null) return null;
      const item = entry as Record<string, unknown>;
      const id = typeof item.id === 'string' ? item.id : '';
      const itemId = typeof item.itemId === 'string' ? item.itemId : '';
      if (!id || !itemId) return null;
      return {
        id,
        itemId,
        x: clampNumber(item.x, -1e5, 1e5, 0),
        z: clampNumber(item.z, -1e5, 1e5, 0),
        yaw: clampNumber(item.yaw, -Infinity, Infinity, 0),
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

  const now = Date.now();

  return {
    version: SAVE_FORMAT_VERSION,
    worldSeed,
    playerSeed: clampNumber(data.playerSeed, 0, 0xffffffff, worldSeed),
    shotgunPartSlots: Math.round(clampNumber(data.shotgunPartSlots, 0, 64, 4)),
    player: {
      x: clampNumber(playerRaw.x, -1e5, 1e5, 0),
      y: clampNumber(playerRaw.y, -1e3, 1e3, 1.62),
      z: clampNumber(playerRaw.z, -1e5, 1e5, 0),
      yaw: clampNumber(playerRaw.yaw, -100, 100, 0),
      pitch: clampNumber(playerRaw.pitch, -2, 2, 0),
    },
    vitals: {
      health: clampNumber(vitalsRaw.health, 0, 100, 100),
      sanity: clampNumber(vitalsRaw.sanity, 0, 100, 100),
      battery: clampNumber(vitalsRaw.battery, 0, 100, 100),
      bleeding: vitalsRaw.bleeding === true,
      stamina: clampNumber(vitalsRaw.stamina, 0, 100, 100),
    },
    inventory: {
      slots,
      hotbar,
      heldSlot: Math.round(clampNumber(invRaw.heldSlot, 0, 3, 0)),
    },
    world: {
      collectedPickupIds: asStringArray(worldRaw.collectedPickupIds),
      openedCrateIndices: asNumberArray(worldRaw.openedCrateIndices).map((n) =>
        Math.round(n)
      ),
      droppedItems,
    },
    unlockedRoomIds: asStringArray(data.unlockedRoomIds),
    gear: {
      flashlightOn: gearRaw.flashlightOn === true,
      radarOn: gearRaw.radarOn === true,
      walkieOn: gearRaw.walkieOn === true,
      shotgunEquipped: gearRaw.shotgunEquipped === true,
    },
    run: {
      elapsedSec: Math.max(0, clampNumber(runRaw.elapsedSec, 0, 1e7, 0)),
      deaths: Math.max(0, Math.round(clampNumber(runRaw.deaths, 0, 1e6, 0))),
      sector: typeof runRaw.sector === 'string' ? runRaw.sector.slice(0, 64) : '',
    },
    meta: {
      createdAt: clampNumber(metaRaw.createdAt, 0, 1e15, now),
      updatedAt: clampNumber(metaRaw.updatedAt, 0, 1e15, now),
    },
  };
}

/** Lê um slot. Devolve `null` quando está vazio ou ilegível. */
export function readSaveSlot(
  storage: SaveStorageLike,
  slot: number
): DoomSavePayload | null {
  let raw: string | null = null;
  try {
    raw = storage.getItem(saveSlotStorageKey(slot));
  } catch {
    return null; // armazenamento bloqueado (modo privado, por exemplo)
  }
  if (!raw) return null;
  try {
    return sanitizeSavePayload(JSON.parse(raw));
  } catch {
    // JSON cortado no meio: o slot passa a valer por vazio em vez de derrubar
    // o menu inteiro.
    return null;
  }
}

/** Grava um slot. Devolve `{ ok: false }` com o motivo se não der. */
export function writeSaveSlot(
  storage: SaveStorageLike,
  slot: number,
  payload: DoomSavePayload
): SaveWriteResult {
  let text: string;
  try {
    text = JSON.stringify(payload);
  } catch {
    return { ok: false, error: 'Não foi possível empacotar o progresso.' };
  }
  if (text.length > SAVE_MAX_CHARS) {
    return { ok: false, error: 'O progresso ficou grande demais para salvar.' };
  }
  try {
    storage.setItem(saveSlotStorageKey(slot), text);
    return { ok: true };
  } catch {
    return {
      ok: false,
      error: 'O navegador recusou gravar (armazenamento cheio ou bloqueado).',
    };
  }
}

/** Apaga um slot. */
export function clearSaveSlot(storage: SaveStorageLike, slot: number): void {
  try {
    storage.removeItem(saveSlotStorageKey(slot));
  } catch {
    /* apagar é melhor-esforço: não há o que fazer se o acesso foi negado */
  }
}

/**
 * Monta o resumo de um save para a lista.
 *
 * Separado de `readSaveSlot` porque o menu mostra os cinco slots de uma vez e
 * o resumo é a única parte que a interface consome.
 */
export function summarizeSave(
  slot: number,
  payload: DoomSavePayload | null
): SaveSlotSummary {
  if (!payload) {
    return {
      slot,
      empty: true,
      createdAt: 0,
      updatedAt: 0,
      elapsedSec: 0,
      health: 0,
      sanity: 0,
      bleeding: false,
      itemCount: 0,
      shotgunReady: false,
      sector: '',
      deaths: 0,
    };
  }

  let itemCount = 0;
  let shotgunReady = false;
  for (const entry of payload.inventory.slots) {
    if (!entry) continue;
    itemCount += entry.quantity;
    if (entry.id === 'combat_shotgun') shotgunReady = true;
  }

  return {
    slot,
    empty: false,
    createdAt: payload.meta.createdAt,
    updatedAt: payload.meta.updatedAt,
    elapsedSec: payload.run.elapsedSec,
    health: payload.vitals.health,
    sanity: payload.vitals.sanity,
    bleeding: payload.vitals.bleeding,
    itemCount,
    shotgunReady,
    sector: payload.run.sector,
    deaths: payload.run.deaths,
  };
}

/** Lista os cinco slots, na ordem, já resumidos. */
export function listSaveSlots(
  storage: SaveStorageLike
): ReadonlyArray<SaveSlotSummary> {
  const out: SaveSlotSummary[] = [];
  for (let slot = 0; slot < SAVE_SLOT_COUNT; slot++) {
    out.push(summarizeSave(slot, readSaveSlot(storage, slot)));
  }
  return out;
}

/**
 * Existe algum save? É assim que o jogo decide se o jogador é novato.
 *
 * Um slot corrompido NÃO conta como save: se o único slot estava ilegível, o
 * tutorial aparece de novo em vez de deixar o jogador na mão.
 */
export function hasAnySave(storage: SaveStorageLike): boolean {
  for (let slot = 0; slot < SAVE_SLOT_COUNT; slot++) {
    if (readSaveSlot(storage, slot) !== null) return true;
  }
  return false;
}

/** Data/hora curta para a lista de saves (pt-BR). */
export function formatSaveTimestamp(ms: number): string {
  if (!ms) return '—';
  try {
    return new Date(ms).toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '—';
  }
}

/** Duração da incursão em `h:mm:ss` ou `m:ss`, curta o bastante para a lista. */
export function formatSaveDuration(totalSec: number): string {
  const sec = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const mm = String(m).padStart(h > 0 ? 2 : 1, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Rótulo do slot: "SAVE 01" … "SAVE 05". */
export function formatSlotLabel(slot: number): string {
  return `SAVE ${String(slot + 1).padStart(2, '0')}`;
}

/** Rótulo legível do estado de saúde para a lista. */
export function formatHealthLabel(summary: SaveSlotSummary): string {
  if (summary.empty) return 'vazio';
  const hp = Math.round(summary.health);
  if (summary.bleeding) return `${hp}% · sangrando`;
  return `${hp}%`;
}

/**
 * Pega o armazenamento do navegador quando ele existe.
 *
 * Em sessões sem `localStorage` (alguns modos privados, ou testes no Node sem
 * polyfill) devolvemos um armazenamento de mentira, que guarda tudo na memória
 * e esquece ao fechar. Assim o jogo continua funcionando — só não salva.
 */
export function getBrowserSaveStorage(): SaveStorageLike {
  try {
    if (typeof localStorage !== 'undefined' && localStorage) {
      const probe = '__oof_save_probe__';
      localStorage.setItem(probe, '1');
      localStorage.removeItem(probe);
      return localStorage;
    }
  } catch {
    /* acesso negado: cai no armazenamento de memória */
  }
  return createMemorySaveStorage();
}

/** Armazenamento volátil, usado quando o navegador não deixa gravar. */
export function createMemorySaveStorage(): SaveStorageLike {
  const map = new Map<string, string>();
  return {
    getItem: (key) => (map.has(key) ? map.get(key)! : null),
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
}
