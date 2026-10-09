import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount, type Component } from 'solid-js';
import { effectiveThresholds } from '../../../shared/knowledge/effectiveKnowledge';
import { WINDOW_TYPES } from '../../../shared/constants';
import { assembleTargetExplanation, type TargetState } from '../../../shared/graph/explanations';
import type { KeyArchive } from '../../../shared/knowledge/historyArchive';
import type { CapabilityKey } from '../../../shared/graph/types';
import type { GraphNeighborhood } from '../../../shared/graph/ipc';
import { getBridge } from '../../../shared/bridges';
import { attemptActiveLatencyMs } from '../../../shared/knowledgeEvents';
import { WindowWrapper, useFlashcards, useGraph, useLocalization, useSettings } from '../../context';
import { formatDate, formatDateTime } from '../../utils/timeFormatting';
import { useGraphNeighborhood } from '../../hooks/useGraphNeighborhood';
import { CAPABILITY_LABEL_KEYS } from '../../../shared/graph/access';
import { GraphNeighborhoodViz, KnowledgeLoadError, SkeletonText } from '../../components/common';
import { GraphProvider } from '../../context/GraphContext';
import './GraphInspector.css';

const targetStates: Record<TargetState, string> = {
  'evidence-backed-known': 'Known',
  'claimed-known': 'Known (claim)',
  'claimed-learning': 'Learning (claim)',
  'claimed-unknown': 'Unknown (claim)',
  learning: 'Learning',
  unknown: 'Unknown',
  predicted: 'Predicted',
  unmeasured: 'Unmeasured',
};

export const GraphInspectorContent: Component<{ sourceLanguage?: () => string; initialEntity?: () => string | undefined }> = (props) => {
  const { t } = useLocalization();
  const { settings } = useSettings();
  const { store } = useFlashcards();
  const graph = useGraph();
  const [entityId, setEntityId] = createSignal<string>();
  createEffect(() => { if (props.initialEntity) setEntityId(props.initialEntity()); });
  const { neighborhood, pending, failed, loadingMore, loadMore, retry } = useGraphNeighborhood(graph, entityId);
  const [selectedCapability, setSelectedCapability] = createSignal<CapabilityKey>();
  const [events, setEvents] = createSignal<import('../../../shared/graph/explanations').JournalRow[]>([]);
  const [archive, setArchive] = createSignal<KeyArchive | undefined>(undefined);
  const [details, setDetails] = createSignal(false);
  const [journalPending, setJournalPending] = createSignal(false);
  const [journalFailed, setJournalFailed] = createSignal(false);
  const [journalLoaded, setJournalLoaded] = createSignal(false);
  const [journalRevision, setJournalRevision] = createSignal(0);
  let admittedJournalKey: string | undefined;

  onMount(() => {
    if (props.initialEntity) return;
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
    // Re-run when the active-language graph (re)resolves: during a language
    // switch the pending probe clears the stale neighborhood, and the
    // settled meta triggers a fresh fetch for the new language.
    graph.readiness();
    let disposed = false;
    onCleanup(() => { disposed = true; });
    journalRevision();
    const hash = id.match(/:surface:([a-f0-9]{64})$/i)?.[1];
    if (!hash) {
      setEvents([]);
      setArchive(undefined);
      setJournalLoaded(false);
      setJournalPending(false);
      setJournalFailed(false);
      admittedJournalKey = undefined;
      return;
    }
    const journalKey = `${props.sourceLanguage?.() ?? settings.language}:${hash}`;
    // Archived evidence participates in the explanation view: coarse old
    // attempts resolve through the same address matcher as exact rows.
    if (admittedJournalKey !== journalKey) {
      admittedJournalKey = journalKey;
      setSelectedCapability(undefined);
      setEvents([]);
      setArchive(undefined);
      setJournalLoaded(false);
    }
    setJournalPending(true);
    setJournalFailed(false);
    const owner = getBridge().knowledgeEvents;
    void Promise.all([owner.getKnowledgeRows([journalKey]), owner.getKnowledgeArchive(journalKey)])
      .then(([log, envelope]) => {
        if (disposed) return;
        setEvents(log[journalKey] ?? []);
        setArchive(envelope.archive);
        setJournalLoaded(true);
      }).catch(() => { if (!disposed) setJournalFailed(true); })
      .finally(() => { if (!disposed) setJournalPending(false); });
  });

  const explanation = createMemo(() => journalLoaded() && selectedCapability() ? assembleTargetExplanation(selectedCapability()!, events(), store.meta, Date.now(), undefined, undefined, archive() ? [archive() as KeyArchive] : undefined, effectiveThresholds(settings)) : undefined);

  return <div class="graph-inspector">
    <Show when={graph.readiness() === 'pending'}><div class="graph-inspector__empty" aria-busy="true"><SkeletonText lines={4} /></div></Show>
    <Show when={graph.readiness() !== 'pending'}>
    <Show when={!graph.meta().ready}>
      <div class="graph-inspector__degraded">
        <p class="graph-inspector__empty">{t('mlearn.GraphInspector.Unavailable')}</p>
        <p class="graph-inspector__empty">{t('mlearn.Knowledge.GraphContract.Degraded')}</p>
      </div>
    </Show>
    <Show when={pending() && !neighborhood()}><SkeletonText lines={4} /></Show>
    <Show when={failed()}><KnowledgeLoadError message={t('mlearn.GraphInspector.Explore.LoadFailed')} onRetry={retry} /></Show>
    <Show when={graph.meta().ready && !pending() && !failed() && !neighborhood()}><p class="graph-inspector__empty">{t('mlearn.GraphInspector.SelectEntity')}</p></Show>
    <Show when={neighborhood()}>
      <section class="graph-inspector__section">
        <h1>{t('mlearn.GraphInspector.Explore.Title')}</h1>
        <GraphNeighborhoodViz
          neighborhood={neighborhood()!}
          centerState={explanation()?.state}
          busy={pending()}
          onLoadMore={loadMore}
          loadingMore={loadingMore()}
          onSelect={(id) => { setSelectedCapability(undefined); setEntityId(id); }}
        />
      </section>
      <Show when={details()}><section class="graph-inspector__targets"><h2>{t('mlearn.GraphInspector.Capabilities')}</h2><For each={capabilitiesFor(neighborhood()!)}>{(capability) => <button type="button" class="graph-inspector__chip" classList={{ 'is-active': selectedCapability() === capability }} onClick={() => setSelectedCapability(capability)}>{t(CAPABILITY_LABEL_KEYS[capability] ?? capability)}</button>}</For></section></Show>
      <button type="button" class="graph-inspector__details" onClick={() => setDetails(!details())}>{t('mlearn.GraphInspector.Details')}</button>
      <Show when={details()}><pre>{`${neighborhood()!.center.id}\ndense: ${neighborhood()!.centerDenseId}\nrelations: ${neighborhood()!.relationCount}`}</pre></Show>
    </Show>
    <Show when={details() && journalPending()}><SkeletonText lines={3} /></Show>
    <Show when={details() && journalFailed()}><KnowledgeLoadError onRetry={() => setJournalRevision(value => value + 1)} /></Show>
    <Show when={details() && explanation()}>{(value) => <section class="graph-inspector__target">
      <h2>{t('mlearn.GraphInspector.Target')}</h2><p>{t(CAPABILITY_LABEL_KEYS[selectedCapability()!] ?? selectedCapability()!)} · <strong>{t(`mlearn.GraphInspector.State.${targetStates[value().state]}`)}</strong></p>
      <p>{value().projection ? `${t('mlearn.GraphInspector.Projection')}: ${value().projection!.ease.toFixed(2)}` : t('mlearn.GraphInspector.NoDirectEvidence')}</p>
      <Show when={value().retention}><p>{t('mlearn.GraphInspector.Retention')}: {value().retention!.pressure.toFixed(2)} · {formatDateTime(value().retention!.dueAt, settings.uiLanguage)}</p></Show>
      <h3>{t('mlearn.GraphInspector.Evidence')}</h3><For each={value().evidence}>{(event) => <p>{formatDate(event.t, settings.uiLanguage)} · {event.source} · {event.quality ?? event.rating ?? ''}{event.stalled ? ` · ${t('mlearn.GraphInspector.LatencyUnreliable')}` : attemptActiveLatencyMs(event) !== undefined ? ` · ${attemptActiveLatencyMs(event)}ms` : ''}</p>}</For>
      <Show when={value().state === 'predicted'}><p>{t('mlearn.GraphInspector.PredictionFirewall')}</p></Show>
    </section>}</Show>
    </Show>
  </div>;
};

