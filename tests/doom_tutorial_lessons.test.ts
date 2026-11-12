/**
 * LIÇÕES DA SALA DE ORIENTAÇÃO (estado puro)
 * ============================================================================
 * A sequência de lições é a parte do tutorial que pode travar o jogo de
 * verdade: uma condição mal escrita deixa o jogador preso numa sala lacrada
 * sem saber o que fazer. Estes testes garantem que:
 *
 *  - toda lição tem um caminho até 100% (nada depende de um evento que pode
 *    nunca chegar);
 *  - as lições andam em ordem e terminam;
 *  - fazer tudo de uma vez não pula etapas — o jogador ainda vê cada lição.
 */

import { describe, expect, it } from 'vitest';
import {
  TUTORIAL_INSTRUCTOR_CELL,
  TUTORIAL_LESSONS,
  TUTORIAL_LESSON_PAUSE_SEC,
  TUTORIAL_ROOM,
  TUTORIAL_SPAWN_CELL,
  TutorialLessonBook,
  TutorialProbe,
} from '../src/doom/DoomTutorial';
import { isSolidCell, LABYRINTH_MAP } from '../src/doom/DoomMazeBuilder';

/** Um quadro "fazendo nada": parado, sem luz, sem bolsos abertos. */
function idleProbe(dt = 1 / 60): TutorialProbe {
  return {
    dt,
    planarSpeed: 0,
    sprinting: false,
    crouching: false,
    flashlightOn: false,
    inventoryOpen: false,
    hasHeldItem: false,
    carriedItemCount: 0,
    usedHeldItemThisFrame: false,
    droppedHeldItemThisFrame: false,
  };
}

/** Roda `frames` quadros com o probe montado por `make`. */
function run(
  book: TutorialLessonBook,
  frames: number,
  make: (frame: number) => TutorialProbe
): void {
  for (let i = 0; i < frames; i++) book.update(make(i));
}

/**
 * Espera o respiro entre lições passar, parado.
 *
 * Sem isso o sinal da lição seguinte é engolido: o livro ignora entrada
 * enquanto a pausa pós-lição corre.
 */
function settle(book: TutorialLessonBook): void {
  run(book, Math.ceil(TUTORIAL_LESSON_PAUSE_SEC * 60) + 6, () => idleProbe());
}

/** Cumpre uma lição cujo critério é um sinal instantâneo (luz, bolsos...). */
function signal(book: TutorialLessonBook, patch: Partial<TutorialProbe>): void {
  settle(book);
  run(book, 2, () => ({ ...idleProbe(), ...patch }));
}

/** Anda a pé (sem correr) a 6 m/s. */
function walking(speed = 6): TutorialProbe {
  return { ...idleProbe(), planarSpeed: speed };
}

describe('lições do tutorial — a sequência em si', () => {
  it('tem nove lições, em ordem de aprendizado', () => {
    expect(TUTORIAL_LESSONS).toHaveLength(9);
    expect(TUTORIAL_LESSONS.map((l) => l.id)).toEqual([
      'move',
      'sprint',
      'crouch',
      'flashlight',
      'inventory',
      'pickup',
      'belt',
      'use',
      'drop',
    ]);
  });

  it('toda lição tem instrução e fala preenchidas', () => {
    for (const lesson of TUTORIAL_LESSONS) {
      expect(lesson.instruction.length).toBeGreaterThan(3);
      expect(lesson.line.length).toBeGreaterThan(10);
    }
  });

  it('começa na primeira lição e zerada', () => {
    const book = new TutorialLessonBook();
    expect(book.isFinished).toBe(false);
    expect(book.lessonNumber).toBe(1);
    expect(book.lessonCount).toBe(TUTORIAL_LESSONS.length);
    expect(book.progress).toBe(0);
    expect(book.currentLesson?.id).toBe('move');
  });

  it('parado no meio da sala, o tutorial não avança sozinho', () => {
    const book = new TutorialLessonBook();
    run(book, 600, () => idleProbe());
    expect(book.lessonNumber).toBe(1);
    expect(book.progress).toBe(0);
  });
});

