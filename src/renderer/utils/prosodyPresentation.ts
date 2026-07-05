import type { FlashcardProsody, LanguageData } from '../../shared/types';
import {
  getLanguageProsodyType,
  getProsodyPositionLabel,
  getProsodyPositionPlaceholder,
} from '../../shared/languageFeatures';
import {
  getProsodyPresentationAdapter,
  type ProsodyOverlayRenderer,
  type TranslateFn,
} from './prosodyPresentationAdapters';

export type { ProsodyOverlayRenderer, TranslateFn };

function getPresentationAdapterForData(data: LanguageData | null | undefined) {
  return getProsodyPresentationAdapter(getLanguageProsodyType(data));
}

export function getProsodyPositionFieldLabel(data: LanguageData | null | undefined, t: TranslateFn): string {
  const adapter = getPresentationAdapterForData(data);
  return getProsodyPositionLabel(data)
    ?? (adapter?.positionLabelKey
      ? t(adapter.positionLabelKey)
      : t('mlearn.CardEditor.Fields.ProsodyPosition'));
}

export function getProsodyPositionFieldPlaceholder(data: LanguageData | null | undefined, t: TranslateFn): string {
  const adapter = getPresentationAdapterForData(data);
  return getProsodyPositionPlaceholder(data)
    ?? (adapter?.positionPlaceholderKey
      ? t(adapter.positionPlaceholderKey)
      : t('mlearn.CardEditor.Fields.ProsodyPositionPlaceholder'));
}

export function getProsodyPositionCategoryLabel(
  data: LanguageData | null | undefined,
  position: number | null | undefined,
  reading: string,
  t: TranslateFn,
  prosodyType: FlashcardProsody['type'] | undefined = getLanguageProsodyType(data),
): string {
  if (position === null || position === undefined || Number.isNaN(position)) return '';
  if (!reading) return '';
  return getProsodyPresentationAdapter(prosodyType)?.getCategoryLabel?.(position, reading, t) ?? '';
}

export function getProsodyOverlayRenderer(
  data: LanguageData | null | undefined,
  prosodyType?: FlashcardProsody['type'],
): ProsodyOverlayRenderer | null {
  return getProsodyPresentationAdapter(prosodyType ?? getLanguageProsodyType(data))?.overlayRenderer ?? null;
}

export function canRenderStoredProsodyWithoutMetadata(prosodyType?: FlashcardProsody['type']): boolean {
  return getProsodyOverlayRenderer(null, prosodyType) !== null;
}
