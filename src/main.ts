import './style.css';
import './terminal/terminal.css';
import './doom/inventory.css';
import './multiplayer/multiplayer.css';
import { DoomGameApp } from './doom/DoomGameApp';
import { SoundEngine } from './engine/audio/SoundEngine';
import { acquireFullscreenAndKeyboardLock } from './engine/input/BrowserShortcutGuard';
import { ActiveRoomSession } from './multiplayer/MultiplayerService';
import { TerminalBootController } from './terminal/TerminalBoot';

const appRoot = document.getElementById('app') as HTMLElement;
const gameViewport = document.getElementById('game-viewport') as HTMLElement;

const soundEngine = new SoundEngine();
let doomApp: DoomGameApp | null = null;

function createTerminalController(skipBootToDesktop: boolean): void {
  const terminal = new TerminalBootController(appRoot, {
    sound: soundEngine,
    onLaunchImmediateGesture: (multiplayerSession?: ActiveRoomSession) => {
      // Solicita Tela Cheia + Keyboard Lock no primeiro microssegundo do gesto do usuário
      // para que o navegador capture Ctrl+W diretamente para o jogo sem fechar a aba!
      acquireFullscreenAndKeyboardLock(() => {
        doomApp?.reacquirePointerLockAfterFullscreen();
      });

      gameViewport.classList.remove('dormant');
      if (!doomApp) {
        doomApp = new DoomGameApp(soundEngine, () => {
          // Morte permanente ou saída da sala: destrói a sessão/mundo e retorna ao Terminal!
          doomApp?.destroy();
          doomApp = null;

          const oldCanvas = document.getElementById('webgl-canvas');
          if (oldCanvas) {
            const freshCanvas = document.createElement('canvas');
            freshCanvas.id = 'webgl-canvas';
            oldCanvas.replaceWith(freshCanvas);
          }

          gameViewport.classList.add('dormant');
          createTerminalController(true);
        });
        doomApp.start();
      }
      doomApp.engageFromTerminal(multiplayerSession);
    },
  });

  if (skipBootToDesktop) {
    terminal.startAtDesktop();
  } else {
    terminal.startSequence();
  }
}

createTerminalController(false);
