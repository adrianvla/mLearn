import type { Flashcard, FlashcardStore, PassiveWordKnowledge, IgnoredWordEntry } from '../../shared/types';

/** Anki-bank status keys folded into the O(n) set builders (structural — produced by services/ankiWordsCache). */
export interface AnkiWordStatusKeys {
  known: ReadonlySet<string>;
  learning: ReadonlySet<string>;
}

/**
 * Builds a Set of language-prefixed word hashes that are considered "known"
 * based on all in-store knowledge sources. O(n) to build, O(1) to query.
 *
 * Sources checked:
 * - knownUntracked (manually marked as known)
 * - ignoredWords (user explicitly ignored)
 * - Flashcards in 'review' state (graduated via SRS)
 * - wordKnowledge with ease >= known_ease_threshold (passive tracking)
 * - anki bank keys, when supplied (the store itself has no anki knowledge)
 */
export function buildKnownWordSet(
  flashcards: Record<string, Flashcard>,
  wordToCardMap: Record<string, string[]>,
  knownUntracked: Record<string, boolean>,
  ignoredWords: Record<string, IgnoredWordEntry>,
  wordKnowledge: Record<string, PassiveWordKnowledge>,
  knownEaseThreshold: number,
  ankiKnownKeys?: ReadonlySet<string>,
): Set<string> {
  const known = new Set<string>(Object.keys(knownUntracked));
  for (const key of Object.keys(ignoredWords)) {
    known.add(key);
  }

  for (const [lk, cardIds] of Object.entries(wordToCardMap)) {
    for (const id of cardIds) {
      const card = flashcards[id];
      if (card && card.state === 'review') {
        known.add(lk);
        break;
      }
    }
  }

  const threshold = knownEaseThreshold / 1000;
  for (const [lk, knowledge] of Object.entries(wordKnowledge)) {
    if (knowledge.ease >= threshold) {
      known.add(lk);
    }
  }

  if (ankiKnownKeys) for (const lk of ankiKnownKeys) known.add(lk);

  return known;
}

/**
 * Quick check if a language-prefixed word key is known using a pre-built Set.
 * Falls back to individual store checks for keys not in the Set.
 */
export function isWordKnown(
  lk: string,
  knownSet: Set<string>,
  wordKnowledge: Record<string, PassiveWordKnowledge>,
  knownEaseThreshold: number,
): boolean {
  if (knownSet.has(lk)) return true;

  const knowledge = wordKnowledge[lk];
  if (knowledge && knowledge.ease >= knownEaseThreshold / 1000) return true;

  return false;
}

/**
 * Build a Set from the full FlashcardStore for convenience.
 */
export function buildKnownWordSetFromStore(
  store: FlashcardStore,
  knownEaseThreshold: number,
  ankiKnownKeys?: ReadonlySet<string>,
): Set<string> {
  return buildKnownWordSet(
    store.flashcards,
    store.wordToCardMap,
    store.knownUntracked,
    store.ignoredWords,
    store.wordKnowledge,
    knownEaseThreshold,
    ankiKnownKeys,
  );
}

export function buildTrackedWordSet(store: FlashcardStore, language: string, ankiKeys?: AnkiWordStatusKeys): Set<string> {
  const tracked = new Set<string>();
  const prefix = language + ':';
  for (const lk of Object.keys(store.wordToCardMap)) if (lk.startsWith(prefix)) tracked.add(lk);
  for (const lk of Object.keys(store.wordKnowledge)) if (lk.startsWith(prefix)) tracked.add(lk);
  for (const lk of Object.keys(store.wordCandidates)) if (lk.startsWith(prefix)) tracked.add(lk);
  for (const lk of Object.keys(store.knownUntracked)) if (lk.startsWith(prefix)) tracked.add(lk);
  for (const lk of Object.keys(store.ignoredWords)) if (lk.startsWith(prefix)) tracked.add(lk);
  if (ankiKeys) {
    for (const lk of ankiKeys.known) if (lk.startsWith(prefix)) tracked.add(lk);
    for (const lk of ankiKeys.learning) if (lk.startsWith(prefix)) tracked.add(lk);
  }
  return tracked;
}
