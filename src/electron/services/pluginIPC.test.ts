import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WINDOW_TYPES } from '../../shared/constants';
import { PLUGIN_IPC_CHANNELS } from '../../shared/plugins/constants';
import type { PluginManifest, PluginState } from '../../shared/plugins/types';

const ipcHandleHandlers = new Map<string, (...args: unknown[]) => unknown>();

const mockDisablePlugin = vi.fn();
const mockListPlugins = vi.fn<() => PluginState[]>();
const mockGetPluginManifest = vi.fn<(pluginId: string) => PluginManifest | null>();
const mockOpenManagedChildWindow = vi.fn();
const mockRemovePluginFromRegistry = vi.fn();
const mockUninstallPlugin = vi.fn();

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: vi.fn(() => []),
  },
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      ipcHandleHandlers.set(channel, handler);
    }),
  },
}));

vi.mock('./pluginManager', () => ({
  disablePlugin: mockDisablePlugin,
  enablePlugin: vi.fn(),
  getPluginManifest: mockGetPluginManifest,
  getPluginsDir: vi.fn(() => '/plugins'),
  grantPermissions: vi.fn(),
  listPlugins: mockListPlugins,
  normalizePluginId: vi.fn((pluginId: string) => pluginId),
  removePluginFromRegistry: mockRemovePluginFromRegistry,
}));

vi.mock('./pluginInstaller', () => ({
  installPlugin: vi.fn(),
  selectAndInstallPlugin: vi.fn(),
  uninstallPlugin: mockUninstallPlugin,
}));

vi.mock('./windowManager', () => ({
  openManagedChildWindow: mockOpenManagedChildWindow,
}));

function getPluginOpenWindowHandler() {
  const handler = ipcHandleHandlers.get(PLUGIN_IPC_CHANNELS.PLUGIN_OPEN_WINDOW);
  if (!handler) {
    throw new Error('PLUGIN_OPEN_WINDOW handler was not registered');
  }
  return handler;
}

function getPluginUninstallHandler() {
  const handler = ipcHandleHandlers.get(PLUGIN_IPC_CHANNELS.PLUGIN_UNINSTALL);
  if (!handler) {
    throw new Error('PLUGIN_UNINSTALL handler was not registered');
  }
  return handler;
}

