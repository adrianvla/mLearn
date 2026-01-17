/**
 * Python Backend Service
 * Handles downloading, installing, and managing the Python backend
 */

import fs from 'fs';
import path from 'path';
import https from 'https';
import http from 'http';
import { spawn, exec, ChildProcess } from 'child_process';
import { ipcMain } from 'electron';
import * as tar from 'tar';
import { IPC_CHANNELS, PYTHON_BACKEND_PORT, PYTHON_DOWNLOAD_BASE } from '../../shared/constants';
import type { InstallOptions, InstallerState, PipRequirementsConfig } from '../../shared/types';
import { 
  getResourcePath, 
  getAppPath, 
  getUserDataPath,
  getPythonExecutablePath, 
  getPipExecutablePath, 
  getPythonDownloadUrl,
  isWindows 
} from '../utils/platform';
import { loadSettings } from './settings';
import { getCurrentWindow, getMainWindow, createMainWindow } from './windowManager';

// State
let pythonChildProcess: ChildProcess | null = null;
let pythonSuccessInstall = false;
let isFirstTimeSetup = false;
let serverLoaded = false;
let installInProgress = false;
let waitingForInstallChoice = false;
let pendingInstallOptions: InstallOptions = { includeLLM: true, includeOCR: true };
let serverLoadCheckInterval: NodeJS.Timeout | null = null;

// Paths
const resPath = getResourcePath();
const downloadPath = path.join(resPath, 'python.tar.gz');
const extractPath = path.join(resPath, 'py');
const envPath = path.join(resPath, 'env');

// Getters
export function isServerLoaded(): boolean {
  return serverLoaded;
}

export function getPythonProcess(): ChildProcess | null {
  return pythonChildProcess;
}

// Send status update to current window
function sendStatusUpdate(message: string): void {
  try {
    getCurrentWindow()?.webContents.send(IPC_CHANNELS.SERVER_STATUS_UPDATE, message);
  } catch (e) {
    console.error('Failed to send status update:', e);
  }
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
    } catch (e) { /* ignore */ }
  }

  try {
    getCurrentWindow()?.webContents.send(IPC_CHANNELS.INSTALLER_AWAITING_CHOICE);
  } catch (e) { /* ignore */ }
}

