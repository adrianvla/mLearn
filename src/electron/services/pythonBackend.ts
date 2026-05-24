/**
 * Python Backend Service
 * Handles downloading, installing, and managing the Python backend
 */

import fs from 'fs';
import path from 'path';
import https from 'https';
import http from 'http';
import { spawn, exec, execSync, ChildProcess } from 'child_process';
import { ipcMain, app } from 'electron';
import * as tar from 'tar';
import { IPC_CHANNELS, PYTHON_BACKEND_PORT, PYTHON_DOWNLOAD_BASE, LOG_PATTERN_PREFIX, LOG_PATTERN_VERSION } from '../../shared/constants';
import type { InstallOptions, InstallerState, PipRequirementsConfig, PipProgress } from '../../shared/types';
import { 
  getResourcePath, 
  getAppPath, 
  getBundledDistElectronPath,
  getUserDataPath,
  getPythonExecutablePath, 
  getPipExecutablePath, 
  getPythonDownloadUrl,
  isWindows 
} from '../utils/platform';
import { loadSettings } from './settings';
import { getCurrentWindow, getMainWindow } from './windowManager';
import { getLogger, type LogLevel } from '../../shared/utils/logger';

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
let lastExitWasAnkiError = false;
let ankiErrorSent = false;
let ankiOverrideDisable = false;

let quitToken: string | null = null;

// Buffered error state so the renderer can retrieve it even if it mounts
// after the Python process exits (race condition: fast Anki connection-refused)
let pendingAnkiError: string | null = null;
let pendingCriticalError: string | null = null;
let pendingStartupStatusMessage: string | null = null;
let activePipProcess: ChildProcess | null = null;

const PACKAGE_SIZE_ESTIMATES_BYTES: Readonly<Record<string, number>> = {
  core: 500 * 1024 * 1024,
  ocr: 3000 * 1024 * 1024,
  llm: 5000 * 1024 * 1024,
  voice: 4000 * 1024 * 1024,
  python: 150 * 1024 * 1024,
};

// Paths
const resPath = getResourcePath();
const userDataPath = getUserDataPath();
const downloadPath = path.join(userDataPath, 'python.tar.gz');
const extractPath = path.join(userDataPath, 'py');
const envPath = path.join(userDataPath, 'env');
const pythonVersionPath = path.join(userDataPath, 'python-version.txt');

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
  const candidatePaths = [
    path.join(resPath, 'root-of-app', ...segments),
    path.join(resPath, ...segments),
  ];

  for (const candidatePath of candidatePaths) {
    if (fs.existsSync(candidatePath)) {
      return candidatePath;
    }
  }

  return candidatePaths[0];
}

