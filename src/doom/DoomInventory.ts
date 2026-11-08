import { SoundEngine } from '../engine/audio/SoundEngine';
import {
  CursorProximityFX,
  ProximityTargetRect,
} from '../terminal/CursorProximityFX';

export type InventoryItemKind =
  | 'lantern'
  | 'bandage'
  | 'morphine'
  | 'battery'
  | 'knife'
  | 'flare'
  | 'key'
  | 'note';

export interface InventoryItemDef {
  id: string;
  kind: InventoryItemKind;
  name: string;
  category: string;
  description: string;
  noteContent?: string;
  stackable: boolean;
  usable: boolean;
  actionLabel?: string;
  droppable?: boolean;
}

export interface InventorySlotEntry {
  def: InventoryItemDef;
  quantity: number;
}

export interface PlayerVitalsSnapshot {
  /** 0..100 */
  health: number;
  /** 0..100 (100 = mente lúcida, 0 = pânico extremo) */
  sanity: number;
  /** 0..100 carga da lanterna */
  battery: number;
  flashlightEquipped: boolean;
  trappedInWeb: boolean;
  bleeding: boolean;
  crouching: boolean;
  beingChased: boolean;
}

export interface DoomInventoryCallbacks {
  onToggleFlashlightFromUI: () => void;
  onUseHeal: (healAmount: number, calmAmount: number) => boolean;
  onUseBattery: (chargeAmount: number) => boolean;
  onUseFlare: () => boolean;
  onCloseRequest: () => void;
  onPermanentDeathTerminate: () => void;
}

const TOTAL_SLOTS = 12;

export const ITEM_CATALOG: Record<string, InventoryItemDef> = {
  tactical_lantern: {
    id: 'tactical_lantern',
    kind: 'lantern',
    name: 'Lanterna Tática',
    category: 'Equipamento Essencial',
    description:
      'Lanterna de alumínio anodizado com foco halógeno concentrado. Pressione [F] a qualquer momento para empunhar ou apagar o feixe no escuro.',
    stackable: false,
    usable: true,
    actionLabel: 'Alternar [F]',
    droppable: false,
  },
  sterile_bandage: {
    id: 'sterile_bandage',
    kind: 'bandage',
    name: 'Bandagem Estéril',
    category: 'Suprimento Médico',
    description:
      'Rolo de gaze espessa ainda selado. Estanca cortes profundos deixados pelas pontas ósseas da criatura e restaura boa parte do vigor físico.',
    stackable: true,
    usable: true,
    actionLabel: 'Enfaixar Feridas',
    droppable: true,
  },
  old_morphine: {
    id: 'old_morphine',
    kind: 'morphine',
    name: 'Frasco de Láudano & Analgésico',
    category: 'Tônico Vital',
    description:
      'Frasco âmbar pesado usado por equipes subterrâneas antigas. Entorpece a dor aguda rapidamente, recupera vitalidade alta e acalma a tremedeira dos nervos.',
    stackable: true,
    usable: true,
    actionLabel: 'Ingerir Dose',
    droppable: true,
  },
  industrial_battery: {
    id: 'industrial_battery',
    kind: 'battery',
    name: 'Bateria Industrial 9V',
    category: 'Fonte de Energia',
    description:
      'Célula alcalina blindada de alta densidade. Recarrega imediatamente o acumulador da Lanterna Tática para manter os corredores e o teto visíveis.',
    stackable: true,
    usable: true,
    actionLabel: 'Recarregar Lanterna',
    droppable: true,
  },
  rusty_knife: {
    id: 'rusty_knife',
    kind: 'knife',
    name: 'Canivete de Manutenção',
    category: 'Ferramenta de Sobrevivência',
    description:
      'Lâmina curta oxidada, mas ainda afiada. Mantê-la na bolsa permite rasgar armadilhas de teia e se soltar do bote da aranha muito mais depressa.',
    stackable: false,
    usable: false,
    droppable: false,
  },
  magnesium_flare: {
    id: 'magnesium_flare',
    kind: 'flare',
    name: 'Sinalizador de Magnésio',
    category: 'Defesa / Iluminação',
    description:
      'Bastão químico que queima em chama rubra intensa no chão. Ilumina todo o corredor ao redor e afugenta temporariamente a aranha sensível ao calor intenso.',
    stackable: true,
    usable: true,
    actionLabel: 'Acender no Chão',
    droppable: true,
  },
  sector_b_key: {
    id: 'sector_b_key',
    kind: 'key',
    name: 'Chave de Inspeção — Setor B',
    category: 'Objeto Coletado',
    description:
      'Chave pesada de latão escuro encontrada junto às galerias de pedra. Traz gravado o código da antiga ala de contenção subterrânea.',
    stackable: false,
    usable: false,
    droppable: false,
  },
  torn_log_04: {
    id: 'torn_log_04',
    kind: 'note',
    name: 'Diário Rasgado #04',
    category: 'Registro Encontrado',
    description:
      'Folha manchada arrancada de uma prancheta técnica no corredor norte.',
    noteContent:
      '“14/OUT — Não olhe apenas para o chão. A coisa caminha devagar pelas grades do teto e escala os blocos de pedra sem fazer quase barulho. Ela tece fios quase invisíveis nos vãos dos arcos para sentir a vibração de quem pisa. Se ela gritar... não tente encarar. CORRA.”',
    stackable: false,
    usable: false,
    droppable: false,
  },
  arachnid_report_09: {
    id: 'arachnid_report_09',
    kind: 'note',
    name: 'Relatório de Contenção #09',
    category: 'Registro Encontrado',
    description:
      'Anotação apressada deixada na galeria sul de alvenaria.',
    noteContent:
      '“Observação final: Agachar no escuro reduz a chance de ela notar sua presença à distância. Sinalizadores de magnésio fazem suas patas recuarem por alguns segundos. Nunca fique preso numa teia sem uma lâmina por perto.”',
    stackable: false,
    usable: false,
    droppable: false,
  },
};

