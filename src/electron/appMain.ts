/** Application services loaded after the static splash is visible. */
import { installPerfIpcCounters } from './perfIpcCounters';

import { app, ipcMain, clipboard, shell } from 'electron';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { findPython, terminatePythonBackend, setupPythonBackendIPC } from './services/pythonBackend';
import { startWebServer, stopWebServer } from './services/webServer';
import { setupFlashcardIPC } from './services/flashcardStorage';
import { setupFlashcardImageIPC, setupFlashcardImageProtocol } from './services/flashcardImageStorage';
import { setupFlashcardTtsIPC, setupFlashcardAudioProtocol } from './services/flashcardTtsStorage';
import { setupFlashcardVideoIPC, setupFlashcardVideoProtocol } from './services/flashcardVideoStorage';
import { hasExistingProfile, setupSettingsIPC } from './services/settings';
import { setupLoggingService } from './services/loggingService';
import { setupLocalizationIPC } from './services/localization';
import { setupWindowIPC, createMainWindow, createWelcomeWindow, createDiagnosticsWindow, getCurrentWindow, getMainWindow } from './services/windowManager';
import { initOverlaySiteState, registerOverlaySiteStateIPC } from './services/overlaySiteState';
import { getExtensionDistDir } from './utils/platform';
import { setupFileOperationsIPC } from './services/fileOperations';
import { setupLocalMediaProtocol, setupPluginUiProtocol } from './services/localMediaProtocol';
import { setupMediaStatsIPC } from './services/mediaStatsStorage';
import { setupKnowledgeEventsIPC } from './services/knowledgeEvents';
import { setupOllamaIPC } from './services/ollamaService';
import { setupBuiltinLLMIPC } from './services/builtinLLMService';
import { setupLLMRouterIPC } from './services/llmRouter';
import { setupSpeechIPC } from './services/speechService';
import { setupVoiceIPC } from './services/voiceService';
import { setupDataExportImportIPC } from './services/dataExportImport';
import { setupKVStoreIPC } from './services/kvStore';
import { setupLinguisticGraphIPC } from './services/linguisticGraph';
import { setupJournalIPC } from './services/journalService';
import { startScheduler, stopScheduler } from './services/schedulerRuntime';
import { cancelAllMaintenance, reconcilePendingMaintenance } from './services/dreamerRuntime';
import { cancelAllAutonomy, reconcilePendingAutonomyRuntime } from './services/autonomyRuntime';
import { activateContactFromDeepLink, cancelAllContacts } from './services/contactRuntime';
import { setupWorldIPC, openRoomAt } from './services/worldIpc';
import { runLegacyMigration } from './services/legacyMigration';
import { reconcilePendingIntegrations } from './services/integration';
import { handleStartupFailure } from './services/startupFailure';
import { setupBrowserDetectionIPC } from './services/browserDetection';
import { setupExtensionInstallerIPC } from './services/extensionInstaller';
import { initPluginManager } from './services/pluginManager';
import { setupPluginIPC } from './services/pluginIPC';
import { setupDiagnosticsIPC } from './services/diagnostics';
import { createAppUpdaterService, setupAppUpdaterIpc, type AppUpdaterService } from './services/appUpdater';
import { createTray, destroyTray } from './services/trayManager';
import { installSolidDevtools } from './services/solidDevtools';
import { IPC_CHANNELS } from '../shared/constants';
import type { OpenRoomEventPayload } from '../shared/world';
import { setupKillHandlers } from './services/processManager';
import { getLogger } from '../shared/utils/logger';
import { Guardian, activateGuardian } from './services/guardian';
import { getUserDataPath } from './utils/platform';
import { createWindowActivation } from './services/windowActivation';
import { whenKnowledgeEventsReady } from './services/knowledgeEvents';
import { initializeKikanRuntime, recordOperationalEvent, refreshKikanRuntime } from './services/kikanRuntime';
import { startupMark, startupTime, startupTimingEnabled } from './startupTiming';
import { closeSplashWindow, completeStartup, getSplashWindow, reportStartupPhase } from './splashWindow';
import { waitForMainWindowStartup } from './services/startupHandoff';

