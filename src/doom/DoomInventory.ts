import {
  getAvailableShotgunPartIds,
  SHOTGUN_PART_IDS,
  SHOTGUN_ITEM_ID,
} from './DoomShotgun';
import { getInventoryItemIcon } from './DoomInventoryIcons';
import { SoundEngine } from '../engine/audio/SoundEngine';
import {
  CursorProximityFX,
  ProximityTargetRect,
} from '../terminal/CursorProximityFX';

export type InventoryItemKind =
  | 'lantern'
  | 'bandage'
  | 'morphine'
  | 'battery'
  | 'knife'
  | 'flare'
  | 'key'
  | 'radar'
  | 'walkie'
  | 'note'
  | 'shotgun_part'
  | 'shotgun'
  | 'shotgun_ammo'
  | 'taser';

export interface InventoryItemDef {
  id: string;
  kind: InventoryItemKind;
  name: string;
  category: string;
  description: string;
  noteContent?: string;
  keyBadge?: string;
  keyColor?: string;
  stackable: boolean;
  usable: boolean;
  actionLabel?: string;
  droppable?: boolean;
}

export interface InventorySlotEntry {
  def: InventoryItemDef;
  quantity: number;
}

export interface PlayerVitalsSnapshot {
  /** 0..100 */
  health: number;
  /** 0..100 (100 = mente lúcida, 0 = pânico extremo) */
  sanity: number;
  /** 0..100 carga da lanterna */
  battery: number;
  flashlightEquipped: boolean;
  radarActive?: boolean;
  walkieActive?: boolean;
  trappedInWeb: boolean;
  bleeding: boolean;
  crouching: boolean;
  beingChased: boolean;
}

export interface DoomInventoryCallbacks {
  /**
   * Quantidade de peças da shotgun que existem nesta partida (1 a 4).
   * Vem do layout do mundo: solo = 4, co-op = número de jogadores no servidor.
   */
  getShotgunPartSlotCount?: () => number;
  onToggleFlashlightFromUI: () => void;
  onUseHeal: (
    healAmount: number,
    calmAmount: number,
    itemKind: 'bandage' | 'morphine'
  ) => boolean;
  onUseBattery: (chargeAmount: number) => boolean;
  onUseFlare: () => boolean;
  onToggleShotgun?: () => void;
  onToggleTaser?: () => void;
  onUseKnife: () => { cutWeb: boolean };
  onUseKey?: (itemId?: string) => boolean | void;
  onToggleRadar?: () => boolean;
  onToggleWalkieTalkie?: () => boolean;
  onOpenRequest?: () => void;
  onCloseRequest: () => void;
  onOpenPauseRequest?: () => void;
  onPermanentDeathTerminate: () => void;
  /** Botão da tela de vitória: voltar ao terminal. */
  onVictoryExit?: () => void;
  /** Botão da tela de vitória: nova incursão no labirinto. */
  onVictoryRestart?: () => void;
}

/** Textos do catálogo em atributos HTML, inclusive nomes com aspas (ex.: cano de 18"). */
function escapeItemAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Dados mostrados na tela de vitória após destruir a aranha. */
export type VictorySummary = {
  /** Nomes de quem sobreviveu (no solo, apenas o jogador). */
  survivors?: readonly string[];
  totalPlayers?: number;
  everyoneSurvived?: boolean;
  elapsedSeconds?: number;
  shots?: number;
};

/**
 * Monta os textos da tela de vitória (subtítulo, lista de sobreviventes e
 * resumo). Puro, para poder ser verificado sem DOM.
 */
export function formatVictorySummary(info: VictorySummary = {}): {
  sub: string;
  roster: string[];
  stats: string;
  everySurvived: boolean;
} {
  const survivors = [...(info.survivors ?? [])];
  const total = Math.max(survivors.length, info.totalPlayers ?? survivors.length);
  const everySurvived =
    info.everyoneSurvived ?? survivors.length >= total;
  let sub: string;
  if (survivors.length === 0) {
    sub = 'A ameaça foi eliminada.';
  } else if (!everySurvived) {
    sub = `${survivors.length} de ${total} jogadores sobreviveram à incursão.`;
  } else if (survivors.length === 1) {
    sub = 'Você sobreviveu à incursão e eliminou a ameaça.';
  } else {
    sub = `Todos os ${survivors.length} jogadores sobreviveram à incursão.`;
  }
  const stats: string[] = [];
  if (typeof info.elapsedSeconds === 'number' && Number.isFinite(info.elapsedSeconds)) {
    const secs = Math.max(0, Math.floor(info.elapsedSeconds));
    const mm = Math.floor(secs / 60).toString().padStart(2, '0');
    const ss = (secs % 60).toString().padStart(2, '0');
    stats.push(`tempo ${mm}:${ss}`);
  }
  if (typeof info.shots === 'number') stats.push(`${info.shots} cartuchos`);
  return { sub, roster: survivors, stats: stats.join('  ·  '), everySurvived };
}

const TOTAL_SLOTS = 20;
export const QUICK_SLOT_COUNT = 3;

export type ShortcutsHubVisibilityTier =
  | 'hidden'
  | 'unconfigured'
  | 'configured-idle'
  | 'active';

export interface ShortcutsHubStateInput {
  inventoryOpen: boolean;
  gameOver: boolean;
  cinematicHidden: boolean;
  hasConfiguredSlots: boolean;
  isHovered: boolean;
  activeUntilMs: number;
  nowMs: number;
}

export interface ShortcutsHubVisualState {
  tier: ShortcutsHubVisibilityTier;
  opacity: number;
}

/**
 * Calcula a visibilidade/transparência da HUB minimizada de atalhos no centro inferior:
 * - Oculta quando o inventário [Tab], Game Over ou desmaio/sequestro estiver ativo;
 * - Mais transparente (0.34) quando o jogador ainda não configurou atalhos e está ocioso;
 * - Semi-transparente discreta (0.52) quando configurada mas em repouso durante a exploração;
 * - Bem visível e nítida (0.96) assim que o jogador começa a selecionar, rolar, passar o mouse ou acionar!
 */
export function computeShortcutsHubState(
  input: ShortcutsHubStateInput
): ShortcutsHubVisualState {
  if (input.inventoryOpen || input.gameOver || input.cinematicHidden) {
    return { tier: 'hidden', opacity: 0 };
  }
  if (input.isHovered || input.nowMs < input.activeUntilMs) {
    return { tier: 'active', opacity: 0.96 };
  }
  if (input.hasConfiguredSlots) {
    return { tier: 'configured-idle', opacity: 0.52 };
  }
  return { tier: 'unconfigured', opacity: 0.34 };
}

export const ITEM_CATALOG: Record<string, InventoryItemDef> = {
  tactical_lantern: {
    id: 'tactical_lantern',
    kind: 'lantern',
    name: 'Lanterna de bolso',
    category: 'Iluminação',
    description:
      'Corpo cilíndrico de alumínio riscado com foco halógeno curto. Pressione [F] durante a exploração para acender ou guardar.',
    stackable: false,
    usable: true,
    actionLabel: 'Alternar [F]',
    droppable: false,
  },
  sterile_bandage: {
    id: 'sterile_bandage',
    kind: 'bandage',
    name: 'Rolo de gaze',
    category: 'Curativo',
    description:
      'Atadura de algodão grosso ainda limpa. Estanca cortes abertos deixados pelas garras e devolve firmeza ao corpo.',
    stackable: true,
    usable: true,
    actionLabel: 'Enfaixar feridas',
    droppable: true,
  },
  old_morphine: {
    id: 'old_morphine',
    kind: 'morphine',
    name: 'Frasco de láudano',
    category: 'Tônico',
    description:
      'Vidro âmbar pesado deixado por equipes antigas. Ameniza a dor profunda rapidamente, reduz o tremor das mãos e devolve o fôlego.',
    stackable: true,
    usable: true,
    actionLabel: 'Beber dose',
    droppable: true,
  },
  industrial_battery: {
    id: 'industrial_battery',
    kind: 'battery',
    name: 'Bateria seca 9V',
    category: 'Carga elétrica',
    description:
      'Célula industrial blindada com polos de latão. Restaura boa parte da carga da lanterna.',
    stackable: true,
    usable: true,
    actionLabel: 'Trocar bateria',
    droppable: true,
  },
  rusty_knife: {
    id: 'rusty_knife',
    kind: 'knife',
    name: 'Canivete oxidado',
    category: 'Ferramenta',
    description:
      'Lâmina curta marcada de ferrugem, mas ainda afiada. Use pelo atalho rápido [1–3] para sacá-la imediatamente e cortar fios de teia num único golpe.',
    stackable: false,
    usable: true,
    actionLabel: 'Usar lâmina',
    droppable: false,
  },
  magnesium_flare: {
    id: 'magnesium_flare',
    kind: 'flare',
    name: 'Bastão de magnésio',
    category: 'Chama química',
    description:
      'Queima no chão em luz rubra forte por vários segundos. Ilumina a galeria inteira e faz a criatura recuar do calor.',
    stackable: true,
    usable: true,
    actionLabel: 'Riscar e jogar',
    droppable: true,
  },
  sector_b_key: {
    id: 'sector_b_key',
    kind: 'key',
    name: 'Chave de latão — Ala B',
    category: 'Chave antiga',
    description:
      'Chave maciça recolhida entre os blocos úmidos de pedra, com plaqueta gravada da antiga galeria sul.',
    keyBadge: 'ALA-B',
    keyColor: '#e2c16b',
    stackable: false,
    usable: true,
    actionLabel: 'Empunhar chave',
    droppable: false,
  },
  key_computer_room: {
    id: 'key_computer_room',
    kind: 'key',
    name: 'Chave — Sala dos Computadores',
    category: 'Chave de Sala Especial',
    description:
      'Chave codificada do pórtico CPU-01 (Ala Norte). Destranca a porta blindada da Sala dos Computadores ([E] diante do pórtico).',
    keyBadge: 'CPU-01',
    keyColor: '#42d4ff',
    stackable: false,
    usable: true,
    actionLabel: 'Destrancar porta',
    droppable: false,
  },
  key_biology_lab: {
    id: 'key_biology_lab',
    kind: 'key',
    name: 'Chave — Laboratório Biológico',
    category: 'Chave de Sala Especial',
    description:
      'Chave de contenção BIO-02 (Ala Noroeste). Destranca a porta blindada do Laboratório Biológico ([E] diante do pórtico).',
    keyBadge: 'BIO-02',
    keyColor: '#3ef09a',
    stackable: false,
    usable: true,
    actionLabel: 'Destrancar porta',
    droppable: false,
  },
  key_crew_quarters: {
    id: 'key_crew_quarters',
    kind: 'key',
    name: 'Chave — Quartos da Equipe',
    category: 'Chave de Sala Especial',
    description:
      'Chave habitacional HAB-03 (Ala Oeste). Destranca a porta blindada dos Quartos da Equipe ([E] diante do pórtico).',
    keyBadge: 'HAB-03',
    keyColor: '#f4b942',
    stackable: false,
    usable: true,
    actionLabel: 'Destrancar porta',
    droppable: false,
  },
  key_medical_ward: {
    id: 'key_medical_ward',
    kind: 'key',
    name: 'Chave — Enfermaria & Quarentena',
    category: 'Chave de Sala Especial',
    description:
      'Chave clínica MED-04 (Ala Leste). Destranca a porta blindada da Enfermaria & Quarentena ([E] diante do pórtico).',
    keyBadge: 'MED-04',
    keyColor: '#ff5a6e',
    stackable: false,
    usable: true,
    actionLabel: 'Destrancar porta',
    droppable: false,
  },
  key_vegetation_room: {
    id: 'key_vegetation_room',
    kind: 'key',
    name: 'Chave — Sala de Vegetação',
    category: 'Chave de Sala Especial',
    description:
      'Chave botânica ECO-05 (Ala Sul). Destranca a porta blindada da Sala de Vegetação ([E] diante do pórtico).',
    keyBadge: 'ECO-05',
    keyColor: '#6ce85b',
    stackable: false,
    usable: true,
    actionLabel: 'Destrancar porta',
    droppable: false,
  },
  key_library_room: {
    id: 'key_library_room',
    kind: 'key',
    name: 'Chave — Biblioteca & Arquivos',
    category: 'Chave de Sala Especial',
    description:
      'Chave de acervo ARC-06 (Ala Sudeste). Destranca a porta blindada da Biblioteca & Arquivos ([E] diante do pórtico).',
    keyBadge: 'ARC-06',
    keyColor: '#d89c52',
    stackable: false,
    usable: true,
    actionLabel: 'Destrancar porta',
    droppable: false,
  },
  key_reactor_hall: {
    id: 'key_reactor_hall',
    kind: 'key',
    name: 'Chave — Salão dos Reatores',
    category: 'Chave de Sala Especial',
    description:
      'Chave de alta tensão REA-07 (Ala Nordeste). Destranca a porta blindada do Salão dos Reatores ([E] diante do pórtico).',
    keyBadge: 'REA-07',
    keyColor: '#ff9238',
    stackable: false,
    usable: true,
    actionLabel: 'Destrancar porta',
    droppable: false,
  },
  field_radar: {
    id: 'field_radar',
    kind: 'radar',
    name: 'Radar topográfico',
    category: 'Rastreamento',
    description:
      'Unidade portátil EVA de varredura eletromagnética. Exibe o minimapa do complexo subterrâneo, sua localização exata e os pontos prováveis de outros equipamentos. Pressione [M] para ligar/ocultar e [N] para alternar o zoom.',
    stackable: false,
    usable: true,
    actionLabel: 'Alternar [M]',
    droppable: false,
  },
  field_walkie_talkie: {
    id: 'field_walkie_talkie',
    kind: 'walkie',
    name: 'Rádio comunicador VHF',
    category: 'Comunicação',
    description:
      'Transceptor tático VHF de longo alcance. Permite conversar por voz com seus amigos em qualquer distância do complexo e das Salas Especiais, ignorando o bloqueio das paredes. Pressione [R] para ligar ou silenciar o canal.',
    stackable: false,
    usable: true,
    actionLabel: 'Alternar [R]',
    droppable: false,
  },
  field_taser: {
    id: 'field_taser',
    kind: 'taser',
    name: 'Taser de contenção',
    category: 'Equipamento tático',
    description: 'Dispositivo elétrico de curto alcance. Atordoa a aranha por 5 segundos sem causar dano; a bateria recarrega automaticamente em 9 segundos. Não interrompe uma captura em andamento. Pressione [J] para equipar e clique para disparar.',
    stackable: false,
    usable: true,
    actionLabel: 'Equipar [J]',
    droppable: false,
  },
  shotgun_receiver: {
    id: 'shotgun_receiver',
    kind: 'shotgun_part',
    name: 'Corpo da Shotgun',
    category: 'Arma — Peça',
    description:
      'Bloco de aço com o mecanismo de ação de pump, ferrolho e gatilho. Uma das quatro peças da shotgun de combate escondida no complexo.',
    stackable: false,
    usable: true,
    actionLabel: 'Montar shotgun',
    droppable: false,
  },
  shotgun_barrel: {
    id: 'shotgun_barrel',
    kind: 'shotgun_part',
    name: 'Cano da Shotgun 18"',
    category: 'Arma — Peça',
    description:
      'Cano de aço blindado com ponteira de mira. Uma das quatro peças da shotgun de combate escondida no complexo.',
    stackable: false,
    usable: true,
    actionLabel: 'Montar shotgun',
    droppable: false,
  },
  shotgun_pump: {
    id: 'shotgun_pump',
    kind: 'shotgun_part',
    name: 'Bomba da Shotgun',
    category: 'Arma — Peça',
    description:
      'Guarda-mão de polímero que bombeia o cartucho. Uma das quatro peças da shotgun de combate escondida no complexo.',
    stackable: false,
    usable: true,
    actionLabel: 'Montar shotgun',
    droppable: false,
  },
  shotgun_stock: {
    id: 'shotgun_stock',
    kind: 'shotgun_part',
    name: 'Coronha da Shotgun',
    category: 'Arma — Peça',
    description:
      'Coronha de madeira rebaixada com encosto de borracha. Uma das quatro peças da shotgun de combate escondida no complexo.',
    stackable: false,
    usable: true,
    actionLabel: 'Montar shotgun',
    droppable: false,
  },
  combat_shotgun: {
    id: 'combat_shotgun',
    kind: 'shotgun',
    name: 'Shotgun de Combate 12 Gauge',
    category: 'Arma',
    description:
      'Arma montada com as quatro peças do arsenal do laboratório. Pressione [H] para equipar e clique para disparar. Cada tiro consome um cartucho 12 Gauge.',
    stackable: false,
    usable: true,
    actionLabel: 'Equipar [H]',
    droppable: false,
  },
  shotgun_shells: {
    id: 'shotgun_shells',
    kind: 'shotgun_ammo',
    name: 'Cartucho 12 Gauge',
    category: 'Munição',
    description:
      'Estojo de latão com carga de chumbo e pólvora. Sem cartuchos a shotgun é só um cano pesado — cada disparo consome um.',
    stackable: true,
    usable: false,
    droppable: true,
  },
  torn_log_04: {
    id: 'torn_log_04',
    kind: 'note',
    name: 'Folha arrancada #04',
    category: 'Anotação',
    description:
      'Página manchada destacada de um caderno de manutenção no setor norte.',
    noteContent:
      '14/OUT — Não olhe só para o chão. Ela anda devagar pelas vigas do teto e desce pelas paredes sem fazer quase barulho. Estica fios nos vãos escuros para sentir quem passa. Se ouvir o guincho, não pare.',
    stackable: false,
    usable: false,
    droppable: false,
  },
  arachnid_report_09: {
    id: 'arachnid_report_09',
    kind: 'note',
    name: 'Nota de contenção #09',
    category: 'Anotação',
    description:
      'Rascunho apressado encontrado perto das arcadas de alvenaria.',
    noteContent:
      'Andar abaixado no escuro diminui a chance de ela perceber seus passos. O clarão quente do magnésio afasta as patas dela por alguns instantes. Se ela te arrastar para o ninho... saia antes que volte.',
    stackable: false,
    usable: false,
    droppable: false,
  },
};

