/**
 * Estado da luta do operador preso na teia (núcleo puro, sem THREE).
 *
 * Hoje a captura não tinha animação própria: os braços em 1ª pessoa continuavam
 * em idle, a pose de 3ª pessoa era estática e os fios 3D só mudavam de escala.
 * Este módulo concentra TUDO o que descreve o esforço de quem está amarrado —
 * puxões, fôlego, tremor de exaustão e pânico — para que câmera, braços, seda
 * 3D, overlay 2D e o traje em 3ª pessoa leiam exatamente os mesmos números e
 * fiquem sincronizados.
 *
 * Regra de direção adotada pelo jogo ("cresce com o perigo"):
 * sem apertar nada o operador quase não se mexe quando a Aranha está longe, e
 * vai se debatendo cada vez mais conforme ela se aproxima ou o tempo de
 * devoração cai. Apertar o botão de luta dá o pico de força sobre esse piso.
 */

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const clamp = (v: number, lo: number, hi: number): number =>
  v < lo ? lo : v > hi ? hi : v;

/** Rigidez da seda: frequência natural do puxão e quanto ele chia ao voltar. */
const HEAVE_STIFFNESS = 118;
const HEAVE_DAMPING = 11.5;

export interface WebStruggleInput {
  /** Preso em qualquer teia (armadilha de corredor, ninho ou casulo). */
  ensnared: boolean;
  /** Apertou o botão de luta NESTE quadro (borda de subida). */
  strugglePressed: boolean;
  /** Botão de luta mantido apertado (força sustentada, não só o pico). */
  struggleHeld: boolean;
  /** A faca acelera a saída e dá puxões mais fortes. */
  hasKnife: boolean;
  /** 0..1 — escala da força do puxão (aliados remotos lutam conforme o perigo). */
  impulseScale01?: number;
  /** 0..1 — perigo (proximidade da Aranha + contagem para devoração). */
  danger01: number;
  dt: number;
}

export interface WebStrugglePose {
  /** 0..1 — quão imobilizado: rampa de entrada/saída da captura. */
  bound01: number;
  /** 0..1 — esforço instantâneo (mistura do puxão com a força sustentada). */
  effort01: number;
  /** 0..1 — tensão elástica: a seda sendo esticada agora. */
  strain01: number;
  /** -1..1 — impulso do puxão: vai, ultrapassa e volta pela mola da seda. */
  yank: number;
  /** -1..1 — fôlego (ofegante conforme esforço e perigo). */
  breath: number;
  /** -1..1 — tremor fino de exaustão. */
  tremor: number;
  /** -1..1 — balanço lento do corpo pendurado. */
  sway: number;
  /** 0..1 — fadiga: quanto tempo lutando, enfraquece os puxões. */
  fatigue01: number;
  /** 0..1 — agitação de base SEM apertar nada (cresce com o perigo). */
  agitation01: number;
  /** 0..1 — pânico: mistura de perigo, esforço e fadiga. */
  panic01: number;
}

/** Pose neutra (solto): todos os termos zerados, própria para "não aplicar". */
export function createIdleWebStrugglePose(): WebStrugglePose {
  return {
    bound01: 0,
    effort01: 0,
    strain01: 0,
    yank: 0,
    breath: 0,
    tremor: 0,
    sway: 0,
    fatigue01: 0,
    agitation01: 0,
    panic01: 0,
  };
}

export interface WebDangerInput {
  /** Distância horizontal até a Aranha (m). */
  spiderDistance: number;
  /** A Aranha está caçando/alerta (não patrulhando). */
  spiderHunting: boolean;
  /** Segundos restantes para a devoração (0 = fora do casulo). */
  devourSecondsLeft: number;
  /** Duração total da contagem de devoração (0 = sem contagem ativa). */
  devourMaxSeconds: number;
}

/**
 * Converte a situação tática em um único número de perigo [0..1]:
 * a Aranha perto (e caçando) pesa mais que ela patrulhando longe, e a contagem
 * de devoração assume a dianteira quando o operador está no casulo do ninho.
 */
export function computeWebDanger(input: WebDangerInput): number {
  const proximity = clamp01(1 - Math.max(0, input.spiderDistance - 1.6) / 9);
  let danger = proximity * (input.spiderHunting ? 1 : 0.5);
  if (input.devourMaxSeconds > 0 && input.devourSecondsLeft > 0) {
    const urgency = clamp01(1 - input.devourSecondsLeft / input.devourMaxSeconds);
    danger = Math.max(danger, 0.45 + 0.55 * urgency);
  }
  return clamp01(danger);
}

/**
 * Máquina de estados da luta — uma instância por operador (local ou aliado).
 *
 * Determinística: a mesma sequência de `dt`/entradas produz sempre a mesma
 * pose, o que mantém os testes estáveis e o co-op previsível.
 */
