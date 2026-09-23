import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import path from 'node:path';

const mocks = vi.hoisted(() => ({ windows: [] as Array<{
  options: Record<string, unknown>;
  show: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  loadFile: ReturnType<typeof vi.fn>;
  webContents: { executeJavaScript: ReturnType<typeof vi.fn> };
}>, }));

vi.mock('electron', () => ({
  app: { isPackaged: false },
  BrowserWindow: class extends EventEmitter {
    options: Record<string, unknown>;
    show = vi.fn();
    close = vi.fn(() => this.emit('closed'));
    isDestroyed = vi.fn(() => false);
    webContents = { executeJavaScript: vi.fn(() => Promise.resolve()) };
    loadFile = vi.fn(() => {
      queueMicrotask(() => this.emit('ready-to-show'));
      return Promise.resolve();
    });
    constructor(options: Record<string, unknown>) {
      super();
      this.options = options;
      mocks.windows.push(this);
    }
  },
}));

beforeEach(() => {
  vi.resetModules();
  mocks.windows.length = 0;
});

describe('startup splash', () => {
  it('loads a static isolated window before startup work continues', async () => {
    const splash = await import('./splashWindow');
    await splash.createSplashWindow();
    const window = mocks.windows[0];
    expect(window.options.show).toBe(false);
    expect(window.options.webPreferences).toEqual({
      contextIsolation: true, nodeIntegration: false, sandbox: true,
    });
    expect(window.loadFile.mock.calls[0][0]).toBe(path.resolve('src/html/splash.html'));
    expect(window.show).toHaveBeenCalledOnce();
  });

  it('uses weighted phase milestones and replays the latest update after loading', async () => {
    const splash = await import('./splashWindow');
    splash.reportStartupPhase('inspection');
    splash.reportStartupPhase('snapshot');
    await splash.createSplashWindow();
    await Promise.resolve();
    const window = mocks.windows[0];
    expect(window.webContents.executeJavaScript).toHaveBeenCalledWith(
      expect.stringContaining('"progress":25'),
    );
    splash.reportStartupPhase('database');
    splash.reportStartupPhase('python');
    splash.reportStartupPhase('preparation', 0.5, 'Loading library');
    expect(window.webContents.executeJavaScript).toHaveBeenLastCalledWith(
      expect.stringContaining('"progress":92.5'),
    );
    splash.reportStartupPhase('database', 0, 'Checking records');
    expect(window.webContents.executeJavaScript).toHaveBeenLastCalledWith(
      expect.stringContaining('"progress":92.5'),
    );
    splash.completeStartup();
    expect(window.webContents.executeJavaScript).toHaveBeenLastCalledWith(
      expect.stringContaining('"progress":100'),
    );
    splash.closeSplashWindow();
    expect(window.close).toHaveBeenCalledOnce();
  });
});
