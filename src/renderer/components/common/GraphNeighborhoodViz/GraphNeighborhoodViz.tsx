/**
 * Bounded local neighborhood graph for one inspected entity: the center node
 * and its one-hop relations as labeled chip nodes connected by typed, directed
 * edges (identity / property / support).
 *
 * Layout is a deterministic collision-aware force pass: category rings seed
 * positions, then an AABB separation pass resolves chip overlaps while ring
 * springs keep each relation category on its own radius. Labels live inside
 * the chips, so label-on-label collisions are impossible by construction.
 * The initial view zoom-to-fits the laid-out content. No dependencies; hosts
 * stay in charge of fetching; recenter intent is reported via `onSelect`.
 */

import { Component, For, Show, createEffect, createMemo, createSignal, createUniqueId } from 'solid-js';
import type { GraphNeighborhood, GraphRelatedNode } from '../../../../shared/graph/ipc';
import { relationCategory, type RelationCategory } from '../../../../shared/graph/types';
import type { TargetState } from '../../../../shared/graph/explanations';
import { useLocalization } from '../../../context';
import { Btn, IconBtn } from '../Button';
import './GraphNeighborhoodViz.css';

const CATEGORY_ORDER: readonly RelationCategory[] = ['identity', 'property', 'support'];
const VIEW_WIDTH = 760;
const VIEW_HEIGHT = 460;
/** Neighbors revealed before the progressive "show all" affordance. */
const INITIAL_VISIBLE = 18;
const RING_GAP = 90;
const CHIP_GAP = 10;
const CHIP_HEIGHT = 30;
const CENTER_HEIGHT = 40;
const MIN_SCALE = 0.45;
const MAX_SCALE = 2.6;
const FIT_PADDING = 34;
const ITERATIONS = 140;

export interface GraphNeighborhoodVizProps {
  neighborhood: GraphNeighborhood;
  /** Learner classification of the CENTER surface, when resolved. */
  centerState?: TargetState;
  /** Navigate (recenter) onto an entity — double-click or the detail-panel action. */
  onSelect?: (entityId: string) => void;
}

export interface NeighborhoodVizNode {
  id: string;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  category?: RelationCategory;
  relation?: GraphRelatedNode;
  center?: boolean;
}

export interface NeighborhoodVizEdge {
  id: string;
  category: RelationCategory;
  relation: GraphRelatedNode;
}

export interface NeighborhoodLayout {
  center: NeighborhoodVizNode;
  nodes: NeighborhoodVizNode[];
  edges: NeighborhoodVizEdge[];
  truncated: number;
}

const categoryOf = (relation: GraphRelatedNode): RelationCategory => (
  relationCategory(relation.relationType) ?? 'support'
);

/** Chip width estimate: CJK glyphs run ~1em, latin ~0.55em at 13px. */
const chipWidth = (label: string): number => {
  let text = 0;
  for (const char of label) text += char.charCodeAt(0) > 0x2e80 ? 13 : 7.5;
  return Math.ceil(text) + 24;
};

const LABEL_LIMIT = 24;

const shortLabel = (label: string): string => (
  label.length > LABEL_LIMIT ? `${label.slice(0, LABEL_LIMIT - 1)}…` : label
);

const ringRadius = (rings: number, index: number): number => {
  const maxRadius = Math.min(VIEW_WIDTH, VIEW_HEIGHT) / 2 - RING_GAP;
  return rings > 0 ? (maxRadius * (index + 1)) / rings : 0;
};

/**
 * Deterministic layout: relations ring out from the center by category
 * (identity innermost), then a collision pass separates overlapping chips
 * while a ring spring keeps categories on their radii. Center stays pinned.
 */
