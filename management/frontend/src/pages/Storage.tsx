import type { ReactNode } from 'react';
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
import { PageContainer, PageHeader, LoadingState, ErrorState } from '../components/shared';
import type { BindMountInfo, StorageDto, VolumeInfo } from '../api/types';

function renderLabels(labels: Record<string, string>): ReactNode {
  const entries = Object.entries(labels);
  if (entries.length === 0) {
    return <span className="text-muted">—</span>;
  }
  return (
    <div className="flex flex-wrap gap-1">
      {entries.map(([key, value]) => (
        <Chip key={key} size="sm" variant="flat">{`${key}=${value}`}</Chip>
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
      <CardHeader>
        <h2 className="text-lg font-semibold text-foreground">Volumes</h2>
      </CardHeader>
      <CardContent>
        {data.volumes.length === 0 ? (
          <p className="py-10 text-center text-muted">No volumes found</p>
        ) : (
          <Table aria-label="Volumes" removeWrapper>
            <TableHeader>
              <TableColumn>Name</TableColumn>
              <TableColumn>Driver</TableColumn>
              <TableColumn>Mountpoint</TableColumn>
              <TableColumn>Labels</TableColumn>
            </TableHeader>
            <TableBody items={data.volumes}>
              {(volume: VolumeInfo) => (
                <TableRow key={volume.name}>
                  <TableCell className="font-medium">{volume.name}</TableCell>
                  <TableCell>{volume.driver}</TableCell>
                  <TableCell className="font-mono text-xs">{volume.mountpoint}</TableCell>
                  <TableCell>{renderLabels(volume.labels)}</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function BindMountsCard({ data }: { data: StorageDto }): ReactNode {
  return (
    <Card>
      <CardHeader>
        <h2 className="text-lg font-semibold text-foreground">Bind Mounts</h2>
      </CardHeader>
      <CardContent>
        {data.bind_mounts.length === 0 ? (
          <p className="py-10 text-center text-muted">No bind mounts found</p>
        ) : (
          <Table aria-label="Bind mounts" removeWrapper>
            <TableHeader>
              <TableColumn>Service</TableColumn>
              <TableColumn>Source</TableColumn>
              <TableColumn>Destination</TableColumn>
              <TableColumn>Mode</TableColumn>
            </TableHeader>
            <TableBody items={data.bind_mounts}>
              {(mount: BindMountInfo) => {
                const isReadWrite = mount.mode === 'rw';
                return (
                  <TableRow key={`${mount.service}:${mount.source}:${mount.destination}`}>
                    <TableCell className="font-medium">{mount.service}</TableCell>
                    <TableCell className="font-mono text-xs">{mount.source}</TableCell>
                    <TableCell className="font-mono text-xs">{mount.destination}</TableCell>
                    <TableCell>
                      <Chip size="sm" color={isReadWrite ? 'success' : 'default'} variant="flat">
                        {mount.mode}
                      </Chip>
                    </TableCell>
                  </TableRow>
                );
              }}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
