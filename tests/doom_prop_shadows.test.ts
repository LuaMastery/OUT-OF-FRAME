import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createRandomArenaLayout } from '../src/doom/DoomArenaRandomizer';
import { DoomFlashlight } from '../src/doom/DoomFlashlight';
import {
  createDoomShadowDecalTexture,
  PropContactShadow,
  PropLightingProbe,
} from '../src/doom/DoomPropShadows';
import {
  createDoomPropMaterial,
  createDoomSharedUniforms,
} from '../src/doom/DoomShader';
import { DoomWorldItems } from '../src/doom/DoomWorldItems';

const DECAL_NAME = 'PropShadowDecal';

function collectShadowDecals(root: THREE.Object3D): THREE.Mesh[] {
  const found: THREE.Mesh[] = [];
  root.traverse((obj) => {
    if (obj.name === DECAL_NAME && (obj as THREE.Mesh).isMesh) {
      found.push(obj as THREE.Mesh);
    }
  });
  return found;
}

/** Direção mundial do eixo longo do decalque (onde a sombra "aponta"). */
function decalLongAxisWorld(decal: THREE.Mesh): THREE.Vector3 {
  const origin = new THREE.Vector3();
  const tip = new THREE.Vector3(1, 0, 0);
  decal.getWorldPosition(origin);
  tip.applyMatrix4(decal.matrixWorld);
  return tip.sub(origin).normalize();
}

