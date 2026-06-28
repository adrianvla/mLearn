const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const tar = require('tar');

const projectRoot = path.resolve(__dirname, '..');
const rootOfApp = path.join(projectRoot, 'src', 'root-of-app');
const languagesDir = path.join(rootOfApp, 'languages');
const outputDir = path.join(projectRoot, 'release', 'language-data');
const catalogPath = path.join(projectRoot, 'release', 'language-catalog.json');
const DEFAULT_ASSET_BASE_URL = 'https://cdn.kikan.net/mlearn/language-data/';

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

function ensureTrailingSlash(url) {
  return url.endsWith('/') ? url : `${url}/`;
}

function sanitizeVersion(version) {
  return String(version || 'v1').replace(/[^a-zA-Z0-9._-]+/g, '-');
}

function fileNameForBundle(language, version) {
  const sanitizedVersion = sanitizeVersion(version);
  const versionPart = sanitizedVersion.startsWith(`${language}-`) ? sanitizedVersion : `${language}-${sanitizedVersion}`;
  return `language-${versionPart}.tar.gz`;
}

function sha256(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function copyPayloadFile(options, language, asset, stagingDir) {
  const { rootOfApp: sourceRoot } = options;
  if (!asset.bundledPath) {
    throw new Error(`${language}:${asset.id} is missing bundledPath`);
  }

  const sourcePath = path.join(sourceRoot, asset.bundledPath);
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Missing language data source for ${language}:${asset.id}: ${sourcePath}`);
  }

  const outputPath = path.join(stagingDir, 'files', asset.path);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.copyFileSync(sourcePath, outputPath);
  const stats = fs.statSync(outputPath);
  const checksum = sha256(outputPath);

  return {
    id: asset.id,
    path: asset.path,
    sizeBytes: stats.size,
    sha256: checksum,
    required: asset.required,
  };
}

function buildLanguageMetadataForArchive(metadata, files, bundle) {
  return {
    ...metadata,
    languageData: metadata.languageData
      ? {
        ...metadata.languageData,
        bundle,
        assets: files,
      }
      : {
        bundle,
        assets: files,
      },
  };
}

async function createLanguageBundle(options, language, metadata) {
  const version = metadata.languageData?.version ?? `${language}-v1`;
  const fileName = fileNameForBundle(language, version);
  const bundlePath = path.join(options.outputDir, fileName);
  const stagingDir = path.join(options.outputDir, `.staging-${language}`);
  fs.rmSync(stagingDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(stagingDir, 'files'), { recursive: true });

  const sourceAssets = metadata.languageData?.assets ?? [];
  const files = sourceAssets.map((asset) => copyPayloadFile(options, language, asset, stagingDir));
  const languageMetadataFile = {
    id: 'language-metadata',
    path: `languages/${language}.json`,
    required: true,
  };
  const languageMetadataPath = path.join(stagingDir, 'files', languageMetadataFile.path);
  fs.mkdirSync(path.dirname(languageMetadataPath), { recursive: true });
  fs.writeFileSync(
    languageMetadataPath,
    JSON.stringify(buildLanguageMetadataForArchive(metadata, [...files, languageMetadataFile], undefined), null, 2) + '\n',
    'utf-8',
  );
  const metadataStats = fs.statSync(languageMetadataPath);
  files.push({
    ...languageMetadataFile,
    sizeBytes: metadataStats.size,
    sha256: sha256(languageMetadataPath),
  });

  const manifest = {
    schemaVersion: 1,
    language,
    version,
    generatedAt: options.generatedAt,
    name: metadata.name,
    nameTranslated: metadata.name_translated,
    files,
  };
  fs.writeFileSync(path.join(stagingDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf-8');

  await tar.c({ gzip: true, file: bundlePath, cwd: stagingDir }, ['manifest.json', 'files']);
  fs.rmSync(stagingDir, { recursive: true, force: true });

  const bundle = {
    url: new URL(fileName, ensureTrailingSlash(options.assetBaseUrl)).toString(),
    sizeBytes: fs.statSync(bundlePath).size,
    sha256: sha256(bundlePath),
  };

  return {
    language,
    fileName,
    bundlePath,
    publicUrl: bundle.url,
    sizeBytes: bundle.sizeBytes,
    sha256: bundle.sha256,
    version,
    name: metadata.name,
    nameTranslated: metadata.name_translated,
    bundle,
    files,
  };
}

async function createLanguageDataRelease(options) {
  const releaseOptions = {
    projectRoot,
    rootOfApp,
    outputDir,
    catalogPath,
    assetBaseUrl: process.env.LANGUAGE_ASSET_BASE_URL || DEFAULT_ASSET_BASE_URL,
    generatedAt: new Date().toISOString(),
    ...options,
  };
  const releaseLanguagesDir = path.join(releaseOptions.rootOfApp, 'languages');
  const releaseBundles = [];
  const catalogLanguages = {};

  fs.rmSync(releaseOptions.outputDir, { recursive: true, force: true });
  fs.mkdirSync(releaseOptions.outputDir, { recursive: true });
  fs.mkdirSync(path.dirname(releaseOptions.catalogPath), { recursive: true });

  for (const fileName of fs.readdirSync(releaseLanguagesDir).sort()) {
    if (!fileName.endsWith('.json')) continue;
    if (fileName.endsWith('.freq.json')) continue;
    const language = path.basename(fileName, '.json');
    const metadata = readJson(path.join(releaseLanguagesDir, fileName));
    const releaseBundle = await createLanguageBundle(releaseOptions, language, metadata);
    releaseBundles.push(releaseBundle);
    catalogLanguages[language] = {
      name: releaseBundle.name,
      nameTranslated: releaseBundle.nameTranslated,
      version: releaseBundle.version,
      bundle: releaseBundle.bundle,
      files: releaseBundle.files,
    };
  }

  const assetManifestPath = path.join(releaseOptions.outputDir, 'manifest.json');
  fs.writeFileSync(
    assetManifestPath,
    JSON.stringify({ generatedAt: releaseOptions.generatedAt, bundles: releaseBundles.map((bundle) => ({
      language: bundle.language,
      fileName: bundle.fileName,
      publicUrl: bundle.publicUrl,
      sizeBytes: bundle.sizeBytes,
      sha256: bundle.sha256,
      version: bundle.version,
      files: bundle.files,
    })) }, null, 2) + '\n',
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
    assetCount: releaseBundles.reduce((sum, bundle) => sum + bundle.files.length, 0),
    catalogPath: releaseOptions.catalogPath,
    assetManifestPath,
  };
}

async function main() {
  const result = await createLanguageDataRelease();
  console.log(`Prepared ${result.assetCount} language data asset(s) in ${outputDir}`);
  console.log(`Prepared language catalog at ${result.catalogPath}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = {
  createLanguageDataRelease,
};
