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
  | 'note';

export interface InventoryItemDef {
  id: string;
  kind: InventoryItemKind;
  name: string;
  category: string;
  description: string;
  noteContent?: string;
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
  trappedInWeb: boolean;
  bleeding: boolean;
  crouching: boolean;
  beingChased: boolean;
}

export interface DoomInventoryCallbacks {
  onToggleFlashlightFromUI: () => void;
  onUseHeal: (
    healAmount: number,
    calmAmount: number,
    itemKind: 'bandage' | 'morphine'
  ) => boolean;
  onUseBattery: (chargeAmount: number) => boolean;
  onUseFlare: () => boolean;
  onUseKnife: () => { cutWeb: boolean };
  onCloseRequest: () => void;
  onPermanentDeathTerminate: () => void;
}

const TOTAL_SLOTS = 12;
export const QUICK_SLOT_COUNT = 3;

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
      'Vidro âmbar pesado deixado por equipes antigas. Ameniza a dor profunda rapidamente e reduz o tremor das mãos.',
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
    stackable: false,
    usable: false,
    droppable: false,
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
 * Adiciona contorno pixel-art 1px ao redor de qualquer pixel opaco para acabamento autêntico de sprite.
 */
function applyPixelOutline(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  outlineHex: [number, number, number]
): void {
  const img = ctx.getImageData(0, 0, w, h);
  const src = new Uint8ClampedArray(img.data);
  const dst = img.data;

  const isSolid = (x: number, y: number): boolean => {
    if (x < 0 || y < 0 || x >= w || y >= h) return false;
    return src[(y * w + x) * 4 + 3] > 0;
  };

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (isSolid(x, y)) continue;
      if (
        isSolid(x - 1, y) ||
        isSolid(x + 1, y) ||
        isSolid(x, y - 1) ||
        isSolid(x, y + 1)
      ) {
        const idx = (y * w + x) * 4;
        dst[idx] = outlineHex[0];
        dst[idx + 1] = outlineHex[1];
        dst[idx + 2] = outlineHex[2];
        dst[idx + 3] = 255;
      }
    }
  }

  ctx.putImageData(img, 0, 0);
}

/**
 * Desenha sprites pixel-art 32x32 detalhados à mão (com sombreamento Bayer, chanfros e contorno 1px).
 */
