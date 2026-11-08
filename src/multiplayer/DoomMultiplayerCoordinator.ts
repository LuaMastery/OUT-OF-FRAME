import * as THREE from 'three';
import { DoomAstronaut } from '../doom/DoomAstronaut';
import {
  CELL_SIZE,
  isSolidCell,
  LABYRINTH_MAP,
  worldToGridCell,
} from '../doom/DoomMazeBuilder';
import { getSectorNameForCell, RadarAllyBlip } from '../doom/DoomRadar';
import { DoomSharedUniforms } from '../doom/DoomShader';
import { SoundEngine } from '../engine/audio/SoundEngine';
import {
  ActiveRoomSession,
  AFK_IDLE_TIMEOUT_MS,
  formatRoomCodeDisplay,
  MultiplayerRoomClient,
  NetworkPlayerPosePacket,
  NetworkSpiderPacket,
  NetworkWorldEvent,
  RoomPlayerSummary,
} from './MultiplayerService';

interface RemoteAllyEntity {
  id: string;
  name: string;
  astronaut: DoomAstronaut;
  beamGroup: THREE.Group;
  labelEl: HTMLDivElement;
  labelAfkRowEl: HTMLDivElement;
  labelTextEl: HTMLDivElement;
  currentPos: THREE.Vector3;
  targetPos: THREE.Vector3;
  currentYaw: number;
  targetYaw: number;
  pitch: number;
  speed: number;
  bobPhase: number;
  crouch: number;
  flashlightOn: boolean;
  health: number;
  bleeding: boolean;
  ensnared: boolean;
  inSequence: boolean;
  dead: boolean;
  afk: boolean;
  lastAfkNoticeMs: number;
  lastSeenMs: number;
}

interface ActiveTacticalPing {
  id: string;
  worldPos: THREE.Vector3;
  meshGroup: THREE.Group;
  markerEl: HTMLDivElement;
  expiresAtSec: number;
}

export interface MultiplayerCoordinatorHooks {
  onReceiveFlare: (pos: THREE.Vector3, yaw: number) => void;
  onRescuedByAlly: (rescuerName: string) => void;
  onNotifyHud: (text: string) => void;
  onLeaveRoomRequested: () => void;
}

function lerpAngleShortest(a: number, b: number, t: number): number {
  let diff = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return a + diff * t;
}

const AFK_SVG_ICON =
  '<svg class="oof-afk-icon-svg" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">' +
  '<circle cx="8" cy="8" r="6.5" fill="rgba(45,30,4,0.9)" stroke="#ffca63" stroke-width="1.5"/>' +
  '<rect x="5.2" y="4.8" width="2" height="6.4" rx="0.5" fill="#ffd980"/>' +
  '<rect x="8.8" y="4.8" width="2" height="6.4" rx="0.5" fill="#ffd980"/>' +
  '</svg>';

function createAfkBadgeElement(label = 'AFK • AUSENTE'): HTMLSpanElement {
  const badge = document.createElement('span');
  badge.className = 'oof-afk-badge';
  badge.title = 'Jogador indisponível / ausente (AFK)';
  badge.innerHTML = `${AFK_SVG_ICON}<span>${label}</span>`;
  return badge;
}

/**
 * Coordenador Cooperativo em Tempo Real dentro do Labirinto 3D:
 * - Renderiza os Astronautas 3D completos dos aliados com lanterna volumétrica e plaqueta de nome/vida.
 * - Sincroniza a Aranha Gigante (Host-Authoritative com migração automática de Host).
 * - Suporta Resgate Cooperativo de Teias, Pings Táticos 3D [V], Rádio Rápido [T] e Convite Rápido.
 */
export class DoomMultiplayerCoordinator {
  private readonly client: MultiplayerRoomClient;
  private readonly allies = new Map<string, RemoteAllyEntity>();
  private readonly pings: ActiveTacticalPing[] = [];

  private latestSpiderPacket: NetworkSpiderPacket | null = null;
  private poseSendAccum = 0;
  private spiderSendAccum = 0;
  private hudRefreshAccum = 0;
  private maskRoomCode = false;
  private chatInputActive = false;
  private wasLocalEnsnared = false;
  private localAfk = false;

  private readonly hudRootEl: HTMLDivElement;
  private readonly roomTagEl: HTMLSpanElement;
  private readonly pingEl: HTMLSpanElement;
  private readonly squadListEl: HTMLDivElement;
  private readonly chatFeedEl: HTMLDivElement;
  private readonly chatBoxEl: HTMLDivElement;
  private readonly chatInputEl: HTMLInputElement;
  private readonly worldLabelsLayerEl: HTMLDivElement;

  private roster: RoomPlayerSummary[] = [];
  private readonly projVec = new THREE.Vector3();
  private readonly muzzlePosScratch = new THREE.Vector3();
  private readonly muzzleDirScratch = new THREE.Vector3();
  private readonly unitNegZ = new THREE.Vector3(0, 0, -1);
  private readonly allyDynamicLightsScratch: Array<{
    position: THREE.Vector3;
    intensity: number;
  }> = [];

