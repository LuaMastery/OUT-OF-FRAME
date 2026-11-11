import * as THREE from 'three';
import { HeldWeapon, QuickHandheldKind, QuickItemAction } from './DoomItemAction';
import { AstronautRagdoll, RAGDOLL_IDX } from './DoomRagdoll';
import type { WebStrugglePose } from './DoomWebStruggle';
import { createDoomPropMaterial, DoomSharedUniforms } from './DoomShader';
import {
  clampDoomDanceValue as clampDanceValue,
  DoomDanceArmPose,
  DoomDanceLegPose,
  DoomDancePose,
} from './DoomDance';

export type AstronautArmSide = 'left' | 'right';

export type AstronautGripPose =
  | 'relaxed'
  | 'flashlight'
  | 'knife'
  | 'cylindrical'
  | 'box'
  | 'key'
  | 'sprawled'
  /** Mão totalmente aberta (danças) */
  | 'open'
  /** Mão em garra (dança rítmica do robô) */
  | 'claw';

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

/** Pose de empunhadura em 3ª pessoa: onde a mão direita fica e para onde o cano aponta. */
/**
 * Empunhadura de duas mãos em terceira pessoa.
 *
 * O traje tem ombros largos (0,484 m) e braços curtos (0,477 m até o pulso), e a
 * coronha da escopeta afasta 0,354 m as duas mãos — por isso a arma não pode
 * ficar paralela ao eixo do corpo sem atravessar o tronco. A pose abaixo é a
 * solução com as duas mãos na arma e folga real em volta do traje: coronha
 * encostada no quadril direito, cano subindo em diagonal até a frente-esquerda
 * ("carry" diagonal, igual a quem carrega uma escopeta a tiracolo).
 */
const WEAPON_HOLD = {
  /** Posição da mão direita (punho da arma) no espaço do tronco. */
  gripPoint: new THREE.Vector3(0.15, 0.02, -0.24),
  /** Direção do cano (do punho até a boca) no espaço do tronco. */
  aim: new THREE.Vector3(-0.75, 0.375, -0.545),
  /** Rolagem da arma em torno do próprio eixo. */
  roll: -0.05,
  /** Para onde cada cotovelo deve apontar (o plano da flexão). */
  rightElbowHint: new THREE.Vector3(0.7, -0.2, 0.6),
  leftElbowHint: new THREE.Vector3(-0.5, -0.65, 0.25),
} as const;

/** Comprimentos do braço, medidos no rig (ombro→cotovelo→pulso). */
const ARM_UPPER_LENGTH = 0.245;
const ARM_FOREARM_LENGTH = 0.232;

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

interface BioSuitTextureCache {
  suitPolymerTex: THREE.DataTexture;
  suitMainYellowTex: THREE.DataTexture;
  rubberGrainTex: THREE.DataTexture;
  polycarbonateVisorTex: THREE.DataTexture;
  frostedPatchTex: THREE.DataTexture;
  valveDetailTex: THREE.DataTexture;
}

let cachedBioSuitTextures: BioSuitTextureCache | null = null;

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
 * Polímero impermeável secundário do Traje Biológico Nível-A (64x64 pixel-art):
 * Amarelo-limão / chartreuse de alta visibilidade com dobras suaves de pressão positiva.
 */
