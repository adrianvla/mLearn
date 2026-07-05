import { Component, createEffect, createMemo, createSignal, For, Show, untrack } from 'solid-js';
import { Modal, Btn } from '../../components/common';
import { WordWithReading } from '../../components/language-specific';
import { useFlashcards, useLanguage, useLocalization, useSettings } from '../../context';
import { showToast } from '../../components/common/Feedback/Toast';
import { createVirtualizer } from '../../hooks/useVirtualizer';
import {
  getWordLevelStatus,
  buildLearningWordSet,
  resolveLevelStudyWordFrequency,
} from '../../utils/wordLevelStats';
import { buildKnownWordSetFromStore, buildTrackedWordSet } from '../../utils/knowledgeUtils';
import { getReadingAnnotationScripts } from '../../../shared/languageFeatures';
import type { LanguageData } from '../../../shared/types';

interface LevelDetailModalProps {
  level: number;
  levelName: string;
  language: string;
  languageData: LanguageData | null;
  onClose: () => void;
}

interface WordListItem {
  word: string;
  reading: string;
  status: 'known' | 'learning' | 'unknown' | 'untracked';
}

const SLIDER_LABELS = ['Unknown', 'Learning', 'Known'] as const;
const SLIDER_FILTER_VALUES = ['unknown', 'learning', 'known'] as const;
const SLIDER_TARGET_STATUS: Array<'new' | 'learning' | 'known'> = ['new', 'learning', 'known'];
const ROW_HEIGHT = 40;

