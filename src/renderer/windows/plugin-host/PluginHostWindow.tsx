import { Component, Match, Show, Switch, createSignal, onCleanup, onMount } from 'solid-js';
import { WindowWrapper } from '../../context';
import { WINDOW_TYPES } from '../../../shared/constants';
import { getBridge } from '../../../shared/bridges';
import type { PluginHostContext } from '../../../shared/plugins/types';
import { PluginHost } from '../../plugins/PluginHost';

export const PluginHostWindow: Component = () => {
  const [hostContext, setHostContext] = createSignal<PluginHostContext | null>(null);

  onMount(() => {
    const bridge = getBridge();
    const cleanup = bridge.window.onWindowContext((context) => {
      if (context) {
        setHostContext(context as unknown as PluginHostContext);
      }
    });

    bridge.window.getWindowContext(WINDOW_TYPES.PLUGIN_HOST);
    if (cleanup) {
      onCleanup(cleanup);
    }
  });

  return (
    <WindowWrapper showDragRegion={true}>
      <div class="plugin-host-window">
        <Switch>
          <Match when={hostContext()}>
            {(resolvedContext) => <PluginHost hostContext={resolvedContext()} />}
          </Match>
          <Match when={!hostContext()}>
            <Show when={true}>
              <p>Loading plugin UI...</p>
            </Show>
          </Match>
        </Switch>
      </div>
    </WindowWrapper>
  );
};

export default PluginHostWindow;
