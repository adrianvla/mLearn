/**
 * Python Backend Service
 * Handles downloading, installing, and managing the Python backend
 */

import fs from 'fs';
import path from 'path';
import https from 'https';
import http from 'http';
import crypto from 'crypto';
import { spawn, exec, execSync, ChildProcess } from 'child_process';
import { ipcMain, app, BrowserWindow } from 'electron';
import * as tar from 'tar';
import { IPC_CHANNELS, PYTHON_BACKEND_PORT, DEFAULT_RUNTIME_CATALOG_URL, LOG_PATTERN_PREFIX, LOG_PATTERN_VERSION } from '../../shared/constants';
import type { ComponentsUninstallResult, InstallOptions, InstallStartedPayload, InstallerState, PipRequirementsConfig, PipProgress, PythonComponentId, PythonComponentInfo, RuntimeCatalog, RuntimeCatalogEntry } from '../../shared/types';
import { DEFAULT_SETTINGS } from '../../shared/types';
import {
  getResourcePath,
  getAppPath,
  getBundledDistElectronPath,
  getUserDataPath,
  getPythonExecutablePath,
  getPipExecutablePath,
  getRuntimeTarget,
  isWindows
} from '../utils/platform';
import { hasSettingsFile, loadLangData, loadSettings } from './settings';
import { getLanguageDataRoot } from './languageDataService';
import { getCurrentWindow, getMainWindow } from './windowManager';
import { getLogger, type LogLevel } from '../../shared/utils/logger';
import { getLanguagePythonRequirementsForInstall } from '../../shared/languageFeatures';
import { getPythonExecutableCandidates } from './pythonRuntimePaths';
import { ensureLanguagePythonRequirementsInstalled } from './pythonRuntimeRequirements';
import { probeMirrorCatalog } from './catalogMirrors';
import { downloadFileWithProgress, isNetworkError } from '../utils/downloadManager';

const pyLog = getLogger('python');
const lifecycleLog = getLogger('python.lifecycle');
const log = getLogger('electron.pythonBackend');

const POSIX_SIGNAL_DESCRIPTIONS: Readonly<Record<string, string>> = {
  SIGTERM: 'terminated',
  SIGINT: 'interrupted',
  SIGKILL: 'force-killed (out of memory or external kill)',
  SIGSEGV: 'segmentation fault (native crash)',
  SIGBUS: 'bus error (memory alignment / mmap failure)',
  SIGABRT: 'aborted (assertion or fatal error)',
  SIGFPE: 'floating-point exception',
  SIGILL: 'illegal instruction',
  SIGHUP: 'hangup',
  SIGPIPE: 'broken pipe',
};

function describeExitReason(code: number | null, signal: NodeJS.Signals | null): string {
  if (signal) {
    const desc = POSIX_SIGNAL_DESCRIPTIONS[signal];
    return desc ? `${signal} (${desc})` : signal;
  }
  if (code === null) return 'unknown';
  if (code === 0) return 'exit 0 (clean)';
  if (code === 1) return 'exit 1 (uncaught Python exception)';
  if (code === 2) return 'exit 2 (argument or import error)';
  if (code > 128) {
    const sigNum = code - 128;
    return `exit ${code} (signal ${sigNum})`;
  }
  return `exit ${code}`;
}

function readLogTail(filePath: string, maxBytes: number): string {
  try {
    const stat = fs.statSync(filePath);
    const start = Math.max(0, stat.size - maxBytes);
    const fd = fs.openSync(filePath, 'r');
    try {
      const buf = Buffer.alloc(stat.size - start);
      fs.readSync(fd, buf, 0, buf.length, start);
      return buf.toString('utf8');
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return '';
  }
}

function buildCrashSummary(
  code: number | null,
  signal: NodeJS.Signals | null,
  recentTail: readonly string[],
): string {
  const reason = describeExitReason(code, signal);
  const sections: string[] = [
    `The Python backend stopped unexpectedly: ${reason}.`,
  ];

  const userData = getUserDataPath();
  const crashPath = path.join(userData, 'logs', 'python_crash.log');
  const pythonLogPath = path.join(userData, 'logs', 'python.log');

  const crashTail = readLogTail(crashPath, 4096).trim();
  if (crashTail) {
    sections.push(`--- python_crash.log (tail) ---\n${crashTail}`);
  }

  if (recentTail.length > 0) {
    sections.push(`--- recent stdout (last ${recentTail.length}) ---\n${recentTail.join('\n')}`);
  } else {
    const pythonTail = readLogTail(pythonLogPath, 2048).trim();
    if (pythonTail) {
      sections.push(`--- python.log (tail) ---\n${pythonTail}`);
    }
  }

  sections.push(`Logs: ${path.join(userData, 'logs')}`);
  return sections.join('\n\n');
}

// State
let pythonChildProcess: ChildProcess | null = null;
let pythonSuccessInstall = false;
let isFirstTimeSetup = false;
let serverLoaded = false;
let installInProgress = false;
let waitingForInstallChoice = false;
let pendingInstallOptions: InstallOptions = { includeLLM: true, includeOCR: true, includeVoice: true };
let serverLoadCheckInterval: NodeJS.Timeout | null = null;

let quitToken: string | null = null;
const quitTokenListeners = new Set<(token: string) => void>();

// Buffered error state so the renderer can retrieve it even if it mounts
// after the Python process exits.
let pendingCriticalError: string | null = null;
let pendingStartupStatusMessage: string | null = null;
let activePipProcess: ChildProcess | null = null;
// Set by the CANCEL_INSTALL handler so the pip close handler can tell a
// user-initiated abort (null exit code) from an unexpected kill.
let installAborted = false;
let selectedPythonExecutablePath: string | null = null;
const plannedBackendShutdowns = new WeakSet<ChildProcess>();
let backendRestartAfterExit: ChildProcess | null = null;

// Apple Silicon detection (local to avoid cross-service coupling)
const isAppleSilicon = process.platform === 'darwin' && process.arch === 'arm64';

const PACKAGE_SIZE_ESTIMATES_BYTES: Readonly<Record<string, number>> = {
  core: 500 * 1024 * 1024,
  ocr: 3000 * 1024 * 1024,
  llm: 5000 * 1024 * 1024,
  voice: 4000 * 1024 * 1024,
  python: 150 * 1024 * 1024,
};


// Windows voice installs pin CUDA torch wheels (+cu128), roughly 3 GB beyond
// the base voice estimate.
const WIN32_VOICE_CUDA_EXTRA_BYTES = 3000 * 1024 * 1024;

// PyPI ships CPU-only torch wheels on Windows; CUDA builds come from the
// pytorch cu128 index, injected per group at pip invocation time. CPU builds
// for Linux (where PyPI torch bundles CUDA) come from the cpu index.
const CUDA_EXTRA_INDEX_URL = 'https://download.pytorch.org/whl/cu128';
const CPU_EXTRA_INDEX_URL = 'https://download.pytorch.org/whl/cpu';

// NVIDIA GPUs are the only hardware the CUDA wheel groups accelerate. The
// driver ships nvidia-smi, so its presence is the cheapest reliable probe.
let nvidiaGpuProbe: Promise<boolean> | null = null;
export function hasNvidiaGpu(): Promise<boolean> {
  if (!nvidiaGpuProbe) {
    nvidiaGpuProbe = new Promise<boolean>((resolve) => {
      if (!(isWindows || process.platform === 'linux')) {
        resolve(false);
        return;
      }
      let sawNvidia = false;
      const probe = spawn('nvidia-smi', ['-L'], { windowsHide: true });
      probe.stdout.on('data', (chunk) => {
        if (String(chunk).includes('NVIDIA')) sawNvidia = true;
      });
      probe.on('error', () => resolve(false));
      probe.on('close', () => resolve(sawNvidia));
    });
  }
  return nvidiaGpuProbe;
}

type InstallerPlatform = 'darwin-arm64' | 'darwin-x64' | 'win32-x64' | 'linux-x64';

// Stable machine keys surfaced to the renderer via the INSTALL_STARTED payload.
const PLATFORM_WARNINGS: Readonly<Record<InstallerPlatform, readonly string[]>> = {
  'darwin-arm64': [],
  'darwin-x64': ['intel-no-onboard-ai'],
  'win32-x64': ['windows-cuda-recommended'],
  'linux-x64': [],
};

function getInstallerPlatform(): InstallerPlatform {
  if (isWindows) return 'win32-x64';
  if (isAppleSilicon) return 'darwin-arm64';
  if (process.platform === 'darwin') return 'darwin-x64';
  return 'linux-x64';
}


/**
 * Options after platform degradation. Intel Macs have no onboard AI stack, so
 * every AI component is stripped: only core app packages and the language
 * "core" component (tokenizer) packages install.
 */
function resolveEffectiveInstallOptions(
  options: InstallOptions,
  platform: InstallerPlatform = getInstallerPlatform(),
): InstallOptions {
  if (platform === 'darwin-x64') {
    return { includeLLM: false, includeOCR: false, includeVoice: false };
  }
  return options;
}

// Paths
const resPath = getResourcePath();
const userDataPath = getUserDataPath();
const downloadPath = path.join(userDataPath, 'python.tar.gz');
const extractPath = path.join(userDataPath, 'py');
const envPath = path.join(userDataPath, 'env');
const pythonVersionPath = path.join(userDataPath, 'python-version.txt');
const runtimeReceiptPath = path.join(userDataPath, 'python-install-receipt.json');

interface RuntimeInstallReceipt {
  sha256: string;
  version: string;
  installedAt: string;
}

function readRuntimeReceipt(): RuntimeInstallReceipt | null {
  try {
    if (fs.existsSync(runtimeReceiptPath)) {
      return JSON.parse(fs.readFileSync(runtimeReceiptPath, 'utf-8'));
    }
  } catch (e) {
    log.warn('Failed to read runtime install receipt:', e);
  }
  return null;
}

function writeRuntimeReceipt(entry: RuntimeCatalogEntry, version: string): void {
  try {
    const receipt: RuntimeInstallReceipt = {
      sha256: entry.sha256,
      version,
      installedAt: new Date().toISOString(),
    };
    fs.writeFileSync(runtimeReceiptPath, JSON.stringify(receipt, null, 2), 'utf-8');
  } catch (e) {
    log.warn('Failed to write runtime install receipt:', e);
  }
}

/**
 * Fetch the runtime catalog JSON from the CDN.
 * Small file (~1KB), cached on Pages for 5min.
 */
function fetchRuntimeCatalog(catalogUrl: string): Promise<RuntimeCatalog> {
  return new Promise((resolve, reject) => {
    const doRequest = (reqUrl: string, redirectCount = 0) => {
      if (redirectCount > 5) {
        reject(new Error('Too many redirects fetching runtime catalog'));
        return;
      }
      const protocol = reqUrl.startsWith('https') ? https : http;
      protocol.get(reqUrl, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          doRequest(res.headers.location, redirectCount + 1);
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`HTTP ${res.statusCode} fetching runtime catalog`));
          return;
        }
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8')));
          } catch (e) {
            reject(new Error(`Failed to parse runtime catalog: ${e}`));
          }
        });
        res.on('error', reject);
      }).on('error', reject);
    };
    doRequest(catalogUrl);
  });
}

