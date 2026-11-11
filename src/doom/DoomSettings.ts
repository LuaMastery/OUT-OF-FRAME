export type InternalResolutionPreset =
  | '180p'
  | '250p'
  | '360p'
  | '480p'
  | '720p';
export type CrtScanlineMode = 'off' | 'subtle' | 'strong';
export type HoldOrToggleMode = 'hold' | 'toggle';
export type CrosshairStyle = 'off' | 'dot' | 'cross';
export type DominantHandMode = 'right' | 'left';
export type PerformancePresetId = 'eco' | 'balanced' | 'quality' | 'custom';
export type TargetFpsOption = 0 | 30 | 60 | 90 | 120;
export type OptimizerAggressiveness = 'gentle' | 'balanced' | 'aggressive';
export type ViewmodelShadowQuality = 'off' | 'low' | 'high';
export type ContactShadowRate = 0 | 15 | 30 | 60;

export type SettingsCategoryId =
  | 'video'
  | 'audio'
  | 'controls'
  | 'gameplay'
  | 'interface'
  | 'performance';

/**
 * Conjunto completo de 38 opções reais de configuração do jogo,
 * persistidas em localStorage e conectadas diretamente à engine WebGL / WebAudio / Input / HUD.
 */
export interface DoomGameSettings {
  // 1. VÍDEO & GRÁFICOS (7 opções)
  resolutionHeight: InternalResolutionPreset;
  fov: number; // 60..105 (padrão 74)
  brightness: number; // 60..160 % (padrão 100)
  contrast: number; // 75..140 % (padrão 100)
  ditherMode: boolean; // Bayer 4x4 + quantização PLAYPAL (padrão true)
  crtScanlines: CrtScanlineMode; // off | subtle | strong (padrão 'off')
  lightFlicker: boolean; // Oscilação das lâmpadas do corredor (padrão true)

  // 2. ÁUDIO & ACÚSTICA (6 opções)
  masterVolume: number; // 0..100 % (padrão 82)
  sfxVolume: number; // 0..100 % (padrão 94)
  uiVolume: number; // 0..100 % (padrão 90)
  reverbAmount: number; // 0..100 % (padrão 68)
  muteWhenUnfocused: boolean; // Silenciar ao minimizar aba (padrão false)
  retroVoiceEffectEnabled: boolean; // Efeito sonoro retro 8-bit da voz (padrão true)

  // 3. CONTROLES & MIRA (6 opções)
  mouseSensitivity: number; // 20..250 % (padrão 100)
  invertMouseY: boolean; // Inverter eixo Y vertical (padrão false)
  crouchMode: HoldOrToggleMode; // Segurar ou Alternar [Ctrl/C] (padrão 'hold')
  sprintMode: HoldOrToggleMode; // Segurar ou Alternar [Shift] (padrão 'hold')
  invertWheelShortcuts: boolean; // Inverter direção da rolinha nos atalhos [1-3] (padrão false)
  touchLookSensitivity: number; // 40..200 % mobile (padrão 100)

  // 4. JOGABILIDADE & CÂMERA (4 opções)
  headBobIntensity: number; // 0..130 % balanço ao caminhar (padrão 100)
  screenShakeIntensity: number; // 0..130 % tremor de câmera (padrão 100)
  showCrosshair: CrosshairStyle; // off | dot | cross (padrão 'dot')
  showFpsCounter: boolean; // Contador de FPS e resolução interna (padrão false)

  // 5. INTERFACE & ACESSIBILIDADE (4 opções -> Total: 27 opções)
  shortcutsHubIdleOpacity: number; // 15..95 % opacidade da HUB em repouso (padrão 52)
  viewmodelHand: DominantHandMode; // right | left (padrão 'right')
  bloodOverlayScale: number; // 25..100 % intensidade de sangue nas bordas (padrão 100)
  autoFullscreenOnResume: boolean; // Entrar em tela cheia ao retomar (padrão true)

