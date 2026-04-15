import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Settings } from '../../shared/types';
import { DEFAULT_SETTINGS } from '../../shared/types';

const mockRefreshCloudSession = vi.fn();
const mockResolveCloudAccessToken = vi.fn((settings: Settings) => (
  settings.cloudAuthAccessToken || settings.cloudAuthToken || ''
));
const mockIsCloudAccessTokenExpiringSoon = vi.fn(() => false);
const mockNormalizeCloudAuthExpiresAt = vi.fn((expiresAt?: number) => expiresAt ?? 0);

vi.mock('./cloudAuthService', () => ({
  CLOUD_ACCESS_TOKEN_REFRESH_BUFFER_MS: 60_000,
  isCloudAccessTokenExpiringSoon: (...args: unknown[]) => mockIsCloudAccessTokenExpiringSoon(...args),
  normalizeCloudAuthExpiresAt: (...args: unknown[]) => mockNormalizeCloudAuthExpiresAt(...args),
  refreshCloudSession: (...args: unknown[]) => mockRefreshCloudSession(...args),
  resolveCloudAccessToken: (...args: unknown[]) => mockResolveCloudAccessToken(...args),
}));

function makeSettings(overrides: Partial<Settings> = {}): Settings {
  return {
    ...DEFAULT_SETTINGS,
    ...overrides,
  };
}

describe('cloudSessionManager', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mockRefreshCloudSession.mockReset();
    mockResolveCloudAccessToken.mockImplementation((settings: Settings) => (
      settings.cloudAuthAccessToken || settings.cloudAuthToken || ''
    ));
    mockIsCloudAccessTokenExpiringSoon.mockReturnValue(false);
    mockNormalizeCloudAuthExpiresAt.mockImplementation((expiresAt?: number) => expiresAt ?? 0);
  });

  it('waits for re-login completion when no cloud token is available', async () => {
    const {
      registerCloudSessionController,
      ensureCloudAccessToken,
      syncCloudSessionState,
    } = await import('./cloudSessionManager');

    let currentSettings = makeSettings({
      cloudAuthStatus: 'signed-out',
      cloudAuthAccessToken: '',
      cloudAuthRefreshToken: '',
    });
    const updateSettings = vi.fn((partial: Partial<Settings>) => {
      currentSettings = { ...currentSettings, ...partial };
    });
    const openCloudReLoginModal = vi.fn();

    const cleanup = registerCloudSessionController({
      getSettings: () => currentSettings,
      updateSettings,
      openCloudReLoginModal,
    });

    const pendingToken = ensureCloudAccessToken();

    expect(openCloudReLoginModal).toHaveBeenCalledOnce();
    const sentinel = Symbol('pending');
    expect(await Promise.race([pendingToken, Promise.resolve(sentinel)])).toBe(sentinel);

    currentSettings = makeSettings({
      cloudAuthStatus: 'signed-in',
      cloudAuthAccessToken: 'fresh-access-token',
    });
    syncCloudSessionState(currentSettings);

    await expect(pendingToken).resolves.toBe('fresh-access-token');
    cleanup();
  });

  it('resolves pending recovery with null when re-login is cancelled', async () => {
    const {
      registerCloudSessionController,
      ensureCloudAccessToken,
      cancelCloudSessionRecovery,
    } = await import('./cloudSessionManager');

    const cleanup = registerCloudSessionController({
      getSettings: () => makeSettings({
        cloudAuthStatus: 'signed-out',
        cloudAuthAccessToken: '',
        cloudAuthRefreshToken: '',
      }),
      updateSettings: vi.fn(),
      openCloudReLoginModal: vi.fn(),
    });

    const pendingToken = ensureCloudAccessToken();
    cancelCloudSessionRecovery();

    await expect(pendingToken).resolves.toBeNull();
    cleanup();
  });

  it('waits for reauthentication after a refresh fails with a session error', async () => {
    const {
      registerCloudSessionController,
      ensureCloudAccessToken,
      syncCloudSessionState,
    } = await import('./cloudSessionManager');

    mockIsCloudAccessTokenExpiringSoon.mockReturnValue(true);
    mockRefreshCloudSession.mockRejectedValue(new Error('401 invalid session'));

    let currentSettings = makeSettings({
      cloudAuthStatus: 'signed-in',
      cloudAuthAccessToken: 'stale-access-token',
      cloudAuthRefreshToken: 'refresh-token',
    });
    const updateSettings = vi.fn((partial: Partial<Settings>) => {
      currentSettings = { ...currentSettings, ...partial };
    });
    const openCloudReLoginModal = vi.fn();

    const cleanup = registerCloudSessionController({
      getSettings: () => currentSettings,
      updateSettings,
      openCloudReLoginModal,
    });

    const pendingToken = ensureCloudAccessToken();

    await vi.waitFor(() => {
      expect(updateSettings).toHaveBeenCalledWith(expect.objectContaining({
        cloudAuthAccessToken: '',
        cloudAuthRefreshToken: '',
        cloudAuthStatus: 'signed-out',
      }));
      expect(openCloudReLoginModal).toHaveBeenCalledOnce();
    });

    const sentinel = Symbol('pending');
    expect(await Promise.race([pendingToken, Promise.resolve(sentinel)])).toBe(sentinel);

    currentSettings = makeSettings({
      cloudAuthStatus: 'signed-in',
      cloudAuthAccessToken: 'renewed-access-token',
      cloudAuthRefreshToken: 'renewed-refresh-token',
    });
    syncCloudSessionState(currentSettings);

    await expect(pendingToken).resolves.toBe('renewed-access-token');
    cleanup();
  });
});