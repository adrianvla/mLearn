/**
 * Reader Route
 * Manga/Image OCR reader integrated into main window via router
 */

import { Component, createSignal, For, Show, onMount, onCleanup, createEffect } from 'solid-js';
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
const ocrCache = new Map<string, OcrResult>();
const ocrInFlight = new Map<string, Promise<OcrResult | null>>();

export const ReaderRoute: Component = () => {
  const navigate = useNavigate();
  const { isProcessing: ocrHookProcessing } = useOCR();
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
  const [isProcessingOcr, setIsProcessingOcr] = createSignal(false);
  const [isDragging, setIsDragging] = createSignal(false);
  const [ocrProgress, setOcrProgress] = createSignal(0);
  const [currentOcrResult, setCurrentOcrResult] = createSignal<OcrResult | null>(null);
  const [showOcrOverlay, setShowOcrOverlay] = createSignal(true);
  const [ocrDictionaryEntries, setOcrDictionaryEntries] = createSignal<DictionaryEntry[]>([]);
  const [ocrTranslationData, setOcrTranslationData] = createSignal<TranslationResponse | null>(null);
  const [ocrWordStatus, setOcrWordStatus] = createSignal<'unknown' | 'learning' | 'known'>('unknown');

  // References for OCR overlay positioning
  let pageContainerRef: HTMLDivElement | undefined;
  let currentImageRef: HTMLImageElement | undefined;

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

  // Load cached OCR result when page changes
  createEffect(() => {
    const visible = visiblePages();
    if (visible.length > 0) {
      const pageId = visible[0].id;
      const cached = ocrCache.get(pageId);
      setCurrentOcrResult(cached || null);
      if (cached) {
        setOcrStatus(`Cached: ${cached.boxes?.length || 0} regions`);
      } else {
        setOcrStatus('Ready');
      }
    }
  });

  const requestOcrForPage = async (page: PageImage, opts: { setCurrent?: boolean; showProgress?: boolean } = {}) => {
    if (!page) return null;
    if (ocrCache.has(page.id)) {
      const cached = ocrCache.get(page.id)!;
      if (opts.setCurrent) setCurrentOcrResult(cached);
      return cached;
    }
    if (ocrInFlight.has(page.id)) {
      const inflight = await ocrInFlight.get(page.id)!;
      if (opts.setCurrent && inflight) setCurrentOcrResult(inflight);
      return inflight;
    }

    const task = (async () => {
      if (opts.showProgress) {
        setIsProcessingOcr(true);
        setOcrStatus('Preparing image...');
        setOcrProgress(10);
      }

      try {
        let imageBlob: Blob;

        if (page.blob) {
          imageBlob = page.blob;
        } else {
          const img = document.querySelector('.page-image') as HTMLImageElement;
          if (!img) {
            if (opts.showProgress) setOcrStatus('No image found');
            return null;
          }

          const canvas = document.createElement('canvas');
          canvas.width = img.naturalWidth;
          canvas.height = img.naturalHeight;
          const ctx = canvas.getContext('2d')!;
          ctx.drawImage(img, 0, 0);

          imageBlob = await new Promise<Blob>((resolve, reject) => {
            canvas.toBlob(
              (blob) => (blob ? resolve(blob) : reject(new Error('Failed to create blob'))),
              'image/png',
              0.92
            );
          });
        }

        if (opts.showProgress) {
          setOcrProgress(30);
          setOcrStatus('Compressing image...');
        }

        const prepared = await prepareBlobForOCR(imageBlob);

        if (opts.showProgress) {
          setOcrProgress(50);
          setOcrStatus('Sending to OCR server...');
        }

        const formData = new FormData();
        formData.append('file', prepared.blob, 'image.png');

        const response = await fetch(API_ENDPOINTS.ocr, {
          method: 'POST',
          body: formData,
        });

        if (!response.ok) {
          const errorText = await response.text();
          console.error('OCR error response:', errorText);
          throw new Error(`OCR request failed: ${response.status}`);
        }

        if (opts.showProgress) {
          setOcrProgress(80);
          setOcrStatus('Processing results...');
        }

        const result = (await response.json()) as OcrResult;

        result.client_scale = prepared.clientScale;
        result.downscale_factor = prepared.clientScale > 0 ? 1 / prepared.clientScale : 1;
        result.original_size = { width: prepared.originalW, height: prepared.originalH };
        result.sent_size = { width: prepared.sentW, height: prepared.sentH };

        if (opts.showProgress) {
          setOcrProgress(100);
          setOcrStatus(`Found ${result.boxes?.length || 0} text regions`);
        }

        ocrCache.set(page.id, result);
        if (opts.setCurrent) setCurrentOcrResult(result);
        return result;
      } catch (error) {
        console.error('OCR error:', error);
        if (opts.showProgress) {
          setOcrStatus(`OCR failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
          setCurrentOcrResult(null);
        }
        return null;
      } finally {
        if (opts.showProgress) {
          setIsProcessingOcr(false);
          setOcrProgress(0);
        }
      }
    })();

    ocrInFlight.set(page.id, task);
    try {
      return await task;
    } finally {
      ocrInFlight.delete(page.id);
    }
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
      blob: file, // Store original blob for OCR
    }));

    // Clear OCR cache when loading new book
    ocrCache.clear();
    setCurrentOcrResult(null);

    setPages(newPages);
    setCurrentPage(0);
    setBookTitle(files[0].name.split('/').pop()?.replace(/\.[^.]+$/, '') || 'Imported Book');
    saveToRecent(files[0].name, 'book');
  };

  const saveToRecent = (name: string, type: 'video' | 'book') => {
    try {
      const stored = localStorage.getItem('mlearn_recent_items');
      const items = stored ? JSON.parse(stored) : [];
      const newItem = { type, name, path: '', progress: 0, lastWatched: Date.now() };
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
    setCurrentPage(Math.max(0, Math.min(index, total - 1)));
  };

  const prevPage = () => goToPage(currentPage() - (pageMode() === 'double' ? 2 : 1));
  const nextPage = () => goToPage(currentPage() + (pageMode() === 'double' ? 2 : 1));

  /**
   * Run OCR on the current visible page
   * Uses proper image compression matching the legacy app
   */
  const runOcr = async () => {
    const visible = visiblePages();
    if (visible.length === 0) return;

    const page = visible[0];
    await requestOcrForPage(page, { setCurrent: true, showProgress: true });
  };

  // Automatic OCR + cache next 2 pages
  createEffect(() => {
    const allPages = pages();
    if (allPages.length === 0) return;
    const base = currentPage();
    const visibleCount = pageMode() === 'double' ? 2 : 1;
    const nextStart = base + visibleCount;
    const indices = new Set<number>();
    indices.add(base);
    if (pageMode() === 'double') indices.add(base + 1);
    indices.add(nextStart);
    indices.add(nextStart + 1);

    indices.forEach((idx) => {
      const page = allPages[idx];
      if (!page) return;
      requestOcrForPage(page, { setCurrent: idx === base, showProgress: idx === base });
    });
  });

  // OCR hover handlers (legacy-style hover popup)
  let ocrHoverRequestId = 0;
  const handleOcrWordHover = async (token: Token, rect: DOMRect) => {
    const requestId = ++ocrHoverRequestId;
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
      const translation = await translateWord(displayWord);
      if (requestId !== ocrHoverRequestId) return;
      setOcrTranslationData(translation);
    } catch (_e) {
      /* ignore */
    }

    if (settings.showDictionary) {
      try {
        const entries = await lookup(displayWord, token.reading);
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

  const hasOcrResult = () => currentOcrResult() !== null;
  const hasPages = () => pages().length > 0;
  const hasOcrForPage = (pageId: string) => ocrCache.has(pageId);

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
              {(page, index) => (
                <div class="page">
                  <img
                    class="page-image"
                    src={page.src}
                    alt={page.name}
                    ref={(el) => { if (index() === 0) currentImageRef = el; }}
                  />
                  {/* OCR Overlay for first visible page */}
                  <Show when={index() === 0 && currentOcrResult()}>
                    <OcrOverlay
                      result={currentOcrResult()}
                      imageElement={currentImageRef}
                      containerElement={pageContainerRef}
                      visible={showOcrOverlay()}
                      onWordHover={handleOcrWordHover}
                      onWordLeave={handleOcrWordLeave}
                    />
                  </Show>
                </div>
              )}
            </For>
          </div>

          {/* OCR Processing Overlay */}
          <Show when={isProcessingOcr()}>
            <div class="ocr-loading-overlay">
              <div class="ocr-loading-spinner" />
              <span class="ocr-loading-text">{ocrStatus()}</span>
              <div class="ocr-progress-bar">
                <div class="bar" style={{ width: `${ocrProgress()}%` }} />
              </div>
            </div>
          </Show>
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
