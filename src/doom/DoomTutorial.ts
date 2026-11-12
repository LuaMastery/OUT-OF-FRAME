/**
 * Sala de Orientação — o tutorial de OUT-OF-FRAME.
 *
 * Só aparece para quem nunca jogou (ou para quem pediu para rever). O jogador
 * acorda numa câmara selada do setor nordeste com um INSTRUTOR: outro
 * astronauta, com exatamente a mesma modelagem 3D do protagonista, que ensina
 * os comandos um de cada vez. Quando a última lição termina, o instrutor se
 * afasta e as comportas sobem — aí sim a incursão começa de verdade.
 *
 * Três decisões que explicam o formato do código:
 *
 * 1. A sala é uma CÂMARA REAL do labirinto, não um mapa separado. Ela fica em
 *    gx 23..25 / gz 3..5 — o retângulo aberto de 3x3 com menos saídas de todo
 *    o mapa (só três). A gente lacra as três saídas com comportas e pronto:
 *    nenhuma teleporte, nenhuma transição, nenhum mundo paralelo. Quando as
 *    comportas sobem, o jogador simplesmente sai andando para o resto do
 *    labirinto, que já estava construído o tempo todo.
 *
 * 2. O instrutor é uma segunda instância de `DoomAstronaut`. Mesma malha,
 *    mesmo traje, mesma lanterna de terceira pessoa — é literalmente "outro
 *    você", como no Lethal Company.
 *
 * 3. Cada lição é uma função de progresso que devolve 0..1. Nenhuma lição
 *    depende de um evento específico do motor: elas observam o ESTADO do
 *    jogador (quanto andou, se está agachado, se a lanterna acendeu). Isso
 *    torna o tutorial impossível de travar — se o jogador fizer a ação de um
 *    jeito imprevisto, a lição simplesmente completa igual.
 */

import * as THREE from 'three';
import { DoomAstronaut } from './DoomAstronaut';
import {
  CELL_SIZE,
  DoomLightSource,
  gridCellToWorld,
  WALL_HEIGHT,
} from './DoomMazeBuilder';
import { applyMetricBoxUvs } from './DoomObstacles';
import { createDoomPropMaterial, DoomSharedUniforms } from './DoomShader';
import { DoomTextureSet } from './DoomTextures';
import { StaticColliderBox } from '../engine/physics/SpatialSweep';

/** O retângulo da sala em coordenadas de grade (3x3 células = 9m x 9m). */
export const TUTORIAL_ROOM = {
  minGx: 23,
  maxGx: 25,
  minGz: 3,
  maxGz: 5,
} as const;

/** Célula onde o jogador acorda. */
export const TUTORIAL_SPAWN_CELL = { gx: 24, gz: 4 } as const;

/** Célula do instrutor — entre o jogador e a porta principal. */
export const TUTORIAL_INSTRUCTOR_CELL = { gx: 23, gz: 4 } as const;

/**
 * As três saídas da sala, cada uma entre uma célula de dentro e uma de fora.
 *
 * A primeira é a PORTA principal: é a que o instrutor aponta no fim e a que
 * recebe o letreiro. As outras duas são comportas de serviço — sobem juntas,
 * para a sala não virar uma armadilha depois do tutorial.
 */
interface RoomOpening {
  /** Célula de dentro da sala. */
  readonly fromGx: number;
  readonly fromGz: number;
  /** Célula de fora, adjacente. */
  readonly toGx: number;
  readonly toGz: number;
  readonly isMainDoor: boolean;
}

const ROOM_OPENINGS: ReadonlyArray<RoomOpening> = [
  { fromGx: 23, fromGz: 5, toGx: 22, toGz: 5, isMainDoor: true },
  { fromGx: 23, fromGz: 3, toGx: 22, toGz: 3, isMainDoor: false },
  { fromGx: 23, fromGz: 5, toGx: 23, toGz: 6, isMainDoor: false },
];

/**
 * O que o jogo entrega ao tutorial a cada quadro.
 *
 * Tudo aqui é leitura de estado — o tutorial nunca empurra nada de volta.
 */