describe('lições do tutorial — cada uma completa pelo próprio critério', () => {
  it('andar completa a primeira lição', () => {
    const book = new TutorialLessonBook();
    run(book, 90, () => walking());
    // 6 m/s por 1,5 s = 9 m, mais do que os 6 m pedidos.
    expect(book.state.walkedDistance).toBeGreaterThan(6);
    expect(book.lessonNumber).toBe(2);
  });

  it('correr só conta distância de corrida', () => {
    const book = new TutorialLessonBook();
    // Anda primeiro para fechar a lição 1.
    run(book, 90, () => walking());
    // Agora corre: a distância entra nos dois medidores, mas só a de sprint
    // conta para a lição 2.
    const beforeWalk = book.state.walkedDistance;
    run(book, 120, () => ({
      ...walking(9),
      sprinting: true,
    }));
    expect(book.state.walkedDistance).toBeGreaterThan(beforeWalk);
    expect(book.state.sprintDistance).toBeGreaterThan(8);
    expect(book.lessonNumber).toBe(3);
  });

  it('correr sem sair do lugar não conta — precisa haver deslocamento', () => {
    const book = new TutorialLessonBook();
    run(book, 90, () => walking());
    const sprintBefore = book.state.sprintDistance;
    run(book, 300, () => ({ ...idleProbe(), sprinting: true }));
    expect(book.state.sprintDistance).toBe(sprintBefore);
    expect(book.lessonNumber).toBe(2);
  });

  it('agachar completa no tempo certo, não antes', () => {
    const book = new TutorialLessonBook();
    run(book, 90, () => walking());
    run(book, 120, () => ({ ...walking(9), sprinting: true }));
    expect(book.lessonNumber).toBe(3);

    // Meio segundo agachado ainda não basta (o critério é ~0,9 s).
    run(book, 30, () => ({ ...idleProbe(), crouching: true }));
    expect(book.lessonNumber).toBe(3);

    run(book, 40, () => ({ ...idleProbe(), crouching: true }));
    expect(book.lessonNumber).toBe(4);
  });

  it('lanterna, bolsos, item na mão, uso e descarte fecham por sinal', () => {
    const book = new TutorialLessonBook();
    run(book, 90, () => walking());
    run(book, 120, () => ({ ...walking(9), sprinting: true }));
    run(book, 70, () => ({ ...idleProbe(), crouching: true }));
    expect(book.currentLesson?.id).toBe('flashlight');

    signal(book, { flashlightOn: true });
    expect(book.currentLesson?.id).toBe('inventory');

    signal(book, { inventoryOpen: true });
    expect(book.currentLesson?.id).toBe('pickup');

    // Recolher: a contagem de itens carregados sobe.
    signal(book, { carriedItemCount: 2 });
    expect(book.currentLesson?.id).toBe('belt');

    signal(book, { hasHeldItem: true });
    expect(book.currentLesson?.id).toBe('use');

    signal(book, { usedHeldItemThisFrame: true });
    expect(book.currentLesson?.id).toBe('drop');

    signal(book, { droppedHeldItemThisFrame: true });
    expect(book.isFinished).toBe(true);
  });

  it('termina e libera as portas', () => {
    const book = new TutorialLessonBook();
    expect(book.isFinished).toBe(false);
    book.finish();
    expect(book.isFinished).toBe(true);
    expect(book.currentLesson).toBeNull();
    expect(book.progress).toBe(1);
    // Depois de terminado, mais quadros não mudam nada.
    run(book, 120, () => walking());
    expect(book.isFinished).toBe(true);
  });
});

