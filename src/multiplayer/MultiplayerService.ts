import { createClient, RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';

const DEFAULT_SUPABASE_URL = 'https://iypkhqitttifnespoimu.supabase.co';
const DEFAULT_SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml5cGtocWl0dHRpZm5lc3BvaW11Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQxNjIxOTksImV4cCI6MjEwOTczODE5OX0.K8dz2T-oeTPguwFT7X6YVO_rOa78_G528ukq8mD8FBI';

const PLAYER_NAME_STORAGE_KEY = 'oof_mp_player_name_v1';
const PLAYER_SESSION_ID_KEY = 'oof_mp_session_player_id_v1';
const LOCAL_ROOMS_STORAGE_KEY = 'oof_mp_local_rooms_v1';
const ACTIVE_SESSIONS_LEDGER_KEY = 'oof_mp_active_sessions_v1';

export interface RoomPlayerSummary {
  id: string;
  name: string;
  status: string;
}

export interface PublicRoomEntry {
  roomCode: string;
  roomName: string;
  hostName: string;
  hasPassword: boolean;
  maxPlayers: number;
  playerCount: number;
  playersSummary: RoomPlayerSummary[];
  status: string;
  region: string;
  updatedAt: string;
}

export interface RoomInspectionResult {
  found: boolean;
  errorCode?: 'NOT_FOUND';
  roomCode?: string;
  roomName?: string;
  hostName?: string;
  isListed?: boolean;
  hasPassword?: boolean;
  maxPlayers?: number;
  playerCount?: number;
  isFull?: boolean;
  status?: string;
  playersSummary?: RoomPlayerSummary[];
}

export interface ActiveRoomSession {
  roomCode: string;
  roomName: string;
  hostId: string;
  hostName: string;
  isListed: boolean;
  hasPassword: boolean;
  maxPlayers: number;
  playerCount: number;
  playersSummary: RoomPlayerSummary[];
  accessToken: string;
  localPlayerId: string;
  localPlayerName: string;
}

export type JoinRoomErrorCode =
  | 'NOT_FOUND'
  | 'PASSWORD_REQUIRED'
  | 'WRONG_PASSWORD'
  | 'ROOM_FULL'
  | 'NETWORK_ERROR';

export interface JoinRoomResult {
  ok: boolean;
  errorCode?: JoinRoomErrorCode;
  roomName?: string;
  hostName?: string;
  session?: ActiveRoomSession;
}

export interface CreateRoomParams {
  roomName: string;
  isListed: boolean;
  password?: string;
  maxPlayers?: number;
}

export const AFK_IDLE_TIMEOUT_MS = 25_000;
export const AFK_HIDDEN_GRACE_MS = 2_500;
export const STALE_HEARTBEAT_TTL_MS = 40_000;
const PRESENCE_LEAVE_GRACE_MS = 3_200;
const activeLocalClientPlayerIds = new Set<string>();

/**
 * Determina de forma pura se o jogador deve receber o estado/ícone AFK (ausente/indisponível).
 */
export function isPlayerConsideredAfk(
  idleMs: number,
  isDocumentHidden: boolean,
  hiddenDurationMs = 0
): boolean {
  if (isDocumentHidden && hiddenDurationMs >= AFK_HIDDEN_GRACE_MS) {
    return true;
  }
  return idleMs >= AFK_IDLE_TIMEOUT_MS;
}

export interface NetworkPlayerPosePacket {
  id: string;
  name: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  speed: number;
  bobPhase: number;
  crouch: number;
  flashlightOn: boolean;
  flashDirX: number;
  flashDirY: number;
  flashDirZ: number;
  health: number;
  bleeding: boolean;
  ensnared: boolean;
  inSequence: boolean;
  dead: boolean;
  afk?: boolean;
  beingDragged?: boolean;
  abductionMode?:
    | 'STRIKE_ATTACK'
    | 'DRAGGING_TO_WEB'
    | 'WEBBING_IN_LAIR'
    | 'FATAL_EXECUTION'
    | null;
  abductionProgress?: number;
  abductionSpiderX?: number;
  abductionSpiderY?: number;
  abductionSpiderZ?: number;
  ts: number;
}

export interface NetworkSpiderPacket {
  hostId: string;
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
  cinematicMode?:
    | 'STRIKE_ATTACK'
    | 'DRAGGING_TO_WEB'
    | 'WEBBING_IN_LAIR'
    | 'FATAL_EXECUTION'
    | null;
  cinematicProgress?: number;
  victimId?: string | null;
  victimX?: number;
  victimY?: number;
  victimZ?: number;
  ts: number;
}

export type NetworkWorldEvent =
  | {
      kind: 'chat';
      senderId: string;
      senderName: string;
      text: string;
      ts: number;
    }
  | {
      kind: 'ping';
      senderId: string;
      senderName: string;
      label: string;
      danger: boolean;
      x: number;
      y: number;
      z: number;
      ts: number;
    }
  | {
      kind: 'flare';
      senderId: string;
      senderName?: string;
      x: number;
      y: number;
      z: number;
      yaw: number;
      ts: number;
    }
  | {
      kind: 'rescue_ally';
      rescuerId: string;
      rescuerName: string;
      targetPlayerId: string;
      ts: number;
    }
  | {
      kind: 'interrupt_abduction';
      rescuerId: string;
      rescuerName: string;
      targetPlayerId: string;
      weapon: 'knife' | 'flare';
      x: number;
      z: number;
      ts: number;
    }
  | {
      kind: 'spider_catch_player';
      targetPlayerId: string;
      spiderX: number;
      spiderY: number;
      spiderZ: number;
      ts: number;
    }
  | {
      kind: 'abduction_finished';
      victimId: string;
      ts: number;
    }
  | {
      kind: 'web_trap_spawned';
      x: number;
      z: number;
      ts: number;
    }
  | {
      kind: 'web_trap_triggered';
      senderId: string;
      senderName: string;
      x: number;
      z: number;
      playerX: number;
      playerZ: number;
      ts: number;
    }
  | {
      kind: 'web_trap_cut';
      senderId: string;
      x: number;
      z: number;
      ts: number;
    }
  | {
      kind: 'sos_alert';
      senderId: string;
      senderName: string;
      sectorName: string;
      x: number;
      z: number;
      ts: number;
    };

interface LocalMirrorRoomRecord {
  roomCode: string;
  roomName: string;
  hostId: string;
  hostName: string;
  isListed: boolean;
  hasPassword: boolean;
  passwordPlain: string;
  accessToken: string;
  maxPlayers: number;
  players: Array<{ id: string; name: string; status: string; ts: number }>;
  status: string;
  region: string;
  updatedAtMs: number;
}

const memoryLocalRooms = new Map<string, LocalMirrorRoomRecord>();

function getEnvString(key: string, fallback: string): string {
  try {
    const meta = import.meta as unknown as {
      env?: Record<string, string | undefined>;
    };
    const val = meta.env?.[key];
    if (val && val.trim().length > 0) return val.trim();
  } catch {
    // Ambiente sem import.meta.env
  }
  return fallback;
}

let sharedSupabase: SupabaseClient | null = null;

function getSupabaseCredentials(): { url: string; key: string } {
  return {
    url: getEnvString('VITE_SUPABASE_URL', DEFAULT_SUPABASE_URL),
    key: getEnvString('VITE_SUPABASE_ANON_KEY', DEFAULT_SUPABASE_ANON_KEY),
  };
}

function getSupabaseClient(): SupabaseClient | null {
  if (typeof fetch === 'undefined') return null;
  if (!sharedSupabase) {
    const { url, key } = getSupabaseCredentials();
    sharedSupabase = createClient(url, key, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
      realtime: {
        params: {
          eventsPerSecond: 25,
        },
      },
    });
  }
  return sharedSupabase;
}

