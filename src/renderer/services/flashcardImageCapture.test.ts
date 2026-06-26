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
  captureReaderImageForFlashcard,
  captureFallbackImage,
} from './flashcardImageCapture';

const originalCreateElement = document.createElement.bind(document);

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

describe('flashcardImageCapture', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.createElement = originalCreateElement;
  });

  afterEach(() => {
    document.createElement = originalCreateElement;
  });

  describe('captureFlashcardImage', () => {
    it('returns a flashcard-image:// URL on success', async () => {
      mockCanvasCreation('data:image/jpeg;base64,OK');
      mockSaveFlashcardImage.mockResolvedValue('flashcard-image://card-1');

      const video = document.createElement('video');
      Object.defineProperty(video, 'videoWidth', { value: 640, writable: true });
      Object.defineProperty(video, 'videoHeight', { value: 360, writable: true });
      Object.defineProperty(video, 'readyState', { value: HTMLMediaElement.HAVE_CURRENT_DATA, writable: true });

      const result = await captureFlashcardImage(video, 'card-1');

      expect(result).toBe('flashcard-image://card-1');
      expect(mockSaveFlashcardImage).toHaveBeenCalledWith('card-1', 'data:image/jpeg;base64,OK');
    });

    it('returns null when the source has no dimensions', async () => {
      mockCanvasCreation();
      mockSaveFlashcardImage.mockResolvedValue('flashcard-image://card-2');

      const video = document.createElement('video');
      Object.defineProperty(video, 'videoWidth', { value: 0, writable: true });
      Object.defineProperty(video, 'videoHeight', { value: 0, writable: true });
      Object.defineProperty(video, 'clientWidth', { value: 0, writable: true });
      Object.defineProperty(video, 'clientHeight', { value: 0, writable: true });
      Object.defineProperty(video, 'readyState', { value: HTMLMediaElement.HAVE_CURRENT_DATA, writable: true });

      const result = await captureFlashcardImage(video, 'card-2');

      expect(result).toBeNull();
      expect(mockSaveFlashcardImage).not.toHaveBeenCalled();
    });

    it('retries and succeeds when the video becomes ready after waiting', async () => {
      vi.useFakeTimers();
      mockCanvasCreation('data:image/jpeg;base64,RETRY');
      mockSaveFlashcardImage.mockResolvedValue('flashcard-image://card-3');

      const video = document.createElement('video');
      Object.defineProperty(video, 'videoWidth', { value: 0, writable: true });
      Object.defineProperty(video, 'videoHeight', { value: 0, writable: true });
      Object.defineProperty(video, 'clientWidth', { value: 0, writable: true });
      Object.defineProperty(video, 'clientHeight', { value: 0, writable: true });
      Object.defineProperty(video, 'readyState', { value: HTMLMediaElement.HAVE_NOTHING, writable: true });

      const capturePromise = captureFlashcardImage(video, 'card-3', { readinessTimeoutMs: 500 });

      await vi.advanceTimersByTimeAsync(50);
      Object.defineProperty(video, 'videoWidth', { value: 640, writable: true });
      Object.defineProperty(video, 'videoHeight', { value: 360, writable: true });
      Object.defineProperty(video, 'readyState', { value: HTMLMediaElement.HAVE_CURRENT_DATA, writable: true });
      video.dispatchEvent(new Event('canplay'));

      const result = await capturePromise;

      expect(result).toBe('flashcard-image://card-3');
      expect(mockSaveFlashcardImage).toHaveBeenCalledWith('card-3', 'data:image/jpeg;base64,RETRY');

      vi.useRealTimers();
    });

    it('uses fallback when primary capture fails but fallback succeeds', async () => {
      const { canvas } = mockCanvasCreation();
      mockSaveFlashcardImage.mockResolvedValue('flashcard-image://card-4');

      canvas.toDataURL = vi
        .fn()
        .mockReturnValueOnce(null)
        .mockReturnValue('data:image/jpeg;base64,FALLBACK');

      const img = document.createElement('img');
      Object.defineProperty(img, 'naturalWidth', { value: 800, writable: true });
      Object.defineProperty(img, 'naturalHeight', { value: 600, writable: true });
      Object.defineProperty(img, 'complete', { value: true, writable: true });

      const result = await captureFlashcardImage(img, 'card-4');

      expect(result).toBe('flashcard-image://card-4');
      expect(mockSaveFlashcardImage).toHaveBeenCalledWith('card-4', 'data:image/jpeg;base64,FALLBACK');
    });

    it('returns null when primary capture and retry both fail for video', async () => {
      vi.useFakeTimers();
      mockCanvasCreation();
      mockSaveFlashcardImage.mockResolvedValue('flashcard-image://fallback');

      const video = document.createElement('video');
      Object.defineProperty(video, 'videoWidth', { value: 0, writable: true });
      Object.defineProperty(video, 'videoHeight', { value: 0, writable: true });
      Object.defineProperty(video, 'clientWidth', { value: 0, writable: true });
      Object.defineProperty(video, 'clientHeight', { value: 0, writable: true });
      Object.defineProperty(video, 'readyState', { value: HTMLMediaElement.HAVE_NOTHING, writable: true });

      const capturePromise = captureFlashcardImage(video, 'card-fail', { readinessTimeoutMs: 50 });
      await vi.advanceTimersByTimeAsync(100);
      const result = await capturePromise;

      expect(result).toBeNull();
      expect(mockSaveFlashcardImage).not.toHaveBeenCalled();

      vi.useRealTimers();
    });
  });

  describe('captureVideoFrameForFlashcard', () => {
    it('returns null when no video element is present', async () => {
      document.querySelector = vi.fn(() => null);

      const result = await captureVideoFrameForFlashcard('card-5');

      expect(result).toBeNull();
    });

    it('captures the current video element when it is ready', async () => {
      mockCanvasCreation('data:image/jpeg;base64,VIDEO');
      mockSaveFlashcardImage.mockResolvedValue('flashcard-image://card-6');

      const video = document.createElement('video');
      Object.defineProperty(video, 'videoWidth', { value: 1280, writable: true });
      Object.defineProperty(video, 'videoHeight', { value: 720, writable: true });
      Object.defineProperty(video, 'readyState', { value: HTMLMediaElement.HAVE_CURRENT_DATA, writable: true });

      document.querySelector = vi.fn((selector: string) => (selector === 'video' ? video : null));

      const result = await captureVideoFrameForFlashcard('card-6');

      expect(result).toBe('flashcard-image://card-6');
    });
  });

  describe('captureReaderImageForFlashcard', () => {
    it('returns a flashcard-image:// URL for a ready page image', async () => {
      mockCanvasCreation('data:image/jpeg;base64,PAGE');
      mockSaveFlashcardImage.mockResolvedValue('flashcard-image://card-7');

      const img = document.createElement('img');
      Object.defineProperty(img, 'naturalWidth', { value: 800, writable: true });
      Object.defineProperty(img, 'naturalHeight', { value: 1200, writable: true });
      Object.defineProperty(img, 'complete', { value: true, writable: true });

      const result = await captureReaderImageForFlashcard(img, 'card-7');

      expect(result).toBe('flashcard-image://card-7');
    });

    it('falls back to an anchor-based crop when full capture fails', async () => {
      const { canvas, ctx } = mockCanvasCreation();
      mockSaveFlashcardImage.mockResolvedValue('flashcard-image://card-8');

      canvas.toDataURL = vi
        .fn()
        .mockReturnValueOnce(null)
        .mockReturnValueOnce(null)
        .mockReturnValue('data:image/jpeg;base64,CROP');

      const img = document.createElement('img');
      Object.defineProperty(img, 'naturalWidth', { value: 1000, writable: true });
      Object.defineProperty(img, 'naturalHeight', { value: 1500, writable: true });
      Object.defineProperty(img, 'complete', { value: true, writable: true });
      img.getBoundingClientRect = vi.fn(() => new DOMRect(0, 0, 500, 750));

      const anchorRect = new DOMRect(200, 300, 100, 50);
      const result = await captureReaderImageForFlashcard(img, 'card-8', {
        anchorRect,
        cropPadding: 40,
      });

      expect(result).toBe('flashcard-image://card-8');
      expect(ctx.drawImage).toHaveBeenCalled();
    });
  });

  describe('captureFallbackImage', () => {
    it('returns a flashcard-image:// URL for an image via center crop', async () => {
      mockCanvasCreation('data:image/jpeg;base64,CENTER');
      mockSaveFlashcardImage.mockResolvedValue('flashcard-image://card-9');

      const img = document.createElement('img');
      Object.defineProperty(img, 'naturalWidth', { value: 800, writable: true });
      Object.defineProperty(img, 'naturalHeight', { value: 600, writable: true });
      Object.defineProperty(img, 'complete', { value: true, writable: true });

      const result = await captureFallbackImage(img, 'card-9');

      expect(result).toBe('flashcard-image://card-9');
    });

    it('returns null for a video source', async () => {
      const video = document.createElement('video');
      Object.defineProperty(video, 'videoWidth', { value: 0, writable: true });
      Object.defineProperty(video, 'videoHeight', { value: 0, writable: true });
      Object.defineProperty(video, 'readyState', { value: HTMLMediaElement.HAVE_NOTHING, writable: true });

      const result = await captureFallbackImage(video, 'card-10');

      expect(result).toBeNull();
    });
  });
});
