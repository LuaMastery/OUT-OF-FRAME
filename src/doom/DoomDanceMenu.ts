import './dance.css';
import { DOOM_DANCES, DoomDanceId, getDoomDanceDefinition, getDoomDanceIndex } from './DoomDance';
import { DoomDancePreview } from './DoomDancePreview';

/** Seleção e prévia são locais: só o botão Dançar inicia a coreografia. */
export class DoomDanceMenu {
  private readonly rootEl: HTMLDivElement;
  private readonly previewStage: HTMLDivElement;
  private readonly previewName: HTMLDivElement;
  private readonly playButton: HTMLButtonElement;
  private readonly cards = new Map<DoomDanceId, HTMLButtonElement>();
  private preview: DoomDancePreview | null = null;
  private previewFailed = false;
  private selectedId: DoomDanceId = DOOM_DANCES[0].id;
  private activeId: DoomDanceId | null = null;
  private open = false;

  constructor(
    parentEl: HTMLElement,
    private readonly onSelect: (id: DoomDanceId) => void,
    private readonly onClose: () => void
  ) {
    this.rootEl = document.createElement('div');
    this.rootEl.id = 'doom-dance-menu';
    this.rootEl.className = 'doom-dance-menu';
    this.rootEl.setAttribute('role', 'dialog');
    this.rootEl.setAttribute('aria-modal', 'true');
    this.rootEl.setAttribute('aria-labelledby', 'doom-dance-title');

    const panel = document.createElement('div');
    panel.className = 'doom-dance-panel';
    const head = document.createElement('header');
    head.className = 'doom-dance-head';
    const title = document.createElement('h2');
    title.id = 'doom-dance-title';
    title.className = 'doom-dance-title';
    title.textContent = 'DANÇAS';
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'doom-dance-close';
    close.setAttribute('aria-label', 'Fechar menu de danças');
    close.textContent = '×';
    close.addEventListener('click', () => this.close());
    head.append(title, close);

    const content = document.createElement('div');
    content.className = 'doom-dance-content';
    const previewPane = document.createElement('section');
    previewPane.className = 'doom-dance-preview';
    previewPane.setAttribute('aria-label', 'Prévia da dança selecionada');
    this.previewStage = document.createElement('div');
    this.previewStage.className = 'doom-dance-preview-stage';
    const label = document.createElement('span');
    label.className = 'doom-dance-preview-label';
    label.textContent = 'PRÉVIA';
    this.previewName = document.createElement('div');
    this.previewName.className = 'doom-dance-preview-name';
    this.previewStage.append(label, this.previewName);
    previewPane.appendChild(this.previewStage);

    const choices = document.createElement('section');
    choices.className = 'doom-dance-choices';
    const grid = document.createElement('div');
    grid.className = 'doom-dance-grid';
    for (const dance of DOOM_DANCES) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'doom-dance-card';
      card.dataset.danceId = dance.id;
      card.setAttribute('aria-label', `${dance.label}, prévia`);
      const index = document.createElement('span');
      index.className = 'doom-dance-card-index';
      index.textContent = String(getDoomDanceIndex(dance.id)).padStart(2, '0');
      const name = document.createElement('span');
      name.className = 'doom-dance-card-name';
      name.textContent = dance.label;
      card.append(index, name);
      card.addEventListener('pointerenter', (event) => {
        if (event.pointerType !== 'touch') this.selectPreview(dance.id);
      });
      card.addEventListener('focus', () => this.selectPreview(dance.id));
      card.addEventListener('click', () => this.selectPreview(dance.id));
      this.cards.set(dance.id, card);
      grid.appendChild(card);
    }
    this.playButton = document.createElement('button');
    this.playButton.type = 'button';
    this.playButton.className = 'doom-dance-play';
    this.playButton.textContent = 'DANÇAR';
    this.playButton.addEventListener('click', () => this.onSelect(this.selectedId));
    const hint = document.createElement('div');
    hint.className = 'doom-dance-hint';
    hint.textContent = '1–6 dança direto  ·  G / Esc fecha';
    choices.append(grid, this.playButton, hint);
    content.append(previewPane, choices);
    panel.append(head, content);
    this.rootEl.appendChild(panel);
    parentEl.appendChild(this.rootEl);
    this.selectPreview(this.selectedId);
  }

  get isOpen(): boolean { return this.open; }

  private selectPreview(id: DoomDanceId): void {
    this.selectedId = id;
    this.previewName.textContent = getDoomDanceDefinition(id).label;
    this.playButton.setAttribute('aria-label', `Dançar ${getDoomDanceDefinition(id).label}`);
    for (const [danceId, card] of this.cards) {
      card.classList.toggle('is-selected', danceId === id);
      card.setAttribute('aria-pressed', String(danceId === id));
    }
    this.preview?.setDance(id);
  }

  setActiveDance(id: DoomDanceId | null): void {
    this.activeId = id;
    for (const [danceId, card] of this.cards) card.classList.toggle('is-active', danceId === id);
  }

  setOpen(open: boolean): void {
    if (this.open === open) return;
    this.open = open;
    this.rootEl.classList.toggle('is-open', open);
    if (open) {
      this.selectPreview(this.activeId ?? this.selectedId);
      if (!this.preview && !this.previewFailed) {
        try {
          this.preview = new DoomDancePreview(this.previewStage, this.selectedId);
        } catch {
          this.previewFailed = true;
          this.previewStage.classList.add('is-unavailable');
          const fallback = document.createElement('span');
          fallback.className = 'doom-dance-preview-fallback';
          fallback.textContent = 'Prévia indisponível';
          this.previewStage.appendChild(fallback);
        }
      }
      this.preview?.start();
    } else {
      this.preview?.stop();
    }
  }

  /** Os atalhos numéricos continuam iniciando a dança diretamente. */
  handleKey(code: string): boolean {
    if (!this.open) return false;
    const match = /^(?:Digit|Numpad)([1-6])$/.exec(code);
    if (!match) return false;
    const dance = DOOM_DANCES[Number(match[1]) - 1];
    if (!dance) return false;
    this.onSelect(dance.id);
    return true;
  }

  close(): void { if (this.open) this.onClose(); }

  destroy(): void {
    this.preview?.destroy();
    this.preview = null;
    this.cards.clear();
    this.rootEl.remove();
  }
}
