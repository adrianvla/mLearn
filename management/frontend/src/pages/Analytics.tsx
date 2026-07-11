import { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import { ApiClient } from '../api/client';
import type { AnalyticsSummary, DimensionAnalytics, LearnerAnalytics, LlmAnalytics, PolicyBlockAnalytics, TimeseriesPoint } from '../api/types';
import { LineChart } from '../components/LineChart';
import { MetricCard } from '../components/MetricCard';
import { PageToolbar } from '../components/PageToolbar';
import { useGroupScope } from '../groups/GroupScopeProvider';

const api = new ApiClient();
type Tab = 'overview' | 'learners' | 'content' | 'llm usage' | 'policy blocks';

export default function Analytics() {
  const scope = useGroupScope();
  const groupId = scope.status === 'ready' ? scope.selectedGroup?.id : null;
  const [tab, setTab] = useState<Tab>('overview');
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null);
  const [series, setSeries] = useState<TimeseriesPoint[]>([]);
  const [learners, setLearners] = useState<LearnerAnalytics[]>([]);
  const [content, setContent] = useState<DimensionAnalytics[]>([]);
  const [llm, setLlm] = useState<LlmAnalytics | null>(null);
  const [blocks, setBlocks] = useState<PolicyBlockAnalytics | null>(null);
  const [quotaRemaining, setQuotaRemaining] = useState<Record<string, number | null>>({});
  const [confirm, setConfirm] = useState(false);
  const [periodDays, setPeriodDays] = useState(30);

  useEffect(() => {
    setSummary(null); setSeries([]); setLearners([]); setContent([]); setLlm(null); setBlocks(null); setQuotaRemaining({});
    if (!groupId) return;
    const controller = new AbortController();
    const to = Date.now();
    const from = to - periodDays * 86_400_000;
    const query = `groupId=${encodeURIComponent(groupId)}&from=${from}&to=${to}`;
    Promise.all([
      api.get<AnalyticsSummary>(`/api/analytics/summary?${query}`, { signal: controller.signal }),
      api.get<TimeseriesPoint[]>(`/api/analytics/timeseries?${query}`, { signal: controller.signal }),
      api.get<{ items: LearnerAnalytics[] }>(`/api/analytics/learners?${query}`, { signal: controller.signal }),
      api.get<{ items: DimensionAnalytics[] }>(`/api/analytics/content?${query}`, { signal: controller.signal }),
      api.get<LlmAnalytics>(`/api/analytics/llm?${query}`, { signal: controller.signal }),
      api.get<PolicyBlockAnalytics>(`/api/analytics/policy-blocks?${query}`, { signal: controller.signal }),
      api.get<{ buckets: Array<{ scopeKind: string; scopeId: string; remaining: number | null }> }>(`/api/llm/usage?groupId=${encodeURIComponent(groupId)}`, { signal: controller.signal }).catch(() => ({ buckets: [] })),
    ]).then(([nextSummary, nextSeries, nextLearners, nextContent, nextLlm, nextBlocks, usage]) => {
      if (controller.signal.aborted) return;
      setSummary(nextSummary); setSeries(nextSeries); setLearners(nextLearners.items); setContent(nextContent.items); setLlm(nextLlm); setBlocks(nextBlocks);
      const remaining: Record<string, number | null> = {};
      for (const bucket of usage.buckets.filter((item) => item.scopeKind === 'user')) {
        const current = remaining[bucket.scopeId];
        if (bucket.remaining !== null && (current === undefined || current === null || bucket.remaining < current)) remaining[bucket.scopeId] = bucket.remaining;
        else if (current === undefined) remaining[bucket.scopeId] = null;
      }
      setQuotaRemaining(remaining);
    });
    return () => controller.abort();
  }, [groupId, periodDays]);

  const exportCsv = () => {
    if (groupId) {
      const to = Date.now();
      const from = to - periodDays * 86_400_000;
      window.location.assign(`/api/analytics/export.csv?groupId=${encodeURIComponent(groupId)}&from=${from}&to=${to}&limit=200`);
    }
  };

  return <div className="resource-page">
    <PageToolbar title="Analytics" description="Scoped learning, content, LLM usage, and policy outcomes." actions={<div className="toolbar-actions"><select aria-label="Analytics date period" value={periodDays} onChange={(event) => setPeriodDays(Number(event.currentTarget.value))}><option value="7">7 days</option><option value="30">30 days</option><option value="90">90 days</option></select>{scope.status === 'ready' && scope.can('analytics.view') ? <button className="secondary-action" onClick={() => setConfirm(true)}><Download />Export CSV</button> : null}</div>} />
    <div className="detail-tabs" role="tablist">{(['overview', 'learners', 'content', 'llm usage', 'policy blocks'] as const).map((name) => <button key={name} role="tab" aria-selected={tab === name} onClick={() => setTab(name)}>{name}</button>)}</div>
    {tab === 'overview' && <><section className="metric-grid"><MetricCard label="Active learners" value={summary?.activeLearners ?? '—'} /><MetricCard label="Content watched" value={`${Math.round((summary?.watchSeconds ?? 0) / 60)} min`} /><MetricCard label="LLM cost" value={((summary?.costMicros ?? 0) / 1_000_000).toFixed(2)} /><MetricCard label="Policy blocks" value={summary?.policyBlocks ?? '—'} /></section><section className="dashboard-panel"><LineChart title="Learning sessions" data={series.map((point) => ({ label: new Date(point.dayStart).toLocaleDateString(), value: point.sessions }))} /></section></>}
    {tab === 'learners' && <AnalyticsTable label="Learner analytics" headings={['Learner', 'Activity', 'Completion', 'Requests', 'Tokens', 'Cost', 'Blocks', 'Quota remaining']} rows={learners.map((learner) => [learner.displayName, `${learner.sessions} sessions`, learner.completions, learner.llmRequests, learner.totalTokens, (learner.costMicros / 1_000_000).toFixed(4), learner.policyBlocks, formatRemaining(quotaRemaining, learner.learnerId)])} />}
    {tab === 'content' && <AnalyticsTable label="Content analytics" headings={['Content', 'Activity', 'Watch time', 'Completion', 'Learners']} rows={content.map((item) => [item.title ?? item.key, new Date(item.lastActivityAt).toLocaleDateString(), `${Math.round(item.watchSeconds / 60)} min`, item.completions, item.activeLearners])} />}
    {tab === 'llm usage' && <section className="metric-grid" aria-label="LLM usage"><MetricCard label="Requests" value={llm?.requests ?? '—'} /><MetricCard label="Input tokens" value={(llm?.inputTokens ?? 0).toLocaleString()} /><MetricCard label="Output tokens" value={(llm?.outputTokens ?? 0).toLocaleString()} /><MetricCard label="Cost" value={((llm?.costMicros ?? 0) / 1_000_000).toFixed(4)} /></section>}
    {tab === 'policy blocks' && <section className="metric-grid" aria-label="Policy block analytics"><MetricCard label="Blocked requests" value={blocks?.blocks ?? '—'} detail="Requests rejected before provider execution" /></section>}
    {confirm && <div className="dialog-backdrop"><section role="dialog" aria-modal="true" aria-labelledby="export-title" className="console-dialog"><h2 id="export-title">Export learner analytics?</h2><p>This export is policy-controlled and recorded in the audit log.</p><footer><button onClick={() => setConfirm(false)}>Cancel</button><button onClick={exportCsv}>Confirm export</button></footer></section></div>}
  </div>;
}

function formatRemaining(values: Record<string, number | null>, learnerId: string): string | number {
  const value = values[learnerId];
  if (value === undefined) return 'No individual quota';
  return value === null ? 'Governed' : value;
}

function AnalyticsTable({ label, headings, rows }: { label: string; headings: string[]; rows: Array<Array<string | number>> }) {
  return <div className="data-table-shell table-scroll"><table><caption className="sr-only">{label}</caption><thead><tr>{headings.map((heading) => <th key={heading}>{heading}</th>)}</tr></thead><tbody>{rows.map((row, rowIndex) => <tr key={`${row[0]}-${rowIndex}`}>{row.map((cell, index) => index === 0 ? <th key={index}>{cell}</th> : <td key={index}>{cell}</td>)}</tr>)}</tbody></table></div>;
}
