/**
 * Flashcard Component
 * Single flashcard with flip animation
 * Supports new UUID-keyed flashcard format
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

  // Access content through the nested structure (new format)
  const content = () => props.flashcard.content;

  // Get display word (front of card)
  const displayWord = () => content().front;

  // Get reading/pronunciation
  const pronunciation = () => content().reading || content().front;

  // Get meaning (back of card)
  const meaning = () => content().back;

  // isFlipped is driven by props.showAnswer
  const isFlipped = createMemo(() => props.showAnswer ?? false);

  // Check if word needs furigana (contains kanji)
  const needsFurigana = createMemo(() => {
    const word = displayWord();
    const reading = pronunciation();
    if (!word || !reading) return false;
    return !isAllKana(word) && word !== reading;
  });

  // Compute pitch accent HTML if available
  const pitchAccentHtml = createMemo(() => {
    const c = content();
    if (c.pitchAccent === undefined || c.pitchAccent === null) return null;
    const reading = pronunciation();
    if (!reading) return null;
    if (settings.language !== 'ja' || !settings.showPitchAccent) return null;

    const info = getPitchAccentInfo(c.pitchAccent, reading);
    if (!info) return null;

    // Don't include particle box for verbs (like old app)
    const isVerb = c.pos === '動詞';
    return buildPitchAccentHtml(info, displayWord().length, {
      includeParticleBox: !isVerb,
    });
  });

  // Get level display name from langdata
  const levelDisplay = createMemo(() => {
    const level = content().level;
    if (level === undefined || level === null || level < 0) return null;
    return getLevelName(level);
  });

  const handleFlip = () => {
    props.onFlip?.();
  };

  // Render pitch accent display based on whether word has kanji
  const PitchAccentDisplay = () => {
    const html = pitchAccentHtml();
    const word = displayWord();
    const reading = pronunciation();

    if (!html) {
      // No pitch accent - show plain word with optional reading
      return (
          <div class="flashcard-word-title">
            {word}
            <Show when={reading && reading !== word}>
            <span class="flashcard-word-reading">
              ({reading})
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
              {word}
              <rt>
              <span class="flashcard-rt-content">
                {reading}
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
            {word}
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
              {displayWord()}
            </div>

            <Show when={pronunciation() && pronunciation() !== displayWord()}>
              <div class="flashcard-pronunciation">
                {pronunciation()}
              </div>
            </Show>

            {/* Screenshot/image - ALWAYS shown, even before reveal (like old app) */}
            <Show when={content().imageUrl && content().imageUrl !== '-' && content().imageUrl !== ''}>
              <div class="flashcard-screenshot-container flashcard-screenshot-front">
                <img
                    src={content().imageUrl}
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

            {/* Meaning (answer) */}
            <div class="flashcard-translation" innerHTML={meaning()} />

            <Show when={content().exampleMeaning}>
              <div class="flashcard-example-meaning">
                {content().exampleMeaning}
              </div>
            </Show>

            {/* Context where word was found */}
            <Show when={content().context}>
              <div class="flashcard-context">
                {content().context}
              </div>
            </Show>

            {/* Screenshot/image - also on back for reference */}
            <Show when={content().imageUrl && content().imageUrl !== '-' && content().imageUrl !== ''}>
              <div class="flashcard-screenshot-container">
                <img
                    src={content().imageUrl}
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
