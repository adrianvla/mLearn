import { DEFAULT_SETTINGS, type Settings } from './types';

type WordHoverSettings = Pick<Settings, 'wordHoverSizePercent'>;

/** Bound migrated/imported values before they become CSS dimensions. */
export function wordHoverSizePercent(settings: WordHoverSettings): number {
  const value = settings.wordHoverSizePercent;
  const finite = typeof value === 'number' && Number.isFinite(value)
    ? value : DEFAULT_SETTINGS.wordHoverSizePercent!;
  return Math.min(140, Math.max(60, finite));
}

export function wordHoverScale(settings: WordHoverSettings): number {
  return wordHoverSizePercent(settings) / 100;
}
