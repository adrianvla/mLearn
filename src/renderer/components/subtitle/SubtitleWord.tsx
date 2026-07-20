/**
 * Subtitle Word Component
 * Individual word/token in a subtitle with hover and click functionality
 */

import { Component, createMemo, createSignal, Show, onCleanup } from 'solid-js';
import { DEFAULT_SETTINGS, type Token } from '../../../shared/types';
import {
  hideReadingAnnotationsForKnownWords,
  readingAnnotationsEnabled,
} from '../../../shared/readingAnnotationSettings';
import { prosodyVisible } from '../../../shared/prosodySettings';
import {
  adjustReadingAnnotationForSurfaceSuffix,
  getReadingAnnotationDisplay,
  getPartOfSpeechColor,
  getFrequencyLevelVisualRank,
  getProsodyPositionFromOverride,
  getTokenJoinSeparator,
  isDisplayableFrequencyLevel,
  isReadingScriptText,
  wordNeedsReadingAnnotation,
} from '../../../shared/languageFeatures';
import { useSettings, useLanguage, useFlashcards } from '../../context';
import { getCachedReading, getCachedTranslation, cacheVersion } from '../../hooks/useTranslation';
import { extractProsodyData } from '../../utils/translationCacheParsers';
import { getProsodyOverlayRenderer } from '../../utils/prosodyPresentation';
import { getProsodyOverlayTextTarget } from '../../utils/prosodyOverlayTarget';
import { FrequencyStars } from '../common';
import { ProsodyOverlay, WordWithReading } from '../language-specific';
import type { WordWithReadingRenderTextOptions } from '../language-specific/WordWithReading';
import { matchesKeybind } from '../common/Input/KeybindInput';
import type { JSX } from 'solid-js/jsx-runtime';
import { getTokenLookupWord } from '../../utils/wordForms';
import { getDictionaryTargetLanguageForSettings } from '../../utils/dictionaryTargetLanguage';
import {
  buildColoredProsodySegments,
  coloredProsodyAllowsStatus,
  getColoredProsodyConfig,
  getColoredProsodyPalette,
  resolveColoredProsodyStyle,
} from '../../utils/coloredProsody';
import '../language-specific/RubyText.css';
import './SubtitleWord.css';

/** Delay in ms for long-hover mode before triggering */
const LONG_HOVER_DELAY = 500;

function toPosClass(pos: string): string | null {
  const normalized = pos
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_-]+/gu, '-')
    .replace(/^-+|-+$/g, '');
  return normalized ? `pos-${normalized}` : null;
}

export interface SubtitleWordProps {
  token: Token;
  index: number;
  lookAheadPos?: string; // POS of the next token (for prosody rendering)
  onClick?: (token: Token) => void;
  onHover?: (token: Token, rect: DOMRect, el: HTMLElement) => void;
  onLeave?: () => void;
}