function sleep(ms: number): Promise<void> {
  let wake: () => void = () => {};
  const promise = new Promise<void>((resolve) => { wake = resolve; });
  setTimeout(wake, ms);
  return promise;
}

const RUNTIME_CATALOG_ATTEMPTS = 3;
const RUNTIME_CATALOG_RETRY_BACKOFF_MS = 400;

/** Retry the catalog fetch twice with a short backoff before mirror probing. */
async function fetchRuntimeCatalogWithRetry(catalogUrl: string): Promise<RuntimeCatalog> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= RUNTIME_CATALOG_ATTEMPTS; attempt++) {
    try {
      return await fetchRuntimeCatalog(catalogUrl);
    } catch (e) {
      lastError = e;
      if (attempt < RUNTIME_CATALOG_ATTEMPTS) {
        await sleep(RUNTIME_CATALOG_RETRY_BACKOFF_MS * attempt);
      }
    }
  }
  throw lastError;
}

function computeSha256(filePath: string): string {
  const hash = crypto.createHash('sha256');
  const data = fs.readFileSync(filePath);
  hash.update(data);
  return hash.digest('hex');
}

function getUserDataPythonExecutablePath(): string {
  return isWindows
    ? path.join(envPath, 'python.exe')
    : path.join(envPath, 'bin', 'python3');
}

function getInstalledPythonVersion(): string | null {
  try {
    if (fs.existsSync(pythonVersionPath)) {
      return fs.readFileSync(pythonVersionPath, 'utf-8').trim();
    }
  } catch (e) {
    lifecycleLog.warn('Failed to read installed Python version:', e);
  }
  return null;
}

function setInstalledPythonVersion(version: string): void {
  try {
    fs.writeFileSync(pythonVersionPath, version, 'utf-8');
  } catch (e) {
    lifecycleLog.warn('Failed to write installed Python version:', e);
  }
}

function resolveResourceFilePath(...segments: string[]): string {
  const appPath = getAppPath();
  const candidatePaths = [
    path.join(resPath, 'root-of-app', ...segments),
    path.join(resPath, ...segments),
    path.join(appPath, ...segments),
    getBundledDistElectronPath(...segments),
    path.join(resPath, '..', 'src', 'root-of-app', ...segments),
  ];
  for (const candidate of candidatePaths) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return candidatePaths[0];
}

export function readResourceFile(...segments: string[]): string {
  const candidatePaths = [
    resolveResourceFilePath(...segments),
    getBundledDistElectronPath(...segments),
    path.join(resPath, 'root-of-app', ...segments),
    path.join(resPath, ...segments),
    path.join(resPath, '..', 'src', 'root-of-app', ...segments),
  ];

  for (const candidatePath of candidatePaths) {
    try {
      return fs.readFileSync(candidatePath, 'utf-8');
    } catch {
      // Try the next packaged/development fallback.
    }
  }

  return fs.readFileSync(candidatePaths[0], 'utf-8');
}

function resolveExternalResourceFilePath(...segments: string[]): string {
  const developmentCandidatePaths = app.isPackaged ? [] : [
    path.join(resPath, '..', 'src', 'root-of-app', ...segments),
  ];
  const candidatePaths = [
    ...developmentCandidatePaths,
    path.join(resPath, 'root-of-app', ...segments),
    path.join(resPath, ...segments),
    path.join(resPath, '..', 'src', 'root-of-app', ...segments),
  ];

  for (const candidatePath of candidatePaths) {
    if (fs.existsSync(candidatePath)) {
      return candidatePath;
    }
  }

  return candidatePaths[0];
}

function resolvePythonExecutablePath(): string {
  if (selectedPythonExecutablePath && fs.existsSync(selectedPythonExecutablePath)) {
    return selectedPythonExecutablePath;
  }
  if (isWindows) {
    const userDataExe = getUserDataPythonExecutablePath();
    if (fs.existsSync(userDataExe)) return userDataExe;
  } else {
    const userDataPy = getUserDataPythonExecutablePath();
    if (fs.existsSync(userDataPy)) return userDataPy;
  }
  return getPythonExecutablePath();
}

function resolvePipExecutablePath(): string {
  if (isWindows) {
    const userDataExe = path.join(userDataPath, 'env', 'python.exe');
    if (fs.existsSync(userDataExe)) return userDataExe;
  } else {
    const userDataPip = path.join(userDataPath, 'env', 'bin', 'pip3');
    if (fs.existsSync(userDataPip)) return userDataPip;
  }
  return getPipExecutablePath();
}

// Getters
export function isServerLoaded(): boolean {
  return serverLoaded;
}

export function getPythonProcess(): ChildProcess | null {
  return pythonChildProcess;
}

export function getQuitToken(): string | null {
  return quitToken;
}

export function onQuitTokenAvailable(callback: (token: string) => void): () => void {
  if (quitToken) {
    queueMicrotask(() => callback(quitToken!));
    return () => {};
  }

  quitTokenListeners.add(callback);
  return () => {
    quitTokenListeners.delete(callback);
  };
}

function notifyQuitTokenAvailable(token: string): void {
  for (const listener of Array.from(quitTokenListeners)) {
    quitTokenListeners.delete(listener);
    listener(token);
  }
}

function broadcastBackendToken(token: string | null): void {
  try {
    for (const win of BrowserWindow.getAllWindows()) {
      const w = win as { isDestroyed?: () => boolean; webContents: { send: (channel: string, ...args: unknown[]) => void } };
      if (w.isDestroyed && w.isDestroyed()) continue;
      w.webContents.send(IPC_CHANNELS.BACKEND_TOKEN_CHANGED, token);
    }
  } catch (e) {
    log.error('Failed to broadcast backend token:', e);
  }
}

/** Broadcast an IPC event to all open windows (install events need to reach
 *  every window, not just the main window, so the install progress modal
 *  is visible everywhere). */
function broadcastInstallEvent(channel: string, ...args: unknown[]): void {
  try {
    for (const win of BrowserWindow.getAllWindows()) {
      const w = win as { isDestroyed?: () => boolean; webContents: { send: (channel: string, ...args: unknown[]) => void } };
      if (w.isDestroyed && w.isDestroyed()) continue;
      w.webContents.send(channel, ...args);
    }
  } catch (e) {
    log.error('Failed to broadcast install event:', e);
  }
}

// Send status update — broadcasts to all windows during installs, targets the
// current window for regular runtime status after the backend is loaded.
function sendStatusUpdate(message: string): void {
  try {
    broadcastInstallEvent(IPC_CHANNELS.SERVER_STATUS_UPDATE, message);
  } catch (e) {
    log.error('Failed to send status update:', e);
  }
}

// Send pip progress update to all windows
function sendPipProgress(progress: PipProgress): void {
  try {
    broadcastInstallEvent(IPC_CHANNELS.PIP_PROGRESS, progress);
  } catch (e) {
    log.error('Failed to send pip progress:', e);
  }
}

// Strip ANSI escape codes from text
// eslint-disable-next-line no-control-regex
const ANSI_REGEX = /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><~]/g;

function stripAnsi(text: string): string {
  return text.replace(ANSI_REGEX, '');
}

function bufferStartupStatusMessage(message: string): void {
  if (message.includes('Loaded from cache')) {
    pendingStartupStatusMessage = message;
  }
}

/**
 * Parse pip output lines to extract meaningful progress info.
 * pip outputs lines like:
 *   "Collecting networkx"
 *   "  Downloading networkx-3.1-py3-none-any.whl (2.1 MB)"
 *   "Requirement already satisfied: numpy in ./env/lib/..."
 *   "Installing collected packages: networkx, numpy, ..."
 *   "Successfully installed networkx-3.1 numpy-1.24.3 ..."
 */
function parsePipLine(line: string, seenPackages: Set<string>): PipProgress | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  // Use actual seen count as total — pip resolves transitive dependencies
  // so explicit package count is always an undercount
  const currentTotal = seenPackages.size;

  // "Collecting <package>"
  const collectingMatch = trimmed.match(/^Collecting\s+(\S+)/i);
  if (collectingMatch) {
    const pkgName = collectingMatch[1].replace(/[>=<!].*$/, '');
    seenPackages.add(pkgName.toLowerCase());
    return {
      packageName: pkgName,
      current: seenPackages.size,
      total: seenPackages.size,
      action: 'collecting',
    };
  }

  // "Downloading <package-file>"
  const downloadingMatch = trimmed.match(/^Downloading\s+(\S+)/i);
  if (downloadingMatch) {
    const fileName = downloadingMatch[1].split('/').pop() || downloadingMatch[1];
    // Extract package name from wheel/tarball filename (e.g., "networkx-3.1-py3-none-any.whl")
    const pkgName = fileName.replace(/[-_]\d+.*$/, '').replace(/[-_]/, '-');
    return {
      packageName: pkgName || fileName,
      current: seenPackages.size,
      total: currentTotal,
      action: 'downloading',
    };
  }

  // "Requirement already satisfied: <package>"
  const satisfiedMatch = trimmed.match(/^Requirement already satisfied:\s+(\S+)/i);
  if (satisfiedMatch) {
    const pkgName = satisfiedMatch[1].replace(/[>=<!].*$/, '');
    seenPackages.add(pkgName.toLowerCase());
    return {
      packageName: pkgName,
      current: seenPackages.size,
      total: seenPackages.size,
      action: 'satisfied',
    };
  }

  // "Installing collected packages: pkg1, pkg2, ..."
  if (trimmed.match(/^Installing collected packages:/i)) {
    return {
      packageName: '',
      current: currentTotal,
      total: currentTotal,
      action: 'installing',
    };
  }

  // "Successfully installed pkg1-ver pkg2-ver ..."
  if (trimmed.match(/^Successfully installed/i)) {
    return {
      packageName: '',
      current: currentTotal,
      total: currentTotal,
      action: 'complete',
    };
  }

  return null;
}

