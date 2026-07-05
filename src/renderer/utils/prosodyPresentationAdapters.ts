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

export function getProsodyPresentationAdapter(
  prosodyType: FlashcardProsody['type'] | undefined,
): ProsodyPresentationAdapter | undefined {
  if (!prosodyType || prosodyType === 'none') return undefined;
  return PROSODY_PRESENTATION_ADAPTERS[prosodyType];
}
