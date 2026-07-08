import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createTempDir, type TempDir } from '../../../test/helpers/tempDir';
import path from 'path';
import fs from 'fs';

const mockIpcListeners = new Map<string, ((...args: unknown[]) => void)[]>();

vi.mock('electron', () => ({
  ipcMain: {
    on: vi.fn((channel: string, handler: (...args: unknown[]) => void) => {
      const existing = mockIpcListeners.get(channel) || [];
      existing.push(handler);
      mockIpcListeners.set(channel, existing);
    }),
    handle: vi.fn(),
    removeHandler: vi.fn(),
  },
  app: {
    getVersion: vi.fn(() => '1.0.0'),
  },
}));

const mockSpawn = vi.fn();
const mockExec = vi.fn();
const mockExecSync = vi.fn(() => '');
const mockPlatformPaths = vi.hoisted(() => ({
  resourcePath: '/tmp/test-resources',
  appPath: '/tmp/test-resources',
  pythonExecutablePath: '/tmp/test-resources/env/bin/python3',
  pipExecutablePath: '/tmp/test-resources/env/bin/pip',
}));

vi.mock('child_process', () => ({
  spawn: mockSpawn,
  exec: mockExec,
  execSync: mockExecSync,
  ChildProcess: class {},
}));

const mockTarExtract = vi.fn(() => Promise.resolve());
vi.mock('tar', () => ({
  x: mockTarExtract,
}));

vi.mock('../utils/platform', () => ({
  getResourcePath: vi.fn(() => mockPlatformPaths.resourcePath),
  getAppPath: vi.fn(() => mockPlatformPaths.appPath),
  getUserDataPath: vi.fn(() => '/tmp/test-userdata'),
  getPythonExecutablePath: vi.fn(() => mockPlatformPaths.pythonExecutablePath),
  getPipExecutablePath: vi.fn(() => mockPlatformPaths.pipExecutablePath),
  getPythonDownloadUrl: vi.fn(() => 'https://example.com/python.tar.gz'),
  getBundledDistElectronPath: vi.fn((...segments: string[]) => path.join(process.cwd(), 'src/root-of-app', ...segments)),
  isPackaged: false,
  isWindows: false,
}));

const mockGetCurrentWindow = vi.fn();
const mockGetMainWindow = vi.fn();

vi.mock('./windowManager', () => ({
  getCurrentWindow: mockGetCurrentWindow,
  getMainWindow: mockGetMainWindow,
}));

let mockInstalledLanguageData: Record<string, any> = {
  ja: {
    name: 'Japanese',
    translatable: [],
    colour_codes: {},
    settings: { fixed: {} },
  },
};
const mockHasSettingsFile = vi.fn(() => false);
const mockLoadSettings = vi.fn(() => ({
  language: 'ja',
  uiLanguage: 'en',
  dictionaryTargetLanguages: {},
  llmEnabled: true,
  ocrEnabled: true,
}));

vi.mock('./settings', () => ({
  hasSettingsFile: mockHasSettingsFile,
  loadSettings: mockLoadSettings,
  loadLangData: vi.fn(() => mockInstalledLanguageData),
}));

const mockGetLanguageDataRoot = vi.fn(() => '/tmp/test-userdata/language-data');

vi.mock('./languageDataService', () => ({
  getLanguageDataRoot: mockGetLanguageDataRoot,
}));

type MockReqCallbacks = Record<string, ((...args: unknown[]) => void)[]>;

interface MockHttpReq {
  write: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  _callbacks: MockReqCallbacks;
}

interface MockHttpRes {
  statusCode: number;
  headers: Record<string, string>;
  on: ReturnType<typeof vi.fn>;
  resume: ReturnType<typeof vi.fn>;
  pipe: ReturnType<typeof vi.fn>;
  _callbacks: MockReqCallbacks;
}

function createMockHttpRes(statusCode: number): MockHttpRes {
  const callbacks: MockReqCallbacks = {};
  const res: MockHttpRes = {
    statusCode,
    headers: {},
    on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
      callbacks[event] = callbacks[event] ?? [];
      callbacks[event].push(cb);
      return res;
    }),
    resume: vi.fn(),
    pipe: vi.fn(),
    _callbacks: callbacks,
  } as unknown as MockHttpRes;
  return res;
}

function createMockHttpReq(): MockHttpReq {
  const callbacks: MockReqCallbacks = {};
  const req: MockHttpReq = {
    write: vi.fn(),
    end: vi.fn(),
    destroy: vi.fn(),
    on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
      callbacks[event] = callbacks[event] ?? [];
      callbacks[event].push(cb);
      return req;
    }),
    _callbacks: callbacks,
  } as unknown as MockHttpReq;
  return req;
}

const mockHttpRequest = vi.fn();
vi.mock('http', () => ({
  default: {
    request: mockHttpRequest,
  },
}));

const mockHttpsGet = vi.fn();
vi.mock('https', () => ({
  default: {
    get: mockHttpsGet,
  },
  get: mockHttpsGet,
}));

const mockWriteStream = {
  on: vi.fn(),
  destroy: vi.fn(),
  close: vi.fn(),
};
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    default: {
      ...actual,
      createWriteStream: vi.fn(() => mockWriteStream),
    },
    createWriteStream: vi.fn(() => mockWriteStream),
  };
});

const originalNodeEnv = process.env.NODE_ENV;

