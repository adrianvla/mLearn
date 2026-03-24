/**
 * Word Hover Component
 * Popup that appears when hovering over a word
 * Matches legacy .subtitle_hover structure exactly from the old app
 */

import { Component, JSX, Show, For, createMemo, createSignal, createEffect } from 'solid-js';
import type { Token, DictionaryEntry, TranslationEntry, PitchData } from '../../../shared/types';
import { WORD_STATUS } from '../../../shared/constants';
import { normalizeReading } from '../../../shared/utils/textUtils';
import { useSettings, useFlashcards, useLanguage, useLocalization } from '../../context';
import { setWordStatus, toUniqueIdentifier, wordsLearnedInApp } from '../../services/statsService';
import { getCachedExplanation } from '../../services/llmProvider';
import { fetchAnkiWordsCache, isWordInAnkiCache, isAnkiCacheFetched } from '../../services/ankiWordsCache';
import { useTokenizer } from '../../hooks/useTranslation';
import { PillBtn, PillLabel, PitchAccentOverlay, ClockIcon, AnkiHoverPreview, Modal, Btn, Tooltip, ToggleSwitch } from '../common';
import type { AnkiCardFields } from '../common';
import Icon from '../common/Icons/Icon';
import { openWordLookup } from '../../services/wordLookupService';
import {
  buildWordHoverFlashcardContent,
  extractPitchAccentFromTranslationData,
  extractReadingFromEntries,
  getAnkiEaseForStatus,
  resolveWordKnowledge,
  numericToWordStatus,
  wordStatusToNumeric,
  type WordStatus,
  type WordKnowledgeResult,
} from './wordHoverHelpers';
import type { KnowledgeSource } from '../../../shared/constants';
import { useAnki } from '../../hooks/useAnki';
import { AnkiModifyWarningModal } from '../flashcard/AnkiModifyWarningModal';
import { clipVideo } from '../../services/videoClipService';
import { getBridge } from '../../../shared/bridges';
import { showToast } from '../common/Feedback/Toast';
import './WordHover.css';

export type { WordStatus } from './wordHoverHelpers';

// Icon names for the Icon component - enables proper SVG coloring
const ICON_CROSS2 = 'cross2';
const ICON_CHECK = 'check';
const ICON_BOT = 'bot';
const ICON_ANKI = 'anki';
const ICON_MLEARN = 'mlearn-logo';

// UI element dimensions for boundary calculations (actual CSS values from reader components)
const UI_NAVBAR_HEIGHT = 48;  // .reader-nav height: 48px
const UI_SIDEBAR_WIDTH = 160; // .reader-sidebar width: 160px
const UI_STATUSBAR_HEIGHT = 30; // .reader-status height: 30px
const UI_BOUNDARY_PADDING = 12; // Small padding from UI elements

export interface WordHoverProps {
  token: Token;
  word: string;
  position: { x: number; y: number };
  anchorRect?: DOMRect;
  dictionaryEntries?: DictionaryEntry[];
  translationData?: { data?: (TranslationEntry | PitchData | null | undefined)[] };
  pitchAccent?: { position?: number; reading?: string };
  isLoading?: boolean;
  status?: WordStatus;
  level?: number;
  isInSRS?: boolean;
  ease?: number;
  contextPhrase?: string; // The subtitle text for context
  isOCR?: boolean; // Whether in OCR mode (reader) vs video mode
  ocrImageElement?: HTMLImageElement | null; // The page image element for OCR screenshot capture
  onStatusChange?: (status: WordStatus) => void;
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
}

