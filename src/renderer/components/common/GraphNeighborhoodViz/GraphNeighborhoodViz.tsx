/**
 * Bounded local neighborhood graph for one inspected entity: the center node,
 * its one-hop relations as typed, directed edges (identity / property /
 * support), and an optional learner TargetState chip on the center.
 *
 * Deterministic force-free radial layout — one concentric ring per present
 * relation category (identity innermost), evenly spaced with a per-ring
 * angular offset so rings interleave. No animation, no canvas, no
 * dependencies. Hosts stay in charge of fetching; this component only renders
 * the neighborhood it is given and reports recenter intent via `onSelect`.
 */

import { Component, For, Show, createMemo, createUniqueId } from 'solid-js';
import type { GraphNeighborhood, GraphRelatedNode } from '../../../../shared/graph/ipc';
import { relationCategory, type RelationCategory } from '../../../../shared/graph/types';
import type { TargetState } from '../../../../shared/graph/explanations';
import { useLocalization } from '../../../context';
import './GraphNeighborhoodViz.css';

const CATEGORY_ORDER: readonly RelationCategory[] = ['identity', 'property', 'support'];
const VIEW_WIDTH = 660;
const VIEW_HEIGHT = 400;
const MARGIN = 56;
const NODE_RADIUS = 14;
const CENTER_RADIUS = 26;
const EDGE_GAP = 7;
const MAX_NODES = 40;
const LABEL_LIMIT = 18;

export interface GraphNeighborhoodVizProps {
  neighborhood: GraphNeighborhood;
  /** Learner TargetState of the center's inspected capability; chip is omitted when absent. */
  centerState?: TargetState;
  /** Recenter the inspection on another node (in-place when the host supports it). */
  onSelect?: (entityId: string) => void;
  /** Hard cap of rendered nodes including the center; beyond it relations are truncated honestly. */
  maxNodes?: number;
}

export interface NeighborhoodVizNode {
  id: string;
  label: string;
  x: number;
  y: number;
  center: boolean;
  category?: RelationCategory;
  relation?: GraphRelatedNode;
}

export interface NeighborhoodVizEdge {
  id: string;
  category: RelationCategory;
  x: number;
  y: number;
  relation: GraphRelatedNode;
}

export interface NeighborhoodLayout {
  center: NeighborhoodVizNode;
  nodes: NeighborhoodVizNode[];
  edges: NeighborhoodVizEdge[];
  /** Relations dropped by the node cap; rendered as an honest truncation note. */
  truncated: number;
}

const categoryOf = (relation: GraphRelatedNode): RelationCategory => (
  relationCategory(relation.relationType) ?? 'support'
);

const shortLabel = (label: string): string => (
  label.length > LABEL_LIMIT ? `${label.slice(0, LABEL_LIMIT - 1)}…` : label
);

/**
 * Deterministic layout: relations ring out from the center, one concentric
 * ring per present relation category in identity → property → support order,
 * each ring's nodes evenly spaced with a per-ring angular offset so adjacent
 * rings interleave instead of lining up.
 */
export function layoutNeighborhood(neighborhood: GraphNeighborhood, maxNodes = MAX_NODES): NeighborhoodLayout {
  const centerX = VIEW_WIDTH / 2;
  const centerY = VIEW_HEIGHT / 2;
  const center: NeighborhoodVizNode = {
    id: neighborhood.center.id,
    label: shortLabel(neighborhood.center.label ?? neighborhood.center.id),
    x: centerX,
    y: centerY,
    center: true,
  };
  const relations = neighborhood.relations.slice(0, Math.max(0, maxNodes - 1));
  const rings = CATEGORY_ORDER.filter((category) => relations.some((relation) => categoryOf(relation) === category));
  const radius = Math.min(centerX, centerY) - MARGIN;
  const nodes: NeighborhoodVizNode[] = [];
  const edges: NeighborhoodVizEdge[] = [];
  rings.forEach((category, ringIndex) => {
    const group = relations.filter((relation) => categoryOf(relation) === category);
    const ringRadius = (radius * (ringIndex + 1)) / rings.length;
    group.forEach((relation, index) => {
      const angle = (2 * Math.PI * index) / group.length + ringIndex * (Math.PI / (2 * rings.length)) - Math.PI / 2;
      const x = centerX + ringRadius * Math.cos(angle);
      const y = centerY + ringRadius * Math.sin(angle);
      nodes.push({ id: relation.id, label: shortLabel(relation.label ?? relation.id), x, y, center: false, category, relation });
      edges.push({ id: `${category}:${relation.id}`, category, x, y, relation });
    });
  });
  return { center, nodes, edges, truncated: neighborhood.relations.length - relations.length };
}

const STATE_LABEL: Record<TargetState, string> = {
  'evidence-backed-known': 'EvidenceBackedKnown',
  'claimed-known': 'ClaimedKnown',
  'claimed-learning': 'ClaimedLearning',
  'claimed-unknown': 'ClaimedUnknown',
  learning: 'Learning',
  unknown: 'Unknown',
  predicted: 'Predicted',
  unmeasured: 'Unmeasured',
};

