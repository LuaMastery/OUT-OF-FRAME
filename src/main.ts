import '@fontsource/geist-pixel/400.css';
import './style.css';
import './terminal/terminal.css';
import './doom/inventory.css';
import './doom/loading.css';
import './doom/pause.css';
import './doom/saves.css';
import './doom/tutorial.css';
import './multiplayer/multiplayer.css';
import { DoomGameApp } from './doom/DoomGameApp';
import { getLoadingScreen, nextPaint, settleFrames } from './doom/LoadingScreen';
import { loadDoomSettings } from './doom/DoomSettings';
import { DoomSaveMenu, SaveMenuSelection } from './doom/DoomSaveMenu';
import { getBrowserSaveStorage } from './doom/DoomSaveSlots';
import { SoundEngine } from './engine/audio/SoundEngine';
import { acquireFullscreenAndKeyboardLock } from './engine/input/BrowserShortcutGuard';
import { getGameConsole } from './console/GameConsole';
import { ActiveRoomSession } from './multiplayer/MultiplayerService';
import { TerminalBootController } from './terminal/TerminalBoot';

// O console nasce antes de tudo o mais: a captura de erros precisa estar de
// pé já durante o boot do terminal, senão justamente as falhas de inicialização
// ficariam de fora do relatório.
const gameConsole = getGameConsole();

const appRoot = document.getElementById('app') as HTMLElement;
const gameViewport = document.getElementById('game-viewport') as HTMLElement;

const soundEngine = new SoundEngine();
let doomApp: DoomGameApp | null = null;

/** Terminal vivo no momento — destruído quando a partida começa de verdade. */
let activeTerminal: TerminalBootController | null = null;

/** Onde os cinco saves moram (no navegador, ou na memória se ele bloquear). */
const saveStorage = getBrowserSaveStorage();

/**
 * Menu de saves: aparece ao apertar INICIAR.
 *
 * É criado uma vez e reaberto quantas vezes for preciso, relendo os slots a
 * cada abertura para refletir o que acabou de ser gravado.
 */
const saveMenu = new DoomSaveMenu(appRoot, {
  sound: soundEngine,
  storage: saveStorage,
  onStart: (selection: SaveMenuSelection) => {
    // Escolheu um slot: agora sim o terminal sai de cena e a incursão sobe.
    activeTerminal?.destroy(false);
    activeTerminal = null;
    void launchDoomSession(undefined, selection);
  },
  onClose: () => {
    activeTerminal?.setExternalModalOpen(false);
    activeTerminal?.resumeTitleAfterModal();
  },
});

function replaceFreshWebglCanvas(): void {
  const oldCanvas = document.getElementById('webgl-canvas');
  if (oldCanvas) {
    const freshCanvas = document.createElement('canvas');
    freshCanvas.id = 'webgl-canvas';
    oldCanvas.replaceWith(freshCanvas);
  }
}

function exitDoomToDesktop(): void {
  gameConsole.info('geral', 'Retornando à área de trabalho do Terminal.');
  doomApp?.destroy();
  doomApp = null;
  replaceFreshWebglCanvas();
  gameViewport.classList.add('dormant');
  createTerminalController(true);
}

/**
 * Sobe a incursão mostrando a tela de carregamento.
 *
 * É assíncrona de propósito: entre cada etapa cedemos um frame ao navegador
 * para ele pintar o progresso. Sem isso o construtor de `DoomGameApp`
 * engoliria a thread inteira e o jogador veria uma tela preta congelada.
 */
async function launchDoomSession(
  multiplayerSession?: ActiveRoomSession,
  saveSelection?: SaveMenuSelection
): Promise<void> {
  const loading = getLoadingScreen();

  // A tela entra antes de qualquer trabalho, ainda dentro do mesmo gesto do
  // usuário (o clique em INICIAR), então o navegador tem algo para desenhar
  // enquanto o labirinto é montado.
  loading.show();
  gameConsole.info('jogo', multiplayerSession
    ? `Iniciando incursão cooperativa na sala ${multiplayerSession.roomCode}.`
    : 'Iniciando incursão solo.');

  try {
    await nextPaint(); // garante o primeiro frame da sobreposição

    // Os rótulos seguem o que o código faz de verdade, e cada um é pintado
    // ANTES do trecho que o bloqueia — assim o jogador sempre lê a etapa que
    // está de fato rodando.
    loading.step('MONTANDO O TERMINAL DE INCURSÃO', 0.1);
    if (loadDoomSettings().autoFullscreenOnResume) {
      acquireFullscreenAndKeyboardLock(() => {
        doomApp?.reacquirePointerLockAfterFullscreen();
      });
    }

    if (doomApp) {
      doomApp.destroy();
      doomApp = null;
      replaceFreshWebglCanvas();
    }
    gameViewport.classList.remove('dormant');

    // Trecho pesado e síncrono: texturas, labirinto, espólio, astronauta e
    // espingarda nascem todos aqui dentro.
    loading.step('SINTETIZANDO AS TEXTURAS', 0.2);
    await settleFrames(1);
    doomApp = new DoomGameApp(
      soundEngine,
      () => {
        // Morte permanente ou saída da sala: destrói a sessão/mundo e retorna ao Terminal!
        exitDoomToDesktop();
      },
      multiplayerSession,
      () => {
        // Reiniciar incursão a partir do Menu de Pausa: recria o labirinto com
        // novo spawn e loot, no MESMO slot. O modo vira 'new' porque o mundo
        // é outro — continuar aqui recarregaria a incursão abandonada.
        void launchDoomSession(
          undefined,
          saveSelection
            ? { slot: saveSelection.slot, mode: 'new', forceTutorial: false }
            : undefined
        );
      },
      saveSelection
        ? { storage: saveStorage, selection: saveSelection }
        : undefined
    );
    loading.step('CONSTRUINDO O LABIRINTO', 0.55);
    loading.step('ESPAÇANDO O ESPÓLIO', 0.7);
    loading.step('EQUIPANDO O ASTRONAUTA', 0.84);
    loading.step('ARMANDO A ESPINGARDA', 0.94);
    await settleFrames(2); // a barra corre até aqui

    loading.step('ABRINDO AS PORTAS', 1);
    doomApp.start();
    doomApp.engageFromTerminal(multiplayerSession);

    await settleFrames(2); // deixa a barra cravar os 100% antes de sair
    await loading.finish();
  } catch (error) {
    // Não deixa o jogador preso numa tela preta: avisa a falha e devolve o Terminal.
    gameConsole.error('jogo', 'Falha ao carregar a incursão:', error);
    await loading.fail('Falha ao carregar a incursão', error);
    exitDoomToDesktop();
  }
}

function createTerminalController(skipBootToDesktop: boolean): void {
  const terminal = new TerminalBootController(appRoot, {
    sound: soundEngine,
    onLaunchImmediateGesture: (multiplayerSession?: ActiveRoomSession) => {
      void launchDoomSession(multiplayerSession);
    },
    onOpenSaveMenu: () => {
      // O terminal para de ler o teclado enquanto a lista está aberta.
      activeTerminal?.setExternalModalOpen(true);
      saveMenu.open();
    },
  });
  activeTerminal = terminal;

  if (skipBootToDesktop) {
    terminal.startAtDesktop();
  } else {
    terminal.startSequence();
  }
}

gameConsole.info('geral', 'Console pronto — pressione ` (crase) para abrir.');
createTerminalController(false);
