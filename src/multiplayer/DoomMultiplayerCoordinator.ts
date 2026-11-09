import * as THREE from 'three';
import { DoomAstronaut } from '../doom/DoomAstronaut';
import {
  CELL_SIZE,
  isSolidCell,
  isStoneSectorWorld,
  LABYRINTH_MAP,
  worldToGridCell,
} from '../doom/DoomMazeBuilder';
import { getSectorNameForCell, RadarAllyBlip } from '../doom/DoomRadar';
import { DoomSharedUniforms } from '../doom/DoomShader';
import {
  SpiderCinematicMode,
  SpiderPlayerCandidate,
} from '../doom/DoomSpider';
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
  STALE_HEARTBEAT_TTL_MS,
} from './MultiplayerService';
import {
  countLabyrinthWallsBetween,
  MAX_PROXIMITY_VOICE_DISTANCE,
  ProximityVoiceChatManager,
} from './ProximityVoiceChat';

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
  lastFootstepHalfCycle: number;
  crouch: number;
  flashlightOn: boolean;
  flashDir: THREE.Vector3;
  health: number;
  bleeding: boolean;
  ensnared: boolean;
  inSequence: boolean;
  beingDragged: boolean;
  abductionMode: SpiderCinematicMode | null;
  abductionProgress: number;
  abductionSpiderPos: THREE.Vector3;
  abductionCooldownUntilPerfMs: number;
  dead: boolean;
  afk: boolean;
  voiceSpeaking: boolean;
  voiceLevel: number;
  lastAfkNoticeMs: number;
  joinedAtWallMs: number;
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
  onAbductionInterruptedByAlly: (
    rescuerName: string,
    weapon: 'knife' | 'flare'
  ) => void;
  onSpiderInterruptedAndFlees: (threatPos: THREE.Vector3) => void;
  onCaughtByAuthoritativeSpider: (spiderPos: THREE.Vector3) => void;
  onRemoteVictimFinishedAbduction: () => void;
  onRemoteWebTrapSpawned: (x: number, z: number) => void;
  onRemoteWebTrapTriggered: (
    trapPos: THREE.Vector3,
    playerPos: THREE.Vector3
  ) => void;
  onRemoteWebTrapCut: (x: number, z: number) => void;
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
  private readonly voiceChat: ProximityVoiceChatManager;
  private readonly allies = new Map<string, RemoteAllyEntity>();
  private readonly pings: ActiveTacticalPing[] = [];
  private readonly remoteVoicePeersScratch: Array<{
    id: string;
    pos: THREE.Vector3;
    dead: boolean;
  }> = [];

  private latestSpiderPacket: NetworkSpiderPacket | null = null;
  private latestSpiderReceivedPerfMs = -Infinity;
  private readonly observerPositionsScratch: THREE.Vector3[] = [];
  private poseSendAccum = 0;
  private spiderSendAccum = 0;
  private hudRefreshAccum = 0;
  private maskRoomCode = false;
  private chatInputActive = false;
  private wasLocalEnsnared = false;
  private wasLocalDragged = false;
  private localAfk = false;
  private lastCatchBroadcastMs = 0;
  private readonly candidatesScratch: SpiderPlayerCandidate[] = [];

  private readonly hudRootEl: HTMLDivElement;
  private readonly roomTagEl: HTMLSpanElement;
  private readonly pingEl: HTMLSpanElement;
  private readonly voiceModeBtnEl: HTMLButtonElement;
  private readonly voiceMeterFillEl: HTMLDivElement;
  private readonly voiceHintEl: HTMLSpanElement;
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
      <div class="oof-coop-room-Card" data-coop-card>
        <div class="oof-coop-room-row">
          <span class="oof-coop-room-tag" data-coop-room-tag></span>
          <div class="oof-coop-room-row-right">
            <span class="oof-coop-ping" data-coop-ping>ONLINE</span>
            <button type="button" class="oof-coop-collapse-btn" data-coop-collapse title="Recolher/Expandir Painel">[−]</button>
          </div>
        </div>
        <div class="oof-coop-card-body" data-coop-card-body>
          <div class="oof-coop-mini-actions">
            <button type="button" class="oof-coop-mini-btn" data-coop-copy-code title="Copiar Número da Sala">[COPIAR Nº]</button>
            <button type="button" class="oof-coop-mini-btn" data-coop-copy-link title="Copiar Link de Convite Direto">[LINK]</button>
            <button type="button" class="oof-coop-mini-btn" data-coop-mask title="Mostrar/Ocultar código na tela">[OCULTAR Nº]</button>
            <button type="button" class="oof-coop-mini-btn" data-coop-leave title="Desconectar desta sala">[SAIR]</button>
          </div>
          <div class="oof-coop-voice-bar" data-coop-voice-bar>
            <button type="button" class="oof-coop-voice-btn" data-coop-voice-btn title="Alternar modo do Microfone [Z] ou segurar [B] para falar">[🎙 SEGURE B]</button>
            <div class="oof-coop-voice-meter" title="Volume da sua voz (Voz alta atrai a Aranha!)">
              <div class="oof-coop-voice-meter-fill" data-coop-voice-fill></div>
            </div>
            <span class="oof-coop-voice-hint" data-coop-voice-hint>[Z] MODO</span>
          </div>
          <div class="oof-coop-squad-list" data-coop-squad></div>
          <div class="oof-coop-keys-hint">[B] Falar (Voz 3D)  •  [Z] Modo Mic  •  [T] Rádio  •  [V] Ping</div>
        </div>
      </div>
      <div class="oof-coop-chat-feed" data-coop-feed></div>
      <div class="oof-coop-chat-box hidden" data-coop-chat-box>
        <input type="text" class="oof-coop-chat-input" data-coop-chat-input maxlength="90" enterkeyhint="send" placeholder="Mensagem de rádio..." autocomplete="off" />
        <button type="button" class="oof-coop-chat-send-btn" data-coop-chat-send>[ENVIAR]</button>
        <button type="button" class="oof-coop-chat-cancel-btn" data-coop-chat-cancel title="Fechar">[✕]</button>
      </div>
    `;
    this.viewportEl.appendChild(this.hudRootEl);

    this.roomTagEl = this.hudRootEl.querySelector(
      '[data-coop-room-tag]'
    ) as HTMLSpanElement;
    this.pingEl = this.hudRootEl.querySelector(
      '[data-coop-ping]'
    ) as HTMLSpanElement;
    this.voiceModeBtnEl = this.hudRootEl.querySelector(
      '[data-coop-voice-btn]'
    ) as HTMLButtonElement;
    this.voiceMeterFillEl = this.hudRootEl.querySelector(
      '[data-coop-voice-fill]'
    ) as HTMLDivElement;
    this.voiceHintEl = this.hudRootEl.querySelector(
      '[data-coop-voice-hint]'
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
        this.latestSpiderReceivedPerfMs = performance.now();
      },
      onWorldEvent: (ev) => this.handleWorldEvent(ev),
      onVoiceSignal: (sig) => {
        void this.voiceChat.handleIncomingSignal(sig);
      },
      onVoiceRelayChunk: (chunk) => {
        this.voiceChat.handleIncomingRelayChunk(chunk);
      },
      onRosterUpdated: (players) => {
        this.roster = players;
        const activeIds = new Set(players.map((p) => p.id));
        const nowWall = Date.now();
        // Remove imediatamente qualquer aliado que saiu da sala e não consta mais no roster do servidor!
        for (const [allyId, ally] of Array.from(this.allies.entries())) {
          if (!activeIds.has(allyId) && nowWall - ally.joinedAtWallMs > 3500) {
            this.removeAlly(allyId);
          }
        }
        for (const r of players) {
          if (r.id !== this.session.localPlayerId) {
            this.voiceChat.ensurePeer(r.id);
          }
          const ally = this.allies.get(r.id);
          if (ally && (r.status === 'AFK' || r.status === 'HOST_AFK')) {
            this.applyAllyAfkTransition(ally, true);
          }
        }
        this.renderSquadHud();
      },
    });

    this.voiceChat = new ProximityVoiceChatManager({
      localPlayerId: session.localPlayerId,
      sendSignal: (sig) => this.client.sendVoiceSignal(sig),
      sendRelayChunk: (chunk) => this.client.sendVoiceRelayChunk(chunk),
      onStatusChanged: () => {
        this.refreshVoiceHudBar();
        this.renderSquadHud();
      },
    });

    for (const r of this.roster) {
      if (r.id !== session.localPlayerId) {
        this.voiceChat.ensurePeer(r.id);
      }
    }

    this.client.connect();
    this.refreshVoiceHudBar();
    this.renderSquadHud();
    this.pushRadioFeed(
      `Conectado à sala #${formatRoomCodeDisplay(session.roomCode)} (${session.roomName}).`,
      false
    );
  }

  get isHost(): boolean {
    return this.client.isHost;
  }

  get localPlayerId(): string {
    return this.session.localPlayerId;
  }

  get isChatTyping(): boolean {
    return this.chatInputActive;
  }

  get localVoiceLevel(): number {
    return this.voiceChat.voiceLevel;
  }

  get localVoiceSpeaking(): boolean {
    return this.voiceChat.isSpeaking;
  }

  setPushToTalkHeld(held: boolean): void {
    const prev = this.voiceChat.isPushToTalkHeld;
    this.voiceChat.setPushToTalkHeld(held);
    if (prev !== this.voiceChat.isPushToTalkHeld) {
      this.sound.playRadioSquelch?.(held);
    }
  }

  cycleVoiceMode(): void {
    const next = this.voiceChat.cycleVoiceMode();
    this.sound.menuMove();
    if (next === 'OPEN') {
      this.pushRadioFeed(
        '🎙 Microfone ABERTO (por distância — cuidado: voz alta atrai a Aranha!).',
        false
      );
    } else if (next === 'MUTED') {
      this.pushRadioFeed('🔇 Microfone MUTADO (segure [B] se quiser falar).', false);
    } else {
      this.pushRadioFeed('🎙 Modo Push-to-Talk: segure [B] para falar.', false);
    }
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
    if (this.sound.playTacticalPingSound) {
      this.sound.playTacticalPingSound(nearSpider, 0);
    } else {
      this.sound.playRadarPing(true);
    }

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

  notifyFlareSpawned(
    pos: THREE.Vector3,
    yaw: number,
    spiderPos: THREE.Vector3
  ): void {
    this.client.broadcastWorldEvent({
      kind: 'flare',
      senderId: this.session.localPlayerId,
      senderName: this.session.localPlayerName,
      x: pos.x,
      y: pos.y,
      z: pos.z,
      yaw,
      ts: Date.now(),
    });
    // Se um aliado estiver sendo atacado/arrastado pela Aranha perto do sinalizador, salva-o na hora!
    this.tryInterruptSpiderAbduction(pos, spiderPos, 'flare');
  }

  notifyWebTrapSpawned(x: number, z: number): void {
    if (!this.client.isHost) return;
    this.client.broadcastWorldEvent({
      kind: 'web_trap_spawned',
      x,
      z,
      ts: Date.now(),
    });
  }

  notifyWebTrapTriggered(
    trapX: number,
    trapZ: number,
    playerPos: THREE.Vector3
  ): void {
    this.client.broadcastWorldEvent({
      kind: 'web_trap_triggered',
      senderId: this.session.localPlayerId,
      senderName: this.session.localPlayerName,
      x: trapX,
      z: trapZ,
      playerX: playerPos.x,
      playerZ: playerPos.z,
      ts: Date.now(),
    });
  }

  notifyWebTrapCut(x: number, z: number): void {
    this.client.broadcastWorldEvent({
      kind: 'web_trap_cut',
      senderId: this.session.localPlayerId,
      x,
      z,
      ts: Date.now(),
    });
  }

  notifyAuthoritativeSpiderCaughtAlly(
    targetPlayerId: string,
    spiderPos: THREE.Vector3
  ): void {
    const now = performance.now();
    if (now - this.lastCatchBroadcastMs < 1400) return;
    this.lastCatchBroadcastMs = now;
    this.client.broadcastWorldEvent({
      kind: 'spider_catch_player',
      targetPlayerId,
      spiderX: spiderPos.x,
      spiderY: spiderPos.y,
      spiderZ: spiderPos.z,
      ts: Date.now(),
    });
  }

  notifyLocalAbductionFinished(): void {
    this.client.broadcastWorldEvent({
      kind: 'abduction_finished',
      victimId: this.session.localPlayerId,
      ts: Date.now(),
    });
  }

  /**
   * Interrompe o ataque/arrasto da Aranha usando Sinalizador ou Faca, salvando o amigo antes do ninho!
   */
  tryInterruptSpiderAbduction(
    localPos: THREE.Vector3,
    spiderPos: THREE.Vector3,
    weapon: 'knife' | 'flare'
  ): boolean {
    const maxDist = weapon === 'flare' ? 5.6 : 3.85;
    for (const ally of this.allies.values()) {
      if (ally.dead || (!ally.inSequence && !ally.beingDragged)) continue;
      const distToAlly = Math.hypot(
        ally.currentPos.x - localPos.x,
        ally.currentPos.z - localPos.z
      );
      const distToSpider = Math.hypot(
        spiderPos.x - localPos.x,
        spiderPos.z - localPos.z
      );
      const distToAbductionSpider = ally.abductionMode
        ? Math.hypot(
            ally.abductionSpiderPos.x - localPos.x,
            ally.abductionSpiderPos.z - localPos.z
          )
        : Infinity;

      if (
        Math.min(distToAlly, distToSpider, distToAbductionSpider) <= maxDist
      ) {
        ally.inSequence = false;
        ally.beingDragged = false;
        ally.abductionMode = null;
        ally.abductionCooldownUntilPerfMs = performance.now() + 2600;
        this.hooks.onSpiderInterruptedAndFlees(localPos);
        this.client.broadcastWorldEvent({
          kind: 'interrupt_abduction',
          rescuerId: this.session.localPlayerId,
          rescuerName: this.session.localPlayerName,
          targetPlayerId: ally.id,
          weapon,
          x: localPos.x,
          z: localPos.z,
          ts: Date.now(),
        });
        this.pushRadioFeed(
          weapon === 'flare'
            ? `🔥 Seu sinalizador cegou a Aranha e SALVOU ${ally.name}!`
            : `🗡️ Você golpeou a Aranha e SALVOU ${ally.name} do arrasto!`,
          false
        );
        this.renderSquadHud();
        return true;
      }
    }
    return false;
  }

  /**
   * Permite que um aliado salve outro jogador sendo arrastado pela Aranha OU preso em teia/ninho
   * ao chegar perto e usar Faca [1] ou Interagir [E]!
   */
  tryRescueNearbyTrappedAlly(
    localPos: THREE.Vector3,
    spiderPos?: THREE.Vector3,
    hasKnife = false
  ): boolean {
    if (
      spiderPos &&
      hasKnife &&
      this.tryInterruptSpiderAbduction(localPos, spiderPos, 'knife')
    ) {
      return true;
    }

    for (const ally of this.allies.values()) {
      if (!ally.ensnared || ally.dead) continue;
      const d = Math.hypot(
        ally.currentPos.x - localPos.x,
        ally.currentPos.z - localPos.z
      );
      if (d <= 3.1) {
        ally.ensnared = false;
        if (
          spiderPos &&
          Math.hypot(spiderPos.x - localPos.x, spiderPos.z - localPos.z) <= 4.2
        ) {
          this.hooks.onSpiderInterruptedAndFlees(localPos);
        }
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
        this.renderSquadHud();
        return true;
      }
    }
    return false;
  }

  hasTrappedAllyInRescueRange(
    localPos: THREE.Vector3,
    spiderPos?: THREE.Vector3,
    hasKnife = false
  ): boolean {
    const abd = this.getActiveRemoteAbduction();
    if (
      abd &&
      hasKnife &&
      spiderPos &&
      (Math.hypot(spiderPos.x - localPos.x, spiderPos.z - localPos.z) <= 3.6 ||
        Math.hypot(
          abd.victimPos.x - localPos.x,
          abd.victimPos.z - localPos.z
        ) <= 3.6)
    ) {
      return true;
    }
    for (const ally of this.allies.values()) {
      if (!ally.ensnared || ally.dead) continue;
      if (
        Math.hypot(
          ally.currentPos.x - localPos.x,
          ally.currentPos.z - localPos.z
        ) <= 3.1
      ) {
        return true;
      }
    }
    return false;
  }

  /**
   * Retorna dados de abdução ativa caso algum aliado esteja sendo atacado/arrastado/tecido pela Aranha,
   * permitindo que o Host e todos os observadores vejam a cena 3D sincronizada em tempo real!
   */
  getActiveRemoteAbduction(): {
    allyId: string;
    allyName: string;
    mode: SpiderCinematicMode;
    progress: number;
    spiderPos: THREE.Vector3;
    victimPos: THREE.Vector3;
  } | null {
    for (const ally of this.allies.values()) {
      if (!ally.dead && ally.inSequence && ally.abductionMode) {
        return {
          allyId: ally.id,
          allyName: ally.name,
          mode: ally.abductionMode,
          progress: ally.abductionProgress,
          spiderPos: ally.abductionSpiderPos,
          victimPos: ally.currentPos,
        };
      }
    }
    return null;
  }

  /**
   * Constrói a lista completa de operadores candidatos (Host + todos os aliados vivos)
   * com direção real de lanterna, corrida, agachamento e estado de teia para a IA da Aranha!
   */
  buildSpiderPlayerCandidates(local: {
    pos: THREE.Vector3;
    yaw: number;
    sprinting: boolean;
    crouching: boolean;
    flashlightOn: boolean;
    flashlightDir: THREE.Vector3;
    voiceLevel?: number;
    ensnared: boolean;
    afk: boolean;
  }): readonly SpiderPlayerCandidate[] {
    this.candidatesScratch.length = 0;
    this.candidatesScratch.push({
      id: this.session.localPlayerId,
      pos: local.pos,
      yaw: local.yaw,
      sprinting: local.sprinting,
      crouching: local.crouching,
      flashlightOn: local.flashlightOn,
      flashlightDir: local.flashlightDir,
      voiceLevel: local.voiceLevel ?? this.voiceChat.voiceLevel,
      ensnared: local.ensnared,
      afk: local.afk,
      isLocal: true,
    });

    for (const ally of this.allies.values()) {
      if (ally.dead || ally.inSequence) continue;
      this.candidatesScratch.push({
        id: ally.id,
        pos: ally.currentPos,
        yaw: ally.currentYaw,
        sprinting: !ally.afk && ally.speed > 7.0,
        crouching: ally.crouch > 0.5,
        flashlightOn: ally.flashlightOn,
        flashlightDir: ally.flashDir,
        voiceLevel: ally.voiceSpeaking ? ally.voiceLevel : 0,
        ensnared: ally.ensnared,
        afk: ally.afk,
        isLocal: false,
      });
    }

    return this.candidatesScratch;
  }

  consumeLatestRemoteSpiderPacket(): NetworkSpiderPacket | null {
    return this.latestSpiderPacket;
  }

  /**
   * Retorna o pacote remoto da Aranha validado exclusivamente pelo relógio monotônico local
   * (`performance.now()`), imune a diferenças de relógio (`Date.now()`) entre máquinas!
   */
  getFreshRemoteSpiderPacket(maxAgeMs = 3500): NetworkSpiderPacket | null {
    if (!this.latestSpiderPacket) return null;
    if (performance.now() - this.latestSpiderReceivedPerfMs > maxAgeMs) {
      return null;
    }
    return this.latestSpiderPacket;
  }

  /**
   * Lista as posições de todos os operadores vivos que poderiam ver a Aranha no mundo 3D
   * (usado para impedir teletransporte visível após abdução de um aliado!).
   */
  getObserverWorldPositions(
    localPos: THREE.Vector3,
    excludePlayerId?: string
  ): readonly THREE.Vector3[] {
    this.observerPositionsScratch.length = 0;
    if (this.session.localPlayerId !== excludePlayerId) {
      this.observerPositionsScratch.push(localPos);
    }
    for (const ally of this.allies.values()) {
      if (ally.dead || ally.id === excludePlayerId) continue;
      this.observerPositionsScratch.push(ally.currentPos);
    }
    return this.observerPositionsScratch;
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
      beingDragged?: boolean;
      abductionMode?: SpiderCinematicMode | null;
      abductionProgress?: number;
      abductionSpiderPos?: THREE.Vector3 | null;
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
      cinematicMode?: SpiderCinematicMode | null;
      cinematicProgress?: number;
      victimId?: string | null;
      victimX?: number;
      victimY?: number;
      victimZ?: number;
    },
    hideHud: boolean
  ): void {
    this.hudRootEl.style.display = hideHud ? 'none' : 'flex';
    this.worldLabelsLayerEl.style.display = hideHud ? 'none' : 'block';

    // Alerta SOS automático quando o jogador local cai numa armadilha de teia ou começa a ser arrastado!
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

    const nowDragged = Boolean(localState.beingDragged);
    if (nowDragged && !this.wasLocalDragged) {
      const { gx, gz } = worldToGridCell(localState.pos.x, localState.pos.z);
      const sector = getSectorNameForCell(gx, gz);
      this.client.broadcastWorldEvent({
        kind: 'sos_alert',
        senderId: this.session.localPlayerId,
        senderName: this.session.localPlayerName,
        sectorName: `${sector} (SENDO ARRASTADO PELA ARANHA!)`,
        x: localState.pos.x,
        z: localState.pos.z,
        ts: Date.now(),
      });
    }
    this.wasLocalDragged = nowDragged;

    const nextLocalAfk = Boolean(localState.afk);
    if (this.localAfk !== nextLocalAfk) {
      this.localAfk = nextLocalAfk;
      this.client.setLocalAfk(nextLocalAfk);
      this.renderSquadHud();
    }

    // Silencia o microfone caso o jogador tenha morrido permanentemente!
    this.voiceChat.setForceSilenced(localState.dead);

    // Atualiza espacialização 3D HRTF + abafamento por paredes das vozes dos amigos
    this.remoteVoicePeersScratch.length = 0;
    for (const ally of this.allies.values()) {
      this.remoteVoicePeersScratch.push({
        id: ally.id,
        pos: ally.currentPos,
        dead: ally.dead,
      });
    }
    this.voiceChat.update(
      dt,
      camera.position,
      localState.yaw,
      localState.pitch,
      this.remoteVoicePeersScratch
    );
    this.refreshVoiceHudBar();

    // 1. Transmite pose 3D do jogador local (~16 Hz quando ativo; inclui estado AFK, arrasto e voz!)
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
        beingDragged: nowDragged,
        abductionMode: localState.abductionMode ?? null,
        abductionProgress: localState.abductionProgress ?? 0,
        abductionSpiderX: localState.abductionSpiderPos?.x,
        abductionSpiderY: localState.abductionSpiderPos?.y,
        abductionSpiderZ: localState.abductionSpiderPos?.z,
        voiceSpeaking: this.voiceChat.isSpeaking,
        voiceLevel: Number(this.voiceChat.voiceLevel.toFixed(3)),
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

    for (const ally of Array.from(this.allies.values())) {
      // Se o jogador saiu/fechou o jogo e parou totalmente de emitir pacotes e heartbeats (> 43s),
      // remove-o da partida. (Jogadores apenas AFK com a aba aberta continuam emitindo pulso a cada ~2.5s!)
      if (nowMs - ally.lastSeenMs >= STALE_HEARTBEAT_TTL_MS + 3000) {
        this.removeAlly(ally.id);
        continue;
      }

      // Caso fique parado/ausente (>= AFK_IDLE_TIMEOUT_MS), sinaliza AFK mantendo-o na partida.
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
      const isBeingDragged = Boolean(ally.beingDragged || (ally.inSequence && ally.abductionMode === 'DRAGGING_TO_WEB'));
      if (effectiveSpeed > 0.25 || isBeingDragged || ally.inSequence) {
        const prevBob = ally.bobPhase;
        ally.bobPhase += dt * (6.8 + effectiveSpeed * 0.75);
        const halfCycle = Math.floor(ally.bobPhase / Math.PI);
        if (
          !ally.dead &&
          !isBeingDragged &&
          !ally.inSequence &&
          !ally.ensnared &&
          effectiveSpeed > 0.35 &&
          halfCycle !== ally.lastFootstepHalfCycle &&
          Math.floor(prevBob / Math.PI) !== halfCycle
        ) {
          ally.lastFootstepHalfCycle = halfCycle;
          const dx = ally.currentPos.x - localState.pos.x;
          const dz = ally.currentPos.z - localState.pos.z;
          const dist = Math.hypot(dx, dz);
          if (dist < 21.0) {
            const rightX = Math.cos(localState.yaw);
            const rightZ = -Math.sin(localState.yaw);
            const pan =
              dist > 0.05
                ? Math.max(-0.92, Math.min(0.92, (dx * rightX + dz * rightZ) / dist))
                : 0;
            const walls = countLabyrinthWallsBetween(
              ally.currentPos.x,
              ally.currentPos.z,
              localState.pos.x,
              localState.pos.z
            );
            const surface = isStoneSectorWorld(ally.currentPos.x, ally.currentPos.z)
              ? 'stone'
              : 'tech';
            this.sound.playRemoteAllyFootstep?.(
              pan,
              dist,
              walls,
              halfCycle % 2 === 0,
              surface,
              effectiveSpeed > 7.2,
              ally.crouch > 0.5
            );
          }
        }
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
        ally.afk,
        isBeingDragged
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

      // Projeção na tela da etiqueta acima do capacete do aliado (com ícone de AFK ou alerta de ARRASTO/TEIA!)
      const headHeight = isBeingDragged
        ? 0.95
        : ally.ensnared || ally.inSequence
          ? 1.45
          : 1.94 - ally.crouch * 0.42;
      this.projVec.set(
        ally.currentPos.x,
        ally.currentPos.y + headHeight,
        ally.currentPos.z
      );
      const dist = this.projVec.distanceTo(camera.position);
      this.projVec.project(camera);

      if (this.projVec.z < 1.0 && dist < 38) {
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
        ally.labelAfkRowEl.style.display =
          ally.afk && !ally.ensnared && !ally.inSequence
            ? 'inline-flex'
            : 'none';

        const allyAudibleSpeak =
          ally.voiceSpeaking && dist <= MAX_PROXIMITY_VOICE_DISTANCE;
        ally.labelEl.classList.toggle('speaking', allyAudibleSpeak);
        const micTag = allyAudibleSpeak ? '🔊 ' : '';

        if (isBeingDragged) {
          ally.labelTextEl.textContent = `${micTag}🕷️ ${ally.name} — SENDO ARRASTADO! [SINALIZADOR / FACA]`;
        } else if (ally.inSequence) {
          ally.labelTextEl.textContent = `${micTag}🕷️ ${ally.name} — NAS GARRAS DA ARANHA! [SINALIZADOR / FACA]`;
        } else if (ally.ensnared) {
          ally.labelTextEl.textContent = `${micTag}🕸️ ${ally.name} — PRESO NA TEIA! [E / FACA]`;
        } else if (ally.afk) {
          ally.labelTextEl.textContent = `${micTag}${ally.name} • INDÍSP.`;
        } else {
          ally.labelTextEl.textContent = `${micTag}${ally.name} • ${ally.health}%`;
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
    this.voiceChat.destroy();
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

    this.voiceModeBtnEl.addEventListener('click', (e) => {
      e.stopPropagation();
      this.cycleVoiceMode();
    });

    const collapseBtn = this.hudRootEl.querySelector(
      '[data-coop-collapse]'
    ) as HTMLButtonElement | null;
    const cardEl = this.hudRootEl.querySelector(
      '[data-coop-card]'
    ) as HTMLDivElement | null;
    collapseBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!cardEl) return;
      const collapsed = cardEl.classList.toggle('collapsed');
      collapseBtn.textContent = collapsed ? '[+]' : '[−]';
    });

    const submitCurrentChat = () => {
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
    };

    this.hudRootEl
      .querySelector('[data-coop-chat-send]')
      ?.addEventListener('click', (e) => {
        e.stopPropagation();
        submitCurrentChat();
      });

    this.hudRootEl
      .querySelector('[data-coop-chat-cancel]')
      ?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.closeRadioChatInput();
      });

    this.chatInputEl.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        e.preventDefault();
        submitCurrentChat();
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
        lastFootstepHalfCycle: Math.floor(pkt.bobPhase / Math.PI),
        crouch: pkt.crouch,
        flashlightOn: pkt.flashlightOn,
        flashDir: new THREE.Vector3(
          pkt.flashDirX || 0,
          pkt.flashDirY || 0,
          pkt.flashDirZ || -1
        ).normalize(),
        health: pkt.health,
        bleeding: pkt.bleeding,
        ensnared: pkt.ensnared,
        inSequence: pkt.inSequence,
        beingDragged: Boolean(pkt.beingDragged),
        abductionMode: pkt.abductionMode ?? null,
        abductionProgress: pkt.abductionProgress ?? 0,
        abductionSpiderPos: new THREE.Vector3(
          pkt.abductionSpiderX ?? pkt.x,
          pkt.abductionSpiderY ?? 1.38,
          pkt.abductionSpiderZ ?? pkt.z
        ),
        abductionCooldownUntilPerfMs: 0,
        dead: pkt.dead,
        afk: Boolean(pkt.afk),
        voiceSpeaking: Boolean(pkt.voiceSpeaking),
        voiceLevel: pkt.voiceLevel ?? 0,
        lastAfkNoticeMs: 0,
        joinedAtWallMs: Date.now(),
        lastSeenMs: performance.now(),
      };
      this.allies.set(pkt.id, ent);
      this.voiceChat.ensurePeer(pkt.id);
      this.pushRadioFeed(`${pkt.name} entrou no setor.`, false);
      this.renderSquadHud();
    }

    ent.name = pkt.name;
    ent.targetPos.set(pkt.x, pkt.y, pkt.z);
    if (pkt.beingDragged || pkt.inSequence) {
      // Durante arrasto/bote segue a posição exata sem atraso para alinhar com as garras da Aranha!
      ent.currentPos.set(pkt.x, pkt.y, pkt.z);
    }
    ent.targetYaw = pkt.yaw;
    ent.pitch = pkt.pitch;
    ent.speed = pkt.speed;
    ent.crouch = pkt.crouch;
    ent.flashlightOn = pkt.flashlightOn;
    ent.flashDir
      .set(pkt.flashDirX || 0, pkt.flashDirY || 0, pkt.flashDirZ || -1)
      .normalize();
    ent.health = pkt.health;
    ent.bleeding = pkt.bleeding;
    ent.ensnared = pkt.ensnared;
    const nowPerf = performance.now();
    if (nowPerf < ent.abductionCooldownUntilPerfMs) {
      // Ignora pacotes de pose atrasados em trânsito logo após o término/interrupção da abdução!
      ent.inSequence = false;
      ent.beingDragged = false;
      ent.abductionMode = null;
      ent.abductionProgress = 0;
    } else {
      ent.inSequence = pkt.inSequence;
      ent.beingDragged = Boolean(pkt.beingDragged);
      ent.abductionMode = pkt.abductionMode ?? null;
      ent.abductionProgress = pkt.abductionProgress ?? 0;
    }
    if (
      typeof pkt.abductionSpiderX === 'number' &&
      typeof pkt.abductionSpiderY === 'number' &&
      typeof pkt.abductionSpiderZ === 'number'
    ) {
      ent.abductionSpiderPos.set(
        pkt.abductionSpiderX,
        pkt.abductionSpiderY,
        pkt.abductionSpiderZ
      );
    }
    ent.dead = pkt.dead;
    ent.voiceSpeaking = Boolean(pkt.voiceSpeaking);
    ent.voiceLevel = pkt.voiceLevel ?? 0;
    ent.lastSeenMs = performance.now();
    this.applyAllyAfkTransition(ent, Boolean(pkt.afk));
  }

  private removeAlly(playerId: string): void {
    this.voiceChat.removePeer(playerId);
    const hadInRoster = this.roster.some((r) => r.id === playerId);
    const rosterEntry = this.roster.find((r) => r.id === playerId);
    this.roster = this.roster.filter((r) => r.id !== playerId);

    const ent = this.allies.get(playerId);
    if (ent) {
      ent.astronaut.disposeFromScene(this.scene);
      this.scene.remove(ent.beamGroup);
      ent.labelEl.remove();
      this.allies.delete(playerId);
      this.pushRadioFeed(`${ent.name} desconectou-se da sala.`, false);
      this.renderSquadHud();
      return;
    }

    if (hadInRoster) {
      if (rosterEntry) {
        this.pushRadioFeed(`${rosterEntry.name} desconectou-se da sala.`, false);
      }
      this.renderSquadHud();
    }
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
        if (this.sound.playRadioSquelch) {
          this.sound.playRadioSquelch(true);
        } else {
          this.sound.menuMove();
        }
        this.pushRadioFeed(`${ev.senderName}: ${ev.text}`, false);
      }
    } else if (ev.kind === 'ping') {
      if (ev.senderId !== this.session.localPlayerId) {
        if (this.sound.playTacticalPingSound) {
          this.sound.playTacticalPingSound(ev.danger, 0);
        } else {
          this.sound.playRadarPing(true);
        }
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
        const flarePos = new THREE.Vector3(ev.x, ev.y, ev.z);
        this.hooks.onReceiveFlare(flarePos, ev.yaw);
      }
    } else if (ev.kind === 'rescue_ally') {
      const targetAlly = this.allies.get(ev.targetPlayerId);
      if (targetAlly) {
        targetAlly.ensnared = false;
      }
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
      this.renderSquadHud();
    } else if (ev.kind === 'interrupt_abduction') {
      const threatPos = new THREE.Vector3(ev.x, 0, ev.z);
      const savedAlly = this.allies.get(ev.targetPlayerId);
      if (savedAlly) {
        savedAlly.inSequence = false;
        savedAlly.beingDragged = false;
        savedAlly.abductionMode = null;
        savedAlly.abductionCooldownUntilPerfMs = performance.now() + 2600;
      }
      this.hooks.onSpiderInterruptedAndFlees(threatPos);
      if (ev.targetPlayerId === this.session.localPlayerId) {
        this.hooks.onAbductionInterruptedByAlly(ev.rescuerName, ev.weapon);
        this.pushRadioFeed(
          ev.weapon === 'flare'
            ? `🔥 O sinalizador de ${ev.rescuerName} cegou a Aranha e SALVOU você!`
            : `🗡️ ${ev.rescuerName} golpeou a Aranha e SALVOU você do arrasto!`,
          false
        );
      } else if (ev.rescuerId !== this.session.localPlayerId) {
        const victimLabel = savedAlly ? savedAlly.name : 'um aliado';
        this.pushRadioFeed(
          ev.weapon === 'flare'
            ? `🔥 ${ev.rescuerName} salvou ${victimLabel} com um sinalizador!`
            : `🗡️ ${ev.rescuerName} salvou ${victimLabel} das garras da Aranha!`,
          false
        );
      }
      this.renderSquadHud();
    } else if (ev.kind === 'spider_catch_player') {
      if (ev.targetPlayerId === this.session.localPlayerId) {
        this.hooks.onCaughtByAuthoritativeSpider(
          new THREE.Vector3(ev.spiderX, ev.spiderY, ev.spiderZ)
        );
      }
    } else if (ev.kind === 'abduction_finished') {
      if (ev.victimId !== this.session.localPlayerId) {
        const ally = this.allies.get(ev.victimId);
        if (ally) {
          ally.inSequence = false;
          ally.beingDragged = false;
          ally.abductionMode = null;
          ally.abductionCooldownUntilPerfMs = performance.now() + 2600;
        }
        if (this.client.isHost) {
          this.hooks.onRemoteVictimFinishedAbduction();
        }
      }
    } else if (ev.kind === 'web_trap_spawned') {
      if (!this.client.isHost) {
        this.hooks.onRemoteWebTrapSpawned(ev.x, ev.z);
      }
    } else if (ev.kind === 'web_trap_triggered') {
      if (ev.senderId !== this.session.localPlayerId) {
        this.hooks.onRemoteWebTrapTriggered(
          new THREE.Vector3(ev.x, 0, ev.z),
          new THREE.Vector3(ev.playerX, 0, ev.playerZ)
        );
      }
    } else if (ev.kind === 'web_trap_cut') {
      if (ev.senderId !== this.session.localPlayerId) {
        this.hooks.onRemoteWebTrapCut(ev.x, ev.z);
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

  private refreshVoiceHudBar(): void {
    const mode = this.voiceChat.activationMode;
    const armed = this.voiceChat.isMicArmed;
    const speaking = this.voiceChat.isSpeaking;
    const lvl = this.voiceChat.voiceLevel;
    const perm = this.voiceChat.micPermission;

    this.voiceModeBtnEl.classList.toggle('armed', armed);
    this.voiceModeBtnEl.classList.toggle('speaking', speaking);
    this.voiceModeBtnEl.classList.toggle(
      'muted',
      mode === 'MUTED' && !this.voiceChat.isPushToTalkHeld
    );

    if (perm === 'denied') {
      this.voiceModeBtnEl.textContent = '[🔇 MIC BLOQUEADO]';
      this.voiceHintEl.textContent = 'LIBERE NO NAVEGADOR';
      this.voiceHintEl.classList.add('warn');
    } else if (perm === 'unavailable') {
      this.voiceModeBtnEl.textContent = '[🔇 SEM MIC]';
      this.voiceHintEl.textContent = 'INDISPONÍVEL';
      this.voiceHintEl.classList.add('warn');
    } else if (this.voiceChat.isPushToTalkHeld) {
      this.voiceModeBtnEl.textContent = '[🎙 FALANDO (B)]';
      this.voiceHintEl.textContent =
        lvl >= 0.62 ? '⚠ ALTO (ARANHA OUVE!)' : 'TRANSMITINDO';
      this.voiceHintEl.classList.toggle('warn', lvl >= 0.62);
    } else if (mode === 'OPEN') {
      this.voiceModeBtnEl.textContent = speaking
        ? '[🎙 VOZ ATIVA]'
        : '[🎙 MIC ABERTO]';
      this.voiceHintEl.textContent =
        lvl >= 0.62 ? '⚠ ALTO (ARANHA OUVE!)' : '[Z] P/ MUTAR';
      this.voiceHintEl.classList.toggle('warn', lvl >= 0.62);
    } else if (mode === 'MUTED') {
      this.voiceModeBtnEl.textContent = '[🔇 MUTADO]';
      this.voiceHintEl.textContent = '[B] FALAR • [Z] MODO';
      this.voiceHintEl.classList.remove('warn');
    } else {
      this.voiceModeBtnEl.textContent = '[🎙 SEGURE B]';
      this.voiceHintEl.textContent = '[Z] MIC ABERTO';
      this.voiceHintEl.classList.remove('warn');
    }

    const pct = Math.round(Math.min(100, lvl * 100));
    this.voiceMeterFillEl.style.width = `${pct}%`;
    this.voiceMeterFillEl.classList.toggle('loud', lvl >= 0.62);
    this.voiceMeterFillEl.classList.toggle('mid', lvl >= 0.3 && lvl < 0.62);
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
    const selfSpeakPrefix = this.voiceChat.isSpeaking ? '🔊 ' : '● ';
    selfName.textContent = `${selfSpeakPrefix}${this.session.localPlayerName} (Você)`;
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
      const allySpeakPrefix = ally.voiceSpeaking ? '🔊 ' : '◆ ';
      nameSpan.textContent = `${allySpeakPrefix}${ally.name}`;

      const hpSpan = document.createElement('span');
      if (ally.dead) {
        hpSpan.className = 'oof-coop-ally-hp danger';
        hpSpan.textContent = 'MORTO';
      } else if (ally.beingDragged || (ally.inSequence && ally.abductionMode === 'DRAGGING_TO_WEB')) {
        hpSpan.className = 'oof-coop-ally-hp danger';
        hpSpan.textContent = 'ARRASTADO!';
      } else if (ally.inSequence) {
        hpSpan.className = 'oof-coop-ally-hp danger';
        hpSpan.textContent = 'ATACADO!';
      } else if (ally.ensnared) {
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
