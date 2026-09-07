import { Component, For, Show, createEffect, createMemo, createSignal, onCleanup } from 'solid-js';
import { Modal } from '../Modal';
import { readActiveEvidence } from '../../../../shared/knowledgeEvents';
import type { GraphRelatedNode, GraphWordLookup, KnowledgeProjectionState } from '../../../../shared/graph/ipc';
import type { CapabilityKind, GraphRelationType } from '../../../../shared/graph/types';
import type { WordStatus } from '../../../../shared/constants';
import { CAPABILITY_LABEL_KEYS } from '../../../../shared/graph/access';
import type { RatedCapability } from '../../../utils/accessKnowledge';
import { useLanguage, useLocalization, useSettings } from '../../../context';
import { useOptionalGraph } from '../../../context/GraphContext';
import { KnowledgeHistoryTimeline, type HistoryEvent } from '../KnowledgeHistoryTimeline';
import { PillBtn } from '../Button';
import { TabContainer } from '../Tabs';
import { SkeletonRows, SkeletonText } from '../Skeleton';
import {
  BASIS_LABEL_KEYS,
  UNTRACKED_LABEL_KEY,
  isUntrackedKnowledge,
  knowledgeStatusLabelKey,
  projectionStateForCapability,
  type KnowledgeBasisToken,
} from '../WordStatusPillKnowledge/knowledgeSummary';
import './KnowledgeProjection.css';
import type { WordKnowledgeModel } from './wordKnowledgeModel';

type Tone = 'evidence' | 'claim' | 'predicted' | 'unmeasured';
/** Canonical per-word inspector tabs: understand → connect → history → expectation. */
export type InspectorTab = 'overview' | 'relations' | 'history' | 'prediction';

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

export interface KnowledgeProjectionDrawerProps {
  open: boolean;
  onClose: () => void;
  /** Canonical aggregate: comprehensive status + projection + journal (see assembleWordKnowledgeModel). */
  model: WordKnowledgeModel;
  /** Inspected surface text. */
  surface: string;
  /** Open the standalone graph window on an entity — secondary affordance. */
  onGraph?: (entityId: string) => void;
  /** Recenter the host graph view on an entity (relation navigation). */
  onSelectEntity?: (entityId: string) => void;
  /** Tab to show when the drawer opens. */
  initialTab?: InspectorTab;
  /** Deliberate word-level claim editing. Absent = read-only. */
  onWordClaim?: (claim: WordStatus | null) => void;
  /** Deliberate access claim editing. Absent = read-only. */
  onAccessClaim?: (capability: RatedCapability, claim: WordStatus | null) => void;
  /**
   * Applicable non-sense accesses with their effective state as resolved by
   * the access resolvers (status, claim, basis token, untracked flag).
   */
  accessStates?: readonly { capability: RatedCapability; status: WordStatus; claim?: WordStatus; basis?: KnowledgeBasisToken; untracked?: boolean }[];
}

const INSPECTOR_TABS: { key: InspectorTab; label: string }[] = [
  { key: 'overview', label: 'mlearn.Knowledge.Projection.Tabs.Overview' },
  { key: 'relations', label: 'mlearn.Knowledge.Projection.Tabs.Relations' },
  { key: 'history', label: 'mlearn.Knowledge.Projection.Tabs.History' },
  { key: 'prediction', label: 'mlearn.Knowledge.Projection.Tabs.Prediction' },
];

const CLAIM_STATUSES: readonly WordStatus[] = ['known', 'learning', 'unknown'];

const statusLabelKey = (status: WordStatus): string => (
  `mlearn.WordHover.Status.${status[0].toUpperCase()}${status.slice(1)}`
);

/** Core relation types phrased as human concepts; package extensions fall back to their kind. */
const RELATION_PHRASE_KEYS: Partial<Record<GraphRelationType, string>> = {
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
  'orthographic-variant-of': 'SpellingVariantOf',
  'component-of': 'PartOf',
  'derived-from': 'DerivedFrom',
  'semantically-related': 'RelatedMeaning',
  'morphologically-related': 'RelatedForm',
  'contrasts-with': 'ContrastsWith',
};

const relationPhraseKey = (type: GraphRelationType): string | undefined => {
  const known = RELATION_PHRASE_KEYS[type];
  return known ? `mlearn.GraphInspector.Relation.${known}` : undefined;
};