/**
 * Desenha ícones pixel-art 24x24 sombrios e nítidos para cada tipo de objeto do inventário.
 */
function buildItemIcons(): Record<InventoryItemKind, string> {
  const kinds: InventoryItemKind[] = [
    'lantern',
    'bandage',
    'morphine',
    'battery',
    'knife',
    'flare',
    'key',
    'note',
  ];

  const out = {} as Record<InventoryItemKind, string>;

  for (const kind of kinds) {
    const c = document.createElement('canvas');
    c.width = 24;
    c.height = 24;
    const ctx = c.getContext('2d')!;
    ctx.clearRect(0, 0, 24, 24);

    const rect = (x: number, y: number, w: number, h: number, col: string) => {
      ctx.fillStyle = col;
      ctx.fillRect(x, y, w, h);
    };

    if (kind === 'lantern') {
      rect(3, 10, 12, 5, '#595f6a');
      rect(3, 10, 12, 1, '#8c94a3');
      rect(5, 11, 1, 3, '#282b31');
      rect(8, 11, 1, 3, '#282b31');
      rect(11, 11, 1, 3, '#282b31');
      rect(10, 8, 3, 2, '#9e3232');
      rect(15, 8, 4, 9, '#707784');
      rect(19, 9, 2, 7, '#ffd984');
      rect(21, 10, 1, 5, '#fff5d1');
    } else if (kind === 'bandage') {
      rect(5, 6, 14, 12, '#cfc6b4');
      rect(6, 5, 12, 1, '#e4dccb');
      rect(6, 18, 12, 1, '#8d8475');
      rect(5, 9, 14, 1, '#a99f8e');
      rect(5, 14, 14, 1, '#a99f8e');
      // Cruz médica vinho-escura
      rect(11, 8, 2, 8, '#8f2626');
      rect(8, 11, 8, 2, '#8f2626');
      rect(18, 15, 3, 2, '#bfb5a2');
    } else if (kind === 'morphine') {
      rect(10, 3, 4, 3, '#8b6d4b'); // rolha
      rect(9, 6, 6, 2, '#9ca8b5'); // gargalo
      rect(7, 8, 10, 12, '#6e3b1e'); // vidro âmbar
      rect(8, 9, 2, 9, '#b87339'); // reflexo
      rect(8, 12, 8, 5, '#cbbba0'); // rótulo antigo
      rect(9, 14, 6, 1, '#6a2323');
      rect(8, 20, 8, 1, '#3d2010');
    } else if (kind === 'battery') {
      rect(8, 4, 3, 2, '#c8a86b');
      rect(13, 4, 3, 2, '#c8a86b');
      rect(6, 6, 12, 14, '#2d3138');
      rect(6, 6, 12, 4, '#9e6b2b');
      rect(7, 7, 10, 1, '#d49d49');
      rect(11, 11, 2, 6, '#d6c69e');
      rect(9, 13, 6, 2, '#d6c69e');
    } else if (kind === 'knife') {
      // Cabo escuro diagonal + lâmina chanfrada
      rect(4, 15, 7, 4, '#4b3628');
      rect(5, 16, 5, 2, '#6b4e3b');
      rect(10, 14, 2, 4, '#8d8579');
      rect(12, 10, 4, 4, '#aeb6c2');
      rect(15, 7, 4, 4, '#cfd6e0');
      rect(18, 5, 3, 3, '#e8eef5');
      rect(13, 12, 2, 1, '#7a3326'); // ponto de ferrugem
    } else if (kind === 'flare') {
      rect(4, 11, 14, 4, '#9c2626');
      rect(4, 11, 14, 1, '#cc433b');
      rect(6, 11, 1, 4, '#2a2424');
      rect(13, 11, 1, 4, '#2a2424');
      rect(18, 10, 2, 6, '#5c5552');
      rect(20, 9, 2, 2, '#ffb347');
      rect(21, 12, 2, 2, '#fff0a8');
      rect(20, 15, 2, 1, '#ff7733');
    } else if (kind === 'key') {
      rect(4, 9, 6, 6, '#9c824a');
      rect(6, 11, 2, 2, '#0c0c0e');
      rect(10, 11, 10, 2, '#b89b5c');
      rect(15, 13, 2, 3, '#9c824a');
      rect(18, 13, 2, 4, '#9c824a');
    } else {
      // Nota / papel rasgado
      rect(6, 4, 12, 16, '#c7bca6');
      rect(7, 5, 10, 14, '#d8ceb9');
      rect(8, 7, 7, 1, '#574e43');
      rect(8, 10, 8, 1, '#574e43');
      rect(8, 13, 6, 1, '#574e43');
      rect(13, 15, 4, 3, '#7d2020'); // mancha de sangue seco
    }

    out[kind] = c.toDataURL();
  }

  return out;
}

