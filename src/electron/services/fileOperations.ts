/**
 * File Operations IPC Handlers
 * Handles reading files from the filesystem for the renderer process
 */

import { ipcMain } from 'electron';
import { promises as fs } from 'fs';
import * as path from 'path';
import { IPC_CHANNELS } from '../../shared/constants';

// Image file extensions to read from directories
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.tiff', '.tif']);

/**
 * Setup IPC handlers for file operations
 */
export function setupFileOperationsIPC(): void {
  // Read all image files from a directory
  ipcMain.handle(IPC_CHANNELS.READ_DIRECTORY_IMAGES, async (_event, directoryPath: string) => {
    try {
      const entries = await fs.readdir(directoryPath, { withFileTypes: true });
      
      const imageFiles = entries
        .filter(entry => entry.isFile() && IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
      
      const files = await Promise.all(
        imageFiles.map(async (entry) => {
          const filePath = path.join(directoryPath, entry.name);
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
      console.error('[FileOps] Failed to read directory:', error);
      throw error;
    }
  });

  // Read a PDF file
  ipcMain.handle(IPC_CHANNELS.READ_PDF_FILE, async (_event, filePath: string) => {
    try {
      const data = await fs.readFile(filePath);
      return { data: data.buffer };
    } catch (error) {
      console.error('[FileOps] Failed to read PDF file:', error);
      throw error;
    }
  });
}
