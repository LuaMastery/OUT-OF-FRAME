import { afterEach, describe, expect, it, vi } from 'vitest';
import { TerminalBootController, TITLE_MENU_ITEMS } from '../src/terminal/TerminalBoot';
import { TITLE_MENU_MARKUP } from '../src/terminal/titleMenuMarkup';
import { TITLE_PARTICLES_TOTAL_MS, TITLE_PARTICLE_TIMING } from '../src/terminal/TitleParticles';

type FrameCall = {
  from: { x: number; y: number; w: number; h: number };
  to: { x: number; y: number; w: number; h: number };
  steps: number;
  stepMs: number;
  title: string;
  expanding: boolean;
  onComplete: () => void;
};

type FakeElement = {
  tag: string;
  className: string;
  textContent: string;
  style: Record<string, string>;
  children: FakeElement[];
  append: (...nodes: FakeElement[]) => void;
  remove: () => void;
  removed: boolean;
};

/** Estado mínimo usado pelos métodos reais chamados nos testes. */
function createSequenceState(search = '') {
  const frames: FrameCall[] = [];
  const created: FakeElement[] = [];

  const makeElement = (tag: string): FakeElement => {
    const el: FakeElement = {
      tag,
      className: '',
      textContent: '',
      style: {},
      children: [],
      removed: false,
      append(...nodes: FakeElement[]) {
        el.children.push(...nodes);
      },
      remove() {
        el.removed = true;
      },
    };
    created.push(el);
    return el;
  };

  const appended: FakeElement[] = [];

  const state = {
    phase: 'desktop',
    openingProgram: false,
    menuIndex: -1,
    transientTaskTab: null as string | null,
    topZ: 10,
    zoomTimers: [] as number[],
    titleIntroTimer: 0,
    mainMenuEl: { hidden: true },
    hiddenInputEl: { blur: vi.fn() },
    sound: {
      unlock: vi.fn(),
      windowOpen: vi.fn(),
      startTerminalPowerBed: vi.fn(),
      stopTerminalPowerBed: vi.fn(),
      startBootBed: vi.fn(),
      updateBootBed: vi.fn(),
      stopBootBed: vi.fn(),
      startTitlePad: vi.fn(),
      stopTitlePad: vi.fn(),
      stopCoalesceDrone: vi.fn(),
      keyBackspace: vi.fn(),
    },
    workspaceEl: {
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 1024, height: 700 }),
      appendChild: (el: FakeElement) => appended.push(el),
    },
    frames,
    created,
    appended,
    closeStartMenu: vi.fn(),
    renderTaskbarWindows: vi.fn(),
    getIconScreenRect: () => ({ x: 20, y: 20, w: 148, h: 76 }),
    clearZoomLayer: vi.fn(),
    runSteppedFrameSequence: (opts: FrameCall) => {
      frames.push(opts);
    },
    finishLastFrameSequence: () => {
      frames[frames.length - 1].onComplete();
    },
    latchTimers: [] as Array<() => void>,
    openTitleMenu: vi.fn(),
    disposeTitleBackdrop: vi.fn(),
    disposeTitleEffects: vi.fn(),
    titleIntro: null,
    titleParticles: null,
    titleBackdrop: null,
    titleBackdropStartFrame: 0,

    playTitleParticles: vi.fn(),
    startTitleTerminalIntro: vi.fn(),
  };

  const setTimeoutMock = vi.fn((fn: () => void, _ms?: number) => {
    state.latchTimers.push(fn);
    return 7;
  });

  vi.stubGlobal('window', {
    location: { search },
    innerWidth: 1024,
    innerHeight: 700,
    setTimeout: setTimeoutMock,
    clearTimeout: vi.fn(),
  });
  vi.stubGlobal('document', {
    createElement: makeElement,
    body: { classList: { remove: vi.fn(), add: vi.fn() } },
  });

  return { state, setTimeoutMock };
}