describe('pluginIPC pluginOpenWindow', () => {
  beforeEach(async () => {
    vi.resetModules();
    ipcHandleHandlers.clear();
    mockListPlugins.mockReset();
    mockGetPluginManifest.mockReset();
    mockOpenManagedChildWindow.mockReset();
    mockDisablePlugin.mockReset();
    mockRemovePluginFromRegistry.mockReset();
    mockUninstallPlugin.mockReset();

    const pluginState: PluginState = {
      id: 'demo.plugin',
      name: 'Demo Plugin',
      version: '1.0.0',
      capabilities: ['ui-panel'],
      permissions: ['open-window'],
      status: 'active',
      pluginPath: '/plugins/demo.plugin',
      permissionsGranted: true,
    };

    mockListPlugins.mockReturnValue([pluginState]);
    mockDisablePlugin.mockResolvedValue({ ...pluginState, status: 'disabled' });
    mockUninstallPlugin.mockResolvedValue(true);
    mockRemovePluginFromRegistry.mockReturnValue(true);

    const { setupPluginIPC } = await import('./pluginIPC');
    setupPluginIPC();
  });

  it('opens the plugin host window with schema UI context', async () => {
    mockGetPluginManifest.mockReturnValue({
      id: 'demo.plugin',
      name: 'Demo Plugin',
      version: '1.0.0',
      apiVersion: '1.0.0',
      capabilities: ['ui-panel'],
      permissions: ['open-window'],
      ui: {
        type: 'schema',
        schema: {
          title: 'Schema UI',
          type: 'object',
          properties: {
            word: { type: 'string', title: 'Word' },
          },
        },
        initialData: { word: 'inu' },
      },
    });

    const result = await getPluginOpenWindowHandler()({}, {
      pluginId: 'demo.plugin',
      context: { word: 'neko' },
    });

    expect(result).toBe(true);
    expect(mockOpenManagedChildWindow).toHaveBeenCalledWith(
      WINDOW_TYPES.PLUGIN_HOST,
      expect.any(Object),
      {
        pluginId: 'demo.plugin',
        pluginName: 'Demo Plugin',
        initialContext: { word: 'neko' },
        ui: {
          type: 'schema',
          schema: {
            title: 'Schema UI',
            type: 'object',
            properties: {
              word: { type: 'string', title: 'Word' },
            },
          },
          initialData: { word: 'inu' },
        },
      },
    );
  });

  it('resolves component UI modules to a file URL inside the plugin directory', async () => {
    mockGetPluginManifest.mockReturnValue({
      id: 'demo.plugin',
      name: 'Demo Plugin',
      version: '1.0.0',
      apiVersion: '1.0.0',
      capabilities: ['ui-panel'],
      permissions: ['open-window'],
      ui: {
        type: 'component',
        componentPath: 'dist/plugin-window.js',
      },
    });

    const result = await getPluginOpenWindowHandler()({}, {
      pluginId: 'demo.plugin',
    });

    expect(result).toBe(true);
    expect(mockOpenManagedChildWindow).toHaveBeenCalledWith(
      WINDOW_TYPES.PLUGIN_HOST,
      expect.any(Object),
      expect.objectContaining({
        pluginId: 'demo.plugin',
        pluginName: 'Demo Plugin',
        ui: {
          type: 'component',
          componentPath: 'dist/plugin-window.js',
          componentUrl: 'plugin-ui://demo.plugin/dist/plugin-window.js',
        },
      }),
    );
  });

  it('encodes url-significant plugin ids in component ui module URLs', async () => {
    mockListPlugins.mockReturnValue([{
      id: 'demo#plugin',
      name: 'Demo Plugin',
      version: '1.0.0',
      capabilities: ['ui-panel'],
      permissions: ['open-window'],
      status: 'active',
      pluginPath: '/plugins/demo#plugin',
      permissionsGranted: true,
    }]);

    mockGetPluginManifest.mockReturnValue({
      id: 'demo#plugin',
      name: 'Demo Plugin',
      version: '1.0.0',
      apiVersion: '1.0.0',
      capabilities: ['ui-panel'],
      permissions: ['open-window'],
      ui: {
        type: 'component',
        componentPath: 'dist/plugin-window.js',
      },
    });

    const result = await getPluginOpenWindowHandler()({}, {
      pluginId: 'demo#plugin',
    });

    expect(result).toBe(true);
    expect(mockOpenManagedChildWindow).toHaveBeenCalledWith(
      WINDOW_TYPES.PLUGIN_HOST,
      expect.any(Object),
      expect.objectContaining({
        pluginId: 'demo#plugin',
        ui: expect.objectContaining({
          componentUrl: 'plugin-ui://demo%23plugin/dist/plugin-window.js',
        }),
      }),
    );
  });

  it('rejects component UI paths that escape the plugin directory', async () => {
    mockGetPluginManifest.mockReturnValue({
      id: 'demo.plugin',
      name: 'Demo Plugin',
      version: '1.0.0',
      apiVersion: '1.0.0',
      capabilities: ['ui-panel'],
      permissions: ['open-window'],
      ui: {
        type: 'component',
        componentPath: '../escape.js',
      },
    });

    const result = await getPluginOpenWindowHandler()({}, {
      pluginId: 'demo.plugin',
    });

    expect(result).toBe(false);
    expect(mockOpenManagedChildWindow).not.toHaveBeenCalled();
  });

  it('disables active plugins before uninstalling them', async () => {
    const result = await getPluginUninstallHandler()({}, 'demo.plugin');

    expect(result).toBe(true);
    expect(mockDisablePlugin).toHaveBeenCalledWith('demo.plugin');
    expect(mockUninstallPlugin).toHaveBeenCalledWith('demo.plugin');
    expect(mockRemovePluginFromRegistry).toHaveBeenCalledWith('demo.plugin');
    expect(mockDisablePlugin.mock.invocationCallOrder[0]).toBeLessThan(mockUninstallPlugin.mock.invocationCallOrder[0]);
  });
});
