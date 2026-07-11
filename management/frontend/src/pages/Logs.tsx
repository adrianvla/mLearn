import { useEffect, useMemo, useState } from 'react';
import { Download, Search } from 'lucide-react';
import { ApiClient } from '../api/client';
import type { ConversationDetailDto, ConversationSummary } from '../api/types';
import { ConversationDetail } from '../components/ConversationDetail';
import { DataTableShell } from '../components/DataTableShell';
import { PageToolbar } from '../components/PageToolbar';
import { useGroupScope } from '../groups/GroupScopeProvider';

const api = new ApiClient();

export default function Logs() {
  const scope = useGroupScope();
  const selectedGroupId = scope.status === 'ready' ? scope.selectedGroup?.id : null;
  const [items, setItems] = useState<ConversationSummary[]>([]);
  const [detail, setDetail] = useState<ConversationDetailDto | null>(null);
  const [search, setSearch] = useState('');
  const [learner, setLearner] = useState('');
  const [group, setGroup] = useState('');
  const [provider, setProvider] = useState('');
  const [model, setModel] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [status, setStatus] = useState('');
  const [confirmExport, setConfirmExport] = useState(false);

  const query = useMemo(() => {
    const groupId = group || selectedGroupId;
    if (!groupId) return null;
    const params = new URLSearchParams({ groupId, limit: '50' });
    if (learner) params.set('learnerUserId', learner);
    if (provider) params.set('providerId', provider);
    if (model) params.set('modelId', model);
    if (from) params.set('from', String(Date.parse(`${from}T00:00:00Z`) / 1000));
    if (to) params.set('to', String(Date.parse(`${to}T23:59:59Z`) / 1000));
    if (status === 'policy-blocked') params.set('policyBlocked', 'true');
    else if (status) params.set('status', status);
    return params;
  }, [from, group, learner, model, provider, selectedGroupId, status, to]);

  useEffect(() => {
    setItems([]);
    if (!query) return;
    const controller = new AbortController();
    api.get<{ items: ConversationSummary[] }>(`/api/conversations?${query}`, { signal: controller.signal })
      .then((page) => { if (!controller.signal.aborted) setItems(page.items); });
    return () => controller.abort();
  }, [query]);

  const open = async (id: string) => setDetail(await api.get<ConversationDetailDto>(`/api/conversations/${encodeURIComponent(id)}`));
  const filtered = items.filter((item) => `${item.learnerUserId} ${item.providerId} ${item.modelId}`.toLowerCase().includes(search.toLowerCase()));
  const exportCsv = () => {
    if (!query) return;
    const exportQuery = new URLSearchParams(query);
    exportQuery.set('limit', '100');
    window.location.assign(`/api/conversations/export.csv?${exportQuery}`);
  };

  return <div className="resource-page">
    <PageToolbar
      title="Conversation Logs"
      description="Encrypted governed conversations within the selected group and descendants."
      actions={scope.status === 'ready' && scope.can('conversations.export')
        ? <button className="secondary-action" onClick={() => setConfirmExport(true)}><Download />Export CSV</button>
        : undefined}
    />
    <DataTableShell label="Conversation logs" controls={<div className="filter-stack">
      <div className="filter-row">
        <label className="search-field"><Search /><input aria-label="Search conversations" value={search} onChange={(event) => setSearch(event.currentTarget.value)} placeholder="Search loaded results" /></label>
        <input aria-label="Learner" value={learner} onChange={(event) => setLearner(event.currentTarget.value)} placeholder="Learner ID" />
        <select aria-label="Descendant group" value={group} onChange={(event) => setGroup(event.currentTarget.value)}>
          <option value="">Selected group and descendants</option>
          {scope.status === 'ready' && scope.groups.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}
        </select>
        <input aria-label="Provider" value={provider} onChange={(event) => setProvider(event.currentTarget.value)} placeholder="Provider ID" />
        <input aria-label="Model" value={model} onChange={(event) => setModel(event.currentTarget.value)} placeholder="Model ID" />
      </div>
      <div className="filter-row">
        <label>From <input aria-label="From date" type="date" value={from} onChange={(event) => setFrom(event.currentTarget.value)} /></label>
        <label>To <input aria-label="To date" type="date" value={to} onChange={(event) => setTo(event.currentTarget.value)} /></label>
        <select aria-label="Conversation status" value={status} onChange={(event) => setStatus(event.currentTarget.value)}>
          <option value="">All statuses</option><option value="completed">Completed</option><option value="failed">Failed</option><option value="truncated">Truncated</option><option value="policy-blocked">Policy blocked</option>
        </select>
      </div>
    </div>}>
      {filtered.length ? <div className="table-scroll"><table><caption className="sr-only">Conversation logs</caption><thead><tr><th>Learner</th><th>Group</th><th>Provider / model</th><th>Status</th><th>Tokens</th><th>Cost</th><th>Started</th></tr></thead><tbody>{filtered.map((item) => <tr key={item.id}><th><button className="table-link" onClick={() => void open(item.id)}>{item.learnerUserId}</button></th><td>{item.groupId}</td><td>{item.providerId} / {item.modelId}</td><td>{item.status}</td><td>{(item.inputTokens ?? 0) + (item.outputTokens ?? 0)}</td><td>{((item.costMicros ?? 0) / 1_000_000).toFixed(4)}</td><td>{new Date(item.createdAt * 1000).toLocaleString()}</td></tr>)}</tbody></table></div> : undefined}
    </DataTableShell>
    {detail && <ConversationDetail detail={detail} onClose={() => setDetail(null)} />}
    {confirmExport && <div className="dialog-backdrop"><section role="dialog" aria-modal="true" aria-label="Export conversations?" className="console-dialog"><h2>Export conversations?</h2><p>The effective school policy must allow this export. The scoped export is recorded in the audit log.</p><footer><button onClick={() => setConfirmExport(false)}>Cancel</button><button onClick={exportCsv}>Confirm export</button></footer></section></div>}
  </div>;
}
