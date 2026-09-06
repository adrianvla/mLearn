/**
 * Shared, pure primary word-form derivation.
 *
 * This is the EXACT pipeline used when persisted keys are created (renderer
 * FlashcardContext: `getWordFormCandidates(...)[0]`, hashed with SHA-256 and
 * prefixed with the language code). Electron storage (flashcardStorage) and
 * sync merge (flashcardSyncService) must reproduce it byte-identically when
 * rebuilding persisted keys under a new normalization version — a raw-front
 * hash would orphan cards whose packages declare casing, mapping, or
 * reading-based lexeme normalization.
 *
 * Everything here is language/data-dependent and pure: no renderer, DOM, or
 * Electron imports. Renderer-only token/UI helpers stay in
 * `src/renderer/utils/wordForms.ts`.
 */

import type { LanguageData, WordFrequencyMap } from '../types';
import {
  applyMappingTableNormalizer,
  buildLexemeIndex,
  getCanonicalLexeme,
  getDictionaryLookupCandidates,
  getFrequencyLevelLabel,
  getLexemeVariants,
  isDisplayableFrequencyLevel,
  resolveLanguageFrequencyPayload,
  sortFrequencyLevelsByDifficulty,
  type LanguageLexemeIndex,
} from '../languageFeatures';
import { declaresScriptConversion } from './canonicalWordKey';
export interface WordFormCandidateOptions {
  languageData?: LanguageData | null;
  /** Language code, required for package mapping-table normalizer steps to apply. */
  language?: string;
}

function appendUnique(candidates: string[], seen: Set<string>, value: string | null | undefined): void {
  const normalized = value?.trim();
  if (!normalized || seen.has(normalized)) return;
  seen.add(normalized);
  candidates.push(normalized);
}

export function getWordFormCandidates(
  word: string,
  getCanonicalForm: (word: string) => string,
  getWordVariants?: (word: string) => string[],
  options: WordFormCandidateOptions = {},
): string[] {
  if (!word) return [];

  const candidates: string[] = [];
  const seen = new Set<string>();
  // Package-declared script conversion (e.g. zh-Hant → zh-Hans) folds the
  // surface BEFORE canonical resolution so one word identity spans scripts —
  // the same normalization canonicalKeyHash applies to persisted keys. Applied
  // here (not only at merge/migration time) so card creation, the storage
  // rebuild, and sync merge cannot mint different identities for the same word.
  const mapped = options.languageData && options.language && declaresScriptConversion(options.languageData)
    ? applyMappingTableNormalizer(word, options.language)
    : word;
  const canonical = getCanonicalForm(mapped);

  // PRIMARY FORM (load-bearing): the package-declared canonical form when it
  // differs from the raw surface, else the raw word. Flashcard key derivation
  // hashes candidates[0], so the canonical form is the persisted primary form
  // and every consumer — card creation, the zh variant migration, sync merge,
  // and the normalization-version rebuild — shares ONE word identity per
  // package. Everything after the raw word is lookup expansion only; candidate
  // ORDER below [0] is not semantic. Do not demote the canonical form without
  // re-deriving every persisted key (normalizationVersion bump + rebuild).
  appendUnique(candidates, seen, canonical && canonical !== word ? canonical : undefined);
  appendUnique(candidates, seen, word);
  for (const lookupCandidate of getDictionaryLookupCandidates(word, options.languageData, options.language)) {
    appendUnique(candidates, seen, lookupCandidate);
  }

  if (getWordVariants) {
    for (const variant of getWordVariants(word)) {
      appendUnique(candidates, seen, variant);
      for (const lookupCandidate of getDictionaryLookupCandidates(variant, options.languageData, options.language)) {
        appendUnique(candidates, seen, lookupCandidate);
      }
    }
  }

  if (canonical && canonical !== word) {
    for (const lookupCandidate of getDictionaryLookupCandidates(canonical, options.languageData, options.language)) {
      appendUnique(candidates, seen, lookupCandidate);
    }
  }
  return candidates;
}

export interface LanguageFrequencyState {
  frequency: WordFrequencyMap;
  lexemeIndex: LanguageLexemeIndex;
  /** Provider/level-system-resolved metadata; the ONLY language data downstream derivation may consult. */
  languageData: LanguageData | null;
}

/** Compute default frequency level boundaries by dividing evenly across configured levels. */
function defaultFreqBoundaries(totalEntries: number, levelCount = 5): number[] {
  const safeLevelCount = Math.max(levelCount, 1);
  const step = Math.floor(totalEntries / safeLevelCount);
  return Array.from({ length: Math.max(safeLevelCount - 1, 0) }, (_, idx) => step * (idx + 1));
}