interface ActiveSessionLedgerEntry {
  roomCode: string;
  accessToken: string;
  playerId: string;
  ts: number;
}

function readActiveSessionsLedger(): Record<string, ActiveSessionLedgerEntry> {
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(ACTIVE_SESSIONS_LEDGER_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Record<
          string,
          ActiveSessionLedgerEntry
        >;
        if (parsed && typeof parsed === 'object') {
          return parsed;
        }
      }
    }
  } catch {
    // Ignorar falha de storage
  }
  return {};
}

function writeActiveSessionsLedger(
  ledger: Record<string, ActiveSessionLedgerEntry>
): void {
  try {
    if (typeof localStorage !== 'undefined') {
      const keys = Object.keys(ledger);
      if (keys.length === 0) {
        localStorage.removeItem(ACTIVE_SESSIONS_LEDGER_KEY);
      } else {
        localStorage.setItem(
          ACTIVE_SESSIONS_LEDGER_KEY,
          JSON.stringify(ledger)
        );
      }
    }
  } catch {
    // Ignorar quota
  }
}

function recordActiveLocalSession(
  roomCode: string,
  accessToken: string,
  playerId: string
): void {
  const ledger = readActiveSessionsLedger();
  ledger[playerId] = {
    roomCode,
    accessToken,
    playerId,
    ts: Date.now(),
  };
  writeActiveSessionsLedger(ledger);
}

function removeActiveLocalSessionRecord(playerId: string): void {
  const ledger = readActiveSessionsLedger();
  if (ledger[playerId]) {
    delete ledger[playerId];
    writeActiveSessionsLedger(ledger);
  }
}

/**
 * Envia `mp_leave_room` com `keepalive: true` para sobreviver ao fechamento da aba/navegador ou F5!
 */
function sendLeaveRoomReliable(
  roomCode: string,
  accessToken: string,
  playerId: string,
  forceLocalOnly = false
): void {
  removeActiveLocalSessionRecord(playerId);

  // Remove imediatamente do espelho local caso exista
  const map = loadLocalMirrorMap();
  const local = map.get(roomCode);
  if (local) {
    local.players = local.players.filter((p) => p.id !== playerId);
    if (local.players.length === 0) {
      map.delete(roomCode);
    } else if (local.hostId === playerId) {
      local.hostId = local.players[0].id;
      local.hostName = local.players[0].name;
    }
    persistLocalMirrorMap(map);
  }

  if (forceLocalOnly || !accessToken || accessToken.startsWith('local-')) {
    return;
  }

  if (typeof fetch !== 'undefined') {
    try {
      const { url, key } = getSupabaseCredentials();
      const endpoint = `${url.replace(/\/+$/, '')}/rest/v1/rpc/mp_leave_room`;
      void fetch(endpoint, {
        method: 'POST',
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          p_room_code: roomCode,
          p_access_token: accessToken,
          p_player_id: playerId,
        }),
        keepalive: true,
      }).catch(() => {
        // Silencioso no unload
      });
      return;
    } catch {
      // Fallback para cliente Supabase abaixo
    }
  }

  const sb = getSupabaseClient();
  if (sb) {
    void sb.rpc('mp_leave_room', {
      p_room_code: roomCode,
      p_access_token: accessToken,
      p_player_id: playerId,
    });
  }
}

/**
 * Limpa automaticamente sessões órfãs desta aba (ex: após F5/reload) ou de abas irmãs fechadas abruptamente.
 */
function flushLeftoverBrowserSessions(forceLocalOnly = false): void {
  const ledger = readActiveSessionsLedger();
  const entries = Object.values(ledger);
  if (entries.length === 0) return;

  let currentTabPlayerId = '';
  try {
    if (typeof sessionStorage !== 'undefined') {
      currentTabPlayerId = sessionStorage.getItem(PLAYER_SESSION_ID_KEY) || '';
    }
  } catch {
    currentTabPlayerId = '';
  }

  const now = Date.now();
  for (const entry of entries) {
    const isReloadedThisTab =
      Boolean(currentTabPlayerId) &&
      entry.playerId === currentTabPlayerId &&
      !activeLocalClientPlayerIds.has(currentTabPlayerId);
    const isStaleClosedTab =
      !activeLocalClientPlayerIds.has(entry.playerId) &&
      now - entry.ts > STALE_HEARTBEAT_TTL_MS;

    if (isReloadedThisTab || isStaleClosedTab) {
      sendLeaveRoomReliable(
        entry.roomCode,
        entry.accessToken,
        entry.playerId,
        forceLocalOnly
      );
    }
  }
}

/**
 * Normaliza código numérico da sala (ex: "#482-910" ou "482 910" -> "482910").
 */
export function normalizeRoomCode(raw: string): string {
  const trimmed = (raw || '').trim();
  // Suporta também colar URL inteira com ?room=482910
  const urlMatch = trimmed.match(/[?&]room=([0-9-\s]{4,12})/i);
  const candidate = urlMatch ? urlMatch[1] : trimmed;
  return candidate.replace(/[^0-9]/g, '').slice(0, 6);
}

/**
 * Formata código de 6 dígitos para leitura fácil ("482910" -> "482-910").
 */
export function formatRoomCodeDisplay(code: string): string {
  const clean = normalizeRoomCode(code);
  if (clean.length === 6) {
    return `${clean.slice(0, 3)}-${clean.slice(3)}`;
  }
  return clean || '------';
}

function generateRandomId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 8);
  const rand2 = Math.floor(100 + Math.random() * 900);
  return `${prefix}-${rand}${rand2}`;
}

