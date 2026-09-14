/** Relationship-led, bounded exploration of canonical graph neighborhoods.
 * The compact asset is mirrored adjacency: connectors intentionally have no
 * arrowheads. A lexical intermediary is shown when a property is reached via it.
 */
import { type Component, For, Show, createEffect, createMemo, createSignal, untrack, onMount, onCleanup } from 'solid-js';
import type { GraphNeighborhood, GraphNode, GraphRelatedNode } from '../../../../shared/graph/ipc';
import { relationCategory } from '../../../../shared/graph/types';
import type { TargetState } from '../../../../shared/graph/explanations';
import { useLocalization } from '../../../context';
import { Btn, IconBtn } from '../Button';
import './GraphNeighborhoodViz.css';

const WIDTH = 760;
const HEIGHT = 560;
const PAGE_SIZE = 8;
const MIN_SCALE = 0.4;
const MAX_SCALE = 2.5;

export interface GraphNeighborhoodVizProps {
  neighborhood: GraphNeighborhood;
  centerState?: TargetState;
  onSelect?: (entityId: string) => void;
  onLoadMore?: () => void;
  loadingMore?: boolean;
  busy?: boolean;
}

const labelOf = (node: GraphNode): string => node.displayLabel?.trim() || node.label?.trim() || '';
const humanize = (value: string): string => value.split('::').pop()!.replace(/[-_]/g, ' ');

export interface NeighborhoodVizNode {
  id: string;
  key: string;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  relation?: GraphRelatedNode;
}
export interface NeighborhoodLayout {
  center: NeighborhoodVizNode;
  nodes: NeighborhoodVizNode[];
  truncated: number;
}

/** Linear cost, stable reading order, no collisions or moving force simulation.
 * The budget includes the center for existing callers of this exported helper.
 */
