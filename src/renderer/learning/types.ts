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
  | 'attention-cost';

export interface Candidate {
  key: string;
  word?: string;
  language: string;
  targets: LearnableTarget[];
  origin:
    | 'retention'
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
}