export function getOrCreateLocalPlayerProfile(): {
  id: string;
  name: string;
} {
  let id = '';
  let name = '';

  try {
    if (typeof sessionStorage !== 'undefined') {
      id = sessionStorage.getItem(PLAYER_SESSION_ID_KEY) || '';
      if (!id) {
        id = generateRandomId('astro');
        sessionStorage.setItem(PLAYER_SESSION_ID_KEY, id);
      }
    }
    if (typeof localStorage !== 'undefined') {
      name = localStorage.getItem(PLAYER_NAME_STORAGE_KEY) || '';
      if (!name) {
        const callsignNum = Math.floor(10 + Math.random() * 89);
        name = `OPERADOR-${callsignNum}`;
        localStorage.setItem(PLAYER_NAME_STORAGE_KEY, name);
      }
    }
  } catch {
    // Sem Web Storage
  }

  if (!id) id = generateRandomId('astro');
  if (!name) name = `OPERADOR-${Math.floor(10 + Math.random() * 89)}`;

  return { id, name };
}

export function setLocalPlayerName(rawName: string): string {
  const clean =
    rawName
      .replace(/[\r\n\t<>]/g, '')
      .trim()
      .slice(0, 20) || 'OPERADOR';
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(PLAYER_NAME_STORAGE_KEY, clean);
    }
  } catch {
    // Sem Web Storage
  }
  return clean;
}

// ============================================================================
// ESPELHO LOCAL (BroadcastChannel + Storage) — garante funcionamento instantâneo
// mesmo offline, entre abas locais e em testes automatizados!
// ============================================================================

function loadLocalMirrorMap(): Map<string, LocalMirrorRoomRecord> {
  const now = Date.now();
  let mutatedStorage = false;
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(LOCAL_ROOMS_STORAGE_KEY);
      if (raw) {
        const arr = JSON.parse(raw) as LocalMirrorRoomRecord[];
        if (Array.isArray(arr)) {
          for (const item of arr) {
            // Apenas salas locais/offline (`local-...`) vivem no espelho localStorage;
            // salas da nuvem têm o Supabase como fonte única da verdade para jamais ressuscitar jogadores fantasmas!
            if (!item.accessToken || !item.accessToken.startsWith('local-')) {
              mutatedStorage = true;
              continue;
            }
            const livePlayers = Array.isArray(item.players)
              ? item.players.filter(
                  (p) => now - p.ts < STALE_HEARTBEAT_TTL_MS
                )
              : [];
            if (
              now - item.updatedAtMs < STALE_HEARTBEAT_TTL_MS &&
              livePlayers.length > 0 &&
              item.status !== 'CLOSED'
            ) {
              if (livePlayers.length !== item.players.length) {
                item.players = livePlayers;
                if (!livePlayers.some((p) => p.id === item.hostId)) {
                  item.hostId = livePlayers[0].id;
                  item.hostName = livePlayers[0].name;
                }
                mutatedStorage = true;
              }
              memoryLocalRooms.set(item.roomCode, item);
            } else {
              memoryLocalRooms.delete(item.roomCode);
              mutatedStorage = true;
            }
          }
        }
      }
    }
  } catch {
    // Ignorar falha de parse
  }

  for (const [code, rec] of memoryLocalRooms.entries()) {
    if (!rec.accessToken || !rec.accessToken.startsWith('local-')) {
      memoryLocalRooms.delete(code);
      mutatedStorage = true;
      continue;
    }
    const livePlayers = rec.players.filter(
      (p) => now - p.ts < STALE_HEARTBEAT_TTL_MS
    );
    if (
      now - rec.updatedAtMs >= STALE_HEARTBEAT_TTL_MS ||
      livePlayers.length === 0 ||
      rec.status === 'CLOSED'
    ) {
      memoryLocalRooms.delete(code);
      mutatedStorage = true;
    } else if (livePlayers.length !== rec.players.length) {
      rec.players = livePlayers;
      if (!livePlayers.some((p) => p.id === rec.hostId)) {
        rec.hostId = livePlayers[0].id;
        rec.hostName = livePlayers[0].name;
      }
      mutatedStorage = true;
    }
  }

  if (mutatedStorage) {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(
          LOCAL_ROOMS_STORAGE_KEY,
          JSON.stringify(Array.from(memoryLocalRooms.values()))
        );
      }
    } catch {
      // Ignorar
    }
  }
  return memoryLocalRooms;
}

function persistLocalMirrorMap(map: Map<string, LocalMirrorRoomRecord>): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(
        LOCAL_ROOMS_STORAGE_KEY,
        JSON.stringify(Array.from(map.values()))
      );
    }
  } catch {
    // Ignorar quota
  }
  notifyDirectoryBroadcast();
}

function notifyDirectoryBroadcast(): void {
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      const bc = new BroadcastChannel('oof-mp-directory-v1');
      bc.postMessage({ type: 'directory_updated', ts: Date.now() });
      bc.close();
    }
  } catch {
    // Ignorar
  }
}

export function clearLocalMirrorRoomsForTests(): void {
  memoryLocalRooms.clear();
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(LOCAL_ROOMS_STORAGE_KEY);
      localStorage.removeItem(ACTIVE_SESSIONS_LEDGER_KEY);
    }
  } catch {
    // Ignorar
  }
}

function mapRawPlayersSummary(raw: unknown): RoomPlayerSummary[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      const rec = item as Record<string, unknown>;
      return {
        id: String(rec.id || ''),
        name: String(rec.name || 'Operador'),
        status: String(rec.status || 'ONLINE'),
      };
    })
    .filter((p) => p.id.length > 0);
}

/**
 * Serviço de Diretório de Salas, Criação, Inspeção por Número e Autenticação por Senha.
 */
export class MultiplayerLobbyService {
  private readonly forceLocalOnly: boolean;

  constructor(options?: { forceLocalOnly?: boolean }) {
    this.forceLocalOnly = Boolean(options?.forceLocalOnly);
  }

  async listPublicRooms(): Promise<PublicRoomEntry[]> {
    flushLeftoverBrowserSessions(this.forceLocalOnly);
    const merged = new Map<string, PublicRoomEntry>();

    // 1. Espelho local ativo (abas locais / modo offline)
    const localMap = loadLocalMirrorMap();
    for (const rec of localMap.values()) {
      if (!rec.isListed || rec.status === 'CLOSED' || rec.players.length === 0) {
        continue;
      }
      merged.set(rec.roomCode, {
        roomCode: rec.roomCode,
        roomName: rec.roomName,
        hostName: rec.hostName,
        hasPassword: rec.hasPassword,
        maxPlayers: rec.maxPlayers,
        playerCount: rec.players.length,
        playersSummary: rec.players.map((p) => ({
          id: p.id,
          name: p.name,
          status: p.status,
        })),
        status: rec.status,
        region: rec.region,
        updatedAt: new Date(rec.updatedAtMs).toISOString(),
      });
    }

    // 2. Diretório global Supabase
    if (!this.forceLocalOnly) {
      const sb = getSupabaseClient();
      if (sb) {
        try {
          const { data, error } = await sb.rpc('mp_list_public_rooms');
          if (!error && Array.isArray(data)) {
            for (const row of data as Array<Record<string, unknown>>) {
              const code = String(row.room_code || '');
              if (!code) continue;
              merged.set(code, {
                roomCode: code,
                roomName: String(row.room_name || 'Sala Multiplayer'),
                hostName: String(row.host_name || 'Operador'),
                hasPassword: Boolean(row.has_password),
                maxPlayers: Number(row.max_players || 4),
                playerCount: Number(row.player_count || 1),
                playersSummary: mapRawPlayersSummary(row.players_summary),
                status: String(row.status || 'OPEN'),
                region: String(row.region || 'BR-SP'),
                updatedAt: String(row.updated_at || new Date().toISOString()),
              });
            }
          }
        } catch {
          // Mantém resultado local caso offline
        }
      }
    }

    return Array.from(merged.values()).sort((a, b) =>
      b.updatedAt.localeCompare(a.updatedAt)
    );
  }