describe('lições do tutorial — proteções', () => {
  it('fazer tudo de uma vez mostra as lições em ordem, sem pular nenhuma', () => {
    const book = new TutorialLessonBook();
    // Jogador apressado: anda, corre, agacha, acende a luz, abre os bolsos,
    // recolhe, saca, usa e larga — tudo no mesmo instante.
    // A contagem de itens só sobe depois de um instante: a lição de recolher
    // mede o que ENTROU na mochila, então precisa haver um antes e um depois.
    const everything = (i: number): TutorialProbe => ({
      dt: 1 / 60,
      planarSpeed: 9,
      sprinting: true,
      crouching: true,
      flashlightOn: true,
      inventoryOpen: true,
      hasHeldItem: true,
      carriedItemCount: i < 30 ? 1 : 3,
      usedHeldItemThisFrame: true,
      droppedHeldItemThisFrame: true,
    });

    const seen: string[] = [];
    for (let i = 0; i < 4000 && !book.isFinished; i++) {
      const lesson = book.currentLesson;
      if (lesson && seen[seen.length - 1] !== lesson.id) seen.push(lesson.id);
      book.update(everything(i));
    }

    // O respiro entre lições obriga a ver todas elas, na ordem.
    expect(seen).toEqual(TUTORIAL_LESSONS.map((l) => l.id));
    expect(book.isFinished).toBe(true);
  });

  it('o respiro entre lições dá tempo de ler a fala anterior', () => {
    const book = new TutorialLessonBook();
    run(book, 90, () => walking());
    expect(book.lessonNumber).toBe(2);

    // Logo depois de completar, a lição seguinte fica congelada um instante:
    // nem andando o progresso sai do zero durante o respiro.
    const lessonBefore = book.currentLesson?.id;
    run(book, 6, () => walking(9));
    expect(book.currentLesson?.id).toBe(lessonBefore);
    expect(book.progress).toBe(0);

    // Depois do respiro, volta a contar (a lição 2 é correr, então precisa
    // vir com o SHIFT junto).
    settle(book);
    run(book, 10, () => ({ ...walking(9), sprinting: true }));
    expect(book.progress).toBeGreaterThan(0);
  });

  it('um quadro gigantesco (aba em segundo plano) não completa tudo de vez', () => {
    const book = new TutorialLessonBook();
    book.update({ ...walking(6), dt: 30 });
    // Anda os 6 m da primeira lição, mas para na segunda.
    expect(book.lessonNumber).toBeLessThanOrEqual(2);
    expect(book.isFinished).toBe(false);
  });

  it('velocidade negativa não faz a distância andar para trás', () => {
    const book = new TutorialLessonBook();
    run(book, 300, () => ({ ...idleProbe(), planarSpeed: -50, dt: -1 }));
    expect(book.state.walkedDistance).toBe(0);
    expect(book.state.sprintDistance).toBe(0);
  });

  it('dt negativo não trava nem retrocede o livro', () => {
    const book = new TutorialLessonBook();
    run(book, 90, () => walking());
    const lesson = book.lessonNumber;
    run(book, 60, () => ({ ...idleProbe(), dt: -5 }));
    expect(book.lessonNumber).toBe(lesson);
    expect(book.lessonNumber).toBeGreaterThanOrEqual(2);
  });

  it('a lição de recolher aceita qualquer item, não só o sinalizador', () => {
    // O critério é "carrega mais do que o kit inicial", então pegar qualquer
    // coisa pelo caminho também conta — o tutorial não pode travar porque o
    // jogador pegou um item diferente do que estava no chão.
    const book = new TutorialLessonBook();
    run(book, 90, () => walking());
    run(book, 120, () => ({ ...walking(9), sprinting: true }));
    run(book, 70, () => ({ ...idleProbe(), crouching: true }));
    signal(book, { flashlightOn: true });
    signal(book, { inventoryOpen: true });
    expect(book.currentLesson?.id).toBe('pickup');

    signal(book, { carriedItemCount: 5 });
    expect(book.currentLesson?.id).toBe('belt');
  });
});

