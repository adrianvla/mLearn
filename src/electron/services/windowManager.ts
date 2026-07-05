/**
 * Window Manager Service
 * Handles creation and management of all application windows
 */

import { BrowserWindow, app, ipcMain, Menu, dialog, screen } from 'electron';
import path from 'path';
import fs from 'fs';
import { IPC_CHANNELS, WINDOW_TYPES, WindowType } from '../../shared/constants';
import type { WindowSize, OpenWindowPayload, OverlayVideoScreenshot } from '../../shared/types';
import { isMac, isLinux, isPackaged, getAppPath } from '../utils/platform';
import { loadSettings } from './settings';
import { getCurrentLocaleData } from './localization';
import { queueCommand } from './webServer';

// Window references
let mainWindow: BrowserWindow | null = null;
let welcomeWindow: BrowserWindow | null = null;
let overlayWindow: BrowserWindow | null = null;
let currentWindow: BrowserWindow | null = null;
const childWindows: Map<string, BrowserWindow> = new Map();

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

  if (isPackaged) {
    const appPath = getAppPath();
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
  const settingsWindow = createChildWindow('settings' as WindowType, { width: 800, height: 600 });

  if (section) {
    if (settingsWindow.webContents.isLoading()) {
      settingsWindow.webContents.once('did-finish-load', () => {
        settingsWindow.webContents.send(IPC_CHANNELS.SHOW_SETTINGS, section);
      });
    } else {
      settingsWindow.webContents.send(IPC_CHANNELS.SHOW_SETTINGS, section);
    }
  }

  return settingsWindow;
}

// Create the main window
export function createMainWindow(): BrowserWindow {
  if (mainWindow && !mainWindow.isDestroyed()) {
    focusWindow(mainWindow);
    return mainWindow;
  }

  if (welcomeWindow && !welcomeWindow.isDestroyed()) {
    const closingWelcomeWindow = welcomeWindow;
    welcomeWindow = null;
    if (currentWindow === closingWelcomeWindow) {
      currentWindow = null;
    }
    closingWelcomeWindow.close();
  }

  const windowOptions: Electron.BrowserWindowConstructorOptions = {
    width: 1200,
    height: 700,
    webPreferences: {
      preload: getPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
    frame: isMac ? false : true,
    backgroundColor: '#000000',
  };

  if (isMac) {
    windowOptions.titleBarStyle = 'hidden';
  }

  mainWindow = new BrowserWindow(windowOptions);
  currentWindow = mainWindow;

  const isDev = process.env.NODE_ENV === 'development';
  if (isDev) {
    mainWindow.loadURL('http://localhost:3000/src/html/main.html');
  } else {
    mainWindow.loadFile(getWindowHtmlPath('main'));
  }

  mainWindow.on('close', (event) => {
    if (!isMac && !(app as any).isQuitting) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });

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
export function createWelcomeWindow(): BrowserWindow {
  if (welcomeWindow && !welcomeWindow.isDestroyed()) {
    focusWindow(welcomeWindow);
    return welcomeWindow;
  }

  welcomeWindow = new BrowserWindow({
    width: 800,
    height: 900,
    webPreferences: {
      preload: getPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
    frame: isMac ? false : true,
    backgroundColor: '#000000',
  });

  currentWindow = welcomeWindow;

  const isDev = process.env.NODE_ENV === 'development';
  if (isDev) {
    welcomeWindow.loadURL('http://localhost:3000/src/html/welcome.html');
  } else {
    welcomeWindow.loadFile(getWindowHtmlPath('welcome'));
  }

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
    webPreferences: {
      preload: getPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
    frame: isMac ? false : true,
    backgroundColor: '#000000',
    ...(isMac ? { titleBarStyle: 'hidden' } : {}),
  });

  childWindows.set('diagnostics' as WindowType, window);

  const isDev = process.env.NODE_ENV === 'development';
  if (isDev) {
    window.loadURL('http://localhost:3000/src/html/diagnostics.html');
  } else {
    window.loadFile(getWindowHtmlPath('diagnostics'));
  }

  window.on('closed', () => {
    childWindows.delete('diagnostics' as WindowType);
  });

  return window;
}

// Create a generic child window
export function createChildWindow(
  type: WindowType,
  options: Partial<Electron.BrowserWindowConstructorOptions> = {}
): BrowserWindow {
  // Check if window already exists and focus it instead of creating duplicate
  const existingWindow = childWindows.get(type);
  if (existingWindow && !existingWindow.isDestroyed()) {
    existingWindow.focus();
    return existingWindow;
  }

  const platformOptions: Partial<Electron.BrowserWindowConstructorOptions> = isMac && options.frame !== false
    ? { titleBarStyle: 'hidden' }
    : {};

  const defaultOptions: Electron.BrowserWindowConstructorOptions = {
    width: 800,
    height: 600,
    webPreferences: {
      preload: getPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
    frame: isMac ? false : true,
    backgroundColor: '#000000',
    ...platformOptions,
    ...options,
  };

  const window = new BrowserWindow(defaultOptions);
  childWindows.set(type, window);

  const isDev = process.env.NODE_ENV === 'development';
  if (isDev) {
    window.loadURL(`http://localhost:3000/src/html/${type}.html`);
  } else {
    window.loadFile(getWindowHtmlPath(type));
  }

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

  const template: Electron.MenuItemConstructorOptions[] = [
    // App menu (macOS)
    ...(isMac ? [{
      label: app.name,
      submenu: appMenu,
    }] : []),
    
    // File menu
    {
      label: getLocalizedString('mlearn.Menu.File'),
      submenu: [
        isMac ? { role: 'close' as const } : { role: 'quit' as const },
        ...(!isMac ? appMenu : []),
      ],
    },
    
    // Edit menu
    {
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
    
    // Window menu
    {
      label: getLocalizedString('mlearn.Menu.Window'),
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(isMac ? [
          { type: 'separator' as const },
          { role: 'front' as const },
          { type: 'separator' as const },
          { role: 'window' as const },
        ] : [
          { role: 'close' as const },
        ]),
      ],
    },
    
    // Video menu
    {
      label: getLocalizedString('mlearn.Menu.Video'),
      submenu: [
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
      ],
    },

    // Flashcards menu
    {
      label: getLocalizedString('mlearn.Menu.Flashcards'),
      submenu: [
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
      ],
    },
    
    {
      label: getLocalizedString('mlearn.Menu.BrowserExtension.Title'),
      submenu: [
        {
          label: getLocalizedString('mlearn.Menu.BrowserExtension.InstallExtension'),
          click: () => openSettingsWindow('browser-extension'),
        },
        {
          label: getLocalizedString('mlearn.Menu.BrowserExtension.OpenOverlayWindow'),
          click: () => launchOverlayWindow(),
        },
      ],
    },

    // Statistics menu
    {
      label: getLocalizedString('mlearn.Menu.Statistics'),
      submenu: [
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
      ],
    },
    
    // Help menu
    {
      label: getLocalizedString('mlearn.Menu.Help'),
      submenu: [
        {
          label: getLocalizedString('mlearn.Menu.About'),
          click: () => openSettingsWindow('about'),
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

  // Window resize
  ipcMain.on(IPC_CHANNELS.CHANGE_WINDOW_SIZE, (_event, arg: WindowSize) => {
    mainWindow?.setSize(arg.width, arg.height, true);
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
