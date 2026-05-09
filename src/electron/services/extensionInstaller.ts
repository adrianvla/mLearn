import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { ipcMain } from 'electron';
import AdmZip from 'adm-zip';
import { IPC_CHANNELS } from '../../shared/constants';
import { getLogger } from '../../shared/utils/logger';
import type { BrowserInfo } from './browserDetection';

const log = getLogger('electron.extensionInstaller');

const EXTENSION_DIR_NAME = 'mlearn-extension';
const FIREFOX_EXTENSION_ID = 'mlearn@morisinc.net';

interface ExtensionManifest {
  manifest_version: number;
  name: string;
  version: string;
  description?: string;
  key?: string;
  browser_specific_settings?: {
    gecko?: {
      id?: string;
    };
  };
  [key: string]: unknown;
}

export interface InstallResult {
  success: boolean;
  path?: string;
  error?: string;
  extensionPath?: string;
}

async function copyDirRecursive(src: string, dest: string): Promise<void> {
  await fs.promises.mkdir(dest, { recursive: true });
  const entries = await fs.promises.readdir(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      await copyDirRecursive(srcPath, destPath);
    } else {
      await fs.promises.copyFile(srcPath, destPath);
    }
  }
}

function getExtensionSourceDir(): string {
  return path.resolve(__dirname, '..', '..', '..', 'extension', 'dist');
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.promises.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readExtensionManifest(sourceDir: string): Promise<ExtensionManifest | null> {
  const manifestPath = path.join(sourceDir, 'manifest.json');
  try {
    const data = await fs.promises.readFile(manifestPath, 'utf-8');
    return JSON.parse(data) as ExtensionManifest;
  } catch (error) {
    log.warn('Failed to read extension manifest:', error);
    return null;
  }
}

function getFirefoxExtensionId(manifest: ExtensionManifest): string {
  return manifest.browser_specific_settings?.gecko?.id ?? FIREFOX_EXTENSION_ID;
}

function computeChromeExtensionId(manifestKeyBase64: string): string {
  try {
    const publicKey = Buffer.from(manifestKeyBase64, 'base64');
    const hash = crypto.createHash('sha256').update(publicKey).digest();
    const first16 = hash.slice(0, 16);

    let id = '';
    for (const byte of first16) {
      id += String.fromCharCode('a'.charCodeAt(0) + ((byte >> 4) & 0x0f));
      id += String.fromCharCode('a'.charCodeAt(0) + (byte & 0x0f));
    }

    return id;
  } catch (error) {
    log.error('Failed to compute extension ID:', error);
    const hash = crypto.createHash('sha256').update(manifestKeyBase64).digest('hex').slice(0, 32);
    return hash;
  }
}

function getChromeExtensionsDir(profilePath: string): string {
  return path.join(profilePath, 'Extensions');
}

function getChromeExtensionDir(profilePath: string, extensionId: string, version: string): string {
  return path.join(getChromeExtensionsDir(profilePath), extensionId, version);
}

async function addDirToZip(zip: AdmZip, dirPath: string, zipRoot: string): Promise<void> {
  const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    const zipPath = path.join(zipRoot, entry.name);
    if (entry.isDirectory()) {
      await addDirToZip(zip, fullPath, zipPath);
    } else {
      zip.addLocalFile(fullPath, zipRoot);
    }
  }
}

async function createExtensionXpi(sourceDir: string, destPath: string): Promise<void> {
  const zip = new AdmZip();
  await addDirToZip(zip, sourceDir, '');
  zip.writeZip(destPath);
}

