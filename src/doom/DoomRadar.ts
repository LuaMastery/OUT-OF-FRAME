import {
  CELL_SIZE,
  isArchCell,
  isSolidCell,
  LABYRINTH_MAP,
  LAIR_GRID_CELL,
  STONE_SECTOR_START_ROW,
  worldToGridCell,
} from './DoomMazeBuilder';

export type RadarScaleMode = 'FULL' | 'LOCAL';

export interface ProbableEquipmentSignal {
  id: string;
  /** Coordenada X provável (com leve margem de sensor dentro da própria sala/corredor) */
  probableX: number;
  /** Coordenada Z provável (com leve margem de sensor dentro da própria sala/corredor) */
  probableZ: number;
  /** Raio de incerteza da assinatura eletromagnética em metros */
  uncertaintyRadiusM: number;
  /** Intensidade do eco (0.6..1.0) */
  signalStrength: number;
}

export interface RadarAllyBlip {
  id: string;
  name: string;
  x: number;
  z: number;
  yaw: number;
  trapped: boolean;
}

export interface RadarRenderState {
  playerX: number;
  playerZ: number;
  playerYaw: number;
  elapsedSec: number;
  mode: RadarScaleMode;
  exploredMask: Uint8Array;
  signals: readonly ProbableEquipmentSignal[];
  allies?: readonly RadarAllyBlip[];
}

export const RADAR_CANVAS_SIZE = 203; // 29 células × 7 px = 203 px exatos!

/**
 * Nome tático do setor atual na planta 29x29 para orientação imediata do jogador.
 */
export function getSectorNameForCell(gx: number, gz: number): string {
  if (gz < STONE_SECTOR_START_ROW) {
    if (gz <= 7 && gx <= 10) {
      if (gx >= 5 && gx <= 9 && gz >= 3 && gz <= 5) {
        return 'ENFERMARIA MÉDICA';
      }
      return 'ESCLUSA NOROESTE';
    }
    if (gz <= 8 && gx >= 18) {
      return 'SALÃO DOS REATORES';
    }
    if (gz <= 7 && gx >= 11 && gx <= 17) {
      return 'PONTE DE COMANDO';
    }
    if (gx >= 10 && gx <= 18 && gz >= 8 && gz <= 15) {
      return 'ÁTRIO CENTRAL';
    }
    if (gx <= 9) {
      return 'LOGÍSTICA OESTE';
    }
    return 'PAIOL LESTE';
  }

  if (
    Math.abs(gx - LAIR_GRID_CELL.gx) <= 2 &&
    Math.abs(gz - LAIR_GRID_CELL.gz) <= 2
  ) {
    return 'GRANDE NINHO SUL';
  }
  if (gx <= 10) {
    return 'MINAS SUDOESTE';
  }
  if (gx >= 19) {
    return 'CRIPTA — ALA B';
  }
  return 'CATACUMBAS CENTRAIS';
}

function wrapAngleDiff(a: number, b: number): number {
  let d = (a - b) % (Math.PI * 2);
  if (d < -Math.PI) d += Math.PI * 2;
  if (d > Math.PI) d -= Math.PI * 2;
  return d;
}

/**
 * Renderiza o minimapa tático CRT do Radar diretamente em um contexto 2D (203x203),
 * exibindo paredes/corredores de todo o complexo, ponto exato + direção do jogador
 * e zonas prováveis de outros equipamentos não coletados.
 */
