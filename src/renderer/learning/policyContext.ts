import type { Settings } from '../../shared/types';
import { DEFAULT_SETTINGS } from '../../shared/types';
import type { PolicyContext, SessionIntensity } from './types';

const INTENSITIES: readonly SessionIntensity[] = ['gentle', 'steady', 'intensive'];

/**
 * Maps the learner's ordinary settings onto the teaching policy's context
 * (R07/R08). Pure and total: unknown/legacy values fall back to
 * DEFAULT_SETTINGS, an exam goal without a parseable deadline keeps its kind
 * (deadline weighting simply does not fire), and no goal means maintenance
 * mode with intensity-only effects.
 *
 * The exam goal is scoped STRICTLY to the learning language of the material
 * this context arbitrates (R07): a goal applies only when its recorded
 * `language` equals `language`. A goal without a recorded language is
 * inactive here — SettingsProvider stamps legacy goals once at load; there
 * is no dynamic re-scoping to the currently active app language, so a
 * Japanese deadline can never weight a German queue. Omitting `language`
 * therefore disables goal weighting for that call.
 */
export function policyContextFromSettings(
  settings: Pick<Settings, 'sessionIntensity' | 'examGoal'>,
  language?: string,
): PolicyContext {
  const intensity = INTENSITIES.includes(settings.sessionIntensity)
    ? settings.sessionIntensity
    : DEFAULT_SETTINGS.sessionIntensity;
  const context: PolicyContext = { intensity };

  const goal = settings.examGoal;
  if (goal?.kind === 'exam' && goal.language !== undefined && goal.language === language) {
    const deadlineMs = goal.deadline ? Date.parse(goal.deadline) : NaN;
    context.goal = {
      kind: 'exam',
      ...(Number.isFinite(deadlineMs) ? { deadlineMs } : {}),
      // Learner-owned provenance carried verbatim (R19): traces name the
      // target, the policy never interprets it.
      ...(goal.target ? { target: goal.target } : {}),
      // Scope provenance carried verbatim (R07): traces name WHICH learning
      // language the deadline drives.
      language: goal.language,
    };
  }
  return context;
}
