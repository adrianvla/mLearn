import { useMemo, useState } from 'react';
import { Button, Card, Tabs, Tooltip } from '@heroui/react';
import type { ChartDatum, ChartSeries } from './chartTypes';
import { formatDatum } from './chartTypes';

const CHART_WIDTH = 640;
const CHART_HEIGHT = 220;
const CHART_PADDING = 28;

interface HistoricalChartProps {
  title: string;
  series: ChartSeries[];
}

interface ExactDataTableProps {
  title: string;
  series: ChartSeries[];
  visible: boolean;
}

interface MetricGroup {
  key: string;
  label: string;
  primary?: ChartSeries;
  comparison?: ChartSeries;
}

export function HistoricalChart({ title, series }: HistoricalChartProps) {
  const metrics = useMemo(() => groupMetrics(series), [series]);
  const [selectedKey, setSelectedKey] = useState(() => metrics[0]?.key ?? '');
  const [showExactData, setShowExactData] = useState(false);
  const selectedMetric = metrics.find((metric) => metric.key === selectedKey) ?? metrics[0];
  const selectedSeries = selectedMetric ? [selectedMetric.primary, selectedMetric.comparison].filter(isChartSeries) : [];
  const maximum = getMaximum(selectedSeries);

  return <Card className="historical-chart">
    <Card.Header>
      <div>
        <Card.Title>{title}</Card.Title>
        <Card.Description>Reported activity by time bucket. Gaps are not treated as zero.</Card.Description>
      </div>
      <div className="historical-chart__actions">
        <Tooltip>
          <Tooltip.Trigger>
            <Button size="sm" variant="secondary" aria-label="About coverage">Coverage</Button>
          </Tooltip.Trigger>
          <Tooltip.Content>Partial, missing, and expired coverage remains explicit in the chart data.</Tooltip.Content>
        </Tooltip>
        <Button size="sm" variant="secondary" onPress={() => setShowExactData((visible) => !visible)}>
          {showExactData ? 'Hide exact data' : 'Show exact data'}
        </Button>
      </div>
    </Card.Header>
    <Card.Content>
      {metrics.length > 1 ? <Tabs selectedKey={selectedMetric?.key ?? ''} onSelectionChange={(key) => setSelectedKey(String(key))}>
        <Tabs.ListContainer className="historical-chart__tabs">
          <Tabs.List aria-label={`${title} metrics`}>
            {metrics.map((metric) => <Tabs.Tab id={metric.key} key={metric.key}>{metric.label}</Tabs.Tab>)}
          </Tabs.List>
        </Tabs.ListContainer>
      </Tabs> : null}
      <figure className="historical-chart__figure">
        <figcaption>{selectedMetric?.label ?? 'No metric selected'}</figcaption>
        <svg role="img" aria-label={`${title} history`} viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}>
          <title>{selectedMetric?.label ?? 'No metric selected'}</title>
          <line className="historical-chart__baseline" x1={CHART_PADDING} x2={CHART_WIDTH - CHART_PADDING} y1={CHART_HEIGHT - CHART_PADDING} y2={CHART_HEIGHT - CHART_PADDING} />
          {selectedSeries.map((item) => <path
            key={`${item.key}-${item.kind}`}
            data-testid={`chart-path-${item.key}-${item.kind}`}
            className={`historical-chart__path historical-chart__path--${item.kind}`}
            d={toPath(item.values, maximum)}
            fill="none"
            vectorEffect="non-scaling-stroke"
          />)}
        </svg>
        <div className="historical-chart__legend" aria-label="Chart legend">
          {selectedSeries.map((item) => <span key={`${item.key}-${item.kind}`}><i className={`historical-chart__legend-key historical-chart__legend-key--${item.kind}`} />{item.kind === 'primary' ? 'Current period' : 'Previous period'}</span>)}
        </div>
      </figure>
      <ExactDataTable title={title} series={selectedSeries} visible={showExactData} />
    </Card.Content>
  </Card>;
}

export function ExactDataTable({ title, series, visible }: ExactDataTableProps) {
  const rows = getTableRows(series);
  return <div className={`historical-chart__table-wrap${visible ? '' : ' sr-only'}`}>
    <table aria-label={`${title} data`}>
      <caption>{title} data</caption>
      <thead><tr><th scope="col">Period</th>{series.map((item) => <th key={`${item.key}-${item.kind}`} scope="col">{item.kind === 'primary' ? 'Current period' : 'Previous period'}</th>)}</tr></thead>
      <tbody>{rows.map((row, index) => <tr key={`${row.start}-${index}`}>
        <th scope="row">{formatPeriod(row.start, row.end)}</th>
        {series.map((item) => <td key={`${item.key}-${item.kind}`}>{formatDatum(item.values[index])}</td>)}
      </tr>)}</tbody>
    </table>
  </div>;
}

function groupMetrics(series: ChartSeries[]): MetricGroup[] {
  const metrics = new Map<string, MetricGroup>();
  for (const item of series) {
    const current = metrics.get(item.key) ?? { key: item.key, label: item.label };
    current[item.kind] = item;
    metrics.set(item.key, current);
  }
  return [...metrics.values()];
}

function getMaximum(series: ChartSeries[]): number {
  return Math.max(1, ...series.flatMap((item) => item.values.map((datum) => datum.value ?? 0)));
}

function toPath(values: ChartDatum[], maximum: number): string {
  const innerWidth = CHART_WIDTH - CHART_PADDING * 2;
  const innerHeight = CHART_HEIGHT - CHART_PADDING * 2;
  let isConnected = false;
  return values.reduce<string>((path, datum, index) => {
    if (datum.value === null) {
      isConnected = false;
      return path;
    }
    const x = values.length === 1 ? CHART_WIDTH / 2 : CHART_PADDING + index * innerWidth / (values.length - 1);
    const y = CHART_HEIGHT - CHART_PADDING - datum.value / maximum * innerHeight;
    const command = isConnected ? 'L' : 'M';
    isConnected = true;
    return `${path}${path ? ' ' : ''}${command} ${x.toFixed(2)} ${y.toFixed(2)}`;
  }, '');
}

function getTableRows(series: ChartSeries[]): ChartDatum[] {
  const longest = Math.max(0, ...series.map((item) => item.values.length));
  return Array.from({ length: longest }, (_, index) => series.find((item) => item.values[index])?.values[index] ?? {
    start: 0,
    end: 0,
    coverage: 'missing',
    value: null,
  });
}

function formatPeriod(start: number, end: number): string {
  if (start === 0 && end === 0) return 'No period recorded';
  return `${new Date(start).toLocaleDateString()} – ${new Date(end).toLocaleDateString()}`;
}

function isChartSeries(value: ChartSeries | undefined): value is ChartSeries {
  return value !== undefined;
}
