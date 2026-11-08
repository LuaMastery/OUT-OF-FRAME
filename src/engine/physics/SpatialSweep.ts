import * as THREE from 'three';

export interface StaticColliderBox {
  id: string;
  box: THREE.Box3;
  /** Se verdadeiro, reflete projéteis em vez de absorvê-los (painéis defletores de calibração) */
  reflective?: boolean;
}

export interface SweepHit {
  /** Fração paramétrica t em [0..1] ao longo do segmento [start -> end] */
  t: number;
  point: THREE.Vector3;
  normal: THREE.Vector3;
  collider?: StaticColliderBox;
}

const EPS = 1e-6;

/**
 * Interseção exata de segmento varrido (Slab Method / Kay-Kajiya) contra AABB expandido por raio.
 * Evita 100% de tunneling balístico mesmo em velocidades altas ou alvos finos.
 */
export function sweepSegmentVsBox(
  start: THREE.Vector3,
  end: THREE.Vector3,
  box: THREE.Box3,
  radius = 0
): SweepHit | null {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const dz = end.z - start.z;

  const minX = box.min.x - radius;
  const maxX = box.max.x + radius;
  const minY = box.min.y - radius;
  const maxY = box.max.y + radius;
  const minZ = box.min.z - radius;
  const maxZ = box.max.z + radius;

  let tMin = 0;
  let tMax = 1;
  let hitAxis = 0;
  let hitSign = 0;

  // Eixo X
  if (Math.abs(dx) < EPS) {
    if (start.x < minX || start.x > maxX) return null;
  } else {
    const inv = 1 / dx;
    let t1 = (minX - start.x) * inv;
    let t2 = (maxX - start.x) * inv;
    let sign = -1;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
      sign = 1;
    }
    if (t1 > tMin) {
      tMin = t1;
      hitAxis = 0;
      hitSign = sign;
    }
    if (t2 < tMax) tMax = t2;
    if (tMin > tMax) return null;
  }

  // Eixo Y
  if (Math.abs(dy) < EPS) {
    if (start.y < minY || start.y > maxY) return null;
  } else {
    const inv = 1 / dy;
    let t1 = (minY - start.y) * inv;
    let t2 = (maxY - start.y) * inv;
    let sign = -1;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
      sign = 1;
    }
    if (t1 > tMin) {
      tMin = t1;
      hitAxis = 1;
      hitSign = sign;
    }
    if (t2 < tMax) tMax = t2;
    if (tMin > tMax) return null;
  }

  // Eixo Z
  if (Math.abs(dz) < EPS) {
    if (start.z < minZ || start.z > maxZ) return null;
  } else {
    const inv = 1 / dz;
    let t1 = (minZ - start.z) * inv;
    let t2 = (maxZ - start.z) * inv;
    let sign = -1;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
      sign = 1;
    }
    if (t1 > tMin) {
      tMin = t1;
      hitAxis = 2;
      hitSign = sign;
    }
    if (t2 < tMax) tMax = t2;
    if (tMin > tMax) return null;
  }

  const normal = new THREE.Vector3(
    hitAxis === 0 ? hitSign : 0,
    hitAxis === 1 ? hitSign : 0,
    hitAxis === 2 ? hitSign : 0
  );

  // Caso o ponto inicial já estivesse levemente dentro da caixa expandida, empurra normal pelo eixo mais raso
  if (normal.lengthSq() === 0) {
    normal.set(0, 1, 0);
  }

  const point = new THREE.Vector3(
    start.x + dx * tMin,
    start.y + dy * tMin,
    start.z + dz * tMin
  );

  return { t: tMin, point, normal };
}

/**
 * Interseção contínua de segmento [start -> end] contra esfera móvel/estática de raio combinado.
 */
export function sweepSegmentVsSphere(
  start: THREE.Vector3,
  end: THREE.Vector3,
  center: THREE.Vector3,
  combinedRadius: number
): SweepHit | null {
  const d = new THREE.Vector3().subVectors(end, start);
  const f = new THREE.Vector3().subVectors(start, center);

  const a = d.dot(d);
  if (a < EPS) {
    if (f.lengthSq() <= combinedRadius * combinedRadius) {
      const normal =
        f.lengthSq() > EPS ? f.clone().normalize() : new THREE.Vector3(0, 1, 0);
      return { t: 0, point: start.clone(), normal };
    }
    return null;
  }

  const b = 2 * f.dot(d);
  const c = f.dot(f) - combinedRadius * combinedRadius;

  if (c <= 0) {
    const normal =
      f.lengthSq() > EPS ? f.clone().normalize() : d.clone().negate().normalize();
    return { t: 0, point: start.clone(), normal };
  }

  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;

  const sqrtDisc = Math.sqrt(disc);
  const t = (-b - sqrtDisc) / (2 * a);
  if (t < 0 || t > 1) return null;

  const point = start.clone().addScaledVector(d, t);
  const normal = point.clone().sub(center).normalize();
  return { t, point, normal };
}