const MORPHOLOGY_RELATIONS: ReadonlySet<GraphRelationType> = new Set(['has-morpheme', 'morphologically-related']);
const CHARACTER_RELATIONS: ReadonlySet<GraphRelationType> = new Set(['has-character', 'component-of']);

/**
 * Deliberate claim editing (Unknown / Learning / Known / Clear override).
 * Compact pill row; the active claim is highlighted and Clear renders only
 * while an override exists.
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
 * One relation row: the human-facing label is primary, the relation phrase is
 * secondary, and raw ontology metadata (type · domain · confidence ·
 * provenance) appears only under the advanced details toggle. The row itself
 * navigates (recenter relations on that entity); opening the graph-inspector
 * window stays a secondary affordance via onOpen.
 */
const KnowledgeRelationRow: Component<{
  label: string;
  phrase?: string;
  meta?: string;
  entityId: string;
  onNavigate: (entityId: string) => void;
  onOpen?: (entityId: string) => void;
  openLabel: string;
  showMeta: boolean;
}> = (props) => (
  <li class="knowledge-relations__item">
    <button type="button" class="knowledge-relations__row" onClick={() => props.onNavigate(props.entityId)}>
      <strong>{props.label}</strong>
      <Show when={props.phrase}><span class="knowledge-relations__phrase">{props.phrase}</span></Show>
      <Show when={props.showMeta && props.meta}><small class="knowledge-relations__meta">{props.meta}</small></Show>
    </button>
    <Show when={props.onOpen}>
      <button type="button" class="knowledge-relations__open" title={props.openLabel} aria-label={props.openLabel} onClick={() => props.onOpen?.(props.entityId)}>↗</button>
    </Show>
  </li>
);

interface CapabilityCard {
  capability: CapabilityKind;
  labelKey: string;
  status: WordStatus;
  basis: KnowledgeBasisToken;
  claim?: WordStatus;
  untracked: boolean;
  state?: KnowledgeProjectionState;
  isSense: boolean;
}

interface RelationSection {
  key: string;
  title: string;
  items: { id: string; label: string; phrase?: string; meta?: string; relation?: GraphRelatedNode }[];
}

function relationMetadata(relation: GraphRelatedNode): string | undefined {
  return [relation.relationType, relation.domain, relation.confidence, relation.provenance].filter((value) => value !== undefined).join(' · ');
}

