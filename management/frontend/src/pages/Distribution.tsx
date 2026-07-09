import { Card, CardContent, CardHeader, Chip, Table, TableHeader, TableColumn, TableBody, TableRow, TableCell } from '@heroui/react';
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
          <Table aria-label="Cache items" removeWrapper>
            <TableHeader>
              <TableColumn>Kind</TableColumn>
              <TableColumn>Name</TableColumn>
              <TableColumn>Version</TableColumn>
              <TableColumn>Size</TableColumn>
              <TableColumn>Served Locally</TableColumn>
            </TableHeader>
            <TableBody emptyContent="No cached items">
              {data.cache_items.map((item) => (
                <TableRow key={`${item.name}-${item.version}`}>
                  <TableCell>{item.kind}</TableCell>
                  <TableCell>{item.name}</TableCell>
                  <TableCell>{item.version}</TableCell>
                  <TableCell className="tabular-nums">{formatBytes(item.size_bytes)}</TableCell>
                  <TableCell>
                    <Chip color={item.served_locally ? 'success' : 'default'} variant="flat" size="sm">
                      {item.served_locally ? 'Yes' : 'No'}
                    </Chip>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex items-center gap-2 pb-0">
          <Server className="h-5 w-5 text-muted" />
          <h2 className="text-lg font-semibold text-foreground">LAN Endpoints</h2>
        </CardHeader>
        <CardContent>
          <Table aria-label="LAN endpoints" removeWrapper>
            <TableHeader>
              <TableColumn>Label</TableColumn>
              <TableColumn>URL</TableColumn>
              <TableColumn>Status</TableColumn>
            </TableHeader>
            <TableBody emptyContent="No LAN endpoints">
              {data.lan_endpoints.map((endpoint) => (
                <TableRow key={`${endpoint.label}-${endpoint.url}`}>
                  <TableCell>{endpoint.label}</TableCell>
                  <TableCell>
                    <span className="font-mono text-xs">{endpoint.url}</span>
                  </TableCell>
                  <TableCell>
                    <Chip color={statusToColor(endpoint.status)} variant="flat" size="sm">
                      {endpoint.status}
                    </Chip>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex items-center gap-2 pb-0">
          <Activity className="h-5 w-5 text-muted" />
          <h2 className="text-lg font-semibold text-foreground">Sync Rules</h2>
        </CardHeader>
        <CardContent>
          <Table aria-label="Sync rules" removeWrapper>
            <TableHeader>
              <TableColumn>Label</TableColumn>
              <TableColumn>Source</TableColumn>
              <TableColumn>Destination</TableColumn>
              <TableColumn>Mode</TableColumn>
            </TableHeader>
            <TableBody emptyContent="No sync rules">
              {data.sync_rules.map((rule) => (
                <TableRow key={rule.id}>
                  <TableCell>{rule.label}</TableCell>
                  <TableCell>
                    <span className="font-mono text-xs">{rule.source}</span>
                  </TableCell>
                  <TableCell>
                    <span className="font-mono text-xs">{rule.destination}</span>
                  </TableCell>
                  <TableCell>{rule.mode}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