export function layoutNeighborhood(neighborhood: GraphNeighborhood, maxNodes = PAGE_SIZE + 1): NeighborhoodLayout {
  const relations = neighborhood.relations.slice(0, Math.max(0, maxNodes - 1));
  return {
    center: { id: neighborhood.center.id, key: 'center', label: labelOf(neighborhood.center), x: 112, y: HEIGHT / 2, w: 188, h: 76 },
    nodes: relations.map((relation, index) => ({
      id: relation.id, key: `${index}:${relation.relationType}:${relation.id}`,
      label: labelOf(relation), x: 570, y: HEIGHT / 2 + (index - (relations.length - 1) / 2) * 64,
      w: 304, h: 54, relation,
    })),
    truncated: neighborhood.relations.length - relations.length,
  };
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
export const kindLabelKey = (kind: string | undefined): string => {
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


interface RelationGroup { key: string; type: string; category: string; via?: GraphNode; relations: GraphRelatedNode[] }
export function groupNeighborhood(neighborhood: GraphNeighborhood): RelationGroup[] {
  const groups = new Map<string, RelationGroup>();
  for (const relation of neighborhood.relations) {
    const key = JSON.stringify([relation.relationType, relation.via?.id]);
    let group = groups.get(key);
    if (!group) {
      group = { key, type: relation.relationType, category: relationCategory(relation.relationType) ?? 'extension', via: relation.via, relations: [] };
      groups.set(key, group);
    }
    group.relations.push(relation);
  }
  return [...groups.values()];
}

interface View { scale: number; tx: number; ty: number }
interface Visit { id: string; label: string; group?: string; page: number; query?: string; view?: View }

export const GraphNeighborhoodViz: Component<GraphNeighborhoodVizProps> = (props) => {
  const { t } = useLocalization();
  const text = (key: string, params?: Record<string, string | number>) => t(`mlearn.GraphInspector.Explore.${key}`, params);
  const nodeLabel = (node: GraphNode) => labelOf(node) || t(kindLabelKey(node.kind));
  const relationLabel = (type: string) => RELATION_PHRASE_KEYS[type]
    ? t(`mlearn.GraphInspector.Relation.${RELATION_PHRASE_KEYS[type]}`) : humanize(type);
  const groups = createMemo(() => groupNeighborhood(props.neighborhood));
  const [compact, setCompact] = createSignal(false);
  const pageSize = () => compact() ? 4 : PAGE_SIZE;
  const viewportWidth = () => compact() ? 360 : WIDTH;
  const viewportHeight = () => compact() ? (group()?.via ? 224 : 156) + Math.max(0, visible().length - 1) * 64 + 76 : Math.max(240, visible().length * 64 + 64);
  const [groupKey, setGroupKey] = createSignal<string>();
  const group = createMemo(() => groups().find((item) => item.key === groupKey()) ?? groups()[0]);
  const [page, setPage] = createSignal(0);
  const [query, setQuery] = createSignal('');
  const filtered = createMemo(() => group()?.relations.filter((node) => `${nodeLabel(node)} ${t(kindLabelKey(node.kind))}`.toLocaleLowerCase().includes(query().trim().toLocaleLowerCase())) ?? []);
  const pageCount = () => Math.max(1, Math.ceil(filtered().length / pageSize()));
  const currentPage = () => Math.min(page(), pageCount() - 1);
  const visible = createMemo(() => filtered().slice(currentPage() * pageSize(), (currentPage() + 1) * pageSize()));
  const layout = createMemo(() => {
    const result = layoutNeighborhood({ ...props.neighborhood, relations: visible() });
    if (!compact()) return { ...result, center: { ...result.center, y: viewportHeight() / 2 }, nodes: result.nodes.map((node) => ({ ...node, y: node.y + (viewportHeight() - HEIGHT) / 2 })) };
    return { ...result, center: { ...result.center, x: 180, y: 52, w: 240, h: 64 },
      nodes: result.nodes.map((node, index) => ({ ...node, x: 192, y: (group()?.via ? 224 : 156) + index * 64 })) };
  });
  const viaBox = () => compact() ? { x: 100, y: 103, w: 160, h: 54 } : { x: 224, y: viewportHeight() / 2 - 32, w: 160, h: 64 };
  const edgePath = (node: NeighborhoodVizNode) => compact()
    ? `M ${group()?.via ? 100 : 60} ${group()?.via ? 130 : 52} H 24 V ${node.y} H ${node.x - node.w / 2}`
    : `M ${group()?.via ? 384 : 206} ${viewportHeight() / 2} H 400 V ${node.y} H ${node.x - node.w / 2}`;
  const [selection, setSelection] = createSignal<GraphNode & Partial<GraphRelatedNode>>();
  const [measure, setMeasure] = createSignal<CanvasRenderingContext2D | null>(null);
  const fitLabel = (label: string, width: number, size = 15): string => {
    const context = measure();
    if (context) context.font = `${size}px ${getComputedStyle(svg!).fontFamily}`;
    const chars = Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(label), (part) => part.segment);
    const length = (text: string) => context ? context.measureText(text).width : Array.from(text).length * size;
    if (length(label) <= width) return label;
    let low = 0;
    let high = chars.length;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      if (length(`${chars.slice(0, mid).join('')}…`) <= width) low = mid;
      else high = mid - 1;
    }
    return `${chars.slice(0, low).join('')}…`;
  };
  const [view, setView] = createSignal<View>();
  const fit: View = { scale: 1, tx: 0, ty: 0 };
  const currentView = () => view() ?? fit;
  const [visits, setVisits] = createSignal<Visit[]>([]);
  const [cursor, setCursor] = createSignal(-1);
  let pendingCursor: number | undefined;
  let svg: SVGSVGElement | undefined;
  onMount(() => {
    if (!svg) return;
    setMeasure(document.createElement('canvas').getContext('2d'));
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      const next = entry.contentRect.width < 500;
      if (next !== compact()) { setCompact(next); setPage(0); setView(undefined); }
    });
    observer.observe(svg);
    onCleanup(() => observer.disconnect());
  });
  let pan: { pointer: number; x: number; y: number; view: View; moved: boolean } | undefined;

  createEffect(() => {
    const center = props.neighborhood.center;
    untrack(() => {
      if (visits()[cursor()]?.id === center.id) return;
      const previous = visits().map((visit, index) => index === cursor() ? { ...visit, group: groupKey(), page: page(), query: query(), view: view() } : visit);
      const target = pendingCursor;
      pendingCursor = undefined;
      if (target !== undefined && previous[target]?.id === center.id) {
        setVisits(previous);
        setCursor(target);
        setGroupKey(previous[target].group);
        setPage(previous[target].page);
        setView(previous[target].view);
        setQuery(previous[target].query ?? '');
      } else {
        const next = [...previous.slice(0, cursor() + 1), { id: center.id, label: nodeLabel(center), page: 0 }];
        setVisits(next);
        setCursor(next.length - 1);
        setGroupKey(undefined);
        setPage(0);
        setView(undefined);
        setQuery('');
      }
      setSelection(undefined);
    });
  });

  const chooseGroup = (key: string) => {
    setGroupKey(key); setPage(0); setQuery(''); setSelection(undefined); setView(undefined);
  };
  const navigate = (id: string) => { if (id !== props.neighborhood.center.id) props.onSelect?.(id); };
  const travel = (index: number) => {
    const visit = visits()[index];
    if (!visit || !props.onSelect) return;
    pendingCursor = index;
    props.onSelect(visit.id);
  };
  const point = (event: { clientX: number; clientY: number }) => {
    // CTM accounts for SVG letterboxing at every host aspect ratio.
    const matrix = svg?.getScreenCTM();
    if (matrix && typeof DOMPoint !== 'undefined') return new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    const rect = svg!.getBoundingClientRect();
    const scale = Math.min(rect.width / viewportWidth(), rect.height / viewportHeight()) || 1;
    return { x: (event.clientX - rect.left - (rect.width - viewportWidth() * scale) / 2) / scale,
      y: (event.clientY - rect.top - (rect.height - viewportHeight() * scale) / 2) / scale };
  };
  const zoom = (factor: number, x = viewportWidth() / 2, y = viewportHeight() / 2) => {
    const old = currentView();
    const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, old.scale * factor));
    setView({ scale, tx: x - (x - old.tx) * scale / old.scale, ty: y - (y - old.ty) * scale / old.scale });
  };
  const changePage = (next: number) => { setPage(next); setSelection(undefined); setView(undefined); };
  const nodeKeyDown = (event: KeyboardEvent, relation: GraphRelatedNode) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault(); event.stopPropagation();
      if (event.key === 'Enter' && event.altKey) navigate(relation.id);
      else setSelection(relation);
    }
  };

  return <div class="graph-viz" aria-busy={props.busy}>
    <header class="graph-viz__header">
      <nav class="graph-viz__history" aria-label={text('History')}>
        <IconBtn icon="chevron" iconRotation={-90} size="sm" variant="ghost" aria-label={text('Back')} disabled={!props.onSelect || cursor() <= 0} onClick={() => travel(cursor() - 1)} />
        <IconBtn icon="chevron" iconRotation={90} size="sm" variant="ghost" aria-label={text('Forward')} disabled={!props.onSelect || cursor() >= visits().length - 1} onClick={() => travel(cursor() + 1)} />
        <Show when={cursor() > 0}><button type="button" class="graph-viz__breadcrumb" onClick={() => travel(0)}>{visits()[0]?.label}</button><span aria-hidden="true">/</span></Show>
      </nav>
      <div class="graph-viz__heading"><h2>{nodeLabel(props.neighborhood.center)}</h2><span>{t(kindLabelKey(props.neighborhood.center.kind))}</span></div>
      <Show when={props.busy}><span class="graph-viz__loading" role="status">{t('mlearn.Global.Loading')}</span></Show>
      <span class="graph-viz__count">{text('Connections', { count: props.neighborhood.relationCount })}</span>
    </header>
    <Show when={groups().length} fallback={<p class="graph-viz__empty">{t('mlearn.GraphInspector.Neighborhood.Empty')}</p>}>
      <div class="graph-viz__layout" inert={props.busy}>
        <nav class="graph-viz__index" aria-label={text('Relationships')}>
          <For each={['identity', 'property', 'support', 'extension']}>{(category) => <Show when={groups().some((item) => item.category === category)}>
            <h3>{category === 'extension' ? text('Other') : t(`mlearn.GraphInspector.${category}`)}</h3>
            <For each={groups().filter((item) => item.category === category)}>{(item) => <button type="button"
              class={`graph-viz__group graph-viz__group--${category}`} aria-pressed={group()?.key === item.key} onClick={() => chooseGroup(item.key)}>
              <span>{relationLabel(item.type)}<Show when={item.via}><small>{text('Via', { label: nodeLabel(item.via!) })}</small></Show></span><span class="graph-viz__group-count">{item.relations.length}</span>
            </button>}</For>
          </Show>}</For>
          <Show when={props.neighborhood.relations.length < props.neighborhood.relationCount}>
            <p class="graph-viz__note">{t('mlearn.GraphInspector.Neighborhood.Truncated', { shown: props.neighborhood.relations.length, total: props.neighborhood.relationCount })}</p>
            <Show when={props.onLoadMore}><Btn variant="ghost" size="sm" loading={props.loadingMore} onClick={props.onLoadMore}>{text('LoadMore')}</Btn></Show>
          </Show>
        </nav>
        <div class="graph-viz__workspace">
          <div class="graph-viz__toolbar">
            <strong>{relationLabel(group()!.type)}</strong>
            <label class="graph-viz__search"><span class="graph-viz__sr-only">{text('Filter')}</span><input type="search" value={query()} placeholder={text('Filter')} onInput={(event) => { setQuery(event.currentTarget.value); setPage(0); setSelection(undefined); setView(undefined); }} /></label>
          </div>
          <div class="graph-viz__stage">
            <svg ref={svg} class="graph-viz__svg" style={{ height: `${viewportHeight()}px` }} viewBox={`0 0 ${viewportWidth()} ${viewportHeight()}`} role="group" tabindex={0} aria-label={text('Canvas')}
              onWheel={(event) => {
                event.preventDefault();
                if (event.ctrlKey || event.metaKey) { const at = point(event); zoom(Math.exp(-event.deltaY * 0.01), at.x, at.y); }
                else { const old = currentView(); const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? HEIGHT : 1; setView({ ...old, tx: old.tx - event.deltaX * unit, ty: old.ty - event.deltaY * unit }); }
              }}
              onPointerDown={(event) => {
                if (event.button !== 0 || (event.target as Element).closest('[data-node]')) return;
                const at = point(event); pan = { pointer: event.pointerId, x: at.x, y: at.y, view: currentView(), moved: false };
                event.currentTarget.setPointerCapture(event.pointerId);
              }}
              onPointerMove={(event) => {
                if (!pan || pan.pointer !== event.pointerId) return;
                const at = point(event); pan.moved ||= Math.hypot(at.x - pan.x, at.y - pan.y) > 3;
                if (pan.moved) setView({ ...pan.view, tx: pan.view.tx + at.x - pan.x, ty: pan.view.ty + at.y - pan.y });
              }}
              onPointerUp={(event) => { if (pan?.pointer === event.pointerId) { if (!pan.moved) setSelection(undefined); pan = undefined; event.currentTarget.releasePointerCapture(event.pointerId); } }}
              onPointerCancel={() => { pan = undefined; }} onLostPointerCapture={() => { pan = undefined; }}
              onKeyDown={(event) => {
                if (event.target !== event.currentTarget) return;
                if (event.key === '+' || event.key === '=') zoom(1.2);
                else if (event.key === '-') zoom(1 / 1.2);
                else if (event.key === '0' || event.key === 'Home') setView(undefined);
                else if (event.key === 'Escape') setSelection(undefined);
                else if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
                  const old = currentView(); setView({ ...old, tx: old.tx + (event.key === 'ArrowLeft' ? 40 : event.key === 'ArrowRight' ? -40 : 0), ty: old.ty + (event.key === 'ArrowUp' ? 40 : event.key === 'ArrowDown' ? -40 : 0) });
                } else return;
                event.preventDefault();
              }}>
              <g transform={`translate(${currentView().tx} ${currentView().ty}) scale(${currentView().scale})`}>
                <Show when={group()?.via}><path class="graph-viz__edge" d={compact() ? "M 180 84 V 103" : `M 206 ${viewportHeight() / 2} H 224`} /></Show>
                <For each={layout().nodes}>{(node) => <path class={`graph-viz__edge graph-viz__edge--${group()!.category}`} classList={{ 'is-selected': selection() === node.relation }} d={edgePath(node)} />}</For>
                <g data-node="center" class="graph-viz__center">
                  <rect class={`graph-viz__chip ${props.centerState ? `graph-viz__center-ring--${props.centerState}` : ''}`} x={layout().center.x - layout().center.w / 2} y={layout().center.y - layout().center.h / 2} width={layout().center.w} height={layout().center.h} rx="6" />
                  <text class="graph-viz__kind" x={layout().center.x - layout().center.w / 2 + 14} y={layout().center.y - 15}>{t(kindLabelKey(props.neighborhood.center.kind))}</text>
                  <text class="graph-viz__label graph-viz__label--center" x={layout().center.x - layout().center.w / 2 + 14} y={layout().center.y + 15}>{fitLabel(nodeLabel(props.neighborhood.center), layout().center.w - 28, 20)}</text>
                  <title>{nodeLabel(props.neighborhood.center)}</title>
                </g>
                <Show when={group()?.via}>{(via) => <g data-node="via" class="graph-viz__node graph-viz__via" role="button" tabindex={0} aria-label={nodeLabel(via())} onClick={() => setSelection(via())} onDblClick={() => navigate(via().id)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelection(via()); } }}>
                  <rect class="graph-viz__chip" x={viaBox().x} y={viaBox().y} width={viaBox().w} height={viaBox().h} rx="4" />
                  <text class="graph-viz__kind" x={viaBox().x + 12} y={viaBox().y + 20}>{t(kindLabelKey(via().kind))}</text>
                  <text class="graph-viz__label" x={viaBox().x + 12} y={viaBox().y + 44}>{fitLabel(nodeLabel(via()), viaBox().w - 24)}</text><title>{nodeLabel(via())}</title>
                </g>}</Show>
                <For each={layout().nodes}>{(node) => <g data-node={node.key} class={`graph-viz__node graph-viz__node--${group()!.category}`} classList={{ 'graph-viz__node--selected': selection() === node.relation }} role="button" tabindex={0}
                  aria-label={`${nodeLabel(node.relation!)} · ${t(kindLabelKey(node.relation!.kind))}`} aria-pressed={selection() === node.relation}
                  onClick={() => setSelection(node.relation)} onDblClick={() => navigate(node.id)} onKeyDown={(event) => nodeKeyDown(event, node.relation!)}>
                  <rect class="graph-viz__chip" x={node.x - node.w / 2} y={node.y - node.h / 2} width={node.w} height={node.h} rx={node.relation?.kind === 'pronunciation' ? 18 : 4} />
                  <text class="graph-viz__kind" x={node.x - node.w / 2 + 14} y={node.y - 8}>{t(kindLabelKey(node.relation!.kind))}<Show when={group()!.relations.filter((item) => item.kind === node.relation!.kind && nodeLabel(item) === nodeLabel(node.relation!)).length > 1}>{` · ${group()!.relations.indexOf(node.relation!) + 1}`}</Show><Show when={node.relation?.order !== undefined}>{` · ${node.relation!.order! + 1}`}</Show></text>
                  <text class={`graph-viz__label ${node.relation?.kind === 'sense' ? 'graph-viz__label--sense' : ''}`} x={node.x - node.w / 2 + 14} y={node.y + 14}>{fitLabel(nodeLabel(node.relation!), node.w - 28, node.relation?.kind === 'sense' ? 14 : 15)}</text>
                  <title>{nodeLabel(node.relation!)}</title>
                </g>}</For>
              </g>
            </svg>
            <Show when={!visible().length}><p class="graph-viz__no-results">{text('NoMatches')}</p></Show>
            <div class="graph-viz__controls">
              <IconBtn icon="zoom-out" size="sm" variant="ghost" aria-label={t('mlearn.GraphInspector.Neighborhood.ZoomOut')} disabled={currentView().scale <= MIN_SCALE} onClick={() => zoom(1 / 1.2)} />
              <output>{Math.round(currentView().scale * 100)}%</output>
              <IconBtn icon="zoom-in" size="sm" variant="ghost" aria-label={t('mlearn.GraphInspector.Neighborhood.ZoomIn')} disabled={currentView().scale >= MAX_SCALE} onClick={() => zoom(1.2)} />
              <IconBtn icon="fit" size="sm" variant="ghost" aria-label={t('mlearn.GraphInspector.Neighborhood.Fit')} onClick={() => setView(undefined)} />
            </div>
          </div>
          <footer class="graph-viz__footer">
            <span>{text('Hint')}</span>
            <div class="graph-viz__pagination"><Btn size="sm" variant="ghost" disabled={currentPage() === 0} onClick={() => changePage(currentPage() - 1)}>{text('Previous')}</Btn><span aria-live="polite">{text('Page', { page: currentPage() + 1, total: pageCount() })}</span><Btn size="sm" variant="ghost" disabled={currentPage() >= pageCount() - 1} onClick={() => changePage(currentPage() + 1)}>{text('Next')}</Btn></div>
          </footer>
          <aside class="graph-viz__detail" aria-live="polite">
            <Show when={selection()} fallback={<p class="graph-viz__note">{text('SelectHint')}</p>}>{(node) => <>
              <div class="graph-viz__detail-heading"><strong>{nodeLabel(node())}</strong><span>{t(kindLabelKey(node().kind))}</span><Show when={props.onSelect}><Btn size="sm" variant="secondary" onClick={() => navigate(node().id)}>{text('Explore')}</Btn></Show></div>
              <Show when={node().relationType}><p>{relationLabel(node().relationType!)} · {text('ConnectedTo', { label: nodeLabel(node().via ?? props.neighborhood.center) })}</p></Show>
              <Show when={node().confidence !== undefined}><p>{t('mlearn.GraphInspector.Confidence')}: {Math.round(node().confidence! * 100)}%</p></Show>
              <details><summary>{t('mlearn.GraphInspector.Details')}</summary><dl><dt>{text('Identifier')}</dt><dd>{node().id}</dd><Show when={node().relationType}><dt>{text('Relationship')}</dt><dd>{node().relationType}</dd></Show><Show when={node().provenance}><dt>{t('mlearn.GraphInspector.Provenance')}</dt><dd>{node().provenance}</dd></Show><Show when={node().label !== node().displayLabel && node().displayLabel}><dt>{text('SourceLabel')}</dt><dd>{node().label}</dd></Show><Show when={node().role}><dt>{text('Role')}</dt><dd>{node().role}</dd></Show></dl></details>
            </>}</Show>
          </aside>
          <Show when={group()?.category === 'support'}><p class="graph-viz__note graph-viz__support-note">{t('mlearn.GraphInspector.SupportCaption')}</p></Show>
          <Show when={props.centerState}><p class="graph-viz__note">{nodeLabel(props.neighborhood.center)} · {t(stateKey(props.centerState!))}</p></Show>
        </div>
      </div>
    </Show>
  </div>;
};
