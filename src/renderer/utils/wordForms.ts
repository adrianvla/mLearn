import type { LanguageData, Token } from '../../shared/types';
import { getDictionaryLookupCandidates, type LanguageTokenizerCapabilities } from '../../shared/languageFeatures';

export { getWordFormCandidates, type WordFormCandidateOptions } from '../../shared/utils/wordForms';

type WordFormSource = Pick<Token, 'word' | 'actual_word' | 'surface' | 'reading'>;
type TokenMorphologyCapabilities = Pick<LanguageTokenizerCapabilities, 'providesLemmas'>;

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

function appendUnique(candidates: string[], seen: Set<string>, value: string | null | undefined): void {
  const normalized = value?.trim();
  if (!normalized || seen.has(normalized)) return;
  seen.add(normalized);
  candidates.push(normalized);
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
    language?: string;
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
    for (const lookupCandidate of getDictionaryLookupCandidates(seed ?? '', options.languageData, options.language)) {
      appendExpandedWordForms(candidates, seen, lookupCandidate, getCanonicalForm, getWordVariants);
    }
  }

  return candidates;
}
