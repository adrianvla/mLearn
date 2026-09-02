import {
  GRAPH_SCHEMA_VERSION,
  RELATION_CATEGORY,
  type GraphDomain,
  type GraphEntity,
  type GraphRelation,
  type LinguisticGraphAsset,
  type RelationCategory,
} from './types';

/**
 * Boring-fast runtime representation: plain Maps, dense integer ids for hot
 * paths. Loaded from a versioned LinguisticGraphAsset; nothing here mutates
 * the asset. No packed structures until benchmarks demand them.
 */
export interface LingualGraph {
  asset: LinguisticGraphAsset;
  nodes: Map<string, GraphEntity>;
  outgoing: Map<string, GraphRelation[]>;
  incoming: Map<string, GraphRelation[]>;
  /** dense runtime id ↔ persistent id */
  denseOf: Map<string, number>;
  persistentOf: string[];
}

export class GraphLoadError extends Error {}

/** Surface entity ids embed the canonical SHA-256 surface hash as localId, giving legacy evidence free aliasing. */
export function surfaceEntityId(language: string, surfaceHash: string): string {
  return `${language}:surface:${surfaceHash}`;
}

export function grammarEntityId(language: string, pattern: string): string {
  return `${language}:grammar:${pattern.normalize('NFC').trim().replace(/\s+/g, ' ')}`;
}

export function loadLinguisticGraph(asset: LinguisticGraphAsset): LingualGraph {
  if (asset.schemaVersion !== GRAPH_SCHEMA_VERSION) {
    throw new GraphLoadError(`Unsupported graph schemaVersion ${asset.schemaVersion} (expected ${GRAPH_SCHEMA_VERSION})`);
  }
  const nodes = new Map<string, GraphEntity>();
  for (const entity of asset.entities) {
    if (nodes.has(entity.id)) throw new GraphLoadError(`Duplicate entity id: ${entity.id}`);
    nodes.set(entity.id, entity);
  }
  const outgoing = new Map<string, GraphRelation[]>();
  const incoming = new Map<string, GraphRelation[]>();
  for (const relation of asset.relations) {
    if (!nodes.has(relation.from) || !nodes.has(relation.to)) {
      throw new GraphLoadError(`Relation references unknown entity: ${relation.from} -> ${relation.to}`);
    }
    const out = outgoing.get(relation.from);
    if (out) out.push(relation); else outgoing.set(relation.from, [relation]);
    const inc = incoming.get(relation.to);
    if (inc) inc.push(relation); else incoming.set(relation.to, [relation]);
  }
  const denseOf = new Map<string, number>();
  const persistentOf: string[] = [];
  let next = 0;
  for (const id of nodes.keys()) {
    denseOf.set(id, next);
    persistentOf.push(id);
    next += 1;
  }
  return { asset, nodes, outgoing, incoming, denseOf, persistentOf };
}

export function relationsOf(
  graph: LingualGraph,
  id: string,
  opts?: { category?: RelationCategory; direction?: 'out' | 'in' | 'both' },
): GraphRelation[] {
  const direction = opts?.direction ?? 'both';
  const collected: GraphRelation[] = [];
  const push = (relations: GraphRelation[] | undefined) => {
    if (!relations) return;
    for (const relation of relations) {
      if (opts?.category && RELATION_CATEGORY[relation.type] !== opts.category) continue;
      collected.push(relation);
    }
  };
  if (direction === 'out' || direction === 'both') push(graph.outgoing.get(id));
  if (direction === 'in' || direction === 'both') push(graph.incoming.get(id));
  return collected;
}

/** Neighbor ids connected via identity-category relations (the ONLY shared-identity definition). */
export function identityNeighbors(graph: LingualGraph, id: string): string[] {
  return relationsOf(graph, id, { category: 'identity' }).map((relation) =>
    relation.from === id ? relation.to : relation.from,
  );
}

export function entitiesInDomains(graph: LingualGraph, enabled: readonly GraphDomain[]): GraphEntity[] {
  return [...graph.nodes.values()].filter((entity) =>
    entity.domain === undefined ? true : enabled.includes(entity.domain),
  );
}
