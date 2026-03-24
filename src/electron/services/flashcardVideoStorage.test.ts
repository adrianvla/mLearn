import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTempDir, type TempDir } from '../../../test/helpers/tempDir';
import path from 'path';
import fs from 'fs';

const mockIpcHandlers = new Map<string, Function>();

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: Function) => {
      mockIpcHandlers.set(channel, handler);
    }),
    removeHandler: vi.fn(),
  },
  protocol: {
    handle: vi.fn(),
    registerSchemesAsPrivileged: vi.fn(),
  },
  net: {
    fetch: vi.fn(),
  },
}));

let tempDir: TempDir;

vi.mock('../utils/platform', () => ({
  getUserDataPath: vi.fn(() => tempDir?.tmpDir || '/tmp/test'),
  getAppPath: vi.fn(() => tempDir?.tmpDir || '/tmp/test'),
  getResourcePath: vi.fn(() => tempDir?.tmpDir || '/tmp/test'),
}));

describe('flashcardVideoStorage', () => {
  let saveFlashcardVideo: (cardId: string, data: Buffer) => string | null;
  let deleteFlashcardVideo: (cardId: string) => void;
  let registerFlashcardVideoScheme: () => void;
  let setupFlashcardVideoProtocol: () => void;
  let setupFlashcardVideoIPC: () => void;

  beforeEach(async () => {
    tempDir = createTempDir('mlearn-video-test-');
    mockIpcHandlers.clear();
    vi.resetModules();

    const mod = await import('./flashcardVideoStorage');
    saveFlashcardVideo = mod.saveFlashcardVideo;
    deleteFlashcardVideo = mod.deleteFlashcardVideo;
    registerFlashcardVideoScheme = mod.registerFlashcardVideoScheme;
    setupFlashcardVideoProtocol = mod.setupFlashcardVideoProtocol;
    setupFlashcardVideoIPC = mod.setupFlashcardVideoIPC;
  });

  afterEach(() => {
    tempDir.cleanup();
  });

  describe('saveFlashcardVideo', () => {
    it('saves video data to disk and returns protocol URL', () => {
      const cardId = 'card-123';
      const data = Buffer.from('fake-video-data');

      const result = saveFlashcardVideo(cardId, data);

      expect(result).toBe('flashcard-video://card-123.mp4');
      const filePath = path.join(tempDir.tmpDir, 'flashcard-videos', 'card-123.mp4');
      expect(fs.existsSync(filePath)).toBe(true);
      expect(fs.readFileSync(filePath)).toEqual(data);
    });

    it('creates flashcard-videos directory if it does not exist', () => {
      const videoDir = path.join(tempDir.tmpDir, 'flashcard-videos');
      expect(fs.existsSync(videoDir)).toBe(false);

      saveFlashcardVideo('card-abc', Buffer.from('data'));

      expect(fs.existsSync(videoDir)).toBe(true);
    });

    it('returns null for empty buffer', () => {
      const result = saveFlashcardVideo('card-empty', Buffer.alloc(0));
      expect(result).toBeNull();
    });

    it('returns null for null/falsy data', () => {
      const result = saveFlashcardVideo('card-null', null as unknown as Buffer);
      expect(result).toBeNull();
    });

    it('overwrites existing video file for same cardId', () => {
      const cardId = 'card-overwrite';
      const firstData = Buffer.from('first-video');
      const secondData = Buffer.from('second-video-longer');

      saveFlashcardVideo(cardId, firstData);
      saveFlashcardVideo(cardId, secondData);

      const filePath = path.join(tempDir.tmpDir, 'flashcard-videos', `${cardId}.mp4`);
      expect(fs.readFileSync(filePath)).toEqual(secondData);
    });

    it('handles large video data', () => {
      const cardId = 'card-large';
      const largeData = Buffer.alloc(1024 * 1024, 0x42);

      const result = saveFlashcardVideo(cardId, largeData);

      expect(result).toBe(`flashcard-video://${cardId}.mp4`);
      const filePath = path.join(tempDir.tmpDir, 'flashcard-videos', `${cardId}.mp4`);
      expect(fs.statSync(filePath).size).toBe(1024 * 1024);
    });
  });

  describe('deleteFlashcardVideo', () => {
    it('deletes existing video file', () => {
      const cardId = 'card-delete';
      saveFlashcardVideo(cardId, Buffer.from('data'));

      const filePath = path.join(tempDir.tmpDir, 'flashcard-videos', `${cardId}.mp4`);
      expect(fs.existsSync(filePath)).toBe(true);

      deleteFlashcardVideo(cardId);

      expect(fs.existsSync(filePath)).toBe(false);
    });

    it('does nothing if video file does not exist', () => {
      expect(() => deleteFlashcardVideo('nonexistent-card')).not.toThrow();
    });

    it('does nothing if video directory does not exist', () => {
      expect(() => deleteFlashcardVideo('card-no-dir')).not.toThrow();
    });

    it('only deletes the mp4 file for the given cardId', () => {
      const cardId1 = 'card-keep';
      const cardId2 = 'card-remove';
      saveFlashcardVideo(cardId1, Buffer.from('keep'));
      saveFlashcardVideo(cardId2, Buffer.from('remove'));

      deleteFlashcardVideo(cardId2);

      const keepPath = path.join(tempDir.tmpDir, 'flashcard-videos', `${cardId1}.mp4`);
      const removePath = path.join(tempDir.tmpDir, 'flashcard-videos', `${cardId2}.mp4`);
      expect(fs.existsSync(keepPath)).toBe(true);
      expect(fs.existsSync(removePath)).toBe(false);
    });
  });

  describe('registerFlashcardVideoScheme', () => {
    it('calls protocol.registerSchemesAsPrivileged with flashcard-video scheme', async () => {
      const { protocol } = await import('electron');

      registerFlashcardVideoScheme();

      expect(protocol.registerSchemesAsPrivileged).toHaveBeenCalledWith([
        expect.objectContaining({
          scheme: 'flashcard-video',
          privileges: expect.objectContaining({
            secure: true,
            supportFetchAPI: true,
          }),
        }),
      ]);
    });
  });

  describe('setupFlashcardVideoProtocol', () => {
    it('registers a protocol handler for the flashcard-video scheme', async () => {
      const { protocol } = await import('electron');

      setupFlashcardVideoProtocol();

      expect(protocol.handle).toHaveBeenCalledWith('flashcard-video', expect.any(Function));
    });

    it('protocol handler resolves file URL for a stored video', async () => {
      const { protocol, net } = await import('electron');
      vi.mocked(net.fetch).mockResolvedValue(new Response('video-content'));

      setupFlashcardVideoProtocol();

      const handler = vi.mocked(protocol.handle).mock.calls[0][1];
      const cardId = 'card-proto';
      saveFlashcardVideo(cardId, Buffer.from('video'));

      const request = new Request(`flashcard-video://${cardId}.mp4`);
      await handler(request);

      expect(net.fetch).toHaveBeenCalledWith(
        expect.stringContaining('card-proto.mp4'),
        expect.any(Object),
      );
    });

    it('protocol handler strips query string from filename', async () => {
      const { protocol, net } = await import('electron');
      vi.mocked(net.fetch).mockResolvedValue(new Response(''));

      setupFlashcardVideoProtocol();

      const handler = vi.mocked(protocol.handle).mock.calls[0][1];
      const request = new Request('flashcard-video://card-qs.mp4?t=123');
      await handler(request);

      expect(net.fetch).toHaveBeenCalledWith(
        expect.stringContaining('card-qs.mp4'),
        expect.any(Object),
      );
      const calledUrl: string = vi.mocked(net.fetch).mock.calls[0][0] as string;
      expect(calledUrl).not.toContain('?t=123');
    });
  });

  describe('setupFlashcardVideoIPC', () => {
    it('registers IPC handlers for FLASHCARD_VIDEO_SAVE and FLASHCARD_VIDEO_DELETE', async () => {
      const { ipcMain } = await import('electron');

      setupFlashcardVideoIPC();

      expect(ipcMain.handle).toHaveBeenCalledWith('flashcard-video-save', expect.any(Function));
      expect(ipcMain.handle).toHaveBeenCalledWith('flashcard-video-delete', expect.any(Function));
    });

    it('FLASHCARD_VIDEO_SAVE handler saves video and returns protocol URL', async () => {
      setupFlashcardVideoIPC();

      const handler = mockIpcHandlers.get('flashcard-video-save');
      expect(handler).toBeDefined();

      const data = Buffer.from('video-bytes');
      const result = await handler!({}, 'card-ipc', data.buffer);

      expect(result).toBe('flashcard-video://card-ipc.mp4');
    });

    it('FLASHCARD_VIDEO_SAVE handler returns null for empty data', async () => {
      setupFlashcardVideoIPC();

      const handler = mockIpcHandlers.get('flashcard-video-save');
      const result = await handler!({}, 'card-empty', new ArrayBuffer(0));

      expect(result).toBeNull();
    });

    it('FLASHCARD_VIDEO_DELETE handler deletes video and returns true', async () => {
      const cardId = 'card-del-ipc';
      saveFlashcardVideo(cardId, Buffer.from('data'));

      setupFlashcardVideoIPC();

      const handler = mockIpcHandlers.get('flashcard-video-delete');
      expect(handler).toBeDefined();

      const result = await handler!({}, cardId);

      expect(result).toBe(true);
      const filePath = path.join(tempDir.tmpDir, 'flashcard-videos', `${cardId}.mp4`);
      expect(fs.existsSync(filePath)).toBe(false);
    });

    it('FLASHCARD_VIDEO_DELETE handler returns true even for nonexistent card', async () => {
      setupFlashcardVideoIPC();

      const handler = mockIpcHandlers.get('flashcard-video-delete');
      const result = await handler!({}, 'nonexistent');

      expect(result).toBe(true);
    });
  });
});
