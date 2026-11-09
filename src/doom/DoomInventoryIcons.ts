/// <reference types="vite/client" />
import type { InventoryItemDef, InventoryItemKind } from './DoomInventory';

/** Imagens transparentes geradas a partir dos modelos 3D usados no jogo. */
const ICON_BY_KIND: Record<InventoryItemKind, string> = {
  lantern: 'lantern',
  bandage: 'bandage',
  morphine: 'morphine',
  battery: 'battery',
  knife: 'knife',
  flare: 'flare',
  key: 'key',
  radar: 'radar',
  walkie: 'walkie',
  note: 'note',
  shotgun_part: 'shotgun_receiver',
  shotgun: 'shotgun',
  shotgun_ammo: 'shotgun_shells',
  taser: 'taser',
};

/** Peças e chaves possuem identidade visual própria, inclusive nos atalhos e na inspeção. */
const ICON_BY_ID: Readonly<Record<string, string>> = {
  shotgun_receiver: 'shotgun_receiver',
  shotgun_barrel: 'shotgun_barrel',
  shotgun_pump: 'shotgun_pump',
  shotgun_stock: 'shotgun_stock',
  key_computer_room: 'key_computer_room',
  key_biology_lab: 'key_biology_lab',
  key_crew_quarters: 'key_crew_quarters',
  key_medical_ward: 'key_medical_ward',
  key_vegetation_room: 'key_vegetation_room',
  key_library_room: 'key_library_room',
  key_reactor_hall: 'key_reactor_hall',
};

export function getInventoryItemIcon(def: Pick<InventoryItemDef, 'id' | 'kind'>): string {
  const filename = Object.hasOwn(ICON_BY_ID, def.id) ? ICON_BY_ID[def.id] : ICON_BY_KIND[def.kind];
  return `${import.meta.env.BASE_URL}inventory/${filename}.png`;
}
