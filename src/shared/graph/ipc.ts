import type { GraphEntityKind, GraphRelationType } from './types';

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
  label?: string;
}

export interface GraphRelatedNode extends GraphNode {
  relationType: GraphRelationType;
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