export function layoutNeighborhood(neighborhood: GraphNeighborhood, maxNodes = INITIAL_VISIBLE): NeighborhoodLayout {
  const centerX = VIEW_WIDTH / 2;
  const centerY = VIEW_HEIGHT / 2;
  const center: NeighborhoodVizNode = {
    id: neighborhood.center.id,
    label: shortLabel(neighborhood.center.label ?? neighborhood.center.id),
    x: centerX,
    y: centerY,
    w: chipWidth(neighborhood.center.label ?? neighborhood.center.id) + 12,
    h: CENTER_HEIGHT,
    center: true,
  };
  const nodes: NeighborhoodVizNode[] = [center];
  const edges: NeighborhoodVizEdge[] = [];
  const relations = neighborhood.relations.slice(0, Math.max(0, maxNodes - 1));
  const present = CATEGORY_ORDER.filter((category) => relations.some((relation) => categoryOf(relation) === category));
  present.forEach((category, ringIndex) => {
    const group = relations.filter((relation) => categoryOf(relation) === category);
    const radius = ringRadius(present.length, ringIndex);
    group.forEach((relation, index) => {
      const angle = (2 * Math.PI * index) / group.length + ringIndex * (Math.PI / (2 * Math.max(present.length, 1))) - Math.PI / 2;
      const label = shortLabel(relation.label ?? relation.id);
      nodes.push({
        id: relation.id,
        label,
        x: centerX + radius * Math.cos(angle),
        y: centerY + radius * Math.sin(angle),
        w: chipWidth(label),
        h: CHIP_HEIGHT,
        category,
        relation,
      });
      edges.push({ id: `${category}:${relation.id}`, category, relation });
    });
  });

  // Collision-aware relaxation: AABB separation (push along the shallower
  // overlap axis) + ring spring. Center is pinned; no randomness → stable
  // output for identical payloads.
  for (let iteration = 0; iteration < ITERATIONS; iteration++) {
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i];
        const b = nodes[j];
        const overlapX = (a.w + b.w) / 2 + CHIP_GAP - Math.abs(a.x - b.x);
        const overlapY = (a.h + b.h) / 2 + CHIP_GAP - Math.abs(a.y - b.y);
        if (overlapX <= 0 || overlapY <= 0) continue;
        const signX = a.x <= b.x ? -1 : 1;
        const signY = a.y <= b.y ? -1 : 1;
        if (overlapX <= overlapY) {
          if (!a.center) a.x += signX * (overlapX / 2);
          if (!b.center) b.x -= signX * (overlapX / 2);
        } else {
          if (!a.center) a.y += signY * (overlapY / 2);
          if (!b.center) b.y -= signY * (overlapY / 2);
        }
      }
    }
    for (const node of nodes) {
      if (node.center || node.category === undefined) continue;
      const target = ringRadius(present.length, present.indexOf(node.category));
      const dx = node.x - centerX;
      const dy = node.y - centerY;
      const distance = Math.hypot(dx, dy) || 1;
      const pull = (target - distance) * 0.08;
      node.x += (dx / distance) * pull;
      node.y += (dy / distance) * pull;
    }
  }
  return { center, nodes: nodes.slice(1), edges, truncated: neighborhood.relations.length - relations.length };
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

/** Humanized entity kind: core kinds resolve through i18n; package extensions keep their local name. */
const kindLabelKey = (kind: string | undefined): string => {
  if (!kind) return 'mlearn.GraphInspector.Kind.Entity';
  const known: Record<string, string> = {
    surface: 'Surface',
    'dictionary-entry': 'DictionaryEntry',
    lexeme: 'Lexeme',
    sense: 'Sense',
    pronunciation: 'Pronunciation',
    character: 'Character',
    morpheme: 'Morpheme',
    'grammar-pattern': 'GrammarPattern',
    analysis: 'Analysis',
  };
  if (known[kind]) return `mlearn.GraphInspector.Kind.${known[kind]}`;
  return kind.includes('::') ? kind.split('::').pop()!.replace(/-/g, ' ') : kind;
};

const relationDetails = (relation: GraphRelatedNode): string => (
  [relation.relationType, relation.domain, relation.confidence, relation.provenance]
    .filter((value) => value !== undefined)
    .join(' · ')
);

const RELATION_PHRASE_KEYS: Partial<Record<string, string>> = {
  realizes: 'Realizes',
  'has-sense': 'SenseOf',
  'has-pronunciation': 'Pronunciation',
  'has-reading': 'Reading',
  'has-gender': 'Gender',
  'has-pos': 'PartOfSpeech',
  'has-prosodic-pattern': 'ProsodicPattern',
  'has-character': 'Character',
  'has-morpheme': 'Morpheme',
  'inflection-of': 'FormOf',
  'lemma-of': 'LemmaOf',
  'orthographic-variant-of': 'SpellingVariantOf',
  'component-of': 'PartOf',
  'derived-from': 'DerivedFrom',
  'semantically-related': 'RelatedMeaning',
  'morphologically-related': 'RelatedForm',
  'contrasts-with': 'ContrastsWith',
};