  subscribeToDirectoryUpdates(onUpdate: () => void): () => void {
    let bc: BroadcastChannel | null = null;
    try {
      if (typeof BroadcastChannel !== 'undefined') {
        bc = new BroadcastChannel('oof-mp-directory-v1');
        bc.onmessage = () => onUpdate();
      }
    } catch {
      bc = null;
    }

    let channel: RealtimeChannel | null = null;
    if (!this.forceLocalOnly) {
      const sb = getSupabaseClient();
      if (sb) {
        channel = sb
          .channel(`oof-dir-watch-${Math.random().toString(36).slice(2, 7)}`)
          .on(
            'postgres_changes',
            {
              event: '*',
              schema: 'public',
              table: 'mp_room_directory',
            },
            () => {
              onUpdate();
            }
          )
          .subscribe();
      }
    }

    return () => {
      try {
        bc?.close();
      } catch {
        // Ignorar
      }
      if (channel) {
        const sb = getSupabaseClient();
        sb?.removeChannel(channel);
      }
    };
  }

  async createRoom(
    params: CreateRoomParams,
    customPlayer?: { id: string; name: string }
  ): Promise<ActiveRoomSession> {
    const profile = customPlayer ?? getOrCreateLocalPlayerProfile();
    flushLeftoverBrowserSessions(this.forceLocalOnly);
    const roomName =
      (params.roomName || '').trim().slice(0, 38) ||
      `Sala de ${profile.name}`;
    const cleanPassword = (params.password || '').trim();
    const hasPassword = cleanPassword.length > 0;
    const isListed = params.isListed !== false;
    const maxPlayers = Math.max(2, Math.min(8, params.maxPlayers ?? 4));

    if (!this.forceLocalOnly) {
      const sb = getSupabaseClient();
      if (sb) {
        try {
          const { data, error } = await sb.rpc('mp_create_room', {
            p_room_name: roomName,
            p_host_id: profile.id,
            p_host_name: profile.name,
            p_is_listed: isListed,
            p_password: hasPassword ? cleanPassword : null,
            p_max_players: maxPlayers,
          });
          const res = data as Record<string, unknown> | null;
          if (!error && res && res.ok) {
            const roomCode = String(res.room_code);
            const accessToken = String(res.access_token);
            const session: ActiveRoomSession = {
              roomCode,
              roomName: String(res.room_name || roomName),
              hostId: String(res.host_id || profile.id),
              hostName: String(res.host_name || profile.name),
              isListed: Boolean(res.is_listed),
              hasPassword: Boolean(res.has_password),
              maxPlayers: Number(res.max_players || maxPlayers),
              playerCount: Number(res.player_count || 1),
              playersSummary: mapRawPlayersSummary(res.players_summary),
              accessToken,
              localPlayerId: profile.id,
              localPlayerName: profile.name,
            };

            notifyDirectoryBroadcast();
            return session;
          }
        } catch {
          // Fallback local abaixo
        }
      }
    }

    // Fallback local determinístico (offline / testes)
    const map = loadLocalMirrorMap();
    let code = '';
    for (let i = 0; i < 30; i++) {
      code = String(Math.floor(100000 + Math.random() * 900000));
      if (!map.has(code)) break;
    }
    const token = `local-${code}-${Math.random().toString(36).slice(2, 10)}`;
    const now = Date.now();
    const record: LocalMirrorRoomRecord = {
      roomCode: code,
      roomName,
      hostId: profile.id,
      hostName: profile.name,
      isListed,
      hasPassword,
      passwordPlain: cleanPassword,
      accessToken: token,
      maxPlayers,
      players: [
        { id: profile.id, name: profile.name, status: 'HOST', ts: now },
      ],
      status: 'OPEN',
      region: 'LOCAL',
      updatedAtMs: now,
    };
    map.set(code, record);
    persistLocalMirrorMap(map);

    return {
      roomCode: code,
      roomName,
      hostId: profile.id,
      hostName: profile.name,
      isListed,
      hasPassword,
      maxPlayers,
      playerCount: 1,
      playersSummary: [
        { id: profile.id, name: profile.name, status: 'HOST' },
      ],
      accessToken: token,
      localPlayerId: profile.id,
      localPlayerName: profile.name,
    };
  }

  async inspectRoomByCode(rawCode: string): Promise<RoomInspectionResult> {
    flushLeftoverBrowserSessions(this.forceLocalOnly);
    const code = normalizeRoomCode(rawCode);
    if (code.length < 4) {
      return { found: false, errorCode: 'NOT_FOUND' };
    }

    if (!this.forceLocalOnly) {
      const sb = getSupabaseClient();
      if (sb) {
        try {
          const { data, error } = await sb.rpc('mp_inspect_room_by_code', {
            p_room_code: code,
          });
          const res = data as Record<string, unknown> | null;
          if (!error && res && res.found) {
            return {
              found: true,
              roomCode: String(res.room_code || code),
              roomName: String(res.room_name || 'Sala Multiplayer'),
              hostName: String(res.host_name || 'Operador'),
              isListed: Boolean(res.is_listed),
              hasPassword: Boolean(res.has_password),
              maxPlayers: Number(res.max_players || 4),
              playerCount: Number(res.player_count || 1),
              isFull: Boolean(res.is_full),
              status: String(res.status || 'OPEN'),
              playersSummary: mapRawPlayersSummary(res.players_summary),
            };
          }
        } catch {
          // Segue para espelho local
        }
      }
    }

    const local = loadLocalMirrorMap().get(code);
    if (!local || local.status === 'CLOSED') {
      return { found: false, errorCode: 'NOT_FOUND' };
    }

    return {
      found: true,
      roomCode: local.roomCode,
      roomName: local.roomName,
      hostName: local.hostName,
      isListed: local.isListed,
      hasPassword: local.hasPassword,
      maxPlayers: local.maxPlayers,
      playerCount: local.players.length,
      isFull: local.players.length >= local.maxPlayers,
      status: local.status,
      playersSummary: local.players.map((p) => ({
        id: p.id,
        name: p.name,
        status: p.status,
      })),
    };
  }

