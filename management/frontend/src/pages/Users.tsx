import { useEffect, useMemo, useState } from 'react';
import { Search, UserPlus } from 'lucide-react';
import { ApiClient } from '../api/client';
import type { ScopedManagedUser } from '../api/types';
import { CsvImportDialog } from '../components/CsvImportDialog';
import { DataTableShell } from '../components/DataTableShell';
import { PageToolbar } from '../components/PageToolbar';
import { useGroupScope } from '../groups/GroupScopeProvider';

const api = new ApiClient();
interface UserDetail { user: ScopedManagedUser; memberships: Array<{id:string;groupId:string;groupName:string;status:string}>; devices: Array<{id:string;name:string;platform:string;createdAt:number;lastSeenAt:number}>; sessions: Array<{id:string;expiresAt:number;revokedAt:number|null;createdAt:number;lastSeenAt:number;activeGroupId:string|null}> }

export default function Users() {
  const scope = useGroupScope();
  const groupId = scope.status === 'ready' ? scope.selectedGroup?.id : null;
  const [users, setUsers] = useState<ScopedManagedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [invitationSecret, setInvitationSecret] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createEmail, setCreateEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [identityType, setIdentityType] = useState('learner');
  const [detail, setDetail] = useState<UserDetail | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);

  useEffect(() => {
    setUsers([]); setError(null); setDetail(null);
    if (!groupId) { setLoading(false); return; }
    const controller = new AbortController();
    setLoading(true);
    api.get<{ users: ScopedManagedUser[]; nextCursor?: string | null }>(`/api/users?groupId=${encodeURIComponent(groupId)}`, { signal: controller.signal })
      .then((result) => { if (!controller.signal.aborted) { setUsers(result.users); setNextCursor(result.nextCursor ?? null); } })
      .catch((caught) => { if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : 'Users could not be loaded'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [groupId, revision]);

  const filtered = useMemo(() => users.filter((user) => `${user.displayName} ${user.email} ${user.identityType} ${user.status}`.toLowerCase().includes(search.trim().toLowerCase()) && (!typeFilter || user.identityType === typeFilter) && (!statusFilter || user.status === statusFilter)), [search, statusFilter, typeFilter, users]);
  const loadMore = async () => {
    if (!groupId || !nextCursor) return;
    const result = await api.get<{ users: ScopedManagedUser[]; nextCursor: string | null }>(`/api/users?groupId=${encodeURIComponent(groupId)}&cursor=${encodeURIComponent(nextCursor)}`);
    setUsers((items) => [...items, ...result.users]); setNextCursor(result.nextCursor);
  };
  const openUser = async (user: ScopedManagedUser) => { if (groupId) setDetail(await api.get<UserDetail>(`/api/users/${encodeURIComponent(user.id)}?groupId=${encodeURIComponent(groupId)}`)); };
  const createUser = async () => {
    if (!groupId) return;
    const created = await api.get<ScopedManagedUser>('/api/users', { method: 'POST', body: JSON.stringify({ groupId, email: createEmail.trim(), displayName: displayName.trim(), identityType, idempotencyKey: crypto.randomUUID() }) });
    setUsers((items) => [created, ...items]); setCreateOpen(false); setCreateEmail(''); setDisplayName('');
  };
  const invite = async () => {
    if (!groupId) return;
    setMutationError(null);
    try { const invitation = await api.get<{ secret: string }>(`/api/groups/${encodeURIComponent(groupId)}/provisioning/invitations`, { method: 'POST', body: JSON.stringify({ email: inviteEmail.trim(), identityType: 'learner', capabilities: [], expiresAt: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60 }) }); setInvitationSecret(invitation.secret); }
    catch (caught) { setMutationError(caught instanceof Error ? caught.message : 'Invitation could not be created'); }
  };
  const revokeSession = async (sessionId: string) => {
    if (!groupId || !detail) return;
    await api.get(`/api/users/${encodeURIComponent(detail.user.id)}/sessions/${encodeURIComponent(sessionId)}?groupId=${encodeURIComponent(groupId)}`, { method: 'DELETE' });
    setDetail({ ...detail, sessions: detail.sessions.map((session) => session.id === sessionId ? { ...session, revokedAt: Date.now() / 1000 } : session) });
  };
  const toggleStatus = async () => {
    if (!groupId || !detail) return;
    const status = detail.user.status === 'active' ? 'suspended' : 'active';
    const user = await api.get<ScopedManagedUser>(`/api/users/${encodeURIComponent(detail.user.id)}/status?groupId=${encodeURIComponent(groupId)}`, { method: 'PATCH', body: JSON.stringify({ status }) });
    setDetail({ ...detail, user }); setUsers((items) => items.map((item) => item.id === user.id ? user : item));
  };

  const canManage = groupId && scope.status === 'ready' && scope.can('members.manage');
  return <div className="resource-page">
    <PageToolbar title="Users" description="Accounts, sessions, devices, and memberships in the selected group and its descendants." actions={canManage ? <><CsvImportDialog groupId={groupId} onImported={() => setRevision((value) => value + 1)} /><button className="secondary-action" onClick={() => setInviteOpen(true)}>Invite user</button><button className="primary-action" onClick={() => setCreateOpen(true)}><UserPlus />Create user</button></> : undefined} />
    <DataTableShell label="Managed users" loading={loading} error={error ?? undefined} onRetry={() => setRevision((value) => value + 1)} controls={<div className="filter-row"><label className="search-field"><Search /><span className="sr-only">Search users</span><input placeholder="Search users" value={search} onChange={(event) => setSearch(event.currentTarget.value)} /></label><select aria-label="Identity type filter" value={typeFilter} onChange={(event) => setTypeFilter(event.currentTarget.value)}><option value="">All identity types</option><option value="admin">Administrators</option><option value="teacher">Teachers</option><option value="learner">Learners</option></select><select aria-label="Status filter" value={statusFilter} onChange={(event) => setStatusFilter(event.currentTarget.value)}><option value="">All statuses</option><option value="active">Active</option><option value="suspended">Suspended</option></select></div>}>
      {filtered.length ? <div className="table-scroll"><table><caption className="sr-only">Managed users</caption><thead><tr><th>User</th><th>Type</th><th>Status</th><th>Groups</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{filtered.map((user) => <tr key={user.id}><th><strong>{user.displayName}</strong><small>{user.email}</small></th><td>{user.identityType}</td><td>{user.status}</td><td>{user.groupIds.length}</td><td><button className="table-link" onClick={() => void openUser(user)}>Open {user.displayName}</button></td></tr>)}</tbody></table></div> : undefined}
      {nextCursor && <div className="table-controls"><button className="secondary-action" onClick={() => void loadMore()}>Load more users</button></div>}
    </DataTableShell>
    {createOpen && <Dialog title="Create user" onClose={() => setCreateOpen(false)}><label>User email<input aria-label="User email" type="email" value={createEmail} onChange={(event) => setCreateEmail(event.currentTarget.value)} /></label><label>Display name<input aria-label="Display name" value={displayName} onChange={(event) => setDisplayName(event.currentTarget.value)} /></label><label>Identity type<select aria-label="Identity type" value={identityType} onChange={(event) => setIdentityType(event.currentTarget.value)}><option value="learner">Learner</option><option value="teacher">Teacher</option><option value="admin">Administrator</option></select></label><footer><button onClick={() => setCreateOpen(false)}>Cancel</button><button disabled={!createEmail.trim() || !displayName.trim()} onClick={() => void createUser()}>Create account</button></footer></Dialog>}
    {inviteOpen && <Dialog title="Invite user" onClose={() => { setInviteOpen(false); setInvitationSecret(null); }}><p>Create a one-time governed invitation for this group.</p>{invitationSecret ? <><p>Copy this secret now. It will not be shown again.</p><code>{invitationSecret}</code><footer><button onClick={() => { setInviteOpen(false); setInvitationSecret(null); }}>Done</button></footer></> : <><label>Email address<input type="email" aria-label="Invitation email" value={inviteEmail} onChange={(event) => setInviteEmail(event.currentTarget.value)} /></label>{mutationError && <p role="alert">{mutationError}</p>}<footer><button onClick={() => setInviteOpen(false)}>Cancel</button><button disabled={!inviteEmail.trim()} onClick={() => void invite()}>Create invitation</button></footer></>}</Dialog>}
    {detail && <Dialog title={detail.user.displayName} onClose={() => setDetail(null)} wide><p>{detail.user.email} · {detail.user.identityType} · {detail.user.status}</p><section><h3>Memberships</h3>{detail.memberships.map((membership) => <div className="gateway-item" key={membership.id}><strong>{membership.groupName}</strong><span>{membership.status}</span></div>)}</section><section><h3>Devices</h3>{detail.devices.map((device) => <div className="gateway-item" key={device.id}><strong>{device.name} · {device.platform}</strong><span>Last seen {new Date(device.lastSeenAt * 1000).toLocaleString()}</span></div>)}</section><section><h3>Sessions</h3>{detail.sessions.map((session) => <div className="gateway-item" key={session.id}><strong>{session.id}</strong><span>{session.revokedAt ? 'Revoked' : `Active until ${new Date(session.expiresAt * 1000).toLocaleString()}`}</span>{!session.revokedAt && canManage && <button className="table-link" onClick={() => void revokeSession(session.id)}>Revoke session {session.id}</button>}</div>)}</section>{canManage && <footer><button onClick={() => setDetail(null)}>Close</button><button onClick={() => void toggleStatus()}>{detail.user.status === 'active' ? 'Suspend user' : 'Reactivate user'}</button></footer>}</Dialog>}
  </div>;
}

function Dialog({ title, onClose, wide = false, children }: { title: string; onClose(): void; wide?: boolean; children: React.ReactNode }) {
  return <div className="dialog-backdrop"><section role="dialog" aria-modal="true" aria-label={title} className={`console-dialog ${wide ? 'conversation-detail' : ''}`}><header><h2>{title}</h2><button aria-label={`Close ${title}`} onClick={onClose}>×</button></header>{children}</section></div>;
}
