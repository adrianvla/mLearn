import { Card, Chip, Table } from '@heroui/react';
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
        <Card.Header className="flex items-center gap-2">
          <Network className="h-5 w-5 text-muted" />
          <Card.Title>Mirror Status</Card.Title>
        </Card.Header>
        <Card.Content>
          <InfoRow label="Enabled">
            <Chip color={mirror.enabled ? 'success' : 'default'} variant="soft" size="sm">
              {mirror.enabled ? 'Enabled' : 'Disabled'}
            </Chip>
          </InfoRow>
          <InfoRow label="Catalog URL">
            <span className="font-mono text-xs">{mirror.catalog_url}</span>
          </InfoRow>
          <InfoRow label="Last Sync">{mirror.last_sync ?? 'never'}</InfoRow>
          <InfoRow label="Cached Size">{formatBytes(mirror.cached_bytes)}</InfoRow>
          <InfoRow label="Item Count">{mirror.item_count}</InfoRow>
        </Card.Content>
      </Card>

      <Card>
        <Card.Header className="flex items-center gap-2">
          <Database className="h-5 w-5 text-muted" />
          <Card.Title>Cache Items</Card.Title>
        </Card.Header>
        <Card.Content>
          <Table>
            <Table.ScrollContainer>
              <Table.Content aria-label="Cache items" className="min-w-[600px]">
                <Table.Header>
                  <Table.Column isRowHeader>Kind</Table.Column>
                  <Table.Column>Name</Table.Column>
                  <Table.Column>Version</Table.Column>
                  <Table.Column>Size</Table.Column>
                  <Table.Column>Served Locally</Table.Column>
                </Table.Header>
                <Table.Body>
                  {data.cache_items.map((item) => (
                    <Table.Row key={`${item.name}-${item.version}`}>
                      <Table.Cell>{item.kind}</Table.Cell>
                      <Table.Cell>{item.name}</Table.Cell>
                      <Table.Cell>{item.version}</Table.Cell>
                      <Table.Cell className="tabular-nums">{formatBytes(item.size_bytes)}</Table.Cell>
                      <Table.Cell>
                        <Chip color={item.served_locally ? 'success' : 'default'} variant="soft" size="sm">
                          {item.served_locally ? 'Yes' : 'No'}
                        </Chip>
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
        <Card.Header className="flex items-center gap-2">
          <Server className="h-5 w-5 text-muted" />
          <Card.Title>LAN Endpoints</Card.Title>
        </Card.Header>
        <Card.Content>
          <Table>
            <Table.ScrollContainer>
              <Table.Content aria-label="LAN endpoints" className="min-w-[600px]">
                <Table.Header>
                  <Table.Column isRowHeader>Label</Table.Column>
                  <Table.Column>URL</Table.Column>
                  <Table.Column>Status</Table.Column>
                </Table.Header>
                <Table.Body>
                  {data.lan_endpoints.map((endpoint) => (
                    <Table.Row key={`${endpoint.label}-${endpoint.url}`}>
                      <Table.Cell>{endpoint.label}</Table.Cell>
                      <Table.Cell>
                        <span className="font-mono text-xs">{endpoint.url}</span>
                      </Table.Cell>
                      <Table.Cell>
                        <Chip color={statusToColor(endpoint.status)} variant="soft" size="sm">
                          {endpoint.status}
                        </Chip>
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
        <Card.Header className="flex items-center gap-2">
          <Activity className="h-5 w-5 text-muted" />
          <Card.Title>Sync Rules</Card.Title>
        </Card.Header>
        <Card.Content>
          <Table>
            <Table.ScrollContainer>
              <Table.Content aria-label="Sync rules" className="min-w-[600px]">
                <Table.Header>
                  <Table.Column isRowHeader>Label</Table.Column>
                  <Table.Column>Source</Table.Column>
                  <Table.Column>Destination</Table.Column>
                  <Table.Column>Mode</Table.Column>
                </Table.Header>
                <Table.Body>
                  {data.sync_rules.map((rule) => (
                    <Table.Row key={rule.id}>
                      <Table.Cell>{rule.label}</Table.Cell>
                      <Table.Cell>
                        <span className="font-mono text-xs">{rule.source}</span>
                      </Table.Cell>
                      <Table.Cell>
                        <span className="font-mono text-xs">{rule.destination}</span>
                      </Table.Cell>
                      <Table.Cell>{rule.mode}</Table.Cell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table.Content>
            </Table.ScrollContainer>
          </Table>
        </Card.Content>
      </Card>
    </div>
  );
}
