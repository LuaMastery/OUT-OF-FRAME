import * as THREE from 'three';
import { World } from '../engine/ecs/World';
import { StaticColliderBox } from '../engine/physics/SpatialSweep';
import {
  Renderable,
  Transform,
  TurretEmitter,
} from './components';
import {
  spawnCrystalSentinel,
  spawnKineticProp,
} from './EntityPrefabs';

export interface ChamberBuildResult {
  colliders: StaticColliderBox[];
  spawnPoint: THREE.Vector3;
}

function createSignMesh(
  tag: string,
  title: string,
  subtitle: string,
  width = 4.6,
  height = 1.15
): THREE.Mesh {
  const canvas = document.createElement('canvas');
  canvas.width = 768;
  canvas.height = 192;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#111318';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = '#e6192e';
    ctx.fillRect(0, 0, 18, canvas.height);

    ctx.fillStyle = '#e6192e';
    ctx.font = '700 26px monospace';
    ctx.fillText(tag, 42, 52);

    ctx.fillStyle = '#f5f6f8';
    ctx.font = '800 44px system-ui, sans-serif';
    ctx.fillText(title, 42, 108);

    ctx.fillStyle = '#9aa1ae';
    ctx.font = '500 24px monospace';
    ctx.fillText(subtitle, 42, 152);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 4;
  const mat = new THREE.MeshBasicMaterial({ map: tex });
  return new THREE.Mesh(new THREE.PlaneGeometry(width, height), mat);
}

/**
 * Constrói a Sala de Testes ("Whitebox Calibration Chamber") com colisores estáticos AABB
 * e 3 estações dedicadas para validação do núcleo temporal + manipulação de moldura.
 */
export function buildTestChamber(
  world: World,
  scene: THREE.Scene,
  gridMaterial: THREE.ShaderMaterial
): ChamberBuildResult {
  const colliders: StaticColliderBox[] = [];
  const chamberGroup = new THREE.Group();
  chamberGroup.name = 'TestChamberArchitecture';
  scene.add(chamberGroup);

  const darkTrimMat = new THREE.MeshStandardMaterial({
    color: 0x161920,
    roughness: 0.35,
    metalness: 0.45,
  });

  const reflectorMat = new THREE.MeshStandardMaterial({
    color: 0x0b1924,
    emissive: 0x00384d,
    roughness: 0.08,
    metalness: 0.85,
  });

  const skylightMat = new THREE.MeshBasicMaterial({ color: 0xffffff });

  const addBlock = (
    id: string,
    cx: number,
    cy: number,
    cz: number,
    sx: number,
    sy: number,
    sz: number,
    mat: THREE.Material = gridMaterial,
    hasCollision = true,
    reflective = false
  ) => {
    const geo = new THREE.BoxGeometry(sx, sy, sz);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(cx, cy, cz);
    chamberGroup.add(mesh);

    if (hasCollision) {
      const half = new THREE.Vector3(sx * 0.5, sy * 0.5, sz * 0.5);
      const center = new THREE.Vector3(cx, cy, cz);
      colliders.push({
        id,
        box: new THREE.Box3(
          center.clone().sub(half),
          center.clone().add(half)
        ),
        reflective,
      });
    }
    return mesh;
  };

  // Piso e teto da câmara (34m x 36m)
  addBlock('floor', 0, -0.5, -2, 34, 1, 36, gridMaterial, false);
  addBlock('ceiling', 0, 9.2, -2, 34, 0.6, 36, gridMaterial, true);

  // Paredes perimetrais
  addBlock('wall-north', 0, 4.5, -20, 34, 9.5, 1, gridMaterial, true);
  addBlock('wall-south', 0, 4.5, 16, 34, 9.5, 1, gridMaterial, true);
  addBlock('wall-west', -17, 4.5, -2, 1, 9.5, 36, gridMaterial, true);
  addBlock('wall-east', 17, 4.5, -2, 1, 9.5, 36, gridMaterial, true);

  // Faixas luminosas arquitetônicas no teto
  for (const z of [-13, -5, 3, 11]) {
    addBlock(`skylight-${z}`, 0, 8.86, z, 22, 0.08, 0.9, skylightMat, false);
  }

  // Colunas estruturais minimalistas com base de obsidiana
  for (const x of [-8.5, 8.5]) {
    for (const z of [-10, 4]) {
      addBlock(`pillar-${x}-${z}`, x, 4.4, z, 1.1, 8.8, 1.1, gridMaterial, true);
      addBlock(`pillar-trim-${x}-${z}`, x, 0.15, z, 1.24, 0.3, 1.24, darkTrimMat, false);
    }
  }

  // Cobertura tática central baixa (permite abrigo e testes de linha de visão do Frustum)
  addBlock('central-cover-left', -3.2, 0.65, 1.5, 2.6, 1.3, 0.6, gridMaterial, true);
  addBlock('central-cover-right', 3.2, 0.65, 1.5, 2.6, 1.3, 0.6, gridMaterial, true);

  // ============================================================================
  // ESTAÇÃO 01 (NORTE / FRENTE): GALERIA TÁTICA & SENTINELAS CRISTALINAS
  // ============================================================================
  addBlock('st1-dais-center', 0, 0.4, -13.5, 4.2, 0.8, 3.2, gridMaterial, true);
  addBlock('st1-dais-left', -4.8, 0.75, -14.5, 2.8, 1.5, 2.8, gridMaterial, true);
  addBlock('st1-dais-right', 4.8, 0.75, -14.5, 2.8, 1.5, 2.8, gridMaterial, true);

  // Painel defletor espelhado (ricocheteia projéteis!)
  addBlock('st1-reflector', -3.4, 1.5, -9.2, 0.35, 2.4, 2.8, reflectorMat, true, true);

  const sign1 = createSignMesh(
    'ESTAÇÃO 01 // FRENTE',
    'COMBATE & POLARIDADE',
    'RMB: Recortar projéteis/alvos  |  R: Virar Negativo  |  RMB: Reprojetar'
  );
  sign1.position.set(0, 4.9, -19.45);
  chamberGroup.add(sign1);

  // ============================================================================
  // ESTAÇÃO 02 (OESTE / ESQUERDA): TÚNEL BALÍSTICO DE CALIBRAÇÃO
  // ============================================================================
  addBlock('st2-pedestal-emitter', -14.2, 0.7, -5.5, 1.4, 1.4, 1.4, darkTrimMat, true);
  addBlock('st2-pedestal-target', -14.2, 0.4, 5.5, 2.2, 0.8, 2.2, gridMaterial, true);
  addBlock('st2-divider', -11.6, 0.45, 0, 0.35, 0.9, 10.5, gridMaterial, true);

  const sign2 = createSignMesh(
    'ESTAÇÃO 02 // OESTE',
    'TÚNEL BALÍSTICO',
    'Feixe contínuo: aproxime-se em câmera lenta e recorte projéteis no ar'
  );
  sign2.position.set(-16.45, 4.3, 0);
  sign2.rotation.y = Math.PI * 0.5;
  chamberGroup.add(sign2);

  // ============================================================================
  // ESTAÇÃO 03 (LESTE / DIREITA): TRANSPOSIÇÃO ESPACIAL & PROPS CINÉTICOS
  // ============================================================================
  addBlock('st3-table-a', 12.8, 0.55, -4.5, 2.4, 1.1, 2.4, gridMaterial, true);
  addBlock('st3-ledge-high', 13.8, 1.45, 1.5, 2.8, 2.9, 2.8, gridMaterial, true);
  addBlock('st3-pedestal-core', 12.8, 0.45, 6.2, 2.0, 0.9, 2.0, gridMaterial, true);

  const sign3 = createSignMesh(
    'ESTAÇÃO 03 // LESTE',
    'TRANSPOSIÇÃO SE(3)',
    'Capture cubos, núcleos ou sentinelas à distância e reposicione no espaço'
  );
  sign3.position.set(16.45, 4.3, 0.8);
  sign3.rotation.y = -Math.PI * 0.5;
  chamberGroup.add(sign3);

  populateChamberEntities(world, scene);

  return {
    colliders,
    spawnPoint: new THREE.Vector3(0, 0, 10.5),
  };
}

