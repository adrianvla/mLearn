/**
 * Pitch Accent Component
 * Visual representation of Japanese pitch accent patterns
 * Matches legacy .pitch-accent-pill styling from the old app
 */

import { Component, Show, createMemo } from 'solid-js';
import { buildPitchAccentHtml, getPitchAccentInfo } from '../../utils/pitchAccent';
import './PitchAccent.css';

export interface PitchAccentProps {
  /** Reading in hiragana/katakana */
  reading: string;
  /** Pitch accent position (0 = heiban, 1+ = downstep position) */
  position: number;
  /** Whether to show as a pill */
  asPill?: boolean;
  /** Additional class */
  class?: string;
}

/**
 * PitchAccent - Visual pitch accent diagram for Japanese words
 */
export const PitchAccent: Component<PitchAccentProps> = (props) => {
  const accentInfo = createMemo(() => {
    if (!props.reading || props.reading.length <= 1) return null;
    return getPitchAccentInfo(props.position, props.reading);
  });

  const accentHtml = createMemo(() => {
    const info = accentInfo();
    if (!info) return '';
    return buildPitchAccentHtml(info);
  });

  return (
    <Show when={accentInfo()}>
      <div class={`pitch-accent-container ${props.asPill ? 'pill gray pitch-accent-pill' : ''} ${props.class || ''}`}>
        <div class="pitch-accent-word">
          {props.reading}✦
          <div 
            class="mLearn-pitch-accent" 
            aria-hidden="true" 
            innerHTML={accentHtml()}
          />
        </div>
      </div>
    </Show>
  );
};

export default PitchAccent;
