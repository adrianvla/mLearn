import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { createTempDir, type TempDir } from '../../../../../test/helpers/tempDir';
import { SUITE_NAMES } from '../../../../shared/diagnostics/constants';

const mockIpcListeners = new Map<string, unknown[]>();

vi.mock('electron', () => ({
  ipcMain: {
    on: vi.fn((channel: string, handler: unknown) => {
      const existing = mockIpcListeners.get(channel) ?? [];
      existing.push(handler);
      mockIpcListeners.set(channel, existing);
    }),
    handle: vi.fn(),
    removeHandler: vi.fn(),
  },
  app: {
    getPath: vi.fn(() => '/tmp/test'),
    on: vi.fn(),
    isPackaged: false,
  },
}));

vi.mock('../../localization', () => ({
  setUILanguage: vi.fn(),
}));

vi.mock('../../pythonRuntimeRequirements', () => ({
  ensureLanguagePythonRequirementsInstalled: vi.fn(),
}));

let tempDir: TempDir;

vi.mock('../../../utils/platform', () => ({
  getUserDataPath: vi.fn(() => tempDir.tmpDir),
  getAppPath: vi.fn(() => tempDir.tmpDir),
  getResourcePath: vi.fn(() => tempDir.tmpDir),
}));

describe('storage diagnostics', () => {
  beforeEach(async () => {
    tempDir = createTempDir();
    mockIpcListeners.clear();
    vi.resetModules();
  });

  afterEach(() => {
    tempDir.cleanup();
  });

  it('round-trips a known settings key and restores the original settings', async () => {
    const settingsPath = path.join(tempDir.tmpDir, 'settings.json');
    fs.writeFileSync(settingsPath, JSON.stringify({
      language: 'ja',
      blur_words: true,
      unknownDiagnosticKey: 'must not be required',
    }), 'utf-8');

    await import('./storage');
    const { getDiagnosticSuites, clearDiagnosticSuites } = await import('../../../../shared/diagnostics/registry');
    const storageSuite = getDiagnosticSuites().find((suite) => suite.name === SUITE_NAMES.STORAGE);
    const settingsTest = storageSuite?.tests.find((test) => test.name === 'settings-read-write');

    expect(settingsTest).toBeDefined();
    await expect(settingsTest!.fn()).resolves.toBeUndefined();
    clearDiagnosticSuites();

    const restored = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    expect(restored.language).toBe('ja');
    expect(restored.blur_words).toBe(true);
    expect(restored.unknownDiagnosticKey).toBeUndefined();
  });
});
