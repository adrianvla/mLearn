/**
 * Subtitle Word Component
 * Individual word/token in a subtitle with hover and click functionality
 */

import { Component, createMemo, createSignal, Show, onCleanup } from 'solid-js';
import { DEFAULT_SETTINGS, type Token } from '../../../shared/types';
import { containsKanji, isAllKana } from '../../../shared/utils/textUtils';
import { useSettings, useLanguage, useFlashcards } from '../../context';
import { getCachedReading, getCachedTranslation, cacheVersion } from '../../hooks/useTranslation';
import { PitchAccentOverlay, FrequencyStars } from '../common';
import { matchesKeybind } from '../common/Input/KeybindInput';
import type { JSX } from 'solid-js/jsx-runtime';
import './SubtitleWord.css';

/** Delay in ms for long-hover mode before triggering */
const LONG_HOVER_DELAY = 500;

export interface SubtitleWordProps {
  token: Token;
  index: number;
  lookAheadPos?: string; // POS of the next token (for pitch accent rendering)
  onClick?: (token: Token) => void;
  onHover?: (token: Token, rect: DOMRect, el: HTMLElement) => void;
  onLeave?: () => void;
}

export const SubtitleWord: Component<SubtitleWordProps> = (props) => {
  const { settings } = useSettings();
  const { currentLangData, isTranslatable, getFrequency, getLanguageFeatures, getCanonicalForm } = useLanguage();
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

  // Get the part of speech
  const getPos = () => props.token.partOfSpeech ?? props.token.type ?? '';

  // Check if this word should be interactive (translatable POS)
  const isWordTranslatable = createMemo(() => {
    const pos = getPos();
    if (!pos) return false;
    return isTranslatable(pos);
  });

  // Check if this word is known via the comprehensive knowledge system
  const wordIsKnown = createMemo(() => {
    const word = props.token.actual_word ?? props.token.surface ?? props.token.word;
    if (!word) return false;
    return flashcardCtx.isWordKnownComprehensiveSync(getCanonicalForm(word));
  });

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
      const posLower = pos.toLowerCase();
      if (posLower.includes('verb') || posLower.includes('動詞')) classes.push('verb');
      else if (posLower.includes('noun') || posLower.includes('名詞')) classes.push('noun');
      else if (posLower.includes('adj') || posLower.includes('形容')) classes.push('adjective');
      else if (posLower.includes('adv') || posLower.includes('副詞')) classes.push('adverb');
      else if (posLower.includes('particle') || posLower.includes('助詞')) classes.push('particle');
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

  // Get color from colour_codes based on POS (like the old app did)
  const getWordColor = createMemo((): string | undefined => {
    if (!settings.do_colour_codes) return undefined;
    
    const pos = getPos();
    if (!pos) return undefined;
    
    // First check settings.colour_codes (which should be populated from lang_data)
    if (settings.colour_codes?.[pos]) {
      return settings.colour_codes[pos];
    }
    
    // Fallback to currentLangData colour_codes
    const langData = currentLangData();
    if (langData?.colour_codes?.[pos]) {
      return langData.colour_codes[pos];
    }
    
    return undefined;
  });

  const wordStyle = (): JSX.CSSProperties => {
    const color = getWordColor();
    const cursor = isWordTranslatable() ? 'pointer' : 'default';
    return {
      cursor,
      position: 'relative',
      display: 'inline-block',
      'margin-right': '0.1em',
      ...(color ? { color } : {}),
    };
  };

  const cachedReadingVal = createMemo((): string | null => {
    cacheVersion(); // reactive dependency: recompute when cache changes
    const word = props.token.actual_word ?? displayWord();
    if (!word) return null;
    return getCachedReading(word, settings.language);
  });

  // Get effective reading (token.reading takes precedence, then cached)
  const effectiveReading = createMemo(() => {
    return props.token.reading || cachedReadingVal() || null;
  });

  // For Japanese, show furigana if enabled and word contains kanji
  const showFurigana = createMemo(() => {
    // Check if language supports readings first
    const features = getLanguageFeatures();
    if (!features.supportsReadings) return false;
    
    const furiganaEnabled = settings.showFurigana ?? settings.furigana;
    if (!furiganaEnabled) return false;

    // Hide reading for known words if the setting is enabled
    if (settings.hideReadingForKnownWords && wordIsKnown()) return false;

    const reading = effectiveReading();
    if (!reading) return false;
    const word = displayWord();
    // Only show furigana for words with kanji (not all kana)
    if (isAllKana(word)) return false;
    if (!containsKanji(word)) return false;
    // Only show if reading differs from surface
    return reading !== word;
  });

  const isCharKana = (ch: string): boolean => {
    if (!ch) return false;
    const cp = ch.charCodeAt(0);
    return (cp >= 0x3040 && cp <= 0x309f) || (cp >= 0x30a0 && cp <= 0x30ff);
  };

  const getFuriganaReading = createMemo(() => {
    const reading = effectiveReading();
    if (!reading) return '';
    const word = displayWord();
    let result = reading;
    const pos = getPos();

    if (pos === '動詞' && word.length > 0 && result.length > 0) {
      const lastWordChar = word[word.length - 1];
      const lastReadingChar = result[result.length - 1];
      if (
        lastWordChar !== lastReadingChar &&
        word.length === result.length &&
        isCharKana(lastWordChar)
      ) {
        result = result.substring(0, result.length - 1) + lastWordChar;
      }
    }

    let correction = '';
    for (let i = result.length; i < word.length; i++) {
      correction += '\u00A0';
    }

    return result + correction;
  });

  // Custom attributes for CSS selectors
  const customAttrs = createMemo(() => ({
    known: wordIsKnown() ? 'true' : 'false',
    grammar: getPos(),
  }));

  // Get word frequency (like old app's wordFreq[word])
  const wordFreqEntry = createMemo(() => {
    const word = props.token.actual_word ?? displayWord();
    return word ? getFrequency(word) : null;
  });

  const cachedTranslation = createMemo(() => {
    cacheVersion(); // reactive dependency: recompute when cache changes
    const word = props.token.actual_word ?? displayWord();
    if (!word) return null;
    return getCachedTranslation(word, settings.language);
  });

  // The actual word for pitch accent lookup
  const actualWord = () => props.token.actual_word ?? displayWord();

  // Determine if word is all kana (for pitch accent sizing)
  const isWordAllKana = createMemo(() => isAllKana(displayWord()));

  // CSS variable for pitch accent height
  const pitchAccentHeight = createMemo((): string | undefined => {
    const features = getLanguageFeatures();
    if (!features.supportsPitchAccent || !settings.showPitchAccent) return undefined;
    // Only set if we have a cached translation with pitch data
    const translation = cachedTranslation();
    if (!translation?.data?.[2]) return undefined;
    return isWordAllKana() ? '5px' : '2px';
  });

  // Whether to show frequency stars
  // Only show when word has dictionary data and a valid frequency level
  const showFrequencyStars = createMemo(() => {
    if (!cachedTranslation()) return false;
    const freq = wordFreqEntry();
    return freq !== null && freq.raw_level !== undefined && freq.raw_level > 0;
  });

  // Whether to hide pitch accent for known words (when hiding reading for known words)
  const hidePitchForKnown = createMemo(() => {
    return !!(settings.hideReadingForKnownWords && wordIsKnown());
  });

  return (
    <span
      ref={wordRef}
      class={getWordClass()}
      style={{
        ...wordStyle(),
        ...(pitchAccentHeight() ? { '--pitch-accent-height': pitchAccentHeight() } as JSX.CSSProperties : {}),
      }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onClick={handleClick}
      data-token-index={props.index}
      data-word-id={randomId}
      {...{ known: customAttrs().known, grammar: customAttrs().grammar } as JSX.HTMLAttributes<HTMLSpanElement>}
    >
      <Show
        when={showFurigana()}
        fallback={
          hidePitchForKnown()
            ? <>{displayWord()}</>
            : <PitchAccentOverlay
                word={actualWord()}
                reading={effectiveReading() || displayWord()}
                pos={getPos()}
                nextPos={props.lookAheadPos}
                mode="overlay"
                isKanaOnly={isWordAllKana()}
              >
                {displayWord()}
              </PitchAccentOverlay>
        }
      >
        <ruby>
          {displayWord()}
          <rp>(</rp>
          <rt style={{ 'font-size': '0.5em', position: 'relative' }}>
            <PitchAccentOverlay
              word={actualWord()}
              reading={effectiveReading() || displayWord()}
              pos={getPos()}
              nextPos={props.lookAheadPos}
              mode="overlay"
              isKanaOnly={false}
              class="pitch-overlay-wrapper--ruby"
            >
              {getFuriganaReading()}
            </PitchAccentOverlay>
          </rt>
          <rp>)</rp>
        </ruby>
      </Show>
      {/* Frequency stars */}
      <Show when={showFrequencyStars()}>
        <FrequencyStars level={wordFreqEntry()!.raw_level} maxStars={wordFreqEntry()!.raw_level} />
      </Show>
    </span>
  );
};