describe('sala de orientação — a câmara no mapa', () => {
  const walkable = (gx: number, gz: number) => !isSolidCell(LABYRINTH_MAP, gx, gz);

  it('as nove células da sala são todas caminháveis', () => {
    let open = 0;
    for (let gz = TUTORIAL_ROOM.minGz; gz <= TUTORIAL_ROOM.maxGz; gz++) {
      for (let gx = TUTORIAL_ROOM.minGx; gx <= TUTORIAL_ROOM.maxGx; gx++) {
        if (walkable(gx, gz)) open += 1;
      }
    }
    expect(open).toBe(9);
  });

  it('a sala tem exatamente três saídas — é por isso que foi escolhida', () => {
    const openings: string[] = [];
    for (let gx = TUTORIAL_ROOM.minGx; gx <= TUTORIAL_ROOM.maxGx; gx++) {
      if (walkable(gx, TUTORIAL_ROOM.minGz - 1)) openings.push(`N${gx}`);
      if (walkable(gx, TUTORIAL_ROOM.maxGz + 1)) openings.push(`S${gx}`);
    }
    for (let gz = TUTORIAL_ROOM.minGz; gz <= TUTORIAL_ROOM.maxGz; gz++) {
      if (walkable(TUTORIAL_ROOM.minGx - 1, gz)) openings.push(`O${gz}`);
      if (walkable(TUTORIAL_ROOM.maxGx + 1, gz)) openings.push(`L${gz}`);
    }
    // Três saídas = três comportas. Se o mapa mudar e aparecer uma quarta,
    // o jogador escapa da sala sem terminar a lição.
    expect(openings).toHaveLength(3);
    // A saída do sul é a porta principal; as duas do oeste são comportas de
    // serviço. Se essa lista mudar, as comportas precisam ser recalculadas.
    expect(openings.sort()).toEqual(['O3', 'O5', 'S23']);
  });

  it('o jogador e o instrutor nascem dentro da sala', () => {
    const inside = (gx: number, gz: number) =>
      gx >= TUTORIAL_ROOM.minGx &&
      gx <= TUTORIAL_ROOM.maxGx &&
      gz >= TUTORIAL_ROOM.minGz &&
      gz <= TUTORIAL_ROOM.maxGz;

    expect(inside(TUTORIAL_SPAWN_CELL.gx, TUTORIAL_SPAWN_CELL.gz)).toBe(true);
    expect(
      inside(TUTORIAL_INSTRUCTOR_CELL.gx, TUTORIAL_INSTRUCTOR_CELL.gz)
    ).toBe(true);
    expect(walkable(TUTORIAL_SPAWN_CELL.gx, TUTORIAL_SPAWN_CELL.gz)).toBe(true);
    expect(
      walkable(TUTORIAL_INSTRUCTOR_CELL.gx, TUTORIAL_INSTRUCTOR_CELL.gz)
    ).toBe(true);
  });
});

describe('lições do tutorial — saída de emergência', () => {
  it('não oferece pular enquanto a lição está andando', () => {
    const book = new TutorialLessonBook();
    run(book, 120, () => walking());
    expect(book.isStuck).toBe(false);
  });

  it('oferece pular depois de muito tempo travado', () => {
    const book = new TutorialLessonBook();
    // Parado desde o começo: 45 s sem sair do lugar.
    run(book, 45 * 60, () => idleProbe());
    expect(book.isStuck).toBe(true);
  });

  it('quem avança devagar não é tratado como travado', () => {
    const book = new TutorialLessonBook();
    // Anda bem devagar (0,05 m/s): em 45 s cobre 2,25 m dos 6 m pedidos, mas
    // está SEMPRE progredindo — o contador de travamento nunca acumula.
    run(book, 45 * 60, () => ({ ...idleProbe(), planarSpeed: 0.05 }));
    expect(book.progress).toBeGreaterThan(0);
    expect(book.progress).toBeLessThan(1);
    expect(book.isStuck).toBe(false);
  });

  it('pular passa para a lição seguinte sem cumprir a atual', () => {
    const book = new TutorialLessonBook();
    expect(book.currentLesson?.id).toBe('move');
    book.skipLesson();
    expect(book.currentLesson?.id).toBe('sprint');
    expect(book.progress).toBe(0);
  });

  it('pular a última lição encerra o tutorial', () => {
    const book = new TutorialLessonBook();
    for (let i = 0; i < TUTORIAL_LESSONS.length; i++) book.skipLesson();
    expect(book.isFinished).toBe(true);
  });

  it('pular depois de terminado não faz nada', () => {
    const book = new TutorialLessonBook();
    book.finish();
    book.skipLesson();
    expect(book.isFinished).toBe(true);
    expect(book.currentLesson).toBeNull();
  });

  it('um jogador completamente perdido consegue sair da sala', () => {
    const book = new TutorialLessonBook();
    // Parado para sempre, mas apertando [ENTER] de vez em quando.
    for (let i = 0; i < 6000 && !book.isFinished; i++) {
      book.update(idleProbe());
      if (i % 120 === 0) book.skipLesson();
    }
    expect(book.isFinished).toBe(true);
  });
});
