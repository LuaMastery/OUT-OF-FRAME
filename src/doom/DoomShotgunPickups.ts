import * as THREE from 'three';
import { createDoomPropMaterial, type DoomSharedUniforms } from './DoomShader';
import type { ShotgunPartId } from './DoomShotgun';

export type ShotgunPickupId = ShotgunPartId | 'shotgun_shells';

/** Shared geometry for world pickups, hand-held props and inventory artwork. */
export function createShotgunPickupMaterials(shared?: DoomSharedUniforms) {
  const texture = (width: number, height: number, pixel: (x: number, y: number) => [number, number, number]) => {
    const data = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const [r, g, b] = pixel(x, y);
      data.set([r, g, b, 255], i);
    }
    const tex = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.needsUpdate = true;
    return tex;
  };
  const mat = (tex: THREE.Texture, brightness = 0.68) => shared
    ? createDoomPropMaterial(tex, shared, { baseLight: brightness, emissiveBoost: 0.12, doubleSided: true })
    : new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide });
  const solid = (color: [number, number, number]) => texture(2, 2, () => color);
  return {
    steel: mat(texture(32, 16, (x, y) => {
      const v = 75 + (x % 9 === 0 ? 14 : 0) + ((x * 3 + y * 7) % 7);
      return [v, v + 4, v + 7];
    })),
    edge: mat(solid([157, 166, 166]), 0.78),
    dark: mat(solid([28, 33, 35])),
    polymer: mat(texture(32, 16, (x, y) => {
      const v = 50 + (x % 5 === 0 ? 9 : 0) + (y % 4 === 0 ? 5 : 0);
      return [v, v + 3, v + 1];
    })),
    wood: mat(texture(32, 32, (x, y) => {
      const grain = Math.round(10 * Math.sin(x * .64 + Math.sin(y * .25) * 1.4));
      const v = grain + ((x * 7 + y * 3) % 7);
      return [126 + v, 71 + v, 37 + Math.round(v * .6)];
    }), 0.75),
    rubber: mat(solid([31, 29, 27])),
    brass: mat(solid([215, 161, 67]), 0.82),
    primer: mat(solid([235, 205, 140]), 0.84),
    // Wide, pale identifying band and vertical highlights remain legible at game resolution.
    shell: mat(texture(64, 32, (x, y) => {
      if (y >= 20 && y <= 23) return [238, 210, 155];
      const shine = (x >= 10 && x <= 17) || (x >= 42 && x <= 46) ? 25 : 0;
      const rib = x % 8 === 0 ? -12 : 0;
      return [180 + shine + rib, 36 + Math.round(shine * .5), 30 + Math.round(shine * .4)];
    }), 0.84),
  };
}
export type ShotgunPickupMaterials = ReturnType<typeof createShotgunPickupMaterials>;

