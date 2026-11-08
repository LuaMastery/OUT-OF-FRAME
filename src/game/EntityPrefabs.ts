import * as THREE from 'three';
import { EntityId } from '../engine/ecs/types';
import { World } from '../engine/ecs/World';
import {
  CrystalTarget,
  EphemeralShard,
  FrameCapturable,
  Kinematics,
  Projectile,
  ProjectileFaction,
  Renderable,
  Transform,
  TurretEmitter,
} from './components';

const sharedBulletGeo = new THREE.OctahedronGeometry(0.11, 0);
const sharedCubeGeo = new THREE.BoxGeometry(0.75, 0.75, 0.75);
const sharedCoreGeo = new THREE.OctahedronGeometry(0.46, 0);
const sharedShardGeo = new THREE.TetrahedronGeometry(0.16, 0);

const matEnemyBullet = new THREE.MeshBasicMaterial({ color: 0xff1e2d });
const matPlayerBullet = new THREE.MeshBasicMaterial({ color: 0x111318 });
const matReprojectedBullet = new THREE.MeshBasicMaterial({ color: 0x00d2ff });

const matCrystalSentinel = new THREE.MeshStandardMaterial({
  color: 0xe6192e,
  emissive: 0x52000a,
  roughness: 0.18,
  metalness: 0.12,
  flatShading: true,
});

const matExplosiveCore = new THREE.MeshStandardMaterial({
  color: 0xff5500,
  emissive: 0x771800,
  roughness: 0.15,
  metalness: 0.2,
  flatShading: true,
});

const matKineticCube = new THREE.MeshStandardMaterial({
  color: 0x171a21,
  roughness: 0.3,
  metalness: 0.55,
});

export function getProjectileMaterial(faction: ProjectileFaction): THREE.Material {
  if (faction === 'player') return matPlayerBullet;
  if (faction === 'reprojected') return matReprojectedBullet;
  return matEnemyBullet;
}

export function getTrailColor(faction: ProjectileFaction): number {
  if (faction === 'player') return 0x222630;
  if (faction === 'reprojected') return 0x00c8ff;
  return 0xff2a3a;
}

/**
 * Cria um projétil físico com rastro vetorial contínuo (capturável pela Moldura!).
 */
export function spawnProjectile(
  world: World,
  scene: THREE.Scene,
  origin: THREE.Vector3,
  velocity: THREE.Vector3,
  faction: ProjectileFaction,
  bouncesLeft = 1
): EntityId {
  const e = world.createEntity();

  const mesh = new THREE.Mesh(sharedBulletGeo, getProjectileMaterial(faction));
  mesh.scale.set(0.85, 0.85, 2.35);

  const quat = new THREE.Quaternion();
  if (velocity.lengthSq() > 1e-5) {
    const dir = velocity.clone().normalize();
    const m = new THREE.Matrix4().lookAt(new THREE.Vector3(), dir, new THREE.Vector3(0, 1, 0));
    quat.setFromRotationMatrix(m);
  }

  mesh.position.copy(origin);
  mesh.quaternion.copy(quat);
  scene.add(mesh);

  // Linha de rastro balístico estilo Superhot
  const trailHistory = [origin.clone(), origin.clone()];
  const trailGeo = new THREE.BufferGeometry().setFromPoints(trailHistory);
  const trailMat = new THREE.LineBasicMaterial({
    color: getTrailColor(faction),
    transparent: true,
    opacity: 0.72,
  });
  const trailMesh = new THREE.Line(trailGeo, trailMat);
  trailMesh.frustumCulled = false;
  scene.add(trailMesh);

  world.add(e, Transform, {
    prevPosition: origin.clone(),
    position: origin.clone(),
    prevQuaternion: quat.clone(),
    quaternion: quat.clone(),
    scale: new THREE.Vector3(0.85, 0.85, 2.35),
  });

  world.add(e, Kinematics, {
    velocity: velocity.clone(),
    angularVelocity: new THREE.Vector3(0, 0, 8),
    gravity: 0,
    drag: 0,
    restitution: 1.0,
    radius: 0.12,
    groundFriction: 0,
  });

  world.add(e, Renderable, {
    object3d: mesh,
    disposeGeometry: false,
    disposeMaterial: false,
  });

  world.add(e, Projectile, {
    faction,
    ttl: 8.5,
    bouncesLeft,
    trailHistory,
    trailMesh,
  });

  world.add(e, FrameCapturable, {
    kind: 'projectile',
    label: faction === 'enemy' ? 'Projétil Hostil' : 'Projétil Cinético',
    boundingRadius: 0.24,
  });

  return e;
}

