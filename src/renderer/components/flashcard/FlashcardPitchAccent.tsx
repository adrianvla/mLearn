/**
 * FlashcardPitchAccent Component
 * Displays word with pitch accent overlay for flashcard back face.
 * Uses the unified PitchAccentOverlay component.
 * Handles both kanji+furigana and kana-only words.
 */

import { Component, Show, createMemo } from 'solid-js';
import { PitchAccentOverlay, RubyText } from '../common';
import type { FlashcardContent } from '../../../shared/types';
import { isAllKana } from '../../../shared/utils/textUtils';
import './FlashcardPitchAccent.css';

export interface FlashcardPitchAccentProps {
  content: FlashcardContent;
}

export const FlashcardPitchAccent: Component<FlashcardPitchAccentProps> = (props) => {
  const word = () => props.content.front;
  const reading = () => props.content.reading || props.content.front;

  const needsFurigana = createMemo(() => {
    const w = word();
    const r = reading();
    if (!w || !r) return false;
    return !isAllKana(w) && w !== r;
  });

  const isVerb = createMemo(() => props.content.pos === '動詞');

  return (
    <div class="fc-pitch">
      <Show when={props.content.pitchAccent !== undefined && props.content.pitchAccent !== null} fallback={
        <RubyText
          word={word()}
          reading={reading()}
          class="fc-pitch-ruby"
        />
      }>
        <Show when={needsFurigana()} fallback={
          /* Kana-only word: pitch accent overlays the word text directly */
          <span class="fc-pitch-kana">
            <span class="fc-pitch-kana-inner">
              <PitchAccentOverlay
                word={word()}
                reading={reading()}
                pitchPosition={props.content.pitchAccent}
                pos={props.content.pos}
                mode="overlay"
                isKanaOnly={true}
                showParticleBox={!isVerb()}
              >
                {word()}
              </PitchAccentOverlay>
            </span>
          </span>
        }>
          {/* Kanji word: ruby with pitch accent overlaying the furigana */}
          <ruby class="fc-pitch-ruby">
            {word()}
            <rt>
              <span class="fc-pitch-rt">
                <PitchAccentOverlay
                  word={word()}
                  reading={reading()}
                  pitchPosition={props.content.pitchAccent}
                  pos={props.content.pos}
                  mode="overlay"
                  isKanaOnly={false}
                  showParticleBox={!isVerb()}
                >
                  {reading()}
                </PitchAccentOverlay>
              </span>
            </rt>
          </ruby>
        </Show>
      </Show>
    </div>
  );
};

export default FlashcardPitchAccent;