/**
 * Popula (ou repopula no reset [T]) todas as entidades dinâmicas da Sala de Testes.
 */
export function populateChamberEntities(world: World, scene: THREE.Scene): void {
  // Estação 01: Sentinela central armada + 2 sentinelas laterais nos pedestais
  spawnCrystalSentinel(world, scene, new THREE.Vector3(0, 0.8, -13.5), {
    stationId: 'st1-center',
    armed: true,
    trackPlayer: true,
    fireInterval: 1.9,
    projectileSpeed: 14.5,
    respawn: true,
  });

  spawnCrystalSentinel(world, scene, new THREE.Vector3(-4.8, 1.5, -14.5), {
    stationId: 'st1-left',
    armed: true,
    trackPlayer: true,
    fireInterval: 2.5,
    projectileSpeed: 13.5,
    respawn: true,
  });

  spawnCrystalSentinel(world, scene, new THREE.Vector3(4.8, 1.5, -14.5), {
    stationId: 'st1-right',
    armed: false,
    respawn: true,
  });

  // Estação 02: Emissor balístico fixo disparando em linha reta para Sul (+Z) rumo a um alvo
  const emitterEntity = world.createEntity();
  const emitterMesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.62, 0.48, 0.9),
    new THREE.MeshStandardMaterial({
      color: 0xe6192e,
      emissive: 0x450008,
      roughness: 0.25,
    })
  );
  const emitterPos = new THREE.Vector3(-14.2, 1.68, -5.5);
  emitterMesh.position.copy(emitterPos);
  scene.add(emitterMesh);

  world.add(emitterEntity, Transform, {
    prevPosition: emitterPos.clone(),
    position: emitterPos.clone(),
    prevQuaternion: new THREE.Quaternion(),
    quaternion: new THREE.Quaternion(),
    scale: new THREE.Vector3(1, 1, 1),
  });
  world.add(emitterEntity, Renderable, {
    object3d: emitterMesh,
    disposeGeometry: true,
    disposeMaterial: true,
  });
  world.add(emitterEntity, TurretEmitter, {
    cooldown: 0.35,
    interval: 1.1,
    fireDirection: new THREE.Vector3(0, 0, 1),
    trackPlayer: false,
    projectileSpeed: 12.0,
    muzzleOffset: new THREE.Vector3(0, 0, 0.65),
    enabled: true,
  });

  spawnCrystalSentinel(world, scene, new THREE.Vector3(-14.2, 0.8, 5.5), {
    stationId: 'st2-target',
    armed: false,
    respawn: true,
  });

  // Estação 03: Cubos cinéticos empilhados, núcleo explosivo flutuante e sentinela elevada
  spawnKineticProp(world, scene, new THREE.Vector3(12.4, 1.55, -4.8), false);
  spawnKineticProp(world, scene, new THREE.Vector3(13.2, 1.55, -4.1), false);
  spawnKineticProp(world, scene, new THREE.Vector3(12.8, 2.35, -4.45), false);
  spawnKineticProp(world, scene, new THREE.Vector3(12.8, 1.85, 6.2), true);

  spawnCrystalSentinel(world, scene, new THREE.Vector3(13.8, 2.9, 1.5), {
    stationId: 'st3-sentinel',
    armed: false,
    respawn: true,
  });
}