/**
 * Cria uma Sentinela Cristalina facetada (alvo humanóide minimalista vermelho de alto contraste).
 * Pode disparar periodicamente contra o jogador ou atuar como alvo estático de calibração.
 */
export function spawnCrystalSentinel(
  world: World,
  scene: THREE.Scene,
  position: THREE.Vector3,
  options: {
    stationId: string;
    armed?: boolean;
    trackPlayer?: boolean;
    fireDirection?: THREE.Vector3;
    fireInterval?: number;
    projectileSpeed?: number;
    respawn?: boolean;
  }
): EntityId {
  const e = world.createEntity();

  const group = new THREE.Group();

  // Torso facetado estilo cristal vermelho
  const torsoGeo = new THREE.OctahedronGeometry(0.52, 0);
  const torso = new THREE.Mesh(torsoGeo, matCrystalSentinel);
  torso.position.set(0, 1.18, 0);
  torso.scale.set(0.82, 1.38, 0.58);
  group.add(torso);

  // Cabeça icosaédrica facetada
  const headGeo = new THREE.IcosahedronGeometry(0.27, 0);
  const head = new THREE.Mesh(headGeo, matCrystalSentinel);
  head.position.set(0, 1.98, 0);
  group.add(head);

  // Pedestal/pernas angulares
  const legGeo = new THREE.ConeGeometry(0.32, 0.78, 5);
  const base = new THREE.Mesh(legGeo, matCrystalSentinel);
  base.position.set(0, 0.42, 0);
  base.rotation.x = Math.PI;
  group.add(base);

  if (options.armed) {
    // Indicador escuro de emissor balístico no peito/braço
    const barrel = new THREE.Mesh(
      new THREE.BoxGeometry(0.14, 0.14, 0.52),
      matKineticCube
    );
    barrel.position.set(0.28, 1.32, -0.32);
    group.add(barrel);
  }

  group.position.copy(position);
  scene.add(group);

  world.add(e, Transform, {
    prevPosition: position.clone(),
    position: position.clone(),
    prevQuaternion: new THREE.Quaternion(),
    quaternion: new THREE.Quaternion(),
    scale: new THREE.Vector3(1, 1, 1),
  });

  world.add(e, Kinematics, {
    velocity: new THREE.Vector3(),
    angularVelocity: new THREE.Vector3(),
    gravity: 19.0,
    drag: 2.2,
    restitution: 0.12,
    radius: 0.48,
    groundFriction: 7.5,
  });

  world.add(e, Renderable, {
    object3d: group,
    disposeGeometry: true,
    disposeMaterial: false,
  });

  world.add(e, CrystalTarget, {
    stationId: options.stationId,
    shardCount: 22,
    color: 0xe6192e,
    respawnAnchor: options.respawn ? position.clone() : undefined,
  });

  world.add(e, FrameCapturable, {
    kind: 'sentinel',
    label: options.armed ? 'Sentinela Armada' : 'Sentinela Cristalina',
    boundingRadius: 0.95,
  });

  if (options.armed) {
    world.add(e, TurretEmitter, {
      cooldown: options.fireInterval ? options.fireInterval * 0.45 : 0.8,
      interval: options.fireInterval ?? 1.85,
      fireDirection: (options.fireDirection ?? new THREE.Vector3(0, 0, 1)).clone().normalize(),
      trackPlayer: options.trackPlayer ?? true,
      projectileSpeed: options.projectileSpeed ?? 15.5,
      muzzleOffset: new THREE.Vector3(0, 1.34, 0),
      enabled: true,
    });
  }

  return e;
}

/**
 * Cria um Cubo Cinético de Obsidiana (ou Prisma Explosivo) para testes de captura espacial.
 */
