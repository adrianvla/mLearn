import type { LanguageData, LevelPercentageEntry } from '../../shared/types';
import {
  getFrequencyLevelLabel,
  getGrammarLevelLabel,
  isDisplayableFrequencyLevel,
  sortFrequencyLevelsForDisplay,
  sortGrammarLevelsForDisplay,
} from '../../shared/languageFeatures';

type LevelNames = Record<string | number, string>;

function isValidLevel(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function getNamedLevels(levelNames: LevelNames | undefined): number[] {
  return Object.keys(levelNames ?? {}).map(Number).filter(isValidLevel);
}

function getEntryLevels(entries: readonly LevelPercentageEntry[] | undefined): number[] {
  return (entries ?? []).map((entry) => entry.level).filter(isValidLevel);
}

function getFrequencyEntryLevels(
  entries: readonly LevelPercentageEntry[] | undefined,
  levelNames: LevelNames | undefined,
  languageData?: LanguageData | null,
): number[] {
  return getEntryLevels(entries).filter((level) => isDisplayableFrequencyLevel(level, levelNames, languageData));
}

export function formatFrequencyLevelLabel(
  level: number | null | undefined,
  levelNames?: LevelNames,
  languageData?: LanguageData | null,
): string {
  if (!isValidLevel(level)) return '';
  if (!isDisplayableFrequencyLevel(level, levelNames, languageData)) return '';
  return getFrequencyLevelLabel(level, levelNames, languageData);
}

export function formatGrammarLevelLabel(
  level: number | null | undefined,
  levelNames?: LevelNames,
  languageData?: LanguageData | null,
): string {
  if (!isValidLevel(level)) return '';
  return getGrammarLevelLabel(level, levelNames, languageData);
}

export function getFrequencyFilterLevels(
  levelNames?: LevelNames,
  entries?: readonly LevelPercentageEntry[],
  languageData?: LanguageData | null,
): number[] {
  return sortFrequencyLevelsForDisplay(
    Array.from(new Set([
      ...getNamedLevels(levelNames).filter((level) => isDisplayableFrequencyLevel(level, levelNames, languageData)),
      ...getFrequencyEntryLevels(entries, levelNames, languageData),
    ])),
    languageData,
  );
}

export function getGrammarFilterLevels(
  levelNames?: LevelNames,
  entries?: readonly LevelPercentageEntry[],
  languageData?: LanguageData | null,
): number[] {
  return sortGrammarLevelsForDisplay(
    Array.from(new Set([...getNamedLevels(levelNames), ...getEntryLevels(entries)])),
    languageData,
  );
}
