import {
  Card,
  CardBody,
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
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-100 text-primary">
                <UsersIcon className="h-5 w-5" />
              </span>
              <div className="flex-1">
                <h2 className="text-base font-semibold text-foreground">Users</h2>
                <p className="text-xs text-default-500">Accounts managed by this deployment</p>
              </div>
              <Chip size="sm" variant="flat">
                {data.users.length}
              </Chip>
            </CardHeader>
            <CardBody className="pt-4">
              <Table aria-label="Managed users" removeWrapper>
                <TableHeader>
                  <TableColumn>NAME</TableColumn>
                  <TableColumn>ROLE</TableColumn>
                  <TableColumn>STATUS</TableColumn>
                  <TableColumn>POLICY</TableColumn>
                  <TableColumn align="end">DEVICES</TableColumn>
                  <TableColumn>LAST SEEN</TableColumn>
                </TableHeader>
                <TableBody
                  items={data.users}
                  emptyContent="No managed users."
                >
                  {(user) => (
                    <TableRow key={user.id}>
                      <TableCell>
                        <span className="font-medium text-foreground">{user.display_name}</span>
                      </TableCell>
                      <TableCell>
                        <Chip size="sm" variant="flat" color={ROLE_COLOR[user.role]}>
                          {user.role}
                        </Chip>
                      </TableCell>
                      <TableCell>
                        <Chip size="sm" variant="flat" color={STATUS_COLOR[user.status]}>
                          {user.status}
                        </Chip>
                      </TableCell>
                      <TableCell>
                        <span className="text-default-600">{user.policy}</span>
                      </TableCell>
                      <TableCell>
                        <span className="tabular-nums text-foreground">{user.devices}</span>
                      </TableCell>
                      <TableCell>
                        <span className="text-default-500">{formatLastSeen(user.last_seen)}</span>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardBody>
          </Card>

          <Card>
            <CardHeader className="flex items-center gap-3 pb-0">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-100 text-primary">
                <Lock className="h-5 w-5" />
              </span>
              <div className="flex-1">
                <h2 className="text-base font-semibold text-foreground">Policy Presets</h2>
                <p className="text-xs text-default-500">Reusable configuration templates</p>
              </div>
              <Chip size="sm" variant="flat">
                {data.policy_presets.length}
              </Chip>
            </CardHeader>
            <CardBody className="pt-4">
              <Table aria-label="Policy presets" removeWrapper>
                <TableHeader>
                  <TableColumn>NAME</TableColumn>
                  <TableColumn>DESCRIPTION</TableColumn>
                  <TableColumn align="end">USERS</TableColumn>
                  <TableColumn>LOCKED SETTINGS</TableColumn>
                </TableHeader>
                <TableBody
                  items={data.policy_presets}
                  emptyContent="No policy presets configured."
                >
                  {(preset) => (
                    <TableRow key={preset.id}>
                      <TableCell>
                        <span className="font-medium text-foreground">{preset.name}</span>
                      </TableCell>
                      <TableCell>
                        <span className="text-default-600">{preset.description}</span>
                      </TableCell>
                      <TableCell>
                        <span className="tabular-nums text-foreground">{preset.user_count}</span>
                      </TableCell>
                      <TableCell>
                        {preset.locked_settings.length === 0 ? (
                          <span className="text-default-400">—</span>
                        ) : (
                          <div className="flex flex-wrap gap-1.5">
                            {preset.locked_settings.map((setting) => (
                              <Chip key={setting} size="sm" variant="flat" color="warning">
                                {setting}
                              </Chip>
                            ))}
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardBody>
          </Card>

          <Card>
            <CardHeader className="flex items-center gap-3 pb-0">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-danger-100 text-danger">
                <Ban className="h-5 w-5" />
              </span>
              <div className="flex-1">
                <h2 className="text-base font-semibold text-foreground">Blocked Settings</h2>
                <p className="text-xs text-default-500">Hard-enforced configuration overrides</p>
              </div>
              <Chip size="sm" variant="flat">
                {data.blocked_settings.length}
              </Chip>
            </CardHeader>
            <CardBody className="pt-4">
              <Table aria-label="Blocked settings" removeWrapper>
                <TableHeader>
                  <TableColumn>SETTING</TableColumn>
                  <TableColumn>LABEL</TableColumn>
                  <TableColumn>SCOPE</TableColumn>
                  <TableColumn>REASON</TableColumn>
                  <TableColumn>ENFORCED VALUE</TableColumn>
                </TableHeader>
                <TableBody
                  items={data.blocked_settings}
                  emptyContent="No blocked settings enforced."
                >
                  {(rule) => (
                    <TableRow key={rule.id}>
                      <TableCell>
                        <code className="rounded bg-default-100 px-1.5 py-0.5 font-mono text-xs text-foreground">
                          {rule.setting_key}
                        </code>
                      </TableCell>
                      <TableCell>
                        <span className="font-medium text-foreground">{rule.label}</span>
                      </TableCell>
                      <TableCell>
                        <Chip size="sm" variant="flat">
                          {rule.scope}
                        </Chip>
                      </TableCell>
                      <TableCell>
                        <span className="text-default-500">{rule.reason}</span>
                      </TableCell>
                      <TableCell>
                        {rule.enforced_value === null ? (
                          <span className="text-default-400">—</span>
                        ) : (
                          <span className="font-medium text-foreground">{rule.enforced_value}</span>
                        )}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardBody>
          </Card>
        </div>
      )}
    </PageContainer>
  );
}
