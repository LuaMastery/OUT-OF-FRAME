import * as THREE from 'three';
import { computeAdaptiveVerticalFov } from './DoomTouchControls';

/**
 * ============================================================================
 * SHOTGUN DE COMBATE — MONTAGEM POR PEÇAS + MUNIÇÃO + VIEWMODEL 3D
 * ============================================================================
 * A arma NÃO aparece pronta no mapa: o corpo, o cano, a bomba (guarda-mão) e a
 * coronha ficam ESPALHADOS em quatro salas especiais do complexo. Só depois de
 * reunir as 4 peças o jogador consegue montar a shotgun; depois disso o
 * desafio passa a ser achar cartuchos 12 Gauge e caçar a Aranha Gigante.
 *
 * Este módulo concentra:
 * - O catálogo de peças + as regras de montagem (funções puras e testáveis);
 * - O cálculo de dano do disparo (pellets com queda por distância);
 * - O viewmodel 3D em 1ª pessoa (cano, receptor, bomba e coronha) com o
 *   recuo, o clarão de boca e a animação de bombeamento.
 */

export const SHOTGUN_ITEM_ID = 'combat_shotgun';
export const SHOTGUN_AMMO_ITEM_ID = 'shotgun_shells';

export type ShotgunPartId =
  | 'shotgun_receiver'
  | 'shotgun_barrel'
  | 'shotgun_pump'
  | 'shotgun_stock';

export const SHOTGUN_PART_IDS: readonly ShotgunPartId[] = [
  'shotgun_receiver',
  'shotgun_barrel',
  'shotgun_pump',
  'shotgun_stock',
];

/** Peças de um conjunto completo: a arma só fica pronta com as quatro juntas. */
export const SHOTGUN_PARTS_PER_SET = SHOTGUN_PART_IDS.length;

/** Máximo de conjuntos completos preparados pelo servidor (um por jogador da sala). */
export const MAX_SHOTGUN_PART_SETS = 8;

/** Máximo de peças da shotgun que uma partida pode ter no mundo. */
export const MAX_SHOTGUN_PART_SLOTS = SHOTGUN_PARTS_PER_SET * MAX_SHOTGUN_PART_SETS;

/**
 * Quantos conjuntos completos de peças o servidor prepara.
 *
 * Um jogador nunca monta a arma com um pedaço só: CADA jogador precisa das
 * quatro peças (corpo, cano, bomba e coronha). O mundo então recebe um conjunto
 * completo por jogador presente — sozinho é 1 conjunto (4 peças); em co-op com
 * dois jogadores são 2 conjuntos (8 peças) e assim por diante, até o limite de
 * jogadores da sala.
 */
export function resolveShotgunPartSetCount(
  playerCount: number,
  isMultiplayer = false
): number {
  if (!isMultiplayer) return 1;
  const players = Math.max(1, Math.floor(playerCount));
  return Math.max(1, Math.min(MAX_SHOTGUN_PART_SETS, players));
}

/**
 * Quantas peças da shotgun existem numa partida (sempre múltiplos de 4).
 *
 * Solo mantém o conjunto completo (4 peças), para que a arma ainda possa ser
 * montada sozinho. Em co-op o servidor prepara um conjunto completo para cada
 * jogador presente no momento em que o mundo é criado — 1 jogador = 4 peças,
 * 2 = 8, 3 = 12 — para que cada um tenha a sua própria shotgun para montar.
 *
 * O valor é fixado na geração do mundo (`DoomArenaLayout`) e viaja junto com o
 * layout, então todos os jogadores da sala veem exatamente as mesmas peças.
 */
export function resolveShotgunPartSlotCount(
  playerCount: number,
  isMultiplayer = false
): number {
  return resolveShotgunPartSetCount(playerCount, isMultiplayer) * SHOTGUN_PARTS_PER_SET;
}

/** Arredonda uma contagem livre de peças para conjuntos completos fechados. */
export function normalizeShotgunPartSlotCount(slotCount: number): number {
  const sets = Math.max(1, Math.ceil(Math.floor(slotCount) / SHOTGUN_PARTS_PER_SET));
  return Math.min(MAX_SHOTGUN_PART_SETS, sets) * SHOTGUN_PARTS_PER_SET;
}

/**
 * Peças que realmente existem no mapa.
 *
 * O conjunto completo se repete quantas vezes for necessário: 4 peças é uma
 * shotgun, 8 peças são duas shotguns completas (uma por jogador) e assim por
 * diante. A ordem canônica é mantida dentro de cada conjunto.
 */
export function getAvailableShotgunPartIds(
  slotCount: number = SHOTGUN_PARTS_PER_SET
): ShotgunPartId[] {
  const total = Math.max(1, Math.min(MAX_SHOTGUN_PART_SLOTS, Math.floor(slotCount)));
  const ids: ShotgunPartId[] = [];
  for (let i = 0; i < total; i++) {
    ids.push(SHOTGUN_PART_IDS[i % SHOTGUN_PARTS_PER_SET]);
  }
  return ids;
}

/**
 * Os QUATRO tipos de peça exigidos para montar a arma.
 *
 * Montar a shotgun sempre depende do conjunto inteiro — nunca de uma peça
 * apenas — mesmo quando o mundo tem vários conjuntos espalhados pelas salas.
 */
export function getRequiredShotgunPartIds(): ShotgunPartId[] {
  return [...SHOTGUN_PART_IDS];
}

export interface ShotgunPartDef {
  readonly id: ShotgunPartId;
  readonly name: string;
  readonly shortName: string;
  readonly description: string;
  readonly badge: string;
}

