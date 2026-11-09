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

export type SettingsCategoryId =
  | 'video'
  | 'audio'
  | 'controls'
  | 'gameplay'
  | 'interface';

/**
 * Conjunto completo de 26 opções reais de configuração do jogo,
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

  // 2. ÁUDIO & ACÚSTICA (5 opções)
  masterVolume: number; // 0..100 % (padrão 82)
  sfxVolume: number; // 0..100 % (padrão 94)
  uiVolume: number; // 0..100 % (padrão 90)
  reverbAmount: number; // 0..100 % (padrão 68)
  muteWhenUnfocused: boolean; // Silenciar ao minimizar aba (padrão false)

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

  // 5. INTERFACE & ACESSIBILIDADE (4 opções -> Total: 26 opções)
  shortcutsHubIdleOpacity: number; // 15..95 % opacidade da HUB em repouso (padrão 52)
  viewmodelHand: DominantHandMode; // right | left (padrão 'right')
  bloodOverlayScale: number; // 25..100 % intensidade de sangue nas bordas (padrão 100)
  autoFullscreenOnResume: boolean; // Entrar em tela cheia ao retomar (padrão true)
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
});

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

function clampChoice<T extends string>(
  val: unknown,
  allowed: readonly T[],
  fallback: T
): T {
  return typeof val === 'string' && (allowed as readonly string[]).includes(val)
    ? (val as T)
    : fallback;
}

export function sanitizeDoomSettings(
  raw: Partial<Record<keyof DoomGameSettings, unknown>> | null | undefined
): DoomGameSettings {
  const r = raw ?? {};
  const d = DEFAULT_DOOM_SETTINGS;
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
    const merged = sanitizeDoomSettings({
      ...this.current,
      [key]: nextVal,
    });
    if (merged[key] === this.current[key]) {
      return this.current;
    }
    this.current = merged;
    this.writeToStorage(this.current);
    this.emit();
    return this.current;
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
