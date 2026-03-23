import { Component, Show, For, createSignal, createEffect, createMemo, onMount, onCleanup } from 'solid-js';
import type { TranslationEntry, Token } from '../../../shared/types';
import { WORD_STATUS, WINDOW_TYPES } from '../../../shared/constants';
import { normalizeReading } from '../../../shared/utils/textUtils';
import { WindowWrapper, useSettings, useFlashcards, useLanguage, useLocalization } from '../../context';
import { getBridge } from '../../../shared/bridges';
import { setWordStatus, toUniqueIdentifier, wordsLearnedInApp } from '../../services/statsService';
import { isWordInAnkiCache } from '../../services/ankiWordsCache';
import { fetchTranslation } from '../../hooks/useTranslation';
import { useTokenizer } from '../../hooks/useTranslation';
import { PillBtn, PillLabel, PitchAccentOverlay, Spinner, ClockIcon } from '../../components/common';
import {
  buildWordHoverFlashcardContent,
  extractPitchAccentFromTranslationData,
  extractReadingFromEntries,
  getEffectiveWordStatus,
  numericToWordStatus,
  wordStatusToNumeric,
  type WordStatus,
  type WordHoverTranslationData,
} from '../../components/subtitle/wordHoverHelpers';
import { openWordLookup } from '../../services/wordLookupService';
import './WordDefinition.css';

const ICON_CROSS2 = 'cross2';
const ICON_CHECK = 'check';

const WordDefinitionContent: Component = () => {
  const { settings } = useSettings();
  const { addFlashcard, hasWordSync, getCardByWordSync } = useFlashcards();
  const { getFrequency, getLanguageFeatures, currentLangData } = useLanguage();
  const { tokenize } = useTokenizer();
  const { t } = useLocalization();

  const [word, setWord] = createSignal('');
  const [translationEntries, setTranslationEntries] = createSignal<TranslationEntry[]>([]);
  const [translationData, setTranslationData] = createSignal<WordHoverTranslationData | undefined>();
  const [pitchAccent, setPitchAccent] = createSignal<{ position: number; reading: string } | null>(null);
  const [isLoading, setIsLoading] = createSignal(false);
  const [currentStatus, setCurrentStatus] = createSignal<WordStatus>('unknown');
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

    // Load word status
    const allStatuses = wordsLearnedInApp();
    const storedStatus = allStatuses[w] ?? WORD_STATUS.UNKNOWN;
    setCurrentStatus(numericToWordStatus(storedStatus));

    // Generate UUID
    toUniqueIdentifier(w).then((uuid) => setWordUuid(uuid)).catch(() => {});

    fetchTranslation(w)
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

  const effectiveStatus = createMemo(() => getEffectiveWordStatus(
    currentFlashcard(), currentStatus(),
    settings.use_anki && isWordInAnkiCache(word()),
    settings.knowledgeSourceOrder, settings.knowledgeResolutionMode
  ));

  const statusVariant = createMemo(() => {
    const s = effectiveStatus();
    return s === 'unknown' ? 'red' : s === 'learning' ? 'orange' : 'green';
  });

  const statusIcon = createMemo(() => effectiveStatus() === 'unknown' ? ICON_CROSS2 : ICON_CHECK);

  const statusLabel = createMemo(() => {
    const s = effectiveStatus();
    return s === 'unknown'
      ? t('mlearn.WordHover.Status.Unknown')
      : s === 'learning'
        ? t('mlearn.WordHover.Status.Learning')
        : t('mlearn.WordHover.Status.Known');
  });

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

  const handleStatusChange = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const statusOrder: WordStatus[] = ['unknown', 'learning', 'known'];
    const currentIdx = statusOrder.indexOf(currentStatus());
    const nextIdx = (currentIdx + 1) % statusOrder.length;
    const newStatus = statusOrder[nextIdx];
    setCurrentStatus(newStatus);
    const w = word();
    if (w) {
      setWordStatus(w, wordStatusToNumeric(newStatus));
    }
  };

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
        manualStatus: currentStatus(),
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
          <PillBtn
            variant={statusVariant()}
            icon={statusIcon()}
            label={statusLabel()}
            onClick={handleStatusChange}
          />
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
