import { GraphLoadError } from './load';
import {
  GRAPH_SCHEMA_VERSION,
  RELATION_CATEGORY,
  type GraphEntity,
  type GraphEntityKind,
  type GraphRelationType,
  type LinguisticGraphAsset,
  type RelationCategory,
} from './types';

/**
 * MEMORY NOTE (recorded 2026-08-27, deliberately not optimized yet):
 * decodeCompact steady RSS over process baseline, measured via
 * `node scripts/bench-graph.mjs --compact`:
 *   ja ≈1.1 GB, de ≈0.98 GB, ru ≈0.63 GB, zh ≈0.73 GB.
 * Typed arrays hold only ~25–55 MB of that; the rest is the eagerly
 * materialized id-string side (denseOf Map + persistentOf array +
 * stringTable). Future optimization target: avoid eager denseOf for all
 * entities (hash-prefix on demand), consider string-table interning or a
 * keyed on-disk index so resident size tracks the artifact (ja artifact is
 * 132 MB / 30 MB gzipped), not 8× it. Related transient cost: Electron main's
 * LinguisticGraphService caches one full plain-object replica per loaded
 * language (built on first projection use); compact-native traversal in
 * buildKnowledgeProjection would remove that replica too.
 */

/** Order-stable wire ids shared by compact graph producers and consumers. */
export const COMPACT_ENTITY_KINDS = [
  'dictionary-entry', 'lexeme', 'surface', 'sense', 'pronunciation', 'character', 'morpheme', 'grammar-pattern',
] as const satisfies readonly GraphEntityKind[];

/** Order-stable wire ids shared by compact graph producers and consumers. */
export const COMPACT_RELATION_TYPES = [
  'inflection-of', 'lemma-of', 'realizes', 'has-sense', 'has-pronunciation', 'has-gender', 'has-prosodic-pattern',
  'has-character', 'has-reading', 'has-morpheme', 'orthographic-variant-of', 'component-of', 'derived-from',
  'semantically-related', 'morphologically-related',
  // Appended last so every pre-existing wire id stays order-stable; never reorder.
  'contrasts-with',
  'has-pos',
] as const satisfies readonly GraphRelationType[];
const COMPACT_DOMAINS = [undefined, 'common', 'names', 'archaic', 'technical', 'dialectal'] as const;
const KIND_IDS = new Map(COMPACT_ENTITY_KINDS.map((kind, id) => [kind, id]));
const TYPE_IDS = new Map<GraphRelationType, number>(COMPACT_RELATION_TYPES.map((type, id) => [type, id]));
const DOMAIN_IDS = new Map(COMPACT_DOMAINS.map((domain, id) => [domain, id]));
const TYPE_CATEGORIES = COMPACT_RELATION_TYPES.map((type) => RELATION_CATEGORY[type]);

export interface CompactAssetJSON {
  schemaVersion: number;
  language: string;
  generatedAt: string;
  sourceVersions: Record<string, string>;
  stringTable: string[];
  entities: {
    kindIds: number[];
    domainIds: number[];
    labelStringIds: number[];
    /** Present only when at least one entity carries grammar metadata; -1 = none. Holds the JSON of GraphEntity['grammar']. */
    grammarStringIds?: number[];
  };
  relations: {
    offsets: number[];
    targets: number[];
    typeIds: number[];
    confidence?: number[];
    transparency?: number[];
    predictability?: number[];
    provenanceStringIds?: number[];
  };
  meta: {
    /** Legacy compatibility fields; current encoders leave them empty to avoid duplicating surface hashes. */
    surfaceHashStringIds: number[];
    surfaceLocalIds: number[];
  };
}

export interface CompactLingualGraph {
  readonly stringTable: readonly string[];
  readonly entityKindIds: Uint8Array;
  readonly entityDomainIds: Uint8Array;
  readonly entityLabelStringIds: Int32Array;
  readonly relationOffsets: Uint32Array;
  readonly relationTargets: Uint32Array;
  readonly relationTypeIds: Uint8Array;
  readonly relationConfidence?: Float32Array;
  readonly relationTransparency?: Float32Array;
  readonly relationPredictability?: Float32Array;
  readonly relationProvenanceStringIds?: Int32Array;
  /** Decoded grammar metadata per entity ordinal (undefined where absent). Present only when the asset carries grammar. */
  readonly entityGrammar?: readonly (GraphEntity['grammar'] | undefined)[];
  readonly denseOf: Map<string, number>;
  readonly persistentOf: readonly string[];
  readonly surfaceHashToLocalId: Map<number, number>;
  has(id: string): boolean;
  nodeKind(id: string): GraphEntityKind | undefined;
  neighborsByCategory(id: string, category: RelationCategory): string[];
}

