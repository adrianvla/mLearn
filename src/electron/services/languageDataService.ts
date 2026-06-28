import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import * as tar from 'tar';
import { getResourcePath, getUserDataPath } from '../utils/platform';
import { downloadFileWithProgress, type ProgressCallback } from '../utils/downloadManager';
import type { LanguageDataAsset, LanguageDataBundle, LanguageDataCatalogStatus, LanguageDataMap } from '../../shared/types';
import { getLogger } from '../../shared/utils/logger';

const log = getLogger('electron.languageData');

export interface LanguageDataStatus {
  language: string;
  dataRoot: string;
  installed: boolean;
  missingAssets: string[];
  assets: Array<{
    id: string;
    path: string;
    installed: boolean;
    sizeBytes?: number;
  }>;
}

export function getLanguageDataRoot(): string {
  return path.join(getUserDataPath(), 'language-data');
}

function getAssets(language: string, langData: LanguageDataMap): LanguageDataAsset[] {
  return langData[language]?.languageData?.assets ?? [];
}

function getBundle(language: string, langData: LanguageDataMap): LanguageDataBundle | undefined {
  return langData[language]?.languageData?.bundle;
}

function assertSafeRelativePath(relativePath: string): void {
  if (!relativePath || path.isAbsolute(relativePath)) {
    throw new Error(`Invalid language data asset path: ${relativePath}`);
  }
  const normalized = path.normalize(relativePath);
  if (normalized === '..' || normalized.startsWith(`..${path.sep}`)) {
    throw new Error(`Invalid language data asset path: ${relativePath}`);
  }
}

function assertSafeArchivePath(relativePath: string): void {
  assertSafeRelativePath(relativePath);
  const normalized = path.posix.normalize(relativePath.split(path.sep).join('/'));
  if (normalized !== 'manifest.json' && normalized !== 'files' && !normalized.startsWith('files/')) {
    throw new Error(`Invalid language bundle archive path: ${relativePath}`);
  }
}

export function getInstalledLanguageAssetPath(asset: LanguageDataAsset): string {
  assertSafeRelativePath(asset.path);
  return path.join(getLanguageDataRoot(), asset.path);
}

function getBundledAssetCandidates(asset: LanguageDataAsset): string[] {
  const relativePath = asset.bundledPath ?? asset.path;
  assertSafeRelativePath(relativePath);
  const resourcePath = getResourcePath();
  return [
    path.join(resourcePath, 'root-of-app', relativePath),
    path.join(resourcePath, relativePath),
    path.join(process.cwd(), 'src', 'root-of-app', relativePath),
  ];
}

function computeSha256(filePath: string): string {
  const hash = crypto.createHash('sha256');
  const data = fs.readFileSync(filePath);
  hash.update(data);
  return hash.digest('hex');
}

function verifyChecksum(asset: LanguageDataAsset, filePath: string): void {
  if (!asset.sha256) return;
  const actual = computeSha256(filePath);
  if (actual !== asset.sha256) {
    try { fs.unlinkSync(filePath); } catch {}
    throw new Error(`Checksum mismatch for language data asset ${asset.id}`);
  }
}

function verifyBundleChecksum(bundle: LanguageDataBundle, filePath: string): void {
  if (!bundle.sha256) return;
  const actual = computeSha256(filePath);
  if (actual !== bundle.sha256) {
    try { fs.unlinkSync(filePath); } catch {}
    throw new Error('Checksum mismatch for language data bundle');
  }
}

