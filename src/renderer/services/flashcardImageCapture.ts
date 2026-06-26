import { getBridge } from '../../shared/bridges';
import { getLogger } from '../../shared/utils/logger';
import { captureElementAndSave, type CanvasCaptureOptions } from './canvasCapture';

const log = getLogger('renderer.services.flashcardImageCapture');

export interface FlashcardImageCaptureOptions extends CanvasCaptureOptions {
  /** Timeout in ms to wait for source readiness before giving up. Default 500. */
  readinessTimeoutMs?: number;
  /** For reader images: optional anchor rectangle to crop around if full capture fails. */
  anchorRect?: DOMRect;
  /** Padding around anchorRect for crop fallback. Default 200. */
  cropPadding?: number;
}

const DEFAULT_READINESS_TIMEOUT_MS = 500;

function isVideoElement(source: HTMLVideoElement | HTMLImageElement): source is HTMLVideoElement {
  return source instanceof HTMLVideoElement;
}

function isImageElement(source: HTMLVideoElement | HTMLImageElement): source is HTMLImageElement {
  return source instanceof HTMLImageElement;
}

function getSourceDimensions(source: HTMLVideoElement | HTMLImageElement): { width: number; height: number } {
  if (isVideoElement(source)) {
    return {
      width: source.videoWidth || source.clientWidth || 0,
      height: source.videoHeight || source.clientHeight || 0,
    };
  }
  return {
    width: source.naturalWidth || source.width || 0,
    height: source.naturalHeight || source.height || 0,
  };
}

function isSourceReady(source: HTMLVideoElement | HTMLImageElement): boolean {
  const dimensions = getSourceDimensions(source);
  if (dimensions.width === 0 || dimensions.height === 0) {
    return false;
  }
  if (isVideoElement(source)) {
    return source.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA;
  }
  return source.complete;
}

function waitForSourceReady(
  source: HTMLVideoElement | HTMLImageElement,
  timeoutMs: number,
): Promise<boolean> {
  return new Promise((resolve) => {
    if (isSourceReady(source)) {
      resolve(true);
      return;
    }

    const cleanupFns: Array<() => void> = [];
    let settled = false;

    const settle = (ready: boolean) => {
      if (settled) return;
      settled = true;
      for (const cleanup of cleanupFns) cleanup();
      resolve(ready);
    };

    const timeoutId = window.setTimeout(() => settle(false), timeoutMs);
    cleanupFns.push(() => window.clearTimeout(timeoutId));

    if (isVideoElement(source)) {
      const onReady = () => settle(true);
      source.addEventListener('canplay', onReady, { once: true });
      source.addEventListener('loadeddata', onReady, { once: true });
      source.addEventListener('loadedmetadata', onReady, { once: true });
      cleanupFns.push(() => {
        source.removeEventListener('canplay', onReady);
        source.removeEventListener('loadeddata', onReady);
        source.removeEventListener('loadedmetadata', onReady);
      });
      source.addEventListener('error', () => settle(false), { once: true });
    } else {
      const onReady = () => settle(true);
      source.addEventListener('load', onReady, { once: true });
      cleanupFns.push(() => source.removeEventListener('load', onReady));

      if (typeof source.decode === 'function') {
        source.decode().then(() => settle(true)).catch(() => {
          // decoding failure leaves the load/error listeners and timeout in charge
        });
      }

      source.addEventListener('error', () => settle(false), { once: true });
    }
  });
}

/**
 * Save a data URL via the flashcard image bridge.
 */
async function saveDataUrl(cardId: string, dataUrl: string | null): Promise<string | null> {
  if (!dataUrl) return null;
  try {
    return await getBridge().flashcards.saveFlashcardImage(cardId, dataUrl);
  } catch (e) {
    log.error('Failed to save flashcard image:', e);
    return null;
  }
}

/**
 * Capture a video or image element and persist it as a flashcard image.
 * If the source is not ready, waits up to ~500ms for readiness events and retries once.
 * @returns flashcard-image:// URL, or null when capture or save fails.
 */
export async function captureFlashcardImage(
  source: HTMLVideoElement | HTMLImageElement,
  cardId: string,
  options?: FlashcardImageCaptureOptions,
): Promise<string | null> {
  const timeoutMs = options?.readinessTimeoutMs ?? DEFAULT_READINESS_TIMEOUT_MS;

  const primary = await captureElementAndSave(source, cardId, options);
  if (primary) return primary;

  if (!isSourceReady(source)) {
    const becameReady = await waitForSourceReady(source, timeoutMs);
    if (becameReady) {
      const retried = await captureElementAndSave(source, cardId, options);
      if (retried) return retried;
    }
  }

  return await captureFallbackImage(source, cardId, options);
}

/**
 * Find the current <video> element and capture a frame for a flashcard.
 * @returns flashcard-image:// URL, or null when no ready video is found.
 */
