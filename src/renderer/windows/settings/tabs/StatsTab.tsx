/**
 * Stats Settings Tab
 * Displays learning statistics: stat cards, word distribution bar, level breakdown table
 */

import { Component, createMemo, createSignal, onMount, Show, For } from 'solid-js';
import type { ComprehensiveWordStats } from '../../../utils/wordLevelStats';
import { useSettings, useLanguage, useLocalization, useFlashcards } from '../../../context';
import { TabContent, StatCard, Btn } from '../../../components/common';
import { getBridge } from '../../../../shared/bridges';
import {
  getTimeWatchedFormatted,
  initTimeWatched,
} from '../../../services/statsService';
import { computeWordLevelStats } from '../../../utils/wordLevelStats';
import './StatsTab.css';

export const StatsTab: Component = () => {
  const { settings } = useSettings();
  const { store } = useFlashcards();
  const { getWordFrequency, currentLangData, getFreqLevelNames, getLanguageFeatures, getCanonicalFormForLanguage } = useLanguage();
  const { t } = useLocalization();

  const [timeWatched, setTimeWatched] = createSignal('0h 0m');

  const wordStats = createMemo<ComprehensiveWordStats>(() =>
    computeWordLevelStats(
      store,
      getWordFrequency(),
      settings.language,
      settings.known_ease_threshold,
      settings.srsLearningThreshold,
      getFreqLevelNames(),
      currentLangData(),
      getCanonicalFormForLanguage,
    ),
  );

  onMount(() => {
    initTimeWatched(settings);
    setTimeWatched(getTimeWatchedFormatted(t));
  });

  const pct = (n: number, total: number) => total > 0 ? ((n / total) * 100).toFixed(1) : '0';

  const openLevelStudy = () => getBridge().window.openWindow({ type: 'level-study' });
  const openWordDbEditor = () => getBridge().window.openWindow({ type: 'word-db-editor' });
  const openAiAnalytics = () => getBridge().window.openWindow({ type: 'conversation-agent', context: { initialTab: 'stats' } });

  return (
    <TabContent
      header={{
        title: t('mlearn.Statistics.Title'),
        description: t('mlearn.Statistics.Description'),
      }}
      padding="lg"
    >
      <div class="stats-grid">
        <StatCard label={t('mlearn.Statistics.TimeWatched')} value={timeWatched()} size="md" />
        <StatCard label={t('mlearn.Statistics.WordsTracked')} value={wordStats().allEncountered.total} size="md" />
        <StatCard label={t('mlearn.Statistics.WordsLearned')} value={wordStats().allEncountered.known} size="md" />
        <StatCard label={t('mlearn.Statistics.CurrentlyLearning')} value={wordStats().allEncountered.learning} size="md" />
      </div>

      <Show when={wordStats().allEncountered.total > 0}>
        <div class="stats-section">
          <h4 class="stats-section-title">{t('mlearn.Statistics.WordsByStatus')}</h4>
          <div class="stats-distribution">
            <div class="stats-distribution-bar">
              <div class="bar-segment bar-segment-learned" style={{ width: `${pct(wordStats().allEncountered.known, wordStats().allEncountered.total)}%` }} />
              <div class="bar-segment bar-segment-learning" style={{ width: `${pct(wordStats().allEncountered.learning, wordStats().allEncountered.total)}%` }} />
              <div class="bar-segment bar-segment-viewed" style={{ width: `${pct(wordStats().allEncountered.unknown, wordStats().allEncountered.total)}%` }} />
            </div>
            <div class="stats-distribution-legend">
              <span class="legend-entry"><span class="legend-dot legend-dot-learned" />{t('mlearn.Statistics.Legend.Learned')} ({wordStats().allEncountered.known})</span>
              <span class="legend-entry"><span class="legend-dot legend-dot-learning" />{t('mlearn.Statistics.Legend.Learning')} ({wordStats().allEncountered.learning})</span>
              <span class="legend-entry"><span class="legend-dot legend-dot-viewed" />{t('mlearn.Statistics.Legend.Viewed')} ({wordStats().allEncountered.unknown})</span>
            </div>
          </div>
        </div>
      </Show>

      <Show when={getLanguageFeatures().supportsFrequencyLevels && wordStats().byLevel.length > 0}>
        <div class="stats-section">
          <h4 class="stats-section-title">{t('mlearn.Statistics.WordsByLevel')}</h4>
          <table class="stats-level-table">
            <thead>
              <tr>
                <th>{t('mlearn.Statistics.LevelColumn')}</th>
                <th>{t('mlearn.Statistics.Legend.Learned')}</th>
                <th>{t('mlearn.Statistics.Legend.Learning')}</th>
                <th>{t('mlearn.Statistics.Legend.Viewed')}</th>
                <th>{t('mlearn.Statistics.Dashboard.LevelTotal')}</th>
                <th>{t('mlearn.Statistics.Dashboard.LevelCoverage')}</th>
              </tr>
            </thead>
            <tbody>
              <For each={wordStats().byLevel}>
                {(row) => (
                  <tr>
                    <td>{row.name}</td>
                    <td class="stat-num">{row.known}</td>
                    <td class="stat-num">{row.learning}</td>
                    <td class="stat-num">{row.unknown}</td>
                    <td class="stat-num">{row.totalDictionaryWords}</td>
                    <td class="stat-num">{row.knownPct}%</td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </div>
      </Show>

      <Show when={wordStats().outsideLevels.total > 0}>
        <div class="stats-section">
          <h4 class="stats-section-title">{t('mlearn.Statistics.Dashboard.OutsideLevels')}</h4>
          <div class="dashboard-stats-row compact">
            <StatCard label={t('mlearn.Statistics.Legend.Learned')} value={wordStats().outsideLevels.known} size="sm" color="success" />
            <StatCard label={t('mlearn.Statistics.Legend.Learning')} value={wordStats().outsideLevels.learning} size="sm" color="warning" />
            <StatCard label={t('mlearn.Statistics.Legend.Viewed')} value={wordStats().outsideLevels.unknown} size="sm" />
            <StatCard label={t('mlearn.Statistics.Dashboard.OutsideLevelsTotal')} value={wordStats().outsideLevels.total} size="sm" />
          </div>
        </div>
      </Show>

      <div class="stats-actions">
        <Btn variant="default" onClick={openLevelStudy}>
          {t('mlearn.Statistics.Actions.OpenLevelStudy')}
        </Btn>
        <Btn variant="default" onClick={openWordDbEditor}>
          {t('mlearn.Statistics.Actions.EditWordDatabase')}
        </Btn>
        <Btn variant="default" onClick={openAiAnalytics}>
          {t('mlearn.Statistics.Actions.OpenAiAnalytics')}
        </Btn>
      </div>
    </TabContent>
  );
};
