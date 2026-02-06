/**
 * FlashcardPitchAccent Component
 * Displays word with pitch accent overlay for flashcard back face.
 * Handles both kanji+furigana and kana-only words.
 * The pitch accent lines never wrap independently of the text.
 */

import { Component, Show, createMemo } from 'solid-js';
import { useSettings, useLanguage } from '../../context';
import { buildPitchAccentHtml, getPitchAccentInfo } from '../../utils/pitchAccent';
import type { FlashcardContent } from '../../../shared/types';
import './FlashcardPitchAccent.css';

/** Check if word is all kana (no kanji) */
function isAllKana(word: string): boolean {
  if (!word) return true;
  return /^[\u3040-\u309F\u30A0-\u30FF\u30FC\u30FBー・]+$/.test(word);
}

export interface FlashcardPitchAccentProps {
  content: FlashcardContent;
}

export const FlashcardPitchAccent: Component<FlashcardPitchAccentProps> = (props) => {
  const { settings } = useSettings();
  const { getLanguageFeatures } = useLanguage();

  const word = () => props.content.front;
  const reading = () => props.content.reading || props.content.front;

  const needsFurigana = createMemo(() => {
    const w = word();
    const r = reading();
    if (!w || !r) return false;
    return !isAllKana(w) && w !== r;
  });

  const pitchAccentHtml = createMemo(() => {
    const c = props.content;
    if (c.pitchAccent === undefined || c.pitchAccent === null) return null;
    const r = reading();
    if (!r) return null;

    const features = getLanguageFeatures();
    if (!features.supportsPitchAccent || !settings.showPitchAccent) return null;

    const info = getPitchAccentInfo(c.pitchAccent, r);
    if (!info) return null;

    const isVerb = c.pos === '動詞';
    return buildPitchAccentHtml(info, word().length, {
      includeParticleBox: !isVerb,
    });
  });

  return (
    <div class="fc-pitch">
      <Show when={pitchAccentHtml()} fallback={
        <div class="fc-pitch-plain">
          <span class="fc-pitch-word">{word()}</span>
          <Show when={reading() && reading() !== word()}>
            <span class="fc-pitch-reading">({reading()})</span>
          </Show>
        </div>
      }>
        <Show when={needsFurigana()} fallback={
          /* Kana-only word: pitch accent overlays the word text directly */
          <span class="fc-pitch-kana">
            <span class="fc-pitch-kana-inner">
              {word()}
              <span class="fc-pitch-overlay fc-pitch-overlay--kana" innerHTML={pitchAccentHtml()!} />
            </span>
          </span>
        }>
          {/* Kanji word: ruby with pitch accent overlaying the furigana */}
          <ruby class="fc-pitch-ruby">
            {word()}
            <rt>
              <span class="fc-pitch-rt">
                {reading()}
                <span class="fc-pitch-overlay fc-pitch-overlay--rt" innerHTML={pitchAccentHtml()!} />
              </span>
            </rt>
          </ruby>
        </Show>
      </Show>
    </div>
  );
};

export default FlashcardPitchAccent;
