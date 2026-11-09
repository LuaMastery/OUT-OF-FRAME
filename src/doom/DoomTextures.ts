import * as THREE from 'three';

/**
 * Gerador determinístico PRNG simples para que tijolos, rebites, rachaduras
 * e manchas das texturas pixel-art fiquem 100% consistentes a cada execução.
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash2i(x: number, y: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + seed * 1442695041) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function clampByte(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}

function makePixelTexture(
  width: number,
  height: number,
  draw: (
    setPixel: (x: number, y: number, r: number, g: number, b: number) => void
  ) => void
): THREE.DataTexture {
  const data = new Uint8Array(width * height * 4);
  const setPixel = (x: number, y: number, r: number, g: number, b: number) => {
    const wx = ((x % width) + width) % width;
    const wy = ((y % height) + height) % height;
    // DataTexture tem y=0 na base (v=0); invertemos para desenhar de cima (y=0 -> topo v=1) para baixo (y=height-1 -> base v=0)
    const idx = ((height - 1 - wy) * width + wx) * 4;
    data[idx] = clampByte(r);
    data[idx + 1] = clampByte(g);
    data[idx + 2] = clampByte(b);
    data[idx + 3] = 255;
  };

  draw(setPixel);

  const tex = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

export interface DoomTextureSet {
  startanWall: THREE.DataTexture;
  stoneWall: THREE.DataTexture;
  metalTrim: THREE.DataTexture;
  pillarBulkhead: THREE.DataTexture;
  lightPanel: THREE.DataTexture;
  floorTile: THREE.DataTexture;
  stoneFloor: THREE.DataTexture;
  ceilingGrate: THREE.DataTexture;
  stoneVaultCeiling: THREE.DataTexture;
  darkIron: THREE.DataTexture;
  weatheredWood: THREE.DataTexture;
  cratePlanks: THREE.DataTexture;
  ironBarrel: THREE.DataTexture;
  oakStave: THREE.DataTexture;
}

/**
 * Conjunto de texturas Pixel-Art 128x128 de alta densidade estilo DOOM Sombrio / Bunker Subterrâneo:
 * - Paleta coesa e escura (sem tons pastel/pêssego artificiais e sem faixas amarelas vazando em molduras)
 * - Escala realista de alvenaria, chapas rebitadas, escorridos de óleo/ferrugem e luminárias centralizadas
 */