export type RuntimeCompactGraph = CompactLingualGraph;

function validateCompact(compact: CompactAssetJSON): void {
  if (compact.schemaVersion !== GRAPH_SCHEMA_VERSION) {
    throw new GraphLoadError(`Unsupported compact graph schemaVersion ${compact.schemaVersion} (expected ${GRAPH_SCHEMA_VERSION})`);
  }
  const { kindIds, domainIds, labelStringIds, grammarStringIds } = compact.entities;
  const { offsets, targets, typeIds } = compact.relations;
  if (kindIds.length !== domainIds.length || kindIds.length !== labelStringIds.length || offsets.length !== kindIds.length + 1
    || targets.length !== typeIds.length || offsets[offsets.length - 1] !== targets.length
    || compact.meta.surfaceHashStringIds.length !== compact.meta.surfaceLocalIds.length
    || offsets.some((offset, index) => !Number.isInteger(offset) || offset < 0 || (index > 0 && offset < offsets[index - 1]))
    || kindIds.some((id) => COMPACT_ENTITY_KINDS[id] === undefined)
    || domainIds.some((id) => COMPACT_DOMAINS[id] === undefined && id !== 0)
    || targets.some((id) => !Number.isInteger(id) || id < 0 || id >= kindIds.length)
    || typeIds.some((id) => COMPACT_RELATION_TYPES[id] === undefined)
    || (grammarStringIds !== undefined && grammarStringIds.length !== kindIds.length)) {
    throw new GraphLoadError('Invalid compact graph array lengths');
  }
}

/** Encodes each relation in both directions so CSR supports symmetric neighbor lookup without an incoming index. */
export function encodeCompact(asset: LinguisticGraphAsset): CompactAssetJSON {
  if (asset.schemaVersion !== GRAPH_SCHEMA_VERSION) {
    throw new GraphLoadError(`Unsupported graph schemaVersion ${asset.schemaVersion} (expected ${GRAPH_SCHEMA_VERSION})`);
  }
  const stringTable: string[] = [];
  const stringIds = new Map<string, number>();
  const stringId = (value: string): number => {
    const existing = stringIds.get(value);
    if (existing !== undefined) return existing;
    const id = stringTable.length;
    stringTable.push(value);
    stringIds.set(value, id);
    return id;
  };
  const entityIds = new Map<string, number>();
  const kindIds: number[] = [];
  const domainIds: number[] = [];
  const labelStringIds: number[] = [];
  const surfaceHashStringIds: number[] = [];
  const surfaceLocalIds: number[] = [];

  for (const entity of asset.entities) {
    if (entityIds.has(entity.id)) throw new GraphLoadError(`Duplicate entity id: ${entity.id}`);
    entityIds.set(entity.id, entityIds.size);
    stringId(entity.id);
  }
  const grammarStringIds: number[] = [];
  let hasGrammar = false;
  for (const entity of asset.entities) {
    const kindId = KIND_IDS.get(entity.kind);
    const domainId = DOMAIN_IDS.get(entity.domain);
    if (kindId === undefined || domainId === undefined) throw new GraphLoadError(`Unsupported compact entity: ${entity.id}`);
    kindIds.push(kindId);
    domainIds.push(domainId);
    labelStringIds.push(entity.label === undefined ? -1 : stringId(entity.label));
    if (entity.grammar !== undefined) {
      grammarStringIds.push(stringId(JSON.stringify(entity.grammar)));
      hasGrammar = true;
    } else {
      grammarStringIds.push(-1);
    }
  }

  const adjacency = Array.from({ length: kindIds.length }, () => [] as Array<{ target: number; type: number; confidence?: number; transparency?: number; predictability?: number; provenance?: number }>);
  for (const relation of asset.relations) {
    const from = entityIds.get(relation.from);
    const to = entityIds.get(relation.to);
    const type = TYPE_IDS.get(relation.type);
    if (from === undefined || to === undefined) throw new GraphLoadError(`Relation references unknown entity: ${relation.from} -> ${relation.to}`);
    if (type === undefined) throw new GraphLoadError(`Unsupported compact relation type: ${relation.type}`);
    const encoded = {
      target: to,
      type,
      confidence: relation.confidence,
      transparency: relation.transparency,
      predictability: relation.predictability,
      provenance: relation.provenance === undefined ? undefined : stringId(relation.provenance),
    };
    adjacency[from].push(encoded);
    adjacency[to].push({ ...encoded, target: from });
  }

  const offsets = [0];
  const targets: number[] = [];
  const typeIds: number[] = [];
  const confidence: number[] = [];
  const transparency: number[] = [];
  const predictability: number[] = [];
  const provenanceStringIds: number[] = [];
  let hasConfidence = false;
  let hasTransparency = false;
  let hasPredictability = false;
  let hasProvenance = false;
  for (const edges of adjacency) {
    for (const edge of edges) {
      targets.push(edge.target);
      typeIds.push(edge.type);
      confidence.push(edge.confidence ?? -1);
      transparency.push(edge.transparency ?? -1);
      predictability.push(edge.predictability ?? -1);
      provenanceStringIds.push(edge.provenance ?? -1);
      hasConfidence ||= edge.confidence !== undefined;
      hasTransparency ||= edge.transparency !== undefined;
      hasPredictability ||= edge.predictability !== undefined;
      hasProvenance ||= edge.provenance !== undefined;
    }
    offsets.push(targets.length);
  }
  return {
    schemaVersion: GRAPH_SCHEMA_VERSION,
    language: asset.language,
    generatedAt: asset.generatedAt,
    sourceVersions: asset.sourceVersions,
    stringTable,
    entities: { kindIds, domainIds, labelStringIds, ...(hasGrammar ? { grammarStringIds } : {}) },
    relations: {
      offsets, targets, typeIds,
      ...(hasConfidence ? { confidence } : {}),
      ...(hasTransparency ? { transparency } : {}),
      ...(hasPredictability ? { predictability } : {}),
      ...(hasProvenance ? { provenanceStringIds } : {}),
    },
    meta: { surfaceHashStringIds, surfaceLocalIds },
  };
}

