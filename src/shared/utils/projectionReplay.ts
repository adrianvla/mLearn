import type { KnowledgeEvent, WordStatus } from '../knowledgeEvents';
import { eventCapability, eventIsMeasurable, stripRetractions } from '../knowledgeEvents';
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
export function outcomeEase(event: KnowledgeEvent): number | undefined {
  if (event.easeAfter !== undefined) return normalizeEvidenceEase(event.source, event.easeAfter);
  if (event.toStatus !== undefined && EXPLICIT_STATUS_SOURCES.has(event.source)) return statusToEase(event.toStatus);
  return undefined;
}

/**
 * The fold accumulator behind `replayKeyProjection`: one key's evidence state
 * with per-marker provenance (t, seq) so partial folds can merge exactly.
 * `seq` breaks same-timestamp ties the way the journal's insertion order does.
 * The archive (shared/knowledge/historyArchive) persists folded prefixes in
 * this shape and the exact tail continues the same reducer — one fold for
 * both the raw-journal path and the compacted-archive path.
 */
export interface FoldState {
  ease?: number;
  easeT: number;
  easeSeq: number;
  lastStatusChange?: number;
  lastStatusChangeSeq: number;
  wordSyncRatedAt?: number;
  wordSyncT: number;
  wordSyncSeq: number;
  timesSeen: number;
  timesHovered: number;
  firstSeen?: number;
  firstSeq: number;
  lastSeen?: number;
  lastSeenSeq: number;
  evidenceSource?: string;
  evidenceSourceT: number;
  evidenceSourceSeq: number;
  claim?: WordStatus;
  claimAt?: number;
  claimSeq: number;
  hasEvidence: boolean;
  hasActiveEvidence: boolean;
  /**
   * Latest explicit status per source (anki/srs/manual status diffs). Feeds
   * prior-state lookups (e.g. Anki bank status diffing) over archived ranges.
   */
  statusMarkers?: Record<string, { t: number; seq: number; toStatus: WordStatus }>;
}

export function emptyKeyFold(): FoldState {
  return {
    easeT: -Infinity,
    easeSeq: -1,
    lastStatusChangeSeq: -1,
    wordSyncT: -Infinity,
    wordSyncSeq: -1,
    timesSeen: 0,
    timesHovered: 0,
    firstSeq: -1,
    lastSeenSeq: -1,
    evidenceSourceT: -Infinity,
    evidenceSourceSeq: -1,
    claimSeq: -1,
    hasEvidence: false,
    hasActiveEvidence: false,
  };
}

/** `a` is strictly newer than `b` under (t, seq) ordering. */
function newer(aT: number, aSeq: number, bT: number, bSeq: number): boolean {
  return aT > bT || (aT === bT && aSeq > bSeq);
}


/**
 * The single per-event reducer for key projection. Rows must arrive in
 * (t, seq) order; retraction stripping happens before this (tombstones and
 * retracted attempts never reach here). Mutates `state` — O(1) per row.
 */
export function applyEventToFold(state: FoldState, event: KnowledgeEvent, seq: number): void {
  if (state.firstSeen === undefined || (event.t < state.firstSeen || (event.t === state.firstSeen && seq < state.firstSeq))) {
    state.firstSeen = event.t;
    state.firstSeq = seq;
  }
  if (state.lastSeen === undefined || newer(event.t, seq, state.lastSeen, state.lastSeenSeq)) {
    state.lastSeen = event.t;
    state.lastSeenSeq = seq;
  }
  switch (event.kind) {
    case 'claim': {
      // Latest active claim wins; a claim without toStatus clears it.
      if (state.claim === undefined || newer(event.t, seq, state.claimAt ?? -Infinity, state.claimSeq)) {
        state.claim = event.toStatus;
        state.claimAt = event.t;
        state.claimSeq = seq;
      }
      break;
    }
    case 'rating':
    case 'status':
    case 'review': {
      // Scaffold-aware evidence invariant (read side): an event whose own
      // presentation state supplied the access it addresses (furigana-visible
      // reading row, translation-visible meaning row) carries no knowledge —
      // only bookkeeping. Replay skips it entirely rather than weighing it.
      if (event.scaffolds !== undefined && !eventIsMeasurable(event)) break;
      applyEvidenceRow(state, event, seq);
      break;
    }
    case 'rollup': {
      applyEvidenceRow(state, event, seq);
      break;
    }
    case 'retraction':
      break; // stripped before folding; kept for exhaustiveness
  }
  if (event.timesSeenDelta) state.timesSeen += event.timesSeenDelta;
  // Explicit status rows record the asserted bank/learner status per source.
  if (event.kind === 'status' && event.toStatus !== undefined) {
    const markers = state.statusMarkers ?? (state.statusMarkers = {});
    const marker = markers[event.source];
    if (marker === undefined || newer(event.t, seq, marker.t, marker.seq)) {
      markers[event.source] = { t: event.t, seq, toStatus: event.toStatus };
    }
  }
  // Hover observations are recorded as passiveTracking status rows addressed
  // to the sense access (legacy meaning-aspect rows route via ASPECT_CAPABILITY).
  if (event.kind === 'status' && event.source === 'passiveTracking' && eventCapability(event) === 'sense-recognition') {
    state.timesHovered += 1;
  }
}

