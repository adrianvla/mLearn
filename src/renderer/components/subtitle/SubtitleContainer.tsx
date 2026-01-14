/**
 * Subtitle Container Component
 * Displays the current subtitle with interactive words
 */

import { Component, JSX, Show, For, createSignal, createMemo } from 'solid-js';
import type { Token, DictionaryEntry } from '../../../shared/types';
import { useSettings } from '../../context';
import { useWordHover, useDictionary, type HoverData } from '../../hooks';
import { SubtitleWord } from './SubtitleWord';
import { WordHover } from './WordHover';
import { GlassPanel } from '../common/GlassPanel';

export interface SubtitleContainerProps {
  tokens: Token[];
  originalText?: string;
  translation?: string;
  isLoading?: boolean;
  onWordClick?: (token: Token) => void;
  style?: JSX.CSSProperties;
}

export const SubtitleContainer: Component<SubtitleContainerProps> = (props) => {
  const { settings } = useSettings();
  const { hoverData, setHoverData, isVisible, show, hide } = useWordHover();
  const { lookup } = useDictionary();

  const [dictionaryEntries, setDictionaryEntries] = createSignal<DictionaryEntry[]>([]);
  const [isLoadingDict, setIsLoadingDict] = createSignal(false);

  // Handle word hover
  const handleWordHover = async (token: Token, rect: DOMRect) => {
    // Position hover below the word
    const position = {
      x: rect.left,
      y: rect.bottom + 8,
    };

    setHoverData({ token, position });
    show();

    // Look up dictionary entry
    if (settings.showDictionary) {
      setIsLoadingDict(true);
      try {
        const entries = await lookup(token.surface, token.reading);
        setDictionaryEntries(entries);
      } catch (e) {
        console.error('Dictionary lookup failed:', e);
        setDictionaryEntries([]);
      } finally {
        setIsLoadingDict(false);
      }
    }
  };

  const handleWordLeave = () => {
    // Delay hiding to allow moving to hover popup
    setTimeout(() => {
      // Check if mouse is over the hover popup
      const hoverPopup = document.querySelector('.word-hover-container');
      if (hoverPopup && hoverPopup.matches(':hover')) {
        return;
      }
      hide();
    }, 100);
  };

  const handleWordClick = (token: Token) => {
    props.onWordClick?.(token);
  };

  // Determine subtitle style based on settings
  const subtitleStyle = createMemo((): JSX.CSSProperties => ({
    'font-size': `${settings.subtitleFontSize}px`,
    'font-family': settings.subtitleFont || 'inherit',
    'text-align': 'center',
    'line-height': '1.6',
    padding: '0.5rem 1rem',
    ...props.style,
  }));

  const containerStyle = (): JSX.CSSProperties => ({
    position: 'absolute',
    bottom: settings.subtitlePosition === 'bottom' ? '60px' : 'auto',
    top: settings.subtitlePosition === 'top' ? '60px' : 'auto',
    left: '50%',
    transform: 'translateX(-50%)',
    'max-width': '90%',
    'z-index': '100',
  });

  return (
    <>
      <Show when={props.tokens.length > 0 || props.isLoading}>
        <div style={containerStyle()}>
          <GlassPanel variant="dark" blur="md" rounded="lg" padding="sm">
            {/* Loading state */}
            <Show when={props.isLoading}>
              <div
                style={{
                  ...subtitleStyle(),
                  color: 'var(--text-secondary)',
                }}
              >
                Tokenizing...
              </div>
            </Show>

            {/* Subtitle text */}
            <Show when={!props.isLoading && props.tokens.length > 0}>
              <div style={subtitleStyle()}>
                <For each={props.tokens}>
                  {(token, index) => (
                    <SubtitleWord
                      token={token}
                      index={index()}
                      onClick={handleWordClick}
                      onHover={handleWordHover}
                      onLeave={handleWordLeave}
                    />
                  )}
                </For>
              </div>
            </Show>

            {/* Translation */}
            <Show when={settings.showTranslation && props.translation}>
              <div
                style={{
                  'font-size': `${(settings.subtitleFontSize || 24) * 0.75}px`,
                  color: 'var(--text-secondary)',
                  'text-align': 'center',
                  'margin-top': '0.5rem',
                  'padding-top': '0.5rem',
                  'border-top': '1px solid var(--glass-border)',
                }}
              >
                {props.translation}
              </div>
            </Show>
          </GlassPanel>
        </div>
      </Show>

      {/* Word hover popup */}
      <Show when={isVisible() && hoverData()}>
        <WordHover
          token={hoverData()!.token}
          position={hoverData()!.position}
          dictionaryEntries={dictionaryEntries()}
          isLoading={isLoadingDict()}
          onClose={hide}
        />
      </Show>
    </>
  );
};
