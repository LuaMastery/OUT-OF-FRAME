/**
 * Campo de partículas da tela inicial.
 *
 * As partículas nascem do centro da tela e se condensam até formar silhuetas
 * alinhadas à grade (uma vaga lembrança de pixels de terminal). A camada é
 * puramente decorativa, resolve em um único canvas 2D e se desliga assim que a
 * formação termina, liberando o quadro para o resto do menu.
 */

export type TitleParticleTuning = {
  /** Duração da condensação, em milissegundos. */
  formMs: number;
  /** Duração do pulso de estabilização, em milissegundos. */
  settleMs: number;
};

export const TITLE_PARTICLE_TIMING: TitleParticleTuning = {
  formMs: 1250,
  settleMs: 420,
};

/** Duração total da entrada de partículas antes dos textos surgirem. */
export const TITLE_PARTICLES_TOTAL_MS =
  TITLE_PARTICLE_TIMING.formMs + TITLE_PARTICLE_TIMING.settleMs;

export type TitleParticleLayer = {
  /** Reinicia a formação (útil ao reabrir o menu). */
  play(): void;
  destroy(): void;
};

type Particle = {
  sx: number;
  sy: number;
  tx: number;
  ty: number;
  delay: number;
  size: number;
  drift: number;
  phase: number;
  hot: boolean;
  settled: number;
};

const COLORS = {
  cold: '205, 214, 198',
  warm: '206, 178, 116',
  dim: '120, 132, 120',
};

const TARGET_COLUMNS = 34;
const TARGET_ROWS = 19;

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/**
 * Cria a camada decorativa dentro de `container` (um elemento já no DOM).
 * Retorna `null` quando não há canvas 2D disponível; o menu continua funcional.
 */
