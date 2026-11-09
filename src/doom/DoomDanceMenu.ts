import './dance.css';
import {
  DOOM_DANCES,
  DoomDanceId,
  getDoomDanceDefinition,
  getDoomDanceIndex,
} from './DoomDance';

/**
 * ============================================================================
 * MENU DE DANÇAS DO ASTRONAUTA
 * ============================================================================
 * Painel em DOM com a grade completa de coreografias disponíveis.
 * - Desktop: clique no cartão (ou teclas [1]..[6]) para começar a dança;
 * - Mobile: toque no cartão;
 * - [G] / [Esc] fecham o painel sem começar nenhuma dança.
 */
export class DoomDanceMenu {
  private readonly rootEl: HTMLDivElement;
  private readonly gridEl: HTMLDivElement;
  private readonly statusEl: HTMLDivElement;
  private readonly cards = new Map<DoomDanceId, HTMLButtonElement>();
  private open = false;
  private activeId: DoomDanceId | null = null;

  constructor(
    parentEl: HTMLElement,
    private readonly onSelect: (id: DoomDanceId) => void,
    private readonly onClose: () => void
  ) {
    this.rootEl = document.createElement('div');
    this.rootEl.id = 'doom-dance-menu';
    this.rootEl.className = 'doom-dance-menu';
    this.rootEl.setAttribute('role', 'dialog');
    this.rootEl.setAttribute('aria-label', 'Menu de Danças');

    const head = document.createElement('div');
    head.className = 'doom-dance-head';
    const kicker = document.createElement('div');
    kicker.className = 'doom-dance-kicker';
    kicker.textContent = 'PROTOCOLO DE ENTRETENIMENTO';
    const title = document.createElement('div');
    title.className = 'doom-dance-title';
    title.textContent = 'DANÇAS DO TRAJE NÍVEL-A';
    const hint = document.createElement('div');
    hint.className = 'doom-dance-hint';
    hint.textContent =
      'Escolha uma coreografia • a câmera vai para 3ª pessoa • [G] fecha • mover o personagem cancela';
    head.append(kicker, title, hint);

    this.statusEl = document.createElement('div');
    this.statusEl.className = 'doom-dance-status';

    this.gridEl = document.createElement('div');
    this.gridEl.className = 'doom-dance-grid';

    for (const dance of DOOM_DANCES) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'doom-dance-card';
      card.dataset.danceId = dance.id;
      card.setAttribute('aria-label', `Dançar ${dance.label}`);

      const icon = document.createElement('span');
      icon.className = 'doom-dance-card-icon';
      icon.textContent = dance.icon;

      const name = document.createElement('span');
      name.className = 'doom-dance-card-name';
      name.textContent = dance.label;

      const desc = document.createElement('span');
      desc.className = 'doom-dance-card-desc';
      desc.textContent = dance.subtitle;

      const meta = document.createElement('span');
      meta.className = 'doom-dance-card-meta';
      meta.textContent = `${dance.bpm} BPM • [${getDoomDanceIndex(dance.id)}]`;

      card.append(icon, name, desc, meta);
      card.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        this.onSelect(dance.id);
      });
      this.cards.set(dance.id, card);
      this.gridEl.appendChild(card);
    }

    this.rootEl.append(head, this.statusEl, this.gridEl);
    parentEl.appendChild(this.rootEl);
  }

  get isOpen(): boolean {
    return this.open;
  }

  setActiveDance(id: DoomDanceId | null): void {
    this.activeId = id;
    for (const [danceId, card] of this.cards) {
      card.classList.toggle('is-active', danceId === id);
    }
    this.statusEl.textContent = id
      ? `EM CENA: ${getDoomDanceDefinition(id).label}`
      : 'Nenhuma coreografia em cena — escolha uma para começar.';
    this.statusEl.classList.toggle('is-active', Boolean(id));
  }

  setOpen(open: boolean): void {
    this.open = open;
    this.rootEl.classList.toggle('is-open', open);
    if (open) {
      this.setActiveDance(this.activeId);
    }
  }

  /**
   * Trata teclas do menu. Devolve `true` quando a tecla foi consumida.
   */
  handleKey(code: string): boolean {
    if (!this.open) return false;
    if (code === 'Digit1' || code === 'Numpad1') return this.selectByIndex(0);
    if (code === 'Digit2' || code === 'Numpad2') return this.selectByIndex(1);
    if (code === 'Digit3' || code === 'Numpad3') return this.selectByIndex(2);
    if (code === 'Digit4' || code === 'Numpad4') return this.selectByIndex(3);
    if (code === 'Digit5' || code === 'Numpad5') return this.selectByIndex(4);
    if (code === 'Digit6' || code === 'Numpad6') return this.selectByIndex(5);
    return false;
  }

  private selectByIndex(index: number): boolean {
    const dance = DOOM_DANCES[index];
    if (!dance) return false;
    this.onSelect(dance.id);
    return true;
  }

  close(): void {
    if (!this.open) return;
    this.onClose();
  }

  destroy(): void {
    this.cards.clear();
    this.rootEl.remove();
  }
}
