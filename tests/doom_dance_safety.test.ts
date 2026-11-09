import * as THREE from 'three';
import { OBB } from 'three/examples/jsm/math/OBB.js';
import { describe, expect, it } from 'vitest';
import { DoomAstronaut, type AstronautArmRig } from '../src/doom/DoomAstronaut';
import { computeDoomDancePose, DOOM_DANCES, getDoomDanceDefinition, type DoomDanceId } from '../src/doom/DoomDance';
import { createDoomSharedUniforms } from '../src/doom/DoomShader';

// Perfis que geram as malhas reais do traje: testa o interior, com 1% de
// tolerância na superfície para as faces facetadas e para junções seladas.
const TORSO = [[-.04,.165],[.04,.228],[.17,.252],[.31,.254],[.43,.23],[.51,.198]];
const BACK = [[-.31,.001],[-.27,.135],[-.15,.198],[.02,.208],[.17,.192],[.26,.132],[.3,.001]];
const HOOD = [[-.16,.202],[-.05,.196],[.06,.19],[.155,.174],[.21,.122],[.232,.001]];
function radiusAt(y: number, points: number[][]): number {
  for (let i = 1; i < points.length; i++) {
    const [y0, r0] = points[i - 1], [y1, r1] = points[i];
    if (y >= y0 && y <= y1) return r0 + (r1 - r0) * (y - y0) / (y1 - y0);
  }
  return 0;
}
function meshesOf(root: THREE.Object3D): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = [];
  root.traverse(obj => { if ((obj as THREE.Mesh).isMesh) meshes.push(obj as THREE.Mesh); });
  return meshes;
}
function poseDuration(id: DoomDanceId): number {
  return (60 / getDoomDanceDefinition(id).bpm) * (id === 'robot' ? 8 : id === 'spin' ? 4 : 2);
}

/** Inspeciona os vértices das mangas e de todos os dedos contra os volumes do próprio rig. */
function armIntrusion(astronaut: DoomAstronaut, arm: AstronautArmRig): string | null {
  const torsoInverse = astronaut.torsoGroup.matrixWorld.clone().invert();
  const hipsInverse = astronaut.hipsGroup.matrixWorld.clone().invert();
  const headInverse = astronaut.headGroup.matrixWorld.clone().invert();
  const shoulderInverse = arm.shoulderPivot.matrixWorld.clone().invert();
  const legMeshes = ['AstronautLeftLeg', 'AstronautRightLeg'].flatMap(name =>
    meshesOf(astronaut.root.getObjectByName(name)!).filter(m =>
      m.geometry.type === 'CylinderGeometry' &&
      (m.parent?.name.endsWith('Leg') || m.parent?.name.endsWith('Knee'))
    )
  );
  const legInverses = legMeshes.map(m => m.matrixWorld.clone().invert());
  const point = new THREE.Vector3(), p = new THREE.Vector3();
  for (const group of [arm.upperArmGroup, arm.forearmGroup, arm.gloveGroup]) {
    for (const mesh of meshesOf(group)) {
      const vertices = mesh.geometry.getAttribute('position');
      const toTorso = new THREE.Matrix4().multiplyMatrices(torsoInverse, mesh.matrixWorld);
      const toHips = new THREE.Matrix4().multiplyMatrices(hipsInverse, mesh.matrixWorld);
      const toHead = new THREE.Matrix4().multiplyMatrices(headInverse, mesh.matrixWorld);
      const toShoulder = new THREE.Matrix4().multiplyMatrices(shoulderInverse, mesh.matrixWorld);
      const toLeg = legInverses.map(inv => new THREE.Matrix4().multiplyMatrices(inv, mesh.matrixWorld));
      for (let i = 0; i < vertices.count; i++) {
        point.fromBufferAttribute(vertices, i);
        // A tampa esférica do ombro fica integrada ao tronco por projeto.
        if (group === arm.upperArmGroup && p.copy(point).applyMatrix4(toShoulder).y > -.10) continue;
        p.copy(point).applyMatrix4(toTorso);
        let r = radiusAt(p.y, TORSO);
        if (r > 0 && Math.hypot(p.x / (r * 1.06), p.z / (r * .96)) < .99) return `${arm.side}: tronco`;
        r = radiusAt(p.y - .25, BACK);
        if (r > 0 && Math.hypot(p.x / (r * 1.12), (p.z - .155) / (r * .95)) < .99) return `${arm.side}: mochila`;
        p.copy(point).applyMatrix4(toHips);
        if (Math.hypot(p.x / .21168, (p.y + .02) / .15288, p.z / .18424) < .99) return `${arm.side}: quadril`;
        p.copy(point).applyMatrix4(toHead);
        r = radiusAt(p.y, HOOD);
        if (r > 0 && Math.hypot(p.x / (r * 1.01), p.z / (r * 1.08)) < .99) return `${arm.side}: capuz`;
        for (let j = 0; j < legMeshes.length; j++) {
          p.copy(point).applyMatrix4(toLeg[j]);
          const { height, radiusBottom, radiusTop } = (legMeshes[j].geometry as THREE.CylinderGeometry).parameters;
          const legRadius = radiusBottom + (radiusTop - radiusBottom) * (p.y / height + .5);
          if (Math.abs(p.y) < height / 2 && Math.hypot(p.x, p.z) < legRadius * .99) return `${arm.side}: perna`;
        }
      }
    }
  }
  return null;
}

