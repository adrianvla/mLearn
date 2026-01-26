/**
 * Word Hover Component
 * Popup that appears when hovering over a word
 * Matches legacy .subtitle_hover structure exactly from the old app
 */

import { Component, JSX, Show, For, createMemo, createSignal, createEffect, onMount, onCleanup } from 'solid-js';
import type { Token, DictionaryEntry, TranslationEntry, PitchData, FlashcardContent, LLMResponse } from '../../../shared/types';
import { WORD_STATUS } from '../../../shared/constants';
import { useSettings, useFlashcards, useLanguage } from '../../context';
import { getWordStatus, setWordStatus, toUniqueIdentifier } from '../../services/statsService';
import { getWordExplanation, getCachedExplanation } from '../../services/llmService';
import { buildPitchAccentHtml, getPitchAccentInfo } from '../../utils/pitchAccent';
import { tokensToColoredHtml } from '../../utils/subtitleParsing';
import { useTokenizer } from '../../hooks/useTranslation';
import { PillBtn, PillLabel, Skeleton } from '../common';
import './WordHover.css';

// Icon paths - served from static assets
const ICON_CROSS = 'assets/icons/cross2.svg';
const ICON_CHECK = 'assets/icons/check.svg';
const ICON_BOT = 'assets/icons/bot.svg';

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

// Normalize reading by stripping HTML and accent markers
function normalizeReading(raw: string): string {
  if (typeof raw !== 'string') return '';
  let text = raw;
  const markerIdx = text.indexOf('<!-- accent_start -->');
  if (markerIdx !== -1) text = text.substring(0, markerIdx);
  // Strip HTML tags
  text = text.replace(/<[^>]*>/g, '');
  text = text.replace(/\u00a0/g, ' ').trim();
  return text.replace(/\s+/g, '');
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
  onLLMExplain?: () => void;
  onClose?: () => void;
  visible?: boolean;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}

