/**
 * Word Hover Component
 * Popup that appears when hovering over a word
 * Matches legacy .subtitle_hover structure exactly from the old app
 */

import { Component, JSX, Show, For, createMemo, createSignal, createEffect } from 'solid-js';
import type { Token, DictionaryEntry, TranslationEntry, PitchData, FlashcardContent } from '../../../shared/types';
import { WORD_STATUS } from '../../../shared/constants';
import { normalizeReading } from '../../../shared/utils/textUtils';
import { useSettings, useFlashcards, useLanguage, useLocalization } from '../../context';
import { setWordStatus, toUniqueIdentifier, wordsLearnedInApp } from '../../services/statsService';
import { getCachedExplanation } from '../../services/llmProvider';
import { tokensToColoredHtml } from '../../utils/subtitleParsing';
import { useTokenizer } from '../../hooks/useTranslation';
import { PillBtn, PillLabel, PitchAccentOverlay } from '../common';
import './WordHover.css';

// Icon names for the Icon component - enables proper SVG coloring
const ICON_CROSS2 = 'cross2';
const ICON_CHECK = 'check';
const ICON_BOT = 'bot';

// UI element dimensions for boundary calculations (actual CSS values from reader components)
const UI_NAVBAR_HEIGHT = 48;  // .reader-nav height: 48px
const UI_SIDEBAR_WIDTH = 160; // .reader-sidebar width: 160px
const UI_STATUSBAR_HEIGHT = 30; // .reader-status height: 30px
const UI_BOUNDARY_PADDING = 12; // Small padding from UI elements

export type WordStatus = 'unknown' | 'learning' | 'known';

// Convert numeric status to string status
function numericToWordStatus(num: number): WordStatus {
  switch (num) {
    case WORD_STATUS.LEARNING: return 'learning';
    case WORD_STATUS.KNOWN: return 'known';
    default: return 'unknown';
  }
}

// Convert string status to numeric status
function wordStatusToNumeric(status: WordStatus): number {
  switch (status) {
    case 'learning': return WORD_STATUS.LEARNING;
    case 'known': return WORD_STATUS.KNOWN;
    default: return WORD_STATUS.UNKNOWN;
  }
}

