import { Component, createMemo, createSignal, For, Show } from 'solid-js';
import { Modal, Btn } from '../../components/common';
import { useFlashcards, useLanguage, useLocalization, useSettings } from '../../context';
import { showToast } from '../../components/common/Feedback/Toast';
import { createVirtualizer } from '../../hooks/useVirtualizer';
import {
  getWordExamStatus,
  buildLearningWordSet,
} from '../../utils/wordLevelStats';
import { buildKnownWordSetFromStore, buildTrackedWordSet } from '../../utils/knowledgeUtils';
import type { WordFrequencyMap } from '../../../shared/types';

interface ExamLevelDetailModalProps {
  level: number;
  levelName: string;
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

export const ExamLevelDetailModal: Component<ExamLevelDetailModalProps> = (props) => {
  const { t } = useLocalization();
  const flashcards = useFlashcards();
  const language = useLanguage();
  const { settings } = useSettings();
  const [sliderIndex, setSliderIndex] = createSignal(1);
  const [isAdding, setIsAdding] = createSignal(false);
  let listRef: HTMLDivElement | undefined;

  const wordsForLevel = createMemo(() => {
    const freq = language.wordFrequency as WordFrequencyMap;
    const store = flashcards.store;
    const lang = settings.language;
    const knownSet = buildKnownWordSetFromStore(store, settings.known_ease_threshold);
    const learningSet = buildLearningWordSet(store, settings.srsLearningThreshold, settings.known_ease_threshold);
    const trackedSet = buildTrackedWordSet(store, lang);

    const result: WordListItem[] = [];
    for (const [word, entry] of Object.entries(freq)) {
      if (entry.raw_level !== props.level) continue;
      const status = getWordExamStatus(word, lang, knownSet, learningSet, trackedSet);
      result.push({ word, reading: entry.reading || '', status });
    }
    return result.sort((a, b) => a.word.localeCompare(b.word));
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
      const result = await flashcards.addExamStudyFlashcards(words, targetStatus);
      showToast({
        message: t('mlearn.ExamStudy.DetailModal.WordsAdded', {
          count: String(result.created + result.promoted),
        }),
        variant: 'success',
        duration: 4000,
      });
      props.onClose();
    } catch (e) {
      showToast({
        message: t('mlearn.ExamStudy.DetailModal.Error'),
        variant: 'error',
        duration: 4000,
      });
    } finally {
      setIsAdding(false);
    }
  };

  const statusClass = (status: WordListItem['status']) => {
    switch (status) {
      case 'known': return 'exam-detail-status-known';
      case 'learning': return 'exam-detail-status-learning';
      case 'unknown': return 'exam-detail-status-unknown';
      case 'untracked': return 'exam-detail-status-untracked';
    }
  };

  const statusLabel = (status: WordListItem['status']) => {
    switch (status) {
      case 'known': return t('mlearn.ExamStudy.LevelCard.Known');
      case 'learning': return t('mlearn.ExamStudy.LevelCard.Learning');
      case 'unknown': return t('mlearn.ExamStudy.LevelCard.Unknown');
      case 'untracked': return t('mlearn.ExamStudy.LevelCard.Untracked');
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
        <div class="exam-detail-footer">
          <div class="exam-detail-footer-actions">
            <span class="exam-detail-footer-count">
              {selectedWords().length} {t('mlearn.ExamStudy.DetailModal.Selected')}
            </span>
            <Btn
              size="sm"
              variant="primary"
              onClick={handleAddFlashcards}
              disabled={selectedWords().length === 0 || isAdding()}
            >
              {isAdding()
                ? t('mlearn.ExamStudy.DetailModal.Adding')
                : t('mlearn.ExamStudy.DetailModal.AddFlashcards', { count: String(selectedWords().length) })}
            </Btn>
          </div>
        </div>
      }
    >
      <div class="exam-detail-modal-content">
        <div class="exam-detail-slider-section">
          <div class="exam-detail-slider-labels">
            <For each={SLIDER_LABELS}>
              {(label, idx) => (
                <button
                  type="button"
                  class={`exam-detail-slider-label ${sliderIndex() === idx() ? 'active' : ''}`}
                  onClick={() => setSliderIndex(idx())}
                >
                  {t(`mlearn.ExamStudy.LevelCard.${label}` as const)}
                  <span class="exam-detail-slider-count">
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
            class="exam-detail-slider"
          />
          <p class="exam-detail-slider-hint">
            {t('mlearn.ExamStudy.DetailModal.SliderHint', {
              status: t(`mlearn.ExamStudy.LevelCard.${SLIDER_LABELS[sliderIndex()]}` as const),
            })}
          </p>
        </div>

        <div class="exam-detail-word-list" ref={listRef}>
          <Show when={selectedWords().length > 0} fallback={
            <div class="exam-detail-empty">{t('mlearn.ExamStudy.DetailModal.NoWords')}</div>
          }>
            <div style={{ position: 'relative', width: '100%', height: `${virtualizer().getTotalSize()}px` }}>
              <For each={virtualizer().getVirtualItems()}>
                {(item) => {
                  const wordItem = selectedWords()[item.index];
                  return (
                    <div
                      class="exam-detail-word-row"
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
                      <div class="exam-detail-word-info">
                        <span class="exam-detail-word-text">{wordItem.word}</span>
                        <Show when={wordItem.reading}>
                          <span class="exam-detail-word-reading">{wordItem.reading}</span>
                        </Show>
                      </div>
                      <span class={`exam-detail-status-pill ${statusClass(wordItem.status)}`}>
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

export default ExamLevelDetailModal;
