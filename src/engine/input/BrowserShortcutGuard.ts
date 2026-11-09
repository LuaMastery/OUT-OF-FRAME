/**
 * Proteção máxima contra fechamento acidental da aba (Ctrl + W) e atalhos do navegador
 * durante a partida em primeira pessoa (onde Ctrl = agachar e WASD = andar).
 *
 * Camadas combinadas:
 * 1. Fullscreen + W3C Keyboard Lock API (`navigator.keyboard.lock`): no Chrome, Edge,
 *    Brave, Opera e derivados, o bloqueio real de `Ctrl+W` a nível de navegador SÓ é
 *    ativado pelo motor Chromium quando o documento está em tela cheia (`fullscreenElement`).
 * 2. Interceptação `keydown` em fase de captura (`capture: true, passive: false`) para
 *    bloquear `Ctrl+W`, `Ctrl+S`, `Ctrl+D`, `Ctrl+F`, `Ctrl+A`, `Ctrl+R`, `Ctrl+Tab`, etc.
 * 3. Guarda `beforeunload`: caso o navegador (ex.: Firefox) ou modo janela/iframe impeça
 *    Fullscreen/Keyboard Lock, bloqueia o fechamento imediato da aba para salvar a sessão.
 */

export const LOCKED_KEYBOARD_CODES: string[] = [
  'Escape',
  'KeyW',
  'KeyA',
  'KeyS',
  'KeyD',
  'KeyQ',
  'KeyE',
  'KeyR',
  'KeyF',
  'KeyC',
  'KeyT',
  'KeyV',
  'KeyM',
  'KeyN',
  'KeyJ',
  'Digit1',
  'Digit2',
  'Digit3',
  'Numpad1',
  'Numpad2',
  'Numpad3',
  'Tab',
  'ControlLeft',
  'ControlRight',
  'ShiftLeft',
  'ShiftRight',
  'Space',
];

const GAMEPLAY_CODES = new Set<string>([
  'KeyJ',
  'KeyW',
  'KeyA',
  'KeyS',
  'KeyD',
  'KeyQ',
  'KeyE',
  'KeyF',
  'KeyC',
  'KeyV',
  'KeyM',
  'KeyN',
  'Digit1',
  'Digit2',
  'Digit3',
  'Numpad1',
  'Numpad2',
  'Numpad3',
  'Tab',
  'Space',
  'ControlLeft',
  'ControlRight',
  'ShiftLeft',
  'ShiftRight',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
]);

const BLOCKED_MODIFIER_CODES = new Set<string>([
  'KeyW',
  'KeyA',
  'KeyS',
  'KeyD',
  'KeyQ',
  'KeyE',
  'KeyR',
  'KeyF',
  'KeyC',
  'KeyT',
  'KeyN',
  'KeyP',
  'KeyG',
  'KeyH',
  'KeyJ',
  'KeyO',
  'KeyU',
  'Digit1',
  'Digit2',
  'Digit3',
  'Numpad1',
  'Numpad2',
  'Numpad3',
  'Tab',
  'Space',
]);

interface NavigatorWithKeyboardLock extends Navigator {
  keyboard?: {
    lock?: (keyCodes?: string[]) => Promise<void>;
    unlock?: () => void;
  };
}

export function lockSystemKeyboardKeys(): void {
  if (typeof navigator === 'undefined') return;
  try {
    const kb = (navigator as NavigatorWithKeyboardLock).keyboard;
    const maybe = kb?.lock?.(LOCKED_KEYBOARD_CODES);
    if (maybe && typeof maybe.catch === 'function') {
      maybe.catch(() => {});
    }
  } catch {
    // Ignorado em navegadores sem suporte à Keyboard Lock API
  }
}

export function unlockSystemKeyboardKeys(): void {
  if (typeof navigator === 'undefined') return;
  try {
    const kb = (navigator as NavigatorWithKeyboardLock).keyboard;
    kb?.unlock?.();
  } catch {
    // Ignorado
  }
}

/**
 * Deve ser chamado diretamente dentro de um gesto confiável do usuário (clique / Enter).
 * Entra em Tela Cheia (requisito do Chromium para que `keyboard.lock` capture `Ctrl+W`)
 * e trava as teclas de jogo imediatamente e após a transição de Fullscreen.
 */
export function acquireFullscreenAndKeyboardLock(
  onFullscreenSettled?: () => void
): void {
  if (typeof document === 'undefined') return;

  lockSystemKeyboardKeys();

  try {
    const root = document.documentElement as HTMLElement & {
      webkitRequestFullscreen?: () => Promise<void>;
    };

    if (!document.fullscreenElement) {
      if (typeof root.requestFullscreen === 'function') {
        const p = root.requestFullscreen({ navigationUI: 'hide' });
        if (p && typeof p.then === 'function') {
          p.then(() => {
            lockSystemKeyboardKeys();
            onFullscreenSettled?.();
          }).catch(() => {
            lockSystemKeyboardKeys();
          });
        }
      } else if (typeof root.webkitRequestFullscreen === 'function') {
        root.webkitRequestFullscreen()?.catch?.(() => {});
      }
    }
  } catch {
    // Ambientes em iframe sem permissão fullscreen continuam protegidos via beforeunload
  }
}

/**
 * Determina se um evento de teclado deve ter a ação padrão do navegador bloqueada
 * (incluindo Ctrl+W, Ctrl+S, Ctrl+D, Ctrl+F, Ctrl+A, Ctrl+R, etc.).
 */
export function shouldPreventBrowserShortcut(e: {
  code: string;
  key?: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
}): boolean {
  if (GAMEPLAY_CODES.has(e.code)) {
    return true;
  }

  if (e.ctrlKey || e.metaKey || e.altKey) {
    if (BLOCKED_MODIFIER_CODES.has(e.code)) {
      return true;
    }
    const lowerKey = (e.key ?? '').toLowerCase();
    if (
      lowerKey === 'w' ||
      lowerKey === 's' ||
      lowerKey === 'd' ||
      lowerKey === 'a' ||
      lowerKey === 'f' ||
      lowerKey === 'r' ||
      lowerKey === 't' ||
      lowerKey === 'n' ||
      lowerKey === '1' ||
      lowerKey === '2' ||
      lowerKey === '3'
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Instala:
 * - Re-travamento automático de `navigator.keyboard.lock` sempre que Fullscreen ativar ou voltar ao foco
 * - Guarda `beforeunload` para impedir que `Ctrl+W` feche a aba silenciosamente fora de Fullscreen
 */
export function installSessionTabGuard(
  isSessionActive: () => boolean,
  signal: AbortSignal,
  shouldLockKeyboard?: () => boolean
): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  const canLockKeys = () =>
    isSessionActive() && (shouldLockKeyboard ? shouldLockKeyboard() : true);

  window.addEventListener(
    'beforeunload',
    (e: BeforeUnloadEvent) => {
      if (!isSessionActive()) return;
      e.preventDefault();
      // Necessário para compatibilidade cruzada Chrome / Edge / Firefox / Safari
      e.returnValue = '';
      return '';
    },
    { capture: true, signal }
  );

  document.addEventListener(
    'fullscreenchange',
    () => {
      if (canLockKeys() && document.fullscreenElement) {
        lockSystemKeyboardKeys();
      }
    },
    { signal }
  );

  window.addEventListener(
    'focus',
    () => {
      if (canLockKeys() && document.fullscreenElement) {
        lockSystemKeyboardKeys();
      }
    },
    { signal }
  );
}