export function spawnKineticProp(
  world: World,
  scene: THREE.Scene,
  position: THREE.Vector3,
  isExplosiveCore = false
): EntityId {
  const e = world.createEntity();

  let mesh: THREE.Object3D;
  if (isExplosiveCore) {
    mesh = new THREE.Mesh(sharedCoreGeo, matExplosiveCore);
  } else {
    const group = new THREE.Group();
    const box = new THREE.Mesh(sharedCubeGeo, matKineticCube);
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(sharedCubeGeo),
      new THREE.LineBasicMaterial({ color: 0x00d2ff })
    );
    group.add(box, edges);
    mesh = group;
  }

  mesh.position.copy(position);
  scene.add(mesh);

  world.add(e, Transform, {
    prevPosition: position.clone(),
    position: position.clone(),
    prevQuaternion: new THREE.Quaternion(),
    quaternion: new THREE.Quaternion(),
    scale: new THREE.Vector3(1, 1, 1),
  });

  world.add(e, Kinematics, {
    velocity: new THREE.Vector3(),
    angularVelocity: isExplosiveCore
      ? new THREE.Vector3(0.4, 1.2, 0.2)
      : new THREE.Vector3(),
    gravity: isExplosiveCore ? 0 : 19.0,
    drag: isExplosiveCore ? 0.8 : 0.6,
    restitution: 0.45,
    radius: 0.42,
    groundFriction: 5.2,
  });

  world.add(e, Renderable, {
    object3d: mesh,
    disposeGeometry: false,
    disposeMaterial: false,
  });

  world.add(e, FrameCapturable, {
    kind: isExplosiveCore ? 'core' : 'cube',
    label: isExplosiveCore ? 'Núcleo Instável' : 'Cubo Cinético',
    boundingRadius: 0.52,
  });

  if (isExplosiveCore) {
    world.add(e, CrystalTarget, {
      stationId: 'station-props',
      shardCount: 28,
      color: 0xff5500,
      isExplosiveCore: true,
      respawnAnchor: position.clone(),
    });
  }

  return e;
}

/**
 * Gera estilhaços cristalinos 3D procedurais que obedecem ao `simDt` (flutuam no ar em câmera lenta!).
 */
export function spawnCrystalShards(
  world: World,
  scene: THREE.Scene,
  center: THREE.Vector3,
  impulseDirection: THREE.Vector3,
  count: number,
  colorHex: number
): void {
  const mat = new THREE.MeshStandardMaterial({
    color: colorHex,
    emissive: new THREE.Color(colorHex).multiplyScalar(0.28),
    roughness: 0.15,
    metalness: 0.1,
    flatShading: true,
  });

  for (let i = 0; i < count; i++) {
    const e = world.createEntity();

    const offset = new THREE.Vector3(
      (Math.random() - 0.5) * 0.65,
      Math.random() * 1.4 + 0.25,
      (Math.random() - 0.5) * 0.65
    );
    const spawnPos = center.clone().add(offset);

    const s = 0.65 + Math.random() * 1.15;
    const mesh = new THREE.Mesh(sharedShardGeo, mat);
    mesh.scale.set(s, s * (0.6 + Math.random() * 0.9), s);
    mesh.position.copy(spawnPos);
    scene.add(mesh);

    const randomSpread = new THREE.Vector3(
      (Math.random() - 0.5) * 8.5,
      Math.random() * 6.2 + 1.5,
      (Math.random() - 0.5) * 8.5
    );
    const vel = randomSpread.addScaledVector(impulseDirection, 4.5 + Math.random() * 5.0);

    const quat = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(Math.random() * 6, Math.random() * 6, Math.random() * 6)
    );

    world.add(e, Transform, {
      prevPosition: spawnPos.clone(),
      position: spawnPos.clone(),
      prevQuaternion: quat.clone(),
      quaternion: quat.clone(),
      scale: mesh.scale.clone(),
    });

    world.add(e, Kinematics, {
      velocity: vel,
      angularVelocity: new THREE.Vector3(
        (Math.random() - 0.5) * 14,
        (Math.random() - 0.5) * 14,
        (Math.random() - 0.5) * 14
      ),
      gravity: 14.5,
      drag: 0.5,
      restitution: 0.48,
      radius: 0.12,
      groundFriction: 4.0,
    });

    world.add(e, Renderable, {
      object3d: mesh,
      disposeGeometry: false,
      disposeMaterial: i === count - 1, // compartilha material no lote
    });

    world.add(e, EphemeralShard, {
      age: 0,
      maxAge: 4.5 + Math.random() * 2.5,
      initialScale: s,
    });
  }
}
