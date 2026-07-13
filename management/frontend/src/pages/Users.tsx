import { useEffect, useMemo, useState } from "react";
import { UserPlus } from "lucide-react";
import { Tabs } from "@heroui/react";
import { ApiClient } from "../api/client";
import type { ScopedManagedUser, UserDailyActivity } from "../api/types";
import { HistoricalChart } from "../components/charts/HistoricalChart";
import type { ChartSeries } from "../components/charts/chartTypes";
import { CsvImportDialog } from "../components/CsvImportDialog";
import { DataTableShell } from "../components/DataTableShell";
import { PageToolbar } from "../components/PageToolbar";
import { ConsoleButton, ConsoleDialog, ConsoleSelect, ConsoleTextField } from "../components/console";
import { useGroupScope } from "../groups/GroupScopeProvider";
import { AnalyticsHistoryTable } from "./analytics/AnalyticsHistoryTable";

const api = new ApiClient();
interface UserUsage {
  sessions: number;
  totalTokens: number;
  costMicros: number;
  policyBlocks: number;
  quotaRemaining: number | undefined;
}
interface UserDetail {
  user: ScopedManagedUser;
  memberships: Array<{
    id: string;
    groupId: string;
    groupName: string;
    status: string;
  }>;
  devices: Array<{
    id: string;
    name: string;
    platform: string;
    createdAt: number;
    lastSeenAt: number;
  }>;
  sessions: Array<{
    id: string;
    expiresAt: number;
    revokedAt: number | null;
    createdAt: number;
    lastSeenAt: number;
    activeGroupId: string | null;
  }>;
  usage?: UserUsage;
  activity?: UserDailyActivity[];
}

