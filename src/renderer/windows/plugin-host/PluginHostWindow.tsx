import { Component, Match, Switch, createSignal, onCleanup, onMount } from 'solid-js';
import { WindowWrapper, useLocalization } from '../../context';
import { WINDOW_TYPES } from '../../../shared/constants';
import { getBridge } from '../../../shared/bridges';
import type { PluginHostContext } from '../../../shared/plugins/types';
import { PluginHost } from '../../plugins/PluginHost';

/**
 * Rendered INSIDE WindowWrapper: that component *provides* LocalizationProvider,
 * so a sibling of it — this window's own body — cannot read `t()`.
 */
const PluginContextBody: Component<{ hostContext: PluginHostContext | null }> = (props) => {
  const { t } = useLocalization();
  return (
    <div class="plugin-host-window">
      <Switch>
        <Match when={props.hostContext}>
          {(resolvedContext) => <PluginHost hostContext={resolvedContext()} />}
        </Match>
        <Match when={!props.hostContext}>
          <p>{t('mlearn.Plugin.Loading')}</p>
        </Match>
      </Switch>
    </div>
  );
};

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
      <PluginContextBody hostContext={hostContext()} />
    </WindowWrapper>
  );
};

export default PluginHostWindow;
