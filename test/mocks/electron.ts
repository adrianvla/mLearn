import { vi } from 'vitest';

export type IpcHandler = (event: unknown, ...args: unknown[]) => unknown;

export interface MockIpcMain {
  on: ReturnType<typeof vi.fn>;
  once: ReturnType<typeof vi.fn>;
  handle: ReturnType<typeof vi.fn>;
  handleOnce: ReturnType<typeof vi.fn>;
  removeHandler: ReturnType<typeof vi.fn>;
  removeAllListeners: ReturnType<typeof vi.fn>;
  removeListener: ReturnType<typeof vi.fn>;
  emit: ReturnType<typeof vi.fn>;
  _handlers: Map<string, IpcHandler>;
  _listeners: Map<string, IpcHandler[]>;
}

export interface MockWebContents {
  send: ReturnType<typeof vi.fn>;
  isDestroyed: ReturnType<typeof vi.fn>;
  isLoading: ReturnType<typeof vi.fn>;
  executeJavaScript: ReturnType<typeof vi.fn>;
  once: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  openDevTools: ReturnType<typeof vi.fn>;
  id: number;
}

export interface MockBrowserWindowInstance {
  webContents: MockWebContents;
  loadURL: ReturnType<typeof vi.fn>;
  loadFile: ReturnType<typeof vi.fn>;
  show: ReturnType<typeof vi.fn>;
  hide: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
  focus: ReturnType<typeof vi.fn>;
  isDestroyed: ReturnType<typeof vi.fn>;
  isVisible: ReturnType<typeof vi.fn>;
  isMinimized: ReturnType<typeof vi.fn>;
  isFocused: ReturnType<typeof vi.fn>;
  minimize: ReturnType<typeof vi.fn>;
  maximize: ReturnType<typeof vi.fn>;
  restore: ReturnType<typeof vi.fn>;
  setTitle: ReturnType<typeof vi.fn>;
  getTitle: ReturnType<typeof vi.fn>;
  setSize: ReturnType<typeof vi.fn>;
  getSize: ReturnType<typeof vi.fn>;
  setPosition: ReturnType<typeof vi.fn>;
  getPosition: ReturnType<typeof vi.fn>;
  setBounds: ReturnType<typeof vi.fn>;
  getBounds: ReturnType<typeof vi.fn>;
  setAlwaysOnTop: ReturnType<typeof vi.fn>;
  setMenuBarVisibility: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  once: ReturnType<typeof vi.fn>;
  removeAllListeners: ReturnType<typeof vi.fn>;
  id: number;
}

export function createMockWebContents(id = 1): MockWebContents {
  return {
    send: vi.fn(),
    isDestroyed: vi.fn(() => false),
    isLoading: vi.fn(() => false),
    executeJavaScript: vi.fn(() => Promise.resolve()),
    once: vi.fn(),
    on: vi.fn(),
    openDevTools: vi.fn(),
    id,
  };
}

export function createMockBrowserWindow(id = 1): MockBrowserWindowInstance {
  return {
    webContents: createMockWebContents(id),
    loadURL: vi.fn(() => Promise.resolve()),
    loadFile: vi.fn(() => Promise.resolve()),
    show: vi.fn(),
    hide: vi.fn(),
    close: vi.fn(),
    destroy: vi.fn(),
    focus: vi.fn(),
    isDestroyed: vi.fn(() => false),
    isVisible: vi.fn(() => true),
    isMinimized: vi.fn(() => false),
    isFocused: vi.fn(() => true),
    minimize: vi.fn(),
    maximize: vi.fn(),
    restore: vi.fn(),
    setTitle: vi.fn(),
    getTitle: vi.fn(() => 'mlearn'),
    setSize: vi.fn(),
    getSize: vi.fn(() => [1024, 768]),
    setPosition: vi.fn(),
    getPosition: vi.fn(() => [0, 0]),
    setBounds: vi.fn(),
    getBounds: vi.fn(() => ({ x: 0, y: 0, width: 1024, height: 768 })),
    setAlwaysOnTop: vi.fn(),
    setMenuBarVisibility: vi.fn(),
    on: vi.fn().mockReturnThis(),
    once: vi.fn().mockReturnThis(),
    removeAllListeners: vi.fn().mockReturnThis(),
    id,
  };
}

export function createMockIpcMain(): MockIpcMain {
  const handlers = new Map<string, IpcHandler>();
  const listeners = new Map<string, IpcHandler[]>();

  const mockIpcMain: MockIpcMain = {
    on: vi.fn((channel: string, handler: IpcHandler) => {
      const existing = listeners.get(channel) || [];
      existing.push(handler);
      listeners.set(channel, existing);
      return mockIpcMain;
    }),
    once: vi.fn((channel: string, handler: IpcHandler) => {
      const existing = listeners.get(channel) || [];
      existing.push(handler);
      listeners.set(channel, existing);
      return mockIpcMain;
    }),
    handle: vi.fn((channel: string, handler: IpcHandler) => {
      handlers.set(channel, handler);
    }),
    handleOnce: vi.fn((channel: string, handler: IpcHandler) => {
      handlers.set(channel, handler);
    }),
    removeHandler: vi.fn((channel: string) => {
      handlers.delete(channel);
    }),
    removeAllListeners: vi.fn((channel?: string) => {
      if (channel) {
        listeners.delete(channel);
      } else {
        listeners.clear();
      }
      return mockIpcMain;
    }),
    removeListener: vi.fn((channel: string, handler: IpcHandler) => {
      const existing = listeners.get(channel) || [];
      const idx = existing.indexOf(handler);
      if (idx >= 0) existing.splice(idx, 1);
      return mockIpcMain;
    }),
    emit: vi.fn((channel: string, ...args: unknown[]) => {
      const channelListeners = listeners.get(channel) || [];
      for (const listener of channelListeners) {
        listener({}, ...args);
      }
      return channelListeners.length > 0;
    }),
    _handlers: handlers,
    _listeners: listeners,
  };

  return mockIpcMain;
}

