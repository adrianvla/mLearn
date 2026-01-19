/**
 * Flashcard Review Component
 * SRS review interface with rating buttons (matching old app exactly)
 */

import { Component, JSX, Show, createSignal, createMemo, onMount, onCleanup, For, createEffect } from 'solid-js';
import { useFlashcards } from '../../context';
import { FlashcardDisplay } from './FlashcardDisplay';
import { GlassButton } from '../common/GlassButton';
import { GlassPanel } from '../common/GlassPanel';
import type { Flashcard } from '../../../shared/types';
import './FlashcardReview.css';

export interface FlashcardReviewProps {
  onComplete?: () => void;
  onClose?: () => void;
  style?: JSX.CSSProperties;
}

export const FlashcardReview: Component<FlashcardReviewProps> = (props) => {
  const { 
    store, 
    getDueCards, 
    reviewFlashcard, 
    postponeFlashcard,
    schedulePitchMistake,
    markAsKnown,
    removeFlashcard,
    sortByDueDate,
    getAnticipatedDueDate,
    dateToInString,
    getPostponeDate,
    getPitchMistakeDate,
    pushUndoState,
    undoLastAction,
    canUndo,
  } = useFlashcards();
  
  const [showAnswer, setShowAnswer] = createSignal(false);
  const [isComplete, setIsComplete] = createSignal(false);
  
  // Current card is always flashcards[0] after sorting by due date
  const currentCard = createMemo(() => {
    sortByDueDate();
    const cards = store.flashcards;
    if (cards.length === 0) return null;
    // Only show if due
    if (cards[0].dueDate > Date.now()) return null;
    return cards[0];
  });
  
  // Count due cards
  const dueCount = createMemo(() => getDueCards().length);
  
  // Stats
  const stats = createMemo(() => {
    const cards = store.flashcards;
    return {
      new: cards.filter((c: Flashcard) => c.reviews === 0).length,
      learning: cards.filter((c: Flashcard) => c.reviews > 0 && (c.interval ?? 0) < 21 * 24 * 60).length,
      review: dueCount(),
    };
  });

  // Keyboard shortcuts (like old app)
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
          case 'p':
            e.preventDefault();
            handlePostpone();
            break;
          case 'm':
            e.preventDefault();
            handlePitchMistake();
            break;
          case '-':
            e.preventDefault();
            handleMarkAsKnown();
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

  // Check if all cards are done
  createEffect(() => {
    if (dueCount() === 0) {
      setIsComplete(true);
    } else {
      setIsComplete(false);
    }
  });

  const handleRating = (quality: 'again' | 'hard' | 'good' | 'easy') => {
    const card = currentCard();
    if (!card) return;

    reviewFlashcard(quality);
    setShowAnswer(false);
    
    if (dueCount() === 0) {
      setIsComplete(true);
      props.onComplete?.();
    }
  };

  const handlePostpone = () => {
    if (!currentCard()) return;
    postponeFlashcard();
    setShowAnswer(false);
  };

  const handlePitchMistake = () => {
    if (!currentCard()) return;
    schedulePitchMistake();
    setShowAnswer(false);
  };

  const handleMarkAsKnown = async () => {
    if (!currentCard()) return;
    await markAsKnown();
    setShowAnswer(false);
  };

  const handleRemove = async () => {
    if (!currentCard()) return;
    pushUndoState({ type: 'remove' });
    await removeFlashcard(0, false);
    setShowAnswer(false);
  };

  const handleFlip = () => {
    setShowAnswer(true);
  };

  const handleStartOver = () => {
    sortByDueDate();
    setShowAnswer(false);
    setIsComplete(false);
  };

  // Rating buttons config with time estimates
  const ratingButtons = createMemo(() => {
    const card = currentCard();
    if (!card) {
      return [];
    }
    
    return [
      { 
        quality: 'again' as const, 
        label: 'Again', 
        className: 'flashcard-rating-btn--again', 
        time: dateToInString(getAnticipatedDueDate(card, 0).dueDate),
        key: '1'
      },
      { 
        quality: 'hard' as const, 
        label: 'Hard', 
        className: 'flashcard-rating-btn--hard', 
        time: dateToInString(getAnticipatedDueDate(card, 2).dueDate),
        key: '2'
      },
      { 
        quality: 'good' as const, 
        label: 'Ok', 
        className: 'flashcard-rating-btn--good', 
        time: dateToInString(getAnticipatedDueDate(card, 3).dueDate),
        key: '3'
      },
      { 
        quality: 'easy' as const, 
        label: 'Easy', 
        className: 'flashcard-rating-btn--easy', 
        time: dateToInString(getAnticipatedDueDate(card, 5).dueDate),
        key: '4'
      },
    ];
  });

  // Additional buttons
  const additionalButtons = createMemo(() => {
    const card = currentCard();
    if (!card) return [];
    
    return [
      {
        label: 'Pitch Wrong',
        className: 'flashcard-action-btn--pitch',
        time: dateToInString(getPitchMistakeDate()),
        onClick: handlePitchMistake,
        key: 'm'
      },
      {
        label: 'Show Later',
        className: 'flashcard-action-btn--postpone',
        time: dateToInString(getPostponeDate()),
        onClick: handlePostpone,
        key: 'p'
      },
      {
        label: 'Hide',
        className: 'flashcard-action-btn--known',
        time: '∞',
        onClick: handleMarkAsKnown,
        key: '-'
      },
    ];
  });

  return (
    <div class="flashcard-review-container" style={props.style}>
      {/* Header with stats */}
      <div class="flashcard-review-header">
        <div class="flashcard-stats">
          <span class="flashcard-stat">
            <span class="flashcard-stat-label">Left:</span>
            <span class="flashcard-stat-value">{dueCount()}</span>
          </span>
          <span class="flashcard-stat">
            <span class="flashcard-stat-label">New:</span>
            <span class="flashcard-stat-new">{stats().new}</span>
          </span>
          <span class="flashcard-stat">
            <span class="flashcard-stat-label">Learning:</span>
            <span class="flashcard-stat-learning">{stats().learning}</span>
          </span>
        </div>
        
        <Show when={canUndo()}>
          <button class="flashcard-undo-btn" onClick={undoLastAction} title="Undo (Ctrl+Z)">
            ↩ Undo
          </button>
        </Show>
      </div>

      {/* Card or completion screen */}
      <Show
        when={!isComplete() && currentCard()}
        fallback={
          <GlassPanel
            variant="dark"
            blur="lg"
            rounded="xl"
            class="flashcard-completion"
          >
            <h2 class="flashcard-completion-title">
              🎉 Review Complete!
            </h2>
            <p class="flashcard-completion-text">
              You've reviewed all due cards for now.
            </p>
            <div class="flashcard-completion-actions">
              <Show when={store.flashcards.length > 0}>
                <GlassButton variant="primary" onClick={handleStartOver}>
                  Review More
                </GlassButton>
              </Show>
              <Show when={props.onClose}>
                <GlassButton onClick={props.onClose}>
                  Close
                </GlassButton>
              </Show>
            </div>
          </GlassPanel>
        }
      >
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
          <button class="flashcard-show-answer-btn" onClick={handleFlip}>
            Show Answer
          </button>
        </Show>

        {/* Rating buttons */}
        <Show when={!isComplete() && currentCard() && showAnswer()}>
          <div class="flashcard-rating-buttons">
            <For each={ratingButtons()}>
              {(btn) => (
                <button
                  class={`flashcard-rating-btn ${btn.className}`}
                  onClick={() => handleRating(btn.quality)}
                  title={`Press ${btn.key}`}
                >
                  <span class="flashcard-rating-label">{btn.label}</span>
                  <span class="flashcard-rating-time">{btn.time}</span>
                </button>
              )}
            </For>
          </div>
          
          {/* Additional action buttons */}
          <div class="flashcard-action-buttons">
            <For each={additionalButtons()}>
              {(btn) => (
                <button
                  class={`flashcard-action-btn ${btn.className}`}
                  onClick={btn.onClick}
                  title={`Press ${btn.key}`}
                >
                  <span class="flashcard-action-label">{btn.label}</span>
                  <span class="flashcard-action-time">{btn.time}</span>
                </button>
              )}
            </For>
            
            {/* Remove button */}
            <button
              class="flashcard-action-btn flashcard-action-btn--remove"
              onClick={handleRemove}
              title="Press x"
            >
              <span class="flashcard-action-label">Remove</span>
            </button>
          </div>
        </Show>
      </div>
    </div>
  );
};
