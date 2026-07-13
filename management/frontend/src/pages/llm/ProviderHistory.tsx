import { useEffect, useMemo, useState } from 'react';
import { ApiClient } from '../../api/client';
import type { ProviderHistory as ProviderHistoryData } from '../../api/types';
import { ConsoleDialog } from '../../components/console';
import { HistoricalChart } from '../../components/charts/HistoricalChart';
import type { ChartSeries } from '../../components/charts/chartTypes';
import { AnalyticsHistoryTable } from '../analytics/AnalyticsHistoryTable';

const api = new ApiClient();
const DAY = 86_400_000;

interface ProviderHistoryProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  groupId: string | null;
  providerId: string | null;
  providerName: string | null;
}

export function ProviderHistory({ open, onOpenChange, groupId, providerId, providerName }: ProviderHistoryProps) {
  const [history, setHistory] = useState<ProviderHistoryData | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open || groupId === null || providerId === null) return;
    const controller = new AbortController();
    const to = Date.now();
    const query = new URLSearchParams({ groupId, from: String(to - 30 * DAY), to: String(to) });
    setHistory(null);
    setError(null);
    void api.get<ProviderHistoryData>(`/api/analytics/providers/${encodeURIComponent(providerId)}/history?${query.toString()}`, { signal: controller.signal })
      .then((result) => { if (!controller.signal.aborted) setHistory(result); })
      .catch((reason: unknown) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'The request did not complete.'); });
    return () => controller.abort();
  }, [groupId, open, providerId]);
  const usageSeries = useMemo(() => toUsageSeries(history?.usage ?? []), [history]);

  return <ConsoleDialog open={open} onOpenChange={onOpenChange} title={`${providerName ?? 'Provider'} history`}>
    <p>Recorded provider requests, costs, and configuration checks for the selected group scope. No provider response bodies or secrets are recorded.</p>
    {error !== null ? <p role="alert">Unable to load provider history. {error}</p> : null}
    {history === null && error === null ? <p role="status">Loading provider history.</p> : null}
    {history !== null ? <>
      <section aria-labelledby="provider-usage-heading">
        <h3 id="provider-usage-heading">Provider and model usage</h3>
        {usageSeries.length === 0 ? <p role="status">No provider requests were recorded in this period.</p> : <><HistoricalChart title="Provider usage chart" series={usageSeries} timezone={history.timezone} /><AnalyticsHistoryTable title="Provider usage" series={usageSeries} timezone={history.timezone} /><ProviderUsageTable usage={history.usage} timezone={history.timezone} /></>}
      </section>
      <section aria-labelledby="provider-health-heading">
        <h3 id="provider-health-heading">Recorded configuration checks</h3>
        {history.healthChecks.length === 0 ? <p role="status">No provider configuration checks were recorded in this period.</p> : null}<div className="table-scroll"><table aria-label="Provider health history"><caption className="sr-only">Provider health history</caption><thead><tr><th scope="col">Recorded</th><th scope="col">Actor</th><th scope="col">Configuration valid</th><th scope="col">Network check performed</th><th scope="col">Outcome</th></tr></thead><tbody>{history.healthChecks.map((check) => <tr key={check.id} data-testid={`provider-health-check-${check.id}`}><td>{new Date(check.createdAt * 1_000).toLocaleString()}</td><td>{check.actorUserId}</td><td>{check.configurationValid ? 'Yes' : 'No'}</td><td>{check.networkCheckPerformed ? 'Yes' : 'No'}</td><td>{check.outcome}</td></tr>)}</tbody></table></div>
      </section>
    </> : null}
  </ConsoleDialog>;
}

export function toUsageSeries(usage: ProviderHistoryData['usage']): ChartSeries[] {
  const models = new Map<string, { id: string; groupId: string; label: string }>();
  for (const day of usage) for (const model of day.values ?? []) {
    models.set(`${model.modelId}:${model.groupId}`, { id: model.modelId, groupId: model.groupId, label: `${model.modelKey} · ${model.groupId}` });
  }
  const metrics: ReadonlyArray<{ key: 'requests' | 'costMicros' | 'latencyMs' | 'errors'; label: string }> = [
    { key: 'requests', label: 'Requests' },
    { key: 'costMicros', label: 'Cost micros' },
    { key: 'latencyMs', label: 'Recorded latency (ms)' },
    { key: 'errors', label: 'Recorded errors' },
  ];
  return [...models.values()].flatMap((model) => metrics.map((metric) => ({
    key: `${metric.key}:${model.id}:${model.groupId}`,
    label: `${model.label} ${metric.label}`,
    kind: 'primary' as const,
    values: usage.map((day) => ({
      start: day.start,
      end: day.end,
      coverage: day.coverage,
      value: day.values === null ? null : day.values.find((value) => value.modelId === model.id && value.groupId === model.groupId)?.[metric.key] ?? 0,
    })),
  })));
}

function ProviderUsageTable({ usage, timezone }: { usage: ProviderHistoryData['usage']; timezone: string }) {
  const rows = usage.flatMap((day) => (day.values ?? []).map((value) => ({ day, value })));
  if (rows.length === 0) return null;
  return <div className="table-scroll"><table aria-label="Provider model group usage"><caption className="sr-only">Exact provider, model, and group usage</caption><thead><tr><th>Period</th><th>Model</th><th>Group</th><th>Requests</th><th>Cost</th><th>Recorded latency</th><th>Errors</th></tr></thead><tbody>{rows.map(({ day, value }) => <tr key={`${day.start}:${value.modelId}:${value.groupId}`}><td>{new Intl.DateTimeFormat(undefined, { timeZone: timezone }).format(new Date(day.start))}</td><th>{value.modelKey}</th><td>{value.groupId}</td><td>{value.requests}</td><td>{(value.costMicros / 1_000_000).toFixed(4)}</td><td>{value.latencyMs} ms</td><td>{value.errors}</td></tr>)}</tbody></table></div>;
}