// Load pip requirements config
function loadPipRequirementsConfig(): PipRequirementsConfig {
  const appPath = getAppPath();
  const configPath = path.join(appPath, 'pip_requirements.json');
  
  try {
    const data = fs.readFileSync(configPath, 'utf-8');
    return JSON.parse(data);
  } catch (e) {
    console.error('Failed to load pip requirements config:', e);
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
  
  return packages;
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
      downloadFile(redirectUrl, dest, callback, redirectCount + 1);
      return;
    }

    if (response.statusCode !== 200) {
      file.destroy();
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
        console.log('Download complete!');
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
  req.write(JSON.stringify({ function: 'ping' }));
  req.end();
}

function startServerReadyPolling(): void {
  if (serverLoadCheckInterval) {
    clearInterval(serverLoadCheckInterval);
  }

  serverLoadCheckInterval = setInterval(() => {
    if (serverLoaded) {
      clearInterval(serverLoadCheckInterval!);
      serverLoadCheckInterval = null;
      return;
    }

    pingPythonServer((running) => {
      if (!running) return;

      serverLoaded = true;
      getMainWindow()?.webContents.send(IPC_CHANNELS.SERVER_LOAD, 'Python server running');
      if (serverLoadCheckInterval) {
        clearInterval(serverLoadCheckInterval);
        serverLoadCheckInterval = null;
      }
    });
  }, 750);
}

// Start Python backend
function pythonFound(): void {
  console.log('Python found, starting backend...');
  
  if (isFirstTimeSetup) return;

  const settings = loadSettings();
  const pythonExecutable = getPythonExecutablePath();
  const serverPath = path.join(resPath, 'server.py');
  const userDataPath = getUserDataPath();

  const llmEnabled = settings.llmEnabled !== false;
  const ocrEnabled = settings.ocrEnabled !== false;

  const handleSTDOUT = (data: Buffer): void => {
    const text = data.toString('utf8');
    console.log('Python:', text);

    const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
    for (const line of lines) {
      if (line.startsWith('::STATUS::')) {
        const parts = line.substring('::STATUS::'.length).split('::');
        if (parts.length >= 3) {
          const channel = parts[0];
          const message = parts.slice(2).join('::');
          
          try {
            if (channel.startsWith('OCR')) {
              getMainWindow()?.webContents.send(IPC_CHANNELS.OCR_STATUS_UPDATE, message);
            }
            getMainWindow()?.webContents.send(IPC_CHANNELS.SERVER_STATUS_UPDATE, message);
          } catch (e) { /* ignore */ }
          continue;
        }
      }
      try {
        getMainWindow()?.webContents.send(IPC_CHANNELS.SERVER_STATUS_UPDATE, line);
      } catch (e) { /* ignore */ }
    }
  };

  const handleSTDERR = (data: Buffer): void => {
    console.error('Python stderr:', data.toString());
    try {
      getMainWindow()?.webContents.send(IPC_CHANNELS.SERVER_STATUS_UPDATE, 'stderr: ' + data.toString('utf8'));
    } catch (e) { /* ignore */ }
  };

  const handleClose = (code: number | null): void => {
    console.log(`Python process exited with code ${code}`);
    serverLoaded = false;
    if (serverLoadCheckInterval) {
      clearInterval(serverLoadCheckInterval);
      serverLoadCheckInterval = null;
    }
    getMainWindow()?.webContents.send(
      IPC_CHANNELS.SERVER_CRITICAL_ERROR,
      `Critical error: Python server stopped (exit code: ${code}). App restart may be required.`
    );
  };

  const args = [
    serverPath,
    settings.ankiConnectUrl,
    String(settings.use_anki),
    settings.language,
    resPath,
    llmEnabled ? 'true' : 'false',
    ocrEnabled ? 'true' : 'false',
    userDataPath,
  ];

  if (isWindows) {
    const command = [
      `"${pythonExecutable}"`,
      ...args.map(a => a.includes(' ') ? `"${a}"` : a),
    ].join(' ');
    
    pythonChildProcess = exec(command);
  } else {
    pythonChildProcess = spawn('env', [pythonExecutable, ...args], {
      env: process.env,
    });
  }

  startServerReadyPolling();

  pythonChildProcess.stdout?.on('data', handleSTDOUT);
  pythonChildProcess.stderr?.on('data', handleSTDERR);
  pythonChildProcess.on('close', handleClose);
}

// Find Python installation
export async function findPython(): Promise<boolean> {
  console.log('Finding Python...');

  const possibilities = [
    path.join(process.resourcesPath, 'env', 'bin', 'python3'),
    path.join(resPath, 'env', 'bin', 'python3'),
    path.join(process.resourcesPath, 'env', 'python.exe'),
    path.join(resPath, 'env', 'python.exe'),
  ];

  for (const pythonPath of possibilities) {
    if (fs.existsSync(pythonPath)) {
      console.log('Python found at:', pythonPath);
      pythonSuccessInstall = true;
      pythonFound();
      return true;
    }
  }

  console.log('Python not found, starting installer...');
  waitingForInstallChoice = true;
  isFirstTimeSetup = true;
  
  sendStatusUpdate('Select the components you want and click Install to continue.');
  try {
    getCurrentWindow()?.webContents.send(IPC_CHANNELS.INSTALLER_AWAITING_CHOICE);
  } catch (e) { /* ignore */ }

  return false;
}

// Start Python installation
export function startPythonInstall(options: InstallOptions): void {
  if (installInProgress) {
    console.warn('Installation already in progress');
    return;
  }

  pendingInstallOptions = options;
  waitingForInstallChoice = false;
  installInProgress = true;
  pythonSuccessInstall = false;

  const selectedComponents = ['Python runtime'];
  if (options.includeLLM) selectedComponents.push('Local language model support');
  if (options.includeOCR) selectedComponents.push('OCR reader support');
  console.log('Installing:', selectedComponents.join(', '));

  try {
    getCurrentWindow()?.webContents.send(IPC_CHANNELS.INSTALL_STARTED, options);
  } catch (e) { /* ignore */ }

  sendStatusUpdate('Downloading Python...');

  // Clean up previous installation attempts
  try {
    if (fs.existsSync(downloadPath)) fs.unlinkSync(downloadPath);
    if (fs.existsSync(envPath)) fs.rmSync(envPath, { recursive: true, force: true });
  } catch (e) {
    console.warn('Cleanup failed:', e);
  }

  const pipRequirements = buildPipRequirementList(options);
  console.log('Pip packages:', pipRequirements.join(', '));

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

      const pipExecutable = getPipExecutablePath();
      const pipArgs = isWindows ? ['-m', 'pip', 'install', ...pipRequirements] : ['install', ...pipRequirements];

      const pipProcess = spawn(isWindows ? getPythonExecutablePath() : pipExecutable, pipArgs, {
        cwd: envPath,
      });

      pipProcess.stdout.on('data', (data) => {
        console.log('pip:', data.toString());
        sendStatusUpdate(data.toString());
      });

      pipProcess.stderr.on('data', (data) => {
        console.error('pip error:', data.toString());
        sendStatusUpdate(`ERROR: ${data.toString()}`);
      });

      pipProcess.on('close', (code) => {
        installInProgress = false;
        if (code === 0 || code === null) {
          console.log('Installation complete');
          sendStatusUpdate('Installation complete');
          pythonSuccessInstall = true;
          pythonFound();
          
          // Transition to main window
          getCurrentWindow()?.close();
          createMainWindow();
        } else {
          console.error('pip install failed with code:', code);
          waitingForInstallChoice = true;
          sendStatusUpdate(`ERROR: pip exited with code ${code}`);
          getCurrentWindow()?.webContents.send(IPC_CHANNELS.INSTALLER_AWAITING_CHOICE);
        }
      });
    } catch (error) {
      console.error('Extraction/installation failed:', error);
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
    console.warn('Failed to SIGINT python:', e);
  }

  // Send quit request to server
  const options = {
    hostname: '127.0.0.1',
    port: PYTHON_BACKEND_PORT,
    path: '/quit',
    method: 'POST',
    timeout: 2000,
  };

  const req = http.request(options);
  req.on('error', () => { /* ignore */ });
  req.end();

  // Force kill after timeout
  setTimeout(() => {
    if (pythonChildProcess && !pythonChildProcess.killed) {
      try { pythonChildProcess.kill('SIGTERM'); } catch (e) { /* ignore */ }
    }
    setTimeout(() => {
      if (pythonChildProcess && !pythonChildProcess.killed) {
        try { pythonChildProcess.kill('SIGKILL'); } catch (e) { /* ignore */ }
      }
    }, 400);
  }, 400);
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
  });

  ipcMain.on(IPC_CHANNELS.START_INSTALL, (_event, rawOptions) => {
    const options = rawOptions && typeof rawOptions === 'object' ? rawOptions : {};
    startPythonInstall({
      includeLLM: options.includeLLM ?? true,
      includeOCR: options.includeOCR ?? true,
    });
  });

  ipcMain.on(IPC_CHANNELS.INSTALLER_STATE_REQUEST, (event) => {
    event.reply(IPC_CHANNELS.INSTALLER_STATE, {
      waiting: waitingForInstallChoice,
      inProgress: installInProgress,
      success: pythonSuccessInstall,
      options: pendingInstallOptions,
    } as InstallerState);
  });
}
