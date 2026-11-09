/**
 * ============================================================================
 * CATÁLOGO DE DANÇAS DO ASTRONAUTA + MOTOR PROCEDURAL DE POSES 3D
 * ============================================================================
 * Este módulo é 100% puro (sem THREE, sem DOM) para poder ser testado
 * isoladamente no Vitest. Ele recebe o `danceId` + o tempo da dança em
 * segundos e devolve a POSE ARTICULADA completa do traje Nível-A:
 *
 *  - Torção/balanço do quadril e do tronco;
 *  - Inclinação da cabeça (limitada para NUNCA rasgar a costura da gola);
 *  - Ombro/cotovelo/punho de ambos os braços (com abertura dos dedos);
 *  - Quadril/joelho/tornozelo de ambas as pernas (com base exata no piso).
 *
 * O Astronaut consome essa pose em `DoomAstronaut.applyDancePose()` e o
 * Multiplayer reenvia o mesmo `danceId`/`danceTime` para que os aliados
 * Co-op vejam EXATAMENTE a mesma coreografia.
 */

export type DoomDanceId =
  | 'robot'
  | 'samba'
  | 'march'
  | 'spin'
  | 'floss'
  | 'jog';

export interface DoomDanceDefinition {
  readonly id: DoomDanceId;
  /** Nome curto exibido no HUD e no menu de danças. */
  readonly label: string;
  /** Descrição curta da coreografia. */
  readonly subtitle: string;
  /** Batidas por minuto (define o compasso da coreografia e do som). */
  readonly bpm: number;
  /** Emoji/ícone exibido no menu. */
  readonly icon: string;
}

export const DOOM_DANCES: readonly DoomDanceDefinition[] = [
  {
    id: 'robot',
    label: 'ROBÔ METÁLICO',
    subtitle: 'Movimentos angulares e secos de robô de laboratório',
    bpm: 100,
    icon: '🤖',
  },
  {
    id: 'samba',
    label: 'SAMBA DO NINHO',
    subtitle: 'Balanço de quadril ritmado com braços abertos',
    bpm: 108,
    icon: '🎭',
  },
  {
    id: 'march',
    label: 'PASSO DE LUA',
    subtitle: 'Marcha de astronauta no lugar, joelho alto',
    bpm: 116,
    icon: '🚶',
  },
  {
    id: 'spin',
    label: 'GIRO DO CASULO',
    subtitle: 'Giro de 360° no eixo do traje com braços em cruz',
    bpm: 92,
    icon: '🌀',
  },
  {
    id: 'floss',
    label: 'FLOSS DO VÁCUO',
    subtitle: 'Balanço lateral dos braços em contra-tempo',
    bpm: 132,
    icon: '🕺',
  },
  {
    id: 'jog',
    label: 'CORRIDA NO LUGAR',
    subtitle: 'Passada rápida de fuga com balanço de braços',
    bpm: 152,
    icon: '🏃',
  },
] as const;

const DANCE_BY_ID = new Map<DoomDanceId, DoomDanceDefinition>(
  DOOM_DANCES.map((d) => [d.id, d])
);

export function getDoomDanceDefinition(
  id: DoomDanceId
): DoomDanceDefinition {
  return DANCE_BY_ID.get(id) ?? DOOM_DANCES[0];
}

export function isDoomDanceId(value: unknown): value is DoomDanceId {
  return typeof value === 'string' && DANCE_BY_ID.has(value as DoomDanceId);
}

/** Próxima dança do catálogo (usado pelo botão "próxima dança" do HUD). */
export function getNextDoomDanceId(id: DoomDanceId | null): DoomDanceId {
  if (!id) return DOOM_DANCES[0].id;
  const idx = DOOM_DANCES.findIndex((d) => d.id === id);
  return DOOM_DANCES[(idx + 1) % DOOM_DANCES.length].id;
}

/** Índice (1..6) da dança na grade do menu — usado pelos atalhos numéricos. */
export function getDoomDanceIndex(id: DoomDanceId): number {
  return DOOM_DANCES.findIndex((d) => d.id === id) + 1;
}

export type DoomDanceHandPose = 'open' | 'claw' | 'relaxed';

