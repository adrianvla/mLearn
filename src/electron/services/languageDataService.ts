import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import * as tar from 'tar';
import { getUserDataPath } from '../utils/platform';
import { downloadFileWithProgress, type ProgressCallback } from '../utils/downloadManager';
import type {
  LanguageDataAsset,
  LanguageDataBundle,
  LanguageDataCatalogStatus,
  LanguageDataManifest,
  LanguageDataMap,
  LanguagePythonRequirementComponent,
} from '../../shared/types';
import { getLogger } from '../../shared/utils/logger';

const log = getLogger('electron.languageData');
const inFlightInstalls = new Map<string, Promise<void>>();

type LanguageDataAssetStatus = {
  id: string;
  path: string;
  installed: boolean;
  outdated?: boolean;
  sizeBytes?: number;
  validationIssue?: string;
};

export interface LanguageDataStatus {
  language: string;
  dictionaryTargetLanguage?: string;
  dataRoot: string;
  installed: boolean;
  outdated: boolean;
  missingAssets: string[];
  assets: Array<{
    id: string;
    path: string;
    installed: boolean;
    outdated?: boolean;
    sizeBytes?: number;
    validationIssue?: string;
  }>;
}

export interface LanguageDataInstallOptions {
  components?: readonly LanguagePythonRequirementComponent[];
}

const CORE_COMPONENT: LanguagePythonRequirementComponent = 'core';
const TOGGLE_CONTROLLED_INSTALL_COMPONENTS = new Set<LanguagePythonRequirementComponent>(['ocr', 'llm', 'voice']);

export function getLanguageDataRoot(): string {
  return path.join(getUserDataPath(), 'language-data');
}

function getInstallManifest(
  language: string,
  langData: LanguageDataMap,
  dictionaryTargetLanguage?: string,
): Pick<LanguageDataManifest, 'assets' | 'bundle' | 'version'> | undefined {
  const manifest = langData[language]?.languageData;
  if (!dictionaryTargetLanguage) {
    return manifest;
  }
  return manifest?.dictionaryPacks?.[dictionaryTargetLanguage];
}

function getAssets(
  language: string,
  langData: LanguageDataMap,
  dictionaryTargetLanguage?: string,
  options?: LanguageDataInstallOptions,
): LanguageDataAsset[] {
  return filterAssetsForInstallScope(
    getInstallManifest(language, langData, dictionaryTargetLanguage)?.assets ?? [],
    options,
  );
}

function getBundle(
  language: string,
  langData: LanguageDataMap,
  dictionaryTargetLanguage?: string,
): LanguageDataBundle | undefined {
  return getInstallManifest(language, langData, dictionaryTargetLanguage)?.bundle;
}

export function resolveDictionaryTargetLanguage(
  language: string,
  langData: LanguageDataMap,
  preferredTargetLanguage?: string,
): string | undefined {
  const packs = langData[language]?.languageData?.dictionaryPacks;
  if (!packs) return undefined;
  if (preferredTargetLanguage && packs[preferredTargetLanguage]) {
    return preferredTargetLanguage;
  }
  return undefined;
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

function isIgnoredArchiveMetadataPath(relativePath: string): boolean {
  const normalized = path.posix.normalize(relativePath.split(path.sep).join('/'));
  if (normalized === '__MACOSX' || normalized.startsWith('__MACOSX/')) {
    return true;
  }
  return normalized.split('/').some((segment) => segment === '.DS_Store' || segment.startsWith('._'));
}

export function getInstalledLanguageAssetPath(asset: LanguageDataAsset): string {
  assertSafeRelativePath(asset.path);
  return path.join(getLanguageDataRoot(), asset.path);
}

function getInstallKey(language: string, dictionaryTargetLanguage?: string): string {
  return dictionaryTargetLanguage ? `${language}:${dictionaryTargetLanguage}` : language;
}

function getInstallReceiptPath(installKey: string): string {
  const safeKey = installKey.replace(/[^a-zA-Z0-9._-]/g, '_');
  return path.join(getLanguageDataRoot(), '.install-receipts', `${safeKey}.json`);
}

function readInstallReceiptVersion(installKey: string): string | undefined {
  try {
    const parsed = JSON.parse(fs.readFileSync(getInstallReceiptPath(installKey), 'utf-8')) as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return undefined;
    }
    const version = (parsed as { version?: unknown }).version;
    return typeof version === 'string' ? version : undefined;
  } catch {
    return undefined;
  }
}

