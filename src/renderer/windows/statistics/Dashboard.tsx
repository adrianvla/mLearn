/**
 * Statistics Dashboard
 * Separate learner knowledge, review scheduling, and activity analytics.
 */

import { Component, createMemo, createResource, createSignal, For, onMount, onCleanup, Show } from 'solid-js';
import { useFlashcards, useSettings, useLanguage, useLocalization } from '../../context';
import { StatCard, Panel, BookIcon, KnowledgeGate, KnowledgeSkeleton, SkeletonCard, SkeletonStatGrid } from '../../components/common';
import { BarChart, Heatmap, LineChart } from './charts';
import type { BarChartDataPoint } from './charts';
import { WordSearchPanel } from './components/WordSearchPanel';
import type { MediaStats } from '../../../shared/types';
import { DEFAULT_SETTINGS } from '../../../shared/types';
import { getBridge } from '../../../shared/bridges';
import { eventsVersion, queryKnowledgeSummaries } from '../../services/knowledgeEvents';
import { acquisitionSlopeSummaries, daysToStableKnownSummaries, retentionAfterKnownSummaries, type WordSummaryGroup } from '../../services/learningAnalytics';
import { hashWordSync } from '../../services/srsAlgorithm';
import { getWordFormCandidates } from '../../utils/wordForms';

import { initTimeWatched } from '../../services/statsService';
import { computeWordLevelStats } from '../../utils/wordLevelStats';
import { retentionDisplay } from '../../utils/retentionDisplay';
import {
  computeStateDistribution,
  computeMaturityBreakdown,
  computeIntervalDistribution,
  computeRetentionStats,
  computeStreaks,
  getTodayStats,
  aggregateDailyStats,
  computeDueForecast,
} from '../../services/flashcardStats';
import './Dashboard.css';

/** Merge overlapping [start,end] intervals and return total non-overlapping duration. */
function scanlineMerge(intervals: Array<{ start: number; end: number }>): number {
  if (intervals.length === 0) return 0;
  intervals.sort((a, b) => a.start - b.start);
  let total = 0;
  let curStart = intervals[0].start;
  let curEnd = intervals[0].end;
  for (let i = 1; i < intervals.length; i++) {
    if (intervals[i].start <= curEnd) {
      curEnd = Math.max(curEnd, intervals[i].end);
    } else {
      total += curEnd - curStart;
      curStart = intervals[i].start;
      curEnd = intervals[i].end;
    }
  }
  total += curEnd - curStart;
  return total;
}

