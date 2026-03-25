/**
 * OCR Hook - Rewritten to match legacy app implementation
 * Optical Character Recognition for images/screenshots
 * With proper image compression and FormData support
 */

import { createSignal } from 'solid-js';
import { useServer, useLowPowerGate } from '../context';
import { useSettings } from '../context/SettingsContext';
import { getBackend, CloudOCRAdapter, resolveCloudApiUrl } from '../../shared/backends';

// Max target area for OCR (preserve aspect ratio) - matches legacy app
const MAX_OCR_AREA_TURBO = 1000 * 1600; // 1.6M pixels — turbo mode
const MAX_OCR_AREA_ACCURATE = 1600 * 2400; // 3.84M pixels — accurate mode

interface OCRBox {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface OCRResult {
  text: string;
  boxes?: OCRBox[];
  client_scale?: number;
  downscale_factor?: number;
  original_size?: { width: number; height: number };
  sent_size?: { width: number; height: number };
}

interface PreparedImage {
  blob: Blob;
  clientScale: number;
  originalW: number;
  originalH: number;
  sentW: number;
  sentH: number;
}

/**
 * Transcode any image Blob to PNG using canvas (CSP-safe)
 */
async function transcodeBlobToPng(
  blob: Blob,
  targetW?: number,
  targetH?: number
): Promise<Blob> {
  // Try ImageBitmap path first (no URL required)
  try {
    if (typeof createImageBitmap === 'function') {
      const bmp = await createImageBitmap(blob);
      const w = targetW || bmp.width;
      const h = targetH || bmp.height;

      const useOffscreen = typeof OffscreenCanvas !== 'undefined';
      const canvas = useOffscreen
        ? new OffscreenCanvas(w, h)
        : document.createElement('canvas');

      if (!useOffscreen) {
        (canvas as HTMLCanvasElement).width = w;
        (canvas as HTMLCanvasElement).height = h;
      }

      const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
      if (!ctx) throw new Error('Failed to get canvas context');
      ctx.drawImage(bmp, 0, 0, w, h);

      if (useOffscreen && typeof (canvas as OffscreenCanvas).convertToBlob === 'function') {
        return await (canvas as OffscreenCanvas).convertToBlob({ type: 'image/png', quality: 0.92 });
      }

      return await new Promise((resolve, reject) => {
        (canvas as HTMLCanvasElement).toBlob(
          (b) => (b ? resolve(b) : reject(new Error('Failed to create PNG blob'))),
          'image/png',
          0.92
        );
      });
    }
  } catch (e) {
    console.error(e);
    /* fallthrough to data URL path */
  }

  // Fallback: data URL via FileReader (allowed by img-src 'self' data:)
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result as string);
    fr.onerror = () => reject(new Error('Failed to read blob as data URL'));
    fr.readAsDataURL(blob);
  });

  const img = new Image();
  img.decoding = 'async';
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('Failed to load data URL for transcode'));
    img.src = dataUrl;
  });

  const w = targetW || img.naturalWidth || img.width;
  const h = targetH || img.naturalHeight || img.height;
  if (!w || !h) throw new Error('Image has no intrinsic size');

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Failed to get canvas context');
  ctx.drawImage(img, 0, 0, w, h);

  return await new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Failed to create PNG blob'))),
      'image/png',
      0.92
    );
  });
}

/**
 * Prepare blob for OCR - read dimensions and resize/transcode if needed
 */
async function prepareBlobForOCR(blob: Blob, turbo = true): Promise<PreparedImage> {
  const maxOcrArea = turbo ? MAX_OCR_AREA_TURBO : MAX_OCR_AREA_ACCURATE;
  let w = 0;
  let h = 0;

  try {
    if (typeof createImageBitmap === 'function') {
      const bmp = await createImageBitmap(blob);
      w = bmp.width;
      h = bmp.height;
    } else {
      // Fallback: use FileReader->Image path
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(fr.result as string);
        fr.onerror = () => reject(new Error('Failed to read blob as data URL'));
        fr.readAsDataURL(blob);
      });
      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('Failed to load image'));
        img.src = dataUrl;
      });
      w = img.naturalWidth || img.width;
      h = img.naturalHeight || img.height;
    }
  } catch (e) {
    console.error(e);
    /* ignore; we will attempt direct transcode at native size */
  }

  // Compute target size under maxOcrArea while preserving aspect ratio
  let targetW = w;
  let targetH = h;
  if (w && h) {
    const area = w * h;
    if (area > maxOcrArea) {
      const scale = Math.sqrt(maxOcrArea / area);
      targetW = Math.max(1, Math.floor(w * scale));
      targetH = Math.max(1, Math.floor(h * scale));
    }
  }

  const t = (blob.type || '').toLowerCase();
  const needTranscode = t !== 'image/png' || (w && h && w * h > maxOcrArea);
  const clientScale = w && h && targetW && targetH && w > 0 && h > 0 ? targetW / w : 1;

  if (!needTranscode) {
    return {
      blob,
      clientScale,
      originalW: w || 0,
      originalH: h || 0,
      sentW: w || 0,
      sentH: h || 0,
    };
  }

  const outBlob = await transcodeBlobToPng(blob, targetW || undefined, targetH || undefined);
  return {
    blob: outBlob,
    clientScale,
    originalW: w || 0,
    originalH: h || 0,
    sentW: targetW || w || 0,
    sentH: targetH || h || 0,
  };
}

