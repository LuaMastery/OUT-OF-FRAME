import * as THREE from 'three';
import { computeAdaptiveVerticalFov } from './DoomTouchControls';

export const TASER_ITEM_ID = 'field_taser';
/** Effective range to the spider's surface, in metres. */
export const TASER_RANGE = 8;
/** A discharge immobilises the spider without hurting it or interrupting a capture. */
export const TASER_STUN_SECONDS = 5;
/** The integrated cell automatically recharges; a missed discharge also consumes a charge. */
export const TASER_RECHARGE_SECONDS = 9;

/** Recharge follows simulation time, so pausing a solo game also pauses the cell. */
export function advanceTaserRecharge(remaining: number, dt: number): number {
  if (!Number.isFinite(remaining) || remaining <= 0) return 0;
  return Math.max(0, remaining - (Number.isFinite(dt) ? Math.max(0, dt) : 0));
}

/** Short-range line of sight test against the same physical colliders as the shotgun. */
export function taserImpactDistance(
  origin: THREE.Vector3,
  direction: THREE.Vector3,
  target: THREE.Vector3,
  obstacles: readonly THREE.Box3[]
): number | null {
  if (!Number.isFinite(direction.lengthSq()) || direction.lengthSq() < 0.0001) return null;
  const ray = new THREE.Ray(origin, direction.clone().normalize());
  const hit = ray.intersectSphere(new THREE.Sphere(target, 1.05), new THREE.Vector3());
  if (!hit) return null;
  const distance = origin.distanceTo(hit);
  if (distance > TASER_RANGE) return null;
  for (const box of obstacles) {
    const obstruction = ray.intersectBox(box, new THREE.Vector3());
    if (obstruction && origin.distanceTo(obstruction) < distance - 0.02) return null;
  }
  return distance;
}

/** Paleta física do equipamento (mesma família de materiais do resto do jogo). */
const TASER_COLORS = {
  shellYellow: 0xd8a526,
  shellDark: 0x3a3418,
  rubber: 0x1b1f22,
  metal: 0x9aa7ae,
  metalDark: 0x5d686e,
  brass: 0xc9a24a,
  glass: 0x2a4a52,
  led: 0x7cf0ff,
  glove: 0x2a2e30,
  strap: 0x3d3327,
} as const;

/** Segmentos de arco elétrico gerados em torno do eixo dos eletrodos. */
export function buildTaserArcSegments(
  from: THREE.Vector3,
  to: THREE.Vector3,
  seed = 1
): THREE.Vector3[] {
  const points: THREE.Vector3[] = [from.clone()];
  const segments = 7;
  let s = seed;
  const rand = (): number => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
  const dir = new THREE.Vector3().subVectors(to, from);
  for (let i = 1; i < segments; i++) {
    const t = i / segments;
    const jitter = 0.022 * Math.sin(t * Math.PI);
    points.push(
      new THREE.Vector3(
        from.x + dir.x * t + (rand() - 0.5) * jitter * 2,
        from.y + dir.y * t + (rand() - 0.5) * jitter * 2 + Math.sin(t * Math.PI) * 0.012,
        from.z + dir.z * t + (rand() - 0.5) * jitter * 2
      )
    );
  }
  points.push(to.clone());
  return points;
}

/**
 * Pistola de contenção (taser) em primeira e terceira pessoa.
 *
 * Modelagem em peças com silhueta real de equipamento de contenção: corpo
 * injetado em duas metades, empunhadura emborrachada com textura de aderência,
 * guarda-mato, gatilho real, janela de carga translúcida, botão de segurança
 * âmbar, trilho superior com mira e dois eletrodos com espaçador cerâmico.
 * Os eletrodos são a fonte do arco elétrico e da luz que ilumina o ambiente
 * quando a arma dispara.
 */
export class DoomTaserViewmodel {
  readonly viewScene = new THREE.Scene();
  readonly viewCamera: THREE.PerspectiveCamera;
  private readonly root = new THREE.Group();
  /** Grupo oscilante das partes internas (recuo, tremores e abertura). */
  private readonly armsGroup = new THREE.Group();
  private readonly arc: THREE.Line;
  private readonly arcGlow: THREE.Line;
  private readonly muzzleLight: THREE.PointLight;
  private readonly ledBulb: THREE.Mesh;
  private readonly ledLight: THREE.PointLight;
  private readonly trigger: THREE.Group;
  private readonly handsGroup = new THREE.Group();
  private equipped = false;
  private progress = 0;
  private flashTime = 0;
  private chargeTime = 0;
  private recoilTime = 0;
  private arcSeed = 1;
  private handSign: 1 | -1 = 1;
  private readonly arcPoints: THREE.Vector3[] = [];

