import type { GraphNeighborhood, GraphNode, GraphRelatedNode } from '../../../../shared/graph/ipc';

export interface OverviewNode { node: GraphNode; x: number; y: number; w: number; h: number; records: GraphRelatedNode[]; groupKey?: string; count?: number }
export interface OverviewEdge { from: string; to: string; records: GraphRelatedNode[] }
export interface OverviewLayout { nodes: OverviewNode[]; edges: OverviewEdge[]; width: number; height: number }
export const relationshipKey = (relation: GraphRelatedNode): string => JSON.stringify([relation.relationType, relation.via?.id]);

/** Node identity is independent of the number of edge records. Grouping is
 * display-only; every source record remains available on the displayed node. */
export function uniqueConnections(relations: readonly GraphRelatedNode[]): GraphRelatedNode[] {
  return [...new Map(relations.map((relation) => [relation.id, relation])).values()];
}

/** A bounded overview with dense branches represented by an actionable count.
 * Summaries are presentation objects, never canonical entities or learner targets.
 * Every visible property keeps its lexical parent; direct and indirect paths may
 * share one node, while their distinct relationships remain separate edges. */
export function layoutOverview(neighborhood: GraphNeighborhood, compact = false): OverviewLayout {
  const groups = new Map<string, GraphRelatedNode[]>();
  for (const relation of neighborhood.relations) {
    const key = relationshipKey(relation);
    const group = groups.get(key) ?? [];
    group.push(relation); groups.set(key, group);
  }
  const nodes = new Map<string, OverviewNode>();
  const edges = new Map<string, OverviewEdge>();
  const addNode = (node: GraphNode, records: GraphRelatedNode[] = []) => {
    if (node.id === neighborhood.center.id) return;
    const existing = nodes.get(node.id);
    if (existing) existing.records.push(...records);
    else nodes.set(node.id, { node, records: [...records], x: 0, y: 0, w: 240, h: 64 });
  };
  const addEdge = (from: string, to: string, record: GraphRelatedNode) => {
    if (from === to) return;
    const key = JSON.stringify([from, to, record.relationType]);
    const edge = edges.get(key) ?? { from, to, records: [] };
    edge.records.push(record); edges.set(key, edge);
  };
  for (const [key, records] of groups) {
    const via = records[0].via;
    if (via) addNode(via);
    const unique = uniqueConnections(records);
    if (unique.length > 8) {
      const id = `overview-group:${key}`;
      nodes.set(id, { node: { id, kind: 'overview-group' }, records, groupKey: key, count: unique.length, x: 0, y: 0, w: 240, h: 64 });
      addEdge(via?.id ?? neighborhood.center.id, id, records[0]);
      continue;
    }
    for (const record of unique) addNode(record, records.filter((item) => item.id === record.id));
    for (const record of records) addEdge(via?.id ?? neighborhood.center.id, record.id, record);
  }
  // A paged payload may carry its parent only in `via`. Preserve that path too.
  for (const relation of neighborhood.relations) if (relation.via && ![...edges.values()].some((edge) => edge.to === relation.via!.id && edge.from === neighborhood.center.id)) {
    const viaRecord = relation.via as GraphNode & Partial<GraphRelatedNode>;
    if (viaRecord.relationType) addEdge(neighborhood.center.id, relation.via.id, viaRecord as GraphRelatedNode);
  }
  const directIds = new Set([...edges.values()].filter((edge) => edge.from === neighborhood.center.id).map((edge) => edge.to));
  const direct = [...nodes.values()].filter((node) => directIds.has(node.node.id));
  const indirect = [...nodes.values()].filter((node) => !directIds.has(node.node.id));
  const height = Math.max(440, Math.max(direct.length, indirect.length) * 78 + 70);
  direct.forEach((node, index) => { node.x = 400; node.y = 46 + index * 78; });
  indirect.forEach((node, index) => { node.x = 730; node.y = 46 + index * 78; });
  if (compact) {
    [...nodes.values()].forEach((node, index) => { node.x = 198; node.y = 146 + index * 78; node.w = 280; });
    return { nodes: [{ node: neighborhood.center, x: 180, y: 50, w: 240, h: 72, records: [] }, ...nodes.values()], edges: [...edges.values()], width: 360, height: 210 + nodes.size * 78 };
  }
  return { nodes: [{ node: neighborhood.center, x: 110, y: Math.min(height / 2, 260), w: 180, h: 72, records: [] }, ...nodes.values()], edges: [...edges.values()], width: indirect.length ? 875 : 560, height };
}
