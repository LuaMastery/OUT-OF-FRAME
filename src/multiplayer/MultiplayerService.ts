import { createClient, RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';

const DEFAULT_SUPABASE_URL = 'https://iypkhqitttifnespoimu.supabase.co';
const DEFAULT_SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml5cGtocWl0dHRpZm5lc3BvaW11Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQxNjIxOTksImV4cCI6MjEwOTczODE5OX0.K8dz2T-oeTPguwFT7X6YVO_rOa78_G528ukq8mD8FBI';

const PLAYER_NAME_STORAGE_KEY = 'oof_mp_player_name_v1';
const PLAYER_SESSION_ID_KEY = 'oof_mp_session_player_id_v1';
const LOCAL_ROOMS_STORAGE_KEY = 'oof_mp_local_rooms_v1';

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
const ROOM_RETENTION_MS = 24 * 60 * 60 * 1000;

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

function getSupabaseClient(): SupabaseClient | null {
  if (typeof fetch === 'undefined') return null;
  if (!sharedSupabase) {
    const url = getEnvString('VITE_SUPABASE_URL', DEFAULT_SUPABASE_URL);
    const key = getEnvString(
      'VITE_SUPABASE_ANON_KEY',
      DEFAULT_SUPABASE_ANON_KEY
    );
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
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(LOCAL_ROOMS_STORAGE_KEY);
      if (raw) {
        const arr = JSON.parse(raw) as LocalMirrorRoomRecord[];
        if (Array.isArray(arr)) {
          for (const item of arr) {
            if (
              now - item.updatedAtMs < ROOM_RETENTION_MS &&
              item.players.length > 0
            ) {
              memoryLocalRooms.set(item.roomCode, item);
            }
          }
        }
      }
    }
  } catch {
    // Ignorar falha de parse
  }

  for (const [code, rec] of memoryLocalRooms.entries()) {
    if (now - rec.updatedAtMs >= ROOM_RETENTION_MS || rec.players.length === 0) {
      memoryLocalRooms.delete(code);
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

            // Registra também no espelho local para abas no mesmo navegador
            const map = loadLocalMirrorMap();
            map.set(roomCode, {
              roomCode,
              roomName: session.roomName,
              hostId: session.hostId,
              hostName: session.hostName,
              isListed: session.isListed,
              hasPassword: session.hasPassword,
              passwordPlain: cleanPassword,
              accessToken,
              maxPlayers: session.maxPlayers,
              players: [
                {
                  id: profile.id,
                  name: profile.name,
                  status: 'HOST',
                  ts: Date.now(),
                },
              ],
              status: 'OPEN',
              region: 'BR-SP',
              updatedAtMs: Date.now(),
            });
            persistLocalMirrorMap(map);

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
      (p) => p.id !== profile.id && now - p.ts < ROOM_RETENTION_MS
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
  private localBc: BroadcastChannel | null = null;
  private stopKeepaliveLoop: (() => void) | null = null;
  private pingIntervalId = 0;
  private reconnectTimerId = 0;
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
      this.disconnect();
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
      },
    });
    this.channel = ch;

    ch.on('broadcast', { event: 'oof_pkt' }, ({ payload }) => {
      this.handleIncomingEnvelope(payload);
    }).subscribe((status) => {
      if (this.disposed || this.channel !== ch) return;
      if (status === 'SUBSCRIBED') {
        this.channelConnected = true;
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

    // 2. Canal global WebSocket Supabase Realtime (com reconexão automática se a rede/aba oscilar)
    this.openRealtimeChannel();

    this.sendEnvelope({
      t: 'hello',
      id: this.session.localPlayerId,
      name: this.session.localPlayerName,
      afk: this.localAfk,
      ts: Date.now(),
    });

    if (typeof window !== 'undefined') {
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
        if (now - this.lastHeartbeatAtMs >= 10_500) {
          this.lastHeartbeatAtMs = now;
          void this.sendRoomHeartbeat();
        }
      }, 3000);

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
        this.ensurePlayerInRoster(id, name);
      }
    } else if (type === 'bye') {
      const id = String(msg.id || '');
      if (id && id !== this.session.localPlayerId) {
        this.currentPlayers = this.currentPlayers.filter((p) => p.id !== id);
        if (this.currentHostId === id && this.currentPlayers.length > 0) {
          this.currentHostId = this.currentPlayers[0].id;
          this.currentHostName = this.currentPlayers[0].name;
        }
        this.callbacks.onRemotePlayerLeft(id);
        this.callbacks.onRosterUpdated(
          this.currentPlayers,
          this.currentHostId,
          this.currentHostName
        );
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

    // Atualiza espelho local (sem remover jogadores inativos — apenas marca AFK após >32s sem pulso)
    const map = loadLocalMirrorMap();
    const local = map.get(this.session.roomCode);
    if (local) {
      const now = Date.now();
      const others = local.players
        .filter(
          (p) =>
            p.id !== this.session.localPlayerId &&
            now - p.ts < ROOM_RETENTION_MS
        )
        .map((p) => {
          if (now - p.ts > 32_000) {
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
            this.currentHostId = String(res.host_id || this.currentHostId);
            this.currentHostName = String(
              res.host_name || this.currentHostName
            );
            this.currentPlayers = mapRawPlayersSummary(res.players_summary);
            this.callbacks.onRosterUpdated(
              this.currentPlayers,
              this.currentHostId,
              this.currentHostName
            );
          }
        } catch {
          // Silencioso
        }
      }
    }
  }

  disconnect(): void {
    if (this.disposed) return;
    this.disposed = true;

    this.sendEnvelope({
      t: 'bye',
      id: this.session.localPlayerId,
    });

    this.stopKeepaliveLoop?.();
    this.stopKeepaliveLoop = null;

    if (typeof window !== 'undefined') {
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

    if (this.channel) {
      const sb = getSupabaseClient();
      sb?.removeChannel(this.channel);
      this.channel = null;
    }

    // Remove do espelho local
    const map = loadLocalMirrorMap();
    const local = map.get(this.session.roomCode);
    if (local) {
      local.players = local.players.filter(
        (p) => p.id !== this.session.localPlayerId
      );
      if (local.players.length === 0) {
        map.delete(this.session.roomCode);
      } else if (local.hostId === this.session.localPlayerId) {
        local.hostId = local.players[0].id;
        local.hostName = local.players[0].name;
      }
      persistLocalMirrorMap(map);
    }

    if (!this.forceLocalOnly && !this.session.accessToken.startsWith('local-')) {
      const sb = getSupabaseClient();
      if (sb) {
        void sb.rpc('mp_leave_room', {
          p_room_code: this.session.roomCode,
          p_access_token: this.session.accessToken,
          p_player_id: this.session.localPlayerId,
        });
      }
    }
  }
}