// Helper to extract reading from translation entries
function extractReadingFromEntries(entries: any[]): string {
  if (!Array.isArray(entries)) return '';
  for (const entry of entries) {
    if (entry && typeof entry.reading === 'string' && entry.reading) {
      return entry.reading;
    }
  }
  return '';
}

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
  const effectiveStatus = createMemo((): WordStatus => {
    const card = currentFlashcard();
    
    // If we have a flashcard, derive status from its state
    if (card) {
      if (card.state === 'new' || card.state === 'learning' || card.state === 'relearning') {
        return 'learning';
      }
      if (card.state === 'review') {
        // Mature cards (large intervals) are "known"
        return 'known';
      }
    }
    
    // Fall back to manually-set status
    return currentStatus();
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
    
    // Check for sidebar - it's rendered via <Show> so we check for the element directly
    const sidebarEl = document.querySelector('.reader-sidebar');
    const hasSidebar = !!sidebarEl;
    const sidebarWidth = sidebarEl ? (sidebarEl as HTMLElement).offsetWidth || UI_SIDEBAR_WIDTH : 0;
    
    // Check for statusbar - look for actual reader-status element
    const statusbarEl = document.querySelector('.reader-status, .reader-status-bar');
    const hasStatusbar = !!statusbarEl;
    const statusbarHeight = statusbarEl ? (statusbarEl as HTMLElement).offsetHeight || UI_STATUSBAR_HEIGHT : 0;
    
    // Calculate safe bounds with small padding
    const minX = (hasSidebar ? sidebarWidth : 0) + UI_BOUNDARY_PADDING;
    const maxX = vw - UI_BOUNDARY_PADDING;
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

  // Helper function to capture video screenshot (like old app's screenshotVideo)
  const screenshotVideo = (): string => {
    try {
      const video = document.querySelector('video') as HTMLVideoElement | null;
      if (!video) {
        console.warn('screenshotVideo: No video element found');
        return '';
      }
      
      // Check if video has loaded enough data
      if (video.readyState < 2) {
        console.warn('screenshotVideo: Video not ready yet (readyState:', video.readyState, ')');
        return '';
      }
      
      // Use fixed width of 480 and scale height proportionally (like old app)
      const targetWidth = 480;
      const videoWidth = video.videoWidth || video.clientWidth || 640;
      const videoHeight = video.videoHeight || video.clientHeight || 360;
      
      if (videoWidth === 0 || videoHeight === 0) {
        console.warn('screenshotVideo: Video dimensions are zero');
        return '';
      }
      
      const targetHeight = Math.round(videoHeight * (targetWidth / videoWidth));
      
      const canvas = document.createElement('canvas');
      canvas.width = targetWidth;
      canvas.height = targetHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        console.warn('screenshotVideo: Failed to get canvas context');
        return '';
      }
      
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      
      // Try to get the data URL - this might fail with cross-origin videos
      try {
        const dataUrl = canvas.toDataURL('image/jpeg', 0.5);
        if (dataUrl && dataUrl.length > 100) {
          console.log(`%cCaptured screenshot: ${dataUrl.length} bytes`, 'color: lime;');
          return dataUrl;
        } else {
          console.warn('screenshotVideo: toDataURL returned empty or tiny result');
          return '';
        }
      } catch (securityError) {
        console.warn('screenshotVideo: Canvas tainted by cross-origin video, cannot capture screenshot:', securityError);
        return '';
      }
    } catch (e) {
      console.warn('Failed to capture video screenshot:', e);
      return '';
    }
  };

  // Extract example HTML from subtitles (like old app's clickAddToFlashcards)
  // This captures the subtitle sentence with the target word highlighted
  const extractExampleHtml = (wordUuid: string): string => {
    try {
      // Try to find subtitle container and capture its HTML
      const subtitlesEl = document.querySelector('.subtitles, .subtitle-container, [class*="subtitle"]');
      if (!subtitlesEl) {
        // Fallback to context phrase
        return props.contextPhrase || '-';
      }
      
      // Clone the subtitles to avoid modifying the DOM
      const clone = subtitlesEl.cloneNode(true) as HTMLElement;
      
      // Remove any hover elements from the clone
      clone.querySelectorAll('.subtitle_hover, .word-hover-container').forEach(el => el.remove());
      
      // Highlight the target word
      const wordEl = clone.querySelector(`.subtitle_word.word_${wordUuid}, [data-uuid="${wordUuid}"]`);
      if (wordEl) {
        wordEl.classList.add('defined');
      }
      
      const html = clone.innerHTML;
      return html || props.contextPhrase || '-';
    } catch (e) {
      console.warn('Failed to extract example HTML:', e);
      return props.contextPhrase || '-';
    }
  };

  // Capture OCR region screenshot with highlight box (like old app)
  // Uses the provided ocrImageElement prop or finds the correct page image based on anchor position
  const captureOcrScreenshot = (): string => {
    try {
      // Use provided image element directly if available
      let pageImg = props.ocrImageElement;
      
      // Fallback: search DOM for the correct OCR page image
      // We need to find which page image contains our anchor rect
      if (!pageImg && props.anchorRect) {
        const anchorRect = props.anchorRect;
        const anchorCenterX = (anchorRect.left + anchorRect.right) / 2;
        const anchorCenterY = (anchorRect.top + anchorRect.bottom) / 2;
        
        // Find all page images and check which one contains our anchor point
        const pageImages = Array.from(document.querySelectorAll('.page img.page-image, .page-container img.page-image'));
        for (const img of pageImages) {
          const imgRect = img.getBoundingClientRect();
          if (
            anchorCenterX >= imgRect.left && anchorCenterX <= imgRect.right &&
            anchorCenterY >= imgRect.top && anchorCenterY <= imgRect.bottom
          ) {
            pageImg = img as HTMLImageElement;
            break;
          }
        }
      }
      
      // Fallback: Try to find the ocr-box we're hovering over
      if (!pageImg) {
        const ocrBox = document.querySelector('.ocr-box.hovered, .ocr-box:hover');
        const pageContainer = ocrBox?.closest('.page');
        pageImg = pageContainer?.querySelector('img.page-image') as HTMLImageElement | null;
      }
      
      // Last resort: try any page image
      if (!pageImg) {
        pageImg = document.querySelector('.page img.page-image, .page-container img') as HTMLImageElement | null;
      }
      
      if (!pageImg || !pageImg.naturalWidth || !pageImg.naturalHeight) {
        console.warn('captureOcrScreenshot: No valid page image found');
        return '';
      }
      
      const imgRect = pageImg.getBoundingClientRect();
      
      // Get anchor rect for the hovered word
      const anchorRect = props.anchorRect;
      
      // If we have anchor rect, crop around it; otherwise capture full image at reduced size
      if (anchorRect) {
        // Check if anchor is within this image's bounds
        const anchorCenterX = (anchorRect.left + anchorRect.right) / 2;
        const anchorCenterY = (anchorRect.top + anchorRect.bottom) / 2;
        
        if (
          anchorCenterX < imgRect.left || anchorCenterX > imgRect.right ||
          anchorCenterY < imgRect.top || anchorCenterY > imgRect.bottom
        ) {
          console.warn('captureOcrScreenshot: Anchor rect is outside page image bounds');
          // Still try to capture but the highlight might be off
        }
        
        // Padding around the word box (default 200px like old app)
        const pad = settings.ocr_crop_padding ?? 200;
        
        const clamp = (val: number, min: number, max: number) => Math.min(Math.max(val, min), max);
        
        const sxDom = anchorRect.left - pad;
        const syDom = anchorRect.top - pad;
        const swDom = anchorRect.width + pad * 2;
        const shDom = anchorRect.height + pad * 2;
        
        // Clamp within image bounds
        const visLeft = clamp(sxDom, imgRect.left, imgRect.right);
        const visTop = clamp(syDom, imgRect.top, imgRect.bottom);
        const visRight = clamp(sxDom + swDom, imgRect.left, imgRect.right);
        const visBottom = clamp(syDom + shDom, imgRect.top, imgRect.bottom);
        const visW = Math.max(1, visRight - visLeft);
        const visH = Math.max(1, visBottom - visTop);
        
        // Map to intrinsic image pixels
        const scaleX = pageImg.naturalWidth / Math.max(1, imgRect.width);
        const scaleY = pageImg.naturalHeight / Math.max(1, imgRect.height);
        const srcX = (visLeft - imgRect.left) * scaleX;
        const srcY = (visTop - imgRect.top) * scaleY;
        const srcW = visW * scaleX;
        const srcH = visH * scaleY;
        
        // Create canvas and draw cropped region
        const canvas = document.createElement('canvas');
        canvas.width = Math.min(4096, Math.max(1, Math.floor(srcW)));
        canvas.height = Math.min(4096, Math.max(1, Math.floor(srcH)));
        const ctx = canvas.getContext('2d');
        if (!ctx) return '';
        
        ctx.drawImage(pageImg, srcX, srcY, srcW, srcH, 0, 0, canvas.width, canvas.height);
        
        // Draw highlight box around original selection
        ctx.save();
        ctx.strokeStyle = 'rgba(255, 215, 0, 0.95)';
        ctx.lineWidth = 6;
        ctx.shadowColor = 'rgba(0,0,0,0.6)';
        ctx.shadowBlur = 8;
        const boxRelX = (anchorRect.left - visLeft) * (canvas.width / visW);
        const boxRelY = (anchorRect.top - visTop) * (canvas.height / visH);
        const boxRelW = anchorRect.width * (canvas.width / visW);
        const boxRelH = anchorRect.height * (canvas.height / visH);
        ctx.strokeRect(boxRelX, boxRelY, boxRelW, boxRelH);
        ctx.restore();
        
        const dataUrl = canvas.toDataURL('image/jpeg', 0.5);
        console.log('%cCaptured OCR screenshot (cropped):', 'color: lime;', dataUrl.length, 'bytes');
        return dataUrl;
      } else {
        // No anchor rect - capture full image at reasonable size
        const targetWidth = 480;
        const scale = targetWidth / pageImg.naturalWidth;
        const targetHeight = Math.round(pageImg.naturalHeight * scale);
        
        const canvas = document.createElement('canvas');
        canvas.width = targetWidth;
        canvas.height = targetHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) return '';
        
        ctx.drawImage(pageImg, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.5);
        console.log('%cCaptured OCR screenshot (full):', 'color: lime;', dataUrl.length, 'bytes');
        return dataUrl;
      }
    } catch (e) {
      console.warn('Failed to capture OCR screenshot:', e);
      return '';
    }
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
    
    const word = actualWord(); // Use dictionary form (like old app)
    const uuid = wordUuid();
    
    // Get translation/definition from translation data - preserve HTML like old app
    // The old app stores definitions as HTML strings
    let translationArr: string[] | undefined = undefined;
    let definitionHtml: string[] | undefined = undefined;
    
    const data = props.translationData?.data;
    if (data && Array.isArray(data)) {
      // First entry typically has primary translation
      const firstEntry = data[0] as TranslationEntry | undefined;
      if (firstEntry?.definitions) {
        if (Array.isArray(firstEntry.definitions)) {
          translationArr = firstEntry.definitions;
        } else if (typeof firstEntry.definitions === 'string') {
          // Preserve HTML content as-is (like old app)
          translationArr = [firstEntry.definitions];
        }
      }
      
      // Second entry may have detailed definition HTML
      const secondEntry = data[1] as TranslationEntry | undefined;
      if (secondEntry?.definitions) {
        if (Array.isArray(secondEntry.definitions)) {
          definitionHtml = secondEntry.definitions;
        } else if (typeof secondEntry.definitions === 'string') {
          definitionHtml = [secondEntry.definitions];
        }
      }
    }
    
    // Fallback to dictionary entry if no translation data
    if (!translationArr && entry?.meanings) {
      translationArr = [entry.meanings.join('; ')];
    }
    
    // Get reading from translation data
    const firstEntry = data?.[0] as TranslationEntry | undefined;
    const reading = normalizeReading(firstEntry?.reading || props.token.reading || '');
    
    // Get pitch accent from translation data (like old app)
    // Format: data[2] contains pitch info in various structures
    let pitchAccent: number | undefined = undefined;
    if (data && data.length > 2) {
      const pitchEntry = data[2];
      if (pitchEntry) {
        // Handle array format: ["word", "type", { pitches: [...] }]
        if (Array.isArray(pitchEntry) && pitchEntry[2]?.pitches) {
          pitchAccent = pitchEntry[2].pitches[0]?.position;
        } 
        // Handle object format: { pitches: [...] }
        else if ((pitchEntry as any)?.pitches) {
          pitchAccent = (pitchEntry as any).pitches[0]?.position;
        }
        // Handle nested format - recursively search for pitches
        else if (typeof pitchEntry === 'object') {
          const findPitch = (obj: any): number | undefined => {
            if (!obj || typeof obj !== 'object') return undefined;
            if (obj.pitches?.[0]?.position !== undefined) return obj.pitches[0].position;
            for (const val of Object.values(obj)) {
              if (val && typeof val === 'object') {
                const found = findPitch(val);
                if (found !== undefined) return found;
              }
            }
            return undefined;
          };
          pitchAccent = findPitch(pitchEntry);
        }
      }
    }
    
    // Capture screenshot (OCR mode vs video mode like old app)
    const isOcr = isOcrMode();
    console.log('%cHandleAddFlashcard: Starting screenshot capture, isOcr:', 'color: orange;', isOcr);
    const screenshot = isOcr ? captureOcrScreenshot() : screenshotVideo();
    console.log('%cHandleAddFlashcard: Screenshot captured, length:', 'color: orange;', screenshot?.length || 0);
    
    // Extract example HTML (subtitle sentence with highlighted word)
    let exampleHtml: string;
    if (isOcr) {
      // OCR mode: tokenize context phrase and generate colored HTML
      const contextPhrase = props.contextPhrase || '';
      if (contextPhrase && contextPhrase !== '-') {
        try {
          console.log('%cHandleAddFlashcard: Tokenizing context phrase...', 'color: orange;');
          const tokens = await tokenize(contextPhrase);
          console.log('%cHandleAddFlashcard: Tokenization complete, tokens:', 'color: orange;', tokens?.length || 0);
          const colourCodes = settings.colour_codes || currentLangData()?.colour_codes || {};
          exampleHtml = tokensToColoredHtml(tokens, colourCodes, word);
        } catch (e) {
          console.warn('Failed to tokenize OCR context phrase:', e);
          exampleHtml = contextPhrase;
        }
      } else {
        exampleHtml = '-';
      }
    } else {
      // Video mode: use subtitle HTML with word highlighted
      exampleHtml = extractExampleHtml(uuid);
    }
    console.log('%cHandleAddFlashcard: exampleHtml built', 'color: orange;');
    
    // Get level from frequency data
    const freq = wordFreqEntry();
    const level = freq?.raw_level ?? props.level ?? -1;
    
    // Build fully serializable flashcard content (using new structure with legacy compatibility)
    const content: FlashcardContent = {
      type: 'word',
      front: word,
      back: translationArr?.join('; ') || '-',
      reading: reading || word,
      pitchAccent: pitchAccent,
      pos: props.token.partOfSpeech ?? props.token.type ?? '',
      level: level,
      example: exampleHtml,
      exampleMeaning: '',
      imageUrl: screenshot,
      context: props.contextPhrase,
      // Legacy fields for backwards compatibility
      word: word,
      pronunciation: reading || word,
      translation: translationArr,
      definition: definitionHtml ?? (props.token.meaning ? [props.token.meaning] : undefined),
      screenshotUrl: screenshot,
      contextPhrase: props.contextPhrase,
    };
    
    console.log('%cFlashcard content prepared:', 'color: cyan; font-weight: bold;', {
      word,
      pitchAccent,
      screenshot: screenshot ? `${screenshot.substring(0, 50)}... (${screenshot.length} bytes)` : 'EMPTY',
      example: exampleHtml ? `${exampleHtml.substring(0, 50)}...` : 'EMPTY',
    });
    
    // Calculate ease for flashcard (like old app's knownStatusToEaseFunction)
    // UNKNOWN (0) → 1.3, LEARNING (1) → 1.55, KNOWN (2) → 1.8
    const statusNum = wordStatusToNumeric(currentStatus());
    const newEase = Math.max((statusNum - 1) * 0.25, 0) + 1.3;
    
    if (props.onAddFlashcard) {
      props.onAddFlashcard(props.token, entry);
      // isInSRS and currentEase are now reactive memos that will update automatically
      // when the flashcard is added to the store
      setIsAddingFlashcard(false);
    } else {
      try {
        // Pass ease to addFlashcard (like old app's knownStatusToEaseFunction)
        await addFlashcard(content, newEase);
        console.log(`%cCreated flashcard for word: ${word} with ease: ${newEase}`, 'color: aqua; font-weight: bold;');
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
    let position: number | null = null;
    const pitchEntry = data[2];
    if (pitchEntry) {
      // Handle array format: ["word", "type", { pitches: [...] }]
      if (Array.isArray(pitchEntry) && pitchEntry[2]?.pitches) {
        position = pitchEntry[2].pitches[0]?.position ?? null;
      } 
      // Handle object format: { pitches: [...] }
      else if ((pitchEntry as any).pitches) {
        position = (pitchEntry as any).pitches[0]?.position ?? null;
      }
      // Handle nested format from some dictionary structures
      else if (typeof pitchEntry === 'object') {
        // Search recursively for pitches
        const stack = [pitchEntry];
        while (stack.length > 0 && position === null) {
          const node = stack.pop();
          if (!node || typeof node !== 'object') continue;
          if (Array.isArray(node)) {
            for (const item of node) stack.push(item);
          } else {
            if ((node as any).pitches?.[0]?.position !== undefined) {
              position = (node as any).pitches[0].position;
              break;
            }
            for (const val of Object.values(node)) {
              if (val && typeof val === 'object') stack.push(val);
            }
          }
        }
      }
    }
    
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
    const ease = currentEase() ?? props.ease;
    if (ease === undefined) return null;
    return (
      <div class="ease-indicator">
        <span>{t('mlearn.Flashcards.Card.Ease')} {Math.round(ease * 100) / 100}</span>
      </div>
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
      onMouseEnter={() => props.onMouseEnter?.()}
      onMouseLeave={() => props.onMouseLeave?.()}
    >
      <div class={`subtitle_hover ${isShown() ? 'show-hover' : ''} ${(settings.theme === 'dark' || settings.theme === 'glass-dark' || settings.theme === 'darker') ? 'dark' : ''}`}>
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
                    icon="⏳"
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