function resolvePythonExecutablePath(): string {
  if (isWindows) {
    const userDataExe = path.join(userDataPath, 'env', 'python.exe');
    if (fs.existsSync(userDataExe)) return userDataExe;
  } else {
    const userDataPy = path.join(userDataPath, 'env', 'bin', 'python3');
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

// Send status update to current window
function sendStatusUpdate(message: string): void {
  try {
    getCurrentWindow()?.webContents.send(IPC_CHANNELS.SERVER_STATUS_UPDATE, message);
  } catch (e) {
    log.error('Failed to send status update:', e);
  }
}

// Send pip progress update to current window
function sendPipProgress(progress: PipProgress): void {
  try {
    getCurrentWindow()?.webContents.send(IPC_CHANNELS.PIP_PROGRESS, progress);
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
      getCurrentWindow()?.webContents.send(IPC_CHANNELS.INSTALLER_NETWORK_ERROR, {
        message,
        detail: options.detail || null,
      });
    } catch (e) {
      log.error("error", e);
    }
  }

  try {
    getCurrentWindow()?.webContents.send(IPC_CHANNELS.INSTALLER_AWAITING_CHOICE);
  } catch (e) {
    log.error("error", e);
  }
}

// Load pip requirements config
function loadPipRequirementsConfig(): PipRequirementsConfig {
  try {
    const data = readResourceFile('pip_requirements.json');
    return JSON.parse(data);
  } catch (e) {
    log.error('Failed to load pip requirements config:', e);
    return {
      core: ['flask', 'requests', 'jaconv', 'fugashi', 'unidic-lite'],
      ocr: ['manga-ocr'],
      llm: ['transformers', 'torch'],
    };
  }
}

// Build pip requirement list based on options
function buildPipRequirementList(options: InstallOptions): string[] {
  const config = loadPipRequirementsConfig();
  const packages = [...config.core];
  
  if (options.includeOCR) {
    packages.push(...config.ocr);
  }
  if (options.includeLLM) {
    packages.push(...config.llm);
  }
  if (options.includeVoice && config.voice) {
    packages.push(...config.voice);
    if (config['qwen3-tts']) {
      packages.push(...config['qwen3-tts']);
    }
  }
  
  return packages;
}

function estimateRequiredBytes(options: InstallOptions): number {
  let total = PACKAGE_SIZE_ESTIMATES_BYTES.python + PACKAGE_SIZE_ESTIMATES_BYTES.core;
  if (options.includeOCR) total += PACKAGE_SIZE_ESTIMATES_BYTES.ocr;
  if (options.includeLLM) total += PACKAGE_SIZE_ESTIMATES_BYTES.llm;
  if (options.includeVoice) total += PACKAGE_SIZE_ESTIMATES_BYTES.voice;
  return total;
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
  const imports = ['fastapi', 'uvicorn', 'spacy'];
  if (options.includeOCR) imports.push('paddleocr', 'rapidocr', 'manga_ocr', 'onnxruntime', 'cv2');
  if (options.includeLLM) imports.push('torch', 'transformers');

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

// Download file with redirect handling
function downloadFile(
  fileUrl: string, 
  dest: string, 
  callback: () => void, 
  redirectCount = 0
): void {
  const MAX_REDIRECTS = 5;
  const file = fs.createWriteStream(dest);

  https.get(fileUrl, (response) => {
    // Handle redirects
    if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
      if (redirectCount >= MAX_REDIRECTS) {
        file.destroy();
        fs.unlink(dest, () => {});
        handleInstallerFailure('Too many redirects during download', { emitNetworkError: true });
        return;
      }

      const redirectUrl = new URL(response.headers.location, fileUrl).toString();
      file.destroy();
      response.resume();
      downloadFile(redirectUrl, dest, callback, redirectCount + 1);
      return;
    }

    if (response.statusCode !== 200) {
      file.destroy();
      response.resume();
      fs.unlink(dest, () => {});
      handleInstallerFailure('Download failed', {
        detail: `Status code: ${response.statusCode}`,
        emitNetworkError: true,
      });
      return;
    }

    response.pipe(file);
    file.on('finish', () => {
      file.close(() => {
        const stats = fs.statSync(dest);
        if (stats.size === 0) {
          fs.unlink(dest, () => {});
          handleInstallerFailure('Downloaded file is empty', { emitNetworkError: true });
          return;
        }
        log.info('Download complete!');
        callback();
      });
    });
  }).on('error', (err) => {
    file.destroy();
    fs.unlink(dest, () => {});
    handleInstallerFailure('Download error', {
      detail: err.message,
      emitNetworkError: true,
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
    path: '/control',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    timeout: 3000,
  };

  const req = http.request(options, (res) => {
    let data = '';
    res.on('data', (chunk) => { data += chunk; });
    res.on('end', () => {
      if (res.statusCode === 200 && data.includes('"response":"pong"')) {
        callback(true);
      } else {
        callback(false);
      }
    });
  });

  req.on('error', () => callback(false));
  req.on('timeout', () => { req.destroy(); callback(false); });
  req.write(JSON.stringify({ function: 'ping' }));
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

function killProcessesOnPort(port: number): void {
  try {
    let pids: string[] = [];

    if (isWindows) {
      try {
        const output = execSync(`netstat -ano | findstr :${port}`, {
          encoding: 'utf8',
          windowsHide: true,
        });
        const lines = output.split('\n').filter((line) => line.trim());
        for (const line of lines) {
          const parts = line.trim().split(/\s+/);
          const pid = parts[parts.length - 1];
          if (pid && /^\d+$/.test(pid)) {
            pids.push(pid);
          }
        }
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

function pythonFound(): void {
  if (pythonChildProcess && pythonChildProcess.exitCode === null) {
    log.info('Python backend already running, skipping restart');
    return;
  }

  log.info('Python found, starting backend...');

  killProcessesOnPort(PYTHON_BACKEND_PORT);

  if (isFirstTimeSetup) return;

  const settings = loadSettings();
  const pythonExecutable = resolvePythonExecutablePath();
  const serverPath = resolveExternalResourceFilePath('server.py');

  const llmEnabled = settings.llmEnabled !== false;
  const ocrEnabled = settings.ocrEnabled !== false;

  // Apply session-only Anki override if set
  const useAnki = ankiOverrideDisable ? false : settings.use_anki;

  // Reset Anki error flag for this launch
  lastExitWasAnkiError = false;
  ankiErrorSent = false;
  pendingAnkiError = null;
  pendingCriticalError = null;
  pendingStartupStatusMessage = null;
  let ankiErrorReason = '';
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
    if (module === 'anki' && msg.startsWith('ANKI_ERROR')) {
      lastExitWasAnkiError = true;
      ankiErrorReason = msg.replace('ANKI_ERROR', '').trim();
      if (!ankiErrorSent) {
        ankiErrorSent = true;
        getMainWindow()?.webContents.send(
          IPC_CHANNELS.ANKI_CONNECTION_ERROR,
          ankiErrorReason
        );
      }
    }
    forwardStatusToRenderer(msg);
  };

  const handleV1Record = (channel: string, message: string): void => {
    if (message.startsWith('ANKI_ERROR')) {
      lastExitWasAnkiError = true;
      ankiErrorReason = message.replace('ANKI_ERROR', '').trim();
    }
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
      const quitTokenMatch = line.match(/^::QUIT_TOKEN::([a-f0-9]+)$/);
      if (quitTokenMatch) {
        quitToken = quitTokenMatch[1];
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

  const handleClose = (code: number | null, signal: NodeJS.Signals | null): void => {
    lifecycleLog.info(`python exited code=${code ?? 'null'} signal=${signal ?? 'null'}`);
    pythonChildProcess = null;
    serverLoaded = false;
    quitToken = null;
    if (serverLoadCheckInterval) {
      clearTimeout(serverLoadCheckInterval);
      serverLoadCheckInterval = null;
    }

    if (lastExitWasAnkiError && !ankiErrorSent) {
      const reason = ankiErrorReason || 'connection_failed';
      pendingAnkiError = reason;
      pendingCriticalError = null;
      ankiErrorSent = true;
      getMainWindow()?.webContents.send(
        IPC_CHANNELS.ANKI_CONNECTION_ERROR,
        reason
      );
      return;
    }

    const errorMsg = buildCrashSummary(code, signal, recentLogTail);
    lifecycleLog.error(errorMsg);
    pendingCriticalError = errorMsg;
    pendingAnkiError = null;
    getMainWindow()?.webContents.send(
      IPC_CHANNELS.SERVER_CRITICAL_ERROR,
      errorMsg
    );
  };

  const args = [
    serverPath,
    settings.ankiConnectUrl,
    String(useAnki),
    settings.language,
    resPath,
    llmEnabled ? 'true' : 'false',
    ocrEnabled ? 'true' : 'false',
    userDataPath,
  ];

  if (isWindows) {
    // Use exec() on Windows — running through cmd.exe ensures proper
    // environment setup (PATH, DLL search paths) for native Python
    // modules (onnxruntime, OpenCV, paddlepaddle). spawn() breaks
    // DLL resolution for these modules in packaged builds.
    const command = [
      `"${pythonExecutable}"`,
      ...args.map(a => a.includes(' ') ? `"${a}"` : a),
    ].join(' ');

    pythonChildProcess = exec(command);
  } else {
    // Raise the per-process FD limit before exec-ing Python.
    // ML libs (torch, transformers, ONNX) open thousands of files;
    // the macOS default (256 for GUI apps) is far too low.
    const quotedArgs = args.map(a => `'${a.replace(/'/g, "'\\''")}'`).join(' ');
    pythonChildProcess = spawn('/bin/sh', [
      '-c',
      `ulimit -n 65536 2>/dev/null; exec env '${pythonExecutable}' ${quotedArgs}`,
    ], {
      env: process.env,
    });
  }

  startServerReadyPolling();

  pythonChildProcess.stdout?.on('data', handleSTDOUT);
  pythonChildProcess.stderr?.on('data', handleSTDERR);
  pythonChildProcess.on('close', handleClose);
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

export async function findPython(): Promise<boolean> {
  log.info('Finding Python...');

  const possibilities = [
    path.join(userDataPath, 'env', 'bin', 'python3'),
    path.join(userDataPath, 'env', 'python.exe'),
    path.join(process.resourcesPath, 'env', 'bin', 'python3'),
    path.join(resPath, 'env', 'bin', 'python3'),
    path.join(process.resourcesPath, 'env', 'python.exe'),
    path.join(resPath, 'env', 'python.exe'),
  ];

  for (const pythonPath of possibilities) {
    if (fs.existsSync(pythonPath)) {
      const healthy = await verifyPythonExecutable(pythonPath);
      if (healthy) {
        log.info('Python found and healthy at:', pythonPath);

        // Only enforce version check for Python installed in userData path
        // (persistent across app updates). Dev Python in project resources
        // doesn't have version tracking.
        if (pythonPath.startsWith(userDataPath)) {
          const installedVersion = getInstalledPythonVersion();
          const currentVersion = app.getVersion();
          if (installedVersion !== currentVersion) {
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

        pythonSuccessInstall = true;
        pythonFound();
        return true;
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
  installInProgress = true;
  pythonSuccessInstall = false;

  const selectedComponents = ['Python runtime'];
  if (options.includeLLM) selectedComponents.push('Local language model support');
  if (options.includeOCR) selectedComponents.push('OCR reader support');
  if (options.includeVoice) selectedComponents.push('Voice & TTS support');
  log.info('Installing:', selectedComponents.join(', '));

  try {
    getCurrentWindow()?.webContents.send(IPC_CHANNELS.INSTALL_STARTED, options);
  } catch (e) {
    log.error("error", e);
  }

  sendStatusUpdate('Downloading Python...');

  // Clean up previous installation attempts
  try {
    if (fs.existsSync(downloadPath)) fs.unlinkSync(downloadPath);
    if (fs.existsSync(envPath)) fs.rmSync(envPath, { recursive: true, force: true });
  } catch (e) {
    log.warn('Cleanup failed:', e);
  }

  const pipRequirements = buildPipRequirementList(options);
  log.info('Pip packages:', pipRequirements.join(', '));

  const pythonUrl = getPythonDownloadUrl(PYTHON_DOWNLOAD_BASE);

  // Start download
  downloadFile(pythonUrl, downloadPath, async () => {
    sendStatusUpdate('Download complete, extracting...');
    
    try {
      fs.mkdirSync(extractPath, { recursive: true });
      await extractFile(downloadPath, extractPath);
      sendStatusUpdate('Extraction complete, installing libraries...');

      if (pipRequirements.length === 0) {
        installInProgress = false;
        pythonSuccessInstall = true;
        pythonFound();
        return;
      }

      const pipExecutable = resolvePipExecutablePath();
      const pipArgs = isWindows ? ['-m', 'pip', 'install', ...pipRequirements] : ['install', ...pipRequirements];

      const pipProcess = spawn(isWindows ? resolvePythonExecutablePath() : pipExecutable, pipArgs, {
        cwd: envPath,
      });
      activePipProcess = pipProcess;

      const seenPackages = new Set<string>();
      let pipOutputBuffer = '';

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
            // Filter out pip's non-error stderr (e.g. deprecation warnings, "already satisfied" notices)
            const lower = trimmed.toLowerCase();
            if (lower.includes('warning') && !lower.includes('error')) {
              sendStatusUpdate(trimmed);
              continue;
            }
            sendStatusUpdate(`ERROR: ${trimmed}`);
          } else {
            sendStatusUpdate(trimmed);
          }

          const progress = parsePipLine(trimmed, seenPackages);
          if (progress) {
            sendPipProgress(progress);
          }
        }
      };

      pipProcess.stdout.on('data', (data) => {
        log.info('pip:', data.toString());
        processPipLines(data.toString(), false);
      });

      pipProcess.stderr.on('data', (data) => {
        log.error('pip error:', data.toString());
        processPipLines(data.toString(), true);
      });

      pipProcess.on('close', async (code) => {
        activePipProcess = null;
        installInProgress = false;
        if (code === 0 || code === null) {
          sendStatusUpdate('Verifying installation...');
          const verified = await verifyPythonInstallation(options);
          if (verified) {
            log.info('Installation complete');
            pythonSuccessInstall = true;
            setInstalledPythonVersion(app.getVersion());
            sendStatusUpdate('Installation complete');
          } else {
            log.error('Installation verification failed');
            waitingForInstallChoice = true;
            sendStatusUpdate('ERROR: Installation verification failed');
            getCurrentWindow()?.webContents.send(IPC_CHANNELS.INSTALLER_AWAITING_CHOICE);
          }
        } else {
          log.error('pip install failed with code:', code);
          waitingForInstallChoice = true;
          sendStatusUpdate(`ERROR: pip exited with code ${code}`);
          getCurrentWindow()?.webContents.send(IPC_CHANNELS.INSTALLER_AWAITING_CHOICE);
        }
      });
    } catch (error) {
      log.error('Extraction/installation failed:', error);
      handleInstallerFailure('Installation failed', {
        detail: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });
}

// Terminate Python backend
export function terminatePythonBackend(): void {
  if (!pythonChildProcess) return;

  // Try graceful shutdown
  try {
    pythonChildProcess.kill('SIGINT');
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
    if (pythonChildProcess && !pythonChildProcess.killed) {
      try { pythonChildProcess.kill('SIGTERM'); } catch (e) {
        log.error("error", e);
      }
    }
    setTimeout(() => {
      if (pythonChildProcess && !pythonChildProcess.killed) {
        try { pythonChildProcess.kill('SIGKILL'); } catch (e) {
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
  
  // Terminate existing process
  terminatePythonBackend();
  
  // Wait for the process to fully terminate before respawning
  const waitForExit = (attempts: number): void => {
    if (attempts <= 0 || !pythonChildProcess || pythonChildProcess.killed) {
      pythonChildProcess = null;
      // Re-launch the backend
      pythonFound();
      return;
    }
    setTimeout(() => waitForExit(attempts - 1), 200);
  };
  
  waitForExit(10); // up to 2 seconds
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

    if (!serverLoaded && pendingAnkiError) {
      // Re-send buffered Anki error (renderer may have mounted after the event)
      event.sender.send(IPC_CHANNELS.ANKI_CONNECTION_ERROR, pendingAnkiError);
    } else if (!serverLoaded && pendingCriticalError) {
      // Re-send buffered critical error
      event.sender.send(IPC_CHANNELS.SERVER_CRITICAL_ERROR, pendingCriticalError);
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

  ipcMain.on(IPC_CHANNELS.RESTART_BACKEND_ANKI_OVERRIDE, (_event, disableAnki: boolean) => {
    ankiOverrideDisable = disableAnki;
    restartPythonBackend();
  });
}
