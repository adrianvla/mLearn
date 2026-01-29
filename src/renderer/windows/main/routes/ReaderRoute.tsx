/**
 * Reader Route
 * Manga/Image OCR reader integrated into main window via router
 */

import { Component, createSignal, For, Show, onMount, onCleanup, createEffect, batch } from 'solid-js';
import { createStore } from 'solid-js/store';
import { useNavigate } from '@solidjs/router';
import { OcrOverlay, type OcrResult } from '../../../components/reader';
import { WordHover } from '../../../components/subtitle/WordHover';
import { useOCR, prepareBlobForOCR, useTranslation, useDictionary, useWordHover, getCachedTranslation } from '../../../hooks';
import { useSettings } from '../../../context';
import type { Token, TranslationResponse, DictionaryEntry } from '../../../../shared/types';
import { API_ENDPOINTS } from '../../../../shared/constants';
import { ReaderNav, ReaderSidebar, ReaderWelcomeCard, ReaderStatusBar } from './components';
import { ProgressRing } from '../../../components/common';
import { isPdfFile, pdfToImages } from '../../../services/pdfService';
import { captureBlobThumbnail, saveToRecentItems } from '../../../services/thumbnailService';
import { parseWorkName } from '../../../utils/subtitleParsing';
import './reader.css';

interface PageImage {
  id: string;
  src: string;
  name: string;
  index: number;
  blob?: Blob;
}

type FitMode = 'fit-height' | 'fit-width';
type PageMode = 'double' | 'single';

// OCR results cache by page id
const [ocrResults, setOcrResults] = createStore<Record<string, OcrResult>>({});

// Queue system for OCR to ensure serial processing (1 at a time)
// and allow cancellation of pending tasks by simply removing them from queue.
interface OcrTask {
  page: PageImage;
  isCaching: boolean; // true if this is a background caching task, not visible
}
const [ocrQueue, setOcrQueue] = createSignal<OcrTask[]>([]);
const [processingTask, setProcessingTask] = createSignal<OcrTask | null>(null);

// Per-book page memory (like old app's sequencer.js)
const STORAGE_KEY_PREFIX = 'reader:last-page:';
const makeStorageKey = (bookId: string) => `${STORAGE_KEY_PREFIX}${bookId}`;

const loadSavedPageIndex = (bookId: string | null): number | null => {
  if (!bookId) return null;
  try {
    const raw = localStorage.getItem(makeStorageKey(bookId));
    if (raw === null) return null;
    const val = parseInt(raw, 10);
    return Number.isFinite(val) ? val : null;
  } catch (err) {
    console.warn('[Reader] Failed to read saved page index', err);
    return null;
  }
};

const persistPageIndex = (bookId: string | null, pageIndex: number, totalPages: number) => {
  if (!bookId || totalPages === 0) return;
  const normalized = Math.min(Math.max(pageIndex, 0), totalPages - 1);
  try {
    localStorage.setItem(makeStorageKey(bookId), String(normalized));
  } catch (err) {
    console.warn('[Reader] Failed to persist page index', err);
  }
};

// Extract folder name from a path or first file
// Used when drag-n-dropping a folder - we want the folder name
const extractFolderName = (filePath: string): string => {
  // filePath could be "folder/image.png" or just "folder" from webkitGetAsEntry
  // We want the directory part
  const parts = filePath.split('/').filter(Boolean);
  
  // If it looks like a file path (has extension), get parent dir
  if (parts.length >= 2 && /\.[^.]+$/.test(parts[parts.length - 1])) {
    return parts[parts.length - 2];
  }
  
  // Otherwise it's likely the folder name itself
  return parts[parts.length - 1] || filePath;
};