const ScopedGraphInspector: Component = () => {
  const { settings } = useSettings();
  const [context, setContext] = createSignal<{ language?: string; entityId?: string }>({});
  onMount(() => {
    const bridge = getBridge();
    const cleanup = bridge.window.onWindowContext((value) => {
      setContext({ language: typeof value?.language === 'string' ? value.language : undefined,
        entityId: typeof value?.entityId === 'string' ? value.entityId : undefined });
    });
    bridge.window.getWindowContext(WINDOW_TYPES.GRAPH_INSPECTOR);
    if (cleanup) onCleanup(cleanup);
  });
  const language = () => context().language ?? settings.language;
  return <GraphProvider language={language}><GraphInspectorContent sourceLanguage={language} initialEntity={() => context().entityId} /></GraphProvider>;
};
export const GraphInspectorApp: Component = () => <WindowWrapper showDragRegion><ScopedGraphInspector /></WindowWrapper>;

function capabilitiesFor(neighborhood: GraphNeighborhood): CapabilityKey[] {
  if (neighborhood.center.kind !== 'surface') return [];
  return [...new Set(['surface-recognition',
    ...(neighborhood.relations.some((relation) => relation.relationType === 'has-pronunciation') ? ['surface-reading' as const, 'pronunciation-production' as const] : []),
    // Pitch/tone data is a property of the surface like pronunciation, so its
    // capability belongs in the inspector's selectable set alongside it.
    ...(neighborhood.relations.some((relation) => relation.relationType === 'has-prosodic-pattern') ? ['prosodic-pattern' as const] : []),
    ...(neighborhood.center.learnableCapabilities ?? []),
  ])];
}