  constructor(
    public readonly session: ActiveRoomSession,
    private readonly scene: THREE.Scene,
    private readonly sharedUniforms: DoomSharedUniforms,
    private readonly viewportEl: HTMLElement,
    private readonly sound: SoundEngine,
    private readonly hooks: MultiplayerCoordinatorHooks
  ) {
    this.roster = [...session.playersSummary];

    // Camada de projeção 3D -> 2D para nomes sobre capacetes e pings táticos
    this.worldLabelsLayerEl = document.createElement('div');
    this.worldLabelsLayerEl.className = 'oof-coop-world-labels';
    this.viewportEl.appendChild(this.worldLabelsLayerEl);

    // HUD compacto do Esquadrão & Sala no canto superior esquerdo
    this.hudRootEl = document.createElement('div');
    this.hudRootEl.className = 'oof-coop-hud';
    this.hudRootEl.innerHTML = `
      <div class="oof-coop-room-Card">
        <div class="oof-coop-room-row">
          <span class="oof-coop-room-tag" data-coop-room-tag></span>
          <span class="oof-coop-ping" data-coop-ping>ONLINE</span>
        </div>
        <div class="oof-coop-mini-actions">
          <button type="button" class="oof-coop-mini-btn" data-coop-copy-code title="Copiar Número da Sala">[COPIAR Nº]</button>
          <button type="button" class="oof-coop-mini-btn" data-coop-copy-link title="Copiar Link de Convite Direto">[LINK]</button>
          <button type="button" class="oof-coop-mini-btn" data-coop-mask title="Mostrar/Ocultar código na tela">[OCULTAR Nº]</button>
          <button type="button" class="oof-coop-mini-btn" data-coop-leave title="Desconectar desta sala">[SAIR]</button>
        </div>
        <div class="oof-coop-squad-list" data-coop-squad></div>
        <div class="oof-coop-keys-hint">[T] Rádio  •  [V] Sinalizar 3D  •  [E/Faca] Salvar Aliado</div>
      </div>
      <div class="oof-coop-chat-feed" data-coop-feed></div>
      <div class="oof-coop-chat-box hidden" data-coop-chat-box>
        <input type="text" class="oof-coop-chat-input" data-coop-chat-input maxlength="90" placeholder="Mensagem de rádio para o esquadrão... [Enter]" autocomplete="off" />
      </div>
    `;
    this.viewportEl.appendChild(this.hudRootEl);

    this.roomTagEl = this.hudRootEl.querySelector(
      '[data-coop-room-tag]'
    ) as HTMLSpanElement;
    this.pingEl = this.hudRootEl.querySelector(
      '[data-coop-ping]'
    ) as HTMLSpanElement;
    this.squadListEl = this.hudRootEl.querySelector(
      '[data-coop-squad]'
    ) as HTMLDivElement;
    this.chatFeedEl = this.hudRootEl.querySelector(
      '[data-coop-feed]'
    ) as HTMLDivElement;
    this.chatBoxEl = this.hudRootEl.querySelector(
      '[data-coop-chat-box]'
    ) as HTMLDivElement;
    this.chatInputEl = this.hudRootEl.querySelector(
      '[data-coop-chat-input]'
    ) as HTMLInputElement;

    this.bindHudButtons();

    this.client = new MultiplayerRoomClient(session, {
      onRemotePlayerPose: (pkt) => this.handleRemotePose(pkt),
      onRemotePlayerLeft: (playerId) => this.removeAlly(playerId),
      onSpiderSync: (pkt) => {
        this.latestSpiderPacket = pkt;
      },
      onWorldEvent: (ev) => this.handleWorldEvent(ev),
      onRosterUpdated: (players) => {
        this.roster = players;
        // Se alguém saiu explicitamente via mp_leave_room e não está mais no roster do servidor,
        // limpamos sua entidade; caso esteja como AFK/HOST_AFK, preservamos e marcamos AFK!
        for (const r of players) {
          const ally = this.allies.get(r.id);
          if (ally && (r.status === 'AFK' || r.status === 'HOST_AFK')) {
            this.applyAllyAfkTransition(ally, true);
          }
        }
        this.renderSquadHud();
      },
    });

    this.client.connect();
    this.renderSquadHud();
    this.pushRadioFeed(
      `Conectado à sala #${formatRoomCodeDisplay(session.roomCode)} (${session.roomName}).`,
      false
    );
  }

  get isHost(): boolean {
    return this.client.isHost;
  }

  get isChatTyping(): boolean {
    return this.chatInputActive;
  }

  seedInitialLocalPose(pos: THREE.Vector3, yaw: number): void {
    this.client.broadcastPlayerPose({
      x: pos.x,
      y: pos.y,
      z: pos.z,
      yaw,
      pitch: 0,
      speed: 0,
      bobPhase: 0,
      crouch: 0,
      flashlightOn: false,
      flashDirX: -Math.sin(yaw),
      flashDirY: 0,
      flashDirZ: -Math.cos(yaw),
      health: 100,
      bleeding: false,
      ensnared: false,
      inSequence: false,
      dead: false,
      afk: false,
    });
  }

  pushHudNotice(text: string): void {
    this.pushRadioFeed(text, false);
  }

  openRadioChatInput(): void {
    if (this.chatInputActive) return;
    this.chatInputActive = true;
    this.chatBoxEl.classList.remove('hidden');
    try {
      document.exitPointerLock?.();
    } catch {
      // Ignorar
    }
    window.setTimeout(() => this.chatInputEl.focus(), 10);
  }

