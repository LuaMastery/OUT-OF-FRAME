import {
  ComponentType,
  EntityId,
  GEN_MASK,
  packEntity,
  unpackGeneration,
  unpackIndex,
} from './types';

let nextComponentId = 0;

/**
 * Registra um tipo de componente puro (apenas dados) associado a um bit único de assinatura.
 */
export function defineComponent<T>(name: string): ComponentType<T> {
  if (nextComponentId >= 30) {
    throw new Error(`Limite de 30 componentes por máscara de bits excedido em "${name}".`);
  }
  const id = nextComponentId++;
  return {
    id,
    bit: 1 << id,
    name,
  };
}

export type DestroyListener = (entity: EntityId, world: World) => void;

/**
 * Mundo ECS orientado a máscaras de bits e handles geracionais.
 *
 * Técnica-chave para OUT-OF-FRAME:
 * Em vez de espalhar condicionais `if (!obj.isCaptured)` em física, IA e colisão,
 * suspender um objeto recortado pela moldura consiste apenas em ligar o bit `PocketStasis`.
 * Qualquer sistema que consulte `(withMask, withoutMask = PocketStasis.bit)` ignora-o em O(1).
 */
export class World {
  private generations: Uint16Array;
  private masks: Int32Array;
  private aliveFlags: Uint8Array;
  private freeIndices: number[] = [];
  private highWaterMark = 0;
  private aliveCounter = 0;

  /** Armazenamento esparso indexado por [componentId][entityIndex] */
  private stores: Array<Array<unknown>> = [];
  private destroyListeners: DestroyListener[] = [];

  constructor(initialCapacity = 2048) {
    this.generations = new Uint16Array(initialCapacity);
    this.masks = new Int32Array(initialCapacity);
    this.aliveFlags = new Uint8Array(initialCapacity);
    for (let i = 0; i < 30; i++) {
      this.stores.push([]);
    }
  }

  private ensureCapacity(index: number): void {
    if (index < this.generations.length) return;
    const nextCap = Math.max(index + 1, this.generations.length * 2);
    const nextGen = new Uint16Array(nextCap);
    nextGen.set(this.generations);
    this.generations = nextGen;

    const nextMasks = new Int32Array(nextCap);
    nextMasks.set(this.masks);
    this.masks = nextMasks;

    const nextAlive = new Uint8Array(nextCap);
    nextAlive.set(this.aliveFlags);
    this.aliveFlags = nextAlive;
  }

  onEntityDestroyed(listener: DestroyListener): void {
    this.destroyListeners.push(listener);
  }

  createEntity(): EntityId {
    let index: number;
    if (this.freeIndices.length > 0) {
      index = this.freeIndices.pop()!;
    } else {
      index = this.highWaterMark++;
      this.ensureCapacity(index);
    }
    this.aliveFlags[index] = 1;
    this.masks[index] = 0;
    this.aliveCounter++;
    return packEntity(index, this.generations[index]);
  }

  isAlive(entity: EntityId): boolean {
    const index = unpackIndex(entity);
    if (index < 0 || index >= this.highWaterMark) return false;
    return this.aliveFlags[index] === 1 && this.generations[index] === unpackGeneration(entity);
  }

  destroyEntity(entity: EntityId): boolean {
    if (!this.isAlive(entity)) return false;

    for (let i = 0; i < this.destroyListeners.length; i++) {
      this.destroyListeners[i](entity, this);
    }

    const index = unpackIndex(entity);
    const mask = this.masks[index];
    for (let compId = 0; compId < this.stores.length; compId++) {
      if ((mask & (1 << compId)) !== 0) {
        this.stores[compId][index] = undefined;
      }
    }

    this.masks[index] = 0;
    this.aliveFlags[index] = 0;
    this.generations[index] = (this.generations[index] + 1) & GEN_MASK;
    this.freeIndices.push(index);
    this.aliveCounter--;
    return true;
  }

  add<T>(entity: EntityId, type: ComponentType<T>, data: T): T {
    if (!this.isAlive(entity)) {
      throw new Error(`Tentativa de adicionar "${type.name}" em entidade morta/obsoleta.`);
    }
    const index = unpackIndex(entity);
    this.stores[type.id][index] = data;
    this.masks[index] |= type.bit;
    return data;
  }

  remove<T>(entity: EntityId, type: ComponentType<T>): void {
    if (!this.isAlive(entity)) return;
    const index = unpackIndex(entity);
    this.stores[type.id][index] = undefined;
    this.masks[index] &= ~type.bit;
  }

  has<T>(entity: EntityId, type: ComponentType<T>): boolean {
    if (!this.isAlive(entity)) return false;
    return (this.masks[unpackIndex(entity)] & type.bit) !== 0;
  }

  get<T>(entity: EntityId, type: ComponentType<T>): T | undefined {
    if (!this.isAlive(entity)) return undefined;
    const index = unpackIndex(entity);
    if ((this.masks[index] & type.bit) === 0) return undefined;
    return this.stores[type.id][index] as T;
  }

  getRequired<T>(entity: EntityId, type: ComponentType<T>): T {
    const val = this.get(entity, type);
    if (val === undefined) {
      throw new Error(`Componente obrigatório "${type.name}" ausente na entidade ${entity}.`);
    }
    return val;
  }

  /**
   * Filtra todas as entidades vivas cuja máscara contenha `withMask` e não contenha `withoutMask`.
   */
  query(withMask: number, withoutMask = 0, out: EntityId[] = []): EntityId[] {
    out.length = 0;
    const { masks, aliveFlags, generations, highWaterMark } = this;
    for (let i = 0; i < highWaterMark; i++) {
      if (aliveFlags[i] === 0) continue;
      const m = masks[i];
      if ((m & withMask) === withMask && (m & withoutMask) === 0) {
        out.push(packEntity(i, generations[i]));
      }
    }
    return out;
  }

  get stats() {
    return {
      alive: this.aliveCounter,
      highWaterMark: this.highWaterMark,
      recycledSlots: this.freeIndices.length,
    };
  }
}
