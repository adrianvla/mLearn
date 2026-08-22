import type { KnowledgeEvent } from '../knowledgeEvents';
import { stripRetractions } from '../knowledgeEvents';

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
}

/** Sources whose explicit outcome marks an intentional status change (the passive-cap marker). */
const EXPLICIT_STATUS_SOURCES = new Set(['manual', 'srs', 'anki']);

export function replayKeyProjection(events: readonly KnowledgeEvent[]): ReplayProjection | null {
  const active = stripRetractions(events);
  if (active.length === 0) return null;

  const sorted = [...active].sort((a, b) => a.t - b.t);
  let ease: number | undefined;
  let lastStatusChange: number | undefined;
  let wordSyncRatedAt: number | undefined;
  let timesSeen = 0;
  let timesHovered = 0;

  for (const event of sorted) {
    switch (event.kind) {
      case 'rating':
      case 'status':
      case 'review': {
        if (event.easeAfter !== undefined) ease = event.easeAfter;
        if (
          event.toStatus !== undefined
          && EXPLICIT_STATUS_SOURCES.has(event.source)
        ) {
          lastStatusChange = event.t;
        }
        if ((event as { origin?: string }).origin === 'word-sync') {
          wordSyncRatedAt = event.t;
        }
        break;
      }
      case 'rollup': {
        if (event.easeAfter !== undefined) ease = event.easeAfter;
        break;
      }
      case 'retraction':
        break; // stripped above; kept for exhaustiveness
    }
    if (event.timesSeenDelta) timesSeen += event.timesSeenDelta;
  }

  // Hover observations are recorded as passiveTracking status rows.
  timesHovered = sorted.filter(
    (event) => event.kind === 'status' && event.source === 'passiveTracking' && event.aspect === 'meaning',
  ).length;

  if (ease === undefined) return null;

  return {
    ease,
    ...(lastStatusChange !== undefined ? { lastStatusChange } : {}),
    ...(wordSyncRatedAt !== undefined ? { wordSyncRatedAt } : {}),
    timesSeen,
    timesHovered,
    firstSeen: sorted[0].t,
    lastSeen: sorted[sorted.length - 1].t,
  };
}
