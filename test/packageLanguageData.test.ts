import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import * as tar from 'tar';
import { createTempDir, type TempDir } from './helpers/tempDir';

const require = createRequire(import.meta.url);

interface PackageLanguageDataModule {
  createLanguageDataRelease: (options: {
    projectRoot: string;
    rootOfApp: string;
    outputDir: string;
    catalogPath: string;
    assetBaseUrl: string;
    generatedAt: string;
  }) => Promise<{
    assetCount: number;
    catalogPath: string;
    assetManifestPath: string;
  }>;
}

const { createLanguageDataRelease } = require('../scripts/package-language-data.js') as PackageLanguageDataModule;

describe('package-language-data', () => {
  let tempDir: TempDir;

  beforeEach(() => {
    tempDir = createTempDir('mlearn-language-package-');
  });

  afterEach(() => {
    tempDir.cleanup();
  });

  it('generates a Pages catalog with one CDN tar bundle per language', async () => {
    const rootOfApp = path.join(tempDir.tmpDir, 'root-of-app');
    const languagesDir = path.join(rootOfApp, 'languages');
    const dictionariesDir = path.join(rootOfApp, 'dictionaries', 'aa');
    fs.mkdirSync(languagesDir, { recursive: true });
    fs.mkdirSync(dictionariesDir, { recursive: true });
    fs.writeFileSync(path.join(dictionariesDir, 'dictionary.db'), 'dictionary contents', 'utf-8');
    fs.writeFileSync(path.join(languagesDir, 'aa.freq.json'), JSON.stringify({ freq: [['alpha', 'alpha']] }), 'utf-8');
    fs.writeFileSync(path.join(languagesDir, 'aa.json'), JSON.stringify({
      name: 'Alpha',
      name_translated: 'Alpha',
      translatable: ['WORD'],
      colour_codes: {},
      fixed_settings: {},
      languageData: {
        version: 'fixture-v1',
        assets: [{
          id: 'dictionary',
          path: 'dictionaries/aa/dictionary.db',
          bundledPath: 'dictionaries/aa/dictionary.db',
          url: 'https://old.example.com/stale.db',
          sizeBytes: 1,
          sha256: 'stale',
          required: true,
        }],
      },
    }), 'utf-8');

    const outputDir = path.join(tempDir.tmpDir, 'release', 'language-data');
    const catalogPath = path.join(tempDir.tmpDir, 'release', 'language-catalog.json');
    const result = await createLanguageDataRelease({
      projectRoot: tempDir.tmpDir,
      rootOfApp,
      outputDir,
      catalogPath,
      assetBaseUrl: 'https://cdn.example.com/mlearn/language-data/',
      generatedAt: '2026-06-28T00:00:00.000Z',
    });

    expect(result.assetCount).toBe(2);
    const bundlePath = path.join(outputDir, 'language-aa-fixture-v1.tar.gz');
    expect(fs.existsSync(bundlePath)).toBe(true);
    expect(fs.existsSync(path.join(outputDir, 'language-aa-dictionary.db'))).toBe(false);

    const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf-8'));
    expect(catalog.languages['aa.freq']).toBeUndefined();
    expect(catalog.languages.aa).toMatchObject({
      name: 'Alpha',
      nameTranslated: 'Alpha',
      version: 'fixture-v1',
      bundle: {
        url: 'https://cdn.example.com/mlearn/language-data/language-aa-fixture-v1.tar.gz',
        sizeBytes: fs.statSync(bundlePath).size,
      },
    });
    expect(catalog.languages.aa.bundle.sha256).toHaveLength(64);

    const extractDir = path.join(tempDir.tmpDir, 'extract');
    fs.mkdirSync(extractDir);
    await tar.x({ file: bundlePath, cwd: extractDir });
    const bundleManifest = JSON.parse(fs.readFileSync(path.join(extractDir, 'manifest.json'), 'utf-8'));
    expect(bundleManifest).toMatchObject({
      schemaVersion: 1,
      language: 'aa',
      version: 'fixture-v1',
      files: [
        expect.objectContaining({
          path: 'dictionaries/aa/dictionary.db',
          sizeBytes: Buffer.byteLength('dictionary contents'),
        }),
        expect.objectContaining({
          path: 'languages/aa.json',
        }),
      ],
    });
    expect(fs.readFileSync(path.join(extractDir, 'files', 'dictionaries', 'aa', 'dictionary.db'), 'utf-8')).toBe('dictionary contents');

    const asset = bundleManifest.files[0];
    expect(asset.sizeBytes).toBe(Buffer.byteLength('dictionary contents'));
    expect(asset.sha256).toBe('813c342981b3cc38027144a776c1237792c15552f5eaed6bf0af62a7711d2dbd');

    const assetManifest = JSON.parse(fs.readFileSync(result.assetManifestPath, 'utf-8'));
    expect(assetManifest.bundles[0]).toMatchObject({
      language: 'aa',
      fileName: 'language-aa-fixture-v1.tar.gz',
      publicUrl: 'https://cdn.example.com/mlearn/language-data/language-aa-fixture-v1.tar.gz',
    });
  });
});
