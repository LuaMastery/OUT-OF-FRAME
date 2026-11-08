/**
 * Identificador geracional empacotado em 32 bits:
 * - 20 bits inferiores: índice no pool (até 1.048.576 entidades simultâneas)
 * - 12 bits superiores: geração do slot (detecta referências obsoletas em O(1))
 */
export type EntityId = number;

export const INDEX_BITS = 20;
export const INDEX_MASK = (1 << INDEX_BITS) - 1;
export const GEN_MASK = 0xfff;

export function packEntity(index: number, generation: number): EntityId {
  return ((generation & GEN_MASK) << INDEX_BITS) | (index & INDEX_MASK);
}

export function unpackIndex(entity: EntityId): number {
  return entity & INDEX_MASK;
}

export function unpackGeneration(entity: EntityId): number {
  return (entity >>> INDEX_BITS) & GEN_MASK;
}

/**
 * Definição tipada de um tipo de componente registrado por bitmask.
 */
export interface ComponentType<T> {
  readonly id: number;
  readonly bit: number;
  readonly name: string;
  /** Marca fantasma apenas para inferência estática no TypeScript */
  readonly __type?: T;
}

export interface SystemContext {
  /** Passo fixo determinístico no tempo dilatado do mundo (em segundos simulados) */
  simDt: number;
  /** Delta real não-escalado da tela (para câmera, HUD e shaders de UI) */
  realDt: number;
  /** Fator atual de dilatação temporal [0..1+] */
  timeScale: number;
  /** Fração residual [0..1] do acumulador fixo para interpolação suave de renderização */
  alpha: number;
}
