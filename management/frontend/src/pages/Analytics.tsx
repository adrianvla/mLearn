import { useEffect, useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import { Tabs } from '@heroui/react';
import { ApiClient } from '../api/client';
import type { AnalyticsBreakdown, AnalyticsGranularity, AnalyticsMetric, AnalyticsSummary, AnalyticsTab, DimensionAnalytics, HistoricalSeries, LearnerAnalytics, LlmAnalytics, PolicyBlockAnalytics, SavedAnalyticsViewDefinition } from '../api/types';
import { MetricCard } from '../components/MetricCard';
import { PageToolbar } from '../components/PageToolbar';
import { ConsoleButton, ConsoleDialog, ConsoleSelect } from '../components/console';
import { useGroupScope } from '../groups/GroupScopeProvider';
import { AnalyticsFilters, analyticsRangeError, type AnalyticsFilterValue } from './analytics/AnalyticsFilters';
import { AnalyticsOverview } from './analytics/AnalyticsOverview';
import { HistoryDrawer } from './analytics/HistoryDrawer';
import { SavedViewSelector } from './analytics/SavedViewSelector';

const api = new ApiClient();
const DAY = 86_400_000;
interface AnalyticsState {
  groupId: string | null;
  filters: AnalyticsFilterValue;
  tab: AnalyticsTab;
  visibleMetrics: AnalyticsMetric[];
  breakdown: AnalyticsBreakdown;
}

export default function Analytics() {
  const scope = useGroupScope();
  const scopedGroupId = scope.status === 'ready' ? scope.selectedGroup?.id ?? null : null;
  const [analyticsState, setAnalyticsState] = useState<AnalyticsState>(() => defaultAnalyticsState(scopedGroupId));
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null);
  const [history, setHistory] = useState<HistoricalSeries | null>(null);
  const [activityError, setActivityError] = useState<string | null>(null);
  const [learners, setLearners] = useState<LearnerAnalytics[]>([]);
  const [learnersError, setLearnersError] = useState<string | null>(null);
  const [content, setContent] = useState<DimensionAnalytics[]>([]);
  const [contentError, setContentError] = useState<string | null>(null);
  const [breakdownLoading, setBreakdownLoading] = useState({ learners: false, content: false });
  const [llm, setLlm] = useState<LlmAnalytics | null>(null);
  const [llmError, setLlmError] = useState<string | null>(null);
  const [blocks, setBlocks] = useState<PolicyBlockAnalytics | null>(null);
  const [policyError, setPolicyError] = useState<string | null>(null);
  const [quotaRemaining, setQuotaRemaining] = useState<Record<string, number | null>>({});
  const [confirm, setConfirm] = useState(false);
  const [drilldown, setDrilldown] = useState<{ from: number; to: number } | null>(null);
  const groupId = analyticsState.groupId;
  const { filters, tab, visibleMetrics, breakdown } = analyticsState;
  const granularity = useMemo(() => resolveGranularity(filters), [filters]);
  const query = useMemo(() => toQuery(groupId, filters), [groupId, filters]);
  const rangeError = analyticsRangeError(filters);

  useEffect(() => {
    setAnalyticsState((current) => current.groupId === scopedGroupId ? current : { ...current, groupId: scopedGroupId });
  }, [scopedGroupId]);

  useEffect(() => {
    if (rangeError !== null) return;
    setSummary(null); setHistory(null); setActivityError(null); setLearners([]); setLearnersError(null); setContent([]); setContentError(null); setBreakdownLoading({ learners: true, content: true }); setLlm(null); setLlmError(null); setBlocks(null); setPolicyError(null); setQuotaRemaining({});
    if (groupId === undefined || groupId === null) return;
    const controller = new AbortController();
    const options = { signal: controller.signal };
    const historyQuery = `${query}&granularity=${granularity}&comparison=${filters.comparison}`;

    void api.get<AnalyticsSummary>(`/api/analytics/summary?${query}`, options)
      .then((next) => { if (!controller.signal.aborted) setSummary(next); })
      .catch(() => undefined);
    void api.get<HistoricalSeries>(`/api/analytics/history?${historyQuery}`, options)
      .then((next) => { if (!controller.signal.aborted) setHistory(next); })
      .catch((error: unknown) => { if (!controller.signal.aborted) setActivityError(errorMessage(error)); });
    void api.get<LlmAnalytics>(`/api/analytics/llm?${query}`, options)
      .then((next) => { if (!controller.signal.aborted) setLlm(next); })
      .catch((error: unknown) => { if (!controller.signal.aborted) setLlmError(errorMessage(error)); });
    void api.get<PolicyBlockAnalytics>(`/api/analytics/policy-blocks?${query}`, options)
      .then((next) => { if (!controller.signal.aborted) setBlocks(next); })
      .catch((error: unknown) => { if (!controller.signal.aborted) setPolicyError(errorMessage(error)); });
    void api.get<{ items: LearnerAnalytics[] }>(`/api/analytics/learners?${query}`, options)
      .then((next) => { if (!controller.signal.aborted) { setLearners(next.items); setBreakdownLoading((current) => ({ ...current, learners: false })); } })
      .catch((error: unknown) => { if (!controller.signal.aborted) { setLearnersError(errorMessage(error)); setBreakdownLoading((current) => ({ ...current, learners: false })); } });
    void api.get<{ items: DimensionAnalytics[] }>(`/api/analytics/content?${query}`, options)
      .then((next) => { if (!controller.signal.aborted) { setContent(next.items); setBreakdownLoading((current) => ({ ...current, content: false })); } })
      .catch((error: unknown) => { if (!controller.signal.aborted) { setContentError(errorMessage(error)); setBreakdownLoading((current) => ({ ...current, content: false })); } });
    void api.get<{ buckets: Array<{ scopeKind: string; scopeId: string; remaining: number | null }> }>(`/api/llm/usage?groupId=${encodeURIComponent(groupId)}`, options)
      .then((usage) => { if (!controller.signal.aborted) setQuotaRemaining(toRemainingQuota(usage.buckets)); })
      .catch(() => undefined);
    return () => controller.abort();
  }, [filters.comparison, granularity, groupId, query, rangeError]);

  const exportCsv = () => {
    if (rangeError === null && groupId !== undefined && groupId !== null) {
      window.location.assign(`/api/analytics/export.csv?${toQuery(groupId, filters)}&breakdown=${encodeURIComponent(breakdown)}&limit=200`);
    }
  };

  return <div className="resource-page analytics-page">
    <PageToolbar title="Analytics" description="Recorded learning activity, content, LLM usage, and policy outcomes." actions={<div className="toolbar-actions analytics-toolbar-actions"><AnalyticsFilters value={filters} timezone={history?.timezone ?? null} onChange={(next) => setAnalyticsState((current) => ({ ...current, filters: next }))} />{scope.status === 'ready' && scope.can('analytics.view') ? <><ConsoleSelect label="Breakdown" selectedKey={breakdown} onSelectionChange={(next) => setAnalyticsState((current) => ({ ...current, breakdown: next as AnalyticsBreakdown }))} options={[{ key: 'none', label: 'No breakdown' }, { key: 'learners', label: 'Learners' }, { key: 'content', label: 'Content' }]} /><SavedViewSelector groupId={groupId} definition={toSavedDefinition(analyticsState)} onApply={async (definition) => { if ('selectGroup' in scope) await scope.selectGroup(definition.groupId); setAnalyticsState(fromSavedDefinition(definition)); }} /><ConsoleButton className="secondary-action" isDisabled={rangeError !== null} onClick={() => setConfirm(true)}><Download />Export CSV</ConsoleButton></> : null}</div>} />
    <Tabs selectedKey={tab} onSelectionChange={(key) => setAnalyticsState((current) => ({ ...current, tab: String(key) as AnalyticsTab }))}><Tabs.ListContainer className="detail-tabs"><Tabs.List aria-label="Analytics view">{(['overview', 'learners', 'content', 'llm usage', 'policy blocks'] as const).map((name) => <Tabs.Tab id={name} key={name}>{name}</Tabs.Tab>)}</Tabs.List></Tabs.ListContainer></Tabs>
    <BreakdownPanel breakdown={breakdown} learners={learners} learnersError={learnersError} learnersLoading={breakdownLoading.learners} content={content} contentError={contentError} contentLoading={breakdownLoading.content} quotaRemaining={quotaRemaining} />
    {tab === 'overview' ? <AnalyticsOverview summary={summary} history={history} comparison={filters.comparison} visibleMetrics={visibleMetrics} onVisibleMetricsChange={(next) => setAnalyticsState((current) => ({ ...current, visibleMetrics: next }))} activityError={activityError} llm={llm} llmError={llmError} blocks={blocks} policyError={policyError} onBucketClick={(from, to) => setDrilldown({ from, to })} /> : null}
    {tab === 'learners' ? <AnalyticsTable label="Learner analytics" headings={['Learner', 'Activity', 'Completion', 'Requests', 'Tokens', 'Cost', 'Blocks', 'Quota remaining']} rows={learners.map((learner) => [learner.displayName, `${learner.sessions} sessions`, learner.completions, learner.llmRequests, learner.totalTokens, (learner.costMicros / 1_000_000).toFixed(4), learner.policyBlocks, formatRemaining(quotaRemaining, learner.learnerId)])} /> : null}
    {tab === 'content' ? <AnalyticsTable label="Content analytics" headings={['Content', 'Activity', 'Watch time', 'Completion', 'Learners']} rows={content.map((item) => [item.title ?? item.key, new Date(item.lastActivityAt).toLocaleDateString(), `${Math.round(item.watchSeconds / 60)} min`, item.completions, item.activeLearners])} /> : null}
    {tab === 'llm usage' ? <section aria-label="LLM usage">{llmError ? <p role="alert">Unable to load LLM usage. {llmError}</p> : <><div className="metric-grid"><MetricCard label="Requests" value={llm?.requests ?? '—'} /><MetricCard label="Input tokens" value={(llm?.inputTokens ?? 0).toLocaleString()} /><MetricCard label="Output tokens" value={(llm?.outputTokens ?? 0).toLocaleString()} /><MetricCard label="Cost" value={((llm?.costMicros ?? 0) / 1_000_000).toFixed(4)} /><MetricCard label="Recorded latency" value={`${llm?.latencyMs ?? 0} ms`} /><MetricCard label="Recorded errors" value={llm?.errors ?? 0} /></div>{(llm?.breakdown?.length ?? 0) > 0 ? <AnalyticsTable label="LLM provider model group breakdown" headings={['Provider', 'Model', 'Group', 'Requests', 'Cost', 'Recorded latency', 'Errors']} rows={(llm?.breakdown ?? []).map((item) => [item.providerId, item.modelId, item.groupId, item.requests, (item.costMicros / 1_000_000).toFixed(4), `${item.latencyMs} ms`, item.errors])} /> : <p role="status">No provider, model, or group usage was recorded in this period.</p>}</>}</section> : null}
    {tab === 'policy blocks' ? <section className="metric-grid" aria-label="Policy block analytics">{policyError ? <p role="alert">Unable to load policy blocks. {policyError}</p> : <MetricCard label="Blocked requests" value={blocks?.blocks ?? '—'} detail="Requests rejected before provider execution" />}</section> : null}
    <ConsoleDialog open={confirm} onOpenChange={setConfirm} title="Export analytics?" footer={<><ConsoleButton onClick={() => setConfirm(false)}>Cancel</ConsoleButton><ConsoleButton onClick={exportCsv}>Confirm export</ConsoleButton></>}><p>This export matches the selected breakdown, is policy-controlled, and is recorded in the audit log.</p></ConsoleDialog>
    {drilldown !== null ? <HistoryDrawer open onOpenChange={(open) => { if (!open) setDrilldown(null); }} groupId={groupId} from={drilldown.from} to={drilldown.to} /> : null}
  </div>;
}