export const KnowledgeProjectionDrawer: Component<KnowledgeProjectionDrawerProps> = (props) => {
  const { t } = useLocalization();
  const model = () => props.model;
  const { settings } = useSettings();
  const { installLanguageData, getLanguageDataStatus } = useLanguage();
  const graph = useOptionalGraph();
  const [tab, setTab] = createSignal<InspectorTab>('overview');
  const [lookup, setLookup] = createSignal<GraphWordLookup | null>(null);
  const [neighborhood, setNeighborhood] = createSignal<{ center: { id: string; label?: string }; relations: GraphRelatedNode[] } | null>(null);
  const [lookupState, setLookupState] = createSignal<'idle' | 'loading' | 'ready' | 'missing'>('idle');
  const [relationsState, setRelationsState] = createSignal<'idle' | 'loading' | 'ready'>('idle');
  /** Relation navigation target; undefined = the word's own surface is the center. */
  const [focusedId, setFocusedId] = createSignal<string | undefined>();
  /** Capability whose claim controls are expanded (Adjust disclosure). */
  const [editing, setEditing] = createSignal<string | undefined>();
  /** Advanced ontology metadata toggle for the Relations tab. */
  const [showMeta, setShowMeta] = createSignal(false);

  createEffect(() => {
    if (props.open) setTab(props.initialTab ?? 'overview');
  });

  // Detailed inspector data loads only while the inspector is open — never on
  // hover, never per Word DB row.
  createEffect(() => {
    const surface = props.surface;
    if (!surface || !props.open) return;
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
  // targeted by relation navigation. Absence degrades honestly.
  createEffect(() => {
    if (!props.open || !graph.meta().ready) return;
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

  /** Re pierce: recenter drawer relations and the host graph view on one entity. */
  const navigateTo = (entityId: string) => {
    setFocusedId(entityId);
    props.onSelectEntity?.(entityId);
  };
  const exitFocus = () => setFocusedId(undefined);

  const labelFor = (entityId: string): string | undefined => {
    const nb = neighborhood();
    if (!nb) return undefined;
    if (nb.center.id === entityId) return nb.center.label;
    return nb.relations.find((relation) => relation.id === entityId)?.label;
  };

  const stateFor = (capability: CapabilityKind): KnowledgeProjectionState | undefined => (
    projectionStateForCapability(model().projection, capability)
  );

  /** Effective (status, basis, claim) for one capability, from the resolvers' reported fields only. */
  const effectiveFor = (capability: CapabilityKind): { status: WordStatus; basis: KnowledgeBasisToken; claim?: WordStatus; untracked: boolean } => {
    if (capability === 'sense-recognition') {
      const overall = model().overall;
      return { status: overall.status, basis: overall.basis, claim: model().wordClaim ?? undefined, untracked: isUntrackedKnowledge(overall.status, overall.basis) };
    }
    const access = (props.accessStates ?? []).find((entry) => entry.capability === capability);
    if (access) {
      const basis = access.basis ?? (access.claim ? 'claim' : 'unmeasured');
      return { status: access.status, basis, claim: access.claim, untracked: access.untracked ?? isUntrackedKnowledge(access.status, basis) };
    }
    const state = stateFor(capability);
    if (state) {
      const status: WordStatus = state.classification === 'known' || state.classification === 'learning' ? state.classification : 'unknown';
      return { status, basis: state.basis, untracked: isUntrackedKnowledge(status, state.basis) };
    }
    return { status: 'unknown', basis: 'unmeasured', untracked: true };
  };

  /** Overview cards: one readable row per applicable capability, sense first. */
  const capabilityCards = createMemo<CapabilityCard[]>(() => {
    const cards: CapabilityCard[] = [];
    const covered = new Set<CapabilityKind>();
    const card = (capability: CapabilityKind): CapabilityCard => {
      covered.add(capability);
      const effective = effectiveFor(capability);
      return {
        capability,
        labelKey: CAPABILITY_LABEL_KEYS[capability] ?? `mlearn.Knowledge.Capability.${capability}`,
        status: effective.status,
        basis: effective.basis,
        claim: effective.claim,
        untracked: effective.untracked,
        state: stateFor(capability),
        isSense: capability === 'sense-recognition',
      };
    };
    cards.push(card('sense-recognition'));
    for (const access of props.accessStates ?? []) cards.push(card(access.capability));
    // Projection-only capabilities (e.g. grammar targets, package extensions).
    for (const target of model().projection?.targets ?? []) {
      for (const state of target.states) {
        if (!covered.has(state.capability)) cards.push(card(state.capability));
      }
    }
    return cards;
  });

  const reading = createMemo(() => lookup()?.pronunciations[0]?.label);
  const canAdjust = () => props.onWordClaim !== undefined || props.onAccessClaim !== undefined;
  const claimControlsFor = (card: CapabilityCard) => {
    if (card.isSense) {
      if (!props.onWordClaim) return null;
      return <KnowledgeClaimControls claim={model().wordClaim} onClaim={props.onWordClaim} />;
    }
    if (!props.onAccessClaim) return null;
    return <KnowledgeClaimControls
      claim={card.claim}
      onClaim={(claim) => props.onAccessClaim?.(card.capability as RatedCapability, claim)}
    />;
  };

  /**
   * Relations display as human concepts. The graph never encodes sibling-form
   * kinship (殖える/増える share one dictionary entry) as identity: the builder
   * emits explicit `semantically-related` support edges between entry siblings,
   * and learner state never flows across them — support is prediction-only
   * context, never inherited knowledge.
   */
  const relationSections = createMemo<RelationSection[]>(() => {
    const nb = neighborhood();
    if (!nb) return [];
    const consumed = new Set<string>();
    const dedupe = (items: RelationSection['items']): RelationSection['items'] => {
      const seen = new Set<string>();
      return items.filter((item) => {
        const key = `${item.relation?.kind ?? ''}:${item.label}`;
        const idKey = item.id;
        if (seen.has(idKey) || seen.has(key)) return false;
        seen.add(idKey);
        seen.add(key);
        return true;
      });
    };
    const fromRelations = (types: ReadonlySet<GraphRelationType>) => dedupe(nb.relations
      .filter((relation) => types.has(relation.relationType))
      .map((relation) => {
        consumed.add(relation.id);
        return {
          id: relation.id,
          label: relation.label ?? relation.id,
          phrase: relationPhraseKey(relation.relationType),
          meta: relationMetadata(relation),
          relation,
        };
      }));
    const sections: RelationSection[] = [];
    const pronunciations = dedupe([
      ...nb.relations.filter((relation) => relation.relationType === 'has-pronunciation' || relation.relationType === 'has-reading')
        .map((relation) => {
          consumed.add(relation.id);
          return { id: relation.id, label: relation.label ?? relation.id, phrase: relationPhraseKey(relation.relationType), meta: relationMetadata(relation), relation };
        }),
      ...(lookup()?.pronunciations ?? []).map((node) => ({ id: node.id, label: node.label ?? node.id, relation: undefined as GraphRelatedNode | undefined })),
    ]);
    if (pronunciations.length > 0) sections.push({ key: 'pronunciations', title: t('mlearn.Knowledge.Projection.Identity.Sections.Pronunciations'), items: pronunciations });

    const senses = dedupe([
      ...fromRelations(new Set<GraphRelationType>(['has-sense'])),
      ...(lookup()?.senses ?? []).map((node) => ({ id: node.id, label: node.label ?? '', relation: undefined as GraphRelatedNode | undefined })),
    ]);
    if (senses.length > 0) {
      sections.push({
        key: 'meanings',
        title: t('mlearn.Knowledge.Projection.Relations.Sections.Meanings'),
        items: senses.map((item, index) => ({ ...item, label: item.label || t('mlearn.Knowledge.Projection.Relations.MeaningN', { n: String(index + 1) }) })),
      });
    }

    const forms = dedupe([
      ...fromRelations(new Set<GraphRelationType>(['realizes', 'inflection-of', 'lemma-of', 'orthographic-variant-of'])),
      ...(lookup()?.entries ?? []).map((node) => ({ id: node.id, label: node.label ?? node.id, relation: undefined as GraphRelatedNode | undefined })),
      ...(lookup()?.lexemes ?? []).map((node) => ({ id: node.id, label: node.label ?? node.id, relation: undefined as GraphRelatedNode | undefined })),
    ]);
    if (forms.length > 0) sections.push({ key: 'forms', title: t('mlearn.Knowledge.Projection.Relations.Sections.Forms'), items: forms });

    const components = fromRelations(CHARACTER_RELATIONS);
    if (components.length > 0) sections.push({ key: 'components', title: t('mlearn.Knowledge.Projection.Identity.Sections.Characters'), items: components });

    const morphology = fromRelations(MORPHOLOGY_RELATIONS);
    if (morphology.length > 0) sections.push({ key: 'morphology', title: t('mlearn.Knowledge.Projection.Identity.Sections.Morphology'), items: morphology });

    // Everything else: semantically-related support, contrasts, derived forms,
    // and package-extension relations with no core category. Grouped as
    // "Related" — connection, never knowledge.
    const related = dedupe(nb.relations
      .filter((relation) => !consumed.has(relation.id))
      .map((relation) => ({
        id: relation.id,
        label: relation.label ?? relation.id,
        phrase: relationPhraseKey(relation.relationType),
        meta: relationMetadata(relation),
        relation,
      })));
    if (related.length > 0) sections.push({ key: 'related', title: t('mlearn.Knowledge.Projection.Relations.Sections.Related'), items: related });
    return sections;
  });

  const grammarTargets = createMemo(() => (model().projection?.targets ?? []).filter((target) => target.targetRef.kind === 'grammar-pattern'));

  /** Journal rows for the timeline: retractions and retracted events applied away. */
  const journalEvents = createMemo<HistoryEvent[]>(() => {
    const events = model().events;
    return events ? readActiveEvidence(events).filter(
      (event): event is HistoryEvent => event.kind !== 'retraction',
    ) : [];
  });

  const predictedStates = createMemo(() => (model().projection?.targets.flatMap((target) => target.states) ?? []).filter((state) => state.basis === 'prediction' && state.prediction !== undefined));

  // Install can only ever fix what the published package actually contains.
  // If the catalog bundle for this language ships no graph asset, the button
  // would be a dead action — show the not-published note instead.
  const canInstall = () => {
    const status = graph.meta().status;
    if (status !== 'not-installed' && status !== 'unavailable') return false;
    const catalog = getLanguageDataStatus(settings.language);
    return catalog?.assets.some((asset) => asset.path.endsWith('.graph.json')) ?? false;
  };

  const overall = () => model().overall;
  const overallUntracked = () => isUntrackedKnowledge(overall().status, overall().basis);
  const overallLabelKey = () => (
    overallUntracked() ? UNTRACKED_LABEL_KEY : statusLabelKey(overall().status)
  );
  const overallTone = () => (overallUntracked() ? 'unmeasured' : overall().basis);

  /** Prediction support paths arrive as "fromId → toId (relationType)". Resolve
   * ids against the neighborhood so the UI shows words, not dense entity ids;
   * paths the drawer cannot resolve are omitted (the count narrative already
   * states how many support paths exist). */
  const predictionReasonLines = (reasons: readonly string[]): string[] => {
    const lines: string[] = [];
    for (const reason of reasons) {
      const match = /^(.+?) → (.+?) \((.+)\)$/.exec(reason);
      if (!match) continue;
      const from = labelFor(match[1]);
      const to = labelFor(match[2]);
      if (from === undefined || to === undefined) continue;
      const via = relationPhraseKey(match[3]);
      lines.push(via ? `${from} → ${to} · ${t(via)}` : `${from} → ${to}`);
    }
    return lines;
  };

  return <Modal
    isOpen={props.open}
    onClose={props.onClose}
    title={t('mlearn.Knowledge.Projection.Details')}
    size="lg"
    panelClass="knowledge-drawer-modal"
  >
    <div class="knowledge-drawer">
      <header class="knowledge-drawer__header">
        <div class="knowledge-drawer__word">
          <span class="knowledge-drawer__surface">{props.surface}</span>
          <Show when={reading()}><span class="knowledge-drawer__reading">{reading()}</span></Show>
        </div>
        <div class={`knowledge-drawer__overall knowledge-state--${overallTone()}`}>
          <span class="knowledge-drawer__overall-status">{t(overallLabelKey())}</span>
          <span class="knowledge-drawer__overall-basis">{t(BASIS_LABEL_KEYS[overall().basis])}</span>
        </div>
        <Show when={model().excluded}>
          <span class="knowledge-drawer__excluded">{t('mlearn.Knowledge.Projection.Excluded')}</span>
        </Show>
      </header>

      <TabContainer
        tabs={INSPECTOR_TABS.map(({ key, label }) => ({ id: key, label: t(label) }))}
        activeTab={tab()}
        onTabChange={(id) => setTab(id as InspectorTab)}
        variant="segment"
      >
        <Show when={tab() === 'overview'}>
          <div class="knowledge-overview">
            <section class={`knowledge-card knowledge-card--overall knowledge-state--${overallTone()}`}>
              <div class="knowledge-card__main">
                <h3 class="knowledge-card__title">{t('mlearn.Knowledge.Popup.Overall')}</h3>
                <p class="knowledge-card__state">
                  <strong>{t(overallLabelKey())}</strong>
                  <span> · {t(BASIS_LABEL_KEYS[overall().basis])}</span>
                </p>
                <Show when={overall().timesSeen > 0}>
                  <p class="knowledge-card__why">{t('mlearn.WordHover.TimesSeen', { count: String(overall().timesSeen) })}</p>
                </Show>
              </div>
              <Show when={canAdjust()}>
                <div class="knowledge-card__actions">
                  <Show when={editing() === 'overall'} fallback={
                    <Show when={props.onWordClaim}>
                      <PillBtn size="sm" variant="gray" label={t('mlearn.Knowledge.Projection.Adjust')} onClick={() => setEditing('overall')} />
                    </Show>
                  }>
                    <KnowledgeClaimControls claim={model().wordClaim} onClaim={(claim) => { props.onWordClaim?.(claim); }} />
                    <button type="button" class="knowledge-card__done" onClick={() => setEditing(undefined)}>{t('mlearn.Global.Close')}</button>
                  </Show>
                </div>
              </Show>
            </section>

            <Show when={capabilityCards().length > 0}>
              <div class="knowledge-overview__cards">
                <For each={capabilityCards()}>{(card) => {
                  // Without a projection state (graph absent), the sense card
                  // still explains itself: claims stay claims, and the
                  // comprehensive resolver's exposure count stays familiarity
                  // (Why.Passive) — never upgraded to evidence.
                  const why = () => {
                    if (card.state) return knowledgeWhyNarrative(card.state);
                    if (card.claim) return { key: 'mlearn.Knowledge.Projection.Why.Claim' };
                    if (overall().timesSeen > 0) return { key: 'mlearn.Knowledge.Projection.Why.Passive', params: { count: String(overall().timesSeen) } };
                    return { key: 'mlearn.Knowledge.Projection.Why.Unmeasured' };
                  };
                  return (
                    <section class={`knowledge-card knowledge-card--${card.basis}`}>
                      <div class="knowledge-card__main">
                        <h3 class="knowledge-card__title">{t(card.labelKey)}</h3>
                        <p class="knowledge-card__state">
                          <strong>{t(knowledgeStatusLabelKey(card.status, card.basis, card.untracked))}</strong>
                          <span> · {t(BASIS_LABEL_KEYS[card.basis])}</span>
                        </p>
                        <p class="knowledge-card__why">{t(why().key, why().params)}</p>
                        <Show when={card.basis === 'claim' && (card.state?.evidence.length ?? 0) > 0}>
                          <p class="knowledge-card__override">{t('mlearn.Knowledge.Projection.ClaimOverride')}</p>
                        </Show>
                        <Show when={card.state?.retention}>
                          <p class="knowledge-card__retention">{t('mlearn.Knowledge.Projection.Retention', {
                            pressure: card.state!.retention!.pressure.toFixed(2),
                            due: new Date(card.state!.retention!.dueAt).toLocaleDateString(),
                          })}</p>
                        </Show>
                      </div>
                      <Show when={canAdjust()}>
                        <div class="knowledge-card__actions">
                          <Show when={editing() === card.capability} fallback={
                            <PillBtn size="sm" variant="gray" label={t('mlearn.Knowledge.Projection.Adjust')} onClick={() => setEditing(card.capability)} />
                          }>
                            {claimControlsFor(card)}
                            <button type="button" class="knowledge-card__done" onClick={() => setEditing(undefined)}>{t('mlearn.Global.Close')}</button>
                          </Show>
                        </div>
                      </Show>
                    </section>
                  );
                }}</For>
              </div>
            </Show>
          </div>
        </Show>

        <Show when={tab() === 'relations'}>
          <div class="knowledge-relations">
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
                  <Show when={relationsState() !== 'idle'}>
                    <Show when={focusedId()}>
                      {(id) => <div class="knowledge-drawer__focus">
                        <span>{t('mlearn.Knowledge.Projection.Identity.Viewing', { label: labelFor(id()) ?? id() })}</span>
                        <button type="button" class="knowledge-drawer__focus-close" onClick={exitFocus} aria-label={t('mlearn.Knowledge.Projection.Identity.BackToWord', { word: props.surface })}>×</button>
                      </div>}
                    </Show>
                    <Show when={relationsState() === 'loading'}>
                      <SkeletonRows rows={2} />
                    </Show>
                    <Show when={relationsState() === 'ready'}>
                      <Show when={neighborhood()} fallback={
                        <Show when={focusedId()}>
                          <div class="knowledge-drawer__degraded">
                            <p>{t('mlearn.Knowledge.Projection.Identity.NotInGraph')}</p>
                            <button type="button" class="knowledge-drawer__install" onClick={exitFocus}>{t('mlearn.Knowledge.Projection.Identity.BackToWord', { word: props.surface })}</button>
                          </div>
                        </Show>
                      }>
                        <For each={relationSections()}>{(section) => (
                          <section class={`knowledge-relations__section knowledge-relations__section--${section.key}`}>
                            <h3>{section.title}</h3>
                            <ul class="knowledge-relations__list">
                              <For each={section.items}>{(item) => <KnowledgeRelationRow
                                label={item.label}
                                phrase={item.phrase ? t(item.phrase) : undefined}
                                meta={item.meta}
                                entityId={item.id}
                                onNavigate={navigateTo}
                                onOpen={props.onGraph}
                                openLabel={t('mlearn.GraphInspector.Neighborhood.OpenInWindow')}
                                showMeta={showMeta()}
                              />}</For>
                            </ul>
                          </section>
                        )}</For>
                        <Show when={grammarTargets().length > 0}>
                          <section class="knowledge-relations__section knowledge-relations__section--grammar">
                            <h3>{t('mlearn.Knowledge.Projection.Identity.Sections.Grammar')}</h3>
                            <ul class="knowledge-relations__list">
                              <For each={grammarTargets()}>{(target) => <KnowledgeRelationRow
                                entityId={target.targetRef.id}
                                label={labelFor(target.targetRef.id) ?? t('mlearn.Knowledge.Projection.Relations.GrammarPattern')}
                                onNavigate={navigateTo}
                                onOpen={props.onGraph}
                                openLabel={t('mlearn.GraphInspector.Neighborhood.OpenInWindow')}
                                showMeta={false}
                              />}</For>
                            </ul>
                          </section>
                        </Show>
                        <div class="knowledge-relations__footer">
                          <button type="button" class="knowledge-relations__meta-toggle" aria-pressed={showMeta()} onClick={() => setShowMeta(!showMeta())}>
                            {t('mlearn.Knowledge.Projection.Relations.Advanced')}
                          </button>
                          <Show when={props.onGraph}>
                            <button type="button" class="knowledge-relations__graph" onClick={() => props.onGraph?.(focusedId() ?? neighborhood()!.center.id)}>{t('mlearn.Knowledge.Projection.FullGraph')}</button>
                          </Show>
                        </div>
                      </Show>
                    </Show>
                  </Show>
                }>
                  <p class="knowledge-drawer__degraded">{t('mlearn.Knowledge.Projection.Identity.NoGraph')}</p>
                </Show>
              </Show>
            </Show>
          </div>
        </Show>

        <Show when={tab() === 'history'}>
          <div class="knowledge-history">
            <Show when={journalEvents().length > 0} fallback={<p class="knowledge-drawer__empty">{t('mlearn.Knowledge.History.Empty')}</p>}>
              <KnowledgeHistoryTimeline events={journalEvents()} />
            </Show>
            <Show when={(model().projection?.targets.flatMap((target) => target.states) ?? []).some((state) => state.retention)}>
              <section class="knowledge-history__retention">
                <h3>{t('mlearn.Knowledge.Projection.RetentionTitle')}</h3>
                <ul>
                  <For each={(model().projection?.targets.flatMap((target) => target.states) ?? []).filter((state) => state.retention)}>{(state) => (
                    <li>
                      <span>{t(CAPABILITY_LABEL_KEYS[state.capability] ?? `mlearn.Knowledge.Capability.${state.capability}`)}</span>
                      {t('mlearn.Knowledge.Projection.Retention', {
                        pressure: state.retention!.pressure.toFixed(2),
                        due: new Date(state.retention!.dueAt).toLocaleDateString(),
                      })}
                    </li>
                  )}</For>
                </ul>
              </section>
            </Show>
          </div>
        </Show>

        <Show when={tab() === 'prediction'}>
          <div class="knowledge-prediction">
            <p class="knowledge-prediction__caption">{t('mlearn.GraphInspector.PredictionFirewall')}</p>
            <Show when={predictedStates().length > 0} fallback={<p class="knowledge-drawer__empty">{t('mlearn.Knowledge.Projection.Prediction.None')}</p>}>
              <For each={predictedStates()}>{(state) => (
                <section class="knowledge-prediction__card">
                  <h3>{t(CAPABILITY_LABEL_KEYS[state.capability] ?? `mlearn.Knowledge.Capability.${state.capability}`)}</h3>
                  <p class="knowledge-prediction__value">
                    <strong>{t('mlearn.Knowledge.Projection.Predicted')} · {Math.round(state.prediction!.value * 100)}%</strong>
                  </p>
                  <p class="knowledge-prediction__why">{t(knowledgeWhyNarrative(state).key, knowledgeWhyNarrative(state).params)}</p>
                  <Show when={predictionReasonLines(state.prediction!.reasons).length > 0}>
                    <ul class="knowledge-prediction__reasons">
                      <For each={predictionReasonLines(state.prediction!.reasons)}>{(line) => <li>{line}</li>}</For>
                    </ul>
                  </Show>
                </section>
              )}</For>
            </Show>
          </div>
        </Show>
      </TabContainer>
    </div>
  </Modal>;
};
