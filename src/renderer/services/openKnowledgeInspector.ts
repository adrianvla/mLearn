import { createSignal } from 'solid-js';
import type { GraphEntityKind } from '../../shared/graph/types';

export interface KnowledgeInspection {
  readonly language: string;
  readonly surface: string;
  readonly target: { readonly kind: GraphEntityKind; readonly id: string };
}

const [knowledgeInspection, setKnowledgeInspection] = createSignal<KnowledgeInspection>();
export { knowledgeInspection };

/** Opens the window's shared projection drawer on a persistent graph identity. */
export function openKnowledgeInspector(inspection: KnowledgeInspection): void {
  setKnowledgeInspection(inspection);
}

export function closeKnowledgeInspector(): void {
  setKnowledgeInspection(undefined);
}
