import {
  CELL_SIZE,
  isArchCell,
  LABYRINTH_MAP,
  LAIR_GRID_CELL,
  STONE_SECTOR_START_ROW,
  worldToGridCell,
} from './DoomMazeBuilder';
import {
  ANNEX_MAX_GRID,
  ANNEX_MIN_GRID,
  getThemedRoomAtCell,
  getThemedRoomMiniMapTile,
  isThemedRoomUnlocked,
  isWalkableArenaCell,
} from './DoomRooms';

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

export const RADAR_CANVAS_SIZE = 203; // Monitor CRT quadrado de 203x203 px
export const RADAR_EXTENDED_SPAN_CELLS = ANNEX_MAX_GRID - ANNEX_MIN_GRID + 1; // 41x41 (inclui as 7 Salas Anexas fora do mapa 29x29!)

/**
 * Nome tático do setor atual na planta 29x29 para orientação imediata do jogador.
 */
export function getSectorNameForCell(
  gx: number,
  gz: number,
  lairCell: { gx: number; gz: number } = LAIR_GRID_CELL
): string {
  if (
    Math.abs(gx - lairCell.gx) <= 2 &&
    Math.abs(gz - lairCell.gz) <= 2
  ) {
    return gz >= STONE_SECTOR_START_ROW ? 'GRANDE NINHO SUL' : 'NINHO DA ARANHA';
  }

  const themedRoom = getThemedRoomAtCell(gx, gz);
  if (themedRoom) {
    return themedRoom.name;
  }

  if (gz < STONE_SECTOR_START_ROW) {
    if (gz <= 7 && gx <= 10) {
      return 'ESCLUSA NOROESTE';
    }
    if (gz <= 8 && gx >= 18) {
      return 'SALÃO DOS REATORES';
    }
    if (gx >= 10 && gx <= 18 && gz >= 8 && gz <= 15) {
      return 'ÁTRIO CENTRAL';
    }
    if (gx <= 9) {
      return 'LOGÍSTICA OESTE';
    }
    return 'PAIOL LESTE';
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
  const coreHalfW = cols * CELL_SIZE * 0.5;
  const coreHalfD = rows * CELL_SIZE * 0.5;
  const extMinWorldX = -coreHalfW + ANNEX_MIN_GRID * CELL_SIZE;
  const extMinWorldZ = -coreHalfD + ANNEX_MIN_GRID * CELL_SIZE;
  const totalWorldW = RADAR_EXTENDED_SPAN_CELLS * CELL_SIZE;
  const totalWorldD = RADAR_EXTENDED_SPAN_CELLS * CELL_SIZE;

  // Fundo escuro fosforescente de monitor CRT tático
  ctx.fillStyle = '#050a08';
  ctx.fillRect(0, 0, S, S);

  // Conversão de coordenadas mundo (metros) -> pixel do radar conforme escala (FULL 41x41 com Salas Anexas ou LOCAL 13.5x13.5)
  const localSpanMeters = 13.5 * CELL_SIZE;
  const pxPerMeter =
    state.mode === 'FULL' ? S / totalWorldW : S / localSpanMeters;

  const worldToPxX = (wx: number): number =>
    state.mode === 'FULL'
      ? ((wx - extMinWorldX) / totalWorldW) * S
      : (wx - state.playerX) * pxPerMeter + S * 0.5;

  const worldToPxY = (wz: number): number =>
    state.mode === 'FULL'
      ? ((wz - extMinWorldZ) / totalWorldD) * S
      : (wz - state.playerZ) * pxPerMeter + S * 0.5;

  const cellPx = CELL_SIZE * pxPerMeter;

  const isExtendedMask =
    state.exploredMask.length >=
    RADAR_EXTENDED_SPAN_CELLS * RADAR_EXTENDED_SPAN_CELLS;
  const isCellExplored = (gx: number, gz: number): boolean => {
    if (isExtendedMask) {
      const idx =
        (gz - ANNEX_MIN_GRID) * RADAR_EXTENDED_SPAN_CELLS +
        (gx - ANNEX_MIN_GRID);
      return state.exploredMask[idx] === 1;
    }
    if (gx >= 0 && gx < cols && gz >= 0 && gz < rows) {
      return state.exploredMask[gz * cols + gx] === 1;
    }
    return false;
  };

  // 1. PLANTA TOPOGRÁFICA DO COMPLEXO + 7 SALAS ESPECIAIS ANEXAS FORA DO MAPA
  for (let gz = ANNEX_MIN_GRID; gz <= ANNEX_MAX_GRID; gz++) {
    const cz0 = -coreHalfD + gz * CELL_SIZE;
    const py0 = Math.floor(worldToPxY(cz0));
    const py1 = Math.ceil(worldToPxY(cz0 + CELL_SIZE));
    if (py1 < 0 || py0 >= S) continue;

    const inCoreZ = gz >= 0 && gz < rows;
    const isStone = inCoreZ && gz >= STONE_SECTOR_START_ROW;

    for (let gx = ANNEX_MIN_GRID; gx <= ANNEX_MAX_GRID; gx++) {
      const cx0 = -coreHalfW + gx * CELL_SIZE;
      const px0 = Math.floor(worldToPxX(cx0));
      const px1 = Math.ceil(worldToPxX(cx0 + CELL_SIZE));
      if (px1 < 0 || px0 >= S) continue;

      const inCore = inCoreZ && gx >= 0 && gx < cols;
      const walkable = isWalkableArenaCell(gx, gz, { ignoreRoomLocks: true });
      const room = getThemedRoomAtCell(gx, gz);
      const explored = isCellExplored(gx, gz);
      const w = Math.max(1, px1 - px0);
      const h = Math.max(1, py1 - py0);

      if (!walkable) {
        if (inCore) {
          const ch = LABYRINTH_MAP[gz][gx];
          if (ch === 'M') {
            ctx.fillStyle = explored ? '#26443a' : '#152620';
            ctx.fillRect(px0, py0, w, h);
          } else {
            ctx.fillStyle = isStone ? '#090907' : '#060c09';
            ctx.fillRect(px0, py0, w, h);
          }
        } else if (room) {
          const miniTile = getThemedRoomMiniMapTile(gx, gz);
          if (miniTile === 'C') {
            ctx.fillStyle = explored ? '#2f5a60' : '#183034';
            ctx.fillRect(px0, py0, w, h);
          } else if (miniTile === '#') {
            // Parede divisória interna do mini-mapa 7x7 da Sala Especial!
            ctx.fillStyle = explored ? '#0b1815' : '#060d0b';
            ctx.fillRect(px0, py0, w, h);
          }
        }
        continue;
      }

      // Corredor / salão transitável ou Sala Especial Anexa fora do mapa 29x29!
      if (inCore && isArchCell(LABYRINTH_MAP, gx, gz)) {
        ctx.fillStyle = explored ? '#2d5746' : '#183026';
      } else if (room) {
        switch (room.id) {
          case 'computer_room':
            ctx.fillStyle = explored ? '#1b474d' : '#0f282c';
            break;
          case 'biology_lab':
            ctx.fillStyle = explored ? '#1e4b3f' : '#102a23';
            break;
          case 'vegetation_room':
            ctx.fillStyle = explored ? '#254e28' : '#142b16';
            break;
          case 'library_room':
            ctx.fillStyle = explored ? '#443022' : '#241912';
            break;
          case 'crew_quarters':
            ctx.fillStyle = explored ? '#2a4230' : '#16241a';
            break;
          case 'medical_ward':
            ctx.fillStyle = explored ? '#214645' : '#122726';
            break;
          default:
            ctx.fillStyle = explored ? '#224739' : '#12271f';
            break;
        }
      } else if (isStone) {
        ctx.fillStyle = explored ? '#2a2a19' : '#15160e';
      } else {
        ctx.fillStyle = explored ? '#173629' : '#0c1d16';
      }
      ctx.fillRect(px0, py0, w, h);

      // Sinalização visual nítida de porta blindada TRANCADA vs DESTRANCADA nas Salas Especiais
      if (
        room &&
        gx === room.doorGx &&
        gz === room.doorGz &&
        !isThemedRoomUnlocked(room.id)
      ) {
        ctx.fillStyle = '#ff4b5c';
        if (room.outwardDir === 'N' || room.outwardDir === 'S') {
          ctx.fillRect(px0, Math.round((py0 + py1) * 0.5) - 1, w, Math.max(2, Math.round(h * 0.36)));
        } else {
          ctx.fillRect(Math.round((px0 + px1) * 0.5) - 1, py0, Math.max(2, Math.round(w * 0.36)), h);
        }
      }

      // Contorno nítido de 1px nas bordas com paredes sólidas e divisórias internas '#' dos mini-mapas!
      const edgeColor = room
        ? explored
          ? '#52b49a'
          : '#2d6858'
        : explored
          ? isStone
            ? '#6f693c'
            : '#3e8a68'
          : isStone
            ? '#3b3922'
            : '#214a38';
      ctx.fillStyle = edgeColor;
      if (!isWalkableArenaCell(gx, gz - 1, { ignoreRoomLocks: true })) {
        ctx.fillRect(px0, py0, w, 1);
      }
      if (!isWalkableArenaCell(gx, gz + 1, { ignoreRoomLocks: true })) {
        ctx.fillRect(px0, py1 - 1, w, 1);
      }
      if (!isWalkableArenaCell(gx - 1, gz, { ignoreRoomLocks: true })) {
        ctx.fillRect(px0, py0, 1, h);
      }
      if (!isWalkableArenaCell(gx + 1, gz, { ignoreRoomLocks: true })) {
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
  private readonly lairCell: { gx: number; gz: number };
  private owned = false;
  private active = false;
  private scaleMode: RadarScaleMode = 'FULL';
  private lastDrawMs = -1;

  constructor(
    parentViewport?: HTMLElement | null,
    lairCell: { gx: number; gz: number } = LAIR_GRID_CELL
  ) {
    this.lairCell = lairCell;
    this.exploredMask = new Uint8Array(
      RADAR_EXTENDED_SPAN_CELLS * RADAR_EXTENDED_SPAN_CELLS
    );

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

    this.canvasEl.addEventListener('click', (e) => {
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
    const { gx, gz } = worldToGridCell(wx, wz);

    for (let dz = -2; dz <= 2; dz++) {
      for (let dx = -2; dx <= 2; dx++) {
        if (dx * dx + dz * dz > 5) continue;
        const nx = gx + dx;
        const nz = gz + dz;
        if (
          nz >= ANNEX_MIN_GRID &&
          nz <= ANNEX_MAX_GRID &&
          nx >= ANNEX_MIN_GRID &&
          nx <= ANNEX_MAX_GRID
        ) {
          this.exploredMask[
            (nz - ANNEX_MIN_GRID) * RADAR_EXTENDED_SPAN_CELLS +
              (nx - ANNEX_MIN_GRID)
          ] = 1;
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
    const clampedGx = Math.max(ANNEX_MIN_GRID, Math.min(ANNEX_MAX_GRID, gx));
    const clampedGz = Math.max(ANNEX_MIN_GRID, Math.min(ANNEX_MAX_GRID, gz));
    const fmtCoord = (v: number): string =>
      v < 0 ? `-${String(Math.abs(v)).padStart(2, '0')}` : String(v).padStart(2, '0');

    if (this.sectorEl) {
      this.sectorEl.textContent = getSectorNameForCell(
        clampedGx,
        clampedGz,
        this.lairCell
      );
    }
    if (this.coordsEl) {
      const prefix = getThemedRoomAtCell(clampedGx, clampedGz) ? 'ALA' : 'SETOR';
      this.coordsEl.textContent = `${prefix} [${fmtCoord(clampedGx)},${fmtCoord(clampedGz)}]`;
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
        top: calc(14px + var(--safe-top, 0px));
        right: calc(14px + var(--safe-right, 0px));
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
        font-family: 'Geist Pixel', monospace;
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

      @media (max-width: 760px), (max-height: 500px) {
        .doom-radar-hud {
          top: calc(8px + var(--safe-top, 0px));
          right: calc(8px + var(--safe-right, 0px));
          padding: 4px 5px;
          gap: 3px;
        }

        .doom-radar-title {
          max-width: 74px;
          overflow: hidden;
          text-overflow: ellipsis;
          font-size: 8.5px;
        }

        .doom-radar-screen-wrap,
        .doom-radar-canvas {
          width: 106px;
          height: 106px;
        }

        .doom-radar-legend {
          display: none;
        }

        .doom-radar-footer {
          font-size: 8.5px;
        }
      }
    `;
    document.head.appendChild(style);
  }
}