/**
 * Desenha a radiografia / placa anatômica pixel-art (96x116 -> exibida em 192x232px):
 * Silhueta humana sombria em meio-tom Bayer 2x2, caixa torácica anatômica real
 * envolvendo os pulmões e coração pulsando por trás das costelas.
 */
function renderAnatomyCanvas(
  ctx: CanvasRenderingContext2D,
  vitals: PlayerVitalsSnapshot,
  elapsedSec: number
): void {
  const W = 96;
  const H = 116;

  ctx.fillStyle = '#050506';
  ctx.fillRect(0, 0, W, H);

  const px = (x: number, y: number, col: string) => {
    const ix = Math.round(x);
    const iy = Math.round(y);
    if (ix < 0 || iy < 0 || ix >= W || iy >= H) return;
    ctx.fillStyle = col;
    ctx.fillRect(ix, iy, 1, 1);
  };

  const hp = Math.max(0, Math.min(100, vitals.health));
  const san = Math.max(0, Math.min(100, vitals.sanity));

  const panicShake =
    san < 32 && Math.floor(elapsedSec * 12) % 4 === 0
      ? Math.floor(elapsedSec * 25) % 2 === 0
        ? 1
        : -1
      : 0;
  const cx = 48 + panicShake;

  // Grade radiográfica quase imperceptível ao fundo
  ctx.fillStyle = '#0a0a0c';
  for (let gx = 16; gx < W; gx += 16) ctx.fillRect(gx, 0, 1, H);
  for (let gy = 16; gy < H; gy += 16) ctx.fillRect(0, gy, W, 1);

  // 1. SILHUETA HUMANA EXTERNA (cabeça, pescoço, trapézio, ombros e tronco em pontilhado escuro)
  const silhouetteHalfWidth = (y: number): number => {
    if (y < 6 || y > 110) return 0;
    if (y <= 22) {
      // Crânio superior ovalado
      const ny = (y - 19) / 13.5;
      return Math.sqrt(Math.max(0, 1 - ny * ny)) * 12.2;
    }
    if (y <= 34) {
      // Maçãs do rosto afunilando até o queixo humano (sem bloco quadrado!)
      const t = (y - 22) / 12;
      return 11.5 * (1 - t * 0.58);
    }
    if (y <= 39) {
      // Pescoço
      const t = (y - 34) / 5;
      return 5.8 + t * 1.1;
    }
    if (y <= 47) {
      // Trapézio descendo suavemente até as clavículas
      const t = (y - 39) / 8;
      return 6.9 + Math.pow(t, 1.35) * 16.5;
    }
    if (y <= 58) {
      // Curva arredondada dos deltoides / ombros
      const t = (y - 47) / 11;
      return 23.4 + Math.sin(t * Math.PI * 0.5) * 7.2;
    }
    if (y <= 72) {
      const t = (y - 58) / 14;
      return 30.6 - t * 2.2;
    }
    // Tronco e braços descendo suavemente
    const t = (y - 72) / 38;
    return 28.4 - t * 3.8;
  };

  for (let y = 6; y <= 110; y++) {
    const hw = silhouetteHalfWidth(y);
    if (hw <= 0.5) continue;
    const fadeBottom = y > 96 ? (110 - y) / 14 : 1;
    const minX = Math.ceil(cx - hw);
    const maxX = Math.floor(cx + hw);
    for (let x = minX; x <= maxX; x++) {
      const distEdge = hw - Math.abs(x - cx);
      if (fadeBottom < 0.5 && (x + y) % 2 !== 0) continue;
      if (distEdge < 1.3) {
        px(x, y, '#292621');
      } else if (distEdge < 3.2) {
        px(x, y, (x + y) % 2 === 0 ? '#1b1916' : '#121110');
      } else {
        // Interior escuro de raio-X
        px(x, y, (x + y * 3) % 4 === 0 ? '#121110' : '#0b0b0c');
      }
    }
  }

  const boneBright = '#968d7d';
  const boneLight = '#756d60';
  const boneMid = '#4f4940';
  const boneDark = '#2d2a25';

  // 2. ROSTO SOMBRIO & CRÂNIO EM MEIO-TOM (sutil e humano)
  for (let y = 8; y <= 33; y++) {
    const hw = silhouetteHalfWidth(y) - 1.5;
    if (hw <= 1) continue;
    for (let x = Math.ceil(cx - hw); x <= Math.floor(cx + hw); x++) {
      const dx = x - cx;
      const adx = Math.abs(dx);
      // Arco frontal / têmporas suavemente iluminadas em pontilhado
      if (y <= 16) {
        const crown = 1 - Math.hypot(dx / 10, (y - 13) / 7);
        if (crown > 0.28 && (x + y) % 2 === 0) {
          px(x, y, crown > 0.55 ? boneLight : boneMid);
        }
      } else if (y >= 17 && y <= 21) {
        // Cavidades oculares fundas e sombreadas
        const inEyeSocket = adx >= 2 && adx <= 7;
        if (inEyeSocket) {
          px(x, y, '#060607');
        } else if (adx < 2 && (x + y) % 2 === 0) {
          px(x, y, boneMid); // Dorso nasal
        }
      } else if (y >= 22 && y <= 27) {
        // Maçãs do rosto zigomáticas sutis + sombra nasal central
        if (adx <= 1 && y <= 25) {
          px(x, y, '#070708');
        } else if (adx >= 5 && adx <= 8 && y <= 25 && (x + y) % 2 === 0) {
          px(x, y, boneMid);
        } else if (adx <= 5 && (x + y) % 2 === 0) {
          px(x, y, boneDark);
        }
      } else if (y >= 29 && adx <= 4 && (x + y) % 2 === 0) {
        // Contorno suave do queixo em sombra
        px(x, y, boneDark);
      }
    }
  }

  // Olhar discreto nas órbitas em sombra (contrai/avermelha apenas sob pânico intenso)
  const eyeShift = san < 50 ? Math.round(Math.sin(elapsedSec * 9) * 1) : 0;
  const irisCol = san < 30 ? '#b83b37' : san < 62 ? '#9e8b67' : '#8f8879';
  px(cx - 5 + eyeShift, 19, irisCol);
  px(cx + 5 + eyeShift, 19, irisCol);

  // 3. COLUNA VERTEBRAL AO FUNDO (visível entre as cavidades pulmonares)
  for (let vy = 35; vy <= 98; vy += 3) {
    const shade = vy < 45 || vy > 76 ? boneMid : boneDark;
    px(cx - 1, vy, shade);
    px(cx, vy, vy > 76 ? boneLight : boneMid);
    px(cx + 1, vy, shade);
    px(cx, vy + 1, boneDark);
  }

  // Cavidades pulmonares escuras (dão profundidade real por trás das costelas)
  for (let y = 47; y <= 82; y++) {
    const t = (y - 47) / 35;
    const lungW = Math.sin(t * Math.PI) * 17.5 + 3;
    for (let s = 4; s <= lungW; s++) {
      px(cx - s, y, '#070708');
      px(cx + s, y, '#070708');
    }
  }

  // 4. CORAÇÃO ANATÔMICO (posicionado DENTRO da caixa torácica, atrás das costelas!)
  const bpm = hp < 25 ? 138 : hp < 55 ? 104 : vitals.beingChased ? 122 : 64;
  const cycle = (elapsedSec * (bpm / 60)) % 1;
  const expand = cycle < 0.16 || (cycle > 0.28 && cycle < 0.38) ? 1 : 0;

  const hx = cx + 5;
  const hy = 65;
  const hr = 5.6 + expand * 0.85;

  const heartOuter = hp < 28 ? '#8f1d1b' : hp < 60 ? '#782220' : '#571d1d';
  const heartInner = hp < 28 ? '#cf3e3a' : hp < 60 ? '#a33330' : '#7d2c2a';
  const heartCore = hp < 28 ? '#f0766e' : '#a84b47';

  // Vasos da base / arco aórtico
  px(hx - 1, Math.round(hy - hr - 2), heartOuter);
  px(hx, Math.round(hy - hr - 2), heartInner);
  px(hx - 1, Math.round(hy - hr - 1), heartInner);
  px(hx, Math.round(hy - hr - 1), heartOuter);
  px(hx + 2, Math.round(hy - hr - 1), heartOuter);

  for (let dy = -7; dy <= 8; dy++) {
    for (let dx = -7; dx <= 7; dx++) {
      const nx = (dx + dy * 0.26) / hr;
      const ny = dy / (hr + 1.1);
      const d = nx * nx + ny * ny;
      if (d <= 1.0) {
        if (d < 0.24 && expand > 0) {
          px(hx + dx, hy + dy, heartCore);
        } else if (d < 0.62) {
          px(hx + dx, hy + dy, (dx + dy) % 2 === 0 ? heartInner : heartOuter);
        } else {
          px(hx + dx, hy + dy, heartOuter);
        }
      }
    }
  }

  // 5. CLAVÍCULAS EM "S", ESTERNO E 7 PARES DE COSTELAS CURVADAS SOBRE O PEITO
  for (let dx = 2; dx <= 23; dx++) {
    const f = dx / 23;
    const cyClav = 45 - Math.round(Math.sin(f * Math.PI * 0.85) * 2.2);
    px(cx - dx, cyClav, dx % 2 === 0 ? boneBright : boneLight);
    px(cx + dx, cyClav, dx % 2 === 0 ? boneBright : boneLight);
    px(cx - dx, cyClav + 1, boneDark);
    px(cx + dx, cyClav + 1, boneDark);
  }

  // Manúbrio + corpo do esterno
  for (let sy = 45; sy <= 73; sy++) {
    const halfSt = sy < 50 ? 2 : sy < 69 ? 1.5 : 0.6;
    for (let sx = -Math.floor(halfSt); sx <= Math.floor(halfSt); sx++) {
      px(
        cx + sx,
        sy,
        sx === 0 ? boneBright : (sx + sy) % 2 === 0 ? boneLight : boneMid
      );
    }
  }

  // 7 pares de costelas envolvendo o tórax (passam NA FRENTE do coração, integrando-o ao peito!)
  const ribWidths = [13, 17, 20, 21, 20, 18, 14];
  for (let r = 0; r < ribWidths.length; r++) {
    const maxW = ribWidths[r];
    const backY = 47 + r * 5.4;
    const attachY = r < 5 ? 49 + r * 5.2 : 71 + (r - 5) * 2;

    // Arco costal lateral -> anterior
    for (let s = 2; s <= maxW; s++) {
      const f = s / maxW;
      // Desce na lateral e sobe levemente ao conectar na cartilagem costal do esterno
      const archDrop = Math.sin(f * Math.PI * 0.82) * (3.2 + r * 0.25);
      const yRib = Math.round(
        attachY * (1 - f) + (backY + 2.5) * f + archDrop * 0.55
      );

      // Costelas falsas inferiores (r >= 5) abrem no centro formando o arco subcostal real!
      if (r >= 5 && s < (r - 4) * 4 + 2) continue;

      const cTop = f > 0.25 && f < 0.88 ? boneBright : boneLight;
      px(cx - s, yRib, (s + r) % 2 === 0 ? cTop : boneLight);
      px(cx - s, yRib + 1, boneDark);
      px(cx + s, yRib, (s + r) % 2 === 0 ? cTop : boneLight);
      px(cx + s, yRib + 1, boneDark);
    }
  }

  // Contorno pélvico / ilíaco sutil na base
  for (let dx = 10; dx <= 20; dx++) {
    const py = 97 + Math.round(Math.pow((dx - 15) / 5, 2) * 3);
    if (dx % 2 === 0) {
      px(cx - dx, py, boneMid);
      px(cx + dx, py, boneMid);
    }
  }

  // 6. LACERAÇÕES ORGÂNICAS E MANCHAS DE HEMORRAGIA QUANDO FERIDO
  if (hp < 82 || vitals.bleeding) {
    const woundPts: Array<[number, number]> = [
      [-9, 55],
      [-8, 56],
      [-6, 57],
      [-5, 59],
      [-3, 60],
      [-2, 62],
      [0, 63],
    ];
    const mainBlood = vitals.bleeding ? '#c42b28' : '#852724';
    const deepBlood = '#591615';
    for (const [wx, wy] of woundPts) {
      px(cx + wx, wy, mainBlood);
      px(cx + wx + 1, wy + 1, deepBlood);
    }
    if (hp < 48) {
      const gash2: Array<[number, number]> = [
        [-12, 63],
        [-10, 64],
        [-9, 65],
        [-7, 67],
        [-5, 68],
        [-4, 70],
      ];
      for (const [wx, wy] of gash2) {
        px(cx + wx, wy, '#d63d39');
        px(cx + wx, wy + 1, '#7a1c1a');
      }
    }
    if (vitals.bleeding) {
      const drip = Math.floor(elapsedSec * 3.5) % 5;
      px(cx - 5, 69 + drip, '#bd2825');
      px(cx - 9, 67 + ((drip + 2) % 5), '#96201e');
    }
  }

  // 7. FIOS DE SEDA ORGÂNICOS ENTRECRUZADOS E CABOS DE ANCORAGEM SE PRESO NA TEIA
  if (vitals.trappedInWeb) {
    const drawXRaySilk = (
      x0: number,
      y0: number,
      mx: number,
      my: number,
      x1: number,
      y1: number,
      bright: boolean
    ) => {
      for (let s = 0; s <= 38; s++) {
        const t = s / 38;
        const it = 1 - t;
        const x = Math.round(it * it * x0 + 2 * it * t * mx + t * t * x1);
        const y = Math.round(it * it * y0 + 2 * it * t * my + t * t * y1);
        px(x, y + 1, '#121311');
        px(
          x,
          y,
          s % 7 === 0 ? '#e3e8dc' : bright ? '#b9bfb2' : '#8a9083'
        );
      }
    };

    // Voltas catenárias prendendo ombros, caixa torácica e cintura + fios tensos às bordas
    drawXRaySilk(cx - 29, 49, cx - 2, 60, cx + 29, 53, true);
    drawXRaySilk(cx - 28, 63, cx + 4, 56, cx + 28, 66, false);
    drawXRaySilk(cx - 26, 73, cx, 83, cx + 27, 71, true);
    drawXRaySilk(cx - 24, 86, cx - 3, 93, cx + 25, 84, false);
    // Cabos de ancoragem puxando para as quinas da chapa
    drawXRaySilk(2, 18, 18, 38, cx - 23, 50, false);
    drawXRaySilk(93, 22, 76, 40, cx + 23, 52, false);
    drawXRaySilk(3, 108, 20, 95, cx - 20, 86, false);
    drawXRaySilk(92, 106, 74, 94, cx + 21, 84, false);
  }
}

interface CornerSpokeSpec {
  endX: number;
  endY: number;
  forkAX: number;
  forkAY: number;
  forkBX: number;
  forkBY: number;
  seed: number;
}

/**
 * Desenha a moldura orgânica pixel-art de Teia de Aranha em 1ª pessoa (384x240, escala inteira nítida):
 * - Substitui completamente qualquer gradiente CSS repetitivo por fios de seda reais e assimétricos!
 * - Quatro cantos com mantos fibrosos distintos, raios irregulares bifurcados em "Y", espirais
 *   catenárias curvas sob tensão, nós de seda, gotículas viscosas e cabos periféricos.
 * - No casulo do Ninho (`cocoonAmount > 0`), acrescenta faixas cruzadas densas envolvendo as bordas.
 * - Ao cortar com a faca ou romper a teia (`ripProgress > 0`), os fios se partem do centro para as quinas!
 */