export default function Users() {
  const scope = useGroupScope();
  const groupId = scope.status === "ready" ? scope.selectedGroup?.id : null;
  const [users, setUsers] = useState<ScopedManagedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [invitationSecret, setInvitationSecret] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createEmail, setCreateEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [identityType, setIdentityType] = useState("learner");
  const [detail, setDetail] = useState<UserDetail | null>(null);
  const [detailTab, setDetailTab] = useState<"profile" | "activity">("profile");
  const [mutationError, setMutationError] = useState<string | null>(null);

  useEffect(() => {
    setUsers([]);
    setError(null);
    setDetail(null);
    if (!groupId) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    api
      .get<{ users: ScopedManagedUser[]; nextCursor?: string | null }>(
        `/api/users?groupId=${encodeURIComponent(groupId)}`,
        { signal: controller.signal },
      )
      .then((result) => {
        if (!controller.signal.aborted) {
          setUsers(result.users);
          setNextCursor(result.nextCursor ?? null);
        }
      })
      .catch((caught) => {
        if (!controller.signal.aborted)
          setError(
            caught instanceof Error
              ? caught.message
              : "Users could not be loaded",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [groupId, revision]);

  const filtered = useMemo(
    () =>
      users.filter(
        (user) =>
          `${user.displayName} ${user.email} ${user.identityType} ${user.status}`
            .toLowerCase()
            .includes(search.trim().toLowerCase()) &&
          (!typeFilter || user.identityType === typeFilter) &&
          (!statusFilter || user.status === statusFilter),
      ),
    [search, statusFilter, typeFilter, users],
  );
  const loadMore = async () => {
    if (!groupId || !nextCursor) return;
    const result = await api.get<{
      users: ScopedManagedUser[];
      nextCursor: string | null;
    }>(
      `/api/users?groupId=${encodeURIComponent(groupId)}&cursor=${encodeURIComponent(nextCursor)}`,
    );
    setUsers((items) => [...items, ...result.users]);
    setNextCursor(result.nextCursor);
  };
  const openUser = async (user: ScopedManagedUser) => {
    if (!groupId) return;
    const to = Date.now();
    const [nextDetail, analytics, quota, activity] = await Promise.all([
      api.get<UserDetail>(`/api/users/${encodeURIComponent(user.id)}?groupId=${encodeURIComponent(groupId)}`),
      api.get<{ items: Array<{ learnerId: string; sessions: number; totalTokens: number; costMicros: number; policyBlocks: number }> }>(`/api/analytics/learners?groupId=${encodeURIComponent(groupId)}&limit=100`).catch(() => ({ items: [] })),
      api.get<{ buckets: Array<{ scopeKind: string; scopeId: string; remaining: number | null }> }>(`/api/llm/usage?groupId=${encodeURIComponent(groupId)}`).catch(() => ({ buckets: [] })),
      api.get<UserDailyActivity[]>(`/api/analytics/users/${encodeURIComponent(user.id)}/history?groupId=${encodeURIComponent(groupId)}&from=${to - 30 * 86_400_000}&to=${to}`).catch(() => []),
    ]);
    const learner = analytics.items.find((item) => item.learnerId === user.id);
    const remaining = quota.buckets
      .filter((item) => item.scopeKind === "user" && item.scopeId === user.id)
      .map((item) => item.remaining)
      .filter((value): value is number => value !== null);
    setDetail({
      ...nextDetail,
      usage: learner ? {
        sessions: learner.sessions,
        totalTokens: learner.totalTokens,
        costMicros: learner.costMicros,
        policyBlocks: learner.policyBlocks,
        quotaRemaining: remaining.length ? Math.min(...remaining) : undefined,
      } : undefined,
      activity,
    });
    setDetailTab("profile");
  };
  const createUser = async () => {
    if (!groupId) return;
    const created = await api.get<ScopedManagedUser>("/api/users", {
      method: "POST",
      body: JSON.stringify({
        groupId,
        email: createEmail.trim(),
        displayName: displayName.trim(),
        identityType,
        idempotencyKey: crypto.randomUUID(),
      }),
    });
    setUsers((items) => [created, ...items]);
    setCreateOpen(false);
    setCreateEmail("");
    setDisplayName("");
  };
  const invite = async () => {
    if (!groupId) return;
    setMutationError(null);
    try {
      const invitation = await api.get<{ secret: string }>(
        `/api/groups/${encodeURIComponent(groupId)}/provisioning/invitations`,
        {
          method: "POST",
          body: JSON.stringify({
            email: inviteEmail.trim(),
            identityType: "learner",
            capabilities: [],
            expiresAt: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60,
          }),
        },
      );
      setInvitationSecret(invitation.secret);
    } catch (caught) {
      setMutationError(
        caught instanceof Error
          ? caught.message
          : "Invitation could not be created",
      );
    }
  };
  const revokeSession = async (sessionId: string) => {
    if (!groupId || !detail) return;
    await api.get(
      `/api/users/${encodeURIComponent(detail.user.id)}/sessions/${encodeURIComponent(sessionId)}?groupId=${encodeURIComponent(groupId)}`,
      { method: "DELETE" },
    );
    setDetail({
      ...detail,
      sessions: detail.sessions.map((session) =>
        session.id === sessionId
          ? { ...session, revokedAt: Date.now() / 1000 }
          : session,
      ),
    });
  };
  const toggleStatus = async () => {
    if (!groupId || !detail) return;
    const status = detail.user.status === "active" ? "suspended" : "active";
    const user = await api.get<ScopedManagedUser>(
      `/api/users/${encodeURIComponent(detail.user.id)}/status?groupId=${encodeURIComponent(groupId)}`,
      { method: "PATCH", body: JSON.stringify({ status }) },
    );
    setDetail((current) => current ? { ...current, user } : current);
    setUsers((items) =>
      items.map((item) => (item.id === user.id ? user : item)),
    );
  };

  const canManage =
    groupId && scope.status === "ready" && scope.can("members.manage");
  return (
    <div className="resource-page">
      <PageToolbar
        title="Users"
        description="Accounts, sessions, devices, and memberships in the selected group and its descendants."
        actions={
          canManage ? (
            <>
              <CsvImportDialog
                groupId={groupId}
                onImported={() => setRevision((value) => value + 1)}
              />
              <ConsoleButton
                onClick={() => setInviteOpen(true)}
              >
                Invite user
              </ConsoleButton>
              <ConsoleButton
                variant="primary"
                onClick={() => setCreateOpen(true)}
              >
                <UserPlus />
                Create user
              </ConsoleButton>
            </>
          ) : undefined
        }
      />
      <DataTableShell
        label="Managed users"
        loading={loading}
        error={error ?? undefined}
        onRetry={() => setRevision((value) => value + 1)}
        controls={
          <div className="filter-row">
            <ConsoleTextField label="Search users" placeholder="Search users" type="search" value={search} onChange={setSearch} />
            <ConsoleSelect label="Identity type filter" selectedKey={typeFilter} onSelectionChange={setTypeFilter} options={[{key:'',label:'All identity types'},{key:'admin',label:'Administrators'},{key:'teacher',label:'Teachers'},{key:'learner',label:'Learners'}]} />
            <ConsoleSelect label="Status filter" selectedKey={statusFilter} onSelectionChange={setStatusFilter} options={[{key:'',label:'All statuses'},{key:'active',label:'Active'},{key:'suspended',label:'Suspended'}]} />
          </div>
        }
      >
        {filtered.length ? (
          <div className="table-scroll">
            <table>
              <caption className="sr-only">Managed users</caption>
              <thead>
                <tr>
                  <th>User</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th>Groups</th>
                  <th>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((user) => (
                  <tr key={user.id}>
                    <th>
                      <strong>{user.displayName}</strong>
                      <small>{user.email}</small>
                    </th>
                    <td>{user.identityType}</td>
                    <td>{user.status}</td>
                    <td>{user.groupIds.length}</td>
                    <td>
                      <ConsoleButton
                        variant="ghost"
                        onClick={() => void openUser(user)}
                      >
                        Open {user.displayName}
                      </ConsoleButton>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : undefined}
        {nextCursor && (
          <div className="table-controls">
            <ConsoleButton
              onClick={() => void loadMore()}
            >
              Load more users
            </ConsoleButton>
          </div>
        )}
      </DataTableShell>
      <ConsoleDialog open={createOpen} onOpenChange={setCreateOpen} title="Create user" footer={<><ConsoleButton onClick={() => setCreateOpen(false)}>Cancel</ConsoleButton><ConsoleButton variant="primary" isDisabled={!createEmail.trim() || !displayName.trim()} onClick={() => void createUser()}>Create account</ConsoleButton></>}>
        <ConsoleTextField label="User email" type="email" value={createEmail} onChange={setCreateEmail} />
        <ConsoleTextField label="Display name" value={displayName} onChange={setDisplayName} />
        <ConsoleSelect label="Identity type" selectedKey={identityType} onSelectionChange={setIdentityType} options={[{key:'learner',label:'Learner'},{key:'teacher',label:'Teacher'},{key:'admin',label:'Administrator'}]} />
      </ConsoleDialog>
      <ConsoleDialog open={inviteOpen} onOpenChange={(open) => { setInviteOpen(open); if (!open) setInvitationSecret(null); }} title="Invite user" footer={invitationSecret ? <ConsoleButton variant="primary" onClick={() => { setInviteOpen(false); setInvitationSecret(null); }}>Done</ConsoleButton> : <><ConsoleButton onClick={() => setInviteOpen(false)}>Cancel</ConsoleButton><ConsoleButton variant="primary" isDisabled={!inviteEmail.trim()} onClick={() => void invite()}>Create invitation</ConsoleButton></>}>
          <p>Create a one-time governed invitation for this group.</p>
          {invitationSecret ? (
            <>
              <p>Copy this secret now. It will not be shown again.</p>
              <code>{invitationSecret}</code>
            </>
          ) : (
            <>
              <ConsoleTextField label="Invitation email" type="email" value={inviteEmail} onChange={setInviteEmail} />
              {mutationError && <p role="alert">{mutationError}</p>}
            </>
          )}
        </ConsoleDialog>
      <ConsoleDialog open={detail !== null} onOpenChange={(open) => { if (!open) setDetail(null); }} title={detail?.user.displayName ?? "User detail"} footer={detail && canManage ? <><ConsoleButton onClick={() => setDetail(null)}>Close</ConsoleButton><ConsoleButton variant="primary" onClick={() => void toggleStatus()}>{detail.user.status === "active" ? "Suspend user" : "Reactivate user"}</ConsoleButton></> : undefined}>
        {detail && <>
          <p>
            {detail.user.email} · {detail.user.identityType} ·{" "}
            {detail.user.status}
          </p>
          <Tabs selectedKey={detailTab} onSelectionChange={(key) => setDetailTab(String(key) as "profile" | "activity")}><Tabs.ListContainer className="detail-tabs"><Tabs.List aria-label="User detail"><Tabs.Tab id="profile">Profile</Tabs.Tab><Tabs.Tab id="activity">Activity</Tabs.Tab></Tabs.List></Tabs.ListContainer></Tabs>
          {detailTab === "profile" && <>
          {detail.usage && (
            <section>
              <h3>Usage summary</h3>
              <div className="metric-grid compact-metrics">
                <div><strong>{detail.usage.sessions}</strong><span>Sessions</span></div>
                <div><strong>{detail.usage.totalTokens.toLocaleString()}</strong><span>Tokens</span></div>
                <div><strong>{(detail.usage.costMicros / 1_000_000).toFixed(4)}</strong><span>Cost</span></div>
                <div><strong>{detail.usage.policyBlocks}</strong><span>Policy blocks</span></div>
                <div><strong>{detail.usage.quotaRemaining === undefined ? "Governed" : `${detail.usage.quotaRemaining} remaining`}</strong><span>Individual quota</span></div>
              </div>
            </section>
          )}
          <section>
            <h3>Memberships</h3>
            {detail.memberships.map((membership) => (
              <div className="gateway-item" key={membership.id}>
                <strong>{membership.groupName}</strong>
                <span>{membership.status}</span>
              </div>
            ))}
          </section>
          <section>
            <h3>Devices</h3>
            {detail.devices.map((device) => (
              <div className="gateway-item" key={device.id}>
                <strong>
                  {device.name} · {device.platform}
                </strong>
                <span>
                  Last seen{" "}
                  {new Date(device.lastSeenAt * 1000).toLocaleString()}
                </span>
              </div>
            ))}
          </section>
          <section>
            <h3>Sessions</h3>
            {detail.sessions.map((session) => (
              <div className="gateway-item" key={session.id}>
                <strong>{session.id}</strong>
                <span>
                  {session.revokedAt
                    ? "Revoked"
                    : `Active until ${new Date(session.expiresAt * 1000).toLocaleString()}`}
                </span>
                {!session.revokedAt && canManage && (
                  <ConsoleButton
                    variant="ghost"
                    onClick={() => void revokeSession(session.id)}
                  >
                    Revoke session {session.id}
                  </ConsoleButton>
                )}
              </div>
            ))}
          </section>
          </>}
          {detailTab === "activity" && <UserActivityHistory activity={detail.activity ?? []} />}
        </>}
      </ConsoleDialog>
    </div>
  );
}

function UserActivityHistory({ activity }: { activity: UserDailyActivity[] }) {
  const series = toActivitySeries(activity);
  return <section aria-labelledby="user-activity-heading"><h3 id="user-activity-heading">Recorded daily activity</h3><p>Sessions, pages, video time, flashcard sessions, LLM usage, cost, and policy blocks recorded in the selected group scope.</p>{series.length === 0 ? <p role="status">No daily activity was recorded in this period.</p> : <><HistoricalChart title="Daily user activity chart" series={series} /><AnalyticsHistoryTable title="Daily user activity" series={series} /></>}</section>;
}

function toActivitySeries(activity: UserDailyActivity[]): ChartSeries[] {
  const values = <K extends keyof Omit<UserDailyActivity, "dayStart">>(key: K) => activity.map((day) => ({ start: day.dayStart, end: day.dayStart + 86_400_000, value: day[key], coverage: "complete" as const }));
  return [
    ["sessions", "Sessions", "sessions"], ["readerPages", "Reader pages", "readerPages"], ["videoSeconds", "Video seconds", "videoSeconds"], ["flashcardSessions", "Flashcard sessions", "flashcardSessions"], ["llmRequests", "LLM requests", "llmRequests"], ["costMicros", "Cost micros", "costMicros"], ["policyBlocks", "Policy blocks", "policyBlocks"],
  ].map(([key, label, field]) => ({ key, label, kind: "primary" as const, values: values(field as keyof Omit<UserDailyActivity, "dayStart">) }));
}
