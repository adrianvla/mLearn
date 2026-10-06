import { inferLearningOpportunities } from '../../shared/learningOpportunities';
import { learningAddress, type LearningModel } from '../../shared/learningModel';
import { surfaceEntityId, grammarEntityId } from '../../shared/graph/load';
import { hashWordSync } from '../../shared/utils/wordHash';
import type { LanguageData } from '../../shared/types';
import type { KnowledgeEvent } from '../../shared/knowledgeEvents';
import { learningScopeForSettings } from '../../shared/learningScope';
import { learningGoalsForSettings } from '../../shared/learningGoals';
import { evaluateLearningRequirements } from '../../shared/learningRequirementEvaluation';
import type { Settings } from '../../shared/types';
import { DEFAULT_SETTINGS } from '../../shared/types';
import type { PolicyContext, SessionIntensity } from './types';

const INTENSITIES: readonly SessionIntensity[] = ['gentle', 'steady', 'intensive'];

/** Resolves persisted intent against installed package data. Legacy labels and
 * intensity remain provenance; live choices use conditional action values.
 * Outcomes affect only their recorded language. No title is parsed as scope. */
export function policyContextFromSettings(
  settings: Pick<Settings, 'sessionIntensity' | 'examGoal' | 'learningGoals'>,
  language?: string,
  runtime?: { model: LearningModel; events: readonly KnowledgeEvent[]; data?: LanguageData | null; nowMs?: number },
): PolicyContext {
  const intensity = INTENSITIES.includes(settings.sessionIntensity)
    ? settings.sessionIntensity
    : DEFAULT_SETTINGS.sessionIntensity;
  const context: PolicyContext = { intensity };

  const scope = learningScopeForSettings(settings, runtime?.data, language);
  if (scope.selected || settings.learningGoals !== undefined) context.goals = scope.goals;
  if (runtime) {
    context.requirementEvaluations = evaluateLearningRequirements(learningGoalsForSettings(settings), language ?? '',
      runtime.model, runtime.events, runtime.data, runtime.nowMs ?? runtime.model.at);
  }
  const primary = [...(context.goals ?? [])].sort((a, b) => (a.deadline ? Date.parse(a.deadline) : Infinity) - (b.deadline ? Date.parse(b.deadline) : Infinity))[0];
  if (primary) {
    const deadlineMs = primary.deadline ? Date.parse(primary.deadline) : NaN;
    context.goal = { kind: 'outcome', target: primary.outcome, language: primary.language,
      ...(Number.isFinite(deadlineMs) ? { deadlineMs } : {}) };
  }
  return attachLearningContext(context, language, runtime);
}

function attachLearningContext(context: PolicyContext, language: string | undefined,
  runtime: { model: LearningModel; events: readonly KnowledgeEvent[]; data?: LanguageData | null; nowMs?: number } | undefined): PolicyContext {
  if (!runtime) return context;
  const now = runtime.nowMs ?? runtime.model.at;
  const opportunities = inferLearningOpportunities(runtime.events, now);
  const gaps = [...opportunities.gapDays].sort((a, b) => a - b);
  const targetWeights: Record<string, number> = {};
  const requirementEntities = new Set((context.requirementEvaluations ?? []).flatMap(goal => goal.requirements
    .filter(requirement => requirement.status !== 'unsupported')
    .flatMap(requirement => requirement.targets?.map(target => target.target.entityId) ?? [])));
  for (const goal of context.goals ?? []) {
    const groups = goal.resolvedOutcome?.groups ?? [{ words: goal.scope?.words ?? [], patterns: [] }];
    for (const group of groups) {
      const count = group.words.length + group.patterns.length;
      if (!count || !language) continue;
      for (const word of group.words) {
        const entityId = surfaceEntityId(language, hashWordSync(word));
        // Membership applies to the actual task's package-owned access, with no central capability checklist.
        const address = learningAddress({ entityId, capability: '*' });
        if (requirementEntities.has(entityId)) continue;
        targetWeights[address] = Math.max(targetWeights[address] ?? 0, 1 / count);
      }
      for (const pattern of group.patterns) {
        const address = learningAddress({ entityId: grammarEntityId(language, pattern), capability: 'grammar-recognition' });
        const entityId = grammarEntityId(language, pattern);
        if (requirementEntities.has(entityId)) continue;
        targetWeights[address] = Math.max(targetWeights[address] ?? 0, 1 / count);
      }
    }
  }
  const deadline = context.goal?.deadlineMs;
  const deferDays = gaps[Math.floor(gaps.length / 2)] ?? 3;
  // Evaluate consolidation beyond the required point through a long inferred gap;
  // this is a scenario horizon, never a universal preparation-start rule or readiness claim.
  const consolidationDays = gaps[Math.min(gaps.length - 1, Math.floor(gaps.length * 0.9))] ?? deferDays;
  context.learning = { model: runtime.model,
    horizonDays: deadline !== undefined && deadline > now ? (deadline - now) / 86_400_000 + consolidationDays : 30,
    ...(deadline !== undefined && deadline > now ? { assessmentAt: deadline } : {}),
    deferDays, availableSeconds: opportunities.availableSeconds, continuationValue: 0,
    ...(Object.keys(targetWeights).length ? { targetWeights } : {}) };
  return context;
}
