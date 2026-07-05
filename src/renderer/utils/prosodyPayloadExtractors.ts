import type { FlashcardProsody } from '../../shared/types';
import { extractJapanesePitchAccentPayloadPosition } from './japanesePitchAccent';

type ProsodyPayloadPositionExtractor = (value: unknown) => number | null;

const PROSODY_POSITION_EXTRACTORS: Record<string, ProsodyPayloadPositionExtractor> = {
  'japanese-pitch-accent': extractJapanesePitchAccentPayloadPosition,
};

export function extractProsodyPayloadPosition(
  value: unknown,
  prosodyType: FlashcardProsody['type'] | undefined,
): number | null {
  if (!prosodyType || prosodyType === 'none') return null;
  return PROSODY_POSITION_EXTRACTORS[prosodyType]?.(value) ?? null;
}

export function hasProsodyPayloadPositionExtractor(prosodyType: FlashcardProsody['type'] | undefined): boolean {
  return Boolean(prosodyType && prosodyType !== 'none' && PROSODY_POSITION_EXTRACTORS[prosodyType]);
}