/**
 * Gerenciador completo de Inventário de Terror (Tecla Tab) inspirado em Amnesia,
 * mostrando Sinais Vitais, Estado Psicológico, Carga da Lanterna e todos os
 * objetos coletados pelo jogador ao longo do tempo — sem poluir a tela durante o jogo.
 */
export class DoomInventory {
  private readonly overlayEl: HTMLElement;
  private readonly diegeticEl: HTMLElement;
  private readonly bloodVignetteEl: HTMLElement;
  private readonly webSnareEl: HTMLElement;
  private readonly pickupGlintEl: HTMLElement;
  private readonly attackSlashEl: HTMLElement;
  private readonly cocoonSilkEl: HTMLElement;
  private readonly eyelidTopEl: HTMLElement;
  private readonly eyelidBottomEl: HTMLElement;
  private readonly blackoutVeilEl: HTMLElement;
  private readonly gameOverEl: HTMLElement;

  private readonly heartSvgEl: SVGElement;
  private readonly heartPathEl: SVGPathElement;
  private readonly healthTitleEl: HTMLElement;
  private readonly healthDescEl: HTMLElement;
  private readonly healthPctEl: HTMLElement;
  private readonly healthBarEl: HTMLElement;
  private readonly vitalTagsEl: HTMLElement;

  private readonly eyeSvgEl: SVGElement;
  private readonly eyeIrisEl: SVGCircleElement;
  private readonly sanityTitleEl: HTMLElement;
  private readonly sanityDescEl: HTMLElement;
  private readonly sanityBarEl: HTMLElement;

  private readonly gearStateEl: HTMLElement;
  private readonly batteryPctEl: HTMLElement;
  private readonly batteryBarEl: HTMLElement;

  private readonly slotCounterEl: HTMLElement;
  private readonly gridEl: HTMLElement;
  private readonly inspectorPreviewEl: HTMLElement;
  private readonly inspectorCatEl: HTMLElement;
  private readonly inspectorTitleEl: HTMLElement;
  private readonly inspectorDescEl: HTMLElement;
  private readonly inspectorNoteWrapEl: HTMLElement;
  private readonly feedbackMsgEl: HTMLElement;
  private readonly btnRowEl: HTMLElement;

  private readonly icons: Record<InventoryItemKind, string>;
  private readonly proximityFX: CursorProximityFX;

  private slots: Array<InventorySlotEntry | null> = new Array(TOTAL_SLOTS).fill(
    null
  );
  private selectedIndex = 0;
  private isOpen = false;
  private isGameOver = false;
  private pickupFlashTimer = 0;

  private latestVitals: PlayerVitalsSnapshot = {
    health: 100,
    sanity: 100,
    battery: 100,
    flashlightEquipped: false,
    trappedInWeb: false,
    bleeding: false,
    crouching: false,
    beingChased: false,
  };