  async joinRoom(
    rawCode: string,
    password?: string,
    customPlayer?: { id: string; name: string }
  ): Promise<JoinRoomResult> {
    const code = normalizeRoomCode(rawCode);
    if (code.length < 4) {
      return { ok: false, errorCode: 'NOT_FOUND' };
    }

    const profile = customPlayer ?? getOrCreateLocalPlayerProfile();
    flushLeftoverBrowserSessions(this.forceLocalOnly);
    const cleanPass = (password || '').trim();

    if (!this.forceLocalOnly) {
      const sb = getSupabaseClient();
      if (sb) {
        try {
          const { data, error } = await sb.rpc('mp_join_room', {
            p_room_code: code,
            p_password: cleanPass.length > 0 ? cleanPass : null,
            p_player_id: profile.id,
            p_player_name: profile.name,
          });
          const res = data as Record<string, unknown> | null;
          if (!error && res) {
            if (!res.ok) {
              const errCode = String(
                res.error_code || 'NOT_FOUND'
              ) as JoinRoomErrorCode;
              // Se não achou na nuvem mas existe localmente, deixa cair no espelho local
              if (errCode !== 'NOT_FOUND' || !loadLocalMirrorMap().has(code)) {
                return {
                  ok: false,
                  errorCode: errCode,
                  roomName: res.room_name ? String(res.room_name) : undefined,
                  hostName: res.host_name ? String(res.host_name) : undefined,
                };
              }
            } else {
              const session: ActiveRoomSession = {
                roomCode: String(res.room_code || code),
                roomName: String(res.room_name || 'Sala Multiplayer'),
                hostId: String(res.host_id || ''),
                hostName: String(res.host_name || 'Operador'),
                isListed: Boolean(res.is_listed),
                hasPassword: Boolean(res.has_password),
                maxPlayers: Number(res.max_players || 4),
                playerCount: Number(res.player_count || 1),
                playersSummary: mapRawPlayersSummary(res.players_summary),
                accessToken: String(res.access_token || ''),
                localPlayerId: profile.id,
                localPlayerName: profile.name,
              };
              return { ok: true, session };
            }
          }
        } catch {
          // Tenta espelho local abaixo
        }
      }
    }

    const map = loadLocalMirrorMap();
    const local = map.get(code);
    if (!local || local.status === 'CLOSED') {
      return { ok: false, errorCode: 'NOT_FOUND' };
    }

    if (local.hasPassword) {
      if (!cleanPass) {
        return {
          ok: false,
          errorCode: 'PASSWORD_REQUIRED',
          roomName: local.roomName,
          hostName: local.hostName,
        };
      }
      if (cleanPass !== local.passwordPlain) {
        return {
          ok: false,
          errorCode: 'WRONG_PASSWORD',
          roomName: local.roomName,
          hostName: local.hostName,
        };
      }
    }

    const now = Date.now();
    const others = local.players.filter(
      (p) => p.id !== profile.id && now - p.ts < STALE_HEARTBEAT_TTL_MS
    );
    const alreadyIn = local.players.some((p) => p.id === profile.id);
    if (others.length >= local.maxPlayers && !alreadyIn) {
      return { ok: false, errorCode: 'ROOM_FULL' };
    }

    local.players = [
      ...others,
      {
        id: profile.id,
        name: profile.name,
        status: local.hostId === profile.id ? 'HOST' : 'ONLINE',
        ts: now,
      },
    ];
    local.updatedAtMs = now;
    persistLocalMirrorMap(map);

    return {
      ok: true,
      session: {
        roomCode: local.roomCode,
        roomName: local.roomName,
        hostId: local.hostId,
        hostName: local.hostName,
        isListed: local.isListed,
        hasPassword: local.hasPassword,
        maxPlayers: local.maxPlayers,
        playerCount: local.players.length,
        playersSummary: local.players.map((p) => ({
          id: p.id,
          name: p.name,
          status: p.status,
        })),
        accessToken: local.accessToken,
        localPlayerId: profile.id,
        localPlayerName: profile.name,
      },
    };
  }
}

// ============================================================================
// CLIENTE DE TEMPO REAL DA PARTIDA (Sincronia 3D de Esquadrão, Aranha, Chat e Pings)
// ============================================================================

export interface MultiplayerRoomClientCallbacks {
  onRemotePlayerPose: (packet: NetworkPlayerPosePacket) => void;
  onRemotePlayerLeft: (playerId: string) => void;
  onSpiderSync: (packet: NetworkSpiderPacket) => void;
  onWorldEvent: (event: NetworkWorldEvent) => void;
  onRosterUpdated: (
    players: RoomPlayerSummary[],
    hostId: string,
    hostName: string
  ) => void;
}

/**
 * Cria um temporizador periódico imune ao congelamento de abas em segundo plano
 * usando um Web Worker inline (com fallback automático para setInterval).
 */
function createBackgroundSafeInterval(
  callback: () => void,
  intervalMs: number
): () => void {
  if (
    typeof Worker !== 'undefined' &&
    typeof Blob !== 'undefined' &&
    typeof URL !== 'undefined' &&
    typeof URL.createObjectURL === 'function'
  ) {
    try {
      const src = `const id = setInterval(() => postMessage(1), ${Math.max(500, Math.floor(intervalMs))}); onmessage = (e) => { if (e.data === 'stop') { clearInterval(id); close(); } };`;
      const blob = new Blob([src], { type: 'application/javascript' });
      const blobUrl = URL.createObjectURL(blob);
      const worker = new Worker(blobUrl);
      worker.onmessage = () => {
        callback();
      };
      return () => {
        try {
          worker.postMessage('stop');
          worker.terminate();
        } catch {
          // Ignorar
        }
        try {
          URL.revokeObjectURL(blobUrl);
        } catch {
          // Ignorar
        }
      };
    } catch {
      // Fallback para setInterval abaixo
    }
  }

  const timer = setInterval(callback, intervalMs);
  return () => clearInterval(timer);
}

export class MultiplayerRoomClient {
  private channel: RealtimeChannel | null = null;
  private dirWatchChannel: RealtimeChannel | null = null;
  private localBc: BroadcastChannel | null = null;
  private stopKeepaliveLoop: (() => void) | null = null;
  private pingIntervalId = 0;
  private reconnectTimerId = 0;
  private readonly pendingPresenceLeaveTimers = new Map<
    string,
    ReturnType<typeof setTimeout>
  >();
  private readonly recentIncomingJoinMs = new Map<string, number>();
  private disposed = false;
  private channelConnected = false;
  private estimatedPingMs = 18;
  private currentHostId: string;
  private currentHostName: string;
  private currentPlayers: RoomPlayerSummary[];
  private localAfk = false;
  private lastSentPose: Omit<NetworkPlayerPosePacket, 'id' | 'name' | 'ts'> | null =
    null;
  private lastPoseSentAtMs = 0;
  private lastHeartbeatAtMs = 0;
  private readonly boundUnload: () => void;
  private readonly boundWakeUp: () => void;

