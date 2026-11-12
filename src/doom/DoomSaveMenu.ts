/**
 * Menu de Seleção de Saves — a tela que aparece ao apertar INICIAR.
 *
 * Cinco slots, cada um capaz de guardar uma incursão inteira. O slot vazio
 * oferece uma incursão nova; o slot ocupado oferece continuar de onde parou,
 * recomeçar do zero (apagando o que havia) ou apagar de vez.
 *
 * Duas decisões de desenho que valem ser registradas:
 *
 * 1. Nada aqui apaga progresso com um clique só. Recomeçar por cima de um save
 *    existente pede CONFIRMAÇÃO — o botão muda de texto e espera um segundo
 *    clique. Perder vinte minutos de fuga por um clique errado é o tipo de
 *    erro que o jogador não perdoa.
 *
 * 2. O menu também é onde se decide refazer o tutorial. A regra é "quem nunca
 *    salvou é novato", mas às vezes o jogador quer rever as instruções — e uma
 *    caixa de seleção aqui é mais honesta do que esconder isso nas
 *    configurações.
 */

import { SoundEngine } from '../engine/audio/SoundEngine';
import {
  clearSaveSlot,
  formatHealthLabel,
  formatSaveDuration,
  formatSaveTimestamp,
  formatSlotLabel,
  listSaveSlots,
  readSaveSlot,
  SAVE_SLOT_COUNT,
  SaveSlotSummary,
  type SaveStorageLike,
} from './DoomSaveSlots';

export interface SaveMenuSelection {
  /** 0..4 — em qual slot a incursão acontece. */
  readonly slot: number;
  /** `continue` retoma o save; `new` começa uma incursão do zero. */
  readonly mode: 'continue' | 'new';
  /** Pedido explícito de passar pela sala de tutorial. */
  readonly forceTutorial: boolean;
}

export interface DoomSaveMenuOptions {
  sound: SoundEngine;
  /** Chamado quando o jogador escolhe um slot. */
  onStart: (selection: SaveMenuSelection) => void;
  /** Chamado quando o jogador desiste e volta ao menu principal. */
  onClose: () => void;
  storage: SaveStorageLike;
}

/** Modo de confirmação por slot: nenhum, recomeçar ou apagar. */
type PendingConfirm = 'new' | 'delete' | null;

/**
 * Texto do botão quando ele está esperando a confirmação.
 *
 * Some sozinho depois de alguns segundos para o jogador não ficar com um
 * botão armado sem saber.
 */
const CONFIRM_WINDOW_MS = 4000;

export class DoomSaveMenu {
  private readonly backdropEl: HTMLElement;
  private readonly listEl: HTMLElement;
  private readonly hintEl: HTMLElement;
  private readonly tutorialToggleEl: HTMLInputElement;
  private readonly errorEl: HTMLElement;

  private isOpen = false;
  private cursor = 0;
  private summaries: SaveSlotSummary[] = [];
  private pending: PendingConfirm = null;
  private pendingSlot = -1;
  private confirmTimerId = 0;

  private readonly boundKeyDown: (e: KeyboardEvent) => void;

  constructor(
    parent: HTMLElement,
    private readonly options: DoomSaveMenuOptions
  ) {
    this.backdropEl = document.createElement('div');
    this.backdropEl.className = 'oof-save-backdrop hidden';
    this.backdropEl.setAttribute('role', 'dialog');
    this.backdropEl.setAttribute('aria-label', 'Seleção de save');
    this.backdropEl.innerHTML = `
      <div class="oof-save-window">
        <div class="oof-save-header">
          <div class="oof-save-title-group">
            <span class="oof-save-dot"></span>
            <span>[ OUT-OF-FRAME // SELECIONE O SAVE ]</span>
          </div>
          <button type="button" class="oof-save-close" id="oof-save-close" aria-label="Voltar">[ ESC ] VOLTAR</button>
        </div>

        <div class="oof-save-subhead">
          <span>REGISTRO DE INCURSÕES — SETOR DE CONTENÇÃO</span>
          <span class="oof-save-subhead-hint">↑ ↓ navegar • ENTER entrar • DEL apagar</span>
        </div>

        <div class="oof-save-list" id="oof-save-list"></div>

        <div class="oof-save-error hidden" id="oof-save-error"></div>

        <div class="oof-save-footer">
          <label class="oof-save-check">
            <input type="checkbox" id="oof-save-tutorial" />
            <span>Refazer a sala de orientação (vale para incursão nova)</span>
          </label>
          <div class="oof-save-hint" id="oof-save-hint"></div>
        </div>
      </div>
    `;

    parent.appendChild(this.backdropEl);

    this.listEl = this.backdropEl.querySelector('#oof-save-list') as HTMLElement;
    this.hintEl = this.backdropEl.querySelector('#oof-save-hint') as HTMLElement;
    this.errorEl = this.backdropEl.querySelector('#oof-save-error') as HTMLElement;
    this.tutorialToggleEl = this.backdropEl.querySelector(
      '#oof-save-tutorial'
    ) as HTMLInputElement;

    (this.backdropEl.querySelector('#oof-save-close') as HTMLButtonElement).addEventListener(
      'click',
      () => {
        this.options.sound.keyBackspace();
        this.close();
      }
    );

    // Clicar no fundo (fora da janela) também volta, igual a apertar ESC.
    this.backdropEl.addEventListener('pointerdown', (e) => {
      if (e.target === this.backdropEl) this.close();
    });

    this.boundKeyDown = (e: KeyboardEvent) => this.handleKeyDown(e);
  }

