import { Component, For, Show, createEffect, createMemo, createSignal, onCleanup } from 'solid-js';
import { Portal } from 'solid-js/web';
import type { KnowledgeEvent } from '../../../../shared/knowledgeEvents';
import { readActiveEvidence } from '../../../../shared/knowledgeEvents';
import { RELATION_CATEGORY, type GraphRelationType, type RelationCategory } from '../../../../shared/graph/types';
import type { GraphNeighborhood, GraphRelatedNode, GraphWordLookup, KnowledgeProjection, KnowledgeProjectionState } from '../../../../shared/graph/ipc';
import type { WordStatus } from '../../../../shared/constants';
import { KNOWLEDGE_ASPECT_LABEL_KEYS as ASPECT_LABEL_KEYS } from '../../../../shared/constants';
import type { ReadableAspect } from '../../../utils/aspectKnowledge';
import { useLanguage, useLocalization, useSettings } from '../../../context';
import { useOptionalGraph } from '../../../context/GraphContext';
import { KnowledgeHistoryTimeline, type HistoryEvent } from '../KnowledgeHistoryTimeline';
import { PillBtn } from '../Button';
import { SkeletonRows, SkeletonText } from '../Skeleton';
import './KnowledgeProjection.css';
import type { WordKnowledgeModel } from './wordKnowledgeModel';

type Tone = 'evidence' | 'claim' | 'predicted' | 'unmeasured';
/** Four-tab per-word inspector; the capability-tab view remains for callers without a surface. */
export type InspectorTab = 'identity' | 'targets' | 'evidence' | 'prediction';

export const knowledgeTone = (state: Pick<KnowledgeProjectionState, 'basis' | 'classification'>): Tone => {
  if (state.basis === 'claim') return 'claim';
  if (state.basis === 'evidence') return 'evidence';
  if (state.basis === 'prediction') return 'predicted';
  return 'unmeasured';
};

export const knowledgeStateLabelKey = (state: Pick<KnowledgeProjectionState, 'basis' | 'classification'>): string => {
  const tone = knowledgeTone(state);
  if (tone === 'claim' || tone === 'evidence') {
    const kind = tone === 'claim' ? 'Claim' : 'Evidence';
    const label = state.classification === 'known' ? 'Known' : state.classification === 'learning' ? 'Learning' : 'Unknown';
    return `mlearn.Knowledge.Projection.${kind}.${label}`;
  }
  return `mlearn.Knowledge.Projection.${tone[0].toUpperCase()}${tone.slice(1)}`;
};

export interface KnowledgeWhy {
  key: string;
  params?: Record<string, string>;
}

/**
 * REQ29 WHY narrative: one human-readable line per capability state, composed
 * only from the fields the explanation assembly reports on the payload
 * (evidence counts/sources, claim, prediction reasons, passive familiarity).
 * No truth arithmetic here — the mapping is presentation, not classification.
 */
export const knowledgeWhyNarrative = (state: Pick<KnowledgeProjectionState, 'basis' | 'classification' | 'evidence' | 'evidenceSourceCounts' | 'strength' | 'prediction'>): KnowledgeWhy => {
  if (state.basis === 'claim') return { key: 'mlearn.Knowledge.Projection.Why.Claim' };
  if (state.basis === 'evidence') {
    const reviews = Object.values(state.evidenceSourceCounts).reduce((sum, count) => sum + count, 0);
    return { key: 'mlearn.Knowledge.Projection.Why.Evidence', params: { count: String(reviews > 0 ? reviews : state.evidence.length) } };
  }
  if (state.basis === 'prediction') {
    const links = state.prediction?.reasons.length ?? 0;
    return links > 0
      ? { key: 'mlearn.Knowledge.Projection.Why.PredictedLinks', params: { count: String(links) } }
      : { key: 'mlearn.Knowledge.Projection.Why.Predicted' };
  }
  // Unmeasured basis: passive-only familiarity is preserved on the payload —
  // exposure counts stay familiarity, never evidence (REQ13).
  const seen = state.strength?.timesSeen ?? 0;
  return seen > 0
    ? { key: 'mlearn.Knowledge.Projection.Why.Passive', params: { count: String(seen) } }
    : { key: 'mlearn.Knowledge.Projection.Why.Unmeasured' };
};

interface ProjectionProps {
  projection: KnowledgeProjection | undefined;
}

