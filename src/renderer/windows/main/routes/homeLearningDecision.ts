import type { LearningTaskSnapshot } from '../../../../shared/learningDecision';
import { chooseLearningSequence, learningActionsCanCombine, predictRecall, type EvaluationContext, type LearningAction, type LearningModel } from '../../../../shared/learningModel';
import { evaluateLearningActions, learningSequenceDelay } from '../../../../shared/learningInformation';
import { forecastPreparationOffThread } from '../../../services/learningPreparationForecast';
import type { LearningOpportunities } from '../../../../shared/learningOpportunities';
import { manageableEncounterCount } from '../../../../shared/learningOpportunities';

export interface HomeLearningCandidate extends LearningAction {
  action: 'review' | 'practice' | 'grammar' | 'continue' | 'read';
  cardId?: string;
  reviewActivityId?: string;
  retrievalTask?: LearningTaskSnapshot;
  presentation?: Record<string, unknown>;
  intent?: 'reinforce';
  words?: string[];
  patterns?: string[];
}

const runnableCandidates = (candidates: readonly HomeLearningCandidate[]) => candidates.map(candidate =>
  candidate.cardId
    ? { ...candidate, exclusiveOpportunityGroups: [...new Set([...(candidate.exclusiveOpportunityGroups ?? []), `review-card:${candidate.cardId}`])] } : candidate);

/** Runnable admission, not a readiness classifier: action values compare the full pool. */
export function homePracticePool(model: LearningModel, scopeByEntity: ReadonlyMap<string, string>,
  unresolved: readonly string[], isKnown: (word: string) => boolean, now: number, forecastAt: number) {
  const maintenance = new Map<string, number>();
  for (const [address, memory] of Object.entries(model.memories)) {
    if (now - memory.lastAt < 86_400_000) continue; // Do not repeat newly answered material to manufacture retention evidence.
    const entity = (JSON.parse(address) as string[])[0];
    const word = scopeByEntity.get(entity);
    if (!word || !isKnown(word)) continue;
    const drift = predictRecall(model, address, now).mean - predictRecall(model, address, Math.max(now, forecastAt)).mean;
    maintenance.set(word, Math.max(maintenance.get(word) ?? 0, drift));
  }
  const kept = [...maintenance].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([word]) => ({ word, intent: 'reinforce' as const }));
  const seen = new Set(kept.map(item => item.word));
  return [...unresolved.filter(word => !seen.has(word)).map(word => ({ word, intent: undefined })), ...kept];
}

/** Home chooses a handoff. The existing activity owns admission, interaction and canonical outcomes. */
export function chooseHomeLearningChoice(model: LearningModel, candidates: readonly HomeLearningCandidate[],
  context: EvaluationContext, availableSeconds: readonly number[]) {
  const runnable = runnableCandidates(candidates);
  const byKey = new Map(runnable.map(candidate => [candidate.key, candidate]));
  const canCombine: NonNullable<Parameters<typeof chooseLearningSequence>[1]['canCombine']> = (left, right) =>
    learningActionsCanCombine(byKey.get(left.key), byKey.get(right.key));
  const values = evaluateLearningActions(model, runnable, context, { availableSeconds, continuationValue: 0, canCombine });
  const continuation = runnable.find(candidate => candidate.action === 'continue')
    ?? { key: 'open-reader', family: 'reader', mode: 'immersion' as const, action: 'read' as const, targets: [] };
  const continuationValue = values.find(value => value.key === continuation.key)?.expectedCapabilityDays ?? 0;
  const singleValues = new Map(values.map(value => [value.key, chooseLearningSequence([value], { availableSeconds, continuationValue: 0 }).value]));
  const ranked = [...values].sort((a, b) => singleValues.get(b.key)! - singleValues.get(a.key)! || a.key.localeCompare(b.key));
  const interventions = ranked.filter(value => byKey.get(value.key)?.mode !== 'immersion');
  const delay = learningSequenceDelay(model, runnable, context);
  const sequence = chooseLearningSequence(interventions, { availableSeconds, continuationValue,
    canCombine, delayedValue: delay.delayedValue, delayedIdentity: delay.delayedIdentity,
  });
  const selected = sequence.keys.length ? byKey.get(sequence.keys[0])! : continuation;
  const effort = values.find(value => value.key === selected.key)?.effort.meanSeconds ?? 30;
  const valuesByKey = new Map(values.map(value => [value.key, value]));
  const inspected = [...new Set([selected.key, continuation.key, ...ranked.map(value => value.key)])].flatMap(key => valuesByKey.get(key) ?? []);
  return { selected, encounterLimit: manageableEncounterCount({ availableSeconds: [...availableSeconds] }, effort),
    trace: { evaluatedAt: context.nowMs, modelVersion: model.version, evidenceVersion: model.evidenceVersion, evaluations: inspected.slice(0, 32),
      evaluationsOmitted: Math.max(0, values.length - 32), selectedKey: selected.key, sequence: sequence.keys, sequenceValue: sequence.value, sequenceTiming: 'ordered-completion' as const,
      alternative: continuation.key, horizonDays: context.horizonDays, deferDays: context.deferDays,
      limits: [...model.limits, 'Immersion transfer estimates require explicit target/transfer provenance; absent transfer is unmodelled, not measured zero comprehension.',
        'All eligible single actions are compared. A finite Review chunk serves a card once, so its alternative first activities cannot form an executable pair. Pair search is bounded to 32 candidates ranked by total feasible single-action value, not gain per second; omitted pairs can still matter.',
        'A prior-based comparison is provisional and can reverse under different transfer assumptions. Available active time is a censored lower bound.'] } };
}

export function chooseHomeLearningAction(model: LearningModel, candidates: readonly HomeLearningCandidate[],
  context: EvaluationContext, availableSeconds: readonly number[], opportunities?: LearningOpportunities,
  preparationTasks?: () => readonly LearningAction[]) {
  const runnable = runnableCandidates(candidates);
  const choice = chooseHomeLearningChoice(model, runnable, context, availableSeconds);
  return { ...choice, preparationForecast: () => opportunities
    ? forecastPreparationOffThread(model, runnable, choice.selected, context, opportunities, preparationTasks?.()) : Promise.resolve(undefined) };
}
