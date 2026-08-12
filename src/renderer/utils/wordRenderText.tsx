import type { JSX } from 'solid-js';
import type { WordStatus } from '../../shared/constants';
import { DEFAULT_SETTINGS, type LanguageData, type Settings } from '../../shared/types';
import { coloredProsodyAllowedOnSurface } from '../../shared/prosodySettings';
import type { WordWithReadingRenderTextOptions } from '../components/language-specific/WordWithReading';
import {
  buildColoredProsodySegments,
  coloredProsodyAllowsStatus,
  getColoredProsodyConfig,
  getColoredProsodyPalette,
  resolveColoredProsodyStyle,
} from './coloredProsody';

export interface WordRenderTextContext {
  languageData: () => LanguageData | null | undefined;
  prosodyPosition: () => number | null | undefined;
  ease: () => number | undefined;
  partOfSpeechColor: () => string | undefined;
  status: () => WordStatus;
  isKnown: () => boolean;
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
    if (!(settings.colorKnownWords ?? DEFAULT_SETTINGS.colorKnownWords) && ctx.isKnown()) {
      return <span class={options.class} style={options.style}>{text}</span>;
    }
    if (!coloredProsodyAllowsStatus(ctx.status(), statusLimit)) {
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
                ctx.ease(),
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