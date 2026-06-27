import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { getResourcePath, getUserDataPath } from '../utils/platform';
import { downloadFileWithProgress, type ProgressCallback } from '../utils/downloadManager';
import type { LanguageDataAsset, LanguageDataCatalogStatus, LanguageDataMap } from '../../shared/types';
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

function assertSafeRelativePath(relativePath: string): void {
  if (!relativePath || path.isAbsolute(relativePath)) {
    throw new Error(`Invalid language data asset path: ${relativePath}`);
  }
  const normalized = path.normalize(relativePath);
  if (normalized === '..' || normalized.startsWith(`..${path.sep}`)) {
    throw new Error(`Invalid language data asset path: ${relativePath}`);
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
      const totalBytes = assets.reduce((sum, asset) => sum + (asset.sizeBytes ?? 0), 0);
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

export async function ensureLanguageDataInstalled(
  language: string,
  langData: LanguageDataMap,
  onProgress?: ProgressCallback,
): Promise<LanguageDataStatus> {
  const assets = getAssets(language, langData).filter((asset) => asset.required !== false);
  for (const asset of assets) {
    await installAsset(asset, onProgress);
  }
  return getLanguageDataStatus(language, langData);
}