  constructor(
    parentViewport: HTMLElement,
    private readonly sound: SoundEngine,
    private readonly callbacks: DoomInventoryCallbacks
  ) {
    this.icons = buildItemIcons();

    // 1. Camada atmosférica diegética (zero números ou HUD durante exploração limpa)
    this.diegeticEl = document.createElement('div');
    this.diegeticEl.id = 'doom-diegetic-fx';
    this.diegeticEl.innerHTML = `
      <div class="doom-blood-vignette"></div>
      <div class="doom-web-snare-fx"></div>
      <div class="doom-cocoon-silk"></div>
      <div class="doom-pickup-glint"></div>
      <div class="doom-attack-slash"></div>
      <div class="doom-eyelid-top"></div>
      <div class="doom-eyelid-bottom"></div>
      <div class="doom-blackout-veil"></div>
    `;
    parentViewport.appendChild(this.diegeticEl);

    this.bloodVignetteEl = this.diegeticEl.querySelector(
      '.doom-blood-vignette'
    ) as HTMLElement;
    this.webSnareEl = this.diegeticEl.querySelector(
      '.doom-web-snare-fx'
    ) as HTMLElement;
    this.cocoonSilkEl = this.diegeticEl.querySelector(
      '.doom-cocoon-silk'
    ) as HTMLElement;
    this.pickupGlintEl = this.diegeticEl.querySelector(
      '.doom-pickup-glint'
    ) as HTMLElement;
    this.attackSlashEl = this.diegeticEl.querySelector(
      '.doom-attack-slash'
    ) as HTMLElement;
    this.eyelidTopEl = this.diegeticEl.querySelector(
      '.doom-eyelid-top'
    ) as HTMLElement;
    this.eyelidBottomEl = this.diegeticEl.querySelector(
      '.doom-eyelid-bottom'
    ) as HTMLElement;
    this.blackoutVeilEl = this.diegeticEl.querySelector(
      '.doom-blackout-veil'
    ) as HTMLElement;

    // 2. Overlay principal do Inventário (Tecla Tab)
    this.overlayEl = document.createElement('div');
    this.overlayEl.id = 'doom-inventory-overlay';
    this.overlayEl.innerHTML = `
      <div class="amnesia-shell" role="dialog" aria-label="Inventário e Estado Vital">
        <div class="amnesia-header">
          <div class="amnesia-title-group">
            <span class="amnesia-title">Inventário</span>
            <span class="amnesia-subtitle">Pertences &amp; Condição Vital</span>
          </div>
          <button type="button" class="amnesia-close-hint" data-inv-close="1">[ TAB ] Retornar</button>
        </div>

        <div class="amnesia-body">
          <aside class="amnesia-vitals-col">
            <div class="vital-card">
              <div class="vital-card-label">
                <span>Vitalidade Física</span>
                <span data-health-pct>100%</span>
              </div>
              <div class="vital-portrait-row">
                <div class="vital-organ-frame">
                  <svg class="vital-heart-svg" viewBox="0 0 48 48" fill="none">
                    <path
                      data-heart-path
                      d="M24 41C24 41 8 30.5 8 18.2C8 12.6 12.4 8.5 17.6 8.5C20.7 8.5 23.1 10.2 24 12.4C24.9 10.2 27.3 8.5 30.4 8.5C35.6 8.5 40 12.6 40 18.2C40 30.5 24 41 24 41Z"
                      fill="#7d2323"
                      stroke="#d99b91"
                      stroke-width="1.6"
                    />
                    <polyline
                      points="9,24 17,24 20,17 24,31 27,21 30,24 39,24"
                      stroke="#f2ded9"
                      stroke-width="1.5"
                      fill="none"
                      opacity="0.82"
                    />
                  </svg>
                </div>
                <div class="vital-status-info">
                  <div class="vital-state-title" data-health-title>Saudável</div>
                  <div class="vital-state-desc" data-health-desc>Batimentos firmes. Apenas marcas leves pelo corpo.</div>
                </div>
              </div>
              <div class="vital-bar-track">
                <div class="vital-bar-fill" data-health-bar style="width: 100%"></div>
              </div>
              <div class="vital-tags" data-vital-tags></div>
            </div>

            <div class="vital-card">
              <div class="vital-card-label">
                <span>Estado Psicológico</span>
                <span>Nervos</span>
              </div>
              <div class="vital-portrait-row">
                <div class="vital-organ-frame">
                  <svg class="vital-eye-svg" viewBox="0 0 48 48" fill="none">
                    <path
                      d="M5 24C10.5 14.5 17.2 11 24 11C30.8 11 37.5 14.5 43 24C37.5 33.5 30.8 37 24 37C17.2 37 10.5 33.5 5 24Z"
                      fill="#121418"
                      stroke="#b5ad9e"
                      stroke-width="1.6"
                    />
                    <circle data-eye-iris cx="24" cy="24" r="7" fill="#6f7f94" />
                    <circle cx="24" cy="24" r="3.1" fill="#070709" />
                    <circle cx="21.8" cy="21.8" r="1.3" fill="#e8e2d5" />
                  </svg>
                </div>
                <div class="vital-status-info">
                  <div class="vital-state-title" data-sanity-title>Mente Lúcida</div>
                  <div class="vital-state-desc" data-sanity-desc>Os sentidos permanecem atentos ao silêncio do labirinto.</div>
                </div>
              </div>
              <div class="vital-bar-track">
                <div class="vital-bar-fill sanity" data-sanity-bar style="width: 100%"></div>
              </div>
            </div>

            <div class="vital-card">
              <div class="vital-card-label">
                <span>Lanterna Tática [F]</span>
                <span data-battery-pct>100%</span>
              </div>
              <div class="vital-state-desc" data-gear-state>Guardada — carga máxima disponível.</div>
              <div class="vital-bar-track">
                <div class="vital-bar-fill battery" data-battery-bar style="width: 100%"></div>
              </div>
            </div>
          </aside>

          <section class="amnesia-bag-col">
            <div>
              <div class="amnesia-grid-header">
                <span class="amnesia-section-heading">Objetos Coletados</span>
                <span class="amnesia-slot-counter" data-slot-counter>1 / 12 espaços</span>
              </div>
              <div class="amnesia-grid" data-inv-grid style="margin-top: 10px;"></div>
            </div>

            <div class="amnesia-inspector">
              <div class="amnesia-inspector-top">
                <div class="amnesia-inspector-preview" data-inspector-preview></div>
                <div class="amnesia-inspector-text">
                  <div class="amnesia-item-cat" data-inspector-cat>Selecione um objeto</div>
                  <div class="amnesia-item-title" data-inspector-title>Bolsa de Suprimentos</div>
                  <div class="amnesia-item-desc" data-inspector-desc>Clique em qualquer objeto recolhido no mapa para inspecionar seus detalhes ou utilizá-lo.</div>
                  <div class="amnesia-note-paper" data-inspector-note style="display: none;"></div>
                </div>
              </div>
              <div class="amnesia-inspector-actions">
                <span class="amnesia-feedback-msg" data-feedback-msg></span>
                <div class="amnesia-btn-row" data-btn-row></div>
              </div>
            </div>
          </section>
        </div>
      </div>
    `;
    parentViewport.appendChild(this.overlayEl);

    // 3. Tela de Morte Permanente (sem renascimento na partida — se morrer, morre mesmo!)
    this.gameOverEl = document.createElement('div');
    this.gameOverEl.id = 'doom-capture-gameover';
    this.gameOverEl.innerHTML = `
      <div class="gameover-title">Você Morreu</div>
      <div class="gameover-sub">
        Seu corpo não resistiu ao ataque. Nas galerias escuras, ninguém jamais ouvirá seu último fôlego.
      </div>
      <div class="gameover-perm-note">Sinal vital perdido permanentemente — encerrando processo...</div>
      <button type="button" class="amnesia-action-btn" data-terminate-btn="1">[ Encerrar Sessão ]</button>
    `;
    parentViewport.appendChild(this.gameOverEl);

    this.heartSvgEl = this.overlayEl.querySelector(
      '.vital-heart-svg'
    ) as SVGElement;
    this.heartPathEl = this.overlayEl.querySelector(
      '[data-heart-path]'
    ) as SVGPathElement;
    this.healthTitleEl = this.overlayEl.querySelector(
      '[data-health-title]'
    ) as HTMLElement;
    this.healthDescEl = this.overlayEl.querySelector(
      '[data-health-desc]'
    ) as HTMLElement;
    this.healthPctEl = this.overlayEl.querySelector(
      '[data-health-pct]'
    ) as HTMLElement;
    this.healthBarEl = this.overlayEl.querySelector(
      '[data-health-bar]'
    ) as HTMLElement;
    this.vitalTagsEl = this.overlayEl.querySelector(
      '[data-vital-tags]'
    ) as HTMLElement;

    this.eyeSvgEl = this.overlayEl.querySelector(
      '.vital-eye-svg'
    ) as SVGElement;
    this.eyeIrisEl = this.overlayEl.querySelector(
      '[data-eye-iris]'
    ) as SVGCircleElement;
    this.sanityTitleEl = this.overlayEl.querySelector(
      '[data-sanity-title]'
    ) as HTMLElement;
    this.sanityDescEl = this.overlayEl.querySelector(
      '[data-sanity-desc]'
    ) as HTMLElement;
    this.sanityBarEl = this.overlayEl.querySelector(
      '[data-sanity-bar]'
    ) as HTMLElement;

    this.gearStateEl = this.overlayEl.querySelector(
      '[data-gear-state]'
    ) as HTMLElement;
    this.batteryPctEl = this.overlayEl.querySelector(
      '[data-battery-pct]'
    ) as HTMLElement;
    this.batteryBarEl = this.overlayEl.querySelector(
      '[data-battery-bar]'
    ) as HTMLElement;

    this.slotCounterEl = this.overlayEl.querySelector(
      '[data-slot-counter]'
    ) as HTMLElement;
    this.gridEl = this.overlayEl.querySelector(
      '[data-inv-grid]'
    ) as HTMLElement;
    this.inspectorPreviewEl = this.overlayEl.querySelector(
      '[data-inspector-preview]'
    ) as HTMLElement;
    this.inspectorCatEl = this.overlayEl.querySelector(
      '[data-inspector-cat]'
    ) as HTMLElement;
    this.inspectorTitleEl = this.overlayEl.querySelector(
      '[data-inspector-title]'
    ) as HTMLElement;
    this.inspectorDescEl = this.overlayEl.querySelector(
      '[data-inspector-desc]'
    ) as HTMLElement;
    this.inspectorNoteWrapEl = this.overlayEl.querySelector(
      '[data-inspector-note]'
    ) as HTMLElement;
    this.feedbackMsgEl = this.overlayEl.querySelector(
      '[data-feedback-msg]'
    ) as HTMLElement;
    this.btnRowEl = this.overlayEl.querySelector(
      '[data-btn-row]'
    ) as HTMLElement;

    // Botão fechar no topo e clique no fundo escuro externo
    this.overlayEl
      .querySelector('[data-inv-close]')
      ?.addEventListener('click', () => {
        this.callbacks.onCloseRequest();
      });
    this.overlayEl.addEventListener('mousedown', (e) => {
      if (e.target === this.overlayEl) {
        this.callbacks.onCloseRequest();
      }
    });

    this.gameOverEl
      .querySelector('[data-terminate-btn]')
      ?.addEventListener('click', () => {
        this.callbacks.onPermanentDeathTerminate();
      });

    // Cursor magnético de proximidade ativo sobre os slots e botões do inventário!
    this.proximityFX = new CursorProximityFX(
      parentViewport,
      () => this.isOpen || this.isGameOver,
      () => this.collectInteractiveRects()
    );

    // Inicia com a Lanterna Tática já presente no primeiro espaço
    this.addItem('tactical_lantern', 1, true);
    this.renderGrid();
    this.renderInspector();
    this.renderVitals();
  }