describe('Abertura da tela inicial', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    ['', 0],
    ['?room=1234', 1],
  ])('abre o menu depois da aba e respeita o convite %s (%i)', (search) => {
    const { state } = createSequenceState(search);
    const method = (TerminalBootController.prototype as unknown as {
      startProgramSequence(this: typeof state): void;
    }).startProgramSequence;

    // Primeiro a aba se abre em quadros discretos, a partir do ícone.
    method.call(state);
    expect(state.frames).toHaveLength(1);
    expect(state.frames[0].expanding).toBe(true);
    expect(state.frames[0].from).toEqual({ x: 20, y: 20, w: 148, h: 76 });
    expect(state.phase).toBe('desktop');
    expect(state.openingProgram).toBe(true);

    // A janela aparece e a aba é registrada na barra de tarefas.
    state.finishLastFrameSequence();
    expect(state.sound.windowOpen).toHaveBeenCalled();
    // O som do terminal começa devagar junto com a janela abrindo.
    expect(state.sound.startTerminalPowerBed).toHaveBeenCalledWith(0.5);
    expect(state.transientTaskTab).toBe('out_of_frame.exe');
    expect(state.renderTaskbarWindows).toHaveBeenCalled();
    expect(state.appended).toHaveLength(1);

    const appWindow = state.appended[0];
    expect(appWindow.className).toContain('tui-window');
    expect(appWindow.className).toContain('opening');
    expect(appWindow.children.map((child) => child.className)).toEqual([
      'tui-window-titlebar',
      'tui-window-body',
    ]);
    expect(appWindow.children[0].children[0].textContent).toBe('[ out_of_frame.exe ]');
    expect(appWindow.children[1].textContent).toBe('> Executando out_of_frame.exe...');

    // A aba latcheia e maximiza em quadros até a tela inteira.
    state.latchTimers.forEach((fn) => fn());
    expect(appWindow.removed).toBe(true);
    expect(state.frames).toHaveLength(2);
    expect(state.frames[1].to).toEqual({ x: 0, y: 0, w: 1024, h: 700 });
    expect(state.phase).toBe('desktop');
    expect(state.openTitleMenu).not.toHaveBeenCalled();

    // Somente então o menu é aberto e a aba temporária é descartada.
    state.finishLastFrameSequence();
    expect(state.openTitleMenu).toHaveBeenCalledOnce();
    expect(state.openingProgram).toBe(false);
    expect(state.transientTaskTab).toBeNull();
  });

  it('ignora cliques repetidos enquanto a aba está abrindo', () => {
    const { state } = createSequenceState();
    const method = (TerminalBootController.prototype as unknown as {
      startProgramSequence(this: typeof state): void;
    }).startProgramSequence;
    method.call(state);
    method.call(state);
    expect(state.frames).toHaveLength(1);
  });

  it('não abre a aba quando o menu já está em cena', () => {
    const { state } = createSequenceState();
    state.phase = 'title_menu';
    const method = (TerminalBootController.prototype as unknown as {
      startProgramSequence(this: typeof state): void;
    }).startProgramSequence;
    method.call(state);
    expect(state.frames).toHaveLength(0);
    expect(state.openingProgram).toBe(false);
  });

  it.each([
    ['', 0],
    ['?room=1234', 1],
  ])('mostra as partículas antes do terminal e respeita o convite %s', (search, selected) => {
    const { state, setTimeoutMock } = createSequenceState(search);
    const method = (TerminalBootController.prototype as unknown as {
      openTitleMenu(this: typeof state): void;
    }).openTitleMenu;
    method.call(state);

    expect(TITLE_MENU_ITEMS).toEqual(['INICIAR', 'MULTIPLAYER', 'SAIR']);
    expect(state.phase).toBe('title_menu');
    expect(state.mainMenuEl.hidden).toBe(false);
    expect(state.menuIndex).toBe(selected);
    expect(state.playTitleParticles).toHaveBeenCalledOnce();
    // O sopro da formação começa antes das partículas e o pad só depois.
    expect(state.sound.startBootBed).toHaveBeenCalledOnce();
    expect(state.sound.startTitlePad).not.toHaveBeenCalled();
    expect(state.startTitleTerminalIntro).not.toHaveBeenCalled();

    const timer = setTimeoutMock.mock.calls[0];
    expect(timer[1]).toBe(TITLE_PARTICLES_TOTAL_MS);
    expect(TITLE_PARTICLES_TOTAL_MS).toBe(
      TITLE_PARTICLE_TIMING.formMs + TITLE_PARTICLE_TIMING.settleMs
    );
  });
});

describe('Trilha sonora da abertura em camadas', () => {
  it('troca o sopro das partículas pelo pad do menu e encerra tudo ao sair', () => {
    const { state } = createSequenceState();
    const startIntro = (TerminalBootController.prototype as unknown as {
      startTitleTerminalIntro(this: typeof state): void;
    }).startTitleTerminalIntro;
    // Sem DOM real o terminal não imprime, mas a troca de camadas sonoras
    // acontece antes de qualquer acesso ao documento.
    expect(() => startIntro.call(state)).toThrow();
    expect(state.sound.startTitlePad).toHaveBeenCalledOnce();
    expect(state.sound.stopBootBed).toHaveBeenCalled();

    const back = (TerminalBootController.prototype as unknown as {
      returnToDesktopFromTitle(this: typeof state): void;
    }).returnToDesktopFromTitle;
    back.call(state);
    expect(state.sound.stopTitlePad).toHaveBeenCalled();
    expect(state.sound.stopBootBed).toHaveBeenCalled();
    expect(state.sound.stopTerminalPowerBed).toHaveBeenCalled();
  });

  it('mantém a abertura lenta: partículas levam segundos, não quadros', () => {
    expect(TITLE_PARTICLE_TIMING.formMs).toBeGreaterThanOrEqual(2000);
    expect(TITLE_PARTICLE_TIMING.settleMs).toBeGreaterThanOrEqual(600);
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
