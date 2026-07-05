import { createRoot, createSignal } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PluginBusEnvelope } from '../../shared/pluginBus';
import { WINDOW_TYPES } from '../../shared/constants';
import { PLUGIN_IPC_CHANNELS } from '../../shared/plugins/constants';
import type { AppActivity } from '../../shared/plugins/appActivity';
import type { PluginManifest, PluginState } from '../../shared/plugins/types';
import { syncFlashcardsPluginActivity } from '../../renderer/windows/flashcards/pluginActivity';

const ipcHandleHandlers = new Map<string, (...args: unknown[]) => unknown>();
const ipcOnHandlers = new Map<string, (...args: unknown[]) => unknown>();

const mockDisablePlugin = vi.fn();
const mockListPlugins = vi.fn<() => PluginState[]>();
const mockGetPluginManifest = vi.fn<(pluginId: string) => PluginManifest | null>();
const mockOpenManagedChildWindow = vi.fn();
const mockRemovePluginFromRegistry = vi.fn();
const mockUninstallPlugin = vi.fn();

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
  },
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

const mockBusStore = {
  emitPluginEvent: vi.fn(),
  getPluginValue: vi.fn(),
  onPluginEvent: vi.fn(),
  onPluginValue: vi.fn(),
  removeAppSource: vi.fn(),
  setAppScopedValue: vi.fn(),
  setAppSourceFocused: vi.fn(),
  setPluginValue: vi.fn(),
};

vi.mock('./pluginBus', async () => {
  const actual = await vi.importActual<typeof import('./pluginBus')>('./pluginBus');
  return {
    ...actual,
    createPluginBusStore: vi.fn(() => mockBusStore),
  };
});

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

