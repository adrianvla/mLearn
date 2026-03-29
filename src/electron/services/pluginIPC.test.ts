import { createRoot, createSignal } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WINDOW_TYPES } from '../../shared/constants';
import { APP_ACTIVITY_IPC_CHANNELS } from '../../shared/appActivityIpc';
import { PLUGIN_IPC_CHANNELS } from '../../shared/plugins/constants';
import type { AppActivity } from '../../shared/plugins/appActivity';
import type { PluginManifest, PluginState } from '../../shared/plugins/types';

const ipcHandleHandlers = new Map<string, (...args: unknown[]) => unknown>();
const ipcOnHandlers = new Map<string, (...args: unknown[]) => unknown>();

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
    on: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      ipcOnHandlers.set(channel, handler);
    }),
  },
}));

const mockActivityStore = {
  getCurrentActivity: vi.fn<() => AppActivity>(),
  subscribe: vi.fn<(listener: (activity: AppActivity) => void) => () => void>(),
  updateSource: vi.fn<(sourceId: string, next: { isFocused: boolean; activity: AppActivity | null }) => void>(),
};

vi.mock('./pluginAppActivity', () => ({
  createPluginAppActivityStore: vi.fn(() => mockActivityStore),
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

function getAppActivityHandler() {
  const handler = ipcHandleHandlers.get(PLUGIN_IPC_CHANNELS.PLUGIN_APP_ACTIVITY_GET);
  if (!handler) {
    throw new Error('PLUGIN_APP_ACTIVITY_GET handler was not registered');
  }
  return handler;
}

function getAppActivityUpdateSourceHandler() {
  const handler = ipcOnHandlers.get(APP_ACTIVITY_IPC_CHANNELS.SOURCE_UPDATE);
  if (!handler) {
    throw new Error('SOURCE_UPDATE handler was not registered');
  }
  return handler;
}

describe('pluginIPC pluginOpenWindow', () => {
  beforeEach(async () => {
    vi.resetModules();
    ipcHandleHandlers.clear();
    ipcOnHandlers.clear();
    mockListPlugins.mockReset();
    mockGetPluginManifest.mockReset();
    mockOpenManagedChildWindow.mockReset();
    mockDisablePlugin.mockReset();
    mockRemovePluginFromRegistry.mockReset();
    mockUninstallPlugin.mockReset();
    mockActivityStore.getCurrentActivity.mockReset();
    mockActivityStore.subscribe.mockReset();
    mockActivityStore.updateSource.mockReset();
    mockActivityStore.getCurrentActivity.mockReturnValue({ kind: 'idle' });
    mockActivityStore.subscribe.mockReturnValue(() => {});

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

  it('app activity get returns current generic activity', async () => {
    const activity = {
      kind: 'reader',
      workName: 'Genki',
      currentPage: 10,
      totalPages: 100,
    } satisfies AppActivity;
    mockActivityStore.getCurrentActivity.mockReturnValue(activity);

    const result = await getAppActivityHandler()({});

    expect(result).toEqual(activity);
    expect(mockActivityStore.getCurrentActivity).toHaveBeenCalledTimes(1);
  });

  it('keeps the internal source update channel out of plugin-facing constants', () => {
    expect(Object.values(PLUGIN_IPC_CHANNELS)).not.toContain(APP_ACTIVITY_IPC_CHANNELS.SOURCE_UPDATE);
  });

  it('app activity changed is broadcast to plugin consumers', async () => {
    const send = vi.fn();
    const activity = {
      kind: 'video',
      workName: 'Anime',
      currentTimeSeconds: 90,
      durationSeconds: 120,
    } satisfies AppActivity;
    const subscribeCalls: Array<(activity: AppActivity) => void> = [];

    mockActivityStore.subscribe.mockImplementation((listener) => {
      subscribeCalls.push(listener);
      return () => {};
    });

    const { BrowserWindow } = await import('electron');
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([
      { isDestroyed: () => false, webContents: { send } },
    ] as never[]);

    const { setupPluginIPC } = await import('./pluginIPC');
    setupPluginIPC();

    expect(subscribeCalls).toHaveLength(1);

    subscribeCalls[0](activity);

    expect(send).toHaveBeenCalledWith(PLUGIN_IPC_CHANNELS.PLUGIN_APP_ACTIVITY_CHANGED, activity);
  });

  it('app-internal source update path updates the canonical store', async () => {
    const activity = {
      kind: 'flashcards',
    } satisfies AppActivity;

    getAppActivityUpdateSourceHandler()({}, {
      sourceId: 'reader-window',
      isFocused: true,
      activity,
    });

    expect(mockActivityStore.updateSource).toHaveBeenCalledWith('reader-window', {
      isFocused: true,
      activity,
    });
  });

  it('app-internal reader source lifecycle updates the canonical store', async () => {
    const updateSource = getAppActivityUpdateSourceHandler();

    updateSource({}, {
      sourceId: 'reader-route',
      isFocused: true,
      activity: {
        kind: 'reader',
        workName: 'Yotsuba',
        currentPage: 3,
        totalPages: 20,
      } satisfies AppActivity,
    });

    updateSource({}, {
      sourceId: 'reader-route',
      isFocused: true,
      activity: null,
    });

    updateSource({}, {
      sourceId: 'reader-route',
      isFocused: true,
      activity: {
        kind: 'reader',
        workName: 'Yotsuba',
        currentPage: 4,
        totalPages: 20,
      } satisfies AppActivity,
    });

    expect(mockActivityStore.updateSource).toHaveBeenNthCalledWith(2, 'reader-route', {
      isFocused: true,
      activity: null,
    });
    expect(mockActivityStore.updateSource).toHaveBeenNthCalledWith(3, 'reader-route', {
      isFocused: true,
      activity: {
        kind: 'reader',
        workName: 'Yotsuba',
        currentPage: 4,
        totalPages: 20,
      },
    });
  });

  it('app-internal video source lifecycle updates the canonical store', async () => {
    const updateSource = getAppActivityUpdateSourceHandler();

    updateSource({}, {
      sourceId: 'video-route',
      isFocused: true,
      activity: {
        kind: 'video',
        workName: 'Spirited Away',
        currentTimeSeconds: 15,
        durationSeconds: 300,
      } satisfies AppActivity,
    });

    updateSource({}, {
      sourceId: 'video-route',
      isFocused: true,
      activity: null,
    });

    updateSource({}, {
      sourceId: 'video-route',
      isFocused: true,
      activity: {
        kind: 'video',
        workName: 'Spirited Away',
        currentTimeSeconds: 30,
        durationSeconds: 300,
      } satisfies AppActivity,
    });

    expect(mockActivityStore.updateSource).toHaveBeenNthCalledWith(2, 'video-route', {
      isFocused: true,
      activity: null,
    });
    expect(mockActivityStore.updateSource).toHaveBeenNthCalledWith(3, 'video-route', {
      isFocused: true,
      activity: {
        kind: 'video',
        workName: 'Spirited Away',
        currentTimeSeconds: 30,
        durationSeconds: 300,
      },
    });
  });

  it('app-internal video publishing emits immediately when the work changes', async () => {
    const { createVideoAppActivityPublisher } = await import('../../renderer/windows/main/routes/videoActivityPublisher');
    const updateSource = getAppActivityUpdateSourceHandler();

    let setWorkName!: (value: string) => void;
    let dispose!: () => void;

    createRoot((rootDispose) => {
      dispose = rootDispose;
      const [workName, updateWorkName] = createSignal('Spirited Away');
      const [currentTimeSeconds] = createSignal(12);
      const [durationSeconds] = createSignal<number | null>(300);
      const [isFocused] = createSignal(true);
      setWorkName = updateWorkName;

      createVideoAppActivityPublisher({
        workName,
        currentTimeSeconds,
        durationSeconds,
        isFocused,
        publishSourceUpdate: (payload) => updateSource({}, payload),
      });
    });

    await Promise.resolve();
    mockActivityStore.updateSource.mockClear();

    setWorkName('Princess Mononoke');
    await Promise.resolve();

    expect(mockActivityStore.updateSource).toHaveBeenCalledWith('video-route', {
      isFocused: true,
      activity: {
        kind: 'video',
        workName: 'Princess Mononoke',
        currentTimeSeconds: 12,
        durationSeconds: 300,
      },
    });

    dispose();
  });

  it('app-internal video publishing emits immediately when duration becomes available', async () => {
    const { createVideoAppActivityPublisher } = await import('../../renderer/windows/main/routes/videoActivityPublisher');
    const updateSource = getAppActivityUpdateSourceHandler();

    let setDurationSeconds!: (value: number | null) => void;
    let dispose!: () => void;

    createRoot((rootDispose) => {
      dispose = rootDispose;
      const [workName] = createSignal('Spirited Away');
      const [currentTimeSeconds] = createSignal(12);
      const [durationSeconds, updateDurationSeconds] = createSignal<number | null>(null);
      const [isFocused] = createSignal(true);
      setDurationSeconds = updateDurationSeconds;

      createVideoAppActivityPublisher({
        workName,
        currentTimeSeconds,
        durationSeconds,
        isFocused,
        publishSourceUpdate: (payload) => updateSource({}, payload),
      });
    });

    await Promise.resolve();
    mockActivityStore.updateSource.mockClear();

    setDurationSeconds(300);
    await Promise.resolve();

    expect(mockActivityStore.updateSource).toHaveBeenCalledWith('video-route', {
      isFocused: true,
      activity: {
        kind: 'video',
        workName: 'Spirited Away',
        currentTimeSeconds: 12,
        durationSeconds: 300,
      },
    });

    dispose();
  });

  it('app-internal video publishing keeps the canonical activity idle when duration is missing', async () => {
    const { createVideoAppActivityPublisher } = await import('../../renderer/windows/main/routes/videoActivityPublisher');
    const updateSource = getAppActivityUpdateSourceHandler();

    createRoot((dispose) => {
      const [workName] = createSignal('Spirited Away');
      const [currentTimeSeconds] = createSignal(12);
      const [durationSeconds] = createSignal<number | null>(null);
      const [isFocused] = createSignal(true);

      createVideoAppActivityPublisher({
        workName,
        currentTimeSeconds,
        durationSeconds,
        isFocused,
        publishSourceUpdate: (payload) => updateSource({}, payload),
      });

      queueMicrotask(dispose);
    });

    await Promise.resolve();

    expect(mockActivityStore.updateSource).toHaveBeenCalledWith('video-route', {
      isFocused: true,
      activity: null,
    });
  });

  it('app-internal video publishing emits on 15-second bucket transitions', async () => {
    const { createVideoAppActivityPublisher } = await import('../../renderer/windows/main/routes/videoActivityPublisher');
    const updateSource = getAppActivityUpdateSourceHandler();

    let setCurrentTimeSeconds!: (value: number) => void;
    let dispose!: () => void;

    createRoot((rootDispose) => {
      dispose = rootDispose;
      const [workName] = createSignal('Spirited Away');
      const [currentTimeSeconds, updateCurrentTime] = createSignal(14);
      const [durationSeconds] = createSignal<number | null>(300);
      const [isFocused] = createSignal(true);
      setCurrentTimeSeconds = updateCurrentTime;

      createVideoAppActivityPublisher({
        workName,
        currentTimeSeconds,
        durationSeconds,
        isFocused,
        publishSourceUpdate: (payload) => updateSource({}, payload),
      });
    });

    await Promise.resolve();
    mockActivityStore.updateSource.mockClear();

    setCurrentTimeSeconds(15);
    await Promise.resolve();

    expect(mockActivityStore.updateSource).toHaveBeenCalledWith('video-route', {
      isFocused: true,
      activity: {
        kind: 'video',
        workName: 'Spirited Away',
        currentTimeSeconds: 15,
        durationSeconds: 300,
      },
    });

    dispose();
  });

  it('app-internal video publishing suppresses in-bucket progress changes', async () => {
    const { createVideoAppActivityPublisher } = await import('../../renderer/windows/main/routes/videoActivityPublisher');
    const updateSource = getAppActivityUpdateSourceHandler();

    let setCurrentTimeSeconds!: (value: number) => void;
    let dispose!: () => void;

    createRoot((rootDispose) => {
      dispose = rootDispose;
      const [workName] = createSignal('Spirited Away');
      const [currentTimeSeconds, updateCurrentTime] = createSignal(12);
      const [durationSeconds] = createSignal<number | null>(300);
      const [isFocused] = createSignal(true);
      setCurrentTimeSeconds = updateCurrentTime;

      createVideoAppActivityPublisher({
        workName,
        currentTimeSeconds,
        durationSeconds,
        isFocused,
        publishSourceUpdate: (payload) => updateSource({}, payload),
      });
    });

    await Promise.resolve();
    mockActivityStore.updateSource.mockClear();

    setCurrentTimeSeconds(13);
    await Promise.resolve();

    expect(mockActivityStore.updateSource).not.toHaveBeenCalled();

    dispose();
  });

  it('plugin-facing consumers receive idle when canonical activity changes back to idle', async () => {
    const subscribeCalls: Array<(activity: AppActivity) => void> = [];

    mockActivityStore.subscribe.mockImplementation((listener) => {
      subscribeCalls.push(listener);
      return () => {};
    });

    const send = vi.fn();
    const { BrowserWindow } = await import('electron');
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([
      { isDestroyed: () => false, webContents: { send } },
    ] as never[]);

    const { setupPluginIPC } = await import('./pluginIPC');
    setupPluginIPC();

    subscribeCalls[0]({
      kind: 'reader',
      workName: 'Yotsuba',
      currentPage: 3,
      totalPages: 20,
    });
    subscribeCalls[0]({ kind: 'idle' });

    expect(send).toHaveBeenLastCalledWith(PLUGIN_IPC_CHANNELS.PLUGIN_APP_ACTIVITY_CHANGED, { kind: 'idle' });
  });
});