export const SubtitleWord: Component<SubtitleWordProps> = (props) => {
  const { settings } = useSettings();
  const {
    currentLangData,
    isTokenTranslatable,
    getFrequency,
    getFreqLevelNames,
    getLanguageFeatures,
    getCanonicalForm,
    getWordVariants,
    getReadingVariants,
  } = useLanguage();
  const flashcardCtx = useFlashcards();
  let wordRef: HTMLSpanElement | undefined;
  const randomId = (() => {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
      return crypto.randomUUID();
    }
    return Math.random().toString(36).slice(2, 10);
  })();

  // For key-hover / long-hover trigger modes
  let longHoverTimeout: ReturnType<typeof setTimeout> | null = null;
  const [isMouseOver, setIsMouseOver] = createSignal(false);
  const [isKeyHeld, setIsKeyHeld] = createSignal(false);

  const clearLongHoverTimeout = () => {
    if (longHoverTimeout) {
      clearTimeout(longHoverTimeout);
      longHoverTimeout = null;
    }
  };

  const triggerHoverFromElement = () => {
    if (!wordRef || !props.onHover) return;
    const rect = wordRef.getBoundingClientRect();
    props.onHover(props.token, rect, wordRef);
  };

  // Helper to get display word (surface or word)
  const displayWord = () => props.token.surface ?? props.token.word;
  const tokenizerCapabilities = createMemo(() => getLanguageFeatures().tokenizerCapabilities);
  const lookupWord = createMemo(() => getTokenLookupWord(props.token, tokenizerCapabilities()) || displayWord());
  const dictionaryTargetLanguage = createMemo(() => getDictionaryTargetLanguageForSettings(settings));
  const lookupOptions = { getCanonicalForm, getWordVariants, getReadingVariants, dictionaryTargetLanguage, languageData: currentLangData };

  // Get the part of speech
  const getPos = () => props.token.partOfSpeech ?? props.token.type ?? '';

  // Check if this word should be interactive (translatable POS)
  const isWordTranslatable = createMemo(() => {
    return isTokenTranslatable(props.token);
  });

  const comprehensiveKnowledge = createMemo(() => {
    const word = lookupWord();
    if (!word) return { status: 'unknown' as const, source: 'None' as const, timesSeen: 0 };
    return flashcardCtx.getComprehensiveWordStatusWithSourceSync(word, settings.language);
  });

  // Check if this word is known via the comprehensive knowledge system
  const wordIsKnown = createMemo(() => comprehensiveKnowledge().status === 'known');

  // Determine word class based on token type
  const getWordClass = createMemo(() => {
    const classes = ['subtitle-word', 'subtitle_word', `word_${randomId}`];
    
    if (wordIsKnown()) {
      classes.push('known');
    }
    
    if (isWordTranslatable()) {
      classes.push('has-hover');
    }

    // Blur unknown words when blur_words is enabled
    if (settings.blur_words && !wordIsKnown()) {
      classes.push('blur');
    }
    // Blur known words when blurKnownWords is enabled
    if (settings.blurKnownWords && wordIsKnown()) {
      classes.push('blur');
    }
    
    // Add part-of-speech class
    const pos = getPos();
    if (pos) {
      const posClass = toPosClass(pos);
      if (posClass) classes.push(posClass);
    }

    return classes.join(' ');
  });

  const handleMouseEnter = () => {
    // Only trigger hover for translatable words
    if (!isWordTranslatable()) return;
    setIsMouseOver(true);

    const triggerMode = settings.readerWordHoverTrigger ?? DEFAULT_SETTINGS.readerWordHoverTrigger;
    switch (triggerMode) {
      case 'hover':
        triggerHoverFromElement();
        break;
      case 'long-hover':
        clearLongHoverTimeout();
        longHoverTimeout = setTimeout(() => {
          if (isMouseOver()) triggerHoverFromElement();
        }, LONG_HOVER_DELAY);
        break;
      case 'key-hover':
        if (isKeyHeld()) triggerHoverFromElement();
        break;
    }
  };

  const handleMouseLeave = () => {
    setIsMouseOver(false);
    clearLongHoverTimeout();
    props.onLeave?.();
  };

  const handleClick = () => {
    // Only trigger click for translatable words
    if (!isWordTranslatable()) return;
    props.onClick?.(props.token);
  };

  // Key event handlers for key-hover mode
  const handleKeyDown = (e: KeyboardEvent) => {
    if ((settings.readerWordHoverTrigger ?? DEFAULT_SETTINGS.readerWordHoverTrigger) !== 'key-hover') return;
    const keybind = settings.readerWordHoverKey ?? DEFAULT_SETTINGS.readerWordHoverKey!;
    if (matchesKeybind(e, keybind) && !isKeyHeld()) {
      setIsKeyHeld(true);
      if (isMouseOver() && isWordTranslatable()) triggerHoverFromElement();
    }
  };

  const handleKeyUp = (e: KeyboardEvent) => {
    if ((settings.readerWordHoverTrigger ?? DEFAULT_SETTINGS.readerWordHoverTrigger) !== 'key-hover') return;
    const keybind = settings.readerWordHoverKey ?? DEFAULT_SETTINGS.readerWordHoverKey!;
    if (matchesKeybind(e, keybind)) {
      setIsKeyHeld(false);
      if (isMouseOver()) props.onLeave?.();
    }
  };

  if (typeof window !== 'undefined') {
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    onCleanup(() => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      clearLongHoverTimeout();
    });
  }

  // Get color from user overrides or package POS metadata.
  const getWordColor = createMemo((): string | undefined => {
    if (!settings.do_colour_codes) return undefined;
    
    const pos = getPos();
    if (!pos) return undefined;
    const langData = currentLangData();
    
    return getPartOfSpeechColor(pos, settings.colour_codes, langData);
  });

  const wordStyle = (): JSX.CSSProperties => {
    const color = getWordColor();
    const cursor = isWordTranslatable() ? 'pointer' : 'default';
    const compactTokenLayout = getTokenJoinSeparator(currentLangData()) === '';
    return {
      cursor,
      position: 'relative',
      display: 'inline-block',
      ...(compactTokenLayout ? { 'margin-right': '0.1em' } : {}),
      ...(color ? { color } : {}),
    };
  };

  const cachedReadingVal = createMemo((): string | null => {
    cacheVersion(); // reactive dependency: recompute when cache changes
    const word = lookupWord();
    if (!word) return null;
    return getCachedReading(word, settings.language, lookupOptions);
  });

  // Get effective reading (token.reading takes precedence, then cached)
  const effectiveReading = createMemo(() => {
    return props.token.reading || cachedReadingVal() || null;
  });

  // Show reading annotations only when both settings and language metadata allow them.
  const showReadingAnnotation = createMemo(() => {
    const features = getLanguageFeatures();
    if (!features.supportsReadings) return false;

    if (!readingAnnotationsEnabled(settings)) return false;

    // Hide reading for known words if the setting is enabled
    if (hideReadingAnnotationsForKnownWords(settings) && wordIsKnown()) return false;

    const reading = effectiveReading();
    if (!reading) return false;
    return wordNeedsReadingAnnotation(displayWord(), reading, currentLangData());
  });

  const readingAnnotationDisplay = createMemo(() => getReadingAnnotationDisplay(currentLangData()));
  const displayReading = createMemo(() => (
    adjustReadingAnnotationForSurfaceSuffix(displayWord(), effectiveReading() || '', currentLangData())
  ));

  // Custom attributes for CSS selectors
  const customAttrs = createMemo(() => ({
    known: wordIsKnown() ? 'true' : 'false',
    grammar: getPos(),
  }));

  // Get word frequency (like old app's wordFreq[word])
  const wordFreqEntry = createMemo(() => {
    const word = lookupWord();
    return word ? getFrequency(word) : null;
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

  // The actual word for prosody lookup
  const actualWord = () => lookupWord();

  // Determine if the displayed word is already in the language's reading/transliteration script.
  const wordUsesReadingScript = createMemo(() => isReadingScriptText(displayWord(), currentLangData()));

  const canRenderProsodyOverlay = createMemo(() => (
    getProsodyOverlayRenderer(currentLangData(), getLanguageFeatures().prosodyRenderer) !== null
    && prosodyVisible(settings)
  ));

  const prosodyOverlayHeight = createMemo((): string | undefined => {
    if (!canRenderProsodyOverlay()) return undefined;
    // Only reserve overlay height if the selected inline renderer has cached prosody data.
    if (prosodyPosition() === null) return undefined;
    return wordUsesReadingScript() ? '5px' : '2px';
  });

  // Whether to show frequency stars
  // Only show when word has dictionary data and a valid frequency level
  const showFrequencyStars = createMemo(() => {
    if (!cachedTranslation()) return false;
    const freq = wordFreqEntry();
    return freq !== null && isDisplayableFrequencyLevel(freq.raw_level, getFreqLevelNames(), currentLangData());
  });

  const frequencyVisualLevel = createMemo(() => {
    const freq = wordFreqEntry();
    if (!freq) return 0;
    const languageData = currentLangData();
    return getFrequencyLevelVisualRank(freq.raw_level, getFreqLevelNames(), languageData);
  });

  // Whether to hide prosody for known words when reading annotations are hidden.
  const hideProsodyForKnown = createMemo(() => {
    return hideReadingAnnotationsForKnownWords(settings) && wordIsKnown();
  });

  const readingForDisplay = createMemo(() => (
    showReadingAnnotation() ? effectiveReading() : null
  ));

  const coloredProsodyConfig = createMemo(() => getColoredProsodyConfig(currentLangData()));

  const renderColoredProsodyText = (text: JSX.Element, options: WordWithReadingRenderTextOptions) => {
    const config = coloredProsodyConfig();
    const enabled = settings.coloredProsodyEnabled ?? DEFAULT_SETTINGS.coloredProsodyEnabled;
    const statusLimit = settings.coloredProsodyStatusLimit ?? DEFAULT_SETTINGS.coloredProsodyStatusLimit;
    if (!config || !enabled || !coloredProsodyAllowsStatus(comprehensiveKnowledge().status, statusLimit)) {
      return <span class={options.class} style={options.style}>{text}</span>;
    }

    const displayText = typeof text === 'string'
      ? text
      : options.slot === 'reading'
        ? options.displayReading
        : options.word;
    const segments = buildColoredProsodySegments(config, {
      text: displayText,
      word: options.word,
      reading: options.reading,
      slot: options.slot,
      prosodyPosition: prosodyPosition(),
    });
    if (!segments?.some((segment) => segment.paletteKey)) {
      return <span class={options.class} style={options.style}>{text}</span>;
    }

    const palette = getColoredProsodyPalette(settings, config);
    return (
      <span class={options.class} style={options.style}>
        {segments.map((segment) => {
          const color = segment.paletteKey ? palette[segment.paletteKey] : undefined;
          return color ? (
            <span
              class="colored-prosody__segment"
              data-prosody-value={segment.paletteKey}
              style={resolveColoredProsodyStyle(
                color,
                settings,
                comprehensiveKnowledge().ease,
                getWordColor(),
              )}
            >
              {segment.text}
            </span>
          ) : segment.text;
        })}
      </span>
    );
  };

  const renderSubtitleText = (text: JSX.Element, options: WordWithReadingRenderTextOptions) => {
    const coloredText = renderColoredProsodyText(text, options);
    if (hideProsodyForKnown() || !canRenderProsodyOverlay()) {
      return coloredText;
    }
    const overlayTarget = getProsodyOverlayTextTarget(actualWord(), effectiveReading() || displayWord(), options);

    return (
      <ProsodyOverlay
        word={options.slot === 'reading' ? actualWord() : overlayTarget.word}
        reading={overlayTarget.reading}
        pos={getPos()}
        nextPos={props.lookAheadPos}
        mode="overlay"
        languageData={currentLangData()}
        isReadingScript={options.isReadingScript}
        class={options.slot === 'reading' ? 'prosody-overlay-wrapper--reading' : options.class}
        style={options.style}
      >
        {coloredText}
      </ProsodyOverlay>
    );
  };

  const renderRubyReading = () => (
    <ruby>
      {renderColoredProsodyText(displayWord(), {
        slot: 'word',
        word: displayWord(),
        reading: effectiveReading() || displayWord(),
        displayReading: displayReading(),
        isReadingScript: wordUsesReadingScript(),
      })}
      <rp>(</rp>
      <rt>
        {renderSubtitleText(displayReading(), {
          slot: 'reading',
          word: displayWord(),
          reading: effectiveReading() || displayWord(),
          displayReading: displayReading(),
          isReadingScript: true,
          class: 'subtitle-word__reading-overlay prosody-overlay-wrapper--reading',
        })}
      </rt>
      <rp>)</rp>
    </ruby>
  );

  const renderSubtitleWord = () => {
    if (showReadingAnnotation() && readingAnnotationDisplay() === 'ruby') {
      return renderRubyReading();
    }

    return (
      <WordWithReading
        word={displayWord()}
        reading={readingForDisplay()}
        language={settings.language}
        languageData={currentLangData()}
        forceShowReadingAnnotation={showReadingAnnotation()}
        renderText={renderSubtitleText}
      />
    );
  };

  return (
    <span
      ref={wordRef}
      class={getWordClass()}
      style={{
        ...wordStyle(),
        ...(prosodyOverlayHeight() ? { '--prosody-overlay-height': prosodyOverlayHeight() } as JSX.CSSProperties : {}),
      }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onClick={handleClick}
      data-token-index={props.index}
      data-word-id={randomId}
      {...{ known: customAttrs().known, grammar: customAttrs().grammar } as JSX.HTMLAttributes<HTMLSpanElement>}
    >
      {renderSubtitleWord()}
      {/* Frequency stars */}
      <Show when={showFrequencyStars()}>
        <FrequencyStars level={wordFreqEntry()!.raw_level} visualLevel={frequencyVisualLevel()} />
      </Show>
    </span>
  );
};
