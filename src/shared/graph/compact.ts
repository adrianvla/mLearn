import { GraphLoadError } from './load';
import {
  GRAPH_SCHEMA_VERSION,
  isNamespacedGraphIdentifier,
  RELATION_CATEGORY,
  type CoreGraphEntityKind,
  type CoreGraphRelationType,
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
  // Appended last so every pre-existing wire id stays order-stable; never reorder.
  'analysis',
] as const satisfies readonly GraphEntityKind[];

/** Order-stable wire ids shared by compact graph producers and consumers. */
export const COMPACT_RELATION_TYPES = [
  'inflection-of', 'lemma-of', 'realizes', 'has-sense', 'has-pronunciation', 'has-gender', 'has-prosodic-pattern',
  'has-character', 'has-reading', 'has-morpheme', 'orthographic-variant-of', 'component-of', 'derived-from',
  'semantically-related', 'morphologically-related',
  // Appended last so every pre-existing wire id stays order-stable; never reorder.
  'contrasts-with',
  'has-pos',
  'analyzes',
  'analysis-member',
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
    /** Present only when at least one entity carries analysis metadata; -1 = none. Holds the JSON of GraphEntity['analysis']. */
    analysisStringIds?: number[];
    /**
     * Open-world extensions: namespaced entity kinds (`ns::local`) present in
     * this asset, in id order. A kindIds entry >= COMPACT_ENTITY_KINDS.length
     * indexes this array. Extension kinds are stored/inspectable but inert.
     */
    extensionKindStrings?: string[];
  };
  relations: {
    offsets: number[];
    targets: number[];
    typeIds: number[];
    confidence?: number[];
    transparency?: number[];
    predictability?: number[];
    provenanceStringIds?: number[];
    /**
     * Open-world extensions: namespaced relation types (`ns::local`) present
     * in this asset, in id order. A typeIds entry >= COMPACT_RELATION_TYPES.length
     * indexes this array. Extension relations are stored/inspectable, excluded
     * from category lookups (no learner semantics), and resolve through
     * extensionRelationTypeStrings.
     */
    extensionTypeStrings?: string[];
    /** Per-edge string-table id of the `role` qualifier (-1 = none). Present when any edge carries one. */
    roleStringIds?: number[];
    /** Per-edge asserted member `order` (-1 = none). Present when any edge carries one. */
    orders?: number[];
  };
  meta: {
    /** Legacy compatibility fields; current encoders leave them empty to avoid duplicating surface hashes. */
    surfaceHashStringIds: number[];
    surfaceLocalIds: number[];
  };
}

