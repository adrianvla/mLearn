import type { WordStatus } from '../../shared/constants';
import type { PassiveWordKnowledge } from '../../shared/types';

/**
 * THE canonical effective-learner-state resolver (Tier 2).
 *
 * One rule, no voting, no per-surface overrides:
 *
 *   effective status = active explicit claim ?? active evidence classification ?? unmeasured
 *
 * - A claim is the user's own statement (journal kind 'claim'); it overrides
 *   the *classification* while the underlying evidence (ease) stays intact.
 * - Active evidence (SRS review, Anki, attempt rating, migration — any
 *   non-passiveTracking source) classifies the word through the ease bands.
 * - Pure passive exposure is FAMILIARITY, never epistemic evidence (REQ13):
 *   no claim + no hasActiveEvidence + no explicit status marker resolves to
 *   basis 'unmeasured' / status 'unknown' — it renders Untracked everywhere.
 *   timesSeen/timesHovered/ease stay visible as familiarity; `hasEvidence`
 *   stays true so familiarity consumers keep working.
 * - Fallback for mixed entries (explicit status marker present but the
 *   active-evidence flag missing — legacy/half-synced rows): the passive
 *   Known→Learning honesty cap still applies so exposure alone can never
 *   display Known.
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
  const hasActiveEvidence = entry.hasActiveEvidence === true;
  const hasExplicitStatusMarker = entry.lastStatusChange !== undefined;
  // REQ13: passive-only exposure (no claim, no active evidence, no explicit
  // status marker) is familiarity — it measures nothing epistemic.
  const passiveOnly = !hasActiveEvidence && !hasExplicitStatusMarker;
  // Honesty rules: pure passive evidenceStatus is Unknown (no measurement);
  // for mixed rows without the active flag, Known still caps at Learning so
  // exposure alone can never demonstrate Known.
  const rawEvidenceStatus = evidenceStatusFromEase(entry.ease, thresholds);
  const evidenceStatus = passiveOnly
    ? 'unknown'
    : rawEvidenceStatus === 'known' && !hasActiveEvidence
      ? 'learning'
      : rawEvidenceStatus;
  const hasEvidence = entry.timesSeen > 0 || entry.timesHovered > 0 || hasActiveEvidence || hasExplicitStatusMarker;
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
  if (passiveOnly) {
    return { status: 'unknown', basis: 'unmeasured', evidenceStatus, hasEvidence, ease: entry.ease };
  }
  return {
    status: evidenceStatus,
    basis: hasEvidence ? 'evidence' : 'unmeasured',
    evidenceStatus,
    hasEvidence,
    ease: entry.ease,
  };
}
