import { EventEmitter } from 'events';
import type { AppUpdater, ProgressInfo, UpdateCheckResult, UpdateDownloadedEvent, UpdateInfo } from 'electron-updater';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppUpdateState } from '../../shared/appUpdate';
import { IPC_CHANNELS, UPDATE_URL } from '../../shared/constants';
import {
  createAppUpdaterService,
  detectAppUpdateSupport,
  setupAppUpdaterIpc,
  type AppUpdaterService,
  type AppUpdaterServiceOverrides,
} from './appUpdater';

const defaultAutoUpdater = vi.hoisted(() => ({
  autoDownload: true,
  autoInstallOnAppQuit: false,
  on: vi.fn(),
  removeListener: vi.fn(),
  checkForUpdates: vi.fn(),
  downloadUpdate: vi.fn(),
  quitAndInstall: vi.fn(),
}));

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/tmp/mlearn-test'),
    getVersion: vi.fn(() => '2.6.7'),
    isPackaged: false,
  },
  BrowserWindow: {
    getAllWindows: vi.fn(() => []),
  },
  ipcMain: {
    on: vi.fn(),
    handle: vi.fn(),
    removeHandler: vi.fn(),
  },
}));

vi.mock('electron-updater', () => ({
  autoUpdater: defaultAutoUpdater,
}));

class FakeUpdater extends EventEmitter {
  autoDownload = true;
  autoInstallOnAppQuit = false;
  readonly checkForUpdatesMock = vi.fn<() => Promise<UpdateCheckResult | null>>();
  readonly downloadUpdateMock = vi.fn<() => Promise<string[]>>();
  readonly quitAndInstallMock = vi.fn<(isSilent?: boolean, isForceRunAfter?: boolean) => void>();

  checkForUpdates(): Promise<UpdateCheckResult | null> {
    return this.checkForUpdatesMock();
  }

  downloadUpdate(): Promise<string[]> {
    return this.downloadUpdateMock();
  }

  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void {
    this.quitAndInstallMock(isSilent, isForceRunAfter);
  }
}

function makeUpdateInfo(version = '2.7.0'): UpdateInfo {
  return {
    version,
    files: [],
    path: '',
    sha512: '',
    releaseName: `mLearn ${version}`,
    releaseNotes: 'Reliable application updates',
    releaseDate: '2026-07-20T10:00:00.000Z',
  };
}

function makeCheckResult(
  isUpdateAvailable: boolean,
  updateInfo = makeUpdateInfo(),
  downloadPromise?: Promise<string[]>,
): UpdateCheckResult {
  return {
    isUpdateAvailable,
    updateInfo,
    versionInfo: updateInfo,
    downloadPromise,
  };
}

