export interface ProximityTargetRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface BinarySpark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  glyph: '0' | '1' | 'pixel';
}

/**
 * Efeito magnético de proximidade do cursor:
 * Quando o ponteiro passa perto (até ~96px) ou sobre qualquer botão, ícone ou item
 * interativo, cantoneiras retrô em pixel art saem do cursor e travam magneticamente
 * no elemento, acompanhadas de feixe pontilhado e faíscas binárias (0/1).
 */
export class CursorProximityFX {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly proximityRadius = 96;

  private mouseX = -9999;
  private mouseY = -9999;
  private hasMouse = false;

  // Cantos interpolados (x1, y1 = canto sup-esq; x2, y2 = canto inf-dir)
  private curX1 = 0;
  private curY1 = 0;
  private curX2 = 0;
  private curY2 = 0;
  private bracketAlpha = 0;

  private sparks: BinarySpark[] = [];
  private shockwaves: Array<{
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    life: number;
  }> = [];

  private lastSpawnMs = 0;
  private rafId = 0;
  private lastFrameMs = performance.now();
  private canvasDirty = true;
  private disposed = false;

  private readonly onMouseMoveBound: (e: PointerEvent) => void;
  private readonly onMouseDownBound: (e: PointerEvent) => void;
  private readonly onTouchEndBound: () => void;
  private readonly onMouseLeaveBound: () => void;
  private readonly onResizeBound: () => void;

  constructor(
    private readonly rootEl: HTMLElement,
    private readonly isInteractivePhase: () => boolean,
    private readonly getCanvasTargets: () => ProximityTargetRect[]
  ) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'tui-proximity-canvas';
    this.rootEl.appendChild(this.canvas);

    const context = this.canvas.getContext('2d');
    if (!context) {
      throw new Error('Contexto 2D indisponível para CursorProximityFX.');
    }
    this.ctx = context;
    this.resize();

