/**
 * Flashcard Review Component
 * SRS review interface with rating buttons
 */

import { Component, JSX, Show, createSignal, createMemo, onMount, onCleanup, For } from 'solid-js';
import { useFlashcards } from '../../context';
import { FlashcardDisplay } from './FlashcardDisplay';
import { GlassButton } from '../common/GlassButton';
import { GlassPanel } from '../common/GlassPanel';
import './FlashcardReview.css';

export interface FlashcardReviewProps {
  onComplete?: () => void;
  style?: JSX.CSSProperties;
}

export const FlashcardReview: Component<FlashcardReviewProps> = (props) => {
  const { getDueCards, reviewFlashcard, getNewCards, store } = useFlashcards();
  
  const [currentIndex, setCurrentIndex] = createSignal(0);
  const [showAnswer, setShowAnswer] = createSignal(false);
  const [isReviewing, setIsReviewing] = createSignal(true);

  const dueCards = createMemo(() => getDueCards());
  
  // Compute stats from store
  const stats = createMemo(() => {
    const cards = store.flashcards;
    return {
      new: cards.filter(c => c.reviews === 0).length,
      learning: cards.filter(c => c.reviews > 0 && c.interval < 21).length,
      review: dueCards().length,
    };
  });
  
  const currentCard = createMemo(() => {
    const cards = dueCards();
    const idx = currentIndex();
    if (idx >= cards.length) return null;
    return cards[idx];
  });

  const progress = createMemo(() => {
    const total = dueCards().length;
    if (total === 0) return 100;
    return Math.round((currentIndex() / total) * 100);
  });

  // Keyboard shortcuts (like old app)
  onMount(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }
      
      if (!isReviewing()) return;
      
      // Space or Enter to flip card
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        if (!showAnswer()) {
          setShowAnswer(true);
        }
        return;
      }
      
      // Number keys for rating (only when answer is shown)
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
        }
      }
    };
    
    document.addEventListener('keydown', handleKeyDown);
    onCleanup(() => document.removeEventListener('keydown', handleKeyDown));
  });

  const handleRating = (quality: 'again' | 'hard' | 'good' | 'easy') => {
    const card = currentCard();
    if (!card) return;

    reviewFlashcard(card.id, quality);
    setShowAnswer(false);
    
    const nextIndex = currentIndex() + 1;
    if (nextIndex >= dueCards().length) {
      setIsReviewing(false);
      props.onComplete?.();
    } else {
      setCurrentIndex(nextIndex);
    }
  };

  const handleFlip = () => {
    setShowAnswer(true);
  };

  const handleStartOver = () => {
    setCurrentIndex(0);
    setShowAnswer(false);
    setIsReviewing(true);
  };

  // Rating buttons config with time estimates based on SM-2 algorithm with time estimates based on SM-2 algorithm
  const ratingButtons = createMemo(() => {
    const card = currentCard();
    if (!card) {
      return [
        { quality: 'again' as const, label: 'Again', className: 'flashcard-rating-btn--again', time: '< 1m' },
        { quality: 'hard' as const, label: 'Hard', className: 'flashcard-rating-btn--hard', time: '~6m' },
        { quality: 'good' as const, label: 'Good', className: 'flashcard-rating-btn--good', time: '~10m' },
        { quality: 'easy' as const, label: 'Easy', className: 'flashcard-rating-btn--easy', time: '~4d' },
      ];
    }
    
    // Calculate estimated next review times based on current card state
    const interval = card.interval || 0;
    const ef = card.easeFactor || 2.5;
    
    // Time formatting helper (like old app's dateToInString)
    const formatInterval = (days: number): string => {
      if (days < 1 / 1440) return '< 1m';
      if (days < 1 / 24) return `${Math.round(days * 1440)}m`;
      if (days < 1) return `${Math.round(days * 24)}h`;
      if (days < 30) return `${Math.round(days)}d`;
      if (days < 365) return `${Math.round(days / 30)}mo`;
      return `${Math.round(days / 365)}y`;
    };
    
    // Calculate intervals for each rating
    const againInterval = 1 / 1440; // 1 minute
    const hardInterval = Math.max(interval * 1.2, 1 / 144); // ~10 minutes min
    const goodInterval = Math.max(interval === 0 ? 1 / 144 : interval * ef, 1 / 144);
    const easyInterval = Math.max(interval === 0 ? 4 : interval * ef * 1.3, 1);
    
    return [
      { quality: 'again' as const, label: 'Again', className: 'flashcard-rating-btn--again', time: formatInterval(againInterval) },
      { quality: 'hard' as const, label: 'Hard', className: 'flashcard-rating-btn--hard', time: formatInterval(hardInterval) },
      { quality: 'good' as const, label: 'Good', className: 'flashcard-rating-btn--good', time: formatInterval(goodInterval) },
      { quality: 'easy' as const, label: 'Easy', className: 'flashcard-rating-btn--easy', time: formatInterval(easyInterval) },
    ];
  });

  return (
    <div class="flashcard-review-container" style={props.style}>
      {/* Progress */}
      <div class="flashcard-progress">
        <div class="flashcard-progress-header">
          <span>Progress</span>
          <span>
            {currentIndex()}/{dueCards().length} cards
          </span>
        </div>
        <div class="flashcard-progress-bar">
          <div
            class="flashcard-progress-fill"
            style={{ width: `${progress()}%` }}
          />
        </div>
      </div>

      {/* Card or completion screen */}
      <Show
        when={isReviewing() && currentCard()}
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
              <Show when={dueCards().length > 0}>
                <GlassButton variant="primary" onClick={handleStartOver}>
                  Start Over
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

      {/* Rating buttons */}
      <Show when={isReviewing() && showAnswer()}>
        <div class="flashcard-rating-buttons">
          <For each={ratingButtons()}>
            {(btn) => (
              <button
                class={`flashcard-rating-btn ${btn.className}`}
                onClick={() => handleRating(btn.quality)}
              >
                <span class="flashcard-rating-label">{btn.label}</span>
                <span class="flashcard-rating-time">{btn.time}</span>
              </button>
            )}
          </For>
        </div>
      </Show>

      {/* Stats */}
      <div class="flashcard-stats">
        <span class="flashcard-stat">
          <span class="flashcard-stat-label">New:</span>
          <span class="flashcard-stat-new">{stats().new}</span>
        </span>
        <span class="flashcard-stat">
          <span class="flashcard-stat-label">Learning:</span>
          <span class="flashcard-stat-learning">{stats().learning}</span>
        </span>
        <span class="flashcard-stat">
          <span class="flashcard-stat-label">Review:</span>
          <span class="flashcard-stat-review">{stats().review}</span>
        </span>
      </div>
    </div>
  );
};
