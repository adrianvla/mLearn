import { useEffect, useMemo, useState } from 'react';
import { ApiClient } from '../api/client';
import type { AuditEvent, AuditPage } from '../api/types';
import { DataTableShell } from '../components/DataTableShell';
import { DatePickerField } from '../components/DatePickerField';
import { PageToolbar } from '../components/PageToolbar';
import { ConsoleButton, ConsoleDialog, ConsoleTextField } from '../components/console';
import { useGroupScope } from '../groups/GroupScopeProvider';

const api = new ApiClient();
export default function ActivityLog() {
  const scope = useGroupScope();
  const groupId = scope.status === 'ready' ? scope.selectedGroup?.id ?? null : null;
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [revision, setRevision] = useState(0);
  const [actorUserId, setActorUserId] = useState('');
  const [action, setAction] = useState('');
  const [targetType, setTargetType] = useState('');
  const [targetId, setTargetId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [selected, setSelected] = useState<AuditEvent | null>(null);
  const clearFilters = () => { setActorUserId(''); setAction(''); setTargetType(''); setTargetId(''); setFrom(''); setTo(''); };
  const filtersApplied = Boolean(actorUserId || action || targetType || targetId || from || to);
  const query = useMemo(() => {
    if (!groupId) return null;
    const params = new URLSearchParams({ groupId });
    if (from) params.set('from', String(Math.floor(Date.parse(`${from}T00:00:00Z`) / 1000)));
    if (to) params.set('to', String(Math.floor(Date.parse(`${to}T23:59:59Z`) / 1000)));
    if (actorUserId) params.set('actorUserId', actorUserId);
    if (action) params.set('action', action);
    if (targetType) params.set('targetType', targetType);
    if (targetId) params.set('targetId', targetId);
    return params;
  }, [action, actorUserId, from, groupId, targetId, targetType, to]);

  useEffect(() => {
    setEvents([]); setNextCursor(null); setError(null); setLoading(query !== null);
    if (!query) return;
    const controller = new AbortController();
    api.get<AuditPage>(`/api/audit/events?${query}`, { signal: controller.signal })
      .then((page) => { if (!controller.signal.aborted) { setEvents(page.events); setNextCursor(page.nextCursor); } })
      .catch((caught: unknown) => { if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : 'Activity log could not be loaded'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [query, revision]);

  const loadMore = async () => {
    if (!query || !nextCursor) return;
    try {
      const page = await api.get<AuditPage>(`/api/audit/events?${new URLSearchParams([...query, ['cursor', nextCursor]])}`);
      setEvents((current) => [...current, ...page.events]); setNextCursor(page.nextCursor);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Activity log could not be loaded'); }
  };

  return <div className="resource-page"><PageToolbar title="Activity Log" description="Immutable administrative activity for the selected group and its descendants." actions={<ConsoleButton className="secondary-action" isDisabled={!filtersApplied} onClick={clearFilters}>Clear filters</ConsoleButton>} />
    <DataTableShell label="Activity log" loading={loading} error={error ?? undefined} onRetry={() => setRevision((value) => value + 1)} controls={<div className="filter-stack"><div className="filter-row">
      <DatePickerField label="From date" value={from} onChange={setFrom} /><DatePickerField label="To date" value={to} onChange={setTo} />
      <ConsoleTextField label="Actor user ID" value={actorUserId} onChange={setActorUserId} placeholder="User ID" />
      <ConsoleTextField label="Action" value={action} onChange={setAction} placeholder="Exact action" />
      <ConsoleTextField label="Target type" value={targetType} onChange={setTargetType} placeholder="Exact target type" />
      <ConsoleTextField label="Target ID" value={targetId} onChange={setTargetId} placeholder="Target ID" />
    </div></div>}>
      {events.length ? <div className="table-scroll"><table><caption className="sr-only">Administrative activity</caption><thead><tr><th>Action</th><th>Actor</th><th>Target</th><th>Group</th><th>When</th></tr></thead><tbody>{events.map((event) => <tr key={event.id}><th><ConsoleButton className="table-link" onClick={() => setSelected(event)}>{event.action}</ConsoleButton></th><td>{event.actor ?? 'System'}</td><td>{event.targetType ?? '—'}{event.targetId ? ` / ${event.targetId}` : ''}</td><td>{event.authorizedGroupId}</td><td>{new Date(event.timestamp * 1000).toLocaleString()}</td></tr>)}</tbody></table></div> : undefined}
    </DataTableShell>
    {nextCursor && <ConsoleButton className="secondary-action" onClick={() => void loadMore()}>Load more</ConsoleButton>}
    {selected && <ConsoleDialog open onOpenChange={(open) => { if (!open) setSelected(null); }} title="Activity event" footer={<ConsoleButton onClick={() => setSelected(null)}>Close</ConsoleButton>}><dl><div><dt>Action</dt><dd>{selected.action}</dd></div><div><dt>Actor</dt><dd>{selected.actor ?? 'System'}</dd></div><div><dt>Target</dt><dd>{selected.targetType ?? '—'}{selected.targetId ? ` / ${selected.targetId}` : ''}</dd></div><div><dt>Group</dt><dd>{selected.authorizedGroupId}</dd></div><div><dt>Request</dt><dd>{selected.requestId ?? '—'}</dd></div></dl>{selected.metadata !== null && <pre aria-label="Redacted event metadata">{JSON.stringify(selected.metadata, null, 2)}</pre>}</ConsoleDialog>}
  </div>;
}
