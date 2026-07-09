import { Card, Chip, Table } from '@heroui/react';
import { useApi, api } from '../hooks/useApi';
import {
  PageContainer,
  PageHeader,
  LoadingState,
  ErrorState,
  StatCard,
  InfoRow,
  deploymentModeColor,
} from '../components/shared';
import type { OverviewDto } from '../api/types';

export default function Overview() {
  const { data, loading, error } = useApi(() => api.getOverview());

  if (loading) {
    return (
      <PageContainer>
        <PageHeader title="Overview" subtitle="Deployment health at a glance" />
        <LoadingState />
      </PageContainer>
    );
  }

  if (error !== null || data === null) {
    return (
      <PageContainer>
        <PageHeader title="Overview" subtitle="Deployment health at a glance" />
        <ErrorState message={error ?? 'No overview data available.'} />
      </PageContainer>
    );
  }

  const o: OverviewDto = data;

  return (
    <PageContainer>
      <PageHeader title="Overview" subtitle="Deployment health at a glance" />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total Services" value={o.service_count.total} helper="Compose project containers" />
        <StatCard label="Running" value={o.service_count.running} color="success" helper="Currently active" />
        <StatCard label="Stopped" value={o.service_count.stopped} helper="Awaiting action" />
        <Card>
          <Card.Content className="min-h-32">
            <p className="text-sm font-medium text-muted">Docker Status</p>
            <div className="mt-4">
              <Chip size="md" variant="soft" color={o.docker_available ? 'success' : 'danger'}>
                {o.docker_available ? 'Available' : 'Unavailable'}
              </Chip>
            </div>
            {o.docker_error !== null && (
              <p className="mt-2 text-xs text-danger">{o.docker_error}</p>
            )}
          </Card.Content>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <Card.Header>
            <Card.Title>Health Summary</Card.Title>
            <Card.Description>Container health checks reported by Docker.</Card.Description>
          </Card.Header>
          <Card.Content>
            <div className="grid grid-cols-2 gap-3">
              <Chip size="md" variant="soft" color="success">
                Healthy: {o.health.healthy}
              </Chip>
              <Chip size="md" variant="soft" color="danger">
                Unhealthy: {o.health.unhealthy}
              </Chip>
              <Chip size="md" variant="soft" color="warning">
                Starting: {o.health.starting}
              </Chip>
              <Chip size="md" variant="soft">
                No check: {o.health.none}
              </Chip>
            </div>
          </Card.Content>
        </Card>

        <Card>
          <Card.Header>
            <Card.Title>Exposed Ports</Card.Title>
            <Card.Description>Host mappings available from this deployment.</Card.Description>
          </Card.Header>
          <Card.Content>
            <Table>
              <Table.ScrollContainer>
                <Table.Content aria-label="Exposed ports" className="min-w-[600px]">
                  <Table.Header>
                    <Table.Column isRowHeader>Service</Table.Column>
                    <Table.Column>Host</Table.Column>
                    <Table.Column>Container</Table.Column>
                    <Table.Column>Protocol</Table.Column>
                  </Table.Header>
                  <Table.Body>
                    {o.exposed_ports.map((p) => (
                      <Table.Row key={`${p.service}-${p.host_port ?? 'null'}-${p.container_port}-${p.protocol}`}>
                        <Table.Cell>{p.service}</Table.Cell>
                        <Table.Cell>
                          {p.host_port === null ? '—' : p.host_port}
                        </Table.Cell>
                        <Table.Cell>{p.container_port}</Table.Cell>
                        <Table.Cell>{p.protocol.toUpperCase()}</Table.Cell>
                      </Table.Row>
                    ))}
                  </Table.Body>
                </Table.Content>
              </Table.ScrollContainer>
            </Table>
          </Card.Content>
        </Card>
      </div>

      <Card>
        <Card.Header>
          <Card.Title>System Info</Card.Title>
          <Card.Description>Runtime configuration detected by the management backend.</Card.Description>
        </Card.Header>
        <Card.Content>
          <InfoRow label="Version">{o.version}</InfoRow>
          <InfoRow label="mLearn Version">{o.mlearn_version ?? '—'}</InfoRow>
          <InfoRow label="Deployment Mode">
            <Chip size="sm" variant="soft" color={deploymentModeColor(o.deployment_mode)}>
              {o.deployment_mode}
            </Chip>
          </InfoRow>
          <InfoRow label="Compose Project">{o.compose_project}</InfoRow>
          <InfoRow label="Auth Enabled">
            <Chip size="sm" variant="soft" color={o.management_auth_enabled ? 'success' : 'danger'}>
              {o.management_auth_enabled ? 'Enabled' : 'Disabled'}
            </Chip>
          </InfoRow>
          <InfoRow label="Cloud Features">
            <Chip size="sm" variant="soft" color={o.cloud_features_enabled ? 'success' : 'default'}>
              {o.cloud_features_enabled ? 'Enabled' : 'Disabled'}
            </Chip>
          </InfoRow>
        </Card.Content>
      </Card>
    </PageContainer>
  );
}