/**
 * Convert various input types to prepared blob for OCR
 */
async function inputToBlobForOCR(
  input: Blob | HTMLCanvasElement | HTMLImageElement | string,
  turbo = true,
): Promise<PreparedImage> {
  const maxOcrArea = turbo ? MAX_OCR_AREA_TURBO : MAX_OCR_AREA_ACCURATE;
  // If it's a Blob/File already
  if (input instanceof Blob) {
    return prepareBlobForOCR(input, turbo);
  }

  // If it's a canvas
  if (input instanceof HTMLCanvasElement) {
    const w = input.width;
    const h = input.height;
    const area = w * h;

    if (area > maxOcrArea) {
      const scale = Math.sqrt(maxOcrArea / area);
      const newW = Math.max(1, Math.floor(w * scale));
      const newH = Math.max(1, Math.floor(h * scale));
      const canvas = document.createElement('canvas');
      canvas.width = newW;
      canvas.height = newH;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Failed to get canvas context');
      ctx.drawImage(input, 0, 0, newW, newH);

      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error('Failed to create blob from canvas'))),
          'image/png',
          0.92
        );
      });
      return {
        blob,
        clientScale: newW / w,
        originalW: w,
        originalH: h,
        sentW: newW,
        sentH: newH,
      };
    }

    const blob = await new Promise<Blob>((resolve, reject) => {
      input.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('Failed to create blob from canvas'))),
        'image/png',
        0.92
      );
    });
    return {
      blob,
      clientScale: 1,
      originalW: w,
      originalH: h,
      sentW: w,
      sentH: h,
    };
  }

  // If it's an image element
  if (input instanceof HTMLImageElement) {
    const w = input.naturalWidth || input.width;
    const h = input.naturalHeight || input.height;
    if (!w || !h) throw new Error('Image has no intrinsic size');

    const area = w * h;
    let newW = w;
    let newH = h;
    if (area > maxOcrArea) {
      const scale = Math.sqrt(maxOcrArea / area);
      newW = Math.max(1, Math.floor(w * scale));
      newH = Math.max(1, Math.floor(h * scale));
    }

    const canvas = document.createElement('canvas');
    canvas.width = newW;
    canvas.height = newH;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Failed to get canvas context');

    try {
      ctx.drawImage(input, 0, 0, newW, newH);
    } catch (e) {
      console.error(e);
      // Cross-origin taint - try fetching the src directly
      const res = await fetch(input.src, { mode: 'cors' });
      const blob = await res.blob();
      return prepareBlobForOCR(blob, turbo);
    }

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('Failed to create blob from image'))),
        'image/png',
        0.92
      );
    });
    return {
      blob,
      clientScale: newW / w,
      originalW: w,
      originalH: h,
      sentW: newW,
      sentH: newH,
    };
  }

  // If it's a data URL string
  if (typeof input === 'string' && input.startsWith('data:')) {
    const response = await fetch(input);
    const blob = await response.blob();
    return prepareBlobForOCR(blob, turbo);
  }

  // If it's a URL string
  if (typeof input === 'string') {
    const res = await fetch(input, { mode: 'cors' });
    const blob = await res.blob();
    return prepareBlobForOCR(blob, turbo);
  }

  throw new Error('Unsupported input type for OCR');
}

/**
 * Send image to OCR backend using FormData (matches legacy implementation)
 */
