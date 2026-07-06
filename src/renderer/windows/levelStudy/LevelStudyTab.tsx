import { Component, createEffect, createMemo, createSignal, For, Show } from 'solid-js';
import { useLocalization, useFlashcards, useLanguage, useSettings } from '../../context';
import { LevelCard } from './LevelCard';
import { LevelDetailModal } from './LevelDetailModal';
import { computeLevelStats, resolveLevelStudyWordFrequency } from '../../utils/wordLevelStats';
import { ProgressBar, EmptyState, TargetIcon, Btn } from '../../components/common';
import type { LevelStats } from '../../utils/wordLevelStats';
import { getFrequencyLevelLabel, isDisplayableFrequencyLevel } from '../../../shared/languageFeatures';
import type { LanguageData } from '../../../shared/types';

function resolveLevelStudyLanguage(
  selectedLanguage: string,
  installedLanguages: string[],
): string {
  if (selectedLanguage) return selectedLanguage;
  return installedLanguages.length === 1 ? installedLanguages[0] ?? '' : '';
}

function resolveLevelStudyLanguageData(
  selectedLanguage: string,
  installedLanguages: string[],
  currentLanguageData: LanguageData | null,
  installedLanguageData: Record<string, LanguageData>,
): { language: string; data: LanguageData | null } {
  if (currentLanguageData) {
    return {
      language: selectedLanguage,
      data: currentLanguageData,
    };
  }

  const language = resolveLevelStudyLanguage(selectedLanguage, installedLanguages);
  return {
    language,
    data: language ? installedLanguageData[language] ?? null : null,
  };
}

function getLevelStudyFrequency(languageData: LanguageData | null) {
  return resolveLevelStudyWordFrequency({}, languageData);
}

function getLevelStudyLevelNames(languageData: LanguageData | null): Record<string, string> {
  const frequency = getLevelStudyFrequency(languageData);
  const names: Record<string, string> = { ...(languageData?.frequencyLevels?.names ?? {}) };
  for (const entry of Object.values(frequency)) {
    if (!isDisplayableFrequencyLevel(entry.raw_level, names, languageData)) continue;
    const key = String(entry.raw_level);
    names[key] = names[key] || entry.level || getFrequencyLevelLabel(entry.raw_level, names, languageData);
  }
  return names;
}

