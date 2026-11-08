import './style.css';
import './terminal/terminal.css';
import './doom/inventory.css';
import { DoomGameApp } from './doom/DoomGameApp';
import { SoundEngine } from './engine/audio/SoundEngine';
import { TerminalBootController } from './terminal/TerminalBoot';

const appRoot = document.getElementById('app') as HTMLElement;
const gameViewport = document.getElementById('game-viewport') as HTMLElement;

const soundEngine = new SoundEngine();
let doomApp: DoomGameApp | null = null;

function createTerminalController(skipBootToDesktop: boolean): void {
  const terminal = new TerminalBootController(appRoot, {
    sound: soundEngine,
    onLaunchImmediateGesture: () => {
      gameViewport.classList.remove('dormant');
      if (!doomApp) {
        doomApp = new DoomGameApp(soundEngine, () => {
          // Morte permanente: destrói toda a sessão/itens/mundo e encerra o .exe de volta ao Terminal!
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
      doomApp.engageFromTerminal();
    },
  });

  if (skipBootToDesktop) {
    terminal.startAtDesktop();
  } else {
    terminal.startSequence();
  }
}

createTerminalController(false);