  // 6. DESEMPENHO & OTIMIZAÇÃO (11 opções -> Total: 38 opções)
  perfPreset: PerformancePresetId; // eco | balanced | quality | custom (padrão 'balanced')
  targetFps: TargetFpsOption; // 0 = sem limite, 30, 60, 90, 120 (padrão 60)
  autoOptimizer: boolean; // Governador inteligente de qualidade (padrão true)
  optimizerAggressiveness: OptimizerAggressiveness; // gentle | balanced | aggressive
  renderScalePercent: number; // 50..160 % da resolução interna escolhida (padrão 100)
  maxDynamicLights: number; // 8..48 luzes dinâmicas no shader (padrão 40)
  viewmodelShadowQuality: ViewmodelShadowQuality; // off | low(256) | high(512)
  contactShadowRate: ContactShadowRate; // 0 | 15 | 30 | 60 Hz (padrão 30)
  drawDistance: number; // 45..125 m plano distante da câmera (padrão 125)
  reduceWhenUnfocused: boolean; // Cortar qualidade com a janela sem foco (padrão true)
  showPerfHud: boolean; // Painel de telemetria ao vivo (padrão false)
}

export const DEFAULT_DOOM_SETTINGS: Readonly<DoomGameSettings> = Object.freeze({
  resolutionHeight: '250p',
  fov: 74,
  brightness: 100,
  contrast: 100,
  ditherMode: true,
  crtScanlines: 'off',
  lightFlicker: true,

  masterVolume: 82,
  sfxVolume: 94,
  uiVolume: 90,
  reverbAmount: 68,
  muteWhenUnfocused: false,
  retroVoiceEffectEnabled: true,

  mouseSensitivity: 100,
  invertMouseY: false,
  crouchMode: 'hold',
  sprintMode: 'hold',
  invertWheelShortcuts: false,
  touchLookSensitivity: 100,

  headBobIntensity: 100,
  screenShakeIntensity: 100,
  showCrosshair: 'dot',
  showFpsCounter: false,

  shortcutsHubIdleOpacity: 52,
  viewmodelHand: 'right',
  bloodOverlayScale: 100,
  autoFullscreenOnResume: true,

  perfPreset: 'balanced',
  targetFps: 60,
  autoOptimizer: true,
  optimizerAggressiveness: 'balanced',
  renderScalePercent: 100,
  maxDynamicLights: 40,
  viewmodelShadowQuality: 'low',
  contactShadowRate: 30,
  drawDistance: 125,
  reduceWhenUnfocused: true,
  showPerfHud: false,
});

/**
 * Pacotes de desempenho: cada preset escreve um conjunto coerente de opções e
 * qualquer ajuste manual depois disso marca o preset como `custom`.
 */
export const PERFORMANCE_PRESETS: Readonly<
  Record<
    Exclude<PerformancePresetId, 'custom'>,
    Readonly<Partial<DoomGameSettings>>
  >
> = {
  eco: {
    targetFps: 30,
    autoOptimizer: true,
    optimizerAggressiveness: 'balanced',
    renderScalePercent: 75,
    maxDynamicLights: 12,
    viewmodelShadowQuality: 'off',
    contactShadowRate: 0,
    drawDistance: 70,
    reduceWhenUnfocused: true,
  },
  balanced: {
    targetFps: 60,
    autoOptimizer: true,
    optimizerAggressiveness: 'balanced',
    renderScalePercent: 100,
    maxDynamicLights: 40,
    viewmodelShadowQuality: 'low',
    contactShadowRate: 30,
    drawDistance: 125,
    reduceWhenUnfocused: true,
  },
  quality: {
    targetFps: 0,
    autoOptimizer: true,
    optimizerAggressiveness: 'gentle',
    renderScalePercent: 130,
    maxDynamicLights: 48,
    viewmodelShadowQuality: 'high',
    contactShadowRate: 60,
    drawDistance: 125,
    reduceWhenUnfocused: false,
  },
};

/**
 * Opções que pertencem ao pacote de desempenho. Mexer em qualquer uma delas
 * tira o jogador do pacote fechado e marca o preset como personalizado — sem
 * isso a interface mentiria dizendo "Equilibrado" com valores diferentes.
 */
const PERFORMANCE_SETTING_KEYS: ReadonlySet<keyof DoomGameSettings> = new Set([
  'targetFps',
  'autoOptimizer',
  'optimizerAggressiveness',
  'renderScalePercent',
  'maxDynamicLights',
  'viewmodelShadowQuality',
  'contactShadowRate',
  'drawDistance',
  'reduceWhenUnfocused',
  'showPerfHud',
]);

