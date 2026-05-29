/**
 * Word Hover Component
 * Popup that appears when hovering over a word
 * Matches legacy .subtitle_hover structure exactly from the old app
 */

import { Component, JSX, Show, For, createMemo, createSignal, createEffect } from 'solid-js';
import { DEFAULT_SETTINGS, type Token, type DictionaryEntry, type TranslationEntry, type PitchData } from '../../../shared/types';
import { normalizeReading } from '../../../shared/utils/textUtils';
import { useSettings, useFlashcards, useLanguage, useLocalization } from '../../context';
import { toUniqueIdentifier } from '../../services/statsService';
import { getCachedExplanation } from '../../services/llmProvider';
import { fetchAnkiWordsCache, findAnkiWordMatchInCache, isAnkiCacheFetched } from '../../services/ankiWordsCache';
import { useTokenizer } from '../../hooks/useTranslation';
import { PillBtn, PillLabel, PitchAccentOverlay, Modal, Btn, ToggleSwitch } from '../common';
import { ResourcePill, WordStatusPill } from '../common/Smart';
import { openWordLookup } from '../../services/wordLookupService';
import {
  buildWordHoverFlashcardContent,
  extractPitchAccentFromTranslationData,
  extractReadingFromEntries,
  type WordStatus,
} from './wordHoverHelpers';
import { clipVideo } from '../../services/videoClipService';
import { getBridge } from '../../../shared/bridges';
import { showToast } from '../common/Feedback/Toast';
import { getWordFormCandidates } from '../../utils/wordForms';
import './WordHover.css';
import { getLogger } from '../../../shared/utils/logger';

const log = getLogger("renderer.components.wordHover");

export type { WordStatus } from './wordHoverHelpers';

// Icon names for the Icon component - enables proper SVG coloring
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
  /** Subtitle start time in seconds (for video clip flashcards) */
  subtitleStart?: number;
  /** Subtitle end time in seconds (for video clip flashcards) */
  subtitleEnd?: number;
  /** Video source URL (for video clip flashcards) */
  videoSrc?: string;
  lastScreenshot?: string;
}

export const WordHover: Component<WordHoverProps> = (props) => {
  const { settings, updateSettings } = useSettings();
  const { addFlashcard, hasWordSync, getCardByWordSync, getComprehensiveWordStatusSync } = useFlashcards();
  const { getFrequency, getLevelName, getLanguageFeatures, currentLangData, getCanonicalForm, getWordVariants } = useLanguage();
  const { tokenize } = useTokenizer({ language: settings.language });
  const { t } = useLocalization();
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

  const wordForms = createMemo(() => getWordFormCandidates(actualWord(), getCanonicalForm, getWordVariants));
  
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
          level: freq?.raw_level ?? props.level ?? -1,
          wordStatus: effectiveStatus(),
          colourCodes: settings.colour_codes || currentLangData()?.colour_codes || {},
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

        await addFlashcard(content, ease);
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
    if (!reading || reading.length === 0) return null;
    
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

  const posType = createMemo(() => props.token.partOfSpeech || props.token.type || '');

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
    return !!findAnkiWordMatchInCache(wordForms());
  });

  const ankiMatch = createMemo(() => {
    if (!settings.use_anki) return null;
    void ankiCacheReady();
    return findAnkiWordMatchInCache(wordForms());
  });

  const effectiveStatus = createMemo(() => getComprehensiveWordStatusSync(actualWord()));

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

  const [showDuplicateWarning, setShowDuplicateWarning] = createSignal(false);
  const [isStatusModalOpen, setIsStatusModalOpen] = createSignal(false);

  // Track whether any internal modal is open (prevents hide during modal interaction)
  const isInternalModalOpen = createMemo(() =>
    showDuplicateWarning() || isStatusModalOpen()
  );

  // When an internal modal opens, cancel any pending hide from the parent
  createEffect(() => {
    if (isInternalModalOpen() || isAddingFlashcard()) {
      props.onMouseEnter?.();
    }
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
        ref={(el) => { subtitleHoverRef = el; }}
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
              <WordStatusPill
                word={actualWord()}
                onStatusChange={props.onStatusChange}
                onModalOpenChange={setIsStatusModalOpen}
              />
              <ResourcePill
                word={actualWord()}
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
