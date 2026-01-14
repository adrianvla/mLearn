/**
 * Flashcard Review Component
 * SRS review interface with rating buttons
 */

import { Component, JSX, Show, createSignal, createMemo } from 'solid-js';
import { useFlashcards } from '../../context';
import { FlashcardDisplay } from './FlashcardDisplay';
import { GlassButton } from '../common/GlassButton';
import { GlassPanel } from '../common/GlassPanel';

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

  const containerStyle = (): JSX.CSSProperties => ({
    display: 'flex',
    'flex-direction': 'column',
    'align-items': 'center',
    gap: '2rem',
    padding: '2rem',
    height: '100%',
    ...props.style,
  });

  // Rating buttons config
  const ratingButtons = [
    { quality: 'again' as const, label: 'Again', color: 'var(--color-danger)', subtitle: '< 1 min' },
    { quality: 'hard' as const, label: 'Hard', color: 'var(--color-warning)', subtitle: '~6 min' },
    { quality: 'good' as const, label: 'Good', color: 'var(--color-success)', subtitle: '~10 min' },
    { quality: 'easy' as const, label: 'Easy', color: 'var(--color-primary)', subtitle: '~4 days' },
  ];

  return (
    <div style={containerStyle()}>
      {/* Progress */}
      <div style={{ width: '100%', 'max-width': '500px' }}>
        <div
          style={{
            display: 'flex',
            'justify-content': 'space-between',
            'margin-bottom': '0.5rem',
            'font-size': '0.875rem',
            color: 'var(--text-secondary)',
          }}
        >
          <span>Progress</span>
          <span>
            {currentIndex()}/{dueCards().length} cards
          </span>
        </div>
        <div
          style={{
            height: '6px',
            'background-color': 'var(--glass-bg)',
            'border-radius': 'var(--radius-full)',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              height: '100%',
              width: `${progress()}%`,
              'background-color': 'var(--color-primary)',
              transition: 'width 0.3s ease',
            }}
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
            style={{
              display: 'flex',
              'flex-direction': 'column',
              'align-items': 'center',
              'justify-content': 'center',
              padding: '3rem',
              'text-align': 'center',
              'max-width': '500px',
              width: '100%',
              height: '300px',
            }}
          >
            <h2
              style={{
                'font-size': '1.5rem',
                'font-weight': '600',
                color: 'var(--text-primary)',
                'margin-bottom': '1rem',
              }}
            >
              🎉 Review Complete!
            </h2>
            <p
              style={{
                color: 'var(--text-secondary)',
                'margin-bottom': '2rem',
              }}
            >
              You've reviewed all due cards for now.
            </p>
            <div style={{ display: 'flex', gap: '1rem' }}>
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
        <div
          style={{
            display: 'flex',
            gap: '0.75rem',
            'flex-wrap': 'wrap',
            'justify-content': 'center',
          }}
        >
          {ratingButtons.map((btn) => (
            <button
              style={{
                display: 'flex',
                'flex-direction': 'column',
                'align-items': 'center',
                gap: '0.25rem',
                padding: '0.75rem 1.5rem',
                'min-width': '80px',
                background: 'var(--glass-bg)',
                border: `2px solid ${btn.color}`,
                'border-radius': 'var(--radius-md)',
                color: btn.color,
                cursor: 'pointer',
                transition: 'all 0.2s ease',
              }}
              onClick={() => handleRating(btn.quality)}
            >
              <span style={{ 'font-weight': '600' }}>{btn.label}</span>
              <span
                style={{
                  'font-size': '0.75rem',
                  opacity: '0.7',
                }}
              >
                {btn.subtitle}
              </span>
            </button>
          ))}
        </div>
      </Show>

      {/* Stats */}
      <div
        style={{
          display: 'flex',
          gap: '2rem',
          'font-size': '0.875rem',
          color: 'var(--text-secondary)',
        }}
      >
        <span>New: {stats().new}</span>
        <span>Learning: {stats().learning}</span>
        <span>Review: {stats().review}</span>
      </div>
    </div>
  );
};
