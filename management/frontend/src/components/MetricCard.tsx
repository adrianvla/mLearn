import { Card } from '@heroui/react';
import type { ReactNode } from 'react';
export function MetricCard({ label, value, detail }: { label: string; value: ReactNode; detail?: ReactNode }) { return <Card className="metric-card" data-testid="dashboard-metric"><Card.Content><span>{label}</span><strong>{value}</strong>{detail && <small>{detail}</small>}</Card.Content></Card>; }
