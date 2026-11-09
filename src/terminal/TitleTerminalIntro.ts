import type { SoundEngine } from '../engine/audio/SoundEngine';

export type TitleTerminalIntroHandle = {
  /** Conclui instantaneamente a digitação em andamento. */
  skip(): void;
  /** Indica se a digitação ainda está em curso. */
  isRunning(): boolean;
  destroy(): void;
};

export type TitleTerminalIntroOptions = {
  onComplete?: () => void;
};

const TITLE_CHAR_MS = 86;
const LABEL_CHAR_MS = 52;
const LINE_PAUSE_MS = 150;
const AFTER_TITLE_MS = 240;
/** Pausa antes de a primeira linha do menu começar a ser impressa. */
const BEFORE_LABELS_MS = 240;

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/**
 * Entrada de terminal do menu: o título é "digitado" caractere por caractere e,
 * em seguida, cada opção é impressa como uma linha de comando. A animação é
 * puramente textual (sem layout extra) e pode ser concluída a qualquer momento.
 */
export function playTitleTerminalIntro(
  root: HTMLElement,
  sound: Pick<SoundEngine, 'keyType'> | null,
  options: TitleTerminalIntroOptions = {}
): TitleTerminalIntroHandle {
  const words = Array.from(root.querySelectorAll<HTMLElement>('[data-word]'));
  const labels = Array.from(root.querySelectorAll<HTMLElement>('[data-label]'));
  const buttons = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-title-index]'));
  const reduceMotion = prefersReducedMotion();

  const timers: number[] = [];
  let running = true;
  let destroyed = false;
  let finished = false;

  root.classList.add('oof-title-screen--booting');

  const later = (fn: () => void, ms: number): void => {
    const id = window.setTimeout(() => {
      if (destroyed) return;
      fn();
    }, ms);
    timers.push(id);
  };

  const clearTimers = (): void => {
    for (const id of timers) window.clearTimeout(id);
    timers.length = 0;
  };

  const finish = (): void => {
    if (finished) return;
    finished = true;
    running = false;
    clearTimers();
    for (const el of [...words, ...labels]) {
      const text = el.dataset.word ?? el.dataset.label ?? '';
      el.textContent = text;
      el.classList.remove('is-typing');
    }
    for (const button of buttons) {
      button.classList.remove('is-typing');
      button.classList.add('is-typed');
      button.removeAttribute('aria-hidden');
    }
    root.classList.remove('oof-title-screen--booting');
    options.onComplete?.();
  };

  const typeSequence = (
    entries: Array<{ el: HTMLElement; text: string; speed: number }>,
    onDone?: () => void
  ): void => {
    let index = 0;
    const step = (): void => {
      if (destroyed) return;
      if (index >= entries.length) {
        onDone?.();
        return;
      }
      const entry = entries[index];
      index += 1;
      entry.el.textContent = '';
      entry.el.classList.add('is-typing');
      let char = 0;
      const typeChar = (): void => {
        if (destroyed) return;
        if (char >= entry.text.length) {
          entry.el.classList.remove('is-typing');
          later(step, LINE_PAUSE_MS);
          return;
        }
        entry.el.textContent = entry.text.slice(0, char + 1);
        char += 1;
        if (char % 3 === 0) sound?.keyType(false);
        later(typeChar, entry.speed);
      };
      typeChar();
    };
    step();
  };

  // Estado inicial: tudo vazio, como um terminal recém-aberto.
  for (const el of words) {
    el.textContent = '';
    el.classList.remove('is-typing');
  }
  for (const button of buttons) {
    button.setAttribute('aria-hidden', 'true');
  }
  for (const label of labels) label.textContent = '';

  if (reduceMotion) {
    finish();
    return {
      skip: finish,
      isRunning: () => false,
      destroy() {
        destroyed = true;
        clearTimers();
      },
    };
  }

  typeSequence(
    words.map((el) => ({ el, text: el.dataset.word ?? '', speed: TITLE_CHAR_MS })),
    () => {
      later(() => {
        typeSequence(
          labels.map((el) => ({
            el,
            text: el.dataset.label ?? '',
            speed: LABEL_CHAR_MS,
          })),
          () => {
            later(finish, LINE_PAUSE_MS);
          }
        );
        buttons.forEach((button, i) => {
          later(() => {
            if (destroyed) return;
            button.classList.add('is-typed');
            button.removeAttribute('aria-hidden');
            sound?.keyType(false);
          }, i * (LINE_PAUSE_MS + 40));
        });
      }, AFTER_TITLE_MS + BEFORE_LABELS_MS);
    }
  );

  return {
    skip: finish,
    isRunning: () => running,
    destroy() {
      destroyed = true;
      clearTimers();
    },
  };
}
