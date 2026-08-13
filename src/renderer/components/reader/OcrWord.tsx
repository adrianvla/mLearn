/**
 * OCR Word Component
 * Individual word in an OCR overlay box with configurable hover trigger behavior.
 * Supports three hover modes: immediate hover, long hover (delay), and key+hover.
 */

import { Component, Show, createMemo, createSignal, onCleanup } from 'solid-js';
import { DEFAULT_SETTINGS, type Token } from '../../../shared/types';
import { useSettings, useFlashcards, useLanguage } from '../../context';
import { matchesKeybind } from '../common/Input/KeybindInput';
import { getTokenLookupWord } from '../../utils/wordForms';
import { readingAnnotationsEnabled } from '../../../shared/readingAnnotationSettings';
import { getPartOfSpeechColor, getProsodyPositionFromOverride } from '../../../shared/languageFeatures';
import { coloredProsodyAllowedOnSurface } from '../../../shared/prosodySettings';
import { getCachedTranslation, cacheVersion } from '../../hooks/useTranslation';
import { extractProsodyData } from '../../utils/translationCacheParsers';
import { getColoredProsodyConfig } from '../../utils/coloredProsody';
import type { WordRenderTextContext } from '../../utils/wordRenderText';
import { getDictionaryTargetLanguageForSettings } from '../../utils/dictionaryTargetLanguage';
import { WordWithReading } from '../language-specific/WordWithReading';
import './OcrOverlay.css';

export interface OcrWordProps {
  token: Token;
  onWordEnter?: (token: Token, e: MouseEvent) => void;
  onWordLeave?: () => void;
  /** Disable passive tracking for temporary, untokenized OCR fallback text. */
  trackPassiveHover?: boolean;
  /** Opt-in rendering of token readings as ruby annotations (e.g. EPUB text pages). */
  withReadingAnnotation?: boolean;
}

/** Delay in ms for long-hover mode before triggering */
const LONG_HOVER_DELAY = 500;