function compareStructuredVersions(left: string, right: string): number | undefined {
  const numericToken = /^\d+$/;
  const tokenize = (value: string) => value.split(/(\d+)/).filter(Boolean);
  const leftTokens = tokenize(left);
  const rightTokens = tokenize(right);
  if (leftTokens.length !== rightTokens.length) return undefined;

  for (let index = 0; index < leftTokens.length; index += 1) {
    const leftToken = leftTokens[index];
    const rightToken = rightTokens[index];
    const leftIsNumeric = numericToken.test(leftToken);
    const rightIsNumeric = numericToken.test(rightToken);
    if (leftIsNumeric !== rightIsNumeric) return undefined;
    if (!leftIsNumeric) {
      if (leftToken.toLowerCase() !== rightToken.toLowerCase()) return undefined;
      continue;
    }

    const leftNumber = BigInt(leftToken);
    const rightNumber = BigInt(rightToken);
    if (leftNumber > rightNumber) return 1;
    if (leftNumber < rightNumber) return -1;
  }

  return 0;
}

function installedVersionSatisfiesExpected(installedVersion: string, expectedVersion: string): boolean {
  if (installedVersion === expectedVersion) return true;
  const comparison = compareStructuredVersions(installedVersion, expectedVersion);
  return comparison !== undefined && comparison >= 0;
}

function writeInstallReceipt(installKey: string, version?: string): void {
  if (!version) return;
  const receiptPath = getInstallReceiptPath(installKey);
  fs.mkdirSync(path.dirname(receiptPath), { recursive: true });
  fs.writeFileSync(
    receiptPath,
    JSON.stringify({ version, installedAt: new Date().toISOString() }, null, 2),
    'utf-8',
  );
}

