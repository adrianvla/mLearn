import type { KnowledgeBasis } from '../../../shared/knowledge/effectiveKnowledge';
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

/** Encode canonical knowledge for filter operands; Untracked means Unmeasured. */
export function wordSyncPoolStatus(resolvedStatus: 'unknown' | 'learning' | 'known', basis: KnowledgeBasis): string {
  if (basis === 'unmeasured') return WORD_SYNC_STATUS_UNTRACKED;
  return String(WORD_STATUS[resolvedStatus.toUpperCase() as keyof typeof WORD_STATUS]);
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

/**
 * True when the materialized overlay holds a written-surface bridge access
 * (surface-recognition: seeing the form retrieves the word) known or claimed
 * known — the written bridge exists, so nothing is missing there.
 */
export function hasSurfaceRecognitionAccess(
  knowledge: { access?: Partial<Record<string, { status?: string; claim?: string }>> } | undefined,
): boolean {
  const record = knowledge?.access?.['surface-recognition'];
  return (record?.claim ?? record?.status) === 'known';
}

/**
 * A BRIDGE candidate: the lexical object is already known (or claimed so)
 * through sense/spoken access, but the written-form access is missing.
 * Presenting it is overlay synchronization — a cheap directed completion,
 * not teaching a novel word. Selection weighting only; never knowledge.
 */
export function isBridgeCandidate(resolvedStatus: 'unknown' | 'learning' | 'known', writtenAccess: boolean, hasKnowledgeRecord: boolean): boolean {
  return resolvedStatus === 'known' && !writtenAccess && hasKnowledgeRecord;
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

/**
 * "Rated recently" for the pool's recency signal — the REAL cooldown, from two
 * independent signals: any Word Sync rating stamps `wordSyncRatedAt` (hidden
 * by the eligibility staleness gate), while a missed rating additionally
 * stamps the `wordSyncSeen` policy marker (30-day fixed window).
 */
export function isWordSyncRecentlyRated(
  knowledge: { wordSyncRatedAt?: number } | undefined,
  syncSeenAt: number | undefined,
  staleDaysMs: number,
  now: number,
): boolean {
  if (knowledge?.wordSyncRatedAt !== undefined && (now - knowledge.wordSyncRatedAt) < staleDaysMs) return true;
  if (syncSeenAt !== undefined && (now - syncSeenAt) < THIRTY_DAYS_MS) return true;
  return false;
}

/** Weight that prioritizes unknown/low-ease words over high-ease/known ones.
 *  No knowledge → 2.0 (highest), ease 1.3 → 1.7, ease 2.5 → 0.5 (lowest).
 *  Bridge candidates (known object, missing written-form access) get a fixed
 *  boost: completing one directed access is cheap and high-value. */
export function calculateWordWeight(ease: number | undefined, characterStudyBoost: number, bridge: boolean = false): number {
  const basePriority = ease === undefined ? 2.0 : Math.max(0.5, 3.0 - ease);
  return basePriority * characterStudyBoost * (bridge ? 1.5 : 1);
}

export { THIRTY_DAYS_MS };
