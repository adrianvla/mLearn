/**
 * PluginLoadError Component
 * The single "a plugin's UI could not be rendered" block, shared by the loader
 * failure in PluginHost and the render-time failure in PluginErrorBoundary.
 *
 * The heading is intentionally not localised: the plugin surface renders before
 * (and outside) the localized app chrome, and no `mlearn.*` key describes it.
 */

import { Component } from 'solid-js';

export interface PluginLoadErrorProps {
  /** Name of the plugin whose UI failed. */
  pluginName: string;
  /** Error text extracted by the caller. */
  message: string;
}

/**
 * PluginLoadError - Announcement block for a plugin UI failure
 */
export const PluginLoadError: Component<PluginLoadErrorProps> = (props) => (
  <div class="plugin-host__error" role="alert" aria-live="assertive">
    <h2>Plugin UI failed to load</h2>
    <p>{props.pluginName}</p>
    <p>{props.message}</p>
  </div>
);
