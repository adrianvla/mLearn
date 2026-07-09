import { Card, CardContent, CardHeader, Chip, TableCell } from '@heroui/react';
import { Network, Database, Activity, Server } from 'lucide-react';
import { useApi, api } from '../hooks/useApi';
import { PageContainer, PageHeader, LoadingState, ErrorState, InfoRow, statusToColor } from '../components/shared';
import type { DistributionDto } from '../api/types';

const formatBytes = (b: number): string =>
  b > 1073741824
    ? (b / 1073741824).toFixed(1) + ' GB'
    : b > 1048576
      ? (b / 1048576).toFixed(1) + ' MB'
      : b > 1024
        ? (b / 1024).toFixed(1) + ' KB'
        : b + ' B';

export default function Distribution() {
  const { data, loading, error } = useApi(() => api.getDistribution());

  return (
    <PageContainer>
      <PageHeader title="Distribution" subtitle="Catalog mirror, offline cache, LAN endpoints, and sync rules" />
      {loading && !data && <LoadingState />}
      {!loading && error && <ErrorState message={error} />}
      {data && <DistributionContent data={data} />}
    </PageContainer>
  );
}

function DistributionContent({ data }: { data: DistributionDto }) {
  const mirror = data.catalog_mirror;

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader className="flex items-center gap-2 pb-0">
          <Network className="h-5 w-5 text-muted" />
          <h2 className="text-lg font-semibold text-foreground">Mirror Status</h2>
        </CardHeader>
        <CardContent>
          <InfoRow label="Enabled">
            <Chip color={mirror.enabled ? 'success' : 'default'} variant="flat" size="sm">
              {mirror.enabled ? 'Enabled' : 'Disabled'}
            </Chip>
          </InfoRow>
          <InfoRow label="Catalog URL">
            <span className="font-mono text-xs">{mirror.catalog_url}</span>
          </InfoRow>
          <InfoRow label="Last Sync">{mirror.last_sync ?? 'never'}</InfoRow>
          <InfoRow label="Cached Size">{formatBytes(mirror.cached_bytes)}</InfoRow>
          <InfoRow label="Item Count">{mirror.item_count}</InfoRow>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex items-center gap-2 pb-0">
          <Database className="h-5 w-5 text-muted" />
          <h2 className="text-lg font-semibold text-foreground">Cache Items</h2>
        </CardHeader>
        <CardContent>
          <table className="w-full border-collapse text-sm">
            <thead className="border-b border-border">
              <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted">Kind</th>
              <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted">Name</th>
              <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted">Version</th>
              <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted">Size</th>
              <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted">Served Locally</th>
            </thead>
            <tbody>
              {data.cache_items.map((item) => (
                <tr key={`${item.name}-${item.version}`}>
                  <td>{item.kind}</td>
                  <td>{item.name}</td>
                  <td>{item.version}</td>
                  <td className="tabular-nums">{formatBytes(item.size_bytes)}</td>
                  <td>
                    <Chip color={item.served_locally ? 'success' : 'default'} variant="flat" size="sm">
                      {item.served_locally ? 'Yes' : 'No'}
                    </Chip>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex items-center gap-2 pb-0">
          <Server className="h-5 w-5 text-muted" />
          <h2 className="text-lg font-semibold text-foreground">LAN Endpoints</h2>
        </CardHeader>
        <CardContent>
          <table className="w-full border-collapse text-sm">
            <thead className="border-b border-border">
              <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted">Label</th>
              <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted">URL</th>
              <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted">Status</th>
            </thead>
            <tbody>
              {data.lan_endpoints.map((endpoint) => (
                <tr key={`${endpoint.label}-${endpoint.url}`}>
                  <td>{endpoint.label}</td>
                  <td>
                    <span className="font-mono text-xs">{endpoint.url}</span>
                  </td>
                  <td>
                    <Chip color={statusToColor(endpoint.status)} variant="flat" size="sm">
                      {endpoint.status}
                    </Chip>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex items-center gap-2 pb-0">
          <Activity className="h-5 w-5 text-muted" />
          <h2 className="text-lg font-semibold text-foreground">Sync Rules</h2>
        </CardHeader>
        <CardContent>
          <table className="w-full border-collapse text-sm">
            <thead className="border-b border-border">
              <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted">Label</th>
              <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted">Source</th>
              <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted">Destination</th>
              <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted">Mode</th>
            </thead>
            <tbody>
              {data.sync_rules.map((rule) => (
                <tr key={rule.id}>
                  <td>{rule.label}</td>
                  <td>
                    <span className="font-mono text-xs">{rule.source}</span>
                  </td>
                  <td>
                    <span className="font-mono text-xs">{rule.destination}</span>
                  </td>
                  <td>{rule.mode}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
