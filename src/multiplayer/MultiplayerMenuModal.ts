import { SoundEngine } from '../engine/audio/SoundEngine';
import {
  ActiveRoomSession,
  formatRoomCodeDisplay,
  getOrCreateLocalPlayerProfile,
  MultiplayerLobbyService,
  normalizeRoomCode,
  PublicRoomEntry,
  RoomPlayerSummary,
  setLocalPlayerName,
} from './MultiplayerService';

export interface MultiplayerMenuModalOptions {
  sound: SoundEngine;
  onJoinSuccess: (session: ActiveRoomSession) => void;
  onClose: () => void;
}

type ModalTab = 'BROWSER' | 'CREATE';
type BrowserFilter = 'ALL' | 'OPEN' | 'PASSWORD';

interface PendingPasswordTarget {
  roomCode: string;
  roomName: string;
  hostName: string;
  playerCount: number;
  maxPlayers: number;
  isListed: boolean;
}

/**
 * Central Multiplayer completa de OUT-OF-FRAME:
 * 1. Lista ao vivo de Salas / Servidores Públicos (mostrando jogadores conectados, vagas e status de senha).
 * 2. Entrada direta pelo Número da Sala (suporta salas abertas, salas com senha e salas ocultas da lista).
 * 3. Confirmação dedicada de Senha ao entrar em salas privadas — valida a senha e entra direto na partida!
 * 4. Criação de Sala Pública Aberta, Sala Pública com Senha ou Sala Oculta (Não-Listada) com/sem Senha.
 */
export class MultiplayerMenuModal {
  private readonly lobby = new MultiplayerLobbyService();
  private readonly backdropEl: HTMLElement;
  private readonly bannerEl: HTMLElement;
  private readonly bodyEl: HTMLElement;
  private readonly callsignInput: HTMLInputElement;
  private readonly codeInput: HTMLInputElement;
  private readonly codeJoinBtn: HTMLButtonElement;
  private readonly tabBrowserBtn: HTMLButtonElement;
  private readonly tabCreateBtn: HTMLButtonElement;

  // Overlay de senha para salas privadas
  private readonly pwOverlayEl: HTMLElement;
  private readonly pwRoomInfoEl: HTMLElement;
  private readonly pwInputEl: HTMLInputElement;
  private readonly pwErrorEl: HTMLElement;
  private readonly pwConfirmBtn: HTMLButtonElement;

  private isOpen = false;
  private busy = false;
  private activeTab: ModalTab = 'BROWSER';
  private filter: BrowserFilter = 'ALL';
  private searchQuery = '';
  private rooms: PublicRoomEntry[] = [];
  private unsubscribeDir: (() => void) | null = null;
  private pollTimerId = 0;

  // Estado do formulário Criar Sala
  private draftRoomName = '';
  private draftMaxPlayers = 4;
  private draftRequirePassword = false;
  private draftPassword = '';
  private draftShowPassword = false;
  private draftIsListed = true;

  private pendingPasswordTarget: PendingPasswordTarget | null = null;
  private readonly boundKeyDown: (e: KeyboardEvent) => void;