  constructor(aspect: number) {
    this.viewCamera = new THREE.PerspectiveCamera(
      computeAdaptiveVerticalFov(aspect, 62, 84),
      aspect,
      0.02,
      5
    );
    this.viewScene.add(new THREE.AmbientLight(0x9fb6c8, 0.72));
    const key = new THREE.DirectionalLight(0xffe9cc, 1.15);
    key.position.set(-1.1, 1.8, 1.2);
    this.viewScene.add(key);
    const fill = new THREE.DirectionalLight(0x8fb8d8, 0.45);
    fill.position.set(1.4, 0.3, -0.9);
    this.viewScene.add(fill);

    const shell = new THREE.MeshLambertMaterial({ color: TASER_COLORS.shellYellow, flatShading: true });
    const shellDark = new THREE.MeshLambertMaterial({ color: TASER_COLORS.shellDark, flatShading: true });
    const rubber = new THREE.MeshLambertMaterial({ color: TASER_COLORS.rubber, flatShading: true });
    const metal = new THREE.MeshLambertMaterial({ color: TASER_COLORS.metal, flatShading: true });
    const metalDark = new THREE.MeshLambertMaterial({ color: TASER_COLORS.metalDark, flatShading: true });
    const brass = new THREE.MeshLambertMaterial({ color: TASER_COLORS.brass, flatShading: true });
    const glass = new THREE.MeshLambertMaterial({
      color: TASER_COLORS.glass,
      emissive: 0x0d3a44,
      transparent: true,
      opacity: 0.72,
      flatShading: true,
    });
    const glove = new THREE.MeshLambertMaterial({ color: TASER_COLORS.glove, flatShading: true });
    const strap = new THREE.MeshLambertMaterial({ color: TASER_COLORS.strap, flatShading: true });

    this.armsGroup.name = 'TaserBody';
    this.root.add(this.armsGroup);

    const add = (
      geometry: THREE.BufferGeometry,
      material: THREE.Material,
      position: [number, number, number],
      rotation: [number, number, number] = [0, 0, 0],
      parent: THREE.Object3D = this.armsGroup
    ): THREE.Mesh => {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(...position);
      mesh.rotation.set(...rotation);
      parent.add(mesh);
      return mesh;
    };

    // ---------------------------------------------------------------- CASCO
    // Corpo principal em duas metades (superior amarela, inferior escura),
    // levemente afunilado para a frente como um equipamento de contenção.
    const upperShell = add(
      new THREE.BoxGeometry(0.098, 0.062, 0.28),
      shell,
      [0, 0.012, -0.115]
    );
    upperShell.scale.set(1, 1, 1);
    add(new THREE.BoxGeometry(0.104, 0.028, 0.235), shellDark, [0, -0.028, -0.112]);
    // Nervuras laterais que dão leitura de plástico injetado.
    add(new THREE.BoxGeometry(0.012, 0.05, 0.2), shellDark, [-0.052, 0.005, -0.118]);
    add(new THREE.BoxGeometry(0.012, 0.05, 0.2), shellDark, [0.052, 0.005, -0.118]);
    // Frente cônica que abriga os eletrodos.
    add(new THREE.CylinderGeometry(0.052, 0.038, 0.07, 10), shellDark, [0, 0.008, -0.262], [Math.PI / 2, 0, 0]);
    add(new THREE.CylinderGeometry(0.04, 0.034, 0.03, 10), metalDark, [0, 0.008, -0.298], [Math.PI / 2, 0, 0]);

    // Trilho superior com mira e marcações de segurança.
    add(new THREE.BoxGeometry(0.03, 0.012, 0.17), metalDark, [0, 0.05, -0.13]);
    for (let i = 0; i < 4; i++) {
      add(new THREE.BoxGeometry(0.036, 0.006, 0.008), metal, [0, 0.058, -0.075 - i * 0.032]);
    }
    add(new THREE.BoxGeometry(0.016, 0.016, 0.012), metal, [0, 0.062, -0.205]);
    // Faixa de advertência âmbar/preto na lateral.
    add(new THREE.BoxGeometry(0.004, 0.018, 0.088), strap, [-0.05, -0.012, -0.16]);
    add(new THREE.BoxGeometry(0.004, 0.018, 0.088), strap, [0.05, -0.012, -0.16]);

    // ------------------------------------------------------------ EMPUNHADURA
    const grip = new THREE.Group();
    grip.position.set(0, -0.088, -0.012);
    grip.rotation.x = -0.26;
    this.armsGroup.add(grip);
    add(new THREE.BoxGeometry(0.062, 0.155, 0.075), rubber, [0, -0.045, 0], [0, 0, 0], grip);
    // Textura de aderência: anéis emborrachados.
    for (let i = 0; i < 5; i++) {
      add(
        new THREE.BoxGeometry(0.066, 0.009, 0.079),
        shellDark,
        [0, 0.01 - i * 0.026, 0],
        [0, 0, 0],
        grip
      );
    }
    // Base da bateria removível.
    add(new THREE.BoxGeometry(0.058, 0.028, 0.062), metalDark, [0, -0.132, 0.006], [0, 0, 0], grip);
    add(new THREE.CylinderGeometry(0.008, 0.008, 0.006, 8), brass, [0, -0.148, 0.006], [0, 0, 0], grip);

    // Guarda-mato + gatilho real que se move ao disparar.
    add(new THREE.TorusGeometry(0.033, 0.005, 6, 12, Math.PI), metalDark, [0, -0.062, -0.072], [Math.PI / 2, 0, 0]);
    this.trigger = new THREE.Group();
    this.trigger.position.set(0, -0.058, -0.068);
    this.armsGroup.add(this.trigger);
    add(new THREE.BoxGeometry(0.011, 0.032, 0.014), metal, [0, -0.014, 0.004], [0.3, 0, 0], this.trigger);

    // --------------------------------------------------------------- CONTROLES
    // Botão de segurança âmbar (sob o polegar) + botão de disparo no topo.
    add(new THREE.CylinderGeometry(0.009, 0.009, 0.008, 8), strap, [-0.042, 0.026, -0.032], [Math.PI / 2, 0, 0]);
    const fireSwitch = add(
      new THREE.CylinderGeometry(0.011, 0.011, 0.01, 10),
      metal,
      [0, 0.042, -0.048],
      [0, 0, 0]
    );
    fireSwitch.name = 'TaserFireSwitch';

    // Janela de carga com célula visível e LED indicador.
    add(new THREE.BoxGeometry(0.05, 0.026, 0.004), metalDark, [0, 0.012, -0.006]);
    add(new THREE.BoxGeometry(0.042, 0.018, 0.003), glass, [0, 0.012, -0.008]);
    add(new THREE.CylinderGeometry(0.007, 0.007, 0.02, 8), brass, [-0.012, 0.012, -0.008], [Math.PI / 2, 0, 0]);
    add(new THREE.CylinderGeometry(0.007, 0.007, 0.02, 8), brass, [0.012, 0.012, -0.008], [Math.PI / 2, 0, 0]);
    this.ledBulb = add(
      new THREE.SphereGeometry(0.0032, 8, 6),
      new THREE.MeshBasicMaterial({ color: TASER_COLORS.led }),
      [0.038, 0.034, -0.02]
    );
    this.ledBulb.name = 'TaserChargeLed';
    this.ledLight = new THREE.PointLight(TASER_COLORS.led, 0, 0.22);
    this.ledLight.position.set(0.038, 0.034, -0.02);
    this.armsGroup.add(this.ledLight);

    // ---------------------------------------------------------------- ELETRODOS
    const electrodeHousing = new THREE.Group();
    electrodeHousing.position.set(0, 0.008, -0.318);
    this.armsGroup.add(electrodeHousing);
    for (const side of [-1, 1]) {
      // Ilhós cerâmico + haste metálica + ponta de contato.
      add(
        new THREE.CylinderGeometry(0.014, 0.017, 0.022, 8),
        shellDark,
        [side * 0.03, 0, 0],
        [Math.PI / 2, 0, 0],
        electrodeHousing
      );
      add(
        new THREE.CylinderGeometry(0.0055, 0.0045, 0.062, 8),
        metal,
        [side * 0.03, 0, -0.042],
        [Math.PI / 2, 0, 0],
        electrodeHousing
      );
      add(
        new THREE.SphereGeometry(0.0062, 8, 6),
        brass,
        [side * 0.03, 0, -0.074],
        [0, 0, 0],
        electrodeHousing
      );
    }
    // Espaçador isolante entre as hastes.
    add(new THREE.BoxGeometry(0.06, 0.01, 0.012), rubber, [0, 0, -0.03], [0, 0, 0], electrodeHousing);

    // ------------------------------------------------------------- ARCO ELÉTRICO
    // Dois traços (núcleo branco-azulado + halo) redesenhados a cada disparo.
    this.arcPoints.push(
      new THREE.Vector3(-0.03, 0.008, -0.392),
      new THREE.Vector3(0, 0.02, -0.404),
      new THREE.Vector3(0.03, 0.008, -0.392)
    );
    const arcGeometry = new THREE.BufferGeometry().setFromPoints(this.arcPoints);
    this.arc = new THREE.Line(
      arcGeometry,
      new THREE.LineBasicMaterial({ color: 0xeafcff, transparent: true, opacity: 1 })
    );
    this.arc.name = 'TaserArcCore';
    this.arc.frustumCulled = false;
    this.arc.visible = false;
    this.armsGroup.add(this.arc);

    const glowGeometry = new THREE.BufferGeometry().setFromPoints(this.arcPoints);
    this.arcGlow = new THREE.Line(
      glowGeometry,
      new THREE.LineBasicMaterial({ color: 0x7ce8ff, transparent: true, opacity: 0.55 })
    );
    this.arcGlow.name = 'TaserArcGlow';
    this.arcGlow.frustumCulled = false;
    this.arcGlow.visible = false;
    this.armsGroup.add(this.arcGlow);

    // Luz real do arco: ilumina a arma e a mão no quadro do disparo.
    this.muzzleLight = new THREE.PointLight(0x9fe8ff, 0, 0.85);
    this.muzzleLight.position.set(0, 0.012, -0.38);
    this.armsGroup.add(this.muzzleLight);

    // ------------------------------------------------------------- MÃO / LUVA
    this.handsGroup.name = 'TaserViewmodelHand';
    this.root.add(this.handsGroup);
    // Palma fechada em volta da empunhadura.
    add(new THREE.BoxGeometry(0.075, 0.085, 0.095), glove, [0, -0.098, 0.012], [0.15, 0, 0], this.handsGroup);
    // Dedos em quatro blocos na frente da empunhadura.
    for (let i = 0; i < 4; i++) {
      add(
        new THREE.BoxGeometry(0.064, 0.016, 0.026),
        glove,
        [0, -0.06 - i * 0.018, -0.05],
        [0.28, 0, 0],
        this.handsGroup
      );
    }
    // Polegar apoiado no botão de segurança.
    add(new THREE.BoxGeometry(0.022, 0.05, 0.024), glove, [-0.05, -0.045, -0.018], [0.2, 0, 0.35], this.handsGroup);
    // Punho do traje EVA saindo do quadro.
    add(new THREE.CylinderGeometry(0.055, 0.062, 0.1, 8), glove, [0, -0.155, 0.05], [0.5, 0, 0], this.handsGroup);
    add(new THREE.BoxGeometry(0.088, 0.014, 0.03), metalDark, [0, -0.132, 0.008], [0.2, 0, 0], this.handsGroup);

    this.root.visible = false;
    this.viewScene.add(this.root);
  }

