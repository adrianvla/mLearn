import { app, BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron';
import {
  autoUpdater,
  type AppUpdater,
  type ProgressInfo,
  type UpdateCheckResult,
  type UpdateDownloadedEvent,
  type UpdateInfo,
} from 'electron-updater';
import type {
  AppUpdateDetails,
  AppUpdateErrorCode,
  AppUpdateOperation,
  AppUpdateProgress,
  AppUpdateState,
  AppUpdateSupportReason,
  InitializeAppUpdaterOptions,
} from '../../shared/appUpdate';
import { IPC_CHANNELS, UPDATE_URL } from '../../shared/constants';
import { compareSemanticVersions } from '../../shared/semanticVersion';
import { DEFAULT_SETTINGS } from '../../shared/types';
import { getLogger } from '../../shared/utils/logger';
import { loadSettings } from './settings';

const UPDATE_METADATA_TIMEOUT_MS = 10_000;

interface BroadcastWindow {
  isDestroyed(): boolean;
  readonly webContents: {
    isDestroyed?(): boolean;
    send(channel: string, payload: AppUpdateState): void;
  };
}

interface IpcMainLike {
  handle(channel: string, listener: (event?: IpcMainInvokeEvent, ...args: unknown[]) => unknown): void;
  removeHandler(channel: string): void;
}

interface AppUpdaterLogger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

export interface AppUpdaterServiceOverrides {
  readonly updater?: AppUpdater;
  readonly getCurrentVersion?: () => string;
  readonly isPackaged?: () => boolean;
  readonly platform?: NodeJS.Platform;
  readonly environment?: Readonly<NodeJS.ProcessEnv>;
  readonly getAutoDownload?: () => boolean;
  readonly fetchMetadata?: (url: string) => Promise<unknown>;
  readonly metadataUrl?: string;
  readonly getAllWindows?: () => readonly BroadcastWindow[];
  readonly stateChangedChannel?: string;
  readonly now?: () => number;
  readonly logger?: AppUpdaterLogger;
}

export interface AppUpdaterService {
  initialize(options?: InitializeAppUpdaterOptions): Promise<AppUpdateState>;
  getState(): AppUpdateState;
  checkForUpdates(autoDownload?: boolean): Promise<AppUpdateState>;
  downloadUpdate(): Promise<AppUpdateState>;
  installUpdate(): AppUpdateState;
  dispose(): void;
}

interface ResolvedDependencies {
  readonly updater: AppUpdater;
  readonly currentVersion: string;
  readonly supportReason: AppUpdateSupportReason | null;
  readonly getAutoDownload: () => boolean;
  readonly fetchMetadata: (url: string) => Promise<unknown>;
  readonly metadataUrl: string;
  readonly getAllWindows: () => readonly BroadcastWindow[];
  readonly stateChangedChannel: string;
  readonly now: () => number;
  readonly logger: AppUpdaterLogger;
}

interface DownloadFlight {
  readonly promise: Promise<AppUpdateState>;
  readonly resolve: (state: AppUpdateState) => void;
}

type AppUpdateStateBaseKey =
  | 'currentVersion'
  | 'availableVersion'
  | 'canAutoUpdate'
  | 'supportReason'
  | 'updatedAt';

type WithoutStateBase<T> = T extends unknown ? Omit<T, AppUpdateStateBaseKey> : never;
type AppUpdateTransition = WithoutStateBase<AppUpdateState>;

class InvalidUpdateMetadataError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function optionalNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeHttpUrl(value: unknown): string | undefined {
  const candidate = optionalNonEmptyString(value);
  if (!candidate) return undefined;
  try {
    const parsed = new URL(candidate);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.toString() : undefined;
  } catch {
    return undefined;
  }
}

function normalizeReleaseNotes(value: UpdateInfo['releaseNotes']): string | undefined {
  if (typeof value === 'string') return optionalNonEmptyString(value);
  if (!Array.isArray(value)) return undefined;
  const notes = value
    .map((entry) => optionalNonEmptyString(entry.note))
    .filter((entry): entry is string => entry !== undefined);
  return notes.length > 0 ? notes.join('\n\n') : undefined;
}

function detailsFromNativeInfo(info: UpdateInfo): AppUpdateDetails {
  return {
    version: info.version,
    source: 'native',
    releaseName: optionalNonEmptyString(info.releaseName),
    releaseNotes: normalizeReleaseNotes(info.releaseNotes),
    releaseDate: optionalNonEmptyString(info.releaseDate),
  };
}

function detailsFromMetadata(metadata: Record<string, unknown>, version: string): AppUpdateDetails {
  return {
    version,
    source: 'metadata',
    releaseName: optionalNonEmptyString(metadata.releaseName),
    releaseNotes: optionalNonEmptyString(metadata.releaseNotes),
    releaseDate: optionalNonEmptyString(metadata.releaseDate),
    manualDownloadUrl: normalizeHttpUrl(metadata.downloadUrl ?? metadata.url),
  };
}

function finiteNonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function normalizeProgress(progress: ProgressInfo): AppUpdateProgress {
  return {
    percent: Math.min(100, finiteNonNegative(progress.percent)),
    bytesPerSecond: finiteNonNegative(progress.bytesPerSecond),
    transferred: finiteNonNegative(progress.transferred),
    total: finiteNonNegative(progress.total),
  };
}

function freezeState(state: AppUpdateState): AppUpdateState {
  if ('update' in state && state.update) Object.freeze(state.update);
  if ('progress' in state) Object.freeze(state.progress);
  return Object.freeze(state);
}

export function detectAppUpdateSupport(
  isPackaged: boolean,
  platform: NodeJS.Platform,
  environment: Readonly<NodeJS.ProcessEnv>,
): AppUpdateSupportReason | null {
  if (!isPackaged) return 'development';
  if (platform === 'win32' && (environment.PORTABLE_EXECUTABLE_FILE || environment.PORTABLE_EXECUTABLE_DIR)) {
    return 'windows-portable';
  }
  if (platform === 'linux' && !environment.APPIMAGE) return 'linux-non-appimage';
  if (platform !== 'darwin' && platform !== 'win32' && platform !== 'linux') return 'unsupported-platform';
  return null;
}

async function fetchUpdateMetadata(url: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(UPDATE_METADATA_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`Update metadata request failed with HTTP ${response.status}`);
  }
  return response.json();
}