function defaultFilters(): AnalyticsFilterValue {
  const to = Date.now();
  return { from: to - 30 * DAY, to, preset: '30', comparison: 'none', granularity: 'auto' };
}

function defaultAnalyticsState(groupId: string | null): AnalyticsState {
  return { groupId, filters: defaultFilters(), tab: 'overview', visibleMetrics: ['readerPages', 'watchSeconds', 'flashcardEvents'], breakdown: 'none' };
}

function toSavedDefinition(state: AnalyticsState): SavedAnalyticsViewDefinition {
  return { groupId: state.groupId ?? '', ...state.filters, tab: state.tab, visibleMetrics: state.visibleMetrics, breakdown: state.breakdown };
}

function fromSavedDefinition(definition: SavedAnalyticsViewDefinition): AnalyticsState {
  return {
    groupId: definition.groupId,
    filters: { from: definition.from, to: definition.to, preset: definition.preset, comparison: definition.comparison, granularity: definition.granularity },
    tab: definition.tab,
    visibleMetrics: definition.visibleMetrics,
    breakdown: definition.breakdown,
  };
}

function resolveGranularity(value: AnalyticsFilterValue): AnalyticsGranularity {
  if (value.granularity !== 'auto') return value.granularity;
  const days = (value.to - value.from) / DAY;
  if (days <= 31) return 'daily';
  if (days <= 120) return 'weekly';
  return 'monthly';
}

