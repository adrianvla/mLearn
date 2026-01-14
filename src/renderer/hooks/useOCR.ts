/**
 * OCR Hook
 * Optical Character Recognition for images/screenshots
 */

import { createSignal } from 'solid-js';
import { PORTS } from '../../shared/constants';
import { useServer } from '../context';

interface OCRResult {
  text: string;
  boxes?: Array<{
    text: string;
    x: number;
    y: number;
    width: number;
    height: number;
  }>;
}

export function useOCR() {
  const { isConnected } = useServer();
  const [isProcessing, setIsProcessing] = createSignal(false);
  const [lastResult, setLastResult] = createSignal<OCRResult | null>(null);
  const [error, setError] = createSignal<string | null>(null);

  // Perform OCR on an image URL
  const recognizeUrl = async (imageUrl: string): Promise<OCRResult | null> => {
    if (!isConnected()) {
      setError('Backend not connected');
      return null;
    }

    setIsProcessing(true);
    setError(null);

    try {
      const response = await fetch(`http://localhost:${PORTS.PYTHON_BACKEND}/ocr`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_url: imageUrl }),
      });

      if (!response.ok) {
        throw new Error(`OCR request failed: ${response.status}`);
      }

      const result: OCRResult = await response.json();
      setLastResult(result);
      return result;
    } catch (e) {
      const message = e instanceof Error ? e.message : 'OCR failed';
      setError(message);
      return null;
    } finally {
      setIsProcessing(false);
    }
  };

  // Perform OCR on base64 image data
  const recognizeBase64 = async (base64Data: string): Promise<OCRResult | null> => {
    if (!isConnected()) {
      setError('Backend not connected');
      return null;
    }

    setIsProcessing(true);
    setError(null);

    try {
      const response = await fetch(`http://localhost:${PORTS.PYTHON_BACKEND}/ocr`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_data: base64Data }),
      });

      if (!response.ok) {
        throw new Error(`OCR request failed: ${response.status}`);
      }

      const result: OCRResult = await response.json();
      setLastResult(result);
      return result;
    } catch (e) {
      const message = e instanceof Error ? e.message : 'OCR failed';
      setError(message);
      return null;
    } finally {
      setIsProcessing(false);
    }
  };

  // Perform OCR on a File object
  const recognizeFile = async (file: File): Promise<OCRResult | null> => {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = async () => {
        const base64 = (reader.result as string).split(',')[1];
        const result = await recognizeBase64(base64);
        resolve(result);
      };
      reader.onerror = () => {
        setError('Failed to read file');
        resolve(null);
      };
      reader.readAsDataURL(file);
    });
  };

  // Perform OCR on a canvas element
  const recognizeCanvas = async (
    canvas: HTMLCanvasElement,
    type: 'image/png' | 'image/jpeg' = 'image/png'
  ): Promise<OCRResult | null> => {
    const dataUrl = canvas.toDataURL(type);
    const base64 = dataUrl.split(',')[1];
    return recognizeBase64(base64);
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
      const message = e instanceof Error ? e.message : 'Screen capture failed';
      setError(message);
      return null;
    }
  };

  return {
    isProcessing,
    lastResult,
    error,
    
    recognizeUrl,
    recognizeBase64,
    recognizeFile,
    recognizeCanvas,
    recognizeVideoFrame,
    captureAndRecognize,
    
    clearError: () => setError(null),
    clearResult: () => setLastResult(null),
  };
}
