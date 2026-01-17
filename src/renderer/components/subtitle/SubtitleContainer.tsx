/**
 * Subtitle Container Component
 * Displays the current subtitle with interactive words
 */

import { Component, JSX, Show, For, createSignal, createMemo, createEffect } from 'solid-js';
import type { Token, DictionaryEntry, TranslationResponse } from '../../../shared/types';
import { useSettings, useLanguage } from '../../context';
import { useWordHover, useDictionary, useTranslation } from '../../hooks';
import { SubtitleWord } from './SubtitleWord';
import { WordHover, WordStatus } from './WordHover';

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
  const { isTranslatable } = useLanguage();
  const { hoverData, isVisible, showHover, hideHover, cancelHide } = useWordHover();
  const { lookup } = useDictionary();
  const { translateWord } = useTranslation({ immediate: true });

  const [dictionaryEntries, setDictionaryEntries] = createSignal<DictionaryEntry[]>([]);
  const [isLoadingDict, setIsLoadingDict] = createSignal(false);
  const [translationData, setTranslationData] = createSignal<TranslationResponse | null>(null);
  const [wordStatus, setWordStatus] = createSignal<WordStatus>('unknown');
  const [currentHoverToken, setCurrentHoverToken] = createSignal<Token | null>(null);

  let hoverRequestId = 0;
  let lastSubtitleKey = '';
  let liveTranslatorSeen = new Set<string>();

  // Handle word hover - only for translatable words
  const handleWordHover = async (token: Token, rect: DOMRect, el: HTMLElement) => {
    const pos = token.partOfSpeech ?? token.type ?? '';
    
    // Check if this POS is translatable
    if (!isTranslatable(pos)) {
      return;
    }
    
    const requestId = ++hoverRequestId;
    const position = {
      x: rect.left + rect.width / 2,
      y: rect.top,
    };

    // Use actual_word (dictionary form) for translation, fallback to surface form
    const lookupWord = token.actual_word ?? token.surface ?? token.word;
    const displayWord = token.surface ?? token.word;
    
    // Clear previous data and set current token
    setTranslationData(null);
    setDictionaryEntries([]);
    setIsLoadingDict(false);
    setCurrentHoverToken(token);
    
    showHover({ 
      word: displayWord,
      token, 
      translation: null,
      position,
      anchorRect: rect,
      element: el 
    });

    try {
      // Use dictionary form (actual_word) for translation lookup
      const translation = await translateWord(lookupWord);
      
      // Check if this request is still current (race condition protection)
      if (requestId !== hoverRequestId) return;
      if (currentHoverToken() !== token) return;
      
      setTranslationData(translation);
      
      // Live word translator
      if (settings.openAside && typeof window !== 'undefined' && (window as any).mLearnLiveTranslator) {
        const first = translation?.data?.[0] as { definitions?: string | string[]; reading?: string } | undefined;
        let translationText = '';
        if (first?.definitions) {
          if (Array.isArray(first.definitions)) {
            translationText = first.definitions.join('; ');
          } else if (typeof first.definitions === 'string') {
            translationText = first.definitions;
          }
        }
        const reading = first?.reading ?? token.reading ?? '';
        if (translationText) {
          (window as any).mLearnLiveTranslator.addCard(displayWord, reading, translationText);
        }
      }
    } catch (e) {
      console.error('Translation failed:', e);
    }

    // Look up dictionary entry
    if (settings.showDictionary) {
      setIsLoadingDict(true);
      try {
        const entries = await lookup(lookupWord, token.reading);
        // Check if this request is still current
        if (requestId !== hoverRequestId) return;
        if (currentHoverToken() !== token) return;
        setDictionaryEntries(entries);
      } catch (e) {
        console.error('Dictionary lookup failed:', e);
        if (requestId !== hoverRequestId) return;
        if (currentHoverToken() !== token) return;
        setDictionaryEntries([]);
      } finally {
        if (requestId === hoverRequestId && currentHoverToken() === token) {
          setIsLoadingDict(false);
        }
      }
    }
  };

  const handleWordLeave = () => {
    hideHover();
  };

  const handleWordClick = (token: Token) => {
    props.onWordClick?.(token);
  };

  // Determine subtitle style based on settings
  const subtitleStyle = createMemo((): JSX.CSSProperties => ({
    'font-size': `${settings.subtitle_font_size}px`,
    'font-family': settings.subtitleFont || 'inherit',
    'text-align': 'center',
    'line-height': '1.6',
    padding: '0.5rem 1rem',
    ...props.style,
  }));

  // Get subtitle theme class
  const getSubtitleThemeClass = () => {
    const theme = settings.subtitleTheme || 'shadow';
    return `theme-${theme}`;
  };

  // Determine visibility - use not-shown class for fade animation
  const hasContent = () => props.tokens.length > 0 || props.originalText || props.isLoading;
  const shouldShow = () => (settings.showSubtitles ?? true) && hasContent();

  // Container class with theme and visibility state
  const getContainerClass = () => {
    const classes = ['subtitles', getSubtitleThemeClass()];
    if (!shouldShow()) {
      classes.push('not-shown');
    }
    return classes.join(' ');
  };

  // Append live translator entries as subtitles appear (not just on hover)
  // Only for translatable words
  createEffect(() => {
    if (!settings.openAside) return;
    if (typeof window === 'undefined') return;
    const translator = (window as any).mLearnLiveTranslator;
    if (!translator || typeof translator.addCard !== 'function') return;
    const tokens = props.tokens || [];
    if (!tokens.length) return;

    const subtitleKey = tokens.map((t) => t.surface ?? t.word).join('|');
    if (subtitleKey !== lastSubtitleKey) {
      lastSubtitleKey = subtitleKey;
      liveTranslatorSeen = new Set();
    }

    for (const token of tokens) {
      const pos = token.partOfSpeech ?? token.type ?? '';
      // Only process translatable words
      if (!isTranslatable(pos)) continue;
      
      const displayWord = token.surface ?? token.word;
      const lookupWord = token.actual_word ?? displayWord;
      
      if (!displayWord || liveTranslatorSeen.has(displayWord)) continue;
      liveTranslatorSeen.add(displayWord);
      
      (async () => {
        try {
          const translation = await translateWord(lookupWord);
          const first = translation?.data?.[0] as { definitions?: string | string[]; reading?: string } | undefined;
          let translationText = '';
          if (first?.definitions) {
            translationText = Array.isArray(first.definitions)
              ? first.definitions.join('; ')
              : String(first.definitions);
          }
          const reading = first?.reading ?? token.reading ?? '';
          if (translationText) translator.addCard(displayWord, reading, translationText);
        } catch (_e) {
          /* ignore translation failures for live list */
        }
      })();
    }
  });

  return (
    <>
      <div class={getContainerClass()}>
        {/*<GlassPanel variant="dark" blur="md" rounded="lg" padding="sm">*/}
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

          {/* Fallback text when tokens are unavailable */}
          <Show when={!props.isLoading && props.tokens.length === 0 && props.originalText}>
            <div style={subtitleStyle()}>{props.originalText}</div>
          </Show>

          {/* Translation */}
          <Show when={settings.showTranslation && props.translation}>
            <div
              style={{
                'font-size': `${(settings.subtitle_font_size || 24) * 0.75}px`,
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
        {/*</GlassPanel>*/}
      </div>

      {/* Word hover popup */}
      <Show when={hoverData()}>
        <WordHover
          token={hoverData()!.token!}
          word={hoverData()!.word || hoverData()!.token?.surface || hoverData()!.token?.word || ''}
          position={hoverData()!.position}
          anchorRect={hoverData()!.anchorRect}
          dictionaryEntries={dictionaryEntries()}
          translationData={translationData() || undefined}
          status={wordStatus()}
          isLoading={isLoadingDict()}
          contextPhrase={props.originalText || props.tokens.map(t => t.surface ?? t.word).join('')}
          onStatusChange={setWordStatus}
          onClose={hideHover}
          visible={isVisible()}
          onMouseEnter={cancelHide}
          onMouseLeave={hideHover}
        />
      </Show>
    </>
  );
};
