import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import * as tar from 'tar';
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

function sha256(value: string | Buffer): string {
  return crypto.createHash('sha256').update(value).digest('hex');
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

  it('reports catalog install status for every known language without downloading assets', () => {
    const installedDictionary = path.join(tempDir.tmpDir, 'language-data', 'dictionaries', 'aa', 'dictionary.db');
    fs.mkdirSync(path.dirname(installedDictionary), { recursive: true });
    fs.writeFileSync(installedDictionary, 'installed bytes');

    const langData: LanguageDataMap = {
      zz: makeLangData({
        name: 'Zulu Test',
        languageData: {
          assets: [
            {
              id: 'dictionary',
              path: 'dictionaries/zz/dictionary.db',
              sizeBytes: 100,
              required: true,
            },
            {
              id: 'frequency',
              path: 'languages/zz.freq.json',
              sizeBytes: 20,
              required: false,
            },
          ],
          dictionaryPacks: {
            fr: {
              targetLanguage: 'fr',
              name: 'French definitions',
              bundle: {
                url: 'https://example.com/language-data/zz-fr-dictionary.tar.gz',
                sizeBytes: 75,
              },
              assets: [
                {
                  id: 'dictionary-fr',
                  path: 'dictionaries/zz/fr/dictionary.db',
                  sizeBytes: 75,
                  required: true,
                },
              ],
            },
          },
        },
      }).zz,
      aa: makeLangData({
        name: 'Afar Test',
        name_translated: 'Afar Local',
        languageData: {
          assets: [
            {
              id: 'dictionary',
              path: 'dictionaries/aa/dictionary.db',
              sizeBytes: 15,
              required: true,
            },
          ],
        },
      }).zz,
      bb: {
        name: 'Bare Metadata',
        translatable: [],
        colour_codes: {},
        fixed_settings: {},
      },
    };

    const statuses = mod.getLanguageDataCatalogStatus(langData);

    expect(statuses.map((status) => status.language)).toEqual(['aa', 'bb', 'zz']);
    expect(statuses[0]).toMatchObject({
      language: 'aa',
      name: 'Afar Test',
      nameTranslated: 'Afar Local',
      installed: true,
      totalBytes: 15,
      installedBytes: 15,
      missingRequiredAssets: [],
    });
    expect(statuses[1]).toMatchObject({
      language: 'bb',
      name: 'Bare Metadata',
      installed: true,
      totalBytes: 0,
      installedBytes: 0,
      missingRequiredAssets: [],
    });
    expect(statuses[2]).toMatchObject({
      language: 'zz',
      name: 'Zulu Test',
      installed: false,
      totalBytes: 120,
      installedBytes: 0,
      missingRequiredAssets: ['dictionary'],
      dictionaryPacks: [
        {
          targetLanguage: 'fr',
          name: 'French definitions',
          installed: false,
          totalBytes: 75,
          installedBytes: 0,
          missingRequiredAssets: ['dictionary-fr'],
        },
      ],
    });
    expect(mockDownloadFileWithProgress).not.toHaveBeenCalled();
  });

  it('rejects missing required assets when the package catalog has no bundle', async () => {
    await expect(mod.ensureLanguageDataInstalled('zz', makeLangData())).rejects.toThrow(
      'No language data bundle is available for zz',
    );
    expect(mockDownloadFileWithProgress).not.toHaveBeenCalled();
  });

  it('downloads and extracts a verified language bundle archive', async () => {
    const archiveSourceDir = path.join(tempDir.tmpDir, 'archive-source');
    const archivePath = path.join(tempDir.tmpDir, 'zz.tar.gz');
    const dictionaryBytes = 'bundle dictionary bytes';
    const frequencyBytes = JSON.stringify({ freq: [['zeta', 'zeta']] });
    const manifest = {
      schemaVersion: 1,
      language: 'zz',
      version: 'bundle-v1',
      files: [
        {
          id: 'dictionary',
          path: 'dictionaries/zz/dictionary.db',
          sizeBytes: Buffer.byteLength(dictionaryBytes),
          sha256: sha256(dictionaryBytes),
          required: true,
        },
        {
          id: 'frequency',
          path: 'languages/zz.freq.json',
          sizeBytes: Buffer.byteLength(frequencyBytes),
          sha256: sha256(frequencyBytes),
          required: true,
        },
      ],
    };
    fs.mkdirSync(path.join(archiveSourceDir, 'files', 'dictionaries', 'zz'), { recursive: true });
    fs.mkdirSync(path.join(archiveSourceDir, 'files', 'languages'), { recursive: true });
    fs.writeFileSync(path.join(archiveSourceDir, 'manifest.json'), JSON.stringify(manifest), 'utf-8');
    fs.writeFileSync(path.join(archiveSourceDir, 'files', 'dictionaries', 'zz', 'dictionary.db'), dictionaryBytes, 'utf-8');
    fs.writeFileSync(path.join(archiveSourceDir, 'files', 'languages', 'zz.freq.json'), frequencyBytes, 'utf-8');
    await tar.c({ gzip: true, file: archivePath, cwd: archiveSourceDir }, ['manifest.json', 'files']);

    mockDownloadFileWithProgress.mockImplementation(async (_url: string, destPath: string) => {
      fs.copyFileSync(archivePath, destPath);
    });

    await mod.ensureLanguageDataInstalled('zz', makeLangData({
      languageData: {
        version: 'bundle-v1',
        bundle: {
          url: 'https://example.com/language-data/zz.tar.gz',
          sizeBytes: fs.statSync(archivePath).size,
          sha256: sha256(fs.readFileSync(archivePath)),
        },
        assets: manifest.files,
      },
    }));

    expect(mockDownloadFileWithProgress).toHaveBeenCalledWith(
      'https://example.com/language-data/zz.tar.gz',
      expect.stringContaining('zz.tar.gz'),
      undefined,
    );
    expect(fs.readFileSync(path.join(tempDir.tmpDir, 'language-data', 'dictionaries', 'zz', 'dictionary.db'), 'utf-8')).toBe(dictionaryBytes);
    expect(fs.readFileSync(path.join(tempDir.tmpDir, 'language-data', 'languages', 'zz.freq.json'), 'utf-8')).toBe(frequencyBytes);
  });

  it('ignores macOS metadata entries in language bundle archives', async () => {
    const archiveSourceDir = path.join(tempDir.tmpDir, 'archive-source');
    const archivePath = path.join(tempDir.tmpDir, 'zz-with-metadata.tar.gz');
    const dictionaryBytes = 'bundle dictionary bytes';
    const manifest = {
      schemaVersion: 1,
      language: 'zz',
      version: 'bundle-v1',
      files: [
        {
          id: 'dictionary',
          path: 'dictionaries/zz/dictionary.db',
          sizeBytes: Buffer.byteLength(dictionaryBytes),
          sha256: sha256(dictionaryBytes),
          required: true,
        },
      ],
    };
    fs.mkdirSync(path.join(archiveSourceDir, 'files', 'dictionaries', 'zz'), { recursive: true });
    fs.mkdirSync(path.join(archiveSourceDir, '__MACOSX'), { recursive: true });
    fs.writeFileSync(path.join(archiveSourceDir, 'manifest.json'), JSON.stringify(manifest), 'utf-8');
    fs.writeFileSync(path.join(archiveSourceDir, '._manifest.json'), 'mac metadata', 'utf-8');
    fs.writeFileSync(path.join(archiveSourceDir, 'files', '.DS_Store'), 'finder metadata', 'utf-8');
    fs.writeFileSync(path.join(archiveSourceDir, '__MACOSX', 'manifest.json'), 'mac metadata', 'utf-8');
    fs.writeFileSync(path.join(archiveSourceDir, 'files', 'dictionaries', 'zz', 'dictionary.db'), dictionaryBytes, 'utf-8');
    fs.writeFileSync(path.join(archiveSourceDir, 'files', 'dictionaries', 'zz', '._dictionary.db'), 'mac metadata', 'utf-8');
    await tar.c({ gzip: true, file: archivePath, cwd: archiveSourceDir }, [
      'manifest.json',
      '._manifest.json',
      '__MACOSX',
      'files',
    ]);

    mockDownloadFileWithProgress.mockImplementation(async (_url: string, destPath: string) => {
      fs.copyFileSync(archivePath, destPath);
    });

    await mod.ensureLanguageDataInstalled('zz', makeLangData({
      languageData: {
        version: 'bundle-v1',
        bundle: {
          url: 'https://example.com/language-data/zz.tar.gz',
          sizeBytes: fs.statSync(archivePath).size,
          sha256: sha256(fs.readFileSync(archivePath)),
        },
        assets: manifest.files,
      },
    }));

    expect(fs.readFileSync(path.join(tempDir.tmpDir, 'language-data', 'dictionaries', 'zz', 'dictionary.db'), 'utf-8')).toBe(dictionaryBytes);
  });

  it('downloads a selected dictionary pack separately from the core language bundle', async () => {
    const archiveSourceDir = path.join(tempDir.tmpDir, 'dictionary-archive-source');
    const archivePath = path.join(tempDir.tmpDir, 'zz-fr-dictionary.tar.gz');
    const dictionaryBytes = 'french dictionary bytes';
    const manifest = {
      schemaVersion: 1,
      language: 'zz',
      version: 'zz-fr-dictionary-v1',
      files: [
        {
          id: 'dictionary',
          path: 'dictionaries/zz/dictionary.db',
          sizeBytes: Buffer.byteLength(dictionaryBytes),
          sha256: sha256(dictionaryBytes),
          required: true,
        },
      ],
    };
    fs.mkdirSync(path.join(archiveSourceDir, 'files', 'dictionaries', 'zz'), { recursive: true });
    fs.writeFileSync(path.join(archiveSourceDir, 'manifest.json'), JSON.stringify(manifest), 'utf-8');
    fs.writeFileSync(path.join(archiveSourceDir, 'files', 'dictionaries', 'zz', 'dictionary.db'), dictionaryBytes, 'utf-8');
    await tar.c({ gzip: true, file: archivePath, cwd: archiveSourceDir }, ['manifest.json', 'files']);

    mockDownloadFileWithProgress.mockImplementation(async (_url: string, destPath: string) => {
      fs.copyFileSync(archivePath, destPath);
    });

    await (mod.ensureLanguageDataInstalled as unknown as (
      language: string,
      langData: LanguageDataMap,
      onProgress?: Parameters<typeof mod.ensureLanguageDataInstalled>[2],
      dictionaryTargetLanguage?: string,
    ) => Promise<unknown>)('zz', makeLangData({
      languageData: {
        version: 'core-v1',
        bundle: {
          url: 'https://example.com/language-data/zz-core.tar.gz',
          sizeBytes: 1,
          sha256: 'unused',
        },
        assets: [],
        dictionaryPacks: {
          fr: {
            targetLanguage: 'fr',
            name: 'French',
            version: 'zz-fr-dictionary-v1',
            bundle: {
              url: 'https://example.com/language-data/zz-fr-dictionary.tar.gz',
              sizeBytes: fs.statSync(archivePath).size,
              sha256: sha256(fs.readFileSync(archivePath)),
            },
            assets: manifest.files,
          },
        },
      } as unknown as LanguageDataMap[string]['languageData'],
    }), undefined, 'fr');

    expect(mockDownloadFileWithProgress).toHaveBeenCalledWith(
      'https://example.com/language-data/zz-fr-dictionary.tar.gz',
      expect.stringContaining('zz-fr-dictionary.tar.gz'),
      undefined,
    );
    expect(fs.readFileSync(path.join(tempDir.tmpDir, 'language-data', 'dictionaries', 'zz', 'dictionary.db'), 'utf-8')).toBe(dictionaryBytes);
  });

  it('reports the selected dictionary bundle when its archive checksum does not match', async () => {
    const archiveSourceDir = path.join(tempDir.tmpDir, 'bad-dictionary-archive-source');
    const archivePath = path.join(tempDir.tmpDir, 'zz-fr-dictionary.tar.gz');
    const dictionaryBytes = 'french dictionary bytes';
    const manifest = {
      schemaVersion: 1,
      language: 'zz',
      version: 'zz-fr-dictionary-v1',
      files: [
        {
          id: 'dictionary-fr',
          path: 'dictionaries/zz/fr/dictionary.db',
          sizeBytes: Buffer.byteLength(dictionaryBytes),
          sha256: sha256(dictionaryBytes),
          required: true,
        },
      ],
    };
    fs.mkdirSync(path.join(archiveSourceDir, 'files', 'dictionaries', 'zz', 'fr'), { recursive: true });
    fs.writeFileSync(path.join(archiveSourceDir, 'manifest.json'), JSON.stringify(manifest), 'utf-8');
    fs.writeFileSync(path.join(archiveSourceDir, 'files', 'dictionaries', 'zz', 'fr', 'dictionary.db'), dictionaryBytes, 'utf-8');
    await tar.c({ gzip: true, file: archivePath, cwd: archiveSourceDir }, ['manifest.json', 'files']);

    mockDownloadFileWithProgress.mockImplementation(async (_url: string, destPath: string) => {
      fs.copyFileSync(archivePath, destPath);
    });

    await expect(mod.ensureLanguageDataInstalled('zz', makeLangData({
      languageData: {
        version: 'core-v1',
        assets: [],
        dictionaryPacks: {
          fr: {
            targetLanguage: 'fr',
            name: 'French',
            version: 'zz-fr-dictionary-v1',
            bundle: {
              url: 'https://example.com/language-data/zz-fr-dictionary.tar.gz',
              sizeBytes: fs.statSync(archivePath).size,
              sha256: '0'.repeat(64),
            },
            assets: manifest.files,
          },
        },
      } as unknown as LanguageDataMap[string]['languageData'],
    }), undefined, 'fr')).rejects.toThrow(
      /Checksum mismatch for language data bundle zz-fr-dictionary \(https:\/\/example\.com\/language-data\/zz-fr-dictionary\.tar\.gz\): expected 0000000000000000000000000000000000000000000000000000000000000000, got [a-f0-9]{64}/,
    );

    expect(fs.existsSync(path.join(tempDir.tmpDir, 'language-data', 'dictionaries', 'zz', 'fr', 'dictionary.db'))).toBe(false);
  });

  it('coalesces concurrent installs for the same dictionary pack', async () => {
    const archiveSourceDir = path.join(tempDir.tmpDir, 'dictionary-archive-source');
    const archivePath = path.join(tempDir.tmpDir, 'zz-fr-dictionary.tar.gz');
    const dictionaryBytes = 'shared dictionary bytes';
    const manifest = {
      schemaVersion: 1,
      language: 'zz',
      version: 'zz-fr-dictionary-v1',
      files: [
        {
          id: 'dictionary',
          path: 'dictionaries/zz/fr/dictionary.db',
          sizeBytes: Buffer.byteLength(dictionaryBytes),
          sha256: sha256(dictionaryBytes),
          required: true,
        },
      ],
    };
    fs.mkdirSync(path.join(archiveSourceDir, 'files', 'dictionaries', 'zz', 'fr'), { recursive: true });
    fs.writeFileSync(path.join(archiveSourceDir, 'manifest.json'), JSON.stringify(manifest), 'utf-8');
    fs.writeFileSync(path.join(archiveSourceDir, 'files', 'dictionaries', 'zz', 'fr', 'dictionary.db'), dictionaryBytes, 'utf-8');
    await tar.c({ gzip: true, file: archivePath, cwd: archiveSourceDir }, ['manifest.json', 'files']);

    let releaseDownload: (() => void) | undefined;
    const downloadStarted = new Promise<void>((resolve) => {
      mockDownloadFileWithProgress.mockImplementation(async (_url: string, destPath: string) => {
        resolve();
        await new Promise<void>((release) => {
          releaseDownload = release;
        });
        fs.copyFileSync(archivePath, destPath);
      });
    });

    const langData = makeLangData({
      languageData: {
        version: 'core-v1',
        assets: [],
        dictionaryPacks: {
          fr: {
            targetLanguage: 'fr',
            name: 'French',
            version: 'zz-fr-dictionary-v1',
            bundle: {
              url: 'https://example.com/language-data/zz-fr-dictionary.tar.gz',
              sizeBytes: fs.statSync(archivePath).size,
              sha256: sha256(fs.readFileSync(archivePath)),
            },
            assets: manifest.files,
          },
        },
      } as unknown as LanguageDataMap[string]['languageData'],
    });

    const firstInstall = mod.ensureLanguageDataInstalled('zz', langData, undefined, 'fr');
    await downloadStarted;
    const secondInstall = mod.ensureLanguageDataInstalled('zz', langData, undefined, 'fr');
    releaseDownload?.();
    await Promise.all([firstInstall, secondInstall]);

    expect(mockDownloadFileWithProgress).toHaveBeenCalledTimes(1);
    expect(fs.readFileSync(path.join(tempDir.tmpDir, 'language-data', 'dictionaries', 'zz', 'fr', 'dictionary.db'), 'utf-8')).toBe(dictionaryBytes);
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