export async function installExtension(browserInfo: BrowserInfo): Promise<InstallResult> {
  if (!browserInfo.profilePath) {
    log.warn(`No profile path available for browser: ${browserInfo.name}`);
    return { success: false, error: 'No profile path available', extensionPath: getExtensionSourceDir() };
  }

  const sourceDir = getExtensionSourceDir();

  try {
    const sourceStats = await fs.promises.stat(sourceDir);
    if (!sourceStats.isDirectory()) {
      log.warn(`Extension source directory does not exist: ${sourceDir}`);
      return { success: false, error: 'Extension source directory does not exist', extensionPath: sourceDir };
    }
  } catch {
    log.warn(`Extension source directory not found: ${sourceDir}`);
    return { success: false, error: 'Extension source directory not found', extensionPath: sourceDir };
  }

  const manifest = await readExtensionManifest(sourceDir);
  if (!manifest) {
    log.warn('Could not read extension manifest');
    return { success: false, error: 'Could not read extension manifest', extensionPath: sourceDir };
  }

  const version = manifest.version || '1.0.0';

  try {
    if (browserInfo.type === 'chrome') {
      if (!manifest.key) {
        log.warn('Extension manifest is missing the "key" field required for Chrome installation');
        return { success: false, error: 'Extension manifest is missing the key field', extensionPath: sourceDir };
      }

      const extensionId = computeChromeExtensionId(manifest.key);
      const extensionDir = getChromeExtensionDir(browserInfo.profilePath, extensionId, version);

      await copyDirRecursive(sourceDir, extensionDir);
      log.info(`Extension installed for ${browserInfo.name} at ${extensionDir} (ID: ${extensionId})`);
      return { success: true, path: extensionDir };
    }

    if (browserInfo.type === 'firefox') {
      const profilesDir = browserInfo.profilePath;
      let profileDirs: string[] = [];

      try {
        const entries = await fs.promises.readdir(profilesDir, { withFileTypes: true });
        profileDirs = entries
          .filter((e) => e.isDirectory())
          .map((e) => path.join(profilesDir, e.name));
      } catch {
        log.warn(`Could not read Firefox profiles directory: ${profilesDir}`);
        return { success: false, error: 'Could not read Firefox profiles directory', extensionPath: sourceDir };
      }

      if (profileDirs.length === 0) {
        log.warn(`No Firefox profiles found in: ${profilesDir}`);
        return { success: false, error: 'No Firefox profiles found', extensionPath: sourceDir };
      }

      const extensionId = manifest ? getFirefoxExtensionId(manifest) : FIREFOX_EXTENSION_ID;

      for (const profileDir of profileDirs) {
        const extensionsDir = path.join(profileDir, 'extensions');
        await fs.promises.mkdir(extensionsDir, { recursive: true });

        const xpiPath = path.join(extensionsDir, `${extensionId}.xpi`);
        await createExtensionXpi(sourceDir, xpiPath);
        log.info(`Extension installed for ${browserInfo.name} profile at ${xpiPath} (ID: ${extensionId})`);
      }
      return { success: true, path: `${extensionId}.xpi` };
    }

    log.warn(`Unsupported browser type: ${browserInfo.type}`);
    return { success: false, error: `Unsupported browser type: ${browserInfo.type}`, extensionPath: sourceDir };
  } catch (error) {
    log.error(`Failed to install extension for ${browserInfo.name}:`, error);
    return { success: false, error: error instanceof Error ? error.message : String(error), extensionPath: sourceDir };
  }
}

