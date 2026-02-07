/**
 * FlashcardStats Component
 * Advanced flashcard statistics with pie charts, distribution graphs,
 * daily activity heatmap, and retention metrics.
 * All rendering done via HTML Canvas for pie/bar charts.
 */

import { Component, createMemo, onMount, onCleanup, createSignal, Show, For } from 'solid-js';
import { useFlashcards } from '../../context';
import { useLocalization } from '../../context';
import { Card, StatCard } from '../common';
import './FlashcardStats.css';

// ============================================================================
// Types
// ============================================================================

interface PieSlice {
  label: string;
  value: number;
  color: string;
}

interface BarData {
  label: string;
  value: number;
  color: string;
}

// ============================================================================
// Canvas Drawing Helpers
// ============================================================================

/**
 * Draws a pie chart on a canvas with optional donut hole
 */
function drawPieChart(
  canvas: HTMLCanvasElement,
  slices: PieSlice[],
  opts: { donut?: boolean; holeLabel?: string; holeSublabel?: string } = {}
) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.scale(dpr, dpr);

  const w = rect.width;
  const h = rect.height;
  const cx = w / 2;
  const cy = h / 2;
  const radius = Math.min(cx, cy) - 4;
  const innerRadius = opts.donut ? radius * 0.58 : 0;

  const total = slices.reduce((sum, s) => sum + s.value, 0);
  if (total === 0) {
    // Draw empty state circle
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fillStyle = getComputedCSSVar('--border-color', 'rgba(128,128,128,0.2)');
    ctx.fill();
    if (opts.donut) {
      ctx.beginPath();
      ctx.arc(cx, cy, innerRadius, 0, Math.PI * 2);
      ctx.fillStyle = getComputedCSSVar('--bg-opaque', '#f5f5f5');
      ctx.fill();
    }
    return;
  }

  let startAngle = -Math.PI / 2;

  for (const slice of slices) {
    if (slice.value === 0) continue;
    const sliceAngle = (slice.value / total) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, radius, startAngle, startAngle + sliceAngle);
    ctx.closePath();
    ctx.fillStyle = slice.color;
    ctx.fill();
    startAngle += sliceAngle;
  }

  // Donut hole
  if (opts.donut) {
    ctx.beginPath();
    ctx.arc(cx, cy, innerRadius, 0, Math.PI * 2);
    ctx.fillStyle = getComputedCSSVar('--bg-opaque', '#f5f5f5');
    ctx.fill();

    // Center label
    if (opts.holeLabel) {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = getComputedCSSVar('--text-primary', '#1a1a1a');
      ctx.font = `bold ${Math.round(innerRadius * 0.45)}px sans-serif`;
      ctx.fillText(opts.holeLabel, cx, opts.holeSublabel ? cy - innerRadius * 0.12 : cy);
      if (opts.holeSublabel) {
        ctx.fillStyle = getComputedCSSVar('--text-secondary', '#666');
        ctx.font = `${Math.round(innerRadius * 0.22)}px sans-serif`;
        ctx.fillText(opts.holeSublabel, cx, cy + innerRadius * 0.28);
      }
    }
  }
}

/**
 * Draws a vertical bar chart on a canvas
 */
function drawBarChart(
  canvas: HTMLCanvasElement,
  bars: BarData[],
  opts: { maxVal?: number; showLabels?: boolean; barRadius?: number } = {}
) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.scale(dpr, dpr);

  const w = rect.width;
  const h = rect.height;
  const padding = { top: 8, bottom: opts.showLabels ? 20 : 4, left: 4, right: 4 };
  const chartW = w - padding.left - padding.right;
  const chartH = h - padding.top - padding.bottom;

  if (bars.length === 0) return;

  const maxVal = opts.maxVal ?? Math.max(...bars.map(b => b.value), 1);
  const barGap = Math.max(1, Math.min(3, chartW / bars.length * 0.15));
  const barWidth = Math.max(2, (chartW - barGap * (bars.length - 1)) / bars.length);
  const barRadius = opts.barRadius ?? Math.min(3, barWidth / 2);

  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i];
    const barH = Math.max(1, (bar.value / maxVal) * chartH);
    const x = padding.left + i * (barWidth + barGap);
    const y = padding.top + chartH - barH;

    ctx.fillStyle = bar.color;
    roundedRect(ctx, x, y, barWidth, barH, barRadius);
    ctx.fill();

    if (opts.showLabels && bar.label) {
      ctx.fillStyle = getComputedCSSVar('--text-tertiary', 'rgba(0,0,0,0.4)');
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(bar.label, x + barWidth / 2, padding.top + chartH + 4, barWidth + barGap);
    }
  }
}

