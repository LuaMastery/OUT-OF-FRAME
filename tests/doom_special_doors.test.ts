import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { buildDoomLabyrinth } from '../src/doom/DoomMazeBuilder';
import { createDoomTextures } from '../src/doom/DoomTextures';
import { createDoomSharedUniforms } from '../src/doom/DoomShader';
import { createRandomArenaLayout } from '../src/doom/DoomArenaRandomizer';
import { resetThemedRoomLocks } from '../src/doom/DoomRooms';
import { resolveCylinderWorldCollisions } from '../src/engine/physics/SpatialSweep';

function sceneFixture() {
  const scene = new THREE.Scene();
  const textures = createDoomTextures();
  const maze = buildDoomLabyrinth(scene, textures, createDoomSharedUniforms(),
    createRandomArenaLayout({ worldSeed: 42, playerSeed: 3 }));
  scene.updateMatrixWorld(true);
  return { scene, maze, textures };
}

function boundsInLeaf(mesh: THREE.Mesh): THREE.Box3 {
  mesh.geometry.computeBoundingBox();
  return mesh.geometry.boundingBox!.clone().applyMatrix4(mesh.matrix);
}

describe('Comportas detalhadas das salas especiais', () => {
  it('verifica todas as peças, as duas faces e o envelope nas sete portas e quatro orientações', () => {
    const { scene, maze, textures } = sceneFixture();
    try {
      expect(maze.specialRoomDoors.doors).toHaveLength(7);
      expect(new Set(maze.specialRoomDoors.doors.map(d => d.room.outwardDir)).size).toBe(4);
      const audited = new Set<THREE.BufferGeometry>();
      for (const door of maze.specialRoomDoors.doors) {
        const portal = scene.getObjectByName(`MazeRoomPortal_${door.room.id}`)!;
        expect(portal).toBeDefined();
        for (const leaf of [door.leftLeaf, door.rightLeaf]) {
          expect(leaf.children.map(c => c.name)).toEqual([
            'BlastDoorShell', 'BlastDoorFrameAndVents', 'BlastDoorArmorPlates', 'BlastDoorSectorMark', 'BlastDoorLockStatus',
          ]);
          for (const child of leaf.children) {
            const mesh = child as THREE.Mesh;
            const positions = mesh.geometry.getAttribute('position');
            const normals = mesh.geometry.getAttribute('normal');
            const uv = mesh.geometry.getAttribute('uv');
            expect(positions.count).toBeGreaterThan(0);
            expect(normals.count).toBe(positions.count);
            expect(uv.count).toBe(positions.count);
            for (let i = 0; i < positions.count; i++) {
              const values = [positions.getX(i), positions.getY(i), positions.getZ(i),
                normals.getX(i), normals.getY(i), normals.getZ(i), uv.getX(i), uv.getY(i)];
              expect(values.every(Number.isFinite), `${door.room.id}/${mesh.name}/${i}`).toBe(true);
            }
            if (!audited.has(mesh.geometry)) {
              audited.add(mesh.geometry);
              const index = mesh.geometry.getIndex();
              const count = index ? index.count : positions.count;
              const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
              const n = new THREE.Vector3(), vertexNormal = new THREE.Vector3();
              for (let k = 0; k < count; k += 3) {
                const ia = index ? index.getX(k) : k;
                const ib = index ? index.getX(k + 1) : k + 1;
                const ic = index ? index.getX(k + 2) : k + 2;
                a.fromBufferAttribute(positions, ia); b.fromBufferAttribute(positions, ib); c.fromBufferAttribute(positions, ic);
                n.subVectors(b, a).cross(c.sub(a));
                expect(n.lengthSq(), `${mesh.name}: face degenerada`).toBeGreaterThan(1e-12);
                n.normalize();
                for (const vertex of [ia, ib, ic]) {
                  vertexNormal.fromBufferAttribute(normals, vertex);
                  expect(n.dot(vertexNormal), `${mesh.name}: normal invertida`).toBeGreaterThan(.3);
                }
              }
            }
            const b = boundsInLeaf(mesh);
            expect(b.min.x).toBeGreaterThanOrEqual(-.536);
            expect(b.max.x).toBeLessThanOrEqual(.536);
            expect(b.min.y + leaf.position.y).toBeGreaterThan(.024); // sobre a soleira, sem atravessá-la
            expect(b.max.y + leaf.position.y).toBeLessThan(2.58);
            expect(b.min.z).toBeGreaterThan(-.22);
            expect(b.max.z).toBeLessThan(.22);
            if (mesh.name !== 'BlastDoorShell') {
              expect(b.min.z).toBeLessThan(-.09);
              expect(b.max.z).toBeGreaterThan(.09); // detalhes reais nos dois lados
            }
          }
          const accent = leaf.getObjectByName('BlastDoorSectorMark') as THREE.Mesh;
          expect((accent.material as THREE.ShaderMaterial).uniforms.uTint.value.getHex()).toBe(door.room.accentHex);
        }
        expect(door.leftLeaf.position.x + .535).toBeLessThan(door.rightLeaf.position.x - .535);
        expect(door.ledMaterials[0].uniforms.uTint.value.getHex()).toBe(0xff3344);
      }
    } finally {
      maze.specialRoomDoors.dispose();
      Object.values(textures).forEach(texture => texture.dispose());
      resetThemedRoomLocks();
    }
  });

  it('recolhe as duas folhas sem cruzá-las e mantém o acesso e a sinalização de cada sala', () => {
    const { maze, textures } = sceneFixture();
    try {
      for (const door of maze.specialRoomDoors.doors) {
        expect(maze.specialRoomDoors.unlockRoom(door.room.id)).toBe(true);
        expect(door.ledMaterials[0].uniforms.uTint.value.getHex()).toBe(0x32f08c);
        let previousGap = .01;
        for (let frame = 0; frame < 60; frame++) {
          maze.specialRoomDoors.update(1 / 60);
          const gap = door.rightLeaf.position.x - .535 - (door.leftLeaf.position.x + .535);
          expect(gap).toBeGreaterThanOrEqual(previousGap - 1e-6);
          expect(gap).toBeGreaterThan(0);
          previousGap = gap;
        }
        expect(door.openProgress).toBe(1);
        expect(previousGap).toBeGreaterThan(2.04);
        const r = door.room;
        const dx = Math.sign(r.doorGx - r.innerGx), dz = Math.sign(r.doorGz - r.innerGz);
        const walk = door.doorWorldPos.clone().add(new THREE.Vector3(-dx * 2.7, 0, -dz * 2.7));
        const end = door.doorWorldPos.clone().add(new THREE.Vector3(dx * 2.7, 0, dz * 2.7));
        for (let i = 0; i < 36; i++) {
          walk.x += dx * .15; walk.z += dz * .15;
          resolveCylinderWorldCollisions(walk, new THREE.Vector3(), .52, 1.8, maze.colliders);
        }
        expect(walk.distanceTo(end), r.id).toBeLessThan(.05);
      }
    } finally {
      maze.specialRoomDoors.dispose();
      Object.values(textures).forEach(texture => texture.dispose());
      resetThemedRoomLocks();
    }
  });

  it('libera geometrias compartilhadas e materiais próprios ao desmontar o cenário', () => {
    const { maze, textures } = sceneFixture();
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    for (const door of maze.specialRoomDoors.doors) {
      for (const leaf of [door.leftLeaf, door.rightLeaf]) {
        for (const object of leaf.children) {
          const mesh = object as THREE.Mesh;
          geometries.add(mesh.geometry);
          if (mesh.name === 'BlastDoorLockStatus' || mesh.name === 'BlastDoorSectorMark')
            materials.add(mesh.material as THREE.Material);
        }
      }
    }
    const counts = new Map<THREE.EventDispatcher, number>();
    for (const resource of [...geometries, ...materials]) {
      counts.set(resource, 0);
      resource.addEventListener('dispose', () => counts.set(resource, counts.get(resource)! + 1));
    }
    try {
      maze.specialRoomDoors.dispose();
      expect(geometries.size).toBe(10); // dois conjuntos compartilhados pelas sete salas
      expect(materials.size).toBe(14);
      for (const count of counts.values()) expect(count).toBe(1);
    } finally {
      Object.values(textures).forEach(texture => texture.dispose());
      resetThemedRoomLocks();
    }
  });

});
