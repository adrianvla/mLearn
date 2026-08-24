import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount, type Component } from 'solid-js';
import { WINDOW_TYPES } from '../../../shared/constants';
import { assembleTargetExplanation, type TargetState } from '../../../shared/graph/explanations';
import type { CapabilityKind, RelationCategory } from '../../../shared/graph/types';
import type { GraphNeighborhood } from '../../../shared/graph/ipc';
import { getBridge } from '../../../shared/bridges';
import { WindowWrapper, useFlashcards, useGraph, useLocalization, useSettings } from '../../context';
import { openGraphInspector } from '../../services/openGraphInspector';
import './GraphInspector.css';

const classes: RelationCategory[] = ['identity', 'property', 'support'];
const targetStates: Record<TargetState, string> = {
  'evidence-backed-known': 'Known', learning: 'Learning', predicted: 'Predicted', unmeasured: 'Unmeasured', excluded: 'Excluded',
};

export const GraphInspectorContent: Component = () => {
  const { t } = useLocalization();
  const { settings } = useSettings();
  const { store } = useFlashcards();
  const graph = useGraph();
  const [entityId, setEntityId] = createSignal<string>();
  const [neighborhood, setNeighborhood] = createSignal<GraphNeighborhood | null>();
  const [selectedCapability, setSelectedCapability] = createSignal<CapabilityKind>();
  const [events, setEvents] = createSignal<import('../../../shared/knowledgeEvents').KnowledgeEvent[]>([]);
  const [details, setDetails] = createSignal(false);

  onMount(() => {
    const bridge = getBridge();
    const cleanup = bridge.window.onWindowContext((context) => {
      if (typeof context?.entityId === 'string') setEntityId(context.entityId);
    });
    bridge.window.getWindowContext(WINDOW_TYPES.GRAPH_INSPECTOR);
    if (cleanup) onCleanup(cleanup);
  });

  createEffect(() => {
    const id = entityId();
    if (!id) return;
    void graph.getNeighborhood({ entityId: id, depth: 1 }).then(setNeighborhood);
    const hash = id.match(/:surface:([a-f0-9]{64})$/i)?.[1];
    if (!hash) {
      setEvents([]);
      return;
    }
    void getBridge().knowledgeEvents.getKnowledgeEvents(`${settings.language}:${hash}`).then((log) => setEvents(log[`${settings.language}:${hash}`] ?? []));
  });

  const grouped = createMemo(() => Object.fromEntries(classes.map((category) => [category,
    neighborhood()?.relations.filter((relation) => relation.relationType && categoryFor(relation.relationType) === category) ?? [],
  ])) as Record<RelationCategory, NonNullable<GraphNeighborhood['relations']>>);
  const explanation = createMemo(() => selectedCapability() ? assembleTargetExplanation(selectedCapability()!, events(), store.meta) : undefined);

  return <div class="graph-inspector">
    <header class="graph-inspector__header"><h1>{t('mlearn.GraphInspector.Title')}</h1><Show when={neighborhood()?.center}><p>{neighborhood()!.center.label ?? neighborhood()!.center.id}</p></Show></header>
    <Show when={!graph.meta().ready}><p class="graph-inspector__empty">{t('mlearn.GraphInspector.Unavailable')}</p></Show>
    <Show when={graph.meta().ready && !neighborhood()}><p class="graph-inspector__empty">{t('mlearn.GraphInspector.SelectEntity')}</p></Show>
    <Show when={neighborhood()}>
      <section class="graph-inspector__targets"><h2>{t('mlearn.GraphInspector.Capabilities')}</h2><For each={capabilitiesFor(neighborhood()!)}>{(capability) => <button type="button" class="graph-inspector__chip" onClick={() => setSelectedCapability(capability)}>{capability}</button>}</For></section>
      <For each={classes}>{(category) => <section class={`graph-inspector__section graph-inspector__section--${category}`}>
        <h2>{t(`mlearn.GraphInspector.${category}`)}</h2><Show when={category === 'support'}><p>{t('mlearn.GraphInspector.SupportCaption')}</p></Show>
        <For each={grouped()[category]}>{(relation) => <button type="button" class="graph-inspector__relation" onClick={() => openGraphInspector({ entityId: relation.id })}>
          <span>{relation.relationType}</span><strong>{relation.label ?? relation.id}</strong><small>{metadata(relation)}</small>
        </button>}</For>
      </section>}</For>
      <button type="button" class="graph-inspector__details" onClick={() => setDetails(!details())}>{t('mlearn.GraphInspector.Details')}</button>
      <Show when={details()}><pre>{`${neighborhood()!.center.id}\ndense: ${neighborhood()!.centerDenseId}\nrelations: ${neighborhood()!.relationCount}`}</pre></Show>
    </Show>
    <Show when={explanation()}>{(value) => <section class="graph-inspector__target">
      <h2>{t('mlearn.GraphInspector.Target')}</h2><p>{selectedCapability()} · <strong>{t(`mlearn.GraphInspector.State.${targetStates[value().state]}`)}</strong></p>
      <p>{value().projection ? `${t('mlearn.GraphInspector.Projection')}: ${value().projection!.ease.toFixed(2)}` : t('mlearn.GraphInspector.NoDirectEvidence')}</p>
      <Show when={value().retention}><p>{t('mlearn.GraphInspector.Retention')}: {value().retention!.pressure.toFixed(2)} · {new Date(value().retention!.dueAt).toLocaleString()}</p></Show>
      <h3>{t('mlearn.GraphInspector.Evidence')}</h3><For each={value().evidence}>{(event) => <p>{new Date(event.t).toLocaleDateString()} · {event.source} · {event.quality ?? event.rating ?? ''}{event.latencyMs ? ` · ${event.latencyMs}ms` : ''}</p>}</For>
      <Show when={value().state === 'predicted'}><p>{t('mlearn.GraphInspector.PredictionFirewall')}</p></Show>
    </section>}</Show>
  </div>;
};

export const GraphInspectorApp: Component = () => <WindowWrapper showDragRegion><GraphInspectorContent /></WindowWrapper>;

function categoryFor(type: import('../../../shared/graph/types').GraphRelationType): RelationCategory {
  return type === 'inflection-of' || type === 'lemma-of' ? 'identity' : type.startsWith('has-') || type === 'realizes' ? 'property' : 'support';
}
function capabilitiesFor(neighborhood: GraphNeighborhood): CapabilityKind[] {
  if (neighborhood.center.kind !== 'surface') return [];
  return ['surface-recognition', ...(neighborhood.relations.some((relation) => relation.relationType === 'has-pronunciation') ? ['surface-reading' as const, 'pronunciation-production' as const] : [])];
}
function metadata(relation: GraphNeighborhood['relations'][number]): string {
  return [relation.domain, relation.confidence, relation.provenance].filter((value) => value !== undefined).join(' · ');
}