  constructor(
    parent: HTMLElement,
    private readonly options: MultiplayerMenuModalOptions
  ) {
    const profile = getOrCreateLocalPlayerProfile();
    this.draftRoomName = `Setor de ${profile.name}`;

    this.backdropEl = document.createElement('div');
    this.backdropEl.className = 'oof-mp-backdrop hidden';
    this.backdropEl.innerHTML = `
      <div class="oof-mp-window" role="dialog" aria-label="Central Multiplayer">
        <div class="oof-mp-header">
          <div class="oof-mp-title-group">
            <span class="oof-mp-net-dot"></span>
            <span>[ OUT-OF-FRAME // MULTIPLAYER — SALAS &amp; SERVIDORES ]</span>
          </div>
          <div class="oof-mp-header-right">
            <div class="oof-mp-callsign-box">
              <label for="oof-mp-callsign">SEU NOME:</label>
              <input id="oof-mp-callsign" class="oof-mp-callsign-input" type="text" maxlength="20" autocomplete="off" spellcheck="false" />
            </div>
            <button type="button" class="oof-mp-close-btn" data-mp-close>[ ESC / VOLTAR ]</button>
          </div>
        </div>

        <div class="oof-mp-code-bar">
          <div class="oof-mp-code-bar-left">
            <span class="oof-mp-code-label">ENTRAR POR Nº DA SALA:</span>
            <input type="text" class="oof-mp-code-input" data-mp-code-input placeholder="000-000" maxlength="16" autocomplete="off" spellcheck="false" />
            <button type="button" class="oof-mp-btn primary" data-mp-code-join>[ CONECTAR PELO Nº ]</button>
          </div>
          <div class="oof-mp-code-hint">Aceita salas públicas, privadas com senha ou ocultas da lista.</div>
        </div>

        <div class="oof-mp-tabs">
          <div class="oof-mp-tab-list">
            <button type="button" class="oof-mp-tab-btn active" data-mp-tab="BROWSER">[ SERVIDORES DISPONÍVEIS ]</button>
            <button type="button" class="oof-mp-tab-btn" data-mp-tab="CREATE">[ + CRIAR SALA / PRIVADA ]</button>
          </div>
          <button type="button" class="oof-mp-btn" data-mp-refresh>[ ↻ ATUALIZAR LISTA ]</button>
        </div>

        <div class="oof-mp-status-banner hidden" data-mp-banner></div>

        <div class="oof-mp-body" data-mp-body></div>

        <div class="oof-mp-pw-overlay hidden" data-mp-pw-overlay>
          <div class="oof-mp-pw-dialog">
            <div class="oof-mp-pw-title">🔒 SALA PRIVADA — SENHA NECESSÁRIA</div>
            <div class="oof-mp-pw-room-info" data-mp-pw-info></div>
            <div class="oof-mp-field">
              <label class="oof-mp-field-label">DIGITE A SENHA DA SALA PARA ENTRAR:</label>
              <input type="password" class="oof-mp-text-input" data-mp-pw-input placeholder="Senha da sala..." maxlength="32" autocomplete="off" />
            </div>
            <div class="oof-mp-pw-error" data-mp-pw-error></div>
            <div class="oof-mp-pw-actions">
              <button type="button" class="oof-mp-btn" data-mp-pw-cancel>[ CANCELAR ]</button>
              <button type="button" class="oof-mp-btn primary" data-mp-pw-confirm>[ CONFIRMAR E ENTRAR ]</button>
            </div>
          </div>
        </div>
      </div>
    `;

    parent.appendChild(this.backdropEl);

    this.bannerEl = this.backdropEl.querySelector(
      '[data-mp-banner]'
    ) as HTMLElement;
    this.bodyEl = this.backdropEl.querySelector(
      '[data-mp-body]'
    ) as HTMLElement;
    this.callsignInput = this.backdropEl.querySelector(
      '#oof-mp-callsign'
    ) as HTMLInputElement;
    this.codeInput = this.backdropEl.querySelector(
      '[data-mp-code-input]'
    ) as HTMLInputElement;
    this.codeJoinBtn = this.backdropEl.querySelector(
      '[data-mp-code-join]'
    ) as HTMLButtonElement;
    this.tabBrowserBtn = this.backdropEl.querySelector(
      '[data-mp-tab="BROWSER"]'
    ) as HTMLButtonElement;
    this.tabCreateBtn = this.backdropEl.querySelector(
      '[data-mp-tab="CREATE"]'
    ) as HTMLButtonElement;

    this.pwOverlayEl = this.backdropEl.querySelector(
      '[data-mp-pw-overlay]'
    ) as HTMLElement;
    this.pwRoomInfoEl = this.backdropEl.querySelector(
      '[data-mp-pw-info]'
    ) as HTMLElement;
    this.pwInputEl = this.backdropEl.querySelector(
      '[data-mp-pw-input]'
    ) as HTMLInputElement;
    this.pwErrorEl = this.backdropEl.querySelector(
      '[data-mp-pw-error]'
    ) as HTMLElement;
    this.pwConfirmBtn = this.backdropEl.querySelector(
      '[data-mp-pw-confirm]'
    ) as HTMLButtonElement;

    this.callsignInput.value = profile.name;

    this.bindUiEvents();

    this.boundKeyDown = (e: KeyboardEvent) => {
      if (!this.isOpen) return;
      // Impede que o menu binário ao fundo intercepte teclas de digitação nos campos!
      e.stopPropagation();

      if (e.key === 'Escape') {
        e.preventDefault();
        if (this.pendingPasswordTarget) {
          this.closePasswordPrompt();
        } else {
          this.close();
        }
      }
    };
    window.addEventListener('keydown', this.boundKeyDown, true);
  }

  get visible(): boolean {
    return this.isOpen;
  }

