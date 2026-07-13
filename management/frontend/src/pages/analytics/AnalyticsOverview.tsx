import { useMemo } from 'react';
import { ConsoleSwitch } from '../../components/console';
import { HistoricalChart } from '../../components/charts/HistoricalChart';
import { StackedActivityChart } from '../../components/charts/StackedActivityChart';
import type { ChartSeries } from '../../components/charts/chartTypes';
import type { AnalyticsMetric, AnalyticsSummary, ComparisonMode, HistoricalSeries, LlmAnalytics, PolicyBlockAnalytics } from '../../api/types';
import { AnalyticsHistoryTable } from './AnalyticsHistoryTable';
import { MetricCard } from '../../components/MetricCard';

interface AnalyticsOverviewProps {
  summary: AnalyticsSummary | null;
  history: HistoricalSeries | null;
  comparison: ComparisonMode;
  visibleMetrics: AnalyticsMetric[];
  onVisibleMetricsChange(metrics: AnalyticsMetric[]): void;
  activityError: string | null;
  llm: LlmAnalytics | null;
  llmError: string | null;
  blocks: PolicyBlockAnalytics | null;
  policyError: string | null;
  onBucketClick(start: number, end: number): void;
}

const activityDefinitions: ReadonlyArray<{ key: AnalyticsMetric; label: string; transform?: (value: number) => number }> = [
  { key: 'readerPages', label: 'Reader pages recorded' },
  { key: 'watchSeconds', label: 'Video minutes recorded', transform: (value: number) => value / 60 },
  { key: 'flashcardEvents', label: 'Flashcard sessions' },
] as const;

export function AnalyticsOverview({ summary, history, comparison, visibleMetrics, onVisibleMetricsChange, activityError, llm, llmError, blocks, policyError, onBucketClick }: AnalyticsOverviewProps) {
  const visible = useMemo(() => new Set(visibleMetrics), [visibleMetrics]);
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
      <div className="metric-grid analytics-summary-metric"><MetricCard label="Active learners" value={aggregateValue(summary, summary?.activeLearners)} detail={summary?.coverage && summary.coverage !== 'complete' ? `Coverage: ${summary.coverage}` : undefined} /></div>
      <fieldset className="analytics-series-controls"><legend>Visible activity series</legend>{activityDefinitions.map((definition) => <ConsoleSwitch key={definition.key} label={definition.label} isSelected={visible.has(definition.key)} onChange={(selected) => onVisibleMetricsChange(selected ? [...visibleMetrics, definition.key] : visibleMetrics.filter((metric) => metric !== definition.key))} />)}</fieldset>
      {activityError ? <PanelError title="Activity history" message={activityError} /> : history === null ? <PanelLoading title="Activity history" /> : activitySeries.length === 0 ? <p role="status">Select an activity series to display recorded values.</p> : <><StackedActivityChart title="Activity" series={activitySeries} onBucketClick={onBucketClick} timezone={history.timezone} /><AnalyticsHistoryTable title="Activity history" series={activitySeries} timezone={history.timezone} /></>}
    </section>
    <section className="analytics-panel" aria-labelledby="learning-history-heading">
      <div className="analytics-panel__heading"><div><h2 id="learning-history-heading">Recorded sessions</h2><p>Sessions and completions recorded in the selected range.</p></div></div>
      {activityError ? <PanelError title="Recorded sessions" message={activityError} /> : history === null ? <PanelLoading title="Recorded sessions" /> : <HistoricalChart title="Recorded sessions" series={learningSeries} timezone={history.timezone} />}
    </section>
    <section className="analytics-panel" aria-labelledby="llm-usage-heading">
      <div className="analytics-panel__heading"><div><h2 id="llm-usage-heading">LLM usage</h2><p>Provider requests and recorded token totals for the selected range.</p></div></div>
      {llmError ? <PanelError title="LLM usage" message={llmError} /> : llm === null ? <PanelLoading title="LLM usage" /> : <><div className="metric-grid"><MetricCard label="Requests" value={llm.requests} /><MetricCard label="Input tokens" value={llm.inputTokens.toLocaleString()} /><MetricCard label="Output tokens" value={llm.outputTokens.toLocaleString()} /><MetricCard label="Cost" value={(llm.costMicros / 1_000_000).toFixed(4)} /><MetricCard label="Recorded latency" value={`${llm.latencyMs ?? 0} ms`} /><MetricCard label="Recorded errors" value={llm.errors ?? 0} /></div>{(llm.breakdown?.length ?? 0) > 0 ? <div className="data-table-shell table-scroll"><table aria-label="LLM provider model group breakdown"><caption className="sr-only">LLM provider, model, and group breakdown</caption><thead><tr><th>Provider</th><th>Model</th><th>Group</th><th>Requests</th><th>Cost</th><th>Recorded latency</th><th>Errors</th></tr></thead><tbody>{llm.breakdown?.map((row) => <tr key={`${row.providerId}:${row.modelId}:${row.groupId}`}><th>{row.providerId}</th><td>{row.modelId}</td><td>{row.groupId}</td><td>{row.requests}</td><td>{(row.costMicros / 1_000_000).toFixed(4)}</td><td>{row.latencyMs} ms</td><td>{row.errors}</td></tr>)}</tbody></table></div> : <p role="status">No provider, model, or group usage was recorded in this period.</p>}</>}
    </section>
    <section className="analytics-panel" aria-labelledby="policy-blocks-heading">
      <div className="analytics-panel__heading"><div><h2 id="policy-blocks-heading">Policy blocks</h2><p>Requests blocked before provider execution in the selected range.</p></div></div>
      {policyError ? <PanelError title="Policy blocks" message={policyError} /> : blocks === null ? <PanelLoading title="Policy blocks" /> : <div className="metric-grid"><MetricCard label="Blocked requests" value={blocks.blocks} detail="Requests rejected before provider execution" /></div>}
    </section>
  </div>;
}

function toSeries(history: HistoricalSeries, key: AnalyticsMetric, label: string, kind: ChartSeries['kind'], comparisonLabel?: string, transform: (value: number) => number = (value) => value): ChartSeries {
  const buckets = kind === 'primary' ? history.primary : history.comparison ?? [];
  return { key, label, kind, comparisonLabel, values: buckets.map((bucket) => ({ start: bucket.start, end: bucket.end, coverage: bucket.coverage, value: bucket.values === null ? null : transform(bucket.values[key]) })) };
}

function comparisonLabel(mode: ComparisonMode): string | undefined {
  if (mode === 'previousYear') return 'Previous year';
  if (mode === 'previousPeriod') return 'Previous period';
  return undefined;
}

function aggregateValue(summary: AnalyticsSummary | null, value: number | undefined): number | string {
  if (summary?.coverage === 'missing' || summary?.coverage === 'rawExpired') return 'No recorded data';
  return value ?? '—';
}

function PanelLoading({ title }: { title: string }) {
  return <p role="status">Loading {title.toLowerCase()}.</p>;
}

function PanelError({ title, message }: { title: string; message: string }) {
  return <p role="alert">Unable to load {title.toLowerCase()}. {message}</p>;
}