export function renderRadarMinimapCanvas(
  ctx: CanvasRenderingContext2D,
  state: RadarRenderState
): void {
  const S = RADAR_CANVAS_SIZE;
  const rows = LABYRINTH_MAP.length;
  const cols = LABYRINTH_MAP[0].length;
  const totalWorldW = cols * CELL_SIZE;
  const totalWorldD = rows * CELL_SIZE;
  const halfW = totalWorldW * 0.5;
  const halfD = totalWorldD * 0.5;

  // Fundo escuro fosforescente de monitor CRT tático
  ctx.fillStyle = '#050a08';
  ctx.fillRect(0, 0, S, S);

  // Conversão de coordenadas mundo (metros) -> pixel do radar conforme escala (FULL 29x29 ou LOCAL 13.5x13.5)
  const localSpanMeters = 13.5 * CELL_SIZE;
  const pxPerMeter =
    state.mode === 'FULL' ? S / totalWorldW : S / localSpanMeters;

  const worldToPxX = (wx: number): number =>
    state.mode === 'FULL'
      ? ((wx + halfW) / totalWorldW) * S
      : (wx - state.playerX) * pxPerMeter + S * 0.5;

  const worldToPxY = (wz: number): number =>
    state.mode === 'FULL'
      ? ((wz + halfD) / totalWorldD) * S
      : (wz - state.playerZ) * pxPerMeter + S * 0.5;

  const cellPx = CELL_SIZE * pxPerMeter;

  // 1. PLANTA TOPOGRÁFICA DO COMPLEXO (corredores visitados vs varredura estrutural não visitada)
  for (let gz = 0; gz < rows; gz++) {
    const cz0 = -halfD + gz * CELL_SIZE;
    const py0 = Math.floor(worldToPxY(cz0));
    const py1 = Math.ceil(worldToPxY(cz0 + CELL_SIZE));
    if (py1 < 0 || py0 >= S) continue;

    const isStone = gz >= STONE_SECTOR_START_ROW;

    for (let gx = 0; gx < cols; gx++) {
      const cx0 = -halfW + gx * CELL_SIZE;
      const px0 = Math.floor(worldToPxX(cx0));
      const px1 = Math.ceil(worldToPxX(cx0 + CELL_SIZE));
      if (px1 < 0 || px0 >= S) continue;

      const ch = LABYRINTH_MAP[gz][gx];
      const solid = isSolidCell(LABYRINTH_MAP, gx, gz);
      const explored = state.exploredMask[gz * cols + gx] === 1;
      const w = Math.max(1, px1 - px0);
      const h = Math.max(1, py1 - py0);

      if (solid) {
        if (ch === 'M') {
          // Colunas blindadas estruturais destacadas para referência espacial rápida
          ctx.fillStyle = explored ? '#26443a' : '#152620';
          ctx.fillRect(px0, py0, w, h);
        } else {
          ctx.fillStyle = isStone ? '#090907' : '#060c09';
          ctx.fillRect(px0, py0, w, h);
        }
        continue;
      }

      // Corredor / salão transitável: visível em todo o mapa para o jogador nunca se perder,
      // com brilho mais vivo nas galerias já percorridas!
      if (isArchCell(LABYRINTH_MAP, gx, gz)) {
        ctx.fillStyle = explored ? '#2d5746' : '#183026';
      } else if (isStone) {
        ctx.fillStyle = explored ? '#2a2a19' : '#15160e';
      } else {
        ctx.fillStyle = explored ? '#173629' : '#0c1d16';
      }
      ctx.fillRect(px0, py0, w, h);

      // Contorno nítido de 1px apenas nas bordas com paredes sólidas (leitura limpa de planta baixa!)
      const edgeColor = explored
        ? isStone
          ? '#6f693c'
          : '#3e8a68'
        : isStone
          ? '#3b3922'
          : '#214a38';
      ctx.fillStyle = edgeColor;
      if (isSolidCell(LABYRINTH_MAP, gx, gz - 1)) {
        ctx.fillRect(px0, py0, w, 1);
      }
      if (isSolidCell(LABYRINTH_MAP, gx, gz + 1)) {
        ctx.fillRect(px0, py1 - 1, w, 1);
      }
      if (isSolidCell(LABYRINTH_MAP, gx - 1, gz)) {
        ctx.fillRect(px0, py0, 1, h);
      }
      if (isSolidCell(LABYRINTH_MAP, gx + 1, gz)) {
        ctx.fillRect(px1 - 1, py0, 1, h);
      }
    }
  }

  // Linhas sutis de retículo tático no visor
  ctx.fillStyle = 'rgba(72, 168, 124, 0.08)';
  for (let g = Math.round(S * 0.25); g < S; g += Math.round(S * 0.25)) {
    ctx.fillRect(g, 0, 1, S);
    ctx.fillRect(0, g, S, 1);
  }

  // Posição exata do jogador em pixels no visor
  const pPxX = worldToPxX(state.playerX);
  const pPxY = worldToPxY(state.playerZ);

  // 2. FEIXE ROTATIVO DE VARREDURA CRT (centrado na posição do jogador)
  const sweepAngle = (state.elapsedSec * 1.95) % (Math.PI * 2);
  const sweepRadius = S * 1.15;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(pPxX, pPxY);
  ctx.arc(pPxX, pPxY, sweepRadius, sweepAngle - 0.42, sweepAngle);
  ctx.closePath();
  ctx.fillStyle = 'rgba(78, 228, 158, 0.09)';
  ctx.fill();

  ctx.strokeStyle = 'rgba(120, 250, 188, 0.34)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pPxX, pPxY);
  ctx.lineTo(
    pPxX + Math.cos(sweepAngle) * sweepRadius,
    pPxY + Math.sin(sweepAngle) * sweepRadius
  );
  ctx.stroke();
  ctx.restore();

  // 3. PONTOS PROVÁVEIS PARA ENCONTRAR OUTROS EQUIPAMENTOS (ecos âmbar/ouro pulsantes)
  for (let i = 0; i < state.signals.length; i++) {
    const sig = state.signals[i];
    const sx = worldToPxX(sig.probableX);
    const sy = worldToPxY(sig.probableZ);

    // Se no modo LOCAL estiver fora do visor, projeta indicador discreto na borda do visor
    if (sx < 3 || sx > S - 4 || sy < 3 || sy > S - 4) {
      const cx = Math.max(4, Math.min(S - 5, Math.round(sx)));
      const cy = Math.max(4, Math.min(S - 5, Math.round(sy)));
      ctx.fillStyle = 'rgba(238, 184, 68, 0.72)';
      ctx.fillRect(cx - 1, cy - 1, 2, 2);
      continue;
    }

    const angToSig = Math.atan2(sy - pPxY, sx - pPxX);
    const diff = wrapAngleDiff(sweepAngle, angToSig);
    // Quando o feixe de varredura acaba de cruzar o sinal (0..0.95 rad), acende um pulso intenso de sonar!
    const pingGlow =
      diff >= 0 && diff < 1.05 ? (1 - diff / 1.05) * sig.signalStrength : 0;

    const haloRadius = Math.max(
      3.2,
      sig.uncertaintyRadiusM * pxPerMeter + pingGlow * 2.4
    );

    // Anel pontilhado da "zona provável" onde o equipamento pode ser encontrado
    ctx.save();
    ctx.strokeStyle = `rgba(245, 194, 76, ${(0.36 + pingGlow * 0.52).toFixed(3)})`;
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 2]);
    ctx.beginPath();
    ctx.arc(sx, sy, haloRadius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    // Núcleo do sinal provável (diamante pixel-art de alta legibilidade)
    const ix = Math.round(sx);
    const iy = Math.round(sy);
    ctx.fillStyle = pingGlow > 0.35 ? '#fff7cc' : '#f0b846';
    ctx.fillRect(ix, iy - 1, 1, 3);
    ctx.fillRect(ix - 1, iy, 3, 1);
    if (pingGlow > 0.45) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(ix, iy, 1, 1);
    }
  }

  // 3.5. ALIADOS CONECTADOS NO MULTIPLAYER CO-OP (Diamantes ciano ou alerta rubro se presos na teia!)
  if (state.allies && state.allies.length > 0) {
    for (const ally of state.allies) {
      const ax = worldToPxX(ally.x);
      const ay = worldToPxY(ally.z);
      if (ax < -4 || ax > S + 4 || ay < -4 || ay > S + 4) continue;
      const ix = Math.round(ax);
      const iy = Math.round(ay);
      ctx.fillStyle = '#04120d';
      ctx.fillRect(ix - 3, iy - 3, 7, 7);
      ctx.fillStyle = ally.trapped ? '#ff5959' : '#3ee6ff';
      ctx.fillRect(ix - 2, iy - 2, 5, 5);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(ix - 1, iy - 1, 3, 3);
    }
  }

  // 4. CONE DIRECIONAL DE VISÃO + PONTO EXATO DE LOCALIZAÇÃO DO JOGADOR
  // Convenção Three.js YXZ da câmera: frente no plano XZ = (-sin(yaw), -cos(yaw))
  const fwdX = -Math.sin(state.playerYaw);
  const fwdZ = -Math.cos(state.playerYaw);
  const lookAngle = Math.atan2(fwdZ, fwdX);
  const coneLen = Math.max(9, cellPx * 1.55);

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(pPxX, pPxY);
  ctx.arc(pPxX, pPxY, coneLen, lookAngle - 0.46, lookAngle + 0.46);
  ctx.closePath();
  ctx.fillStyle = 'rgba(92, 255, 196, 0.22)';
  ctx.fill();

  // Agulha nítida indicando o rumo exato para onde o astronauta está olhando
  ctx.strokeStyle = '#7effd4';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(pPxX, pPxY);
  ctx.lineTo(pPxX + fwdX * (coneLen * 0.85), pPxY + fwdZ * (coneLen * 0.85));
  ctx.stroke();
  ctx.restore();

  // Marcador central exato do jogador (contraste triplo: borda escura + halo esmeralda + núcleo branco)
  const pxInt = Math.round(pPxX);
  const pyInt = Math.round(pPxY);
  ctx.fillStyle = '#04120d';
  ctx.fillRect(pxInt - 3, pyInt - 3, 7, 7);
  ctx.fillStyle = '#32f5ad';
  ctx.fillRect(pxInt - 2, pyInt - 2, 5, 5);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(pxInt - 1, pyInt - 1, 3, 3);

  // Scanlines horizontais sutis de fósforo CRT
  ctx.fillStyle = 'rgba(0, 0, 0, 0.16)';
  for (let y = 0; y < S; y += 2) {
    ctx.fillRect(0, y, S, 1);
  }
}

