import * as THREE from 'three';
import { createDoomPropMaterial, DoomSharedUniforms } from './DoomShader';

export type AstronautArmSide = 'left' | 'right';

export type AstronautGripPose =
  | 'relaxed'
  | 'flashlight'
  | 'knife'
  | 'cylindrical'
  | 'box'
  | 'key'
  | 'sprawled';

export interface AstronautArmMetadata {
  readonly isAstronautArm: true;
  readonly isActiveGameplayArm: true;
  readonly characterId: 'protagonist_astronaut';
  readonly armSide: AstronautArmSide;
  readonly armRole: 'right_lantern_arm' | 'left_item_and_knife_arm';
  readonly usedInAnimations: readonly string[];
  currentlyInUse: boolean;
}

export interface AstronautFingerRig {
  readonly proxPivot: THREE.Group;
  readonly distPivot: THREE.Group;
}

export interface AstronautArmRig {
  readonly side: AstronautArmSide;
  readonly root: THREE.Group;
  readonly shoulderPivot: THREE.Group;
  readonly upperArmGroup: THREE.Group;
  readonly elbowPivot: THREE.Group;
  readonly forearmGroup: THREE.Group;
  readonly wristRingGroup: THREE.Group;
  readonly wristPivot: THREE.Group;
  readonly gloveGroup: THREE.Group;
  readonly gripSocket: THREE.Group;
  readonly thumbPivot: THREE.Group;
  readonly thumbTipPivot: THREE.Group;
  readonly thumbTipMesh: THREE.Mesh;
  readonly fingers: readonly AstronautFingerRig[];
  readonly gaugeNeedleMesh: THREE.Mesh | null;
  readonly metadata: AstronautArmMetadata;
  setGripPose: (pose: AstronautGripPose) => void;
  setInUse: (inUse: boolean) => void;
}

export interface AstronautMaterialSet {
  suitFabric: THREE.Material;
  astroCamo: THREE.Material;
  suitDarkPatch: THREE.Material;
  ribbedJoint: THREE.Material;
  anodizedCrimson: THREE.Material;
  anodizedCobalt: THREE.Material;
  missionOrange: THREE.Material;
  machinedAlloy: THREE.Material;
  darkSteel: THREE.Material;
  goldVisor: THREE.Material;
  chestPanel: THREE.Material;
  gaugeDial: THREE.Material;
  bootRubber: THREE.Material;
}

interface AstronautTextureCache {
  suitFabricTex: THREE.DataTexture;
  astroCamoTex: THREE.DataTexture;
  ribbedJointTex: THREE.DataTexture;
  goldVisorTex: THREE.DataTexture;
  chestPanelTex: THREE.DataTexture;
  gaugeDialTex: THREE.DataTexture;
}

let cachedAstronautTextures: AstronautTextureCache | null = null;

function hash2(x: number, y: number, seed: number): number {
  let n =
    (Math.imul(x, 374761393) +
      Math.imul(y, 668265263) +
      Math.imul(seed, 1442695041)) |
    0;
  n = (n ^ (n >>> 13)) | 0;
  n = Math.imul(n, 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}

function clampByte(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v | 0;
}

/**
 * Tecido térmico pressurizado Beta-Cloth / Kevlar-Nomex (64x64 pixel-art)
 * com costura acolchoada em losangos e desgaste industrial.
 */
function createEvaSuitFabricTexture(): THREE.DataTexture {
  const size = 64;
  const data = new Uint8Array(size * size * 4);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const weave = ((x + y) & 1) === 0 ? 4 : -4;
      const quiltA = (x + y) % 16 === 0;
      const quiltB = ((x - y) % 16 + 16) % 16 === 0;
      const seamH = y % 32 === 0;
      const noise = (hash2(x, y, 401) - 0.5) * 12;
      const scuff = hash2(x >> 2, y >> 2, 409) > 0.82 ? -14 : 0;

      let v = 186 + weave + noise + scuff;
      if (quiltA || quiltB) v -= 24;
      if (seamH) v -= 34;
      else if (y % 32 === 1) v += 12;

      data[i] = clampByte(v * 1.01);
      data[i + 1] = clampByte(v * 0.98);
      data[i + 2] = clampByte(v * 0.91);
      data[i + 3] = 255;
    }
  }

  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Camuflagem Astronáutica EVA (64x64 pixel-art nítido estilo DOOM):
 * Padrão tático lunar/orbital de alto contraste em 4 tons (cinza-rególito claro,
 * ardósia titânio, carvão espacial profundo e cáqui-lunar oxidado), com matelassê
 * térmico Kevlar em losangos, costuras seladas e micro-marcações técnicas.
 */
function createAstronautCamoTexture(): THREE.DataTexture {
  const size = 64;
  const data = new Uint8Array(size * size * 4);

  // Centros procedurais de manchas táticas (wrap 64x64 sem costura!)
  const seeds: Array<{ cx: number; cy: number; rx: number; ry: number; tone: number }> = [];
  for (let s = 0; s < 34; s++) {
    seeds.push({
      cx: Math.floor(hash2(s, 11, 701) * 32) * 2,
      cy: Math.floor(hash2(s, 29, 709) * 32) * 2,
      rx: 5 + Math.floor(hash2(s, 47, 719) * 7),
      ry: 4 + Math.floor(hash2(s, 61, 727) * 8),
      tone: (s % 4 === 0 ? 2 : s % 4 === 1 ? 1 : s % 4 === 2 ? 3 : 0),
    });
  }

  const wrapDelta = (a: number, b: number) => {
    let d = a - b;
    if (d > 32) d -= 64;
    if (d < -32) d += 64;
    return d;
  };

  // Pré-calcula mapa de zonas em blocos pixel-art 2x2 para silhueta tática nítida
  const zoneGrid = new Uint8Array(size * size);
  for (let y = 0; y < size; y++) {
    const qy = y & ~1;
    for (let x = 0; x < size; x++) {
      const qx = x & ~1;
      let zone = 0;
      let bestScore = 1.05;
      for (let s = 0; s < seeds.length; s++) {
        const sd = seeds[s];
        const dx = wrapDelta(qx, sd.cx);
        const dy = wrapDelta(qy, sd.cy);
        // Geometria angular/chanfrada típica de camuflagem espacial/tática
        const score =
          (Math.abs(dx) * 0.72 + Math.abs(dy) * 0.28) / sd.rx +
          (Math.abs(dy) * 0.74 + Math.abs(dx - dy) * 0.18) / sd.ry;
        if (score < bestScore) {
          bestScore = score;
          zone = sd.tone;
        }
      }
      // Micro-fragmentos digitais 2x2 nas transições
      if (hash2(qx >> 1, qy >> 1, 733) > 0.84) {
        zone = (zone + 1) & 3;
      }
      zoneGrid[y * size + x] = zone;
    }
  }

  // Paleta de 4 tons astronáuticos calibrada para não lavar no COLORMAP do DOOM
  const palette: Array<[number, number, number]> = [
    [214, 216, 220], // 0: Branco-cinza rególito lunar
    [138, 146, 158], // 1: Cinza-ardósia orbital
    [68, 74, 86],    // 2: Carvão de vácuo profundo
    [112, 108, 96],  // 3: Titânio/poeira lunar oxidada
  ];

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const z = zoneGrid[y * size + x];
      const zRight = zoneGrid[y * size + ((x + 1) & 63)];
      const zDown = zoneGrid[((y + 1) & 63) * size + x];

      let [r, g, b] = palette[z];

      // Contorno nítido de 1px entre manchas claras e escuras
      if (z !== zRight || z !== zDown) {
        r *= 0.84;
        g *= 0.84;
        b *= 0.86;
      }

      // Trama ripstop + matelassê térmico diagonal do traje espacial
      const ripstop = (x & 3) === 0 || (y & 3) === 0 ? -7 : 3;
      const quiltDiag =
        (x + y) % 16 === 0 || ((x - y) % 16 + 16) % 16 === 0 ? -18 : 0;
      const panelSeam = y === 0 || y === 32 ? -32 : y === 1 || y === 33 ? 14 : 0;
      const rivet =
        (y === 2 || y === 30 || y === 34 || y === 62) && x % 16 === 4 ? 26 : 0;
      const grain = (hash2(x, y, 751) - 0.5) * 10;

      const delta = ripstop + quiltDiag + panelSeam + rivet + grain;
      data[i] = clampByte(r + delta);
      data[i + 1] = clampByte(g + delta);
      data[i + 2] = clampByte(b + delta);
      data[i + 3] = 255;
    }
  }

  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Foles sanfonados de borracha pressurizada para cotovelos, joelhos, cintura e dedos.
 */
function createEvaRibbedJointTexture(): THREE.DataTexture {
  const size = 64;
  const data = new Uint8Array(size * size * 4);

  for (let y = 0; y < size; y++) {
    const ringPos = y % 8;
    const ribShade =
      ringPos === 0 || ringPos === 7
        ? -20
        : ringPos === 3 || ringPos === 4
          ? 16
          : 4;
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const grain = (hash2(x, y, 421) - 0.5) * 8;
      const v = 54 + ribShade + grain;
      data[i] = clampByte(v * 0.96);
      data[i + 1] = clampByte(v * 1.0);
      data[i + 2] = clampByte(v * 1.08);
      data[i + 3] = 255;
    }
  }

  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Viseira solar curva banhada a ouro 24k do capacete espacial EVA:
 * - Vinheta escura nas bordas para encaixe limpo na vedação de borracha;
 * - Reflexo curvo duplo de luminária de corredor + brilho especular metálico nítido.
 */
