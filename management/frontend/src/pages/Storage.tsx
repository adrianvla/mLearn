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
          <table className="w-full border-collapse text-sm">
            <thead className="border-b border-border">
              <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted">Name</th>
              <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted">Driver</th>
              <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted">Mountpoint</th>
              <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted">Labels</th>
            </thead>
            <tbody>
              {(volume: VolumeInfo) => (
                <tr key={volume.name}>
                  <td className="font-medium">{volume.name}</td>
                  <td>{volume.driver}</td>
                  <td className="font-mono text-xs">{volume.mountpoint}</td>
                  <td>{renderLabels(volume.labels)}</td>
                </tr>
              )}
            </tbody>
          </table>
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
          <table className="w-full border-collapse text-sm">
            <thead className="border-b border-border">
              <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted">Service</th>
              <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted">Source</th>
              <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted">Destination</th>
              <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted">Mode</th>
            </thead>
            <tbody>
              {(mount: BindMountInfo) => {
                const isReadWrite = mount.mode === 'rw';
                return (
                  <tr key={`${mount.service}:${mount.source}:${mount.destination}`}>
                    <td className="font-medium">{mount.service}</td>
                    <td className="font-mono text-xs">{mount.source}</td>
                    <td className="font-mono text-xs">{mount.destination}</td>
                    <td>
                      <Chip size="sm" color={isReadWrite ? 'success' : 'default'} variant="flat">
                        {mount.mode}
                      </Chip>
                    </td>
                  </tr>
                );
              }}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}
