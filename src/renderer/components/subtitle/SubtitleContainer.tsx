/**
 * Subtitle Container Component
 * Displays the current subtitle with interactive words
 */

import { Component, JSX, Show, For, createSignal, createMemo, createEffect, onCleanup } from 'solid-js';
import { DEFAULT_SETTINGS, type Token, type DictionaryEntry, type TranslationResponse } from '../../../shared/types';
import { useSettings, useLanguage, useFlashcards } from '../../context';
import { useWordHover, useDictionary, useTranslation, getCachedTranslation } from '../../hooks';
import { SubtitleWord } from './SubtitleWord';
import { WordHover, WordStatus } from './WordHover';
import { ExplainerPopup } from './ExplainerPopup';
import { initWordLookupBridge } from '../../services/wordLookupService';
import { tokensToPlainText } from '../../utils/phraseExtraction';
import { getTokenLookupWord } from '../../utils/wordForms';
import { getDictionaryTargetLanguageForSettings } from '../../utils/dictionaryTargetLanguage';
import { extractReadingValue } from '../../utils/translationCacheParsers';
import { getLanguageCssDirection, getSubtitleFontFamily, getTokenJoinSeparator } from '../../../shared/languageFeatures';
import './SubtitleContainer.css';
import { getLogger } from '../../../shared/utils/logger';

const log = getLogger("renderer.components.subtitleContainer");

const PASSIVE_SUBTITLE_EASE_BUMP = 0.01;

export interface SubtitleContainerProps {
  tokens: Token[];
  originalText?: string;
  remoteHtml?: string | null;
  remoteSize?: number | null;
  remoteWeight?: number | null;
  translation?: string;
  isLoading?: boolean;
  onWordClick?: (token: Token) => void;
  style?: JSX.CSSProperties;
  /** Subtitle start time in seconds (for video clip flashcards) */
  subtitleStart?: number;
  /** Subtitle end time in seconds (for video clip flashcards) */
  subtitleEnd?: number;
  /** Video source URL (for video clip flashcards) */
  videoSrc?: string;
  lastScreenshot?: string;
}

