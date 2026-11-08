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

const terminal = new TerminalBootController(appRoot, {
  sound: soundEngine,
  onLaunchImmediateGesture: () => {
    gameViewport.classList.remove('dormant');
    if (!doomApp) {
      doomApp = new DoomGameApp(soundEngine);
      doomApp.start();
    }
    doomApp.engageFromTerminal();
  },
});

terminal.startSequence();
