/**
 * Word Hover Component
 * Popup that appears when hovering over a word
 * Matches legacy .subtitle_hover structure exactly from the old app
 */

import { Component, JSX, Show, For, createMemo, createSignal, createEffect, onCleanup, onMount } from 'solid-js';
import { DEFAULT_SETTINGS, type Token, type DictionaryEntry, type LanguageData, type TranslationEntry, type WordFrequencyMap } from '../../../shared/types';
import { useSettings, useFlashcards, useLanguage, useLocalization } from '../../context';
import { useOptionalGraph } from '../../context/GraphContext';
import { toUniqueIdentifier } from '../../services/statsService';
import { getCachedExplanation, isLLMReady } from '../../services/llmProvider';
import { ankiCacheVersion, findAnkiWordMatchInCache, isAnkiCacheFetched } from '../../services/ankiWordsCache';
import { useTokenizer, getCachedTranslation } from '../../hooks/useTranslation';
import { PillBtn, PillLabel, Modal, Btn, ToggleSwitch, SafeHtml, KnowledgeProjectionDrawer, SkeletonText } from '../common';
import { KnowledgeCapabilitySummary } from '../common/WordStatusPillKnowledge';
import { getEvents, eventsVersion } from '../../services/knowledgeEvents';
import { hashWordSync } from '../../services/srsAlgorithm';
import { getAvailableAspects } from '../../../shared/types';
import type { KnowledgeEvent } from '../../../shared/knowledgeEvents';
import { ProsodyOverlay } from '../language-specific';
import { ResourcePill, WordStatusPill } from '../common/Smart';
import { openWordLookup } from '../../services/wordLookupService';
import {
  buildWordHoverFlashcardContent,
  resolveProsodyForHover,
  type WordHoverTranslationData,
} from './wordHoverHelpers';
import { clipVideo } from '../../services/videoClipService';
import { getBridge } from '../../../shared/bridges';
import { showToast } from '../common/Feedback/Toast';
import { getTokenLookupWord, getTokenWordFormCandidates } from '../../utils/wordForms';
import { getDictionaryTargetLanguageForSettings } from '../../utils/dictionaryTargetLanguage';
import { extractReadingValue } from '../../utils/translationCacheParsers';
import { compoundSplitterConfig, getFrequencyLevelVisualRank } from '../../../shared/languageFeatures';
import type { LanguageCompoundSplittingConfig } from '../../../shared/types';
import { prosodyVisible } from '../../../shared/prosodySettings';
import type { GrammarOccurrence } from '../../../shared/grammar/occurrences';
import { decomposeCompound, MIN_PART_LENGTH, type CompoundAnalysis, type CompoundLexicon } from '../../../shared/graph/morphology/compounds';
import './WordHover.css';
import { getLogger } from '../../../shared/utils/logger';
import type { KnowledgeProjection } from '../../../shared/graph/ipc';
import { openGraphInspector } from '../../services/openGraphInspector';

const log = getLogger("renderer.components.wordHover");

export type { WordStatus } from './wordHoverHelpers';

// Icon names for the Icon component - enables proper SVG coloring
const ICON_BOT = 'bot';

// UI element dimensions for boundary calculations (actual CSS values from reader components)
const UI_NAVBAR_HEIGHT = 48;  // .reader-nav height: 48px
const UI_SIDEBAR_WIDTH = 160; // .reader-sidebar width: 160px
const UI_STATUSBAR_HEIGHT = 30; // .reader-status height: 30px
const UI_BOUNDARY_PADDING = 12; // Small padding from UI elements

// ============ Compound decomposition (REQ42) ============

/** Per-frequency-map cache, keyed secondarily by the package-declared strategy
 * (locale + minimum leaf length): one frequency map must never serve a lexicon
 * normalized under a different declared strategy. */
const compoundLexiconCache = new WeakMap<object, Map<string, CompoundLexicon>>();

/** The splitter lexicon is the language's own frequency vocabulary, case-normalized per the package's declared strategy. */
function compoundLexiconFor(freq: WordFrequencyMap | undefined, config: LanguageCompoundSplittingConfig): CompoundLexicon {
  if (!freq || typeof freq !== 'object') return new Map();
  const minPartLength = config.minPartLength ?? MIN_PART_LENGTH;
  let byStrategy = compoundLexiconCache.get(freq);
  if (!byStrategy) {
    byStrategy = new Map();
    compoundLexiconCache.set(freq, byStrategy);
  }
  const cacheKey = `${config.locale}:${minPartLength}`;
  const cached = byStrategy.get(cacheKey);
  if (cached) return cached;
  const lexicon: CompoundLexicon = new Map(
    Object.keys(freq)
      .filter((surface) => surface.length >= minPartLength)
      .map((surface) => [surface.toLocaleLowerCase(config.locale), { lemma: surface }]),
  );
  byStrategy.set(cacheKey, lexicon);
  return lexicon;
}

/**
 * Decompose a hovered surface with the shared splitter, or null when the
 * language has no compound capability, the word is too short to hold two
 * parts, or the result is not a generated multi-part split (attested single
 * lexemes are not compounds and render no tree).
 */