/**
 * Controlador HUD e estado de exploração do Radar Topográfico EVA.
 * Permanece oculto até o jogador encontrar o item `field_radar` no complexo.
 */
export class DoomRadar {
  private readonly containerEl: HTMLDivElement | null = null;
  private readonly canvasEl: HTMLCanvasElement | null = null;
  private readonly ctx: CanvasRenderingContext2D | null = null;
  private readonly sectorEl: HTMLSpanElement | null = null;
  private readonly modeBadgeEl: HTMLButtonElement | null = null;
  private readonly coordsEl: HTMLSpanElement | null = null;
  private readonly signalsCountEl: HTMLSpanElement | null = null;

  private readonly exploredMask: Uint8Array;
  private owned = false;
  private active = false;
  private scaleMode: RadarScaleMode = 'FULL';
  private lastDrawMs = -1;

  constructor(parentViewport?: HTMLElement | null) {
    const rows = LABYRINTH_MAP.length;
    const cols = LABYRINTH_MAP[0].length;
    this.exploredMask = new Uint8Array(rows * cols);

    if (typeof document === 'undefined' || !parentViewport) {
      return;
    }

    this.injectStylesOnce();

    this.containerEl = document.createElement('div');
    this.containerEl.className = 'doom-radar-hud';
    this.containerEl.style.display = 'none';

    this.containerEl.innerHTML = `
      <div class="doom-radar-header">
        <span class="doom-radar-title" data-radar-sector>ESCLUSA NOROESTE</span>
        <button type="button" class="doom-radar-mode-btn" data-radar-mode title="Alternar escala do minimapa [N]">GERAL</button>
      </div>
      <div class="doom-radar-screen-wrap">
        <canvas width="${RADAR_CANVAS_SIZE}" height="${RADAR_CANVAS_SIZE}" class="doom-radar-canvas"></canvas>
      </div>
      <div class="doom-radar-footer">
        <span class="doom-radar-coords" data-radar-coords>POS 02,01</span>
        <span class="doom-radar-sig" data-radar-signals>0 SINAIS</span>
      </div>
      <div class="doom-radar-legend">
        <span><i class="dot-you"></i>VOCÊ</span>
        <span><i class="dot-item"></i>EQUIP. PROVÁVEL</span>
        <span class="doom-radar-keys">[M] RADAR · [N] ZOOM</span>
      </div>
    `;

    this.canvasEl = this.containerEl.querySelector(
      '.doom-radar-canvas'
    ) as HTMLCanvasElement;
    this.ctx = this.canvasEl.getContext('2d');
    this.sectorEl = this.containerEl.querySelector(
      '[data-radar-sector]'
    ) as HTMLSpanElement;
    this.modeBadgeEl = this.containerEl.querySelector(
      '[data-radar-mode]'
    ) as HTMLSpanElement as HTMLButtonElement;
    this.coordsEl = this.containerEl.querySelector(
      '[data-radar-coords]'
    ) as HTMLSpanElement;
    this.signalsCountEl = this.containerEl.querySelector(
      '[data-radar-signals]'
    ) as HTMLSpanElement;

    this.modeBadgeEl.addEventListener('click', (e) => {
      e.stopPropagation();
      this.cycleScaleMode();
    });

    parentViewport.appendChild(this.containerEl);
  }

