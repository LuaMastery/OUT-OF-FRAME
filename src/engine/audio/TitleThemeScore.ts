/**
 * PARTITURA DA TRILHA DA TELA INICIAL
 * ============================================================================
 * A música da tela de título era um acorde de Lá menor parado no tempo com uma
 * nota solitária a cada quatro segundos — tecnicamente um drone, não uma
 * trilha. Não havia para onde ir: sem ritmo, sem movimento harmônico, sem
 * frase. Este módulo descreve a música de forma PURA (números e tempos) para
 * que `SoundEngine` apenas a execute; assim a composição fica legível e
 * testável, como o resto do motor de áudio.
 *
 * A escrita parte de três decisões:
 *
 *  1. MOVIMENTO HARMÔNICO — o baixo desce Lá → Sol → Fá → Mi (o tetracorde
 *     "lamento", o esqueleto de praticamente toda música de terror desde o
 *     barroco). São oito compassos, dois por harmonia, e o Sol sustenido do
 *     acorde de Mi é a sensível do menor harmônico: é ele que faz a volta para
 *     casa doer em vez de apenas acontecer.
 *
 *  2. PULSO — nada soava porque nada batia. Um bumbo abafado em 1 e 3, com o
 *     "dub" colado na primeira, dá o coração da coisa sem virar batida.
 *
 *  3. FRASE — a melodia tem contorno, respiro e uma resolução: sobe, suspira,
 *     desce, e na última harmonia fica suspensa num Lá que só resolve quando o
 *     loop recomeça.
 *
 * Tudo é escrito em SEMITONS acima do Lá4 (440 Hz), não em hertz: a leitura
 * fica musical (um número por nota) e a afinação sai de uma fórmula só.
 */

/** Semitons acima do Lá4 (440 Hz) → frequência em Hz. */
export function titleNoteHz(semitonesFromA4: number): number {
  return 440 * 2 ** (semitonesFromA4 / 12);
}

// ---------------------------------------------------------------------------
// Andamento e forma
// ---------------------------------------------------------------------------

/** Andamento: lento o bastante para soar solene, não arrastado. */
export const TITLE_THEME_BPM = 72;
/** Duração de uma semínima em segundos. */
export const TITLE_THEME_BEAT_SEC = 60 / TITLE_THEME_BPM;
export const TITLE_THEME_BEATS_PER_BAR = 4;
export const TITLE_THEME_BARS = 8;
/** Duração de um passe completo do loop, em segundos (~26,7 s). */
export const TITLE_THEME_LOOP_SEC =
  TITLE_THEME_BARS * TITLE_THEME_BEATS_PER_BAR * TITLE_THEME_BEAT_SEC;

// ---------------------------------------------------------------------------
// Harmonias (uma entrada por compasso)
// ---------------------------------------------------------------------------

export interface TitleChordSpec {
  readonly name: string;
  /** Baixo, em semitons acima do Lá4. */
  readonly bass: number;
  /** Vozes do colchão, do grave para o agudo. */
  readonly pad: readonly number[];
  /** Notas que o dedilhado pode escolher. */
  readonly arpeggio: readonly number[];
}

/** Lá menor: a tônica, escura e sem pressa. */
const AM: TitleChordSpec = {
  name: 'Am',
  bass: -24, // Lá2
  pad: [-12, -9, -5, 0], // Lá3, Dó4, Mi4, Lá4
  arpeggio: [-12, -5, 0, 3, -9],
};

/** Lá menor com Sétima sobre Sol: a mesma cor, um degrau abaixo. */
const AM7_OVER_G: TitleChordSpec = {
  name: 'Am7/G',
  bass: -26, // Sol2
  pad: [-14, -12, -9, -5], // Sol3, Lá3, Dó4, Mi4
  arpeggio: [-14, -9, -5, -2],
};

/** Fá maior: o alívio — o ponto mais claro do passe. */
const F: TitleChordSpec = {
  name: 'F',
  bass: -28, // Fá2
  pad: [-16, -12, -9, -4], // Fá3, Lá3, Dó4, Fá4
  arpeggio: [-16, -9, -4, 0],
};

/** Mi maior com a sensível do menor harmônico: a tensão que pede volta. */
const E: TitleChordSpec = {
  name: 'E',
  bass: -29, // Mi2
  pad: [-17, -13, -10, -5], // Mi3, Sol#3, Si3, Mi4
  arpeggio: [-17, -10, -5, -1],
};

/** A progressão, compasso por compasso: i → i7/VII → VI → V. */
export const TITLE_THEME_CHORDS: readonly TitleChordSpec[] = [
  AM, AM, AM7_OVER_G, AM7_OVER_G, F, F, E, E,
];