/** Tamanho do shadow map do viewmodel para cada nível de qualidade. */
export function viewmodelShadowMapSize(
  quality: ViewmodelShadowQuality
): number {
  switch (quality) {
    case 'high':
      return 512;
    case 'low':
      return 256;
    default:
      return 0;
  }
}

export type SettingControlSpec<K extends keyof DoomGameSettings = keyof DoomGameSettings> =
  | {
      key: K;
      category: SettingsCategoryId;
      label: string;
      description: string;
      kind: 'range';
      min: number;
      max: number;
      step: number;
      unit: string;
    }
  | {
      key: K;
      category: SettingsCategoryId;
      label: string;
      description: string;
      kind: 'toggle';
      onLabel?: string;
      offLabel?: string;
    }
  | {
      key: K;
      category: SettingsCategoryId;
      label: string;
      description: string;
      kind: 'choice';
      choices: ReadonlyArray<{ value: DoomGameSettings[K]; label: string }>;
    };

export const SETTINGS_CATEGORIES: ReadonlyArray<{
  id: SettingsCategoryId;
  label: string;
}> = [
  { id: 'video', label: 'Vídeo & Gráficos' },
  { id: 'audio', label: 'Áudio & Acústica' },
  { id: 'controls', label: 'Controles & Mira' },
  { id: 'gameplay', label: 'Jogabilidade' },
  { id: 'interface', label: 'Interface & Acess.' },
  { id: 'performance', label: 'Desempenho & FPS' },
];

