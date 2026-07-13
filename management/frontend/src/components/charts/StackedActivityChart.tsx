import { Button, Card, Tooltip } from '@heroui/react';
import type { AnalyticsCoverage } from '../../api/types';
import { CoverageAnnotation, ExactDataTable } from './HistoricalChart';
import { formatPeriodLabel, type ChartSeries } from './chartTypes';

const CHART_WIDTH = 640;
const CHART_HEIGHT = 220;
const CHART_PADDING = 28;

interface StackedActivityChartProps {
  title: string;
  series: ChartSeries[];
  onBucketClick?: (start: number, end: number) => void;
}

export function StackedActivityChart({ title, series, onBucketClick }: StackedActivityChartProps) {
  const primarySeries = series.filter((item) => item.kind === 'primary');
  const comparisonSeries = series.filter((item) => item.kind === 'comparison');
  const periodSeries = [{ kind: 'primary' as const, series: primarySeries }, ...(comparisonSeries.length === 0 ? [] : [{ kind: 'comparison' as const, series: comparisonSeries }])];
  const bucketCount = Math.max(0, ...periodSeries.flatMap((period) => period.series.map((item) => item.values.length)));
  const maximum = Math.max(1, ...periodSeries.flatMap((period) => Array.from({ length: bucketCount }, (_, index) => totalAt(period.series, index))));
  const drilldownBuckets = onBucketClick === undefined ? [] : periodSeries.flatMap((period) => (period.series[0]?.values ?? []).map((bucket) => ({ key: `${period.kind}-${bucket.start}-${bucket.end}`, start: bucket.start, end: bucket.end })));

  return <Card className="stacked-activity-chart">
    <Card.Header>
      <div>
        <Card.Title>{title}</Card.Title>
        <Card.Description>Recorded activity categories by time bucket.</Card.Description>
      </div>
      <Tooltip>
        <Tooltip.Trigger><Button size="sm" variant="secondary">Coverage</Button></Tooltip.Trigger>
        <Tooltip.Content>Unavailable values remain unavailable; the chart does not replace them with zero.</Tooltip.Content>
      </Tooltip>
    </Card.Header>
    <Card.Content>
      <figure className="stacked-activity-chart__figure">
        <figcaption>{primarySeries.map((item) => <span key={item.key}><i className="stacked-activity-chart__legend-key" data-series-index={primarySeries.indexOf(item)} />{item.label}</span>)}{periodSeries.map((period) => <span key={period.kind}><i className={`stacked-activity-chart__period-key stacked-activity-chart__period-key--${period.kind}`} />{formatPeriodLabel(period.series[0] ?? { key: '', label: '', kind: period.kind, values: [] })}</span>)}</figcaption>
        <svg role="img" aria-label={`${title} history`} viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}>
          <line className="historical-chart__baseline" x1={CHART_PADDING} x2={CHART_WIDTH - CHART_PADDING} y1={CHART_HEIGHT - CHART_PADDING} y2={CHART_HEIGHT - CHART_PADDING} />
          {periodSeries.flatMap((period, periodIndex) => Array.from({ length: bucketCount }, (_, index) => <StackedBar key={`${period.kind}-${index}`} index={index} bucketCount={bucketCount} kind={period.kind} periodIndex={periodIndex} periodCount={periodSeries.length} series={period.series} maximum={maximum} />))}
        </svg>
      </figure>
      {drilldownBuckets.length > 0 ? <div className="stacked-activity-chart__bucket-controls" aria-label={`${title} event history periods`}>{drilldownBuckets.map((bucket) => <Button key={bucket.key} size="sm" variant="secondary" aria-label={`Open event history for ${formatBucketRange(bucket.start, bucket.end)}`} onPress={() => onBucketClick?.(bucket.start, bucket.end)}>{formatBucketRange(bucket.start, bucket.end)}</Button>)}</div> : null}
      <CoverageAnnotation series={series} />
      <ExactDataTable title={title} series={series} visible={false} />
    </Card.Content>
  </Card>;
}

function StackedBar({ index, bucketCount, kind, periodIndex, periodCount, series, maximum }: { index: number; bucketCount: number; kind: ChartSeries['kind']; periodIndex: number; periodCount: number; series: ChartSeries[]; maximum: number }) {
  const values = series.map((item) => item.values[index]);
  const coverage = bucketCoverage(values.map((value) => value?.coverage));
  const innerWidth = CHART_WIDTH - CHART_PADDING * 2;
  const innerHeight = CHART_HEIGHT - CHART_PADDING * 2;
  const groupWidth = innerWidth / Math.max(bucketCount, 1);
  const inset = Math.min(8, groupWidth * 0.12);
  const gap = periodCount > 1 ? Math.min(4, groupWidth * 0.08) : 0;
  const barWidth = Math.max(2, (groupWidth - inset * 2 - gap * (periodCount - 1)) / periodCount);
  const x = CHART_PADDING + index * groupWidth + inset + periodIndex * (barWidth + gap);
  let currentY = CHART_HEIGHT - CHART_PADDING;

  return <g data-testid={periodCount === 1 && kind === 'primary' ? `stacked-bar-${index}` : `stacked-bar-${index}-${kind}`} data-coverage={coverage}>
    {values.map((datum, seriesIndex) => {
      if (!datum || datum.value === null) return null;
      const height = datum.value / maximum * innerHeight;
      currentY -= height;
      return <rect key={series[seriesIndex].key} className={`stacked-activity-chart__segment stacked-activity-chart__segment--${kind}`} data-series-index={seriesIndex} x={x} y={currentY} width={barWidth} height={height} rx="2" />;
    })}
  </g>;
}

function formatBucketRange(start: number, end: number): string {
  return `${new Date(start).toLocaleDateString()} to ${new Date(end).toLocaleDateString()}`;
}

function totalAt(series: ChartSeries[], index: number): number {
  return series.reduce((total, item) => total + (item.values[index]?.value ?? 0), 0);
}

function bucketCoverage(coverage: Array<AnalyticsCoverage | undefined>): AnalyticsCoverage {
  const available = coverage.filter((value): value is AnalyticsCoverage => value !== undefined);
  if (available.length === 0 || available.every((value) => value === 'missing')) return 'missing';
  if (available.some((value) => value === 'rawExpired')) return 'rawExpired';
  if (available.some((value) => value === 'partial') || available.some((value) => value === 'missing')) return 'partial';
  return 'complete';
}
