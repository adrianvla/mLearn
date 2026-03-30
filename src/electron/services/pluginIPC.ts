import fs from 'fs';
import path from 'path';
import { BrowserWindow, ipcMain } from 'electron';
import { WINDOW_TYPES } from '../../shared/constants';
import { PLUGIN_IPC_CHANNELS } from '../../shared/plugins/constants';
import type { PluginBusEnvelope, PluginBusJSONValue, PluginBusPublisher } from '../../shared/pluginBus';
import type {
  PluginHostContext,
  PluginInstallResult,
  PluginKVGetResult,
  PluginManifest,
  PluginState,
  PluginWindowPayload,
} from '../../shared/plugins/types';
import {
  disablePlugin,
  enablePlugin,
  getPluginManifest,
  getPluginsDir,
  grantPermissions,
  listPlugins,
  normalizePluginId,
  removePluginFromRegistry,
} from './pluginManager';
import { createPluginBusStore } from './pluginBus';
import { installPlugin, selectAndInstallPlugin, uninstallPlugin } from './pluginInstaller';
import { openManagedChildWindow } from './windowManager';

const pluginBusStore = createPluginBusStore();
const pluginHostPublishers = new Map<number, PluginBusPublisher>();

function broadcast(channel: string, payload: unknown): void {
  const windows = BrowserWindow.getAllWindows();
  for (const window of windows) {
    if (!window.isDestroyed()) {
      window.webContents.send(channel, payload);
    }
  }
}

function broadcastPluginList(): PluginState[] {
  const plugins = listPlugins();
  broadcast(PLUGIN_IPC_CHANNELS.PLUGIN_LIST, plugins);
  return plugins;
}

function broadcastPluginState(plugin: PluginState | null): PluginState | null {
  if (plugin) {
    broadcast(PLUGIN_IPC_CHANNELS.PLUGIN_STATUS_UPDATE, plugin);
    broadcastPluginList();
  }
  return plugin;
}

function broadcastPluginValueChange(channel: string, nextValue: PluginBusEnvelope, previousValue: PluginBusEnvelope): void {
  broadcast(PLUGIN_IPC_CHANNELS.PLUGIN_BUS_VALUE_CHANGED, {
    channel,
    nextValue,
    previousValue,
  });
}

function normalizePluginBusValue(value: PluginBusJSONValue): PluginBusJSONValue {
  if (value === null || typeof value !== 'object') {
    return value
  }

  if (Array.isArray(value)) {
    return value.map((entry) => normalizePluginBusValue(entry))
  }

  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, normalizePluginBusValue(value[key])]),
  )
}

function arePluginBusEnvelopesEqual(left: PluginBusEnvelope, right: PluginBusEnvelope): boolean {
  if (left.hasValue !== right.hasValue) {
    return false
  }

  if (!left.hasValue || !right.hasValue) {
    return true
  }

  return JSON.stringify(normalizePluginBusValue(left.value)) === JSON.stringify(normalizePluginBusValue(right.value))
}

function broadcastPluginEvent(channel: string, payload: PluginBusJSONValue): void {
  broadcast(PLUGIN_IPC_CHANNELS.PLUGIN_BUS_EVENT_EMITTED, {
    channel,
    payload,
  });
}

function isPluginHostSender(sender: Electron.WebContents | undefined): boolean {
  if (!sender || typeof sender.getURL !== 'function') {
    return false
  }

  return sender.getURL().includes('/plugin-host.html')
}

function getPluginPublisher(sender: Electron.WebContents): PluginBusPublisher {
  return pluginHostPublishers.get(sender.id) ?? { scope: 'plugin', pluginId: 'host' };
}

function isPathWithinDirectory(directoryPath: string, candidatePath: string): boolean {
  const resolvedDirectoryPath = path.resolve(directoryPath);
  const resolvedCandidatePath = path.resolve(candidatePath);

  return resolvedCandidatePath === resolvedDirectoryPath || resolvedCandidatePath.startsWith(`${resolvedDirectoryPath}${path.sep}`);
}

function getSafePluginKVPath(pluginId: string): string | null {
  const pluginsDir = getPluginsDir();
  const pluginBaseDir = path.resolve(pluginsDir, pluginId);
  if (!isPathWithinDirectory(pluginsDir, pluginBaseDir)) {
    return null;
  }

  const resolvedKVPath = path.resolve(pluginBaseDir, '.kv.json');

  if (!isPathWithinDirectory(pluginBaseDir, resolvedKVPath)) {
    return null;
  }

  return resolvedKVPath;
}

function canUsePluginPermission(pluginId: string, permission: PluginManifest['permissions'][number]): boolean {
  const plugin = listPlugins().find((entry) => entry.id === pluginId);
  if (!plugin || !plugin.permissionsGranted) {
    return false;
  }

  return plugin.permissions.includes(permission);
}