function resolveDependencies(overrides: AppUpdaterServiceOverrides): ResolvedDependencies {
  const logger = overrides.logger ?? getLogger('electron.appUpdater');
  const currentVersion = overrides.getCurrentVersion?.() ?? app.getVersion();
  const supportReason = detectAppUpdateSupport(
    overrides.isPackaged?.() ?? app.isPackaged,
    overrides.platform ?? process.platform,
    overrides.environment ?? process.env,
  );
  return {
    updater: overrides.updater ?? autoUpdater,
    currentVersion,
    supportReason,
    getAutoDownload: overrides.getAutoDownload ?? (() => (
      loadSettings().automaticallyDownloadUpdates ?? DEFAULT_SETTINGS.automaticallyDownloadUpdates
    )),
    fetchMetadata: overrides.fetchMetadata ?? fetchUpdateMetadata,
    metadataUrl: overrides.metadataUrl ?? UPDATE_URL,
    getAllWindows: overrides.getAllWindows ?? (() => BrowserWindow.getAllWindows()),
    stateChangedChannel: overrides.stateChangedChannel ?? IPC_CHANNELS.UPDATE_STATE_CHANGED,
    now: overrides.now ?? Date.now,
    logger,
  };
}

class AppUpdaterServiceImpl implements AppUpdaterService {
  private readonly dependencies: ResolvedDependencies;
  private state: AppUpdateState;
  private latestUpdate: AppUpdateDetails | undefined;
  private checkFlight: Promise<AppUpdateState> | null = null;
  private downloadFlight: DownloadFlight | null = null;
  private activeOperation: AppUpdateOperation | null = null;
  private initialized = false;
  private disposed = false;

  private readonly onChecking = (): void => {
    this.activeOperation = 'check';
    if (this.state.status !== 'checking') this.transition({ status: 'checking' });
  };

  private readonly onUpdateAvailable = (info: UpdateInfo): void => {
    this.latestUpdate = detailsFromNativeInfo(info);
    const autoDownload = this.dependencies.updater.autoDownload;
    this.activeOperation = autoDownload ? 'download' : null;
    this.transition({ status: 'available', update: this.latestUpdate });
    this.dependencies.logger.info('Update available', { version: info.version, autoDownload });
    if (autoDownload) this.beginDownloadFlight();
  };

  private readonly onUpdateNotAvailable = (info: UpdateInfo): void => {
    this.activeOperation = null;
    this.latestUpdate = undefined;
    this.transition({ status: 'up-to-date' });
    this.dependencies.logger.info('No update available', { version: info.version });
  };

