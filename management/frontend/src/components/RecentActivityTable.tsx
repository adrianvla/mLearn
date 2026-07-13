import type { AuditEvent } from '../api/types';
import { DataTableShell } from './DataTableShell';

export function RecentActivityTable({ events, loading, error, onRetry }: { events: AuditEvent[]; loading?: boolean; error?: string; onRetry?: () => void }) {
  return <section aria-labelledby="recent-administrative-activity"><div className="section-heading"><h2 id="recent-administrative-activity">Recent administrative activity</h2><a href="/activity">View all activity</a></div><DataTableShell label="Recent administrative activity" loading={loading} error={error} onRetry={onRetry} empty="Administrative activity will appear here.">
    {events.length > 0 ? <div className="table-scroll"><table><caption className="sr-only">Recent administrative activity</caption><thead><tr><th>Action</th><th>Actor</th><th>Target</th><th>When</th></tr></thead><tbody>{events.map((event) => <tr key={event.id}><th>{event.action}</th><td>{event.actor ?? 'System'}</td><td>{event.targetType ?? '—'}{event.targetId ? ` / ${event.targetId}` : ''}</td><td>{new Date(event.timestamp * 1000).toLocaleString()}</td></tr>)}</tbody></table></div> : undefined}
  </DataTableShell></section>;
}
