import type { LearnableTarget } from '../../shared/graph/types';

export interface EncounterTask {
  taskTemplateId: string;
  inputModality: string;
  responseModality: string;
  supplied: string[];
  requested: string[];
  fluencyRequired: boolean;
  /** Profile tasks submit all assessable capabilities as one attempt; dominant tasks assess one target. */
  ratingMode: 'profile' | 'dominant';
}

/**
 * Grammar construction recognition: the construction's written form (as it
 * appears in context) is supplied; the learner self-assesses recognizing the
 * construction. Measures the grammar-recognition access — never lexical
 * knowledge, and never a parallel grammar engine: evidence flows through the
 * shared capability-scoped journal.
 */
export const GRAMMAR_RECOGNIZE_TASK: EncounterTask = {
  taskTemplateId: 'grammar-recognize',
  inputModality: 'written-form',
  responseModality: 'self-assessment',
  supplied: ['written-form'],
  requested: ['grammar-recognition'],
  fluencyRequired: false,
  ratingMode: 'dominant',
};

export interface ScaffoldRef {
  scaffoldId: string;
  version?: string;
  params?: Record<string, unknown>;
}

export type ScoreDimension =
  | 'retention-need'
  | 'curriculum-relevance'
  | 'information-gain'
  | 'uncertainty'
  | 'novelty'
  | 'attention-cost'
  /**
   * Recent-consolidation padding (R08): set by a source only when the caller
   * can honestly derive it from recorded evidence. Selection-only — never
   * evidence, never a threshold.
   */
  | 'momentum'
  /**
   * Recurrence of an unmeasured term inside the learner's CURRENTLY SELECTED
   * media (R21): token exposure that keeps blocking comprehension. It is a
   * content/coverage heuristic — not demonstrated understanding.
   */
  | 'media-relevance';

/**
 * Learner goal driving ROI weighting (R07). Absent from the context means
 * maintenance mode: the policy applies no deadline weighting at all.
 */
export interface PolicyGoal {
  kind: 'exam';
  /** Deadline epoch ms. Open horizons omit it: no consolidation weighting. */
  deadlineMs?: number;
  /**
   * Learner-owned free-text target (R19: personal provenance, never a
   * validated framework enum). Recorded verbatim in traces so an explanation
   * names WHAT the learner is aiming at; the policy never interprets it.
   */
  target?: string;
  /**
   * The learning language this goal was recorded for (R07 scoping), carried
   * verbatim so a trace names WHICH queue the deadline drives. Absent = the
   * context builder could not scope it; the policy sees no goal at all.
   */
  language?: string;
}

export type SessionIntensity = 'gentle' | 'steady' | 'intensive';

/**
 * Cross-cutting learner context (R07/R08). Both fields are optional so
 * existing callers keep their exact behavior; neither ever changes evidence
 * credibility, thresholds, or scoring rules — only selection weighting.
 */
export interface PolicyContext {
  goal?: PolicyGoal;
  intensity?: SessionIntensity;
}

/** One named weight adjustment with its exact arithmetic. */
export interface PolicyWeightRule {
  rule:
    | 'deadline-consolidation'
    | 'deadline-novelty-discount'
    | 'intensity-momentum';
  dimension: ScoreDimension;
  /** Multiplicative factor applied to the base weight (1 = unchanged). */
  multiplier: number;
  /** Additive term applied after the multiplier (0 = none). */
  addend: number;
  /** Auditable reason citing the actual terms (days left, intensity). */
  why: string;
}

/** One ranked candidate's contribution breakdown (bounded per trace). */
export interface PolicyRankRow {
  key: string;
  origin: Candidate['origin'];
  /**
   * The candidate's declared metadata (recurrence counts, canonical status,
   * category pressure, predictions) — the source inputs behind the scores,
   * carried verbatim into the explanation (R20).
   */
  meta?: Record<string, unknown>;
  contributions: Array<{
    dimension: ScoreDimension;
    score: number;
    weight: number;
    value: number;
  }>;
  total: number;
}

export interface PolicyExclusion {
  key: string;
  reason: string;
}

/**
 * Bounded typed trace of one decision (R20). Emitted by the same code path
 * that produced the result — never a post-hoc narrative. Replay needs only
 * the same inputs, weights, and seed.
 */
export interface PolicyTrace {
  /** Bumped when the selection math changes; replays must pin it. */
  version: string;
  inputs: {
    nowMs: number;
    attentionBudgetRemaining: number;
    probeBudgetRemaining: number;
    probeCooldownMs: number;
    deferFloor: number;
    minRepeatDistance: number;
    recentPickCount: number;
    task: string;
    candidateCount: number;
    goal: PolicyGoal | null;
    intensity: SessionIntensity | null;
    /** Bounded recent-pick identities (last entries actually consulted for hysteresis). */
    recentPicks: readonly string[];
    recentPicksOmitted: number;
    /** Bounded probe-cooldown snapshot; replay reconstructs the map from these. */
    cooldowns: ReadonlyArray<{ key: string; lastProbeAtMs: number }>;
    cooldownsOmitted: number;
    /** Bounded stochastic draw record; omitted draws make exact replay unavailable. */
    rng: {
      seed: number | null;
      draws: ReadonlyArray<{ key: string; draw: number; weightedKey: number }>;
      drawsOmitted: number;
    };
  };
  weights: {
    base: Partial<Record<ScoreDimension, number>>;
    effective: Partial<Record<ScoreDimension, number>>;
    rules: PolicyWeightRule[];
  };
  /** Selected/best candidate first, then top competitors by total. */
  ranking: PolicyRankRow[];
  /** Candidates above the ranking cap (bounded traces over big pools). */
  rankingOmitted: number;
  /** Key of the returned decision's candidate (the DEFER fallback is included, marked by `action`). */
  selectedKey: string | null;
  action: PolicyAction | null;
  exclusions: PolicyExclusion[];
  exclusionsOmitted: number;
  /** Honesty notes: what these numbers are and are not. */
  limits: readonly string[];
}

export interface Candidate {
  key: string;
  word?: string;
  language: string;
  targets: LearnableTarget[];
  origin:
    | 'retention'
    /** A queued never-reviewed card: exploration/introduction, not retention repair. */
    | 'new-card'
    | 'curriculum'
    | 'calibration'
    | 'weak-target'
    | 'probe'
    | 'media'
    | 'grammar'
    /** Missing written bridge on an already-synchronized lexical object. */
    | 'bridge'
    /** Reserved extension point for future external teacher-assignment sources. No built-in source emits it; the policy falls through to TEACH. */
    | 'assignment';
  scores: Partial<Record<ScoreDimension, number>>;
  /**
   * Task template this candidate's encounter should run. Absent = the
   * preset's task. Sources declare what their encounter actually measures —
   * the policy stays generic over candidate kinds.
   */
  task?: EncounterTask;
  meta?: Record<string, unknown>;
}

export type PolicyAction = 'PROBE' | 'TEACH' | 'DEFER' | 'MAINTAIN';

export interface PolicyDecision {
  candidate: Candidate;
  action: PolicyAction;
  encounter: {
    targets: LearnableTarget[];
    task: EncounterTask;
    scaffolds: ScaffoldRef[];
    why: string;
  };
  /**
   * Typed execution trace of THIS decision (R20): same computation, same
   * code path — no post-hoc narrative. Optional so wrapped consumers that
   * construct decisions by hand stay source-compatible.
   */
  trace?: PolicyTrace;
}