function createEvaGoldVisorTexture(): THREE.DataTexture {
  const size = 64;
  const data = new Uint8Array(size * size * 4);

  for (let y = 0; y < size; y++) {
    // y=0 é a base da esfera em UV padrão Three.js, y=63 é o topo
    const ny = (y - 31.5) / 31.5;
    for (let x = 0; x < size; x++) {
      const nx = (x - 31.5) / 31.5;
      const i = (y * size + x) * 4;

      const radial = Math.hypot(nx * 0.96, ny * 1.02);
      const dome = Math.max(0, 1 - radial * 0.88);
      // Vinheta suave nas bordas para integrar com o aro de vedação escuro
      const rimVignette = Math.max(0.28, 1 - Math.pow(Math.max(0, radial - 0.55) / 0.55, 1.8) * 0.65);

      // Reflexo curvo principal (arco superior esquerdo -> centro)
      const arcY = ny - (0.24 - nx * nx * 0.28);
      const primarySpec = Math.exp(-Math.pow(arcY / 0.13, 2)) * Math.exp(-Math.pow((nx + 0.18) / 0.58, 2));

      // Segundo filete fino de reflexo metálico
      const streak = Math.exp(-Math.pow((nx * 0.82 - ny * 0.52 + 0.26) / 0.09, 2)) * 0.55;

      // Sombra sutil do horizonte interno da viseira
      const horizonDip = Math.exp(-Math.pow((ny + 0.16) / 0.12, 2)) * 24;
      const scan = (y & 1) === 0 ? 3 : -2;

      const baseR = (38 + dome * 146 - horizonDip) * rimVignette;
      const baseG = (23 + dome * 98 - horizonDip * 0.72) * rimVignette;
      const baseB = (9 + dome * 28 - horizonDip * 0.3) * rimVignette;

      const specBoost = primarySpec * 88 + streak * 64;
      const r = baseR + specBoost + scan;
      const g = baseG + specBoost * 0.82 + scan;
      const b = baseB + specBoost * 0.42 + scan * 0.5;

      data[i] = clampByte(r);
      data[i + 1] = clampByte(g);
      data[i + 2] = clampByte(b);
      data[i + 3] = 255;
    }
  }

  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Módulo frontal DCM (Display & Control Module) do traje espacial.
 */
function createEvaChestPanelTexture(): THREE.DataTexture {
  const size = 64;
  const data = new Uint8Array(size * size * 4);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const border = x < 4 || x >= 60 || y < 4 || y >= 60;
      let r = border ? 56 : 82;
      let g = border ? 60 : 86;
      let b = border ? 68 : 94;

      // Mostrador circular esquerdo de pressão O2
      const dDial = Math.hypot(x - 20, y - 24);
      if (dDial < 11) {
        r = 24;
        g = 28;
        b = 26;
        if (dDial > 8.8) {
          r = 150;
          g = 154;
          b = 160;
        } else if (Math.abs(x - 20 - (24 - y) * 0.7) < 1.2 && y <= 24) {
          r = 224;
          g = 172;
          b = 76;
        }
      }

      // Barras de status e chaves seletoras à direita
      if (x >= 36 && x <= 54 && y >= 14 && y <= 20) {
        r = x < 47 ? 88 : 168;
        g = x < 47 ? 156 : 64;
        b = x < 47 ? 96 : 52;
      }
      if (x >= 36 && x <= 54 && y >= 27 && y <= 34 && x % 6 < 4) {
        r = 168;
        g = 172;
        b = 178;
      }

      // Conector inferior listrado
      if (y >= 44 && y <= 53 && x >= 12 && x <= 52) {
        const stripe = ((x + y) >> 2) & 1;
        r = stripe ? 154 : 44;
        g = stripe ? 118 : 46;
        b = stripe ? 42 : 50;
      }

      const grit = (hash2(x, y, 443) - 0.5) * 10;
      data[i] = clampByte(r + grit);
      data[i + 1] = clampByte(g + grit);
      data[i + 2] = clampByte(b + grit);
      data[i + 3] = 255;
    }
  }

  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Manômetro analógico de pulso (O2 / Pressão do traje) no antebraço esquerdo do astronauta.
 */
function createEvaGaugeDialTexture(): THREE.DataTexture {
  const size = 32;
  const data = new Uint8Array(size * size * 4);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const dx = x - 15.5;
      const dy = y - 15.5;
      const rDist = Math.hypot(dx, dy);
      let r = 22;
      let g = 26;
      let b = 25;

      if (rDist > 13.2) {
        r = 88;
        g = 94;
        b = 104;
      } else if (rDist > 10.6) {
        const ang = Math.atan2(dy, dx);
        const tick = Math.abs(Math.sin(ang * 6)) > 0.92;
        if (tick) {
          r = ang > 0.6 ? 196 : 196;
          g = ang > 0.6 ? 72 : 192;
          b = ang > 0.6 ? 62 : 168;
        }
      } else if (rDist < 2.1) {
        r = 182;
        g = 152;
        b = 88;
      }

      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    }
  }

  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
}

function getAstronautTextures(): AstronautTextureCache {
  if (!cachedAstronautTextures) {
    cachedAstronautTextures = {
      suitFabricTex: createEvaSuitFabricTexture(),
      astroCamoTex: createAstronautCamoTexture(),
      ribbedJointTex: createEvaRibbedJointTexture(),
      goldVisorTex: createEvaGoldVisorTexture(),
      chestPanelTex: createEvaChestPanelTexture(),
      gaugeDialTex: createEvaGaugeDialTexture(),
    };
  }
  return cachedAstronautTextures;
}

/**
 * Cria o conjunto de materiais do Astronauta:
 * - Se `sharedUniforms` for fornecido, utiliza o shader DOOM (`COLORMAP` + lanterna + arandelas) para o corpo 3D no mundo.
 * - Caso contrário, cria materiais `MeshLambertMaterial` com as exatas mesmas texturas pixel-art para a cena de 1ª pessoa (`viewScene`).
 */
export function createAstronautMaterials(
  sharedUniforms?: DoomSharedUniforms
): AstronautMaterialSet {
  const tex = getAstronautTextures();

  if (sharedUniforms) {
    return {
      suitFabric: createDoomPropMaterial(tex.suitFabricTex, sharedUniforms, {
        baseLight: 0.24,
        tint: new THREE.Color(0xd2cdc0),
      }),
      astroCamo: createDoomPropMaterial(tex.astroCamoTex, sharedUniforms, {
        baseLight: 0.26,
        tint: new THREE.Color(0xe6e8ee),
      }),
      suitDarkPatch: createDoomPropMaterial(tex.suitFabricTex, sharedUniforms, {
        baseLight: 0.22,
        tint: new THREE.Color(0x4a4e57),
      }),
      ribbedJoint: createDoomPropMaterial(tex.ribbedJointTex, sharedUniforms, {
        baseLight: 0.22,
        tint: new THREE.Color(0x9da3b0),
      }),
      anodizedCrimson: createDoomPropMaterial(
        tex.suitFabricTex,
        sharedUniforms,
        {
          baseLight: 0.25,
          tint: new THREE.Color(0x9e342e),
        }
      ),
      anodizedCobalt: createDoomPropMaterial(
        tex.suitFabricTex,
        sharedUniforms,
        {
          baseLight: 0.25,
          tint: new THREE.Color(0x3a587a),
        }
      ),
      missionOrange: createDoomPropMaterial(tex.suitFabricTex, sharedUniforms, {
        baseLight: 0.25,
        tint: new THREE.Color(0xb86228),
      }),
      machinedAlloy: createDoomPropMaterial(tex.suitFabricTex, sharedUniforms, {
        baseLight: 0.25,
        tint: new THREE.Color(0x9ea5b2),
      }),
      darkSteel: createDoomPropMaterial(tex.ribbedJointTex, sharedUniforms, {
        baseLight: 0.2,
        tint: new THREE.Color(0x525763),
      }),
      goldVisor: createDoomPropMaterial(tex.goldVisorTex, sharedUniforms, {
        baseLight: 0.3,
        emissiveBoost: 0.05,
      }),
      chestPanel: createDoomPropMaterial(tex.chestPanelTex, sharedUniforms, {
        baseLight: 0.28,
        emissiveBoost: 0.04,
      }),
      gaugeDial: createDoomPropMaterial(tex.gaugeDialTex, sharedUniforms, {
        baseLight: 0.34,
        emissiveBoost: 0.08,
      }),
      bootRubber: createDoomPropMaterial(tex.ribbedJointTex, sharedUniforms, {
        baseLight: 0.2,
        tint: new THREE.Color(0x3d4048),
      }),
    };
  }

  return {
    suitFabric: new THREE.MeshLambertMaterial({
      map: tex.suitFabricTex,
      color: 0xd8d3c6,
      flatShading: true,
    }),
    astroCamo: new THREE.MeshLambertMaterial({
      map: tex.astroCamoTex,
      color: 0xe6e8ee,
      flatShading: true,
    }),
    suitDarkPatch: new THREE.MeshLambertMaterial({
      map: tex.suitFabricTex,
      color: 0x454952,
      flatShading: true,
    }),
    ribbedJoint: new THREE.MeshLambertMaterial({
      map: tex.ribbedJointTex,
      color: 0x9aa0ad,
      flatShading: true,
    }),
    anodizedCrimson: new THREE.MeshLambertMaterial({
      color: 0xa6352f,
      flatShading: true,
    }),
    anodizedCobalt: new THREE.MeshLambertMaterial({
      color: 0x3b5b7e,
      flatShading: true,
    }),
    missionOrange: new THREE.MeshLambertMaterial({
      color: 0xc4682b,
      flatShading: true,
    }),
    machinedAlloy: new THREE.MeshLambertMaterial({
      color: 0x9ea6b4,
      flatShading: true,
    }),
    darkSteel: new THREE.MeshLambertMaterial({
      color: 0x343842,
      flatShading: true,
    }),
    goldVisor: new THREE.MeshLambertMaterial({
      map: tex.goldVisorTex,
      color: 0xffffff,
      flatShading: true,
    }),
    chestPanel: new THREE.MeshLambertMaterial({
      map: tex.chestPanelTex,
      color: 0xffffff,
      flatShading: true,
    }),
    gaugeDial: new THREE.MeshBasicMaterial({
      map: tex.gaugeDialTex,
    }),
    bootRubber: new THREE.MeshLambertMaterial({
      color: 0x292c33,
      flatShading: true,
    }),
  };
}

/**
 * Constrói um dos BRAÇOS ORIGINAIS ARTICULADOS DO ASTRONAUTA (`left` ou `right`),
 * explicitamente marcado em `name` e `userData` como braço ativo do protagonista:
 * - Ombro pressurizado + braço acolchoado com faixa de missão EVA;
 * - Fole sanfonado de borracha no cotovelo + antebraço pressurizado;
 * - Módulo de pulso de telemetria/manômetro O2 (braço esquerdo) e trava de ancoragem EVA (braço direito);
 * - Anel rotativo anodizado de desconexão de punho com 4 travas baioneta;
 * - Luva espacial EVA de 5 dedos articulados (palma emborrachada, juntas escuras, polegar articulado) + `gripSocket`.
 *
 * Sistema de coordenadas local neutro (cotovelo/punho em 0):
 * - Eixo longitudinal do braço: `-Y` (gire `elbowPivot.rotation.x = +Math.PI/2` para apontar para `-Z`);
 * - Dorso da mão/antebraço: `+sign * X` (`sign = +1` direito, `-1` esquerdo);
 * - Palma da mão: `-sign * X`;
 * - Lado do polegar/indicador: `-Z`; lado do mínimo: `+Z`.
 */
