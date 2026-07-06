import { type WordStatus, type KnowledgeSource, type KnowledgeResolutionMode, KNOWLEDGE_SOURCE_DISPLAY_NAMES, type WordKnowledgeSource } from '../../shared/constants';
import type { Flashcard, IgnoredWordEntry, PassiveWordKnowledge } from '../../shared/types';

const STATUS_RANK: Record<WordStatus, number> = { unknown: 0, learning: 1, known: 2 };

const SOURCE_NONE: WordKnowledgeSource = 'None';

export interface ComprehensiveKnowledgeDeps {
  getCanonicalForm: (word: string) => string;
  getWordForms?: (word: string) => string[];
  hashWordSync: (word: string) => string;
  langKey: (language: string, hash: string) => string;
  language: string;
  knownUntracked: Record<string, boolean>;
  ignoredWords: Record<string, IgnoredWordEntry>;
  wordKnowledge: Record<string, PassiveWordKnowledge>;
  knownEaseThreshold: number;
  learningThreshold: number;
  getCardByWordSync: (word: string) => Flashcard | null;
  ankiStatus: WordStatus | null;
  sourceOrder: readonly KnowledgeSource[];
  resolutionMode: KnowledgeResolutionMode;
}

export interface ComprehensiveWordStatusResult {
  status: WordStatus;
  source: WordKnowledgeSource;
  timesSeen: number;
  matchedWord?: string;
}

interface SourceResult {
  source: KnowledgeSource;
  status: WordStatus;
  timesSeen: number;
  matchedWord?: string;
}

interface WordFormMatch {
  word: string;
  lk: string;
}

function buildWordFormMatches(word: string, deps: ComprehensiveKnowledgeDeps): WordFormMatch[] {
  const forms = deps.getWordForms?.(word) ?? (() => {
    const canonical = deps.getCanonicalForm(word);
    return canonical && canonical !== word ? [canonical, word] : [word];
  })();
  const matches: WordFormMatch[] = [];
  const seen = new Set<string>();

  for (const form of forms) {
    const normalized = form.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    matches.push({
      word: normalized,
      lk: deps.langKey(deps.language, deps.hashWordSync(normalized)),
    });
  }

  return matches;
}

function getStatusFromSource(
  src: KnowledgeSource,
  matches: readonly WordFormMatch[],
  deps: ComprehensiveKnowledgeDeps
): SourceResult | null {
  switch (src) {
    case 'knownWordsList': {
      for (const match of matches) {
        if (deps.knownUntracked[match.lk]) {
          return { source: src, status: 'known', timesSeen: 0, matchedWord: match.word };
        }
      }
      return null;
    }
    case 'ignoredWords': {
      for (const match of matches) {
        if (deps.ignoredWords[match.lk]) {
          return { source: src, status: 'known', timesSeen: 0, matchedWord: match.word };
        }
      }
      return null;
    }
    case 'srs': {
      for (const match of matches) {
        const card = deps.getCardByWordSync(match.word);
        if (card) {
          if (card.state === 'review') {
            return { source: src, status: 'known', timesSeen: 0, matchedWord: match.word };
          }
          if (card.state === 'learning' || card.state === 'relearning') {
            return { source: src, status: 'learning', timesSeen: 0, matchedWord: match.word };
          }
        }
      }
      return null;
    }
    case 'anki': {
      if (deps.ankiStatus && deps.ankiStatus !== 'unknown') {
        return { source: src, status: deps.ankiStatus, timesSeen: 0 };
      }
      return null;
    }
    case 'passiveTracking': {
      for (const match of matches) {
        const knowledge = deps.wordKnowledge[match.lk];
        if (knowledge) {
          if (knowledge.ease >= deps.knownEaseThreshold) {
            return { source: src, status: 'known', timesSeen: knowledge.timesSeen, matchedWord: match.word };
          }
          if (knowledge.ease >= deps.learningThreshold) {
            return { source: src, status: 'learning', timesSeen: knowledge.timesSeen, matchedWord: match.word };
          }
        }
      }
      return null;
    }
    default:
      return null;
  }
}

function resolveSources(
  available: SourceResult[],
  resolutionMode: KnowledgeResolutionMode
): ComprehensiveWordStatusResult {
  if (available.length === 0) {
    return { status: 'unknown', source: SOURCE_NONE, timesSeen: 0 };
  }

  switch (resolutionMode) {
    case 'order': {
      const winner = available[0];
      return { status: winner.status, source: KNOWLEDGE_SOURCE_DISPLAY_NAMES[winner.source], timesSeen: winner.timesSeen, matchedWord: winner.matchedWord };
    }
    case 'highest': {
      const maxRank = Math.max(...available.map(a => STATUS_RANK[a.status]));
      const winners = available.filter(a => STATUS_RANK[a.status] === maxRank);
      return { status: winners[0].status, source: KNOWLEDGE_SOURCE_DISPLAY_NAMES[winners[0].source], timesSeen: winners[0].timesSeen, matchedWord: winners[0].matchedWord };
    }
    case 'lowest': {
      const minRank = Math.min(...available.map(a => STATUS_RANK[a.status]));
      const losers = available.filter(a => STATUS_RANK[a.status] === minRank);
      return { status: losers[0].status, source: KNOWLEDGE_SOURCE_DISPLAY_NAMES[losers[0].source], timesSeen: losers[0].timesSeen, matchedWord: losers[0].matchedWord };
    }
  }
}

/**
 * Comprehensive synchronous word status check with source attribution.
 * Checks sources in the configured order and applies the configured resolution mode.
 */
export function getComprehensiveWordStatusWithSource(
  word: string,
  deps: ComprehensiveKnowledgeDeps
): ComprehensiveWordStatusResult {
  const matches = buildWordFormMatches(word, deps);

  const available: SourceResult[] = [];

  for (const src of deps.sourceOrder) {
    // DEPRECATED (v2.0 migration): 'manual' was the old name for passiveTracking.
    // Remove this mapping after all active users have migrated (safe to remove ~2026-12).
    const mappedSrc = (src as string) === 'manual' ? 'passiveTracking' : src;
    const result = getStatusFromSource(mappedSrc as KnowledgeSource, matches, deps);
    if (result !== null) {
      available.push(result);
    }
  }

  return resolveSources(available, deps.resolutionMode);
}

/**
 * Comprehensive synchronous word status check.
 */
export function getComprehensiveWordStatus(
  word: string,
  deps: ComprehensiveKnowledgeDeps
): WordStatus {
  return getComprehensiveWordStatusWithSource(word, deps).status;
}

/**
 * Shorthand: is the word known by any knowledge bank?
 */
export function isWordKnownComprehensive(
  word: string,
  deps: ComprehensiveKnowledgeDeps
): boolean {
  return getComprehensiveWordStatusWithSource(word, deps).status === 'known';
}