  createThirdPersonWeapon(): THREE.Object3D {
    const gun = this.root.clone(true);
    const hand = gun.getObjectByName('TaserViewmodelHand');
    hand?.removeFromParent();
    const arc = gun.getObjectByName('TaserArcCore');
    if (arc) arc.visible = false;
    const glow = gun.getObjectByName('TaserArcGlow');
    if (glow) glow.visible = false;
    gun.position.set(0, 0.11, 0);
    gun.rotation.set(0, 0, 0);
    gun.scale.set(1, 1, 1);
    gun.visible = true;
    return gun;
  }
  get isEquipped(): boolean { return this.equipped; }
  get isVisibleInView(): boolean { return this.root.visible; }
  /** Estado usado pelos testes e pela HUD (recarga e faísca). */
  get isDischarging(): boolean { return this.flashTime > 0; }
  get arcVisible(): boolean { return this.arc.visible; }
  equip(): void { this.equipped = true; }
  stow(): void { this.equipped = false; }
  /**
   * Disparo: o motor carrega (0,32 s), o gatilho desce, a arma recua e o arco
   * salta entre os eletrodos com clarões irregulares.
   */
  fire(): void {
    this.chargeTime = 0.32;
    this.flashTime = 0.36;
    this.recoilTime = 0.22;
    this.arcSeed = (this.arcSeed * 7919 + 13) % 2147483647;
    this.rewriteArcGeometry();
    this.arc.visible = true;
    this.arcGlow.visible = true;
  }
  setHandedness(hand: 'right' | 'left'): void { this.handSign = hand === 'left' ? -1 : 1; }
  setAspect(aspect: number): void {
    this.viewCamera.aspect = aspect;
    this.viewCamera.fov = computeAdaptiveVerticalFov(aspect, 62, 84);
    this.viewCamera.updateProjectionMatrix();
  }

