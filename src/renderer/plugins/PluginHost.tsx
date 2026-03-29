import { Component, Match, Show, Switch, createEffect, createMemo, createResource, createSignal } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { getBridge } from '../../shared/bridges';
import type { PluginHostContext } from '../../shared/plugins/types';
import { PluginErrorBoundary } from './PluginErrorBoundary';
import { SchemaRenderer } from './SchemaRenderer';

type PluginHostApi = {
  kvGet: (key: string) => Promise<string | null>;
  kvSet: (key: string, value: string) => Promise<void>;
  kvRemove: (key: string) => Promise<void>;
  closeWindow: () => void;
};

type PluginComponentProps = {
  context: Record<string, unknown>;
  host: PluginHostApi;
};

type PluginComponent = Component<PluginComponentProps>;

interface PluginHostProps {
  hostContext: PluginHostContext;
  loadComponent?: (componentUrl: string) => Promise<PluginComponent>;
}

export const PluginHost: Component<PluginHostProps> = (props) => {
  const bridge = getBridge();

  const mergedContext = createMemo<Record<string, unknown>>(() => {
    const ui = props.hostContext.ui;
    const initialData = ui.type === 'schema' ? (ui.initialData ?? {}) : {};
    return {
      ...initialData,
      ...(props.hostContext.initialContext ?? {}),
    };
  });

const host = createMemo<PluginHostApi>(() => ({
    kvGet: async (key) => (await bridge.plugins.pluginKVGet(props.hostContext.pluginId, key)).value,
    kvSet: (key, value) => bridge.plugins.pluginKVSet(props.hostContext.pluginId, key, value),
    kvRemove: (key) => bridge.plugins.pluginKVRemove(props.hostContext.pluginId, key),
    closeWindow: () => bridge.window.closeWindow(),
  }));

  const componentUrl = createMemo(() => {
    const ui = props.hostContext.ui;
    if (ui.type !== 'component') {
      return null;
    }
    return ui.componentUrl ?? null;
  });

  const [component, setComponent] = createSignal<PluginComponent | null>(null);
  const [loadingComponent, setLoadingComponent] = createSignal(false);
  const [loadError, setLoadError] = createSignal<string | null>(null);
  const schemaPluginId = createMemo(() => {
    return props.hostContext.ui.type === 'schema' ? props.hostContext.pluginId : null;
  });

  const [persistedSchemaData] = createResource(schemaPluginId, async (pluginId) => {
    const result = await bridge.plugins.pluginKVGet(pluginId, 'plugin-host:schema-state');
    if (!result.value) {
      return null;
    }

    const parsed: unknown = JSON.parse(result.value);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }

    return null;
  });

  const [schemaDraft, setSchemaDraft] = createSignal<Record<string, unknown> | null>(null);

  createEffect(() => {
    if (props.hostContext.ui.type !== 'schema') {
      setSchemaDraft(null);
    }
  });

  const schemaData = createMemo<Record<string, unknown>>(() => {
    return schemaDraft() ?? persistedSchemaData() ?? mergedContext();
  });

  const handleSchemaChange = (nextData: Record<string, unknown>) => {
    setSchemaDraft(nextData);
    void bridge.plugins.pluginKVSet(
      props.hostContext.pluginId,
      'plugin-host:schema-state',
      JSON.stringify(nextData),
    );
  };

  createEffect(() => {
    const resolvedComponentUrl = componentUrl();
    if (!resolvedComponentUrl) {
      setComponent(null);
      setLoadingComponent(false);
      setLoadError(null);
      return;
    }

    const loader = props.loadComponent ?? (async (url: string) => {
      const module = await import(/* @vite-ignore */ url);
      return (module.default ?? module.PluginWindow ?? module.PluginComponent) as PluginComponent;
    });

    setLoadingComponent(true);
    setLoadError(null);
    setComponent(null);

    void loader(resolvedComponentUrl)
      .then((resolvedComponent) => {
        setComponent(() => resolvedComponent);
      })
      .catch((error: unknown) => {
        setLoadError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        setLoadingComponent(false);
      });
  });

  return (
    <div class="plugin-host">
      <header class="plugin-host__header">
        <h1 class="plugin-host__title">{props.hostContext.pluginName}</h1>
      </header>

      <main class="plugin-host__body">
        <Switch>
          <Match when={props.hostContext.ui.type === 'schema'}>
            <SchemaRenderer
              schema={props.hostContext.ui.type === 'schema' ? props.hostContext.ui.schema : {}}
              data={schemaData()}
              onChange={handleSchemaChange}
            />
          </Match>
          <Match when={props.hostContext.ui.type === 'component'}>
            <Show when={!loadingComponent()} fallback={<p>Loading plugin UI...</p>}>
              <Show when={loadError()}>
                {(errorMessage) => (
                  <div class="plugin-host__error" role="alert" aria-live="assertive">
                    <h2>Plugin UI failed to load</h2>
                    <p>{props.hostContext.pluginName}</p>
                    <p>{errorMessage()}</p>
                  </div>
                )}
              </Show>
              <Show when={component()}>
                {(ResolvedComponent) => (
                  <PluginErrorBoundary pluginName={props.hostContext.pluginName}>
                    <Dynamic component={ResolvedComponent()} context={mergedContext()} host={host()} />
                  </PluginErrorBoundary>
                )}
              </Show>
            </Show>
          </Match>
        </Switch>
      </main>
    </div>
  );
};

export default PluginHost;
