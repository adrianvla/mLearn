import { describe, expect, it } from 'vitest';
import { shouldMountMainRoutes } from './mainRouteReadiness';

describe('main route readiness', () => {
  it('keeps backend-dependent routes unmounted until startup providers are ready', () => {
    expect(shouldMountMainRoutes({
      serverConnected: false,
      settingsLoading: false,
      languageLoading: false,
    })).toBe(false);
    expect(shouldMountMainRoutes({
      serverConnected: true,
      settingsLoading: true,
      languageLoading: false,
    })).toBe(false);
    expect(shouldMountMainRoutes({
      serverConnected: true,
      settingsLoading: false,
      languageLoading: true,
    })).toBe(false);
  });

  it('mounts routes only after the backend, settings, and language data are ready', () => {
    expect(shouldMountMainRoutes({
      serverConnected: true,
      settingsLoading: false,
      languageLoading: false,
    })).toBe(true);
  });
});