export interface TutorialProbe {
  dt: number;
  /** Velocidade planar do jogador (m/s). */
  planarSpeed: number;
  /** Está correndo de verdade (e não só andando). */
  sprinting: boolean;
  /** Está agachado ou deslizando. */
  crouching: boolean;
  /** A lanterna está acesa e na mão. */
  flashlightOn: boolean;
  /** A tela de bolsos [Tab] está aberta. */
  inventoryOpen: boolean;
  /** Existe algo na mão (cinto com item). */
  hasHeldItem: boolean;
  /** Quantos itens o jogador carrega somando as pilhas. */
  carriedItemCount: number;
  /** O jogador acabou de usar o item da mão neste quadro. */
  usedHeldItemThisFrame: boolean;
  /** O jogador acabou de largar o item da mão no chão. */
  droppedHeldItemThisFrame: boolean;
}

/** Estado acumulado entre quadros, usado pelas lições. */
export interface TutorialRuntime {
  walkedDistance: number;
  sprintDistance: number;
  crouchTime: number;
  peakCarried: number;
  /**
   * Quantos itens o jogador já carregava ao entrar na sala.
   *
   * A lição de recolher mede o que ENTROU depois, não o total — senão o kit
   * inicial (a lanterna) já deixaria a barra meio cheia antes de o jogador
   * fazer qualquer coisa.
   */
  baselineCarried: number | null;
  usedItem: boolean;
  droppedItem: boolean;
  heldItem: boolean;
  flashlightSeen: boolean;
  inventorySeen: boolean;
}

export function createTutorialRuntime(): TutorialRuntime {
  return {
    walkedDistance: 0,
    sprintDistance: 0,
    crouchTime: 0,
    peakCarried: 0,
    baselineCarried: null,
    usedItem: false,
    droppedItem: false,
    heldItem: false,
    flashlightSeen: false,
    inventorySeen: false,
  };
}

/** Uma lição do tutorial. */
export interface TutorialLesson {
  readonly id: string;
  /** O que fazer, curto (a linha de cima do painel). */
  readonly instruction: string;
  /** Fala do instrutor (a linha de baixo). */
  readonly line: string;
  /** Quanto o jogador já fez desta lição, de 0 a 1. */
  progress(runtime: TutorialRuntime, probe: TutorialProbe): number;
}

export const TUTORIAL_LESSONS: ReadonlyArray<TutorialLesson> = [
  {
    id: 'move',
    instruction: 'ANDE COM [W] [A] [S] [D]',
    line: 'Acorda, operador. Respira. Primeiro: meça o próprio corpo — caminhe até o outro lado da câmara.',
    progress: (rt) => Math.min(1, rt.walkedDistance / 6),
  },
  {
    id: 'sprint',
    instruction: 'CORRE SEGANDO [SHIFT]',
    line: 'Isso aí é passo de enterro. Segure SHIFT e corra — correr salva vida, e faz barulho. Escolha bem quando.',
    progress: (rt) => Math.min(1, rt.sprintDistance / 8),
  },
  {
    id: 'crouch',
    instruction: 'AGACHE SEGANDO [CTRL]',
    line: 'Agora o contrário: CTRL te abaixa. Agachado você faz menos barulho — e passa por baixo de viga arriada.',
    progress: (rt) => Math.min(1, rt.crouchTime / 0.9),
  },
  {
    id: 'flashlight',
    instruction: 'ACENDA A LANTERNA COM [F]',
    line: 'Sem luz você não vê a teia antes de encostar nela. Aperte F. A bateria gasta, então não esqueça dela acesa.',
    progress: (_rt, probe) => (probe.flashlightOn ? 1 : 0),
  },
  {
    id: 'inventory',
    instruction: 'ABRA OS BOLSOS COM [TAB]',
    line: 'TAB abre os bolsos. É lá que você vê o que carrega, lê os bilhetes e organiza o cinto.',
    progress: (_rt, probe) => (probe.inventoryOpen ? 1 : 0),
  },
  {
    id: 'pickup',
    instruction: 'ENCOSTE NO SINALIZADOR E PEGUE',
    line: 'Pegue aquele sinalizador no chão — é só encostar. Recolher é de graça; carregar é que ocupa bolso.',
    progress: (rt) => {
      const baseline = rt.baselineCarried ?? 0;
      return Math.min(1, Math.max(0, rt.peakCarried - baseline) / 1);
    },
  },
  {
    id: 'belt',
    instruction: 'PASSE UM ITEM PARA A MÃO COM [1]',
    line: 'No cinto, os números de 1 a 4 só TROCAM o que está na mão. Nada se gasta apertando número — isso aqui é cinto, não gatilho.',
    progress: (_rt, probe) => (probe.hasHeldItem ? 1 : 0),
  },
  {
    id: 'use',
    instruction: 'USE O ITEM DA MÃO COM [E] OU CLIQUE',
    line: 'Agora usa. E, ou o botão esquerdo. Se houver algo para interagir na sua frente, o comando interage; se não houver, ele usa o que está na mão.',
    progress: (rt) => (rt.usedItem ? 1 : 0),
  },
  {
    id: 'drop',
    instruction: 'LARGUE NO CHÃO COM [Q]',
    line: 'Última: Q larga. O item volta a ser um objeto do mundo, e quem chegar depois pode pegar. Largar também alivia o bolso.',
    progress: (rt) => (rt.droppedItem ? 1 : 0),
  },
];