export const Dashboard: Component = () => {
  const { store, isLoading, getComprehensiveWordStatusWithSourceSync } = useFlashcards();
  const { settings } = useSettings();
  const { getWordFrequency, currentLangData, getFreqLevelNames, getLanguageFeatures, getCanonicalFormForLanguage, getWordVariantsForLanguage } = useLanguage();
  const { t } = useLocalization();

  initTimeWatched(settings);

  const [section, setSection] = createSignal('knowledge');

  // ── Media stats ──
  const [mediaStatsList, setMediaStatsList] = createSignal<MediaStats[]>([]);
  // Until the media-stats snapshot has arrived, "no immersion time" is not
  // evidence — the empty state must not flash before this resolves.
  const [mediaStatsLoaded, setMediaStatsLoaded] = createSignal(false);

  onMount(() => {
    const bridge = getBridge();
    const cleanup = bridge.mediaStats.onMediaStatsList((stats) => {
      setMediaStatsList(stats);
      setMediaStatsLoaded(true);
    });
    bridge.mediaStats.listMediaStats();
    onCleanup(cleanup);
  });

  const mediaTimeStats = createMemo(() => {
    const all = mediaStatsList();
    let watchTime = 0;
    let readTime = 0;
    for (const ms of all) {
      if (ms.mediaType === 'video') watchTime += ms.totalTimeSpent;
      else if (ms.mediaType === 'book') readTime += ms.totalTimeSpent;
    }
    return { watchTime, readTime, totalImmersion: watchTime + readTime };
  });

  // ── Immersion heatmap (scanline per day) ──
  const immersionHeatmap = createMemo(() => {
    const all = mediaStatsList();
    const byDate = new Map<string, { legacy: number; intervals: Array<{ start: number; end: number }> }>();

    for (const ms of all) {
      for (const session of ms.sessions) {
        if (!byDate.has(session.date)) {
          byDate.set(session.date, { legacy: 0, intervals: [] });
        }
        const bucket = byDate.get(session.date)!;
        if (session.startTime && session.endTime) {
          bucket.intervals.push({ start: session.startTime, end: session.endTime });
        } else {
          bucket.legacy += session.duration;
        }
      }
    }

    const result: Record<string, number> = {};
    for (const [date, { legacy, intervals }] of byDate) {
      const merged = scanlineMerge(intervals);
      const totalMinutes = Math.round((legacy + merged) / 60000);
      if (totalMinutes > 0) result[date] = totalMinutes;
    }
    return result;
  });

  // ── Flashcard aggregate stats ──

  const cards = createMemo(() => Object.values(store.flashcards));

  const flatDailyStats = createMemo(() => aggregateDailyStats(store.dailyStats));

  const cardStats = createMemo(() => {
    const all = cards();
    const stateDist = computeStateDistribution(all);
    const maturity = computeMaturityBreakdown(all);
    const intervals = computeIntervalDistribution(all);
    const retention = computeRetentionStats(flatDailyStats());

    return {
      total: stateDist.total,
      newCards: stateDist.new,
      learning: stateDist.learning,
      review: stateDist.review,
      suspended: stateDist.suspended,
      retentionRate: retention.retention,
      totalReviews: retention.totalReviews,
      totalLapses: retention.totalLapses,
      matureCount: maturity.mature,
      youngCount: maturity.young,
      intervalBuckets: intervals,
    };
  });

  const dueForecast = createMemo(() =>
    computeDueForecast(cards(), settings.newDayHour ?? DEFAULT_SETTINGS.newDayHour!),
  );

  const retentionCard = createMemo(() => retentionDisplay(cardStats().retentionRate, cardStats().totalReviews));

  // ── Daily stats aggregation ──

  const dailyStatsData = createMemo(() => {
    const ds = flatDailyStats();

    const retention = computeRetentionStats(ds);
    const streaks = computeStreaks(ds);
    const todayStats = getTodayStats(ds);

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Last 30 days bar chart
    const last30: BarChartDataPoint[] = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const stat = ds[key];
      const dayLabel = i === 0
        ? t('mlearn.Statistics.Dashboard.Today')
        : i <= 6
          ? d.toLocaleDateString(undefined, { weekday: 'short' })
          : d.toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' });

      last30.push({
        label: i % 6 === 0 ? dayLabel : '',
        value: stat?.reviewCardsStudied ?? 0,
        color: 'var(--color-primary)',
        secondaryValue: stat?.newCardsStudied ?? 0,
        secondaryColor: 'var(--color-success)',
        tooltip: t('mlearn.Statistics.Dashboard.DayActivity', {
          date: d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
          reviews: stat?.reviewCardsStudied ?? 0,
          newCards: stat?.newCardsStudied ?? 0,
        }),
      });
    }

    return {
      totalStudyTime: retention.totalTime,
      streakCurrent: streaks.current,
      streakMax: streaks.max,
      totalDaysStudied: retention.daysStudied,
      last30,
      todayReviews: todayStats.reviews,
      todayNew: todayStats.newCards,
      todayLapses: todayStats.lapses,
      todayTime: todayStats.timeSpent,
      todayGraduated: todayStats.graduated,
    };
  });

  const isEmpty = createMemo(() =>
    mediaStatsLoaded() && cardStats().total === 0 && dailyStatsData().totalDaysStudied === 0 && mediaTimeStats().totalImmersion === 0 && wordStats().allEncountered.total === 0
  );

  // The existing Viewed display groups Unknown + Unmeasured; the data keeps them separate.
  const wordStats = createMemo(() =>
    computeWordLevelStats(
      store,
      getWordFrequency(),
      settings.language,
      settings.easeThresholdKnown * 1000,
      settings.easeThresholdLearning * 1000,
      getFreqLevelNames(),
      currentLangData(),
      getCanonicalFormForLanguage,
      getComprehensiveWordStatusWithSourceSync,
    ),
  );

  const todaySessionStats = createMemo(() => {
    const today = new Date().toISOString().split('T')[0];
    let videoTime = 0;
    let readTime = 0;

    for (const ms of mediaStatsList()) {
      for (const session of ms.sessions) {
        if (session.date === today) {
          if (ms.mediaType === 'video') videoTime += session.duration;
          else if (ms.mediaType === 'book') readTime += session.duration;
        }
      }
    }

    const flashcardTime = dailyStatsData().todayTime;
    const total = flashcardTime + videoTime + readTime;

    return { videoTime, readTime, flashcardTime, total };
  });

  // ── Learning velocity cohorts (event-store aggregates) ──
  const [learningVelocity] = createResource(
    () => [settings.language, eventsVersion()] as const,
    async ([language]) => {
      const summaries = await queryKnowledgeSummaries(language);
      // Variant surfaces of one word live in several `${language}:${hash}` keys; unify
      // per-key summaries into word groups before cohort aggregation.
      const byWord = new Map<string, WordSummaryGroup>();
      for (const [key, summary] of Object.entries(summaries)) {
        const word = store.wordKnowledge[key]?.word;
        if (!word) continue;
        const familyKeys = getWordFormCandidates(
          word,
          (w) => getCanonicalFormForLanguage(language, w),
          (w) => getWordVariantsForLanguage(language, w),
          { language },
        ).map((form) => `${language}:${hashWordSync(form)}`);
        const familyId = familyKeys.includes(key) ? [...familyKeys].sort()[0] : key;
        const group: WordSummaryGroup = byWord.get(familyId) ?? { summaries: [], acquisitionRows: [] };
        group.summaries = [...group.summaries, summary];
        group.acquisitionRows = [...group.acquisitionRows, ...(summary.acquisitionRows ?? [])];
        byWord.set(familyId, group);
      }
      return {
        days: daysToStableKnownSummaries(byWord),
        slope: acquisitionSlopeSummaries(byWord),
        retention: retentionAfterKnownSummaries(byWord, Date.now()),
      };
    },
  );

  const velocityCharts = createMemo(() => {
    const v = learningVelocity();
    if (!v || (v.days.length === 0 && v.slope.length === 0 && v.retention.length === 0)) return null;
    return {
      days: v.days.map((p) => ({
        label: p.month,
        value: Math.round(p.medianDays * 10) / 10,
        tooltip: `${p.month}: ${p.medianDays.toFixed(1)}d (n=${p.wordCount})`,
      })),
      slope: v.slope.map((p) => ({
        label: p.month,
        value: Math.round(p.medianSlope * 1000) / 1000,
        tooltip: `${p.month}: ${p.medianSlope.toFixed(2)} (n=${p.wordCount})`,
      })),
      retention: v.retention.map((p) => ({
        label: p.month,
        value: Math.round(p.lapseRate * 100),
        tooltip: `${p.month}: ${(p.lapseRate * 100).toFixed(0)}% (n=${p.knownWordCount})`,
      })),
    };
  });

  // ── Helpers ──

  const formatDuration = (ms: number) => {
    const totalSec = Math.floor(ms / 1000);
    const hours = Math.floor(totalSec / 3600);
    const minutes = Math.floor((totalSec % 3600) / 60);
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
  };

  const formatMinutes = (m: number) => {
    if (m >= 60) return `${Math.floor(m / 60)}h ${m % 60}m`;
    return `${m}m`;
  };

  const levelBreakdown = createMemo(() => {
    if (!getLanguageFeatures().supportsFrequencyLevels) return [];
    return wordStats().byLevel;
  });

  const outsideLevels = createMemo(() => wordStats().outsideLevels);

  // ── Heatmap color scales ──
  const immersionColorScale = [
    'var(--bg-intense)',
    'color-mix(in srgb, var(--color-success) 25%, transparent)',
    'color-mix(in srgb, var(--color-success) 50%, transparent)',
    'color-mix(in srgb, var(--color-success) 75%, transparent)',
    'var(--color-success)',
  ];

  return (
    <div class="statistics-dashboard">
      {/* While the consolidated learner store or the media-stats snapshot is
          still hydrating, none of the zeros below are real values — show the
          boot skeleton, never the empty state or half-populated panels. */}
      <Show when={!isLoading() && mediaStatsLoaded()} fallback={
        <div class="dashboard-boot" aria-busy="true">
          <SkeletonStatGrid count={4} />
          <SkeletonCard lines={4} />
          <SkeletonCard lines={4} />
        </div>
      }>
      <Show when={!isEmpty()} fallback={
        <div class="dashboard-empty-state">
          <div class="dashboard-empty-icon"><BookIcon size={40} /></div>
          <h2>{t('mlearn.Statistics.Dashboard.EmptyState.Title')}</h2>
          <p>{t('mlearn.Statistics.Dashboard.EmptyState.Description')}</p>
          <p class="dashboard-empty-hint">{t('mlearn.Statistics.Dashboard.EmptyState.Hint')}</p>
        </div>
      }>

      <header class="analytics-header">
        <h1>{t('mlearn.Statistics.Title')}</h1>
        <nav class="analytics-nav" aria-label={t('mlearn.Statistics.Title')}>
          <For each={['knowledge', 'reviews', 'activity']}>{(id) => <button type="button" aria-pressed={section() === id} onClick={() => setSection(id)}>{t(`mlearn.Statistics.Sections.${id}`)}</button>}</For>
        </nav>
      </header>
      <p class="analytics-caption">{t(`mlearn.Statistics.Sections.${section()}Description`)}</p>
      <Show when={section() === 'knowledge'}>
        <KnowledgeGate fallback={<KnowledgeSkeleton variant="lines" />}>
          <div class="dashboard-stats-row analytics-summary">
            <StatCard label={t('mlearn.Statistics.Legend.Learned')} value={wordStats().allEncountered.known} />
            <StatCard label={t('mlearn.Statistics.Legend.Learning')} value={wordStats().allEncountered.learning} />
            <StatCard label={t('mlearn.Statistics.Legend.Viewed')} value={wordStats().allEncountered.unknown + wordStats().allEncountered.untracked} />
          </div>
          <WordSearchPanel />
      {/* ─── Level Breakdown ─── */}
      {/* Knowledge panels stay skeletons until the learner projection has
          hydrated — zeros during load are false percentages, not real ones. */}
      <KnowledgeGate fallback={<Panel variant="default" rounded="lg" padding="lg" class="dashboard-panel"><KnowledgeSkeleton variant="lines" /></Panel>}>
      <Show when={getLanguageFeatures().supportsFrequencyLevels && levelBreakdown().length > 0}>
        <Panel variant="default" rounded="lg" padding="lg" class="dashboard-panel">
          <h2 class="dashboard-section-title">{t('mlearn.Statistics.WordsByLevel')}</h2>
          <table class="level-table">
            <thead>
              <tr>
                <th>{t('mlearn.Statistics.LevelColumn')}</th>
                <th>{t('mlearn.Statistics.Legend.Learned')}</th>
                <th>{t('mlearn.Statistics.Legend.Learning')}</th>
                <th>{t('mlearn.Statistics.Legend.Viewed')}</th>
                <th class="level-num">{t('mlearn.Statistics.Dashboard.LevelTotal')}</th>
                <th>{t('mlearn.Statistics.Dashboard.LevelCoverage')}</th>
              </tr>
            </thead>
            <tbody>
              <For each={levelBreakdown()}>
                {(row) => (
                  <tr>
                    <td>{row.name}</td>
                    <td class="level-num">{row.known}</td>
                    <td class="level-num">{row.learning}</td>
                    <td class="level-num">{row.unknown + row.untracked}</td>
                    <td class="level-num">{row.totalDictionaryWords}</td>
                    <td class="level-coverage-cell">
                      <div class="level-coverage-bar">
                        <Show when={row.totalDictionaryWords > 0}>
                          <div class="level-coverage-fill level-coverage-learned" style={{ width: `${(row.known / row.totalDictionaryWords) * 100}%` }} />
                          <div class="level-coverage-fill level-coverage-learning" style={{ width: `${(row.learning / row.totalDictionaryWords) * 100}%` }} />
                          <div class="level-coverage-fill level-coverage-viewed" style={{ width: `${((row.unknown + row.untracked) / row.totalDictionaryWords) * 100}%` }} />
                        </Show>
                      </div>
                      <span class="level-coverage-pct">{row.knownPct}%</span>
                    </td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </Panel>
      </Show>

      <Show when={outsideLevels().total > 0}>
        <Panel variant="default" rounded="lg" padding="lg" class="dashboard-panel">
          <h2 class="dashboard-section-title">{t('mlearn.Statistics.Dashboard.OutsideLevels')}</h2>
          <div class="dashboard-stats-row compact">
            <StatCard label={t('mlearn.Statistics.Legend.Learned')} value={outsideLevels().known} size="sm" color="success" />
            <StatCard label={t('mlearn.Statistics.Legend.Learning')} value={outsideLevels().learning} size="sm" color="warning" />
            <StatCard label={t('mlearn.Statistics.Legend.Viewed')} value={outsideLevels().unknown + outsideLevels().untracked} size="sm" />
            <StatCard label={t('mlearn.Statistics.Dashboard.OutsideLevelsTotal')} value={outsideLevels().total} size="sm" />
          </div>
        </Panel>
      </Show>
      </KnowledgeGate>

      {/* ─── Learning Velocity ─── */}
      <Panel variant="default" rounded="lg" padding="lg" class="dashboard-panel">
        <h2 class="dashboard-section-title">{t('mlearn.Statistics.LearningVelocity.Title')}</h2>
        <Show
          when={velocityCharts()}
          fallback={<p class="learning-velocity-empty">{t('mlearn.Statistics.LearningVelocity.Empty')}</p>}
        >
          {(charts) => (
            <div class="learning-velocity-charts">
              <div class="learning-velocity-chart">
                <span class="learning-velocity-chart-label">{t('mlearn.Statistics.LearningVelocity.DaysToKnown')}</span>
                <LineChart data={charts().days} />
              </div>
              <div class="learning-velocity-chart">
                <span class="learning-velocity-chart-label">{t('mlearn.Statistics.LearningVelocity.AcquisitionSlope')}</span>
                <LineChart data={charts().slope} />
              </div>
              <div class="learning-velocity-chart">
                <span class="learning-velocity-chart-label">{t('mlearn.Statistics.LearningVelocity.RetentionAfterKnown')}</span>
                <BarChart data={charts().retention} height={100} showValues />
              </div>
            </div>
          )}
        </Show>
      </Panel>

        </KnowledgeGate>
      </Show>
      <Show when={section() === 'reviews'}>
      {/* ─── Header Stats ─── */}
      <div class="dashboard-stats-row">
        <StatCard label={t('mlearn.Statistics.Dashboard.TotalCards')} value={cardStats().total} size="md" />
        <StatCard label={t('mlearn.Statistics.Dashboard.RetentionRate')} value={retentionCard().text} size="md"
          color={retentionCard().color} />
        <StatCard label={t('mlearn.Statistics.Dashboard.CurrentStreak')} value={`${dailyStatsData().streakCurrent}d`} size="md" color="primary" />
        <StatCard label={t('mlearn.Statistics.Dashboard.DaysStudied')} value={dailyStatsData().totalDaysStudied} size="md" />
      </div>

      <div class="dashboard-charts-row">
      {/* ─── Today's Session ─── */}
      <Panel variant="default" rounded="lg" padding="lg" class="dashboard-panel">
        <h2 class="dashboard-section-title">{t('mlearn.Statistics.Dashboard.TodaysSession')}</h2>
        <div class="dashboard-stats-row compact">
          <StatCard label={t('mlearn.Statistics.Dashboard.Reviews')} value={dailyStatsData().todayReviews} size="sm" />
          <StatCard label={t('mlearn.Statistics.Dashboard.CardState.New')} value={dailyStatsData().todayNew} size="sm" color="success" />
          <StatCard label={t('mlearn.Statistics.Dashboard.Lapses')} value={dailyStatsData().todayLapses} size="sm" color={dailyStatsData().todayLapses > 0 ? 'error' : 'default'} />
          <StatCard label={t('mlearn.Statistics.Dashboard.Graduated')} value={dailyStatsData().todayGraduated} size="sm" color="success" />
        </div>
      </Panel>

      {/* ─── Due Forecast ─── */}
      <Panel variant="default" rounded="lg" padding="lg" class="dashboard-panel">
        <h2 class="dashboard-section-title">{t('mlearn.Statistics.Dashboard.DueForecast.Title')}</h2>
        <div class="dashboard-stats-row">
          <StatCard label={t('mlearn.Statistics.Dashboard.DueForecast.Today')} value={dueForecast().today} size="md" />
          <StatCard label={t('mlearn.Statistics.Dashboard.DueForecast.Tomorrow')} value={dueForecast().tomorrow} size="md" />
          <StatCard label={t('mlearn.Statistics.Dashboard.DueForecast.Next7Days')} value={dueForecast().next7} size="md" />
          <StatCard label={t('mlearn.Statistics.Dashboard.DueForecast.Next30Days')} value={dueForecast().next30} size="md" />
        </div>
      </Panel>

      </div>
      {/* ─── Review Activity (Last 30 Days) ─── */}
      <Panel variant="default" rounded="lg" padding="lg" class="dashboard-panel">
        <div class="dashboard-section-header">
          <h2 class="dashboard-section-title">{t('mlearn.Statistics.Dashboard.ReviewActivity')}</h2>
          <div class="dashboard-legend-inline">
            <span class="legend-entry"><span class="legend-dot" style={{ background: 'var(--color-primary)' }} />{t('mlearn.Statistics.Dashboard.Reviews')}</span>
            <span class="legend-entry"><span class="legend-dot" style={{ background: 'var(--color-success)' }} />{t('mlearn.Statistics.Dashboard.CardState.New')}</span>
          </div>
        </div>
        <div class="analytics-review-chart"><BarChart data={dailyStatsData().last30} height={100} stacked showValues={false} /></div>
      </Panel>

        <details class="analytics-details">
          <summary>{t('mlearn.Statistics.Sections.SchedulingDetails')}</summary>
          <div class="dashboard-stats-row analytics-summary">
            <StatCard label={t('mlearn.Statistics.Dashboard.CardState.New')} value={cardStats().newCards} />
            <StatCard label={t('mlearn.Statistics.Dashboard.CardState.Learning')} value={cardStats().learning} />
            <StatCard label={t('mlearn.Statistics.Dashboard.CardState.Review')} value={cardStats().review} />
            <StatCard label={t('mlearn.Statistics.Dashboard.CardState.Suspended')} value={cardStats().suspended} />
            <StatCard label={t('mlearn.Statistics.Dashboard.Maturity.Mature')} value={cardStats().matureCount} />
            <StatCard label={t('mlearn.Statistics.Dashboard.Lapses')} value={cardStats().totalLapses} />
          </div>
      {/* ─── Interval Distribution ─── */}
      <Panel variant="default" rounded="lg" padding="lg" class="dashboard-panel">
        <h2 class="dashboard-section-title">{t('mlearn.Statistics.Dashboard.IntervalDistribution')}</h2>
        <div class="horizontal-bars">
          <For each={cardStats().intervalBuckets}>
            {(bucket) => {
              const max = Math.max(...cardStats().intervalBuckets.map(b => b.count), 1);
              return (
                <div class="h-bar-row">
                  <span class="h-bar-label">{t('mlearn.Statistics.Intervals.' + bucket.key)}</span>
                  <div class="h-bar-track">
                    <div class="h-bar-fill" style={{ width: `${(bucket.count / max) * 100}%` }} />
                  </div>
                  <span class="h-bar-value">{bucket.count}</span>
                </div>
              );
            }}
          </For>
        </div>
      </Panel>

        </details>
      </Show>
      <Show when={section() === 'activity'}>        <div class="session-time-breakdown">
          <div class="session-time-total">
            <span class="session-time-label">{t('mlearn.Statistics.Sections.TodayActivity')}</span>
            <span class="session-time-value">{formatDuration(todaySessionStats().total)}</span>
          </div>
          <div class="session-time-grid">
            <div class="session-time-item">
              <span class="session-time-dot" style={{ background: 'var(--color-primary)' }} />
              <span class="session-time-label-sm">{t('mlearn.Statistics.Dashboard.FlashcardTime')}</span>
              <span class="session-time-value-sm">{formatDuration(todaySessionStats().flashcardTime)}</span>
            </div>
            <div class="session-time-item">
              <span class="session-time-dot" style={{ background: 'var(--color-success)' }} />
              <span class="session-time-label-sm">{t('mlearn.Statistics.Dashboard.VideoTime')}</span>
              <span class="session-time-value-sm">{formatDuration(todaySessionStats().videoTime)}</span>
            </div>
            <div class="session-time-item">
              <span class="session-time-dot" style={{ background: 'var(--color-info)' }} />
              <span class="session-time-label-sm">{t('mlearn.Statistics.Dashboard.ReadingTime')}</span>
              <span class="session-time-value-sm">{formatDuration(todaySessionStats().readTime)}</span>
            </div>
          </div>
        </div>

        <h2 class="dashboard-section-title">{t('mlearn.Statistics.Sections.AllTimeActivity')}</h2>
        <div class="dashboard-stats-row analytics-summary">
          <StatCard label={t('mlearn.Statistics.Dashboard.VideoTime')} value={formatDuration(mediaTimeStats().watchTime)} />
          <StatCard label={t('mlearn.Statistics.Dashboard.ReadingTime')} value={formatDuration(mediaTimeStats().readTime)} />
          <StatCard label={t('mlearn.Statistics.Dashboard.FlashcardTime')} value={formatDuration(dailyStatsData().totalStudyTime)} />
        </div>
      <Show when={Object.keys(immersionHeatmap()).length > 0}>
        <Panel variant="default" rounded="lg" padding="lg" class="dashboard-panel">
          <h2 class="dashboard-section-title">{t('mlearn.Statistics.Dashboard.ImmersionHeatmap')}</h2>
          <Heatmap
            data={immersionHeatmap()}
            weeks={20}
            colorScale={immersionColorScale}
            formatTooltip={(date, val) => `${new Date(date + 'T00:00:00').toLocaleDateString(undefined, { dateStyle: 'medium' })}: ${formatMinutes(val)}`}
            formatMax={formatMinutes}
          />
        </Panel>
      </Show>

      </Show>
      </Show>
      </Show>
    </div>
  );
};
