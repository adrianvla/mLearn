/**
 * Word Hover Component
 * Popup that appears when hovering over a word
 * Matches legacy .subtitle_hover structure exactly from the old app
 */

import { Component, JSX, Show, For, createMemo, createSignal, createEffect, onMount, onCleanup } from 'solid-js';
import type { Token, DictionaryEntry, TranslationEntry, PitchData, FlashcardContent, LLMResponse } from '../../../shared/types';
import { WORD_STATUS } from '../../../shared/constants';
import { useSettings, useFlashcards, useLanguage } from '../../context';
import { getWordStatus, setWordStatus, toUniqueIdentifier, saveWordsToStorage } from '../../services/statsService';
import { getWordExplanation } from '../../services/llmService';
import { buildPitchAccentHtml, getPitchAccentInfo } from '../../utils/pitchAccent';
import { PillButton, SkeletonLoader } from '../common';
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
  const { addFlashcard, hasWord } = useFlashcards();
  const { getFrequency, getLevelName } = useLanguage();
  const [currentStatus, setCurrentStatus] = createSignal<WordStatus>('unknown');
  const [wordUuid, setWordUuid] = createSignal<string>('');
  const [isInSRS, setIsInSRS] = createSignal(props.isInSRS ?? false);
  const [llmExplaining, setLlmExplaining] = createSignal(false);
  const [llmExplanation, setLlmExplanation] = createSignal<string | null>(null);
  const [calculatedWidth, setCalculatedWidth] = createSignal<number>(280);
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
    subtitleHover.style.width = 'max-content';
    
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
        // Pills have gap:20px between them, add some extra for padding
        footerWidth = Math.max(footerWidth, pillsEl.scrollWidth + 20);
      }
    }
    
    if (contentEl) {
      // Content width with padding
      contentWidth = contentEl.scrollWidth;
    }
    
    // Restore original width
    subtitleHover.style.width = origWidth;
    
    // Use max of content and footer width, clamped to reasonable bounds
    // Min 280px, max 600px (or viewport width - 32px)
    const maxAllowed = Math.min(600, (typeof window !== 'undefined' ? window.innerWidth - 32 : 600));
    const newWidth = Math.max(280, Math.min(maxAllowed, Math.max(contentWidth, footerWidth)));
    setCalculatedWidth(newWidth);
  };

  // Recalculate width when content changes
  createEffect(() => {
    // Track dependencies that should trigger recalculation
    void displayWord();
    void props.translationData;
    void llmExplanation();
    void isShown();
    void currentStatus();
    void isInSRS();
    
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
    const word = displayWord();
    if (!word) return;
    
    try {
      const uuid = await toUniqueIdentifier(word);
      setWordUuid(uuid);
      
      // Get status from storage
      const storedStatus = getWordStatus(uuid);
      setCurrentStatus(numericToWordStatus(storedStatus));
      
      // Check if in SRS
      setIsInSRS(hasWord(word));
    } catch (e) {
      console.error('Failed to load word status:', e);
      setCurrentStatus(props.status || 'unknown');
    }
  });

  // Reset LLM explanation when word changes
  createEffect(() => {
    // Track word changes to reset LLM state
    void displayWord();
    setLlmExplanation(null);
    setLlmExplaining(false);
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
    
    // Determine if we should place above or below
    const hoverHeight = hoverRef?.offsetHeight || 200;
    const margin = 8;
    const spaceAbove = anchorTop - margin;
    const spaceBelow = vh - anchorBottom - margin;
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
    
    const uuid = wordUuid();
    if (uuid) {
      setWordStatus(uuid, wordStatusToNumeric(newStatus));
      await saveWordsToStorage();
    }
    
    props.onStatusChange?.(newStatus);
  };

  // Helper function to capture video screenshot (like old app's screenshotVideo)
  const screenshotVideo = (): string => {
    try {
      const video = document.querySelector('video') as HTMLVideoElement | null;
      if (!video || video.paused === undefined) return '';
      
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth || video.clientWidth || 640;
      canvas.height = video.videoHeight || video.clientHeight || 360;
      const ctx = canvas.getContext('2d');
      if (!ctx) return '';
      
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL('image/jpeg', 0.5);
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
  const captureOcrScreenshot = (): string => {
    try {
      // Check if we're in OCR mode by looking for recognized-text elements
      const recognizedTextEl = document.querySelector('.recognized-text');
      if (!recognizedTextEl) return screenshotVideo();
      
      // Find the box element associated with our word
      const targetBox = hoverRef?.closest('.recognized-text') || recognizedTextEl;
      if (!targetBox) return screenshotVideo();
      
      // Find the page container (.page-left or .page-right)
      const pageContainer = targetBox.closest('.page-left, .page-right, [class*="page"]');
      if (!pageContainer) return screenshotVideo();
      
      // Find the image inside the page
      const pageImg = pageContainer.querySelector('img') as HTMLImageElement | null;
      if (!pageImg || !pageImg.naturalWidth || !pageImg.naturalHeight) return screenshotVideo();
      
      const imgRect = pageImg.getBoundingClientRect();
      const boxRect = targetBox.getBoundingClientRect();
      
      // Padding around the box (default 200px like old app)
      const pad = settings.ocr_crop_padding ?? 200;
      
      // Calculate crop region with padding
      const clamp = (val: number, min: number, max: number) => Math.min(Math.max(val, min), max);
      
      const sxDom = boxRect.left - pad;
      const syDom = boxRect.top - pad;
      const swDom = boxRect.width + pad * 2;
      const shDom = boxRect.height + pad * 2;
      
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
      if (!ctx) return screenshotVideo();
      
      ctx.drawImage(pageImg, srcX, srcY, srcW, srcH, 0, 0, canvas.width, canvas.height);
      
      // Draw highlight box around original selection
      ctx.save();
      ctx.strokeStyle = 'rgba(255, 215, 0, 0.95)';
      ctx.lineWidth = 6;
      ctx.shadowColor = 'rgba(0,0,0,0.6)';
      ctx.shadowBlur = 8;
      const boxRelX = (boxRect.left - visLeft) * (canvas.width / visW);
      const boxRelY = (boxRect.top - visTop) * (canvas.height / visH);
      const boxRelW = boxRect.width * (canvas.width / visW);
      const boxRelH = boxRect.height * (canvas.height / visH);
      ctx.strokeRect(boxRelX, boxRelY, boxRelW, boxRelH);
      ctx.restore();
      
      return canvas.toDataURL('image/jpeg', 0.5);
    } catch (e) {
      console.warn('Failed to capture OCR screenshot:', e);
      return screenshotVideo();
    }
  };

  // Check if we're in OCR mode
  const isOcrMode = (): boolean => {
    return !!document.querySelector('.recognized-text, .ocr-overlay, [class*="ocr"]');
  };

  const handleAddFlashcard = async (entry?: DictionaryEntry, e?: MouseEvent) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    
    const word = displayWord();
    const uuid = wordUuid();
    
    // Get translation data
    let translationArr: string[] | undefined = undefined;
    if (entry?.meanings) {
      translationArr = [entry.meanings.join('; ')];
    } else {
      const firstEntry = props.translationData?.data?.[0] as TranslationEntry | undefined;
      const defs = firstEntry?.definitions;
      if (Array.isArray(defs)) {
        translationArr = defs;
      } else if (typeof defs === 'string') {
        translationArr = [defs];
      }
    }
    
    // Get reading from translation data
    const firstEntry = props.translationData?.data?.[0] as TranslationEntry | undefined;
    const reading = firstEntry?.reading || props.token.reading || '';
    
    // Get pitch accent from translation data (like old app)
    const pitchEntry = props.translationData?.data?.[2];
    let pitchAccent: number | undefined = undefined;
    if (pitchEntry) {
      if (Array.isArray(pitchEntry) && pitchEntry[2]?.pitches) {
        pitchAccent = pitchEntry[2].pitches[0]?.position;
      } else if ((pitchEntry as any).pitches) {
        pitchAccent = (pitchEntry as any).pitches[0]?.position;
      }
    }
    
    // Capture screenshot (OCR mode vs video mode like old app)
    const isOcr = isOcrMode();
    const screenshot = isOcr ? captureOcrScreenshot() : screenshotVideo();
    
    // Extract example HTML (subtitle sentence with highlighted word)
    const exampleHtml = isOcr 
      ? (props.contextPhrase || '-')  // OCR uses context phrase
      : extractExampleHtml(uuid);      // Video uses subtitle HTML
    
    // Get level from frequency data
    const freq = wordFreqEntry();
    const level = freq?.raw_level ?? props.level ?? -1;
    
    // Build fully serializable flashcard content (matching old app's structure)
    const content: FlashcardContent = {
      word: word,
      pitchAccent: pitchAccent,
      pronunciation: reading || word,
      translation: translationArr,
      definition: props.translationData?.data?.[1] 
        ? [String((props.translationData.data[1] as TranslationEntry)?.definitions || '')]
        : props.token.meaning ? [props.token.meaning] : undefined,
      example: exampleHtml,
      exampleMeaning: '',
      screenshotUrl: screenshot,
      pos: props.token.partOfSpeech ?? props.token.type ?? '',
      level: level,
      contextPhrase: props.contextPhrase,
    };
    
    if (props.onAddFlashcard) {
      props.onAddFlashcard(props.token, entry);
      // Still update local state even if external handler is provided
      setIsInSRS(true);
    } else {
      try {
        await addFlashcard(content);
        // Immediately update local state to show "Tracked" pill
        setIsInSRS(true);
        console.log(`%cCreated flashcard for word: ${word}`, 'color: aqua; font-weight: bold;');
      } catch (err) {
        console.error('Failed to add flashcard:', err);
        alert('Failed to add flashcard: ' + String(err));
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
    if (settings.language !== 'ja' || !settings.showPitchAccent) return null;
    
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
  // Must reactively update when word changes
  const LevelPill = () => {
    // Force reactive tracking of the current word by accessing actualWord()
    // This ensures the pill re-renders when the word changes
    void actualWord();
    // Try to get level from word frequency data first (like old app's wordFreq[word].level)
    const freq = wordFreqEntry();
    if (freq) {
      // freq.level already contains the name from langdata (set in LanguageContext.parseWordFrequency)
      return <div class="pill" data-level={freq.raw_level}>{freq.level}</div>;
    }
    
    // Fallback to props.level if provided - use getLevelName from langdata
    const level = props.level;
    if (level === undefined || level < 0) return null;
    const levelName = getLevelName(level);
    return <div class="pill" data-level={level}>{levelName}</div>;
  };

  const POSPill = () => {
    const pos = posType();
    if (!pos || !settings.show_pos) return null;
    return <div class="pill">{pos}</div>;
  };

  // Flashcard pill using PillButton component
  const FlashcardPill = () => {
    if (isInSRS() || props.isInSRS) {
      return (
        <PillButton
          variant="green"
          icon={ICON_CHECK}
          label="Tracked"
        />
      );
    }

    return (
      <PillButton
        variant="blue"
        icon={ICON_CROSS}
        iconRotation={45}
        label="Flashcard"
        onClick={handleAddToSRS}
      />
    );
  };

  const EasePill = () => {
    if (props.ease === undefined) return null;
    return (
      <div class="ease-indicator">
        <span>Ease: {Math.round(props.ease * 100) / 100}</span>
      </div>
    );
  };

  // LLM Explain pill using PillButton component
  const LLMPill = () => {
    return (
      <PillButton
        variant="blue"
        icon={ICON_BOT}
        label="Explain"
        onClick={handleLLMExplain}
      />
    );
  };

  // Pitch accent pill with visual diagram
  const PitchAccentPill = () => {
    const pitch = effectivePitchAccent();
    if (!pitch || !pitch.reading) return null;
    if (settings.language !== 'ja' || !settings.showPitchAccent) return null;

    const info = getPitchAccentInfo(pitch.position, pitch.reading);
    if (!info) return null;
    
    const html = buildPitchAccentHtml(info, pitch.reading.length, {
      includeParticleBox: true,
      padTo: pitch.reading.length,
      homogenous: true,
    });
    
    if (!html) return null;

    return (
      <div class="pill gray pitch-accent-pill">
        <div class="pitch-accent-word">
          {pitch.reading}✦
          <div class="mLearn-pitch-accent" aria-hidden="true" innerHTML={html} />
        </div>
      </div>
    );
  };

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
              <SkeletonLoader />
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
              <PitchAccentPill />
              <LevelPill />
              <POSPill />
              {/* Status pill - directly reactive using memos */}
              <PillButton
                variant={statusVariant()}
                icon={statusIcon()}
                label={statusLabel()}
                onClick={handleStatusChange}
              />
              <FlashcardPill />
              <Show when={isInSRS() || props.isInSRS}>
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
