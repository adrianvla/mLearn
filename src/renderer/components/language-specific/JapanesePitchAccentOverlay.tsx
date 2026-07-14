/**
 * JapanesePitchAccentOverlay - Japanese pitch accent renderer
 * 
 * A single component that handles Japanese pitch accent rendering across the app.
 * It can:
 * - Fetch pitch accent data from explicit props OR from translation cache
 * - Render as an inline overlay on children (subtitles, flashcards)
 * - Render as a pill (word hover)
 * - Render as a standalone preview (editors)
 * - Be grammar-aware (particle box based on POS and context)
 * - Only show when language metadata selects the Japanese pitch-accent renderer
 */

import { Component, JSX, Show, createMemo, createSignal, createEffect, children as resolveChildren } from 'solid-js';
import { useSettings, useLanguage } from '../../context';
import { getLanguageProsodyType, shouldIncludeProsodyParticleBoxForContext } from '../../../shared/languageFeatures';
import { prosodyVisible } from '../../../shared/prosodySettings';
import {
  buildJapanesePitchAccentHtml,
  extractJapanesePitchAccentPayloadPosition,
  getJapanesePitchAccentInfo,
  getJapaneseMoraCount,
} from '../../utils/japanesePitchAccent';
import { cacheVersion, getCachedTranslation, type WordLookupCandidateOptions } from '../../hooks/useTranslation';
import { extractReadingValue } from '../../utils/translationCacheParsers';
import { getDictionaryTargetLanguageForSettings } from '../../utils/dictionaryTargetLanguage';
import { PillLabel } from '../common/Label';
import type { LanguageData } from '../../../shared/types';
import './JapanesePitchAccent.css';

const JAPANESE_PITCH_ACCENT_PROSODY_TYPE = 'japanese-pitch-accent';

function languageUsesJapanesePitchAccentRenderer(data?: LanguageData | null): boolean {
  return getLanguageProsodyType(data) === JAPANESE_PITCH_ACCENT_PROSODY_TYPE;
}

export interface JapanesePitchAccentOverlayProps {
  /** The word to look up pitch accent for (dictionary form) */
  word: string;
  /** Reading in kana. If not provided, tries to extract from cache or uses word. */
  reading?: string;
  /** Explicit pitch accent position. If provided, skips cache lookup. */
  pitchPosition?: number | null;
  /** Part of speech - affects particle box rendering */
  pos?: string;
  /** POS of the next token - for verb+verb particle box suppression in subtitles */
  nextPos?: string;
  /** Display mode */
  mode?: 'overlay' | 'pill' | 'preview';
  /** Children to overlay pitch accent on (used in overlay mode) */
  children?: JSX.Element;
  /** Additional CSS class */
  class?: string;
  /** Optional inline style for overlay/preview text wrappers */
  style?: JSX.CSSProperties;
  /** Language code for cache lookups when this word is not in the active study language. */
  language?: string;
  /** Language metadata for saved card rendering and particle-box rules. */
  languageData?: LanguageData | null;
  /** Allow explicit stored card pitch data to render even if the language package is not currently loaded. */
  allowStoredPitchWithoutMetadata?: boolean;
  /** Whether to show the particle box. Auto-determined from POS if not specified. */
  showParticleBox?: boolean;
  /** Use homogenous styling (no particle fade effect) */
  homogenous?: boolean;
  /** Part of speech label to display inside the pill (pill mode only) */
  posLabel?: string;
}

/** Extract pitch position from translation cache data */
function extractPitchFromCache(word: string, language?: string, lookupOptions?: WordLookupCandidateOptions): number | null {
  const cached = getCachedTranslation(word, language, lookupOptions);
  if (!cached?.data) return null;

  return extractJapanesePitchAccentPayloadPosition(cached.data);
}

/** Extract reading from translation cache data */
function extractReadingFromCache(
  word: string,
  languageData?: LanguageData | null,
  language?: string,
  lookupOptions?: WordLookupCandidateOptions,
): string | null {
  const cached = getCachedTranslation(word, language, lookupOptions);
  return extractReadingValue(cached?.data, languageData);
}

/**
 * JapanesePitchAccentOverlay - Japanese pitch accent renderer
 */
