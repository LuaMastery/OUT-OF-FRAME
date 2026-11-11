import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_LOADING_STEPS, nextPaint, settleFrames } from '../src/doom/LoadingScreen';

/**
 * O ambiente de teste é Node puro, sem DOM: o módulo só pode tocar em
 * `document` quando a tela é realmente criada. Importar aqui já prova isso.
 */
describe('tela de carregamento — roteiro de etapas', () => {
  it('as frações sobem sem buraco e terminam em 1', () => {
    expect(DEFAULT_LOADING_STEPS.length).toBeGreaterThan(4);

    let previous = 0;
    for (const step of DEFAULT_LOADING_STEPS) {
      expect(step.label.trim().length).toBeGreaterThan(3);
      expect(step.to).toBeGreaterThan(previous);
      expect(step.to).toBeLessThanOrEqual(1);
      previous = step.to;
    }
    expect(previous).toBe(1);
  });

  it('a última etapa é a que abre o jogo', () => {
    expect(DEFAULT_LOADING_STEPS[DEFAULT_LOADING_STEPS.length - 1].label).toMatch(/PORTAS/);
  });
});

describe('tela de carregamento — cessão de frames', () => {
  let frames: FrameRequestCallback[] = [];

  afterEach(() => {
    vi.unstubAllGlobals();
    frames = [];
  });

  function stubFrames(): void {
    frames = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {});
  }

  /** Roda os frames pendentes até a promessa resolver. */
  async function drain(promise: Promise<void>): Promise<void> {
    let settled = false;
    void promise.then(() => {
      settled = true;
    });
    for (let attempt = 0; attempt < 300 && !settled; attempt += 1) {
      const pending = frames;
      frames = [];
      for (const callback of pending) callback(0);
      await new Promise((resolve) => setTimeout(resolve, 4));
    }
    expect(settled, 'a promessa deveria resolver').toBe(true);
  }

  it('nextPaint espera um frame de verdade antes de devolver o controle', async () => {
    stubFrames();
    let painted = false;
    const promise = nextPaint().then(() => {
      painted = true;
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(painted, 'não deveria resolver antes do frame').toBe(false);

    await drain(promise);
    expect(painted).toBe(true);
  });

  it('settleFrames cede a quantidade pedida de frames', async () => {
    stubFrames();
    let requested = 0;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      requested += 1;
      frames.push(callback);
      return frames.length;
    });

    await drain(settleFrames(4));
    expect(requested).toBe(4);
  });

  it('settleFrames sempre cede ao menos um frame', async () => {
    stubFrames();
    let requested = 0;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      requested += 1;
      frames.push(callback);
      return frames.length;
    });

    await drain(settleFrames(0));
    expect(requested).toBe(1);
  });
});
