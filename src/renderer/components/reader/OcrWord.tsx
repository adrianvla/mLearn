import { getWrittenComprehensionStatus } from '../../utils/writtenComprehension';
/**
 * OCR Word Component
 * Individual word in an OCR overlay box with configurable hover trigger behavior.
 * Supports three hover modes: immediate hover, long hover (delay), and key+hover.
 */

import { Component, Show, createEffect, createMemo, createSignal, onCleanup } from 'solid-js';
import { DEFAULT_SETTINGS, type Token, type WordLookupContext } from '../../../shared/types';
import { useSettings, useFlashcards, useLanguage } from '../../context';
import { matchesKeybind } from '../common/Input/KeybindInput';
import { getTokenLookupWord, tokenLookupContext } from '../../utils/wordForms';
import { readingAnnotationsEnabled } from '../../../shared/readingAnnotationSettings';
import { getPartOfSpeechColor, getProsodyPositionFromOverride } from '../../../shared/languageFeatures';
import { coloredProsodyAllowedOnSurface } from '../../../shared/prosodySettings';
import { getCachedTranslation, cacheVersion } from '../../hooks/useTranslation';
import { extractProsodyData, extractReadingValue } from '../../utils/translationCacheParsers';
import { getColoredProsodyConfig } from '../../utils/coloredProsody';
import type { WordRenderTextContext } from '../../utils/wordRenderText';
import { useDictionaryTargetLanguage } from '../../hooks/useDictionaryTargetLanguage';
import { WordWithReading } from '../language-specific/WordWithReading';
import './OcrOverlay.css';

export interface OcrWordProps {
  token: Token;
  lookupContext?: WordLookupContext;
  onWordEnter?: (token: Token, e: MouseEvent, trackPassiveHover: boolean) => void;
  /** Update the visible popup's anchor without admitting a second lookup. */
  onWordMove?: (token: Token, e: MouseEvent) => void;
  onWordLeave?: () => void;
  /** Disable passive tracking for temporary, untokenized OCR fallback text. */
  trackPassiveHover?: boolean;
  /** Opt-in rendering of token readings as ruby annotations (e.g. EPUB text pages). */
  withReadingAnnotation?: boolean;
  /** Occurrence-bound publisher reading; it survives dictionary/cache refreshes and display toggles. */
  authoredReading?: string;
  /** Base text covered by source ruby when the authored span covers only a token prefix. */
  authoredText?: string;
}

/** Delay in ms for long-hover mode before triggering */
const LONG_HOVER_DELAY = 500;

