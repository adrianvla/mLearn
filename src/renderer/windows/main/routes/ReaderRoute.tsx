/**
 * Reader Route
 * Manga/Image OCR reader integrated into main window via router
 */

import { Component, createSignal, For, Show, onMount, onCleanup, createEffect, createMemo, batch, on } from 'solid-js';
import { createStore, reconcile } from 'solid-js/store';
import { useNavigate } from '@solidjs/router';
import { OcrOverlay, MagnifyingGlass, type OcrBox, type OcrResult, type OcrProcessingTimes } from '../../../components/reader';
import { WordHover } from '../../../components/subtitle/WordHover';
import { ExplainerPopup } from '../../../components/subtitle/ExplainerPopup';
import { initWordLookupBridge } from '../../../services/wordLookupService';
import { useOCR, prepareBlobForOCR, useTranslation, useDictionary, useTokenizer, useWordHover, getCachedTranslation, getGlobalHoverManager, useMediaStats } from '../../../hooks';
import { useSettings, useLocalization, useFlashcards, useLanguage } from '../../../context';
import { parseKeybind } from '../../../components/common';
import type { Token, TranslationResponse, DictionaryEntry, ConversationAgentContext } from '../../../../shared/types';
import { WORD_STATUS } from '../../../../shared/constants';
import { getBridge } from '../../../../shared/bridges';
import { getBackend, CloudOCRAdapter, resolveCloudApiUrl } from '../../../../shared/backends';
import { isElectron } from '../../../../shared/platform';
import { ReaderNav, ReaderSidebar, ReaderUnknownWordsSidebar, ReaderWelcomeCard, ReaderStatusBar, type ReaderUnknownWordEntry } from './components';
import { ProgressRing } from '../../../components/common';
import { isPdfFile, pdfToImages } from '../../../services/pdfService';
import { captureBlobThumbnail, saveToRecentItems } from '../../../services/thumbnailService';
import { parseWorkName } from '../../../utils/subtitleParsing';
import { computeWordLevelPercentages, computeGrammarLevelPercentages, assessMediaLevel } from '../../../utils/levelPercentages';
import { wordsLearnedInApp } from '../../../services/statsService';
import { buildWordHoverFlashcardContent, getEffectiveWordStatus, numericToWordStatus } from '../../../components/subtitle/wordHoverHelpers';
import { isWordInLanguageScript } from '../../../../shared/utils/textUtils';
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

interface ReaderPageWordSource {
  key: string;
  word: string;
  token: Token;
  contextPhrase: string;
  pageId: string;
  box: OcrBox;
  boxIndex: number;
}

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

