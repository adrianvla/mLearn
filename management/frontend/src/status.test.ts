import { containerStatusToVariant, deploymentModeToVariant, healthStatusToVariant } from './status';

describe('containerStatusToVariant', () => {
  it.each([
    ['running', 'success'],
    ['created', 'info'],
    ['exited', 'neutral'],
    ['dead', 'neutral'],
    ['paused', 'warning'],
    ['restarting', 'info'],
    ['error', 'error'],
    ['oom', 'error'],
    ['unknown-status', 'neutral'],
  ] as const)('maps %s to %s', (status, variant) => {
    expect(containerStatusToVariant(status)).toBe(variant);
  });
});

describe('healthStatusToVariant', () => {
  it.each([
    ['healthy', 'success'],
    ['unhealthy', 'error'],
    ['starting', 'warning'],
    ['none', 'neutral'],
    ['', 'neutral'],
    ['unknown-health', 'neutral'],
  ] as const)('maps %s to %s', (health, variant) => {
    expect(healthStatusToVariant(health)).toBe(variant);
  });
});

describe('deploymentModeToVariant', () => {
  it.each([
    ['local-only', 'success'],
    ['self-hosted', 'info'],
    ['cloud-connected', 'warning'],
    ['unknown-mode', 'neutral'],
  ] as const)('maps %s to %s', (mode, variant) => {
    expect(deploymentModeToVariant(mode)).toBe(variant);
  });
});