vi.mock('./settings', () => ({
  loadSettings: vi.fn(() => ({ language: 'ja', uiLanguage: 'en', dictionaryTargetLanguages: {} })),
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

function getPluginValueHandler() {
  const handler = ipcHandleHandlers.get(PLUGIN_IPC_CHANNELS.PLUGIN_BUS_GET_VALUE);
  if (!handler) {
    throw new Error('PLUGIN_BUS_GET_VALUE handler was not registered');
  }
  return handler;
}

function getSetPluginValueHandler() {
  const handler = ipcHandleHandlers.get(PLUGIN_IPC_CHANNELS.PLUGIN_BUS_SET_VALUE);
  if (!handler) {
    throw new Error('PLUGIN_BUS_SET_VALUE handler was not registered');
  }
  return handler;
}

function getEmitPluginEventHandler() {
  const handler = ipcHandleHandlers.get(PLUGIN_IPC_CHANNELS.PLUGIN_BUS_EMIT_EVENT);
  if (!handler) {
    throw new Error('PLUGIN_BUS_EMIT_EVENT handler was not registered');
  }
  return handler;
}

function getSetScopedPluginValueHandler() {
  const handler = ipcOnHandlers.get(PLUGIN_IPC_CHANNELS.PLUGIN_BUS_SET_SCOPED_VALUE);
  if (!handler) {
    throw new Error('PLUGIN_BUS_SET_SCOPED_VALUE handler was not registered');
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
    mockBusStore.emitPluginEvent.mockReset();
    mockBusStore.getPluginValue.mockReset();
    mockBusStore.onPluginEvent.mockReset();
    mockBusStore.onPluginValue.mockReset();
    mockBusStore.removeAppSource.mockReset();
    mockBusStore.setAppScopedValue.mockReset();
    mockBusStore.setAppSourceFocused.mockReset();
    mockBusStore.setPluginValue.mockReset();
    mockBusStore.getPluginValue.mockReturnValue({ hasValue: false, value: null });
    mockBusStore.onPluginValue.mockReturnValue(() => {});
    mockBusStore.onPluginEvent.mockReturnValue(() => {});

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
        initialContext: { word: 'neko', __mlearnLanguage: 'ja', __mlearnDictionaryTargetLanguage: 'en' },
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

  it('getPluginValue returns the current bus value envelope', async () => {
    const envelope = {
      hasValue: true,
      value: {
      kind: 'reader',
      workName: 'Genki',
      currentPage: 10,
      totalPages: 100,
      } satisfies AppActivity,
    } satisfies PluginBusEnvelope<AppActivity>;
    mockBusStore.getPluginValue.mockReturnValue(envelope);

    const result = await getPluginValueHandler()({}, 'app.user.activity');

    expect(result).toEqual(envelope);
    expect(mockBusStore.getPluginValue).toHaveBeenCalledWith('app.user.activity');
  });

  it('exposes generic bus IPC channels instead of the old app activity channels', () => {
    expect(PLUGIN_IPC_CHANNELS).toMatchObject({
      PLUGIN_BUS_GET_VALUE: expect.any(String),
      PLUGIN_BUS_SET_VALUE: expect.any(String),
      PLUGIN_BUS_EMIT_EVENT: expect.any(String),
      PLUGIN_BUS_VALUE_CHANGED: expect.any(String),
      PLUGIN_BUS_EVENT_EMITTED: expect.any(String),
      PLUGIN_BUS_SET_SCOPED_VALUE: expect.any(String),
    });
    expect(PLUGIN_IPC_CHANNELS).not.toHaveProperty('PLUGIN_APP_ACTIVITY_GET');
    expect(PLUGIN_IPC_CHANNELS).not.toHaveProperty('PLUGIN_APP_ACTIVITY_CHANGED');
  });

  it('plugin value changes are broadcast to plugin consumers', async () => {
    const send = vi.fn();
    const nextEnvelope = { hasValue: true, value: 'dark' } satisfies PluginBusEnvelope<string>;
    const previousEnvelope = { hasValue: false, value: null } satisfies PluginBusEnvelope<string>;
    const subscribeCalls: Array<(next: PluginBusEnvelope, previous: PluginBusEnvelope) => void> = [];

    mockBusStore.onPluginValue.mockImplementation((_channel, listener) => {
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

    subscribeCalls[0](nextEnvelope, previousEnvelope);

    expect(send).toHaveBeenCalledWith(PLUGIN_IPC_CHANNELS.PLUGIN_BUS_VALUE_CHANGED, {
      channel: 'app.user.activity',
      nextValue: nextEnvelope,
      previousValue: previousEnvelope,
    });
  });

  it('non-app bus writes are broadcast immediately to plugin consumers', async () => {
    const send = vi.fn();
    const { BrowserWindow } = await import('electron');
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([
      { isDestroyed: () => false, webContents: { send } },
    ] as never[]);

    mockBusStore.getPluginValue
      .mockReturnValueOnce({ hasValue: false, value: null })
      .mockReturnValueOnce({ hasValue: true, value: 'dark' });

    await getSetPluginValueHandler()({ sender: { id: 1, getURL: () => 'http://localhost:3000/src/html/plugin-host.html' } }, 'shared.theme', 'dark');

    expect(send).toHaveBeenCalledWith(PLUGIN_IPC_CHANNELS.PLUGIN_BUS_VALUE_CHANGED, {
      channel: 'shared.theme',
      nextValue: { hasValue: true, value: 'dark' },
      previousValue: { hasValue: false, value: null },
    });
  });

  it('does not broadcast non-app value writes when the envelope is unchanged', async () => {
    const send = vi.fn();
    const { BrowserWindow } = await import('electron');
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([
      { isDestroyed: () => false, webContents: { send } },
    ] as never[]);

    mockBusStore.getPluginValue
      .mockReturnValueOnce({ hasValue: true, value: 'dark' })
      .mockReturnValueOnce({ hasValue: true, value: 'dark' });

    await getSetPluginValueHandler()({ sender: { id: 1, getURL: () => 'http://localhost:3000/src/html/plugin-host.html' } }, 'shared.theme', 'dark');

    expect(send).not.toHaveBeenCalledWith(PLUGIN_IPC_CHANNELS.PLUGIN_BUS_VALUE_CHANGED, expect.anything());
  });

  it('setPluginValue forwards plugin-facing writes through the bus store', async () => {
    await getSetPluginValueHandler()({ sender: { id: 1, getURL: () => 'http://localhost:3000/src/html/plugin-host.html' } }, 'shared.theme', 'dark');

    expect(mockBusStore.setPluginValue).toHaveBeenCalledWith({ scope: 'plugin', pluginId: 'host' }, 'shared.theme', 'dark');
  });

  it('emitPluginEvent forwards plugin-facing events through the bus store', async () => {
    await getEmitPluginEventHandler()({ sender: { id: 1, getURL: () => 'http://localhost:3000/src/html/plugin-host.html' } }, 'shared.command', { type: 'refresh' });

    expect(mockBusStore.emitPluginEvent).toHaveBeenCalledWith({ scope: 'plugin', pluginId: 'host' }, 'shared.command', { type: 'refresh' });
  });

  it('app-internal scoped value updates the canonical bus store', async () => {
    const activity = {
      kind: 'flashcards',
    } satisfies AppActivity;

    getSetScopedPluginValueHandler()({}, {
      sourceId: 'reader-window',
      isFocused: true,
      channel: 'app.user.activity',
      value: activity,
    });

    expect(mockBusStore.setAppSourceFocused).toHaveBeenCalledWith('reader-window', true);
    expect(mockBusStore.setAppScopedValue).toHaveBeenCalledWith('app.user.activity', 'reader-window', activity);
  });

  it('ignores scoped value updates from plugin host windows', async () => {
    const activity = {
      kind: 'flashcards',
    } satisfies AppActivity;

    getSetScopedPluginValueHandler()({
      sender: {
        getURL: () => 'http://localhost:3000/src/html/plugin-host.html',
      },
    }, {
      sourceId: 'plugin-host-window',
      isFocused: true,
      channel: 'app.user.activity',
      value: activity,
    });

    expect(mockBusStore.setAppSourceFocused).not.toHaveBeenCalled();
    expect(mockBusStore.setAppScopedValue).not.toHaveBeenCalled();
  });

  it('app-internal reader source lifecycle updates the canonical store', async () => {
    const updateSource = getSetScopedPluginValueHandler();

    updateSource({}, {
      sourceId: 'reader-route',
      isFocused: true,
      channel: 'app.user.activity',
      value: {
        kind: 'reader',
        workName: 'Yotsuba',
        currentPage: 3,
        totalPages: 20,
      } satisfies AppActivity,
    });

    updateSource({}, {
      sourceId: 'reader-route',
      isFocused: true,
      channel: 'app.user.activity',
      value: null,
    });

    updateSource({}, {
      sourceId: 'reader-route',
      isFocused: true,
      channel: 'app.user.activity',
      value: {
        kind: 'reader',
        workName: 'Yotsuba',
        currentPage: 4,
        totalPages: 20,
      } satisfies AppActivity,
    });

    expect(mockBusStore.setAppSourceFocused).toHaveBeenNthCalledWith(2, 'reader-route', true);
    expect(mockBusStore.setAppScopedValue).toHaveBeenNthCalledWith(2, 'app.user.activity', 'reader-route', null);
    expect(mockBusStore.setAppScopedValue).toHaveBeenNthCalledWith(3, 'app.user.activity', 'reader-route', {
      kind: 'reader',
      workName: 'Yotsuba',
      currentPage: 4,
      totalPages: 20,
    });
  });

  it('app-internal video source lifecycle updates the canonical store', async () => {
    const updateSource = getSetScopedPluginValueHandler();

    updateSource({}, {
      sourceId: 'video-route',
      isFocused: true,
      channel: 'app.user.activity',
      value: {
        kind: 'video',
        workName: 'Spirited Away',
        currentTimeSeconds: 15,
        durationSeconds: 300,
      } satisfies AppActivity,
    });

    updateSource({}, {
      sourceId: 'video-route',
      isFocused: true,
      channel: 'app.user.activity',
      value: null,
    });

    updateSource({}, {
      sourceId: 'video-route',
      isFocused: true,
      channel: 'app.user.activity',
      value: {
        kind: 'video',
        workName: 'Spirited Away',
        currentTimeSeconds: 30,
        durationSeconds: 300,
      } satisfies AppActivity,
    });

    expect(mockBusStore.setAppScopedValue).toHaveBeenNthCalledWith(2, 'app.user.activity', 'video-route', null);
    expect(mockBusStore.setAppScopedValue).toHaveBeenNthCalledWith(3, 'app.user.activity', 'video-route', {
      kind: 'video',
      workName: 'Spirited Away',
      currentTimeSeconds: 30,
      durationSeconds: 300,
    });
  });

  it('app-internal video publishing emits immediately when the work changes', async () => {
    const { syncVideoPluginActivity } = await import('../../renderer/windows/main/routes/videoPluginActivity');
    const updateSource = getSetScopedPluginValueHandler();

    let setWorkName!: (value: string) => void;
    let dispose!: () => void;

    createRoot((rootDispose) => {
      dispose = rootDispose;
      const [workName, updateWorkName] = createSignal('Spirited Away');
      const [currentTimeSeconds] = createSignal(12);
      const [durationSeconds] = createSignal<number | null>(300);
      const [isFocused] = createSignal(true);
      setWorkName = updateWorkName;

      syncVideoPluginActivity({
        workName,
        currentTimeSeconds,
        durationSeconds,
        isFocused,
        publishScopedValue: (payload) => updateSource({}, {
          sourceId: payload.sourceId,
          isFocused: payload.isFocused,
          channel: 'app.user.activity',
          value: payload.value,
        }),
      });
    });

    await Promise.resolve();
    mockBusStore.setAppScopedValue.mockClear();

    setWorkName('Princess Mononoke');
    await Promise.resolve();

    expect(mockBusStore.setAppScopedValue).toHaveBeenCalledWith('app.user.activity', 'video-route', {
      kind: 'video',
      workName: 'Princess Mononoke',
      currentTimeSeconds: 12,
      durationSeconds: 300,
    });

    dispose();
  });

  it('app-internal video publishing emits immediately when duration becomes available', async () => {
    const { syncVideoPluginActivity } = await import('../../renderer/windows/main/routes/videoPluginActivity');
    const updateSource = getSetScopedPluginValueHandler();

    let setDurationSeconds!: (value: number | null) => void;
    let dispose!: () => void;

    createRoot((rootDispose) => {
      dispose = rootDispose;
      const [workName] = createSignal('Spirited Away');
      const [currentTimeSeconds] = createSignal(12);
      const [durationSeconds, updateDurationSeconds] = createSignal<number | null>(null);
      const [isFocused] = createSignal(true);
      setDurationSeconds = updateDurationSeconds;

      syncVideoPluginActivity({
        workName,
        currentTimeSeconds,
        durationSeconds,
        isFocused,
        publishScopedValue: (payload) => updateSource({}, {
          sourceId: payload.sourceId,
          isFocused: payload.isFocused,
          channel: 'app.user.activity',
          value: payload.value,
        }),
      });
    });

    await Promise.resolve();
    mockBusStore.setAppScopedValue.mockClear();

    setDurationSeconds(300);
    await Promise.resolve();

    expect(mockBusStore.setAppScopedValue).toHaveBeenCalledWith('app.user.activity', 'video-route', {
      kind: 'video',
      workName: 'Spirited Away',
      currentTimeSeconds: 12,
      durationSeconds: 300,
    });

    dispose();
  });

  it('app-internal video publishing keeps the canonical activity idle when duration is missing', async () => {
    const { syncVideoPluginActivity } = await import('../../renderer/windows/main/routes/videoPluginActivity');
    const updateSource = getSetScopedPluginValueHandler();

    createRoot((dispose) => {
      const [workName] = createSignal('Spirited Away');
      const [currentTimeSeconds] = createSignal(12);
      const [durationSeconds] = createSignal<number | null>(null);
      const [isFocused] = createSignal(true);

      syncVideoPluginActivity({
        workName,
        currentTimeSeconds,
        durationSeconds,
        isFocused,
        publishScopedValue: (payload) => updateSource({}, {
          sourceId: payload.sourceId,
          isFocused: payload.isFocused,
          channel: 'app.user.activity',
          value: payload.value,
        }),
      });

      queueMicrotask(dispose);
    });

    await Promise.resolve();

    expect(mockBusStore.setAppScopedValue).toHaveBeenCalledWith('app.user.activity', 'video-route', null);
  });

  it('app-internal video publishing emits on 15-second bucket transitions', async () => {
    const { syncVideoPluginActivity } = await import('../../renderer/windows/main/routes/videoPluginActivity');
    const updateSource = getSetScopedPluginValueHandler();

    let setCurrentTimeSeconds!: (value: number) => void;
    let dispose!: () => void;

    createRoot((rootDispose) => {
      dispose = rootDispose;
      const [workName] = createSignal('Spirited Away');
      const [currentTimeSeconds, updateCurrentTime] = createSignal(14);
      const [durationSeconds] = createSignal<number | null>(300);
      const [isFocused] = createSignal(true);
      setCurrentTimeSeconds = updateCurrentTime;

      syncVideoPluginActivity({
        workName,
        currentTimeSeconds,
        durationSeconds,
        isFocused,
        publishScopedValue: (payload) => updateSource({}, {
          sourceId: payload.sourceId,
          isFocused: payload.isFocused,
          channel: 'app.user.activity',
          value: payload.value,
        }),
      });
    });

    await Promise.resolve();
    mockBusStore.setAppScopedValue.mockClear();

    setCurrentTimeSeconds(15);
    await Promise.resolve();

    expect(mockBusStore.setAppScopedValue).toHaveBeenCalledWith('app.user.activity', 'video-route', {
      kind: 'video',
      workName: 'Spirited Away',
      currentTimeSeconds: 15,
      durationSeconds: 300,
    });

    dispose();
  });

  it('app-internal video publishing suppresses in-bucket progress changes', async () => {
    const { syncVideoPluginActivity } = await import('../../renderer/windows/main/routes/videoPluginActivity');
    const updateSource = getSetScopedPluginValueHandler();

    let setCurrentTimeSeconds!: (value: number) => void;
    let dispose!: () => void;

    createRoot((rootDispose) => {
      dispose = rootDispose;
      const [workName] = createSignal('Spirited Away');
      const [currentTimeSeconds, updateCurrentTime] = createSignal(12);
      const [durationSeconds] = createSignal<number | null>(300);
      const [isFocused] = createSignal(true);
      setCurrentTimeSeconds = updateCurrentTime;

      syncVideoPluginActivity({
        workName,
        currentTimeSeconds,
        durationSeconds,
        isFocused,
        publishScopedValue: (payload) => updateSource({}, {
          sourceId: payload.sourceId,
          isFocused: payload.isFocused,
          channel: 'app.user.activity',
          value: payload.value,
        }),
      });
    });

    await Promise.resolve();
    mockBusStore.setAppScopedValue.mockClear();

    setCurrentTimeSeconds(13);
    await Promise.resolve();

    expect(mockBusStore.setAppScopedValue).not.toHaveBeenCalled();

    dispose();
  });

  it('app-internal flashcards publishing emits flashcards for focused review mode', async () => {
    const updateSource = getSetScopedPluginValueHandler();

    let dispose!: () => void;

    createRoot((rootDispose) => {
      const [activeTab] = createSignal<'review' | 'browse' | 'generate' | 'stats'>('review');
      const [isFocused] = createSignal(true);
      dispose = rootDispose;

      syncFlashcardsPluginActivity({
        activeTab,
        isFocused,
        publishScopedValue: (payload) => updateSource({}, {
          sourceId: payload.sourceId,
          isFocused: payload.isFocused,
          channel: 'app.user.activity',
          value: payload.value,
        }),
      });
    });

    await Promise.resolve();

    expect(mockBusStore.setAppScopedValue).toHaveBeenNthCalledWith(1, 'app.user.activity', 'flashcards-window', { kind: 'flashcards' });

    dispose();

    expect(mockBusStore.setAppSourceFocused).toHaveBeenNthCalledWith(2, 'flashcards-window', false);
    expect(mockBusStore.setAppScopedValue).toHaveBeenNthCalledWith(2, 'app.user.activity', 'flashcards-window', { kind: 'idle' });
  });

  it('app-internal flashcards publishing emits idle for non-review tabs', async () => {
    const updateSource = getSetScopedPluginValueHandler();

    let dispose!: () => void;

    createRoot((rootDispose) => {
      dispose = rootDispose;
      const [activeTab] = createSignal<'review' | 'browse' | 'generate' | 'stats'>('browse');
      const [isFocused] = createSignal(true);

      syncFlashcardsPluginActivity({
        activeTab,
        isFocused,
        publishScopedValue: (payload) => updateSource({}, {
          sourceId: payload.sourceId,
          isFocused: payload.isFocused,
          channel: 'app.user.activity',
          value: payload.value,
        }),
      });
    });

    await Promise.resolve();

    expect(mockBusStore.setAppScopedValue).toHaveBeenNthCalledWith(1, 'app.user.activity', 'flashcards-window', { kind: 'idle' });

    dispose();

    expect(mockBusStore.setAppSourceFocused).toHaveBeenNthCalledWith(2, 'flashcards-window', false);
    expect(mockBusStore.setAppScopedValue).toHaveBeenNthCalledWith(2, 'app.user.activity', 'flashcards-window', { kind: 'idle' });
  });

  it('app-internal flashcards publishing emits idle on focus loss', async () => {
    const updateSource = getSetScopedPluginValueHandler();

    let setIsFocused!: (value: boolean) => void;
    let dispose!: () => void;

    createRoot((rootDispose) => {
      dispose = rootDispose;
      const [activeTab] = createSignal<'review' | 'browse' | 'generate' | 'stats'>('review');
      const [isFocused, updateIsFocused] = createSignal(true);
      setIsFocused = updateIsFocused;

      syncFlashcardsPluginActivity({
        activeTab,
        isFocused,
        publishScopedValue: (payload) => updateSource({}, {
          sourceId: payload.sourceId,
          isFocused: payload.isFocused,
          channel: 'app.user.activity',
          value: payload.value,
        }),
      });
    });

    await Promise.resolve();

    setIsFocused(false);
    await Promise.resolve();

    expect(mockBusStore.setAppSourceFocused).toHaveBeenNthCalledWith(2, 'flashcards-window', false);
    expect(mockBusStore.setAppScopedValue).toHaveBeenNthCalledWith(2, 'app.user.activity', 'flashcards-window', { kind: 'idle' });

    dispose();

    expect(mockBusStore.setAppSourceFocused).toHaveBeenNthCalledWith(3, 'flashcards-window', false);
    expect(mockBusStore.setAppScopedValue).toHaveBeenNthCalledWith(3, 'app.user.activity', 'flashcards-window', { kind: 'idle' });
  });

  it('plugin-facing consumers receive idle when the app activity bus value becomes idle', async () => {
    const subscribeCalls: Array<(next: PluginBusEnvelope, previous: PluginBusEnvelope) => void> = [];

    mockBusStore.onPluginValue.mockImplementation((_channel, listener) => {
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

    subscribeCalls[0](
      {
        hasValue: true,
        value: {
          kind: 'reader',
          workName: 'Yotsuba',
          currentPage: 3,
          totalPages: 20,
        },
      },
      { hasValue: false, value: null },
    );
    subscribeCalls[0](
      { hasValue: true, value: { kind: 'idle' } },
      {
        hasValue: true,
        value: {
          kind: 'reader',
          workName: 'Yotsuba',
          currentPage: 3,
          totalPages: 20,
        },
      },
    );

    expect(send).toHaveBeenLastCalledWith(PLUGIN_IPC_CHANNELS.PLUGIN_BUS_VALUE_CHANGED, {
      channel: 'app.user.activity',
      nextValue: { hasValue: true, value: { kind: 'idle' } },
      previousValue: {
        hasValue: true,
        value: {
          kind: 'reader',
          workName: 'Yotsuba',
          currentPage: 3,
          totalPages: 20,
        },
      },
    });
  });
});
