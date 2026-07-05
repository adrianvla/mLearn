import { Component, Show, For, createSignal, createEffect, createMemo, onMount, onCleanup } from 'solid-js';
import type { TranslationEntry, Token } from '../../../shared/types';
import { WINDOW_TYPES } from '../../../shared/constants';
import { WindowWrapper, useSettings, useFlashcards, useLanguage, useLocalization } from '../../context';
import { getBridge } from '../../../shared/bridges';
import { toUniqueIdentifier } from '../../services/statsService';
import { fetchTranslation, getCachedTranslation } from '../../hooks/useTranslation';
import { useTokenizer } from '../../hooks/useTranslation';
import { PillBtn, PillLabel, Spinner, ClockIcon } from '../../components/common';
import { ProsodyOverlay } from '../../components/language-specific';
import { WordStatusPill } from '../../components/common/Smart';
import {
  buildWordHoverFlashcardContent,
  resolveProsodyForHover,
  type WordHoverTranslationData,
} from '../../components/subtitle/wordHoverHelpers';
import { openWordLookup } from '../../services/wordLookupService';
import { getDictionaryTargetLanguageForSettings } from '../../utils/dictionaryTargetLanguage';
import { extractReadingValue } from '../../utils/translationCacheParsers';
import { getFrequencyLevelVisualRank } from '../../../shared/languageFeatures';
import { prosodyVisible } from '../../../shared/prosodySettings';
import './WordDefinition.css';
import { getLogger } from '../../../shared/utils/logger';

const log = getLogger("renderer.wordDefinition.app");

const ICON_CROSS2 = 'cross2';
const ICON_CHECK = 'check';

