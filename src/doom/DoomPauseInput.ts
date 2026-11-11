/** Como reagir quando o navegador consome Esc ao liberar mouse ou tela cheia. */
export interface BrowserControlReleaseState {
  engaged: boolean;
  disposed: boolean;
  paused: boolean;
  inventoryOpen: boolean;
  gameOver: boolean;
  chatOpen: boolean;
  danceMenuOpen: boolean;
  inSequence: boolean;
  intentionalRelease: boolean;
  dancing: boolean;
  /** O console de diagnóstico está aberto (já tomou conta do mouse). */
  consoleOpen?: boolean;
}

export function resolveBrowserControlRelease(state: BrowserControlReleaseState): 'ignore' | 'stop-dance' | 'pause' {
  if (!state.engaged || state.disposed || state.paused || state.inventoryOpen || state.gameOver ||
      state.chatOpen || state.danceMenuOpen || state.inSequence || state.intentionalRelease ||
      state.consoleOpen) return 'ignore';
  return state.dancing ? 'stop-dance' : 'pause';
}
