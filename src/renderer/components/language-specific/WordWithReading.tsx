/**
 * WordWithReading Component
 *
 * Renders a word with optional ruby-style reading annotation.
 *
 * This is the single source of truth for "word + reading" rendering.
 * Prosody renderers can wrap the displayed text through renderText.
 */

import { Component, Show, createMemo } from 'solid-js';
import type { JSX } from 'solid-js/jsx-runtime';
import {
  adjustReadingAnnotationForSurfaceSuffix,
  getContentFontFamily,
  getLanguageCssDirection,
  getReadingAnnotationDisplay,
  isReadingScriptText,
  wordNeedsReadingAnnotation,
} from '../../../shared/languageFeatures';
import { useLanguage, useSettings } from '../../context';
import type { LanguageData } from '../../../shared/types';
import './RubyText.css';

export interface WordWithReadingRenderTextOptions {
  slot: 'word' | 'reading';
  word: string;
  reading: string;
  displayReading: string;
  isReadingScript: boolean;
  class?: string;
  style?: JSX.CSSProperties;
  language?: string;
  languageData?: LanguageData | null;
}

export interface WordWithReadingProps {
  /** The surface word to display */
  word: string;
  /** Reading/pronunciation annotation. Shown only when language metadata says it applies. */
  reading?: string | null;
  /** Language code for cache lookup when rendering saved cards outside the active language. */
  language?: string;
  /** Language metadata to use for reading/prosody rendering instead of the active language. */
  languageData?: LanguageData | null;
  /** Additional CSS class on the outermost element */
  class?: string;
  /** Force showing the reading annotation even if metadata would normally hide it */
  forceShowReadingAnnotation?: boolean;
  /** Optional wrapper for prosody or script-specific text renderers. */
  renderText?: (text: JSX.Element, options: WordWithReadingRenderTextOptions) => JSX.Element;
}

export const WordWithReading: Component<WordWithReadingProps> = (props) => {
  const { currentLangData, langData } = useLanguage();
  const { settings } = useSettings();
  const resolvedLanguageData = () => (
    props.languageData !== undefined
      ? props.languageData
      : props.language
        ? langData?.[props.language] ?? (props.language === settings.language ? currentLangData() : null)
        : currentLangData()
  );

  const needsReadingAnnotation = createMemo(() => {
    return wordNeedsReadingAnnotation(props.word, props.reading, resolvedLanguageData(), {
      force: props.forceShowReadingAnnotation,
    });
  });

  const effectiveReading = () => props.reading || props.word;
  const displayReading = createMemo(() => {
    return adjustReadingAnnotationForSurfaceSuffix(props.word, effectiveReading(), resolvedLanguageData());
  });
  const wordUsesReadingScript = createMemo(() => isReadingScriptText(props.word, resolvedLanguageData()));
  const annotationDisplay = createMemo(() => getReadingAnnotationDisplay(resolvedLanguageData()));
  const contentStyle = createMemo((): JSX.CSSProperties => ({
    'font-family': getContentFontFamily(resolvedLanguageData()),
    direction: getLanguageCssDirection(resolvedLanguageData(), props.language),
    'unicode-bidi': 'isolate',
  }));
  const renderText = (
    text: JSX.Element,
    options: Omit<WordWithReadingRenderTextOptions, 'word' | 'reading' | 'displayReading' | 'language' | 'languageData'>,
  ) => props.renderText?.(text, {
    ...options,
    word: props.word,
    reading: effectiveReading(),
    displayReading: displayReading(),
    language: props.language,
    languageData: resolvedLanguageData(),
  }) ?? (
    <span class={options.class} style={options.style}>
      {text}
    </span>
  );

  return (
    <Show
      when={needsReadingAnnotation()}
      fallback={
        renderText(props.word, {
          slot: 'word',
          isReadingScript: wordUsesReadingScript(),
          class: props.class,
          style: contentStyle(),
        })
      }
    >
      <Show
        when={annotationDisplay() === 'inline'}
        fallback={
          <ruby class={`ruby-text ${props.class || ''}`} style={contentStyle()}>
            {props.word}
            <rp>(</rp>
            <rt>
              {renderText(displayReading(), {
                slot: 'reading',
                isReadingScript: true,
                class: 'reading-overlay-wrapper--ruby',
              })}
            </rt>
            <rp>)</rp>
          </ruby>
        }
      >
        <span class={`ruby-text ruby-text-inline ${props.class || ''}`} style={contentStyle()}>
          {renderText(props.word, {
            slot: 'word',
            isReadingScript: wordUsesReadingScript(),
            class: 'ruby-text-inline__word',
          })}
          <span class="ruby-text-inline__reading" aria-label={displayReading()}>
            {renderText(displayReading(), {
              slot: 'reading',
              isReadingScript: true,
              class: 'ruby-text-inline__reading-text',
            })}
          </span>
        </span>
      </Show>
    </Show>
  );
};

export default WordWithReading;