/** X is the long axis; the lowest point is y=0 so it rests on a surface. */
export function buildShotgunPickup(id: ShotgunPickupId, m: ShotgunPickupMaterials): THREE.Group {
  const root = new THREE.Group();
  root.name = `ShotgunPickup_${id}`;
  const box = (name: string, w: number, h: number, d: number, x: number, y: number, z: number, material: THREE.Material) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    mesh.name = name; mesh.position.set(x, y, z); root.add(mesh); return mesh;
  };
  const cyl = (name: string, radius: number, length: number, x: number, y: number, z: number, material: THREE.Material, open = false) => {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, 16, 1, open), material);
    mesh.name = name; mesh.rotation.z = Math.PI / 2; mesh.position.set(x, y, z); root.add(mesh); return mesh;
  };
  const endRing = (name: string, outer: number, inner: number, x: number, y: number, z: number, mat: THREE.Material) => {
    const mesh = new THREE.Mesh(new THREE.RingGeometry(inner, outer, 16), mat);
    mesh.name = name; mesh.rotation.y = Math.PI / 2; mesh.position.set(x, y, z); root.add(mesh);
  };
  if (id === 'shotgun_barrel') {
    cyl('BarrelOuter', .023, .40, 0, .029, 0, m.steel, true);
    cyl('BarrelBore', .015, .40, 0, .029, 0, m.dark, true);
    endRing('MuzzleRim', .023, .015, -.201, .029, 0, m.edge);
    endRing('BreechRim', .023, .015, .201, .029, 0, m.edge);
    cyl('BreechCollar', .028, .038, .175, .029, 0, m.steel);
    box('SightBase', .045, .008, .018, -.155, .055, 0, m.steel);
    box('FrontSight', .009, .012, .009, -.167, .065, 0, m.brass);
    box('LowerLug', .038, .016, .024, .10, .010, 0, m.steel);
  } else if (id === 'shotgun_receiver') {
    box('ReceiverMain', .17, .075, .075, 0, .065, 0, m.steel);
    box('ReceiverTop', .155, .012, .065, -.003, .1085, 0, m.edge);
    // Ejection port has a contrasting inset and a metallic bolt, visible from the side.
    box('EjectionPort', .075, .034, .004, -.018, .079, .039, m.dark);
    box('Bolt', .050, .017, .005, -.023, .079, .042, m.edge);
    cyl('BarrelMount', .027, .034, -.1, .067, 0, m.steel);
    cyl('StockMount', .027, .028, .098, .067, 0, m.steel);
    // Guard is open, not a solid silhouette: three rails plus trigger.
    box('GuardFront', .009, .035, .013, -.045, .022, 0, m.edge);
    box('GuardRear', .009, .035, .013, .048, .022, 0, m.edge);
    box('GuardBottom', .102, .008, .013, .001, .004, 0, m.edge);
    const trigger = box('Trigger', .009, .023, .009, .004, .033, 0, m.brass);
    trigger.rotation.z = -.25;
    for (const x of [-.066, .065]) {
      const pin = new THREE.Mesh(new THREE.CylinderGeometry(.006, .006, .004, 12), m.edge);
      pin.name = 'ReceiverPin'; pin.rotation.x = Math.PI / 2; pin.position.set(x, .061, .039); root.add(pin);
    }
  } else if (id === 'shotgun_pump') {
    cyl('PumpBody', .041, .19, 0, .043, 0, m.polymer, true);
    cyl('PumpBore', .015, .208, 0, .043, 0, m.dark, true);
    for (let x = -.07; x <= .071; x += .02) cyl('PumpRib', .043, .006, x, .043, 0, m.steel);
    for (const x of [-.098, .098]) {
      cyl('PumpEndCollar', .033, .012, x, .043, 0, m.edge, true);
      endRing('PumpShoulder', .041, .033, x < 0 ? -.095 : .095, .043, 0, m.polymer);
      endRing('PumpSocket', .033, .015, x + (x < 0 ? -.0061 : .0061), .043, 0, m.edge);
    }
  } else if (id === 'shotgun_stock') {
    const shape = new THREE.Shape();
    shape.moveTo(-.15, .02); shape.lineTo(-.15, .105); shape.lineTo(-.065, .10);
    shape.lineTo(.02, .078); shape.lineTo(.11, .088); shape.lineTo(.11, .052);
    shape.lineTo(.04, .047); shape.lineTo(-.01, .015); shape.lineTo(-.075, .015); shape.closePath();
    const mesh = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: .06, bevelEnabled: true, bevelSize: .004, bevelThickness: .003, bevelSegments: 1 }), m.wood);
    mesh.name = 'StockWood'; mesh.position.z = -.03; root.add(mesh);
    const pad = box('ButtPad', .018, .09, .07, -.16, .063, 0, m.rubber); pad.rotation.z = -.035;
    box('StockMount', .018, .035, .05, .118, .07, 0, m.steel);
    for (let i = 0; i < 4; i++) {
      const line = box('GripCheckering', .006, .027, .003, .006 + i * .012, .045, .032, m.rubber);
      line.rotation.z = -.5;
    }
  } else {
    for (const z of [-.04, 0, .04]) {
      cyl('ShellHull', .016, .072, .007, .018, z, m.shell);
      cyl('ShellBrass', .0175, .017, -.038, .018, z, m.brass);
      endRing('ShellHeadRim', .0175, .008, -.047, .018, z, m.brass);
      cyl('ShellPrimer', .006, .001, -.0475, .018, z, m.primer);
      cyl('ShellCrimp', .0155, .002, .044, .018, z, m.shell);
      for (let i = 0; i < 3; i++) {
        const crease = box('CrimpLine', .001, .0014, .026, .0452, .018, z, m.dark);
        crease.rotation.x = i * Math.PI / 3;
      }
    }
  }
  // Cada peça deve encostar na superfície, inclusive a coronha chanfrada.
  const lowest = new THREE.Box3().setFromObject(root).min.y;
  for (const child of root.children) child.position.y -= lowest;
  return root;
}