/** Rotação de um membro (ombro/quadril) em torno dos 3 eixos. */
export interface DoomDanceLimbPose {
  /** X: frente/trás (positivo = para frente) */
  x: number;
  /** Y: torção do membro em torno do eixo do corpo */
  y: number;
  /** Z: abdução (abrir o membro para fora do corpo) */
  z: number;
}

export interface DoomDanceArmPose {
  shoulder: DoomDanceLimbPose;
  /** Flexão do cotovelo (positivo = dobra para frente) */
  elbow: number;
  /** Rolagem do punho em X */
  wrist: number;
  /** Rolagem do punho em Z */
  wristZ: number;
}

export interface DoomDanceLegPose {
  hip: DoomDanceLimbPose;
  /** Flexão do joelho (negativo = dobra para trás) */
  knee: number;
  /** Compensação do tornozelo */
  ankle: number;
}

export interface DoomDancePose {
  /** Giro extra do corpo inteiro em torno de Y (usado no giro de 360°) */
  bodyYaw: number;
  /** Elevação sutil do corpo (bounce) — sempre >= 0 para nunca afundar no piso */
  bodyLift: number;
  /** Torção do quadril (Y) e inclinação lateral (Z) */
  hipsYaw: number;
  hipsRoll: number;
  /** Inclinação (X), torção (Y) e inclinação lateral (Z) do tronco */
  torsoPitch: number;
  torsoYaw: number;
  torsoRoll: number;
  /** Inclinação (X), giro (Y) e inclinação (Z) da cabeça */
  headPitch: number;
  headYaw: number;
  headRoll: number;
  leftArm: DoomDanceArmPose;
  rightArm: DoomDanceArmPose;
  leftLeg: DoomDanceLegPose;
  rightLeg: DoomDanceLegPose;
  /** Postura dos dedos das luvas chemical */
  handPose: DoomDanceHandPose;
}

const TAU = Math.PI * 2;
const HALF_PI = Math.PI / 2;

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Normaliza um ângulo para o intervalo [-PI, PI] (giro de 360° sem acumular). */
function normalizeAngle(angle: number): number {
  if (!Number.isFinite(angle)) return 0;
  let a = angle % TAU;
  if (a > Math.PI) a -= TAU;
  if (a < -Math.PI) a += TAU;
  return a;
}

/**
 * Curva de "estalo" robótico: sobe de 0 -> 1 rapidamente no início da batida
 * e fica travada no valor final até a próxima batida.
 */
function snapCurve(phase: number, sharpness = 0.18): number {
  const u = clamp(phase / sharpness, 0, 1);
  return u * u * (3 - 2 * u);
}

function emptyLimb(x = 0, y = 0, z = 0): DoomDanceLimbPose {
  return { x, y, z };
}

function makeArm(
  shoulderX: number,
  shoulderY: number,
  shoulderZ: number,
  elbow: number,
  wrist = 0,
  wristZ = 0
): DoomDanceArmPose {
  return {
    shoulder: emptyLimb(shoulderX, shoulderY, shoulderZ),
    elbow,
    wrist,
    wristZ,
  };
}

function makeLeg(
  hipX: number,
  hipY: number,
  hipZ: number,
  knee: number,
  ankle = 0
): DoomDanceLegPose {
  return {
    hip: emptyLimb(hipX, hipY, hipZ),
    knee,
    ankle,
  };
}

function basePose(): DoomDancePose {
  return {
    bodyYaw: 0,
    bodyLift: 0,
    hipsYaw: 0,
    hipsRoll: 0,
    torsoPitch: 0,
    torsoYaw: 0,
    torsoRoll: 0,
    headPitch: 0,
    headYaw: 0,
    headRoll: 0,
    leftArm: makeArm(0, 0, -0.14, 0.3),
    rightArm: makeArm(0, 0, 0.14, 0.3),
    leftLeg: makeLeg(0, 0, -0.03, 0.04),
    rightLeg: makeLeg(0, 0, 0.03, 0.04),
    handPose: 'open',
  };
}

/**
 * Compensação do tornozelo para manter a bota alinhada com o piso.
 * Convenção do rig: o quadril flexiona para a FRENTE com X positivo e o
 * joelho flexiona para TRÁS com X NEGATIVO. Para a galocha ficar reta no
 * chão, o tornozelo compensa a soma (quadril + joelho).
 */
