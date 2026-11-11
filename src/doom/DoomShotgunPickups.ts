import * as THREE from 'three';
import { createDoomPropMaterial, type DoomSharedUniforms } from './DoomShader';
import type { ShotgunPartId } from './DoomShotgun';
import {
  buildShotgunBarrelAssembly,
  buildShotgunForend,
  buildShotgunReceiver,
  buildShotgunStock,
  type ShotgunMaterialSet,
} from './DoomShotgunModel';

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
    // Aço mais escuro (tubo de cartuchos) e polímero nervurado do guarda-mão.
    blued: mat(texture(32, 16, (x, y) => {
      const v = 52 + (x % 9 === 0 ? 11 : 0) + ((x * 5 + y * 3) % 5);
      return [v, v + 5, v + 11];
    })),
    polymerRib: mat(texture(32, 16, (x, y) => {
      const v = 34 + (x % 5 === 0 ? 7 : 0) + (y % 4 === 0 ? 4 : 0);
      return [v, v + 2, v + 1];
    })),
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

/** As peças do mundo usam os mesmos construtores da arma montada. */
function asGunMaterials(m: ShotgunPickupMaterials): ShotgunMaterialSet {
  return {
    steel: m.steel,
    steelBright: m.edge,
    steelDark: m.blued,
    polymer: m.polymer,
    polymerDark: m.polymerRib,
    wood: m.wood,
    woodDark: m.rubber,
    rubber: m.rubber,
    brass: m.brass,
    cavity: m.dark,
  };
}

/**
 * Deita a peça no chão: eixo longo em X, apoiada no próprio corpo.
 * A coronha deita sobre a face plana (melhor leitura de silhueta); cano,
 * receptor e guarda-mão deitam de lado, como fariam numa bancada.
 */
function layPartFlat(
  root: THREE.Group,
  part: THREE.Group,
  scale: number,
  flatFaceDown: boolean
): void {
  const basis = new THREE.Matrix4();
  if (flatFaceDown) {
    basis.makeBasis(
      new THREE.Vector3(0, -1, 0),
      new THREE.Vector3(0, 0, -1),
      new THREE.Vector3(1, 0, 0)
    );
  } else {
    basis.makeBasis(
      new THREE.Vector3(0, 0, -1),
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(1, 0, 0)
    );
  }
  part.quaternion.setFromRotationMatrix(basis);
  part.scale.setScalar(scale);
  root.add(part);
}

/** X is the long axis; the lowest point is y=0 so it rests on a surface. */
export function buildShotgunPickup(id: ShotgunPickupId, m: ShotgunPickupMaterials): THREE.Group {
  const root = new THREE.Group();
  root.name = `ShotgunPickup_${id}`;
  const gun = asGunMaterials(m);

  // Helpers usados pelos cartuchos (as peças grandes vêm do modelo da arma).
  const box = (name: string, w: number, h: number, d: number, x: number, y: number, z: number, material: THREE.Material) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    mesh.name = name; mesh.position.set(x, y, z); root.add(mesh); return mesh;
  };
  const cyl = (name: string, radius: number, length: number, x: number, y: number, z: number, material: THREE.Material, open = false) => {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, 16, 1, open), material);
    mesh.name = name; mesh.rotation.z = Math.PI / 2; mesh.position.set(x, y, z); root.add(mesh); return mesh;
  };
  const endRing = (name: string, outer: number, inner: number, x: number, y: number, z: number, material: THREE.Material) => {
    const mesh = new THREE.Mesh(new THREE.RingGeometry(inner, outer, 16), material);
    mesh.name = name; mesh.rotation.y = Math.PI / 2; mesh.position.set(x, y, z); root.add(mesh);
  };

  if (id === 'shotgun_barrel') {
    // O cano da arma: cano, tubo de cartuchos, cinta, trilho e massa de mira.
    layPartFlat(root, buildShotgunBarrelAssembly(gun), 0.78, false);
  } else if (id === 'shotgun_receiver') {
    // O receptor: tampa do ferrolho, porta de ejeção, guarda-mato e gatilho.
    layPartFlat(root, buildShotgunReceiver(gun), 0.78, false);
  } else if (id === 'shotgun_pump') {
    // O guarda-mão com as barras de ação que entram no receptor.
    layPartFlat(root, buildShotgunForend(gun), 0.78, false);
  } else if (id === 'shotgun_stock') {
    // A coronha de nogueira, deitada sobre a face plana.
    layPartFlat(root, buildShotgunStock(gun), 0.8, true);
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
