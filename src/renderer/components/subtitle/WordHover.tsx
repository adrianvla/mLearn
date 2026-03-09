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
import { useTokenizer } from '../../hooks/useTranslation';
import { PillBtn, PillLabel, PitchAccentOverlay, ClockIcon } from '../common';
import {
  buildWordHoverFlashcardContent,
  extractPitchAccentFromTranslationData,
  extractReadingFromEntries,
  getEffectiveWordStatus,
  numericToWordStatus,
  wordStatusToNumeric,
  type WordStatus,
} from './wordHoverHelpers';
import './WordHover.css';

export type { WordStatus } from './wordHoverHelpers';

// Icon names for the Icon component - enables proper SVG coloring
const ICON_CROSS2 = 'cross2';
const ICON_CHECK = 'check';
const ICON_BOT = 'bot';

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
}

export const WordHover: Component<WordHoverProps> = (props) => {
  const { settings } = useSettings();
  const { addFlashcard, hasWordSync, getCardByWordSync } = useFlashcards();
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
  
  // REACTIVE: Compute effective status by combining manual status and flashcard state
  // If word has a flashcard in learning/relearning state → Learning
  // If word has a flashcard in review state → Known
  // Otherwise, use manually set status from wordsLearnedInApp
  const effectiveStatus = createMemo(() => getEffectiveWordStatus(currentFlashcard(), currentStatus()));

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
      'z-index': '1000',
    };
  });


  const handleStatusChange = async (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    const statusOrder: WordStatus[] = ['unknown', 'learning', 'known'];
    const currentIdx = statusOrder.indexOf(currentStatus());
    const nextIdx = (currentIdx + 1) % statusOrder.length;
    const newStatus = statusOrder[nextIdx];
    
    setCurrentStatus(newStatus);
    
    // Use actualWord (the dictionary form) for status storage - matches old app
    const word = actualWord();
    if (word) {
      setWordStatus(word, wordStatusToNumeric(newStatus));
      // saveWordsToStorage is called inside setWordStatus now
    }
    
    props.onStatusChange?.(newStatus);
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
        });
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
      // Await the async function and catch any errors
      handleAddFlashcard(undefined, e).catch((err) => {
        console.error('handleAddFlashcard failed:', err);
      });
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

  // Status pill derived values - fully reactive
  // Uses effectiveStatus which combines flashcard state with manual status
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

  const EasePill = () => {
    return (
      <Show when={(currentEase() ?? props.ease) !== undefined}>
        <div class="ease-indicator">
          <span>{t('mlearn.Flashcards.Card.Ease')} {Math.round((currentEase() ?? props.ease ?? 0) * 100) / 100}</span>
        </div>
      </Show>
    );
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
        onMouseLeave={() => props.onMouseLeave?.()}
      >
        <div class="subtitle_hover_relative">
          <div class="subtitle_hover_content">
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
              <PillBtn
                variant={statusVariant()}
                icon={statusIcon()}
                label={statusLabel()}
                onClick={handleStatusChange}
              />
              {/* Flashcard pill - uses Show for proper Solid.js reactivity */}
              <Show when={isTracked()} fallback={
                <Show when={isAddingFlashcard()} fallback={
                  <PillBtn
                    variant="blue"
                    icon={ICON_CROSS2}
                    iconRotation={45}
                    label={t('mlearn.Global.Flashcard')}
                    onClick={handleAddToSRS}
                  />
                }>
                  <PillBtn
                    variant="yellow"
                    icon={<ClockIcon size={14} />}
                    label={t('mlearn.Global.Status.Adding')}
                    disabled={true}
                  />
                </Show>
              }>
                <PillBtn
                  variant="green"
                  icon={ICON_CHECK}
                  label={t('mlearn.Flashcards.Card.Tracked')}
                />
              </Show>
              <Show when={isTracked()}>
                <EasePill />
              </Show>
              <LLMPill />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