export function createAstronautArmRig(
  side: AstronautArmSide,
  materials: AstronautMaterialSet,
  options: { includeUpperArm?: boolean } = {}
): AstronautArmRig {
  const includeUpperArm = options.includeUpperArm ?? true;
  const sign = side === 'right' ? 1 : -1;
  const sideLabel = side === 'right' ? 'Right' : 'Left';

  const metadata: AstronautArmMetadata = {
    isAstronautArm: true,
    isActiveGameplayArm: true,
    characterId: 'protagonist_astronaut',
    armSide: side,
    armRole:
      side === 'right' ? 'right_lantern_arm' : 'left_item_and_knife_arm',
    usedInAnimations:
      side === 'right'
        ? ['lantern_equip', 'lantern_hold', 'lantern_switch_click', 'lantern_drop']
        : ['knife', 'bandage', 'morphine', 'battery', 'flare', 'key'],
    currentlyInUse: false,
  };

  const root = new THREE.Group();
  root.name = `Astronaut${sideLabel}Arm`;
  root.userData = { ...metadata };

  const shoulderPivot = new THREE.Group();
  shoulderPivot.name = `Astronaut${sideLabel}Shoulder`;
  shoulderPivot.userData = { isAstronautArmJoint: true, armSide: side };
  root.add(shoulderPivot);

  const upperArmGroup = new THREE.Group();
  upperArmGroup.name = `Astronaut${sideLabel}UpperArm`;
  shoulderPivot.add(upperArmGroup);

  if (includeUpperArm) {
    // Anel metálico inclinado da junta do ombro (scye bearing)
    const shoulderRing = new THREE.Mesh(
      new THREE.CylinderGeometry(0.074, 0.074, 0.024, 12),
      materials.machinedAlloy
    );
    shoulderRing.rotation.z = sign * 0.34;
    shoulderRing.position.set(0, -0.008, 0);
    upperArmGroup.add(shoulderRing);

    const shoulderBellows = new THREE.Mesh(
      new THREE.CylinderGeometry(0.068, 0.071, 0.052, 10),
      materials.ribbedJoint
    );
    shoulderBellows.position.set(0, -0.036, 0);
    upperArmGroup.add(shoulderBellows);

    // Manga superior acolchoada em Camuflagem Astronáutica EVA + ombreira tática esculpida
    const upperSleeve = new THREE.Mesh(
      new THREE.CylinderGeometry(0.068, 0.06, 0.175, 12),
      materials.astroCamo
    );
    upperSleeve.position.set(0, -0.142, 0);
    upperArmGroup.add(upperSleeve);

    // Ombreira composta chanfrada (pauldron EVA) com placa camuflada e friso metálico
    const shoulderPauldron = new THREE.Mesh(
      new THREE.CylinderGeometry(
        0.075,
        0.071,
        0.086,
        10,
        1,
        false,
        sign > 0 ? -Math.PI * 0.42 : Math.PI * 0.58,
        Math.PI * 0.84
      ),
      materials.astroCamo
    );
    shoulderPauldron.position.set(0, -0.098, 0);
    upperArmGroup.add(shoulderPauldron);

    // Faixa de identificação espacial / insígnia EVA no deltoide externo + cinta de bíceps
    const missionBand = new THREE.Mesh(
      new THREE.CylinderGeometry(0.0705, 0.0685, 0.026, 12),
      side === 'right' ? materials.missionOrange : materials.anodizedCobalt
    );
    missionBand.position.set(0, -0.108, 0);
    upperArmGroup.add(missionBand);

    const bicepStrap = new THREE.Mesh(
      new THREE.CylinderGeometry(0.064, 0.062, 0.018, 12),
      materials.suitDarkPatch
    );
    bicepStrap.position.set(0, -0.188, 0);
    upperArmGroup.add(bicepStrap);

    const deltoidPatch = new THREE.Mesh(
      new THREE.BoxGeometry(0.014, 0.054, 0.044),
      materials.darkSteel
    );
    deltoidPatch.position.set(sign * 0.064, -0.148, 0);
    upperArmGroup.add(deltoidPatch);
  }

  // Pivô do cotovelo
  const elbowPivot = new THREE.Group();
  elbowPivot.name = `Astronaut${sideLabel}Elbow`;
  elbowPivot.userData = { isAstronautArmJoint: true, armSide: side };
  elbowPivot.position.set(0, includeUpperArm ? -0.245 : 0, 0);
  shoulderPivot.add(elbowPivot);

  const forearmGroup = new THREE.Group();
  forearmGroup.name = `Astronaut${sideLabel}Forearm`;
  elbowPivot.add(forearmGroup);

  // Fole sanfonado de borracha pressurizada no cotovelo + cotoveleira traseira blindada
  for (let b = 0; b < 3; b++) {
    const pleat = new THREE.Mesh(
      new THREE.CylinderGeometry(0.061, 0.063, 0.017, 12),
      materials.ribbedJoint
    );
    pleat.position.set(0, -0.008 - b * 0.019, 0);
    forearmGroup.add(pleat);
  }

  const elbowPad = new THREE.Mesh(
    new THREE.BoxGeometry(0.058, 0.066, 0.028),
    materials.darkSteel
  );
  elbowPad.position.set(0, -0.024, 0.05);
  forearmGroup.add(elbowPad);

  // Manga principal do antebraço inteiramente revestida em Camuflagem Astronáutica EVA!
  const forearmSleeve = new THREE.Mesh(
    new THREE.CylinderGeometry(0.062, 0.052, 0.168, 14),
    materials.astroCamo
  );
  forearmSleeve.position.set(0, -0.132, 0);
  forearmGroup.add(forearmSleeve);

  // Duas cintas táticas de contenção em nylon escuro com fivelas metálicas envolvendo a camuflagem
  for (const [sy, rTop, rBot] of [
    [-0.078, 0.0615, 0.0605],
    [-0.186, 0.0555, 0.054],
  ] as const) {
    const restraintStrap = new THREE.Mesh(
      new THREE.CylinderGeometry(rTop, rBot, 0.015, 14),
      materials.suitDarkPatch
    );
    restraintStrap.position.set(0, sy, 0);
    forearmGroup.add(restraintStrap);

    const strapBuckle = new THREE.Mesh(
      new THREE.BoxGeometry(0.016, 0.021, 0.022),
      materials.machinedAlloy
    );
    strapBuckle.position.set(-sign * (rTop - 0.004), sy, -0.024);
    strapBuckle.rotation.y = sign * 0.45;
    forearmGroup.add(strapBuckle);
  }

  // Mangueira umbilical pressurizada trançada percorrendo a lateral radial visível do antebraço!
  const umbilicalTube = new THREE.Mesh(
    new THREE.CylinderGeometry(0.0068, 0.0068, 0.148, 8),
    materials.ribbedJoint
  );
  umbilicalTube.position.set(-sign * 0.049, -0.132, -0.028);
  umbilicalTube.rotation.z = -sign * 0.055;
  forearmGroup.add(umbilicalTube);

  for (const fy of [-0.06, -0.202]) {
    const fitting = new THREE.Mesh(
      new THREE.CylinderGeometry(0.0095, 0.0095, 0.014, 8),
      side === 'right' ? materials.anodizedCrimson : materials.anodizedCobalt
    );
    fitting.position.set(-sign * 0.048, fy, -0.028);
    forearmGroup.add(fitting);
  }

  // Placa dorsal blindada camuflada ao longo da face externa do antebraço
  const dorsalCamoPlate = new THREE.Mesh(
    new THREE.BoxGeometry(0.016, 0.126, 0.054),
    materials.astroCamo
  );
  dorsalCamoPlate.position.set(sign * 0.053, -0.134, 0);
  const dorsalSteelTrim = new THREE.Mesh(
    new THREE.BoxGeometry(0.012, 0.132, 0.024),
    materials.darkSteel
  );
  dorsalSteelTrim.position.set(sign * 0.056, -0.134, 0);
  forearmGroup.add(dorsalCamoPlate, dorsalSteelTrim);

  let gaugeNeedleMesh: THREE.Mesh | null = null;

  if (side === 'left') {
    // Antebraço ESQUERDO: Módulo EVA de Pulso com Manômetro Analógico O2/Pressão (visível nas animações de faca/itens!)
    const cuffHousing = new THREE.Mesh(
      new THREE.BoxGeometry(0.028, 0.074, 0.064),
      materials.darkSteel
    );
    cuffHousing.position.set(0.036, -0.138, -0.032);
    cuffHousing.rotation.y = 0.68;
    forearmGroup.add(cuffHousing);

    const dialBezel = new THREE.Mesh(
      new THREE.CylinderGeometry(0.022, 0.023, 0.01, 12),
      materials.machinedAlloy
    );
    dialBezel.rotation.z = -Math.PI * 0.5;
    dialBezel.rotation.y = 0.68;
    dialBezel.position.set(0.046, -0.128, -0.04);
    forearmGroup.add(dialBezel);

    const dialFace = new THREE.Mesh(
      new THREE.CircleGeometry(0.019, 12),
      materials.gaugeDial
    );
    dialFace.rotation.order = 'YXZ';
    dialFace.rotation.y = Math.PI * 0.5 + 0.68;
    dialFace.position.set(0.05, -0.128, -0.043);
    forearmGroup.add(dialFace);

    gaugeNeedleMesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.003, 0.013, 0.003),
      materials.missionOrange
    );
    gaugeNeedleMesh.position.set(0.051, -0.124, -0.044);
    gaugeNeedleMesh.rotation.x = 0.42;
    forearmGroup.add(gaugeNeedleMesh);

    const btnA = new THREE.Mesh(
      new THREE.BoxGeometry(0.008, 0.01, 0.012),
      materials.anodizedCrimson
    );
    btnA.position.set(0.046, -0.158, -0.032);
    const btnB = new THREE.Mesh(
      new THREE.BoxGeometry(0.008, 0.01, 0.012),
      materials.anodizedCobalt
    );
    btnB.position.set(0.038, -0.158, -0.046);
    forearmGroup.add(btnA, btnB);
  } else {
    // Antebraço DIREITO: Braçadeira Camuflada de Checklist EVA + Faixa Laranja + Pinos de Telemetria (visível com a lanterna!)
    const rightStripe = new THREE.Mesh(
      new THREE.CylinderGeometry(0.0585, 0.0565, 0.019, 14),
      materials.missionOrange
    );
    rightStripe.position.set(0, -0.156, 0);
    forearmGroup.add(rightStripe);

    const checklistFrame = new THREE.Mesh(
      new THREE.BoxGeometry(0.016, 0.068, 0.044),
      materials.darkSteel
    );
    checklistFrame.position.set(-0.041, -0.128, -0.036);
    checklistFrame.rotation.y = -0.68;
    forearmGroup.add(checklistFrame);

    const checklistCamoCover = new THREE.Mesh(
      new THREE.BoxGeometry(0.008, 0.054, 0.034),
      materials.astroCamo
    );
    checklistCamoCover.position.set(-0.045, -0.128, -0.039);
    checklistCamoCover.rotation.y = -0.68;
    forearmGroup.add(checklistCamoCover);

    const pipA = new THREE.Mesh(
      new THREE.BoxGeometry(0.007, 0.008, 0.008),
      materials.missionOrange
    );
    pipA.position.set(-0.047, -0.108, -0.035);
    const pipB = new THREE.Mesh(
      new THREE.BoxGeometry(0.007, 0.008, 0.008),
      materials.anodizedCobalt
    );
    pipB.position.set(-0.042, -0.108, -0.045);
    forearmGroup.add(pipA, pipB);
  }

  // Anel rotativo anodizado de desconexão de punho com 6 travas baioneta usinadas
  const wristRingGroup = new THREE.Group();
  wristRingGroup.name = `Astronaut${sideLabel}WristRing`;
  wristRingGroup.position.set(0, -0.218, 0);
  forearmGroup.add(wristRingGroup);

  const ringFlangeUpper = new THREE.Mesh(
    new THREE.CylinderGeometry(0.055, 0.055, 0.012, 14),
    materials.machinedAlloy
  );
  ringFlangeUpper.position.y = 0.009;
  const ringAnodizedCore = new THREE.Mesh(
    new THREE.CylinderGeometry(0.057, 0.057, 0.015, 14),
    side === 'right' ? materials.anodizedCrimson : materials.anodizedCobalt
  );
  const ringFlangeLower = new THREE.Mesh(
    new THREE.CylinderGeometry(0.054, 0.054, 0.01, 14),
    materials.machinedAlloy
  );
  ringFlangeLower.position.y = -0.011;
  wristRingGroup.add(ringFlangeUpper, ringAnodizedCore, ringFlangeLower);

  for (let l = 0; l < 6; l++) {
    const ang = (l / 6) * Math.PI * 2 + 0.35;
    const lug = new THREE.Mesh(
      new THREE.BoxGeometry(0.012, 0.02, 0.012),
      materials.darkSteel
    );
    lug.position.set(Math.cos(ang) * 0.056, 0, Math.sin(ang) * 0.056);
    lug.rotation.y = -ang;
    wristRingGroup.add(lug);
  }

  // Pivô da mão / luva espacial EVA
  const wristPivot = new THREE.Group();
  wristPivot.name = `Astronaut${sideLabel}Wrist`;
  wristPivot.position.set(0, -0.232, 0);
  elbowPivot.add(wristPivot);

  const gloveGroup = new THREE.Group();
  gloveGroup.name = `Astronaut${sideLabel}Glove`;
  gloveGroup.userData = { isAstronautGlove: true, armSide: side };
  wristPivot.add(gloveGroup);

  // Punho e casco metacarpal revestidos em Camuflagem Astronáutica + protetor de juntas e palma de silicone
  const gloveCuff = new THREE.Mesh(
    new THREE.CylinderGeometry(0.051, 0.048, 0.024, 12),
    materials.astroCamo
  );
  gloveCuff.position.set(0, -0.01, 0);

  const metacarpalShell = new THREE.Mesh(
    new THREE.BoxGeometry(0.044, 0.068, 0.078),
    materials.astroCamo
  );
  metacarpalShell.position.set(sign * 0.004, -0.046, 0);

  const dorsalArmorStrip = new THREE.Mesh(
    new THREE.BoxGeometry(0.01, 0.046, 0.064),
    materials.darkSteel
  );
  dorsalArmorStrip.position.set(sign * 0.024, -0.042, 0);

  const palmGripPad = new THREE.Mesh(
    new THREE.BoxGeometry(0.016, 0.06, 0.07),
    materials.bootRubber
  );
  palmGripPad.position.set(-sign * 0.018, -0.048, 0);

  const knuckleArmor = new THREE.Mesh(
    new THREE.BoxGeometry(0.014, 0.02, 0.076),
    materials.machinedAlloy
  );
  knuckleArmor.position.set(sign * 0.024, -0.068, 0);

  gloveGroup.add(
    gloveCuff,
    metacarpalShell,
    dorsalArmorStrip,
    palmGripPad,
    knuckleArmor
  );

  // 4 dedos articulados da luva EVA (segmentos em camuflagem astronáutica + juntas sanfonadas + pontas aderentes)
  const fingers: AstronautFingerRig[] = [];
  const fingerLengths = [0.032, 0.035, 0.033, 0.028];

  for (let f = 0; f < 4; f++) {
    const fz = -0.027 + f * 0.018;
    const pLen = fingerLengths[f];

    const proxPivot = new THREE.Group();
    proxPivot.position.set(sign * 0.008, -0.078, fz);

    const proxJoint = new THREE.Mesh(
      new THREE.CylinderGeometry(0.0085, 0.0085, 0.016, 6),
      materials.ribbedJoint
    );
    proxJoint.rotation.x = Math.PI * 0.5;

    const proxSeg = new THREE.Mesh(
      new THREE.BoxGeometry(0.02, pLen, 0.016),
      materials.astroCamo
    );
    proxSeg.position.set(0, -pLen * 0.5, 0);

    proxPivot.add(proxJoint, proxSeg);

    const distPivot = new THREE.Group();
    distPivot.position.set(0, -pLen, 0);

    const midRing = new THREE.Mesh(
      new THREE.CylinderGeometry(0.0078, 0.0078, 0.015, 6),
      materials.ribbedJoint
    );
    midRing.rotation.x = Math.PI * 0.5;

    const dLen = pLen * 0.82;
    const distSeg = new THREE.Mesh(
      new THREE.BoxGeometry(0.018, dLen, 0.015),
      materials.astroCamo
    );
    distSeg.position.set(0, -dLen * 0.45, 0);

    const tipCap = new THREE.Mesh(
      new THREE.BoxGeometry(0.0185, 0.012, 0.0155),
      materials.bootRubber
    );
    tipCap.position.set(-sign * 0.001, -dLen * 0.92, 0);

    distPivot.add(midRing, distSeg, tipCap);
    proxPivot.add(distPivot);
    gloveGroup.add(proxPivot);

    fingers.push({ proxPivot, distPivot });
  }

  // Polegar articulado em 2 segmentos na borda radial (-Z)
  const thumbPivot = new THREE.Group();
  thumbPivot.name = `Astronaut${sideLabel}ThumbBase`;
  thumbPivot.position.set(-sign * 0.008, -0.042, -0.038);
  gloveGroup.add(thumbPivot);

  const thumbBaseMesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.022, 0.032, 0.022),
    materials.astroCamo
  );
  thumbBaseMesh.position.set(0, -0.015, -0.006);
  thumbPivot.add(thumbBaseMesh);

  const thumbJointRing = new THREE.Mesh(
    new THREE.CylinderGeometry(0.009, 0.009, 0.02, 6),
    materials.ribbedJoint
  );
  thumbJointRing.rotation.z = Math.PI * 0.5;
  thumbJointRing.position.set(0, -0.031, -0.008);
  thumbPivot.add(thumbJointRing);

  const thumbTipPivot = new THREE.Group();
  thumbTipPivot.name = `Astronaut${sideLabel}ThumbTip`;
  thumbTipPivot.position.set(0, -0.032, -0.008);
  thumbPivot.add(thumbTipPivot);

  const thumbTipMesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.019, 0.026, 0.019),
    materials.bootRubber
  );
  thumbTipMesh.position.set(0, -0.013, -0.002);
  thumbTipPivot.add(thumbTipMesh);

  // Soquete canônico de empunhadura dentro da palma da mão
  const gripSocket = new THREE.Group();
  gripSocket.name = `Astronaut${sideLabel}GripSocket`;
  gripSocket.userData = { isItemGripSocket: true, armSide: side };
  gripSocket.position.set(-sign * 0.022, -0.068, 0);
  gloveGroup.add(gripSocket);

  const setGripPose = (pose: AstronautGripPose): void => {
    for (let f = 0; f < 4; f++) {
      const fg = fingers[f];
      const stagger = f * 0.04;
      fg.proxPivot.rotation.order = 'XYZ';
      if (pose === 'relaxed') {
        fg.proxPivot.rotation.set(0, 0, -sign * (0.28 + stagger));
        fg.distPivot.rotation.set(0, 0, -sign * (0.32 + stagger));
      } else if (pose === 'sprawled') {
        fg.proxPivot.rotation.set((f - 1.5) * 0.06, 0, -sign * 0.14);
        fg.distPivot.rotation.set(0, 0, -sign * 0.18);
      } else if (pose === 'flashlight') {
        const inv = 3 - f;
        fg.proxPivot.rotation.set(
          -0.32 - inv * 0.12,
          sign * 0.14,
          -sign * (0.28 + f * 0.08)
        );
        fg.distPivot.rotation.set(0, 0, -sign * (0.34 + f * 0.09));
      } else if (pose === 'knife' || pose === 'cylindrical') {
        fg.proxPivot.rotation.set(0, 0, -sign * (1.32 + stagger * 0.4));
        fg.distPivot.rotation.set(0, 0, -sign * 1.38);
      } else if (pose === 'box') {
        fg.proxPivot.rotation.set(0, 0, -sign * (0.86 + stagger * 0.3));
        fg.distPivot.rotation.set(0, 0, -sign * 0.92);
      } else if (pose === 'key') {
        // Pinça firme indicador+médio na argola da chave, anelar+mínimo recolhidos
        const curl = f < 2 ? 0.95 : 1.38;
        fg.proxPivot.rotation.set(0, 0, -sign * curl);
        fg.distPivot.rotation.set(0, 0, -sign * (curl + 0.12));
      }
    }

    thumbPivot.rotation.order = 'XYZ';
    thumbTipPivot.rotation.order = 'XYZ';
    if (pose === 'relaxed') {
      thumbPivot.rotation.set(0.32, 0, -sign * 0.25);
      thumbTipPivot.rotation.set(0.18, 0, -sign * 0.18);
    } else if (pose === 'sprawled') {
      thumbPivot.rotation.set(0.45, 0, -sign * 0.1);
      thumbTipPivot.rotation.set(0.1, 0, 0);
    } else if (pose === 'flashlight') {
      // Polegar apoiado naturalmente ao longo do topo/lateral da lanterna próximo ao botão!
      thumbPivot.rotation.set(-0.08, sign * 0.2, -sign * 0.38);
      thumbTipPivot.rotation.set(-0.1, 0, -sign * 0.32);
    } else if (pose === 'knife' || pose === 'cylindrical') {
      thumbPivot.rotation.set(0.75, -sign * 0.35, -sign * 0.78);
      thumbTipPivot.rotation.set(0.35, 0, -sign * 0.55);
    } else if (pose === 'box') {
      thumbPivot.rotation.set(0.55, -sign * 0.22, -sign * 0.54);
      thumbTipPivot.rotation.set(0.25, 0, -sign * 0.38);
    } else if (pose === 'key') {
      thumbPivot.rotation.set(0.68, -sign * 0.28, -sign * 0.72);
      thumbTipPivot.rotation.set(0.32, 0, -sign * 0.42);
    }
  };

  const setInUse = (inUse: boolean): void => {
    metadata.currentlyInUse = inUse;
    root.userData.currentlyInUse = inUse;
  };

  setGripPose('relaxed');

  return {
    side,
    root,
    shoulderPivot,
    upperArmGroup,
    elbowPivot,
    forearmGroup,
    wristRingGroup,
    wristPivot,
    gloveGroup,
    gripSocket,
    thumbPivot,
    thumbTipPivot,
    thumbTipMesh,
    fingers,
    gaugeNeedleMesh,
    metadata,
    setGripPose,
    setInUse,
  };
}

