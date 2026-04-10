/**
 * Window Manager Service
 * Handles creation and management of all application windows
 */

import { BrowserWindow, app, ipcMain, Menu, dialog, shell, clipboard } from 'electron';
import path from 'path';
import fs from 'fs';
import { IPC_CHANNELS, WindowType, PROXY_SERVER_PORT } from '../../shared/constants';
import type { WindowSize, OpenWindowPayload } from '../../shared/types';
import { isMac, isLinux, isPackaged, getAppPath } from '../utils/platform';
import { loadSettings } from './settings';

// Window references
let mainWindow: BrowserWindow | null = null;
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
      path.join(__dirname, 'preload.js'),
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
  const windowOptions: Electron.BrowserWindowConstructorOptions = {
    width: 1200,
    height: 700,
    webPreferences: {
      preload: getPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
    frame: false,
    backgroundColor: '#000000',
  };

  // macOS-specific title bar
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

  mainWindow.on('closed', () => {
    mainWindow = null;
    currentWindow = null;
  });

  setupAppMenu();
  
  return mainWindow;
}

// Create welcome/installer window
export function createWelcomeWindow(): BrowserWindow {
  const welcomeWindow = new BrowserWindow({
    width: 800,
    height: 900,
    webPreferences: {
      preload: getPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
    frame: false,
    backgroundColor: '#000000',
  });

  currentWindow = welcomeWindow;

  const isDev = process.env.NODE_ENV === 'development';
  if (isDev) {
    welcomeWindow.loadURL('http://localhost:3000/src/html/welcome.html');
  } else {
    welcomeWindow.loadFile(getWindowHtmlPath('welcome'));
  }

  return welcomeWindow;
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

  const platformOptions: Partial<Electron.BrowserWindowConstructorOptions> = isMac
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
    frame: false,
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
function showVideoContextMenu(sender: Electron.WebContents, options?: { isWatchTogether?: boolean }): void {
  const isWT = options?.isWatchTogether ?? false;
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'Sync Subtitles with Video',
      click: () => sender.send(IPC_CHANNELS.CTX_MENU_COMMAND, 'sync-subs'),
    },
    {
      label: 'Open Live Word Translator',
      click: () => mainWindow?.webContents.send(IPC_CHANNELS.SHOW_ASIDE),
    },
    { type: 'separator' },
    {
      label: 'Copy Subtitle',
      click: () => sender.send(IPC_CHANNELS.CTX_MENU_COMMAND, 'copy-sub'),
    },
    { type: 'separator' },
    {
      label: isWT ? 'Stop Watch Together' : 'Watch Together',
      click: () => sender.send(IPC_CHANNELS.CTX_MENU_COMMAND, 'watch-together'),
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  menu.popup({ window: BrowserWindow.fromWebContents(sender) || undefined });
}

// Context menu for reader (OCR overlay)
interface ReaderContextMenuOptions {
  furiganaHiderEnabled: boolean;
  hasContextPhrase: boolean;
}

function showReaderContextMenu(sender: Electron.WebContents, options: ReaderContextMenuOptions): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: options.furiganaHiderEnabled ? 'Show Reading' : 'Hide Reading',
      click: () => sender.send(IPC_CHANNELS.READER_CTX_MENU_COMMAND, 'toggle-furigana'),
    },
    { type: 'separator' },
    {
      label: 'Copy Phrase',
      enabled: options.hasContextPhrase,
      click: () => sender.send(IPC_CHANNELS.READER_CTX_MENU_COMMAND, 'copy-phrase'),
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  menu.popup({ window: BrowserWindow.fromWebContents(sender) || undefined });
}

// Setup application menu
function setupAppMenu(): void {
  const settings = loadSettings();
  const appPath = getAppPath();
  
  const appMenu: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'About mLearn',
      click: () => openSettingsWindow('about'),
    },
    { type: 'separator' },
    {
      label: 'Settings',
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
      label: 'File',
      submenu: [
        isMac ? { role: 'close' as const } : { role: 'quit' as const },
        ...(!isMac ? appMenu : []),
      ],
    },
    
    // Edit menu
    {
      label: 'Edit',
      submenu: [
        {
          label: 'Settings',
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
      label: 'View',
      submenu: [
        {
          label: 'Open Live Word Translator',
          click: () => mainWindow?.webContents.send(IPC_CHANNELS.SHOW_ASIDE),
        },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        ...((settings.devMode || !isPackaged) ? [
          { label: 'Open DevTools', role: 'toggleDevTools' as const },
        ] : []),
      ],
    },
    
    // Window menu
    {
      label: 'Window',
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
      label: 'Video',
      submenu: [
        {
          label: 'Sync Subtitles with Video',
          click: () => mainWindow?.webContents.send(IPC_CHANNELS.CTX_MENU_COMMAND, 'sync-subs'),
        },
        {
          label: 'Copy Subtitle',
          click: () => mainWindow?.webContents.send(IPC_CHANNELS.CTX_MENU_COMMAND, 'copy-sub'),
        },
        { type: 'separator' },
        {
          label: 'Watch Together',
          click: () => mainWindow?.webContents.send(IPC_CHANNELS.CTX_MENU_COMMAND, 'watch-together'),
        },
      ],
    },
    
    // Connect menu
    {
      label: 'Connect',
      submenu: [
        {
          label: 'Copy Page Injector Script',
          click: () => {
            try {
              // Try multiple candidate paths for the injector script
              const candidatePaths = [
                path.join(appPath, 'scripts', 'injector.js'),
                path.join(__dirname, '..', '..', '..', 'scripts', 'injector.js'),
                path.join(__dirname, '..', '..', 'scripts', 'injector.js'),
              ];
              
              let scriptPath: string | null = null;
              for (const p of candidatePaths) {
                if (fs.existsSync(p)) {
                  scriptPath = p;
                  break;
                }
              }
              
              if (!scriptPath) {
                throw new Error('Injector script not found');
              }
              
              let text = fs.readFileSync(scriptPath, 'utf-8');
              text = text.replace(/ISMLEARNTETHERED_TO_REPLACE/g, 'true');
              clipboard.writeText(text);
              dialog.showMessageBox({
                type: 'info',
                title: 'Copied!',
                message: 'Copied! See Help menu for usage instructions.',
              });
            } catch (e) {
              console.error('Failed to copy injector script:', e);
            }
          },
        },
        {
          label: 'Install UserScript',
          click: () => {
            shell.openExternal(`http://127.0.0.1:${PROXY_SERVER_PORT}/mLearn.user.js`);
          },
        },
      ],
    },
    
    // Flashcards menu
    {
      label: 'Flashcards',
      submenu: [
        {
          label: 'Review Flashcards',
          click: () => createChildWindow('flashcards' as WindowType, { width: 800, height: 600 }),
        },
        {
          label: 'Force recreate new flashcards for today',
          click: async () => {
            if (!mainWindow) return;
            const { response } = await dialog.showMessageBox(mainWindow, {
              type: 'question',
              title: 'Recreate Flashcards',
              message: 'This will create new flashcards from your tracked word candidates. Continue?',
              buttons: ['Cancel', 'Create'],
              defaultId: 1,
              cancelId: 0,
            });
            if (response === 0) return;

            mainWindow.webContents.send(IPC_CHANNELS.FORCE_NEWDAY_FLASHCARDS);
          },
        },
        {
          label: 'Open Syncing Window',
          click: () => createChildWindow('connect-qr' as WindowType, { width: 600, height: 700 }),
        },
      ],
    },
    
    // Statistics menu
    {
      label: 'Statistics',
      submenu: [
        {
          label: 'Show learning statistics',
          click: () => createChildWindow('statistics' as WindowType, { width: 800, height: 600 }),
        },
        {
          label: 'Show Kanji grid',
          click: () => createChildWindow('kanji-grid' as WindowType, { width: 1200, height: 800 }),
        },
        {
          label: 'Edit word knowledge database',
          click: () => createChildWindow('word-db-editor' as WindowType, { width: 1300, height: 800 }),
        },
      ],
    },
    
    // Help menu
    {
      label: 'Help',
      submenu: [
        {
          label: 'About Online Browser Mode',
          click: () => {
            dialog.showMessageBox({
              type: 'info',
              title: 'Help - Online Browser Mode',
              message: 'Online Browser Mode allows you to use mLearn in a browser with a video.\n\nRight-click on a video, click "Inspect Element", go to Console, and paste the injector script from the Connect menu.',
            });
          },
        },
        { type: 'separator' },
        {
          label: 'About mLearn',
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

  // Version
  ipcMain.on(IPC_CHANNELS.GET_VERSION, (event) => {
    event.reply(IPC_CHANNELS.VERSION, app.getVersion());
  });

  // Flashcard syncing window
  ipcMain.on(IPC_CHANNELS.FLASHCARD_CONNECT_OPEN, () => {
    createChildWindow('connect-qr' as WindowType, { width: 600, height: 700 });
  });
}
