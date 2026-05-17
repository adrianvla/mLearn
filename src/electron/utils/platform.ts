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

// Python download URL based on platform
export function getPythonDownloadUrl(baseUrl: string): string {
  if (PLATFORM === 'darwin' && ARCHITECTURE === 'x64') {
    return `${baseUrl}x86_64-apple-darwin-install_only.tar.gz?download=`;
  }
  if (PLATFORM === 'darwin' && ARCHITECTURE === 'arm64') {
    return `${baseUrl}aarch64-apple-darwin-install_only.tar.gz?download=`;
  }
  if (PLATFORM === 'linux' && ARCHITECTURE === 'x64') {
    return `${baseUrl}x86_64-unknown-linux-gnu-install_only.tar.gz?download=`;
  }
  // Windows (all architectures fallback to x64)
  if (isWindows) {
    return `${baseUrl}x86_64-pc-windows-msvc-install_only.tar.gz?download=`;
  }
  
  throw new Error(`Unsupported platform: ${PLATFORM} ${ARCHITECTURE}`);
}