  constructor(
    public readonly session: ActiveRoomSession,
    private readonly callbacks: MultiplayerRoomClientCallbacks,
    private readonly forceLocalOnly = false
  ) {
    this.currentHostId = session.hostId;
    this.currentHostName = session.hostName;
    this.currentPlayers = [...session.playersSummary];
    this.boundUnload = () => {
      this.disconnect(true);
    };
    this.boundWakeUp = () => {
      if (this.disposed) return;
      if (!this.channelConnected && !this.forceLocalOnly) {
        this.openRealtimeChannel();
      }
      void this.sendRoomHeartbeat();
    };
  }

  get isHost(): boolean {
    return this.currentHostId === this.session.localPlayerId;
  }

  get isLocalAfk(): boolean {
    return this.localAfk;
  }

  setLocalAfk(afk: boolean): void {
    if (this.localAfk === afk) return;
    this.localAfk = afk;
    if (this.lastSentPose) {
      this.broadcastPlayerPose({
        ...this.lastSentPose,
        speed: afk ? 0 : this.lastSentPose.speed,
        afk,
      });
    }
    void this.sendRoomHeartbeat();
  }

  private getLocalRosterStatus(): string {
    if (this.localAfk) {
      return this.isHost ? 'HOST_AFK' : 'AFK';
    }
    return this.isHost ? 'HOST' : 'ONLINE';
  }

  get hostName(): string {
    return this.currentHostName;
  }

  get pingMs(): number {
    return this.estimatedPingMs;
  }

  get players(): readonly RoomPlayerSummary[] {
    return this.currentPlayers;
  }

  private getChannelKey(): string {
    return `oof-room-${this.session.roomCode}-${this.session.accessToken.slice(0, 8)}`;
  }

  private cancelPendingPresenceLeave(playerId: string | undefined): void {
    if (!playerId) return;
    const existing = this.pendingPresenceLeaveTimers.get(playerId);
    if (existing !== undefined) {
      clearTimeout(existing);
      this.pendingPresenceLeaveTimers.delete(playerId);
    }
  }

  private schedulePresenceLeaveCheck(playerId: string | undefined): void {
    if (
      this.disposed ||
      !playerId ||
      playerId === this.session.localPlayerId
    ) {
      return;
    }

    const activeState = this.channel?.presenceState() ?? {};
    const remainingSockets = activeState[playerId];
    if (Array.isArray(remainingSockets) && remainingSockets.length > 0) {
      this.cancelPendingPresenceLeave(playerId);
      return;
    }

    this.cancelPendingPresenceLeave(playerId);
    const timer = setTimeout(() => {
      this.pendingPresenceLeaveTimers.delete(playerId);
      if (this.disposed) return;
      const latestState = this.channel?.presenceState() ?? {};
      const stillPresent = latestState[playerId];
      if (Array.isArray(stillPresent) && stillPresent.length > 0) {
        return;
      }
      this.handleConfirmedRemoteDeparture(playerId, true);
    }, PRESENCE_LEAVE_GRACE_MS);

    this.pendingPresenceLeaveTimers.set(playerId, timer);
  }

  private handleConfirmedRemoteDeparture(
    playerId: string,
    evictFromServerDb: boolean
  ): void {
    if (!playerId || playerId === this.session.localPlayerId) return;
    this.cancelPendingPresenceLeave(playerId);
    this.recentIncomingJoinMs.delete(playerId);

    const hadPlayer = this.currentPlayers.some((p) => p.id === playerId);
    this.currentPlayers = this.currentPlayers.filter((p) => p.id !== playerId);
    if (this.currentHostId === playerId && this.currentPlayers.length > 0) {
      this.currentHostId = this.currentPlayers[0].id;
      this.currentHostName = this.currentPlayers[0].name;
    }

    this.callbacks.onRemotePlayerLeft(playerId);
    if (hadPlayer) {
      this.callbacks.onRosterUpdated(
        this.currentPlayers,
        this.currentHostId,
        this.currentHostName
      );
    }

    if (
      evictFromServerDb &&
      !this.forceLocalOnly &&
      !this.session.accessToken.startsWith('local-')
    ) {
      const sb = getSupabaseClient();
      if (sb) {
        void sb.rpc('mp_evict_disconnected_player', {
          p_room_code: this.session.roomCode,
          p_access_token: this.session.accessToken,
          p_target_player_id: playerId,
        });
      }
    }
  }

  private applyAuthoritativeRoster(
    serverPlayers: RoomPlayerSummary[],
    nextHostId?: string,
    nextHostName?: string
  ): void {
    if (this.disposed) return;
    const now = Date.now();
    const serverIds = new Set(serverPlayers.map((p) => p.id));
    const merged: RoomPlayerSummary[] = [...serverPlayers];

    for (const prev of this.currentPlayers) {
      if (prev.id === this.session.localPlayerId || serverIds.has(prev.id)) {
        continue;
      }
      const firstSeen = this.recentIncomingJoinMs.get(prev.id) ?? 0;
      if (now - firstSeen < 3500) {
        merged.push(prev);
      } else {
        this.cancelPendingPresenceLeave(prev.id);
        this.recentIncomingJoinMs.delete(prev.id);
        this.callbacks.onRemotePlayerLeft(prev.id);
      }
    }

    if (nextHostId) this.currentHostId = nextHostId;
    if (nextHostName) this.currentHostName = nextHostName;
    if (
      !merged.some((p) => p.id === this.currentHostId) &&
      merged.length > 0
    ) {
      this.currentHostId = merged[0].id;
      this.currentHostName = merged[0].name;
    }

    this.currentPlayers = merged;
    this.callbacks.onRosterUpdated(
      this.currentPlayers,
      this.currentHostId,
      this.currentHostName
    );
  }

