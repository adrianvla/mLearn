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

export type KnowledgeProjectionBasis = 'evidence' | 'claim' | 'prediction' | 'unmeasured' | 'excluded';
export type KnowledgeProjectionClassification = 'known' | 'learning' | 'predicted' | 'unmeasured' | 'excluded';

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
}
