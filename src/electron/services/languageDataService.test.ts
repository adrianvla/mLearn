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

  it('does not require component-scoped assets until that component is requested', () => {
    const langData = makeLangData({
      languageData: {
        assets: [
          {
            id: 'ocr-model',
            path: 'models/zz/ocr.bin',
            required: true,
            components: ['ocr'],
          },
        ],
      },
    });

    const coreStatus = mod.getLanguageDataStatus('zz', langData);
    const ocrStatus = mod.getLanguageDataStatus('zz', langData, undefined, { components: ['core', 'ocr'] });

    expect(coreStatus.installed).toBe(true);
    expect(coreStatus.missingAssets).toEqual([]);
    expect(ocrStatus.installed).toBe(false);
    expect(ocrStatus.missingAssets).toEqual(['ocr-model']);
  });

  it('requires custom language-brick components during a core language install', () => {
    const langData = makeLangData({
      languageData: {
        assets: [
          {
            id: 'segmenter-model',
            path: 'models/zz/segmenter.bin',
            required: true,
            components: ['segmentation'],
          },
          {
            id: 'voice-model',
            path: 'models/zz/voice.bin',
            required: true,
            components: ['voice'],
          },
        ],
      },
    });

    const coreStatus = mod.getLanguageDataStatus('zz', langData);

    expect(coreStatus.installed).toBe(false);
    expect(coreStatus.missingAssets).toEqual(['segmenter-model']);
  });

  it('treats stale installed language metadata as missing so runtime features update', async () => {
    const installedMetadataPath = path.join(tempDir.tmpDir, 'language-data', 'languages', 'zz.json');
    fs.mkdirSync(path.dirname(installedMetadataPath), { recursive: true });
    fs.writeFileSync(installedMetadataPath, JSON.stringify({ name: 'Old metadata' }), 'utf-8');

    const metadataBytes = JSON.stringify({
      name: 'Updated metadata',
      runtime: {
        ocr: {
          recognitionEngine: 'mangaocr',
          rapidLangType: 'JAPAN',
          paddleLang: 'japan',
        },
      },
    });
    const archiveSourceDir = path.join(tempDir.tmpDir, 'metadata-archive-source');
    const archivePath = path.join(tempDir.tmpDir, 'zz.tar.gz');
    const manifest = {
      schemaVersion: 1,
      language: 'zz',
      version: 'bundle-v2',
      files: [
        {
          id: 'language-metadata',
          path: 'languages/zz.json',
          sizeBytes: Buffer.byteLength(metadataBytes),
          sha256: sha256(metadataBytes),
          required: true,
        },
      ],
    };
    fs.mkdirSync(path.join(archiveSourceDir, 'files', 'languages'), { recursive: true });
    fs.writeFileSync(path.join(archiveSourceDir, 'manifest.json'), JSON.stringify(manifest), 'utf-8');
    fs.writeFileSync(path.join(archiveSourceDir, 'files', 'languages', 'zz.json'), metadataBytes, 'utf-8');
    await tar.c({ gzip: true, file: archivePath, cwd: archiveSourceDir }, ['manifest.json', 'files']);

    const langData = makeLangData({
      languageData: {
        version: 'bundle-v2',
        bundle: {
          url: 'https://example.com/language-data/zz.tar.gz',
          sizeBytes: fs.statSync(archivePath).size,
          sha256: sha256(fs.readFileSync(archivePath)),
        },
        assets: manifest.files,
      },
    });

    const beforeStatus = mod.getLanguageDataStatus('zz', langData);
    expect(beforeStatus.installed).toBe(false);
    expect(beforeStatus.outdated).toBe(true);
    expect(beforeStatus.missingAssets).toEqual(['language-metadata']);
    expect(beforeStatus.assets[0].validationIssue).toMatch(/^size-mismatch:/);

    mockDownloadFileWithProgress.mockImplementation(async (_url: string, destPath: string) => {
      fs.copyFileSync(archivePath, destPath);
    });

    await mod.ensureLanguageDataInstalled('zz', langData);

    expect(JSON.parse(fs.readFileSync(installedMetadataPath, 'utf-8')).runtime.ocr.recognitionEngine).toBe('mangaocr');
    expect(mockDownloadFileWithProgress).toHaveBeenCalledWith(
      'https://example.com/language-data/zz.tar.gz',
      expect.stringContaining('zz.tar.gz'),
      undefined,
    );
  });

  it('accepts same-version language metadata even when local normalized bytes differ from the catalog', () => {
    const installedMetadataPath = path.join(tempDir.tmpDir, 'language-data', 'languages', 'zz.json');
    fs.mkdirSync(path.dirname(installedMetadataPath), { recursive: true });
    fs.writeFileSync(
      installedMetadataPath,
      JSON.stringify({
        name: 'Updated metadata with package hotfix',
        languageData: { version: 'bundle-v2' },
        runtime: {
          nlp: {
            dictionary: {
              prosody: {
                table: 'pitch',
                headwordColumn: 'headword',
                dataColumn: 'data',
              },
            },
          },
        },
      }),
      'utf-8',
    );

    const langData = makeLangData({
      languageData: {
        version: 'bundle-v2',
        bundle: {
          url: 'https://example.com/language-data/zz.tar.gz',
        },
        assets: [
          {
            id: 'language-metadata',
            path: 'languages/zz.json',
            sizeBytes: 1,
            sha256: '0'.repeat(64),
            required: true,
          },
        ],
      },
    });

    const status = mod.getLanguageDataStatus('zz', langData);

    expect(status.installed).toBe(true);
    expect(status.outdated).toBe(false);
    expect(status.missingAssets).toEqual([]);
  });

  it('reports installed language metadata with an older embedded package version as outdated', () => {
    const installedMetadataPath = path.join(tempDir.tmpDir, 'language-data', 'languages', 'zz.json');
    fs.mkdirSync(path.dirname(installedMetadataPath), { recursive: true });
    fs.writeFileSync(
      installedMetadataPath,
      JSON.stringify({
        name: 'Old metadata',
        languageData: { version: 'bundle-v1' },
      }),
      'utf-8',
    );

    const langData = makeLangData({
      languageData: {
        version: 'bundle-v2',
        bundle: {
          url: 'https://example.com/language-data/zz.tar.gz',
        },
        assets: [
          {
            id: 'language-metadata',
            path: 'languages/zz.json',
            sizeBytes: fs.statSync(installedMetadataPath).size,
            required: true,
          },
        ],
      },
    });

    const status = mod.getLanguageDataStatus('zz', langData);

    expect(status.installed).toBe(false);
    expect(status.outdated).toBe(true);
    expect(status.missingAssets).toEqual(['language-metadata']);
    expect(status.assets[0].validationIssue).toBe('version-mismatch:bundle-v1');
  });

  it('keeps newer installed language metadata current when the remote catalog lags behind', () => {
    const installedMetadataPath = path.join(tempDir.tmpDir, 'language-data', 'languages', 'zz.json');
    fs.mkdirSync(path.dirname(installedMetadataPath), { recursive: true });
    fs.writeFileSync(
      installedMetadataPath,
      JSON.stringify({
        name: 'Newer metadata',
        languageData: { version: 'zz-package-2026.07.19' },
      }),
      'utf-8',
    );

    const langData = makeLangData({
      languageData: {
        version: 'zz-package-2026.06.29',
        bundle: {
          url: 'https://example.com/language-data/zz.tar.gz',
        },
        assets: [
          {
            id: 'language-metadata',
            path: 'languages/zz.json',
            sizeBytes: 1,
            sha256: '0'.repeat(64),
            required: true,
          },
        ],
      },
    });

    const status = mod.getLanguageDataStatus('zz', langData);

    expect(status.installed).toBe(true);
    expect(status.outdated).toBe(false);
    expect(status.missingAssets).toEqual([]);
  });

  it('reports an installed dictionary pack as outdated when its install receipt version is stale', () => {
    const dictionaryPath = path.join(tempDir.tmpDir, 'language-data', 'dictionaries', 'zz', 'fr', 'dictionary.db');
    fs.mkdirSync(path.dirname(dictionaryPath), { recursive: true });
    fs.writeFileSync(dictionaryPath, 'installed dictionary', 'utf-8');

    const receiptPath = path.join(tempDir.tmpDir, 'language-data', '.install-receipts', 'zz_fr.json');
    fs.mkdirSync(path.dirname(receiptPath), { recursive: true });
    fs.writeFileSync(receiptPath, JSON.stringify({ version: 'dict-v1' }), 'utf-8');

    const langData = makeLangData({
      languageData: {
        assets: [],
        dictionaryPacks: {
          fr: {
            targetLanguage: 'fr',
            name: 'French',
            version: 'dict-v2',
            bundle: { url: 'https://example.com/zz-fr.tar.gz' },
            assets: [
              {
                id: 'dictionary-fr',
                path: 'dictionaries/zz/fr/dictionary.db',
                sizeBytes: Buffer.byteLength('installed dictionary'),
                required: true,
              },
            ],
          },
        },
      },
    });

    const status = mod.getLanguageDataCatalogStatus(langData, '2.6.7')[0]?.dictionaryPacks?.[0];

    expect(status).toMatchObject({
      targetLanguage: 'fr',
      installed: false,
      outdated: true,
      missingRequiredAssets: [],
    });
  });

  it('resolves only explicitly available dictionary targets without sorted fallback', () => {
    const langData = makeLangData({
      languageData: {
        assets: [],
        dictionaryPacks: {
          en: {
            targetLanguage: 'en',
            name: 'English',
            bundle: { url: 'https://example.com/zz-en.tar.gz' },
            assets: [],
          },
          fr: {
            targetLanguage: 'fr',
            name: 'French',
            bundle: { url: 'https://example.com/zz-fr.tar.gz' },
            assets: [],
          },
        },
      },
    });

    expect(mod.resolveDictionaryTargetLanguage('zz', langData, 'fr')).toBe('fr');
    expect(mod.resolveDictionaryTargetLanguage('zz', langData, 'ru')).toBeUndefined();
    expect(mod.resolveDictionaryTargetLanguage('zz', langData)).toBeUndefined();
  });

  it('reports catalog install status for every known language without downloading assets', () => {
    const installedDictionary = path.join(tempDir.tmpDir, 'language-data', 'dictionaries', 'aa', 'dictionary.db');
    fs.mkdirSync(path.dirname(installedDictionary), { recursive: true });
    fs.writeFileSync(installedDictionary, 'installed bytes');

    const langData: LanguageDataMap = {
      zz: makeLangData({
        name: 'Zulu Test',
        languageData: {
          minimumAppVersion: '2.7.0',
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
      },
    };

    const statuses = mod.getLanguageDataCatalogStatus(langData, '2.6.7');

    expect(statuses.map((status) => status.language)).toEqual(['aa', 'bb', 'zz']);
    expect(statuses[0]).toMatchObject({
      language: 'aa',
      name: 'Afar Test',
      nameTranslated: 'Afar Local',
      installed: true,
      compatible: true,
      totalBytes: 15,
      installedBytes: 15,
      missingRequiredAssets: [],
    });
    expect(statuses[1]).toMatchObject({
      language: 'bb',
      name: 'Bare Metadata',
      installed: true,
      compatible: true,
      totalBytes: 0,
      installedBytes: 0,
      missingRequiredAssets: [],
    });
    expect(statuses[2]).toMatchObject({
      language: 'zz',
      name: 'Zulu Test',
      installed: false,
      compatible: false,
      minimumAppVersion: '2.7.0',
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

    const developmentStatuses = mod.getLanguageDataCatalogStatus(langData, '2.6.7', true);
    expect(developmentStatuses.find((status) => status.language === 'zz')).toMatchObject({
      compatible: true,
      minimumAppVersion: '2.7.0',
    });
  });

  it('blocks installation when the language requires a newer app version', async () => {
    const langData = makeLangData({
      languageData: {
        minimumAppVersion: '2.7.0',
        bundle: { url: 'https://example.com/language-data/zz.tar.gz' },
        assets: [],
      },
    });

    await expect(mod.ensureLanguageDataInstalled(
      'zz',
      langData,
      undefined,
      undefined,
      { currentAppVersion: '2.6.7' },
    )).rejects.toThrow('Test Language requires mLearn 2.7.0 or later');
    expect(mockDownloadFileWithProgress).not.toHaveBeenCalled();
  });

  it('allows an incompatible language package when the app enables the development override', async () => {
    const status = await mod.ensureLanguageDataInstalled(
      'zz',
      makeLangData({
        languageData: {
          minimumAppVersion: '2.7.0',
          assets: [],
        },
      }),
      undefined,
      undefined,
      { currentAppVersion: '2.6.7', allowIncompatibleAppVersion: true },
    );

    expect(status.installed).toBe(true);
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

  it('installs only assets scoped to the requested language components from a bundle', async () => {
    const archiveSourceDir = path.join(tempDir.tmpDir, 'component-archive-source');
    const archivePath = path.join(tempDir.tmpDir, 'zz-components.tar.gz');
    const coreBytes = JSON.stringify({ name: 'Component Test' });
    const ocrBytes = 'ocr model bytes';
    const segmentationBytes = 'segmentation model bytes';
    const manifest = {
      schemaVersion: 1,
      language: 'zz',
      version: 'bundle-components-v1',
      files: [
        {
          id: 'language-metadata',
          path: 'languages/zz.json',
          sizeBytes: Buffer.byteLength(coreBytes),
          sha256: sha256(coreBytes),
          required: true,
          components: ['core'],
        },
        {
          id: 'ocr-model',
          path: 'models/zz/ocr.bin',
          sizeBytes: Buffer.byteLength(ocrBytes),
          sha256: sha256(ocrBytes),
          required: true,
          components: ['ocr'],
        },
        {
          id: 'segmenter-model',
          path: 'models/zz/segmenter.bin',
          sizeBytes: Buffer.byteLength(segmentationBytes),
          sha256: sha256(segmentationBytes),
          required: true,
          components: ['segmentation'],
        },
      ],
    };
    fs.mkdirSync(path.join(archiveSourceDir, 'files', 'languages'), { recursive: true });
    fs.mkdirSync(path.join(archiveSourceDir, 'files', 'models', 'zz'), { recursive: true });
    fs.writeFileSync(path.join(archiveSourceDir, 'manifest.json'), JSON.stringify(manifest), 'utf-8');
    fs.writeFileSync(path.join(archiveSourceDir, 'files', 'languages', 'zz.json'), coreBytes, 'utf-8');
    fs.writeFileSync(path.join(archiveSourceDir, 'files', 'models', 'zz', 'ocr.bin'), ocrBytes, 'utf-8');
    fs.writeFileSync(path.join(archiveSourceDir, 'files', 'models', 'zz', 'segmenter.bin'), segmentationBytes, 'utf-8');
    await tar.c({ gzip: true, file: archivePath, cwd: archiveSourceDir }, ['manifest.json', 'files']);

    mockDownloadFileWithProgress.mockImplementation(async (_url: string, destPath: string) => {
      fs.copyFileSync(archivePath, destPath);
    });

    const langData = makeLangData({
      languageData: {
        version: 'bundle-components-v1',
        bundle: {
          url: 'https://example.com/language-data/zz-components.tar.gz',
          sizeBytes: fs.statSync(archivePath).size,
          sha256: sha256(fs.readFileSync(archivePath)),
        },
        assets: manifest.files,
      },
    });

    await mod.ensureLanguageDataInstalled('zz', langData);

    expect(fs.existsSync(path.join(tempDir.tmpDir, 'language-data', 'languages', 'zz.json'))).toBe(true);
    expect(fs.readFileSync(path.join(tempDir.tmpDir, 'language-data', 'models', 'zz', 'segmenter.bin'), 'utf-8')).toBe(segmentationBytes);
    expect(fs.existsSync(path.join(tempDir.tmpDir, 'language-data', 'models', 'zz', 'ocr.bin'))).toBe(false);

    await mod.ensureLanguageDataInstalled('zz', langData, undefined, undefined, { components: ['core', 'ocr'] });

    expect(fs.readFileSync(path.join(tempDir.tmpDir, 'language-data', 'models', 'zz', 'ocr.bin'), 'utf-8')).toBe(ocrBytes);
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

    const installedMetadataPath = path.join(tempDir.tmpDir, 'language-data', 'languages', 'zz.json');
    fs.mkdirSync(path.dirname(installedMetadataPath), { recursive: true });
    fs.writeFileSync(installedMetadataPath, JSON.stringify({
      name: 'Zulu Test',
      languageData: {
        version: 'core-v1',
        dictionaryPacks: {
          fr: {
            targetLanguage: 'fr',
            name: 'French',
            version: 'zz-fr-dictionary-v0',
            assets: [],
          },
        },
      },
    }), 'utf-8');

    const status = await (mod.ensureLanguageDataInstalled as unknown as (
      language: string,
      langData: LanguageDataMap,
      onProgress?: Parameters<typeof mod.ensureLanguageDataInstalled>[2],
      dictionaryTargetLanguage?: string,
    ) => Promise<ReturnType<typeof mod.getLanguageDataStatus>>)('zz', makeLangData({
      languageData: {
        version: 'core-v1',
        bundle: {
          url: 'https://example.com/language-data/zz-core.tar.gz',
          sizeBytes: 1,
          sha256: 'unused',
        },
        assets: [
          {
            id: 'language-metadata',
            path: 'languages/zz.json',
            required: true,
          },
        ],
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

    expect(status).toMatchObject({
      language: 'zz',
      dictionaryTargetLanguage: 'fr',
      installed: true,
      missingAssets: [],
    });
    expect(mockDownloadFileWithProgress).toHaveBeenCalledWith(
      'https://example.com/language-data/zz-fr-dictionary.tar.gz',
      expect.stringContaining('zz-fr-dictionary.tar.gz'),
      undefined,
    );
    expect(fs.readFileSync(path.join(tempDir.tmpDir, 'language-data', 'dictionaries', 'zz', 'dictionary.db'), 'utf-8')).toBe(dictionaryBytes);
    const installedMetadata = JSON.parse(fs.readFileSync(installedMetadataPath, 'utf-8')) as {
      languageData?: { dictionaryPacks?: { fr?: { version?: string; bundle?: { sha256?: string } } } };
    };
    expect(installedMetadata.languageData?.dictionaryPacks?.fr).toMatchObject({
      version: 'zz-fr-dictionary-v1',
      bundle: { sha256: sha256(fs.readFileSync(archivePath)) },
    });
  });

  it('rejects a dictionary pack archive that declares a different target language', async () => {
    const archiveSourceDir = path.join(tempDir.tmpDir, 'wrong-dictionary-target-source');
    const archivePath = path.join(tempDir.tmpDir, 'zz-fr-dictionary.tar.gz');
    const dictionaryBytes = 'english dictionary bytes';
    const manifest = {
      schemaVersion: 1,
      language: 'zz',
      targetLanguage: 'en',
      version: 'zz-en-dictionary-v1',
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
              sha256: sha256(fs.readFileSync(archivePath)),
            },
            assets: manifest.files,
          },
        },
      } as unknown as LanguageDataMap[string]['languageData'],
    }), undefined, 'fr')).rejects.toThrow(
      'Language data bundle manifest target mismatch for zz:fr; got en',
    );

    expect(fs.existsSync(path.join(tempDir.tmpDir, 'language-data', 'dictionaries', 'zz', 'fr', 'dictionary.db'))).toBe(false);
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

  it('does not delete undeclared stale language adapter files during a core bundle install', async () => {
    const installedLanguageDir = path.join(tempDir.tmpDir, 'language-data', 'languages');
    const staleAdapterPath = path.join(installedLanguageDir, 'zz.py');
    const staleAdapterBytes = "raise RuntimeError('stale adapter should be ignored by metadata')\n";
    fs.mkdirSync(installedLanguageDir, { recursive: true });
    fs.writeFileSync(staleAdapterPath, staleAdapterBytes, 'utf-8');

    const archiveSourceDir = path.join(tempDir.tmpDir, 'metadata-only-archive-source');
    const archivePath = path.join(tempDir.tmpDir, 'zz-metadata-only.tar.gz');
    const metadataBytes = JSON.stringify({
      name: 'Metadata Only',
      runtime: {
        nlp: {
          tokenizer: { type: 'unicode-word' },
        },
      },
    });
    const manifest = {
      schemaVersion: 1,
      language: 'zz',
      version: 'metadata-only-v1',
      files: [
        {
          id: 'language-metadata',
          path: 'languages/zz.json',
          sizeBytes: Buffer.byteLength(metadataBytes),
          sha256: sha256(metadataBytes),
          required: true,
        },
      ],
    };
    fs.mkdirSync(path.join(archiveSourceDir, 'files', 'languages'), { recursive: true });
    fs.writeFileSync(path.join(archiveSourceDir, 'manifest.json'), JSON.stringify(manifest), 'utf-8');
    fs.writeFileSync(path.join(archiveSourceDir, 'files', 'languages', 'zz.json'), metadataBytes, 'utf-8');
    await tar.c({ gzip: true, file: archivePath, cwd: archiveSourceDir }, ['manifest.json', 'files']);

    mockDownloadFileWithProgress.mockImplementation(async (_url: string, destPath: string) => {
      fs.copyFileSync(archivePath, destPath);
    });

    await mod.ensureLanguageDataInstalled('zz', makeLangData({
      languageData: {
        version: 'metadata-only-v1',
        bundle: {
          url: 'https://example.com/language-data/zz-metadata-only.tar.gz',
          sizeBytes: fs.statSync(archivePath).size,
          sha256: sha256(fs.readFileSync(archivePath)),
        },
        assets: manifest.files,
      },
    }));

    expect(fs.readFileSync(staleAdapterPath, 'utf-8')).toBe(staleAdapterBytes);
    expect(fs.readFileSync(path.join(installedLanguageDir, 'zz.json'), 'utf-8')).toBe(metadataBytes);
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