/** Segundos de respiro entre uma lição e a próxima. */
export const TUTORIAL_LESSON_PAUSE_SEC = 1.1;

/**
 * Quantos segundos parado na mesma lição antes de oferecer a saída.
 *
 * Ninguém deve ficar preso numa sala lacrada por não ter entendido um passo.
 * Depois desse tempo o painel oferece pular a lição com [Enter].
 */
export const TUTORIAL_STUCK_SEC = 40;

/**
 * A sequência de lições: estado puro, sem THREE e sem DOM.
 *
 * Separada do resto da sala justamente para poder ser testada sozinha. Ela só
 * observa o estado do jogador — nunca empurra nada de volta — e por isso é
 * impossível de travar: se o jogador fizer a ação de um jeito imprevisto, a
 * lição simplesmente completa do mesmo jeito.
 */
export class TutorialLessonBook {
  private readonly runtime = createTutorialRuntime();
  private stepIndex = 0;
  private stepProgress = 0;
  private pauseRemaining = 0;
  private finished = false;
  /** Segundos acumulados sem a lição atual sair do lugar. */
  private stuckSeconds = 0;
  /** Último progresso visto, para detectar que a lição empacou. */
  private lastSeenProgress = 0;

  /** Já passou por todas as lições? */
  get isFinished(): boolean {
    return this.finished;
  }

  /** Progresso da lição atual, de 0 a 1. */
  get progress(): number {
    return this.finished ? 1 : this.stepProgress;
  }

  /** Número da lição atual, contando a partir de 1. */
  get lessonNumber(): number {
    return Math.min(this.stepIndex + 1, TUTORIAL_LESSONS.length);
  }

  get lessonCount(): number {
    return TUTORIAL_LESSONS.length;
  }

  /** A lição da vez (`null` quando o tutorial já acabou). */
  get currentLesson(): TutorialLesson | null {
    if (this.finished) return null;
    return TUTORIAL_LESSONS[this.stepIndex] ?? null;
  }

  /** Estado acumulado (exposto para inspeção e testes). */
  get state(): Readonly<TutorialRuntime> {
    return this.runtime;
  }

  /** O jogador está empacado nesta lição há tempo demais? */
  get isStuck(): boolean {
    return !this.finished && this.stuckSeconds >= TUTORIAL_STUCK_SEC;
  }

  /** Avança um quadro. */
  update(probe: TutorialProbe): void {
    this.accumulate(probe);
    if (this.finished) return;

    // Respiro entre lições: sem isso a fala do instrutor troca tão rápido que
    // o jogador não chega a ler a anterior.
    if (this.pauseRemaining > 0) {
      this.pauseRemaining -= probe.dt;
      return;
    }

    const lesson = TUTORIAL_LESSONS[this.stepIndex];
    if (!lesson) {
      this.finish();
      return;
    }

    const raw = lesson.progress(this.runtime, probe);
    this.stepProgress = Math.min(1, Number.isFinite(raw) ? Math.max(0, raw) : 0);

    // Empacou? Só conta tempo parado quando o progresso não muda — quem está
    // avançando devagar ainda está avançando.
    if (this.stepProgress > this.lastSeenProgress + 1e-4) {
      this.lastSeenProgress = this.stepProgress;
      this.stuckSeconds = 0;
    } else {
      this.stuckSeconds += Math.max(0, probe.dt);
    }

    if (this.stepProgress >= 1) {
      this.stepIndex += 1;
      this.stepProgress = 0;
      this.lastSeenProgress = 0;
      this.stuckSeconds = 0;
      this.pauseRemaining = TUTORIAL_LESSON_PAUSE_SEC;
      if (this.stepIndex >= TUTORIAL_LESSONS.length) this.finish();
    }
  }