function applyEvidenceRow(state: FoldState, event: KnowledgeEvent, seq: number): void {
  state.evidenceSource = event.source;
  state.evidenceSourceT = event.t;
  state.evidenceSourceSeq = seq;

  state.hasEvidence = true;
  if (event.source !== 'passiveTracking') state.hasActiveEvidence = true;
  const nextEase = outcomeEase(event);
  if (nextEase !== undefined && (state.ease === undefined || newer(event.t, seq, state.easeT, state.easeSeq))) {
    state.ease = nextEase;
    state.easeT = event.t;
    state.easeSeq = seq;
  }
  // Rollups never mark status changes (their outcome is a summarized value,
  // not an intentional status transition).
  if (event.kind !== 'rollup' && event.toStatus !== undefined && EXPLICIT_STATUS_SOURCES.has(event.source)) {
    if (state.lastStatusChange === undefined || newer(event.t, seq, state.lastStatusChange, state.lastStatusChangeSeq)) {
      state.lastStatusChange = event.t;
      state.lastStatusChangeSeq = seq;
    }
  }
  if (event.origin === 'word-sync' && newer(event.t, seq, state.wordSyncT, state.wordSyncSeq)) {
    state.wordSyncRatedAt = event.t;
    state.wordSyncT = event.t;
    state.wordSyncSeq = seq;
  }
}

/**
 * Merge two partial folds whose row sets are temporally disjoint — every row
 * counted in `later` sorts after every row counted in `earlier`. Markers keep
 * the (t, seq)-newest side; counters and flags accumulate.
 */
export function mergeKeyFolds(earlier: FoldState, later: FoldState): FoldState {
  const merged: FoldState = { ...earlier };
  if (later.ease !== undefined && (merged.ease === undefined || newer(later.easeT, later.easeSeq, merged.easeT, merged.easeSeq))) {
    merged.ease = later.ease;
    merged.easeT = later.easeT;
    merged.easeSeq = later.easeSeq;
  }
  if (later.lastStatusChange !== undefined && (merged.lastStatusChange === undefined || newer(later.lastStatusChange, later.lastStatusChangeSeq, merged.lastStatusChange, merged.lastStatusChangeSeq))) {
    merged.lastStatusChange = later.lastStatusChange;
    merged.lastStatusChangeSeq = later.lastStatusChangeSeq;
  }
  if (newer(later.wordSyncT, later.wordSyncSeq, merged.wordSyncT, merged.wordSyncSeq)) {
    merged.wordSyncRatedAt = later.wordSyncRatedAt;
    merged.wordSyncT = later.wordSyncT;
    merged.wordSyncSeq = later.wordSyncSeq;
  }
  merged.timesSeen += later.timesSeen;
  merged.timesHovered += later.timesHovered;
  if (later.firstSeen !== undefined && (merged.firstSeen === undefined || newer(merged.firstSeen, merged.firstSeq, later.firstSeen, later.firstSeq))) {
    merged.firstSeen = later.firstSeen;
    merged.firstSeq = later.firstSeq;
  }
  if (later.lastSeen !== undefined && (merged.lastSeen === undefined || newer(later.lastSeen, later.lastSeenSeq, merged.lastSeen, merged.lastSeenSeq))) {
    merged.lastSeen = later.lastSeen;
    merged.lastSeenSeq = later.lastSeenSeq;
  }
  if (later.evidenceSource !== undefined && newer(later.evidenceSourceT, later.evidenceSourceSeq, merged.evidenceSourceT, merged.evidenceSourceSeq)) {
    merged.evidenceSource = later.evidenceSource;
    merged.evidenceSourceT = later.evidenceSourceT;
    merged.evidenceSourceSeq = later.evidenceSourceSeq;
  }
  if (later.claimAt !== undefined && newer(later.claimAt, later.claimSeq, merged.claimAt ?? -Infinity, merged.claimSeq)) {
    merged.claim = later.claim;
    merged.claimAt = later.claimAt;
    merged.claimSeq = later.claimSeq;
  }
  merged.hasEvidence = merged.hasEvidence || later.hasEvidence;
  merged.hasActiveEvidence = merged.hasActiveEvidence || later.hasActiveEvidence;
  if (later.statusMarkers) {
    const markers = merged.statusMarkers ?? (merged.statusMarkers = {});
    for (const [source, marker] of Object.entries(later.statusMarkers)) {
      const existing = markers[source];
      if (existing === undefined || newer(marker.t, marker.seq, existing.t, existing.seq)) {
        markers[source] = marker;
      }
    }
  }
  return merged;
}

/** Public projection of a completed fold (null when nothing epistemic remains). */
export function projectKeyFold(state: FoldState): ReplayProjection | null {
  if (state.ease === undefined && state.claim === undefined) return null;
  if (state.firstSeen === undefined || state.lastSeen === undefined) return null;
  return {
    ease: state.ease ?? 0,
    ...(state.lastStatusChange !== undefined ? { lastStatusChange: state.lastStatusChange } : {}),
    ...(state.wordSyncRatedAt !== undefined ? { wordSyncRatedAt: state.wordSyncRatedAt } : {}),
    ...(state.claim !== undefined ? { claim: state.claim } : {}),
    ...(state.claimAt !== undefined ? { claimAt: state.claimAt } : {}),
    ...(state.evidenceSource !== undefined ? { evidenceSource: state.evidenceSource } : {}),
    timesSeen: state.timesSeen,
    timesHovered: state.timesHovered,
    firstSeen: state.firstSeen,
    lastSeen: state.lastSeen,
    hasEvidence: state.hasEvidence,
    hasActiveEvidence: state.hasActiveEvidence,
  };
}

export function replayKeyProjection(events: readonly KnowledgeEvent[]): ReplayProjection | null {
  const active = stripRetractions(events);
  if (active.length === 0) return null;

  const sorted = active
    .map((event, index) => ({ event, index }))
    .sort((a, b) => a.event.t - b.event.t || a.index - b.index);
  const state = emptyKeyFold();
  for (const { event, index } of sorted) applyEventToFold(state, event, index);

  return projectKeyFold(state);
}

