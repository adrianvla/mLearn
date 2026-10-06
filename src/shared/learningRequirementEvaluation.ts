import type { KnowledgeEvent } from './knowledgeEvents';
import { eventCapability, eventIsMeasurable, readActiveEvidence } from './knowledgeEvents';
import { grammarEntityId, surfaceEntityId } from './graph/load';
import type { LearnableTarget } from './graph/types';
import { isLearningModelRecallEvidence, learningAddress, predictRecall, type LearningModel } from './learningModel';
import { activeLearningGoals, type LearningGoal } from './learningGoals';
import { resolveLearningOutcome, type ResolvedLearningOutcome } from './learningOutcomes';
import { hashWordSync } from './utils/wordHash';
import type { LanguageData } from './types';

const DAY_MS = 86_400_000;
const MAX_EVIDENCE_REFERENCES = 8;

export type LearningRequirementStatus = 'met' | 'unmet' | 'unknown' | 'unsupported';
export type LearningRequirementSource = 'package' | 'user' | 'assessment' | 'availability';

export interface LearningRequirementEvidenceReference {
  attemptId: string;
  eventId?: string;
  at: number;
  task?: string;
  method?: string;
}

export interface LearningRequirementTargetEvaluation {
  target: LearnableTarget;
  address: string;
  status: Exclude<LearningRequirementStatus, 'unsupported'>;
  threshold: number;
  mean?: number;
  interval?: [number, number];
  observations: number;
  priorDriven: boolean;
  reason?: string;
  evidence: LearningRequirementEvidenceReference[];
}

export interface LearningRequirementConditionEvaluation {
  requirementId: string;
  source: LearningRequirementSource;
  kind: string;
  status: LearningRequirementStatus;
  conditions: unknown;
  packageVersion?: string;
  requestedPackageVersion?: string;
  deadline?: string;
  deadlineMs?: number;
  conditional?: boolean;
  reason?: string;
  targets?: LearningRequirementTargetEvaluation[];
  /** Selection-only deficit inputs. They never update or replace canonical evidence. */
  selection?: {
    assessmentAt: number;
    horizonDays: number;
    targetWeights: Readonly<Record<string, number>>;
  };
}

export interface LearningGoalRequirementEvaluation {
  goalId: string;
  language: string;
  outcomeId: string;
  requestedPackageVersion?: string;
  packageVersion?: string;
  selectedGroupIds?: string[];
  scopeProvenance?: NonNullable<LearningGoal['scope']>['provenance'];
  scopeReference?: string;
  requiredReliability?: number;
  modelVersion: string;
  evidenceVersion: string;
  deadline?: string;
  status: LearningRequirementStatus;
  requirements: LearningRequirementConditionEvaluation[];
}

