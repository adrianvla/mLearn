import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { createTempDir, type TempDir } from '../../../test/helpers/tempDir';

const mockSpawn = vi.fn();
let tempDir: TempDir;

vi.mock('child_process', () => ({
  spawn: mockSpawn,
}));

vi.mock('../utils/platform', () => ({
  getResourcePath: vi.fn(() => path.join(tempDir?.tmpDir ?? '/tmp/test-userdata', 'dist-electron')),
  getUserDataPath: vi.fn(() => tempDir?.tmpDir ?? '/tmp/test-userdata'),
  getPythonExecutablePath: vi.fn(() => path.join(tempDir?.tmpDir ?? '/tmp/test-userdata', 'env', 'bin', 'python3')),
  getPipExecutablePath: vi.fn(() => path.join(tempDir?.tmpDir ?? '/tmp/test-userdata', 'env', 'bin', 'pip3')),
  isPackaged: false,
  isWindows: false,
}));

function makeProcess(exitCode: number) {
  return {
    stdout: { on: vi.fn() },
    stderr: { on: vi.fn() },
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      if (event === 'close') {
        queueMicrotask(() => handler(exitCode));
      }
      return undefined;
    }),
  };
}

describe('pythonRuntimeRequirements', () => {
  beforeEach(() => {
    tempDir = createTempDir('mlearn-python-runtime-requirements-');
    mockSpawn.mockReset();
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    tempDir.cleanup();
  });

  it('installs selected language Python requirements into an existing runtime', async () => {
    const envBin = path.join(tempDir.tmpDir, 'env', 'bin');
    fs.mkdirSync(envBin, { recursive: true });
    fs.writeFileSync(path.join(envBin, 'pip3'), '');
    mockSpawn.mockReturnValue(makeProcess(0));

    const mod = await import('./pythonRuntimeRequirements');
    await mod.ensureLanguagePythonRequirementsInstalled('aa', {
      aa: {
        name: 'Alpha',
        runtime: {
          python: {
            packagesByComponent: {
              core: ['aa-core'],
              ocr: ['aa-ocr'],
              llm: ['aa-llm'],
              voice: ['aa-voice'],
            },
          },
        },
      },
      bb: {
        name: 'Beta',
        runtime: {
          python: {
            packagesByComponent: {
              core: ['bb-core'],
            },
          },
        },
      },
    }, {
      includeLLM: false,
      includeOCR: true,
      includeVoice: true,
    });

    expect(mockSpawn).toHaveBeenCalledWith(
      path.join(envBin, 'pip3'),
      ['install', 'aa-core', 'aa-ocr', 'aa-voice'],
      { cwd: path.join(tempDir.tmpDir, 'env') },
    );
  });

  it('skips selected language Python requirements when the receipt is current', async () => {
    const envBin = path.join(tempDir.tmpDir, 'env', 'bin');
    fs.mkdirSync(envBin, { recursive: true });
    fs.writeFileSync(path.join(envBin, 'pip3'), '');
    mockSpawn.mockReturnValue(makeProcess(0));

    const mod = await import('./pythonRuntimeRequirements');
    const langData = {
      aa: {
        name: 'Alpha',
        runtime: {
          python: {
            packagesByComponent: {
              core: ['aa-core'],
              ocr: ['aa-ocr'],
            },
          },
        },
      },
    };
    const options = {
      includeLLM: false,
      includeOCR: true,
      includeVoice: false,
    };

    await mod.ensureLanguagePythonRequirementsInstalled('aa', langData, options, {
      skipIfCurrent: true,
    });
    await mod.ensureLanguagePythonRequirementsInstalled('aa', langData, options, {
      skipIfCurrent: true,
    });

    expect(mockSpawn).toHaveBeenCalledTimes(1);
  });

  it('rejects package installation when required language packages need a missing Python runtime', async () => {
    vi.spyOn(process, 'cwd').mockReturnValue(path.join(tempDir.tmpDir, 'repo-without-runtime'));
    const mod = await import('./pythonRuntimeRequirements');

    await expect(mod.ensureLanguagePythonRequirementsInstalled('aa', {
      aa: {
        name: 'Alpha',
        runtime: {
          python: {
            packagesByComponent: {
              core: ['aa-core'],
            },
          },
        },
      },
    }, {
      includeLLM: false,
      includeOCR: false,
      includeVoice: false,
    })).rejects.toThrow('Cannot install Python requirements for aa; the local Python runtime is not installed.');

    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it('allows metadata-only language installs when no Python requirements are declared', async () => {
    const mod = await import('./pythonRuntimeRequirements');

    await expect(mod.ensureLanguagePythonRequirementsInstalled('aa', {
      aa: {
        name: 'Alpha',
      },
    }, {
      includeLLM: false,
      includeOCR: false,
      includeVoice: false,
    })).resolves.toBeUndefined();

    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it('finds the development runtime from the compiled Electron resource path without NODE_ENV', async () => {
    vi.spyOn(process, 'cwd').mockReturnValue(path.join(tempDir.tmpDir, 'repo-without-runtime'));
    const envBin = path.join(tempDir.tmpDir, 'dist-electron', 'env', 'bin');
    fs.mkdirSync(envBin, { recursive: true });
    fs.writeFileSync(path.join(envBin, 'pip3'), '');
    mockSpawn.mockReturnValue(makeProcess(0));
    vi.stubEnv('NODE_ENV', '');

    const mod = await import('./pythonRuntimeRequirements');
    await mod.ensureLanguagePythonRequirementsInstalled('aa', {
      aa: {
        name: 'Alpha',
        runtime: {
          python: {
            packagesByComponent: {
              core: ['aa-core'],
            },
          },
        },
      },
    }, {
      includeLLM: false,
      includeOCR: false,
      includeVoice: false,
    });

    expect(mockSpawn).toHaveBeenCalledWith(
      path.join(envBin, 'pip3'),
      ['install', 'aa-core'],
      { cwd: path.join(tempDir.tmpDir, 'dist-electron', 'env') },
    );
  });

  it('rejects when pip exits unsuccessfully for an existing runtime', async () => {
    const envBin = path.join(tempDir.tmpDir, 'env', 'bin');
    fs.mkdirSync(envBin, { recursive: true });
    fs.writeFileSync(path.join(envBin, 'pip3'), '');
    mockSpawn.mockReturnValue(makeProcess(1));

    const mod = await import('./pythonRuntimeRequirements');

    await expect(mod.ensureLanguagePythonRequirementsInstalled('aa', {
      aa: {
        name: 'Alpha',
        runtime: {
          python: {
            packagesByComponent: {
              core: ['aa-core'],
            },
          },
        },
      },
    }, {
      includeLLM: false,
      includeOCR: false,
      includeVoice: false,
    })).rejects.toThrow('pip exited with code 1');
  });
});
