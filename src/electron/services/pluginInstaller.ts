import fs from 'fs';
import path from 'path';
import AdmZip from 'adm-zip';
import { BrowserWindow, dialog } from 'electron';
import type { OpenDialogOptions } from 'electron';
import { PLUGIN_API_VERSION } from '../../shared/plugins/constants';
import type { PluginInstallResult, PluginManifest } from '../../shared/plugins/types';
import { getUserDataPath } from '../utils/platform';
import { getPluginManifest, normalizePluginId, registerInstalledPlugin, validateManifest } from './pluginManager';

const MANIFEST_FILE_NAME = 'plugin.json';
const ZIP_EXTENSION = '.zip';
const ZIP_SYMLINK_MASK = 0o170000;
const ZIP_SYMLINK_MODE = 0o120000;

export function getPluginsDir(): string {
  return path.join(getUserDataPath(), 'plugins');
}

export function safeResolve(baseDir: string, relativePath: string): string {
  const resolvedBaseDir = path.resolve(baseDir);
  const resolvedPath = path.resolve(baseDir, relativePath);

  if (resolvedPath !== resolvedBaseDir && !resolvedPath.startsWith(`${resolvedBaseDir}${path.sep}`)) {
    throw new Error(`Zip entry path traversal rejected: ${relativePath}`);
  }

  return resolvedPath;
}

function ensurePluginsDir(): string {
  const pluginsDir = getPluginsDir();
  fs.mkdirSync(pluginsDir, { recursive: true });
  return pluginsDir;
}

function cleanupDirectory(targetPath: string | null): void {
  if (!targetPath) {
    return;
  }

  fs.rmSync(targetPath, { recursive: true, force: true });
}

function isZipSymlink(entry: AdmZip.IZipEntry): boolean {
  const mode = (entry.attr >> 16) & ZIP_SYMLINK_MASK;
  return mode === ZIP_SYMLINK_MODE;
}

function normalizeZipEntryName(entryName: string): string {
  return entryName.replace(/\\/g, '/');
}

function isZipMetadataEntry(entryName: string): boolean {
  return entryName === '__MACOSX' || entryName === '.DS_Store';
}

function resolveExtractedPluginDir(extractedDir: string): string {
  const manifestPath = path.join(extractedDir, MANIFEST_FILE_NAME);
  if (fs.existsSync(manifestPath)) {
    return extractedDir;
  }

  const children = fs
    .readdirSync(extractedDir, { withFileTypes: true })
    .filter((entry) => !isZipMetadataEntry(entry.name));

  const pluginRootCandidates = children.filter((entry) => {
    if (!entry.isDirectory()) {
      return false;
    }

    const nestedDir = path.join(extractedDir, entry.name);
    return fs.existsSync(path.join(nestedDir, MANIFEST_FILE_NAME));
  });

  if (pluginRootCandidates.length !== 1) {
    return extractedDir;
  }

  return path.join(extractedDir, pluginRootCandidates[0].name);
}

function assertPluginIdAvailable(pluginId: string, pluginDir: string): void {
  if (getPluginManifest(pluginId)) {
    throw new Error(`Plugin '${pluginId}' is already installed`);
  }

  if (fs.existsSync(pluginDir)) {
    throw new Error(`Plugin install directory already exists for '${pluginId}'`);
  }
}

function copyDirectoryContents(sourceDir: string, targetDir: string): void {
  fs.mkdirSync(targetDir, { recursive: true });

  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = safeResolve(targetDir, entry.name);
    const stats = fs.lstatSync(sourcePath);

    if (stats.isSymbolicLink()) {
      throw new Error(`Plugin source contains unsupported symlink: ${sourcePath}`);
    }

    if (stats.isDirectory()) {
      copyDirectoryContents(sourcePath, targetPath);
      continue;
    }

    if (!stats.isFile()) {
      throw new Error(`Plugin source contains unsupported file type: ${sourcePath}`);
    }

    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.copyFileSync(sourcePath, targetPath);
  }
}

function createStagingDirectory(prefix: string): string {
  return fs.mkdtempSync(path.join(ensurePluginsDir(), prefix));
}

