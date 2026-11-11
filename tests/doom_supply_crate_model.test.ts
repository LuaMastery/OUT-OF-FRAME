import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createRandomArenaLayout } from '../src/doom/DoomArenaRandomizer';
import { createDoomSharedUniforms } from '../src/doom/DoomShader';
import { CRATE_LID_OPEN_ROTATION, DoomWorldItems } from '../src/doom/DoomWorldItems';

interface CratePart {
  name: string;
  box: THREE.Box3;
  obj: THREE.Mesh;
}

/**
 * Caixote montado no espaço LOCAL da caixa (sem o giro da sala), para medir as
 * peças exatamente como elas foram modeladas.
 */
function collectParts(root: THREE.Object3D): CratePart[] {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const out: CratePart[] = [];
  root.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh || !node.name.startsWith('Supply')) return;
    mesh.geometry.computeBoundingBox();
    const local = new THREE.Matrix4().multiplyMatrices(inv, mesh.matrixWorld);
    out.push({
      name: node.name,
      box: mesh.geometry.boundingBox!.clone().applyMatrix4(local),
      obj: mesh,
    });
  });
  return out;
}

/** Área de interseção de dois retângulos paralelos aos eixos. */
function rectangleOverlap(
  aMin: THREE.Vector3,
  aMax: THREE.Vector3,
  bMin: THREE.Vector3,
  bMax: THREE.Vector3,
  axis: number
): number {
  const [u, v] = [0, 1, 2].filter((k) => k !== axis);
  let area = 1;
  for (const k of [u, v]) {
    const lo = Math.max(aMin.getComponent(k), bMin.getComponent(k));
    const hi = Math.min(aMax.getComponent(k), bMax.getComponent(k));
    if (hi - lo <= 1e-6) return 0;
    area *= hi - lo;
  }
  return area;
}

/**
 * Duas peças com a MESMA face no MESMO plano e voltadas para o mesmo lado
 * cintilam na tela (z-fighting). Faces opostas são inofensivas: uma delas é
 * descartada pelo backface culling.
 */
function findZFightingPairs(parts: CratePart[]): string[] {
  const issues: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    for (let j = i + 1; j < parts.length; j++) {
      const a = parts[i].box;
      const b = parts[j].box;
      for (let axis = 0; axis < 3; axis++) {
        for (const side of ['min', 'max'] as const) {
          const pa = side === 'min' ? a.min.getComponent(axis) : a.max.getComponent(axis);
          const pb = side === 'min' ? b.min.getComponent(axis) : b.max.getComponent(axis);
          if (Math.abs(pa - pb) > 1e-6) continue;
          const area = rectangleOverlap(a.min, a.max, b.min, b.max, axis);
          if (area > 1e-5) {
            issues.push(
              `${parts[i].name} x ${parts[j].name} @ eixo${axis}.${side}=${pa.toFixed(3)} (${area.toFixed(4)} m²)`
            );
          }
        }
      }
    }
  }
  return issues;
}

/** Peça que não encosta em nada nem no suporte fica boiando no mundo. */
function findFloatingParts(parts: CratePart[]): string[] {
  const touching = (a: THREE.Box3, b: THREE.Box3): boolean =>
    a.min.x <= b.max.x + 1e-4 && a.max.x >= b.min.x - 1e-4 &&
    a.min.y <= b.max.y + 1e-4 && a.max.y >= b.min.y - 1e-4 &&
    a.min.z <= b.max.z + 1e-4 && a.max.z >= b.min.z - 1e-4;
  const floorY = Math.min(...parts.map((p) => p.box.min.y));
  return parts
    .filter((part) => {
      if (Math.abs(part.box.min.y - floorY) <= 1e-4) return false;
      return !parts.some((other) => other !== part && touching(part.box, other.box));
    })
    .map((part) => part.name);
}

function buildCrate(): { crate: THREE.Object3D; lid: THREE.Object3D } {
  const layout = createRandomArenaLayout({ worldSeed: 42, playerSeed: 7 });
  const scene = new THREE.Scene();
  new DoomWorldItems(scene, createDoomSharedUniforms(), layout);
  const crate = scene.getObjectByName('SupplyLocation_0')!.getObjectByName('SupplyCrate')!;
  return { crate, lid: crate.getObjectByName('SupplyLid')! };
}

/** Vão livre onde os itens viajam dentro do caixote fechado. */
const CAVITY = new THREE.Box3(
  new THREE.Vector3(-0.2149, 0.0941, -0.1649),
  new THREE.Vector3(0.2149, 0.1849, 0.1649)
);

describe('Modelagem do caixote de suprimentos lacrado', () => {
  it('não tem faces no mesmo plano nem peças boiando', () => {
    const { crate } = buildCrate();
    const parts = collectParts(crate);
    expect(parts.length).toBeGreaterThan(20);
    expect(findZFightingPairs(parts)).toEqual([]);
    expect(findFloatingParts(parts)).toEqual([]);
  });

  it('mantém o vão dos itens livre e a portinhola vedando a boca do baú', () => {
    const { crate } = buildCrate();
    const parts = collectParts(crate);
    for (const part of parts) {
      if (part.name === 'SupplyLiner') continue; // o forro é o piso do vão
      expect(
        part.box.clone().intersect(CAVITY).isEmpty(),
        `${part.name} invade o vão dos itens`
      ).toBe(true);
    }

    // Portinhola fechada: assentada na boca (0.185) e cobrindo toda a área de cima.
    const panel = parts.find((p) => p.name === 'SupplyLidPanel')!.box;
    expect(panel.min.y).toBeCloseTo(0.185, 4);
    expect(panel.max.y).toBeCloseTo(0.209, 4);
    expect(panel.min.x).toBeCloseTo(-0.26, 4);
    expect(panel.max.x).toBeCloseTo(0.26, 4);
    expect(panel.min.z).toBeCloseTo(-0.21, 4);
    expect(panel.max.z).toBeCloseTo(0.21, 4);

    // A saia desce por fora das paredes: veda a emenda sem invadir o vão.
    const walls = parts.filter((p) => p.name === 'SupplyWall').map((p) => p.box);
    const skirts = parts.filter((p) => p.name === 'SupplyLidSkirt');
    expect(skirts).toHaveLength(3);
    for (const skirt of skirts) {
      expect(walls.some((w) => w.intersectsBox(skirt.box)), 'saia não encosta na parede').toBe(true);
      expect(skirt.box.clone().intersect(CAVITY).isEmpty(), 'saia invade o vão').toBe(true);
    }
  });

  it('abre a portinhola sem atravessar o corpo do caixote', () => {
    const { crate, lid } = buildCrate();
    lid.rotation.x = CRATE_LID_OPEN_ROTATION;
    crate.updateMatrixWorld(true);

    const body = collectParts(crate).filter((p) => p.obj.parent?.name !== 'SupplyLid');
    const inv = new THREE.Matrix4().copy(crate.matrixWorld).invert();
    const hits = new Set<string>();
    for (const part of collectParts(lid)) {
      const attr = part.obj.geometry.getAttribute('position');
      const local = new THREE.Matrix4().multiplyMatrices(inv, part.obj.matrixWorld);
      const v = new THREE.Vector3();
      for (let i = 0; i < attr.count; i++) {
        v.fromBufferAttribute(attr, i).applyMatrix4(local);
        for (const solid of body) {
          if (solid.box.containsPoint(v)) hits.add(`${part.name} -> ${solid.name}`);
        }
      }
    }
    expect([...hits]).toEqual([]);
  });
});