  /**
   * Passa adiante sem cumprir a lição atual.
   *
   * É a válvula de escape: se o jogador não entendeu o que fazer, ele sai
   * mesmo assim em vez de ficar trancado na câmara.
   */
  skipLesson(): void {
    if (this.finished) return;
    this.stepIndex += 1;
    this.stepProgress = 0;
    this.lastSeenProgress = 0;
    this.stuckSeconds = 0;
    this.pauseRemaining = 0;
    if (this.stepIndex >= TUTORIAL_LESSONS.length) this.finish();
  }

  /** Conclui o tutorial na hora (usado quando o jogador pede para pular). */
  finish(): void {
    if (this.finished) return;
    this.finished = true;
    this.stepIndex = TUTORIAL_LESSONS.length;
    this.stepProgress = 1;
    this.pauseRemaining = 0;
    this.stuckSeconds = 0;
  }

  private accumulate(probe: TutorialProbe): void {
    const rt = this.runtime;
    const distance = Math.max(0, probe.planarSpeed) * Math.max(0, probe.dt);
    rt.walkedDistance += distance;
    if (probe.sprinting) rt.sprintDistance += distance;
    if (probe.crouching) rt.crouchTime += probe.dt;
    if (probe.flashlightOn) rt.flashlightSeen = true;
    if (probe.inventoryOpen) rt.inventorySeen = true;
    if (rt.baselineCarried === null) rt.baselineCarried = probe.carriedItemCount;
    rt.peakCarried = Math.max(rt.peakCarried, probe.carriedItemCount);
    if (probe.usedHeldItemThisFrame) rt.usedItem = true;
    if (probe.droppedHeldItemThisFrame) rt.droppedItem = true;
    rt.heldItem = probe.hasHeldItem;
  }
}

/** Uma comporta de aço que sela uma das saídas. */
interface Shutter {
  readonly name: string;
  readonly group: THREE.Group;
  readonly panel: THREE.Mesh;
  readonly collider: StaticColliderBox;
  /** Altura fechada (y do centro do painel). */
  readonly closedY: number;
  /** Quanto o painel já subiu, 0..1. */
  lift: number;
  readonly isMainDoor: boolean;
  readonly ledMaterial: THREE.ShaderMaterial;
}

export class DoomTutorial {
  private readonly root = new THREE.Group();
  private readonly instructor: DoomAstronaut;
  private readonly shutters: Shutter[] = [];
  private readonly disposables: Array<{ dispose: () => void }> = [];

  private readonly panelEl: HTMLElement;
  private readonly stepCounterEl: HTMLElement;
  private readonly instructionEl: HTMLElement;
  private readonly lineEl: HTMLElement;
  private readonly progressFillEl: HTMLElement;

  /** A sequência de lições — estado puro, testada separadamente. */
  private readonly lessons = new TutorialLessonBook();
  private instructorBob = 0;
  private readonly instructorPos = new THREE.Vector3();
  private readonly instructorHome = new THREE.Vector3();
  private readonly instructorAway = new THREE.Vector3();
  private instructorYaw = 0;
  /** Último texto escrito no painel, para não reescrever 60 vezes por segundo. */
  private lastRendered = '';
  /** 0 = na frente da porta, 1 = encostado na parede, fora do caminho. */
  private instructorStepAside = 0;