function makeDownloadedEvent(version = '2.7.0'): UpdateDownloadedEvent {
  return {
    ...makeUpdateInfo(version),
    downloadedFile: `/tmp/mLearn-${version}.dmg`,
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return { promise, resolve, reject };
}

function makeLogger() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

const activeServices: AppUpdaterService[] = [];
let updater: FakeUpdater;

function makeService(overrides: AppUpdaterServiceOverrides = {}): AppUpdaterService {
  const service = createAppUpdaterService({
    updater: updater as unknown as AppUpdater,
    getCurrentVersion: () => '2.6.7',
    isPackaged: () => true,
    platform: 'darwin',
    environment: {},
    getAutoDownload: () => false,
    fetchMetadata: vi.fn(),
    getAllWindows: () => [],
    now: () => 1_721_469_600_000,
    logger: makeLogger(),
    ...overrides,
  });
  activeServices.push(service);
  return service;
}

beforeEach(() => {
  updater = new FakeUpdater();
  updater.checkForUpdatesMock.mockResolvedValue(makeCheckResult(false, makeUpdateInfo('2.6.7')));
  updater.downloadUpdateMock.mockResolvedValue(['/tmp/mLearn.dmg']);
});

afterEach(() => {
  for (const service of activeServices.splice(0)) service.dispose();
});

describe('detectAppUpdateSupport', () => {
  it.each([
    [false, 'darwin', {}, 'development'],
    [true, 'win32', { PORTABLE_EXECUTABLE_FILE: 'mLearn.exe' }, 'windows-portable'],
    [true, 'win32', { PORTABLE_EXECUTABLE_DIR: 'C:\\mLearn' }, 'windows-portable'],
    [true, 'linux', {}, 'linux-non-appimage'],
    [true, 'linux', { APPIMAGE: '/opt/mLearn.AppImage' }, null],
    [true, 'darwin', {}, null],
    [true, 'freebsd', {}, 'unsupported-platform'],
  ] as const)('returns %s/%s support result', (isPackaged, platform, environment, expected) => {
    expect(detectAppUpdateSupport(isPackaged, platform, environment)).toBe(expected);
  });
});

describe('AppUpdaterService initialization', () => {
  it('configures updater preferences and broadcasts a frozen initial state to live windows', async () => {
    const liveSend = vi.fn();
    const destroyedSend = vi.fn();
    const service = makeService({
      getAutoDownload: () => true,
      getAllWindows: () => [
        { isDestroyed: () => false, webContents: { isDestroyed: () => false, send: liveSend } },
        { isDestroyed: () => true, webContents: { send: destroyedSend } },
      ],
    });

    const state = await service.initialize({ autoCheck: false });

    expect(updater.autoDownload).toBe(true);
    expect(updater.autoInstallOnAppQuit).toBe(true);
    expect(state).toMatchObject({
      status: 'idle',
      currentVersion: '2.6.7',
      canAutoUpdate: true,
      supportReason: null,
    });
    expect(Object.isFrozen(state)).toBe(true);
    expect(liveSend).toHaveBeenCalledWith(IPC_CHANNELS.UPDATE_STATE_CHANGED, state);
    expect(destroyedSend).not.toHaveBeenCalled();
  });

  it('checks automatically by default and consumes checking and not-available events', async () => {
    const currentInfo = makeUpdateInfo('2.6.7');
    updater.checkForUpdatesMock.mockImplementation(async () => {
      updater.emit('checking-for-update');
      updater.emit('update-not-available', currentInfo);
      return makeCheckResult(false, currentInfo);
    });
    const service = makeService();

    const state = await service.initialize();

    expect(updater.checkForUpdatesMock).toHaveBeenCalledOnce();
    expect(state.status).toBe('up-to-date');
  });

  it('refreshes autoDownload from the settings getter before each check', async () => {
    const getAutoDownload = vi.fn()
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    const service = makeService({ getAutoDownload });

    await service.checkForUpdates();

    expect(getAutoDownload).toHaveBeenCalledTimes(2);
    expect(updater.autoDownload).toBe(true);
  });
});

describe('native updater events', () => {
  it('publishes available, normalized progress, and downloaded states as immutable snapshots', async () => {
    const send = vi.fn();
    const service = makeService({
      getAllWindows: () => [{ isDestroyed: () => false, webContents: { send } }],
    });
    await service.initialize({ autoCheck: false });

    updater.emit('update-available', makeUpdateInfo());
    expect(service.getState()).toMatchObject({
      status: 'available',
      availableVersion: '2.7.0',
      update: { source: 'native', releaseName: 'mLearn 2.7.0' },
    });

    updater.emit('download-progress', {
      percent: 120,
      bytesPerSecond: -1,
      transferred: 50,
      total: 100,
      delta: 10,
    } satisfies ProgressInfo);
    const progressState = service.getState();
    expect(progressState).toMatchObject({
      status: 'downloading',
      progress: { percent: 100, bytesPerSecond: 0, transferred: 50, total: 100 },
    });
    expect(Object.isFrozen(progressState)).toBe(true);
    if (progressState.status === 'downloading') {
      expect(Object.isFrozen(progressState.progress)).toBe(true);
      expect(Object.isFrozen(progressState.update)).toBe(true);
    }

    updater.emit('update-downloaded', makeDownloadedEvent());
    expect(service.getState()).toMatchObject({ status: 'downloaded', availableVersion: '2.7.0' });
    expect(send).toHaveBeenLastCalledWith(IPC_CHANNELS.UPDATE_STATE_CHANGED, service.getState());
  });

  it('exposes only a stable error code while retaining detailed errors in logs', () => {
    const logger = makeLogger();
    const service = makeService({ logger });
    const privateMessage = 'request failed with bearer secret-token';

    updater.emit('error', new Error(privateMessage), privateMessage);

    const state = service.getState();
    expect(state).toMatchObject({
      status: 'error',
      operation: 'check',
      errorCode: 'native-check-failed',
    });
    expect(JSON.stringify(state)).not.toContain(privateMessage);
    expect(logger.error).toHaveBeenCalledWith(
      'Electron updater error',
      expect.objectContaining({ message: privateMessage }),
      privateMessage,
    );
  });
});

describe('check concurrency', () => {
  it('returns the same one-flight promise for concurrent native checks', async () => {
    const pending = deferred<UpdateCheckResult | null>();
    updater.checkForUpdatesMock.mockReturnValue(pending.promise);
    const service = makeService();

    const first = service.checkForUpdates();
    const second = service.checkForUpdates();

    expect(second).toBe(first);
    expect(updater.checkForUpdatesMock).toHaveBeenCalledOnce();
    pending.resolve(makeCheckResult(false, makeUpdateInfo('2.6.7')));
    await expect(first).resolves.toMatchObject({ status: 'up-to-date' });
  });

  it('keeps a downloaded update ready instead of replacing it with another check', async () => {
    const service = makeService();
    updater.emit('update-downloaded', makeDownloadedEvent());

    const state = await service.checkForUpdates();

    expect(state).toMatchObject({ status: 'downloaded', availableVersion: '2.7.0' });
    expect(updater.checkForUpdatesMock).not.toHaveBeenCalled();
  });
});

describe('metadata fallback', () => {
  it.each([
    ['development', false, 'darwin', {}],
    ['windows-portable', true, 'win32', { PORTABLE_EXECUTABLE_FILE: 'mLearn.exe' }],
    ['linux-non-appimage', true, 'linux', {}],
  ] as const)('checks UPDATE_URL for %s packages and reports a manual update', async (
    supportReason,
    isPackaged,
    platform,
    environment,
  ) => {
    const fetchMetadata = vi.fn().mockResolvedValue({
      latest: '2.10.0',
      downloadUrl: 'https://mlearn.kikan.net/download',
      releaseNotes: 'New updater',
    });
    const service = makeService({ isPackaged: () => isPackaged, platform, environment, fetchMetadata });

    const state = await service.checkForUpdates();

    expect(fetchMetadata).toHaveBeenCalledWith(UPDATE_URL);
    expect(updater.checkForUpdatesMock).not.toHaveBeenCalled();
    expect(state).toMatchObject({
      status: 'available',
      currentVersion: '2.6.7',
      availableVersion: '2.10.0',
      canAutoUpdate: false,
      supportReason,
      update: {
        source: 'metadata',
        manualDownloadUrl: 'https://mlearn.kikan.net/download',
      },
    });
  });

  it('uses semantic version precedence instead of lexical ordering', async () => {
    const service = makeService({
      isPackaged: () => false,
      fetchMetadata: vi.fn().mockResolvedValue({ latest: '2.6.10' }),
      getCurrentVersion: () => '2.6.9',
    });

    await expect(service.checkForUpdates()).resolves.toMatchObject({
      status: 'available',
      availableVersion: '2.6.10',
    });
  });

  it('guards concurrent fallback checks with one metadata request', async () => {
    const pending = deferred<unknown>();
    const fetchMetadata = vi.fn().mockReturnValue(pending.promise);
    const service = makeService({ isPackaged: () => false, fetchMetadata });

    const first = service.checkForUpdates();
    const second = service.checkForUpdates();

    expect(second).toBe(first);
    expect(fetchMetadata).toHaveBeenCalledOnce();
    pending.resolve({ latest: '2.6.7' });
    await expect(first).resolves.toMatchObject({ status: 'up-to-date' });
  });

  it('separates invalid metadata from network failures without exposing details', async () => {
    const invalidService = makeService({
      isPackaged: () => false,
      fetchMetadata: vi.fn().mockResolvedValue({ latest: 'not-semver' }),
    });
    const invalidState = await invalidService.checkForUpdates();
    expect(invalidState).toMatchObject({ status: 'error', errorCode: 'invalid-update-metadata' });

    const networkMessage = 'host failed with private details';
    const failedService = makeService({
      isPackaged: () => false,
      fetchMetadata: vi.fn().mockRejectedValue(new Error(networkMessage)),
    });
    const failedState = await failedService.checkForUpdates();
    expect(failedState).toMatchObject({ status: 'error', errorCode: 'metadata-check-failed' });
    expect(JSON.stringify(failedState)).not.toContain(networkMessage);
  });
});

describe('downloads', () => {
  it('uses one manual download flight and resolves from updater events', async () => {
    const pending = deferred<string[]>();
    updater.downloadUpdateMock.mockReturnValue(pending.promise);
    const service = makeService();
    updater.emit('update-available', makeUpdateInfo());

    const first = service.downloadUpdate();
    const second = service.downloadUpdate();

    expect(second).toBe(first);
    expect(updater.downloadUpdateMock).toHaveBeenCalledOnce();
    expect(service.getState()).toMatchObject({ status: 'downloading', progress: { percent: 0 } });
    updater.emit('update-downloaded', makeDownloadedEvent());
    await expect(first).resolves.toMatchObject({ status: 'downloaded' });
    pending.resolve(['/tmp/mLearn.dmg']);
  });

  it('reuses an automatic download flight instead of starting a second download', async () => {
    const automaticDownload = deferred<string[]>();
    const info = makeUpdateInfo();
    updater.checkForUpdatesMock.mockImplementation(async () => {
      updater.emit('update-available', info);
      return makeCheckResult(true, info, automaticDownload.promise);
    });
    const service = makeService({ getAutoDownload: () => true });

    await service.checkForUpdates();
    const waitingForAutomaticDownload = service.downloadUpdate();
    expect(updater.downloadUpdateMock).not.toHaveBeenCalled();

    automaticDownload.resolve(['/tmp/mLearn.dmg']);
    await expect(waitingForAutomaticDownload).resolves.toMatchObject({ status: 'downloaded' });
  });

  it('maps rejected downloads to a sanitized retryable error', async () => {
    const message = 'download URL included a private query token';
    updater.downloadUpdateMock.mockRejectedValue(new Error(message));
    const service = makeService();
    updater.emit('update-available', makeUpdateInfo());

    const state = await service.downloadUpdate();

    expect(state).toMatchObject({
      status: 'error',
      operation: 'download',
      errorCode: 'download-failed',
      retryable: true,
    });
    expect(JSON.stringify(state)).not.toContain(message);
  });

  it('rejects auto-download actions for metadata-only packages', async () => {
    const service = makeService({
      isPackaged: () => false,
      fetchMetadata: vi.fn().mockResolvedValue({ latest: '2.7.0' }),
    });
    await service.checkForUpdates();

    await expect(service.downloadUpdate()).resolves.toMatchObject({
      status: 'error',
      errorCode: 'download-unsupported',
      canAutoUpdate: false,
      retryable: false,
    });
    expect(updater.downloadUpdateMock).not.toHaveBeenCalled();
  });
});

describe('installation', () => {
  it('installs a downloaded update once and keeps auto-install-on-quit enabled', () => {
    const service = makeService();
    updater.emit('update-downloaded', makeDownloadedEvent());

    const first = service.installUpdate();
    const second = service.installUpdate();

    expect(first).toMatchObject({ status: 'installing', availableVersion: '2.7.0' });
    expect(second).toBe(first);
    expect(updater.quitAndInstallMock).toHaveBeenCalledOnce();
    expect(updater.quitAndInstallMock).toHaveBeenCalledWith(false, true);
    expect(updater.autoInstallOnAppQuit).toBe(true);
  });

  it('does not invoke the installer before an update is downloaded', () => {
    const service = makeService();

    expect(service.installUpdate()).toMatchObject({
      status: 'error',
      operation: 'install',
      errorCode: 'install-not-ready',
    });
    expect(updater.quitAndInstallMock).not.toHaveBeenCalled();
  });

  it('maps synchronous installer launch failures to a sanitized error', () => {
    updater.quitAndInstallMock.mockImplementation(() => {
      throw new Error('installer path contains private user data');
    });
    const service = makeService();
    updater.emit('update-downloaded', makeDownloadedEvent());

    const state = service.installUpdate();

    expect(state).toMatchObject({ status: 'error', errorCode: 'install-failed' });
    expect(JSON.stringify(state)).not.toContain('private user data');
  });

  it('retries the installer after a synchronous launch failure', () => {
    updater.quitAndInstallMock
      .mockImplementationOnce(() => {
        throw new Error('temporary installer failure');
      })
      .mockImplementationOnce(() => undefined);
    const service = makeService();
    updater.emit('update-downloaded', makeDownloadedEvent());

    expect(service.installUpdate()).toMatchObject({ status: 'error', errorCode: 'install-failed' });
    expect(service.installUpdate()).toMatchObject({ status: 'installing' });
    expect(updater.quitAndInstallMock).toHaveBeenCalledTimes(2);
  });
});

describe('setupAppUpdaterIpc', () => {
  it('registers each updater action on the shared channels and removes them during cleanup', async () => {
    const service = makeService();
    type TestHandler = (event?: Electron.IpcMainInvokeEvent, ...args: unknown[]) => unknown;
    const handlers = new Map<string, TestHandler>();
    const ipc = {
      handle: vi.fn((channel: string, handler: TestHandler) => handlers.set(channel, handler)),
      removeHandler: vi.fn(),
    };

    const cleanup = setupAppUpdaterIpc(service, ipc);

    expect([...handlers.keys()]).toEqual([
      IPC_CHANNELS.UPDATE_STATE_GET,
      IPC_CHANNELS.UPDATE_CHECK,
      IPC_CHANNELS.UPDATE_DOWNLOAD,
      IPC_CHANNELS.UPDATE_INSTALL,
    ]);
    expect(handlers.get(IPC_CHANNELS.UPDATE_STATE_GET)?.()).toBe(service.getState());
    const checkResult = handlers.get(IPC_CHANNELS.UPDATE_CHECK)?.(undefined, true);
    await expect(checkResult).resolves.toMatchObject({ status: 'up-to-date' });
    expect(updater.autoDownload).toBe(true);

    cleanup();
    expect(ipc.removeHandler).toHaveBeenCalledTimes(4);
  });

  it('rejects updater actions from plugin-host renderers', async () => {
    const service = makeService();
    type TestHandler = (event?: Electron.IpcMainInvokeEvent, ...args: unknown[]) => unknown;
    const handlers = new Map<string, TestHandler>();
    const ipc = {
      handle: vi.fn((channel: string, handler: TestHandler) => handlers.set(channel, handler)),
      removeHandler: vi.fn(),
    };
    setupAppUpdaterIpc(service, ipc);
    const pluginEvent = {
      sender: { getURL: () => 'file:///Applications/mLearn.app/plugin-host.html' },
    };

    expect(() => handlers.get(IPC_CHANNELS.UPDATE_INSTALL)?.(pluginEvent as Electron.IpcMainInvokeEvent))
      .toThrow(/unavailable from plugin hosts/);
    expect(updater.quitAndInstallMock).not.toHaveBeenCalled();
  });
});