  private collectInteractiveRects(): ProximityTargetRect[] {
    const rects: ProximityTargetRect[] = [];
    if (this.isGameOver) {
      const btn = this.gameOverEl.querySelector(
        '[data-terminate-btn]'
      ) as HTMLElement | null;
      if (btn) {
        const r = btn.getBoundingClientRect();
        if (r.width > 2) rects.push({ x: r.left, y: r.top, w: r.width, h: r.height });
      }
      return rects;
    }
    if (!this.isOpen) return rects;

    const nodes = this.overlayEl.querySelectorAll(
      '.amnesia-slot.filled, .amnesia-action-btn:not(:disabled), .amnesia-close-hint'
    );
    nodes.forEach((node) => {
      const el = node as HTMLElement;
      const r = el.getBoundingClientRect();
      if (r.width > 2 && r.height > 2) {
        rects.push({ x: r.left, y: r.top, w: r.width, h: r.height });
      }
    });
    return rects;
  }

  get open(): boolean {
    return this.isOpen;
  }

  get gameOverVisible(): boolean {
    return this.isGameOver;
  }

  toggle(): boolean {
    if (this.isGameOver) return false;
    this.setOpen(!this.isOpen);
    return this.isOpen;
  }

  setOpen(next: boolean): void {
    if (this.isOpen === next) return;
    this.isOpen = next;
    this.feedbackMsgEl.textContent = '';
    if (next) {
      this.overlayEl.classList.add('open');
      this.renderVitals();
      this.renderGrid();
      this.renderInspector();
    } else {
      this.overlayEl.classList.remove('open');
    }
    this.sound.playInventoryToggle(next);
  }

