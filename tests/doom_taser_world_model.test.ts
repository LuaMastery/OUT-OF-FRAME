import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createRandomArenaLayout } from '../src/doom/DoomArenaRandomizer';
import { createDoomSharedUniforms } from '../src/doom/DoomShader';
import { DoomWorldItems } from '../src/doom/DoomWorldItems';

/** Vão livre onde os itens viajam dentro do caixote fechado. */
const CAVITY = new THREE.Box3(
  new THREE.Vector3(-0.2149, 0.0941, -0.1649),
  new THREE.Vector3(0.2149, 0.1849, 0.1649)
);

/**
 * Caixote do Taser montado no espaço LOCAL da caixa (sem o giro da sala), para
 * medir a peça exatamente como ela foi modelada.
 */
function buildTaserCrate(worldSeed: number) {
  const layout = createRandomArenaLayout({ worldSeed, playerSeed: 7 });
  const scene = new THREE.Scene();
  new DoomWorldItems(scene, createDoomSharedUniforms(), layout);
  const taser = scene.getObjectByName('WorldTaser')!;
  const shells = scene.getObjectByName('WorldTaserShells')!;
  const crate = taser.parent!;

  crate.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(crate.matrixWorld).invert();
  const localBox = (obj: THREE.Object3D): THREE.Box3 => {
    const box = new THREE.Box3();
    obj.updateMatrixWorld(true);
    obj.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry.computeBoundingBox();
      const world = mesh.geometry.boundingBox!.clone().applyMatrix4(
        new THREE.Matrix4().multiplyMatrices(inv, mesh.matrixWorld)
      );
      box.union(world);
    });
    return box;
  };
  return { taser, shells, taserBox: localBox(taser), shellsBox: localBox(shells) };
}

describe('Taser de contenção largado no caixote', () => {
  it('reaproveita o corpo do modelo de 1ª pessoa em vez de blocos grosseiros', () => {
    const { taser } = buildTaserCrate(42);
    const rig = taser.getObjectByName('TaserBodyRig');
    expect(rig, 'o corpo compartilhado do Taser está faltando').toBeTruthy();

    let meshes = 0;
    let vertices = 0;
    rig!.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (!mesh.isMesh) return;
      meshes += 1;
      vertices += mesh.geometry.getAttribute('position').count;
    });
    // A versão antiga era feita de três caixas e dois tocos de eletrodo.
    expect(meshes).toBeGreaterThan(30);
    expect(vertices).toBeGreaterThan(600);
  });

  it('deita apoiado no forro, dentro do vão e longe dos cartuchos', () => {
    for (const seed of [42, 1337, 90210]) {
      const label = `worldSeed=${seed}`;
      const { taserBox, shellsBox } = buildTaserCrate(seed);

      // Pousado no forro interno (0.094): nada de peça boiando nem afundada.
      expect(taserBox.min.y, label).toBeGreaterThanOrEqual(CAVITY.min.y - 1e-3);
      expect(taserBox.min.y, label).toBeLessThan(0.11);
      // ... e sem atravessar a boca do baú quando a tampa fecha.
      expect(taserBox.max.y, label).toBeLessThanOrEqual(CAVITY.max.y);

      // Inteiro dentro das paredes do caixote.
      expect(taserBox.min.x, label).toBeGreaterThanOrEqual(CAVITY.min.x);
      expect(taserBox.max.x, label).toBeLessThanOrEqual(CAVITY.max.x);
      expect(taserBox.min.z, label).toBeGreaterThanOrEqual(CAVITY.min.z);
      expect(taserBox.max.z, label).toBeLessThanOrEqual(CAVITY.max.z);

      // A bandeja é compartilhada: o Taser e os cartuchos não podem se tocar.
      expect(taserBox.intersectsBox(shellsBox), label).toBe(false);
    }
  });
});
