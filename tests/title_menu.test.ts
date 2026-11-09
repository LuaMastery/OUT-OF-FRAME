import { afterEach, describe, expect, it, vi } from 'vitest';
import { TerminalBootController, TITLE_MENU_ITEMS } from '../src/terminal/TerminalBoot';

describe('Abertura da tela inicial', () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    ['', 0],
    ['?room=1234', 1],
  ])('abre o menu imediatamente e respeita o convite %s', (search, selected) => {
    vi.stubGlobal('window', { location: { search } });
    const request = vi.fn(() => 17);
    vi.stubGlobal('requestAnimationFrame', request);
    const state = {
      phase: 'desktop',
      menuIndex: -1,
      mainMenuEl: { hidden: true },
      hiddenInputEl: { blur: vi.fn() },
      closeStartMenu: vi.fn(),
      syncMainMenuSelection: vi.fn(),
      titleBackdropStartFrame: 0,
    };
    const method = (TerminalBootController.prototype as unknown as {
      startProgramSequence(this: typeof state): void;
    }).startProgramSequence;
    method.call(state);
    expect(TITLE_MENU_ITEMS).toEqual(['INICIAR', 'MULTIPLAYER', 'SAIR']);
    expect(state.phase).toBe('title_menu');
    expect(state.mainMenuEl.hidden).toBe(false);
    expect(state.menuIndex).toBe(selected);
    expect(state.syncMainMenuSelection).toHaveBeenCalledWith(true);
    // Somente a construção do cenário é agendada; o menu já está visível.
    expect(request).toHaveBeenCalledOnce();
  });
});