export function compoundAnalysisFor(word: string, languageData: LanguageData | null | undefined, freq: WordFrequencyMap | undefined): CompoundAnalysis | null {
  const config = compoundSplitterConfig(languageData);
  if (!config) return null;
  const normalized = word.trim();
  if (normalized.length < 2 * (config.minPartLength ?? MIN_PART_LENGTH)) return null;
  const analysis = decomposeCompound(normalized, compoundLexiconFor(freq, config), config);
  return analysis?.source === 'generated' ? analysis : null;
}

export type CompoundDisplayResolution =
  | { kind: 'pending' }
  | { kind: 'unseen'; analysis: CompoundAnalysis }
  | { kind: 'attested'; analysis: CompoundAnalysis }
  | { kind: 'none' };

/**
 * Graph-first resolution order for the hover decomposition. While the
 * projection is in flight (or stale for this word) nothing is guessed; a
 * graph-attested structure is primary; a graph-known surface without attested
 * structure is never guessed; only a surface absent from the graph falls back
 * to the productive splitter (which itself requires the declared strategy).
 */
export function resolveCompoundDisplay(
  projection: KnowledgeProjection | undefined,
  word: string,
  languageData: LanguageData | null | undefined,
  freq: WordFrequencyMap | undefined,
): CompoundDisplayResolution {
  if (!projection || projection.status !== 'ready' || projection.querySurface !== word) return { kind: 'pending' };
  if (projection.compoundAnalysis) return { kind: 'attested', analysis: projection.compoundAnalysis };
  if (projection.surfaceKnown) return { kind: 'none' };
  const generated = compoundAnalysisFor(word, languageData, freq);
  return generated ? { kind: 'unseen', analysis: generated } : { kind: 'none' };
}

export interface WordHoverProps {
  token: Token;
  word: string;
  position: { x: number; y: number };
  anchorRect?: DOMRect;
  dictionaryEntries?: DictionaryEntry[];
  translationData?: WordHoverTranslationData;
  isLoading?: boolean;
  level?: number;
  isInSRS?: boolean;
  ease?: number;
  contextPhrase?: string; // The subtitle text for context
  isOCR?: boolean; // Whether in OCR mode (reader) vs video mode
  ocrImageElement?: HTMLImageElement | null; // The page image element for OCR screenshot capture
  onAddFlashcard?: (token: Token, entry?: DictionaryEntry) => void;
  onAddToSRS?: () => void;
  onPlayAudio?: (word: string) => void;
  /** @deprecated Use onOpenExplainer instead */
  onLLMExplain?: () => void;
  /** Callback to open the LLM explainer popup */
  onOpenExplainer?: (word: string, contextPhrase: string, position: { x: number; y: number }) => void;
  onClose?: () => void;
  visible?: boolean;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  /** Subtitle start time in seconds (for video clip flashcards) */
  subtitleStart?: number;
  /** Subtitle end time in seconds (for video clip flashcards) */
  subtitleEnd?: number;
  /** Video source URL (for video clip flashcards) */
  videoSrc?: string;
  lastScreenshot?: string;
  grammarOccurrences?: readonly GrammarOccurrence[];
}

