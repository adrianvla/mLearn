import { For, Show, createResource, type Component } from 'solid-js';
import { Badge, Panel } from '../components';
import { createApiClient } from '../api/client';
import type { AiStatusDto } from '../api/types';
import './AiStatusPage.css';

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return 'Unknown error';
}

const AiStatusView: Component<{ data: AiStatusDto }> = (props) => {
  return (
    <>
      <Show when={props.data.cloud_ai.enabled}>
        <div class="ai-page__notice" role="status">
          <Badge variant="warning" dot>Notice</Badge>
          <span>
            Cloud LLM access is enabled. Age-gating and consent review may be required for this deployment.
          </span>
        </div>
      </Show>

      <Panel title="Local AI">
        <div class="ai-page__inline">
          <Badge variant={props.data.local_ai.enabled ? 'success' : 'neutral'} dot>
            {props.data.local_ai.enabled ? 'Enabled' : 'Disabled'}
          </Badge>
          <Show
            when={props.data.local_ai.provider_name}
            fallback={<span class="ai-page__muted">no provider configured</span>}
          >
            {(name) => <code class="ai-page__mono">{name()}</code>}
          </Show>
          <Show when={props.data.local_ai.service_status}>
            {(status) => (
              <span class="ai-page__status">
                <span class="ai-page__status-label">Service:</span>
                <code class="ai-page__mono">{status()}</code>
              </span>
            )}
          </Show>
        </div>
      </Panel>

      <Panel title="Cloud AI">
        <div class="ai-page__inline">
          <Badge variant={props.data.cloud_ai.enabled ? 'success' : 'neutral'} dot>
            {props.data.cloud_ai.enabled ? 'Enabled' : 'Disabled'}
          </Badge>
          <Show
            when={props.data.cloud_ai.provider_names.length > 0}
            fallback={<span class="ai-page__muted">no providers configured</span>}
          >
            <For each={props.data.cloud_ai.provider_names}>
              {(name) => <code class="ai-page__chip">{name}</code>}
            </For>
          </Show>
        </div>
        <Show when={props.data.cloud_ai.school_mode_warning}>
          {(warning) => (
            <div class="ai-page__warning">
              <Badge variant="warning" dot>School Mode</Badge>
              <span class="ai-page__warning-text">{warning()}</span>
            </div>
          )}
        </Show>
      </Panel>

      <Panel title="Warnings">
        <Show
          when={props.data.warnings.length > 0}
          fallback={
            <div class="ai-page__ok">
              <Badge variant="success" dot>All clear</Badge>
              <span>No warnings.</span>
            </div>
          }
        >
          <ul class="ai-page__list">
            <For each={props.data.warnings}>
              {(warning) => (
                <li class="ai-page__list-item">
                  <Badge variant="warning" dot>Warning</Badge>
                  <span>{warning}</span>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </Panel>
    </>
  );
};

const AiStatusPage: Component = () => {
  const api = createApiClient();
  const [ai] = createResource(() => api.getAiStatus());

  return (
    <div class="ai-page">
      <Show
        when={ai()}
        fallback={
          <Show
            when={ai.error}
            fallback={
              <div class="ai-page__state">
                <span class="ai-page__spinner" aria-hidden="true" />
                <span>Loading AI status…</span>
              </div>
            }
          >
            <div class="ai-page__state ai-page__state--error">
              Failed to load AI status: {describeError(ai.error)}
            </div>
          </Show>
        }
      >
        {(data) => <AiStatusView data={data()} />}
      </Show>
    </div>
  );
};

export default AiStatusPage;
