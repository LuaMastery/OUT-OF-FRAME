import { describe, expect, it } from 'vitest';
import { gridCellToWorld } from '../src/doom/DoomMazeBuilder';
import { buildTitleBackdropWorld } from '../src/terminal/TitleGameBackdrop';
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
      const origin = gridCellToWorld(10, 11);
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
});
