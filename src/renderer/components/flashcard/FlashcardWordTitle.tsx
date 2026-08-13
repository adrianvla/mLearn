/**
 * FlashcardWordTitle Component
 * Displays a flashcard word title with metadata-driven reading annotations and prosody.
 */

import { Component, Show, createMemo } from 'solid-js';
import { WordWithReading } from '../language-specific';
import { useFlashcards, useLanguage, useLocalization, useSettings } from '../../context';
import {
  getPartOfSpeechColor,
  getProsodyDisplayValueFromContent,
  getProsodyPositionFromContent,
  getProsodyPositionFromOverride,
  getProsodyPositionLabel,
  getReadingAnnotationScripts,
} from '../../../shared/languageFeatures';
import type { FlashcardContent } from '../../../shared/types';
import {
  canRenderStoredProsodyWithoutMetadata,
  getProsodyOverlayRenderer,
} from '../../utils/prosodyPresentation';
import type { WordProsodyOverlayData, WordRenderTextContext } from '../../utils/wordRenderText';
import { cacheVersion, getCachedTranslation } from '../../hooks/useTranslation';
import { extractProsodyData } from '../../utils/translationCacheParsers';
import { getDictionaryTargetLanguageForSettings } from '../../utils/dictionaryTargetLanguage';
import './FlashcardWordTitle.css';

export interface FlashcardWordTitleProps {
  content: FlashcardContent;
  /** Language code saved on the flashcard/suggestion. Used instead of the active language when available. */
  language?: string;
}

export const FlashcardWordTitle: Component<FlashcardWordTitleProps> = (props) => {
  const { currentLangData, langData, getCanonicalFormForLanguage, getWordVariantsForLanguage, getReadingVariantsForLanguage } = useLanguage();
  const { settings } = useSettings();
  const { t } = useLocalization();
  const flashcards = useFlashcards();
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
  const dictionaryTargetLanguage = createMemo(() => (
    getDictionaryTargetLanguageForSettings(settings, props.language ?? settings.language)
  ));
  const lookupLanguage = () => props.language ?? settings.language;
  const lookupOptions = {
    getCanonicalForm: (word: string) => getCanonicalFormForLanguage(lookupLanguage(), word),
    getWordVariants: (word: string) => getWordVariantsForLanguage(lookupLanguage(), word),
    getReadingVariants: (reading: string) => getReadingVariantsForLanguage(lookupLanguage(), reading),
    dictionaryTargetLanguage,
    languageData,
  };
  const cachedTranslation = createMemo(() => {
    cacheVersion();
    const w = word();
    if (!w) return null;
    return getCachedTranslation(w, lookupLanguage(), lookupOptions);
  });
  const coloredProsodyPosition = createMemo(() => {
    const stored = storedProsodyPosition();
    if (stored !== null) return stored;
    const prosody = extractProsodyData(cachedTranslation()?.data, languageData());
    return getProsodyPositionFromOverride(null, prosody);
  });
  const comprehensiveKnowledge = createMemo(() => {
    const w = word();
    if (!w) return { status: 'unknown' as const, source: 'None' as const, timesSeen: 0 };
    return flashcards.getComprehensiveWordStatusWithSourceSync(w, props.language ?? settings.language);
  });
  const wordIsKnown = createMemo(() => comprehensiveKnowledge().status === 'known');
  const getWordColor = createMemo((): string | undefined => {
    if (!settings.enableWordColoring) return undefined;
    if (!settings.colorKnownWords && wordIsKnown()) return undefined;
    if (!settings.do_colour_codes) return undefined;
    const pos = props.content.pos;
    if (!pos) return undefined;
    return getPartOfSpeechColor(pos, settings.colour_codes, languageData());
  });
  const coloredProsodyCtx: WordRenderTextContext = {
    languageData,
    prosodyPosition: coloredProsodyPosition,
    ease: () => comprehensiveKnowledge().ease,
    partOfSpeechColor: getWordColor,
    status: () => comprehensiveKnowledge().status,
    isKnown: wordIsKnown,
    surface: 'other',
    settings: () => settings,
  };
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
  const prosodyOverlayData = createMemo<WordProsodyOverlayData | null>(() => {
    if (!canRenderProsodyOverlay()) return null;
    return {
      position: prosodyOverlayPosition(),
      type: props.content.prosody?.type,
      pos: props.content.pos,
      allowStoredProsodyWithoutMetadata: hasStoredProsodyOverlay(),
    };
  });
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

  return (
    <div class="flashcard-word-title fc-prosody">
      <WordWithReading
        word={word()}
        reading={reading()}
        language={props.language}
        languageData={languageData()}
        class="flashcard-word-title__reading fc-reading-annotation"
        forceShowReadingAnnotation={shouldForceStoredReading()}
        coloredProsody={coloredProsodyCtx}
        prosodyOverlay={prosodyOverlayData()}
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