export function renderFirstPersonWebOverlay(
  ctx: CanvasRenderingContext2D,
  snareAmount: number,
  cocoonAmount: number,
  ripProgress: number,
  elapsedSec: number
): void {
  const W = 384;
  const H = 240;
  const img = ctx.createImageData(W, H);
  const data = img.data;

  const strength = Math.max(snareAmount, cocoonAmount);
  if (strength <= 0.005 && ripProgress <= 0) {
    ctx.putImageData(img, 0, 0);
    return;
  }

  const fadeAlpha =
    ripProgress > 0 ? Math.max(0, 1 - Math.pow(ripProgress, 1.35)) : Math.min(1, strength * 1.15);

  const hash = (a: number, b: number): number => {
    const n = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
    return n - Math.floor(n);
  };

  const blendPx = (
    x: number,
    y: number,
    r: number,
    g: number,
    b: number,
    a: number
  ) => {
    const ix = x | 0;
    const iy = y | 0;
    if (ix < 0 || iy < 0 || ix >= W || iy >= H || a <= 0.01) return;
    const idx = (iy * W + ix) * 4;
    const sa = Math.min(1, a * fadeAlpha);
    const da = data[idx + 3] / 255;
    const outA = sa + da * (1 - sa);
    if (outA <= 1e-4) return;
    data[idx] = Math.round((r * sa + data[idx] * da * (1 - sa)) / outA);
    data[idx + 1] = Math.round((g * sa + data[idx + 1] * da * (1 - sa)) / outA);
    data[idx + 2] = Math.round((b * sa + data[idx + 2] * da * (1 - sa)) / outA);
    data[idx + 3] = Math.round(outA * 255);
  };

  // 1. Sombra viscosa sutil APENAS na borda extrema para destacar a seda clara sem esbranquiçar a tela
  const edgeBand = cocoonAmount > 0.2 ? 26 : 16;
  for (let y = 0; y < H; y++) {
    const dyEdge = Math.min(y, H - 1 - y);
    for (let x = 0; x < W; x++) {
      const dxEdge = Math.min(x, W - 1 - x);
      const dMin = Math.min(dxEdge, dyEdge);
      if (dMin < edgeBand) {
        const u = 1 - dMin / edgeBand;
        const cornerBoost =
          dxEdge < 56 && dyEdge < 46
            ? (1 - dxEdge / 56) * (1 - dyEdge / 46) * 0.28
            : 0;
        const vigA = (u * u * 0.26 + cornerBoost) * (0.65 + cocoonAmount * 0.35);
        blendPx(x, y, 12, 13, 11, vigA);
      }
    }
  }

  // Vibração viva de tensão enquanto o jogador força os fios
  const vibAmp = ripProgress > 0 ? 2.4 : 0.75;

  /**
   * Rasteriza um fio orgânico curvo (Bézier quadrática) com sombra 1px, variação fibrosa,
   * gotículas pegajosas e retração física quando cortado pela lâmina (`ripProgress > 0`).
   */
  const drawSilkStrand = (
    x0: number,
    y0: number,
    cx: number,
    cy: number,
    x1: number,
    y1: number,
    thick: boolean,
    alphaMul: number,
    seed: number,
    withDew: boolean,
    recoilFromTip: boolean
  ) => {
    const approxLen =
      Math.hypot(cx - x0, cy - y0) + Math.hypot(x1 - cx, y1 - cy);
    const steps = Math.max(12, Math.ceil(approxLen * 1.35));

    // Ao cortar/romper a teia, a ponta interna se retrai rapidamente de volta à ancoragem!
    const maxT =
      ripProgress > 0 && recoilFromTip
        ? Math.max(0.06, 1 - ripProgress * (0.78 + hash(seed, 3.7) * 0.2))
        : 1.0;

    // Se cortado no meio (cabo de borda a borda), abre fenda assimétrica e os lados caem frouxos!
    const cutCenter = 0.44 + (hash(seed, 7.1) - 0.5) * 0.16;
    const splitCenterGap =
      ripProgress > 0 && !recoilFromTip ? ripProgress * 0.36 : 0;

    const nx = -(y1 - y0) / Math.max(1, approxLen);
    const ny = (x1 - x0) / Math.max(1, approxLen);

    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      if (t > maxT) break;
      if (splitCenterGap > 0 && Math.abs(t - cutCenter) < splitCenterGap) {
        continue;
      }

      const it = 1 - t;
      let px = it * it * x0 + 2 * it * t * cx + t * t * x1;
      let py = it * it * y0 + 2 * it * t * cy + t * t * y1;

      // Micro-ondulação orgânica da fibra + vibração elástica sob esforço
      const midEnv = Math.sin(t * Math.PI);
      const wave =
        Math.sin(t * 15.0 + seed * 5.3) * 0.65 * midEnv +
        Math.sin(elapsedSec * (17 + (seed % 5) * 2) + seed * 4.1) *
          vibAmp *
          midEnv;

      // Ao romper, os fios perdem tensão, caem com a gravidade e chicoteiam enrolados!
      let whip = 0;
      let slackDropY = 0;
      if (ripProgress > 0) {
        if (recoilFromTip) {
          const tipFrac = Math.max(0, (t - (maxT - 0.22)) / 0.22);
          whip = Math.sin(tipFrac * 9.5 + seed) * 3.8 * ripProgress * tipFrac;
          slackDropY = (t / Math.max(0.1, maxT)) ** 2 * 11 * ripProgress;
        } else {
          const armFrac =
            t < cutCenter
              ? t / Math.max(0.06, cutCenter - splitCenterGap)
              : (1 - t) / Math.max(0.06, 1 - (cutCenter + splitCenterGap));
          slackDropY = armFrac * armFrac * 24 * ripProgress;
          whip =
            Math.sin(armFrac * 8.5 + seed * 2.1) *
            4.6 *
            ripProgress *
            armFrac;
        }
      }

      px += nx * (wave + whip);
      py += ny * (wave + whip) + slackDropY;

      const ix = Math.round(px);
      const iy = Math.round(py);

      const fiberNoise = hash(i * 1.7 + seed, seed * 2.9);
      const baseA = alphaMul * (0.76 + fiberNoise * 0.24);

      // Sombra escura de contraste 1px abaixo/direita para leitura nítida sobre qualquer parede/luz
      blendPx(ix + 1, iy + 1, 9, 10, 9, baseA * 0.68);

      // Fibra principal de seda (varia entre osso pálido, cinza-seda e nós brilhantes)
      const lum =
        fiberNoise > 0.86
          ? 234
          : fiberNoise > 0.42
            ? 198
            : 162;
      blendPx(
        ix,
        iy,
        Math.round(lum * 0.98),
        lum,
        Math.round(lum * 0.93),
        baseA
      );

      // Cabos mestres possuem uma segunda fibra trançada sutil
      if (thick && i % 2 === 0) {
        blendPx(
          ix + Math.round(nx),
          iy + Math.round(ny),
          172,
          176,
          165,
          baseA * 0.58
        );
      }

      // Gotículas viscosas reluzentes espaçadas ao longo dos fios de captura
      if (
        withDew &&
        i > 4 &&
        i < steps - 4 &&
        i % 17 === Math.floor((seed * 11) % 13)
      ) {
        blendPx(ix, iy, 246, 250, 238, Math.min(1, baseA * 1.15));
        blendPx(ix - 1, iy, 196, 202, 188, baseA * 0.62);
        blendPx(ix, iy - 1, 212, 218, 204, baseA * 0.62);
      }
    }
  };

  // 2. QUATRO TEIAS ASSIMÉTRICAS DE CANTO (cada canto tem arquitetura e angulação próprias!)
  const corners: Array<{
    ox: number;
    oy: number;
    sx: number;
    sy: number;
    seed: number;
    reachX: number;
    reachY: number;
  }> = [
    { ox: 0, oy: 0, sx: 1, sy: 1, seed: 1.1, reachX: 168, reachY: 118 },
    { ox: W - 1, oy: 0, sx: -1, sy: 1, seed: 4.7, reachX: 158, reachY: 126 },
    { ox: 0, oy: H - 1, sx: 1, sy: -1, seed: 8.3, reachX: 174, reachY: 114 },
    {
      ox: W - 1,
      oy: H - 1,
      sx: -1,
      sy: -1,
      seed: 12.9,
      reachX: 164,
      reachY: 122,
    },
  ];

  const expandCocoon = 1 + cocoonAmount * 0.24;

  for (const c of corners) {
    // A) Pequeno manto fibroso emaranhado no vértice extremo do canto
    for (let m = 0; m < 16; m++) {
      const mx0 = c.ox + c.sx * Math.round(hash(m, c.seed) * 28);
      const my0 = c.oy;
      const mx1 = c.ox;
      const my1 = c.oy + c.sy * Math.round(hash(m + 9, c.seed) * 24);
      drawSilkStrand(
        mx0,
        my0,
        c.ox + c.sx * 6,
        c.oy + c.sy * 6,
        mx1,
        my1,
        false,
        0.58,
        c.seed + m * 0.4,
        false,
        false
      );
    }

    // B) 6 raios mestres irregulares abrindo em leque da quina pelas bordas (deixando o centro limpo!)
    const numSpokes = 6;
    const spokes: CornerSpokeSpec[] = [];
    for (let s = 0; s < numSpokes; s++) {
      const baseFrac = (s + 0.18 + (hash(s * 3.1, c.seed) - 0.5) * 0.22) / numSpokes;
      const ang = baseFrac * (Math.PI * 0.5);
      // Nas diagonais centrais (ang ~ 45°), recua o alcance para manter a mira central limpa!
      const diagHollow = 1 - 0.42 * Math.sin(ang * 2);
      const rx = c.reachX * expandCocoon * diagHollow * (0.88 + hash(s, c.seed + 2) * 0.24);
      const ry = c.reachY * expandCocoon * diagHollow * (0.88 + hash(s + 4, c.seed) * 0.24);

      const endX = c.ox + c.sx * Math.cos(ang) * rx;
      const endY = c.oy + c.sy * Math.sin(ang) * ry;

      // Bifurcação em "Y" no terço externo de cada raio
      const forkStartX = c.ox + (endX - c.ox) * 0.72;
      const forkStartY = c.oy + (endY - c.oy) * 0.72;
      const spreadA = ang - 0.09;
      const spreadB = ang + 0.09;

      spokes.push({
        endX,
        endY,
        forkAX: c.ox + c.sx * Math.cos(spreadA) * rx * 1.06,
        forkAY: c.oy + c.sy * Math.sin(spreadA) * ry * 1.06,
        forkBX: c.ox + c.sx * Math.cos(spreadB) * rx * 1.06,
        forkBY: c.oy + c.sy * Math.sin(spreadB) * ry * 1.06,
        seed: c.seed + s * 1.9,
      });

      const rootX = c.ox + c.sx * (2 + (s % 2) * 3);
      const rootY = c.oy + c.sy * (2 + ((s + 1) % 2) * 3);
      const midX = (rootX + endX) * 0.5 + c.sx * 3;
      const midY = (rootY + endY) * 0.5 + c.sy * 4;

      drawSilkStrand(
        rootX,
        rootY,
        midX,
        midY,
        endX,
        endY,
        s === 1 || s === 4,
        0.9,
        c.seed + s * 2.3,
        true,
        true
      );

      // Ramos bifurcados em "Y"
      drawSilkStrand(
        forkStartX,
        forkStartY,
        (forkStartX + spokes[s].forkAX) * 0.5,
        (forkStartY + spokes[s].forkAY) * 0.5,
        spokes[s].forkAX,
        spokes[s].forkAY,
        false,
        0.66,
        c.seed + s * 3.1,
        false,
        true
      );
      drawSilkStrand(
        forkStartX,
        forkStartY,
        (forkStartX + spokes[s].forkBX) * 0.5,
        (forkStartY + spokes[s].forkBY) * 0.5,
        spokes[s].forkBX,
        spokes[s].forkBY,
        false,
        0.62,
        c.seed + s * 3.7,
        false,
        true
      );
    }

    // C) 5 níveis de arcos catenários curvos ligando cada par de raios vizinhos + fios partidos pendentes
    const ringFracs = [0.2, 0.36, 0.53, 0.71, 0.89];
    for (let s = 0; s < numSpokes - 1; s++) {
      const spA = spokes[s];
      const spB = spokes[s + 1];
      for (let rIdx = 0; rIdx < ringFracs.length; rIdx++) {
        // Deixa algumas aberturas irregulares para parecer teia real de caverna
        if (hash(s * 11 + rIdx * 7, c.seed) > 0.86) continue;

        const fA =
          ringFracs[rIdx] + (hash(s, rIdx + c.seed) - 0.5) * 0.06;
        const fB =
          ringFracs[rIdx] + (hash(s + 1, rIdx + c.seed) - 0.5) * 0.06;

        const ax = c.ox + (spA.endX - c.ox) * fA;
        const ay = c.oy + (spA.endY - c.oy) * fA;
        const bx = c.ox + (spB.endX - c.ox) * fB;
        const by = c.oy + (spB.endY - c.oy) * fB;

        // O ponto de controle curva-se em direção ao canto (tensão radial real da teia!)
        const mx = (ax + bx) * 0.5;
        const my = (ay + by) * 0.5;
        const pullIn = 0.18 + rIdx * 0.025;
        const ctrlX = mx + (c.ox - mx) * pullIn;
        const ctrlY = my + (c.oy - my) * pullIn + 2.5; // leve peso da gravidade

        drawSilkStrand(
          ax,
          ay,
          ctrlX,
          ctrlY,
          bx,
          by,
          false,
          0.78 - rIdx * 0.05,
          c.seed + s * 5 + rIdx * 1.3,
          rIdx >= 2,
          true
        );

        // Pequeno nó de seda esbranquiçado na junção com o raio
        if (ripProgress <= 0.1) {
          blendPx(Math.round(ax), Math.round(ay), 232, 236, 224, 0.82);
        }

        // Ocasionalmente um fio fino rasgado pendendo para baixo (+Y)
        if (rIdx === 3 && hash(s + 3, c.seed * 2) > 0.55) {
          const wx = (ax + bx) * 0.5;
          const wy = (ay + by) * 0.5 + 2;
          drawSilkStrand(
            wx,
            wy,
            wx + c.sx * 2,
            wy + 9,
            wx - c.sx * 1,
            wy + 17,
            false,
            0.52,
            c.seed + s * 9,
            true,
            true
          );
        }
      }
    }
  }

  // 3. CABOS CATENÁRIOS PERIFÉRICOS & SUB-TEIAS INTERLIGANDO AS 4 QUINAS (mantendo o centro livre!)
  const perimeterBridges: Array<
    [number, number, number, number, number, number, boolean, number]
  > = [
    // Pontes catenárias superiores pendentes com peso real
    [42, 0, 188, 30, 344, 0, true, 21.1],
    [98, 0, 198, 18, 294, 0, false, 22.4],
    // Tirantes diagonais curvos conectando as quinas superiores ao dossel (sem linha reta!)
    [0, 58, 66, 36, 152, 0, false, 28.1],
    [232, 0, 314, 38, W - 1, 64, false, 29.3],
    // Cabos inferiores curvos onde peito/braços esbarraram na armadilha
    [34, H - 1, 186, H - 31, 348, H - 1, true, 23.7],
    [96, H - 1, 198, H - 17, 296, H - 1, false, 24.9],
    [0, H - 56, 68, H - 34, 158, H - 1, false, 30.6],
    [228, H - 1, 316, H - 36, W - 1, H - 62, false, 31.8],
    // Fios tensos curvos nas margens esquerda e direita
    [0, 44, 31, 120, 0, 196, true, 26.2],
    [0, 78, 17, 124, 0, 168, false, 26.9],
    [W - 1, 42, W - 32, 118, W - 1, 194, true, 27.5],
    [W - 1, 74, W - 18, 122, W - 1, 166, false, 27.9],
  ];

  for (const [x0, y0, cx, cy, x1, y1, thick, seed] of perimeterBridges) {
    drawSilkStrand(
      x0,
      y0,
      cx,
      cy,
      x1,
      y1,
      thick,
      0.82,
      seed,
      true,
      false
    );
  }

  // Tirantes catenários curtos + fios soltos pendendo do dossel superior e ligando as margens
  for (const tx of [108, 148, 186, 224, 266]) {
    const bridgeY = Math.round(22 - Math.pow((tx - 190) / 128, 2) * 16);
    drawSilkStrand(
      tx + ((tx % 5) - 2) * 4,
      0,
      tx - 2,
      bridgeY * 0.55,
      tx,
      bridgeY,
      false,
      0.66,
      tx * 0.3,
      false,
      true
    );
    if (tx === 148 || tx === 224) {
      drawSilkStrand(
        tx,
        bridgeY,
        tx + 3,
        bridgeY + 8,
        tx - 1,
        bridgeY + 15,
        false,
        0.5,
        tx * 0.7,
        true,
        true
      );
    }
  }

  for (const bx of [118, 166, 214, 262]) {
    const lowY = H - 1 - Math.round(23 - Math.pow((bx - 190) / 132, 2) * 17);
    drawSilkStrand(
      bx + ((bx % 3) - 1) * 5,
      H - 1,
      bx + 2,
      (H - 1 + lowY) * 0.5,
      bx,
      lowY,
      false,
      0.62,
      bx * 0.4,
      false,
      true
    );
  }

  // 4. ENVOLTÓRIO CURVO E ORGÂNICO DE CASULO QUANDO NO NINHO DA ARANHA (sem losango rígido!)
  if (cocoonAmount > 0.04) {
    const cocoonWraps: Array<[number, number, number, number, number, number, number]> = [
      // Arcos profundamente curvos (côncavos em direção às quinas, NUNCA retas de losango!)
      [0, 112, 52, 32, 208, 0, 0.08],
      [172, 0, W - 56, 36, W - 1, 116, 0.18],
      [0, H - 114, 56, H - 34, 218, H - 1, 0.28],
      [166, H - 1, W - 54, H - 36, W - 1, H - 112, 0.38],
      // Arcos catenários pendentes largos envolvendo dossel, peito e laterais
      [18, 0, 186, 56, 362, 0, 0.5],
      [14, H - 1, 196, H - 54, 368, H - 1, 0.62],
      [0, 58, 62, 118, 0, 186, 0.74],
      [W - 1, 54, W - 64, 122, W - 1, 188, 0.84],
    ];

    for (let b = 0; b < cocoonWraps.length; b++) {
      const [x0, y0, cx, cy, x1, y1, threshold] = cocoonWraps[b];
      if (cocoonAmount < threshold) continue;
      const localA = Math.min(1, (cocoonAmount - threshold) / 0.22);
      drawSilkStrand(
        x0,
        y0,
        cx,
        cy,
        x1,
        y1,
        b % 2 === 0,
        0.84 * localA,
        40 + b * 2.7,
        true,
        false
      );
      // Fio orgânico secundário com curvatura distinta (formando feixe trançado irregular, não linha dupla paralela!)
      drawSilkStrand(
        x0,
        Math.min(H - 1, Math.max(0, y0 + (b % 2 === 0 ? 7 : -6))),
        cx + (b % 2 === 0 ? 9 : -8),
        cy + (b < 5 ? 8 : -7),
        x1,
        Math.min(H - 1, Math.max(0, y1 + (b % 2 === 0 ? -5 : 6))),
        false,
        0.54 * localA,
        55 + b * 3.1,
        true,
        false
      );
    }
  }

  ctx.putImageData(img, 0, 0);
}