  showGameOver(): void {
    this.setOpen(false);
    this.isGameOver = true;
    this.gameOverEl.classList.add('visible');
  }

  /**
   * Controla os efeitos visuais de ataque, pálpebras de desmaio, escurecimento e fios do ninho de teia.
   */
  setAbductionScreenFX(
    slashOpacity: number,
    eyelidClosed: number,
    blackoutOpacity: number,
    cocoonOpacity: number
  ): void {
    this.attackSlashEl.style.opacity = Math.max(
      0,
      Math.min(1, slashOpacity)
    ).toFixed(3);
    this.cocoonSilkEl.style.opacity = Math.max(
      0,
      Math.min(1, cocoonOpacity)
    ).toFixed(3);

    const lid = Math.max(0, Math.min(1, eyelidClosed));
    const offsetPct = 105 - lid * 105;
    this.eyelidTopEl.style.transform = `translateY(${-offsetPct.toFixed(1)}%)`;
    this.eyelidBottomEl.style.transform = `translateY(${offsetPct.toFixed(1)}%)`;
    this.blackoutVeilEl.style.opacity = Math.max(
      0,
      Math.min(1, blackoutOpacity)
    ).toFixed(3);
  }

  hideGameOver(): void {
    this.isGameOver = false;
    this.gameOverEl.classList.remove('visible');
  }

  hasItem(itemId: string): boolean {
    return this.slots.some((s) => s !== null && s.def.id === itemId && s.quantity > 0);
  }

  /**
   * Adiciona um objeto coletado no labirinto à bolsa do jogador.
   * Retorna `true` se coube na bolsa.
   */
  addItem(itemId: string, amount = 1, silent = false): boolean {
    const def = ITEM_CATALOG[itemId];
    if (!def) return false;

    if (def.stackable) {
      const existingIdx = this.slots.findIndex(
        (s) => s !== null && s.def.id === itemId
      );
      if (existingIdx >= 0) {
        this.slots[existingIdx]!.quantity += amount;
        if (!silent) {
          this.triggerPickupGlint();
          this.sound.playItemPickup();
        }
        if (this.isOpen) {
          this.renderGrid();
          this.renderInspector();
        }
        return true;
      }
    } else if (this.hasItem(itemId)) {
      return false;
    }

    const freeIdx = this.slots.findIndex((s) => s === null);
    if (freeIdx < 0) return false;

    this.slots[freeIdx] = { def, quantity: amount };
    if (this.slots[this.selectedIndex] === null) {
      this.selectedIndex = freeIdx;
    }

    if (!silent) {
      this.triggerPickupGlint();
      this.sound.playItemPickup();
    }
    if (this.isOpen) {
      this.renderGrid();
      this.renderInspector();
    }
    return true;
  }

  private triggerPickupGlint(): void {
    this.pickupGlintEl.style.opacity = '1';
    if (this.pickupFlashTimer) window.clearTimeout(this.pickupFlashTimer);
    this.pickupFlashTimer = window.setTimeout(() => {
      this.pickupGlintEl.style.opacity = '0';
    }, 260);
  }

  updateVitalsAndDiegeticFX(snapshot: PlayerVitalsSnapshot): void {
    this.latestVitals = { ...snapshot };

    // Atualiza vinheta diegética periférica (invisível quando saudável e livre!)
    const injuryRatio = Math.max(0, (78 - snapshot.health) / 78);
    const bloodOpacity = snapshot.bleeding
      ? Math.min(0.92, 0.32 + injuryRatio * 0.62)
      : injuryRatio > 0.12
        ? injuryRatio * 0.72
        : 0;
    this.bloodVignetteEl.style.opacity = bloodOpacity.toFixed(3);

    this.webSnareEl.style.opacity = snapshot.trappedInWeb ? '0.92' : '0';

    if (this.isOpen) {
      this.renderVitals();
      this.renderGrid();
    }
  }

