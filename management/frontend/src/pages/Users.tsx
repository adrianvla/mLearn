import {
  Avatar,
  Card,
  Chip,
  Table,
} from '@heroui/react';
import { Users as UsersIcon, Lock, Ban } from 'lucide-react';
import { useApi, api } from '../hooks/useApi';
import {
  PageContainer,
  PageHeader,
  LoadingState,
  ErrorState,
  userRoleColor,
  statusToColor,
} from '../components/shared';
import type { UsersDto } from '../api/types';

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
            <Card.Header className="flex items-center gap-3">
              <Avatar size="sm" color="accent">
                <Avatar.Fallback><UsersIcon className="h-5 w-5" /></Avatar.Fallback>
              </Avatar>
              <div className="flex-1">
                <Card.Title>Users</Card.Title>
                <Card.Description>Accounts managed by this deployment</Card.Description>
              </div>
              <Chip size="sm" variant="soft">
                {data.users.length}
              </Chip>
            </Card.Header>
            <Card.Content>
              <Table>
                <Table.ScrollContainer>
                  <Table.Content aria-label="Managed users" className="min-w-[800px]">
                    <Table.Header>
                      <Table.Column isRowHeader>Name</Table.Column>
                      <Table.Column>Role</Table.Column>
                      <Table.Column>Status</Table.Column>
                      <Table.Column>Policy</Table.Column>
                      <Table.Column>Devices</Table.Column>
                      <Table.Column>Last Seen</Table.Column>
                    </Table.Header>
                    <Table.Body>
                      {data.users.map((user) => (
                        <Table.Row key={user.id}>
                          <Table.Cell>
                            <span className="font-medium text-foreground">{user.display_name}</span>
                          </Table.Cell>
                          <Table.Cell>
                            <Chip size="sm" variant="soft" color={userRoleColor(user.role)}>
                              {user.role}
                            </Chip>
                          </Table.Cell>
                          <Table.Cell>
                            <Chip size="sm" variant="soft" color={statusToColor(user.status)}>
                              {user.status}
                            </Chip>
                          </Table.Cell>
                          <Table.Cell>
                            <span className="text-foreground">{user.policy}</span>
                          </Table.Cell>
                          <Table.Cell>
                            <span className="tabular-nums text-foreground">{user.devices}</span>
                          </Table.Cell>
                          <Table.Cell>
                            <span className="text-muted">{formatLastSeen(user.last_seen)}</span>
                          </Table.Cell>
                        </Table.Row>
                      ))}
                    </Table.Body>
                  </Table.Content>
                </Table.ScrollContainer>
              </Table>
            </Card.Content>
          </Card>

          <Card>
            <Card.Header className="flex items-center gap-3">
              <Avatar size="sm" color="accent">
                <Avatar.Fallback><Lock className="h-5 w-5" /></Avatar.Fallback>
              </Avatar>
              <div className="flex-1">
                <Card.Title>Policy Presets</Card.Title>
                <Card.Description>Reusable configuration templates</Card.Description>
              </div>
              <Chip size="sm" variant="soft">
                {data.policy_presets.length}
              </Chip>
            </Card.Header>
            <Card.Content>
              <Table>
                <Table.ScrollContainer>
                  <Table.Content aria-label="Policy presets" className="min-w-[800px]">
                    <Table.Header>
                      <Table.Column isRowHeader>Name</Table.Column>
                      <Table.Column>Description</Table.Column>
                      <Table.Column>Users</Table.Column>
                      <Table.Column>Locked Settings</Table.Column>
                    </Table.Header>
                    <Table.Body>
                      {data.policy_presets.map((preset) => (
                        <Table.Row key={preset.id}>
                          <Table.Cell>
                            <span className="font-medium text-foreground">{preset.name}</span>
                          </Table.Cell>
                          <Table.Cell>
                            <span className="text-foreground">{preset.description}</span>
                          </Table.Cell>
                          <Table.Cell>
                            <span className="tabular-nums text-foreground">{preset.user_count}</span>
                          </Table.Cell>
                          <Table.Cell>
                            {preset.locked_settings.length === 0 ? (
                              <span className="text-muted">—</span>
                            ) : (
                              <div className="flex flex-wrap gap-1.5">
                                {preset.locked_settings.map((setting) => (
                                  <Chip key={setting} size="sm" variant="soft" color="warning">
                                    {setting}
                                  </Chip>
                                ))}
                              </div>
                            )}
                          </Table.Cell>
                        </Table.Row>
                      ))}
                    </Table.Body>
                  </Table.Content>
                </Table.ScrollContainer>
              </Table>
            </Card.Content>
          </Card>

          <Card>
            <Card.Header className="flex items-center gap-3">
              <Avatar size="sm" color="danger">
                <Avatar.Fallback><Ban className="h-5 w-5" /></Avatar.Fallback>
              </Avatar>
              <div className="flex-1">
                <Card.Title>Blocked Settings</Card.Title>
                <Card.Description>Hard-enforced configuration overrides</Card.Description>
              </div>
              <Chip size="sm" variant="soft">
                {data.blocked_settings.length}
              </Chip>
            </Card.Header>
            <Card.Content>
              <Table>
                <Table.ScrollContainer>
                  <Table.Content aria-label="Blocked settings" className="min-w-[800px]">
                    <Table.Header>
                      <Table.Column isRowHeader>Setting</Table.Column>
                      <Table.Column>Label</Table.Column>
                      <Table.Column>Scope</Table.Column>
                      <Table.Column>Reason</Table.Column>
                      <Table.Column>Enforced Value</Table.Column>
                    </Table.Header>
                    <Table.Body>
                      {data.blocked_settings.map((rule) => (
                        <Table.Row key={rule.id}>
                          <Table.Cell>
                            <code className="rounded bg-default px-1.5 py-0.5 font-mono text-xs text-foreground">
                              {rule.setting_key}
                            </code>
                          </Table.Cell>
                          <Table.Cell>
                            <span className="font-medium text-foreground">{rule.label}</span>
                          </Table.Cell>
                          <Table.Cell>
                            <Chip size="sm" variant="soft">
                              {rule.scope}
                            </Chip>
                          </Table.Cell>
                          <Table.Cell>
                            <span className="text-muted">{rule.reason}</span>
                          </Table.Cell>
                          <Table.Cell>
                            {rule.enforced_value === null ? (
                              <span className="text-muted">—</span>
                            ) : (
                              <span className="font-medium text-foreground">{rule.enforced_value}</span>
                            )}
                          </Table.Cell>
                        </Table.Row>
                      ))}
                    </Table.Body>
                  </Table.Content>
                </Table.ScrollContainer>
              </Table>
            </Card.Content>
          </Card>
        </div>
      )}
    </PageContainer>
  );
}
