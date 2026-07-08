import { Show, createResource, type Component } from 'solid-js';
import { Badge, Panel, Table } from '../components';
import type { TableColumn } from '../components';
import { createApiClient } from '../api/client';
import type { BindMountInfo, StorageDto, VolumeInfo } from '../api/types';
import './StoragePage.css';

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return 'Unknown error';
}

function formatLabels(labels: Record<string, string>): string {
  const entries = Object.entries(labels);
  if (entries.length === 0) return 'none';
  return entries.map(([key, value]) => `${key}=${value}`).join(', ');
}

function formatServices(services: string[]): string {
  if (services.length === 0) return 'unknown';
  return services.join(', ');
}

const VOLUME_COLUMNS: TableColumn<VolumeInfo>[] = [
  { key: 'name', header: 'Name' },
  { key: 'driver', header: 'Driver' },
  {
    key: 'mountpoint',
    header: 'Mountpoint',
    render: (row) => <span class="storage-page__mono">{row.mountpoint}</span>,
  },
  {
    key: 'in_use_by',
    header: 'In Use By',
    render: (row) => <span class="storage-page__mono">{formatServices(row.in_use_by)}</span>,
  },
  {
    key: 'labels',
    header: 'Labels',
    render: (row) => <span class="storage-page__mono">{formatLabels(row.labels)}</span>,
  },
];

const BIND_COLUMNS: TableColumn<BindMountInfo>[] = [
  { key: 'service', header: 'Service' },
  {
    key: 'source',
    header: 'Source',
    render: (row) => <span class="storage-page__mono">{row.source}</span>,
  },
  {
    key: 'destination',
    header: 'Destination',
    render: (row) => <span class="storage-page__mono">{row.destination}</span>,
  },
  {
    key: 'mode',
    header: 'Mode',
    render: (row) => (
      <Badge variant={row.mode === 'rw' ? 'success' : 'neutral'}>{row.mode}</Badge>
    ),
  },
];

const StorageView: Component<{ data: StorageDto }> = (props) => {
  return (
    <>
      <Panel title="Volumes">
        <Table
          columns={VOLUME_COLUMNS}
          rows={props.data.volumes}
          rowKey={(row) => row.name}
          emptyMessage="No Docker volumes found"
        />
      </Panel>
      <Panel title="Bind Mounts">
        <Table
          columns={BIND_COLUMNS}
          rows={props.data.bind_mounts}
          rowKey={(row) => `${row.service}:${row.destination}`}
          emptyMessage="No bind mounts found"
        />
      </Panel>
    </>
  );
};

const StoragePage: Component = () => {
  const api = createApiClient();
  const [storage] = createResource(() => api.getStorage());

  return (
    <div class="storage-page">
      <Show
        when={storage()}
        fallback={
          <Show
            when={storage.error}
            fallback={
              <div class="storage-page__state">
                <span class="storage-page__spinner" aria-hidden="true" />
                <span>Loading storage…</span>
              </div>
            }
          >
            <div class="storage-page__state storage-page__state--error">
              Failed to load storage: {describeError(storage.error)}
            </div>
          </Show>
        }
      >
        {(data) => <StorageView data={data()} />}
      </Show>
    </div>
  );
};

export default StoragePage;
