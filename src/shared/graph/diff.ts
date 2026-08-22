import type { GraphEntity, LinguisticGraphAsset } from './types';

export interface GraphDiff {
  added: string[];
  removed: string[];
  /** Present in both but with altered kind/domain/label. */
  changed: string[];
  /** Same id mapped to a different entity KIND across builds — must never silently remap learner evidence. */
  ambiguous: string[];
}

/**
 * Identity/versioning diagnostics between two graph builds of one language.
 * Package updates run this before adoption; `ambiguous` fails conservative.
 */
export function diffGraphAssets(prev: LinguisticGraphAsset, next: LinguisticGraphAsset): GraphDiff {
  const prevEntities = new Map<string, GraphEntity>(prev.entities.map((entity) => [entity.id, entity]));
  const nextEntities = new Map<string, GraphEntity>(next.entities.map((entity) => [entity.id, entity]));

  const added: string[] = [];
  const removed: string[] = [];
  const changed: string[] = [];
  const ambiguous: string[] = [];

  for (const [id, entity] of nextEntities) {
    const before = prevEntities.get(id);
    if (!before) {
      added.push(id);
      continue;
    }
    if (before.kind !== entity.kind) {
      ambiguous.push(id);
      continue;
    }
    if (before.domain !== entity.domain || before.label !== entity.label) {
      changed.push(id);
    }
  }
  for (const id of prevEntities.keys()) {
    if (!nextEntities.has(id)) removed.push(id);
  }

  return { added, removed, changed, ambiguous };
}
