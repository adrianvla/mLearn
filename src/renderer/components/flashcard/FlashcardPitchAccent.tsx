/**
 * FlashcardPitchAccent Component
 * Displays word with pitch accent overlay for flashcard titles.
 * Always uses WordWithReading so PitchAccentOverlay can look up
 * pitch from cache even when pitchAccent is not explicitly set.
 */

import { Component, createMemo } from 'solid-js';
import { WordWithReading } from '../common';
import type { FlashcardContent } from '../../../shared/types';
import './FlashcardPitchAccent.css';

export interface FlashcardPitchAccentProps {
  content: FlashcardContent;
}

export const FlashcardPitchAccent: Component<FlashcardPitchAccentProps> = (props) => {
  const word = () => props.content.front;
  const reading = () => props.content.reading || props.content.front;

  const hasDistinctReading = createMemo(() => {
    const r = props.content.reading;
    return !!r && r !== props.content.front;
  });

  return (
    <div class="fc-pitch">
      <WordWithReading
        word={word()}
        reading={reading()}
        pitchPosition={props.content.pitchAccent}
        pos={props.content.pos}
        class="fc-pitch-ruby"
        forceShowFurigana={hasDistinctReading()}
      />
    </div>
  );
};

export default FlashcardPitchAccent;
