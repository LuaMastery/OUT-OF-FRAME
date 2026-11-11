import * as THREE from 'three';
import {
  buildTaserBody,
  createTaserLambertMaterials,
  TASER_COLORS,
} from './DoomTaserModel';
import type { WebStrugglePose } from './DoomWebStruggle';
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

/** Paleta física do equipamento de contenção. */
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
 * Pistola de contenção elétrica (taser) em primeira e terceira pessoa.
 *
 * Modelagem no tamanho real de um equipamento de contenção (~28 cm): casco de
 * polímero amarelo com silhueta extrudada e chanfros de injeção, chassi interno
 * em grafite, empunhadura emborrachada com textura em relevo, guarda-mato,
 * gatilho articulado, trava de segurança, janela de carga com mostrador e LEDs,
 * baioneta dianteira com dois eletrodos de cerâmica/aço/latão e a porta de
 * descarga (blast door) entre eles.
 *
 * A arma é segurada por uma luva articulada: palma, quatro dedos em dois
 * segmentos, polegar apoiado na lateral do chassi e o punho do traje saindo do
 * quadro. Os dedos fecham junto com o gatilho no disparo.
 */
export class DoomTaserViewmodel {
  readonly viewScene = new THREE.Scene();
  readonly viewCamera: THREE.PerspectiveCamera;
  /** Enquadramento geral na tela (balanço, recuo, escorregada). */
  private readonly root = new THREE.Group();
  /** Peças da arma que se movem juntas (recuo e tremor do disparo). */
  private readonly gunGroup = new THREE.Group();
  private readonly handGroup = new THREE.Group();
  private readonly fingerJoints: THREE.Group[] = [];
  private readonly arc: THREE.Line;
  private readonly arcGlow: THREE.Line;
  private readonly muzzleLight: THREE.PointLight;
  private readonly ledBulb: THREE.Mesh;
  private readonly ledLight: THREE.PointLight;
  private readonly displayMaterial: THREE.MeshBasicMaterial;
  private readonly trigger: THREE.Group;
  private readonly safetyLever: THREE.Group;
  private equipped = false;
  private progress = 0;
  private flashTime = 0;
  private chargeTime = 0;
  private recoilTime = 0;
  private arcSeed = 1;
  private handSign: 1 | -1 = 1;
  private swayX = 0;
  private swayY = 0;
  /** Pose da luta contra a teia (null = solto). */
  private webStruggle: WebStrugglePose | null = null;
  private readonly arcPoints: THREE.Vector3[] = [];

  constructor(aspect: number) {
    this.viewCamera = new THREE.PerspectiveCamera(
      computeAdaptiveVerticalFov(aspect, 56, 76),
      aspect,
      0.02,
      5
    );

    // Iluminação de estúdio: luz-chave quente à frente/esquerda, preenchimento
    // azulado frio e um contraluz que recorta a silhueta contra o corredor.
    this.viewScene.add(new THREE.AmbientLight(0x8ea4b6, 0.62));
    const key = new THREE.DirectionalLight(0xfff0d2, 1.05);
    key.position.set(-1.05, 1.7, 1.25);
    this.viewScene.add(key);
    const fill = new THREE.DirectionalLight(0x86b3d8, 0.42);
    fill.position.set(1.5, 0.35, -0.85);
    this.viewScene.add(fill);
    const rim = new THREE.DirectionalLight(0xffd9a0, 0.5);
    rim.position.set(0.9, -0.6, 1.4);
    this.viewScene.add(rim);

    this.root.name = 'TaserViewmodelRoot';
    this.gunGroup.name = 'TaserBody';
    this.root.add(this.gunGroup);

    // Corpo do Taser: a mesma peça usada no mundo e no pickup, com os materiais
    // Lambert das cenas em 1ª pessoa.
    const body = buildTaserBody(createTaserLambertMaterials());
    this.gunGroup.add(body.group);
    this.trigger = body.trigger;
    this.safetyLever = body.safetyLever;
    this.ledBulb = body.ledBulb;
    this.displayMaterial = body.displayMaterial;
    const prongTips = body.prongTips;

    // Ponto de luz do LED de carga, no mesmo lugar da lâmpada do corpo.
    this.ledLight = new THREE.PointLight(TASER_COLORS.led, 0.06, 0.24);
    this.ledLight.position.copy(this.ledBulb.position);
    this.gunGroup.add(this.ledLight);

    // ======================================================================
    // 7. ARCO ELÉTRICO entre as pontas dos eletrodos
    // ======================================================================
    const arcFrom = prongTips[0];
    const arcTo = prongTips[1];
    this.arcPoints.push(arcFrom.clone(), arcTo.clone());
    this.arc = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(this.arcPoints),
      new THREE.LineBasicMaterial({ color: 0xf2feff, transparent: true, opacity: 1 })
    );
    this.arc.name = 'TaserArcCore';
    this.arc.frustumCulled = false;
    this.arc.visible = false;
    this.gunGroup.add(this.arc);

