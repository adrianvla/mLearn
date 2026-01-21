/**
 * Reader Route
 * Manga/Image OCR reader integrated into main window via router
 */

import { Component, createSignal, For, Show, onMount, onCleanup, createEffect } from 'solid-js';
import { createStore } from 'solid-js/store';
import { useNavigate } from '@solidjs/router';
import { WindowDragRegion } from '../../../components/utils/WindowDragRegion';
import { OcrOverlay, type OcrResult } from '../../../components/reader';
import { WordHover } from '../../../components/subtitle/WordHover';
import { useOCR, prepareBlobForOCR, useTranslation, useDictionary, useWordHover } from '../../../hooks';
import { useSettings } from '../../../context';
import type { Token, TranslationResponse, DictionaryEntry } from '../../../../shared/types';
import { API_ENDPOINTS } from '../../../../shared/constants';
import { ReaderNav, ReaderSidebar, ReaderWelcomeCard, ReaderStatusBar } from './components';
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
const [ocrQueue, setOcrQueue] = createSignal<PageImage[]>([]);
const [processingPageId, setProcessingPageId] = createSignal<string | null>(null);

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
    
    // Determine priority pages (Visible + Cache)
    const targetIndices: number[] = []; 
    // Visible
    targetIndices.push(base);
    if (isDouble) targetIndices.push(base + 1);
    // Cache next 2
    const nextStart = base + (isDouble ? 2 : 1);
    targetIndices.push(nextStart);
    targetIndices.push(nextStart + 1);

    // Filter to pages that exist and need OCR
    const neededPages = targetIndices
      .map(idx => allPages[idx])
      .filter(p => p && !ocrResults[p.id]);

    // Reset batch metrics for the new view
    if (neededPages.length > 0) {
      setOcrBatchTotal(neededPages.length);
      setOcrBatchDone(0);
      setOcrProgress(0);
    }
    
    // Update Queue: Replace entire queue with new priorities
    // This effectively "cancels" any pending tasks that are not in the new target set.
    setOcrQueue(neededPages);
    
    // Trigger processing
    processQueue();
  });

  // Serial Queue Processor
  const processQueue = async () => {
    if (processingPageId()) return; // Already working
    
    const queue = ocrQueue();
    if (queue.length === 0) {
      setOcrBatchDone(prev => prev + 1);
      
      const total = ocrBatchTotal();
      if (total > 0) {
         setOcrProgress((ocrBatchDone() / total) * 100);
      }
      updateOverallStatus();
      return;
    }

    const page = queue[0];
    setOcrQueue(q => q.slice(1)); // Pop
    setProcessingPageId(page.id);
    updateOverallStatus();

    try {
      await performOcr(page);
    } finally {
      setProcessingPageId(null);
      // Process next
      processQueue();
    }
  };

  const performOcr = async (page: PageImage) => {
    // Silent background process - only update status bar text
    // Note: status bar text is handled by updateOverallStatus based on processingPageId
    
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
    const currentId = processingPageId();
    const queue = ocrQueue();
    const visible = visiblePages();
    
    const done = ocrBatchDone();
    const total = ocrBatchTotal();
    const progressStr = total > 0 ? ` (${done}/${total})` : '';

    // 1. Is a visible page processing?
    const processingVisible = visible.find(p => p.id === currentId);
    if (processingVisible) {
      setOcrStatus(`OCR: Processing${progressStr}...`);
      return;
    }

    // 2. Is a visible page pending in queue?
    const pendingVisible = visible.find(p => queue.some(q => q.id === p.id));
    if (pendingVisible) {
      setOcrStatus(`OCR: Pending${progressStr}...`);
      return;
    }

    // 3. Check if any pages are still being processed (background processing)
    // Only show "Ready" when ALL processing is truly done
    if (currentId || queue.length > 0) {
      setOcrStatus(`OCR: Background Processing${progressStr}...`);
      return;
    }

    // 4. Are all visible pages done?
    const allVisibleDone = visible.every(p => ocrResults[p.id]);
    if (allVisibleDone) {
      setOcrStatus('Ready');
    } else {
      // Visible pages don't have OCR yet but nothing is processing - show waiting
      setOcrStatus('Waiting for OCR...');
    }
  };

  // Helper for manual run (force) - kept for potential future use
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _requestOcrForPage = (page: PageImage) => {
     // Add to front of queue if not there?
     // Actually manual run usually implies "do it now".
     // We can just add to queue and trigger.
     setOcrQueue(prev => [page, ...prev.filter(p => p.id !== page.id)]);
     processQueue();
  };

  const runOcr = async () => {
    const visible = visiblePages();
    // Prioritize visible pages in queue
    setOcrQueue(prev => {
        const others = prev.filter(p => !visible.find(v => v.id === p.id));
        return [...visible, ...others];
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

    const newPages: PageImage[] = files.map((file, index) => ({
      id: `page-${index}-${file.name}`,
      src: URL.createObjectURL(file),
      name: file.name,
      index,
      blob: file,
    }));

    // Clear OCR cache when loading new book
    setOcrResults({});
    setPages(newPages);

    // Check for saved progress
    const bookName = files[0].name;
    const saved = localStorage.getItem('mlearn_recent_items');
    let startPage = 0;
    
    if (saved) {
        try {
            const items = JSON.parse(saved);
            const match = items.find((i: any) => i.name === bookName || i.name === bookName.replace(/\.[^.]+$/, ''));
            if (match && typeof match.progress === 'number') {
                startPage = match.progress;
            }
        } catch (e) {
            console.error('Error loading saved progress', e);
        }
    }

    setCurrentPage(startPage);
    
    // Determine title more robustly
    const title = files[0].name.split('/').pop()?.replace(/\.[^.]+$/, '') || 'Imported Book';
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
  const handleOcrWordHover = async (token: Token, rect: DOMRect) => {
    const requestId = ++ocrHoverRequestId;
    // Use actual_word (dictionary form) for translation lookup, fallback to surface
    const lookupWord = token.actual_word ?? token.surface ?? token.word;
    const displayWord = token.surface ?? token.word;
    setOcrTranslationData(null);
    setOcrDictionaryEntries([]);
    showOcrHover({
      word: displayWord,
      token,
      translation: null,
      position: { x: rect.left + rect.width / 2, y: rect.top },
      anchorRect: rect,
      element: null,
    });

    try {
      // Use dictionary form for translation lookup (handles conjugations like 屈して -> 屈する)
      const translation = await translateWord(lookupWord);
      if (requestId !== ocrHoverRequestId) return;
      setOcrTranslationData(translation);
    } catch (_e) {
      /* ignore */
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
      <WindowDragRegion />

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
                // Check if this page is being processed or is pending
                const isProcessing = () => processingPageId() === page.id;
                const isPending = () => ocrQueue().some(q => q.id === page.id);
                const isWaitingForOcr = () => !ocrResults[page.id] && (isProcessing() || isPending());
                
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
                        <div class="page-loader">
                          <div class="page-loader-spinner-c">
                            <div class="page-loader-spinner"></div>
                          </div>
                          <span class="page-loader-text">
                            {isProcessing() ? 'Processing...' : 'Pending...'}
                          </span>
                        </div>
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

      <Show when={ocrHoverData()}>
        <WordHover
          token={ocrHoverData()!.token!}
          word={ocrHoverData()!.word || ocrHoverData()!.token?.surface || ocrHoverData()!.token?.word || ''}
          position={ocrHoverData()!.position}
          anchorRect={ocrHoverData()!.anchorRect}
          dictionaryEntries={ocrDictionaryEntries()}
          translationData={ocrTranslationData() || undefined}
          status={ocrWordStatus()}
          isOCR={true}
          ocrImageElement={(() => {
            // Get the first visible page's image element for OCR screenshot
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
