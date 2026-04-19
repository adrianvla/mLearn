/**
 * Statistics Dashboard
 * Learning analytics: card health, review activity, heatmaps, level breakdown,
 * immersion tracking (scanline-merged), and word acquisition data.
 */

import { Component, createMemo, createSignal, For, onMount, Show } from 'solid-js';
import { useFlashcards, useSettings, useLanguage, useLocalization } from '../../context';
import { StatCard, Panel } from '../../components/common';
import { PieChart, BarChart, Heatmap } from './charts';
import type { PieSegment, BarChartDataPoint } from './charts';
import type { MediaStats } from '../../../shared/types';
import { getBridge } from '../../../shared/bridges';

import {
  initTimeWatched,
  getWordsLearnedInAppStats,
  getWordsLearnedInApp,
} from '../../services/statsService';
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
  const { store } = useFlashcards();
  const { settings } = useSettings();
  const { wordFrequency, getFreqLevelNames, getFrequency, getLanguageFeatures } = useLanguage();
  const { t } = useLocalization();

  initTimeWatched(settings);

  // ── Media stats ──
  const [mediaStatsList, setMediaStatsList] = createSignal<MediaStats[]>([]);

  onMount(() => {
    const bridge = getBridge();
    const cleanup = bridge.mediaStats.onMediaStatsList((stats) => {
      setMediaStatsList(stats);
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

  const cardStats = createMemo(() => {
    const all = cards();
    const total = all.length;

    let newCards = 0;
    let learning = 0;
    let relearning = 0;
    let review = 0;
    let suspended = 0;
    let totalReviews = 0;
    let totalLapses = 0;
    let matureCount = 0;
    let youngCount = 0;
    let overdueCount = 0;

    const intervalBuckets = new Map<string, number>([
      ['< 1d', 0], ['1–7d', 0], ['1–4w', 0], ['1–6m', 0], ['> 6m', 0],
    ]);

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (const card of all) {
      if (card.suspended) { suspended++; continue; }
      if (card.buried) continue;
      if (card.state === 'new') newCards++;
      else if (card.state === 'learning') learning++;
      else if (card.state === 'relearning') relearning++;
      else if (card.state === 'review') review++;

      totalReviews += card.reviews;
      totalLapses += card.lapses;

      if (card.state === 'review') {
        const days = card.interval / (1000 * 60 * 60 * 24);
        if (days >= 21) matureCount++;
        else youngCount++;

        if (days < 1) intervalBuckets.set('< 1d', (intervalBuckets.get('< 1d') ?? 0) + 1);
        else if (days <= 7) intervalBuckets.set('1–7d', (intervalBuckets.get('1–7d') ?? 0) + 1);
        else if (days <= 28) intervalBuckets.set('1–4w', (intervalBuckets.get('1–4w') ?? 0) + 1);
        else if (days <= 180) intervalBuckets.set('1–6m', (intervalBuckets.get('1–6m') ?? 0) + 1);
        else intervalBuckets.set('> 6m', (intervalBuckets.get('> 6m') ?? 0) + 1);
      }

      if (card.dueDate && card.state !== 'new') {
        const due = new Date(card.dueDate);
        due.setHours(0, 0, 0, 0);
        if (due.getTime() < today.getTime()) overdueCount++;
      }
    }

    const retentionRate = totalReviews > 0
      ? ((totalReviews - totalLapses) / totalReviews) * 100
      : 100;

    return {
      total,
      newCards,
      learning: learning + relearning,
      review,
      suspended,
      retentionRate,
      totalReviews,
      totalLapses,
      matureCount,
      youngCount,
      overdueCount,
      intervalBuckets: Object.fromEntries(intervalBuckets),
    };
  });

  // ── Daily stats aggregation ──

  const dailyStatsData = createMemo(() => {
    const ds = store.dailyStats;
    const entries = Object.entries(ds).sort(([a], [b]) => a.localeCompare(b));

    const reviewHeatmap: Record<string, number> = {};
    const lapsesHeatmap: Record<string, number> = {};
    let totalStudyTime = 0;
    let streakCurrent = 0;
    let streakMax = 0;
    let totalDaysStudied = 0;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Current streak
    const streakDate = new Date(today);
    let counting = true;
    while (counting) {
      const key = streakDate.toISOString().slice(0, 10);
      const dayStat = ds[key];
      if (dayStat && (dayStat.newCardsStudied + dayStat.reviewCardsStudied) > 0) {
        streakCurrent++;
        streakDate.setDate(streakDate.getDate() - 1);
      } else {
        counting = false;
      }
    }

    for (const [date, stat] of entries) {
      const totalReviews = stat.newCardsStudied + stat.reviewCardsStudied;
      reviewHeatmap[date] = totalReviews;
      if (stat.lapses > 0) lapsesHeatmap[date] = stat.lapses;
      totalStudyTime += stat.timeSpent;
      if (totalReviews > 0) totalDaysStudied++;

      // Max streak
      let s = 0;
      const d = new Date(date);
      for (;;) {
        const k = d.toISOString().slice(0, 10);
        const st = ds[k];
        if (st && (st.newCardsStudied + st.reviewCardsStudied) > 0) {
          s++;
          d.setDate(d.getDate() + 1);
        } else break;
      }
      if (s > streakMax) streakMax = s;
    }

    // Last 30 days bar chart
    const last30: BarChartDataPoint[] = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      const stat = ds[key];
      const dayLabel = i === 0
        ? t('mlearn.Statistics.Dashboard.Today')
        : i <= 6
          ? d.toLocaleDateString(undefined, { weekday: 'short' })
          : `${d.getMonth() + 1}/${d.getDate()}`;

      last30.push({
        label: i % 3 === 0 ? dayLabel : '',
        value: stat?.reviewCardsStudied ?? 0,
        color: 'var(--color-primary)',
        secondaryValue: stat?.newCardsStudied ?? 0,
        secondaryColor: 'var(--color-success)',
      });
    }

    const todayKey = today.toISOString().slice(0, 10);
    const todayStat = ds[todayKey];

    return {
      reviewHeatmap,
      lapsesHeatmap,
      totalStudyTime,
      streakCurrent,
      streakMax,
      totalDaysStudied,
      last30,
      todayReviews: todayStat?.reviewCardsStudied ?? 0,
      todayNew: todayStat?.newCardsStudied ?? 0,
      todayLapses: todayStat?.lapses ?? 0,
      todayTime: todayStat?.timeSpent ?? 0,
      todayGraduated: todayStat?.graduated ?? 0,
    };
  });

  // ── Word stats ──
  const wordStats = createMemo(() => getWordsLearnedInAppStats());

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
    { label: t('mlearn.Statistics.Legend.Learned'), value: wordStats().learned, color: 'var(--color-success)' },
    { label: t('mlearn.Statistics.Legend.Learning'), value: wordStats().learning, color: 'var(--color-warning)' },
    { label: t('mlearn.Statistics.Legend.Viewed'), value: wordStats().unknown, color: 'var(--text-tertiary)' },
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

  // ── Level breakdown (with total words per level from frequency data) ──

  const levelBreakdown = createMemo(() => {
    if (!getLanguageFeatures().supportsFrequencyLevels) return [];
    const names = getFreqLevelNames();
    const entries = Object.entries(names).map(([k, v]) => ({ level: parseInt(k), name: v }));
    entries.sort((a, b) => b.level - a.level);
    if (entries.length === 0) return [];

    // Count total words per level from frequency dictionary
    const totalPerLevel = new Map<number, number>();
    for (const entry of entries) {
      totalPerLevel.set(entry.level, 0);
    }
    for (const freqEntry of Object.values(wordFrequency)) {
      const cur = totalPerLevel.get(freqEntry.raw_level);
      if (cur !== undefined) totalPerLevel.set(freqEntry.raw_level, cur + 1);
    }

    // Count user progress per level
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

    return entries.map(e => {
      const b = buckets.get(e.level) ?? { learned: 0, learning: 0, viewed: 0 };
      const total = totalPerLevel.get(e.level) ?? 0;
      const encountered = b.learned + b.learning + b.viewed;
      return {
        name: e.name || `${t('mlearn.Statistics.LevelColumn')} ${e.level}`,
        ...b,
        total,
        encountered,
        coveragePct: total > 0 ? Math.round((b.learned / total) * 100) : 0,
      };
    });
  });

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

      {/* ─── Header Stats ─── */}
      <div class="dashboard-stats-row">
        <StatCard label={t('mlearn.Statistics.Dashboard.TotalCards')} value={cardStats().total} size="md" variant="elevated" />
        <StatCard label={t('mlearn.Statistics.Dashboard.RetentionRate')} value={`${cardStats().retentionRate.toFixed(1)}%`} size="md" variant="elevated"
          color={cardStats().retentionRate >= 90 ? 'success' : cardStats().retentionRate >= 80 ? 'warning' : 'error'} />
        <StatCard label={t('mlearn.Statistics.Dashboard.CurrentStreak')} value={`${dailyStatsData().streakCurrent}d`} size="md" variant="elevated" color="primary" />
        <StatCard label={t('mlearn.Statistics.Dashboard.TotalImmersion')} value={formatDuration(mediaTimeStats().totalImmersion)} size="md" variant="elevated" />
      </div>

      {/* ─── Today's Session ─── */}
      <Panel variant="default" rounded="lg" padding="lg" class="dashboard-panel">
        <h3 class="dashboard-section-title">{t('mlearn.Statistics.Dashboard.TodaysSession')}</h3>
        <div class="dashboard-stats-row compact">
          <StatCard label={t('mlearn.Statistics.Dashboard.Reviews')} value={dailyStatsData().todayReviews} size="sm" />
          <StatCard label={t('mlearn.Statistics.Dashboard.NewLearned')} value={dailyStatsData().todayNew} size="sm" color="success" />
          <StatCard label={t('mlearn.Statistics.Dashboard.Lapses')} value={dailyStatsData().todayLapses} size="sm" color={dailyStatsData().todayLapses > 0 ? 'error' : 'default'} />
          <StatCard label={t('mlearn.Statistics.Dashboard.Graduated')} value={dailyStatsData().todayGraduated} size="sm" color="success" />
          <StatCard label={t('mlearn.Statistics.Dashboard.StudyTime')} value={formatDuration(dailyStatsData().todayTime)} size="sm" />
        </div>
      </Panel>

      {/* ─── Review Activity (Last 30 Days) ─── */}
      <Panel variant="default" rounded="lg" padding="lg" class="dashboard-panel">
        <div class="dashboard-section-header">
          <h3 class="dashboard-section-title">{t('mlearn.Statistics.Dashboard.ReviewActivity')}</h3>
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
          <h3 class="dashboard-section-title">{t('mlearn.Statistics.Dashboard.ReviewHeatmap')}</h3>
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
          formatTooltip={(date, val) => `${date}: ${val} ${t('mlearn.Statistics.Dashboard.Reviews').toLowerCase()}`}
        />
      </Panel>

      <Show when={Object.keys(dailyStatsData().lapsesHeatmap).length > 0}>
        <Panel variant="default" rounded="lg" padding="lg" class="dashboard-panel">
          <h3 class="dashboard-section-title">{t('mlearn.Statistics.Dashboard.LapseHeatmap')}</h3>
          <Heatmap
            data={dailyStatsData().lapsesHeatmap}
            weeks={20}
            colorScale={lapseColorScale}
            formatTooltip={(date, val) => `${date}: ${val} ${t('mlearn.Statistics.Dashboard.Lapses').toLowerCase()}`}
          />
        </Panel>
      </Show>

      <Show when={Object.keys(immersionHeatmap()).length > 0}>
        <Panel variant="default" rounded="lg" padding="lg" class="dashboard-panel">
          <h3 class="dashboard-section-title">{t('mlearn.Statistics.Dashboard.ImmersionHeatmap')}</h3>
          <Heatmap
            data={immersionHeatmap()}
            weeks={20}
            colorScale={immersionColorScale}
            formatTooltip={(date, val) => `${date}: ${formatMinutes(val)}`}
          />
        </Panel>
      </Show>

      {/* ─── Level Breakdown ─── */}
      <Show when={getLanguageFeatures().supportsFrequencyLevels && levelBreakdown().length > 0}>
        <Panel variant="default" rounded="lg" padding="lg" class="dashboard-panel">
          <h3 class="dashboard-section-title">{t('mlearn.Statistics.WordsByExamLevel')}</h3>
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
                    <td class="level-num">{row.learned}</td>
                    <td class="level-num">{row.learning}</td>
                    <td class="level-num">{row.viewed}</td>
                    <td class="level-num">{row.total}</td>
                    <td class="level-coverage-cell">
                      <div class="level-coverage-bar">
                        <Show when={row.total > 0}>
                          <div class="level-coverage-fill level-coverage-learned" style={{ width: `${(row.learned / row.total) * 100}%` }} />
                          <div class="level-coverage-fill level-coverage-learning" style={{ width: `${(row.learning / row.total) * 100}%` }} />
                          <div class="level-coverage-fill level-coverage-viewed" style={{ width: `${(row.viewed / row.total) * 100}%` }} />
                        </Show>
                      </div>
                      <span class="level-coverage-pct">{row.coveragePct}%</span>
                    </td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </Panel>
      </Show>

      {/* ─── Card Analysis ─── */}
      <div class="dashboard-charts-row">
        <Panel variant="default" rounded="lg" padding="lg" class="dashboard-panel">
          <h3 class="dashboard-section-title">{t('mlearn.Statistics.Dashboard.CardStates')}</h3>
          <PieChart
            segments={cardStatePie()}
            size={160}
            thickness={24}
            centerValue={cardStats().total}
            centerLabel={t('mlearn.Statistics.Dashboard.CenterLabel.Cards')}
          />
        </Panel>

        <Panel variant="default" rounded="lg" padding="lg" class="dashboard-panel">
          <h3 class="dashboard-section-title">{t('mlearn.Statistics.Dashboard.Maturity.Title')}</h3>
          <PieChart
            segments={maturityPie()}
            size={160}
            thickness={24}
            centerValue={cardStats().matureCount}
            centerLabel={t('mlearn.Statistics.Dashboard.CenterLabel.Mature')}
          />
        </Panel>

        <Show when={wordStats().total > 0}>
          <Panel variant="default" rounded="lg" padding="lg" class="dashboard-panel">
            <h3 class="dashboard-section-title">{t('mlearn.Statistics.Dashboard.WordKnowledge')}</h3>
            <PieChart
              segments={wordStatusPie()}
              size={160}
              thickness={24}
              centerValue={wordStats().total}
              centerLabel={t('mlearn.Statistics.Dashboard.CenterLabel.Words')}
            />
          </Panel>
        </Show>
      </div>

      {/* ─── Interval Distribution ─── */}
      <Panel variant="default" rounded="lg" padding="lg" class="dashboard-panel">
        <h3 class="dashboard-section-title">{t('mlearn.Statistics.Dashboard.IntervalDistribution')}</h3>
        <div class="horizontal-bars">
          <For each={Object.entries(cardStats().intervalBuckets)}>
            {([label, count]) => {
              const max = Math.max(...Object.values(cardStats().intervalBuckets), 1);
              return (
                <div class="h-bar-row">
                  <span class="h-bar-label">{label}</span>
                  <div class="h-bar-track">
                    <div class="h-bar-fill" style={{ width: `${(count / max) * 100}%` }} />
                  </div>
                  <span class="h-bar-value">{count}</span>
                </div>
              );
            }}
          </For>
        </div>
      </Panel>

      {/* ─── Word Acquisition ─── */}
      <Show when={wordAcquisitionStats().count > 0}>
        <Panel variant="default" rounded="lg" padding="lg" class="dashboard-panel">
          <h3 class="dashboard-section-title">{t('mlearn.Statistics.Dashboard.WordAcquisition.Title')}</h3>
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
    </div>
  );
};
