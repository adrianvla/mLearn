import type { KnowledgeProjection } from '../../../shared/graph/ipc';
import type { LearningChoiceSnapshot, LearningDecision } from '../../../shared/learningDecision';
import { isAccessMeasurable, type AttemptScaffolds } from '../../../shared/knowledgeEvents';
import { candidateSupport } from '../../learning/candidateSources';
import { PRESETS, selectNextEncounter } from '../../learning/engine';
import { POLICY_TRACE_VERSION } from '../../learning/teachingPolicy';
import type { PolicyContext, PolicyDecision } from '../../learning/types';
import { wordSyncProbe } from './wordSyncPool';

export const WORD_SYNC_DECISION_WINDOW = 8;

/** The existing level/direction policy chooses an anchor, not a presented word. */
export function wordSyncDecisionWindow(record: { queue: readonly { id: string }[]; index: number; visited: readonly number[] },
  entries: ReadonlyMap<string, { level: number }>): number[] {
  const anchor = record.queue[record.index];
  const level = anchor && entries.get(anchor.id)?.level;
  if (level === undefined) return [];
  const visited = new Set(record.visited);
  const result: number[] = [];
  for (let step = 0; step < record.queue.length && result.length < WORD_SYNC_DECISION_WINDOW; step++) {
    const index = (record.index + step) % record.queue.length;
    if (!visited.has(index) && entries.get(record.queue[index].id)?.level === level) result.push(index);
  }
  return result;
}

export interface WordSyncDecisionItem {
  index: number;
  key: string;
  word: string;
  language: string;
  surfaceId: string;
  possible: readonly string[];
  scaffolds: AttemptScaffolds;
  projection?: KnowledgeProjection;
}

/** Same policy and frozen task/pool; only structural credit changes in the baseline. */
export function selectWordSyncDecision(input: { id: string; at: number;
  items: readonly WordSyncDecisionItem[]; context?: PolicyContext }) {
  if (input.items.length > WORD_SYNC_DECISION_WINDOW) throw new Error('Word Sync decision pool exceeds its work bound');
  const keys = new Set<string>();
  const candidates = input.items.flatMap(item => {
    if (keys.has(item.key)) throw new Error('Word Sync decision pool has ambiguous item identities');
    keys.add(item.key);
    if (item.projection?.status === 'error') return [];
    const probe = wordSyncProbe(item.projection, item.possible, item.surfaceId);
    const targets = probe.targets.filter(target => isAccessMeasurable(target.capability, item.scaffolds));
    if (targets.length === 0) return [];
    // A support prediction for a sense/component is not a prediction of the
    // unresolved surface familiarity this prompt can actually measure.
    const contributors = item.projection?.targets.filter(target => target.targetRef.kind === 'surface'
      && target.targetRef.id === item.surfaceId).flatMap(target => target.states.flatMap(state =>
        state.prediction?.interpretation === 'heuristic-support' ? state.prediction.contributors ?? [] : [])) ?? [];
    const support = candidateSupport(targets, contributors);
    return [{ key: item.key, word: item.word, language: item.language, targets,
      task: { ...PRESETS.CALIBRATION.task, requested: targets.map(target => target.capability) },
      scores: { novelty: 1, 'declared-support': support.credit },
      meta: { index: item.index, focused: probe.focused, support, scaffolds: { ...item.scaffolds } } }];
  });
  if (candidates.length === 0) return null;
  const inputs = { preset: 'CALIBRATION' as const, nowMs: input.at, context: input.context, config: { selection: 'ranked' as const } };
  const selected = selectNextEncounter({ ...inputs, wordSyncPoolItems: candidates });
  const baseline = selectNextEncounter({ ...inputs, wordSyncPoolItems: candidates.map(candidate => ({ ...candidate,
    scores: { ...candidate.scores, 'declared-support': 0 }, meta: { ...candidate.meta, structuralCreditDisabled: true } })) });
  if (!selected || selected.action === 'DEFER') return null;
  const snapshot = (decision: PolicyDecision): LearningChoiceSnapshot => ({ key: decision.candidate.key, action: decision.action,
    targets: decision.encounter.targets.map(target => ({ kind: 'surface', id: target.entityId, capability: target.capability })),
    task: decision.encounter.task });
  const decision: LearningDecision = { id: input.id, at: input.at, policyVersion: selected.trace?.version ?? POLICY_TRACE_VERSION,
    selected: snapshot(selected), baseline: baseline && baseline.action !== 'DEFER' ? snapshot(baseline) : null,
    detail: { scope: 'bounded-same-level-pool', candidateCount: candidates.length,
      baselineWord: baseline?.candidate.word,
      sourceLabels: [...new Set((selected.candidate.meta?.support as ReturnType<typeof candidateSupport> | undefined)?.contributors
        .flatMap(contributor => contributor.sourceLabel ? [contributor.sourceLabel] : []) ?? [])].slice(0, 3),
      trace: selected.trace, baselineTrace: baseline?.trace,
      limits: ['Plain word prompts measure surface familiarity, not isolated dictionary senses.',
        'Declared support is a relative heuristic preference, not probability, measured effort or learning gain.'] } };
  // Durability must freeze inputs before another reactive consumer can mutate them.
  return JSON.parse(JSON.stringify({ index: selected.candidate.meta!.index, focused: selected.candidate.meta!.focused, scaffolds: selected.candidate.meta!.scaffolds, decision })) as {
    index: number; focused: boolean; scaffolds: AttemptScaffolds; decision: LearningDecision;
  };
}
