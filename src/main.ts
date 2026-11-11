import '@fontsource/geist-pixel/400.css';
import './style.css';
import './terminal/terminal.css';
import './doom/inventory.css';
import './doom/loading.css';
import './doom/pause.css';
import './multiplayer/multiplayer.css';
import { DoomGameApp } from './doom/DoomGameApp';
import { getLoadingScreen, nextPaint, settleFrames } from './doom/LoadingScreen';
import { loadDoomSettings } from './doom/DoomSettings';
import { SoundEngine } from './engine/audio/SoundEngine';
import { acquireFullscreenAndKeyboardLock } from './engine/input/BrowserShortcutGuard';
import { ActiveRoomSession } from './multiplayer/MultiplayerService';
import { TerminalBootController } from './terminal/TerminalBoot';

const appRoot = document.getElementById('app') as HTMLElement;
const gameViewport = document.getElementById('game-viewport') as HTMLElement;

const soundEngine = new SoundEngine();
let doomApp: DoomGameApp | null = null;

function replaceFreshWebglCanvas(): void {
  const oldCanvas = document.getElementById('webgl-canvas');
  if (oldCanvas) {
    const freshCanvas = document.createElement('canvas');
    freshCanvas.id = 'webgl-canvas';
    oldCanvas.replaceWith(freshCanvas);
  }
}

function exitDoomToDesktop(): void {
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
async function launchDoomSession(multiplayerSession?: ActiveRoomSession): Promise<void> {
  const loading = getLoadingScreen();

  // A tela entra antes de qualquer trabalho, ainda dentro do mesmo gesto do
  // usuário (o clique em INICIAR), então o navegador tem algo para desenhar
  // enquanto o labirinto é montado.
  loading.show();

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
        // Reiniciar incursão a partir do Menu de Pausa: recria o labirinto com novo spawn e loot!
        void launchDoomSession(undefined);
      }
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
  });

  if (skipBootToDesktop) {
    terminal.startAtDesktop();
  } else {
    terminal.startSequence();
  }
}

createTerminalController(false);