function toQuery(groupId: string | undefined | null, filters: Pick<AnalyticsFilterValue, 'from' | 'to'>): string {
  return `groupId=${encodeURIComponent(groupId ?? '')}&from=${filters.from}&to=${filters.to}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'The request did not complete.';
}

function toRemainingQuota(buckets: Array<{ scopeKind: string; scopeId: string; remaining: number | null }>): Record<string, number | null> {
  const remaining: Record<string, number | null> = {};
  for (const bucket of buckets.filter((item) => item.scopeKind === 'user')) {
    const current = remaining[bucket.scopeId];
    if (bucket.remaining !== null && (current === undefined || current === null || bucket.remaining < current)) remaining[bucket.scopeId] = bucket.remaining;
    else if (current === undefined) remaining[bucket.scopeId] = null;
  }
  return remaining;
}

function formatRemaining(values: Record<string, number | null>, learnerId: string): string | number {
  const value = values[learnerId];
  if (value === undefined) return 'No individual quota';
  return value === null ? 'Governed' : value;
}

function BreakdownPanel({ breakdown, learners, learnersError, learnersLoading, content, contentError, contentLoading, quotaRemaining }: { breakdown: AnalyticsBreakdown; learners: LearnerAnalytics[]; learnersError: string | null; learnersLoading: boolean; content: DimensionAnalytics[]; contentError: string | null; contentLoading: boolean; quotaRemaining: Record<string, number | null> }) {
  if (breakdown === 'none') return <section className="analytics-breakdown" aria-label="Analytics breakdown"><p>No breakdown selected.</p></section>;
  if (breakdown === 'learners') return <section className="analytics-breakdown" aria-labelledby="learner-breakdown-heading"><h2 id="learner-breakdown-heading">Learner breakdown</h2>{learnersError ? <p role="alert">Unable to load learner breakdown. {learnersError}</p> : learnersLoading ? <p role="status">Loading learner breakdown.</p> : learners.length === 0 ? <p role="status">No learner analytics recorded for the selected range.</p> : <AnalyticsTable label="Learner breakdown" headings={['Learner', 'Activity', 'Completion', 'Requests', 'Tokens', 'Cost', 'Blocks', 'Quota remaining']} rows={learners.map((learner) => [learner.displayName, `${learner.sessions} sessions`, learner.completions, learner.llmRequests, learner.totalTokens, (learner.costMicros / 1_000_000).toFixed(4), learner.policyBlocks, formatRemaining(quotaRemaining, learner.learnerId)])} />}</section>;
  return <section className="analytics-breakdown" aria-labelledby="content-breakdown-heading"><h2 id="content-breakdown-heading">Content breakdown</h2>{contentError ? <p role="alert">Unable to load content breakdown. {contentError}</p> : contentLoading ? <p role="status">Loading content breakdown.</p> : content.length === 0 ? <p role="status">No content analytics recorded for the selected range.</p> : <AnalyticsTable label="Content breakdown" headings={['Content', 'Activity', 'Watch time', 'Completion', 'Learners']} rows={content.map((item) => [item.title ?? item.key, new Date(item.lastActivityAt).toLocaleDateString(), `${Math.round(item.watchSeconds / 60)} min`, item.completions, item.activeLearners])} />}</section>;
}

function AnalyticsTable({ label, headings, rows }: { label: string; headings: string[]; rows: Array<Array<string | number>> }) {
  return <div className="data-table-shell table-scroll"><table><caption className="sr-only">{label}</caption><thead><tr>{headings.map((heading) => <th key={heading}>{heading}</th>)}</tr></thead><tbody>{rows.map((row, rowIndex) => <tr key={`${row[0]}-${rowIndex}`}>{row.map((cell, index) => index === 0 ? <th key={index}>{cell}</th> : <td key={index}>{cell}</td>)}</tr>)}</tbody></table></div>;
}