  get hasRadar(): boolean {
    return this.owned;
  }

  get isActive(): boolean {
    return this.owned && this.active;
  }

  get mode(): RadarScaleMode {
    return this.scaleMode;
  }

  unlockAndActivate(): void {
    this.owned = true;
    this.active = true;
    this.syncVisibility(false);
  }

  toggleActive(): boolean {
    if (!this.owned) return false;
    this.active = !this.active;
    this.syncVisibility(false);
    return this.active;
  }

  cycleScaleMode(): RadarScaleMode {
    this.scaleMode = this.scaleMode === 'FULL' ? 'LOCAL' : 'FULL';
    if (this.modeBadgeEl) {
      this.modeBadgeEl.textContent =
        this.scaleMode === 'FULL' ? 'GERAL' : 'ZOOM';
    }
    this.lastDrawMs = -1;
    return this.scaleMode;
  }

  /**
   * Marca células próximas ao jogador como visitadas mesmo antes ou depois de coletar o radar.
   */
  markExploredAtWorld(wx: number, wz: number): void {
    const rows = LABYRINTH_MAP.length;
    const cols = LABYRINTH_MAP[0].length;
    const { gx, gz } = worldToGridCell(wx, wz);

    for (let dz = -2; dz <= 2; dz++) {
      for (let dx = -2; dx <= 2; dx++) {
        if (dx * dx + dz * dz > 5) continue;
        const nx = gx + dx;
        const nz = gz + dz;
        if (nz >= 0 && nz < rows && nx >= 0 && nx < cols) {
          this.exploredMask[nz * cols + nx] = 1;
        }
      }
    }
  }

