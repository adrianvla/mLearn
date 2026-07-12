import type { ChartSeries } from '../../components/charts/chartTypes';
import { formatDatum } from '../../components/charts/chartTypes';

interface AnalyticsHistoryTableProps {
  title: string;
  series: ChartSeries[];
}

export function AnalyticsHistoryTable({ title, series }: AnalyticsHistoryTableProps) {
  const rows = Math.max(0, ...series.map((item) => item.values.length));
  if (rows === 0) return null;

  return <div className="data-table-shell table-scroll analytics-history-table">
    <table aria-label={`${title} data`}>
      <caption>{title} data</caption>
      <thead><tr><th scope="col">Recorded period</th>{series.map((item) => <th scope="col" key={`${item.key}-${item.kind}`}>{item.label}{item.kind === 'comparison' ? ' — Previous period' : ''}</th>)}</tr></thead>
      <tbody>{Array.from({ length: rows }, (_, index) => {
        const bucket = series.find((item) => item.values[index])?.values[index];
        return <tr key={index}>
          <th scope="row">{bucket ? formatPeriod(bucket.start, bucket.end) : `Bucket ${index + 1}`}</th>
          {series.map((item) => <td key={`${item.key}-${item.kind}`}>{formatDatum(item.values[index])}</td>)}
        </tr>;
      })}</tbody>
    </table>
  </div>;
}

function formatPeriod(start: number, end: number): string {
  return `${new Date(start).toLocaleDateString()} – ${new Date(end).toLocaleDateString()}`;
}
