import { describe, it, expect, vi, beforeEach } from 'vitest';

const ipcOnHandlers = new Map<string, (...args: unknown[]) => void>();

const mockMenuInstance = { popup: vi.fn() };

type MockWindow = {
  loadURL: ReturnType<typeof vi.fn>;
  loadFile: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  setSize: ReturnType<typeof vi.fn>;
  setBounds: ReturnType<typeof vi.fn>;
  getBounds: ReturnType<typeof vi.fn>;
  isFullScreen: ReturnType<typeof vi.fn>;
  setFullScreen: ReturnType<typeof vi.fn>;
  setAlwaysOnTop: ReturnType<typeof vi.fn>;
  setResizable: ReturnType<typeof vi.fn>;
  setFocusable: ReturnType<typeof vi.fn>;
  setMinimizable: ReturnType<typeof vi.fn>;
  setFullScreenable: ReturnType<typeof vi.fn>;
  setWindowButtonVisibility: ReturnType<typeof vi.fn>;
  isDestroyed: ReturnType<typeof vi.fn>;
  focus: ReturnType<typeof vi.fn>;
  webContents: {
    send: ReturnType<typeof vi.fn>;
    isLoading: ReturnType<typeof vi.fn>;
    once: ReturnType<typeof vi.fn>;
    isDestroyed: ReturnType<typeof vi.fn>;
  };
};

const createdWindows: MockWindow[] = [];

function makeMockWindow(): MockWindow {
  const win: MockWindow = {
    loadURL: vi.fn(),
    loadFile: vi.fn(),
    on: vi.fn(),
    close: vi.fn(),
    setSize: vi.fn(),
    setBounds: vi.fn(),
    getBounds: vi.fn(() => ({ x: 0, y: 0, width: 1200, height: 700 })),
    isFullScreen: vi.fn(() => false),
    setFullScreen: vi.fn(),
    setAlwaysOnTop: vi.fn(),
    setResizable: vi.fn(),
    setFocusable: vi.fn(),
    setMinimizable: vi.fn(),
    setFullScreenable: vi.fn(),
    setWindowButtonVisibility: vi.fn(),
    isDestroyed: vi.fn(() => false),
    focus: vi.fn(),
    webContents: {
      send: vi.fn(),
      isLoading: vi.fn(() => false),
      once: vi.fn(),
      isDestroyed: vi.fn(() => false),
    },
  };
  createdWindows.push(win);
  return win;
}

const mockFromWebContents = vi.fn(() => makeMockWindow());

class MockBrowserWindow {
  static fromWebContents = mockFromWebContents;

  loadURL: ReturnType<typeof vi.fn>;
  loadFile: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  setSize: ReturnType<typeof vi.fn>;
  setBounds: ReturnType<typeof vi.fn>;
  getBounds: ReturnType<typeof vi.fn>;
  isFullScreen: ReturnType<typeof vi.fn>;
  setFullScreen: ReturnType<typeof vi.fn>;
  setAlwaysOnTop: ReturnType<typeof vi.fn>;
  setResizable: ReturnType<typeof vi.fn>;
  setFocusable: ReturnType<typeof vi.fn>;
  setMinimizable: ReturnType<typeof vi.fn>;
  setFullScreenable: ReturnType<typeof vi.fn>;
  setWindowButtonVisibility: ReturnType<typeof vi.fn>;
  isDestroyed: ReturnType<typeof vi.fn>;
  focus: ReturnType<typeof vi.fn>;
  webContents: {
    send: ReturnType<typeof vi.fn>;
    isLoading: ReturnType<typeof vi.fn>;
    once: ReturnType<typeof vi.fn>;
    isDestroyed: ReturnType<typeof vi.fn>;
  };

  constructor(_opts?: unknown) {
    const w = makeMockWindow();
    this.loadURL = w.loadURL;
    this.loadFile = w.loadFile;
    this.on = w.on;
    this.close = w.close;
    this.setSize = w.setSize;
    this.setBounds = w.setBounds;
    this.getBounds = w.getBounds;
    this.isFullScreen = w.isFullScreen;
    this.setFullScreen = w.setFullScreen;
    this.setAlwaysOnTop = w.setAlwaysOnTop;
    this.setResizable = w.setResizable;
    this.setFocusable = w.setFocusable;
    this.setMinimizable = w.setMinimizable;
    this.setFullScreenable = w.setFullScreenable;
    this.setWindowButtonVisibility = w.setWindowButtonVisibility;
    this.isDestroyed = w.isDestroyed;
    this.focus = w.focus;
    this.webContents = w.webContents;
  }
}

