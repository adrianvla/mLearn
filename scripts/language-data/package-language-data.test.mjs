import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { createLanguageDataRelease } from './package-language-data.mjs';

let tempDir;

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

function extractTarGz(archivePath, destination) {
  fs.mkdirSync(destination, { recursive: true });
  execFileSync('tar', ['-xzf', archivePath, '-C', destination], { stdio: 'pipe' });
}

function findArchivePath(outputDir, relativeDir, prefix) {
  const archiveDir = path.join(outputDir, relativeDir);
  const matches = fs.readdirSync(archiveDir)
    .filter((fileName) => fileName.startsWith(prefix) && /^[a-z0-9._-]+-[a-f0-9]{12}\.tar\.gz$/.test(fileName))
    .sort();
  assert.equal(matches.length, 1, `Expected one content-hashed archive in ${archiveDir}`);
  return path.join(archiveDir, matches[0]);
}

function relativeArchivePath(outputDir, archivePath) {
  return path.relative(outputDir, archivePath).split(path.sep).join('/');
}

describe('package-language-data', () => {
  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mlearn-language-package-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('publishes a flag emoji for every supported learning language', () => {
    const expectedFlags = {
      de: '🇩🇪',
      ja: '🇯🇵',
      ru: '🇷🇺',
      'zh-Hans': '🇨🇳',
      'zh-Hant': '🇹🇼',
    };

    for (const [language, flagEmoji] of Object.entries(expectedFlags)) {
      const metadata = readJson(path.join(
        process.cwd(),
        `scripts/language-data/source/root-of-app/languages/${language}.json`,
      ));
      assert.equal(metadata.flagEmoji, flagEmoji);
    }
  });

  it('declares Japanese runtime Python requirements in language metadata', () => {
    const metadata = readJson(path.join(
      process.cwd(),
      'scripts/language-data/source/root-of-app/languages/ja.json',
    ));

    assert.deepEqual(metadata.runtime?.python?.packagesByComponent?.core, [
      'sudachipy',
      'sudachidict_small',
    ]);
    assert.equal(metadata.runtime?.ocr?.recognitionEngine, 'mangaocr');
    assert.deepEqual(metadata.runtime?.python?.packagesByComponent?.ocr, [
      'paddlepaddle==3.2.2',
      'paddleocr>=2.7.3',
      'manga-ocr',
      'sentencepiece',
      'rapidocr',
      'onnxruntime',
      'opencv-python-headless',
    ]);
    assert.deepEqual(metadata.runtime?.python?.packagesByComponent?.voice, [
      'misaki',
      'fugashi[unidic-lite]',
      'jaconv',
      'pyopenjtalk',
      'mojimoji',
    ]);
  });

  it('keeps Japanese frequency rows on the current numeric-level contract', () => {
    const languagePath = path.join(
      process.cwd(),
      'scripts/language-data/source/root-of-app/languages/ja.json',
    );
    const frequencyPath = path.join(
      process.cwd(),
      'scripts/language-data/source/root-of-app/languages/ja.freq.json',
    );
    const metadata = readJson(languagePath);
    const frequency = readJson(frequencyPath);
    const rows = frequency.freq;

    assert.equal(metadata.frequencyLevels?.rowLevelIndex, 2);
    assert.deepEqual(metadata.frequencyLevels?.names, {
      '1': 'JLPT N1',
      '2': 'JLPT N2',
      '3': 'JLPT N3',
      '4': 'JLPT N4',
      '5': 'JLPT N5',
    });
    assert.equal(Array.isArray(rows), true);
    assert.equal(rows.some((row) => row[0] === row[1] && /^N[1-5]$/.test(row[0])), false);
    assert.equal(rows.some((row) => !String(row[0]).trim() && !String(row[1]).trim()), false);
    assert.deepEqual(rows.slice(0, 3), [
      ['会う', 'あう', 5],
      ['青', 'あお', 5],
      ['青い', 'あおい', 5],
    ]);
    assert.equal(rows.every((row) => Number.isInteger(row[2]) && row[2] >= 1 && row[2] <= 5), true);
  });

  it('declares complete Russian and Chinese learning capabilities without duplicate prosody', () => {
    const languagesDir = path.join(
      process.cwd(),
      'scripts/language-data/source/root-of-app/languages',
    );
    const russian = readJson(path.join(languagesDir, 'ru.json'));
    const simplified = readJson(path.join(languagesDir, 'zh-Hans.json'));
    const traditional = readJson(path.join(languagesDir, 'zh-Hant.json'));

    assert.equal(russian.textProcessing?.readingAnnotation?.display, 'replace');
    assert.equal(russian.runtime?.adapter?.path, 'adapters/russian_adapter.py');
    assert.equal(russian.runtime?.python?.packagesByComponent?.core?.includes('silero-stress==1.4'), true);
    assert.equal(russian.runtime?.python?.packagesByComponent?.core?.includes('click>=8.1,<9'), true);
    assert.equal(russian.runtime?.ocr?.paddleLang, 'ru');
    assert.equal(russian.runtime?.tts?.qwen3LanguageName, 'russian');
    assert.equal(russian.runtime?.stt?.whisperLanguage, 'ru');
    assert.equal(
      russian.languageData?.assets?.some((asset) => asset.path === 'licenses/openrussian-LICENSE'),
      true,
    );

    for (const [language, metadata] of Object.entries({
      'zh-Hans': simplified,
      'zh-Hant': traditional,
    })) {
      assert.equal(metadata.textProcessing?.readingAnnotation?.display, 'ruby');
      assert.deepEqual(metadata.textProcessing?.readingAnnotation?.annotationScripts, ['Han']);
      assert.equal(metadata.runtime?.adapter?.path, 'adapters/mandarin_adapter.py');
      assert.equal(metadata.runtime?.python?.packagesByComponent?.core?.includes('pypinyin==0.55.0'), true);
      assert.equal(metadata.runtime?.python?.packagesByComponent?.core?.includes('click>=8.1,<9'), true);
      assert.equal(metadata.runtime?.tts?.qwen3LanguageName, 'chinese');
      assert.equal(metadata.runtime?.stt?.whisperLanguage, 'zh');
      assert.equal(metadata.languageData?.assets?.some((asset) => asset.path === `languages/${language}.freq.json`), true);
    }

    assert.equal(simplified.runtime?.ocr?.paddleLang, 'ch');
    assert.equal(traditional.runtime?.ocr?.paddleLang, 'chinese_cht');
    assert.equal(traditional.runtime?.adapter?.config?.pinyinInputConversion, 't2s');
    assert.equal(
      traditional.runtime?.python?.packagesByComponent?.core?.includes('opencc-python-reimplemented==0.1.7'),
      true,
    );
    for (const metadata of [russian, simplified, traditional]) {
      assert.equal(Object.prototype.hasOwnProperty.call(metadata, 'prosody'), false);
      assert.equal(Object.prototype.hasOwnProperty.call(metadata.textProcessing ?? {}, 'prosody'), false);
      assert.equal(metadata.grammar.length >= 75, true);
      assert.equal(metadata.characterStudy?.enabled, metadata !== russian);
    }
  });

  it('keeps every language grammar matcher on the shared schema', () => {
    const languagesDir = path.join(
      process.cwd(),
      'scripts/language-data/source/root-of-app/languages',
    );
    const allowedMatchKeys = new Set(['type', 'text', 'tokens', 'caseSensitive']);
    const allowedTokenKeys = new Set([
      'field', 'equals', 'oneOf', 'regex', 'canonicalPartOfSpeech', 'features', 'caseSensitive',
    ]);

    for (const fileName of fs.readdirSync(languagesDir).filter((name) => name.endsWith('.json'))) {
      const metadata = readJson(path.join(languagesDir, fileName));
      for (const grammarPoint of metadata.grammar ?? []) {
        const matchers = Array.isArray(grammarPoint.match) ? grammarPoint.match : [grammarPoint.match];
        for (const matcher of matchers.filter(Boolean)) {
          assert.deepEqual(
            Object.keys(matcher).filter((key) => !allowedMatchKeys.has(key)),
            [],
            `${fileName} ${grammarPoint.pattern} has unsupported match fields`,
          );
          for (const token of matcher.tokens ?? []) {
            assert.deepEqual(
              Object.keys(token).filter((key) => !allowedTokenKeys.has(key)),
              [],
              `${fileName} ${grammarPoint.pattern} has unsupported token fields`,
            );
          }
        }
      }
    }
  });

  it('keeps source language metadata on current language-agnostic fields', () => {
    const languagesDir = path.join(
      process.cwd(),
      'scripts/language-data/source/root-of-app/languages',
    );
    const overridesDir = path.join(
      process.cwd(),
      'scripts/language-data/language-overrides',
    );
    const legacyTopLevelFields = [
      'hasGrammar',
      'hasPitchAccent',
      'hasFurigana',
      'hasOcrRamSaver',
      'usesCJKParentheses',
      'usesLatinScript',
      'hasCharacterNames',
      'hasHonorifics',
      'supportsVerticalText',
      'freq_level_names',
      'freq_level_boundaries',
      'grammar_level_names',
    ];
    const legacyFixedSettings = ['furigana', 'showPitchAccent'];
    const legacyLexemeTypes = [`kana-${'kanji'}-reading`];
    const metadataFiles = [
      ...fs.readdirSync(languagesDir)
        .filter((name) => name.endsWith('.json'))
        .map((name) => path.join(languagesDir, name)),
      ...fs.readdirSync(overridesDir)
        .filter((name) => name.endsWith('.json'))
        .map((name) => path.join(overridesDir, name)),
    ];

    for (const filePath of metadataFiles) {
      const metadata = readJson(filePath);
      const file = path.relative(process.cwd(), filePath);
      for (const field of legacyTopLevelFields) {
        assert.equal(
          Object.prototype.hasOwnProperty.call(metadata, field),
          false,
          `${file} must not declare legacy top-level ${field}`,
        );
      }
      for (const field of legacyFixedSettings) {
        assert.equal(
          Object.prototype.hasOwnProperty.call(metadata.fixed_settings ?? {}, field),
          false,
          `${file} must not declare legacy fixed_settings.${field}`,
        );
      }
      assert.equal(
        legacyLexemeTypes.includes(metadata.textProcessing?.lexemeNormalization?.type),
        false,
        `${file} must not declare legacy textProcessing.lexemeNormalization.type`,
      );
    }
  });

  it('splits core language data from dictionary packs in the Pages catalog', async () => {
    const sourceRoot = path.join(tempDir, 'root-of-app');
    const languagesDir = path.join(sourceRoot, 'languages');
    const dictionariesDir = path.join(sourceRoot, 'dictionaries', 'aa');
    const modelsDir = path.join(sourceRoot, 'models', 'aa');
    fs.mkdirSync(languagesDir, { recursive: true });
    fs.mkdirSync(dictionariesDir, { recursive: true });
    fs.mkdirSync(modelsDir, { recursive: true });
    fs.writeFileSync(path.join(dictionariesDir, 'dictionary.db'), 'dictionary contents', 'utf-8');
    fs.writeFileSync(path.join(modelsDir, 'ocr.bin'), 'ocr model contents', 'utf-8');
    fs.writeFileSync(path.join(languagesDir, 'aa.py'), 'def LOAD_MODULE(folder, language_data_folder=None): pass\n', 'utf-8');
    fs.writeFileSync(path.join(languagesDir, 'aa.freq.json'), JSON.stringify({ freq: [['alpha', 'alpha']] }), 'utf-8');
    fs.writeFileSync(path.join(languagesDir, 'aa.json'), JSON.stringify({
      name: 'Alpha',
      name_translated: 'Alpha',
      translatable: ['WORD'],
      colour_codes: {},
      fixed_settings: {},
      languageData: {
        version: 'aa-package-v1',
        assets: [
          {
            id: 'language-module',
            path: 'languages/aa.py',
            required: true,
          },
          {
            id: 'dictionary',
            path: 'dictionaries/aa/dictionary.db',
            required: true,
          },
          {
            id: 'frequency',
            path: 'languages/aa.freq.json',
            bundledPath: 'languages/aa.freq.json',
            required: true,
          },
          {
            id: 'ocr-model',
            path: 'models/aa/ocr.bin',
            components: ['ocr', ''],
            required: true,
          },
        ],
      },
    }), 'utf-8');

    const outputDir = path.join(tempDir, 'frontend', 'public', 'language-data');
    const catalogPath = path.join(tempDir, 'frontend', 'public', 'language-catalog.json');
    const overridesDir = path.join(tempDir, 'empty-overrides');
    fs.mkdirSync(overridesDir, { recursive: true });
    const result = await createLanguageDataRelease({
      sourceRoot,
      outputDir,
      catalogPath,
      overridesDir,
      assetBaseUrl: 'https://cdn.example.com/mlearn/language-data/',
      generatedAt: '2026-06-28T00:00:00.000Z',
    });

    assert.equal(result.assetCount, 4);
    const coreBundlePath = findArchivePath(outputDir, 'aa', 'language-package-v1-');
    const dictionaryBundlePath = findArchivePath(outputDir, 'aa-en', 'dictionary-aa-package-v1-');
    const coreBundleRelativePath = relativeArchivePath(outputDir, coreBundlePath);
    const dictionaryBundleRelativePath = relativeArchivePath(outputDir, dictionaryBundlePath);
    assert.equal(fs.existsSync(coreBundlePath), true);
    assert.equal(fs.existsSync(dictionaryBundlePath), true);

    const catalog = readJson(catalogPath);
    assert.deepEqual(Object.keys(catalog.languages), ['aa']);
    assert.equal(catalog.languages.aa.bundle.url, `https://cdn.example.com/mlearn/language-data/${coreBundleRelativePath}`);
    assert.equal(catalog.languages.aa.files.some((asset) => asset.path === 'dictionaries/aa/dictionary.db'), false);
    assert.equal(catalog.languages.aa.files.some((asset) => asset.path === 'languages/aa.py'), false);
    assert.equal(catalog.languages.aa.files.some((asset) => asset.path === 'languages/aa.freq.json'), true);
    assert.deepEqual(
      catalog.languages.aa.files.find((asset) => asset.path === 'models/aa/ocr.bin').components,
      ['ocr'],
    );
    assert.equal(catalog.languages.aa.dictionaryPacks.en.name, 'English');
    assert.equal(
      catalog.languages.aa.dictionaryPacks.en.bundle.url,
      `https://cdn.example.com/mlearn/language-data/${dictionaryBundleRelativePath}`,
    );
    assert.equal(catalog.languages.aa.dictionaryPacks.en.assets[0].path, 'dictionaries/aa/dictionary.db');

    const coreExtractDir = path.join(tempDir, 'core-extract');
    extractTarGz(coreBundlePath, coreExtractDir);
    const coreManifest = readJson(path.join(coreExtractDir, 'manifest.json'));
    assert.equal(Object.hasOwn(coreManifest, 'targetLanguage'), false);
    assert.equal(coreManifest.files.some((asset) => asset.path === 'dictionaries/aa/dictionary.db'), false);
    assert.equal(coreManifest.files.some((asset) => asset.path === 'languages/aa.py'), false);
    assert.equal(coreManifest.files.some((asset) => asset.path === 'languages/aa.freq.json'), true);
    assert.deepEqual(
      coreManifest.files.find((asset) => asset.path === 'models/aa/ocr.bin').components,
      ['ocr'],
    );
    assert.equal(fs.existsSync(path.join(coreExtractDir, 'files', 'dictionaries', 'aa', 'dictionary.db')), false);
    assert.equal(fs.existsSync(path.join(coreExtractDir, 'files', 'languages', 'aa.py')), false);
    assert.equal(fs.existsSync(path.join(coreExtractDir, 'files', 'models', 'aa', 'ocr.bin')), true);

    const dictionaryExtractDir = path.join(tempDir, 'dictionary-extract');
    extractTarGz(dictionaryBundlePath, dictionaryExtractDir);
    const dictionaryManifest = readJson(path.join(dictionaryExtractDir, 'manifest.json'));
    assert.equal(dictionaryManifest.targetLanguage, 'en');
    assert.deepEqual(dictionaryManifest.files.map((asset) => asset.path), ['dictionaries/aa/dictionary.db']);
    assert.equal(
      fs.readFileSync(path.join(dictionaryExtractDir, 'files', 'dictionaries', 'aa', 'dictionary.db'), 'utf-8'),
      'dictionary contents',
    );

    const assetManifest = readJson(result.assetManifestPath);
    assert.equal(assetManifest.bundles[0].relativePath, coreBundleRelativePath);
    assert.equal(assetManifest.bundles[0].dictionaryPacks.en.targetLanguage, 'en');
    assert.deepEqual(
      assetManifest.bundles[0].files.find((asset) => asset.path === 'models/aa/ocr.bin').components,
      ['ocr'],
    );
    assert.equal(assetManifest.dictionaryBundles[0].relativePath, dictionaryBundleRelativePath);
    assert.equal(assetManifest.dictionaryBundles[0].targetLanguage, 'en');
  });

  it('preserves component scopes on explicit dictionary pack assets', async () => {
    const sourceRoot = path.join(tempDir, 'root-of-app');
    const languagesDir = path.join(sourceRoot, 'languages');
    const dictionariesDir = path.join(sourceRoot, 'dictionaries', 'aa', 'fr');
    const overridesDir = path.join(tempDir, 'overrides');
    fs.mkdirSync(languagesDir, { recursive: true });
    fs.mkdirSync(dictionariesDir, { recursive: true });
    fs.mkdirSync(overridesDir, { recursive: true });
    fs.writeFileSync(path.join(dictionariesDir, 'dictionary.db'), 'french dictionary contents', 'utf-8');
    fs.writeFileSync(path.join(languagesDir, 'aa.json'), JSON.stringify({
      name: 'Alpha',
      name_translated: 'Alpha',
      translatable: ['WORD'],
      colour_codes: {},
      fixed_settings: {},
      languageData: {
        version: 'aa-package-v1',
        assets: [],
      },
    }), 'utf-8');
    fs.writeFileSync(path.join(overridesDir, 'aa.dictionary-packs.json'), JSON.stringify({
      fr: {
        targetLanguage: 'fr',
        name: 'French',
        version: 'aa-fr-dictionary-v1',
        assets: [{
          id: 'dictionary-fr',
          path: 'dictionaries/aa/fr/dictionary.db',
          components: ['core', ''],
          required: true,
        }],
      },
    }), 'utf-8');

    const outputDir = path.join(tempDir, 'frontend', 'public', 'language-data');
    const catalogPath = path.join(tempDir, 'frontend', 'public', 'language-catalog.json');
    await createLanguageDataRelease({
      sourceRoot,
      outputDir,
      catalogPath,
      overridesDir,
      assetBaseUrl: 'https://cdn.example.com/mlearn/language-data/',
      generatedAt: '2026-06-28T00:00:00.000Z',
    });

    const catalog = readJson(catalogPath);
    assert.deepEqual(catalog.languages.aa.dictionaryPacks.fr.assets[0].components, ['core']);

    const dictionaryBundlePath = findArchivePath(outputDir, 'aa-fr', 'dictionary-v1-');
    const dictionaryExtractDir = path.join(tempDir, 'aa-fr-dictionary-extract');
    extractTarGz(dictionaryBundlePath, dictionaryExtractDir);
    const dictionaryManifest = readJson(path.join(dictionaryExtractDir, 'manifest.json'));
    assert.deepEqual(dictionaryManifest.files[0].components, ['core']);
  });

  it('includes Python adapters only when language metadata declares them', async () => {
    const sourceRoot = path.join(tempDir, 'root-of-app');
    const languagesDir = path.join(sourceRoot, 'languages');
    const adaptersDir = path.join(sourceRoot, 'adapters');
    fs.mkdirSync(languagesDir, { recursive: true });
    fs.mkdirSync(adaptersDir, { recursive: true });
    fs.writeFileSync(path.join(languagesDir, 'aa.py'), 'def LOAD_MODULE(folder, language_data_folder=None): pass\n', 'utf-8');
    fs.writeFileSync(path.join(adaptersDir, 'aa_adapter.py'), 'def LOAD_MODULE(folder, language_data_folder=None): pass\n', 'utf-8');
    fs.writeFileSync(path.join(languagesDir, 'aa.json'), JSON.stringify({
      name: 'Alpha',
      name_translated: 'Alpha',
      translatable: ['WORD'],
      colour_codes: {},
      fixed_settings: {},
      runtime: {
        adapter: {
          type: 'python-module',
          path: 'adapters/aa_adapter.py',
        },
      },
      languageData: {
        version: 'aa-package-v1',
        assets: [
          {
            id: 'language-module',
            path: 'languages/aa.py',
            required: true,
          },
          {
            id: 'python-adapter',
            path: 'adapters/aa_adapter.py',
            required: true,
          },
        ],
      },
    }), 'utf-8');

    const outputDir = path.join(tempDir, 'frontend', 'public', 'language-data');
    const catalogPath = path.join(tempDir, 'frontend', 'public', 'language-catalog.json');
    const overridesDir = path.join(tempDir, 'empty-overrides');
    fs.mkdirSync(overridesDir, { recursive: true });
    await createLanguageDataRelease({
      sourceRoot,
      outputDir,
      catalogPath,
      overridesDir,
      assetBaseUrl: 'https://cdn.example.com/mlearn/language-data/',
      generatedAt: '2026-06-28T00:00:00.000Z',
    });

    const coreBundlePath = findArchivePath(outputDir, 'aa', 'language-package-v1-');
    const coreExtractDir = path.join(tempDir, 'declared-adapter-extract');
    extractTarGz(coreBundlePath, coreExtractDir);
    const coreManifest = readJson(path.join(coreExtractDir, 'manifest.json'));
    assert.equal(coreManifest.files.some((asset) => asset.path === 'languages/aa.py'), false);
    assert.equal(coreManifest.files.some((asset) => asset.path === 'adapters/aa_adapter.py'), true);
    assert.equal(fs.existsSync(path.join(coreExtractDir, 'files', 'languages', 'aa.py')), false);
    assert.equal(fs.existsSync(path.join(coreExtractDir, 'files', 'adapters', 'aa_adapter.py')), true);

    const installedMetadata = readJson(path.join(coreExtractDir, 'files', 'languages', 'aa.json'));
    assert.equal(installedMetadata.runtime.adapter.type, 'python-module');
    assert.equal(installedMetadata.runtime.adapter.path, 'adapters/aa_adapter.py');
    assert.equal(installedMetadata.languageData.assets.some((asset) => asset.path === 'languages/aa.py'), false);
    assert.equal(installedMetadata.languageData.assets.some((asset) => asset.path === 'adapters/aa_adapter.py'), true);
  });

  it('keeps archive URLs stable when unchanged language data is rebuilt later', async () => {
    const sourceRoot = path.join(tempDir, 'root-of-app');
    const languagesDir = path.join(sourceRoot, 'languages');
    fs.mkdirSync(languagesDir, { recursive: true });
    fs.writeFileSync(path.join(languagesDir, 'aa.json'), JSON.stringify({
      name: 'Alpha',
      name_translated: 'Alpha',
      translatable: ['WORD'],
      colour_codes: {},
      fixed_settings: {},
      languageData: {
        version: 'aa-package-v1',
        assets: [],
      },
    }), 'utf-8');

    const overridesDir = path.join(tempDir, 'empty-overrides');
    fs.mkdirSync(overridesDir, { recursive: true });
    const outputDir1 = path.join(tempDir, 'release-one');
    const catalogPath1 = path.join(tempDir, 'frontend-one', 'language-catalog.json');
    const first = await createLanguageDataRelease({
      sourceRoot,
      outputDir: outputDir1,
      catalogPath: catalogPath1,
      overridesDir,
      assetBaseUrl: 'https://cdn.example.com/mlearn/language-data/',
      generatedAt: '2026-06-28T00:00:00.000Z',
    });
    const outputDir2 = path.join(tempDir, 'release-two');
    const catalogPath2 = path.join(tempDir, 'frontend-two', 'language-catalog.json');
    const second = await createLanguageDataRelease({
      sourceRoot,
      outputDir: outputDir2,
      catalogPath: catalogPath2,
      overridesDir,
      assetBaseUrl: 'https://cdn.example.com/mlearn/language-data/',
      generatedAt: '2026-07-01T00:00:00.000Z',
    });

    const firstManifest = readJson(first.assetManifestPath);
    const secondManifest = readJson(second.assetManifestPath);
    assert.equal(firstManifest.bundles[0].relativePath, secondManifest.bundles[0].relativePath);
    assert.equal(firstManifest.bundles[0].sha256, secondManifest.bundles[0].sha256);

    const firstCatalog = readJson(catalogPath1);
    const secondCatalog = readJson(catalogPath2);
    assert.notEqual(firstCatalog.generatedAt, secondCatalog.generatedAt);
    assert.equal(firstCatalog.languages.aa.bundle.url, secondCatalog.languages.aa.bundle.url);

    const extractDir = path.join(tempDir, 'stable-archive-extract');
    extractTarGz(path.join(outputDir1, firstManifest.bundles[0].relativePath), extractDir);
    const archiveManifest = readJson(path.join(extractDir, 'manifest.json'));
    assert.equal(Object.hasOwn(archiveManifest, 'generatedAt'), false);
  });

  it('rejects unsafe declared Python adapter package paths', async () => {
    const sourceRoot = path.join(tempDir, 'root-of-app');
    const languagesDir = path.join(sourceRoot, 'languages');
    fs.mkdirSync(languagesDir, { recursive: true });
    fs.writeFileSync(path.join(languagesDir, 'aa.json'), JSON.stringify({
      name: 'Alpha',
      name_translated: 'Alpha',
      translatable: ['WORD'],
      colour_codes: {},
      fixed_settings: {},
      runtime: {
        nlp: {
          adapter: {
            type: 'python-module',
            path: '../aa.py',
          },
        },
      },
      languageData: {
        version: 'aa-package-v1',
        assets: [],
      },
    }), 'utf-8');

    const outputDir = path.join(tempDir, 'frontend', 'public', 'language-data');
    const catalogPath = path.join(tempDir, 'frontend', 'public', 'language-catalog.json');
    const overridesDir = path.join(tempDir, 'empty-overrides');
    fs.mkdirSync(overridesDir, { recursive: true });
    await assert.rejects(
      () => createLanguageDataRelease({
        sourceRoot,
        outputDir,
        catalogPath,
        overridesDir,
        assetBaseUrl: 'https://cdn.example.com/mlearn/language-data/',
        generatedAt: '2026-06-28T00:00:00.000Z',
      }),
      /Invalid Python adapter path for aa/,
    );
  });

  it('uses metadata dictionary target templates for inferred dictionary packs', async () => {
    const sourceRoot = path.join(tempDir, 'root-of-app');
    const languagesDir = path.join(sourceRoot, 'languages');
    const dictionariesDir = path.join(sourceRoot, 'dictionaries', 'zz');
    fs.mkdirSync(languagesDir, { recursive: true });
    fs.mkdirSync(dictionariesDir, { recursive: true });
    fs.writeFileSync(path.join(dictionariesDir, 'dictionary.db'), 'template dictionary', 'utf-8');
    fs.writeFileSync(path.join(languagesDir, 'zz.json'), JSON.stringify({
      name: 'Zeta',
      name_translated: 'Zeta',
      translatable: ['WORD'],
      colour_codes: {},
      fixed_settings: {},
      runtime: {
        nlp: {
          dictionary: {
            targetPathTemplate: 'dictionaries/{language}/{target}/dictionary.db',
            defaultTargetLanguage: 'fr',
          },
        },
      },
      languageData: {
        version: 'zz-package-v1',
        assets: [
          {
            id: 'dictionary',
            path: 'dictionaries/zz/dictionary.db',
            bundledPath: 'dictionaries/zz/dictionary.db',
            required: true,
          },
        ],
      },
    }), 'utf-8');

    const outputDir = path.join(tempDir, 'frontend', 'public', 'language-data');
    const catalogPath = path.join(tempDir, 'frontend', 'public', 'language-catalog.json');
    const overridesDir = path.join(tempDir, 'empty-overrides');
    fs.mkdirSync(overridesDir, { recursive: true });
    await createLanguageDataRelease({
      sourceRoot,
      outputDir,
      catalogPath,
      overridesDir,
      assetBaseUrl: 'https://cdn.example.com/mlearn/language-data/',
      generatedAt: '2026-06-28T00:00:00.000Z',
    });

    const catalog = readJson(catalogPath);
    assert.equal(catalog.languages.zz.dictionaryPacks.fr.assets[0].path, 'dictionaries/zz/fr/dictionary.db');

    const dictionaryBundlePath = findArchivePath(outputDir, 'zz-fr', 'dictionary-zz-package-v1-');
    const dictionaryExtractDir = path.join(tempDir, 'zz-dictionary-extract');
    extractTarGz(dictionaryBundlePath, dictionaryExtractDir);
    const dictionaryManifest = readJson(path.join(dictionaryExtractDir, 'manifest.json'));
    assert.equal(dictionaryManifest.targetLanguage, 'fr');
    assert.deepEqual(dictionaryManifest.files.map((asset) => asset.path), ['dictionaries/zz/fr/dictionary.db']);
    assert.equal(
      fs.readFileSync(path.join(dictionaryExtractDir, 'files', 'dictionaries', 'zz', 'fr', 'dictionary.db'), 'utf-8'),
      'template dictionary',
    );
  });

  it('adds cloud-owned dictionary pack overrides without editing app language metadata', async () => {
    const sourceRoot = path.join(tempDir, 'root-of-app');
    const languagesDir = path.join(sourceRoot, 'languages');
    const dictionariesDir = path.join(sourceRoot, 'dictionaries', 'ja', 'fr');
    const overridesDir = path.join(tempDir, 'overrides');
    fs.mkdirSync(languagesDir, { recursive: true });
    fs.mkdirSync(dictionariesDir, { recursive: true });
    fs.mkdirSync(overridesDir, { recursive: true });
    fs.writeFileSync(path.join(dictionariesDir, 'dictionary.db'), 'jmdict french dictionary', 'utf-8');
    fs.writeFileSync(path.join(languagesDir, 'ja.py'), 'def LOAD_MODULE(folder, language_data_folder=None): pass\n', 'utf-8');
    fs.writeFileSync(path.join(languagesDir, 'ja.json'), JSON.stringify({
      name: 'Japanese',
      name_translated: '日本語',
      translatable: ['名詞'],
      colour_codes: {},
      fixed_settings: {},
      languageData: {
        version: 'ja-package-v1',
        assets: [{
          id: 'language-metadata',
          path: 'languages/ja.json',
          bundledPath: 'languages/ja.json',
          required: true,
        }],
      },
    }), 'utf-8');
    fs.writeFileSync(path.join(overridesDir, 'ja.dictionary-packs.json'), JSON.stringify({
      fr: {
        targetLanguage: 'fr',
        name: 'French',
        version: 'ja-fr-dictionary-jmdict-v1',
        assets: [{
          id: 'dictionary-fr',
          path: 'dictionaries/ja/fr/dictionary.db',
          bundledPath: 'dictionaries/ja/fr/dictionary.db',
          required: true,
        }],
      },
    }), 'utf-8');

    const outputDir = path.join(tempDir, 'frontend', 'public', 'language-data');
    const catalogPath = path.join(tempDir, 'frontend', 'public', 'language-catalog.json');
    await createLanguageDataRelease({
      sourceRoot,
      outputDir,
      catalogPath,
      overridesDir,
      assetBaseUrl: 'https://cdn.example.com/mlearn/language-data/',
      generatedAt: '2026-06-28T00:00:00.000Z',
    });

    const catalog = readJson(catalogPath);
    assert.equal(catalog.languages.ja.dictionaryPacks.fr.version, 'ja-fr-dictionary-jmdict-v1');
    assert.equal(catalog.languages.ja.dictionaryPacks.fr.assets[0].path, 'dictionaries/ja/fr/dictionary.db');

    const dictionaryBundlePath = findArchivePath(outputDir, 'ja-fr', 'dictionary-jmdict-v1-');
    const dictionaryExtractDir = path.join(tempDir, 'ja-fr-dictionary-extract');
    extractTarGz(dictionaryBundlePath, dictionaryExtractDir);
    const dictionaryManifest = readJson(path.join(dictionaryExtractDir, 'manifest.json'));
    assert.equal(dictionaryManifest.targetLanguage, 'fr');
    assert.equal(
      fs.readFileSync(path.join(dictionaryExtractDir, 'files', 'dictionaries', 'ja', 'fr', 'dictionary.db'), 'utf-8'),
      'jmdict french dictionary',
    );
  });

  it('merges language metadata overrides into installed language packages', async () => {
    const sourceRoot = path.join(tempDir, 'root-of-app');
    const languagesDir = path.join(sourceRoot, 'languages');
    const overridesDir = path.join(tempDir, 'overrides');
    fs.mkdirSync(languagesDir, { recursive: true });
    fs.mkdirSync(overridesDir, { recursive: true });
    // Stale source layouts may still contain this file. Metadata-driven packages
    // must ignore it unless runtime.adapter explicitly opts in.
    fs.writeFileSync(path.join(languagesDir, 'ja.py'), 'def LOAD_MODULE(folder, language_data_folder=None): pass\n', 'utf-8');
    fs.writeFileSync(path.join(languagesDir, 'ja.json'), JSON.stringify({
      name: 'Japanese',
      name_translated: '日本語',
      translatable: ['名詞'],
      colour_codes: {},
      fixed_settings: {},
      hasOcrRamSaver: true,
      supportsVerticalText: true,
      runtime: {
        nlp: {
          tokenizer: { type: 'sudachi' },
        },
      },
      languageData: {
        version: 'ja-package-v1',
        assets: [],
      },
    }), 'utf-8');
    fs.writeFileSync(path.join(overridesDir, 'ja.metadata.json'), JSON.stringify({
      textProcessing: {
        lexemeNormalization: {
          type: 'surface-reading',
          surfaceScripts: ['Han'],
          readingScripts: ['Hira', 'Kana'],
          readingNormalizer: 'kana-to-hiragana',
          preserveNonPrimaryReadingScript: true,
        },
        readingAnnotation: {
          type: 'script-reading',
          annotationScripts: ['Han'],
          surfaceSuffixScripts: ['Hira', 'Kana'],
          readingSeparator: '',
          stripParentheticalReadings: true,
        },
        tokenJoinSeparator: '',
      },
      characterStudy: {
        enabled: true,
        scripts: ['Han'],
        levelOrder: 'descending',
      },
      prosody: {
        type: 'japanese-pitch-accent',
      },
      typography: {
        subtitleFontFamily: "'Noto Sans CJK JP', 'Noto Sans JP', 'Hiragino Kaku Gothic Pro', 'Yu Gothic', sans-serif",
        contentFontFamily: "'Noto Sans CJK JP', 'Noto Sans JP', 'Hiragino Kaku Gothic Pro', 'Yu Gothic', sans-serif",
      },
      runtime: {
        ocr: {
          recognitionEngine: 'mangaocr',
          rapidLangType: 'JAPAN',
          paddleLang: 'japan',
          supportsVerticalText: true,
          supportsRamSaver: true,
        },
        tts: {
          kokoroLangCode: 'j',
          kokoroVoice: 'jf_alpha',
          qwen3LanguageName: 'japanese',
        },
        stt: {
          whisperLanguage: 'ja',
          hallucinationPhrases: [],
          shortAudioMaxSeconds: 1,
          shortAudioMinTextLength: 5,
        },
        nlp: {
          tokenizer: {
            required: true,
            fallback: 'none',
            outputReadingNormalizer: 'kana-to-hiragana',
            ignoredPos: ['空白'],
          },
          dictionary: {
            type: 'sqlite-zlib-json',
            schema: 'headword-reading-zlib-json',
            targetPathTemplate: 'dictionaries/{language}/{target}/dictionary.db',
            defaultTargetLanguage: 'en',
            schemaVersion: '1',
            renderer: 'raw-entry',
            prosody: {
              table: 'pitch',
              headwordColumn: 'headword',
              dataColumn: 'data',
            },
          },
        },
      },
    }), 'utf-8');

    const outputDir = path.join(tempDir, 'release', 'language-data');
    const catalogPath = path.join(tempDir, 'frontend', 'public', 'language-catalog.json');
    await createLanguageDataRelease({
      sourceRoot,
      outputDir,
      catalogPath,
      overridesDir,
      assetBaseUrl: 'https://cdn.example.com/mlearn/language-data/',
      generatedAt: '2026-06-28T00:00:00.000Z',
    });

    const coreBundlePath = findArchivePath(outputDir, 'ja', 'language-package-v1-');
    const extractDir = path.join(tempDir, 'ja-core-extract');
    extractTarGz(coreBundlePath, extractDir);
    const manifest = readJson(path.join(extractDir, 'manifest.json'));
    assert.equal(
      manifest.files.filter((asset) => asset.path === 'languages/ja.json').length,
      1,
    );
    assert.equal(manifest.files.some((asset) => asset.path === 'languages/ja.py'), false);
    assert.equal(fs.existsSync(path.join(extractDir, 'files', 'languages', 'ja.py')), false);
    const installedMetadata = readJson(path.join(extractDir, 'files', 'languages', 'ja.json'));
    assert.equal(
      installedMetadata.languageData.assets.some((asset) => asset.path === 'languages/ja.py'),
      false,
    );
    assert.equal(installedMetadata.runtime.ocr.recognitionEngine, 'mangaocr');
    assert.equal(installedMetadata.runtime.ocr.rapidLangType, 'JAPAN');
    assert.equal(installedMetadata.runtime.ocr.paddleLang, 'japan');
    assert.equal(installedMetadata.runtime.ocr.supportsVerticalText, true);
    assert.equal(installedMetadata.runtime.ocr.supportsRamSaver, true);
    assert.equal(installedMetadata.runtime.tts.kokoroLangCode, 'j');
    assert.equal(installedMetadata.runtime.tts.kokoroVoice, 'jf_alpha');
    assert.equal(installedMetadata.runtime.tts.qwen3LanguageName, 'japanese');
    assert.equal(installedMetadata.runtime.stt.whisperLanguage, 'ja');
    assert.deepEqual(installedMetadata.runtime.stt.hallucinationPhrases, []);
    assert.equal(installedMetadata.runtime.stt.shortAudioMaxSeconds, 1);
    assert.equal(installedMetadata.runtime.stt.shortAudioMinTextLength, 5);
    assert.equal(installedMetadata.runtime.nlp.tokenizer.type, 'sudachi');
    assert.equal(installedMetadata.runtime.nlp.tokenizer.required, true);
    assert.equal(installedMetadata.runtime.nlp.tokenizer.fallback, 'none');
    assert.equal(installedMetadata.runtime.nlp.tokenizer.outputReadingNormalizer, 'kana-to-hiragana');
    assert.deepEqual(installedMetadata.runtime.nlp.tokenizer.ignoredPos, ['空白']);
    assert.equal(installedMetadata.runtime.nlp.dictionary.type, 'sqlite-zlib-json');
    assert.equal(installedMetadata.runtime.nlp.dictionary.schema, 'headword-reading-zlib-json');
    assert.equal(installedMetadata.runtime.nlp.dictionary.targetPathTemplate, 'dictionaries/{language}/{target}/dictionary.db');
    assert.equal(installedMetadata.runtime.nlp.dictionary.defaultTargetLanguage, 'en');
    assert.equal(installedMetadata.runtime.nlp.dictionary.renderer, 'raw-entry');
    assert.deepEqual(installedMetadata.runtime.nlp.dictionary.prosody, {
      table: 'pitch',
      headwordColumn: 'headword',
      dataColumn: 'data',
    });
    assert.equal(installedMetadata.textProcessing.lexemeNormalization.type, 'surface-reading');
    assert.deepEqual(installedMetadata.textProcessing.lexemeNormalization.readingScripts, ['Hira', 'Kana']);
    assert.equal(installedMetadata.textProcessing.readingAnnotation.type, 'script-reading');
    assert.deepEqual(installedMetadata.textProcessing.readingAnnotation.annotationScripts, ['Han']);
    assert.equal(installedMetadata.textProcessing.readingAnnotation.stripParentheticalReadings, true);
    assert.equal(installedMetadata.textProcessing.tokenJoinSeparator, '');
    assert.equal(installedMetadata.characterStudy.enabled, true);
    assert.deepEqual(installedMetadata.characterStudy.scripts, ['Han']);
    assert.equal(installedMetadata.characterStudy.levelOrder, 'descending');
    assert.equal(installedMetadata.prosody.type, 'japanese-pitch-accent');
    assert.equal(
      installedMetadata.typography.subtitleFontFamily,
      "'Noto Sans CJK JP', 'Noto Sans JP', 'Hiragino Kaku Gothic Pro', 'Yu Gothic', sans-serif",
    );
    assert.equal(
      installedMetadata.typography.contentFontFamily,
      "'Noto Sans CJK JP', 'Noto Sans JP', 'Hiragino Kaku Gothic Pro', 'Yu Gothic', sans-serif",
    );
  });

  it('does not duplicate inferred Japanese EN dictionary assets when an explicit EN override exists', async () => {
    const sourceRoot = path.join(tempDir, 'root-of-app');
    const languagesDir = path.join(sourceRoot, 'languages');
    const legacyDictionaryDir = path.join(sourceRoot, 'dictionaries', 'ja');
    const enDictionaryDir = path.join(sourceRoot, 'dictionaries', 'ja', 'en');
    const overridesDir = path.join(tempDir, 'overrides');
    fs.mkdirSync(languagesDir, { recursive: true });
    fs.mkdirSync(legacyDictionaryDir, { recursive: true });
    fs.mkdirSync(enDictionaryDir, { recursive: true });
    fs.mkdirSync(overridesDir, { recursive: true });
    fs.writeFileSync(path.join(legacyDictionaryDir, 'dictionary.db'), 'english dictionary', 'utf-8');
    fs.writeFileSync(path.join(enDictionaryDir, 'metadata.json'), '{"source":"Jitendex"}\n', 'utf-8');
    fs.writeFileSync(path.join(languagesDir, 'ja.json'), JSON.stringify({
      name: 'Japanese',
      name_translated: '日本語',
      translatable: ['名詞'],
      colour_codes: {},
      fixed_settings: {},
      languageData: {
        version: 'ja-package-v1',
        assets: [{
          id: 'dictionary',
          path: 'dictionaries/ja/dictionary.db',
          bundledPath: 'dictionaries/ja/dictionary.db',
          required: true,
        }],
      },
    }), 'utf-8');
    fs.writeFileSync(path.join(overridesDir, 'ja.dictionary-packs.json'), JSON.stringify({
      en: {
        targetLanguage: 'en',
        name: 'English',
        version: 'ja-en-dictionary-v1',
        assets: [
          {
            id: 'dictionary',
            path: 'dictionaries/ja/en/dictionary.db',
            bundledPath: 'dictionaries/ja/dictionary.db',
            required: true,
          },
          {
            id: 'metadata-en',
            path: 'dictionaries/ja/en/metadata.json',
            bundledPath: 'dictionaries/ja/en/metadata.json',
            required: true,
          },
        ],
      },
    }), 'utf-8');

    const outputDir = path.join(tempDir, 'release', 'language-data');
    const catalogPath = path.join(tempDir, 'frontend', 'public', 'language-catalog.json');
    await createLanguageDataRelease({
      sourceRoot,
      outputDir,
      catalogPath,
      overridesDir,
      assetBaseUrl: 'https://cdn.example.com/mlearn/language-data/',
      generatedAt: '2026-06-28T00:00:00.000Z',
    });

    const catalog = readJson(catalogPath);
    assert.deepEqual(
      catalog.languages.ja.dictionaryPacks.en.assets.map((asset) => asset.path),
      ['dictionaries/ja/en/dictionary.db', 'dictionaries/ja/en/metadata.json'],
    );
  });
});
