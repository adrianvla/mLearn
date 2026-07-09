import { Card, Spinner } from '@heroui/react';
import { AlertTriangle, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

export type StatusColor = 'default' | 'accent' | 'success' | 'warning' | 'danger';

export function PageContainer({ children }: { children: ReactNode }) {
  return <div className="w-full space-y-6 p-6 lg:p-8">{children}</div>;
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">{title}</h1>
        {subtitle && <p className="mt-1.5 max-w-2xl text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 gap-2">{actions}</div>}
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
    <Card>
      <Card.Content>
        <div className="flex items-center gap-3 text-danger">
          <AlertTriangle className="h-5 w-5 shrink-0" />
          <span className="text-sm font-medium">{message}</span>
        </div>
      </Card.Content>
    </Card>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex min-h-48 flex-col items-center justify-center gap-3 py-12 text-center">
      <Icon className="h-8 w-8 text-muted" />
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        {description && <p className="text-xs text-muted">{description}</p>}
      </div>
      {action}
    </div>
  );
}

const STAT_COLOR_CLASS: Record<StatusColor, string> = {
  default: 'text-foreground',
  accent: 'text-accent',
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
};

export function StatCard({
  label,
  value,
  color = 'default',
  helper,
}: {
  label: string;
  value: string | number;
  color?: StatusColor;
  helper?: ReactNode;
}) {
  return (
    <Card>
      <Card.Content className="min-h-32">
        <p className="text-sm font-medium text-muted">{label}</p>
        <p className={`mt-3 text-4xl font-semibold tabular-nums ${STAT_COLOR_CLASS[color]}`}>{value}</p>
        {helper && <div className="mt-3 text-xs text-muted">{helper}</div>}
      </Card.Content>
    </Card>
  );
}

export function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-separator py-2.5 last:border-0">
      <span className="text-sm text-muted">{label}</span>
      <span className="text-sm font-medium text-foreground">{children}</span>
    </div>
  );
}

const HEALTHY = new Set(['running', 'healthy', 'ready', 'online', 'active', 'available', 'enabled', 'ok', 'synced', 'up']);
const TRANSIENT = new Set(['starting', 'restarting', 'created', 'limited', 'degraded', 'pending', 'paused', 'restricted', 'waiting', 'syncing', 'queued']);
const FAILED = new Set(['error', 'unhealthy', 'offline', 'disabled', 'oom', 'dead', 'failed', 'unavailable', 'exited', 'down']);

export function statusToColor(status: string): StatusColor {
  const s = status.toLowerCase();
  if (HEALTHY.has(s)) return 'success';
  if (TRANSIENT.has(s)) return 'warning';
  if (FAILED.has(s)) return 'danger';
  return 'default';
}

export function deploymentModeColor(mode: string): StatusColor {
  switch (mode.toLowerCase()) {
    case 'local-only': return 'success';
    case 'self-hosted': return 'accent';
    case 'cloud-connected': return 'warning';
    default: return 'default';
  }
}

export function llmKindColor(kind: string): StatusColor {
  switch (kind.toLowerCase()) {
    case 'local': return 'accent';
    case 'cloud': return 'warning';
    default: return 'default';
  }
}

export function userRoleColor(role: string): StatusColor {
  switch (role.toLowerCase()) {
    case 'admin': return 'danger';
    case 'teacher': return 'warning';
    case 'learner': return 'accent';
    default: return 'default';
  }
}

export function severityColor(severity: string): StatusColor {
  switch (severity.toLowerCase()) {
    case 'error': return 'danger';
    case 'warning': return 'warning';
    default: return 'default';
  }
}
