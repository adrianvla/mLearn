import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTempDir, type TempDir } from '../../../test/helpers/tempDir';
import path from 'path';
import fs from 'fs';

const mockIpcHandlers = new Map<string, Function>();

let tempDir: TempDir;

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: Function) => {
      mockIpcHandlers.set(channel, handler);
    }),
    removeHandler: vi.fn(),
  },
  dialog: {
    showSaveDialog: vi.fn(),
    showOpenDialog: vi.fn(),
  },
  BrowserWindow: {
    getFocusedWindow: vi.fn(() => null),
  },
  app: {
    getPath: vi.fn(() => tempDir?.tmpDir ?? '/tmp/mock-userdata'),
  },
}));

vi.mock('../utils/platform', () => ({
  getUserDataPath: vi.fn(() => tempDir?.tmpDir ?? '/tmp/mock-userdata'),
  getAppPath: vi.fn(() => tempDir?.tmpDir ?? '/tmp/mock-userdata'),
  getResourcePath: vi.fn(() => tempDir?.tmpDir ?? '/tmp/mock-userdata'),
}));

interface MockEntry {
  entryName: string;
  isDirectory: boolean;
  getData: () => Buffer;
}

interface AdmZipInstance {
  getAddedFiles: () => Array<{ localPath: string; zipPath: string }>;
  getWrittenTo: () => string | null;
  getEntries: () => MockEntry[];
}

const admZipState = {
  nextEntries: [] as MockEntry[],
  instances: [] as AdmZipInstance[],
};

vi.mock('adm-zip', () => {
  class AdmZipMock {
    private addedFiles: Array<{ localPath: string; zipPath: string }> = [];
    private writtenTo: string | null = null;
    private entries: MockEntry[];

    constructor(zipPath?: string) {
      this.entries = zipPath ? admZipState.nextEntries.slice() : [];
      admZipState.instances.push(this);
    }

    addLocalFile(localPath: string, zipDir?: string): void {
      this.addedFiles.push({ localPath, zipPath: zipDir ?? '' });
    }

    getAddedFiles() {
      return this.addedFiles;
    }

    writeZip(targetPath: string): void {
      this.writtenTo = targetPath;
      fs.writeFileSync(targetPath, Buffer.from('fake-zip-content'));
    }

    getWrittenTo() {
      return this.writtenTo;
    }

    getEntries(): MockEntry[] {
      return this.entries;
    }
  }

  return { default: AdmZipMock };
});

