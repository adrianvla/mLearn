import { WINDOW_TYPES } from '../../shared/constants';
import { getBridge } from '../../shared/bridges';

export interface GraphInspectorEntityRef {
  entityId: string;
}

/** Open the singleton inspector centered on a persistent linguistic graph entity id. */
export function openGraphInspector(entity: GraphInspectorEntityRef): void {
  getBridge().window.openWindow({
    type: WINDOW_TYPES.GRAPH_INSPECTOR,
    options: { width: 860, height: 760 },
    context: { entityId: entity.entityId },
  });
}