// Handle installer failure
function handleInstallerFailure(message: string, options?: { detail?: string; emitNetworkError?: boolean }): void {
  installInProgress = false;
  pythonSuccessInstall = false;
  waitingForInstallChoice = true;

  sendStatusUpdate(`ERROR: ${message}`);
  if (options?.detail) {
    sendStatusUpdate(options.detail);
  }

  if (options?.emitNetworkError) {
    try {
      broadcastInstallEvent(IPC_CHANNELS.INSTALLER_NETWORK_ERROR, {
        message,
        detail: options.detail || null,
      });
    } catch (e) {
      log.error("error", e);
    }
  }

  try {
    broadcastInstallEvent(IPC_CHANNELS.INSTALLER_AWAITING_CHOICE);
  } catch (e) {
    log.error("error", e);
  }
}

// Load pip requirements config. Groups introduced for Windows/Linux CUDA
// support may be absent from older bundled pip_requirements.json copies, so
// any missing key falls back to the built-in defaults below.
const FALLBACK_PIP_REQUIREMENTS: PipRequirementsConfig = {
  core: [
    'pip',
    'uvicorn==0.41.0',
    'fastapi==0.129.2',
    'pydantic==2.12.5',
    'beautifulsoup4==4.14.3',
    'pillow==12.1.1',
    'numpy==2.4.2',
    'python-multipart==0.0.22',
    'setuptools',
    'wheel',
  ],
  ocr: [],
  llm: ['torch==2.10.0', 'transformers==5.12.1', 'sentencepiece==0.2.1'],
  'llm-windows': ['torch==2.10.0+cu128', 'transformers==4.57.3', 'sentencepiece==0.2.1'],
  'llm-linux': ['torch==2.10.0', 'transformers==4.57.3', 'sentencepiece==0.2.1'],
  voice: ['torch==2.10.0', 'torchaudio==2.10.0', 'faster_whisper==1.2.1', 'kokoro==0.9.4', 'soundfile==0.13.1', 'silero-vad', 'onnxruntime==1.24.2'],
  'voice-windows': ['torch==2.10.0+cu128', 'torchaudio==2.10.0+cu128', 'faster_whisper==1.2.1', 'kokoro==0.9.4', 'soundfile==0.13.1', 'silero-vad', 'onnxruntime==1.24.2', 'nvidia-cudnn-cu12==9.25.1.1', 'nvidia-cublas-cu12==12.8.5.5'],
  'qwen3-tts': ['mlx==0.31.1', 'mlx-metal==0.31.1', 'mlx-lm==0.31.2', 'mlx-audio==0.4.4', 'transformers==5.12.1', 'tokenizers==0.22.1', 'huggingface-hub==1.21.0', 'soundfile==0.13.1'],
  // qwen-tts==0.1.1 requires transformers==4.57.3 / accelerate==1.12.0 exactly
  // and huggingface-hub>=0.34,<1.0 — no hub pin here, transformers resolves it.
  // librosa==0.11.0 ships a py3-none-any wheel (Requires-Python >=3.8); avoid
  // 1.x, which needs Python >=3.12.
  'qwen3-tts-torch': ['qwen-tts==0.1.1', 'transformers==4.57.3', 'accelerate==1.12.0', 'librosa==0.11.0', 'tokenizers==0.22.1'],
  'mlx-stt': ['sentencepiece==0.2.1'],
  // CPU-wheel variants for machines without an NVIDIA GPU. Windows PyPI torch
  // is already CPU-only; Linux needs +cpu local versions from the cpu index.
  'llm-windows-cpu': ['torch==2.10.0', 'transformers==4.57.3', 'sentencepiece==0.2.1'],
  'voice-windows-cpu': ['torch==2.10.0', 'torchaudio==2.10.0', 'faster_whisper==1.2.1', 'kokoro==0.9.4', 'soundfile==0.13.1', 'silero-vad', 'onnxruntime==1.24.2'],
  'llm-linux-cpu': ['torch==2.10.0+cpu', 'transformers==4.57.3', 'sentencepiece==0.2.1'],
  'voice-linux-cpu': ['torch==2.10.0+cpu', 'torchaudio==2.10.0+cpu', 'faster_whisper==1.2.1', 'kokoro==0.9.4', 'soundfile==0.13.1', 'silero-vad', 'onnxruntime==1.24.2'],
};

function loadPipRequirementsConfig(): PipRequirementsConfig {
  let config: PipRequirementsConfig;
  try {
    config = JSON.parse(readResourceFile('pip_requirements.json'));
  } catch (e) {
    log.error('Failed to load pip requirements config:', e);
    config = { ...FALLBACK_PIP_REQUIREMENTS };
  }
  for (const group of Object.keys(FALLBACK_PIP_REQUIREMENTS) as (keyof PipRequirementsConfig)[]) {
    const fallback = FALLBACK_PIP_REQUIREMENTS[group];
    if (!config[group] && fallback) config[group] = fallback;
  }
  return config;
}

/** One pip invocation: a named package group with an optional extra wheel index. */
export interface PipInstallGroup {
  name: string;
  packages: string[];
  extraIndexUrl?: string;
}

/**
 * Platform component matrix (GPU = NVIDIA present, probed via nvidia-smi):
 * - darwin-arm64:        core + [ocr] + [llm] + [voice + qwen3-tts + mlx-stt]
 * - linux-x64 (GPU):     core + [ocr] + [llm-linux] + [voice + qwen3-tts-torch]
 * - linux-x64 (no GPU):  core + [ocr] + [llm-linux-cpu] + [voice-linux-cpu + qwen3-tts-torch]
 * - win32-x64 (GPU):     core + [ocr] + [llm-windows + voice-windows + qwen3-tts-torch];
 *                        the CUDA-bearing groups install from the pytorch cu128 index
 * - win32-x64 (no GPU):  core + [ocr] + [llm-windows-cpu + voice-windows-cpu + qwen3-tts-torch]
 * - darwin-x64:          core only — AI groups are stripped, but language "core"
 *                        component (tokenizer) packages still install
 * llm-windows/llm-linux pin transformers 4.57.3 to stay compatible with the
 * qwen-tts engine installed by qwen3-tts-torch in the same env; the Apple mlx
 * stack keeps its own transformers line.
 * The installed language component packages ride as a final optional group so
 * one bad language package cannot block the backend from starting.
 */
export function buildPipInstallGroups(
  options: InstallOptions,
  config: PipRequirementsConfig = loadPipRequirementsConfig(),
  platform: InstallerPlatform = getInstallerPlatform(),
  gpu: boolean = true,
): PipInstallGroup[] {
  const selected = resolveEffectiveInstallOptions(options, platform);
  const groups: PipInstallGroup[] = [{ name: 'core', packages: [...config.core] }];

  if (selected.includeOCR && config.ocr.length > 0) {
    groups.push({ name: 'ocr', packages: [...config.ocr] });
  }
  if (selected.includeLLM) {
    if (platform === 'win32-x64') {
      // Explicit +cu128 pins: bare torch pins from PyPI are CPU-only on Windows,
      // so GPU selection must not rely on cross-index local-version preference.
      // Without an NVIDIA GPU the CPU group installs plain PyPI wheels.
      const llmWinKey = gpu ? 'llm-windows' : 'llm-windows-cpu';
      if (config[llmWinKey]?.length) {
        groups.push({ name: llmWinKey, packages: [...config[llmWinKey]], extraIndexUrl: gpu ? CUDA_EXTRA_INDEX_URL : undefined });
      }
    } else if (platform === 'linux-x64') {
      // Linux LLM shares the env with qwen3-tts-torch, so transformers stays
      // on the qwen-tts-compatible 4.57.3 line. PyPI torch is CUDA-capable;
      // CPU machines need +cpu local versions from the cpu index.
      const llmLinuxKey = gpu ? 'llm-linux' : 'llm-linux-cpu';
      if (config[llmLinuxKey]?.length) {
        groups.push({ name: llmLinuxKey, packages: [...config[llmLinuxKey]], extraIndexUrl: gpu ? undefined : CPU_EXTRA_INDEX_URL });
      }
    } else if (config.llm.length > 0) {
      groups.push({ name: 'llm', packages: [...config.llm] });
    }
  }
  if (selected.includeVoice) {
    if (platform === 'win32-x64') {
      const voiceWinKey = gpu ? 'voice-windows' : 'voice-windows-cpu';
      if (config[voiceWinKey]?.length) {
        groups.push({ name: voiceWinKey, packages: [...config[voiceWinKey]], extraIndexUrl: gpu ? CUDA_EXTRA_INDEX_URL : undefined });
      }
      if (config['qwen3-tts-torch']?.length) {
        groups.push({ name: 'qwen3-tts-torch', packages: [...config['qwen3-tts-torch']], extraIndexUrl: gpu ? CUDA_EXTRA_INDEX_URL : undefined });
      }
    } else {
      if (platform === 'linux-x64') {
        const voiceLinuxKey = gpu ? 'voice' : 'voice-linux-cpu';
        if (config[voiceLinuxKey]?.length) {
          groups.push({ name: voiceLinuxKey, packages: [...config[voiceLinuxKey]], extraIndexUrl: gpu ? undefined : CPU_EXTRA_INDEX_URL });
        }
        if (config['qwen3-tts-torch']?.length) {
          groups.push({ name: 'qwen3-tts-torch', packages: [...config['qwen3-tts-torch']], extraIndexUrl: gpu ? undefined : CPU_EXTRA_INDEX_URL });
        }
      } else {
        if (config.voice?.length) {
          groups.push({ name: 'voice', packages: [...config.voice] });
        }
        if (platform === 'darwin-arm64') {
          if (config['qwen3-tts']?.length) {
            groups.push({ name: 'qwen3-tts', packages: [...config['qwen3-tts']] });
          }
          if (config['mlx-stt']?.length) {
            groups.push({ name: 'mlx-stt', packages: [...config['mlx-stt']] });
          }
        }
      }
    }
  }

  const languagePackages = getLanguagePythonRequirementsForInstall(loadLangData(), selected);
  if (languagePackages.length > 0) {
    groups.push({ name: 'language', packages: languagePackages });
  }

  return groups.filter((group) => group.packages.length > 0);
}

