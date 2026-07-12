import { Button, Card, Tooltip } from '@heroui/react';
import type { AnalyticsCoverage } from '../../api/types';
import { CoverageAnnotation, ExactDataTable } from './HistoricalChart';
import type { ChartSeries } from './chartTypes';

const CHART_WIDTH = 640;
const CHART_HEIGHT = 220;
const CHART_PADDING = 28;

interface StackedActivityChartProps {
  title: string;
  series: ChartSeries[];
}

export function StackedActivityChart({ title, series }: StackedActivityChartProps) {
  const activitySeries = series.filter((item) => item.kind === 'primary');
  const bucketCount = Math.max(0, ...activitySeries.map((item) => item.values.length));
  const maximum = Math.max(1, ...Array.from({ length: bucketCount }, (_, index) => totalAt(activitySeries, index)));

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
        <figcaption>{activitySeries.map((item) => <span key={item.key}><i className="stacked-activity-chart__legend-key" data-series-index={activitySeries.indexOf(item)} />{item.label}</span>)}</figcaption>
        <svg role="img" aria-label={`${title} history`} viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}>
          <line className="historical-chart__baseline" x1={CHART_PADDING} x2={CHART_WIDTH - CHART_PADDING} y1={CHART_HEIGHT - CHART_PADDING} y2={CHART_HEIGHT - CHART_PADDING} />
          {Array.from({ length: bucketCount }, (_, index) => <StackedBar key={index} index={index} series={activitySeries} maximum={maximum} />)}
        </svg>
      </figure>
      <CoverageAnnotation series={activitySeries} />
      <ExactDataTable title={title} series={activitySeries} visible={false} />
    </Card.Content>
  </Card>;
}

function StackedBar({ index, series, maximum }: { index: number; series: ChartSeries[]; maximum: number }) {
  const values = series.map((item) => item.values[index]);
  const coverage = bucketCoverage(values.map((value) => value?.coverage));
  const innerWidth = CHART_WIDTH - CHART_PADDING * 2;
  const innerHeight = CHART_HEIGHT - CHART_PADDING * 2;
  const bucketCount = Math.max(...series.map((item) => item.values.length), 1);
  const gap = Math.max(4, innerWidth / bucketCount * 0.18);
  const barWidth = Math.max(2, innerWidth / bucketCount - gap);
  const x = CHART_PADDING + index * innerWidth / bucketCount + gap / 2;
  let currentY = CHART_HEIGHT - CHART_PADDING;

  return <g data-testid={`stacked-bar-${index}`} data-coverage={coverage}>
    {values.map((datum, seriesIndex) => {
      if (!datum || datum.value === null) return null;
      const height = datum.value / maximum * innerHeight;
      currentY -= height;
      return <rect key={series[seriesIndex].key} className="stacked-activity-chart__segment" data-series-index={seriesIndex} x={x} y={currentY} width={barWidth} height={height} rx="2" />;
    })}
  </g>;
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