  update(
    playerX: number,
    playerZ: number,
    playerYaw: number,
    elapsedSec: number,
    signals: readonly ProbableEquipmentSignal[],
    suppressHud: boolean,
    allies?: readonly RadarAllyBlip[]
  ): void {
    this.markExploredAtWorld(playerX, playerZ);
    this.syncVisibility(suppressHud);

    if (!this.owned || !this.active || suppressHud || !this.ctx) {
      return;
    }

    // ~24 qps no visor CRT para movimento suave com custo mínimo de CPU
    const nowMs = elapsedSec * 1000;
    if (this.lastDrawMs >= 0 && nowMs - this.lastDrawMs < 40) {
      return;
    }
    this.lastDrawMs = nowMs;

    const { gx, gz } = worldToGridCell(playerX, playerZ);
    const clampedGx = Math.max(0, Math.min(LABYRINTH_MAP[0].length - 1, gx));
    const clampedGz = Math.max(0, Math.min(LABYRINTH_MAP.length - 1, gz));

    if (this.sectorEl) {
      this.sectorEl.textContent = getSectorNameForCell(clampedGx, clampedGz);
    }
    if (this.coordsEl) {
      this.coordsEl.textContent = `SETOR [${String(clampedGx).padStart(2, '0')},${String(clampedGz).padStart(2, '0')}]`;
    }
    if (this.signalsCountEl) {
      this.signalsCountEl.textContent =
        signals.length === 1
          ? '1 SINAL ATIVO'
          : `${signals.length} SINAIS ATIVOS`;
    }

    renderRadarMinimapCanvas(this.ctx, {
      playerX,
      playerZ,
      playerYaw,
      elapsedSec,
      mode: this.scaleMode,
      exploredMask: this.exploredMask,
      signals,
      allies,
    });
  }