export const KnowledgeCapabilityChips: Component<ProjectionProps> = (props) => {
  const { t } = useLocalization();
  const states = createMemo(() => props.projection?.targets.flatMap((target) => target.states) ?? []);

  return <Show when={props.projection?.status === 'ready' && states().length > 0}>
    <span class="knowledge-capability-chips" title={t('mlearn.Knowledge.Projection.Capabilities')}>
      <For each={states()}>{(state) => <span class={`knowledge-chip knowledge-chip--${knowledgeTone(state)}`}>
        <span aria-hidden="true">{knowledgeTone(state) === 'evidence' ? '●' : '◐'}</span>
        {t(`mlearn.Knowledge.Capability.${state.capability}`)}
        <Show when={Object.keys(state.evidenceSourceCounts).length > 0}>
          <small title={Object.entries(state.evidenceSourceCounts).map(([source, count]) => `${source}: ${count}`).join(', ')}>
            {Object.values(state.evidenceSourceCounts).reduce((sum, count) => sum + count, 0)}
          </small>
        </Show>
      </span>}</For>
    </span>
  </Show>;
};

interface KnowledgeProjectionDrawerProps {
  /** Graph projection payload. Legacy input when no model is supplied. */
  projection?: KnowledgeProjection | undefined;
  open: boolean;
  onClose: () => void;
  onGraph?: (entityId: string) => void;
  /** Recenter the host graph view on an entity (Identity-tab relation navigation). */
  onSelectEntity?: (entityId: string) => void;
  /** Surface text; when present the drawer becomes the four-tab per-word inspector. */
  surface?: string;
  /**
   * Composed aggregate (comprehensive status + projection + events) — the
   * canonical drawer input. When absent, the legacy per-resolver props are
   * composed at the boundary with the same aggregate shape.
   */
  model?: WordKnowledgeModel;
  /** Full knowledge journal for the surface (including claim events). Legacy input when no model is supplied. */
  events?: KnowledgeEvent[];
  /** Tab to show when the drawer opens. */
  initialTab?: InspectorTab;
  /** Deliberate word-level claim editing (inspector only). Absent = read-only. */
  onWordClaim?: (claim: WordStatus | null) => void;
  /** The active word-level claim, when the comprehensive resolver reports one. Legacy input when no model is supplied. */
  wordClaim?: WordStatus | null;
  /** Deliberate aspect claim editing (inspector only). Absent = read-only. */
  onAspectClaim?: (aspect: ReadableAspect, claim: WordStatus | null) => void;
  /** Applicable non-meaning aspects with their effective state, for claim rows. */
  aspectStates?: readonly { aspect: ReadableAspect; status: WordStatus; claim?: WordStatus }[];
}
const CATEGORIES: RelationCategory[] = ['identity', 'property', 'support'];
/**
 * REQ29 identity completeness: morphology and character/component relations
 * leave the generic category groups for dedicated labeled sections (grammar
 * connections come from the projection's grammar-pattern targets). Sections
 * render only when the payload carries them.
 */
const MORPHOLOGY_RELATIONS: ReadonlySet<GraphRelationType> = new Set(['has-morpheme', 'morphologically-related']);
const CHARACTER_RELATIONS: ReadonlySet<GraphRelationType> = new Set(['has-character', 'component-of']);
const INSPECTOR_TABS: { key: InspectorTab; label: string }[] = [
  { key: 'identity', label: 'mlearn.Knowledge.Projection.Tabs.Identity' },
  { key: 'targets', label: 'mlearn.Knowledge.Projection.Tabs.Targets' },
  { key: 'evidence', label: 'mlearn.Knowledge.Projection.Tabs.EvidenceHistory' },
  { key: 'prediction', label: 'mlearn.Knowledge.Projection.Tabs.Prediction' },
];

const CLAIM_STATUSES: readonly WordStatus[] = ['known', 'learning', 'unknown'];

const statusLabelKey = (status: WordStatus): string => (
  `mlearn.WordHover.Status.${status[0].toUpperCase()}${status.slice(1)}`
);

/**
 * Deliberate claim editing (Unknown / Learning / Known / Clear override) for
 * one target — the word or a single aspect. Compact pill row; the active claim
 * is highlighted and Clear renders only while an override exists.
 */
const KnowledgeClaimControls: Component<{
  claim?: WordStatus | null;
  onClaim: (claim: WordStatus | null) => void;
}> = (props) => {
  const { t } = useLocalization();
  return (
    <span class="knowledge-claim-controls" role="group">
      <For each={CLAIM_STATUSES}>{(status) => (
        <PillBtn
          size="sm"
          variant={props.claim === status ? 'blue' : 'gray'}
          label={t(statusLabelKey(status))}
          aria-pressed={props.claim === status}
          onClick={() => props.onClaim(status)}
        />
      )}</For>
      <Show when={props.claim}>
        <PillBtn
          size="sm"
          variant="gray"
          label={t('mlearn.Knowledge.Actions.ClearOverride')}
          onClick={() => props.onClaim(null)}
        />
      </Show>
    </span>
  );
};

