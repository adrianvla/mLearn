import type { GraphDomain, GraphEntityKind, GraphRelationType, RelationCategory } from './types';

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