  constructor(
    private readonly scene: THREE.Scene,
    sharedUniforms: DoomSharedUniforms,
    textures: DoomTextureSet,
    private readonly colliders: StaticColliderBox[],
    viewportEl: HTMLElement
  ) {
    this.root.name = 'DoomTutorialRoom';
    this.scene.add(this.root);

    // ── Comportas ────────────────────────────────────────────────────────
    const matShutter = createDoomPropMaterial(textures.metalTrim, sharedUniforms, {
      baseLight: 0.62,
      shading: 0.8,
      specular: 0.32,
      occlusion: 0.5,
    });
    const matFrame = createDoomPropMaterial(textures.darkIron, sharedUniforms, {
      baseLight: 0.5,
      shading: 0.7,
      specular: 0.18,
      occlusion: 0.6,
    });
    const matLed = createDoomPropMaterial(textures.lightPanel, sharedUniforms, {
      baseLight: 1,
      emissiveBoost: 1.4,
      tint: new THREE.Color(0xff5a44),
    });
    this.disposables.push(matShutter, matFrame, matLed);

    ROOM_OPENINGS.forEach((opening, index) => {
      const shutter = this.buildShutter(
        opening,
        index,
        matShutter,
        matFrame,
        matLed
      );
      this.shutters.push(shutter);
      this.colliders.push(shutter.collider);
    });

    // ── Luminária e luz da sala ──────────────────────────────────────────
    // A câmara não tem luminária própria no mapa; sem isso o jogador
    // começaria a primeira lição no escuro.
    const center = gridCellToWorld(TUTORIAL_SPAWN_CELL.gx, TUTORIAL_SPAWN_CELL.gz);
    const lampY = WALL_HEIGHT - 0.28;
    const lampGeo = new THREE.BoxGeometry(0.9, 0.14, 0.9);
    applyMetricBoxUvs(lampGeo, 0.9, 0.14, 0.9);
    const lamp = new THREE.Mesh(lampGeo, matLed);
    lamp.position.set(center.x, lampY, center.z);
    this.root.add(lamp);

    const housingGeo = new THREE.BoxGeometry(1.06, 0.2, 1.06);
    applyMetricBoxUvs(housingGeo, 1.06, 0.2, 1.06);
    const housing = new THREE.Mesh(housingGeo, matFrame);
    housing.position.set(center.x, lampY + 0.11, center.z);
    this.root.add(housing);

    const rodGeo = new THREE.BoxGeometry(0.06, 0.34, 0.06);
    applyMetricBoxUvs(rodGeo, 0.06, 0.34, 0.06);
    for (const dx of [-0.4, 0.4]) {
      for (const dz of [-0.4, 0.4]) {
        const rod = new THREE.Mesh(rodGeo, matFrame);
        rod.position.set(center.x + dx, lampY + 0.28, center.z + dz);
        this.root.add(rod);
      }
    }
    this.disposables.push(lampGeo, housingGeo, rodGeo);

    // ── O instrutor ──────────────────────────────────────────────────────
    this.instructor = new DoomAstronaut(this.scene, sharedUniforms);
    const instructorCell = gridCellToWorld(
      TUTORIAL_INSTRUCTOR_CELL.gx,
      TUTORIAL_INSTRUCTOR_CELL.gz
    );
    this.instructorHome.set(instructorCell.x, 0, instructorCell.z);
    // Fica de costas para a lateral da sala, encostado na parede norte.
    this.instructorAway.set(
      instructorCell.x + 1.9,
      0,
      instructorCell.z - 2.6
    );
    this.instructorPos.copy(this.instructorHome);
    // Nasce invisível e já no lugar certo: o primeiro `update` é quem dá a
    // pose, e até lá ele não deve aparecer na origem do mundo.
    this.instructor.root.position.copy(this.instructorPos);
    this.instructor.root.visible = false;
    this.instructor.root.name = 'DoomTutorialInstructor';
    this.instructor.root.userData = {
      characterId: 'tutorial_instructor',
      role: 'briefing_same_operator_model',
    };

    // ── Painel de instruções ─────────────────────────────────────────────
    this.panelEl = document.createElement('div');
    this.panelEl.id = 'doom-tutorial-panel';
    this.panelEl.className = 'doom-tutorial-panel';
    this.panelEl.innerHTML = `
      <div class="doom-tutorial-kicker">
        <span>SALA DE ORIENTAÇÃO</span>
        <span class="doom-tutorial-count" id="doom-tutorial-count">1/9</span>
      </div>
      <div class="doom-tutorial-instruction" id="doom-tutorial-instruction"></div>
      <div class="doom-tutorial-track"><i id="doom-tutorial-fill"></i></div>
      <div class="doom-tutorial-line" id="doom-tutorial-line"></div>
    `;
    viewportEl.appendChild(this.panelEl);
    this.stepCounterEl = this.panelEl.querySelector(
      '#doom-tutorial-count'
    ) as HTMLElement;
    this.instructionEl = this.panelEl.querySelector(
      '#doom-tutorial-instruction'
    ) as HTMLElement;
    this.lineEl = this.panelEl.querySelector(
      '#doom-tutorial-line'
    ) as HTMLElement;
    this.progressFillEl = this.panelEl.querySelector(
      '#doom-tutorial-fill'
    ) as HTMLElement;

    this.renderPanel();
  }