export function readManifestFromDir(pluginDir: string): PluginManifest {
  const manifestPath = path.join(pluginDir, MANIFEST_FILE_NAME);
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Missing ${MANIFEST_FILE_NAME} in ${pluginDir}`);
  }

  const rawManifest: unknown = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  const manifest = validateManifest(rawManifest, pluginDir);

  if (manifest.apiVersion !== PLUGIN_API_VERSION) {
    throw new Error(
      `Unsupported plugin apiVersion '${manifest.apiVersion}' in ${pluginDir}; expected '${PLUGIN_API_VERSION}'`,
    );
  }

  return manifest;
}

function finalizeInstall(stagedPluginDir: string, pluginsDir: string): PluginInstallResult {
  const manifest = readManifestFromDir(stagedPluginDir);
  const finalPluginDir = safeResolve(pluginsDir, manifest.id);
  let renamed = false;

  try {
    assertPluginIdAvailable(manifest.id, finalPluginDir);
    fs.renameSync(stagedPluginDir, finalPluginDir);
    renamed = true;
    registerInstalledPlugin(manifest, finalPluginDir);
    return { success: true, pluginId: manifest.id };
  } catch (error) {
    cleanupDirectory(renamed ? finalPluginDir : stagedPluginDir);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function installFromZip(zipPath: string): Promise<PluginInstallResult> {
  const pluginsDir = ensurePluginsDir();
  const stagingDir = createStagingDirectory('.plugin-install-zip-');

  try {
    const zip = new AdmZip(zipPath);

    for (const entry of zip.getEntries()) {
      const entryName = normalizeZipEntryName(entry.entryName);

      if (isZipSymlink(entry)) {
        throw new Error(`Zip entry '${entryName}' is a symlink and cannot be installed`);
      }

      const targetPath = safeResolve(stagingDir, entryName);

      if (entry.isDirectory) {
        fs.mkdirSync(targetPath, { recursive: true });
        continue;
      }

      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      fs.writeFileSync(targetPath, entry.getData());
    }

    const pluginDir = resolveExtractedPluginDir(stagingDir);
    const result = finalizeInstall(pluginDir, pluginsDir);

    if (pluginDir !== stagingDir) {
      cleanupDirectory(stagingDir);
    }

    return result;
  } catch (error) {
    cleanupDirectory(stagingDir);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function installFromFolder(folderPath: string): Promise<PluginInstallResult> {
  const sourcePath = path.resolve(folderPath);
  const sourceStats = fs.lstatSync(sourcePath);
  if (!sourceStats.isDirectory()) {
    return { success: false, error: `Plugin source is not a directory: ${sourcePath}` };
  }

  const pluginsDir = ensurePluginsDir();
  const stagingDir = createStagingDirectory('.plugin-install-folder-');

  try {
    const manifest = readManifestFromDir(sourcePath);
    assertPluginIdAvailable(manifest.id, safeResolve(pluginsDir, manifest.id));
    copyDirectoryContents(sourcePath, stagingDir);
    return finalizeInstall(stagingDir, pluginsDir);
  } catch (error) {
    cleanupDirectory(stagingDir);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function installPlugin(sourcePath: string): Promise<PluginInstallResult> {
  try {
    const resolvedSourcePath = path.resolve(sourcePath);
    const sourceStats = fs.lstatSync(resolvedSourcePath);

    if (sourceStats.isDirectory()) {
      return installFromFolder(resolvedSourcePath);
    }

    if (sourceStats.isFile() && path.extname(resolvedSourcePath).toLowerCase() === ZIP_EXTENSION) {
      return installFromZip(resolvedSourcePath);
    }

    return {
      success: false,
      error: `Unsupported plugin source: ${resolvedSourcePath}`,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function installPluginFromPath(sourcePath: string): Promise<PluginInstallResult> {
  return installPlugin(sourcePath);
}

export async function selectAndInstallPlugin(): Promise<PluginInstallResult> {
  const focusedWindow = BrowserWindow.getFocusedWindow();
  const selection = focusedWindow
    ? await dialog.showMessageBox(focusedWindow, {
      type: 'question',
      title: 'Install Plugin',
      message: 'Choose a plugin source',
      buttons: ['Cancel', 'Folder', 'ZIP File'],
      defaultId: 2,
      cancelId: 0,
    })
    : await dialog.showMessageBox({
      type: 'question',
      title: 'Install Plugin',
      message: 'Choose a plugin source',
      buttons: ['Cancel', 'Folder', 'ZIP File'],
      defaultId: 2,
      cancelId: 0,
    });

  if (selection.response === 0) {
    return { success: false, error: 'Plugin selection cancelled' };
  }

  const dialogOptions: OpenDialogOptions = selection.response === 1
    ? {
      properties: ['openDirectory'],
    }
    : {
      properties: ['openFile'],
      filters: [{ name: 'Plugin ZIP Files', extensions: ['zip'] }],
    };

  const result = focusedWindow
    ? await dialog.showOpenDialog(focusedWindow, dialogOptions)
    : await dialog.showOpenDialog(dialogOptions);

  if (result.canceled || result.filePaths.length === 0) {
    return { success: false, error: 'Plugin selection cancelled' };
  }

  return installPlugin(result.filePaths[0]);
}

export async function uninstallPlugin(pluginId: string): Promise<boolean> {
  const pluginsDir = ensurePluginsDir();

  let normalizedPluginId: string;
  try {
    normalizedPluginId = normalizePluginId(pluginId, pluginsDir);
  } catch {
    return false;
  }

  let pluginDir: string;
  try {
    pluginDir = safeResolve(pluginsDir, normalizedPluginId);
  } catch {
    return false;
  }

  const resolvedPluginsDir = path.resolve(pluginsDir);
  const resolvedPluginDir = path.resolve(pluginDir);
  if (resolvedPluginDir === resolvedPluginsDir || !resolvedPluginDir.startsWith(`${resolvedPluginsDir}${path.sep}`)) {
    return false;
  }

  if (!fs.existsSync(pluginDir)) {
    return false;
  }

  const stats = fs.lstatSync(pluginDir);
  if (!stats.isDirectory()) {
    return false;
  }

  fs.rmSync(pluginDir, { recursive: true, force: false });
  return true;
}
