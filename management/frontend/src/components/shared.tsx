import { Spinner, Card, CardContent } from '@heroui/react';
import { AlertTriangle } from 'lucide-react';
import type { ReactNode } from 'react';

export function PageContainer({ children }: { children: ReactNode }) {
  return <div className="p-6">{children}</div>;
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex items-start justify-between">
      <div>
        <h1 className="text-2xl font-bold text-foreground">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex gap-2">{actions}</div>}
    </div>
  );
}

export function LoadingState({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex h-64 items-center justify-center gap-3">
      <Spinner size="lg" />
      <span className="text-muted">{label}</span>
    </div>
  );
}

export function ErrorState({ message }: { message: string }) {
  return (
    <Card className="border border-danger bg-danger/10">
      <CardContent>
        <div className="flex items-center gap-3 text-danger">
          <AlertTriangle className="h-5 w-5 shrink-0" />
          <span className="text-sm font-medium">{message}</span>
        </div>
      </CardContent>
    </Card>
  );
}

export function StatCard({ label, value, color = 'default' }: { label: string; value: string | number; color?: 'default' | 'primary' | 'success' | 'warning' | 'danger' }) {
  const colorClasses: Record<string, string> = {
    default: 'text-foreground',
    primary: 'text-accent',
    success: 'text-success',
    warning: 'text-warning',
    danger: 'text-danger',
  };
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted">{label}</p>
        <p className={`mt-1 text-3xl font-bold tabular-nums ${colorClasses[color]}`}>{value}</p>
      </CardContent>
    </Card>
  );
}

export function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-separator py-2 last:border-0">
      <span className="text-sm text-muted">{label}</span>
      <span className="text-sm font-medium text-foreground">{children}</span>
    </div>
  );
}

export function statusToColor(status: string): 'default' | 'primary' | 'secondary' | 'success' | 'warning' | 'danger' {
  const s = status.toLowerCase();
  if (['running', 'healthy', 'ready', 'online', 'active'].includes(s)) return 'success';
  if (['starting', 'restarting', 'created', 'limited', 'degraded'].includes(s)) return 'warning';
  if (['error', 'unhealthy', 'offline', 'disabled', 'oom', 'dead'].includes(s)) return 'danger';
  if (['paused', 'restricted'].includes(s)) return 'warning';
  return 'default';
}