  open(prefillRoomCode?: string): void {
    this.isOpen = true;
    this.backdropEl.classList.remove('hidden');
    this.hideBanner();
    this.closePasswordPrompt();

    const profile = getOrCreateLocalPlayerProfile();
    this.callsignInput.value = profile.name;

    if (prefillRoomCode) {
      this.codeInput.value = formatRoomCodeDisplay(prefillRoomCode);
    }

    this.renderBody();
    void this.refreshRooms();

    this.unsubscribeDir?.();
    this.unsubscribeDir = this.lobby.subscribeToDirectoryUpdates(() => {
      void this.refreshRooms();
    });

    if (this.pollTimerId) window.clearInterval(this.pollTimerId);
    this.pollTimerId = window.setInterval(() => {
      if (this.isOpen && this.activeTab === 'BROWSER' && !this.busy) {
        void this.refreshRooms();
      }
    }, 6000);

    if (prefillRoomCode && normalizeRoomCode(prefillRoomCode).length >= 6) {
      void this.handleJoinByCodeSubmit();
    }
  }

  close(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.backdropEl.classList.add('hidden');
    this.closePasswordPrompt();
    this.unsubscribeDir?.();
    this.unsubscribeDir = null;
    if (this.pollTimerId) {
      window.clearInterval(this.pollTimerId);
      this.pollTimerId = 0;
    }
    this.options.sound.keyBackspace();
    this.options.onClose();
  }

  destroy(): void {
    this.unsubscribeDir?.();
    if (this.pollTimerId) window.clearInterval(this.pollTimerId);
    window.removeEventListener('keydown', this.boundKeyDown, true);
    this.backdropEl.remove();
  }

