import { vi, describe, it, expect, beforeEach } from 'vitest';
import path from 'path';

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: vi.fn(() => '/tmp/test-userdata'),
  },
}));

let mod: typeof import('./platform');

describe('platform utils', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.doMock('electron', () => ({
      app: {
        isPackaged: false,
        getPath: vi.fn(() => '/tmp/test-userdata'),
      },
    }));
    mod = await import('./platform');
  });

  describe('PLATFORM and ARCHITECTURE constants', () => {
    it('exports PLATFORM matching process.platform', () => {
      expect(mod.PLATFORM).toBe(process.platform);
    });

    it('exports ARCHITECTURE matching process.arch', () => {
      expect(mod.ARCHITECTURE).toBe(process.arch);
    });
  });

  describe('platform boolean exports', () => {
    it('isMac is true only on darwin', () => {
      expect(mod.isMac).toBe(process.platform === 'darwin');
    });

    it('isWindows is true only on win32', () => {
      expect(mod.isWindows).toBe(process.platform === 'win32');
    });

    it('isLinux is true only on linux', () => {
      expect(mod.isLinux).toBe(process.platform === 'linux');
    });

    it('at most one of isMac/isWindows/isLinux is true', () => {
      const trueCount = [mod.isMac, mod.isWindows, mod.isLinux].filter(Boolean).length;
      expect(trueCount).toBeLessThanOrEqual(1);
    });
  });

  describe('isPackaged', () => {
    it('reflects app.isPackaged (false in dev)', () => {
      expect(mod.isPackaged).toBe(false);
    });

    it('reflects app.isPackaged when true', async () => {
      vi.resetModules();
      vi.doMock('electron', () => ({
        app: {
          isPackaged: true,
          getPath: vi.fn(() => '/tmp/test-userdata'),
        },
      }));
      const packaged = await import('./platform');
      expect(packaged.isPackaged).toBe(true);
    });
  });

  describe('getResourcePath()', () => {
    it('returns path relative to __dirname when not packaged', () => {
      const result = mod.getResourcePath();
      expect(result).toBe(path.join(__dirname, '..', '..'));
    });

    it('returns process.resourcesPath when packaged', async () => {
      vi.resetModules();
      vi.doMock('electron', () => ({
        app: {
          isPackaged: true,
          getPath: vi.fn(() => '/tmp/test-userdata'),
        },
      }));
      const originalResourcesPath = process.resourcesPath;
      Object.defineProperty(process, 'resourcesPath', {
        value: '/Applications/app/Contents/Resources',
        configurable: true,
        writable: true,
      });
      const packaged = await import('./platform');
      expect(packaged.getResourcePath()).toBe('/Applications/app/Contents/Resources');
      Object.defineProperty(process, 'resourcesPath', {
        value: originalResourcesPath,
        configurable: true,
        writable: true,
      });
    });
  });

  describe('getAppPath()', () => {
    it('returns path relative to __dirname when not packaged', () => {
      const result = mod.getAppPath();
      expect(result).toBe(path.join(__dirname, '..', '..'));
    });

    it('returns resourcesPath/app.asar when packaged', async () => {
      vi.resetModules();
      vi.doMock('electron', () => ({
        app: {
          isPackaged: true,
          getPath: vi.fn(() => '/tmp/test-userdata'),
        },
      }));
      Object.defineProperty(process, 'resourcesPath', {
        value: '/Applications/app/Contents/Resources',
        configurable: true,
        writable: true,
      });
      const packaged = await import('./platform');
      expect(packaged.getAppPath()).toBe('/Applications/app/Contents/Resources/app.asar');
      Object.defineProperty(process, 'resourcesPath', {
        value: undefined,
        configurable: true,
        writable: true,
      });
    });
  });

  describe('getUserDataPath()', () => {
    it('delegates to app.getPath("userData")', async () => {
      vi.resetModules();
      const getPath = vi.fn((name: string) => {
        if (name === 'userData') return '/custom/userdata';
        return '/tmp';
      });
      vi.doMock('electron', () => ({
        app: { isPackaged: false, getPath },
      }));
      const freshMod = await import('./platform');
      expect(freshMod.getUserDataPath()).toBe('/custom/userdata');
      expect(getPath).toHaveBeenCalledWith('userData');
    });
  });

  describe('getPythonExecutablePath()', () => {
    it('returns env/bin/python3 on non-Windows platform', async () => {
      if (process.platform === 'win32') return;
      const result = mod.getPythonExecutablePath();
      expect(result).toContain(path.join('env', 'bin', 'python3'));
    });

    it('returns windows python.exe path when isWindows', async () => {
      vi.resetModules();
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', {
        value: 'win32',
        configurable: true,
      });
      vi.doMock('electron', () => ({
        app: { isPackaged: false, getPath: vi.fn(() => '/tmp/userdata') },
      }));
      const winMod = await import('./platform');
      const result = winMod.getPythonExecutablePath();
      expect(result).toContain(path.join('env', 'python.exe'));
      Object.defineProperty(process, 'platform', {
        value: originalPlatform,
        configurable: true,
      });
    });
  });

  describe('getPipExecutablePath()', () => {
    it('returns env/bin/pip3 on non-Windows platform', async () => {
      if (process.platform === 'win32') return;
      const result = mod.getPipExecutablePath();
      expect(result).toContain(path.join('env', 'bin', 'pip3'));
    });

    it('returns python.exe path on Windows (pip uses python -m pip)', async () => {
      vi.resetModules();
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', {
        value: 'win32',
        configurable: true,
      });
      vi.doMock('electron', () => ({
        app: { isPackaged: false, getPath: vi.fn(() => '/tmp/userdata') },
      }));
      const winMod = await import('./platform');
      const result = winMod.getPipExecutablePath();
      expect(result).toContain(path.join('env', 'python.exe'));
      Object.defineProperty(process, 'platform', {
        value: originalPlatform,
        configurable: true,
      });
    });
  });

  describe('getRuntimeTarget()', () => {
    it('returns darwin-x64', async () => {
      vi.resetModules();
      Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
      Object.defineProperty(process, 'arch', { value: 'x64', configurable: true });
      vi.doMock('electron', () => ({
        app: { isPackaged: false, getPath: vi.fn(() => '/tmp/userdata') },
      }));
      const darwinMod = await import('./platform');
      expect(darwinMod.getRuntimeTarget()).toBe('darwin-x64');
    });

    it('returns darwin-arm64', async () => {
      vi.resetModules();
      Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
      Object.defineProperty(process, 'arch', { value: 'arm64', configurable: true });
      vi.doMock('electron', () => ({
        app: { isPackaged: false, getPath: vi.fn(() => '/tmp/userdata') },
      }));
      const darwinMod = await import('./platform');
      expect(darwinMod.getRuntimeTarget()).toBe('darwin-arm64');
    });

    it('returns linux-x64', async () => {
      vi.resetModules();
      Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
      Object.defineProperty(process, 'arch', { value: 'x64', configurable: true });
      vi.doMock('electron', () => ({
        app: { isPackaged: false, getPath: vi.fn(() => '/tmp/userdata') },
      }));
      const linuxMod = await import('./platform');
      expect(linuxMod.getRuntimeTarget()).toBe('linux-x64');
    });

    it('returns win32-x64 regardless of arch', async () => {
      vi.resetModules();
      Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
      Object.defineProperty(process, 'arch', { value: 'x64', configurable: true });
      vi.doMock('electron', () => ({
        app: { isPackaged: false, getPath: vi.fn(() => '/tmp/userdata') },
      }));
      const winMod = await import('./platform');
      expect(winMod.getRuntimeTarget()).toBe('win32-x64');
    });

    it('throws for unsupported platform/arch combo (linux arm64)', async () => {
      vi.resetModules();
      Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
      Object.defineProperty(process, 'arch', { value: 'arm64', configurable: true });
      vi.doMock('electron', () => ({
        app: { isPackaged: false, getPath: vi.fn(() => '/tmp/userdata') },
      }));
      const linuxMod = await import('./platform');
      expect(() => linuxMod.getRuntimeTarget()).toThrow('Unsupported platform');
    });

    it('throws for completely unknown platform', async () => {
      vi.resetModules();
      Object.defineProperty(process, 'platform', { value: 'freebsd', configurable: true });
      Object.defineProperty(process, 'arch', { value: 'x64', configurable: true });
      vi.doMock('electron', () => ({
        app: { isPackaged: false, getPath: vi.fn(() => '/tmp/userdata') },
      }));
      const unknownMod = await import('./platform');
      expect(() => unknownMod.getRuntimeTarget()).toThrow('Unsupported platform');
    });

    it('includes the platform and arch in the error message', async () => {
      vi.resetModules();
      Object.defineProperty(process, 'platform', { value: 'sunos', configurable: true });
      Object.defineProperty(process, 'arch', { value: 'sparc', configurable: true });
      vi.doMock('electron', () => ({
        app: { isPackaged: false, getPath: vi.fn(() => '/tmp/userdata') },
      }));
      const unknownMod = await import('./platform');
      expect(() => unknownMod.getRuntimeTarget()).toThrow('sunos sparc');
    });
  });
});
