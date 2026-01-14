/**
 * Subtitle Word Component
 * Individual word/token in a subtitle with hover and click functionality
 */

import { Component, JSX, createMemo, Show } from 'solid-js';
import type { Token } from '../../../shared/types';
import { useWordHoverTarget } from '../../hooks';
import { usePitchAccent } from '../../hooks';
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
  const { getPitchAccentInfo, buildPitchAccentHtml } = usePitchAccent();
  let wordRef: HTMLSpanElement | undefined;

  // Get pitch accent info if enabled
  const pitchInfo = createMemo(() => {
    if (!settings.showPitchAccent || !props.token.reading) {
      return null;
    }
    return getPitchAccentInfo(props.token.surface, props.token.reading);
  });

  // Determine word class based on token type
  const getWordClass = createMemo(() => {
    const classes = ['subtitle-word'];
    
    if (props.token.isKnown) {
      classes.push('known');
    }
    
    // Add part-of-speech class
    if (props.token.partOfSpeech) {
      const pos = props.token.partOfSpeech.toLowerCase();
      if (pos.includes('verb')) classes.push('verb');
      else if (pos.includes('noun')) classes.push('noun');
      else if (pos.includes('adj')) classes.push('adjective');
      else if (pos.includes('adv')) classes.push('adverb');
      else if (pos.includes('particle')) classes.push('particle');
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
    if (!settings.showFurigana) return false;
    if (!props.token.reading) return false;
    // Only show if reading differs from surface
    return props.token.reading !== props.token.surface;
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
        fallback={
          <Show
            when={pitchInfo()}
            fallback={props.token.surface}
          >
            <span innerHTML={buildPitchAccentHtml(props.token.surface, props.token.reading || '', pitchInfo()!)} />
          </Show>
        }
      >
        <ruby>
          <Show
            when={pitchInfo()}
            fallback={props.token.surface}
          >
            <span innerHTML={buildPitchAccentHtml(props.token.surface, props.token.reading || '', pitchInfo()!)} />
          </Show>
          <rp>(</rp>
          <rt style={{ 'font-size': '0.6em' }}>{props.token.reading}</rt>
          <rp>)</rp>
        </ruby>
      </Show>
    </span>
  );
};
