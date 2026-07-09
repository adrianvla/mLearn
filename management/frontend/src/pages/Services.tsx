import { useState } from 'react';
import {
  Card,
  CardContent,
  Chip,
  Button,
  Table,
  TableHeader,
  TableColumn,
  TableBody,
  TableRow,
  TableCell,
  Tooltip,
  Spinner,
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
            variant="flat"
            color="accent"
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
        <Card className="mb-4 border border-danger bg-danger/10">
          <CardContent>
            <div className="flex items-center justify-between gap-3 text-danger">
              <span className="text-sm font-medium">{actionError}</span>
              <Button
                size="sm"
                variant="light"
                color="danger"
                isIconOnly
                aria-label="Dismiss"
                onPress={() => setActionError(null)}
              >
                <XCircle className="h-4 w-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {busy && services.length === 0 && <LoadingState />}

      {!busy && error !== null && services.length === 0 && <ErrorState message={error} />}

      {!busy && error === null && services.length === 0 && (
        <Card>
          <CardContent>
            <p className="py-8 text-center text-sm text-muted">No services discovered.</p>
          </CardContent>
        </Card>
      )}

      {services.length > 0 && (
        <Card>
          <CardContent>
            <Table aria-label="Services" removeWrapper>
              <TableHeader>
                <TableColumn>Service</TableColumn>
                <TableColumn>Container</TableColumn>
                <TableColumn>Status</TableColumn>
                <TableColumn>Health</TableColumn>
                <TableColumn>Image</TableColumn>
                <TableColumn>Ports</TableColumn>
                <TableColumn>Actions</TableColumn>
              </TableHeader>
              <TableBody emptyContent="No services discovered.">
                {services.map((s) => {
                  const name = resolveName(s);
                  const isPending = pendingId === s.id;
                  const disabled = pendingId !== null;
                  return (
                    <TableRow key={s.id}>
                      <TableCell>
                        <span className="font-medium text-foreground">{name}</span>
                      </TableCell>
                      <TableCell>
                        <span className="font-mono text-xs text-muted">{s.container_name}</span>
                      </TableCell>
                      <TableCell>
                        <Chip size="sm" variant="flat" color={statusToColor(s.status)}>
                          {s.status}
                        </Chip>
                      </TableCell>
                      <TableCell>
                        {s.health.length === 0 ? (
                          <Chip size="sm" variant="flat">
                            none
                          </Chip>
                        ) : (
                          <Chip size="sm" variant="flat" color={statusToColor(s.health)}>
                            {s.health}
                          </Chip>
                        )}
                      </TableCell>
                      <TableCell>
                        <span className="font-mono text-xs text-muted">{formatImage(s)}</span>
                      </TableCell>
                      <TableCell>
                        <span className="font-mono text-xs text-muted">{formatPorts(s.ports)}</span>
                      </TableCell>
                      <TableCell>
                        {isPending ? (
                          <Spinner size="sm" />
                        ) : (
                          <div className="flex gap-1">
                            <Tooltip content="Start" color="accent">
                              <Button
                                size="sm"
                                variant="flat"
                                color="success"
                                isIconOnly
                                isDisabled={disabled}
                                onPress={() => handleAction(s.id, 'start')}
                                aria-label={`Start ${name}`}
                              >
                                <Play className="h-4 w-4" />
                              </Button>
                            </Tooltip>
                            <Tooltip content="Stop" color="danger">
                              <Button
                                size="sm"
                                variant="flat"
                                color="danger"
                                isIconOnly
                                isDisabled={disabled}
                                onPress={() => handleAction(s.id, 'stop')}
                                aria-label={`Stop ${name}`}
                              >
                                <Square className="h-4 w-4" />
                              </Button>
                            </Tooltip>
                            <Tooltip content="Restart" color="accent">
                              <Button
                                size="sm"
                                variant="flat"
                                color="accent"
                                isIconOnly
                                isDisabled={disabled}
                                onPress={() => handleAction(s.id, 'restart')}
                                aria-label={`Restart ${name}`}
                              >
                                <RotateCw className="h-4 w-4" />
                              </Button>
                            </Tooltip>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </PageContainer>
  );
}
