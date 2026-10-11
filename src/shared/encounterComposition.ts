/** Cue semantics come from the producer/package. Core orders opaque access IDs. */
export interface RetrievalStage {
  id: string;
  cueKey: string;
  targets: string[];
  suppliedAccesses: string[];
  /** Original package stage identities retained when compatible requests coalesce. */
  sourceStageIds?: string[];
}

export interface InvalidRetrievalStage {
  id: string;
  reason: 'missing-identity' | 'empty-targets' | 'self-supplied-target' | 'duplicate-identity';
}

export interface RetrievalStageComposition<T extends RetrievalStage> {
  /** Each group is one encounter; its stages are returned in safe reveal order. */
  groups: T[][];
  /** Invalid declarations are surfaced to the caller instead of silently dropped. */
  invalid: InvalidRetrievalStage[];
  /** Exact minimum partition for at most 12 coalesced stages; deterministic first-fit above that. */
  method: 'exact' | 'bounded-fallback';
}

function topologicalOrder<T extends RetrievalStage>(stages: readonly T[]): T[] | null {
  const pending = new Set(stages);
  const ordered: T[] = [];
  while (pending.size) {
    // A stage must be shown before any other stage that supplies one of its answers.
    const ready = [...pending].find(stage => ![...pending].some(other => other !== stage
      && other.targets.some(target => stage.suppliedAccesses.includes(target))));
    if (!ready) return null;
    ordered.push(ready);
    pending.delete(ready);
  }
  return ordered;
}

function composeCompatibleStages<T extends RetrievalStage>(input: readonly T[]): { stages: T[]; invalid: InvalidRetrievalStage[] } {
  const stages: T[] = [];
  const invalid: InvalidRetrievalStage[] = [];
  const seenIds = new Set<string>();
  for (const stage of input) {
    if (!stage?.id?.trim() || !stage.cueKey?.trim() || !Array.isArray(stage.targets)
      || !Array.isArray(stage.suppliedAccesses)) {
      invalid.push({ id: typeof stage?.id === 'string' ? stage.id : '', reason: 'missing-identity' });
      continue;
    }
    if (seenIds.has(stage.id)) {
      invalid.push({ id: stage.id, reason: 'duplicate-identity' });
      continue;
    }
    seenIds.add(stage.id);
    const targets = [...new Set(stage.targets.filter(value => typeof value === 'string' && value.trim()))];
    const suppliedAccesses = [...new Set(stage.suppliedAccesses.filter(value => typeof value === 'string' && value.trim()))];
    if (!targets.length) {
      invalid.push({ id: stage.id, reason: 'empty-targets' });
      continue;
    }
    if (targets.some(target => suppliedAccesses.includes(target))) {
      invalid.push({ id: stage.id, reason: 'self-supplied-target' });
      continue;
    }
    const prior = stages.find(item => item.cueKey === stage.cueKey
      && JSON.stringify([...item.suppliedAccesses].sort()) === JSON.stringify([...suppliedAccesses].sort()));
    if (prior) {
      prior.targets = [...new Set([...prior.targets, ...targets])];
      prior.sourceStageIds = [...(prior.sourceStageIds ?? [prior.id]), stage.id];
    } else {
      stages.push({ ...stage, targets, suppliedAccesses, sourceStageIds: [...(stage.sourceStageIds ?? [stage.id])] });
    }
  }
  return { stages, invalid };
}

/**
 * Compose all valid stages into safe encounters. Small packages use an exact
 * minimum partition over acyclic reveal orders. Larger declarations use a
 * deterministic bounded first-fit so untrusted package size cannot create
 * exponential work on the renderer thread.
 */
export function composeRetrievalStages<T extends RetrievalStage>(input: readonly T[]): RetrievalStageComposition<T> {
  const { stages, invalid } = composeCompatibleStages(input);
  if (!stages.length) return { groups: [], invalid, method: 'exact' };

  if (stages.length > 12) {
    const groups: T[][] = [];
    for (const stage of stages) {
      const group = groups.find(candidate => topologicalOrder([...candidate, stage]) !== null);
      if (group) group.push(stage);
      else groups.push([stage]);
    }
    return { groups: groups.map(group => topologicalOrder(group)!), invalid, method: 'bounded-fallback' };
  }

  const count = stages.length;
  const fullMask = (1 << count) - 1;
  const validOrder = new Map<number, T[] | null>();
  const orderFor = (mask: number): T[] | null => {
    if (!validOrder.has(mask)) validOrder.set(mask, topologicalOrder(stages.filter((_, index) => (mask & (1 << index)) !== 0)));
    return validOrder.get(mask)!;
  };
  const best = new Array<number>(fullMask + 1).fill(Number.POSITIVE_INFINITY);
  const choice = new Array<number>(fullMask + 1).fill(0);
  best[0] = 0;
  for (let mask = 1; mask <= fullMask; mask++) {
    const anchor = mask & -mask;
    for (let subset = mask; subset; subset = (subset - 1) & mask) {
      if ((subset & anchor) === 0 || best[mask ^ subset] + 1 >= best[mask] || !orderFor(subset)) continue;
      best[mask] = best[mask ^ subset] + 1;
      choice[mask] = subset;
    }
  }
  const groups: T[][] = [];
  for (let remaining = fullMask; remaining;) {
    const subset = choice[remaining];
    groups.push(orderFor(subset)!);
    remaining ^= subset;
  }
  return { groups, invalid, method: 'exact' };
}
