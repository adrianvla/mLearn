import { Component, createMemo, createSignal, For, Show } from 'solid-js';
import { useLocalization, useFlashcards, useLanguage, useSettings } from '../../context';
import { ExamLevelCard } from './ExamLevelCard';
import { ExamLevelDetailModal } from './ExamLevelDetailModal';
import { computeExamLevelStats } from '../../utils/wordLevelStats';
import { ProgressBar, EmptyState, TargetIcon, Btn } from '../../components/common';
import type { ExamLevelStats } from '../../utils/wordLevelStats';

export const ExamStudyTab: Component = () => {
  const { t } = useLocalization();
  const flashcards = useFlashcards();
  const language = useLanguage();
  const { settings } = useSettings();
  const [selectedLevel, setSelectedLevel] = createSignal<ExamLevelStats | null>(null);
  const [showBulkAdd, setShowBulkAdd] = createSignal(false);
  const [bulkStatus, setBulkStatus] = createSignal<'new' | 'learning' | 'known' | 'mastered'>('learning');
  const [isBulkAdding, setIsBulkAdding] = createSignal(false);

  const stats = createMemo(() => {
    const langData = language.currentLangData();
    if (!langData) return [];
    const freq = language.wordFrequency;
    if (!freq || Object.keys(freq).length === 0) return [];
    return computeExamLevelStats(
      flashcards.store,
      freq,
      settings.language,
      settings.known_ease_threshold,
      settings.srsLearningThreshold,
      language.getFreqLevelNames(),
    );
  });

  const coverage = createMemo(() => {
    const s = stats();
    if (s.length === 0) return { total: 0, tracked: 0, pct: 0 };
    const total = s.reduce((sum, level) => sum + level.total, 0);
    const tracked = s.reduce((sum, level) => sum + level.known + level.learning + level.unknown, 0);
    const pct = total === 0 ? 0 : Math.round((tracked / total) * 100);
    return { total, tracked, pct };
  });

  const hasFrequencyData = createMemo(() => stats().length > 0);

  return (
    <div class="exam-study-tab">
      <Show
        when={hasFrequencyData()}
        fallback={
          <EmptyState
            icon={<TargetIcon size={32} />}
            title={t('mlearn.ExamStudy.EmptyState.Title')}
            description={t('mlearn.ExamStudy.EmptyState.Description')}
            variant="card"
            size="md"
          />
        }
      >
        <div class="exam-study-coverage-bar">
          <div class="exam-study-coverage-header">
            <span>{t('mlearn.ExamStudy.Coverage.Title')}</span>
            <span>
              {coverage().tracked} / {coverage().total} {t('mlearn.ExamStudy.Coverage.Words')}
            </span>
          </div>
          <ProgressBar value={coverage().pct} showPercent />
          <span class="exam-study-coverage-hint">
            {coverage().pct === 100
              ? t('mlearn.ExamStudy.Coverage.Complete')
              : t('mlearn.ExamStudy.Coverage.Hint')}
          </span>
        </div>

        <Show when={coverage().pct < 100}>
          <div class="exam-study-bulk-add">
            <Show
              when={showBulkAdd()}
              fallback={
                <Btn variant="primary" onClick={() => setShowBulkAdd(true)}>
                  {t('mlearn.ExamStudy.BulkAdd.Button')}
                </Btn>
              }
            >
              <div class="exam-study-bulk-add-panel">
                <span class="exam-study-bulk-add-label">
                  {t('mlearn.ExamStudy.BulkAdd.UntrackedCount', {
                    count: String(coverage().total - coverage().tracked),
                  })}
                </span>
                <div class="exam-study-bulk-add-statuses">
                  <Btn size="sm" variant={bulkStatus() === 'new' ? 'primary' : 'secondary'} onClick={() => setBulkStatus('new')}>
                    {t('mlearn.ExamStudy.DetailModal.StatusNew')}
                  </Btn>
                  <Btn size="sm" variant={bulkStatus() === 'learning' ? 'primary' : 'secondary'} onClick={() => setBulkStatus('learning')}>
                    {t('mlearn.ExamStudy.DetailModal.StatusLearning')}
                  </Btn>
                  <Btn size="sm" variant={bulkStatus() === 'known' ? 'primary' : 'secondary'} onClick={() => setBulkStatus('known')}>
                    {t('mlearn.ExamStudy.DetailModal.StatusKnown')}
                  </Btn>
                  <Btn size="sm" variant={bulkStatus() === 'mastered' ? 'primary' : 'secondary'} onClick={() => setBulkStatus('mastered')}>
                    {t('mlearn.ExamStudy.DetailModal.StatusMastered')}
                  </Btn>
                </div>
                <div class="exam-study-bulk-add-actions">
                  <Btn size="sm" variant="secondary" onClick={() => setShowBulkAdd(false)}>
                    {t('mlearn.ExamStudy.BulkAdd.Cancel')}
                  </Btn>
                  <Btn
                    size="sm"
                    variant="primary"
                    onClick={async () => {
                      const allUntracked: string[] = [];
                      const freq = language.wordFrequency;
                      for (const [word] of Object.entries(freq)) {
                        const status = flashcards.getComprehensiveWordStatusSync(word);
                        if (status === 'unknown' && !flashcards.hasWordSync(word)) {
                          allUntracked.push(word);
                        }
                      }
                      if (allUntracked.length === 0) return;
                      setIsBulkAdding(true);
                      try {
                        const result = await flashcards.addExamStudyFlashcards(allUntracked, bulkStatus());
                        // eslint-disable-next-line no-console
                        console.log(`Bulk add: ${result.created} created, ${result.promoted} promoted, ${result.skipped} skipped`);
                        setShowBulkAdd(false);
                      } finally {
                        setIsBulkAdding(false);
                      }
                    }}
                    disabled={isBulkAdding()}
                  >
                    {isBulkAdding()
                      ? t('mlearn.ExamStudy.BulkAdd.Adding')
                      : t('mlearn.ExamStudy.BulkAdd.Confirm')}
                  </Btn>
                </div>
              </div>
            </Show>
          </div>
        </Show>

        <div class="exam-study-levels-grid">
          <For each={stats()}>
            {(levelStat) => (
              <ExamLevelCard stats={levelStat} onClick={() => setSelectedLevel(levelStat)} />
            )}
          </For>
        </div>
      </Show>
      <Show when={selectedLevel()}>
        {(level) => (
          <ExamLevelDetailModal
            level={level().level}
            levelName={level().name}
            onClose={() => setSelectedLevel(null)}
          />
        )}
      </Show>
    </div>
  );
};

export default ExamStudyTab;