describe('dataExportImport', () => {
  let setupDataExportImportIPC: () => void;

  beforeEach(async () => {
    tempDir = createTempDir('mlearn-export-test-');

    admZipState.nextEntries = [];
    admZipState.instances = [];

    mockIpcHandlers.clear();
    vi.resetModules();

    const mod = await import('./dataExportImport');
    setupDataExportImportIPC = mod.setupDataExportImportIPC;
  });

  afterEach(() => {
    tempDir.cleanup();
  });

  describe('setupDataExportImportIPC', () => {
    it('registers data-export and data-import handlers', () => {
      setupDataExportImportIPC();
      expect(mockIpcHandlers.has('data-export')).toBe(true);
      expect(mockIpcHandlers.has('data-import')).toBe(true);
    });
  });

  describe('data-export handler', () => {
    beforeEach(() => {
      setupDataExportImportIPC();
    });

    it('returns success with filePath when export completes', async () => {
      const outputZip = path.join(tempDir.tmpDir, 'export.zip');
      const { dialog } = await import('electron');
      vi.mocked(dialog.showSaveDialog).mockResolvedValue({ canceled: false, filePath: outputZip });

      fs.writeFileSync(path.join(tempDir.tmpDir, 'settings.json'), '{}');

      const handler = mockIpcHandlers.get('data-export');
      const result = await handler!({});

      expect(result.success).toBe(true);
      expect(result.filePath).toBe(outputZip);
    });

    it('returns success true with null filePath when dialog is canceled', async () => {
      const { dialog } = await import('electron');
      vi.mocked(dialog.showSaveDialog).mockResolvedValue({ canceled: true, filePath: '' });

      const handler = mockIpcHandlers.get('data-export');
      const result = await handler!({});

      expect(result.success).toBe(true);
      expect(result.filePath).toBeNull();
    });

    it('skips missing data files gracefully', async () => {
      const outputZip = path.join(tempDir.tmpDir, 'skip-missing.zip');
      const { dialog } = await import('electron');
      vi.mocked(dialog.showSaveDialog).mockResolvedValue({ canceled: false, filePath: outputZip });

      const handler = mockIpcHandlers.get('data-export');
      const result = await handler!({});

      expect(result.success).toBe(true);
    });

    it('includes existing data files in the zip', async () => {
      const outputZip = path.join(tempDir.tmpDir, 'with-files.zip');
      const { dialog } = await import('electron');
      vi.mocked(dialog.showSaveDialog).mockResolvedValue({ canceled: false, filePath: outputZip });

      fs.writeFileSync(path.join(tempDir.tmpDir, 'settings.json'), '{"lang":"en"}');
      fs.writeFileSync(path.join(tempDir.tmpDir, 'flashcards.json'), '{}');

      const handler = mockIpcHandlers.get('data-export');
      await handler!({});

      const inst = admZipState.instances[admZipState.instances.length - 1];
      const addedPaths = inst.getAddedFiles().map(f => f.localPath);
      expect(addedPaths.some(p => p.endsWith('settings.json'))).toBe(true);
      expect(addedPaths.some(p => p.endsWith('flashcards.json'))).toBe(true);
    });

    it('returns success false with error when zip write throws', async () => {
      const { dialog } = await import('electron');
      vi.mocked(dialog.showSaveDialog).mockResolvedValue({ canceled: false, filePath: '/unwritable/definitely-no-such-dir/out.zip' });

      const handler = mockIpcHandlers.get('data-export');
      const result = await handler!({});

      expect(result.success).toBe(false);
      expect(typeof result.error).toBe('string');
    });
  });

  describe('data-import handler', () => {
    beforeEach(() => {
      setupDataExportImportIPC();
    });

    it('returns success false when dialog is canceled', async () => {
      const { dialog } = await import('electron');
      vi.mocked(dialog.showOpenDialog).mockResolvedValue({ canceled: true, filePaths: [] });

      const handler = mockIpcHandlers.get('data-import');
      const result = await handler!({});

      expect(result.success).toBe(false);
    });

    it('returns success true and extracts known files from a valid zip', async () => {
      const zipPath = path.join(tempDir.tmpDir, 'import.zip');
      fs.writeFileSync(zipPath, Buffer.from('placeholder'));

      const { dialog } = await import('electron');
      vi.mocked(dialog.showOpenDialog).mockResolvedValue({ canceled: false, filePaths: [zipPath] });

      const settingsData = Buffer.from('{"lang":"ja"}');
      admZipState.nextEntries = [
        { entryName: 'settings.json', isDirectory: false, getData: () => settingsData },
      ];

      const handler = mockIpcHandlers.get('data-import');
      const result = await handler!({});

      expect(result.success).toBe(true);
      const extracted = path.join(tempDir.tmpDir, 'settings.json');
      expect(fs.existsSync(extracted)).toBe(true);
      expect(fs.readFileSync(extracted).toString()).toBe('{"lang":"ja"}');
    });

    it('returns success false with error when archive lacks settings.json and flashcards.json', async () => {
      const zipPath = path.join(tempDir.tmpDir, 'bad-import.zip');
      fs.writeFileSync(zipPath, Buffer.from('placeholder'));

      const { dialog } = await import('electron');
      vi.mocked(dialog.showOpenDialog).mockResolvedValue({ canceled: false, filePaths: [zipPath] });

      admZipState.nextEntries = [
        { entryName: 'unknown.bin', isDirectory: false, getData: () => Buffer.from('x') },
      ];

      const handler = mockIpcHandlers.get('data-import');
      const result = await handler!({});

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Invalid backup/);
    });

    it('skips entries with path traversal attempts', async () => {
      const zipPath = path.join(tempDir.tmpDir, 'traversal.zip');
      fs.writeFileSync(zipPath, Buffer.from('placeholder'));

      const { dialog } = await import('electron');
      vi.mocked(dialog.showOpenDialog).mockResolvedValue({ canceled: false, filePaths: [zipPath] });

      admZipState.nextEntries = [
        { entryName: 'settings.json', isDirectory: false, getData: () => Buffer.from('{}') },
        { entryName: '../evil.sh', isDirectory: false, getData: () => Buffer.from('malicious') },
      ];

      const handler = mockIpcHandlers.get('data-import');
      const result = await handler!({});

      expect(result.success).toBe(true);
      const evilPath = path.join(path.dirname(tempDir.tmpDir), 'evil.sh');
      expect(fs.existsSync(evilPath)).toBe(false);
    });

    it('skips entries not in known files or directories', async () => {
      const zipPath = path.join(tempDir.tmpDir, 'unknown-entries.zip');
      fs.writeFileSync(zipPath, Buffer.from('placeholder'));

      const { dialog } = await import('electron');
      vi.mocked(dialog.showOpenDialog).mockResolvedValue({ canceled: false, filePaths: [zipPath] });

      admZipState.nextEntries = [
        { entryName: 'settings.json', isDirectory: false, getData: () => Buffer.from('{}') },
        { entryName: 'malicious.exe', isDirectory: false, getData: () => Buffer.from('bad') },
      ];

      const handler = mockIpcHandlers.get('data-import');
      const result = await handler!({});

      expect(result.success).toBe(true);
      expect(fs.existsSync(path.join(tempDir.tmpDir, 'malicious.exe'))).toBe(false);
    });

    it('extracts files in known sub-directories', async () => {
      const zipPath = path.join(tempDir.tmpDir, 'subdir-import.zip');
      fs.writeFileSync(zipPath, Buffer.from('placeholder'));

      const { dialog } = await import('electron');
      vi.mocked(dialog.showOpenDialog).mockResolvedValue({ canceled: false, filePaths: [zipPath] });

      const audioData = Buffer.alloc(200, 0x77);
      admZipState.nextEntries = [
        { entryName: 'flashcards.json', isDirectory: false, getData: () => Buffer.from('{}') },
        { entryName: 'flashcard-audio/card1-word.ogg', isDirectory: false, getData: () => audioData },
      ];

      const handler = mockIpcHandlers.get('data-import');
      const result = await handler!({});

      expect(result.success).toBe(true);
      const audioPath = path.join(tempDir.tmpDir, 'flashcard-audio', 'card1-word.ogg');
      expect(fs.existsSync(audioPath)).toBe(true);
      expect(fs.readFileSync(audioPath).equals(audioData)).toBe(true);
    });

    it('creates target directories when they do not exist', async () => {
      const zipPath = path.join(tempDir.tmpDir, 'mkdir-import.zip');
      fs.writeFileSync(zipPath, Buffer.from('placeholder'));

      const { dialog } = await import('electron');
      vi.mocked(dialog.showOpenDialog).mockResolvedValue({ canceled: false, filePaths: [zipPath] });

      const imageData = Buffer.alloc(100, 0xab);
      admZipState.nextEntries = [
        { entryName: 'settings.json', isDirectory: false, getData: () => Buffer.from('{}') },
        { entryName: 'flashcard-images/card2.jpg', isDirectory: false, getData: () => imageData },
      ];

      const handler = mockIpcHandlers.get('data-import');
      await handler!({});

      expect(fs.existsSync(path.join(tempDir.tmpDir, 'flashcard-images'))).toBe(true);
    });
  });
});
