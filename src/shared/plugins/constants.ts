/**
 * Plugin system constants.
 */

export const PLUGIN_API_VERSION = '1.0.0';

export const PLUGIN_IPC_CHANNELS = {
  PLUGIN_LIST: 'plugin:list',
  PLUGIN_STATUS_UPDATE: 'plugin:status-update',
  PLUGIN_INSTALL_RESULT: 'plugin:install-result',
  PLUGIN_BUS_VALUE_CHANGED: 'plugin:bus-value-changed',
  PLUGIN_BUS_EVENT_EMITTED: 'plugin:bus-event-emitted',
  PLUGIN_GET_LIST: 'plugin:get-list',
  PLUGIN_BUS_GET_VALUE: 'plugin:bus-get-value',
  PLUGIN_BUS_GET_VALUE_SYNC: 'plugin:bus-get-value-sync',
  PLUGIN_BUS_SET_VALUE: 'plugin:bus-set-value',
  PLUGIN_BUS_EMIT_EVENT: 'plugin:bus-emit-event',
  PLUGIN_BUS_SET_SCOPED_VALUE: 'plugin:bus-set-scoped-value',
  PLUGIN_ENABLE: 'plugin:enable',
  PLUGIN_DISABLE: 'plugin:disable',
  PLUGIN_UNINSTALL: 'plugin:uninstall',
  PLUGIN_INSTALL_FROM_PATH: 'plugin:install-from-path',
  PLUGIN_SELECT_AND_INSTALL: 'plugin:select-and-install',
  PLUGIN_GRANT_PERMISSIONS: 'plugin:grant-permissions',
  PLUGIN_KV_GET: 'plugin:kv-get',
  PLUGIN_KV_SET: 'plugin:kv-set',
  PLUGIN_KV_REMOVE: 'plugin:kv-remove',
  PLUGIN_OPEN_WINDOW: 'plugin:open-window',
} as const;

export type PluginIPCChannel = typeof PLUGIN_IPC_CHANNELS[keyof typeof PLUGIN_IPC_CHANNELS];
