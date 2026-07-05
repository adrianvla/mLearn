import { SRS_EASE } from '../../../shared/constants';
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

/** +0.25 per matching study character, capped at 3 (max 1.75x). Returns 1.0 when no match. */
export function calculateCharacterStudyBoost(word: string, knownCharacterSet: Set<string>, studyScripts: readonly string[]): number {
  if (knownCharacterSet.size === 0 || studyScripts.length === 0) return 1.0;
  const studyChars = extractUniqueStudyCharacters(word, studyScripts);
  let matchCount = 0;
  for (const ch of studyChars) {
    if (knownCharacterSet.has(ch)) matchCount++;
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

    // Explicitly rated unknown → sync-seen cooldown
    if (skipSeen && isSyncSeenRecently) return false;
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
