/**
 * PluginLoadError Component
 * The single "a plugin's UI could not be rendered" block, shared by the loader
 * failure in PluginHost and the render-time failure in PluginErrorBoundary.
 */

import { Component } from 'solid-js';
import { useLocalization } from '../context';

export interface PluginLoadErrorProps {
  /** Name of the plugin whose UI failed. */
  pluginName: string;
  /** Error text extracted by the caller. */
  message: string;
}

/**
 * PluginLoadError - Announcement block for a plugin UI failure
 */
export const PluginLoadError: Component<PluginLoadErrorProps> = (props) => {
  const { t } = useLocalization();
  return (
    <div class="plugin-host__error" role="alert" aria-live="assertive">
      <h2>{t('mlearn.Plugin.UiFailed')}</h2>
      <p>{props.pluginName}</p>
      <p>{props.message}</p>
    </div>
  );
};
