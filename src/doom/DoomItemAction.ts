/** Transient item animation replicated in pose packets (older clients may omit it). */
export const QUICK_ITEM_DURATIONS = {
  knife: 0.46,
  bandage: 0.62,
  morphine: 0.62,
  battery: 0.54,
  flare: 0.52,
  key: 0.58,
  radar: 0.68,
  walkie: 0.68,
  shotgun_receiver: 0.62,
  shotgun_barrel: 0.62,
  shotgun_pump: 0.62,
  shotgun_stock: 0.62,
  shotgun_shells: 0.62,
} as const;

export type QuickHandheldKind = keyof typeof QUICK_ITEM_DURATIONS;
export type HeldWeapon = 'shotgun';

export interface QuickItemAction {
  kind: QuickHandheldKind;
  progress: number;
  mode?: 'use' | 'pickup';
}

export function parseQuickItemAction(value: unknown): QuickItemAction | null {
  if (!value || typeof value !== 'object') return null;
  const { kind, progress, mode } = value as { kind?: unknown; progress?: unknown; mode?: unknown };
  if (typeof kind !== 'string' || !Object.hasOwn(QUICK_ITEM_DURATIONS, kind) ||
      typeof progress !== 'number' || !Number.isFinite(progress) || progress < 0 || progress >= 1) return null;
  if (mode !== undefined && mode !== 'use' && mode !== 'pickup') return null;
  return { kind: kind as QuickHandheldKind, progress, mode: mode === 'pickup' ? 'pickup' : 'use' };
}
