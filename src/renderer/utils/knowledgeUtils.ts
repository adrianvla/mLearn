import type { Flashcard, FlashcardStore, PassiveWordKnowledge, IgnoredWordEntry } from '../../shared/types';

import { DEFAULT_SETTINGS } from '../../shared/types';
import { getEffectiveWordStateForKeys } from './comprehensiveKnowledge';

/** Index canonical lexical state; card ownership and legacy markers are not evidence. */
export function buildKnownWordSet(
  _flashcards: Record<string, Flashcard>,
  _wordToCardMap: Record<string, string[]>,
  _knownUntracked: Record<string, boolean>,
  _ignoredWords: Record<string, IgnoredWordEntry>,
  wordKnowledge: Record<string, PassiveWordKnowledge>,
  knownEaseThreshold: number,
  keysForEntry?: (key: string, entry: PassiveWordKnowledge) => readonly string[],
): Set<string> {
  const known = new Set<string>();
  for (const lk of Object.keys(wordKnowledge)) {
    if (getEffectiveWordStateForKeys(keysForEntry?.(lk, wordKnowledge[lk]) ?? [lk], wordKnowledge, {
      known: knownEaseThreshold / 1000, learning: DEFAULT_SETTINGS.easeThresholdLearning,
    }).status === 'known') known.add(lk);
  }

  return known;
}

/**
 * Quick check if a language-prefixed word key is known using a pre-built Set.
 * Falls back to individual store checks (same Tier-2 rule as the Set builder)
 * for keys not in the Set.
 */
export function isWordKnown(
  lk: string,
  knownSet: Set<string>,
  wordKnowledge: Record<string, PassiveWordKnowledge>,
  knownEaseThreshold: number,
): boolean {
  if (knownSet.has(lk)) return true;

  return getEffectiveWordStateForKeys([lk], wordKnowledge, {
    known: knownEaseThreshold / 1000, learning: DEFAULT_SETTINGS.easeThresholdLearning,
  }).status === 'known';
}

/**
 * Build a Set from the full FlashcardStore for convenience.
 */
export function buildKnownWordSetFromStore(
  store: FlashcardStore,
  knownEaseThreshold: number,
  keysForEntry?: (key: string, entry: PassiveWordKnowledge) => readonly string[],
): Set<string> {
  return buildKnownWordSet(
    store.flashcards,
    store.wordToCardMap,
    store.knownUntracked,
    store.ignoredWords,
    store.wordKnowledge,
    knownEaseThreshold,
    keysForEntry,
  );
}

export function buildTrackedWordSet(store: FlashcardStore, language: string): Set<string> {
  const tracked = new Set<string>();
  const prefix = language + ':';
  for (const lk of Object.keys(store.wordToCardMap)) if (lk.startsWith(prefix)) tracked.add(lk);
  // Tier-2: claim-bearing entries are a primary knowledge source and must
  // always stay tracked (the wordKnowledge scan below also covers them; kept
  // explicit so a claim can never regress to 'untracked').
  for (const [lk, knowledge] of Object.entries(store.wordKnowledge)) {
    if (lk.startsWith(prefix) && knowledge.claim !== undefined) tracked.add(lk);
  }
  for (const lk of Object.keys(store.wordKnowledge)) if (lk.startsWith(prefix)) tracked.add(lk);
  for (const lk of Object.keys(store.wordCandidates)) if (lk.startsWith(prefix)) tracked.add(lk);
  // Orphan legacy markers have neither a recoverable word nor canonical evidence.
  // The existing migration adds recoverable claims to wordKnowledge above.
  for (const lk of Object.keys(store.ignoredWords)) if (lk.startsWith(prefix)) tracked.add(lk);
  return tracked;
}