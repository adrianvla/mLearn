import { For, Show, createResource, type Component } from 'solid-js';
import { Badge, Panel } from '../components';
import { createApiClient } from '../api/client';
import { deploymentModeToVariant } from '../status';
import type { SchoolDto } from '../api/types';
import './SchoolPage.css';

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return 'Unknown error';
}

const SchoolView: Component<{ data: SchoolDto }> = (props) => {
  return (
    <>
      <Panel title="Deployment Status">
        <dl class="school-page__kv">
          <dt class="school-page__key">Deployment Mode</dt>
          <dd class="school-page__value">
            <Badge variant={deploymentModeToVariant(props.data.deployment_mode)} dot>
              {props.data.deployment_mode}
            </Badge>
          </dd>
          <dt class="school-page__key">Public Cloud LLM Access</dt>
          <dd class="school-page__value">
            <Badge
              variant={props.data.public_cloud_llm_access ? 'warning' : 'success'}
              dot
            >
              {props.data.public_cloud_llm_access ? 'Enabled' : 'Disabled'}
            </Badge>
          </dd>
          <dt class="school-page__key">Admin Authentication</dt>
          <dd class="school-page__value">
            <Badge variant={props.data.admin_auth_enabled ? 'success' : 'error'} dot>
              {props.data.admin_auth_enabled ? 'Enabled' : 'Disabled'}
            </Badge>
          </dd>
          <dt class="school-page__key">Console Binding</dt>
          <dd class="school-page__value">
            <Badge
              variant={props.data.console_bound_locally ? 'success' : 'warning'}
              dot
            >
              {props.data.console_bound_locally ? 'Localhost only' : 'Network-exposed'}
            </Badge>
          </dd>
        </dl>
      </Panel>

      <Panel title="Safety Warnings">
        <Show
          when={props.data.warnings.length > 0}
          fallback={
            <div class="school-page__ok">
              <Badge variant="success" dot>All clear</Badge>
              <span>No safety issues detected.</span>
            </div>
          }
        >
          <ul class="school-page__list">
            <For each={props.data.warnings}>
              {(warning) => (
                <li class="school-page__list-item">
                  <Badge variant="error" dot>Warning</Badge>
                  <span>{warning}</span>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </Panel>

      <Panel title="Deployment Notes">
        <Show
          when={props.data.notes.length > 0}
          fallback={<div class="school-page__muted">No deployment notes.</div>}
        >
          <ul class="school-page__notes">
            <For each={props.data.notes}>
              {(note) => <li class="school-page__note">{note}</li>}
            </For>
          </ul>
        </Show>
      </Panel>
    </>
  );
};

const SchoolPage: Component = () => {
  const api = createApiClient();
  const [school] = createResource(() => api.getSchool());

  return (
    <div class="school-page">
      <Show
        when={school()}
        fallback={
          <Show
            when={school.error}
            fallback={
              <div class="school-page__state">
                <span class="school-page__spinner" aria-hidden="true" />
                <span>Loading school status…</span>
              </div>
            }
          >
            <div class="school-page__state school-page__state--error">
              Failed to load school status: {describeError(school.error)}
            </div>
          </Show>
        }
      >
        {(data) => <SchoolView data={data()} />}
      </Show>
    </div>
  );
};

export default SchoolPage;
