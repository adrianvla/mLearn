/**
 * Stats Settings Tab
 * Displays learning statistics: stat cards, word distribution bar, level breakdown table
 */

import { Component, createSignal, onMount, Show, For } from 'solid-js';
import { useSettings, useLanguage, useLocalization } from '../../../context';
import { TabContent, StatCard, Btn } from '../../../components/common';
import { getBridge } from '../../../../shared/bridges';
import {
  getTimeWatchedFormatted,
  getWordsLearnedInAppStats,
  getWordsLearnedInApp,
  initTimeWatched,
} from '../../../services/statsService';
import './StatsTab.css';

export const StatsTab: Component = () => {
  const { settings } = useSettings();
  const { getFreqLevelNames, getFrequency, getLanguageFeatures } = useLanguage();
  const { t } = useLocalization();

  const [timeWatched, setTimeWatched] = createSignal('0h 0m');
  const [wordStats, setWordStats] = createSignal({ total: 0, learned: 0, learning: 0, unknown: 0 });
  const [levelBreakdown, setLevelBreakdown] = createSignal<{ name: string; learned: number; learning: number; viewed: number }[]>([]);

  onMount(() => {
    initTimeWatched(settings);
    setTimeWatched(getTimeWatchedFormatted(t));
    setWordStats(getWordsLearnedInAppStats());
    buildLevelBreakdown();
  });

  const buildLevelBreakdown = () => {
    const names = getFreqLevelNames();
    const entries = Object.entries(names).map(([k, v]) => ({ level: parseInt(k), name: v }));
    entries.sort((a, b) => b.level - a.level);
    if (entries.length === 0) return;

    const words = getWordsLearnedInApp();
    const buckets = new Map<number, { learned: number; learning: number; viewed: number }>();
    for (const entry of entries) {
      buckets.set(entry.level, { learned: 0, learning: 0, viewed: 0 });
    }

    for (const [word, status] of Object.entries(words)) {
      const freq = getFrequency(word);
      if (!freq) continue;
      const bucket = buckets.get(freq.raw_level);
      if (!bucket) continue;
      if (status === 2) bucket.learned++;
      else if (status === 1) bucket.learning++;
      else bucket.viewed++;
    }

    setLevelBreakdown(entries.map(e => ({
      name: e.name || `Level ${e.level}`,
      ...(buckets.get(e.level) ?? { learned: 0, learning: 0, viewed: 0 }),
    })));
  };

  const pct = (n: number, total: number) => total > 0 ? ((n / total) * 100).toFixed(1) : '0';

  const openKanjiGrid = () => getBridge().window.openWindow({ type: 'kanji-grid' });
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
      {/* Stat cards */}
      <div class="stats-grid">
        <StatCard label={t('mlearn.Statistics.TimeWatched')} value={timeWatched()} size="md" />
        <StatCard label={t('mlearn.Statistics.WordsTracked')} value={wordStats().total} size="md" />
        <StatCard label={t('mlearn.Statistics.WordsLearned')} value={wordStats().learned} size="md" />
        <StatCard label={t('mlearn.Statistics.CurrentlyLearning')} value={wordStats().learning} size="md" />
      </div>

      {/* Word distribution */}
      <Show when={wordStats().total > 0}>
        <div class="stats-section">
          <h4 class="stats-section-title">{t('mlearn.Statistics.WordsByStatus')}</h4>
          <div class="stats-distribution">
            <div class="stats-distribution-bar">
              <div class="bar-segment bar-segment-learned" style={{ width: `${pct(wordStats().learned, wordStats().total)}%` }} />
              <div class="bar-segment bar-segment-learning" style={{ width: `${pct(wordStats().learning, wordStats().total)}%` }} />
              <div class="bar-segment bar-segment-viewed" style={{ width: `${pct(wordStats().unknown, wordStats().total)}%` }} />
            </div>
            <div class="stats-distribution-legend">
              <span class="legend-entry"><span class="legend-dot legend-dot-learned" />{t('mlearn.Statistics.Legend.Learned')} ({wordStats().learned})</span>
              <span class="legend-entry"><span class="legend-dot legend-dot-learning" />{t('mlearn.Statistics.Legend.Learning')} ({wordStats().learning})</span>
              <span class="legend-entry"><span class="legend-dot legend-dot-viewed" />{t('mlearn.Statistics.Legend.Viewed')} ({wordStats().unknown})</span>
            </div>
          </div>
        </div>
      </Show>

      {/* Level breakdown table */}
      <Show when={getLanguageFeatures().supportsFrequencyLevels && levelBreakdown().length > 0}>
        <div class="stats-section">
          <h4 class="stats-section-title">{t('mlearn.Statistics.WordsByExamLevel')}</h4>
          <table class="stats-level-table">
            <thead>
              <tr>
                <th>{t('mlearn.Statistics.LevelColumn')}</th>
                <th>{t('mlearn.Statistics.Legend.Learned')}</th>
                <th>{t('mlearn.Statistics.Legend.Learning')}</th>
                <th>{t('mlearn.Statistics.Legend.Viewed')}</th>
              </tr>
            </thead>
            <tbody>
              <For each={levelBreakdown()}>
                {(row) => (
                  <tr>
                    <td>{row.name}</td>
                    <td class="stat-num">{row.learned}</td>
                    <td class="stat-num">{row.learning}</td>
                    <td class="stat-num">{row.viewed}</td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </div>
      </Show>

      {/* Actions */}
      <div class="stats-actions">
        <Btn variant="default" onClick={openKanjiGrid}>
          {t('mlearn.Statistics.Actions.ViewKanjiGrid')}
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
