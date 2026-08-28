import type { WordStatus } from '../../shared/constants';
import type { PassiveWordKnowledge } from '../../shared/types';

/**
 * THE canonical effective-learner-state resolver (Tier 2).
 *
 * One rule, no voting, no per-surface overrides:
 *
 *   effective status = active explicit claim ?? evidence-derived status
 *
 * - A claim is the user's own statement (journal kind 'claim'); it overrides
 *   the *classification* while the underlying evidence (ease) stays intact.
 * - Without a claim, the evidence projection (replayed ease vs thresholds)
 *   classifies the word.
 * - No entry → unmeasured/unknown. `excluded` (ignore policy) is orthogonal:
 *   it never changes the status, consumers must gate on it separately.
 *
 * Every surface (pills, hover, Reader, Video, OCR, Word DB, stats, selection)
 * must obtain learner state through this model — directly or via the
 * comprehensive/aspect resolvers built on it. Nothing else may "set status".
 */

export type KnowledgeBasis = 'claim' | 'evidence' | 'unmeasured';

export interface EffectiveThresholds {
  learning: number;
  known: number;
}

export interface EffectiveWordState {
  /** What every UI displays. Claim override ?? evidence classification. */
  status: WordStatus;
  /** Where the status comes from. */
  basis: KnowledgeBasis;
  /** Classification of the underlying evidence alone (claim ignored). */
  evidenceStatus: WordStatus;
  /** Active claim, when basis === 'claim'. */
  claim?: WordStatus;
  /** True when evidence exists (any rating/review/status/rollup event). */
  hasEvidence: boolean;
  ease: number;
}

export function evidenceStatusFromEase(ease: number | undefined, thresholds: EffectiveThresholds): WordStatus {
  if (ease === undefined) return 'unknown';
  if (ease >= thresholds.known) return 'known';
  if (ease >= thresholds.learning) return 'learning';
  return 'unknown';
}

export function effectiveStateFromEntry(
  entry: PassiveWordKnowledge | undefined,
  thresholds: EffectiveThresholds,
): EffectiveWordState {
  if (!entry) {
    return { status: 'unknown', basis: 'unmeasured', evidenceStatus: 'unknown', hasEvidence: false, ease: 0 };
  }
  // Honesty rule: pure passive exposure never establishes Known — display
  // familiarity caps at Learning. "Known" evidence requires an active source
  // (SRS review, Anki, attempt rating, migration import) or an explicit claim.
  const rawEvidenceStatus = evidenceStatusFromEase(entry.ease, thresholds);
  const evidenceStatus = rawEvidenceStatus === 'known' && entry.hasActiveEvidence !== true
    ? 'learning'
    : rawEvidenceStatus;
  const hasEvidence = entry.timesSeen > 0 || entry.timesHovered > 0 || entry.lastStatusChange !== undefined || entry.ease > 0;
  if (entry.claim !== undefined) {
    return {
      status: entry.claim,
      basis: 'claim',
      evidenceStatus,
      claim: entry.claim,
      hasEvidence,
      ease: entry.ease,
    };
  }
  return {
    status: evidenceStatus,
    basis: hasEvidence ? 'evidence' : 'unmeasured',
    evidenceStatus,
    hasEvidence,
    ease: entry.ease,
  };
}