    this.arcGlow = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(this.arcPoints),
      new THREE.LineBasicMaterial({ color: 0x86e8ff, transparent: true, opacity: 0.55 })
    );
    this.arcGlow.name = 'TaserArcGlow';
    this.arcGlow.frustumCulled = false;
    this.arcGlow.visible = false;
    this.gunGroup.add(this.arcGlow);

    this.muzzleLight = new THREE.PointLight(0xa8ecff, 0, 0.9);
    this.muzzleLight.position.copy(arcFrom).lerp(arcTo, 0.5).add(new THREE.Vector3(0, 0.003, -0.012));
    this.gunGroup.add(this.muzzleLight);

    // ======================================================================
    // 8. MÃO — luva anatômica fechada na empunhadura
    // ======================================================================
    // Peças em cápsula (falanges, polegar, antebraço) em vez de blocos: a luva
    // lê como tecido pressurizado dobrando em volta do punho, com as articulações
    // marcadas por anéis de compressão, e o braço sai pela borda inferior direita.
    this.handGroup.name = 'TaserViewmodelHand';
    this.root.add(this.handGroup);

    const gloveMat = new THREE.MeshLambertMaterial({ color: 0x3d464f, flatShading: true });
    const glovePadMat = new THREE.MeshLambertMaterial({ color: 0x262d34, flatShading: true });
    const gloveSeamMat = new THREE.MeshLambertMaterial({ color: 0x161b20 });
    const sleeveMat = new THREE.MeshLambertMaterial({ color: 0x2f3630, flatShading: true });
    const cuffMat = new THREE.MeshLambertMaterial({ color: TASER_COLORS.steelDark });

    // Palma: cápsula achatada apoiada na lombada da empunhadura.
    const palm = new THREE.Mesh(new THREE.CapsuleGeometry(0.026, 0.05, 4, 10), gloveMat);
    palm.scale.set(0.82, 1, 1.15);
    palm.position.set(0.028, -0.106, 0.024);
    palm.rotation.set(0.22, 0.06, -0.12);
    this.handGroup.add(palm);
    // Almofada do polegar e tendão do dorso.
    const palmPad = new THREE.Mesh(new THREE.CapsuleGeometry(0.014, 0.03, 4, 8), glovePadMat);
    palmPad.scale.set(0.7, 1, 1.2);
    palmPad.position.set(0.012, -0.092, 0.004);
    palmPad.rotation.set(0.2, 0.2, 0.3);
    this.handGroup.add(palmPad);
    const knuckleGuard = new THREE.Mesh(new THREE.CapsuleGeometry(0.011, 0.038, 4, 8), glovePadMat);
    knuckleGuard.rotation.set(0.2, 0.06, Math.PI / 2 - 0.12);
    knuckleGuard.position.set(0.05, -0.104, 0.012);
    this.handGroup.add(knuckleGuard);

    // Quatro dedos em dois segmentos, fechando na frente do punho.
    const fingerRows: Array<{ y: number; len: number; thick: number }> = [
      { y: -0.073, len: 1.0, thick: 0.0135 },
      { y: -0.091, len: 1.05, thick: 0.014 },
      { y: -0.109, len: 1.0, thick: 0.0135 },
      { y: -0.126, len: 0.9, thick: 0.0125 },
    ];
    for (const row of fingerRows) {
      const knuckle = new THREE.Group();
      knuckle.position.set(0.03, row.y, -0.016);
      knuckle.rotation.set(0.04, 0.7, 0);
      this.handGroup.add(knuckle);
      this.fingerJoints.push(knuckle);

      const proximal = new THREE.Mesh(
        new THREE.CapsuleGeometry(row.thick, 0.026 * row.len, 3, 8),
        gloveMat
      );
      proximal.rotation.z = Math.PI / 2;
      proximal.position.set(-0.016 * row.len, 0, 0);
      knuckle.add(proximal);
      const joint = new THREE.Mesh(new THREE.TorusGeometry(row.thick * 1.02, 0.0016, 4, 9), gloveSeamMat);
      joint.rotation.y = Math.PI / 2;
      joint.position.set(-0.03 * row.len, 0, 0);
      knuckle.add(joint);

      const mid = new THREE.Group();
      mid.position.set(-0.031 * row.len, 0, 0);
      mid.rotation.y = -1.0;
      knuckle.add(mid);
      const distal = new THREE.Mesh(
        new THREE.CapsuleGeometry(row.thick * 0.94, 0.02 * row.len, 3, 8),
        gloveMat
      );
      distal.rotation.z = Math.PI / 2;
      distal.position.set(-0.013 * row.len, 0, 0);
      mid.add(distal);
    }

    // Polegar: falanges em cápsula, base no lado do chassi.
    const thumbBase = new THREE.Group();
    thumbBase.position.set(-0.02, -0.086, 0.006);
    thumbBase.rotation.set(0.12, 0.45, 0.62);
    this.handGroup.add(thumbBase);
    const thumbProximal = new THREE.Mesh(new THREE.CapsuleGeometry(0.0115, 0.024, 3, 8), gloveMat);
    thumbProximal.rotation.x = Math.PI / 2;
    thumbProximal.position.set(0, 0, -0.012);
    thumbBase.add(thumbProximal);
    const thumbTipPivot = new THREE.Group();
    thumbTipPivot.position.set(0, 0.001, -0.028);
    thumbTipPivot.rotation.y = -0.5;
    thumbBase.add(thumbTipPivot);
    const thumbDistal = new THREE.Mesh(new THREE.CapsuleGeometry(0.0102, 0.018, 3, 8), gloveMat);
    thumbDistal.rotation.x = Math.PI / 2;
    thumbDistal.position.set(0, 0, -0.009);
    thumbTipPivot.add(thumbDistal);

    // Punho: luva esferóide, anel de vedação e manguito pressurizado saindo
    // pela borda inferior direita, na diagonal do antebraço.
    const wrist = new THREE.Mesh(new THREE.CapsuleGeometry(0.03, 0.028, 4, 10), gloveMat);
    wrist.scale.set(0.9, 1.1, 0.95);
    wrist.position.set(0.03, -0.148, 0.05);
    wrist.rotation.set(0.5, 0.1, -0.18);
    this.handGroup.add(wrist);
    const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.031, 0.033, 0.012, 12), cuffMat);
    cuff.position.set(0.044, -0.174, 0.07);
    cuff.rotation.set(0.44, 0.2, -0.28);
    this.handGroup.add(cuff);
    const sleeve = new THREE.Mesh(new THREE.CapsuleGeometry(0.027, 0.13, 4, 12), sleeveMat);
    sleeve.position.set(0.075, -0.238, 0.1);
    sleeve.rotation.set(0.36, 0.5, -0.62);
    this.handGroup.add(sleeve);
    // Cintas de compressão da manga, para dar escala ao tecido.
    for (let i = 0; i < 2; i++) {
      const band = new THREE.Mesh(new THREE.TorusGeometry(0.0285, 0.0028, 5, 12), glovePadMat);
      band.position.set(0.075 + i * 0.014, -0.232 - i * 0.022, 0.1 + i * 0.008);
      band.rotation.set(Math.PI / 2 + 0.36, 0.5, -0.62);
      this.handGroup.add(band);
    }

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
    const led = gun.getObjectByName('TaserChargeLed');
    if (led) led.visible = false;
    gun.scale.setScalar(1.55);
    gun.position.set(0, 0.1, -0.055);
    gun.rotation.set(0.05, 0, 0);
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
   * Disparo: o motor carrega (0,32 s), o gatilho desce, a arma recua, o punho
   * aperta e o arco salta entre os eletrodos com clarões irregulares.
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
    this.viewCamera.fov = computeAdaptiveVerticalFov(aspect, 56, 76);
    this.viewCamera.updateProjectionMatrix();
  }

  /** Inércia da arma ao virar a câmera, no mesmo idioma da lanterna e da shotgun. */
  addLookImpulse(dYaw: number, dPitch: number): void {
    this.swayX = Math.max(-1, Math.min(1, this.swayX + dYaw * 1.4));
    this.swayY = Math.max(-1, Math.min(1, this.swayY + dPitch * 1.4));
  }

  /** Regera o zigue-zague do arco com um novo padrão a cada faísca. */
  private rewriteArcGeometry(): void {
    const from = this.arcPoints[0].clone();
    const to = this.arcPoints[this.arcPoints.length - 1].clone();
    const points = buildTaserArcSegments(from, to, this.arcSeed || 1);
    this.arc.geometry.dispose();
    this.arc.geometry = new THREE.BufferGeometry().setFromPoints(points);
    // O halo é o mesmo traçado com folga lateral.
    const halo = points.map((p, i) =>
      i === 0 || i === points.length - 1
        ? p.clone()
        : p.clone().add(new THREE.Vector3(0, (i % 2 === 0 ? 1 : -1) * 0.008, 0))
    );
    this.arcGlow.geometry.dispose();
    this.arcGlow.geometry = new THREE.BufferGeometry().setFromPoints(halo);
  }

  /** Enquadramento travado para inspeção visual (uso interno do desenvolvimento). */
  frozen = false;

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
      this.muzzleLight.intensity = 1.5 * flicker;
      (this.arcGlow.material as THREE.LineBasicMaterial).opacity = 0.3 + 0.5 * flicker;
      this.displayMaterial.color.setHex(0x1f6f7e);
    } else {
      this.muzzleLight.intensity = 0;
      this.displayMaterial.color.setHex(0x0d2a30);
    }

    // LED de carga pulsa devagar e trava aceso quando a célula está pronta.
    const ledPulse = 0.055 + 0.045 * Math.sin(performance.now() * 0.004);
    this.ledLight.intensity = ledPulse;

    this.root.visible = this.progress > 0.02;
    if (!this.root.visible) return;
    if (this.frozen) return;

    const slide = THREE.MathUtils.clamp(slideAmount, 0, 1);
    const bob = Math.min(1, speed / 5) * (1 - slide);
    const recoil = this.recoilTime / 0.22;
    const chargeKick = this.chargeTime > 0 ? (0.32 - this.chargeTime) / 0.32 : 1;
    const shake = discharging ? Math.sin(performance.now() * 0.09) * 0.0035 : 0;

    // Recuo: a arma sobe e volta, com o punho apertando no gatilho.
    this.gunGroup.position.set(
      this.swayX * 0.006 * this.handSign + shake * this.handSign,
      recoil * 0.014 + (1 - this.progress) * -0.03,
      0.028 * recoil * (0.35 + chargeKick * 0.65)
    );
    this.gunGroup.rotation.set(
      -recoil * 0.2,
      this.swayX * 0.05,
      this.swayY * 0.04 + recoil * 0.05 * this.handSign
    );
    this.handGroup.position.copy(this.gunGroup.position).multiplyScalar(0.55);
    this.handGroup.rotation.set(this.gunGroup.rotation.x * 0.4, 0, this.gunGroup.rotation.z * 0.5);

    // Gatilho e trava reagem ao disparo; o pulso acompanha o recuo.
    this.trigger.rotation.x = -Math.min(1, this.chargeTime / 0.32) * 0.55;
    this.safetyLever.rotation.z = -0.16 + Math.min(1, this.chargeTime / 0.32) * 0.1;
    // O punho aperta no disparo: os dedos fecham um pouco mais na empunhadura.
    const squeeze = 1 - Math.min(1, this.chargeTime / 0.32);
    for (let i = 0; i < this.fingerJoints.length; i++) {
      const joint = this.fingerJoints[i];
      joint.rotation.y = 0.62 + squeeze * 0.12;
      joint.rotation.z = -recoil * 0.05;
    }

    // Enquadramento: arma no canto inferior direito, cano convergindo para o
    // centro da mira, corpo inteiro dentro do frustum.
    const bobX = Math.sin(bobPhase) * 0.006 * bob;
    const bobY = Math.abs(Math.cos(bobPhase)) * 0.005 * bob;
    this.root.position.set(
      (0.17 - slide * 0.025) * this.handSign + bobX,
      -0.15 - (1 - this.progress) * 0.34 + bobY - slide * 0.03,
      -0.6 + recoil * 0.03
    );
    this.root.rotation.set(
      0.03 - recoil * 0.07 + slide * 0.05,
      0.34 * this.handSign - this.swayX * 0.03,
      -0.05 - slide * 0.16 * this.handSign
    );
    this.root.scale.setScalar(1.1);
    this.root.scale.x *= this.handSign;

    this.applyWebStruggle();

    this.swayX *= 1 - Math.min(1, step * 6);
    this.swayY *= 1 - Math.min(1, step * 6);
  }

  /**
   * Braços presos pela seda: a arma é arrastada para baixo e para dentro, e
   * cada arranco do operador levanta o conjunto antes do contragolpe.
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
    this.root.position.x += (-0.055 * this.handSign + tremor * 0.004) * b;
    this.root.position.y +=
      (-0.07 - strain * 0.02 + Math.max(0, yank) * 0.045 + breath * 0.004) * b;
    this.root.position.z += (0.06 - yank * 0.025) * b;
    this.root.rotation.x += (0.2 + strain * 0.08 - yank * 0.14) * b;
    this.root.rotation.z += (-0.16 - strain * 0.06 + tremor * 0.05) * this.handSign * b;
  }

  dispose(): void {
    const materials = new Set<THREE.Material>();
    const textures = new Set<THREE.Texture>();
    this.root.traverse((object) => {
      if (object instanceof THREE.Mesh || object instanceof THREE.Line) {
        object.geometry.dispose();
        const mats = Array.isArray(object.material) ? object.material : [object.material];
        mats.forEach((material) => {
          materials.add(material);
          const withMap = material as THREE.MeshLambertMaterial;
          if (withMap.map) textures.add(withMap.map);
        });
      }
    });
    textures.forEach((texture) => texture.dispose());
    materials.forEach((material) => material.dispose());
    this.root.removeFromParent();
  }
}