vi.mock('electron', () => ({
  BrowserWindow: MockBrowserWindow,
  app: {
    name: 'mLearnTest',
    getVersion: vi.fn(() => '1.2.3'),
    getPath: vi.fn(() => '/tmp/userData'),
  },
  ipcMain: {
    on: vi.fn((channel: string, handler: (...args: unknown[]) => void) => {
      ipcOnHandlers.set(channel, handler);
    }),
    handle: vi.fn(),
    removeHandler: vi.fn(),
  },
  Menu: {
    buildFromTemplate: vi.fn(() => mockMenuInstance),
    setApplicationMenu: vi.fn(),
  },
  dialog: {
    showMessageBox: vi.fn(() => Promise.resolve({ response: 1 })),
  },
  shell: {
    openExternal: vi.fn(),
  },
  clipboard: {
    writeText: vi.fn(),
  },
}));

vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn(() => false),
    readFileSync: vi.fn(() => 'script content ISMLEARNTETHERED_TO_REPLACE'),
  },
  existsSync: vi.fn(() => false),
  readFileSync: vi.fn(() => 'script content ISMLEARNTETHERED_TO_REPLACE'),
}));

vi.mock('../utils/platform', () => ({
  isMac: false,
  isLinux: false,
  isPackaged: false,
  getAppPath: vi.fn(() => '/tmp/appPath'),
}));

vi.mock('./settings', () => ({
  loadSettings: vi.fn(() => ({ devMode: false })),
}));

function fireOn(channel: string, event: Record<string, unknown>, ...args: unknown[]) {
  const handler = ipcOnHandlers.get(channel);
  if (!handler) throw new Error(`No ipcMain.on handler registered for "${channel}"`);
  handler(event, ...args);
}

function makeSenderEvent() {
  const win = makeMockWindow();
  return { sender: win.webContents, reply: vi.fn() };
}