function buildPluginHostContext(
  payload: PluginWindowPayload,
  manifest: PluginManifest,
  pluginPath: string,
): PluginHostContext | null {
  if (!manifest.ui) {
    return null;
  }

  let ui = manifest.ui;
  if (ui.type === 'component') {
    const componentAbsolutePath = path.resolve(pluginPath, ui.componentPath);
    if (!isPathWithinDirectory(pluginPath, componentAbsolutePath)) {
      return null;
    }

    const componentRelativePath = path.relative(pluginPath, componentAbsolutePath).split(path.sep).join('/');

    ui = {
      ...ui,
      componentUrl: `plugin-ui://${encodeURIComponent(manifest.id)}/${componentRelativePath}`,
    };
  }

  return {
    pluginId: manifest.id,
    pluginName: manifest.name,
    ui,
    initialContext: payload.context,
  };
}

function loadPluginKV(pluginId: string): Record<string, string> {
  const kvPath = getSafePluginKVPath(pluginId);
  if (!kvPath) {
    return {};
  }

  try {
    if (!fs.existsSync(kvPath)) {
      return {};
    }

    const parsed: unknown = JSON.parse(fs.readFileSync(kvPath, 'utf-8'));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return Object.fromEntries(
        Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
      );
    }
  } catch (error) {
    console.error('[pluginIPC] Failed to read plugin KV store:', error);
  }

  return {};
}

function savePluginKV(pluginId: string, store: Record<string, string>): void {
  const kvPath = getSafePluginKVPath(pluginId);
  if (!kvPath) {
    return;
  }

  fs.mkdirSync(path.dirname(kvPath), { recursive: true });
  fs.writeFileSync(kvPath, JSON.stringify(store, null, 2), 'utf-8');
}