  private renderVitals(): void {
    const v = this.latestVitals;
    const hp = Math.max(0, Math.min(100, Math.round(v.health)));
    const san = Math.max(0, Math.min(100, Math.round(v.sanity)));
    const bat = Math.max(0, Math.min(100, Math.round(v.battery)));

    this.healthPctEl.textContent = `${hp}%`;
    this.healthBarEl.style.width = `${hp}%`;

    let hpTitle = 'Saudável';
    let hpDesc = 'Batimentos firmes. Tudo parece sob controle por enquanto.';
    let pulseDur = '1.25s';
    let heartColor = '#7d2626';
    let pulseGlow = 'rgba(155, 48, 42, 0.35)';

    if (hp < 22) {
      hpTitle = 'À Beira da Morte';
      hpDesc = 'A visão escurece nas bordas. Mais um ataque será o fim.';
      pulseDur = '0.46s';
      heartColor = '#c92828';
      pulseGlow = 'rgba(220, 38, 38, 0.78)';
    } else if (hp < 50) {
      hpTitle = 'Sangrando Gravemente';
      hpDesc = 'Ferimentos fundos ardem a cada passo. Preciso de bandagens.';
      pulseDur = '0.68s';
      heartColor = '#a82929';
      pulseGlow = 'rgba(195, 42, 42, 0.58)';
    } else if (hp < 80) {
      hpTitle = 'Ferido';
      hpDesc = 'Escoriações e hematomas doloridos, mas ainda consigo correr.';
      pulseDur = '0.92s';
      heartColor = '#8f3229';
      pulseGlow = 'rgba(175, 62, 46, 0.45)';
    }

    this.healthTitleEl.textContent = hpTitle;
    this.healthDescEl.textContent = hpDesc;
    this.heartSvgEl.style.setProperty('--pulse-dur', pulseDur);
    this.heartSvgEl.style.setProperty('--pulse-glow', pulseGlow);
    this.heartPathEl.setAttribute('fill', heartColor);

    // Tags de status ativos
    const tags: Array<{ text: string; danger?: boolean }> = [];
    if (v.trappedInWeb) tags.push({ text: 'PRESO NA TEIA', danger: true });
    if (v.bleeding) tags.push({ text: 'SANGRAMENTO', danger: true });
    if (v.beingChased) tags.push({ text: 'CAÇADO', danger: true });
    if (v.crouching) tags.push({ text: 'PASSO FURTIVO [CTRL]' });
    if (this.hasItem('rusty_knife')) tags.push({ text: 'LÂMINA PRONTA' });
    if (tags.length === 0) tags.push({ text: 'PULSO ESTÁVEL' });

    this.vitalTagsEl.innerHTML = tags
      .map(
        (t) =>
          `<span class="vital-tag${t.danger ? ' danger' : ''}">${t.text}</span>`
      )
      .join('');

    // Sanidade / Nervos
    this.sanityBarEl.style.width = `${san}%`;
    let sanTitle = 'Mente Lúcida';
    let sanDesc = 'Os sentidos permanecem atentos ao silêncio das galerias.';
    let tremorDur = '3.4s';
    let irisRadius = '6.8';
    let irisColor = '#6f7f94';

    if (san < 28) {
      sanTitle = 'Terror Absoluto';
      sanDesc = 'O coração martela nos ouvidos. Ela está logo atrás de mim!';
      tremorDur = '0.26s';
      irisRadius = '4.4';
      irisColor = '#b34747';
    } else if (san < 58) {
      sanTitle = 'Perturbado';
      sanDesc = 'Mãos trêmulas. Passos secos ecoam entre paredes e teto.';
      tremorDur = '0.75s';
      irisRadius = '5.3';
      irisColor = '#8f6b64';
    } else if (san < 82) {
      sanTitle = 'Inquieto';
      sanDesc = 'A escuridão pesa. Tenho certeza de que não estou sozinho.';
      tremorDur = '1.6s';
      irisRadius = '6.1';
      irisColor = '#7b808c';
    }

    this.sanityTitleEl.textContent = sanTitle;
    this.sanityDescEl.textContent = sanDesc;
    this.eyeSvgEl.style.setProperty('--tremor-dur', tremorDur);
    this.eyeIrisEl.setAttribute('r', irisRadius);
    this.eyeIrisEl.setAttribute('fill', irisColor);

    // Equipamento / Lanterna
    this.batteryPctEl.textContent = `${bat}%`;
    this.batteryBarEl.style.width = `${bat}%`;
    this.gearStateEl.textContent =
      bat <= 0
        ? 'Bateria esgotada — use uma Bateria 9V no inventário.'
        : v.flashlightEquipped
          ? 'Empunhada e acesa — consumindo carga lentamente.'
          : 'Guardada na cintura — pressione [F] para iluminar.';
  }

  private renderGrid(): void {
    const occupied = this.slots.filter((s) => s !== null).length;
    this.slotCounterEl.textContent = `${occupied} / ${TOTAL_SLOTS} espaços`;

    this.gridEl.innerHTML = '';
    for (let i = 0; i < TOTAL_SLOTS; i++) {
      const entry = this.slots[i];
      const slotEl = document.createElement('div');
      slotEl.className = `amnesia-slot${entry ? ' filled' : ''}${
        i === this.selectedIndex && entry ? ' selected' : ''
      }`;

      if (entry) {
        const iconSrc = this.icons[entry.def.kind];
        const badge =
          entry.def.kind === 'lantern'
            ? this.latestVitals.flashlightEquipped
              ? 'ACESO'
              : '[F]'
            : entry.def.kind === 'knife'
              ? 'CINTO'
              : '';

        slotEl.innerHTML = `
          ${badge ? `<span class="amnesia-slot-badge">${badge}</span>` : ''}
          ${
            entry.quantity > 1
              ? `<span class="amnesia-slot-qty">x${entry.quantity}</span>`
              : ''
          }
          <img class="amnesia-slot-icon" src="${iconSrc}" alt="${entry.def.name}" />
          <div class="amnesia-slot-name">${entry.def.name}</div>
        `;

        slotEl.addEventListener('mouseenter', () => {
          this.sound.playInventorySelect(false);
        });

        slotEl.addEventListener('click', () => {
          this.selectedIndex = i;
          this.feedbackMsgEl.textContent = '';
          this.sound.playInventorySelect(true);
          this.renderGrid();
          this.renderInspector();
        });

        slotEl.addEventListener('dblclick', () => {
          this.selectedIndex = i;
          this.useSelectedItem();
        });
      } else {
        slotEl.innerHTML = `<div class="amnesia-slot-empty-mark"></div>`;
      }

      this.gridEl.appendChild(slotEl);
    }
  }

