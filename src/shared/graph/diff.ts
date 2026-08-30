import { COMPACT_ENTITY_KINDS, type CompactAssetJSON } from './compact';
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
 * Core identity diff over plain entity lists; see diffGraphAssets.
 */
export function diffGraphEntityIdentity(prev: readonly GraphEntity[], next: readonly GraphEntity[]): GraphDiff {
  const prevEntities = new Map<string, GraphEntity>(prev.map((entity) => [entity.id, entity]));
  const nextEntities = new Map<string, GraphEntity>(next.map((entity) => [entity.id, entity]));

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

/**
 * Identity/versioning diagnostics between two graph builds of one language.
 * Package updates run this before adoption; `ambiguous` fails conservative.
 */
export function diffGraphAssets(prev: LinguisticGraphAsset, next: LinguisticGraphAsset): GraphDiff {
  return diffGraphEntityIdentity(prev.entities, next.entities);
}

/**
 * Kind-only identity view of a compact graph asset: entity ids are the string
 * table prefix and kinds the byte table, so no relation decode is needed.
 * Domain/label stay undecoded — kind is the identity-critical axis for the
 * package-update guard; label/domain drift is `changed`, not `ambiguous`.
 */
export function diffCompactGraphAssets(prev: CompactAssetJSON, next: CompactAssetJSON): GraphDiff {
  return diffGraphEntityIdentity(compactIdentityEntities(prev), compactIdentityEntities(next));
}

function compactIdentityEntities(compact: CompactAssetJSON): GraphEntity[] {
  const kindIds = compact.entities?.kindIds;
  const stringTable = compact.stringTable;
  if (!Array.isArray(kindIds) || !Array.isArray(stringTable)) {
    throw new Error('Compact graph asset is missing the entity identity tables');
  }
  return stringTable.slice(0, kindIds.length).map((id, index) => {
    const kind = COMPACT_ENTITY_KINDS[kindIds[index]];
    if (id === undefined || kind === undefined) {
      throw new Error(`Compact graph asset has an invalid entity identity at index ${index}`);
    }
    return { id, kind };
  });
}