export const WordHover: Component<WordHoverProps> = (props) => {
  const { settings } = useSettings();
  const { addFlashcard, hasWord, getByWord } = useFlashcards();
  const { getFrequency, getLevelName, getLanguageFeatures, currentLangData } = useLanguage();
  const { tokenize } = useTokenizer();
  const [currentStatus, setCurrentStatus] = createSignal<WordStatus>('unknown');
  const [wordUuid, setWordUuid] = createSignal<string>('');
  const [isInSRS, setIsInSRS] = createSignal(props.isInSRS ?? false);
  const [currentEase, setCurrentEase] = createSignal<number | undefined>(props.ease);
  const [llmExplaining, setLlmExplaining] = createSignal(false);
  const [llmExplanation, setLlmExplanation] = createSignal<string | null>(null);
  const [calculatedWidth, setCalculatedWidth] = createSignal<number>(280);
  // Stable height for positioning - only updated when content changes significantly, not on status changes
  const [stableHeight, setStableHeight] = createSignal<number>(200);
  // Flag to prevent effect from overwriting local isInSRS state during flashcard creation
  const [isAddingFlashcard, setIsAddingFlashcard] = createSignal(false);
  // Flag to lock position during state changes to prevent jumps
  const [positionLocked, setPositionLocked] = createSignal(false);
  let hoverRef: HTMLDivElement | undefined;

  // Helper to get display word - track token changes
  const displayWord = createMemo(() => props.word || props.token.surface || props.token.word);
  
  // Track the actual word being displayed for reactive updates
  const actualWord = createMemo(() => props.token.actual_word || displayWord());

  const isShown = createMemo(() => props.visible !== false);

  // Calculate width based on max of content and footer (like old app)
  // The hover should be as wide as the wider of: content area or footer pills
  const calculateWidth = () => {
    if (!hoverRef) return;
    
    const subtitleHover = hoverRef.querySelector('.subtitle_hover') as HTMLElement | null;
    if (!subtitleHover) return;
    
    // Temporarily set width to auto/max-content to measure natural sizes
    const origWidth = subtitleHover.style.width;
    const origMaxWidth = subtitleHover.style.maxWidth;
    subtitleHover.style.width = 'max-content';
    subtitleHover.style.maxWidth = 'none';
    
    const footerEl = subtitleHover.querySelector('.footer') as HTMLElement | null;
    const contentEl = subtitleHover.querySelector('.subtitle_hover_content') as HTMLElement | null;
    
    let footerWidth = 280; // minimum
    let contentWidth = 280; // minimum
    
    if (footerEl) {
      // Get the actual rendered width of footer including its padding
      footerWidth = footerEl.scrollWidth;
      // Also check pills container
      const pillsEl = footerEl.querySelector('.pills') as HTMLElement | null;
      if (pillsEl) {
        // Measure all pills and add padding (10px on each side + 10px gap)
        const pills = pillsEl.querySelectorAll('.pill');
        let totalPillWidth = 20; // Initial padding
        pills.forEach(pill => {
          totalPillWidth += (pill as HTMLElement).offsetWidth + 10; // Add pill width + gap
        });
        footerWidth = Math.max(footerWidth, totalPillWidth);
      }
    }
    
    if (contentEl) {
      // Content width with padding
      contentWidth = contentEl.scrollWidth;
    }
    
    // Restore original styles
    subtitleHover.style.width = origWidth;
    subtitleHover.style.maxWidth = origMaxWidth;
    
    // Use max of content and footer width, clamped to reasonable bounds
    // Min 280px, max 700px (increased to accommodate more pills) or viewport width - 32px
    const maxAllowed = Math.min(700, (typeof window !== 'undefined' ? window.innerWidth - 32 : 700));
    const newWidth = Math.max(280, Math.min(maxAllowed, Math.max(contentWidth, footerWidth)));
    setCalculatedWidth(newWidth);
    
    // Also update stable height for positioning (only when not locked)
    if (!positionLocked() && subtitleHover.offsetHeight > 0) {
      setStableHeight(subtitleHover.offsetHeight);
    }
  };

  // Recalculate width when content changes, but NOT when status/isInSRS changes
  // (those changes don't affect width significantly and cause unwanted position jumps)
  createEffect(() => {
    // Only track dependencies that actually affect width/layout
    void displayWord();
    void props.translationData;
    void llmExplanation();
    void isShown();
    // Intentionally NOT tracking: currentStatus(), isInSRS()
    
    // Use requestAnimationFrame to ensure DOM is updated
    if (isShown()) {
      // Multiple passes to catch late layout changes
      requestAnimationFrame(() => {
        calculateWidth();
        // Second pass after a short delay
        setTimeout(() => calculateWidth(), 50);
      });
    }
  });

  // Also recalculate on mount and resize
  onMount(() => {
    calculateWidth();
    
    const resizeObserver = new ResizeObserver(() => {
      calculateWidth();
    });
    
    if (hoverRef) {
      resizeObserver.observe(hoverRef);
    }
    
    onCleanup(() => {
      resizeObserver.disconnect();
    });
  });

  // Load actual status from storage on mount or when word changes
  createEffect(async () => {
    const word = actualWord(); // Use actualWord for status lookup (like old app)
    if (!word) return;
    
    // Don't overwrite isInSRS if we're currently adding a flashcard
    if (isAddingFlashcard()) return;
    
    try {
      const uuid = await toUniqueIdentifier(word);
      setWordUuid(uuid);
      
      // Get status from storage using word (not uuid) - matches old app
      const storedStatus = getWordStatus(word);
      setCurrentStatus(numericToWordStatus(storedStatus));
      
      // Check if in SRS and get ease
      const inSRS = hasWord(word);
      setIsInSRS(inSRS);
      if (inSRS) {
        const flashcard = getByWord(word);
        if (flashcard) {
          setCurrentEase(flashcard.ease);
        }
      }
    } catch (e) {
      console.error('Failed to load word status:', e);
      setCurrentStatus(props.status || 'unknown');
    }
  });

  // Reset LLM explanation when word changes, but restore from cache if available
  // This implements the "memory" feature - previously requested explanations persist
  createEffect(() => {
    const word = displayWord();
    const context = props.contextPhrase || '';
    
    // Check if we have a cached explanation for this word+context
    const cached = getCachedExplanation(word, context);
    if (cached) {
      // Restore the cached explanation immediately
      setLlmExplanation(cached);
      setLlmExplaining(false);
      console.log(`%cRestored cached LLM explanation for "${word}"`, 'color: cyan;');
    } else {
      // No cache - reset to null
      setLlmExplanation(null);
      setLlmExplaining(false);
    }
  });

  const hoverStyle = createMemo((): JSX.CSSProperties => {
    const width = calculatedWidth();
    const anchor = props.anchorRect;
    
    // Get viewport dimensions
    const vw = typeof window !== 'undefined' ? window.innerWidth : 800;
    const vh = typeof window !== 'undefined' ? window.innerHeight : 600;
    
    // Calculate centered position relative to anchor
    const anchorCenterX = anchor ? (anchor.left + anchor.right) / 2 : props.position.x;
    const anchorTop = anchor ? anchor.top : props.position.y;
    const anchorBottom = anchor ? anchor.bottom : props.position.y + 16;
    
    // Start with centered position
    let left = anchorCenterX - width / 2;
    
    // Use stable height for positioning to prevent jumps when content changes slightly
    // Only use actual offsetHeight if stableHeight hasn't been set yet
    const hoverHeight = stableHeight() || hoverRef?.offsetHeight || 200;
    const margin = 8;
    const spaceAbove = anchorTop - margin;
    const spaceBelow = vh - anchorBottom - margin;
    // In video mode (subtitles at bottom), prefer positioning above the word
    const placeAbove = spaceAbove >= hoverHeight || spaceAbove > spaceBelow;
    
    let top = placeAbove
      ? anchorTop - hoverHeight - margin
      : anchorBottom + margin;
    
    // Horizontal clamping with proper margins (minimum 8px from edges)
    const horizontalMargin = 8;
    if (left < horizontalMargin) {
      left = horizontalMargin;
    } else if (left + width > vw - horizontalMargin) {
      left = vw - width - horizontalMargin;
    }
    
    // Vertical clamping
    if (top < horizontalMargin) {
      top = horizontalMargin;
    } else if (top + hoverHeight > vh - horizontalMargin) {
      top = vh - hoverHeight - horizontalMargin;
    }
    
    // If still too wide for viewport, constrain width
    const effectiveWidth = Math.min(width, vw - horizontalMargin * 2);
    if (effectiveWidth !== width) {
      left = horizontalMargin;
    }

    return {
      position: 'fixed',
      left: `${Math.round(left)}px`,
      top: `${Math.round(top)}px`,
      width: `${effectiveWidth}px`,
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
    const screenshot = isOcr ? captureOcrScreenshot() : screenshotVideo();
    
    // Extract example HTML (subtitle sentence with highlighted word)
    let exampleHtml: string;
    if (isOcr) {
      // OCR mode: tokenize context phrase and generate colored HTML
      const contextPhrase = props.contextPhrase || '';
      if (contextPhrase && contextPhrase !== '-') {
        try {
          const tokens = await tokenize(contextPhrase);
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
    
    // Get level from frequency data
    const freq = wordFreqEntry();
    const level = freq?.raw_level ?? props.level ?? -1;
    
    // Build fully serializable flashcard content (matching old app's structure exactly)
    const content: FlashcardContent = {
      word: word,
      pitchAccent: pitchAccent,
      pronunciation: reading || word,
      translation: translationArr,
      definition: definitionHtml ?? (props.token.meaning ? [props.token.meaning] : undefined),
      example: exampleHtml,
      exampleMeaning: '',
      screenshotUrl: screenshot,
      pos: props.token.partOfSpeech ?? props.token.type ?? '',
      level: level,
      contextPhrase: props.contextPhrase,
    };
    
    console.log('%cFlashcard content prepared:', 'color: cyan; font-weight: bold;', {
      word,
      pitchAccent,
      screenshot: screenshot ? `${screenshot.substring(0, 50)}... (${screenshot.length} bytes)` : 'EMPTY',
      example: exampleHtml ? `${exampleHtml.substring(0, 50)}...` : 'EMPTY',
    });
    
    // CRITICAL: Lock position and set adding flag to show "Adding..." state
    setPositionLocked(true);
    setIsAddingFlashcard(true);
    
    // Calculate ease for flashcard (like old app's knownStatusToEaseFunction)
    // UNKNOWN (0) → 1.3, LEARNING (1) → 1.55, KNOWN (2) → 1.8
    const statusNum = wordStatusToNumeric(currentStatus());
    const newEase = Math.max((statusNum - 1) * 0.25, 0) + 1.3;
    
    if (props.onAddFlashcard) {
      props.onAddFlashcard(props.token, entry);
      // Update state after callback completes
      setIsInSRS(true);
      setCurrentEase(newEase);
      setIsAddingFlashcard(false);
    } else {
      try {
        // Pass ease to addFlashcard (like old app's knownStatusToEaseFunction)
        await addFlashcard(content, newEase);
        console.log(`%cCreated flashcard for word: ${word} with ease: ${newEase}`, 'color: aqua; font-weight: bold;');
        // CRITICAL: Update isInSRS state AFTER flashcard is added successfully
        // This ensures the "Adding..." state is visible during the async operation
        setIsInSRS(true);
        setCurrentEase(newEase);
      } catch (err) {
        console.error('Failed to add flashcard:', err);
        alert('Failed to add flashcard: ' + String(err));
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
      handleAddFlashcard(undefined, e);
    }
  };

  const handleLLMExplain = async (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (props.onLLMExplain) {
      props.onLLMExplain();
      return;
    }
    
    // Check if LLM is enabled (like old app's clickLLMExplain)
    if (!settings.llmEnabled) {
      alert('The explain feature requires the local AI language model. Re-run the setup and enable "Install local AI language model support" to use it.');
      return;
    }
    
    // Show loading skeleton
    setLlmExplaining(true);
    setLlmExplanation(null);
    
    try {
      const word = displayWord();
      const context = props.contextPhrase || '';
      const response: LLMResponse = await getWordExplanation(word, context, settings);
      
      if (response.error) {
        setLlmExplanation(`Error: ${response.error}`);
      } else if (response.output) {
        setLlmExplanation(response.output);
      } else {
        setLlmExplanation('No explanation available.');
      }
    } catch (e) {
      setLlmExplanation(`Error: ${String(e)}`);
    } finally {
      setLlmExplaining(false);
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
  const statusVariant = createMemo(() => {
    const status = currentStatus();
    return status === 'unknown' ? 'red' : status === 'learning' ? 'orange' : 'green';
  });
  
  const statusIcon = createMemo(() => {
    const status = currentStatus();
    return status === 'unknown' ? ICON_CROSS : ICON_CHECK;
  });
  
  const statusLabel = createMemo(() => {
    const status = currentStatus();
    return status === 'unknown' ? 'Unknown' : status === 'learning' ? 'Learning' : 'Known';
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
        <span>Ease: {Math.round(ease * 100) / 100}</span>
      </div>
    );
  };

  // LLM Explain pill using PillBtn component
  const LLMPill = () => {
    return (
      <PillBtn
        variant="blue"
        icon={ICON_BOT}
        label="Explain"
        onClick={handleLLMExplain}
      />
    );
  };

  // Pitch accent pill - computed values for proper reactivity
  // Using createMemo to ensure the HTML is reactive to translation data changes
  const pitchAccentPillData = createMemo(() => {
    const features = getLanguageFeatures();
    if (!features.supportsPitchAccent || !settings.showPitchAccent) return null;
    
    const pitch = effectivePitchAccent();
    if (!pitch || !pitch.reading) return null;

    const info = getPitchAccentInfo(pitch.position, pitch.reading);
    if (!info) return null;
    
    // Check if this is a verb followed by another verb (don't show particle box)
    // The old app uses: includeParticleBox: !(pos === "動詞" && look_ahead_token === "動詞")
    // But in the hover pill, we always show the particle box since we're showing standalone
    const html = buildPitchAccentHtml(info, pitch.reading.length, {
      includeParticleBox: true,
      padTo: pitch.reading.length,
      homogenous: true,
    });
    
    if (!html) return null;

    return { reading: pitch.reading, html };
  });

  return (
    <div
      class="word-hover-container"
      style={hoverStyle()}
      ref={hoverRef}
      onMouseEnter={() => props.onMouseEnter?.()}
      onMouseLeave={() => props.onMouseLeave?.()}
    >
      <div class={`subtitle_hover ${isShown() ? 'show-hover' : ''} ${settings.dark_mode ? 'dark' : ''}`}>
        <div class="subtitle_hover_relative">
          <div class="subtitle_hover_content">
            {/* Loading state */}
            <Show when={props.isLoading}>
              <div class="hover_loading">Loading...</div>
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
                <div class="hover_translation">No translation found</div>
              </Show>
            </Show>
          </div>

          {/* LLM Explanation section */}
          <Show when={llmExplaining()}>
            <div class="subtitle_hover_alt_c skeleton-c">
              <Skeleton />
            </div>
          </Show>
          <Show when={llmExplanation()}>
            <div class="subtitle_hover_alt_c">
              <p innerHTML={llmExplanation()!.replace(/\n/g, '<br/>')} />
            </div>
          </Show>

          {/* Footer with pills */}
          <div class="footer">
            <div class="pills">
              {/* Pitch accent pill - using Show for proper reactivity */}
              <Show when={pitchAccentPillData()}>
                {(data) => (
                  <div class="pill gray pitch-accent-pill">
                    <div class="pitch-accent-word">
                      {data().reading}✦
                      <div class="mLearn-pitch-accent" aria-hidden="true" innerHTML={data().html} />
                    </div>
                  </div>
                )}
              </Show>
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
                    icon={ICON_CROSS}
                    iconRotation={45}
                    label="Flashcard"
                    onClick={handleAddToSRS}
                  />
                }>
                  <PillBtn
                    variant="yellow"
                    icon="⏳"
                    label="Adding..."
                  />
                </Show>
              }>
                <PillBtn
                  variant="green"
                  icon={ICON_CHECK}
                  label="Tracked"
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
