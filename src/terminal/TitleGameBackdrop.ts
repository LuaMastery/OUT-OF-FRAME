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

/**
 * Ajustes de qualidade do cenário do menu.
 *
 * O fundo é uma cena real do jogo, então vale investir um pouco mais em
 * nitidez: renderiza em resolução interna maior (com supersampling em telas
 * grandes), com antialias e 30 quadros por segundo. O teto evita que o menu
 * consuma a GPU que a partida vai precisar.
 */
export const TITLE_BACKDROP_QUALITY = {
  /** Maior lado do buffer interno, em pixels de dispositivo. */
  maxBufferWidth: 1400,
  maxBufferHeight: 820,
  /** Piso do buffer interno: nunca renderiza abaixo disso para não pixelizar. */
  minBufferWidth: 640,
  minBufferHeight: 360,
  /** Escala de supersampling em relação ao tamanho do contêiner CSS. */
  maxPixelRatio: 1.5,
  targetFps: 30,
  reducedMotionFps: 6,
} as const;

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
  private sized = false;
  private readonly reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  private lightSources: Array<{ position: THREE.Vector3; intensity: number }> = [];
  private lightRefreshCountdown = 0;

  constructor(private readonly container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'default' });
    this.renderer.setPixelRatio(1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
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
    this.lightSources = [...this.world.maze.lights, ...this.world.maze.annexLights].map((light) => ({
      position: light.position,
      intensity: light.baseIntensity,
    }));
    this.refreshNearestLights();
  }

  /** Mantém apenas as lâmpadas próximas do olhar dentro do shader. */
  private refreshNearestLights(): void {
    syncNearestDoomLightsToUniforms(
      this.lightSources,
      this.camera.position,
      this.world.uniforms,
      16
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
    const fps = this.reduceMotion.matches
      ? TITLE_BACKDROP_QUALITY.reducedMotionFps
      : TITLE_BACKDROP_QUALITY.targetFps;
    if (this.lastFrame && now - this.lastFrame < 1000 / fps) {
      this.frame = requestAnimationFrame(this.render);
      return;
    }
    if (this.lastFrame) this.elapsed += Math.min((now - this.lastFrame) / 1000, 0.1);
    this.lastFrame = now;
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    if (width !== this.width || height !== this.height || !this.sized) {
      this.width = width;
      this.height = height;
      this.sized = true;
      // Nitidez primeiro: o buffer acompanha o tamanho real da tela, com um teto
      // para o menu não competir com a GPU da partida.
      const dpr = Math.min(window.devicePixelRatio || 1, TITLE_BACKDROP_QUALITY.maxPixelRatio);
      const fit = Math.min(
        1,
        TITLE_BACKDROP_QUALITY.maxBufferWidth / (width * dpr),
        TITLE_BACKDROP_QUALITY.maxBufferHeight / (height * dpr)
      );
      const bufferW = Math.min(
        TITLE_BACKDROP_QUALITY.maxBufferWidth,
        Math.max(TITLE_BACKDROP_QUALITY.minBufferWidth, Math.round(width * dpr * fit))
      );
      const bufferH = Math.min(
        TITLE_BACKDROP_QUALITY.maxBufferHeight,
        Math.max(TITLE_BACKDROP_QUALITY.minBufferHeight, Math.round(height * dpr * fit))
      );
      this.renderer.setSize(bufferW, bufferH, false);
      this.camera.aspect = width / height;
      this.camera.fov = this.camera.aspect < 1 ? 72 : 62;
      this.camera.updateProjectionMatrix();
    }

    // Movimento de câmera contínuo e lento: deriva lateral, balanço de cabeça e
    // respiração da lanterna. Mantém o corredor vivo sem tirar a estabilidade.
    const t = this.elapsed;
    const still = this.reduceMotion.matches;
    const drift = still ? 0 : Math.sin(t * 0.16) * 0.60;
    const sway = still ? 0 : Math.sin(t * 0.23 + 0.7) * 0.055;
    const breathe = still ? 0 : Math.sin(t * 0.9) * 0.012;
    const lookX = this.origin.x + 10;
    const lookZ = this.origin.z + drift;
    this.camera.lookAt(lookX + sway, 1.54 + drift * 0.08 + breathe, lookZ);
    this.camera.getWorldDirection(this.world.uniforms.uFlashlightDir.value);
    this.world.uniforms.uFlashlightPos.value.copy(this.camera.position);

    // A lanterna pulsa de leve, como se a lâmpada estivesse aquecendo.
    const flicker = still ? 0 : Math.sin(t * 1.7) * 0.035 + Math.sin(t * 7.3) * 0.012;
    this.world.uniforms.uFlashlightIntensity.value = 1.42 + flicker;

    // As lâmpadas mais próximas do olhar se renovam de tempos em tempos.
    this.lightRefreshCountdown -= 1;
    if (this.lightRefreshCountdown <= 0) {
      this.lightRefreshCountdown = 20;
      this.refreshNearestLights();
    }

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