describe('sombra de props (decalque de contato)', () => {
  it('a textura do decalque é opaca no centro e transparente nas bordas', () => {
    const tex = createDoomShadowDecalTexture(32);
    const size = 32;
    const half = (size - 1) / 2;
    const alphaAt = (x: number, y: number) =>
      tex.image.data[(y * size + x) * 4 + 3] as number;

    expect(alphaAt(Math.round(half), Math.round(half))).toBeGreaterThan(225);
    expect(alphaAt(0, 0)).toBe(0);
    expect(alphaAt(size - 1, 0)).toBe(0);
    // Cai de forma monótona do centro para a borda.
    let previous = 255;
    for (let x = Math.round(half); x < size; x++) {
      const a = alphaAt(x, Math.round(half));
      expect(a).toBeLessThanOrEqual(previous);
      previous = a;
    }
  });

  it('a sonda aponta a sombra para longe da lâmpada dominante', () => {
    const probe = new PropLightingProbe();
    const target = new THREE.Vector3(1.5, 1, 0);
    probe.sample(target, [
      { position: new THREE.Vector3(0, 2, 0), intensity: 1 },
    ]);

    // Alvo à direita da lâmpada -> a sombra cai para a direita (+X).
    expect(probe.dirX).toBeGreaterThan(0.99);
    expect(Math.abs(probe.dirZ)).toBeLessThan(1e-6);
    expect(probe.level).toBeGreaterThan(0);
    expect(probe.lightY).toBeCloseTo(2, 5);

    // Sem luz alguma: breu, sem direção definida.
    const dark = new PropLightingProbe();
    dark.sample(target, [{ position: new THREE.Vector3(40, 2, 0), intensity: 1 }]);
    expect(dark.level).toBe(0);

    // Fora do cone do feixe a lanterna não conta; dentro do cone, conta.
    const beam = new PropLightingProbe();
    beam.sample(target, [], {
      position: new THREE.Vector3(1.5, 1.2, 3),
      intensity: 1,
      direction: new THREE.Vector3(0, 0, 1),
      coneCos: 0.78,
    });
    expect(beam.level).toBe(0);
    const beamHit = new PropLightingProbe();
    beamHit.sample(target, [], {
      position: new THREE.Vector3(1.5, 1.2, 3),
      intensity: 1,
      direction: new THREE.Vector3(0, 0, -1),
      coneCos: 0.78,
    });
    expect(beamHit.level).toBeGreaterThan(0.5);
    // A sombra continua no sentido do feixe, ou seja, para -Z.
    expect(beamHit.dirZ).toBeLessThan(-0.99);
  });

  it('o decalque alonga a sombra na direção oposta à luz, respeitando o yaw do objeto', () => {
    const tex = createDoomShadowDecalTexture(16);
    const yaws = [0, Math.PI / 2, -0.7, 2.4];
    const dirs = [
      [1, 0],
      [0, 1],
      [-1, 0],
      [0.6, 0.8],
    ];

    for (const yaw of yaws) {
      for (const [dx, dz] of dirs) {
        const shadow = new PropContactShadow(tex, {
          halfX: 0.26,
          halfZ: 0.21,
          height: 0.2,
          yaw,
          maxLength: 0.3,
        });
        const parent = new THREE.Group();
        parent.add(shadow.object);
        const decal = collectShadowDecals(parent)[0];

        // Luz alta -> sombra curta; luz baixa -> sombra mais comprida, sempre
        // na mesma direção.
        shadow.update(1.2, dx, dz, 2.6, 1.4, 1);
        parent.updateMatrixWorld(true);
        const shortLength = decal.scale.x;
        const axis = decalLongAxisWorld(decal);
        const wanted = new THREE.Vector3(dx, 0, dz).normalize();
        expect(axis.dot(wanted)).toBeGreaterThan(0.999);

        shadow.update(1.2, dx, dz, 0.4, 1.4, 1);
        expect(decal.scale.x).toBeGreaterThan(shortLength);
      }
    }
  });

  it('a sombra fica mais escura com luz e nunca passa do alongamento máximo', () => {
    const tex = createDoomShadowDecalTexture(16);
    const shadow = new PropContactShadow(tex, {
      halfX: 0.26,
      halfZ: 0.21,
      height: 0.2,
      ambientOpacity: 0.3,
      litOpacity: 0.72,
      maxLength: 0.3,
    });
    const parent = new THREE.Group();
    parent.add(shadow.object);

    shadow.update(0, 1, 0, 0, 0, 1);
    const decal = collectShadowDecals(parent)[0];
    const darkOpacity = (decal.material as THREE.MeshBasicMaterial).opacity;
    expect(darkOpacity).toBeCloseTo(0.3, 5);

    shadow.update(1.15, 1, 0, 1.8, 1.4, 1);
    const litOpacity = (decal.material as THREE.MeshBasicMaterial).opacity;
    expect(litOpacity).toBeGreaterThan(darkOpacity + 0.3);
    expect(litOpacity).toBeLessThanOrEqual(0.72 + 1e-6);

    // Luz rasante (baixa) projeta uma sombra mais longa que a luz do teto.
    shadow.update(1.15, 1, 0, 0.4, 1.4, 1);
    const lowLength = decal.scale.x;
    shadow.update(1.15, 1, 0, 2.6, 1.4, 1);
    const highLength = decal.scale.x;
    expect(lowLength).toBeGreaterThan(highLength);
    // Nunca estica mais do que maxLength (0.1 m) somado à pegada.
    expect(lowLength).toBeLessThanOrEqual(0.26 * 2 + 0.3 + 1e-6);
  });

  it('o material de prop aceita sombreamento difuso, oclusão e especular', () => {
    const shared = createDoomSharedUniforms();
    const tex = createDoomShadowDecalTexture(8);
    const mat = createDoomPropMaterial(tex, shared, {
      shading: 0.5,
      occlusion: 0.3,
      specular: 0.4,
    });
    expect(mat.uniforms.uShading.value).toBeCloseTo(0.5, 6);
    expect(mat.uniforms.uOcclusion.value).toBeCloseTo(0.3, 6);
    expect(mat.uniforms.uSpecular.value).toBeCloseTo(0.4, 6);

    const plain = createDoomPropMaterial(tex, shared, {});
    expect(plain.uniforms.uShading.value).toBe(1);

    // O shader do prop precisa continuar sombreando pela normal da face.
    expect(mat.fragmentShader).toContain('dot(normal, lightDir)');
    expect(mat.fragmentShader).toContain('selfOcclusion');
  });
});