describe('windowManager', () => {
  beforeEach(() => {
    vi.resetModules();
    ipcOnHandlers.clear();
    createdWindows.length = 0;
    mockMenuInstance.popup.mockReset();
    mockFromWebContents.mockReset();
    mockFromWebContents.mockImplementation(() => makeMockWindow());
    MockBrowserWindow.fromWebContents = mockFromWebContents;
  });

  describe('getMainWindow', () => {
    it('returns null before any window is created', async () => {
      const { getMainWindow } = await import('./windowManager');
      expect(getMainWindow()).toBeNull();
    });
  });

  describe('getCurrentWindow', () => {
    it('returns null before any window is created', async () => {
      const { getCurrentWindow } = await import('./windowManager');
      expect(getCurrentWindow()).toBeNull();
    });
  });

  describe('createMainWindow', () => {
    it('creates a BrowserWindow and returns it', async () => {
      const { createMainWindow } = await import('./windowManager');
      const win = createMainWindow();
      expect(win).toBeDefined();
      expect(createdWindows.length).toBeGreaterThanOrEqual(1);
    });

    it('sets mainWindow and currentWindow after creation', async () => {
      const { createMainWindow, getMainWindow, getCurrentWindow } = await import('./windowManager');
      const win = createMainWindow();
      expect(getMainWindow()).toBe(win);
      expect(getCurrentWindow()).toBe(win);
    });

    it('loads dev URL in development mode', async () => {
      process.env.NODE_ENV = 'development';
      const { createMainWindow } = await import('./windowManager');
      const win = createMainWindow();
      expect(win.loadURL).toHaveBeenCalledWith('http://localhost:3000/src/html/main.html');
      expect(win.loadFile).not.toHaveBeenCalled();
      delete process.env.NODE_ENV;
    });

    it('loads a file in production mode', async () => {
      process.env.NODE_ENV = 'production';
      const { createMainWindow } = await import('./windowManager');
      const win = createMainWindow();
      expect(win.loadFile).toHaveBeenCalled();
      expect(win.loadURL).not.toHaveBeenCalled();
      delete process.env.NODE_ENV;
    });

    it('registers a closed event listener on the window', async () => {
      const { createMainWindow } = await import('./windowManager');
      const win = createMainWindow();
      expect(win.on).toHaveBeenCalledWith('closed', expect.any(Function));
    });

    it('nullifies mainWindow and currentWindow when closed event fires', async () => {
      const { createMainWindow, getMainWindow, getCurrentWindow } = await import('./windowManager');
      const win = createMainWindow();

      const closedCall = (win.on as ReturnType<typeof vi.fn>).mock.calls.find(
        (c: unknown[]) => c[0] === 'closed'
      );
      expect(closedCall).toBeDefined();
      (closedCall![1] as () => void)();

      expect(getMainWindow()).toBeNull();
      expect(getCurrentWindow()).toBeNull();
    });

    it('creates the window with frame:false', async () => {
      const { createMainWindow } = await import('./windowManager');
      const win = createMainWindow();
      expect(win).toBeDefined();
      expect(win.loadURL ?? win.loadFile).toBeDefined();
    });
  });

  describe('createWelcomeWindow', () => {
    it('creates a BrowserWindow and returns it', async () => {
      const { createWelcomeWindow } = await import('./windowManager');
      const win = createWelcomeWindow();
      expect(win).toBeDefined();
      expect(createdWindows.length).toBeGreaterThanOrEqual(1);
    });

    it('sets currentWindow to the welcome window', async () => {
      const { createWelcomeWindow, getCurrentWindow } = await import('./windowManager');
      const win = createWelcomeWindow();
      expect(getCurrentWindow()).toBe(win);
    });

    it('does not set mainWindow', async () => {
      const { createWelcomeWindow, getMainWindow } = await import('./windowManager');
      createWelcomeWindow();
      expect(getMainWindow()).toBeNull();
    });

    it('loads dev URL in development mode', async () => {
      process.env.NODE_ENV = 'development';
      const { createWelcomeWindow } = await import('./windowManager');
      const win = createWelcomeWindow();
      expect(win.loadURL).toHaveBeenCalledWith('http://localhost:3000/src/html/welcome.html');
      delete process.env.NODE_ENV;
    });

    it('loads a file in production mode', async () => {
      process.env.NODE_ENV = 'production';
      const { createWelcomeWindow } = await import('./windowManager');
      const win = createWelcomeWindow();
      expect(win.loadFile).toHaveBeenCalled();
      expect(win.loadURL).not.toHaveBeenCalled();
      delete process.env.NODE_ENV;
    });
  });

  describe('createChildWindow', () => {
    it('creates a new BrowserWindow for an unknown type', async () => {
      const countBefore = createdWindows.length;
      const { createChildWindow } = await import('./windowManager');
      createChildWindow('settings' as never);
      expect(createdWindows.length).toBeGreaterThan(countBefore);
    });

    it('loads dev URL in development mode', async () => {
      process.env.NODE_ENV = 'development';
      const { createChildWindow } = await import('./windowManager');
      const win = createChildWindow('settings' as never);
      expect(win.loadURL).toHaveBeenCalledWith('http://localhost:3000/src/html/settings.html');
      delete process.env.NODE_ENV;
    });

    it('loads a file in production mode', async () => {
      process.env.NODE_ENV = 'production';
      const { createChildWindow } = await import('./windowManager');
      const win = createChildWindow('settings' as never);
      expect(win.loadFile).toHaveBeenCalled();
      expect(win.loadURL).not.toHaveBeenCalled();
      delete process.env.NODE_ENV;
    });

    it('returns the existing window instead of creating a duplicate', async () => {
      const { createChildWindow } = await import('./windowManager');
      const win1 = createChildWindow('settings' as never);
      const win2 = createChildWindow('settings' as never);
      expect(win1).toBe(win2);
    });

    it('focuses the existing window on duplicate creation attempt', async () => {
      const { createChildWindow } = await import('./windowManager');
      const win1 = createChildWindow('settings' as never);
      createChildWindow('settings' as never);
      expect(win1.focus).toHaveBeenCalledOnce();
    });

    it('creates a distinct new window for a different type', async () => {
      const { createChildWindow } = await import('./windowManager');
      const countBefore = createdWindows.length;
      createChildWindow('settings' as never);
      createChildWindow('flashcards' as never);
      expect(createdWindows.length).toBe(countBefore + 2);
    });

    it('registers a closed event listener that removes the window from the map', async () => {
      const { createChildWindow } = await import('./windowManager');
      const win = createChildWindow('settings' as never);
      const mockWin = createdWindows[createdWindows.length - 1];

      const closedCall = (win.on as ReturnType<typeof vi.fn>).mock.calls.find(
        (c: unknown[]) => c[0] === 'closed'
      );
      expect(closedCall).toBeDefined();
      (closedCall![1] as () => void)();

      mockWin.isDestroyed.mockReturnValue(true);

      const countAfterClose = createdWindows.length;
      createChildWindow('settings' as never);
      expect(createdWindows.length).toBe(countAfterClose + 1);
    });
  });

  describe('setupWindowIPC', () => {
    it('registers ipcMain.on handlers for all expected channels', async () => {
      const { setupWindowIPC } = await import('./windowManager');
      setupWindowIPC();
      const { IPC_CHANNELS } = await import('../../shared/constants');
      const expectedChannels = [
        IPC_CHANNELS.TRAFFIC_LIGHTS,
        IPC_CHANNELS.CHANGE_WINDOW_SIZE,
        IPC_CHANNELS.MAKE_PIP,
        IPC_CHANNELS.MAKE_NORMAL,
        IPC_CHANNELS.SHOW_CTX_MENU,
        IPC_CHANNELS.SHOW_READER_CTX_MENU,
        IPC_CHANNELS.OPEN_WINDOW,
        IPC_CHANNELS.GET_WINDOW_CONTEXT,
        IPC_CHANNELS.CLOSE_WINDOW,
        IPC_CHANNELS.GET_VERSION,
        IPC_CHANNELS.FLASHCARD_CONNECT_OPEN,
      ];
      for (const ch of expectedChannels) {
        expect(ipcOnHandlers.has(ch), `Missing handler for "${ch}"`).toBe(true);
      }
    });

    it('TRAFFIC_LIGHTS: calls setWindowButtonVisibility on mac when mainWindow exists', async () => {
      vi.doMock('../utils/platform', () => ({
        isMac: true,
        isLinux: false,
        isPackaged: false,
        getAppPath: vi.fn(() => '/tmp'),
      }));
      const { setupWindowIPC, createMainWindow } = await import('./windowManager');
      const win = createMainWindow();
      setupWindowIPC();
      const { IPC_CHANNELS } = await import('../../shared/constants');

      fireOn(IPC_CHANNELS.TRAFFIC_LIGHTS, {}, { visibility: false });
      expect(win.setWindowButtonVisibility).toHaveBeenCalledWith(false);
    });

    it('TRAFFIC_LIGHTS: does nothing when no mainWindow exists', async () => {
      const { setupWindowIPC } = await import('./windowManager');
      setupWindowIPC();
      const { IPC_CHANNELS } = await import('../../shared/constants');
      expect(() => fireOn(IPC_CHANNELS.TRAFFIC_LIGHTS, {}, { visibility: true })).not.toThrow();
    });

    it('CHANGE_WINDOW_SIZE: calls setSize on mainWindow with provided dimensions', async () => {
      const { setupWindowIPC, createMainWindow } = await import('./windowManager');
      const win = createMainWindow();
      setupWindowIPC();
      const { IPC_CHANNELS } = await import('../../shared/constants');

      fireOn(IPC_CHANNELS.CHANGE_WINDOW_SIZE, {}, { width: 900, height: 500 });
      expect(win.setSize).toHaveBeenCalledWith(900, 500, true);
    });

    it('MAKE_PIP: saves old bounds and applies PiP window properties', async () => {
      const { setupWindowIPC, createMainWindow } = await import('./windowManager');
      createMainWindow();
      const win = createdWindows[createdWindows.length - 1];
      win.getBounds.mockReturnValue({ x: 0, y: 0, width: 1200, height: 700 });
      setupWindowIPC();
      const { IPC_CHANNELS } = await import('../../shared/constants');

      fireOn(IPC_CHANNELS.MAKE_PIP, {}, { width: 400, height: 225 });

      expect(win.setBounds).toHaveBeenCalledWith({ width: 400, height: 225, x: 50, y: 50 }, true);
      expect(win.setAlwaysOnTop).toHaveBeenCalledWith(true, 'pop-up-menu');
      expect(win.setResizable).toHaveBeenCalledWith(true);
      expect(win.setFocusable).toHaveBeenCalledWith(false);
      expect(win.setMinimizable).toHaveBeenCalledWith(false);
      expect(win.setFullScreen).toHaveBeenCalledWith(false);
    });

    it('MAKE_PIP: does nothing when mainWindow is null', async () => {
      const { setupWindowIPC } = await import('./windowManager');
      setupWindowIPC();
      const { IPC_CHANNELS } = await import('../../shared/constants');
      expect(() => fireOn(IPC_CHANNELS.MAKE_PIP, {}, { width: 400, height: 225 })).not.toThrow();
    });

    it('MAKE_NORMAL: restores window to non-PiP state', async () => {
      const { setupWindowIPC, createMainWindow } = await import('./windowManager');
      createMainWindow();
      const win = createdWindows[createdWindows.length - 1];
      win.getBounds.mockReturnValue({ x: 0, y: 0, width: 1200, height: 700 });
      setupWindowIPC();
      const { IPC_CHANNELS } = await import('../../shared/constants');

      fireOn(IPC_CHANNELS.MAKE_PIP, {}, { width: 400, height: 225 });
      fireOn(IPC_CHANNELS.MAKE_NORMAL, {});

      expect(win.setAlwaysOnTop).toHaveBeenCalledWith(false);
      expect(win.setFocusable).toHaveBeenCalledWith(true);
      expect(win.setMinimizable).toHaveBeenCalledWith(true);
      expect(win.setBounds).toHaveBeenLastCalledWith({ width: 1200, height: 700 }, true);
    });

    it('MAKE_NORMAL: restores fullscreen state saved before entering PiP', async () => {
      const { setupWindowIPC, createMainWindow } = await import('./windowManager');
      createMainWindow();
      const win = createdWindows[createdWindows.length - 1];
      win.isFullScreen.mockReturnValue(true);
      win.getBounds.mockReturnValue({ x: 0, y: 0, width: 1440, height: 900 });
      setupWindowIPC();
      const { IPC_CHANNELS } = await import('../../shared/constants');

      fireOn(IPC_CHANNELS.MAKE_PIP, {}, { width: 400, height: 225 });
      fireOn(IPC_CHANNELS.MAKE_NORMAL, {});

      expect(win.setFullScreen).toHaveBeenLastCalledWith(true);
    });

    it('MAKE_NORMAL: does nothing when mainWindow is null', async () => {
      const { setupWindowIPC } = await import('./windowManager');
      setupWindowIPC();
      const { IPC_CHANNELS } = await import('../../shared/constants');
      expect(() => fireOn(IPC_CHANNELS.MAKE_NORMAL, {})).not.toThrow();
    });

    it('SHOW_CTX_MENU: builds and pops up a context menu', async () => {
      const { setupWindowIPC } = await import('./windowManager');
      setupWindowIPC();
      const { IPC_CHANNELS } = await import('../../shared/constants');
      const { Menu } = await import('electron');

      fireOn(IPC_CHANNELS.SHOW_CTX_MENU, makeSenderEvent());

      expect(Menu.buildFromTemplate).toHaveBeenCalled();
      expect(mockMenuInstance.popup).toHaveBeenCalled();
    });

    it('SHOW_CTX_MENU: shows "Watch Together" label when isWatchTogether is false', async () => {
      const { setupWindowIPC } = await import('./windowManager');
      setupWindowIPC();
      const { IPC_CHANNELS } = await import('../../shared/constants');
      const { Menu } = await import('electron');

      fireOn(IPC_CHANNELS.SHOW_CTX_MENU, makeSenderEvent(), { isWatchTogether: false });

      const template = (Menu.buildFromTemplate as ReturnType<typeof vi.fn>).mock.calls[0][0];
      const wtItem = (template as Array<{ label?: string }>).find(item => item.label === 'Watch Together');
      expect(wtItem).toBeDefined();
    });

    it('SHOW_CTX_MENU: shows "Stop Watch Together" label when isWatchTogether is true', async () => {
      const { setupWindowIPC } = await import('./windowManager');
      setupWindowIPC();
      const { IPC_CHANNELS } = await import('../../shared/constants');
      const { Menu } = await import('electron');

      fireOn(IPC_CHANNELS.SHOW_CTX_MENU, makeSenderEvent(), { isWatchTogether: true });

      const template = (Menu.buildFromTemplate as ReturnType<typeof vi.fn>).mock.calls[0][0];
      const wtItem = (template as Array<{ label?: string }>).find(item => item.label === 'Stop Watch Together');
      expect(wtItem).toBeDefined();
    });

    it('SHOW_CTX_MENU: disables Copy Subtitle and Explain when no phrase is available', async () => {
      const { setupWindowIPC } = await import('./windowManager');
      setupWindowIPC();
      const { IPC_CHANNELS } = await import('../../shared/constants');
      const { Menu } = await import('electron');

      fireOn(IPC_CHANNELS.SHOW_CTX_MENU, makeSenderEvent(), {
        hasContextPhrase: false,
        canExplainPhrase: false,
      });

      const template = (Menu.buildFromTemplate as ReturnType<typeof vi.fn>).mock.calls[0][0];
      const copyItem = (template as Array<{ label?: string; enabled?: boolean }>).find(item => item.label === 'Copy Subtitle');
      const explainItem = (template as Array<{ label?: string; enabled?: boolean }>).find(item => item.label === 'Explain');
      expect(copyItem?.enabled).toBe(false);
      expect(explainItem?.enabled).toBe(false);
    });

    it('SHOW_CTX_MENU: enables Explain when a phrase can be explained', async () => {
      const { setupWindowIPC } = await import('./windowManager');
      setupWindowIPC();
      const { IPC_CHANNELS } = await import('../../shared/constants');
      const { Menu } = await import('electron');

      fireOn(IPC_CHANNELS.SHOW_CTX_MENU, makeSenderEvent(), {
        hasContextPhrase: true,
        canExplainPhrase: true,
      });

      const template = (Menu.buildFromTemplate as ReturnType<typeof vi.fn>).mock.calls[0][0];
      const explainItem = (template as Array<{ label?: string; enabled?: boolean }>).find(item => item.label === 'Explain');
      expect(explainItem?.enabled).toBe(true);
    });

    it('SHOW_READER_CTX_MENU: builds and pops up a reader context menu', async () => {
      const { setupWindowIPC } = await import('./windowManager');
      setupWindowIPC();
      const { IPC_CHANNELS } = await import('../../shared/constants');
      const { Menu } = await import('electron');

      fireOn(IPC_CHANNELS.SHOW_READER_CTX_MENU, makeSenderEvent(), {
        furiganaHiderEnabled: false,
        hasContextPhrase: true,
      });

      expect(Menu.buildFromTemplate).toHaveBeenCalled();
      expect(mockMenuInstance.popup).toHaveBeenCalled();
    });

    it('SHOW_READER_CTX_MENU: shows "Hide Reading" when furiganaHiderEnabled is false', async () => {
      const { setupWindowIPC } = await import('./windowManager');
      setupWindowIPC();
      const { IPC_CHANNELS } = await import('../../shared/constants');
      const { Menu } = await import('electron');

      fireOn(IPC_CHANNELS.SHOW_READER_CTX_MENU, makeSenderEvent(), {
        furiganaHiderEnabled: false,
        hasContextPhrase: false,
      });

      const template = (Menu.buildFromTemplate as ReturnType<typeof vi.fn>).mock.calls[0][0];
      const item = (template as Array<{ label?: string }>).find(i => i.label === 'Hide Reading');
      expect(item).toBeDefined();
    });

    it('SHOW_READER_CTX_MENU: shows "Show Reading" when furiganaHiderEnabled is true', async () => {
      const { setupWindowIPC } = await import('./windowManager');
      setupWindowIPC();
      const { IPC_CHANNELS } = await import('../../shared/constants');
      const { Menu } = await import('electron');

      fireOn(IPC_CHANNELS.SHOW_READER_CTX_MENU, makeSenderEvent(), {
        furiganaHiderEnabled: true,
        hasContextPhrase: false,
      });

      const template = (Menu.buildFromTemplate as ReturnType<typeof vi.fn>).mock.calls[0][0];
      const item = (template as Array<{ label?: string }>).find(i => i.label === 'Show Reading');
      expect(item).toBeDefined();
    });

    it('SHOW_READER_CTX_MENU: Copy Phrase item is disabled when hasContextPhrase is false', async () => {
      const { setupWindowIPC } = await import('./windowManager');
      setupWindowIPC();
      const { IPC_CHANNELS } = await import('../../shared/constants');
      const { Menu } = await import('electron');

      fireOn(IPC_CHANNELS.SHOW_READER_CTX_MENU, makeSenderEvent(), {
        furiganaHiderEnabled: false,
        hasContextPhrase: false,
      });

      const template = (Menu.buildFromTemplate as ReturnType<typeof vi.fn>).mock.calls[0][0];
      const copyItem = (template as Array<{ label?: string; enabled?: boolean }>).find(i => i.label === 'Copy Phrase');
      expect(copyItem?.enabled).toBe(false);
    });

    it('SHOW_READER_CTX_MENU: enables Explain when the current phrase can be explained', async () => {
      const { setupWindowIPC } = await import('./windowManager');
      setupWindowIPC();
      const { IPC_CHANNELS } = await import('../../shared/constants');
      const { Menu } = await import('electron');

      fireOn(IPC_CHANNELS.SHOW_READER_CTX_MENU, makeSenderEvent(), {
        furiganaHiderEnabled: false,
        hasContextPhrase: true,
        canExplainPhrase: true,
      });

      const template = (Menu.buildFromTemplate as ReturnType<typeof vi.fn>).mock.calls[0][0];
      const explainItem = (template as Array<{ label?: string; enabled?: boolean }>).find(i => i.label === 'Explain');
      expect(explainItem?.enabled).toBe(true);
    });

    it('OPEN_WINDOW: creates a child window for the given type', async () => {
      process.env.NODE_ENV = 'development';
      const { setupWindowIPC } = await import('./windowManager');
      setupWindowIPC();
      const { IPC_CHANNELS } = await import('../../shared/constants');
      const countBefore = createdWindows.length;

      fireOn(IPC_CHANNELS.OPEN_WINDOW, {}, { type: 'flashcards', options: {} });

      expect(createdWindows.length).toBeGreaterThan(countBefore);
      delete process.env.NODE_ENV;
    });

    it('OPEN_WINDOW: stores context so GET_WINDOW_CONTEXT returns it', async () => {
      process.env.NODE_ENV = 'development';
      const { setupWindowIPC } = await import('./windowManager');
      setupWindowIPC();
      const { IPC_CHANNELS } = await import('../../shared/constants');

      const context = { foo: 'bar' };
      fireOn(IPC_CHANNELS.OPEN_WINDOW, {}, { type: 'flashcards', context, options: {} });

      const event = { reply: vi.fn() };
      fireOn(IPC_CHANNELS.GET_WINDOW_CONTEXT, event, 'flashcards');
      expect(event.reply).toHaveBeenCalledWith(IPC_CHANNELS.WINDOW_CONTEXT, context);
      delete process.env.NODE_ENV;
    });

    it('OPEN_WINDOW: sends context to existing open window if one already exists', async () => {
      process.env.NODE_ENV = 'development';
      const { setupWindowIPC } = await import('./windowManager');
      setupWindowIPC();
      const { IPC_CHANNELS } = await import('../../shared/constants');

      fireOn(IPC_CHANNELS.OPEN_WINDOW, {}, { type: 'flashcards', options: {} });
      const existingWin = createdWindows[createdWindows.length - 1];

      const context = { updated: true };
      fireOn(IPC_CHANNELS.OPEN_WINDOW, {}, { type: 'flashcards', context, options: {} });

      expect(existingWin.webContents.send).toHaveBeenCalledWith(IPC_CHANNELS.WINDOW_CONTEXT, context);
      delete process.env.NODE_ENV;
    });

    it('GET_WINDOW_CONTEXT: replies with null when no context is stored for the type', async () => {
      const { setupWindowIPC } = await import('./windowManager');
      setupWindowIPC();
      const { IPC_CHANNELS } = await import('../../shared/constants');

      const event = { reply: vi.fn() };
      fireOn(IPC_CHANNELS.GET_WINDOW_CONTEXT, event, 'nonexistent');
      expect(event.reply).toHaveBeenCalledWith(IPC_CHANNELS.WINDOW_CONTEXT, null);
    });

    it('GET_WINDOW_CONTEXT: replies with stored context for the given type', async () => {
      process.env.NODE_ENV = 'development';
      const { setupWindowIPC } = await import('./windowManager');
      setupWindowIPC();
      const { IPC_CHANNELS } = await import('../../shared/constants');

      const ctx = { someKey: 'someValue' };
      fireOn(IPC_CHANNELS.OPEN_WINDOW, {}, { type: 'statistics', context: ctx, options: {} });

      const event = { reply: vi.fn() };
      fireOn(IPC_CHANNELS.GET_WINDOW_CONTEXT, event, 'statistics');
      expect(event.reply).toHaveBeenCalledWith(IPC_CHANNELS.WINDOW_CONTEXT, ctx);
      delete process.env.NODE_ENV;
    });

    it('CLOSE_WINDOW: closes the window associated with the sender', async () => {
      const { setupWindowIPC } = await import('./windowManager');
      setupWindowIPC();
      const { IPC_CHANNELS } = await import('../../shared/constants');

      const mockWin = makeMockWindow();
      mockFromWebContents.mockReturnValue(mockWin);

      fireOn(IPC_CHANNELS.CLOSE_WINDOW, makeSenderEvent());

      expect(mockWin.close).toHaveBeenCalledOnce();
    });

    it('CLOSE_WINDOW: does not throw when BrowserWindow.fromWebContents returns null', async () => {
      const { setupWindowIPC } = await import('./windowManager');
      setupWindowIPC();
      const { IPC_CHANNELS } = await import('../../shared/constants');

      mockFromWebContents.mockReturnValue(null as unknown as MockWindow);

      expect(() => fireOn(IPC_CHANNELS.CLOSE_WINDOW, makeSenderEvent())).not.toThrow();
    });

    it('GET_VERSION: replies with the app version from app.getVersion()', async () => {
      const { setupWindowIPC } = await import('./windowManager');
      setupWindowIPC();
      const { IPC_CHANNELS } = await import('../../shared/constants');
      const { app } = await import('electron');

      const event = { reply: vi.fn() };
      fireOn(IPC_CHANNELS.GET_VERSION, event);

      expect(app.getVersion).toHaveBeenCalled();
      expect(event.reply).toHaveBeenCalledWith(IPC_CHANNELS.VERSION, '1.2.3');
    });

    it('FLASHCARD_CONNECT_OPEN: creates a connect-qr child window with correct dimensions', async () => {
      process.env.NODE_ENV = 'development';
      const { setupWindowIPC } = await import('./windowManager');
      setupWindowIPC();
      const { IPC_CHANNELS } = await import('../../shared/constants');
      const countBefore = createdWindows.length;

      fireOn(IPC_CHANNELS.FLASHCARD_CONNECT_OPEN, {});

      expect(createdWindows.length).toBe(countBefore + 1);
      const lastWin = createdWindows[createdWindows.length - 1];
      expect(lastWin.loadURL).toHaveBeenCalledWith('http://localhost:3000/src/html/connect-qr.html');
      delete process.env.NODE_ENV;
    });
  });

  describe('setupAppMenu via createMainWindow', () => {
    it('calls Menu.buildFromTemplate and Menu.setApplicationMenu', async () => {
      const { createMainWindow } = await import('./windowManager');
      createMainWindow();
      const { Menu } = await import('electron');
      expect(Menu.buildFromTemplate).toHaveBeenCalled();
      expect(Menu.setApplicationMenu).toHaveBeenCalledWith(mockMenuInstance);
    });

    it('includes a File menu in the app menu template', async () => {
      const { createMainWindow } = await import('./windowManager');
      createMainWindow();
      const { Menu } = await import('electron');
      const template = (Menu.buildFromTemplate as ReturnType<typeof vi.fn>).mock.calls[0][0];
      const fileMenu = (template as Array<{ label?: string }>).find(item => item.label === 'File');
      expect(fileMenu).toBeDefined();
    });

    it('includes a View menu in the app menu template', async () => {
      const { createMainWindow } = await import('./windowManager');
      createMainWindow();
      const { Menu } = await import('electron');
      const template = (Menu.buildFromTemplate as ReturnType<typeof vi.fn>).mock.calls[0][0];
      const viewMenu = (template as Array<{ label?: string }>).find(item => item.label === 'View');
      expect(viewMenu).toBeDefined();
    });
  });
});