  private syncVisibility(suppressHud: boolean): void {
    if (!this.containerEl) return;
    const visible = this.owned && this.active && !suppressHud;
    this.containerEl.style.display = visible ? 'flex' : 'none';
  }

  destroy(): void {
    this.containerEl?.remove();
  }

  private injectStylesOnce(): void {
    if (document.getElementById('doom-radar-hud-styles')) return;
    const style = document.createElement('style');
    style.id = 'doom-radar-hud-styles';
    style.textContent = `
      .doom-radar-hud {
        position: absolute;
        top: 14px;
        right: 14px;
        z-index: 28;
        display: flex;
        flex-direction: column;
        gap: 4px;
        padding: 7px 8px 6px;
        background: linear-gradient(180deg, rgba(20, 24, 22, 0.94) 0%, rgba(10, 13, 12, 0.96) 100%);
        border: 2px solid #35473e;
        box-shadow:
          inset 0 0 0 1px #090d0b,
          0 6px 20px rgba(0, 0, 0, 0.72);
        font-family: "Courier New", Courier, monospace;
        user-select: none;
        pointer-events: auto;
      }

      .doom-radar-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 6px;
      }

      .doom-radar-title {
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.07em;
        color: #82e3b4;
        text-shadow: 0 0 6px rgba(80, 228, 158, 0.35);
        white-space: nowrap;
      }

      .doom-radar-mode-btn {
        padding: 1px 5px;
        font-family: inherit;
        font-size: 9px;
        font-weight: 700;
        letter-spacing: 0.06em;
        color: #d6efe2;
        background: #172b22;
        border: 1px solid #3c6e57;
        cursor: pointer;
      }

      .doom-radar-mode-btn:hover {
        background: #224234;
        border-color: #66be96;
      }

      .doom-radar-screen-wrap {
        position: relative;
        width: ${RADAR_CANVAS_SIZE}px;
        height: ${RADAR_CANVAS_SIZE}px;
        border: 1px solid #264a39;
        background: #040806;
        box-shadow: inset 0 0 12px rgba(0, 0, 0, 0.85);
      }

      .doom-radar-canvas {
        display: block;
        width: ${RADAR_CANVAS_SIZE}px;
        height: ${RADAR_CANVAS_SIZE}px;
        image-rendering: pixelated;
      }

      .doom-radar-footer {
        display: flex;
        align-items: center;
        justify-content: space-between;
        font-size: 10px;
        letter-spacing: 0.05em;
      }

      .doom-radar-coords {
        color: #93bda8;
      }

      .doom-radar-sig {
        color: #f0be59;
        font-weight: 700;
      }

      .doom-radar-legend {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 6px;
        padding-top: 3px;
        border-top: 1px solid #1b2922;
        font-size: 8.5px;
        color: #7d9689;
        letter-spacing: 0.03em;
      }

      .doom-radar-legend span {
        display: inline-flex;
        align-items: center;
        gap: 3px;
      }

      .doom-radar-legend .dot-you {
        display: inline-block;
        width: 6px;
        height: 6px;
        background: #32f5ad;
        border: 1px solid #ffffff;
      }

      .doom-radar-legend .dot-item {
        display: inline-block;
        width: 6px;
        height: 6px;
        background: #f0b846;
        border-radius: 50%;
      }

      .doom-radar-keys {
        color: #5f7a6c;
      }
    `;
    document.head.appendChild(style);
  }
}