describe('caixotes com sombra no mundo', () => {
  it('cada caixote recebe um decalque de sombra que reage à luz perto dele', () => {
    const layout = createRandomArenaLayout({
      worldSeed: 4242,
      crateCount: 8,
      playerCount: 1,
    });
    const scene = new THREE.Scene();
    const shared = createDoomSharedUniforms();
    const items = new DoomWorldItems(scene, shared, layout);
    const snapshot = items.getPickupsSnapshot();
    expect(snapshot.length).toBeGreaterThan(0);

    const decals = collectShadowDecals(scene);
    expect(decals.length).toBe(layout.cratePlacements.length);

    // 1) No breu: só a oclusão de contato (opacidade baixa e igual em todos).
    shared.uLightCount.value = 0;
    for (let i = 0; i < 40; i++) items.updatePropShadows(0.2);
    const darkOpacity = (decals[0].material as THREE.MeshBasicMaterial).opacity;
    expect(darkOpacity).toBeGreaterThan(0);
    for (const decal of decals) {
      expect((decal.material as THREE.MeshBasicMaterial).opacity).toBeCloseTo(
        darkOpacity,
        4
      );
    }

    // 2) Uma arandela colada no primeiro caixote: a sombra dele escurece...
    const first = snapshot[0];
    shared.uLightPositions.value[0].set(first.position.x + 1.2, 1.72, first.position.z);
    shared.uLightIntensities.value[0] = 1.25;
    shared.uLightCount.value = 1;
    for (let i = 0; i < 80; i++) items.updatePropShadows(0.2);
    const litOpacity = (decals[0].material as THREE.MeshBasicMaterial).opacity;
    expect(litOpacity).toBeGreaterThan(darkOpacity + 0.2);

    // ... e aponta para longe da lâmpada (+X).
    scene.updateMatrixWorld(true);
    const axis = decalLongAxisWorld(decals[0]);
    expect(axis.dot(new THREE.Vector3(-1, 0, 0))).toBeGreaterThan(0.95);

    // 3) Caixotes fora do raio da luz mantêm a sombra de contato.
    for (let i = 1; i < decals.length; i++) {
      const other = (decals[i].material as THREE.MeshBasicMaterial).opacity;
      expect(other).toBeLessThan(litOpacity);
    }

    // 4) O feixe da lanterna também projeta sombra quando passa pelo caixote.
    shared.uLightCount.value = 0;
    for (let i = 0; i < 80; i++) items.updatePropShadows(0.2);
    const beforeBeam = (decals[0].material as THREE.MeshBasicMaterial).opacity;
    shared.uFlashlightPos.value.set(
      first.position.x,
      first.position.y + 0.4,
      first.position.z + 2.2
    );
    shared.uFlashlightDir.value.set(0, 0, -1);
    shared.uFlashlightIntensity.value = 1;
    for (let i = 0; i < 80; i++) items.updatePropShadows(0.2);
    const afterBeam = (decals[0].material as THREE.MeshBasicMaterial).opacity;
    expect(afterBeam).toBeGreaterThan(beforeBeam + 0.05);

    scene.updateMatrixWorld(true);
    const beamAxis = decalLongAxisWorld(decals[0]);
    expect(beamAxis.dot(new THREE.Vector3(0, 0, -1))).toBeGreaterThan(0.95);
  });

  it('a sombra fica contida na superfície de apoio do caixote', () => {
    const layout = createRandomArenaLayout({
      worldSeed: 909,
      crateCount: 6,
      playerCount: 1,
    });
    const scene = new THREE.Scene();
    const shared = createDoomSharedUniforms();
    const items = new DoomWorldItems(scene, shared, layout);
    shared.uLightPositions.value[0].set(0, 0.45, 0);
    shared.uLightIntensities.value[0] = 2;
    for (let i = 1; i < shared.uLightPositions.value.length; i++) {
      shared.uLightPositions.value[i].set(0, 3, i * 0.4);
      shared.uLightIntensities.value[i] = 2;
    }
    shared.uLightCount.value = shared.uLightPositions.value.length;
    for (let i = 0; i < 60; i++) items.updatePropShadows(0.2);

    for (const decal of collectShadowDecals(scene)) {
      // O engradado que sustenta o caixote tem ~0.30 m de meia-extensão: a
      // mancha não pode virar um rastro flutuando no vazio.
      expect(decal.scale.x).toBeLessThan(0.78);
      expect(decal.scale.y).toBeLessThan(0.78);
    }
  });
});

