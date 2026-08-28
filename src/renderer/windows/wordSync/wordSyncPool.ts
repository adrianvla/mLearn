import { SRS_EASE, WORD_STATUS } from '../../../shared/constants';
import { WORD_SYNC_STATUS_UNTRACKED } from '../../components/common/FilterBuilder/presets';
import { extractUniqueStudyCharacters, isFrequencyLevelAtOrEasierThanTarget } from '../../../shared/languageFeatures';
import type { LanguageData } from '../../../shared/types';

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Checks dedicated marker first, falls back to the old heuristic
 * (lastStatusChange set + statusChangedAtSeen absent → sync rating).
 *
 * @deprecated The fallback heuristic exists only for pre-`wordSyncRatedAt`
 * records. New writes must set `wordSyncRatedAt`.
 */
export function wasExplicitlySyncRated(knowledge: { wordSyncRatedAt?: number; lastStatusChange?: number; statusChangedAtSeen?: number } | undefined): boolean {
  if (!knowledge) return false;
  if (knowledge.wordSyncRatedAt !== undefined) return true;
  return knowledge.lastStatusChange !== undefined && knowledge.statusChangedAtSeen === undefined;
}

/** Include entries at or easier than the selected learner level. */
export function shouldIncludeForLevel(rawLevel: number, target: number, languageData?: LanguageData | null): boolean {
  return isFrequencyLevelAtOrEasierThanTarget(rawLevel, target, languageData);
}

/**
 * Status string for a word-sync pool record. The comprehensive resolver
 * flattens resolver-unknown and never-encountered into one status; the
 * knowledge-record presence distinguishes them (tracked unknown vs
 * untracked). Learning is its own bucket, so an Unknown filter operand
 * never matches a Learning word.
 */
export function wordSyncPoolStatus(resolvedStatus: 'unknown' | 'learning', hasKnowledgeRecord: boolean): string {
  if (resolvedStatus === 'learning') return String(WORD_STATUS.LEARNING);
  return hasKnowledgeRecord ? String(WORD_STATUS.UNKNOWN) : WORD_SYNC_STATUS_UNTRACKED;
}

/**
 * Predicted-accessibility weight, NOT evidence: characters the learner is
 * predicted to know (word-derived familiarity) make an unseen word easier to
 * access. Legitimate SUPPORT→selection input; must never feed knowledge writes.
 * +0.25 per matching study character, capped at 3 (max 1.75x). Returns 1.0 when no match.
 */
export function calculateCharacterStudyBoost(word: string, predictedKnownCharacterSet: Set<string>, studyScripts: readonly string[]): number {
  if (predictedKnownCharacterSet.size === 0 || studyScripts.length === 0) return 1.0;
  const studyChars = extractUniqueStudyCharacters(word, studyScripts);
  let matchCount = 0;
  for (const ch of studyChars) {
    if (predictedKnownCharacterSet.has(ch)) matchCount++;
  }
  if (matchCount === 0) return 1.0;
  return 1 + Math.min(matchCount, 3) * 0.25;
}

export interface PoolCandidate {
  ease: number;
  wordSyncRatedAt?: number;
  lastStatusChange?: number;
  statusChangedAtSeen?: number;
}

export function isWordEligible(
  knowledge: PoolCandidate | undefined,
  isSyncSeenRecently: boolean,
  skipSeen: boolean,
  staleDaysMs: number,
  now: number,
): boolean {
  if (wasExplicitlySyncRated(knowledge)) {
    const ease = knowledge!.ease;
    const lastChange = knowledge!.wordSyncRatedAt ?? knowledge!.lastStatusChange;

    // Explicitly rated known → reappear as check-in when stale
    if (ease >= SRS_EASE.DEFAULT_KNOWN) {
      if (lastChange !== undefined && (now - lastChange) < staleDaysMs) return false;
    }

    // Explicitly rated learning → show only if stale
    if (ease > SRS_EASE.MIN && ease < SRS_EASE.DEFAULT_KNOWN) {
      if (lastChange !== undefined && (now - lastChange) < staleDaysMs) return false;
    }

    // Explicitly rated unknown stays in rotation — the user asked to see these again.
    // The sync-seen cooldown only gates rated words above the unknown ease band.
    if (ease > SRS_EASE.MIN && skipSeen && isSyncSeenRecently) return false;
  } else {
    if (skipSeen && isSyncSeenRecently) return false;
  }

  return true;
}

/** Weight that prioritizes unknown/low-ease words over high-ease/known ones.
 *  No knowledge → 2.0 (highest), ease 1.3 → 1.7, ease 2.5 → 0.5 (lowest). */
export function calculateWordWeight(ease: number | undefined, characterStudyBoost: number): number {
  const basePriority = ease === undefined ? 2.0 : Math.max(0.5, 3.0 - ease);
  return basePriority * characterStudyBoost;
}

export { THIRTY_DAYS_MS };
