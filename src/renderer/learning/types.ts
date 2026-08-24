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
  origin: 'retention' | 'curriculum' | 'calibration' | 'weak-target' | 'probe' | 'media';
  scores: Partial<Record<ScoreDimension, number>>;
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