  closeRadioChatInput(): void {
    this.chatInputActive = false;
    this.chatInputEl.value = '';
    this.chatBoxEl.classList.add('hidden');
  }

  emitTacticalPing(
    cameraPos: THREE.Vector3,
    cameraDir: THREE.Vector3,
    spiderPos: THREE.Vector3,
    elapsedSec: number
  ): void {
    // Raymarch simples pelos blocos do labirinto até 13m à frente da mira
    const hitPos = cameraPos.clone();
    const step = 0.35;
    for (let d = 0.7; d <= 13.0; d += step) {
      const px = cameraPos.x + cameraDir.x * d;
      const py = Math.max(0.15, Math.min(2.95, cameraPos.y + cameraDir.y * d));
      const pz = cameraPos.z + cameraDir.z * d;
      const { gx, gz } = worldToGridCell(px, pz);
      if (isSolidCell(LABYRINTH_MAP, gx, gz)) {
        break;
      }
      hitPos.set(px, py, pz);
    }

    const nearSpider = hitPos.distanceTo(spiderPos) < 3.6;
    const label = nearSpider
      ? `🕷️ PERIGO: ARANHA!`
      : `📍 ${this.session.localPlayerName}`;

    this.spawnLocalPingVisual(
      `${this.session.localPlayerId}-${Date.now()}`,
      hitPos,
      label,
      nearSpider,
      elapsedSec
    );
    this.sound.playRadarPing(true);

    this.client.broadcastWorldEvent({
      kind: 'ping',
      senderId: this.session.localPlayerId,
      senderName: this.session.localPlayerName,
      label,
      danger: nearSpider,
      x: hitPos.x,
      y: hitPos.y,
      z: hitPos.z,
      ts: Date.now(),
    });
  }

  notifyFlareSpawned(pos: THREE.Vector3, yaw: number): void {
    this.client.broadcastWorldEvent({
      kind: 'flare',
      senderId: this.session.localPlayerId,
      x: pos.x,
      y: pos.y,
      z: pos.z,
      yaw,
      ts: Date.now(),
    });
  }

  /**
   * Permite que um aliado liberte outro jogador preso em teia ao chegar perto (< 2.8m) e usar [E] ou Faca!
   */
  tryRescueNearbyTrappedAlly(localPos: THREE.Vector3): boolean {
    for (const ally of this.allies.values()) {
      if (!ally.ensnared || ally.dead) continue;
      const d = Math.hypot(
        ally.currentPos.x - localPos.x,
        ally.currentPos.z - localPos.z
      );
      if (d <= 2.85) {
        ally.ensnared = false;
        this.client.broadcastWorldEvent({
          kind: 'rescue_ally',
          rescuerId: this.session.localPlayerId,
          rescuerName: this.session.localPlayerName,
          targetPlayerId: ally.id,
          ts: Date.now(),
        });
        this.pushRadioFeed(
          `Você cortou a teia e salvou ${ally.name}!`,
          false
        );
        return true;
      }
    }
    return false;
  }

  /**
   * No Host, escolhe o jogador vivo mais próximo da Aranha (entre o Host e os aliados)
   * para que o monstro cace todo o esquadrão de forma justa!
   */
  pickSpiderTargetPlayer(
    localPos: THREE.Vector3,
    localYaw: number,
    localSprinting: boolean,
    localCrouching: boolean,
    localFlashlightOn: boolean,
    spiderPos: THREE.Vector3,
    localAfk = false
  ): {
    targetPos: THREE.Vector3;
    targetYaw: number;
    sprinting: boolean;
    crouching: boolean;
    flashlightOn: boolean;
    targetingLocal: boolean;
  } {
    let bestPos = localPos;
    let bestYaw = localYaw;
    let bestSprint = localSprinting;
    let bestCrouch = localCrouching;
    let bestFlash = localFlashlightOn;
    let targetingLocal = true;
    // Penaliza levemente alvos AFK quando há outro operador ativo jogando na partida
    let bestScore =
      Math.hypot(localPos.x - spiderPos.x, localPos.z - spiderPos.z) +
      (localAfk ? 14 : 0);

    for (const ally of this.allies.values()) {
      if (ally.dead || ally.inSequence) {
        continue;
      }
      const d =
        Math.hypot(
          ally.currentPos.x - spiderPos.x,
          ally.currentPos.z - spiderPos.z
        ) + (ally.afk ? 14 : 0);
      if (d < bestScore - 0.5) {
        bestScore = d;
        bestPos = ally.currentPos;
        bestYaw = ally.currentYaw;
        bestSprint = !ally.afk && ally.speed > 7.0;
        bestCrouch = ally.crouch > 0.5;
        bestFlash = ally.flashlightOn;
        targetingLocal = false;
      }
    }

    return {
      targetPos: bestPos,
      targetYaw: bestYaw,
      sprinting: bestSprint,
      crouching: bestCrouch,
      flashlightOn: bestFlash,
      targetingLocal,
    };
  }

  consumeLatestRemoteSpiderPacket(): NetworkSpiderPacket | null {
    return this.latestSpiderPacket;
  }