const log = getLogger('electron.main');
let appWindowCreationPromise: Promise<void> | null = null;
let appUpdaterService: AppUpdaterService | null = null;
let guardianForShutdown: Guardian | undefined;
let shutdownCheckpointStarted = false;
let shutdownCheckpointFinished = false;

interface AuthDeepLinkPayload {
  code: string | null;
  state: string | null;
  error: string | null;
}

const queuedAuthDeepLinks: AuthDeepLinkPayload[] = [];
const queuedLookupWords: string[] = [];

function parseAuthDeepLink(rawUrl: string): AuthDeepLinkPayload | null {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'mlearn:') {
      return null;
    }
    const path = `${parsed.hostname}${parsed.pathname}`;
    if (path !== 'auth/callback') {
      return null;
    }
    return {
      code: parsed.searchParams.get('code'),
      state: parsed.searchParams.get('state'),
      error: parsed.searchParams.get('error'),
    };
  } catch (e) {
    log.error('parseAuthDeepLink failed', e);
    return null;
  }
}

function parseLookupDeepLink(rawUrl: string): string | null {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'mlearn:') {
      return null;
    }
    if (parsed.hostname !== 'lookup') {
      return null;
    }
    const word = parsed.searchParams.get('word');
    return word && word.trim() ? word.trim() : null;
  } catch (e) {
    log.error('parseLookupDeepLink failed', e);
    return null;
  }
}

function isDiagnosticsDeepLink(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    return parsed.protocol === 'mlearn:' && parsed.hostname === 'diagnostics';
  } catch {
    return false;
  }
}

function parseRoomDeepLink(rawUrl: string): OpenRoomEventPayload | null {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'mlearn:') {
      return null;
    }
    if (parsed.hostname !== 'room') {
      return null;
    }
    const roomId = parsed.pathname.replace(/^\//, '');
    if (!roomId) {
      return null;
    }
    const eventId = parsed.searchParams.get('event');
    return { roomId, eventId: eventId ?? undefined };
  } catch (e) {
    log.error('parseRoomDeepLink failed', e);
    return null;
  }
}

function parseContactDeepLink(rawUrl: string): string | null {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'mlearn:' || parsed.hostname !== 'contact') return null;
    const contactId = parsed.pathname.replace(/^\//u, '');
    return contactId.startsWith('contact_') ? contactId : null;
  } catch (error) {
    log.error('parseContactDeepLink failed', error);
    return null;
  }
}

function dispatchAuthDeepLink(payload: AuthDeepLinkPayload): void {
  if (getSplashWindow()) {
    queuedAuthDeepLinks.push(payload);
    return;
  }
  const { BrowserWindow } = require('electron');
  const windows = BrowserWindow.getAllWindows().filter((win: Electron.BrowserWindow) => win !== getSplashWindow());
  if (windows.length === 0) {
    queuedAuthDeepLinks.push(payload);
    return;
  }
  for (const win of windows) {
    if (!win.isDestroyed()) {
      win.webContents.send(IPC_CHANNELS.AUTH_DEEP_LINK, payload);
    }
  }
}

function dispatchLookupDeepLink(word: string): void {
  if (getSplashWindow()) {
    queuedLookupWords.push(word);
    return;
  }
  const { BrowserWindow } = require('electron');
  const windows = BrowserWindow.getAllWindows().filter((win: Electron.BrowserWindow) => win !== getSplashWindow());
  if (windows.length === 0) {
    queuedLookupWords.push(word);
    return;
  }
  for (const win of windows) {
    if (!win.isDestroyed()) {
      win.webContents.send(IPC_CHANNELS.LOOKUP_DEEP_LINK, word);
      return;
    }
  }
}

function flushQueuedAuthDeepLinks(): void {
  if (queuedAuthDeepLinks.length === 0) {
    return;
  }
  const queue = queuedAuthDeepLinks.splice(0, queuedAuthDeepLinks.length);
  for (const payload of queue) {
    dispatchAuthDeepLink(payload);
  }
}

