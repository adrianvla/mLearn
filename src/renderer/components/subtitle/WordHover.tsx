/**
 * Word Hover Component
 * Popup that appears when hovering over a word
 */

import { Component, JSX, Show, For, createMemo } from 'solid-js';
import type { Token, DictionaryEntry } from '../../../shared/types';
import { GlassPanel } from '../common/GlassPanel';
import { GlassButton } from '../common/GlassButton';
import { usePitchAccent } from '../../hooks';
import { useSettings, useFlashcard } from '../../context';

export interface WordHoverProps {
  token: Token;
  position: { x: number; y: number };
  dictionaryEntries?: DictionaryEntry[];
  isLoading?: boolean;
  onAddFlashcard?: (token: Token, entry?: DictionaryEntry) => void;
  onPlayAudio?: (word: string) => void;
  onClose?: () => void;
}

export const WordHover: Component<WordHoverProps> = (props) => {
  const { settings } = useSettings();
  const { addFlashcard } = useFlashcard();
  const { getPitchAccentInfo, buildPitchAccentHtml } = usePitchAccent();

  const pitchInfo = createMemo(() => {
    if (!props.token.reading) return null;
    return getPitchAccentInfo(props.token.surface, props.token.reading);
  });

  // Calculate position to keep popup on screen
  const hoverStyle = createMemo((): JSX.CSSProperties => {
    const padding = 16;
    const maxWidth = 400;
    
    let x = props.position.x;
    let y = props.position.y;

    // Adjust if too close to right edge
    if (typeof window !== 'undefined' && x + maxWidth + padding > window.innerWidth) {
      x = window.innerWidth - maxWidth - padding;
    }

    // Ensure minimum x
    if (x < padding) x = padding;

    return {
      position: 'fixed',
      left: `${x}px`,
      top: `${y}px`,
      'max-width': `${maxWidth}px`,
      'min-width': '280px',
      'z-index': '1000',
      'pointer-events': 'auto',
    };
  });

  const handleAddFlashcard = (entry?: DictionaryEntry) => {
    if (props.onAddFlashcard) {
      props.onAddFlashcard(props.token, entry);
    } else {
      // Default flashcard creation
      addFlashcard({
        id: crypto.randomUUID(),
        word: props.token.surface,
        reading: props.token.reading || '',
        meaning: entry?.meanings?.join('; ') || props.token.meaning || '',
        sentence: '', // Would need to get from context
        sentenceMeaning: '',
        createdAt: Date.now(),
        dueAt: Date.now(),
        interval: 0,
        ease: 2.5,
        reviews: 0,
        language: settings.language || 'ja',
      });
    }
  };

  const AddIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );

  const SpeakerIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M11 5L6 9H2v6h4l5 4V5z" />
      <path d="M15.54 8.46a5 5 0 010 7.07" />
    </svg>
  );

  return (
    <div style={hoverStyle()} class="word-hover-container">
      <GlassPanel variant="dark" blur="lg" rounded="lg" padding="md">
        {/* Header */}
        <div
          style={{
            display: 'flex',
            'align-items': 'center',
            'justify-content': 'space-between',
            'margin-bottom': '0.75rem',
            'padding-bottom': '0.5rem',
            'border-bottom': '1px solid var(--glass-border)',
          }}
        >
          <div style={{ display: 'flex', 'align-items': 'center', gap: '0.75rem' }}>
            <span
              style={{
                'font-size': '1.5rem',
                'font-weight': '600',
                color: 'var(--text-primary)',
              }}
            >
              <Show
                when={pitchInfo()}
                fallback={props.token.surface}
              >
                <span innerHTML={buildPitchAccentHtml(props.token.surface, props.token.reading || '', pitchInfo()!)} />
              </Show>
            </span>
            <Show when={props.token.reading && props.token.reading !== props.token.surface}>
              <span style={{ color: 'var(--text-secondary)', 'font-size': '1rem' }}>
                ({props.token.reading})
              </span>
            </Show>
          </div>
          
          <div style={{ display: 'flex', gap: '0.25rem' }}>
            <Show when={props.onPlayAudio}>
              <button
                class="glass-button-ghost"
                style={{
                  padding: '0.375rem',
                  border: 'none',
                  cursor: 'pointer',
                  display: 'flex',
                }}
                onClick={() => props.onPlayAudio?.(props.token.surface)}
                aria-label="Play audio"
              >
                <SpeakerIcon />
              </button>
            </Show>
            <button
              class="glass-button-ghost"
              style={{
                padding: '0.375rem',
                border: 'none',
                cursor: 'pointer',
                display: 'flex',
              }}
              onClick={() => handleAddFlashcard()}
              aria-label="Add flashcard"
            >
              <AddIcon />
            </button>
          </div>
        </div>

        {/* Part of speech */}
        <Show when={props.token.partOfSpeech}>
          <div
            style={{
              'font-size': '0.75rem',
              color: 'var(--text-secondary)',
              'margin-bottom': '0.5rem',
              'text-transform': 'capitalize',
            }}
          >
            {props.token.partOfSpeech}
          </div>
        </Show>

        {/* Loading state */}
        <Show when={props.isLoading}>
          <div
            style={{
              display: 'flex',
              'align-items': 'center',
              'justify-content': 'center',
              padding: '1rem',
              color: 'var(--text-secondary)',
            }}
          >
            Loading...
          </div>
        </Show>

        {/* Dictionary entries */}
        <Show when={props.dictionaryEntries && props.dictionaryEntries.length > 0}>
          <div style={{ display: 'flex', 'flex-direction': 'column', gap: '0.75rem' }}>
            <For each={props.dictionaryEntries}>
              {(entry, index) => (
                <div
                  style={{
                    'padding-top': index() > 0 ? '0.75rem' : '0',
                    'border-top': index() > 0 ? '1px solid var(--glass-border)' : 'none',
                  }}
                >
                  {/* Tags */}
                  <Show when={entry.tags && entry.tags.length > 0}>
                    <div style={{ display: 'flex', gap: '0.25rem', 'flex-wrap': 'wrap', 'margin-bottom': '0.375rem' }}>
                      <For each={entry.tags}>
                        {(tag) => (
                          <span
                            class="pill"
                            style={{
                              'font-size': '0.625rem',
                              padding: '0.125rem 0.375rem',
                            }}
                          >
                            {tag}
                          </span>
                        )}
                      </For>
                    </div>
                  </Show>

                  {/* Meanings */}
                  <div style={{ 'font-size': '0.875rem', color: 'var(--text-primary)' }}>
                    <For each={entry.meanings}>
                      {(meaning, mIndex) => (
                        <div style={{ 'margin-bottom': '0.25rem' }}>
                          <span style={{ color: 'var(--text-secondary)', 'margin-right': '0.5rem' }}>
                            {mIndex() + 1}.
                          </span>
                          {meaning}
                        </div>
                      )}
                    </For>
                  </div>

                  {/* Add this entry button */}
                  <button
                    class="glass-button-ghost"
                    style={{
                      'font-size': '0.75rem',
                      padding: '0.25rem 0.5rem',
                      'margin-top': '0.25rem',
                      border: 'none',
                      cursor: 'pointer',
                    }}
                    onClick={() => handleAddFlashcard(entry)}
                  >
                    <AddIcon /> Add with this meaning
                  </button>
                </div>
              )}
            </For>
          </div>
        </Show>

        {/* No results */}
        <Show when={!props.isLoading && (!props.dictionaryEntries || props.dictionaryEntries.length === 0)}>
          <div style={{ color: 'var(--text-secondary)', 'font-size': '0.875rem' }}>
            <Show when={props.token.meaning} fallback="No dictionary entries found">
              {props.token.meaning}
            </Show>
          </div>
        </Show>
      </GlassPanel>
    </div>
  );
};
