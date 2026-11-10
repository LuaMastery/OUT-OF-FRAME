import { describe, expect, it } from 'vitest';
import { createRandomArenaLayout, createSeededRng } from '../src/doom/DoomArenaRandomizer';
import { isSolidCell, LABYRINTH_MAP } from '../src/doom/DoomMazeBuilder';
import { THEMED_ROOMS } from '../src/doom/DoomRooms';
import { planShiftingMazeClosures, ShiftingMazeCell } from '../src/doom/DoomShiftingMazePlanner';

function reachableCells(closures: readonly ShiftingMazeCell[]): Set<string> {
  const blocked = new Set(closures.map(({ gx, gz }) => `${gx},${gz}`));
  const seen = new Set<string>();
  const queue: ShiftingMazeCell[] = [];
  for (let gz = 0; gz < LABYRINTH_MAP.length && !queue.length; gz++) {
    for (let gx = 0; gx < LABYRINTH_MAP[gz].length; gx++) {
      if (!isSolidCell(LABYRINTH_MAP, gx, gz) && !blocked.has(`${gx},${gz}`)) {
        queue.push({ gx, gz });
        seen.add(`${gx},${gz}`);
        break;
      }
    }
  }
  for (let i = 0; i < queue.length; i++) {
    const { gx, gz } = queue[i];
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const x = gx + dx, z = gz + dz, k = `${x},${z}`;
      if (!seen.has(k) && !blocked.has(k) && !isSolidCell(LABYRINTH_MAP, x, z)) {
        seen.add(k);
        queue.push({ gx: x, gz: z });
      }
    }
  }
  return seen;
}

describe('Planejador de mudanças do labirinto', () => {
  it('gera variações determinísticas sem isolar corredores, objetivos ou entradas', () => {
    const layout = createRandomArenaLayout({ worldSeed: 411, playerSeed: 412 });
    const protectedCells = [
      layout.lairCell, layout.dragStartCell, layout.playerSpawnCell,
      ...layout.cratePlacements, ...layout.initialWebTrapCells,
      ...layout.obstaclePlacements, ...THEMED_ROOMS.map(r => ({ gx: r.innerGx, gz: r.innerGz })),
    ];
    const originalOpen = reachableCells([]).size;
    const signatures = new Set<string>();
    for (let seed = 1; seed <= 60; seed++) {
      const generate = () => planShiftingMazeClosures(LABYRINTH_MAP, {
        protectedCells, maxClosures: 12, random: createSeededRng(seed),
      });
      const closures = generate();
      expect(closures).toEqual(generate());
      expect(closures.length).toBe(12);
      expect(new Set(closures.map(c => `${c.gx},${c.gz}`)).size).toBe(12);
      const protectedKeys = new Set(protectedCells.map(c => `${c.gx},${c.gz}`));
      for (const cell of closures) {
        expect(LABYRINTH_MAP[cell.gz][cell.gx]).toBe('.');
        expect(protectedKeys.has(`${cell.gx},${cell.gz}`)).toBe(false);
      }
      const reachable = reachableCells(closures);
      expect(reachable.size).toBe(originalOpen - closures.length);
      for (const cell of protectedCells) {
        if (!isSolidCell(LABYRINTH_MAP, cell.gx, cell.gz)) {
          expect(reachable.has(`${cell.gx},${cell.gz}`)).toBe(true);
        }
      }
      signatures.add(JSON.stringify(closures));
    }
    expect(signatures.size).toBe(60);
  });

  it('não gera fechamentos em mapas previamente desconectados ou quando desativado', () => {
    expect(planShiftingMazeClosures(['#####', '#.#.#', '#####'], {
      protectedCells: [], maxClosures: 3, random: () => 0.5,
    })).toEqual([]);
    expect(planShiftingMazeClosures(LABYRINTH_MAP, {
      protectedCells: [], maxClosures: 0, random: () => 0.5,
    })).toEqual([]);
  });
});
