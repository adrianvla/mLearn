import { useEffect, useState } from 'react';
import { ApiClient } from '../api/client';
import type { LogsDto, ServiceDto } from '../api/types';
import { ErrorState, LoadingState, PageContainer, PageHeader } from '../components/shared';

const api = new ApiClient();

export default function OperationalLogs() {
  const [services, setServices] = useState<ServiceDto[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [logs, setLogs] = useState<LogsDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void api.getServices()
      .then((items) => {
        if (cancelled) return;
        setServices(items);
        setSelectedId((current) => current || items[0]?.id || '');
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : 'Could not load services.');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setLogs(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void api.getLogs(selectedId, 300)
      .then((nextLogs) => { if (!cancelled) { setLogs(nextLogs); setError(null); } })
      .catch((caught: unknown) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : 'Could not load operational logs.');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [selectedId]);

  return <PageContainer>
    <PageHeader title="Operational Logs" subtitle="Redacted container output for the selected mLearn service." />
    {services.length > 0 && <label className="search-field">Service<select aria-label="Service" value={selectedId} onChange={(event) => setSelectedId(event.currentTarget.value)}>{services.map((service) => <option key={service.id} value={service.id}>{service.service_name ?? service.container_name}</option>)}</select></label>}
    {loading && !logs && <LoadingState label="Loading operational logs…" />}
    {!loading && error && <ErrorState message={error} />}
    {!loading && !error && services.length === 0 && <p className="table-state">No mLearn containers are available.</p>}
    {logs && <section className="dashboard-panel"><p className="panel-heading">{logs.truncated ? 'Showing the most recent 300 lines.' : 'All available lines are shown.'}</p><pre className="operational-log-output" aria-label="Operational log output">{logs.lines.map((line) => `${line.timestamp ? `${line.timestamp} ` : ''}[${line.stream}] ${line.message}`).join('\n') || 'No log output.'}</pre></section>}
  </PageContainer>;
}