  /** Abre o menu, relendo os slots do armazenamento. */
  open(): void {
    if (this.isOpen) return;
    this.isOpen = true;
    this.pending = null;
    this.pendingSlot = -1;
    this.backdropEl.classList.remove('hidden');
    this.errorEl.classList.add('hidden');
    this.refresh();
    window.addEventListener('keydown', this.boundKeyDown, true);
    this.options.sound.windowOpen();
  }

  /** Fecha o menu e devolve o foco ao menu principal do terminal. */
  close(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    window.removeEventListener('keydown', this.boundKeyDown, true);
    this.clearConfirmTimer();
    this.backdropEl.classList.add('hidden');
    this.options.onClose();
  }

  /** Tira o elemento da página. */
  destroy(): void {
    window.removeEventListener('keydown', this.boundKeyDown, true);
    this.clearConfirmTimer();
    this.backdropEl.remove();
  }

  /** Relê os slots e redesenha a lista. */
  refresh(): void {
    this.summaries = Array.from(listSaveSlots(this.options.storage));
    if (this.cursor >= this.summaries.length) this.cursor = 0;
    this.render();
  }

  private clearConfirmTimer(): void {
    if (this.confirmTimerId) {
      window.clearTimeout(this.confirmTimerId);
      this.confirmTimerId = 0;
    }
  }

  private showError(message: string): void {
    this.errorEl.textContent = message;
    this.errorEl.classList.remove('hidden');
  }

  private render(): void {
    this.listEl.innerHTML = '';
    this.summaries.forEach((summary, index) => {
      this.listEl.appendChild(this.buildRow(summary, index));
    });
    this.renderHint();
  }

  private renderHint(): void {
    const summary = this.summaries[this.cursor];
    if (!summary) {
      this.hintEl.textContent = '';
      return;
    }
    if (summary.empty) {
      this.hintEl.textContent =
        'Slot livre — começa uma incursão nova do zero e passa pela sala de tutorial.';
      return;
    }
    this.hintEl.textContent =
      `Gravado em ${formatSaveTimestamp(summary.updatedAt)}` +
      ` • ${summary.deaths === 1 ? '1 morte' : `${summary.deaths} mortes`}`;
  }

  private buildRow(summary: SaveSlotSummary, index: number): HTMLElement {
    const row = document.createElement('div');
    row.className = 'oof-save-row';
    if (index === this.cursor) row.classList.add('is-cursor');
    if (!summary.empty) row.classList.add('is-filled');
    row.dataset.slot = String(index);

    const label = document.createElement('div');
    label.className = 'oof-save-row-label';
    label.textContent = formatSlotLabel(index);

    const body = document.createElement('div');
    body.className = 'oof-save-row-body';

    const actions = document.createElement('div');
    actions.className = 'oof-save-row-actions';

    if (summary.empty) {
      body.classList.add('is-empty');
      body.textContent = '— slot vazio —';
      actions.appendChild(
        this.buildButton('COMEÇAR', 'primary', () => this.startNew(index))
      );
    } else {
      body.appendChild(this.buildStatLine(summary));
      actions.appendChild(
        this.buildButton('CONTINUAR', 'primary', () => this.startContinue(index))
      );

      // Recomeçar e apagar são destrutivos: o primeiro clique apenas ARMA o
      // botão, o segundo confirma.
      const armed = this.pending !== null && this.pendingSlot === index;
      if (this.pending === 'new' && armed) {
        actions.appendChild(
          this.buildButton('CONFIRMAR?', 'danger', () => this.startNew(index))
        );
      } else {
        actions.appendChild(
          this.buildButton('RECOMEÇAR', 'ghost', () => this.armConfirm('new', index))
        );
      }

      if (this.pending === 'delete' && armed) {
        actions.appendChild(
          this.buildButton('APAGAR MESMO?', 'danger', () => this.deleteSlot(index))
        );
      } else {
        actions.appendChild(
          this.buildButton('APAGAR', 'ghost', () => this.armConfirm('delete', index))
        );
      }
    }

    row.append(label, body, actions);

    // Clique na linha (fora dos botões) move o cursor para ela.
    row.addEventListener('pointerdown', (e) => {
      if ((e.target as HTMLElement).closest('button')) return;
      if (this.cursor === index) return;
      this.cursor = index;
      this.pending = null;
      this.clearConfirmTimer();
      this.options.sound.menuMove();
      this.render();
    });

    return row;
  }

