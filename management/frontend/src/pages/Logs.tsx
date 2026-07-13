import { useEffect, useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import { ApiClient } from '../api/client';
import type { ConversationDetailDto, ConversationSummary } from '../api/types';
import { ConversationDetail } from '../components/ConversationDetail';
import { DataTableShell } from '../components/DataTableShell';
import { DatePickerField } from '../components/DatePickerField';
import { ConsoleButton, ConsoleDialog, ConsoleSelect, ConsoleTextField } from '../components/console';
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
        ? <ConsoleButton variant="secondary" onClick={() => setConfirmExport(true)}><Download />Export CSV</ConsoleButton>
        : undefined}
    />
    <DataTableShell label="Conversation logs" controls={<div className="filter-stack">
      <div className="filter-row">
        <ConsoleTextField label="Search conversations" value={search} onChange={setSearch} placeholder="Search loaded results" />
        <ConsoleTextField label="Learner" value={learner} onChange={setLearner} placeholder="Learner ID" />
        <ConsoleSelect label="Descendant group" selectedKey={group} onSelectionChange={setGroup} placeholder="Selected group and descendants" options={scope.status === 'ready' ? scope.groups.map((candidate) => ({ key: candidate.id, label: candidate.name })) : []} />
        <ConsoleTextField label="Provider" value={provider} onChange={setProvider} placeholder="Provider ID" />
        <ConsoleTextField label="Model" value={model} onChange={setModel} placeholder="Model ID" />
      </div>
      <div className="filter-row">
        <DatePickerField label="From date" value={from} onChange={setFrom} />
        <DatePickerField label="To date" value={to} onChange={setTo} />
        <ConsoleSelect label="Conversation status" selectedKey={status} onSelectionChange={setStatus} placeholder="All statuses" options={[{ key: 'completed', label: 'Completed' }, { key: 'failed', label: 'Failed' }, { key: 'truncated', label: 'Truncated' }, { key: 'policy-blocked', label: 'Policy blocked' }]} />
      </div>
    </div>}>
      {filtered.length ? <div className="table-scroll"><table><caption className="sr-only">Conversation logs</caption><thead><tr><th>Learner</th><th>Group</th><th>Provider / model</th><th>Status</th><th>Tokens</th><th>Cost</th><th>Started</th></tr></thead><tbody>{filtered.map((item) => <tr key={item.id}><th><ConsoleButton variant="ghost" onClick={() => void open(item.id)}>{item.learnerUserId}</ConsoleButton></th><td>{item.groupId}</td><td>{item.providerId} / {item.modelId}</td><td>{item.status}</td><td>{(item.inputTokens ?? 0) + (item.outputTokens ?? 0)}</td><td>{((item.costMicros ?? 0) / 1_000_000).toFixed(4)}</td><td>{new Date(item.createdAt * 1000).toLocaleString()}</td></tr>)}</tbody></table></div> : undefined}
    </DataTableShell>
    {detail && <ConversationDetail detail={detail} onClose={() => setDetail(null)} />}
    <ConsoleDialog open={confirmExport} onOpenChange={setConfirmExport} title="Export conversations?" footer={<><ConsoleButton onClick={() => setConfirmExport(false)}>Cancel</ConsoleButton><ConsoleButton onClick={exportCsv}>Confirm export</ConsoleButton></>}><p>The effective school policy must allow this export. The scoped export is recorded in the audit log.</p></ConsoleDialog>
  </div>;
}
