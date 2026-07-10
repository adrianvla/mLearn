/**
 * Platform detection utilities
 */

import path from 'path';
import { app } from 'electron';

// Platform detection
export const PLATFORM = process.platform;
export const ARCHITECTURE = process.arch;

export const isMac = PLATFORM === 'darwin';
export const isWindows = PLATFORM === 'win32';
export const isLinux = PLATFORM === 'linux';

// Packaged vs development detection
export const isPackaged = app.isPackaged;

// Resource paths
export function getResourcePath(): string {
  if (isPackaged) {
    return process.resourcesPath;
  }
  return path.join(__dirname, '..', '..');
}

export function getAppPath(): string {
  if (isPackaged) {
    return path.join(process.resourcesPath, 'app.asar');
  }
  return path.join(__dirname, '..', '..');
}

export function getExtensionDistDir(): string {
  if (isPackaged) {
    return path.join(getResourcePath(), 'extension', 'dist');
  }
  return path.join(__dirname, '..', '..', '..', 'extension', 'dist');
}

export function getBundledDistElectronPath(...segments: string[]): string {
  if (isPackaged) {
    return path.join(getAppPath(), 'dist-electron', ...segments);
  }

  return path.join(getResourcePath(), ...segments);
}

export function getUserDataPath(): string {
  return app.getPath('userData');
}

// Python executable paths
export function getPythonExecutablePath(): string {
  const resPath = getResourcePath();
  if (isWindows) {
    return path.join(resPath, 'env', 'python.exe');
  }
  return path.join(resPath, 'env', 'bin', 'python3');
}

export function getPipExecutablePath(): string {
  const resPath = getResourcePath();
  if (isWindows) {
    return path.join(resPath, 'env', 'python.exe');
  }
  return path.join(resPath, 'env', 'bin', 'pip3');
}

// Runtime target key for the Python runtime catalog (platform-arch).
export function getRuntimeTarget(): string {
  if (PLATFORM === 'darwin' && ARCHITECTURE === 'x64') return 'darwin-x64';
  if (PLATFORM === 'darwin' && ARCHITECTURE === 'arm64') return 'darwin-arm64';
  if (PLATFORM === 'linux' && ARCHITECTURE === 'x64') return 'linux-x64';
  // Windows (all architectures fallback to x64)
  if (isWindows) return 'win32-x64';

  throw new Error(`Unsupported platform: ${PLATFORM} ${ARCHITECTURE}`);
}
