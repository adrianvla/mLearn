import type { FlashcardProsody } from '../../shared/types';
import { getJapanesePitchAccentCategoryLabelForReading } from './japanesePitchAccent';

export type TranslateFn = (key: string, params?: Record<string, string | number>) => string;
export type ProsodyOverlayRenderer = Exclude<NonNullable<FlashcardProsody['type']>, 'none'>;

interface ProsodyPresentationAdapter {
  overlayRenderer?: ProsodyOverlayRenderer;
  positionLabelKey?: string;
  positionPlaceholderKey?: string;
  getCategoryLabel?: (position: number, reading: string, t: TranslateFn) => string;
}

const GENERIC_DECLARATIVE_OVERLAY_RENDERER = 'generic-declarative';

const PROSODY_PRESENTATION_ADAPTERS: Record<string, ProsodyPresentationAdapter> = {
  'japanese-pitch-accent': {
    overlayRenderer: 'japanese-pitch-accent',
    positionLabelKey: 'mlearn.CardEditor.Fields.JapanesePitchAccent',
    positionPlaceholderKey: 'mlearn.CardEditor.Fields.JapanesePitchAccentPlaceholder',
    getCategoryLabel: (position, reading, t) => (
      getJapanesePitchAccentCategoryLabelForReading(position, reading, t) ?? ''
    ),
  },
};

/**
 * Adapter for ANY package whose prosody config opts into the declarative
 * overlay (`prosody.overlay`). The overlay itself is drawn by the generic
 * renderer from package-declared structure — no per-language runtime code.
 */
export function getDeclarativeOverlayAdapter(): ProsodyPresentationAdapter {
  return { overlayRenderer: GENERIC_DECLARATIVE_OVERLAY_RENDERER };
}

export const DECLARATIVE_OVERLAY_RENDERER_KEY = GENERIC_DECLARATIVE_OVERLAY_RENDERER;

export function getProsodyPresentationAdapter(
  prosodyType: FlashcardProsody['type'] | undefined,
): ProsodyPresentationAdapter | undefined {
  if (!prosodyType || prosodyType === 'none') return undefined;
  return PROSODY_PRESENTATION_ADAPTERS[prosodyType];
}