export const ReaderRoute: Component = () => {
  const navigate = useNavigate();
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { isProcessing: _ocrHookProcessing } = useOCR();
  const { settings } = useSettings();
  const { translateWord } = useTranslation({ immediate: true });
  const { lookup } = useDictionary();
  const { hoverData: ocrHoverData, isVisible: isOcrHoverVisible, showHover: showOcrHover, hideHover: hideOcrHover, cancelHide: cancelOcrHide } = useWordHover();

  const [pages, setPages] = createSignal<PageImage[]>([]);
  const [currentPage, setCurrentPage] = createSignal(0);
  const [currentBookId, setCurrentBookId] = createSignal<string | null>(null);
  // Track the filesystem path of the current book (PDF file or directory)
  // Used for persisting to recent items so users can click to re-open
  const [currentBookPath, setCurrentBookPath] = createSignal<string>('');
  const [fitMode, setFitMode] = createSignal<FitMode>('fit-height');
  const [pageMode, setPageMode] = createSignal<PageMode>('double');
  // When true and in double-page mode, first page displays alone (cover page)
  // This offsets the pairing: [0], [1,2], [3,4]... instead of [0,1], [2,3]...
  const [firstPageSingle, setFirstPageSingle] = createSignal(true);
  
  // Helper: get the valid spread-start index for a given page in double-page mode
  // firstSingle=true:  valid starts are 0, 1, 3, 5, 7... (0 alone, then odd numbers)
  // firstSingle=false: valid starts are 0, 2, 4, 6...    (even numbers)
  // Rounds UP to prevent backward drift when toggling modes
  const getSpreadStart = (pageIdx: number, firstSingle: boolean): number => {
    if (pageIdx <= 0) return 0;
    if (firstSingle) {
      // After page 0, spreads start at odd indices: 1, 3, 5...
      if (pageIdx % 2 === 1) return pageIdx; // already odd, valid
      // Even page - round UP to next odd to prevent backward drift
      return pageIdx + 1;
    } else {
      // Spreads start at even indices: 0, 2, 4, 6...
      if (pageIdx % 2 === 0) return pageIdx; // already even, valid
      // Odd page - round UP to next even to prevent backward drift
      return pageIdx + 1;
    }
  };
  const [showSidebar, setShowSidebar] = createSignal(true);
  const [bookTitle, setBookTitle] = createSignal('Nothing Loaded');
  const [ocrStatus, setOcrStatus] = createSignal('Ready');
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [isProcessingOcr, _setIsProcessingOcr] = createSignal(false);
  const [isDragging, setIsDragging] = createSignal(false);
  const [ocrProgress, setOcrProgress] = createSignal(0);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_currentOcrResult, _setCurrentOcrResult] = createSignal<OcrResult | null>(null);
  const [showOcrOverlay, setShowOcrOverlay] = createSignal(true);
  const [ocrDictionaryEntries, setOcrDictionaryEntries] = createSignal<DictionaryEntry[]>([]);
  const [ocrTranslationData, setOcrTranslationData] = createSignal<TranslationResponse | null>(null);
  const [ocrWordStatus, setOcrWordStatus] = createSignal<'unknown' | 'learning' | 'known'>('unknown');
  
  // OCR Progress Tracking
  // Total pages that need OCR in the current book (set once when book loads)
  const [ocrBatchTotal, setOcrBatchTotal] = createSignal(0);
  // Track which page IDs have been counted as "done" to avoid double counting
  const [ocrCompletedIds, setOcrCompletedIds] = createSignal<Set<string>>(new Set());
  
  // Server-side OCR progress (MangaOCR processing status from backend)
  // e.g. "Processing 23%" or "Loading model..."
  const [serverOcrProgress, setServerOcrProgress] = createSignal<number | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_serverOcrMessage, setServerOcrMessage] = createSignal<string>('');

  // Latched status text per page - holds the last visible status during fade-out
  // This prevents text from changing while the overlay is fading out
  const [latchedStatusByPage, setLatchedStatusByPage] = createSignal<Record<string, string>>({});

  // References for OCR overlay positioning
  let pageContainerRef: HTMLDivElement | undefined;
  const [imageRefs, setImageRefs] = createSignal<Record<string, HTMLImageElement>>({});

  // Returns files, the name of the dropped folder, and the full filesystem path (if available)
  // In Electron, dropped items have a .path property on the dataTransfer.files entries
  const getDroppedFiles = async (dataTransfer: DataTransfer | null): Promise<{ 
    files: File[], 
    droppedFolderName: string | null,
    droppedFolderPath: string | null 
  }> => {
    if (!dataTransfer) return { files: [], droppedFolderName: null, droppedFolderPath: null };
    
    const items = Array.from(dataTransfer.items || []);
    const rawFiles = Array.from(dataTransfer.files || []);
    
    // In Electron, the raw files from dataTransfer.files have a .path property
    // This is the full filesystem path - capture it before using webkit entries API
    // (which creates new File objects without the path property)
    let droppedFolderPath: string | null = null;
    if (rawFiles.length > 0) {
      const firstRawFile = rawFiles[0] as File & { path?: string };
      if (firstRawFile.path) {
        droppedFolderPath = firstRawFile.path;
      }
    }

    const hasEntries = items.some((item) => typeof (item as any).webkitGetAsEntry === 'function');
    if (!hasEntries) {
      return { files: rawFiles, droppedFolderName: null, droppedFolderPath };
    }

    let droppedFolderName: string | null = null;

    const readEntry = async (entry: any): Promise<File[]> => {
      if (!entry) return [];
      if (entry.isFile) {
        return new Promise((resolve) => {
          entry.file((file: File) => resolve([file]));
        });
      }
      if (entry.isDirectory) {
        // Capture the folder name from the top-level directory entry
        if (!droppedFolderName) {
          droppedFolderName = entry.name;
        }
        const reader = entry.createReader();
        const entries: any[] = [];
        const readAll = (): Promise<void> => new Promise((resolve) => {
          reader.readEntries((batch: any[]) => {
            if (batch.length === 0) return resolve();
            entries.push(...batch);
            resolve(readAll());
          });
        });
        await readAll();
        const nested = await Promise.all(entries.map((child) => readEntry(child)));
        return nested.flat();
      }
      return [];
    };

    const entryFiles = await Promise.all(
      items
        .map((item) => (item as any).webkitGetAsEntry?.())
        .filter(Boolean)
        .map((entry) => readEntry(entry))
    );

    return { files: entryFiles.flat(), droppedFolderName, droppedFolderPath };
  };

  const visiblePages = () => {
    const p = pages();
    const curr = currentPage();
    
    if (pageMode() === 'single') {
      return p[curr] ? [p[curr]] : [];
    } else {
      // Double page mode
      // If firstPageSingle is true and we're on page 0, show only page 0
      if (firstPageSingle() && curr === 0) {
        return p[0] ? [p[0]] : [];
      }
      const result: PageImage[] = [];
      if (p[curr]) result.push(p[curr]);
      if (p[curr + 1]) result.push(p[curr + 1]);
      return result;
    }
  };

  // Automatic OCR + cache next pages
  createEffect(() => {
    const allPages = pages();
    if (allPages.length === 0) return;
    const base = currentPage();
    const isDouble = pageMode() === 'double';
    
    // Determine visible pages
    const visibleIndices: number[] = [base];
    if (isDouble) visibleIndices.push(base + 1);
    
    // Determine caching pages (next 2)
    const nextStart = base + (isDouble ? 2 : 1);
    const cacheIndices: number[] = [nextStart, nextStart + 1];
    
    // Get the currently processing task's page id (if any)
    // We must not add this to the queue again to avoid duplicate processing checks
    const currentlyProcessingId = processingTask()?.page.id ?? null;
    
    // Build task queue with visible pages first, then caching pages
    const tasks: OcrTask[] = [];
    
    // Visible pages (high priority)
    for (const idx of visibleIndices) {
      const page = allPages[idx];
      // Skip if already cached, or currently being processed
      if (page && !ocrResults[page.id] && page.id !== currentlyProcessingId) {
        tasks.push({ page, isCaching: false });
      }
    }
    
    // Caching pages (lower priority)
    for (const idx of cacheIndices) {
      const page = allPages[idx];
      // Skip if already cached, or currently being processed
      if (page && !ocrResults[page.id] && page.id !== currentlyProcessingId) {
        tasks.push({ page, isCaching: true });
      }
    }

    // Don't reset batch metrics on navigation - they're set once when book loads
    // Progress is tracked via ocrCompletedIds
    
    // Update Queue: Replace entire queue with new priorities
    // This effectively "cancels" any pending tasks that are not in the new target set.
    setOcrQueue(tasks);
    
    // Update status immediately when page/queue changes
    // This ensures "Cleaning Up…" shows when user navigates while processing
    updateOverallStatus();
    
    // Trigger processing
    processQueue();
  });

  // Serial Queue Processor
  const processQueue = async () => {
    if (processingTask()) return; // Already working
    
    const queue = ocrQueue();
    if (queue.length === 0) {
      // Queue is empty - update status
      const total = ocrBatchTotal();
      const done = ocrCompletedIds().size;
      if (total > 0) {
         setOcrProgress((done / total) * 100);
      }
      updateOverallStatus();
      return;
    }

    const task = queue[0];
    setOcrQueue(q => q.slice(1)); // Pop
    setProcessingTask(task);
    updateOverallStatus();

    try {
      await performOcr(task.page);
    } finally {
      // Reset server OCR progress for next page
      setServerOcrProgress(null);
      setServerOcrMessage('');
      
      // Track completed page (only count each page once)
      const pageId = task.page.id;
      if (!ocrCompletedIds().has(pageId)) {
        setOcrCompletedIds(prev => {
          const next = new Set(prev);
          next.add(pageId);
          return next;
        });
      }
      
      setProcessingTask(null);
      // Process next
      processQueue();
    }
  };

  const performOcr = async (page: PageImage) => {
    // Reset server progress at start of each page
    setServerOcrProgress(null);
    setServerOcrMessage('');
    
    // Silent background process - only update status bar text
    // Note: status bar text is handled by updateOverallStatus based on processingTask
    
    try {
      let imageBlob: Blob;

      if (page.blob) {
        imageBlob = page.blob;
      } else {
         if (!page.blob) {
             const resp = await fetch(page.src);
             imageBlob = await resp.blob();
         } else {
             imageBlob = page.blob;
         }
      }
      
      const prepared = await prepareBlobForOCR(imageBlob);

      const formData = new FormData();
      formData.append('file', prepared.blob, 'image.png');

      const response = await fetch(API_ENDPOINTS.ocr, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`OCR request failed: ${response.status}`);
      }

      const result = (await response.json()) as OcrResult;

      result.client_scale = prepared.clientScale;
      result.downscale_factor = prepared.clientScale > 0 ? 1 / prepared.clientScale : 1;
      result.original_size = { width: prepared.originalW, height: prepared.originalH };
      result.sent_size = { width: prepared.sentW, height: prepared.sentH };

      setOcrResults(page.id, result);
      return result;
    } catch (error) {
      console.error('OCR error:', error);
      // We don't set error status globally to avoid flashing errors for background tasks
      return null;
    }
  };

  const updateOverallStatus = () => {
    const currentTask = processingTask();
    const queue = ocrQueue();
    const visible = visiblePages();
    const currPageIdx = currentPage();
    const isDouble = pageMode() === 'double';
    
    // Visible page index range
    const visibleStart = currPageIdx;
    const visibleEnd = isDouble ? currPageIdx + 1 : currPageIdx;
    
    // Maximum visible pages based on layout mode - this is the Y in "X/Y"
    const maxVisibleCount = isDouble ? 2 : 1;
    
    // Check if we're actively processing something
    if (currentTask) {
      const taskPageIdx = currentTask.page.index;
      
      // Determine relationship of processing page to current view
      if (taskPageIdx < visibleStart) {
        // Processing a page BEFORE current view (user navigated forward)
        // Show "Cleaning Up…" without any fraction
        setOcrStatus('Cleaning Up…');
        return;
      }
      
      if (taskPageIdx >= visibleStart && taskPageIdx <= visibleEnd) {
        // Processing a VISIBLE page
        // If single page mode: just "Recognizing..." (no fraction)
        // If double page mode: "Processing X/Y" where Y is always maxVisibleCount (1 or 2)
        
        if (maxVisibleCount === 1) {
          // Single page mode - just show "Recognizing..." without fraction
          setOcrStatus('Recognizing...');
        } else {
          // Double page mode - show "Processing X/Y"
          // X = which visible page we're processing (1 or 2)
          // Find position of current task in visible pages
          const visiblePageIds = visible.map(p => p.id);
          const processingIdx = visiblePageIds.indexOf(currentTask.page.id);
          const xValue = processingIdx >= 0 ? processingIdx + 1 : 1;
          setOcrStatus(`Processing ${xValue}/${maxVisibleCount}`);
        }
        return;
      }
      
      // Processing a page AFTER current view (caching ahead)
      // Show "Caching X/Y" where Y is maxVisibleCount (same as visible layout)
      const cachePageIndices = [visibleEnd + 1, visibleEnd + 2].filter(idx => idx < pages().length);
      const processingCacheIdx = cachePageIndices.indexOf(taskPageIdx);
      const xValue = processingCacheIdx >= 0 ? processingCacheIdx + 1 : 1;
      setOcrStatus(`Caching ${xValue}/${maxVisibleCount}`);
      return;
    }
    
    // No active task - check queue
    if (queue.length > 0) {
      const nextTask = queue[0];
      const nextPageIdx = nextTask.page.index;
      
      if (nextPageIdx < visibleStart) {
        // Next in queue is before current view - cleaning up
        setOcrStatus('Cleaning Up…');
        return;
      }
      
      if (nextPageIdx >= visibleStart && nextPageIdx <= visibleEnd) {
        // Visible page is queued but not yet processing - waiting to start
        setOcrStatus('Loading Neural Network...');
        return;
      }
      
      // Caching pages are queued - show caching status
      setOcrStatus(`Caching 1/${maxVisibleCount}`);
      return;
    }

    // No tasks - check if all visible pages are done
    const allVisibleDone = visible.every(p => ocrResults[p.id]);
    if (allVisibleDone) {
      setOcrStatus('Ready');
    } else {
      // Visible pages don't have OCR yet but nothing is processing - show waiting
      setOcrStatus('Loading Neural Network...');
    }
  };

  // Helper for manual run (force) - kept for potential future use
  const requestOcrForPage = (page: PageImage) => {
     // Add to front of queue if not there?
     // Actually manual run usually implies "do it now".
     // We can just add to queue and trigger.
     setOcrQueue(prev => [{ page, isCaching: false }, ...prev.filter(p => p.page.id !== page.id)]);
     processQueue();
  };
  // Prevent "unused" warnings - used for manual page OCR triggering
  void requestOcrForPage;

  const runOcr = async () => {
    const visible = visiblePages();
    // Prioritize visible pages in queue
    setOcrQueue(prev => {
        const visibleIds = visible.map(v => v.id);
        const others = prev.filter(p => !visibleIds.includes(p.page.id));
        const visibleTasks: OcrTask[] = visible.map(p => ({ page: p, isCaching: false }));
        return [...visibleTasks, ...others];
    });
    processQueue();
  };

  // Load book from filesystem path (for recent items)
  const loadBookFromPath = async (bookPath: string) => {
    if (!window.mLearnIPC) {
      console.warn('[Reader] IPC not available, cannot load from path');
      return;
    }

    setOcrStatus('Loading...');
    
    try {
      // Check if it's a PDF file or a directory
      const isPdf = /\.pdf$/i.test(bookPath);
      
      if (isPdf) {
        // Load PDF file
        const result = await window.mLearnIPC.readPdfFile(bookPath);
        const blob = new Blob([result.data], { type: 'application/pdf' });
        const fileName = bookPath.split('/').pop() || 'document.pdf';
        const file = new File([blob], fileName, { type: 'application/pdf' });
        
        const pdfImages = await pdfToImages(file);
        // For PDF: use filename only (stripped)
        const bookId = parseWorkName(fileName);
        setCurrentBookId(bookId);
        // Store the path for recent items persistence
        setCurrentBookPath(bookPath);
        
        const savedPageIndex = loadSavedPageIndex(bookId);
        const startPage = savedPageIndex !== null && savedPageIndex >= 0 && savedPageIndex < pdfImages.length
          ? savedPageIndex : 0;

        const newPages: PageImage[] = pdfImages.map((img, index) => ({
          id: `page-${index}-${img.name}`,
          src: img.url,
          name: img.name,
          index,
          blob: img.blob,
        }));

        setOcrResults({});
        batch(() => {
          setCurrentPage(startPage);
          setPages(newPages);
          setOcrBatchTotal(newPages.length);
          setOcrCompletedIds(new Set<string>());
          setBookTitle(bookId || 'PDF Document');
        });
        
        // Save to recent with the correct path
        saveToRecent(bookId || 'PDF Document', 'book', startPage, bookPath, newPages[0]?.blob);
      } else {
        // Load directory of images
        const result = await window.mLearnIPC.readDirectoryImages(bookPath);
        
        if (result.files.length === 0) {
          setOcrStatus('No images found');
          return;
        }

        // For folders: use folder name only (stripped)
        const folderName = bookPath.split('/').filter(Boolean).pop() || '';
        const bookId = parseWorkName(folderName);
        setCurrentBookId(bookId);
        // Store the path for recent items persistence
        setCurrentBookPath(bookPath);
        
        const savedPageIndex = loadSavedPageIndex(bookId);
        const startPage = savedPageIndex !== null && savedPageIndex >= 0 && savedPageIndex < result.files.length
          ? savedPageIndex : 0;

        const newPages: PageImage[] = result.files.map((file, index) => {
          const blob = new Blob([file.data]);
          return {
            id: `page-${index}-${file.name}`,
            src: URL.createObjectURL(blob),
            name: file.name,
            index,
            blob,
          };
        });

        setOcrResults({});
        batch(() => {
          setCurrentPage(startPage);
          setPages(newPages);
          setOcrBatchTotal(newPages.length);
          setOcrCompletedIds(new Set<string>());
          setBookTitle(bookId || 'Imported Book');
        });
        
        // Save to recent with the correct path
        saveToRecent(bookId || 'Imported Book', 'book', startPage, bookPath, newPages[0]?.blob);
      }
      
      setOcrStatus('Ready');
    } catch (error) {
      console.error('[Reader] Failed to load from path:', error);
      setOcrStatus('Failed to load');
    }
  };

  // Check for pending book on mount
  onMount(() => {
    const pendingBook = sessionStorage.getItem('mlearn_open_book');
    if (pendingBook) {
      sessionStorage.removeItem('mlearn_open_book');
      loadBookFromPath(pendingBook);
    }
  });
  
  // Listen to MangaOCR server status updates
  onMount(() => {
    if (!window.mLearnIPC?.onOcrStatusUpdate) return;
    
    const handleOcrStatus = (message: string) => {
      setServerOcrMessage(message);
      
      // Parse "Recognition progress X/Y" format from Python backend
      // Example: "Recognition progress 13/65" should become ~20%
      const progressFractionMatch = message.match(/progress\s+(\d+)\s*\/\s*(\d+)/i);
      if (progressFractionMatch) {
        const current = parseInt(progressFractionMatch[1], 10);
        const total = parseInt(progressFractionMatch[2], 10);
        if (total > 0) {
          const percent = Math.round((current / total) * 100);
          setServerOcrProgress(percent);
          return;
        }
      }
      
      // Parse percentage from message like "Processing 45%" or similar
      const percentMatch = message.match(/(\d+(?:\.\d+)?)\s*%/);
      if (percentMatch) {
        setServerOcrProgress(parseFloat(percentMatch[1]));
        return;
      }
      
      // Model loading/init phase - show indeterminate
      if (message.toLowerCase().includes('loading') || 
          message.toLowerCase().includes('starting') ||
          message.toLowerCase().includes('initializing')) {
        setServerOcrProgress(null);
        return;
      }
      
      // Done/complete - full progress
      if (message.toLowerCase().includes('done') || message.toLowerCase().includes('complete')) {
        setServerOcrProgress(100);
        return;
      }
      
      // Unknown message type - keep previous state
    };
    
    window.mLearnIPC.onOcrStatusUpdate(handleOcrStatus);
  });

  // Keyboard navigation
  onMount(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') prevPage();
      if (e.key === 'ArrowRight') nextPage();
      if (e.key === 'Escape') navigate('/');
      if (e.key === 'o' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        runOcr();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    onCleanup(() => document.removeEventListener('keydown', handleKeyDown));
  });

  const handleDrop = async (e: DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const { files: droppedFiles, droppedFolderName, droppedFolderPath } = await getDroppedFiles(e.dataTransfer || null);
    
    // Check for PDF file first
    const pdfFile = droppedFiles.find(f => isPdfFile(f));
    
    if (pdfFile) {
      // Handle PDF file
      setOcrStatus('Loading PDF...');
      try {
        const pdfImages = await pdfToImages(pdfFile);
        
        // For PDF: use filename only (stripped)
        const bookId = parseWorkName(pdfFile.name);
        setCurrentBookId(bookId);
        
        // In Electron, File objects have a .path property with the full filesystem path
        // For PDFs dropped directly, use the path from the file
        // If coming from folder entry API, use droppedFolderPath (which would be the PDF path)
        const pdfPath = (pdfFile as File & { path?: string }).path || droppedFolderPath || '';
        setCurrentBookPath(pdfPath);
        
        // Check for saved page position
        const savedPageIndex = loadSavedPageIndex(bookId);
        let startPage = 0;
        
        if (savedPageIndex !== null && savedPageIndex >= 0 && savedPageIndex < pdfImages.length) {
          startPage = savedPageIndex;
          console.log(`[Reader] Restored page position ${startPage} for PDF "${bookId}"`);
        }

        const newPages: PageImage[] = pdfImages.map((img, index) => ({
          id: `page-${index}-${img.name}`,
          src: img.url,
          name: img.name,
          index,
          blob: img.blob,
        }));

        // Clear OCR cache when loading new book
        setOcrResults({});
        
        batch(() => {
          setCurrentPage(startPage);
          setPages(newPages);
          // Initialize OCR batch tracking for the new book
          setOcrBatchTotal(newPages.length);
          setOcrCompletedIds(new Set<string>());
          
          // Save to recent with the first page as thumbnail
          const title = bookId || 'PDF Document';
          setBookTitle(title);
          saveToRecent(title, 'book', startPage, pdfPath, newPages[0]?.blob);
        });
        setOcrStatus('Ready');
        return;
      } catch (error) {
        console.error('Failed to load PDF:', error);
        setOcrStatus('Failed to load PDF');
        return;
      }
    }
    
    // Handle image files
    const files: File[] = [];
    for (const file of droppedFiles) {
      const isImage = file.type.startsWith('image/');
      const hasImageExtension = /\.(png|jpe?g|gif|webp|bmp|tiff?)$/i.test(file.name);
      if (isImage || hasImageExtension) {
        files.push(file);
      }
    }

    if (files.length === 0) return;

    files.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

    // Determine book ID from dropped folder name, or extract from file path
    // When a folder is drag-n-dropped, use its name directly
    let bookId: string;
    if (droppedFolderName) {
      bookId = parseWorkName(droppedFolderName);
    } else {
      // Fallback: extract from first file's path
      const firstFile = files[0] as File & { path?: string };
      const rawFolderName = firstFile?.path 
        ? extractFolderName(firstFile.path)
        : files[0].name;
      bookId = parseWorkName(rawFolderName);
    }
    setCurrentBookId(bookId);
    
    // Use droppedFolderPath from dataTransfer.files (has Electron's .path property)
    // Fallback: try to get path from first file and extract directory
    const firstFile = files[0] as File & { path?: string };
    const bookPath = droppedFolderPath || (firstFile?.path 
      ? firstFile.path.split('/').slice(0, -1).join('/') 
      : '');
    setCurrentBookPath(bookPath);
    
    // Check for saved page position using the per-book storage key
    const savedPageIndex = loadSavedPageIndex(bookId);
    let startPage = 0;
    
    if (savedPageIndex !== null && savedPageIndex >= 0 && savedPageIndex < files.length) {
      startPage = savedPageIndex;
      console.log(`[Reader] Restored page position ${startPage} for book "${bookId}"`);
    }

    const newPages: PageImage[] = files.map((file, index) => ({
      id: `page-${index}-${file.name}`,
      src: URL.createObjectURL(file),
      name: file.name,
      index,
      blob: file,
    }));

    // Clear OCR cache when loading new book
    setOcrResults({});
    
    // Use batch to ensure currentPage and pages update atomically
    // This prevents the createEffect from running with stale currentPage
    batch(() => {
      setCurrentPage(startPage);
      setPages(newPages);
      // Initialize OCR batch tracking for the new book
      setOcrBatchTotal(newPages.length);
      setOcrCompletedIds(new Set<string>());
    });
    
    // Determine title: use the folder name (stripped)
    const title = bookId || 'Imported Book';
    setBookTitle(title);
    saveToRecent(title, 'book', startPage, bookPath, newPages[0]?.blob);
  };

  const saveToRecent = async (name: string, type: 'video' | 'book', progress: number = 0, path: string = '', coverBlob?: Blob) => {
    try {
      // Capture thumbnail from the first page if available
      let thumbnail: string | undefined;
      if (coverBlob) {
        thumbnail = await captureBlobThumbnail(coverBlob);
      }
      
      saveToRecentItems({
        type,
        name,
        path,
        progress,
      }, thumbnail);
    } catch (e) {
      console.error('Failed to save recent:', e);
    }
  };

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => setIsDragging(false);

  const goToPage = (index: number) => {
    const total = pages().length;
    if (total === 0) return;
    let newPage = Math.max(0, Math.min(index, total - 1));
    
    // In double-page mode, snap to valid spread boundary
    if (pageMode() === 'double') {
      newPage = getSpreadStart(newPage, firstPageSingle());
      // Clamp again in case rounding up went past the end
      newPage = Math.min(newPage, total - 1);
    }
    
    setCurrentPage(newPage);
    
    // Persist per-book page position
    const bookId = currentBookId();
    persistPageIndex(bookId, newPage, total);
    
    // Update recent items with current page thumbnail (every 10 pages or on last page)
    // Use the tracked book path to preserve the filesystem path for re-opening
    const currentPages = pages();
    const shouldUpdateThumbnail = newPage % 10 === 0 || newPage === total - 1;
    const coverBlob = shouldUpdateThumbnail ? currentPages[newPage]?.blob : undefined;
    saveToRecent(bookTitle(), 'book', newPage, currentBookPath(), coverBlob);
  };

  const prevPage = () => {
    const curr = currentPage();
    if (pageMode() === 'single') {
      goToPage(curr - 1);
    } else {
      // Double page mode - step back by 2, goToPage will snap correctly
      // Special case: from page 1 with firstPageSingle, go to 0
      if (firstPageSingle() && curr === 1) {
        goToPage(0);
      } else {
        goToPage(curr - 2);
      }
    }
  };

  const nextPage = () => {
    const curr = currentPage();
    if (pageMode() === 'single') {
      goToPage(curr + 1);
    } else {
      // Double page mode - step forward
      // From page 0 with firstPageSingle, go to 1
      // Otherwise step by 2, goToPage will snap
      if (firstPageSingle() && curr === 0) {
        goToPage(1);
      } else {
        goToPage(curr + 2);
      }
    }
  };

  // OCR hover handlers (legacy-style hover popup)
  let ocrHoverRequestId = 0;
  // Store current context phrase for use in WordHover
  const [ocrContextPhrase, setOcrContextPhrase] = createSignal('');
  
  const handleOcrWordHover = async (token: Token, rect: DOMRect, contextPhrase: string = '') => {
    const requestId = ++ocrHoverRequestId;
    // Use actual_word (dictionary form) for translation lookup, fallback to surface
    const lookupWord = token.actual_word ?? token.surface ?? token.word;
    const displayWord = token.surface ?? token.word;
    
    // Store context phrase for LLM explain and flashcard example
    setOcrContextPhrase(contextPhrase);
    
    // Check if translation is already cached (from pre-warm)
    // This ensures pitch accent pill shows immediately on first hover
    const cachedTranslation = getCachedTranslation(lookupWord);
    
    // Set cached data if available, otherwise clear
    setOcrTranslationData(cachedTranslation);
    setOcrDictionaryEntries([]);
    
    showOcrHover({
      word: displayWord,
      token,
      translation: null,
      position: { x: rect.left + rect.width / 2, y: rect.top },
      anchorRect: rect,
      element: null,
    });

    // If not cached, fetch translation
    if (!cachedTranslation) {
      try {
        // Use dictionary form for translation lookup (handles conjugations like 屈して -> 屈する)
        const translation = await translateWord(lookupWord);
        if (requestId !== ocrHoverRequestId) return;
        setOcrTranslationData(translation);
      } catch (_e) {
        /* ignore */
      }
    }

    if (settings.showDictionary) {
      try {
        const entries = await lookup(lookupWord, token.reading);
        if (requestId !== ocrHoverRequestId) return;
        setOcrDictionaryEntries(entries);
      } catch (_e) {
        if (requestId !== ocrHoverRequestId) return;
        setOcrDictionaryEntries([]);
      }
    }
  };
  const handleOcrWordLeave = () => hideOcrHover();

  const goHome = () => navigate('/');

  const toggleOcrOverlay = () => setShowOcrOverlay(!showOcrOverlay());

  // Computed accessors for components
  const progressString = () => {
    const total = pages().length;
    if (total === 0) return '0/0';
    return `${currentPage() + 1}/${total}`;
  };

  const hasOcrResult = () => false; // Deprecated single result check
  const hasPages = () => pages().length > 0;
  const hasOcrForPage = (pageId: string) => !!ocrResults[pageId];

  return (
    <div
      class="reader-route"
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
    >

      {/* Navigation Bar */}
      <ReaderNav
        bookTitle={bookTitle}
        progressString={progressString}
        fitMode={fitMode}
        pageMode={pageMode}
        firstPageSingle={firstPageSingle}
        showOcrOverlay={showOcrOverlay}
        hasOcrResult={hasOcrResult}
        onGoHome={goHome}
        onToggleSidebar={() => setShowSidebar(!showSidebar())}
        onFitModeChange={(mode) => setFitMode(mode as FitMode)}
        onPageModeChange={(mode) => setPageMode(mode as PageMode)}
        onToggleFirstPageSingle={() => {
          const wasFirstSingle = firstPageSingle();
          const newFirstSingle = !wasFirstSingle;
          const curr = currentPage();
          setFirstPageSingle(newFirstSingle);
          
          // Check if current page is valid in the new mode
          const isValidInNewMode = curr === 0 || 
            (newFirstSingle ? curr % 2 === 1 : curr % 2 === 0);
          
          if (!isValidInNewMode && curr > 0) {
            // To prevent drift, alternate direction based on which mode we're entering:
            // Going TO odd starts (firstSingle=true): round DOWN (curr - 1)
            // Going TO even starts (firstSingle=false): round UP (curr + 1)
            const snapped = newFirstSingle ? curr - 1 : curr + 1;
            const total = pages().length;
            setCurrentPage(Math.max(0, Math.min(snapped, total - 1)));
          }
        }}
        onToggleOcrOverlay={toggleOcrOverlay}
        onPrevPage={prevPage}
        onNextPage={nextPage}
        marginLeft={"60px"}
      />

      {/* Sidebar */}
      <Show when={showSidebar()}>
        <ReaderSidebar
          pages={pages}
          currentPage={currentPage}
          hasOcrForPage={hasOcrForPage}
          onGoToPage={goToPage}
        />
      </Show>

      {/* Main Content */}
      <main class={`reader-main ${showSidebar() ? 'with-sidebar' : ''} ${fitMode()}`}>
        <Show
          when={pages().length > 0}
          fallback={<ReaderWelcomeCard isDragging={isDragging} />}
        >
          <div class={`page-container ${pageMode()}`} ref={pageContainerRef}>
            <For each={visiblePages()}>
              {(page) => {
                // Check if this page is being processed or is pending (for VISIBLE pages only)
                const currentTask = () => processingTask();
                const isProcessing = () => {
                  const task = currentTask();
                  return task !== null && task.page.id === page.id;
                };
                const isPending = () => {
                  return ocrQueue().some(q => q.page.id === page.id);
                };
                const isWaitingForOcr = () => !ocrResults[page.id] && (isProcessing() || isPending());
                
                // Get progress for the ring
                // For pending: indeterminate spinning
                // For processing: show server-side OCR progress if available
                const getOcrProgress = () => {
                  if (isPending()) return null; // Indeterminate
                  if (isProcessing()) {
                    // Use server-side MangaOCR progress if available
                    const serverProg = serverOcrProgress();
                    if (serverProg !== null) {
                      return serverProg;
                    }
                  }
                  return null;
                };
                
                // Generate status text based on page relationship to current view
                // Uses latched status from signal to prevent text changes during fade-out
                const getStatusText = () => {
                  const waiting = isWaitingForOcr();
                  const currPageIdx = currentPage();
                  const isDouble = pageMode() === 'double';
                  const visibleStart = currPageIdx;
                  const visibleEnd = isDouble ? currPageIdx + 1 : currPageIdx;

                  // Compute a fresh status if possible; otherwise use latched status
                  let computed: string | null = null;

                  if (isProcessing()) {
                    const taskPageIdx = page.index;

                    // Processing a page BEFORE current view - cleaning up old work
                    if (taskPageIdx < visibleStart) {
                      computed = 'Cleaning Up…';
                    } else if (taskPageIdx >= visibleStart && taskPageIdx <= visibleEnd) {
                      // Processing a VISIBLE page
                      computed = 'Processing...';
                    } else {
                      // Processing a page AFTER current view - caching
                      computed = 'Caching...';
                    }
                  } else if (isPending()) {
                    const taskPageIdx = page.index;
                    if (taskPageIdx < visibleStart) {
                      computed = 'Cleaning Up...';
                    } else if (taskPageIdx >= visibleStart && taskPageIdx <= visibleEnd) {
                      computed = 'Pending...';
                    } else {
                      computed = 'Queued...';
                    }
                  } else {
                    // No active or pending work for this page.
                    // If OCR result exists, it's ready; otherwise no new status to compute
                    computed = ocrResults[page.id] ? 'Ready' : null;
                  }

                  // If we have a computed status and overlay is visible, update the latch
                  if (computed !== null && waiting) {
                    setLatchedStatusByPage(prev => ({ ...prev, [page.id]: computed! }));
                    return computed;
                  }

                  // If overlay is fading out (not waiting) or no new status, return latched status
                  // This prevents text from changing during the CSS fade-out animation
                  const latched = latchedStatusByPage()[page.id];
                  return latched ?? computed ?? '';
                };
                
                return (
                  <div class="page">
                    <img
                      class="page-image"
                      src={page.src}
                      alt={page.name}
                      ref={(el) => setImageRefs(prev => ({ ...prev, [page.id]: el }))}
                    />
                    {/* Page Processing Loader - uses CSS fade animation instead of Show */}
                    <div class={`page-loader-overlay ${isWaitingForOcr() ? 'visible' : 'hidden'}`}>
                      <ProgressRing
                        progress={getOcrProgress() ?? 0}
                        indeterminate={isPending() || getOcrProgress() === null}
                        size={40}
                        strokeWidth={5}
                        statusText={getStatusText()}
                        showPercent={false}
                      />
                    </div>
                    {/* OCR Overlay for each visible page */}
                    <Show when={imageRefs()[page.id] && ocrResults[page.id]}>
                      <OcrOverlay
                        result={ocrResults[page.id]}
                        imageElement={imageRefs()[page.id]}
                        visible={showOcrOverlay()}
                        onWordHover={handleOcrWordHover}
                        onWordLeave={handleOcrWordLeave}
                      />
                    </Show>
                  </div>
                );
              }}
            </For>
          </div>
        </Show>
      </main>

      {/* Status Bar */}
      <ReaderStatusBar
        bookTitle={bookTitle}
        progressString={progressString}
        ocrStatus={ocrStatus}
        ocrProgress={ocrProgress}
        isProcessingOcr={isProcessingOcr}
        hasOcrResult={hasOcrResult}
        hasPages={hasPages}
        onRunOcr={runOcr}
      />

      <Show when={ocrHoverData() && ocrHoverData()!.token}>
        <WordHover
          token={ocrHoverData()!.token!}
          word={ocrHoverData()!.word || ocrHoverData()!.token?.surface || ocrHoverData()!.token?.word || ''}
          position={ocrHoverData()!.position}
          anchorRect={ocrHoverData()!.anchorRect}
          dictionaryEntries={ocrDictionaryEntries()}
          translationData={ocrTranslationData() || undefined}
          status={ocrWordStatus()}
          isOCR={true}
          contextPhrase={ocrContextPhrase()}
          ocrImageElement={(() => {
            // Find the correct page image based on anchor position
            // This is crucial for double-page mode where words could be on either page
            const anchorRect = ocrHoverData()!.anchorRect;
            if (anchorRect) {
              const anchorCenterX = (anchorRect.left + anchorRect.right) / 2;
              const anchorCenterY = (anchorRect.top + anchorRect.bottom) / 2;
              
              // Check each visible page's image to find the one containing the anchor
              const visible = visiblePages();
              for (const page of visible) {
                const imgEl = imageRefs()[page.id];
                if (imgEl) {
                  const imgRect = imgEl.getBoundingClientRect();
                  if (
                    anchorCenterX >= imgRect.left && anchorCenterX <= imgRect.right &&
                    anchorCenterY >= imgRect.top && anchorCenterY <= imgRect.bottom
                  ) {
                    return imgEl;
                  }
                }
              }
            }
            
            // Fallback to first visible page
            const visible = visiblePages();
            if (visible.length > 0) {
              return imageRefs()[visible[0].id] || null;
            }
            return null;
          })()}
          onStatusChange={setOcrWordStatus}
          onClose={hideOcrHover}
          visible={isOcrHoverVisible()}
          onMouseEnter={cancelOcrHide}
          onMouseLeave={hideOcrHover}
        />
      </Show>
    </div>
  );
};