const WordDefinitionContent: Component = () => {
  const { settings } = useSettings();
  const { addFlashcard, hasWordSync, getCardByWordSync, getComprehensiveWordStatusSync } = useFlashcards();
  const { getFrequency, getFreqLevelNames, currentLangData, getCanonicalForm, getWordVariants, getReadingVariants } = useLanguage();
  const { tokenize } = useTokenizer({ language: settings.language, languageData: currentLangData });
  const { t } = useLocalization();
  const dictionaryTargetLanguage = createMemo(() => getDictionaryTargetLanguageForSettings(settings));
  const wordLookupOptions = { getCanonicalForm, getWordVariants, getReadingVariants, dictionaryTargetLanguage, languageData: currentLangData };

  const [word, setWord] = createSignal('');
  const [translationEntries, setTranslationEntries] = createSignal<TranslationEntry[]>([]);
  const [translationData, setTranslationData] = createSignal<WordHoverTranslationData | undefined>();
  const [isLoading, setIsLoading] = createSignal(false);
  const [posType, setPosType] = createSignal('');
  const [isAddingFlashcard, setIsAddingFlashcard] = createSignal(false);
  const [wordUuid, setWordUuid] = createSignal('');


  let fetchId = 0;

  // Read the word from the window context
  onMount(() => {
    const bridge = getBridge();
    const cleanup = bridge.window.onWindowContext((ctx) => {
      if (ctx && typeof ctx.word === 'string') {
        setWord(ctx.word);
      }
    });
    bridge.window.getWindowContext(WINDOW_TYPES.WORD_DEFINITION);
    if (cleanup) onCleanup(cleanup);
  });

  // Fetch translation when word changes
  createEffect(() => {
    const w = word();
    if (!w) return;

    const id = ++fetchId;
    setIsLoading(true);
    setTranslationEntries([]);
    setTranslationData(undefined);
    setPosType('');

    // Generate UUID
    toUniqueIdentifier(w).then((uuid) => setWordUuid(uuid)).catch(() => {});

    fetchTranslation(w, settings.language, wordLookupOptions)
      .then((resp) => {
        if (id !== fetchId) return;
        const data = resp?.data || [];
        const entries: TranslationEntry[] = [];
        for (const item of data) {
          if (!item || typeof item !== 'object') continue;
          const entry = item as TranslationEntry;
          if (entry.definitions) entries.push(entry);
        }
        setTranslationEntries(entries);
        setTranslationData(resp ? { data: resp.data } : undefined);

        // POS not available on TranslationEntry — would need tokenization
      })
      .catch((err) => {
        if (id !== fetchId) return;
        log.error('WordDefinition: translation fetch failed:', err);
      })
      .finally(() => {
        if (id !== fetchId) return;
        setIsLoading(false);
      });
  });


  // Reactive flashcard/status state
  const currentFlashcard = createMemo(() => {
    const w = word();
    if (!w) return null;
    return getCardByWordSync(w, settings.language);
  });

  const isInSRS = createMemo(() => {
    if (isAddingFlashcard()) return true;
    const w = word();
    if (!w) return false;
    return hasWordSync(w, settings.language);
  });

  const currentEase = createMemo(() => currentFlashcard()?.ease);

  const comprehensiveStatus = createMemo(() => getComprehensiveWordStatusSync(word(), settings.language));

  const definitionProsody = createMemo(() => {
    return resolveProsodyForHover({
      word: word(),
      translationData: translationData(),
      showProsody: prosodyVisible(settings),
      getCanonicalForm,
      getWordVariants,
      getCachedTranslation,
      language: settings.language,
      languageData: currentLangData(),
      dictionaryTargetLanguage,
      fallbackLabel: t('mlearn.CardEditor.Fields.ProsodyPosition'),
    });
  });

  const levelPillData = createMemo(() => {
    const w = word();
    if (!w) return null;
    const freq = getFrequency(w);
    if (freq) {
      return {
        level: freq.raw_level,
        visualLevel: getFrequencyLevelVisualRank(freq.raw_level, getFreqLevelNames(), currentLangData()),
        name: freq.level,
      };
    }
    return null;
  });

  const wordFreqEntry = createMemo(() => {
    const w = word();
    return w ? getFrequency(w) : null;
  });

  const isTracked = createMemo(() => isInSRS());

  const entryReading = (entry: TranslationEntry) => extractReadingValue(entry, currentLangData()) ?? '';

  const handleAddFlashcard = async (e?: MouseEvent) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    if (isAddingFlashcard()) return;
    setIsAddingFlashcard(true);

    const w = word();
    try {
      const token: Token = { word: w, surface: w, actual_word: w, type: '' };
      const freq = wordFreqEntry();
      const { content, ease } = await buildWordHoverFlashcardContent({
        token,
        word: w,
        translationData: translationData(),
        contextPhrase: undefined,
        isOcr: false,
        wordUuid: wordUuid(),
        level: freq?.raw_level,
        wordStatus: comprehensiveStatus(),
        colourCodes: settings.colour_codes || {},
        languageData: currentLangData(),
        tokenize,
        srsLearningEase: settings.srsLearningThreshold / 1000,
        srsKnownEase: settings.known_ease_threshold / 1000,
      });
      await addFlashcard(content, ease, undefined, settings.language);
    } catch (err) {
      log.error('Failed to add flashcard:', err);
      alert(t('mlearn.WordHover.Errors.FailedToAddFlashcard', { error: String(err) }));
    } finally {
      setIsAddingFlashcard(false);
    }
  };


  // Intercept anchor clicks in definition HTML to open new word definition windows
  const handleContentClick = (e: MouseEvent) => {
    const target = e.target as HTMLElement;
    const anchor = target.closest('a');
    if (!anchor) return;
    e.preventDefault();
    e.stopPropagation();
    const clone = anchor.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('rt, rp').forEach((el) => { el.remove(); });
    const text = clone.textContent?.trim();
    if (text) {
      openWordLookup(text);
    }
  };

  return (
    <div class="word-definition">
      <div class="word-definition__header">
        <h1 class="word-definition__title">{word()}</h1>
      </div>

      <div class="word-definition__body" onClick={handleContentClick}>
        <Show when={isLoading()}>
          <div class="word-definition__loading">
            <Spinner size={24} />
            <span>{t('mlearn.WordHover.Loading')}</span>
          </div>
        </Show>

        <Show when={!isLoading()}>
          <Show when={translationEntries().length > 0}>
            <For each={translationEntries()}>
              {(entry, index) => (
                <>
                  <Show when={index() > 0}>
                    <hr class="word-definition__divider" />
                  </Show>
                  <div
                    class="word-definition__translation"
                    innerHTML={
                      Array.isArray(entry.definitions)
                        ? entry.definitions.join('; ')
                        : String(entry.definitions) || ''
                    }
                  />
                  <Show when={entryReading(entry)}>
                    {(reading) => <div class="word-definition__reading">{reading()}</div>}
                  </Show>
                </>
              )}
            </For>
          </Show>

          <Show when={!isLoading() && translationEntries().length === 0}>
            <div class="word-definition__empty">
              {t('mlearn.WordHover.NoTranslation')}
            </div>
          </Show>
        </Show>
      </div>

      <div class="word-definition__footer">
        <div class="word-definition__pills">
          <Show when={definitionProsody()?.renderer === 'inline-overlay' ? definitionProsody() : null}>
            {(prosody) => (
              <ProsodyOverlay
                word={word()}
                reading={prosody().reading}
                prosodyPosition={prosody().position}
                prosodyType={prosody().type}
                languageData={currentLangData()}
                pos={posType()}
                mode="pill"
                showParticleBox={true}
                homogenous={true}
              />
            )}
          </Show>
          <Show when={definitionProsody()?.renderer === 'label' ? definitionProsody() : null}>
            {(prosody) => (
              <PillLabel variant="gray" class="prosody-position-pill">
                <span class="prosody-position-pill__label">{prosody().label}</span>
                <span class="prosody-position-pill__value">{prosody().value}</span>
              </PillLabel>
            )}
          </Show>
          <Show when={levelPillData()}>
            {(data) => (
              <PillLabel level={data().level} visualLevel={data().visualLevel}>{data().name}</PillLabel>
            )}
          </Show>
          <Show when={posType() && settings.show_pos}>
            <PillLabel>{posType()}</PillLabel>
          </Show>
          <WordStatusPill word={word()} language={settings.language} />
          <Show when={isTracked()} fallback={
            <Show when={isAddingFlashcard()} fallback={
              <PillBtn
                variant="blue"
                icon={ICON_CROSS2}
                iconRotation={45}
                label={t('mlearn.Global.Flashcard')}
                onClick={handleAddFlashcard}
              />
            }>
              <PillBtn
                variant="yellow"
                icon={<ClockIcon size={14} />}
                label={t('mlearn.Global.Status.Adding')}
                disabled={true}
              />
            </Show>
          }>
            <PillBtn
              variant="green"
              icon={ICON_CHECK}
              label={t('mlearn.Flashcards.Card.Tracked')}
            />
          </Show>
          <Show when={isTracked() && currentEase() !== undefined}>
            <div class="word-definition__ease">
              <span>{t('mlearn.Flashcards.Card.Ease')} {Math.round((currentEase()!) * 100) / 100}</span>
            </div>
          </Show>
        </div>
      </div>
    </div>
  );
};

export const WordDefinitionApp: Component = () => {
  return (
    <WindowWrapper showDragRegion={true}>
      <WordDefinitionContent />
    </WindowWrapper>
  );
};
