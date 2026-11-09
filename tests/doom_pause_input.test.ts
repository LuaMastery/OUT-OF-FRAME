import { describe, expect, it } from 'vitest';
import { BrowserControlReleaseState, resolveBrowserControlRelease } from '../src/doom/DoomPauseInput';

const gameplay: BrowserControlReleaseState = {
  engaged: true, disposed: false, paused: false, inventoryOpen: false, gameOver: false,
  chatOpen: false, danceMenuOpen: false, inSequence: false, intentionalRelease: false, dancing: false,
};

describe('Esc consumido pelo navegador', () => {
  it('pausa a exploração ao perder pointer lock ou tela cheia', () => {
    expect(resolveBrowserControlRelease(gameplay)).toBe('pause');
  });
  it('cancela uma dança em vez de abrir a pausa', () => {
    expect(resolveBrowserControlRelease({ ...gameplay, dancing: true })).toBe('stop-dance');
  });
  it.each([
    ['engaged', false], ['disposed', true], ['paused', true], ['inventoryOpen', true],
    ['gameOver', true], ['chatOpen', true], ['danceMenuOpen', true],
    ['inSequence', true], ['intentionalRelease', true],
  ] as const)('ignora liberação com %s = %s', (key, value) => {
    expect(resolveBrowserControlRelease({ ...gameplay, [key]: value })).toBe('ignore');
  });
});
