import type { JSX } from 'solid-js';
import type { WordStatus } from '../../shared/constants';
import { statusToStrength } from '../../shared/utils/knowledgeStrength';
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

/** Effective state of the prosodic-pattern target — claim-overrides-evidence as
 *  resolved by getAspectStatus(word, 'prosody'). Never the word's combined status. */
export interface ColoredProsodyKnowledge {
  status: WordStatus;
  /** Aspect-record ease (mirrors the aspect read); the fade keys off status classification, never ease. */
  ease: number;
  untracked?: boolean;
  /** Exclusions settle word selection; they are not prosody knowledge. */
  excluded?: boolean;
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

interface ColoredProsodyRendererEntry {
  render: ColoredProsodyRenderer;
  /** True when the renderer needs a dictionary-provided prosody position. */
  needsProsodyPosition: boolean;
}

const COLOR_RENDERERS: Record<string, ColoredProsodyRendererEntry> = {
  'tone-marked-syllables': { render: toneMarkedSyllablesRenderer, needsProsodyPosition: false },
  'pitch-accent-category': { render: pitchAccentCategoryRenderer, needsProsodyPosition: true },
};

export function getColoredProsodyConfig(data?: LanguageData | null): LanguageColoredProsodyConfig | null {
  const config = data?.prosody?.coloring;
  return config && COLOR_RENDERERS[config.renderer] ? config : null;
}

export function coloredProsodyNeedsDictionaryLookup(config: LanguageColoredProsodyConfig): boolean {
  return COLOR_RENDERERS[config.renderer]?.needsProsodyPosition ?? false;
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
  return COLOR_RENDERERS[config.renderer]?.render?.(input) ?? null;
}

export function coloredProsodyAllowsStatus(status: WordStatus, limit: Settings['coloredProsodyStatusLimit']): boolean {
  const ranks: Record<WordStatus, number> = { unknown: 0, learning: 1, known: 2 };
  return ranks[status] <= ranks[limit ?? DEFAULT_SETTINGS.coloredProsodyStatusLimit];
}

/**
 * Fade only from demonstrated mastery of the prosodic-pattern target. The
 * decision keys off the aspect-specific effective status classification
 * (claim or evidence) — never the stored ease, which for claim records is
 * seeded from the word entry and would leak word-level knowledge into the
 * scaffold. Unmeasured targets (no record) and predicted estimates are not
 * demonstrated mastery: they keep the full scaffold (no fade).
 */
export function getColoredProsodyFadeStrength(
  knowledge: ColoredProsodyKnowledge,
): number {
  if (knowledge.excluded) return 0;
  if (knowledge.untracked) return 0;
  return statusToStrength(knowledge.status);
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
  fadeStrength: number,
  partOfSpeechColor: string | undefined,
): JSX.CSSProperties {
  const parsed = parseHexColor(color);
  if (!parsed) return { color };

  const saturated = applySaturation(
    parsed,
    settings.coloredProsodySaturation ?? DEFAULT_SETTINGS.coloredProsodySaturation,
  );
  if (!(settings.coloredProsodyEaseMixEnabled ?? DEFAULT_SETTINGS.coloredProsodyEaseMixEnabled)) {
    return { color: toHexColor(saturated) };
  }

  const targetSetting = settings.coloredProsodyEaseMixTarget ?? DEFAULT_SETTINGS.coloredProsodyEaseMixTarget;
  const targetColor = targetSetting === 'part-of-speech' ? partOfSpeechColor : '#ffffff';
  const target = parseHexColor(targetColor ?? '#ffffff') ?? parseHexColor('#ffffff')!;
  return { color: toHexColor(mixColors(saturated, target, Math.max(0, Math.min(1, fadeStrength)) * 0.82)) };
}