/**
 * Inventário Tátil de Sobrevivência (Tecla Tab):
 * - Sem cartões de dashboard, sem barras de progresso genéricas e sem rótulos truncados nos slots.
 * - Placa anatômica pixel-art viva + condição qualitativa + grade 4x3 pixel-perfect (2x/3x inteiro).
 */
export class DoomInventory {
  private readonly overlayEl: HTMLElement;
  private readonly diegeticEl: HTMLElement;
  private readonly bloodVignetteEl: HTMLElement;
  private readonly webOverlayCanvas: HTMLCanvasElement;
  private readonly webOverlayCtx: CanvasRenderingContext2D | null;
  private readonly pickupGlintEl: HTMLElement;
  private readonly attackSlashEl: HTMLElement;
  private readonly eyelidTopEl: HTMLElement;
  private readonly eyelidBottomEl: HTMLElement;
  private readonly blackoutVeilEl: HTMLElement;
  private readonly shortcutsHubEl: HTMLElement;
  private readonly hubCaptionEl: HTMLElement;
  private readonly hubBarEl: HTMLElement;
  private readonly gameOverEl: HTMLElement;
  private readonly victoryEl: HTMLElement;
  private isVictory = false;

  private readonly anatomyCanvas: HTMLCanvasElement;
  private readonly anatomyCtx: CanvasRenderingContext2D;
  private readonly healthValEl: HTMLElement;
  private readonly sanityValEl: HTMLElement;
  private readonly proseNoteEl: HTMLElement;
  private readonly afflictionsEl: HTMLElement;
  private readonly lanternStateEl: HTMLElement;
  private readonly lanternCellsEl: HTMLElement;

  private readonly slotCounterEl: HTMLElement;
  private readonly quickRowEl: HTMLElement;
  private readonly gridEl: HTMLElement;
  private readonly examineFigureEl: HTMLElement;
  private readonly examineTitleEl: HTMLElement;
  private readonly examineDescEl: HTMLElement;
  private readonly paperExcerptEl: HTMLElement;
  private readonly feedbackEl: HTMLElement;
  private readonly actionsEl: HTMLElement;

  private readonly proximityFX: CursorProximityFX;
  private readonly keyNavAbort = new AbortController();

  private slots: Array<InventorySlotEntry | null> = new Array(TOTAL_SLOTS).fill(
    null
  );
  private quickSlots: Array<string | null> = new Array(QUICK_SLOT_COUNT).fill(
    null
  );
  private selectedIndex = 0;
  private hoveredIndex: number | null = null;
  private hoveredQuickSlotIndex: number | null = null;
  private hoveredHubQuickIndex: number | null = null;
  private isOpen = false;
  private isGameOver = false;
  private pickupFlashTimer = 0;
  private animRafId = 0;
  private lastPlateTick = -1;

  // Nós DOM persistentes dos 3 atalhos e 12 bolsos (jamais recriados sob o cursor para não disparar mouseenter repetido!)
  private readonly quickSlotEls: HTMLDivElement[] = [];
  private readonly quickSlotSignatures: string[] = new Array(
    QUICK_SLOT_COUNT
  ).fill('');
  private readonly gridSlotEls: HTMLDivElement[] = [];
  private readonly gridSlotSignatures: string[] = new Array(TOTAL_SLOTS).fill(
    ''
  );
  private lastVitalsDomSignature = '';

  // Estado da HUB minimizada de atalhos no centro inferior da tela
  private selectedQuickSlot: number | null = null;
  private wheelSelectionArmed = false;
  private lastWheelSelectAtMs = 0;
  private triggeredHubSlotKey: string | null = null;
  private hubHovered = false;
  private hubActiveUntilMs = 0;
  private hubActiveCaption = '';
  private hubCinematicHidden = false;
  private hubDecayTimerId = 0;
  private hubTriggerTimerId = 0;
  private lastHubRenderSignature = '';
  private userHubIdleOpacity = 0.52;
  private userBloodOverlayScale = 1.0;
  private hubPausedHidden = false;

  private webSnareAmount = 0;
  private webCocoonAmount = 0;
  private webRipStartMs = -1;
  private webRipSnareSnapshot = 0;
  private webRipCocoonSnapshot = 0;
  private lastWebDrawTick = -1;
  private webCanvasCleared = true;

  private latestVitals: PlayerVitalsSnapshot = {
    health: 100,
    sanity: 100,
    battery: 100,
    flashlightEquipped: false,
    trappedInWeb: false,
    bleeding: false,
    crouching: false,
    beingChased: false,
  };

