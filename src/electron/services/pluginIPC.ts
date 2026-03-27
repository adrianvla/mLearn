import fs from 'fs';
import path from 'path';
import { BrowserWindow, ipcMain } from 'electron';
import { WINDOW_TYPES } from '../../shared/constants';
import { PLUGIN_IPC_CHANNELS } from '../../shared/plugins/constants';
import type {
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
} from './pluginManager';

type InstallerModule = {
  installPluginFromPath?: (sourcePath: string) => Promise<PluginInstallResult>;
  selectAndInstallPlugin?: () => Promise<PluginInstallResult>;
  uninstallPlugin?: (pluginId: string) => Promise<boolean>;
};

function broadcast(channel: string, payload: PluginState[] | PluginState | PluginInstallResult): void {
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

function requireInstaller(): InstallerModule | null {
  try {
    return require('./pluginInstaller') as InstallerModule;
  } catch {
    return null;
  }
}

async function fallbackInstallResult(): Promise<PluginInstallResult> {
  const result = { success: false, error: 'Plugin installer not implemented yet' };
  broadcast(PLUGIN_IPC_CHANNELS.PLUGIN_INSTALL_RESULT, result);
  return result;
}

export function setupPluginIPC(): void {
  ipcMain.handle(PLUGIN_IPC_CHANNELS.PLUGIN_GET_LIST, async (): Promise<PluginState[]> => {
    return broadcastPluginList();
  });

  ipcMain.handle(PLUGIN_IPC_CHANNELS.PLUGIN_ENABLE, async (_event, pluginId: string): Promise<PluginState | null> => {
    return broadcastPluginState(enablePlugin(pluginId));
  });

  ipcMain.handle(PLUGIN_IPC_CHANNELS.PLUGIN_DISABLE, async (_event, pluginId: string): Promise<PluginState | null> => {
    return broadcastPluginState(disablePlugin(pluginId));
  });

  ipcMain.handle(PLUGIN_IPC_CHANNELS.PLUGIN_GRANT_PERMISSIONS, async (_event, pluginId: string): Promise<PluginState | null> => {
    return broadcastPluginState(grantPermissions(pluginId));
  });

  ipcMain.handle(PLUGIN_IPC_CHANNELS.PLUGIN_INSTALL_FROM_PATH, async (_event, sourcePath: string): Promise<PluginInstallResult> => {
    const installer = requireInstaller();
    if (!installer?.installPluginFromPath) {
      return fallbackInstallResult();
    }

    const result = await installer.installPluginFromPath(sourcePath);
    broadcast(PLUGIN_IPC_CHANNELS.PLUGIN_INSTALL_RESULT, result);
    broadcastPluginList();
    return result;
  });

  ipcMain.handle(PLUGIN_IPC_CHANNELS.PLUGIN_SELECT_AND_INSTALL, async (): Promise<PluginInstallResult> => {
    const installer = requireInstaller();
    if (!installer?.selectAndInstallPlugin) {
      return fallbackInstallResult();
    }

    const result = await installer.selectAndInstallPlugin();
    broadcast(PLUGIN_IPC_CHANNELS.PLUGIN_INSTALL_RESULT, result);
    broadcastPluginList();
    return result;
  });

  ipcMain.handle(PLUGIN_IPC_CHANNELS.PLUGIN_UNINSTALL, async (_event, pluginId: string): Promise<boolean> => {
    const installer = requireInstaller();
    if (!installer?.uninstallPlugin) {
      return false;
    }

    const result = await installer.uninstallPlugin(pluginId);
    if (result) {
      broadcastPluginList();
    }
    return result;
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

    void payload;
    void WINDOW_TYPES.PLUGIN_HOST;
    // Deferred to Task 7: plugin-host.html does not exist yet, so opening a window here would create a runtime-broken path.
    return false;
  });
}
