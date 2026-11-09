import { describe, expect, it } from 'vitest';
import { DoomAmbientZoneTracker, getDoomAmbientZone } from '../src/doom/DoomAmbientZones';
import { THEMED_ROOMS } from '../src/doom/DoomRooms';
import { DOOM_AMBIENT_PROFILES } from '../src/engine/audio/SoundEngine';

describe('Ambiência por setor', () => {
  it('identifica as sete salas externas, os setores e o ninho sorteado', () => {
    for (const room of THEMED_ROOMS) {
      // Even a nest adjacent to an annex cannot override its sound profile.
      const gx = room.minGx + 3, gz = room.minGz + 3;
      expect(getDoomAmbientZone(gx, gz, { gx, gz })).toBe(room.id);
      expect(getDoomAmbientZone(room.doorGx, room.doorGz, { gx: 14, gz: 23 })).toBe(room.id);
    }
    expect(getDoomAmbientZone(2, 1, { gx: 14, gz: 23 })).toBe('industrial');
    expect(getDoomAmbientZone(14, 11, { gx: 14, gz: 23 })).toBe('atrium');
    expect(getDoomAmbientZone(3, 25, { gx: 14, gz: 23 })).toBe('catacombs');
    expect(getDoomAmbientZone(14, 23, { gx: 14, gz: 23 })).toBe('nest');
    expect(getDoomAmbientZone(5, 5, { gx: 5, gz: 5 })).toBe('nest');
  });

  it('troca sem oscilar na fronteira e não avança com tempo inválido', () => {
    const tracker = new DoomAmbientZoneTracker({ gx: 14, gz: 23 });
    expect(tracker.update(11, 1, 0)).toBe('industrial');
    expect(tracker.update(11, -1, 0.4)).toBe('industrial');
    expect(tracker.update(11, 1, 0.4)).toBe('industrial');
    expect(tracker.update(11, -1, NaN)).toBe('industrial');
    expect(tracker.update(11, -1, -1)).toBe('industrial');
    expect(tracker.update(11, -1, 0.4)).toBe('industrial');
    expect(tracker.update(11, -1, 0.31)).toBe('computer_room');
    expect(tracker.update(11, 1, 0.7)).toBe('industrial');
  });

  it('mantém perfis distintos, finitos e com ganhos discretos para todas as salas', () => {
    const zones = ['industrial', 'atrium', 'catacombs', 'nest', ...THEMED_ROOMS.map(r => r.id)] as const;
    const profiles = zones.map(id => DOOM_AMBIENT_PROFILES[id]);
    expect(new Set(profiles.map(p => JSON.stringify(p))).size).toBe(zones.length);
    for (const p of profiles) {
      expect(Object.values(p).every(v => Number.isFinite(v) && v > 0)).toBe(true);
      expect(p.humGain).toBeLessThanOrEqual(0.02);
      expect(p.noiseGain).toBeLessThanOrEqual(0.025);
      expect(p.noiseFrequency).toBeLessThan(2000);
    }
  });
});
