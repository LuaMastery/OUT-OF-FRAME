/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest';
import { ITEM_CATALOG } from '../src/doom/DoomInventory';
import { getInventoryItemIcon } from '../src/doom/DoomInventoryIcons';

const images = import.meta.glob('../public/inventory/*.png', { eager: true, query: '?url', import: 'default' });

describe('Imagens dos itens do inventário', () => {
  it('possui uma imagem para todos os itens do catálogo', () => {
    for (const item of Object.values(ITEM_CATALOG)) {
      const url = getInventoryItemIcon(item);
      expect(url).toMatch(/inventory\/[a-z0-9_]+\.png$/);
      expect(images[`../public/${url.slice(url.indexOf('inventory/'))}`]).toBeDefined();
    }
  });

  it('distingue as quatro peças e as sete chaves externas nos ícones', () => {
    const parts = ['shotgun_receiver', 'shotgun_barrel', 'shotgun_pump', 'shotgun_stock'];
    const keys = ['key_computer_room', 'key_biology_lab', 'key_crew_quarters', 'key_medical_ward',
      'key_vegetation_room', 'key_library_room', 'key_reactor_hall'];
    for (const group of [parts, keys]) {
      const urls = group.map(id => getInventoryItemIcon(ITEM_CATALOG[id]));
      expect(new Set(urls).size).toBe(group.length);
    }
  });

  it('preserva o ícone correspondente ao tipo ao receber um ID não especializado', () => {
    expect(getInventoryItemIcon({ id: 'futura_chave', kind: 'key' })).toMatch(/\/key\.png$/);
    expect(getInventoryItemIcon({ id: 'futuro_canivete', kind: 'knife' })).toMatch(/\/knife\.png$/);
  });
});
