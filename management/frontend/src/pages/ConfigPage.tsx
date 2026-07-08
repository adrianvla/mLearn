import { For, Show, createResource, type Component } from 'solid-js';
import { Badge, Panel } from '../components';
import { createApiClient } from '../api/client';
import type { AiConfig, ConfigDto, StoragePaths } from '../api/types';
import './ConfigPage.css';

const STORAGE_PATH_ENTRIES: ReadonlyArray<{ key: keyof StoragePaths; label: string }> = [
  { key: 'language_data', label: 'Language Data' },
  { key: 'ocr_data', label: 'OCR Data' },
  { key: 'model_cache', label: 'Model Cache' },
  { key: 'app_data', label: 'App Data' },
  { key: 'db', label: 'Database' },
  { key: 'uploads', label: 'Uploads' },
];

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return 'Unknown error';
}

const AiProviderLine: Component<{ label: string; config: AiConfig }> = (props) => {
  return (
    <div class="config-page__sub">
      <h4 class="config-page__sub-title">{props.label}</h4>
      <div class="config-page__inline">
        <Badge variant={props.config.enabled ? 'success' : 'neutral'} dot>
          {props.config.enabled ? 'Enabled' : 'Disabled'}
        </Badge>
        <Show
          when={props.config.provider_name}
          fallback={<span class="config-page__muted">not configured</span>}
        >
          {(name) => <code class="config-page__mono">{name()}</code>}
        </Show>
      </div>
    </div>
  );
};

const ConfigView: Component<{ data: ConfigDto }> = (props) => {
  return (
    <>
      <Panel title="Connection">
        <dl class="config-page__kv">
          <dt class="config-page__key">Bind Address</dt>
          <dd class="config-page__value">
            <code class="config-page__mono">{props.data.bind_address}</code>
          </dd>
          <dt class="config-page__key">Management Port</dt>
          <dd class="config-page__value">
            <code class="config-page__mono">{props.data.management_port}</code>
          </dd>
          <dt class="config-page__key">Public URLs</dt>
          <dd class="config-page__value">
            <Show
              when={props.data.public_urls.length > 0}
              fallback={<span class="config-page__muted">none</span>}
            >
              <For each={props.data.public_urls}>
                {(url) => <code class="config-page__chip">{url}</code>}
              </For>
            </Show>
          </dd>
        </dl>
      </Panel>

      <Panel title="AI Configuration">
        <AiProviderLine label="Local AI" config={props.data.local_ai} />
        <AiProviderLine label="Cloud AI" config={props.data.cloud_ai} />
      </Panel>

      <Panel title="Storage Paths">
        <dl class="config-page__kv">
          <For each={STORAGE_PATH_ENTRIES}>
            {(entry) => (
              <>
                <dt class="config-page__key">{entry.label}</dt>
                <dd class="config-page__value">
                  <Show
                    when={props.data.storage_paths[entry.key]}
                    fallback={<span class="config-page__muted">not configured</span>}
                  >
                    {(path) => <code class="config-page__mono">{path()}</code>}
                  </Show>
                </dd>
              </>
            )}
          </For>
        </dl>
      </Panel>

      <Panel title="Feature Flags">
        <div class="config-page__flags">
          <For each={props.data.feature_flags}>
            {(flag) => (
              <div class="config-page__flag">
                <span class="config-page__flag-name">{flag.name}</span>
                <Badge variant={flag.enabled ? 'success' : 'neutral'} dot>
                  {flag.enabled ? 'Enabled' : 'Disabled'}
                </Badge>
              </div>
            )}
          </For>
        </div>
      </Panel>
    </>
  );
};

const ConfigPage: Component = () => {
  const api = createApiClient();
  const [config] = createResource(() => api.getConfig());

  return (
    <div class="config-page">
      <Show
        when={config()}
        fallback={
          <Show
            when={config.error}
            fallback={
              <div class="config-page__state">
                <span class="config-page__spinner" aria-hidden="true" />
                <span>Loading configuration…</span>
              </div>
            }
          >
            <div class="config-page__state config-page__state--error">
              Failed to load configuration: {describeError(config.error)}
            </div>
          </Show>
        }
      >
        {(data) => <ConfigView data={data()} />}
      </Show>
    </div>
  );
};

export default ConfigPage;
