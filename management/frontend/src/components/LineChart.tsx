export interface ChartPoint { label: string; value: number }
export function LineChart({ title, data }: { title: string; data: ChartPoint[] }) {
  const max = Math.max(1, ...data.map((point) => point.value)); const width = 640; const height = 220;
  const points = data.map((point, index) => `${data.length === 1 ? width / 2 : index * width / (data.length - 1)},${height - point.value / max * (height - 20)}`).join(' ');
  return <figure className="chart"><figcaption><span className="chart-key" />{title}</figcaption><svg role="img" aria-label={title} viewBox={`0 0 ${width} ${height}`}><polyline points={points} fill="none" stroke="currentColor" strokeWidth="3" vectorEffect="non-scaling-stroke" /></svg><table className="sr-only"><caption>{title} data</caption><tbody>{data.map((point) => <tr key={point.label}><th>{point.label}</th><td>{point.value}</td></tr>)}</tbody></table></figure>;
}