function buildItemIcons(): Record<InventoryItemKind, string> {
  const kinds: InventoryItemKind[] = [
    'lantern',
    'bandage',
    'morphine',
    'battery',
    'knife',
    'flare',
    'key',
    'note',
  ];

  const out = {} as Record<InventoryItemKind, string>;

  for (const kind of kinds) {
    const c = document.createElement('canvas');
    c.width = 32;
    c.height = 32;
    const ctx = c.getContext('2d')!;
    ctx.clearRect(0, 0, 32, 32);

    const px = (x: number, y: number, col: string) => {
      ctx.fillStyle = col;
      ctx.fillRect(x, y, 1, 1);
    };
    const box = (x: number, y: number, w: number, h: number, col: string) => {
      ctx.fillStyle = col;
      ctx.fillRect(x, y, w, h);
    };
    const line = (
      x0: number,
      y0: number,
      x1: number,
      y1: number,
      col: string
    ) => {
      let cx = x0;
      let cy = y0;
      const dx = Math.abs(x1 - x0);
      const dy = Math.abs(y1 - y0);
      const sx = x0 < x1 ? 1 : -1;
      const sy = y0 < y1 ? 1 : -1;
      let err = dx - dy;
      for (;;) {
        px(cx, cy, col);
        if (cx === x1 && cy === y1) break;
        const e2 = 2 * err;
        if (e2 > -dy) {
          err -= dy;
          cx += sx;
        }
        if (e2 < dx) {
          err += dx;
          cy += sy;
        }
      }
    };

    if (kind === 'lantern') {
      // Lanterna metálica robusta levemente inclinada + lente amarelada
      box(4, 13, 14, 6, '#484d54');
      box(4, 13, 14, 1, '#8b929c');
      box(4, 18, 14, 1, '#2b2e33');
      // Ranhuras recartilhadas do cabo
      for (let gx = 6; gx <= 14; gx += 2) {
        box(gx, 14, 1, 4, '#32363c');
      }
      // Tampa traseira + argola
      box(3, 14, 1, 4, '#676d75');
      px(2, 16, '#7c828b');
      // Botão deslizante rubro-escuro
      box(12, 11, 4, 2, '#8d2d2b');
      px(13, 11, '#bf4945');
      // Cabeça refletora chanfrada
      box(18, 11, 3, 10, '#5a6069');
      box(18, 11, 3, 2, '#9aa2ad');
      box(18, 19, 3, 2, '#34383e');
      box(21, 10, 4, 12, '#69707a');
      box(21, 10, 4, 2, '#aeb6c2');
      box(21, 20, 4, 2, '#393d44');
      // Lente de vidro quente
      box(25, 11, 2, 10, '#d8be7d');
      box(25, 12, 1, 6, '#f6e7b8');
      px(26, 13, '#fff8dc');
    } else if (kind === 'bandage') {
      // Rolo cilíndrico de gaze com espiral superior e ponta solta
      box(7, 9, 14, 14, '#bfb6a4');
      box(8, 8, 12, 2, '#ded6c6');
      box(9, 7, 10, 1, '#d1c8b6');
      box(8, 23, 12, 1, '#857d6e');
      // Miolo escuro da espiral do rolo
      box(11, 8, 6, 2, '#6e6659');
      box(12, 8, 4, 1, '#3d3831');
      // Sombreamento lateral direito pontilhado
      for (let y = 10; y <= 22; y++) {
        px(20, y, '#857d6e');
        px(19, y, y % 2 === 0 ? '#9c9383' : '#bfb6a4');
        px(7, y, '#d8d0c0');
      }
      // Linhas sutis da trama de tecido
      box(8, 13, 12, 1, '#a69d8c');
      box(8, 18, 12, 1, '#a69d8c');
      // Faixa/cruz médica carmim seca
      box(13, 12, 2, 8, '#872624');
      box(10, 15, 8, 2, '#872624');
      px(13, 15, '#a83432');
      // Ponta de gaze desenrolada ao lado
      box(21, 19, 5, 4, '#b5ac9a');
      box(22, 20, 4, 2, '#cfc6b4');
      px(26, 21, '#9c9383');
    } else if (kind === 'morphine') {
      // Frasco apotecário âmbar com rolha de cortiça e rótulo envelhecido
      box(13, 4, 6, 3, '#947451');
      box(14, 4, 2, 2, '#b5926b');
      // Gargalo de vidro
      box(12, 7, 8, 2, '#8c969e');
      box(13, 9, 6, 2, '#6b737a');
      // Ombros do frasco
      box(10, 11, 12, 2, '#7d4422');
      box(9, 13, 14, 13, '#5e3016');
      box(10, 26, 12, 1, '#3b1d0c');
      // Líquido interno mais denso + reflexo especular vertical
      box(10, 16, 12, 9, '#47210d');
      box(10, 12, 2, 12, '#a86434');
      line(11, 12, 11, 22, '#d48d55');
      // Rótulo de papel gasto
      box(11, 15, 10, 7, '#c9bda6');
      box(12, 16, 8, 5, '#dfd5c1');
      box(13, 17, 6, 1, '#7a2522');
      box(13, 19, 5, 1, '#595247');
    } else if (kind === 'battery') {
      // Bateria industrial 9V com polos de latão
      box(10, 5, 3, 3, '#b89a5e');
      px(10, 5, '#e0c589');
      box(18, 6, 4, 2, '#9e824c');
      px(19, 6, '#cfb276');
      // Corpo metálico blindado
      box(8, 8, 16, 18, '#2b2e33');
      box(8, 8, 16, 5, '#9c6b2e');
      box(8, 8, 16, 1, '#cfa05d');
      box(8, 13, 16, 1, '#181a1d');
      // Brilho lateral esquerdo e sombra direita
      box(8, 9, 2, 16, '#3c4047');
      box(9, 9, 2, 4, '#b88340');
      box(22, 9, 2, 16, '#1f2125');
      // Símbolo gravado + / -
      box(11, 16, 1, 3, '#c8bfa8');
      box(10, 17, 3, 1, '#c8bfa8');
      box(19, 17, 3, 1, '#8c8577');
      box(11, 22, 10, 1, '#575248');
    } else if (kind === 'knife') {
      // Canivete diagonal com cabo de madeira rebitado e lâmina chanfrada
      for (let i = 0; i < 10; i++) {
        const hx = 5 + i;
        const hy = 24 - i;
        box(hx, hy - 2, 4, 4, '#4f3829');
        px(hx, hy - 2, '#73533e');
        px(hx + 3, hy + 1, '#302118');
      }
      // Rebites de latão no cabo
      px(8, 21, '#bfa269');
      px(12, 17, '#bfa269');
      // Guarda / virola de aço
      box(14, 13, 4, 4, '#7d828a');
      px(14, 13, '#b5bcc7');
      // Lâmina de aço com fio claro e pontos de oxidação
      for (let i = 0; i < 11; i++) {
        const bx = 16 + i;
        const by = 13 - i;
        const w = i > 8 ? 2 : 3;
        box(bx, by, w, w, '#969da6');
        px(bx, by, '#dce3ec'); // fio iluminado
      }
      px(20, 10, '#783426');
      px(21, 10, '#5e281d');
      px(23, 7, '#783426');
    } else if (kind === 'flare') {
      // Bastão químico de magnésio na diagonal + faíscas
      for (let i = 0; i < 14; i++) {
        const fx = 5 + i;
        const fy = 23 - Math.floor(i * 0.85);
        box(fx, fy - 2, 4, 4, '#8f2523');
        px(fx, fy - 2, '#c4423d');
        px(fx + 3, fy + 1, '#571514');
      }
      // Anéis pretos antiderrapantes
      line(7, 20, 9, 22, '#242222');
      line(12, 16, 14, 18, '#242222');
      // Cabeça cinza de fósforo + brasa viva
      box(19, 9, 4, 4, '#5e5854');
      box(22, 7, 3, 3, '#d97834');
      px(23, 8, '#ffe79e');
      px(25, 6, '#ffb85c');
      px(26, 9, '#e0562b');
      px(21, 5, '#ffd27d');
    } else if (kind === 'key') {
      // Chave antiga de latão com argola trabalhada e etiqueta pendurada
      box(5, 11, 8, 8, '#967c46');
      box(6, 10, 6, 10, '#967c46');
      box(7, 12, 4, 6, '#000000');
      ctx.clearRect(7, 12, 4, 6);
      line(6, 10, 11, 10, '#cfb374');
      line(5, 11, 5, 17, '#cfb374');
      // Plaqueta metálica pendurada na argola
      box(6, 20, 4, 6, '#595349');
      box(7, 21, 2, 4, '#7d7567');
      // Haste cilíndrica e segredos da chave
      box(13, 14, 14, 2, '#ab8f54');
      line(13, 14, 26, 14, '#d9be82');
      box(20, 16, 2, 4, '#8c723e');
      box(23, 16, 1, 3, '#8c723e');
      box(25, 16, 2, 5, '#ab8f54');
      px(25, 16, '#cfb374');
    } else {
      // Página arrancada de caderno com orelha dobrada e mancha seca de sangue
      box(7, 4, 17, 22, '#bfb49f');
      box(8, 5, 15, 20, '#d4c9b4');
      // Recorte rasgado irregular na base
      ctx.clearRect(7, 25, 3, 2);
      ctx.clearRect(13, 25, 4, 2);
      ctx.clearRect(21, 24, 3, 3);
      // Canto superior direito dobrado
      ctx.clearRect(21, 4, 3, 3);
      box(20, 4, 1, 4, '#968c79');
      box(20, 7, 4, 1, '#968c79');
      box(21, 5, 2, 2, '#afa48f');
      // Linhas manuscritas de tinta escura
      box(10, 9, 9, 1, '#4a4339');
      box(10, 12, 11, 1, '#4a4339');
      box(10, 15, 10, 1, '#4a4339');
      box(10, 18, 7, 1, '#4a4339');
      box(10, 21, 6, 1, '#5e564a');
      // Mancha carmim seca na borda inferior direita
      box(17, 19, 5, 4, '#75201e');
      box(18, 18, 3, 5, '#591615');
      px(16, 21, '#8c2b28');
    }

    applyPixelOutline(ctx, 32, 32, [9, 8, 10]);
    out[kind] = c.toDataURL();
  }

  return out;
}

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

  // 7. FIOS DE SEDA ORGÂNICOS EM CATENÁRIA SE PRESO NA TEIA
  if (vitals.trappedInWeb) {
    for (let dx = -24; dx <= 24; dx++) {
      const f = dx / 24;
      const sag1 = Math.round(76 + f * 5 + (1 - f * f) * 4);
      const sag2 = Math.round(87 - f * 6 + (1 - f * f) * 3);
      if (Math.abs(dx) % 2 === 0) px(cx + dx, sag1, '#babfb4');
      if (Math.abs(dx + 1) % 3 !== 0) px(cx + dx, sag2, '#8d9188');
    }
  }
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
  private readonly webSnareEl: HTMLElement;
  private readonly pickupGlintEl: HTMLElement;
  private readonly attackSlashEl: HTMLElement;
  private readonly cocoonSilkEl: HTMLElement;
  private readonly eyelidTopEl: HTMLElement;
  private readonly eyelidBottomEl: HTMLElement;
  private readonly blackoutVeilEl: HTMLElement;
  private readonly gameOverEl: HTMLElement;

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

  private readonly icons: Record<InventoryItemKind, string>;
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
  private isOpen = false;
  private isGameOver = false;
  private pickupFlashTimer = 0;
  private animRafId = 0;
  private lastPlateTick = -1;

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
    this.icons = buildItemIcons();

    // 1. Camada diegética em tela cheia (invisível na exploração saudável)
    this.diegeticEl = document.createElement('div');
    this.diegeticEl.id = 'doom-diegetic-fx';
    this.diegeticEl.innerHTML = `
      <div class="doom-blood-vignette"></div>
      <div class="doom-web-snare-fx"></div>
      <div class="doom-cocoon-silk"></div>
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
    this.webSnareEl = this.diegeticEl.querySelector(
      '.doom-web-snare-fx'
    ) as HTMLElement;
    this.cocoonSilkEl = this.diegeticEl.querySelector(
      '.doom-cocoon-silk'
    ) as HTMLElement;
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
          <button type="button" class="inv-close-btn" data-inv-close="1">[Tab] voltar</button>
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
                <span data-slot-counter>1 / 12</span>
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

    this.overlayEl
      .querySelector('[data-inv-close]')
      ?.addEventListener('click', () => {
        this.callbacks.onCloseRequest();
      });

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
          nextIdx = (this.selectedIndex + 4) % TOTAL_SLOTS;
        } else if (e.code === 'ArrowUp' || e.code === 'KeyW') {
          nextIdx = (this.selectedIndex + TOTAL_SLOTS - 4) % TOTAL_SLOTS;
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
      () => this.isOpen || this.isGameOver,
      () => this.collectInteractiveRects()
    );

    this.addItem('tactical_lantern', 1, true);
    this.renderQuickSlots();
    this.renderGrid();
    this.renderInspector();
    this.renderVitals();
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
    if (!this.isOpen) return rects;

    const nodes = this.overlayEl.querySelectorAll(
      '.inv-quick-slot, .inv-hk-btn, .inv-slot.filled, .inv-action-btn:not(:disabled), .inv-close-btn'
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

  get gameOverVisible(): boolean {
    return this.isGameOver;
  }

  toggle(): boolean {
    if (this.isGameOver) return false;
    this.setOpen(!this.isOpen);
    return this.isOpen;
  }

  setOpen(next: boolean): void {
    if (this.isOpen === next) return;
    this.isOpen = next;
    this.hoveredIndex = null;
    this.feedbackEl.textContent = '';
    if (next) {
      this.overlayEl.classList.add('open');
      this.renderVitals();
      this.renderQuickSlots();
      this.renderGrid();
      this.renderInspector();
      this.startAnatomyLoop();
    } else {
      this.overlayEl.classList.remove('open');
      this.stopAnatomyLoop();
    }
    this.sound.playInventoryToggle(next);
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

  showGameOver(): void {
    this.setOpen(false);
    this.isGameOver = true;
    this.gameOverEl.classList.add('visible');
  }

  hideGameOver(): void {
    this.isGameOver = false;
    this.gameOverEl.classList.remove('visible');
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
    this.cocoonSilkEl.style.opacity = Math.max(
      0,
      Math.min(1, cocoonOpacity)
    ).toFixed(3);

    const lid = Math.max(0, Math.min(1, eyelidClosed));
    const offsetPct = 105 - lid * 105;
    this.eyelidTopEl.style.transform = `translateY(${-offsetPct.toFixed(1)}%)`;
    this.eyelidBottomEl.style.transform = `translateY(${offsetPct.toFixed(1)}%)`;
    this.blackoutVeilEl.style.opacity = Math.max(
      0,
      Math.min(1, blackoutOpacity)
    ).toFixed(3);
  }

  hasItem(itemId: string): boolean {
    return this.slots.some(
      (s) => s !== null && s.def.id === itemId && s.quantity > 0
    );
  }

  getQuickSlots(): readonly (string | null)[] {
    return this.quickSlots;
  }

  getShortcutForItem(itemId: string): number {
    return this.quickSlots.indexOf(itemId);
  }

  /**
   * Atribui (ou limpa) um item utilizável a um dos 3 atalhos rápidos [1], [2] ou [3].
   * Caso o item já estivesse em outro atalho, troca de posição de forma limpa sem duplicar.
   */
  assignQuickSlot(quickIndex: number, itemId: string | null): boolean {
    if (quickIndex < 0 || quickIndex >= QUICK_SLOT_COUNT) return false;

    if (itemId === null) {
      this.quickSlots[quickIndex] = null;
      if (this.isOpen) {
        this.renderQuickSlots();
        this.renderGrid();
        this.renderInspector();
      }
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
    const itemId = this.quickSlots[quickIndex];
    if (!itemId) {
      this.sound.invalidInput();
      return false;
    }

    const slotIdx = this.slots.findIndex(
      (s) => s !== null && s.def.id === itemId && s.quantity > 0
    );
    if (slotIdx < 0) {
      this.quickSlots[quickIndex] = null;
      this.sound.invalidInput();
      return false;
    }

    return this.activateSlotItem(slotIdx, true);
  }

  private autoBindQuickSlotIfAvailable(def: InventoryItemDef): void {
    // Auto-preenche atalhos livres com suprimentos/ferramentas de emergência (faca, gaze, etc.)
    if (!def.usable || def.kind === 'lantern') return;
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
        if (!silent) {
          this.triggerPickupGlint();
          this.sound.playItemPickup();
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

    if (!silent) {
      this.triggerPickupGlint();
      this.sound.playItemPickup();
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
    const bloodOpacity = snapshot.bleeding
      ? Math.min(0.92, 0.32 + injuryRatio * 0.62)
      : injuryRatio > 0.12
        ? injuryRatio * 0.72
        : 0;
    this.bloodVignetteEl.style.opacity = bloodOpacity.toFixed(3);

    this.webSnareEl.style.opacity = snapshot.trappedInWeb ? '0.92' : '0';

    if (this.isOpen) {
      this.renderVitals();
      this.renderQuickSlots();
      this.renderGrid();
    }
  }

  private renderVitals(): void {
    const v = this.latestVitals;
    const hp = Math.max(0, Math.min(100, v.health));
    const san = Math.max(0, Math.min(100, v.sanity));
    const bat = Math.max(0, Math.min(100, v.battery));

    renderAnatomyCanvas(this.anatomyCtx, v, performance.now() / 1000);

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
    const litCells = Math.round(bat / 10);
    const lowBattery = bat > 0 && bat <= 22;
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

  private renderQuickSlots(): void {
    this.quickRowEl.innerHTML = '';

    for (let q = 0; q < QUICK_SLOT_COUNT; q++) {
      const itemId = this.quickSlots[q];
      const slotIdx = itemId
        ? this.slots.findIndex((s) => s !== null && s.def.id === itemId)
        : -1;
      const entry = slotIdx >= 0 ? this.slots[slotIdx] : null;

      const cell = document.createElement('div');
      cell.className = `inv-quick-slot${entry ? ' bound' : ''}`;
      cell.dataset.quickIndex = String(q);

      if (entry) {
        const iconSrc = this.icons[entry.def.kind];
        cell.title = `[${q + 1}] ${entry.def.name} — clique para vincular item selecionado | botão direito para limpar`;
        cell.innerHTML = `
          <span class="inv-quick-key">[${q + 1}]</span>
          <img class="inv-slot-sprite" src="${iconSrc}" alt="${entry.def.name}" />
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

      cell.addEventListener('mouseenter', () => {
        this.sound.playInventorySelect(false);
      });

      cell.addEventListener('click', () => {
        const currentSelected = this.slots[this.selectedIndex];
        if (currentSelected && currentSelected.def.usable) {
          if (this.quickSlots[q] === currentSelected.def.id) {
            // Se já é o próprio item selecionado, alterna/remove ou mantém com feedback claro
            this.toggleQuickSlotForSlot(this.selectedIndex, q);
          } else {
            this.assignQuickSlot(q, currentSelected.def.id);
            this.feedbackEl.textContent = `${currentSelected.def.name} atribuído ao atalho [${q + 1}].`;
            this.sound.playInventorySelect(true);
          }
          return;
        }

        // Caso o bolso selecionado esteja vazio/não-utilizável, clicar num atalho ocupado foca aquele item!
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
    }
  }

  private renderGrid(): void {
    const occupied = this.slots.filter((s) => s !== null).length;
    this.slotCounterEl.textContent = `${occupied} / ${TOTAL_SLOTS}`;

    this.gridEl.innerHTML = '';
    for (let i = 0; i < TOTAL_SLOTS; i++) {
      const entry = this.slots[i];
      const slotEl = document.createElement('div');
      slotEl.className = `inv-slot${entry ? ' filled' : ''}${
        i === this.selectedIndex ? ' selected' : ''
      }`;

      if (entry) {
        const iconSrc = this.icons[entry.def.kind];
        const showEquipDot =
          entry.def.kind === 'lantern' || entry.def.kind === 'knife';
        const dotActive =
          (entry.def.kind === 'lantern' &&
            this.latestVitals.flashlightEquipped) ||
          entry.def.kind === 'knife';
        const boundShortcut = this.getShortcutForItem(entry.def.id);

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
          <img class="inv-slot-sprite" src="${iconSrc}" alt="${entry.def.name}" />
          ${
            entry.quantity > 1
              ? `<span class="inv-slot-qty">×${entry.quantity}</span>`
              : ''
          }
        `;

        slotEl.addEventListener('mouseenter', () => {
          this.hoveredIndex = i;
          this.sound.playInventorySelect(false);
        });

        slotEl.addEventListener('mouseleave', () => {
          if (this.hoveredIndex === i) {
            this.hoveredIndex = null;
          }
        });

        slotEl.addEventListener('click', () => {
          this.selectedIndex = i;
          this.feedbackEl.textContent = '';
          this.sound.playInventorySelect(true);
          this.renderGrid();
          this.renderInspector();
        });

        slotEl.addEventListener('dblclick', () => {
          this.selectedIndex = i;
          this.useSelectedItem();
        });
      } else {
        slotEl.addEventListener('click', () => {
          this.selectedIndex = i;
          this.feedbackEl.textContent = '';
          this.renderGrid();
          this.renderInspector();
        });
      }

      this.gridEl.appendChild(slotEl);
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
    this.examineFigureEl.innerHTML = `<img src="${this.icons[def.kind]}" alt="${def.name}" />`;
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

  private useSelectedItem(): void {
    this.activateSlotItem(this.selectedIndex, false);
  }

  private activateSlotItem(slotIndex: number, fromQuickShortcut: boolean): boolean {
    const entry = this.slots[slotIndex];
    if (!entry) return false;
    const { def } = entry;

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

    return false;
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
  }

  destroy(): void {
    this.stopAnatomyLoop();
    this.keyNavAbort.abort();
    this.proximityFX.destroy();
    this.overlayEl.remove();
    this.diegeticEl.remove();
    this.gameOverEl.remove();
  }
}