function parseBundleManifest(extractDir: string, language: string): { files: LanguageDataAsset[] } {
  const manifestPath = path.join(extractDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Language data bundle for ${language} is missing manifest.json`);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as unknown;
  if (
    typeof manifest !== 'object' ||
    manifest === null ||
    Array.isArray(manifest) ||
    (manifest as { schemaVersion?: unknown }).schemaVersion !== 1 ||
    (manifest as { language?: unknown }).language !== language ||
    !Array.isArray((manifest as { files?: unknown }).files)
  ) {
    throw new Error(`Language data bundle manifest is invalid for ${language}`);
  }
  const files = (manifest as { files: LanguageDataAsset[] }).files;
  const seen = new Set<string>();
  for (const file of files) {
    assertSafeRelativePath(file.path);
    if (seen.has(file.path)) {
      throw new Error(`Duplicate language data bundle path: ${file.path}`);
    }
    seen.add(file.path);
  }
  return { files };
}

export function getLanguageDataStatus(language: string, langData: LanguageDataMap): LanguageDataStatus {
  const assets = getAssets(language, langData);
  const assetStatuses = assets.map((asset) => {
    const installedPath = getInstalledLanguageAssetPath(asset);
    const installed = fs.existsSync(installedPath);
    return {
      id: asset.id,
      path: installedPath,
      installed,
      sizeBytes: asset.sizeBytes,
    };
  });
  const missingAssets = assets
    .filter((asset, index) => asset.required !== false && !assetStatuses[index]?.installed)
    .map((asset) => asset.id);

  return {
    language,
    dataRoot: getLanguageDataRoot(),
    installed: missingAssets.length === 0,
    missingAssets,
    assets: assetStatuses,
  };
}

export function getLanguageDataCatalogStatus(langData: LanguageDataMap): LanguageDataCatalogStatus[] {
  return Object.entries(langData)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([language, metadata]) => {
      const status = getLanguageDataStatus(language, langData);
      const assets = getAssets(language, langData);
      const bundle = metadata.languageData?.bundle;
      const totalBytes = bundle?.sizeBytes ?? assets.reduce((sum, asset) => sum + (asset.sizeBytes ?? 0), 0);
      const installedBytes = assets.reduce((sum, asset) => {
        const installedPath = getInstalledLanguageAssetPath(asset);
        if (!fs.existsSync(installedPath)) {
          return sum;
        }
        return sum + fs.statSync(installedPath).size;
      }, 0);

      return {
        language,
        name: metadata.name,
        nameTranslated: metadata.name_translated,
        dataRoot: status.dataRoot,
        installed: status.installed,
        totalBytes,
        installedBytes,
        missingRequiredAssets: status.missingAssets,
        assets: status.assets,
      };
    });
}

async function installAsset(asset: LanguageDataAsset, onProgress?: ProgressCallback): Promise<void> {
  const installedPath = getInstalledLanguageAssetPath(asset);
  if (fs.existsSync(installedPath)) {
    verifyChecksum(asset, installedPath);
    return;
  }

  fs.mkdirSync(path.dirname(installedPath), { recursive: true });

  const bundledPath = getBundledAssetCandidates(asset).find((candidate) => fs.existsSync(candidate));
  if (bundledPath) {
    fs.copyFileSync(bundledPath, installedPath);
    verifyChecksum(asset, installedPath);
    return;
  }

  if (!asset.url) {
    throw new Error(`No download URL for language data asset ${asset.id}`);
  }

  log.info(`Downloading language data asset ${asset.id} from ${asset.url}`);
  await downloadFileWithProgress(asset.url, installedPath, onProgress);
  verifyChecksum(asset, installedPath);
}

async function installBundle(
  language: string,
  bundle: LanguageDataBundle,
  onProgress?: ProgressCallback,
): Promise<void> {
  const bundleUrl = bundle.url ?? bundle.href;
  if (!bundleUrl) {
    throw new Error(`No download URL for language data bundle ${language}`);
  }

  const dataRoot = getLanguageDataRoot();
  const workRoot = path.join(dataRoot, '.downloads', language);
  const archivePath = path.join(workRoot, `${language}.tar.gz`);
  const extractDir = path.join(workRoot, 'extract');
  fs.rmSync(workRoot, { recursive: true, force: true });
  fs.mkdirSync(extractDir, { recursive: true });

  try {
    log.info(`Downloading language data bundle ${language} from ${bundleUrl}`);
    await downloadFileWithProgress(bundleUrl, archivePath, onProgress);
    verifyBundleChecksum(bundle, archivePath);

    await tar.x({
      file: archivePath,
      cwd: extractDir,
      filter: (entryPath, entry) => {
        assertSafeArchivePath(entryPath);
        const entryType = 'type' in entry ? entry.type : undefined;
        if (entryType !== undefined && entryType !== 'File' && entryType !== 'Directory') {
          throw new Error(`Unsupported language bundle archive entry type: ${entryType}`);
        }
        return true;
      },
    });

    const manifest = parseBundleManifest(extractDir, language);
    for (const file of manifest.files) {
      const extractedPath = path.join(extractDir, 'files', file.path);
      if (!fs.existsSync(extractedPath)) {
        throw new Error(`Language data bundle is missing file: ${file.path}`);
      }
      if (file.sizeBytes !== undefined && fs.statSync(extractedPath).size !== file.sizeBytes) {
        throw new Error(`Size mismatch for language data bundle file ${file.path}`);
      }
      verifyChecksum(file, extractedPath);

      const installedPath = getInstalledLanguageAssetPath(file);
      fs.mkdirSync(path.dirname(installedPath), { recursive: true });
      const tmpInstalledPath = `${installedPath}.installing`;
      fs.copyFileSync(extractedPath, tmpInstalledPath);
      fs.renameSync(tmpInstalledPath, installedPath);
    }
  } finally {
    fs.rmSync(workRoot, { recursive: true, force: true });
  }
}

export async function ensureLanguageDataInstalled(
  language: string,
  langData: LanguageDataMap,
  onProgress?: ProgressCallback,
): Promise<LanguageDataStatus> {
  const assets = getAssets(language, langData).filter((asset) => asset.required !== false);
  const bundle = getBundle(language, langData);
  if (bundle && assets.some((asset) => !fs.existsSync(getInstalledLanguageAssetPath(asset)))) {
    await installBundle(language, bundle, onProgress);
    return getLanguageDataStatus(language, langData);
  }
  for (const asset of assets) {
    await installAsset(asset, onProgress);
  }
  return getLanguageDataStatus(language, langData);
}