  /** Já terminou todas as lições? (As comportas sobem depois disto.) */
  get isFinished(): boolean {
    return this.lessons.isFinished;
  }

  /** Devolve as luzes que a sala adicionou ao mundo. */
  collectLightSources(): DoomLightSource[] {
    const center = gridCellToWorld(TUTORIAL_SPAWN_CELL.gx, TUTORIAL_SPAWN_CELL.gz);
    return [
      {
        position: new THREE.Vector3(center.x, WALL_HEIGHT - 0.42, center.z),
        baseIntensity: 0.72,
        // Sem piscada: uma sala de aula tremeluzindo atrapalha a leitura.
        flicker: false,
        phase: 0,
        // A luminária não tem painel no atributo compartilhado do labirinto.
        panelVertexStart: 0,
        panelVertexCount: 0,
      },
    ];
  }

  /**
   * Avança o tutorial. Chamar uma vez por quadro, enquanto ele existir.
   *
   * Recebe a posição do jogador para o instrutor virar o rosto na direção
   * certa — ele olha nos seus olhos, não para a parede.
   */
  update(probe: TutorialProbe, playerPos: THREE.Vector3): void {
    const wasFinished = this.lessons.isFinished;
    this.lessons.update(probe);
    if (!wasFinished && this.lessons.isFinished) this.renderFinishedPanel();
    else this.renderPanel();
    this.updateInstructor(probe, playerPos);
    this.updateShutters(probe.dt);
  }

  /** O jogador está empacado e já pode pular a lição. */
  get isStuck(): boolean {
    return this.lessons.isStuck;
  }

  /** Pula a lição atual (atalho de quem não quer ficar preso). */
  skipLesson(): void {
    this.lessons.skipLesson();
    if (this.lessons.isFinished) this.renderFinishedPanel();
    else this.renderPanel();
  }

  /** Encerra o tutorial na hora (o jogador já sabe jogar). */
  finishNow(): void {
    if (this.lessons.isFinished) return;
    this.lessons.finish();
    this.renderFinishedPanel();
  }

  private renderFinishedPanel(): void {
    this.lastRendered = 'done';
    this.panelEl.classList.remove('is-stuck');
    this.panelEl.classList.add('is-done');
    this.stepCounterEl.textContent = 'OK';
    this.progressFillEl.style.width = '100%';
    this.instructionEl.textContent = 'SALA LIBERADA — SIGA PELA PORTA';
    this.lineEl.textContent =
      'É isso. As comportas estão subindo — boa sorte lá fora. E não confie no silêncio.';
  }

  private updateInstructor(probe: TutorialProbe, playerPos: THREE.Vector3): void {
    // Depois de terminar, o instrutor se encosta na parede e fica em silêncio.
    const targetAside = this.lessons.isFinished ? 1 : 0;
    this.instructorStepAside += (targetAside - this.instructorStepAside) *
      Math.min(1, probe.dt * 1.1);

    this.instructorPos.lerpVectors(
      this.instructorHome,
      this.instructorAway,
      this.instructorStepAside
    );

    // Encarando o jogador: o instrutor nunca dá as costas enquanto fala.
    const dx = playerPos.x - this.instructorPos.x;
    const dz = playerPos.z - this.instructorPos.z;
    const desiredYaw = Math.atan2(-dx, -dz);
    let delta = desiredYaw - this.instructorYaw;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    this.instructorYaw += delta * Math.min(1, probe.dt * 3.4);

    // Balanço de peso sutil: gente parada não fica perfeitamente imóvel.
    this.instructorBob += probe.dt * 1.1;

    this.instructor.updateThirdPersonAlly(
      this.instructorPos,
      this.instructorYaw,
      0,
      this.instructorBob,
      0,
      0,
      // Ele segura a lanterna acesa na mão: é o que ilumina a demonstração.
      true,
      false,
      false,
      false,
      null,
      probe.dt,
      0,
      null
    );
  }