function flushQueuedLookupDeepLinks(): void {
  if (queuedLookupWords.length === 0) {
    return;
  }
  const queue = queuedLookupWords.splice(0, queuedLookupWords.length);
  for (const word of queue) {
    dispatchLookupDeepLink(word);
  }
}

function handlePossibleDeepLinkValue(value: string): void {
  const authPayload = parseAuthDeepLink(value);
  if (authPayload) {
    dispatchAuthDeepLink(authPayload);
    return;
  }
  const lookupWord = parseLookupDeepLink(value);
  if (lookupWord) {
    dispatchLookupDeepLink(lookupWord);
    return;
  }
  if (isDiagnosticsDeepLink(value)) {
    createDiagnosticsWindow();
    return;
  }
  const contactId = parseContactDeepLink(value);
  if (contactId) {
    void activateContactFromDeepLink(contactId);
    return;
  }
  const roomPayload = parseRoomDeepLink(value);
  if (roomPayload) {
    openRoomAt(roomPayload);
    return;
  }
}

function handleDeepLinkArgs(args: string[]): void {
  for (const arg of args) {
    if (arg.startsWith('mlearn://')) {
      handlePossibleDeepLinkValue(arg);
    }
  }
}

function focusExistingAppWindow(): boolean {
  const splash = getSplashWindow();
  if (splash && !splash.isDestroyed()) {
    splash.show();
    splash.focus();
    return true;
  }
  const win = getCurrentWindow();
  if (!win) return false;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  return true;
}

const execAsync = promisify(exec);

async function raiseFileDescriptorLimits(): Promise<void> {
  if (process.platform === 'darwin') {
    const TARGET_MAXFILES = 524288;
    try {
      const { stdout } = await execAsync('sysctl -n kern.maxfiles', { timeout: 2000 });
      const current = parseInt(stdout.trim(), 10);
      if (!isNaN(current) && current < TARGET_MAXFILES) {
        await execAsync(
          `sysctl -w kern.maxfiles=${TARGET_MAXFILES} kern.maxfilesperproc=${TARGET_MAXFILES}`,
          { timeout: 2000 },
        );
      }
    } catch {
      log.warn(
        `Could not raise kern.maxfiles (needs root). If OCR fails, run: ` +
        `sudo sysctl -w kern.maxfiles=524288 kern.maxfilesperproc=524288`,
      );
    }
  } else if (process.platform === 'linux') {
    try {
      await execAsync('sysctl -w fs.file-max=524288', { timeout: 2000 });
    } catch (e) {
      log.error('Failed to raise fs.file-max', e);
    }
  }
}

// Initialize IPC handlers (called once)
function setupBaseIPC(): void {
  ipcMain.on(IPC_CHANNELS.WRITE_TO_CLIPBOARD, (_event, text: string) => {
    clipboard.writeText(text);
  });

  ipcMain.on(IPC_CHANNELS.SHOW_CONTACT, () => {
    shell.openExternal('https://mlearn.kikan.net/');
  });

  ipcMain.handle(IPC_CHANNELS.OPEN_EXTERNAL_URL, async (_event, url: string) => {
    if (typeof url !== 'string' || !/^https?:\/\//.test(url)) {
      throw new Error('Only http/https URLs can be opened');
    }
    await shell.openExternal(url);
    return true;
  });

  ipcMain.handle(IPC_CHANNELS.OPEN_EXTENSION_FOLDER, async () => {
    const extensionDir = getExtensionDistDir();
    log.info(`Opening extension folder: ${extensionDir}`);

    try {
      const fs = await import('fs');
      const stats = await fs.promises.stat(extensionDir);
      if (!stats.isDirectory()) {
        log.error(`Extension path is not a directory: ${extensionDir}`);
        return false;
      }
    } catch (e) {
      log.error(`Extension folder does not exist: ${extensionDir}`, e);
      return false;
    }

    try {
      const result = await shell.openPath(extensionDir);
      if (result !== '') {
        log.warn(`shell.openPath returned error: ${result}`);
        const platform = process.platform;
        if (platform === 'darwin') {
          await promisify(exec)(`open "${extensionDir}"`);
        } else if (platform === 'win32') {
          await promisify(exec)(`explorer "${extensionDir}"`);
        } else {
          await promisify(exec)(`xdg-open "${extensionDir}"`);
        }
      }
      return true;
    } catch (e) {
      log.error('Failed to open extension folder:', e);
      return false;
    }
  });
}