/**
 * Flat package list across all platform groups — used for logging and tests.
 * The install flows spawn one pip per group instead (see installPipGroups).
 */
export function buildPipRequirementList(
  options: InstallOptions,
  config: PipRequirementsConfig = loadPipRequirementsConfig(),
  platform: InstallerPlatform = getInstallerPlatform(),
): string[] {
  return buildPipInstallGroups(options, config, platform).flatMap((group) => group.packages);
}

function estimateRequiredBytes(options: InstallOptions): number {
  const platform = getInstallerPlatform();
  const selected = resolveEffectiveInstallOptions(options, platform);
  let total = PACKAGE_SIZE_ESTIMATES_BYTES.python + PACKAGE_SIZE_ESTIMATES_BYTES.core;
  if (selected.includeOCR) total += PACKAGE_SIZE_ESTIMATES_BYTES.ocr;
  if (selected.includeLLM) total += PACKAGE_SIZE_ESTIMATES_BYTES.llm;
  if (selected.includeVoice) {
    total += PACKAGE_SIZE_ESTIMATES_BYTES.voice;
    if (platform === 'win32-x64') total += WIN32_VOICE_CUDA_EXTRA_BYTES;
  }
  return total;
}

// --- Per-group pip installation ---

const PIP_HEARTBEAT_INTERVAL_MS = 5000;

// pip output fragments that indicate a network outage rather than a package
// problem. Word boundaries keep package names like "networkx" untagged.
const PIP_NETWORK_ERROR_PATTERN = /\b(timed out|timeout|connection|temporary failure|network|ssl ?error)\b/i;

type PipGroupResult = { status: 'ok' } | { status: 'failed'; message: string } | { status: 'aborted' };

interface InstallPipGroupsCallbacks {
  onStatus: (message: string) => void;
  onPipProgress?: (progress: PipProgress) => void;
}

function buildPipInstallArgs(group: PipInstallGroup): string[] {
  const args = isWindows ? ['-m', 'pip', 'install'] : ['install'];
  if (group.extraIndexUrl) args.push('--extra-index-url', group.extraIndexUrl);
  args.push(...group.packages);
  return args;
}

/**
 * Run one pip spawn for a single package group. While pip has not yet produced
 * its first Collecting/Downloading/already-satisfied line, a heartbeat status
 * line is emitted every ~5s so the installer never looks hung during
 * dependency resolution.
 */
function installPipGroup(
  group: PipInstallGroup,
  callbacks: InstallPipGroupsCallbacks,
  seenPackages: Set<string>,
): Promise<PipGroupResult> {
  let resolveGroupResult: (result: PipGroupResult) => void = () => {};
  const promise = new Promise<PipGroupResult>((resolve) => { resolveGroupResult = resolve; });
  const pipProcess = spawn(isWindows ? resolvePythonExecutablePath() : resolvePipExecutablePath(), buildPipInstallArgs(group), {
    cwd: envPath,
  });
  activePipProcess = pipProcess;

  let pipOutputBuffer = '';
  let sawProgressLine = false;
  let heartbeatSeconds = 0;
  let settled = false;

  const heartbeat = setInterval(() => {
    if (sawProgressLine) {
      clearInterval(heartbeat);
      return;
    }
    heartbeatSeconds += PIP_HEARTBEAT_INTERVAL_MS / 1000;
    callbacks.onStatus(`Resolving packages… ${heartbeatSeconds}s`);
  }, PIP_HEARTBEAT_INTERVAL_MS);

  const settle = (result: PipGroupResult) => {
    if (settled) return;
    settled = true;
    clearInterval(heartbeat);
    if (activePipProcess === pipProcess) activePipProcess = null;
    resolveGroupResult(result);
  };

  const processPipLines = (raw: string, isError: boolean): void => {
    const cleaned = stripAnsi(raw);
    // Buffer partial lines — pip can chunk output mid-line
    pipOutputBuffer += cleaned;
    const lines = pipOutputBuffer.split(/\r?\n/);
    // Keep last element as buffer (may be incomplete)
    pipOutputBuffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      // Skip pure progress bar lines (━, █, etc.)
      if (/^[━╺╸█░▓▒─\s]+$/.test(trimmed)) continue;

      if (isError) {
        if (PIP_NETWORK_ERROR_PATTERN.test(trimmed)) {
          callbacks.onStatus(`NETWORK ERROR: ${trimmed}`);
        } else {
          // Filter out pip's non-error stderr (e.g. deprecation warnings, "already satisfied" notices)
          const lower = trimmed.toLowerCase();
          if (lower.includes('warning') && !lower.includes('error')) {
            callbacks.onStatus(trimmed);
          } else {
            callbacks.onStatus(`ERROR: ${trimmed}`);
          }
        }
      } else {
        callbacks.onStatus(trimmed);
      }

      const progress = parsePipLine(trimmed, seenPackages);
      if (progress) {
        if (!sawProgressLine
          && (progress.action === 'collecting' || progress.action === 'downloading' || progress.action === 'satisfied')) {
          sawProgressLine = true;
          clearInterval(heartbeat);
        }
        callbacks.onPipProgress?.(progress);
      }
    }
  };

  pipProcess.stdout.on('data', (data: Buffer) => {
    log.info(`pip (${group.name}):`, data.toString());
    processPipLines(data.toString(), false);
  });

  pipProcess.stderr.on('data', (data: Buffer) => {
    log.error(`pip error (${group.name}):`, data.toString());
    processPipLines(data.toString(), true);
  });

  pipProcess.on('error', (err) => {
    log.error(`pip (${group.name}) failed to start:`, err);
    settle({ status: 'failed', message: `pip install for ${group.name} packages failed to start: ${err.message}` });
  });

  pipProcess.on('close', (code) => {
    if (code === 0) {
      log.info(`pip (${group.name}) completed successfully`);
      settle({ status: 'ok' });
      return;
    }
    // pip reports a null code when it is killed instead of exiting. The
    // CANCEL_INSTALL handler kills the active pip process and already returns
    // the installer to its choice state, so a null code counts as an
    // intentional abort only while the cancel flag is set; any other null
    // exit is an unexpected failure (crash or external kill).
    if (code === null && installAborted) {
      log.info(`pip (${group.name}) aborted by user`);
      settle({ status: 'aborted' });
      return;
    }
    const message = code === null
      ? `pip install for ${group.name} packages exited without a return code (process was killed)`
      : `pip exited with code ${code} while installing ${group.name} packages`;
    settle({ status: 'failed', message });
  });

  return promise;
}

/**
 * Install groups sequentially: core first (its failure is fatal), then each
 * optional group in its own pip spawn. An optional group failure only logs a
 * warning and continues so the backend can still start. A user abort
 * (CANCEL_INSTALL) stops the remaining groups without any success/failure
 * modal — the cancel handler already put the installer back into its choice
 * state.
 */
async function installPipGroups(groups: PipInstallGroup[], callbacks: InstallPipGroupsCallbacks): Promise<void> {
  const seenPackages = new Set<string>();
  for (const group of groups) {
    if (installAborted) return;
    const result = await installPipGroup(group, callbacks, seenPackages);
    if (result.status === 'aborted') return;
    if (result.status === 'failed') {
      if (group.name === 'core') {
        throw new Error(result.message);
      }
      log.warn(`Optional package group "${group.name}" failed: ${result.message}`);
      callbacks.onStatus(`WARNING: Optional "${group.name}" package installation failed; continuing without it`);
    }
  }
}

function formatBytes(bytes: number): string {
  const gb = bytes / (1024 * 1024 * 1024);
  return `${gb.toFixed(1)} GB`;
}