export const SHOTGUN_PARTS: Readonly<Record<ShotgunPartId, ShotgunPartDef>> = {
  shotgun_receiver: {
    id: 'shotgun_receiver',
    name: 'Corpo da Shotgun (Ação de Pump)',
    shortName: 'CORPO',
    description:
      'Bloco de aço com o mecanismo de ação, ferrolho e gatilho. Sem ele a arma é apenas cano e madeira.',
    badge: 'CORPO',
  },
  shotgun_barrel: {
    id: 'shotgun_barrel',
    name: 'Cano da Shotgun 18"',
    shortName: 'CANO',
    description:
      'Cano de aço blindado com ponteira de mira. É a peça que mais assusta a Aranha.',
    badge: 'CANO',
  },
  shotgun_pump: {
    id: 'shotgun_pump',
    name: 'Bomba (Guarda-mão) da Shotgun',
    shortName: 'BOMBA',
    description:
      'Guarda-mão de polímero que bombeia o cartucho. Precisa deslizar livre para expulsar o estojo vazio.',
    badge: 'BOMBA',
  },
  shotgun_stock: {
    id: 'shotgun_stock',
    name: 'Coronha da Shotgun',
    shortName: 'CORONHA',
    description:
      'Coronha de madeira rebaixada com encosto de borracha. Sem coronha o cano é só um cano.',
    badge: 'CORONHA',
  },
};

/** Vida máxima da Aranha Gigante (dano de shotgun = 100 = abate). */
export const SPIDER_MAX_HEALTH = 100;

/** Número de projéteis por disparo. */
export const SHOTGUN_PELLET_COUNT = 9;

/** Alcance máximo (m) em que o disparo ainda causa dano. */
export const SHOTGUN_MAX_RANGE = 26;

/**
 * Dano de um único disparo contra a Aranha, considerando a distância e a
 * dispersão aproximada dos chumbos em função da distância.
 */
export function computeShotgunBlastDamage(
  distanceMeters: number,
  pellets = SHOTGUN_PELLET_COUNT
): number {
  if (!Number.isFinite(distanceMeters) || distanceMeters < 0) return 0;
  if (distanceMeters > SHOTGUN_MAX_RANGE) return 0;

  // O dano diminui progressivamente até 12% no limite do alcance.
  const falloff = Math.max(
    0.12,
    1 - Math.pow(Math.min(1, distanceMeters / SHOTGUN_MAX_RANGE), 1.35) * 0.88
  );

  // Alvo grande (a Aranha) — mesmo a 18m metade das pelotas ainda encosta
  const targetFactor = distanceMeters <= 9 ? 1 : distanceMeters <= 16 ? 0.66 : 0.42;

  const perPellet = 7.4 * falloff * targetFactor;
  return Math.max(0, perPellet * Math.max(1, pellets));
}

/** Retorna a distância do acerto, ou null se houver parede/obstáculo ou o alvo estiver fora de alcance. */
export function shotgunImpactDistance(
  origin: THREE.Vector3,
  direction: THREE.Vector3,
  target: THREE.Vector3,
  obstacles: readonly THREE.Box3[]
): number | null {
  if (!Number.isFinite(direction.lengthSq()) || direction.lengthSq() < 0.0001) return null;
  const ray = new THREE.Ray(origin, direction.clone().normalize());
  const impact = ray.intersectSphere(new THREE.Sphere(target, 1.05), new THREE.Vector3());
  if (!impact) return null;
  const distance = origin.distanceTo(impact);
  if (distance > SHOTGUN_MAX_RANGE) return null;
  for (const box of obstacles) {
    const hit = ray.intersectBox(box, new THREE.Vector3());
    if (hit && origin.distanceTo(hit) < distance - 0.02) return null;
  }
  return distance;
}

/** Quantidade de peças que o jogador já reuniu. */
export function countShotgunPartsOwned(
  hasItem: (itemId: string) => boolean
): number {
  let count = 0;
  for (const id of SHOTGUN_PART_IDS) {
    if (hasItem(id)) count++;
  }
  return count;
}

/** Verdadeiro quando o jogador já tem as 4 peças e pode montar a shotgun. */
export function canAssembleShotgun(
  hasItem: (itemId: string) => boolean
): boolean {
  return countShotgunPartsOwned(hasItem) === SHOTGUN_PART_IDS.length;
}

/**
 * Lista das peças que ainda faltam (para o feedback do HUD).
 *
 * A exigência é sempre o conjunto COMPLETO: ter duas vezes a mesma peça não
 * substitui as outras, então a contagem ignora repetições.
 */
export function getMissingShotgunParts(
  hasItem: (itemId: string) => boolean,
  availableParts: readonly ShotgunPartId[] = SHOTGUN_PART_IDS
): ShotgunPartId[] {
  const required = new Set(availableParts.length ? availableParts : SHOTGUN_PART_IDS);
  return SHOTGUN_PART_IDS.filter((id) => required.has(id) && !hasItem(id));
}

/** Rótulo curto do estado de montagem ("2/4 PEÇAS"). */
export function formatShotgunAssemblyProgress(
  hasItem: (itemId: string) => boolean
): string {
  const found = countShotgunPartsOwned(hasItem);
  return `${found}/${SHOTGUN_PART_IDS.length} PEÇAS`;
}