type CanonicalCapabilityThreshold = {
  id: string;
  kind: 'canonical-capability-threshold';
  groupIds: string[];
  capability: string;
  minimum: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isCanonicalThreshold(value: unknown): value is CanonicalCapabilityThreshold {
  return isRecord(value)
    && typeof value.id === 'string' && value.id.trim().length > 0
    && value.kind === 'canonical-capability-threshold'
    && Array.isArray(value.groupIds) && value.groupIds.length > 0
    && value.groupIds.every(groupId => typeof groupId === 'string' && groupId.trim().length > 0)
    && typeof value.capability === 'string' && value.capability.trim().length > 0
    && typeof value.minimum === 'number' && Number.isFinite(value.minimum)
    && value.minimum >= 0 && value.minimum <= 1;
}

function evidenceForTarget(events: readonly KnowledgeEvent[], target: LearnableTarget, nowMs: number): LearningRequirementEvidenceReference[] {
  const refs: LearningRequirementEvidenceReference[] = [];
  const seenAttempts = new Set<string>();
  let lastObservationAt: number | undefined;
  for (const event of readActiveEvidence(events).filter(event => event.t <= nowMs).sort((left, right) => left.t - right.t)) {
    if (!event.attemptId || (event.kind !== 'rating' && event.kind !== 'review')
      || (event.quality === undefined && event.rating === undefined)
      || event.targetRef?.to || event.targetRef?.id !== target.entityId || eventCapability(event) !== target.capability
      || !eventIsMeasurable(event)) continue;
    const identity = `${learningAddress(target)}:${event.attemptId}`;
    if (seenAttempts.has(identity)) continue;
    seenAttempts.add(identity);
    if (!isLearningModelRecallEvidence(event) || (lastObservationAt !== undefined && event.t - lastObservationAt < DAY_MS)) continue;
    refs.push({ attemptId: event.attemptId, ...(event.eventId ? { eventId: event.eventId } : {}), at: event.t,
      ...(event.decision?.selected.task.taskTemplateId || event.taskType
        ? { task: event.decision?.selected.task.taskTemplateId ?? event.taskType } : {}),
      ...(event.method ? { method: event.method } : {}) });
    lastObservationAt = event.t;
  }
  return refs.slice(-MAX_EVIDENCE_REFERENCES);
}

function goalStatus(requirements: readonly LearningRequirementConditionEvaluation[]): LearningRequirementStatus {
  if (requirements.some(requirement => requirement.status === 'unmet')) return 'unmet';
  if (requirements.some(requirement => requirement.status === 'unsupported')) return 'unsupported';
  if (requirements.some(requirement => requirement.status === 'unknown')) return 'unknown';
  return requirements.length ? 'met' : 'unknown';
}

function conditionsFrom(value: unknown): unknown[] | null {
  if (!isRecord(value)) return null;
  if (Array.isArray(value.conditions)) return value.conditions;
  if (typeof value.kind === 'string' || typeof value.id === 'string') return [value];
  return null;
}

function unsupportedCondition(
  goal: LearningGoal,
  source: LearningRequirementSource,
  requirementId: string,
  kind: string,
  conditions: unknown,
  packageVersion?: string,
  reason = 'requirement-unsupported',
): LearningRequirementConditionEvaluation {
  return { requirementId, source, kind, status: 'unsupported', conditions,
    ...(packageVersion ? { packageVersion } : {}), ...(goal.outcomeRef?.packageVersion ? { requestedPackageVersion: goal.outcomeRef.packageVersion } : {}),
    ...(goal.deadline ? { deadline: goal.deadline } : {}), reason };
}

function evaluateCondition(
  goal: LearningGoal,
  source: 'package' | 'user',
  raw: unknown,
  groups: ResolvedLearningOutcome['groups'],
  model: LearningModel,
  events: readonly KnowledgeEvent[],
  nowMs: number,
  packageVersion?: string,
): LearningRequirementConditionEvaluation {
  const condition = isRecord(raw) ? raw : {};
  const requirementId = typeof condition.id === 'string' && condition.id.trim() ? condition.id : `${source}-condition`;
  const kind = typeof condition.kind === 'string' ? condition.kind : 'opaque';
  if (!isCanonicalThreshold(raw)) {
    return unsupportedCondition(goal, source, requirementId, kind, raw, packageVersion);
  }

  const selectedGroups = groups.filter(group => raw.groupIds.includes(group.id));
  if (selectedGroups.length !== new Set(raw.groupIds).size) {
    return unsupportedCondition(goal, source, requirementId, kind, raw, packageVersion, 'requirement-group-unavailable');
  }
  const targets = new Map<string, LearnableTarget>();
  for (const group of selectedGroups) {
    for (const word of group.words) {
      const target = { entityId: surfaceEntityId(goal.language, hashWordSync(word)), capability: raw.capability };
      targets.set(learningAddress(target), target);
    }
    for (const pattern of group.patterns) {
      const target = { entityId: grammarEntityId(goal.language, pattern), capability: raw.capability };
      targets.set(learningAddress(target), target);
    }
  }
  if (targets.size === 0) {
    return { requirementId, source, kind, status: 'unknown', conditions: raw,
      ...(packageVersion ? { packageVersion } : {}), ...(goal.outcomeRef?.packageVersion ? { requestedPackageVersion: goal.outcomeRef.packageVersion } : {}),
      ...(goal.deadline ? { deadline: goal.deadline } : {}), reason: 'requirement-has-no-resolved-targets', conditional: true, targets: [] };
  }

  const deadlineMs = goal.deadline ? Date.parse(goal.deadline) : undefined;
  if (goal.deadline && !Number.isFinite(deadlineMs)) {
    return unsupportedCondition(goal, source, requirementId, kind, raw, packageVersion, 'deadline-invalid');
  }
  const base = { goalId: goal.id, requirementId, source, kind, conditions: raw,
    ...(packageVersion ? { packageVersion } : {}), ...(goal.outcomeRef?.packageVersion ? { requestedPackageVersion: goal.outcomeRef.packageVersion } : {}),
    ...(goal.deadline ? { deadline: goal.deadline } : {}), ...(deadlineMs !== undefined ? { deadlineMs } : {}) };
  if (deadlineMs !== undefined && deadlineMs < nowMs) {
    return { ...base, status: 'unknown', reason: 'deadline-past', conditional: true, targets: [] };
  }

  const assessmentAt = deadlineMs ?? nowMs;
  const targetResults = [...targets.entries()].map(([address, target]): LearningRequirementTargetEvaluation => {
    const prediction = predictRecall(model, address, assessmentAt);
    const evidence = evidenceForTarget(events, target, nowMs);
    const supported = prediction.observations > 0 && evidence.length > 0;
    const status = !supported ? 'unknown'
      : prediction.mean >= raw.minimum ? 'met' : 'unmet';
    return { target, address, status, threshold: raw.minimum, mean: prediction.mean, interval: prediction.interval,
      observations: prediction.observations, priorDriven: prediction.priorDriven,
      ...(!supported ? { reason: prediction.observations || evidence.length ? 'canonical-evidence-unavailable' : 'no-canonical-evidence' } : {}), evidence };
  });
  const status: LearningRequirementStatus = targetResults.some(target => target.status === 'unmet') ? 'unmet'
    : targetResults.some(target => target.status === 'unknown') ? 'unknown' : 'met';
  const horizonDays = deadlineMs === undefined ? 30 : Math.max(0, (deadlineMs - nowMs) / DAY_MS);
  const targetWeights = Object.fromEntries(targetResults.flatMap(target => {
    if (target.status === 'met') return [];
    const gap = target.status === 'unmet' && target.mean !== undefined
      ? Math.max(0.01, raw.minimum - target.mean)
      : Math.max(0.05, raw.minimum - (target.mean ?? 0));
    return [[target.address, gap / targetResults.length]];
  }));
  return { ...base, status, conditional: true, targets: targetResults,
    ...(status !== 'met' ? { selection: { assessmentAt, horizonDays, targetWeights } } : {}) };
}

/** Derives one conjunctive status per active goal; it never writes or synthesizes evidence. */
export function evaluateLearningRequirements(
  goals: readonly LearningGoal[],
  language: string,
  model: LearningModel,
  events: readonly KnowledgeEvent[],
  data: LanguageData | null | undefined,
  nowMs: number,
): LearningGoalRequirementEvaluation[] {
  return activeLearningGoals(goals, language).map(goal => {
    const packageVersion = data?.languageData?.version;
    const conditions: LearningRequirementConditionEvaluation[] = [];
    const finish = (outcomeId: string): LearningGoalRequirementEvaluation => ({ goalId: goal.id, language: goal.language,
      outcomeId, ...(goal.outcomeRef?.packageVersion ? { requestedPackageVersion: goal.outcomeRef.packageVersion } : {}),
      ...(packageVersion ? { packageVersion } : {}), ...(goal.outcomeRef?.groupIds ? { selectedGroupIds: [...goal.outcomeRef.groupIds] } : {}),
      ...(goal.scope?.provenance ? { scopeProvenance: goal.scope.provenance } : {}),
      ...(goal.scope?.reference ? { scopeReference: goal.scope.reference } : {}),
      ...(goal.requiredReliability !== undefined ? { requiredReliability: goal.requiredReliability } : {}),
      modelVersion: model.version, evidenceVersion: model.evidenceVersion, ...(goal.deadline ? { deadline: goal.deadline } : {}),
      status: goalStatus(conditions), requirements: conditions });

    if (goal.requiredReliability !== undefined) {
      conditions.push(unsupportedCondition(goal, 'user', 'requiredReliability', 'calibrated-reliability-threshold',
        { value: goal.requiredReliability }, packageVersion, 'reliability-calibration-unavailable'));
    }

    if (!data || !goal.outcomeRef) {
      conditions.push(unsupportedCondition(goal, 'availability', 'outcome-reference', 'outcome-reference', goal.outcomeRef ?? null,
        packageVersion, 'package-unavailable'));
      return finish(goal.outcomeRef?.id ?? '');
    }
    if (goal.outcomeRef.packageVersion && goal.outcomeRef.packageVersion !== packageVersion) {
      conditions.push(unsupportedCondition(goal, 'availability', 'package-version', 'package-version', {
        requested: goal.outcomeRef.packageVersion, installed: packageVersion,
      }, packageVersion, 'package-version-unavailable'));
      return finish(goal.outcomeRef.id);
    }

    const resolved = resolveLearningOutcome(data, goal.outcomeRef.id);
    if (!resolved?.complete) {
      conditions.push(unsupportedCondition(goal, 'availability', 'outcome-reference', 'outcome-reference', goal.outcomeRef,
        packageVersion, 'outcome-unavailable'));
      return finish(goal.outcomeRef.id);
    }
    const selected = resolveLearningOutcome(data, goal.outcomeRef.id, goal.outcomeRef.groupIds);
    if (!selected?.complete) {
      conditions.push(unsupportedCondition(goal, 'availability', 'selected-groups', 'selected-groups', goal.outcomeRef.groupIds,
        packageVersion, 'selected-groups-unavailable'));
    }

    const packageRequirements = resolved.declaration.requirements;
    const packageConditions = conditionsFrom(packageRequirements);
    if (packageRequirements !== undefined) {
      if (packageConditions) {
        for (const raw of packageConditions) {
          conditions.push(evaluateCondition(goal, 'package', raw, resolved.groups, model, events, nowMs, packageVersion));
        }
        if (isRecord(packageRequirements)) {
          const extensions = Object.fromEntries(Object.entries(packageRequirements).filter(([key]) => key !== 'conditions'));
          if (Object.keys(extensions).length) conditions.push(unsupportedCondition(goal, 'package', 'package-requirements-extension',
            'opaque', extensions, packageVersion));
        }
      } else {
        const malformed = isRecord(packageRequirements) && Object.prototype.hasOwnProperty.call(packageRequirements, 'conditions');
        conditions.push(unsupportedCondition(goal, 'package', malformed ? 'package-conditions' : 'package-requirements',
          malformed ? 'malformed-conditions' : 'opaque', packageRequirements, packageVersion,
          malformed ? 'malformed-conditions' : 'requirement-unsupported'));
      }
    }

    const userRequirements = goal.scope?.requirements;
    const mirrorsPackageRequirements = goal.scope?.provenance !== 'user' && !!packageRequirements
      && JSON.stringify(userRequirements) === JSON.stringify(packageRequirements);
    if (userRequirements && !mirrorsPackageRequirements) {
      const userConditions = conditionsFrom(userRequirements);
      if (userConditions) {
        for (const raw of userConditions) {
          conditions.push(evaluateCondition(goal, 'user', raw, resolved.groups, model, events, nowMs, packageVersion));
        }
      } else {
        conditions.push(unsupportedCondition(goal, 'user', 'user-requirements', 'opaque', userRequirements, packageVersion));
      }
    }

    if (resolved.declaration.assessment?.conditions !== undefined) {
      conditions.push(unsupportedCondition(goal, 'assessment', 'assessment.conditions', 'provider-assessment',
        resolved.declaration.assessment.conditions, packageVersion, 'assessment-provider-unavailable'));
    }
    return finish(goal.outcomeRef.id);
  });
}
