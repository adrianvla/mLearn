import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTempDir, type TempDir } from '../../../test/helpers/tempDir';
import path from 'path';
import fs from 'fs';

const mockIpcHandlers = new Map<string, Function>();

let mockHomeDir = '/tmp/mock-home';

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: Function) => {
      mockIpcHandlers.set(channel, handler);
    }),
    removeHandler: vi.fn(),
  },
  dialog: {
    showOpenDialog: vi.fn(),
    showSaveDialog: vi.fn(),
  },
  BrowserWindow: {
    getFocusedWindow: vi.fn(() => null),
  },
  app: {
    getPath: vi.fn((key: string) => {
      if (key === 'home') return mockHomeDir;
      return mockHomeDir;
    }),
  },
}));

vi.mock('../utils/platform', () => ({
  getUserDataPath: vi.fn(() => mockHomeDir),
  getAppPath: vi.fn(() => mockHomeDir),
  getResourcePath: vi.fn(() => mockHomeDir),
}));

describe('fileOperations', () => {
  let setupFileOperationsIPC: () => void;
  let tempDir: TempDir;

  beforeEach(async () => {
    tempDir = createTempDir('mlearn-fileops-test-');
    mockHomeDir = tempDir.tmpDir;

    const { app } = await import('electron');
    vi.mocked(app.getPath).mockImplementation((key: string) => {
      if (key === 'home') return tempDir.tmpDir;
      return tempDir.tmpDir;
    });

    mockIpcHandlers.clear();
    vi.resetModules();

    const mod = await import('./fileOperations');
    setupFileOperationsIPC = mod.setupFileOperationsIPC;
  });

  afterEach(() => {
    tempDir.cleanup();
  });

  describe('setupFileOperationsIPC', () => {
    it('registers all expected IPC handlers', () => {
      setupFileOperationsIPC();
      expect(mockIpcHandlers.has('read-directory-images')).toBe(true);
      expect(mockIpcHandlers.has('read-pdf-file')).toBe(true);
      expect(mockIpcHandlers.has('select-video-file')).toBe(true);
      expect(mockIpcHandlers.has('select-subtitle-file')).toBe(true);
      expect(mockIpcHandlers.has('select-book-folder')).toBe(true);
      expect(mockIpcHandlers.has('select-pdf-file')).toBe(true);
      expect(mockIpcHandlers.has('read-media-file')).toBe(true);
    });
  });

  describe('read-directory-images handler', () => {
    beforeEach(() => {
      setupFileOperationsIPC();
    });

    it('returns image files from a directory sorted by name', async () => {
      const subDir = path.join(tempDir.tmpDir, 'images');
      fs.mkdirSync(subDir);
      fs.writeFileSync(path.join(subDir, 'b.jpg'), Buffer.alloc(10));
      fs.writeFileSync(path.join(subDir, 'a.png'), Buffer.alloc(20));
      fs.writeFileSync(path.join(subDir, 'c.webp'), Buffer.alloc(15));
      fs.writeFileSync(path.join(subDir, 'skip.txt'), Buffer.alloc(5));

      const handler = mockIpcHandlers.get('read-directory-images');
      const result = await handler!({}, subDir);

      expect(result.files).toHaveLength(3);
      expect(result.files[0].name).toBe('a.png');
      expect(result.files[1].name).toBe('b.jpg');
      expect(result.files[2].name).toBe('c.webp');
    });

    it('returns ArrayBuffer data for each image', async () => {
      const subDir = path.join(tempDir.tmpDir, 'img-data');
      fs.mkdirSync(subDir);
      const content = Buffer.from('fake-image-data');
      fs.writeFileSync(path.join(subDir, 'photo.png'), content);

      const handler = mockIpcHandlers.get('read-directory-images');
      const result = await handler!({}, subDir);

      expect(result.files).toHaveLength(1);
      expect(result.files[0].data).toBeInstanceOf(ArrayBuffer);
      const view = Buffer.from(result.files[0].data);
      expect(view.equals(content)).toBe(true);
    });

    it('returns empty array for directory with no images', async () => {
      const subDir = path.join(tempDir.tmpDir, 'no-images');
      fs.mkdirSync(subDir);
      fs.writeFileSync(path.join(subDir, 'readme.txt'), 'hello');

      const handler = mockIpcHandlers.get('read-directory-images');
      const result = await handler!({}, subDir);

      expect(result.files).toHaveLength(0);
    });

    it('accepts all supported image extensions', async () => {
      const subDir = path.join(tempDir.tmpDir, 'all-exts');
      fs.mkdirSync(subDir);
      const exts = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.tiff', '.tif'];
      for (const ext of exts) {
        fs.writeFileSync(path.join(subDir, `file${ext}`), Buffer.alloc(10));
      }

      const handler = mockIpcHandlers.get('read-directory-images');
      const result = await handler!({}, subDir);

      expect(result.files).toHaveLength(exts.length);
    });

    it('throws when directory does not exist', async () => {
      const handler = mockIpcHandlers.get('read-directory-images');
      const missingDir = path.join(tempDir.tmpDir, 'nonexistent');
      await expect(handler!({}, missingDir)).rejects.toThrow();
    });

    it('throws when path is outside home directory', async () => {
      const handler = mockIpcHandlers.get('read-directory-images');
      await expect(handler!({}, '/etc/passwd')).rejects.toThrow('Path outside allowed directory');
    });

    it('returns file path alongside name and data', async () => {
      const subDir = path.join(tempDir.tmpDir, 'with-path');
      fs.mkdirSync(subDir);
      fs.writeFileSync(path.join(subDir, 'img.jpg'), Buffer.alloc(10));

      const handler = mockIpcHandlers.get('read-directory-images');
      const result = await handler!({}, subDir);

      expect(result.files[0].path).toBe(path.join(fs.realpathSync(subDir), 'img.jpg'));
    });
  });

  describe('read-pdf-file handler', () => {
    beforeEach(() => {
      setupFileOperationsIPC();
    });

    it('reads a PDF file and returns an ArrayBuffer', async () => {
      const pdfPath = path.join(tempDir.tmpDir, 'test.pdf');
      const content = Buffer.from('%PDF-1.4 fake content');
      fs.writeFileSync(pdfPath, content);

      const handler = mockIpcHandlers.get('read-pdf-file');
      const result = await handler!({}, pdfPath);

      expect(result.data).toBeInstanceOf(ArrayBuffer);
      expect(Buffer.from(result.data).equals(content)).toBe(true);
    });

    it('throws when PDF file does not exist', async () => {
      const handler = mockIpcHandlers.get('read-pdf-file');
      const missing = path.join(tempDir.tmpDir, 'missing.pdf');
      await expect(handler!({}, missing)).rejects.toThrow();
    });

    it('throws when path is outside home directory', async () => {
      const handler = mockIpcHandlers.get('read-pdf-file');
      const external = createTempDir('mlearn-unselected-pdf-');
      try {
        const pdf = path.join(external.tmpDir, 'unselected.pdf');
        fs.writeFileSync(pdf, '%PDF-1.4');
        await expect(handler!({}, pdf)).rejects.toThrow('Path outside allowed directory');
      } finally {
        external.cleanup();
      }
    });
  });

  describe('select-video-file handler', () => {
    beforeEach(() => {
      setupFileOperationsIPC();
    });

    it('returns selected file path when user picks a file', async () => {
      const { dialog } = await import('electron');
      vi.mocked(dialog.showOpenDialog).mockResolvedValue({ canceled: false, filePaths: ['/home/user/video.mp4'] });

      const handler = mockIpcHandlers.get('select-video-file');
      const result = await handler!({});

      expect(result).toBe('/home/user/video.mp4');
    });

    it('returns null when dialog is canceled', async () => {
      const { dialog } = await import('electron');
      vi.mocked(dialog.showOpenDialog).mockResolvedValue({ canceled: true, filePaths: [] });

      const handler = mockIpcHandlers.get('select-video-file');
      const result = await handler!({});

      expect(result).toBeNull();
    });

    it('returns null when filePaths is empty despite not canceled', async () => {
      const { dialog } = await import('electron');
      vi.mocked(dialog.showOpenDialog).mockResolvedValue({ canceled: false, filePaths: [] });

      const handler = mockIpcHandlers.get('select-video-file');
      const result = await handler!({});

      expect(result).toBeNull();
    });
  });

  describe('select-subtitle-file handler', () => {
    beforeEach(() => {
      setupFileOperationsIPC();
    });

    it('returns selected subtitle path', async () => {
      const { dialog } = await import('electron');
      vi.mocked(dialog.showOpenDialog).mockResolvedValue({ canceled: false, filePaths: ['/home/user/sub.srt'] });

      const handler = mockIpcHandlers.get('select-subtitle-file');
      const result = await handler!({});

      expect(result).toBe('/home/user/sub.srt');
    });

    it('returns null when dialog is canceled', async () => {
      const { dialog } = await import('electron');
      vi.mocked(dialog.showOpenDialog).mockResolvedValue({ canceled: true, filePaths: [] });

      const handler = mockIpcHandlers.get('select-subtitle-file');
      const result = await handler!({});

      expect(result).toBeNull();
    });
  });

  describe('select-book-folder handler', () => {
    beforeEach(() => {
      setupFileOperationsIPC();
    });

    it('returns selected directory path', async () => {
      const { dialog } = await import('electron');
      const selected = path.join(tempDir.tmpDir, 'manga');
      fs.mkdirSync(selected);
      vi.mocked(dialog.showOpenDialog).mockResolvedValue({ canceled: false, filePaths: [selected] });

      const handler = mockIpcHandlers.get('select-book-folder');
      const result = await handler!({});

      expect(result).toBe(selected);
    });

    it('returns null when dialog is canceled', async () => {
      const { dialog } = await import('electron');
      vi.mocked(dialog.showOpenDialog).mockResolvedValue({ canceled: true, filePaths: [] });

      const handler = mockIpcHandlers.get('select-book-folder');
      const result = await handler!({});

      expect(result).toBeNull();
    });
  });

  describe('select-pdf-file handler', () => {
    beforeEach(() => {
      setupFileOperationsIPC();
    });

    it('returns selected book path', async () => {
      const { dialog } = await import('electron');
      const selected = path.join(tempDir.tmpDir, 'book.pdf');
      fs.writeFileSync(selected, '%PDF-1.4');
      vi.mocked(dialog.showOpenDialog).mockResolvedValue({ canceled: false, filePaths: [selected] });

      const handler = mockIpcHandlers.get('select-pdf-file');
      const result = await handler!({});

      expect(result).toBe(selected);
      expect(vi.mocked(dialog.showOpenDialog).mock.calls[0]?.[0]).toMatchObject({
        filters: [
          { name: 'Book Files', extensions: ['pdf', 'epub'] },
          { name: 'All Files', extensions: ['*'] },
        ],
      });
    });

    it('returns null when dialog is canceled', async () => {
      const { dialog } = await import('electron');
      vi.mocked(dialog.showOpenDialog).mockResolvedValue({ canceled: true, filePaths: [] });

      const handler = mockIpcHandlers.get('select-pdf-file');
      const result = await handler!({});

      expect(result).toBeNull();
    });
  });

  describe('external reader paths', () => {
    it('reads a selected external folder again after the IPC module reloads', async () => {
      const external = createTempDir('mlearn-external-book-');
      try {
        const folder = path.join(external.tmpDir, 'book');
        fs.mkdirSync(folder);
        fs.writeFileSync(path.join(folder, 'page.png'), Buffer.from('page bytes'));
        const { dialog } = await import('electron');
        vi.mocked(dialog.showOpenDialog).mockResolvedValue({ canceled: false, filePaths: [folder] });
        setupFileOperationsIPC();

        expect(await mockIpcHandlers.get('select-book-folder')!({})).toBe(folder);
        expect((await mockIpcHandlers.get('read-directory-images')!({}, folder)).files).toHaveLength(1);

        mockIpcHandlers.clear();
        vi.resetModules();
        (await import('./fileOperations')).setupFileOperationsIPC();
        const reopened = await mockIpcHandlers.get('read-directory-images')!({}, folder);
        expect(Buffer.from(reopened.files[0].data).toString()).toBe('page bytes');
        await expect(mockIpcHandlers.get('read-directory-images')!({}, external.tmpDir))
          .rejects.toThrow('Path outside allowed directory');
      } finally {
        external.cleanup();
      }
    });

    it('keeps selected external PDFs separate from folder grants', async () => {
      const external = createTempDir('mlearn-external-pdf-');
      try {
        const pdf = path.join(external.tmpDir, 'book.pdf');
        fs.writeFileSync(pdf, '%PDF-1.4 external');
        const { dialog } = await import('electron');
        vi.mocked(dialog.showOpenDialog).mockResolvedValue({ canceled: false, filePaths: [pdf] });
        setupFileOperationsIPC();

        expect(await mockIpcHandlers.get('select-pdf-file')!({})).toBe(pdf);
        const result = await mockIpcHandlers.get('read-pdf-file')!({}, pdf);
        expect(Buffer.from(result.data).toString()).toBe('%PDF-1.4 external');
        await expect(mockIpcHandlers.get('read-directory-images')!({}, external.tmpDir))
          .rejects.toThrow('Path outside allowed directory');
      } finally {
        external.cleanup();
      }
    });

    it('does not treat a symlink from home as permission to read outside home', async () => {
      const external = createTempDir('mlearn-external-link-');
      try {
        const link = path.join(tempDir.tmpDir, 'external-link');
        fs.symlinkSync(external.tmpDir, link);
        setupFileOperationsIPC();
        await expect(mockIpcHandlers.get('read-directory-images')!({}, link))
          .rejects.toThrow('Path outside allowed directory');
      } finally {
        external.cleanup();
      }
    });
  });

  describe('read-media-file handler', () => {
    beforeEach(() => {
      setupFileOperationsIPC();
    });

    it('reads any file as ArrayBuffer', async () => {
      const mediaPath = path.join(tempDir.tmpDir, 'clip.mp4');
      const content = Buffer.from('fake-video-bytes');
      fs.writeFileSync(mediaPath, content);

      const handler = mockIpcHandlers.get('read-media-file');
      const result = await handler!({}, mediaPath);

      expect(result).toBeInstanceOf(ArrayBuffer);
      expect(Buffer.from(result as ArrayBuffer).equals(content)).toBe(true);
    });

    it('returns null when file does not exist', async () => {
      const handler = mockIpcHandlers.get('read-media-file');
      const missing = path.join(tempDir.tmpDir, 'nonexistent.mp4');

      const result = await handler!({}, missing);
      expect(result).toBeNull();
    });

    it('does NOT enforce home directory restriction', async () => {
      const handler = mockIpcHandlers.get('read-media-file');
      const result = await handler!({}, '/etc/nonexistent-test-file-12345');
      expect(result).toBeNull();
    });
  });
});