const loadSavedPageIndex = async (bookId: string | null): Promise<number | null> => {
  if (!bookId) return null;
  try {
    const raw = await getBridge().kvStore.kvGet(makeStorageKey(bookId));
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
  getBridge().kvStore.kvSet(makeStorageKey(bookId), String(normalized));
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
  const { settings, updateSettings } = useSettings();
  const { t } = useLocalization();
  const flashcardCtx = useFlashcards();
  const langCtx = useLanguage();
  const { detectGrammarInText, supportsGrammar, isTranslatable, currentLangData, getCanonicalForm } = langCtx;
  const { translateWord } = useTranslation({ immediate: true });
  const { tokenize } = useTokenizer();
  const { lookup } = useDictionary();
  const { hoverData: ocrHoverData, isVisible: isOcrHoverVisible, showHover: showOcrHover, hideHover: hideOcrHover, cancelHide: cancelOcrHide } = useWordHover();

  // Media stats for this reader session
  const mediaStats = useMediaStats({ mediaType: 'book', language: settings.language });

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
  const [showWordSidebar, setShowWordSidebar] = createSignal(true);
  const [bookTitle, setBookTitle] = createSignal('');
  const [ocrStatus, setOcrStatus] = createSignal('');
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

  // Explainer popup state
  const [explainerOpen, setExplainerOpen] = createSignal(false);
  const [explainerWord, setExplainerWord] = createSignal('');
  const [explainerContext, setExplainerContext] = createSignal('');
  const [explainerPosition, setExplainerPosition] = createSignal<{ x: number; y: number }>({ x: 0, y: 0 });

  // Initialize deep link bridge for mlearn://lookup
  const cleanupBridgeLookup = initWordLookupBridge();
  onCleanup(cleanupBridgeLookup);

  // Magnifying glass state
  const [magnifierActive, setMagnifierActive] = createSignal(false);

  // Sidebar word hover → OCR box highlight
  const [sidebarHoveredEntry, setSidebarHoveredEntry] = createSignal<ReaderUnknownWordEntry | null>(null);

  // Activate media stats when a book is loaded
  createEffect(() => {
    const title = bookTitle();
    if (title) mediaStats.setMedia(title);
  });

  // OCR debug overlay (dev mode only)
  const [ocrDebugOverlay, setOcrDebugOverlay] = createSignal(false);
  const toggleOcrDebugOverlay = () => setOcrDebugOverlay(!ocrDebugOverlay());

  // PaddleOCR downscale slider (dev mode only, non-turbo)
  const [paddleOcrScale, setPaddleOcrScale] = createSignal(80);

  // Dev-mode live-tuneable OCR zone clustering parameters
  const [zoneDeltaThreshold, setZoneDeltaThreshold] = createSignal(15);

  // OCR generation counter — incremented when turbo mode changes to invalidate stale results
  const [ocrGeneration, setOcrGeneration] = createSignal(0);

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

  // Last OCR processing times (dev mode benchmarking)
  const [lastOcrTiming, setLastOcrTiming] = createSignal<OcrProcessingTimes | null>(null);

  // References for OCR overlay positioning
  let pageContainerRef: HTMLDivElement | undefined;
  const [imageRefs, setImageRefs] = createSignal<Record<string, HTMLImageElement>>({});
  const [ocrPageWords, setOcrPageWords] = createStore<Record<string, ReaderPageWordSource[]>>({});
  const [addingSidebarWords, setAddingSidebarWords] = createSignal<Set<string>>(new Set());
  const [isAddingAllSidebarWords, setIsAddingAllSidebarWords] = createSignal(false);

  // Helper function to get file path using Electron's webUtils API (Electron 32+)
  // Falls back to legacy File.path property for older Electron versions
  const getFilePath = (file: File): string => {
    // Try the new webUtils API first (Electron 32+)
    const path = getBridge().files.getPathForFile(file);
    if (path) return path;
    // Fallback to legacy File.path property
    const fileWithPath = file as File & { path?: string };
    return fileWithPath.path || '';
  };

  // Returns files, the name of the dropped folder, and the full filesystem path (if available)
  // Uses webUtils.getPathForFile (Electron 32+) to get filesystem paths
  const getDroppedFiles = async (dataTransfer: DataTransfer | null): Promise<{
    files: File[],
    droppedFolderName: string | null,
    droppedFolderPath: string | null,
    rawFilePaths: Map<string, string> // Map of filename to path for preserving paths
  }> => {
    if (!dataTransfer) return { files: [], droppedFolderName: null, droppedFolderPath: null, rawFilePaths: new Map() };

    const items = Array.from(dataTransfer.items || []);
    const rawFiles = Array.from(dataTransfer.files || []);

    // Build a map of filename -> path using webUtils.getPathForFile (Electron 32+)
    // This preserves paths before webkit entries API creates new File objects
    let rawFilePath: string | null = null;
    const rawFilePaths = new Map<string, string>();

    for (const rawFile of rawFiles) {
      const path = getFilePath(rawFile);
      if (path) {
        rawFilePaths.set(rawFile.name, path);
        // Keep first path for folder path fallback
        if (!rawFilePath) {
          rawFilePath = path;
        }
      }
    }

    const hasEntries = items.some((item) => typeof (item as any).webkitGetAsEntry === 'function');
    if (!hasEntries) {
      // No webkit entries - just regular files dropped
      // Extract folder path from first file's parent directory
      const droppedFolderPath = rawFilePath
          ? rawFilePath.split('/').slice(0, -1).join('/')
          : null;
      return { files: rawFiles, droppedFolderName: null, droppedFolderPath, rawFilePaths };
    }

    let droppedFolderName: string | null = null;
    let droppedFolderPath: string | null = null;

    const readEntry = async (entry: any, isTopLevel: boolean = false): Promise<File[]> => {
      if (!entry) return [];
      if (entry.isFile) {
        return new Promise((resolve) => {
          entry.file((file: File) => resolve([file]));
        });
      }
      if (entry.isDirectory) {
        // Capture the folder name and path from the top-level directory entry
        if (isTopLevel && !droppedFolderName) {
          droppedFolderName = entry.name;
          // When dropping a folder, rawFilePath from Electron's dataTransfer.files
          // contains the folder's full filesystem path
          droppedFolderPath = rawFilePath;
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
        const nested = await Promise.all(entries.map((child) => readEntry(child, false)));
        return nested.flat();
      }
      return [];
    };

    const entryFiles = await Promise.all(
        items
            .map((item) => (item as any).webkitGetAsEntry?.())
            .filter(Boolean)
            .map((entry) => readEntry(entry, true))
    );

    // If no folder was dropped but we have a file path from Electron,
    // extract the parent directory as the folder path
    if (!droppedFolderPath && rawFilePath) {
      droppedFolderPath = rawFilePath.split('/').slice(0, -1).join('/');
    }

    return { files: entryFiles.flat(), droppedFolderName, droppedFolderPath, rawFilePaths };
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

  createEffect(on(currentBookId, () => {
    setOcrPageWords(reconcile({}));
    setAddingSidebarWords(new Set<string>());
    setIsAddingAllSidebarWords(false);
  }));

  const handlePageTokenData = (pageId: string, entries: Array<{ boxIndex: number; box: OcrBox; tokens: Token[]; contextPhrase: string }>) => {
    const nextEntries: ReaderPageWordSource[] = [];

    for (const entry of entries) {
      for (const token of entry.tokens) {
        const word = token.actual_word ?? token.surface ?? token.word;
        if (!word || !isTranslatable(token.type)) {
          continue;
        }

        nextEntries.push({
          key: `${pageId}:${entry.boxIndex}:${word}`,
          word,
          token,
          contextPhrase: entry.contextPhrase,
          pageId,
          box: entry.box,
          boxIndex: entry.boxIndex,
        });
      }
    }

    setOcrPageWords(pageId, nextEntries);
  };

  const getAnchorRectForWord = (entry: ReaderPageWordSource): DOMRect | null => {
    const image = imageRefs()[entry.pageId];
    const result = ocrResults[entry.pageId];
    if (!image || !result) return null;

    const imageRect = image.getBoundingClientRect();
    const sentWidth = result.sent_size?.width || (result.original_size?.width || 0) * (result.client_scale || 1) || image.naturalWidth;
    const sentHeight = result.sent_size?.height || (result.original_size?.height || 0) * (result.client_scale || 1) || image.naturalHeight;
    if (!sentWidth || !sentHeight) return null;

    const xs = entry.box.box.map((point) => point[0]);
    const ys = entry.box.box.map((point) => point[1]);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const maxX = Math.max(...xs);
    const maxY = Math.max(...ys);
    const scaleX = imageRect.width / sentWidth;
    const scaleY = imageRect.height / sentHeight;
    const left = imageRect.left + minX * scaleX;
    const top = imageRect.top + minY * scaleY;
    const width = Math.max(1, (maxX - minX) * scaleX);
    const height = Math.max(1, (maxY - minY) * scaleY);

    return new DOMRect(left, top, width, height);
  };

  const visibleUnknownWords = createMemo<ReaderUnknownWordEntry[]>(() => {
    const manualStatuses = wordsLearnedInApp();
    const deduped = new Map<string, ReaderUnknownWordEntry>();

    for (const page of visiblePages()) {
      const pageWords = ocrPageWords[page.id] || [];
      for (const entry of pageWords) {
        if (deduped.has(entry.word)) {
          continue;
        }

        if (flashcardCtx.isWordIgnoredSync(entry.word)) {
          continue;
        }

        const manualStatus = numericToWordStatus(manualStatuses[entry.word] ?? WORD_STATUS.UNKNOWN);
        const effectiveStatus = getEffectiveWordStatus(flashcardCtx.getCardByWordSync(entry.word), manualStatus);
        if (effectiveStatus === 'known') {
          continue;
        }

        if (!isWordInLanguageScript(entry.word, settings.language)) {
          continue;
        }

        deduped.set(entry.word, entry);
      }
    }

    return Array.from(deduped.values());
  });

  const addReaderWordFlashcard = async (entry: ReaderPageWordSource) => {
    setAddingSidebarWords((prev) => {
      const next = new Set(prev);
      next.add(entry.key);
      return next;
    });

    try {
      const translationData = getCachedTranslation(entry.word) ?? await translateWord(entry.word);
      const image = imageRefs()[entry.pageId] || null;
      const anchorRect = getAnchorRectForWord(entry);
      const manualStatus = numericToWordStatus(wordsLearnedInApp()[entry.word] ?? WORD_STATUS.UNKNOWN);
      const frequency = langCtx.getFrequency(entry.word);
      const { content, ease } = await buildWordHoverFlashcardContent({
        token: entry.token,
        word: entry.word,
        translationData: translationData || undefined,
        contextPhrase: entry.contextPhrase,
        isOcr: true,
        ocrImageElement: image,
        anchorRect: anchorRect || undefined,
        level: frequency?.raw_level ?? -1,
        manualStatus,
        colourCodes: settings.colour_codes || currentLangData()?.colour_codes || {},
        ocrCropPadding: settings.ocr_crop_padding,
        tokenize,
      });
      await flashcardCtx.addFlashcard(content, ease);
    } finally {
      setAddingSidebarWords((prev) => {
        const next = new Set(prev);
        next.delete(entry.key);
        return next;
      });
    }
  };

  const handleAddSidebarWord = async (entry: ReaderUnknownWordEntry) => {
    if (addingSidebarWords().has(entry.key) || flashcardCtx.hasWordSync(entry.word) || flashcardCtx.isWordIgnoredSync(entry.word)) {
      return;
    }
    await addReaderWordFlashcard(entry);
  };

  const handleAddAllSidebarWords = async (entries: ReaderUnknownWordEntry[]) => {
    if (isAddingAllSidebarWords() || entries.length === 0) {
      return;
    }

    setIsAddingAllSidebarWords(true);
    try {
      for (const entry of entries) {
        if (flashcardCtx.hasWordSync(entry.word) || flashcardCtx.isWordIgnoredSync(entry.word)) {
          continue;
        }
        await addReaderWordFlashcard(entry);
      }
    } finally {
      setIsAddingAllSidebarWords(false);
    }
  };

  const handleIgnoreSidebarWord = async (entry: ReaderUnknownWordEntry) => {
    await flashcardCtx.ignoreWordForLanguage(entry.word, entry.token.reading);
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

  // Invalidate OCR cache when turbo mode changes so pages get re-OCR'd
  createEffect(on(
      () => settings.ocrTurboMode,
      (_turbo, prevTurbo) => {
        // Skip the initial run (prevTurbo is undefined on first effect execution)
        if (prevTurbo === undefined) return;
        // Only invalidate if there are pages loaded
        if (pages().length === 0) return;

        batch(() => {
          // Bump generation so any in-flight requests are discarded
          setOcrGeneration(g => g + 1);
          // Clear all cached OCR results — reconcile actually deletes store keys
          // (plain setOcrResults({}) only merges, which does nothing)
          setOcrResults(reconcile({}));
          // Reset progress tracking
          setOcrCompletedIds(new Set<string>());
          setOcrBatchTotal(pages().length);
          // Clear queue so the auto-OCR effect can rebuild it cleanly
          setOcrQueue([]);
          // Don't reset processingTask here — if there's an in-flight request,
          // let it finish. The generation guard will discard the stale result,
          // and the finally block in processQueue will restart processing.
        });
        // The auto-OCR createEffect above will re-trigger because ocrResults
        // was cleared via reconcile, causing !ocrResults[page.id] to become true.
      },
  ));

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
    // Capture generation at start — if it changes mid-flight, discard the result
    const gen = ocrGeneration();
    // Reset server progress at start of each page
    setServerOcrProgress(null);
    setServerOcrMessage('');

    // Silent background process - only update status bar text
    // Note: status bar text is handled by updateOverallStatus based on processingTask

    try {
      const imageBlob = page.blob ?? await (await fetch(page.src)).blob();

      const turbo = settings.ocrTurboMode ?? true;
      const prepared = await prepareBlobForOCR(imageBlob, turbo);

      let result: OcrResult;

      if (settings.ocrProvider === 'cloud') {
        // Cloud OCR via HATEOAS job flow
        const cloudApiUrl = resolveCloudApiUrl(settings);
        const cloudToken = (settings.cloudAuthAccessToken || settings.cloudAuthToken || '').trim();
        if (!cloudToken) throw new Error('Cloud OCR requires authentication');

        const adapter = new CloudOCRAdapter(cloudApiUrl, cloudToken);
        const language = settings.language;
        const engine = turbo ? 'rapid' : undefined;
        const cloudResult = await adapter.recognize(prepared.blob, language, engine);

        // Convert cloud box format {x,y,width,height} to reader OcrBox format {box: [[x1,y1]...]}
        const convertedBoxes: OcrResult['boxes'] = (cloudResult.boxes || []).map(b => ({
          box: [
            [b.x, b.y],
            [b.x + b.width, b.y],
            [b.x + b.width, b.y + b.height],
            [b.x, b.y + b.height],
          ],
          text: b.text,
          score: b.confidence,
        }));

        result = {
          boxes: convertedBoxes,
        } as OcrResult;
      } else {
        // Local OCR via Python backend FormData
        const formData = new FormData();
        formData.append('file', prepared.blob, 'image.png');
        formData.append('turbo', turbo ? '1' : '0');
        formData.append('ram_saver', (settings.ocrRamSaver ?? false) ? '1' : '0');
        if (settings.devMode) {
          formData.append('dev_mode', '1');
          // Dev-mode PaddleOCR downscale: compute max dimensions from scale percentage
          const scale = paddleOcrScale();
          if (!turbo && scale < 100) {
            const maxW = Math.max(1, Math.round(prepared.sentW * (scale / 100)));
            const maxH = Math.max(1, Math.round(prepared.sentH * (scale / 100)));
            formData.append('paddle_max_width', String(maxW));
            formData.append('paddle_max_height', String(maxH));
          }
        }

        const response = await fetch(getBackend().buildUrl('/ocr'), {
          method: 'POST',
          body: formData,
        });

        if (!response.ok) {
          throw new Error(`OCR request failed: ${response.status}`);
        }

        result = (await response.json()) as OcrResult;
      }

      result.client_scale = prepared.clientScale;
      result.downscale_factor = prepared.clientScale > 0 ? 1 / prepared.clientScale : 1;
      result.original_size = { width: prepared.originalW, height: prepared.originalH };
      result.sent_size = { width: prepared.sentW, height: prepared.sentH };

      // Only store if generation hasn't changed (turbo mode wasn't toggled mid-flight)
      if (ocrGeneration() === gen) {
        setOcrResults(page.id, result);
        if (result.processing_times) {
          setLastOcrTiming(result.processing_times);
        }
      }
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
        setOcrStatus(t('mlearn.Reader.Status.CleaningUp'));
        return;
      }

      if (taskPageIdx >= visibleStart && taskPageIdx <= visibleEnd) {
        // Processing a VISIBLE page
        // If single page mode: just "Recognizing..." (no fraction)
        // If double page mode: "Processing X/Y" where Y is always maxVisibleCount (1 or 2)

        if (maxVisibleCount === 1) {
          // Single page mode - just show "Recognizing..." without fraction
          setOcrStatus(t('mlearn.Reader.Status.Recognizing'));
        } else {
          // Double page mode - show "Processing X/Y"
          // X = which visible page we're processing (1 or 2)
          // Find position of current task in visible pages
          const visiblePageIds = visible.map(p => p.id);
          const processingIdx = visiblePageIds.indexOf(currentTask.page.id);
          const xValue = processingIdx >= 0 ? processingIdx + 1 : 1;
          setOcrStatus(t('mlearn.Reader.Status.Processing', { x: xValue, y: maxVisibleCount }));
        }
        return;
      }

      // Processing a page AFTER current view (caching ahead)
      // Show "Caching X/Y" where Y is maxVisibleCount (same as visible layout)
      const cachePageIndices = [visibleEnd + 1, visibleEnd + 2].filter(idx => idx < pages().length);
      const processingCacheIdx = cachePageIndices.indexOf(taskPageIdx);
      const xValue = processingCacheIdx >= 0 ? processingCacheIdx + 1 : 1;
      setOcrStatus(t('mlearn.Reader.Status.Caching', { x: xValue, y: maxVisibleCount }));
      return;
    }

    // No active task - check queue
    if (queue.length > 0) {
      const nextTask = queue[0];
      const nextPageIdx = nextTask.page.index;

      if (nextPageIdx < visibleStart) {
        // Next in queue is before current view - cleaning up
        setOcrStatus(t('mlearn.Reader.Status.CleaningUp'));
        return;
      }

      if (nextPageIdx >= visibleStart && nextPageIdx <= visibleEnd) {
        // Visible page is queued but not yet processing - waiting to start
        setOcrStatus(t('mlearn.Reader.Status.LoadingNeuralNetwork'));
        return;
      }

      // Caching pages are queued - show caching status
      setOcrStatus(t('mlearn.Reader.Status.Caching', { x: 1, y: maxVisibleCount }));
      return;
    }

    // No tasks - check if all visible pages are done
    const allVisibleDone = visible.every(p => ocrResults[p.id]);
    if (allVisibleDone) {
      setOcrStatus(t('mlearn.Reader.Status.Ready'));
    } else {
      // Visible pages don't have OCR yet but nothing is processing - show waiting
      setOcrStatus(t('mlearn.Reader.Status.LoadingNeuralNetwork'));
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
    setOcrStatus(t('mlearn.Reader.Status.Loading'));

    try {
      // Check if it's a PDF file or a directory
      const isPdf = /\.pdf$/i.test(bookPath);

      if (isPdf) {
        // Load PDF file
        const result = await getBridge().files.readPdfFile(bookPath);
        const blob = new Blob([result.data], { type: 'application/pdf' });
        const fileName = bookPath.split('/').pop() || 'document.pdf';
        const file = new File([blob], fileName, { type: 'application/pdf' });

        const pdfImages = await pdfToImages(file);
        // For PDF: use filename only (stripped)
        const bookId = parseWorkName(fileName);
        setCurrentBookId(bookId);
        // Store the path for recent items persistence
        setCurrentBookPath(bookPath);

        const savedPageIndex = await loadSavedPageIndex(bookId);
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
          setBookTitle(bookId || t('mlearn.Reader.Status.PdfDocument'));
        });

        // Save to recent with the correct path
        saveToRecent(bookId || t('mlearn.Reader.Status.PdfDocument'), 'book', startPage, bookPath, newPages[0]?.blob);
      } else {
        // Load directory of images
        const result = await getBridge().files.readDirectoryImages(bookPath);

        if (result.files.length === 0) {
          setOcrStatus(t('mlearn.Reader.Status.NoImagesFound'));
          return;
        }

        // For folders: use folder name only (stripped)
        const folderName = bookPath.split('/').filter(Boolean).pop() || '';
        const bookId = parseWorkName(folderName);
        setCurrentBookId(bookId);
        // Store the path for recent items persistence
        setCurrentBookPath(bookPath);

        const savedPageIndex = await loadSavedPageIndex(bookId);
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
          setBookTitle(bookId || t('mlearn.Reader.Status.ImportedBook'));
        });

        // Save to recent with the correct path
        saveToRecent(bookId || t('mlearn.Reader.Status.ImportedBook'), 'book', startPage, bookPath, newPages[0]?.blob);
      }

      setOcrStatus(t('mlearn.Reader.Status.Ready'));
    } catch (error) {
      console.error('[Reader] Failed to load from path:', error);
      setOcrStatus(t('mlearn.Reader.Status.FailedToLoad'));
    }
  };

  // Open folder via bridge — on Electron uses native dialog, on mobile uses HTML file input.
  // For mobile, files are obtained directly from the file input rather than path-based loading.
  const handleOpenFolder = async () => {
    if (isElectron()) {
      const bridge = getBridge();
      const path = await bridge.files.selectBookFolder();
      if (path) loadBookFromPath(path);
      return;
    }

    // Mobile: use file input with webkitdirectory to get image files directly
    const input = document.createElement('input');
    input.type = 'file';
    (input as HTMLInputElement & { webkitdirectory: boolean }).webkitdirectory = true;
    input.multiple = true;
    input.accept = 'image/*';
    input.onchange = async () => {
      const files = Array.from(input.files || []).filter(f => f.type.startsWith('image/'));
      if (files.length === 0) return;

      files.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
      const folderName = (files[0] as File & { webkitRelativePath: string }).webkitRelativePath?.split('/')[0] || 'Book';
      const bookId = parseWorkName(folderName);
      setCurrentBookId(bookId);
      setCurrentBookPath('');

      const savedPageIndex = await loadSavedPageIndex(bookId);
      const startPage = savedPageIndex !== null && savedPageIndex >= 0 && savedPageIndex < files.length ? savedPageIndex : 0;

      const newPages: PageImage[] = files.map((file, index) => ({
        id: `page-${index}-${file.name}`,
        src: URL.createObjectURL(file),
        name: file.name,
        index,
        blob: file,
      }));

      setOcrResults({});
      batch(() => {
        setCurrentPage(startPage);
        setPages(newPages);
        setOcrBatchTotal(newPages.length);
        setOcrCompletedIds(new Set<string>());
        setBookTitle(bookId || t('mlearn.Reader.Status.ImportedBook'));
      });
      setOcrStatus(t('mlearn.Reader.Status.Ready'));
    };
    input.click();
  };

  const handleOpenPdf = async () => {
    if (isElectron()) {
      const bridge = getBridge();
      const path = await bridge.files.selectPdfFile();
      if (path) loadBookFromPath(path);
      return;
    }

    // Mobile: use file input to get the PDF File directly, then process via pdfToImages
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.pdf,application/pdf';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;

      setOcrStatus(t('mlearn.Reader.Status.LoadingPdf'));
      try {
        const pdfImages = await pdfToImages(file);
        const bookId = parseWorkName(file.name);
        setCurrentBookId(bookId);
        setCurrentBookPath('');

        const savedPageIndex = await loadSavedPageIndex(bookId);
        const startPage = savedPageIndex !== null && savedPageIndex >= 0 && savedPageIndex < pdfImages.length ? savedPageIndex : 0;

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
          setBookTitle(bookId || t('mlearn.Reader.Status.PdfDocument'));
        });
        setOcrStatus(t('mlearn.Reader.Status.Ready'));
      } catch (error) {
        console.error('[Reader] Failed to load PDF:', error);
        setOcrStatus(t('mlearn.Reader.Status.FailedToLoadPdf'));
      }
    };
    input.click();
  };

  // Check for pending book on mount
  onMount(() => {
    const pendingBook = sessionStorage.getItem('mlearn_open_book');
    if (pendingBook) {
      sessionStorage.removeItem('mlearn_open_book');
      loadBookFromPath(pendingBook);
    }

    // Trigger lazy warmup of OCR transformers on the backend.
    // This avoids loading heavy ML models at server startup;
    // the preimport only happens when the reader is actually opened.
    if (settings.ocrEnabled !== false) {
      fetch(getBackend().buildUrl('/ocr/warmup'), { method: 'POST' }).catch(() => {/* non-fatal */});
    }
  });

  // Furigana hider state comes from settings
  // Access it via settings context so changes propagate to OcrOverlay
  const furiganaHiderEnabled = () => settings.readerFuriganaHider ?? false;

  // Listen to reader context menu commands
  onMount(() => {
    const bridge = getBridge();

    const cleanup = bridge.window.onReaderContextMenuCommand((command: string) => {
      switch (command) {
        case 'toggle-furigana':
          // Toggle through settings so FuriganaHider component gets updated
          updateSettings({ readerFuriganaHider: !furiganaHiderEnabled() });
          break;
        case 'copy-phrase':
          // Copy the current context phrase to clipboard
          const phrase = ocrContextPhrase();
          if (phrase) {
            bridge.files.writeToClipboard(phrase);
          }
          break;
      }
    });
    onCleanup(cleanup);
  });

  // Handler for right-click context menu in reader on OCR boxes (has phrase to copy)
  const handleOcrContextMenu = (contextPhrase: string, _boxIndex: number) => {
    // Store the context phrase for copy functionality
    setOcrContextPhrase(contextPhrase);

    getBridge().window.showReaderCtxMenu({
      furiganaHiderEnabled: furiganaHiderEnabled(),
      hasContextPhrase: !!contextPhrase && contextPhrase !== '-',
    });
  };

  // Handler for right-click context menu on image (no OCR box selected)
  // Shows limited menu with only furigana toggle
  const handleImageContextMenu = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    // Clear context phrase since we're not on an OCR box
    setOcrContextPhrase('');

    getBridge().window.showReaderCtxMenu({
      furiganaHiderEnabled: furiganaHiderEnabled(),
      hasContextPhrase: false, // No phrase to copy when clicking on image
    });
  };

  // Listen to MangaOCR server status updates
  onMount(() => {
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

    const cleanup = getBridge().server.onOcrStatusUpdate(handleOcrStatus);
    onCleanup(cleanup);
  });

  // Keyboard navigation and magnifier hotkey
  // Note: We access settings.readerMagnifierHotkey directly inside handlers
  // to ensure changes take effect immediately without requiring a restart
  onMount(() => {
    /**
     * Check if the current keyboard event matches the configured magnifier hotkey.
     * Supports both simple keys (e.g., "z") and modifier combinations (e.g., "shift+c", "ctrl+alt+m")
     */
    const matchesHotkey = (e: KeyboardEvent): boolean => {
      const hotkeySetting = settings.readerMagnifierHotkey?.toLowerCase() || 'z';
      const { modifiers, key } = parseKeybind(hotkeySetting);

      // Check if pressed key matches the main key
      if (e.key.toLowerCase() !== key) return false;

      // Check modifiers match exactly
      const hasCtrl = modifiers.includes('ctrl');
      const hasAlt = modifiers.includes('alt');
      const hasShift = modifiers.includes('shift');
      const hasMeta = modifiers.includes('meta');

      return (
          e.ctrlKey === hasCtrl &&
          e.altKey === hasAlt &&
          e.shiftKey === hasShift &&
          e.metaKey === hasMeta
      );
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') prevPage();
      if (e.key === 'ArrowRight') nextPage();
      if (e.key === 'o' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        runOcr();
      }
      // Magnifier hotkey (press and hold)
      // Access settings directly for reactivity
      if (matchesHotkey(e) && !e.repeat) {
        setMagnifierActive(true);
        // Hide all word hovers when magnifying glass is activated
        getGlobalHoverManager().forceHide();
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      // Release magnifier when hotkey is released
      // Access settings directly for reactivity
      if (matchesHotkey(e)) {
        setMagnifierActive(false);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('keyup', handleKeyUp);
    onCleanup(() => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('keyup', handleKeyUp);
    });
  });

  // Save current page progress and first-page thumbnail when leaving the reader
  onCleanup(() => {
    const title = bookTitle();
    const currentPages = pages();
    const page = currentPage();
    const path = currentBookPath();
    if (title && currentPages.length > 0 && currentPages[0]?.blob) {
      captureBlobThumbnail(currentPages[0].blob!).then((thumbnail) => {
        if (thumbnail) {
          void saveToRecentItems({ type: 'book', name: title, path, progress: page }, thumbnail);
        }
      });
    }
  });

  const handleDrop = async (e: DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const { files: droppedFiles, droppedFolderName, droppedFolderPath, rawFilePaths } = await getDroppedFiles(e.dataTransfer || null);

    // Check for PDF file first
    const pdfFile = droppedFiles.find(f => isPdfFile(f));

    if (pdfFile) {
      // Handle PDF file
      setOcrStatus(t('mlearn.Reader.Status.LoadingPdf'));
      try {
        const pdfImages = await pdfToImages(pdfFile);

        // For PDF: use filename only (stripped)
        const bookId = parseWorkName(pdfFile.name);
        setCurrentBookId(bookId);

        // Get PDF path from rawFilePaths map (populated using webUtils.getPathForFile)
        // Fallback to getFilePath for the file, or droppedFolderPath
        const pdfPath = rawFilePaths.get(pdfFile.name)
            || getFilePath(pdfFile)
            || droppedFolderPath
            || '';
        setCurrentBookPath(pdfPath);

        // Check for saved page position
        const savedPageIndex = await loadSavedPageIndex(bookId);
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
          const title = bookId || t('mlearn.Reader.Status.PdfDocument');
          setBookTitle(title);
          saveToRecent(title, 'book', startPage, pdfPath, newPages[0]?.blob);
        });
        setOcrStatus(t('mlearn.Reader.Status.Ready'));
        return;
      } catch (error) {
        console.error('Failed to load PDF:', error);
        setOcrStatus(t('mlearn.Reader.Status.FailedToLoadPdf'));
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
      // Fallback: extract from first file's path using rawFilePaths map
      const firstFilePath = rawFilePaths.get(files[0].name) || getFilePath(files[0]);
      const rawFolderName = firstFilePath
          ? extractFolderName(firstFilePath)
          : files[0].name;
      bookId = parseWorkName(rawFolderName);
    }
    setCurrentBookId(bookId);

    // Use droppedFolderPath or extract from first file's path
    // rawFilePaths is populated using webUtils.getPathForFile (Electron 32+)
    const firstFilePath = rawFilePaths.get(files[0].name) || getFilePath(files[0]);
    const bookPath = droppedFolderPath || (firstFilePath
        ? firstFilePath.split('/').slice(0, -1).join('/')
        : '');
    setCurrentBookPath(bookPath);

    // Check for saved page position using the per-book storage key
    const savedPageIndex = await loadSavedPageIndex(bookId);
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
    const title = bookId || t('mlearn.Reader.Status.ImportedBook');
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

      await saveToRecentItems({
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

    // Update recent items with current progress but keep the first-page thumbnail
    saveToRecent(bookTitle(), 'book', newPage, currentBookPath());
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

  // Explainer popup handlers
  const handleOpenExplainer = (word: string, context: string, position: { x: number; y: number }) => {
    setExplainerWord(word);
    setExplainerContext(context);
    setExplainerPosition(position);
    setExplainerOpen(true);

    // Track grammar failure for the word being explained
    if (supportsGrammar()) {
      const detectedPatterns = detectGrammarInText([{ word, surface: word, actual_word: word } as Token]);
      for (const pattern of detectedPatterns) {
        flashcardCtx.trackGrammarFailed(pattern.pattern, pattern.level);
      }
    }
  };

  const handleCloseExplainer = () => {
    setExplainerOpen(false);
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

    // Track word encounter for passive knowledge
    flashcardCtx.trackWordSeen(getCanonicalForm(lookupWord), token.reading);

    // Track grammar encounters in OCR context
    if (supportsGrammar() && contextPhrase) {
      // Detect grammar in the context phrase tokens (simplified single-token case)
      const detectedPatterns = detectGrammarInText([token]);
      for (const pattern of detectedPatterns) {
        flashcardCtx.trackGrammarEncountered(pattern.pattern, pattern.level);
      }
    }

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

  const openConversationAgent = () => {
    const s = mediaStats.stats();
    const name = bookTitle();
    const lang = settings.language;

    const freqLookup = { getFrequency: langCtx.getFrequency, getFreqLevelNames: langCtx.getFreqLevelNames };
    const grammarLookup = { getGrammarPoint: langCtx.getGrammarPoint, getGrammarLevelNames: langCtx.getGrammarLevelNames };
    const wordLevels = computeWordLevelPercentages(s, freqLookup);
    const grammarLevels = computeGrammarLevelPercentages(s, grammarLookup);
    const level = assessMediaLevel(wordLevels);
    const levelNames = langCtx.getFreqLevelNames();

    // Only include words encountered in this specific media
    // Refine ease with global wordKnowledge but never add words from other media
    const wordKnowledge = flashcardCtx.store.wordKnowledge;
    const mediaWords = new Map<string, { word: string; ease: number; timesSeen: number; timesHovered: number }>();

    for (const entry of Object.values(s.wordsEncountered)) {
      const globalEntry = wordKnowledge[lang + ':' + entry.word] || wordKnowledge[entry.word];
      if (globalEntry) {
        mediaWords.set(entry.word, {
          word: entry.word,
          ease: Math.min(entry.ease, globalEntry.ease),
          timesSeen: Math.max(entry.timesSeen, globalEntry.timesSeen),
          timesHovered: Math.max(entry.timesHovered, globalEntry.timesHovered),
        });
      } else {
        mediaWords.set(entry.word, { ...entry });
      }
    }

    const failedWords = Array.from(mediaWords.values()).filter((w) => w.ease < 2.5 || w.timesHovered > 0);
    const failedGrammar = Object.values(s.grammarEncountered).filter((g) => g.timesFailed > 0);

    const context: ConversationAgentContext = {
      mediaName: name,
      mediaType: 'book',
      mediaHash: s.mediaHash,
      assessedLevel: level,
      assessedLevelName: level !== null && levelNames[String(level)] ? levelNames[String(level)] : '',
      language: lang,
      failedWords,
      failedGrammar,
      wordLevelPercentages: wordLevels,
      grammarLevelPercentages: grammarLevels,
    };

    getBridge().window.openWindow({ type: 'conversation-agent', context: context as unknown as Record<string, unknown> });
  };

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
            onToggleWordSidebar={() => setShowWordSidebar(!showWordSidebar())}
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
              pageMode={pageMode}
              hasOcrForPage={hasOcrForPage}
              onGoToPage={goToPage}
          />
        </Show>

        {/* Main Content */}
        <main class={`reader-main ${showSidebar() ? 'with-sidebar' : ''} ${showWordSidebar() ? 'with-word-sidebar' : ''} ${fitMode()}`}>
          <Show
              when={pages().length > 0}
              fallback={<ReaderWelcomeCard isDragging={isDragging} onOpenFolder={handleOpenFolder} onOpenPdf={handleOpenPdf} />}
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
                        computed = t('mlearn.Reader.Status.CleaningUp');
                      } else if (taskPageIdx >= visibleStart && taskPageIdx <= visibleEnd) {
                        // Processing a VISIBLE page
                        computed = t('mlearn.Reader.Status.Recognizing');
                      } else {
                        // Processing a page AFTER current view - caching
                        computed = t('mlearn.Reader.Status.Caching', { x: 1, y: 2 });
                      }
                    } else if (isPending()) {
                      const taskPageIdx = page.index;
                      if (taskPageIdx < visibleStart) {
                        computed = t('mlearn.Reader.Status.CleaningUp');
                      } else if (taskPageIdx >= visibleStart && taskPageIdx <= visibleEnd) {
                        computed = t('mlearn.Reader.Status.Pending');
                      } else {
                        computed = t('mlearn.Reader.Status.Queued');
                      }
                    } else {
                      // No active or pending work for this page.
                      // If OCR result exists, it's ready; otherwise no new status to compute
                      computed = ocrResults[page.id] ? t('mlearn.Reader.Status.Ready') : null;
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
                            onContextMenu={handleImageContextMenu}
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
                              shape={"circle"}
                          />
                        </div>
                        {/* OCR Overlay for each visible page */}
                        <Show when={imageRefs()[page.id] && ocrResults[page.id]}>
                          <OcrOverlay
                              result={ocrResults[page.id]}
                              imageElement={imageRefs()[page.id]}
                              visible={showOcrOverlay()}
                              debugOcr={ocrDebugOverlay()}
                              zoneDeltaThreshold={zoneDeltaThreshold()}
                              onWordHover={handleOcrWordHover}
                              onWordLeave={handleOcrWordLeave}
                              onContextMenu={handleOcrContextMenu}
                              onTokenDataChange={(entries) => handlePageTokenData(page.id, entries)}
                              highlightedOriginalIndices={(() => {
                                const entry = sidebarHoveredEntry();
                                if (!entry || entry.pageId !== page.id || entry.box.__originalIdx == null) return undefined;
                                return new Set([entry.box.__originalIdx]);
                              })()}
                          />
                        </Show>
                      </div>
                  );
                }}
              </For>
            </div>
          </Show>
        </main>

        <Show when={showWordSidebar()}>
          <ReaderUnknownWordsSidebar
              words={visibleUnknownWords}
              addingWordKeys={addingSidebarWords}
              isAddingAll={isAddingAllSidebarWords}
              onAddWord={handleAddSidebarWord}
              onAddAll={handleAddAllSidebarWords}
              onIgnoreWord={handleIgnoreSidebarWord}
              onWordHover={setSidebarHoveredEntry}
              onWordLeave={() => setSidebarHoveredEntry(null)}
          />
        </Show>

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
            onOpenConversationAgent={openConversationAgent}
            debugOcr={ocrDebugOverlay}
            onToggleDebugOcr={toggleOcrDebugOverlay}
            lastOcrTiming={lastOcrTiming}
            paddleOcrScale={paddleOcrScale}
            onPaddleOcrScaleChange={setPaddleOcrScale}
            zoneDeltaThreshold={zoneDeltaThreshold}
            onZoneDeltaThresholdChange={setZoneDeltaThreshold}
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
              onOpenExplainer={handleOpenExplainer}
          />
        </Show>

        {/* LLM Explainer Popup */}
        <ExplainerPopup
            isOpen={explainerOpen()}
            onClose={handleCloseExplainer}
            word={explainerWord()}
            contextPhrase={explainerContext()}
            initialPosition={explainerPosition()}
        />

        {/* Magnifying Glass */}
        <MagnifyingGlass
            imageElements={Object.values(imageRefs())}
            active={magnifierActive()}
        />
      </div>
  );
};
