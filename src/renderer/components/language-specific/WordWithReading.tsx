/**
 * WordWithReading Component
 *
 * Renders a word with optional furigana (ruby) and pitch accent overlay.
 * Handles both kana-only words (pitch overlays the word directly) and
 * kanji words (pitch overlays the reading inside &lt;rt&gt;).
 *
 * This is the single source of truth for "word + reading + pitch accent"
 * rendering — used by subtitles, flashcards, word sync, etc.
 */

import { Component, Show, createMemo } from 'solid-js';
import { containsKanji, isAllKana } from '../../../shared/utils/textUtils';
import { PitchAccentOverlay } from './PitchAccentOverlay';
import './RubyText.css';

export interface WordWithReadingProps {
  /** The surface word to display */
  word: string;
  /** Reading in kana. Furigana shown only when it differs from word and word has kanji. */
  reading?: string | null;
  /** Part of speech — affects pitch accent particle box rendering */
  pos?: string;
  /** POS of the next token — for verb+verb particle box suppression */
  nextPos?: string;
  /** Explicit pitch accent position. If omitted, PitchAccentOverlay polls the cache. */
  pitchPosition?: number | null;
  /** Additional CSS class on the outermost element */
  class?: string;
  /** Force showing furigana even if word has no kanji or is all kana */
  forceShowFurigana?: boolean;
}

export const WordWithReading: Component<WordWithReadingProps> = (props) => {
  const needsFurigana = createMemo(() => {
    if (props.forceShowFurigana) return true;
    const r = props.reading;
    if (!r) return false;
    const w = props.word;
    if (isAllKana(w)) return false;
    if (!containsKanji(w)) return false;
    return r !== w;
  });

  const effectiveReading = () => props.reading || props.word;

  return (
    <Show
      when={needsFurigana()}
      fallback={
        /* Kana-only / no-reading: pitch accent overlays the word text directly */
        <PitchAccentOverlay
          word={props.word}
          reading={effectiveReading()}
          pitchPosition={props.pitchPosition}
          pos={props.pos}
          nextPos={props.nextPos}
          mode="overlay"
          isKanaOnly={isAllKana(props.word)}
          class={props.class}
        >
          {props.word}
        </PitchAccentOverlay>
      }
    >
      {/* Kanji word: ruby with pitch accent overlaying the reading inside <rt> */}
      <ruby class={`ruby-text ${props.class || ''}`}>
        {props.word}
        <rp>(</rp>
        <rt>
          <PitchAccentOverlay
            word={props.word}
            reading={effectiveReading()}
            pitchPosition={props.pitchPosition}
            pos={props.pos}
            nextPos={props.nextPos}
            mode="overlay"
            isKanaOnly={false}
          >
            {props.reading}
          </PitchAccentOverlay>
        </rt>
        <rp>)</rp>
      </ruby>
    </Show>
  );
};

export default WordWithReading;
