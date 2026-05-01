/**
 * File Operations IPC Handlers
 * Handles reading files from the filesystem for the renderer process
 */

import { ipcMain, dialog, BrowserWindow, app } from 'electron';
import { promises as fs } from 'fs';
import * as path from 'path';
import { IPC_CHANNELS } from '../../shared/constants';
import { getLogger } from '../../shared/utils/logger';

const log = getLogger('electron.fileOperations');

// Image file extensions to read from directories
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.tiff', '.tif']);

function validatePath(inputPath: string): string {
  const resolved = path.resolve(inputPath);
  const homeDir = app.getPath('home');
  if (!resolved.startsWith(homeDir)) {
    throw new Error('Path outside allowed directory');
  }
  return resolved;
}

/**
 * Setup IPC handlers for file operations
 */
export function setupFileOperationsIPC(): void {
  // Read all image files from a directory
  ipcMain.handle(IPC_CHANNELS.READ_DIRECTORY_IMAGES, async (_event, directoryPath: string) => {
    try {
      const validatedPath = validatePath(directoryPath);
      const entries = await fs.readdir(validatedPath, { withFileTypes: true });
      
      const imageFiles = entries
        .filter(entry => entry.isFile() && IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
      
      const files = await Promise.all(
        imageFiles.map(async (entry) => {
          const filePath = path.join(validatedPath, entry.name);
          const data = await fs.readFile(filePath);
          return {
            name: entry.name,
            path: filePath,
            data: data.buffer,
          };
        })
      );
      
      return { files };
    } catch (error) {
      log.error('[FileOps] Failed to read directory:', error);
      throw error;
    }
  });

  // Read a PDF file
  ipcMain.handle(IPC_CHANNELS.READ_PDF_FILE, async (_event, filePath: string) => {
    try {
      const validatedPath = validatePath(filePath);
      const data = await fs.readFile(validatedPath);
      return { data: data.buffer };
    } catch (error) {
      log.error('[FileOps] Failed to read PDF file:', error);
      throw error;
    }
  });

  // Select a video file
  ipcMain.handle(IPC_CHANNELS.SELECT_VIDEO_FILE, async () => {
    const focusedWindow = BrowserWindow.getFocusedWindow();
    const result = await dialog.showOpenDialog({
      ...(focusedWindow ? { browserWindow: focusedWindow } : {}),
      properties: ['openFile'],
      filters: [
        { name: 'Video Files', extensions: ['mp4', 'mkv', 'avi', 'webm', 'mov', 'flv', 'wmv', 'm4v', 'mpg', 'mpeg', 'ogv'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    } as Electron.OpenDialogOptions);
    return result.canceled ? null : result.filePaths[0] ?? null;
  });

  // Select a subtitle file
  ipcMain.handle(IPC_CHANNELS.SELECT_SUBTITLE_FILE, async () => {
    const focusedWindow = BrowserWindow.getFocusedWindow();
    const result = await dialog.showOpenDialog({
      ...(focusedWindow ? { browserWindow: focusedWindow } : {}),
      properties: ['openFile'],
      filters: [
        { name: 'Subtitle Files', extensions: ['srt', 'vtt', 'ass', 'ssa'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    } as Electron.OpenDialogOptions);
    return result.canceled ? null : result.filePaths[0] ?? null;
  });

  // Select a book folder (directory of images)
  ipcMain.handle(IPC_CHANNELS.SELECT_BOOK_FOLDER, async () => {
    const focusedWindow = BrowserWindow.getFocusedWindow();
    const result = await dialog.showOpenDialog({
      ...(focusedWindow ? { browserWindow: focusedWindow } : {}),
      properties: ['openDirectory'],
    } as Electron.OpenDialogOptions);
    return result.canceled ? null : result.filePaths[0] ?? null;
  });

  // Select a PDF file
  ipcMain.handle(IPC_CHANNELS.SELECT_PDF_FILE, async () => {
    const focusedWindow = BrowserWindow.getFocusedWindow();
    const result = await dialog.showOpenDialog({
      ...(focusedWindow ? { browserWindow: focusedWindow } : {}),
      properties: ['openFile'],
      filters: [
        { name: 'PDF Files', extensions: ['pdf'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    } as Electron.OpenDialogOptions);
    return result.canceled ? null : result.filePaths[0] ?? null;
  });

  ipcMain.handle(IPC_CHANNELS.SELECT_BROWSER_FILE, async () => {
    const focusedWindow = BrowserWindow.getFocusedWindow();
    const result = await dialog.showOpenDialog({
      ...(focusedWindow ? { browserWindow: focusedWindow } : {}),
      properties: ['openFile'],
    } as Electron.OpenDialogOptions);
    return result.canceled ? null : result.filePaths[0] ?? null;
  });

  ipcMain.handle(IPC_CHANNELS.READ_MEDIA_FILE, async (_event, filePath: string) => {
    try {
      const resolved = path.resolve(filePath);
      if (!path.isAbsolute(resolved)) return null;
      const data = await fs.readFile(resolved);
      return data.buffer;
    } catch (e) {
      log.error('READ_MEDIA_FILE failed', e);
      return null;
    }
  });
}
