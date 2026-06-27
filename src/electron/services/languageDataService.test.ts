import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { createTempDir, type TempDir } from '../../../test/helpers/tempDir';
import type { LanguageDataMap } from '../../shared/types';

const mockDownloadFileWithProgress = vi.fn();

vi.mock('../utils/downloadManager', () => ({
  downloadFileWithProgress: mockDownloadFileWithProgress,
}));

let tempDir: TempDir;

vi.mock('../utils/platform', () => ({
  getUserDataPath: vi.fn(() => tempDir.tmpDir),
  getResourcePath: vi.fn(() => path.join(tempDir.tmpDir, 'resources')),
}));

function makeLangData(overrides: Partial<LanguageDataMap[string]> = {}): LanguageDataMap {
  return {
    zz: {
      name: 'Test Language',
      translatable: ['NOUN'],
      colour_codes: {},
      fixed_settings: {},
      languageData: {
        assets: [
          {
            id: 'dictionary',
            path: 'dictionaries/zz/dictionary.db',
            bundledPath: 'dictionaries/zz/dictionary.db',
            url: 'https://example.com/language-data/zz/dictionary.db',
            required: true,
          },
        ],
      },
      ...overrides,
    },
  };
}

describe('languageDataService', () => {
  let mod: typeof import('./languageDataService');

  beforeEach(async () => {
    tempDir = createTempDir('mlearn-language-data-');
    mockDownloadFileWithProgress.mockReset();
    vi.resetModules();
    mod = await import('./languageDataService');
  });

  it('reports missing required assets when language data is not installed', () => {
    const status = mod.getLanguageDataStatus('zz', makeLangData());

    expect(status.installed).toBe(false);
    expect(status.missingAssets).toEqual(['dictionary']);
    expect(status.dataRoot).toBe(path.join(tempDir.tmpDir, 'language-data'));
  });

  it('copies bundled development assets into userData on demand', async () => {
    const bundled = path.join(tempDir.tmpDir, 'resources', 'root-of-app', 'dictionaries', 'zz', 'dictionary.db');
    fs.mkdirSync(path.dirname(bundled), { recursive: true });
    fs.writeFileSync(bundled, 'sqlite bytes');

    await mod.ensureLanguageDataInstalled('zz', makeLangData());

    const installed = path.join(tempDir.tmpDir, 'language-data', 'dictionaries', 'zz', 'dictionary.db');
    expect(fs.readFileSync(installed, 'utf-8')).toBe('sqlite bytes');
    expect(mockDownloadFileWithProgress).not.toHaveBeenCalled();
  });

  it('downloads assets when no bundled source exists', async () => {
    mockDownloadFileWithProgress.mockImplementation(async (_url: string, destPath: string) => {
      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      fs.writeFileSync(destPath, 'downloaded bytes');
    });

    await mod.ensureLanguageDataInstalled('zz', makeLangData());

    const installed = path.join(tempDir.tmpDir, 'language-data', 'dictionaries', 'zz', 'dictionary.db');
    expect(fs.readFileSync(installed, 'utf-8')).toBe('downloaded bytes');
    expect(mockDownloadFileWithProgress).toHaveBeenCalledWith(
      'https://example.com/language-data/zz/dictionary.db',
      installed,
      undefined,
    );
  });

  it('rejects language asset paths that escape the language data root', async () => {
    await expect(
      mod.ensureLanguageDataInstalled(
        'zz',
        makeLangData({
          languageData: {
            assets: [
              {
                id: 'bad',
                path: '../settings.json',
                bundledPath: 'dictionaries/zz/dictionary.db',
                required: true,
              },
            ],
          },
        }),
      ),
    ).rejects.toThrow('Invalid language data asset path');
  });
});
