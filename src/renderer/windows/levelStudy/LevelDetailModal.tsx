import { Component, createEffect, createMemo, createSignal, For, Show, untrack } from 'solid-js';
import { Modal, Btn, PillBtn } from '../../components/common';
import { WordWithReading } from '../../components/language-specific';
import { useFlashcards, useLanguage, useLocalization, useSettings } from '../../context';
import { showToast } from '../../components/common/Feedback/Toast';
import { createVirtualizer } from '../../hooks/useVirtualizer';
import {
  getWordLevelStatus,
  buildLearningWordSet,
  buildPassiveOnlyWordSet,
  getLevelStudyLevelNames,
  resolveLevelStudyWordFrequency,
  BEYOND_EXAM_LEVEL,
} from '../../utils/wordLevelStats';
import { buildKnownWordSetFromStore, buildTrackedWordSet } from '../../utils/knowledgeUtils';
import { buildAnkiStatusKeySets } from '../../services/ankiWordsCache';
import { getReadingAnnotationScripts, isDisplayableFrequencyLevel } from '../../../shared/languageFeatures';
import { getProsodyOverlayRenderer } from '../../utils/prosodyPresentation';
import { prosodyVisible } from '../../../shared/prosodySettings';
import { selectEncounterBatch } from '../../learning/engine';
import type { WordProsodyOverlayData } from '../../utils/wordRenderText';
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
// The slider is a SELECTION filter only (words up to a status threshold).
// Curriculum adds never write learner-knowledge claims: cards are scheduler
// seeds ('new'), knowledge accrues from reviews/attempts/claims. Bulk status
// stamping lives in BulkAddModal's explicit target-status dropdown.
const SLIDER_FILTER_VALUES = ['unknown', 'learning', 'known'] as const;
const SLIDER_PILL_VARIANTS = ['red', 'orange', 'green'] as const;
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
  const canRenderProsodyOverlay = createMemo(() => (
    prosodyVisible(settings)
    && getProsodyOverlayRenderer(activeLanguageData(), undefined) !== null
  ));

  const prosodyOverlayData = (): WordProsodyOverlayData | null => (
    canRenderProsodyOverlay() ? {} : null
  );

  const buildWordsForLevelSnapshot = (): WordListItem[] => {
    const lang = activeLanguage();
    const langData = activeLanguageData();
    const freq = resolveLevelStudyWordFrequency({}, langData);
    const knownThreshold = settings.known_ease_threshold;
    const learningThreshold = settings.srsLearningThreshold;

    return untrack(() => {
      const store = flashcards.store;
      const ankiKeys = settings.use_anki
        ? buildAnkiStatusKeySets(
          lang,
          settings.ankiLearningThreshold,
          settings.ankiKnownThreshold,
          (word) => [language.getCanonicalFormForLanguage(lang, word)],
          langData,
        )
        : undefined;
      const knownSet = buildKnownWordSetFromStore(store, knownThreshold, ankiKeys?.known);
      const learningSet = buildLearningWordSet(store, learningThreshold, knownThreshold, ankiKeys?.learning);
      const passiveOnlySet = buildPassiveOnlyWordSet(store);
      const trackedSet = buildTrackedWordSet(store, lang, ankiKeys);

      const result: WordListItem[] = [];
      const levelNames = getLevelStudyLevelNames(langData, freq);
      for (const [word, entry] of Object.entries(freq)) {
        if (props.level === BEYOND_EXAM_LEVEL) {
          if (isDisplayableFrequencyLevel(entry.raw_level, levelNames, langData)) continue;
        } else if (entry.raw_level !== props.level) continue;
        const status = getWordLevelStatus(word, lang, knownSet, learningSet, trackedSet, language.getCanonicalFormForLanguage, passiveOnlySet);
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
    flashcards.isLoading();
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
    const words = selectEncounterBatch({
      preset: 'CURRICULUM',
      nowMs: 0,
      levelStudyItems: selectedWords().map((item) => ({
        key: `${activeLanguage()}:${item.word}`,
        word: item.word,
        language: activeLanguage(),
      })),
    }).map((decision) => decision.candidate.word!);
    if (words.length === 0) return;
    // Curriculum only — scheduler seeds; explicit knowledge marking is not
    // offered here (BulkAddModal's status dropdown or the pill does that).
    const targetStatus = 'new' as const;
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
        <div class="level-detail-status-section">
          <div class="level-detail-status-pills">
            <For each={SLIDER_LABELS}>
              {(label, idx) => (
                <PillBtn
                  variant={SLIDER_PILL_VARIANTS[idx()]}
                  label={t(`mlearn.LevelStudy.LevelCard.${label}` as const)}
                  badge={idx() === 0
                    ? countsByStatus().untracked + countsByStatus().unknown
                    : idx() === 1
                    ? countsByStatus().untracked + countsByStatus().unknown + countsByStatus().learning
                    : countsByStatus().untracked + countsByStatus().unknown + countsByStatus().learning + countsByStatus().known}
                  active={sliderIndex() === idx()}
                  onClick={() => setSliderIndex(idx())}
                />
              )}
            </For>
          </div>
          <p class="level-detail-status-hint">
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
                            prosodyOverlay={prosodyOverlayData()}
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