export const DOOM_SETTINGS_DESCRIPTORS: ReadonlyArray<SettingControlSpec> = [
  // --- VÍDEO & GRÁFICOS (7) ---
  {
    key: 'resolutionHeight',
    category: 'video',
    label: 'Resolução Interna 3D',
    description:
      'Define a nitidez do framebuffer retrô (250p fiel ao DOS clássico; 480p/720p para imagem mais limpa).',
    kind: 'choice',
    choices: [
      { value: '180p', label: '180p' },
      { value: '250p', label: '250p' },
      { value: '360p', label: '360p' },
      { value: '480p', label: '480p' },
      { value: '720p', label: '720p' },
    ],
  },
  {
    key: 'fov',
    category: 'video',
    label: 'Campo de Visão (FOV)',
    description:
      'Ângulo base de abertura da câmera em 1ª pessoa (valores maiores ampliam a visão periférica).',
    kind: 'range',
    min: 60,
    max: 105,
    step: 1,
    unit: '°',
  },
  {
    key: 'brightness',
    category: 'video',
    label: 'Brilho das Galerias',
    description:
      'Ajusta o ganho luminoso pós-processado para monitores muito escuros ou claros.',
    kind: 'range',
    min: 60,
    max: 160,
    step: 2,
    unit: '%',
  },
  {
    key: 'contrast',
    category: 'video',
    label: 'Contraste Sombrio',
    description:
      'Controla a separação entre penumbra profunda e realces da lanterna.',
    kind: 'range',
    min: 75,
    max: 140,
    step: 2,
    unit: '%',
  },
  {
    key: 'ditherMode',
    category: 'video',
    label: 'Dithering Bayer 4×4',
    description:
      'Ativa a malha ordenada de meio-tom e quantização de paleta estilo id Tech 1.',
    kind: 'toggle',
    onLabel: 'Ativo',
    offLabel: 'Suave',
  },
  {
    key: 'crtScanlines',
    category: 'video',
    label: 'Filtro de Varredura CRT',
    description:
      'Adiciona linhas horizontais de fósforo e vinheta óptica nas bordas do monitor.',
    kind: 'choice',
    choices: [
      { value: 'off', label: 'Desligado' },
      { value: 'subtle', label: 'Sutil' },
      { value: 'strong', label: 'Forte' },
    ],
  },
  {
    key: 'lightFlicker',
    category: 'video',
    label: 'Oscilação de Luminárias',
    description:
      'Permite desativar as piscadas elétricas das arandelas para maior conforto visual.',
    kind: 'toggle',
    onLabel: 'Dinâmica',
    offLabel: 'Estável',
  },

  // --- ÁUDIO & ACÚSTICA (5) ---
  {
    key: 'masterVolume',
    category: 'audio',
    label: 'Volume Geral',
    description: 'Nível mestre de saída de todo o motor sonoro WebAudio.',
    kind: 'range',
    min: 0,
    max: 100,
    step: 1,
    unit: '%',
  },
  {
    key: 'sfxVolume',
    category: 'audio',
    label: 'Efeitos 3D, Passos & Criatura',
    description:
      'Volume das botas EVA, respiração, batimentos cardíacos, teias e passos da aranha.',
    kind: 'range',
    min: 0,
    max: 100,
    step: 1,
    unit: '%',
  },
  {
    key: 'uiVolume',
    category: 'audio',
    label: 'Interface, Radar & Rádio',
    description:
      'Volume dos cliques de inventário, bipes do radar topográfico e alertas de esquadrão.',
    kind: 'range',
    min: 0,
    max: 100,
    step: 1,
    unit: '%',
  },
  {
    key: 'reverbAmount',
    category: 'audio',
    label: 'Reverberação dos Corredores',
    description:
      'Intensidade do eco convolucional das galerias subterrâneas de pedra e aço.',
    kind: 'range',
    min: 0,
    max: 100,
    step: 2,
    unit: '%',
  },
  {
    key: 'muteWhenUnfocused',
    category: 'audio',
    label: 'Silenciar Fora de Foco',
    description:
      'Corta o som automaticamente quando a janela ou aba do navegador é minimizada.',
    kind: 'toggle',
    onLabel: 'Sim',
    offLabel: 'Não',
  },
  {
    key: 'retroVoiceEffectEnabled',
    category: 'audio',
    label: 'Efeito de Voz Retro 8-Bit',
    description:
      'Liga ou desliga apenas a textura sonora 8-bit da comunicação. O microfone, o relay/WebRTC, o rádio e a voz por proximidade continuam funcionando.',
    kind: 'toggle',
    onLabel: 'Ativo',
    offLabel: 'Desativado',
  },

  // --- CONTROLES & MIRA (6) ---
  {
    key: 'mouseSensitivity',
    category: 'controls',
    label: 'Sensibilidade do Mouse',
    description: 'Velocidade de rotação horizontal e vertical da câmera em 1ª pessoa.',
    kind: 'range',
    min: 20,
    max: 250,
    step: 5,
    unit: '%',
  },
  {
    key: 'invertMouseY',
    category: 'controls',
    label: 'Inverter Eixo Vertical (Y)',
    description: 'Inverte o movimento cima/baixo ao olhar com o mouse ou toque.',
    kind: 'toggle',
    onLabel: 'Invertido',
    offLabel: 'Normal',
  },
  {
    key: 'crouchMode',
    category: 'controls',
    label: 'Comportamento de Agachar [Ctrl / C]',
    description:
      'Escolha entre manter a tecla pressionada ou alternar agachado com um toque.',
    kind: 'choice',
    choices: [
      { value: 'hold', label: 'Segurar' },
      { value: 'toggle', label: 'Alternar' },
    ],
  },
  {
    key: 'sprintMode',
    category: 'controls',
    label: 'Comportamento de Correr [Shift]',
    description:
      'Escolha entre segurar Shift para correr ou alternar corrida enquanto avança.',
    kind: 'choice',
    choices: [
      { value: 'hold', label: 'Segurar' },
      { value: 'toggle', label: 'Alternar' },
    ],
  },
  {
    key: 'invertWheelShortcuts',
    category: 'controls',
    label: 'Inverter Rolinha nos Atalhos',
    description:
      'Inverte a direção da roda do mouse ao percorrer os atalhos rápidos [1–3].',
    kind: 'toggle',
    onLabel: 'Invertida',
    offLabel: 'Padrão',
  },
  {
    key: 'touchLookSensitivity',
    category: 'controls',
    label: 'Sensibilidade Tátil (Mobile)',
    description: 'Velocidade da mira por arrasto na tela em celulares e tablets.',
    kind: 'range',
    min: 40,
    max: 200,
    step: 5,
    unit: '%',
  },

  // --- JOGABILIDADE & CÂMERA (4) ---
  {
    key: 'headBobIntensity',
    category: 'gameplay',
    label: 'Balanço ao Caminhar (Head Bob)',
    description:
      'Oscilação física da passada em 1ª pessoa (reduza para 0% caso sinta enjoo de movimento).',
    kind: 'range',
    min: 0,
    max: 130,
    step: 5,
    unit: '%',
  },
  {
    key: 'screenShakeIntensity',
    category: 'gameplay',
    label: 'Tremor de Câmera & Impacto',
    description:
      'Intensidade da vibração da visão ao correr perto da aranha, deslizar ou sofrer dano.',
    kind: 'range',
    min: 0,
    max: 130,
    step: 5,
    unit: '%',
  },
  {
    key: 'showCrosshair',
    category: 'gameplay',
    label: 'Retículo Central de Mira',
    description:
      'Exibe um ponto discreto ou cruz tática no centro da tela para facilitar coleta e ping.',
    kind: 'choice',
    choices: [
      { value: 'off', label: 'Oculto' },
      { value: 'dot', label: 'Ponto' },
      { value: 'cross', label: 'Cruz' },
    ],
  },
  {
    key: 'showFpsCounter',
    category: 'gameplay',
    label: 'Telemetria de FPS & Resolução',
    description:
      'Mostra no canto superior a taxa de quadros por segundo e a resolução interna ativa.',
    kind: 'toggle',
    onLabel: 'Visível',
    offLabel: 'Oculto',
  },

  // --- INTERFACE & ACESSIBILIDADE (4) ---
  {
    key: 'shortcutsHubIdleOpacity',
    category: 'interface',
    label: 'Opacidade da Barra de Atalhos',
    description:
      'Transparência da HUB inferior [F / 1–3] quando está em repouso durante a exploração.',
    kind: 'range',
    min: 15,
    max: 95,
    step: 5,
    unit: '%',
  },
  {
    key: 'viewmodelHand',
    category: 'interface',
    label: 'Mão Dominante em 1ª Pessoa',
    description:
      'Define o lado em que o traje biológico empunha a lanterna e ferramentas na tela.',
    kind: 'choice',
    choices: [
      { value: 'right', label: 'Destro' },
      { value: 'left', label: 'Canhoto' },
    ],
  },
  {
    key: 'bloodOverlayScale',
    category: 'interface',
    label: 'Intensidade Visual de Ferimentos',
    description:
      'Regula a opacidade máxima da vinheta de sangue nas bordas quando ferido.',
    kind: 'range',
    min: 25,
    max: 100,
    step: 5,
    unit: '%',
  },
  {
    key: 'autoFullscreenOnResume',
    category: 'interface',
    label: 'Tela Cheia Automática ao Jogar',
    description:
      'Solicita tela cheia automaticamente ao retomar a incursão (desative para jogar em janela).',
    kind: 'toggle',
    onLabel: 'Ativa',
    offLabel: 'Janela',
  },

  // --- DESEMPENHO & OTIMIZAÇÃO (11) ---
  {
    key: 'perfPreset',
    category: 'performance',
    label: 'Pacote de Desempenho',
    description:
      'Aplica um conjunto coerente de ajustes de uma vez: Eco prioriza fluidez e bateria, Qualidade prioriza nitidez. Ajuste qualquer opção abaixo para virar Personalizado.',
    kind: 'choice',
    choices: [
      { value: 'eco', label: 'Eco (30 FPS)' },
      { value: 'balanced', label: 'Equilibrado (60 FPS)' },
      { value: 'quality', label: 'Qualidade (máximo)' },
      { value: 'custom', label: 'Personalizado' },
    ],
  },
  {
    key: 'targetFps',
    category: 'performance',
    label: 'Limite de Quadros por Segundo',
    description:
      'Trava o jogo numa taxa fixa. Limitar em 30 ou 60 dá entrega de quadros muito mais regular e esfria a máquina; "Sem limite" deixa o monitor mandar.',
    kind: 'choice',
    choices: [
      { value: 30, label: '30 FPS' },
      { value: 60, label: '60 FPS' },
      { value: 90, label: '90 FPS' },
      { value: 120, label: '120 FPS' },
      { value: 0, label: 'Sem limite' },
    ],
  },
  {
    key: 'autoOptimizer',
    category: 'performance',
    label: 'Otimização Automática Inteligente',
    description:
      'Mede o tempo de cada quadro e ajusta resolução, luzes e efeitos sozinho para segurar o alvo de FPS — inclusive descobrindo se o gargalo é o processador ou a placa de vídeo.',
    kind: 'toggle',
    onLabel: 'Ativa',
    offLabel: 'Desligada',
  },
  {
    key: 'optimizerAggressiveness',
    category: 'performance',
    label: 'Ímpeto do Ajuste Automático',
    description:
      'Quão rápido o sistema reage: Suave demora mais para mudar (imagem mais estável), Agressivo corrige quedas na hora (mais fiel ao alvo de FPS).',
    kind: 'choice',
    choices: [
      { value: 'gentle', label: 'Suave' },
      { value: 'balanced', label: 'Equilibrado' },
      { value: 'aggressive', label: 'Agressivo' },
    ],
  },
  {
    key: 'renderScalePercent',
    category: 'performance',
    label: 'Escala da Resolução Interna',
    description:
      'Multiplica a resolução retrô escolhida em Vídeo. Abaixo de 100% o jogo fica mais leve e levemente mais granulado; acima, mais nítido e mais pesado.',
    kind: 'range',
    min: 50,
    max: 160,
    step: 5,
    unit: '%',
  },
  {
    key: 'maxDynamicLights',
    category: 'performance',
    label: 'Orçamento de Luzes Dinâmicas',
    description:
      'Quantas luminárias o shader calcula por pixel. É o item que mais pesa no labirinto: menos luzes, muito mais quadros por segundo.',
    kind: 'range',
    min: 8,
    max: 48,
    step: 4,
    unit: 'luzes',
  },
  {
    key: 'viewmodelShadowQuality',
    category: 'performance',
    label: 'Sombra Real em 1ª Pessoa',
    description:
      'A lanterna e as mãos projetam sombra umas sobre as outras. Desligar remove um passe de renderização inteiro por quadro.',
    kind: 'choice',
    choices: [
      { value: 'off', label: 'Desligada' },
      { value: 'low', label: 'Baixa (256)' },
      { value: 'high', label: 'Alta (512)' },
    ],
  },
  {
    key: 'contactShadowRate',
    category: 'performance',
    label: 'Sombras de Contato dos Objetos',
    description:
      'Com que frequência as sombras no chão dos caixotes e equipamentos são recalculadas. Em 0 elas ficam estáticas em vez de seguirem a luz.',
    kind: 'choice',
    choices: [
      { value: 0, label: 'Desligadas' },
      { value: 15, label: '15 por seg.' },
      { value: 30, label: '30 por seg.' },
      { value: 60, label: 'Todo quadro' },
    ],
  },
  {
    key: 'drawDistance',
    category: 'performance',
    label: 'Alcance de Desenho',
    description:
      'Até que distância a câmera desenha objetos, teias e criaturas. Encurtar reduz bastante o trabalho em corredores longos.',
    kind: 'range',
    min: 45,
    max: 125,
    step: 5,
    unit: 'm',
  },
  {
    key: 'reduceWhenUnfocused',
    category: 'performance',
    label: 'Economizar sem Foco',
    description:
      'Ao trocar de janela o jogo corta a resolução e a taxa de quadros em vez de continuar renderizando a plena carga.',
    kind: 'toggle',
    onLabel: 'Economiza',
    offLabel: 'Mantém',
  },
  {
    key: 'showPerfHud',
    category: 'performance',
    label: 'Painel de Telemetria ao Vivo',
    description:
      'Mostra FPS, tempo de quadro, uso de processador, onde está o gargalo e o que o ajuste automático está fazendo agora.',
    kind: 'toggle',
    onLabel: 'Visível',
    offLabel: 'Oculto',
  },
];