  private readonly onDownloadProgress = (progress: ProgressInfo): void => {
    if (!this.latestUpdate) {
      this.dependencies.logger.warn('Ignored download progress without update metadata');
      return;
    }
    this.activeOperation = 'download';
    this.beginDownloadFlight();
    this.transition({
      status: 'downloading',
      update: this.latestUpdate,
      progress: normalizeProgress(progress),
    });
  };

  private readonly onUpdateDownloaded = (event: UpdateDownloadedEvent): void => {
    this.latestUpdate = detailsFromNativeInfo(event);
    this.activeOperation = null;
    this.transition({ status: 'downloaded', update: this.latestUpdate });
    this.dependencies.logger.info('Update downloaded', {
      version: event.version,
      downloadedFile: event.downloadedFile,
    });
    this.completeDownloadFlight();
  };

  private readonly onUpdaterError = (error: Error, message?: string): void => {
    const operation = this.inferActiveOperation();
    this.dependencies.logger.error('Electron updater error', error, message);
    this.fail(operation, this.errorCodeForOperation(operation));
  };

  constructor(overrides: AppUpdaterServiceOverrides) {
    this.dependencies = resolveDependencies(overrides);
    this.state = freezeState({
      status: 'idle',
      currentVersion: this.dependencies.currentVersion,
      canAutoUpdate: this.dependencies.supportReason === null,
      supportReason: this.dependencies.supportReason,
      updatedAt: this.dependencies.now(),
    });

    this.dependencies.updater.autoInstallOnAppQuit = true;
    this.refreshAutoDownload();
    this.addUpdaterListeners();
  }

  async initialize(options: InitializeAppUpdaterOptions = {}): Promise<AppUpdateState> {
    if (!this.initialized) {
      this.initialized = true;
      this.broadcast(this.state);
    }
    if (options.autoCheck === false) return this.state;
    return this.checkForUpdates();
  }

  getState(): AppUpdateState {
    return this.state;
  }

  checkForUpdates(autoDownload?: boolean): Promise<AppUpdateState> {
    if (this.checkFlight) return this.checkFlight;
    if (
      this.disposed
      || this.state.status === 'installing'
      || this.state.status === 'downloading'
      || this.state.status === 'downloaded'
    ) {
      return Promise.resolve(this.state);
    }

    const flight = this.dependencies.supportReason === null
      ? this.performNativeCheck(autoDownload)
      : this.performMetadataCheck();
    this.checkFlight = flight;
    void flight.finally(() => {
      if (this.checkFlight === flight) this.checkFlight = null;
    });
    return flight;
  }

  downloadUpdate(): Promise<AppUpdateState> {
    if (this.downloadFlight) return this.downloadFlight.promise;
    if (this.disposed || this.state.status === 'downloaded' || this.state.status === 'installing') {
      return Promise.resolve(this.state);
    }
    if (this.dependencies.supportReason !== null) {
      return Promise.resolve(this.fail('download', 'download-unsupported'));
    }
    if (!this.latestUpdate || (this.state.status !== 'available' && this.state.status !== 'error')) {
      return Promise.resolve(this.fail('download', 'download-not-available'));
    }

    const flight = this.beginDownloadFlight();
    this.activeOperation = 'download';
    this.transition({
      status: 'downloading',
      update: this.latestUpdate,
      progress: { percent: 0, bytesPerSecond: 0, transferred: 0, total: 0 },
    });
    void this.dependencies.updater.downloadUpdate()
      .then(() => {
        if (this.state.status !== 'downloaded' && this.latestUpdate) {
          this.transition({ status: 'downloaded', update: this.latestUpdate });
        }
        this.activeOperation = null;
        this.completeDownloadFlight();
      })
      .catch((error: unknown) => {
        this.dependencies.logger.error('Update download failed', error);
        this.fail('download', 'download-failed');
      });
    return flight.promise;
  }

