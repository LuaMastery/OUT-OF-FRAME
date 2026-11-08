import * as THREE from 'three';

/**
 * Gerador determinístico PRNG simples para que os tijolos, rebites e manchas
 * pixel-art das texturas fiquem 100% consistentes a cada execução.
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
    // DataTexture tem y=0 na base; invertemos para desenhar de cima (0) para baixo (height-1)
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
  lightPanel: THREE.DataTexture;
  floorTile: THREE.DataTexture;
  ceilingGrate: THREE.DataTexture;
}

/**
 * Constrói o conjunto de texturas Pixel-Art 64x64 inspiradas no DOOM clássico (1993):
 * - STARTAN: painéis industriais bege/ferrugem com frisos verticais, rodapé metálico e rebites
 * - STONE: blocos de pedra cinza-musgo com rejunte escuro e desgaste pixelado
 * - METAL: vigas de ferro escuro rebitadas com detalhes em bronze
 * - LITE: grade luminosa embutida de corredor
 * - FLOOR: ladrilhos chanfrados de ferro/ardósia
 * - CEIL: placas metálicas industriais de teto
 */
export function createDoomTextures(): DoomTextureSet {
  // 1. STARTAN — Painel industrial clássico bege/ferrugem (64x64)
  const startanWall = makePixelTexture(64, 64, (px) => {
    const rand = mulberry32(199301);
    for (let y = 0; y < 64; y++) {
      for (let x = 0; x < 64; x++) {
        const grit = (rand() - 0.5) * 14;
        // Manchas verticais sutis de ferrugem/sujeira
        const grime = Math.sin(x * 0.35) * 5 + (y > 46 ? (y - 46) * 0.9 : 0);

        // Rodapé e sanca metálica escura no topo e na base
        if (y < 6 || y >= 56) {
          let base = y === 5 || y === 56 ? 38 : 66;
          if (y === 1 || y === 57) base += 24;
          const rivet = (x % 16 === 3 || x % 16 === 13) && (y === 3 || y === 60);
          const v = (rivet ? base + 34 : base) + grit * 0.6;
          px(x, y, v * 1.05, v * 0.98, v * 0.9);
          continue;
        }

        // Faixa horizontal divisória no meio da parede
        if (y >= 29 && y <= 33) {
          let m = y === 29 ? 118 : y === 33 ? 42 : 76;
          if (x % 8 === 4 && y === 31) m += 28; // rebites
          px(x, y, m + grit * 0.5, (m + grit * 0.5) * 0.88, (m + grit * 0.5) * 0.74);
          continue;
        }

        // Painéis canelados verticais (4 módulos de 16px)
        const modX = x % 16;
        let r = 148;
        let g = 114;
        let b = 84;

        // Junta escura entre painéis
        if (modX === 0 || modX === 15) {
          r = 58;
          g = 42;
          b = 31;
        } else if (modX === 1) {
          // Chanfro iluminado esquerdo
          r = 178;
          g = 142;
          b = 106;
        } else if (modX === 14) {
          // Sombra direita
          r = 104;
          g = 76;
          b = 54;
        } else if (modX === 7 || modX === 8) {
          // Sulco vertical interno estilo STARTAN
          r = modX === 7 ? 96 : 164;
          g = modX === 7 ? 70 : 128;
          b = modX === 7 ? 50 : 96;
        }

        px(x, y, r + grit - grime, g + grit - grime * 0.9, b + grit - grime * 0.8);
      }
    }
  });

  // 2. STONE — Alvenaria pesada cinza-esverdeada estilo masmorra/base DOOM (64x64)
  const stoneWall = makePixelTexture(64, 64, (px) => {
    const rand = mulberry32(199302);
    const brickH = 16;
    const brickW = 32;

    // Tonalidade própria de cada bloco
    const brickTint: number[] = [];
    for (let i = 0; i < 32; i++) {
      brickTint.push((rand() - 0.5) * 26);
    }

    for (let y = 0; y < 64; y++) {
      const row = Math.floor(y / brickH);
      const localY = y % brickH;
      const offset = (row % 2) * 16;

      for (let x = 0; x < 64; x++) {
        const shiftedX = (x + offset) % 64;
        const col = Math.floor(shiftedX / brickW);
        const localX = shiftedX % brickW;
        const brickId = (row * 4 + col) % brickTint.length;

        const noise = (rand() - 0.5) * 18;
        const moss =
          y > 42 && rand() < (y - 40) * 0.028 ? 1 : 0;

        // Argamassa / rejunte fundo
        if (localY === 0 || localY === brickH - 1 || localX === 0) {
          const m = 34 + noise * 0.4;
          px(x, y, m, m + moss * 14, m * 0.95);
          continue;
        }

        let shade = 104 + brickTint[brickId] + noise;
        // Relevo chanfrado na borda superior/inferior do bloco
        if (localY === 1 || localX === 1) shade += 22;
        if (localY === brickH - 2 || localX === brickW - 1) shade -= 22;

        // Pequenas rachaduras ocasionais
        if ((localX === 11 && localY > 3 && localY < 10 && brickId % 3 === 0)) {
          shade -= 38;
        }

        const r = moss ? shade * 0.78 : shade * 0.96;
        const g = moss ? shade * 1.02 : shade * 0.97;
        const b = moss ? shade * 0.72 : shade * 0.92;
        px(x, y, r, g, b);
      }
    }
  });

  // 3. METAL — Pilar de ferro escuro com rebites e friso âmbar/bronze (64x64)
  const metalTrim = makePixelTexture(64, 64, (px) => {
    const rand = mulberry32(199303);
    for (let y = 0; y < 64; y++) {
      for (let x = 0; x < 64; x++) {
        const grit = (rand() - 0.5) * 10;

        // Borda vertical lateral de viga
        if (x < 6 || x >= 58) {
          const edge = x === 5 || x === 58 ? 30 : x === 1 || x === 62 ? 96 : 64;
          px(x, y, edge + grit, edge + grit, (edge + grit) * 1.05);
          continue;
        }

        // Faixa de alerta industrial bronze/âmbar sutil
        if (y >= 28 && y <= 35) {
          const diag = ((x + y) % 12) < 6;
          if (diag) {
            px(x, y, 168 + grit, 118 + grit, 38 + grit * 0.5);
          } else {
            px(x, y, 42 + grit * 0.5, 38 + grit * 0.5, 34 + grit * 0.5);
          }
          continue;
        }

        let v = 74 + Math.sin(x * 0.2) * 6 + grit;
        if (y % 16 === 0) v -= 26;
        if (y % 16 === 1) v += 18;

        // Rebites nos cantos das chapas
        const ry = y % 16;
        if ((ry === 4 || ry === 12) && (x === 10 || x === 53)) {
          v += 36;
        }

        px(x, y, v * 0.95, v * 0.97, v * 1.02);
      }
    }
  });

  // 4. LITE — Luminária vertical gradeada de parede estilo LITE5 (64x64)
  const lightPanel = makePixelTexture(64, 64, (px) => {
    const rand = mulberry32(199304);
    for (let y = 0; y < 64; y++) {
      for (let x = 0; x < 64; x++) {
        const grit = (rand() - 0.5) * 8;
        // Moldura metálica ao redor da luminária central
        if (x < 16 || x >= 48 || y < 6 || y >= 58) {
          let m = 62 + grit;
          if (x === 15 || x === 48 || y === 5 || y === 58) m = 28;
          px(x, y, m, m * 0.98, m * 0.95);
          continue;
        }

        // Grade horizontal protetora a cada 8px
        if (y % 8 === 0 || y % 8 === 1) {
          px(x, y, 48 + grit, 48 + grit, 52 + grit);
          continue;
        }

        // Tubo luminoso quente/branco no centro
        const distCenter = Math.abs(x - 31.5) / 16.0;
        const glow = 1.0 - distCenter * 0.38;
        const r = 252 * glow + grit * 0.4;
        const g = 240 * glow + grit * 0.4;
        const b = 205 * glow + grit * 0.4;
        px(x, y, r, g, b);
      }
    }
  });

  // 5. FLOOR — Ladrilhos metálicos/pedra 64x64 estilo FLOOR4_8
  const floorTile = makePixelTexture(64, 64, (px) => {
    const rand = mulberry32(199305);
    for (let y = 0; y < 64; y++) {
      for (let x = 0; x < 64; x++) {
        const lx = x % 32;
        const ly = y % 32;
        const grit = (rand() - 0.5) * 12;

        if (lx === 0 || ly === 0) {
          px(x, y, 28, 30, 34);
          continue;
        }

        let v = 78 + grit;
        if (lx === 1 || ly === 1) v += 18;
        if (lx === 31 || ly === 31) v -= 18;

        // Detalhe octogonal interno nos ladrilhos
        if (lx + ly < 6 || (31 - lx) + ly < 6 || lx + (31 - ly) < 6 || (31 - lx) + (31 - ly) < 6) {
          v -= 14;
        }

        px(x, y, v * 0.94, v * 0.96, v * 1.04);
      }
    }
  });

  // 6. CEIL — Teto nervurado escuro com grelhas industriais (64x64)
  const ceilingGrate = makePixelTexture(64, 64, (px) => {
    const rand = mulberry32(199306);
    for (let y = 0; y < 64; y++) {
      for (let x = 0; x < 64; x++) {
        const grit = (rand() - 0.5) * 9;
        if (x % 32 === 0 || y % 32 === 0) {
          px(x, y, 22, 22, 24);
          continue;
        }
        const rib = (x % 8 < 2) ? -12 : 4;
        const v = 56 + rib + grit;
        px(x, y, v * 0.96, v * 0.92, v * 0.88);
      }
    }
  });

  return {
    startanWall,
    stoneWall,
    metalTrim,
    lightPanel,
    floorTile,
    ceilingGrate,
  };
}
