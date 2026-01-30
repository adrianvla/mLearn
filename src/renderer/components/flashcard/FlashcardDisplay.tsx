/**
 * Flashcard Component
 * Single flashcard with flip animation
 */

import { Component, JSX, Show, createMemo } from 'solid-js';
import type { Flashcard } from '../../../shared/types';
import { Panel } from '../common';
import { useSettings, useLanguage, useLocalization } from '../../context';
import { buildPitchAccentHtml, getPitchAccentInfo } from '../../utils/pitchAccent';
import './FlashcardDisplay.css';

// Check if word is all kana (no kanji) - like old app's isNotAllKana but inverted
function isAllKana(word: string): boolean {
  if (!word) return true;
  // Hiragana range: \u3040-\u309F, Katakana range: \u30A0-\u30FF
  return /^[\u3040-\u309F\u30A0-\u30FF\u30FC\u30FBー・]+$/.test(word);
}

export interface FlashcardDisplayProps {
  flashcard: Flashcard;
  showAnswer?: boolean;
  onFlip?: () => void;
  style?: JSX.CSSProperties;
}

export const FlashcardDisplay: Component<FlashcardDisplayProps> = (props) => {
  const { settings } = useSettings();
  const { getLevelName } = useLanguage();
  const { t } = useLocalization();

  // Access content through the nested structure
  const content = () => props.flashcard.content;
  
  // isFlipped is driven by props.showAnswer
  const isFlipped = createMemo(() => props.showAnswer ?? false);

  // Check if word needs furigana (contains kanji)
  const needsFurigana = createMemo(() => {
    const word = content().word;
    const pronunciation = content().pronunciation;
    if (!word || !pronunciation) return false;
    return !isAllKana(word) && word !== pronunciation;
  });

  // Compute pitch accent HTML if available
  const pitchAccentHtml = createMemo(() => {
    const c = content();
    if (c.pitchAccent === undefined || c.pitchAccent === null) return null;
    if (!c.pronunciation) return null;
    if (settings.language !== 'ja' || !settings.showPitchAccent) return null;
    
    const info = getPitchAccentInfo(c.pitchAccent, c.pronunciation);
    if (!info) return null;
    
    // Don't include particle box for verbs (like old app)
    const isVerb = c.pos === '動詞';
    return buildPitchAccentHtml(info, c.word.length, {
      includeParticleBox: !isVerb,
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

  // Render pitch accent display based on whether word has kanji
  const PitchAccentDisplay = () => {
    const html = pitchAccentHtml();
    const c = content();
    
    if (!html) {
      // No pitch accent - show plain word with optional reading
      return (
        <div class="flashcard-word-title">
          {c.word}
          <Show when={c.pronunciation && c.pronunciation !== c.word}>
            <span class="flashcard-word-reading">
              ({c.pronunciation})
            </span>
          </Show>
        </div>
      );
    }
    
    if (needsFurigana()) {
      // Word has kanji - use ruby with pitch accent in rt
      return (
        <div class="flashcard-pitch-container" style={{"--pitch-accent-height": "2px"}}>
          <ruby>
            {c.word}
            <rt>
              <span class="flashcard-rt-content">
                {c.pronunciation}
                <div class="mLearn-pitch-accent" innerHTML={html} />
              </span>
            </rt>
          </ruby>
        </div>
      );
    } else {
      // Kana-only word - pitch accent overlays the word itself
      return (
        <div class="flashcard-pitch-kana" style={{"--pitch-accent-height": "5px"}}>
          <span class="flashcard-kana-content">
            {c.word}
            <div class="mLearn-pitch-accent" innerHTML={html} />
          </span>
        </div>
      );
    }
  };

  return (
    <div 
      class="flashcard-container" 
      style={props.style}
      onClick={handleFlip}
    >
      <div class={`flashcard-card ${isFlipped() ? 'flipped' : ''}`}>
        {/* Front */}
        <Panel 
          variant="elevated" 
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

          {/* Screenshot image - ALWAYS shown, even before reveal (like old app) */}
          <Show when={content().screenshotUrl && content().screenshotUrl !== '-' && content().screenshotUrl !== ''}>
            <div class="flashcard-screenshot-container flashcard-screenshot-front">
              <img 
                src={content().screenshotUrl} 
                alt={t('mlearn.Flashcards.Card.ScreenshotAlt')} 
                class="flashcard-screenshot"
              />
            </div>
          </Show>

          <Show when={content().example && content().example !== '-'}>
            <div class="flashcard-example" innerHTML={content().example} />
          </Show>

          <div class="flashcard-hint">
            {t('mlearn.Flashcards.Card.RevealHint')}
          </div>
        </Panel>

        {/* Back */}
        <Panel 
          variant="elevated" 
          blur="lg" 
          rounded="xl" 
          class="flashcard-face flashcard-back"
        >
          {/* Word with pitch accent */}
          <div class="flashcard-word-header">
            <PitchAccentDisplay />
          </div>
          
          {/* Translation (answer) */}
          <div 
            class="flashcard-translation" 
            innerHTML={(() => {
              const trans = content().translation;
              if (Array.isArray(trans)) return trans.join(', ');
              return trans || '';
            })()} 
          />
          
          {/* Definition (more detailed, shown below translation like old app) */}
          <Show when={content().definition && content().definition !== content().translation}>
            <div 
              class="flashcard-definition" 
              innerHTML={(() => {
                const def = content().definition;
                if (Array.isArray(def)) return def.join('<br/>');
                return def || '';
              })()} 
            />
          </Show>

          <Show when={content().exampleMeaning}>
            <div class="flashcard-example-meaning">
              {content().exampleMeaning}
            </div>
          </Show>

          {/* Screenshot image - also on back for reference */}
          <Show when={content().screenshotUrl && content().screenshotUrl !== '-' && content().screenshotUrl !== ''}>
            <div class="flashcard-screenshot-container">
              <img 
                src={content().screenshotUrl} 
                alt={t('mlearn.Flashcards.Card.ScreenshotAlt')} 
                class="flashcard-screenshot"
              />
            </div>
          </Show>

          <div class="flashcard-hint">
            {t('mlearn.Flashcards.Card.RateHint')}
          </div>
        </Panel>
      </div>
    </div>
  );
};
