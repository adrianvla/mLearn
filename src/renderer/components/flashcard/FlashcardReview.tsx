/**
 * Flashcard Review Component
 * SRS review interface with Anki-like rating buttons
 */

import { Component, JSX, Show, For, createSignal, createMemo, onMount, onCleanup, createEffect } from 'solid-js';
import { useFlashcards, useLocalization } from '../../context';
import { FlashcardDisplay } from './FlashcardDisplay';
import { Button, Badge, Panel } from '../common';
import type { Flashcard } from '../../../shared/types';
import type { Rating } from '../../services/srsAlgorithm';
import './FlashcardReview.css';

export interface FlashcardReviewProps {
  onComplete?: () => void;
  onClose?: () => void;
  style?: JSX.CSSProperties;
}

export const FlashcardReview: Component<FlashcardReviewProps> = (props) => {
  const { t } = useLocalization();
  const {
    store,
    queueCounts,
    getCurrentCard,
    getPreviewDueDates,
    answerCard,
    buryCard,
    removeFlashcard,
    undoLastAction,
    canUndo,
    refreshQueue,
    dueDateToString,
  } = useFlashcards();

  const [showAnswer, setShowAnswer] = createSignal(false);
  const [isComplete, setIsComplete] = createSignal(false);

  // Current card
  const currentCard = createMemo(() => getCurrentCard());

  // Preview due dates for buttons
  const previewDates = createMemo(() => getPreviewDueDates());

  // Counts
  const counts = createMemo(() => queueCounts());

  // Keyboard shortcuts
  onMount(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      // Check for Ctrl+Z / Cmd+Z for undo
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (canUndo()) {
          undoLastAction();
          setShowAnswer(false);
        }
        return;
      }

      if (isComplete()) return;

      // Space to show answer
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        if (!showAnswer()) {
          setShowAnswer(true);
        }
        return;
      }

      // Rating keys (only when answer is shown)
      if (showAnswer()) {
        switch (e.key) {
          case '1':
            e.preventDefault();
            handleRating('again');
            break;
          case '2':
            e.preventDefault();
            handleRating('hard');
            break;
          case '3':
            e.preventDefault();
            handleRating('good');
            break;
          case '4':
            e.preventDefault();
            handleRating('easy');
            break;
          case 'b':
            e.preventDefault();
            handleBury();
            break;
          case 'x':
            e.preventDefault();
            handleRemove();
            break;
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    onCleanup(() => document.removeEventListener('keydown', handleKeyDown));
  });

  // Check if session is complete
  createEffect(() => {
    const card = currentCard();
    if (!card && counts().total === 0) {
      setIsComplete(true);
    } else {
      setIsComplete(false);
    }
  });

  const handleRating = (quality: Rating) => {
    const card = currentCard();
    if (!card) return;

    answerCard(quality);
    setShowAnswer(false);

    // Check completion after state update
    setTimeout(() => {
      if (counts().total === 0) {
        setIsComplete(true);
        props.onComplete?.();
      }
    }, 0);
  };

  const handleBury = () => {
    const card = currentCard();
    if (!card) return;
    buryCard(card.id);
    setShowAnswer(false);
  };

  const handleRemove = async () => {
    const card = currentCard();
    if (!card) return;
    await removeFlashcard(card.id, true);
    setShowAnswer(false);
  };

  const handleFlip = () => {
    setShowAnswer(true);
  };

  const handleStartOver = () => {
    refreshQueue();
    setShowAnswer(false);
    setIsComplete(false);
  };

  // Rating buttons config with time estimates
  const ratingButtons = createMemo(() => {
    const dates = previewDates();
    if (!dates) return [];

    return [
      {
        quality: 'again' as Rating,
        label: t('mlearn.Flashcards.Review.Again'),
        className: 'flashcard-rating-btn--again',
        time: dueDateToString(dates.again),
        key: '1'
      },
      {
        quality: 'hard' as Rating,
        label: t('mlearn.Flashcards.Review.Hard'),
        className: 'flashcard-rating-btn--hard',
        time: dueDateToString(dates.hard),
        key: '2'
      },
      {
        quality: 'good' as Rating,
        label: t('mlearn.Flashcards.Review.Ok'),
        className: 'flashcard-rating-btn--good',
        time: dueDateToString(dates.good),
        key: '3'
      },
      {
        quality: 'easy' as Rating,
        label: t('mlearn.Flashcards.Review.Easy'),
        className: 'flashcard-rating-btn--easy',
        time: dueDateToString(dates.easy),
        key: '4'
      },
    ];
  });

  // Get state color class
  const getStateClass = (card: Flashcard) => {
    switch (card.state) {
      case 'new': return 'flashcard-state--new';
      case 'learning': return 'flashcard-state--learning';
      case 'relearning': return 'flashcard-state--relearning';
      case 'review': return 'flashcard-state--review';
      default: return '';
    }
  };

  return (
      <div class="flashcard-review-container" style={props.style}>
        {/* Header with stats */}
        <div class="flashcard-review-header">
          <div class="flashcard-stats">
            <Badge class="flashcard-stat flashcard-stat--new">
              <span class="flashcard-stat-label">{t('mlearn.Flashcards.Review.New')}</span>
              <span class="flashcard-stat-value">{counts().new}</span>
            </Badge>
            <Badge class="flashcard-stat flashcard-stat--learning" variant="warning">
              <span class="flashcard-stat-label">{t('mlearn.Flashcards.Review.LearningLabel')}</span>
              <span class="flashcard-stat-value">{counts().learning}</span>
            </Badge>
            <Badge class="flashcard-stat flashcard-stat--review" variant="success">
              <span class="flashcard-stat-label">{t('mlearn.Flashcards.Review.Review')}</span>
              <span class="flashcard-stat-value">{counts().review}</span>
            </Badge>
          </div>

          <Show when={canUndo()}>
            <Button buttonType="glass" variant="ghost" size="sm" onClick={undoLastAction} title={t('mlearn.Flashcards.Review.UndoTooltip')}>
              {t('mlearn.Flashcards.Review.Undo')}
            </Button>
          </Show>
        </div>

        {/* Card or completion screen */}
        <Show
            when={!isComplete() && currentCard()}
            fallback={
              <Panel
                  variant="elevated"
                  blur="lg"
                  rounded="xl"
                  class="flashcard-completion"
              >
                <h2 class="flashcard-completion-title">
                  {t('mlearn.Flashcards.Review.Complete')}
                </h2>
                <p class="flashcard-completion-text">
                  {t('mlearn.Flashcards.Review.CompleteDescription')}
                </p>
                <div class="flashcard-completion-actions">
                  <Show when={Object.keys(store.flashcards).length > 0}>
                    <Button buttonType="glass" variant="primary" onClick={handleStartOver}>
                      {t('mlearn.Flashcards.Review.ReviewMore')}
                    </Button>
                  </Show>
                  <Show when={props.onClose}>
                    <Button buttonType="glass" onClick={props.onClose}>
                      {t('mlearn.Global.Close')}
                    </Button>
                  </Show>
                </div>
              </Panel>
            }
        >
          {/* Card state indicator */}
          <Show when={currentCard()}>
            <div class={`flashcard-state-indicator ${getStateClass(currentCard()!)}`}>
              {currentCard()!.state === 'new' && t('mlearn.Flashcards.Review.NewCard')}
              {currentCard()!.state === 'learning' && t('mlearn.Flashcards.Review.LearningCard')}
              {currentCard()!.state === 'relearning' && t('mlearn.Flashcards.Review.RelearningCard')}
              {currentCard()!.state === 'review' && t('mlearn.Flashcards.Review.ReviewCard')}
            </div>
          </Show>

          <FlashcardDisplay
              flashcard={currentCard()!}
              showAnswer={showAnswer()}
              onFlip={handleFlip}
          />
        </Show>

        {/* Buttons container */}
        <div class="flashcard-buttons-container">
          {/* Show answer button */}
          <Show when={!isComplete() && currentCard() && !showAnswer()}>
            <Button buttonType="glass" variant="primary" size="lg" class="flashcard-show-answer-btn" onClick={handleFlip}>
              {t('mlearn.Flashcards.Review.ShowAnswer')}
            </Button>
          </Show>

          {/* Rating buttons */}
          <Show when={!isComplete() && currentCard() && showAnswer()}>
            <div class="flashcard-rating-buttons">
              <For each={ratingButtons()}>
                {(btn) => (
                    <Button
                        buttonType="glass"
                        class={`flashcard-rating-btn ${btn.className}`}
                        onClick={() => handleRating(btn.quality)}
                        title={t('mlearn.Flashcards.Review.PressKeyTooltip', { key: btn.key })}
                    >
                      <span class="flashcard-rating-label">{btn.label}</span>
                      <span class="flashcard-rating-time">{btn.time}</span>
                    </Button>
                )}
              </For>
            </div>

            {/* Additional action buttons */}
            <div class="flashcard-action-buttons">
              {/* Bury button */}
              <Button
                  buttonType="glass"
                  variant="ghost"
                  class="flashcard-action-btn flashcard-action-btn--bury"
                  onClick={handleBury}
                  title={t('mlearn.Flashcards.Review.PressKeyTooltip', { key: 'b' })}
              >
                <span class="flashcard-action-label">{t('mlearn.Flashcards.Review.Bury')}</span>
              </Button>

              {/* Remove button */}
              <Button
                  buttonType="glass"
                  variant="danger"
                  class="flashcard-action-btn flashcard-action-btn--remove"
                  onClick={handleRemove}
                  title={t('mlearn.Flashcards.Review.PressKeyTooltip', { key: 'x' })}
              >
                <span class="flashcard-action-label">{t('mlearn.Flashcards.Review.Remove')}</span>
              </Button>
            </div>
          </Show>
        </div>
      </div>
  );
};
