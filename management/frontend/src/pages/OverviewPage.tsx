import { Component, For, Show, createMemo, createResource } from 'solid-js';
import { Badge, Panel, Table, TableColumn } from '../components';
import { createApiClient } from '../api/client';
import { deploymentModeToVariant } from '../status';
import type { OverviewDto, PortMapping } from '../api/types';
import './OverviewPage.css';

const api = createApiClient();

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message.length > 0 ? err.message : fallback;
}

function formatPort(port: PortMapping): string {
  const host = port.host_port === null ? '?' : String(port.host_port);
  return `${host}:${port.container_port}`;
}

const StatCard: Component<{ label: string; value: number }> = (props) => (
  <div class="overview-page__stat">
    <span class="overview-page__stat-label">{props.label}</span>
    <span class="overview-page__stat-value">{props.value}</span>
  </div>
);

const OverviewBody: Component<{ data: OverviewDto }> = (props) => {
  const healthItems = createMemo(() => [
    { key: 'Healthy', value: props.data.health.healthy, variant: 'success' as const },
    { key: 'Unhealthy', value: props.data.health.unhealthy, variant: 'error' as const },
    { key: 'Starting', value: props.data.health.starting, variant: 'warning' as const },
    { key: 'No check', value: props.data.health.none, variant: 'neutral' as const },
  ]);

  const portColumns: TableColumn<PortMapping>[] = [
    { key: 'service', header: 'Service' },
    { key: 'mapping', header: 'Host : Container', render: (row) => formatPort(row) },
    { key: 'protocol', header: 'Protocol', render: (row) => row.protocol },
  ];

  const dockerVariant = () =>
    props.data.docker_available
      ? props.data.docker_error === null
        ? 'success'
        : 'warning'
      : 'error';

  const dockerLabel = () => {
    if (!props.data.docker_available) return 'Unavailable';
    return props.data.docker_error === null ? 'Available' : 'Degraded';
  };

  return (
    <>
      <div class="overview-page__grid">
        <StatCard label="Total Services" value={props.data.service_count.total} />
        <StatCard label="Running" value={props.data.service_count.running} />
        <StatCard label="Stopped" value={props.data.service_count.stopped} />
        <div class="overview-page__stat">
          <span class="overview-page__stat-label">Docker Status</span>
          <span class="overview-page__stat-badge">
            <Badge variant={dockerVariant()} dot>
              {dockerLabel()}
            </Badge>
          </span>
        </div>
      </div>

      <Panel title="Health Summary">
        <div class="overview-page__health-row">
          <For each={healthItems()}>
            {(item) => (
              <div class="overview-page__health-item">
                <span class="overview-page__health-label">{item.key}</span>
                <Badge variant={item.variant} size="sm">
                  {item.value}
                </Badge>
              </div>
            )}
          </For>
        </div>
      </Panel>

      <Panel title="Exposed Ports">
        <Show
          when={props.data.exposed_ports.length > 0}
          fallback={<div class="overview-page__empty">No exposed ports</div>}
        >
          <Table
            columns={portColumns}
            rows={props.data.exposed_ports}
            rowKey={(port) =>
              `${port.service}-${port.host_port ?? 0}-${port.container_port}-${port.protocol}`
            }
            emptyMessage="No exposed ports"
          />
        </Show>
      </Panel>

      <Panel title="System Info">
        <dl class="overview-page__kv">
          <dt class="overview-page__kv-key">Console Version</dt>
          <dd class="overview-page__kv-value">{props.data.version}</dd>
          <dt class="overview-page__kv-key">mLearn Version</dt>
          <dd class="overview-page__kv-value">{props.data.mlearn_version ?? '—'}</dd>
          <dt class="overview-page__kv-key">Deployment Mode</dt>
          <dd class="overview-page__kv-value">
            <Badge variant={deploymentModeToVariant(props.data.deployment_mode)}>
              {props.data.deployment_mode}
            </Badge>
          </dd>
          <dt class="overview-page__kv-key">Compose Project</dt>
          <dd class="overview-page__kv-value">{props.data.compose_project}</dd>
          <dt class="overview-page__kv-key">Management Auth</dt>
          <dd class="overview-page__kv-value">
            <Badge variant={props.data.management_auth_enabled ? 'success' : 'neutral'}>
              {props.data.management_auth_enabled ? 'Enabled' : 'Disabled'}
            </Badge>
          </dd>
          <dt class="overview-page__kv-key">Cloud Features</dt>
          <dd class="overview-page__kv-value">
            <Badge variant={props.data.cloud_features_enabled ? 'success' : 'neutral'}>
              {props.data.cloud_features_enabled ? 'Enabled' : 'Disabled'}
            </Badge>
          </dd>
        </dl>
      </Panel>
    </>
  );
};

const OverviewPage: Component = () => {
  const [overview] = createResource(() => api.getOverview());

  return (
    <div class="overview-page">
      <Show
        when={overview.error === undefined}
        fallback={
          <div class="overview-page__state overview-page__state--error">
            {errorMessage(overview.error, 'Failed to load overview')}
          </div>
        }
      >
        <Show
          when={overview()}
          fallback={
            <div class="overview-page__state">
              <span class="overview-page__spinner" aria-hidden="true" />
              <span>Loading…</span>
            </div>
          }
        >
          {(data) => <OverviewBody data={data()} />}
        </Show>
      </Show>
    </div>
  );
};

export default OverviewPage;