  installUpdate(): AppUpdateState {
    if (this.disposed || this.state.status === 'installing') return this.state;
    const retryingFailedInstall = this.state.status === 'error'
      && this.state.operation === 'install'
      && this.state.retryable;
    if ((this.state.status !== 'downloaded' && !retryingFailedInstall) || !this.latestUpdate) {
      return this.fail('install', 'install-not-ready');
    }

    this.activeOperation = 'install';
    this.transition({ status: 'installing', update: this.latestUpdate });
    try {
      this.dependencies.logger.info('Restarting to install update', { version: this.latestUpdate.version });
      this.dependencies.updater.quitAndInstall(false, true);
    } catch (error) {
      this.dependencies.logger.error('Failed to launch update installer', error);
      return this.fail('install', 'install-failed');
    }
    return this.state;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.dependencies.updater.removeListener('checking-for-update', this.onChecking);
    this.dependencies.updater.removeListener('update-available', this.onUpdateAvailable);
    this.dependencies.updater.removeListener('update-not-available', this.onUpdateNotAvailable);
    this.dependencies.updater.removeListener('download-progress', this.onDownloadProgress);
    this.dependencies.updater.removeListener('update-downloaded', this.onUpdateDownloaded);
    this.dependencies.updater.removeListener('error', this.onUpdaterError);
    this.completeDownloadFlight();
  }

  private addUpdaterListeners(): void {
    this.dependencies.updater.on('checking-for-update', this.onChecking);
    this.dependencies.updater.on('update-available', this.onUpdateAvailable);
    this.dependencies.updater.on('update-not-available', this.onUpdateNotAvailable);
    this.dependencies.updater.on('download-progress', this.onDownloadProgress);
    this.dependencies.updater.on('update-downloaded', this.onUpdateDownloaded);
    this.dependencies.updater.on('error', this.onUpdaterError);
  }

  private refreshAutoDownload(preferredValue?: boolean): void {
    try {
      this.dependencies.updater.autoDownload = preferredValue ?? this.dependencies.getAutoDownload();
    } catch (error) {
      this.dependencies.updater.autoDownload = DEFAULT_SETTINGS.automaticallyDownloadUpdates;
      this.dependencies.logger.error('Failed to read automatic update download setting', error);
    }
  }

  private async performNativeCheck(autoDownload?: boolean): Promise<AppUpdateState> {
    this.refreshAutoDownload(autoDownload);
    this.activeOperation = 'check';
    this.transition({ status: 'checking' });
    try {
      const result = await this.dependencies.updater.checkForUpdates();
      if (this.state.status === 'checking') this.applyNativeCheckResult(result);
      if (result?.downloadPromise) this.observeAutomaticDownload(result);
    } catch (error) {
      if (this.state.status !== 'error') {
        this.dependencies.logger.error('Native update check failed', error);
        this.fail(this.inferActiveOperation(), this.errorCodeForOperation(this.inferActiveOperation()));
      }
    } finally {
      if (this.activeOperation === 'check') this.activeOperation = null;
    }
    return this.state;
  }

  private applyNativeCheckResult(result: UpdateCheckResult | null): void {
    if (!result) {
      this.dependencies.logger.error('Native updater returned no check result');
      this.fail('check', 'native-check-failed');
      return;
    }
    if (result.isUpdateAvailable) this.onUpdateAvailable(result.updateInfo);
    else this.onUpdateNotAvailable(result.updateInfo);
  }

  private observeAutomaticDownload(result: UpdateCheckResult): void {
    const flight = this.beginDownloadFlight();
    void result.downloadPromise
      ?.then(() => {
        if (this.state.status !== 'downloaded') {
          this.latestUpdate = detailsFromNativeInfo(result.updateInfo);
          this.transition({ status: 'downloaded', update: this.latestUpdate });
        }
        this.activeOperation = null;
        this.completeDownloadFlight();
      })
      .catch((error: unknown) => {
        if (this.state.status !== 'error') {
          this.dependencies.logger.error('Automatic update download failed', error);
          this.fail('download', 'download-failed');
        }
      });
    void flight.promise;
  }

  private async performMetadataCheck(): Promise<AppUpdateState> {
    this.activeOperation = 'check';
    this.transition({ status: 'checking' });
    try {
      const value = await this.dependencies.fetchMetadata(this.dependencies.metadataUrl);
      if (!isRecord(value)) throw new InvalidUpdateMetadataError('Metadata is not an object');
      const latest = optionalNonEmptyString(value.latest);
      if (!latest) throw new InvalidUpdateMetadataError('Metadata has no latest version');
      const comparison = compareSemanticVersions(latest, this.dependencies.currentVersion);
      if (comparison === undefined) throw new InvalidUpdateMetadataError('Metadata contains an invalid semantic version');

      if (comparison > 0) {
        this.latestUpdate = detailsFromMetadata(value, latest);
        this.transition({ status: 'available', update: this.latestUpdate });
        this.dependencies.logger.info('Manual update available from metadata', { version: latest });
      } else {
        this.latestUpdate = undefined;
        this.transition({ status: 'up-to-date' });
      }
    } catch (error) {
      const errorCode: AppUpdateErrorCode = error instanceof InvalidUpdateMetadataError
        ? 'invalid-update-metadata'
        : 'metadata-check-failed';
      this.dependencies.logger.error('Fallback update metadata check failed', error);
      this.fail('check', errorCode);
    } finally {
      this.activeOperation = null;
    }
    return this.state;
  }