  private openDirectoryWatchChannel(): void {
    if (
      this.disposed ||
      this.forceLocalOnly ||
      this.session.accessToken.startsWith('local-')
    ) {
      return;
    }
    const sb = getSupabaseClient();
    if (!sb) return;

    if (this.dirWatchChannel) {
      try {
        sb.removeChannel(this.dirWatchChannel);
      } catch {
        // Ignorar
      }
      this.dirWatchChannel = null;
    }

    this.dirWatchChannel = sb
      .channel(
        `oof-room-dir-${this.session.roomCode}-${Math.random().toString(36).slice(2, 7)}`
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'mp_room_directory',
          filter: `room_code=eq.${this.session.roomCode}`,
        },
        (payload) => {
          if (this.disposed) return;
          const row = payload.new as Record<string, unknown> | undefined;
          if (row && Array.isArray(row.players_summary)) {
            const summary = mapRawPlayersSummary(row.players_summary);
            const hostName = row.host_name
              ? String(row.host_name)
              : undefined;
            const hostEntry = summary.find(
              (p) => p.status === 'HOST' || p.status === 'HOST_AFK'
            );
            this.applyAuthoritativeRoster(
              summary,
              hostEntry?.id,
              hostName ?? hostEntry?.name
            );
          }
        }
      )
      .subscribe();
  }

  private openRealtimeChannel(): void {
    if (this.disposed || this.forceLocalOnly) return;
    const sb = getSupabaseClient();
    if (!sb) return;

    if (this.channel) {
      try {
        sb.removeChannel(this.channel);
      } catch {
        // Ignorar
      }
      this.channel = null;
    }

    this.channelConnected = false;
    const chanKey = this.getChannelKey();
    const ch = sb.channel(chanKey, {
      config: {
        broadcast: { self: false, ack: false },
        presence: { key: this.session.localPlayerId },
      },
    });
    this.channel = ch;

    ch.on('broadcast', { event: 'oof_pkt' }, ({ payload }) => {
      this.handleIncomingEnvelope(payload);
    })
      .on('presence', { event: 'join' }, ({ key }) => {
        this.cancelPendingPresenceLeave(key);
      })
      .on('presence', { event: 'leave' }, ({ key }) => {
        this.schedulePresenceLeaveCheck(key);
      })
      .subscribe((status) => {
        if (this.disposed || this.channel !== ch) return;
        if (status === 'SUBSCRIBED') {
          this.channelConnected = true;
          void ch.track({
            id: this.session.localPlayerId,
            name: this.session.localPlayerName,
            afk: this.localAfk,
            ts: Date.now(),
          });
          this.sendEnvelope({
            t: 'hello',
            id: this.session.localPlayerId,
            name: this.session.localPlayerName,
            afk: this.localAfk,
            ts: Date.now(),
          });
          if (this.lastSentPose) {
            this.broadcastPlayerPose({
              ...this.lastSentPose,
              afk: this.localAfk,
            });
          }
          void this.sendRoomHeartbeat();
        } else if (
          status === 'TIMED_OUT' ||
          status === 'CHANNEL_ERROR' ||
          status === 'CLOSED'
        ) {
          this.channelConnected = false;
          if (typeof window !== 'undefined' && !this.reconnectTimerId) {
            this.reconnectTimerId = window.setTimeout(() => {
              this.reconnectTimerId = 0;
              this.openRealtimeChannel();
            }, 2200);
          }
        }
      });
  }

  connect(): void {
    if (this.disposed) return;

    activeLocalClientPlayerIds.add(this.session.localPlayerId);
    recordActiveLocalSession(
      this.session.roomCode,
      this.session.accessToken,
      this.session.localPlayerId
    );

    const chanKey = this.getChannelKey();

    // 1. Canal local instantâneo entre abas do navegador
    try {
      if (typeof BroadcastChannel !== 'undefined') {
        this.localBc = new BroadcastChannel(chanKey);
        this.localBc.onmessage = (ev) => {
          this.handleIncomingEnvelope(ev.data);
        };
      }
    } catch {
      this.localBc = null;
    }

    // 2. Canal global WebSocket Supabase Realtime + Presence + espelho do diretório da sala
    this.openRealtimeChannel();
    this.openDirectoryWatchChannel();

    this.sendEnvelope({
      t: 'hello',
      id: this.session.localPlayerId,
      name: this.session.localPlayerName,
      afk: this.localAfk,
      ts: Date.now(),
    });

    if (typeof window !== 'undefined') {
      window.addEventListener('pagehide', this.boundUnload);
      window.addEventListener('beforeunload', this.boundUnload);
      window.addEventListener('online', this.boundWakeUp);
      window.addEventListener('focus', this.boundWakeUp);
      if (typeof document !== 'undefined') {
        document.addEventListener('visibilitychange', this.boundWakeUp);
      }

      this.lastHeartbeatAtMs = Date.now();
      this.stopKeepaliveLoop = createBackgroundSafeInterval(() => {
        if (this.disposed) return;
        const now = Date.now();
        const hiddenNow =
          typeof document !== 'undefined' && Boolean(document.hidden);
        if (hiddenNow && !this.localAfk) {
          this.localAfk = true;
        }
        // Mantém pose e sinal AFK vivos mesmo quando requestAnimationFrame pausa em aba minimizada!
        if (this.lastSentPose && now - this.lastPoseSentAtMs >= 2600) {
          this.broadcastPlayerPose({
            ...this.lastSentPose,
            speed: 0,
            afk: this.localAfk || hiddenNow,
          });
        }
        if (now - this.lastHeartbeatAtMs >= 8_000) {
          this.lastHeartbeatAtMs = now;
          void this.sendRoomHeartbeat();
        }
      }, 2500);

      this.pingIntervalId = window.setInterval(() => {
        this.sendEnvelope({
          t: 'ping_probe',
          senderId: this.session.localPlayerId,
          sentAt: Date.now(),
        });
      }, 5_000);
    }
  }

  broadcastPlayerPose(
    pose: Omit<NetworkPlayerPosePacket, 'id' | 'name' | 'ts'>
  ): void {
    if (this.disposed) return;
    const effectiveAfk = pose.afk ?? this.localAfk;
    this.lastSentPose = { ...pose, afk: effectiveAfk };
    this.lastPoseSentAtMs = Date.now();
    const pkt: NetworkPlayerPosePacket = {
      ...pose,
      afk: effectiveAfk,
      id: this.session.localPlayerId,
      name: this.session.localPlayerName,
      ts: this.lastPoseSentAtMs,
    };
    this.sendEnvelope({ t: 'pose', pkt });
  }

  broadcastSpiderState(
    spider: Omit<NetworkSpiderPacket, 'hostId' | 'ts'>
  ): void {
    if (this.disposed || !this.isHost) return;
    const pkt: NetworkSpiderPacket = {
      ...spider,
      hostId: this.session.localPlayerId,
      ts: Date.now(),
    };
    this.sendEnvelope({ t: 'spider', pkt });
  }

  broadcastWorldEvent(event: NetworkWorldEvent): void {
    if (this.disposed) return;
    this.sendEnvelope({ t: 'event', event });
  }

  private sendEnvelope(payload: Record<string, unknown>): void {
    try {
      this.localBc?.postMessage(payload);
    } catch {
      // Ignorar
    }
    if (this.channel) {
      void this.channel.send({
        type: 'broadcast',
        event: 'oof_pkt',
        payload,
      });
    }
  }

  private handleIncomingEnvelope(raw: unknown): void {
    if (this.disposed || !raw || typeof raw !== 'object') return;
    const msg = raw as Record<string, unknown>;
    const type = msg.t;

    if (type === 'pose' && msg.pkt) {
      const pkt = msg.pkt as NetworkPlayerPosePacket;
      if (pkt.id && pkt.id !== this.session.localPlayerId) {
        this.cancelPendingPresenceLeave(pkt.id);
        this.ensurePlayerInRoster(pkt.id, pkt.name);
        this.callbacks.onRemotePlayerPose(pkt);
      }
    } else if (type === 'spider' && msg.pkt) {
      const pkt = msg.pkt as NetworkSpiderPacket;
      if (pkt.hostId !== this.session.localPlayerId) {
        this.callbacks.onSpiderSync(pkt);
      }
    } else if (type === 'event' && msg.event) {
      this.callbacks.onWorldEvent(msg.event as NetworkWorldEvent);
    } else if (type === 'hello') {
      const id = String(msg.id || '');
      const name = String(msg.name || 'Operador');
      if (id && id !== this.session.localPlayerId) {
        this.cancelPendingPresenceLeave(id);
        this.ensurePlayerInRoster(id, name);
      }
    } else if (type === 'bye') {
      const id = String(msg.id || '');
      if (id && id !== this.session.localPlayerId) {
        this.handleConfirmedRemoteDeparture(id, false);
      }
    } else if (type === 'ping_probe') {
      const senderId = String(msg.senderId || '');
      if (senderId && senderId !== this.session.localPlayerId) {
        this.sendEnvelope({
          t: 'ping_ack',
          targetId: senderId,
          sentAt: msg.sentAt,
        });
      }
    } else if (type === 'ping_ack') {
      if (msg.targetId === this.session.localPlayerId) {
        const sentAt = Number(msg.sentAt || 0);
        if (sentAt > 0) {
          const rtt = Math.max(2, Math.min(999, Date.now() - sentAt));
          this.estimatedPingMs = Math.round(this.estimatedPingMs * 0.6 + rtt * 0.4);
        }
      }
    }
  }

  private ensurePlayerInRoster(id: string, name: string): void {
    if (!this.recentIncomingJoinMs.has(id)) {
      this.recentIncomingJoinMs.set(id, Date.now());
    }
    const exists = this.currentPlayers.some((p) => p.id === id);
    if (!exists) {
      this.currentPlayers = [
        ...this.currentPlayers,
        {
          id,
          name,
          status: id === this.currentHostId ? 'HOST' : 'ONLINE',
        },
      ];
      this.callbacks.onRosterUpdated(
        this.currentPlayers,
        this.currentHostId,
        this.currentHostName
      );
    }
  }

  private async sendRoomHeartbeat(): Promise<void> {
    if (this.disposed) return;
    const localStatus = this.getLocalRosterStatus();
    recordActiveLocalSession(
      this.session.roomCode,
      this.session.accessToken,
      this.session.localPlayerId
    );

    // Atualiza espelho local para salas locais (`local-...`), limpando abas mortas (>40s sem heartbeat)
    const map = loadLocalMirrorMap();
    const local = map.get(this.session.roomCode);
    if (local) {
      const now = Date.now();
      const others = local.players
        .filter(
          (p) =>
            p.id !== this.session.localPlayerId &&
            now - p.ts < STALE_HEARTBEAT_TTL_MS
        )
        .map((p) => {
          if (now - p.ts > 22_000) {
            return {
              ...p,
              status: p.id === local.hostId ? 'HOST_AFK' : 'AFK',
            };
          }
          return p;
        });
      local.players = [
        ...others,
        {
          id: this.session.localPlayerId,
          name: this.session.localPlayerName,
          status: localStatus,
          ts: now,
        },
      ];
      local.updatedAtMs = now;
      persistLocalMirrorMap(map);
      if (this.session.accessToken.startsWith('local-')) {
        this.applyAuthoritativeRoster(
          local.players.map((p) => ({
            id: p.id,
            name: p.name,
            status: p.status,
          })),
          local.hostId,
          local.hostName
        );
      }
    }

    if (!this.forceLocalOnly) {
      const sb = getSupabaseClient();
      if (sb && !this.session.accessToken.startsWith('local-')) {
        try {
          const { data, error } = await sb.rpc('mp_heartbeat_room', {
            p_room_code: this.session.roomCode,
            p_access_token: this.session.accessToken,
            p_player_id: this.session.localPlayerId,
            p_player_name: this.session.localPlayerName,
            p_player_status: localStatus,
          });
          const res = data as Record<string, unknown> | null;
          if (!error && res && res.ok) {
            this.applyAuthoritativeRoster(
              mapRawPlayersSummary(res.players_summary),
              res.host_id ? String(res.host_id) : undefined,
              res.host_name ? String(res.host_name) : undefined
            );
          }
        } catch {
          // Silencioso
        }
      }
    }
  }

  disconnect(isUnloading = false): void {
    if (this.disposed) return;
    this.disposed = true;

    activeLocalClientPlayerIds.delete(this.session.localPlayerId);
    for (const timer of this.pendingPresenceLeaveTimers.values()) {
      clearTimeout(timer);
    }
    this.pendingPresenceLeaveTimers.clear();
    this.recentIncomingJoinMs.clear();

    // Transmite imediatamente o aviso de saída antes de fechar os canais!
    this.sendEnvelope({
      t: 'bye',
      id: this.session.localPlayerId,
    });

    this.stopKeepaliveLoop?.();
    this.stopKeepaliveLoop = null;

    if (typeof window !== 'undefined') {
      window.removeEventListener('pagehide', this.boundUnload);
      window.removeEventListener('beforeunload', this.boundUnload);
      window.removeEventListener('online', this.boundWakeUp);
      window.removeEventListener('focus', this.boundWakeUp);
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', this.boundWakeUp);
      }
      if (this.pingIntervalId) clearInterval(this.pingIntervalId);
      if (this.reconnectTimerId) clearTimeout(this.reconnectTimerId);
    }

    try {
      this.localBc?.close();
    } catch {
      // Ignorar
    }
    this.localBc = null;

    const sb = getSupabaseClient();
    if (this.dirWatchChannel) {
      const closingDirCh = this.dirWatchChannel;
      this.dirWatchChannel = null;
      try {
        sb?.removeChannel(closingDirCh);
      } catch {
        // Ignorar
      }
    }

    if (this.channel) {
      const closingCh = this.channel;
      this.channel = null;
      try {
        void closingCh.untrack();
      } catch {
        // Ignorar
      }
      if (isUnloading) {
        try {
          sb?.removeChannel(closingCh);
        } catch {
          // Ignorar
        }
      } else {
        // Aguarda 280ms para que o pacote `{ t: 'bye' }` + `untrack()` chegue aos aliados antes de encerrar o socket!
        setTimeout(() => {
          try {
            sb?.removeChannel(closingCh);
          } catch {
            // Ignorar
          }
        }, 280);
      }
    }

    // Dispara `mp_leave_room` com `keepalive: true` (funciona inclusive ao fechar a aba/navegador ou dar F5!)
    sendLeaveRoomReliable(
      this.session.roomCode,
      this.session.accessToken,
      this.session.localPlayerId,
      this.forceLocalOnly
    );
  }
}