function bootBounds(astronaut: DoomAstronaut): { lowest: number; boots: OBB[] } {
  let lowest = Infinity;
  const boots = ['AstronautLeftBoot', 'AstronautRightBoot'].map(name => {
    const boot = astronaut.root.getObjectByName(name)!;
    for (const mesh of meshesOf(boot)) {
      const box = mesh.geometry.boundingBox!;
      for (let i = 0; i < 8; i++) {
        const point = new THREE.Vector3(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).applyMatrix4(mesh.matrixWorld);
        lowest = Math.min(lowest, point.y);
      }
    }
    // Envolve a galocha inteira (sola, cano e biqueira), não apenas o pivô.
    return new OBB(new THREE.Vector3(0, -.04375, -.0645), new THREE.Vector3(.073, .07125, .1305)).applyMatrix4(boot.matrixWorld);
  });
  return { lowest, boots };
}

describe('Segurança das seis coreografias no traje 3D', () => {
  it('mantém mangas, antebraços e mãos fora do tronco, capuz, mochila, quadril e pernas ao longo de cada ciclo', () => {
    const astronaut = new DoomAstronaut(new THREE.Scene(), createDoomSharedUniforms());
    for (const dance of DOOM_DANCES) {
      const steps = Math.ceil(poseDuration(dance.id) * 60);
      for (let frame = 0; frame <= steps; frame++) {
        const t = poseDuration(dance.id) * frame / steps;
        astronaut.applyDancePose(computeDoomDancePose(dance.id, t), new THREE.Vector3(3, 0, -6), .7);
        astronaut.root.updateMatrixWorld(true);
        const collision = armIntrusion(astronaut, astronaut.leftArm) ?? armIntrusion(astronaut, astronaut.rightArm);
        expect(collision, `${dance.id} em ${t.toFixed(3)}s`).toBeNull();
      }
    }
  }, 30000);

  it('mantém as galochas separadas, acima do piso correto e com um pé apoiado em todas as danças', () => {
    const astronaut = new DoomAstronaut(new THREE.Scene(), createDoomSharedUniforms());
    for (const dance of DOOM_DANCES) {
      const duration = poseDuration(dance.id);
      const steps = Math.ceil(duration * 60);
      for (let frame = 0; frame <= steps; frame++) {
        const t = duration * frame / steps;
        const floorY = frame % 2 ? 2.75 : 0;
        astronaut.applyDancePose(computeDoomDancePose(dance.id, t), new THREE.Vector3(3, floorY, -6), .7);
        astronaut.root.updateMatrixWorld(true);
        const { lowest, boots } = bootBounds(astronaut);
        expect(Math.abs(lowest - floorY), `${dance.id} piso em ${t.toFixed(3)}s`).toBeLessThan(.001);
        expect(boots[0].intersectsOBB(boots[1]), `${dance.id} galochas em ${t.toFixed(3)}s`).toBe(false);
        const knees = ['AstronautLeftKnee', 'AstronautRightKnee'].map(name => astronaut.root.getObjectByName(name)!.getWorldPosition(new THREE.Vector3()));
        expect(knees[0].distanceTo(knees[1]), `${dance.id} joelhos em ${t.toFixed(3)}s`).toBeGreaterThan(.19);
      }
    }
  }, 30000);

  it('mantém as transições contínuas sem saltos bruscos das articulações ou do pé de apoio', () => {
    const astronaut = new DoomAstronaut(new THREE.Scene(), createDoomSharedUniforms());
    for (const dance of DOOM_DANCES) {
      let previous: number[] | null = null;
      let previousHeight: number | null = null;
      for (let frame = 0; frame <= Math.ceil(poseDuration(dance.id) * 120); frame++) {
        const t = frame / 120;
        const pose = computeDoomDancePose(dance.id, t);
        const joints = [pose.leftArm.shoulder.x, pose.leftArm.shoulder.z, pose.rightArm.shoulder.x,
          pose.rightArm.shoulder.z, pose.leftArm.elbow, pose.rightArm.elbow, pose.leftLeg.hip.x,
          pose.rightLeg.hip.x, pose.leftLeg.knee, pose.rightLeg.knee, pose.leftLeg.ankle, pose.rightLeg.ankle];
        if (previous) for (let i = 0; i < joints.length; i++)
          expect(Math.abs(joints[i] - previous[i]), `${dance.id} articulação em ${t.toFixed(3)}s`).toBeLessThan(.35);
        previous = joints;
        astronaut.applyDancePose(pose, new THREE.Vector3(), 0);
        if (previousHeight !== null)
          expect(Math.abs(astronaut.bodyPivot.position.y - previousHeight), `${dance.id} apoio em ${t.toFixed(3)}s`).toBeLessThan(.025);
        previousHeight = astronaut.bodyPivot.position.y;
      }
    }
  });

});
