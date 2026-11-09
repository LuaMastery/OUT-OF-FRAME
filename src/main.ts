import './style.css';
import './terminal/terminal.css';
import './doom/inventory.css';
import './doom/pause.css';
import './multiplayer/multiplayer.css';
import { DoomGameApp } from './doom/DoomGameApp';
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

function launchDoomSession(multiplayerSession?: ActiveRoomSession): void {
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
  doomApp = new DoomGameApp(
    soundEngine,
    () => {
      // Morte permanente ou saída da sala: destrói a sessão/mundo e retorna ao Terminal!
      exitDoomToDesktop();
    },
    multiplayerSession,
    () => {
      // Reiniciar incursão a partir do Menu de Pausa: recria o labirinto com novo spawn e loot!
      launchDoomSession(undefined);
    }
  );
  doomApp.start();
  doomApp.engageFromTerminal(multiplayerSession);
}

function createTerminalController(skipBootToDesktop: boolean): void {
  const terminal = new TerminalBootController(appRoot, {
    sound: soundEngine,
    onLaunchImmediateGesture: (multiplayerSession?: ActiveRoomSession) => {
      launchDoomSession(multiplayerSession);
    },
  });

  if (skipBootToDesktop) {
    terminal.startAtDesktop();
  } else {
    terminal.startSequence();
  }
}

createTerminalController(false);
