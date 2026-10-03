/** Cue semantics come from the producer/package. Core orders opaque access IDs. */
export interface RetrievalStage {
  id: string;
  cueKey: string;
  targets: string[];
  suppliedAccesses: string[];
}

/** Group equal cues, then order requests before later stages supply their answer.
 * A contamination cycle cannot be rescued by reveal order: keep its stages
 * in different encounters. Answers remain hidden until the final comparison. */
export function composeRetrievalStages<T extends RetrievalStage>(input: readonly T[]): T[][] {
  const stages: T[] = [];
  for (const stage of input) {
    if (!stage.id || !stage.targets.length || stage.targets.some(target => stage.suppliedAccesses.includes(target))) continue;
    const prior = stages.find(item => item.cueKey === stage.cueKey && JSON.stringify(item.suppliedAccesses.slice().sort()) === JSON.stringify(stage.suppliedAccesses.slice().sort()));
    if (prior) prior.targets = [...new Set([...prior.targets, ...stage.targets])];
    else stages.push({ ...stage, targets: [...new Set(stage.targets)], suppliedAccesses: [...new Set(stage.suppliedAccesses)] });
  }
  const pending = new Set(stages);
  const ordered: T[] = [];
  while (pending.size) {
    const ready = [...pending].find(stage => ![...pending].some(other => other !== stage
      && other.targets.some(target => stage.suppliedAccesses.includes(target))));
    if (!ready) return ordered.length ? [ordered, ...[...pending].map(stage => [stage])] : [...pending].map(stage => [stage]);
    ordered.push(ready); pending.delete(ready);
  }
  return ordered.length ? [ordered] : [];
}