describe('lanterna iluminada pelo mundo', () => {
  function findViewmodelLights(fl: DoomFlashlight) {
    const directional: THREE.DirectionalLight[] = [];
    const ambient: THREE.AmbientLight[] = [];
    const point: THREE.PointLight[] = [];
    fl.viewScene.traverse((obj) => {
      if ((obj as THREE.DirectionalLight).isDirectionalLight) {
        directional.push(obj as THREE.DirectionalLight);
      }
      if ((obj as THREE.AmbientLight).isAmbientLight) {
        ambient.push(obj as THREE.AmbientLight);
      }
      if ((obj as THREE.PointLight).isPointLight) {
        point.push(obj as THREE.PointLight);
      }
    });
    return {
      key: directional.find((l) => l.castShadow)!,
      rim: directional.find((l) => !l.castShadow)!,
      ambient: ambient[0]!,
      selfGlow: point[0]!,
    };
  }

  it('projeta sombra real sobre a própria luva e o braço', () => {
    const fl = new DoomFlashlight(16 / 9);
    const { key, selfGlow } = findViewmodelLights(fl);
    expect(key.castShadow).toBe(true);
    expect(key.shadow.mapSize.x).toBeGreaterThanOrEqual(512);
    // A câmera da sombra abrange o braço inteiro em 1ª pessoa.
    expect(key.shadow.camera.right).toBeGreaterThan(0.4);
    expect(key.shadow.camera.far).toBeGreaterThan(key.shadow.camera.near);
    expect(selfGlow).toBeDefined();

    let lambertMeshes = 0;
    let basicMeshes = 0;
    fl.viewScene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const lit = mats.some(
        (m) => (m as THREE.MeshLambertMaterial).isMeshLambertMaterial
      );
      if (lit) {
        lambertMeshes++;
        expect(mesh.castShadow).toBe(true);
        expect(mesh.receiveShadow).toBe(true);
      } else {
        basicMeshes++;
        expect(mesh.castShadow).toBe(false);
      }
    });
    expect(lambertMeshes).toBeGreaterThan(10);
    expect(basicMeshes).toBeGreaterThan(0);
  });

  it('clareia perto da luz e escurece no breu, vindo da direção da lâmpada', () => {
    const fl = new DoomFlashlight(16 / 9);
    const { key, rim, ambient } = findViewmodelLights(fl);
    const settle = () => {
      for (let i = 0; i < 200; i++) fl.update(0.05, 0, 0, () => {}, 0, 100);
    };

    // Breu: mínimo de luz para o modelo não sumir, sem estourar o COLORMAP.
    fl.applyWorldLighting(0, 0, 1, 0);
    settle();
    const darkKey = key.intensity;
    const darkAmbient = ambient.intensity;
    expect(darkKey).toBeLessThan(0.4);
    expect(darkAmbient).toBeLessThan(0.3);

    // Embaixo de uma arandela: bem mais claro, e a luz entra por cima.
    fl.applyWorldLighting(1.3, 0, 1, 0);
    settle();
    expect(key.intensity).toBeGreaterThan(darkKey + 0.6);
    expect(ambient.intensity).toBeGreaterThan(darkAmbient + 0.5);
    expect(rim.intensity).toBeGreaterThan(0.3);
    const keyDir = key.position.clone().normalize();
    expect(keyDir.y).toBeGreaterThan(0.98);

    // Luz vindo pela esquerda: a direção da luz principal acompanha.
    fl.applyWorldLighting(1.3, -1, 0.1, 0);
    settle();
    const leftDir = key.position.clone().normalize();
    expect(leftDir.x).toBeLessThan(-0.9);
    expect(leftDir.dot(keyDir)).toBeLessThan(0.2);
  });

  it('a lâmpada acesa vaza luz sobre o próprio modelo', () => {
    const fl = new DoomFlashlight(16 / 9);
    const { selfGlow } = findViewmodelLights(fl);
    for (let i = 0; i < 30; i++) fl.update(0.05, 0, 0, () => {}, 0, 100);
    expect(selfGlow.intensity).toBe(0);

    fl.toggle();
    for (let i = 0; i < 30; i++) fl.update(0.05, 0, 0, () => {}, 0, 100);
    expect(selfGlow.intensity).toBeGreaterThan(0.4);
  });
});
