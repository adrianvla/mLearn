import { Component, Show, For, createSignal, createEffect, createMemo, onMount, onCleanup } from 'solid-js';
import type { TranslationEntry, Token } from '../../../shared/types';
import { WINDOW_TYPES } from '../../../shared/constants';
import { normalizeReading } from '../../../shared/utils/textUtils';
import { WindowWrapper, useSettings, useFlashcards, useLanguage, useLocalization } from '../../context';
import { getBridge } from '../../../shared/bridges';
import { getWordStatus, toUniqueIdentifier } from '../../services/statsService';
import { fetchTranslation } from '../../hooks/useTranslation';
import { useTokenizer } from '../../hooks/useTranslation';
import { PillBtn, PillLabel, PitchAccentOverlay, Spinner, ClockIcon } from '../../components/common';
import { WordStatusPill } from '../../components/common/Smart';
import {
  buildWordHoverFlashcardContent,
  extractPitchAccentFromTranslationData,
  extractReadingFromEntries,
  numericToWordStatus,
  type WordHoverTranslationData,
} from '../../components/subtitle/wordHoverHelpers';
import { openWordLookup } from '../../services/wordLookupService';
import { getWordFormCandidates } from '../../utils/wordForms';
import './WordDefinition.css';

const ICON_CROSS2 = 'cross2';
const ICON_CHECK = 'check';

const WordDefinitionContent: Component = () => {
  const { settings } = useSettings();
  const { addFlashcard, hasWordSync, getCardByWordSync } = useFlashcards();
  const { getFrequency, getLanguageFeatures, currentLangData, getCanonicalForm, getWordVariants } = useLanguage();
  const { tokenize } = useTokenizer({ language: settings.language });
  const { t } = useLocalization();

  const [word, setWord] = createSignal('');
  const [translationEntries, setTranslationEntries] = createSignal<TranslationEntry[]>([]);
  const [translationData, setTranslationData] = createSignal<WordHoverTranslationData | undefined>();
  const [pitchAccent, setPitchAccent] = createSignal<{ position: number; reading: string } | null>(null);
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
    setPitchAccent(null);
    setPosType('');

    // Generate UUID
    toUniqueIdentifier(w).then((uuid) => setWordUuid(uuid)).catch(() => {});

    fetchTranslation(w, settings.language)
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

        // Extract pitch accent
        const features = getLanguageFeatures();
        if (features.supportsPitchAccent && settings.showPitchAccent) {
          const reading = normalizeReading(extractReadingFromEntries(data));
          const position = extractPitchAccentFromTranslationData(resp);
          if (reading && reading.length > 1 && position !== undefined) {
            setPitchAccent({ position, reading });
          }
        }

        // POS not available on TranslationEntry — would need tokenization
      })
      .catch((err) => {
        if (id !== fetchId) return;
        console.error('WordDefinition: translation fetch failed:', err);
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
    return getCardByWordSync(w);
  });

  const isInSRS = createMemo(() => {
    if (isAddingFlashcard()) return true;
    const w = word();
    if (!w) return false;
    return hasWordSync(w);
  });

  const currentEase = createMemo(() => currentFlashcard()?.ease);

  const wordForms = createMemo(() => getWordFormCandidates(word(), getCanonicalForm, getWordVariants));
  const manualStatus = createMemo(() =>
    numericToWordStatus(getWordStatus(wordForms()[0] ?? word(), wordForms().slice(1)))
  );

  const levelPillData = createMemo(() => {
    const w = word();
    if (!w) return null;
    const freq = getFrequency(w);
    if (freq) return { level: freq.raw_level, name: freq.level };
    return null;
  });

  const wordFreqEntry = createMemo(() => {
    const w = word();
    return w ? getFrequency(w) : null;
  });

  const isTracked = createMemo(() => isInSRS());

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
        level: freq?.raw_level ?? -1,
        manualStatus: manualStatus(),
        colourCodes: settings.colour_codes || currentLangData()?.colour_codes || {},
        tokenize,
        srsLearningEase: settings.srsLearningEase,
        srsKnownEase: settings.srsKnownEase,
      });
      await addFlashcard(content, ease);
    } catch (err) {
      console.error('Failed to add flashcard:', err);
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
    const text = anchor.textContent?.trim();
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
                  <Show when={entry.reading}>
                    <div class="word-definition__reading">{entry.reading}</div>
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
          <PitchAccentOverlay
            word={word()}
            reading={pitchAccent()?.reading || ''}
            pitchPosition={pitchAccent()?.position ?? null}
            pos={posType()}
            mode="pill"
            showParticleBox={true}
            homogenous={true}
          />
          <Show when={levelPillData()}>
            {(data) => (
              <PillLabel level={data().level}>{data().name}</PillLabel>
            )}
          </Show>
          <Show when={posType() && settings.show_pos}>
            <PillLabel>{posType()}</PillLabel>
          </Show>
          <WordStatusPill word={word()} />
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