function createBioSuitSecondaryPolymerTexture(): THREE.DataTexture {
  const size = 64;
  const data = new Uint8Array(size * size * 4);

  for (let y = 0; y < size; y++) {
    const foldWave = Math.sin((y / size) * Math.PI * 4) * 10;
    const weldedSeam = y === 0 || y === 32;
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const weave = ((x + y) & 1) === 0 ? 3 : -3;
      const noise = (hash2(x, y, 501) - 0.5) * 8;
      let r = 208 + foldWave + weave + noise;
      let g = 228 + foldWave + weave + noise;
      let b = 52 + foldWave * 0.35 + weave + noise * 0.5;

      if (weldedSeam) {
        r *= 0.76;
        g *= 0.78;
        b *= 0.72;
      }

      data[i] = clampByte(r);
      data[i + 1] = clampByte(g);
      data[i + 2] = clampByte(b);
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
 * Polímero principal PVC/Tyvek do Traje Biológico Encapsulado Nível-A (64x64 pixel-art):
 * Amarelo-esverdeado fluorescente (chartreuse) idêntico ao traje pressurizado de biossegurança,
 * com dobras amplas naturais de inflação e costura termoselada limpa (sem excesso de ruído visual).
 */
function createBioSuitPrimaryPolymerTexture(): THREE.DataTexture {
  const size = 64;
  const data = new Uint8Array(size * size * 4);

  for (let y = 0; y < size; y++) {
    const ny = (y / size) * Math.PI * 2;
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const nx = (x / size) * Math.PI * 2;

      // Dobras orgânicas largas de traje inflado por pressão positiva
      const softCrease =
        Math.sin(ny * 2 + Math.sin(nx) * 0.65) * 14 +
        Math.cos(nx * 2 - ny * 0.5) * 9;
      const specSheen =
        Math.pow(Math.max(0, Math.sin(nx + 0.8) * Math.sin(ny * 0.5 + 0.6)), 3) *
        28;
      const ripstop = (x & 7) === 0 || (y & 7) === 0 ? -4 : 2;
      const grain = (hash2(x, y, 751) - 0.5) * 7;

      let r = 216 + softCrease + specSheen + ripstop + grain;
      let g = 236 + softCrease + specSheen * 0.95 + ripstop + grain;
      let b = 56 + softCrease * 0.45 + specSheen * 1.15 + ripstop + grain * 0.5;

      // Costura termoselada vulcanizada na borda do tile para acabamento nítido e contraste bem definido
      if (y === 0) {
        r = 58;
        g = 66;
        b = 18;
      } else if (y === 1) {
        r = 244;
        g = 254;
        b = 112;
      } else if (x === 0 && (y & 3) < 2) {
        r *= 0.84;
        g *= 0.85;
        b *= 0.8;
      }

      data[i] = clampByte(r);
      data[i + 1] = clampByte(g);
      data[i + 2] = clampByte(b);
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
 * Grão fosco limpo de borracha butílica/neoprene química (usado nas luvas pretas, botas amarelas e solados).
 */
function createChemicalRubberGrainTexture(): THREE.DataTexture {
  const size = 64;
  const data = new Uint8Array(size * size * 4);

  for (let y = 0; y < size; y++) {
    const subtleBand = Math.sin((y / size) * Math.PI * 2) * 8;
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const grain = (hash2(x, y, 421) - 0.5) * 10;
      const v = clampByte(226 + subtleBand + grain);
      data[i] = v;
      data[i + 1] = v;
      data[i + 2] = v;
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
 * Viseira panorâmica frontal em policarbonato fumê/translúcido do Traje Biológico Nível-A:
 * - Moldura termoselada amarelo-limão + vedação escura na borda;
 * - Interior escuro limpo sugerindo sutilmente a máscara respiratória interna sem peças soltas;
 * - Reflexo vertical plástico acetinado típico do escudo facial flexível da imagem de referência.
 */
function createBioHazardVisorTexture(): THREE.DataTexture {
  const size = 64;
  const data = new Uint8Array(size * size * 4);

  for (let y = 0; y < size; y++) {
    const ny = (y - 31.5) / 31.5; // -1 base -> +1 topo
    for (let x = 0; x < size; x++) {
      const nx = (x - 31.5) / 31.5;
      const i = (y * size + x) * 4;

      const edgeX = Math.abs(nx);
      const edgeY = Math.abs(ny);

      // Borda externa termoselada amarelo-chartreuse + filete escuro de vedação
      if (edgeX > 0.91 || edgeY > 0.92) {
        data[i] = 198;
        data[i + 1] = 216;
        data[i + 2] = 48;
        data[i + 3] = 255;
        continue;
      }
      if (edgeX > 0.85 || edgeY > 0.86) {
        data[i] = 52;
        data[i + 1] = 58;
        data[i + 2] = 44;
        data[i + 3] = 255;
        continue;
      }

      // Interior fumê esverdeado-cinza da câmara pressurizada do capuz
      const depthShade = Math.max(0, 1 - Math.hypot(nx * 0.95, ny * 0.85) * 0.65);
      let r = 34 + depthShade * 28;
      let g = 40 + depthShade * 34;
      let b = 38 + depthShade * 30;

      // Silhueta interna super discreta do respirador/capacete de segurança sob o plástico
      const innerHelmet =
        ny > 0.22 && ny < 0.62 && Math.hypot(nx * 1.35, (ny - 0.34) * 1.6) < 0.55;
      const innerMask =
        ny > -0.45 && ny <= 0.12 && Math.hypot(nx * 1.6, (ny + 0.16) * 1.4) < 0.44;
      if (innerHelmet) {
        r += 26;
        g += 14;
        b += 8;
      } else if (innerMask) {
        r -= 10;
        g -= 10;
        b -= 8;
      }

      // Reflexo especular vertical de policarbonato transparente curvado
      const mainGloss =
        Math.exp(-Math.pow((nx + 0.34 - ny * 0.08) / 0.14, 2)) *
        Math.exp(-Math.pow(ny / 0.88, 2));
      const secondaryGloss =
        Math.exp(-Math.pow((nx - 0.44 - ny * 0.06) / 0.08, 2)) * 0.55;
      const gloss = mainGloss * 86 + secondaryGloss * 58;

      const grit = (hash2(x, y, 439) - 0.5) * 4;
      data[i] = clampByte(r + gloss + grit);
      data[i + 1] = clampByte(g + gloss * 1.04 + grit);
      data[i + 2] = clampByte(b + gloss * 0.98 + grit);
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
 * Etiqueta plástica translúcida / bolso frontal de identificação termoselado no peito (igual à imagem).
 */
function createFrostedIdPatchTexture(): THREE.DataTexture {
  const size = 64;
  const data = new Uint8Array(size * size * 4);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const seam = x < 4 || x >= 60 || y < 4 || y >= 60;
      let r = seam ? 196 : 224;
      let g = seam ? 208 : 232;
      let b = seam ? 168 : 220;

      // Tarja interna sutil do cartão de inspeção sob o vinil fosco
      if (!seam && y >= 42 && y <= 50 && x >= 12 && x <= 52) {
        r -= 18;
        g -= 16;
        b -= 18;
      }

      const noise = (hash2(x, y, 443) - 0.5) * 8;
      data[i] = clampByte(r + noise);
      data[i + 1] = clampByte(g + noise);
      data[i + 2] = clampByte(b + noise);
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
 * Tampa circular vermelha da válvula de exaustão/sobrepressão lateral do capuz biológico.
 */
function createExhaustValveTexture(): THREE.DataTexture {
  const size = 32;
  const data = new Uint8Array(size * size * 4);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const rDist = Math.hypot(x - 15.5, y - 15.5);
      const groove = rDist > 9.5 && rDist < 11.5 ? -28 : 0;
      data[i] = clampByte(218 + groove);
      data[i + 1] = clampByte(38 + groove * 0.3);
      data[i + 2] = clampByte(32 + groove * 0.3);
      data[i + 3] = 255;
    }
  }

  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
}

function getBioSuitTextures(): BioSuitTextureCache {
  if (!cachedBioSuitTextures) {
    cachedBioSuitTextures = {
      suitPolymerTex: createBioSuitSecondaryPolymerTexture(),
      suitMainYellowTex: createBioSuitPrimaryPolymerTexture(),
      rubberGrainTex: createChemicalRubberGrainTexture(),
      polycarbonateVisorTex: createBioHazardVisorTexture(),
      frostedPatchTex: createFrostedIdPatchTexture(),
      valveDetailTex: createExhaustValveTexture(),
    };
  }
  return cachedBioSuitTextures;
}

/**
 * Cria o conjunto de materiais do Traje Biológico Nível-A:
 * - Polímero amarelo-chartreuse de alta visibilidade (`astroCamo` / `suitFabric`);
 * - Válvulas de sobrepressão e anéis de vedação de punho vermelhos (`anodizedCrimson`);
 * - Luvas químicas e solados de borracha butílica preta fosca (`bootRubber`);
 * - Botas impermeáveis amarelas de segurança (`missionOrange`);
 * - Viseira panorâmica frontal em policarbonato fumê (`goldVisor`) e bolso translúcido (`chestPanel`).
 */
export function createAstronautMaterials(
  sharedUniforms?: DoomSharedUniforms
): AstronautMaterialSet {
  const tex = getBioSuitTextures();

  if (sharedUniforms) {
    return {
      suitFabric: createDoomPropMaterial(tex.suitPolymerTex, sharedUniforms, {
        baseLight: 0.28,
        tint: new THREE.Color(0xffffff),
      }),
      astroCamo: createDoomPropMaterial(tex.suitMainYellowTex, sharedUniforms, {
        baseLight: 0.3,
        tint: new THREE.Color(0xffffff),
      }),
      suitDarkPatch: createDoomPropMaterial(tex.rubberGrainTex, sharedUniforms, {
        baseLight: 0.22,
        tint: new THREE.Color(0x32363e),
      }),
      ribbedJoint: createDoomPropMaterial(tex.rubberGrainTex, sharedUniforms, {
        baseLight: 0.24,
        tint: new THREE.Color(0x2a2e36),
      }),
      anodizedCrimson: createDoomPropMaterial(
        tex.rubberGrainTex,
        sharedUniforms,
        {
          baseLight: 0.3,
          tint: new THREE.Color(0xd9241e),
        }
      ),
      anodizedCobalt: createDoomPropMaterial(
        tex.rubberGrainTex,
        sharedUniforms,
        {
          baseLight: 0.28,
          tint: new THREE.Color(0xd9241e),
        }
      ),
      missionOrange: createDoomPropMaterial(tex.rubberGrainTex, sharedUniforms, {
        baseLight: 0.3,
        tint: new THREE.Color(0xf4b408),
      }),
      machinedAlloy: createDoomPropMaterial(tex.rubberGrainTex, sharedUniforms, {
        baseLight: 0.26,
        tint: new THREE.Color(0x9ea5b2),
      }),
      darkSteel: createDoomPropMaterial(tex.rubberGrainTex, sharedUniforms, {
        baseLight: 0.2,
        tint: new THREE.Color(0x242830),
      }),
      goldVisor: createDoomPropMaterial(
        tex.polycarbonateVisorTex,
        sharedUniforms,
        {
          baseLight: 0.32,
          emissiveBoost: 0.03,
        }
      ),
      chestPanel: createDoomPropMaterial(tex.frostedPatchTex, sharedUniforms, {
        baseLight: 0.32,
        emissiveBoost: 0.02,
      }),
      gaugeDial: createDoomPropMaterial(tex.valveDetailTex, sharedUniforms, {
        baseLight: 0.32,
        emissiveBoost: 0.04,
      }),
      bootRubber: createDoomPropMaterial(tex.rubberGrainTex, sharedUniforms, {
        baseLight: 0.2,
        tint: new THREE.Color(0x1f232a),
      }),
    };
  }

  return {
    suitFabric: new THREE.MeshLambertMaterial({
      map: tex.suitPolymerTex,
      color: 0xffffff,
      flatShading: true,
    }),
    astroCamo: new THREE.MeshLambertMaterial({
      map: tex.suitMainYellowTex,
      color: 0xffffff,
      flatShading: true,
    }),
    suitDarkPatch: new THREE.MeshLambertMaterial({
      map: tex.rubberGrainTex,
      color: 0x32363e,
      flatShading: true,
    }),
    ribbedJoint: new THREE.MeshLambertMaterial({
      map: tex.rubberGrainTex,
      color: 0x2a2e36,
      flatShading: true,
    }),
    anodizedCrimson: new THREE.MeshLambertMaterial({
      map: tex.rubberGrainTex,
      color: 0xd9241e,
      flatShading: true,
    }),
    anodizedCobalt: new THREE.MeshLambertMaterial({
      map: tex.rubberGrainTex,
      color: 0xd9241e,
      flatShading: true,
    }),
    missionOrange: new THREE.MeshLambertMaterial({
      map: tex.rubberGrainTex,
      color: 0xf4b408,
      flatShading: true,
    }),
    machinedAlloy: new THREE.MeshLambertMaterial({
      color: 0x9ea6b4,
      flatShading: true,
    }),
    darkSteel: new THREE.MeshLambertMaterial({
      color: 0x242830,
      flatShading: true,
    }),
    goldVisor: new THREE.MeshLambertMaterial({
      map: tex.polycarbonateVisorTex,
      color: 0xffffff,
      flatShading: true,
    }),
    chestPanel: new THREE.MeshLambertMaterial({
      map: tex.frostedPatchTex,
      color: 0xffffff,
      flatShading: true,
    }),
    gaugeDial: new THREE.MeshBasicMaterial({
      map: tex.valveDetailTex,
    }),
    bootRubber: new THREE.MeshLambertMaterial({
      map: tex.rubberGrainTex,
      color: 0x242830,
      flatShading: true,
    }),
  };
}

/**
 * Constrói um dos braços articulados limpos do Traje Biológico Nível-A (`left` ou `right`):
 * - Manga pressurizada lisa em polímero amarelo-chartreuse (sem cintas, mangueiras, fivelas ou caixas soltas);
 * - Anel vermelho de vedação hermética no punho (`anodizedCrimson`);
 * - Luva química preta fosca em borracha butílica (`bootRubber`) com 5 dedos articulados + `gripSocket`.
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
    // Junta esférica contínua na mesma cor do traje para vedar o ombro sem frestas em qualquer rotação
    const shoulderCap = new THREE.Mesh(
      new THREE.SphereGeometry(0.084, 12, 8),
      materials.astroCamo
    );
    shoulderCap.position.set(0, -0.015, 0);

    // Manga superior ampla de pressão positiva em polímero chartreuse
    const upperSleeve = new THREE.Mesh(
      new THREE.CylinderGeometry(0.082, 0.072, 0.215, 12),
      materials.astroCamo
    );
    upperSleeve.position.set(0, -0.125, 0);

    upperArmGroup.add(shoulderCap, upperSleeve);
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

  // Cotovelo contínuo + manga de antebraço limpa afunilando até o anel vermelho de vedação
  const elbowDome = new THREE.Mesh(
    new THREE.SphereGeometry(0.068, 10, 8),
    materials.astroCamo
  );
  elbowDome.position.set(0, -0.008, 0);

  const forearmSleeve = new THREE.Mesh(
    new THREE.CylinderGeometry(0.069, 0.056, 0.2, 12),
    materials.astroCamo
  );
  forearmSleeve.position.set(0, -0.112, 0);

  forearmGroup.add(elbowDome, forearmSleeve);

  // Anel vermelho liso de travamento hermético da luva química (fiel à imagem de referência)
  const wristRingGroup = new THREE.Group();
  wristRingGroup.name = `Astronaut${sideLabel}WristRing`;
  wristRingGroup.position.set(0, -0.216, 0);
  forearmGroup.add(wristRingGroup);

  const redSealRing = new THREE.Mesh(
    new THREE.CylinderGeometry(0.057, 0.055, 0.022, 14),
    materials.anodizedCrimson
  );
  wristRingGroup.add(redSealRing);

  // Pivô do punho e luva química em borracha butílica preta fosca
  const wristPivot = new THREE.Group();
  wristPivot.name = `Astronaut${sideLabel}Wrist`;
  wristPivot.position.set(0, -0.232, 0);
  elbowPivot.add(wristPivot);

  const gloveGroup = new THREE.Group();
  gloveGroup.name = `Astronaut${sideLabel}Glove`;
  gloveGroup.userData = { isAstronautGlove: true, armSide: side };
  wristPivot.add(gloveGroup);

  const gloveCuff = new THREE.Mesh(
    new THREE.CylinderGeometry(0.051, 0.048, 0.026, 12),
    materials.bootRubber
  );
  gloveCuff.position.set(0, -0.011, 0);

  const metacarpalShell = new THREE.Mesh(
    new THREE.BoxGeometry(0.042, 0.066, 0.076),
    materials.bootRubber
  );
  metacarpalShell.position.set(sign * 0.003, -0.046, 0);

  gloveGroup.add(gloveCuff, metacarpalShell);

  // 4 dedos articulados em borracha química preta uniforme (sem anéis metálicos aparentes)
  const fingers: AstronautFingerRig[] = [];
  const fingerLengths = [0.032, 0.035, 0.033, 0.028];

  for (let f = 0; f < 4; f++) {
    const fz = -0.027 + f * 0.018;
    const pLen = fingerLengths[f];

    const proxPivot = new THREE.Group();
    proxPivot.position.set(sign * 0.008, -0.078, fz);

    const proxSeg = new THREE.Mesh(
      new THREE.BoxGeometry(0.019, pLen, 0.0155),
      materials.bootRubber
    );
    proxSeg.position.set(0, -pLen * 0.5, 0);
    proxPivot.add(proxSeg);

    const distPivot = new THREE.Group();
    distPivot.position.set(0, -pLen, 0);

    const midKnuckle = new THREE.Mesh(
      new THREE.SphereGeometry(0.008, 8, 6),
      materials.bootRubber
    );
    const dLen = pLen * 0.82;
    const distSeg = new THREE.Mesh(
      new THREE.BoxGeometry(0.0175, dLen, 0.0145),
      materials.bootRubber
    );
    distSeg.position.set(0, -dLen * 0.45, 0);

    const tipCap = new THREE.Mesh(
      new THREE.SphereGeometry(0.0082, 8, 6),
      materials.bootRubber
    );
    tipCap.position.set(-sign * 0.001, -dLen * 0.92, 0);

    distPivot.add(midKnuckle, distSeg, tipCap);
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
    new THREE.BoxGeometry(0.021, 0.032, 0.021),
    materials.bootRubber
  );
  thumbBaseMesh.position.set(0, -0.015, -0.006);
  thumbPivot.add(thumbBaseMesh);

  const thumbJointSphere = new THREE.Mesh(
    new THREE.SphereGeometry(0.0092, 8, 6),
    materials.bootRubber
  );
  thumbJointSphere.position.set(0, -0.031, -0.008);
  thumbPivot.add(thumbJointSphere);

  const thumbTipPivot = new THREE.Group();
  thumbTipPivot.name = `Astronaut${sideLabel}ThumbTip`;
  thumbTipPivot.position.set(0, -0.032, -0.008);
  thumbPivot.add(thumbTipPivot);

  const thumbTipMesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.0185, 0.026, 0.0185),
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
        const curl = f < 2 ? 0.95 : 1.38;
        fg.proxPivot.rotation.set(0, 0, -sign * curl);
        fg.distPivot.rotation.set(0, 0, -sign * (curl + 0.12));
      } else if (pose === 'open') {
        // Mão espalmada e aberta (danças): dedos esticados e bem afastados
        fg.proxPivot.rotation.set(0, 0, -sign * (0.05 + stagger * 0.35));
        fg.distPivot.rotation.set(0, 0, -sign * (0.07 + stagger * 0.25));
      } else if (pose === 'claw') {
        // Garra rítmica: dedos curvos em ângulo reto
        fg.proxPivot.rotation.set(0, 0, -sign * (0.72 + stagger * 0.3));
        fg.distPivot.rotation.set(0, 0, -sign * (0.62 + stagger * 0.2));
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
    } else if (pose === 'open') {
      thumbPivot.rotation.set(0.12, sign * 0.12, -sign * 0.38);
      thumbTipPivot.rotation.set(0.08, 0, -sign * 0.28);
    } else if (pose === 'claw') {
      thumbPivot.rotation.set(0.5, -sign * 0.12, -sign * 0.62);
      thumbTipPivot.rotation.set(0.26, 0, -sign * 0.46);
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
    gaugeNeedleMesh: null,
    metadata,
    setGripPose,
    setInUse,
  };
}

interface AstronautLegRig {
  readonly hipPivot: THREE.Group;
  readonly kneePivot: THREE.Group;
  readonly anklePivot: THREE.Group;
  /** Malhas da galocha (usadas para medir o contato exato das solas com o piso) */
  readonly bootMeshes: THREE.Mesh[];
}

/**
 * Constrói uma perna limpa do Traje Biológico Nível-A:
 * - Calça impermeável chartreuse reta cobrindo o cano da bota (sem bolsos, faixas ou joelheiras metálicas);
 * - Galocha química amarela (`missionOrange`) com solado preto espesso (`bootRubber`) nivelado exatamente em y = 0.00m.
 */
function createAstronautLegRig(
  side: AstronautArmSide,
  materials: AstronautMaterialSet
): AstronautLegRig {
  const sideLabel = side === 'right' ? 'Right' : 'Left';

  const hipPivot = new THREE.Group();
  hipPivot.name = `Astronaut${sideLabel}Leg`;

  const hipJoint = new THREE.Mesh(
    new THREE.SphereGeometry(0.094, 10, 8),
    materials.suitFabric
  );
  hipJoint.position.set(0, -0.01, 0);

  const thigh = new THREE.Mesh(
    new THREE.CylinderGeometry(0.098, 0.088, 0.33, 12),
    materials.suitFabric
  );
  thigh.position.set(0, -0.19, 0);

  hipPivot.add(hipJoint, thigh);

  // Joelho limpo contínuo na mesma cor da calça impermeável
  const kneePivot = new THREE.Group();
  kneePivot.name = `Astronaut${sideLabel}Knee`;
  kneePivot.position.set(0, -0.365, 0);
  hipPivot.add(kneePivot);

  const kneeSphere = new THREE.Mesh(
    new THREE.SphereGeometry(0.085, 10, 8),
    materials.suitFabric
  );
  kneeSphere.position.set(0, -0.005, 0);

  // Barra reta da calça biológica cobrindo o topo da bota amarela (igual à imagem)
  const trouserLeg = new THREE.Mesh(
    new THREE.CylinderGeometry(0.086, 0.092, 0.295, 12),
    materials.suitFabric
  );
  trouserLeg.position.set(0, -0.16, 0);

  kneePivot.add(kneeSphere, trouserLeg);

  // Galocha impermeável amarela de biossegurança + solado preto nivelado em y = 0.00m
  // Com hipsGroup.y = 0.86, hipPivot.y = -0.035, kneePivot.y = -0.365, anklePivot.y = -0.345 -> anklePivot world y = 0.115m.
  const anklePivot = new THREE.Group();
  anklePivot.name = `Astronaut${sideLabel}Boot`;
  anklePivot.position.set(0, -0.345, 0);
  kneePivot.add(anklePivot);

  // Cano da galocha amarela encaixado por dentro da boca da calça (r = 0.072 < 0.092 -> zero clipping)
  const bootShaft = new THREE.Mesh(
    new THREE.CylinderGeometry(0.07, 0.074, 0.105, 12),
    materials.missionOrange
  );
  bootShaft.position.set(0, -0.025, -0.004);

  // Peito do pé + biqueira arredondada da galocha amarela
  const bootFoot = new THREE.Mesh(
    new THREE.BoxGeometry(0.138, 0.058, 0.17),
    materials.missionOrange
  );
  bootFoot.position.set(0, -0.064, -0.032);

  const bootToe = new THREE.Mesh(
    new THREE.CylinderGeometry(0.069, 0.069, 0.058, 12),
    materials.missionOrange
  );
  bootToe.position.set(0, -0.064, -0.117);

  // Solado químico preto inteiriço com base exata em y = -0.115m (0.115 - 0.115 = 0.000m no piso!)
  const bootSole = new THREE.Mesh(
    new THREE.BoxGeometry(0.146, 0.026, 0.184),
    materials.bootRubber
  );
  bootSole.position.set(0, -0.102, -0.034);

  const bootSoleToe = new THREE.Mesh(
    new THREE.CylinderGeometry(0.073, 0.073, 0.026, 12),
    materials.bootRubber
  );
  bootSoleToe.position.set(0, -0.102, -0.122);

  anklePivot.add(bootShaft, bootFoot, bootToe, bootSole, bootSoleToe);

  const bootMeshes = [bootShaft, bootFoot, bootToe, bootSole, bootSoleToe];
  for (const m of bootMeshes) {
    m.geometry.computeBoundingBox();
  }

  return { hipPivot, kneePivot, anklePivot, bootMeshes };
}

/**
 * Modelo 3D Completo, Limpo e Coeso do Jogador em TRAJE BIOLÓGICO ENCAPSULADO NÍVEL-A (`DoomAstronaut`):
 * - Silhueta fiel de pressão positiva em polímero amarelo-chartreuse, sem excesso de micro-peças internas;
 * - Capuz amplo integrado com viseira panorâmica frontal em policarbonato fumê e válvulas laterais vermelhas;
 * - Bolsa dorsal encapsulada amarela abrigando o cilindro respiratório internamente (sem tubos expostos);
 * - Anéis vermelhos de vedação nos punhos, luvas químicas pretas e galochas amarelas de solado preto niveladas ao chão.
 */
export class DoomAstronaut {
  readonly root = new THREE.Group();
  readonly bodyPivot = new THREE.Group();
  readonly hipsGroup = new THREE.Group();
  readonly torsoGroup = new THREE.Group();
  readonly headGroup = new THREE.Group();
  readonly plssBackpack = new THREE.Group();
  readonly upperChestGroup = new THREE.Group();

  readonly leftArm: AstronautArmRig;
  readonly rightArm: AstronautArmRig;
  readonly thirdPersonFlashlightGroup = new THREE.Group();
  readonly thirdPersonWebCocoonGroup = new THREE.Group();
  readonly thirdPersonItemGroup = new THREE.Group();
  readonly thirdPersonWeaponGroup = new THREE.Group();
  /** Scratch do resolvedor de dois ossos (sem alocação por quadro). */
  private readonly scratch = {
    pos: new THREE.Vector3(),
    quat: new THREE.Quaternion(),
    quatB: new THREE.Quaternion(),
    elbow: new THREE.Vector3(),
  };
  /** Scratch do resolvedor de dois ossos (sem alocação por quadro). */
  private readonly ikScratch = {
    dir: new THREE.Vector3(),
    bend: new THREE.Vector3(),
    axis: new THREE.Vector3(),
    elbow: new THREE.Vector3(),
    toWrist: new THREE.Vector3(),
    upper: new THREE.Vector3(),
    quat: new THREE.Quaternion(),
    quatB: new THREE.Quaternion(),
    down: new THREE.Vector3(0, -1, 0),
    matrix: new THREE.Matrix4(),
    mirror: new THREE.Matrix4().makeScale(-1, 1, 1),
  };
  private thirdPersonWeapons: Partial<Record<HeldWeapon, THREE.Object3D>> = {};
  private thirdPersonItems: Partial<Record<QuickHandheldKind, THREE.Object3D>> = {};
  private readonly thirdPersonFlashlightMuzzle = new THREE.Object3D();
  private readonly leftLeg: AstronautLegRig;
  private readonly rightLeg: AstronautLegRig;
  private readonly materials: AstronautMaterialSet;
  private readonly tpLensLitMaterial: THREE.Material;
  private readonly allyRagdoll = new AstronautRagdoll();
  private readonly ragSpiderScratch = new THREE.Vector3();
  private readonly ragInvQuat = new THREE.Quaternion();
  private readonly ragLocalVec = new THREE.Vector3();
  private readonly danceBootCornerScratch = new THREE.Vector3();

  private firstPersonMode = true;

  constructor(scene: THREE.Scene, sharedUniforms: DoomSharedUniforms) {
    this.root.name = 'DoomProtagonistAstronaut';
    this.root.userData = {
      characterId: 'protagonist_astronaut',
      role: 'playable_biohazard_operator',
    };

    this.materials = createAstronautMaterials(sharedUniforms);
    const texCache = getBioSuitTextures();
    this.tpLensLitMaterial = createDoomPropMaterial(
      texCache.frostedPatchTex,
      sharedUniforms,
      {
        baseLight: 0.95,
        emissiveBoost: 0.9,
        tint: new THREE.Color(0xfff8dc),
      }
    );

    this.bodyPivot.name = 'AstronautBodyPivot';
    this.root.add(this.bodyPivot);

    // 1. QUADRIL E PERNAS IMPERMEÁVEIS (hipsGroup diretamente com pelvisBrief acoplado sem fresta!)
    this.hipsGroup.name = 'AstronautHips';
    this.hipsGroup.position.set(0, 0.86, 0);
    this.bodyPivot.add(this.hipsGroup);

    const pelvisBrief = new THREE.Mesh(
      new THREE.SphereGeometry(0.196, 14, 10),
      this.materials.suitFabric
    );
    pelvisBrief.scale.set(1.08, 0.78, 0.94);
    pelvisBrief.position.set(0, -0.02, 0);
    this.hipsGroup.add(pelvisBrief);

    this.leftLeg = createAstronautLegRig('left', this.materials);
    this.leftLeg.hipPivot.position.set(-0.115, -0.035, 0);
    this.rightLeg = createAstronautLegRig('right', this.materials);
    this.rightLeg.hipPivot.position.set(0.115, -0.035, 0);
    this.hipsGroup.add(this.leftLeg.hipPivot, this.rightLeg.hipPivot);

    // 2. TRONCO INFLADO DE PRESSÃO POSITIVA + BOLSA DORSAL ENCAPSULADA (SCBA INTERNO)
    this.torsoGroup.name = 'AstronautTorso';
    this.torsoGroup.position.set(0, 0.1, 0);
    this.hipsGroup.add(this.torsoGroup);

    this.upperChestGroup.name = 'AstronautUpperChest';
    this.torsoGroup.add(this.upperChestGroup);

    // Casco único volumoso em LatheGeometry contínua (zero anéis sobrepostos, zero cintas ou mangueiras soltas!)
    const torsoProfile = [
      new THREE.Vector2(0.165, -0.04),
      new THREE.Vector2(0.228, 0.04),
      new THREE.Vector2(0.252, 0.17),
      new THREE.Vector2(0.254, 0.31),
      new THREE.Vector2(0.23, 0.43),
      new THREE.Vector2(0.198, 0.51),
    ];
    const torsoShell = new THREE.Mesh(
      new THREE.LatheGeometry(torsoProfile, 16),
      this.materials.astroCamo
    );
    torsoShell.scale.set(1.06, 1.0, 0.96);
    this.upperChestGroup.add(torsoShell);

    // Bolso frontal translúcido termoselado abaixo da viseira (rente à curvatura frontal, sem saltar)
    const chestTagPatch = new THREE.Mesh(
      new THREE.CylinderGeometry(
        0.255,
        0.253,
        0.115,
        10,
        1,
        true,
        Math.PI - 0.21,
        0.42
      ),
      this.materials.chestPanel
    );
    chestTagPatch.scale.set(1.065, 1.0, 0.975);
    chestTagPatch.position.set(0, 0.235, 0);
    this.upperChestGroup.add(chestTagPatch);

    // Compartimento Dorsal Encapsulado Amarelo (abriga o cilindro de ar por dentro do traje, igual à imagem!)
    this.plssBackpack.name = 'AstronautPLSSBackpack';
    this.plssBackpack.position.set(0, 0.25, 0.155);
    this.torsoGroup.add(this.plssBackpack);

    const scbaProfile = [
      new THREE.Vector2(0.001, -0.31),
      new THREE.Vector2(0.135, -0.27),
      new THREE.Vector2(0.198, -0.15),
      new THREE.Vector2(0.208, 0.02),
      new THREE.Vector2(0.192, 0.17),
      new THREE.Vector2(0.132, 0.26),
      new THREE.Vector2(0.001, 0.3),
    ];
    const scbaMainPouch = new THREE.Mesh(
      new THREE.LatheGeometry(scbaProfile, 16),
      this.materials.astroCamo
    );
    scbaMainPouch.scale.set(1.12, 1.0, 0.95);

    // Rampa dorsal superior contínua unindo a nuca do capuz ao topo da bolsa traseira (perfil exato da foto!)
    const scbaHoodBridge = new THREE.Mesh(
      new THREE.SphereGeometry(0.182, 14, 10),
      this.materials.astroCamo
    );
    scbaHoodBridge.scale.set(1.02, 1.24, 0.96);
    scbaHoodBridge.rotation.x = -0.48;
    scbaHoodBridge.position.set(0, 0.22, -0.035);

    // Dobra inferior arredondada característica da bolsa pressurizada
    const scbaLowerDrape = new THREE.Mesh(
      new THREE.SphereGeometry(0.174, 14, 10),
      this.materials.astroCamo
    );
    scbaLowerDrape.scale.set(1.08, 0.78, 0.92);
    scbaLowerDrape.position.set(0, -0.21, 0.01);

    this.plssBackpack.add(scbaMainPouch, scbaHoodBridge, scbaLowerDrape);

    // 3. CAPUZ ENCAPSULADO INTEGRADO COM VISEIRA PANORÂMICA E VÁLVULAS LATERAIS VERMELHAS
    this.headGroup.name = 'AstronautHelmet';
    this.headGroup.position.set(0, 0.56, -0.012);
    this.torsoGroup.add(this.headGroup);

    const hoodProfile = [
      new THREE.Vector2(0.202, -0.16),
      new THREE.Vector2(0.196, -0.05),
      new THREE.Vector2(0.19, 0.06),
      new THREE.Vector2(0.174, 0.155),
      new THREE.Vector2(0.122, 0.21),
      new THREE.Vector2(0.001, 0.232),
    ];
    const hoodShell = new THREE.Mesh(
      new THREE.LatheGeometry(hoodProfile, 16),
      this.materials.astroCamo
    );
    hoodShell.scale.set(1.01, 1.0, 1.08);

    // Aba frontal arredondada do topo do capuz projetando-se suavemente sobre o alto da viseira
    const hoodBrowCrown = new THREE.Mesh(
      new THREE.SphereGeometry(0.156, 16, 10),
      this.materials.astroCamo
    );
    hoodBrowCrown.scale.set(1.04, 0.44, 1.08);
    hoodBrowCrown.position.set(0, 0.168, -0.044);

    // Viseira panorâmica frontal alta em policarbonato: bordas laterais embutidas no capuz e centro +9mm à frente (zero Z-fighting!)
    const panoramicVisor = new THREE.Mesh(
      new THREE.CylinderGeometry(
        0.154,
        0.162,
        0.295,
        16,
        1,
        true,
        Math.PI - 0.72,
        1.44
      ),
      this.materials.goldVisor
    );
    panoramicVisor.scale.set(1.0, 1.0, 1.37);
    panoramicVisor.position.set(0, 0.002, 0.004);

    // Tampas circulares vermelhas de válvula de exaustão/sobrepressão na lateral superior do capuz (igual à foto!)
    const rightExhaustValve = new THREE.Mesh(
      new THREE.CylinderGeometry(0.028, 0.031, 0.022, 12),
      this.materials.anodizedCrimson
    );
    rightExhaustValve.rotation.z = -(Math.PI * 0.5 - 0.24);
    rightExhaustValve.position.set(0.178, 0.095, 0.026);

    const leftExhaustValve = new THREE.Mesh(
      new THREE.CylinderGeometry(0.028, 0.031, 0.022, 12),
      this.materials.anodizedCrimson
    );
    leftExhaustValve.rotation.z = Math.PI * 0.5 - 0.24;
    leftExhaustValve.position.set(-0.178, 0.095, 0.026);

    this.headGroup.add(
      hoodShell,
      hoodBrowCrown,
      panoramicVisor,
      rightExhaustValve,
      leftExhaustValve
    );

    // 4. BRAÇOS ARTICULADOS DO TRAJE BIOLÓGICO (`AstronautLeftArm` & `AstronautRightArm`)
    this.leftArm = createAstronautArmRig('left', this.materials, {
      includeUpperArm: true,
    });
    this.leftArm.root.position.set(-0.242, 0.425, -0.01);

    this.rightArm = createAstronautArmRig('right', this.materials, {
      includeUpperArm: true,
    });
    this.rightArm.root.position.set(0.242, 0.425, -0.01);

    this.torsoGroup.add(this.leftArm.root, this.rightArm.root);

    // 5. LANTERNA TÁTICA 3D SÓLIDA EMPUNHADA PELA LUVA PRETA DIREITA EM 3ª PESSOA (CO-OP)
    this.thirdPersonFlashlightGroup.name = 'AstronautThirdPersonFlashlight';
    this.thirdPersonFlashlightGroup.position.set(0.012, -0.008, -0.012);
    this.thirdPersonFlashlightGroup.rotation.set(-1.06, 0.04, 0);

    const tpTailCap = new THREE.Mesh(
      new THREE.CylinderGeometry(0.026, 0.029, 0.032, 10),
      this.materials.darkSteel
    );
    tpTailCap.rotation.x = Math.PI * 0.5;
    tpTailCap.position.z = 0.098;

    const tpBarrel = new THREE.Mesh(
      new THREE.CylinderGeometry(0.029, 0.029, 0.172, 10),
      this.materials.machinedAlloy
    );
    tpBarrel.rotation.x = Math.PI * 0.5;
    tpBarrel.position.z = -0.004;

    const tpHeadBell = new THREE.Mesh(
      new THREE.CylinderGeometry(0.033, 0.048, 0.064, 12, 1, false),
      this.materials.machinedAlloy
    );
    tpHeadBell.rotation.x = Math.PI * 0.5;
    tpHeadBell.position.z = -0.138;

    const tpBezelRing = new THREE.Mesh(
      new THREE.CylinderGeometry(0.049, 0.049, 0.016, 12),
      this.materials.darkSteel
    );
    tpBezelRing.rotation.x = Math.PI * 0.5;
    tpBezelRing.position.z = -0.174;

    const tpLensDisc = new THREE.Mesh(
      new THREE.CircleGeometry(0.043, 12),
      this.tpLensLitMaterial
    );
    tpLensDisc.rotation.y = Math.PI;
    tpLensDisc.position.z = -0.183;

    this.thirdPersonFlashlightMuzzle.position.set(0, 0, -0.19);
    this.thirdPersonFlashlightGroup.add(
      tpTailCap,
      tpBarrel,
      tpHeadBell,
      tpBezelRing,
      tpLensDisc,
      this.thirdPersonFlashlightMuzzle
    );
    this.thirdPersonFlashlightGroup.visible = false;
    this.rightArm.gripSocket.add(this.thirdPersonFlashlightGroup);

    this.thirdPersonItemGroup.name = 'AstronautThirdPersonItemAdapter';
    this.thirdPersonItemGroup.rotation.x = -Math.PI * 0.5;
    this.thirdPersonItemGroup.visible = false;
    this.leftArm.gripSocket.add(this.thirdPersonItemGroup);
    // A arma de 3ª pessoa é filha do TRONCO, não da mão: assim as duas mãos
    // podem alcançá-la (ver `applyThirdPersonHeldWeapon`) em vez de a arma
    // perseguir um único soquete e flutuar longe da outra luva.
    this.thirdPersonWeaponGroup.name = 'AstronautThirdPersonWeaponAdapter';
    this.thirdPersonWeaponGroup.visible = false;
    this.torsoGroup.add(this.thirdPersonWeaponGroup);

    // 6. CASULO / FIOS 3D DE SEDA DIMENSIONADOS AO REDOR DO TRAJE BIOLÓGICO INFLADO (ZERO CLIPPING)
    this.thirdPersonWebCocoonGroup.name = 'AstronautThirdPersonWebCocoon';
    const silkBandMat = new THREE.MeshBasicMaterial({
      color: 0xd9ddd2,
      transparent: true,
      opacity: 0.76,
      side: THREE.DoubleSide,
    });
    const bandSpecs: Array<[number, number, number, number, number]> = [
      [0.29, 0.3, 0.09, 0.28, 0.14],
      [0.3, 0.28, 0.11, 0.13, -0.18],
      [0.27, 0.26, 0.08, -0.02, 0.16],
      [0.28, 0.29, 0.07, 0.38, -0.12],
      [0.24, 0.23, 0.1, -0.2, 0.1],
    ];
    for (const [rt, rb, h, yPos, tiltZ] of bandSpecs) {
      const band = new THREE.Mesh(
        new THREE.CylinderGeometry(rt, rb, h, 12, 1, true),
        silkBandMat
      );
      band.scale.set(1.08, 1.0, 1.22);
      band.position.set(0, yPos, 0.055);
      band.rotation.z = tiltZ;
      this.thirdPersonWebCocoonGroup.add(band);
    }
    this.thirdPersonWebCocoonGroup.visible = false;
    this.torsoGroup.add(this.thirdPersonWebCocoonGroup);

    this.setFirstPersonMode(true);
    scene.add(this.root);
  }

  getMarkedArms(): { left: AstronautArmRig; right: AstronautArmRig } {
    return { left: this.leftArm, right: this.rightArm };
  }

  setArmInUse(side: AstronautArmSide, inUse: boolean): void {
    const arm = side === 'right' ? this.rightArm : this.leftArm;
    arm.setInUse(inUse);
  }

  get isFirstPersonMode(): boolean {
    return this.firstPersonMode;
  }

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
      this.thirdPersonFlashlightGroup.visible = false;
      this.thirdPersonItemGroup.visible = false;
      this.thirdPersonWeaponGroup.visible = false;
      this.thirdPersonWebCocoonGroup.visible = false;
    }
  }

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

  applyRagdollPose(
    ragdoll: AstronautRagdoll,
    showSilkWraps = false
  ): void {
    this.root.visible = true;
    this.setFirstPersonMode(false);
    this.thirdPersonFlashlightGroup.visible = false;
    this.thirdPersonWebCocoonGroup.visible = showSilkWraps;

    const pelvis = ragdoll.particles[RAGDOLL_IDX.PELVIS].pos;
    const chest = ragdoll.particles[RAGDOLL_IDX.CHEST].pos;
    const head = ragdoll.particles[RAGDOLL_IDX.HEAD].pos;
    const elbowL = ragdoll.particles[RAGDOLL_IDX.ELBOW_L].pos;
    const handL = ragdoll.particles[RAGDOLL_IDX.HAND_L].pos;
    const elbowR = ragdoll.particles[RAGDOLL_IDX.ELBOW_R].pos;
    const handR = ragdoll.particles[RAGDOLL_IDX.HAND_R].pos;
    const kneeL = ragdoll.particles[RAGDOLL_IDX.KNEE_L].pos;
    const footL = ragdoll.particles[RAGDOLL_IDX.FOOT_L].pos;
    const kneeR = ragdoll.particles[RAGDOLL_IDX.KNEE_R].pos;
    const footR = ragdoll.particles[RAGDOLL_IDX.FOOT_R].pos;

    const sx = chest.x - pelvis.x;
    const sy = chest.y - pelvis.y;
    const sz = chest.z - pelvis.z;
    const sPlanar = Math.hypot(sx, sz);

    const spineYaw =
      sPlanar > 1e-3 ? Math.atan2(sx, sz) : this.root.rotation.y;
    const tiltX = Math.max(
      0.18,
      Math.min(1.54, Math.atan2(sPlanar, Math.max(0.02, sy)))
    );

    this.root.position.set(pelvis.x, 0, pelvis.z);
    this.root.rotation.set(0, spineYaw, 0);

    const pivotDropY = -0.62;
    const targetRelY = Math.max(0.16, pelvis.y) - pivotDropY;
    const cosT = Math.cos(tiltX);
    const sinT = Math.sin(tiltX);
    this.bodyPivot.position.set(0, pivotDropY, 0);
    this.bodyPivot.rotation.set(tiltX, 0, 0);
    this.hipsGroup.position.set(0, targetRelY * cosT, -targetRelY * sinT);
    this.torsoGroup.rotation.set(-0.08, 0, 0);

    this.root.updateMatrixWorld(true);

    // Capuz integrado inclina suavemente sem rasgar a costura com o tronco
    this.torsoGroup.getWorldQuaternion(this.ragInvQuat).invert();
    this.ragLocalVec
      .subVectors(head, chest)
      .applyQuaternion(this.ragInvQuat);
    if (this.ragLocalVec.lengthSq() > 1e-5) {
      this.ragLocalVec.normalize();
      const headPitch = Math.max(
        -0.28,
        Math.min(
          0.26,
          Math.atan2(-this.ragLocalVec.z, Math.max(0.15, this.ragLocalVec.y)) -
            0.18
        )
      );
      const headRoll = Math.max(
        -0.24,
        Math.min(0.24, -this.ragLocalVec.x * 0.55)
      );
      this.headGroup.rotation.set(headPitch, headRoll * 0.4, headRoll);
    }

    this.hipsGroup.getWorldQuaternion(this.ragInvQuat).invert();
    const solveRagdollLeg = (
      leg: AstronautLegRig,
      hipSideSign: number,
      kneeWorld: THREE.Vector3,
      footWorld: THREE.Vector3
    ) => {
      const hipWorld = new THREE.Vector3(hipSideSign * 0.115, -0.035, 0);
      this.hipsGroup.localToWorld(hipWorld);

      const thighLocal = this.ragLocalVec
        .subVectors(kneeWorld, hipWorld)
        .applyQuaternion(this.ragInvQuat);
      if (thighLocal.lengthSq() > 1e-5) {
        thighLocal.normalize();
        const hipPitch = Math.atan2(-thighLocal.z, Math.max(0.08, -thighLocal.y));
        const hipAbd = Math.max(-0.36, Math.min(0.36, thighLocal.x * 0.72));
        leg.hipPivot.rotation.set(
          Math.max(-0.55, Math.min(1.25, hipPitch)),
          0,
          hipAbd
        );

        const shinLocal = new THREE.Vector3()
          .subVectors(footWorld, kneeWorld)
          .applyQuaternion(this.ragInvQuat);
        if (shinLocal.lengthSq() > 1e-5) {
          shinLocal.normalize();
          const shinPitch = Math.atan2(-shinLocal.z, Math.max(0.08, -shinLocal.y));
          const kneeFlex = Math.max(
            -1.35,
            Math.min(0.05, shinPitch - hipPitch)
          );
          leg.kneePivot.rotation.set(kneeFlex, 0, 0);
          leg.anklePivot.rotation.set(0.24, 0, 0);
        }
      }
    };

    solveRagdollLeg(this.leftLeg, -1, kneeL, footL);
    solveRagdollLeg(this.rightLeg, 1, kneeR, footR);

    this.torsoGroup.getWorldQuaternion(this.ragInvQuat).invert();
    const solveRagdollArm = (
      arm: AstronautArmRig,
      sideSign: number,
      elbowWorld: THREE.Vector3,
      handWorld: THREE.Vector3
    ) => {
      const shoulderWorld = new THREE.Vector3(sideSign * 0.242, 0.425, -0.01);
      this.torsoGroup.localToWorld(shoulderWorld);

      const upperLocal = this.ragLocalVec
        .subVectors(elbowWorld, shoulderWorld)
        .applyQuaternion(this.ragInvQuat);
      arm.shoulderPivot.rotation.order = 'YXZ';
      if (upperLocal.lengthSq() > 1e-5) {
        upperLocal.normalize();
        const shPitch = Math.atan2(-upperLocal.z, -upperLocal.y);
        const shSplay = Math.max(
          -0.65,
          Math.min(0.65, upperLocal.x * 0.85)
        );
        arm.shoulderPivot.rotation.set(
          Math.max(-0.6, Math.min(2.65, shPitch)),
          sideSign * -0.18,
          shSplay
        );

        const foreLocal = new THREE.Vector3()
          .subVectors(handWorld, elbowWorld)
          .applyQuaternion(this.ragInvQuat);
        if (foreLocal.lengthSq() > 1e-5) {
          foreLocal.normalize();
          const forePitch = Math.atan2(-foreLocal.z, -foreLocal.y);
          const elbowBend = Math.max(
            0.08,
            Math.min(1.45, Math.abs(forePitch - shPitch))
          );
          arm.elbowPivot.rotation.set(elbowBend, 0, 0);
        }
      }
      arm.wristPivot.rotation.set(0.18, 0, sideSign * 0.12);
      arm.setGripPose('sprawled');
    };

    solveRagdollArm(this.leftArm, -1, elbowL, handL);
    solveRagdollArm(this.rightArm, 1, elbowR, handR);
  }

  getAllyRagdollTentacleHooks():
    | [THREE.Vector3, THREE.Vector3, THREE.Vector3, THREE.Vector3]
    | null {
    return this.allyRagdoll.isActive
      ? this.allyRagdoll.getTentacleAttachmentPoints()
      : null;
  }

  /**
   * Atualiza o operador em Traje Biológico Nível-A em 3ª pessoa completa (aliados Co-op),
   * mantendo as galochas amarelas perfeitamente niveladas ao chão tanto em pé quanto agachado!
   */
  updateThirdPersonAlly(
    position: THREE.Vector3,
    yaw: number,
    pitch: number,
    bobPhase: number,
    planarSpeed: number,
    crouchAmount: number,
    flashlightOn: boolean,
    trappedOrDowned: boolean,
    afk = false,
    draggedBySpider = false,
    spiderWorldPos?: THREE.Vector3 | null,
    dt = 1 / 60,
    slideAmount = 0,
    webStruggle?: WebStrugglePose | null
  ): void {
    this.root.visible = true;
    this.setFirstPersonMode(false);
    this.thirdPersonItemGroup.visible = false;
    this.thirdPersonWeaponGroup.visible = false;

    if (draggedBySpider) {
      if (spiderWorldPos) {
        this.ragSpiderScratch.copy(spiderWorldPos);
      } else {
        this.ragSpiderScratch.set(
          position.x - Math.sin(yaw) * 2.0,
          1.35,
          position.z - Math.cos(yaw) * 2.0
        );
      }
      const pullPulse = 0.5 + 0.5 * Math.sin(bobPhase * 3.5);
      this.allyRagdoll.stepTentacleDrag(
        dt,
        this.ragSpiderScratch,
        position,
        pullPulse,
        []
      );
      this.applyRagdollPose(this.allyRagdoll, true);
      return;
    }

    if (this.allyRagdoll.isActive) {
      this.allyRagdoll.resetInactive();
    }

    this.root.position.set(position.x, position.y, position.z);
    this.root.rotation.set(0, yaw, 0);

    if (trappedOrDowned) {
      this.thirdPersonFlashlightGroup.visible = false;
      this.thirdPersonWebCocoonGroup.visible = true;

      // Sem pose de luta (chamadas remotas antigas): o fôlego sutil de antes,
      // sem nenhuma mudança de comportamento.
      if (!webStruggle) {
        const subtleBreath = Math.sin(bobPhase * 2.4) * 0.03;
        this.bodyPivot.position.set(0, -0.22, 0);
        this.bodyPivot.rotation.set(0.2, subtleBreath * 0.3, subtleBreath * 0.2);
        this.hipsGroup.position.set(0, 0.86, 0);
        this.torsoGroup.rotation.set(0.16, 0, 0);
        this.headGroup.rotation.set(-0.14 + subtleBreath, subtleBreath * 0.5, 0);
        this.leftLeg.hipPivot.rotation.set(0.48, 0, -0.06);
        this.leftLeg.kneePivot.rotation.set(-0.82, 0, 0);
        this.leftLeg.anklePivot.rotation.set(0.34, 0, 0);
        this.rightLeg.hipPivot.rotation.set(0.48, 0, 0.06);
        this.rightLeg.kneePivot.rotation.set(-0.82, 0, 0);
        this.rightLeg.anklePivot.rotation.set(0.34, 0, 0);
        this.leftArm.shoulderPivot.rotation.set(0.48 + subtleBreath, 0.36, -0.12);
        this.leftArm.elbowPivot.rotation.set(0.98, 0, 0);
        this.leftArm.setGripPose('sprawled');
        this.rightArm.shoulderPivot.rotation.set(0.48 - subtleBreath, -0.36, 0.12);
        this.rightArm.elbowPivot.rotation.set(0.98, 0, 0);
        this.rightArm.setGripPose('sprawled');
        this.thirdPersonWebCocoonGroup.scale.set(1, 1, 1);
        return;
      }

      // Luta contra a seda: o operador se debate de verdade — tronco
      // arqueando, braços arrancando, pernas chutando e cabeça jogada para
      // trás — e tudo cresce com o perigo.
      const bound = webStruggle.bound01;
      const yank = webStruggle.yank * bound;
      const strain = Math.max(0, Math.min(1, webStruggle.strain01)) * bound;
      const effort = Math.max(0, Math.min(1, webStruggle.effort01)) * bound;
      const panic = webStruggle.panic01 * bound;
      const breath = webStruggle.breath * bound;
      const tremor = webStruggle.tremor * bound;
      const sway = webStruggle.sway * bound;
      const heave = Math.max(0, yank);
      const pulling = yank > 0.12 || strain > 0.45;

      // O corpo afunda no casulo conforme cansa e empina a cada arranco.
      this.bodyPivot.position.set(
        sway * 0.012,
        -0.22 + heave * 0.05 + effort * 0.03 + breath * 0.006,
        0
      );
      this.bodyPivot.rotation.set(
        0.2 - yank * 0.16 + breath * 0.05,
        sway * 0.06,
        sway * 0.05 + tremor * 0.02
      );
      this.hipsGroup.position.set(0, 0.86 - effort * 0.03 + breath * 0.008, 0);
      // Tronco arqueia para trás ao puxar os fios...
      this.torsoGroup.rotation.set(
        0.16 + strain * 0.12 + breath * 0.02,
        -sway * 0.04,
        tremor * 0.03
      );
      // ... e a cabeça vai junto, batendo no capacete no contragolpe.
      this.headGroup.rotation.set(
        -0.14 + breath * 0.05 + heave * 0.12 + panic * 0.04,
        sway * 0.05 + tremor * 0.02,
        tremor * 0.03
      );

      // Pernas chutando alternadas (a seda prende as coxas, os joelhos lutam).
      const kickL = breath * 0.16 * (0.25 + effort);
      const kickR = -breath * 0.16 * (0.25 + effort);
      this.leftLeg.hipPivot.rotation.set(0.48 + kickL * 0.5, 0, -0.06);
      this.leftLeg.kneePivot.rotation.set(-0.82 + kickL, 0, 0);
      this.leftLeg.anklePivot.rotation.set(0.34 - kickL * 0.4, 0, 0);
      this.rightLeg.hipPivot.rotation.set(0.48 + kickR * 0.5, 0, 0.06);
      this.rightLeg.kneePivot.rotation.set(-0.82 + kickR, 0, 0);
      this.rightLeg.anklePivot.rotation.set(0.34 - kickR * 0.4, 0, 0);

      // Braços: presos ao tronco pela seda, arrancando para cima no puxão.
      this.leftArm.shoulderPivot.rotation.set(
        0.48 + breath * 0.04 + heave * 0.34 + strain * 0.12,
        0.36 - strain * 0.1,
        -0.12 - strain * 0.08 - tremor * 0.04
      );
      this.leftArm.elbowPivot.rotation.set(0.98 - heave * 0.3, 0, 0);
      this.leftArm.setGripPose(pulling ? 'claw' : 'sprawled');
      this.rightArm.shoulderPivot.rotation.set(
        0.48 - breath * 0.04 + heave * 0.34 + strain * 0.12,
        -0.36 + strain * 0.1,
        0.12 + strain * 0.08 + tremor * 0.04
      );
      this.rightArm.elbowPivot.rotation.set(0.98 - heave * 0.3, 0, 0);
      this.rightArm.setGripPose(pulling ? 'claw' : 'sprawled');

      // A seda do casulo estica junto com o esforço.
      this.thirdPersonWebCocoonGroup.scale.set(
        1 + strain * 0.06,
        1 - strain * 0.03,
        1 + strain * 0.06
      );
      return;
    }

    this.thirdPersonWebCocoonGroup.visible = false;
    this.thirdPersonWebCocoonGroup.scale.set(1, 1, 1);

    const slide = Number.isFinite(slideAmount) ? THREE.MathUtils.clamp(slideAmount, 0, 1) : 0;
    const crouch = THREE.MathUtils.clamp(crouchAmount, 0, 1);
    const stride = Math.min(1, planarSpeed / 5.4) * (1 - slide);
    const legSwing = Math.sin(bobPhase * 0.5) * 0.48 * stride;
    const armSwing = Math.sin(bobPhase * 0.5) * 0.28 * stride;
    const leftLift = Math.max(0, Math.cos(bobPhase * 0.5)) * 0.42 * stride;
    const rightLift = Math.max(0, -Math.cos(bobPhase * 0.5)) * 0.42 * stride;

    // Durante o slide, uma perna avança e a outra dobra para equilibrar o corpo.
    // Em todas as fases do blend, a perna mais longa determina a altura do quadril.
    const baseHip = crouch * 1.08;
    const baseKnee = -crouch * 1.88;
    const leftHip = THREE.MathUtils.lerp(baseHip + legSwing, 1.27, slide);
    const leftKnee = THREE.MathUtils.lerp(baseKnee - leftLift, -0.30, slide);
    const rightHip = THREE.MathUtils.lerp(baseHip - legSwing, 0.90, slide);
    const rightKnee = THREE.MathUtils.lerp(baseKnee - rightLift, -2.0, slide);
    const shortening = (hip: number, knee: number) =>
      0.365 * (1 - Math.cos(hip)) + 0.345 * (1 - Math.cos(hip + knee));
    const crouchShortening = shortening(baseHip, baseKnee);
    const walkShortening = Math.min(
      shortening(baseHip + legSwing, baseKnee - leftLift),
      shortening(baseHip - legSwing, baseKnee - rightLift)
    );
    const slideShortening = Math.min(shortening(leftHip, leftKnee), shortening(rightHip, rightKnee));
    const walkBounce = Math.abs(Math.sin(bobPhase * 0.5)) * 0.018 * stride;
    const torsoLeanForward = -(crouch * 0.14 + stride * 0.04) + slide * 0.24;
    this.bodyPivot.position.set(0, -(crouchShortening + slideShortening - walkShortening) + walkBounce, 0);
    this.bodyPivot.rotation.set(0, 0, 0);
    this.hipsGroup.position.set(0, 0.86, 0);
    this.torsoGroup.rotation.set(torsoLeanForward, 0, slide * 0.045);

    // Capuz encapsulado acompanha o olhar sem abrir fresta na gola.
    const afkHeadNod = afk ? -0.16 : 0;
    this.headGroup.rotation.set(
      Math.max(-0.24, Math.min(0.24, pitch * 0.38)) - torsoLeanForward * 0.5 + afkHeadNod,
      0, afk ? 0.04 : -slide * 0.025
    );

    this.leftLeg.hipPivot.rotation.set(leftHip, 0, -0.03 * (1 - slide));
    this.leftLeg.kneePivot.rotation.set(leftKnee, 0, 0);
    this.leftLeg.anklePivot.rotation.set(
      THREE.MathUtils.lerp(-baseHip - baseKnee + leftLift * 0.45 - legSwing * 0.35, -leftHip - leftKnee, slide), 0, 0
    );
    this.rightLeg.hipPivot.rotation.set(rightHip, 0, 0.03 * (1 - slide));
    this.rightLeg.kneePivot.rotation.set(rightKnee, 0, 0);
    this.rightLeg.anklePivot.rotation.set(
      THREE.MathUtils.lerp(-baseHip - baseKnee + rightLift * 0.45 + legSwing * 0.35, -rightHip - rightKnee, slide), 0, 0
    );

    this.leftArm.shoulderPivot.rotation.order = 'YXZ';
    this.leftArm.shoulderPivot.rotation.set(
      0.12 - armSwing + crouch * 0.16 + slide * 0.38,
      0.06 + slide * 0.18,
      -0.15 - slide * 0.22
    );
    this.leftArm.elbowPivot.rotation.set(0.28 + stride * 0.14 + slide * 0.45, 0, 0);
    this.leftArm.setGripPose(slide > 0.35 ? 'open' : 'relaxed');
    this.leftArm.wristPivot.rotation.set(0, 0, 0);

    this.rightArm.shoulderPivot.rotation.order = 'YXZ';
    if (flashlightOn) {
      const pitchClamp = Math.max(-0.52, Math.min(0.52, pitch));
      this.rightArm.shoulderPivot.rotation.set(
        0.32 + pitchClamp * 0.42 - torsoLeanForward * 0.5,
        -0.06,
        0.14
      );
      this.rightArm.elbowPivot.rotation.set(
        0.96 + pitchClamp * 0.58 - torsoLeanForward * 0.5,
        0.06,
        -0.04
      );
      this.rightArm.wristPivot.rotation.set(-0.22, 0, 0);
      this.rightArm.setGripPose('cylindrical');
      this.thirdPersonFlashlightGroup.visible = true;
    } else {
      this.rightArm.shoulderPivot.rotation.set(
        0.12 + armSwing + crouch * 0.16 + slide * 0.28,
        -0.06 - slide * 0.16,
        0.15 + slide * 0.18
      );
      this.rightArm.elbowPivot.rotation.set(0.28 + stride * 0.14 + slide * 0.36, 0, 0);
      this.rightArm.wristPivot.rotation.set(0, 0, 0);
      this.rightArm.setGripPose('relaxed');
      this.thirdPersonFlashlightGroup.visible = false;
    }
  }

  getThirdPersonFlashlightMuzzleWorld(
    outPos: THREE.Vector3,
    outDir: THREE.Vector3
  ): boolean {
    if (!this.root.visible || !this.thirdPersonFlashlightGroup.visible) {
      return false;
    }
    this.root.updateMatrixWorld(true);
    this.thirdPersonFlashlightMuzzle.getWorldPosition(outPos);
    const origin = new THREE.Vector3();
    this.thirdPersonFlashlightGroup.getWorldPosition(origin);
    outDir.copy(outPos).sub(origin);
    if (outDir.lengthSq() < 1e-6) {
      outDir.set(0, 0, -1);
    } else {
      outDir.normalize();
    }
    return true;
  }

  /** Use copies of the real viewmodel objects attached to the ally's grip socket. */
  setThirdPersonItemProps(props: Record<QuickHandheldKind, THREE.Object3D>): void {
    this.thirdPersonItemGroup.clear();
    this.thirdPersonItems = props;
    for (const [kind, prop] of Object.entries(props)) {
      prop.name = `AstronautThirdPersonItem-${kind}`;
      prop.visible = false;
      this.thirdPersonItemGroup.add(prop);
    }
  }

  setThirdPersonWeaponProps(props: Record<HeldWeapon, THREE.Object3D>): void {
    this.thirdPersonWeaponGroup.clear();
    this.thirdPersonWeapons = props;
    for (const [kind, prop] of Object.entries(props)) {
      prop.name = `AstronautThirdPersonWeapon-${kind}`;
      prop.visible = false;
      this.thirdPersonWeaponGroup.add(prop);
    }
  }

  applyThirdPersonHeldWeapon(kind: HeldWeapon): void {
    const prop = this.thirdPersonWeapons[kind];
    if (!prop) return;
    for (const weapon of Object.values(this.thirdPersonWeapons)) weapon.visible = false;
    prop.visible = true;
    this.thirdPersonWeaponGroup.visible = true;

    const gripAnchor = prop.getObjectByName('WeaponGripAnchor');
    const supportAnchor = prop.getObjectByName('WeaponSupportAnchor');
    if (!gripAnchor) {
      // Arma sem âncoras (modelo antigo): mantém a pose de uma mão só.
      this.leftArm.shoulderPivot.rotation.set(1.05, -0.12, -0.12);
      this.leftArm.elbowPivot.rotation.set(0.7, -0.12, 0.1);
      this.leftArm.wristPivot.rotation.set(0.05, 0, 0);
      this.leftArm.setGripPose('cylindrical');
      return;
    }

    // 1) A arma entra pela mão direita: o punho comanda o enquadramento.
    const group = this.thirdPersonWeaponGroup;
    this.root.updateWorldMatrix(true, true);
    const gunQuat = this.scratch.quat.setFromRotationMatrix(this.weaponHoldBasis());
    const localGrip = gripAnchor.getWorldPosition(this.scratch.elbow);
    this.torsoGroup.worldToLocal(localGrip);
    const gripOffset = localGrip.clone().sub(group.position).applyQuaternion(
      group.quaternion.clone().invert()
    );
    group.quaternion.copy(gunQuat);
    group.position.copy(WEAPON_HOLD.gripPoint).sub(gripOffset.clone().applyQuaternion(gunQuat));

    // 2) As duas mãos caem sobre as âncoras da arma (IK de dois ossos).
    this.root.updateWorldMatrix(true, true);
    const torsoInv = this.torsoGroup.getWorldQuaternion(this.scratch.quatB).invert();
    const readAnchor = (node: THREE.Object3D): { pos: THREE.Vector3; quat: THREE.Quaternion } => {
      const pos = node.getWorldPosition(new THREE.Vector3());
      this.torsoGroup.worldToLocal(pos);
      const quat = node.getWorldQuaternion(new THREE.Quaternion()).premultiply(torsoInv);
      return { pos, quat };
    };
    const grip = readAnchor(gripAnchor);
    this.poseArmToGrip(this.rightArm, grip.pos, grip.quat, WEAPON_HOLD.rightElbowHint);
    if (supportAnchor) {
      const support = readAnchor(supportAnchor);
      this.poseArmToGrip(this.leftArm, support.pos, support.quat, WEAPON_HOLD.leftElbowHint);
    } else {
      this.leftArm.setGripPose('cylindrical');
    }
  }

  /** Base ortogonal da arma empunhada (colunas: direita, cima, +Z da arma). */
  private weaponHoldBasis(): THREE.Matrix4 {
    const forward = WEAPON_HOLD.aim.clone().normalize();
    const zAxis = forward.clone().negate();
    const xAxis = new THREE.Vector3()
      .crossVectors(new THREE.Vector3(0, 1, 0), zAxis)
      .normalize();
    const yAxis = new THREE.Vector3().crossVectors(zAxis, xAxis).normalize();
    const roll = new THREE.Quaternion().setFromAxisAngle(zAxis, WEAPON_HOLD.roll);
    xAxis.applyQuaternion(roll);
    yAxis.applyQuaternion(roll);
    return this.ikScratch.matrix.makeBasis(xAxis, yAxis, zAxis);
  }

  /**
   * Coloca a luva do braço exatamente sobre uma âncora da arma, resolvendo
   * ombro e cotovelo por IK de dois ossos e o pulso pela orientação pedida.
   * É o que faz a mão do traje "agarrar" a modelagem em vez de flutuar ao lado.
   */
  private poseArmToGrip(
    arm: AstronautArmRig,
    targetPos: THREE.Vector3,
    targetQuat: THREE.Quaternion,
    elbowHint: THREE.Vector3
  ): void {
    const s = this.ikScratch;
    const sign = arm.side === 'right' ? 1 : -1;
    // O soquete da empunhadura fica dentro da mão: o pulso vem um pouco antes.
    const socketOffset = new THREE.Vector3(-sign * 0.022, -0.068, 0).applyQuaternion(targetQuat);
    const shoulder = arm.root.position;
    const wrist = targetPos.clone().sub(socketOffset).sub(shoulder);
    const distance = THREE.MathUtils.clamp(
      wrist.length(),
      Math.abs(ARM_UPPER_LENGTH - ARM_FOREARM_LENGTH) + 0.004,
      ARM_UPPER_LENGTH + ARM_FOREARM_LENGTH - 0.004
    );
    const dir = wrist.normalize();
    // Ângulo do ombro: triângulo ombro-cotovelo-pulso.
    const cosShoulder = THREE.MathUtils.clamp(
      (ARM_UPPER_LENGTH * ARM_UPPER_LENGTH + distance * distance -
        ARM_FOREARM_LENGTH * ARM_FOREARM_LENGTH) /
        (2 * ARM_UPPER_LENGTH * distance),
      -1,
      1
    );
    const shoulderAngle = Math.acos(cosShoulder);
    // Plano da flexão: o cotovelo é empurrado para o lado do `elbowHint`.
    s.axis.copy(elbowHint).normalize();
    s.bend.crossVectors(dir, s.axis);
    if (s.bend.lengthSq() < 1e-6) s.bend.crossVectors(dir, new THREE.Vector3(0, 0, 1));
    s.bend.normalize();
    s.elbow.crossVectors(s.bend, dir).normalize();
    s.upper
      .copy(dir)
      .multiplyScalar(Math.cos(shoulderAngle))
      .addScaledVector(s.elbow, Math.sin(shoulderAngle))
      .normalize();

    arm.shoulderPivot.quaternion.setFromUnitVectors(s.down, s.upper);
    const elbowPos = s.upper.clone().multiplyScalar(ARM_UPPER_LENGTH).add(shoulder);
    s.toWrist
      .copy(targetPos)
      .sub(socketOffset)
      .sub(elbowPos)
      .normalize()
      .applyQuaternion(s.quatB.copy(arm.shoulderPivot.quaternion).invert());
    arm.elbowPivot.quaternion.setFromUnitVectors(s.down, s.toWrist);
    arm.wristPivot.quaternion
      .copy(arm.shoulderPivot.quaternion)
      .multiply(arm.elbowPivot.quaternion)
      .invert()
      .multiply(targetQuat);
    arm.setGripPose('cylindrical');
  }

  /** Overlay only the left arm; locomotion, flashlight and the actual gameplay remain independent. */
  applyThirdPersonItemAction(action: QuickItemAction): void {
    const prop = this.thirdPersonItems[action.kind];
    if (!prop) return;
    for (const item of Object.values(this.thirdPersonItems)) item.visible = false;
    prop.visible = true;
    this.thirdPersonWeaponGroup.visible = false;
    this.thirdPersonItemGroup.visible = true;
    const u = THREE.MathUtils.clamp(action.progress, 0, 1);
    const raise = Math.sin(Math.PI * u);
    const slash = action.kind === 'knife' && action.mode !== 'pickup' ? Math.sin(Math.PI * THREE.MathUtils.clamp((u - 0.24) / 0.48, 0, 1)) : 0;
    const turn = action.kind === 'key' && action.mode !== 'pickup' ? Math.sin(Math.PI * THREE.MathUtils.clamp((u - 0.3) / 0.5, 0, 1)) : 0;
    this.leftArm.shoulderPivot.rotation.order = 'YXZ';
    this.leftArm.shoulderPivot.rotation.set(0.40 + raise * 0.65, -0.10 - slash * 0.50, -0.12 + slash * 0.40);
    this.leftArm.elbowPivot.rotation.set(0.30 + raise * 0.25 - slash * 0.16, -0.08 - slash * 0.18, 0.08);
    this.leftArm.wristPivot.rotation.set(-slash * 0.3, turn * 0.85 - slash * 0.45, -slash * 0.3);
    this.leftArm.setGripPose(action.kind === 'knife' || action.kind === 'flare' ? 'knife'
      : action.kind === 'battery' || action.kind === 'radar' ? 'box'
      : action.kind === 'key' ? 'key' : 'cylindrical');
    const blade = prop.getObjectByName('AstronautPocketKnifeBladePivot');
    if (blade) blade.rotation.x = action.mode === 'pickup' ? -2.05 : u < 0.24 ? -2.05 * (1 - Math.pow(u / 0.24, 2.2)) : 0;
  }

  /**
   * Aplica uma pose de DANCE procedural (gerada por `computeDoomDancePose`) ao
   * traje 3D completo em 3ª pessoa.
   *
   * Garantias do rig de dança:
   * - O capacete/capuz gira em limites seguros (nunca rasga a costura da gola);
   * - Nenhuma galocha afunda no piso e ao menos uma fica apoiada; o `bodyPivot`
   *   é recalculado a partir do ponto mais baixo das solas;
   * - A lanterna 3D e a teia do casulo ficam ocultas durante a coreografia.
   */
  applyDancePose(
    pose: DoomDancePose,
    worldPos: THREE.Vector3,
    facingYaw: number
  ): void {
    this.root.visible = true;
    this.setFirstPersonMode(false);
    this.thirdPersonFlashlightGroup.visible = false;
    this.thirdPersonItemGroup.visible = false;
    this.thirdPersonWeaponGroup.visible = false;
    this.thirdPersonWebCocoonGroup.visible = false;

    this.root.position.set(worldPos.x, worldPos.y, worldPos.z);
    this.root.rotation.set(0, facingYaw + pose.bodyYaw, 0);

    // Quadril: base neutra + torção/balanço da coreografia
    this.bodyPivot.position.set(0, 0, 0);
    this.bodyPivot.rotation.set(0, 0, 0);
    this.hipsGroup.position.set(0, 0.86, 0);
    this.hipsGroup.rotation.set(0, pose.hipsYaw, pose.hipsRoll);

    // Tronco: inclinação, torção e balanço lateral
    this.torsoGroup.rotation.set(pose.torsoPitch, pose.torsoYaw, pose.torsoRoll);

    // Cabeça: limites rígidos para preservar a costura da gola do capuz
    this.headGroup.rotation.set(
      clampDanceValue(pose.headPitch, -0.26, 0.26),
      clampDanceValue(pose.headYaw, -0.5, 0.5),
      clampDanceValue(pose.headRoll, -0.24, 0.24)
    );

    this.applyDanceArmPose(this.leftArm, pose.leftArm);
    this.applyDanceArmPose(this.rightArm, pose.rightArm);
    this.applyDanceLegPose(this.leftLeg, pose.leftLeg);
    this.applyDanceLegPose(this.rightLeg, pose.rightLeg);

    const handPose: AstronautGripPose =
      pose.handPose === 'claw'
        ? 'claw'
        : pose.handPose === 'relaxed'
          ? 'relaxed'
          : 'open';
    this.leftArm.setGripPose(handPose);
    this.rightArm.setGripPose(handPose);

    // Mede o ponto mais baixo das galochas e ajusta o corpo para apoiar a sola
    // no plano da posição do jogador, inclusive em pisos elevados.
    // O "bounce" da coreografia é feito pela flexão dos joelhos (dentro da
    // pose), então nunca flutuamos nem afundamos no chão.
    this.root.updateMatrixWorld(true);
    const lowestBootY = this.measureLowestBootY();
    this.bodyPivot.position.y = worldPos.y - lowestBootY;
  }

  private applyDanceArmPose(
    arm: AstronautArmRig,
    pose: DoomDanceArmPose
  ): void {
    // As poses já contêm sinais distintos para esquerda e direita.
    arm.shoulderPivot.rotation.order = 'YXZ';
    arm.shoulderPivot.rotation.set(pose.shoulder.x, pose.shoulder.y, pose.shoulder.z);
    arm.elbowPivot.rotation.set(pose.elbow, 0, 0);
    arm.wristPivot.rotation.set(pose.wrist, 0, pose.wristZ);
  }

  private applyDanceLegPose(leg: AstronautLegRig, pose: DoomDanceLegPose): void {
    leg.hipPivot.rotation.set(pose.hip.x, pose.hip.y, pose.hip.z);
    leg.kneePivot.rotation.set(pose.knee, 0, 0);
    leg.anklePivot.rotation.set(pose.ankle, 0, 0);
  }

  /**
   * Mede o menor `y` mundial alcançado pelas galochas (considerando as 8
   * quinas de cada bounding box já transformado pela matriz mundial).
   */
  private measureLowestBootY(): number {
    let lowest = Infinity;
    const legs = [this.leftLeg, this.rightLeg];
    for (const leg of legs) {
      for (const mesh of leg.bootMeshes) {
        const bbox = mesh.geometry.boundingBox;
        if (!bbox) continue;
        for (let c = 0; c < 8; c++) {
          this.danceBootCornerScratch
            .set(
              c & 1 ? bbox.max.x : bbox.min.x,
              c & 2 ? bbox.max.y : bbox.min.y,
              c & 4 ? bbox.max.z : bbox.min.z
            )
            .applyMatrix4(mesh.matrixWorld);
          if (this.danceBootCornerScratch.y < lowest) {
            lowest = this.danceBootCornerScratch.y;
          }
        }
      }
    }
    return Number.isFinite(lowest) ? lowest : 0;
  }

  disposeFromScene(scene: THREE.Scene): void {
    scene.remove(this.root);
  }
}
