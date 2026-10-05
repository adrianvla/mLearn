import { grammarEntityId } from '../../../shared/graph/load';
import { isLearningDecision, learningDecisionMatchesOutcome, type LearningDecision } from '../../../shared/learningDecision';
import type { LanguageData } from '../../../shared/types';
import { hashWordSync } from '../../../shared/utils/wordHash';
import { POLICY_TRACE_VERSION } from '../../learning/teachingPolicy';
import type { EncounterTask, PolicyDecision } from '../../learning/types';

type GrammarPoint = NonNullable<LanguageData['grammar']>[number];

/** Actual written-construction retrieval followed by self-report; not an independently scored item. */
export const GRAMMAR_SELF_ASSESS_TASK: EncounterTask = {
  taskTemplateId: 'grammar-self-assess', inputModality: 'written-form', responseModality: 'recall',
  supplied: ['written-form'], requested: ['grammar-recognition'], fluencyRequired: false, ratingMode: 'dominant',
};
export const GRAMMAR_SELF_CHECK_TASK: EncounterTask = {
  ...GRAMMAR_SELF_ASSESS_TASK, taskTemplateId: 'grammar-self-check',
};

export function captureGrammarSelfAssessmentDecision(selection: PolicyDecision, language: string, point: GrammarPoint, at: number, handoff?: LearningDecision) {
  if (handoff && !grammarSelfAssessmentHandoffMatches(handoff, handoff.id, language, [point.pattern], false))
    throw new Error('Grammar admission does not match its Home handoff');
  const decision: LearningDecision = { id: crypto.randomUUID(), at,
    policyVersion: selection.trace?.version ?? POLICY_TRACE_VERSION,
    selected: { key: selection.candidate.key, action: selection.action,
      targets: selection.encounter.targets.map(target => ({ kind: 'grammar-pattern', id: target.entityId, capability: target.capability })),
      task: selection.encounter.task,
      presentation: { language, pattern: point.pattern, contentHash: hashWordSync(JSON.stringify(point)) } },
    baseline: null, detail: { scope: 'frozen-grammar-pass', trace: selection.trace,
      ...(handoff ? { handoffRef: { id: handoff.id } } : {}),
      limits: ['Self-reported construction recall, not independently scored performance or official exam readiness.'] } };
  if (!grammarSelfAssessmentDecisionMatches(decision, language, point)) throw new Error('Grammar selection does not match its actual task');
  return JSON.parse(JSON.stringify(decision)) as LearningDecision;
}

/** New admissions bind both the exact task and complete package-owned cue data. Legacy queues omit decisions. */
export function grammarSelfAssessmentDecisionMatches(value: unknown, language: string, point: GrammarPoint): value is LearningDecision {
  return isLearningDecision(value)
    && [GRAMMAR_SELF_ASSESS_TASK, GRAMMAR_SELF_CHECK_TASK].some(task => JSON.stringify(value.selected.task) === JSON.stringify(task))
    && value.selected.targets.length === 1
    && learningDecisionMatchesOutcome(value, { kind: 'grammar-pattern', id: grammarEntityId(language, point.pattern), capability: 'grammar-recognition' })
    && value.selected.presentation?.language === language && value.selected.presentation.pattern === point.pattern
    && value.selected.presentation.contentHash === hashWordSync(JSON.stringify(point));
}

/** A Home decision describes the offered activity, not a completed retrieval. */
export function grammarSelfAssessmentHandoffMatches(value: unknown, requestId: unknown, language: string,
  patterns: readonly string[], exactScope = true): value is LearningDecision {
  return isLearningDecision(value) && value.id === requestId && value.selected.action === 'grammar'
    && value.selected.task.taskTemplateId === GRAMMAR_SELF_ASSESS_TASK.taskTemplateId
    && value.selected.task.inputModality === 'activity-handoff' && value.selected.task.responseModality === 'none'
    && patterns.length > 0 && new Set(patterns).size === patterns.length
    && (!exactScope || value.selected.targets.length === patterns.length)
    && patterns.every(pattern => learningDecisionMatchesOutcome(value,
      { kind: 'grammar-pattern', id: grammarEntityId(language, pattern), capability: 'grammar-recognition' }));
}
