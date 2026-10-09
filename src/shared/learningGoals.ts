import type { Settings } from './types';

/** Requirements are learner intent, never another learner/evidence model. */
export interface LearningGoal {
  id: string;
  language: string;
  outcome: string;
  status: 'active' | 'paused' | 'completed';
  priority: number;
  deadline?: string;
  createdAt: number;
  /** Stable installed-package outcome identity. A display label never defines membership. */
  outcomeRef?: { id: string; packageVersion?: string; groupIds?: string[];
    semanticBasis?: import('./learningGoalCompatibility').LearningGoalSemanticBasis;
    bindingHistory?: Array<{ at: number; previous: import('./learningGoalCompatibility').LearningGoalSemanticBasis | null;
      requestedVersion?: string; basis: import('./learningGoalCompatibility').LearningGoalSemanticBasis }>;
    [key: string]: unknown;
  };
  /** Outcome requirement, not an algorithm weight; only meaningful with a calibrated outcome model. */
  requiredReliability?: number;
  /** Coverage origin must survive storage; user scope is not an official syllabus. */
  scope?: {
    provenance: 'user' | 'package' | 'community' | 'authoritative';
    reference?: string;
    words?: string[];
    /** Opaque package requirements and conditions; core must preserve unknown data. */
    requirements?: Record<string, unknown>;
  };
}

export function learningGoalsForSettings(settings: Pick<Settings, 'learningGoals' | 'examGoal'> & { language?: string }): LearningGoal[] {
  if (settings.learningGoals !== undefined) return settings.learningGoals;
  // Legacy free text remains in settings.examGoal; it has no package identity.
  return [];
}

export function activeLearningGoals(goals: readonly LearningGoal[], language: string): LearningGoal[] {
  return goals.filter(goal => goal.language === language && goal.status === 'active' && Boolean(goal.outcomeRef?.id))
    .sort((a, b) => b.priority - a.priority || a.createdAt - b.createdAt);
}
