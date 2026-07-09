import type { ReactNode } from 'react';
import { Card, Chip, Table } from '@heroui/react';
import { HardDrive, FolderTree } from 'lucide-react';
import { useApi, api } from '../hooks/useApi';
import { PageContainer, PageHeader, LoadingState, ErrorState, EmptyState } from '../components/shared';
import type { BindMountInfo, StorageDto, VolumeInfo } from '../api/types';

function renderLabels(labels: Record<string, string>): ReactNode {
  const entries = Object.entries(labels);
  if (entries.length === 0) {
    return <span className="text-muted">—</span>;
  }
  return (
    <div className="flex flex-wrap gap-1">
      {entries.map(([key, value]) => (
        <Chip key={key} size="sm" variant="soft">{`${key}=${value}`}</Chip>
      ))}
    </div>
  );
}

export default function Storage() {
  const { data, loading, error } = useApi(() => api.getStorage(), []);

  return (
    <PageContainer>
      <PageHeader title="Storage" subtitle="Docker volumes and bind mounts" />

      {loading ? (
        <LoadingState />
      ) : error !== null ? (
        <ErrorState message={error} />
      ) : data === null ? null : (
        <div className="flex flex-col gap-4">
          <VolumesCard data={data} />
          <BindMountsCard data={data} />
        </div>
      )}
    </PageContainer>
  );
}

function VolumesCard({ data }: { data: StorageDto }): ReactNode {
  return (
    <Card>
      <Card.Header>
        <Card.Title>Volumes</Card.Title>
      </Card.Header>
      <Card.Content>
        {data.volumes.length === 0 ? (
          <EmptyState icon={HardDrive} title="No volumes found" />
        ) : (
          <Table>
            <Table.ScrollContainer>
              <Table.Content aria-label="Volumes" className="min-w-[600px]">
                <Table.Header>
                  <Table.Column isRowHeader>Name</Table.Column>
                  <Table.Column>Driver</Table.Column>
                  <Table.Column>Mountpoint</Table.Column>
                  <Table.Column>Labels</Table.Column>
                </Table.Header>
                <Table.Body>
                  {data.volumes.map((volume: VolumeInfo) => (
                    <Table.Row key={volume.name}>
                      <Table.Cell className="font-medium">{volume.name}</Table.Cell>
                      <Table.Cell>{volume.driver}</Table.Cell>
                      <Table.Cell className="font-mono text-xs">{volume.mountpoint}</Table.Cell>
                      <Table.Cell>{renderLabels(volume.labels)}</Table.Cell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table.Content>
            </Table.ScrollContainer>
          </Table>
        )}
      </Card.Content>
    </Card>
  );
}

function BindMountsCard({ data }: { data: StorageDto }): ReactNode {
  return (
    <Card>
      <Card.Header>
        <Card.Title>Bind Mounts</Card.Title>
      </Card.Header>
      <Card.Content>
        {data.bind_mounts.length === 0 ? (
          <EmptyState icon={FolderTree} title="No bind mounts found" />
        ) : (
          <Table>
            <Table.ScrollContainer>
              <Table.Content aria-label="Bind mounts" className="min-w-[600px]">
                <Table.Header>
                  <Table.Column isRowHeader>Service</Table.Column>
                  <Table.Column>Source</Table.Column>
                  <Table.Column>Destination</Table.Column>
                  <Table.Column>Mode</Table.Column>
                </Table.Header>
                <Table.Body>
                  {data.bind_mounts.map((mount: BindMountInfo) => {
                    const isReadWrite = mount.mode === 'rw';
                    return (
                      <Table.Row key={`${mount.service}:${mount.source}:${mount.destination}`}>
                        <Table.Cell className="font-medium">{mount.service}</Table.Cell>
                        <Table.Cell className="font-mono text-xs">{mount.source}</Table.Cell>
                        <Table.Cell className="font-mono text-xs">{mount.destination}</Table.Cell>
                        <Table.Cell>
                          <Chip size="sm" color={isReadWrite ? 'success' : 'default'} variant="soft">
                            {mount.mode}
                          </Chip>
                        </Table.Cell>
                      </Table.Row>
                    );
                  })}
                </Table.Body>
              </Table.Content>
            </Table.ScrollContainer>
          </Table>
        )}
      </Card.Content>
    </Card>
  );
}