export function createDoomTextures(): DoomTextureSet {
  const S = 128;

  // 1. STARTAN SOMBRIO (128x128) — Painéis industriais militares desgastados (oliva-ferrugem/chumbo)
  const startanWall = makePixelTexture(S, S, (px) => {
    const rand = mulberry32(199301);
    // Pré-calcula escorridos verticais sutis de ferrugem/umidade por coluna
    const streakLen: number[] = [];
    for (let x = 0; x < S; x++) {
      const nearSeam = x % 32 <= 3 || x % 32 >= 29;
      streakLen.push(
        nearSeam ? 18 + rand() * 34 : rand() < 0.22 ? 12 + rand() * 26 : 0
      );
    }

    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const grit = (rand() - 0.5) * 11;
        const fineGrain = (hash2i(x, y >> 1, 11) - 0.5) * 7;
        const modX = x % 32;

        // Umidade escura na base e fuligem no topo
        const dampBottom = y > 102 ? ((y - 102) / 26) * 26 : 0;
        const sootTop = y < 14 ? ((14 - y) / 14) * 18 : 0;

        // Friso técnico rebaixado na altura de lambris (~1.0m do chão: y = 84..89)
        if (y >= 84 && y <= 89) {
          let rail = 52 + grit * 0.5;
          if (y === 84) rail = 28;
          else if (y === 85) rail = 74;
          else if (y === 89) rail = 30;
          if (y === 87 && (modX === 6 || modX === 25)) rail += 26; // rebites
          px(x, y, rail * 1.04, rail * 0.98, rail * 0.9);
          continue;
        }

        // Costura horizontal secundária discreta no terço superior (y = 30..31)
        if (y === 30 || y === 31) {
          const seam = y === 30 ? 36 : 68;
          px(
            x,
            y,
            (seam + grit * 0.4) * 1.04,
            (seam + grit * 0.4) * 0.96,
            (seam + grit * 0.4) * 0.86
          );
          continue;
        }

        // Arquitetura de cada baia vertical de 32px: canal fundo -> moldura -> painel rebaixado canelado
        let r = 98;
        let g = 88;
        let b = 74;

        if (modX === 0 || modX === 31) {
          // Junta estrutural profunda entre placas
          r = 34;
          g = 31;
          b = 28;
        } else if (modX === 1) {
          // Chanfro iluminado esquerdo da placa
          r = 124;
          g = 112;
          b = 94;
        } else if (modX === 30) {
          // Chanfro em sombra direita da placa
          r = 62;
          g = 55;
          b = 47;
        } else if (modX >= 5 && modX <= 26) {
          // Painel interno rebaixado com caneluras duplas estilo DOOM E1
          if (modX === 5 || modX === 15 || modX === 16) {
            r = 58;
            g = 51;
            b = 43;
          } else if (modX === 6 || modX === 17) {
            r = 114;
            g = 102;
            b = 85;
          } else if (modX === 26) {
            r = 72;
            g = 64;
            b = 54;
          } else {
            r = 92;
            g = 82;
            b = 69;
          }
        }

        // Rebites nos cantos das chapas
        const isRivet =
          (modX === 3 || modX === 28) &&
          (y === 10 || y === 26 || y === 36 || y === 79 || y === 95 || y === 116);
        if (isRivet) {
          r += 26;
          g += 24;
          b += 20;
        }

        // Escorridos de ferrugem descendo da costura y=31 e do friso y=89
        let rust = 0;
        if (y > 31 && y < 31 + streakLen[x]) {
          rust = (1 - (y - 31) / streakLen[x]) * 18;
        } else if (y > 89 && y < 89 + streakLen[(x + 17) % S] * 0.7) {
          rust = (1 - (y - 89) / (streakLen[(x + 17) % S] * 0.7)) * 20;
        }

        const delta = grit + fineGrain - dampBottom - sootTop;
        px(
          x,
          y,
          r + delta + rust * 0.65,
          g + delta * 0.95 - rust * 0.25,
          b + delta * 0.88 - rust * 0.45
        );
      }
    }
  });

  // 2. STONE WALL (128x128) — Alvenaria subterrânea irregular de catacumba (8 fiadas reais, sem blocos gigantes!)
  const stoneWall = makePixelTexture(S, S, (px) => {
    const rand = mulberry32(199302);
    const courseHeights = [16, 15, 17, 16, 15, 17, 16, 16]; // soma = 128
    const courseStarts: number[] = [];
    let accY = 0;
    for (const h of courseHeights) {
      courseStarts.push(accY);
      accY += h;
    }

    // Larguras variadas por fiada (soma = 128 para repetição perfeita sem costura!)
    const rowPatterns: number[][] = [
      [34, 28, 38, 28],
      [26, 36, 30, 36],
      [38, 26, 34, 30],
      [30, 34, 28, 36],
      [36, 30, 32, 30],
      [28, 38, 28, 34],
      [32, 28, 38, 30],
      [30, 36, 26, 36],
    ];
    const rowOffsets = [0, 17, 7, 23, 11, 27, 5, 19];

    for (let y = 0; y < S; y++) {
      let row = 0;
      for (let r = 0; r < courseStarts.length; r++) {
        if (y >= courseStarts[r]) row = r;
      }
      const rowH = courseHeights[row];
      const localY = y - courseStarts[row];

      const widths = rowPatterns[row];
      const shiftedX = (x0: number) => (x0 + rowOffsets[row]) % S;

      for (let x = 0; x < S; x++) {
        const sx = shiftedX(x);
        let col = 0;
        let accX = 0;
        for (let c = 0; c < widths.length; c++) {
          if (sx >= accX && sx < accX + widths[c]) {
            col = c;
            break;
          }
          accX += widths[c];
        }
        const blockW = widths[col];
        const localX = sx - accX;
        const blockSeed = row * 13 + col * 7;
        const blockTint = (hash2i(row, col, 901) - 0.5) * 24;

        const rough =
          (hash2i(x, y, 303) - 0.5) * 14 +
          (hash2i(x >> 1, y >> 1, 505) - 0.5) * 12;

        // Irregularidade orgânica de 1px na borda da pedra (pedra talhada à mão)
        const chipTop = hash2i(x, row, 71) > 0.78 ? 1 : 0;
        const chipSide = hash2i(row, y, 83) > 0.8 ? 1 : 0;

        const isMortar =
          localY === 0 ||
          (localY === 1 && chipTop === 1) ||
          localY === rowH - 1 ||
          localX === 0 ||
          (localX === 1 && chipSide === 1);

        const damp = y > 92 ? (y - 92) / 36 : 0;
        const mossPatch =
          y > 88 && hash2i(x >> 2, y >> 2, 619) < damp * 0.65;

        if (isMortar) {
          const m = 24 + (rand() - 0.5) * 7;
          px(
            x,
            y,
            mossPatch ? m * 0.85 : m,
            mossPatch ? m + 9 : m,
            mossPatch ? m * 0.82 : m * 0.96
          );
          continue;
        }

        let shade = 84 + blockTint + rough - damp * 18;

        // Relevo chanfrado natural das pedras
        if (localY === 1 + chipTop || localX === 1 + chipSide) shade += 16;
        if (localY === rowH - 2 || localX === blockW - 1) shade -= 16;

        // Fissura fina ocasional dentro de alguns blocos
        const crackX = Math.floor(blockW * 0.45) + ((localY >> 1) % 3);
        if (
          blockSeed % 3 === 0 &&
          localX === crackX &&
          localY > 3 &&
          localY < rowH - 4
        ) {
          shade -= 28;
        }

        if (mossPatch) {
          // Musgo subterrâneo escuro e dessaturado (sem verde neon!)
          px(x, y, shade * 0.76, shade * 0.88 + 6, shade * 0.72);
        } else {
          px(x, y, shade * 0.95, shade * 0.96, shade * 0.93);
        }
      }
    }
  });

  // 3. METAL TRIM (128x128) — Aço estrutural escuro rebitado (SEM listras amarelas para nunca manchar molduras!)
  const metalTrim = makePixelTexture(S, S, (px) => {
    const rand = mulberry32(199303);
    for (let y = 0; y < S; y++) {
      const ly = y % 32;
      for (let x = 0; x < S; x++) {
        const lx = x % 32;
        const brush = (hash2i(x, y >> 2, 411) - 0.5) * 8;
        const grit = (rand() - 0.5) * 7;

        let v = 66 + brush + grit;

        // Juntas de chapa rebitada 32x32
        if (lx === 0 || ly === 0) v = 30 + grit * 0.4;
        else if (lx === 1 || ly === 1) v += 15;
        else if (lx === 31 || ly === 31) v -= 14;

        // Rebites escuros/metálicos nos cantos das chapas
        const isRivet =
          (lx === 4 || lx === 27) && (ly === 4 || ly === 27);
        if (isRivet) v += 22;

        px(x, y, v * 0.95, v * 0.98, v * 1.04);
      }
    }
  });

  // 4. PILLAR BULKHEAD (128x128) — Coluna blindada pesada exclusiva para pilares estruturais 'M'
  const pillarBulkhead = makePixelTexture(S, S, (px) => {
    const rand = mulberry32(199309);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const grit = (rand() - 0.5) * 9;
        // Abas verticais pesadas da coluna
        if (x < 12 || x >= 116) {
          let edge = 56 + grit;
          if (x === 11 || x === 116) edge = 26;
          if (x === 1 || x === 117) edge = 82;
          if (y % 16 === 8 && (x === 5 || x === 122)) edge += 24;
          px(x, y, edge * 0.96, edge * 0.98, edge * 1.04);
          continue;
        }

        // Cinta de advertência industrial bem gasta e escura apenas no centro da coluna
        if (y >= 58 && y <= 69) {
          if (y === 58 || y === 69) {
            px(x, y, 26, 26, 28);
            continue;
          }
          const wear = hash2i(x, y, 777) > 0.25 ? 1 : 0.45;
          const stripe = ((x + y) % 16) < 8;
          if (stripe) {
            px(
              x,
              y,
              (126 + grit) * wear + 28 * (1 - wear),
              (92 + grit) * wear + 28 * (1 - wear),
              34 + grit * 0.4
            );
          } else {
            px(x, y, 34 + grit * 0.4, 33 + grit * 0.4, 32 + grit * 0.4);
          }
          continue;
        }

        // Painéis blindados rebaixados superior e inferior
        const inRecess =
          x >= 22 &&
          x <= 105 &&
          ((y >= 14 && y <= 48) || (y >= 79 && y <= 113));
        let v = inRecess ? 52 + grit : 68 + grit;
        if (
          inRecess &&
          (x === 22 || y === 14 || y === 79)
        ) {
          v = 32;
        } else if (
          inRecess &&
          (x === 105 || y === 48 || y === 113)
        ) {
          v = 82;
        }
        px(x, y, v * 0.96, v * 0.98, v * 1.03);
      }
    }
  });

  // 5. LITE5 BUNKER FIXTURE (128x128, UV LOCAL 0..1!) — Luminária gradeada sempre 100% centralizada!
  const lightPanel = makePixelTexture(S, S, (px) => {
    const rand = mulberry32(199304);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const grit = (rand() - 0.5) * 7;

        // Moldura metálica escura externa da caixa de luz
        if (x < 16 || x >= 112 || y < 10 || y >= 118) {
          let m = 48 + grit;
          if (x === 15 || x === 112 || y === 9 || y === 118) m = 22;
          else if (x === 14 || y === 8) m = 72;
          // Parafusos nos cantos
          if ((x === 7 || x === 120) && (y === 16 || y === 111)) m += 24;
          px(x, y, m, m * 0.98, m * 0.96);
          continue;
        }

        // Aletas horizontais defletoras estilo LITE5 DOOM (a cada 16px)
        const louverMod = (y - 10) % 18;
        if (louverMod === 0 || louverMod === 1) {
          const bar = louverMod === 0 ? 34 : 54;
          px(x, y, bar + grit * 0.4, bar + grit * 0.4, bar + 4);
          continue;
        }

        // Difusor fluorescente quente-pálido com queda suave nas bordas de vidro sujo
        const nx = Math.abs(x - 63.5) / 48.0;
        const ny = Math.abs(y - 63.5) / 54.0;
        const edgeVignette =
          (1.0 - nx * nx * 0.44) * (1.0 - Math.pow(ny, 3.2) * 0.32);
        const tubeCore = Math.exp(-nx * nx * 3.2) * 0.16;
        const louverShadow = louverMod === 2 || louverMod === 17 ? 0.84 : 1.0;
        const lum = Math.min(1.0, (edgeVignette + tubeCore) * louverShadow);

        px(
          x,
          y,
          246 * lum + grit * 0.35,
          230 * lum + grit * 0.35,
          192 * lum + grit * 0.35
        );
      }
    }
  });

  // 6. INDUSTRIAL FLOOR (128x128) — Chapas de piso de ferro antiderrapante parafusadas (Setor Norte)
  const floorTile = makePixelTexture(S, S, (px) => {
    const rand = mulberry32(199305);
    for (let y = 0; y < S; y++) {
      const ly = y % 64;
      for (let x = 0; x < S; x++) {
        const lx = x % 64;
        const grit = (rand() - 0.5) * 9;
        const grime = (hash2i(x >> 2, y >> 2, 512) - 0.5) * 10;

        // Fresta de drenagem entre placas 64x64
        if (lx === 0 || ly === 0 || lx === 63 || ly === 63) {
          const seam = lx === 0 || ly === 0 ? 22 : 34;
          px(x, y, seam, seam + 1, seam + 3);
          continue;
        }

        let v = 58 + grit + grime;
        if (lx === 1 || ly === 1) v += 14;
        if (lx === 62 || ly === 62) v -= 12;

        // Chanfro octogonal nos cantos da placa + parafusos sextavados
        const cornerSum = Math.min(
          lx + ly,
          63 - lx + ly,
          lx + (63 - ly),
          63 - lx + (63 - ly)
        );
        if (cornerSum < 9) {
          v -= 10;
        } else if (
          (lx === 6 || lx === 57) &&
          (ly === 6 || ly === 57)
        ) {
          v += 18;
        } else if (lx > 8 && lx < 55 && ly > 8 && ly < 55) {
          // Relevo antiderrapante discreto no interior da placa
          const tread =
            ((lx + ly) % 8 === 0 && lx % 4 < 2) ||
            ((lx - ly + 64) % 8 === 0 && ly % 4 < 2);
          if (tread) v += 7;
        }

        px(x, y, v * 0.95, v * 0.97, v * 1.03);
      }
    }
  });

  // 7. STONE FLOOR (128x128) — Lajes irregulares de ardósia/basalto para as Galerias Sul e Ninho!
  const stoneFloor = makePixelTexture(S, S, (px) => {
    const rand = mulberry32(199310);
    const slabRows = [32, 30, 34, 32];
    const rowY: number[] = [0, 32, 62, 96];
    const slabCols: number[][] = [
      [42, 46, 40],
      [34, 48, 46],
      [46, 38, 44],
      [38, 44, 46],
    ];
    const offsets = [0, 19, 9, 27];

    for (let y = 0; y < S; y++) {
      let rIdx = 0;
      for (let r = 0; r < rowY.length; r++) {
        if (y >= rowY[r]) rIdx = r;
      }
      const ly = y - rowY[rIdx];
      const rH = slabRows[rIdx];

      for (let x = 0; x < S; x++) {
        const sx = (x + offsets[rIdx]) % S;
        const cols = slabCols[rIdx];
        let cIdx = 0;
        let acc = 0;
        for (let c = 0; c < cols.length; c++) {
          if (sx >= acc && sx < acc + cols[c]) {
            cIdx = c;
            break;
          }
          acc += cols[c];
        }
        const lx = sx - acc;
        const cW = cols[cIdx];

        const wobX = Math.round(Math.sin(y * 0.22 + rIdx) * 1.1);
        const wobY = Math.round(Math.cos(x * 0.2 + cIdx) * 1.1);

        if (
          ly + wobY <= 0 ||
          ly + wobY >= rH - 1 ||
          lx + wobX <= 0 ||
          lx + wobX >= cW - 1
        ) {
          const joint = 20 + (rand() - 0.5) * 6;
          px(x, y, joint, joint + 1, joint);
          continue;
        }

        const slabTone = (hash2i(rIdx, cIdx, 881) - 0.5) * 16;
        const grain =
          (hash2i(x, y, 882) - 0.5) * 10 +
          (hash2i(x >> 2, y >> 2, 883) - 0.5) * 10;
        let v = 52 + slabTone + grain;
        if (ly === 1 || lx === 1) v += 9;
        if (ly === rH - 2 || lx === cW - 2) v -= 9;

        px(x, y, v * 0.96, v * 0.97, v * 0.94);
      }
    }
  });

  // 8. CEILING GRATE (128x128) — Teto industrial em caixotões escuros com grelhas (Setor Norte)
  const ceilingGrate = makePixelTexture(S, S, (px) => {
    const rand = mulberry32(199306);
    for (let y = 0; y < S; y++) {
      const ly = y % 64;
      for (let x = 0; x < S; x++) {
        const lx = x % 64;
        const grit = (rand() - 0.5) * 7;

        // Moldura estrutural do caixotão 64x64
        if (lx < 5 || lx >= 59 || ly < 5 || ly >= 59) {
          let frame = 44 + grit * 0.6;
          if (lx === 0 || ly === 0) frame = 20;
          else if (lx === 4 || ly === 4) frame = 28;
          px(x, y, frame * 0.96, frame * 0.96, frame);
          continue;
        }

        // Venezianas escuras de ventilação no interior do caixotão
        const slat = ly % 8 < 2 ? 24 : 38;
        const rib = lx === 31 || lx === 32 ? 44 : slat;
        const v = rib + grit * 0.6;
        px(x, y, v * 0.95, v * 0.95, v * 0.98);
      }
    }
  });

  // 9. STONE VAULT CEILING (128x128) — Lajes escuras fuliginosas do teto das catacumbas sul
  const stoneVaultCeiling = makePixelTexture(S, S, (px) => {
    const rand = mulberry32(199311);
    for (let y = 0; y < S; y++) {
      const row = Math.floor(y / 32);
      const ly = y % 32;
      for (let x = 0; x < S; x++) {
        const sx = (x + (row % 2) * 32) % S;
        const lx = sx % 64;
        const grit = (rand() - 0.5) * 8;
        if (ly === 0 || lx === 0) {
          px(x, y, 16, 16, 17);
          continue;
        }
        let v = 38 + (hash2i(sx >> 6, row, 991) - 0.5) * 10 + grit;
        if (ly === 1) v += 6;
        if (ly === 31) v -= 6;
        px(x, y, v * 0.96, v * 0.96, v * 0.94);
      }
    }
  });

  // 10. DARK IRON (128x128) — Ferro fundido escuro com pátina e rebites discretos
  const darkIron = makePixelTexture(S, S, (px) => {
    const rand = mulberry32(199307);
    for (let y = 0; y < S; y++) {
      const ly = y % 32;
      for (let x = 0; x < S; x++) {
        const lx = x % 32;
        const grit = (rand() - 0.5) * 8;
        let base = 42 + (hash2i(x >> 1, y >> 1, 707) - 0.5) * 7 + grit;

        if (lx === 0 || ly === 0) base = 22;
        else if (lx === 1 || ly === 1) base += 11;
        else if (lx === 31 || ly === 31) base -= 9;

        if ((lx === 4 || lx === 27) && (ly === 4 || ly === 27)) {
          base += 18;
        }

        const rust = hash2i(x, y, 709) < 0.09 ? 9 : 0;
        px(
          x,
          y,
          base * 0.96 + rust,
          base * 0.96 + rust * 0.25,
          base * 1.02 - rust * 0.2
        );
      }
    }
  });

  // 11. WEATHERED WOOD (128x128) — Pranchões e vigas de madeira escura envelhecida 100% contínuos (sem faixas de ferro cortando tábuas!)
  const weatheredWood = makePixelTexture(S, S, (px) => {
    const rand = mulberry32(199308);
    const buttJointX = [28, 92, 54, 114];
    for (let y = 0; y < S; y++) {
      const plank = Math.floor(y / 32);
      const ly = y % 32;
      const jointX = buttJointX[plank];
      for (let x = 0; x < S; x++) {
        const grit = (rand() - 0.5) * 7;
        const grain =
          Math.sin((x + plank * 29) * 0.16 + Math.sin(y * 0.42) * 0.85) * 6.5 +
          Math.sin((y + plank * 11) * 0.65 + Math.cos(x * 0.09) * 1.4) * 3.5;

        // Fresta horizontal profunda entre pranchões
        if (ly === 0) {
          px(x, y, 22, 16, 12);
          continue;
        }

        // Junta de topo escalonada entre tábuas + par de pregos oxidados
        const dxJoint = ((x - jointX) % S + S) % S;
        if (dxJoint === 0) {
          px(x, y, 25, 19, 14);
          continue;
        }
        const isNail =
          (dxJoint === 4 || dxJoint === S - 4) && (ly === 7 || ly === 25);
        if (isNail) {
          px(x, y, 36, 33, 31);
          continue;
        }

        const knotDist = Math.hypot(
          ((x + plank * 43) % 96) - 48,
          ly - (plank % 2 === 0 ? 14 : 19)
        );
        const knot = knotDist < 3.6 ? -15 + knotDist * 3.2 : 0;

        let tone =
          75 + (plank % 2 === 0 ? 5 : -4) + grain + grit + knot;
        if (ly === 1 || dxJoint === 1) tone += 9;
        if (ly === 31 || dxJoint === S - 1) tone -= 9;

        px(x, y, tone * 1.05, tone * 0.76, tone * 0.51);
      }
    }
  });

  // 11b. CRATE PLANKS (128x128) — Tábuas horizontais de caixotes de carga com pregos e veios nítidos
  const cratePlanks = makePixelTexture(S, S, (px) => {
    const rand = mulberry32(199312);
    const boardHeights = [21, 22, 21, 21, 22, 21]; // soma exata = 128
    const boardStarts: number[] = [];
    let acc = 0;
    for (const h of boardHeights) {
      boardStarts.push(acc);
      acc += h;
    }

    for (let y = 0; y < S; y++) {
      let bIdx = 0;
      for (let i = 0; i < boardStarts.length; i++) {
        if (y >= boardStarts[i]) bIdx = i;
      }
      const ly = y - boardStarts[bIdx];
      const bh = boardHeights[bIdx];

      for (let x = 0; x < S; x++) {
        if (ly === 0) {
          px(x, y, 26, 19, 13);
          continue;
        }

        const grit = (rand() - 0.5) * 6.5;
        const fiber =
          Math.sin((x + bIdx * 31) * 0.14 + Math.sin(y * 0.52) * 0.75) * 6 +
          (hash2i(x >> 1, y, 912) - 0.5) * 6;
        const knotDist = Math.hypot(
          ((x + bIdx * 53) % 112) - 56,
          ly - Math.floor(bh * 0.52)
        );
        const knot = knotDist < 3.1 ? -14 + knotDist * 3.4 : 0;

        // Pregos discretos de montagem a cada 64px
        const lx64 = x % 64;
        if ((lx64 === 5 || lx64 === 58) && (ly === 5 || ly === bh - 5)) {
          px(x, y, 38, 35, 32);
          continue;
        }

        let tone =
          88 + ((bIdx * 5) % 3 - 1) * 5 + fiber + grit + knot;
        if (ly === 1) tone += 9;
        if (ly === bh - 1) tone -= 9;

        px(x, y, tone * 1.07, tone * 0.8, tone * 0.53);
      }
    }
  });

  // 12. IRON BARREL (128x128) — Tambor de ferro industrial oxidado com frisos, costura e faixa técnica desgastada
  const ironBarrel = makePixelTexture(S, S, (px) => {
    const rand = mulberry32(199309);
    const dripLen: number[] = [];
    for (let x = 0; x < S; x++) {
      dripLen.push(rand() < 0.28 ? 14 + rand() * 44 : 0);
    }

    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const grit = (rand() - 0.5) * 9;
        const fine = (hash2i(x, y, 811) - 0.5) * 7;

        // Costura vertical soldada do tambor
        const isWeld = x === 63 || x === 64;

        // Frisos horizontais estampados no aço (topo, 1/3, 2/3 e base)
        const isRibDark =
          y === 3 || y === 39 || y === 85 || y === 123;
        const isRibBright =
          y === 4 || y === 5 || y === 40 || y === 41 || y === 86 || y === 87 || y === 122;

        // Faixa central de contenção industrial desgastada (y = 56..69)
        const inBand = y >= 56 && y <= 69;

        let r = 64 + grit * 0.6 + fine * 0.5;
        let g = 70 + grit * 0.6 + fine * 0.5;
        let b = 60 + grit * 0.5 + fine * 0.5;

        if (inBand) {
          const diag = ((x + y) >> 3) % 2 === 0;
          const chipped = hash2i(x >> 1, y >> 1, 823) < 0.24;
          if (!chipped) {
            if (diag) {
              r = 128 + grit * 0.5;
              g = 96 + grit * 0.4;
              b = 34 + grit * 0.3;
            } else {
              r = 34 + grit * 0.4;
              g = 34 + grit * 0.4;
              b = 32 + grit * 0.4;
            }
          }
        }

        if (isRibDark) {
          r *= 0.48;
          g *= 0.48;
          b *= 0.48;
        } else if (isRibBright) {
          r = Math.min(185, r * 1.32 + 12);
          g = Math.min(185, g * 1.30 + 10);
          b = Math.min(175, b * 1.26 + 8);
        }

        if (isWeld) {
          r *= 0.65;
          g *= 0.64;
          b *= 0.64;
        }

        // Ferrugem e óleo escorrendo dos frisos e da tampa
        const fromTop = y < dripLen[x];
        const fromMid = y > 41 && y < 41 + dripLen[(x + 37) % S] * 0.55;
        const rustPatch = hash2i(x >> 2, y >> 2, 829) > 0.82;
        if (fromTop || fromMid || rustPatch) {
          r = r * 0.78 + 26;
          g = g * 0.68 + 11;
          b = b * 0.62 + 5;
        }

        // Sujeira pesada junto ao fundo apoiado no piso úmido
        if (y > 108) {
          const k = 1 - ((y - 108) / 20) * 0.38;
          r *= k;
          g *= k;
          b *= k;
        }

        px(x, y, r, g, b);
      }
    }
  });

  // 13. OAK STAVE (128x128) — Aduelas verticais de carvalho escuro para tonéis e caixotes reforçados
  const oakStave = makePixelTexture(S, S, (px) => {
    const rand = mulberry32(199310);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const stave = Math.floor(x / 16);
        const lx = x % 16;
        const grit = (rand() - 0.5) * 7;

        // Junta calafetada escura entre aduelas verticais
        if (lx === 0) {
          px(x, y, 22, 16, 12);
          continue;
        }

        const grain =
          Math.sin((y + stave * 19) * 0.22 + Math.sin(x * 0.55) * 0.8) * 8;
        const knotDist = Math.hypot(
          lx - 8,
          ((y + stave * 37) % 64) - 32
        );
        const knot = knotDist < 3.4 ? -16 + knotDist * 3 : 0;

        let tone =
          82 + ((stave * 7) % 3 - 1) * 6 + grain + grit + knot;
        if (lx === 1) tone += 9;
        if (lx === 15) tone -= 9;

        // Escurecimento úmido perto das extremidades superior e inferior do barril
        const edgeDist = Math.min(y, S - 1 - y);
        if (edgeDist < 14) {
          tone -= ((14 - edgeDist) / 14) * 20;
        }

        px(x, y, tone * 1.08, tone * 0.75, tone * 0.48);
      }
    }
  });

  return {
    startanWall,
    stoneWall,
    metalTrim,
    pillarBulkhead,
    lightPanel,
    floorTile,
    stoneFloor,
    ceilingGrate,
    stoneVaultCeiling,
    darkIron,
    weatheredWood,
    cratePlanks,
    ironBarrel,
    oakStave,
  };
}