async function checkDiskSpace(targetPath: string): Promise<number> {
  try {
    const dir = path.dirname(targetPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const statfs = (fs as any).statfs || (fs as any).statFS;
    if (typeof statfs === 'function') {
      const stats = await new Promise<any>((resolve, reject) => {
        statfs(dir, (err: Error | null, result: any) => {
          if (err) reject(err);
          else resolve(result);
        });
      });
      return stats.bavail * stats.bsize;
    }
  } catch {
    return Number.MAX_SAFE_INTEGER;
  }
  return Number.MAX_SAFE_INTEGER;
}

async function verifyPythonInstallation(options: InstallOptions): Promise<boolean> {
  const pythonPath = resolvePythonExecutablePath();
  // Import checks follow what was actually selected after platform stripping
  // (darwin-x64 installs no torch stack, so it verifies only the web core).
  const selected = resolveEffectiveInstallOptions(options);
  const imports = ['fastapi', 'uvicorn'];
  if (selected.includeLLM) imports.push('torch', 'transformers');

  // {e} stays literal — Python interpolates it inside its own f-string.
  const script = imports.map(mod => `try:\n    import ${mod}\nexcept Exception as e:\n    print(f"FAIL:${mod}:{e}")`).join('\n');

  return new Promise((resolve) => {
    const verifyProcess = spawn(pythonPath, ['-c', script], { cwd: envPath });
    let output = '';
    verifyProcess.stdout.on('data', (data) => { output += data.toString(); });
    verifyProcess.stderr.on('data', (data) => { output += data.toString(); });
    verifyProcess.on('close', (code) => {
      if (code !== 0 || output.includes('FAIL:')) {
        log.error('Installation verification failed:', output);
        resolve(false);
      } else {
        resolve(true);
      }
    });
  });
}

// Extract tar.gz file
async function extractFile(src: string, dest: string): Promise<void> {
  await tar.x({
    file: src,
    cwd: dest,
    gzip: true,
  });

  // Move extracted contents to env path
  const extractedFolders = fs.readdirSync(dest);
  if (extractedFolders.length > 0) {
    const extractedPath = path.join(dest, extractedFolders[0]);
    await copyRecursive(extractedPath, envPath);
  }
}

// Recursive copy helper
async function copyRecursive(src: string, dest: string): Promise<void> {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }

  const files = fs.readdirSync(src);
  for (const file of files) {
    const srcPath = path.join(src, file);
    const destPath = path.join(dest, file);
    const stat = fs.statSync(srcPath);

    if (stat.isDirectory()) {
      await copyRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

// Ping Python server to check if it's running
function pingPythonServer(callback: (running: boolean) => void): void {
  const options = {
    hostname: '127.0.0.1',
    port: PYTHON_BACKEND_PORT,
    path: '/health',
    method: 'GET',
    timeout: 3000,
  };

  const req = http.request(options, (res) => {
    res.resume();
    callback(res.statusCode === 200);
  });

  req.on('error', () => callback(false));
  req.on('timeout', () => { req.destroy(); callback(false); });
  req.end();
}

function startServerReadyPolling(): void {
  if (serverLoadCheckInterval) {
    clearTimeout(serverLoadCheckInterval);
    serverLoadCheckInterval = null;
  }

  function poll(): void {
    if (serverLoaded) {
      serverLoadCheckInterval = null;
      return;
    }

    pingPythonServer((running) => {
      if (serverLoaded) return;

      if (running) {
        serverLoaded = true;
        serverLoadCheckInterval = null;
        getMainWindow()?.webContents.send(IPC_CHANNELS.SERVER_LOAD, 'Python server running');
      } else {
        serverLoadCheckInterval = setTimeout(poll, 750);
      }
    });
  }

  serverLoadCheckInterval = setTimeout(poll, 750);
}

/**
 * Parse `netstat -ano` output for LISTENING owners of a port. Columns:
 * Proto, Local, Foreign, State, PID. TIME_WAIT ghosts report PID 0 (taskkill
 * would fail on it) and client connections to the port belong to the app, so
 * only LISTENING entries are returned.
 */
export function parseNetstatListeningPids(output: string): string[] {
  const pids: string[] = [];
  const lines = output.split('\n').filter((line) => line.trim());
  for (const line of lines) {
    const parts = line.trim().split(/\s+/);
    const state = parts[parts.length - 2];
    const pid = parts[parts.length - 1];
    if (state === 'LISTENING' && pid && /^\d+$/.test(pid) && pid !== '0') {
      pids.push(pid);
    }
  }
  return pids;
}

function killProcessesOnPort(port: number): void {
  try {
    let pids: string[] = [];

    if (isWindows) {
      try {
        const output = execSync(`netstat -ano | findstr :${port}`, {
          encoding: 'utf8',
          windowsHide: true,
        });
        pids = parseNetstatListeningPids(output);
      } catch {
      }
    } else {
      try {
        const output = execSync(`lsof -ti:${port}`, { encoding: 'utf8' }).trim();
        if (output) {
          pids = output.split('\n').filter((pid) => pid.trim());
        }
      } catch {
      }
    }

    if (pids.length === 0) {
      log.info(`No stale processes found using port ${port}`);
      return;
    }

    log.warn(
      `Found ${pids.length} stale process(es) using port ${port}: ${pids.join(', ')}. Killing...`
    );

    for (const pid of pids) {
      try {
        if (isWindows) {
          execSync(`taskkill /F /PID ${pid}`, { windowsHide: true });
        } else {
          process.kill(parseInt(pid, 10), 'SIGKILL');
        }
        log.info(`Killed stale process ${pid}`);
      } catch (e) {
        log.warn(`Failed to kill stale process ${pid}:`, e);
      }
    }
  } catch (e) {
    log.warn(`Failed to clean up processes on port ${port}:`, e);
  }
}

async function pythonFound(): Promise<boolean> {
  if (pythonChildProcess && pythonChildProcess.exitCode === null) {
    log.info('Python backend already running, skipping restart');
    return true;
  }

  log.info('Python found, starting backend...');

  killProcessesOnPort(PYTHON_BACKEND_PORT);

  if (isFirstTimeSetup) return false;

  const settings = loadSettings();
  let activeDictionaryTargetLanguage: string | undefined;
  const dictionaryTargetLanguagesEnv = JSON.stringify(settings.dictionaryTargetLanguages ?? {});
  const pythonExecutable = resolvePythonExecutablePath();
  const serverPath = resolveExternalResourceFilePath('server.py');

  const llmEnabled = settings.llmEnabled !== false;
  const ocrEnabled = settings.ocrEnabled !== false;

  const installedLanguageData = loadLangData();
  if (!settings.language) {
    log.info('No learning language selected; starting backend without an active language package.');
    sendStatusUpdate('Waiting for a learning language selection...');
  } else if (!installedLanguageData[settings.language]) {
    log.warn(`Language data is not installed for ${settings.language}; starting backend so the app can install it.`);
    sendStatusUpdate(`Language data is not installed for ${settings.language}. Install language data from Welcome or Settings.`);
  }

  activeDictionaryTargetLanguage = settings.dictionaryTargetLanguages?.[settings.language];

  pendingCriticalError = null;
  pendingStartupStatusMessage = null;
  const recentLogTail: string[] = [];
  const TAIL_MAX = 40;

  const pushTail = (line: string): void => {
    recentLogTail.push(line);
    if (recentLogTail.length > TAIL_MAX) recentLogTail.shift();
  };

  const V2_PREFIX = `${LOG_PATTERN_PREFIX}${LOG_PATTERN_VERSION}::`;
  const V1_PREFIX = LOG_PATTERN_PREFIX;
  const VALID_LEVELS = new Set<LogLevel>(['DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL']);

  const forwardStatusToRenderer = (message: string): void => {
    try {
      bufferStartupStatusMessage(message);
      getMainWindow()?.webContents.send(IPC_CHANNELS.SERVER_STATUS_UPDATE, message);
    } catch (e) {
      log.error("error", e);
    }
  };

  const handleV2Record = (level: LogLevel, module: string, msg: string): void => {
    const childName = module.startsWith('python.') ? module.slice('python.'.length) : module === 'python' ? 'core' : module;
    const child = pyLog.child(childName);
    switch (level) {
      case 'DEBUG': child.debug(msg); break;
      case 'INFO': child.info(msg); break;
      case 'WARN': child.warn(msg); break;
      case 'ERROR': child.error(msg); break;
      case 'FATAL': child.fatal(msg); break;
    }
    pushTail(`${level} [${module}] ${msg}`);
    if (module === 'ocr' || module.startsWith('ocr.')) {
      try {
        getMainWindow()?.webContents.send(IPC_CHANNELS.OCR_STATUS_UPDATE, msg);
      } catch (e) {
        log.error("error", e);
      }
    }
    forwardStatusToRenderer(msg);
  };

  const handleV1Record = (channel: string, message: string): void => {
    if (channel.startsWith('OCR')) {
      try {
        getMainWindow()?.webContents.send(IPC_CHANNELS.OCR_STATUS_UPDATE, message);
      } catch (e) {
        log.error("error", e);
      }
    }
    pushTail(`[${channel}] ${message}`);
    forwardStatusToRenderer(message);
  };

  const handleSTDOUT = (data: Buffer): void => {
    const text = data.toString('utf8');
    const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
    for (const line of lines) {
      const quitTokenMatch = line.match(/::QUIT_TOKEN::([a-f0-9]+)/);
      if (quitTokenMatch) {
        quitToken = quitTokenMatch[1];
        notifyQuitTokenAvailable(quitToken);
        broadcastBackendToken(quitToken);
        continue;
      }
      if (line.startsWith(V2_PREFIX)) {
        const parts = line.substring(V2_PREFIX.length).split('::');
        if (parts.length >= 4) {
          const level = parts[0] as LogLevel;
          const module = parts[1];
          const msg = parts.slice(3).join('::');
          if (VALID_LEVELS.has(level)) {
            handleV2Record(level, module, msg);
            continue;
          }
        }
      }
      if (line.startsWith(V1_PREFIX)) {
        const parts = line.substring(V1_PREFIX.length).split('::');
        if (parts.length >= 3) {
          handleV1Record(parts[0], parts.slice(2).join('::'));
          continue;
        }
      }
      pyLog.info(line);
      pushTail(line);
      forwardStatusToRenderer(line);
    }
  };

  const handleSTDERR = (data: Buffer): void => {
    const text = data.toString('utf8');
    const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
    for (const line of lines) {
      pyLog.warn(`stderr: ${line}`);
      pushTail(`stderr: ${line}`);
    }
    try {
      getMainWindow()?.webContents.send(IPC_CHANNELS.SERVER_STATUS_UPDATE, 'stderr: ' + text);
    } catch (e) {
      log.error("error", e);
    }
  };

  let startedProcess: ChildProcess | null = null;
  const handleClose = (code: number | null, signal: NodeJS.Signals | null): void => {
    lifecycleLog.info(`python exited code=${code ?? 'null'} signal=${signal ?? 'null'}`);
    const wasPlanned = startedProcess ? plannedBackendShutdowns.delete(startedProcess) : false;
    const shouldRestart = startedProcess !== null && backendRestartAfterExit === startedProcess;

    if (pythonChildProcess === startedProcess) {
      pythonChildProcess = null;
      serverLoaded = false;
      quitToken = null;
      broadcastBackendToken(null);
      if (serverLoadCheckInterval) {
        clearTimeout(serverLoadCheckInterval);
        serverLoadCheckInterval = null;
      }
    }

    if (wasPlanned) {
      lifecycleLog.info('Python backend stopped for a requested shutdown');
    } else {
      const errorMsg = buildCrashSummary(code, signal, recentLogTail);
      lifecycleLog.error(errorMsg);
      pendingCriticalError = errorMsg;
      getMainWindow()?.webContents.send(
        IPC_CHANNELS.SERVER_CRITICAL_ERROR,
        errorMsg
      );
    }

    if (shouldRestart) {
      backendRestartAfterExit = null;
      void pythonFound();
    }
  };

  const args = [
    serverPath,
    settings.language || 'und',
    resPath,
    llmEnabled ? 'true' : 'false',
    ocrEnabled ? 'true' : 'false',
    userDataPath,
    getLanguageDataRoot(),
  ];

  // The backend binds to loopback by default. Only expose it on all
  // interfaces (LAN) when the user explicitly enables tethered serving.
  const backendHost = settings.tetheredServerEnabled ? '0.0.0.0' : '127.0.0.1';
  args.push('--host', backendHost);

  if (isWindows) {
    // Use exec() on Windows — running through cmd.exe ensures proper
    // environment setup (PATH, DLL search paths) for native Python
    // modules (onnxruntime, OpenCV, paddlepaddle). spawn() breaks
    // DLL resolution for these modules in packaged builds.
    const command = [
      `"${pythonExecutable}"`,
      ...args.map(a => a.includes(' ') ? `"${a}"` : a),
    ].join(' ');

    pythonChildProcess = exec(command, {
      env: {
        ...process.env,
        MLEARN_DICTIONARY_TARGET_LANGUAGES_JSON: dictionaryTargetLanguagesEnv,
        ...(activeDictionaryTargetLanguage ? { MLEARN_DICTIONARY_TARGET_LANGUAGE: activeDictionaryTargetLanguage } : {}),
      },
    });
  } else {
    // Raise the per-process FD limit before exec-ing Python.
    // ML libs (torch, transformers, ONNX) open thousands of files;
    // the macOS default (256 for GUI apps) is far too low.
    const quotedArgs = args.map(a => `'${a.replace(/'/g, "'\\''")}'`).join(' ');
    pythonChildProcess = spawn('/bin/sh', [
      '-c',
      `ulimit -n 65536 2>/dev/null; exec env '${pythonExecutable}' ${quotedArgs}`,
    ], {
      env: {
        ...process.env,
        MLEARN_DICTIONARY_TARGET_LANGUAGES_JSON: dictionaryTargetLanguagesEnv,
        ...(activeDictionaryTargetLanguage ? { MLEARN_DICTIONARY_TARGET_LANGUAGE: activeDictionaryTargetLanguage } : {}),
      },
    });
  }

  startedProcess = pythonChildProcess;

  startServerReadyPolling();

  pythonChildProcess.stdout?.on('data', handleSTDOUT);
  pythonChildProcess.stderr?.on('data', handleSTDERR);
  pythonChildProcess.on('close', handleClose);
  return true;
}

// Find Python installation
function verifyPythonExecutable(pythonPath: string): Promise<boolean> {
  return new Promise((resolve) => {
    const check = spawn(pythonPath, ['--version'], { timeout: 5000 });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      check.kill('SIGKILL');
      resolve(false);
    }, 5000);
    check.on('error', () => {
      clearTimeout(timer);
      resolve(false);
    });
    check.on('close', (code) => {
      clearTimeout(timer);
      if (!timedOut && code === 0) {
        resolve(true);
      } else {
        resolve(false);
      }
    });
  });
}

/**
 * Reconcile pip packages for currently-enabled components into the existing
 * Python env. Called on startup when a healthy runtime already exists (e.g.
 * after the user toggles a component on and restarts). pip is idempotent —
 * already-installed packages are skipped near-instantly — so this is safe to
 * run on every startup and only installs what's actually missing.
 */
async function reconcileComponentPackages(): Promise<void> {
  const pipExecutable = resolvePipExecutablePath();
  if (!fs.existsSync(pipExecutable)) return;

  const settings = loadSettings();
  const options: InstallOptions = {
    includeLLM: settings.llmEnabled ?? DEFAULT_SETTINGS.llmEnabled,
    includeOCR: settings.ocrEnabled ?? DEFAULT_SETTINGS.ocrEnabled,
    includeVoice: settings.voiceEnabled ?? DEFAULT_SETTINGS.voiceEnabled,
  };

  const installPlatform = getInstallerPlatform();
  installAborted = false;
  const groups = buildPipInstallGroups(options, undefined, installPlatform, await hasNvidiaGpu());
  const packageCount = groups.reduce((sum, group) => sum + group.packages.length, 0);
  if (packageCount === 0) return;

  log.info(`Reconciling ${packageCount} component packages across groups: ${groups.map((group) => group.name).join(', ')}`);
  // Emit INSTALL_STARTED so the install progress modal appears
  broadcastInstallEvent(IPC_CHANNELS.INSTALL_STARTED, { ...options, platformWarnings: [...PLATFORM_WARNINGS[installPlatform]] } satisfies InstallStartedPayload);
  sendStatusUpdate(`Installing ${packageCount} component packages...`);

  try {
    await installPipGroups(groups, { onStatus: sendStatusUpdate, onPipProgress: sendPipProgress });
  } catch (e) {
    // Core group failure: surface it, but startup continues (findPython logs it).
    log.warn('Component package reconciliation failed:', e);
    throw e;
  }
  if (installAborted) return;
  log.info('Component package reconciliation complete');
  sendStatusUpdate('Starting Python backend...');
  // Signal completion so the install progress modal dismisses
  broadcastInstallEvent(IPC_CHANNELS.SUCCESSFUL_INSTALL, true);

  // Also reconcile language-level requirements for the active language.
  // On degraded platforms (darwin-x64) the stripped options keep language
  // ocr/llm/voice component packages from installing.
  const language = settings.language;
  if (language) {
    try {
      await ensureLanguagePythonRequirementsInstalled(language, loadLangData(), resolveEffectiveInstallOptions(options, installPlatform));
    } catch (e) {
      log.warn(`Language requirement reconciliation failed for ${language}:`, e);
    }
  }
}

// ============================================================================
// Optional component management (opt-in/opt-out of heavyweight packages)
// ============================================================================

const PYTHON_COMPONENT_IDS: readonly PythonComponentId[] = ['llm', 'ocr', 'voice'];

const COMPONENT_SETTINGS_FLAGS: Readonly<Record<PythonComponentId, 'llmEnabled' | 'ocrEnabled' | 'voiceEnabled'>> = {
  llm: 'llmEnabled',
  ocr: 'ocrEnabled',
  voice: 'voiceEnabled',
};

/** Import probes for the "installed" state; OCR rides on per-language packages. */
const COMPONENT_PROBE_MODULES: Readonly<Record<PythonComponentId, readonly string[] | null>> = {
  llm: ['torch', 'transformers'],
  voice: ['faster_whisper'],
  ocr: null,
};

/** Approximate download+install footprint per platform/GPU, for size disclosure. */
function getComponentSizeLabel(id: PythonComponentId, platform: InstallerPlatform, gpu: boolean): string {
  if (platform === 'darwin-x64') return '—';
  if (id === 'ocr') return '~600 MB + language data';
  if (id === 'llm') {
    if (platform === 'darwin-arm64') return '~550 MB';
    if (platform === 'win32-x64') return gpu ? '~3.5 GB (CUDA)' : '~250 MB';
    return gpu ? '~2.5–3 GB (CUDA)' : '~300 MB';
  }
  // voice
  if (platform === 'darwin-arm64') return '~320 MB (incl. on-device TTS)';
  if (platform === 'win32-x64') return gpu ? '~4.5 GB (CUDA)' : '~700 MB';
  return gpu ? '~3 GB (CUDA)' : '~800 MB';
}

function normalizeRequirementName(requirement: string): string {
  const withoutMarker = requirement.split(';')[0];
  const name = withoutMarker.split(/[\[<>=!~\s]/)[0];
  return name.trim().toLowerCase().replace(/_/g, '-');
}

function componentEnabledOptions(enabled: Record<PythonComponentId, boolean>): InstallOptions {
  return {
    includeLLM: enabled.llm,
    includeOCR: enabled.ocr,
    includeVoice: enabled.voice ?? false,
  };
}

/**
 * Compute the dependency-safe removal inputs for disabling `removeIds`.
 * Candidates are the disabled component's own groups; roots are every package
 * declared by the remaining enabled groups (incl. core + language packages).
 * Returns null when nothing is removable. Pure — unit tested.
 */
export function computeComponentRemovalPlan(
  enabled: Record<PythonComponentId, boolean>,
  removeIds: PythonComponentId[],
  config: PipRequirementsConfig,
  platform: InstallerPlatform,
  gpu: boolean,
): { candidates: string[]; roots: string[] } | null {
  const remainingEnabled: Record<PythonComponentId, boolean> = { ...enabled };
  const onlyRemoved: Record<PythonComponentId, boolean> = { llm: false, ocr: false, voice: false };
  for (const id of removeIds) {
    // Never plan removals for components that are not currently enabled —
    // repeated or stale opt-out requests must be no-ops.
    if (!enabled[id]) continue;
    remainingEnabled[id] = false;
    onlyRemoved[id] = true;
  }

  const sharedArgs = [config, platform, gpu] as const;
  const disabledGroups = buildPipInstallGroups(componentEnabledOptions(onlyRemoved), ...sharedArgs)
    .filter((group) => group.name !== 'core' && group.name !== 'language');
  if (disabledGroups.length === 0) return null;

  const remainingGroups = buildPipInstallGroups(componentEnabledOptions(remainingEnabled), ...sharedArgs);

  const candidates = new Set<string>();
  for (const group of disabledGroups) {
    for (const requirement of group.packages) candidates.add(normalizeRequirementName(requirement));
  }
  const roots = new Set<string>();
  for (const group of remainingGroups) {
    for (const requirement of group.packages) roots.add(requirement);
  }
  return { candidates: [...candidates], roots: [...roots] };
}

function resolveUninstallPlanScriptPath(): string {
  return resolveResourceFilePath('pip_uninstall_plan.py');
}

/** Run the dependency-closure probe in the managed Python env. */
async function runUninstallPlanProbe(candidates: string[], roots: string[]): Promise<{ remove: string[]; keep: string[] }> {
  const plan = await new Promise<{ remove?: string[]; keep?: string[]; error?: string }>((resolve) => {
    const probe = spawn(
      resolvePythonExecutablePath(),
      [resolveUninstallPlanScriptPath(), JSON.stringify(candidates), JSON.stringify(roots)],
      { cwd: envPath, windowsHide: true },
    );
    let output = '';
    probe.stdout.on('data', (chunk) => { output += String(chunk); });
    probe.stderr.on('data', (chunk) => { output += String(chunk); });
    probe.on('error', (error) => resolve({ error: String(error) }));
    probe.on('close', () => {
      try {
        resolve(JSON.parse(output.trim()));
      } catch {
        resolve({ error: `unparseable probe output: ${output.slice(0, 200)}` });
      }
    });
  });
  if (plan.error || !Array.isArray(plan.remove) || !Array.isArray(plan.keep)) {
    throw new Error(`dependency probe failed: ${plan.error || 'unknown'}`);
  }
  return { remove: plan.remove, keep: plan.keep };
}

/**
 * Uninstall the pip packages behind disabled components. Removal is
 * dependency-safe: the probe keeps anything transitively required by the
 * remaining enabled components (e.g. cudnn/cublas while CUDA torch stays), and
 * any probe failure aborts without uninstalling anything.
 */
export async function uninstallComponents(ids: PythonComponentId[]): Promise<ComponentsUninstallResult> {
  const result: ComponentsUninstallResult = { ids, removed: [], kept: [] };
  if (ids.length === 0) return result;
  const pipExecutable = resolvePipExecutablePath();
  if (!fs.existsSync(pipExecutable)) {
    result.abortedReason = 'Python runtime is not installed';
    return result;
  }
  if (installInProgress) {
    result.abortedReason = 'An installation is already in progress';
    return result;
  }

  const settings = loadSettings();
  const enabled: Record<PythonComponentId, boolean> = {
    llm: settings.llmEnabled ?? DEFAULT_SETTINGS.llmEnabled,
    ocr: settings.ocrEnabled ?? DEFAULT_SETTINGS.ocrEnabled,
    voice: settings.voiceEnabled ?? DEFAULT_SETTINGS.voiceEnabled,
  };
  const platform = getInstallerPlatform();
  const gpu = await hasNvidiaGpu();
  const plan = computeComponentRemovalPlan(enabled, ids, loadPipRequirementsConfig(), platform, gpu);
  if (!plan || plan.candidates.length === 0) {
    result.kept = [];
    return result;
  }

  let removable: string[];
  try {
    const probe = await runUninstallPlanProbe(plan.candidates, plan.roots);
    removable = probe.remove;
    result.kept = probe.keep;
  } catch (e) {
    log.warn('Component uninstall aborted:', e);
    result.abortedReason = e instanceof Error ? e.message : String(e);
    return result;
  }
  if (removable.length === 0) return result;

  installAborted = false;
  sendStatusUpdate(`Removing ${removable.length} unused component packages...`);
  const exitCode = await new Promise<number | null>((resolve) => {
    const uninstallProcess = spawn(
      resolvePythonExecutablePath(),
      ['-m', 'pip', 'uninstall', '-y', ...removable],
      { cwd: envPath, windowsHide: true },
    );
    let output = '';
    uninstallProcess.stdout.on('data', (chunk) => { output += String(chunk); });
    uninstallProcess.stderr.on('data', (chunk) => { output += String(chunk); });
    uninstallProcess.on('error', () => resolve(-1));
    uninstallProcess.on('close', (code) => {
      log.info(`pip uninstall exit ${code}: ${output.slice(-500)}`);
      resolve(code);
    });
  });
  if (exitCode !== 0) {
    result.abortedReason = `pip uninstall failed with exit code ${exitCode}`;
    return result;
  }
  result.removed = removable;
  sendStatusUpdate('Component packages removed');
  // The running backend may hold removed modules in memory — reload it so the
  // env on disk and the running process agree.
  restartPythonBackend();
  return result;
}

async function probeComponentInstalled(id: PythonComponentId): Promise<boolean | null> {
  const modules = COMPONENT_PROBE_MODULES[id];
  if (!modules) return null;
  const pythonPath = resolvePythonExecutablePath();
  if (!fs.existsSync(pythonPath)) return false;
  const script = modules
    .map((mod) => `try:\n    import ${mod}\n    print("OK:${mod}")\nexcept Exception:\n    print("MISSING:${mod}")`)
    .join('\n');
  const output = await new Promise<string>((resolve) => {
    const probe = spawn(pythonPath, ['-c', script], { cwd: envPath, windowsHide: true });
    let buffer = '';
    probe.stdout.on('data', (chunk) => { buffer += String(chunk); });
    probe.stderr.on('data', (chunk) => { buffer += String(chunk); });
    probe.on('error', () => resolve(''));
    probe.on('close', () => resolve(buffer));
  });
  return modules.every((mod) => output.includes(`OK:${mod}`));
}

/** Full component state for the renderer's component/module UX. */
export async function getPythonComponentsState(): Promise<PythonComponentInfo[]> {
  const settings = loadSettings();
  const platform = getInstallerPlatform();
  const gpu = await hasNvidiaGpu();
  const states = await Promise.all(PYTHON_COMPONENT_IDS.map(async (id): Promise<PythonComponentInfo> => {
    const flag = COMPONENT_SETTINGS_FLAGS[id];
    const supported = platform !== 'darwin-x64';
    return {
      id,
      enabled: supported ? Boolean(settings[flag] ?? DEFAULT_SETTINGS[flag]) : false,
      supported,
      gpuAccelerated: supported && gpu && (id === 'llm' || id === 'voice'),
      sizeLabel: getComponentSizeLabel(id, platform, gpu),
      installed: supported ? await probeComponentInstalled(id) : null,
    };
  }));
  return states;
}

export async function findPython(): Promise<boolean> {
  log.info('Finding Python...');

  const possibilities = getPythonExecutableCandidates();

  for (const pythonPath of possibilities) {
    if (fs.existsSync(pythonPath)) {
      const healthy = await verifyPythonExecutable(pythonPath);
      if (healthy) {
        log.info('Python found and healthy at:', pythonPath);
        selectedPythonExecutablePath = pythonPath;

        // UserData Python persists across binary updates. Existing profiles should
        // keep using a healthy runtime instead of being sent back through onboarding.
        if (pythonPath.startsWith(userDataPath)) {
          const installedVersion = getInstalledPythonVersion();
          const currentVersion = app.getVersion();
          if (installedVersion !== currentVersion) {
            if (hasSettingsFile()) {
              log.info(`Python was installed with version ${installedVersion ?? 'unknown'}, current app version is ${currentVersion}. Reusing healthy runtime for existing profile.`);
              setInstalledPythonVersion(currentVersion);
            } else {
              log.info(`Python was installed with version ${installedVersion ?? 'unknown'}, current app version is ${currentVersion}. Showing installer for update/reinstall.`);
              try { fs.unlinkSync(pythonVersionPath); } catch {}
              waitingForInstallChoice = true;
              isFirstTimeSetup = true;
              sendStatusUpdate('Select the components you want and click Install to continue.');
              try {
                getCurrentWindow()?.webContents.send(IPC_CHANNELS.INSTALLER_AWAITING_CHOICE);
              } catch (e) {
                log.error('error', e);
              }
              return false;
            }
          }
        }

        waitingForInstallChoice = false;
        isFirstTimeSetup = false;
        pythonSuccessInstall = true;

        // Install pip packages for any components enabled since the last install.
        // Non-fatal: the backend still starts if this fails.
        try {
          await reconcileComponentPackages();
        } catch (e) {
          log.warn('Component package reconciliation failed:', e);
        }

        return await pythonFound();
      }
      log.warn('Python binary exists but is not healthy:', pythonPath);
    }
  }

  log.info('Python not found, starting installer...');
  waitingForInstallChoice = true;
  isFirstTimeSetup = true;

  sendStatusUpdate('Select the components you want and click Install to continue.');
  try {
    getCurrentWindow()?.webContents.send(IPC_CHANNELS.INSTALLER_AWAITING_CHOICE);
  } catch (e) {
    log.error("error", e);
  }

  return false;
}

// Start Python installation
export async function startPythonInstall(options: InstallOptions): Promise<void> {
  if (installInProgress) {
    log.warn('Installation already in progress');
    return;
  }

  const requiredBytes = estimateRequiredBytes(options);
  const availableBytes = await checkDiskSpace(envPath);
  const bufferMultiplier = 1.2;
  if (availableBytes < requiredBytes * bufferMultiplier) {
    handleInstallerFailure('Not enough disk space', {
      detail: `Need ${formatBytes(requiredBytes * bufferMultiplier)}, have ${formatBytes(availableBytes)}`,
      emitNetworkError: true,
    });
    return;
  }

  pendingInstallOptions = options;
  waitingForInstallChoice = false;
  isFirstTimeSetup = false;
  installInProgress = true;
  pythonSuccessInstall = false;
  selectedPythonExecutablePath = null;
  installAborted = false;

  const selectedComponents = ['Python runtime'];
  if (options.includeLLM) selectedComponents.push('Local language model support');
  if (options.includeOCR) selectedComponents.push('OCR reader support');
  if (options.includeVoice) selectedComponents.push('Voice & TTS support');
  log.info('Installing:', selectedComponents.join(', '));

  const installPlatform = getInstallerPlatform();
  const effectiveOptions = resolveEffectiveInstallOptions(options, installPlatform);
  try {
    broadcastInstallEvent(IPC_CHANNELS.INSTALL_STARTED, { ...options, platformWarnings: [...PLATFORM_WARNINGS[installPlatform]] } satisfies InstallStartedPayload);
  } catch (e) {
    log.error("error", e);
  }

  sendStatusUpdate('Resolving Python runtime...');

  const gpuProbe = await hasNvidiaGpu();
  const pipGroups = buildPipInstallGroups(options, undefined, installPlatform, gpuProbe);
  log.info('Pip packages:', pipGroups.map((group) => `${group.name} (${group.packages.length})`).join(', '));

  // Fetch runtime catalog and resolve the target-specific archive entry
  let catalogEntry: RuntimeCatalogEntry;
  let catalogVersion: string;
  try {
    const runtimeCatalogUrl = loadSettings().runtimeCatalogUrl?.trim() || DEFAULT_RUNTIME_CATALOG_URL;
    let catalog: RuntimeCatalog;
    try {
      catalog = await fetchRuntimeCatalogWithRetry(runtimeCatalogUrl);
    } catch (primaryError) {
      log.warn('Runtime catalog unavailable, probing mirrors:', primaryError);
      const mirrored = await probeMirrorCatalog(runtimeCatalogUrl, loadSettings().catalogMirrorDomain, fetchRuntimeCatalog);
      if (!mirrored) {
        throw primaryError;
      }
      catalog = mirrored;
    }
    catalogVersion = catalog.version;
    const target = getRuntimeTarget();
    const entry = catalog.runtimes[target];
    if (!entry) {
      throw new Error(`No runtime available for target ${target}`);
    }
    catalogEntry = entry;
    log.info(`Runtime catalog: ${catalogVersion}, target ${target}, sha256 ${entry.sha256.slice(0, 12)}`);
  } catch (error) {
    handleInstallerFailure('Failed to resolve Python runtime', {
      detail: error instanceof Error ? error.message : 'Unknown error',
      emitNetworkError: true,
    });
    return;
  }

  // Cache check: if the receipt sha256 matches the catalog, skip the download
  const receipt = readRuntimeReceipt();
  const cacheHit = receipt && receipt.sha256 === catalogEntry.sha256;

  try {
    if (cacheHit) {
      log.info('Runtime archive cached (sha256 matches receipt), skipping download');
      sendStatusUpdate('Using cached runtime...');
    } else {
      // Clean up previous installation attempts
      try {
        if (fs.existsSync(downloadPath)) fs.unlinkSync(downloadPath);
        if (fs.existsSync(envPath)) fs.rmSync(envPath, { recursive: true, force: true });
      } catch (e) {
        log.warn('Cleanup failed:', e);
      }

      sendStatusUpdate('Downloading Python...');
      await downloadFileWithProgress(catalogEntry.url, downloadPath, (progress) => {
        const percent = progress.expectedBytes > 0
          ? Math.round(progress.progress * 100)
          : 0;
        sendStatusUpdate(`Downloading Python... ${percent}%`);
      });

      // Verify sha256 integrity
      const actualSha = computeSha256(downloadPath);
      if (actualSha !== catalogEntry.sha256) {
        try { fs.unlinkSync(downloadPath); } catch {}
        handleInstallerFailure('Runtime integrity check failed', {
          detail: `sha256 mismatch: expected ${catalogEntry.sha256.slice(0, 12)}, got ${actualSha.slice(0, 12)}`,
          emitNetworkError: true,
        });
        return;
      }
      log.info('Runtime sha256 verified');
    }

    sendStatusUpdate('Download complete, extracting...');

    try {
      fs.mkdirSync(extractPath, { recursive: true });
      await extractFile(downloadPath, extractPath);
      selectedPythonExecutablePath = getUserDataPythonExecutablePath();
      sendStatusUpdate('Extraction complete, installing libraries...');

      if (pipGroups.length === 0) {
        writeRuntimeReceipt(catalogEntry, catalogVersion);
        installInProgress = false;
        pythonSuccessInstall = true;
        await pythonFound();
        return;
      }

      try {
        // Core group first (failure fatal), then one pip spawn per optional
        // group; optional group failures only warn and let the backend start.
        await installPipGroups(pipGroups, { onStatus: sendStatusUpdate, onPipProgress: sendPipProgress });
      } catch (error) {
        log.error('pip install failed:', error);
        handleInstallerFailure(error instanceof Error ? error.message : 'Package installation failed');
        return;
      }
      installInProgress = false;
      if (installAborted) {
        // User cancelled: CANCEL_INSTALL already restored the choice state.
        return;
      }

      sendStatusUpdate('Verifying installation...');
      const verified = await verifyPythonInstallation(effectiveOptions);
      if (verified) {
        log.info('Installation complete');
        pythonSuccessInstall = true;
        writeRuntimeReceipt(catalogEntry, catalogVersion);
        setInstalledPythonVersion(app.getVersion());
        sendStatusUpdate('Installation complete');
        await pythonFound();
      } else {
        log.error('Installation verification failed');
        waitingForInstallChoice = true;
        sendStatusUpdate('ERROR: Installation verification failed');
        getCurrentWindow()?.webContents.send(IPC_CHANNELS.INSTALLER_AWAITING_CHOICE);
      }
    } catch (error) {
      log.error('Extraction/installation failed:', error);
      handleInstallerFailure('Installation failed', {
        detail: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  } catch (error) {
    log.error('Download failed:', error);
    handleInstallerFailure('Download failed', {
      detail: error instanceof Error ? error.message : 'Unknown error',
      emitNetworkError: isNetworkError(error),
    });
  }
}

// Terminate Python backend
export function terminatePythonBackend(): void {
  if (!pythonChildProcess) return;
  const processToTerminate = pythonChildProcess;
  plannedBackendShutdowns.add(processToTerminate);

  // Try graceful shutdown
  try {
    processToTerminate.kill('SIGINT');
  } catch (e) {
    log.warn('Failed to SIGINT python:', e);
  }

  // Send quit request to server
  const options = {
    hostname: '127.0.0.1',
    port: PYTHON_BACKEND_PORT,
    path: '/quit',
    method: 'POST',
    headers: quitToken ? { 'x-quit-token': quitToken } : {},
    timeout: 2000,
  };

  const req = http.request(options, (res) => { res.resume(); });
  req.on('error', () => { /* ignore */ });
  req.on('timeout', () => { req.destroy(); });
  req.end();

  // Force kill after timeout
  setTimeout(() => {
    if (!processToTerminate.killed) {
      try { processToTerminate.kill('SIGTERM'); } catch (e) {
        log.error("error", e);
      }
    }
    setTimeout(() => {
      if (!processToTerminate.killed) {
        try { processToTerminate.kill('SIGKILL'); } catch (e) {
          log.error("error", e);
        }
      }
    }, 400);
  }, 400);
}

// Restart the Python backend without relaunching Electron
export function restartPythonBackend(): void {
  log.info('Restarting Python backend...');
  
  // Reset state
  serverLoaded = false;
  if (serverLoadCheckInterval) {
    clearTimeout(serverLoadCheckInterval);
    serverLoadCheckInterval = null;
  }
  
  if (!pythonChildProcess) {
    void pythonFound();
    return;
  }

  backendRestartAfterExit = pythonChildProcess;
  terminatePythonBackend();
}

// Setup IPC handlers
export function setupPythonBackendIPC(): void {
  ipcMain.on(IPC_CHANNELS.IS_SUCCESSFUL_INSTALL, (event) => {
    event.reply(IPC_CHANNELS.SUCCESSFUL_INSTALL, pythonSuccessInstall);
  });

  ipcMain.on(IPC_CHANNELS.IS_LOADED, (event) => {
    if (serverLoaded) {
      event.reply(IPC_CHANNELS.SERVER_LOAD, 'Python server running');
    }

    if (pendingStartupStatusMessage) {
      event.sender.send(IPC_CHANNELS.SERVER_STATUS_UPDATE, pendingStartupStatusMessage);
      pendingStartupStatusMessage = null;
    }

    if (!serverLoaded && pendingCriticalError) {
      // Re-send buffered critical error
      event.sender.send(IPC_CHANNELS.SERVER_CRITICAL_ERROR, pendingCriticalError);
    }

    if (!serverLoaded && waitingForInstallChoice) {
      event.sender.send(IPC_CHANNELS.INSTALLER_AWAITING_CHOICE);
    }
  });

  ipcMain.on(IPC_CHANNELS.START_INSTALL, async (_event, rawOptions) => {
    const options = rawOptions && typeof rawOptions === 'object' ? rawOptions : {};
    await startPythonInstall({
      includeLLM: options.includeLLM ?? true,
      includeOCR: options.includeOCR ?? true,
      includeVoice: options.includeVoice ?? true,
    });
  });

  ipcMain.on(IPC_CHANNELS.CANCEL_INSTALL, () => {
    // Flag the abort before killing so the pip close handler sees a
    // user-initiated abort (null exit code), not an unexpected failure.
    installAborted = true;
    if (activePipProcess) {
      activePipProcess.kill('SIGTERM');
      activePipProcess = null;
    }
    installInProgress = false;
    waitingForInstallChoice = true;
    sendStatusUpdate('Installation cancelled');
    try {
      getCurrentWindow()?.webContents.send(IPC_CHANNELS.INSTALLER_AWAITING_CHOICE);
    } catch (e) {
      log.error("error", e);
    }
  });

  ipcMain.on(IPC_CHANNELS.INSTALLER_STATE_REQUEST, (event) => {
    event.reply(IPC_CHANNELS.INSTALLER_STATE, {
      waiting: waitingForInstallChoice,
      inProgress: installInProgress,
      success: pythonSuccessInstall,
      options: pendingInstallOptions,
    } as InstallerState);
  });

  ipcMain.on(IPC_CHANNELS.RESTART_BACKEND, () => {
    restartPythonBackend();
  });

  ipcMain.on(IPC_CHANNELS.GET_BACKEND_TOKEN, (event) => {
    event.reply(IPC_CHANNELS.BACKEND_TOKEN_CHANGED, quitToken);
  });

  ipcMain.on(IPC_CHANNELS.GET_COMPONENTS_STATE, async (event) => {
    try {
      event.reply(IPC_CHANNELS.COMPONENTS_STATE, await getPythonComponentsState());
    } catch (e) {
      log.error('Failed to collect component state:', e);
      event.reply(IPC_CHANNELS.COMPONENTS_STATE, []);
    }
  });

  ipcMain.on(IPC_CHANNELS.UNINSTALL_COMPONENTS, async (event, rawIds) => {
    const ids = Array.isArray(rawIds)
      ? rawIds.filter((id): id is PythonComponentId => PYTHON_COMPONENT_IDS.includes(id))
      : [];
    try {
      const result = await uninstallComponents(ids);
      event.reply(IPC_CHANNELS.COMPONENTS_UNINSTALLED, result);
    } catch (e) {
      log.error('Component uninstall failed:', e);
      event.reply(IPC_CHANNELS.COMPONENTS_UNINSTALLED, {
        ids,
        removed: [],
        kept: [],
        abortedReason: e instanceof Error ? e.message : String(e),
      } satisfies ComponentsUninstallResult);
    }
  });
}
