import * as THREE from 'three';
import { computeAdaptiveVerticalFov } from './DoomTouchControls';

/**
 * ============================================================================
 * SHOTGUN DE COMBATE — MONTAGEM POR PEÇAS + MUNIÇÃO + VIEWMODEL 3D
 * ============================================================================
 * A arma NÃO aparece pronta no mapa: o corpo, o cano, a bomba (guarda-mão) e a
 * coronha ficam ESPALHADOS em caixotes diferentes do complexo. Só depois de
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

/** Lista das peças que ainda faltam (para o feedback do HUD). */
export function getMissingShotgunParts(
  hasItem: (itemId: string) => boolean
): ShotgunPartId[] {
  return SHOTGUN_PART_IDS.filter((id) => !hasItem(id));
}

/** Rótulo curto do estado de montagem ("2/4 PEÇAS"). */
export function formatShotgunAssemblyProgress(
  hasItem: (itemId: string) => boolean
): string {
  const found = countShotgunPartsOwned(hasItem);
  return `${found}/${SHOTGUN_PART_IDS.length} PEÇAS`;
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

    const ambient = new THREE.AmbientLight(0x8c93a2, 0.52);
    const keyLight = new THREE.DirectionalLight(0xfff2da, 0.92);
    keyLight.position.set(-0.6, 1.15, 0.9);
    const rimLight = new THREE.DirectionalLight(0x64728a, 0.42);
    rimLight.position.set(0.8, -0.4, 0.3);
    this.viewScene.add(ambient, keyLight, rimLight);

    const steelMat = new THREE.MeshLambertMaterial({
      color: 0x545c68,
      flatShading: true,
    });
    const darkSteelMat = new THREE.MeshLambertMaterial({
      color: 0x2b3038,
      flatShading: true,
    });
    const woodMat = new THREE.MeshLambertMaterial({
      color: 0x6b4324,
      flatShading: true,
    });
    const woodDarkMat = new THREE.MeshLambertMaterial({
      color: 0x4a2c17,
      flatShading: true,
    });
    const polymerMat = new THREE.MeshLambertMaterial({
      color: 0x1f2229,
      flatShading: true,
    });
    const brassMat = new THREE.MeshLambertMaterial({
      color: 0xc19a52,
      flatShading: true,
    });
    const gloveMat = new THREE.MeshLambertMaterial({
      color: 0x15181d,
      flatShading: true,
    });

    const gun = new THREE.Group();

    // ---- Coronha de madeira (traseira, abaixo do receiver) ----------------
    const stockBody = new THREE.Mesh(
      new THREE.BoxGeometry(0.062, 0.078, 0.24),
      woodMat
    );
    stockBody.position.set(0, -0.052, 0.196);
    stockBody.rotation.x = -0.13;
    gun.add(stockBody);

    const stockButt = new THREE.Mesh(
      new THREE.BoxGeometry(0.064, 0.11, 0.022),
      woodDarkMat
    );
    stockButt.position.set(0, -0.066, 0.312);
    stockButt.rotation.x = -0.13;
    gun.add(stockButt);

    const grip = new THREE.Mesh(
      new THREE.BoxGeometry(0.05, 0.115, 0.062),
      woodDarkMat
    );
    grip.position.set(0, -0.086, 0.086);
    grip.rotation.x = 0.34;
    gun.add(grip);

    // ---- Receptor de aço --------------------------------------------------
    const receiver = new THREE.Mesh(
      new THREE.BoxGeometry(0.058, 0.072, 0.2),
      steelMat
    );
    receiver.position.set(0, -0.004, 0.05);
    gun.add(receiver);

    const ejectionPort = new THREE.Mesh(
      new THREE.BoxGeometry(0.012, 0.036, 0.062),
      darkSteelMat
    );
    ejectionPort.position.set(0.031, 0.012, 0.03);
    gun.add(ejectionPort);

    const triggerGuard = new THREE.Mesh(
      new THREE.TorusGeometry(0.028, 0.006, 6, 12, Math.PI * 1.25),
      darkSteelMat
    );
    triggerGuard.rotation.set(Math.PI / 2, 0, Math.PI * 0.15);
    triggerGuard.position.set(0, -0.052, 0.028);
    gun.add(triggerGuard);

    const trigger = new THREE.Mesh(
      new THREE.BoxGeometry(0.009, 0.026, 0.008),
      darkSteelMat
    );
    trigger.position.set(0, -0.044, 0.03);
    trigger.rotation.x = 0.2;
    gun.add(trigger);

    // ---- Cano + tubo de cartuchos ----------------------------------------
    const barrel = new THREE.Mesh(
      new THREE.CylinderGeometry(0.0165, 0.0175, 0.52, 12),
      steelMat
    );
    barrel.rotation.x = Math.PI * 0.5;
    barrel.position.set(0, 0.024, -0.2);
    gun.add(barrel);

    const bead = new THREE.Mesh(
      new THREE.SphereGeometry(0.0055, 8, 6),
      brassMat
    );
    bead.position.set(0, 0.042, -0.452);
    gun.add(bead);

    const magTube = new THREE.Mesh(
      new THREE.CylinderGeometry(0.0125, 0.0125, 0.36, 10),
      darkSteelMat
    );
    magTube.rotation.x = Math.PI * 0.5;
    magTube.position.set(0, -0.016, -0.16);
    gun.add(magTube);

    const magCap = new THREE.Mesh(
      new THREE.CylinderGeometry(0.014, 0.014, 0.02, 10),
      brassMat
    );
    magCap.rotation.x = Math.PI * 0.5;
    magCap.position.set(0, -0.016, -0.345);
    gun.add(magCap);

    // ---- Bomba (pombo) de polímero — desliza para trás ao disparar -------
    this.pumpGroup.position.set(0, -0.004, -0.15);
    const pumpBody = new THREE.Mesh(
      new THREE.CylinderGeometry(0.0245, 0.0245, 0.13, 10),
      polymerMat
    );
    pumpBody.rotation.x = Math.PI * 0.5;
    this.pumpGroup.add(pumpBody);
    for (let i = 0; i < 4; i++) {
      const groove = new THREE.Mesh(
        new THREE.TorusGeometry(0.0252, 0.0026, 5, 10),
        darkSteelMat
      );
      groove.rotation.x = 0;
      groove.position.set(0, 0, -0.042 + i * 0.028);
      this.pumpGroup.add(groove);
    }
    gun.add(this.pumpGroup);

    // ---- Mãos com luvas químicas -----------------------------------------
    const rightGlove = new THREE.Mesh(
      new THREE.BoxGeometry(0.062, 0.086, 0.088),
      gloveMat
    );
    rightGlove.position.set(0.006, -0.112, 0.086);
    rightGlove.rotation.x = 0.3;
    gun.add(rightGlove);

    const leftGlove = new THREE.Mesh(
      new THREE.BoxGeometry(0.058, 0.078, 0.082),
      gloveMat
    );
    leftGlove.position.set(-0.006, -0.052, -0.148);
    gun.add(leftGlove);

    const leftForearm = new THREE.Mesh(
      new THREE.CylinderGeometry(0.044, 0.052, 0.19, 10),
      gloveMat
    );
    leftForearm.rotation.x = Math.PI * 0.5;
    leftForearm.position.set(-0.02, -0.086, -0.048);
    gun.add(leftForearm);

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
    this.muzzleFlash.rotation.x = -Math.PI * 0.5;
    this.muzzleFlash.position.set(0, 0.024, -0.55);
    gun.add(this.muzzleFlash);

    this.ejectShell = new THREE.Mesh(
      new THREE.CylinderGeometry(0.0095, 0.0095, 0.05, 8),
      brassMat
    );
    this.ejectShell.visible = false;
    gun.add(this.ejectShell);

    // Posicionamento em 1ª pessoa: arma na diagonal inferior direita
    this.animGroup.position.set(0.02, -0.055, -0.12);
    this.animGroup.rotation.set(0.04, 0.1, 0.02);
    this.animGroup.add(gun);
    this.rootGroup.add(this.animGroup);
    this.rootGroup.position.set(0.17, -0.13, -0.02);
    this.rootGroup.visible = false;
    this.viewScene.add(this.rootGroup);
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
    this.ejectShell.position.set(0.045, 0.02, 0.02);
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
      (0.17 - slide * 0.025) * this.handSign + bobX,
      -0.13 - lowered * 0.42 + bobY - slide * 0.035,
      -0.02 + this.recoil * 0.075
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
    this.pumpGroup.position.z = -0.15 + pumpOffset;

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

    this.swayX *= 1 - Math.min(1, step * 6);
    this.swayY *= 1 - Math.min(1, step * 6);
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
