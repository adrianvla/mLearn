import type { LanguageData, Token } from '../../shared/types';
import {
  getDictionaryLookupCandidates,
  isReadingScriptText,
  type LanguageTokenizerCapabilities,
} from '../../shared/languageFeatures';

type WordFormSource = Pick<Token, 'word' | 'actual_word' | 'surface' | 'reading'>;
type TokenMorphologyCapabilities = Pick<LanguageTokenizerCapabilities, 'providesLemmas'>;

interface WordFormCandidateOptions {
  languageData?: LanguageData | null;
}

function appendUnique(candidates: string[], seen: Set<string>, value: string | null | undefined): void {
  const normalized = value?.trim();
  if (!normalized || seen.has(normalized)) return;
  seen.add(normalized);
  candidates.push(normalized);
}

function appendExpandedWordForms(
  candidates: string[],
  seen: Set<string>,
  word: string,
  getCanonicalForm: (word: string) => string,
  getWordVariants?: (word: string) => string[],
): void {
  if (!word) return;

  const variants = getWordVariants?.(word).filter(Boolean) ?? [];
  for (const variant of variants) {
    appendUnique(candidates, seen, variant);
  }

  const canonical = getCanonicalForm(word);
  appendUnique(candidates, seen, canonical);
  appendUnique(candidates, seen, word);
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
  const isReadingLookup = isReadingScriptText(word, options.languageData);

  if (isReadingLookup) {
    appendUnique(candidates, seen, word);
    for (const lookupCandidate of getDictionaryLookupCandidates(word, options.languageData)) {
      appendUnique(candidates, seen, lookupCandidate);
    }
  }

  if (getWordVariants) {
    const variants = getWordVariants(word).filter(Boolean);
    if (variants.length > 0) {
      for (const variant of variants) {
        appendUnique(candidates, seen, variant);
        for (const lookupCandidate of getDictionaryLookupCandidates(variant, options.languageData)) {
          appendUnique(candidates, seen, lookupCandidate);
        }
      }
      return candidates;
    }
  }

  const canonical = getCanonicalForm(word);
  if (!isReadingLookup) {
    appendUnique(candidates, seen, canonical && canonical !== word ? canonical : undefined);
    appendUnique(candidates, seen, word);
    for (const lookupCandidate of getDictionaryLookupCandidates(word, options.languageData)) {
      appendUnique(candidates, seen, lookupCandidate);
    }
  }
  if (canonical && canonical !== word) {
    for (const lookupCandidate of getDictionaryLookupCandidates(canonical, options.languageData)) {
      appendUnique(candidates, seen, lookupCandidate);
    }
  }
  return candidates;
}

export function getTokenLookupWord(
  token: WordFormSource,
  tokenizerCapabilities?: TokenMorphologyCapabilities,
): string {
  const surface = token.surface?.trim() || token.word?.trim() || '';
  const lemma = token.actual_word?.trim() || '';

  if (!lemma) return surface;
  if (!tokenizerCapabilities || tokenizerCapabilities.providesLemmas) return lemma;
  return surface || lemma;
}

export function getTokenWordFormCandidates(
  token: WordFormSource,
  getCanonicalForm: (word: string) => string,
  getWordVariants?: (word: string) => string[],
  options: {
    includeReading?: boolean;
    tokenizerCapabilities?: TokenMorphologyCapabilities;
    languageData?: LanguageData | null;
  } = {},
): string[] {
  const candidates: string[] = [];
  const seen = new Set<string>();
  const seeds = [
    getTokenLookupWord(token, options.tokenizerCapabilities),
    token.surface,
    token.word,
    options.includeReading ? token.reading : undefined,
  ];

  for (const seed of seeds) {
    appendExpandedWordForms(candidates, seen, seed ?? '', getCanonicalForm, getWordVariants);
    for (const lookupCandidate of getDictionaryLookupCandidates(seed ?? '', options.languageData)) {
      appendExpandedWordForms(candidates, seen, lookupCandidate, getCanonicalForm, getWordVariants);
    }
  }

  return candidates;
}
