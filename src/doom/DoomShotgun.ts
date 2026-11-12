import * as THREE from 'three';
import { createAstronautMaterials } from './DoomAstronaut';
import { computeAdaptiveVerticalFov } from './DoomTouchControls';
import type { WebStrugglePose } from './DoomWebStruggle';
import {
  buildShotgunGlove,
  buildShotgunModel,
  createMeshAdder,
  latheZ,
  SHOTGUN_METRICS,
  type ShotgunGloveMaterials,
  type ShotgunMaterialSet,
} from './DoomShotgunModel';

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

/* ==========================================================================
   VIEWMODEL 3D DA SHOTGUN EM 1ª PESSOA
   ========================================================================== */

/** Enquadramento de 1ª pessoa: onde a arma e as mãos devem cair na tela. */
const FIRST_PERSON_FIT = {
  /**
   * Direção do cano (do punho até a boca) no espaço da câmera. O cano mergulha
   * ~8° para baixo: é o que tira a boca do meio da tela e faz a arma ler como
   * um peso apoiado no ombro, não como uma barra atravessando a mira.
   */
  aim: new THREE.Vector3(-0.16, -0.1427, -0.978),
  /** Onde a mão direita (punho da coronha) deve ficar, em metros. */
  gripPoint: new THREE.Vector3(0.13, -0.1406, -0.32),
  /** Rolagem da arma em torno do próprio eixo (rad). */
  roll: -0.05,
} as const;

/**
 * Modelo em 1ª pessoa da shotgun de pump.
 *
 * A geometria vem de `buildShotgunModel` (a mesma das peças do mundo e da
 * arma em 3ª pessoa); aqui ela só recebe luz própria, as duas mãos enluvadas
 * e a animação de empunhadura. O enquadramento é resolvido a partir de onde
 * a mão direita deve cair na tela — nunca de um chute de posição/rotação.
 */
export class DoomShotgunViewmodel {
  readonly viewScene = new THREE.Scene();
  readonly viewCamera: THREE.PerspectiveCamera;

  private readonly rootGroup = new THREE.Group();
  private readonly gunGroup = new THREE.Group();
  private readonly pumpGroup = new THREE.Group();
  private readonly muzzleFlash: THREE.Mesh;
  private readonly muzzleFlashMaterial: THREE.MeshBasicMaterial;
  private readonly ejectShell: THREE.Mesh;
  private readonly materials: ShotgunMaterialSet;
  /** Luva esquerda na bomba e a lanterna de apoio presa sob o cano. */
  private leftHandGroup: THREE.Group | null = null;
  private mountedFlashlightGroup: THREE.Group | null = null;
  private mountedLensMaterial: THREE.MeshBasicMaterial | null = null;
  private mountedLightOn = false;
  private mountedLightDim = false;

  /** Pose base (sem balanço nem recuo) calculada para o lado dominante. */
  private readonly basePosition = new THREE.Vector3();
  private readonly baseQuaternion = new THREE.Quaternion();

  private equipped = false;
  private equipProgress = 0;
  private fireTimer = 0;
  private pumpTimer = 0;
  private recoil = 0;
  private recoilPitch = 0;
  private swayX = 0;
  private swayY = 0;
  private handSign: 1 | -1 = 1;
  /** Pose da luta contra a teia (null = solto). */
  private webStruggle: WebStrugglePose | null = null;

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

    const lambert = (color: number): THREE.MeshLambertMaterial =>
      new THREE.MeshLambertMaterial({ color, flatShading: true });
    this.materials = {
      steel: lambert(0x6b7480),
      steelBright: lambert(0x9aa4b0),
      steelDark: lambert(0x3f454d),
      polymer: lambert(0x2e3339),
      polymerDark: lambert(0x20242a),
      wood: lambert(0x6b4a2d),
      woodDark: lambert(0x472d17),
      rubber: lambert(0x1b1d20),
      brass: lambert(0xc19a52),
      cavity: lambert(0x0d0f12),
    };

    // A coronha aparece em 1ª pessoa também: o punho cai no canto inferior
    // direito da tela (é ali que a mão direita fecha) e o coice sai de quadro,
    // como numa escopeta real apoiada no ombro. Escondê-la deixava só cano e
    // receptor na tela — a arma parecia um fuzil sem a peça de trás.
    const model = buildShotgunModel(this.materials);
    this.gunGroup = model.root;
    this.pumpGroup = model.pump;
    this.gunGroup.name = 'ShotgunGun';