/** Harmonia de um compasso, com volta automática ao início do loop. */
export function titleThemeChordAtBar(bar: number): TitleChordSpec {
  const total = TITLE_THEME_CHORDS.length;
  const wrapped = ((Math.floor(bar) % total) + total) % total;
  return TITLE_THEME_CHORDS[wrapped];
}

// ---------------------------------------------------------------------------
// Padrões rítmicos
// ---------------------------------------------------------------------------

export interface TitleRhythmHit {
  /** Posição dentro do compasso, em tempos. */
  readonly beat: number;
  readonly level: number;
}

/**
 * Coração da trilha: uma pancada em 1 e outra em 3, com o "dub" grudado na
 * primeira. Soa como batida abafada vinda de outra sala — não como bateria.
 */
export const TITLE_PULSE_PATTERN: readonly TitleRhythmHit[] = [
  { beat: 0, level: 1.0 },
  { beat: 0.5, level: 0.42 },
  { beat: 2, level: 0.7 },
  { beat: 2.5, level: 0.3 },
];

/**
 * Intensidade do pulso por compasso. Vai rarefazendo no fim: o silêncio antes
 * da resolução é o que dá peso à volta do loop.
 *   2 = padrão completo · 1 = só a primeira pancada · 0 = silêncio.
 */
export const TITLE_PULSE_BARS: readonly number[] = [2, 2, 2, 2, 2, 2, 1, 0];

/** Onde o dedilhado toca, dentro do compasso. */
export const TITLE_ARPEGGIO_BEATS: readonly number[] = [0, 1.5, 2.5, 3.5];
/** Em quais compassos o dedilhado aparece (respira nos demais). */
export const TITLE_ARPEGGIO_BARS: readonly boolean[] = [
  true, true, true, false, true, true, true, false,
];

/** Baixo: raiz no tempo 1 e reforço sincopado no tempo 3. */
export const TITLE_BASS_HITS: readonly TitleRhythmHit[] = [
  { beat: 0, level: 0.9 },
  { beat: 2.5, level: 0.5 },
];

// ---------------------------------------------------------------------------
// Melodia
// ---------------------------------------------------------------------------

export interface TitleMelodyNote {
  /** Posição no loop, em tempos (0 a 32). */
  readonly beat: number;
  readonly beats: number;
  /** Altura em semitons acima do Lá4. */
  readonly semitone: number;
  readonly level: number;
}

/**
 * A frase, em duas metades de quatro compassos.
 *
 * A primeira metade desenha um suspiro: sobe ao Mi, encosta no Fá vizinho e
 * desce até o Si, com um Sal-Dó no meio para não ficar previsível. A segunda
 * responde mais aguda (Lá–Dó sobre o Fá, o ponto claro), e na dominante fica
 * suspensa num Lá que atravessa o compasso final sem resolver — resolução só
 * quando o loop recomeça em Lá menor.
 */
export const TITLE_THEME_MELODY: readonly TitleMelodyNote[] = [
  // ---- Primeira metade: Lá menor → Lá menor com sétima sobre Sol ----
  { beat: 0, beats: 1.5, semitone: -5, level: 0.85 }, // Mi4
  { beat: 1.5, beats: 0.5, semitone: -4, level: 0.6 }, // Fá4 (vizinho superior)
  { beat: 2, beats: 1.0, semitone: -5, level: 0.7 }, // Mi4
  { beat: 3, beats: 1.0, semitone: -9, level: 0.62 }, // Dó4 (aponjatura para o Si)
  { beat: 4, beats: 2.0, semitone: -10, level: 0.78 }, // Si3
  { beat: 6, beats: 1.0, semitone: -7, level: 0.58 }, // Ré4
  { beat: 7, beats: 1.0, semitone: -9, level: 0.6 }, // Dó4
  { beat: 8, beats: 2.0, semitone: -2, level: 0.8 }, // Sol4
  { beat: 10, beats: 1.5, semitone: -5, level: 0.55 }, // Mi4
  { beat: 11.5, beats: 0.5, semitone: -2, level: 0.5 }, // Sol4
  { beat: 12, beats: 2.0, semitone: -9, level: 0.7 }, // Dó4
  { beat: 14, beats: 2.0, semitone: -10, level: 0.72 }, // Si3
  // ---- Segunda metade: Fá → Mi ----
  { beat: 16, beats: 2.0, semitone: 0, level: 0.85 }, // Lá4
  { beat: 18, beats: 1.0, semitone: 3, level: 0.62 }, // Dó5
  { beat: 19, beats: 1.0, semitone: 0, level: 0.58 }, // Lá4
  { beat: 20, beats: 2.0, semitone: -4, level: 0.75 }, // Fá4
  { beat: 22, beats: 2.0, semitone: -5, level: 0.7 }, // Mi4
  { beat: 24, beats: 1.0, semitone: 2, level: 0.62 }, // Si4
  { beat: 25, beats: 3.0, semitone: -1, level: 0.84 }, // Sol#4 (sensível)
  { beat: 28, beats: 4.0, semitone: 0, level: 0.92 }, // Lá4 — fica suspenso
];

