/** Standalone static startup window. This module must remain cheap to import. */
import { app, BrowserWindow } from 'electron';
import path from 'path';

export type StartupPhase = 'starting' | 'inspection' | 'snapshot' | 'database' | 'python' | 'preparation';

const PHASES: ReadonlyArray<{ id: StartupPhase; weight: number; label: string }> = [
  { id: 'starting', weight: 5, label: 'Starting mLearn' },
  { id: 'inspection', weight: 20, label: 'Checking library' },
  { id: 'snapshot', weight: 15, label: 'Creating recovery snapshot' },
  { id: 'database', weight: 25, label: 'Opening and verifying database' },
  { id: 'python', weight: 20, label: 'Starting Python tools' },
  { id: 'preparation', weight: 15, label: 'Preparing mLearn' },
];

let splash: BrowserWindow | null = null;
let loaded = false;
let currentPhase: StartupPhase = 'starting';
let progress = 0;
let status = PHASES[0].label;

export function getSplashWindow(): BrowserWindow | null {
  return splash;
}

function htmlPath(): string {
  const root = app.isPackaged
    ? path.join(app.getAppPath(), 'dist')
    : path.join(__dirname, '..', '..', 'src', 'html');
  return app.isPackaged ? path.join(root, 'src', 'html', 'splash.html') : path.join(root, 'splash.html');
}

function paint(): void {
  if (!splash || splash.isDestroyed() || !loaded) return;
  const payload = JSON.stringify({ status, progress });
  try {
    void splash.webContents.executeJavaScript(`window.updateStartup(${payload})`).catch(() => {
      // The window may have closed between scheduling and execution.
    });
  } catch {
    // A display failure must never interrupt Guardian's recovery checkpoints.
  }
}

/** Resolves after the static page is painted and visible. */
export function createSplashWindow(): Promise<void> {
  if (splash && !splash.isDestroyed()) return Promise.resolve();
  loaded = false;
  splash = new BrowserWindow({
    width: 560,
    height: 310,
    frame: false,
    resizable: false,
    maximizable: false,
    backgroundColor: '#11191d',
    show: false,
    center: true,
    autoHideMenuBar: true,
    skipTaskbar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  const window = splash;
  window.on('closed', () => { if (splash === window) splash = null; });
  return new Promise<void>((resolve, reject) => {
    window.once('ready-to-show', () => {
      if (!window.isDestroyed()) window.show();
      resolve();
    });
    void window.loadFile(htmlPath()).then(() => {
      loaded = true;
      paint();
    }).catch(reject);
  });
}

/** Progress is the sum of completed phase weights plus this phase's fraction. */
export function reportStartupPhase(phase: StartupPhase, fraction = 0, message?: string): void {
  const index = PHASES.findIndex((item) => item.id === phase);
  if (index < 0) return;
  const weighted = PHASES.slice(0, index).reduce((sum, item) => sum + item.weight, 0)
    + PHASES[index].weight * Math.max(0, Math.min(1, fraction));
  if (weighted < progress) {
    if (phase === currentPhase && message) {
      status = message;
      paint();
    }
    return;
  }
  currentPhase = phase;
  progress = weighted;
  status = message ?? PHASES[index].label;
  paint();
}

export function completeStartup(): void {
  reportStartupPhase('preparation', 1, 'mLearn is ready');
}

export function closeSplashWindow(): void {
  if (splash && !splash.isDestroyed()) splash.close();
  splash = null;
  loaded = false;
}