export function decodeCompact(compact: CompactAssetJSON): RuntimeCompactGraph {
  validateCompact(compact);
  const stringTable = compact.stringTable;
  const entityKindIds = Uint8Array.from(compact.entities.kindIds);
  const entityDomainIds = Uint8Array.from(compact.entities.domainIds);
  const entityLabelStringIds = Int32Array.from(compact.entities.labelStringIds);
  const relationOffsets = Uint32Array.from(compact.relations.offsets);
  const relationTargets = Uint32Array.from(compact.relations.targets);
  const relationTypeIds = Uint8Array.from(compact.relations.typeIds);
  const relationConfidence = compact.relations.confidence === undefined ? undefined : Float32Array.from(compact.relations.confidence);
  const relationTransparency = compact.relations.transparency === undefined ? undefined : Float32Array.from(compact.relations.transparency);
  const relationPredictability = compact.relations.predictability === undefined ? undefined : Float32Array.from(compact.relations.predictability);
  const relationProvenanceStringIds = compact.relations.provenanceStringIds === undefined ? undefined : Int32Array.from(compact.relations.provenanceStringIds);
  const entityGrammar = compact.entities.grammarStringIds === undefined
    ? undefined
    : compact.entities.grammarStringIds.map((id) => id < 0 ? undefined : JSON.parse(stringTable[id]) as GraphEntity['grammar']);
  const persistentOf = stringTable.slice(0, entityKindIds.length);
  const denseOf = new Map<string, number>();
  for (let dense = 0; dense < persistentOf.length; dense += 1) denseOf.set(persistentOf[dense], dense);
  if (denseOf.size !== persistentOf.length) throw new GraphLoadError('Duplicate compact entity id');
  const surfaceHashToLocalId = new Map<number, number>();
  for (let i = 0; i < compact.meta.surfaceHashStringIds.length; i += 1) {
    surfaceHashToLocalId.set(compact.meta.surfaceHashStringIds[i], compact.meta.surfaceLocalIds[i]);
  }
  return {
    stringTable,
    entityKindIds,
    entityDomainIds,
    entityLabelStringIds,
    relationOffsets,
    relationTargets,
    relationTypeIds,
    relationConfidence,
    relationTransparency,
    relationPredictability,
    relationProvenanceStringIds,
    entityGrammar,
    denseOf,
    persistentOf,
    surfaceHashToLocalId,
    has: (id) => denseOf.has(id),
    nodeKind: (id) => {
      const dense = denseOf.get(id);
      return dense === undefined ? undefined : COMPACT_ENTITY_KINDS[entityKindIds[dense]];
    },
    neighborsByCategory: (id, category) => {
      const dense = denseOf.get(id);
      if (dense === undefined) return [];
      const neighbors: string[] = [];
      for (let edge = relationOffsets[dense]; edge < relationOffsets[dense + 1]; edge += 1) {
        if (TYPE_CATEGORIES[relationTypeIds[edge]] === category) neighbors.push(persistentOf[relationTargets[edge]]);
      }
      return neighbors;
    },
  };
}

/**
 * Deliberately no `fromCompact`: a LingualGraph-compatible Map/object view
 * reconstructs the representation this module avoids. Consumers should use
 * RuntimeCompactGraph directly through a thin adapter when they migrate.
 */