export const WordHover: Component<WordHoverProps> = (props) => {
  const { settings, updateSettings } = useSettings();
  const { meta: graphMeta, getTargetsForSurfaces } = useOptionalGraph();
  const { addFlashcard, hasWordSync, getCardByWordSync, getComprehensiveWordStatusWithSourceSync, getAspectStatus, setWordClaim, setAspectStatus, clearAspectClaim } = useFlashcards();
  const { getFrequency, getLevelName, getFreqLevelNames, getLanguageFeatures, currentLangData, getCanonicalForm, getWordVariants, getWordFrequency } = useLanguage();
  const { tokenize } = useTokenizer({ language: settings.language, languageData: currentLangData });
  const { t } = useLocalization();
  const dictionaryTargetLanguage = createMemo(() => getDictionaryTargetLanguageForSettings(settings));
  const [wordUuid, setWordUuid] = createSignal<string>('');
  // Flag to prevent effect from overwriting local isInSRS state during flashcard creation
  const [isAddingFlashcard, setIsAddingFlashcard] = createSignal(false);
  // Flag to lock position during state changes to prevent jumps
  const [, setPositionLocked] = createSignal(false);
  // Track if we have a cached explanation (for pill indicator)
  const [hasCachedExplanation, setHasCachedExplanation] = createSignal(false);
  const [graphLookup, setGraphLookup] = createSignal<import('../../../shared/graph/ipc').GraphWordLookup | null>(null);
  const [projection, setProjection] = createSignal<KnowledgeProjection>();
  const [showKnowledgeDetails, setShowKnowledgeDetails] = createSignal(false);
  let hoverRef: HTMLDivElement | undefined;
  let contentRef: HTMLDivElement | undefined;

  // Helper to get display word - track token changes
  const displayWord = createMemo(() => props.word || props.token.surface || props.token.word);
  const tokenizerCapabilities = createMemo(() => getLanguageFeatures().tokenizerCapabilities);
  
  // Track the actual word being displayed for reactive updates
  const actualWord = createMemo(() => getTokenLookupWord({
    ...props.token,
    word: props.word || props.token.word,
  }, tokenizerCapabilities()) || displayWord());

  const isShown = createMemo(() => props.visible !== false);

  createEffect(() => {
    const word = actualWord();
    if (!word || !graphMeta().ready) {
      setGraphLookup(null);
      return;
    }
    let disposed = false;
    void getTargetsForSurfaces([{ surface: word }]).then(([result]) => {
      if (!disposed) setGraphLookup(result?.lookup ?? null);
    });
    onCleanup(() => { disposed = true; });
  });

  createEffect(() => {
    const word = actualWord();
    if (!word) return;
    let disposed = false;
    void getBridge().graph.getKnowledgeProjection(settings.language, word).then((next) => {
      if (!disposed) setProjection(next);
    }).catch(() => {
      if (!disposed) setProjection({ status: 'error', targets: [] });
    });
    onCleanup(() => { disposed = true; });
  });
  
  // REACTIVE: Check if word is in SRS using synchronous method
  // This properly integrates with SolidJS's reactive system
  const isInSRS = createMemo(() => {
    // Early exit if we're adding a flashcard (show tracked state optimistically)
    if (isAddingFlashcard()) return true;
    
    const word = actualWord();
    if (!word) return props.isInSRS ?? false;
    
    // Use sync method for proper reactivity with store
    return hasWordSync(word, settings.language) || (props.isInSRS ?? false);
  });
  
  // REACTIVE: Get flashcard for the word (if tracked)
  const currentFlashcard = createMemo(() => {
    const word = actualWord();
    if (!word) return null;
    return getCardByWordSync(word, settings.language);
  });

  const wordForms = createMemo(() => getTokenWordFormCandidates({
    ...props.token,
    word: props.word || props.token.word,
  }, getCanonicalForm, getWordVariants, {
    tokenizerCapabilities: tokenizerCapabilities(),
    languageData: currentLangData(),
  }));

  // REQ42 + graph-first: the resolution is tri-state — while the projection is
  // in flight nothing is guessed; graph-attested structure is primary; a
  // graph-known surface without structure is never guessed; only surfaces
  // absent from the graph fall back to the productive splitter.
  const compoundAnalysis = createMemo(() => {
    const resolution = resolveCompoundDisplay(projection(), actualWord(), currentLangData(), getWordFrequency());
    return resolution.kind === 'pending' || resolution.kind === 'none' ? null : resolution.analysis;
  });
  
  // REACTIVE: Get current ease from flashcard if tracked
  const currentEase = createMemo(() => {
    const card = currentFlashcard();
    if (card) {
      return card.ease;
    }
    return props.ease;
  });
  
  // Generate the UUID used for example extraction when the hovered word changes.
  createEffect(() => {
    const word = actualWord();
    if (!word) return;

    (async () => {
      try {
        const uuid = await toUniqueIdentifier(word);
        setWordUuid(uuid);
      } catch (e) {
        log.error('Failed to load word status:', e);
      }
    })();
  });

  // Check if we have a cached explanation for the current word (for pill indicator)
  createEffect(() => {
    const word = displayWord();
    const context = props.contextPhrase || '';
    
    // Check if we have a cached explanation for this word+context
    const cached = getCachedExplanation(word, context);
    setHasCachedExplanation(!!cached);
  });

  const [computedPosition, setComputedPosition] = createSignal<{ left: number; top: number }>({ left: 0, top: 0 });
  let subtitleHoverRef: HTMLElement | null = null;

  const getHoverDimensions = (): { width: number; height: number } => {
    if (!subtitleHoverRef) return { width: 280, height: 200 };
    return {
      width: subtitleHoverRef.offsetWidth || 280,
      height: subtitleHoverRef.offsetHeight || 200,
    };
  };

  // Detect UI elements present in the DOM to calculate safe boundaries
  // Returns the actual pixel boundaries of the content area
  const getUIBounds = (): { 
    minX: number; maxX: number; minY: number; maxY: number; 
    vw: number; vh: number; 
    hasNavbar: boolean; hasSidebar: boolean; hasStatusbar: boolean;
    sidebarWidth: number; navbarHeight: number; statusbarHeight: number;
  } => {
    const vw = typeof window !== 'undefined' ? window.innerWidth : 800;
    const vh = typeof window !== 'undefined' ? window.innerHeight : 600;
    
    // Check for navbar - look for actual reader-nav element
    const navbarEl = document.querySelector('.reader-nav, .video-nav');
    const hasNavbar = !!navbarEl;
    const navbarHeight = navbarEl ? (navbarEl as HTMLElement).offsetHeight || UI_NAVBAR_HEIGHT : 0;
    
    // Check for left page sidebar and right unknown-words sidebar.
    const sidebarEl = document.querySelector('.reader-sidebar');
    const rightSidebarEl = document.querySelector('.reader-unknown-words-sidebar');
    const hasSidebar = !!sidebarEl;
    const sidebarWidth = sidebarEl ? (sidebarEl as HTMLElement).offsetWidth || UI_SIDEBAR_WIDTH : 0;
    const rightSidebarWidth = rightSidebarEl ? (rightSidebarEl as HTMLElement).offsetWidth : 0;
    
    // Check for statusbar - look for actual reader-status element
    const statusbarEl = document.querySelector('.reader-status, .reader-status-bar');
    const hasStatusbar = !!statusbarEl;
    const statusbarHeight = statusbarEl ? (statusbarEl as HTMLElement).offsetHeight || UI_STATUSBAR_HEIGHT : 0;
    
    // Calculate safe bounds with small padding
    const minX = (hasSidebar ? sidebarWidth : 0) + UI_BOUNDARY_PADDING;
    const maxX = vw - rightSidebarWidth - UI_BOUNDARY_PADDING;
    const minY = (hasNavbar ? navbarHeight : 0) + UI_BOUNDARY_PADDING;
    const maxY = vh - (hasStatusbar ? statusbarHeight : 0) - UI_BOUNDARY_PADDING;
    
    return { minX, maxX, minY, maxY, vw, vh, hasNavbar, hasSidebar, hasStatusbar, sidebarWidth, navbarHeight, statusbarHeight };
  };

  // Calculate position with boundary constraints
  const calculateBoundedPosition = (width: number, hoverHeight: number): { left: number; top: number } => {
    const anchor = props.anchorRect;
    const bounds = getUIBounds();
    const { minX, maxX, minY, maxY, vh, navbarHeight, statusbarHeight } = bounds;
    
    // Calculate centered position relative to anchor
    const anchorCenterX = anchor ? (anchor.left + anchor.right) / 2 : props.position.x;
    const anchorTop = anchor ? anchor.top : props.position.y;
    const anchorBottom = anchor ? anchor.bottom : props.position.y + 16;
    
    // Start with centered position
    let left = anchorCenterX - width / 2;
    
    const margin = 8;
    // Calculate available space above/below accounting for UI elements
    const effectiveTop = navbarHeight + UI_BOUNDARY_PADDING;
    const effectiveBottom = vh - statusbarHeight - UI_BOUNDARY_PADDING;
    
    const spaceAbove = anchorTop - effectiveTop - margin;
    const spaceBelow = effectiveBottom - anchorBottom - margin;
    // In video mode (subtitles at bottom), prefer positioning above the word
    const placeAbove = spaceAbove >= hoverHeight || spaceAbove > spaceBelow;
    
    let top = placeAbove
      ? anchorTop - hoverHeight - margin
      : anchorBottom + margin;
    
    // Horizontal clamping within safe bounds
    // First, clamp to right edge (maxX is the rightmost position the right edge of hover can be)
    if (left + width > maxX) {
      left = maxX - width;
    }
    // Then, clamp to left edge (ensure left doesn't go below minX)
    if (left < minX) {
      left = minX;
    }
    
    // Vertical clamping within safe bounds
    // First, clamp to bottom edge (maxY is the bottommost position the bottom edge of hover can be)
    if (top + hoverHeight > maxY) {
      top = maxY - hoverHeight;
    }
    // Then, clamp to top edge (ensure top doesn't go below minY)
    if (top < minY) {
      top = minY;
    }
    
    return { left: Math.round(left), top: Math.round(top) };
  };

  createEffect(() => {
    const visible = isShown();
    void actualWord();
    void props.anchorRect;
    void props.position.x;
    void props.position.y;
    void props.translationData;
    void props.dictionaryEntries;
    
    if (!visible || !subtitleHoverRef) return;

    requestAnimationFrame(() => {
      const { width, height } = getHoverDimensions();
      const newPos = calculateBoundedPosition(width, height);
      setComputedPosition(newPos);
    });
  });

  createEffect(() => {
    const visible = isShown();
    if (!visible || !subtitleHoverRef) return;

    const ro = new ResizeObserver(() => {
      const { width, height } = getHoverDimensions();
      const newPos = calculateBoundedPosition(width, height);
      setComputedPosition(newPos);
    });

    ro.observe(subtitleHoverRef);

    requestAnimationFrame(() => {
      const { width, height } = getHoverDimensions();
      const newPos = calculateBoundedPosition(width, height);
      setComputedPosition(newPos);
    });

    return () => {
      ro.disconnect();
    };
  });

  const hoverStyle = createMemo((): JSX.CSSProperties => {
    const pos = computedPosition();

    return {
      position: 'fixed',
      left: `${pos.left}px`,
      top: `${pos.top}px`,
    };
  });
  // Check if we're in OCR mode - prefer prop, fallback to DOM detection
  const isOcrMode = (): boolean => {
    if (props.isOCR !== undefined) return props.isOCR;
    return !!document.querySelector('.ocr-overlay, .ocr-box, [class*="page-image"]');
  };

  const handleAddFlashcard = async (entry?: DictionaryEntry, e?: MouseEvent) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    
    // Prevent duplicate requests - early return if already adding
    if (isAddingFlashcard()) {
      log.info('%cFlashcard add request blocked - already adding', 'color: orange;');
      return;
    }
    
    // CRITICAL: Set adding flag immediately BEFORE any async operations
    // This prevents duplicate flashcards when clicking multiple times while backend is busy
    setIsAddingFlashcard(true);
    setPositionLocked(true);
    
    const word = actualWord();
    const isOcr = isOcrMode();
    
    if (props.onAddFlashcard) {
      props.onAddFlashcard(props.token, entry);
      // isInSRS and currentEase are now reactive memos that will update automatically
      // when the flashcard is added to the store
      setIsAddingFlashcard(false);
    } else {
      try {
        const freq = wordFreqEntry();
        const isVideoMode = settings.flashcardMediaType === 'video' && !!props.videoSrc;
        const { content, ease } = await buildWordHoverFlashcardContent({
          token: props.token,
          word,
          translationData: props.translationData,
          entry,
          contextPhrase: props.contextPhrase,
          isOcr,
          ocrImageElement: props.ocrImageElement,
          anchorRect: props.anchorRect,
          wordUuid: wordUuid(),
          level: freq?.raw_level ?? props.level,
          wordStatus: effectiveStatus(),
          colourCodes: settings.colour_codes || {},
          languageData: currentLangData(),
          ocrCropPadding: settings.ocr_crop_padding,
          tokenize,
          flashcardMediaType: isVideoMode ? 'video' : 'image',
          srsLearningEase: settings.srsLearningThreshold / 1000,
          srsKnownEase: settings.known_ease_threshold / 1000,
          screenshotDataUrl: props.lastScreenshot,
        });

        // If video mode, clip and save the video segment
        if (isVideoMode && props.videoSrc && props.subtitleStart != null && props.subtitleEnd != null) {
          const margin = (settings.flashcardVideoMargin ?? DEFAULT_SETTINGS.flashcardVideoMargin) / 1000;
          const start = Math.max(0, props.subtitleStart - margin);
          const end = props.subtitleEnd + margin;
          const videoData = await clipVideo(props.videoSrc, start, end);
          if (videoData) {
            const cardId = content.word ? await toUniqueIdentifier(content.word) : crypto.randomUUID();
            const videoUrl = await getBridge().flashcards.saveFlashcardVideo(cardId, videoData.buffer as ArrayBuffer);
            if (videoUrl) {
              content.videoUrl = videoUrl;
              content.skipExampleTts = true;
            } else {
              showToast({ message: t('mlearn.Video.VideoClipFailed'), variant: 'warning' });
            }
          } else {
            showToast({ message: t('mlearn.Video.VideoClipFailed'), variant: 'warning' });
          }
        }

        await addFlashcard(content, ease, undefined, settings.language);
        // isInSRS and currentEase are now reactive memos that will update automatically
        // when the flashcard is added to the store via BroadcastChannel sync
      } catch (err) {
        log.error('Failed to add flashcard:', err);
        alert(t('mlearn.WordHover.Errors.FailedToAddFlashcard', { error: String(err) }));
      } finally {
        // Always clear the adding flag when done
        setIsAddingFlashcard(false);
      }
    }
  };

  const handleAddToSRS = (e?: MouseEvent) => {
    e?.preventDefault();
    e?.stopPropagation();
    
    if (props.onAddToSRS) {
      props.onAddToSRS();
    } else {
      handleAddWithAnkiCheck(undefined, e);
    }
  };

  // Open the LLM explainer popup
  const handleOpenExplainer = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    // Check if LLM is enabled
    if (!isLLMReady(settings)) {
      alert(t('mlearn.WordHover.Alerts.ExplainRequiresLlm'));
      return;
    }
    
    // Call the callback to open the popup
    if (props.onOpenExplainer) {
      const word = displayWord();
      const context = props.contextPhrase || '';
      // Position popup near the hover (offset slightly)
      const pos = computedPosition();
      props.onOpenExplainer(word, context, { x: pos.left + 50, y: pos.top + 50 });
    } else if (props.onLLMExplain) {
      // Backwards compatibility
      props.onLLMExplain();
    }
  };

  // Translation entries
  const translationEntries = createMemo<TranslationEntry[]>(() => {
    const data = props.translationData?.data || [];
    const entries: TranslationEntry[] = [];
    for (const item of data) {
      if (!item || typeof item !== 'object') continue;
      const entry = item as TranslationEntry;
      if (entry.definitions) entries.push(entry);
    }
    return entries;
  });

  const entryReading = (entry: unknown) => extractReadingValue(entry, currentLangData()) ?? '';

  const hoverProsody = createMemo(() => {
    return resolveProsodyForHover({
      word: actualWord(),
      reading: props.token.reading,
      translationData: props.translationData,
      showProsody: prosodyVisible(settings),
      getCanonicalForm,
      getWordVariants,
      getCachedTranslation,
      language: settings.language,
      languageData: currentLangData(),
      dictionaryTargetLanguage,
      fallbackLabel: t('mlearn.CardEditor.Fields.ProsodyPosition'),
    });
  });

  const posType = createMemo(() => props.token.partOfSpeech || props.token.type || '');
  const ankiCacheOptions = createMemo(() => ({
    language: settings.language,
    languageData: currentLangData(),
  }));

  // Get level from word frequency (like old app's wordFreq[word].level)
  // Using actualWord() to properly track token changes
  const wordFreqEntry = createMemo(() => {
    const word = actualWord();
    return word ? getFrequency(word) : null;
  });

  // Anki hover preview state
  const ankiCacheReady = createMemo(() => {
    ankiCacheVersion();
    return settings.use_anki && isAnkiCacheFetched(ankiCacheOptions());
  });

  // Check if word is in Anki (synchronous, from cache)
  const wordInAnki = createMemo(() => {
    if (!settings.use_anki) return false;
    void ankiCacheReady();
    return !!findAnkiWordMatchInCache(wordForms(), ankiCacheOptions());
  });

  const ankiMatch = createMemo(() => {
    if (!settings.use_anki) return null;
    void ankiCacheReady();
    return findAnkiWordMatchInCache(wordForms(), ankiCacheOptions());
  });

  const effectiveStatus = createMemo(() => getComprehensiveWordStatusWithSourceSync(actualWord(), settings.language).status);
  const effectiveKnowledge = createMemo(() => getComprehensiveWordStatusWithSourceSync(actualWord(), settings.language));

  // Inspector claim editing: word-level claim + per-applicable-aspect rows.
  const hoverAspectStates = createMemo(() => getAvailableAspects(currentLangData() ?? undefined)
    .filter((aspect): aspect is Exclude<typeof aspect, 'meaning'> => aspect !== 'meaning')
    .map((aspect) => {
      const state = getAspectStatus(actualWord(), aspect, settings.language);
      return { aspect, status: state.status, claim: state.claim };
    }));
  // Journal for the inspector's Evidence & History tab.
  const [journalEvents, setJournalEvents] = createSignal<KnowledgeEvent[] | undefined>(undefined);
  createEffect(() => {
    const word = actualWord();
    if (!word) return;
    eventsVersion();
    void getEvents([`${settings.language}:${hashWordSync(word)}`])
      .then((log) => setJournalEvents(log))
      .catch(() => setJournalEvents([]));
  });
  // Level pill showing the language-defined frequency/proficiency level.
  // Must reactively update when word changes - use createMemo for full reactivity
  const levelPillData = createMemo(() => {
    // Force reactive tracking of the current word by accessing actualWord()
    const word = actualWord();
    if (!word) return null;
    
    // Try to get level from word frequency data first (like old app's wordFreq[word].level)
    const freq = getFrequency(word);
    if (freq) {
      // freq.level already contains the name from langdata (set in LanguageContext.parseWordFrequency)
      return {
        level: freq.raw_level,
        visualLevel: getFrequencyLevelVisualRank(freq.raw_level, getFreqLevelNames(), currentLangData()),
        name: freq.level,
      };
    }
    
    // Fallback to props.level if provided - use getLevelName from langdata
    const level = props.level;
    if (level === undefined || level < 0) return null;
    const levelName = getLevelName(level);
    return {
      level,
      visualLevel: getFrequencyLevelVisualRank(level, getFreqLevelNames(), currentLangData()),
      name: levelName,
    };
  });

  const POSPill = () => {
    const pos = posType();
    if (!pos || !settings.show_pos) return null;
    return <PillLabel>{pos}</PillLabel>;
  };

  // Flashcard pill - computed values for reactivity
  const isTracked = createMemo(() => isInSRS() || props.isInSRS === true);
  const grammarOccurrences = createMemo(() => props.grammarOccurrences ?? []);

  const [showDuplicateWarning, setShowDuplicateWarning] = createSignal(false);
  const [isStatusModalOpen, setIsStatusModalOpen] = createSignal(false);

  // Track whether any internal modal is open (prevents hide during modal interaction)
  const isInternalModalOpen = createMemo(() =>
    showDuplicateWarning() || isStatusModalOpen()
  );

  // When an internal modal opens, cancel any pending hide from the parent
  let wasBlockingHide = false;
  createEffect(() => {
    const blocking = isInternalModalOpen() || isAddingFlashcard();
    if (blocking) {
      props.onMouseEnter?.();
    } else if (wasBlockingHide && subtitleHoverRef && !subtitleHoverRef.matches(':hover')) {
      // The blocking element (modal/interactive tooltip) just closed. Its leave
      // was suppressed, so re-check: pointer outside the popover means hide now.
      props.onMouseLeave?.();
    }
    wasBlockingHide = blocking;
  });

  // Handle adding flashcard when word is already in Anki (duplicate check)
  const handleAddWithAnkiCheck = (entry?: DictionaryEntry, e?: MouseEvent) => {
    if (e) { e.preventDefault(); e.stopPropagation(); }
    if (wordInAnki() && !isTracked() && !settings.skipAnkiDuplicateWarning) {
      setShowDuplicateWarning(true);
      return;
    }
    handleAddFlashcard(entry, e).catch((err) => log.error("unhandled promise rejection", err));
  };

  const confirmDuplicateAdd = (dontRemind: boolean) => {
    setShowDuplicateWarning(false);
    if (dontRemind) {
      updateSettings({ skipAnkiDuplicateWarning: true });
    }
    handleAddFlashcard().catch((err) => log.error("unhandled promise rejection", err));
  };

  // LLM Explain pill using PillBtn component
  // Shows indicator if we have a cached explanation
  const LLMPill = () => {
    const hasCached = hasCachedExplanation();
    return (
      <PillBtn
        variant={hasCached ? 'green' : 'blue'}
        icon={ICON_BOT}
        label={t('mlearn.WordHover.Explain')}
        onClick={handleOpenExplainer}
      />
    );
  };

  const handleContentClick = (e: MouseEvent) => {
    const anchor = (e.target as HTMLElement).closest('a');
    if (!anchor) return;
    e.preventDefault();
    e.stopPropagation();
    const clone = anchor.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('rt, rp').forEach((el) => { el.remove(); });
    const text = clone.textContent?.trim();
    if (text) openWordLookup(text);
  };

  onMount(() => {
    const element = contentRef;
    if (!element) return;
    element.addEventListener('click', handleContentClick);
    onCleanup(() => element.removeEventListener('click', handleContentClick));
  });

  return (
    <div
      class="word-hover-container"
      style={hoverStyle()}
      ref={hoverRef}
    >
      <div
        class={`subtitle_hover ${isShown() ? 'show-hover' : ''} ${(settings.theme === 'dark' || settings.theme === 'glass-dark' || settings.theme === 'darker') ? 'dark' : ''}`}
        role="dialog"
        aria-label={actualWord()}
        ref={(el) => { subtitleHoverRef = el; }}
        onMouseEnter={() => props.onMouseEnter?.()}
        onMouseLeave={() => { if (!isInternalModalOpen() && !isAddingFlashcard()) props.onMouseLeave?.(); }}
      >
        <div class="subtitle_hover_relative">
           <div class="subtitle_hover_content" ref={contentRef}>
            {/* Loading state: keep the hover panel's shape while the lookup
                resolves instead of flashing a text label. */}
            <Show when={props.isLoading}>
              <div class="hover_loading" aria-busy="true">
                <SkeletonText lines={2} />
              </div>
            </Show>

            {/* Translation content */}
            <Show when={!props.isLoading}>
              <Show when={translationEntries().length > 0}>
                <For each={translationEntries()}>
                  {(entry, index) => (
                    <>
                      <Show when={index() > 0}>
                        <hr />
                      </Show>
                      <SafeHtml tag="div" class="hover_translation" html={Array.isArray(entry.definitions) ? entry.definitions.join('; ') : String(entry.definitions) || ''} />
                      <Show when={entryReading(entry)}>
                        {(reading) => <div class="hover_reading">{reading()}</div>}
                      </Show>
                    </>
                  )}
                </For>
              </Show>

              <Show when={translationEntries().length === 0 && props.dictionaryEntries && props.dictionaryEntries.length > 0}>
                <For each={props.dictionaryEntries}>
                  {(entry, index) => (
                    <>
                      <Show when={index() > 0}>
                        <hr />
                      </Show>
                      <SafeHtml tag="div" class="hover_translation" html={entry.meanings ? entry.meanings.join('; ') : ''} />
                      <Show when={entryReading(entry)}>
                        {(reading) => <div class="hover_reading">{reading()}</div>}
                      </Show>
                    </>
                  )}
                </For>
              </Show>

              <Show when={translationEntries().length === 0 && (!props.dictionaryEntries || props.dictionaryEntries.length === 0)}>
                <div class="hover_translation">{t('mlearn.WordHover.NoTranslation')}</div>
              </Show>
              <Show when={graphMeta().status === 'ready' && graphLookup()}>
                <Show when={graphLookup()!.senses.length > 0 || graphLookup()!.pronunciations.length > 0}>
                  <hr />
                  <For each={graphLookup()!.senses.slice(0, 3)}>
                    {(sense) => <div class="hover_translation">{sense.label}</div>}
                  </For>
                  <For each={graphLookup()!.pronunciations.slice(0, 2)}>
                    {(pronunciation) => <div class="hover_reading">{pronunciation.label}</div>}
                  </For>
                </Show>
              </Show>

              {/* REQ42: German compound decomposition tree */}
              <Show when={compoundAnalysis()}>
                {(analysis) => (
                  <>
                    <hr />
                    <CompoundDecomposition analysis={analysis()} t={t} />
                  </>
                )}
              </Show>

            </Show>
          </div>

          {/* Footer with pills */}
          <div class="footer">
            <div class="pills">
              <Show when={hoverProsody()?.renderer === 'inline-overlay' ? hoverProsody() : null}>
                {(prosody) => (
                  <ProsodyOverlay
                    word={actualWord()}
                    reading={prosody().reading}
                    prosodyPosition={prosody().position}
                    prosodyType={prosody().type}
                    languageData={currentLangData()}
                    pos={posType()}
                    mode="pill"
                    showParticleBox={true}
                    homogenous={true}
                  />
                )}
              </Show>
              <Show when={hoverProsody()?.renderer === 'label' ? hoverProsody() : null}>
                {(prosody) => (
                  <PillLabel variant="gray" class="prosody-position-pill">
                    <span class="prosody-position-pill__label">{prosody().label}</span>
                    <span class="prosody-position-pill__value">{prosody().value}</span>
                  </PillLabel>
                )}
              </Show>
              {/* Level pill - reactive via Show + createMemo */}
              <Show when={levelPillData()}>
                {(data) => (
                  <PillLabel level={data().level} visualLevel={data().visualLevel}>{data().name}</PillLabel>
                )}
              </Show>
              <POSPill />
              <For each={grammarOccurrences()}>
                {(occurrence) => <PillLabel variant="blue">{occurrence.realizedForm}</PillLabel>}
              </For>
              <WordStatusPill
                word={actualWord()}
                language={settings.language}
                onModalOpenChange={setIsStatusModalOpen}
              />
              <ResourcePill
                word={actualWord()}
                language={settings.language}
                isTracked={isTracked()}
                isAdding={isAddingFlashcard()}
                isInAnki={wordInAnki()}
                ankiWord={ankiMatch()?.word ?? actualWord()}
                ease={currentEase() ?? props.ease}
                effectiveStatus={effectiveStatus()}
                onAdd={handleAddToSRS}
              />
              <LLMPill />
             </div>
             <Show when={projection()?.status === 'ready' && projection()!.targets.length > 0}>
               <div class="word-hover-knowledge">
                 <KnowledgeCapabilitySummary word={actualWord()} language={settings.language} projection={projection()} />
                 <Btn variant="ghost" size="sm" onClick={() => setShowKnowledgeDetails(true)}>{t('mlearn.Knowledge.Popup.Inspect')}</Btn>
               </div>
             </Show>
           </div>
        </div>
      </div>
      <KnowledgeProjectionDrawer
        projection={projection()}
        open={showKnowledgeDetails()}
        onClose={() => setShowKnowledgeDetails(false)}
        onGraph={(entityId) => openGraphInspector({ entityId })}
        surface={actualWord()}
        events={journalEvents()}
        initialTab="targets"
        onWordClaim={(claim) => setWordClaim(actualWord(), claim, settings.language)}
        wordClaim={effectiveKnowledge().basis === 'claim' ? effectiveKnowledge().status : null}
        onAspectClaim={(aspect, claim) => {
          if (claim === null) clearAspectClaim(actualWord(), aspect, settings.language);
          else setAspectStatus(actualWord(), aspect, claim, 'manual', settings.language);
        }}
        aspectStates={hoverAspectStates()}
      />
      {/* Anki duplicate warning modal */}
      <Show when={showDuplicateWarning()}>
        <AnkiDuplicateWarningModal
          onConfirm={confirmDuplicateAdd}
          onCancel={() => setShowDuplicateWarning(false)}
        />
      </Show>
    </div>
  );
};

