import fs from 'fs';
import path from 'path';
import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants';
import { getLogger } from '../../shared/utils/logger';
import type { BrowserInfo } from './browserDetection';

const log = getLogger('electron.extensionInstaller');

const EXTENSION_DIR_NAME = 'mlearn-extension';

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

export async function installExtension(browserInfo: BrowserInfo): Promise<boolean> {
  if (!browserInfo.profilePath) {
    log.warn(`No profile path available for browser: ${browserInfo.name}`);
    return false;
  }

  const sourceDir = getExtensionSourceDir();

  try {
    const sourceStats = await fs.promises.stat(sourceDir);
    if (!sourceStats.isDirectory()) {
      log.warn(`Extension source directory does not exist: ${sourceDir}`);
      return false;
    }
  } catch {
    log.warn(`Extension source directory not found: ${sourceDir}`);
    return false;
  }

  try {
    if (browserInfo.type === 'chrome') {
      const extensionsDir = path.join(browserInfo.profilePath, 'Extensions', EXTENSION_DIR_NAME);
      await copyDirRecursive(sourceDir, extensionsDir);
      log.info(`Extension installed for ${browserInfo.name} at ${extensionsDir}`);
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
        log.warn(`Could not read Firefox profiles directory: ${profilesDir}`);
        return false;
      }

      if (profileDirs.length === 0) {
        log.warn(`No Firefox profiles found in: ${profilesDir}`);
        return false;
      }

      for (const profileDir of profileDirs) {
        const extensionsDir = path.join(profileDir, 'extensions');
        await copyDirRecursive(sourceDir, extensionsDir);
        log.info(`Extension installed for ${browserInfo.name} profile at ${extensionsDir}`);
      }
      return true;
    }

    log.warn(`Unsupported browser type: ${browserInfo.type}`);
    return false;
  } catch (error) {
    log.error(`Failed to install extension for ${browserInfo.name}:`, error);
    return false;
  }
}

export function setupExtensionInstallerIPC(): void {
  ipcMain.handle(IPC_CHANNELS.INSTALL_EXTENSION, async (_event, browserInfo: BrowserInfo) => {
    const success = await installExtension(browserInfo);
    return { success, error: success ? undefined : 'Extension installation failed' };
  });
}
