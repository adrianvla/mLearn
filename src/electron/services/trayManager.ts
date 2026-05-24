import { Tray, Menu, BrowserWindow, app } from 'electron';
import path from 'path';
import fs from 'fs';
import { isMac, isWindows, isPackaged, getResourcePath } from '../utils/platform';
import { getLogger } from '../../shared/utils/logger';

const log = getLogger('electron.tray');

let tray: Tray | null = null;
let mainWindowRef: BrowserWindow | null = null;

function getTrayIconPath(): string {
  const resourcePath = getResourcePath();
  if (isWindows) {
    const icoPath = path.join(resourcePath, 'icon.ico');
    if (isPackaged || fs.existsSync(icoPath)) return icoPath;
    return path.join(resourcePath, 'build', 'icon.ico');
  }
  const pngPath = path.join(resourcePath, 'icons', '16x16.png');
  if (isPackaged || fs.existsSync(pngPath)) return pngPath;
  return path.join(resourcePath, 'build', 'icons', '16x16.png');
}

function buildContextMenu(): Menu {
  return Menu.buildFromTemplate([
    {
      label: 'Show mLearn',
      click: () => {
        showMainWindow();
      },
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        (app as any).isQuitting = true;
        app.quit();
      },
    },
  ]);
}

function showMainWindow(): void {
  const win = mainWindowRef;
  if (!win || win.isDestroyed()) return;

  if (win.isMinimized()) {
    win.restore();
  }
  win.show();
  win.focus();
}

function toggleWindow(): void {
  const win = mainWindowRef;
  if (!win || win.isDestroyed()) return;

  if (win.isVisible()) {
    win.hide();
  } else {
    showMainWindow();
  }
}

export function createTray(mainWindow: BrowserWindow): void {
  if (isMac) return;

  mainWindowRef = mainWindow;

  const iconPath = getTrayIconPath();

  try {
    const { nativeImage } = require('electron');
    const icon = nativeImage.createFromPath(iconPath);
    if (icon.isEmpty()) {
      log.warn(`Tray icon not found at ${iconPath}, skipping tray creation`);
      return;
    }

    tray = new Tray(icon);
    tray.setToolTip('mLearn');
    tray.setContextMenu(buildContextMenu());

    tray.on('click', () => {
      toggleWindow();
    });

    tray.on('double-click', () => {
      showMainWindow();
    });

    log.info('Tray created');
  } catch {
    log.warn(`Failed to load tray icon from ${iconPath}, skipping tray creation`);
  }
}

export function destroyTray(): void {
  if (tray && !tray.isDestroyed()) {
    tray.destroy();
    tray = null;
    log.info('Tray destroyed');
  }
}

export function hasTray(): boolean {
  return tray !== null && !tray.isDestroyed();
}