// Local component: Anki duplicate warning modal
const AnkiDuplicateWarningModal: Component<{
  onConfirm: (dontRemind: boolean) => void;
  onCancel: () => void;
}> = (props) => {
  const { t } = useLocalization();
  const [dontRemind, setDontRemind] = createSignal(false);

  return (
    <Modal
      isOpen={true}
      onClose={props.onCancel}
      title={t('mlearn.WordHover.AnkiDuplicateWarning.Title')}
    >
      <div class="anki-duplicate-warning">
        <p class="anki-duplicate-warning__message">
          {t('mlearn.WordHover.AnkiDuplicateWarning.Message')}
        </p>
        <div class="anki-duplicate-warning__toggle-row">
          <ToggleSwitch
            checked={dontRemind()}
            onChange={setDontRemind}
            label={t('mlearn.WordHover.AnkiDuplicateWarning.DontRemind')}
          />
        </div>
        <div class="anki-duplicate-warning__actions">
          <Btn variant="secondary" onClick={props.onCancel}>
            {t('mlearn.Global.Cancel')}
          </Btn>
          <Btn variant="primary" onClick={() => props.onConfirm(dontRemind())}>
            {t('mlearn.WordHover.AnkiDuplicateWarning.Confirm')}
          </Btn>
        </div>
      </div>
    </Modal>
  );
};

// ============ German compound decomposition tree (REQ42) ============

/** Render depth rows of the decomposition: level parts joined by '+', deeper levels behind '→'. */
export function CompoundDecomposition(props: {
  analysis: CompoundAnalysis;
  t: (key: string, params?: Record<string, string | number>) => string;
}) {
  const depthRows = createMemo(() => {
    const rows: string[] = [];
    let level = [...props.analysis.parts];
    while (level.length > 0) {
      rows.push(level.map((part) => part.lemma).join(' + '));
      level = level.flatMap((part) => [...(part.parts ?? [])]);
    }
    return rows;
  });

  return (
    <div class="hover-compound">
      <div class="hover-compound__label">{props.t('mlearn.WordHover.Compound.Title')}</div>
      <For each={depthRows()}>
        {(row, depth) => (
          <div class="hover-compound__row">{depth() > 0 ? '→ ' : ''}{row}</div>
        )}
      </For>
      <Show when={props.analysis.ambiguous}>
        <div class="hover-compound__note">{props.t('mlearn.WordHover.Compound.Ambiguous')}</div>
      </Show>
    </div>
  );
}
