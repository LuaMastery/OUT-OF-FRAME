/**
 * Estrutura do menu principal.
 *
 * A tela é intencionalmente enxuta: apenas o título e as três opções reais do
 * jogo. Rótulos auxiliares, dicas de teclado, numeração e legendas de
 * ambientação não fazem parte da interface.
 */
export const TITLE_MENU_ITEMS = ['INICIAR', 'MULTIPLAYER', 'SAIR'] as const;

const TITLE_MENU_BUTTONS = TITLE_MENU_ITEMS.map(
  (label, index) => `
          <button type="button" data-title-index="${index}" aria-label="${label}">
            <span class="oof-title-screen__option"><strong class="oof-title-screen__label" data-label="${label}"></strong></span>
          </button>`
).join('');

export const TITLE_MENU_MARKUP = `
      <div class="oof-title-screen__background" aria-hidden="true"></div>
      <div class="oof-title-screen__particles" aria-hidden="true"></div>
      <div class="oof-title-screen__veil" aria-hidden="true"></div>
      <div class="oof-title-screen__content">
        <div class="oof-title-screen__heading">
          <h1 aria-label="OUT-OF-FRAME"><span class="oof-title-screen__word" data-word="OUT-OF-"></span><span class="oof-title-screen__word" data-word="FRAME"></span></h1>
        </div>
        <nav class="oof-title-screen__nav" aria-label="Opções do jogo">${TITLE_MENU_BUTTONS}
        </nav>
      </div>
    `;