  private buildStatLine(summary: SaveSlotSummary): HTMLElement {
    const line = document.createElement('div');
    line.className = 'oof-save-stats';

    const sector = document.createElement('span');
    sector.className = 'oof-save-sector';
    sector.textContent = summary.sector || 'SETOR DESCONHECIDO';

    const meters = document.createElement('span');
    meters.className = 'oof-save-meters';
    meters.innerHTML =
      `<span class="oof-save-meter"><i>vida</i>${formatHealthLabel(summary)}</span>` +
      `<span class="oof-save-meter"><i>mente</i>${Math.round(summary.sanity)}%</span>` +
      `<span class="oof-save-meter"><i>tempo</i>${formatSaveDuration(summary.elapsedSec)}</span>` +
      `<span class="oof-save-meter"><i>itens</i>${summary.itemCount}</span>` +
      (summary.shotgunReady
        ? '<span class="oof-save-meter is-ready"><i>escopeta</i>MONTADA</span>'
        : '');

    line.append(sector, meters);
    return line;
  }

  private buildButton(
    text: string,
    variant: 'primary' | 'ghost' | 'danger',
    onClick: () => void
  ): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `oof-save-btn ${variant}`;
    button.textContent = text;
    button.addEventListener('click', (e) => {
      e.stopPropagation();
      onClick();
    });
    return button;
  }

  /** Continuar exige que o save exista de verdade — nunca confiamos no resumo. */
  private startContinue(slot: number): void {
    const payload = readSaveSlot(this.options.storage, slot);
    if (!payload) {
      this.options.sound.invalidInput();
      this.showError('Este save não pôde ser lido. Comece uma incursão nova.');
      this.refresh();
      return;
    }
    this.options.sound.keyEnter();
    this.finish({
      slot,
      mode: 'continue',
      forceTutorial: this.tutorialToggleEl.checked,
    });
  }

  private startNew(slot: number): void {
    this.options.sound.keyEnter();
    this.finish({
      slot,
      mode: 'new',
      // Começar do zero é o único caminho em que o tutorial faz sentido; a
      // caixa de seleção força o tutorial mesmo para quem já tem saves.
      forceTutorial: this.tutorialToggleEl.checked,
    });
  }

  private deleteSlot(slot: number): void {
    clearSaveSlot(this.options.storage, slot);
    this.options.sound.keyBackspace();
    this.pending = null;
    this.pendingSlot = -1;
    this.clearConfirmTimer();
    this.refresh();
  }

  /** Arma o próximo clique do botão destrutivo. */
  private armConfirm(kind: Exclude<PendingConfirm, null>, slot: number): void {
    this.pending = kind;
    this.pendingSlot = slot;
    this.cursor = slot;
    this.options.sound.menuMove();
    this.clearConfirmTimer();
    this.confirmTimerId = window.setTimeout(() => {
      if (!this.isOpen) return;
      this.pending = null;
      this.pendingSlot = -1;
      this.render();
    }, CONFIRM_WINDOW_MS);
    this.render();
  }

  private finish(selection: SaveMenuSelection): void {
    this.isOpen = false;
    window.removeEventListener('keydown', this.boundKeyDown, true);
    this.clearConfirmTimer();
    this.backdropEl.classList.add('hidden');
    this.options.onStart(selection);
  }

  private handleKeyDown(e: KeyboardEvent): void {
    if (!this.isOpen) return;

    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      this.options.sound.keyBackspace();
      this.close();
      return;
    }

    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      const dir = e.key === 'ArrowDown' ? 1 : -1;
      this.cursor =
        (this.cursor + dir + SAVE_SLOT_COUNT * 2) % SAVE_SLOT_COUNT;
      this.pending = null;
      this.clearConfirmTimer();
      this.options.sound.menuMove();
      this.render();
      return;
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      const summary = this.summaries[this.cursor];
      if (!summary) return;
      if (summary.empty) {
        this.startNew(this.cursor);
        return;
      }
      // Se o jogador já armou uma confirmação, o ENTER confirma aquilo.
      if (this.pending === 'delete' && this.pendingSlot === this.cursor) {
        this.deleteSlot(this.cursor);
        return;
      }
      if (this.pending === 'new' && this.pendingSlot === this.cursor) {
        this.startNew(this.cursor);
        return;
      }
      this.startContinue(this.cursor);
      return;
    }

    if (e.key === 'Delete' || e.key === 'Backspace') {
      const summary = this.summaries[this.cursor];
      if (!summary || summary.empty) {
        this.options.sound.invalidInput();
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      if (this.pending === 'delete' && this.pendingSlot === this.cursor) {
        this.deleteSlot(this.cursor);
      } else {
        this.armConfirm('delete', this.cursor);
      }
    }
  }
}
