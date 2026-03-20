import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTempDir, type TempDir } from '../../../test/helpers/tempDir';
import path from 'path';
import fs from 'fs';
import type { FlashcardStore } from '../../shared/types';

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

function makeMinimalStore(overrides: Partial<FlashcardStore> = {}): FlashcardStore {
  return {
    flashcards: {},
    wordCandidates: {},
    wordToCardMap: {},
    wordStatsMap: {},
    knownUntracked: {},
    ignoredWords: {},
    wordKnowledge: {},
    grammarKnowledge: {},
    meta: {
      newCardsToday: 0,
      reviewsToday: 0,
      newCardsDate: '2024-01-01',
      maxNewCardsPerDay: 10,
      maxNewCardsPerDayLearning: 20,
      maxReviewsPerDay: -1,
      learningSteps: [1, 10],
      relearnSteps: [10],
      graduatingInterval: 1,
      easyInterval: 4,
      newIntervalModifier: 100,
      reviewIntervalModifier: 100,
      maxInterval: 36500,
    },
    dailyStats: {},
    version: 5,
    ...overrides,
  };
}

function makePngDataUrl(content = 'png'): string {
  return `data:image/png;base64,${Buffer.from(content).toString('base64')}`;
}

function makeJpegDataUrl(content = 'jpeg'): string {
  return `data:image/jpeg;base64,${Buffer.from(content).toString('base64')}`;
}

function makeWebpDataUrl(content = 'webp'): string {
  return `data:image/webp;base64,${Buffer.from(content).toString('base64')}`;
}