/**
 * Draws a horizontal stacked bar (progress bar style)
 */
function drawStackedBar(
  canvas: HTMLCanvasElement,
  segments: PieSlice[]
) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.scale(dpr, dpr);

  const w = rect.width;
  const h = rect.height;
  const total = segments.reduce((s, seg) => s + seg.value, 0);
  const radius = h / 2;

  if (total === 0) {
    ctx.fillStyle = getComputedCSSVar('--border-color', 'rgba(128,128,128,0.2)');
    roundedRect(ctx, 0, 0, w, h, radius);
    ctx.fill();
    return;
  }

  // Draw full background
  ctx.fillStyle = getComputedCSSVar('--border-color', 'rgba(128,128,128,0.2)');
  roundedRect(ctx, 0, 0, w, h, radius);
  ctx.fill();

  // Clip to rounded rect
  ctx.save();
  ctx.beginPath();
  roundedRectPath(ctx, 0, 0, w, h, radius);
  ctx.clip();

  let x = 0;
  for (const seg of segments) {
    if (seg.value === 0) continue;
    const segW = (seg.value / total) * w;
    ctx.fillStyle = seg.color;
    ctx.fillRect(x, 0, segW + 1, h); // +1 to avoid gaps
    x += segW;
  }

  ctx.restore();
}

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  roundedRectPath(ctx, x, y, w, h, r);
  ctx.closePath();
}

function roundedRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  r = Math.min(r, w / 2, h / 2);
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
}

function getComputedCSSVar(name: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback;
  const val = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return val || fallback;
}

// ============================================================================
// Main Component
// ============================================================================

export interface FlashcardStatsProps {
  class?: string;
}