describe('pythonBackend', () => {
  let mod: typeof import('./pythonBackend');
  let tempDir: TempDir;

  beforeEach(async () => {
    tempDir = createTempDir('mlearn-python-test-');
    mockIpcListeners.clear();
    vi.clearAllMocks();
    vi.resetModules();

    Object.defineProperty(process, 'resourcesPath', {
      value: '/tmp/test-resources',
      writable: true,
      configurable: true,
    });

    mockGetCurrentWindow.mockReturnValue(null);
    mockGetMainWindow.mockReturnValue(null);
    mockHasSettingsFile.mockReturnValue(false);
    mockLoadSettings.mockReset();
    mockLoadSettings.mockReturnValue({
      language: 'ja',
      uiLanguage: 'en',
      dictionaryTargetLanguages: {},
      llmEnabled: true,
      ocrEnabled: true,
    });
    mockPlatformPaths.resourcePath = '/tmp/test-resources';
    mockPlatformPaths.appPath = '/tmp/test-resources';
    mockPlatformPaths.pythonExecutablePath = '/tmp/test-resources/env/bin/python3';
    mockPlatformPaths.pipExecutablePath = '/tmp/test-resources/env/bin/pip';
    mockInstalledLanguageData = {
      ja: {
        name: 'Japanese',
        translatable: [],
        colour_codes: {},
        settings: { fixed: {} },
      },
    };

    fs.rmSync('/tmp/test-userdata', { recursive: true, force: true });
    fs.mkdirSync('/tmp/test-userdata', { recursive: true });
    fs.writeFileSync('/tmp/test-userdata/python-version.txt', '1.0.0');

    mod = await import('./pythonBackend');
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    process.env.NODE_ENV = originalNodeEnv;
    tempDir.cleanup();
  });

  describe('isServerLoaded', () => {
    it('returns false initially', () => {
      expect(mod.isServerLoaded()).toBe(false);
    });
  });

  describe('pip requirements', () => {
    it('keeps core backend requirements free of language-specific tokenizer packages', () => {
      const requirements = JSON.parse(mod.readResourceFile('pip_requirements.json')) as {
        core: string[];
      };

      expect(requirements.core).not.toContain('spacy');
      expect(requirements.core).not.toContain('sudachipy');
      expect(requirements.core).not.toContain('sudachidict_core');
      expect(requirements.core).not.toContain('jaconv');
      expect(requirements.core).not.toContain('fugashi');
      expect(requirements.core).not.toContain('unidic-lite');
    });

    it('keeps base OCR requirements free of concrete language OCR engines', () => {
      const requirements = JSON.parse(mod.readResourceFile('pip_requirements.json')) as {
        ocr: string[];
      };

      expect(requirements.ocr).not.toContain('manga-ocr');
      expect(requirements.ocr).not.toContain('paddleocr>=2.7.3');
      expect(requirements.ocr).not.toContain('paddlepaddle==3.2.2');
      expect(requirements.ocr).not.toContain('rapidocr');
    });

    it('adds installed language-declared OCR requirements to pip install when OCR is selected', async () => {
      mockInstalledLanguageData = {
        ja: {
          name: 'Japanese',
          translatable: [],
          colour_codes: {},
          settings: { fixed: {} },
          runtime: {
            python: {
              packagesByComponent: {
                ocr: ['ja-ocr-engine', 'ja-ocr-runtime'],
              },
            },
          },
        },
      };
      vi.resetModules();
      mod = await import('./pythonBackend');

      const mockWebContents = { send: vi.fn() };
      mockGetCurrentWindow.mockReturnValue({ webContents: mockWebContents });

      mockHttpsGet.mockImplementation((_url: string, callback: (res: MockHttpRes) => void) => {
        callback(createMockHttpRes(200));
        return createMockHttpReq();
      });
      mockWriteStream.close.mockImplementation((callback?: () => void) => {
        callback?.();
      });
      mockTarExtract.mockImplementationOnce(async (options: { cwd: string }) => {
        const binDir = path.join(options.cwd, 'python-runtime', 'bin');
        fs.mkdirSync(binDir, { recursive: true });
        fs.writeFileSync(path.join(binDir, 'pip3'), '');
        fs.writeFileSync(path.join(binDir, 'python3'), '');
      });
      mockSpawn.mockReturnValue({
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        on: vi.fn(),
        kill: vi.fn(),
        killed: false,
      });

      await mod.startPythonInstall({ includeLLM: false, includeOCR: true, includeVoice: false });
      fs.writeFileSync('/tmp/test-userdata/python.tar.gz', 'archive');
      const finishHandler = mockWriteStream.on.mock.calls.find((call) => call[0] === 'finish')?.[1] as (() => void) | undefined;
      expect(finishHandler).toBeDefined();
      finishHandler?.();
      await new Promise((resolve) => setTimeout(resolve, 0));

      const pipInstallCall = mockSpawn.mock.calls.find((call) => (
        Array.isArray(call[1]) && call[1][0] === 'install'
      ));
      expect(pipInstallCall?.[1]).toEqual(expect.arrayContaining([
        'ja-ocr-engine',
        'ja-ocr-runtime',
      ]));
    });
  });

  describe('getPythonProcess', () => {
    it('returns null initially', () => {
      expect(mod.getPythonProcess()).toBeNull();
    });
  });

  describe('findPython', () => {
    it('returns false and sets waiting when python not found', async () => {
      vi.spyOn(process, 'cwd').mockReturnValue(path.join(tempDir.tmpDir, 'repo-without-runtime'));

      const result = await mod.findPython();
      expect(result).toBe(false);
    });

    it('returns true when python exists under resourcesPath', async () => {
      const envBin = path.join(tempDir.tmpDir, 'env', 'bin');
      fs.mkdirSync(envBin, { recursive: true });
      fs.writeFileSync(path.join(envBin, 'python3'), '');

      Object.defineProperty(process, 'resourcesPath', {
        value: tempDir.tmpDir,
        writable: true,
        configurable: true,
      });

      const mockProcess = {
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
          if (event === 'close') {
            handler(0);
          }
        }),
        kill: vi.fn(),
        killed: false,
      };
      mockSpawn.mockReturnValue(mockProcess);

      vi.resetModules();
      mod = await import('./pythonBackend');

      const result = await mod.findPython();
      expect(result).toBe(true);
    });

    it('uses the platform Python path when the raw resource path does not contain an env', async () => {
      const helperEnvBin = path.join(tempDir.tmpDir, 'dev-runtime', 'env', 'bin');
      fs.mkdirSync(helperEnvBin, { recursive: true });
      mockPlatformPaths.resourcePath = path.join(tempDir.tmpDir, 'compiled-output');
      mockPlatformPaths.pythonExecutablePath = path.join(helperEnvBin, 'python3');
      fs.writeFileSync(mockPlatformPaths.pythonExecutablePath, '');

      Object.defineProperty(process, 'resourcesPath', {
        value: path.join(tempDir.tmpDir, 'electron-framework-resources'),
        writable: true,
        configurable: true,
      });

      const backendMockProcess = {
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        on: vi.fn(),
        kill: vi.fn(),
        killed: false,
      };

      mockSpawn.mockImplementation((cmd: string, args: string[]) => {
        if (args[0] === '--version') {
          return {
            stdout: { on: vi.fn() },
            stderr: { on: vi.fn() },
            on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
              if (event === 'close') handler(0);
            }),
            kill: vi.fn(),
            killed: false,
          };
        }
        return backendMockProcess;
      });

      vi.resetModules();
      mod = await import('./pythonBackend');

      const result = await mod.findPython();

      expect(result).toBe(true);
      expect(mockSpawn).toHaveBeenCalledWith(mockPlatformPaths.pythonExecutablePath, ['--version'], { timeout: 5000 });
      expect(mockSpawn.mock.calls.some((call) => call[0] === '/bin/sh')).toBe(true);
    });

    it('uses the repo dist-electron Python path when dev resource paths drift', async () => {
      const repoRoot = path.join(tempDir.tmpDir, 'repo');
      const repoEnvBin = path.join(repoRoot, 'dist-electron', 'env', 'bin');
      const repoPythonPath = path.join(repoEnvBin, 'python3');
      fs.mkdirSync(repoEnvBin, { recursive: true });
      fs.writeFileSync(repoPythonPath, '');

      mockPlatformPaths.resourcePath = path.join(tempDir.tmpDir, 'compiled-output');
      mockPlatformPaths.pythonExecutablePath = path.join(tempDir.tmpDir, 'missing-runtime', 'env', 'bin', 'python3');
      vi.spyOn(process, 'cwd').mockReturnValue(repoRoot);
      process.env.NODE_ENV = 'development';

      Object.defineProperty(process, 'resourcesPath', {
        value: path.join(tempDir.tmpDir, 'electron-framework-resources'),
        writable: true,
        configurable: true,
      });

      mockSpawn.mockImplementation((cmd: string, args: string[]) => {
        if (args[0] === '--version') {
          return {
            stdout: { on: vi.fn() },
            stderr: { on: vi.fn() },
            on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
              if (event === 'close') handler(0);
            }),
            kill: vi.fn(),
            killed: false,
          };
        }
        return {
          stdout: { on: vi.fn() },
          stderr: { on: vi.fn() },
          on: vi.fn(),
          kill: vi.fn(),
          killed: false,
        };
      });

      vi.resetModules();
      mod = await import('./pythonBackend');

      const result = await mod.findPython();

      expect(result).toBe(true);
      expect(mockSpawn).toHaveBeenCalledWith(repoPythonPath, ['--version'], { timeout: 5000 });
      const backendStartCall = mockSpawn.mock.calls.find((call) => call[0] === '/bin/sh');
      expect(backendStartCall?.[1]).toEqual(expect.arrayContaining([
        expect.stringContaining(`exec env '${repoPythonPath}'`),
      ]));
    });

    it('prefers source backend files over stale dist-electron copies in development', async () => {
      const repoRoot = path.join(tempDir.tmpDir, 'repo');
      const distDir = path.join(repoRoot, 'dist-electron');
      const srcBackendDir = path.join(repoRoot, 'src', 'root-of-app');
      const repoEnvBin = path.join(distDir, 'env', 'bin');
      const repoPythonPath = path.join(repoEnvBin, 'python3');
      const sourceServerPath = path.join(srcBackendDir, 'server.py');
      const staleServerPath = path.join(distDir, 'server.py');
      fs.mkdirSync(repoEnvBin, { recursive: true });
      fs.mkdirSync(srcBackendDir, { recursive: true });
      fs.writeFileSync(repoPythonPath, '');
      fs.writeFileSync(sourceServerPath, '# source backend');
      fs.writeFileSync(staleServerPath, '# stale backend');

      mockPlatformPaths.resourcePath = distDir;
      mockPlatformPaths.pythonExecutablePath = path.join(tempDir.tmpDir, 'missing-runtime', 'env', 'bin', 'python3');
      vi.spyOn(process, 'cwd').mockReturnValue(repoRoot);
      process.env.NODE_ENV = 'development';

      mockSpawn.mockImplementation((_cmd: string, args: string[]) => {
        if (args[0] === '--version') {
          return {
            stdout: { on: vi.fn() },
            stderr: { on: vi.fn() },
            on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
              if (event === 'close') handler(0);
            }),
            kill: vi.fn(),
            killed: false,
          };
        }
        return {
          stdout: { on: vi.fn() },
          stderr: { on: vi.fn() },
          on: vi.fn(),
          kill: vi.fn(),
          killed: false,
        };
      });

      vi.resetModules();
      mod = await import('./pythonBackend');

      const result = await mod.findPython();

      expect(result).toBe(true);
      const backendStartCall = mockSpawn.mock.calls.find((call) => call[0] === '/bin/sh');
      expect(backendStartCall?.[1]).toEqual(expect.arrayContaining([
        expect.stringContaining(sourceServerPath),
      ]));
      expect(backendStartCall?.[1]).toEqual(expect.arrayContaining([
        expect.not.stringContaining(staleServerPath),
      ]));
    });

    it('uses the repo dist-electron Python path even when NODE_ENV is not set', async () => {
      const repoRoot = path.join(tempDir.tmpDir, 'repo');
      const repoEnvBin = path.join(repoRoot, 'dist-electron', 'env', 'bin');
      const repoPythonPath = path.join(repoEnvBin, 'python3');
      fs.mkdirSync(repoEnvBin, { recursive: true });
      fs.writeFileSync(repoPythonPath, '');

      mockPlatformPaths.resourcePath = path.join(tempDir.tmpDir, 'compiled-output');
      mockPlatformPaths.pythonExecutablePath = path.join(tempDir.tmpDir, 'missing-runtime', 'env', 'bin', 'python3');
      vi.spyOn(process, 'cwd').mockReturnValue(repoRoot);
      delete process.env.NODE_ENV;

      Object.defineProperty(process, 'resourcesPath', {
        value: path.join(tempDir.tmpDir, 'electron-framework-resources'),
        writable: true,
        configurable: true,
      });

      mockSpawn.mockImplementation((cmd: string, args: string[]) => {
        if (args[0] === '--version') {
          return {
            stdout: { on: vi.fn() },
            stderr: { on: vi.fn() },
            on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
              if (event === 'close') handler(0);
            }),
            kill: vi.fn(),
            killed: false,
          };
        }
        return {
          stdout: { on: vi.fn() },
          stderr: { on: vi.fn() },
          on: vi.fn(),
          kill: vi.fn(),
          killed: false,
        };
      });

      vi.resetModules();
      mod = await import('./pythonBackend');

      const result = await mod.findPython();

      expect(result).toBe(true);
      expect(mockSpawn).toHaveBeenCalledWith(repoPythonPath, ['--version'], { timeout: 5000 });
    });

    it('starts with installed language data without downloading language bundles', async () => {
      const envBin = path.join(tempDir.tmpDir, 'env', 'bin');
      fs.mkdirSync(envBin, { recursive: true });
      fs.writeFileSync(path.join(envBin, 'python3'), '');

      Object.defineProperty(process, 'resourcesPath', {
        value: tempDir.tmpDir,
        writable: true,
        configurable: true,
      });

      const backendMockProcess = {
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        on: vi.fn(),
        kill: vi.fn(),
        killed: false,
      };

      mockSpawn.mockImplementation((_cmd: string, args: string[]) => {
        if (args[0] === '--version') {
          return {
            stdout: { on: vi.fn() },
            stderr: { on: vi.fn() },
            on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
              if (event === 'close') handler(0);
            }),
            kill: vi.fn(),
            killed: false,
          };
        }
        return backendMockProcess;
      });

      vi.resetModules();
      mod = await import('./pythonBackend');

      await mod.findPython();

      const backendSpawn = mockSpawn.mock.calls.find((call) => call[0] === '/bin/sh');
      expect(backendSpawn?.[1]).toEqual(expect.arrayContaining([
        expect.stringContaining('/tmp/test-userdata/language-data'),
      ]));
      expect(backendSpawn?.[2]).toEqual(expect.objectContaining({
        env: expect.objectContaining({
          MLEARN_DICTIONARY_TARGET_LANGUAGES_JSON: '{}',
        }),
      }));
      expect((backendSpawn?.[2] as { env?: Record<string, string> } | undefined)?.env?.MLEARN_DICTIONARY_TARGET_LANGUAGE).toBeUndefined();
    });

    it('passes an explicit per-language dictionary target to the backend environment', async () => {
      const envBin = path.join(tempDir.tmpDir, 'env', 'bin');
      fs.mkdirSync(envBin, { recursive: true });
      fs.writeFileSync(path.join(envBin, 'python3'), '');
      mockLoadSettings.mockReturnValue({
        language: 'ja',
        uiLanguage: 'en',
        dictionaryTargetLanguages: { ja: 'fr' },
        llmEnabled: true,
        ocrEnabled: true,
      });

      Object.defineProperty(process, 'resourcesPath', {
        value: tempDir.tmpDir,
        writable: true,
        configurable: true,
      });

      const backendMockProcess = {
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        on: vi.fn(),
        kill: vi.fn(),
        killed: false,
      };

      mockSpawn.mockImplementation((_cmd: string, args: string[]) => {
        if (args[0] === '--version') {
          return {
            stdout: { on: vi.fn() },
            stderr: { on: vi.fn() },
            on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
              if (event === 'close') handler(0);
            }),
            kill: vi.fn(),
            killed: false,
          };
        }
        return backendMockProcess;
      });

      vi.resetModules();
      mod = await import('./pythonBackend');

      await mod.findPython();

      const backendSpawn = mockSpawn.mock.calls.find((call) => call[0] === '/bin/sh');
      expect(backendSpawn?.[2]).toEqual(expect.objectContaining({
        env: expect.objectContaining({
          MLEARN_DICTIONARY_TARGET_LANGUAGES_JSON: '{"ja":"fr"}',
          MLEARN_DICTIONARY_TARGET_LANGUAGE: 'fr',
        }),
      }));
    });

    it('starts the backend when selected language data is missing so the app can install it', async () => {
      const envBin = path.join(tempDir.tmpDir, 'env', 'bin');
      fs.mkdirSync(envBin, { recursive: true });
      fs.writeFileSync(path.join(envBin, 'python3'), '');
      mockInstalledLanguageData = {};

      Object.defineProperty(process, 'resourcesPath', {
        value: tempDir.tmpDir,
        writable: true,
        configurable: true,
      });

      const statusMessages: string[] = [];
      const statusWindow = {
        webContents: {
          send: vi.fn((_channel: string, message: string) => {
            statusMessages.push(message);
          }),
        },
      };
      mockGetCurrentWindow.mockReturnValue(statusWindow);
      mockGetMainWindow.mockReturnValue(statusWindow);

      mockSpawn.mockImplementation((_cmd: string, args: string[]) => {
        if (args[0] === '--version') {
          return {
            stdout: { on: vi.fn() },
            stderr: { on: vi.fn() },
            on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
              if (event === 'close') handler(0);
            }),
            kill: vi.fn(),
            killed: false,
          };
        }
        return {
          stdout: { on: vi.fn() },
          stderr: { on: vi.fn() },
          on: vi.fn(),
          kill: vi.fn(),
          killed: false,
        };
      });

      vi.resetModules();
      mod = await import('./pythonBackend');

      const result = await mod.findPython();

      expect(result).toBe(true);
      expect(mockSpawn.mock.calls.filter((call) => call[0] === '/bin/sh')).toHaveLength(1);
      expect(statusMessages.some((message) => message.includes('Language data is not installed for ja'))).toBe(true);
    });

    it('marks the backend loaded when the health endpoint is ready', async () => {
      vi.useFakeTimers();
      const envBin = path.join(tempDir.tmpDir, 'env', 'bin');
      fs.mkdirSync(envBin, { recursive: true });
      fs.writeFileSync(path.join(envBin, 'python3'), '');

      Object.defineProperty(process, 'resourcesPath', {
        value: tempDir.tmpDir,
        writable: true,
        configurable: true,
      });

      const webContents = { send: vi.fn() };
      mockGetMainWindow.mockReturnValue({ webContents });

      mockSpawn.mockImplementation((_cmd: string, args: string[]) => {
        if (args[0] === '--version') {
          return {
            stdout: { on: vi.fn() },
            stderr: { on: vi.fn() },
            on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
              if (event === 'close') handler(0);
            }),
            kill: vi.fn(),
            killed: false,
          };
        }
        return {
          stdout: { on: vi.fn() },
          stderr: { on: vi.fn() },
          on: vi.fn(),
          kill: vi.fn(),
          killed: false,
        };
      });

      mockHttpRequest.mockImplementation((options, callback) => {
        const req = createMockHttpReq();
        req.end.mockImplementation(() => {
          const res = createMockHttpRes(200);
          callback(res);
          res._callbacks.data?.forEach((handler) => handler(Buffer.from('{"status":"ok"}')));
          res._callbacks.end?.forEach((handler) => handler());
        });
        return req;
      });

      vi.resetModules();
      mod = await import('./pythonBackend');

      await mod.findPython();
      await vi.advanceTimersByTimeAsync(750);

      expect(mockHttpRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          path: '/health',
          method: 'GET',
        }),
        expect.any(Function),
      );
      expect(webContents.send).toHaveBeenCalledWith('server-load', 'Python server running');
    });

    it('sends INSTALLER_AWAITING_CHOICE when python not found', async () => {
      vi.spyOn(process, 'cwd').mockReturnValue(path.join(tempDir.tmpDir, 'repo-without-runtime'));
      const mockWebContents = { send: vi.fn() };
      mockGetCurrentWindow.mockReturnValue({ webContents: mockWebContents });

      await mod.findPython();

      expect(mockWebContents.send).toHaveBeenCalledWith('installer-awaiting-choice');
    });

    it('reuses a healthy userData Python runtime on app update when settings already exist', async () => {
      const envBin = path.join('/tmp/test-userdata', 'env', 'bin');
      fs.mkdirSync(envBin, { recursive: true });
      fs.writeFileSync(path.join(envBin, 'python3'), '');
      fs.writeFileSync('/tmp/test-userdata/python-version.txt', '0.9.0', 'utf-8');
      mockHasSettingsFile.mockReturnValue(true);

      const mockWebContents = { send: vi.fn() };
      mockGetCurrentWindow.mockReturnValue({ webContents: mockWebContents });
      const backendMockProcess = {
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        on: vi.fn(),
        kill: vi.fn(),
        killed: false,
      };

      mockSpawn.mockImplementation((_cmd: string, args: string[]) => {
        if (args[0] === '--version') {
          return {
            stdout: { on: vi.fn() },
            stderr: { on: vi.fn() },
            on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
              if (event === 'close') handler(0);
            }),
            kill: vi.fn(),
            killed: false,
          };
        }
        return backendMockProcess;
      });

      vi.resetModules();
      mod = await import('./pythonBackend');

      const result = await mod.findPython();

      expect(result).toBe(true);
      expect(mockWebContents.send).not.toHaveBeenCalledWith('installer-awaiting-choice');
      expect(fs.readFileSync('/tmp/test-userdata/python-version.txt', 'utf-8')).toBe('1.0.0');
    });

    it('keeps showing installer on app update when no settings profile exists', async () => {
      const envBin = path.join('/tmp/test-userdata', 'env', 'bin');
      fs.mkdirSync(envBin, { recursive: true });
      fs.writeFileSync(path.join(envBin, 'python3'), '');
      fs.writeFileSync('/tmp/test-userdata/python-version.txt', '0.9.0', 'utf-8');

      const mockWebContents = { send: vi.fn() };
      mockGetCurrentWindow.mockReturnValue({ webContents: mockWebContents });
      mockSpawn.mockImplementation((_cmd: string, args: string[]) => {
        if (args[0] === '--version') {
          return {
            stdout: { on: vi.fn() },
            stderr: { on: vi.fn() },
            on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
              if (event === 'close') handler(0);
            }),
            kill: vi.fn(),
            killed: false,
          };
        }
        return {
          stdout: { on: vi.fn() },
          stderr: { on: vi.fn() },
          on: vi.fn(),
          kill: vi.fn(),
          killed: false,
        };
      });

      vi.resetModules();
      mod = await import('./pythonBackend');

      const result = await mod.findPython();

      expect(result).toBe(false);
      expect(mockWebContents.send).toHaveBeenCalledWith('installer-awaiting-choice');
    });
  });

  describe('startPythonInstall', () => {
    it('does nothing when install is already in progress', () => {
      const mockWebContents = { send: vi.fn() };
      mockGetCurrentWindow.mockReturnValue({ webContents: mockWebContents });

      mockHttpsGet.mockReturnValue(createMockHttpReq());

      mod.startPythonInstall({ includeLLM: true, includeOCR: true, includeVoice: true });
      const sendCount = mockWebContents.send.mock.calls.length;
      mod.startPythonInstall({ includeLLM: true, includeOCR: true, includeVoice: true });

      expect(mockWebContents.send.mock.calls.length).toBe(sendCount);
    });

    it('sends INSTALL_STARTED with options', async () => {
      const mockWebContents = { send: vi.fn() };
      mockGetCurrentWindow.mockReturnValue({ webContents: mockWebContents });

      mockHttpsGet.mockReturnValue(createMockHttpReq());

      const options = { includeLLM: false, includeOCR: true, includeVoice: false };
      await mod.startPythonInstall(options);

      expect(mockWebContents.send).toHaveBeenCalledWith('install-started', options);
    });

    it('initiates https download', async () => {
      const mockWebContents = { send: vi.fn() };
      mockGetCurrentWindow.mockReturnValue({ webContents: mockWebContents });

      mockHttpsGet.mockReturnValue(createMockHttpReq());

      await mod.startPythonInstall({ includeLLM: true, includeOCR: true, includeVoice: true });

      expect(mockHttpsGet).toHaveBeenCalled();
    });

    it('adds installed language-declared voice requirements to pip install', async () => {
      mockInstalledLanguageData = {
        ja: {
          name: 'Japanese',
          translatable: [],
          colour_codes: {},
          settings: { fixed: {} },
          runtime: {
            python: {
              packagesByComponent: {
                voice: ['ja-voice-extra-one', 'ja-voice-extra-two'],
              },
            },
          },
        },
      };
      vi.resetModules();
      mod = await import('./pythonBackend');

      const mockWebContents = { send: vi.fn() };
      mockGetCurrentWindow.mockReturnValue({ webContents: mockWebContents });

      mockHttpsGet.mockImplementation((_url: string, callback: (res: MockHttpRes) => void) => {
        callback(createMockHttpRes(200));
        return createMockHttpReq();
      });
      mockWriteStream.close.mockImplementation((callback?: () => void) => {
        callback?.();
      });
      mockTarExtract.mockImplementationOnce(async (options: { cwd: string }) => {
        const binDir = path.join(options.cwd, 'python-runtime', 'bin');
        fs.mkdirSync(binDir, { recursive: true });
        fs.writeFileSync(path.join(binDir, 'pip3'), '');
        fs.writeFileSync(path.join(binDir, 'python3'), '');
      });
      mockSpawn.mockReturnValue({
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        on: vi.fn(),
        kill: vi.fn(),
        killed: false,
      });

      await mod.startPythonInstall({ includeLLM: false, includeOCR: false, includeVoice: true });
      fs.writeFileSync('/tmp/test-userdata/python.tar.gz', 'archive');
      const finishHandler = mockWriteStream.on.mock.calls.find((call) => call[0] === 'finish')?.[1] as (() => void) | undefined;
      expect(finishHandler).toBeDefined();
      finishHandler?.();
      await new Promise((resolve) => setTimeout(resolve, 0));

      const pipInstallCall = mockSpawn.mock.calls.find((call) => (
        Array.isArray(call[1]) && call[1][0] === 'install'
      ));
      expect(pipInstallCall?.[1]).toEqual(expect.arrayContaining([
        'kokoro',
        'ja-voice-extra-one',
        'ja-voice-extra-two',
      ]));
    });

    it('starts the backend after a successful component installation', async () => {
      const mockWebContents = { send: vi.fn() };
      mockGetCurrentWindow.mockReturnValue({ webContents: mockWebContents });

      mockHttpsGet.mockImplementation((_url: string, callback: (res: MockHttpRes) => void) => {
        callback(createMockHttpRes(200));
        return createMockHttpReq();
      });
      mockWriteStream.close.mockImplementation((callback?: () => void) => {
        callback?.();
      });
      mockTarExtract.mockImplementationOnce(async (options: { cwd: string }) => {
        const binDir = path.join(options.cwd, 'python-runtime', 'bin');
        fs.mkdirSync(binDir, { recursive: true });
        fs.writeFileSync(path.join(binDir, 'pip3'), '');
        fs.writeFileSync(path.join(binDir, 'python3'), '');
      });

      let pipClose: ((code: number | null) => void) | undefined;
      mockSpawn.mockImplementation((cmd: string, args: string[]) => {
        if (args[0] === 'install') {
          return {
            stdout: { on: vi.fn() },
            stderr: { on: vi.fn() },
            on: vi.fn((event: string, handler: (code: number | null) => void) => {
              if (event === 'close') pipClose = handler;
            }),
            kill: vi.fn(),
            killed: false,
          };
        }
        if (args[0] === '-c' || args[0] === '--version') {
          return {
            stdout: { on: vi.fn() },
            stderr: { on: vi.fn() },
            on: vi.fn((event: string, handler: (...handlerArgs: unknown[]) => void) => {
              if (event === 'close') handler(0);
            }),
            kill: vi.fn(),
            killed: false,
          };
        }
        return {
          stdout: { on: vi.fn() },
          stderr: { on: vi.fn() },
          on: vi.fn(),
          kill: vi.fn(),
          killed: false,
          cmd,
        };
      });

      await mod.startPythonInstall({ includeLLM: false, includeOCR: false, includeVoice: false });
      fs.writeFileSync('/tmp/test-userdata/python.tar.gz', 'archive');
      const finishHandler = mockWriteStream.on.mock.calls.find((call) => call[0] === 'finish')?.[1] as (() => void) | undefined;
      expect(finishHandler).toBeDefined();
      finishHandler?.();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(pipClose).toBeDefined();
      pipClose?.(0);
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(mockSpawn.mock.calls.some((call) => call[0] === '/bin/sh')).toBe(true);
    });

    it('verifies a freshly installed per-user runtime instead of a previously selected dev runtime', async () => {
      const repoRoot = path.join(tempDir.tmpDir, 'repo');
      const repoEnvBin = path.join(repoRoot, 'dist-electron', 'env', 'bin');
      const repoPythonPath = path.join(repoEnvBin, 'python3');
      fs.mkdirSync(repoEnvBin, { recursive: true });
      fs.writeFileSync(repoPythonPath, '');

      mockPlatformPaths.resourcePath = path.join(tempDir.tmpDir, 'compiled-output');
      mockPlatformPaths.pythonExecutablePath = path.join(tempDir.tmpDir, 'missing-runtime', 'env', 'bin', 'python3');
      vi.spyOn(process, 'cwd').mockReturnValue(repoRoot);

      mockSpawn.mockImplementation((_cmd: string, args: string[]) => {
        if (args[0] === '--version') {
          return {
            stdout: { on: vi.fn() },
            stderr: { on: vi.fn() },
            on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
              if (event === 'close') handler(0);
            }),
            kill: vi.fn(),
            killed: false,
          };
        }
        return {
          stdout: { on: vi.fn() },
          stderr: { on: vi.fn() },
          on: vi.fn(),
          kill: vi.fn(),
          killed: false,
        };
      });

      vi.resetModules();
      mod = await import('./pythonBackend');
      await mod.findPython();

      mockSpawn.mockClear();
      mockHttpsGet.mockImplementation((_url: string, callback: (res: MockHttpRes) => void) => {
        callback(createMockHttpRes(200));
        return createMockHttpReq();
      });
      mockWriteStream.close.mockImplementation((callback?: () => void) => {
        callback?.();
      });
      mockTarExtract.mockImplementationOnce(async (options: { cwd: string }) => {
        const binDir = path.join(options.cwd, 'python', 'bin');
        fs.mkdirSync(binDir, { recursive: true });
        fs.writeFileSync(path.join(binDir, 'pip3'), '');
        fs.writeFileSync(path.join(binDir, 'python3'), '');
      });

      let pipClose: ((code: number | null) => void) | undefined;
      let verificationCommand = '';
      mockSpawn.mockImplementation((cmd: string, args: string[]) => {
        if (args[0] === 'install') {
          return {
            stdout: { on: vi.fn() },
            stderr: { on: vi.fn() },
            on: vi.fn((event: string, handler: (code: number | null) => void) => {
              if (event === 'close') pipClose = handler;
            }),
            kill: vi.fn(),
            killed: false,
          };
        }
        if (cmd !== '/bin/sh' && args[0] === '-c') {
          verificationCommand = cmd;
          return {
            stdout: { on: vi.fn() },
            stderr: { on: vi.fn() },
            on: vi.fn((event: string, handler: (...handlerArgs: unknown[]) => void) => {
              if (event === 'close') handler(0);
            }),
            kill: vi.fn(),
            killed: false,
          };
        }
        return {
          stdout: { on: vi.fn() },
          stderr: { on: vi.fn() },
          on: vi.fn(),
          kill: vi.fn(),
          killed: false,
        };
      });

      await mod.startPythonInstall({ includeLLM: false, includeOCR: false, includeVoice: false });
      fs.writeFileSync('/tmp/test-userdata/python.tar.gz', 'archive');
      const finishHandler = mockWriteStream.on.mock.calls.find((call) => call[0] === 'finish')?.[1] as (() => void) | undefined;
      expect(finishHandler).toBeDefined();
      finishHandler?.();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(pipClose).toBeDefined();
      pipClose?.(0);
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(verificationCommand).toBe('/tmp/test-userdata/env/bin/python3');
      expect(verificationCommand).not.toBe(repoPythonPath);
    });

    it('starts the backend after repairing a missing runtime for an existing profile', async () => {
      mockHasSettingsFile.mockReturnValue(true);
      vi.spyOn(process, 'cwd').mockReturnValue(path.join(tempDir.tmpDir, 'repo-without-runtime'));
      const mockWebContents = { send: vi.fn() };
      mockGetCurrentWindow.mockReturnValue({ webContents: mockWebContents });

      await mod.findPython();

      mockHttpsGet.mockImplementation((_url: string, callback: (res: MockHttpRes) => void) => {
        callback(createMockHttpRes(200));
        return createMockHttpReq();
      });
      mockWriteStream.close.mockImplementation((callback?: () => void) => {
        callback?.();
      });
      mockTarExtract.mockImplementationOnce(async (options: { cwd: string }) => {
        const binDir = path.join(options.cwd, 'python-runtime', 'bin');
        fs.mkdirSync(binDir, { recursive: true });
        fs.writeFileSync(path.join(binDir, 'pip3'), '');
        fs.writeFileSync(path.join(binDir, 'python3'), '');
      });

      let pipClose: ((code: number | null) => void) | undefined;
      mockSpawn.mockImplementation((cmd: string, args: string[]) => {
        if (args[0] === 'install') {
          return {
            stdout: { on: vi.fn() },
            stderr: { on: vi.fn() },
            on: vi.fn((event: string, handler: (code: number | null) => void) => {
              if (event === 'close') pipClose = handler;
            }),
            kill: vi.fn(),
            killed: false,
          };
        }
        if (args[0] === '-c' || args[0] === '--version') {
          return {
            stdout: { on: vi.fn() },
            stderr: { on: vi.fn() },
            on: vi.fn((event: string, handler: (...handlerArgs: unknown[]) => void) => {
              if (event === 'close') handler(0);
            }),
            kill: vi.fn(),
            killed: false,
          };
        }
        return {
          stdout: { on: vi.fn() },
          stderr: { on: vi.fn() },
          on: vi.fn(),
          kill: vi.fn(),
          killed: false,
          cmd,
        };
      });

      await mod.startPythonInstall({ includeLLM: false, includeOCR: false, includeVoice: false });
      fs.writeFileSync('/tmp/test-userdata/python.tar.gz', 'archive');
      const finishHandler = mockWriteStream.on.mock.calls.find((call) => call[0] === 'finish')?.[1] as (() => void) | undefined;
      expect(finishHandler).toBeDefined();
      finishHandler?.();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(pipClose).toBeDefined();
      pipClose?.(0);
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(mockSpawn.mock.calls.some((call) => call[0] === '/bin/sh')).toBe(true);
    });

    it('does not verify concrete OCR engines unless language metadata requested them', async () => {
      const mockWebContents = { send: vi.fn() };
      mockGetCurrentWindow.mockReturnValue({ webContents: mockWebContents });

      mockHttpsGet.mockImplementation((_url: string, callback: (res: MockHttpRes) => void) => {
        callback(createMockHttpRes(200));
        return createMockHttpReq();
      });
      mockWriteStream.close.mockImplementation((callback?: () => void) => {
        callback?.();
      });
      mockTarExtract.mockImplementationOnce(async (options: { cwd: string }) => {
        const binDir = path.join(options.cwd, 'python-runtime', 'bin');
        fs.mkdirSync(binDir, { recursive: true });
        fs.writeFileSync(path.join(binDir, 'pip3'), '');
        fs.writeFileSync(path.join(binDir, 'python3'), '');
      });

      let pipClose: ((code: number | null) => void) | undefined;
      let verificationScript = '';
      mockSpawn.mockImplementation((cmd: string, args: string[]) => {
        if (args[0] === 'install') {
          return {
            stdout: { on: vi.fn() },
            stderr: { on: vi.fn() },
            on: vi.fn((event: string, handler: (code: number | null) => void) => {
              if (event === 'close') pipClose = handler;
            }),
            kill: vi.fn(),
            killed: false,
          };
        }
        if (cmd !== '/bin/sh' && args[0] === '-c') {
          verificationScript = args[1];
          return {
            stdout: { on: vi.fn() },
            stderr: { on: vi.fn() },
            on: vi.fn((event: string, handler: (...handlerArgs: unknown[]) => void) => {
              if (event === 'close') handler(0);
            }),
            kill: vi.fn(),
            killed: false,
          };
        }
        if (args[0] === '--version') {
          return {
            stdout: { on: vi.fn() },
            stderr: { on: vi.fn() },
            on: vi.fn((event: string, handler: (...handlerArgs: unknown[]) => void) => {
              if (event === 'close') handler(0);
            }),
            kill: vi.fn(),
            killed: false,
          };
        }
        return {
          stdout: { on: vi.fn() },
          stderr: { on: vi.fn() },
          on: vi.fn(),
          kill: vi.fn(),
          killed: false,
        };
      });

      await mod.startPythonInstall({ includeLLM: false, includeOCR: true, includeVoice: false });
      fs.writeFileSync('/tmp/test-userdata/python.tar.gz', 'archive');
      const finishHandler = mockWriteStream.on.mock.calls.find((call) => call[0] === 'finish')?.[1] as (() => void) | undefined;
      finishHandler?.();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(pipClose).toBeDefined();
      pipClose?.(0);
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(verificationScript).toContain('import fastapi');
      expect(verificationScript).not.toContain('manga_ocr');
      expect(verificationScript).not.toContain('paddleocr');
      expect(verificationScript).not.toContain('rapidocr');
    });
  });

  describe('terminatePythonBackend', () => {
    it('does nothing when no process running', () => {
      expect(() => mod.terminatePythonBackend()).not.toThrow();
    });

    it('kills process when one is running', async () => {
      const envBin = path.join(tempDir.tmpDir, 'env', 'bin');
      fs.mkdirSync(envBin, { recursive: true });
      fs.writeFileSync(path.join(envBin, 'python3'), '');

      Object.defineProperty(process, 'resourcesPath', {
        value: tempDir.tmpDir,
        writable: true,
        configurable: true,
      });

      const backendMockProcess = {
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        on: vi.fn(),
        kill: vi.fn(),
        killed: false,
      };

      mockSpawn.mockImplementation((_cmd: string, args: string[]) => {
        if (args[0] === '--version') {
          return {
            stdout: { on: vi.fn() },
            stderr: { on: vi.fn() },
            on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
              if (event === 'close') {
                handler(0);
              }
            }),
            kill: vi.fn(),
            killed: false,
          };
        }
        return backendMockProcess;
      });

      vi.resetModules();
      mod = await import('./pythonBackend');

      await mod.findPython();

      const mockHttpReq = createMockHttpReq();
      mockHttpRequest.mockImplementation((_opts: unknown, cb: (res: MockHttpRes) => void) => {
        const res = createMockHttpRes(200);
        cb(res);
        return mockHttpReq;
      });

      mod.terminatePythonBackend();

      expect(backendMockProcess.kill).toHaveBeenCalledWith('SIGINT');
    });
  });

  describe('restartPythonBackend', () => {
    it('does not throw when called without running process', () => {
      expect(() => mod.restartPythonBackend()).not.toThrow();
    });
  });

  describe('setupPythonBackendIPC', () => {
    it('registers all expected IPC channels', () => {
      mod.setupPythonBackendIPC();

      expect(mockIpcListeners.has('is-successful-install')).toBe(true);
      expect(mockIpcListeners.has('is-loaded')).toBe(true);
      expect(mockIpcListeners.has('start-install')).toBe(true);
      expect(mockIpcListeners.has('installer-state-request')).toBe(true);
      expect(mockIpcListeners.has('restart-backend')).toBe(true);
      expect(mockIpcListeners.has('restart-backend-anki-override')).toBe(false);
    });

    it('IS_SUCCESSFUL_INSTALL replies with pythonSuccessInstall status', () => {
      mod.setupPythonBackendIPC();

      const mockEvent = { reply: vi.fn() };
      const listeners = mockIpcListeners.get('is-successful-install') || [];
      listeners[0](mockEvent);

      expect(mockEvent.reply).toHaveBeenCalledWith('successful-install', false);
    });

    it('IS_LOADED does not send server-load when server is not loaded', () => {
      mod.setupPythonBackendIPC();

      const mockEvent = { reply: vi.fn(), sender: { send: vi.fn() } };
      const listeners = mockIpcListeners.get('is-loaded') || [];
      listeners[0](mockEvent);

      expect(mockEvent.reply).not.toHaveBeenCalledWith('server-load', expect.anything());
    });

    it('IS_LOADED replays buffered cache-loaded startup status once', async () => {
      const envBin = path.join(tempDir.tmpDir, 'env', 'bin');
      fs.mkdirSync(envBin, { recursive: true });
      fs.writeFileSync(path.join(envBin, 'python3'), '');

      Object.defineProperty(process, 'resourcesPath', {
        value: tempDir.tmpDir,
        writable: true,
        configurable: true,
      });

      let stdoutHandler: ((data: Buffer) => void) | null = null;
      const mockProcess = {
        stdout: {
          on: vi.fn((event: string, handler: (data: Buffer) => void) => {
            if (event === 'data') {
              stdoutHandler = handler;
            }
          }),
        },
        stderr: { on: vi.fn() },
        on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
          if (event === 'close') {
            handler(0);
          }
        }),
        kill: vi.fn(),
        killed: false,
      };
      mockSpawn.mockReturnValue(mockProcess);

      vi.resetModules();
      mod = await import('./pythonBackend');

      await mod.findPython();
      stdoutHandler!(Buffer.from('::STATUS::ANKI::123::Loaded from cache\n'));

      mod.setupPythonBackendIPC();

      const firstEvent = { reply: vi.fn(), sender: { send: vi.fn() } };
      const secondEvent = { reply: vi.fn(), sender: { send: vi.fn() } };
      const listeners = mockIpcListeners.get('is-loaded') || [];

      listeners[0](firstEvent);
      listeners[0](secondEvent);

      expect(firstEvent.sender.send).toHaveBeenCalledWith('server-status-update', 'Loaded from cache');
      expect(secondEvent.sender.send).not.toHaveBeenCalledWith('server-status-update', 'Loaded from cache');
    });

    it('captures quit token from structured Python status logs', async () => {
      const envBin = path.join(tempDir.tmpDir, 'env', 'bin');
      fs.mkdirSync(envBin, { recursive: true });
      fs.writeFileSync(path.join(envBin, 'python3'), '');

      Object.defineProperty(process, 'resourcesPath', {
        value: tempDir.tmpDir,
        writable: true,
        configurable: true,
      });

      let stdoutHandler: ((data: Buffer) => void) | null = null;
      let closeHandler: ((code: number | null, signal: NodeJS.Signals | null) => void) | null = null;
      const verifyProcess = {
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        on: vi.fn((event: string, handler: (code: number | null, signal: NodeJS.Signals | null) => void) => {
          if (event === 'close') {
            handler(0, null);
          }
        }),
        kill: vi.fn(),
        killed: false,
      };
      const serverProcess = {
        stdout: {
          on: vi.fn((event: string, handler: (data: Buffer) => void) => {
            if (event === 'data') {
              stdoutHandler = handler;
            }
          }),
        },
        stderr: { on: vi.fn() },
        on: vi.fn((event: string, handler: (code: number | null, signal: NodeJS.Signals | null) => void) => {
          if (event === 'close') {
            closeHandler = handler;
          }
        }),
        kill: vi.fn(),
        killed: false,
      };
      mockSpawn
        .mockReturnValueOnce(verifyProcess)
        .mockReturnValueOnce(serverProcess);

      vi.resetModules();
      mod = await import('./pythonBackend');

      const findPromise = mod.findPython();
      for (let attempt = 0; attempt < 10 && !stdoutHandler; attempt++) {
        await Promise.resolve();
      }
      stdoutHandler!(Buffer.from('::STATUS::v2::INFO::server::2026-07-06 19:19:00::::QUIT_TOKEN::abcdef1234\n'));

      expect(mod.getQuitToken()).toBe('abcdef1234');

      closeHandler?.(0, null);
      await findPromise;
    });

    it('INSTALLER_STATE_REQUEST replies with current installer state', () => {
      mod.setupPythonBackendIPC();

      const mockEvent = { reply: vi.fn() };
      const listeners = mockIpcListeners.get('installer-state-request') || [];
      listeners[0](mockEvent);

      expect(mockEvent.reply).toHaveBeenCalledWith(
        'installer-state',
        expect.objectContaining({
          waiting: expect.any(Boolean),
          inProgress: expect.any(Boolean),
          success: expect.any(Boolean),
        }),
      );
    });

    it('IS_LOADED replays installer-required state after Python lookup misses', async () => {
      vi.spyOn(process, 'cwd').mockReturnValue(path.join(tempDir.tmpDir, 'repo-without-runtime'));
      const mockWebContents = { send: vi.fn() };
      mockGetCurrentWindow.mockReturnValue({ webContents: mockWebContents });

      await mod.findPython();

      mod.setupPythonBackendIPC();

      const mockEvent = { reply: vi.fn(), sender: { send: vi.fn() } };
      const listeners = mockIpcListeners.get('is-loaded') || [];
      listeners[0](mockEvent);

      expect(mockEvent.sender.send).toHaveBeenCalledWith('installer-awaiting-choice');
    });

    it('IS_LOADED does not replay installer-required state after a later healthy runtime lookup', async () => {
      const missingRepoRoot = path.join(tempDir.tmpDir, 'repo-without-runtime');
      const repoRoot = path.join(tempDir.tmpDir, 'repo');
      const repoEnvBin = path.join(repoRoot, 'dist-electron', 'env', 'bin');
      const repoPythonPath = path.join(repoEnvBin, 'python3');
      let currentCwd = missingRepoRoot;
      vi.spyOn(process, 'cwd').mockImplementation(() => currentCwd);

      const mockWebContents = { send: vi.fn() };
      mockGetCurrentWindow.mockReturnValue({ webContents: mockWebContents });

      await mod.findPython();

      fs.mkdirSync(repoEnvBin, { recursive: true });
      fs.writeFileSync(repoPythonPath, '');
      currentCwd = repoRoot;

      mockSpawn.mockImplementation((_cmd: string, args: string[]) => {
        if (args[0] === '--version') {
          return {
            stdout: { on: vi.fn() },
            stderr: { on: vi.fn() },
            on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
              if (event === 'close') handler(0);
            }),
            kill: vi.fn(),
            killed: false,
          };
        }
        return {
          stdout: { on: vi.fn() },
          stderr: { on: vi.fn() },
          on: vi.fn(),
          kill: vi.fn(),
          killed: false,
        };
      });

      const result = await mod.findPython();
      expect(result).toBe(true);

      mod.setupPythonBackendIPC();

      const loadedEvent = { reply: vi.fn(), sender: { send: vi.fn() } };
      const stateEvent = { reply: vi.fn() };
      const loadedListeners = mockIpcListeners.get('is-loaded') || [];
      const stateListeners = mockIpcListeners.get('installer-state-request') || [];
      loadedListeners[0](loadedEvent);
      stateListeners[0](stateEvent);

      expect(loadedEvent.sender.send).not.toHaveBeenCalledWith('installer-awaiting-choice');
      expect(stateEvent.reply).toHaveBeenCalledWith(
        'installer-state',
        expect.objectContaining({ waiting: false, success: true }),
      );
    });

    it('START_INSTALL triggers startPythonInstall with options', async () => {
      const mockWebContents = { send: vi.fn() };
      mockGetCurrentWindow.mockReturnValue({ webContents: mockWebContents });

      mockHttpsGet.mockReturnValue(createMockHttpReq());

      mod.setupPythonBackendIPC();

      const listeners = mockIpcListeners.get('start-install') || [];
      await listeners[0]({}, { includeLLM: false, includeOCR: true });

      expect(mockWebContents.send).toHaveBeenCalledWith(
        'install-started',
        expect.objectContaining({ includeLLM: false, includeOCR: true }),
      );
    });

    it('START_INSTALL uses defaults when rawOptions is null', async () => {
      const mockWebContents = { send: vi.fn() };
      mockGetCurrentWindow.mockReturnValue({ webContents: mockWebContents });

      mockHttpsGet.mockReturnValue(createMockHttpReq());

      mod.setupPythonBackendIPC();

      const listeners = mockIpcListeners.get('start-install') || [];
      await listeners[0]({}, null);

      expect(mockWebContents.send).toHaveBeenCalledWith(
        'install-started',
        expect.objectContaining({ includeLLM: true, includeOCR: true }),
      );
    });

    it('RESTART_BACKEND calls restartPythonBackend without throwing', () => {
      mod.setupPythonBackendIPC();

      const listeners = mockIpcListeners.get('restart-backend') || [];
      expect(() => listeners[0]({})).not.toThrow();
    });

  });
});
