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
        {usageSeries.length === 0 ? <p role="status">No provider requests were recorded in this period.</p> : <><HistoricalChart title="Provider usage chart" series={usageSeries} /><AnalyticsHistoryTable title="Provider usage" series={usageSeries} /></>}
      </section>
      <section aria-labelledby="provider-health-heading">
        <h3 id="provider-health-heading">Recorded configuration checks</h3>
        {history.healthChecks.length === 0 ? <p role="status">No provider configuration checks were recorded in this period.</p> : null}<div className="table-scroll"><table aria-label="Provider health history"><caption className="sr-only">Provider health history</caption><thead><tr><th scope="col">Recorded</th><th scope="col">Actor</th><th scope="col">Configuration valid</th><th scope="col">Network check performed</th><th scope="col">Outcome</th></tr></thead><tbody>{history.healthChecks.map((check) => <tr key={check.id} data-testid={`provider-health-check-${check.id}`}><td>{new Date(check.createdAt * 1_000).toLocaleString()}</td><td>{check.actorUserId}</td><td>{check.configurationValid ? 'Yes' : 'No'}</td><td>{check.networkCheckPerformed ? 'Yes' : 'No'}</td><td>{check.outcome}</td></tr>)}</tbody></table></div>
      </section>
    </> : null}
  </ConsoleDialog>;
}

function toUsageSeries(usage: ProviderHistoryData['usage']): ChartSeries[] {
  const byModel = new Map<string, ProviderHistoryData['usage']>();
  for (const row of usage) byModel.set(row.modelId, [...(byModel.get(row.modelId) ?? []), row]);
  return [...byModel.values()].flatMap((rows) => {
    const model = rows[0];
    return [{
      key: `requests-${model.modelId}`,
      label: `${model.modelKey} requests`,
      kind: 'primary' as const,
      values: rows.map((row) => ({ start: row.dayStart, end: row.dayStart + DAY, value: row.requests, coverage: 'complete' as const })),
    }, {
      key: `cost-${model.modelId}`,
      label: `${model.modelKey} cost micros`,
      kind: 'primary' as const,
      values: rows.map((row) => ({ start: row.dayStart, end: row.dayStart + DAY, value: row.costMicros, coverage: 'complete' as const })),
    }];
  });
}