  getRadarAllyBlips(): RadarAllyBlip[] {
    const blips: RadarAllyBlip[] = [];
    for (const ally of this.allies.values()) {
      if (ally.dead) continue;
      blips.push({
        id: ally.id,
        name: ally.name,
        x: ally.currentPos.x,
        z: ally.currentPos.z,
        yaw: ally.currentYaw,
        trapped: ally.ensnared || ally.inSequence,
      });
    }
    return blips;
  }

  update(
    dt: number,
    elapsedSec: number,
    camera: THREE.PerspectiveCamera,
    localState: {
      pos: THREE.Vector3;
      yaw: number;
      pitch: number;
      speed: number;
      bobPhase: number;
      crouch: number;
      flashlightOn: boolean;
      flashDir: THREE.Vector3;
      health: number;
      bleeding: boolean;
      ensnared: boolean;
      inSequence: boolean;
      dead: boolean;
      afk?: boolean;
    },
    spiderSnapshot: {
      x: number;
      y: number;
      z: number;
      upX: number;
      upY: number;
      upZ: number;
      fwdX: number;
      fwdY: number;
      fwdZ: number;
      state: string;
      surfaceMode: 'FLOOR' | 'WALL' | 'CEILING';
    },
    hideHud: boolean
  ): void {
    this.hudRootEl.style.display = hideHud ? 'none' : 'flex';
    this.worldLabelsLayerEl.style.display = hideHud ? 'none' : 'block';

    // Alerta SOS automático quando o jogador local cai numa armadilha de teia!
    if (localState.ensnared && !this.wasLocalEnsnared) {
      const { gx, gz } = worldToGridCell(localState.pos.x, localState.pos.z);
      const sector = getSectorNameForCell(gx, gz);
      this.client.broadcastWorldEvent({
        kind: 'sos_alert',
        senderId: this.session.localPlayerId,
        senderName: this.session.localPlayerName,
        sectorName: sector,
        x: localState.pos.x,
        z: localState.pos.z,
        ts: Date.now(),
      });
    }
    this.wasLocalEnsnared = localState.ensnared;

    const nextLocalAfk = Boolean(localState.afk);
    if (this.localAfk !== nextLocalAfk) {
      this.localAfk = nextLocalAfk;
      this.client.setLocalAfk(nextLocalAfk);
      this.renderSquadHud();
    }

    // 1. Transmite pose 3D do jogador local (~16 Hz quando ativo; inclui estado AFK!)
    this.poseSendAccum += dt;
    if (this.poseSendAccum >= 0.062) {
      this.poseSendAccum = 0;
      this.client.broadcastPlayerPose({
        x: localState.pos.x,
        y: localState.pos.y,
        z: localState.pos.z,
        yaw: localState.yaw,
        pitch: localState.pitch,
        speed: nextLocalAfk ? 0 : localState.speed,
        bobPhase: localState.bobPhase,
        crouch: localState.crouch,
        flashlightOn: localState.flashlightOn,
        flashDirX: localState.flashDir.x,
        flashDirY: localState.flashDir.y,
        flashDirZ: localState.flashDir.z,
        health: Math.round(localState.health),
        bleeding: localState.bleeding,
        ensnared: localState.ensnared,
        inSequence: localState.inSequence,
        dead: localState.dead,
        afk: nextLocalAfk,
      });
    }

    // 2. Se for o Host da sala, transmite o estado autoritativo da Aranha Gigante (~15 Hz)
    if (this.client.isHost) {
      this.spiderSendAccum += dt;
      if (this.spiderSendAccum >= 0.066) {
        this.spiderSendAccum = 0;
        this.client.broadcastSpiderState(spiderSnapshot);
      }
    }

    // 3. Interpola e articula todos os Astronautas aliados 3D + projeta plaquetas de nome
    const nowMs = performance.now();
    const smooth = 1 - Math.exp(-13 * dt);
    const viewW = window.innerWidth;
    const viewH = window.innerHeight;

    for (const ally of this.allies.values()) {
      // Jamais derruba o jogador por ficar parado/inativo!
      // Caso a aba remota congele sem pacotes por >= AFK_IDLE_TIMEOUT_MS, sinaliza AFK mantendo-o na partida.
      if (nowMs - ally.lastSeenMs >= AFK_IDLE_TIMEOUT_MS && !ally.afk) {
        this.applyAllyAfkTransition(ally, true);
      }

      if (ally.currentPos.distanceToSquared(ally.targetPos) > 36) {
        ally.currentPos.copy(ally.targetPos);
      } else {
        ally.currentPos.lerp(ally.targetPos, smooth);
      }
      ally.currentYaw = lerpAngleShortest(
        ally.currentYaw,
        ally.targetYaw,
        smooth
      );
      const effectiveSpeed = ally.afk ? 0 : ally.speed;
      if (effectiveSpeed > 0.25) {
        ally.bobPhase += dt * (6.8 + effectiveSpeed * 0.75);
      }

      if (ally.dead) {
        ally.astronaut.setFirstPersonMode(true);
        ally.beamGroup.visible = false;
        ally.labelEl.style.display = 'none';
        continue;
      }

      ally.astronaut.updateThirdPersonAlly(
        ally.currentPos,
        ally.currentYaw,
        ally.pitch,
        ally.bobPhase,
        effectiveSpeed,
        ally.crouch,
        ally.flashlightOn,
        ally.ensnared || ally.inSequence,
        ally.afk
      );

      // Foco sutil no bocal ancorado exatamente na frente da lente da lanterna 3D sólida do aliado
      const hasMuzzle =
        ally.flashlightOn &&
        !ally.ensnared &&
        !ally.inSequence &&
        ally.astronaut.getThirdPersonFlashlightMuzzleWorld(
          this.muzzlePosScratch,
          this.muzzleDirScratch
        );
      ally.beamGroup.visible = hasMuzzle;
      if (hasMuzzle) {
        ally.beamGroup.position.copy(this.muzzlePosScratch);
        ally.beamGroup.quaternion.setFromUnitVectors(
          this.unitNegZ,
          this.muzzleDirScratch
        );
      }

      // Projeção na tela da etiqueta acima do capacete do aliado (com ícone de AFK quando ausente!)
      const headHeight = 1.94 - ally.crouch * 0.42;
      this.projVec.set(
        ally.currentPos.x,
        ally.currentPos.y + headHeight,
        ally.currentPos.z
      );
      const dist = this.projVec.distanceTo(camera.position);
      this.projVec.project(camera);

      if (this.projVec.z < 1.0 && dist < 34) {
        const sx = (this.projVec.x * 0.5 + 0.5) * viewW;
        const sy = (-this.projVec.y * 0.5 + 0.5) * viewH;
        ally.labelEl.style.display = 'flex';
        ally.labelEl.style.left = `${sx.toFixed(1)}px`;
        ally.labelEl.style.top = `${sy.toFixed(1)}px`;
        ally.labelEl.classList.toggle(
          'trapped',
          ally.ensnared || ally.inSequence
        );
        ally.labelEl.classList.toggle(
          'afk',
          ally.afk && !ally.ensnared && !ally.inSequence
        );
        ally.labelAfkRowEl.style.display = ally.afk ? 'inline-flex' : 'none';

        if (ally.ensnared) {
          ally.labelTextEl.textContent = `🕸️ ${ally.name} — PRESO NA TEIA! [E / FACA]`;
        } else if (ally.inSequence) {
          ally.labelTextEl.textContent = `⚠ ${ally.name} — ATACADO PELA ARANHA!`;
        } else if (ally.afk) {
          ally.labelTextEl.textContent = `${ally.name} • INDÍSP.`;
        } else {
          ally.labelTextEl.textContent = `${ally.name} • ${ally.health}%`;
        }
      } else {
        ally.labelEl.style.display = 'none';
      }
    }

    // 4. Atualiza Pings Táticos 3D ativos
    for (let i = this.pings.length - 1; i >= 0; i--) {
      const p = this.pings[i];
      if (elapsedSec >= p.expiresAtSec) {
        this.scene.remove(p.meshGroup);
        p.markerEl.remove();
        this.pings.splice(i, 1);
        continue;
      }
      const pulse = 0.85 + Math.sin(elapsedSec * 9) * 0.2;
      p.meshGroup.scale.setScalar(pulse);
      p.meshGroup.rotation.y += dt * 2.6;

      this.projVec.copy(p.worldPos).project(camera);
      if (this.projVec.z < 1.0) {
        const sx = (this.projVec.x * 0.5 + 0.5) * viewW;
        const sy = (-this.projVec.y * 0.5 + 0.5) * viewH;
        p.markerEl.style.display = 'block';
        p.markerEl.style.left = `${sx.toFixed(1)}px`;
        p.markerEl.style.top = `${sy.toFixed(1)}px`;
      } else {
        p.markerEl.style.display = 'none';
      }
    }

    // 5. Atualiza HUD de esquadrão/ping periodicamente
    this.hudRefreshAccum += dt;
    if (this.hudRefreshAccum >= 0.6) {
      this.hudRefreshAccum = 0;
      this.renderSquadHud();
    }
  }