export function setupPluginIPC(): void {
  pluginBusStore.onPluginValue('app.user.activity', (nextValue, previousValue) => {
    broadcastPluginValueChange('app.user.activity', nextValue, previousValue);
  });

  ipcMain.handle(PLUGIN_IPC_CHANNELS.PLUGIN_GET_LIST, async (): Promise<PluginState[]> => {
    return broadcastPluginList();
  });

  ipcMain.handle(PLUGIN_IPC_CHANNELS.PLUGIN_BUS_GET_VALUE, async (_event, channel: string): Promise<PluginBusEnvelope> => {
    return pluginBusStore.getPluginValue(channel);
  });

  ipcMain.on(PLUGIN_IPC_CHANNELS.PLUGIN_BUS_GET_VALUE_SYNC, (event, channel: string): void => {
    event.returnValue = pluginBusStore.getPluginValue(channel)
  });

  ipcMain.handle(PLUGIN_IPC_CHANNELS.PLUGIN_BUS_SET_VALUE, async (event, channel: string, value: PluginBusJSONValue): Promise<void> => {
    const previousValue = pluginBusStore.getPluginValue(channel);
    pluginBusStore.setPluginValue(getPluginPublisher(event.sender), channel, value);
    const nextValue = pluginBusStore.getPluginValue(channel);

    if (channel !== 'app.user.activity' && !arePluginBusEnvelopesEqual(previousValue, nextValue)) {
      broadcastPluginValueChange(channel, nextValue, previousValue);
    }
  });

  ipcMain.handle(PLUGIN_IPC_CHANNELS.PLUGIN_BUS_EMIT_EVENT, async (event, channel: string, payload: PluginBusJSONValue): Promise<void> => {
    pluginBusStore.emitPluginEvent(getPluginPublisher(event.sender), channel, payload);
    broadcastPluginEvent(channel, payload);
  });

  ipcMain.on(PLUGIN_IPC_CHANNELS.PLUGIN_BUS_SET_SCOPED_VALUE, (event, payload: {
    sourceId: string;
    isFocused: boolean;
    channel: string;
    value: PluginBusJSONValue;
  }): void => {
    if (isPluginHostSender(event.sender)) {
      return
    }

    const previousValue = pluginBusStore.getPluginValue(payload.channel);
    pluginBusStore.setAppSourceFocused(payload.sourceId, payload.isFocused);
    pluginBusStore.setAppScopedValue(payload.channel, payload.sourceId, payload.value);
    const nextValue = pluginBusStore.getPluginValue(payload.channel);

    if (payload.channel !== 'app.user.activity' && !arePluginBusEnvelopesEqual(previousValue, nextValue)) {
      broadcastPluginValueChange(payload.channel, nextValue, previousValue);
    }
  });

  ipcMain.handle(PLUGIN_IPC_CHANNELS.PLUGIN_ENABLE, async (_event, pluginId: string): Promise<PluginState | null> => {
    return broadcastPluginState(await enablePlugin(pluginId));
  });

  ipcMain.handle(PLUGIN_IPC_CHANNELS.PLUGIN_DISABLE, async (_event, pluginId: string): Promise<PluginState | null> => {
    return broadcastPluginState(await disablePlugin(pluginId));
  });

  ipcMain.handle(PLUGIN_IPC_CHANNELS.PLUGIN_GRANT_PERMISSIONS, async (_event, pluginId: string): Promise<PluginState | null> => {
    return broadcastPluginState(await grantPermissions(pluginId));
  });

  ipcMain.handle(PLUGIN_IPC_CHANNELS.PLUGIN_INSTALL_FROM_PATH, async (_event, sourcePath: string): Promise<PluginInstallResult> => {
    const result = await installPlugin(sourcePath);
    broadcast(PLUGIN_IPC_CHANNELS.PLUGIN_INSTALL_RESULT, result);
    broadcastPluginList();
    return result;
  });

  ipcMain.handle(PLUGIN_IPC_CHANNELS.PLUGIN_SELECT_AND_INSTALL, async (): Promise<PluginInstallResult> => {
    const result = await selectAndInstallPlugin();
    broadcast(PLUGIN_IPC_CHANNELS.PLUGIN_INSTALL_RESULT, result);
    broadcastPluginList();
    return result;
  });

  ipcMain.handle(PLUGIN_IPC_CHANNELS.PLUGIN_UNINSTALL, async (_event, pluginId: string): Promise<boolean> => {
    let normalizedPluginId: string;
    try {
      normalizedPluginId = normalizePluginId(pluginId, getPluginsDir());
    } catch {
      return false;
    }

    const installedPlugin = listPlugins().find((entry) => entry.id === normalizedPluginId);
    if (installedPlugin?.status === 'active' || installedPlugin?.status === 'error' || installedPlugin?.status === 'pending') {
      await disablePlugin(normalizedPluginId);
    }

    const removedFromDisk = await uninstallPlugin(normalizedPluginId);
    if (!removedFromDisk) {
      return false;
    }

    const removedFromRegistry = removePluginFromRegistry(normalizedPluginId);
    if (removedFromRegistry) {
      broadcastPluginList();
    }
    return removedFromRegistry;
  });

  ipcMain.handle(PLUGIN_IPC_CHANNELS.PLUGIN_KV_GET, async (_event, pluginId: string, key: string): Promise<PluginKVGetResult> => {
    if (!canUsePluginPermission(pluginId, 'kv-store')) {
      return { value: null };
    }

    if (!getSafePluginKVPath(pluginId)) {
      return { value: null };
    }

    const store = loadPluginKV(pluginId);
    return { value: store[key] ?? null };
  });

  ipcMain.handle(PLUGIN_IPC_CHANNELS.PLUGIN_KV_SET, async (_event, pluginId: string, key: string, value: string): Promise<void> => {
    if (!canUsePluginPermission(pluginId, 'kv-store')) {
      return;
    }

    if (!getSafePluginKVPath(pluginId)) {
      return;
    }

    const store = loadPluginKV(pluginId);
    store[key] = value;
    savePluginKV(pluginId, store);
  });

  ipcMain.handle(PLUGIN_IPC_CHANNELS.PLUGIN_KV_REMOVE, async (_event, pluginId: string, key: string): Promise<void> => {
    if (!canUsePluginPermission(pluginId, 'kv-store')) {
      return;
    }

    if (!getSafePluginKVPath(pluginId)) {
      return;
    }

    const store = loadPluginKV(pluginId);
    delete store[key];
    savePluginKV(pluginId, store);
  });

  ipcMain.handle(PLUGIN_IPC_CHANNELS.PLUGIN_OPEN_WINDOW, async (_event, payload: PluginWindowPayload): Promise<boolean> => {
    if (!canUsePluginPermission(payload.pluginId, 'open-window')) {
      return false;
    }

    const manifest = getPluginManifest(payload.pluginId);
    if (!manifest) {
      return false;
    }

    const plugin = listPlugins().find((entry) => entry.id === payload.pluginId);
    if (!plugin) {
      return false;
    }

    const hostContext = buildPluginHostContext(payload, manifest, plugin.pluginPath);
    if (!hostContext) {
      return false;
    }

    const hostWindow = openManagedChildWindow(
      WINDOW_TYPES.PLUGIN_HOST,
      { width: 720, height: 520 },
      hostContext as unknown as Record<string, unknown>,
    );
    if (hostWindow?.webContents?.id !== undefined) {
      pluginHostPublishers.set(hostWindow.webContents.id, { scope: 'plugin', pluginId: payload.pluginId });
    }
    return true;
  });
}