function ankleComp(hipPitch: number, knee: number): number {
  return clamp(-(hipPitch + knee), -1.45, 1.45);
}

/**
 * Converte o "bounce" em flexão suave dos joelhos; o rig ajusta a altura
 * do corpo para manter a galocha de apoio no piso durante os passos.
 */
function applyBounceDip(pose: DoomDancePose): void {
  const dip = clamp(pose.bodyLift, 0, 0.075);
  if (dip <= 0.0005) {
    pose.leftLeg.knee = Math.min(0, pose.leftLeg.knee);
    pose.rightLeg.knee = Math.min(0, pose.rightLeg.knee);
    return;
  }
  // Flexão sutil adicionada aos passos, sem dobrar as duas pernas em excesso.
  // O contato do pé de apoio é corrigido pela geometria real no rig.
  const cosTheta = clamp(1 - dip / 0.345, -1, 1);
  const theta = Math.acos(cosTheta) * 0.35;
  pose.leftLeg.knee = Math.min(0, pose.leftLeg.knee) - theta;
  pose.rightLeg.knee = Math.min(0, pose.rightLeg.knee) - theta;
  pose.leftLeg.ankle = ankleComp(pose.leftLeg.hip.x, pose.leftLeg.knee);
  pose.rightLeg.ankle = ankleComp(pose.rightLeg.hip.x, pose.rightLeg.knee);
}

/* ==========================================================================
   1) ROBÔ METÁLICO — 8 poses angulares trocadas a cada batida
   ========================================================================== */
interface RobotPreset {
  lSh: [number, number, number];
  lEl: number;
  rSh: [number, number, number];
  rEl: number;
  head: [number, number, number];
  legs: [number, number, number, number];
  lift: number;
}

const ROBOT_PRESETS: readonly RobotPreset[] = [
  {
    lSh: [-0.2, 0, -1.35],
    lEl: 0.15,
    rSh: [-0.2, 0, 1.35],
    rEl: 0.15,
    head: [0, 0, 0],
    legs: [0.05, 0.03, 0.05, 0.05],
    lift: 0,
  },
  {
    lSh: [-1.5, 0, -0.50],
    lEl: 1.5,
    rSh: [0.5, 0, 0.50],
    rEl: 0.5,
    head: [-0.18, 0.22, 0],
    legs: [0.05, 0.05, 0.12, 0.12],
    lift: 0.015,
  },
  {
    lSh: [-0.6, 0, -0.85],
    lEl: 2.2,
    rSh: [-0.6, 0, 0.85],
    rEl: 2.2,
    head: [0.12, 0, 0],
    legs: [0.02, 0.04, 0.06, 0.06],
    lift: 0.03,
  },
  {
    lSh: [0.9, 0, -0.50],
    lEl: 0.2,
    rSh: [-1.4, 0, 0.50],
    rEl: 1.4,
    head: [0, -0.24, 0.16],
    legs: [0.08, 0.06, 0.05, 0.05],
    lift: 0,
  },
  {
    lSh: [-1.35, 0, -0.9],
    lEl: 0.9,
    rSh: [-1.35, 0, 0.9],
    rEl: 0.9,
    head: [0.2, 0, 0],
    legs: [0.1, 0.08, 0.1, 0.1],
    lift: 0.045,
  },
  {
    lSh: [0.35, 0, -0.65],
    lEl: 1.85,
    rSh: [0.35, 0, 0.65],
    rEl: 1.85,
    head: [-0.12, 0, -0.18],
    legs: [0.04, 0.05, 0.04, 0.04],
    lift: 0.01,
  },
  {
    lSh: [-1.45, 0, -0.65],
    lEl: 0.35,
    rSh: [-1.45, 0, 0.65],
    rEl: 0.35,
    head: [0, 0, 0],
    legs: [0.06, 0.04, 0.08, 0.08],
    lift: 0.02,
  },
  {
    lSh: [0.2, 0, -1.15],
    lEl: 0.6,
    rSh: [0.2, 0, 1.15],
    rEl: 0.6,
    head: [0.16, 0.2, 0],
    legs: [0.02, 0.03, 0.03, 0.03],
    lift: 0.035,
  },
] as const;

