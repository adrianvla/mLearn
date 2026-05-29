/**
 * PitchAccentOverlay - Unified pitch accent component
 * 
 * A single component that handles all pitch accent rendering across the app.
 * It can:
 * - Fetch pitch accent data from explicit props OR from translation cache
 * - Render as an inline overlay on children (subtitles, flashcards)
 * - Render as a pill (word hover)
 * - Render as a standalone preview (editors)
 * - Be grammar-aware (particle box based on POS and context)
 * - Only show when language supports pitch accent
 */

import { Component, JSX, Show, createMemo, createSignal, createEffect, children as resolveChildren } from 'solid-js';
import { useSettings, useLanguage } from '../../context';
import { buildPitchAccentHtml, getPitchAccentInfo, getMoraCount } from '../../utils/pitchAccent';
import { getCachedTranslation } from '../../hooks/useTranslation';
import { extractPitchPosition, extractReadingValue } from '../../utils/translationCacheParsers';
import { PillLabel } from '../common/Label';
import './PitchAccent.css';

export interface PitchAccentOverlayProps {
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
  /** Whether this is a kana-only word (no kanji). Auto-detected if not specified. */
  isKanaOnly?: boolean;
  /** Whether to show the particle box. Auto-determined from POS if not specified. */
  showParticleBox?: boolean;
  /** Use homogenous styling (no particle fade effect) */
  homogenous?: boolean;
  /** Part of speech label to display inside the pill (pill mode only) */
  posLabel?: string;
}

/** Extract pitch position from translation cache data */
function extractPitchFromCache(word: string, language?: string): number | null {
  const cached = getCachedTranslation(word, language);
  if (!cached?.data) return null;

  return extractPitchPosition(cached.data[2]);
}

/** Extract reading from translation cache data */
function extractReadingFromCache(word: string, language?: string): string | null {
  const cached = getCachedTranslation(word, language);
  return extractReadingValue(cached?.data);
}

/**
 * Check whether the given POS can take a following particle.
 * Returns false for verbs, i-adjectives, adverbs, conjunctions,
 * interjections, pre-noun adjectivals, and auxiliary verbs.
 */
function posCanTakeParticle(pos: string): boolean {
  if (!pos) return true;
  const p = pos.toLowerCase();
  // Japanese POS names
  if (p.includes('動詞') || p.includes('形容詞') || p.includes('副詞') ||
      p.includes('接続詞') || p.includes('感動詞') || p.includes('連体詞') ||
      p.includes('助動詞')) {
    return false;
  }
  // Romanised / English POS names
  if (p.includes('verb') || p.includes('adjective') || p.includes('adverb') ||
      p.includes('conjunction') || p.includes('interjection')) {
    return false;
  }
  return true;
}

/**
 * PitchAccentOverlay - Unified pitch accent component
 */
export const PitchAccentOverlay: Component<PitchAccentOverlayProps> = (props) => {
  const { settings } = useSettings();
  const { getLanguageFeatures } = useLanguage();

  // Resolve whether pitch accent should be shown at all
  const isEnabled = createMemo(() => {
    const features = getLanguageFeatures();
    return features.supportsPitchAccent && settings.showPitchAccent;
  });

  // For cache-based lookup, poll for data arrival
  const [cachedPitch, setCachedPitch] = createSignal<number | null>(null);
  const [cachedReading, setCachedReading] = createSignal<string | null>(null);

  createEffect(() => {
    const word = props.word;
    if (!isEnabled()) return;
    if (props.pitchPosition !== undefined && props.pitchPosition !== null) return;
    if (!word) return;

    setCachedPitch(null);
    setCachedReading(null);

    const checkCache = () => {
      const pitch = extractPitchFromCache(word, settings.language);
      if (pitch !== null) {
        setCachedPitch(pitch);
        const reading = extractReadingFromCache(word, settings.language);
        if (reading) setCachedReading(reading);
        return true;
      }
      return false;
    };

    if (checkCache()) return;

    let attempts = 0;
    const maxAttempts = 20;
    const timers: ReturnType<typeof setTimeout>[] = [];

    const clearAllTimers = () => {
      for (const t of timers) {
        clearTimeout(t);
      }
      timers.length = 0;
    };

    const poll = () => {
      if (checkCache()) {
        clearAllTimers();
        return;
      }
      attempts++;
      if (attempts < maxAttempts) {
        timers.push(setTimeout(poll, attempts < 10 ? 50 : 100));
      }
    };

    timers.push(setTimeout(poll, 50));

    return () => {
      clearAllTimers();
    };
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
    const moraCount = getMoraCount(reading);
    // Always show particle box for 1-mora words — without it the diagram is meaningless
    if (moraCount === 1) return true;
    const pos = props.pos || '';
    const nextPos = props.nextPos || '';
    // Suppress particle box for verbs followed by verbs (conjugation chain)
    if (pos && nextPos) {
      if (!posCanTakeParticle(pos) && !posCanTakeParticle(nextPos)) return false;
    }
    // Suppress for any POS that doesn't take a following particle
    if (pos && !posCanTakeParticle(pos)) return false;
    return true;
  });

  // Build the pitch accent HTML
  const pitchHtml = createMemo((): string => {
    if (!isEnabled()) return '';
    const pitch = effectivePitch();
    if (pitch === null) return '';
    const reading = effectiveReading();
    if (!reading) return '';

    const info = getPitchAccentInfo(pitch, reading);
    if (!info) return '';

    const isPill = (props.mode || 'overlay') === 'pill';
    const particleMargin = isPill ? 0 : undefined;
    return buildPitchAccentHtml(info, info.length, {
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
          <span class="mLearn-pitch-accent" aria-hidden="true" innerHTML={pitchHtml()} />
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
      <span class={`pitch-accent-preview ${props.class || ''}`}>
        <span class="pitch-accent-word">
          {effectiveReading()}
          <span class="mLearn-pitch-accent" aria-hidden="true" innerHTML={pitchHtml()} />
        </span>
      </span>
    </Show>
  );

  // Overlay mode: render children with pitch accent overlaid
  const renderOverlay = () => {
    const resolved = resolveChildren(() => props.children);
    return (
      <span class={`pitch-overlay-wrapper ${props.class || ''}`}>
        {resolved()}
        <Show when={pitchHtml()}>
          <span class="mLearn-pitch-accent" aria-hidden="true" innerHTML={pitchHtml()} />
        </Show>
      </span>
    );
  };

  // Don't render anything if pitch accent is not enabled
  return (
    <Show when={isEnabled()} fallback={
      mode() === 'overlay' ? <>{props.children}</> : null
    }>
      {mode() === 'pill' ? renderPill() :
       mode() === 'preview' ? renderPreview() :
       renderOverlay()}
    </Show>
  );
};

export default PitchAccentOverlay;
