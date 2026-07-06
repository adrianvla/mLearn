import { getBridge } from '../../shared/bridges';
import { getLogger } from '../../shared/utils/logger';

const log = getLogger('renderer.services.canvasCapture');

export interface CanvasCaptureOptions {
  maxWidth?: number;
  quality?: number;
  format?: 'image/jpeg' | 'image/png';
  rejectBlank?: boolean;
  onCaptureBlocked?: () => void;
}

function isVideoSource(source: HTMLVideoElement | HTMLImageElement): source is HTMLVideoElement {
  return 'videoWidth' in source;
}

function isCanvasSecurityError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'SecurityError';
}

function isMostlyBlankCanvas(ctx: CanvasRenderingContext2D, width: number, height: number): boolean {
  const sampleWidth = Math.min(width, 64);
  const sampleHeight = Math.min(height, 64);
  const imageData = ctx.getImageData(0, 0, sampleWidth, sampleHeight).data;
  let lumaSum = 0;
  let lumaSquaredSum = 0;
  const pixelCount = imageData.length / 4;

  for (let index = 0; index < imageData.length; index += 4) {
    const luma = (imageData[index] * 0.2126) + (imageData[index + 1] * 0.7152) + (imageData[index + 2] * 0.0722);
    lumaSum += luma;
    lumaSquaredSum += luma * luma;
  }

  const mean = lumaSum / pixelCount;
  const variance = (lumaSquaredSum / pixelCount) - (mean * mean);
  return mean < 8 && variance < 12;
}

/**
 * Capture a video or image element to a data URL.
 * @returns JPEG/PNG data URL, or null when the source has no dimensions.
 */
export function captureElementToDataUrl(
  source: HTMLVideoElement | HTMLImageElement,
  options?: CanvasCaptureOptions,
): string | null {
  const { maxWidth = 480, quality = 0.5, format = 'image/jpeg', rejectBlank = false, onCaptureBlocked } = options ?? {};

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

    if (rejectBlank && isMostlyBlankCanvas(ctx, targetWidth, targetHeight)) {
      return null;
    }

    return canvas.toDataURL(format, quality);
  } catch (e) {
    if (isCanvasSecurityError(e)) {
      onCaptureBlocked?.();
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