  private updateShutters(dt: number): void {
    for (const shutter of this.shutters) {
      const target = this.lessons.isFinished ? 1 : 0;
      if (shutter.lift === target) {
        this.syncShutterCollider(shutter);
        continue;
      }
      const speed = 0.42; // fração por segundo — comporta pesada, devagar
      shutter.lift =
        target > shutter.lift
          ? Math.min(target, shutter.lift + dt * speed)
          : Math.max(target, shutter.lift - dt * speed);
      shutter.panel.position.y = shutter.closedY + shutter.lift * WALL_HEIGHT;
      this.syncShutterCollider(shutter);
    }
  }

  /**
   * Mantém a caixa de colisão colada no painel.
   *
   * Conforme a comporta sobe, a caixa sobe junto — então o jogador passa por
   * baixo no instante em que há vão, e não num corte seco de animação.
   */
  private syncShutterCollider(shutter: Shutter): void {
    const box = shutter.collider.box;
    const y = shutter.closedY + shutter.lift * WALL_HEIGHT;
    const halfHeight = WALL_HEIGHT * 0.5;
    box.min.y = y - halfHeight;
    box.max.y = y + halfHeight;
  }

  /**
   * Redesenha o painel — mas só quando o conteúdo mudou.
   *
   * `update` roda a cada quadro e reescrever o DOM 60 vezes por segundo é
   * desperdício puro: comparamos a assinatura do que seria escrito e saímos
   * mais cedo quando nada mudou.
   */
  private renderPanel(): void {
    if (this.lessons.isFinished) return;
    const lesson = this.lessons.currentLesson;
    if (!lesson) return;

    const stuck = this.lessons.isStuck;
    const progressPct = Math.round(this.lessons.progress * 100);
    const signature = `${this.lessons.lessonNumber}|${progressPct}|${stuck ? 1 : 0}`;
    if (signature === this.lastRendered) return;
    this.lastRendered = signature;

    this.stepCounterEl.textContent = `${this.lessons.lessonNumber}/${this.lessons.lessonCount}`;
    this.instructionEl.textContent = lesson.instruction;
    this.progressFillEl.style.width = `${progressPct}%`;
    // Empacou: a fala do instrutor dá lugar ao convite para passar adiante.
    this.lineEl.textContent = stuck
      ? 'Sem pressa. Se travou, aperte [ENTER] para passar para a próxima.'
      : lesson.line;
    this.panelEl.classList.toggle('is-stuck', stuck);
  }

