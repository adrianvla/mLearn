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

/** Goal dates use the assessment date's UTC day, independent of time-of-day. */
export function goalDeadlineDayDifference(deadline: string | undefined, now = Date.now()): number | undefined {
  if (!deadline || !/^\d{4}-\d{2}-\d{2}$/.test(deadline) || !Number.isFinite(now)) return undefined;
  const due = Date.parse(deadline);
  if (!Number.isFinite(due) || new Date(due).toISOString().slice(0, 10) !== deadline) return undefined;
  return Math.floor(due / 86400000) - Math.floor(now / 86400000);
}