export const LevelStudyTab: Component = () => {
  const { t } = useLocalization();
  const flashcards = useFlashcards();
  const language = useLanguage();
  const { settings } = useSettings();
  const [selectedLevel, setSelectedLevel] = createSignal<LevelStats | null>(null);
  const [showBulkAdd, setShowBulkAdd] = createSignal(false);
  const [bulkStatus, setBulkStatus] = createSignal<'new' | 'learning' | 'known' | 'mastered'>('learning');
  const [isBulkAdding, setIsBulkAdding] = createSignal(false);
  let lastEmptyRefreshLanguage: string | null = null;

  const resolvedLanguageData = createMemo(() => (
    resolveLevelStudyLanguageData(
      settings.language,
      language.supportedLanguages(),
      language.currentLangData(),
      language.langData,
    )
  ));

  const stats = createMemo(() => {
    const resolved = resolvedLanguageData();
    const langData = resolved.data;
    if (!langData) return [];
    const freq = getLevelStudyFrequency(langData);
    if (!freq || Object.keys(freq).length === 0) return [];
    return computeLevelStats(
      flashcards.store,
      freq,
      resolved.language,
      settings.known_ease_threshold,
      settings.srsLearningThreshold,
      getLevelStudyLevelNames(langData),
      langData,
      language.getCanonicalFormForLanguage,
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

  createEffect(() => {
    const currentLanguage = settings.language;
    if (language.isLoading() || hasFrequencyData() || lastEmptyRefreshLanguage === currentLanguage) {
      return;
    }

    lastEmptyRefreshLanguage = currentLanguage;
    language.refreshLanguageData();
  });

  return (
    <div class="level-study-tab">
      <Show
        when={hasFrequencyData()}
        fallback={
          <EmptyState
            icon={<TargetIcon size={32} />}
            title={t('mlearn.LevelStudy.EmptyState.Title')}
            description={t('mlearn.LevelStudy.EmptyState.Description')}
            variant="card"
            size="md"
          />
        }
      >
        <div class="level-study-coverage-bar">
          <div class="level-study-coverage-header">
            <span>{t('mlearn.LevelStudy.Coverage.Title')}</span>
            <span>
              {coverage().tracked} / {coverage().total} {t('mlearn.LevelStudy.Coverage.Words')}
            </span>
          </div>
          <ProgressBar value={coverage().pct} showPercent />
          <span class="level-study-coverage-hint">
            {coverage().pct === 100
              ? t('mlearn.LevelStudy.Coverage.Complete')
              : t('mlearn.LevelStudy.Coverage.Hint')}
          </span>
        </div>

        <Show when={coverage().pct < 100}>
          <div class="level-study-bulk-add">
            <Show
              when={showBulkAdd()}
              fallback={
                <Btn variant="primary" onClick={() => setShowBulkAdd(true)}>
                  {t('mlearn.LevelStudy.BulkAdd.Button')}
                </Btn>
              }
            >
              <div class="level-study-bulk-add-panel">
                <span class="level-study-bulk-add-label">
                  {t('mlearn.LevelStudy.BulkAdd.UntrackedCount', {
                    count: String(coverage().total - coverage().tracked),
                  })}
                </span>
                <div class="level-study-bulk-add-statuses">
                  <Btn size="sm" variant={bulkStatus() === 'new' ? 'primary' : 'secondary'} onClick={() => setBulkStatus('new')}>
                    {t('mlearn.LevelStudy.DetailModal.StatusNew')}
                  </Btn>
                  <Btn size="sm" variant={bulkStatus() === 'learning' ? 'primary' : 'secondary'} onClick={() => setBulkStatus('learning')}>
                    {t('mlearn.LevelStudy.DetailModal.StatusLearning')}
                  </Btn>
                  <Btn size="sm" variant={bulkStatus() === 'known' ? 'primary' : 'secondary'} onClick={() => setBulkStatus('known')}>
                    {t('mlearn.LevelStudy.DetailModal.StatusKnown')}
                  </Btn>
                  <Btn size="sm" variant={bulkStatus() === 'mastered' ? 'primary' : 'secondary'} onClick={() => setBulkStatus('mastered')}>
                    {t('mlearn.LevelStudy.DetailModal.StatusMastered')}
                  </Btn>
                </div>
                <div class="level-study-bulk-add-actions">
                  <Btn size="sm" variant="secondary" onClick={() => setShowBulkAdd(false)}>
                    {t('mlearn.LevelStudy.BulkAdd.Cancel')}
                  </Btn>
                  <Btn
                    size="sm"
                    variant="primary"
                    onClick={async () => {
                      const allUntracked: string[] = [];
                      const { language: resolvedLanguage, data: langData } = resolvedLanguageData();
                      const freq = getLevelStudyFrequency(langData);
                      const levelNames = getLevelStudyLevelNames(langData);
                      for (const [word, entry] of Object.entries(freq)) {
                        if (!isDisplayableFrequencyLevel(entry.raw_level, levelNames, langData)) continue;
                        const status = flashcards.getComprehensiveWordStatusSync(word, resolvedLanguage);
                        if (status === 'unknown' && !flashcards.hasWordSync(word, resolvedLanguage)) {
                          allUntracked.push(word);
                        }
                      }
                      if (allUntracked.length === 0) return;
                      setIsBulkAdding(true);
                      try {
                        await flashcards.addLevelStudyFlashcards(allUntracked, bulkStatus(), resolvedLanguage);
                        setShowBulkAdd(false);
                      } finally {
                        setIsBulkAdding(false);
                      }
                    }}
                    disabled={isBulkAdding()}
                  >
                    {isBulkAdding()
                      ? t('mlearn.LevelStudy.BulkAdd.Adding')
                      : t('mlearn.LevelStudy.BulkAdd.Confirm')}
                  </Btn>
                </div>
              </div>
            </Show>
          </div>
        </Show>

        <div class="level-study-levels-grid">
          <For each={stats()}>
            {(levelStat) => (
              <LevelCard stats={levelStat} onClick={() => setSelectedLevel(levelStat)} />
            )}
          </For>
        </div>
      </Show>
      <Show when={selectedLevel()}>
        {(level) => (
          <LevelDetailModal
            level={level().level}
            levelName={level().name}
            language={resolvedLanguageData().language}
            languageData={resolvedLanguageData().data}
            onClose={() => setSelectedLevel(null)}
          />
        )}
      </Show>
    </div>
  );
};

export default LevelStudyTab;