interface AstronautLegRig {
  readonly hipPivot: THREE.Group;
  readonly kneePivot: THREE.Group;
  readonly anklePivot: THREE.Group;
}

function createAstronautLegRig(
  side: AstronautArmSide,
  materials: AstronautMaterialSet
): AstronautLegRig {
  const sign = side === 'right' ? 1 : -1;
  const sideLabel = side === 'right' ? 'Right' : 'Left';

  const hipPivot = new THREE.Group();
  hipPivot.name = `Astronaut${sideLabel}Leg`;

  const hipBearing = new THREE.Mesh(
    new THREE.SphereGeometry(0.09, 10, 8),
    materials.ribbedJoint
  );
  hipBearing.position.set(0, -0.015, 0);
  hipPivot.add(hipBearing);

  const hipBellows = new THREE.Mesh(
    new THREE.CylinderGeometry(0.088, 0.092, 0.06, 10),
    materials.ribbedJoint
  );
  hipBellows.position.set(0, -0.03, 0);
  hipPivot.add(hipBellows);

  const thigh = new THREE.Mesh(
    new THREE.CylinderGeometry(0.092, 0.08, 0.31, 12),
    materials.astroCamo
  );
  thigh.position.set(0, -0.2, 0);
  hipPivot.add(thigh);

  // Bolso utilitário lateral na coxa
  const cargoPocket = new THREE.Mesh(
    new THREE.BoxGeometry(0.03, 0.12, 0.095),
    materials.suitDarkPatch
  );
  cargoPocket.position.set(sign * 0.084, -0.2, 0);
  hipPivot.add(cargoPocket);

  const thighStripe = new THREE.Mesh(
    new THREE.CylinderGeometry(0.085, 0.083, 0.024, 12),
    side === 'right' ? materials.missionOrange : materials.anodizedCobalt
  );
  thighStripe.position.set(0, -0.31, 0);
  hipPivot.add(thighStripe);

  // Joelho articulado com fole sanfonado + joelheira blindada
  const kneePivot = new THREE.Group();
  kneePivot.name = `Astronaut${sideLabel}Knee`;
  kneePivot.position.set(0, -0.37, 0);
  hipPivot.add(kneePivot);

  const kneeBellows = new THREE.Mesh(
    new THREE.CylinderGeometry(0.078, 0.078, 0.07, 12),
    materials.ribbedJoint
  );
  kneeBellows.position.set(0, -0.02, 0);
  kneePivot.add(kneeBellows);

  const kneeCap = new THREE.Mesh(
    new THREE.BoxGeometry(0.094, 0.092, 0.038),
    materials.darkSteel
  );
  kneeCap.position.set(0, -0.018, -0.068);
  kneePivot.add(kneeCap);

  const shin = new THREE.Mesh(
    new THREE.CylinderGeometry(0.08, 0.07, 0.29, 12),
    materials.astroCamo
  );
  shin.position.set(0, -0.19, 0);
  kneePivot.add(shin);

  const ankleRing = new THREE.Mesh(
    new THREE.CylinderGeometry(0.074, 0.074, 0.022, 12),
    materials.machinedAlloy
  );
  ankleRing.position.set(0, -0.34, 0);
  kneePivot.add(ankleRing);

  // Bota lunar magnética pesada com travas metálicas e solado tratorado
  const anklePivot = new THREE.Group();
  anklePivot.name = `Astronaut${sideLabel}Boot`;
  anklePivot.position.set(0, -0.355, 0);
  kneePivot.add(anklePivot);

  const bootCuff = new THREE.Mesh(
    new THREE.BoxGeometry(0.145, 0.075, 0.175),
    materials.astroCamo
  );
  bootCuff.position.set(0, -0.035, -0.015);

  const bootVamp = new THREE.Mesh(
    new THREE.BoxGeometry(0.15, 0.07, 0.245),
    materials.suitFabric
  );
  bootVamp.position.set(0, -0.082, -0.048);

  const toeArmor = new THREE.Mesh(
    new THREE.BoxGeometry(0.154, 0.058, 0.092),
    materials.darkSteel
  );
  toeArmor.position.set(0, -0.09, -0.132);

  const buckleStrapA = new THREE.Mesh(
    new THREE.BoxGeometry(0.156, 0.018, 0.028),
    materials.machinedAlloy
  );
  buckleStrapA.position.set(0, -0.058, -0.065);

  const buckleStrapB = new THREE.Mesh(
    new THREE.BoxGeometry(0.156, 0.018, 0.028),
    materials.machinedAlloy
  );
  buckleStrapB.position.set(0, -0.072, -0.105);

  const bootSole = new THREE.Mesh(
    new THREE.BoxGeometry(0.162, 0.034, 0.268),
    materials.bootRubber
  );
  bootSole.position.set(0, -0.128, -0.048);

  anklePivot.add(
    bootCuff,
    bootVamp,
    toeArmor,
    buckleStrapA,
    buckleStrapB,
    bootSole
  );

  for (let t = 0; t < 4; t++) {
    const cleat = new THREE.Mesh(
      new THREE.BoxGeometry(0.158, 0.012, 0.032),
      materials.darkSteel
    );
    cleat.position.set(0, -0.146, 0.055 - t * 0.066);
    anklePivot.add(cleat);
  }

  return { hipPivot, kneePivot, anklePivot };
}