  private renderInspector(): void {
    const entry = this.slots[this.selectedIndex];
    this.btnRowEl.innerHTML = '';

    if (!entry) {
      this.inspectorPreviewEl.innerHTML = `<div class="amnesia-slot-empty-mark"></div>`;
      this.inspectorCatEl.textContent = 'Espaço Vazio';
      this.inspectorTitleEl.textContent = 'Nenhum Objeto Selecionado';
      this.inspectorDescEl.textContent =
        'Explore os corredores e câmaras do labirinto para recolher bandagens, baterias, sinalizadores, ferramentas e registros.';
      this.inspectorNoteWrapEl.style.display = 'none';
      return;
    }

    const { def } = entry;
    this.inspectorPreviewEl.innerHTML = `<img src="${this.icons[def.kind]}" alt="${def.name}" />`;
    this.inspectorCatEl.textContent = def.category;
    this.inspectorTitleEl.textContent =
      entry.quantity > 1 ? `${def.name} (x${entry.quantity})` : def.name;
    this.inspectorDescEl.textContent = def.description;

    if (def.noteContent) {
      this.inspectorNoteWrapEl.style.display = 'block';
      this.inspectorNoteWrapEl.textContent = def.noteContent;
    } else {
      this.inspectorNoteWrapEl.style.display = 'none';
    }

    if (def.usable) {
      const useBtn = document.createElement('button');
      useBtn.type = 'button';
      useBtn.className = 'amnesia-action-btn';
      useBtn.textContent = `[ ${def.actionLabel ?? 'Usar'} ]`;
      useBtn.addEventListener('click', () => this.useSelectedItem());
      this.btnRowEl.appendChild(useBtn);
    }

    if (def.droppable) {
      const dropBtn = document.createElement('button');
      dropBtn.type = 'button';
      dropBtn.className = 'amnesia-action-btn subtle';
      dropBtn.textContent = 'Descartar';
      dropBtn.addEventListener('click', () => {
        this.consumeAt(this.selectedIndex, 1);
        this.feedbackMsgEl.textContent = `${def.name} descartado.`;
        this.sound.playInventorySelect(true);
      });
      this.btnRowEl.appendChild(dropBtn);
    }
  }

  private useSelectedItem(): void {
    const entry = this.slots[this.selectedIndex];
    if (!entry) return;
    const { def } = entry;

    if (def.kind === 'lantern') {
      this.callbacks.onToggleFlashlightFromUI();
      this.feedbackMsgEl.textContent = 'Estado da lanterna alternado.';
      this.renderVitals();
      this.renderGrid();
      return;
    }

    if (def.id === 'sterile_bandage') {
      const used = this.callbacks.onUseHeal(38, 12);
      if (!used) {
        this.feedbackMsgEl.textContent = 'Você já está sem ferimentos.';
        this.sound.invalidInput();
        return;
      }
      this.sound.playItemUse('heal');
      this.consumeAt(this.selectedIndex, 1);
      this.feedbackMsgEl.textContent = 'Ferimentos enfaixados (+Vitalidade).';
      return;
    }

    if (def.id === 'old_morphine') {
      const used = this.callbacks.onUseHeal(62, 42);
      if (!used) {
        this.feedbackMsgEl.textContent = 'Vitalidade e nervos já estão estáveis.';
        this.sound.invalidInput();
        return;
      }
      this.sound.playItemUse('heal');
      this.consumeAt(this.selectedIndex, 1);
      this.feedbackMsgEl.textContent = 'Tônico ingerido (+Vitalidade e Calma).';
      return;
    }

    if (def.id === 'industrial_battery') {
      const used = this.callbacks.onUseBattery(55);
      if (!used) {
        this.feedbackMsgEl.textContent = 'A bateria da lanterna já está cheia.';
        this.sound.invalidInput();
        return;
      }
      this.sound.playItemUse('battery');
      this.consumeAt(this.selectedIndex, 1);
      this.feedbackMsgEl.textContent = 'Carga da lanterna restaurada.';
      return;
    }

    if (def.id === 'magnesium_flare') {
      const used = this.callbacks.onUseFlare();
      if (used) {
        this.sound.playItemUse('flare');
        this.consumeAt(this.selectedIndex, 1);
        this.feedbackMsgEl.textContent =
          'Sinalizador aceso no chão! O calor afasta a criatura.';
      }
    }
  }

  private consumeAt(slotIndex: number, count: number): void {
    const entry = this.slots[slotIndex];
    if (!entry) return;
    entry.quantity -= count;
    if (entry.quantity <= 0) {
      this.slots[slotIndex] = null;
      const nextFilled = this.slots.findIndex((s) => s !== null);
      if (nextFilled >= 0) this.selectedIndex = nextFilled;
    }
    this.renderGrid();
    this.renderInspector();
    this.renderVitals();
  }

  destroy(): void {
    this.proximityFX.destroy();
    this.overlayEl.remove();
    this.diegeticEl.remove();
    this.gameOverEl.remove();
  }
}
