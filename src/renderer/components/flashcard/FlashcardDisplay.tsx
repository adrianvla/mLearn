/**
 * Flashcard Component
 * Single flashcard with flip animation
 */

import { Component, JSX, Show, createSignal, createMemo } from 'solid-js';
import type { Flashcard } from '../../../shared/types';
import { GlassPanel } from '../common/GlassPanel';
import { useSettings } from '../../context';

export interface FlashcardDisplayProps {
  flashcard: Flashcard;
  showAnswer?: boolean;
  onFlip?: () => void;
  style?: JSX.CSSProperties;
}

export const FlashcardDisplay: Component<FlashcardDisplayProps> = (props) => {
  const { settings } = useSettings();
  const [isFlipped, setIsFlipped] = createSignal(props.showAnswer ?? false);

  // Access content through the nested structure
  const content = () => props.flashcard.content;

  const handleFlip = () => {
    setIsFlipped(!isFlipped());
    props.onFlip?.();
  };

  const containerStyle = (): JSX.CSSProperties => ({
    perspective: '1000px',
    cursor: 'pointer',
    'user-select': 'none',
    width: '100%',
    'max-width': '500px',
    height: '300px',
    margin: '0 auto',
    ...props.style,
  });

  const cardStyle = (): JSX.CSSProperties => ({
    position: 'relative',
    width: '100%',
    height: '100%',
    'transform-style': 'preserve-3d',
    transition: 'transform 0.6s ease',
    transform: isFlipped() ? 'rotateY(180deg)' : 'rotateY(0deg)',
  });

  const faceStyle = (isBack: boolean): JSX.CSSProperties => ({
    position: 'absolute',
    width: '100%',
    height: '100%',
    'backface-visibility': 'hidden',
    display: 'flex',
    'flex-direction': 'column',
    'align-items': 'center',
    'justify-content': 'center',
    padding: '2rem',
    'text-align': 'center',
    transform: isBack ? 'rotateY(180deg)' : 'none',
  });

  return (
    <div style={containerStyle()} onClick={handleFlip}>
      <div style={cardStyle()}>
        {/* Front */}
        <GlassPanel variant="dark" blur="lg" rounded="xl" style={faceStyle(false)}>
          <div
            style={{
              'font-size': '2.5rem',
              'font-weight': '600',
              'margin-bottom': '0.5rem',
              color: 'var(--text-primary)',
            }}
          >
            {content().word}
          </div>
          
          <Show when={content().pronunciation && content().pronunciation !== content().word}>
            <div
              style={{
                'font-size': '1.25rem',
                color: 'var(--text-secondary)',
                'margin-bottom': '1rem',
              }}
            >
              {content().pronunciation}
            </div>
          </Show>

          <Show when={content().example}>
            <div
              style={{
                'font-size': '1rem',
                color: 'var(--text-secondary)',
                'margin-top': '1rem',
                'line-height': '1.5',
              }}
            >
              {content().example}
            </div>
          </Show>

          <div
            style={{
              position: 'absolute',
              bottom: '1rem',
              'font-size': '0.75rem',
              color: 'var(--text-muted)',
            }}
          >
            Click to reveal answer
          </div>
        </GlassPanel>

        {/* Back */}
        <GlassPanel variant="dark" blur="lg" rounded="xl" style={faceStyle(true)}>
          <div
            style={{
              'font-size': '1.5rem',
              color: 'var(--text-primary)',
              'margin-bottom': '1rem',
              'line-height': '1.6',
            }}
          >
            {content().translation?.join(', ') || content().definition?.join(', ')}
          </div>

          <Show when={content().exampleMeaning}>
            <div
              style={{
                'font-size': '1rem',
                color: 'var(--text-secondary)',
                'line-height': '1.5',
              }}
            >
              {content().exampleMeaning}
            </div>
          </Show>

          <div
            style={{
              position: 'absolute',
              bottom: '1rem',
              'font-size': '0.75rem',
              color: 'var(--text-muted)',
            }}
          >
            Click to flip back
          </div>
        </GlassPanel>
      </div>
    </div>
  );
};