/**
 * Modelo 3D Completo e Articulado do Personagem Principal: ASTRONAUTA (`DoomAstronaut`).
 * - Possui capacete EVA com viseira dourada curva, colar rotativo, módulo peitoral DCM com mangueiras,
 *   mochila de suporte de vida PLSS com cilindros duplos de O2, cinto tático, pernas pressurizadas e botas lunares;
 * - Seus dois braços (`rightArm` e `leftArm`) são construídos pelo mesmo `createAstronautArmRig` usado em 1ª pessoa
 *   (`DoomFlashlight`) e marcados explicitamente como braços utilizados nas animações de lanterna, faca e itens;
 * - Visível ao olhar para baixo durante a exploração e estendido à frente quando a aranha arrasta o jogador!
 */
export class DoomAstronaut {
  readonly root = new THREE.Group();
  readonly bodyPivot = new THREE.Group();
  readonly hipsGroup = new THREE.Group();
  readonly torsoGroup = new THREE.Group();
  readonly headGroup = new THREE.Group();
  readonly plssBackpack = new THREE.Group();
  private readonly upperChestGroup = new THREE.Group();

  readonly leftArm: AstronautArmRig;
  readonly rightArm: AstronautArmRig;
  private readonly leftLeg: AstronautLegRig;
  private readonly rightLeg: AstronautLegRig;
  private readonly materials: AstronautMaterialSet;

  private firstPersonMode = true;