export async function captureVideoFrameForFlashcard(
  cardId: string,
  options?: FlashcardImageCaptureOptions,
): Promise<string | null> {
  const video = document.querySelector('video');
  if (!video) return null;
  return await captureFlashcardImage(video, cardId, options);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

async function captureAnchorCropImage(
  pageImage: HTMLImageElement,
  cardId: string,
  anchorRect: DOMRect,
  cropPadding: number,
): Promise<string | null> {
  try {
    const imageRect = pageImage.getBoundingClientRect();
    if (!pageImage.naturalWidth || !pageImage.naturalHeight) return null;

    const requestedPadding = cropPadding;
    const maxPadding = Math.floor(Math.min(imageRect.width, imageRect.height) / 3);
    const padding = Math.min(requestedPadding, maxPadding);

    const sourceLeft = anchorRect.left - padding;
    const sourceTop = anchorRect.top - padding;
    const sourceWidth = anchorRect.width + padding * 2;
    const sourceHeight = anchorRect.height + padding * 2;

    const visibleLeft = clamp(sourceLeft, imageRect.left, imageRect.right);
    const visibleTop = clamp(sourceTop, imageRect.top, imageRect.bottom);
    const visibleRight = clamp(sourceLeft + sourceWidth, imageRect.left, imageRect.right);
    const visibleBottom = clamp(sourceTop + sourceHeight, imageRect.top, imageRect.bottom);

    const visibleWidth = Math.max(1, visibleRight - visibleLeft);
    const visibleHeight = Math.max(1, visibleBottom - visibleTop);

    const scaleX = pageImage.naturalWidth / Math.max(1, imageRect.width);
    const scaleY = pageImage.naturalHeight / Math.max(1, imageRect.height);

    const imageSourceX = (visibleLeft - imageRect.left) * scaleX;
    const imageSourceY = (visibleTop - imageRect.top) * scaleY;
    const imageSourceWidth = visibleWidth * scaleX;
    const imageSourceHeight = visibleHeight * scaleY;

    const canvas = document.createElement('canvas');
    canvas.width = Math.min(4096, Math.max(1, Math.floor(imageSourceWidth)));
    canvas.height = Math.min(4096, Math.max(1, Math.floor(imageSourceHeight)));

    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    ctx.drawImage(
      pageImage,
      imageSourceX,
      imageSourceY,
      imageSourceWidth,
      imageSourceHeight,
      0,
      0,
      canvas.width,
      canvas.height,
    );

    const dataUrl = canvas.toDataURL('image/jpeg', 0.5);
    return await saveDataUrl(cardId, dataUrl);
  } catch (e) {
    log.error('Failed to capture anchor crop image:', e);
    return null;
  }
}

/**
 * Capture a reader page image element for a flashcard.
 * If the full-page capture fails and an anchorRect is provided, falls back to an
 * anchor-based crop similar to captureOcrScreenshot (without the highlight box).
 * @returns flashcard-image:// URL, or null when capture or save fails.
 */
export async function captureReaderImageForFlashcard(
  pageImage: HTMLImageElement,
  cardId: string,
  options?: FlashcardImageCaptureOptions,
): Promise<string | null> {
  const captured = await captureFlashcardImage(pageImage, cardId, options);
  if (captured) return captured;

  if (options?.anchorRect && options.anchorRect.width > 0 && options.anchorRect.height > 0) {
    return await captureAnchorCropImage(
      pageImage,
      cardId,
      options.anchorRect,
      options.cropPadding ?? 200,
    );
  }

  return null;
}

async function captureCenterCropImage(
  source: HTMLImageElement,
  cardId: string,
  options?: FlashcardImageCaptureOptions,
): Promise<string | null> {
  try {
    const { width: naturalWidth, height: naturalHeight } = getSourceDimensions(source);
    if (naturalWidth === 0 || naturalHeight === 0) return null;

    const fallbackRatio = 0.6;
    const cropWidth = naturalWidth * fallbackRatio;
    const cropHeight = naturalHeight * fallbackRatio;
    const sx = (naturalWidth - cropWidth) / 2;
    const sy = (naturalHeight - cropHeight) / 2;

    const canvas = document.createElement('canvas');
    canvas.width = Math.min(480, Math.max(1, Math.floor(cropWidth)));
    canvas.height = Math.min(480, Math.max(1, Math.floor(cropHeight)));

    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    ctx.drawImage(source, sx, sy, cropWidth, cropHeight, 0, 0, canvas.width, canvas.height);

    const dataUrl = canvas.toDataURL('image/jpeg', options?.quality ?? 0.5);
    return await saveDataUrl(cardId, dataUrl);
  } catch (e) {
    log.error('Failed to capture center crop image:', e);
    return null;
  }
}

/**
 * Fallback capture when primary captureElementToDataUrl returns null.
 * For images, attempts a center crop of the source image.
 * For video, the wait-and-retry is handled by captureFlashcardImage; this returns null.
 * @returns flashcard-image:// URL, or null when all alternate strategies fail.
 */
export async function captureFallbackImage(
  source: HTMLVideoElement | HTMLImageElement,
  cardId: string,
  options?: FlashcardImageCaptureOptions,
): Promise<string | null> {
  if (isImageElement(source)) {
    return await captureCenterCropImage(source, cardId, options);
  }

  return null;
}