/**
 * One relation row: the row itself navigates (recenter the drawer/host graph
 * on that entity, REQ63); opening the graph-inspector window stays a secondary
 * affordance via onOpen.
 */
const KnowledgeRelationRow: Component<{
  relationType?: string;
  label: string;
  meta?: string;
  entityId: string;
  onNavigate: (entityId: string) => void;
  onOpen?: (entityId: string) => void;
  openLabel: string;
}> = (props) => (
  <li>
    <button type="button" class="knowledge-drawer__relation" onClick={() => props.onNavigate(props.entityId)}>
      <Show when={props.relationType}><span class="knowledge-drawer__rel-type">{props.relationType}</span></Show>
      <strong>{props.label}</strong>
      <Show when={props.meta}><small>{props.meta}</small></Show>
    </button>
    <Show when={props.onOpen}>
      <button type="button" class="knowledge-drawer__relation-open" title={props.openLabel} aria-label={props.openLabel} onClick={() => props.onOpen?.(props.entityId)}>↗</button>
    </Show>
  </li>
);

/** REQ29: one human-readable WHY line under each capability state in the Targets tab. */
const KnowledgeWhyLine: Component<{ state: KnowledgeProjectionState }> = (props) => {
  const { t } = useLocalization();
  const why = createMemo(() => knowledgeWhyNarrative(props.state));
  return <span class="knowledge-drawer__why">{t(why().key, why().params)}</span>;
};

interface TimelineRow {
  t: number;
  kind: KnowledgeEvent['kind'] | 'evidence';
  source: string;
  detail?: string;
  claimStatus?: string;
}

