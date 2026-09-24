import { surfaceEntityId } from '../../shared/graph/load';
import { hashWordSync } from './srsAlgorithm';
import type { KnowledgeInspection } from './openKnowledgeInspector';

type InspectionContext = Partial<Pick<KnowledgeInspection, 'policyTrace' | 'policyBrief'>>;

/** The same written surface must open the same graph target from every workflow. */
export function surfaceKnowledgeInspection(
  language: string,
  surface: string,
  context?: InspectionContext,
): KnowledgeInspection {
  return {
    language,
    surface,
    target: { kind: 'surface', id: surfaceEntityId(language, hashWordSync(surface)) },
    ...context,
  };
}
