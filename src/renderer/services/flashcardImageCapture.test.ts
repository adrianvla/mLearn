// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockSaveFlashcardImage = vi.fn();

vi.mock('../../shared/bridges', () => ({
  getBridge: () => ({
    flashcards: {
      saveFlashcardImage: mockSaveFlashcardImage,
    },
  }),
}));

import {
  captureFlashcardImage,
  captureVideoFrameForFlashcard,
  captureReaderImageForOccurrence,
  captureFallbackImage,
} from './flashcardImageCapture';

const originalCreateElement = document.createElement.bind(document);
const HAVE_CURRENT_DATA_READY_STATE = 2;

function makeCanvasMock(dataUrl: string | null = 'data:image/jpeg;base64,FAKE') {
  const ctx = { drawImage: vi.fn() };
  const canvas = {
    getContext: vi.fn(() => ctx),
    toDataURL: vi.fn(() => dataUrl),
    width: 0,
    height: 0,
  };
  return { canvas, ctx };
}

function mockCanvasCreation(dataUrl: string | null = 'data:image/jpeg;base64,FAKE') {
  const { canvas, ctx } = makeCanvasMock(dataUrl);
  document.createElement = (tag: string) =>
    tag === 'canvas' ? (canvas as unknown as HTMLElement) : originalCreateElement(tag);
  return { canvas, ctx };
}

function readyVideo(width = 640, height = 360): HTMLVideoElement {
  const video = document.createElement('video');
  Object.defineProperty(video, 'videoWidth', { value: width, writable: true });
  Object.defineProperty(video, 'videoHeight', { value: height, writable: true });
  Object.defineProperty(video, 'readyState', { value: HAVE_CURRENT_DATA_READY_STATE, writable: true });
  return video;
}

function readyImage(naturalWidth = 800, naturalHeight = 1200): HTMLImageElement {
  const img = document.createElement('img');
  Object.defineProperty(img, 'naturalWidth', { value: naturalWidth, writable: true });
  Object.defineProperty(img, 'naturalHeight', { value: naturalHeight, writable: true });
  Object.defineProperty(img, 'complete', { value: true, writable: true });
  return img;
}