async function sendImageForOCR(
  imageInput: Blob | HTMLCanvasElement | HTMLImageElement | string,
  ocrUrl: string,
  headers?: Record<string, string>,
  turbo = true,
): Promise<OCRResult> {
  const prepared = await inputToBlobForOCR(imageInput, turbo);

  const form = new FormData();
  // Name the file for better server-side defaults
  form.append('file', prepared.blob, 'image.png');
  form.append('turbo', turbo ? '1' : '0');

  const response = await fetch(ocrUrl, {
    method: 'POST',
    headers,
    body: form,
    // Do not set Content-Type manually for FormData
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OCR request failed: ${response.status} - ${errorText}`);
  }

  const result = (await response.json()) as OCRResult;

  // Attach client-side scaling metadata for overlay consumers
  result.client_scale = prepared.clientScale;
  result.downscale_factor = prepared.clientScale > 0 ? 1 / prepared.clientScale : 1;
  result.original_size = { width: prepared.originalW, height: prepared.originalH };
  result.sent_size = { width: prepared.sentW, height: prepared.sentH };

  return result;
}

export function useOCR() {
  const { isConnected } = useServer();
  const { settings } = useSettings();
  const { requestAccess } = useLowPowerGate();
  const [isProcessing, setIsProcessing] = createSignal(false);
  const [lastResult, setLastResult] = createSignal<OCRResult | null>(null);
  const [error, setError] = createSignal<string | null>(null);

  const isCloudOCR = () => settings.ocrProvider === 'cloud';

  const getLocalOCRUrl = (): string => {
    return getBackend().buildUrl('/ocr');
  };

  /** Run OCR via the cloud HATEOAS job flow (CloudOCRAdapter) */
  const recognizeViaCloud = async (imageBlob: Blob, turbo: boolean): Promise<OCRResult> => {
    const cloudApiUrl = resolveCloudApiUrl(settings);
    const cloudToken = (settings.cloudAuthAccessToken || settings.cloudAuthToken || '').trim();
    if (!cloudToken) throw new Error('Cloud OCR requires authentication. Please log in to Cloud first.');

    const adapter = new CloudOCRAdapter(cloudApiUrl, cloudToken);
    const language = settings.language;
    const engine = turbo ? 'rapid' : undefined;
    const result = await adapter.recognize(imageBlob, language, engine);

    return {
      text: result.text,
      boxes: result.boxes,
    };
  };

  // Perform OCR on various input types
  const recognize = async (
    input: Blob | HTMLCanvasElement | HTMLImageElement | string
  ): Promise<OCRResult | null> => {
    if (!isCloudOCR() && !isConnected()) {
      setError('Backend not connected');
      return null;
    }

    setIsProcessing(true);
    setError(null);

    // Low power gate: prompt before using local neural network for OCR
    if (!isCloudOCR()) {
      const allowed = await requestAccess('ocr');
      if (!allowed) {
        setIsProcessing(false);
        return null;
      }
    }

    try {
      const turbo = settings.ocrTurboMode ?? true;

      if (isCloudOCR()) {
        // Prepare the blob, then send via CloudOCRAdapter
        const prepared = await inputToBlobForOCR(input, turbo);
        const result = await recognizeViaCloud(prepared.blob, turbo);
        result.client_scale = prepared.clientScale;
        result.downscale_factor = prepared.clientScale > 0 ? 1 / prepared.clientScale : 1;
        result.original_size = { width: prepared.originalW, height: prepared.originalH };
        result.sent_size = { width: prepared.sentW, height: prepared.sentH };
        setLastResult(result);
        return result;
      }

      const result = await sendImageForOCR(
        input,
        getLocalOCRUrl(),
        undefined,
        turbo,
      );
      setLastResult(result);
      return result;
    } catch (e) {
      console.error(e);
      const message = e instanceof Error ? e.message : 'OCR failed';
      setError(message);
      return null;
    } finally {
      setIsProcessing(false);
    }
  };

  // Perform OCR on an image URL
  const recognizeUrl = async (imageUrl: string): Promise<OCRResult | null> => {
    return recognize(imageUrl);
  };

  // Perform OCR on base64 image data
  const recognizeBase64 = async (base64Data: string): Promise<OCRResult | null> => {
    // Convert base64 to data URL if not already
    const dataUrl = base64Data.startsWith('data:')
      ? base64Data
      : `data:image/png;base64,${base64Data}`;
    return recognize(dataUrl);
  };

  // Perform OCR on a File object
  const recognizeFile = async (file: File): Promise<OCRResult | null> => {
    return recognize(file);
  };

  // Perform OCR on a Blob
  const recognizeBlob = async (blob: Blob): Promise<OCRResult | null> => {
    return recognize(blob);
  };

  // Perform OCR on a canvas element
  const recognizeCanvas = async (canvas: HTMLCanvasElement): Promise<OCRResult | null> => {
    return recognize(canvas);
  };

  // Perform OCR on a video frame
  const recognizeVideoFrame = async (video: HTMLVideoElement): Promise<OCRResult | null> => {
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      setError('Failed to create canvas context');
      return null;
    }

    ctx.drawImage(video, 0, 0);
    return recognizeCanvas(canvas);
  };

  // Capture screenshot and perform OCR (Electron only)
  const captureAndRecognize = async (): Promise<OCRResult | null> => {
    const win = window as unknown as { mlearn?: { captureScreen?: () => Promise<string> } };

    if (!win.mlearn?.captureScreen) {
      setError('Screen capture not available');
      return null;
    }

    try {
      const base64 = await win.mlearn.captureScreen();
      return recognizeBase64(base64);
    } catch (e) {
      console.error(e);
      const message = e instanceof Error ? e.message : 'Screen capture failed';
      setError(message);
      return null;
    }
  };

  return {
    isProcessing,
    lastResult,
    error,

    recognize,
    recognizeUrl,
    recognizeBase64,
    recognizeFile,
    recognizeBlob,
    recognizeCanvas,
    recognizeVideoFrame,
    captureAndRecognize,

    clearError: () => setError(null),
    clearResult: () => setLastResult(null),
  };
}

// Export helper for external use
export { sendImageForOCR, prepareBlobForOCR, MAX_OCR_AREA_TURBO, MAX_OCR_AREA_ACCURATE };
