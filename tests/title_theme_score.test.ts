import { describe, it, expect } from 'vitest';
import {
  buildTitleThemeEvents,
  TITLE_THEME_BARS,
  TITLE_THEME_BEATS_PER_BAR,
  TITLE_THEME_BEAT_SEC,
  TITLE_THEME_BPM,
  TITLE_THEME_CHORDS,
  TITLE_THEME_LOOP_SEC,
  TITLE_THEME_MELODY,
  TITLE_PULSE_BARS,
  TITLE_ARPEGGIO_BARS,
  titleNoteHz,
  titleThemeChordAtBar,
  titleThemePassVariation,
  type TitleEvent,
} from '../src/engine/audio/TitleThemeScore';

const EVENTS = buildTitleThemeEvents();
const of = (kind: TitleEvent['kind']): TitleEvent[] =>
  EVENTS.filter((e) => e.kind === kind);

describe('afinação da trilha da tela inicial', () => {
  it('usa o Lá4 (440 Hz) como referência', () => {
    expect(titleNoteHz(0)).toBeCloseTo(440, 6);
  });

  it('sobe uma oitava a cada 12 semitons', () => {
    expect(titleNoteHz(12)).toBeCloseTo(880, 6);
    expect(titleNoteHz(-12)).toBeCloseTo(220, 6);
    expect(titleNoteHz(-24)).toBeCloseTo(110, 6);
  });

  it('mantém a afinação igual à dos efeitos do menu (Lá4 e Mi4)', () => {
    // `titleMenuGlide` toca 440 Hz e 329,63 Hz: as mesmas notas da partitura.
    expect(titleNoteHz(0)).toBeCloseTo(440, 2);
    expect(titleNoteHz(-5)).toBeCloseTo(329.63, 2);
  });
});

describe('forma da trilha da tela inicial', () => {
  it('tem oito compassos de quatro tempos a 72 BPM', () => {
    expect(TITLE_THEME_BPM).toBe(72);
    expect(TITLE_THEME_BEATS_PER_BAR).toBe(4);
    expect(TITLE_THEME_BARS).toBe(8);
  });

  it('fecha o loop em cerca de 27 segundos', () => {
    expect(TITLE_THEME_BEAT_SEC).toBeCloseTo(60 / TITLE_THEME_BPM, 6);
    expect(TITLE_THEME_LOOP_SEC).toBeCloseTo(
      TITLE_THEME_BARS * TITLE_THEME_BEATS_PER_BAR * TITLE_THEME_BEAT_SEC,
      9
    );
    expect(TITLE_THEME_LOOP_SEC).toBeCloseTo(26.667, 2);
    expect(TITLE_THEME_LOOP_SEC).toBeGreaterThan(20);
    expect(TITLE_THEME_LOOP_SEC).toBeLessThan(40);
  });

  it('descreve uma harmonia por compasso', () => {
    expect(TITLE_THEME_CHORDS).toHaveLength(TITLE_THEME_BARS);
    for (const chord of TITLE_THEME_CHORDS) {
      // Quatro vozes no colchão: é o que o SoundEngine cria ao montar o pad.
      expect(chord.pad).toHaveLength(4);
      expect(chord.arpeggio.length).toBeGreaterThanOrEqual(3);
      // Vozes em ordem crescente, sem inversão acidental.
      for (let i = 1; i < chord.pad.length; i++) {
        expect(chord.pad[i]).toBeGreaterThan(chord.pad[i - 1]);
      }
    }
  });

  it('faz o baixo descer em graus conjuntos (Lá → Sol → Fá → Mi)', () => {
    const roots = TITLE_THEME_CHORDS.map((c) => c.bass);
    const unique = roots.filter((r, i) => i === 0 || r !== roots[i - 1]);
    expect(unique).toEqual([-24, -26, -28, -29]);
    for (let i = 1; i < unique.length; i++) {
      expect(unique[i]).toBeLessThan(unique[i - 1]);
    }
  });

  it('usa a sensível do menor harmônico na dominante', () => {
    const dominant = TITLE_THEME_CHORDS[TITLE_THEME_CHORDS.length - 1];
    // Sol# (-13) sobre o acorde de Mi: é ele que puxa a volta para Lá menor.
    expect(dominant.pad).toContain(-13);
  });

  it('volta ao começo quando o compasso passa do fim do loop', () => {
    expect(titleThemeChordAtBar(0)).toBe(TITLE_THEME_CHORDS[0]);
    expect(titleThemeChordAtBar(TITLE_THEME_BARS)).toBe(TITLE_THEME_CHORDS[0]);
    expect(titleThemeChordAtBar(TITLE_THEME_BARS + 3)).toBe(TITLE_THEME_CHORDS[3]);
  });
});

