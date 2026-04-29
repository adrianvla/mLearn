import { vi, describe, it, expect, beforeEach } from 'vitest';

const mockExistsSync = vi.fn();
const mockHomedir = vi.fn(() => '/home/testuser');
const mockIpcMainHandle = vi.fn();

vi.mock('fs', () => ({
  default: {
    existsSync: (...args: unknown[]) => mockExistsSync(...args),
  },
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
}));

vi.mock('os', () => ({
  default: {
    homedir: () => mockHomedir(),
  },
  homedir: () => mockHomedir(),
}));

vi.mock('child_process', () => ({
  exec: vi.fn((cmd: string, _opts: unknown, callback: (err: Error | null, result: { stdout: string; stderr: string }) => void) => {
    callback(null, { stdout: '', stderr: '' });
  }),
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: unknown) => mockIpcMainHandle(channel, handler),
  },
}));

const platformMock = { isMac: false, isWindows: false, isLinux: true };

function setPlatform(platform: 'mac' | 'windows' | 'linux'): void {
  platformMock.isMac = platform === 'mac';
  platformMock.isWindows = platform === 'windows';
  platformMock.isLinux = platform === 'linux';
}

describe('browserDetection', () => {
  let detectBrowsers: (customPaths?: string[]) => Promise<import('./browserDetection').BrowserInfo[]>;
  let setupBrowserDetectionIPC: () => void;

  beforeEach(async () => {
    vi.resetModules();
    mockExistsSync.mockReset();
    mockHomedir.mockReturnValue('/home/testuser');
    mockIpcMainHandle.mockReset();

    vi.doMock('../utils/platform', () => ({
      isMac: platformMock.isMac,
      isWindows: platformMock.isWindows,
      isLinux: platformMock.isLinux,
    }));

    const mod = await import('./browserDetection');
    detectBrowsers = mod.detectBrowsers;
    setupBrowserDetectionIPC = mod.setupBrowserDetectionIPC;
  });

  describe('detectBrowsers', () => {
    it('returns empty array when no browsers found', async () => {
      mockExistsSync.mockReturnValue(false);
      const results = await detectBrowsers();
      expect(results).toEqual([]);
    });

    it('does not throw when fs.existsSync throws', async () => {
      mockExistsSync.mockImplementation(() => {
        throw new Error('Permission denied');
      });
      const results = await detectBrowsers();
      expect(results).toEqual([]);
    });

    describe('Linux', () => {
      beforeEach(async () => {
        setPlatform('linux');
        vi.resetModules();
        vi.doMock('../utils/platform', () => ({
          isMac: platformMock.isMac,
          isWindows: platformMock.isWindows,
          isLinux: platformMock.isLinux,
        }));
        const mod = await import('./browserDetection');
        detectBrowsers = mod.detectBrowsers;
        setupBrowserDetectionIPC = mod.setupBrowserDetectionIPC;
      });

      it('detects Google Chrome', async () => {
        mockExistsSync.mockImplementation((p: string) => p === '/usr/bin/google-chrome');
        const results = await detectBrowsers();
        expect(results).toHaveLength(1);
        expect(results[0]).toMatchObject({
          name: 'Google Chrome',
          type: 'chrome',
          path: '/usr/bin/google-chrome',
          isInstalled: true,
        });
        expect(results[0].profilePath).toContain('google-chrome/Default');
      });

      it('detects Firefox', async () => {
        mockExistsSync.mockImplementation((p: string) => p === '/usr/bin/firefox');
        const results = await detectBrowsers();
        expect(results).toHaveLength(1);
        expect(results[0]).toMatchObject({
          name: 'Firefox',
          type: 'firefox',
          path: '/usr/bin/firefox',
          isInstalled: true,
        });
      });

      it('detects Brave Browser', async () => {
        mockExistsSync.mockImplementation((p: string) => p === '/usr/bin/brave');
        const results = await detectBrowsers();
        expect(results).toHaveLength(1);
        expect(results[0]).toMatchObject({
          name: 'Brave Browser',
          type: 'chrome',
          path: '/usr/bin/brave',
          isInstalled: true,
        });
      });

      it('detects Microsoft Edge', async () => {
        mockExistsSync.mockImplementation((p: string) => p === '/usr/bin/microsoft-edge');
        const results = await detectBrowsers();
        expect(results).toHaveLength(1);
        expect(results[0]).toMatchObject({
          name: 'Microsoft Edge',
          type: 'chrome',
          path: '/usr/bin/microsoft-edge',
          isInstalled: true,
        });
      });

      it('detects Vivaldi', async () => {
        mockExistsSync.mockImplementation((p: string) => p === '/usr/bin/vivaldi');
        const results = await detectBrowsers();
        expect(results).toHaveLength(1);
        expect(results[0]).toMatchObject({
          name: 'Vivaldi',
          type: 'chrome',
          path: '/usr/bin/vivaldi',
          isInstalled: true,
        });
      });

      it('detects Opera', async () => {
        mockExistsSync.mockImplementation((p: string) => p === '/usr/bin/opera');
        const results = await detectBrowsers();
        expect(results).toHaveLength(1);
        expect(results[0]).toMatchObject({
          name: 'Opera',
          type: 'chrome',
          path: '/usr/bin/opera',
          isInstalled: true,
        });
      });

      it('detects Zen Browser', async () => {
        mockExistsSync.mockImplementation((p: string) => p === '/usr/bin/zen');
        const results = await detectBrowsers();
        expect(results).toHaveLength(1);
        expect(results[0]).toMatchObject({
          name: 'Zen Browser',
          type: 'firefox',
          path: '/usr/bin/zen',
          isInstalled: true,
        });
      });

      it('detects LibreWolf', async () => {
        mockExistsSync.mockImplementation((p: string) => p === '/usr/bin/librewolf');
        const results = await detectBrowsers();
        expect(results).toHaveLength(1);
        expect(results[0]).toMatchObject({
          name: 'LibreWolf',
          type: 'firefox',
          path: '/usr/bin/librewolf',
          isInstalled: true,
        });
      });

      it('detects Waterfox', async () => {
        mockExistsSync.mockImplementation((p: string) => p === '/usr/bin/waterfox');
        const results = await detectBrowsers();
        expect(results).toHaveLength(1);
        expect(results[0]).toMatchObject({
          name: 'Waterfox',
          type: 'firefox',
          path: '/usr/bin/waterfox',
          isInstalled: true,
        });
      });

      it('detects multiple browsers', async () => {
        mockExistsSync.mockImplementation((p: string) =>
          p === '/usr/bin/google-chrome' || p === '/usr/bin/firefox' || p === '/usr/bin/brave'
        );
        const results = await detectBrowsers();
        expect(results).toHaveLength(3);
        const names = results.map(r => r.name).sort();
        expect(names).toEqual(['Brave Browser', 'Firefox', 'Google Chrome']);
      });

      it('uses chromium fallback when chrome not found', async () => {
        mockExistsSync.mockImplementation((p: string) => p === '/usr/bin/chromium-browser');
        const results = await detectBrowsers();
        expect(results).toHaveLength(1);
        expect(results[0].name).toBe('Google Chrome');
        expect(results[0].path).toBe('/usr/bin/chromium-browser');
      });
    });

    describe('macOS', () => {
      beforeEach(async () => {
        setPlatform('mac');
        vi.resetModules();
        vi.doMock('../utils/platform', () => ({
          isMac: platformMock.isMac,
          isWindows: platformMock.isWindows,
          isLinux: platformMock.isLinux,
        }));
        const mod = await import('./browserDetection');
        detectBrowsers = mod.detectBrowsers;
        setupBrowserDetectionIPC = mod.setupBrowserDetectionIPC;
      });

      it('detects Google Chrome in /Applications', async () => {
        mockExistsSync.mockImplementation((p: string) =>
          p === '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
        );
        const results = await detectBrowsers();
        expect(results).toHaveLength(1);
        expect(results[0]).toMatchObject({
          name: 'Google Chrome',
          type: 'chrome',
          path: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
          isInstalled: true,
        });
      });

      it('detects Arc', async () => {
        mockExistsSync.mockImplementation((p: string) =>
          p === '/Applications/Arc.app/Contents/MacOS/Arc'
        );
        const results = await detectBrowsers();
        expect(results).toHaveLength(1);
        expect(results[0]).toMatchObject({
          name: 'Arc',
          type: 'chrome',
          path: '/Applications/Arc.app/Contents/MacOS/Arc',
          isInstalled: true,
        });
      });

      it('detects Zen Browser', async () => {
        mockExistsSync.mockImplementation((p: string) =>
          p === '/Applications/Zen Browser.app/Contents/MacOS/zen'
        );
        const results = await detectBrowsers();
        expect(results).toHaveLength(1);
        expect(results[0]).toMatchObject({
          name: 'Zen Browser',
          type: 'firefox',
          path: '/Applications/Zen Browser.app/Contents/MacOS/zen',
          isInstalled: true,
        });
      });
    });

    describe('Windows', () => {
      beforeEach(async () => {
        setPlatform('windows');
        process.env.PROGRAMFILES = 'C:\\Program Files';
        process.env['PROGRAMFILES(X86)'] = 'C:\\Program Files (x86)';
        process.env.LOCALAPPDATA = 'C:\\Users\\test\\AppData\\Local';
        process.env.APPDATA = 'C:\\Users\\test\\AppData\\Roaming';
        vi.resetModules();
        vi.doMock('../utils/platform', () => ({
          isMac: platformMock.isMac,
          isWindows: platformMock.isWindows,
          isLinux: platformMock.isLinux,
        }));
        const mod = await import('./browserDetection');
        detectBrowsers = mod.detectBrowsers;
        setupBrowserDetectionIPC = mod.setupBrowserDetectionIPC;
      });

      it('detects Google Chrome', async () => {
        mockExistsSync.mockImplementation((p: string) =>
          p === 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
        );
        const results = await detectBrowsers();
        expect(results).toHaveLength(1);
        expect(results[0]).toMatchObject({
          name: 'Google Chrome',
          type: 'chrome',
          path: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
          isInstalled: true,
        });
      });

      it('detects Microsoft Edge', async () => {
        mockExistsSync.mockImplementation((p: string) =>
          p === 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
        );
        const results = await detectBrowsers();
        expect(results).toHaveLength(1);
        expect(results[0]).toMatchObject({
          name: 'Microsoft Edge',
          type: 'chrome',
          path: 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
          isInstalled: true,
        });
      });

      it('detects Waterfox', async () => {
        mockExistsSync.mockImplementation((p: string) =>
          p === 'C:\\Program Files\\Waterfox\\waterfox.exe'
        );
        const results = await detectBrowsers();
        expect(results).toHaveLength(1);
        expect(results[0]).toMatchObject({
          name: 'Waterfox',
          type: 'firefox',
          path: 'C:\\Program Files\\Waterfox\\waterfox.exe',
          isInstalled: true,
        });
      });
    });

    describe('custom paths', () => {
      beforeEach(() => {
        setPlatform('linux');
      });

      it('detects browser at custom path', async () => {
        mockExistsSync.mockImplementation((p: string) => p === '/opt/mybrowser/browser');
        const results = await detectBrowsers(['/opt/mybrowser/browser']);
        expect(results).toHaveLength(1);
        expect(results[0]).toMatchObject({
          name: 'browser',
          type: 'unknown',
          path: '/opt/mybrowser/browser',
          isInstalled: true,
        });
      });

      it('ignores non-existent custom paths', async () => {
        mockExistsSync.mockReturnValue(false);
        const results = await detectBrowsers(['/nonexistent/browser']);
        expect(results).toEqual([]);
      });

      it('deduplicates custom paths', async () => {
        mockExistsSync.mockImplementation((p: string) => p === '/opt/mybrowser/browser');
        const results = await detectBrowsers([
          '/opt/mybrowser/browser',
          '/opt/mybrowser/browser',
        ]);
        expect(results).toHaveLength(1);
      });

      it('combines custom paths with known browsers', async () => {
        mockExistsSync.mockImplementation((p: string) =>
          p === '/opt/custom/browser' || p === '/usr/bin/firefox'
        );
        const results = await detectBrowsers(['/opt/custom/browser']);
        expect(results).toHaveLength(2);
        const names = results.map(r => r.name).sort();
        expect(names).toEqual(['Firefox', 'browser']);
      });
    });
  });

  describe('setupBrowserDetectionIPC', () => {
    it('registers DETECT_BROWSERS handler', () => {
      setupBrowserDetectionIPC();
      expect(mockIpcMainHandle).toHaveBeenCalledWith('detect-browsers', expect.any(Function));
    });

    it('handler returns browser list', async () => {
      setPlatform('linux');
      mockExistsSync.mockImplementation((p: string) => p === '/usr/bin/firefox');
      setupBrowserDetectionIPC();
      const [, handler] = mockIpcMainHandle.mock.calls[0];
      const result = await handler({}, undefined);
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Firefox');
    });

    it('handler passes custom paths', async () => {
      setPlatform('linux');
      mockExistsSync.mockImplementation((p: string) => p === '/opt/custom/browser');
      setupBrowserDetectionIPC();
      const [, handler] = mockIpcMainHandle.mock.calls[0];
      const result = await handler({}, ['/opt/custom/browser']);
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('browser');
    });
  });
});
