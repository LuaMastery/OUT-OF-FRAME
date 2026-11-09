import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { buildDoomThemedRooms, RoomFurnitureKind, resetThemedRoomLocks } from '../src/doom/DoomRooms';
import { createDoomSharedUniforms } from '../src/doom/DoomShader';
import { createDoomTextures } from '../src/doom/DoomTextures';
import type { StaticColliderBox } from '../src/engine/physics/SpatialSweep';

type Piece = Extract<RoomFurnitureKind, 'bio_specimen_tank' | 'cryo_biohazard_cabinet'>;
function fixture(kind: Piece, yaw = 0) {
  const scene = new THREE.Group();
  const dimensions = kind === 'bio_specimen_tank'
    ? { width: 1.08, depth: 1.02, height: 2.48 }
    : { width: 1.44, depth: 0.72, height: 2.18 };
  const quarterTurn = Math.abs(Math.sin(yaw)) > 0.5;
  const halfX = (quarterTurn ? dimensions.depth : dimensions.width) / 2;
  const halfZ = (quarterTurn ? dimensions.width : dimensions.depth) / 2;
  const colliders: StaticColliderBox[] = [];
  const placement = {
    id: 'fixture', roomId: 'biology_lab' as const, kind, gx: 0, gz: 0,
    worldX: 0, worldZ: 0, yaw, minX: -halfX, maxX: halfX,
    minY: 0, maxY: dimensions.height, minZ: -halfZ, maxZ: halfZ,
  };
  const controller = buildDoomThemedRooms(scene, [placement], createDoomTextures(), createDoomSharedUniforms(), colliders).specialRoomDoors;
  return { scene, colliders, controller, dimensions };
}