export class WebStruggleState {
  private time = 0;
  private bound = 0;
  private strain = 0;
  private heave = 0;
  private heaveVel = 0;
  private fatigue = 0;
  private breathPhase = 0;
  private readonly pose: WebStrugglePose = createIdleWebStrugglePose();

  /** Pose do quadro anterior (reaproveitada entre chamadas). */
  get current(): WebStrugglePose {
    return this.pose;
  }

  /** Zera a luta (ao ser libertado, ao renascer ou ao trocar de partida). */
  reset(): void {
    this.time = 0;
    this.bound = 0;
    this.strain = 0;
    this.heave = 0;
    this.heaveVel = 0;
    this.fatigue = 0;
    this.breathPhase = 0;
    Object.assign(this.pose, createIdleWebStrugglePose());
  }

  step(input: WebStruggleInput): WebStrugglePose {
    const dt = clamp(input.dt, 0, 1 / 15);
    const danger = clamp01(input.danger01);
    this.time += dt;

    // 1. Imobilização: entra rápido (o bote da teia) e sai devagar (o corpo
    //    ainda desequilibrado depois que os fios cedem).
    const boundTarget = input.ensnared ? 1 : 0;
    const boundRate = input.ensnared ? 7.5 : 5.5;
    this.bound += (boundTarget - this.bound) * (1 - Math.exp(-boundRate * dt));
    if (!input.ensnared && this.bound < 0.002) this.bound = 0;

    // 2. Puxão: cada apertada é um impulso numa mola amortecida — o corpo
    //    arranca, a seda estica e o operador volta batendo. A fadiga corta a
    //    força e a faca devolve parte dela.
    if (input.ensnared && input.strugglePressed) {
      const impulseScale = Math.max(
        0,
        Math.min(1, input.impulseScale01 ?? 1)
      );
      const strength =
        (input.hasKnife ? 21 : 16.5) *
        (1 - 0.42 * this.fatigue) *
        (0.55 + 0.45 * this.bound) *
        impulseScale;
      this.heaveVel += strength;
    }
    this.heaveVel +=
      (-HEAVE_STIFFNESS * this.heave - HEAVE_DAMPING * this.heaveVel) * dt;
    this.heave += this.heaveVel * dt;
    this.heave = clamp(this.heave, -1.15, 1.15);

    // 3. Força sustentada: apertando sem soltar a seda fica esticada; cada
    //    apertada também deixa um resíduo, para vale a pena socar o botão.
    if (input.ensnared && input.strugglePressed) {
      this.strain = Math.min(1, this.strain + 0.38);
    }
    const strainTarget = input.ensnared && input.struggleHeld ? 1 : 0;
    const strainRate = strainTarget > 0 ? 3.4 : 1.9;
    this.strain += (strainTarget - this.strain) * (1 - Math.exp(-strainRate * dt));
    this.strain = clamp01(this.strain);

    // 4. Fadiga: cresce enquanto luta, recupera quando está livre.
    if (input.ensnared) {
      this.fatigue = clamp01(
        this.fatigue + dt * (0.04 + 0.5 * this.strain) * (0.65 + 0.35 * danger)
      );
    } else {
      this.fatigue = clamp01(this.fatigue - dt * 0.5);
    }

    // 5. Fôlego: respiração rasa quando a Aranha está longe, ofego aberto e
    //    acelerado conforme o perigo e o esforço.
    this.breathPhase += dt * (1.35 + 2.6 * danger + 3.4 * this.strain) * Math.PI;
    const breath =
      Math.sin(this.breathPhase) * (0.45 + 0.55 * clamp01(0.1 + 0.9 * danger));

    // 6. Tremor de exaustão (frequências incomensuráveis: nunca "gruda" no fôlego).
    const tremorAmp = (0.05 + 0.5 * this.fatigue) * (0.35 + 0.65 * danger);
    const tremor =
      (Math.sin(this.time * 11.3) * 0.5 +
        Math.sin(this.time * 17.7) * 0.3 +
        Math.sin(this.time * 23.1) * 0.2) *
      tremorAmp;

    // 7. Balanço pendular do corpo dependurado na seda.
    const sway =
      Math.sin(this.time * 0.62) * 0.7 + Math.sin(this.time * 0.41 + 1.3) * 0.3;

    const effort = clamp01(this.strain * 0.65 + Math.min(1, Math.abs(this.heave)) * 0.8);
    const agitation = clamp01(0.1 + 0.9 * danger);
    const panic = clamp01(0.35 * agitation + 0.45 * effort + 0.35 * this.fatigue * danger);

    this.pose.bound01 = this.bound;
    this.pose.effort01 = effort;
    this.pose.strain01 = this.strain;
    this.pose.yank = this.heave;
    this.pose.breath = breath;
    this.pose.tremor = tremor;
    this.pose.sway = sway;
    this.pose.fatigue01 = this.fatigue;
    this.pose.agitation01 = agitation;
    this.pose.panic01 = panic;
    return this.pose;
  }
}
