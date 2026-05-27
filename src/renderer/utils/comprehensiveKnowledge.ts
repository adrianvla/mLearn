import { type WordStatus } from '../../shared/constants';
import type { Flashcard, IgnoredWordEntry, PassiveWordKnowledge } from '../../shared/types';

export interface ComprehensiveKnowledgeDeps {
  getCanonicalForm: (word: string) => string;
  hashWordSync: (word: string) => string;
  langKey: (language: string, hash: string) => string;
  language: string;
  knownUntracked: Record<string, boolean>;
  ignoredWords: Record<string, IgnoredWordEntry>;
  wordKnowledge: Record<string, PassiveWordKnowledge>;
  knownEaseThreshold: number;
  learningThreshold: number;
  getCardByWordSync: (word: string) => Flashcard | null;
}

/**
 * Comprehensive synchronous word status check.
 * A word is "known" if ANY knowledge bank marks it as known (OR logic).
 * Checks: knownUntracked, ignoredWords, SRS flashcards, passive ease.
 */
export function getComprehensiveWordStatus(
  word: string,
  deps: ComprehensiveKnowledgeDeps
): WordStatus {
  const canonical = deps.getCanonicalForm(word);
  const wordHash = deps.hashWordSync(canonical);
  const lk = deps.langKey(deps.language, wordHash);

  // 1. Manually marked as known
  if (deps.knownUntracked[lk]) {
    return 'known';
  }

  // 2. Ignored words are treated as known (user doesn't want to see them)
  if (deps.ignoredWords[lk]) {
    return 'known';
  }

  // 3. SRS flashcard state
  const card = deps.getCardByWordSync(word);
  if (card) {
    if (card.state === 'review') {
      return 'known';
    }
    if (card.state === 'learning' || card.state === 'relearning') {
      return 'learning';
    }
  }

  // 4. Passive tracking ease
  const knowledge = deps.wordKnowledge[lk];
  if (knowledge) {
    if (knowledge.ease >= deps.knownEaseThreshold) {
      return 'known';
    }
    if (knowledge.ease >= deps.learningThreshold) {
      return 'learning';
    }
  }

  return 'unknown';
}

/**
 * Shorthand: is the word known by any knowledge bank?
 */
export function isWordKnownComprehensive(
  word: string,
  deps: ComprehensiveKnowledgeDeps
): boolean {
  return getComprehensiveWordStatus(word, deps) === 'known';
}