  private beginDownloadFlight(): DownloadFlight {
    if (this.downloadFlight) return this.downloadFlight;
    let resolve!: (state: AppUpdateState) => void;
    const promise = new Promise<AppUpdateState>((innerResolve) => {
      resolve = innerResolve;
    });
    this.downloadFlight = { promise, resolve };
    return this.downloadFlight;
  }

  private completeDownloadFlight(): void {
    const flight = this.downloadFlight;
    if (!flight) return;
    this.downloadFlight = null;
    flight.resolve(this.state);
  }

  private inferActiveOperation(): AppUpdateOperation {
    if (this.activeOperation) return this.activeOperation;
    if (this.state.status === 'downloading' || this.state.status === 'available') return 'download';
    if (this.state.status === 'installing') return 'install';
    return 'check';
  }

  private errorCodeForOperation(operation: AppUpdateOperation): AppUpdateErrorCode {
    if (operation === 'download') return 'download-failed';
    if (operation === 'install') return 'install-failed';
    return 'native-check-failed';
  }

  private fail(operation: AppUpdateOperation, errorCode: AppUpdateErrorCode): AppUpdateState {
    this.activeOperation = null;
    this.transition({
      status: 'error',
      operation,
      errorCode,
      retryable: errorCode === 'native-check-failed'
        || errorCode === 'metadata-check-failed'
        || errorCode === 'download-failed'
        || errorCode === 'install-failed',
      update: this.latestUpdate,
    });
    if (operation === 'download') this.completeDownloadFlight();
    return this.state;
  }

  private transition(next: AppUpdateTransition): void {
    const update = 'update' in next ? next.update : undefined;
    const state: AppUpdateState = {
      ...next,
      currentVersion: this.dependencies.currentVersion,
      availableVersion: update?.version,
      canAutoUpdate: this.dependencies.supportReason === null,
      supportReason: this.dependencies.supportReason,
      updatedAt: Math.max(this.dependencies.now(), this.state.updatedAt + 1),
    };
    this.state = freezeState(state);
    this.broadcast(this.state);
  }

  private broadcast(state: AppUpdateState): void {
    for (const window of this.dependencies.getAllWindows()) {
      if (window.isDestroyed() || window.webContents.isDestroyed?.()) continue;
      try {
        window.webContents.send(this.dependencies.stateChangedChannel, state);
      } catch (error) {
        this.dependencies.logger.warn('Failed to broadcast update state to a window', error);
      }
    }
  }
}

export function createAppUpdaterService(
  overrides: AppUpdaterServiceOverrides = {},
): AppUpdaterService {
  return new AppUpdaterServiceImpl(overrides);
}

export function setupAppUpdaterIpc(
  service: AppUpdaterService,
  ipc: IpcMainLike = ipcMain,
): () => void {
  ipc.handle(IPC_CHANNELS.UPDATE_STATE_GET, () => service.getState());
  const assertAllowedSender = (event?: IpcMainInvokeEvent) => {
    if (event?.sender.getURL().includes('/plugin-host.html')) {
      throw new Error('Update actions are unavailable from plugin hosts');
    }
  };
  ipc.handle(IPC_CHANNELS.UPDATE_CHECK, (event, ...args) => {
    assertAllowedSender(event);
    const autoDownload = typeof args[0] === 'boolean' ? args[0] : undefined;
    return service.checkForUpdates(autoDownload);
  });
  ipc.handle(IPC_CHANNELS.UPDATE_DOWNLOAD, (event) => {
    assertAllowedSender(event);
    return service.downloadUpdate();
  });
  ipc.handle(IPC_CHANNELS.UPDATE_INSTALL, (event) => {
    assertAllowedSender(event);
    return service.installUpdate();
  });

  return () => {
    ipc.removeHandler(IPC_CHANNELS.UPDATE_STATE_GET);
    ipc.removeHandler(IPC_CHANNELS.UPDATE_CHECK);
    ipc.removeHandler(IPC_CHANNELS.UPDATE_DOWNLOAD);
    ipc.removeHandler(IPC_CHANNELS.UPDATE_INSTALL);
  };
}