describe('flashcardImageStorage', () => {
  let extractBase64Images: (store: FlashcardStore) => boolean;
  let saveFlashcardImage: (cardId: string, dataUrl: string) => string | null;
  let deleteFlashcardImage: (cardId: string) => void;
  let resolveImagePath: (imageUrl: string) => string | null;
  let resolveImageUrl: (imageUrl: string) => string | null;
  let registerFlashcardImageScheme: () => void;
  let setupFlashcardImageProtocol: () => void;
  let setupFlashcardImageIPC: () => void;

  beforeEach(async () => {
    tempDir = createTempDir('mlearn-image-test-');
    mockIpcHandlers.clear();
    vi.resetModules();

    const mod = await import('./flashcardImageStorage');
    extractBase64Images = mod.extractBase64Images;
    saveFlashcardImage = mod.saveFlashcardImage;
    deleteFlashcardImage = mod.deleteFlashcardImage;
    resolveImagePath = mod.resolveImagePath;
    resolveImageUrl = mod.resolveImageUrl;
    registerFlashcardImageScheme = mod.registerFlashcardImageScheme;
    setupFlashcardImageProtocol = mod.setupFlashcardImageProtocol;
    setupFlashcardImageIPC = mod.setupFlashcardImageIPC;
  });

  afterEach(() => {
    tempDir.cleanup();
  });

  describe('saveFlashcardImage', () => {
    it('saves a PNG base64 data URL to disk and returns protocol URL', () => {
      const cardId = 'card-png';
      const dataUrl = makePngDataUrl('png-data');

      const result = saveFlashcardImage(cardId, dataUrl);

      expect(result).toBe('flashcard-image://card-png.png');
      const filePath = path.join(tempDir.tmpDir, 'flashcard-images', 'card-png.png');
      expect(fs.existsSync(filePath)).toBe(true);
    });

    it('saves a JPEG base64 data URL and uses .jpg extension', () => {
      const cardId = 'card-jpeg';
      const dataUrl = makeJpegDataUrl('jpeg-data');

      const result = saveFlashcardImage(cardId, dataUrl);

      expect(result).toBe('flashcard-image://card-jpeg.jpg');
      const filePath = path.join(tempDir.tmpDir, 'flashcard-images', 'card-jpeg.jpg');
      expect(fs.existsSync(filePath)).toBe(true);
    });

    it('saves a webp base64 data URL', () => {
      const cardId = 'card-webp';
      const dataUrl = makeWebpDataUrl('webp-data');

      const result = saveFlashcardImage(cardId, dataUrl);

      expect(result).toBe('flashcard-image://card-webp.webp');
    });

    it('creates flashcard-images directory if it does not exist', () => {
      const imageDir = path.join(tempDir.tmpDir, 'flashcard-images');
      expect(fs.existsSync(imageDir)).toBe(false);

      saveFlashcardImage('card-dir', makePngDataUrl());

      expect(fs.existsSync(imageDir)).toBe(true);
    });

    it('returns null for non-base64 string', () => {
      const result = saveFlashcardImage('card-invalid', 'https://example.com/image.png');
      expect(result).toBeNull();
    });

    it('returns null for empty string', () => {
      const result = saveFlashcardImage('card-empty', '');
      expect(result).toBeNull();
    });

    it('writes correct binary content to file', () => {
      const cardId = 'card-content';
      const rawContent = 'hello image data';
      const dataUrl = `data:image/png;base64,${Buffer.from(rawContent).toString('base64')}`;

      saveFlashcardImage(cardId, dataUrl);

      const filePath = path.join(tempDir.tmpDir, 'flashcard-images', 'card-content.png');
      const content = fs.readFileSync(filePath).toString();
      expect(content).toBe(rawContent);
    });

    it('overwrites existing file for same cardId', () => {
      const cardId = 'card-overwrite';
      saveFlashcardImage(cardId, makePngDataUrl('first'));
      saveFlashcardImage(cardId, makePngDataUrl('second'));

      const filePath = path.join(tempDir.tmpDir, 'flashcard-images', 'card-overwrite.png');
      const content = fs.readFileSync(filePath).toString();
      expect(content).toBe('second');
    });
  });

  describe('deleteFlashcardImage', () => {
    it('deletes an existing image file', () => {
      const cardId = 'card-del';
      saveFlashcardImage(cardId, makePngDataUrl());

      const filePath = path.join(tempDir.tmpDir, 'flashcard-images', `${cardId}.png`);
      expect(fs.existsSync(filePath)).toBe(true);

      deleteFlashcardImage(cardId);

      expect(fs.existsSync(filePath)).toBe(false);
    });

    it('does nothing if image directory does not exist', () => {
      expect(() => deleteFlashcardImage('card-no-dir')).not.toThrow();
    });

    it('does nothing if no image file matches', () => {
      const imageDir = path.join(tempDir.tmpDir, 'flashcard-images');
      fs.mkdirSync(imageDir, { recursive: true });

      expect(() => deleteFlashcardImage('card-nonexistent')).not.toThrow();
    });

    it('deletes jpg but not png if only jpg exists', () => {
      const cardId = 'card-only-jpg';
      saveFlashcardImage(cardId, makeJpegDataUrl());

      deleteFlashcardImage(cardId);

      const filePath = path.join(tempDir.tmpDir, 'flashcard-images', `${cardId}.jpg`);
      expect(fs.existsSync(filePath)).toBe(false);
    });

    it('deletes all extensions for a card if multiple exist', () => {
      const cardId = 'card-multi';
      const imageDir = path.join(tempDir.tmpDir, 'flashcard-images');
      fs.mkdirSync(imageDir, { recursive: true });
      fs.writeFileSync(path.join(imageDir, `${cardId}.jpg`), 'jpg');
      fs.writeFileSync(path.join(imageDir, `${cardId}.png`), 'png');

      deleteFlashcardImage(cardId);

      expect(fs.existsSync(path.join(imageDir, `${cardId}.jpg`))).toBe(false);
      expect(fs.existsSync(path.join(imageDir, `${cardId}.png`))).toBe(false);
    });
  });

  describe('resolveImagePath', () => {
    it('returns absolute file path for valid flashcard-image:// URL', () => {
      const cardId = 'card-resolve';
      saveFlashcardImage(cardId, makePngDataUrl());

      const result = resolveImagePath(`flashcard-image://${cardId}.png`);

      expect(result).toBe(path.join(tempDir.tmpDir, 'flashcard-images', `${cardId}.png`));
    });

    it('returns null if file does not exist', () => {
      const result = resolveImagePath('flashcard-image://nonexistent.png');
      expect(result).toBeNull();
    });

    it('returns null for non-flashcard-image:// URL', () => {
      const result = resolveImagePath('https://example.com/image.png');
      expect(result).toBeNull();
    });

    it('returns null for file:// URL', () => {
      const result = resolveImagePath('file:///tmp/image.png');
      expect(result).toBeNull();
    });
  });

  describe('resolveImageUrl', () => {
    it('returns file:// URL for existing image', () => {
      const cardId = 'card-url';
      saveFlashcardImage(cardId, makePngDataUrl());

      const result = resolveImageUrl(`flashcard-image://${cardId}.png`);

      expect(result).toContain(`${cardId}.png`);
      expect(result).toMatch(/^file:\/\//);
    });

    it('returns null if image does not exist', () => {
      const result = resolveImageUrl('flashcard-image://missing.jpg');
      expect(result).toBeNull();
    });

    it('returns null for non-flashcard-image:// URL', () => {
      const result = resolveImageUrl('https://example.com/image.png');
      expect(result).toBeNull();
    });
  });

  describe('extractBase64Images', () => {
    it('returns false when store has no base64 images', () => {
      const store = makeMinimalStore();
      const result = extractBase64Images(store);
      expect(result).toBe(false);
    });

    it('extracts base64 imageUrl and replaces with protocol URL', () => {
      const cardId = 'card-extract';
      const dataUrl = makePngDataUrl('extracted');
      const store = makeMinimalStore({
        flashcards: {
          [cardId]: {
            id: cardId,
            content: {
              type: 'word',
              front: 'hello',
              back: 'world',
              imageUrl: dataUrl,
            },
            state: 'new',
            ease: 2.5,
            interval: 0,
            dueDate: 0,
            reviews: 0,
            lapses: 0,
            learningStep: 0,
            createdAt: 0,
            lastReviewed: 0,
            lastUpdated: 0,
          },
        },
      });

      const result = extractBase64Images(store);

      expect(result).toBe(true);
      expect(store.flashcards[cardId].content.imageUrl).toBe(`flashcard-image://${cardId}.png`);

      const filePath = path.join(tempDir.tmpDir, 'flashcard-images', `${cardId}.png`);
      expect(fs.existsSync(filePath)).toBe(true);
      expect(fs.readFileSync(filePath).toString()).toBe('extracted');
    });

    it('extracts legacy screenshotUrl field and replaces with protocol URL', () => {
      const cardId = 'card-screenshot';
      const dataUrl = makePngDataUrl('screenshot');
      const store = makeMinimalStore({
        flashcards: {
          [cardId]: {
            id: cardId,
            content: {
              type: 'word',
              front: 'hello',
              back: 'world',
              screenshotUrl: dataUrl,
            },
            state: 'new',
            ease: 2.5,
            interval: 0,
            dueDate: 0,
            reviews: 0,
            lapses: 0,
            learningStep: 0,
            createdAt: 0,
            lastReviewed: 0,
            lastUpdated: 0,
          },
        },
      });

      const result = extractBase64Images(store);

      expect(result).toBe(true);
      expect(store.flashcards[cardId].content.screenshotUrl).toBe(`flashcard-image://${cardId}.png`);
    });

    it('skips cards with already-resolved protocol URLs', () => {
      const cardId = 'card-already';
      const store = makeMinimalStore({
        flashcards: {
          [cardId]: {
            id: cardId,
            content: {
              type: 'word',
              front: 'hello',
              back: 'world',
              imageUrl: `flashcard-image://${cardId}.png`,
            },
            state: 'new',
            ease: 2.5,
            interval: 0,
            dueDate: 0,
            reviews: 0,
            lapses: 0,
            learningStep: 0,
            createdAt: 0,
            lastReviewed: 0,
            lastUpdated: 0,
          },
        },
      });

      const result = extractBase64Images(store);

      expect(result).toBe(false);
    });

    it('handles both imageUrl and screenshotUrl on the same card', () => {
      const cardId = 'card-both';
      const imageDataUrl = makePngDataUrl('image-content');
      const screenshotDataUrl = makeJpegDataUrl('screenshot-content');
      const store = makeMinimalStore({
        flashcards: {
          [cardId]: {
            id: cardId,
            content: {
              type: 'word',
              front: 'hello',
              back: 'world',
              imageUrl: imageDataUrl,
              screenshotUrl: screenshotDataUrl,
            },
            state: 'new',
            ease: 2.5,
            interval: 0,
            dueDate: 0,
            reviews: 0,
            lapses: 0,
            learningStep: 0,
            createdAt: 0,
            lastReviewed: 0,
            lastUpdated: 0,
          },
        },
      });

      const result = extractBase64Images(store);

      expect(result).toBe(true);
      expect(store.flashcards[cardId].content.imageUrl).toMatch(/^flashcard-image:\/\//);
      expect(store.flashcards[cardId].content.screenshotUrl).toMatch(/^flashcard-image:\/\//);
    });

    it('processes multiple cards', () => {
      const store = makeMinimalStore({
        flashcards: {
          'card-a': {
            id: 'card-a',
            content: { type: 'word', front: 'a', back: 'b', imageUrl: makePngDataUrl('a') },
            state: 'new', ease: 2.5, interval: 0, dueDate: 0,
            reviews: 0, lapses: 0, learningStep: 0, createdAt: 0, lastReviewed: 0, lastUpdated: 0,
          },
          'card-b': {
            id: 'card-b',
            content: { type: 'word', front: 'c', back: 'd', imageUrl: makePngDataUrl('b') },
            state: 'new', ease: 2.5, interval: 0, dueDate: 0,
            reviews: 0, lapses: 0, learningStep: 0, createdAt: 0, lastReviewed: 0, lastUpdated: 0,
          },
        },
      });

      const result = extractBase64Images(store);

      expect(result).toBe(true);
      expect(store.flashcards['card-a'].content.imageUrl).toBe('flashcard-image://card-a.png');
      expect(store.flashcards['card-b'].content.imageUrl).toBe('flashcard-image://card-b.png');
    });

    it('creates flashcard-images directory when extracting', () => {
      const imageDir = path.join(tempDir.tmpDir, 'flashcard-images');
      expect(fs.existsSync(imageDir)).toBe(false);

      const store = makeMinimalStore({
        flashcards: {
          'card-mkdir': {
            id: 'card-mkdir',
            content: { type: 'word', front: 'x', back: 'y', imageUrl: makePngDataUrl() },
            state: 'new', ease: 2.5, interval: 0, dueDate: 0,
            reviews: 0, lapses: 0, learningStep: 0, createdAt: 0, lastReviewed: 0, lastUpdated: 0,
          },
        },
      });

      extractBase64Images(store);

      expect(fs.existsSync(imageDir)).toBe(true);
    });
  });

  describe('registerFlashcardImageScheme', () => {
    it('calls protocol.registerSchemesAsPrivileged with flashcard-image scheme', async () => {
      const { protocol } = await import('electron');

      registerFlashcardImageScheme();

      expect(vi.mocked(protocol.registerSchemesAsPrivileged)).toHaveBeenCalledWith([
        expect.objectContaining({
          scheme: 'flashcard-image',
          privileges: expect.objectContaining({
            secure: true,
            supportFetchAPI: true,
          }),
        }),
      ]);
    });
  });

  describe('setupFlashcardImageProtocol', () => {
    it('registers a protocol handler for the flashcard-image scheme', async () => {
      const { protocol } = await import('electron');

      setupFlashcardImageProtocol();

      expect(vi.mocked(protocol.handle)).toHaveBeenCalledWith('flashcard-image', expect.any(Function));
    });

    it('protocol handler fetches the image file via net.fetch', async () => {
      const { protocol, net } = await import('electron');
      vi.mocked(net.fetch).mockResolvedValue(new Response('image-bytes'));

      setupFlashcardImageProtocol();

      const handler = vi.mocked(protocol.handle).mock.calls[0][1] as Function;
      const cardId = 'card-proto';
      saveFlashcardImage(cardId, makePngDataUrl());

      const request = new Request(`flashcard-image://${cardId}.png`);
      await handler(request);

      expect(net.fetch).toHaveBeenCalledWith(
        expect.stringContaining(`${cardId}.png`),
        expect.any(Object),
      );
    });
  });

  describe('setupFlashcardImageIPC', () => {
    it('registers IPC handlers for FLASHCARD_IMAGE_SAVE, FLASHCARD_IMAGE_RESOLVE, FLASHCARD_IMAGE_DELETE', async () => {
      const { ipcMain } = await import('electron');

      setupFlashcardImageIPC();

      expect(vi.mocked(ipcMain.handle)).toHaveBeenCalledWith('flashcard-image-save', expect.any(Function));
      expect(vi.mocked(ipcMain.handle)).toHaveBeenCalledWith('flashcard-image-resolve', expect.any(Function));
      expect(vi.mocked(ipcMain.handle)).toHaveBeenCalledWith('flashcard-image-delete', expect.any(Function));
    });

    it('FLASHCARD_IMAGE_SAVE handler saves image and returns protocol URL', async () => {
      setupFlashcardImageIPC();

      const handler = mockIpcHandlers.get('flashcard-image-save');
      expect(handler).toBeDefined();

      const dataUrl = makePngDataUrl('ipc-save');
      const result = await handler!({}, 'card-ipc-save', dataUrl);

      expect(result).toBe('flashcard-image://card-ipc-save.png');
    });

    it('FLASHCARD_IMAGE_SAVE handler returns null for non-base64 string', async () => {
      setupFlashcardImageIPC();

      const handler = mockIpcHandlers.get('flashcard-image-save');
      const result = await handler!({}, 'card-bad', 'not-a-data-url');

      expect(result).toBeNull();
    });

    it('FLASHCARD_IMAGE_RESOLVE handler returns file:// URL for existing image', async () => {
      const cardId = 'card-ipc-resolve';
      saveFlashcardImage(cardId, makePngDataUrl('resolve'));

      setupFlashcardImageIPC();

      const handler = mockIpcHandlers.get('flashcard-image-resolve');
      expect(handler).toBeDefined();

      const result = await handler!({}, `flashcard-image://${cardId}.png`);

      expect(result).toMatch(/^file:\/\//);
      expect(result).toContain(`${cardId}.png`);
    });

    it('FLASHCARD_IMAGE_RESOLVE handler returns null for nonexistent image', async () => {
      setupFlashcardImageIPC();

      const handler = mockIpcHandlers.get('flashcard-image-resolve');
      const result = await handler!({}, 'flashcard-image://missing.png');

      expect(result).toBeNull();
    });

    it('FLASHCARD_IMAGE_DELETE handler deletes image and returns true', async () => {
      const cardId = 'card-ipc-del';
      saveFlashcardImage(cardId, makePngDataUrl());

      setupFlashcardImageIPC();

      const handler = mockIpcHandlers.get('flashcard-image-delete');
      expect(handler).toBeDefined();

      const result = await handler!({}, cardId);

      expect(result).toBe(true);
      const filePath = path.join(tempDir.tmpDir, 'flashcard-images', `${cardId}.png`);
      expect(fs.existsSync(filePath)).toBe(false);
    });

    it('FLASHCARD_IMAGE_DELETE handler returns true for nonexistent card', async () => {
      setupFlashcardImageIPC();

      const handler = mockIpcHandlers.get('flashcard-image-delete');
      const result = await handler!({}, 'nonexistent-card');

      expect(result).toBe(true);
    });
  });
});