describe('eventos de um passe do loop', () => {
  it('vem ordenados por tempo', () => {
    for (let i = 1; i < EVENTS.length; i++) {
      expect(EVENTS[i].beat).toBeGreaterThanOrEqual(EVENTS[i - 1].beat);
    }
    expect(EVENTS.length).toBeGreaterThan(60);
  });

  it('fica inteiro dentro do loop', () => {
    const last = EVENTS[EVENTS.length - 1];
    for (const event of EVENTS) {
      expect(event.beat).toBeGreaterThanOrEqual(0);
      expect(event.beat).toBeLessThan(TITLE_THEME_BARS * TITLE_THEME_BEATS_PER_BAR);
      expect(event.bar).toBeGreaterThanOrEqual(0);
      expect(event.bar).toBeLessThan(TITLE_THEME_BARS);
    }
    expect(last.beat).toBeLessThan(TITLE_THEME_BARS * TITLE_THEME_BEATS_PER_BAR);
  });

  it('tem uma entrada de colchão por compasso, no tempo 1', () => {
    const pads = of('pad');
    expect(pads).toHaveLength(TITLE_THEME_BARS);
    pads.forEach((pad, bar) => {
      expect(pad.beat).toBe(bar * TITLE_THEME_BEATS_PER_BAR);
      expect(pad.bar).toBe(bar);
    });
  });

  it('faz o baixo tocar a raiz da harmonia de cada compasso', () => {
    const bass = of('bass');
    expect(bass.length).toBeGreaterThanOrEqual(TITLE_THEME_BARS);
    for (const note of bass) {
      expect(note.semitone).toBe(titleThemeChordAtBar(note.bar).bass);
      expect(note.beats).toBeGreaterThan(0);
    }
    // Todo compasso tem a raiz no tempo 1.
    for (let bar = 0; bar < TITLE_THEME_BARS; bar++) {
      expect(bass.some((n) => n.bar === bar && n.beat === bar * 4)).toBe(true);
    }
  });

  it('segue o desenho de intensidade do pulso, compasso por compasso', () => {
    const pulses = of('pulse');
    for (let bar = 0; bar < TITLE_THEME_BARS; bar++) {
      const expected = TITLE_PULSE_BARS[bar];
      const hits = pulses.filter((p) => p.bar === bar);
      expect(hits.length).toBe(expected === 2 ? 4 : expected === 1 ? 2 : 0);
    }
    // O compasso final fica em silêncio: é a suspensão antes da volta.
    expect(pulses.filter((p) => p.bar === TITLE_THEME_BARS - 1)).toHaveLength(0);
  });

  it('só dedilha nos compassos marcados', () => {
    const plucks = of('pluck');
    for (let bar = 0; bar < TITLE_THEME_BARS; bar++) {
      const hits = plucks.filter((p) => p.bar === bar);
      expect(hits.length > 0).toBe(TITLE_ARPEGGIO_BARS[bar]);
    }
  });

  it('tira o dedilhado de notas fora da harmonia do compasso', () => {
    for (const pluck of of('pluck')) {
      expect(titleThemeChordAtBar(pluck.bar).arpeggio).toContain(pluck.semitone);
    }
  });
});