describe('Modelagens do laboratório biológico', () => {
  it('o tanque tem apenas a parede de vidro, sem discos transparentes sobrepostos às bases', () => {
    const { scene, controller } = fixture('bio_specimen_tank');
    try {
      const mesh = scene.getObjectByName('MazeRoom_specimenGlass') as THREE.Mesh;
      expect(mesh).toBeDefined();
      expect(mesh.geometry.index!.count).toBe(24 * 6);
      const normals = mesh.geometry.getAttribute('normal');
      for (let i = 0; i < normals.count; i++) expect(Math.abs(normals.getY(i))).toBeLessThan(1e-6);
      const material = mesh.material as THREE.ShaderMaterial;
      expect(material.transparent).toBe(true);
      expect(material.depthWrite).toBe(false);
      const vertices = mesh.geometry.getAttribute('position');
      for (let i = 0; i < vertices.count; i++) {
        expect(Math.hypot(vertices.getX(i), vertices.getZ(i))).toBeCloseTo(0.38, 5);
      }
    } finally { controller.dispose(); resetThemedRoomLocks(); }
  });

  it('o armário tem duas lâminas de vidro e um reservatório independente apoiado no piso', () => {
    const { scene, controller } = fixture('cryo_biohazard_cabinet');
    try {
      const panes: THREE.Mesh[] = [];
      scene.traverse(object => { if (object.name === 'MazeRoom_cryoWindow') panes.push(object as THREE.Mesh); });
      expect(panes).toHaveLength(2);
      for (const pane of panes) {
        const material = pane.material as THREE.ShaderMaterial;
        expect(material.transparent).toBe(true);
        expect(material.depthWrite).toBe(false);
        expect(pane.geometry.index!.count).toBe(6);
        const vertices = pane.geometry.getAttribute('position');
        for (let i = 0; i < vertices.count; i++) expect(vertices.getZ(i)).toBeCloseTo(0.316, 5);
      }
      const iron = (scene.getObjectByName('MazeRoom_darkIron') as THREE.Mesh).geometry.getAttribute('position');
      let hasCylinderFoot = false;
      for (let i = 0; i < iron.count; i++) {
        const x = iron.getX(i), y = iron.getY(i), z = iron.getZ(i);
        if (Math.abs(y) < 1e-5 && Math.hypot(x - 0.54, z) < 0.141 && x > 0.38) hasCylinderFoot = true;
      }
      expect(hasCylinderFoot).toBe(true);
      // Corpo e reservatório estão separados; somente a conexão escura atravessa o vão.
      const metal = (scene.getObjectByName('MazeRoom_metalTrim') as THREE.Mesh).geometry.getAttribute('position');
      let cylinderLeft = Infinity;
      let hasCabinetEdge = false;
      for (let i = 0; i < metal.count; i++) {
        const x = metal.getX(i), y = metal.getY(i), z = metal.getZ(i);
        if (Math.abs(x - 0.33) < 1e-5 && y > 0.1 && y < 1.85 && Math.abs(z) < 0.3) hasCabinetEdge = true;
        if (x > 0.37 && x < 0.7 && y > 0.1 && y < 1.5 && Math.abs(z) < 0.2) cylinderLeft = Math.min(cylinderLeft, x);
      }
      expect(hasCabinetEdge).toBe(true);
      expect(cylinderLeft - 0.33).toBeGreaterThan(0.07);
    } finally { controller.dispose(); resetThemedRoomLocks(); }
  });

  it('ordena as superfícies de vidro por peça, sem mesclar tanques ou janelas distantes', () => {
    const scene = new THREE.Group();
    const kinds = ['bio_specimen_tank', 'bio_specimen_tank', 'cryo_biohazard_cabinet', 'cryo_biohazard_cabinet'] as const;
    const placements = kinds.map((kind, i) => ({
      id: `piece-${i}`, roomId: 'biology_lab' as const, kind, gx: 0, gz: 0,
      worldX: i * 3, worldZ: 0, yaw: 0, minX: i * 3 - 1, maxX: i * 3 + 1,
      minY: 0, maxY: 2.48, minZ: -1, maxZ: 1,
    }));
    const controller = buildDoomThemedRooms(scene, placements, createDoomTextures(), createDoomSharedUniforms(), []).specialRoomDoors;
    try {
      const tanks = scene.children.filter(object => object.name === 'MazeRoom_specimenGlass') as THREE.Mesh[];
      const windows = scene.children.filter(object => object.name === 'MazeRoom_cryoWindow') as THREE.Mesh[];
      expect(tanks).toHaveLength(2);
      expect(windows).toHaveLength(4);
      expect(tanks[0].geometry).not.toBe(tanks[1].geometry);
      for (const mesh of [...tanks, ...windows]) expect(mesh.geometry.boundingSphere).not.toBeNull();
    } finally { controller.dispose(); resetThemedRoomLocks(); }
  });

  it('mantém todos os vértices das duas peças dentro da colisão nas quatro orientações', () => {
    for (const kind of ['bio_specimen_tank', 'cryo_biohazard_cabinet'] as const) {
      for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
        const { scene, controller, colliders, dimensions } = fixture(kind, yaw);
        try {
          expect(colliders.find(c => c.id === 'fixture')?.isObstacle).toBe(true);
          let count = 0;
          scene.updateMatrixWorld(true);
          const point = new THREE.Vector3();
          scene.traverse(object => {
            const mesh = object as THREE.Mesh;
            if (!mesh.isMesh) return;
            const vertices = mesh.geometry.getAttribute('position');
            if (!vertices) return;
            for (let i = 0; i < vertices.count; i++) {
              point.fromBufferAttribute(vertices, i).applyMatrix4(mesh.matrixWorld);
              const { x, y, z } = point;
              // A arquitetura de anexos está dezenas de metros distante desta peça isolada.
              if (Math.abs(x) > 2 || Math.abs(z) > 2) continue;
              const localX = Math.cos(yaw) * x - Math.sin(yaw) * z;
              const localZ = Math.sin(yaw) * x + Math.cos(yaw) * z;
              expect(Math.abs(localX)).toBeLessThanOrEqual(dimensions.width / 2 + 1e-4);
              expect(Math.abs(localZ)).toBeLessThanOrEqual(dimensions.depth / 2 + 1e-4);
              expect(y).toBeGreaterThanOrEqual(-1e-4);
              expect(y).toBeLessThanOrEqual(dimensions.height + 1e-4);
              count++;
            }
          });
          expect(count).toBeGreaterThan(500);
        } finally { controller.dispose(); resetThemedRoomLocks(); }
      }
    }
  });
});
