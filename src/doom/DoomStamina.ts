/**
 * Sistema puro e diegético de Estamina / Fôlego do jogador — SEM HUD NA TELA!
 *
 * Toda a leitura pelo jogador ocorre por resposta física e sonora orgânica:
 * - Respiração abafada progressiva dentro do capacete EVA;
 * - Arquejo curto de falta de ar quando o fôlego zera (`becameExhausted`);
 * - Oscilação sutil do peito/câmera acompanhando o ritmo da respiração;
 * - Leve peso nas pernas nos últimos instantes de fôlego e durante a recuperação.
 */

export const MAX_PLAYER_STAMINA = 100;
export const STAMINA_SPRINT_DRAIN_PER_SEC = 11.2; // ~8.9s de corrida intensa contínua (100 -> 0)
export const STAMINA_SLIDE_BURST_COST = 14.0;
export const STAMINA_MIN_TO_SLIDE = 12.0;
export const STAMINA_EXHAUSTION_RECOVERY_THRESHOLD = 26.0;

export const STAMINA_REGEN_STILL_PER_SEC = 28.0;
export const STAMINA_REGEN_CROUCH_MOVE_PER_SEC = 23.5;
export const STAMINA_REGEN_WALK_PER_SEC = 17.5;

export const STAMINA_RECOVERY_DELAY_NORMAL_SEC = 0.52;
export const STAMINA_RECOVERY_DELAY_EXHAUSTED_SEC = 0.85;

export interface PlayerStaminaState {
  /** Fôlego atual (0..100) */
  stamina: number;
  /** Verdadeiro quando zerou o fôlego e precisa recuperar até 26% antes de voltar a correr/deslizar */
  exhausted: boolean;
  /** Pequena pausa fisiológica após parar de correr antes do fôlego começar a subir */
  recoveryDelayTimer: number;
  /** Fase contínua do ciclo respiratório (radianos) para movimento sutil de peito/câmera */
  breathPhase: number;
}

export interface StaminaStepInput {
  dt: number;
  /** Jogador está efetivamente correndo neste quadro */
  isSprinting: boolean;
  /** Jogador acabou de iniciar um deslize tático neste quadro */
  startedSlide: boolean;
  /** Jogador está no meio de um deslize no chão */
  isSliding: boolean;
  /** Jogador está agachado */
  isCrouching: boolean;
  /** Velocidade horizontal real no plano XZ (m/s) */
  planarSpeed: number;
}

export interface StaminaStepResult {
  stamina: number;
  exhausted: boolean;
  /** Verdadeiro apenas no exato quadro em que o fôlego esgota completamente */
  becameExhausted: boolean;
  /** Nível normalizado de fadiga/falta de ar (0 = descansado, 1 = exausto) para áudio e câmera */
  fatigue01: number;
  /** Multiplicador orgânico da velocidade de corrida (1.0 normal, ~0.82 no fim do fôlego) */
  sprintSpeedMultiplier: number;
  /** Multiplicador orgânico da caminhada (1.0 normal, ~0.86 recuperando de exaustão total) */
  walkSpeedMultiplier: number;
  /** Deslocamento vertical sutil (metros) do peito ofegante na câmera — ZERO HUD! */
  chestHeaveOffsetY: number;
  /** Leve oscilação angular de pitch (radianos) da respiração pesada */
  breathPitchOffset: number;
}

export function createInitialStaminaState(): PlayerStaminaState {
  return {
    stamina: MAX_PLAYER_STAMINA,
    exhausted: false,
    recoveryDelayTimer: 0,
    breathPhase: 0,
  };
}

export function canPlayerSprintWithStamina(
  state: Readonly<PlayerStaminaState>
): boolean {
  return !state.exhausted && state.stamina > 0.01;
}

export function canPlayerSlideWithStamina(
  state: Readonly<PlayerStaminaState>
): boolean {
  return !state.exhausted && state.stamina >= STAMINA_MIN_TO_SLIDE;
}

/**
 * Restaura imediatamente parte do fôlego e limpa exaustão (ex.: ao beber Frasco de láudano ou acordar).
 */
export function boostPlayerStamina(
  state: PlayerStaminaState,
  amount: number
): void {
  state.stamina = Math.max(
    0,
    Math.min(MAX_PLAYER_STAMINA, state.stamina + amount)
  );
  if (state.stamina >= STAMINA_EXHAUSTION_RECOVERY_THRESHOLD * 0.5) {
    state.exhausted = false;
    state.recoveryDelayTimer = 0;
  }
}