/**
 * Varre um segmento contra todos os colisores estáticos do cenário e retorna o impacto mais próximo.
 */
export function sweepStaticWorld(
  start: THREE.Vector3,
  end: THREE.Vector3,
  colliders: readonly StaticColliderBox[],
  radius = 0
): SweepHit | null {
  let closest: SweepHit | null = null;
  for (let i = 0; i < colliders.length; i++) {
    const col = colliders[i];
    const hit = sweepSegmentVsBox(start, end, col.box, radius);
    if (hit && (closest === null || hit.t < closest.t)) {
      hit.collider = col;
      closest = hit;
    }
  }
  return closest;
}

/**
 * Verifica se há linha de visão desobstruída entre dois pontos (usado pelo recorte da Moldura
 * para não capturar objetos atrás de paredes opacas).
 */
export function hasLineOfSight(
  eye: THREE.Vector3,
  target: THREE.Vector3,
  colliders: readonly StaticColliderBox[]
): boolean {
  const hit = sweepStaticWorld(eye, target, colliders, 0);
  return hit === null || hit.t >= 0.985;
}

/**
 * Resolve colisão cilindro/AABB horizontal e vertical para o corpo do jogador ou caixas físicas.
 */
export function resolveCylinderWorldCollisions(
  position: THREE.Vector3,
  velocity: THREE.Vector3,
  radius: number,
  height: number,
  colliders: readonly StaticColliderBox[]
): { grounded: boolean } {
  let grounded = false;

  for (let i = 0; i < colliders.length; i++) {
    const box = colliders[i].box;
    const footY = position.y;
    const headY = position.y + height;

    // Sem sobreposição vertical? Ignora
    if (headY <= box.min.y || footY >= box.max.y) continue;

    // Ponto mais próximo no plano XZ dentro do AABB
    const closestX = Math.max(box.min.x, Math.min(position.x, box.max.x));
    const closestZ = Math.max(box.min.z, Math.min(position.z, box.max.z));

    const dx = position.x - closestX;
    const dz = position.z - closestZ;
    const distSq = dx * dx + dz * dz;

    if (distSq >= radius * radius) continue;

    // Verifica se a penetração vertical (pisar no topo / bater cabeça) é menor que a lateral
    const overlapTop = box.max.y - footY;
    const overlapBottom = headY - box.min.y;
    const dist = Math.sqrt(distSq);
    const lateralPenetration =
      dist > EPS
        ? radius - dist
        : Math.min(
            position.x - box.min.x,
            box.max.x - position.x,
            position.z - box.min.z,
            box.max.z - position.z
          ) + radius;

    if (overlapTop > 0 && overlapTop < 0.42 && overlapTop < lateralPenetration && velocity.y <= 0.05) {
      position.y = box.max.y;
      if (velocity.y < 0) velocity.y = 0;
      grounded = true;
      continue;
    }

    if (overlapBottom > 0 && overlapBottom < 0.35 && overlapBottom < lateralPenetration && velocity.y > 0) {
      position.y = box.min.y - height;
      velocity.y = 0;
      continue;
    }

    // Empurrão lateral no plano XZ
    if (dist > EPS) {
      const nx = dx / dist;
      const nz = dz / dist;
      const push = radius - dist;
      position.x += nx * push;
      position.z += nz * push;
      const vn = velocity.x * nx + velocity.z * nz;
      if (vn < 0) {
        velocity.x -= vn * nx;
        velocity.z -= vn * nz;
      }
    } else {
      // Centro exatamente dentro do AABB em XZ: expulsa pela menor borda
      const dLeft = Math.abs(position.x - box.min.x);
      const dRight = Math.abs(box.max.x - position.x);
      const dBack = Math.abs(position.z - box.min.z);
      const dFront = Math.abs(box.max.z - position.z);
      const minD = Math.min(dLeft, dRight, dBack, dFront);
      if (minD === dLeft) position.x = box.min.x - radius;
      else if (minD === dRight) position.x = box.max.x + radius;
      else if (minD === dBack) position.z = box.min.z - radius;
      else position.z = box.max.z + radius;
    }
  }

  // Piso global de segurança y = 0
  if (position.y <= 0) {
    position.y = 0;
    if (velocity.y < 0) velocity.y = 0;
    grounded = true;
  }

  return { grounded };
}
