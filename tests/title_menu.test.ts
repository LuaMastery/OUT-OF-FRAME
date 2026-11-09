import { afterEach, describe, expect, it, vi } from 'vitest';
import { TerminalBootController, TITLE_MENU_ITEMS } from '../src/terminal/TerminalBoot';
import { TITLE_MENU_MARKUP } from '../src/terminal/titleMenuMarkup';
import { TITLE_PARTICLES_TOTAL_MS, TITLE_PARTICLE_TIMING } from '../src/terminal/TitleParticles';

describe('Abertura da tela inicial', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it.each([
    ['', 0],
    ['?room=1234', 1],
  ])('abre o menu imediatamente e respeita o convite %s', (search, selected) => {
    vi.stubGlobal('window', {
      location: { search },
      setTimeout: vi.fn(() => 3),
      clearTimeout: vi.fn(),
    });
    const state = {
      phase: 'desktop',
      menuIndex: -1,
      mainMenuEl: { hidden: true },
      hiddenInputEl: { blur: vi.fn() },
      closeStartMenu: vi.fn(),
      titleIntroTimer: 0,
      playTitleParticles: vi.fn(),
      startTitleTerminalIntro: vi.fn(),
    };
    const method = (TerminalBootController.prototype as unknown as {
      startProgramSequence(this: typeof state): void;
    }).startProgramSequence;
    method.call(state);
    expect(TITLE_MENU_ITEMS).toEqual(['INICIAR', 'MULTIPLAYER', 'SAIR']);
    expect(state.phase).toBe('title_menu');
    expect(state.mainMenuEl.hidden).toBe(false);
    expect(state.menuIndex).toBe(selected);

    // Primeiro as partículas formam o cenário…
    expect(state.playTitleParticles).toHaveBeenCalledOnce();
    // …e só depois o terminal imprime o texto e as opções.
    expect(state.startTitleTerminalIntro).not.toHaveBeenCalled();
    const timer = (window.setTimeout as unknown as { mock: { calls: [() => void, number][] } })
      .mock.calls[0];
    expect(timer[1]).toBe(TITLE_PARTICLES_TOTAL_MS);
    expect(TITLE_PARTICLES_TOTAL_MS).toBe(
      TITLE_PARTICLE_TIMING.formMs + TITLE_PARTICLE_TIMING.settleMs
    );
  });
});

describe('Tela inicial sem textos auxiliares', () => {
  it('mantém apenas o título, as opções reais e as camadas de animação', () => {
    expect(TITLE_MENU_MARKUP).toContain('oof-title-screen__particles');
    expect(TITLE_MENU_MARKUP).toContain('data-word="OUT-OF-"');
    expect(TITLE_MENU_MARKUP).toContain('data-word="FRAME"');
    for (const label of TITLE_MENU_ITEMS) {
      expect(TITLE_MENU_MARKUP).toContain(`data-label="${label}"`);
    }
  });

  it('não exibe legendas, dicas de teclado nem indicadores de ambientação', () => {
    const forbidden = [
      'SISTEMA DE CONTENÇÃO',
      'Sistema de contenção',
      'SINAL ATIVO',
      'SETOR DESCONHECIDO',
      'NENHUMA SAÍDA',
      'UM COMPLEXO',
      'SETAS PARA NAVEGAR',
      'ENTER PARA SELECIONAR',
      'EXPLORAR SOZINHO',
      'ENTRAR EM UMA EQUIPE',
      'VOLTAR AO TERMINAL',
      'SOBREVIVA AO DESCONHECIDO',
      'ARQUIVO 01',
      '→',
      '↗',
    ];
    for (const text of forbidden) {
      expect(TITLE_MENU_MARKUP).not.toContain(text);
    }
  });
});