export function createMockApp(userDataPath = '/tmp/mlearn-test') {
  return {
    getPath: vi.fn((name: string) => {
      const paths: Record<string, string> = {
        userData: userDataPath,
        home: '/tmp/home',
        appData: '/tmp/appData',
        temp: '/tmp',
        desktop: '/tmp/desktop',
        documents: '/tmp/documents',
        downloads: '/tmp/downloads',
      };
      return paths[name] || `/tmp/${name}`;
    }),
    getVersion: vi.fn(() => '2.0.0'),
    getName: vi.fn(() => 'mlearn'),
    isPackaged: false,
    relaunch: vi.fn(),
    exit: vi.fn(),
    quit: vi.fn(),
    name: 'mlearn',
    whenReady: vi.fn(() => Promise.resolve()),
    on: vi.fn().mockReturnThis(),
    once: vi.fn().mockReturnThis(),
    removeAllListeners: vi.fn().mockReturnThis(),
    isReady: vi.fn(() => true),
    requestSingleInstanceLock: vi.fn(() => true),
    dock: {
      show: vi.fn(),
      hide: vi.fn(),
      bounce: vi.fn(),
      setBadge: vi.fn(),
    },
  };
}

export function createMockDialog() {
  return {
    showSaveDialog: vi.fn(() => Promise.resolve({ canceled: false, filePath: '/tmp/saved-file' })),
    showOpenDialog: vi.fn(() => Promise.resolve({ canceled: false, filePaths: ['/tmp/opened-file'] })),
    showMessageBox: vi.fn(() => Promise.resolve({ response: 0, checkboxChecked: false })),
    showErrorBox: vi.fn(),
  };
}

export function createMockProtocol() {
  return {
    registerSchemesAsPrivileged: vi.fn(),
    handle: vi.fn(),
    unhandle: vi.fn(),
    isProtocolHandled: vi.fn(() => true),
  };
}

export function createMockNet() {
  return {
    fetch: vi.fn(() =>
      Promise.resolve(
        new Response('', { status: 200 }),
      ),
    ),
  };
}

export function createMockShell() {
  return {
    openExternal: vi.fn(() => Promise.resolve()),
    openPath: vi.fn(() => Promise.resolve('')),
    showItemInFolder: vi.fn(),
  };
}

export function createMockClipboard() {
  return {
    writeText: vi.fn(),
    readText: vi.fn(() => ''),
    writeHTML: vi.fn(),
    readHTML: vi.fn(() => ''),
  };
}

export function createMockMenu() {
  return {
    buildFromTemplate: vi.fn(() => ({ popup: vi.fn(), items: [] })),
    setApplicationMenu: vi.fn(),
    getApplicationMenu: vi.fn(() => null),
  };
}

let nextWindowId = 1;

export function createMockElectron(userDataPath = '/tmp/mlearn-test') {
  nextWindowId = 1;

  const mockApp = createMockApp(userDataPath);
  const mockIpcMain = createMockIpcMain();
  const mockDialog = createMockDialog();
  const mockProtocol = createMockProtocol();
  const mockNet = createMockNet();
  const mockShell = createMockShell();
  const mockClipboard = createMockClipboard();
  const mockMenu = createMockMenu();

  const allWindows: MockBrowserWindowInstance[] = [];

  const MockBrowserWindowClass = vi.fn(function (this: MockBrowserWindowInstance) {
    const id = nextWindowId++;
    const win = createMockBrowserWindow(id);
    Object.assign(this, win);
    allWindows.push(this);
    return this;
  }) as unknown as {
    new (): MockBrowserWindowInstance;
    getAllWindows: ReturnType<typeof vi.fn>;
    getFocusedWindow: ReturnType<typeof vi.fn>;
    fromWebContents: ReturnType<typeof vi.fn>;
    fromId: ReturnType<typeof vi.fn>;
  };

  MockBrowserWindowClass.getAllWindows = vi.fn(() => allWindows.filter(w => !(w.isDestroyed as () => boolean)()));
  MockBrowserWindowClass.getFocusedWindow = vi.fn(() => allWindows.find(w => (w.isFocused as () => boolean)() && !(w.isDestroyed as () => boolean)()) || null);
  MockBrowserWindowClass.fromWebContents = vi.fn((wc: MockWebContents) => allWindows.find(w => w.webContents === wc) || null);
  MockBrowserWindowClass.fromId = vi.fn((id: number) => allWindows.find(w => w.id === id) || null);

  return {
    app: mockApp,
    ipcMain: mockIpcMain,
    dialog: mockDialog,
    protocol: mockProtocol,
    net: mockNet,
    shell: mockShell,
    clipboard: mockClipboard,
    Menu: mockMenu,
    BrowserWindow: MockBrowserWindowClass,
    _allWindows: allWindows,
  };
}
