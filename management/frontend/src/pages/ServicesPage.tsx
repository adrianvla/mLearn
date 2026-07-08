import { Component, Show, createResource, createSignal } from 'solid-js';
import { Badge, Panel, Table, TableColumn } from '../components';
import { createApiClient } from '../api/client';
import { containerStatusToVariant, healthStatusToVariant } from '../status';
import type { PortMapping, ServiceDto } from '../api/types';
import './ServicesPage.css';

type ServiceAction = 'start' | 'stop' | 'restart';

const api = createApiClient();

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message.length > 0 ? err.message : fallback;
}

function formatPort(port: PortMapping): string {
  const host = port.host_port === null ? '?' : String(port.host_port);
  return `${host}:${port.container_port}`;
}

const SUCCESS_TIMEOUT_MS = 1500;

const ServicesPage: Component = () => {
  const [services, { refetch }] = createResource(() => api.getServices());
  const [pendingId, setPendingId] = createSignal<string | null>(null);
  const [lastSuccess, setLastSuccess] = createSignal<string | null>(null);
  const [actionError, setActionError] = createSignal<string | null>(null);

  const handleAction = async (id: string, action: ServiceAction): Promise<void> => {
    if (pendingId() !== null) return;
    setPendingId(id);
    setActionError(null);
    try {
      await api.performAction(id, action);
      await refetch();
      setLastSuccess(id);
      window.setTimeout(
        () => setLastSuccess((curr) => (curr === id ? null : curr)),
        SUCCESS_TIMEOUT_MS,
      );
    } catch (err) {
      setActionError(errorMessage(err, `${action} action failed`));
    } finally {
      setPendingId(null);
    }
  };

  const columns: TableColumn<ServiceDto>[] = [
    {
      key: 'service',
      header: 'Service',
      render: (row) => (
        <span class="services-page__service">
          {row.service_name ?? row.compose_service ?? row.container_name}
        </span>
      ),
    },
    {
      key: 'container',
      header: 'Container',
      render: (row) => <span class="services-page__mono">{row.container_name}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      render: (row) => (
        <Badge variant={containerStatusToVariant(row.status)} dot>
          {row.status}
        </Badge>
      ),
    },
    {
      key: 'health',
      header: 'Health',
      render: (row) => (
        <Badge variant={healthStatusToVariant(row.health)}>
          {row.health.length > 0 ? row.health : 'none'}
        </Badge>
      ),
    },
    {
      key: 'image',
      header: 'Image',
      render: (row) => (
        <span class="services-page__image">
          <span class="services-page__mono">{row.image}</span>
          <Show when={row.tag}>
            {(tag) => <span class="services-page__tag">:{tag()}</span>}
          </Show>
        </span>
      ),
    },
    {
      key: 'ports',
      header: 'Ports',
      render: (row) => (
        <Show
          when={row.ports.length > 0}
          fallback={<span class="services-page__muted">—</span>}
        >
          <span class="services-page__ports">{row.ports.map(formatPort).join(', ')}</span>
        </Show>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      render: (row) => (
        <div class="services-page__actions">
          <Show
            when={pendingId() !== row.id}
            fallback={<span class="services-page__action-spinner" role="status" />}
          >
            <button
              type="button"
              class="services-page__action-btn services-page__action-btn--start"
              title="Start"
              aria-label="Start service"
              disabled={pendingId() !== null}
              onClick={() => handleAction(row.id, 'start')}
            >
              <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                <path fill="currentColor" d="M8 5v14l11-7z" />
              </svg>
            </button>
            <button
              type="button"
              class="services-page__action-btn services-page__action-btn--stop"
              title="Stop"
              aria-label="Stop service"
              disabled={pendingId() !== null}
              onClick={() => handleAction(row.id, 'stop')}
            >
              <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                <path fill="currentColor" d="M6 6h12v12H6z" />
              </svg>
            </button>
            <button
              type="button"
              class="services-page__action-btn services-page__action-btn--restart"
              title="Restart"
              aria-label="Restart service"
              disabled={pendingId() !== null}
              onClick={() => handleAction(row.id, 'restart')}
            >
              <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                <path
                  fill="currentColor"
                  d="M17.65 6.35A7.95 7.95 0 0 0 12 4a8 8 0 1 0 7.74 10h-2.08A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"
                />
              </svg>
            </button>
          </Show>
          <Show when={lastSuccess() === row.id}>
            <span class="services-page__success" role="img" aria-label="Action completed">
              <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                <path
                  fill="currentColor"
                  d="M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"
                />
              </svg>
            </span>
          </Show>
        </div>
      ),
    },
  ];

  return (
    <div class="services-page">
      <Panel
        title="Services"
        actions={
          <button
            type="button"
            class="services-page__refresh"
            onClick={() => refetch()}
            disabled={services.loading || pendingId() !== null}
          >
            <svg
              class="services-page__refresh-icon"
              classList={{ 'services-page__refresh-icon--spin': services.loading }}
              viewBox="0 0 24 24"
              width="14"
              height="14"
              aria-hidden="true"
            >
              <path
                fill="currentColor"
                d="M17.65 6.35A7.95 7.95 0 0 0 12 4a8 8 0 1 0 7.74 10h-2.08A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"
              />
            </svg>
            <span>Refresh</span>
          </button>
        }
      >
        <Show when={actionError()}>
          {(msg) => <div class="services-page__action-error">{msg()}</div>}
        </Show>
        <Show
          when={services.error === undefined}
          fallback={
            <div class="services-page__state services-page__state--error">
              {errorMessage(services.error, 'Failed to load services')}
            </div>
          }
        >
          <Show
            when={services()}
            fallback={
              <div class="services-page__state">
                <span class="services-page__spinner" aria-hidden="true" />
                <span>Loading…</span>
              </div>
            }
          >
            {(list) => (
              <Table
                columns={columns}
                rows={list()}
                rowKey={(row) => row.id}
                emptyMessage="No services found"
              />
            )}
          </Show>
        </Show>
      </Panel>
    </div>
  );
};

export default ServicesPage;