  constructor(
    parentViewport: HTMLElement,
    private readonly sound: SoundEngine,
    private readonly callbacks: DoomInventoryCallbacks
  ) {

    // 1. Camada diegética em tela cheia (invisível na exploração saudável)
    this.diegeticEl = document.createElement('div');
    this.diegeticEl.id = 'doom-diegetic-fx';
    this.diegeticEl.innerHTML = `
      <div class="doom-blood-vignette"></div>
      <canvas class="doom-web-overlay-canvas" width="384" height="240"></canvas>
      <div class="doom-pickup-glint"></div>
      <div class="doom-attack-slash"></div>
      <div class="doom-eyelid-top"></div>
      <div class="doom-eyelid-bottom"></div>
      <div class="doom-blackout-veil"></div>
    `;
    parentViewport.appendChild(this.diegeticEl);

    this.bloodVignetteEl = this.diegeticEl.querySelector(
      '.doom-blood-vignette'
    ) as HTMLElement;
    this.webOverlayCanvas = this.diegeticEl.querySelector(
      '.doom-web-overlay-canvas'
    ) as HTMLCanvasElement;
    this.webOverlayCtx = this.webOverlayCanvas.getContext('2d');
    this.pickupGlintEl = this.diegeticEl.querySelector(
      '.doom-pickup-glint'
    ) as HTMLElement;
    this.attackSlashEl = this.diegeticEl.querySelector(
      '.doom-attack-slash'
    ) as HTMLElement;
    this.eyelidTopEl = this.diegeticEl.querySelector(
      '.doom-eyelid-top'
    ) as HTMLElement;
    this.eyelidBottomEl = this.diegeticEl.querySelector(
      '.doom-eyelid-bottom'
    ) as HTMLElement;
    this.blackoutVeilEl = this.diegeticEl.querySelector(
      '.doom-blackout-veil'
    ) as HTMLElement;

    // 2. Inventário Aberto e Tátil (Tecla Tab)
    this.overlayEl = document.createElement('div');
    this.overlayEl.id = 'doom-inventory-overlay';
    this.overlayEl.innerHTML = `
      <div class="inv-stage" role="dialog" aria-label="Inventário">
        <header class="inv-topbar">
          <span class="inv-topbar-title">INVENTÁRIO</span>
          <div class="inv-topbar-actions">
            <button
              type="button"
              class="inv-pause-btn"
              data-inv-open-pause="1"
              aria-label="Abrir Tela de Pausa"
            >
              <span class="inv-pause-bars" aria-hidden="true"><span></span><span></span></span>
              <span>Menu de Pausa [P]</span>
            </button>
            <button type="button" class="inv-close-btn" data-inv-close="1">[Tab] voltar</button>
          </div>
        </header>

        <div class="inv-layout">
          <aside class="inv-condition-pane">
            <div class="inv-anatomy-plate">
              <canvas class="inv-anatomy-canvas" width="96" height="116"></canvas>
            </div>

            <div class="inv-status-block">
              <div class="inv-status-line">
                <span class="inv-status-key">Corpo</span>
                <span class="inv-status-val" data-health-val>Íntegro</span>
              </div>
              <div class="inv-status-line">
                <span class="inv-status-key">Nervos</span>
                <span class="inv-status-val" data-sanity-val>Firmes</span>
              </div>
              <div class="inv-prose-note" data-prose-note>
                Respiração controlada. Nenhum ferimento grave por enquanto.
              </div>
              <div class="inv-afflictions" data-afflictions></div>

              <div class="inv-lantern-row">
                <div class="inv-lantern-top">
                  <span class="inv-status-key">Lanterna [F]</span>
                  <span class="inv-status-key" data-lantern-state>apagada</span>
                </div>
                <div class="inv-lantern-cells" data-lantern-cells></div>
              </div>
            </div>
          </aside>

          <section class="inv-items-pane">
            <div class="inv-shortcuts-bar">
              <div class="inv-pocket-header">
                <span>Atalhos rápidos [1–3]</span>
                <span class="inv-quick-hint">aperte 1–3 ou clique para atribuir</span>
              </div>
              <div class="inv-quick-row" data-quick-row></div>
            </div>

            <div>
              <div class="inv-pocket-header">
                <span>Bolsos</span>
                <span data-slot-counter>1 / 20</span>
              </div>
              <div class="inv-grid" data-inv-grid style="margin-top: 8px;"></div>
            </div>

            <div class="inv-examine">
              <div class="inv-examine-main">
                <div class="inv-examine-figure" data-examine-figure></div>
                <div class="inv-examine-copy">
                  <div class="inv-examine-title" data-examine-title></div>
                  <div class="inv-examine-desc" data-examine-desc></div>
                  <div class="inv-paper-excerpt" data-paper-excerpt style="display: none;"></div>
                </div>
              </div>
              <div class="inv-examine-footer">
                <span class="inv-feedback" data-feedback></span>
                <div class="inv-actions" data-actions></div>
              </div>
            </div>
          </section>
        </div>
      </div>
    `;
    parentViewport.appendChild(this.overlayEl);

    // 2.5 HUB Minimizada de Atalhos (centro inferior da tela — compacta e semi-transparente em repouso)
    this.shortcutsHubEl = document.createElement('div');
    this.shortcutsHubEl.id = 'doom-shortcuts-hub';
    this.shortcutsHubEl.dataset.hubTier = 'unconfigured';
    this.shortcutsHubEl.innerHTML = `
      <div class="hub-caption" data-hub-caption></div>
      <div class="hub-bar" data-hub-bar role="toolbar" aria-label="Atalhos rápidos"></div>
    `;
    parentViewport.appendChild(this.shortcutsHubEl);

    this.hubCaptionEl = this.shortcutsHubEl.querySelector(
      '[data-hub-caption]'
    ) as HTMLElement;
    this.hubBarEl = this.shortcutsHubEl.querySelector(
      '[data-hub-bar]'
    ) as HTMLElement;

    this.shortcutsHubEl.addEventListener('mouseenter', () => {
      this.hubHovered = true;
      this.syncShortcutsHubVisibility();
    });
    this.shortcutsHubEl.addEventListener('mouseleave', () => {
      this.hubHovered = false;
      this.syncShortcutsHubVisibility();
    });

    // 3. Tela de Morte Permanente
    this.gameOverEl = document.createElement('div');
    this.gameOverEl.id = 'doom-capture-gameover';
    this.gameOverEl.innerHTML = `
      <div class="gameover-title">Você morreu</div>
      <div class="gameover-sub">
        Seu corpo não resistiu ao ataque nas galerias subterrâneas.
      </div>
      <div class="gameover-perm-note">sessão encerrada permanentemente</div>
      <button type="button" class="inv-action-btn" data-terminate-btn="1">[ encerrar ]</button>
    `;
    parentViewport.appendChild(this.gameOverEl);

    // 4. Tela de Vitória (aranha destruída e esquadrão inteiro vivo)
    this.victoryEl = document.createElement('div');
    this.victoryEl.id = 'doom-survivor-victory';
    this.victoryEl.innerHTML = `
      <div class="victory-kicker">setor descontaminado</div>
      <div class="victory-title">A aranha foi destruída</div>
      <div class="victory-sub" data-victory-sub>
        Todos os jogadores sobreviveram à incursão.
      </div>
      <div class="victory-roster" data-victory-roster></div>
      <div class="victory-stats" data-victory-stats></div>
      <div class="victory-actions">
        <button type="button" class="inv-action-btn" data-victory-restart="1">[ nova incursão ]</button>
        <button type="button" class="inv-action-btn victory-exit" data-victory-exit="1">[ voltar ao terminal ]</button>
      </div>
    `;
    parentViewport.appendChild(this.victoryEl);

    this.anatomyCanvas = this.overlayEl.querySelector(
      '.inv-anatomy-canvas'
    ) as HTMLCanvasElement;
    this.anatomyCtx = this.anatomyCanvas.getContext('2d')!;

    this.healthValEl = this.overlayEl.querySelector(
      '[data-health-val]'
    ) as HTMLElement;
    this.sanityValEl = this.overlayEl.querySelector(
      '[data-sanity-val]'
    ) as HTMLElement;
    this.proseNoteEl = this.overlayEl.querySelector(
      '[data-prose-note]'
    ) as HTMLElement;
    this.afflictionsEl = this.overlayEl.querySelector(
      '[data-afflictions]'
    ) as HTMLElement;
    this.lanternStateEl = this.overlayEl.querySelector(
      '[data-lantern-state]'
    ) as HTMLElement;
    this.lanternCellsEl = this.overlayEl.querySelector(
      '[data-lantern-cells]'
    ) as HTMLElement;

    this.slotCounterEl = this.overlayEl.querySelector(
      '[data-slot-counter]'
    ) as HTMLElement;
    this.quickRowEl = this.overlayEl.querySelector(
      '[data-quick-row]'
    ) as HTMLElement;
    this.gridEl = this.overlayEl.querySelector(
      '[data-inv-grid]'
    ) as HTMLElement;
    this.examineFigureEl = this.overlayEl.querySelector(
      '[data-examine-figure]'
    ) as HTMLElement;
    this.examineTitleEl = this.overlayEl.querySelector(
      '[data-examine-title]'
    ) as HTMLElement;
    this.examineDescEl = this.overlayEl.querySelector(
      '[data-examine-desc]'
    ) as HTMLElement;
    this.paperExcerptEl = this.overlayEl.querySelector(
      '[data-paper-excerpt]'
    ) as HTMLElement;
    this.feedbackEl = this.overlayEl.querySelector(
      '[data-feedback]'
    ) as HTMLElement;
    this.actionsEl = this.overlayEl.querySelector(
      '[data-actions]'
    ) as HTMLElement;

    const openPauseBtn = this.overlayEl.querySelector(
      '[data-inv-open-pause]'
    ) as HTMLButtonElement | null;
    openPauseBtn?.addEventListener('mouseenter', () => {
      if (this.isOpen) {
        this.sound.playInventorySelect(false);
      }
    });
    openPauseBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      openPauseBtn.blur?.();
      this.callbacks.onOpenPauseRequest?.();
    });

    const closeInvBtn = this.overlayEl.querySelector(
      '[data-inv-close]'
    ) as HTMLButtonElement | null;
    closeInvBtn?.addEventListener('mouseenter', () => {
      if (this.isOpen) {
        this.sound.playInventorySelect(false);
      }
    });
    closeInvBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      closeInvBtn.blur?.();
      this.callbacks.onCloseRequest();
    });

    this.overlayEl.addEventListener('pointerdown', (e) => {
      if (this.isOpen) {
        e.stopPropagation();
      }
    });

    this.overlayEl.addEventListener(
      'wheel',
      (e) => {
        if (this.isOpen) {
          e.stopPropagation();
        }
      },
      { passive: true }
    );

    this.overlayEl.addEventListener('mousedown', (e) => {
      if (e.target === this.overlayEl) {
        this.callbacks.onCloseRequest();
      }
    });

    this.gameOverEl
      .querySelector('[data-terminate-btn]')
      ?.addEventListener('click', () => {
        this.callbacks.onPermanentDeathTerminate();
      });

    this.victoryEl
      .querySelector('[data-victory-restart]')
      ?.addEventListener('click', () => {
        this.hideVictory();
        this.callbacks.onVictoryRestart?.();
      });
    this.victoryEl
      .querySelector('[data-victory-exit]')
      ?.addEventListener('click', () => {
        this.hideVictory();
        this.callbacks.onVictoryExit?.();
      });

    // Navegação por teclado e atribuição de atalhos [1–3] quando o inventário está aberto
    window.addEventListener(
      'keydown',
      (e) => {
        if (!this.isOpen || this.isGameOver) return;

        // Teclas 1, 2, 3 atribuem o item sob o cursor (ou selecionado) ao atalho rápido correspondente!
        if (
          !e.repeat &&
          (e.code === 'Digit1' ||
            e.code === 'Numpad1' ||
            e.code === 'Digit2' ||
            e.code === 'Numpad2' ||
            e.code === 'Digit3' ||
            e.code === 'Numpad3')
        ) {
          e.preventDefault();
          const quickIdx =
            e.code === 'Digit1' || e.code === 'Numpad1'
              ? 0
              : e.code === 'Digit2' || e.code === 'Numpad2'
                ? 1
                : 2;
          const targetSlot =
            this.hoveredIndex !== null && this.slots[this.hoveredIndex]
              ? this.hoveredIndex
              : this.selectedIndex;
          this.selectedIndex = targetSlot;
          this.toggleQuickSlotForSlot(targetSlot, quickIdx);
          return;
        }

        let nextIdx = this.selectedIndex;
        if (e.code === 'ArrowRight' || e.code === 'KeyD') {
          nextIdx = (this.selectedIndex + 1) % TOTAL_SLOTS;
        } else if (e.code === 'ArrowLeft' || e.code === 'KeyA') {
          nextIdx = (this.selectedIndex + TOTAL_SLOTS - 1) % TOTAL_SLOTS;
        } else if (e.code === 'ArrowDown' || e.code === 'KeyS') {
          nextIdx = (this.selectedIndex + 5) % TOTAL_SLOTS;
        } else if (e.code === 'ArrowUp' || e.code === 'KeyW') {
          nextIdx = (this.selectedIndex + TOTAL_SLOTS - 5) % TOTAL_SLOTS;
        } else if (e.code === 'Enter' || e.code === 'KeyE') {
          e.preventDefault();
          this.useSelectedItem();
          return;
        } else {
          return;
        }
        e.preventDefault();
        this.selectedIndex = nextIdx;
        this.feedbackEl.textContent = '';
        this.sound.playInventorySelect(false);
        this.renderGrid();
        this.renderInspector();
      },
      { signal: this.keyNavAbort.signal }
    );

    this.proximityFX = new CursorProximityFX(
      parentViewport,
      () => this.isOpen || this.isGameOver || this.isVictory,
      () => this.collectInteractiveRects()
    );

    this.initQuickSlotElements();
    this.initGridSlotElements();

    this.addItem('tactical_lantern', 1, true);
    this.renderQuickSlots(true);
    this.renderGrid(true);
    this.renderInspector();
    this.renderVitals(true);
    this.renderShortcutsHub(true);
    this.syncShortcutsHubVisibility();
  }

  private collectInteractiveRects(): ProximityTargetRect[] {
    const rects: ProximityTargetRect[] = [];
    if (this.isGameOver) {
      const btn = this.gameOverEl.querySelector(
        '[data-terminate-btn]'
      ) as HTMLElement | null;
      if (btn) {
        const r = btn.getBoundingClientRect();
        if (r.width > 2) rects.push({ x: r.left, y: r.top, w: r.width, h: r.height });
      }
      return rects;
    }
    if (this.isVictory) {
      this.victoryEl
        .querySelectorAll('.inv-action-btn')
        .forEach((node) => {
          const r = (node as HTMLElement).getBoundingClientRect();
          if (r.width > 2) rects.push({ x: r.left, y: r.top, w: r.width, h: r.height });
        });
      return rects;
    }
    if (!this.isOpen) return rects;

    const nodes = this.overlayEl.querySelectorAll(
      '.inv-quick-slot, .inv-hk-btn, .inv-slot.filled, .inv-action-btn:not(:disabled), .inv-pause-btn, .inv-close-btn'
    );
    nodes.forEach((node) => {
      const el = node as HTMLElement;
      const r = el.getBoundingClientRect();
      if (r.width > 2 && r.height > 2) {
        rects.push({ x: r.left, y: r.top, w: r.width, h: r.height });
      }
    });
    return rects;
  }

  get open(): boolean {
    return this.isOpen;
  }

  get victoryVisible(): boolean {
    return this.isVictory;
  }

  get gameOverVisible(): boolean {
    return this.isGameOver;
  }

  toggle(): boolean {
    if (this.isGameOver) return false;
    this.setOpen(!this.isOpen);
    return this.isOpen;
  }

  setOpen(next: boolean, silent = false): void {
    if (this.isOpen === next) return;
    this.isOpen = next;
    this.hoveredIndex = null;
    this.hoveredQuickSlotIndex = null;
    this.hoveredHubQuickIndex = null;
    this.feedbackEl.textContent = '';
    if (next) {
      this.wheelSelectionArmed = false;
      this.selectedQuickSlot = null;
      this.overlayEl.classList.add('open');
      this.renderVitals(true);
      this.renderQuickSlots(true);
      this.renderGrid(true);
      this.renderInspector();
      this.startAnatomyLoop();
    } else {
      const active =
        typeof document !== 'undefined'
          ? (document.activeElement as HTMLElement | null)
          : null;
      if (active && this.overlayEl.contains?.(active)) {
        active.blur?.();
      }
      this.overlayEl.classList.remove('open');
      this.stopAnatomyLoop();
      if (!silent && this.hasConfiguredShortcuts()) {
        this.wakeShortcutsHub(
          3000,
          'Atalhos configurados · rolinha + clique esq. ou [1–3]'
        );
      }
    }
    this.renderShortcutsHub(true);
    this.syncShortcutsHubVisibility();
    if (!silent) {
      this.sound.playInventoryToggle(next);
    }
  }

  private startAnatomyLoop(): void {
    this.stopAnatomyLoop();
    this.lastPlateTick = -1;
    const step = (now: number) => {
      if (!this.isOpen) return;
      // Atualiza a chapa pixel-art em ~12 quadros/segundo para estética retrô autêntica
      const tick = Math.floor(now / 82);
      if (tick !== this.lastPlateTick) {
        this.lastPlateTick = tick;
        renderAnatomyCanvas(this.anatomyCtx, this.latestVitals, now / 1000);
      }
      this.animRafId = requestAnimationFrame(step);
    };
    this.animRafId = requestAnimationFrame(step);
  }

  private stopAnatomyLoop(): void {
    if (this.animRafId) {
      cancelAnimationFrame(this.animRafId);
      this.animRafId = 0;
    }
  }

  /**
   * Tela de morte permanente. Aceita um texto próprio para o fim de partida
   * cooperativo (o Ninho cheio, em que o esquadrão inteiro é devorado).
   */
  showGameOver(info?: { title?: string; sub?: string; note?: string }): void {
    this.setOpen(false);
    this.isGameOver = true;
    const title = this.gameOverEl.querySelector('.gameover-title');
    if (title) title.textContent = info?.title || 'Você morreu';
    const sub = this.gameOverEl.querySelector('.gameover-sub');
    if (sub) {
      sub.textContent =
        info?.sub || 'Seu corpo não resistiu ao ataque nas galerias subterrâneas.';
    }
    const note = this.gameOverEl.querySelector('.gameover-perm-note');
    if (note) note.textContent = info?.note || 'sessão encerrada permanentemente';
    this.gameOverEl.classList.add('visible');
    this.syncShortcutsHubVisibility();
  }

  hideGameOver(): void {
    this.isGameOver = false;
    this.gameOverEl.classList.remove('visible');
    this.syncShortcutsHubVisibility();
  }

  /**
   * Tela de vitória: aparece somente depois da animação de morte da aranha, com
   * o esquadrão que sobreviveu à incursão.
   */
  showVictory(info: VictorySummary = {}): void {
    this.setOpen(false);
    this.isVictory = true;
    const summary = formatVictorySummary(info);
    const sub = this.victoryEl.querySelector('[data-victory-sub]');
    if (sub) sub.textContent = summary.sub;
    const roster = this.victoryEl.querySelector('[data-victory-roster]');
    if (roster) {
      roster.innerHTML = summary.roster
        .map((name) => `<span class="victory-survivor">${escapeItemAttribute(name)}</span>`)
        .join('');
    }
    const stats = this.victoryEl.querySelector('[data-victory-stats]');
    if (stats) stats.textContent = summary.stats;
    this.victoryEl.classList.add('visible');
    this.syncShortcutsHubVisibility();
  }

  hideVictory(): void {
    this.isVictory = false;
    this.victoryEl.classList.remove('visible');
    this.syncShortcutsHubVisibility();
  }

  setAbductionScreenFX(
    slashOpacity: number,
    eyelidClosed: number,
    blackoutOpacity: number,
    cocoonOpacity: number
  ): void {
    this.attackSlashEl.style.opacity = Math.max(
      0,
      Math.min(1, slashOpacity)
    ).toFixed(3);

    const nextCocoon = Math.max(0, Math.min(1, cocoonOpacity));
    if (
      this.webCocoonAmount > 0.18 &&
      nextCocoon <= 0.02 &&
      this.webSnareAmount <= 0.02 &&
      this.webRipStartMs < 0
    ) {
      this.triggerWebSnapRip();
    }
    this.webCocoonAmount = nextCocoon;
    this.refreshWebOverlayCanvas();

    const lid = Math.max(0, Math.min(1, eyelidClosed));
    const offsetPct = 105 - lid * 105;
    this.eyelidTopEl.style.transform = `translateY(${-offsetPct.toFixed(1)}%)`;
    this.eyelidBottomEl.style.transform = `translateY(${offsetPct.toFixed(1)}%)`;
    this.blackoutVeilEl.style.opacity = Math.max(
      0,
      Math.min(1, blackoutOpacity)
    ).toFixed(3);

    const nextCinematicHidden = lid > 0.08 || blackoutOpacity > 0.08;
    if (nextCinematicHidden !== this.hubCinematicHidden) {
      this.hubCinematicHidden = nextCinematicHidden;
      this.syncShortcutsHubVisibility();
    }
  }

  /**
   * Dispara a animação em 1ª pessoa de fios de seda se partindo e retraindo para as quinas
   * (ao cortar a teia com o canivete [1–3] ou se arrancar da armadilha!).
   */
  triggerWebSnapRip(): void {
    this.webRipSnareSnapshot = Math.max(0.85, this.webSnareAmount);
    this.webRipCocoonSnapshot = this.webCocoonAmount;
    this.webRipStartMs = performance.now();
    this.lastWebDrawTick = -1;
    this.refreshWebOverlayCanvas(true);
  }

  private refreshWebOverlayCanvas(force = false): void {
    const nowMs = performance.now();
    let ripProgress = -1;
    if (this.webRipStartMs >= 0) {
      const elapsedRip = (nowMs - this.webRipStartMs) / 360;
      if (elapsedRip >= 1) {
        this.webRipStartMs = -1;
      } else {
        ripProgress = Math.max(0.01, elapsedRip);
      }
    }

    const activeSnare =
      ripProgress > 0
        ? Math.max(this.webSnareAmount, this.webRipSnareSnapshot)
        : this.webSnareAmount;
    const activeCocoon =
      ripProgress > 0
        ? Math.max(this.webCocoonAmount, this.webRipCocoonSnapshot)
        : this.webCocoonAmount;

    if (activeSnare <= 0.005 && activeCocoon <= 0.005 && ripProgress < 0) {
      if (!this.webCanvasCleared) {
        this.webOverlayCanvas.style.opacity = '0';
        if (this.webOverlayCtx) {
          this.webOverlayCtx.clearRect(
            0,
            0,
            this.webOverlayCanvas.width,
            this.webOverlayCanvas.height
          );
        }
        this.webCanvasCleared = true;
      }
      return;
    }

    this.webOverlayCanvas.style.opacity = '1';
    this.webCanvasCleared = false;

    if (!this.webOverlayCtx) return;

    // ~22 qps durante ruptura e ~16 qps em tensão contínua para estética retrô nítida e leve
    const intervalMs = ripProgress > 0 ? 34 : 62;
    const tick = Math.floor(nowMs / intervalMs);
    if (!force && tick === this.lastWebDrawTick) return;
    this.lastWebDrawTick = tick;

    renderFirstPersonWebOverlay(
      this.webOverlayCtx,
      activeSnare,
      activeCocoon,
      Math.max(0, ripProgress),
      nowMs / 1000
    );
  }

  hasItem(itemId: string): boolean {
    return this.slots.some(
      (s) => s !== null && s.def.id === itemId && s.quantity > 0
    );
  }

  getItemCount(itemId: string): number {
    return this.slots.reduce((sum, slot) => sum + (slot?.def.id === itemId ? slot.quantity : 0), 0);
  }

  getQuickSlots(): readonly (string | null)[] {
    return this.quickSlots;
  }

  getShortcutForItem(itemId: string): number {
    return this.quickSlots.indexOf(itemId);
  }

  hasConfiguredShortcuts(): boolean {
    return this.quickSlots.some((id) => id !== null);
  }

  getSelectedQuickSlot(): number | null {
    return this.selectedQuickSlot;
  }

  /**
   * Acorda temporariamente a HUB minimizada (deixando-a nítida e visível) quando o jogador
   * seleciona, rola a roda do mouse, aciona um atalho ou coleta um equipamento.
   */
  wakeShortcutsHub(durationMs = 3400, caption = ''): void {
    const now = performance.now();
    this.hubActiveUntilMs = Math.max(this.hubActiveUntilMs, now + durationMs);
    if (caption) {
      this.hubActiveCaption = caption;
    }
    this.syncShortcutsHubVisibility();

    if (this.hubDecayTimerId) {
      window.clearTimeout(this.hubDecayTimerId);
    }
    this.hubDecayTimerId = window.setTimeout(() => {
      this.hubDecayTimerId = 0;
      if (!this.hubHovered && performance.now() >= this.hubActiveUntilMs - 16) {
        this.selectedQuickSlot = null;
        this.wheelSelectionArmed = false;
        this.hubActiveCaption = '';
        this.syncHubInteractiveClasses();
      }
      this.syncShortcutsHubVisibility();
    }, durationMs + 40);
  }

  private pulseHubSlotTrigger(slotKey: string): void {
    this.triggeredHubSlotKey = slotKey;
    this.syncHubInteractiveClasses();
    if (this.hubTriggerTimerId) {
      window.clearTimeout(this.hubTriggerTimerId);
    }
    this.hubTriggerTimerId = window.setTimeout(() => {
      this.hubTriggerTimerId = 0;
      this.triggeredHubSlotKey = null;
      this.syncHubInteractiveClasses();
    }, 220);
  }

  /**
   * Atualiza classes de seleção (.selected) e pulso (.triggered) nos botões da HUB
   * em local (sem esvaziar hubBarEl.innerHTML), evitando destruir o elemento sob o cursor!
   */
  private syncHubInteractiveClasses(): void {
    const lanternEl = this.hubBarEl.querySelector('[data-hub-fixed="F"]');
    lanternEl?.classList.toggle('triggered', this.triggeredHubSlotKey === 'F');

    const radarEl = this.hubBarEl.querySelector('[data-hub-fixed="M"]');
    radarEl?.classList.toggle('triggered', this.triggeredHubSlotKey === 'M');

    const quickNodes = this.hubBarEl.querySelectorAll('[data-hub-quick]');
    quickNodes.forEach((node) => {
      const el = node as HTMLElement;
      const q = Number(el.dataset.hubQuick ?? -1);
      el.classList.toggle('selected', this.selectedQuickSlot === q);
      el.classList.toggle('triggered', this.triggeredHubSlotKey === String(q));
    });
  }

  setPauseMenuHidden(hidden: boolean): void {
    if (this.hubPausedHidden === hidden) return;
    this.hubPausedHidden = hidden;
    this.syncShortcutsHubVisibility();
  }

  setUserInterfaceSettings(opts: {
    hubIdleOpacityPercent: number;
    bloodOverlayPercent: number;
  }): void {
    this.userHubIdleOpacity = Math.max(
      0.1,
      Math.min(0.98, opts.hubIdleOpacityPercent / 100)
    );
    this.userBloodOverlayScale = Math.max(
      0.2,
      Math.min(1, opts.bloodOverlayPercent / 100)
    );
    this.syncShortcutsHubVisibility();
  }

  private syncShortcutsHubVisibility(): void {
    const state = computeShortcutsHubState({
      inventoryOpen: this.isOpen || this.hubPausedHidden,
      gameOver: this.isGameOver || this.isVictory,
      cinematicHidden: this.hubCinematicHidden,
      hasConfiguredSlots: this.hasConfiguredShortcuts(),
      isHovered: this.hubHovered,
      activeUntilMs: this.hubActiveUntilMs,
      nowMs: performance.now(),
    });

    this.shortcutsHubEl.dataset.hubTier = state.tier;
    if (state.tier === 'hidden') {
      this.shortcutsHubEl.style.opacity = '';
    } else if (state.tier === 'active') {
      this.shortcutsHubEl.style.opacity = '0.96';
    } else if (state.tier === 'configured-idle') {
      this.shortcutsHubEl.style.opacity = this.userHubIdleOpacity.toFixed(2);
    } else {
      this.shortcutsHubEl.style.opacity = Math.max(
        0.15,
        this.userHubIdleOpacity * 0.72
      ).toFixed(2);
    }

    if (state.tier === 'active' && this.hubActiveCaption) {
      this.hubCaptionEl.textContent = this.hubActiveCaption;
      this.hubCaptionEl.className = 'hub-caption has-text';
    } else if (state.tier === 'unconfigured') {
      this.hubCaptionEl.textContent = '[Tab] configurar atalhos';
      this.hubCaptionEl.className = 'hub-caption has-hint';
    } else {
      this.hubCaptionEl.textContent = '';
      this.hubCaptionEl.className = 'hub-caption';
    }
  }

  /**
   * Seleciona/percorre os atalhos [1]–[3] na HUB inferior (ex.: pela roda do mouse)
   * tornando a HUB imediatamente visível e mostrando o item selecionado sem gastá-lo!
   */
  cycleQuickSlotSelection(direction: 1 | -1): number {
    if (this.selectedQuickSlot === null) {
      this.selectedQuickSlot = direction > 0 ? 0 : QUICK_SLOT_COUNT - 1;
    } else {
      this.selectedQuickSlot =
        (this.selectedQuickSlot + direction + QUICK_SLOT_COUNT) %
        QUICK_SLOT_COUNT;
    }

    const q = this.selectedQuickSlot;
    const itemId = this.quickSlots[q];
    const slotIdx = itemId
      ? this.slots.findIndex((s) => s !== null && s.def.id === itemId)
      : -1;
    const entry = slotIdx >= 0 ? this.slots[slotIdx] : null;

    const caption = entry
      ? `[${q + 1}] ${entry.def.name}${
          entry.quantity > 1 ? ` ×${entry.quantity}` : ''
        } · Clique Esq. p/ usar`
      : `[${q + 1}] Vazio · aperte [Tab] p/ configurar`;

    this.wheelSelectionArmed = true;
    this.lastWheelSelectAtMs = performance.now();
    this.sound.playInventorySelect(false);
    this.renderShortcutsHub();
    this.syncHubInteractiveClasses();
    this.wakeShortcutsHub(6000, caption);
    return q;
  }

  /**
   * Verdadeiro quando o jogador destacou um atalho rápido [1–3] pela rolinha do mouse
   * e pode acioná-lo diretamente clicando com o botão esquerdo!
   */
  hasWheelSelectedQuickSlot(): boolean {
    return this.wheelSelectionArmed && this.selectedQuickSlot !== null;
  }

  /**
   * Verdadeiro nos segundos imediatamente após girar a rolinha do mouse (útil caso Pointer Lock não esteja ativo).
   */
  isWheelSelectionRecent(windowMs = 6000): boolean {
    return (
      this.hasWheelSelectedQuickSlot() &&
      performance.now() - this.lastWheelSelectAtMs <= windowMs
    );
  }

  /**
   * Aciona o atalho [1–3] atualmente destacado pela rolinha do mouse ao clicar com o botão esquerdo,
   * sem precisar apertar as teclas 1, 2 ou 3 no teclado!
   */
  useWheelSelectedQuickSlot(): boolean {
    if (!this.wheelSelectionArmed || this.selectedQuickSlot === null) {
      return false;
    }
    const target = this.selectedQuickSlot;
    const itemId = this.quickSlots[target];
    const def = itemId ? ITEM_CATALOG[itemId] : undefined;
    const isReusableTool = Boolean(
      def &&
        (def.kind === 'knife' ||
          def.kind === 'lantern' ||
          def.kind === 'radar' ||
          def.kind === 'key')
    );

    const activated = this.useQuickSlot(target);

    if (isReusableTool && activated) {
      // Mantém ferramentas reutilizáveis (ex.: canivete) prontas enquanto a HUB estiver acesa
      this.wheelSelectionArmed = true;
      this.selectedQuickSlot = target;
      this.lastWheelSelectAtMs = performance.now();
    } else {
      // Consumíveis (gaze, láudano, sinalizador, bateria) ou slots vazios desarmam após 1 clique para nunca desperdiçar carga!
      this.wheelSelectionArmed = false;
      this.selectedQuickSlot = null;
    }
    this.syncHubInteractiveClasses();
    return activated;
  }

  clearWheelQuickSlotSelection(): void {
    this.wheelSelectionArmed = false;
    this.selectedQuickSlot = null;
    this.hubActiveCaption = '';
    this.syncHubInteractiveClasses();
    this.syncShortcutsHubVisibility();
  }

  /**
   * Usa o atalho atualmente destacado na HUB inferior (tecla [Q]), ou o atalho [1] por padrão.
   */
  useSelectedQuickSlot(): boolean {
    const target = this.selectedQuickSlot ?? 0;
    const activated = this.useQuickSlot(target);
    if (this.wheelSelectionArmed) {
      this.wheelSelectionArmed = false;
      this.selectedQuickSlot = null;
      this.syncHubInteractiveClasses();
    }
    return activated;
  }

  /**
   * Notifica a HUB quando o jogador aciona Lanterna [F] ou Radar [M]/[N], destacando o slot!
   */
  notifyEquipmentShortcutUsed(
    gear: 'lantern' | 'radar' | 'radar_zoom' | 'walkie',
    isActive: boolean
  ): void {
    if (gear === 'lantern') {
      this.pulseHubSlotTrigger('F');
      this.wakeShortcutsHub(
        2600,
        isActive ? '[F] Lanterna acesa' : '[F] Lanterna guardada'
      );
    } else if (gear === 'radar') {
      this.pulseHubSlotTrigger('M');
      this.wakeShortcutsHub(
        2600,
        isActive ? '[M] Radar topográfico ativo · [N] zoom' : '[M] Radar oculto'
      );
    } else if (gear === 'walkie') {
      this.pulseHubSlotTrigger('R');
      this.wakeShortcutsHub(
        2800,
        isActive
          ? '[R] Rádio VHF ligado · Voz a longa distância ativa'
          : '[R] Rádio VHF silenciado · sem voz de rádio'
      );
    } else {
      this.pulseHubSlotTrigger('M');
      this.wakeShortcutsHub(2200, '[N] Escala do radar alternada');
    }
  }

  /**
   * Aviso exibido logo após coletar o Rádio Comunicador VHF:
   * o item fica EQUIPADO, porém o canal de voz de longa distância começa
   * DESLIGADO (o jogador decide quando apertar [R] para ouvir o esquadrão).
   */
  notifyRadioEquipped(): void {
    this.pulseHubSlotTrigger('R');
    this.wakeShortcutsHub(
      3400,
      '[R] Rádio VHF equipado · canal DESLIGADO · aperte [R] para ouvir o esquadrão'
    );
    if (this.feedbackEl) {
      this.feedbackEl.textContent =
        'Rádio Comunicador VHF equipado. O canal de voz está DESLIGADO — aperte [R] para ligar e ouvir seus amigos a longa distância.';
    }
  }

  /**
   * Atribui (ou limpa) um item utilizável a um dos 3 atalhos rápidos [1], [2] ou [3].
   * Caso o item já estivesse em outro atalho, troca de posição de forma limpa sem duplicar.
   */
  assignQuickSlot(quickIndex: number, itemId: string | null): boolean {    if (quickIndex < 0 || quickIndex >= QUICK_SLOT_COUNT) return false;

    if (itemId === null) {
      this.quickSlots[quickIndex] = null;
      if (this.isOpen) {
        this.renderQuickSlots();
        this.renderGrid();
        this.renderInspector();
      }
      this.renderShortcutsHub(true);
      this.syncShortcutsHubVisibility();
      return true;
    }

    const def = ITEM_CATALOG[itemId];
    if (!def || !def.usable || !this.hasItem(itemId)) {
      return false;
    }

    const prevIdx = this.quickSlots.indexOf(itemId);
    if (prevIdx >= 0 && prevIdx !== quickIndex) {
      this.quickSlots[prevIdx] = this.quickSlots[quickIndex];
    }
    this.quickSlots[quickIndex] = itemId;

    if (this.isOpen) {
      this.renderQuickSlots();
      this.renderGrid();
      this.renderInspector();
    }
    this.renderShortcutsHub(true);
    this.syncShortcutsHubVisibility();
    return true;
  }

  toggleQuickSlotForSlot(slotIndex: number, quickIndex: number): boolean {
    const entry = this.slots[slotIndex];
    if (!entry) {
      this.feedbackEl.textContent =
        'Selecione um item nos bolsos antes de definir um atalho.';
      this.sound.invalidInput();
      return false;
    }
    if (!entry.def.usable) {
      this.feedbackEl.textContent =
        'Este objeto não pode ser usado por atalho rápido.';
      this.sound.invalidInput();
      return false;
    }

    if (this.quickSlots[quickIndex] === entry.def.id) {
      this.assignQuickSlot(quickIndex, null);
      this.feedbackEl.textContent = `${entry.def.name} removido do atalho [${quickIndex + 1}].`;
      this.sound.playInventorySelect(true);
      return true;
    }

    this.assignQuickSlot(quickIndex, entry.def.id);
    this.feedbackEl.textContent = `${entry.def.name} atribuído ao atalho [${quickIndex + 1}].`;
    this.sound.playInventorySelect(true);
    return true;
  }

  /**
   * Aciona imediatamente o item vinculado ao atalho [1], [2] ou [3] durante o jogo
   * (sem precisar abrir o Tab!). Ex.: saca o canivete e corta a teia na hora!
   */
  useQuickSlot(quickIndex: number): boolean {
    if (quickIndex < 0 || quickIndex >= QUICK_SLOT_COUNT) return false;
    this.selectedQuickSlot = quickIndex;
    this.pulseHubSlotTrigger(String(quickIndex));

    const itemId = this.quickSlots[quickIndex];
    if (!itemId) {
      this.wakeShortcutsHub(
        2800,
        `[${quickIndex + 1}] Vazio · aperte [Tab] p/ atribuir`
      );
      this.sound.invalidInput();
      return false;
    }

    const slotIdx = this.slots.findIndex(
      (s) => s !== null && s.def.id === itemId && s.quantity > 0
    );
    if (slotIdx < 0) {
      this.quickSlots[quickIndex] = null;
      this.renderShortcutsHub(true);
      this.wakeShortcutsHub(
        2800,
        `[${quickIndex + 1}] Esgotado · aperte [Tab] p/ atribuir`
      );
      this.sound.invalidInput();
      return false;
    }

    const itemName = this.slots[slotIdx]!.def.name;
    const activated = this.activateSlotItem(slotIdx, true);
    this.renderShortcutsHub(true);
    this.wakeShortcutsHub(
      3000,
      activated
        ? `[${quickIndex + 1}] ${itemName}`
        : `[${quickIndex + 1}] ${itemName} · sem efeito agora`
    );
    return activated;
  }

  private autoBindQuickSlotIfAvailable(def: InventoryItemDef): void {
    // Auto-preenche atalhos livres com suprimentos/ferramentas de emergência (faca, gaze, etc.)
    // Lanterna [F] e Radar [M] já possuem seus próprios botões dedicados na HUB!
    if (
      !def.usable ||
      def.kind === 'lantern' ||
      def.kind === 'key' ||
      def.kind === 'radar' ||
      def.kind === 'walkie' ||
      def.kind === 'shotgun_part' ||
      def.kind === 'shotgun' ||
      def.kind === 'taser'
    ) {
      return;
    }
    if (this.quickSlots.includes(def.id)) return;
    const freeQuick = this.quickSlots.findIndex((q) => q === null);
    if (freeQuick >= 0) {
      this.quickSlots[freeQuick] = def.id;
    }
  }

  addItem(itemId: string, amount = 1, silent = false): boolean {
    const def = ITEM_CATALOG[itemId];
    if (!def) return false;

    if (def.stackable) {
      const existingIdx = this.slots.findIndex(
        (s) => s !== null && s.def.id === itemId
      );
      if (existingIdx >= 0) {
        this.slots[existingIdx]!.quantity += amount;
        this.autoBindQuickSlotIfAvailable(def);
        this.renderShortcutsHub(true);
        if (!silent) {
          this.triggerPickupGlint();
          this.sound.playItemPickup();
          const boundIdx = this.getShortcutForItem(def.id);
          if (boundIdx >= 0) {
            this.wakeShortcutsHub(
              3200,
              `[${boundIdx + 1}] ${def.name} ×${this.slots[existingIdx]!.quantity}`
            );
          }
        }
        if (this.isOpen) {
          this.renderQuickSlots();
          this.renderGrid();
          this.renderInspector();
        }
        return true;
      }
    } else if (this.hasItem(itemId)) {
      return false;
    }

    const freeIdx = this.slots.findIndex((s) => s === null);
    if (freeIdx < 0) return false;

    this.slots[freeIdx] = { def, quantity: amount };
    if (this.slots[this.selectedIndex] === null) {
      this.selectedIndex = freeIdx;
    }
    this.autoBindQuickSlotIfAvailable(def);
    this.renderShortcutsHub(true);
    this.syncShortcutsHubVisibility();

    if (!silent) {
      this.triggerPickupGlint();
      this.sound.playItemPickup();
      const boundIdx = this.getShortcutForItem(def.id);
      if (boundIdx >= 0) {
        this.wakeShortcutsHub(
          3400,
          `[${boundIdx + 1}] ${def.name} pronto no atalho`
        );
      } else if (def.kind === 'radar') {
        this.wakeShortcutsHub(3600, '[M] Radar topográfico disponível');
      } else if (def.kind === 'walkie') {
        this.wakeShortcutsHub(
          3800,
          '[R] Rádio VHF sintonizado · Voz a longa distância ativa'
        );
      } else if (def.kind === 'key') {
        this.wakeShortcutsHub(3600, `${def.name} coletada`);
      }
    }
    if (this.isOpen) {
      this.renderQuickSlots();
      this.renderGrid();
      this.renderInspector();
    }
    return true;
  }

  private triggerPickupGlint(): void {
    this.pickupGlintEl.style.opacity = '1';
    if (this.pickupFlashTimer) window.clearTimeout(this.pickupFlashTimer);
    this.pickupFlashTimer = window.setTimeout(() => {
      this.pickupGlintEl.style.opacity = '0';
    }, 260);
  }

  updateVitalsAndDiegeticFX(snapshot: PlayerVitalsSnapshot): void {
    this.latestVitals = { ...snapshot };

    const injuryRatio = Math.max(0, (78 - snapshot.health) / 78);
    const rawBloodOpacity = snapshot.bleeding
      ? Math.min(0.92, 0.32 + injuryRatio * 0.62)
      : injuryRatio > 0.12
        ? injuryRatio * 0.72
        : 0;
    const bloodOpacity = rawBloodOpacity * this.userBloodOverlayScale;
    this.bloodVignetteEl.style.opacity = bloodOpacity.toFixed(3);

    const prevTrapped = this.webSnareAmount > 0.1;
    this.webSnareAmount = snapshot.trappedInWeb ? 0.94 : 0;
    if (prevTrapped && !snapshot.trappedInWeb && this.webRipStartMs < 0) {
      this.triggerWebSnapRip();
    } else {
      this.refreshWebOverlayCanvas();
    }

    this.renderShortcutsHub();
    this.syncShortcutsHubVisibility();

    if (this.isOpen) {
      this.renderVitals();
      this.renderQuickSlots();
      this.renderGrid();
    }
  }

  private renderVitals(force = false): void {
    const v = this.latestVitals;
    const hp = Math.max(0, Math.min(100, v.health));
    const san = Math.max(0, Math.min(100, v.sanity));
    const bat = Math.max(0, Math.min(100, v.battery));
    const litCells = Math.round(bat / 10);
    const lowBattery = bat > 0 && bat <= 22;

    if (force) {
      renderAnatomyCanvas(this.anatomyCtx, v, performance.now() / 1000);
    }

    const hpTier = hp < 26 ? 0 : hp < 52 ? 1 : hp < 82 ? 2 : 3;
    const sanTier = san < 30 ? 0 : san < 62 ? 1 : san < 84 ? 2 : 3;
    const vitalsSig = `${hpTier}|${sanTier}|${litCells}|${lowBattery ? 1 : 0}|${
      bat <= 0.5 ? 0 : v.flashlightEquipped ? 2 : 1
    }|${v.bleeding ? 1 : 0}|${v.trappedInWeb ? 1 : 0}|${v.beingChased ? 1 : 0}`;

    if (!force && vitalsSig === this.lastVitalsDomSignature) return;
    this.lastVitalsDomSignature = vitalsSig;

    // Estado físico (qualitativo, sem "100%" ou barra genérica)
    let hpLabel = 'Íntegro';
    let hpClass = 'inv-status-val';
    let prose = 'Respiração firme. Nenhum ferimento grave por enquanto.';

    if (hp < 26) {
      hpLabel = 'Quase morto';
      hpClass = 'inv-status-val critical';
      prose =
        'A vista escurece a cada passo. Não vou sobreviver a outro ataque.';
    } else if (hp < 52) {
      hpLabel = 'Muito ferido';
      hpClass = 'inv-status-val critical';
      prose =
        'Cortes fundos ardem sob a roupa. Preciso estancar isso com gaze.';
    } else if (hp < 82) {
      hpLabel = 'Machucado';
      hpClass = 'inv-status-val warn';
      prose = 'Escoriações doloridas pelo tronco, mas consigo continuar.';
    }

    this.healthValEl.className = hpClass;
    this.healthValEl.textContent = hpLabel;

    // Estado dos nervos
    let sanLabel = 'Firmes';
    let sanClass = 'inv-status-val';
    if (san < 30) {
      sanLabel = 'Em pânico';
      sanClass = 'inv-status-val critical';
      if (hp >= 52) {
        prose = 'O coração dispara nos ouvidos. Ela está perto demais.';
      }
    } else if (san < 62) {
      sanLabel = 'Abalados';
      sanClass = 'inv-status-val warn';
    } else if (san < 84) {
      sanLabel = 'Tensos';
      sanClass = 'inv-status-val';
    }

    this.sanityValEl.className = sanClass;
    this.sanityValEl.textContent = sanLabel;
    this.proseNoteEl.textContent = prose;

    // Aflições reais — nada de pills decorativas quando saudável!
    const afflictions: string[] = [];
    if (v.bleeding) afflictions.push('• sangramento ativo');
    if (v.trappedInWeb) afflictions.push('• preso em fios de teia');
    if (v.beingChased) afflictions.push('• passos rápidos atrás de você');

    this.afflictionsEl.innerHTML = afflictions
      .map((line) => `<div class="inv-affliction-item">${line}</div>`)
      .join('');

    // Medidor físico de 10 células discretas para a lanterna
    this.lanternStateEl.textContent =
      bat <= 0.5
        ? 'sem carga'
        : v.flashlightEquipped
          ? 'acesa'
          : 'guardada';

    let cellsHtml = '';
    for (let c = 0; c < 10; c++) {
      const isLit = c < litCells;
      cellsHtml += `<div class="inv-cell-seg${isLit ? ' lit' : ''}${
        isLit && lowBattery ? ' low' : ''
      }"></div>`;
    }
    this.lanternCellsEl.innerHTML = cellsHtml;
  }

  /**
   * Cria os 3 elementos de atalho rápido (.inv-quick-slot) UMA ÚNICA VEZ com listeners estáveis,
   * eliminando completamente a recriação de DOM a 60fps que disparava mouseenter em loop!
   */
  private initQuickSlotElements(): void {
    this.quickRowEl.innerHTML = '';
    this.quickSlotEls.length = 0;

    for (let q = 0; q < QUICK_SLOT_COUNT; q++) {
      const cell = document.createElement('div');
      cell.className = 'inv-quick-slot';
      cell.dataset.quickIndex = String(q);

      cell.addEventListener('mouseenter', () => {
        if (this.hoveredQuickSlotIndex === q) return;
        this.hoveredQuickSlotIndex = q;
        this.sound.playInventorySelect(false);
      });

      cell.addEventListener('mouseleave', () => {
        if (this.hoveredQuickSlotIndex === q) {
          this.hoveredQuickSlotIndex = null;
        }
      });

      cell.addEventListener('click', () => {
        const itemId = this.quickSlots[q];
        const slotIdx = itemId
          ? this.slots.findIndex((s) => s !== null && s.def.id === itemId)
          : -1;
        const currentSelected = this.slots[this.selectedIndex];
        if (currentSelected && currentSelected.def.usable) {
          if (this.quickSlots[q] === currentSelected.def.id) {
            this.toggleQuickSlotForSlot(this.selectedIndex, q);
          } else {
            this.assignQuickSlot(q, currentSelected.def.id);
            this.feedbackEl.textContent = `${currentSelected.def.name} atribuído ao atalho [${q + 1}].`;
            this.sound.playInventorySelect(true);
          }
          return;
        }

        if (slotIdx >= 0) {
          this.selectedIndex = slotIdx;
          this.feedbackEl.textContent = '';
          this.sound.playInventorySelect(true);
          this.renderGrid();
          this.renderInspector();
        } else {
          this.feedbackEl.textContent =
            'Selecione um item utilizável nos bolsos para colocar neste atalho.';
          this.sound.invalidInput();
        }
      });

      cell.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        if (this.quickSlots[q] !== null) {
          this.assignQuickSlot(q, null);
          this.feedbackEl.textContent = `Atalho [${q + 1}] limpo.`;
          this.sound.playInventorySelect(true);
        }
      });

      this.quickRowEl.appendChild(cell);
      this.quickSlotEls.push(cell);
    }
  }

  private renderQuickSlots(force = false): void {
    for (let q = 0; q < QUICK_SLOT_COUNT; q++) {
      const cell = this.quickSlotEls[q];
      if (!cell) continue;

      const itemId = this.quickSlots[q];
      const slotIdx = itemId
        ? this.slots.findIndex((s) => s !== null && s.def.id === itemId)
        : -1;
      const entry = slotIdx >= 0 ? this.slots[slotIdx] : null;
      const sig = entry ? `${entry.def.id}:${entry.quantity}` : '-';

      if (!force && this.quickSlotSignatures[q] === sig) continue;
      this.quickSlotSignatures[q] = sig;

      cell.className = `inv-quick-slot${entry ? ' bound' : ''}`;
      if (entry) {
        const iconSrc = getInventoryItemIcon(entry.def);
        cell.title = `[${q + 1}] ${entry.def.name} — clique para vincular item selecionado | botão direito para limpar`;
        cell.innerHTML = `
          <span class="inv-quick-key">[${q + 1}]</span>
          <img class="inv-slot-sprite" src="${iconSrc}" alt="${escapeItemAttribute(entry.def.name)}" />
          ${
            entry.quantity > 1
              ? `<span class="inv-slot-qty">×${entry.quantity}</span>`
              : ''
          }
        `;
      } else {
        cell.title = `Atalho [${q + 1}] vazio — clique para vincular o item selecionado`;
        cell.innerHTML = `
          <span class="inv-quick-key">[${q + 1}]</span>
          <span class="inv-quick-empty-mark">—</span>
        `;
      }
    }
  }

  /**
   * Cria os 12 bolsos (.inv-slot) UMA ÚNICA VEZ com listeners estáveis,
   * garantindo zero disparo fantasma de clique/hover ao passar o mouse!
   */
  private initGridSlotElements(): void {
    this.gridEl.innerHTML = '';
    this.gridSlotEls.length = 0;

    for (let i = 0; i < TOTAL_SLOTS; i++) {
      const slotEl = document.createElement('div');
      slotEl.className = 'inv-slot';

      slotEl.addEventListener('mouseenter', () => {
        if (this.hoveredIndex === i) return;
        this.hoveredIndex = i;
        if (this.slots[i]) {
          this.sound.playInventorySelect(false);
        }
      });

      slotEl.addEventListener('mouseleave', () => {
        if (this.hoveredIndex === i) {
          this.hoveredIndex = null;
        }
      });

      slotEl.addEventListener('click', () => {
        const hasEntry = Boolean(this.slots[i]);
        this.selectedIndex = i;
        this.feedbackEl.textContent = '';
        if (hasEntry) {
          this.sound.playInventorySelect(true);
        }
        this.renderGrid();
        this.renderInspector();
      });

      slotEl.addEventListener('dblclick', () => {
        if (!this.slots[i]) return;
        this.selectedIndex = i;
        this.useSelectedItem();
      });

      this.gridEl.appendChild(slotEl);
      this.gridSlotEls.push(slotEl);
    }
  }

  private renderGrid(force = false): void {
    const occupied = this.slots.filter((s) => s !== null).length;
    const nextCounter = `${occupied} / ${TOTAL_SLOTS}`;
    if (this.slotCounterEl.textContent !== nextCounter) {
      this.slotCounterEl.textContent = nextCounter;
    }

    for (let i = 0; i < TOTAL_SLOTS; i++) {
      const slotEl = this.gridSlotEls[i];
      if (!slotEl) continue;

      const entry = this.slots[i];
      const isSelected = i === this.selectedIndex;
      const showEquipDot = Boolean(
        entry &&
          (entry.def.kind === 'lantern' ||
            entry.def.kind === 'knife' ||
            entry.def.kind === 'radar' ||
            entry.def.kind === 'walkie')
      );
      const dotActive = Boolean(
        entry &&
          ((entry.def.kind === 'lantern' &&
            this.latestVitals.flashlightEquipped) ||
            (entry.def.kind === 'radar' &&
              Boolean(this.latestVitals.radarActive)) ||
            (entry.def.kind === 'walkie' &&
              Boolean(this.latestVitals.walkieActive)) ||
            entry.def.kind === 'knife')
      );
      const boundShortcut = entry ? this.getShortcutForItem(entry.def.id) : -1;

      const sig = entry
        ? `${entry.def.id}|${entry.quantity}|${isSelected ? 1 : 0}|${boundShortcut}|${
            dotActive ? 1 : 0
          }`
        : `empty|${isSelected ? 1 : 0}`;

      if (!force && this.gridSlotSignatures[i] === sig) continue;
      this.gridSlotSignatures[i] = sig;

      slotEl.className = `inv-slot${entry ? ' filled' : ''}${
        isSelected ? ' selected' : ''
      }`;

      if (entry) {
        const iconSrc = getInventoryItemIcon(entry.def);
        slotEl.title =
          boundShortcut >= 0
            ? `${entry.def.name} (Atalho [${boundShortcut + 1}])`
            : entry.def.name;
        slotEl.innerHTML = `
          ${
            showEquipDot
              ? `<span class="inv-slot-equip-dot${dotActive ? ' active' : ''}"></span>`
              : ''
          }
          ${
            boundShortcut >= 0
              ? `<span class="inv-slot-hotkey">[${boundShortcut + 1}]</span>`
              : ''
          }
          <img class="inv-slot-sprite" src="${iconSrc}" alt="${escapeItemAttribute(entry.def.name)}" />
          ${
            entry.def.keyBadge
              ? `<span class="inv-slot-key-tag" style="color: ${entry.def.keyColor ?? '#f2d98d'}; border-color: ${entry.def.keyColor ?? '#f2d98d'}55;">${entry.def.keyBadge}</span>`
              : ''
          }
          ${
            entry.quantity > 1
              ? `<span class="inv-slot-qty">×${entry.quantity}</span>`
              : ''
          }
        `;
      } else {
        slotEl.title = '';
        slotEl.innerHTML = '';
      }
    }
  }

  private renderInspector(): void {
    const entry = this.slots[this.selectedIndex];
    this.actionsEl.innerHTML = '';

    if (!entry) {
      this.examineFigureEl.innerHTML = '';
      this.examineTitleEl.textContent = 'Bolso vazio';
      this.examineDescEl.textContent =
        'Nenhum objeto guardado neste espaço. Vasculhe os cantos das galerias para recolher suprimentos.';
      this.paperExcerptEl.style.display = 'none';
      return;
    }

    const { def } = entry;
    const boundShortcut = this.getShortcutForItem(def.id);
    this.examineFigureEl.innerHTML = `<img src="${getInventoryItemIcon(def)}" alt="${escapeItemAttribute(def.name)}" />`;
    const qtySuffix = entry.quantity > 1 ? `  (×${entry.quantity})` : '';
    const hkSuffix = boundShortcut >= 0 ? `  · [${boundShortcut + 1}]` : '';
    this.examineTitleEl.textContent = `${def.name}${qtySuffix}${hkSuffix}`;
    this.examineDescEl.textContent = def.description;

    if (def.noteContent) {
      this.paperExcerptEl.style.display = 'block';
      this.paperExcerptEl.textContent = def.noteContent;
    } else {
      this.paperExcerptEl.style.display = 'none';
    }

    if (def.usable) {
      // Seletor rápido de atalhos [1] [2] [3] diretamente na inspeção
      const hkWrap = document.createElement('div');
      hkWrap.className = 'inv-shortcut-assign';
      const hkLabel = document.createElement('span');
      hkLabel.className = 'inv-shortcut-label';
      hkLabel.textContent = 'Atalho:';
      hkWrap.appendChild(hkLabel);

      for (let q = 0; q < QUICK_SLOT_COUNT; q++) {
        const hkBtn = document.createElement('button');
        hkBtn.type = 'button';
        hkBtn.className = `inv-hk-btn${boundShortcut === q ? ' active' : ''}`;
        hkBtn.textContent = `[${q + 1}]`;
        hkBtn.title = `Vincular ${def.name} à tecla ${q + 1}`;
        hkBtn.addEventListener('click', () => {
          this.toggleQuickSlotForSlot(this.selectedIndex, q);
        });
        hkWrap.appendChild(hkBtn);
      }
      this.actionsEl.appendChild(hkWrap);

      const useBtn = document.createElement('button');
      useBtn.type = 'button';
      useBtn.className = 'inv-action-btn';
      useBtn.textContent = def.actionLabel ?? 'Usar';
      useBtn.addEventListener('click', () => this.useSelectedItem());
      this.actionsEl.appendChild(useBtn);
    }

    if (def.droppable) {
      const dropBtn = document.createElement('button');
      dropBtn.type = 'button';
      dropBtn.className = 'inv-action-btn muted';
      dropBtn.textContent = 'Largar';
      dropBtn.addEventListener('click', () => {
        this.consumeAt(this.selectedIndex, 1);
        this.feedbackEl.textContent = `${def.name} deixado para trás.`;
        this.sound.playInventorySelect(true);
      });
      this.actionsEl.appendChild(dropBtn);
    }
  }

  /**
   * Peças realmente presentes no mapa desta partida. Em co-op com menos
   * jogadores a arma é montada com as peças que existem no servidor.
   */
  getAvailableShotgunParts(): readonly import('./DoomShotgun').ShotgunPartId[] {
    const slots = this.callbacks.getShotgunPartSlotCount?.() ?? SHOTGUN_PART_IDS.length;
    return getAvailableShotgunPartIds(slots);
  }

  private useSelectedItem(): void {
    this.activateSlotItem(this.selectedIndex, false);
  }

  private activateSlotItem(slotIndex: number, fromQuickShortcut: boolean): boolean {
    const entry = this.slots[slotIndex];
    if (!entry) return false;
    const { def } = entry;

    if (def.kind === 'shotgun_part') {
      const availableParts = this.getAvailableShotgunParts();
      const missing = availableParts.filter(id => !this.hasItem(id));
      if (missing.length) {
        this.feedbackEl.textContent = `Shotgun: ${availableParts.length - missing.length}/${availableParts.length} peças. Procure as peças restantes nas salas especiais.`;
        this.sound.invalidInput();
        return false;
      }
      // Remover todas as peças libera espaço antes de adicionar a arma montada.
      for (const id of availableParts) this.consumeItemById(id);
      this.addItem(SHOTGUN_ITEM_ID, 1, true);
      this.feedbackEl.textContent = 'Shotgun montada! Procure cartuchos e pressione [H] para equipar.';
      this.wakeShortcutsHub(6000, 'SHOTGUN MONTADA · PROCURE CARTUCHOS · [H] EQUIPAR');
      this.sound.playInventorySelect(true);
      this.renderGrid(); this.renderInspector();
      return true;
    }
    if (def.kind === 'taser') {
      if (!fromQuickShortcut) this.callbacks.onCloseRequest();
      this.callbacks.onToggleTaser?.();
      return true;
    }
    if (def.kind === 'shotgun') {
      if (!fromQuickShortcut) this.callbacks.onCloseRequest();
      this.callbacks.onToggleShotgun?.();
      return true;
    }
    if (def.kind === 'lantern') {
      this.callbacks.onToggleFlashlightFromUI();
      if (!fromQuickShortcut) {
        this.feedbackEl.textContent = this.latestVitals.flashlightEquipped
          ? 'Lanterna acesa.'
          : 'Lanterna guardada.';
        this.renderVitals();
        this.renderGrid();
      }
      return true;
    }

    if (def.id === 'rusty_knife') {
      const res = this.callbacks.onUseKnife();
      if (res.cutWeb) {
        this.triggerWebSnapRip();
      }
      if (!fromQuickShortcut) {
        this.feedbackEl.textContent = res.cutWeb
          ? 'Fios de teia cortados!'
          : 'Golpe de lâmina desferido.';
        if (res.cutWeb) {
          this.callbacks.onCloseRequest();
        }
      }
      return true;
    }

    if (def.id === 'sterile_bandage') {
      const used = this.callbacks.onUseHeal(38, 12, 'bandage');
      if (!used) {
        if (!fromQuickShortcut) {
          this.feedbackEl.textContent = 'Não há cortes para enfaixar agora.';
        }
        this.sound.invalidInput();
        return false;
      }
      this.sound.playItemUse('heal');
      this.consumeAt(slotIndex, 1);
      if (!fromQuickShortcut) {
        this.feedbackEl.textContent = 'Ferimentos enfaixados.';
      }
      return true;
    }

    if (def.id === 'old_morphine') {
      const used = this.callbacks.onUseHeal(62, 42, 'morphine');
      if (!used) {
        if (!fromQuickShortcut) {
          this.feedbackEl.textContent = 'Seu corpo já está estável.';
        }
        this.sound.invalidInput();
        return false;
      }
      this.sound.playItemUse('heal');
      this.consumeAt(slotIndex, 1);
      if (!fromQuickShortcut) {
        this.feedbackEl.textContent = 'A dor cedeu.';
      }
      return true;
    }

    if (def.id === 'industrial_battery') {
      const used = this.callbacks.onUseBattery(55);
      if (!used) {
        if (!fromQuickShortcut) {
          this.feedbackEl.textContent = 'A carga da lanterna já está cheia.';
        }
        this.sound.invalidInput();
        return false;
      }
      this.sound.playItemUse('battery');
      this.consumeAt(slotIndex, 1);
      if (!fromQuickShortcut) {
        this.feedbackEl.textContent = 'Bateria substituída.';
      }
      return true;
    }

    if (def.id === 'magnesium_flare') {
      const used = this.callbacks.onUseFlare();
      if (used) {
        this.sound.playItemUse('flare');
        this.consumeAt(slotIndex, 1);
        if (!fromQuickShortcut) {
          this.feedbackEl.textContent = 'Bastão de magnésio aceso no chão.';
        }
        return true;
      }
    }

    if (def.kind === 'key') {
      const unlocked = Boolean(this.callbacks.onUseKey?.(def.id));
      this.sound.playInventorySelect(true);
      if (unlocked) {
        this.consumeAt(slotIndex, 1);
        if (!fromQuickShortcut) {
          this.feedbackEl.textContent = 'Porta da Sala Especial destrancada!';
          this.callbacks.onCloseRequest();
        }
      } else if (!fromQuickShortcut) {
        this.feedbackEl.textContent =
          'Chave empunhada. Aproxime-se da porta blindada correspondente e aperte [E] para destrancar.';
        this.callbacks.onCloseRequest();
      }
      return true;
    }

    if (def.id === 'field_radar') {
      const nowActive = this.callbacks.onToggleRadar?.() ?? false;
      if (!fromQuickShortcut) {
        this.feedbackEl.textContent = nowActive
          ? 'Radar topográfico ligado no canto superior direito.'
          : 'Radar topográfico recolhido.';
        this.renderGrid();
      }
      return true;
    }

    if (def.id === 'field_walkie_talkie') {
      const nowActive = this.callbacks.onToggleWalkieTalkie?.() ?? false;
      if (!fromQuickShortcut) {
        this.feedbackEl.textContent = nowActive
          ? 'Rádio comunicador VHF ligado — transmissão de voz a longa distância ativa.'
          : 'Rádio comunicador VHF silenciado — nenhuma voz de rádio é recebida (só ouve quem estiver por perto).';
        this.renderGrid();
      }
      return true;
    }

    return false;
  }

  /**
   * Renderiza a HUB minimizada de atalhos no centro inferior da tela somente quando seu
   * estado muda, mantendo 60fps liso e cliques/hover responsivos em cada célula.
   */
  private renderShortcutsHub(force = false): void {
    const bat = Math.max(0, Math.min(100, this.latestVitals.battery));
    const litFive = bat <= 0.5 ? 0 : Math.max(1, Math.round(bat / 20));
    const lowBat = bat > 0 && bat <= 22;
    const hasRadar = this.hasItem('field_radar');
    const radarOn = Boolean(this.latestVitals.radarActive);
    const hasWalkie = this.hasItem('field_walkie_talkie');
    const walkieOn = Boolean(this.latestVitals.walkieActive);
    const lanternOn = Boolean(this.latestVitals.flashlightEquipped) && bat > 0.5;

    const quickSigParts: string[] = [];
    for (let q = 0; q < QUICK_SLOT_COUNT; q++) {
      const id = this.quickSlots[q];
      const slotIdx = id
        ? this.slots.findIndex((s) => s !== null && s.def.id === id)
        : -1;
      const qty = slotIdx >= 0 ? this.slots[slotIdx]!.quantity : 0;
      quickSigParts.push(`${id ?? '-'}:${qty}`);
    }

    const sig = `${lanternOn ? 1 : 0}|${litFive}|${lowBat ? 1 : 0}|${
      hasRadar ? 1 : 0
    }|${radarOn ? 1 : 0}|${hasWalkie ? 1 : 0}|${walkieOn ? 1 : 0}|${quickSigParts.join(',')}`;

    if (!force && sig === this.lastHubRenderSignature) {
      this.syncHubInteractiveClasses();
      return;
    }
    this.lastHubRenderSignature = sig;

    this.hubBarEl.innerHTML = '';

    // 1. Atalho fixo [F] Lanterna (sempre presente, com medidor discreto de 5 células na base)
    const lanternCell = document.createElement('div');
    lanternCell.className = `hub-slot fixed-gear${
      this.triggeredHubSlotKey === 'F' ? ' triggered' : ''
    }`;
    lanternCell.dataset.hubFixed = 'F';
    lanternCell.title = `[F] Lanterna de bolso (${lanternOn ? 'acesa' : 'guardada'})`;
    let miniSegs = '';
    for (let c = 0; c < 5; c++) {
      const lit = c < litFive;
      miniSegs += `<span class="hub-mini-seg${lit ? ' lit' : ''}${
        lit && lowBat ? ' low' : ''
      }"></span>`;
    }
    lanternCell.innerHTML = `
      <span class="hub-slot-key">[F]</span>
      <span class="hub-slot-dot${lanternOn ? ' on-amber' : ''}"></span>
      <img class="hub-slot-sprite" src="${getInventoryItemIcon(ITEM_CATALOG.tactical_lantern)}" alt="Lanterna" />
      <div class="hub-mini-cells">${miniSegs}</div>
    `;
    lanternCell.addEventListener('mouseenter', () => {
      this.wakeShortcutsHub(
        2600,
        `[F] Lanterna de bolso · ${lanternOn ? 'acesa' : 'guardada'}`
      );
    });
    lanternCell.addEventListener('click', (e) => {
      e.stopPropagation();
      this.callbacks.onToggleFlashlightFromUI();
      this.notifyEquipmentShortcutUsed(
        'lantern',
        this.latestVitals.flashlightEquipped
      );
    });
    this.hubBarEl.appendChild(lanternCell);

    // 2. Atalho fixo [M] Radar Topográfico (exibido assim que coletado no complexo)
    if (hasRadar) {
      const radarCell = document.createElement('div');
      radarCell.className = `hub-slot fixed-gear${
        this.triggeredHubSlotKey === 'M' ? ' triggered' : ''
      }`;
      radarCell.dataset.hubFixed = 'M';
      radarCell.title = `[M] Radar topográfico (${
        radarOn ? 'ativo · [N] zoom' : 'oculto'
      })`;
      radarCell.innerHTML = `
        <span class="hub-slot-key">[M]</span>
        <span class="hub-slot-dot${radarOn ? ' on-green' : ''}"></span>
        <img class="hub-slot-sprite" src="${getInventoryItemIcon(ITEM_CATALOG.field_radar)}" alt="Radar" />
        ${radarOn ? `<span class="hub-slot-subkey">[N]</span>` : ''}
      `;
      radarCell.addEventListener('mouseenter', () => {
        this.wakeShortcutsHub(
          2600,
          radarOn
            ? '[M] Radar topográfico · [N] alternar zoom'
            : '[M] Radar topográfico · desligado'
        );
      });
      radarCell.addEventListener('click', (e) => {
        e.stopPropagation();
        const nextActive = this.callbacks.onToggleRadar?.() ?? false;
        this.notifyEquipmentShortcutUsed('radar', nextActive);
      });
      this.hubBarEl.appendChild(radarCell);
    }

    // 2b. Atalho fixo [R] Rádio Comunicador VHF (exibido assim que coletado no complexo)
    if (hasWalkie) {
      const walkieCell = document.createElement('div');
      walkieCell.className = `hub-slot fixed-gear${
        this.triggeredHubSlotKey === 'R' ? ' triggered' : ''
      }`;
      walkieCell.dataset.hubFixed = 'R';
      walkieCell.title = `[R] Rádio comunicador VHF (${
        walkieOn ? 'ativo · voz a longa distância' : 'silenciado'
      })`;
      walkieCell.innerHTML = `
        <span class="hub-slot-key">[R]</span>
        <span class="hub-slot-dot${walkieOn ? ' on-green' : ''}"></span>
        <img class="hub-slot-sprite" src="${getInventoryItemIcon(ITEM_CATALOG.field_walkie_talkie)}" alt="Rádio VHF" />
      `;
      walkieCell.addEventListener('mouseenter', () => {
        this.wakeShortcutsHub(
          2600,
          walkieOn
            ? '[R] Rádio VHF · Voz a longa distância ativa'
            : '[R] Rádio VHF · silenciado'
        );
      });
      walkieCell.addEventListener('click', (e) => {
        e.stopPropagation();
        const nextActive = this.callbacks.onToggleWalkieTalkie?.() ?? false;
        this.notifyEquipmentShortcutUsed('walkie', nextActive);
      });
      this.hubBarEl.appendChild(walkieCell);
    }

    // Separador vertical tático entre equipamentos fixos e atalhos configuráveis [1–3]
    const sep = document.createElement('div');
    sep.className = 'hub-sep';
    this.hubBarEl.appendChild(sep);

    // 3. Atalhos rápidos configuráveis [1], [2], [3]
    for (let q = 0; q < QUICK_SLOT_COUNT; q++) {
      const itemId = this.quickSlots[q];
      const slotIdx = itemId
        ? this.slots.findIndex((s) => s !== null && s.def.id === itemId)
        : -1;
      const entry = slotIdx >= 0 ? this.slots[slotIdx] : null;
      const isSelected = this.selectedQuickSlot === q;
      const isTriggered = this.triggeredHubSlotKey === String(q);

      const cell = document.createElement('div');
      cell.className = `hub-slot${entry ? ' bound' : ''}${
        isSelected ? ' selected' : ''
      }${isTriggered ? ' triggered' : ''}`;
      cell.dataset.hubQuick = String(q);

      if (entry) {
        const iconSrc = getInventoryItemIcon(entry.def);
        cell.title = `[${q + 1}] ${entry.def.name} — aperte ${q + 1} ou clique para usar`;
        cell.innerHTML = `
          <span class="hub-slot-key">[${q + 1}]</span>
          <img class="hub-slot-sprite" src="${iconSrc}" alt="${escapeItemAttribute(entry.def.name)}" />
          ${
            entry.quantity > 1
              ? `<span class="hub-slot-qty">×${entry.quantity}</span>`
              : ''
          }
        `;
      } else {
        cell.title = `Atalho [${q + 1}] vazio — abra [Tab] para atribuir`;
        cell.innerHTML = `
          <span class="hub-slot-key">[${q + 1}]</span>
          <span class="hub-slot-empty">—</span>
        `;
      }

      cell.addEventListener('mouseenter', () => {
        if (this.hoveredHubQuickIndex === q) return;
        this.hoveredHubQuickIndex = q;
        this.selectedQuickSlot = q;
        this.syncHubInteractiveClasses();
        this.wakeShortcutsHub(
          3000,
          entry
            ? `[${q + 1}] ${entry.def.name}${
                entry.quantity > 1 ? ` ×${entry.quantity}` : ''
              }`
            : `[${q + 1}] Vazio · aperte [Tab] p/ configurar`
        );
      });

      cell.addEventListener('mouseleave', () => {
        if (this.hoveredHubQuickIndex === q) {
          this.hoveredHubQuickIndex = null;
        }
      });

      cell.addEventListener('click', (e) => {
        e.stopPropagation();
        if (entry) {
          this.useQuickSlot(q);
        } else {
          this.callbacks.onOpenRequest?.();
        }
      });

      this.hubBarEl.appendChild(cell);
    }

    // 4. Botão compacto [Tab] na lateral direita para abrir configuração rapidamente
    const tabBtn = document.createElement('button');
    tabBtn.type = 'button';
    tabBtn.className = 'hub-tab-btn';
    tabBtn.title = 'Abrir inventário e configurar atalhos [Tab]';
    tabBtn.innerHTML = `<span>[Tab]</span><span>bolsos</span>`;
    tabBtn.addEventListener('mouseenter', () => {
      this.wakeShortcutsHub(2600, '[Tab] Abrir bolsos e configurar atalhos [1–3]');
    });
    tabBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.callbacks.onOpenRequest?.();
    });
    this.hubBarEl.appendChild(tabBtn);
  }

  consumeItemById(itemId: string, count = 1): boolean {
    const idx = this.slots.findIndex(
      (s) => s !== null && s.def.id === itemId && s.quantity >= count
    );
    if (idx < 0) return false;
    this.consumeAt(idx, count);
    return true;
  }

  private consumeAt(slotIndex: number, count: number): void {
    const entry = this.slots[slotIndex];
    if (!entry) return;
    const itemId = entry.def.id;
    entry.quantity -= count;
    if (entry.quantity <= 0) {
      this.slots[slotIndex] = null;
      if (!this.hasItem(itemId)) {
        for (let q = 0; q < QUICK_SLOT_COUNT; q++) {
          if (this.quickSlots[q] === itemId) {
            this.quickSlots[q] = null;
          }
        }
      }
      const nextFilled = this.slots.findIndex((s) => s !== null);
      if (nextFilled >= 0) this.selectedIndex = nextFilled;
    }
    this.renderQuickSlots();
    this.renderGrid();
    this.renderInspector();
    this.renderVitals();
    this.renderShortcutsHub(true);
    this.syncShortcutsHubVisibility();
  }

  destroy(): void {
    this.stopAnatomyLoop();
    if (this.pickupFlashTimer) window.clearTimeout(this.pickupFlashTimer);
    if (this.hubDecayTimerId) window.clearTimeout(this.hubDecayTimerId);
    if (this.hubTriggerTimerId) window.clearTimeout(this.hubTriggerTimerId);
    this.keyNavAbort.abort();
    this.proximityFX.destroy();
    this.overlayEl.remove();
    this.shortcutsHubEl.remove();
    this.diegeticEl.remove();
    this.gameOverEl.remove();
    this.victoryEl.remove();
  }
}
