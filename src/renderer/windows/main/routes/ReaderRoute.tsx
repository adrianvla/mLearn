import { LanguageProvider } from '../../../context/LanguageContext';
import { useMediaSourceLanguage, type MediaSourceLanguageScope, type PreparedMediaSource } from '../../../hooks/useMediaSourceLanguage';
import { mediaFileResourceId } from '../../../services/mediaSourceLanguage';
import { SourceLanguageSelect } from '../../../components/common';
import { setActiveMediaSource } from '../applicationHost';
import { consumeMediaWorkspaceReturn } from './mediaWorkspaceReturn';
import { tokenLookupContext, fetchTranslation } from '../../../hooks/useTranslation';
import { hasSignedInCloudSession, withCloudAuth } from '../../../services/cloudSessionManager';
import { classifyProviderFailure } from '../../../services/providerFailure';
/**
 * Reader Route
 * Manga/Image OCR reader integrated into main window via router
 */

import { Component, createSignal, For, Show, onMount, onCleanup, createEffect, createMemo, batch, on, untrack, type JSX } from 'solid-js';
import { perfCount } from '../../../utils/perfCounters';
import { createStore, reconcile } from 'solid-js/store';
import { useNavigate } from '@solidjs/router';
import { OcrOverlay, MagnifyingGlass, OcrWord, type OcrBox, type OcrResult, type OcrProcessingTimes } from '../../../components/reader';
import { WordHover } from '../../../components/subtitle/WordHover';
import { StableWordHover } from '../../../components/subtitle/StableWordHover';
import { ExplainerPopup } from '../../../components/subtitle/ExplainerPopup';
import { initWordLookupBridge } from '../../../services/wordLookupService';
import { useOCR, prepareBlobForOCR, sendImageForOCR, assertOcrLanguageDataReady, getOcrLanguageDataReadinessError, useTranslation, useDictionary, useTokenizer, useWordHover, getCachedTranslation, getGlobalHoverManager, useMediaStats, warmTranslationCache, isTranslationWarming } from '../../../hooks';
import { useSettings, useLocalization, useFlashcards, useLanguage } from '../../../context';
import { parseKeybind } from '../../../components/common';
import { hashWordSync } from '../../../services/srsAlgorithm';
import { isLLMReady } from '../../../services/llmProvider';
import { requireCapability } from '../../../services/capabilityUnavailable';
import type { Token, TranslationResponse, DictionaryEntry, ConversationAgentContext, ReaderSpreadDirection, Settings, LanguageData } from '../../../../shared/types';
import { DEFAULT_SETTINGS } from '../../../../shared/types';
import { getBridge } from '../../../../shared/bridges';
import { getBackend, CloudOCRAdapter, resolveCloudApiUrl } from '../../../../shared/backends';
import { getSettingRequirementWarningParams } from '../../../../shared/settingRequirements';
import { readerReadingAnnotationHiderEnabled } from '../../../../shared/readingAnnotationSettings';
import { isElectron } from '../../../../shared/platform';
import { ReaderNav, ReaderSidebar, ReaderUnknownWordsSidebar, ReaderWelcomeCard, ReaderStatusBar, type ReaderUnknownWordEntry } from './components';
import { ProgressRing } from '../../../components/common';
import { isPdfFile, pdfToImages, pdfToTextPages } from '../../../services/pdfService';
import { epubToContentPages, isEpubFile, type EpubContent, type EpubReadingSpan } from '../../../services/epubService';
import { captureBlobThumbnail, getRecentProgressPercent, saveToRecentItems } from '../../../services/thumbnailService';
import { captureReaderImageForOccurrence } from '../../../services/flashcardImageCapture';
import { parseWorkName } from '../../../utils/subtitleParsing';
import { readerBookDisplayTitle } from '../../../utils/readerDisplayTitle';
import { cleanContextPhrase } from '../../../utils/phraseExtraction';
import { filterSuggestedWords } from '../../../utils/suggestedFlashcards';
import { computeWordLevelPercentages, computeGrammarLevelPercentages, assessMediaDifficulty } from '../../../utils/levelPercentages';
import { buildGrammarExposure } from '../../../utils/grammarExposure';
import {
  getReaderCollatePagesForLanguage,
  getReaderFirstPageSingleForLanguage,
  getReaderPageModeForLanguage,
  resolveCloudOcrEngine,
  getOcrRuntimeConfig,
  getTokenJoinSeparator,
  getTokenizerCacheNamespace,
  resolveLanguageContentFontOption,
} from '../../../../shared/languageFeatures';
import { buildWordHoverFlashcardContent, hasUsefulWordHoverContent } from '../../../components/subtitle/wordHoverHelpers';
import { addAllCapturedWords } from '../../../services/addAllCapturedWords';
import { resolveCapturedWordEligibility } from '../../../services/wordCaptureEligibility';
import { reportCaptureFailure } from '../../../services/wordCaptureFailure';
import { excludeWordFromStudy } from '../../flashcards/excludeWordFromStudy';
import { isWordInLanguageScript } from '../../../../shared/utils/textUtils';
import { showToast } from '../../../components/common/Feedback/Toast';
import { getUnseenSettingRequirementWarnings, markSettingRequirementWarningSeen } from '../../../services/settingRequirementWarnings';
import { syncReaderPluginActivity } from './readerPluginActivity';
import { opaqueActivityContentId } from '../../../services/activityHubRuntime';
import {
  getSpreadPageSideClass,
  getVisiblePageIndices,
  resolveBookSpreadDirection,
  resolveReaderAnnotationColor,
  resolveReaderTextFontFamily,
  resolveReaderVerticalLayout,
  type BookProgressionDirection,
  type ReaderPageMode,
} from './readerPageLayout';
import {
  auditTextPageCapacity,
  estimateTextPageCapacityFromMeasurements,
  locateSourceTokenOffsets,
  readerTextBlockEncounterId,
  readerTextTokenEncounterId,
  resetTextPageCapacityEpoch,
  paginateTextSources,
  applyReadingSpansToTokens,
  sliceReadingSpansForRange,
  type ReaderSourcePage,
  type ReaderSourceToken,
  type ReaderTextSourceChunk,
  type TextPageCapacityEpoch,
} from './readerTextPagination';
import { scrollReaderToPageStart } from './readerNavigation';
import { readerTextThemeClass } from './readerTextThemes';
import { isReaderOcrReadinessErrorMessage, readerOcrCanQueue, readerOcrShouldClearStatus, resolveReaderOcrAutomationState } from './readerOcrAutomation';
import { getReaderPassiveTrackingWord } from './readerWordTracking';
import { createReaderOcrState } from './readerOcrState';
import { createGrammarEncounterRecorder, journalGrammarEncountersForTokenGroups } from '../../../../shared/grammar/encounters';
import { createReaderPageVisits } from './readerPageVisits';
import { locationForPage, pageForLocation, parseSavedReaderLocation, progressForLocation, type ReaderSourceLocation } from './readerResume';
import { getTokenLookupWord, getWordFormCandidates } from '../../../utils/wordForms';
import { useDictionaryTargetLanguage } from '../../../hooks/useDictionaryTargetLanguage';
import { getColoredProsodyConfig, coloredProsodyNeedsDictionaryLookup } from '../../../utils/coloredProsody';
import { coloredProsodyAllowedOnSurface } from '../../../../shared/prosodySettings';
import { isWordMarkedFailed } from '@shared/utils/passiveWordTracking';
import { formatFrequencyLevelLabel } from '../../../utils/levelLabels';
import {
  getWebkitEntry,
  isWebkitDirectoryEntry,
  isWebkitFileEntry,
  type WebkitFileSystemAnyEntry,
} from '../../../utils/webkitFileSystem';
import './reader.css';
import { getLogger } from '@shared/utils/logger';
import { ensureLanguageFontLoaded } from '../../../utils/languageFonts';

const log = getLogger("renderer.reader");

interface PageImage {
  id: string;
  kind: 'image' | 'text';
  src?: string;
  name: string;
  index: number;
  blob?: Blob;
  text?: string;
  title?: string;
  previewText?: string;
  textStart?: number;
  textEnd?: number;
  readingSpans?: EpubReadingSpan[];
  sourceChunks?: ReaderTextSourceChunk[];
}

type FitMode = 'fit-height' | 'fit-width';
type PageMode = ReaderPageMode;

interface ReaderPageWordSource {
  key: string;
  word: string;
  token: Token;
  contextPhrase: string;
  pageId: string;
  box?: OcrBox;
  boxIndex: number;
  sourcePosition?: ReaderTextSourceChunk & { tokenStart: number };
  pageContentId?: string;
}