export const KnowledgeProjectionDrawer: Component<KnowledgeProjectionDrawerProps> = (props) => {
  const { t } = useLocalization();
  const { settings } = useSettings();
  const { installLanguageData, getLanguageDataStatus } = useLanguage();
  const graph = useOptionalGraph();
  const [selected, setSelected] = createSignal(0);
  const [tab, setTab] = createSignal<InspectorTab>('identity');
  const [lookup, setLookup] = createSignal<GraphWordLookup | null>(null);
  const [neighborhood, setNeighborhood] = createSignal<GraphNeighborhood | null>(null);
  const [lookupState, setLookupState] = createSignal<'idle' | 'loading' | 'ready' | 'missing'>('idle');
  /** Relations-fetch lifecycle for the identity tab (independent of the surface identity payload). */
  const [relationsState, setRelationsState] = createSignal<'idle' | 'loading' | 'ready'>('idle');
  /** REQ63 navigation target; undefined = the word's own surface is the center. */
  const [focusedId, setFocusedId] = createSignal<string | undefined>();

  const inspector = createMemo(() => props.surface !== undefined && props.surface.trim().length > 0);
  // REQ34 canonical aggregate: composed by the host when available, otherwise
  // legacy props are composed at the boundary into the same shape.
  const model = createMemo<WordKnowledgeModel>(() => props.model ?? {
    projection: props.projection,
    events: props.events,
    wordClaim: props.wordClaim ?? null,
    excluded: false,
  });
  const states = createMemo(() => model().projection?.targets.flatMap((target) => target.states.map((state) => ({ state, entityId: target.targetRef.id }))) ?? []);
  const active = createMemo(() => states()[Math.min(selected(), Math.max(states().length - 1, 0))]);

  createEffect(() => {
    if (props.open && inspector()) setTab(props.initialTab ?? 'identity');
  });

  createEffect(() => {
    const surface = props.surface;
    if (!surface || !props.open || !inspector()) return;
    let disposed = false;
    setFocusedId(undefined);
    setLookupState('loading');
    void graph.lookupWord({ surface }).then((result) => {
      if (disposed) return;
      setLookup(result);
      setLookupState(result ? 'ready' : 'missing');
    }).catch(() => {
      if (disposed) return;
      setLookup(null);
      setLookupState('missing');
    });
    onCleanup(() => { disposed = true; });
  });

  // Neighborhood of the inspected entity: the surface itself, or the relation
  // targeted by Identity-tab navigation. Absence degrades honestly.
  createEffect(() => {
    if (!props.open || !inspector() || !graph.meta().ready) return;
    const target = focusedId() ?? lookup()?.surfaceId;
    if (!target) return;
    let disposed = false;
    setRelationsState('loading');
    void graph.getNeighborhood({ entityId: target, depth: 1 }).then((next) => {
      if (disposed) return;
      setNeighborhood(next);
      setRelationsState('ready');
    }).catch(() => {
      if (disposed) return;
      setNeighborhood(null);
      setRelationsState('ready');
    });
    onCleanup(() => { disposed = true; });
  });

  /** REQ63: recenter drawer relations and the host graph view on one entity. */
  const navigateTo = (entityId: string) => {
    setFocusedId(entityId);
    props.onSelectEntity?.(entityId);
  };
  const exitFocus = () => setFocusedId(undefined);

  /**
   * Relations display under their real ontology category. The graph never
   * encodes sibling-form kinship (殖える/増える share one dictionary entry) as
   * identity: the builder emits explicit `semantically-related` support edges
   * between entry siblings, and learner state never flows across them —
   * support is prediction-only context, never inherited knowledge.
   */
  const grouped = createMemo(() => {
    const groups: Record<RelationCategory, GraphRelatedNode[]> = { identity: [], property: [], support: [] };
    for (const relation of neighborhood()?.relations ?? []) {
      if (MORPHOLOGY_RELATIONS.has(relation.relationType) || CHARACTER_RELATIONS.has(relation.relationType)) continue;
      groups[RELATION_CATEGORY[relation.relationType]].push(relation);
    }
    return groups;
  });
  const morphologyRelations = createMemo(() => (neighborhood()?.relations ?? []).filter((relation) => MORPHOLOGY_RELATIONS.has(relation.relationType)));
  const characterRelations = createMemo(() => (neighborhood()?.relations ?? []).filter((relation) => CHARACTER_RELATIONS.has(relation.relationType)));
  /** Grammar connections: grammar-pattern targets the projection carries for this surface. */
  const grammarTargets = createMemo(() => (model().projection?.targets ?? []).filter((target) => target.targetRef.kind === 'grammar-pattern'));

  const labelFor = (entityId: string): string | undefined => {
    const nb = neighborhood();
    if (!nb) return undefined;
    if (nb.center.id === entityId) return nb.center.label;
    return nb.relations.find((relation) => relation.id === entityId)?.label;
  };

  const canonicalForm = createMemo(() => lookup()?.lexemes[0]?.label ?? lookup()?.entries[0]?.label);
  const pronunciations = createMemo(() => lookup()?.pronunciations ?? []);
  const senseCount = () => lookup()?.senses.length ?? 0;

  // Install can only ever fix what the published package actually contains.
  // If the catalog bundle for this language ships no graph asset, the button
  // would be a dead action — show the not-published note instead.
  const canInstall = () => {
    const status = graph.meta().status;
    if (status !== 'not-installed' && status !== 'unavailable') return false;
    const catalog = getLanguageDataStatus(settings.language);
    return catalog?.assets.some((asset) => asset.path.endsWith('.graph.json')) ?? false;
  };

  /** Journal rows for the timeline: retractions and retracted events applied away. */
  const journalEvents = createMemo<HistoryEvent[]>(() => (
    model().events ? readActiveEvidence(model().events!).filter(
      (event): event is HistoryEvent => event.kind !== 'retraction',
    ) : []
  ));

  const timeline = createMemo<TimelineRow[]>(() => {
    if (model().events && model().events!.length > 0) {
      return model().events!.map((event) => ({
        t: event.t,
        kind: event.kind,
        source: event.source,
        claimStatus: event.kind === 'claim' ? event.toStatus : undefined,
        detail: event.kind === 'claim' ? undefined : event.quality ?? event.rating,
      })).sort((a, b) => b.t - a.t);
    }
    return states().flatMap(({ state }) => state.evidence.map((evidence) => ({
      t: evidence.timestamp,
      kind: 'evidence' as const,
      source: evidence.source,
      detail: evidence.quality,
    }))).sort((a, b) => b.t - a.t);
  });

  const provenanceCounts = createMemo(() => {
    const counts = new Map<string, number>();
    for (const { state } of states()) {
      for (const [source, count] of Object.entries(state.evidenceSourceCounts)) {
        counts.set(source, (counts.get(source) ?? 0) + count);
      }
    }
    return [...counts.entries()];
  });

  const retentionRows = createMemo(() => states().filter(({ state }) => state.retention));
  const predictedRows = createMemo(() => states().filter(({ state }) => state.prediction));

  // Portal: the drawer is position:fixed, and every fixed-position element
  // inside a transformed ancestor (.virtual-row in Word DB, hover containers)
  // resolves its containing block there — collapsing the drawer into the row.
  // Mounting on document.body escapes all ancestor transforms.
  return <Show when={props.open}>
    <Portal>
    <aside class="knowledge-drawer" aria-label={t('mlearn.Knowledge.Projection.Details')}>
      <header class="knowledge-drawer__header">
        <strong>{t('mlearn.Knowledge.Projection.Details')}</strong>
        <span class="knowledge-drawer__header-end">
          <Show when={model().excluded}><span class="knowledge-drawer__excluded">{t('mlearn.Knowledge.Projection.Excluded')}</span></Show>
          <button type="button" class="knowledge-drawer__close" onClick={props.onClose} aria-label={t('mlearn.Global.Close')}>×</button>
        </span>
      </header>
      <Show when={inspector()} fallback={
        <Show when={states().length > 0} fallback={<p class="knowledge-drawer__empty">{t('mlearn.Knowledge.Projection.Unavailable')}</p>}>
          <div class="knowledge-drawer__tabs" role="tablist">
            <For each={states()}>{({ state }, index) => <button type="button" role="tab" aria-selected={selected() === index()} class={selected() === index() ? 'is-active' : ''} onClick={() => setSelected(index())}>
              {t(`mlearn.Knowledge.Capability.${state.capability}`)}
            </button>}</For>
          </div>
          <Show when={active()}>{(item) => <section class={`knowledge-drawer__state knowledge-state--${knowledgeTone(item().state)}`}>
            <p class="knowledge-drawer__label">{t(knowledgeStateLabelKey(item().state))}</p>
            <Show when={item().state.strength}>{(strength) => <p>{t('mlearn.Knowledge.Projection.Strength', { ease: strength().ease.toFixed(2), seen: String(strength().timesSeen), hovered: String(strength().timesHovered) })}</p>}</Show>
            <Show when={item().state.retention}>{(retention) => <p>{t('mlearn.Knowledge.Projection.Retention', { pressure: retention().pressure.toFixed(2), due: new Date(retention().dueAt).toLocaleString() })}</p>}</Show>
            <Show when={(item().state.prediction?.reasons.length ?? 0) > 0}><div><strong>{t('mlearn.Knowledge.Projection.Because')}</strong><ul><For each={item().state.prediction?.reasons ?? []}>{(reason) => <li>{reason}</li>}</For></ul></div></Show>
            <h3>{t('mlearn.Knowledge.Projection.Evidence.Title')}</h3>
            <Show when={item().state.evidence.length > 0} fallback={<p>{t('mlearn.Knowledge.Projection.Evidence.None')}</p>}>
              <ul class="knowledge-drawer__evidence"><For each={item().state.evidence}>{(evidence) => <li>{new Date(evidence.timestamp).toLocaleString()} · {evidence.source}<Show when={evidence.quality}> · {evidence.quality}</Show>{evidence.latencyMs !== undefined && ` · ${evidence.latencyMs}ms`}</li>}</For></ul>
              <p class="knowledge-drawer__provenance">{Object.entries(item().state.evidenceSourceCounts).map(([source, count]) => `${source} ${count}`).join(' · ')}</p>
            </Show>
            <Show when={props.onGraph}><button type="button" class="knowledge-drawer__graph" onClick={() => props.onGraph?.(item().entityId)}>{t('mlearn.Knowledge.Projection.Graph')}</button></Show>
          </section>}</Show>
        </Show>
      }>
        <div class="knowledge-drawer__tabs" role="tablist">
          <For each={INSPECTOR_TABS}>{(item) => <button type="button" role="tab" aria-selected={tab() === item.key} class={tab() === item.key ? 'is-active' : ''} onClick={() => setTab(item.key)}>
            {t(item.label)}
          </button>}</For>
        </div>

        <Show when={tab() === 'identity'}>
          <Show when={graph.readiness() !== 'pending'} fallback={<SkeletonText lines={2} />}>
          <Show when={graph.meta().ready} fallback={
            <div class="knowledge-drawer__degraded">
              <p>{t('mlearn.Knowledge.Projection.Identity.NotInstalled')}</p>
              <p>{t('mlearn.Knowledge.GraphContract.Degraded')}</p>
              <Show when={canInstall()}>
                <button type="button" class="knowledge-drawer__install" onClick={() => installLanguageData(settings.language)}>{t('mlearn.Knowledge.Projection.Identity.Install')}</button>
              </Show>
              <Show when={!canInstall() && getLanguageDataStatus(settings.language)}>
                {/* Only a loaded catalog proves the package omits the graph;
                    while the catalog is still loading the absence is not evidence. */}
                <p>{t('mlearn.Knowledge.GraphContract.NotPublished')}</p>
              </Show>
            </div>
          }>
            <Show when={lookupState() === 'missing'} fallback={
              <Show when={lookupState() === 'ready'}>
                <dl class="knowledge-drawer__identity">
                  <div><dt>{t('mlearn.Knowledge.Projection.Identity.Surface')}</dt><dd>{props.surface}</dd></div>
                  <Show when={canonicalForm()}><div><dt>{t('mlearn.Knowledge.Projection.Identity.Canonical')}</dt><dd>{canonicalForm()}</dd></div></Show>
                  <Show when={senseCount() > 0}><div><dt>{t('mlearn.Knowledge.Projection.Identity.Senses')}</dt><dd>{String(senseCount())}</dd></div></Show>
                </dl>
                <Show when={focusedId()}>
                  {(id) => <div class="knowledge-drawer__focus">
                    <span>{t('mlearn.Knowledge.Projection.Identity.Viewing', { label: labelFor(id()) ?? id() })}</span>
                    <button type="button" class="knowledge-drawer__focus-close" onClick={exitFocus} aria-label={t('mlearn.Knowledge.Projection.Identity.BackToWord', { word: props.surface ?? '' })}>×</button>
                  </div>}
                </Show>
                <Show when={(neighborhood()?.centerStates?.length ?? 0) > 0}>
                  <div class="knowledge-capability-chips knowledge-drawer__center-states">
                    <For each={neighborhood()!.centerStates}>{(centerState) => <span class={`knowledge-chip knowledge-chip--${knowledgeTone(centerState)}`}>
                      {t(`mlearn.Knowledge.Capability.${centerState.capability}`)} · {t(knowledgeStateLabelKey(centerState))}
                    </span>}</For>
                  </div>
                </Show>
                <Show when={relationsState() === 'loading'}>
                  <SkeletonRows rows={2} />
                </Show>
                <Show when={relationsState() === 'ready'}>
                  <Show when={neighborhood()} fallback={
                    <Show when={focusedId()}>
                      <div class="knowledge-drawer__degraded">
                        <p>{t('mlearn.Knowledge.Projection.Identity.NotInGraph')}</p>
                        <button type="button" class="knowledge-drawer__install" onClick={exitFocus}>{t('mlearn.Knowledge.Projection.Identity.BackToWord', { word: props.surface ?? '' })}</button>
                      </div>
                    </Show>
                  }>
                    <Show when={pronunciations().length > 0}>
                      <section class="knowledge-drawer__section knowledge-drawer__section--identity">
                        <h3>{t('mlearn.Knowledge.Projection.Identity.Sections.Pronunciations')}</h3>
                        <ul class="knowledge-drawer__relations">
                          <For each={pronunciations()}>{(node) => <KnowledgeRelationRow
                            label={node.label ?? node.id}
                            entityId={node.id}
                            onNavigate={navigateTo}
                            onOpen={props.onGraph}
                            openLabel={t('mlearn.GraphInspector.Neighborhood.OpenInWindow')}
                          />}</For>
                        </ul>
                      </section>
                    </Show>
                    <For each={CATEGORIES}>{(category) => <section class={`knowledge-drawer__section knowledge-drawer__section--${category}`}>
                      <h3>{t(`mlearn.GraphInspector.${category}`)}</h3>
                      <Show when={category === 'support'}><p class="knowledge-drawer__caption">{t('mlearn.GraphInspector.SupportCaption')}</p></Show>
                      <Show when={grouped()[category].length > 0} fallback={<p class="knowledge-drawer__none">{t('mlearn.Knowledge.Projection.Identity.None')}</p>}>
                        <ul class="knowledge-drawer__relations">
                          <For each={grouped()[category]}>{(relation) => <KnowledgeRelationRow
                            relationType={relation.relationType}
                            label={relation.label ?? relation.id}
                            meta={relationMetadata(relation)}
                            entityId={relation.id}
                            onNavigate={navigateTo}
                            onOpen={props.onGraph}
                            openLabel={t('mlearn.GraphInspector.Neighborhood.OpenInWindow')}
                          />}</For>
                        </ul>
                      </Show>
                    </section>}</For>
                    <Show when={morphologyRelations().length > 0}>
                      <section class="knowledge-drawer__section knowledge-drawer__section--property">
                        <h3>{t('mlearn.Knowledge.Projection.Identity.Sections.Morphology')}</h3>
                        <ul class="knowledge-drawer__relations">
                          <For each={morphologyRelations()}>{(relation) => <KnowledgeRelationRow
                            relationType={relation.relationType}
                            label={relation.label ?? relation.id}
                            meta={relationMetadata(relation)}
                            entityId={relation.id}
                            onNavigate={navigateTo}
                            onOpen={props.onGraph}
                            openLabel={t('mlearn.GraphInspector.Neighborhood.OpenInWindow')}
                          />}</For>
                        </ul>
                      </section>
                    </Show>
                    <Show when={characterRelations().length > 0}>
                      <section class="knowledge-drawer__section knowledge-drawer__section--property">
                        <h3>{t('mlearn.Knowledge.Projection.Identity.Sections.Characters')}</h3>
                        <ul class="knowledge-drawer__relations">
                          <For each={characterRelations()}>{(relation) => <KnowledgeRelationRow
                            relationType={relation.relationType}
                            label={relation.label ?? relation.id}
                            meta={relationMetadata(relation)}
                            entityId={relation.id}
                            onNavigate={navigateTo}
                            onOpen={props.onGraph}
                            openLabel={t('mlearn.GraphInspector.Neighborhood.OpenInWindow')}
                          />}</For>
                        </ul>
                      </section>
                    </Show>
                    <Show when={grammarTargets().length > 0}>
                      <section class="knowledge-drawer__section knowledge-drawer__section--support">
                        <h3>{t('mlearn.Knowledge.Projection.Identity.Sections.Grammar')}</h3>
                        <ul class="knowledge-drawer__relations">
                          <For each={grammarTargets()}>{(target) => <KnowledgeRelationRow
                            label={labelFor(target.targetRef.id) ?? target.targetRef.id}
                            entityId={target.targetRef.id}
                            onNavigate={navigateTo}
                            onOpen={props.onGraph}
                            openLabel={t('mlearn.GraphInspector.Neighborhood.OpenInWindow')}
                          />}</For>
                        </ul>
                      </section>
                    </Show>
                    <Show when={props.onGraph}><button type="button" class="knowledge-drawer__graph" onClick={() => props.onGraph?.(neighborhood()!.center.id)}>{t('mlearn.Knowledge.Projection.FullGraph')}</button></Show>
                  </Show>
                </Show>
              </Show>
            }>
              <p class="knowledge-drawer__degraded">{t('mlearn.Knowledge.Projection.Identity.NoGraph')}</p>
            </Show>
          </Show>
          </Show>
        </Show>

        <Show when={tab() === 'targets'}>
          <Show when={props.onWordClaim}>
            <section class="knowledge-drawer__section knowledge-drawer__section--claims">
              <h3>{t('mlearn.Knowledge.Popup.Overall')}</h3>
              <KnowledgeClaimControls claim={model().wordClaim} onClaim={props.onWordClaim!} />
            </section>
          </Show>
          <Show when={props.onAspectClaim && (props.aspectStates?.length ?? 0) > 0}>
            <section class="knowledge-drawer__section knowledge-drawer__section--claims">
              <h3>{t('mlearn.Knowledge.Projection.AspectClaims')}</h3>
              <For each={props.aspectStates}>{(item) => (
                <div class="knowledge-drawer__claim-row">
                  <span class="knowledge-drawer__claim-aspect">{t(ASPECT_LABEL_KEYS[item.aspect])}</span>
                  <KnowledgeClaimControls claim={item.claim} onClaim={(claim) => props.onAspectClaim?.(item.aspect, claim)} />
                </div>
              )}</For>
            </section>
          </Show>
          <Show when={states().length > 0} fallback={<p class="knowledge-drawer__empty">{t('mlearn.Knowledge.Projection.Unavailable')}</p>}>
            <For each={model().projection?.targets}>{(target) => <section class="knowledge-drawer__target">
              <h3>{labelFor(target.targetRef.id) ?? target.targetRef.id}</h3>
              <For each={target.states}>{(state) => <div class={`knowledge-drawer__state knowledge-state--${knowledgeTone(state)}`}>
                <span class="knowledge-drawer__cap">{t(`mlearn.Knowledge.Capability.${state.capability}`)}</span>
                <strong>{t(knowledgeStateLabelKey(state))}</strong>
                <KnowledgeWhyLine state={state} />
                <Show when={state.basis !== 'claim'}><span class="knowledge-drawer__basis">{t(basisLabelKey(state))}</span></Show>
                <Show when={state.basis === 'claim' && state.evidence.length > 0}><small class="knowledge-drawer__override">{t('mlearn.Knowledge.Projection.ClaimOverride')}</small></Show>
                <Show when={state.strength}>{(strength) => <small class="knowledge-drawer__strength">{t('mlearn.Knowledge.Projection.Strength', { ease: strength().ease.toFixed(2), seen: String(strength().timesSeen), hovered: String(strength().timesHovered) })}</small>}</Show>
              </div>}</For>
            </section>}</For>
          </Show>
        </Show>

        <Show when={tab() === 'evidence'}>
          <section class="knowledge-drawer__section">
            <h3>{t('mlearn.Knowledge.Projection.Evidence.Title')}</h3>
            <Show when={journalEvents().length > 0} fallback={
              <Show when={timeline().length > 0} fallback={<p>{t('mlearn.Knowledge.Projection.Evidence.None')}</p>}>
                <ul class="knowledge-drawer__evidence">
                  <For each={timeline()}>{(row) => <li class={`knowledge-drawer__event${row.kind === 'claim' ? ' knowledge-drawer__event--claim' : ''}`}>
                    <span class="knowledge-drawer__event-time">{new Date(row.t).toLocaleString()}</span>
                    <Show when={row.kind === 'claim'} fallback={<span>{row.source}<Show when={row.detail}> · {row.detail}</Show></span>}>
                      <span>{row.claimStatus ? t('mlearn.Knowledge.Projection.Evidence.Claim', { status: t(`mlearn.WordHover.Status.${row.claimStatus[0].toUpperCase()}${row.claimStatus.slice(1)}`) }) : t('mlearn.Knowledge.Projection.Evidence.ClaimCleared')}</span>
                    </Show>
                  </li>}</For>
                </ul>
              </Show>
            }>
              <KnowledgeHistoryTimeline events={journalEvents()} />
            </Show>
          </section>
          <section class="knowledge-drawer__section">
            <h3>{t('mlearn.Knowledge.Projection.Provenance')}</h3>
            <Show when={provenanceCounts().length > 0} fallback={<p>{t('mlearn.Knowledge.Projection.Evidence.None')}</p>}>
              <p class="knowledge-drawer__provenance">{provenanceCounts().map(([source, count]) => `${source} ${count}`).join(' · ')}</p>
            </Show>
          </section>
          <section class="knowledge-drawer__section">
            <h3>{t('mlearn.Knowledge.Projection.Retention')}</h3>
            <Show when={retentionRows().length > 0} fallback={<p>{t('mlearn.Knowledge.Projection.Evidence.None')}</p>}>
              <ul class="knowledge-drawer__retention"><For each={retentionRows()}>{({ state }) => <li>
                <span class="knowledge-drawer__cap">{t(`mlearn.Knowledge.Capability.${state.capability}`)}</span>
                {t('mlearn.Knowledge.Projection.Retention', { pressure: state.retention!.pressure.toFixed(2), due: new Date(state.retention!.dueAt).toLocaleString() })}
              </li>}</For></ul>
            </Show>
          </section>
        </Show>

        <Show when={tab() === 'prediction'}>
          <Show when={predictedRows().length > 0} fallback={<p class="knowledge-drawer__empty">{t('mlearn.Knowledge.Projection.Prediction.None')}</p>}>
            <For each={predictedRows()}>{({ state, entityId }) => <section class="knowledge-drawer__prediction knowledge-state--predicted">
              <h3>{t(`mlearn.Knowledge.Capability.${state.capability}`)} · {labelFor(entityId) ?? entityId}</h3>
              <p class="knowledge-drawer__label">{t('mlearn.Knowledge.Projection.Predicted')} · {Math.round(state.prediction!.value * 100)}%</p>
              <ul><For each={state.prediction!.reasons}>{(reason) => <li>{reason}</li>}</For></ul>
            </section>}</For>
          </Show>
        </Show>
      </Show>
    </aside>
    </Portal>
  </Show>;
};

function relationMetadata(relation: GraphRelatedNode): string | undefined {
  return [relation.domain, relation.confidence, relation.provenance].filter((value) => value !== undefined).join(' · ');
}

function basisLabelKey(state: KnowledgeProjectionState): string {
  switch (state.basis) {
    case 'claim': return 'mlearn.Knowledge.Basis.Claim';
    case 'evidence': return 'mlearn.Knowledge.Basis.Evidence';
    case 'prediction': return 'mlearn.Knowledge.Basis.Predicted';
    default: return 'mlearn.Knowledge.Basis.Unmeasured';
  }
}