export function createTitleParticleLayer(container: HTMLElement): TitleParticleLayer | null {
  let canvas: HTMLCanvasElement;
  try {
    canvas = document.createElement('canvas');
  } catch {
    return null;
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  canvas.className = 'oof-title-screen__particle-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  container.appendChild(canvas);

  const reduceMotion = prefersReducedMotion();
  const dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
  let particles: Particle[] = [];
  let width = 0;
  let height = 0;
  let rafId = 0;
  let startedAt = 0;
  let lastDrawAt = 0;
  let disposed = false;
  let finished = false;

  const buildParticles = (): void => {
    const total = reduceMotion ? 150 : Math.min(900, Math.max(320, Math.round((width * height) / 1600)));
    particles = new Array(total);
    const wander = reduceMotion ? 0 : 1;

    for (let i = 0; i < total; i++) {
      // Alvos: uma malha fina e levemente irregular cobrindo toda a tela.
      // É essa malha que "constrói" o quadro antes de o cenário surgir.
      const col = i % TARGET_COLUMNS;
      const row = Math.floor(i / TARGET_COLUMNS) % TARGET_ROWS;
      const cellW = width / TARGET_COLUMNS;
      const cellH = height / TARGET_ROWS;
      const tx = cellW * (col + 0.5) + randomBetween(-cellW * 0.34, cellW * 0.34);
      const ty = cellH * (row + 0.5) + randomBetween(-cellH * 0.34, cellH * 0.34);

      // Origem: um aglomerado vertical no centro, como um sinal se decodificando.
      const angle = Math.random() * Math.PI * 2;
      const radius = randomBetween(0, 1) * (width * 0.06);
      const sx = width * 0.5 + Math.cos(angle) * radius + randomBetween(-width * 0.1, width * 0.1);
      const sy = height * 0.5 + Math.sin(angle) * radius * 2.6;

      particles[i] = {
        sx,
        sy,
        tx: Math.min(width - 3, Math.max(3, tx)),
        ty: Math.min(height - 3, Math.max(3, ty)),
        delay: reduceMotion ? 0 : randomBetween(0, TITLE_PARTICLE_TIMING.formMs * 0.5),
        size: randomBetween(1, 2.8),
        drift: wander * randomBetween(0.5, 2.2),
        phase: Math.random() * Math.PI * 2,
        hot: Math.random() < 0.1,
        settled: 0,
      };
    }
  };

  const resize = (): void => {
    width = Math.max(1, container.clientWidth || window.innerWidth || 1);
    height = Math.max(1, container.clientHeight || window.innerHeight || 1);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    buildParticles();
  };

  const easeInOut = (t: number): number =>
    t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

  const positionAt = (particle: Particle, elapsed: number, local: number): [number, number] => {
    const eased = easeInOut(Math.max(0, Math.min(1, local)));
    const wobble = (1 - eased) * particle.drift * 7;
    return [
      particle.sx + (particle.tx - particle.sx) * eased + Math.sin(particle.phase + elapsed * 0.0011) * wobble,
      particle.sy + (particle.ty - particle.sy) * eased + Math.cos(particle.phase + elapsed * 0.0009) * wobble,
    ];
  };

  const draw = (now: number): void => {
    rafId = 0;
    if (disposed) return;
    if (!startedAt) startedAt = now;
    const elapsed = now - startedAt;

    // A formação roda em no máximo ~30 fps: suficiente para leitura e barato.
    if (lastDrawAt && now - lastDrawAt < 1000 / 30) {
      rafId = requestAnimationFrame(draw);
      return;
    }
    lastDrawAt = now;

    ctx.clearRect(0, 0, width, height);
    ctx.globalCompositeOperation = 'lighter';
    const settleStart = TITLE_PARTICLE_TIMING.formMs;

    for (const particle of particles) {
      const local = (elapsed - particle.delay) / TITLE_PARTICLE_TIMING.formMs;
      if (local <= 0) continue;

      const [x, y] = positionAt(particle, elapsed, local);
      const [prevX, prevY] = positionAt(particle, elapsed, local - 0.09);

      // Rastro curto: dá a leitura de matéria sendo puxada para o lugar.
      const trail = Math.min(1, local) * (elapsed < settleStart ? 1 : 0.25);
      if (trail > 0.05 && (prevX !== x || prevY !== y)) {
        ctx.strokeStyle = `rgba(${particle.hot ? COLORS.warm : COLORS.cold}, ${0.16 * trail})`;
        ctx.lineWidth = particle.size * 0.7;
        ctx.beginPath();
        ctx.moveTo(prevX, prevY);
        ctx.lineTo(x, y);
        ctx.stroke();
      }

      const fade = local < 0.1 ? local / 0.1 : 1;
      let alpha = (particle.hot ? 0.95 : 0.66) * fade;

      if (elapsed >= settleStart) {
        // Fase de estabilização: as partículas "fixam", piscam e se apagam,
        // revelando o cenário real que já está sendo renderizado por baixo.
        const settle = Math.min(1, (elapsed - settleStart) / TITLE_PARTICLE_TIMING.settleMs);
        const pulse = Math.sin(settle * Math.PI) * 0.5;
        particle.settled = settle;
        alpha = Math.max(0, alpha * (1 - settle * 0.9) + pulse * 0.3);
      }

      if (alpha <= 0.01) continue;
      ctx.fillStyle = `rgba(${particle.hot ? COLORS.warm : particle.size > 2 ? COLORS.cold : COLORS.dim}, ${alpha})`;

      const size = particle.size * (1 - particle.settled * 0.55);
      ctx.fillRect(x, y, size, size);

      // Núcleo mais claro nas partículas maiores, sem custo de blur.
      if (particle.size > 1.9 && alpha > 0.35) {
        ctx.fillStyle = `rgba(240, 238, 227, ${alpha * 0.5})`;
        ctx.fillRect(x, y, size * 0.45, size * 0.45);
      }
    }

    ctx.globalCompositeOperation = 'source-over';

    if (elapsed >= settleStart + TITLE_PARTICLE_TIMING.settleMs) {
      ctx.clearRect(0, 0, width, height);
      finished = true;
      return;
    }
    rafId = requestAnimationFrame(draw);
  };

  const onResize = (): void => {
    resize();
    if (finished) {
      // A formação já terminou: um novo tamanho apenas limpa a camada, sem
      // repetir a animação sobre o menu já aberto.
      ctx.clearRect(0, 0, width, height);
      return;
    }
    startedAt = 0;
    lastDrawAt = 0;
    if (!rafId) rafId = requestAnimationFrame(draw);
  };

  const play = (): void => {
    if (disposed) return;
    if (rafId) cancelAnimationFrame(rafId);
    finished = false;
    resolveSize();
    startedAt = 0;
    lastDrawAt = 0;
    rafId = requestAnimationFrame(draw);
  };

  const resolveSize = (): void => {
    resize();
  };

  play();
  window.addEventListener('resize', onResize);

  return {
    play,
    destroy() {
      disposed = true;
      if (rafId) cancelAnimationFrame(rafId);
      rafId = 0;
      window.removeEventListener('resize', onResize);
      ctx.clearRect(0, 0, width, height);
      canvas.remove();
    },
  };
}