  destroy(): void {
    this.client.disconnect();
    for (const id of Array.from(this.allies.keys())) {
      this.removeAlly(id);
    }
    for (const p of this.pings) {
      this.scene.remove(p.meshGroup);
      p.markerEl.remove();
    }
    this.pings.length = 0;
    this.hudRootEl.remove();
    this.worldLabelsLayerEl.remove();
  }

  private bindHudButtons(): void {
    this.hudRootEl
      .querySelector('[data-coop-copy-code]')
      ?.addEventListener('click', (e) => {
        e.stopPropagation();
        void navigator.clipboard?.writeText(this.session.roomCode);
        this.hooks.onNotifyHud(
          `Nº da Sala #${formatRoomCodeDisplay(this.session.roomCode)} copiado!`
        );
      });

    this.hudRootEl
      .querySelector('[data-coop-copy-link]')
      ?.addEventListener('click', (e) => {
        e.stopPropagation();
        const url = `${window.location.origin}${window.location.pathname}?room=${this.session.roomCode}`;
        void navigator.clipboard?.writeText(url);
        this.hooks.onNotifyHud('Link direto de convite copiado!');
      });

    const maskBtn = this.hudRootEl.querySelector(
      '[data-coop-mask]'
    ) as HTMLButtonElement | null;
    maskBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.maskRoomCode = !this.maskRoomCode;
      maskBtn.textContent = this.maskRoomCode ? '[MOSTRAR Nº]' : '[OCULTAR Nº]';
      this.renderSquadHud();
    });

    this.hudRootEl
      .querySelector('[data-coop-leave]')
      ?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.hooks.onLeaveRoomRequested();
      });

    this.chatInputEl.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        e.preventDefault();
        const text = this.chatInputEl.value.trim();
        if (text.length > 0) {
          this.pushRadioFeed(`${this.session.localPlayerName}: ${text}`, false);
          this.client.broadcastWorldEvent({
            kind: 'chat',
            senderId: this.session.localPlayerId,
            senderName: this.session.localPlayerName,
            text,
            ts: Date.now(),
          });
        }
        this.closeRadioChatInput();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.closeRadioChatInput();
      }
    });
  }

  private applyAllyAfkTransition(
    ally: RemoteAllyEntity,
    nextAfk: boolean
  ): void {
    if (ally.afk === nextAfk) return;
    ally.afk = nextAfk;
    const now = performance.now();
    if (now - ally.lastAfkNoticeMs > 10_000) {
      ally.lastAfkNoticeMs = now;
      if (nextAfk) {
        this.pushRadioFeed(
          `⏸ ${ally.name} está AFK (ausente / indisponível).`,
          false
        );
      } else {
        this.pushRadioFeed(`▶ ${ally.name} voltou ao jogo.`, false);
      }
    }
    this.renderSquadHud();
  }

  private handleRemotePose(pkt: NetworkPlayerPosePacket): void {
    let ent = this.allies.get(pkt.id);
    if (!ent) {
      const astronaut = new DoomAstronaut(this.scene, this.sharedUniforms);
      astronaut.setFirstPersonMode(false);

      const beamGroup = this.createAllyFlashlightBeamMesh();
      this.scene.add(beamGroup);

      const labelEl = document.createElement('div');
      labelEl.className = 'oof-ally-label-3d';

      const labelAfkRowEl = document.createElement('div');
      labelAfkRowEl.className = 'oof-ally-label-afk-row';
      labelAfkRowEl.appendChild(createAfkBadgeElement('AFK • AUSENTE'));
      labelAfkRowEl.style.display = 'none';

      const labelTextEl = document.createElement('div');
      labelTextEl.className = 'oof-ally-label-main';
      labelTextEl.textContent = pkt.name;

      labelEl.append(labelAfkRowEl, labelTextEl);
      this.worldLabelsLayerEl.appendChild(labelEl);

      ent = {
        id: pkt.id,
        name: pkt.name,
        astronaut,
        beamGroup,
        labelEl,
        labelAfkRowEl,
        labelTextEl,
        currentPos: new THREE.Vector3(pkt.x, pkt.y, pkt.z),
        targetPos: new THREE.Vector3(pkt.x, pkt.y, pkt.z),
        currentYaw: pkt.yaw,
        targetYaw: pkt.yaw,
        pitch: pkt.pitch,
        speed: pkt.speed,
        bobPhase: pkt.bobPhase,
        crouch: pkt.crouch,
        flashlightOn: pkt.flashlightOn,
        health: pkt.health,
        bleeding: pkt.bleeding,
        ensnared: pkt.ensnared,
        inSequence: pkt.inSequence,
        dead: pkt.dead,
        afk: Boolean(pkt.afk),
        lastAfkNoticeMs: 0,
        lastSeenMs: performance.now(),
      };
      this.allies.set(pkt.id, ent);
      this.pushRadioFeed(`${pkt.name} entrou no setor.`, false);
      this.renderSquadHud();
    }

    ent.name = pkt.name;
    ent.targetPos.set(pkt.x, pkt.y, pkt.z);
    ent.targetYaw = pkt.yaw;
    ent.pitch = pkt.pitch;
    ent.speed = pkt.speed;
    ent.crouch = pkt.crouch;
    ent.flashlightOn = pkt.flashlightOn;
    ent.health = pkt.health;
    ent.bleeding = pkt.bleeding;
    ent.ensnared = pkt.ensnared;
    ent.inSequence = pkt.inSequence;
    ent.dead = pkt.dead;
    ent.lastSeenMs = performance.now();
    this.applyAllyAfkTransition(ent, Boolean(pkt.afk));
  }

  private removeAlly(playerId: string): void {
    const ent = this.allies.get(playerId);
    if (!ent) return;
    ent.astronaut.disposeFromScene(this.scene);
    this.scene.remove(ent.beamGroup);
    ent.labelEl.remove();
    this.allies.delete(playerId);
    this.pushRadioFeed(`${ent.name} desconectou-se da sala.`, false);
    this.renderSquadHud();
  }

  /**
   * Retorna pontos dinâmicos de luz projetados pelas lanternas 3D dos aliados ativos no corredor
   * (iluminação real nas paredes e no piso via shader DOOM, sem cones falsos atravessando paredes!).
   */
  getActiveAllyFlashlightLights(): ReadonlyArray<{
    position: THREE.Vector3;
    intensity: number;
  }> {
    let used = 0;
    const ensureSlot = (idx: number): { position: THREE.Vector3; intensity: number } => {
      while (this.allyDynamicLightsScratch.length <= idx) {
        this.allyDynamicLightsScratch.push({
          position: new THREE.Vector3(),
          intensity: 0,
        });
      }
      return this.allyDynamicLightsScratch[idx];
    };

    for (const ally of this.allies.values()) {
      if (ally.dead || !ally.flashlightOn || ally.ensnared || ally.inSequence) {
        continue;
      }
      if (
        !ally.astronaut.getThirdPersonFlashlightMuzzleWorld(
          this.muzzlePosScratch,
          this.muzzleDirScratch
        )
      ) {
        continue;
      }

      // Raymarch ao longo do facho para parar nas paredes/piso/teto reais do labirinto
      const maxReach = 9.6;
      let hitDist = maxReach;
      for (let d = 0.45; d <= maxReach; d += 0.45) {
        const sx = this.muzzlePosScratch.x + this.muzzleDirScratch.x * d;
        const sy = this.muzzlePosScratch.y + this.muzzleDirScratch.y * d;
        const sz = this.muzzlePosScratch.z + this.muzzleDirScratch.z * d;
        if (sy <= 0.12 || sy >= 3.28) {
          hitDist = d;
          break;
        }
        const cell = worldToGridCell(sx, sz);
        if (isSolidCell(LABYRINTH_MAP, cell.gx, cell.gz)) {
          hitDist = Math.max(0.45, d - 0.35);
          break;
        }
      }

      const midDist = Math.min(hitDist * 0.48, 3.1);
      const midSlot = ensureSlot(used++);
      midSlot.position
        .copy(this.muzzlePosScratch)
        .addScaledVector(this.muzzleDirScratch, midDist);
      midSlot.intensity = 0.48;

      const endDist = Math.max(0.55, hitDist - 0.22);
      const endSlot = ensureSlot(used++);
      endSlot.position
        .copy(this.muzzlePosScratch)
        .addScaledVector(this.muzzleDirScratch, endDist);
      endSlot.intensity = 0.74;

      if (used >= 6) break;
    }

    this.allyDynamicLightsScratch.length = used;
    return this.allyDynamicLightsScratch;
  }

  private createAllyFlashlightBeamMesh(): THREE.Group {
    const grp = new THREE.Group();
    // Halo curto com decaimento suave por cor de vértice até 0.0 (preto em AdditiveBlending),
    // partindo estritamente à frente do bocal da lanterna 3D sólida sem jamais sobrepor o corpo!
    const beamLen = 1.25;
    const coneGeo = new THREE.CylinderGeometry(0.044, 0.3, beamLen, 14, 1, true);
    const posAttr = coneGeo.getAttribute('position');
    const colors = new Float32Array(posAttr.count * 3);
    for (let i = 0; i < posAttr.count; i++) {
      // Antes de rotateX(+PI/2), +Y é o bocal (0.044) e -Y é a extremidade final (0.30)
      const y = posAttr.getY(i);
      const t = Math.max(0, Math.min(1, (y + beamLen * 0.5) / beamLen));
      const fade = t * t;
      colors[i * 3] = 1.0 * fade;
      colors[i * 3 + 1] = 0.93 * fade;
      colors[i * 3 + 2] = 0.72 * fade;
    }
    coneGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    coneGeo.rotateX(Math.PI * 0.5);
    coneGeo.translate(0, 0, -(beamLen * 0.5 + 0.014));

    const coneMat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.052,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    const cone = new THREE.Mesh(coneGeo, coneMat);
    grp.add(cone);
    return grp;
  }

  private handleWorldEvent(ev: NetworkWorldEvent): void {
    if (ev.kind === 'chat') {
      if (ev.senderId !== this.session.localPlayerId) {
        this.sound.menuMove();
        this.pushRadioFeed(`${ev.senderName}: ${ev.text}`, false);
      }
    } else if (ev.kind === 'ping') {
      if (ev.senderId !== this.session.localPlayerId) {
        this.sound.playRadarPing(true);
        this.spawnLocalPingVisual(
          `${ev.senderId}-${ev.ts}`,
          new THREE.Vector3(ev.x, ev.y, ev.z),
          ev.label,
          ev.danger,
          performance.now() * 0.001
        );
      }
    } else if (ev.kind === 'flare') {
      if (ev.senderId !== this.session.localPlayerId) {
        this.hooks.onReceiveFlare(new THREE.Vector3(ev.x, ev.y, ev.z), ev.yaw);
      }
    } else if (ev.kind === 'rescue_ally') {
      if (ev.targetPlayerId === this.session.localPlayerId) {
        this.hooks.onRescuedByAlly(ev.rescuerName);
        this.pushRadioFeed(
          `${ev.rescuerName} cortou a teia e libertou você!`,
          false
        );
      } else {
        this.pushRadioFeed(
          `${ev.rescuerName} libertou um aliado da teia!`,
          false
        );
      }
    } else if (ev.kind === 'sos_alert') {
      if (ev.senderId !== this.session.localPlayerId) {
        this.sound.playRadarPing(true);
        this.pushRadioFeed(
          `⚠ [SOS] ${ev.senderName} caiu numa TEIA em ${ev.sectorName}!`,
          true
        );
        this.spawnLocalPingVisual(
          `sos-${ev.senderId}-${ev.ts}`,
          new THREE.Vector3(ev.x, 1.1, ev.z),
          `🕸️ SOS: ${ev.senderName}`,
          true,
          performance.now() * 0.001
        );
      }
    }
  }

  private spawnLocalPingVisual(
    id: string,
    pos: THREE.Vector3,
    label: string,
    danger: boolean,
    nowSec: number
  ): void {
    const grp = new THREE.Group();
    grp.position.copy(pos);
    const col = danger ? 0xff4d4d : 0x45f5aa;
    const diamond = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.16, 0),
      new THREE.MeshBasicMaterial({
        color: col,
        wireframe: false,
        transparent: true,
        opacity: 0.85,
      })
    );
    grp.add(diamond);
    this.scene.add(grp);

    const markerEl = document.createElement('div');
    markerEl.className = danger
      ? 'oof-ping-marker-3d danger'
      : 'oof-ping-marker-3d';
    markerEl.textContent = label;
    this.worldLabelsLayerEl.appendChild(markerEl);

    this.pings.push({
      id,
      worldPos: pos.clone(),
      meshGroup: grp,
      markerEl,
      expiresAtSec: nowSec + 7.5,
    });
  }

  private pushRadioFeed(text: string, isAlert: boolean): void {
    const msg = document.createElement('div');
    msg.className = isAlert ? 'oof-coop-chat-msg alert' : 'oof-coop-chat-msg';
    msg.textContent = text;
    this.chatFeedEl.appendChild(msg);

    while (this.chatFeedEl.children.length > 5) {
      this.chatFeedEl.firstElementChild?.remove();
    }

    window.setTimeout(() => {
      msg.remove();
    }, 9500);
  }

  private renderSquadHud(): void {
    const codeStr = this.maskRoomCode
      ? '***-***'
      : formatRoomCodeDisplay(this.session.roomCode);
    const visBadge = this.session.isListed ? '' : ' • OCULTA';
    this.roomTagEl.textContent = `SALA #${codeStr}${visBadge}`;
    this.pingEl.textContent = `${this.client.isHost ? 'HOST • ' : ''}${this.client.pingMs}ms`;

    this.squadListEl.innerHTML = '';

    // Linha do jogador local (com ícone AFK caso esteja ausente)
    const selfRow = document.createElement('div');
    selfRow.className = this.localAfk
      ? 'oof-coop-ally-row afk'
      : 'oof-coop-ally-row';
    const selfName = document.createElement('span');
    selfName.className = 'oof-coop-ally-name';
    selfName.textContent = `● ${this.session.localPlayerName} (Você)`;
    const selfStatus = document.createElement('span');
    if (this.localAfk) {
      selfStatus.className = 'oof-coop-ally-hp warn';
      selfStatus.appendChild(createAfkBadgeElement('AFK'));
    } else {
      selfStatus.className = 'oof-coop-ally-hp';
      selfStatus.textContent = this.client.isHost ? 'HOST' : 'ATIVO';
    }
    selfRow.append(selfName, selfStatus);
    this.squadListEl.appendChild(selfRow);

    // Linhas dos aliados conectados
    for (const ally of this.allies.values()) {
      const row = document.createElement('div');
      row.className = ally.afk ? 'oof-coop-ally-row afk' : 'oof-coop-ally-row';
      const nameSpan = document.createElement('span');
      nameSpan.className = 'oof-coop-ally-name';
      nameSpan.textContent = `◆ ${ally.name}`;

      const hpSpan = document.createElement('span');
      if (ally.dead) {
        hpSpan.className = 'oof-coop-ally-hp danger';
        hpSpan.textContent = 'MORTO';
      } else if (ally.ensnared || ally.inSequence) {
        hpSpan.className = 'oof-coop-ally-hp danger';
        hpSpan.textContent = 'NA TEIA!';
      } else if (ally.afk) {
        hpSpan.className = 'oof-coop-ally-hp warn';
        hpSpan.appendChild(createAfkBadgeElement('AFK'));
      } else {
        hpSpan.className =
          ally.health < 35
            ? 'oof-coop-ally-hp danger'
            : ally.health < 70
              ? 'oof-coop-ally-hp warn'
              : 'oof-coop-ally-hp';
        hpSpan.textContent = `${ally.health}%`;
      }

      row.append(nameSpan, hpSpan);
      this.squadListEl.appendChild(row);
    }

    // Mostra também quem está no roster da sala antes do primeiro pacote 3D
    for (const r of this.roster) {
      if (r.id === this.session.localPlayerId || this.allies.has(r.id)) {
        continue;
      }
      const row = document.createElement('div');
      const isRosterAfk = r.status === 'AFK' || r.status === 'HOST_AFK';
      row.className = isRosterAfk
        ? 'oof-coop-ally-row afk'
        : 'oof-coop-ally-row';
      const n = document.createElement('span');
      n.className = 'oof-coop-ally-name';
      n.textContent = `◌ ${r.name}`;
      const st = document.createElement('span');
      if (isRosterAfk) {
        st.className = 'oof-coop-ally-hp warn';
        st.appendChild(createAfkBadgeElement('AFK'));
      } else {
        st.className = 'oof-coop-ally-hp';
        st.textContent = 'CONECTADO';
      }
      row.append(n, st);
      this.squadListEl.appendChild(row);
    }
  }
}

// Re-export CELL_SIZE reference guard
void CELL_SIZE;
