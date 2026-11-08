import * as THREE from 'three';

export interface NormalizedRect {
  /** Limite esquerdo em NDC [-1..1] */
  uMin: number;
  /** Limite direito em NDC [-1..1] */
  uMax: number;
  /** Limite inferior em NDC [-1..1] */
  vMin: number;
  /** Limite superior em NDC [-1..1] */
  vMax: number;
}

export interface FrameLocalTransform {
  localPosition: THREE.Vector3;
  localQuaternion: THREE.Quaternion;
  localVelocity: THREE.Vector3;
  localAngularVelocity: THREE.Vector3;
}

export type FramePolarity = 'normal' | 'inverted';

const ROT_Y_PI = new THREE.Quaternion().setFromAxisAngle(
  new THREE.Vector3(0, 1, 0),
  Math.PI
);

/**
 * Retângulo canônico da moldura diegética no centro da tela (NDC).
 */
export const DEFAULT_FRAME_RECT: NormalizedRect = {
  uMin: -0.36,
  uMax: 0.36,
  vMin: -0.38,
  vMax: 0.38,
};

/**
 * Constrói uma matriz de projeção perspectiva off-axis correspondente exatamente
 * a uma sub-janela normalizada [uMin..uMax] x [vMin..vMax] da câmera principal.
 */
export function buildSubProjectionMatrix(
  fovDeg: number,
  aspect: number,
  near: number,
  far: number,
  rect: NormalizedRect = DEFAULT_FRAME_RECT,
  out = new THREE.Matrix4()
): THREE.Matrix4 {
  const halfHeight = near * Math.tan(THREE.MathUtils.degToRad(fovDeg * 0.5));
  const halfWidth = halfHeight * aspect;

  const left = rect.uMin * halfWidth;
  const right = rect.uMax * halfWidth;
  const bottom = rect.vMin * halfHeight;
  const top = rect.vMax * halfHeight;

  return out.makePerspective(left, right, top, bottom, near, far);
}

/**
 * Extrai o `THREE.Frustum` de 6 planos exatos no Espaço do Mundo para o recorte da moldura.
 */
export function extractWorldSubFrustum(
  camera: THREE.PerspectiveCamera,
  near: number,
  far: number,
  rect: NormalizedRect = DEFAULT_FRAME_RECT,
  outFrustum = new THREE.Frustum()
): THREE.Frustum {
  camera.updateMatrixWorld(true);
  const subProj = buildSubProjectionMatrix(camera.fov, camera.aspect, near, far, rect);
  const viewMatrix = camera.matrixWorldInverse;
  const vpMatrix = new THREE.Matrix4().multiplyMatrices(subProj, viewMatrix);
  return outFrustum.setFromProjectionMatrix(vpMatrix);
}

/**
 * Calcula os 8 vértices 3D (4 no plano near, 4 no plano far) da pirâmide truncada da moldura
 * no espaço do mundo — utilizado para desenhar o gizmo volumétrico do recorte espacial.
 */
export function computeSubFrustumCornersWorld(
  camera: THREE.PerspectiveCamera,
  near: number,
  far: number,
  rect: NormalizedRect = DEFAULT_FRAME_RECT
): THREE.Vector3[] {
  camera.updateMatrixWorld(true);
  const tanHalfFov = Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5));

  const cornersLocal: THREE.Vector3[] = [];
  for (const dist of [near, far]) {
    const h = dist * tanHalfFov;
    const w = h * camera.aspect;
    const l = rect.uMin * w;
    const r = rect.uMax * w;
    const b = rect.vMin * h;
    const t = rect.vMax * h;

    cornersLocal.push(
      new THREE.Vector3(l, b, -dist),
      new THREE.Vector3(r, b, -dist),
      new THREE.Vector3(r, t, -dist),
      new THREE.Vector3(l, t, -dist)
    );
  }

  return cornersLocal.map((v) => v.applyMatrix4(camera.matrixWorld));
}

/**
 * Converte estado cinemático completo do Espaço do Mundo para o Espaço Local SE(3) da câmera.
 *
 * Equações:
 *   p_local = q_cam^-1 * (p_world - p_cam)
 *   q_local = q_cam^-1 * q_world
 *   v_local = q_cam^-1 * v_world
 */
export function captureTransformToFrame(
  cameraWorldPosition: THREE.Vector3,
  cameraWorldQuaternion: THREE.Quaternion,
  worldPosition: THREE.Vector3,
  worldQuaternion: THREE.Quaternion,
  worldVelocity: THREE.Vector3,
  worldAngularVelocity: THREE.Vector3
): FrameLocalTransform {
  const invCamQuat = cameraWorldQuaternion.clone().invert();

  const localPosition = worldPosition
    .clone()
    .sub(cameraWorldPosition)
    .applyQuaternion(invCamQuat);

  const localQuaternion = invCamQuat.clone().multiply(worldQuaternion);
  const localVelocity = worldVelocity.clone().applyQuaternion(invCamQuat);
  const localAngularVelocity = worldAngularVelocity
    .clone()
    .applyQuaternion(invCamQuat);

  return {
    localPosition,
    localQuaternion,
    localVelocity,
    localAngularVelocity,
  };
}

/**
 * Reprojeta um estado capturado em Espaço da Moldura de volta para o Espaço do Mundo
 * a partir de uma nova pose de câmera, aplicando opcionalmente a inversão de polaridade ("Negativo").
 *
 * Na polaridade `inverted`:
 * - A posição é espelhada horizontalmente na janela da lente: (x, y, z) -> (-x, y, z)
 * - O vetor velocidade gira 180° em torno do eixo vertical da lente: (vx, vy, vz) -> (-vx, vy, -vz),
 *   fazendo projéteis que vinham EM DIREÇÃO ao jogador dispararem PARA FORA da moldura!
 */
export function reprojectTransformFromFrame(
  pasteCameraPosition: THREE.Vector3,
  pasteCameraQuaternion: THREE.Quaternion,
  captured: FrameLocalTransform,
  polarity: FramePolarity = 'normal'
): {
  worldPosition: THREE.Vector3;
  worldQuaternion: THREE.Quaternion;
  worldVelocity: THREE.Vector3;
  worldAngularVelocity: THREE.Vector3;
} {
  const posLocal = captured.localPosition.clone();
  const quatLocal = captured.localQuaternion.clone();
  const velLocal = captured.localVelocity.clone();
  const angLocal = captured.localAngularVelocity.clone();

  if (polarity === 'inverted') {
    posLocal.x = -posLocal.x;
    velLocal.x = -velLocal.x;
    velLocal.z = -velLocal.z;
    quatLocal.premultiply(ROT_Y_PI);
    angLocal.y = -angLocal.y;
  }

  const worldPosition = posLocal
    .applyQuaternion(pasteCameraQuaternion)
    .add(pasteCameraPosition);

  const worldQuaternion = pasteCameraQuaternion.clone().multiply(quatLocal);
  const worldVelocity = velLocal.applyQuaternion(pasteCameraQuaternion);
  const worldAngularVelocity = angLocal.applyQuaternion(pasteCameraQuaternion);

  return {
    worldPosition,
    worldQuaternion,
    worldVelocity,
    worldAngularVelocity,
  };
}