  private bindUiEvents(): void {
    this.callsignInput.addEventListener('change', () => {
      const saved = setLocalPlayerName(this.callsignInput.value);
      this.callsignInput.value = saved;
    });

    this.backdropEl
      .querySelector('[data-mp-close]')
      ?.addEventListener('click', () => {
        this.close();
      });

    this.backdropEl
      .querySelector('[data-mp-refresh]')
      ?.addEventListener('click', () => {
        this.options.sound.menuMove();
        void this.refreshRooms(true);
      });

    this.tabBrowserBtn.addEventListener('click', () => {
      this.switchTab('BROWSER');
    });

    this.tabCreateBtn.addEventListener('click', () => {
      this.switchTab('CREATE');
    });

    this.codeJoinBtn.addEventListener('click', () => {
      void this.handleJoinByCodeSubmit();
    });

    this.codeInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        void this.handleJoinByCodeSubmit();
      }
    });

    this.backdropEl
      .querySelector('[data-mp-pw-cancel]')
      ?.addEventListener('click', () => {
        this.options.sound.keyBackspace();
        this.closePasswordPrompt();
      });

    this.pwConfirmBtn.addEventListener('click', () => {
      void this.submitPasswordPrompt();
    });

    this.pwInputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        void this.submitPasswordPrompt();
      }
    });
  }

  private syncPlayerCallsignBeforeAction(): void {
    const saved = setLocalPlayerName(this.callsignInput.value);
    this.callsignInput.value = saved;
  }

  private switchTab(tab: ModalTab): void {
    if (this.activeTab === tab) return;
    this.activeTab = tab;
    this.options.sound.menuMove();
    this.tabBrowserBtn.classList.toggle('active', tab === 'BROWSER');
    this.tabCreateBtn.classList.toggle('active', tab === 'CREATE');
    this.hideBanner();
    this.renderBody();
    if (tab === 'BROWSER') {
      void this.refreshRooms();
    }
  }

  private showBanner(msg: string, isError = false): void {
    this.bannerEl.textContent = msg;
    this.bannerEl.classList.remove('hidden');
    this.bannerEl.classList.toggle('error', isError);
  }

  private hideBanner(): void {
    this.bannerEl.classList.add('hidden');
    this.bannerEl.textContent = '';
  }

  private async refreshRooms(manualFeedback = false): Promise<void> {
    const list = await this.lobby.listPublicRooms();
    this.rooms = list;
    if (this.activeTab === 'BROWSER') {
      this.renderBrowserTab();
    }
    if (manualFeedback) {
      this.showBanner(
        `Lista atualizada: ${list.length} servidor(es) público(s) ativo(s) no momento.`
      );
    }
  }

  /**
   * Entrada pelo Número da Sala:
   * - Localiza a sala (mesmo oculta da lista pública!).
   * - Se NÃO tiver senha: entra imediatamente!
   * - Se TIVER senha: abre a confirmação de senha daquela sala e, acertando, entra no jogo!
   */
  private async handleJoinByCodeSubmit(): Promise<void> {
    if (this.busy) return;
    this.syncPlayerCallsignBeforeAction();

    const code = normalizeRoomCode(this.codeInput.value);
    if (code.length < 6) {
      this.options.sound.invalidInput();
      this.showBanner(
        'Digite os 6 dígitos do Número da Sala (ex: 482-910) para conectar.',
        true
      );
      this.codeInput.focus();
      return;
    }

    this.busy = true;
    this.codeJoinBtn.disabled = true;
    this.showBanner(`Localizando sala #${formatRoomCodeDisplay(code)}...`);

    const info = await this.lobby.inspectRoomByCode(code);
    this.busy = false;
    this.codeJoinBtn.disabled = false;

    if (!info.found || !info.roomCode) {
      this.options.sound.invalidInput();
      this.showBanner(
        `Sala #${formatRoomCodeDisplay(code)} não encontrada ou já encerrada.`,
        true
      );
      return;
    }

    if (info.isFull) {
      this.options.sound.invalidInput();
      this.showBanner(
        `A sala "${info.roomName}" (#${formatRoomCodeDisplay(code)}) está lotada (${info.playerCount}/${info.maxPlayers}).`,
        true
      );
      return;
    }

    if (info.hasPassword) {
      this.hideBanner();
      this.openPasswordPrompt({
        roomCode: info.roomCode,
        roomName: info.roomName || 'Sala Privada',
        hostName: info.hostName || 'Operador',
        playerCount: info.playerCount ?? 1,
        maxPlayers: info.maxPlayers ?? 4,
        isListed: info.isListed ?? true,
      });
      return;
    }

    await this.executeJoinRoom(info.roomCode);
  }

  private openPasswordPrompt(target: PendingPasswordTarget): void {
    this.pendingPasswordTarget = target;
    this.options.sound.windowOpen();
    const visibilityLabel = target.isListed
      ? 'Pública com Senha'
      : 'Sala Oculta com Senha';
    this.pwRoomInfoEl.innerHTML = '';
    const line1 = document.createElement('div');
    line1.textContent = `SALA #${formatRoomCodeDisplay(target.roomCode)} — ${target.roomName}`;
    line1.style.fontWeight = '700';
    const line2 = document.createElement('div');
    line2.textContent = `Host: ${target.hostName}  •  Jogadores: ${target.playerCount}/${target.maxPlayers}  •  ${visibilityLabel}`;
    this.pwRoomInfoEl.append(line1, line2);

    this.pwInputEl.value = '';
    this.pwErrorEl.textContent = '';
    this.pwOverlayEl.classList.remove('hidden');
    window.setTimeout(() => this.pwInputEl.focus(), 20);
  }

  private closePasswordPrompt(): void {
    this.pendingPasswordTarget = null;
    this.pwOverlayEl.classList.add('hidden');
    this.pwInputEl.value = '';
    this.pwErrorEl.textContent = '';
  }

  private async submitPasswordPrompt(): Promise<void> {
    if (!this.pendingPasswordTarget || this.busy) return;
    const typedPassword = this.pwInputEl.value.trim();
    if (!typedPassword) {
      this.options.sound.invalidInput();
      this.pwErrorEl.textContent = 'Digite a senha da sala para continuar.';
      this.pwInputEl.focus();
      return;
    }

    this.pwConfirmBtn.disabled = true;
    this.pwErrorEl.textContent = 'Verificando senha...';
    await this.executeJoinRoom(
      this.pendingPasswordTarget.roomCode,
      typedPassword,
      true
    );
    this.pwConfirmBtn.disabled = false;
  }

  private async executeJoinRoom(
    roomCode: string,
    password?: string,
    fromPasswordDialog = false
  ): Promise<void> {
    if (this.busy) return;
    this.syncPlayerCallsignBeforeAction();
    this.busy = true;

    const result = await this.lobby.joinRoom(roomCode, password);
    this.busy = false;

    if (!result.ok || !result.session) {
      if (result.errorCode === 'PASSWORD_REQUIRED') {
        this.openPasswordPrompt({
          roomCode,
          roomName: result.roomName || 'Sala Privada',
          hostName: result.hostName || 'Operador',
          playerCount: 1,
          maxPlayers: 4,
          isListed: true,
        });
        return;
      }

      if (result.errorCode === 'WRONG_PASSWORD') {
        this.options.sound.invalidInput();
        if (fromPasswordDialog) {
          this.pwErrorEl.textContent =
            'Senha incorreta! Verifique a senha e tente novamente.';
          this.pwInputEl.select();
        } else {
          this.showBanner('Senha incorreta para esta sala.', true);
        }
        return;
      }

      this.options.sound.invalidInput();
      if (fromPasswordDialog) {
        this.closePasswordPrompt();
      }
      const msg =
        result.errorCode === 'ROOM_FULL'
          ? 'Esta sala acabou de atingir o limite máximo de jogadores.'
          : 'Não foi possível conectar: sala encerrada ou indisponível.';
      this.showBanner(msg, true);
      return;
    }

    // Conectou com sucesso! Fecha o modal mantendo o gesto para entrar no 3D!
    this.options.sound.keyEnter();
    this.isOpen = false;
    this.backdropEl.classList.add('hidden');
    this.closePasswordPrompt();
    this.unsubscribeDir?.();
    this.unsubscribeDir = null;
    if (this.pollTimerId) {
      window.clearInterval(this.pollTimerId);
      this.pollTimerId = 0;
    }
    this.options.onJoinSuccess(result.session);
  }

  private renderBody(): void {
    if (this.activeTab === 'BROWSER') {
      this.renderBrowserTab();
    } else {
      this.renderCreateTab();
    }
  }

  private renderBrowserTab(): void {
    // Preserva foco se o usuário estiver digitando na caixa de busca
    const activeSearch = this.bodyEl.querySelector(
      '[data-mp-search]'
    ) as HTMLInputElement | null;
    const hadFocus = activeSearch && document.activeElement === activeSearch;
    const selStart = activeSearch?.selectionStart ?? null;

    this.bodyEl.innerHTML = '';

    const toolbar = document.createElement('div');
    toolbar.className = 'oof-mp-browser-toolbar';

    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.dataset.mpSearch = '1';
    searchInput.className = 'oof-mp-search-input';
    searchInput.placeholder =
      'Filtrar por nome da sala, host, jogador ou número...';
    searchInput.value = this.searchQuery;
    searchInput.addEventListener('input', () => {
      this.searchQuery = searchInput.value;
      this.renderRoomCardsOnly(listContainer);
    });

    const filterGroup = document.createElement('div');
    filterGroup.className = 'oof-mp-filter-group';

    const filters: Array<{ id: BrowserFilter; label: string }> = [
      { id: 'ALL', label: `TODAS (${this.rooms.length})` },
      {
        id: 'OPEN',
        label: `ABERTAS (${this.rooms.filter((r) => !r.hasPassword).length})`,
      },
      {
        id: 'PASSWORD',
        label: `COM SENHA 🔒 (${this.rooms.filter((r) => r.hasPassword).length})`,
      },
    ];

    for (const f of filters) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className =
        this.filter === f.id ? 'oof-mp-chip active' : 'oof-mp-chip';
      chip.textContent = f.label;
      chip.addEventListener('click', () => {
        this.filter = f.id;
        this.options.sound.menuMove();
        this.renderBrowserTab();
      });
      filterGroup.appendChild(chip);
    }

    toolbar.append(searchInput, filterGroup);
    this.bodyEl.appendChild(toolbar);

    const listContainer = document.createElement('div');
    listContainer.className = 'oof-mp-rooms-list';
    this.bodyEl.appendChild(listContainer);

    this.renderRoomCardsOnly(listContainer);

    if (hadFocus) {
      searchInput.focus();
      if (selStart !== null) {
        searchInput.setSelectionRange(selStart, selStart);
      }
    }
  }

  private renderRoomCardsOnly(container: HTMLElement): void {
    container.innerHTML = '';

    const q = this.searchQuery.trim().toLowerCase();
    const filtered = this.rooms.filter((r) => {
      if (this.filter === 'OPEN' && r.hasPassword) return false;
      if (this.filter === 'PASSWORD' && !r.hasPassword) return false;
      if (!q) return true;
      const playersStr = r.playersSummary
        .map((p) => p.name.toLowerCase())
        .join(' ');
      return (
        r.roomName.toLowerCase().includes(q) ||
        r.hostName.toLowerCase().includes(q) ||
        r.roomCode.includes(q.replace(/[^0-9]/g, '')) ||
        playersStr.includes(q)
      );
    });

    if (filtered.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'oof-mp-empty';
      empty.innerHTML = `
        <div class="oof-mp-empty-title">NENHUM SERVIDOR PÚBLICO DISPONÍVEL NESTE FILTRO</div>
        <div class="oof-mp-empty-sub">
          Crie uma sala pública para que outros jogadores entrem junto com você, ou digite o <strong>Número da Sala</strong> acima para entrar em uma sala privada/oculta!
        </div>
      `;
      const createBtn = document.createElement('button');
      createBtn.type = 'button';
      createBtn.className = 'oof-mp-btn primary';
      createBtn.textContent = '[ + CRIAR NOVA SALA AGORA ]';
      createBtn.addEventListener('click', () => {
        this.switchTab('CREATE');
      });
      empty.appendChild(createBtn);
      container.appendChild(empty);
      return;
    }

    for (const room of filtered) {
      const card = document.createElement('div');
      card.className = 'oof-mp-room-card';

      const main = document.createElement('div');
      main.className = 'oof-mp-room-main';

      const top = document.createElement('div');
      top.className = 'oof-mp-room-top';

      const nameEl = document.createElement('span');
      nameEl.className = 'oof-mp-room-name';
      nameEl.textContent = room.roomName;

      const accessBadge = document.createElement('span');
      accessBadge.className = room.hasPassword
        ? 'oof-mp-badge locked'
        : 'oof-mp-badge open';
      accessBadge.textContent = room.hasPassword
        ? '🔒 PRIVADA (SENHA)'
        : '● PÚBLICA ABERTA';

      const codeBadge = document.createElement('span');
      codeBadge.className = 'oof-mp-badge code';
      codeBadge.title = 'Clique para copiar o Número da Sala';
      codeBadge.textContent = `Nº #${formatRoomCodeDisplay(room.roomCode)}`;
      codeBadge.addEventListener('click', () => {
        void navigator.clipboard?.writeText(room.roomCode);
        this.showBanner(
          `Número da sala #${formatRoomCodeDisplay(room.roomCode)} copiado para a área de transferência!`
        );
      });

      top.append(nameEl, accessBadge, codeBadge);

      const meta = document.createElement('div');
      meta.className = 'oof-mp-room-meta';
      meta.textContent = `Host: ${room.hostName}   •   Região: ${room.region}   •   Status: DISPONÍVEL`;

      const playersLine = document.createElement('div');
      playersLine.className = 'oof-mp-room-players-line';
      const names = this.formatPlayerListNames(room.playersSummary);
      playersLine.innerHTML = `<span>Jogadores conectados:</span> `;
      const namesSpan = document.createElement('strong');
      namesSpan.textContent = names;
      playersLine.appendChild(namesSpan);

      main.append(top, meta, playersLine);

      const actions = document.createElement('div');
      actions.className = 'oof-mp-room-actions';

      const isFull = room.playerCount >= room.maxPlayers;
      const slotsPill = document.createElement('span');
      slotsPill.className = isFull
        ? 'oof-mp-slots-pill full'
        : 'oof-mp-slots-pill';
      slotsPill.textContent = `${room.playerCount}/${room.maxPlayers}`;

      const joinBtn = document.createElement('button');
      joinBtn.type = 'button';
      joinBtn.className = 'oof-mp-btn primary';
      joinBtn.disabled = isFull;
      joinBtn.textContent = isFull
        ? '[ LOTADA ]'
        : room.hasPassword
          ? '[ 🔒 ENTRAR ]'
          : '[ ENTRAR ]';

      joinBtn.addEventListener('click', () => {
        if (room.hasPassword) {
          this.openPasswordPrompt({
            roomCode: room.roomCode,
            roomName: room.roomName,
            hostName: room.hostName,
            playerCount: room.playerCount,
            maxPlayers: room.maxPlayers,
            isListed: true,
          });
        } else {
          void this.executeJoinRoom(room.roomCode);
        }
      });

      actions.append(slotsPill, joinBtn);
      card.append(main, actions);
      container.appendChild(card);
    }
  }

  private formatPlayerListNames(players: RoomPlayerSummary[]): string {
    if (!players || players.length === 0) return '1 Operador';
    return players
      .map((p) => (p.status === 'HOST' ? `${p.name} (Host)` : p.name))
      .join(', ');
  }

  private renderCreateTab(): void {
    this.bodyEl.innerHTML = '';

    const form = document.createElement('div');
    form.className = 'oof-mp-create-form';

    // 1. Nome + Capacidade
    const rowTop = document.createElement('div');
    rowTop.className = 'oof-mp-choice-grid';

    const nameField = document.createElement('div');
    nameField.className = 'oof-mp-field';
    nameField.innerHTML = `<label class="oof-mp-field-label">1. NOME DO SERVIDOR / SALA:</label>`;
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'oof-mp-text-input';
    nameInput.maxLength = 38;
    nameInput.value = this.draftRoomName;
    nameInput.placeholder = 'Ex: Expedição Subterrânea';
    nameInput.addEventListener('input', () => {
      this.draftRoomName = nameInput.value;
    });
    nameField.appendChild(nameInput);

    const capField = document.createElement('div');
    capField.className = 'oof-mp-field';
    capField.innerHTML = `<label class="oof-mp-field-label">2. LIMITE DE JOGADORES NA SALA:</label>`;
    const capRow = document.createElement('div');
    capRow.className = 'oof-mp-filter-group';
    for (const cap of [2, 3, 4, 6]) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className =
        this.draftMaxPlayers === cap ? 'oof-mp-chip active' : 'oof-mp-chip';
      b.textContent = `${cap} JOGADORES`;
      b.addEventListener('click', () => {
        this.draftMaxPlayers = cap;
        this.options.sound.menuMove();
        this.renderCreateTab();
      });
      capRow.appendChild(b);
    }
    capField.appendChild(capRow);

    rowTop.append(nameField, capField);
    form.appendChild(rowTop);

    // 2. Proteção por Senha
    const pwSection = document.createElement('div');
    pwSection.className = 'oof-mp-field';
    pwSection.innerHTML = `<label class="oof-mp-field-label">3. TIPO DE ACESSO (PÚBLICA OU PRIVADA COM SENHA):</label>`;
    const pwGrid = document.createElement('div');
    pwGrid.className = 'oof-mp-choice-grid';

    const openCard = document.createElement('button');
    openCard.type = 'button';
    openCard.className = !this.draftRequirePassword
      ? 'oof-mp-choice-card selected'
      : 'oof-mp-choice-card';
    openCard.innerHTML = `
      <div class="oof-mp-choice-title">● SEM SENHA (ACESSO LIVRE)</div>
      <div class="oof-mp-choice-desc">Qualquer jogador que encontrar a sala ou tiver o número entra direto.</div>
    `;
    openCard.addEventListener('click', () => {
      this.draftRequirePassword = false;
      this.options.sound.menuMove();
      this.renderCreateTab();
    });

    const privCard = document.createElement('button');
    privCard.type = 'button';
    privCard.className = this.draftRequirePassword
      ? 'oof-mp-choice-card selected'
      : 'oof-mp-choice-card';
    privCard.innerHTML = `
      <div class="oof-mp-choice-title">🔒 SALA PRIVADA (EXIGIR SENHA)</div>
      <div class="oof-mp-choice-desc">Pede senha obrigatória ao clicar na sala ou ao entrar pelo Número da Sala.</div>
    `;
    privCard.addEventListener('click', () => {
      this.draftRequirePassword = true;
      this.options.sound.menuMove();
      this.renderCreateTab();
    });

    pwGrid.append(openCard, privCard);
    pwSection.appendChild(pwGrid);

    if (this.draftRequirePassword) {
      const passWrap = document.createElement('div');
      passWrap.className = 'oof-mp-pass-wrap';
      passWrap.style.marginTop = '6px';

      const passInput = document.createElement('input');
      passInput.type = this.draftShowPassword ? 'text' : 'password';
      passInput.className = 'oof-mp-text-input';
      passInput.maxLength = 32;
      passInput.placeholder = 'Defina a senha da sala...';
      passInput.value = this.draftPassword;
      passInput.addEventListener('input', () => {
        this.draftPassword = passInput.value;
      });

      const toggleShowBtn = document.createElement('button');
      toggleShowBtn.type = 'button';
      toggleShowBtn.className = 'oof-mp-btn';
      toggleShowBtn.textContent = this.draftShowPassword
        ? '[ OCULTAR ]'
        : '[ MOSTRAR ]';
      toggleShowBtn.addEventListener('click', () => {
        this.draftShowPassword = !this.draftShowPassword;
        this.renderCreateTab();
      });

      passWrap.append(passInput, toggleShowBtn);
      pwSection.appendChild(passWrap);
    }

    form.appendChild(pwSection);

    // 3. Visibilidade na Lista Pública vs Sala Oculta
    const visSection = document.createElement('div');
    visSection.className = 'oof-mp-field';
    visSection.innerHTML = `<label class="oof-mp-field-label">4. VISIBILIDADE NA LISTA DE SERVIDORES:</label>`;
    const visGrid = document.createElement('div');
    visGrid.className = 'oof-mp-choice-grid';

    const listedCard = document.createElement('button');
    listedCard.type = 'button';
    listedCard.className = this.draftIsListed
      ? 'oof-mp-choice-card selected'
      : 'oof-mp-choice-card';
    listedCard.innerHTML = `
      <div class="oof-mp-choice-title">[✓] APARECER NA LISTA PÚBLICA</div>
      <div class="oof-mp-choice-desc">Sua sala fica visível na aba de Servidores Disponíveis${this.draftRequirePassword ? ' (com cadeado 🔒 de senha)' : ''}.</div>
    `;
    listedCard.addEventListener('click', () => {
      this.draftIsListed = true;
      this.options.sound.menuMove();
      this.renderCreateTab();
    });

    const unlistedCard = document.createElement('button');
    unlistedCard.type = 'button';
    unlistedCard.className = !this.draftIsListed
      ? 'oof-mp-choice-card selected'
      : 'oof-mp-choice-card';
    unlistedCard.innerHTML = `
      <div class="oof-mp-choice-title">[ ] NÃO APARECER NA LISTA PÚBLICA (OCULTA)</div>
      <div class="oof-mp-choice-desc">Invisível na lista pública — só entra quem colocar o Número da Sala${this.draftRequirePassword ? ' + Senha' : ''}!</div>
    `;
    unlistedCard.addEventListener('click', () => {
      this.draftIsListed = false;
      this.options.sound.menuMove();
      this.renderCreateTab();
    });

    visGrid.append(listedCard, unlistedCard);
    visSection.appendChild(visGrid);
    form.appendChild(visSection);

    // Resumo claro da combinação selecionada
    const summary = document.createElement('div');
    summary.className = 'oof-mp-summary-box';
    if (this.draftIsListed && !this.draftRequirePassword) {
      summary.textContent =
        'Modo selecionado: SERVIDOR PÚBLICO ABERTO — aparecerá na lista de salas para qualquer pessoa jogar junto imediatamente (ou entrar pelo Número da Sala).';
    } else if (this.draftIsListed && this.draftRequirePassword) {
      summary.textContent =
        'Modo selecionado: SALA PÚBLICA COM SENHA — aparecerá na lista pública com cadeado 🔒, exigindo a senha para entrar.';
    } else if (!this.draftIsListed && this.draftRequirePassword) {
      summary.textContent =
        'Modo selecionado: SALA OCULTA COM SENHA — NÃO aparecerá na lista pública. Seus amigos entrarão digitando o Número da Sala e confirmando a senha.';
    } else {
      summary.textContent =
        'Modo selecionado: SALA OCULTA (NÃO LISTADA) — NÃO aparecerá na lista pública. Só entra quem digitar o Número da Sala.';
    }
    form.appendChild(summary);

    const submitBtn = document.createElement('button');
    submitBtn.type = 'button';
    submitBtn.className = 'oof-mp-btn primary';
    submitBtn.style.padding = '11px 18px';
    submitBtn.style.fontSize = '14px';
    submitBtn.textContent = '[ CRIAR SALA E ENTRAR NO LABIRINTO ]';
    submitBtn.addEventListener('click', () => {
      void this.handleCreateRoomSubmit(submitBtn);
    });

    form.appendChild(submitBtn);
    this.bodyEl.appendChild(form);
  }

  private async handleCreateRoomSubmit(btn: HTMLButtonElement): Promise<void> {
    if (this.busy) return;
    this.syncPlayerCallsignBeforeAction();

    if (this.draftRequirePassword && this.draftPassword.trim().length === 0) {
      this.options.sound.invalidInput();
      this.showBanner(
        'Defina uma senha para a sala privada (ou selecione "Sem Senha").',
        true
      );
      return;
    }

    this.busy = true;
    btn.disabled = true;
    this.showBanner('Publicando sala na rede multiplayer...');

    const session = await this.lobby.createRoom({
      roomName: this.draftRoomName,
      isListed: this.draftIsListed,
      password: this.draftRequirePassword ? this.draftPassword : '',
      maxPlayers: this.draftMaxPlayers,
    });

    this.busy = false;
    btn.disabled = false;

    this.options.sound.keyEnter();
    this.isOpen = false;
    this.backdropEl.classList.add('hidden');
    this.unsubscribeDir?.();
    this.unsubscribeDir = null;
    if (this.pollTimerId) {
      window.clearInterval(this.pollTimerId);
      this.pollTimerId = 0;
    }
    this.options.onJoinSuccess(session);
  }
}