    // Estojo ejetado: sai pela porta de ejeção, no lado direito do receptor.
    this.ejectShell = new THREE.Mesh(
      new THREE.CylinderGeometry(0.0095, 0.0095, 0.05, 10),
      this.materials.brass
    );
    this.ejectShell.name = 'ShotgunEjectShell';
    this.ejectShell.visible = false;
    this.gunGroup.add(this.ejectShell);

    this.buildMountedFlashlight(this.gunGroup);

    // ---- Clarão de boca ----------------------------------------------------
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
    model.muzzleAnchor.add(this.muzzleFlash);

    // ---- As duas mãos na arma ----------------------------------------------
    // As mãos em 1ª pessoa são as luvas do próprio Traje Biológico Nível-A:
    // borracha preta, anel carmim de vedação e mangote chartreuse. Nenhuma cor
    // própria — os materiais vêm do traje, então a mão na tela é a mesma peça
    // que o jogador vê no braço do aliado em 3ª pessoa.
    const astroMats = createAstronautMaterials();
    const gloveMats: ShotgunGloveMaterials = {
      glove: astroMats.bootRubber,
      cuff: astroMats.anodizedCrimson,
      sleeve: astroMats.astroCamo,
    };
    // Mão direita no punho da coronha. O punho não é redondo: tem 0,040 m de
    // largura por ~0,056 m de altura na seção perpendicular ao eixo, então a
    // luva fecha numa elipse com essas duas meias-medidas. Fechando num
    // círculo, os dedos afundavam 8 mm na madeira embaixo e ficavam soltos nas
    // laterais — a mão parecia atravessar o punho.
    model.gripAnchor.add(
      buildShotgunGlove(gloveMats, {
        side: 'right',
        radius: 0.0195,
        radiusY: 0.0295,
        // O punho é um retângulo de quinas arredondadas, não um tubo: com
        // expoente 8 os dedos correm ao longo das faces em vez de cruzar as
        // quinas.
        wrapExponent: 8,
        scale: 0.98,
        sleeveDirection: new THREE.Vector3(0.34, -0.9, 0.26),
        sleeveLength: 0.05,
      })
    );
    // Mão esquerda no guarda-mão — viaja com a bomba. O guarda-mão é um oval
    // de 0,023 × 0,028 m (mais alto que largo): a luva fecha nesse mesmo oval,
    // em vez de num círculo de raio médio que deixava os dedos cravados embaixo
    // e folgados nas laterais.
    this.leftHandGroup = buildShotgunGlove(gloveMats, {
      side: 'left',
      radius: 0.027,
      radiusY: 0.0235,
      scale: 1,
      sleeveDirection: new THREE.Vector3(0.4, -0.88, 0.26),
      sleeveLength: 0.2,
    });
    model.pumpAnchor.add(this.leftHandGroup);