export const FlashcardStats: Component<FlashcardStatsProps> = (props) => {
  const {
    store,
    getAllCards,
    queueCounts,
    updateMeta,
  } = useFlashcards();
  const { t } = useLocalization();

  // Canvas refs
  let stateChartRef: HTMLCanvasElement | undefined;
  let easeChartRef: HTMLCanvasElement | undefined;
  let intervalChartRef: HTMLCanvasElement | undefined;
  let activityChartRef: HTMLCanvasElement | undefined;
  let maturityBarRef: HTMLCanvasElement | undefined;

  // ---- Computed Data ----

  const cards = createMemo(() => getAllCards());
  const counts = createMemo(() => queueCounts());
  const activeCards = createMemo(() => cards().filter(c => !c.suspended));

  // Card state distribution
  const stateDistribution = createMemo(() => {
    const all = cards();
    return {
      new: all.filter(c => c.state === 'new' && !c.suspended).length,
      learning: all.filter(c => (c.state === 'learning' || c.state === 'relearning') && !c.suspended).length,
      review: all.filter(c => c.state === 'review' && !c.suspended).length,
      suspended: all.filter(c => c.suspended).length,
    };
  });

  // Ease factor distribution (buckets)
  const easeDistribution = createMemo(() => {
    const reviewed = activeCards().filter(c => c.state === 'review' || c.state === 'relearning');
    const buckets: Record<string, number> = {
      '1.3-1.5': 0, '1.5-1.8': 0, '1.8-2.1': 0, '2.1-2.5': 0, '2.5-3.0': 0, '3.0+': 0
    };
    for (const card of reviewed) {
      const e = card.ease;
      if (e < 1.5) buckets['1.3-1.5']++;
      else if (e < 1.8) buckets['1.5-1.8']++;
      else if (e < 2.1) buckets['1.8-2.1']++;
      else if (e < 2.5) buckets['2.1-2.5']++;
      else if (e < 3.0) buckets['2.5-3.0']++;
      else buckets['3.0+']++;
    }
    return buckets;
  });

  // Interval distribution
  const intervalDistribution = createMemo(() => {
    const reviewed = activeCards().filter(c => c.state === 'review');
    const DAY = 24 * 60 * 60 * 1000;
    const buckets = [
      { label: '<1d', max: DAY, count: 0 },
      { label: '1-3d', max: 3 * DAY, count: 0 },
      { label: '3-7d', max: 7 * DAY, count: 0 },
      { label: '1-2w', max: 14 * DAY, count: 0 },
      { label: '2w-1m', max: 30 * DAY, count: 0 },
      { label: '1-3m', max: 90 * DAY, count: 0 },
      { label: '3-6m', max: 180 * DAY, count: 0 },
      { label: '6m+', max: Infinity, count: 0 },
    ];
    for (const card of reviewed) {
      for (const bucket of buckets) {
        if (card.interval < bucket.max) {
          bucket.count++;
          break;
        }
      }
    }
    return buckets;
  });

  // Maturity breakdown (young vs mature)
  const maturityBreakdown = createMemo(() => {
    const reviewed = activeCards().filter(c => c.state === 'review');
    const MATURE_THRESHOLD = 21 * 24 * 60 * 60 * 1000; // 21 days
    const mature = reviewed.filter(c => c.interval >= MATURE_THRESHOLD).length;
    const young = reviewed.length - mature;
    return { young, mature, total: reviewed.length };
  });

  // Retention rate (from daily stats)
  const retentionStats = createMemo(() => {
    const daily = store.dailyStats;
    const keys = Object.keys(daily).sort().slice(-30); // last 30 days
    let totalReviews = 0;
    let totalLapses = 0;
    let totalTime = 0;
    let totalNew = 0;
    let totalGraduated = 0;

    for (const key of keys) {
      const d = daily[key];
      totalReviews += d.reviewCardsStudied;
      totalLapses += d.lapses;
      totalTime += d.timeSpent;
      totalNew += d.newCardsStudied;
      totalGraduated += d.graduated;
    }

    const retention = totalReviews > 0 ? ((totalReviews - totalLapses) / totalReviews) * 100 : 0;
    const avgTimePerDay = keys.length > 0 ? totalTime / keys.length : 0;

    return {
      retention: Math.round(retention * 10) / 10,
      totalReviews,
      totalLapses,
      totalNew,
      totalGraduated,
      avgTimePerDay,
      daysStudied: keys.filter(k => daily[k].reviewCardsStudied + daily[k].newCardsStudied > 0).length,
      totalDays: keys.length,
    };
  });

  // Average ease
  const averageEase = createMemo(() => {
    const reviewed = activeCards().filter(c => c.state === 'review' || c.state === 'relearning');
    if (reviewed.length === 0) return 0;
    const sum = reviewed.reduce((s, c) => s + c.ease, 0);
    return Math.round((sum / reviewed.length) * 100) / 100;
  });

  // Daily activity (last 30 days bar chart)
  const dailyActivity = createMemo(() => {
    const daily = store.dailyStats;
    const result: { date: string; total: number; newCards: number; reviews: number }[] = [];
    const now = new Date();

    for (let i = 29; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const key = d.toISOString().split('T')[0];
      const stats = daily[key];
      result.push({
        date: key,
        total: stats ? stats.newCardsStudied + stats.reviewCardsStudied : 0,
        newCards: stats?.newCardsStudied ?? 0,
        reviews: stats?.reviewCardsStudied ?? 0,
      });
    }
    return result;
  });

  // Format milliseconds to readable time
  const formatTime = (ms: number): string => {
    const minutes = Math.round(ms / 60000);
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  };

  // Format day label (DD)
  const formatDayLabel = (dateStr: string): string => {
    return dateStr.split('-')[2];
  };

  // ---- Chart Colors ----

  const chartColors = createMemo(() => ({
    new: getComputedCSSVar('--color-primary', '#4a90d9'),
    learning: getComputedCSSVar('--color-warning', '#f1c40f'),
    review: getComputedCSSVar('--color-success', '#58c333'),
    suspended: getComputedCSSVar('--text-tertiary', 'rgba(0,0,0,0.3)'),
    ease: getComputedCSSVar('--color-info', '#3498db'),
    mature: getComputedCSSVar('--color-success', '#58c333'),
    young: getComputedCSSVar('--color-primary', '#4a90d9'),
    lapse: getComputedCSSVar('--color-error', '#e74c3c'),
  }));

  // ---- Render Charts ----

  const renderAllCharts = () => {
    const colors = chartColors();

    // State distribution pie chart
    if (stateChartRef) {
      const dist = stateDistribution();
      drawPieChart(stateChartRef, [
        { label: t('mlearn.Flashcards.Statistics.New'), value: dist.new, color: colors.new },
        { label: t('mlearn.Flashcards.Statistics.Learning'), value: dist.learning, color: colors.learning },
        { label: t('mlearn.Flashcards.Statistics.Review'), value: dist.review, color: colors.review },
        { label: t('mlearn.Flashcards.Statistics.Suspended'), value: dist.suspended, color: colors.suspended },
      ], {
        donut: true,
        holeLabel: String(cards().length),
        holeSublabel: t('mlearn.Flashcards.Statistics.TotalCards'),
      });
    }

    // Ease distribution bar chart
    if (easeChartRef) {
      const dist = easeDistribution();
      const entries = Object.entries(dist);
      drawBarChart(easeChartRef, entries.map(([label, value]) => ({
        label,
        value,
        color: colors.ease,
      })), { showLabels: true });
    }

    // Interval distribution bar chart
    if (intervalChartRef) {
      const dist = intervalDistribution();
      drawBarChart(intervalChartRef, dist.map(b => ({
        label: b.label,
        value: b.count,
        color: colors.review,
      })), { showLabels: true });
    }

    // Daily activity bar chart
    if (activityChartRef) {
      const activity = dailyActivity();
      drawBarChart(activityChartRef, activity.map(d => ({
        label: formatDayLabel(d.date),
        value: d.total,
        color: d.total > 0 ? colors.review : 'transparent',
      })), { showLabels: true, barRadius: 2 });
    }

    // Maturity stacked bar
    if (maturityBarRef) {
      const m = maturityBreakdown();
      drawStackedBar(maturityBarRef, [
        { label: t('mlearn.Flashcards.Statistics.Advanced.Young'), value: m.young, color: colors.young },
        { label: t('mlearn.Flashcards.Statistics.Advanced.Mature'), value: m.mature, color: colors.mature },
      ]);
    }
  };

  // Handle resize
  const [, setResizeTick] = createSignal(0);
  let resizeObserver: ResizeObserver | undefined;

  onMount(() => {
    // Initial render after DOM is ready
    requestAnimationFrame(() => {
      renderAllCharts();
    });

    // Observe resize
    const container = stateChartRef?.parentElement?.parentElement;
    if (container) {
      resizeObserver = new ResizeObserver(() => {
        setResizeTick(prev => prev + 1);
        renderAllCharts();
      });
      resizeObserver.observe(container);
    }
  });

  onCleanup(() => {
    resizeObserver?.disconnect();
  });

  // Re-render when data changes
  createMemo(() => {
    // Touch reactive dependencies
    cards();
    stateDistribution();
    easeDistribution();
    intervalDistribution();
    dailyActivity();
    maturityBreakdown();
    // Trigger re-render
    requestAnimationFrame(() => renderAllCharts());
  });

  // ---- Legend Component ----

  const PieLegend: Component<{ items: PieSlice[] }> = (legendProps) => {
    const total = createMemo(() => legendProps.items.reduce((s, i) => s + i.value, 0));
    return (
      <div class="stats-legend">
        <For each={legendProps.items}>
          {(item) => (
            <div class="stats-legend-item">
              <span class="stats-legend-dot" style={{ background: item.color }} />
              <span class="stats-legend-label">{item.label}</span>
              <span class="stats-legend-value">{item.value}</span>
              <Show when={total() > 0}>
                <span class="stats-legend-pct">
                  {Math.round((item.value / total()) * 100)}%
                </span>
              </Show>
            </div>
          )}
        </For>
      </div>
    );
  };

  return (
    <div class={`flashcard-stats ${props.class || ''}`}>
      {/* Top stat cards row */}
      <div class="flashcard-stats-hero">
        <Card>
          <StatCard
            label={t('mlearn.Flashcards.Statistics.TotalCards')}
            value={cards().length}
            icon="📚"
            color="primary"
            size="lg"
          />
        </Card>
        <Card>
          <StatCard
            label={t('mlearn.Flashcards.Statistics.DueToday')}
            value={counts().total}
            icon="📅"
            color="warning"
            size="lg"
          />
        </Card>
        <Card>
          <StatCard
            label={t('mlearn.Flashcards.Statistics.Mature')}
            value={maturityBreakdown().mature}
            icon="⭐"
            color="success"
            size="lg"
          />
        </Card>
      </div>

      {/* Retention & key metrics */}
      <div class="flashcard-stats-metrics">
        <Card class="flashcard-stats-metric-card">
          <div class="stats-metric">
            <span class="stats-metric-value stats-metric-retention">
              {retentionStats().retention}%
            </span>
            <span class="stats-metric-label">
              {t('mlearn.Flashcards.Statistics.Advanced.RetentionRate')}
            </span>
            <span class="stats-metric-sublabel">
              {t('mlearn.Flashcards.Statistics.Advanced.Last30Days')}
            </span>
          </div>
        </Card>
        <Card class="flashcard-stats-metric-card">
          <div class="stats-metric">
            <span class="stats-metric-value">
              {averageEase()}
            </span>
            <span class="stats-metric-label">
              {t('mlearn.Flashcards.Statistics.Advanced.AverageEase')}
            </span>
          </div>
        </Card>
        <Card class="flashcard-stats-metric-card">
          <div class="stats-metric">
            <span class="stats-metric-value">
              {formatTime(retentionStats().avgTimePerDay)}
            </span>
            <span class="stats-metric-label">
              {t('mlearn.Flashcards.Statistics.Advanced.AvgTimePerDay')}
            </span>
          </div>
        </Card>
        <Card class="flashcard-stats-metric-card">
          <div class="stats-metric">
            <span class="stats-metric-value">
              {retentionStats().daysStudied}/{retentionStats().totalDays}
            </span>
            <span class="stats-metric-label">
              {t('mlearn.Flashcards.Statistics.Advanced.DaysStudied')}
            </span>
          </div>
        </Card>
      </div>

      {/* Charts Row 1: State Distribution + Daily Activity */}
      <div class="flashcard-stats-charts-row">
        {/* State Distribution Pie */}
        <Card title={t('mlearn.Flashcards.Statistics.CardBreakdown')} class="flashcard-stats-chart-card">
          <div class="stats-chart-container">
            <canvas ref={stateChartRef} class="stats-pie-canvas" />
            <PieLegend items={[
              { label: t('mlearn.Flashcards.Statistics.New'), value: stateDistribution().new, color: chartColors().new },
              { label: t('mlearn.Flashcards.Statistics.Learning'), value: stateDistribution().learning, color: chartColors().learning },
              { label: t('mlearn.Flashcards.Statistics.Review'), value: stateDistribution().review, color: chartColors().review },
              { label: t('mlearn.Flashcards.Statistics.Suspended'), value: stateDistribution().suspended, color: chartColors().suspended },
            ]} />
          </div>
        </Card>

        {/* Daily Activity */}
        <Card title={t('mlearn.Flashcards.Statistics.Advanced.DailyActivity')} class="flashcard-stats-chart-card">
          <div class="stats-chart-container stats-chart-container--bar">
            <canvas ref={activityChartRef} class="stats-bar-canvas" />
            <div class="stats-activity-summary">
              <div class="stats-activity-stat">
                <span class="stats-activity-value">{retentionStats().totalReviews}</span>
                <span class="stats-activity-label">{t('mlearn.Flashcards.Statistics.Advanced.TotalReviews')}</span>
              </div>
              <div class="stats-activity-stat">
                <span class="stats-activity-value">{retentionStats().totalNew}</span>
                <span class="stats-activity-label">{t('mlearn.Flashcards.Statistics.Advanced.TotalNewLearned')}</span>
              </div>
              <div class="stats-activity-stat">
                <span class="stats-activity-value">{retentionStats().totalLapses}</span>
                <span class="stats-activity-label">{t('mlearn.Flashcards.Statistics.Advanced.TotalLapses')}</span>
              </div>
            </div>
          </div>
        </Card>
      </div>

      {/* Charts Row 2: Ease Distribution + Interval Distribution */}
      <div class="flashcard-stats-charts-row">
        {/* Ease Distribution */}
        <Card title={t('mlearn.Flashcards.Statistics.Advanced.EaseDistribution')} class="flashcard-stats-chart-card">
          <div class="stats-chart-container stats-chart-container--bar">
            <canvas ref={easeChartRef} class="stats-bar-canvas" />
          </div>
        </Card>

        {/* Interval Distribution */}
        <Card title={t('mlearn.Flashcards.Statistics.Advanced.IntervalDistribution')} class="flashcard-stats-chart-card">
          <div class="stats-chart-container stats-chart-container--bar">
            <canvas ref={intervalChartRef} class="stats-bar-canvas" />
          </div>
        </Card>
      </div>

      {/* Maturity Progress Bar */}
      <Card title={t('mlearn.Flashcards.Statistics.Advanced.CardMaturity')} class="flashcard-stats-maturity">
        <div class="stats-maturity-container">
          <canvas ref={maturityBarRef} class="stats-maturity-canvas" />
          <div class="stats-maturity-labels">
            <div class="stats-maturity-label">
              <span class="stats-legend-dot" style={{ background: chartColors().young }} />
              <span>{t('mlearn.Flashcards.Statistics.Advanced.Young')}</span>
              <span class="stats-maturity-count">{maturityBreakdown().young}</span>
            </div>
            <div class="stats-maturity-label">
              <span class="stats-legend-dot" style={{ background: chartColors().mature }} />
              <span>{t('mlearn.Flashcards.Statistics.Advanced.Mature')}</span>
              <span class="stats-maturity-count">{maturityBreakdown().mature}</span>
            </div>
          </div>
        </div>
      </Card>

      {/* Today's Progress */}
      <Card title={t('mlearn.Flashcards.Statistics.TodayProgress')} class="flashcard-stats-today">
        <div class="breakdown-rows">
          <div class="breakdown-row">
            <span>{t('mlearn.Flashcards.Statistics.NewCardsStudied')}</span>
            <span>
              {store.meta.newCardsToday} / {store.meta.maxNewCardsPerDayLearning === -1 ? '∞' : store.meta.maxNewCardsPerDayLearning}
            </span>
          </div>
          <div class="breakdown-row">
            <span>{t('mlearn.Flashcards.Statistics.ReviewsCompleted')}</span>
            <span>
              {store.meta.reviewsToday} / {store.meta.maxReviewsPerDay === -1 ? '∞' : store.meta.maxReviewsPerDay}
            </span>
          </div>
        </div>
      </Card>

      {/* Quick Learning Limits */}
      <Card title={t('mlearn.Flashcards.Statistics.LearningLimits')} class="flashcard-stats-limits">
        <div class="breakdown-rows">
          <div class="breakdown-row">
            <span>{t('mlearn.Flashcards.Statistics.MaxNewCardsPerDay')}</span>
            <input
              type="number"
              class="flashcards-limit-input"
              value={store.meta.maxNewCardsPerDayLearning}
              min={-1}
              max={1000}
              onChange={(e) => {
                const val = parseInt(e.currentTarget.value);
                if (!isNaN(val) && val >= -1) {
                  updateMeta({ maxNewCardsPerDayLearning: val });
                }
              }}
            />
          </div>
          <div class="breakdown-row">
            <span>{t('mlearn.Flashcards.Statistics.MaxReviewsPerDay')}</span>
            <input
              type="number"
              class="flashcards-limit-input"
              value={store.meta.maxReviewsPerDay}
              min={-1}
              max={10000}
              onChange={(e) => {
                const val = parseInt(e.currentTarget.value);
                if (!isNaN(val) && val >= -1) {
                  updateMeta({ maxReviewsPerDay: val });
                }
              }}
            />
          </div>
          <p class="flashcards-limit-hint">{t('mlearn.Flashcards.Statistics.LimitHint')}</p>
        </div>
      </Card>
    </div>
  );
};

export default FlashcardStats;
