import type { CompoundAnalysis } from './morphology/compounds';
import type { CapabilityKind, GraphDomain, GraphEntityKind, GraphRelationType, RelationCategory } from './types';

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
  capability: CapabilityKind;
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
  latencyMs?: number;
}

export interface KnowledgeProjectionState {
  capability: CapabilityKind;
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
  applicableCapabilities: CapabilityKind[];
  states: KnowledgeProjectionState[];
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
}
