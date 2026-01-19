/**
 * Flashcard Component
 * Single flashcard with flip animation
 */

import { Component, JSX, Show, createMemo } from 'solid-js';
import type { Flashcard } from '../../../shared/types';
import { GlassPanel } from '../common/GlassPanel';
import { useSettings, useLanguage } from '../../context';
import { buildPitchAccentHtml, getPitchAccentInfo } from '../../utils/pitchAccent';
import './FlashcardDisplay.css';

export interface FlashcardDisplayProps {
  flashcard: Flashcard;
  showAnswer?: boolean;
  onFlip?: () => void;
  style?: JSX.CSSProperties;
}

export const FlashcardDisplay: Component<FlashcardDisplayProps> = (props) => {
  const { settings } = useSettings();
  const { getLevelName } = useLanguage();

  // Access content through the nested structure
  const content = () => props.flashcard.content;
  
  // isFlipped is driven by props.showAnswer
  const isFlipped = createMemo(() => props.showAnswer ?? false);

  // Compute pitch accent HTML if available
  const pitchAccentHtml = createMemo(() => {
    const c = content();
    if (!c.pitchAccent || !c.pronunciation) return null;
    if (settings.language !== 'ja' || !settings.showPitchAccent) return null;
    
    const info = getPitchAccentInfo(c.pitchAccent, c.pronunciation);
    if (!info) return null;
    
    return buildPitchAccentHtml(info, c.pronunciation.length, {
      includeParticleBox: true,
    });
  });

  // Get level display name from langdata
  const levelDisplay = createMemo(() => {
    const level = content().level;
    if (level === undefined || level < 0) return null;
    return getLevelName(level);
  });

  const handleFlip = () => {
    props.onFlip?.();
  };

  return (
    <div 
      class="flashcard-container" 
      style={props.style}
      onClick={handleFlip}
    >
      <div class={`flashcard-card ${isFlipped() ? 'flipped' : ''}`}>
        {/* Front */}
        <GlassPanel 
          variant="dark" 
          blur="lg" 
          rounded="xl" 
          class="flashcard-face flashcard-front"
        >
          {/* Level pill */}
          <Show when={levelDisplay()}>
            <div 
              class="pill flashcard-level-pill" 
              data-level={content().level}
            >
              {levelDisplay()}
            </div>
          </Show>
          
          <div class="flashcard-word">
            {content().word}
          </div>
          
          <Show when={content().pronunciation && content().pronunciation !== content().word}>
            <div class="flashcard-pronunciation">
              {content().pronunciation}
            </div>
          </Show>

          <Show when={content().example && content().example !== '-'}>
            <div class="flashcard-example">
              {content().example}
            </div>
          </Show>

          <div class="flashcard-hint">
            Click or press Space to reveal answer
          </div>
        </GlassPanel>

        {/* Back */}
        <GlassPanel 
          variant="dark" 
          blur="lg" 
          rounded="xl" 
          class="flashcard-face flashcard-back"
        >
          {/* Word with pitch accent */}
          <div class="flashcard-word-header">
            <Show
              when={pitchAccentHtml()}
              fallback={
                <div class="flashcard-word-title">
                  {content().word}
                  <Show when={content().pronunciation && content().pronunciation !== content().word}>
                    <span class="flashcard-word-reading">
                      ({content().pronunciation})
                    </span>
                  </Show>
                </div>
              }
            >
              <div class="flashcard-pitch-container">
                <ruby>
                  {content().word}
                  <rt>
                    {content().pronunciation}
                    <div class="mLearn-pitch-accent" innerHTML={pitchAccentHtml()!} />
                  </rt>
                </ruby>
              </div>
            </Show>
          </div>
          
          <div class="flashcard-translation">
            {content().translation?.join(', ') || content().definition?.join(', ')}
          </div>

          <Show when={content().exampleMeaning}>
            <div class="flashcard-example-meaning">
              {content().exampleMeaning}
            </div>
          </Show>

          {/* Screenshot image */}
          <Show when={content().screenshotUrl && content().screenshotUrl !== '-' && content().screenshotUrl !== ''}>
            <div class="flashcard-screenshot-container">
              <img 
                src={content().screenshotUrl} 
                alt="Screenshot" 
                class="flashcard-screenshot"
              />
            </div>
          </Show>

          <div class="flashcard-hint">
            Press 1-4 to rate • Click to flip back
          </div>
        </GlassPanel>
      </div>
    </div>
  );
};