    this.onMouseMoveBound = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      const firstMove = !this.hasMouse;
      this.mouseX = e.clientX;
      this.mouseY = e.clientY;
      this.hasMouse = true;
      if (firstMove) {
        this.curX1 = this.mouseX - 8;
        this.curY1 = this.mouseY - 8;
        this.curX2 = this.mouseX + 8;
        this.curY2 = this.mouseY + 8;
      }
    };

    this.onMouseDownBound = (e: PointerEvent) => {
      if (e.pointerType === 'touch') {
        this.mouseX = e.clientX;
        this.mouseY = e.clientY;
        this.curX1 = e.clientX - 18;
        this.curY1 = e.clientY - 12;
        this.curX2 = e.clientX + 18;
        this.curY2 = e.clientY + 12;
        if (this.isInteractivePhase()) {
          this.shockwaves.push({
            x1: this.curX1,
            y1: this.curY1,
            x2: this.curX2,
            y2: this.curY2,
            life: 1.0,
          });
          this.spawnBurstSparks(8);
        }
        return;
      }
      if (this.bracketAlpha > 0.25 && this.isInteractivePhase()) {
        this.shockwaves.push({
          x1: this.curX1,
          y1: this.curY1,
          x2: this.curX2,
          y2: this.curY2,
          life: 1.0,
        });
        this.spawnBurstSparks(10);
      }
    };

    this.onTouchEndBound = () => {
      this.hasMouse = false;
    };

    this.onMouseLeaveBound = () => {
      this.hasMouse = false;
    };

    this.onResizeBound = () => this.resize();

    window.addEventListener('pointermove', this.onMouseMoveBound, {
      passive: true,
    });
    window.addEventListener('pointerdown', this.onMouseDownBound, {
      passive: true,
    });
    window.addEventListener('touchend', this.onTouchEndBound, {
      passive: true,
    });
    document.addEventListener('mouseleave', this.onMouseLeaveBound);
    window.addEventListener('resize', this.onResizeBound);

    this.lastFrameMs = performance.now();
    const loop = (now: number) => {
      if (this.disposed) return;
      const dt = Math.min(0.05, Math.max(0.001, (now - this.lastFrameMs) / 1000));
      this.lastFrameMs = now;
      this.updateAndRender(now, dt);
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  private resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.canvas.width = Math.floor(w * dpr);
    this.canvas.height = Math.floor(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  private collectTargets(): ProximityTargetRect[] {
    const extra = this.getCanvasTargets();
    if (extra.length > 0) {
      return extra;
    }

    const selectors =
      '.tui-icon, .tui-task-btn, .tui-window-close, .tui-start-popup.open .tui-start-item';
    const nodes = this.rootEl.querySelectorAll(selectors);
    const list: ProximityTargetRect[] = [];

    nodes.forEach((node) => {
      const el = node as HTMLElement;
      if (el.offsetParent === null) return;
      const r = el.getBoundingClientRect();
      if (r.width > 2 && r.height > 2) {
        list.push({ x: r.left, y: r.top, w: r.width, h: r.height });
      }
    });

    return list;
  }

  private findNearestTarget(): {
    rect: ProximityTargetRect;
    dist: number;
    nearX: number;
    nearY: number;
  } | null {
    if (!this.hasMouse || !this.isInteractivePhase()) return null;

    const targets = this.collectTargets();
    let best: {
      rect: ProximityTargetRect;
      dist: number;
      nearX: number;
      nearY: number;
    } | null = null;

    for (let i = 0; i < targets.length; i++) {
      const t = targets[i];
      const nearX = Math.max(t.x, Math.min(this.mouseX, t.x + t.w));
      const nearY = Math.max(t.y, Math.min(this.mouseY, t.y + t.h));
      const dist = Math.hypot(this.mouseX - nearX, this.mouseY - nearY);

      if (dist <= this.proximityRadius && (!best || dist < best.dist)) {
        best = { rect: t, dist, nearX, nearY };
      }
    }

    return best;
  }

  private spawnProximitySpark(
    rect: ProximityTargetRect,
    nearX: number,
    nearY: number,
    pull: number
  ): void {
    // Nasce na borda do botão mais próxima ao cursor e é atraído/orbita em pixel art
    const jitterX = (Math.random() - 0.5) * Math.min(44, rect.w * 0.7);
    const jitterY = (Math.random() - 0.5) * Math.min(28, rect.h * 0.7);
    const sx = Math.max(rect.x, Math.min(rect.x + rect.w, nearX + jitterX));
    const sy = Math.max(rect.y, Math.min(rect.y + rect.h, nearY + jitterY));

    const dx = this.mouseX - sx;
    const dy = this.mouseY - sy;
    const len = Math.max(1, Math.hypot(dx, dy));
    const speed = 34 + pull * 68;

    const roll = Math.random();
    const glyph: BinarySpark['glyph'] =
      roll < 0.36 ? '0' : roll < 0.72 ? '1' : 'pixel';

    this.sparks.push({
      x: sx,
      y: sy,
      vx: (dx / len) * speed + (Math.random() - 0.5) * 28,
      vy: (dy / len) * speed - 8 + (Math.random() - 0.5) * 28,
      life: 0,
      maxLife: 0.34 + Math.random() * 0.24,
      glyph,
    });
  }

  private spawnBurstSparks(count: number): void {
    const cx = (this.curX1 + this.curX2) * 0.5;
    const cy = (this.curY1 + this.curY2) * 0.5;
    for (let i = 0; i < count; i++) {
      const ang = (i / count) * Math.PI * 2 + Math.random() * 0.4;
      const spd = 65 + Math.random() * 85;
      this.sparks.push({
        x: cx + (Math.random() - 0.5) * 18,
        y: cy + (Math.random() - 0.5) * 12,
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd,
        life: 0,
        maxLife: 0.3 + Math.random() * 0.18,
        glyph: i % 3 === 0 ? 'pixel' : i % 2 === 0 ? '1' : '0',
      });
    }
  }

  private updateAndRender(nowMs: number, dt: number): void {
    const interactive = this.isInteractivePhase();
    if (
      !interactive &&
      this.bracketAlpha <= 0.005 &&
      this.sparks.length === 0 &&
      this.shockwaves.length === 0
    ) {
      if (this.canvasDirty) {
        this.ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
        this.canvasDirty = false;
      }
      return;
    }

    const ctx = this.ctx;
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    this.canvasDirty = true;

    const hit = this.findNearestTarget();
    const snap2 = (v: number) => Math.round(v / 2) * 2;

    if (hit) {
      const rawPull = 1 - hit.dist / this.proximityRadius;
      const pull = Math.max(0, Math.min(1, rawPull * rawPull * (3 - 2 * rawPull)));

      // Respiração retrô em pixels quando travado no elemento
      const pad = 5 + Math.round(Math.sin(nowMs * 0.01) * 1.5);

      // Interpola entre um pequeno quadro no cursor e as 4 bordas do botão!
      const cursorBoxHalf = 9;
      const tx1 =
        (this.mouseX - cursorBoxHalf) * (1 - pull) +
        (hit.rect.x - pad) * pull;
      const ty1 =
        (this.mouseY - cursorBoxHalf) * (1 - pull) +
        (hit.rect.y - pad) * pull;
      const tx2 =
        (this.mouseX + cursorBoxHalf) * (1 - pull) +
        (hit.rect.x + hit.rect.w + pad) * pull;
      const ty2 =
        (this.mouseY + cursorBoxHalf) * (1 - pull) +
        (hit.rect.y + hit.rect.h + pad) * pull;

      const follow = 1 - Math.exp(-24 * dt);
      if (this.bracketAlpha < 0.04) {
        this.curX1 = tx1;
        this.curY1 = ty1;
        this.curX2 = tx2;
        this.curY2 = ty2;
      } else {
        this.curX1 += (tx1 - this.curX1) * follow;
        this.curY1 += (ty1 - this.curY1) * follow;
        this.curX2 += (tx2 - this.curX2) * follow;
        this.curY2 += (ty2 - this.curY2) * follow;
      }

      this.bracketAlpha += (Math.max(0.28, pull) - this.bracketAlpha) * follow;

      // Gera faíscas binárias quando o cursor passa perto!
      const spawnGap = 85 - pull * 52;
      if (nowMs - this.lastSpawnMs >= spawnGap && this.sparks.length < 28) {
        this.lastSpawnMs = nowMs;
        this.spawnProximitySpark(hit.rect, hit.nearX, hit.nearY, pull);
      }

      // Desenha feixe magnético pontilhado entre o cursor e a borda do elemento quando perto
      if (hit.dist > 6) {
        this.drawMagneticTether(
          this.mouseX,
          this.mouseY,
          hit.nearX,
          hit.nearY,
          pull,
          nowMs
        );
      }
    } else {
      const fade = 1 - Math.exp(-16 * dt);
      this.bracketAlpha += (0 - this.bracketAlpha) * fade;
      this.curX1 += (this.mouseX - 6 - this.curX1) * fade;
      this.curY1 += (this.mouseY - 6 - this.curY1) * fade;
      this.curX2 += (this.mouseX + 6 - this.curX2) * fade;
      this.curY2 += (this.mouseY + 6 - this.curY2) * fade;
    }

    // 1. Renderiza cantoneiras magnéticas [ ] travando no botão/elemento
    if (this.bracketAlpha > 0.03) {
      const x1 = snap2(this.curX1);
      const y1 = snap2(this.curY1);
      const x2 = snap2(this.curX2);
      const y2 = snap2(this.curY2);
      this.drawPixelBrackets(
        x1,
        y1,
        x2,
        y2,
        Math.min(1, this.bracketAlpha),
        hit !== null && hit.dist < 10
      );
    }

    // 2. Renderiza ondas de choque ao clicar
    for (let i = this.shockwaves.length - 1; i >= 0; i--) {
      const sw = this.shockwaves[i];
      sw.life -= dt * 5.2;
      if (sw.life <= 0) {
        this.shockwaves.splice(i, 1);
        continue;
      }
      const expand = Math.round((1 - sw.life) * 16);
      this.drawPixelBrackets(
        snap2(sw.x1 - expand),
        snap2(sw.y1 - expand),
        snap2(sw.x2 + expand),
        snap2(sw.y2 + expand),
        sw.life * 0.75,
        false
      );
    }

    // 3. Atualiza e desenha faíscas binárias (0 / 1 / pixels)
    ctx.font = 'bold 11px Consolas, "Courier New", monospace';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';

    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const p = this.sparks[i];
      p.life += dt;
      if (p.life >= p.maxLife) {
        this.sparks.splice(i, 1);
        continue;
      }

      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.94;
      p.vy *= 0.94;

      const u = p.life / p.maxLife;
      const alpha = (1 - u) * 0.9;
      const px = snap2(p.x);
      const py = snap2(p.y);

      if (p.glyph === 'pixel') {
        ctx.fillStyle = `rgba(240, 242, 245, ${alpha.toFixed(2)})`;
        ctx.fillRect(px - 1, py - 1, 3, 3);
      } else {
        ctx.fillStyle = `rgba(0, 0, 0, ${alpha.toFixed(2)})`;
        ctx.fillText(p.glyph, px + 1, py + 1);
        ctx.fillStyle = `rgba(235, 238, 242, ${alpha.toFixed(2)})`;
        ctx.fillText(p.glyph, px, py);
      }
    }
  }

  private drawMagneticTether(
    mx: number,
    my: number,
    nx: number,
    ny: number,
    pull: number,
    nowMs: number
  ): void {
    const ctx = this.ctx;
    const dist = Math.hypot(nx - mx, ny - my);
    const steps = Math.max(3, Math.min(12, Math.floor(dist / 9)));
    const phaseShift = (nowMs * 0.008) % 1;

    for (let i = 1; i < steps; i++) {
      const t = (i + phaseShift * 0.6) / steps;
      if (t >= 1) continue;
      // Leve vibração eletromagnética perpendicular em pixels
      const wave = Math.sin(t * Math.PI) * Math.sin(nowMs * 0.025 + i * 1.9) * 2.5;
      const dx = nx - mx;
      const dy = ny - my;
      const len = Math.max(1, dist);
      const px = Math.round(mx + dx * t + (-dy / len) * wave);
      const py = Math.round(my + dy * t + (dx / len) * wave);

      const a = pull * (0.25 + 0.55 * Math.sin(t * Math.PI));
      ctx.fillStyle = `rgba(0, 0, 0, ${a.toFixed(2)})`;
      ctx.fillRect(px - 1, py - 1, 4, 4);
      ctx.fillStyle = `rgba(235, 238, 242, ${a.toFixed(2)})`;
      ctx.fillRect(px, py, 2, 2);
    }
  }

  private drawPixelBrackets(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    alpha: number,
    lockedOnElement: boolean
  ): void {
    const ctx = this.ctx;
    const w = Math.max(8, x2 - x1);
    const h = Math.max(8, y2 - y1);
    const armX = Math.min(10, Math.max(4, Math.floor(w * 0.22)));
    const armY = Math.min(10, Math.max(4, Math.floor(h * 0.28)));
    const t = 2; // espessura de 2px pixel-art

    // Sombra preta 1px para visibilidade total sobre fundo branco ou preto
    ctx.fillStyle = `rgba(0, 0, 0, ${(alpha * 0.9).toFixed(2)})`;
    const drawArms = (ox: number, oy: number) => {
      // Superior-esquerdo
      ctx.fillRect(x1 + ox, y1 + oy, armX, t);
      ctx.fillRect(x1 + ox, y1 + oy, t, armY);
      // Superior-direito
      ctx.fillRect(x2 - armX + ox, y1 + oy, armX, t);
      ctx.fillRect(x2 - t + ox, y1 + oy, t, armY);
      // Inferior-esquerdo
      ctx.fillRect(x1 + ox, y2 - t + oy, armX, t);
      ctx.fillRect(x1 + ox, y2 - armY + oy, t, armY);
      // Inferior-direito
      ctx.fillRect(x2 - armX + ox, y2 - t + oy, armX, t);
      ctx.fillRect(x2 - t + ox, y2 - armY + oy, t, armY);

      if (lockedOnElement && w > 40) {
        const mx = Math.round((x1 + x2) * 0.5);
        ctx.fillRect(mx - 2 + ox, y1 - 2 + oy, 4, 2);
        ctx.fillRect(mx - 2 + ox, y2 + oy, 4, 2);
      }
    };

    drawArms(1, 1);
    ctx.fillStyle = `rgba(240, 242, 245, ${alpha.toFixed(2)})`;
    drawArms(0, 0);
  }

  destroy(): void {
    this.disposed = true;
    cancelAnimationFrame(this.rafId);
    window.removeEventListener('pointermove', this.onMouseMoveBound);
    window.removeEventListener('pointerdown', this.onMouseDownBound);
    window.removeEventListener('touchend', this.onTouchEndBound);
    document.removeEventListener('mouseleave', this.onMouseLeaveBound);
    window.removeEventListener('resize', this.onResizeBound);
    this.canvas.remove();
  }
}
