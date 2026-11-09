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

/** First-person hand-held stun gun with twin electrodes and a brief electric arc. */
export class DoomTaserViewmodel {
  readonly viewScene = new THREE.Scene();
  readonly viewCamera: THREE.PerspectiveCamera;
  private readonly root = new THREE.Group();
  private readonly arc: THREE.Line;
  private equipped = false;
  private progress = 0;
  private flashTime = 0;
  private handSign: 1 | -1 = 1;

  constructor(aspect: number) {
    this.viewCamera = new THREE.PerspectiveCamera(computeAdaptiveVerticalFov(aspect, 62, 84), aspect, 0.02, 5);
    this.viewScene.add(new THREE.AmbientLight(0xa5bed2, 0.8));
    const light = new THREE.DirectionalLight(0xffecd0, 1);
    light.position.set(-1, 2, 1);
    this.viewScene.add(light);
    const yellow = new THREE.MeshLambertMaterial({ color: 0xd9a621, flatShading: true });
    const black = new THREE.MeshLambertMaterial({ color: 0x202830, flatShading: true });
    const metal = new THREE.MeshLambertMaterial({ color: 0x9cabb2, flatShading: true });
    const glove = new THREE.MeshLambertMaterial({ color: 0x24282a, flatShading: true });
    const addBox = (w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      mesh.position.set(x, y, z);
      this.root.add(mesh);
      return mesh;
    };
    addBox(0.10, 0.09, 0.25, yellow, 0, 0, -0.12);
    addBox(0.11, 0.04, 0.10, black, 0, 0.045, -0.04);
    const grip = addBox(0.065, 0.16, 0.07, black, 0, -0.095, -0.025);
    grip.rotation.x = -0.23;
    const hand = addBox(0.085, 0.085, 0.09, glove, 0, -0.12, 0.005);
    hand.rotation.x = -0.2;
    addBox(0.08, 0.015, 0.02, black, 0, 0.05, -0.17);
    addBox(0.012, 0.018, 0.045, metal, -0.032, 0.01, -0.262);
    addBox(0.012, 0.018, 0.045, metal, 0.032, 0.01, -0.262);
    const arcGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-0.032, 0.012, -0.288),
      new THREE.Vector3(-0.014, 0.028, -0.307),
      new THREE.Vector3(-0.004, -0.005, -0.32),
      new THREE.Vector3(0.012, 0.023, -0.305),
      new THREE.Vector3(0.032, 0.012, -0.288),
    ]);
    this.arc = new THREE.Line(arcGeo, new THREE.LineBasicMaterial({ color: 0x8deaff }));
    this.arc.visible = false;
    this.root.add(this.arc);
    this.root.visible = false;
    this.viewScene.add(this.root);
  }

  get isEquipped(): boolean { return this.equipped; }
  get isVisibleInView(): boolean { return this.root.visible; }
  equip(): void { this.equipped = true; }
  stow(): void { this.equipped = false; }
  fire(): void { this.flashTime = 0.22; this.arc.visible = true; }
  setHandedness(hand: 'right' | 'left'): void { this.handSign = hand === 'left' ? -1 : 1; }
  setAspect(aspect: number): void {
    this.viewCamera.aspect = aspect;
    this.viewCamera.fov = computeAdaptiveVerticalFov(aspect, 62, 84);
    this.viewCamera.updateProjectionMatrix();
  }
  update(dt: number, bobPhase: number, speed: number): void {
    const step = Math.min(0.05, Math.max(0, dt));
    this.progress += ((this.equipped ? 1 : 0) - this.progress) * (1 - Math.exp(-13 * step));
    this.flashTime = Math.max(0, this.flashTime - step);
    this.arc.visible = this.flashTime > 0;
    this.root.visible = this.progress > 0.02;
    this.root.scale.x = this.handSign;
    const bob = Math.min(1, speed / 5);
    this.root.position.set(0.22 * this.handSign + Math.sin(bobPhase) * 0.008 * bob,
      -0.20 - (1 - this.progress) * 0.4 + Math.abs(Math.cos(bobPhase)) * 0.008 * bob, -0.13);
    this.root.rotation.x = this.flashTime > 0 ? -0.09 : 0;
  }
  dispose(): void {
    const materials = new Set<THREE.Material>();
    this.root.traverse(object => {
      if (object instanceof THREE.Mesh || object instanceof THREE.Line) {
        object.geometry.dispose();
        const mats = Array.isArray(object.material) ? object.material : [object.material];
        mats.forEach(material => materials.add(material));
      }
    });
    materials.forEach(material => material.dispose());
    this.root.removeFromParent();
  }
}
