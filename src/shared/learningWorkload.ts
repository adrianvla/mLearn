import { evaluateLearningAction, type LearningModel } from './learningModel';
import type { LearningOpportunities } from './learningOpportunities';

export interface ScopeWorkload {
  /** Stable runnable item identities deduplicate overlapping scopes. */
  items: readonly { id: string; family: string }[];
}

/** A necessary workload check, not a forecast of acquisition, exam scores or passing. */
export function forecastScopeWorkload(model: LearningModel, work: ScopeWorkload,
  opportunities: LearningOpportunities, now: number, deadline: number) {
  const unique = new Map(work.items.map(item => [item.id, item]));
  const families = new Map<string, ReturnType<typeof evaluateLearningAction>['effort']>();
  let requiredMean = 0; let requiredLow = 0; let requiredHigh = 0;
  for (const item of unique.values()) {
    if (!families.has(item.family)) families.set(item.family, evaluateLearningAction(model,
      { key: 'workload', family: item.family, targets: [], mode: 'diagnostic' },
      { nowMs: now, horizonDays: 0, deferDays: 0 }).effort);
    const effort = families.get(item.family)!;
    requiredMean += effort.meanSeconds;
    requiredLow += effort.interval[0]; requiredHigh += effort.interval[1];
  }
  const gaps = opportunities.gapDays.filter(value => Number.isFinite(value) && value > 0);
  const durations = opportunities.availableSeconds.filter(value => Number.isFinite(value) && value > 0);
  const futureDays = (deadline - now) / 86_400_000;
  const estimated = Number.isFinite(futureDays) && futureDays > 0 && gaps.length > 0 && durations.length > 0;
  // Constant-pattern scenarios are sensitivity bounds, not confidence bounds:
  // observed duration is censored and repeating past gaps is not a calendar.
  const seconds = estimated ? [Math.min(...durations) * (1 + Math.floor(futureDays / Math.max(...gaps))),
    Math.max(...durations) * (1 + Math.floor(futureDays / Math.min(...gaps)))] as [number, number] : undefined;
  return { version: 'scope-workload@1', items: unique.size, deadline,
    requiredActiveSeconds: { mean: requiredMean, interval: [requiredLow, requiredHigh] as [number, number] },
    possibleActiveSeconds: seconds,
    status: !estimated ? 'not-estimated' as const
      : requiredLow > seconds![1] ? 'one-pass-exceeds-opportunity-scenarios' as const : 'indeterminate' as const,
    priorDriven: opportunities.priorDriven || [...families.values()].some(effort => effort.samples === 0),
    effortSources: [...families].map(([family, effort]) => ({ family, ...effort })),
    modelVersion: model.version, evidenceVersion: model.evidenceVersion,
    counterfactual: 'current-opportunity-pattern-continues' as const,
    limits: ['One supported encounter per currently unassessed item is only a necessary coverage workload; it does not establish durable learning or satisfy an official assessment.',
      'Bounds vary observed gaps, censored durations with declared headroom and task-effort intervals. They are scenario sensitivity, not a calibrated probability or guaranteed free time.',
      'The most optimistic scenario can still miss the deadline; fitting in a scenario does not prove readiness. No added study, changed deadline or lowered requirement is assumed.',
      'The current opportunity is included once. Future opportunities repeat the selected gap/duration; nonstationary habits and correlated costs remain uncertain.'] };
}
