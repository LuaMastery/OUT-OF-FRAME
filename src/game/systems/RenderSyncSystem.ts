import * as THREE from 'three';
import { World } from '../../engine/ecs/World';
import {
  PocketStasis,
  Projectile,
  Renderable,
  Transform,
} from '../components';

const tmpPos = new THREE.Vector3();
const tmpQuat = new THREE.Quaternion();

/**
 * Sincronização Interpolada de Renderização (Gaffer-On-Games `alpha` blend).
 *
 * Interpola `prevTransform -> currTransform` usando a fração residual do acumulador temporal,
 * garantindo movimento a 60–144 Hz perfeitamente sedoso mesmo quando o mundo físico
 * só avança ~3 ticks por segundo em câmera ultra-lenta (`0.025x`).
 */
export class RenderSyncSystem {
  constructor(private readonly world: World) {}

  render(alpha: number): void {
    const entities = this.world.query(
      Transform.bit | Renderable.bit,
      PocketStasis.bit
    );

    for (const e of entities) {
      const tr = this.world.getRequired(e, Transform);
      const rend = this.world.getRequired(e, Renderable);

      tmpPos.lerpVectors(tr.prevPosition, tr.position, alpha);
      tmpQuat.slerpQuaternions(tr.prevQuaternion, tr.quaternion, alpha);

      rend.object3d.position.copy(tmpPos);
      rend.object3d.quaternion.copy(tmpQuat);
      rend.object3d.scale.copy(tr.scale);

      const proj = this.world.get(e, Projectile);
      if (proj && proj.trailHistory.length >= 1) {
        const pts = [...proj.trailHistory];
        pts[pts.length - 1] = tmpPos.clone();
        proj.trailMesh.geometry.dispose();
        proj.trailMesh.geometry = new THREE.BufferGeometry().setFromPoints(pts);
      }
    }
  }
}