  constructor(scene: THREE.Scene, sharedUniforms: DoomSharedUniforms) {
    this.root.name = 'DoomProtagonistAstronaut';
    this.root.userData = {
      characterId: 'protagonist_astronaut',
      role: 'playable_astronaut',
    };

    this.materials = createAstronautMaterials(sharedUniforms);

    this.bodyPivot.name = 'AstronautBodyPivot';
    this.root.add(this.bodyPivot);

    // 1. PELVE, ANEL DE CINTURA E PERNAS ARTICULADAS (altura do quadril y = 0.86m -> sola das botas y = 0.00m)
    this.hipsGroup.name = 'AstronautHips';
    this.hipsGroup.position.set(0, 0.86, 0);
    this.bodyPivot.add(this.hipsGroup);

    const pelvisBrief = new THREE.Mesh(
      new THREE.CylinderGeometry(0.185, 0.175, 0.14, 12),
      this.materials.astroCamo
    );
    pelvisBrief.scale.set(1.06, 1, 0.78);
    pelvisBrief.position.set(0, -0.09, 0);
    this.upperChestGroup.add(pelvisBrief);

    const utilityBelt = new THREE.Mesh(
      new THREE.CylinderGeometry(0.195, 0.195, 0.052, 12),
      this.materials.suitDarkPatch
    );
    utilityBelt.scale.set(1.06, 1, 0.8);
    utilityBelt.position.set(0, -0.032, 0);
    this.upperChestGroup.add(utilityBelt);

    const beltBuckle = new THREE.Mesh(
      new THREE.BoxGeometry(0.082, 0.056, 0.032),
      this.materials.machinedAlloy
    );
    beltBuckle.position.set(0, -0.032, -0.156);
    this.upperChestGroup.add(beltBuckle);

    for (const sideSign of [-1, 1]) {
      const hipPouch = new THREE.Mesh(
        new THREE.BoxGeometry(0.054, 0.086, 0.092),
        this.materials.darkSteel
      );
      hipPouch.position.set(sideSign * 0.205, -0.048, -0.02);
      this.upperChestGroup.add(hipPouch);
    }

    this.leftLeg = createAstronautLegRig('left', this.materials);
    this.leftLeg.hipPivot.position.set(-0.115, -0.035, 0);
    this.rightLeg = createAstronautLegRig('right', this.materials);
    this.rightLeg.hipPivot.position.set(0.115, -0.035, 0);
    this.hipsGroup.add(this.leftLeg.hipPivot, this.rightLeg.hipPivot);

    // 2. TRONCO PRESSURIZADO, MÓDULO PEITORAL DCM & MOCHILA PLSS
    this.torsoGroup.name = 'AstronautTorso';
    this.torsoGroup.position.set(0, 0.1, 0);
    this.hipsGroup.add(this.torsoGroup);

    this.upperChestGroup.name = 'AstronautUpperChest';
    this.torsoGroup.add(this.upperChestGroup);

    const waistBellows = new THREE.Mesh(
      new THREE.CylinderGeometry(0.182, 0.186, 0.08, 12),
      this.materials.ribbedJoint
    );
    waistBellows.scale.set(1.05, 1, 0.78);
    waistBellows.position.set(0, 0.04, 0);
    this.upperChestGroup.add(waistBellows);

    const chestShell = new THREE.Mesh(
      new THREE.CylinderGeometry(0.218, 0.188, 0.42, 14),
      this.materials.astroCamo
    );
    chestShell.scale.set(1.08, 1, 0.8);
    chestShell.position.set(0, 0.28, 0);
    this.upperChestGroup.add(chestShell);

    // Alças táticas do arnês PLSS cruzando os ombros com fivelas metálicas de peito
    for (const s of [-1, 1]) {
      const strap = new THREE.Mesh(
        new THREE.BoxGeometry(0.054, 0.415, 0.205),
        this.materials.suitDarkPatch
      );
      strap.position.set(s * 0.128, 0.286, 0.008);

      const strapBuckle = new THREE.Mesh(
        new THREE.BoxGeometry(0.06, 0.028, 0.024),
        this.materials.machinedAlloy
      );
      strapBuckle.position.set(s * 0.128, 0.385, -0.095);
      this.upperChestGroup.add(strap, strapBuckle);
    }

    // Módulo de Controle Peitoral (DCM) + 2 mangueiras umbilicais corrugadas
    const dcmBox = new THREE.Mesh(
      new THREE.BoxGeometry(0.2, 0.165, 0.058),
      this.materials.chestPanel
    );
    dcmBox.position.set(0, 0.285, -0.152);
    dcmBox.rotation.x = -0.08;
    this.upperChestGroup.add(dcmBox);

    for (const hs of [-1, 1]) {
      const hosePort = new THREE.Mesh(
        new THREE.CylinderGeometry(0.018, 0.018, 0.026, 8),
        hs < 0 ? this.materials.anodizedCobalt : this.materials.anodizedCrimson
      );
      hosePort.rotation.x = Math.PI * 0.5;
      hosePort.position.set(hs * 0.062, 0.19, -0.152);

      const hoseArc = new THREE.Mesh(
        new THREE.CylinderGeometry(0.015, 0.015, 0.15, 8),
        this.materials.ribbedJoint
      );
      hoseArc.position.set(hs * 0.072, 0.115, -0.148);
      hoseArc.rotation.z = hs * 0.16;
      this.upperChestGroup.add(hosePort, hoseArc);
    }

    // Mochila Tática de Suporte de Vida EVA (PLSS) acoplada rente às costas (+Z)
    this.plssBackpack.name = 'AstronautPLSSBackpack';
    this.plssBackpack.position.set(0, 0.285, 0.174);
    this.plssBackpack.rotation.x = -0.025;
    this.torsoGroup.add(this.plssBackpack);

    // 1) Sela anatômica acolchoada profunda que abraça toda a curvatura dorsal elíptica sem frestas laterais!
    const plssBackSaddle = new THREE.Mesh(
      new THREE.BoxGeometry(0.286, 0.408, 0.096),
      this.materials.suitDarkPatch
    );
    plssBackSaddle.position.set(0, 0.0, -0.038);

    // Mangueira corrugada superior de O2 alimentando o colar pressurizado do capacete
    for (const hs of [-1, 1]) {
      const helmetFeedHose = new THREE.Mesh(
        new THREE.CylinderGeometry(0.016, 0.016, 0.105, 8),
        this.materials.ribbedJoint
      );
      helmetFeedHose.position.set(hs * 0.068, 0.232, -0.032);
      helmetFeedHose.rotation.set(-0.58, 0, hs * 0.14);
      this.plssBackpack.add(helmetFeedHose);
    }

    // 2) Chassi blindado principal camuflado + carenagens laterais chanfradas
    const plssCoreChassis = new THREE.Mesh(
      new THREE.BoxGeometry(0.296, 0.386, 0.104),
      this.materials.astroCamo
    );
    plssCoreChassis.position.set(0, 0.006, 0.036);

    for (const ss of [-1, 1]) {
      const sideFairing = new THREE.Mesh(
        new THREE.BoxGeometry(0.048, 0.356, 0.098),
        this.materials.astroCamo
      );
      sideFairing.position.set(ss * 0.152, 0.006, 0.026);
      sideFairing.rotation.y = ss * 0.28;

      // Fitas laterais de ancoragem ligando a base da mochila ao cinto tático
      const waistTieStrap = new THREE.Mesh(
        new THREE.BoxGeometry(0.028, 0.038, 0.135),
        this.materials.suitDarkPatch
      );
      waistTieStrap.position.set(ss * 0.166, -0.165, -0.038);
      waistTieStrap.rotation.y = ss * 0.18;

      const topShoulderAnchor = new THREE.Mesh(
        new THREE.BoxGeometry(0.058, 0.034, 0.068),
        this.materials.machinedAlloy
      );
      topShoulderAnchor.position.set(ss * 0.126, 0.208, -0.022);

      this.plssBackpack.add(sideFairing, waistTieStrap, topShoulderAnchor);
    }

    // 3) Coifa superior do sublimador térmico + aletas do radiador + alça de resgate EVA
    const plssTopHood = new THREE.Mesh(
      new THREE.BoxGeometry(0.312, 0.062, 0.118),
      this.materials.machinedAlloy
    );
    plssTopHood.position.set(0, 0.214, 0.036);

    const plssTopCap = new THREE.Mesh(
      new THREE.BoxGeometry(0.278, 0.022, 0.098),
      this.materials.astroCamo
    );
    plssTopCap.position.set(0, 0.254, 0.032);

    const radiatorRecess = new THREE.Mesh(
      new THREE.BoxGeometry(0.236, 0.042, 0.018),
      this.materials.suitDarkPatch
    );
    radiatorRecess.position.set(0, 0.214, 0.092);

    for (let fin = 0; fin < 5; fin++) {
      const finMesh = new THREE.Mesh(
        new THREE.BoxGeometry(0.012, 0.034, 0.022),
        this.materials.darkSteel
      );
      finMesh.position.set(-0.088 + fin * 0.044, 0.214, 0.096);
      this.plssBackpack.add(finMesh);
    }

    // Alça superior rígida de extração/resgate em gravidade zero
    const grabBarCross = new THREE.Mesh(
      new THREE.CylinderGeometry(0.01, 0.01, 0.148, 8),
      this.materials.missionOrange
    );
    grabBarCross.rotation.z = Math.PI * 0.5;
    grabBarCross.position.set(0, 0.282, 0.048);

    for (const gs of [-1, 1]) {
      const grabPost = new THREE.Mesh(
        new THREE.CylinderGeometry(0.01, 0.012, 0.032, 8),
        this.materials.darkSteel
      );
      grabPost.position.set(gs * 0.068, 0.268, 0.048);
      this.plssBackpack.add(grabPost);
    }

    // 4) Módulo inferior de baterias / filtro de CO2 LiOH com travas industriais
    const plssBottomBattery = new THREE.Mesh(
      new THREE.BoxGeometry(0.306, 0.078, 0.118),
      this.materials.darkSteel
    );
    plssBottomBattery.position.set(0, -0.204, 0.036);

    for (const bs of [-1, 1]) {
      const batteryLatch = new THREE.Mesh(
        new THREE.BoxGeometry(0.046, 0.048, 0.018),
        this.materials.machinedAlloy
      );
      batteryLatch.position.set(bs * 0.096, -0.204, 0.096);
      this.plssBackpack.add(batteryLatch);
    }

    // 5) Cilindros gêmeos pressurizados (O2 azul à esquerda / reserva vermelha à direita) com calotas esféricas, braçadeiras e coletor de válvulas
    const manifoldPipe = new THREE.Mesh(
      new THREE.CylinderGeometry(0.011, 0.011, 0.196, 8),
      this.materials.darkSteel
    );
    manifoldPipe.rotation.z = Math.PI * 0.5;
    manifoldPipe.position.set(0, 0.162, 0.096);

    for (const ts of [-1, 1]) {
      const tx = ts * 0.096;
      const tz = 0.096;

      const o2TankBody = new THREE.Mesh(
        new THREE.CylinderGeometry(0.047, 0.047, 0.224, 12),
        this.materials.machinedAlloy
      );
      o2TankBody.position.set(tx, -0.012, tz);

      const tankTopDome = new THREE.Mesh(
        new THREE.SphereGeometry(0.047, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.52),
        this.materials.machinedAlloy
      );
      tankTopDome.position.set(tx, 0.1, tz);

      const tankBotDome = new THREE.Mesh(
        new THREE.SphereGeometry(
          0.047,
          12,
          8,
          0,
          Math.PI * 2,
          Math.PI * 0.48,
          Math.PI * 0.52
        ),
        this.materials.machinedAlloy
      );
      tankBotDome.position.set(tx, -0.124, tz);

      const tankColorBand = new THREE.Mesh(
        new THREE.CylinderGeometry(0.0495, 0.0495, 0.028, 12),
        ts < 0 ? this.materials.anodizedCobalt : this.materials.anodizedCrimson
      );
      tankColorBand.position.set(tx, 0.068, tz);

      for (const clampY of [0.022, -0.068]) {
        const tankClamp = new THREE.Mesh(
          new THREE.CylinderGeometry(0.051, 0.051, 0.02, 12),
          this.materials.darkSteel
        );
        tankClamp.position.set(tx, clampY, tz);
        this.plssBackpack.add(tankClamp);
      }

      const valveNeck = new THREE.Mesh(
        new THREE.CylinderGeometry(0.016, 0.02, 0.032, 8),
        this.materials.darkSteel
      );
      valveNeck.position.set(tx, 0.152, tz);

      // Mangueiras umbilicais inferiores contornando os flancos rumo ao peito
      const sideUmbilical = new THREE.Mesh(
        new THREE.CylinderGeometry(0.017, 0.017, 0.165, 8),
        this.materials.ribbedJoint
      );
      sideUmbilical.position.set(ts * 0.152, -0.148, -0.012);
      sideUmbilical.rotation.set(Math.PI * 0.38, 0, ts * 0.18);

      this.plssBackpack.add(
        o2TankBody,
        tankTopDome,
        tankBotDome,
        tankColorBand,
        valveNeck,
        sideUmbilical
      );
    }

    // 6) Coluna central traseira de telemetria com manômetro iluminado e luz de identificação Co-op
    const spinePod = new THREE.Mesh(
      new THREE.BoxGeometry(0.076, 0.228, 0.038),
      this.materials.suitDarkPatch
    );
    spinePod.position.set(0, -0.01, 0.09);

    const rearGaugeBezel = new THREE.Mesh(
      new THREE.CylinderGeometry(0.029, 0.029, 0.014, 12),
      this.materials.darkSteel
    );
    rearGaugeBezel.rotation.x = Math.PI * 0.5;
    rearGaugeBezel.position.set(0, 0.048, 0.108);

    const rearGaugeFace = new THREE.Mesh(
      new THREE.CylinderGeometry(0.024, 0.024, 0.016, 12),
      this.materials.gaugeDial
    );
    rearGaugeFace.rotation.x = Math.PI * 0.5;
    rearGaugeFace.position.set(0, 0.048, 0.109);

    const statusPipTop = new THREE.Mesh(
      new THREE.BoxGeometry(0.044, 0.016, 0.012),
      this.materials.missionOrange
    );
    statusPipTop.position.set(0, -0.022, 0.108);

    const statusPipBot = new THREE.Mesh(
      new THREE.BoxGeometry(0.044, 0.016, 0.012),
      this.materials.anodizedCobalt
    );
    statusPipBot.position.set(0, -0.048, 0.108);

    const purgePort = new THREE.Mesh(
      new THREE.CylinderGeometry(0.015, 0.018, 0.02, 8),
      this.materials.machinedAlloy
    );
    purgePort.rotation.x = Math.PI * 0.5;
    purgePort.position.set(0, -0.088, 0.108);

    this.plssBackpack.add(
      plssBackSaddle,
      plssCoreChassis,
      plssTopHood,
      plssTopCap,
      radiatorRecess,
      grabBarCross,
      plssBottomBattery,
      manifoldPipe,
      spinePod,
      rearGaugeBezel,
      rearGaugeFace,
      statusPipTop,
      statusPipBot,
      purgePort
    );

    // 3. COLAR DE PESCOÇO SELADO E CAPACETE ESPACIAL EVA TÁTICO COM VISEIRA DOURADA MOLDURADA
    const collarYoke = new THREE.Mesh(
      new THREE.CylinderGeometry(0.152, 0.182, 0.042, 14),
      this.materials.machinedAlloy
    );
    collarYoke.scale.set(1.04, 1, 0.86);
    collarYoke.position.set(0, 0.496, 0);

    const neckDisconnectRing = new THREE.Mesh(
      new THREE.CylinderGeometry(0.138, 0.144, 0.026, 14),
      this.materials.darkSteel
    );
    neckDisconnectRing.scale.set(1.0, 1, 0.94);
    neckDisconnectRing.position.set(0, 0.522, 0);

    const neckBellows = new THREE.Mesh(
      new THREE.CylinderGeometry(0.114, 0.122, 0.056, 12),
      this.materials.ribbedJoint
    );
    neckBellows.position.set(0, 0.546, 0);

    this.upperChestGroup.add(collarYoke, neckDisconnectRing, neckBellows);

    for (const ls of [-1, 1]) {
      const collarLatch = new THREE.Mesh(
        new THREE.BoxGeometry(0.028, 0.024, 0.036),
        ls < 0 ? this.materials.anodizedCobalt : this.materials.anodizedCrimson
      );
      collarLatch.position.set(ls * 0.136, 0.508, -0.038);
      this.upperChestGroup.add(collarLatch);
    }

    this.headGroup.name = 'AstronautHelmet';
    this.headGroup.position.set(0, 0.628, 0);
    this.torsoGroup.add(this.headGroup);

    // Casco interno escuro de vedação pressurizada (cria o aro de borracha contínua ao redor de toda a viseira)
    const innerPressureDome = new THREE.Mesh(
      new THREE.SphereGeometry(0.149, 18, 14),
      this.materials.suitDarkPatch
    );
    innerPressureDome.scale.set(0.97, 1.02, 1.02);
    innerPressureDome.position.set(0, 0.008, -0.004);

    // Casco externo blindado EVA (envolve bochechas, têmporas e nuca em curva contínua sem invadir a viseira)
    const helmetSideBackShell = new THREE.Mesh(
      new THREE.SphereGeometry(
        0.16,
        20,
        14,
        -Math.PI * 0.245,
        Math.PI * 1.49,
        Math.PI * 0.06,
        Math.PI * 0.82
      ),
      this.materials.astroCamo
    );
    helmetSideBackShell.scale.set(0.98, 1.03, 1.03);
    helmetSideBackShell.position.set(0, 0.008, 0);

    // Calota craniana superior curva + pala solar EVVA limpa seguindo o contorno esférico do capacete
    const helmetCrownCap = new THREE.Mesh(
      new THREE.SphereGeometry(
        0.1605,
        20,
        8,
        0,
        Math.PI * 2,
        0,
        Math.PI * 0.305
      ),
      this.materials.astroCamo
    );
    helmetCrownCap.scale.set(0.98, 1.03, 1.03);
    helmetCrownCap.position.set(0, 0.008, 0);

    const visorSunHood = new THREE.Mesh(
      new THREE.SphereGeometry(
        0.165,
        18,
        6,
        -Math.PI * 0.8,
        Math.PI * 0.6,
        Math.PI * 0.14,
        Math.PI * 0.172
      ),
      this.materials.astroCamo
    );
    visorSunHood.scale.set(0.98, 1.03, 1.03);
    visorSunHood.position.set(0, 0.01, -0.003);

    // Placa frontal baixa embutida na pala (perfil rente ao domo, sem ressaltar acima da silhueta!)
    const browBadgePlate = new THREE.Mesh(
      new THREE.SphereGeometry(
        0.167,
        10,
        4,
        -Math.PI * 0.58,
        Math.PI * 0.16,
        Math.PI * 0.19,
        Math.PI * 0.095
      ),
      this.materials.machinedAlloy
    );
    browBadgePlate.scale.set(0.98, 1.03, 1.03);
    browBadgePlate.position.set(0, 0.01, -0.004);

    // Frisos escuros curvos de vedação completa 360° (superior, inferior e laterais da viseira)
    const browSealTrim = new THREE.Mesh(
      new THREE.SphereGeometry(
        0.162,
        18,
        4,
        -Math.PI * 0.788,
        Math.PI * 0.576,
        Math.PI * 0.302,
        Math.PI * 0.038
      ),
      this.materials.darkSteel
    );
    browSealTrim.scale.set(0.98, 1.03, 1.03);
    browSealTrim.position.set(0, 0.008, -0.004);

    const chinSealTrim = new THREE.Mesh(
      new THREE.SphereGeometry(
        0.162,
        18,
        4,
        -Math.PI * 0.788,
        Math.PI * 0.576,
        Math.PI * 0.658,
        Math.PI * 0.038
      ),
      this.materials.darkSteel
    );
    chinSealTrim.scale.set(0.98, 1.03, 1.03);
    chinSealTrim.position.set(0, 0.008, -0.004);

    for (const phiSide of [-Math.PI * 0.788, -Math.PI * 0.24]) {
      const sideSealTrim = new THREE.Mesh(
        new THREE.SphereGeometry(
          0.1618,
          4,
          12,
          phiSide,
          Math.PI * 0.028,
          Math.PI * 0.302,
          Math.PI * 0.394
        ),
        this.materials.darkSteel
      );
      sideSealTrim.scale.set(0.98, 1.03, 1.03);
      sideSealTrim.position.set(0, 0.008, -0.004);
      this.headGroup.add(sideSealTrim);
    }

    const visorPullTab = new THREE.Mesh(
      new THREE.BoxGeometry(0.044, 0.011, 0.014),
      this.materials.machinedAlloy
    );
    visorPullTab.position.set(0, 0.091, -0.141);
    visorPullTab.rotation.x = -0.34;

    // Queixeira curva pressurizada contínua (acompanha a esfera do capacete sem blocos quadrados nas bochechas!)
    const jawCurvedShell = new THREE.Mesh(
      new THREE.SphereGeometry(
        0.1615,
        18,
        6,
        -Math.PI * 0.81,
        Math.PI * 0.62,
        Math.PI * 0.688,
        Math.PI * 0.195
      ),
      this.materials.astroCamo
    );
    jawCurvedShell.scale.set(0.98, 1.03, 1.03);
    jawCurvedShell.position.set(0, 0.008, -0.002);

    // Viseira solar curva banhada a ouro 24k perfeitamente emoldurada pela abertura frontal
    const goldVisor = new THREE.Mesh(
      new THREE.SphereGeometry(
        0.156,
        20,
        14,
        -Math.PI * 0.765,
        Math.PI * 0.53,
        Math.PI * 0.332,
        Math.PI * 0.334
      ),
      this.materials.goldVisor
    );
    goldVisor.scale.set(0.97, 1.01, 1.035);
    goldVisor.position.set(0, 0.008, -0.008);

    // Anel de base do capacete + respirador/vocoder frontal discreto inclinado junto ao queixo
    const helmetBaseSkirt = new THREE.Mesh(
      new THREE.CylinderGeometry(0.146, 0.14, 0.044, 16),
      this.materials.darkSteel
    );
    helmetBaseSkirt.scale.set(0.98, 1, 0.98);
    helmetBaseSkirt.position.set(0, -0.118, 0.004);

    const chinVocoderPlate = new THREE.Mesh(
      new THREE.BoxGeometry(0.088, 0.034, 0.028),
      this.materials.machinedAlloy
    );
    chinVocoderPlate.position.set(0, -0.098, -0.124);
    chinVocoderPlate.rotation.x = 0.36;

    const chinVocoderGrille = new THREE.Mesh(
      new THREE.BoxGeometry(0.056, 0.015, 0.01),
      this.materials.suitDarkPatch
    );
    chinVocoderGrille.position.set(0, -0.099, -0.137);
    chinVocoderGrille.rotation.x = 0.36;

    // Placa traseira occipital de ventilação EVA (+Z)
    const rearOccipitalPlate = new THREE.Mesh(
      new THREE.BoxGeometry(0.136, 0.098, 0.036),
      this.materials.machinedAlloy
    );
    rearOccipitalPlate.position.set(0, -0.012, 0.152);
    rearOccipitalPlate.rotation.x = 0.14;

    // Pivôs auriculares laterais da viseira + módulo de rádio/antena (direita) + lanterna tática lateral (esquerda)
    for (const es of [-1, 1]) {
      const earHinge = new THREE.Mesh(
        new THREE.CylinderGeometry(0.04, 0.044, 0.022, 12),
        this.materials.darkSteel
      );
      earHinge.rotation.z = Math.PI * 0.5;
      earHinge.position.set(es * 0.154, 0.008, -0.004);

      const earDialCap = new THREE.Mesh(
        new THREE.CylinderGeometry(0.023, 0.027, 0.012, 10),
        this.materials.machinedAlloy
      );
      earDialCap.rotation.z = Math.PI * 0.5;
      earDialCap.position.set(es * 0.165, 0.008, -0.004);

      this.headGroup.add(earHinge, earDialCap);
    }

    const commTransceiver = new THREE.Mesh(
      new THREE.BoxGeometry(0.024, 0.048, 0.044),
      this.materials.darkSteel
    );
    commTransceiver.position.set(0.154, 0.044, 0.008);

    const commAntenna = new THREE.Mesh(
      new THREE.CylinderGeometry(0.0045, 0.0075, 0.112, 6),
      this.materials.machinedAlloy
    );
    commAntenna.position.set(0.157, 0.112, 0.012);
    commAntenna.rotation.z = -0.05;

    const sideLampHousing = new THREE.Mesh(
      new THREE.BoxGeometry(0.025, 0.032, 0.068),
      this.materials.machinedAlloy
    );
    sideLampHousing.position.set(-0.156, 0.038, -0.016);

    const sideLampLens = new THREE.Mesh(
      new THREE.BoxGeometry(0.017, 0.021, 0.01),
      this.materials.gaugeDial
    );
    sideLampLens.position.set(-0.157, 0.038, -0.051);

    this.headGroup.add(
      innerPressureDome,
      helmetSideBackShell,
      helmetCrownCap,
      visorSunHood,
      browBadgePlate,
      browSealTrim,
      chinSealTrim,
      visorPullTab,
      jawCurvedShell,
      goldVisor,
      helmetBaseSkirt,
      chinVocoderPlate,
      chinVocoderGrille,
      rearOccipitalPlate,
      commTransceiver,
      commAntenna,
      sideLampHousing,
      sideLampLens
    );

    // 4. BRAÇOS ORIGINAIS DO ASTRONAUTA MARCADOS COMO ATIVOS (`AstronautLeftArm` & `AstronautRightArm`)
    this.leftArm = createAstronautArmRig('left', this.materials, {
      includeUpperArm: true,
    });
    this.leftArm.root.position.set(-0.272, 0.445, 0.01);

    this.rightArm = createAstronautArmRig('right', this.materials, {
      includeUpperArm: true,
    });
    this.rightArm.root.position.set(0.272, 0.445, 0.01);

    this.torsoGroup.add(this.leftArm.root, this.rightArm.root);

    this.setFirstPersonMode(true);
    scene.add(this.root);
  }