function poseRobot(timeSec: number, bpm: number): DoomDancePose {
  const pose = basePose();
  const beats = timeSec * (bpm / 60);
  const beatIndex = Math.floor(beats);
  const phase = beats - beatIndex;
  const blend = snapCurve(phase, 0.16);

  const cur = ROBOT_PRESETS[beatIndex % ROBOT_PRESETS.length];
  const next = ROBOT_PRESETS[(beatIndex + 1) % ROBOT_PRESETS.length];

  const mix = (a: number, b: number): number => lerp(a, b, blend);

  pose.leftArm = makeArm(
    mix(cur.lSh[0], next.lSh[0]),
    mix(cur.lSh[1], next.lSh[1]),
    mix(cur.lSh[2], next.lSh[2]),
    mix(cur.lEl, next.lEl)
  );
  pose.rightArm = makeArm(
    mix(cur.rSh[0], next.rSh[0]),
    mix(cur.rSh[1], next.rSh[1]),
    mix(cur.rSh[2], next.rSh[2]),
    mix(cur.rEl, next.rEl)
  );
  pose.headPitch = mix(cur.head[0], next.head[0]);
  pose.headYaw = mix(cur.head[1], next.head[1]);
  pose.headRoll = mix(cur.head[2], next.head[2]);
  pose.leftLeg = makeLeg(
    mix(cur.legs[0], next.legs[0]),
    0,
    -mix(cur.legs[1], next.legs[1]),
    -mix(cur.legs[2], next.legs[2])
  );
  pose.rightLeg = makeLeg(
    mix(cur.legs[0], next.legs[0]),
    0,
    mix(cur.legs[1], next.legs[1]),
    -mix(cur.legs[2], next.legs[2])
  );
  pose.leftLeg.ankle = ankleComp(pose.leftLeg.hip.x, pose.leftLeg.knee);
  pose.rightLeg.ankle = ankleComp(pose.rightLeg.hip.x, pose.rightLeg.knee);
  pose.bodyLift = mix(cur.lift, next.lift);
  applyBounceDip(pose);
  pose.torsoPitch = 0.03;
  pose.handPose = 'claw';
  return pose;
}

/* ==========================================================================
   2) SAMBA DO NINHO — balanço lateral contínuo de quadril e braços
   ========================================================================== */
function poseSamba(timeSec: number, bpm: number): DoomDancePose {
  const pose = basePose();
  const beats = timeSec * (bpm / 60);
  const sway = Math.sin(TAU * beats * 0.5);
  const bounce = Math.sin(TAU * beats);

  pose.hipsRoll = sway * 0.2;
  pose.hipsYaw = -sway * 0.26;
  pose.torsoYaw = sway * 0.3;
  pose.torsoRoll = -sway * 0.14;
  pose.torsoPitch = 0.08 + Math.abs(bounce) * 0.04;
  pose.headYaw = sway * 0.26;
  pose.headRoll = sway * 0.16;

  const lLift = Math.max(0, sway);
  const rLift = Math.max(0, -sway);

  pose.leftLeg = makeLeg(0.08 + lLift * 0.26, 0, -0.05, -(0.22 + lLift * 0.5));
  pose.rightLeg = makeLeg(0.08 + rLift * 0.26, 0, 0.05, -(0.22 + rLift * 0.5));
  pose.leftLeg.ankle = ankleComp(pose.leftLeg.hip.x, pose.leftLeg.knee);
  pose.rightLeg.ankle = ankleComp(pose.rightLeg.hip.x, pose.rightLeg.knee);

  pose.leftArm = makeArm(
    -0.55 - sway * 0.42,
    0,
    -0.95 - sway * 0.3,
    1.15 + sway * 0.28
  );
  pose.rightArm = makeArm(
    -0.55 + sway * 0.42,
    0,
    0.95 + sway * 0.3,
    1.15 - sway * 0.28
  );
  pose.bodyLift = 0.02 + Math.max(0, bounce) * 0.035;
  applyBounceDip(pose);
  pose.handPose = 'open';
  return pose;
}

/* ==========================================================================
   3) PASSO DE LUA — marcha no lugar com joelho alto
   ========================================================================== */
