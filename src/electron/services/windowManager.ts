/**
 * Window Manager Service
 * Handles creation and management of all application windows
 */

import { BrowserWindow, app, ipcMain, Menu, dialog, screen, nativeTheme, shell } from 'electron';
import path from 'path';
import fs from 'fs';
import { pathToFileURL } from 'url';
import { IPC_CHANNELS, WINDOW_TYPES, WindowType } from '../../shared/constants';
import { DEFAULT_SETTINGS, type WindowSize, type OpenWindowPayload, type OverlayVideoScreenshot } from '../../shared/types';
import { isDarkColorScheme } from '../../shared/constants';
import { isMac, isLinux, isWindows, isPackaged, getAppPath } from '../utils/platform';
import { loadSettings } from './settings';
import { registerWindowFirstPaint, showWindowAfterFirstPaint, showWindowAfterLoadFailure, initialWindowBackground, loadRecoveryHtml } from './windowFirstPaint';
import { getCurrentLocaleData } from './localization';
import { queueCommand } from './webServer';
import { hasTray } from './trayManager';
import { getLogger } from '../../shared/utils/logger';
import { startupMark, startupTime } from '../startupTiming';
import { resolveApplicationDestination, applicationHostForPath, type ApplicationHost } from '../../shared/applicationNavigation';

// Title-bar menu strip height — keep in sync with WindowsMenuBar.css --titlebar-height
const TITLEBAR_MENU_HEIGHT = 40;

// Window references
let mainWindow: BrowserWindow | null = null;
let welcomeWindow: BrowserWindow | null = null;
let overlayWindow: BrowserWindow | null = null;
let currentWindow: BrowserWindow | null = null;
const childWindows: Map<string, BrowserWindow> = new Map();
const DEV_WINDOW_LOAD_RETRY_LIMIT = 20;
const DEV_WINDOW_LOAD_RETRY_DELAY_MS = 250;
const log = getLogger('electron.windowManager');

// Context data passed to child windows
const windowContextStore: Map<string, Record<string, unknown>> = new Map();

// Window state for PiP
interface WindowState {
  width: number | null;
  height: number | null;
  fullscreen: boolean;
  trafficLights: boolean;
}
let oldWindowState: WindowState = {
  width: null,
  height: null,
  fullscreen: false,
  trafficLights: true,
};

// Getters
export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}

export function getCurrentWindow(): BrowserWindow | null {
  return currentWindow;
}

function focusWindow(window: BrowserWindow): void {
  if (window.isDestroyed()) return;
  window.focus();
}

function getInitialWindowBackground(): string {
  const settings = loadSettings();
  return initialWindowBackground(settings.colorScheme ?? DEFAULT_SETTINGS.colorScheme, settings.customColors ?? DEFAULT_SETTINGS.customColors);
}