    // ---- Enquadramento -----------------------------------------------------
    this.applyFit();
    this.rootGroup.name = 'ShotgunViewmodelRoot';
    this.rootGroup.add(this.gunGroup);
    this.rootGroup.visible = false;
    this.viewScene.add(this.rootGroup);
  }

  /**
   * Resolve a posição/orientação da arma a partir do ponto onde a mão direita
   * deve cair na tela. Assim a luva fica exatamente em volta do punho — a mão
   * obedece à modelagem, e não o contrário.
   */
  private applyFit(): void {
    const M = SHOTGUN_METRICS;
    const forward = FIRST_PERSON_FIT.aim.clone().normalize();
    const zAxis = forward.clone().negate(); // +Z da arma aponta para o atirador
    const xAxis = new THREE.Vector3()
      .crossVectors(new THREE.Vector3(0, 1, 0), zAxis)
      .normalize();
    const yAxis = new THREE.Vector3().crossVectors(zAxis, xAxis).normalize();
    // Rolagem: gira a arma em torno do próprio eixo do cano.
    const roll = new THREE.Quaternion().setFromAxisAngle(zAxis, FIRST_PERSON_FIT.roll);
    xAxis.applyQuaternion(roll);
    yAxis.applyQuaternion(roll);

    const basis = new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis);
    if (this.handSign < 0) {
      const mirror = new THREE.Matrix4().makeScale(-1, 1, 1);
      basis.premultiply(mirror).multiply(mirror);
    }
    this.baseQuaternion.setFromRotationMatrix(basis);
    // A arma entra na cena pela âncora do punho: o ponto da mão comanda.
    const gripLocal = new THREE.Vector3(0, M.gripAnchor.y, M.gripAnchor.z);
    const gripWorld = gripLocal.clone().applyQuaternion(this.baseQuaternion);
    this.basePosition.copy(FIRST_PERSON_FIT.gripPoint).sub(gripWorld);
    if (this.handSign < 0) this.basePosition.x *= -1;
    this.rootGroup.position.copy(this.basePosition);
    this.rootGroup.quaternion.copy(this.baseQuaternion);
  }

  /** Lanterna de apoio: braçadeira no tubo de cartuchos, à frente da bomba. */
  private buildMountedFlashlight(parent: THREE.Object3D): void {
    const add = createMeshAdder(parent);
    const M = SHOTGUN_METRICS;
    const light = new THREE.Group();
    light.name = 'ShotgunMountedFlashlight';
    // Presa sob o tubo de cartuchos, logo à frente do guarda-mão.
    light.position.set(0, M.magazineY - M.magazineRadius - 0.013, -0.34);
    parent.add(light);

    const bodyMat = this.materials.steelBright;
    const darkMat = this.materials.steelDark;
    const lensMat = new THREE.MeshBasicMaterial({ color: 0x1a1e24 });
    // Corpo cilíndrico com anéis de aderência e cabeça alargada.
    add(latheZ([
      [0.0, 0.05],
      [0.0124, 0.046],
      [0.0132, 0.03],
      [0.0126, -0.03],
      [0.0, -0.034],
    ], 16), bodyMat, [0, 0, 0]);
    for (let i = 0; i < 3; i++) {
      add(new THREE.TorusGeometry(0.0134, 0.0016, 5, 14), darkMat, [0, 0, 0.014 - i * 0.016]);
    }
    add(latheZ([
      [0.0130, -0.03],
      [0.0204, -0.044],
      [0.0216, -0.062],
      [0.0204, -0.068],
      [0.0, -0.068],
    ], 18), darkMat, [0, 0, 0]);
    const lens = add(new THREE.CircleGeometry(0.0186, 20), lensMat, [0, 0, -0.0682], [0, Math.PI, 0]);
    lens.name = 'ShotgunMountedLens';
    // Braçadeira abraçando o tubo de cartuchos + botão traseiro.
    add(new THREE.TorusGeometry(0.0128, 0.0032, 6, 16, Math.PI * 1.45), darkMat,
      [0, M.magazineRadius + 0.012, 0.006], [Math.PI / 2, 0, Math.PI * 0.28]);
    add(new THREE.BoxGeometry(0.006, 0.012, 0.008), darkMat, [0, M.magazineRadius + 0.008, 0.006]);
    add(new THREE.CylinderGeometry(0.0055, 0.0055, 0.008, 10), darkMat, [0, -0.013, 0.052], [Math.PI / 2, 0, 0]);

    this.mountedLensMaterial = lensMat;
    this.mountedFlashlightGroup = light;
    // Guarda a referência do adder para não vazar: o grupo já está na cena.
    void add;
  }

  /**
   * Arma de 3ª pessoa (a que os outros jogadores veem nas mãos do aliado):
   * a mesma modelagem, agora com a coronha, sem as luvas do viewmodel — as
   * mãos do traje do aliado é que a seguram, pelas âncoras.
   */
  createThirdPersonWeapon(): THREE.Object3D {
    const model = buildShotgunModel(this.materials);
    model.root.name = 'ShotgunThirdPerson';
    // Menor e mais simples: vista de longe, o detalhe miúdo vira ruído.
    model.root.scale.setScalar(0.92);
    return model.root;
  }

  setAspect(aspect: number): void {
    this.viewCamera.aspect = aspect;
    this.viewCamera.fov = computeAdaptiveVerticalFov(aspect, 58, 80);
    this.viewCamera.updateProjectionMatrix();
  }

  setHandedness(hand: 'right' | 'left'): void {
    const next: 1 | -1 = hand === 'left' ? -1 : 1;
    if (next === this.handSign) return;
    this.handSign = next;
    if (this.rootGroup.parent) this.applyFit();
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

  /** Âncora da mão direita no espaço do viewmodel (testes e depuração). */
  getGripAnchor(): THREE.Object3D | null {
    return this.gunGroup.getObjectByName('WeaponGripAnchor') ?? null;
  }

  /** Âncora da mão esquerda (guarda-mão) no espaço do viewmodel. */
  getPumpAnchor(): THREE.Object3D | null {
    return this.pumpGroup.getObjectByName('WeaponSupportAnchor') ?? null;
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
    this.ejectShell.position.set(0.03, 0.004, 0.11);
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
    this.equipProgress += (target - this.equipProgress) * (1 - Math.exp(-13 * step));
    this.rootGroup.visible = this.equipProgress > 0.02;
    if (!this.rootGroup.visible) return;

    this.fireTimer = Math.max(0, this.fireTimer - step);
    this.pumpTimer = Math.max(0, this.pumpTimer - step);
    this.recoil = Math.max(0, this.recoil - step * 6.2);
    this.recoilPitch = Math.max(0, this.recoilPitch - step * 5.4);

    // Arma guardada -> baixo (fora da tela) quando não está equipada.
    const lowered = 1 - this.equipProgress;
    const slide = THREE.MathUtils.clamp(slideAmount, 0, 1);
    const bobAmount = Math.min(1, planarSpeed / 5.2) * (1 - slide);
    const bobX = Math.sin(bobPhase) * 0.011 * bobAmount;
    const bobY = Math.abs(Math.cos(bobPhase)) * 0.009 * bobAmount;

    // Tudo parte da pose base resolvida em `applyFit`: o balanço, o recuo e o
    // deslize são deslocamentos em cima dela, nunca uma pose nova.
    this.rootGroup.position.copy(this.basePosition);
    this.rootGroup.position.x += this.handSign * (-slide * 0.02) + bobX;
    this.rootGroup.position.y += -lowered * 0.42 + bobY - slide * 0.03;
    this.rootGroup.position.z += this.recoil * 0.06;
    this.rootGroup.quaternion.copy(this.baseQuaternion);
    this.rootGroup.rotateX(this.recoilPitch * 0.16 + slide * 0.06 + lowered * 0.35);
    this.rootGroup.rotateY(-this.handSign * this.swayX * 0.5);
    this.rootGroup.rotateZ((-this.recoilPitch * 0.05 - slide * 0.16 + lowered * 0.4) * this.handSign);

    this.applyWebStruggle();

    // Bombeamento: a bomba recua e volta (0.62s no total).
    const pumpPhase = this.pumpTimer > 0 ? 1 - this.pumpTimer / 0.62 : 1;
    let pumpOffset = 0;
    if (this.pumpTimer > 0) {
      const p = Math.min(1, pumpPhase * 2.1);
      pumpOffset = p < 0.42 ? -(p / 0.42) * SHOTGUN_METRICS.pumpTravel : -SHOTGUN_METRICS.pumpTravel * (1 - (p - 0.42) / 0.58);
    }
    this.pumpGroup.position.z = SHOTGUN_METRICS.foreEndCenterZ + pumpOffset;

    // Clarão de boca + estojo ejetado.
    this.muzzleFlashMaterial.opacity = Math.max(
      0,
      this.muzzleFlashMaterial.opacity - step * 12
    );
    if (this.ejectShell.visible) {
      this.ejectShell.position.x += step * 0.42;
      this.ejectShell.position.y += step * 0.26;
      this.ejectShell.position.z -= step * 0.12;
      this.ejectShell.rotation.z += step * 9;
      if (this.ejectShell.position.y > 0.26) this.ejectShell.visible = false;
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
   * Braços presos pela seda: a escopeta pesa para baixo e para dentro, e cada
   * arranco do operador levanta a arma antes do contragolpe.
   */
  setWebStruggle(pose: WebStrugglePose | null): void {
    this.webStruggle = pose && pose.bound01 > 0.001 ? pose : null;
  }

  private applyWebStruggle(): void {
    const pose = this.webStruggle;
    if (!pose) return;
    const b = pose.bound01;
    const yank = pose.yank * b;
    const strain = Math.max(0, Math.min(1, pose.strain01)) * b;
    const breath = pose.breath * b;
    const tremor = pose.tremor * b;
    this.rootGroup.position.x += (-0.05 * this.handSign + tremor * 0.004) * b;
    this.rootGroup.position.y +=
      (-0.065 - strain * 0.02 + Math.max(0, yank) * 0.04 + breath * 0.004) * b;
    this.rootGroup.position.z += (0.05 - yank * 0.02) * b;
    this.rootGroup.rotateX((0.18 + strain * 0.07 - yank * 0.12) * b);
    this.rootGroup.rotateZ((-0.14 - strain * 0.05 + tremor * 0.05) * this.handSign * b);
  }

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
