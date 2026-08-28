import type { JSX } from 'solid-js';
import { DEFAULT_SETTINGS, type FlashcardProsody, type LanguageData, type Settings } from '../../shared/types';
import { coloredProsodyAllowedOnSurface } from '../../shared/prosodySettings';
import { ProsodyOverlay } from '../components/language-specific/ProsodyOverlay';
import type { WordWithReadingRenderTextOptions } from '../components/language-specific/WordWithReading';
import { getProsodyOverlayTextTarget } from './prosodyOverlayTarget';
import {
  buildColoredProsodySegments,
  coloredProsodyAllowsStatus,
  getColoredProsodyFadeStrength,
  getColoredProsodyConfig,
  getColoredProsodyPalette,
  resolveColoredProsodyStyle,
} from './coloredProsody';
import type { ColoredProsodyKnowledge } from './coloredProsody';

export interface WordRenderTextContext {
  languageData: () => LanguageData | null | undefined;
  prosodyPosition: () => number | null | undefined;
  prosodyKnowledge: () => ColoredProsodyKnowledge;
  partOfSpeechColor: () => string | undefined;
  surface: 'subtitle' | 'other';
  settings: () => Settings;
}

export function createWordRenderText(
  ctx: WordRenderTextContext,
): (text: JSX.Element, options: WordWithReadingRenderTextOptions) => JSX.Element {
  return (text, options) => {
    const settings = ctx.settings();
    const config = getColoredProsodyConfig(ctx.languageData());
    const enabled = settings.coloredProsodyEnabled ?? DEFAULT_SETTINGS.coloredProsodyEnabled;
    const statusLimit = settings.coloredProsodyStatusLimit ?? DEFAULT_SETTINGS.coloredProsodyStatusLimit;
    const coloringEnabled = settings.enableWordColoring ?? DEFAULT_SETTINGS.enableWordColoring;
    if (!coloredProsodyAllowedOnSurface(settings, ctx.surface)) {
      return <span class={options.class} style={options.style}>{text}</span>;
    }
    if (!config || !enabled || !coloringEnabled) {
      return <span class={options.class} style={options.style}>{text}</span>;
    }
    const prosodyKnowledge = ctx.prosodyKnowledge();
    if (!coloredProsodyAllowsStatus(prosodyKnowledge.status, statusLimit)) {
      return <span class={options.class} style={options.style}>{text}</span>;
    }

    const displayText = typeof text === 'string'
      ? text
      : options.slot === 'reading'
        ? options.displayReading
        : options.word;
    const segments = buildColoredProsodySegments(config, {
      text: displayText,
      word: options.word,
      reading: options.reading,
      slot: options.slot,
      prosodyPosition: ctx.prosodyPosition(),
    });
    if (!segments?.some((segment) => segment.paletteKey)) {
      return <span class={options.class} style={options.style}>{text}</span>;
    }

    const palette = getColoredProsodyPalette(settings, config);
    return (
      <span class={options.class} style={options.style}>
        {segments.map((segment) => {
          const color = segment.paletteKey ? palette[segment.paletteKey] : undefined;
          return color ? (
            <span
              class="colored-prosody__segment"
              data-prosody-value={segment.paletteKey}
              style={resolveColoredProsodyStyle(
                color,
                settings,
                getColoredProsodyFadeStrength(prosodyKnowledge),
                ctx.partOfSpeechColor(),
              )}
            >
              {segment.text}
            </span>
          ) : segment.text;
        })}
      </span>
    );
  };
}

/**
 * Data driving the per-mora prosody overlay on a word+reading surface.
 * Resolution/gating of the values stays in the surface; the composition rule
 * (which slots may carry the overlay) lives in applyWordDecorations.
 */
export interface WordProsodyOverlayData {
  /** Explicit pitch position. A function is resolved against the target slot reading. */
  position?: number | null | ((reading: string) => number | null | undefined);
  /** Explicit prosody type. A function is resolved against the target slot reading. */
  type?: FlashcardProsody['type'] | ((reading: string) => FlashcardProsody['type'] | undefined);
  pos?: string;
  nextPos?: string;
  homogenous?: boolean;
  showParticleBox?: boolean;
  allowStoredProsodyWithoutMetadata?: boolean;
  /** Override the overlay `word` prop for the reading slot (e.g. subtitle surfaces pass the surface headword). */
  overlayWordForReadingSlot?: string;
  /** Override the surface reading used to resolve the overlay target. */
  surfaceReading?: string;
}

/**
 * Applies word-level decorations (colored prosody text, then per-mora prosody
 * overlay) to a single word/reading slot. The overlay is skipped for slots
 * marked suppressOverlay (the ruby word base — per-mora geometry misaligns on
 * kanji glyphs). This is THE single enforcement point of that rule; surfaces
 * pass decoration data, never callbacks.
 */
export function applyWordDecorations(
  text: JSX.Element,
  options: WordWithReadingRenderTextOptions,
  decorations: {
    coloredProsody?: WordRenderTextContext | null;
    prosodyOverlay?: WordProsodyOverlayData | null;
    surfaceWord: string;
    surfaceReading: string | null | undefined;
  },
): JSX.Element {
  let node: JSX.Element = text;
  if (decorations.coloredProsody) {
    node = createWordRenderText(decorations.coloredProsody)(node, options);
  }
  const overlay = decorations.prosodyOverlay;
  if (overlay && !options.suppressOverlay) {
    const target = getProsodyOverlayTextTarget(
      decorations.surfaceWord,
      overlay.surfaceReading ?? decorations.surfaceReading,
      options,
    );
    const overlayWord = options.slot === 'reading'
      ? (overlay.overlayWordForReadingSlot ?? target.word)
      : target.word;
    const position = typeof overlay.position === 'function' ? overlay.position(target.reading) : overlay.position;
    const type = typeof overlay.type === 'function' ? overlay.type(target.reading) : overlay.type;
    node = (
      <ProsodyOverlay
        word={overlayWord}
        reading={target.reading}
        prosodyPosition={position}
        prosodyType={type}
        language={options.language}
        languageData={options.languageData}
        pos={overlay.pos}
        nextPos={overlay.nextPos}
        mode="overlay"
        homogenous={overlay.homogenous}
        showParticleBox={overlay.showParticleBox}
        allowStoredProsodyWithoutMetadata={overlay.allowStoredProsodyWithoutMetadata}
        isReadingScript={options.isReadingScript}
        class={options.slot === 'reading' ? 'prosody-overlay-wrapper--reading' : options.class}
        style={options.style}
      >
        {node}
      </ProsodyOverlay>
    );
  } else if (!decorations.coloredProsody) {
    // createWordRenderText already wraps colored slots; only wrap plain ones.
    node = (
      <span class={options.class} style={options.style}>
        {node}
      </span>
    );
  }
  return node;
}
