import type { DoomRoomId } from './DoomRooms';
import { getThemedRoomAtCell } from './DoomRooms';
import { STONE_SECTOR_START_ROW } from './DoomMazeBuilder';

export type DoomAmbientZone = DoomRoomId | 'industrial' | 'atrium' | 'catacombs' | 'nest';

/** Room identity takes priority over proximity to the nest and the core sectors. */
export function getDoomAmbientZone(
  gx: number, gz: number, lair: { gx: number; gz: number }
): DoomAmbientZone {
  const room = getThemedRoomAtCell(gx, gz);
  if (room) return room.id;
  if (Math.abs(gx - lair.gx) <= 2 && Math.abs(gz - lair.gz) <= 2) return 'nest';
  if (gz >= STONE_SECTOR_START_ROW) return 'catacombs';
  if (gx >= 10 && gx <= 18 && gz >= 8 && gz <= 15) return 'atrium';
  return 'industrial';
}

/** Debounces brief boundary crossings; audio rendering still interpolates separately. */
export class DoomAmbientZoneTracker {
  private current: DoomAmbientZone | null = null;
  private pending: DoomAmbientZone | null = null;
  private pendingSeconds = 0;

  constructor(private readonly lair: { gx: number; gz: number }) {}

  update(gx: number, gz: number, dt: number): DoomAmbientZone {
    const next = getDoomAmbientZone(gx, gz, this.lair);
    if (this.current === null) {
      this.current = next;
    } else if (next === this.current) {
      this.pending = null;
      this.pendingSeconds = 0;
    } else {
      if (next !== this.pending) {
        this.pending = next;
        this.pendingSeconds = 0;
      }
      if (Number.isFinite(dt) && dt > 0) this.pendingSeconds += dt;
      if (this.pendingSeconds >= 0.7) {
        this.current = next;
        this.pending = null;
        this.pendingSeconds = 0;
      }
    }
    return this.current;
  }
}