function poseMarch(timeSec: number, bpm: number): DoomDancePose {
  const pose = basePose();
  const beats = timeSec * (bpm / 60);
  const p = TAU * beats * 0.5;
  const sL = Math.sin(p);
  const sR = Math.sin(p + Math.PI);

  const lHip = sL * 0.44;
  const rHip = sR * 0.44;
  // O joelho flexiona (para trás) quando a perna avança, levantando a galocha
  const lKnee = -(0.1 + Math.max(0, Math.sin(p - 0.9)) ** 2 * 1.25);
  const rKnee = -(0.1 + Math.max(0, Math.sin(p - 0.9 + Math.PI)) ** 2 * 1.25);

  pose.leftLeg = makeLeg(lHip, 0, -0.04, lKnee);
  pose.rightLeg = makeLeg(rHip, 0, 0.04, rKnee);
  pose.leftLeg.ankle = ankleComp(lHip, lKnee);
  pose.rightLeg.ankle = ankleComp(rHip, rKnee);

  pose.leftArm = makeArm(-lHip * 1.15, 0, -0.55, 0.5 + Math.max(0, sL) * 0.55);
  pose.rightArm = makeArm(-rHip * 1.15, 0, 0.55, 0.5 + Math.max(0, sR) * 0.55);

  pose.torsoPitch = 0.09;
  pose.torsoYaw = -sL * 0.07;
  pose.headPitch = -0.06;
  pose.bodyLift = 0.018 + Math.max(0, Math.cos(p)) * 0.045;
  applyBounceDip(pose);
  pose.handPose = 'open';
  return pose;
}

/* ==========================================================================
   4) GIRO DO CASULO — 360° no eixo do traje com braços em cruz
   ========================================================================== */
function poseSpin(timeSec: number, bpm: number): DoomDancePose {
  const pose = basePose();
  const beats = timeSec * (bpm / 60);
  const spin = (beats / 4) * TAU;

  pose.bodyYaw = normalizeAngle(spin);
  pose.torsoPitch = 0.05;
  pose.torsoYaw = Math.sin(spin) * 0.12;
  pose.torsoRoll = Math.sin(spin * 2) * 0.07;
  pose.headYaw = Math.sin(spin * 2 + 0.6) * 0.22;
  pose.headPitch = Math.sin(spin * 2) * 0.08;

  const armWave = Math.sin(spin * 2) * 0.16;
  pose.leftArm = makeArm(0.08 + armWave, 0, -1.05 - armWave, 0.25);
  pose.rightArm = makeArm(0.08 - armWave, 0, 1.05 + armWave, 0.25);

  // Pequenos passos alternados dão intenção ao giro, em vez de deslizar em T.
  const step = Math.sin(spin * 4);
  const leftHip = 0.05 + step * 0.18;
  const rightHip = 0.05 - step * 0.18;
  const leftKnee = -(0.14 + Math.max(0, step) * 0.32);
  const rightKnee = -(0.14 + Math.max(0, -step) * 0.32);
  pose.leftLeg = makeLeg(leftHip, 0, -0.05, leftKnee);
  pose.rightLeg = makeLeg(rightHip, 0, 0.05, rightKnee);
  pose.leftLeg.ankle = ankleComp(leftHip, leftKnee);
  pose.rightLeg.ankle = ankleComp(rightHip, rightKnee);

  pose.bodyLift = 0.015 + Math.abs(Math.sin(spin)) * 0.025;
  applyBounceDip(pose);
  pose.handPose = 'open';
  return pose;
}

/* ==========================================================================
   5) FLOSS DO VÁCUO — braços cruzando o corpo em contra-tempo
   ========================================================================== */
function poseFloss(timeSec: number, bpm: number): DoomDancePose {
  const pose = basePose();
  const beats = timeSec * (bpm / 60);
  const p = TAU * beats * 0.5;
  const s = Math.sin(p);

  // O balanço atravessa a frente do traje com o cotovelo afastado,
  // em vez de atravessar a malha do tórax inflado.
  const cross = Math.cos(p);
  pose.leftArm = makeArm(0.12 + cross * 0.62, -s * 0.20, -0.72 - s * 0.18, 0.55);
  pose.rightArm = makeArm(0.12 - cross * 0.62, -s * 0.20, 0.72 - s * 0.18, 0.55);
  pose.leftArm.wrist = -s * 0.2;
  pose.rightArm.wrist = s * 0.2;

  pose.hipsYaw = -s * 0.3;
  pose.torsoYaw = -s * 0.24;
  pose.torsoRoll = s * 0.06;
  pose.headYaw = -s * 0.22;
  pose.headRoll = s * 0.1;

  const knee = -(0.16 + Math.abs(s) * 0.22);
  pose.leftLeg = makeLeg(0.03, 0, -0.09, knee);
  pose.rightLeg = makeLeg(0.03, 0, 0.09, knee);
  pose.leftLeg.ankle = ankleComp(0.03, knee);
  pose.rightLeg.ankle = ankleComp(0.03, knee);

  pose.bodyLift = 0.01 + Math.abs(s) * 0.02;
  applyBounceDip(pose);
  pose.handPose = 'open';
  return pose;
}

