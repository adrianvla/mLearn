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

// Extract book ID from file name (removing extension and path)
const extractBookId = (fileName: string): string => {
  // Get just the filename without path
  const baseName = fileName.split('/').pop() || fileName;
  // Remove file extension
  return baseName.replace(/\.[^.]+$/, '').trim();
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
  const [fitMode, setFitMode] = createSignal<FitMode>('fit-height');
  const [pageMode, setPageMode] = createSignal<PageMode>('double');
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
  const [ocrBatchTotal, setOcrBatchTotal] = createSignal(0);
  const [ocrBatchDone, setOcrBatchDone] = createSignal(0);
  
  // Server-side OCR progress (MangaOCR processing status from backend)
  // e.g. "Processing 23%" or "Loading model..."
  const [serverOcrProgress, setServerOcrProgress] = createSignal<number | null>(null);
  const [serverOcrMessage, setServerOcrMessage] = createSignal<string>('');

  // References for OCR overlay positioning
  let pageContainerRef: HTMLDivElement | undefined;
  const [imageRefs, setImageRefs] = createSignal<Record<string, HTMLImageElement>>({});

  const getDroppedFiles = async (dataTransfer: DataTransfer | null): Promise<File[]> => {
    if (!dataTransfer) return [];
    const items = Array.from(dataTransfer.items || []);

    const hasEntries = items.some((item) => typeof (item as any).webkitGetAsEntry === 'function');
    if (!hasEntries) {
      return Array.from(dataTransfer.files || []);
    }

    const readEntry = async (entry: any): Promise<File[]> => {
      if (!entry) return [];
      if (entry.isFile) {
        return new Promise((resolve) => {
          entry.file((file: File) => resolve([file]));
        });
      }
      if (entry.isDirectory) {
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

    return entryFiles.flat();
  };

  const visiblePages = () => {
    const p = pages();
    const curr = currentPage();
    
    if (pageMode() === 'single') {
      return p[curr] ? [p[curr]] : [];
    } else {
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

    // Reset batch metrics for the new view (only count visible pages)
    const visibleTasks = tasks.filter(t => !t.isCaching);
    if (visibleTasks.length > 0) {
      setOcrBatchTotal(visibleTasks.length);
      setOcrBatchDone(0);
      setOcrProgress(0);
    }
    
    // Update Queue: Replace entire queue with new priorities
    // This effectively "cancels" any pending tasks that are not in the new target set.
    setOcrQueue(tasks);
    
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
      if (total > 0) {
         setOcrProgress((ocrBatchDone() / total) * 100);
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
      
      // Update batch done count only for visible (non-caching) tasks
      if (!task.isCaching) {
        setOcrBatchDone(prev => prev + 1);
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
    
    const done = ocrBatchDone();
    const total = ocrBatchTotal();

    // 1. Is a visible page processing?
    if (currentTask && !currentTask.isCaching) {
      const processingVisible = visible.find(p => p.id === currentTask.page.id);
      if (processingVisible) {
        const progressStr = total > 0 ? ` ${done + 1}/${total}` : '';
        setOcrStatus(`Recognizing${progressStr}...`);
        return;
      }
    }

    // 2. Is a visible page pending in queue?
    const pendingVisibleTask = queue.find(t => !t.isCaching && visible.some(v => v.id === t.page.id));
    if (pendingVisibleTask) {
      const progressStr = total > 0 ? ` ${done + 1}/${total}` : '';
      setOcrStatus(`Pending${progressStr}...`);
      return;
    }

    // 3. Is caching happening in background?
    const isCaching = (currentTask?.isCaching) || queue.some(t => t.isCaching);
    if (isCaching) {
      const cachingCount = queue.filter(t => t.isCaching).length + (currentTask?.isCaching ? 1 : 0);
      setOcrStatus(`Caching ${cachingCount} page${cachingCount > 1 ? 's' : ''}...`);
      return;
    }

    // 4. Are all visible pages done?
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

  // Check for pending book on mount
  onMount(() => {
    const pendingBook = sessionStorage.getItem('mlearn_open_book');
    if (pendingBook) {
      sessionStorage.removeItem('mlearn_open_book');
      // TODO: Load book from path
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

    const droppedFiles = await getDroppedFiles(e.dataTransfer || null);
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

    // Determine book ID from first file (folder/book name)
    const bookId = extractBookId(files[0].name);
    setCurrentBookId(bookId);
    
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
    });
    
    // Determine title more robustly
    const title = bookId || 'Imported Book';
    setBookTitle(title);
    saveToRecent(title, 'book', startPage);
  };

  const saveToRecent = (name: string, type: 'video' | 'book', progress: number = 0) => {
    try {
      const stored = localStorage.getItem('mlearn_recent_items');
      const items = stored ? JSON.parse(stored) : [];
      const newItem = { type, name, path: '', progress, lastWatched: Date.now() };
      const filtered = items.filter((i: any) => i.name !== name);
      const updated = [newItem, ...filtered].slice(0, 10);
      localStorage.setItem('mlearn_recent_items', JSON.stringify(updated));
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
    const newPage = Math.max(0, Math.min(index, total - 1));
    setCurrentPage(newPage);
    
    // Persist per-book page position
    const bookId = currentBookId();
    persistPageIndex(bookId, newPage, total);
    
    // Also update recent items for display purposes
    saveToRecent(bookTitle(), 'book', newPage);
  };

  const prevPage = () => {
    const step = pageMode() === 'double' ? 2 : 1;
    goToPage(currentPage() - step);
  };

  const nextPage = () => {
    const step = pageMode() === 'double' ? 2 : 1;
    goToPage(currentPage() + step);
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
        showOcrOverlay={showOcrOverlay}
        hasOcrResult={hasOcrResult}
        onGoHome={goHome}
        onToggleSidebar={() => setShowSidebar(!showSidebar())}
        onFitModeChange={(mode) => setFitMode(mode as FitMode)}
        onPageModeChange={(mode) => setPageMode(mode as PageMode)}
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
                  return task !== null && !task.isCaching && task.page.id === page.id;
                };
                const isPending = () => {
                  return ocrQueue().some(q => !q.isCaching && q.page.id === page.id);
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
                
                // Generate status text
                const getStatusText = () => {
                  if (isPending()) {
                    return 'Pending...';
                  }
                  if (isProcessing()) {
                    const serverMsg = serverOcrMessage();
                    if (serverMsg) {
                      // Clean up the server message for display
                      // "Recognition progress 13/65" -> "Recognizing 13/65"
                      // const progressMatch = serverMsg.match(/progress\s+(\d+\s*\/\s*\d+)/i);
                      // if (progressMatch) {
                      // }
                      // return serverMsg;
                      return `Recognizing...`;
                    }
                    return 'Processing...';
                  }
                  return '';
                };
                
                return (
                  <div class="page">
                    <img
                      class="page-image"
                      src={page.src}
                      alt={page.name}
                      ref={(el) => setImageRefs(prev => ({ ...prev, [page.id]: el }))}
                    />
                    {/* Page Processing Loader - shown while OCR is pending/processing */}
                    <Show when={isWaitingForOcr()}>
                      <div class="page-loader-overlay">
                        <ProgressRing
                          progress={getOcrProgress() ?? 0}
                          indeterminate={isPending() || getOcrProgress() === null}
                          size={40}
                          strokeWidth={5}
                          statusText={getStatusText()}
                          showPercent={isProcessing() && getOcrProgress() !== null}
                        />
                      </div>
                    </Show>
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

          {/* OCR Processing Overlay - Removed */}
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
