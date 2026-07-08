export type BadgeVariant = 'success' | 'warning' | 'error' | 'info' | 'neutral';

export function containerStatusToVariant(status: string): BadgeVariant {
  switch (status.toLowerCase()) {
    case 'running':
      return 'success';
    case 'created':
    case 'restarting':
      return 'info';
    case 'paused':
      return 'warning';
    case 'error':
    case 'oom':
      return 'error';
    case 'exited':
    case 'dead':
    default:
      return 'neutral';
  }
}

export function healthStatusToVariant(health: string): BadgeVariant {
  switch (health.toLowerCase()) {
    case 'healthy':
      return 'success';
    case 'unhealthy':
      return 'error';
    case 'starting':
      return 'warning';
    case 'none':
    case '':
    default:
      return 'neutral';
  }
}

export function deploymentModeToVariant(mode: string): BadgeVariant {
  switch (mode.toLowerCase()) {
    case 'local-only':
      return 'success';
    case 'self-hosted':
      return 'info';
    case 'cloud-connected':
      return 'warning';
    default:
      return 'neutral';
  }
}
