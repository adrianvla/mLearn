/**
 * Diagnostics Service — Main Process Entry Point
 * Imports all test suites and sets up IPC for the diagnostics window.
 */

import { ipcMain, BrowserWindow } from 'electron';
import { DIAGNOSTICS_IPC } from '../../../shared/diagnostics/constants';
import { runAllDiagnostics, getCurrentDiagnosticsReport } from './runner';
import { getLogger } from '../../../shared/utils/logger';
import fs from 'fs';
import path from 'path';
import { app } from 'electron';

// Import all test suites to register them
import './suites/backendHealth';
import './suites/dictionary';
import './suites/llm';
import './suites/ocr';
import './suites/ocrModels';
import './suites/voice';
import './suites/cloud';
import './suites/mediaProtocols';
import './suites/storage';
import './suites/anki';
import './suites/browserExt';
import './suites/plugins';
import './suites/windows';
import './suites/watchTogether';

const log = getLogger('electron.diagnostics');

export function setupDiagnosticsIPC(): void {
  let runningWindow: BrowserWindow | null = null;

  ipcMain.handle(DIAGNOSTICS_IPC.RUN_ALL_TESTS, async (_event) => {
    // Find the diagnostics window to send progress to
    const { BrowserWindow } = require('electron');
    const windows = BrowserWindow.getAllWindows();
    runningWindow = windows.find((w: BrowserWindow) => {
      const title = w.getTitle();
      return title.toLowerCase().includes('diagnostics') || title.toLowerCase().includes('test');
    }) || windows[0] || null;

    try {
      const report = await runAllDiagnostics(runningWindow);
      return report;
    } catch (err) {
      log.error('Diagnostics run failed:', err);
      throw err;
    }
  });

  ipcMain.handle(DIAGNOSTICS_IPC.GET_REPORT, async () => {
    return getCurrentDiagnosticsReport();
  });

  ipcMain.handle(DIAGNOSTICS_IPC.SAVE_REPORT, async (_event, reportJson: string) => {
    const downloadsPath = path.join(app.getPath('downloads'), `mlearn-diagnostics-${Date.now()}.json`);
    fs.writeFileSync(downloadsPath, reportJson, 'utf-8');
    return downloadsPath;
  });
}