// ---------------------------------------------------------------------------
// Eventos de um passe do loop
// ---------------------------------------------------------------------------

export type TitleEventKind = 'pad' | 'bass' | 'lead' | 'pluck' | 'pulse' | 'creak';

export interface TitleEvent {
  readonly kind: TitleEventKind;
  /** Posição no loop, em tempos. */
  readonly beat: number;
  /** Altura em semitons acima do Lá4 (ignorada por pulso e rangido). */
  readonly semitone: number;
  /** Duração em tempos (ignorada por pulso, pad e rangido). */
  readonly beats: number;
  readonly level: number;
  readonly bar: number;
}

/** Rangido metálico distante: dois por passe, para o ambiente não soar limpo. */
const CREAK_BEATS: readonly number[] = [13.5, 29.5];

/**
 * Monta a lista de eventos de UM PASSE do loop, ordenada por tempo.
 *
 * O `SoundEngine` agenda olhando para frente ao longo desta lista e recomeça
 * quando ela termina — por isso tudo aqui precisa estar em tempos absolutos
 * dentro do passe, nunca em deltas.
 */
export function buildTitleThemeEvents(): readonly TitleEvent[] {
  const events: TitleEvent[] = [];

  // Colchão: uma entrada por compasso, para as vozes deslizarem no momento
  // certo em vez de ficarem num acorde único.
  for (let bar = 0; bar < TITLE_THEME_BARS; bar++) {
    events.push({
      kind: 'pad',
      beat: bar * TITLE_THEME_BEATS_PER_BAR,
      semitone: 0,
      beats: TITLE_THEME_BEATS_PER_BAR,
      level: 1,
      bar,
    });
  }

  for (let bar = 0; bar < TITLE_THEME_BARS; bar++) {
    const chord = titleThemeChordAtBar(bar);
    const barBeat = bar * TITLE_THEME_BEATS_PER_BAR;

    for (const hit of TITLE_BASS_HITS) {
      // O último compasso fica sem o reforço: o baixo sustenta a resolução.
      if (hit.beat > 0 && bar === TITLE_THEME_BARS - 1) continue;
      events.push({
        kind: 'bass',
        beat: barBeat + hit.beat,
        semitone: chord.bass,
        beats: hit.beat === 0 ? 1.9 : 1.2,
        level: hit.level,
        bar,
      });
    }

    const pulse = TITLE_PULSE_BARS[bar] ?? 0;
    if (pulse > 0) {
      for (const hit of TITLE_PULSE_PATTERN) {
        if (pulse === 1 && hit.beat > 0.5) continue;
        events.push({
          kind: 'pulse',
          beat: barBeat + hit.beat,
          semitone: chord.bass,
          beats: 0,
          level: hit.level,
          bar,
        });
      }
    }

    if (TITLE_ARPEGGIO_BARS[bar]) {
      TITLE_ARPEGGIO_BEATS.forEach((offset, i) => {
        const step = bar * TITLE_ARPEGGIO_BEATS.length + i;
        const note = chord.arpeggio[step % chord.arpeggio.length];
        events.push({
          kind: 'pluck',
          beat: barBeat + offset,
          semitone: note,
          beats: 0.5,
          level: 0.55 + (i % 2 === 0 ? 0.25 : 0),
          bar,
        });
      });
    }
  }

  for (const note of TITLE_THEME_MELODY) {
    events.push({
      kind: 'lead',
      beat: note.beat,
      semitone: note.semitone,
      beats: note.beats,
      level: note.level,
      bar: Math.floor(note.beat / TITLE_THEME_BEATS_PER_BAR),
    });
  }

  for (const beat of CREAK_BEATS) {
    events.push({
      kind: 'creak',
      beat,
      semitone: 0,
      beats: 0,
      level: 0.5,
      bar: Math.floor(beat / TITLE_THEME_BEATS_PER_BAR),
    });
  }

  return events.sort((a, b) => a.beat - b.beat);
}

/**
 * Variação por passe: sem ela o loop de 27 segundos cansaria em dois minutos.
 *
 *  - a cada 4º passe a melodia cala (só harmonia e pulso);
 *  - nos passes ímpares o dedilhado sai de cena.
 */
export function titleThemePassVariation(pass: number): {
  melody: boolean;
  arpeggio: boolean;
} {
  const safe = Math.max(0, Math.floor(pass));
  return {
    melody: safe % 4 !== 3,
    arpeggio: safe % 2 === 0,
  };
}