  private buildShutter(
    opening: RoomOpening,
    index: number,
    matShutter: THREE.ShaderMaterial,
    matFrame: THREE.ShaderMaterial,
    matLed: THREE.ShaderMaterial
  ): Shutter {
    const inside = gridCellToWorld(opening.fromGx, opening.fromGz);
    const outside = gridCellToWorld(opening.toGx, opening.toGz);
    const midX = (inside.x + outside.x) / 2;
    const midZ = (inside.z + outside.z) / 2;
    // A comporta atravessa o vão: se a saída é na horizontal (mesmo gz),
    // o painel fica na vertical (ao longo de Z) e vice-versa.
    const horizontal = Math.abs(outside.x - inside.x) > Math.abs(outside.z - inside.z);

    const group = new THREE.Group();
    group.name = `TutorialShutter_${index}`;
    group.position.set(midX, 0, midZ);
    if (horizontal) group.rotation.y = Math.PI / 2;
    this.root.add(group);

    const width = CELL_SIZE;
    const height = WALL_HEIGHT;
    const thickness = 0.26;

    // Painel de aço: sobe inteiro para dentro do teto.
    const panelGeo = new THREE.BoxGeometry(width, height, thickness);
    applyMetricBoxUvs(panelGeo, width, height, thickness);
    const panel = new THREE.Mesh(panelGeo, matShutter);

    // Faixas de aviso diagonal: duas ripas inclinadas atravessando a frente.
    const stripeGeo = new THREE.BoxGeometry(width * 0.98, 0.3, 0.04);
    applyMetricBoxUvs(stripeGeo, width * 0.98, 0.3, 0.04);
    for (const y of [-0.75, 0.15]) {
      const stripe = new THREE.Mesh(stripeGeo, matFrame);
      stripe.position.set(0, y, thickness / 2 + 0.02);
      panel.add(stripe);
    }

    // Reforço horizontal no meio, como uma porta blindada.
    const ribGeo = new THREE.BoxGeometry(width * 0.96, 0.12, 0.06);
    applyMetricBoxUvs(ribGeo, width * 0.96, 0.12, 0.06);
    for (const y of [-1.1, 0, 1.1]) {
      const rib = new THREE.Mesh(ribGeo, matFrame);
      rib.position.set(0, y, thickness / 2 + 0.01);
      panel.add(rib);
    }

    const closedY = height * 0.5;
    panel.position.set(0, closedY, 0);
    group.add(panel);

    // Batentes laterais: ficam parados, mesmo com o painel em cima.
    const jambGeo = new THREE.BoxGeometry(0.2, height + 0.3, 0.42);
    applyMetricBoxUvs(jambGeo, 0.2, height + 0.3, 0.42);
    for (const x of [-width / 2 - 0.08, width / 2 + 0.08]) {
      const jamb = new THREE.Mesh(jambGeo, matFrame);
      jamb.position.set(x, (height + 0.3) / 2, 0);
      group.add(jamb);
    }

    // Verga: a viga que esconde o painel quando ele sobe.
    const lintelGeo = new THREE.BoxGeometry(width + 0.5, 0.34, 0.5);
    applyMetricBoxUvs(lintelGeo, width + 0.5, 0.34, 0.5);
    const lintel = new THREE.Mesh(lintelGeo, matFrame);
    lintel.position.set(0, height + 0.17, 0);
    group.add(lintel);

    // LED de estado: vermelho trancado, verde liberado. Só a porta principal
    // tem — o jogador precisa saber para onde ir.
    let ledMaterial = matLed;
    if (opening.isMainDoor) {
      const ledGeo = new THREE.BoxGeometry(0.42, 0.16, 0.1);
      applyMetricBoxUvs(ledGeo, 0.42, 0.16, 0.1);
      const ledMat = matLed.clone();
      const led = new THREE.Mesh(ledGeo, ledMat);
      led.position.set(0, height - 0.55, thickness / 2 + 0.06);
      group.add(led);
      ledMaterial = ledMat;
      this.disposables.push(ledGeo, ledMat);

      // Placa "SAÍDA" acima da verga.
      const signGeo = new THREE.BoxGeometry(1.5, 0.44, 0.08);
      applyMetricBoxUvs(signGeo, 1.5, 0.44, 0.08);
      const sign = new THREE.Mesh(signGeo, matLed.clone());
      sign.position.set(0, height + 0.62, 0.06);
      group.add(sign);
      this.disposables.push(signGeo, sign.material as THREE.ShaderMaterial);
    }

    this.disposables.push(panelGeo, stripeGeo, ribGeo, jambGeo, lintelGeo);

    // A caixa de colisão é montada no espaço do GRUPO, já rotacionado. Como o
    // grupo gira 90° nas saídas horizontais, a caixa é calculada à mão a
    // partir das dimensões finais em vez de usar Box3.setFromObject.
    const halfAlong = horizontal ? thickness / 2 + 0.05 : width / 2;
    const halfAcross = horizontal ? width / 2 : thickness / 2 + 0.05;
    const box = new THREE.Box3(
      new THREE.Vector3(midX - halfAlong, 0, midZ - halfAcross),
      new THREE.Vector3(midX + halfAlong, height, midZ + halfAcross)
    );

    return {
      name: group.name,
      group,
      panel,
      collider: {
        id: `tutorial_shutter_${index}`,
        box,
        // Comporta é PAREDE, não engradado: nada de isObstacle, senão a
        // navegação da aranha tenta desviar de um vão que não existe mais.
      },
      closedY,
      lift: 0,
      isMainDoor: opening.isMainDoor,
      ledMaterial,
    };
  }

  /** Tudo fora da cena: comportas, luz, instrutor e painel. */
  dispose(): void {
    for (const shutter of this.shutters) {
      const idx = this.colliders.indexOf(shutter.collider);
      if (idx >= 0) this.colliders.splice(idx, 1);
    }
    this.instructor.disposeFromScene(this.scene);
    this.scene.remove(this.root);
    this.root.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
    });
    for (const item of this.disposables) item.dispose();
    this.panelEl.remove();
  }
}