interface ReaderCompatibleOcrBox {
  box?: number[][];
  text: string;
  score?: number;
  confidence?: number;
  is_vertical?: boolean;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

interface ReaderCompatibleOcrResult {
  boxes?: ReaderCompatibleOcrBox[];
  processing_times?: OcrProcessingTimes;
  client_scale?: number;
  downscale_factor?: number;
  original_size?: { width: number; height: number };
  sent_size?: { width: number; height: number };
}

interface ReaderPageTokenData {
  boxIndex: number;
  box?: OcrBox;
  tokens: Token[];
  contextPhrase: string;
  sourceChunk?: ReaderTextSourceChunk;
  pageContentId?: string;
}

interface ReaderTextPageProps {
  page: PageImage;
  tokenizeMany: (texts: string[]) => Promise<Token[][]>;
  tokenJoinSeparator: string;
  onWordHover: (token: Token, rect: DOMRect, contextPhrase: string, element: HTMLElement, trackPassiveHover: boolean) => void;
  onWordMove?: (token: Token, rect: DOMRect, contextPhrase: string, element: HTMLElement, trackPassiveHover: boolean) => void;
  onWordLeave: () => void;
  vertical?: boolean;
  onTokenized?: () => void;
  onTokenDataChange?: (entries: ReaderPageTokenData[]) => void;
  onTokenizeStateChange?: (inFlight: boolean) => void;
}

interface CropSelection {
  pageId: string;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
}

interface CropRegion {
  id: string;
  rect: { left: number; top: number; width: number; height: number };
}

function normalizeReaderOcrBox(box: ReaderCompatibleOcrBox): OcrBox | null {
  if (Array.isArray(box.box) && box.box.length > 0) {
    return {
      box: box.box,
      text: box.text,
      score: box.score ?? box.confidence,
      is_vertical: box.is_vertical,
    };
  }

  if (
    typeof box.x === 'number'
    && typeof box.y === 'number'
    && typeof box.width === 'number'
    && typeof box.height === 'number'
  ) {
    return {
      box: [
        [box.x, box.y],
        [box.x + box.width, box.y],
        [box.x + box.width, box.y + box.height],
        [box.x, box.y + box.height],
      ],
      text: box.text,
      score: box.score ?? box.confidence,
      is_vertical: box.is_vertical,
    };
  }

  return null;
}

function normalizeReaderOcrResult(result: ReaderCompatibleOcrResult): OcrResult {
  return {
    ...result,
    boxes: (result.boxes ?? [])
      .map(normalizeReaderOcrBox)
      .filter((box): box is OcrBox => box !== null),
  };
}

export const ReaderTextPage: Component<ReaderTextPageProps> = (props) => {
  const [tokenParagraphs, setTokenParagraphs] = createSignal<ReaderSourceToken[][]>([]);
  const [tokenizeFailed, setTokenizeFailed] = createSignal(false);
  const { settings } = useSettings();
  const { currentLangData, getLanguageFeatures } = useLanguage();
  const tokenizerCapabilities = createMemo(() => getLanguageFeatures().tokenizerCapabilities);
  const dictionaryTargetLanguage = useDictionaryTargetLanguage();
  const text = () => props.page.text ?? '';
  const textBlocks = () => text().split(/\n{2,}/u).map((block) => block.trim()).filter(Boolean);
  const headingText = () => {
    const firstBlock = textBlocks()[0];
    return firstBlock && props.page.title && firstBlock === props.page.title ? firstBlock : '';
  };
  const bodyBlocks = () => {
    const blocks = textBlocks();
    return headingText() ? blocks.slice(1) : blocks;
  };
  const bodyBlocksWithOffsets = () => {
    const blocks = textBlocks();
    const skipFirst = Boolean(headingText());
    let offset = 0;
    return blocks.flatMap((block, index) => {
      const start = offset;
      offset += block.length + 2;
      return skipFirst && index === 0 ? [] : [{ block, start }];
    });
  };
  const bodyText = () => {
    return bodyBlocks().join('\n\n');
  };
  const hasTokenParagraphs = () => tokenParagraphs().some((paragraph) => paragraph.length > 0);
  createEffect(() => {
    const paragraphs = bodyBlocksWithOffsets();
    props.onTokenDataChange?.([]);
    if (!paragraphs.length) {
      setTokenParagraphs([]);
      return;
    }

    let cancelled = false;
    let inFlightDone = false;
    const reportInFlightDone = () => {
      if (inFlightDone) return;
      inFlightDone = true;
      props.onTokenizeStateChange?.(false);
    };
    props.onTokenizeStateChange?.(true);

    // One batched call: cache lookups, backend requests, and the DB persist
    // (single put + prune) are fanned out inside tokenizeMany.
    // Warm key: page id + full-content hash, so repagination that changes text
    // re-warms while identical content stays deduped.
    const warmKey = `${props.page.id}:${hashWordSync(paragraphs.map(({ block }) => block).join('\n\n'))}`;
    props.tokenizeMany(paragraphs.map(({ block }) => block))
      .then((nextParagraphs) => {
        if (!cancelled) {
          const spans = props.page.readingSpans;
          const nextTokenParagraphs = nextParagraphs.map((tokens, index) => {
            const { block, start } = paragraphs[index];
            return applyReadingSpansToTokens(block, tokens, sliceReadingSpansForRange(spans, start, start + block.length));
          });
          setTokenParagraphs(nextTokenParagraphs);
          props.onTokenDataChange?.(nextTokenParagraphs.map((tokens, boxIndex) => ({
            boxIndex, tokens, contextPhrase: paragraphs[boxIndex].block,
            pageContentId: hashWordSync(props.page.text ?? ''),
            ...(props.page.sourceChunks?.[boxIndex + (headingText() ? 1 : 0)]
              ? { sourceChunk: props.page.sourceChunks[boxIndex + (headingText() ? 1 : 0)] }
              : {}),
          })));
          setTokenizeFailed(false);
          reportInFlightDone();
          props.onTokenized?.();
          warmReaderPageTranslations(warmKey, nextTokenParagraphs, {
            settings,
            languageData: currentLangData(),
            dictionaryTargetLanguage: dictionaryTargetLanguage(),
            tokenizerCapabilities: tokenizerCapabilities(),
          });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setTokenParagraphs([]);
          setTokenizeFailed(true);
          reportInFlightDone();
        }
      });

    onCleanup(() => {
      cancelled = true;
      reportInFlightDone();
    });
  });

  return (
    <article class="reader-text-page" classList={{ vertical: props.vertical === true }}>
      <Show when={headingText()}>
        <h2>{headingText()}</h2>
      </Show>
      <Show
        when={!tokenizeFailed() && hasTokenParagraphs()}
        fallback={(
          <div class="reader-text-page-plain">
            <For each={bodyBlocks()}>
              {(paragraph) => (
                <p class="reader-text-paragraph">{paragraph}</p>
              )}
            </For>
          </div>
        )}
      >
        <div class="reader-text-page-tokens">
          <For each={tokenParagraphs()}>
            {(paragraphTokens) => (
              <p class="reader-text-paragraph">
                <For each={paragraphTokens}>
                  {(token, index) => (
                    <>
                      <OcrWord
                        token={token}
                        authoredReading={token.authoredReading}
                        authoredText={token.authoredText}
                        lookupContext={tokenLookupContext(token, bodyText())}
                        onWordEnter={(hoverToken, event, trackPassiveHover) => {
                          const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
                          props.onWordHover(hoverToken, rect, bodyText(), event.currentTarget as HTMLElement, trackPassiveHover);
                        }}
                        onWordMove={(hoverToken, event) => {
                          const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
                          props.onWordMove?.(hoverToken, rect, bodyText(), event.currentTarget as HTMLElement, true);
                        }}
                        onWordLeave={props.onWordLeave}
                        withReadingAnnotation
                      />
                      <Show when={props.tokenJoinSeparator && index() < paragraphTokens.length - 1}>
                        {props.tokenJoinSeparator}
                      </Show>
                    </>
                  )}
                </For>
              </p>
            )}
          </For>
        </div>
      </Show>
    </article>
  );
};

// Once-per-page guard so re-tokenization of the same page does not re-warm the cache.
const warmedPageTranslationIds = new Set<string>();

export function warmReaderPageTranslations(
  pageId: string,
  paragraphTokens: Token[][],
  options: {
    settings: Settings;
    languageData: LanguageData | null;
    dictionaryTargetLanguage?: string;
    tokenizerCapabilities?: { providesLemmas: boolean };
  },
): void {
  const config = getColoredProsodyConfig(options.languageData);
  const enabled = options.settings.coloredProsodyEnabled ?? DEFAULT_SETTINGS.coloredProsodyEnabled;
  if (!config || !enabled || !coloredProsodyAllowedOnSurface(options.settings, 'other')) return;
  if (!coloredProsodyNeedsDictionaryLookup(config)) return;
  if (warmedPageTranslationIds.has(pageId)) return;
  warmedPageTranslationIds.add(pageId);
  const uniquePageWords = [...new Set(
    paragraphTokens.flat().map((token) => getTokenLookupWord(token, options.tokenizerCapabilities) || token.surface || token.word),
  )].filter(Boolean);
  if (uniquePageWords.length === 0) return;
  void warmTranslationCache(
    uniquePageWords,
    undefined,
    undefined,
    options.settings.language,
    options.dictionaryTargetLanguage,
    options.languageData,
  );
}

// Queue system for OCR to ensure serial processing (1 at a time)
// and allow cancellation of pending tasks by simply removing them from queue.
interface OcrTask {
  page: PageImage;
  isCaching: boolean; // true if this is a background caching task, not visible
}
let epubBlobUrls: string[] = [];

export const revokeEpubBlobUrls = () => {
  for (const url of epubBlobUrls) URL.revokeObjectURL(url);
  epubBlobUrls = [];
};

export const adoptEpubBlobUrls = (newBlobUrls: string[]) => {
  revokeEpubBlobUrls();
  epubBlobUrls = newBlobUrls;
};

// Per-book page memory (like old app's sequencer.js)
const STORAGE_KEY_PREFIX = 'reader:last-page:';
const ACTIVE_BOOK_STORAGE_KEY = 'reader:active-book-path';
const makeStorageKey = (bookId: string) => `${STORAGE_KEY_PREFIX}${bookId}`;

const imagePagesFromPdfImages = (images: Array<{ name: string; url: string; blob: Blob }>): PageImage[] => (
  images.map((img, index) => ({
    id: `page-${index}-${img.name}`,
    kind: 'image',
    src: img.url,
    name: img.name,
    index,
    blob: img.blob,
  }))
);

export async function prepareEpubReaderLoad(
  content: EpubContent,
  title: string,
  capacity: number,
  loadSavedPage: () => Promise<ReaderSourceLocation | number | null>,
  requestedLocation?: ReaderSourceLocation,
) {
  const newBlobUrls: string[] = [];
  try {
    // ponytail: img+text chapters place images after the chapter's text run (document-position approximation).
    const sources: ReaderSourcePage[] = content.items.map((item) => {
      if (item.kind === 'text') return item;
      const blob = new Blob([new Uint8Array(item.data)], { type: item.mediaType });
      const url = URL.createObjectURL(blob);
      newBlobUrls.push(url);
      return { kind: 'image', name: item.name, title: item.title, text: '', previewText: '', src: url, blob };
    });
    const pages = paginateTextSources(sources, title, capacity);
    const declaredCover = sources.find((source) => source.kind === 'image' && source.name === content.coverImage?.zipPath);
    const coverBlob = declaredCover?.blob ?? sources.find((source) => source.kind === 'image')?.blob;
    const saved = requestedLocation ?? await loadSavedPage();
    const startPage = typeof saved === 'number'
      ? (saved >= 0 && saved < pages.length ? saved : 0)
      : saved ? pageForLocation(pages, saved) : 0;
    const startLocation = typeof saved === 'object' && saved !== null ? saved : locationForPage(pages, startPage);
    return { sources, pages, coverBlob, newBlobUrls, startPage, startLocation, resumed: saved !== null };
  } catch (error) {
    for (const url of newBlobUrls) URL.revokeObjectURL(url);
    throw error;
  }
}

const loadSavedPageIndex = async (bookId: string | null): Promise<number | null> => {
  if (!bookId) return null;
  try {
    const raw = await getBridge().kvStore.kvGet(makeStorageKey(bookId));
    if (raw === null) return null;
    const val = parseSavedReaderLocation(raw);
    return typeof val === 'number' ? val : null;
  } catch (err) {
    log.warn('[Reader] Failed to read saved page index', err);
    return null;
  }
};

const loadSavedReaderLocation = async (bookId: string | null): Promise<ReaderSourceLocation | number | null> => {
  if (!bookId) return null;
  try { return parseSavedReaderLocation(await getBridge().kvStore.kvGet(makeStorageKey(bookId))); }
  catch (error) { log.warn('[Reader] Failed to read saved source location', error); return null; }
};

const persistSourceLocation = (bookId: string | null, location: ReaderSourceLocation | null): void => {
  if (bookId && location) void getBridge().kvStore.kvSet(makeStorageKey(bookId), JSON.stringify(location));
};

const persistPageIndex = (bookId: string | null, pageIndex: number, totalPages: number) => {
  if (!bookId || totalPages === 0) return;
  const normalized = Math.min(Math.max(pageIndex, 0), totalPages - 1);
  getBridge().kvStore.kvSet(makeStorageKey(bookId), String(normalized));
};

const persistActiveBookPath = async (bookPath: string): Promise<void> => {
  const trimmedPath = bookPath.trim();
  if (!trimmedPath) return;
  try {
    await getBridge().kvStore.kvSet(ACTIVE_BOOK_STORAGE_KEY, trimmedPath);
  } catch (err) {
    log.warn('[Reader] Failed to persist active book path', err);
  }
};

const loadActiveBookPath = async (): Promise<string | null> => {
  try {
    const path = await getBridge().kvStore.kvGet(ACTIVE_BOOK_STORAGE_KEY);
    return path?.trim() || null;
  } catch (err) {
    log.warn('[Reader] Failed to read active book path', err);
    return null;
  }
};

const clearActiveBookPath = async (): Promise<void> => {
  try {
    await getBridge().kvStore.kvRemove(ACTIVE_BOOK_STORAGE_KEY);
  } catch (err) {
    log.warn('[Reader] Failed to clear active book path', err);
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
  const { settings } = useSettings();
  const scope = useMediaSourceLanguage(() => settings.language,
    () => (settings.languageVariants ?? DEFAULT_SETTINGS.languageVariants)[settings.language]);
  return <LanguageProvider language={scope.language()} sourceKey={scope.sourceKey()}
    languageVariants={{ ...(settings.languageVariants ?? DEFAULT_SETTINGS.languageVariants), [scope.language()]: scope.variantId() ?? '' }}
    frequencyProviderSelections={settings.frequencyProviderSelections}
    frequencyLevelSystemSelections={settings.frequencyLevelSystemSelections}>
    <ReaderRouteContent scope={scope} />
  </LanguageProvider>;
};

const ReaderRouteContent: Component<{ scope: MediaSourceLanguageScope }> = props => {
  const ocrState = createReaderOcrState();
  const ocrResults = ocrState.results;
  const [ocrQueue, setOcrQueue] = createSignal<OcrTask[]>([]);
  const [processingTask, setProcessingTask] = createSignal<OcrTask | null>(null);
  const [cloudOcrAuthCancelled, setCloudOcrAuthCancelled] = createSignal(false);
  let lastOcrReadinessWarning = '';
  let readerDisposed = false;
  onCleanup(() => {
    readerDisposed = true;
    ocrState.reset();
    setOcrQueue([]);
  });
  const navigate = useNavigate();
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { isProcessing: _ocrHookProcessing } = useOCR();
  const { settings, updateSettings } = useSettings();
  const { t } = useLocalization();
  const flashcardCtx = useFlashcards();
  const langCtx = useLanguage();
  const sourceLanguage = props.scope.language;
  const { detectGrammarInText, supportsGrammar, isTokenTranslatable, currentLangData, getCanonicalForm, getWordVariants, getReadingVariants, getLanguageFeatures } = langCtx;
  const ocrEnabled = () => settings.ocrEnabled ?? DEFAULT_SETTINGS.ocrEnabled;
  createEffect(() => {
    if (settings.ocrProvider !== 'cloud' || hasSignedInCloudSession(settings)) {
      setCloudOcrAuthCancelled(false);
    }
  });
  const dictionaryTargetLanguage = useDictionaryTargetLanguage(sourceLanguage);
  const wordLookupOptions = { sourceKey: props.scope.sourceKey, getCanonicalForm, getWordVariants, getReadingVariants, dictionaryTargetLanguage, languageData: currentLangData };
  const { translateWord } = useTranslation({
    immediate: true,
    language: () => sourceLanguage(),
    ...wordLookupOptions,
  });
  const getWordForms = (word: string): string[] => (
    getWordFormCandidates(word, getCanonicalForm, getWordVariants, { languageData: currentLangData() })
  );
  const tokenizerCapabilities = createMemo(() => getLanguageFeatures().tokenizerCapabilities);
  const { tokenizeMany } = useTokenizer({ sourceKey: props.scope.sourceKey, language: sourceLanguage, languageData: currentLangData });
  const { lookup } = useDictionary({ language: () => sourceLanguage(), ...wordLookupOptions });
  const {
    hoverData: ocrHoverData,
    isVisible: isOcrHoverVisible,
    showHover: showOcrHover,
    hideHover: hideOcrHover,
    cancelHide: cancelOcrHide,
    forceHide: forceHideOcrHover,
    updateHoverPosition: updateOcrHoverPosition,
    admitVisibleReveal: admitOcrReveal,
    isCurrentHover: isCurrentOcrHover,
  } = useWordHover({
    onDismiss: (data) => {
      if (data.trackPassiveHover !== false && data.lookupWord && data.language) {
        flashcardCtx.cancelWordHover(data.lookupWord, data.language);
      }
    },
  });
  const parseCurrentWorkName = (name: string): string => parseWorkName(name, {
    languageCodes: langCtx.supportedLanguages(),
  });
  let settingRequirementWarningsChecked = false;

  // Media stats for this reader session
  const mediaStats = useMediaStats({ mediaType: 'book', language: sourceLanguage() });

  const [pages, setPages] = createSignal<PageImage[]>([]);
  const [textSourcePages, setTextSourcePages] = createSignal<ReaderSourcePage[] | null>(null);
  const [textPageCapacity, setTextPageCapacity] = createSignal(460);
  const [currentPage, setCurrentPage] = createSignal(0);
  const [sourceLocation, setSourceLocation] = createSignal<ReaderSourceLocation | null>(null);
  const [isWindowFocused, setIsWindowFocused] = createSignal(typeof document !== 'undefined' ? document.hasFocus() : false);
  const [isWindowVisible, setIsWindowVisible] = createSignal(typeof document === 'undefined' || document.visibilityState === 'visible');
  const [currentBookId, setCurrentBookId] = createSignal<string | null>(null);
  // Track the filesystem path of the current book (PDF file or directory)
  // Used for persisting to recent items so users can click to re-open
  const [currentBookPath, setCurrentBookPath] = createSignal<string>('');
  createEffect(() => setActiveMediaSource(currentBookPath() ? { workspace: 'reader', path: currentBookPath() } : undefined));
  onCleanup(() => setActiveMediaSource(undefined));
  const [currentBookFormat, setCurrentBookFormat] = createSignal<'images' | 'pdf' | 'epub' | null>(null);
  const [currentBookFile, setCurrentBookFile] = createSignal<File | null>(null);
  const [bookProgressionDirection, setBookProgressionDirection] = createSignal<BookProgressionDirection>(null);
  const [bookDeclaresVertical, setBookDeclaresVertical] = createSignal(false);
  const [fitMode, setFitMode] = createSignal<FitMode>('fit-height');
  const pageMode = () => getReaderPageModeForLanguage(settings, currentLangData());
  // This supersedes getReaderSpreadDirectionForLanguage so an EPUB's progression can take precedence.
  const readerSpreadDirection = () => resolveBookSpreadDirection(
    settings.readerSpreadDirection,
    DEFAULT_SETTINGS.readerSpreadDirection!,
    currentLangData()?.reader?.spreadDirection,
    bookProgressionDirection(),
  );
  const readerBookVertical = () => resolveReaderVerticalLayout({
    isEpubBook: currentBookFormat() === 'epub',
    declaresVerticalWriting: bookDeclaresVertical(),
    progressionDirection: bookProgressionDirection(),
    supportsVerticalText: getLanguageFeatures().supportsVerticalText,
  });
  onCleanup(revokeEpubBlobUrls);
  const readerTextFontStyle = () => settings.readerTextFontStyle ?? DEFAULT_SETTINGS.readerTextFontStyle!;
  const selectedLanguageFontId = () => (
    settings.readerContentFontSelections?.[sourceLanguage()]
    ?? DEFAULT_SETTINGS.readerContentFontSelections[sourceLanguage()]
  );
  const readerTextFontFamily = () => {
    return resolveReaderTextFontFamily(readerTextFontStyle(), currentLangData(), selectedLanguageFontId(), settings.readerTextFontFamily ?? '');
  };
  createEffect(() => {
    if (readerTextFontStyle() !== 'language') return;
    const option = resolveLanguageContentFontOption(currentLangData(), selectedLanguageFontId());
    void ensureLanguageFontLoaded(option).catch((error: unknown) => {
      log.warn('Failed to load language content font', error);
    });
  });
  const readerTextStyle = (): JSX.CSSProperties => ({
    '--reader-text-font-family': readerTextFontFamily(),
    '--reader-text-font-weight': `${settings.readerTextFontWeight ?? DEFAULT_SETTINGS.readerTextFontWeight}`,
    '--reader-text-font-size': `${settings.readerTextSize ?? DEFAULT_SETTINGS.readerTextSize!}rem`,
    '--reader-text-line-height': `${settings.readerTextLineHeight ?? DEFAULT_SETTINGS.readerTextLineHeight!}`,
    '--reader-text-width': `${settings.readerTextWidth ?? DEFAULT_SETTINGS.readerTextWidth!}ch`,
    '--reader-text-gutter-scale': `${settings.readerTextMargin ?? DEFAULT_SETTINGS.readerTextMargin!}`,
    '--reading-annotation-color': resolveReaderAnnotationColor(settings),
  } as JSX.CSSProperties);
  // When true and in double-page mode, first page displays alone (cover page)
  // This offsets the pairing: [0], [1,2], [3,4]... instead of [0,1], [2,3]...
  const firstPageSingle = () => getReaderFirstPageSingleForLanguage(settings, currentLangData());
  const collatePages = () => getReaderCollatePagesForLanguage(settings, currentLangData());

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
  const showWordSidebar = () => settings.rightSidebarOpen ?? DEFAULT_SETTINGS.rightSidebarOpen;
  const setShowWordSidebar = (open: boolean) => updateSettings({ rightSidebarOpen: open });
  const [bookTitle, setBookTitle] = createSignal('');
  const [bookDisplayTitle, setBookDisplayTitle] = createSignal('');
  const [ocrStatus, setOcrStatus] = createSignal('');
  const [bookLoadError, setBookLoadError] = createSignal<'open-failed' | 'no-images' | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [isProcessingOcr, _setIsProcessingOcr] = createSignal(false);
  const [isDragging, setIsDragging] = createSignal(false);
  const [ocrProgress, setOcrProgress] = createSignal(0);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_currentOcrResult, _setCurrentOcrResult] = createSignal<OcrResult | null>(null);
  const [showOcrOverlay, setShowOcrOverlay] = createSignal(true);
  const [ocrDictionaryEntries, setOcrDictionaryEntries] = createSignal<DictionaryEntry[]>([]);
  const [ocrTranslationData, setOcrTranslationData] = createSignal<TranslationResponse | null>(null);

  // Explainer popup state
  const [explainerOpen, setExplainerOpen] = createSignal(false);
  const [explainerWord, setExplainerWord] = createSignal('');
  const [explainerContext, setExplainerContext] = createSignal('');
  const [explainerMode, setExplainerMode] = createSignal<'word' | 'phrase'>('word');
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

  syncReaderPluginActivity({
    bookTitle,
    currentPage,
    pages,
    isFocused: isWindowFocused,
    isVisible: isWindowVisible,
    contentId: () => opaqueActivityContentId('reader', currentBookId() ?? currentBookPath()),
    language: () => sourceLanguage(),
  });

  // OCR debug overlay (dev mode only)
  const [ocrDebugOverlay, setOcrDebugOverlay] = createSignal(false);
  const toggleOcrDebugOverlay = () => setOcrDebugOverlay(!ocrDebugOverlay());
  const cropMode = () => settings.readerCropMode ?? DEFAULT_SETTINGS.readerCropMode ?? false;
  const documentOcr = () => settings.readerDocumentOcr ?? DEFAULT_SETTINGS.readerDocumentOcr ?? false;
  const showDocumentOcrToggle = () => currentBookFormat() === 'pdf';
  const [cropAddMode, setCropAddMode] = createSignal(false);
  const [cropSelection, setCropSelection] = createSignal<CropSelection | null>(null);
  const [croppedRegions, setCroppedRegions] = createSignal<Record<string, CropRegion[]>>({});
  const [cropProcessingPageId, setCropProcessingPageId] = createSignal<string | null>(null);
  const toggleCropMode = () => {
    const enabled = cropMode();
    updateSettings({ readerCropMode: !enabled });
    setCropSelection(null);
    if (!enabled) {
      setCropAddMode(true);
      setOcrQueue([]);
    }
  };

  const toggleCropAddMode = () => {
    setCropSelection(null);
    setCropAddMode((enabled) => !enabled);
  };

  const toggleDocumentOcr = () => {
    const next = !documentOcr();
    updateSettings({ readerDocumentOcr: next });
    const bookPath = currentBookPath();
    if (currentBookFormat() === 'pdf' && bookPath) {
      void loadBookFromPath(bookPath, next);
      return;
    }
    const file = currentBookFile();
    if (currentBookFormat() === 'pdf' && file) {
      void loadPdfFileIntoReader(file, '', next);
    }
  };

  createEffect(() => {
    if (cropMode()) {
      setOcrQueue([]);
    } else {
      setCropSelection(null);
    }
  });

  // OCR detection downscale slider (dev mode only)
  const [ocrDetectionScale, setOcrDetectionScale] = createSignal(80);

  // Dev-mode live-tuneable OCR zone clustering parameters
  const [zoneDeltaThreshold, setZoneDeltaThreshold] = createSignal(15);

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
  let readerMainRef: HTMLElement | undefined;
  const [imageRefs, setImageRefs] = createSignal<Record<string, HTMLImageElement>>({});
  const [ocrPageWords, setOcrPageWords] = createStore<Record<string, ReaderPageWordSource[]>>({});
  const [pageTokenGroups, setPageTokenGroups] = createStore<Record<string, ReaderPageTokenData[]>>({});

  const captureOcrRequest = (page: PageImage) => {
    const request = ocrState.capture();
    const language = sourceLanguage();
    const sourceKey = props.scope.sourceKey();
    const generation = getTokenizerCacheNamespace(currentLangData());
    return {
      ...request,
      isCurrent: () => !readerDisposed && request.isCurrent()
        && language === sourceLanguage() && sourceKey === props.scope.sourceKey()
        && generation === getTokenizerCacheNamespace(currentLangData())
        && pages().includes(page),
    };
  };

  createEffect(on(() => [sourceLanguage(), props.scope.sourceKey(), getTokenizerCacheNamespace(currentLangData()), settings.ocrProvider] as const, () => {
    batch(() => {
      ocrState.reset();
      setOcrQueue([]);
      setCroppedRegions({});
      setOcrPageWords(reconcile({}));
      setPageTokenGroups(reconcile({}));
      setOcrCompletedIds(new Set<string>());
    });
  }));
  createEffect(on(() => [sourceLanguage(), currentPage(), currentBookId()] as const, () => {
    forceHideOcrHover();
  }));
  createEffect(on(() => [isWindowFocused(), isWindowVisible()] as const, ([focused, visible]) => {
    if (!focused || !visible) forceHideOcrHover();
  }));
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

    const hasEntries = items.some((item) => getWebkitEntry(item) !== null);
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

    const readEntry = async (entry: WebkitFileSystemAnyEntry | null, isTopLevel: boolean = false): Promise<File[]> => {
      if (!entry) return [];
      if (isWebkitFileEntry(entry)) {
        return new Promise((resolve) => {
          entry.file((file: File) => resolve([file]));
        });
      }
      if (isWebkitDirectoryEntry(entry)) {
        // Capture the folder name and path from the top-level directory entry
        if (isTopLevel && !droppedFolderName) {
          droppedFolderName = entry.name;
          // When dropping a folder, rawFilePath from Electron's dataTransfer.files
          // contains the folder's full filesystem path
          droppedFolderPath = rawFilePath;
        }
        const reader = entry.createReader();
        const entries: WebkitFileSystemAnyEntry[] = [];
        const readAll = (): Promise<void> => new Promise((resolve) => {
          reader.readEntries((batch) => {
            if (batch.length === 0) return resolve();
            entries.push(...batch.filter((child): child is WebkitFileSystemAnyEntry => child !== null));
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
        .map((item) => getWebkitEntry(item))
        .filter((entry): entry is WebkitFileSystemAnyEntry => entry !== null)
            .map((entry) => readEntry(entry, true))
    );

    // If no folder was dropped but we have a file path from Electron,
    // extract the parent directory as the folder path
    if (!droppedFolderPath && rawFilePath) {
      droppedFolderPath = rawFilePath.split('/').slice(0, -1).join('/');
    }

    return { files: entryFiles.flat(), droppedFolderName, droppedFolderPath, rawFilePaths };
  };

  const visiblePageIndices = createMemo(() => getVisiblePageIndices(
    pages().length,
    currentPage(),
    pageMode(),
    firstPageSingle(),
  ));

  const visiblePages = createMemo(() => {
    const allPages = pages();
    return visiblePageIndices()
      .map((pageIndex) => allPages[pageIndex])
      .filter((page): page is PageImage => page !== undefined);
  });
  // A page enters a new encounter only when it becomes visible in this reading
  // session. Token refreshes, resizing, hover and focus changes keep the visit.
  const readingSessionId = crypto.randomUUID();
  // Explicit page navigation starts a new reading visit. Repagination, sidebar
  // width and font measurements must keep the current visit.
  const [readingVisit, setReadingVisit] = createSignal(0);
  // Restoring an EPUB only positions the viewport. A reopened page does not
  // create a new exposure until the learner explicitly advances or seeks.
  const [resumedWithoutReading, setResumedWithoutReading] = createSignal(false);
  const grammarEncounterRecorder = createGrammarEncounterRecorder('reader', { exclusive: false });
  const activePageVisits = createReaderPageVisits(
    () => currentBookId() ?? currentBookPath(),
    () => visiblePages().map((page) => page.id),
  );
  createEffect(() => {
    if (resumedWithoutReading() || !flashcardCtx.isKnowledgeReady() || !isWindowVisible() || !isWindowFocused()) return;
    const book = currentBookId() ?? currentBookPath();
    for (const page of visiblePages()) {
      const visit = activePageVisits().get(`${book}\0${page.id}`);
      if (page.kind === 'image' && visit === undefined) continue;
      const passageId = page.kind === 'text'
        ? `reader:${readingSessionId}:${book}:${readingVisit()}`
        : `reader:${readingSessionId}:${visit}:${page.id}`;
      const pageContentId = page.kind === 'text' ? hashWordSync(page.text ?? '') : undefined;
      const occurrencesByBoxAndWord = new Map<string, number>();
      for (const entry of ocrPageWords[page.id] ?? []) {
        if (pageContentId !== undefined && entry.pageContentId !== pageContentId) continue;
        const word = getReaderPassiveTrackingWord(entry.token, tokenizerCapabilities());
        if (!word) continue;
        const position = `${entry.boxIndex}\0${word}`;
        const occurrence = (occurrencesByBoxAndWord.get(position) ?? 0) + 1;
        occurrencesByBoxAndWord.set(position, occurrence);
        const source = entry.sourcePosition;
        const encounterId = page.kind === 'text' && source && source.sourceStart >= 0
          ? readerTextTokenEncounterId(passageId, source, source.tokenStart)
          : `${passageId}:${entry.boxIndex}:${word}:${occurrence}`;
        flashcardCtx.trackWordSeen(
          word, entry.token.reading, undefined, sourceLanguage(),
          encounterId,
        );
      }
      if (supportsGrammar()) {
        const languageData = currentLangData();
        const grammar = languageData?.grammar;
        const groups = (pageTokenGroups[page.id] ?? []).filter((group) =>
          pageContentId === undefined || group.pageContentId === pageContentId);
        if (grammar?.length && groups.length) {
          if (page.kind === 'image') {
            journalGrammarEncountersForTokenGroups(flashcardCtx, grammarEncounterRecorder, passageId,
              groups.map((group) => group.tokens), {
                language: sourceLanguage(), grammar, languageData,
              }, passageId);
          } else {
            for (const group of groups) {
              const source = group.sourceChunk;
              const encounterId = source && source.blockStart >= 0
                ? readerTextBlockEncounterId(passageId, source)
                : `${passageId}:box:${group.boxIndex}`;
              journalGrammarEncountersForTokenGroups(flashcardCtx, grammarEncounterRecorder, encounterId, [group.tokens], {
                language: sourceLanguage(), grammar, languageData,
              }, encounterId);
            }
          }
        }
      }
    }
  });
  const visiblePagesAreText = () => visiblePages().some((page) => page.kind === 'text');
  const readerHasImagePages = () => pages().some((page) => page.kind === 'image');
  const [tokenizingTextPages, setTokenizingTextPages] = createSignal(0);
  const isTokenizingTextPages = () => tokenizingTextPages() > 0;
  // Stable identity: ReaderTextPage reads this prop inside its tokenization
  // effect, so a recreated inline handler would retrack the prop on every run.
  const handleTokenizeStateChange = (inFlight: boolean) => {
    setTokenizingTextPages((count) => Math.max(0, count + (inFlight ? 1 : -1)));
  };

  const estimateTextPageCapacity = (): number | null => {
    if (!pageContainerRef || !visiblePagesAreText()) return null;
    const vertical = readerBookVertical();
    const pageElement = pageContainerRef.querySelector<HTMLElement>('.page');
    const textElement = pageContainerRef.querySelector<HTMLElement>('.reader-text-page');
    if (!pageElement) return null;

    const pageRect = pageElement.getBoundingClientRect();
    if (pageRect.width <= 0 || pageRect.height <= 0) return null;

    const style = window.getComputedStyle(textElement ?? pageElement);
    const fontSize = Number.parseFloat(style.fontSize) || 16;
    const parsedLineHeight = Number.parseFloat(style.lineHeight);
    const lineHeight = Number.isFinite(parsedLineHeight) ? parsedLineHeight : fontSize * 1.75;
    const textRect = textElement?.getBoundingClientRect();
    const inlineExtent = vertical ? textRect?.height || pageRect.height : textRect?.width || pageRect.width;
    const blockExtent = vertical ? pageRect.width : pageRect.height;
    const sampleText = (textSourcePages() ?? [])
      .map((page) => page.text)
      .join(' ')
      .replace(/\s+/gu, '')
      .slice(0, 200);
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.font = style.font;
    const sample = sampleText || 'mmmmmmmmmmmmmmmmmmmm';
    const averageGlyphWidth = Math.max(context.measureText(sample).width / sample.length, fontSize * 0.45);
    return estimateTextPageCapacityFromMeasurements({
      inlineExtent,
      blockExtent,
      fontSize,
      lineHeight,
      vertical,
      averageGlyphWidth,
    });
  };

  let textPageCapacityEpoch: TextPageCapacityEpoch = resetTextPageCapacityEpoch(textPageCapacity());
  let textPageOverflowAuditFrame: number | undefined;

  const textPageOverflow = (article: Pick<HTMLElement, 'scrollWidth' | 'clientWidth' | 'scrollHeight' | 'clientHeight'>): number => {
    const widthRatio = article.clientWidth > 0 ? article.scrollWidth / article.clientWidth : 1;
    const heightRatio = article.clientHeight > 0 ? article.scrollHeight / article.clientHeight : 1;
    return Math.max(widthRatio, heightRatio);
  };

  const scheduleTextPageOverflowAudit = () => {
    if (textPageOverflowAuditFrame !== undefined) return;
    textPageOverflowAuditFrame = requestAnimationFrame(() => {
      textPageOverflowAuditFrame = undefined;
      if (!pageContainerRef || !visiblePagesAreText()) return;
      const articles = Array.from(pageContainerRef.querySelectorAll<HTMLElement>('.reader-text-page'));
      const overflowing = articles.filter((article) => article.scrollWidth > article.clientWidth + 2 || article.scrollHeight > article.clientHeight + 2);
      const overflowRatio = overflowing.length > 0 ? Math.max(...overflowing.map(textPageOverflow)) : 1;
      const nextEpoch = auditTextPageCapacity(textPageCapacityEpoch, overflowing.length > 0, overflowRatio);
      textPageCapacityEpoch = nextEpoch;
      setTextPageCapacity(nextEpoch.capacity);
    });
  };

  const updateMeasuredTextPageCapacity = () => {
    const nextCapacity = estimateTextPageCapacity();
    if (!nextCapacity) return;
    setTextPageCapacity((previous) => {
      const capacity = Math.abs(previous - nextCapacity) > 24 ? nextCapacity : previous;
      textPageCapacityEpoch = resetTextPageCapacityEpoch(capacity);
      return capacity;
    });
    scheduleTextPageOverflowAudit();
  };

  createEffect(() => {
    if (!visiblePagesAreText()) return;
    pages();
    currentPage();
    queueMicrotask(scheduleTextPageOverflowAudit);
  });

  createEffect(() => {
    textSourcePages();
    fitMode();
    pageMode();
    readerBookVertical();
    settings.readerTextFontStyle;
    settings.readerContentFontSelections?.[sourceLanguage()];
    settings.readerTextSize;
    settings.readerTextLineHeight;
    settings.readerTextWidth;
    settings.readerTextMargin;
    currentLangData()?.typography;
    queueMicrotask(updateMeasuredTextPageCapacity);
  });

  createEffect(() => {
    const sources = textSourcePages();
    if (!sources) return;
    const capacity = textPageCapacity();
    const title = bookTitle();
    const previousCurrentPage = untrack(currentPage);
    const location = untrack(sourceLocation);
    const nextPages = paginateTextSources(sources, title, capacity);
    const nextCurrentPage = location ? pageForLocation(nextPages, location) : Math.min(previousCurrentPage, nextPages.length - 1);

    batch(() => {
      setPages(nextPages);
      setCurrentPage(nextCurrentPage);
    });
  });

  onMount(() => {
    const resizeObserver = new ResizeObserver(updateMeasuredTextPageCapacity);
    const attachObserver = () => {
      if (pageContainerRef) {
        resizeObserver.observe(pageContainerRef);
        updateMeasuredTextPageCapacity();
      } else {
        requestAnimationFrame(attachObserver);
      }
    };

    attachObserver();
    window.addEventListener('resize', updateMeasuredTextPageCapacity);

    onCleanup(() => {
      resizeObserver.disconnect();
      window.removeEventListener('resize', updateMeasuredTextPageCapacity);
      if (textPageOverflowAuditFrame !== undefined) cancelAnimationFrame(textPageOverflowAuditFrame);
    });
  });

  createEffect(on(currentBookId, () => {
    setOcrPageWords(reconcile({}));
    setPageTokenGroups(reconcile({}));
    setAddingSidebarWords(new Set<string>());
    setIsAddingAllSidebarWords(false);
  }));

  const handlePageTokenData = (pageId: string, entries: ReaderPageTokenData[]) => {
    const nextEntries: ReaderPageWordSource[] = [];

    for (const entry of entries) {
      const tokenOffsets = entry.sourceChunk ? locateSourceTokenOffsets(entry.contextPhrase, entry.tokens) : [];
      for (const [tokenIndex, token] of entry.tokens.entries()) {
        const word = getTokenLookupWord(token, tokenizerCapabilities());
        if (!word || !isTokenTranslatable(token)) {
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
          ...(entry.sourceChunk ? { sourcePosition: { ...entry.sourceChunk, tokenStart: tokenOffsets[tokenIndex] } } : {}),
          ...(entry.pageContentId ? { pageContentId: entry.pageContentId } : {}),
        });
      }
    }

    setOcrPageWords(pageId, nextEntries);
    setPageTokenGroups(pageId, entries);
  };

  const getAnchorRectForWord = (entry: ReaderPageWordSource): DOMRect | null => {
    const image = imageRefs()[entry.pageId];
    const result = ocrResults[entry.pageId];
    if (!image || !result || !entry.box) return null;

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

  const getSelectionRect = (selection: CropSelection) => {
    const left = Math.min(selection.startX, selection.currentX);
    const top = Math.min(selection.startY, selection.currentY);
    const width = Math.abs(selection.currentX - selection.startX);
    const height = Math.abs(selection.currentY - selection.startY);
    return { left, top, width, height };
  };

  const getCropSelectionStyle = (pageId: string) => {
    const selection = cropSelection();
    if (!selection || selection.pageId !== pageId) return {};
    const rect = getSelectionRect(selection);
    return {
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
    };
  };

  const getCropRegionStyle = (image: HTMLImageElement, region: CropRegion) => {
    const scaleX = image.clientWidth / Math.max(1, image.naturalWidth);
    const scaleY = image.clientHeight / Math.max(1, image.naturalHeight);
    return {
      left: `${region.rect.left * scaleX}px`,
      top: `${region.rect.top * scaleY}px`,
      width: `${region.rect.width * scaleX}px`,
      height: `${region.rect.height * scaleY}px`,
    };
  };

  const createCropBlob = async (
    image: HTMLImageElement,
    displayRect: { left: number; top: number; width: number; height: number },
  ): Promise<{ blob: Blob; naturalRect: { left: number; top: number; width: number; height: number } } | null> => {
    const displayWidth = image.clientWidth;
    const displayHeight = image.clientHeight;
    const naturalWidth = image.naturalWidth;
    const naturalHeight = image.naturalHeight;
    if (!displayWidth || !displayHeight || !naturalWidth || !naturalHeight) return null;

    const scaleX = naturalWidth / displayWidth;
    const scaleY = naturalHeight / displayHeight;
    const left = Math.max(0, Math.round(displayRect.left * scaleX));
    const top = Math.max(0, Math.round(displayRect.top * scaleY));
    const naturalRect = {
      left,
      top,
      width: Math.min(naturalWidth - left, Math.round(displayRect.width * scaleX)),
      height: Math.min(naturalHeight - top, Math.round(displayRect.height * scaleY)),
    };
    if (naturalRect.width < 4 || naturalRect.height < 4) return null;

    const canvas = document.createElement('canvas');
    canvas.width = naturalRect.width;
    canvas.height = naturalRect.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(
      image,
      naturalRect.left,
      naturalRect.top,
      naturalRect.width,
      naturalRect.height,
      0,
      0,
      naturalRect.width,
      naturalRect.height,
    );

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    return blob ? { blob, naturalRect } : null;
  };

  const remapCropResultToPage = (
    cropResult: OcrResult,
    image: HTMLImageElement,
    naturalRect: { left: number; top: number; width: number; height: number },
  ): OcrResult => {
    const sentWidth = cropResult.sent_size?.width || cropResult.original_size?.width || naturalRect.width;
    const sentHeight = cropResult.sent_size?.height || cropResult.original_size?.height || naturalRect.height;
    const scaleX = naturalRect.width / Math.max(1, sentWidth);
    const scaleY = naturalRect.height / Math.max(1, sentHeight);
    return {
      ...cropResult,
      boxes: cropResult.boxes.map((box) => ({
        ...box,
        box: box.box.map(([x, y]) => [
          naturalRect.left + x * scaleX,
          naturalRect.top + y * scaleY,
        ]),
      })),
      client_scale: 1,
      downscale_factor: 1,
      original_size: { width: image.naturalWidth, height: image.naturalHeight },
      sent_size: { width: image.naturalWidth, height: image.naturalHeight },
    };
  };

  const boxIntersectsRect = (box: OcrBox, rect: { left: number; top: number; width: number; height: number }) => {
    const xs = box.box.map(([x]) => x);
    const ys = box.box.map(([, y]) => y);
    const left = Math.min(...xs);
    const right = Math.max(...xs);
    const top = Math.min(...ys);
    const bottom = Math.max(...ys);
    return left < rect.left + rect.width && right > rect.left && top < rect.top + rect.height && bottom > rect.top;
  };

  const rectIntersectsRect = (
    first: { left: number; top: number; width: number; height: number },
    second: { left: number; top: number; width: number; height: number },
  ) => (
    first.left < second.left + second.width
    && first.left + first.width > second.left
    && first.top < second.top + second.height
    && first.top + first.height > second.top
  );

  const recognizeCrop = async (
    page: PageImage,
    displayRect: { left: number; top: number; width: number; height: number },
  ) => {
    const image = imageRefs()[page.id];
    if (!image || cropProcessingPageId()) return;

    const request = captureOcrRequest(page);
    const crop = await createCropBlob(image, displayRect);
    if (!crop || !request.isCurrent()) return;

    setCropProcessingPageId(page.id);
    setOcrStatus(t('mlearn.Reader.Status.Recognizing'));
    try {
      await showSettingRequirementWarningsOnce();
      if (!request.isCurrent()) return;
      const languageData = currentLangData();
      assertOcrLanguageDataReady(sourceLanguage(), languageData);

      let result: OcrResult;
      if (settings.ocrProvider === 'cloud') {
        const language = sourceLanguage();
        const engine = resolveCloudOcrEngine(languageData);
        const cloudApiUrl = resolveCloudApiUrl(settings);
        const cloudResult = await withCloudAuth(async (cloudToken) => {
          const adapter = new CloudOCRAdapter(cloudApiUrl, cloudToken);
          return adapter.recognize(crop.blob, language, engine, getOcrRuntimeConfig(languageData).paddleLang, true);
        });
        result = normalizeReaderOcrResult({ boxes: cloudResult.boxes });
      } else {
        result = normalizeReaderOcrResult(await sendImageForOCR(
          crop.blob,
          {
            language: sourceLanguage(),
            devMode: settings.devMode ? true : undefined,
            singleRegion: true,
            detectionScale: settings.devMode ? ocrDetectionScale() : undefined,
          },
        ));
      }

      if (!request.isCurrent()) return;
      const pageResult = remapCropResultToPage(result, image, crop.naturalRect);
      const existing = ocrResults[page.id];
      const retainedBoxes = existing?.boxes.filter((box) => !boxIntersectsRect(box, crop.naturalRect)) ?? [];
      request.write(page.id, {
        ...pageResult,
        boxes: [...retainedBoxes, ...pageResult.boxes],
      });
      setCroppedRegions((prev) => ({
        ...prev,
        [page.id]: [
          ...(prev[page.id] ?? []).filter((region) => !rectIntersectsRect(region.rect, crop.naturalRect)),
          {
            id: `${page.id}-${Date.now()}`,
            rect: crop.naturalRect,
          },
        ],
      }));
      setCropAddMode(false);
      if (pageResult.processing_times) {
        setLastOcrTiming(pageResult.processing_times);
      }
      setOcrCompletedIds((prev) => {
        const next = new Set(prev);
        next.add(page.id);
        return next;
      });
    } catch (error) {
      if (!request.isCurrent()) return;
      // Whether the learner stopped the sign-in themselves decides what the
      // reader shows next, so it comes from the one failure owner rather than
      // from a local `instanceof` that can drift from every other surface.
      if (classifyProviderFailure(error, settings.ocrProvider === 'cloud' ? 'cloud' : 'builtin').id === 'signInCancelled') {
        setCloudOcrAuthCancelled(true);
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      if (isReaderOcrReadinessErrorMessage(message)) {
        stopOcrForReadinessError(message);
      } else {
        log.error('Crop OCR error:', error);
      }
    } finally {
      setCropProcessingPageId(null);
      if (!readerDisposed) updateOverallStatus();
    }
  };

  const handleCropPointerDown = (page: PageImage, e: PointerEvent) => {
    if (!cropMode() || !cropAddMode() || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const target = e.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    const y = Math.max(0, Math.min(rect.height, e.clientY - rect.top));
    target.setPointerCapture(e.pointerId);
    setCropSelection({ pageId: page.id, startX: x, startY: y, currentX: x, currentY: y });
  };

  const handleCropPointerMove = (page: PageImage, e: PointerEvent) => {
    const selection = cropSelection();
    if (!cropMode() || !cropAddMode() || !selection || selection.pageId !== page.id) return;
    e.preventDefault();
    const target = e.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    const y = Math.max(0, Math.min(rect.height, e.clientY - rect.top));
    setCropSelection({ ...selection, currentX: x, currentY: y });
  };

  const handleCropPointerUp = (page: PageImage, e: PointerEvent) => {
    const selection = cropSelection();
    if (!cropMode() || !cropAddMode() || !selection || selection.pageId !== page.id) return;
    e.preventDefault();
    e.stopPropagation();
    const target = e.currentTarget as HTMLElement;
    if (target.hasPointerCapture(e.pointerId)) {
      target.releasePointerCapture(e.pointerId);
    }
    const displayRect = getSelectionRect(selection);
    setCropSelection(null);
    if (displayRect.width < 8 || displayRect.height < 8) return;
    void recognizeCrop(page, displayRect);
  };

  const visibleUnknownWords = createMemo<ReaderUnknownWordEntry[]>(() => {
    const deduped = new Map<string, ReaderUnknownWordEntry>();

    for (const page of visiblePages()) {
      const pageWords = ocrPageWords[page.id] || [];
      const pageContentId = page.kind === 'text' ? hashWordSync(page.text ?? '') : undefined;
      for (const entry of pageWords) {
        if (pageContentId !== undefined && entry.pageContentId !== pageContentId) continue;
        if (deduped.has(entry.word)) {
          continue;
        }

        if (flashcardCtx.isWordIgnoredSync(entry.word, sourceLanguage())) {
          continue;
        }

        if (flashcardCtx.isWordKnownWhenWrittenSync(entry.word, entry.token.surface ?? entry.token.word, sourceLanguage())) {
          continue;
        }

        if (!isWordInLanguageScript(entry.word, sourceLanguage(), langCtx.currentLangData())) {
          continue;
        }

        deduped.set(entry.word, entry);
      }
    }

    return Array.from(deduped.values());
  });

  const visiblePagesStillProcessing = () => visiblePages().some(page => {
    if (page.kind === 'text') return isTokenizingTextPages();
    return !ocrResults[page.id] && (
      processingTask()?.page.id === page.id ||
      ocrQueue().some(task => task.page.id === page.id)
    );
  });

  const capturedSuggestionWords = new Set<string>();
  createEffect(() => {
    if (!settings.autoSuggestFlashcards || !settings.enable_flashcard_creation) return;
    const unknown = visibleUnknownWords();
    const mediaHash = mediaStats.stats().mediaHash;
    const bookId = currentBookId();
    const captureLanguage = sourceLanguage();
    const captureData = currentLangData();
    const captureTarget = dictionaryTargetLanguage();
    const captureSource = props.scope.sourceKey();
    const captureGeneration = getTokenizerCacheNamespace(captureData);
    const captureIsCurrent = () => captureLanguage === sourceLanguage() && captureSource === props.scope.sourceKey()
      && captureGeneration === getTokenizerCacheNamespace(currentLangData());

    void (async () => {
      // A suggestion's image belongs to ONE word occurrence, so there is no
      // page-scoped cache here any more. Two words on the same page each get
      // their own crop around their own OCR box. Sharing one page image made
      // every suggested card show the same whole page, which identifies
      // nothing about the word the card is for.
      // Current-content passive exposures per word (R21): recorded coverage
      // recurrence, used by BOTH the suggestion filter and capture so a
      // repeatedly-blocking off-list term survives the level gate (the same
      // MEDIA_MIN_ENCOUNTERS one-off rule the policy's media-fit source
      // uses). Look-ups (timesHovered) are never counted.
      const mediaRecurrence = new Map<string, number>();
      for (const entry of Object.values(mediaStats.stats().wordsEncountered)) {
        mediaRecurrence.set(entry.word, (mediaRecurrence.get(entry.word) ?? 0) + entry.timesSeen);
      }
      const allowedWords = await filterSuggestedWords(
        unknown.map(entry => entry.word),
        captureLanguage,
        settings,
        captureData,
        { getWordForms, dictionaryTargetLanguage: captureTarget },
        { mediaRecurrence },
      );
      if (!captureIsCurrent()) return;
      for (const entry of unknown) {
        if (capturedSuggestionWords.has(entry.word)) continue;
        const freq = langCtx.getFrequency(entry.word);
        if (!allowedWords.has(entry.word)) continue;
        capturedSuggestionWords.add(entry.word);
        const pageImage = imageRefs()[entry.pageId];
        const anchorRect = getAnchorRectForWord(entry) ?? undefined;
        // No reliable occurrence geometry means no image. The suggestion is
        // still recorded with its text and context; it simply carries no
        // media rather than a misleading page picture.
        const image = pageImage && anchorRect
          ? await captureReaderImageForOccurrence(pageImage, anchorRect, { cropPadding: settings.ocr_crop_padding })
          : null;
        if (!captureIsCurrent()) return;
        void flashcardCtx.captureSuggestedFlashcard({
          language: captureLanguage,
          word: entry.word,
          reading: freq?.reading,
          pos: entry.token.type,
          level: freq?.raw_level ?? null,
          dictionaryTargetLanguage: captureTarget,
          contextPhrase: cleanContextPhrase(entry.contextPhrase, captureData),
          imageUrl: image || undefined,
          source: bookId || undefined,
          sourceMediaHash: mediaHash || undefined,
          mediaRecurrence: mediaRecurrence.get(entry.word),
        });
      }
    })();
  });
  createEffect(on(currentBookId, () => {
    capturedSuggestionWords.clear();
  }));

  const failedSidebarWordSet = createMemo<Set<string>>(() => {
    const failedWords = new Set<string>();

    for (const entry of Object.values(mediaStats.stats().wordsEncountered)) {
      if (isWordMarkedFailed(entry, settings)) {
        failedWords.add(entry.word);
      }
    }

    return failedWords;
  });

  const addReaderWordFlashcard = async (entry: ReaderPageWordSource) => {
    const admittedLanguage = sourceLanguage();
    const admittedData = currentLangData();
    const admittedTarget = dictionaryTargetLanguage();
    const admittedFrequency = langCtx.getFrequency(entry.word);
    const admittedStatus = flashcardCtx.getComprehensiveWordStatusSync(entry.word, admittedLanguage);
    const image = imageRefs()[entry.pageId] || null;
    const anchorRect = getAnchorRectForWord(entry);
    const admittedTokenizer = useTokenizer({ language: admittedLanguage, languageData: admittedData }).tokenize;
    setAddingSidebarWords((prev) => {
      const next = new Set(prev);
      next.add(entry.key);
      return next;
    });

    try {
      const translationData = getCachedTranslation(entry.word, admittedLanguage, wordLookupOptions)
        ?? await fetchTranslation(entry.word, admittedLanguage, { ...wordLookupOptions, languageData: admittedData, dictionaryTargetLanguage: admittedTarget });

      const { content, ease } = await buildWordHoverFlashcardContent({
        token: entry.token,
        word: entry.word,
        translationData: translationData || undefined,
        contextPhrase: entry.contextPhrase,
        isOcr: true,
        ocrImageElement: image,
        anchorRect: anchorRect || undefined,
        level: admittedFrequency?.raw_level,
        wordStatus: admittedStatus,
        colourCodes: settings.colour_codes || {},
        languageData: admittedData,
        ocrCropPadding: settings.ocr_crop_padding,
        tokenize: admittedTokenizer,
        srsLearningEase: settings.srsLearningThreshold / 1000,
        srsKnownEase: settings.known_ease_threshold / 1000,
      });
      await flashcardCtx.addFlashcard(content, ease, undefined, admittedLanguage);
    } finally {
      setAddingSidebarWords((prev) => {
        const next = new Set(prev);
        next.delete(entry.key);
        return next;
      });
    }
  };

  /**
   * Whether a captured word may still become a card.
   *
   * The rule itself belongs to `wordCaptureEligibility`; this only supplies
   * the reader's facts. The reader used to restate the rule here, which is how
   * the video and overlay sidebars came to disagree about the same word.
   */
  const isReaderCaptureEligible = (entry: ReaderUnknownWordEntry): boolean =>
    resolveCapturedWordEligibility(
      entry.word,
      sourceLanguage(),
      Boolean(flashcardCtx.getCardByWordSync(entry.word, sourceLanguage())),
      flashcardCtx.getComprehensiveWordStatusWithSourceSync(entry.word, sourceLanguage()).excluded === true,
    ).eligible;

  /**
   * A single sidebar capture, reporting its own failure.
   *
   * The reader already let a rejection propagate, but nothing caught it, so a
   * failed capture reached the click handler and stopped there: the row left
   * its in-flight state and the learner saw nothing. The sibling video
   * sidebars swallowed the same failure instead, which additionally made their
   * batch error branch unreachable.
   */
  const handleAddSidebarWord = async (entry: ReaderUnknownWordEntry) => {
    if (addingSidebarWords().has(entry.key) || !isReaderCaptureEligible(entry)) {
      return;
    }
    try {
      await addReaderWordFlashcard(entry);
    } catch (err) {
      reportCaptureFailure(err, { word: entry.word }, { translate: t, log: log.error });
    }
  };

  /**
   * "Add All" for the reader's unknown words.
   *
   * The behaviour itself - refusing to re-enter, re-checking eligibility per
   * entry, keeping going past a failure, and reporting the run as one batch -
   * is owned by `addAllCapturedWords`, because the video route and the
   * floating overlay are the same sidebar offering the same button and had
   * already drifted from this copy. The reader supplies what it knows: how to
   * build one card, whether that word may still become one, and its logger.
   */
  const handleAddAllSidebarWords = (entries: ReaderUnknownWordEntry[]) =>
    addAllCapturedWords({
      entries,
      addFlashcard: addReaderWordFlashcard,
      isEligible: isReaderCaptureEligible,
      isInFlight: isAddingAllSidebarWords,
      setInFlight: setIsAddingAllSidebarWords,
      translate: t,
      logEntryError: (entry, err) => log.error(`Failed to add flashcard for "${entry.word}":`, err),
    });


  const handleIgnoreSidebarWord = async (entry: ReaderUnknownWordEntry) => {
    await excludeWordFromStudy(
      { word: entry.word, reading: entry.token.reading, language: sourceLanguage() },
      {
        ignoreWordForLanguage: flashcardCtx.ignoreWordForLanguage,
        t,
      },
    );
  };

  const currentOcrReadinessError = () => getOcrLanguageDataReadinessError(sourceLanguage(), currentLangData());

  const currentOcrAutomationState = () => resolveReaderOcrAutomationState({
    ocrEnabled: Boolean(ocrEnabled()) && !cropMode(),
    languageDataLoading: langCtx.isLoading(),
    readinessError: currentOcrReadinessError(),
    authRecoveryCancelled: settings.ocrProvider === 'cloud' && cloudOcrAuthCancelled()
      ? { message: t('mlearn.CloudReLogin.SessionExpired') }
      : undefined,
  });

  const stopOcrForReadinessError = (readinessError: string): void => {
    setOcrQueue([]);
    setOcrStatus(readinessError);
    if (lastOcrReadinessWarning !== readinessError) {
      lastOcrReadinessWarning = readinessError;
      log.warn('OCR unavailable:', readinessError);
    }
  };

  // Automatic OCR + cache next pages
  createEffect(() => {
    const allPages = pages();
    if (allPages.length === 0) return;
    const automationState = currentOcrAutomationState();
    if (readerOcrShouldClearStatus(automationState)) {
      setOcrQueue([]);
      updateOverallStatus();
      return;
    }

    if (automationState.kind === 'blocked') {
      stopOcrForReadinessError(automationState.message);
      return;
    }

    if (!readerOcrCanQueue(automationState)) {
      return;
    }
    lastOcrReadinessWarning = '';

    const base = currentPage();
    const isDouble = pageMode() === 'double';

    const visibleIndices = visiblePageIndices();

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
      if (page && page.kind === 'image' && !ocrResults[page.id] && page.id !== currentlyProcessingId) {
        tasks.push({ page, isCaching: false });
      }
    }

    // Caching pages (lower priority)
    for (const idx of cacheIndices) {
      const page = allPages[idx];
      // Skip if already cached, or currently being processed
      if (page && page.kind === 'image' && !ocrResults[page.id] && page.id !== currentlyProcessingId) {
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
    if (readerDisposed || processingTask()) return; // Already working

    const automationState = currentOcrAutomationState();
    if (readerOcrShouldClearStatus(automationState)) {
      setOcrQueue([]);
      updateOverallStatus();
      return;
    }

    if (automationState.kind === 'blocked') {
      stopOcrForReadinessError(automationState.message);
      return;
    }

    if (!readerOcrCanQueue(automationState)) {
      return;
    }

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

    const request = captureOcrRequest(task.page);
    let result: OcrResult | null = null;
    try {
      result = await performOcr(task.page);
    } finally {
      if (request.isCurrent()) {
        setServerOcrProgress(null);
        setServerOcrMessage('');
        const pageId = task.page.id;
        if (result && !ocrCompletedIds().has(pageId)) {
          setOcrCompletedIds(prev => new Set([...prev, pageId]));
        }
      }
      setProcessingTask(null);
      if (!readerDisposed) void processQueue();
    }
  };

  const showSettingRequirementWarningsOnce = async () => {
    if (settingRequirementWarningsChecked) {
      return;
    }

    settingRequirementWarningsChecked = true;

    try {
      const warnings = await getUnseenSettingRequirementWarnings(settings, 'reader');
      for (const warning of warnings) {
        markSettingRequirementWarningSeen('reader', warning.config.id);
        showToast({
          variant: 'warning',
          title: t(warning.config.titleKey),
          message: t(warning.config.messageKey, getSettingRequirementWarningParams(warning)),
          duration: 9000,
        });
      }
    } catch (error) {
      log.warn('[Reader] Failed to show setting requirement warning', error);
    }
  };

  const performOcr = async (page: PageImage) => {
    if (page.kind !== 'image') return null;
    const request = captureOcrRequest(page);
    // Reset server progress at start of each page
    setServerOcrProgress(null);
    setServerOcrMessage('');

    // Silent background process - only update status bar text
    // Note: status bar text is handled by updateOverallStatus based on processingTask

    try {
      await showSettingRequirementWarningsOnce();
      if (!request.isCurrent()) return null;

      const languageData = currentLangData();
      const automationState = currentOcrAutomationState();
      if (readerOcrShouldClearStatus(automationState)) {
        setOcrQueue([]);
        updateOverallStatus();
        return null;
      }
      if (automationState.kind === 'blocked') {
        stopOcrForReadinessError(automationState.message);
        return null;
      }
      if (!readerOcrCanQueue(automationState)) {
        return null;
      }

      let imageBlob = page.blob;
      if (!imageBlob) {
        if (!page.src) {
          throw new Error(`Image page "${page.name}" has no OCR source`);
        }
        imageBlob = await (await fetch(page.src)).blob();
      }
      if (!request.isCurrent()) return null;
      assertOcrLanguageDataReady(sourceLanguage(), languageData);

      let result: OcrResult;

      if (settings.ocrProvider === 'cloud') {
        const prepared = await prepareBlobForOCR(imageBlob);
        // Cloud OCR via HATEOAS job flow
        const language = sourceLanguage();
        const engine = resolveCloudOcrEngine(languageData);
        const cloudApiUrl = resolveCloudApiUrl(settings);
        const cloudResult = await withCloudAuth(async (cloudToken) => {
          const adapter = new CloudOCRAdapter(cloudApiUrl, cloudToken);
          return adapter.recognize(prepared.blob, language, engine, getOcrRuntimeConfig(languageData).paddleLang);
        });

        result = normalizeReaderOcrResult({
          boxes: cloudResult.boxes,
        });
        result.client_scale = prepared.clientScale;
        result.downscale_factor = prepared.clientScale > 0 ? 1 / prepared.clientScale : 1;
        result.original_size = { width: prepared.originalW, height: prepared.originalH };
        result.sent_size = { width: prepared.sentW, height: prepared.sentH };
      } else {
        result = normalizeReaderOcrResult(await sendImageForOCR(
          imageBlob,
          {
            language: sourceLanguage(),
            devMode: settings.devMode ? true : undefined,
            detectionScale: settings.devMode ? ocrDetectionScale() : undefined,
          },
        ));
      }

      if (!request.isCurrent()) return null;
      request.write(page.id, result);
      setCroppedRegions((prev) => {
        if (!prev[page.id]) return prev;
        const next = { ...prev };
        delete next[page.id];
        return next;
      });
      if (result.processing_times) {
        setLastOcrTiming(result.processing_times);
      }
      return result;
    } catch (error) {
      if (!request.isCurrent()) return null;
      if (classifyProviderFailure(error, settings.ocrProvider === 'cloud' ? 'cloud' : 'builtin').id === 'signInCancelled') {
        setCloudOcrAuthCancelled(true);
        return null;
      }
      const message = error instanceof Error ? error.message : String(error);
      if (isReaderOcrReadinessErrorMessage(message)) {
        stopOcrForReadinessError(message);
        return null;
      }
      log.error('OCR error:', error);
      // We don't set error status globally to avoid flashing errors for background tasks
      return null;
    }
  };

  const updateOverallStatus = () => {
    const automationState = currentOcrAutomationState();
    if (readerOcrShouldClearStatus(automationState)) {
      setOcrStatus('');
      setOcrProgress(0);
      return;
    }
    if (automationState.kind === 'blocked') {
      setOcrStatus(automationState.message);
      return;
    }

    const currentTask = processingTask();
    const queue = ocrQueue();
    const visible = visiblePages();
    const visibleIndices = visiblePageIndices();
    const isDouble = pageMode() === 'double';

    const visibleStart = visibleIndices[0] ?? currentPage();
    const visibleEnd = visibleIndices[visibleIndices.length - 1] ?? currentPage();

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
    const allVisibleDone = visible.every(p => p.kind === 'text' || ocrResults[p.id]);
    if (allVisibleDone) {
      setOcrStatus(t('mlearn.Reader.Status.Ready'));
    } else {
      // Visible pages don't have OCR yet but nothing is processing - show waiting
      setOcrStatus(t('mlearn.Reader.Status.LoadingNeuralNetwork'));
    }
  };

  // Helper for manual run (force) - kept for potential future use
  const requestOcrForPage = (page: PageImage) => {
    const automationState = currentOcrAutomationState();
    if (automationState.kind === 'blocked') {
      stopOcrForReadinessError(automationState.message);
      return;
    }
    if (!readerOcrCanQueue(automationState)) {
      return;
    }

    // Add to front of queue if not there?
    // Actually manual run usually implies "do it now".
    // We can just add to queue and trigger.
    setOcrQueue(prev => [{ page, isCaching: false }, ...prev.filter(p => p.page.id !== page.id)]);
    processQueue();
  };
  // Prevent "unused" warnings - used for manual page OCR triggering
  void requestOcrForPage;

  const runOcr = async () => {
    const automationState = currentOcrAutomationState();
    if (automationState.kind === 'blocked') {
      stopOcrForReadinessError(automationState.message);
      return;
    }
    if (!readerOcrCanQueue(automationState)) {
      return;
    }

    const visible = visiblePages();
    // Prioritize visible pages in queue
    setOcrQueue(prev => {
      const visibleIds = visible.map(v => v.id);
      const others = prev.filter(p => !visibleIds.includes(p.page.id));
      const visibleTasks: OcrTask[] = visible.filter(p => p.kind === 'image').map(p => ({ page: p, isCaching: false }));
      return [...visibleTasks, ...others];
    });
    processQueue();
  };

  let readerLoadRevision = 0;
  const commitLoadedPages = (
    newPages: PageImage[],
    options: {
      bookId: string;
      title: string;
      path: string;
      preparedSource?: PreparedMediaSource;
      format: 'images' | 'pdf' | 'epub';
      startPage: number;
      sourceLocation?: ReaderSourceLocation | null;
      resumed?: boolean;
      coverBlob?: Blob;
      file?: File | null;
      textSourcePages?: ReaderSourcePage[] | null;
      progressionDirection?: BookProgressionDirection;
      declaresVertical?: boolean;
      epubBlobUrls?: string[];
      displayTitle?: string;
    },
  ) => {
    if (options.preparedSource && !props.scope.isCurrent(options.preparedSource)) {
      for (const url of new Set([...(options.epubBlobUrls ?? []), ...newPages.map(page => page.src).filter((src): src is string => typeof src === 'string' && src.startsWith('blob:'))])) URL.revokeObjectURL(url);
      return false;
    }
    // invariant: URLs are created fresh per load into a LOCAL array and handed to commitLoadedPages; the previous generation is revoked only as its replacement is adopted — no live page ever references a dead URL.
    adoptEpubBlobUrls(options.epubBlobUrls ?? []);
    const imagePageCount = newPages.filter((page) => page.kind === 'image').length;
    batch(() => {
      if (options.preparedSource) props.scope.adopt(options.preparedSource);
      ocrState.reset();
      setCroppedRegions({});
      setTextSourcePages(options.textSourcePages ?? null);
      setCurrentPage(options.startPage);
      setSourceLocation(options.sourceLocation ?? null);
      setResumedWithoutReading(options.format === 'epub' && options.resumed === true);
      setPages(newPages);
      setOcrBatchTotal(imagePageCount);
      setOcrCompletedIds(new Set<string>());
      setBookTitle(options.title);
      setBookDisplayTitle(options.displayTitle ?? options.title);
      setCurrentBookId(options.bookId);
      setCurrentBookPath(options.path);
      setCurrentBookFormat(options.format);
      setCurrentBookFile(options.file ?? null);
      // Per-book signals must never bleed across loads.
      setBookProgressionDirection(options.progressionDirection ?? null);
      setBookDeclaresVertical(options.declaresVertical ?? false);
    });
    return true;
  };

  const loadPdfFileIntoReader = async (file: File, path: string = '', documentOcrOverride?: boolean, admittedLoad = ++readerLoadRevision) => {
    const preparedSource = await props.scope.prepare({ kind: 'book', resourceId: await mediaFileResourceId(path, [file]) });
    if (!preparedSource || admittedLoad !== readerLoadRevision) return;
    setOcrStatus(t('mlearn.Reader.Status.LoadingPdf'));
    const bookId = parseCurrentWorkName(file.name);
    const useOcr = documentOcrOverride ?? settings.readerDocumentOcr ?? DEFAULT_SETTINGS.readerDocumentOcr ?? false;
    const title = bookId || t('mlearn.Reader.Status.PdfDocument');
    const savedPageIndex = await loadSavedPageIndex(bookId);
    let newPages: PageImage[];
    let documentTitle: string | undefined;
    let coverBlob: Blob | undefined;
    let textSourcePagesForBook: ReaderSourcePage[] | null = null;

    if (useOcr) {
      const pdfImages = await pdfToImages(file);
      newPages = imagePagesFromPdfImages(pdfImages);
      documentTitle = pdfImages[0]?.documentTitle;
      coverBlob = newPages[0]?.blob;
    } else {
      const textPages = await pdfToTextPages(file);
      documentTitle = textPages[0]?.documentTitle;
      if (textPages.length === 0) {
        const pdfImages = await pdfToImages(file);
        newPages = imagePagesFromPdfImages(pdfImages);
        documentTitle = pdfImages[0]?.documentTitle;
        coverBlob = newPages[0]?.blob;
      } else {
        textSourcePagesForBook = textPages;
        newPages = paginateTextSources(textPages, title, textPageCapacity());
      }
    }

    const startPage = savedPageIndex !== null && savedPageIndex >= 0 && savedPageIndex < newPages.length
      ? savedPageIndex
      : 0;
    if (admittedLoad !== readerLoadRevision) return;
    if (!commitLoadedPages(newPages, {
      bookId,
      title,
      preparedSource,
      displayTitle: readerBookDisplayTitle(documentTitle, file.name, langCtx.supportedLanguages()),
      path,
      format: 'pdf',
      startPage,
      coverBlob,
      file,
      textSourcePages: textSourcePagesForBook,
    })) return;
    if (path) {
      void persistActiveBookPath(path);
    }
    saveToRecent(title, 'book', startPage, path, coverBlob);
    setOcrStatus(t('mlearn.Reader.Status.Ready'));
  };

  const loadEpubFileIntoReader = async (file: File, path: string = '', requestedLocation?: ReaderSourceLocation, admittedLoad = ++readerLoadRevision) => {
    const resourceId = await mediaFileResourceId(path, [file]);
    let preparedSource = await props.scope.prepare({ kind: 'book', resourceId });
    if (!preparedSource || admittedLoad !== readerLoadRevision) return;
    const epubT0 = performance.now();
    setOcrStatus(t('mlearn.Reader.Status.LoadingBook'));
    const bookId = parseCurrentWorkName(file.name);
    const title = bookId || t('mlearn.Reader.Status.EpubDocument');
    const content = await epubToContentPages(file);
    if (admittedLoad !== readerLoadRevision) return;
    if (content.authoredLanguages?.length) preparedSource = await props.scope.prepare({ kind: 'book', resourceId }, content.authoredLanguages);
    if (!preparedSource || admittedLoad !== readerLoadRevision) return;
    perfCount('reader.loadEpub.parse.ms', performance.now() - epubT0);
    const prepared = await prepareEpubReaderLoad(content, title, textPageCapacity(), () => loadSavedReaderLocation(bookId), requestedLocation);
    if (admittedLoad !== readerLoadRevision) return;
    if (!commitLoadedPages(prepared.pages, {
      bookId,
      title,
      preparedSource,
      displayTitle: readerBookDisplayTitle(content.metadataTitle, file.name, langCtx.supportedLanguages()),
      path,
      format: 'epub',
      startPage: prepared.startPage,
      sourceLocation: prepared.startLocation,
      resumed: prepared.resumed,
      file,
      textSourcePages: prepared.sources,
      progressionDirection: content.progressionDirection,
      declaresVertical: content.declaresVerticalWriting,
      epubBlobUrls: prepared.newBlobUrls,
    })) return;
    if (path) {
      void persistActiveBookPath(path);
    }
    persistSourceLocation(bookId, prepared.startLocation);
    saveToRecent(title, 'book', prepared.startPage, path, prepared.coverBlob);
    setOcrStatus(t('mlearn.Reader.Status.Ready'));
    perfCount('reader.loadEpub.ms.total', performance.now() - epubT0);
  };

  // Load book from filesystem path (for recent items)
  const loadBookFromPath = async (bookPath: string, documentOcrOverride?: boolean, requestedLocation?: ReaderSourceLocation) => {
    const admittedLoad = ++readerLoadRevision;
    const preparedSource = await props.scope.prepare({ kind: 'book', resourceId: bookPath });
    if (!preparedSource || admittedLoad !== readerLoadRevision) return;
    const loadT0 = performance.now();
    setBookLoadError(null);
    setOcrStatus(t('mlearn.Reader.Status.Loading'));

    try {
      // Check if it's a document file or a directory
      const isPdf = /\.pdf$/i.test(bookPath);
      const isEpub = /\.epub$/i.test(bookPath);

      if (isPdf) {
        const result = await getBridge().files.readPdfFile(bookPath);
        const blob = new Blob([result.data], { type: 'application/pdf' });
        const fileName = bookPath.split('/').pop() || 'document.pdf';
        const file = new File([blob], fileName, { type: 'application/pdf' });
        if (admittedLoad !== readerLoadRevision) return;
        await loadPdfFileIntoReader(file, bookPath, documentOcrOverride, admittedLoad);
      } else if (isEpub) {
        const readT0 = performance.now();
        const data = await getBridge().files.readMediaFile(bookPath);
        perfCount('reader.readMediaFile.ms', performance.now() - readT0);
        if (!data) throw new Error('Failed to read EPUB file');
        const fileName = bookPath.split('/').pop() || 'book.epub';
        const file = new File([new Blob([data])], fileName, { type: 'application/epub+zip' });
        if (admittedLoad !== readerLoadRevision) return;
        await loadEpubFileIntoReader(file, bookPath, requestedLocation, admittedLoad);
      } else {
        // Load directory of images
        const result = await getBridge().files.readDirectoryImages(bookPath);

        if (result.files.length === 0) {
          void clearActiveBookPath();
          setBookLoadError('no-images');
          setOcrStatus(t('mlearn.Reader.Status.NoImagesFound'));
          return;
        }

        // For folders: use folder name only (stripped)
        const folderName = bookPath.split('/').filter(Boolean).pop() || '';
        const bookId = parseCurrentWorkName(folderName);

        const savedPageIndex = await loadSavedPageIndex(bookId);
        const startPage = savedPageIndex !== null && savedPageIndex >= 0 && savedPageIndex < result.files.length
            ? savedPageIndex : 0;

        const newPages: PageImage[] = result.files.map((file, index) => {
          const blob = new Blob([file.data]);
          return {
            id: `page-${index}-${file.name}`,
            kind: 'image',
            src: URL.createObjectURL(blob),
            name: file.name,
            index,
            blob,
          };
        });

        const title = bookId || t('mlearn.Reader.Status.ImportedBook');
        if (admittedLoad !== readerLoadRevision) return;
        if (!commitLoadedPages(newPages, {
          preparedSource,
          bookId,
          title,
          displayTitle: readerBookDisplayTitle(undefined, folderName, langCtx.supportedLanguages()) || title,
          path: bookPath,
          format: 'images',
          startPage,
          coverBlob: newPages[0]?.blob,
        })) return;

        // Save to recent with the correct path
        saveToRecent(title, 'book', startPage, bookPath, newPages[0]?.blob);
      }

      if (admittedLoad !== readerLoadRevision) return;
      void persistActiveBookPath(bookPath);
      perfCount('reader.loadBookFromPath.ms', performance.now() - loadT0);
      setOcrStatus(t('mlearn.Reader.Status.Ready'));
    } catch (error) {
      log.error('[Reader] Failed to load from path:', error);
      void clearActiveBookPath();
      setBookLoadError('open-failed');
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
      const bookId = parseCurrentWorkName(folderName);
      const preparedSource = await props.scope.prepare({ kind: 'book', resourceId: await mediaFileResourceId('', files) });
      if (!preparedSource) return;

      const savedPageIndex = await loadSavedPageIndex(bookId);
      const startPage = savedPageIndex !== null && savedPageIndex >= 0 && savedPageIndex < files.length ? savedPageIndex : 0;

      const newPages: PageImage[] = files.map((file, index) => ({
        id: `page-${index}-${file.name}`,
        kind: 'image',
        src: URL.createObjectURL(file),
        name: file.name,
        index,
        blob: file,
      }));

      const title = bookId || t('mlearn.Reader.Status.ImportedBook');
      if (!commitLoadedPages(newPages, { bookId, title, path: '', format: 'images', startPage, preparedSource,
        displayTitle: readerBookDisplayTitle(undefined, folderName, langCtx.supportedLanguages()) || title })) return;
      setOcrStatus(t('mlearn.Reader.Status.Ready'));
    };
    input.click();
  };

  const handleOpenBookFile = async () => {
    if (isElectron()) {
      const bridge = getBridge();
      const path = await bridge.files.selectPdfFile();
      if (path) loadBookFromPath(path);
      return;
    }

    // Mobile: use file input to get the document File directly.
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.pdf,.epub,application/pdf,application/epub+zip';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;

      try {
        if (isEpubFile(file)) {
          await loadEpubFileIntoReader(file);
        } else {
          await loadPdfFileIntoReader(file);
        }
      } catch (error) {
        log.error('[Reader] Failed to load book file:', error);
        setOcrStatus(t('mlearn.Reader.Status.FailedToLoadPdf'));
      }
    };
    input.click();
  };

  // Check for pending book on mount
  onMount(() => {
    const syncWindowFocus = () => {
      setIsWindowFocused(document.hasFocus())
      setIsWindowVisible(document.visibilityState === 'visible')
    }

    window.addEventListener('focus', syncWindowFocus)
    window.addEventListener('blur', syncWindowFocus)
    document.addEventListener('visibilitychange', syncWindowFocus)
    onCleanup(() => {
      window.removeEventListener('focus', syncWindowFocus)
      window.removeEventListener('blur', syncWindowFocus)
      document.removeEventListener('visibilitychange', syncWindowFocus)
    })

    const pendingBook = sessionStorage.getItem('mlearn_open_book');
    if (pendingBook) {
      sessionStorage.removeItem('mlearn_open_book');
      const source = consumeMediaWorkspaceReturn(sessionStorage, 'reader', pendingBook);
      const location = source ? parseSavedReaderLocation(JSON.stringify(source.location) ?? null) : null;
      const requestedLocation = location && typeof location !== 'number' ? location : undefined;
      void loadBookFromPath(pendingBook, undefined, requestedLocation).then(() => {
        if (currentBookPath() !== pendingBook || !source) return;
        // Text anchors enter the loader directly and survive repagination.
        // Page navigation would replace them with the new page's first chunk.
        if (currentBookFormat() === 'epub' && requestedLocation) return;
        const page = requestedLocation ? pageForLocation(pages(), requestedLocation) : source.page;
        if (typeof page === 'number' && Number.isInteger(page) && page >= 0) goToPage(page);
      });
    } else {
      void loadActiveBookPath().then((activeBookPath) => {
        if (activeBookPath && pages().length === 0) {
          void loadBookFromPath(activeBookPath);
        }
      });
    }

  });

  createEffect(on(
    () => [settings.ocrEnabled, sourceLanguage(), langCtx.isLoading(), currentLangData()] as const,
    ([ocrEnabledSetting, language, languageLoading, languageData]) => {
      // Trigger lazy warmup of OCR transformers only after the learning
      // language package metadata has loaded. Blank/missing metadata would use
      // generic OCR defaults and hide missing package installs.
      if ((ocrEnabledSetting ?? DEFAULT_SETTINGS.ocrEnabled) && language && !languageLoading && languageData) {
        getBackend().warmupOcr(language).catch(() => {/* non-fatal */});
      }
    },
    { defer: true },
  ));

  const canToggleReadingHider = () => getLanguageFeatures().supportsReadings;
  const readingAnnotationHiderEnabled = () => canToggleReadingHider() && readerReadingAnnotationHiderEnabled(settings);

  // Listen to reader context menu commands
  onMount(() => {
    const bridge = getBridge();

    const cleanup = bridge.window.onReaderContextMenuCommand((command: string) => {
      switch (command) {
        case 'toggle-reading-annotation-hider':
          if (!canToggleReadingHider()) break;
          {
            const enabled = !readingAnnotationHiderEnabled();
            updateSettings({
              readerReadingAnnotationHider: enabled,
            });
          }
          break;
        case 'copy-phrase': {
          // Copy the current context phrase to clipboard
          const phrase = ocrContextPhrase();
          if (phrase) {
            bridge.files.writeToClipboard(phrase);
          }
          break;
        }
        case 'explain-phrase':
          if (!requireCapability('llm', settings, t)) break;

          if (ocrContextPhrase()) {
            handleOpenPhraseExplainer(ocrContextPhrase(), ocrContextMenuPosition());
          }
          break;
        case 'toggle-collate-pages':
          updateSettings({ readerCollatePages: !collatePages() });
          break;
      }
    });
    onCleanup(cleanup);
  });

  // Handler for right-click context menu in reader on OCR boxes (has phrase to copy)
  const handleOcrContextMenu = (contextPhrase: string, _boxIndex: number, position: { x: number; y: number }) => {
    const cleanedPhrase = cleanContextPhrase(contextPhrase, langCtx.currentLangData());
    const hasContextPhrase = !!cleanedPhrase && cleanedPhrase !== '-';

    // Store the context phrase for copy functionality
    setOcrContextPhrase(cleanedPhrase);
    setOcrContextMenuPosition(position);

    getBridge().window.showReaderCtxMenu({
      readingAnnotationHiderEnabled: readingAnnotationHiderEnabled(),
      canToggleReadingHider: canToggleReadingHider(),
      hasContextPhrase,
      canExplainPhrase: isLLMReady(settings) && hasContextPhrase,
      collatePagesEnabled: collatePages(),
      isDoublePageMode: pageMode() === 'double',
    });
  };

  // Handler for right-click context menu on image (no OCR box selected)
  // Shows limited menu with only the reading annotation hider toggle
  const handleImageContextMenu = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    // Clear context phrase since we're not on an OCR box
    setOcrContextPhrase('');
    setOcrContextMenuPosition({ x: e.clientX + 16, y: e.clientY + 16 });

    getBridge().window.showReaderCtxMenu({
      readingAnnotationHiderEnabled: readingAnnotationHiderEnabled(),
      canToggleReadingHider: canToggleReadingHider(),
      hasContextPhrase: false, // No phrase to copy when clicking on image
      canExplainPhrase: false,
      collatePagesEnabled: collatePages(),
      isDoublePageMode: pageMode() === 'double',
    });
  };

  // Listen to server-side OCR status updates
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
    const location = sourceLocation();
    const sources = textSourcePages();
    const progress = location && sources ? progressForLocation(sources, location) : getRecentProgressPercent(page + 1, currentPages.length);
    const path = currentBookPath();
    if (title && currentPages.length > 0 && currentPages[0]?.blob) {
      captureBlobThumbnail(currentPages[0].blob!).then((thumbnail) => {
        if (thumbnail) {
          void saveToRecentItems({ type: 'book', name: title, path, progress }, thumbnail);
        }
      });
    }
  });

  const handleDrop = async (e: DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const { files: droppedFiles, droppedFolderName, droppedFolderPath, rawFilePaths } = await getDroppedFiles(e.dataTransfer || null);

    // Check for document files first
    const epubFile = droppedFiles.find(f => isEpubFile(f));
    const pdfFile = droppedFiles.find(f => isPdfFile(f));

    if (epubFile) {
      try {
        const epubPath = rawFilePaths.get(epubFile.name)
            || getFilePath(epubFile)
            || droppedFolderPath
            || '';
        await loadEpubFileIntoReader(epubFile, epubPath);
        return;
      } catch (error) {
        log.error('Failed to load EPUB:', error);
        setOcrStatus(t('mlearn.Reader.Status.FailedToLoad'));
        return;
      }
    }

    if (pdfFile) {
      try {
        const pdfPath = rawFilePaths.get(pdfFile.name)
            || getFilePath(pdfFile)
            || droppedFolderPath
            || '';
        await loadPdfFileIntoReader(pdfFile, pdfPath);
        return;
      } catch (error) {
        log.error('Failed to load PDF:', error);
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
      bookId = parseCurrentWorkName(droppedFolderName);
    } else {
      // Fallback: extract from first file's path using rawFilePaths map
      const firstFilePath = rawFilePaths.get(files[0].name) || getFilePath(files[0]);
      const rawFolderName = firstFilePath
          ? extractFolderName(firstFilePath)
          : files[0].name;
      bookId = parseCurrentWorkName(rawFolderName);
    }

    // Use droppedFolderPath or extract from first file's path
    // rawFilePaths is populated using webUtils.getPathForFile (Electron 32+)
    const firstFilePath = rawFilePaths.get(files[0].name) || getFilePath(files[0]);
    const bookPath = droppedFolderPath || (firstFilePath
        ? firstFilePath.split('/').slice(0, -1).join('/')
        : '');
    const preparedSource = await props.scope.prepare({ kind: 'book', resourceId: await mediaFileResourceId(bookPath, files) });
    if (!preparedSource) return;

    // Check for saved page position using the per-book storage key
    const savedPageIndex = await loadSavedPageIndex(bookId);
    let startPage = 0;

    if (savedPageIndex !== null && savedPageIndex >= 0 && savedPageIndex < files.length) {
      startPage = savedPageIndex;
      log.info(`[Reader] Restored page position ${startPage} for book "${bookId}"`);
    }

    const newPages: PageImage[] = files.map((file, index) => ({
      id: `page-${index}-${file.name}`,
      kind: 'image',
      src: URL.createObjectURL(file),
      name: file.name,
      index,
      blob: file,
    }));

    const title = bookId || t('mlearn.Reader.Status.ImportedBook');
    if (!commitLoadedPages(newPages, { bookId, title, path: bookPath, format: 'images', startPage, preparedSource,
      displayTitle: readerBookDisplayTitle(undefined, droppedFolderName || files[0].name, langCtx.supportedLanguages()) || title })) return;
    void persistActiveBookPath(bookPath);
    saveToRecent(title, 'book', startPage, bookPath, newPages[0]?.blob);
  };

  const saveToRecent = async (name: string, type: 'video' | 'book', progress: number = 0, path: string = '', coverBlob?: Blob) => {
    try {
      const location = sourceLocation();
      const sources = textSourcePages();
      const savedProgress = type === 'book' && location && sources
        ? progressForLocation(sources, location)
        : getRecentProgressPercent(progress + 1, pages().length);
      // Capture thumbnail from the first page if available
      let thumbnail: string | undefined;
      if (coverBlob) {
        thumbnail = await captureBlobThumbnail(coverBlob);
      }

      await saveToRecentItems({
        type,
        name,
        path,
        progress: type === 'book' ? savedProgress : progress,
      }, thumbnail);
    } catch (e) {
      log.error('Failed to save recent:', e);
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

    const pageChanged = newPage !== currentPage();
    batch(() => {
      if (pageChanged) {
        setReadingVisit((visit) => visit + 1);
        setResumedWithoutReading(false);
      }
      setCurrentPage(newPage);
    });
    if (pageChanged) scrollReaderToPageStart(readerMainRef);

    // Persist per-book page position
    const bookId = currentBookId();
    if (currentBookFormat() === 'epub') {
      const location = locationForPage(pages(), newPage);
      setSourceLocation(location);
      persistSourceLocation(bookId, location);
    } else {
      persistPageIndex(bookId, newPage, total);
    }

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
    setExplainerMode('word');
    setExplainerWord(word);
    setExplainerContext(context);
    setExplainerPosition(position);
    setExplainerOpen(true);

    // Track grammar failure for the word being explained
    if (supportsGrammar()) {
      const detectedPatterns = detectGrammarInText([{ word, surface: word, actual_word: word } as Token]);
      for (const pattern of detectedPatterns) {
        flashcardCtx.trackGrammarFailed(pattern.pattern, pattern.level, sourceLanguage());
      }
    }
  };

  const handleOpenPhraseExplainer = (context: string, position: { x: number; y: number }) => {
    setExplainerMode('phrase');
    setExplainerWord('');
    setExplainerContext(context);
    setExplainerPosition(position);
    setExplainerOpen(true);
  };

  const handleCloseExplainer = () => {
    setExplainerOpen(false);
  };

  // OCR hover handlers (legacy-style hover popup)
  let ocrHoverRequestId = 0;
  // Store current context phrase for use in WordHover
  const [ocrContextPhrase, setOcrContextPhrase] = createSignal('');
  const [ocrContextMenuPosition, setOcrContextMenuPosition] = createSignal<{ x: number; y: number }>({ x: 0, y: 0 });

  const handleOcrWordHover = async (
    token: Token,
    rect: DOMRect,
    contextPhrase = '',
    element: HTMLElement | null = null,
    trackPassiveHover = true,
  ) => {
    // Use actual_word (dictionary form) for translation lookup, fallback to surface
    const lookupWord = getTokenLookupWord(token, tokenizerCapabilities());
    const displayWord = token.surface ?? token.word;

    // Check if translation is already cached (from pre-warm)
    // This ensures the prosody pill shows immediately on first hover
    const cachedTranslation = getCachedTranslation(lookupWord, sourceLanguage(), { ...wordLookupOptions, context: tokenLookupContext(token, contextPhrase) });

    const openedHover = {
      word: displayWord,
      token,
      translation: null,
      position: { x: rect.left + rect.width / 2, y: rect.top },
      anchorRect: rect,
      element,
      lookupWord,
      language: sourceLanguage(),
      trackPassiveHover,
      contextIdentity: contextPhrase,
    };
    if (!showOcrHover(openedHover)) return;
    const requestId = ++ocrHoverRequestId;

    // Store context phrase for LLM explain and flashcard example
    setOcrContextPhrase(contextPhrase);
    // Preserve settled data for repeated movement; reset only for a new open.
    setOcrTranslationData(cachedTranslation);
    setOcrDictionaryEntries([]);

    let resolvedTranslation = cachedTranslation;
    const maybeAdmitUsefulReveal = (response: TranslationResponse | null, entries: DictionaryEntry[]) => {
      if (!trackPassiveHover || !isWindowFocused() || !isWindowVisible() || !isCurrentOcrHover(openedHover)) return;
      if (!hasUsefulWordHoverContent(token, response ?? undefined, entries, currentLangData())) return;
      admitOcrReveal((data) => {
        if (!flashcardCtx.isKnowledgeReady() || !data.lookupWord) return;
        flashcardCtx.trackWordHovered(data.lookupWord, data.token?.reading, data.language ?? sourceLanguage());
      });
    };
    maybeAdmitUsefulReveal(cachedTranslation, []);

    // If not cached, fetch translation
    if (!cachedTranslation) {
      try {
        // Use dictionary form for translation lookup (handles conjugations like 屈して -> 屈する)
        const translation = await translateWord(lookupWord, tokenLookupContext(token, contextPhrase));
        if (requestId !== ocrHoverRequestId) return;
        if (!isCurrentOcrHover(openedHover)) return;
        setOcrTranslationData(translation);
        resolvedTranslation = translation;
        maybeAdmitUsefulReveal(resolvedTranslation, ocrDictionaryEntries());
      } catch (_e) {
        log.error("error", _e);
        /* ignore */
      }
    }

    if (settings.showDictionary) {
      try {
        const entries = await lookup(lookupWord, token.reading);
        if (requestId !== ocrHoverRequestId) return;
        if (!isCurrentOcrHover(openedHover)) return;
        setOcrDictionaryEntries(entries);
        maybeAdmitUsefulReveal(resolvedTranslation, entries);
      } catch (_e) {
        log.error("error", _e);
        if (requestId !== ocrHoverRequestId) return;
        if (!isCurrentOcrHover(openedHover)) return;
        setOcrDictionaryEntries([]);
      }
    }
  };
  const handleOcrWordMove = (
    token: Token,
    rect: DOMRect,
    contextPhrase = '',
    element: HTMLElement | null = null,
    trackPassiveHover = true,
  ) => {
    if (!element) return;
    const lookupWord = getTokenLookupWord(token, tokenizerCapabilities());
    const openedHover = {
      word: token.surface ?? token.word,
      token,
      translation: null,
      position: { x: rect.left + rect.width / 2, y: rect.top },
      anchorRect: rect,
      element,
      lookupWord,
      language: sourceLanguage(),
      trackPassiveHover,
      contextIdentity: contextPhrase,
    };
    if (!updateOcrHoverPosition(openedHover)) {
      void handleOcrWordHover(token, rect, contextPhrase, element, trackPassiveHover);
    }
  };
  const handleOcrWordLeave = () => hideOcrHover();

  const goHome = () => {
    void clearActiveBookPath();
    navigate('/');
  };

  const openConversationAgent = () => {
    const s = mediaStats.stats();
    const name = bookTitle();
    const lang = sourceLanguage();

    const freqLookup = { getFrequency: langCtx.getFrequency, getFreqLevelNames: langCtx.getFreqLevelNames };
    const grammarLookup = { getGrammarPoint: langCtx.getGrammarPoint, getGrammarLevelNames: langCtx.getGrammarLevelNames };
    const wordLevels = computeWordLevelPercentages(s, freqLookup, langCtx.currentLangData());
    const grammarLevels = computeGrammarLevelPercentages(s, grammarLookup, langCtx.currentLangData());
    const difficulty = assessMediaDifficulty(wordLevels, grammarLevels, langCtx.currentLangData());
    const level = difficulty.headline;
    const levelNames = langCtx.getFreqLevelNames();

    // Only include words encountered in this specific media. Refine ease with
    // the canonical resolver (effective claim ?? evidence projection) but never
    // add words from other media. Per-media hover counts are the weak-signal
    // observation for this media and stay local (no global channel in the
    // resolver).
    const mediaWords = new Map<string, { word: string; ease: number; timesSeen: number; timesHovered: number }>();

    for (const entry of Object.values(s.wordsEncountered)) {
      const resolved = flashcardCtx.getComprehensiveWordStatusWithSourceSync(entry.word, sourceLanguage());
      mediaWords.set(entry.word, {
        word: entry.word,
        ease: resolved.ease !== undefined ? Math.min(entry.ease, resolved.ease) : entry.ease,
        timesSeen: Math.max(entry.timesSeen, resolved.timesSeen),
        timesHovered: entry.timesHovered,
      });
    }

    const failedWords = Array.from(mediaWords.values()).filter((word) => isWordMarkedFailed(word, settings));
    const failedGrammar = Object.values(s.grammarEncountered).filter((g) => g.timesFailed > 0);
    // Exposure-ranked practice candidates: repeatedly encountered in the
    // canonical knowledge store without any failure. Unmeasured signals only —
    // failed patterns stay in failedGrammar above.
    const grammarExposure = buildGrammarExposure(s.grammarEncountered, (pattern) => flashcardCtx.getGrammarKnowledge(pattern, sourceLanguage()));

    const context: ConversationAgentContext = {
      mediaName: name,
      mediaType: 'book',
      sourceContext: { workspace: 'reader', path: currentBookPath(), page: currentPage(), location: sourceLocation(), mediaHash: s.mediaHash },
      mediaHash: s.mediaHash,
      assessedLevel: level,
      assessedLevelName: formatFrequencyLevelLabel(level, levelNames, langCtx.currentLangData()),
      language: lang,
      failedWords,
      failedGrammar,
      grammarExposure,
      wordLevelPercentages: wordLevels,
      grammarLevelPercentages: grammarLevels,
    };

    getBridge().window.openWindow({ type: 'conversation-agent', context: { ...context, returnTo: 'reader' } });
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
  const sepiaEnabled = () => settings.readerSepiaEnabled ?? DEFAULT_SETTINGS.readerSepiaEnabled!;
  const imageSharpenEnabled = () => !sepiaEnabled()
    && (settings.readerSharpenEnabled ?? DEFAULT_SETTINGS.readerSharpenEnabled!);
  const textSharpenEnabled = () => !sepiaEnabled()
    && !imageSharpenEnabled()
    && (settings.readerSharpenTextEnabled ?? DEFAULT_SETTINGS.readerSharpenTextEnabled!);

  return (
      <section
          class="reader-route"
          classList={{
            'reader-route--sepia': sepiaEnabled(),
            'reader-route--sharpen': imageSharpenEnabled(),
            'reader-route--sharpen-text': textSharpenEnabled(),
          }}
          aria-label={t('mlearn.Reader.Title')}
          tabIndex={-1}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
      >

        {/* Navigation Bar */}
        <ReaderNav
            sourceLanguageControl={<SourceLanguageSelect scope={props.scope} />}
            hasPages={hasPages}
            bookTitle={bookDisplayTitle}
            progressString={progressString}
            fitMode={fitMode}
            pageMode={pageMode}
            firstPageSingle={firstPageSingle}
            showOcrOverlay={showOcrOverlay}
            hasOcrResult={hasOcrResult}
            showTextTheme={visiblePagesAreText()}
            onGoHome={goHome}
            onToggleSidebar={() => setShowSidebar(!showSidebar())}
            onToggleWordSidebar={() => setShowWordSidebar(!showWordSidebar())}
            onFitModeChange={(mode) => setFitMode(mode as FitMode)}
            onPageModeChange={(mode) => updateSettings({ readerPageMode: mode as PageMode })}
            spreadDirection={readerSpreadDirection}
            onSpreadDirectionChange={(direction) => updateSettings({ readerSpreadDirection: direction as ReaderSpreadDirection })}
            onToggleFirstPageSingle={() => {
              const wasFirstSingle = firstPageSingle();
              const newFirstSingle = !wasFirstSingle;
              const curr = currentPage();
              updateSettings({ readerFirstPageSingle: newFirstSingle });

              // Check if current page is valid in the new mode
              const isValidInNewMode = curr === 0 ||
                  (newFirstSingle ? curr % 2 === 1 : curr % 2 === 0);

              if (!isValidInNewMode && curr > 0) {
                // To prevent drift, alternate direction based on which mode we're entering:
                // Going TO odd starts (firstSingle=true): round DOWN (curr - 1)
                // Going TO even starts (firstSingle=false): round UP (curr + 1)
                const snapped = newFirstSingle ? curr - 1 : curr + 1;
                const total = pages().length;
                batch(() => {
                  setCurrentPage(Math.max(0, Math.min(snapped, total - 1)));
                });
              }
            }}
            onToggleOcrOverlay={toggleOcrOverlay}
            onOpenFolder={handleOpenFolder}
            onOpenPdf={handleOpenBookFile}
            onPrevPage={prevPage}
            onNextPage={nextPage}
        />

        <Show when={hasPages() && (showSidebar() || showWordSidebar())}>
          <button
            type="button"
            class="reader-sidebar-backdrop"
            aria-label={t('mlearn.Global.Close')}
            onClick={() => {
              setShowSidebar(false);
              setShowWordSidebar(false);
            }}
          />
        </Show>

        {/* Sidebar */}
        <Show when={hasPages() && showSidebar()}>
          <ReaderSidebar
              pages={pages}
              activePageIndices={visiblePageIndices}
              hasOcrForPage={hasOcrForPage}
              onGoToPage={goToPage}
          />
        </Show>

        {/* Main Content */}
        <main
          class={`reader-main ${hasPages() && showSidebar() ? 'with-sidebar' : ''} ${hasPages() && showWordSidebar() ? 'with-word-sidebar' : ''} ${fitMode()}${visiblePagesAreText() ? ' text-reader' : ''}${visiblePagesAreText() ? ` ${readerTextThemeClass(settings.readerTextTheme)}` : ''}`}
          style={visiblePagesAreText() ? readerTextStyle() : undefined}
          ref={readerMainRef}
        >
          <Show
              when={pages().length > 0}
              fallback={<ReaderWelcomeCard isDragging={isDragging} loadError={bookLoadError()} onOpenFolder={handleOpenFolder} onOpenPdf={handleOpenBookFile} />}
          >
            <div
              class={`page-container ${pageMode()} spread-${readerSpreadDirection() === 'right-to-left' ? 'rtl' : 'ltr'}${(collatePages() && pageMode() === 'double') ? ' collate' : ''}${readerBookVertical() && visiblePagesAreText() ? ' vertical-text' : ''}`}
              ref={pageContainerRef}
            >
              <For each={visiblePages()}>
                {(page, i) => {
                  // Determine visual side for collated double-page mode.
                  const pageSideClass = () => {
                    const isCollatedSpread =
                      pageMode() === 'double' &&
                      collatePages() &&
                      visiblePages().length === 2;
                    if (!isCollatedSpread) return '';
                    return getSpreadPageSideClass(i(), visiblePages().length, readerSpreadDirection());
                  };
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
                    const visibleIndices = visiblePageIndices();
                    const visibleStart = visibleIndices[0] ?? currentPage();
                    const visibleEnd = visibleIndices[visibleIndices.length - 1] ?? currentPage();

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
                      <div class={`page ${pageSideClass()}`}>
                        <Show
                          when={page.kind === 'text'}
                          fallback={(
                            <>
                              <img
                                  class="page-image"
                                  src={page.src ?? ''}
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
                              <Show when={imageRefs()[page.id]}>
                                {(image) => (
                                  <div
                                    class="reader-crop-regions"
                                    style={{
                                      left: `${image().offsetLeft}px`,
                                      top: `${image().offsetTop}px`,
                                      width: `${image().clientWidth}px`,
                                      height: `${image().clientHeight}px`,
                                    }}
                                  >
                                    <For each={croppedRegions()[page.id] ?? []}>
                                      {(region) => (
                                        <div class="reader-crop-region" style={getCropRegionStyle(image(), region)} />
                                      )}
                                    </For>
                                  </div>
                                )}
                              </Show>
                              <Show when={cropMode() && cropAddMode() && imageRefs()[page.id]}>
                                {(image) => (
                                  <div
                                    class="reader-crop-layer"
                                    classList={{ processing: cropProcessingPageId() === page.id }}
                                    style={{
                                      left: `${image().offsetLeft}px`,
                                      top: `${image().offsetTop}px`,
                                      width: `${image().clientWidth}px`,
                                      height: `${image().clientHeight}px`,
                                    }}
                                    onPointerDown={(event) => handleCropPointerDown(page, event)}
                                    onPointerMove={(event) => handleCropPointerMove(page, event)}
                                    onPointerUp={(event) => handleCropPointerUp(page, event)}
                                    onPointerCancel={() => setCropSelection(null)}
                                  >
                                    <Show when={cropSelection()?.pageId === page.id}>
                                      <div class="reader-crop-selection" style={getCropSelectionStyle(page.id)} />
                                    </Show>
                                  </div>
                                )}
                              </Show>
                              {/* OCR Overlay for each visible page */}
                              <Show when={imageRefs()[page.id] && ocrResults[page.id]}>
                                <OcrOverlay
                                    result={ocrResults[page.id]}
                                    imageElement={imageRefs()[page.id]}
                                    visible={showOcrOverlay()}
                                    debugOcr={ocrDebugOverlay()}
                                    zoneDeltaThreshold={zoneDeltaThreshold()}
                                    onWordHover={handleOcrWordHover}
                                    onWordMove={handleOcrWordMove}
                                    onWordLeave={handleOcrWordLeave}
                                    onContextMenu={handleOcrContextMenu}
                                    onTokenDataChange={(entries) => handlePageTokenData(page.id, entries)}
                                    highlightedOriginalIndices={(() => {
                                      const entry = sidebarHoveredEntry();
                                      if (!entry || entry.pageId !== page.id || entry.box?.__originalIdx == null) return undefined;
                                      return new Set([entry.box.__originalIdx]);
                                    })()}
                                />
                              </Show>
                            </>
                          )}
                        >
                          <ReaderTextPage
                            page={page}
                            tokenizeMany={tokenizeMany}
                            tokenJoinSeparator={getTokenJoinSeparator(currentLangData())}
                            onWordHover={handleOcrWordHover}
                            onWordMove={handleOcrWordMove}
                            onWordLeave={handleOcrWordLeave}
                            vertical={readerBookVertical()}
                            onTokenDataChange={(entries) => handlePageTokenData(page.id, entries)}
                            onTokenized={scheduleTextPageOverflowAudit}
                            onTokenizeStateChange={handleTokenizeStateChange}
                          />
                        </Show>
                      </div>
                  );
                }}
              </For>
            </div>
          </Show>
        </main>

        <Show when={hasPages() && showWordSidebar()}>
          <ReaderUnknownWordsSidebar
              words={visibleUnknownWords}
              isProcessing={visiblePagesStillProcessing}
              blockedMessage={() => {
                const state = currentOcrAutomationState();
                return state.kind === 'blocked' ? state.message : null;
              }}
              addingWordKeys={addingSidebarWords}
              isAddingAll={isAddingAllSidebarWords}
              failedWordSet={failedSidebarWordSet}
              onAddWord={handleAddSidebarWord}
              onAddAll={handleAddAllSidebarWords}
              onIgnoreWord={handleIgnoreSidebarWord}
              onWordHover={setSidebarHoveredEntry}
              onWordLeave={() => setSidebarHoveredEntry(null)}
              onClose={() => setShowWordSidebar(false)}
              onPracticeWords={entries => getBridge().window.openWindow({ type: 'level-study', context: {
                activity: 'practice', returnTo: 'reader',
                sourceContext: { workspace: 'reader', path: currentBookPath(), page: currentPage(), location: sourceLocation() },
                material: { language: sourceLanguage(), words: entries.map(entry => entry.word), label: bookTitle() },
              } })}
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
            isTokenizing={isTokenizingTextPages}
            isTranslating={isTranslationWarming}
            onRunOcr={runOcr}
            onOpenConversationAgent={openConversationAgent}
            cropMode={cropMode}
            onToggleCropMode={toggleCropMode}
            cropAddMode={cropAddMode}
            onToggleCropAddMode={toggleCropAddMode}
            ocrControlsVisible={() => Boolean(ocrEnabled()) && readerHasImagePages()}
            showDocumentOcrToggle={showDocumentOcrToggle}
            documentOcr={documentOcr}
            onToggleDocumentOcr={toggleDocumentOcr}
            debugOcr={ocrDebugOverlay}
            onToggleDebugOcr={toggleOcrDebugOverlay}
            lastOcrTiming={lastOcrTiming}
            ocrDetectionScale={ocrDetectionScale}
            onOcrDetectionScaleChange={setOcrDetectionScale}
            zoneDeltaThreshold={zoneDeltaThreshold}
            onZoneDeltaThresholdChange={setZoneDeltaThreshold}
        />

        <StableWordHover data={ocrHoverData}>
          {(hoverData) => hoverData().token ? (
            <WordHover
              token={hoverData().token!}
              word={hoverData().word || hoverData().token!.surface || hoverData().token!.word || ''}
              position={hoverData().position}
              anchorRect={hoverData().anchorRect}
              dictionaryEntries={ocrDictionaryEntries()}
              translationData={ocrTranslationData() || undefined}
              isOCR={true}
              headwordFontFamily={readerTextFontFamily()} /*this is tech debt but idc*/
              lookupContext={tokenLookupContext(hoverData().token!, ocrContextPhrase())}
              contextPhrase={ocrContextPhrase()}
              ocrImageElement={(() => {
                // Find the correct page image based on anchor position
                // This is crucial for double-page mode where words could be on either page
                const anchorRect = hoverData().anchorRect;
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
              onClose={hideOcrHover}
              visible={isOcrHoverVisible()}
              onMouseEnter={cancelOcrHide}
              onMouseLeave={hideOcrHover}
              onOpenExplainer={handleOpenExplainer}
            />
          ) : null}
        </StableWordHover>

        {/* LLM Explainer Popup */}
        <ExplainerPopup
            isOpen={explainerOpen()}
            onClose={handleCloseExplainer}
            word={explainerWord()}
            contextPhrase={explainerContext()}
          mode={explainerMode()}
            initialPosition={explainerPosition()}
        />

        {/* Magnifying Glass */}
        <MagnifyingGlass
            imageElements={Object.values(imageRefs())}
            active={magnifierActive()}
        />

        </section>
  );
};