export interface CompactLingualGraph {
  readonly stringTable: readonly string[];
  /** Entity kind ids; values >= COMPACT_ENTITY_KINDS.length index extensionEntityKindStrings. */
  readonly entityKindIds: Uint16Array;
  readonly entityDomainIds: Uint8Array;
  readonly entityLabelStringIds: Int32Array;
  readonly relationOffsets: Uint32Array;
  readonly relationTargets: Uint32Array;
  /** Relation type ids; values >= COMPACT_RELATION_TYPES.length index extensionRelationTypeStrings. */
  readonly relationTypeIds: Uint16Array;
  readonly relationConfidence?: Float32Array;
  readonly relationTransparency?: Float32Array;
  readonly relationPredictability?: Float32Array;
  readonly relationProvenanceStringIds?: Int32Array;
  /** Per-edge `role` qualifier resolved from the string table (undefined where absent). Present when the asset carries roles. */
  readonly relationRoles?: readonly (string | undefined)[];
  /** Per-edge asserted member `order` (undefined where absent). Present when the asset carries orders. */
  readonly relationOrders?: readonly (number | undefined)[];
  /** Namespaced extension relation types, indexed by a typeIds value minus COMPACT_RELATION_TYPES.length. */
  readonly extensionRelationTypeStrings?: readonly string[];
  /** Namespaced extension entity kinds, indexed by a kindIds value minus COMPACT_ENTITY_KINDS.length. */
  readonly extensionEntityKindStrings?: readonly string[];
  /** Decoded grammar metadata per entity ordinal (undefined where absent). Present only when the asset carries grammar. */
  readonly entityGrammar?: readonly (GraphEntity['grammar'] | undefined)[];
  /** Decoded analysis metadata per entity ordinal (undefined where absent). Present only when the asset carries analysis metadata. */
  readonly entityAnalysis?: readonly (GraphEntity['analysis'] | undefined)[];
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
  const { kindIds, domainIds, labelStringIds, grammarStringIds, extensionKindStrings } = compact.entities;
  const { offsets, targets, typeIds, extensionTypeStrings, roleStringIds, orders } = compact.relations;
  const extensionKindCount = extensionKindStrings?.length ?? 0;
  const extensionTypeCount = extensionTypeStrings?.length ?? 0;
  const kindIdValid = (id: number): boolean =>
    id < COMPACT_ENTITY_KINDS.length ? COMPACT_ENTITY_KINDS[id] !== undefined : id - COMPACT_ENTITY_KINDS.length < extensionKindCount;
  const typeIdValid = (id: number): boolean =>
    id < COMPACT_RELATION_TYPES.length ? COMPACT_RELATION_TYPES[id] !== undefined : id - COMPACT_RELATION_TYPES.length < extensionTypeCount;
  if (kindIds.length !== domainIds.length || kindIds.length !== labelStringIds.length || offsets.length !== kindIds.length + 1
    || targets.length !== typeIds.length || offsets[offsets.length - 1] !== targets.length
    || compact.meta.surfaceHashStringIds.length !== compact.meta.surfaceLocalIds.length
    || offsets.some((offset, index) => !Number.isInteger(offset) || offset < 0 || (index > 0 && offset < offsets[index - 1]))
    || kindIds.some((id) => !kindIdValid(id))
    || domainIds.some((id) => COMPACT_DOMAINS[id] === undefined && id !== 0)
    || targets.some((id) => !Number.isInteger(id) || id < 0 || id >= kindIds.length)
    || typeIds.some((id) => !typeIdValid(id))
    || (grammarStringIds !== undefined && grammarStringIds.length !== kindIds.length)
    || (compact.entities.analysisStringIds !== undefined && compact.entities.analysisStringIds.length !== kindIds.length)
    || (roleStringIds !== undefined && roleStringIds.length !== targets.length)
    || (orders !== undefined && orders.length !== targets.length)
    || (extensionKindStrings ?? []).some((kind) => !isNamespacedGraphIdentifier(kind))
    || (extensionTypeStrings ?? []).some((type) => !isNamespacedGraphIdentifier(type))) {
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
  const extensionKindStrings: string[] = [];
  const extensionKindIds = new Map<string, number>();
  const extensionKindId = (kind: string): number => {
    let id = extensionKindIds.get(kind);
    if (id === undefined) {
      if (!isNamespacedGraphIdentifier(kind)) throw new GraphLoadError(`Unsupported compact entity kind: ${kind}`);
      id = COMPACT_ENTITY_KINDS.length + extensionKindStrings.length;
      extensionKindStrings.push(kind);
      extensionKindIds.set(kind, id);
    }
    return id;
  };
  for (const entity of asset.entities) {
    const coreKindId = KIND_IDS.get(entity.kind as CoreGraphEntityKind);
    const kindId = coreKindId ?? extensionKindId(entity.kind);
    const domainId = DOMAIN_IDS.get(entity.domain);
    if (domainId === undefined) throw new GraphLoadError(`Unsupported compact entity: ${entity.id}`);
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

  const analysisStringIds: number[] = [];
  let hasAnalysis = false;
  for (const entity of asset.entities) {
    if (entity.analysis !== undefined) {
      analysisStringIds.push(stringId(JSON.stringify(entity.analysis)));
      hasAnalysis = true;
    } else {
      analysisStringIds.push(-1);
    }
  }

  const extensionTypeStrings: string[] = [];
  const extensionTypeIds = new Map<string, number>();
  const extensionTypeId = (type: string): number => {
    let id = extensionTypeIds.get(type);
    if (id === undefined) {
      if (!isNamespacedGraphIdentifier(type)) throw new GraphLoadError(`Unsupported compact relation type: ${type}`);
      id = COMPACT_RELATION_TYPES.length + extensionTypeStrings.length;
      extensionTypeStrings.push(type);
      extensionTypeIds.set(type, id);
    }
    return id;
  };
  const adjacency = Array.from({ length: kindIds.length }, () => [] as Array<{ target: number; type: number; confidence?: number; transparency?: number; predictability?: number; provenance?: number; order?: number; role?: number }>);
  for (const relation of asset.relations) {
    const from = entityIds.get(relation.from);
    const to = entityIds.get(relation.to);
    const coreType = TYPE_IDS.get(relation.type as CoreGraphRelationType);
    const type = coreType ?? extensionTypeId(relation.type);
    if (from === undefined || to === undefined) throw new GraphLoadError(`Relation references unknown entity: ${relation.from} -> ${relation.to}`);
    const encoded = {
      target: to,
      type,
      confidence: relation.confidence,
      transparency: relation.transparency,
      predictability: relation.predictability,
      provenance: relation.provenance === undefined ? undefined : stringId(relation.provenance),
      order: relation.order,
      role: relation.role === undefined ? undefined : stringId(relation.role),
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
  const roleStringIds: number[] = [];
  const orders: number[] = [];
  let hasConfidence = false;
  let hasTransparency = false;
  let hasPredictability = false;
  let hasProvenance = false;
  let hasRoles = false;
  let hasOrders = false;
  for (const edges of adjacency) {
    for (const edge of edges) {
      targets.push(edge.target);
      typeIds.push(edge.type);
      confidence.push(edge.confidence ?? -1);
      transparency.push(edge.transparency ?? -1);
      predictability.push(edge.predictability ?? -1);
      provenanceStringIds.push(edge.provenance ?? -1);
      roleStringIds.push(edge.role ?? -1);
      orders.push(edge.order ?? -1);
      hasConfidence ||= edge.confidence !== undefined;
      hasTransparency ||= edge.transparency !== undefined;
      hasPredictability ||= edge.predictability !== undefined;
      hasProvenance ||= edge.provenance !== undefined;
      hasRoles ||= edge.role !== undefined;
      hasOrders ||= edge.order !== undefined;
    }
    offsets.push(targets.length);
  }
  return {
    schemaVersion: GRAPH_SCHEMA_VERSION,
    language: asset.language,
    generatedAt: asset.generatedAt,
    sourceVersions: asset.sourceVersions,
    stringTable,
    entities: {
      kindIds, domainIds, labelStringIds,
      ...(hasGrammar ? { grammarStringIds } : {}),
      ...(hasAnalysis ? { analysisStringIds } : {}),
      ...(extensionKindStrings.length > 0 ? { extensionKindStrings } : {}),
    },
    relations: {
      offsets, targets, typeIds,
      ...(hasConfidence ? { confidence } : {}),
      ...(hasTransparency ? { transparency } : {}),
      ...(hasPredictability ? { predictability } : {}),
      ...(hasProvenance ? { provenanceStringIds } : {}),
      ...(extensionTypeStrings.length > 0 ? { extensionTypeStrings } : {}),
      ...(hasRoles ? { roleStringIds } : {}),
      ...(hasOrders ? { orders } : {}),
    },
    meta: { surfaceHashStringIds, surfaceLocalIds },
  };
}

export function decodeCompact(compact: CompactAssetJSON): RuntimeCompactGraph {
  validateCompact(compact);
  const stringTable = compact.stringTable;
  const entityKindIds = Uint16Array.from(compact.entities.kindIds);
  const entityDomainIds = Uint8Array.from(compact.entities.domainIds);
  const entityLabelStringIds = Int32Array.from(compact.entities.labelStringIds);
  const relationOffsets = Uint32Array.from(compact.relations.offsets);
  const relationTargets = Uint32Array.from(compact.relations.targets);
  const relationTypeIds = Uint16Array.from(compact.relations.typeIds);
  const extensionEntityKindStrings = compact.entities.extensionKindStrings;
  const extensionRelationTypeStrings = compact.relations.extensionTypeStrings;
  const relationRoles = compact.relations.roleStringIds === undefined
    ? undefined
    : compact.relations.roleStringIds.map((id) => id < 0 ? undefined : stringTable[id]);
  const relationOrders = compact.relations.orders === undefined
    ? undefined
    : compact.relations.orders.map((order) => order < 0 ? undefined : order);
  const relationConfidence = compact.relations.confidence === undefined ? undefined : Float32Array.from(compact.relations.confidence);
  const relationTransparency = compact.relations.transparency === undefined ? undefined : Float32Array.from(compact.relations.transparency);
  const relationPredictability = compact.relations.predictability === undefined ? undefined : Float32Array.from(compact.relations.predictability);
  const relationProvenanceStringIds = compact.relations.provenanceStringIds === undefined ? undefined : Int32Array.from(compact.relations.provenanceStringIds);
  const entityGrammar = compact.entities.grammarStringIds === undefined
    ? undefined
    : compact.entities.grammarStringIds.map((id) => id < 0 ? undefined : JSON.parse(stringTable[id]) as GraphEntity['grammar']);
  const entityAnalysis = compact.entities.analysisStringIds === undefined
    ? undefined
    : compact.entities.analysisStringIds.map((id) => id < 0 ? undefined : JSON.parse(stringTable[id]) as GraphEntity['analysis']);
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
    relationRoles,
    relationOrders,
    extensionEntityKindStrings,
    extensionRelationTypeStrings,
    entityGrammar,
    entityAnalysis,
    denseOf,
    persistentOf,
    surfaceHashToLocalId,
    has: (id) => denseOf.has(id),
    nodeKind: (id) => {
      const dense = denseOf.get(id);
      if (dense === undefined) return undefined;
      const kindId = entityKindIds[dense];
      if (kindId < COMPACT_ENTITY_KINDS.length) return COMPACT_ENTITY_KINDS[kindId];
      return extensionEntityKindStrings?.[kindId - COMPACT_ENTITY_KINDS.length];
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