export const LevelDetailModal: Component<LevelDetailModalProps> = (props) => {
  const { t } = useLocalization();
  const flashcards = useFlashcards();
  const language = useLanguage();
  const { settings } = useSettings();
  const [sliderIndex, setSliderIndex] = createSignal(1);
  const [isAdding, setIsAdding] = createSignal(false);
  let listRef: HTMLDivElement | undefined;

  const activeLanguage = createMemo(() => props.language || settings.language);
  const activeLanguageData = createMemo(() => props.languageData ?? language.currentLangData());
  const usesReadingAnnotationRenderer = createMemo(() => (
    getReadingAnnotationScripts(activeLanguageData()).length > 0
  ));

  const buildWordsForLevelSnapshot = (): WordListItem[] => {
    const lang = activeLanguage();
    const langData = activeLanguageData();
    const freq = resolveLevelStudyWordFrequency({}, langData);
    const knownThreshold = settings.known_ease_threshold;
    const learningThreshold = settings.srsLearningThreshold;

    return untrack(() => {
      const store = flashcards.store;
      const knownSet = buildKnownWordSetFromStore(store, knownThreshold);
      const learningSet = buildLearningWordSet(store, learningThreshold, knownThreshold);
      const trackedSet = buildTrackedWordSet(store, lang);

      const result: WordListItem[] = [];
      for (const [word, entry] of Object.entries(freq)) {
        if (entry.raw_level !== props.level) continue;
        const status = getWordLevelStatus(word, lang, knownSet, learningSet, trackedSet);
        result.push({ word, reading: entry.reading || '', status });
      }
      return result.sort((a, b) => a.word.localeCompare(b.word));
    });
  };

  const [wordsForLevel, setWordsForLevel] = createSignal<WordListItem[]>([], { equals: false });

  createEffect(() => {
    props.level;
    activeLanguage();
    activeLanguageData();
    settings.known_ease_threshold;
    settings.srsLearningThreshold;
    setWordsForLevel(buildWordsForLevelSnapshot());
  });

  const selectedWords = createMemo(() => {
    const threshold = SLIDER_FILTER_VALUES[sliderIndex()];
    const order = ['untracked', 'unknown', 'learning', 'known'] as const;
    const maxIndex = order.indexOf(threshold);
    return wordsForLevel().filter((w) => order.indexOf(w.status) <= maxIndex);
  });

  const countsByStatus = createMemo(() => {
    const counts = { known: 0, learning: 0, unknown: 0, untracked: 0 };
    for (const w of wordsForLevel()) {
      counts[w.status]++;
    }
    return counts;
  });

  const virtualizer = createMemo(() => {
    const items = selectedWords();
    return createVirtualizer({
      count: items.length,
      getScrollElement: () => listRef,
      estimateSize: () => ROW_HEIGHT,
      overscan: 8,
    });
  });

  const handleAddFlashcards = async () => {
    const words = selectedWords().map((w) => w.word);
    if (words.length === 0) return;
    const targetStatus = SLIDER_TARGET_STATUS[sliderIndex()];
    setIsAdding(true);
    try {
      const result = await flashcards.addLevelStudyFlashcards(words, targetStatus, activeLanguage());
      showToast({
        message: t('mlearn.LevelStudy.DetailModal.WordsAdded', {
          count: String(result.created + result.promoted),
        }),
        variant: 'success',
        duration: 4000,
      });
      props.onClose();
    } catch (e) {
      showToast({
        message: t('mlearn.LevelStudy.DetailModal.Error'),
        variant: 'error',
        duration: 4000,
      });
    } finally {
      setIsAdding(false);
    }
  };

  const statusClass = (status: WordListItem['status']) => {
    switch (status) {
      case 'known': return 'level-detail-status-known';
      case 'learning': return 'level-detail-status-learning';
      case 'unknown': return 'level-detail-status-unknown';
      case 'untracked': return 'level-detail-status-untracked';
    }
  };

  const statusLabel = (status: WordListItem['status']) => {
    switch (status) {
      case 'known': return t('mlearn.LevelStudy.LevelCard.Known');
      case 'learning': return t('mlearn.LevelStudy.LevelCard.Learning');
      case 'unknown': return t('mlearn.LevelStudy.LevelCard.Unknown');
      case 'untracked': return t('mlearn.LevelStudy.LevelCard.Untracked');
    }
  };

  return (
    <Modal
      isOpen={true}
      onClose={props.onClose}
      title={props.levelName}
      size="lg"
      closeOnEscape
      closeOnOverlay
      footer={
        <div class="level-detail-footer">
          <div class="level-detail-footer-actions">
            <span class="level-detail-footer-count">
              {selectedWords().length} {t('mlearn.LevelStudy.DetailModal.Selected')}
            </span>
            <Btn
              size="sm"
              variant="primary"
              onClick={handleAddFlashcards}
              disabled={selectedWords().length === 0 || isAdding()}
            >
              {isAdding()
                ? t('mlearn.LevelStudy.DetailModal.Adding')
                : t('mlearn.LevelStudy.DetailModal.AddFlashcards', { count: String(selectedWords().length) })}
            </Btn>
          </div>
        </div>
      }
    >
      <div class="level-detail-modal-content">
        <div class="level-detail-slider-section">
          <div class="level-detail-slider-labels">
            <For each={SLIDER_LABELS}>
              {(label, idx) => (
                <button
                  type="button"
                  class={`level-detail-slider-label ${sliderIndex() === idx() ? 'active' : ''}`}
                  onClick={() => setSliderIndex(idx())}
                >
                  {t(`mlearn.LevelStudy.LevelCard.${label}` as const)}
                  <span class="level-detail-slider-count">
                    {idx() === 0
                      ? countsByStatus().untracked + countsByStatus().unknown
                      : idx() === 1
                      ? countsByStatus().untracked + countsByStatus().unknown + countsByStatus().learning
                      : countsByStatus().untracked + countsByStatus().unknown + countsByStatus().learning + countsByStatus().known}
                  </span>
                </button>
              )}
            </For>
          </div>
          <input
            type="range"
            min={0}
            max={2}
            step={1}
            value={sliderIndex()}
            onInput={(e) => setSliderIndex(Number(e.currentTarget.value))}
            class="level-detail-slider"
          />
          <p class="level-detail-slider-hint">
            {t('mlearn.LevelStudy.DetailModal.SliderHint', {
              status: t(`mlearn.LevelStudy.LevelCard.${SLIDER_LABELS[sliderIndex()]}` as const),
            })}
          </p>
        </div>

        <div class="level-detail-word-list" ref={listRef}>
          <Show when={selectedWords().length > 0} fallback={
            <div class="level-detail-empty">{t('mlearn.LevelStudy.DetailModal.NoWords')}</div>
          }>
            <div style={{ position: 'relative', width: '100%', height: `${virtualizer().getTotalSize()}px` }}>
              <For each={virtualizer().getVirtualItems()}>
                {(item) => {
                  const wordItem = selectedWords()[item.index];
                  return (
                    <div
                      class="level-detail-word-row"
                      data-index={item.index}
                      style={{
                        position: 'absolute',
                        top: '0',
                        left: '0',
                        width: '100%',
                        height: `${ROW_HEIGHT}px`,
                        transform: `translateY(${item.start}px)`,
                      }}
                    >
                      <div class="level-detail-word-info">
                        <Show
                          when={usesReadingAnnotationRenderer() || !wordItem.reading}
                          fallback={
                            <>
                              <span class="level-detail-word-text">{wordItem.word}</span>
                              <span class="level-detail-word-reading">{wordItem.reading}</span>
                            </>
                          }
                        >
                          <WordWithReading
                            word={wordItem.word}
                            reading={wordItem.reading}
                            language={activeLanguage()}
                            languageData={activeLanguageData()}
                            class="level-detail-word-text"
                            forceShowReadingAnnotation={!!wordItem.reading}
                          />
                        </Show>
                      </div>
                      <span class={`level-detail-status-pill ${statusClass(wordItem.status)}`}>
                        {statusLabel(wordItem.status)}
                      </span>
                    </div>
                  );
                }}
              </For>
            </div>
          </Show>
        </div>
      </div>
    </Modal>
  );
};

export default LevelDetailModal;
