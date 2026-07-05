import { getBridge } from '../../shared/bridges';
import { getLogger } from '../../shared/utils/logger';

const log = getLogger('renderer.services.canvasCapture');

export interface CanvasCaptureOptions {
  maxWidth?: number;
  quality?: number;
  format?: 'image/jpeg' | 'image/png';
}

function isVideoSource(source: HTMLVideoElement | HTMLImageElement): source is HTMLVideoElement {
  return 'videoWidth' in source;
}

function isCanvasSecurityError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'SecurityError';
}

/**
 * Capture a video or image element to a data URL.
 * @returns JPEG/PNG data URL, or null when the source has no dimensions.
 */
export function captureElementToDataUrl(
  source: HTMLVideoElement | HTMLImageElement,
  options?: CanvasCaptureOptions,
): string | null {
  const { maxWidth = 480, quality = 0.5, format = 'image/jpeg' } = options ?? {};

  try {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      log.warn('Failed to get canvas 2D context');
      return null;
    }

    let srcWidth: number;
    let srcHeight: number;

    if (isVideoSource(source)) {
      srcWidth = source.videoWidth || source.clientWidth || 0;
      srcHeight = source.videoHeight || source.clientHeight || 0;
    } else {
      srcWidth = source.naturalWidth || source.width || 0;
      srcHeight = source.naturalHeight || source.height || 0;
    }

    if (srcWidth === 0 || srcHeight === 0) {
      log.warn('Source has no dimensions');
      return null;
    }

    const aspectRatio = srcHeight / srcWidth;
    const targetWidth = Math.min(srcWidth, maxWidth);
    const targetHeight = Math.round(targetWidth * aspectRatio);

    canvas.width = targetWidth;
    canvas.height = targetHeight;

    ctx.drawImage(source, 0, 0, targetWidth, targetHeight);

    return canvas.toDataURL(format, quality);
  } catch (e) {
    if (isCanvasSecurityError(e)) {
      log.debug('Skipping thumbnail capture because the canvas is tainted by the media source');
      return null;
    }
    log.error('Failed to capture element:', e);
    return null;
  }
}

/**
 * Capture a video or image element and save it via the flashcard image bridge.
 * @returns flashcard-image:// URL, or null when capture or save fails.
 */
export async function captureElementAndSave(
  source: HTMLVideoElement | HTMLImageElement,
  cardId: string,
  options?: CanvasCaptureOptions,
): Promise<string | null> {
  const dataUrl = captureElementToDataUrl(source, options);
  if (!dataUrl) return null;
  return await getBridge().flashcards.saveFlashcardImage(cardId, dataUrl);
}
