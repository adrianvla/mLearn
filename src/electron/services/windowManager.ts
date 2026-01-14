/**
 * Window Manager Service
 * Handles creation and management of all application windows
 */

import { BrowserWindow, app, ipcMain, Menu, dialog, shell, clipboard } from 'electron';
import path from 'path';
import fs from 'fs';
import { IPC_CHANNELS, WindowType } from '../../shared/constants';
import type { WindowSize, OpenWindowPayload } from '../../shared/types';
import { isMac, isLinux, isPackaged, getAppPath } from '../utils/platform';
import { loadSettings } from './settings';

// Window references
let mainWindow: BrowserWindow | null = null;
let currentWindow: BrowserWindow | null = null;
const childWindows: Map<string, BrowserWindow> = new Map();

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
function getPreloadPath(): string {
  if (isPackaged) {
    return path.join(__dirname, 'preload.js');
  }
  return path.join(__dirname, '..', 'preload.js');
}

// Get HTML file path for a window type
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function getWindowHtmlPath(type: WindowType): string {
  const isDev = process.env.NODE_ENV === 'development';
  
  if (isDev) {
    // In development, use Vite dev server
    const port = 3000;
    return `http://localhost:${port}/${type}.html`;
  }
  
  // In production, use built files
  return path.join(__dirname, '..', '..', 'dist', `${type}.html`);
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
    },
  };

  // macOS-specific title bar
  if (isMac) {
    windowOptions.titleBarStyle = 'hidden';
  }

  mainWindow = new BrowserWindow(windowOptions);
  currentWindow = mainWindow;

  const isDev = process.env.NODE_ENV === 'development';
  if (isDev) {
    mainWindow.loadURL('http://localhost:3000/main.html');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', '..', 'dist', 'main.html'));
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
    },
  });

  currentWindow = welcomeWindow;

  const isDev = process.env.NODE_ENV === 'development';
  if (isDev) {
    welcomeWindow.loadURL('http://localhost:3000/welcome.html');
  } else {
    welcomeWindow.loadFile(path.join(__dirname, '..', '..', 'dist', 'welcome.html'));
  }

  return welcomeWindow;
}

// Create a generic child window
export function createChildWindow(
  type: WindowType,
  options: Partial<Electron.BrowserWindowConstructorOptions> = {}
): BrowserWindow {
  const defaultOptions: Electron.BrowserWindowConstructorOptions = {
    width: 800,
    height: 600,
    webPreferences: {
      preload: getPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
    },
    ...options,
  };

  const window = new BrowserWindow(defaultOptions);
  childWindows.set(type, window);

  const isDev = process.env.NODE_ENV === 'development';
  if (isDev) {
    window.loadURL(`http://localhost:3000/${type}.html`);
  } else {
    window.loadFile(path.join(__dirname, '..', '..', 'dist', `${type}.html`));
  }

  window.on('closed', () => {
    childWindows.delete(type);
  });

  return window;
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
function showVideoContextMenu(sender: Electron.WebContents): void {
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
      click: () => mainWindow?.webContents.send(IPC_CHANNELS.SHOW_SETTINGS, 'About'),
    },
    { type: 'separator' },
    {
      label: 'Settings',
      click: () => mainWindow?.webContents.send(IPC_CHANNELS.SHOW_SETTINGS),
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
          click: () => mainWindow?.webContents.send(IPC_CHANNELS.SHOW_SETTINGS),
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
              const scriptPath = path.join(appPath, 'scripts', 'injector.js');
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
            shell.openExternal('http://127.0.0.1:7753/mLearn.user.js');
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
          click: () => mainWindow?.webContents.send(IPC_CHANNELS.REVIEW_FLASHCARDS_REQUEST),
        },
        {
          label: 'Force recreate new flashcards for today',
          click: () => {
            mainWindow?.webContents.send(IPC_CHANNELS.FORCE_NEWDAY_FLASHCARDS);
            dialog.showMessageBox({
              type: 'info',
              title: 'Created!',
              message: 'You may now review the flashcards that you just created.',
            });
          },
        },
        {
          label: 'Open Syncing Window',
          click: () => mainWindow?.webContents.send(IPC_CHANNELS.FLASHCARD_CONNECT_OPEN),
        },
      ],
    },
    
    // Statistics menu
    {
      label: 'Statistics',
      submenu: [
        {
          label: 'Show learning statistics',
          click: () => mainWindow?.webContents.send(IPC_CHANNELS.SHOW_SETTINGS, 'Stats'),
        },
        {
          label: 'Show Kanji grid',
          click: () => mainWindow?.webContents.send(IPC_CHANNELS.OPEN_KANJI_GRID),
        },
        {
          label: 'Edit word knowledge database',
          click: () => mainWindow?.webContents.send(IPC_CHANNELS.OPEN_WORD_DB_EDITOR),
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
          click: () => mainWindow?.webContents.send(IPC_CHANNELS.SHOW_SETTINGS, 'About'),
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
  ipcMain.on(IPC_CHANNELS.SHOW_CTX_MENU, (event) => {
    showVideoContextMenu(event.sender);
  });

  // Open child window from renderer
  ipcMain.on(IPC_CHANNELS.OPEN_WINDOW, (_event, payload: OpenWindowPayload) => {
    createChildWindow(payload.type, payload.options);
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
}