  /**
   * Retorna os dois braços originais marcados do Astronauta (esquerdo e direito).
   */
  getMarkedArms(): { left: AstronautArmRig; right: AstronautArmRig } {
    return { left: this.leftArm, right: this.rightArm };
  }

  /**
   * Marca qual braço do Astronauta está ativamente em uso nas animações em 1ª pessoa (lanterna, faca ou objetos).
   */
  setArmInUse(side: AstronautArmSide, inUse: boolean): void {
    const arm = side === 'right' ? this.rightArm : this.leftArm;
    arm.setInUse(inUse);
  }

  get isFirstPersonMode(): boolean {
    return this.firstPersonMode;
  }

  /**
   * Alterna entre modo em 1ª pessoa (corpo próprio totalmente invisível para o jogador local,
   * evitando qualquer obstrução/clipping ao olhar para baixo) e modo de corpo inteiro completo
   * em 3ª pessoa (usado para aliados no Multiplayer Co-op).
   */
  setFirstPersonMode(enabled: boolean): void {
    this.firstPersonMode = enabled;
    this.root.visible = !enabled;
    this.headGroup.visible = !enabled;
    this.plssBackpack.visible = !enabled;
    this.upperChestGroup.visible = !enabled;
    if (!enabled) {
      this.leftArm.root.visible = true;
      this.leftArm.elbowPivot.visible = true;
      this.rightArm.root.visible = true;
      this.rightArm.elbowPivot.visible = true;
    } else {
      this.leftArm.root.visible = false;
      this.rightArm.root.visible = false;
    }
  }

