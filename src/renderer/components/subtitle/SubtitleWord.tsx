/**
 * Subtitle Word Component
 * Individual word/token in a subtitle with hover and click functionality
 */

import { Component, createMemo, Show } from 'solid-js';
import type { Token } from '../../../shared/types';
import { useSettings, useLanguage } from '../../context';
import type { JSX } from 'solid-js/jsx-runtime';

// Check if a word contains kanji (needs furigana)
function containsKanji(word: string): boolean {
  // Kanji ranges: CJK Unified Ideographs
  return /[\u4e00-\u9faf\u3400-\u4dbf]/.test(word);
}

// Check if word is all kana (no need for furigana)
function isAllKana(word: string): boolean {
  return /^[\u3040-\u309f\u30a0-\u30ff\u31f0-\u31ff\s]+$/.test(word);
}

export interface SubtitleWordProps {
  token: Token;
  index: number;
  onClick?: (token: Token) => void;
  onHover?: (token: Token, rect: DOMRect, el: HTMLElement) => void;
  onLeave?: () => void;
}

export const SubtitleWord: Component<SubtitleWordProps> = (props) => {
  const { settings } = useSettings();
  const { currentLangData, isTranslatable } = useLanguage();
  let wordRef: HTMLSpanElement | undefined;
  const randomId = (() => {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
      return crypto.randomUUID();
    }
    return Math.random().toString(36).slice(2, 10);
  })();

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

  // Determine word class based on token type
  const getWordClass = createMemo(() => {
    const classes = ['subtitle-word', 'subtitle_word', `word_${randomId}`];
    
    if (props.token.isKnown) {
      classes.push('known');
    }
    
    if (isWordTranslatable()) {
      classes.push('has-hover');
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
    if (wordRef && props.onHover) {
      const rect = wordRef.getBoundingClientRect();
      props.onHover(props.token, rect, wordRef);
    }
  };

  const handleClick = () => {
    // Only trigger click for translatable words
    if (!isWordTranslatable()) return;
    props.onClick?.(props.token);
  };

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

  // For Japanese, show furigana if enabled and word contains kanji
  const showFurigana = createMemo(() => {
    const furiganaEnabled = settings.showFurigana ?? settings.furigana;
    if (!furiganaEnabled) return false;
    if (!props.token.reading) return false;
    const word = displayWord();
    // Only show furigana for words with kanji (not all kana)
    if (isAllKana(word)) return false;
    if (!containsKanji(word)) return false;
    // Only show if reading differs from surface
    return props.token.reading !== word;
  });

  // Build furigana reading with correction for verb conjugations
  const getFuriganaReading = createMemo(() => {
    if (!props.token.reading) return '';
    const word = displayWord();
    let reading = props.token.reading;
    const pos = getPos();
    
    // For verbs, adjust reading if last character differs
    if (pos === '動詞' && word.length > 0 && reading.length > 0) {
      const lastWordChar = word[word.length - 1];
      const lastReadingChar = reading[reading.length - 1];
      if (lastWordChar !== lastReadingChar && word.length === reading.length) {
        reading = reading.substring(0, reading.length - 1) + lastWordChar;
      }
    }
    
    // Add padding if reading is shorter than word
    let correction = '';
    for (let i = reading.length; i < word.length; i++) {
      correction += '\u00A0'; // non-breaking space
    }
    
    return reading + correction;
  });

  // Custom attributes for CSS selectors
  const customAttrs = createMemo(() => ({
    known: props.token.isKnown ? 'true' : 'false',
    grammar: getPos(),
  }));

  return (
    <span
      ref={wordRef}
      class={getWordClass()}
      style={wordStyle()}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={props.onLeave}
      onClick={handleClick}
      data-token-index={props.index}
      data-word-id={randomId}
      {...{ known: customAttrs().known, grammar: customAttrs().grammar } as JSX.HTMLAttributes<HTMLSpanElement>}
    >
      <Show
        when={showFurigana()}
        fallback={displayWord()}
      >
        <ruby>
          {displayWord()}
          <rp>(</rp>
          <rt style={{ 'font-size': '0.5em' }}>{getFuriganaReading()}</rt>
          <rp>)</rp>
        </ruby>
      </Show>
    </span>
  );
};