export function resolutionPresetToHeight(
  preset: InternalResolutionPreset
): number {
  switch (preset) {
    case '180p':
      return 180;
    case '250p':
      return 250;
    case '360p':
      return 360;
    case '480p':
      return 480;
    case '720p':
      return 720;
    default:
      return 250;
  }
}

function clampNum(val: unknown, min: number, max: number, fallback: number): number {
  const n = typeof val === 'number' && Number.isFinite(val) ? val : fallback;
  return Math.max(min, Math.min(max, n));
}

function clampBool(val: unknown, fallback: boolean): boolean {
  return typeof val === 'boolean' ? val : fallback;
}

function clampChoice<T extends string | number>(
  val: unknown,
  allowed: readonly T[],
  fallback: T
): T {
  const pool = allowed as readonly (string | number)[];
  return (typeof val === 'string' || typeof val === 'number') && pool.includes(val)
    ? (val as T)
    : fallback;
}

export function sanitizeDoomSettings(
  raw:
    | (Partial<Record<keyof DoomGameSettings, unknown>> & {
        /** Migração das versões que chamavam o efeito de `voiceChatEnabled`. */
        voiceChatEnabled?: unknown;
      })
    | null
    | undefined
): DoomGameSettings {
  const r = raw ?? {};
  const d = DEFAULT_DOOM_SETTINGS;
  const legacyRetroVoice =
    typeof r.voiceChatEnabled === 'boolean'
      ? r.voiceChatEnabled
      : d.retroVoiceEffectEnabled;
  return {
    resolutionHeight: clampChoice(
      r.resolutionHeight,
      ['180p', '250p', '360p', '480p', '720p'] as const,
      d.resolutionHeight
    ),
    fov: Math.round(clampNum(r.fov, 60, 105, d.fov)),
    brightness: Math.round(clampNum(r.brightness, 60, 160, d.brightness)),
    contrast: Math.round(clampNum(r.contrast, 75, 140, d.contrast)),
    ditherMode: clampBool(r.ditherMode, d.ditherMode),
    crtScanlines: clampChoice(
      r.crtScanlines,
      ['off', 'subtle', 'strong'] as const,
      d.crtScanlines
    ),
    lightFlicker: clampBool(r.lightFlicker, d.lightFlicker),

    masterVolume: Math.round(clampNum(r.masterVolume, 0, 100, d.masterVolume)),
    sfxVolume: Math.round(clampNum(r.sfxVolume, 0, 100, d.sfxVolume)),
    uiVolume: Math.round(clampNum(r.uiVolume, 0, 100, d.uiVolume)),
    reverbAmount: Math.round(clampNum(r.reverbAmount, 0, 100, d.reverbAmount)),
    muteWhenUnfocused: clampBool(r.muteWhenUnfocused, d.muteWhenUnfocused),
    retroVoiceEffectEnabled: clampBool(
      r.retroVoiceEffectEnabled,
      legacyRetroVoice
    ),

    mouseSensitivity: Math.round(
      clampNum(r.mouseSensitivity, 20, 250, d.mouseSensitivity)
    ),
    invertMouseY: clampBool(r.invertMouseY, d.invertMouseY),
    crouchMode: clampChoice(
      r.crouchMode,
      ['hold', 'toggle'] as const,
      d.crouchMode
    ),
    sprintMode: clampChoice(
      r.sprintMode,
      ['hold', 'toggle'] as const,
      d.sprintMode
    ),
    invertWheelShortcuts: clampBool(
      r.invertWheelShortcuts,
      d.invertWheelShortcuts
    ),
    touchLookSensitivity: Math.round(
      clampNum(r.touchLookSensitivity, 40, 200, d.touchLookSensitivity)
    ),

    headBobIntensity: Math.round(
      clampNum(r.headBobIntensity, 0, 130, d.headBobIntensity)
    ),
    screenShakeIntensity: Math.round(
      clampNum(r.screenShakeIntensity, 0, 130, d.screenShakeIntensity)
    ),
    showCrosshair: clampChoice(
      r.showCrosshair,
      ['off', 'dot', 'cross'] as const,
      d.showCrosshair
    ),
    showFpsCounter: clampBool(r.showFpsCounter, d.showFpsCounter),

    shortcutsHubIdleOpacity: Math.round(
      clampNum(r.shortcutsHubIdleOpacity, 15, 95, d.shortcutsHubIdleOpacity)
    ),
    viewmodelHand: clampChoice(
      r.viewmodelHand,
      ['right', 'left'] as const,
      d.viewmodelHand
    ),
    bloodOverlayScale: Math.round(
      clampNum(r.bloodOverlayScale, 25, 100, d.bloodOverlayScale)
    ),
    autoFullscreenOnResume: clampBool(
      r.autoFullscreenOnResume,
      d.autoFullscreenOnResume
    ),

    perfPreset: clampChoice(
      r.perfPreset,
      ['eco', 'balanced', 'quality', 'custom'] as const,
      d.perfPreset
    ),
    targetFps: clampChoice(
      r.targetFps,
      [0, 30, 60, 90, 120] as const,
      d.targetFps
    ),
    autoOptimizer: clampBool(r.autoOptimizer, d.autoOptimizer),
    optimizerAggressiveness: clampChoice(
      r.optimizerAggressiveness,
      ['gentle', 'balanced', 'aggressive'] as const,
      d.optimizerAggressiveness
    ),
    renderScalePercent: Math.round(
      clampNum(r.renderScalePercent, 50, 160, d.renderScalePercent)
    ),
    maxDynamicLights: Math.round(
      clampNum(r.maxDynamicLights, 8, 48, d.maxDynamicLights)
    ),
    viewmodelShadowQuality: clampChoice(
      r.viewmodelShadowQuality,
      ['off', 'low', 'high'] as const,
      d.viewmodelShadowQuality
    ),
    contactShadowRate: clampChoice(
      r.contactShadowRate,
      [0, 15, 30, 60] as const,
      d.contactShadowRate
    ),
    drawDistance: Math.round(clampNum(r.drawDistance, 45, 125, d.drawDistance)),
    reduceWhenUnfocused: clampBool(
      r.reduceWhenUnfocused,
      d.reduceWhenUnfocused
    ),
    showPerfHud: clampBool(r.showPerfHud, d.showPerfHud),
  };
}

