import { Component, For, Show, createMemo } from 'solid-js';
import type { AttemptQuality, KnowledgeSource, WordStatus } from '../../../../shared/constants';
import { KNOWLEDGE_ASPECT_LABEL_KEYS, KNOWLEDGE_SOURCE_DISPLAY_NAMES } from '../../../../shared/constants';
import type { EvidenceAspect, EvidenceSource, KnowledgeEvent, KnowledgeEventKind } from '../../../../shared/knowledgeEvents';
import { useLocalization } from '../../../context';
import './KnowledgeHistoryTimeline.css';

/** The canonical journal read path already strips retractions; assert that at the type level. */
export type HistoryEvent = KnowledgeEvent & { kind: Exclude<KnowledgeEventKind, 'retraction'> };

const KIND_LABEL_KEYS: Record<Exclude<KnowledgeEventKind, 'retraction'>, string> = {
  status: 'mlearn.Knowledge.History.Kind.Status',
  review: 'mlearn.Knowledge.History.Kind.Review',
  rating: 'mlearn.Knowledge.History.Kind.Rating',
  rollup: 'mlearn.Knowledge.History.Kind.Rollup',
  claim: 'mlearn.Knowledge.History.Kind.Claim',
};

const STATUS_KEYS: Record<WordStatus, string> = {
  unknown: 'Unknown',
  learning: 'Learning',
  known: 'Known',
};

const QUALITY_LABEL_KEYS: Record<AttemptQuality, string> = {
  missed: 'mlearn.Rating.Matrix.Missed',
  struggled: 'mlearn.Rating.Matrix.Struggled',
  fluent: 'mlearn.Rating.Matrix.Fluent',
};

const GRAMMAR_ASPECT_LABEL_KEY = 'mlearn.Knowledge.Aspect.Grammar';

const aspectLabelKey = (aspect: EvidenceAspect): string => (
  aspect === 'grammar' ? GRAMMAR_ASPECT_LABEL_KEY : KNOWLEDGE_ASPECT_LABEL_KEYS[aspect]
);

const sourceLabelKey = (source: EvidenceSource): string => (
  `mlearn.Knowledge.History.Source.${KNOWLEDGE_SOURCE_DISPLAY_NAMES[source as KnowledgeSource]}`
);

const DAY_MS = 24 * 60 * 60 * 1000;

interface DayGroup {
  key: string;
  events: HistoryEvent[];
}

/**
 * Event-first knowledge history: day-grouped rows ("Today · ● Manual claim ·
 * Meaning → Learning"), newest first. The strength chart is a separate
 * component — callers gate it through isChartableHistory().
 */
export const KnowledgeHistoryTimeline: Component<{ events: readonly HistoryEvent[] }> = (props) => {
  const { t } = useLocalization();

  const dayGroups = createMemo<DayGroup[]>(() => {
    const groups = new Map<string, DayGroup>();
    for (const event of [...props.events].sort((a, b) => b.t - a.t)) {
      const day = new Date(event.t);
      const key = day.toDateString();
      let group = groups.get(key);
      if (!group) {
        group = { key, events: [] };
        groups.set(key, group);
      }
      group.events.push(event);
    }
    return [...groups.values()];
  });

  const dayLabel = (key: string): string => {
    const today = new Date();
    const day = new Date(key);
    const dayStart = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
    const diffDays = Math.round((dayStart(today) - dayStart(day)) / DAY_MS);
    if (diffDays <= 0) return t('mlearn.Knowledge.History.Today');
    if (diffDays === 1) return t('mlearn.Knowledge.History.Yesterday');
    return day.toLocaleDateString();
  };

  const detail = (event: HistoryEvent): string => {
    const aspect = t(aspectLabelKey(event.aspect));
    if (event.kind === 'claim') {
      if (event.toStatus) return `${aspect} → ${t(`mlearn.WordHover.Status.${STATUS_KEYS[event.toStatus]}`)}`;
      return t('mlearn.Knowledge.Projection.Evidence.ClaimCleared');
    }
    if (event.fromStatus && event.toStatus) {
      return `${aspect}: ${t(`mlearn.WordHover.Status.${STATUS_KEYS[event.fromStatus]}`)} → ${t(`mlearn.WordHover.Status.${STATUS_KEYS[event.toStatus]}`)}`;
    }
    if (event.quality) return `${aspect} · ${t(QUALITY_LABEL_KEYS[event.quality])}`;
    if (event.rating) return `${aspect} · ${event.rating}`;
    if (event.toStatus) return `${aspect} → ${t(`mlearn.WordHover.Status.${STATUS_KEYS[event.toStatus]}`)}`;
    return aspect;
  };

  return (
    <Show when={props.events.length > 0}>
      <div class="knowledge-timeline">
        <For each={dayGroups()}>{(group) => (
          <section class="knowledge-timeline__day">
            <h4 class="knowledge-timeline__day-label">{dayLabel(group.key)}</h4>
            <For each={group.events}>{(event) => (
              <div class={`knowledge-timeline__event knowledge-timeline__event--${event.kind}`}>
                <span class="knowledge-timeline__mark" aria-hidden="true" />
                <span class="knowledge-timeline__kind">{t(KIND_LABEL_KEYS[event.kind])}</span>
                <span class="knowledge-timeline__detail">{detail(event)}</span>
                <small class="knowledge-timeline__source">{t(sourceLabelKey(event.source))}</small>
              </div>
            )}</For>
          </section>
        )}</For>
      </div>
    </Show>
  );
};