/* ==========================================================================
   6) CORRIDA NO LUGAR — passada rápida de fuga
   ========================================================================== */
function poseJog(timeSec: number, bpm: number): DoomDancePose {
  const pose = basePose();
  const beats = timeSec * (bpm / 60);
  // Uma passada por batida, em vez de quatro: corrida legível sem tremulação.
  const p = TAU * beats * 0.5;
  const sL = Math.sin(p);
  const sR = Math.sin(p + Math.PI);

  const lHip = sL * 0.6;
  const rHip = sR * 0.6;
  const lKnee = -(0.08 + Math.max(0, Math.sin(p - 0.8)) ** 2 * 1.45);
  const rKnee = -(0.08 + Math.max(0, Math.sin(p - 0.8 + Math.PI)) ** 2 * 1.45);

  pose.leftLeg = makeLeg(lHip, 0, -0.04, lKnee);
  pose.rightLeg = makeLeg(rHip, 0, 0.04, rKnee);
  pose.leftLeg.ankle = ankleComp(lHip, lKnee);
  pose.rightLeg.ankle = ankleComp(rHip, rKnee);

  pose.leftArm = makeArm(-sL * 0.92, 0, -0.55, 0.95 + Math.max(0, sL) * 0.5);
  pose.rightArm = makeArm(-sR * 0.92, 0, 0.55, 0.95 + Math.max(0, sR) * 0.5);

  pose.torsoPitch = 0.26;
  pose.torsoYaw = -sL * 0.09;
  pose.headPitch = -0.16;
  pose.bodyLift = 0.012 + Math.max(0, Math.cos(p * 2)) * 0.035;
  applyBounceDip(pose);
  pose.handPose = 'open';
  return pose;
}

/**
 * Calcula a pose articulada completa da dança no tempo informado (segundos).
 * Determinística: o mesmo `(id, tempo)` devolve sempre a mesma pose, o que
 * permite sincronizar a coreografia entre jogadores Co-op via rede.
 */
export function computeDoomDancePose(
  id: DoomDanceId,
  timeSec: number
): DoomDancePose {
  const def = getDoomDanceDefinition(id);
  const t = Number.isFinite(timeSec) ? Math.max(0, timeSec) : 0;
  switch (def.id) {
    case 'robot':
      return poseRobot(t, def.bpm);
    case 'samba':
      return poseSamba(t, def.bpm);
    case 'march':
      return poseMarch(t, def.bpm);
    case 'spin':
      return poseSpin(t, def.bpm);
    case 'floss':
      return poseFloss(t, def.bpm);
    case 'jog':
      return poseJog(t, def.bpm);
    default:
      return poseMarch(t, def.bpm);
  }
}

/**
 * Índice da batida atual (0, 1, 2...) — usado para disparar o som percussivo
 * exatamente uma vez por batida da coreografia.
 */
export function getDoomDanceBeatIndex(
  id: DoomDanceId,
  timeSec: number
): number {
  const def = getDoomDanceDefinition(id);
  const beats = Math.max(0, timeSec) * (def.bpm / 60);
  return Math.floor(beats);
}

/** Duração de um compasso completo (4 batidas) em segundos. */
export function getDoomDanceBarDuration(id: DoomDanceId): number {
  const def = getDoomDanceDefinition(id);
  return (60 / def.bpm) * 4;
}

/** Ângulo seguro de inclinação da cabeça (nunca rasga a costura da gola). */
export const DOOM_DANCE_HEAD_PITCH_LIMIT = 0.26;
export const DOOM_DANCE_HEAD_ROLL_LIMIT = 0.24;
export { clamp as clampDoomDanceValue, HALF_PI as DOOM_DANCE_HALF_PI };
