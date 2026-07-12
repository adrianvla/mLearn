import type { AnalyticsCoverage, AnalyticsMetric, HistoricalBucket } from '../../api/types';

export interface ChartDatum {
  start: number;
  end: number;
  value: number | null;
  coverage: AnalyticsCoverage;
}

export interface ChartSeries {
  key: string;
  label: string;
  kind: 'primary' | 'comparison';
  comparisonLabel?: string;
  values: ChartDatum[];
}

export function formatPeriodLabel(series: ChartSeries): string {
  return series.kind === 'primary' ? 'Current period' : series.comparisonLabel ?? 'Previous period';
}

export function normalizeHistoricalMetric(
  key: AnalyticsMetric,
  label: string,
  kind: ChartSeries['kind'],
  buckets: HistoricalBucket[],
): ChartSeries {
  return {
    key,
    label,
    kind,
    values: buckets.map((bucket) => ({
      start: bucket.start,
      end: bucket.end,
      coverage: bucket.coverage,
      value: bucket.values?.[key] ?? null,
    })),
  };
}

export function formatCoverage(coverage: AnalyticsCoverage): string {
  switch (coverage) {
    case 'complete': return 'Complete coverage';
    case 'partial': return 'Partial coverage';
    case 'rawExpired': return 'Raw detail expired';
    case 'missing': return 'No recorded data';
  }
}

export function formatDatum(datum: ChartDatum | undefined): string {
  if (!datum || datum.value === null) return formatCoverage(datum?.coverage ?? 'missing');
  return datum.coverage === 'complete'
    ? datum.value.toLocaleString()
    : `${datum.value.toLocaleString()} (${formatCoverage(datum.coverage).toLowerCase()})`;
}
