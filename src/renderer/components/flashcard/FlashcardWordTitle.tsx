/**
 * FlashcardWordTitle Component
 * Displays a flashcard word title with metadata-driven reading annotations and prosody.
 */

import { Component, Show, createMemo } from 'solid-js';
import type { JSX } from 'solid-js';
import { ProsodyOverlay, WordWithReading } from '../language-specific';
import { useLanguage, useLocalization, useSettings } from '../../context';
import {
  getProsodyDisplayValueFromContent,
  getProsodyPositionFromContent,
  getProsodyPositionLabel,
  getReadingAnnotationScripts,
} from '../../../shared/languageFeatures';
import type { FlashcardContent } from '../../../shared/types';
import type { WordWithReadingRenderTextOptions } from '../language-specific/WordWithReading';
import {
  canRenderStoredProsodyWithoutMetadata,
  getProsodyOverlayRenderer,
} from '../../utils/prosodyPresentation';
import { getProsodyOverlayTextTarget } from '../../utils/prosodyOverlayTarget';
import './FlashcardWordTitle.css';

export interface FlashcardWordTitleProps {
  content: FlashcardContent;
  /** Language code saved on the flashcard/suggestion. Used instead of the active language when available. */
  language?: string;
}

export const FlashcardWordTitle: Component<FlashcardWordTitleProps> = (props) => {
  const { currentLangData, langData } = useLanguage();
  const { settings } = useSettings();
  const { t } = useLocalization();
  const word = () => props.content.front;
  const reading = () => props.content.reading || props.content.front;
  const languageData = createMemo(() => (
    props.language
      ? langData?.[props.language] ?? (props.language === settings.language ? currentLangData() : null)
      : currentLangData()
  ));
  const storedProsodyPosition = createMemo(() => (
    props.content.prosody?.position ?? null
  ));
  const prosodyOverlayRenderer = createMemo(() => (
    getProsodyOverlayRenderer(languageData(), props.content.prosody?.type)
  ));
  const canRenderProsodyOverlay = createMemo(() => prosodyOverlayRenderer() !== null);
  const hasStoredProsodyOverlay = createMemo(() => (
    canRenderStoredProsodyWithoutMetadata(props.content.prosody?.type)
  ));
  const prosodyOverlayPosition = createMemo(() => (
    canRenderProsodyOverlay() ? storedProsodyPosition() : null
  ));
  const genericProsodyPreview = createMemo(() => {
    if (canRenderProsodyOverlay()) return null;
    const position = getProsodyPositionFromContent(props.content, languageData());
    const value = getProsodyDisplayValueFromContent(props.content, languageData());
    if (!value) return null;
    return {
      label: getProsodyPositionLabel(languageData()) ?? t('mlearn.CardEditor.Fields.ProsodyPosition'),
      position,
      value,
    };
  });

  const hasDistinctReading = createMemo(() => {
    const r = props.content.reading;
    return !!r && r !== props.content.front;
  });
  const shouldForceStoredReading = createMemo(() => {
    if (!hasDistinctReading()) return false;
    if (hasStoredProsodyOverlay()) return true;
    return getReadingAnnotationScripts(languageData()).length > 0;
  });
  const renderText = (text: JSX.Element, options: WordWithReadingRenderTextOptions) => {
    if (!canRenderProsodyOverlay()) {
      return <span class={options.class} style={options.style}>{text}</span>;
    }
    const overlayTarget = getProsodyOverlayTextTarget(word(), reading(), options);
    return (
      <ProsodyOverlay
        word={overlayTarget.word}
        reading={overlayTarget.reading}
        prosodyPosition={prosodyOverlayPosition()}
        prosodyType={props.content.prosody?.type}
        allowStoredProsodyWithoutMetadata={hasStoredProsodyOverlay()}
        language={props.language}
        languageData={languageData()}
        pos={props.content.pos}
        mode="overlay"
        isReadingScript={options.isReadingScript}
        class={options.slot === 'reading' ? 'prosody-overlay-wrapper--reading' : options.class}
        style={options.style}
      >
        {text}
      </ProsodyOverlay>
    );
  };

  return (
    <div class="flashcard-word-title fc-prosody">
      <WordWithReading
        word={word()}
        reading={reading()}
        language={props.language}
        languageData={languageData()}
        class="flashcard-word-title__reading fc-reading-annotation"
        forceShowReadingAnnotation={shouldForceStoredReading()}
        renderText={renderText}
      />
      <Show when={genericProsodyPreview()}>
        {(preview) => (
            <span class="flashcard-word-title__prosody-position fc-prosody-position">
              <span class="flashcard-word-title__prosody-label fc-prosody-position-label">{preview().label}</span>
            <span class="flashcard-word-title__prosody-value fc-prosody-position-value">{preview().value}</span>
            </span>
          )}
      </Show>
    </div>
  );
};

export default FlashcardWordTitle;
