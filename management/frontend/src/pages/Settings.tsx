import { useEffect, useState } from 'react';
import { Link } from '@heroui/react';
import { ApiClient } from '../api/client';
import type { GroupNode } from '../api/types';
import { useAuth } from '../auth/AuthProvider';
import { PageToolbar } from '../components/PageToolbar';
import { DatePickerField } from '../components/DatePickerField';
import { ConsoleButton, ConsoleTextField } from '../components/console';
import Config from './Config';

const api = new ApiClient();

export default function Settings() {
  const auth = useAuth();
  const root = auth.status === 'authenticated' && auth.user.isRoot;
  return <div className="resource-page">
    <PageToolbar title="Settings" description="School identity, deployment endpoints, retention, security, and backup guidance." actions={root ? <Link href="/settings/diagnostics">Open Diagnostics</Link> : undefined} />
    <section className="gateway-grid" aria-label="School settings">
      <article className="dashboard-panel"><h2>School identity</h2><p>The root group is the canonical school identity. Rename it and manage its hierarchy from Groups.</p><Link href="/groups">Manage school group</Link></article>
      <article className="dashboard-panel"><h2>Timezone and term calendar</h2>{root ? <RootCalendarSettings /> : <p>Quota periods use the root-group timezone and authoritative term boundaries configured by a root administrator.</p>}</article>
      <article className="dashboard-panel"><h2>Retention and security</h2><p>Conversation retention, analytics retention, exports, model access, and hard-deny settings inherit through signed policies.</p><Link href="/policies">Review retention controls</Link></article>
      <article className="dashboard-panel"><h2>Endpoint guidance</h2><p>Expose the console only through TLS, keep the management token out of browser storage, and use desktop approval for local clients.</p></article>
      <article className="dashboard-panel"><h2>Backups</h2><p>Back up the management database, policy signing key, secret-encryption key, and configured storage volumes together. Test restoration before each term.</p>{root ? <Link href="/settings/diagnostics">Inspect storage</Link> : null}</article>
    </section>
    <Config />
  </div>;
}

function RootCalendarSettings() {
  const [rootGroupId, setRootGroupId] = useState<string | null>(null);
  const [timezone, setTimezone] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
  const [termStarts, setTermStarts] = useState('');
  const [termEnds, setTermEnds] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    api.get<{ groups: GroupNode[] }>('/api/groups', { signal: controller.signal }).then(({ groups }) => {
      if (!controller.signal.aborted) setRootGroupId(groups.find((group) => group.parentId === null)?.id ?? null);
    }).catch(() => { if (!controller.signal.aborted) setStatus('Unable to load the school root.'); });
    return () => controller.abort();
  }, []);
  const save = async () => {
    if (!rootGroupId) return;
    setStatus(null);
    try {
      await api.get('/api/llm/quota-calendar', { method: 'PUT', body: JSON.stringify({ rootGroupId, timezone, termStartsAt: Date.parse(`${termStarts}T00:00:00Z`) / 1000, termEndsAt: Date.parse(`${termEnds}T00:00:00Z`) / 1000 }) });
      setStatus('School calendar saved. New quota periods use these authoritative boundaries.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'School calendar update failed.');
    }
  };
  return <div className="settings-form"><p>Changing an active calendar schedules the next term safely when accounting data already exists.</p><ConsoleTextField label="School timezone" value={timezone} onChange={setTimezone} placeholder="Europe/Zurich" /><DatePickerField label="Term starts" value={termStarts} onChange={setTermStarts} /><DatePickerField label="Term ends" value={termEnds} onChange={setTermEnds} /><ConsoleButton variant="primary" isDisabled={!rootGroupId || !timezone.trim() || !termStarts || !termEnds || termEnds <= termStarts} onClick={() => void save()}>Save school calendar</ConsoleButton>{status ? <p role="status">{status}</p> : null}</div>;
}