describe('flashcardImageCapture', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.createElement = originalCreateElement;
  });

  afterEach(() => {
    document.createElement = originalCreateElement;
  });

  describe('durable-write ownership', () => {
    it('never persists a capture: an observation has no owner yet', async () => {
      mockCanvasCreation('data:image/jpeg;base64,OK');

      const result = await captureFlashcardImage(readyVideo());

      expect(result).toBe('data:image/jpeg;base64,OK');
      expect(mockSaveFlashcardImage).not.toHaveBeenCalled();
    });

    it('repeated captures of the same video do not leak durable files', async () => {
      mockCanvasCreation('data:image/jpeg;base64,FRAME');
      const video = readyVideo();
      document.querySelector = vi.fn((selector: string) => (selector === 'video' ? video : null)) as never;

      for (let i = 0; i < 25; i += 1) {
        expect(await captureVideoFrameForFlashcard()).toBe('data:image/jpeg;base64,FRAME');
      }

      expect(mockSaveFlashcardImage).not.toHaveBeenCalled();
    });
  });

  describe('captureFlashcardImage', () => {
    it('returns prepared image bytes on success', async () => {
      mockCanvasCreation('data:image/jpeg;base64,OK');

      const result = await captureFlashcardImage(readyVideo());

      expect(result).toBe('data:image/jpeg;base64,OK');
    });

    it('returns null when the source cannot be captured', async () => {
      mockCanvasCreation(null);

      const result = await captureFlashcardImage(readyVideo());

      expect(result).toBeNull();
    });
  });

  describe('captureVideoFrameForFlashcard', () => {
    it('returns prepared image bytes for the current video', async () => {
      mockCanvasCreation('data:image/jpeg;base64,OK');
      const video = readyVideo(1280, 720);
      document.querySelector = vi.fn((selector: string) => (selector === 'video' ? video : null)) as never;

      const result = await captureVideoFrameForFlashcard();

      expect(result).toBe('data:image/jpeg;base64,OK');
      expect(mockSaveFlashcardImage).not.toHaveBeenCalled();
    });

    it('returns null when there is no video', async () => {
      document.querySelector = vi.fn(() => null) as never;

      expect(await captureVideoFrameForFlashcard()).toBeNull();
    });
  });

  describe('captureReaderImageForOccurrence', () => {
    it('crops to the target occurrence rather than the whole page', async () => {
      const { canvas, ctx } = mockCanvasCreation('data:image/jpeg;base64,CROP');
      const img = readyImage(1000, 1500);
      img.getBoundingClientRect = vi.fn(() => new DOMRect(0, 0, 500, 750));

      const result = await captureReaderImageForOccurrence(img, new DOMRect(200, 300, 100, 50), {
        cropPadding: 40,
      });

      expect(result).toBe('data:image/jpeg;base64,CROP');
      expect(ctx.drawImage).toHaveBeenCalled();
      expect(mockSaveFlashcardImage).not.toHaveBeenCalled();
    });

    it('returns null without an anchor: a targetless page image is not card media', async () => {
      const { ctx } = mockCanvasCreation('data:image/jpeg;base64,PAGE');
      const img = readyImage();
      img.getBoundingClientRect = vi.fn(() => new DOMRect(0, 0, 500, 750));

      expect(await captureReaderImageForOccurrence(img, undefined)).toBeNull();
      expect(ctx.drawImage).not.toHaveBeenCalled();
      expect(mockSaveFlashcardImage).not.toHaveBeenCalled();
    });

    it('returns null for a zero-sized anchor', async () => {
      mockCanvasCreation('data:image/jpeg;base64,PAGE');
      const img = readyImage();
      img.getBoundingClientRect = vi.fn(() => new DOMRect(0, 0, 500, 750));

      expect(await captureReaderImageForOccurrence(img, new DOMRect(10, 10, 0, 0))).toBeNull();
    });

    it('returns null for a page image that never decoded', async () => {
      mockCanvasCreation('data:image/jpeg;base64,CROP');
      const img = readyImage();
      Object.defineProperty(img, 'naturalWidth', { value: 0, writable: true });
      Object.defineProperty(img, 'naturalHeight', { value: 0, writable: true });
      img.getBoundingClientRect = vi.fn(() => new DOMRect(0, 0, 500, 750));

      expect(await captureReaderImageForOccurrence(img, new DOMRect(200, 300, 100, 50))).toBeNull();
    });

    it('produces a distinct capture per occurrence on one page', async () => {
      const { canvas, ctx } = mockCanvasCreation('data:image/jpeg;base64,CROP');
      const img = readyImage(1000, 1500);
      img.getBoundingClientRect = vi.fn(() => new DOMRect(0, 0, 500, 750));

      await captureReaderImageForOccurrence(img, new DOMRect(100, 100, 60, 40), { cropPadding: 40 });
      const firstDraw = ctx.drawImage.mock.calls[0].slice(1);

      await captureReaderImageForOccurrence(img, new DOMRect(380, 600, 60, 40), { cropPadding: 40 });
      const secondDraw = ctx.drawImage.mock.calls[1].slice(1);

      expect(firstDraw).not.toEqual(secondDraw);
      expect(canvas.toDataURL).toHaveBeenCalledTimes(2);
      // Sharing source decoding is fine; sharing a targetless final image is not.
      expect(mockSaveFlashcardImage).not.toHaveBeenCalled();
    });
  });

  describe('captureFallbackImage', () => {
    it('returns prepared center-crop bytes for an image', async () => {
      mockCanvasCreation('data:image/jpeg;base64,CENTER');

      const result = await captureFallbackImage(readyImage(800, 600));

      expect(result).toBe('data:image/jpeg;base64,CENTER');
      expect(mockSaveFlashcardImage).not.toHaveBeenCalled();
    });

    it('returns null for a video source', async () => {
      const result = await captureFallbackImage(readyVideo());

      expect(result).toBeNull();
    });
  });
});
