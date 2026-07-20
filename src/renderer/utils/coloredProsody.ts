import type { JSX } from 'solid-js';
import type { WordStatus } from '../../shared/constants';
import {
  DEFAULT_SETTINGS,
  type LanguageColoredProsodyConfig,
  type LanguageData,
  type Settings,
} from '../../shared/types';
import { getJapanesePitchAccentCategoryForReading } from './japanesePitchAccent';

export interface ColoredProsodySegment {
  text: string;
  paletteKey?: string;
}

export interface ColoredProsodyRenderInput {
  text: string;
  word: string;
  reading: string;
  slot: 'word' | 'reading';
  prosodyPosition?: number | null;
}

type ColoredProsodyRenderer = (input: ColoredProsodyRenderInput) => ColoredProsodySegment[] | null;

const TONE_MARKS: Record<string, string> = {
  'tone-1': 'āēīōūǖĀĒĪŌŪǕ',
  'tone-2': 'áéíóúǘḿńÁÉÍÓÚǗḾŃ',
  'tone-3': 'ǎěǐǒǔǚňǍĚǏǑǓǙŇ',
  'tone-4': 'àèìòùǜǹÀÈÌÒÙǛǸ',
};

function tonePaletteKey(syllable: string): string | undefined {
  const trimmed = syllable.trim();
  if (!trimmed || !/\p{L}/u.test(trimmed)) return undefined;
  const numericTone = trimmed.match(/([0-5])$/)?.[1];
  if (numericTone && numericTone !== '0' && numericTone !== '5') return `tone-${numericTone}`;
  for (const [key, marks] of Object.entries(TONE_MARKS)) {
    if ([...trimmed].some((character) => marks.includes(character))) return key;
  }
  return 'neutral';
}

const toneMarkedSyllablesRenderer: ColoredProsodyRenderer = (input) => {
  const syllables = input.reading.trim().split(/\s+/u).filter(Boolean);
  if (input.slot === 'word') {
    const characters = [...input.text];
    if (characters.length !== syllables.length) return null;
    return characters.map((text, index) => ({ text, paletteKey: tonePaletteKey(syllables[index]) }));
  }

  let syllableIndex = 0;
  return input.text.split(/(\s+)/u).filter((text) => text.length > 0).map((text) => {
    if (/^\s+$/u.test(text)) return { text };
    const sourceSyllable = syllables[syllableIndex] ?? text;
    syllableIndex += 1;
    return { text, paletteKey: tonePaletteKey(sourceSyllable) };
  });
};

const pitchAccentCategoryRenderer: ColoredProsodyRenderer = (input) => {
  if (input.prosodyPosition === undefined || input.prosodyPosition === null || !input.reading) return null;
  const category = getJapanesePitchAccentCategoryForReading(input.prosodyPosition, input.reading);
  return category ? [{ text: input.text, paletteKey: category.type }] : null;
};

const COLOR_RENDERERS: Record<string, ColoredProsodyRenderer> = {
  'tone-marked-syllables': toneMarkedSyllablesRenderer,
  'pitch-accent-category': pitchAccentCategoryRenderer,
};

export function getColoredProsodyConfig(data?: LanguageData | null): LanguageColoredProsodyConfig | null {
  const config = data?.prosody?.coloring;
  return config && COLOR_RENDERERS[config.renderer] ? config : null;
}

export function getColoredProsodyPalette(
  settings: Pick<Settings, 'coloredProsodyPalettes'>,
  config: LanguageColoredProsodyConfig,
): Record<string, string> {
  return {
    ...config.colors,
    ...(settings.coloredProsodyPalettes ?? DEFAULT_SETTINGS.coloredProsodyPalettes)[config.paletteId],
  };
}

export function buildColoredProsodySegments(
  config: LanguageColoredProsodyConfig,
  input: ColoredProsodyRenderInput,
): ColoredProsodySegment[] | null {
  return COLOR_RENDERERS[config.renderer]?.(input) ?? null;
}

export function coloredProsodyAllowsStatus(status: WordStatus, limit: Settings['coloredProsodyStatusLimit']): boolean {
  const ranks: Record<WordStatus, number> = { unknown: 0, learning: 1, known: 2 };
  return ranks[status] <= ranks[limit ?? DEFAULT_SETTINGS.coloredProsodyStatusLimit];
}

interface RgbColor {
  red: number;
  green: number;
  blue: number;
}

function parseHexColor(color: string): RgbColor | null {
  const match = color.trim().match(/^#([\da-f]{3}|[\da-f]{6}|[\da-f]{8})$/iu);
  if (!match) return null;
  const hex = match[1].length === 3
    ? [...match[1]].map((character) => `${character}${character}`).join('')
    : match[1].slice(0, 6);
  return {
    red: Number.parseInt(hex.slice(0, 2), 16),
    green: Number.parseInt(hex.slice(2, 4), 16),
    blue: Number.parseInt(hex.slice(4, 6), 16),
  };
}

function toHexColor(color: RgbColor): string {
  const channel = (value: number) => Math.round(Math.max(0, Math.min(255, value))).toString(16).padStart(2, '0');
  return `#${channel(color.red)}${channel(color.green)}${channel(color.blue)}`;
}

function applySaturation(color: RgbColor, saturationPercent: number): RgbColor {
  const saturation = Math.max(0, Math.min(100, saturationPercent)) / 100;
  const luminance = 0.2126 * color.red + 0.7152 * color.green + 0.0722 * color.blue;
  return {
    red: luminance + (color.red - luminance) * saturation,
    green: luminance + (color.green - luminance) * saturation,
    blue: luminance + (color.blue - luminance) * saturation,
  };
}

function mixColors(source: RgbColor, target: RgbColor, amount: number): RgbColor {
  const mix = Math.max(0, Math.min(1, amount));
  return {
    red: source.red + (target.red - source.red) * mix,
    green: source.green + (target.green - source.green) * mix,
    blue: source.blue + (target.blue - source.blue) * mix,
  };
}

export function resolveColoredProsodyStyle(
  color: string,
  settings: Settings,
  ease: number | undefined,
  partOfSpeechColor: string | undefined,
): JSX.CSSProperties {
  const parsed = parseHexColor(color);
  if (!parsed) return { color };

  const saturated = applySaturation(
    parsed,
    settings.coloredProsodySaturation ?? DEFAULT_SETTINGS.coloredProsodySaturation,
  );
  if (!(settings.coloredProsodyEaseMixEnabled ?? DEFAULT_SETTINGS.coloredProsodyEaseMixEnabled) || ease === undefined) {
    return { color: toHexColor(saturated) };
  }

  const start = settings.easeThresholdLearning ?? DEFAULT_SETTINGS.easeThresholdLearning;
  const end = settings.easeThresholdMastered ?? DEFAULT_SETTINGS.easeThresholdMastered;
  const progress = end <= start ? 0 : Math.max(0, Math.min(1, (ease - start) / (end - start)));
  const targetSetting = settings.coloredProsodyEaseMixTarget ?? DEFAULT_SETTINGS.coloredProsodyEaseMixTarget;
  const targetColor = targetSetting === 'part-of-speech' ? partOfSpeechColor : '#ffffff';
  const target = parseHexColor(targetColor ?? '#ffffff') ?? parseHexColor('#ffffff')!;
  return { color: toHexColor(mixColors(saturated, target, progress * 0.82)) };
}
