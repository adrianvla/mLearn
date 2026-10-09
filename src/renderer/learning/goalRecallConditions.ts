import type { LearningGoal } from '../../shared/learningGoals';
import { canonicalRequirementGroupTargets, isCanonicalThreshold, type CanonicalCapabilityThreshold } from '../../shared/learningRequirementEvaluation';
import type { ResolvedLearningOutcome } from '../../shared/learningOutcomes';
import { learningAddress } from '../../shared/learningModel';
import type { LanguageData } from '../../shared/types';
import type { Candidate } from './types';
import { curriculumGrammarCandidates } from './candidateSources';
import { GRAMMAR_SELF_ASSESS_TASK } from '../windows/levelStudy/grammarSelfAssessmentDecision';

export interface RecallConditionOption {
  groupId: string;
  groupLabel: string;
  capability: string;
  taskIds: string[];
}

/** Discover executable model conditions from actual producer tasks, never a
 * metadata capability checklist. Every condition member needs the same-address
 * requested, unsupplied recall task. Arbitrary package capability IDs fit. */
export function discoverRecallConditionOptions(language: string, groups: ResolvedLearningOutcome['groups'], candidates: readonly Candidate[]): RecallConditionOption[] {
  const eligible = candidates.filter(candidate => candidate.language === language && candidate.task?.responseModality === 'recall');
  const capabilities = [...new Set(eligible.flatMap(candidate => candidate.targets
    .filter(target => candidate.task!.requested.includes(target.capability) && !candidate.task!.supplied.includes(target.capability))
    .map(target => target.capability)))];
  return groups.flatMap(group => capabilities.flatMap(capability => {
    const targets = canonicalRequirementGroupTargets(language, [group], capability);
    const matching = eligible.filter(candidate => candidate.task!.requested.includes(capability) && !candidate.task!.supplied.includes(capability));
    const addresses = new Set(matching.flatMap(candidate => candidate.targets.map(learningAddress)));
    if (!targets.length || targets.some(target => !addresses.has(learningAddress(target)))) return [];
    const wanted = new Set(targets.map(learningAddress));
    return [{ groupId: group.id, groupLabel: group.label ?? group.id, capability,
      taskIds: [...new Set(matching.filter(candidate => candidate.targets.some(target => wanted.has(learningAddress(target)))).map(candidate => candidate.task!.taskTemplateId))] }];
  }));
}

/** This installed activity is the existing self-reported construction recall
 * producer. Other recall producers can join discovery with their actual pools. */
export function installedGoalRecallCandidates(language: string, data: LanguageData | null | undefined): Candidate[] {
  return curriculumGrammarCandidates((data?.grammar ?? []).filter(point => typeof point.level === 'number' && Number.isFinite(point.level)).map(point => ({ language, pattern: point.pattern, level: point.level,
    category: point.category, contentVersion: data?.languageData?.version, task: GRAMMAR_SELF_ASSESS_TASK })));
}

export function editableRecallCondition(value: unknown): value is CanonicalCapabilityThreshold {
  return isCanonicalThreshold(value) && Object.keys(value).every(key => ['id', 'kind', 'groupIds', 'capability', 'minimum'].includes(key));
}

export function canAddPersonalRecallCondition(goal: LearningGoal): boolean {
  const requirements = goal.scope?.requirements;
  return !requirements || (requirements.conditions === undefined
    ? requirements.kind === undefined && requirements.id === undefined
    : Array.isArray(requirements.conditions));
}

/** Edit only intent, preserving opaque siblings, unsupported conditions and
 * binding/history. Malformed condition collections are not silently repaired. */
export function withPersonalRecallCondition(goal: LearningGoal, condition: CanonicalCapabilityThreshold): LearningGoal | null {
  if (!editableRecallCondition(condition)) return null;
  const requirements = goal.scope?.requirements ?? {};
  // Imported direct-root conditions keep their exact representation and ID.
  // Appending would change their meaning under the evaluator's envelope rules.
  if (requirements.conditions === undefined && (requirements.kind !== undefined || requirements.id !== undefined)) {
    if (!editableRecallCondition(requirements) || requirements.id !== condition.id) return null;
    return { ...goal, scope: { ...goal.scope, provenance: goal.scope?.provenance ?? 'user', requirements: { ...condition } } };
  }
  if (requirements.conditions !== undefined && !Array.isArray(requirements.conditions)) return null;
  const conditions = Array.isArray(requirements.conditions) ? requirements.conditions : [];
  const existing = conditions.findIndex(value => !!value && typeof value === 'object' && (value as Record<string, unknown>).id === condition.id);
  if (conditions.filter(value => !!value && typeof value === 'object' && (value as Record<string, unknown>).id === condition.id).length > 1) return null;
  if (existing >= 0 && !editableRecallCondition(conditions[existing])) return null;
  if (existing < 0 && conditions.some(value => editableRecallCondition(value)
    && value.capability === condition.capability && value.groupIds.length === condition.groupIds.length
    && value.groupIds.every(id => condition.groupIds.includes(id)))) return null;
  return { ...goal, scope: { ...goal.scope, provenance: goal.scope?.provenance ?? 'user',
    requirements: { ...requirements, conditions: existing < 0 ? [...conditions, condition] : conditions.map((value, index) => index === existing ? condition : value) } } };
}

export function withoutPersonalRecallCondition(goal: LearningGoal, id: string): LearningGoal | null {
  const requirements = goal.scope?.requirements;
  if (!requirements) return null;
  if (editableRecallCondition(requirements)) {
    if (requirements.id !== id) return null;
    const scope = { ...goal.scope! };
    delete scope.requirements;
    return { ...goal, scope };
  }
  if (!Array.isArray(requirements.conditions)) return null;
  const matches = requirements.conditions.filter(value => !!value && typeof value === 'object' && (value as Record<string, unknown>).id === id);
  if (matches.length !== 1 || !editableRecallCondition(matches[0])) return null;
  return { ...goal, scope: { ...goal.scope!, requirements: { ...requirements, conditions: requirements.conditions.filter(value => value !== matches[0]) } } };
}
