import { Component, For, Show, createMemo, createSignal } from 'solid-js';
import type { AttemptQuality, KnowledgeSource, WordStatus } from '../../../../shared/constants';
import { KNOWLEDGE_ASPECT_LABEL_KEYS, KNOWLEDGE_SOURCE_DISPLAY_NAMES } from '../../../../shared/constants';
import { CAPABILITY_LABEL_KEYS } from '../../../../shared/graph/access';
import type { EvidenceAspect, EvidenceSource, KnowledgeEvent, KnowledgeEventKind } from '../../../../shared/knowledgeEvents';
import { eventCapability } from '../../../../shared/knowledgeEvents';
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

interface AggregateRow {
  /** Aggregation key: identical rows within a day collapse into one summary. */
  key: string;
  kind: HistoryEvent['kind'];
  source: string;
  detail: string;
  events: HistoryEvent[];
}

interface DayGroup {
  key: string;
  rows: AggregateRow[];
}

/**
 * Day-grouped knowledge history with repetitive rows aggregated: "Today ·
 * Claim ×2 · Meaning → Known" instead of one raw event per line. Expanding a
 * summary reveals the individual events with their times. Claims stay
 * visually distinct from measured evidence.
 */
export const KnowledgeHistoryTimeline: Component<{ events: readonly HistoryEvent[] }> = (props) => {
  const { t } = useLocalization();
  const [expanded, setExpanded] = createSignal(new Set<string>());

  /** Legacy events keep their aspect label; capability-addressed events label via their access. */
  const eventLabel = (event: HistoryEvent): string | undefined => {
    if (event.aspect !== undefined) return t(aspectLabelKey(event.aspect));
    const capability = eventCapability(event);
    return capability === undefined ? undefined : t(CAPABILITY_LABEL_KEYS[capability] ?? capability);
  };

  const withLabel = (label: string | undefined, rest: string): string => (label === undefined ? rest : `${label} ${rest}`);

  const detail = (event: HistoryEvent): string => {
    const aspect = eventLabel(event);
    const statusKey = (status: WordStatus): string => `mlearn.WordHover.Status.${STATUS_KEYS[status]}`;
    if (event.kind === 'claim') {
      if (event.toStatus) return withLabel(aspect, `→ ${t(statusKey(event.toStatus))}`);
      return t('mlearn.Knowledge.Projection.Evidence.ClaimCleared');
    }
    if (event.kind === 'status' && event.source === 'anki') {
      return event.toStatus ? withLabel(aspect, `· ${t(statusKey(event.toStatus))}`) : aspect ?? '';
    }
    if (event.kind === 'rating' || event.kind === 'review') {
      if (event.quality) return withLabel(aspect, `· ${t(QUALITY_LABEL_KEYS[event.quality])}`);
      if (event.rating) return withLabel(aspect, `· ${event.rating}`);
    }
    if (event.fromStatus && event.toStatus) {
      const transition = `${t(statusKey(event.fromStatus))} → ${t(statusKey(event.toStatus))}`;
      return aspect === undefined ? transition : `${aspect}: ${transition}`;
    }
    if (event.quality) return withLabel(aspect, `· ${t(QUALITY_LABEL_KEYS[event.quality])}`);
    if (event.rating) return withLabel(aspect, `· ${event.rating}`);
    if (event.toStatus) return withLabel(aspect, `→ ${t(statusKey(event.toStatus))}`);
    return aspect ?? '';
  };

  const dayLabel = (key: string): string => {
    const today = new Date();
    const day = new Date(key);
    const dayStart = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
    const diffDays = Math.round((dayStart(today) - dayStart(day)) / DAY_MS);
    if (diffDays <= 0) return t('mlearn.Knowledge.History.Today');
    if (diffDays === 1) return t('mlearn.Knowledge.History.Yesterday');
    return day.toLocaleDateString();
  };

  const dayGroups = createMemo<DayGroup[]>(() => {
    const days = new Map<string, Map<string, AggregateRow>>();
    for (const event of [...props.events].sort((a, b) => b.t - a.t)) {
      const day = new Date(event.t);
      const dayKey = day.toDateString();
      let rows = days.get(dayKey);
      if (!rows) {
        rows = new Map();
        days.set(dayKey, rows);
      }
      const key = [event.kind, event.source, detail(event)].join('|');
      let row = rows.get(key);
      if (!row) {
        row = { key: `${dayKey}:${key}`, kind: event.kind, source: event.source, detail: detail(event), events: [] };
        rows.set(key, row);
      }
      row.events.push(event);
    }
    return [...days.entries()].map(([key, rows]) => ({ key, rows: [...rows.values()] }));
  });

  const toggle = (key: string) => {
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const time = (t: number): string => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  return (
    <Show when={props.events.length > 0}>
      <div class="knowledge-timeline">
        <For each={dayGroups()}>{(day) => (
          <section class="knowledge-timeline__day">
            <h4 class="knowledge-timeline__day-label">{dayLabel(day.key)}</h4>
            <For each={day.rows}>{(row) => (
              <div class={`knowledge-timeline__entry knowledge-timeline__entry--${row.kind}`}>
                <Show
                  when={row.events.length > 1}
                  fallback={
                    <div class="knowledge-timeline__event">
                      <span class="knowledge-timeline__mark" aria-hidden="true" />
                      <span class="knowledge-timeline__kind">{t(row.kind === 'status' && row.source === 'anki' ? 'mlearn.Knowledge.History.Kind.SourceSnapshot' : KIND_LABEL_KEYS[row.kind])}</span>
                      <span class="knowledge-timeline__detail">{row.detail}</span>
                      <small class="knowledge-timeline__source">{t(sourceLabelKey(row.events[0].source as EvidenceSource))}</small>
                    </div>
                  }
                >
                  <button type="button" class="knowledge-timeline__summary" aria-expanded={expanded().has(row.key)} onClick={() => toggle(row.key)}>
                    <span class="knowledge-timeline__mark" aria-hidden="true" />
                    <span class="knowledge-timeline__kind">{t(row.kind === 'status' && row.source === 'anki' ? 'mlearn.Knowledge.History.Kind.SourceSnapshot' : KIND_LABEL_KEYS[row.kind])}</span>
                    <span class="knowledge-timeline__count">{t('mlearn.Knowledge.History.Times', { count: String(row.events.length) })}</span>
                    <span class="knowledge-timeline__detail">{row.detail}</span>
                    <small class="knowledge-timeline__source">{t(sourceLabelKey(row.events[0].source as EvidenceSource))}</small>
                  </button>
                  <Show when={expanded().has(row.key)}>
                    <ul class="knowledge-timeline__events">
                      <For each={row.events}>{(event) => (
                        <li class="knowledge-timeline__event">
                          <span class="knowledge-timeline__time">{time(event.t)}</span>
                          <span class="knowledge-timeline__detail">{detail(event)}</span>
                        </li>
                      )}</For>
                    </ul>
                  </Show>
                </Show>
              </div>
            )}</For>
          </section>
        )}</For>
      </div>
    </Show>
  );
};
