/**
 * Subtitle Word Component
 * Individual word/token in a subtitle with hover and click functionality
 */

import { Component, JSX, createMemo, Show } from 'solid-js';
import type { Token } from '../../../shared/types';
import { useSettings } from '../../context';

export interface SubtitleWordProps {
  token: Token;
  index: number;
  onClick?: (token: Token) => void;
  onHover?: (token: Token, rect: DOMRect) => void;
  onLeave?: () => void;
}

export const SubtitleWord: Component<SubtitleWordProps> = (props) => {
  const { settings } = useSettings();
  let wordRef: HTMLSpanElement | undefined;

  // Helper to get display word (surface or word)
  const displayWord = () => props.token.surface ?? props.token.word;

  // Determine word class based on token type
  const getWordClass = createMemo(() => {
    const classes = ['subtitle-word'];
    
    if (props.token.isKnown) {
      classes.push('known');
    }
    
    // Add part-of-speech class
    const pos = props.token.partOfSpeech ?? props.token.type;
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
      props.onHover(props.token, rect);
    }
  };

  const handleClick = () => {
    props.onClick?.(props.token);
  };

  const wordStyle = (): JSX.CSSProperties => ({
    cursor: 'pointer',
    position: 'relative',
    display: 'inline-block',
    'margin-right': '0.1em',
  });

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
