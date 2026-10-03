/** Technical encounter protocol. Package/task identifiers and semantics stay open-ended. */
export interface LearningTaskSnapshot {
  stages?: Array<{ id: string; inputModality?: string; supplied: string[]; requested: string[] }>;
  taskTemplateId: string;
  inputModality: string;
  responseModality: string;
  supplied: string[];
  requested: string[];
  fluencyRequired: boolean;
  ratingMode: 'profile' | 'dominant';
}

export interface LearningTargetAddress {
  kind: string;
  id: string;
  capability: string;
  to?: string;
}

export interface LearningChoiceSnapshot {
  key: string;
  action: string;
  targets: LearningTargetAddress[];
  task: LearningTaskSnapshot;
  /** Producer-owned description of the actual input; contents stay opaque. */
  presentation?: Record<string, unknown>;
}

/** Persisted before presentation and joined to acknowledged physical outcomes. */
export interface LearningDecision {
  id: string;
  at: number;
  policyVersion: string;
  selected: LearningChoiceSnapshot;
  /** Same frozen eligible pool and random draws with structural credit disabled. */
  baseline: LearningChoiceSnapshot | null;
  /** Bounded policy trace, source provenance and limitations; unknown metadata round-trips. */
  detail: Record<string, unknown>;
}

/** Technical choice-to-response audit, independent of ability projections. */
export interface LearningDecisionRecord {
  decision: LearningDecision;
  attempts: Array<{ attemptId: string; committedRevision: number | null }>;
}

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const identifier = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
const identifiers = (value: unknown): value is string[] => Array.isArray(value) && value.every(identifier);

/** Validate the technical envelope; package identifiers and structured detail stay opaque. */
export function isLearningDecision(value: unknown): value is LearningDecision {
  const choice = (input: unknown): input is LearningChoiceSnapshot => {
    if (!record(input) || !identifier(input.key) || !identifier(input.action) || !Array.isArray(input.targets) || !record(input.task)
      || (input.presentation !== undefined && !record(input.presentation))) return false;
    const task = input.task;
    if (!identifier(task.taskTemplateId) || !identifier(task.inputModality) || !identifier(task.responseModality)
      || !identifiers(task.supplied) || !identifiers(task.requested) || typeof task.fluencyRequired !== 'boolean'
      || (task.ratingMode !== 'profile' && task.ratingMode !== 'dominant')) return false;
    if (task.stages !== undefined && (!Array.isArray(task.stages) || !task.stages.length || !task.stages.every(stage => record(stage) && identifier(stage.id)
      && (stage.inputModality === undefined || identifier(stage.inputModality)) && identifiers(stage.supplied) && identifiers(stage.requested) && stage.requested.every(target => (task.requested as string[]).includes(target))))) return false;
    if (Array.isArray(task.stages)) {
      const supplied = new Set<string>(); const requested = new Set<string>(); const ids = new Set<string>();
      for (const stage of task.stages) {
        if (ids.has(stage.id)) return false; ids.add(stage.id);
        for (const id of stage.supplied) supplied.add(id);
        for (const id of stage.requested) { if (supplied.has(id) || requested.has(id)) return false; requested.add(id); }
      }
      if (requested.size !== task.requested.length || task.requested.some(id => !requested.has(id))) return false;
    }
    const requested = task.requested;
    return input.targets.every(target => record(target) && identifier(target.kind) && identifier(target.id)
      && identifier(target.capability) && requested.includes(target.capability)
      && (target.to === undefined || identifier(target.to)));
  };
  return record(value) && identifier(value.id) && typeof value.at === 'number' && Number.isFinite(value.at)
    && identifier(value.policyVersion) && choice(value.selected) && (value.baseline === null || choice(value.baseline)) && record(value.detail);
}

export function learningDecisionMatchesOutcome(decision: LearningDecision, address: LearningTargetAddress): boolean {
  return decision.selected.targets.some(target => target.kind === address.kind && target.id === address.id
    && target.capability === address.capability && target.to === address.to);
}

/** Only already-prepared measurable outcomes receive this provenance. */
export function applyLearningDecision(events: readonly import('./knowledgeEvents').KnowledgeEvent[], decision: LearningDecision) {
  if (!isLearningDecision(decision)) throw new Error('Malformed learning decision');
  const frozen = JSON.parse(JSON.stringify(decision)) as LearningDecision;
  return events.map((event, index) => {
    const address = event.targetRef;
    if ((event.kind !== 'rating' && event.kind !== 'review') || !address
      || !learningDecisionMatchesOutcome(frozen, address as LearningTargetAddress)) {
      throw new Error('Observed outcome does not match its pinned learning task');
    }
    return { ...event, decisionRef: { id: frozen.id }, ...(index === 0 ? { decision: frozen } : {}) };
  });
}