export const JapanesePitchAccentOverlay: Component<JapanesePitchAccentOverlayProps> = (props) => {
  const { settings } = useSettings();
  const language = useLanguage();
  const resolvedLanguageData = () => (
    props.languageData !== undefined
      ? props.languageData
      : props.language
        ? language.langData?.[props.language] ?? (props.language === settings.language ? language.currentLangData?.() ?? null : null)
        : language.currentLangData?.() ?? null
  );
  const lookupLanguage = () => props.language ?? settings.language;
  const dictionaryTargetLanguage = createMemo(() => (
    getDictionaryTargetLanguageForSettings(settings, lookupLanguage())
  ));
  const lookupOptions = () => ({
    getCanonicalForm: (word: string) => language.getCanonicalFormForLanguage(lookupLanguage(), word),
    getWordVariants: (word: string) => language.getWordVariantsForLanguage(lookupLanguage(), word),
    dictionaryTargetLanguage,
    languageData: resolvedLanguageData,
  });

  // Resolve whether pitch accent should be shown at all
  const isEnabled = createMemo(() => {
    const hasExplicitStoredPitch = props.allowStoredPitchWithoutMetadata === true
      && props.pitchPosition !== undefined
      && props.pitchPosition !== null;
    return prosodyVisible(settings) && (
      languageUsesJapanesePitchAccentRenderer(resolvedLanguageData())
      || hasExplicitStoredPitch
    );
  });

  // Cache writes publish a version change so every displayed word can update when its lookup completes.
  const [cachedPitch, setCachedPitch] = createSignal<number | null>(null);
  const [cachedReading, setCachedReading] = createSignal<string | null>(null);

  createEffect(() => {
    cacheVersion();
    const word = props.word;
    if (!isEnabled()) return;
    if (props.pitchPosition !== undefined && props.pitchPosition !== null) return;
    if (!word) return;

    setCachedPitch(null);
    setCachedReading(null);

    const checkCache = () => {
      const pitch = extractPitchFromCache(word, lookupLanguage(), lookupOptions());
      if (pitch !== null) {
        setCachedPitch(pitch);
        const reading = extractReadingFromCache(word, resolvedLanguageData(), lookupLanguage(), lookupOptions());
        if (reading) setCachedReading(reading);
        return true;
      }
      return false;
    };

    if (checkCache()) return;
  });

  // Effective pitch position: explicit prop > cached
  const effectivePitch = createMemo((): number | null => {
    if (props.pitchPosition !== undefined && props.pitchPosition !== null) {
      return props.pitchPosition;
    }
    return cachedPitch();
  });

  // Effective reading: explicit prop > cached > word
  const effectiveReading = createMemo((): string => {
    if (props.reading) return props.reading;
    return cachedReading() || props.word || '';
  });

  // Whether to include particle box
  const includeParticleBox = createMemo(() => {
    if (props.showParticleBox !== undefined) return props.showParticleBox;
    const reading = effectiveReading();
    const moraCount = getJapaneseMoraCount(reading);
    // Always show particle box for 1-mora words — without it the diagram is meaningless
    if (moraCount === 1) return true;
    const pos = props.pos || '';
    const nextPos = props.nextPos || '';
    return shouldIncludeProsodyParticleBoxForContext(pos, nextPos, resolvedLanguageData());
  });

  // Build the pitch accent HTML
  const pitchHtml = createMemo((): string => {
    if (!isEnabled()) return '';
    const pitch = effectivePitch();
    if (pitch === null) return '';
    const reading = effectiveReading();
    if (!reading) return '';

    const info = getJapanesePitchAccentInfo(pitch, reading);
    if (!info) return '';

    const isPill = (props.mode || 'overlay') === 'pill';
    const particleMargin = isPill ? 0 : undefined;
    return buildJapanesePitchAccentHtml(info, info.length, {
      includeParticleBox: includeParticleBox(),
      particleMarginPercent: particleMargin,
      padTo: info.length,
      homogenous: props.homogenous ?? false,
    });
  });

  const mode = () => props.mode || 'overlay';

  // Pill mode: render reading with pitch accent diagram in a pill
  const renderPill = () => (
    <Show when={pitchHtml()}>
      <PillLabel variant="gray" class={`pitch-accent-pill ${props.class || ''}`}>
        <span class="pitch-accent-word">
          {effectiveReading()}{includeParticleBox() ? '✦' : ''}
          <span class="pitch-accent" aria-hidden="true" innerHTML={pitchHtml()} />
        </span>
        <Show when={props.posLabel}>
          <span class="pitch-pill-pos">{props.posLabel}</span>
        </Show>
      </PillLabel>
    </Show>
  );

  // Preview mode: render word text with pitch accent overlay (for editors)
  const renderPreview = () => (
    <Show when={pitchHtml()}>
      <span class={`pitch-accent-preview ${props.class || ''}`} style={props.style}>
        <span class="pitch-accent-word">
          {effectiveReading()}
          <span class="pitch-accent" aria-hidden="true" innerHTML={pitchHtml()} />
        </span>
      </span>
    </Show>
  );

  // Overlay mode: render children with pitch accent overlaid
  const renderOverlay = () => {
    const resolved = resolveChildren(() => props.children);
    return (
      <span class={`prosody-overlay-wrapper pitch-overlay-wrapper ${props.class || ''}`} style={props.style}>
        {resolved()}
        <Show when={pitchHtml()}>
          <span class="pitch-accent" aria-hidden="true" innerHTML={pitchHtml()} />
        </Show>
      </span>
    );
  };

  // Don't render anything if pitch accent is not enabled
  return (
    <Show when={isEnabled()} fallback={
      mode() === 'overlay'
        ? <span class={`prosody-overlay-wrapper pitch-overlay-wrapper ${props.class || ''}`} style={props.style}>{props.children}</span>
        : null
    }>
      {mode() === 'pill' ? renderPill() :
       mode() === 'preview' ? renderPreview() :
       renderOverlay()}
    </Show>
  );
};

export default JapanesePitchAccentOverlay;
