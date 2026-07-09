import { useState } from 'react';
import {
  Card,
  Chip,
  Button,
  Spinner,
  Table,
  Tooltip,
} from '@heroui/react';
import { Play, Square, RotateCw, RefreshCw, XCircle } from 'lucide-react';
import { useApi, api } from '../hooks/useApi';
import {
  PageContainer,
  PageHeader,
  LoadingState,
  ErrorState,
  statusToColor,
} from '../components/shared';
import type { PortMapping, ServiceDto } from '../api/types';

type ServiceAction = 'start' | 'stop' | 'restart';

function resolveName(s: ServiceDto): string {
  return s.service_name ?? s.compose_service ?? s.container_name;
}

function formatImage(s: ServiceDto): string {
  return s.tag === null || s.tag.length === 0 ? s.image : `${s.image}:${s.tag}`;
}

function formatPorts(ports: PortMapping[]): string {
  if (ports.length === 0) return '—';
  return ports
    .map((p) => (p.host_port === null ? `${p.container_port}` : `${p.host_port}:${p.container_port}`) + `/${p.protocol}`)
    .join(', ');
}

export default function Services() {
  const { data, loading, error, refetch } = useApi<ServiceDto[]>(() => api.getServices());
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const handleAction = async (id: string, action: ServiceAction): Promise<void> => {
    setActionError(null);
    setPendingId(id);
    try {
      await api.performAction(id, action);
      await refetch();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : `${action} failed`);
    } finally {
      setPendingId(null);
    }
  };

  const busy = loading;
  const services = data ?? [];

  return (
    <PageContainer>
      <PageHeader
        title="Services"
        subtitle="Containers in the mLearn compose project"
        actions={
          <Button
            size="sm"
            variant="secondary"
            isIconOnly
            isDisabled={busy || pendingId !== null}
            onPress={() => refetch()}
            aria-label="Refresh services"
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
        }
      />

      {actionError !== null && (
        <Card>
          <Card.Content>
            <div className="flex items-center justify-between gap-3 text-danger">
              <span className="text-sm font-medium">{actionError}</span>
              <Button
                size="sm"
                variant="danger-soft"
                isIconOnly
                aria-label="Dismiss"
                onPress={() => setActionError(null)}
              >
                <XCircle className="h-4 w-4" />
              </Button>
            </div>
          </Card.Content>
        </Card>
      )}

      {busy && services.length === 0 && <LoadingState />}

      {!busy && error !== null && services.length === 0 && <ErrorState message={error} />}

      {!busy && error === null && services.length === 0 && (
        <Card>
          <Card.Content>
            <p className="py-8 text-center text-sm text-muted">No services discovered.</p>
          </Card.Content>
        </Card>
      )}

      {services.length > 0 && (
        <Card>
          <Card.Header>
            <Card.Title>Service Inventory</Card.Title>
            <Card.Description>Container status, health, image tags, ports, and lifecycle controls.</Card.Description>
          </Card.Header>
          <Card.Content>
            <Table>
              <Table.ScrollContainer>
                <Table.Content aria-label="Services" className="min-w-[800px]">
                  <Table.Header>
                    <Table.Column isRowHeader>Service</Table.Column>
                    <Table.Column>Container</Table.Column>
                    <Table.Column>Status</Table.Column>
                    <Table.Column>Health</Table.Column>
                    <Table.Column>Image</Table.Column>
                    <Table.Column>Ports</Table.Column>
                    <Table.Column>Actions</Table.Column>
                  </Table.Header>
                  <Table.Body>
                    {services.map((s) => {
                      const name = resolveName(s);
                      const isPending = pendingId === s.id;
                      const disabled = pendingId !== null;
                      return (
                        <Table.Row key={s.id}>
                          <Table.Cell>
                            <span className="font-medium text-foreground">{name}</span>
                          </Table.Cell>
                          <Table.Cell>
                            <span className="font-mono text-xs text-muted">{s.container_name}</span>
                          </Table.Cell>
                          <Table.Cell>
                            <Chip size="sm" variant="soft" color={statusToColor(s.status)}>
                              {s.status}
                            </Chip>
                          </Table.Cell>
                          <Table.Cell>
                            {s.health.length === 0 ? (
                              <Chip size="sm" variant="soft">
                                none
                              </Chip>
                            ) : (
                              <Chip size="sm" variant="soft" color={statusToColor(s.health)}>
                                {s.health}
                              </Chip>
                            )}
                          </Table.Cell>
                          <Table.Cell>
                            <span className="font-mono text-xs text-muted">{formatImage(s)}</span>
                          </Table.Cell>
                          <Table.Cell>
                            <span className="font-mono text-xs text-muted">{formatPorts(s.ports)}</span>
                          </Table.Cell>
                          <Table.Cell>
                            {isPending ? (
                              <Spinner size="sm" />
                            ) : (
                              <div className="flex gap-1">
                                <Tooltip>
                                  <Tooltip.Trigger>
                                    <Button
                                      size="sm"
                                      variant="secondary"
                                      isIconOnly
                                      isDisabled={disabled}
                                      onPress={() => handleAction(s.id, 'start')}
                                      aria-label={`Start ${name}`}
                                    >
                                      <Play className="h-4 w-4" />
                                    </Button>
                                  </Tooltip.Trigger>
                                  <Tooltip.Content>Start</Tooltip.Content>
                                </Tooltip>
                                <Tooltip>
                                  <Tooltip.Trigger>
                                    <Button
                                      size="sm"
                                      variant="danger-soft"
                                      isIconOnly
                                      isDisabled={disabled}
                                      onPress={() => handleAction(s.id, 'stop')}
                                      aria-label={`Stop ${name}`}
                                    >
                                      <Square className="h-4 w-4" />
                                    </Button>
                                  </Tooltip.Trigger>
                                  <Tooltip.Content>Stop</Tooltip.Content>
                                </Tooltip>
                                <Tooltip>
                                  <Tooltip.Trigger>
                                    <Button
                                      size="sm"
                                      variant="secondary"
                                      isIconOnly
                                      isDisabled={disabled}
                                      onPress={() => handleAction(s.id, 'restart')}
                                      aria-label={`Restart ${name}`}
                                    >
                                      <RotateCw className="h-4 w-4" />
                                    </Button>
                                  </Tooltip.Trigger>
                                  <Tooltip.Content>Restart</Tooltip.Content>
                                </Tooltip>
                              </div>
                            )}
                          </Table.Cell>
                        </Table.Row>
                      );
                    })}
                  </Table.Body>
                </Table.Content>
              </Table.ScrollContainer>
            </Table>
          </Card.Content>
        </Card>
      )}
    </PageContainer>
  );
}