export const SubtitleContainer: Component<SubtitleContainerProps> = (props) => {
  const { settings } = useSettings();
  const { isTokenTranslatable, detectGrammarInText, supportsGrammar, getCanonicalForm, getWordVariants, getReadingVariants, currentLangData, getLanguageFeatures } = useLanguage();
  const flashcardCtx = useFlashcards();
  const { hoverData, isVisible, showHover, hideHover, cancelHide, forceHide } = useWordHover();
  const dictionaryTargetLanguage = createMemo(() => getDictionaryTargetLanguageForSettings(settings));
  const lookupOptions = { getCanonicalForm, getWordVariants, getReadingVariants, dictionaryTargetLanguage, languageData: currentLangData };
  const { lookup } = useDictionary({ language: settings.language, ...lookupOptions });
  const { translateWord } = useTranslation({ immediate: true, language: settings.language, ...lookupOptions });

  const [dictionaryEntries, setDictionaryEntries] = createSignal<DictionaryEntry[]>([]);
  const [isLoadingDict, setIsLoadingDict] = createSignal(false);
  const [translationData, setTranslationData] = createSignal<TranslationResponse | null>(null);
  const [wordStatus, setWordStatus] = createSignal<WordStatus>('unknown');
  const [currentHoverToken, setCurrentHoverToken] = createSignal<Token | null>(null);
  
  // Explainer popup state
  const [explainerOpen, setExplainerOpen] = createSignal(false);
  const [explainerWord, setExplainerWord] = createSignal('');
  const [explainerContext, setExplainerContext] = createSignal('');
  const [explainerPosition, setExplainerPosition] = createSignal<{ x: number; y: number }>({ x: 0, y: 0 });
  const tokenSeparator = createMemo(() => getTokenJoinSeparator(currentLangData()));
  const tokenizerCapabilities = createMemo(() => getLanguageFeatures().tokenizerCapabilities);

  // Initialize deep link bridge for mlearn://lookup
  const cleanupBridgeLookup = initWordLookupBridge();
  onCleanup(cleanupBridgeLookup);

  let hoverRequestId = 0;
  let lastSubtitleKey = '';
  let lastLiveTranslatorKey = '';
  
  // Handle opening the explainer popup
  const handleOpenExplainer = (word: string, context: string, position: { x: number; y: number }) => {
    setExplainerWord(word);
    setExplainerContext(context);
    setExplainerPosition(position);
    setExplainerOpen(true);

    // Grammar failure tracking: using explainer = user didn't understand the phrase
    if (supportsGrammar()) {
      const tokens = props.tokens || [];
      const matched = detectGrammarInText(tokens);
      for (const g of matched) {
        flashcardCtx.trackGrammarFailed(g.pattern, g.level, settings.language);
      }
    }
  };
  
  const handleCloseExplainer = () => {
    setExplainerOpen(false);
  };

  // Handle word hover - only for translatable words
  const handleWordHover = async (token: Token, rect: DOMRect, el: HTMLElement) => {
    if (!isTokenTranslatable(token)) {
      return;
    }

    // Track hover (signals potential unknown word, debounced in FlashcardContext)
    const lookupWord = getTokenLookupWord(token, tokenizerCapabilities());
    flashcardCtx.trackWordHovered(lookupWord, token.reading, settings.language);
    
    const requestId = ++hoverRequestId;
    const position = {
      x: rect.left + rect.width / 2,
      y: rect.top,
    };

    // Use actual_word (dictionary form) for translation, fallback to surface form
    const displayWord = token.surface ?? token.word;
    
    // Check if translation is already cached (from pre-fetch)
    // This ensures prosody and level metadata show immediately on first hover
    const cachedTranslation = getCachedTranslation(lookupWord, settings.language, lookupOptions);
    
    setTranslationData(cachedTranslation ?? null);
    setDictionaryEntries([]);
    setIsLoadingDict(false);
    setCurrentHoverToken(token);
    setWordStatus('unknown');
    
    showHover({ 
      word: displayWord,
      token, 
      translation: null,
      position,
      anchorRect: rect,
      element: el 
    });

    // If not cached, fetch translation
    if (!cachedTranslation) {
      try {
        // Use dictionary form (actual_word) for translation lookup
        const translation = await translateWord(lookupWord);
        
        // Check if this request is still current (race condition protection)
        if (requestId !== hoverRequestId) return;
        if (currentHoverToken() !== token) return;
        
        setTranslationData(translation);
      } catch (e) {
        log.error('Translation failed:', e);
      }
    }
    
    // Live word translator
    {
      const translation = translationData();
      const translator = typeof window !== 'undefined' ? window.mLearnLiveTranslator : undefined;
      if (settings.showLiveTranslator !== false && translator && translation) {
        const first = translation?.data?.[0] as { definitions?: string | string[] } | undefined;
        let translationText = '';
        if (first?.definitions) {
          if (Array.isArray(first.definitions)) {
            translationText = first.definitions.join('; ');
          } else if (typeof first.definitions === 'string') {
            translationText = first.definitions;
          }
        }
        const reading = extractReadingValue(first, currentLangData()) ?? token.reading ?? '';
        if (translationText) {
          translator.addCard(displayWord, reading, translationText);
        }
      }
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
        log.error('Dictionary lookup failed:', e);
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
    // Cancel hover timer for the currently hovered word
    const token = currentHoverToken();
    if (token) {
      const word = getTokenLookupWord(token, tokenizerCapabilities());
      flashcardCtx.cancelWordHover(word, settings.language);
    }
    hideHover();
  };

  const handleWordClick = (token: Token) => {
    props.onWordClick?.(token);
  };

  // Determine subtitle style based on settings
  const subtitleStyle = createMemo((): JSX.CSSProperties => ({
    'font-size': `${settings.subtitle_font_size}px`,
    'font-family': settings.subtitleFont?.trim() || getSubtitleFontFamily(currentLangData()),
    direction: getLanguageCssDirection(currentLangData(), settings.language),
    'unicode-bidi': 'isolate',
    'text-align': 'center',
    'line-height': '1.6',
    padding: '0.5rem 1rem',
    ...props.style,
  }));

  const remoteSubtitleStyle = createMemo((): JSX.CSSProperties => ({
    ...subtitleStyle(),
    'font-size': `${props.remoteSize ?? settings.subtitle_font_size}px`,
    'font-weight': `${props.remoteWeight ?? settings.subtitle_font_weight}`,
  }));

  // Get subtitle theme class
  const getSubtitleThemeClass = () => {
    const theme = settings.subtitleTheme || DEFAULT_SETTINGS.subtitleTheme;
    return `theme-${theme}`;
  };

  // Determine visibility - use not-shown class for fade animation
  const hasContent = () => !props.isLoading && (props.tokens.length > 0 || props.originalText);
  const shouldShow = () => (settings.showSubtitles ?? DEFAULT_SETTINGS.showSubtitles!) && hasContent();

  // Check if all tokens in the current subtitle are known (for blur_known_subtitles)
  const allWordsKnown = createMemo(() => {
    const tokens = props.tokens;
    if (!tokens.length) return false;
    return tokens.every(t => {
      // Non-translatable tokens (particles, punctuation) don't affect known status
      if (!isTokenTranslatable(t)) return true;
      const word = getTokenLookupWord(t, tokenizerCapabilities());
      return flashcardCtx.isWordKnownComprehensiveSync(word, settings.language);
    });
  });

  // Container class with theme and visibility state
  const getContainerClass = () => {
    const classes = ['subtitles', getSubtitleThemeClass()];
    const show = shouldShow();
    if (!show) {
      classes.push('not-shown');
    }
    if (settings.blur_known_subtitles && allWordsKnown()) {
      classes.push('subtitle-line-blur');
    }
    return classes.join(' ');
  };

  // Hide hover popup when subtitles change (words re-render, onMouseLeave never fires)
  createEffect(() => {
    props.tokens; // track token changes reactively
    forceHide();
  });

  // Pre-fetch translations for all translatable words when subtitle appears
  // This populates the translation cache for reading annotations and faster hover
  createEffect(() => {
    if (!shouldShow()) return;
    const tokens = props.tokens || [];
    if (!tokens.length) return;

    const subtitleKey = tokens.map((t) => t.surface ?? t.word).join('|');
    if (subtitleKey === lastSubtitleKey) return; // Already processed
    
    lastSubtitleKey = subtitleKey;

    // Track word seen for passive knowledge + populate Token.isKnown
    for (const token of tokens) {
      if (!isTokenTranslatable(token)) continue;
      
      const lookupWord = getTokenLookupWord(token, tokenizerCapabilities());
      if (!lookupWord) continue;

      // Passive word tracking
      flashcardCtx.trackWordSeen(lookupWord, token.reading, PASSIVE_SUBTITLE_EASE_BUMP, settings.language);
    }

    // Passive grammar encounter tracking
    if (supportsGrammar()) {
      const matched = detectGrammarInText(tokens);
      for (const g of matched) {
        flashcardCtx.trackGrammarEncountered(g.pattern, g.level, settings.language);
      }
    }

    // Pre-fetch translations for all translatable words
    // This runs in the background and populates the cache
    for (const token of tokens) {
      if (!isTokenTranslatable(token)) continue;
      
      const lookupWord = getTokenLookupWord(token, tokenizerCapabilities());
      if (!lookupWord) continue;
      
      // Fire and forget - this populates the translation cache
      translateWord(lookupWord).catch(() => {/* ignore prefetch errors */});
    }
  });

  // Append live translator entries as subtitles appear (not just on hover)
  // Only for translatable words
  createEffect(() => {
    if (!shouldShow()) return;
    if (settings.showLiveTranslator === false) return;
    const tokens = props.tokens || [];
    if (!tokens.length) return;
    if (typeof window === 'undefined') return;

    const subtitleKey = tokens.map((t) => t.surface ?? t.word).join('|');
    if (subtitleKey === lastLiveTranslatorKey) return; // Already processed
    lastLiveTranslatorKey = subtitleKey;

    const seenInThisRun = new Set<string>();

    for (const token of tokens) {
      if (!isTokenTranslatable(token)) continue;

      const displayWord = token.surface ?? token.word;
      const lookupWord = getTokenLookupWord(token, tokenizerCapabilities()) || displayWord;

      if (!displayWord) continue;

      // Skip known words unless liveTranslatorIncludeKnown is enabled
      if (!settings.liveTranslatorIncludeKnown) {
        const isKnown = flashcardCtx.isWordKnownComprehensiveSync(lookupWord, settings.language);
        if (isKnown) continue;
      }

      // Deduplicate within this subtitle to avoid double-translating the same word
      if (seenInThisRun.has(displayWord)) continue;
      seenInThisRun.add(displayWord);

      (async () => {
        try {
          const translation = await translateWord(lookupWord);
          const first = translation?.data?.[0] as { definitions?: string | string[] } | undefined;
          let translationText = '';
          if (first?.definitions) {
            translationText = Array.isArray(first.definitions)
              ? first.definitions.join('; ')
              : String(first.definitions);
          }
          const reading = extractReadingValue(first, currentLangData()) ?? token.reading ?? '';
          if (!translationText) return;

          // Retry adding to live translator in case it hasn't mounted yet
          let attempts = 0;
          const tryAddCard = () => {
            const translator = window.mLearnLiveTranslator;
            if (translator && typeof translator.addCard === 'function') {
              translator.addCard(displayWord, reading, translationText);
              return;
            }
            if (++attempts < 10) {
              setTimeout(tryAddCard, 100);
            }
          };
          tryAddCard();
        } catch (_e) {
          log.error("error", _e);
        }
      })();
    }
  });

  return (
    <>
      <div class={getContainerClass()}>
        {/*<GlassPanel variant="elevated" blur="md" rounded="lg" padding="sm">*/}
          {/* Subtitle text */}
          <Show when={!props.isLoading && props.tokens.length > 0}>
            <div style={subtitleStyle()}>
              <For each={props.tokens}>
                {(token, index) => (
                  <>
                    <Show when={index() > 0}>{tokenSeparator()}</Show>
                    <SubtitleWord
                      token={token}
                      index={index()}
                      lookAheadPos={index() < props.tokens.length - 1 ? (props.tokens[index() + 1].partOfSpeech ?? props.tokens[index() + 1].type) : undefined}
                      onClick={handleWordClick}
                      onHover={handleWordHover}
                      onLeave={handleWordLeave}
                    />
                  </>
                )}
              </For>
            </div>
          </Show>

          {/* Fallback text when tokens are unavailable */}
          <Show when={!props.isLoading && props.tokens.length === 0 && props.originalText}>
            <div style={subtitleStyle()}>{props.originalText}</div>
          </Show>

          <Show when={!props.isLoading && props.tokens.length === 0 && !props.originalText && props.remoteHtml}>
            <div style={remoteSubtitleStyle()} innerHTML={props.remoteHtml || ''} />
          </Show>

          {/* Translation */}
          <Show when={settings.showTranslation && props.translation}>
            <div
              style={{
                'font-size': `${(settings.subtitle_font_size || DEFAULT_SETTINGS.subtitle_font_size) * 0.75}px`,
                color: 'var(--text-secondary)',
                'text-align': 'center',
                'margin-top': '0.5rem',
                'padding-top': '0.5rem',
                'border-top': '1px solid var(--border-color)',
              }}
            >
              {props.translation}
            </div>
          </Show>
        {/*</GlassPanel>*/}
      </div>

      {/* Word hover popup */}
      <Show when={hoverData()} keyed>
        {(data) => data.token ? (
          <WordHover
            token={data.token}
            word={data.word || data.token.surface || data.token.word || ''}
            position={data.position}
            anchorRect={data.anchorRect}
            dictionaryEntries={dictionaryEntries()}
            translationData={translationData() || undefined}
            status={wordStatus()}
            isLoading={isLoadingDict()}
            contextPhrase={props.originalText || tokensToPlainText(props.tokens, currentLangData())}
            onStatusChange={setWordStatus}
            onClose={hideHover}
            visible={isVisible()}
            onMouseEnter={cancelHide}
            onMouseLeave={hideHover}
            onOpenExplainer={handleOpenExplainer}
            subtitleStart={props.subtitleStart}
            subtitleEnd={props.subtitleEnd}
            videoSrc={props.videoSrc}
            lastScreenshot={props.lastScreenshot}
          />
        ) : null}
      </Show>
      
      {/* LLM Explainer popup */}
      <ExplainerPopup
        isOpen={explainerOpen()}
        onClose={handleCloseExplainer}
        word={explainerWord()}
        contextPhrase={explainerContext()}
        initialPosition={explainerPosition()}
      />

    </>
  );
};