  /** Regera o zigue-zague do arco com um novo padrão a cada faísca. */
  private rewriteArcGeometry(): void {
    const from = new THREE.Vector3(-0.03, 0.008, -0.392);
    const to = new THREE.Vector3(0.03, 0.008, -0.392);
    const points = buildTaserArcSegments(from, to, this.arcSeed || 1);
    this.arc.geometry.setFromPoints(points);
    // O halo é o mesmo traçado com folga lateral.
    const halo = points.map((p, i) =>
      i === 0 || i === points.length - 1
        ? p.clone()
        : p.clone().add(new THREE.Vector3(0, (i % 2 === 0 ? 1 : -1) * 0.008, 0))
    );
    this.arcGlow.geometry.setFromPoints(halo);
  }

  update(dt: number, bobPhase: number, speed: number, slideAmount = 0): void {
    const step = Math.min(0.05, Math.max(0, dt));
    this.progress += ((this.equipped ? 1 : 0) - this.progress) * (1 - Math.exp(-13 * step));
    this.flashTime = Math.max(0, this.flashTime - step);
    this.chargeTime = Math.max(0, this.chargeTime - step);
    this.recoilTime = Math.max(0, this.recoilTime - step);
    const discharging = this.flashTime > 0;
    this.arc.visible = discharging;
    this.arcGlow.visible = discharging;

    // Faísca viva: o arco se redesenha e o clarão pisca de forma irregular.
    if (discharging) {
      this.arcSeed = (this.arcSeed * 48271 + 7) % 2147483647;
      this.rewriteArcGeometry();
      const flicker =
        0.55 +
        0.45 * Math.abs(Math.sin(this.arcSeed % 1000)) *
          (0.6 + 0.4 * Math.sin(performance.now() * 0.05));
      this.muzzleLight.intensity = 1.6 * flicker;
      (this.arcGlow.material as THREE.LineBasicMaterial).opacity = 0.3 + 0.5 * flicker;
    } else {
      this.muzzleLight.intensity = 0;
    }
    // LED de carga pulsa enquanto recarrega e fica fixo quando a arma está pronta.
    this.ledLight.intensity = 0.05 + 0.05 * Math.sin(performance.now() * 0.004);

    this.root.visible = this.progress > 0.02;
    // Escala geral: a arma precisa caber inteira no canto sem invadir a mira.
    this.root.scale.set(0.72 * this.handSign, 0.72, 0.72);

    const slide = THREE.MathUtils.clamp(slideAmount, 0, 1);
    const bob = Math.min(1, speed / 5) * (1 - slide);
    const recoil = this.recoilTime / 0.22;
    const chargeKick = this.chargeTime > 0 ? (0.32 - this.chargeTime) / 0.32 : 1;
    // Recuo curto para trás + subida do cano, com tremor de alta frequência.
    const shake = discharging ? Math.sin(performance.now() * 0.09) * 0.004 : 0;
    this.armsGroup.position.set(
      shake * this.handSign,
      0.004 + recoil * 0.008,
      0.03 * recoil * (0.4 + chargeKick * 0.6)
    );
    this.armsGroup.rotation.set(-recoil * 0.16 - 0.02 * recoil, recoil * 0.05, recoil * 0.04 * this.handSign);
    // Gatilho desce no disparo e volta devagar.
    this.trigger.rotation.x = -Math.min(1, this.chargeTime / 0.32) * 0.5;

    // Balanço de caminhada e inclinação na escorregada.
    // Enquadramento: o corpo fica à direita e os eletrodos apontam para o
    // centro da tela, sem cortar a arma na borda inferior.
    this.root.position.set(
      (0.145 - slide * 0.018) * this.handSign + Math.sin(bobPhase) * 0.008 * bob,
      -0.115 - (1 - this.progress) * 0.36 + Math.abs(Math.cos(bobPhase)) * 0.008 * bob - slide * 0.028,
      -0.36 + recoil * 0.02
    );
    this.root.rotation.set(slide * 0.05 - recoil * 0.05, 0, -slide * 0.15 * this.handSign);
  }

  dispose(): void {
    const materials = new Set<THREE.Material>();
    this.root.traverse((object) => {
      if (object instanceof THREE.Mesh || object instanceof THREE.Line) {
        object.geometry.dispose();
        const mats = Array.isArray(object.material) ? object.material : [object.material];
        mats.forEach((material) => materials.add(material));
      }
    });
    materials.forEach((material) => material.dispose());
    this.root.removeFromParent();
  }
}
