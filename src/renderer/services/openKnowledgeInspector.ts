import { createSignal } from 'solid-js';
import type { GraphEntityKind } from '../../shared/graph/types';
import type { PolicyTrace } from '../learning/types';

export interface KnowledgeInspection {
  readonly language: string;
  readonly surface: string;
  readonly target: { readonly kind: GraphEntityKind; readonly id: string };
  /**
   * The policy decision that selected this surface (R20): the emitted typed
   * trace plus the decision's own brief reason, shown in the SAME inspector
   * drawer — the learner audits the selection where the knowledge lives.
   * Absent when the opening surface has no pinned decision (or none emitted
   * a trace — the drawer then shows no policy section at all).
   */
  readonly policyTrace?: PolicyTrace;
  readonly policyBrief?: string;
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