export const OcrWord: Component<OcrWordProps> = (props) => {
  const { settings } = useSettings();
  const flashcardCtx = useFlashcards();
  const { currentLangData, getLanguageFeatures, getCanonicalForm, getWordVariants, getReadingVariants } = useLanguage();
  
  // Reference to the word span element - used to get stable getBoundingClientRect
  // This is necessary because event.currentTarget becomes null after event handlers return,
  // but we need the rect for delayed triggers (long-hover timeout, key-hover on keydown)
  let wordRef: HTMLSpanElement | undefined;
  
  // For long-hover mode: track timeout
  let longHoverTimeout: ReturnType<typeof setTimeout> | null = null;
  // For key-hover mode: track if key is held and mouse is over word
  const [isMouseOver, setIsMouseOver] = createSignal(false);
  const [isKeyHeld, setIsKeyHeld] = createSignal(false);
  
  const clearLongHoverTimeout = () => {
    if (longHoverTimeout) {
      clearTimeout(longHoverTimeout);
      longHoverTimeout = null;
    }
  };

  const displayWord = () => props.token.surface ?? props.token.word;
  const tokenizerCapabilities = createMemo(() => getLanguageFeatures().tokenizerCapabilities);
  const lookupWord = createMemo(() => (
    getTokenLookupWord(props.token, tokenizerCapabilities()) || displayWord()
  ));
  const showReading = () => (
    props.withReadingAnnotation === true
    && readingAnnotationsEnabled(settings)
    && Boolean(props.token.reading)
  );

  const getPos = () => props.token.partOfSpeech ?? props.token.type ?? '';

  const dictionaryTargetLanguage = createMemo(() => getDictionaryTargetLanguageForSettings(settings));
  const lookupOptions = { getCanonicalForm, getWordVariants, getReadingVariants, dictionaryTargetLanguage, languageData: currentLangData };

  const comprehensiveKnowledge = createMemo(() => {
    const word = lookupWord();
    if (!word) return { status: 'unknown' as const, source: 'None' as const, timesSeen: 0 };
    return flashcardCtx.getComprehensiveWordStatusWithSourceSync(word, settings.language);
  });

  const wordIsKnown = createMemo(() => comprehensiveKnowledge().status === 'known');

  // Get color from user overrides or package POS metadata.
  const getWordColor = createMemo((): string | undefined => {
    if (!settings.enableWordColoring) return undefined;
    if (!settings.colorKnownWords && wordIsKnown()) return undefined;
    if (!settings.do_colour_codes) return undefined;
    const pos = getPos();
    if (!pos) return undefined;
    return getPartOfSpeechColor(pos, settings.colour_codes, currentLangData());
  });

  const cachedTranslation = createMemo(() => {
    cacheVersion(); // reactive dependency: recompute when cache changes
    const word = lookupWord();
    if (!word) return null;
    return getCachedTranslation(word, settings.language, lookupOptions);
  });

  const prosodyPosition = createMemo(() => {
    const prosody = extractProsodyData(cachedTranslation()?.data, currentLangData());
    return getProsodyPositionFromOverride(null, prosody);
  });

  // True when the current language + settings would color this word slot even
  // without reading annotations (e.g. tone-marked languages color the word text).
  const coloredProsodyActive = createMemo(() => {
    if (!getColoredProsodyConfig(currentLangData())) return false;
    const enabled = settings.coloredProsodyEnabled ?? DEFAULT_SETTINGS.coloredProsodyEnabled;
    if (!enabled) return false;
    return coloredProsodyAllowedOnSurface(settings, 'other');
  });

  const coloredProsodyCtx: WordRenderTextContext = {
    languageData: currentLangData,
    prosodyPosition,
    ease: () => comprehensiveKnowledge().ease,
    partOfSpeechColor: getWordColor,
    status: () => comprehensiveKnowledge().status,
    isKnown: wordIsKnown,
    surface: 'other',
    settings: () => settings,
  };

  // The reading is passed through even when annotations are hidden so the
  // word slot renderer can color tone-marked text (hanzi chars → tone syllables).
  const readingForDisplay = () => (
    showReading() || coloredProsodyActive() ? props.token.reading : undefined
  );
  
  // Trigger hover using the stable element reference
  // Creates a synthetic event-like object with the element as currentTarget
  const triggerHoverFromElement = () => {
    if (!wordRef) return;
    // Create a minimal event-like object with currentTarget set to our stable reference
    // We only need currentTarget for getBoundingClientRect() in the handler
    const syntheticEvent = {
      currentTarget: wordRef,
    } as unknown as MouseEvent;
    props.onWordEnter?.(props.token, syntheticEvent);
  };
  
  const handleMouseEnter = (e: MouseEvent) => {
    setIsMouseOver(true);
    
    if (props.trackPassiveHover !== false) {
      flashcardCtx.trackWordHovered(lookupWord(), props.token.reading, settings.language);
    }

    const triggerMode = settings.readerWordHoverTrigger ?? DEFAULT_SETTINGS.readerWordHoverTrigger;
    
    switch (triggerMode) {
      case 'hover':
        // Immediate hover - trigger right away using the live event
        props.onWordEnter?.(props.token, e);
        break;
        
      case 'long-hover':
        // Long hover - trigger after delay using element reference
        clearLongHoverTimeout();
        longHoverTimeout = setTimeout(() => {
          if (isMouseOver()) {
            triggerHoverFromElement();
          }
        }, LONG_HOVER_DELAY);
        break;
        
      case 'key-hover':
        // Key hover - only trigger if key is already held
        if (isKeyHeld()) {
          props.onWordEnter?.(props.token, e);
        }
        break;
    }
  };
  
  const handleMouseMove = (e: MouseEvent) => {
    // In key-hover mode with key held, behave like normal hover
    const triggerMode = settings.readerWordHoverTrigger ?? DEFAULT_SETTINGS.readerWordHoverTrigger;
    if (triggerMode === 'key-hover' && isKeyHeld() && isMouseOver()) {
      props.onWordEnter?.(props.token, e);
    }
  };
  
  const handleMouseLeave = () => {
    setIsMouseOver(false);
    clearLongHoverTimeout();
    
    if (props.trackPassiveHover !== false) {
      flashcardCtx.cancelWordHover(lookupWord(), settings.language);
    }

    props.onWordLeave?.();
  };
  
  // Key event handlers for key-hover mode
  const handleKeyDown = (e: KeyboardEvent) => {
    const triggerMode = settings.readerWordHoverTrigger ?? DEFAULT_SETTINGS.readerWordHoverTrigger;
    if (triggerMode !== 'key-hover') return;
    
    const keybind = settings.readerWordHoverKey ?? DEFAULT_SETTINGS.readerWordHoverKey!;
    if (matchesKeybind(e, keybind) && !isKeyHeld()) {
      setIsKeyHeld(true);
      if (isMouseOver()) {
        triggerHoverFromElement();
      }
    }
  };
  
  const handleKeyUp = (e: KeyboardEvent) => {
    const triggerMode = settings.readerWordHoverTrigger ?? DEFAULT_SETTINGS.readerWordHoverTrigger;
    if (triggerMode !== 'key-hover') return;
    
    const keybind = settings.readerWordHoverKey ?? DEFAULT_SETTINGS.readerWordHoverKey!;
    if (matchesKeybind(e, keybind)) {
      setIsKeyHeld(false);
      if (isMouseOver()) {
        props.onWordLeave?.();
      }
    }
  };
  
  // Set up global key listeners for key-hover mode
  if (typeof window !== 'undefined') {
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    
    onCleanup(() => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      clearLongHoverTimeout();
    });
  }
  
  return (
    <span
      ref={wordRef}
      class="ocr-word"
      onMouseEnter={handleMouseEnter}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      <Show when={showReading() || coloredProsodyActive()} fallback={displayWord()}>
        {/* reader text page owns the font (serif/mono styles) — don't force the language content font */}
        <WordWithReading
          word={displayWord()}
          reading={readingForDisplay()}
          inheritFontFamily
          coloredProsody={coloredProsodyCtx}
        />
      </Show>
    </span>
  );
};

export default OcrWord;
