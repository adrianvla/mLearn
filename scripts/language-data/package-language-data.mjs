import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..', '..');
const publishRoot = path.resolve(process.env.MLEARN_WEBSITE_ROOT || path.join(projectRoot, '..', 'mlearn-website'));
const LANGUAGE_DATA_RELEASE_VERSION = 'v1';
const DEFAULT_SOURCE_ROOT = path.join(__dirname, 'source', 'root-of-app');
const DEFAULT_OUTPUT_DIR = path.join(publishRoot, 'release', 'language-data', LANGUAGE_DATA_RELEASE_VERSION);
const DEFAULT_CATALOG_PATH = path.join(publishRoot, 'frontend', 'public', 'language-catalog.json');
const DEFAULT_OVERRIDES_DIR = path.join(__dirname, 'language-overrides');
const DEFAULT_ASSET_BASE_URL = `https://mlearn.kikan.net/language-data/${LANGUAGE_DATA_RELEASE_VERSION}/`;

const TARGET_LANGUAGE_NAMES = {
  en: 'English',
  fr: 'French',
  de: 'German',
  ja: 'Japanese',
  zh: 'Chinese',
  ru: 'Russian',
};

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

function readDictionaryPackOverrides(options, language) {
  const overridePath = path.join(options.overridesDir, `${language}.dictionary-packs.json`);
  if (!fs.existsSync(overridePath)) {
    return {};
  }
  return readJson(overridePath);
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function deepMerge(base, override) {
  if (!isPlainObject(base) || !isPlainObject(override)) {
    return override;
  }
  const merged = { ...base };
  for (const [key, value] of Object.entries(override)) {
    merged[key] = isPlainObject(value) && isPlainObject(merged[key])
      ? deepMerge(merged[key], value)
      : value;
  }
  return merged;
}

function readLanguageMetadataOverride(options, language) {
  const overridePath = path.join(options.overridesDir, `${language}.metadata.json`);
  if (!fs.existsSync(overridePath)) {
    return {};
  }
  return readJson(overridePath);
}

function applyLanguageMetadataOverride(options, language, metadata) {
  return deepMerge(metadata, readLanguageMetadataOverride(options, language));
}

function ensureTrailingSlash(url) {
  return url.endsWith('/') ? url : `${url}/`;
}

function sanitizeVersion(version) {
  return String(version || 'v1').replace(/[^a-zA-Z0-9._-]+/g, '-');
}

function stripPrefix(value, prefix) {
  return value.startsWith(prefix) ? value.slice(prefix.length) : value;
}

function languageBundleBaseRelativePath(language, version) {
  const versionPart = stripPrefix(sanitizeVersion(version), `${language}-`);
  return `${language}/language-${versionPart}.tar.gz`;
}

function dictionaryBundleBaseRelativePath(language, targetLanguage, version) {
  let versionPart = sanitizeVersion(version);
  versionPart = stripPrefix(versionPart, `${language}-${targetLanguage}-`);
  versionPart = stripPrefix(versionPart, 'dictionary-');
  return `${language}-${targetLanguage}/dictionary-${versionPart}.tar.gz`;
}

function appendContentHash(relativePath, contentSha256) {
  if (!relativePath.endsWith('.tar.gz')) {
    throw new Error(`Unexpected language bundle archive path: ${relativePath}`);
  }
  return `${relativePath.slice(0, -'.tar.gz'.length)}-${contentSha256.slice(0, 12)}.tar.gz`;
}

function sha256(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function collectArchiveEntries(stagingDir, relativeDir = '') {
  const absoluteDir = path.join(stagingDir, relativeDir);
  const entries = [];
  for (const entryName of fs.readdirSync(absoluteDir).sort()) {
    if (entryName === '.DS_Store' || entryName.startsWith('._') || entryName === '__MACOSX') {
      continue;
    }
    const relativePath = path.posix.join(relativeDir.replaceAll(path.sep, path.posix.sep), entryName);
    const absolutePath = path.join(stagingDir, relativePath);
    const stats = fs.statSync(absolutePath);
    if (stats.isDirectory()) {
      entries.push(...collectArchiveEntries(stagingDir, relativePath));
    } else if (stats.isFile()) {
      entries.push(relativePath);
    }
  }
  return entries;
}

function normalizeStagingTimestamps(stagingDir) {
  const stableDate = new Date('2000-01-01T00:00:00.000Z');
  for (const entry of collectArchiveEntries(stagingDir)) {
    fs.utimesSync(path.join(stagingDir, entry), stableDate, stableDate);
  }
}

function createTarGz(archivePath, stagingDir) {
  normalizeStagingTimestamps(stagingDir);
  const tempTarPath = archivePath.endsWith('.tar.gz')
    ? archivePath.slice(0, -'.gz'.length)
    : `${archivePath}.tar`;
  fs.rmSync(tempTarPath, { force: true });
  fs.rmSync(archivePath, { force: true });
  const archiveEntries = [
    'manifest.json',
    ...collectArchiveEntries(path.join(stagingDir, 'files')).map((entry) => `files/${entry}`),
  ];
  execFileSync('tar', [
    '--format',
    'ustar',
    '-cf',
    tempTarPath,
    ...archiveEntries,
  ], {
    cwd: stagingDir,
    env: {
      ...process.env,
      COPYFILE_DISABLE: '1',
    },
    stdio: 'pipe',
  });
  execFileSync('gzip', ['-n', '-f', tempTarPath], { stdio: 'pipe' });
  fs.renameSync(`${tempTarPath}.gz`, archivePath);
}

function isDictionaryAsset(asset) {
  return String(asset.id ?? '').toLowerCase().includes('dictionary') ||
    String(asset.path ?? '').startsWith('dictionaries/');
}

function isGeneratedLanguageMetadataAsset(language, asset) {
  return asset.path === `languages/${language}.json` ||
    asset.id === 'language-metadata';
}

function isPythonAsset(asset) {
  return asset.id === 'language-module' ||
    String(asset.path ?? '').endsWith('.py');
}

function isSafePackagePath(packagePath) {
  return typeof packagePath === 'string' &&
    packagePath.length > 0 &&
    !packagePath.includes('\\') &&
    !path.posix.isAbsolute(packagePath) &&
    !packagePath.split('/').includes('..');
}

function declaredPythonAdapterPath(language, metadata) {
  const adapter = metadata.runtime?.adapter ?? metadata.runtime?.nlp?.adapter;
  if (!isPlainObject(adapter) || adapter.type !== 'python-module') {
    return null;
  }

  const adapterPath = adapter.path ?? `languages/${language}.py`;
  if (!isSafePackagePath(adapterPath) || !adapterPath.endsWith('.py')) {
    throw new Error(`Invalid Python adapter path for ${language}: ${adapterPath}`);
  }
  return adapterPath;
}

function dictionaryRuntimeConfig(metadata) {
  const config = metadata.runtime?.nlp?.dictionary;
  return isPlainObject(config) ? config : {};
}

function inferDictionaryTargetLanguage(_language, _assets, metadata) {
  const config = dictionaryRuntimeConfig(metadata);
  return typeof config.defaultTargetLanguage === 'string' && config.defaultTargetLanguage
    ? config.defaultTargetLanguage
    : 'en';
}

function expandDictionaryPathTemplate(template, language, targetLanguage) {
  return template
    .replaceAll('{language}', language)
    .replaceAll('{target}', targetLanguage)
    .replaceAll('{targetLanguage}', targetLanguage);
}

function dictionarySourcePathCandidates(language, config) {
  return new Set([
    typeof config.path === 'string' ? config.path : null,
    typeof config.fallbackPath === 'string' ? config.fallbackPath : null,
    `dictionaries/${language}/dictionary.db`,
  ].filter(Boolean));
}

function normalizeDictionaryAssetForPack(language, targetLanguage, asset, metadata) {
  const config = dictionaryRuntimeConfig(metadata);
  if (
    typeof config.targetPathTemplate === 'string' &&
    dictionarySourcePathCandidates(language, config).has(asset.path)
  ) {
    const targetPath = expandDictionaryPathTemplate(config.targetPathTemplate, language, targetLanguage);
    if (!isSafePackagePath(targetPath)) {
      throw new Error(`Invalid dictionary target path for ${language}:${targetLanguage}: ${targetPath}`);
    }
    return {
      ...asset,
      path: targetPath,
    };
  }
  return asset;
}

function dictionaryTargetName(targetLanguage) {
  return TARGET_LANGUAGE_NAMES[targetLanguage] ?? targetLanguage.toUpperCase();
}

function cleanAssetComponents(asset) {
  if (!Array.isArray(asset.components)) {
    return undefined;
  }
  const components = asset.components.filter((component) => typeof component === 'string' && component.length > 0);
  return components.length > 0 ? components : undefined;
}

function cleanAsset(asset, stagedPath) {
  const stats = fs.statSync(stagedPath);
  const components = cleanAssetComponents(asset);
  return {
    id: asset.id,
    path: asset.path,
    ...(components ? { components } : {}),
    sizeBytes: stats.size,
    sha256: sha256(stagedPath),
    required: asset.required,
  };
}

function copyPayloadFile(sourceRoot, language, asset, stagingDir) {
  const bundledPath = asset.bundledPath || asset.path;
  const sourcePath = path.join(sourceRoot, bundledPath);
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Missing language data source for ${language}:${asset.id}: ${sourcePath}`);
  }

  const outputPath = path.join(stagingDir, 'files', asset.path);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.copyFileSync(sourcePath, outputPath);
  return cleanAsset(asset, outputPath);
}

function copyPayloadFiles(sourceRoot, language, assets, stagingDir) {
  return assets.map((asset) => copyPayloadFile(sourceRoot, language, asset, stagingDir));
}

function buildInstalledMetadata(metadata, coreFiles, dictionaryPacks) {
  return {
    ...metadata,
    languageData: {
      ...(metadata.languageData ?? {}),
      bundle: undefined,
      assets: coreFiles,
      dictionaryPacks,
    },
  };
}

function writeLanguageMetadata(sourceRoot, language, metadata, files, dictionaryPacks, stagingDir) {
  const languageMetadataFile = {
    id: 'language-metadata',
    path: `languages/${language}.json`,
    required: true,
  };
  const languageMetadataPath = path.join(stagingDir, 'files', languageMetadataFile.path);
  fs.mkdirSync(path.dirname(languageMetadataPath), { recursive: true });
  fs.writeFileSync(
    languageMetadataPath,
    JSON.stringify(buildInstalledMetadata(metadata, [...files, languageMetadataFile], dictionaryPacks), null, 2) + '\n',
    'utf-8',
  );
  return cleanAsset(languageMetadataFile, languageMetadataPath);
}

function splitDictionaryPacks(options, language, metadata) {
  const languageData = metadata.languageData ?? {};
  const sourceAssets = languageData.assets ?? [];
  const explicitPacks = {
    ...(languageData.dictionaryPacks ?? {}),
    ...readDictionaryPackOverrides(options, language),
  };
  const packedPaths = new Set();
  const packs = {};

  for (const [targetLanguage, pack] of Object.entries(explicitPacks)) {
    const assets = Array.isArray(pack.assets) ? pack.assets : [];
    for (const asset of assets) {
      packedPaths.add(asset.path);
      if (asset.bundledPath) {
        packedPaths.add(asset.bundledPath);
      }
    }
    packs[targetLanguage] = {
      targetLanguage: pack.targetLanguage ?? targetLanguage,
      name: pack.name ?? dictionaryTargetName(targetLanguage),
      version: pack.version ?? `${language}-${targetLanguage}-dictionary-${languageData.version ?? 'v1'}`,
      assets: assets.map((asset) => normalizeDictionaryAssetForPack(language, targetLanguage, asset, metadata)),
    };
  }

  const legacyDictionaryAssets = sourceAssets.filter((asset) => isDictionaryAsset(asset) && !packedPaths.has(asset.path));
  if (legacyDictionaryAssets.length > 0) {
    const targetLanguage = inferDictionaryTargetLanguage(language, legacyDictionaryAssets, metadata);
    const existingPack = packs[targetLanguage];
    const existingAssets = existingPack?.assets ?? [];
    const existingPaths = new Set(existingAssets.map((asset) => asset.path));
    const inferredAssets = legacyDictionaryAssets
      .map((asset) => normalizeDictionaryAssetForPack(language, targetLanguage, asset, metadata))
      .filter((asset) => !existingPaths.has(asset.path));
    packs[targetLanguage] = {
      targetLanguage,
      name: existingPack?.name ?? dictionaryTargetName(targetLanguage),
      version: existingPack?.version ?? `${language}-${targetLanguage}-dictionary-${languageData.version ?? 'v1'}`,
      assets: [...existingAssets, ...inferredAssets],
    };
  }

  const dictionaryPaths = new Set(
    Object.values(packs).flatMap((pack) => pack.assets.map((asset) => asset.path)),
  );
  const adapterPath = declaredPythonAdapterPath(language, metadata);
  const coreAssets = sourceAssets.filter((asset) =>
    !dictionaryPaths.has(asset.path) &&
    !isDictionaryAsset(asset) &&
    (!isPythonAsset(asset) || asset.path === adapterPath) &&
    !isGeneratedLanguageMetadataAsset(language, asset),
  );

  return { coreAssets, packs };
}

async function createArchive({
  outputDir,
  sourceRoot,
  language,
  targetLanguage,
  version,
  relativePath,
  metadata,
  assets,
  dictionaryPacks,
  includeLanguageMetadata,
}) {
  const stagingDir = path.join(outputDir, `.staging-${relativePath.replace(/[^a-zA-Z0-9._-]/g, '-')}`);
  const temporaryArchivePath = path.join(outputDir, `.archive-${relativePath.replace(/[^a-zA-Z0-9._-]/g, '-')}`);
  fs.rmSync(stagingDir, { recursive: true, force: true });
  fs.rmSync(temporaryArchivePath, { force: true });
  fs.mkdirSync(path.join(stagingDir, 'files'), { recursive: true });
  fs.mkdirSync(outputDir, { recursive: true });

  const files = copyPayloadFiles(sourceRoot, language, assets, stagingDir);
  if (includeLanguageMetadata) {
    files.push(writeLanguageMetadata(sourceRoot, language, metadata, files, dictionaryPacks, stagingDir));
  }

  const manifest = {
    schemaVersion: 1,
    language,
    ...(targetLanguage ? { targetLanguage } : {}),
    version,
    name: metadata.name,
    nameTranslated: metadata.name_translated,
    files,
  };
  fs.writeFileSync(path.join(stagingDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf-8');

  await createTarGz(temporaryArchivePath, stagingDir);
  const archiveSha256 = sha256(temporaryArchivePath);
  const finalRelativePath = appendContentHash(relativePath, archiveSha256);
  const archivePath = path.join(outputDir, finalRelativePath);
  fs.mkdirSync(path.dirname(archivePath), { recursive: true });
  fs.renameSync(temporaryArchivePath, archivePath);
  fs.rmSync(stagingDir, { recursive: true, force: true });

  return {
    relativePath: finalRelativePath,
    archivePath,
    sizeBytes: fs.statSync(archivePath).size,
    sha256: archiveSha256,
    files,
  };
}

async function createLanguageBundle(options, language, metadata) {
  const { coreAssets: splitCoreAssets, packs } = splitDictionaryPacks(options, language, metadata);
  const coreAssets = splitCoreAssets;
  const version = metadata.languageData?.version ?? `${language}-v1`;
  const dictionaryPacks = {};
  const dictionaryBundles = [];

  for (const [targetLanguage, pack] of Object.entries(packs).sort(([left], [right]) => left.localeCompare(right))) {
    const relativePath = dictionaryBundleBaseRelativePath(language, targetLanguage, pack.version);
    const archive = await createArchive({
      ...options,
      language,
      targetLanguage: pack.targetLanguage,
      version: pack.version,
      relativePath,
      metadata,
      assets: pack.assets,
      dictionaryPacks: {},
      includeLanguageMetadata: false,
    });
    const bundle = {
      url: new URL(archive.relativePath, ensureTrailingSlash(options.assetBaseUrl)).toString(),
      sizeBytes: archive.sizeBytes,
      sha256: archive.sha256,
    };
    dictionaryPacks[targetLanguage] = {
      targetLanguage: pack.targetLanguage,
      name: pack.name,
      version: pack.version,
      bundle,
      assets: archive.files,
    };
    dictionaryBundles.push({
      language,
      targetLanguage,
      relativePath: archive.relativePath,
      publicUrl: bundle.url,
      sizeBytes: archive.sizeBytes,
      sha256: archive.sha256,
      version: pack.version,
      files: archive.files,
    });
  }

  const relativePath = languageBundleBaseRelativePath(language, version);
  const coreArchive = await createArchive({
    ...options,
    language,
    version,
    relativePath,
    metadata,
    assets: coreAssets,
    dictionaryPacks,
    includeLanguageMetadata: true,
  });
  const bundle = {
    url: new URL(coreArchive.relativePath, ensureTrailingSlash(options.assetBaseUrl)).toString(),
    sizeBytes: coreArchive.sizeBytes,
    sha256: coreArchive.sha256,
  };

  return {
    language,
    relativePath: coreArchive.relativePath,
    publicUrl: bundle.url,
    sizeBytes: coreArchive.sizeBytes,
    sha256: coreArchive.sha256,
    version,
    name: metadata.name,
    nameTranslated: metadata.name_translated,
    bundle,
    files: coreArchive.files,
    dictionaryPacks,
    dictionaryBundles,
  };
}

export async function createLanguageDataRelease(options = {}) {
  const releaseOptions = {
    projectRoot,
    sourceRoot: process.env.MLEARN_ROOT_OF_APP || DEFAULT_SOURCE_ROOT,
    outputDir: process.env.MLEARN_LANGUAGE_DATA_OUTPUT_DIR || DEFAULT_OUTPUT_DIR,
    catalogPath: process.env.MLEARN_LANGUAGE_CATALOG_PATH || DEFAULT_CATALOG_PATH,
    assetBaseUrl: process.env.LANGUAGE_ASSET_BASE_URL || DEFAULT_ASSET_BASE_URL,
    overridesDir: process.env.MLEARN_LANGUAGE_DATA_OVERRIDES_DIR || DEFAULT_OVERRIDES_DIR,
    generatedAt: new Date().toISOString(),
    ...options,
  };
  const languagesDir = path.join(releaseOptions.sourceRoot, 'languages');
  const releaseBundles = [];
  const dictionaryBundles = [];
  const catalogLanguages = {};

  fs.rmSync(releaseOptions.outputDir, { recursive: true, force: true });
  fs.mkdirSync(releaseOptions.outputDir, { recursive: true });
  fs.mkdirSync(path.dirname(releaseOptions.catalogPath), { recursive: true });

  for (const fileName of fs.readdirSync(languagesDir).sort()) {
    if (!fileName.endsWith('.json')) continue;
    if (fileName.endsWith('.freq.json')) continue;
    const language = path.basename(fileName, '.json');
    const metadata = applyLanguageMetadataOverride(
      releaseOptions,
      language,
      readJson(path.join(languagesDir, fileName)),
    );
    const releaseBundle = await createLanguageBundle(releaseOptions, language, metadata);
    releaseBundles.push(releaseBundle);
    dictionaryBundles.push(...releaseBundle.dictionaryBundles);
    catalogLanguages[language] = {
      name: releaseBundle.name,
      nameTranslated: releaseBundle.nameTranslated,
      version: releaseBundle.version,
      bundle: releaseBundle.bundle,
      files: releaseBundle.files,
      dictionaryPacks: releaseBundle.dictionaryPacks,
    };
  }

  const assetManifestPath = path.join(releaseOptions.outputDir, 'manifest.json');
  fs.writeFileSync(
    assetManifestPath,
    JSON.stringify({
      generatedAt: releaseOptions.generatedAt,
      bundles: releaseBundles.map((bundle) => ({
        language: bundle.language,
        relativePath: bundle.relativePath,
        publicUrl: bundle.publicUrl,
        sizeBytes: bundle.sizeBytes,
        sha256: bundle.sha256,
        version: bundle.version,
        files: bundle.files,
        dictionaryPacks: bundle.dictionaryPacks,
      })),
      dictionaryBundles,
    }, null, 2) + '\n',
    'utf-8',
  );

  fs.writeFileSync(
    releaseOptions.catalogPath,
    JSON.stringify({
      generatedAt: releaseOptions.generatedAt,
      languages: catalogLanguages,
    }, null, 2) + '\n',
    'utf-8',
  );

  return {
    assetCount: releaseBundles.reduce((sum, bundle) => sum + bundle.files.length, 0) +
      dictionaryBundles.reduce((sum, bundle) => sum + bundle.files.length, 0),
    catalogPath: releaseOptions.catalogPath,
    assetManifestPath,
  };
}

async function main() {
  const result = await createLanguageDataRelease();
  console.log(`Prepared ${result.assetCount} language data asset(s) in ${path.dirname(result.assetManifestPath)}`);
  console.log(`Prepared language catalog at ${result.catalogPath}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