// Track whether IPC handlers have been registered
let ipcInitialized = false;

// Register all IPC handlers (only once)
function setupAllIPC(): void {
  if (ipcInitialized) return;
  ipcInitialized = true;

  let phase = startupTime();
  setupBaseIPC();
  setupLoggingService();
  setupSettingsIPC();
  setupLocalizationIPC();
  startupMark('IPC base, logging, settings, localization registered', phase);
  phase = startupTime();
  setupFlashcardIPC();
  setupFlashcardImageIPC();
  setupFlashcardTtsIPC();
  setupFlashcardVideoIPC();
  startupMark('IPC flashcard services registered', phase);
  const platformServicesStart = startupTime();
  phase = platformServicesStart;
  setupWindowIPC();
  startupMark('IPC window manager registered', phase);
  phase = startupTime();
  registerOverlaySiteStateIPC();
  initOverlaySiteState();
  startupMark('IPC overlay state registered', phase);
  phase = startupTime();
  setupPluginUiProtocol();
  startupMark('IPC plugin UI protocol registered', phase);
  phase = startupTime();
  setupPythonBackendIPC();
  startupMark('IPC Python backend registered', phase);
  phase = startupTime();
  setupFileOperationsIPC();
  startupMark('IPC file operations registered', phase);
  phase = startupTime();
  setupMediaStatsIPC();
  startupMark('IPC media stats registered', phase);
  startupMark('IPC window, platform, media services registered', platformServicesStart);
  phase = startupTime();
  setupKnowledgeEventsIPC();
  startupMark('IPC knowledge DB service registered', phase);
  phase = startupTime();
  setupOllamaIPC();
  setupBuiltinLLMIPC();
  setupLLMRouterIPC();
  setupSpeechIPC();
  setupVoiceIPC();
  setupDataExportImportIPC();
  setupKVStoreIPC();
  setupLinguisticGraphIPC();
  setupJournalIPC();
  setupWorldIPC();
  startupMark('IPC world and language services registered', phase);
  phase = startupTime();
  setupBrowserDetectionIPC();
  setupExtensionInstallerIPC();
  setupPluginIPC();
  setupDiagnosticsIPC();
  setupKillHandlers();
  appUpdaterService = createAppUpdaterService();
  setupAppUpdaterIpc(appUpdaterService);
  startupMark('IPC remaining services registered', phase);
}

// Create windows and start services
async function createAppWindows(startup = false): Promise<void> {
  if (appWindowCreationPromise) {
    await appWindowCreationPromise;
    return;
  }

  appWindowCreationPromise = (async () => {
  const windowStart = startupTime();
  // Check for diagnostics mode
  const isDiagnosticsMode = process.argv.includes('--diagnostics');
  if (isDiagnosticsMode) {
    const diagnosticsWindow = createDiagnosticsWindow();
    if (startup) {
      reportStartupPhase('preparation', 0, 'Preparing diagnostics');
      await new Promise<void>((resolve) => diagnosticsWindow.webContents.once('did-finish-load', () => resolve()));
    }
    startupMark('diagnostics window creation returned', windowStart);
    startWebServer();
    return;
  }

  let windowReady: Promise<void> | null = null;
  let rendererState = 'settings';
  let pythonLookupComplete = false;
  const reportRendererState = (): void => {
    if (!pythonLookupComplete) return;
    if (rendererState === 'language') reportStartupPhase('preparation', 0.35, 'Loading language data');
    else if (rendererState === 'library') reportStartupPhase('preparation', 0.65, 'Loading library');
    else if (rendererState === 'backend') reportStartupPhase('preparation', 0.8, 'Waiting for Python tools');
    else if (rendererState === 'ready') reportStartupPhase('preparation', 0.95, 'Launching mLearn');
    else reportStartupPhase('preparation', 0, 'Loading settings');
  };
  if (hasExistingProfile()) {
    startupMark('existing profile check complete', windowStart);
    const window = createMainWindow({ show: !startup });
    if (startup) {
      windowReady = waitForMainWindowStartup(window, (state) => {
        rendererState = state;
        reportRendererState();
      });
      // The Python lookup is awaited first; observe an early window failure now.
      void windowReady.catch(() => {});
    }
  } else {
    startupMark('existing profile check complete', windowStart);
    const window = createWelcomeWindow({ show: !startup });
    if (startup) windowReady = new Promise<void>((resolve) => window.webContents.once('did-finish-load', () => resolve()));
  }
  startupMark('first window creation returned', windowStart);

  await findPython();
  pythonLookupComplete = true;
  reportRendererState();

  // Start web server for tethered mode AFTER window is created
  // This ensures any errors (like EADDRINUSE) can be displayed to the user
  startWebServer();
  if (windowReady) await windowReady;
  if (!startup) {
    flushQueuedAuthDeepLinks();
    flushQueuedLookupDeepLinks();
  }
  })();

  try {
    await appWindowCreationPromise;
  } finally {
    appWindowCreationPromise = null;
  }
}

