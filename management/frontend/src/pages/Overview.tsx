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
import { useApi, api } from '../hooks/useApi';
import {
  PageContainer,
  PageHeader,
  LoadingState,
  ErrorState,
  StatCard,
  InfoRow,
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

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Total Services" value={o.service_count.total} />
        <StatCard label="Running" value={o.service_count.running} color="success" />
        <StatCard label="Stopped" value={o.service_count.stopped} />
        <Card>
          <CardContent className="p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted">Docker Status</p>
            <div className="mt-2">
              <Chip size="sm" variant="flat" color={o.docker_available ? 'success' : 'danger'}>
                {o.docker_available ? 'Available' : 'Unavailable'}
              </Chip>
            </div>
            {o.docker_error !== null && (
              <p className="mt-2 text-xs text-danger">{o.docker_error}</p>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2 pt-4">
            <h2 className="text-sm font-semibold text-foreground">Health Summary</h2>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <div className="flex flex-wrap gap-2">
              <Chip size="sm" variant="flat" color="success">
                Healthy: {o.health.healthy}
              </Chip>
              <Chip size="sm" variant="flat" color="danger">
                Unhealthy: {o.health.unhealthy}
              </Chip>
              <Chip size="sm" variant="flat" color="warning">
                Starting: {o.health.starting}
              </Chip>
              <Chip size="sm" variant="flat">
                No check: {o.health.none}
              </Chip>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2 pt-4">
            <h2 className="text-sm font-semibold text-foreground">Exposed Ports</h2>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <table className="w-full border-collapse text-sm">
              <thead className="border-b border-border">
                <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted">Service</th>
                <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted">Host</th>
                <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted">Container</th>
                <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted">Protocol</th>
              </thead>
              <tbody>
                {o.exposed_ports.map((p) => (
                  <tr key={`${p.service}-${p.host_port ?? 'null'}-${p.container_port}-${p.protocol}`}>
                    <td>{p.service}</td>
                    <td className="tabular-nums">
                      {p.host_port === null ? '—' : p.host_port}
                    </td>
                    <td className="tabular-nums">{p.container_port}</td>
                    <td className="uppercase">{p.protocol}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader className="pb-2 pt-4">
          <h2 className="text-sm font-semibold text-foreground">System Info</h2>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          <InfoRow label="Version">{o.version}</InfoRow>
          <InfoRow label="mLearn Version">{o.mlearn_version ?? '—'}</InfoRow>
          <InfoRow label="Deployment Mode">
            <Chip size="sm" variant="flat" color="accent">
              {o.deployment_mode}
            </Chip>
          </InfoRow>
          <InfoRow label="Compose Project">{o.compose_project}</InfoRow>
          <InfoRow label="Auth Enabled">
            <Chip size="sm" variant="flat" color={o.management_auth_enabled ? 'success' : 'danger'}>
              {o.management_auth_enabled ? 'Enabled' : 'Disabled'}
            </Chip>
          </InfoRow>
          <InfoRow label="Cloud Features">
            <Chip size="sm" variant="flat" color={o.cloud_features_enabled ? 'success' : 'default'}>
              {o.cloud_features_enabled ? 'Enabled' : 'Disabled'}
            </Chip>
          </InfoRow>
        </CardContent>
      </Card>
    </PageContainer>
  );
}
