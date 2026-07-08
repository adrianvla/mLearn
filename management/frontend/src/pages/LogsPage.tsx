import { Component, For, Show, createEffect, createResource, createSignal } from 'solid-js';
import { Panel } from '../components';
import LogViewer from '../components/LogViewer';
import { createApiClient } from '../api/client';
import './LogsPage.css';

const api = createApiClient();

const TAIL_OPTIONS: readonly number[] = [50, 100, 300, 500];

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message.length > 0 ? err.message : fallback;
}

const LogsPage: Component = () => {
  const [services] = createResource(() => api.getServices());
  const [selectedService, setSelectedService] = createSignal<string | null>(null);
  const [tail, setTail] = createSignal<number>(300);
  const [logs, { refetch }] = createResource(
    () => {
      const id = selectedService();
      return id === null ? null : { id, tail: tail() };
    },
    (source) => api.getLogs(source.id, source.tail),
  );

  createEffect(() => {
    const list = services();
    if (list !== undefined && list.length > 0 && selectedService() === null) {
      setSelectedService(list[0].id);
    }
  });

  return (
    <div class="logs-page">
      <Panel
        title="Container Logs"
        actions={
          <button
            type="button"
            class="logs-page__refresh"
            onClick={() => refetch()}
            disabled={selectedService() === null}
          >
            <svg
              class="logs-page__refresh-icon"
              classList={{ 'logs-page__refresh-icon--spin': logs.loading }}
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
        <div class="logs-page__toolbar">
          <label class="logs-page__field">
            <span class="logs-page__field-label">Service</span>
            <select
              class="logs-page__select"
              value={selectedService() ?? ''}
              onChange={(e) => {
                const value = e.currentTarget.value;
                setSelectedService(value.length > 0 ? value : null);
              }}
            >
              <option value="" disabled>
                Select a service…
              </option>
              <For each={services() ?? []}>
                {(service) => (
                  <option value={service.id}>
                    {service.service_name ?? service.compose_service ?? service.container_name}
                  </option>
                )}
              </For>
            </select>
          </label>
          <div class="logs-page__field">
            <span class="logs-page__field-label">Lines</span>
            <div class="logs-page__tail-group">
              <For each={TAIL_OPTIONS}>
                {(n) => (
                  <button
                    type="button"
                    class="logs-page__tail-btn"
                    classList={{ 'logs-page__tail-btn--active': tail() === n }}
                    aria-pressed={tail() === n}
                    onClick={() => setTail(n)}
                  >
                    {n}
                  </button>
                )}
              </For>
            </div>
          </div>
        </div>
      </Panel>

      <div class="logs-page__viewer">
        <Show
          when={selectedService() !== null}
          fallback={<div class="logs-page__placeholder">Select a service to view its logs.</div>}
        >
          <Show
            when={logs.error === undefined}
            fallback={
              <div class="logs-page__state logs-page__state--error">
                {errorMessage(logs.error, 'Failed to load logs')}
              </div>
            }
          >
            <Show
              when={logs()}
              fallback={
                <div class="logs-page__state">
                  <span class="logs-page__spinner" aria-hidden="true" />
                  <span>Loading…</span>
                </div>
              }
            >
              {(data) => (
                <>
                  <LogViewer
                    lines={data().lines}
                    loading={logs.loading}
                    onRefresh={() => refetch()}
                    maxHeight="60vh"
                  />
                  <Show when={data().truncated}>
                    <div class="logs-page__notice">
                      Output truncated by the backend. Increase the line count for more history.
                    </div>
                  </Show>
                </>
              )}
            </Show>
          </Show>
        </Show>
      </div>
    </div>
  );
};

export default LogsPage;
