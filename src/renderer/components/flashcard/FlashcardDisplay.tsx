/**
 * Flashcard Display Component
 * Single flashcard with optional 3D flip animation.
 * Supports new UUID-keyed flashcard format.
 *
 * Key design decisions:
 * - Both faces are rendered in normal flow; the hidden face collapses via CSS.
 * - When flip animation is enabled, CSS perspective + rotateY is used.
 * - The container always sizes to the visible face so buttons below move correctly.
 * - Content is fully reactive via memos (no innerHTML refs that go stale).
 */

import { Component, JSX, Show, createMemo, createSignal, createEffect, createComputed, on } from 'solid-js';
import type { Flashcard } from '../../../shared/types';
import { Panel, PillLabel, IconBtn } from '../common';
import { useSettings, useLanguage, useLocalization } from '../../context';
import { FlashcardPitchAccent } from './FlashcardPitchAccent';
import { getBridge } from '../../../shared/bridges';
import { isElectron } from '../../../shared/platform';
import './FlashcardDisplay.css';

export interface FlashcardDisplayProps {
  flashcard: Flashcard;
  showAnswer?: boolean;
  onFlip?: () => void;
  onPlayTts?: (cardId: string, text: string, field: 'word' | 'example') => void;
  ttsPlaying?: boolean;
  ttsGenerating?: boolean;
  style?: JSX.CSSProperties;
}