export async function uninstallExtension(browserInfo: BrowserInfo): Promise<boolean> {
  if (!browserInfo.profilePath) {
    log.warn(`No profile path available for browser: ${browserInfo.name}`);
    return false;
  }

  const sourceDir = getExtensionSourceDir();
  const manifest = await readExtensionManifest(sourceDir);
  const version = manifest?.version || '1.0.0';

  try {
    if (browserInfo.type === 'chrome') {
      if (!manifest?.key) {
        const legacyDir = path.join(
          getChromeExtensionsDir(browserInfo.profilePath),
          EXTENSION_DIR_NAME,
        );
        if (await pathExists(legacyDir)) {
          await fs.promises.rm(legacyDir, { recursive: true, force: true });
          log.info(`Removed legacy extension for ${browserInfo.name} at ${legacyDir}`);
        }
        return true;
      }

      const extensionId = computeChromeExtensionId(manifest.key);
      const extensionDir = getChromeExtensionDir(browserInfo.profilePath, extensionId, version);

      if (await pathExists(extensionDir)) {
        await fs.promises.rm(extensionDir, { recursive: true, force: true });
        log.info(`Extension uninstalled for ${browserInfo.name} from ${extensionDir}`);
      }

      const idDir = path.join(getChromeExtensionsDir(browserInfo.profilePath), extensionId);
      try {
        const remainingVersions = await fs.promises.readdir(idDir);
        if (remainingVersions.length === 0) {
          await fs.promises.rmdir(idDir);
        }
      } catch {}

      return true;
    }

    if (browserInfo.type === 'firefox') {
      const profilesDir = browserInfo.profilePath;
      let profileDirs: string[] = [];

      try {
        const entries = await fs.promises.readdir(profilesDir, { withFileTypes: true });
        profileDirs = entries
          .filter((e) => e.isDirectory())
          .map((e) => path.join(profilesDir, e.name));
      } catch {
        return false;
      }

      const extensionId = manifest ? getFirefoxExtensionId(manifest) : FIREFOX_EXTENSION_ID;

      for (const profileDir of profileDirs) {
        const xpiPath = path.join(profileDir, 'extensions', `${extensionId}.xpi`);
        if (await pathExists(xpiPath)) {
          await fs.promises.rm(xpiPath, { force: true });
          log.info(`Extension XPI uninstalled for ${browserInfo.name} profile from ${xpiPath}`);
        }

        const legacyDir = path.join(profileDir, 'extensions', EXTENSION_DIR_NAME);
        if (await pathExists(legacyDir)) {
          await fs.promises.rm(legacyDir, { recursive: true, force: true });
          log.info(`Removed legacy unpacked extension for ${browserInfo.name} profile from ${legacyDir}`);
        }
      }
      return true;
    }

    log.warn(`Unsupported browser type: ${browserInfo.type}`);
    return false;
  } catch (error) {
    log.error(`Failed to uninstall extension for ${browserInfo.name}:`, error);
    return false;
  }
}

export async function isExtensionInstalled(browserInfo: BrowserInfo): Promise<boolean> {
  if (!browserInfo.profilePath) {
    return false;
  }

  const sourceDir = getExtensionSourceDir();
  const manifest = await readExtensionManifest(sourceDir);
  const version = manifest?.version || '1.0.0';

  try {
    if (browserInfo.type === 'chrome') {
      if (!manifest?.key) {
        const legacyDir = path.join(
          getChromeExtensionsDir(browserInfo.profilePath),
          EXTENSION_DIR_NAME,
        );
        return await pathExists(legacyDir);
      }

      const extensionId = computeChromeExtensionId(manifest.key);
      const extensionDir = getChromeExtensionDir(browserInfo.profilePath, extensionId, version);
      return await pathExists(extensionDir);
    }

    if (browserInfo.type === 'firefox') {
      const profilesDir = browserInfo.profilePath;
      try {
        const entries = await fs.promises.readdir(profilesDir, { withFileTypes: true });
        const profileDirs = entries
          .filter((e) => e.isDirectory())
          .map((e) => path.join(profilesDir, e.name));

        const extensionId = manifest ? getFirefoxExtensionId(manifest) : FIREFOX_EXTENSION_ID;

        for (const profileDir of profileDirs) {
          const xpiPath = path.join(profileDir, 'extensions', `${extensionId}.xpi`);
          if (await pathExists(xpiPath)) {
            return true;
          }
        }
      } catch {
        return false;
      }
    }

    return false;
  } catch {
    return false;
  }
}

export function setupExtensionInstallerIPC(): void {
  ipcMain.handle(IPC_CHANNELS.INSTALL_EXTENSION, async (_event, browserInfo: BrowserInfo) => {
    return installExtension(browserInfo);
  });

  ipcMain.handle(IPC_CHANNELS.UNINSTALL_EXTENSION, async (_event, browserInfo: BrowserInfo) => {
    const success = await uninstallExtension(browserInfo);
    return { success, error: success ? undefined : 'Extension uninstallation failed' };
  });

  ipcMain.handle(IPC_CHANNELS.IS_EXTENSION_INSTALLED, async (_event, browserInfo: BrowserInfo) => {
    const installed = await isExtensionInstalled(browserInfo);
    return { installed };
  });
}
