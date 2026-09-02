import type { KnowledgeEvent, WordStatus } from '../knowledgeEvents';
import { stripRetractions } from '../knowledgeEvents';
import { normalizeEvidenceEase, statusToEase } from './knowledgeStrength';

/**
 * Recomputable learner projection for one surface-hash key.
 *
 * The evidence journal is the source of truth: every rating/status/review/
 * rollup row carries its outcome (easeAfter / toStatus / deltas), so this
 * replay reproduces the materialized wordKnowledge entry WITHOUT any
 * independent mutable truth. Undo works by appending retractions and
 * replaying — never by restoring snapshots of epistemic state.
 *
 * Fidelity contract (what replay derives vs what stays external):
 * - derived: ease, lastStatusChange, timesSeen, timesHovered, wordSyncRatedAt,
 *   lastSeen (= last event t), firstSeen (= first event t)
 * - NOT derived (presentation/policy data, preserved by callers): word,
 *   reading, language labels, forms[] sub-skill copies
 */
export interface ReplayProjection {
  ease: number;
  lastStatusChange?: number;
  wordSyncRatedAt?: number;
  timesSeen: number;
  timesHovered: number;
  firstSeen: number;
  lastSeen: number;
  /** Source of the most recent evidence event (attribution only). */
  evidenceSource?: string;
  /** Active explicit claim; undefined = none. */
  claim?: WordStatus;
  /** Timestamp of the active claim. */
  claimAt?: number;
  /** True when any evidence event (not a claim) contributed state. */
  hasEvidence: boolean;
  /** True when any non-passive evidence (SRS/Anki/attempt/migration) exists. */
  hasActiveEvidence: boolean;
}

/** Sources whose explicit outcome marks an intentional status change (the passive-cap marker). */
const EXPLICIT_STATUS_SOURCES = new Set(['manual', 'srs', 'anki']);

/**
 * Every evidence row must replay to a state: the normalized recorded ease, or
 * — when a writer recorded only the status outcome (e.g. Anki status diffs) —
 * the canonical ease that status maps back to. Explicit sources only; passive
 * rows never contribute a status-derived outcome.
 */
function outcomeEase(event: KnowledgeEvent): number | undefined {
  if (event.easeAfter !== undefined) return normalizeEvidenceEase(event.source, event.easeAfter);
  if (event.toStatus !== undefined && EXPLICIT_STATUS_SOURCES.has(event.source)) return statusToEase(event.toStatus);
  return undefined;
}

export function replayKeyProjection(events: readonly KnowledgeEvent[]): ReplayProjection | null {
  const active = stripRetractions(events);
  if (active.length === 0) return null;

  const sorted = [...active].sort((a, b) => a.t - b.t);
  let ease: number | undefined;
  let lastStatusChange: number | undefined;
  let wordSyncRatedAt: number | undefined;
  let timesSeen = 0;
  let claim: WordStatus | undefined;
  let claimAt: number | undefined;
  let evidenceSource: string | undefined;
  let hasEvidence = false;
  let hasActiveEvidence = false;

  for (const event of sorted) {
    switch (event.kind) {
      case 'claim': {
        // Latest active claim wins; a claim without toStatus clears it.
        claim = event.toStatus;
        claimAt = event.t;
        break;
      }
      case 'rating':
      case 'status':
      case 'review': {
        evidenceSource = event.source;
        hasEvidence = true;
        if (event.source !== 'passiveTracking') hasActiveEvidence = true;
        const nextEase = outcomeEase(event);
        if (nextEase !== undefined) ease = nextEase;
        if (
          event.toStatus !== undefined
          && EXPLICIT_STATUS_SOURCES.has(event.source)
        ) {
          lastStatusChange = event.t;
        }
        if (event.origin === 'word-sync') {
          wordSyncRatedAt = event.t;
        }
        break;
      }
      case 'rollup': {
        const nextEase = outcomeEase(event);
        if (nextEase !== undefined) ease = nextEase;
        evidenceSource = event.source;
        hasEvidence = true;
        if (event.source !== 'passiveTracking') hasActiveEvidence = true;
        break;
      }
      case 'retraction':
        break; // stripped above; kept for exhaustiveness
    }
    if (event.timesSeenDelta) timesSeen += event.timesSeenDelta;
  }

  // Hover observations are recorded as passiveTracking status rows.
  const timesHovered = sorted.filter(
    (event) => event.kind === 'status' && event.source === 'passiveTracking' && event.aspect === 'meaning',
  ).length;

  if (ease === undefined && claim === undefined) return null;

  return {
    ease: ease ?? 0,
    ...(lastStatusChange !== undefined ? { lastStatusChange } : {}),
    ...(wordSyncRatedAt !== undefined ? { wordSyncRatedAt } : {}),
    ...(claim !== undefined ? { claim } : {}),
    ...(claimAt !== undefined ? { claimAt } : {}),
    ...(evidenceSource !== undefined ? { evidenceSource } : {}),
    timesSeen,
    timesHovered,
    firstSeen: sorted[0].t,
    lastSeen: sorted[sorted.length - 1].t,
    hasEvidence,
    hasActiveEvidence,
  };
}