export const FlashcardDisplay: Component<FlashcardDisplayProps> = (props) => {
  const { settings } = useSettings();
  const { getLevelName } = useLanguage();
  const { t } = useLocalization();

  // Track whether we should animate the current flip or instant-switch
  const [shouldAnimate, setShouldAnimate] = createSignal(false);
  // Track enter animation between cards
  const [isEntering, setIsEntering] = createSignal(false);

  const content = () => props.flashcard.content;
  const displayWord = () => content().front;
  const meaning = () => content().back;
  const isFlipped = createMemo(() => props.showAnswer ?? false);

  // Resolve flashcard-image:// URLs to absolute file paths on Electron
  const [resolvedImageUrl, setResolvedImageUrl] = createSignal<string | null>(null);

  createEffect(on(
    () => content().imageUrl,
    async (imageUrl) => {
      if (!imageUrl || imageUrl === '-' || imageUrl === '') {
        setResolvedImageUrl(null);
        return;
      }
      if (isElectron() && imageUrl.startsWith('flashcard-image://')) {
        const resolved = await getBridge().flashcards.resolveFlashcardImage(imageUrl);
        setResolvedImageUrl(resolved);
      } else {
        setResolvedImageUrl(imageUrl);
      }
    }
  ));

  const displayImageUrl = () => resolvedImageUrl();

  const handleTtsClick = (field: 'word' | 'example', text: string, e: MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    props.onPlayTts?.(props.flashcard.id, text, field);
  };

  // Synchronous: determine animation mode BEFORE DOM updates.
  // This prevents the "spinning div" artifact on first reveal (both
  // `flipped` and `flashcard-card--animated` classes are applied in the
  // same frame) and prevents the flip-back animation from briefly showing
  // the next card's answer when transitioning between cards.
  let prevCardId: string | undefined;
  let prevShowAnswer: boolean | undefined;
  createComputed(() => {
    const id = props.flashcard.id;
    const show = props.showAnswer ?? false;
    const cardChanged = prevCardId !== undefined && prevCardId !== id;
    const answerRevealed = prevShowAnswer !== undefined && !prevShowAnswer && show;

    if (cardChanged) {
      // Card changed — disable flip animation so the old answer
      // doesn't briefly appear while flipping back
      setShouldAnimate(false);
    } else if (answerRevealed && settings.flashcardFlipAnimation) {
      // Same card, answer being revealed — enable 3D flip
      setShouldAnimate(true);
    }

    prevCardId = id;
    prevShowAnswer = show;
  });

  // Trigger enter animation when the displayed card changes
  createEffect(on(
    () => props.flashcard.id,
    (id, prevId) => {
      if (prevId !== undefined && prevId !== id) {
        setIsEntering(true);
      }
    }
  ));

  const levelInfo = createMemo(() => {
    const level = content().level;
    if (level === undefined || level === null || level < 0) return null;
    return { level, name: getLevelName(level) };
  });

  const handleFlip = () => {
    props.onFlip?.();
  };

  const useAnimation = () => settings.flashcardFlipAnimation && shouldAnimate();

  return (
    <div
      class="flashcard-container"
      style={props.style}
      onClick={handleFlip}
    >
      <div
        class="flashcard-card"
        classList={{
          'flipped': isFlipped(),
          'flashcard-card--animated': useAnimation(),
          'flashcard-card--entering': isEntering(),
        }}
        onAnimationEnd={() => setIsEntering(false)}
      >
        {/* Front face */}
        <Panel
          variant="default"
          rounded="xl"
          class="flashcard-face flashcard-front"
          classList={{ 'flashcard-face--hidden': isFlipped() && !useAnimation() }}
        >
          <Show when={levelInfo()}>
            {(info) => (
              <PillLabel level={info().level} class="flashcard-level-pill">
                {info().name}
              </PillLabel>
            )}
          </Show>

          <div class="flashcard-word-row">
            <div class="flashcard-word">{displayWord()}</div>
            <Show when={props.onPlayTts}>
              <IconBtn
                icon="volume"
                size="sm"
                variant="ghost"
                class="flashcard-tts-btn"
                classList={{ 'flashcard-tts-btn--active': props.ttsPlaying }}
                onClick={(e: MouseEvent) => handleTtsClick('word', displayWord(), e)}
                disabled={props.ttsGenerating}
                title={t('mlearn.Flashcards.Card.PlayWord')}
              />
            </Show>
          </div>

          {/*<Show when={pronunciation() && pronunciation() !== displayWord()}>*/}
          {/*  <div class="flashcard-pronunciation">{pronunciation()}</div>*/}
          {/*</Show>*/}

          <Show when={content().example && content().example !== '-'}>
            <div class="flashcard-example-row">
              <div class="flashcard-example" innerHTML={content().example} />
              <Show when={props.onPlayTts}>
                <IconBtn
                  icon="volume"
                  size="sm"
                  variant="ghost"
                  class="flashcard-tts-btn"
                  classList={{ 'flashcard-tts-btn--active': props.ttsPlaying }}
                  onClick={(e: MouseEvent) => handleTtsClick('example', content().example!, e)}
                  disabled={props.ttsGenerating}
                  title={t('mlearn.Flashcards.Card.PlayExample')}
                />
              </Show>
            </div>
          </Show>

          <Show when={displayImageUrl()}>
            <div class="flashcard-screenshot-container flashcard-screenshot-front">
              <img
                src={displayImageUrl()!}
                alt={t('mlearn.Flashcards.Card.ScreenshotAlt')}
                class="flashcard-screenshot"
              />
            </div>
          </Show>


          {/*<div class="flashcard-hint">*/}
          {/*  {t('mlearn.Flashcards.Card.RevealHint')}*/}
          {/*</div>*/}
        </Panel>

        {/* Back face */}
        <Panel
          variant="default"
          rounded="xl"
          class="flashcard-face flashcard-back"
          classList={{ 'flashcard-face--hidden': !isFlipped() && !useAnimation() }}
        >
          <Show when={levelInfo()}>
            {(info) => (
              <PillLabel level={info().level} class="flashcard-level-pill">
                {info().name}
              </PillLabel>
            )}
          </Show>

          <div class="flashcard-word-header">
            <FlashcardPitchAccent content={content()} />
            <Show when={props.onPlayTts}>
              <IconBtn
                icon="volume"
                size="sm"
                variant="ghost"
                class="flashcard-tts-btn"
                classList={{ 'flashcard-tts-btn--active': props.ttsPlaying }}
                onClick={(e: MouseEvent) => handleTtsClick('word', displayWord(), e)}
                disabled={props.ttsGenerating}
                title={t('mlearn.Flashcards.Card.PlayWord')}
              />
            </Show>
          </div>

          <div class="flashcard-translation" innerHTML={meaning()} />

          <Show when={content().example && content().example !== '-'}>
            <div class="flashcard-example-row">
              <div class="flashcard-example" innerHTML={content().example} />
              <Show when={props.onPlayTts}>
                <IconBtn
                  icon="volume"
                  size="sm"
                  variant="ghost"
                  class="flashcard-tts-btn"
                  classList={{ 'flashcard-tts-btn--active': props.ttsPlaying }}
                  onClick={(e: MouseEvent) => handleTtsClick('example', content().example!, e)}
                  disabled={props.ttsGenerating}
                  title={t('mlearn.Flashcards.Card.PlayExample')}
                />
              </Show>
            </div>
          </Show>
          <Show when={content().exampleMeaning}>
            <div class="flashcard-example-meaning">{content().exampleMeaning}</div>
          </Show>

          <Show when={content().context}>
            <div class="flashcard-context">{content().context}</div>
          </Show>

          <Show when={displayImageUrl()}>
            <div class="flashcard-screenshot-container">
              <img
                src={displayImageUrl()!}
                alt={t('mlearn.Flashcards.Card.ScreenshotAlt')}
                class="flashcard-screenshot"
              />
            </div>
          </Show>

          {/*<div class="flashcard-hint">*/}
          {/*  {t('mlearn.Flashcards.Card.RateHint')}*/}
          {/*</div>*/}
        </Panel>
      </div>
    </div>
  );
};