/** Plaquinha estampada (marca/série) aplicada na lateral do receptor. */
function createShotgunLabelTexture(): THREE.DataTexture {
  const size = 32;
  const data = new Uint8Array(size * size * 4);
  const rows: Array<[number, number, number]> = [
    [7, 9, 13],
    [7, 16, 9],
    [7, 23, 15],
  ];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      let ink = 0;
      for (const [startX, row, len] of rows) {
        if (Math.abs(y - row) <= 1 && x >= startX && x < startX + len && (x + row) % 3 !== 0) ink = 1;
      }
      const v = ink ? 208 : 30;
      data[i] = v;
      data[i + 1] = v - 4;
      data[i + 2] = ink ? 198 : 32;
      data[i + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
}

/* ==========================================================================
   VIEWMODEL 3D DA SHOTGUN EM 1ª PESSOA
   ========================================================================== */

/**
 * Modelo em 1ª pessoa da shotgun de pump:
 * - coronha de madeira rebaixada com punho;
 * - receptor de aço com guarda-mato e gatilho;
 * - cano + tubo de cartuchos com ponteira de mira;
 * - bomba de polímero que desliza para trás a cada disparo.
 */
export class DoomShotgunViewmodel {
  readonly viewScene = new THREE.Scene();
  readonly viewCamera: THREE.PerspectiveCamera;

  private readonly rootGroup = new THREE.Group();
  private readonly animGroup = new THREE.Group();
  private readonly pumpGroup = new THREE.Group();
  private readonly muzzleFlash: THREE.Mesh;
  private readonly muzzleFlashMaterial: THREE.MeshBasicMaterial;
  private readonly ejectShell: THREE.Mesh;
  /** Luva esquerda na bomba e a lanterna de apoio presa sob o cano. */
  private leftHandGroup: THREE.Group | null = null;
  private mountedFlashlightGroup: THREE.Group | null = null;
  private mountedLensMaterial: THREE.MeshBasicMaterial | null = null;
  private mountedLightOn = false;
  private mountedLightDim = false;

  private equipped = false;
  private equipProgress = 0;
  private fireTimer = 0;
  private pumpTimer = 0;
  private recoil = 0;
  private recoilPitch = 0;
  private swayX = 0;
  private swayY = 0;
  private handSign: 1 | -1 = 1;


  constructor(aspect: number) {
    this.viewCamera = new THREE.PerspectiveCamera(
      computeAdaptiveVerticalFov(aspect, 58, 80),
      aspect,
      0.02,
      6.0
    );

    // Iluminação do viewmodel: o corredor é quase preto, então a arma carrega a
    // própria luz para não virar silhueta. Ambiente alto (o metal escuro
    // continua metálico), luz-chave dura vindo de cima à esquerda para marcar as
    // quinas do receptor e contraluz frio que separa o cano da parede.
    const ambient = new THREE.AmbientLight(0xb9c6d4, 0.85);
    const keyLight = new THREE.DirectionalLight(0xfff0d0, 1.75);
    keyLight.position.set(-0.85, 1.6, 0.95);
    const fillLight = new THREE.DirectionalLight(0xa9c2da, 0.95);
    fillLight.position.set(0.9, -0.15, 1.2);
    const rimLight = new THREE.DirectionalLight(0x9fb4cc, 0.8);
    rimLight.position.set(0.7, -0.5, -0.9);
    this.viewScene.add(ambient, keyLight, fillLight, rimLight);

    const steelMat = new THREE.MeshLambertMaterial({
      color: 0x68737f,
      flatShading: true,
    });
    const darkSteelMat = new THREE.MeshLambertMaterial({
      color: 0x454c56,
      flatShading: true,
    });
    const woodMat = new THREE.MeshLambertMaterial({
      color: 0x6e4a2c,
      flatShading: true,
    });
    const woodDarkMat = new THREE.MeshLambertMaterial({
      color: 0x4e3019,
      flatShading: true,
    });
    const polymerMat = new THREE.MeshLambertMaterial({
      color: 0x33383f,
      flatShading: true,
    });
    const brassMat = new THREE.MeshLambertMaterial({
      color: 0xc19a52,
      flatShading: true,
    });
    const brassDarkMat = new THREE.MeshLambertMaterial({
      color: 0x8e6f36,
      flatShading: true,
    });
    const steelDarkMat = new THREE.MeshLambertMaterial({
      color: 0x59626d,
      flatShading: true,
    });
    const rubberMat = new THREE.MeshLambertMaterial({
      color: 0x24272b,
      flatShading: true,
    });
    const rubberDarkMat = new THREE.MeshLambertMaterial({
      color: 0x14171a,
      flatShading: true,
    });
    const labelMat = new THREE.MeshLambertMaterial({ map: createShotgunLabelTexture() });
    const gun = new THREE.Group();

    // ---- Helpers de modelagem -------------------------------------------
    /** Extruda um perfil lateral (avanço no eixo Z × altura Y) na largura X. */
    const extrudeProfile = (
      profile: ReadonlyArray<readonly [number, number]>,
      width: number,
      bevel: number
    ): THREE.ExtrudeGeometry => {
      const shape = new THREE.Shape();
      shape.moveTo(profile[0][0], profile[0][1]);
      for (let i = 1; i < profile.length; i++) shape.lineTo(profile[i][0], profile[i][1]);
      shape.closePath();
      const depth = Math.max(0.002, width - bevel * 2);
      const geometry = new THREE.ExtrudeGeometry(shape, {
        depth,
        bevelEnabled: bevel > 0,
        bevelThickness: bevel,
        bevelSize: bevel,
        bevelSegments: 2,
        curveSegments: 3,
        steps: 1,
      });
      geometry.translate(0, 0, -depth / 2);
      geometry.rotateY(-Math.PI / 2);
      geometry.computeVertexNormals();
      return geometry;
    };

    /** Corpo de revolução em torno do eixo do cano (perfil raio × Z). */
    const latheZ = (
      profile: ReadonlyArray<readonly [number, number]>,
      segments = 18
    ): THREE.LatheGeometry => {
      const points = profile.map(([radius, z]) => new THREE.Vector2(radius, z));
      const geometry = new THREE.LatheGeometry(points, segments);
      geometry.rotateX(Math.PI / 2);
      geometry.computeVertexNormals();
      return geometry;
    };

    const add = (
      geometry: THREE.BufferGeometry,
      material: THREE.Material,
      position: [number, number, number],
      rotation: [number, number, number] = [0, 0, 0],
      parent: THREE.Object3D = gun
    ): THREE.Mesh => {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(...position);
      mesh.rotation.set(...rotation);
      parent.add(mesh);
      return mesh;
    };

    /** Cápsula esticada entre dois pontos — dedos, tendões, antebraço. */
    const capsuleBetween = (
      parent: THREE.Object3D,
      from: THREE.Vector3,
      to: THREE.Vector3,
      radius: number,
      material: THREE.Material
    ): THREE.Mesh => {
      const dir = new THREE.Vector3().subVectors(to, from);
      const length = Math.max(0.001, dir.length());
      const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(radius, length, 4, 10), material);
      mesh.position.copy(from).addScaledVector(dir, 0.5);
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
      parent.add(mesh);
      return mesh;
    };

    // ---- 1. CORONHA DE NOGUEIRA ------------------------------------------
    // Perfil real de coronha americana: dorso subindo até o coice, punho
    // estreito (onde a mão direita fecha) e a barriga rebaixada na frente.
    const stockProfile: ReadonlyArray<readonly [number, number]> = [
      [0.062, 0.030],
      [0.112, 0.034],
      [0.150, 0.024],
      [0.196, 0.040],
      [0.268, 0.046],
      [0.330, 0.048],
      [0.352, 0.042],
      [0.360, 0.008],
      [0.352, -0.082],
      [0.330, -0.090],
      [0.262, -0.070],
      [0.196, -0.052],
      [0.152, -0.046],
      [0.128, -0.088],
      [0.104, -0.100],
      [0.078, -0.086],
      [0.070, -0.056],
      [0.062, -0.026],
    ];
    // Na 1ª pessoa a coronha fica atrás da câmera (não é visível e só ocuparia
    // a tela); ela é marcada para sumir do viewmodel e reaparece no modelo de
    // 3ª pessoa usado pelos outros jogadores.
    const stockBody = add(extrudeProfile(stockProfile, 0.05, 0.005), woodMat, [0, 0, 0]);
    stockBody.name = 'ShotgunStockMesh';
    // Coice de borracha com frisos.
    add(extrudeProfile([
      [0.352, 0.044],
      [0.372, 0.038],
      [0.376, -0.076],
      [0.354, -0.086],
    ], 0.052, 0.004), rubberMat, [0, 0, 0]).name = 'ShotgunStockMesh';
    for (let i = 0; i < 3; i++) {
      add(new THREE.BoxGeometry(0.052, 0.004, 0.005), rubberDarkMat, [0, 0.026 - i * 0.03, 0.362 + i * 0.002]);
    }
    // Joelho do punho e cunha de reforço no encontro com o receptor.
    add(extrudeProfile([
      [0.058, 0.030],
      [0.078, 0.030],
      [0.070, -0.062],
      [0.058, -0.024],
    ], 0.044, 0.003), woodDarkMat, [0, 0, 0]).name = 'ShotgunStockMesh';
    // Textura de checagem do punho (faixas finas atravessando a madeira).
    for (let i = 0; i < 7; i++) {
      add(new THREE.BoxGeometry(0.0504, 0.0022, 0.0042), woodDarkMat, [0, -0.030 - i * 0.008, 0.096 + i * 0.0035]);
    }
    // Olhal e argola de bandoleira.
    add(new THREE.TorusGeometry(0.008, 0.0022, 5, 10), brassMat, [0, -0.096, 0.300], [0, Math.PI / 2, 0]);

    // ---- 2. RECEPTOR DE AÇO ----------------------------------------------
    const receiverProfile: ReadonlyArray<readonly [number, number]> = [
      [-0.104, 0.026],
      [-0.020, 0.030],
      [0.040, 0.030],
      [0.064, 0.022],
      [0.064, -0.022],
      [0.040, -0.032],
      [-0.030, -0.032],
      [-0.076, -0.028],
      [-0.104, -0.020],
    ];
    add(extrudeProfile(receiverProfile, 0.046, 0.004), steelMat, [0, 0, 0]);
    // Tampa do ferrolho com frisos de aderência.
    add(new THREE.BoxGeometry(0.048, 0.008, 0.05), darkSteelMat, [0, 0.030, 0.010]);
    for (let i = 0; i < 5; i++) {
      add(new THREE.BoxGeometry(0.050, 0.0022, 0.0035), steelMat, [0, 0.036, -0.006 + i * 0.009]);
    }
    // Porta de ejeção (lado direito, o que a câmera vê).
    add(extrudeProfile([
      [0.028, 0.016],
      [0.046, 0.012],
      [0.046, -0.012],
      [0.028, -0.016],
    ], 0.004, 0.001), darkSteelMat, [0.023, 0, 0]);
    // Plaqueta de série e parafusos.
    add(new THREE.PlaneGeometry(0.034, 0.014), labelMat, [0.0234, -0.004, -0.072], [0, Math.PI / 2, 0]);
    for (const sz of [-0.086, 0.040]) {
      add(new THREE.CylinderGeometry(0.0032, 0.0032, 0.0042, 8), steelDarkMat, [0.0234, 0.014, sz], [0, 0, Math.PI / 2]);
    }
    // Botão de trava do ferrolho e trava de segurança no guarda-mato.
    add(new THREE.CylinderGeometry(0.0042, 0.0042, 0.006, 10), steelDarkMat, [0.026, -0.018, 0.030], [0, 0, Math.PI / 2]);
    add(new THREE.BoxGeometry(0.0034, 0.007, 0.016), darkSteelMat, [0.0245, -0.002, 0.006]);
    // Porta de alimentação e elevador de cartucho, embaixo do receptor.
    add(new THREE.BoxGeometry(0.028, 0.012, 0.058), darkSteelMat, [0, -0.036, -0.014]);
    add(new THREE.BoxGeometry(0.020, 0.004, 0.046), steelDarkMat, [0, -0.043, -0.014]);

    // ---- 3. GUARDA-MATO E GATILHO ----------------------------------------
    add(new THREE.TorusGeometry(0.026, 0.0062, 6, 14, Math.PI * 1.15), darkSteelMat,
      [0, -0.056, -0.004], [Math.PI / 2, 0, Math.PI * 0.12]);
    add(new THREE.BoxGeometry(0.0075, 0.024, 0.009), steelDarkMat, [0, -0.052, 0.004], [0.28, 0, 0]);
    add(new THREE.BoxGeometry(0.0022, 0.018, 0.016), darkSteelMat, [0.0205, -0.048, 0.030]);

    // ---- 4. CANO COM TRILHO DE MIRA --------------------------------------
    const BARREL_Y = 0.026;
    const BARREL_END = -0.622;
    add(latheZ([
      [0.0150, -0.090],
      [0.0176, -0.104],
      [0.0170, -0.300],
      [0.0164, -0.560],
      [0.0182, -0.596],
      [0.0182, BARREL_END],
      [0.0110, BARREL_END - 0.002],
      [0.0110, BARREL_END - 0.012],
      [0.0000, BARREL_END - 0.012],
    ], 20), steelMat, [0, BARREL_Y, 0]);
    // Trilho ventilado sobre o cano (perfilada de caça).
    add(new THREE.BoxGeometry(0.008, 0.007, 0.40), darkSteelMat, [0, BARREL_Y + 0.019, -0.300]);
    for (let i = 0; i < 9; i++) {
      add(new THREE.BoxGeometry(0.0035, 0.006, 0.012), steelMat, [0, BARREL_Y + 0.018, -0.130 - i * 0.043]);
    }
    // Massa de mira de latão na boca do cano.
    add(new THREE.SphereGeometry(0.0042, 10, 8), brassMat, [0, BARREL_Y + 0.024, BARREL_END + 0.010]);

    // ---- 5. TUBO DE CARTUCHOS, CINTA E TAMPA -----------------------------
    add(latheZ([
      [0.0000, 0.010],
      [0.0120, 0.004],
      [0.0132, -0.010],
      [0.0128, -0.470],
      [0.0148, -0.486],
      [0.0148, -0.500],
      [0.0000, -0.500],
    ], 16), darkSteelMat, [0, -0.008, 0]);
    add(new THREE.CylinderGeometry(0.016, 0.016, 0.016, 14), brassMat, [0, -0.008, -0.494], [Math.PI / 2, 0, 0]);
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2;
      add(new THREE.BoxGeometry(0.0016, 0.0016, 0.014), brassDarkMat,
        [Math.cos(angle) * 0.0155, -0.008 + Math.sin(angle) * 0.0155, -0.494]);
    }
    // Cinta que une cano e tubo, com parafuso.
    add(new THREE.BoxGeometry(0.036, 0.048, 0.014), darkSteelMat, [0, 0.008, -0.470]);
    add(new THREE.CylinderGeometry(0.0034, 0.0034, 0.04, 8), steelDarkMat, [0, 0.008, -0.470], [0, 0, Math.PI / 2]);
    add(new THREE.BoxGeometry(0.022, 0.016, 0.02), darkSteelMat, [0, -0.030, -0.470]);

    // ---- 6. BOMBA (GUARDA-MÃO) — desliza para trás a cada disparo --------
    this.pumpGroup.position.set(0, -0.008, -0.250);
    const pumpProfile: Array<readonly [number, number]> = [
      [0.0150, -0.084],
      [0.0248, -0.080],
      [0.0272, -0.070],
    ];
    for (let i = 0; i < 5; i++) {
      const z = -0.058 + i * 0.024;
      pumpProfile.push([0.0272, z]);
      pumpProfile.push([0.0238, z + 0.007]);
      pumpProfile.push([0.0252, z + 0.012]);
    }
    pumpProfile.push([0.0268, 0.062]);
    pumpProfile.push([0.0250, 0.076]);
    pumpProfile.push([0.0150, 0.082]);
    const pumpMesh = new THREE.Mesh(latheZ(pumpProfile, 18), polymerMat);
    this.pumpGroup.add(pumpMesh);
    // Tampa traseira da bomba com cintas metálicas.
    add(new THREE.TorusGeometry(0.0274, 0.0028, 5, 16), darkSteelMat, [0, 0, 0.086], [0, 0, 0], this.pumpGroup);
    add(new THREE.TorusGeometry(0.0274, 0.0028, 5, 16), darkSteelMat, [0, 0, -0.088], [0, 0, 0], this.pumpGroup);
    gun.add(this.pumpGroup);

    // ---- 7. LANTERNA DE APOIO ACOPLADA SOB O CANO ------------------------
    // Presa por duas braçadeiras no tubo de cartuchos, à frente da bomba: é o
    // apoio da arma e a fonte de luz enquanto a shotgun está nas duas mãos.
    const mountedFlashlight = new THREE.Group();
    mountedFlashlight.name = 'ShotgunMountedFlashlight';
    mountedFlashlight.position.set(0, -0.038, -0.512);
    gun.add(mountedFlashlight);
    const flashBodyMat = new THREE.MeshLambertMaterial({ color: 0x9aa4ad, flatShading: true });
    const flashDarkMat = new THREE.MeshLambertMaterial({ color: 0x22262c, flatShading: true });
    const flashLensMat = new THREE.MeshBasicMaterial({ color: 0x1a1e24 });
    // Corpo cilíndrico com anéis de aderência.
    add(latheZ([
      [0.0000, 0.036],
      [0.0118, 0.032],
      [0.0132, 0.018],
      [0.0126, -0.052],
      [0.0148, -0.062],
      [0.0000, -0.064],
    ], 16), flashBodyMat, [0, 0, 0], [0, 0, 0], mountedFlashlight);
    for (let i = 0; i < 3; i++) {
      add(new THREE.TorusGeometry(0.0134, 0.0018, 5, 14), flashDarkMat, [0, 0, 0.010 - i * 0.016], [0, 0, 0], mountedFlashlight);
    }
    // Cabeça, refletor e lente.
    add(latheZ([
      [0.0130, -0.058],
      [0.0206, -0.070],
      [0.0218, -0.086],
      [0.0206, -0.090],
      [0.0000, -0.090],
    ], 18), flashDarkMat, [0, 0, 0], [0, 0, 0], mountedFlashlight);
    const flashLens = add(new THREE.CircleGeometry(0.0186, 20), flashLensMat, [0, 0, -0.0902], [0, Math.PI, 0], mountedFlashlight);
    flashLens.name = 'ShotgunMountedLens';
    // Braçadeiras no tubo de cartuchos.
    for (const zOff of [0.020, -0.030]) {
      add(new THREE.TorusGeometry(0.0205, 0.0032, 5, 14, Math.PI * 1.4), flashDarkMat,
        [0, 0.006, zOff], [Math.PI / 2, 0, Math.PI * 0.30], mountedFlashlight);
      add(new THREE.BoxGeometry(0.007, 0.012, 0.009), darkSteelMat, [0, 0.028, zOff], [0, 0, 0], mountedFlashlight);
    }
    // Botão de pressão traseiro e cabo que corre até o receptor.
    add(new THREE.CylinderGeometry(0.0055, 0.0055, 0.008, 10), darkSteelMat, [0, 0, 0.040], [Math.PI / 2, 0, 0], mountedFlashlight);
    for (let i = 0; i < 6; i++) {
      const t = i / 5;
      add(new THREE.TorusGeometry(0.0034, 0.0016, 4, 8), darkSteelMat,
        [0.014 + t * 0.006, 0.030 - t * 0.002, 0.052 + i * 0.038], [0, 0, 0], mountedFlashlight);
    }

    this.mountedLensMaterial = flashLensMat;
    this.mountedFlashlightGroup = mountedFlashlight;

    // ---- 8. AS DUAS MÃOS NA ARMA -----------------------------------------
    // Luvas pressurizadas do traje no mesmo vocabulário do taser: palma em
    // cápsula achatada, dorso almofadado com os nós dos dedos, quatro dedos
    // enrolados por baixo do tubo e o polegar cruzando por cima. O punho e o
    // mangote saem na diagonal do canto inferior da tela.
    const gloveMat = new THREE.MeshLambertMaterial({ color: 0x8b929a, flatShading: true });
    const glovePadMat = new THREE.MeshLambertMaterial({ color: 0x5b636b, flatShading: true });
    const gloveSeamMat = new THREE.MeshLambertMaterial({ color: 0x2b3036 });
    const sleeveMat = new THREE.MeshLambertMaterial({ color: 0x5a6459, flatShading: true });
    const cuffMat = new THREE.MeshLambertMaterial({ color: 0x9aa4ab, flatShading: true });

    /**
     * Luva fechada em volta de um tubo da arma (eixo Z). O referencial da luva
     * é local: +X é o lado de fora (onde fica o dorso da mão), -X é o lado do
     * corpo, e o tubo atravessa o grupo em Z.
     */
    const buildGripGlove = (
      parent: THREE.Object3D,
      options: {
        name: string;
        position: [number, number, number];
        gripRadius: number;
        handScale: number;
        sleeveDir: THREE.Vector3;
        sleeveLength: number;
      }
    ): THREE.Group => {
      const glove = new THREE.Group();
      glove.name = options.name;
      glove.position.set(...options.position);
      // Espelhada em X: a câmera olha o lado esquerdo do cano, então a palma e
      // os dedos só ficam visíveis desse lado.
      glove.scale.x = -1;
      parent.add(glove);

      const R = options.gripRadius;
      const s = options.handScale;
      const fingerR = 0.0098 * s;

      // Palma: cápsula achatada encostada na lateral do tubo, com o dorso
      // almofadado por fora. É o volume que dá a leitura de "mão".
      const palm = new THREE.Mesh(new THREE.CapsuleGeometry(0.031 * s, 0.074 * s, 4, 12), gloveMat);
      palm.position.set(R * 0.98, -0.004 * s, 0.002);
      palm.rotation.set(0.02, 0, 0.06);
      palm.scale.set(0.60, 1.0, 0.88);
      glove.add(palm);
      const backPad = new THREE.Mesh(new THREE.CapsuleGeometry(0.020 * s, 0.058 * s, 4, 10), glovePadMat);
      backPad.position.set(R * 1.22, 0.004, 0.0);
      backPad.scale.set(0.40, 1.0, 0.86);
      glove.add(backPad);
      // Nós dos dedos no dorso: quatro bossas alinhadas em Z.
      for (let f = 0; f < 4; f++) {
        const knuckle = new THREE.Mesh(new THREE.SphereGeometry(fingerR * 1.12, 10, 8), glovePadMat);
        knuckle.position.set(R * 1.28, 0.002, 0.036 * s - f * 0.024 * s);
        knuckle.scale.set(0.58, 0.9, 1);
        glove.add(knuckle);
      }

      // Dedos: contornam o tubo por baixo, em três falanges, e voltam para o
      // lado de dentro — é esse arco que faz a mão "agarrar" em vez de flutuar.
      const fingerZ = [0.034, 0.011, -0.012, -0.035];
      const fingerLen = [1.0, 1.04, 0.98, 0.88];
      for (let f = 0; f < 4; f++) {
        const z = fingerZ[f] * s;
        const r = fingerR * fingerLen[f];
        const points = [
          new THREE.Vector3(R * 1.06, -R * 0.52, z + 0.002),
          new THREE.Vector3(R * 0.80, -R * 1.14, z),
          new THREE.Vector3(R * 0.04, -R * 1.38, z - 0.002),
          new THREE.Vector3(R * -0.74, -R * 1.12, z - 0.004),
          new THREE.Vector3(R * -1.0, -R * 0.62, z - 0.006),
        ];
        for (let i = 0; i < points.length - 1; i++) {
          capsuleBetween(glove, points[i], points[i + 1], r * (1 - i * 0.05), gloveMat);
          if (i > 0) {
            const joint = new THREE.Mesh(
              new THREE.TorusGeometry(r * 0.98 * (1 - i * 0.05), 0.0015 * s, 4, 10),
              gloveSeamMat
            );
            joint.position.copy(points[i]);
            joint.rotation.set(0, Math.PI / 2, 0);
            glove.add(joint);
          }
        }
      }

      // Polegar cruzando por cima do tubo, apontando para a frente.
      const thumbBase = new THREE.Vector3(R * 1.16, R * 0.5, -0.040 * s);
      const thumbMid = new THREE.Vector3(R * 0.42, R * 1.06, -0.066 * s);
      const thumbTip = new THREE.Vector3(-R * 0.5, R * 0.98, -0.076 * s);
      capsuleBetween(glove, thumbBase, thumbMid, fingerR * 1.3, gloveMat);
      capsuleBetween(glove, thumbMid, thumbTip, fingerR * 1.06, gloveMat);
      const thumbJoint = new THREE.Mesh(new THREE.SphereGeometry(fingerR * 1.24, 10, 8), glovePadMat);
      thumbJoint.position.copy(thumbMid);
      glove.add(thumbJoint);

      // Punho abaixo do polegar, anel de vedação e mangote do traje.
      const cuffDir = options.sleeveDir.clone().normalize();
      const wristStart = new THREE.Vector3(R * 0.85, -0.050 * s, 0.044 * s);
      const wristEnd = wristStart.clone().addScaledVector(cuffDir, 0.050 * s);
      capsuleBetween(glove, wristStart, wristEnd, 0.0225 * s, gloveMat);
      const cuffRing = new THREE.Mesh(new THREE.TorusGeometry(0.0238 * s, 0.0038 * s, 6, 16), cuffMat);
      cuffRing.position.copy(wristEnd);
      cuffRing.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), cuffDir);
      glove.add(cuffRing);
      const sleeveStart = wristEnd.clone().addScaledVector(cuffDir, 0.006 * s);
      const sleeveEnd = sleeveStart.clone().addScaledVector(cuffDir, options.sleeveLength);
      capsuleBetween(glove, sleeveStart, sleeveEnd, 0.0238 * s, sleeveMat);
      for (let i = 0; i < 2; i++) {
        const band = new THREE.Mesh(new THREE.TorusGeometry(0.0247 * s, 0.003 * s, 5, 14), glovePadMat);
        band.position.copy(sleeveStart).addScaledVector(cuffDir, 0.030 + i * 0.034);
        band.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), cuffDir);
        glove.add(band);
      }
      return glove;
    };

    // Mão direita no punho (atrás do gatilho) e mão esquerda na bomba. Ambas
    // ficam no lado +X, que é o lado da arma que a câmera enxerga.
    buildGripGlove(gun, {
      name: 'ShotgunHandRight',
      position: [0, -0.030, 0.106],
      gripRadius: 0.028,
      handScale: 0.94,
      sleeveDir: new THREE.Vector3(0.62, -0.74, 0.26),
      sleeveLength: 0.17,
    });
    this.leftHandGroup = buildGripGlove(this.pumpGroup, {
      name: 'ShotgunHandLeft',
      position: [0, 0, 0],
      gripRadius: 0.0278,
      handScale: 1.0,
      sleeveDir: new THREE.Vector3(0.58, -0.78, 0.22),
      sleeveLength: 0.18,
    });


    // ---- Clarão de boca + estojo ejetado ----------------------------------
    this.muzzleFlashMaterial = new THREE.MeshBasicMaterial({
      color: 0xffd27a,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.muzzleFlash = new THREE.Mesh(
      new THREE.ConeGeometry(0.075, 0.19, 8),
      this.muzzleFlashMaterial
    );
    this.muzzleFlash.name = 'ShotgunMuzzleFlash';
    this.muzzleFlash.rotation.x = -Math.PI * 0.5;
    this.muzzleFlash.position.set(0, 0.026, -0.60);
    gun.add(this.muzzleFlash);

    this.ejectShell = new THREE.Mesh(
      new THREE.CylinderGeometry(0.0095, 0.0095, 0.05, 8),
      brassMat
    );
    this.ejectShell.name = 'ShotgunEjectShell';
    this.ejectShell.visible = false;
    gun.add(this.ejectShell);

    // Posicionamento em 1ª pessoa: arma na diagonal inferior direita
    // A arma desce e converge para o centro da mira, com o cano mais visível.
    // Recorta a parte que fica atrás da câmera: coronha, coice, punho de
    // madeira e a mão que o segura não aparecem em 1ª pessoa.
    gun.traverse((node) => {
      if (node.name === 'ShotgunStockMesh') node.visible = false;
    });

    this.animGroup.name = 'ShotgunAnimGroup';
    this.animGroup.position.set(0.010, 0.030, -0.30);
    this.animGroup.rotation.set(0.05, 0.34, -0.04);
    this.animGroup.scale.setScalar(1.0);
    this.animGroup.add(gun);
    this.rootGroup.add(this.animGroup);
    this.rootGroup.name = 'ShotgunViewmodelRoot';
    this.rootGroup.position.set(0.155, -0.085, 0.02);
    this.rootGroup.visible = false;
    this.viewScene.add(this.rootGroup);
  }

  createThirdPersonWeapon(): THREE.Object3D {
    const gun = this.animGroup.children[0].clone(true);
    for (const name of ['ShotgunMuzzleFlash', 'ShotgunEjectShell']) {
      const effect = gun.getObjectByName(name);
      if (effect) effect.visible = false;
    }
    // Em 3ª pessoa a arma é vista de fora: a coronha e a mão do gatilho voltam.
    gun.traverse((node) => {
      if (node.name === 'ShotgunStockMesh' || node.name === 'ShotgunHandRight') {
        node.visible = true;
      }
    });
    gun.position.set(0, 0.085, -0.085);
    return gun;
  }

  setAspect(aspect: number): void {
    this.viewCamera.aspect = aspect;
    this.viewCamera.fov = computeAdaptiveVerticalFov(aspect, 58, 80);
    this.viewCamera.updateProjectionMatrix();
  }

  setHandedness(hand: 'right' | 'left'): void {
    this.handSign = hand === 'left' ? -1 : 1;
  }

  get isEquipped(): boolean {
    return this.equipped;
  }

  get isVisibleInView(): boolean {
    return this.rootGroup.visible;
  }

  /** Verdadeiro enquanto o cano está recuando (a arma "trabalhou"). */
  get isFiring(): boolean {
    return this.fireTimer > 0 || this.pumpTimer > 0;
  }

  equip(): void {
    this.equipped = true;
  }

  stow(): void {
    this.equipped = false;
  }

  /** Dispara: recuo instantâneo + clarão + bombeamento da bomba. */
  fire(): void {
    this.fireTimer = 0.09;
    this.pumpTimer = 0.62;
    this.recoil = 1;
    this.recoilPitch = 1;
    this.muzzleFlashMaterial.opacity = 0.95;
    this.muzzleFlash.rotation.z = Math.random() * Math.PI;
    this.ejectShell.visible = true;
    this.ejectShell.position.set(0.040, 0.016, 0.012);
    this.ejectShell.rotation.set(Math.random() * 3, Math.random() * 3, 0);
  }

  /** Posição do cano (boca do tiro) no espaço da viewCamera — para o clarão 3D. */
  getMuzzleWorldPosition(out: THREE.Vector3): THREE.Vector3 {
    this.muzzleFlash.getWorldPosition(out);
    return out;
  }

  update(dt: number, bobPhase: number, planarSpeed: number, slideAmount = 0): void {
    const step = Math.min(0.05, Math.max(0.0005, dt));
    const target = this.equipped ? 1 : 0;
    this.equipProgress +=
      (target - this.equipProgress) * (1 - Math.exp(-13 * step));
    this.rootGroup.visible = this.equipProgress > 0.02;
    if (!this.rootGroup.visible) return;

    this.fireTimer = Math.max(0, this.fireTimer - step);
    this.pumpTimer = Math.max(0, this.pumpTimer - step);
    this.recoil = Math.max(0, this.recoil - step * 6.2);
    this.recoilPitch = Math.max(0, this.recoilPitch - step * 5.4);

    // Arma Guardada -> Baixo (fora da tela) quando não está equipada
    const lowered = 1 - this.equipProgress;
    const slide = THREE.MathUtils.clamp(slideAmount, 0, 1);
    const bobAmount = Math.min(1, planarSpeed / 5.2) * (1 - slide);
    const bobX = Math.sin(bobPhase) * 0.011 * bobAmount;
    const bobY = Math.abs(Math.cos(bobPhase)) * 0.009 * bobAmount;

    this.rootGroup.position.set(
      (0.150 - slide * 0.025) * this.handSign + bobX,
      -0.135 - lowered * 0.42 + bobY - slide * 0.03,
      0.02 + this.recoil * 0.075
    );
    this.rootGroup.rotation.set(
      this.recoilPitch * 0.16 + slide * 0.06,
      -this.handSign * this.swayX * 0.5,
      lowered * 0.5 - this.recoilPitch * 0.05 - slide * 0.16 * this.handSign
    );

    // Bombeamento: a bomba recua e volta (0.62s no total)
    const pumpPhase = this.pumpTimer > 0 ? 1 - this.pumpTimer / 0.62 : 1;
    let pumpOffset = 0;
    if (this.pumpTimer > 0) {
      const p = Math.min(1, pumpPhase * 2.1);
      pumpOffset = p < 0.42 ? -(p / 0.42) * 0.085 : -0.085 * (1 - (p - 0.42) / 0.58);
    }
    this.pumpGroup.position.z = -0.25 + pumpOffset;

    // Clarão de boca + estojo ejetado
    this.muzzleFlashMaterial.opacity = Math.max(
      0,
      this.muzzleFlashMaterial.opacity - step * 12
    );
    if (this.ejectShell.visible) {
      this.ejectShell.position.x += step * 0.42;
      this.ejectShell.position.y -= step * 0.5;
      this.ejectShell.rotation.z += step * 9;
      if (this.ejectShell.position.y < -0.24) this.ejectShell.visible = false;
    }

    // Lanterna de apoio acoplada: acende junto com o feixe e pisca com a bateria.
    if (this.mountedLensMaterial) {
      this.mountedLensMaterial.color.setHex(
        this.mountedLightOn ? (this.mountedLightDim ? 0xb9a06a : 0xfff3c8) : 0x1a1e24
      );
    }
    // A mão esquerda acompanha a bomba e aperta junto no recuo.
    if (this.leftHandGroup) {
      this.leftHandGroup.position.y = this.recoil * 0.006;
      this.leftHandGroup.rotation.x = this.recoil * 0.06;
    }
    if (this.mountedFlashlightGroup) {
      this.mountedFlashlightGroup.rotation.x = this.recoil * 0.03;
    }

    this.swayX *= 1 - Math.min(1, step * 6);
    this.swayY *= 1 - Math.min(1, step * 6);
  }

  /**
   * Estado da lanterna de apoio presa sob o cano: acompanha o feixe principal
   * (e a bateria) sem precisar de uma lanterna empunhada.
   */
  setMountedFlashlight(on: boolean, dim = false): void {
    this.mountedLightOn = on;
    this.mountedLightDim = dim;
  }

  /** Inércia da arma ao virar a câmera. */
  addLookImpulse(dYaw: number, dPitch: number): void {
    this.swayX = Math.max(-1, Math.min(1, this.swayX + dYaw * 1.6));
    this.swayY = Math.max(-1, Math.min(1, this.swayY + dPitch * 1.6));
  }

  dispose(): void {
    this.rootGroup.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      object.geometry.dispose();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) material.dispose();
    });
    this.rootGroup.removeFromParent();
  }
}