export function buildLanguageFrequencyState(
  langInfo: LanguageData | null | undefined,
  language?: string,
  providerId?: string,
  levelSystemId?: string,
): LanguageFrequencyState {
  const { rows: freq, languageData: effectiveLangInfo } = resolveLanguageFrequencyPayload(
    langInfo,
    providerId,
    levelSystemId,
  );

  if (freq.length === 0) {
    return {
      frequency: {},
      lexemeIndex: buildLexemeIndex(undefined, effectiveLangInfo, language),
      languageData: effectiveLangInfo ?? null,
    };
  }

  const freqMap: WordFrequencyMap = {};
  const levelNames = effectiveLangInfo?.frequencyLevels?.names || {};
  const hasDeclaredLevels = Object.keys(levelNames).length > 0;
  const levelsByDifficulty = sortFrequencyLevelsByDifficulty(
    hasDeclaredLevels ? Object.keys(levelNames).map(Number) : [],
    effectiveLangInfo,
  ).filter((level) => Number.isFinite(level));
  const rowLevelIndex = Number.isInteger(effectiveLangInfo?.frequencyLevels?.rowLevelIndex)
    && (effectiveLangInfo?.frequencyLevels?.rowLevelIndex ?? -1) >= 2
    ? effectiveLangInfo?.frequencyLevels?.rowLevelIndex
    : undefined;
  const boundaries = hasDeclaredLevels
    ? effectiveLangInfo?.frequencyLevels?.boundaries || defaultFreqBoundaries(freq.length, levelsByDifficulty.length)
    : [];

  for (let i = 0; i < freq.length; i++) {
    const entry = freq[i];
    if (!entry || entry.length < 2) continue;

    const rowLevel = rowLevelIndex !== undefined ? Number(entry[rowLevelIndex]) : Number.NaN;
    let level = Number.isFinite(rowLevel)
      ? rowLevel
      : levelsByDifficulty[levelsByDifficulty.length - 1] ?? -1;
    if (!Number.isFinite(rowLevel)) {
      for (let boundaryIndex = 0; boundaryIndex < boundaries.length; boundaryIndex += 1) {
        if (i <= boundaries[boundaryIndex]) {
          level = levelsByDifficulty[boundaryIndex] ?? level;
          break;
        }
      }
    }

    const levelName = isDisplayableFrequencyLevel(level, levelNames, effectiveLangInfo)
      ? getFrequencyLevelLabel(level, levelNames, effectiveLangInfo)
      : '';

    const existing = freqMap[entry[0]];
    if (existing) {
      if (!existing.alternateReadings) {
        existing.alternateReadings = [];
      }
      if (entry[1] !== existing.reading && !existing.alternateReadings.includes(entry[1])) {
        existing.alternateReadings.push(entry[1]);
      }
    } else {
      freqMap[entry[0]] = {
        reading: entry[1],
        level: levelName,
        raw_level: level,
      };
    }
  }

  return {
    frequency: freqMap,
    lexemeIndex: buildLexemeIndex(freq, effectiveLangInfo, language),
    languageData: effectiveLangInfo ?? null,
  };
}

export interface PrimaryWordFormDeps {
  frequency: WordFrequencyMap;
  lexemeIndex: LanguageLexemeIndex;
  languageData?: LanguageData | null;
  language?: string;
}

/**
 * The primary word form: the first candidate of the shared candidate pipeline.
 * Byte-identical to the renderer's `getWordFormCandidates(...)[0] ?? word`.
 */
export function derivePrimaryWordForm(word: string, deps: PrimaryWordFormDeps): string {
  return getWordFormCandidates(
    word,
    (value) => getCanonicalLexeme(value, deps.frequency, deps.lexemeIndex, deps.languageData, deps.language),
    (value) => getLexemeVariants(value, deps.frequency, deps.lexemeIndex, deps.languageData, deps.language),
    { languageData: deps.languageData, language: deps.language },
  )[0] ?? word;
}

/**
 * Build a primary-form deriver for one language from installed package data.
 * `frequencyProviderId`/`frequencyLevelSystemId` are the persisted settings
 * selections; the resulting effective metadata (not the raw package object)
 * feeds every derivation step, matching the renderer's per-language path.
 */
export function createWordFormDeriver(
  data: LanguageData | null | undefined,
  language: string,
  frequencyProviderId?: string,
  frequencyLevelSystemId?: string,
): (word: string) => string {
  const state = buildLanguageFrequencyState(data, language, frequencyProviderId, frequencyLevelSystemId);
  return (word: string) => derivePrimaryWordForm(word, {
    frequency: state.frequency,
    lexemeIndex: state.lexemeIndex,
    languageData: state.languageData,
    language,
  });
}