interface ViewTransform {
  scale: number;
  tx: number;
  ty: number;
}

export const GraphNeighborhoodViz: Component<GraphNeighborhoodVizProps> = (props) => {
  const { t } = useLocalization();
  const markerId = createUniqueId();
  const [limit, setLimit] = createSignal(INITIAL_VISIBLE);
  const [hidden, setHidden] = createSignal(new Set<RelationCategory>());
  const layout = createMemo(() => {
    const visible = props.neighborhood.relations.filter((relation) => !hidden().has(categoryOf(relation)));
    return layoutNeighborhood({ ...props.neighborhood, relations: visible }, limit());
  });

  // Zoom-to-fit is computed from the laid-out content bounds; explicit pan/zoom
  // replaces it. Any re-layout (new payload, filter, reveal) resets to fit.
  const [view, setView] = createSignal<ViewTransform | undefined>();
  const [dragOffsets, setDragOffsets] = createSignal<Map<string, { dx: number; dy: number }>>(new Map());
  const [selectedId, setSelectedId] = createSignal<string | undefined>();
  let svgEl: SVGSVGElement | undefined;
  let panning: { pointerId: number; startX: number; startY: number; tx: number; ty: number } | undefined;
  let draggingNode: { pointerId: number; id: string; startX: number; startY: number; dx: number; dy: number } | undefined;

  createEffect(() => {
    layout();
    setView(undefined);
    setDragOffsets(new Map());
    setSelectedId(undefined);
  });

  const fitTransform = (): ViewTransform => {
    // Bounds include the center chip: without it one-relation graphs fit
    // off-center, and with every category filtered the bounds would be empty.
    const nodes = [layout().center, ...layout().nodes];
    const minX = Math.min(...nodes.map((node) => node.x - node.w / 2)) - FIT_PADDING;
    const maxX = Math.max(...nodes.map((node) => node.x + node.w / 2)) + FIT_PADDING;
    const minY = Math.min(...nodes.map((node) => node.y - node.h / 2)) - FIT_PADDING;
    const maxY = Math.max(...nodes.map((node) => node.y + node.h / 2)) + FIT_PADDING;
    const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE,
      Math.min(VIEW_WIDTH / (maxX - minX), VIEW_HEIGHT / (maxY - minY)), 1));
    return {
      scale,
      tx: VIEW_WIDTH / 2 - ((minX + maxX) / 2) * scale,
      ty: VIEW_HEIGHT / 2 - ((minY + maxY) / 2) * scale,
    };
  };
  const currentView = (): ViewTransform => view() ?? fitTransform();

  const resetView = () => {
    setView(undefined);
    setDragOffsets(new Map());
  };

  const zoomAt = (factor: number, cx: number, cy: number) => {
    const previous = currentView();
    const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, previous.scale * factor));
    const applied = scale / previous.scale;
    setView({
      scale,
      tx: cx - (cx - previous.tx) * applied,
      ty: cy - (cy - previous.ty) * applied,
    });
  };

  const svgPoint = (event: PointerEvent | WheelEvent): { x: number; y: number } => {
    const rect = svgEl!.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * VIEW_WIDTH,
      y: ((event.clientY - rect.top) / rect.height) * VIEW_HEIGHT,
    };
  };

  const onWheel = (event: WheelEvent) => {
    event.preventDefault();
    const point = svgPoint(event);
    zoomAt(event.deltaY < 0 ? 1.15 : 1 / 1.15, point.x, point.y);
  };

  const onBackgroundPointerDown = (event: PointerEvent) => {
    panning = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, tx: currentView().tx, ty: currentView().ty };
    (event.currentTarget as Element).setPointerCapture(event.pointerId);
  };

  const onBackgroundPointerMove = (event: PointerEvent) => {
    if (!panning || event.pointerId !== panning.pointerId) return;
    const rect = svgEl!.getBoundingClientRect();
    const scaleX = VIEW_WIDTH / rect.width;
    const scaleY = VIEW_HEIGHT / rect.height;
    setView({
      ...currentView(),
      tx: panning.tx + (event.clientX - panning.startX) * scaleX,
      ty: panning.ty + (event.clientY - panning.startY) * scaleY,
    });
  };

  const endPan = (event: PointerEvent) => {
    if (panning?.pointerId === event.pointerId) panning = undefined;
  };

  const worldPosition = (node: NeighborhoodVizNode): { x: number; y: number } => {
    const offset = dragOffsets().get(node.id);
    return offset ? { x: node.x + offset.dx, y: node.y + offset.dy } : { x: node.x, y: node.y };
  };

  const onNodePointerDown = (event: PointerEvent, node: NeighborhoodVizNode) => {
    event.stopPropagation();
    draggingNode = { pointerId: event.pointerId, id: node.id, startX: event.clientX, startY: event.clientY, dx: 0, dy: 0 };
    (event.currentTarget as Element).setPointerCapture(event.pointerId);
  };

  const onNodePointerMove = (event: PointerEvent, node: NeighborhoodVizNode) => {
    if (!draggingNode || draggingNode.pointerId !== event.pointerId || draggingNode.id !== node.id) return;
    const rect = svgEl!.getBoundingClientRect();
    const dx = ((event.clientX - draggingNode.startX) * (VIEW_WIDTH / rect.width)) / currentView().scale;
    const dy = ((event.clientY - draggingNode.startY) * (VIEW_HEIGHT / rect.height)) / currentView().scale;
    draggingNode.dx = dx;
    draggingNode.dy = dy;
    setDragOffsets((previous) => new Map(previous).set(node.id, { dx, dy }));
  };

  const endNodeDrag = (event: PointerEvent, node: NeighborhoodVizNode) => {
    if (draggingNode?.pointerId !== event.pointerId || draggingNode.id !== node.id) return;
    const moved = Math.hypot(draggingNode.dx, draggingNode.dy) > 3;
    draggingNode = undefined;
    if (!moved) {
      // A tap selects (highlight + detail); navigation is the double-click /
      // detail-panel action, so panning-adjacent taps never jump the graph.
      setSelectedId(node.id);
    }
  };

  const toggleCategory = (category: RelationCategory) => {
    setHidden((previous) => {
      const next = new Set(previous);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  };

  const categoryCount = (category: RelationCategory): number => (
    props.neighborhood.relations.filter((relation) => categoryOf(relation) === category).length
  );

  const selected = createMemo(() => {
    const id = selectedId();
    if (id === undefined) return undefined;
    if (id === layout().center.id) {
      return { isCenter: true as const, node: layout().center, relation: undefined as GraphRelatedNode | undefined, category: undefined as RelationCategory | undefined };
    }
    const node = layout().nodes.find((candidate) => candidate.id === id);
    if (!node) return undefined;
    return { isCenter: false as const, node, relation: node.relation, category: node.category };
  });

  /** Human phrase for the selected relation, resolved from the ontology vocabulary. */
  const phrase = (relation: GraphRelatedNode | undefined): string | undefined => {
    const key = relation ? RELATION_PHRASE_KEYS[relation.relationType] : undefined;
    return key ? t(`mlearn.GraphInspector.Relation.${key}`) : undefined;
  };

  const confidencePercent = (confidence: number | undefined): string | undefined => (
    confidence === undefined ? undefined : `${Math.round(confidence * 100)}%`
  );

  const edgeActive = (edge: NeighborhoodVizEdge): boolean => (
    selectedId() !== undefined && selectedId() !== layout().center.id && edge.relation.id === selectedId()
  );

  const edgeDimmed = (edge: NeighborhoodVizEdge): boolean => (
    selectedId() !== undefined && selectedId() !== layout().center.id && !edgeActive(edge)
  );

  const nodeDimmed = (id: string): boolean => (
    selectedId() !== undefined && selectedId() !== id && !(id === layout().center.id)
  );

  /** Trim the center→node edge at the chip rectangle so arrows touch, not overlap. */
  const edgeEnds = (node: NeighborhoodVizNode) => {
    const from = worldPosition(layout().center);
    const to = worldPosition(node);
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    if (dx === 0 && dy === 0) return { x1: from.x, y1: from.y, x2: to.x, y2: to.y };
    const trim = (halfW: number, halfH: number, gap: number) => {
      const scaleX = dx !== 0 ? (halfW + gap) / Math.abs(dx) : Infinity;
      const scaleY = dy !== 0 ? (halfH + gap) / Math.abs(dy) : Infinity;
      return Math.min(1, Math.min(scaleX, scaleY));
    };
    const start = trim(layout().center.w / 2, layout().center.h / 2, 4);
    const end = 1 - trim(node.w / 2, node.h / 2, 6);
    return {
      x1: from.x + dx * start,
      y1: from.y + dy * start,
      x2: from.x + dx * Math.max(end, start),
      y2: from.y + dy * Math.max(end, start),
    };
  };

  return (
    <div class="graph-viz" classList={{ 'graph-viz--has-selection': selected() !== undefined }}>
      <Show
        when={props.neighborhood.relations.length > 0}
        fallback={<p class="graph-viz__empty">{t('mlearn.GraphInspector.Neighborhood.Empty')}</p>}
      >
        <div class="graph-viz__layout">
          <div class="graph-viz__stage">
            <div class="graph-viz__legend" role="group" aria-label={t('mlearn.GraphInspector.Neighborhood.Title')}>
              <For each={[...CATEGORY_ORDER]}>{(category) => (
                <button
                  type="button"
                  class={`graph-viz__legend-chip graph-viz__legend-chip--${category}`}
                  classList={{ 'is-off': hidden().has(category) }}
                  aria-pressed={!hidden().has(category)}
                  onClick={() => toggleCategory(category)}
                >
                  <span class="graph-viz__legend-dot" aria-hidden="true" />
                  {t(`mlearn.GraphInspector.${category}`)}
                  <small>{categoryCount(category)}</small>
                </button>
              )}</For>
            </div>
            <svg
              ref={(el) => { svgEl = el; }}
              class="graph-viz__svg"
              viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
              role="img"
              aria-label={t('mlearn.GraphInspector.Neighborhood.Title')}
              onWheel={onWheel}
              onClick={(event) => {
                // Clicking the empty canvas (the svg element itself, not a
                // node) clears the selection.
                if (event.target === event.currentTarget) setSelectedId(undefined);
              }}
              onPointerDown={onBackgroundPointerDown}
              onPointerMove={onBackgroundPointerMove}
              onPointerUp={endPan}
              onPointerCancel={endPan}
              onDblClick={resetView}
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
              <g transform={`translate(${currentView().tx} ${currentView().ty}) scale(${currentView().scale})`}>
                <For each={layout().edges}>{(edge) => {
                  const node = layout().nodes.find((candidate) => candidate.id === edge.relation.id)!;
                  const ends = edgeEnds(node);
                  return (
                    <line
                      class={`graph-viz__edge graph-viz__edge--${edge.category}`}
                      classList={{
                        'graph-viz__edge--active': edgeActive(edge),
                        'graph-viz__edge--dim': edgeDimmed(edge),
                      }}
                      x1={ends.x1}
                      y1={ends.y1}
                      x2={ends.x2}
                      y2={ends.y2}
                      marker-end={`url(#gv-arrow-${markerId}-${edge.category})`}
                    >
                      <title>{relationDetails(edge.relation)}</title>
                    </line>
                  );
                }}</For>
                <For each={layout().nodes}>{(node) => (
                  <g
                    class={`graph-viz__node graph-viz__node--${node.category}`}
                    classList={{
                      'graph-viz__node--dim': nodeDimmed(node.id),
                      'graph-viz__node--selected': selectedId() === node.id,
                    }}
                    role="button"
                    tabindex={0}
                    aria-label={node.label}
                    onPointerDown={(event) => onNodePointerDown(event, node)}
                    onPointerMove={(event) => onNodePointerMove(event, node)}
                    onPointerUp={(event) => endNodeDrag(event, node)}
                    onPointerCancel={(event) => endNodeDrag(event, node)}
                    onDblClick={() => props.onSelect?.(node.id)}
                    onClick={() => setSelectedId(node.id)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        setSelectedId(node.id);
                      }
                    }}
                  >
                    <rect
                      class="graph-viz__chip"
                      x={worldPosition(node).x - node.w / 2}
                      y={worldPosition(node).y - node.h / 2}
                      width={node.w}
                      height={node.h}
                      rx={node.h / 2}
                    />
                    <text class="graph-viz__label" x={worldPosition(node).x} y={worldPosition(node).y + 4.5} text-anchor="middle">{node.label}</text>
                    <title>{`${node.label} — ${relationDetails(node.relation!)}`}</title>
                  </g>
                )}</For>
                <g
                  class="graph-viz__node graph-viz__node--center"
                  role="button"
                  tabindex={0}
                  aria-label={layout().center.label}
                  onClick={() => setSelectedId(layout().center.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      setSelectedId(layout().center.id);
                    }
                  }}
                >
                  <rect
                    class={`graph-viz__chip ${props.centerState ? `graph-viz__center-ring--${props.centerState}` : ''}`}
                    x={worldPosition(layout().center).x - layout().center.w / 2}
                    y={worldPosition(layout().center).y - layout().center.h / 2}
                    width={layout().center.w}
                    height={layout().center.h}
                    rx={layout().center.h / 2}
                  />
                  <text class="graph-viz__label graph-viz__label--center" x={worldPosition(layout().center).x} y={worldPosition(layout().center).y + 5} text-anchor="middle">
                    {layout().center.label}
                  </text>
                  <title>{props.centerState ? `${layout().center.label} — ${t(stateKey(props.centerState))}` : layout().center.label}</title>
                </g>
              </g>
            </svg>
            <div class="graph-viz__controls">
              <IconBtn icon="zoom-in" size="sm" variant="secondary" aria-label={t('mlearn.GraphInspector.Neighborhood.ZoomIn')} onClick={() => zoomAt(1.25, VIEW_WIDTH / 2, VIEW_HEIGHT / 2)} />
              <IconBtn icon="zoom-out" size="sm" variant="secondary" aria-label={t('mlearn.GraphInspector.Neighborhood.ZoomOut')} onClick={() => zoomAt(1 / 1.25, VIEW_WIDTH / 2, VIEW_HEIGHT / 2)} />
              <IconBtn icon="fit" size="sm" variant="secondary" aria-label={t('mlearn.GraphInspector.Neighborhood.Fit')} onClick={resetView} />
            </div>
            <div class="graph-viz__footer">
              <Show when={layout().nodes.length - 1 + props.neighborhood.relations.filter((relation) => hidden().has(categoryOf(relation))).length < props.neighborhood.relations.length}>
                <span class="graph-viz__truncated">
                  {t('mlearn.GraphInspector.Neighborhood.Truncated', {
                    shown: layout().nodes.length - 1 + props.neighborhood.relations.filter((relation) => hidden().has(categoryOf(relation))).length,
                    total: props.neighborhood.relations.length,
                  })}
                </span>
              </Show>
              <Show when={props.neighborhood.relations.length > limit()}>
                {/* The layout budget counts the center, so the reveal limit
                    must exceed the relation count by one. */}
                <button type="button" class="graph-viz__show-all" onClick={() => setLimit(props.neighborhood.relations.length + 1)}>
                  {t('mlearn.GraphInspector.Neighborhood.ShowAll', { count: String(props.neighborhood.relations.length) })}
                </button>
              </Show>
            </div>
          </div>
          <Show when={selected()}>
            {(selection) => (
              <aside class="graph-viz__detail">
                <header class="graph-viz__detail-header">
                  <strong>{selection().node.label}</strong>
                  <button type="button" class="graph-viz__detail-close" aria-label={t('mlearn.Global.Close')} onClick={() => setSelectedId(undefined)}>×</button>
                </header>
                <p class="graph-viz__detail-kind">{t(kindLabelKey(selection().isCenter ? props.neighborhood.center.kind : selection().relation?.kind))}</p>
                <Show when={!selection().isCenter && selection().relation}>
                  {(relation) => (
                    <div class="graph-viz__detail-facts">
                      <Show when={phrase(relation())}>
                        <p class="graph-viz__detail-phrase">{t('mlearn.GraphInspector.PhraseOf', { phrase: phrase(relation())!, word: layout().center.label })}</p>
                      </Show>
                      <Show when={confidencePercent(relation().confidence) !== undefined}>
                        <p class="graph-viz__detail-meta">{t('mlearn.GraphInspector.Confidence')}: {confidencePercent(relation().confidence)}</p>
                      </Show>
                      <Show when={relation().provenance !== undefined}>
                        <p class="graph-viz__detail-meta">{t('mlearn.GraphInspector.Provenance')}: {relation().provenance}</p>
                      </Show>
                    </div>
                  )}
                </Show>
                <Show when={props.centerState}>
                  <p class="graph-viz__detail-state">
                    {t('mlearn.GraphInspector.Neighborhood.CenterState', { state: t(stateKey(props.centerState!)) })}
                  </p>
                </Show>
                <Show when={!selection().isCenter && props.onSelect}>
                  <Btn size="sm" variant="secondary" onClick={() => props.onSelect?.(selectedId()!)}>{t('mlearn.GraphInspector.SelectEntity')}</Btn>
                </Show>
              </aside>
            )}
          </Show>
        </div>
      </Show>
    </div>
  );
};
