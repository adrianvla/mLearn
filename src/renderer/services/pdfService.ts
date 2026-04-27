/**
 * PDF Service
 * Handles PDF file processing and conversion to images
 * Uses pdf.js for rendering PDF pages to images
 */

// Import pdf.js library - this creates window.pdfjsLib
import './pdf.mjs';
import { getLogger } from '../../shared/utils/logger';

const log = getLogger("renderer.services.pdf");

interface PdfJsViewport {
  width: number;
  height: number;
}

interface PdfJsPage {
  getViewport: (options: { scale: number }) => PdfJsViewport;
  render: (options: { canvasContext: CanvasRenderingContext2D; viewport: PdfJsViewport }) => { promise: Promise<void> };
}

interface PdfJsDocument {
  numPages: number;
  getPage: (pageNumber: number) => Promise<PdfJsPage>;
  cleanup: () => void;
}

interface PdfJsLoadingTask {
  promise: Promise<PdfJsDocument>;
}

interface PdfJsLib {
  GlobalWorkerOptions: {
    workerSrc: string;
  };
  getDocument: (options: {
    data: ArrayBuffer;
    useWorkerFetch: boolean;
    isEvalSupported: boolean;
    disableAutoFetch: boolean;
  }) => PdfJsLoadingTask;
}

declare global {
  interface Window {
    pdfjsLib?: PdfJsLib;
  }
}

export interface PageImage {
  name: string;
  url: string;
  blob: Blob;
  source: string;
  index: number;
}

// Flag to track if pdf.js has been configured
let pdfJsConfigured = false;

/**
 * Get the pdf.js library instance and configure it
 */
async function getPdfJs(): Promise<PdfJsLib> {
  // pdf.js attaches to window.pdfjsLib
  if (typeof window !== 'undefined' && window.pdfjsLib) {
    const pdfjsLib = window.pdfjsLib;
    
    // Configure worker only once
    // In Electron we can disable the worker since we're not in a web context
    // This avoids the "No GlobalWorkerOptions.workerSrc specified" error
    if (!pdfJsConfigured) {
      pdfjsLib.GlobalWorkerOptions.workerSrc = '';
      pdfJsConfigured = true;
    }
    
    return pdfjsLib;
  }
  throw new Error('pdf.js library not loaded');
}

/**
 * Remove file extension from filename
 */
function stripExtension(name: string): string {
  const idx = name.lastIndexOf('.');
  return idx > 0 ? name.slice(0, idx) : name;
}

/**
 * Check if a file is a PDF
 */
export function isPdfFile(file: File): boolean {
  return file.name.toLowerCase().endsWith('.pdf') || file.type === 'application/pdf';
}

/**
 * Convert a PDF file to an array of page images
 * @param file - The PDF file to convert
 * @param options - Optional configuration
 * @returns Array of PageImage objects, one per PDF page
 */
export async function pdfToImages(
  file: File, 
  options: { scale?: number; sourceName?: string } = {}
): Promise<PageImage[]> {
  const scale = options.scale ?? 2; // 2x for readability
  const sourceName = options.sourceName ?? stripExtension(file.name);
  
  const pdfjsLib = await getPdfJs();
  const data = await file.arrayBuffer();
  
  // Disable worker and use main thread for PDF processing in Electron
  const loadingTask = pdfjsLib.getDocument({ 
    data, 
    useWorkerFetch: false,
    isEvalSupported: false,
    disableAutoFetch: true,
  });
  const pdf = await loadingTask.promise;
  
  const images: PageImage[] = [];
  
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale });
    
    // Create canvas for rendering
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Failed to get canvas 2D context');
    }
    
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    
    // Render page to canvas
    await page.render({ canvasContext: ctx, viewport }).promise;
    
    // Convert canvas to blob
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => {
          if (b) resolve(b);
          else reject(new Error('Failed to create blob from canvas'));
        },
        'image/png'
      );
    });
    
    const url = URL.createObjectURL(blob);
    
    images.push({
      name: `page-${String(i).padStart(3, '0')}.png`,
      url,
      blob,
      source: sourceName,
      index: i - 1,
    });
  }
  
  // Cleanup
  try {
    pdf.cleanup();
  } catch (e) {
    log.error("error", e);
    // Ignore cleanup errors
  }
  
  return images;
}

/**
 * Check if files contain a PDF
 */
export function containsPdf(files: File[]): File | null {
  return files.find(f => isPdfFile(f)) ?? null;
}