// Main initialization
async function initialize(): Promise<void> {
  const initializationStart = startupTime();
  let phase = startupTime();
  await raiseFileDescriptorLimits();
  startupMark('file descriptor setup complete', phase);
  reportStartupPhase('inspection', 0, 'Checking library and recovery state');
  const guardian = new Guardian(getUserDataPath());
  phase = startupTime();
  await guardian.preflight((stage) => {
    if (stage === 'inspection-complete') reportStartupPhase('snapshot', 0, 'Creating recovery snapshot');
    if (stage === 'snapshot-complete') reportStartupPhase('snapshot', 1, 'Recovery snapshot ready');
  });
  reportStartupPhase('database', 0, 'Opening database and checking migrations');
  startupMark('Guardian preflight complete', phase);
  activateGuardian(guardian);
  installPerfIpcCounters();

  phase = startupTime();
  setupAllIPC();
  startupMark('IPC setup complete', phase);
  phase = startupTime();
  reportStartupPhase('database', 0.1, 'Opening and migrating knowledge database');
  await whenKnowledgeEventsReady();
  reportStartupPhase('database', 0.35, 'Preparing app data');
  startupMark('knowledge DB ready', phase);
  phase = startupTime();
  await initPluginManager();
  startupMark('plugin manager ready', phase);

  // Set up custom protocols for serving local files to renderer
  setupLocalMediaProtocol();
  setupFlashcardImageProtocol();
  setupFlashcardAudioProtocol();
  setupFlashcardVideoProtocol();

  // One-time legacy conversational-state migration (agent configs/sessions/memories
  // → Room/Thread/Participant + journal). Idempotent; no-ops after the first run.
  phase = startupTime();
  const worldMigration = await runLegacyMigration();
  reportStartupPhase('database', 0.6, 'Recovering prior sessions');
  startupMark('legacy world migration complete', phase);
  if (worldMigration.migrated) {
    log.info('Legacy conversation state migrated to world model', worldMigration);
  }

  // Recover integration publications after migration and before other recovery
  // or scheduler work. A failed read must reach the startup error boundary.
  phase = startupTime();
  await reconcilePendingIntegrations();
  startupMark('integration recovery complete', phase);

  // Maintenance recovery (V08): finish interrupted reflection/evolution
  // publications from the durable ledger before any scheduler pass runs.
  phase = startupTime();
  await reconcilePendingMaintenance();
  startupMark('maintenance recovery complete', phase);
  phase = startupTime();
  await reconcilePendingAutonomyRuntime();
  startupMark('autonomy recovery complete', phase);
  phase = startupTime();
  reportStartupPhase('database', 0.85, 'Verifying library');
  guardian.verify();
  reportStartupPhase('database', 1, 'Database verification complete');
  startupMark('Guardian post-migration verification complete', phase);
  guardianForShutdown = guardian;
  initializeKikanRuntime(Math.max(guardian.status.metrics?.flashcardSchema ?? 0, guardian.status.metrics?.knowledgeSchema ?? 0));
  recordOperationalEvent('app_start');

  phase = startupTime();
  await installSolidDevtools({ isPackaged: app.isPackaged });
  startupMark('devtools installation complete', phase);

  // Create windows and start services
  phase = startupTime();
  reportStartupPhase('python', 0, 'Starting Python tools and services');
  await createAppWindows(true);
  startupMark('window and service startup complete', phase);

  startScheduler();

  const mainWindow = getMainWindow();
  if (mainWindow) {
    createTray(mainWindow);
  }

  if (app.isPackaged && !app.isDefaultProtocolClient('mlearn')) {
    if (process.defaultApp && process.argv.length >= 2) {
      app.setAsDefaultProtocolClient('mlearn', process.execPath, [path.resolve(process.argv[1])]);
    } else {
      app.setAsDefaultProtocolClient('mlearn');
    }
  }

  void refreshKikanRuntime().then(() => appUpdaterService?.initialize({ autoCheck: app.isPackaged }))
    .catch((error) => log.error('Automatic update initialization failed', error));
  completeStartup();
  getCurrentWindow()?.show();
  getCurrentWindow()?.focus();
  closeSplashWindow();
  flushQueuedAuthDeepLinks();
  flushQueuedLookupDeepLinks();
  startupMark('initialization complete', initializationStart);
}

