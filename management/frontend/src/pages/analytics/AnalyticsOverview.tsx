import { useMemo, useState } from 'react';
import { ConsoleSwitch } from '../../components/console';
import { HistoricalChart } from '../../components/charts/HistoricalChart';
import { StackedActivityChart } from '../../components/charts/StackedActivityChart';
import type { ChartSeries } from '../../components/charts/chartTypes';
import type { AnalyticsSummary, ComparisonMode, HistoricalSeries, LlmAnalytics, PolicyBlockAnalytics } from '../../api/types';
import { AnalyticsHistoryTable } from './AnalyticsHistoryTable';
import { MetricCard } from '../../components/MetricCard';

interface AnalyticsOverviewProps {
  summary: AnalyticsSummary | null;
  history: HistoricalSeries | null;
  comparison: ComparisonMode;
  activityError: string | null;
  llm: LlmAnalytics | null;
  llmError: string | null;
  blocks: PolicyBlockAnalytics | null;
  policyError: string | null;
}

const activityDefinitions: ReadonlyArray<{ key: keyof AnalyticsSummary; label: string; transform?: (value: number) => number }> = [
  { key: 'readerPages', label: 'Reader pages recorded' },
  { key: 'watchSeconds', label: 'Video minutes recorded', transform: (value: number) => value / 60 },
  { key: 'flashcardEvents', label: 'Flashcard sessions' },
] as const;

export function AnalyticsOverview({ summary, history, comparison, activityError, llm, llmError, blocks, policyError }: AnalyticsOverviewProps) {
  const [visible, setVisible] = useState<Set<string>>(() => new Set(activityDefinitions.map((item) => item.key)));
  const activitySeries = useMemo(() => history === null ? [] : activityDefinitions.flatMap((definition) => {
    if (!visible.has(definition.key)) return [];
    return [toSeries(history, definition.key, definition.label, 'primary', undefined, definition.transform), ...(history.comparison === null ? [] : [toSeries(history, definition.key, definition.label, 'comparison', comparisonLabel(comparison), definition.transform)])];
  }), [comparison, history, visible]);
  const learningSeries = useMemo(() => history === null ? [] : [
    toSeries(history, 'sessions', 'Sessions recorded', 'primary'),
    toSeries(history, 'completions', 'Completions recorded', 'primary'),
    ...(history.comparison === null ? [] : [toSeries(history, 'sessions', 'Sessions recorded', 'comparison', comparisonLabel(comparison)), toSeries(history, 'completions', 'Completions recorded', 'comparison', comparisonLabel(comparison))]),
  ], [comparison, history]);

  return <div className="analytics-overview">
    <section className="analytics-panel" aria-labelledby="activity-history-heading">
      <div className="analytics-panel__heading"><div><h2 id="activity-history-heading">Activity history</h2><p>Recorded reader, video, and flashcard activity for the selected range.</p></div></div>
      <div className="metric-grid analytics-summary-metric"><MetricCard label="Active learners" value={summary?.activeLearners ?? '—'} /></div>
      <fieldset className="analytics-series-controls"><legend>Visible activity series</legend>{activityDefinitions.map((definition) => <ConsoleSwitch key={definition.key} label={definition.label} isSelected={visible.has(definition.key)} onChange={(selected) => setVisible((current) => {
        const next = new Set(current);
        if (selected) next.add(definition.key); else next.delete(definition.key);
        return next;
      })} />)}</fieldset>
      {activityError ? <PanelError title="Activity history" message={activityError} /> : history === null ? <PanelLoading title="Activity history" /> : activitySeries.length === 0 ? <p role="status">Select an activity series to display recorded values.</p> : <><StackedActivityChart title="Activity" series={activitySeries} /><AnalyticsHistoryTable title="Activity history" series={activitySeries} /></>}
    </section>
    <section className="analytics-panel" aria-labelledby="learning-history-heading">
      <div className="analytics-panel__heading"><div><h2 id="learning-history-heading">Recorded sessions</h2><p>Sessions and completions recorded in the selected range.</p></div></div>
      {activityError ? <PanelError title="Recorded sessions" message={activityError} /> : history === null ? <PanelLoading title="Recorded sessions" /> : <HistoricalChart title="Recorded sessions" series={learningSeries} />}
    </section>
    <section className="analytics-panel" aria-labelledby="llm-usage-heading">
      <div className="analytics-panel__heading"><div><h2 id="llm-usage-heading">LLM usage</h2><p>Provider requests and recorded token totals for the selected range.</p></div></div>
      {llmError ? <PanelError title="LLM usage" message={llmError} /> : llm === null ? <PanelLoading title="LLM usage" /> : <div className="metric-grid"><MetricCard label="Requests" value={llm.requests} /><MetricCard label="Input tokens" value={llm.inputTokens.toLocaleString()} /><MetricCard label="Output tokens" value={llm.outputTokens.toLocaleString()} /><MetricCard label="Cost" value={(llm.costMicros / 1_000_000).toFixed(4)} /></div>}
    </section>
    <section className="analytics-panel" aria-labelledby="policy-blocks-heading">
      <div className="analytics-panel__heading"><div><h2 id="policy-blocks-heading">Policy blocks</h2><p>Requests blocked before provider execution in the selected range.</p></div></div>
      {policyError ? <PanelError title="Policy blocks" message={policyError} /> : blocks === null ? <PanelLoading title="Policy blocks" /> : <div className="metric-grid"><MetricCard label="Blocked requests" value={blocks.blocks} detail="Requests rejected before provider execution" /></div>}
    </section>
  </div>;
}

function toSeries(history: HistoricalSeries, key: keyof NonNullable<HistoricalSeries['primary'][number]['values']>, label: string, kind: ChartSeries['kind'], comparisonLabel?: string, transform: (value: number) => number = (value) => value): ChartSeries {
  const buckets = kind === 'primary' ? history.primary : history.comparison ?? [];
  return { key, label, kind, comparisonLabel, values: buckets.map((bucket) => ({ start: bucket.start, end: bucket.end, coverage: bucket.coverage, value: bucket.values === null ? null : transform(bucket.values[key]) })) };
}

function comparisonLabel(mode: ComparisonMode): string | undefined {
  if (mode === 'previousYear') return 'Previous year';
  if (mode === 'previousPeriod') return 'Previous period';
  return undefined;
}

function PanelLoading({ title }: { title: string }) {
  return <p role="status">Loading {title.toLowerCase()}.</p>;
}

function PanelError({ title, message }: { title: string; message: string }) {
  return <p role="alert">Unable to load {title.toLowerCase()}. {message}</p>;
}