  /**
   * Mantém o corpo 3D local completamente invisível para o próprio jogador em 1ª pessoa
   * (mesmo ao olhar totalmente para baixo), preservando apenas a sincronização de estado
   * dos braços ativos em uso pelo viewmodel (`DoomFlashlight`).
   */
  updateFirstPersonBody(
    position: THREE.Vector3,
    yaw: number,
    _bobPhase: number,
    _planarSpeed: number,
    _crouchAmount: number,
    rightArmActiveInViewmodel: boolean,
    leftArmActiveInViewmodel: boolean,
    _pitch = 0
  ): void {
    this.firstPersonMode = true;
    this.root.visible = false;
    this.headGroup.visible = false;
    this.plssBackpack.visible = false;
    this.upperChestGroup.visible = false;
    this.leftArm.root.visible = false;
    this.rightArm.root.visible = false;

    this.root.position.set(position.x, position.y, position.z);
    this.root.rotation.set(0, yaw, 0);

    this.rightArm.setInUse(rightArmActiveInViewmodel);
    this.leftArm.setInUse(leftArmActiveInViewmodel);
  }

  /**
   * Mantém o corpo local invisível para o jogador também durante sequências em 1ª pessoa
   * (desmaio / arrasto), evitando que pernas ou tronco invadam a câmera.
   */
  updateSupineAbductionPose(
    cameraFloorPos: THREE.Vector3,
    yawTowardsSpider: number,
    _pullCycles: number,
    _visible: boolean
  ): void {
    this.firstPersonMode = true;
    this.root.visible = false;
    this.headGroup.visible = false;
    this.plssBackpack.visible = false;
    this.upperChestGroup.visible = false;
    this.rightArm.setInUse(false);
    this.leftArm.setInUse(false);
    this.rightArm.root.visible = false;
    this.leftArm.root.visible = false;

    this.root.position.set(cameraFloorPos.x, 0.06, cameraFloorPos.z);
    this.root.rotation.set(0, yawTowardsSpider, 0);
  }

  /**
   * Atualiza o Astronauta em 3ª pessoa completa (capacete + viseira dourada + mochila PLSS + braços + pernas)
   * para renderizar aliados conectados em sessões Multiplayer Co-op!
   */
  updateThirdPersonAlly(
    position: THREE.Vector3,
    yaw: number,
    pitch: number,
    bobPhase: number,
    planarSpeed: number,
    crouchAmount: number,
    flashlightOn: boolean,
    trappedOrDowned: boolean
  ): void {
    this.root.visible = true;
    this.setFirstPersonMode(false);

    this.root.position.set(position.x, position.y, position.z);
    this.root.rotation.set(0, yaw, 0);

    if (trappedOrDowned) {
      const struggle = Math.sin(bobPhase * 3.2) * 0.09;
      this.bodyPivot.position.set(0, -0.36, 0);
      this.bodyPivot.rotation.set(0.28, struggle * 0.5, struggle * 0.35);
      this.hipsGroup.position.set(0, 0.82, 0);
      this.torsoGroup.rotation.set(0.22, 0, 0);
      this.headGroup.rotation.set(-0.18 + struggle, struggle, 0);
      this.leftLeg.hipPivot.rotation.set(0.55, 0, -0.08);
      this.leftLeg.kneePivot.rotation.set(-0.95, 0, 0);
      this.rightLeg.hipPivot.rotation.set(0.55, 0, 0.08);
      this.rightLeg.kneePivot.rotation.set(-0.95, 0, 0);
      this.leftArm.shoulderPivot.rotation.set(0.85 + struggle, 0.35, -0.25);
      this.leftArm.elbowPivot.rotation.set(0.8, 0, 0);
      this.rightArm.shoulderPivot.rotation.set(0.85 - struggle, -0.35, 0.25);
      this.rightArm.elbowPivot.rotation.set(0.8, 0, 0);
      return;
    }

    const stride = Math.min(1, planarSpeed / 5.4);
    const legSwing = Math.sin(bobPhase * 0.5) * 0.52 * stride;
    const armSwing = Math.sin(bobPhase * 0.5) * 0.32 * stride;
    const leftLift = Math.max(0, Math.cos(bobPhase * 0.5)) * 0.44 * stride;
    const rightLift = Math.max(0, -Math.cos(bobPhase * 0.5)) * 0.44 * stride;

    const crouchHipBend = crouchAmount * 0.72;
    const crouchKneeBend = crouchAmount * 1.12;

    const torsoLeanForward = -(crouchAmount * 0.16 + stride * 0.05);
    this.bodyPivot.position.set(0, -crouchAmount * 0.44, 0);
    this.bodyPivot.rotation.set(0, 0, 0);
    this.hipsGroup.position.set(0, 0.85, 0);
    this.torsoGroup.rotation.set(torsoLeanForward, 0, 0);
    this.headGroup.rotation.set(
      Math.max(-0.52, Math.min(0.52, pitch * 0.62)) - torsoLeanForward * 0.8,
      0,
      0
    );

    this.leftLeg.hipPivot.rotation.set(crouchHipBend + legSwing, 0, -0.03);
    this.leftLeg.kneePivot.rotation.set(-(crouchKneeBend + leftLift), 0, 0);
    this.leftLeg.anklePivot.rotation.set(
      (crouchKneeBend - crouchHipBend) * 0.4,
      0,
      0
    );

    this.rightLeg.hipPivot.rotation.set(crouchHipBend - legSwing, 0, 0.03);
    this.rightLeg.kneePivot.rotation.set(-(crouchKneeBend + rightLift), 0, 0);
    this.rightLeg.anklePivot.rotation.set(
      (crouchKneeBend - crouchHipBend) * 0.4,
      0,
      0
    );

    this.leftArm.shoulderPivot.rotation.order = 'YXZ';
    this.leftArm.shoulderPivot.rotation.set(
      0.14 - armSwing + crouchAmount * 0.18,
      0.08,
      -0.12
    );
    this.leftArm.elbowPivot.rotation.set(0.32 + stride * 0.16, 0, 0);
    this.leftArm.setGripPose('relaxed');

    this.rightArm.shoulderPivot.rotation.order = 'YXZ';
    if (flashlightOn) {
      this.rightArm.shoulderPivot.rotation.set(
        0.72 + Math.max(-0.45, Math.min(0.45, pitch * 0.65)),
        -0.08,
        0.1
      );
      this.rightArm.elbowPivot.rotation.set(0.52, 0.12, -0.08);
      this.rightArm.setGripPose('flashlight');
    } else {
      this.rightArm.shoulderPivot.rotation.set(
        0.14 + armSwing + crouchAmount * 0.18,
        -0.08,
        0.12
      );
      this.rightArm.elbowPivot.rotation.set(0.32 + stride * 0.16, 0, 0);
      this.rightArm.setGripPose('relaxed');
    }
  }

  disposeFromScene(scene: THREE.Scene): void {
    scene.remove(this.root);
  }
}
