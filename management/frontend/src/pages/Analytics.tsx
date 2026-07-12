import { useEffect, useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import { Tabs } from '@heroui/react';
import { ApiClient } from '../api/client';
import type { AnalyticsGranularity, DimensionAnalytics, HistoricalSeries, LearnerAnalytics, LlmAnalytics, PolicyBlockAnalytics } from '../api/types';
import { MetricCard } from '../components/MetricCard';
import { PageToolbar } from '../components/PageToolbar';
import { ConsoleButton, ConsoleDialog } from '../components/console';
import { useGroupScope } from '../groups/GroupScopeProvider';
import { AnalyticsFilters, type AnalyticsFilterValue } from './analytics/AnalyticsFilters';
import { AnalyticsOverview } from './analytics/AnalyticsOverview';

const api = new ApiClient();
const DAY = 86_400_000;
type Tab = 'overview' | 'learners' | 'content' | 'llm usage' | 'policy blocks';

export default function Analytics() {
  const scope = useGroupScope();
  const groupId = scope.status === 'ready' ? scope.selectedGroup?.id : null;
  const [tab, setTab] = useState<Tab>('overview');
  const [filters, setFilters] = useState<AnalyticsFilterValue>(() => defaultFilters());
  const [history, setHistory] = useState<HistoricalSeries | null>(null);
  const [activityError, setActivityError] = useState<string | null>(null);
  const [learners, setLearners] = useState<LearnerAnalytics[]>([]);
  const [content, setContent] = useState<DimensionAnalytics[]>([]);
  const [llm, setLlm] = useState<LlmAnalytics | null>(null);
  const [llmError, setLlmError] = useState<string | null>(null);
  const [blocks, setBlocks] = useState<PolicyBlockAnalytics | null>(null);
  const [policyError, setPolicyError] = useState<string | null>(null);
  const [quotaRemaining, setQuotaRemaining] = useState<Record<string, number | null>>({});
  const [confirm, setConfirm] = useState(false);
  const granularity = useMemo(() => resolveGranularity(filters), [filters]);
  const query = useMemo(() => toQuery(groupId, filters), [groupId, filters]);

  useEffect(() => {
    setHistory(null); setActivityError(null); setLearners([]); setContent([]); setLlm(null); setLlmError(null); setBlocks(null); setPolicyError(null); setQuotaRemaining({});
    if (groupId === undefined || groupId === null) return;
    const controller = new AbortController();
    const options = { signal: controller.signal };
    const historyQuery = `${query}&granularity=${granularity}&comparison=${filters.comparison}`;

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
      .then((next) => { if (!controller.signal.aborted) setLearners(next.items); })
      .catch(() => undefined);
    void api.get<{ items: DimensionAnalytics[] }>(`/api/analytics/content?${query}`, options)
      .then((next) => { if (!controller.signal.aborted) setContent(next.items); })
      .catch(() => undefined);
    void api.get<{ buckets: Array<{ scopeKind: string; scopeId: string; remaining: number | null }> }>(`/api/llm/usage?groupId=${encodeURIComponent(groupId)}`, options)
      .then((usage) => { if (!controller.signal.aborted) setQuotaRemaining(toRemainingQuota(usage.buckets)); })
      .catch(() => undefined);
    return () => controller.abort();
  }, [filters.comparison, granularity, groupId, query]);

  const exportCsv = () => {
    if (groupId !== undefined && groupId !== null) {
      window.location.assign(`/api/analytics/export.csv?${toQuery(groupId, filters)}&limit=200`);
    }
  };

  return <div className="resource-page analytics-page">
    <PageToolbar title="Analytics" description="Recorded learning activity, content, LLM usage, and policy outcomes." actions={<div className="toolbar-actions analytics-toolbar-actions"><AnalyticsFilters value={filters} onChange={setFilters} />{scope.status === 'ready' && scope.can('analytics.view') ? <ConsoleButton className="secondary-action" onClick={() => setConfirm(true)}><Download />Export CSV</ConsoleButton> : null}</div>} />
    <Tabs selectedKey={tab} onSelectionChange={(key) => setTab(String(key) as Tab)}><Tabs.ListContainer className="detail-tabs"><Tabs.List aria-label="Analytics view">{(['overview', 'learners', 'content', 'llm usage', 'policy blocks'] as const).map((name) => <Tabs.Tab id={name} key={name}>{name}</Tabs.Tab>)}</Tabs.List></Tabs.ListContainer></Tabs>
    {tab === 'overview' ? <AnalyticsOverview history={history} activityError={activityError} llm={llm} llmError={llmError} blocks={blocks} policyError={policyError} /> : null}
    {tab === 'learners' ? <AnalyticsTable label="Learner analytics" headings={['Learner', 'Activity', 'Completion', 'Requests', 'Tokens', 'Cost', 'Blocks', 'Quota remaining']} rows={learners.map((learner) => [learner.displayName, `${learner.sessions} sessions`, learner.completions, learner.llmRequests, learner.totalTokens, (learner.costMicros / 1_000_000).toFixed(4), learner.policyBlocks, formatRemaining(quotaRemaining, learner.learnerId)])} /> : null}
    {tab === 'content' ? <AnalyticsTable label="Content analytics" headings={['Content', 'Activity', 'Watch time', 'Completion', 'Learners']} rows={content.map((item) => [item.title ?? item.key, new Date(item.lastActivityAt).toLocaleDateString(), `${Math.round(item.watchSeconds / 60)} min`, item.completions, item.activeLearners])} /> : null}
    {tab === 'llm usage' ? <section className="metric-grid" aria-label="LLM usage">{llmError ? <p role="alert">Unable to load LLM usage. {llmError}</p> : <><MetricCard label="Requests" value={llm?.requests ?? '—'} /><MetricCard label="Input tokens" value={(llm?.inputTokens ?? 0).toLocaleString()} /><MetricCard label="Output tokens" value={(llm?.outputTokens ?? 0).toLocaleString()} /><MetricCard label="Cost" value={((llm?.costMicros ?? 0) / 1_000_000).toFixed(4)} /></>}</section> : null}
    {tab === 'policy blocks' ? <section className="metric-grid" aria-label="Policy block analytics">{policyError ? <p role="alert">Unable to load policy blocks. {policyError}</p> : <MetricCard label="Blocked requests" value={blocks?.blocks ?? '—'} detail="Requests rejected before provider execution" />}</section> : null}
    <ConsoleDialog open={confirm} onOpenChange={setConfirm} title="Export learner analytics?" footer={<><ConsoleButton onClick={() => setConfirm(false)}>Cancel</ConsoleButton><ConsoleButton onClick={exportCsv}>Confirm export</ConsoleButton></>}><p>This export is policy-controlled and recorded in the audit log.</p></ConsoleDialog>
  </div>;
}

function defaultFilters(): AnalyticsFilterValue {
  const to = Date.now();
  return { from: to - 30 * DAY, to, preset: '30', comparison: 'none', granularity: 'auto' };
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

function AnalyticsTable({ label, headings, rows }: { label: string; headings: string[]; rows: Array<Array<string | number>> }) {
  return <div className="data-table-shell table-scroll"><table><caption className="sr-only">{label}</caption><thead><tr>{headings.map((heading) => <th key={heading}>{heading}</th>)}</tr></thead><tbody>{rows.map((row, rowIndex) => <tr key={`${row[0]}-${rowIndex}`}>{row.map((cell, index) => index === 0 ? <th key={index}>{cell}</th> : <td key={index}>{cell}</td>)}</tr>)}</tbody></table></div>;
}
