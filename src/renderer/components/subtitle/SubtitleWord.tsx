/**
 * Subtitle Word Component
 * Individual word/token in a subtitle with hover and click functionality
 */

import { Component, JSX, createMemo, Show } from 'solid-js';
import type { Token } from '../../../shared/types';
import { useSettings, useLanguage } from '../../context';

export interface SubtitleWordProps {
  token: Token;
  index: number;
  onClick?: (token: Token) => void;
  onHover?: (token: Token, rect: DOMRect, el: HTMLElement) => void;
  onLeave?: () => void;
}

export const SubtitleWord: Component<SubtitleWordProps> = (props) => {
  const { settings } = useSettings();
  const { currentLangData } = useLanguage();
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

  // Determine word class based on token type
  const getWordClass = createMemo(() => {
    const classes = ['subtitle-word', 'subtitle_word', `word_${randomId}`];
    
    if (props.token.isKnown) {
      classes.push('known');
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
    if (wordRef && props.onHover) {
      const rect = wordRef.getBoundingClientRect();
      props.onHover(props.token, rect, wordRef);
    }
  };

  const handleClick = () => {
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
    return {
      cursor: 'pointer',
      position: 'relative',
      display: 'inline-block',
      'margin-right': '0.1em',
      ...(color ? { color } : {}),
    };
  };

  // For Japanese, show furigana if enabled
  const showFurigana = createMemo(() => {
    const furiganaEnabled = settings.showFurigana ?? settings.furigana;
    if (!furiganaEnabled) return false;
    if (!props.token.reading) return false;
    // Only show if reading differs from surface
    return props.token.reading !== displayWord();
  });

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
    >
      <Show
        when={showFurigana()}
        fallback={displayWord()}
      >
        <ruby>
          {displayWord()}
          <rp>(</rp>
          <rt style={{ 'font-size': '0.6em' }}>{props.token.reading}</rt>
          <rp>)</rp>
        </ruby>
      </Show>
    </span>
  );
};