export const DOOM_SETTINGS_STORAGE_KEY = 'oof_doom_settings_v1';

export function loadDoomSettings(): Readonly<DoomGameSettings> {
  return new DoomSettingsStore().value;
}

export type DoomSettingsListener = (settings: Readonly<DoomGameSettings>) => void;

export class DoomSettingsStore {
  private current: DoomGameSettings;
  private readonly listeners = new Set<DoomSettingsListener>();

  constructor(initialOverride?: Partial<DoomGameSettings>) {
    const loaded = this.readFromStorage();
    this.current = sanitizeDoomSettings({ ...loaded, ...initialOverride });
  }

  get value(): Readonly<DoomGameSettings> {
    return this.current;
  }

  set<K extends keyof DoomGameSettings>(
    key: K,
    nextVal: DoomGameSettings[K]
  ): Readonly<DoomGameSettings> {
    const merged = this.mergeWithPresetSemantics(key, nextVal);
    if (merged[key] === this.current[key]) {
      return this.current;
    }
    this.current = merged;
    this.writeToStorage(this.current);
    this.emit();
    return this.current;
  }

  /**
   * Escolher um pacote de desempenho escreve o conjunto inteiro de uma vez;
   * ajustar qualquer opção do pacote por conta própria marca "Personalizado".
   */
  private mergeWithPresetSemantics<K extends keyof DoomGameSettings>(
    key: K,
    nextVal: DoomGameSettings[K]
  ): DoomGameSettings {
    if (key === 'perfPreset') {
      const preset = nextVal as PerformancePresetId;
      if (preset !== 'custom') {
        const bundle = PERFORMANCE_PRESETS[preset];
        if (bundle) {
          return sanitizeDoomSettings({
            ...this.current,
            ...bundle,
            perfPreset: preset,
          });
        }
      }
      return sanitizeDoomSettings({ ...this.current, [key]: nextVal });
    }

    if (PERFORMANCE_SETTING_KEYS.has(key)) {
      return sanitizeDoomSettings({
        ...this.current,
        [key]: nextVal,
        perfPreset: 'custom',
      });
    }

    return sanitizeDoomSettings({ ...this.current, [key]: nextVal });
  }

  update(patch: Partial<DoomGameSettings>): Readonly<DoomGameSettings> {
    this.current = sanitizeDoomSettings({ ...this.current, ...patch });
    this.writeToStorage(this.current);
    this.emit();
    return this.current;
  }

  resetToDefaults(): Readonly<DoomGameSettings> {
    this.current = sanitizeDoomSettings(DEFAULT_DOOM_SETTINGS);
    this.writeToStorage(this.current);
    this.emit();
    return this.current;
  }

  subscribe(listener: DoomSettingsListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(): void {
    for (const fn of this.listeners) {
      fn(this.current);
    }
  }

  private readFromStorage(): Partial<DoomGameSettings> {
    try {
      if (typeof localStorage === 'undefined') return {};
      const raw = localStorage.getItem(DOOM_SETTINGS_STORAGE_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === 'object') {
        return parsed as Partial<DoomGameSettings>;
      }
    } catch {
      // Ignorar falhas de armazenamento privado / testes Node
    }
    return {};
  }

  private writeToStorage(settings: DoomGameSettings): void {
    try {
      if (typeof localStorage === 'undefined') return;
      localStorage.setItem(DOOM_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
    } catch {
      // Ignorar
    }
  }
}
