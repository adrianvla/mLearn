import { grammarEntityId } from '../../../shared/graph/load';
import { isLearningDecision, learningDecisionMatchesOutcome, type LearningDecision } from '../../../shared/learningDecision';
import { hashWordSync } from '../../../shared/utils/wordHash';
import type { EncounterTask, PolicyDecision } from '../../learning/types';
import { isDeliverableItem, type QuestionItem, type QuestionItemRef } from '../../learning/questionBank';
import { POLICY_TRACE_VERSION } from '../../learning/teachingPolicy';
import type { KnowledgeEvent } from '../../../shared/knowledgeEvents';

export type ContrastFormat = 'mcq' | 'typed';
export interface GrammarContrastAdmission {
  itemRef: QuestionItemRef;
  decisions: Partial<Record<ContrastFormat, LearningDecision>>;
}

/** These are the implemented delivery protocols, not language-owned categories. */
export function grammarContrastTask(format: ContrastFormat): EncounterTask {
  return { taskTemplateId: `contrast-${format}`, inputModality: 'written-context',
    responseModality: format === 'mcq' ? 'multiple-choice' : 'typed', supplied: ['written-context'],
    requested: ['grammar-recognition'], fluencyRequired: false, ratingMode: 'dominant' };
}

export function grammarContrastValidationRef(item: QuestionItem): NonNullable<KnowledgeEvent['validationRef']> {
  const semantic = item.validation.semantic!;
  return { validator: semantic.validator, ...(semantic.validatorVersion !== undefined ? { validatorVersion: semantic.validatorVersion } : {}),
    at: semantic.at, contentHash: semantic.contentHash };
}

export function captureGrammarContrastDecision(selection: PolicyDecision, item: QuestionItem,
  format: ContrastFormat, at: number): LearningDecision {
  if (!isDeliverableItem(item)) throw new Error('Contrast item lacks executed validation');
  const decision: LearningDecision = { id: crypto.randomUUID(), at,
    policyVersion: selection.trace?.version ?? POLICY_TRACE_VERSION,
    selected: { key: selection.candidate.key, action: selection.action,
      targets: selection.encounter.targets.map(target => ({ kind: 'grammar-pattern', id: target.entityId, capability: target.capability })),
      task: selection.encounter.task,
      presentation: { language: item.language, pattern: item.pattern,
        itemRef: { id: item.id, version: item.version, seed: item.seed }, validationRef: grammarContrastValidationRef(item),
        contentHash: hashWordSync(JSON.stringify(item)) } },
    baseline: null, detail: { scope: 'frozen-grammar-contrast', trace: selection.trace,
      limits: ['Item-graded practice under its declared conditions; not calibrated official exam performance or durable learning gain.'] } };
  if (!grammarContrastDecisionMatches(decision, item, format)) throw new Error('Contrast selection does not match its delivered task');
  return JSON.parse(JSON.stringify(decision)) as LearningDecision;
}

export function grammarContrastDecisionMatches(value: unknown, item: QuestionItem, format: ContrastFormat): value is LearningDecision {
  return isDeliverableItem(item) && isLearningDecision(value) && JSON.stringify(value.selected.task) === JSON.stringify(grammarContrastTask(format))
    && value.selected.targets.length === 1
    && learningDecisionMatchesOutcome(value, { kind: 'grammar-pattern', id: grammarEntityId(item.language, item.pattern), capability: 'grammar-recognition' })
    && value.selected.presentation?.language === item.language && value.selected.presentation.pattern === item.pattern
    && JSON.stringify(value.selected.presentation.itemRef) === JSON.stringify({ id: item.id, version: item.version, seed: item.seed })
    && JSON.stringify(value.selected.presentation.validationRef) === JSON.stringify(grammarContrastValidationRef(item))
    && value.selected.presentation.contentHash === hashWordSync(JSON.stringify(item));
}