export const WordHover: Component<WordHoverProps> = (props) => {
  const { settings, updateSettings } = useSettings();
  const { addFlashcard, hasWordSync, getCardByWordSync, trackWordStatusChange } = useFlashcards();
  const { getFrequency, getLevelName, getLanguageFeatures, currentLangData } = useLanguage();
  const { tokenize } = useTokenizer();
  const { t } = useLocalization();
  const [currentStatus, setCurrentStatus] = createSignal<WordStatus>('unknown');
  const [wordUuid, setWordUuid] = createSignal<string>('');
  // Flag to prevent effect from overwriting local isInSRS state during flashcard creation
  const [isAddingFlashcard, setIsAddingFlashcard] = createSignal(false);
  // Flag to lock position during state changes to prevent jumps
  const [, setPositionLocked] = createSignal(false);
  // Track if we have a cached explanation (for pill indicator)
  const [hasCachedExplanation, setHasCachedExplanation] = createSignal(false);
  const anki = useAnki();
  let hoverRef: HTMLDivElement | undefined;

  // Helper to get display word - track token changes
  const displayWord = createMemo(() => props.word || props.token.surface || props.token.word);
  
  // Track the actual word being displayed for reactive updates
  const actualWord = createMemo(() => props.token.actual_word || displayWord());

  const isShown = createMemo(() => props.visible !== false);
  
  // REACTIVE: Check if word is in SRS using synchronous method
  // This properly integrates with SolidJS's reactive system
  const isInSRS = createMemo(() => {
    // Early exit if we're adding a flashcard (show tracked state optimistically)
    if (isAddingFlashcard()) return true;
    
    const word = actualWord();
    if (!word) return props.isInSRS ?? false;
    
    // Use sync method for proper reactivity with store
    return hasWordSync(word) || (props.isInSRS ?? false);
  });
  
  // REACTIVE: Get flashcard for the word (if tracked)
  const currentFlashcard = createMemo(() => {
    const word = actualWord();
    if (!word) return null;
    return getCardByWordSync(word);
  });
  
  // REACTIVE: Get current ease from flashcard if tracked
  const currentEase = createMemo(() => {
    const card = currentFlashcard();
    if (card) {
      return card.ease;
    }
    return props.ease;
  });
  
  // Load word status from storage on mount or when word changes
  // This loads the manual status (separate from flashcard-derived status)
  createEffect(() => {
    const word = actualWord(); // Use actualWord for status lookup (like old app)
    if (!word) return;
    
    // Access the signal to make this effect reactive to word status changes
    const allWordStatuses = wordsLearnedInApp();
    
    // Async IIFE to generate UUID (only needed for extractExampleHtml)
    (async () => {
      try {
        const uuid = await toUniqueIdentifier(word);
        setWordUuid(uuid);
        
        // Get manual status from storage using word (not uuid) - matches old app
        // This is the base status before considering flashcard state
        const storedStatus = allWordStatuses[word] ?? WORD_STATUS.UNKNOWN;
        setCurrentStatus(numericToWordStatus(storedStatus));
      } catch (e) {
        console.error('Failed to load word status:', e);
        setCurrentStatus(props.status || 'unknown');
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

  // Computed position signal - updated after render when dimensions are known
  const [computedPosition, setComputedPosition] = createSignal<{ left: number; top: number }>({ left: 0, top: 0 });

  // Get the actual rendered dimensions from CSS (width is fit-content, capped at 400px)
  const getHoverDimensions = (): { width: number; height: number } => {
    const subtitleHover = hoverRef?.querySelector('.subtitle_hover') as HTMLElement | null;
    if (!subtitleHover) return { width: 280, height: 200 };
    return {
      width: subtitleHover.offsetWidth || 280,
      height: subtitleHover.offsetHeight || 200,
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

  // Effect to update position after render when dimensions are available
  createEffect(() => {
    // Track dependencies: when these change, recalculate position
    const visible = isShown();
    // Access props to establish reactive dependencies
    void props.anchorRect;
    void props.position.x;
    void props.position.y;
    
    if (!visible) return;
    
    // Use requestAnimationFrame to ensure DOM has painted
    requestAnimationFrame(() => {
      const { width, height } = getHoverDimensions();
      const newPos = calculateBoundedPosition(width, height);
      
      // Debug logging (uncomment and add `const bounds = getUIBounds();` to enable)
      // console.log(
      //   `%c[WordHover] Position Debug:%c\n` +
      //   `  Hover size: ${width}×${height}px\n` +
      //   `  Position: (${newPos.left}, ${newPos.top})`,
      //   'color: #00bcd4; font-weight: bold;',
      //   'color: #aaa;'
      // );
      
      setComputedPosition(newPos);
    });
  });

  const hoverStyle = createMemo((): JSX.CSSProperties => {
    const pos = computedPosition();

    return {
      position: 'fixed',
      left: `${pos.left}px`,
      top: `${pos.top}px`,
    };
  });


  const applyStatusChange = (overrideStatus?: WordStatus, skipAnki = false) => {
    let newStatus: WordStatus;
    if (overrideStatus) {
      newStatus = overrideStatus;
    } else {
      const statusOrder: WordStatus[] = ['unknown', 'learning', 'known'];
      const currentIdx = statusOrder.indexOf(currentStatus());
      const nextIdx = (currentIdx + 1) % statusOrder.length;
      newStatus = statusOrder[nextIdx];
    }
    
    setCurrentStatus(newStatus);
    
    // Use actualWord (the dictionary form) for status storage - matches old app
    const word = actualWord();
    if (word) {
      setWordStatus(word, wordStatusToNumeric(newStatus));
      trackWordStatusChange(word);
    }
    
    // If the word is in Anki and status isn't unknown, update the Anki card
    if (!skipAnki && wordInAnki() && settings.use_anki && newStatus !== 'unknown') {
      const ankiEase = getAnkiEaseForStatus(newStatus, settings.ankiLearningEase, settings.ankiKnownEase);
      anki.updateWordCards(word, ankiEase).then(result => {
        if (result.updated > 0) {
          const msg = result.repositioned > 0
            ? t('mlearn.WordHover.AnkiUpdateRepositioned', { count: String(result.updated), repositioned: String(result.repositioned) })
            : t('mlearn.WordHover.AnkiUpdateSuccess', { count: String(result.updated) });
          showToast({ message: msg, variant: 'success' });
        }
      }).catch(() => {
        showToast({ message: t('mlearn.WordHover.AnkiUpdateFailed'), variant: 'error' });
      });
    }
    
    props.onStatusChange?.(newStatus);
  };

  const handleStatusChange = async (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    // If word is in Anki, show the Anki warning first (before any status-source warning)
    if (wordInAnki() && settings.use_anki && !settings.skipAnkiModifyWarning) {
      const statusOrder: WordStatus[] = ['unknown', 'learning', 'known'];
      const currentIdx = statusOrder.indexOf(currentStatus());
      const nextIdx = (currentIdx + 1) % statusOrder.length;
      setPendingAnkiStatus(statusOrder[nextIdx]);
      setShowAnkiModifyWarning(true);
      return;
    }

    if (dataSources().some(s => s !== 'manual') && !settings.skipStatusSourceWarning) {
      setShowStatusSourceWarning(true);
      return;
    }

    applyStatusChange();
  };

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
      console.log('%cFlashcard add request blocked - already adding', 'color: orange;');
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
          level: freq?.raw_level ?? props.level ?? -1,
          manualStatus: currentStatus(),
          colourCodes: settings.colour_codes || currentLangData()?.colour_codes || {},
          ocrCropPadding: settings.ocr_crop_padding,
          tokenize,
          flashcardMediaType: isVideoMode ? 'video' : 'image',
          srsLearningEase: settings.srsLearningEase,
          srsKnownEase: settings.srsKnownEase,
        });

        // If video mode, clip and save the video segment
        if (isVideoMode && props.videoSrc && props.subtitleStart != null && props.subtitleEnd != null) {
          const margin = (settings.flashcardVideoMargin ?? 300) / 1000;
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

        await addFlashcard(content, ease);
        // isInSRS and currentEase are now reactive memos that will update automatically
        // when the flashcard is added to the store via BroadcastChannel sync
      } catch (err) {
        console.error('Failed to add flashcard:', err);
        alert(t('mlearn.WordHover.Errors.FailedToAddFlashcard', { error: String(err) }));
      } finally {
        // Always clear the adding flag when done
        setIsAddingFlashcard(false);
      }
    }
  };

  const handleAddToSRS = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
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
    if (!settings.llmEnabled) {
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

  // Extract pitch accent info from translation data
  // Server returns: data[2] = ["word", "pitch_type", { pitches: [{ position: N }] }]
  const pitchAccentFromData = createMemo(() => {
    const features = getLanguageFeatures();
    if (!features.supportsPitchAccent || !settings.showPitchAccent) return null;
    
    const data = props.translationData?.data;
    if (!data || !Array.isArray(data)) return null;
    
    // Get reading from first entry
    const reading = normalizeReading(extractReadingFromEntries(data));
    if (!reading || reading.length <= 1) return null;
    
    // Get pitch position - data[2] is the pitch entry
    // Format: ["word", "pitch", { pitches: [{ position: N }] }] or just { pitches: [...] }
    const position = extractPitchAccentFromTranslationData(props.translationData) ?? null;
    
    if (position === null) return null;
    
    return { position, reading };
  });

  // Use provided pitchAccent or extract from translation data
  const effectivePitchAccent = createMemo(() => {
    return props.pitchAccent ?? pitchAccentFromData();
  });

  const posType = () => props.token.partOfSpeech || props.token.type || '';

  // Get level from word frequency (like old app's wordFreq[word].level)
  // Using actualWord() to properly track token changes
  const wordFreqEntry = createMemo(() => {
    const word = actualWord();
    return word ? getFrequency(word) : null;
  });

  // Anki hover preview state
  const [ankiCacheReady, setAnkiCacheReady] = createSignal(isAnkiCacheFetched());

  // Fetch Anki words cache once when use_anki is enabled
  createEffect(() => {
    if (settings.use_anki && !isAnkiCacheFetched()) {
      fetchAnkiWordsCache().then(() => setAnkiCacheReady(true));
    }
  });

  // Check if word is in Anki (synchronous, from cache)
  const wordInAnki = createMemo(() => {
    if (!settings.use_anki) return false;
    void ankiCacheReady();
    return isWordInAnkiCache(actualWord());
  });

  // Resolve word knowledge from all sources using the configured strategy
  const wordKnowledge = createMemo<WordKnowledgeResult>(() =>
    resolveWordKnowledge(
      currentFlashcard(), currentStatus(), wordInAnki(),
      settings.knowledgeSourceOrder, settings.knowledgeResolutionMode,
    )
  );

  const activeSources = createMemo<KnowledgeSource[]>(() => wordKnowledge().activeSources);
  const dataSources = createMemo<KnowledgeSource[]>(() => wordKnowledge().dataSources);
  const effectiveStatus = createMemo(() => wordKnowledge().status);

  // Status pill derived values - fully reactive
  const statusVariant = createMemo(() => {
    const status = effectiveStatus();
    return status === 'unknown' ? 'red' : status === 'learning' ? 'orange' : 'green';
  });
  
  const statusIcon = createMemo(() => {
    const status = effectiveStatus();
    return status === 'unknown' ? ICON_CROSS2 : ICON_CHECK;
  });
  
  const statusLabel = createMemo(() => {
    const status = effectiveStatus();
    return status === 'unknown' 
      ? t('mlearn.WordHover.Status.Unknown') 
      : status === 'learning' 
        ? t('mlearn.WordHover.Status.Learning') 
        : t('mlearn.WordHover.Status.Known');
  });

  // Level pill showing JLPT/frequency level from langdata (not hardcoded!)
  // Must reactively update when word changes - use createMemo for full reactivity
  const levelPillData = createMemo(() => {
    // Force reactive tracking of the current word by accessing actualWord()
    const word = actualWord();
    if (!word) return null;
    
    // Try to get level from word frequency data first (like old app's wordFreq[word].level)
    const freq = getFrequency(word);
    if (freq) {
      // freq.level already contains the name from langdata (set in LanguageContext.parseWordFrequency)
      return { level: freq.raw_level, name: freq.level };
    }
    
    // Fallback to props.level if provided - use getLevelName from langdata
    const level = props.level;
    if (level === undefined || level < 0) return null;
    const levelName = getLevelName(level);
    return { level, name: levelName };
  });

  const POSPill = () => {
    const pos = posType();
    if (!pos || !settings.show_pos) return null;
    return <PillLabel>{pos}</PillLabel>;
  };

  // Flashcard pill - computed values for reactivity
  const isTracked = createMemo(() => isInSRS() || props.isInSRS === true);

  // Anki hover preview state (signals only — cache effect and wordInAnki are declared above)
  const [ankiHoverCard, setAnkiHoverCard] = createSignal<AnkiCardFields | null>(null);
  const [ankiHoverLoading, setAnkiHoverLoading] = createSignal(false);
  const [showDuplicateWarning, setShowDuplicateWarning] = createSignal(false);
  let ankiHoverFetched = false;
  let previousAnkiWord = '';

  const statusSourceLabel = createMemo(() => {
    const sources = activeSources();
    const prefix = t('mlearn.WordHover.StatusSource.Prefix');
    if (sources.length === 0) return prefix + t('mlearn.WordHover.StatusSource.None');
    return prefix + sources
      .map(s => t(`mlearn.Settings.KnowledgePriority.Source.${s[0].toUpperCase() + s.slice(1)}`))
      .join(' + ');
  });

  const [showStatusSourceWarning, setShowStatusSourceWarning] = createSignal(false);
  const [showAnkiModifyWarning, setShowAnkiModifyWarning] = createSignal(false);
  // Pending status change to apply after the Anki modify warning is confirmed
  const [pendingAnkiStatus, setPendingAnkiStatus] = createSignal<WordStatus | null>(null);
  // Whether the pending status change should skip updating Anki (built-in only)
  const [pendingSkipAnki, setPendingSkipAnki] = createSignal(false);

  // Track whether any internal modal is open (prevents hide during modal interaction)
  const isInternalModalOpen = createMemo(() =>
    showDuplicateWarning() || showStatusSourceWarning() || showAnkiModifyWarning()
  );

  // When an internal modal opens, cancel any pending hide from the parent
  createEffect(() => {
    if (isInternalModalOpen() || isAddingFlashcard()) {
      props.onMouseEnter?.();
    }
  });

  const fetchAnkiCardForHover = async () => {
    const word = actualWord();
    if (ankiHoverFetched && previousAnkiWord === word) return;
    ankiHoverFetched = true;
    previousAnkiWord = word;
    setAnkiHoverLoading(true);
    try {
      const { getBackend } = await import('../../../shared/backends');
      const result = await getBackend().getCard({ word }) as { cards: { fields: AnkiCardFields }[]; error: boolean; poor: boolean };
      if (!result.error && !result.poor && result.cards.length > 0) {
        setAnkiHoverCard(result.cards[0].fields || null);
      } else {
        setAnkiHoverCard(null);
      }
    } catch {
      setAnkiHoverCard(null);
    } finally {
      setAnkiHoverLoading(false);
    }
  };

  const handleAnkiTooltipShow = () => {
    if (!settings.use_anki) return;
    fetchAnkiCardForHover();
  };

  // Handle adding flashcard when word is already in Anki (duplicate check)
  const handleAddWithAnkiCheck = (entry?: DictionaryEntry, e?: MouseEvent) => {
    if (e) { e.preventDefault(); e.stopPropagation(); }
    if (wordInAnki() && !isTracked() && !settings.skipAnkiDuplicateWarning) {
      setShowDuplicateWarning(true);
      return;
    }
    handleAddFlashcard(entry, e).catch(console.error);
  };

  const confirmDuplicateAdd = (dontRemind: boolean) => {
    setShowDuplicateWarning(false);
    if (dontRemind) {
      updateSettings({ skipAnkiDuplicateWarning: true });
    }
    handleAddFlashcard().catch(console.error);
  };

  const confirmStatusSourceChange = (dontRemind: boolean) => {
    setShowStatusSourceWarning(false);
    if (dontRemind) {
      updateSettings({ skipStatusSourceWarning: true });
    }
    const skipAnki = pendingSkipAnki();
    setPendingSkipAnki(false);
    const pending = pendingAnkiStatus();
    setPendingAnkiStatus(null);
    applyStatusChange(pending ?? undefined, skipAnki);
  };

  const confirmAnkiModify = (dontRemind: boolean) => {
    setShowAnkiModifyWarning(false);
    if (dontRemind) {
      updateSettings({ skipAnkiModifyWarning: true });
    }
    if (dataSources().some(s => s !== 'manual') && !settings.skipStatusSourceWarning) {
      setShowStatusSourceWarning(true);
      return;
    }
    const pending = pendingAnkiStatus();
    setPendingAnkiStatus(null);
    applyStatusChange(pending ?? undefined, false);
  };

  const confirmAnkiModifyBuiltInOnly = () => {
    setShowAnkiModifyWarning(false);
    if (dataSources().some(s => s !== 'manual') && !settings.skipStatusSourceWarning) {
      setPendingSkipAnki(true);
      setShowStatusSourceWarning(true);
      return;
    }
    const pending = pendingAnkiStatus();
    setPendingAnkiStatus(null);
    applyStatusChange(pending ?? undefined, true);
  };

  const EasePill = () => {
    const ease = currentEase() ?? props.ease;
    const easeLabel = () => ease === undefined
      ? t('mlearn.Flashcards.Card.Tracked')
      : `${t('mlearn.Flashcards.Card.Ease')} ${Math.round((ease ?? 0) * 100) / 100}`;

    const tooltipContent = () => {
      const parts: string[] = [];
      if (ease !== undefined) {
        parts.push(`${t('mlearn.Flashcards.Card.Ease')} ${Math.round(ease * 100) / 100}`);
      }
      if (wordInAnki()) {
        const ankiEase = getAnkiEaseForStatus(effectiveStatus(), settings.ankiLearningEase, settings.ankiKnownEase);
        parts.push(t('mlearn.WordHover.AnkiEase', { ease: String(ankiEase) }));
      }
      return parts.join(' | ');
    };

    const dualIcon = () => (
      <div style={{ display: 'flex', gap:'var(--spacing-1)'}}>
        <Icon icon={ICON_MLEARN} color="currentColor" class="btn-svg-icon" />
        <Icon icon={ICON_ANKI} color="currentColor" class="btn-svg-icon" />
      </div>
    );

    const pillIcon = () => wordInAnki() ? dualIcon() : ICON_MLEARN;

    return (
      <Show when={wordInAnki()} fallback={
        <PillBtn
          variant="green"
          icon={ICON_MLEARN}
          label={easeLabel()}
        />
      }>
        <Tooltip
          content={
            <AnkiHoverPreview
              loading={ankiHoverLoading()}
              fields={ankiHoverCard()}
              footer={<div class="anki-hover-preview__footer">{tooltipContent()}</div>}
            />
          }
          onShow={handleAnkiTooltipShow}
        >
          <PillBtn
            variant="green"
            icon={pillIcon()}
            label={easeLabel()}
          />
        </Tooltip>
      </Show>
    );
  };

  // Anki-only pill: shown when word is in Anki but NOT in built-in SRS
  const AnkiOnlyPill = () => (
    <Tooltip
      content={
        <AnkiHoverPreview
          loading={ankiHoverLoading()}
          fields={ankiHoverCard()}
          footer={<div class="anki-hover-preview__footer">{t('mlearn.WordHover.AddToBuiltInSrs')}</div>}
        />
      }
      onShow={handleAnkiTooltipShow}
    >
      <span onClick={(e: MouseEvent) => handleAddWithAnkiCheck(undefined, e)}>
        <PillBtn
          variant="blue"
          icon={ICON_ANKI}
          label={t('mlearn.WordHover.InAnki')}
          style={{ height: "100%"}}
        />
      </span>
    </Tooltip>
  );

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

  // Pitch accent data for PitchAccentOverlay pill
  const pitchPillReading = createMemo(() => {
    const pitch = effectivePitchAccent();
    return pitch?.reading || '';
  });

  const pitchPillPosition = createMemo(() => {
    const pitch = effectivePitchAccent();
    return pitch?.position ?? null;
  });

  return (
    <div
      class="word-hover-container"
      style={hoverStyle()}
      ref={hoverRef}
    >
      <div
        class={`subtitle_hover ${isShown() ? 'show-hover' : ''} ${(settings.theme === 'dark' || settings.theme === 'glass-dark' || settings.theme === 'darker') ? 'dark' : ''}`}
        onMouseEnter={() => props.onMouseEnter?.()}
        onMouseLeave={() => { if (!isInternalModalOpen() && !isAddingFlashcard()) props.onMouseLeave?.(); }}
      >
        <div class="subtitle_hover_relative">
          <div class="subtitle_hover_content" onClick={(e) => {
            const anchor = (e.target as HTMLElement).closest('a');
            if (!anchor) return;
            e.preventDefault();
            e.stopPropagation();
            const text = anchor.textContent?.trim();
            if (text) openWordLookup(text);
          }}>
            {/* Loading state */}
            <Show when={props.isLoading}>
              <div class="hover_loading">{t('mlearn.WordHover.Loading')}</div>
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
                      <div class="hover_translation" innerHTML={Array.isArray(entry.definitions) ? entry.definitions.join('; ') : String(entry.definitions) || ''} />
                      <Show when={entry.reading}>
                        <div class="hover_reading">{entry.reading}</div>
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
                      <div class="hover_translation" innerHTML={entry.meanings ? entry.meanings.join('; ') : ''} />
                      <Show when={entry.reading}>
                        <div class="hover_reading">{entry.reading}</div>
                      </Show>
                    </>
                  )}
                </For>
              </Show>

              <Show when={translationEntries().length === 0 && (!props.dictionaryEntries || props.dictionaryEntries.length === 0)}>
                <div class="hover_translation">{t('mlearn.WordHover.NoTranslation')}</div>
              </Show>
            </Show>
          </div>

          {/* Footer with pills */}
          <div class="footer">
            <div class="pills">
              {/* Pitch accent pill */}
              <PitchAccentOverlay
                word={actualWord()}
                reading={pitchPillReading()}
                pitchPosition={pitchPillPosition()}
                pos={posType()}
                mode="pill"
                showParticleBox={true}
                homogenous={true}
              />
              {/* Level pill - reactive via Show + createMemo */}
              <Show when={levelPillData()}>
                {(data) => (
                  <PillLabel level={data().level}>{data().name}</PillLabel>
                )}
              </Show>
              <POSPill />
              {/* Status pill - directly reactive using memos */}
              <Tooltip
                content={<span class="tooltip-text">{statusSourceLabel()}</span>}
              >
                <PillBtn
                  variant={statusVariant()}
                  icon={statusIcon()}
                  label={statusLabel()}
                  onClick={handleStatusChange}
                />
              </Tooltip>
              {/* Flashcard pill - uses Show for proper Solid.js reactivity */}
              <Show when={isTracked()} fallback={
                <Show when={isAddingFlashcard()} fallback={
                  <Show when={wordInAnki() && !isTracked()} fallback={
                    <PillBtn
                      variant="blue"
                      icon={settings.use_anki && !settings.enable_flashcard_creation ? ICON_ANKI : ICON_CROSS2}
                      iconRotation={settings.use_anki && !settings.enable_flashcard_creation ? undefined : 45}
                      label={settings.use_anki && !settings.enable_flashcard_creation ? t('mlearn.WordHover.AddToAnki') : t('mlearn.Global.Flashcard')}
                      onClick={handleAddToSRS}
                    />
                  }>
                    <AnkiOnlyPill />
                  </Show>
                }>
                  <PillBtn
                    variant="yellow"
                    icon={<ClockIcon size={14} />}
                    label={t('mlearn.Global.Status.Adding')}
                    disabled={true}
                  />
                </Show>
              }>
                <EasePill />
              </Show>
              <LLMPill />
            </div>
          </div>
        </div>
      </div>
      {/* Anki duplicate warning modal */}
      <Show when={showDuplicateWarning()}>
        <AnkiDuplicateWarningModal
          onConfirm={confirmDuplicateAdd}
          onCancel={() => setShowDuplicateWarning(false)}
        />
      </Show>
      {/* Status source warning modal */}
      <Show when={showStatusSourceWarning()}>
        <StatusSourceWarningModal
          onConfirm={confirmStatusSourceChange}
          onCancel={() => setShowStatusSourceWarning(false)}
        />
      </Show>
      {/* Anki modify warning modal */}
      <AnkiModifyWarningModal
        isOpen={showAnkiModifyWarning()}
        title={t('mlearn.WordHover.AnkiModifyWarning.Title')}
        message={t('mlearn.WordHover.AnkiModifyWarning.Message')}
        confirmText={t('mlearn.WordHover.AnkiModifyWarning.Confirm')}
        onConfirm={confirmAnkiModify}
        onConfirmBuiltInOnly={confirmAnkiModifyBuiltInOnly}
        onCancel={() => { setShowAnkiModifyWarning(false); setPendingAnkiStatus(null); setPendingSkipAnki(false); }}
      />
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

// Local component: Status source warning modal
const StatusSourceWarningModal: Component<{
  onConfirm: (dontRemind: boolean) => void;
  onCancel: () => void;
}> = (props) => {
  const { t } = useLocalization();
  const [dontRemind, setDontRemind] = createSignal(false);

  return (
    <Modal
      isOpen={true}
      onClose={props.onCancel}
      title={t('mlearn.WordHover.StatusSourceWarning.Title')}
    >
      <div class="anki-duplicate-warning">
        <p class="anki-duplicate-warning__message">
          {t('mlearn.WordHover.StatusSourceWarning.Message')}
        </p>
        <div class="anki-duplicate-warning__toggle-row">
          <ToggleSwitch
            checked={dontRemind()}
            onChange={setDontRemind}
            label={t('mlearn.WordHover.StatusSourceWarning.DontRemind')}
          />
        </div>
        <div class="anki-duplicate-warning__actions">
          <Btn variant="secondary" onClick={props.onCancel}>
            {t('mlearn.Global.Cancel')}
          </Btn>
          <Btn variant="primary" onClick={() => props.onConfirm(dontRemind())}>
            {t('mlearn.WordHover.StatusSourceWarning.Confirm')}
          </Btn>
        </div>
      </div>
    </Modal>
  );
};
