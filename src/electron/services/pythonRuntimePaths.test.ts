import fs from 'fs';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTempDir, type TempDir } from '../../../test/helpers/tempDir';

let tempDir: TempDir;
const mockPlatform = vi.hoisted(() => ({
  resourcePath: '/tmp/mlearn-runtime-paths/resource',
  userDataPath: '/tmp/mlearn-runtime-paths/user',
  pythonExecutablePath: '/tmp/mlearn-runtime-paths/resource/env/bin/python3',
  pipExecutablePath: '/tmp/mlearn-runtime-paths/resource/env/bin/pip3',
  isPackaged: false,
  isWindows: false,
}));

vi.mock('../utils/platform', () => ({
  getResourcePath: vi.fn(() => mockPlatform.resourcePath),
  getUserDataPath: vi.fn(() => mockPlatform.userDataPath),
  getPythonExecutablePath: vi.fn(() => mockPlatform.pythonExecutablePath),
  getPipExecutablePath: vi.fn(() => mockPlatform.pipExecutablePath),
  getPythonDownloadUrl: vi.fn(),
  isPackaged: mockPlatform.isPackaged,
  isWindows: mockPlatform.isWindows,
}));

describe('pythonRuntimePaths', () => {
  beforeEach(() => {
    tempDir = createTempDir('mlearn-python-runtime-paths-');
    mockPlatform.resourcePath = path.join(tempDir.tmpDir, 'dist-electron');
    mockPlatform.userDataPath = path.join(tempDir.tmpDir, 'user-data');
    mockPlatform.pythonExecutablePath = path.join(mockPlatform.resourcePath, 'env', 'bin', 'python3');
    mockPlatform.pipExecutablePath = path.join(mockPlatform.resourcePath, 'env', 'bin', 'pip3');
    mockPlatform.isPackaged = false;
    mockPlatform.isWindows = false;
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    tempDir.cleanup();
  });

  it('uses the same dev runtime root for Python and pip candidates', async () => {
    const repoRoot = path.join(tempDir.tmpDir, 'repo');
    const repoEnvBin = path.join(repoRoot, 'dist-electron', 'env', 'bin');
    fs.mkdirSync(repoEnvBin, { recursive: true });
    fs.writeFileSync(path.join(repoEnvBin, 'python3'), '');
    fs.writeFileSync(path.join(repoEnvBin, 'pip3'), '');
    vi.spyOn(process, 'cwd').mockReturnValue(repoRoot);

    const mod = await import('./pythonRuntimePaths');

    expect(mod.getPythonExecutableCandidates()).toContain(path.join(repoEnvBin, 'python3'));
    expect(mod.getPipCommandCandidates()).toContainEqual({
      command: path.join(repoEnvBin, 'pip3'),
      argsPrefix: [],
      cwd: path.join(repoRoot, 'dist-electron', 'env'),
    });
  });

  it('prefers the per-user runtime before resource or development runtimes', async () => {
    const userEnvBin = path.join(mockPlatform.userDataPath, 'env', 'bin');
    fs.mkdirSync(userEnvBin, { recursive: true });
    fs.writeFileSync(path.join(userEnvBin, 'python3'), '');
    fs.writeFileSync(path.join(userEnvBin, 'pip3'), '');

    const mod = await import('./pythonRuntimePaths');

    expect(mod.getPythonExecutableCandidates()[0]).toBe(path.join(userEnvBin, 'python3'));
    expect(mod.getPipCommandCandidates()[0]).toEqual({
      command: path.join(userEnvBin, 'pip3'),
      argsPrefix: [],
      cwd: path.join(mockPlatform.userDataPath, 'env'),
    });
  });
});
