import * as THREE from 'three';
import { createRandomArenaLayout } from '../doom/DoomArenaRandomizer';
import { buildDoomLabyrinth, gridCellToWorld, syncNearestDoomLightsToUniforms } from '../doom/DoomMazeBuilder';
import { DoomMazeResult } from '../doom/DoomMazeBuilder';
import { createDoomSharedUniforms } from '../doom/DoomShader';
import { createDoomTextures } from '../doom/DoomTextures';

/** O menu usa os mesmos construtores, texturas, móveis e colisores da partida. */
export function buildTitleBackdropWorld(): {
  scene: THREE.Scene;
  maze: DoomMazeResult;
  textures: ReturnType<typeof createDoomTextures>;
  uniforms: ReturnType<typeof createDoomSharedUniforms>;
} {
  const scene = new THREE.Scene();
  const uniforms = createDoomSharedUniforms();
  const textures = createDoomTextures();
  // Layout fixo somente para o menu; a partida continua com suas próprias sementes.
  const layout = createRandomArenaLayout({ worldSeed: 137, playerSeed: 421 });
  const maze = buildDoomLabyrinth(scene, textures, uniforms, layout);
  return { scene, maze, textures, uniforms };
}

export const TITLE_CAMERA_CELL = { gx: 14, gz: 15 } as const;

/** Câmera no corredor real entre os setores industrial e de pedra. */
export class TitleGameBackdrop {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly camera = new THREE.PerspectiveCamera(60, 1, 0.08, 90);
  private readonly world: ReturnType<typeof buildTitleBackdropWorld>;
  private readonly origin = gridCellToWorld(TITLE_CAMERA_CELL.gx, TITLE_CAMERA_CELL.gz);
  private frame = 0;
  private started = false;
  private lastFrame = 0;
  private elapsed = 0;
  private width = 0;
  private height = 0;
  private readonly reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  constructor(private readonly container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'low-power' });
    this.renderer.setPixelRatio(1);
    this.renderer.setClearColor(0x080d0a, 1);
    this.renderer.domElement.setAttribute('aria-hidden', 'true');
    this.container.appendChild(this.renderer.domElement);
    try {
      this.world = buildTitleBackdropWorld();
    } catch (error) {
      this.renderer.dispose();
      this.renderer.forceContextLoss();
      this.renderer.domElement.remove();
      throw error;
    }
    this.camera.position.set(this.origin.x, 1.55, this.origin.z);
    // O mesmo feixe usado pelo jogador revela a arquitetura sem alterar o mapa.
    this.world.uniforms.uFlashlightPos.value.copy(this.camera.position);
    this.world.uniforms.uFlashlightIntensity.value = 1.2;
    syncNearestDoomLightsToUniforms(
      [...this.world.maze.lights, ...this.world.maze.annexLights].map((light) => ({
        position: light.position, intensity: light.baseIntensity,
      })),
      this.camera.position,
      this.world.uniforms,
      12
    );
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    this.onVisibilityChange();
  }

  private readonly onVisibilityChange = (): void => {
    if (document.hidden) {
      if (this.frame) cancelAnimationFrame(this.frame);
      this.frame = 0;
      this.lastFrame = 0;
    } else if (this.started && !this.frame) {
      this.lastFrame = 0;
      this.frame = requestAnimationFrame(this.render);
    }
  };

  private readonly render = (now: number): void => {
    this.frame = 0;
    if (this.lastFrame && now - this.lastFrame < 1000 / (this.reduceMotion.matches ? 5 : 15)) {
      this.frame = requestAnimationFrame(this.render);
      return;
    }
    if (this.lastFrame) this.elapsed += Math.min((now - this.lastFrame) / 1000, 0.1);
    this.lastFrame = now;
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    if (width !== this.width || height !== this.height) {
      this.width = width; this.height = height;
      // A visão de fundo não deve disputar os recursos da partida/menu em telas grandes.
      const scale = Math.min(1, 640 / width, 400 / height);
      this.renderer.setSize(Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale)), false);
      this.camera.aspect = width / height;
      this.camera.fov = this.camera.aspect < 1 ? 70 : 60;
      this.camera.updateProjectionMatrix();
    }
    // A câmera permanece na célula livre; só o olhar oscila suavemente.
    const drift = this.reduceMotion.matches ? 0 : Math.sin(this.elapsed * 0.16) * 0.60;
    this.camera.lookAt(this.origin.x + 10, 1.54 + drift * 0.08, this.origin.z + drift);
    this.camera.getWorldDirection(this.world.uniforms.uFlashlightDir.value);
    this.renderer.render(this.world.scene, this.camera);
    this.frame = requestAnimationFrame(this.render);
  };

  destroy(): void {
    this.started = false;
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.world.maze.specialRoomDoors.dispose();
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    const textures = new Set<THREE.Texture>(Object.values(this.world.textures));
    this.world.scene.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      geometries.add(mesh.geometry);
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) materials.add(material);
    });
    for (const material of materials) {
      const shader = material as THREE.ShaderMaterial;
      if (shader.uniforms) {
        for (const uniform of Object.values(shader.uniforms)) {
          if (uniform.value?.isTexture) textures.add(uniform.value as THREE.Texture);
        }
      }
      const map = (material as THREE.MeshBasicMaterial).map;
      if (map) textures.add(map);
      material.dispose();
    }
    geometries.forEach((geometry) => geometry.dispose());
    textures.forEach((texture) => texture.dispose());
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }
}