// App lifecycle
const windowActivation = createWindowActivation(focusExistingAppWindow, () => {
  void createAppWindows().catch(handleStartupFailure);
});
startupMark('application service module loaded; single-instance lock held');
{
  if (startupTimingEnabled) {
    app.on('browser-window-created', (_event, window) => {
      startupMark(`BrowserWindow created id=${window.id}`);
      window.webContents.on('did-start-loading', () => startupMark(`renderer load started id=${window.id}`));
      window.webContents.on('did-finish-load', () => startupMark(`renderer load finished id=${window.id}`));
      window.webContents.on('did-fail-load', (_loadEvent, code, description) => startupMark(`renderer load failed id=${window.id} code=${code} ${description}`));
      window.on('ready-to-show', () => startupMark(`ready-to-show id=${window.id}`));
      window.on('show', () => startupMark(`show id=${window.id}`));
    });
  }
  app.on('second-instance', (_event, commandLine) => {
    handleDeepLinkArgs(commandLine);
    focusExistingAppWindow();
  });

  app.on('open-url', (event, rawUrl) => {
    event.preventDefault();
    handlePossibleDeepLinkValue(rawUrl);
  });

  app.whenReady().then(() => {
    startupMark('app.whenReady resolved');
    if (process.platform !== 'darwin') {
      handleDeepLinkArgs(process.argv);
    }

    void initialize().then(() => windowActivation.markReady()).catch(handleStartupFailure);

    app.on('activate', () => {
      windowActivation.activate();
    });
  });
}

app.on('before-quit', () => {
  log.info('App before-quit: setting isQuitting flag, cleaning up');
  (app as any).isQuitting = true;
  destroyTray();
  stopScheduler();
  // In-flight reflection/evolution aborts at phase boundaries; prepared
  // publications stay reconcilable from the durable ledger.
  cancelAllMaintenance();
  cancelAllAutonomy();
  cancelAllContacts();
  terminatePythonBackend();
});

app.on('will-quit', (event) => {
  if (!guardianForShutdown || shutdownCheckpointFinished) return;
  event.preventDefault();
  if (shutdownCheckpointStarted) return;
  shutdownCheckpointStarted = true;
  void guardianForShutdown.checkpoint().catch((error) => {
    log.error('Guardian could not checkpoint shutdown state; earlier recovery points remain available', error);
  }).finally(() => {
    shutdownCheckpointFinished = true;
    app.quit();
  });
});

app.on('quit', () => {
  log.info('App quit: cleanup');
  appUpdaterService?.dispose();
  stopWebServer();
  terminatePythonBackend();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    const { hasTray } = require('./services/trayManager');
    if (hasTray()) {
      return;
    }
    terminatePythonBackend();
    app.quit();
  }
});