describe('melodia da trilha da tela inicial', () => {
  it('tem mais de uma dúzia de notas, com durações válidas', () => {
    expect(TITLE_THEME_MELODY.length).toBeGreaterThanOrEqual(12);
    for (const note of TITLE_THEME_MELODY) {
      expect(note.beats).toBeGreaterThan(0);
      expect(note.level).toBeGreaterThan(0);
      expect(note.level).toBeLessThanOrEqual(1);
      expect(note.beat + note.beats).toBeLessThanOrEqual(
        TITLE_THEME_BARS * TITLE_THEME_BEATS_PER_BAR
      );
    }
  });

  it('não sobrepõe notas umas às outras', () => {
    const sorted = [...TITLE_THEME_MELODY].sort((a, b) => a.beat - b.beat);
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i].beat).toBeGreaterThanOrEqual(sorted[i - 1].beat + sorted[i - 1].beats - 1e-9);
    }
  });

  it('tem contorno: sobe e desce, não fica numa nota só', () => {
    const degrees = TITLE_THEME_MELODY.map((n) => n.semitone);
    expect(new Set(degrees).size).toBeGreaterThanOrEqual(6);
    const first = degrees[0];
    // O ponto mais agudo fica bem acima do começo e há descida depois dele.
    const peak = Math.max(...degrees);
    expect(peak).toBeGreaterThan(first + 4);
    expect(Math.min(...degrees)).toBeLessThan(peak - 8);
  });

  it('termina suspensa na tônica, que só resolve no começo do próximo loop', () => {
    const last = [...TITLE_THEME_MELODY].sort((a, b) => a.beat - b.beat).at(-1)!;
    expect(last.semitone).toBe(0); // Lá4
    expect(last.beat + last.beats).toBeCloseTo(TITLE_THEME_BARS * TITLE_THEME_BEATS_PER_BAR, 6);
    // E o loop recomeça em Lá menor, resolvendo a suspensão.
    expect(titleThemeChordAtBar(0).bass).toBe(-24);
  });

  it('usa a sensível na harmonia de dominante', () => {
    const lastBar = TITLE_THEME_BARS - 1;
    const inDominant = TITLE_THEME_MELODY.filter(
      (n) => Math.floor(n.beat / TITLE_THEME_BEATS_PER_BAR) === lastBar ||
             Math.floor(n.beat / TITLE_THEME_BEATS_PER_BAR) === lastBar - 1
    );
    expect(inDominant.some((n) => n.semitone === -13 + 12)).toBe(true); // Sol#4
  });

  it('cada nota pertence à harmonia que soa junto com ela', () => {
    // Notas de passagem (Fá4 sobre Lá menor, por exemplo) são válidas, mas a
    // maioria precisa estar no acorde: é o que faz a frase soar escrita.
    let inside = 0;
    for (const note of TITLE_THEME_MELODY) {
      const chord = titleThemeChordAtBar(Math.floor(note.beat / TITLE_THEME_BEATS_PER_BAR));
      const pool = [...chord.pad, ...chord.arpeggio, chord.bass];
      const pitch = ((note.semitone % 12) + 12) % 12;
      if (pool.some((s) => ((s % 12) + 12) % 12 === pitch)) inside += 1;
    }
    expect(inside / TITLE_THEME_MELODY.length).toBeGreaterThan(0.6);
  });
});

describe('variação entre passes', () => {
  it('cala a melodia a cada quarto passe', () => {
    expect(titleThemePassVariation(0).melody).toBe(true);
    expect(titleThemePassVariation(2).melody).toBe(true);
    expect(titleThemePassVariation(3).melody).toBe(false);
    expect(titleThemePassVariation(7).melody).toBe(false);
    expect(titleThemePassVariation(8).melody).toBe(true);
  });

  it('alterna o dedilhado a cada passe', () => {
    expect(titleThemePassVariation(0).arpeggio).toBe(true);
    expect(titleThemePassVariation(1).arpeggio).toBe(false);
    expect(titleThemePassVariation(2).arpeggio).toBe(true);
  });

  it('nunca repete a mesma combinação antes de quatro passes', () => {
    const seen = new Set<string>();
    for (let pass = 0; pass < 4; pass++) {
      const v = titleThemePassVariation(pass);
      seen.add(`${v.melody}|${v.arpeggio}`);
    }
    expect(seen.size).toBeGreaterThanOrEqual(3);
  });

  it('aceita passes negativos sem quebrar', () => {
    expect(titleThemePassVariation(-1).melody).toBe(true);
    expect(titleThemePassVariation(-1).arpeggio).toBe(true);
  });
});