function syncInstalledDictionaryPackMetadata(
  language: string,
  langData: LanguageDataMap,
  dictionaryTargetLanguage: string,
): void {
  const languageManifest = langData[language]?.languageData;
  const dictionaryPack = languageManifest?.dictionaryPacks?.[dictionaryTargetLanguage];
  const metadataAsset = languageManifest?.assets.find(isLanguageMetadataAsset);
  if (!dictionaryPack || !metadataAsset) return;

  const metadataPath = getInstalledLanguageAssetPath(metadataAsset);
  const parsed = JSON.parse(fs.readFileSync(metadataPath, 'utf-8')) as unknown;
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`Installed language metadata is invalid for ${language}`);
  }

  const metadata = parsed as Record<string, unknown>;
  const rawLanguageData = metadata.languageData;
  const installedLanguageData = typeof rawLanguageData === 'object' && rawLanguageData !== null && !Array.isArray(rawLanguageData)
    ? rawLanguageData as Record<string, unknown>
    : {};
  const rawDictionaryPacks = installedLanguageData.dictionaryPacks;
  const installedDictionaryPacks = typeof rawDictionaryPacks === 'object'
    && rawDictionaryPacks !== null
    && !Array.isArray(rawDictionaryPacks)
    ? rawDictionaryPacks as Record<string, unknown>
    : {};
  const updatedMetadata = {
    ...metadata,
    languageData: {
      ...installedLanguageData,
      dictionaryPacks: {
        ...installedDictionaryPacks,
        [dictionaryTargetLanguage]: dictionaryPack,
      },
    },
  };
  const temporaryPath = `${metadataPath}.installing`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(updatedMetadata, null, 2)}\n`, 'utf-8');
  fs.renameSync(temporaryPath, metadataPath);
}

function installReceiptVersionMatches(installKey: string, expectedVersion?: string): boolean {
  if (!expectedVersion) return true;
  const installedVersion = readInstallReceiptVersion(installKey);
  return installedVersion === undefined || installedVersionSatisfiesExpected(installedVersion, expectedVersion);
}

function normalizeInstallComponents(options?: LanguageDataInstallOptions): Set<string> {
  const components = options?.components?.length ? options.components : [CORE_COMPONENT];
  return new Set(components.map((component) => String(component)));
}

function assetMatchesInstallScope(asset: LanguageDataAsset, options?: LanguageDataInstallOptions): boolean {
  if (!asset.components || asset.components.length === 0) return true;
  const installComponents = normalizeInstallComponents(options);
  return asset.components.some((component) => (
    installComponents.has(String(component)) ||
    !TOGGLE_CONTROLLED_INSTALL_COMPONENTS.has(component)
  ));
}

function filterAssetsForInstallScope(
  assets: LanguageDataAsset[],
  options?: LanguageDataInstallOptions,
): LanguageDataAsset[] {
  return assets.filter((asset) => assetMatchesInstallScope(asset, options));
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
    throw new Error(`Checksum mismatch for language data asset ${asset.id}: expected ${asset.sha256}, got ${actual}`);
  }
}

function shouldVerifyExistingChecksum(asset: LanguageDataAsset): boolean {
  if (!asset.sha256) return false;
  if (asset.path.startsWith('languages/')) return true;
  return (asset.sizeBytes ?? Number.MAX_SAFE_INTEGER) <= 5 * 1024 * 1024;
}

function isLanguageMetadataAsset(asset: LanguageDataAsset): boolean {
  return asset.path.startsWith('languages/')
    && asset.path.endsWith('.json')
    && !asset.path.endsWith('.freq.json');
}

function readInstalledLanguageMetadataVersion(asset: LanguageDataAsset, filePath: string): string | undefined {
  if (!isLanguageMetadataAsset(asset)) return undefined;
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return undefined;
    }
    const version = (parsed as { languageData?: { version?: unknown } }).languageData?.version;
    return typeof version === 'string' ? version : undefined;
  } catch {
    return undefined;
  }
}

function getAssetStatus(asset: LanguageDataAsset, expectedVersion?: string): LanguageDataAssetStatus {
  const installedPath = getInstalledLanguageAssetPath(asset);
  if (!fs.existsSync(installedPath)) {
    return {
      id: asset.id,
      path: installedPath,
      installed: false,
      sizeBytes: asset.sizeBytes,
      validationIssue: 'missing',
    };
  }

  try {
    const stat = fs.statSync(installedPath);
    if (!stat.isFile()) {
      return {
        id: asset.id,
        path: installedPath,
        installed: false,
        sizeBytes: asset.sizeBytes,
        validationIssue: 'not-a-file',
      };
    }
    if (expectedVersion && isLanguageMetadataAsset(asset)) {
      const installedVersion = readInstalledLanguageMetadataVersion(asset, installedPath);
      if (installedVersion !== undefined && installedVersionSatisfiesExpected(installedVersion, expectedVersion)) {
        return {
          id: asset.id,
          path: installedPath,
          installed: true,
          sizeBytes: asset.sizeBytes,
        };
      }
      if (installedVersion !== undefined) {
        return {
          id: asset.id,
          path: installedPath,
          installed: false,
          outdated: true,
          sizeBytes: asset.sizeBytes,
          validationIssue: `version-mismatch:${installedVersion}`,
        };
      }
    }
    if (asset.sizeBytes !== undefined && stat.size !== asset.sizeBytes) {
      return {
        id: asset.id,
        path: installedPath,
        installed: false,
        outdated: true,
        sizeBytes: asset.sizeBytes,
        validationIssue: `size-mismatch:${stat.size}`,
      };
    }
    if (shouldVerifyExistingChecksum(asset)) {
      const actual = computeSha256(installedPath);
      if (actual !== asset.sha256) {
        return {
          id: asset.id,
          path: installedPath,
          installed: false,
          outdated: true,
          sizeBytes: asset.sizeBytes,
          validationIssue: `checksum-mismatch:${actual}`,
        };
      }
    }
    return {
      id: asset.id,
      path: installedPath,
      installed: true,
      sizeBytes: asset.sizeBytes,
    };
  } catch (error) {
    return {
      id: asset.id,
      path: installedPath,
      installed: false,
      sizeBytes: asset.sizeBytes,
      validationIssue: error instanceof Error ? error.message : String(error),
    };
  }
}

function verifyBundleChecksum(bundle: LanguageDataBundle, filePath: string, bundleLabel: string): void {
  if (!bundle.sha256) return;
  const actual = computeSha256(filePath);
  if (actual !== bundle.sha256) {
    try { fs.unlinkSync(filePath); } catch {}
    throw new Error(`Checksum mismatch for language data bundle ${bundleLabel}: expected ${bundle.sha256}, got ${actual}`);
  }
}

function parseBundleManifest(
  extractDir: string,
  language: string,
  dictionaryTargetLanguage?: string,
): { files: LanguageDataAsset[] } {
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
  if (dictionaryTargetLanguage) {
    const declaredTargetLanguage = (manifest as {
      targetLanguage?: unknown;
      dictionaryTargetLanguage?: unknown;
    }).targetLanguage ?? (manifest as { dictionaryTargetLanguage?: unknown }).dictionaryTargetLanguage;
    if (declaredTargetLanguage !== undefined && declaredTargetLanguage !== dictionaryTargetLanguage) {
      throw new Error(
        `Language data bundle manifest target mismatch for ${language}:${dictionaryTargetLanguage}; got ${String(declaredTargetLanguage)}`,
      );
    }
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

function selectBundleFiles(
  manifestFiles: LanguageDataAsset[],
  expectedAssets?: LanguageDataAsset[],
): LanguageDataAsset[] {
  if (!expectedAssets) return manifestFiles;
  return expectedAssets.map((asset) => {
    const bundled = manifestFiles.find((file) => file.path === asset.path);
    if (!bundled) {
      throw new Error(`Language data bundle is missing manifest entry for file: ${asset.path}`);
    }
    return bundled;
  });
}

function getAssetStatuses(assets: LanguageDataAsset[], expectedVersion?: string) {
  return assets.map((asset) => getAssetStatus(asset, expectedVersion));
}

function getMissingRequiredAssets(assets: LanguageDataAsset[], assetStatuses: ReturnType<typeof getAssetStatuses>): string[] {
  return assets
    .filter((asset, index) => asset.required !== false && !assetStatuses[index]?.installed)
    .map((asset) => asset.id);
}

function hasOutdatedRequiredAssets(assets: LanguageDataAsset[], assetStatuses: ReturnType<typeof getAssetStatuses>): boolean {
  return assets.some((asset, index) => asset.required !== false && assetStatuses[index]?.outdated);
}

function getInstalledBytes(assets: LanguageDataAsset[]): number {
  return assets.reduce((sum, asset) => {
    const status = getAssetStatus(asset);
    if (!status.installed) {
      return sum;
    }
    return sum + fs.statSync(status.path).size;
  }, 0);
}

export function getLanguageDataStatus(
  language: string,
  langData: LanguageDataMap,
  dictionaryTargetLanguage?: string,
  options?: LanguageDataInstallOptions,
): LanguageDataStatus {
  const assets = getAssets(language, langData, dictionaryTargetLanguage, options);
  const expectedVersion = getInstallManifest(language, langData, dictionaryTargetLanguage)?.version;
  const assetStatuses = getAssetStatuses(assets, expectedVersion);
  const missingAssets = assets
    .filter((asset, index) => asset.required !== false && !assetStatuses[index]?.installed)
    .map((asset) => asset.id);
  const installKey = getInstallKey(language, dictionaryTargetLanguage);
  const outdated = hasOutdatedRequiredAssets(assets, assetStatuses)
    || (missingAssets.length === 0 && !installReceiptVersionMatches(installKey, expectedVersion));

  return {
    language,
    dictionaryTargetLanguage,
    dataRoot: getLanguageDataRoot(),
    installed: missingAssets.length === 0 && !outdated,
    outdated,
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
      const installedBytes = getInstalledBytes(assets);
      const dictionaryPacks = metadata.languageData?.dictionaryPacks
        ? Object.values(metadata.languageData.dictionaryPacks)
          .sort((left, right) => left.targetLanguage.localeCompare(right.targetLanguage))
          .map((pack) => {
            const packAssets = pack.assets;
            const packAssetStatuses = getAssetStatuses(packAssets, pack.version);
            const missingRequiredAssets = getMissingRequiredAssets(packAssets, packAssetStatuses);
            const outdated = hasOutdatedRequiredAssets(packAssets, packAssetStatuses)
              || (missingRequiredAssets.length === 0 && !installReceiptVersionMatches(getInstallKey(language, pack.targetLanguage), pack.version));
            return {
              targetLanguage: pack.targetLanguage,
              name: pack.name,
              version: pack.version,
              installed: missingRequiredAssets.length === 0 && !outdated,
              outdated,
              totalBytes: pack.bundle?.sizeBytes ?? packAssets.reduce((sum, asset) => sum + (asset.sizeBytes ?? 0), 0),
              installedBytes: getInstalledBytes(packAssets),
              missingRequiredAssets,
              assets: packAssetStatuses,
            };
          })
        : undefined;

      return {
        language,
        name: metadata.name,
        nameTranslated: metadata.name_translated,
        dataRoot: status.dataRoot,
        installed: status.installed,
        outdated: status.outdated,
        totalBytes,
        installedBytes,
        missingRequiredAssets: status.missingAssets,
        assets: status.assets,
        dictionaryPacks,
      };
    });
}

async function installBundle(
  language: string,
  bundle: LanguageDataBundle,
  onProgress?: ProgressCallback,
  workKey: string = language,
  dictionaryTargetLanguage?: string,
  expectedAssets?: LanguageDataAsset[],
): Promise<void> {
  const bundleUrl = bundle.url ?? bundle.href;
  if (!bundleUrl) {
    throw new Error(`No download URL for language data bundle ${language}`);
  }

  const dataRoot = getLanguageDataRoot();
  const workRoot = path.join(dataRoot, '.downloads', workKey);
  const archivePath = path.join(workRoot, `${workKey}.tar.gz`);
  const extractDir = path.join(workRoot, 'extract');
  fs.rmSync(workRoot, { recursive: true, force: true });
  fs.mkdirSync(extractDir, { recursive: true });

  try {
    log.info(`Downloading language data bundle ${language} from ${bundleUrl}`);
    await downloadFileWithProgress(bundleUrl, archivePath, onProgress);
    verifyBundleChecksum(bundle, archivePath, `${workKey} (${bundleUrl})`);

    await tar.x({
      file: archivePath,
      cwd: extractDir,
      filter: (entryPath, entry) => {
        if (isIgnoredArchiveMetadataPath(entryPath)) {
          return false;
        }
        assertSafeArchivePath(entryPath);
        const entryType = 'type' in entry ? entry.type : undefined;
        if (entryType !== undefined && entryType !== 'File' && entryType !== 'Directory') {
          throw new Error(`Unsupported language bundle archive entry type: ${entryType}`);
        }
        return true;
      },
    });

    const manifest = parseBundleManifest(extractDir, language, dictionaryTargetLanguage);
    for (const file of selectBundleFiles(manifest.files, expectedAssets)) {
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
  dictionaryTargetLanguage?: string,
  options?: LanguageDataInstallOptions,
): Promise<LanguageDataStatus> {
  const assets = getAssets(language, langData, dictionaryTargetLanguage, options).filter((asset) => asset.required !== false);
  const bundle = getBundle(language, langData, dictionaryTargetLanguage);
  const expectedVersion = getInstallManifest(language, langData, dictionaryTargetLanguage)?.version;
  const currentStatus = getLanguageDataStatus(language, langData, dictionaryTargetLanguage, options);
  if (currentStatus.installed) {
    if (dictionaryTargetLanguage) {
      syncInstalledDictionaryPackMetadata(language, langData, dictionaryTargetLanguage);
    }
    return currentStatus;
  }
  if (!bundle) {
    throw new Error(`No language data bundle is available for ${language}${dictionaryTargetLanguage ? `:${dictionaryTargetLanguage}` : ''}`);
  }
  const installKey = getInstallKey(language, dictionaryTargetLanguage);
  const existingInstall = inFlightInstalls.get(installKey);
  if (existingInstall) {
    await existingInstall;
    return getLanguageDataStatus(language, langData, dictionaryTargetLanguage, options);
  }

  const installPromise = installBundle(
    language,
    bundle,
    onProgress,
    dictionaryTargetLanguage ? `${language}-${dictionaryTargetLanguage}-dictionary` : language,
    dictionaryTargetLanguage,
    assets,
  );
  inFlightInstalls.set(installKey, installPromise);
  try {
    await installPromise;
    if (dictionaryTargetLanguage) {
      syncInstalledDictionaryPackMetadata(language, langData, dictionaryTargetLanguage);
    }
    writeInstallReceipt(installKey, expectedVersion);
  } finally {
    if (inFlightInstalls.get(installKey) === installPromise) {
      inFlightInstalls.delete(installKey);
    }
  }
  return getLanguageDataStatus(language, langData, dictionaryTargetLanguage, options);
}
