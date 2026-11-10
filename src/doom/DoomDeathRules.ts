/**
 * Regras de letalidade da captura da Aranha.
 *
 * A Aranha agarra o jogador de duas formas: ele pode ser arrastado até o Ninho
 * para virar casulo (com chance de resgate no cooperativo) ou ser executado ali
 * mesmo, no corredor. Quem decide isso é o estado vital do operador no instante
 * do bote — não o modo de jogo. Antes, no cooperativo, TODO jogador capturado era
 * levado para a teia, mesmo sangrando com pouquíssima vida, e o resultado era um
 * jogador "quase morto" sendo arrastado como se estivesse inteiro.
 */

/** Abaixo desta vida não existe fôlego para ser arrastado: o bote é fatal. */
export const FATAL_CAPTURE_HEALTH = 36;

export type SpiderCaptureOutcome = 'ABDUCTION_TO_WEB' | 'PERMADEATH_EXECUTION';

/**
 * Resolve o desfecho de um bote da Aranha.
 *
 * - Preso no casulo do Ninho e devorado: sempre execução.
 * - Vida igual ou abaixo do limite crítico: execução imediata (o corpo fica no
 *   mapa como ragdoll), em solo e no cooperativo.
 * - Caso contrário: arrasto até o Ninho, onde o resgate ainda é possível no
 *   cooperativo.
 */
export function resolveSpiderCaptureOutcome(
  health: number,
  options: { lockedInCocoon?: boolean } = {}
): SpiderCaptureOutcome {
  if (options.lockedInCocoon) return 'PERMADEATH_EXECUTION';
  const safeHealth = Number.isFinite(health) ? health : 100;
  if (safeHealth <= FATAL_CAPTURE_HEALTH) return 'PERMADEATH_EXECUTION';
  return 'ABDUCTION_TO_WEB';
}

/** O bote executou o jogador? (usado para som, HUD e rede). */
export function isFatalCapture(health: number, lockedInCocoon = false): boolean {
  return resolveSpiderCaptureOutcome(health, { lockedInCocoon }) === 'PERMADEATH_EXECUTION';
}
