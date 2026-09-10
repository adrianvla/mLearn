import type { KeyArchive } from './historyArchive';
import type { ReplayProjection } from '../utils/projectionReplay';

/**
 * Payload shapes for the knowledge-history query surface (IPC + bridges).
 * These replace raw whole-language journal shipping: consumers request the
 * derived projection state, the archive (LOD/retention), per-key summaries,
 * or idempotency checks — never the full event log.
 */

/** Derived per-key learner state served from checkpoint folds + archives. */
export interface KeyKnowledgeState {
  projection: ReplayProjection | null;
  /** Latest explicit status per source (survives archiving). */
  statusMarkers?: Record<string, { t: number; seq: number; toStatus: string }>;
  /** True when the key has an archive (aggregated old evidence exists). */
  hasArchive: boolean;
  /** Rows summarized by the archive. */
  archivedEventCount: number;
  /** t of the oldest evidence the archive summarizes. */
  archiveFirstT?: number;
}

/** Per-key history summary (analytics/overview granularity). */
export interface KeyHistorySummary {
  firstT?: number;
  lastT?: number;
  exactRows: number;
  archivedRows: number;
  /** First sense-routed evidence t (cohort anchor). */
  firstSenseT?: number;
  firstKnownT?: number;
  stableKnownT?: number;
  lapsedAfterFirstKnown: boolean;
  /** Exact acquisition-window meaning rows (cohort slope replay input). */
  acquisitionRows?: Array<{ event: import('../knowledgeEvents').KnowledgeEvent; seq: number }>;
}

export interface KnowledgeArchiveEnvelope {
  key: string;
  archive?: KeyArchive;
}