export const OcrWord: Component<OcrWordProps> = (props) => {
  const { settings } = useSettings();
  const flashcardCtx = useFlashcards();
  const knowledgeReady = () => flashcardCtx.isKnowledgeReady();
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
  let hoverWasTriggered = false;
  
  const clearLongHoverTimeout = () => {
    if (longHoverTimeout) {
      clearTimeout(longHoverTimeout);
      longHoverTimeout = null;
    }
  };

  const displayWord = () => props.token.surface ?? props.token.word;
  const authoredReading = () => props.authoredReading || undefined;
  const occurrenceToken = createMemo(() => {
    const reading = authoredReading();
    return reading && reading !== props.token.reading ? { ...props.token, reading } : props.token;
  });
  const tokenizerCapabilities = createMemo(() => getLanguageFeatures().tokenizerCapabilities);
  const lookupWord = createMemo(() => (
    getTokenLookupWord(props.token, tokenizerCapabilities()) || displayWord()
  ));
  const authoredText = () => props.authoredText || (authoredReading() ? displayWord() : undefined);
  const hasAuthoredReading = () => Boolean(authoredReading() && authoredText());
  const showReading = () => hasAuthoredReading() || (
    props.withReadingAnnotation === true
    && readingAnnotationsEnabled(settings)
    && Boolean(effectiveReading())
  );

  const getPos = () => props.token.partOfSpeech ?? props.token.type ?? '';

  const dictionaryTargetLanguage = useDictionaryTargetLanguage();
  const lookupOptions = { getCanonicalForm, getWordVariants, getReadingVariants, dictionaryTargetLanguage, languageData: currentLangData };

  const comprehensionStatus = createMemo(() => getWrittenComprehensionStatus({
    surface: displayWord(), lexicalWord: lookupWord(), language: settings.language,
  }, flashcardCtx.getAccessStatus));
  // Knowledge-derived rendering stays neutral until the learner projection is
  // hydrated AND the legacy epistemic migration has settled — otherwise every
  // token flashes Untracked and known-coloring visibly "settles" at startup.
  const wordIsKnown = createMemo(() => knowledgeReady() && comprehensionStatus() === 'known');

  // Get color from user overrides or package POS metadata.
  const getWordColor = createMemo((): string | undefined => {
    if (!knowledgeReady()) return undefined;
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
    return getCachedTranslation(word, settings.language, { ...lookupOptions, context: props.lookupContext ?? tokenLookupContext(props.token) })
      ?? getCachedTranslation(word, settings.language, lookupOptions);
  });

  const effectiveReading = createMemo(() => {
    if (authoredReading()) return authoredReading();
    const resolved = cachedTranslation();
    return (resolved?.resolution ? extractReadingValue(resolved.data, currentLangData()) : null) || props.token.reading;
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
    prosodyKnowledge: () => flashcardCtx.getAccessStatus(lookupWord(), 'prosodic-pattern', settings.language),
    partOfSpeechColor: getWordColor,
    surface: 'other',
    settings: () => settings,
  };

  // The reading is passed through even when annotations are hidden so the
  // word slot renderer can color tone-marked text (hanzi chars → tone syllables).
  const readingForDisplay = () => showReading() || coloredProsodyActive() ? effectiveReading() : undefined;
  
  // Trigger hover using the stable element reference
  // Creates a synthetic event-like object with the element as currentTarget
  const triggerHoverFromElement = (event?: MouseEvent) => {
    if (!wordRef || !props.onWordEnter || hoverWasTriggered) return;
    hoverWasTriggered = true;
    // Create a minimal event-like object with currentTarget set to our stable reference
    // We only need currentTarget for getBoundingClientRect() in the handler
    const syntheticEvent = {
      currentTarget: wordRef,
    } as unknown as MouseEvent;
    const triggerEvent = event?.currentTarget === wordRef ? event : syntheticEvent;
    props.onWordEnter(occurrenceToken(), triggerEvent, props.trackPassiveHover !== false);
  };
  
  const handleMouseEnter = (e: MouseEvent) => {
    setIsMouseOver(true);
    
    const triggerMode = settings.readerWordHoverTrigger ?? DEFAULT_SETTINGS.readerWordHoverTrigger;
    
    switch (triggerMode) {
      case 'hover':
        // Immediate hover - trigger right away using the live event
        triggerHoverFromElement(e);
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
          triggerHoverFromElement(e);
        }
        break;
    }
  };
  
  const handleMouseMove = (e: MouseEvent) => {
    // In key-hover mode with key held, behave like normal hover
    const triggerMode = settings.readerWordHoverTrigger ?? DEFAULT_SETTINGS.readerWordHoverTrigger;
    if (triggerMode === 'key-hover' && isKeyHeld() && isMouseOver()) {
      if (hoverWasTriggered) {
        props.onWordMove?.(occurrenceToken(), e);
      } else {
        triggerHoverFromElement(e);
      }
    }
  };
  
  const handleMouseLeave = () => {
    setIsMouseOver(false);
    clearLongHoverTimeout();
    hoverWasTriggered = false;

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
        hoverWasTriggered = false;
        props.onWordLeave?.();
      }
    }
  };
  // Global key listeners only in key-hover mode: hundreds of token components
  // each adding window listeners makes every keypress O(tokens) page-wide.
  createEffect(() => {
    if ((settings.readerWordHoverTrigger ?? DEFAULT_SETTINGS.readerWordHoverTrigger) !== 'key-hover') return;
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    onCleanup(() => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    });
  });
  onCleanup(() => {
    clearLongHoverTimeout();
    if (hoverWasTriggered) props.onWordLeave?.();
  });
  
  
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
        <Show when={hasAuthoredReading() && authoredText() !== displayWord()} fallback={(
          <WordWithReading
            word={displayWord()}
            reading={readingForDisplay()}
            annotationVisibility={hasAuthoredReading() ? 'source' : 'preference'}
            forceShowReadingAnnotation={hasAuthoredReading()}
            inheritFontFamily
            coloredProsody={coloredProsodyCtx}
          />
        )}>
          <WordWithReading
            word={authoredText()!}
            reading={authoredReading()}
            annotationVisibility="source"
            forceShowReadingAnnotation
            inheritFontFamily
            coloredProsody={coloredProsodyCtx}
          />
          {displayWord().slice(authoredText()!.length)}
        </Show>
      </Show>
    </span>
  );
};

export default OcrWord;
