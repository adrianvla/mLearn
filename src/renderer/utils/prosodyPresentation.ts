import type { FlashcardProsody, LanguageData } from '../../shared/types';
import {
  getLanguageProsodyOverlayConfig,
  getLanguageProsodyType,
  getProsodyPositionLabel,
  getProsodyPositionPlaceholder,
} from '../../shared/languageFeatures';
import {
  getDeclarativeOverlayAdapter,
  DECLARATIVE_OVERLAY_RENDERER_KEY,
  getProsodyPresentationAdapter,
  type ProsodyOverlayRenderer,
  type TranslateFn,
} from './prosodyPresentationAdapters';

export type { ProsodyOverlayRenderer, TranslateFn };

function getPresentationAdapterForData(data: LanguageData | null | undefined) {
  const adapter = getProsodyPresentationAdapter(getLanguageProsodyType(data));
  if (adapter) return adapter;
  // Any package whose prosody config declares a declarative overlay gets the
  // generic renderer — the extension point is the PACKAGE METADATA, not a
  // per-type registration.
  return getLanguageProsodyOverlayConfig(data) ? getDeclarativeOverlayAdapter() : undefined;
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
  const adapter = getProsodyPresentationAdapter(prosodyType ?? getLanguageProsodyType(data));
  if (adapter) return adapter.overlayRenderer ?? null;
  return getLanguageProsodyOverlayConfig(data) ? DECLARATIVE_OVERLAY_RENDERER_KEY : null;
}

export function canRenderStoredProsodyWithoutMetadata(prosodyType?: FlashcardProsody['type']): boolean {
  return getProsodyOverlayRenderer(null, prosodyType) !== null;
}
