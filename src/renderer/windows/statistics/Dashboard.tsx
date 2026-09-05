/**
 * Statistics Dashboard
 * Learning analytics: card health, review activity, heatmaps, level breakdown,
 * immersion tracking (scanline-merged), and word acquisition data.
 */

import { Component, createMemo, createResource, createSignal, For, onMount, Show } from 'solid-js';
import { useFlashcards, useSettings, useLanguage, useLocalization } from '../../context';
import { StatCard, Panel, BookIcon, KnowledgeGate, KnowledgeSkeleton, SkeletonCard, SkeletonStatGrid } from '../../components/common';
import { PieChart, BarChart, Heatmap, LineChart } from './charts';
import type { PieSegment, BarChartDataPoint } from './charts';
import { WordHistoryPanel } from './components/WordHistoryPanel';
import type { MediaStats } from '../../../shared/types';
import { DEFAULT_SETTINGS } from '../../../shared/types';
import { getBridge } from '../../../shared/bridges';
import { eventsVersion, getEventLogForLanguage } from '../../services/knowledgeEvents';
import { buildAnkiStatusKeySets } from '../../services/ankiWordsCache';
import { acquisitionSlope, daysToStableKnown, retentionAfterKnown, unifyEventLogByWord } from '../../services/learningAnalytics';
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
  const { store, isLoading } = useFlashcards();
  const { settings } = useSettings();
  const { getWordFrequency, currentLangData, getFreqLevelNames, getLanguageFeatures, getCanonicalFormForLanguage, getWordVariantsForLanguage } = useLanguage();
  const { t } = useLocalization();

  initTimeWatched(settings);

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
    return cleanup;
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
    const entries = Object.entries(ds).sort(([a], [b]) => a.localeCompare(b));

    const reviewHeatmap: Record<string, number> = {};
    const lapsesHeatmap: Record<string, number> = {};

    for (const [date, stat] of entries) {
      const totalReviews = stat.newCardsStudied + stat.reviewCardsStudied;
      reviewHeatmap[date] = totalReviews;
      if (stat.lapses > 0) lapsesHeatmap[date] = stat.lapses;
    }

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
        label: i % 3 === 0 ? dayLabel : '',
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
      reviewHeatmap,
      lapsesHeatmap,
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
    mediaStatsLoaded() && cardStats().total === 0 && dailyStatsData().totalDaysStudied === 0 && mediaTimeStats().totalImmersion === 0
  );

  const wordStats = createMemo(() =>
    computeWordLevelStats(
      store,
      getWordFrequency(),
      settings.language,
      settings.known_ease_threshold,
      settings.srsLearningThreshold,
      getFreqLevelNames(),
      currentLangData(),
      getCanonicalFormForLanguage,
      settings.use_anki
        ? buildAnkiStatusKeySets(
          settings.language,
          settings.ankiLearningThreshold,
          settings.ankiKnownThreshold,
          (word) => [getCanonicalFormForLanguage(settings.language, word)],
          currentLangData(),
        )
        : undefined,
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

  // ── Word acquisition (encounters until status change) ──
  const wordAcquisitionStats = createMemo(() => {
    const knowledge = store.wordKnowledge;
    const lang = settings.language;
    const values: number[] = [];

    for (const [key, entry] of Object.entries(knowledge)) {
      if (!key.startsWith(lang + ':')) continue;
      if (entry.statusChangedAtSeen !== undefined && entry.statusChangedAtSeen > 0) {
        values.push(entry.statusChangedAtSeen);
      }
    }

    if (values.length === 0) return { count: 0, average: 0, median: 0, buckets: [] as { label: string; count: number }[] };

    values.sort((a, b) => a - b);
    const sum = values.reduce((acc, v) => acc + v, 0);
    const average = Math.round(sum / values.length);
    const median = values.length % 2 === 0
      ? Math.round((values[values.length / 2 - 1] + values[values.length / 2]) / 2)
      : values[Math.floor(values.length / 2)];

    const bucketDefs = [
      { label: '4–10', min: 4, max: 10 },
      { label: '11–25', min: 11, max: 25 },
      { label: '26–50', min: 26, max: 50 },
      { label: '51–100', min: 51, max: 100 },
      { label: '100+', min: 101, max: Infinity },
    ];
    const buckets = bucketDefs.map(b => ({
      label: b.label,
      count: values.filter(v => v >= b.min && v <= b.max).length,
    }));

    return { count: values.length, average, median, buckets };
  });

  // ── Learning velocity cohorts (event-store aggregates) ──
  const [learningVelocity] = createResource(
    () => [settings.language, eventsVersion()] as const,
    async ([language]) => {
      const log = await getEventLogForLanguage(language);
      // Variant surfaces of one word live in several `${language}:${hash}` keys; unify before
      // cohort aggregation or one multi-hash write counts once per variant (unifyEventLogByWord).
      const eventsByWord = unifyEventLogByWord(log, (key) => {
        const word = store.wordKnowledge[key]?.word;
        if (!word) return undefined;
        return getWordFormCandidates(
          word,
          (w) => getCanonicalFormForLanguage(language, w),
          (w) => getWordVariantsForLanguage(language, w),
          { language },
        ).map((form) => `${language}:${hashWordSync(form)}`);
      });
      return {
        days: daysToStableKnown(eventsByWord),
        slope: acquisitionSlope(eventsByWord),
        retention: retentionAfterKnown(eventsByWord, Date.now()),
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

  // ── Pie chart data ──

  const cardStatePie = createMemo((): PieSegment[] => [
    { label: t('mlearn.Statistics.Dashboard.CardState.Review'), value: cardStats().review, color: 'var(--color-success)' },
    { label: t('mlearn.Statistics.Dashboard.CardState.Learning'), value: cardStats().learning, color: 'var(--color-warning)' },
    { label: t('mlearn.Statistics.Dashboard.CardState.New'), value: cardStats().newCards, color: 'var(--color-primary)' },
    { label: t('mlearn.Statistics.Dashboard.CardState.Suspended'), value: cardStats().suspended, color: 'var(--text-tertiary)' },
  ]);

  const maturityPie = createMemo((): PieSegment[] => [
    { label: t('mlearn.Statistics.Dashboard.Maturity.Mature'), value: cardStats().matureCount, color: 'var(--color-success)' },
    { label: t('mlearn.Statistics.Dashboard.Maturity.Young'), value: cardStats().youngCount, color: 'var(--color-info)' },
    { label: t('mlearn.Statistics.Dashboard.CardState.Learning'), value: cardStats().learning, color: 'var(--color-warning)' },
    { label: t('mlearn.Statistics.Dashboard.CardState.New'), value: cardStats().newCards, color: 'var(--color-primary)' },
  ]);

  const wordStatusPie = createMemo((): PieSegment[] => [
    { label: t('mlearn.Statistics.Legend.Learned'), value: wordStats().allEncountered.known, color: 'var(--color-success)' },
    { label: t('mlearn.Statistics.Legend.Learning'), value: wordStats().allEncountered.learning, color: 'var(--color-warning)' },
    { label: t('mlearn.Statistics.Legend.Viewed'), value: wordStats().allEncountered.unknown, color: 'var(--text-tertiary)' },
  ]);

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
  const reviewColorScale = [
    'var(--bg-intense)',
    'color-mix(in srgb, var(--color-primary) 25%, transparent)',
    'color-mix(in srgb, var(--color-primary) 50%, transparent)',
    'color-mix(in srgb, var(--color-primary) 75%, transparent)',
    'var(--color-primary)',
  ];
  const lapseColorScale = [
    'var(--bg-intense)',
    'color-mix(in srgb, var(--color-error) 25%, transparent)',
    'color-mix(in srgb, var(--color-error) 50%, transparent)',
    'color-mix(in srgb, var(--color-error) 75%, transparent)',
    'var(--color-error)',
  ];
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

      {/* ─── Header Stats ─── */}
      <div class="dashboard-stats-row">
        <StatCard label={t('mlearn.Statistics.Dashboard.TotalCards')} value={cardStats().total} size="md" variant="elevated" />
        <StatCard label={t('mlearn.Statistics.Dashboard.RetentionRate')} value={retentionCard().text} size="md" variant="elevated"
          color={retentionCard().color} />
        <StatCard label={t('mlearn.Statistics.Dashboard.CurrentStreak')} value={`${dailyStatsData().streakCurrent}d`} size="md" variant="elevated" color="primary" />
        <StatCard label={t('mlearn.Statistics.Dashboard.TotalImmersion')} value={formatDuration(mediaTimeStats().totalImmersion)} size="md" variant="elevated" />
      </div>

      {/* ─── Today's Session ─── */}
      <Panel variant="default" rounded="lg" padding="lg" class="dashboard-panel">
        <h2 class="dashboard-section-title">{t('mlearn.Statistics.Dashboard.TodaysSession')}</h2>
        <div class="dashboard-stats-row compact">
          <StatCard label={t('mlearn.Statistics.Dashboard.Reviews')} value={dailyStatsData().todayReviews} size="sm" />
          <StatCard label={t('mlearn.Statistics.Dashboard.NewLearned')} value={dailyStatsData().todayNew} size="sm" color="success" />
          <StatCard label={t('mlearn.Statistics.Dashboard.Lapses')} value={dailyStatsData().todayLapses} size="sm" color={dailyStatsData().todayLapses > 0 ? 'error' : 'default'} />
          <StatCard label={t('mlearn.Statistics.Dashboard.Graduated')} value={dailyStatsData().todayGraduated} size="sm" color="success" />
        </div>
        <div class="session-time-breakdown">
          <div class="session-time-total">
            <span class="session-time-label">{t('mlearn.Statistics.Dashboard.TotalSessionTime')}</span>
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
      </Panel>

      {/* ─── Due Forecast ─── */}
      <Panel variant="default" rounded="lg" padding="lg" class="dashboard-panel">
        <h2 class="dashboard-section-title">{t('mlearn.Statistics.Dashboard.DueForecast.Title')}</h2>
        <div class="dashboard-stats-row">
          <StatCard label={t('mlearn.Statistics.Dashboard.DueForecast.Today')} value={dueForecast().today} size="md" variant="elevated" />
          <StatCard label={t('mlearn.Statistics.Dashboard.DueForecast.Tomorrow')} value={dueForecast().tomorrow} size="md" variant="elevated" />
          <StatCard label={t('mlearn.Statistics.Dashboard.DueForecast.Next7Days')} value={dueForecast().next7} size="md" variant="elevated" />
          <StatCard label={t('mlearn.Statistics.Dashboard.DueForecast.Next30Days')} value={dueForecast().next30} size="md" variant="elevated" />
        </div>
      </Panel>

      {/* ─── Review Activity (Last 30 Days) ─── */}
      <Panel variant="default" rounded="lg" padding="lg" class="dashboard-panel">
        <div class="dashboard-section-header">
          <h2 class="dashboard-section-title">{t('mlearn.Statistics.Dashboard.ReviewActivity')}</h2>
          <div class="dashboard-legend-inline">
            <span class="legend-entry"><span class="legend-dot" style={{ background: 'var(--color-primary)' }} />{t('mlearn.Statistics.Dashboard.Reviews')}</span>
            <span class="legend-entry"><span class="legend-dot" style={{ background: 'var(--color-success)' }} />{t('mlearn.Statistics.Dashboard.CardState.New')}</span>
          </div>
        </div>
        <BarChart data={dailyStatsData().last30} height={100} stacked showValues={false} />
      </Panel>

      {/* ─── Heatmaps ─── */}
      <Panel variant="default" rounded="lg" padding="lg" class="dashboard-panel">
        <div class="dashboard-section-header">
          <h2 class="dashboard-section-title">{t('mlearn.Statistics.Dashboard.ReviewHeatmap')}</h2>
          <div class="dashboard-meta-stats">
            <span>{t('mlearn.Statistics.Dashboard.BestStreak')}: {dailyStatsData().streakMax}d</span>
            <span>{t('mlearn.Statistics.Dashboard.DaysStudied')}: {dailyStatsData().totalDaysStudied}</span>
            <span>{t('mlearn.Statistics.Dashboard.TotalTime')}: {formatDuration(dailyStatsData().totalStudyTime)}</span>
          </div>
        </div>
        <Heatmap
          data={dailyStatsData().reviewHeatmap}
          weeks={20}
          colorScale={reviewColorScale}
          formatTooltip={(date, val) => `${new Date(date + 'T00:00:00').toLocaleDateString(undefined, { dateStyle: 'medium' })}: ${val} ${t('mlearn.Statistics.Dashboard.Reviews').toLowerCase()}`}
        />
      </Panel>

      <Show when={Object.keys(dailyStatsData().lapsesHeatmap).length > 0}>
        <Panel variant="default" rounded="lg" padding="lg" class="dashboard-panel">
          <h2 class="dashboard-section-title">{t('mlearn.Statistics.Dashboard.LapseHeatmap')}</h2>
          <Heatmap
            data={dailyStatsData().lapsesHeatmap}
            weeks={20}
            colorScale={lapseColorScale}
            formatTooltip={(date, val) => `${new Date(date + 'T00:00:00').toLocaleDateString(undefined, { dateStyle: 'medium' })}: ${val} ${t('mlearn.Statistics.Dashboard.Lapses').toLowerCase()}`}
          />
        </Panel>
      </Show>

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
                    <td class="level-num">{row.unknown}</td>
                    <td class="level-num">{row.totalDictionaryWords}</td>
                    <td class="level-coverage-cell">
                      <div class="level-coverage-bar">
                        <Show when={row.totalDictionaryWords > 0}>
                          <div class="level-coverage-fill level-coverage-learned" style={{ width: `${(row.known / row.totalDictionaryWords) * 100}%` }} />
                          <div class="level-coverage-fill level-coverage-learning" style={{ width: `${(row.learning / row.totalDictionaryWords) * 100}%` }} />
                          <div class="level-coverage-fill level-coverage-viewed" style={{ width: `${(row.unknown / row.totalDictionaryWords) * 100}%` }} />
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
            <StatCard label={t('mlearn.Statistics.Legend.Viewed')} value={outsideLevels().unknown} size="sm" />
            <StatCard label={t('mlearn.Statistics.Dashboard.OutsideLevelsTotal')} value={outsideLevels().total} size="sm" />
          </div>
        </Panel>
      </Show>
      </KnowledgeGate>

      {/* ─── Card Analysis ─── */}
      <div class="dashboard-charts-row">
        <Panel variant="default" rounded="lg" padding="lg" class="dashboard-panel">
          <h2 class="dashboard-section-title">{t('mlearn.Statistics.Dashboard.CardStates')}</h2>
          <PieChart
            segments={cardStatePie()}
            size={160}
            thickness={24}
            centerValue={cardStats().total}
            centerLabel={t('mlearn.Statistics.Dashboard.CenterLabel.Cards')}
          />
        </Panel>

        <Panel variant="default" rounded="lg" padding="lg" class="dashboard-panel">
          <h2 class="dashboard-section-title">{t('mlearn.Statistics.Dashboard.Maturity.Title')}</h2>
          <PieChart
            segments={maturityPie()}
            size={160}
            thickness={24}
            centerValue={cardStats().matureCount}
            centerLabel={t('mlearn.Statistics.Dashboard.CenterLabel.Mature')}
          />
        </Panel>

        {/* Word-knowledge numbers derive from the learner projection: hold a
            stable panel shell until it is authoritative, then decide honestly
            between the pie and genuine emptiness. */}
        <KnowledgeGate fallback={<Panel variant="default" rounded="lg" padding="lg" class="dashboard-panel"><SkeletonCard lines={2} /></Panel>}>
        <Show when={wordStats().allEncountered.total > 0}>
          <Panel variant="default" rounded="lg" padding="lg" class="dashboard-panel">
            <h2 class="dashboard-section-title">{t('mlearn.Statistics.Dashboard.WordKnowledge')}</h2>
            <PieChart
              segments={wordStatusPie()}
              size={160}
              thickness={24}
              centerValue={wordStats().allEncountered.total}
              centerLabel={t('mlearn.Statistics.Dashboard.CenterLabel.Words')}
            />
          </Panel>
        </Show>
        </KnowledgeGate>
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

      {/* ─── Word Acquisition ─── */}
      <Show when={wordAcquisitionStats().count > 0}>
        <Panel variant="default" rounded="lg" padding="lg" class="dashboard-panel">
          <h2 class="dashboard-section-title">{t('mlearn.Statistics.Dashboard.WordAcquisition.Title')}</h2>
          <div class="dashboard-stats-row compact">
            <StatCard label={t('mlearn.Statistics.Dashboard.WordAcquisition.WordsTracked')} value={wordAcquisitionStats().count} size="sm" />
            <StatCard label={t('mlearn.Statistics.Dashboard.WordAcquisition.AvgEncounters')} value={wordAcquisitionStats().average} size="sm" />
            <StatCard label={t('mlearn.Statistics.Dashboard.WordAcquisition.MedianEncounters')} value={wordAcquisitionStats().median} size="sm" />
          </div>
          <div class="horizontal-bars horizontal-bars-spaced">
            <For each={wordAcquisitionStats().buckets}>
              {(bucket) => {
                const max = Math.max(...wordAcquisitionStats().buckets.map(b => b.count), 1);
                return (
                  <div class="h-bar-row">
                    <span class="h-bar-label">{bucket.label}</span>
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
      </Show>

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

      {/* ─── Word History Drill-down ─── */}
      <WordHistoryPanel />
      </Show>
      </Show>
    </div>
  );
};
