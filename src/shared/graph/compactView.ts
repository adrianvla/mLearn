import { COMPACT_DOMAINS, COMPACT_ENTITY_KINDS, COMPACT_RELATION_TYPES, type RuntimeCompactGraph } from './compact';
import { GRAPH_SCHEMA_VERSION, type GraphEntity, type GraphRelation, type LinguisticGraphAsset } from './types';
import type { LingualGraph } from './load';

/**
 * LingualGraph-compatible view over a RuntimeCompactGraph. Serves the
 * projection pipeline (relationsOf / nodes.get / learnableTargetsFor) without
 * materializing per-entity or per-relation objects for the whole graph — the
 * former full plain-object replica roughly doubled the ~1 GB decoded compact
 * footprint and was the electron-main OOM anchor when projections queued
 * (Word DB scroll, hover storms).
 *
 * Orientation note: the compact CSR stores every relation in both directions
 * without a direction bit, so each edge copy reconstructed from node N's
 * slice is emitted as from=N (outgoing) and to=N (incoming). This is exactly
 * the reconstruction the previous plain-object replica produced (including
 * its symmetric copies), so consumers observe identical behavior at a
 * fraction of the memory: only the edges of touched nodes become objects,
 * and they are cached per node id for the life of the view.
 */
export function createCompactGraphView(graph: RuntimeCompactGraph, language: string): LingualGraph {
  const nodeCount = graph.persistentOf.length;

  const entityAt = (dense: number): GraphEntity => {
    const kindId = graph.entityKindIds[dense];
    // validateCompact guarantees the kind id resolves against core or extension tables.
    const kind = kindId < COMPACT_ENTITY_KINDS.length
      ? COMPACT_ENTITY_KINDS[kindId]
      : graph.extensionEntityKindStrings![kindId - COMPACT_ENTITY_KINDS.length];
    const labelId = graph.entityLabelStringIds[dense];
    const domain = COMPACT_DOMAINS[graph.entityDomainIds[dense]];
    const grammar = graph.entityGrammar?.[dense];
    const analysis = graph.entityAnalysis?.[dense];
    const features = graph.entityFeatures?.[dense];
    const learnableCapabilities = graph.entityLearnableCapabilities?.[dense];
    return {
      id: graph.persistentOf[dense],
      kind,
      ...(labelId >= 0 ? { label: graph.stringTable[labelId] } : {}),
      ...(domain !== undefined ? { domain } : {}),
      ...(grammar !== undefined ? { grammar } : {}),
      ...(analysis !== undefined ? { analysis } : {}),
      ...(features !== undefined ? { features } : {}),
      ...(learnableCapabilities !== undefined ? { learnableCapabilities: [...learnableCapabilities] } : {}),
    };
  };

  const edgeCache = new Map<number, { out: GraphRelation[]; in: GraphRelation[] }>();

  /** Both orientations of every edge copy in node `dense`'s CSR slice — the same reconstruction the replica performed. */
  const edgesAt = (dense: number): { out: GraphRelation[]; in: GraphRelation[] } => {
    const cached = edgeCache.get(dense);
    if (cached) return cached;
    const out: GraphRelation[] = [];
    const inc: GraphRelation[] = [];
    const self = graph.persistentOf[dense];
    for (let edge = graph.relationOffsets[dense]; edge < graph.relationOffsets[dense + 1]; edge += 1) {
      const other = graph.persistentOf[graph.relationTargets[edge]];
      // validateCompact guarantees the type id resolves against core or extension tables.
      const typeId = graph.relationTypeIds[edge];
      const type = typeId < COMPACT_RELATION_TYPES.length
        ? COMPACT_RELATION_TYPES[typeId]
        : graph.extensionRelationTypeStrings![typeId - COMPACT_RELATION_TYPES.length];
      const confidence = graph.relationConfidence?.[edge];
      const transparency = graph.relationTransparency?.[edge];
      const predictability = graph.relationPredictability?.[edge];
      const provenanceId = graph.relationProvenanceStringIds?.[edge];
      const order = graph.relationOrders?.[edge];
      const role = graph.relationRoles?.[edge];
      const qualifiers = {
        ...(confidence !== undefined && confidence >= 0 ? { confidence } : {}),
        ...(transparency !== undefined && transparency >= 0 ? { transparency } : {}),
        ...(predictability !== undefined && predictability >= 0 ? { predictability } : {}),
        ...(provenanceId !== undefined && provenanceId >= 0 ? { provenance: graph.stringTable[provenanceId] } : {}),
        ...(order !== undefined ? { order } : {}),
        ...(role !== undefined ? { role } : {}),
      };
      out.push({ from: self, to: other, type, ...qualifiers });
      inc.push({ from: other, to: self, type, ...qualifiers });
    }
    const built = { out, in: inc };
    edgeCache.set(dense, built);
    return built;
  };

  class LazyEntityMap extends Map<string, GraphEntity> {
    override get(id: string): GraphEntity | undefined {
      const dense = graph.denseOf.get(id);
      return dense === undefined ? undefined : entityAt(dense);
    }

    override has(id: string): boolean {
      return graph.denseOf.has(id);
    }

    override get size(): number {
      return nodeCount;
    }

    override values(): MapIterator<GraphEntity> {
      // Cast: the plain generator lacks the iterator-helper methods
      // (map/filter/take/…); consumers only spread or get().
      return this.entityValues() as MapIterator<GraphEntity>;
    }

    private *entityValues(): Generator<GraphEntity, void, void> {
      for (let dense = 0; dense < nodeCount; dense += 1) yield entityAt(dense);
    }

    override keys(): MapIterator<string> {
      // Cast: same partial-emulation note as values().
      return this.entityKeys() as MapIterator<string>;
    }

    private *entityKeys(): Generator<string, void, void> {
      yield* graph.persistentOf;
    }

    override entries(): MapIterator<[string, GraphEntity]> {
      // Cast: same partial-emulation note as values().
      return this.entityEntries() as MapIterator<[string, GraphEntity]>;
    }

    private *entityEntries(): Generator<[string, GraphEntity], void, void> {
      for (let dense = 0; dense < nodeCount; dense += 1) yield [graph.persistentOf[dense], entityAt(dense)];
    }

    override forEach(callback: (value: GraphEntity, key: string, map: Map<string, GraphEntity>) => void): void {
      for (let dense = 0; dense < nodeCount; dense += 1) callback(entityAt(dense), graph.persistentOf[dense], this);
    }
  }

  class LazyEdgeMap extends Map<string, GraphRelation[]> {
    constructor(private readonly direction: 'out' | 'in') {
      super();
    }

    override get(id: string): GraphRelation[] | undefined {
      const dense = graph.denseOf.get(id);
      if (dense === undefined) return undefined;
      return this.direction === 'out' ? edgesAt(dense).out : edgesAt(dense).in;
    }

    override has(id: string): boolean {
      return graph.denseOf.has(id);
    }
  }

  // Nothing in app code reads `asset` off a runtime graph (only tests that
  // build their own plain graphs from an asset); the stub satisfies the shape.
  const asset: LinguisticGraphAsset = {
    schemaVersion: GRAPH_SCHEMA_VERSION,
    language,
    generatedAt: '',
    sourceVersions: {},
    entities: [],
    relations: [],
  };

  return {
    asset,
    nodes: new LazyEntityMap(),
    outgoing: new LazyEdgeMap('out'),
    incoming: new LazyEdgeMap('in'),
    // The view never mutates or grows the id list; the decode-owned array is
    // only read. (RuntimeCompactGraph marks it readonly; LingualGraph predates that.)
    denseOf: graph.denseOf,
    persistentOf: graph.persistentOf as string[],
  };
}
