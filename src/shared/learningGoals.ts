import { DEFAULT_SETTINGS, type Settings } from './types';

/** Requirements are learner intent, never another learner/evidence model. */
export interface LearningGoal {
  id: string;
  language: string;
  outcome: string;
  status: 'active' | 'paused' | 'completed';
  priority: number;
  deadline?: string;
  createdAt: number;
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
  const legacy = settings.examGoal;
  return legacy?.kind === 'exam' && (legacy.language || settings.language) ? [{
    id: `legacy-exam:${legacy.language || settings.language}`, language: (legacy.language || settings.language)!,
    outcome: legacy.target ?? '', status: 'active', priority: 2, createdAt: 0,
    ...(legacy.deadline ? { deadline: legacy.deadline } : {}),
  }] : [];
}

export function activeLearningGoals(goals: readonly LearningGoal[], language: string): LearningGoal[] {
  return goals.filter(goal => goal.language === language && goal.status === 'active')
    .sort((a, b) => b.priority - a.priority || a.createdAt - b.createdAt);
}

/** A transparent encounter budget. This is not an estimate of learning speed. */
export function goalSessionBudget(minutes: number): number {
  const effort = Number.isFinite(minutes) ? minutes : DEFAULT_SETTINGS.learningMinutes;
  return Math.max(1, Math.min(120, Math.floor(effort * 2)));
}
