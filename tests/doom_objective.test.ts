import { describe, expect, it } from 'vitest';
import { formatShotgunObjective } from '../src/doom/DoomObjective';

describe('objetivo compacto', () => {
  it('mantém progresso, próxima etapa e controles relevantes', () => {
    expect(formatShotgunObjective(false, false, 2, 0)).toContain('2/4');
    expect(formatShotgunObjective(false, false, 4, 0)).toContain('[TAB]');
    expect(formatShotgunObjective(false, true, 0, 0)).toContain('CAIXOTES');
    expect(formatShotgunObjective(false, true, 0, 8)).toBe('DESTRUA A ARANHA · 8 CARTUCHOS · [H] EQUIPAR · CLIQUE ATIRAR');
    expect(formatShotgunObjective(true, true, 0, 8)).toContain('CONCLUÍDO');
  });
});
