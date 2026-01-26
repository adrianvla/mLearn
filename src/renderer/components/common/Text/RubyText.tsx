/**
 * RubyText Component
 * Renders Japanese text with furigana (ruby) annotation
 * Used for displaying readings above kanji characters
 */

import { Component, Show, createMemo } from 'solid-js';
import type { JSX } from 'solid-js/jsx-runtime';
import './RubyText.css';

// Check if a word contains kanji (needs furigana)
function containsKanji(word: string): boolean {
  return /[\u4e00-\u9faf\u3400-\u4dbf]/.test(word);
}

// Check if word is all kana (no need for furigana)
function isAllKana(word: string): boolean {
  return /^[\u3040-\u309f\u30a0-\u30ff\u31f0-\u31ff\s]+$/.test(word);
}

export interface RubyTextProps {
  /** The word to display (kanji or mixed) */
  word: string;
  /** The reading (hiragana/katakana) */
  reading?: string | null;
  /** Force showing furigana even for all-kana words */
  forceShow?: boolean;
  /** Additional class name */
  class?: string;
  /** Custom style */
  style?: JSX.CSSProperties;
  /** Children to render inside the ruby element (e.g., pitch accent) */
  children?: JSX.Element;
}

/**
 * RubyText - Displays Japanese text with optional furigana reading
 * 
 * Only shows furigana when:
 * 1. A reading is provided
 * 2. The word contains kanji (or forceShow is true)
 * 3. The reading differs from the word
 */
export const RubyText: Component<RubyTextProps> = (props) => {
  const shouldShowFurigana = createMemo(() => {
    if (!props.reading) return false;
    if (props.forceShow) return true;
    if (isAllKana(props.word)) return false;
    if (!containsKanji(props.word)) return false;
    return props.reading !== props.word;
  });

  // Adjust reading length to match word length if needed
  const adjustedReading = createMemo(() => {
    const reading = props.reading || '';
    const word = props.word;
    
    // Add padding if reading is shorter than word
    let result = reading;
    for (let i = result.length; i < word.length; i++) {
      result += '\u00A0'; // non-breaking space
    }
    
    return result;
  });

  return (
    <Show
      when={shouldShowFurigana()}
      fallback={
        <span class={`ruby-text ruby-text-plain ${props.class || ''}`} style={props.style}>
          {props.word}
          {props.children}
        </span>
      }
    >
      <ruby class={`ruby-text ${props.class || ''}`} style={props.style}>
        {props.word}
        <rp>(</rp>
        <rt>
          {adjustedReading()}
          {props.children}
        </rt>
        <rp>)</rp>
      </ruby>
    </Show>
  );
};

export default RubyText;
