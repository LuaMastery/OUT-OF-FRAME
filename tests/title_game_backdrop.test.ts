import { describe, expect, it } from 'vitest';
import { gridCellToWorld } from '../src/doom/DoomMazeBuilder';
import {
  buildTitleBackdropWorld,
  TITLE_BACKDROP_QUALITY,
  TITLE_CAMERA_CELL,
} from '../src/terminal/TitleGameBackdrop';
import { resetThemedRoomLocks } from '../src/doom/DoomRooms';

describe('Cenário real no menu principal', () => {
  it('constrói o labirinto do jogo com obstáculos, salas, luzes e câmera fora de colisores', () => {
    const world = buildTitleBackdropWorld();
    try {
      expect(world.scene.children.length).toBeGreaterThan(0);
      expect(world.maze.colliders.length).toBeGreaterThan(100);
      expect(world.maze.colliders.filter(c => c.isObstacle).length).toBeGreaterThan(90);
      expect(world.maze.arenaLayout.roomFurniturePlacements.length).toBeGreaterThan(0);
      expect(world.maze.specialRoomDoors.doors).toHaveLength(7);
      expect(world.maze.specialRoomDoors.doors.every(door => !door.unlocked)).toBe(true);
      expect(world.maze.lights.length).toBeGreaterThan(0);
      expect(world.maze.annexLights.length).toBe(21);
      const origin = gridCellToWorld(TITLE_CAMERA_CELL.gx, TITLE_CAMERA_CELL.gz);
      const cameraInSolid = world.maze.colliders.some(({box}) =>
        box.min.x < origin.x && box.max.x > origin.x &&
        box.min.z < origin.z && box.max.z > origin.z &&
        box.min.y < 1.55 && box.max.y > 1.55
      );
      expect(cameraInSolid).toBe(false);
    } finally {
      world.maze.specialRoomDoors.dispose();
      Object.values(world.textures).forEach(texture => texture.dispose());
      resetThemedRoomLocks();
    }
  });

  it('renderiza o cenário com resolução interna maior que a versão pixelizada antiga', () => {
    // O fundo antigo renderizava a 640x400 no máximo; agora acompanha a tela
    // com supersampling moderado e teto para não competir com a partida.
    expect(TITLE_BACKDROP_QUALITY.maxBufferWidth).toBeGreaterThanOrEqual(1024);
    expect(TITLE_BACKDROP_QUALITY.maxBufferHeight).toBeGreaterThanOrEqual(640);
    expect(TITLE_BACKDROP_QUALITY.minBufferWidth).toBeGreaterThanOrEqual(640);
    expect(TITLE_BACKDROP_QUALITY.minBufferHeight).toBeGreaterThanOrEqual(360);
    expect(TITLE_BACKDROP_QUALITY.maxPixelRatio).toBeGreaterThan(1);
    expect(TITLE_BACKDROP_QUALITY.targetFps).toBeGreaterThanOrEqual(24);
    expect(TITLE_BACKDROP_QUALITY.reducedMotionFps).toBeLessThan(TITLE_BACKDROP_QUALITY.targetFps);
  });
});

describe('Trilha da tela inicial (motor de áudio)', () => {
  it('expõe controles de barramento para manter, abafar e encerrar o tema', async () => {
    const { SoundEngine } = await import('../src/engine/audio/SoundEngine');
    const engine = new SoundEngine();
    const proto = SoundEngine.prototype as unknown as Record<string, unknown>;
    for (const method of ['startTitlePad', 'stopTitlePad', 'duckTitleTheme', 'unduckTitleTheme', 'titleMenuGlide']) {
      expect(typeof proto[method]).toBe('function');
    }
    // O ambiente de teste não tem navegador: o mínimo para as chamadas serem
    // seguras é um `window` com AudioContext ausente (o motor sai em silêncio).
    (globalThis as unknown as { window: unknown }).window = {
      AudioContext: undefined,
      setTimeout: () => 0,
      clearTimeout: () => undefined,
    };
    expect(() => engine.startTitlePad(0.55)).not.toThrow();
    expect(() => engine.duckTitleTheme()).not.toThrow();
    expect(() => engine.unduckTitleTheme()).not.toThrow();
    expect(() => engine.titleMenuGlide(1)).not.toThrow();
    expect(() => engine.stopTitlePad(0.3)).not.toThrow();
    engine.dispose();
  });
});