/**
 * Avança um passo de simulação do sistema de estamina sem qualquer elemento visual de HUD.
 */
export function stepPlayerStaminaState(
  state: PlayerStaminaState,
  input: StaminaStepInput
): StaminaStepResult {
  const { dt, isSprinting, startedSlide, isSliding, isCrouching, planarSpeed } =
    input;

  let becameExhausted = false;
  let drainedThisFrame = false;

  // 1. Custo instantâneo ao lançar um deslize no chão
  if (startedSlide) {
    state.stamina = Math.max(0, state.stamina - STAMINA_SLIDE_BURST_COST);
    drainedThisFrame = true;
  }

  // 2. Dreno contínuo durante corrida ativa (só drena se realmente estiver se deslocando rápido)
  if (isSprinting && !isSliding && planarSpeed > 3.4) {
    // Escala suavemente com a velocidade efetiva caso esteja encostando em quina
    const effortRatio = Math.min(1.08, Math.max(0.45, planarSpeed / 8.6));
    state.stamina = Math.max(
      0,
      state.stamina - STAMINA_SPRINT_DRAIN_PER_SEC * effortRatio * dt
    );
    drainedThisFrame = true;
  }

  // 3. Verifica entrada em exaustão completa (0% de fôlego)
  if (drainedThisFrame && state.stamina <= 0.01) {
    state.stamina = 0;
    if (!state.exhausted) {
      state.exhausted = true;
      becameExhausted = true;
    }
    state.recoveryDelayTimer = STAMINA_RECOVERY_DELAY_EXHAUSTED_SEC;
  } else if (drainedThisFrame) {
    state.recoveryDelayTimer = Math.max(
      state.recoveryDelayTimer,
      STAMINA_RECOVERY_DELAY_NORMAL_SEC
    );
  }

  // 4. Regeneração progressiva quando não está drenando nem no meio do impulso inicial do slide
  if (!drainedThisFrame && !isSliding) {
    if (state.recoveryDelayTimer > 0) {
      state.recoveryDelayTimer = Math.max(0, state.recoveryDelayTimer - dt);
    } else {
      const regenRate =
        planarSpeed < 0.35
          ? STAMINA_REGEN_STILL_PER_SEC
          : isCrouching
            ? STAMINA_REGEN_CROUCH_MOVE_PER_SEC
            : STAMINA_REGEN_WALK_PER_SEC;

      state.stamina = Math.min(
        MAX_PLAYER_STAMINA,
        state.stamina + regenRate * dt
      );

      if (
        state.exhausted &&
        state.stamina >= STAMINA_EXHAUSTION_RECOVERY_THRESHOLD
      ) {
        state.exhausted = false;
      }
    }
  }

  // 5. Resposta física & respiratória orgânica (100% diegética, zero HUD!)
  const rawFatigue =
    state.stamina >= 68 ? 0 : Math.min(1, (68 - state.stamina) / 68);
  const fatigue01 = state.exhausted
    ? Math.max(0.78, rawFatigue)
    : rawFatigue;

  const breathRateRad = 2.4 + fatigue01 * 5.2; // ~0.38 Hz calmo -> ~1.2 Hz ofegante
  state.breathPhase = (state.breathPhase + dt * breathRateRad) % (Math.PI * 2);

  const sprintSpeedMultiplier =
    state.stamina >= 22
      ? 1.0
      : 0.82 + 0.18 * Math.max(0, state.stamina / 22);

  const walkSpeedMultiplier = state.exhausted
    ? 0.86 +
      0.14 *
        Math.min(1, state.stamina / STAMINA_EXHAUSTION_RECOVERY_THRESHOLD)
    : 1.0;

  // Movimento físico sutil do tórax/capacete perceptível sobretudo ao parar para recuperar o fôlego
  const stillFocus = planarSpeed < 1.5 ? 1.0 : 0.45;
  const chestHeaveOffsetY =
    fatigue01 > 0.04
      ? Math.sin(state.breathPhase) * 0.017 * fatigue01 * stillFocus
      : 0;
  const breathPitchOffset =
    fatigue01 > 0.04
      ? Math.cos(state.breathPhase) * 0.0075 * fatigue01 * stillFocus
      : 0;

  return {
    stamina: state.stamina,
    exhausted: state.exhausted,
    becameExhausted,
    fatigue01,
    sprintSpeedMultiplier,
    walkSpeedMultiplier,
    chestHeaveOffsetY,
    breathPitchOffset,
  };
}