function loadWindowHtml(window: BrowserWindow, type: WindowType, host?: ApplicationHost, initialPath?: string): void {
  startupMark(`renderer load requested type=${type} id=${window.id}`);
  const isDev = process.env.NODE_ENV === 'development';

  const filePath = getWindowHtmlPath(type);
  const url = isDev ? `http://localhost:3000/src/html/${type}.html${host ? `?host=${host}#${initialPath ?? '/'}` : ''}` : (() => {
    const fileUrl = pathToFileURL(filePath);
    if (host) fileUrl.searchParams.set('host', host);
    if (initialPath) fileUrl.hash = initialPath;
    return fileUrl.toString();
  })();
  let retryCount = 0;
  let retryTimer: NodeJS.Timeout | null = null;
  let recoveryPageRequested = false;

  const clearRetryTimer = (): void => {
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
  };

  const showLoadRecovery = (errorDescription: string, background = getInitialWindowBackground()): void => {
    if (recoveryPageRequested || window.isDestroyed()) return;
    recoveryPageRequested = true;
    clearRetryTimer();
    log.error(`Could not load ${type} window after ${retryCount} retries: ${errorDescription}`);
    void window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(loadRecoveryHtml(url, background))}`)
      .then(() => { if (!window.isDestroyed()) showWindowAfterLoadFailure(window); })
      .catch(error => {
        log.error(`Could not render the ${type} load recovery page:`, error);
        showWindowAfterLoadFailure(window);
      });
  };

  if (!isDev) {
    const load = host ? window.loadFile(filePath, { query: { host }, hash: initialPath }) : window.loadFile(filePath);
    void load.catch((error) => showLoadRecovery(error instanceof Error ? error.message : String(error)));
    return;
  }

  const load = (): void => {
    if (window.isDestroyed()) return;
    window.loadURL(url).catch((error) => {
      scheduleRetry(error instanceof Error ? error.message : String(error));
    });
  };

  const scheduleRetry = (errorDescription: string): void => {
    if (window.isDestroyed() || recoveryPageRequested || retryTimer) return;
    if (retryCount >= DEV_WINDOW_LOAD_RETRY_LIMIT) {
      showLoadRecovery(errorDescription);
      return;
    }
    retryCount += 1;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      load();
    }, DEV_WINDOW_LOAD_RETRY_DELAY_MS);
    log.warn(`Retrying ${type} window load after dev-server failure: ${errorDescription}`);
  };

  window.webContents.on('did-fail-load', (_event, _errorCode, errorDescription, validatedUrl, isMainFrame) => {
    if (!isMainFrame || validatedUrl !== url || window.isDestroyed()) return;
    scheduleRetry(errorDescription);
  });

  window.on('closed', clearRetryTimer);
  load();
}

export function getOverlayWindow(): BrowserWindow | null {
  return overlayWindow;
}

export function setOverlayIgnoreMouseEvents(ignore: boolean): void {
  const win = getOverlayWindow();
  if (!win || win.isDestroyed()) return;
  win.setIgnoreMouseEvents(ignore, { forward: true });
}

// Overlay manual positioning state
interface OverlayManualDelta {
  x: number;
  y: number;
  width: number;
  height: number;
}
let overlayManualDelta: OverlayManualDelta = { x: 0, y: 0, width: 0, height: 0 };
let overlayAutoPositionEnabled = true;
let geometryUpdateLocked = false;

export function getOverlayAutoPositionEnabled(): boolean {
  return overlayAutoPositionEnabled;
}

export function setOverlayAutoPositionEnabled(enabled: boolean): void {
  overlayAutoPositionEnabled = enabled;
  const win = getOverlayWindow();
  if (win && !win.isDestroyed()) {
    win.webContents.send(IPC_CHANNELS.OVERLAY_AUTO_POSITION_CHANGED, enabled);
  }
}

export function resetOverlayManualDelta(): void {
  overlayManualDelta = { x: 0, y: 0, width: 0, height: 0 };
}

export function getOverlayBounds(): { x: number; y: number; width: number; height: number } | null {
  const win = getOverlayWindow();
  if (!win || win.isDestroyed()) return null;
  const bounds = win.getBounds();
  return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
}

export function setOverlayBounds(bounds: { x: number; y: number; width: number; height: number }): void {
  const win = getOverlayWindow();
  if (!win || win.isDestroyed()) return;
  win.setBounds({
    x: Math.round(bounds.x),
    y: Math.round(bounds.y),
    width: Math.max(200, Math.round(bounds.width)),
    height: Math.max(100, Math.round(bounds.height)),
  });
}

export function moveOverlayBy(deltaX: number, deltaY: number): void {
  const win = getOverlayWindow();
  if (!win || win.isDestroyed()) return;
  const bounds = win.getBounds();
  if (overlayAutoPositionEnabled) {
    overlayManualDelta.x += deltaX;
    overlayManualDelta.y += deltaY;
  }
  win.setBounds({
    x: Math.round(bounds.x + deltaX),
    y: Math.round(bounds.y + deltaY),
    width: bounds.width,
    height: bounds.height,
  });
}

export function resizeOverlayBy(deltaWidth: number, deltaHeight: number): void {
  const win = getOverlayWindow();
  if (!win || win.isDestroyed()) return;
  const bounds = win.getBounds();
  if (overlayAutoPositionEnabled) {
    overlayManualDelta.width += deltaWidth;
    overlayManualDelta.height += deltaHeight;
  }
  win.setBounds({
    x: bounds.x,
    y: bounds.y,
    width: Math.max(200, Math.round(bounds.width + deltaWidth)),
    height: Math.max(100, Math.round(bounds.height + deltaHeight)),
  });
}

let lastGeometryUpdateTime = 0;
const GEOMETRY_UPDATE_MIN_INTERVAL_MS = 250;

export function updateOverlayGeometry(geometry: { x: number; y: number; width: number; height: number }): void {
  if (geometryUpdateLocked) return;
  if (!overlayAutoPositionEnabled) return;

  if (
    !Number.isFinite(geometry.x) ||
    !Number.isFinite(geometry.y) ||
    !Number.isFinite(geometry.width) ||
    !Number.isFinite(geometry.height)
  ) {
    console.warn('updateOverlayGeometry: received non-finite geometry values', geometry);
    return;
  }

  const win = getOverlayWindow();
  if (!win || win.isDestroyed()) return;

  const corrected = overlayAutoPositionEnabled
    ? {
        x: Math.round(geometry.x + overlayManualDelta.x),
        y: Math.round(geometry.y + overlayManualDelta.y),
        width: Math.max(200, Math.round(geometry.width + overlayManualDelta.width)),
        height: Math.max(100, Math.round(geometry.height + overlayManualDelta.height)),
      }
    : {
        x: Math.round(geometry.x),
        y: Math.round(geometry.y),
        width: Math.max(200, Math.round(geometry.width)),
        height: Math.max(100, Math.round(geometry.height)),
      };

  const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;
  if (
    corrected.x > screenWidth ||
    corrected.y > screenHeight ||
    corrected.x + corrected.width < 0 ||
    corrected.y + corrected.height < 0
  ) {
    console.warn('updateOverlayGeometry: corrected geometry is off-screen', corrected);
    return;
  }

  const now = Date.now();
  if (now - lastGeometryUpdateTime < GEOMETRY_UPDATE_MIN_INTERVAL_MS) {
    return;
  }

  const currentBounds = win.getBounds();
  const hasSignificantChange =
    Math.abs(corrected.x - currentBounds.x) >= 2 ||
    Math.abs(corrected.y - currentBounds.y) >= 2 ||
    Math.abs(corrected.width - currentBounds.width) >= 2 ||
    Math.abs(corrected.height - currentBounds.height) >= 2;

  if (!hasSignificantChange) {
    return;
  }

  lastGeometryUpdateTime = now;
  win.setBounds(corrected);
}

// Get preload script path
function resolveExistingPath(candidates: string[]): string {
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return candidates[0];
}

function getPreloadPath(): string {
  if (isPackaged) {
    const appPath = getAppPath();
    return resolveExistingPath([
      path.join(appPath, 'dist-electron', 'electron', 'preload.js'),
      path.join(__dirname, '..', 'preload.js'),
    ]);
  }

  return path.join(__dirname, '..', 'preload.js');
}

function getWindowHtmlPath(windowName: string): string {
  const htmlFile = `${windowName}.html`;

  if (isPackaged || process.env.NODE_ENV === 'production') {
    const appPath = isPackaged ? getAppPath() : app.getAppPath();
    return resolveExistingPath([
      path.join(appPath, 'dist', 'src', 'html', htmlFile),
      path.join(appPath, 'dist', htmlFile),
      path.join(__dirname, '..', '..', 'dist', htmlFile),
      path.join(__dirname, '..', '..', 'dist', 'src', 'html', htmlFile),
    ]);
  }

  return path.join(__dirname, '..', '..', '..', 'src', 'html', htmlFile);
}

function openSettingsWindow(section?: string): BrowserWindow {
  return openManagedChildWindow('settings' as WindowType, {}, section ? { section } : undefined);
}

// Create the main window
export function createMainWindow(options: { show?: boolean } = {}): BrowserWindow {
  if (welcomeWindow && !welcomeWindow.isDestroyed()) {
    const closingWelcomeWindow = welcomeWindow;
    welcomeWindow = null;
    if (currentWindow === closingWelcomeWindow) {
      currentWindow = null;
    }
    closingWelcomeWindow.close();
  }

  if (mainWindow && !mainWindow.isDestroyed()) {
    currentWindow = mainWindow;
    focusWindow(mainWindow);
    return mainWindow;
  }

  const windowOptions: Electron.BrowserWindowConstructorOptions = {
    width: 1200,
    height: 700,
    show: false,
    webPreferences: {
      preload: getPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },

    ...(isMac ? getMacWindowSurfaceOptions() : {}),
    backgroundColor: getInitialWindowBackground(),
  };

  if (isWindows) {
    const savedScheme = loadSettings().colorScheme ?? DEFAULT_SETTINGS.colorScheme;
    const useDarkChrome = savedScheme === 'custom' ? nativeTheme.shouldUseDarkColors : isDarkColorScheme(savedScheme);
    // Windows: hide the native frame/title and draw our own menu strip over the
    // title bar area; titleBarOverlay keeps the native ─ □ × controls on top.
    windowOptions.titleBarStyle = 'hidden';
    windowOptions.titleBarOverlay = {
      color: getTitleBarOverlayColor(useDarkChrome),
      symbolColor: getTitleBarOverlaySymbolColor(useDarkChrome),
      height: TITLEBAR_MENU_HEIGHT,
    };
  }

  const constructionStart = startupTime();
  mainWindow = new BrowserWindow(windowOptions);
  registerWindowFirstPaint(mainWindow);
  startupMark(`BrowserWindow constructor complete type=main id=${mainWindow.id}`, constructionStart);
  currentWindow = mainWindow;

  if (isWindows) {
    mainWindow.removeMenu();
  }

  loadWindowHtml(mainWindow, 'main');
  if (options.show !== false) showWindowAfterFirstPaint(mainWindow);

  mainWindow.on('close', (event) => {
    // Non-Mac: closing the window hides to tray instead of quitting — but only
    // when a tray actually exists. Without one the app would become invisible
    // (no window, no tray), only killable via Task Manager.
    if (!isMac && !(app as any).isQuitting && hasTray()) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });

  // Window fullscreen state → renderer (WindowsMenuBar hides the strip there)
  const notifyFullscreen = (isFullscreen: boolean): void => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send(IPC_CHANNELS.WINDOW_FULLSCREEN_CHANGED, isFullscreen);
  };
  mainWindow.on('enter-full-screen', () => notifyFullscreen(true));
  mainWindow.on('leave-full-screen', () => notifyFullscreen(false));

  mainWindow.on('closed', () => {
    const closedWindow = mainWindow;
    mainWindow = null;
    if (currentWindow === closedWindow) {
      currentWindow = null;
    }
  });

  setupAppMenu();
  
  return mainWindow;
}

// Create welcome/installer window
export function createWelcomeWindow(options: { show?: boolean } = {}): BrowserWindow {
  if (welcomeWindow && !welcomeWindow.isDestroyed()) {
    focusWindow(welcomeWindow);
    return welcomeWindow;
  }

  const constructionStart = startupTime();
  welcomeWindow = new BrowserWindow({
    width: 800,
    height: 900,
    show: false,
    webPreferences: {
      preload: getPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
    autoHideMenuBar: !isMac,
    ...(isMac ? getMacWindowSurfaceOptions() : { frame: true }),
    backgroundColor: getInitialWindowBackground(),
  });
  registerWindowFirstPaint(welcomeWindow);
  startupMark(`BrowserWindow constructor complete type=welcome id=${welcomeWindow.id}`, constructionStart);

  currentWindow = welcomeWindow;

  loadWindowHtml(welcomeWindow, 'welcome');
  if (options.show ?? true) showWindowAfterFirstPaint(welcomeWindow);

  welcomeWindow.on('closed', () => {
    if (currentWindow === welcomeWindow) {
      currentWindow = null;
    }
    welcomeWindow = null;
  });

  return welcomeWindow;
}

// Create diagnostics window
export function createDiagnosticsWindow(): BrowserWindow {
  const existing = childWindows.get('diagnostics' as WindowType);
  if (existing && !existing.isDestroyed()) {
    existing.focus();
    return existing;
  }

  const window = new BrowserWindow({
    width: 900,
    height: 700,
    show: false,
    webPreferences: {
      preload: getPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
    autoHideMenuBar: !isMac,
    ...(isMac ? getMacWindowSurfaceOptions() : { frame: true }),
    ...(!isMac ? { backgroundColor: getInitialWindowBackground() } : {}),
  });
  registerWindowFirstPaint(window);

  childWindows.set('diagnostics' as WindowType, window);

  loadWindowHtml(window, 'diagnostics' as WindowType);
  showWindowAfterFirstPaint(window);

  window.on('closed', () => {
    childWindows.delete('diagnostics' as WindowType);
  });

  return window;
}

// Create a generic child window
/** Aliases and explicit routes share the same host dispatch. */
function openApplicationDestination(type: WindowType, context?: Record<string, unknown>): BrowserWindow | null {
  const destination = resolveApplicationDestination(type, context);
  if (!destination) return null;
  const focusOnly = !context && ['main', 'study', 'my-learning', 'settings', 'flashcards'].includes(type);
  return openApplicationRoute(destination.path, destination.context, focusOnly);
}

function createApplicationHost(host: Exclude<ApplicationHost, 'main'>, path: string): BrowserWindow {
  const window = new BrowserWindow({
    width: host === 'settings' ? 1000 : 1100, height: 760,
    minWidth: 640, minHeight: 480,
    show: false,
    title: host === 'study' ? 'mLearn — Flashcards' : host === 'my-learning' ? 'mLearn — My Learning' : host === 'messenger' ? 'mLearn — Messenger' : 'mLearn — Settings',
    webPreferences: { preload: getPreloadPath(), contextIsolation: true, nodeIntegration: false, sandbox: true },
    autoHideMenuBar: !isMac,
    ...(isMac ? getMacWindowSurfaceOptions() : { frame: true }),
    backgroundColor: getInitialWindowBackground(),
  });
  registerWindowFirstPaint(window);
  childWindows.set(host, window);
  loadWindowHtml(window, 'main', host, path);
  // Suspend in place, including pending writes and exact navigation identity.
  // App shutdown still closes every renderer through the canonical shutdown protocol.
  window.on('close', event => {
    if (!(app as any).isQuitting) { event.preventDefault(); window.hide(); }
  });
  window.on('closed', () => { childWindows.delete(host); windowContextStore.delete(host); });
  return window;
}

function openApplicationRoute(path: string, context: Record<string, unknown> = {}, focusOnly = false): BrowserWindow {
  const host = applicationHostForPath(path);
  const existing = host === 'main' ? mainWindow : childWindows.get(host);
  const live = existing && !existing.isDestroyed();
  const window = live ? existing : host === 'main' ? createMainWindow() : createApplicationHost(host, path);
  if (!focusOnly || !live) {
    const navigation = { applicationNavigation: { path, requestId: crypto.randomUUID(), context } };
    if (!live || window.webContents.isLoadingMainFrame()) windowContextStore.set(host, navigation);
    else {
      windowContextStore.delete(host);
      window.webContents.send(IPC_CHANNELS.WINDOW_CONTEXT, navigation);
    }
  }
  currentWindow = window;
  showWindowAfterFirstPaint(window);
  return window;
}

export function createChildWindow(
  type: WindowType,
  options: Partial<Electron.BrowserWindowConstructorOptions> = {}
): BrowserWindow {
  const destination = openApplicationDestination(type);
  if (destination) return destination;
  // Check if window already exists and focus it instead of creating duplicate
  const existingWindow = childWindows.get(type);
  if (existingWindow && !existingWindow.isDestroyed()) {
    existingWindow.focus();
    return existingWindow;
  }

  // Ordinary macOS child windows get the hidden-titlebar, full-bleed
  // app-window surface (native traffic lights kept visible).
  // Callers that explicitly pass frame: false (transparent overlays such as the
  // launch overlay) keep plain frameless behavior without vibrancy.
  const platformOptions: Partial<Electron.BrowserWindowConstructorOptions> =
    isMac && options.frame !== false ? getMacWindowSurfaceOptions() : {};
  const firstPaintManaged = options.frame !== false;
  const shouldShow = options.show !== false;

  const defaultOptions: Electron.BrowserWindowConstructorOptions = {
    width: 800,
    height: 600,
    backgroundColor: getInitialWindowBackground(),
    webPreferences: {
      preload: getPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
    ...(isMac ? {} : { frame: true }),
    autoHideMenuBar: !isMac,
    ...platformOptions,
    ...options,
    ...(firstPaintManaged ? { show: false } : {}),
  };

  const window = new BrowserWindow(defaultOptions);
  childWindows.set(type, window);
  if (firstPaintManaged) registerWindowFirstPaint(window);

  loadWindowHtml(window, type);
  if (firstPaintManaged && shouldShow) showWindowAfterFirstPaint(window);

  window.on('closed', () => {
    childWindows.delete(type);
  });

  return window;
}

export function openManagedChildWindow(
  type: WindowType,
  options: Partial<Electron.BrowserWindowConstructorOptions> = {},
  context?: Record<string, unknown>,
): BrowserWindow {
  const destination = openApplicationDestination(type, context);
  if (destination) return destination;
  if (type === WINDOW_TYPES.WELCOME) {
    return createWelcomeWindow();
  }

  if (context) {
    // v1 limitation: windowContextStore is keyed only by windowType, so only one
    // plugin-host context can exist at a time.
    windowContextStore.set(type, context);
  }

  const existingWindow = childWindows.get(type);
  if (existingWindow && !existingWindow.isDestroyed()) {
    if (context) {
      existingWindow.webContents.send(IPC_CHANNELS.WINDOW_CONTEXT, context);
    }
    existingWindow.focus();
    return existingWindow;
  }

  return createChildWindow(type, options);
}

// PiP Mode handlers
function makeMainWindowPIP(width: number, height: number): void {
  if (!mainWindow) return;

  oldWindowState.width = mainWindow.getBounds().width;
  oldWindowState.height = mainWindow.getBounds().height;
  oldWindowState.fullscreen = mainWindow.isFullScreen();

  const bounds = { width, height, x: 50, y: 50 };
  
  if (isMac) {
    mainWindow.setBounds(bounds, true);
    mainWindow.setAlwaysOnTop(true, 'pop-up-menu');
    mainWindow.setWindowButtonVisibility(false);
    mainWindow.setFullScreenable(false);
  } else {
    mainWindow.setBounds(bounds);
    mainWindow.setAlwaysOnTop(true);
  }

  mainWindow.setResizable(true);
  mainWindow.setFocusable(false);
  mainWindow.setMinimizable(false);
  mainWindow.setFullScreen(false);
}

function makeMainWindowNormal(): void {
  if (!mainWindow) return;

  const bounds = {
    width: oldWindowState.width || 1200,
    height: oldWindowState.height || 700,
  };

  if (isMac) {
    mainWindow.setBounds(bounds, true);
    mainWindow.setWindowButtonVisibility(oldWindowState.trafficLights);
    mainWindow.setFullScreenable(true);
  } else {
    mainWindow.setBounds(bounds);
  }

  mainWindow.setAlwaysOnTop(false);
  mainWindow.setResizable(true);
  mainWindow.setFocusable(true);
  mainWindow.setMinimizable(true);
  mainWindow.setFullScreen(oldWindowState.fullscreen);
}

// Context menu for video
function showVideoContextMenu(
  sender: Electron.WebContents,
  options?: { isWatchTogether?: boolean; hasContextPhrase?: boolean; canExplainPhrase?: boolean },
): void {
  const isWT = options?.isWatchTogether ?? false;
  const hasContextPhrase = options?.hasContextPhrase ?? false;
  const canExplainPhrase = options?.canExplainPhrase ?? false;
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: getLocalizedString('mlearn.Menu.SyncSubtitles'),
      click: () => sender.send(IPC_CHANNELS.CTX_MENU_COMMAND, 'sync-subs'),
    },
    {
      label: getLocalizedString('mlearn.Menu.OpenLiveWordTranslator'),
      click: () => mainWindow?.webContents.send(IPC_CHANNELS.SHOW_ASIDE),
    },
    { type: 'separator' },
    {
      label: getLocalizedString('mlearn.Menu.CopySubtitle'),
      enabled: hasContextPhrase,
      click: () => sender.send(IPC_CHANNELS.CTX_MENU_COMMAND, 'copy-sub'),
    },
    {
      label: getLocalizedString('mlearn.Menu.Explain'),
      enabled: canExplainPhrase,
      click: () => sender.send(IPC_CHANNELS.CTX_MENU_COMMAND, 'explain-phrase'),
    },
    { type: 'separator' },
    {
      label: isWT ? getLocalizedString('mlearn.Menu.StopWatchTogether') : getLocalizedString('mlearn.Menu.WatchTogether'),
      click: () => sender.send(IPC_CHANNELS.CTX_MENU_COMMAND, 'watch-together'),
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  menu.popup({ window: BrowserWindow.fromWebContents(sender) || undefined });
}

// Context menu for reader (OCR overlay)
interface ReaderContextMenuOptions {
  readingAnnotationHiderEnabled: boolean;
  hasContextPhrase: boolean;
  canToggleReadingHider?: boolean;
  canExplainPhrase?: boolean;
  collatePagesEnabled?: boolean;
  isDoublePageMode?: boolean;
}

function showReaderContextMenu(sender: Electron.WebContents, options: ReaderContextMenuOptions): void {
  const template: Electron.MenuItemConstructorOptions[] = [];

  if (options.canToggleReadingHider !== false) {
    template.push({
      label: options.readingAnnotationHiderEnabled ? getLocalizedString('mlearn.Menu.ShowReading') : getLocalizedString('mlearn.Menu.HideReading'),
      click: () => sender.send(IPC_CHANNELS.READER_CTX_MENU_COMMAND, 'toggle-reading-annotation-hider'),
    });
    template.push({ type: 'separator' });
  }

  template.push(
    {
      label: getLocalizedString('mlearn.Menu.CopyPhrase'),
      enabled: options.hasContextPhrase,
      click: () => sender.send(IPC_CHANNELS.READER_CTX_MENU_COMMAND, 'copy-phrase'),
    },
    {
      label: getLocalizedString('mlearn.Menu.Explain'),
      enabled: options.canExplainPhrase ?? false,
      click: () => sender.send(IPC_CHANNELS.READER_CTX_MENU_COMMAND, 'explain-phrase'),
    },
    { type: 'separator' },
    {
      label: options.collatePagesEnabled ? getLocalizedString('mlearn.Menu.UncollatePages') : getLocalizedString('mlearn.Menu.CollatePages'),
      enabled: options.isDoublePageMode ?? false,
      click: () => sender.send(IPC_CHANNELS.READER_CTX_MENU_COMMAND, 'toggle-collate-pages'),
    },
  );

  const menu = Menu.buildFromTemplate(template);
  menu.popup({ window: BrowserWindow.fromWebContents(sender) || undefined });
}

function getLocalizedString(path: string): string {
  const { strings } = getCurrentLocaleData();
  const keys = path.split('.');
  let current: unknown = strings;

  for (const key of keys) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return path;
    }
    current = (current as Record<string, unknown>)[key];
  }

  return typeof current === 'string' ? current : path;
}

export function launchOverlayWindow(): void {
  const existing = childWindows.get('overlay');
  if (existing && !existing.isDestroyed()) {
    existing.focus();
    return;
  }
  const win = createChildWindow('overlay' as WindowType, {
    width: 400,
    height: 200,
    transparent: true,
    backgroundColor: undefined,
    alwaysOnTop: true,
    frame: false,
    skipTaskbar: true,
    resizable: true,
  });

  if (isMac) {
    win.setAlwaysOnTop(true, 'screen-saver');
  } else {
    win.setAlwaysOnTop(true);
  }

  overlayWindow = win;
  win.on('closed', () => {
    overlayWindow = null;
  });
}

function getTitleBarOverlayColor(dark: boolean): string {
  return dark ? '#1f1f1f' : '#f5f5f5';
}

function getTitleBarOverlaySymbolColor(dark: boolean): string {
  return dark ? '#ffffff' : '#000000';
}

// Shared macOS surface for ordinary application windows: no native titlebar,
// full-bleed renderer with real traffic lights punched into the web UI, and
// native vibrancy visible underneath transparent renderer regions.
function getMacWindowSurfaceOptions(): Partial<Electron.BrowserWindowConstructorOptions> {
  return {
    // Hides the native titlebar for a full-bleed renderer while KEEPING the
    // native traffic lights visible (frame:false strips the buttons).
    titleBarStyle: 'hidden',

    // Makes Window Controls Overlay geometry available to the renderer.
    titleBarOverlay: true,

    // Put the real AppKit traffic lights exactly where our design expects them.
    trafficLightPosition: {
      x: 10,
      y: 10,
    },

    // Native material underneath our web scene.
    transparent: true,
    vibrancy: 'under-window',
    visualEffectState: 'followWindow',
  };
}

// Setup application menu
function setupAppMenu(): void {
  const settings = loadSettings();
  const appMenu: Electron.MenuItemConstructorOptions[] = [
    {
      label: getLocalizedString('mlearn.Menu.About'),
      click: () => openSettingsWindow('about'),
    },
    { type: 'separator' },
    {
      label: getLocalizedString('mlearn.Menu.Settings'),
      click: () => openSettingsWindow('general'),
    },
    { type: 'separator' },
    { role: 'hide' },
    { type: 'separator' },
    { role: 'hideOthers' },
    { role: 'unhide' },
    { type: 'separator' },
    { role: 'quit' },
  ];

  const flashcardsItems: Electron.MenuItemConstructorOptions[] = [
    {
      label: getLocalizedString('mlearn.Menu.ReviewFlashcards'),
      click: () => createChildWindow('flashcards' as WindowType, { width: 800, height: 600 }),
    },
    {
      label: getLocalizedString('mlearn.Menu.ForceRecreateFlashcards'),
      click: async () => {
        if (!mainWindow) return;
        const { response } = await dialog.showMessageBox(mainWindow, {
          type: 'question',
          title: getLocalizedString('mlearn.Menu.RecreateFlashcards.Title'),
          message: getLocalizedString('mlearn.Menu.RecreateFlashcards.Message'),
          buttons: [
            getLocalizedString('mlearn.Menu.RecreateFlashcards.Cancel'),
            getLocalizedString('mlearn.Menu.RecreateFlashcards.Create'),
          ],
          defaultId: 1,
          cancelId: 0,
        });
        if (response === 0) return;

        mainWindow.webContents.send(IPC_CHANNELS.FORCE_NEWDAY_FLASHCARDS);
      },
    },
    {
      label: getLocalizedString('mlearn.Menu.OpenSyncingWindow'),
      click: () => createChildWindow('connect-qr' as WindowType, { width: 600, height: 700 }),
    },
  ];

  const statisticsItems: Electron.MenuItemConstructorOptions[] = [
    {
      label: getLocalizedString('mlearn.Menu.ShowLearningStatistics'),
      click: () => createChildWindow('statistics' as WindowType, { width: 800, height: 600 }),
    },
    {
      label: getLocalizedString('mlearn.Menu.LevelStudy'),
      click: () => createChildWindow('level-study' as WindowType, { width: 1200, height: 800 }),
    },
    {
      label: getLocalizedString('mlearn.Menu.EditWordKnowledgeDatabase'),
      click: () => createChildWindow('word-db-editor' as WindowType, { width: 1300, height: 800 }),
    },
  ];

  const videoItems: Electron.MenuItemConstructorOptions[] = [
    {
      label: getLocalizedString('mlearn.Menu.SyncSubtitles'),
      click: () => mainWindow?.webContents.send(IPC_CHANNELS.CTX_MENU_COMMAND, 'sync-subs'),
    },
    {
      label: getLocalizedString('mlearn.Menu.CopySubtitle'),
      click: () => mainWindow?.webContents.send(IPC_CHANNELS.CTX_MENU_COMMAND, 'copy-sub'),
    },
    { type: 'separator' },
    {
      label: getLocalizedString('mlearn.Menu.WatchTogether'),
      click: () => mainWindow?.webContents.send(IPC_CHANNELS.CTX_MENU_COMMAND, 'watch-together'),
    },
  ];

  const browserExtensionItems: Electron.MenuItemConstructorOptions[] = [
    {
      label: getLocalizedString('mlearn.Menu.BrowserExtension.InstallExtension'),
      click: () => openSettingsWindow('browser-extension'),
    },
    {
      label: getLocalizedString('mlearn.Menu.BrowserExtension.OpenOverlayWindow'),
      click: () => launchOverlayWindow(),
    },
  ];

  const template: Electron.MenuItemConstructorOptions[] = [
    // App menu (macOS)
    ...(isMac ? [{
      label: app.name,
      submenu: appMenu,
    }] : []),
    
    // File menu
    {
      id: 'mlearn-menu-file',
      label: getLocalizedString('mlearn.Menu.File'),
      submenu: [
        isMac ? { role: 'close' as const } : { role: 'quit' as const },
        ...(!isMac ? appMenu : []),
      ],
    },
    
    // Edit menu
    {
      id: 'mlearn-menu-edit',
      label: getLocalizedString('mlearn.Menu.Edit'),
      submenu: [
        {
          label: getLocalizedString('mlearn.Menu.Settings'),
          click: () => openSettingsWindow('general'),
        },
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        ...(isMac ? [
          { role: 'pasteAndMatchStyle' as const },
          { role: 'delete' as const },
          { role: 'selectAll' as const },
        ] : [
          { role: 'delete' as const },
          { type: 'separator' as const },
          { role: 'selectAll' as const },
        ]),
      ],
    },
    
    // View menu
    {
      id: 'mlearn-menu-view',
      label: getLocalizedString('mlearn.Menu.View'),
      submenu: [
        {
          label: getLocalizedString('mlearn.Menu.OpenLiveWordTranslator'),
          click: () => mainWindow?.webContents.send(IPC_CHANNELS.SHOW_ASIDE),
        },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        ...((settings.devMode || !isPackaged) ? [
          { label: getLocalizedString('mlearn.Menu.OpenDevTools'), role: 'toggleDevTools' as const },
        ] : []),
      ],
    },

    // The same purpose-led destinations are available on every desktop platform.
    {
      id: 'mlearn-menu-go',
      label: getLocalizedString('mlearn.Menu.Go'),
      submenu: [
        ...[
          ['/', 'mlearn.Tabs.Home'], ['/reader', 'mlearn.Home.Today.Read'],
          ['/video', 'mlearn.Home.Today.Watch'], ['/messenger', 'mlearn.Product.Messenger'],
          ['/practise', 'mlearn.Product.Practise'], ['/evaluate', 'mlearn.Product.Evaluate'],
          ['/plan', 'mlearn.Product.Plan'], ['/knowledge', 'mlearn.Product.Knowledge'],
          ['/progress', 'mlearn.Product.Progress'],
        ].map(([path, key]) => ({ label: getLocalizedString(key), click: () => openApplicationRoute(path) })),
      ],
    },
    {
      id: 'mlearn-menu-tools',
      label: getLocalizedString('mlearn.Menu.Tools'),
      submenu: [
        ...videoItems,
        { type: 'separator' },
        ...flashcardsItems.slice(1),
        ...statisticsItems.slice(2),
        ...browserExtensionItems,
      ],
    },

    // Window menu (macOS)
    ...(isMac ? [{
      label: getLocalizedString('mlearn.Menu.Window'),
      submenu: [
        { role: 'minimize' as const },
        { role: 'zoom' as const },
        { type: 'separator' as const },
        { role: 'front' as const },
        { type: 'separator' as const },
        { role: 'window' as const },
      ],
    }] : []),
    
    // Help menu
    {
      id: 'mlearn-menu-help',
      label: getLocalizedString('mlearn.Menu.Help'),
      submenu: [
        {
          label: getLocalizedString('mlearn.Menu.About'),
          click: () => openSettingsWindow('about'),
        },
        {
          label: getLocalizedString('mlearn.Menu.RunDiagnostics'),
          click: () => createDiagnosticsWindow(),
        },
        { type: 'separator' },
        {
          label: getLocalizedString('mlearn.Menu.ReportBug'),
          click: () => { void shell.openExternal('https://github.com/adrianvla/mLearn/issues/new'); },
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

// Setup IPC handlers for window management
export function setupWindowIPC(): void {
  // Traffic lights (macOS)
  ipcMain.on(IPC_CHANNELS.TRAFFIC_LIGHTS, (_event, arg: { visibility: boolean }) => {
    if (isLinux || !mainWindow) return;
    if (isMac) {
      mainWindow.setWindowButtonVisibility(arg.visibility);
    }
    oldWindowState.trafficLights = arg.visibility;
  });

  // Windows title-bar menu strip (popup at cursor). x/y passed to popup() are
  // window-relative, so omitting them (cursor default) is what positions the
  // menu under the clicked label.
  ipcMain.on(IPC_CHANNELS.POPUP_APP_MENU, (event, menuId: string) => {
    const menu = Menu.getApplicationMenu();
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!menu || !window || window.isDestroyed()) return;
    const item = menu.getMenuItemById(menuId);
    const submenu = item?.submenu;
    if (!submenu) return;
    submenu.popup({ window });
  });

  // Windows title-bar overlay color sync (renderer theme colors)
  ipcMain.on(
    IPC_CHANNELS.SET_TITLEBAR_OVERLAY,
    (event, options: { color: string; symbolColor: string }) => {
      const window = BrowserWindow.fromWebContents(event.sender);
      if (!isWindows || !window || window.isDestroyed() || window !== mainWindow) return;
      window.setTitleBarOverlay({
        color: options.color,
        symbolColor: options.symbolColor,
        height: TITLEBAR_MENU_HEIGHT,
      });
    }
  );

  // Window resize
  ipcMain.on(IPC_CHANNELS.CHANGE_WINDOW_SIZE, (event, arg: WindowSize) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    window?.setSize(arg.width, arg.height, true);
  });

  // PiP mode
  ipcMain.on(IPC_CHANNELS.MAKE_PIP, (_event, arg: WindowSize) => {
    makeMainWindowPIP(arg.width, arg.height);
  });

  ipcMain.on(IPC_CHANNELS.MAKE_NORMAL, () => {
    makeMainWindowNormal();
  });

  // Context menu
  ipcMain.on(IPC_CHANNELS.SHOW_CTX_MENU, (event, options?: { isWatchTogether?: boolean }) => {
    showVideoContextMenu(event.sender, options);
  });

  // Reader context menu (OCR overlay)
  ipcMain.on(IPC_CHANNELS.SHOW_READER_CTX_MENU, (event, options: ReaderContextMenuOptions) => {
    showReaderContextMenu(event.sender, options);
  });

  // Open child window from renderer
  ipcMain.on(IPC_CHANNELS.OPEN_WINDOW, (_event, payload: OpenWindowPayload) => {
    openManagedChildWindow(payload.type, payload.options, payload.context);
  });

  // Child window requests its context
  ipcMain.on(IPC_CHANNELS.GET_WINDOW_CONTEXT, (event, windowType: string) => {
    const ctx = windowContextStore.get(windowType) || null;
    event.reply(IPC_CHANNELS.WINDOW_CONTEXT, ctx);
    if (['main', 'study', 'my-learning', 'settings'].includes(windowType) || resolveApplicationDestination(windowType)) {
      windowContextStore.delete(windowType);
    }
  });

  // Close current window
  ipcMain.on(IPC_CHANNELS.CLOSE_WINDOW, (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    window?.close();
  });

  ipcMain.on(IPC_CHANNELS.MINIMIZE_WINDOW, (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    window?.minimize();
  });

  ipcMain.on(IPC_CHANNELS.MAXIMIZE_WINDOW, (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (window) {
      if (window.isMaximized()) {
        window.unmaximize();
      } else {
        window.maximize();
      }
    }
  });

  ipcMain.on(IPC_CHANNELS.RESTORE_WINDOW, (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (window?.isMinimized()) {
      window.restore();
    }
  });

  // Version
  ipcMain.on(IPC_CHANNELS.GET_VERSION, (event) => {
    event.reply(IPC_CHANNELS.VERSION, app.getVersion());
  });

  ipcMain.on(IPC_CHANNELS.GET_LEGAL_DOCUMENT, (event, name: string) => {
    try {
      const candidates = [
        path.join(process.resourcesPath, `${name}.md`),      // extraResources in packaged mode
        path.join(app.getAppPath(), `${name}.md`),            // asar root or dev project root
        path.join(__dirname, '..', '..', '..', `${name}.md`), // fallback (project root in dev, asar root in packaged)
      ];
      const filePath = candidates.find((p) => fs.existsSync(p));
      if (filePath) {
        const content = fs.readFileSync(filePath, 'utf-8');
        event.reply(IPC_CHANNELS.LEGAL_DOCUMENT, content);
      } else {
        event.reply(IPC_CHANNELS.LEGAL_DOCUMENT, '');
      }
    } catch {
      event.reply(IPC_CHANNELS.LEGAL_DOCUMENT, '');
    }
  });

  // Flashcard syncing window
  ipcMain.on(IPC_CHANNELS.FLASHCARD_CONNECT_OPEN, () => {
    createChildWindow('connect-qr' as WindowType, { width: 600, height: 700 });
  });

  ipcMain.on(IPC_CHANNELS.OVERLAY_LAUNCH, () => {
    launchOverlayWindow();
  });

  // Forward overlay video state to overlay window
  ipcMain.on(IPC_CHANNELS.OVERLAY_VIDEO_STATE, (_event, state: unknown) => {
    const target = overlayWindow;
    if (target && !target.isDestroyed()) {
      target.webContents.send(IPC_CHANNELS.OVERLAY_VIDEO_STATE, state);
    }
  });

  // Forward overlay video screenshot to overlay window
  ipcMain.on(IPC_CHANNELS.OVERLAY_VIDEO_SCREENSHOT, (_event, screenshot: OverlayVideoScreenshot) => {
    const target = overlayWindow;
    if (target && !target.isDestroyed()) {
      target.webContents.send(IPC_CHANNELS.OVERLAY_VIDEO_SCREENSHOT, screenshot);
    }
  });

  ipcMain.on(IPC_CHANNELS.OVERLAY_SUBTITLE_TRACKS, (_event, tracks: unknown) => {
    const target = overlayWindow;
    if (target && !target.isDestroyed()) {
      target.webContents.send(IPC_CHANNELS.OVERLAY_SUBTITLE_TRACKS, tracks);
    }
  });

  // Forward overlay sync request to main window
  ipcMain.on(IPC_CHANNELS.OVERLAY_REQUEST_SYNC, () => {
    const target = mainWindow;
    if (target && !target.isDestroyed()) {
      target.webContents.send(IPC_CHANNELS.OVERLAY_REQUEST_SYNC);
    }
  });

  // Set overlay ignore mouse events (click-through)
  ipcMain.on(IPC_CHANNELS.OVERLAY_SET_IGNORE_MOUSE_EVENTS, (_event, ignore: boolean) => {
    setOverlayIgnoreMouseEvents(ignore);
  });

  // Queue overlay commands to be forwarded to the browser extension
  ipcMain.on(IPC_CHANNELS.OVERLAY_COMMAND, (_event, cmd: { command: 'play' | 'pause' | 'seek' | 'setRate' | 'setVolume'; time?: number; rate?: number; volume?: number }) => {
    queueCommand(cmd);
  });

  // Move overlay window by delta (manual drag)
  ipcMain.handle(IPC_CHANNELS.OVERLAY_MOVE_BY, (_event, delta: { x: number; y: number }) => {
    moveOverlayBy(delta.x, delta.y);
  });

  // Resize overlay window by delta (manual resize)
  ipcMain.handle(IPC_CHANNELS.OVERLAY_RESIZE_BY, (_event, delta: { width: number; height: number }) => {
    resizeOverlayBy(delta.width, delta.height);
  });

  // Get overlay window bounds
  ipcMain.handle(IPC_CHANNELS.OVERLAY_GET_BOUNDS, () => {
    return getOverlayBounds();
  });

  // Set overlay auto-position enabled
  ipcMain.handle(IPC_CHANNELS.OVERLAY_SET_AUTO_POSITION, (_event, enabled: boolean) => {
    setOverlayAutoPositionEnabled(enabled);
  });

  ipcMain.on(IPC_CHANNELS.OVERLAY_SET_GEOMETRY_LOCKED, (_event, locked: boolean) => {
    geometryUpdateLocked = locked;
  });

  // Forward text mode word lookup to overlay window (from extension/web server)
  ipcMain.on(IPC_CHANNELS.OVERLAY_TEXT_MODE_LOOKUP, (_event, payload: { word: string; x: number; y: number; contextText?: string; offset?: number }) => {
    const target = overlayWindow;
    if (target && !target.isDestroyed()) {
      target.webContents.send(IPC_CHANNELS.OVERLAY_TEXT_MODE_LOOKUP, payload);
    }
  });

  ipcMain.on(IPC_CHANNELS.OVERLAY_CLOSE_HOVER, () => {
    const target = overlayWindow;
    if (target && !target.isDestroyed()) {
      target.webContents.send(IPC_CHANNELS.OVERLAY_CLOSE_HOVER);
    }
  });
}