const stateKey = (state: TargetState): string => (
  `mlearn.GraphInspector.Neighborhood.State.${STATE_LABEL[state]}`
);

/** relationType · domain · confidence · provenance — everything inspectable about one relation. */
const relationDetails = (relation: GraphRelatedNode): string => (
  [relation.relationType, relation.domain, relation.confidence, relation.provenance]
    .filter((value) => value !== undefined)
    .join(' · ')
);

export const GraphNeighborhoodViz: Component<GraphNeighborhoodVizProps> = (props) => {
  const { t } = useLocalization();
  const markerId = createUniqueId();
  const layout = createMemo(() => layoutNeighborhood(props.neighborhood, props.maxNodes));
  const hasRelations = createMemo(() => props.neighborhood.relations.length > 0);
  const presentCategories = createMemo(() => (
    CATEGORY_ORDER.filter((category) => layout().nodes.some((node) => node.category === category))
  ));

  return (
    <div class="graph-viz">
      <Show
        when={hasRelations()}
        fallback={<p class="graph-viz__empty">{t('mlearn.GraphInspector.Neighborhood.Empty')}</p>}
      >
        <svg
          class="graph-viz__svg"
          viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
          role="img"
          aria-label={t('mlearn.GraphInspector.Neighborhood.Title')}
        >
          <defs>
            <For each={[...CATEGORY_ORDER]}>{(category) => (
              <marker
                id={`gv-arrow-${markerId}-${category}`}
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerWidth="7"
                markerHeight="7"
                orient="auto-start-reverse"
              >
                <path d="M 0 0 L 10 5 L 0 10 z" class={`graph-viz__arrow graph-viz__arrow--${category}`} />
              </marker>
            )}</For>
          </defs>
          <For each={layout().edges}>{(edge) => {
            const dx = edge.x - layout().center.x;
            const dy = edge.y - layout().center.y;
            const length = Math.hypot(dx, dy) || 1;
            const x1 = layout().center.x + (dx / length) * (CENTER_RADIUS + 2);
            const y1 = layout().center.y + (dy / length) * (CENTER_RADIUS + 2);
            const x2 = edge.x - (dx / length) * (NODE_RADIUS + EDGE_GAP);
            const y2 = edge.y - (dy / length) * (NODE_RADIUS + EDGE_GAP);
            return (
              <line
                class={`graph-viz__edge graph-viz__edge--${edge.category}`}
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                marker-end={`url(#gv-arrow-${markerId}-${edge.category})`}
              >
                <title>{relationDetails(edge.relation)}</title>
              </line>
            );
          }}</For>
          <For each={layout().nodes}>{(node) => (
            <g
              class={`graph-viz__node graph-viz__node--${node.category}`}
              role="button"
              tabindex={0}
              aria-label={node.label}
              onClick={() => props.onSelect?.(node.id)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  props.onSelect?.(node.id);
                }
              }}
            >
              <circle cx={node.x} cy={node.y} r={NODE_RADIUS} />
              <text class="graph-viz__label" x={node.x} y={node.y + NODE_RADIUS + 13} text-anchor="middle">{node.label}</text>
              <title>{`${node.label} — ${relationDetails(node.relation!)}`}</title>
            </g>
          )}</For>
          <g class="graph-viz__node graph-viz__node--center">
            <circle cx={layout().center.x} cy={layout().center.y} r={CENTER_RADIUS} />
            <text class="graph-viz__label" x={layout().center.x} y={layout().center.y - CENTER_RADIUS - 8} text-anchor="middle">
              {layout().center.label}
            </text>
            <Show when={props.centerState}>
              {(state) => (
                <circle
                  class={`graph-viz__state-dot graph-viz__state-dot--${state()}`}
                  cx={layout().center.x}
                  cy={layout().center.y + CENTER_RADIUS + 9}
                  r={4}
                >
                  <title>{t(stateKey(state()))}</title>
                </circle>
              )}
            </Show>
            <title>{layout().center.label}</title>
          </g>
        </svg>
        <div class="graph-viz__caption">
          <For each={presentCategories()}>{(category) => (
            <span class={`graph-viz__legend graph-viz__legend--${category}`}>{t(`mlearn.GraphInspector.${category}`)}</span>
          )}</For>
          <Show when={props.centerState}>
            {(state) => (
              <span class={`graph-viz__chip graph-viz__chip--${state()}`}>{t(stateKey(state()))}</span>
            )}
          </Show>
          <Show when={layout().truncated > 0}>
            <span class="graph-viz__truncated">
              {t('mlearn.GraphInspector.Neighborhood.Truncated', {
                shown: layout().nodes.length,
                total: props.neighborhood.relations.length,
              })}
            </span>
          </Show>
        </div>
      </Show>
    </div>
  );
};
