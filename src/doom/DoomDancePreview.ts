import * as THREE from 'three';
import { DoomAstronaut } from './DoomAstronaut';
import { computeDoomDancePose, DoomDanceId } from './DoomDance';
import { createDoomSharedUniforms } from './DoomShader';

/** Uma cena independente: a prévia nunca move o personagem nem inicia uma dança na partida. */
export class DoomDancePreview {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(34, 1, 0.1, 20);
  private readonly renderer: THREE.WebGLRenderer;
  private readonly astronaut: DoomAstronaut;
  private readonly origin = new THREE.Vector3();
  private frame = 0;
  private startedAt = 0;
  private dance: DoomDanceId;
  private width = 0;
  private height = 0;

  constructor(private readonly container: HTMLElement, initialDance: DoomDanceId) {
    this.dance = initialDance;
    this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.domElement.setAttribute('aria-hidden', 'true');
    this.container.appendChild(this.renderer.domElement);
    const uniforms = createDoomSharedUniforms();
    uniforms.uLightCount.value = 2;
    uniforms.uLightPositions.value[0].set(-1.5, 2.8, -2.4);
    uniforms.uLightPositions.value[1].set(2, 1.7, -1.5);
    uniforms.uLightIntensities.value[0] = 4.5;
    uniforms.uLightIntensities.value[1] = 2.5;
    this.astronaut = new DoomAstronaut(this.scene, uniforms);
    this.camera.position.set(0, 1.16, -3.8);
    this.camera.lookAt(0, 0.91, 0);
  }

  setDance(id: DoomDanceId): void {
    if (this.dance === id) return;
    this.dance = id;
    this.startedAt = performance.now();
  }

  start(): void {
    if (this.frame) return;
    this.startedAt = performance.now();
    this.frame = requestAnimationFrame(this.render);
  }

  stop(): void {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
  }

  private readonly render = (now: number): void => {
    this.frame = 0;
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    if (width !== this.width || height !== this.height) {
      this.width = width;
      this.height = height;
      this.camera.aspect = width / height;
      // Enquadra os braços também em telas estreitas.
      this.camera.fov = width / height < 0.75 ? 44 : 34;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(width, height, false);
    }
    this.astronaut.applyDancePose(computeDoomDancePose(this.dance, Math.max(0, (now - this.startedAt) / 1000)), this.origin, 0);
    this.renderer.render(this.scene, this.camera);
    this.frame = requestAnimationFrame(this.render);
  };

  destroy(): void {
    this.stop();
    // Materiais e geometrias pertencem à cena da prévia; texturas do traje são
    // compartilhadas com o jogo e não devem ser descartadas aqui.
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    this.astronaut.root.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      geometries.add(mesh.geometry);
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) materials.add(material);
    });
    geometries.forEach((geometry) => geometry.dispose());
    materials.forEach((material) => material.dispose());
    this.astronaut.disposeFromScene(this.scene);
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }
}
