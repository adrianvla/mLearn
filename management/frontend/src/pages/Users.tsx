import {
  Card,
  CardContent,
  CardHeader,
  Chip,
  Table,
  TableHeader,
  TableColumn,
  TableBody,
  TableRow,
  TableCell,
} from '@heroui/react';
import { Users as UsersIcon, Lock, Ban } from 'lucide-react';
import { useApi, api } from '../hooks/useApi';
import { PageContainer, PageHeader, LoadingState, ErrorState } from '../components/shared';
import type { UsersDto, ManagedUser } from '../api/types';

const ROLE_COLOR: Record<ManagedUser['role'], 'danger' | 'warning' | 'primary'> = {
  admin: 'danger',
  teacher: 'warning',
  learner: 'primary',
};

const STATUS_COLOR: Record<ManagedUser['status'], 'success' | 'warning' | 'danger'> = {
  active: 'success',
  restricted: 'warning',
  disabled: 'danger',
};

function formatLastSeen(iso: string | null): string {
  if (iso === null) return 'never';
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return 'never';
  return parsed.toLocaleString();
}

export default function Users() {
  const { data, loading, error } = useApi<UsersDto>(() => api.getUsers());

  return (
    <PageContainer>
      <PageHeader title="Users" subtitle="Managed users, policy presets, and enforced settings" />

      {loading && <LoadingState />}
      {error && <ErrorState message={error} />}

      {data && (
        <div className="space-y-4">
          <Card>
            <CardHeader className="flex items-center gap-3 pb-0">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent text-accent">
                <UsersIcon className="h-5 w-5" />
              </span>
              <div className="flex-1">
                <h2 className="text-base font-semibold text-foreground">Users</h2>
                <p className="text-xs text-muted">Accounts managed by this deployment</p>
              </div>
              <Chip size="sm" variant="flat">
                {data.users.length}
              </Chip>
            </CardHeader>
            <CardContent className="pt-4">
              <table className="w-full border-collapse text-sm">
                <thead className="border-b border-border">
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted">NAME</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted">ROLE</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted">STATUS</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted">POLICY</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted">DEVICES</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted">LAST SEEN</th>
                </thead>
                <tbody>
                  {(user) => (
                    <tr key={user.id}>
                      <td>
                        <span className="font-medium text-foreground">{user.display_name}</span>
                      </td>
                      <td>
                        <Chip size="sm" variant="flat" color={ROLE_COLOR[user.role]}>
                          {user.role}
                        </Chip>
                      </td>
                      <td>
                        <Chip size="sm" variant="flat" color={STATUS_COLOR[user.status]}>
                          {user.status}
                        </Chip>
                      </td>
                      <td>
                        <span className="text-foreground">{user.policy}</span>
                      </td>
                      <td>
                        <span className="tabular-nums text-foreground">{user.devices}</span>
                      </td>
                      <td>
                        <span className="text-muted">{formatLastSeen(user.last_seen)}</span>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex items-center gap-3 pb-0">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent text-accent">
                <Lock className="h-5 w-5" />
              </span>
              <div className="flex-1">
                <h2 className="text-base font-semibold text-foreground">Policy Presets</h2>
                <p className="text-xs text-muted">Reusable configuration templates</p>
              </div>
              <Chip size="sm" variant="flat">
                {data.policy_presets.length}
              </Chip>
            </CardHeader>
            <CardContent className="pt-4">
              <table className="w-full border-collapse text-sm">
                <thead className="border-b border-border">
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted">NAME</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted">DESCRIPTION</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted">USERS</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted">LOCKED SETTINGS</th>
                </thead>
                <tbody>
                  {(preset) => (
                    <tr key={preset.id}>
                      <td>
                        <span className="font-medium text-foreground">{preset.name}</span>
                      </td>
                      <td>
                        <span className="text-foreground">{preset.description}</span>
                      </td>
                      <td>
                        <span className="tabular-nums text-foreground">{preset.user_count}</span>
                      </td>
                      <td>
                        {preset.locked_settings.length === 0 ? (
                          <span className="text-muted">—</span>
                        ) : (
                          <div className="flex flex-wrap gap-1.5">
                            {preset.locked_settings.map((setting) => (
                              <Chip key={setting} size="sm" variant="flat" color="warning">
                                {setting}
                              </Chip>
                            ))}
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex items-center gap-3 pb-0">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-danger-100 text-danger">
                <Ban className="h-5 w-5" />
              </span>
              <div className="flex-1">
                <h2 className="text-base font-semibold text-foreground">Blocked Settings</h2>
                <p className="text-xs text-muted">Hard-enforced configuration overrides</p>
              </div>
              <Chip size="sm" variant="flat">
                {data.blocked_settings.length}
              </Chip>
            </CardHeader>
            <CardContent className="pt-4">
              <table className="w-full border-collapse text-sm">
                <thead className="border-b border-border">
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted">SETTING</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted">LABEL</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted">SCOPE</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted">REASON</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted">ENFORCED VALUE</th>
                </thead>
                <tbody>
                  {(rule) => (
                    <tr key={rule.id}>
                      <td>
                        <code className="rounded bg-default px-1.5 py-0.5 font-mono text-xs text-foreground">
                          {rule.setting_key}
                        </code>
                      </td>
                      <td>
                        <span className="font-medium text-foreground">{rule.label}</span>
                      </td>
                      <td>
                        <Chip size="sm" variant="flat">
                          {rule.scope}
                        </Chip>
                      </td>
                      <td>
                        <span className="text-muted">{rule.reason}</span>
                      </td>
                      <td>
                        {rule.enforced_value === null ? (
                          <span className="text-muted">—</span>
                        ) : (
                          <span className="font-medium text-foreground">{rule.enforced_value}</span>
                        )}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </div>
      )}
    </PageContainer>
  );
}
