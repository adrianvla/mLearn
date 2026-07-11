import type { ReactNode } from 'react';
export function MetricCard({ label, value, detail }: { label: string; value: ReactNode; detail?: ReactNode }) { return <article className="metric-card"><span>{label}</span><strong>{value}</strong>{detail && <small>{detail}</small>}</article>; }
