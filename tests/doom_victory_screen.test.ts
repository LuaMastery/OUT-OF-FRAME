import { describe, expect, it } from 'vitest';
import { formatVictorySummary } from '../src/doom/DoomInventory';

describe('Resumo da tela de vitória', () => {
  it('no solo confirma que o jogador sobreviveu', () => {
    const solo = formatVictorySummary({ survivors: ['VOCÊ'] });
    expect(solo.sub).toBe('Você sobreviveu à incursão e eliminou a ameaça.');
    expect(solo.roster).toEqual(['VOCÊ']);
    expect(solo.everySurvived).toBe(true);
  });

  it('no co-op diz que todos os jogadores sobreviveram', () => {
    const coop = formatVictorySummary({
      survivors: ['ANA', 'BRUNO', 'CARLA'],
      totalPlayers: 3,
      everyoneSurvived: true,
    });
    expect(coop.sub).toBe('Todos os 3 jogadores sobreviveram à incursão.');
    expect(coop.roster).toHaveLength(3);
    expect(coop.everySurvived).toBe(true);
  });

  it('não mente quando alguém não voltou', () => {
    const partial = formatVictorySummary({
      survivors: ['ANA'],
      totalPlayers: 3,
      everyoneSurvived: false,
    });
    expect(partial.sub).toBe('1 de 3 jogadores sobreviveram à incursão.');
    expect(partial.everySurvived).toBe(false);
  });

  it('mostra tempo e cartuchos no resumo', () => {
    const info = formatVictorySummary({
      survivors: ['ANA', 'BRUNO'],
      elapsedSeconds: 754,
      shots: 12,
    });
    expect(info.stats).toBe('tempo 12:34  ·  12 cartuchos');
    expect(formatVictorySummary({}).stats).toBe('');
  });

  it('tolera um resumo vazio sem quebrar', () => {
    const empty = formatVictorySummary();
    expect(empty.sub).toBe('A ameaça foi eliminada.');
    expect(empty.roster).toEqual([]);
  });
});
