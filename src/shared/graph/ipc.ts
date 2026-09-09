import type { CompoundAnalysis } from './morphology/compounds';
import type { CapabilityKey, GraphDomain, GraphEntityKind, GraphRelationType, RelationCategory } from './types';

export type GraphAvailability = 'ready' | 'not-installed' | 'unavailable' | 'error';

export interface GraphMeta {
  entityCount: number;
  relationCount: number;
  ready: boolean;
  status: GraphAvailability;
}

export interface GraphNode {
  id: string;
  kind: GraphEntityKind;
  domain?: GraphDomain;
  label?: string;
}

export interface GraphRelatedNode extends GraphNode {
  relationType: GraphRelationType;
  confidence?: number;
  transparency?: number;
  predictability?: number;
  provenance?: string;
}

export interface GraphNeighborhood {
  center: GraphNode;
  /** Dense runtime ids are diagnostic-only; persistent ids remain the public identity. */
  centerDenseId: number;
  relationCount: number;
  relations: GraphRelatedNode[];
  /**
   * Learner (classification, basis) per capability of the CENTER surface only,
   * projected with the same assembly as the knowledge projection. Relation
   * nodes stay unprojected. Optional: absent for non-surface centers and when
   * the projection is unavailable, so existing consumers are unaffected.
   */
  centerStates?: GraphNeighborhoodCenterState[];
}

export interface GraphNeighborhoodCenterState {
  capability: CapabilityKey;
  classification: KnowledgeProjectionClassification;
  basis: KnowledgeProjectionBasis;
}

export interface GraphNeighborhoodQuery {
  entityId: string;
  /** Currently bounded to one hop; retained for a stable batch API. */
  depth?: 1 | 2;
  relationClasses?: RelationCategory[];
  limit?: number;
}

export interface GraphWordLookup {
  surfaceId: string;
  entries: GraphNode[];
  lexemes: GraphNode[];
  senses: GraphNode[];
  pronunciations: GraphNode[];
  /**
   * Graph-attested compound decomposition read from the same loaded graph as
   * the rest of the lookup (cheap once the plain replica is warm). null = the
   * surface is known but carries no attested structure; hover UI falls back
   * to the declared productive splitter only for surfaces absent from the
   * graph (lookup === null).
   */
  compoundAnalysis: CompoundAnalysis | null;
}

export interface GraphLookupInput {
  surface?: string;
  hash?: string;
}

export interface GraphSurfaceTargets {
  input: GraphLookupInput;
  lookup: GraphWordLookup | null;
}

export type KnowledgeProjectionBasis = 'evidence' | 'claim' | 'prediction' | 'unmeasured';
export type KnowledgeProjectionClassification = 'known' | 'learning' | 'unknown' | 'predicted' | 'unmeasured';

export interface KnowledgeProjectionEvidence {
  timestamp: number;
  source: string;
  quality?: string;
  /**
   * Modeling-grade latency, derived projection-side via
   * attemptActiveLatencyMs: active-engagement time when recorded, legacy
   * wall fallback otherwise, OMITTED for stall-flagged rows. The journal is
   * the audit layer for full active/wall/stalled provenance.
   */
  stalled?: boolean;
  latencyMs?: number;
}

export interface KnowledgeProjectionState {
  capability: CapabilityKey;
  classification: KnowledgeProjectionClassification;
  basis: KnowledgeProjectionBasis;
  strength?: { ease: number; timesSeen: number; timesHovered: number };
  lastDirectSuccess?: number;
  evidence: KnowledgeProjectionEvidence[];
  evidenceSourceCounts: Record<string, number>;
  retention?: { pressure: number; dueAt: number };
  prediction?: { value: number; reasons: string[] };
}

export interface KnowledgeProjectionTarget {
  targetRef: { kind: GraphEntityKind; id: string };
  applicableCapabilities: CapabilityKey[];
  states: KnowledgeProjectionState[];
}

/**
 * Word-level (lexical object) summary over graph-relative accesses. Sense and
 * spoken states resolve at ENTRY level — evidence recorded through any
 * authoritative variant surface counts — while `surfaceRecognition` stays the
 * exact presented surface's written bridge. Consumers derive the compact
 * Unknown/Learning/Known pill from this instead of duplicating identity
 * heuristics.
 */
export interface KnowledgeLexicalSummary {
  /** Entry ids the queried surface authoritatively realizes. */
  entryIds: string[];
  sense: { classification: KnowledgeProjectionClassification; basis: KnowledgeProjectionBasis };
  spoken: { classification: KnowledgeProjectionClassification; basis: KnowledgeProjectionBasis };
  surfaceRecognition: { classification: KnowledgeProjectionClassification; basis: KnowledgeProjectionBasis };
  /** The lexical object is accessible without reading: sense or spoken known/claimed. */
  synchronized: boolean;
  missingBridges: CapabilityKey[];
}

/** Single-surface on-demand inspector payload; intentionally not batched for v1. */
export interface KnowledgeProjection {
  status: GraphAvailability;
  surfaceId?: string;
  targets: KnowledgeProjectionTarget[];
  /** The surface text this projection was queried with; lets consumers reject stale async results. */
  querySurface?: string;
  /** Whether the graph knows this surface at all. Absent on legacy/error payloads. */
  surfaceKnown?: boolean;
  /** Graph-attested decomposition (primary representation). null = the graph knows the surface but carries no attested structure; undefined = unavailable. */
  compoundAnalysis?: CompoundAnalysis | null;
  /** Graph-relative lexical-object summary. Absent when the surface is unknown to the graph. */
  lexical?: KnowledgeLexicalSummary;
}
