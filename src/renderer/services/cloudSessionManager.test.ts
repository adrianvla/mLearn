import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Settings } from '../../shared/types';
import { DEFAULT_SETTINGS } from '../../shared/types';

const mockRefreshCloudSession = vi.fn<(settings: Settings) => Promise<{ accessToken: string; refreshToken: string; expiresAt?: number }>>();
const mockResolveCloudAccessToken = vi.fn<(settings: Settings) => string>((settings: Settings) => (
  settings.cloudAuthAccessToken || settings.cloudAuthToken || ''
));
const mockIsCloudAccessTokenExpiringSoon = vi.fn<(settings: Settings, bufferMs?: number) => boolean>(() => false);
const mockNormalizeCloudAuthExpiresAt = vi.fn<(expiresAt?: number, accessToken?: string) => number>((expiresAt?: number) => expiresAt ?? 0);
const mockEnsureActiveGroup = vi.fn();

vi.mock('./cloudAuthService', () => ({
  CLOUD_ACCESS_TOKEN_REFRESH_BUFFER_MS: 60_000,
  isCloudAccessTokenExpiringSoon: (settings: Settings, bufferMs?: number) => mockIsCloudAccessTokenExpiringSoon(settings, bufferMs),
  normalizeCloudAuthExpiresAt: (expiresAt?: number, accessToken?: string) => mockNormalizeCloudAuthExpiresAt(expiresAt, accessToken),
  refreshCloudSession: (settings: Settings) => mockRefreshCloudSession(settings),
  resolveCloudAccessToken: (settings: Settings) => mockResolveCloudAccessToken(settings),
}));

vi.mock('./managementGroupService', () => ({
  ensureActiveGroup: (...args: unknown[]) => mockEnsureActiveGroup(...args),
  requiresManagementGroup: (settings: Settings) => (
    settings.overrideCloudEndpointUrl && settings.cloudApiUrl.trim().length > 0
  ),
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
    mockEnsureActiveGroup.mockResolvedValue({
      ready: true,
      needsSelection: false,
      id: 'german-a',
      name: 'German A',
      groups: [{ id: 'german-a', name: 'German A' }],
    });
  });

  it('does not run a custom group-scoped operation until the active group is activated', async () => {
    const { registerCloudSessionController, withCloudAuth } = await import('./cloudSessionManager');
    const currentSettings = makeSettings({
      overrideCloudEndpointUrl: true,
      cloudApiUrl: 'https://school.example',
      cloudAuthStatus: 'signed-in',
      cloudAuthAccessToken: 'access-token',
      cloudAuthActiveGroupId: '',
      cloudAuthActiveGroupName: '',
    });
    const updateSettings = vi.fn();
    const cleanup = registerCloudSessionController({
      getSettings: () => currentSettings,
      updateSettings,
      openCloudReLoginModal: vi.fn(),
    });
    let resolveActivation!: (value: unknown) => void;
    mockEnsureActiveGroup.mockReturnValueOnce(new Promise((resolve) => {
      resolveActivation = resolve;
    }));
    const operation = vi.fn(async () => 'done');

    const pending = withCloudAuth(operation);
    await vi.waitFor(() => expect(mockEnsureActiveGroup).toHaveBeenCalled());
    expect(operation).not.toHaveBeenCalled();
    resolveActivation({ ready: true, needsSelection: false, id: 'german-a', name: 'German A', groups: [] });

    await expect(pending).resolves.toBe('done');
    expect(operation).toHaveBeenCalledWith('access-token');
    cleanup();
  });

  it('exposes needsSelection and blocks custom group-scoped operations when multiple groups exist', async () => {
    const {
      CloudGroupSelectionRequiredError,
      registerCloudSessionController,
      withCloudAuth,
    } = await import('./cloudSessionManager');
    const currentSettings = makeSettings({
      overrideCloudEndpointUrl: true,
      cloudApiUrl: 'https://school.example',
      cloudAuthStatus: 'signed-in',
      cloudAuthAccessToken: 'access-token',
    });
    const cleanup = registerCloudSessionController({
      getSettings: () => currentSettings,
      updateSettings: vi.fn(),
      openCloudReLoginModal: vi.fn(),
    });
    mockEnsureActiveGroup.mockResolvedValueOnce({
      ready: false,
      needsSelection: true,
      id: '',
      name: '',
      groups: [{ id: 'german-a', name: 'German A' }, { id: 'german-b', name: 'German B' }],
    });
    const operation = vi.fn();

    const error = await withCloudAuth(operation).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(CloudGroupSelectionRequiredError);
    expect(error).toMatchObject({ needsSelection: true });
    expect(operation).not.toHaveBeenCalled();
    cleanup();
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

  it('shares a single recovery promise across concurrent withCloudAuth waiters', async () => {
    const {
      registerCloudSessionController,
      syncCloudSessionState,
      withCloudAuth,
    } = await import('./cloudSessionManager');

    let currentSettings = makeSettings({
      cloudAuthStatus: 'signed-out',
      cloudAuthAccessToken: '',
      cloudAuthRefreshToken: '',
    });
    const openCloudReLoginModal = vi.fn();

    const cleanup = registerCloudSessionController({
      getSettings: () => currentSettings,
      updateSettings: vi.fn(),
      openCloudReLoginModal,
    });

    const op = vi.fn(async (token: string) => `ok:${token}`);
    const pending = [withCloudAuth(op), withCloudAuth(op), withCloudAuth(op)];

    expect(openCloudReLoginModal).toHaveBeenCalledOnce();
    expect(op).not.toHaveBeenCalled();

    currentSettings = makeSettings({
      cloudAuthStatus: 'signed-in',
      cloudAuthAccessToken: 'recovered-token',
      cloudAuthRefreshToken: 'refresh-token',
    });
    syncCloudSessionState(currentSettings);

    await expect(Promise.all(pending)).resolves.toEqual([
      'ok:recovered-token',
      'ok:recovered-token',
      'ok:recovered-token',
    ]);
    expect(op).toHaveBeenCalledTimes(3);
    cleanup();
  });

  it('throws CloudSessionCancelledError when recovery is cancelled via withCloudAuth', async () => {
    const {
      registerCloudSessionController,
      cancelCloudSessionRecovery,
      withCloudAuth,
      CloudSessionCancelledError,
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

    const pending = withCloudAuth(async (token) => token);
    cancelCloudSessionRecovery();

    await expect(pending).rejects.toBeInstanceOf(CloudSessionCancelledError);
    cleanup();
  });

  it('retries once after a 401 before any output is emitted', async () => {
    const {
      registerCloudSessionController,
      withCloudAuth,
    } = await import('./cloudSessionManager');

    mockRefreshCloudSession.mockResolvedValueOnce({
      accessToken: 'renewed-token',
      refreshToken: 'refresh-token',
      expiresAt: 1_735_689_600_000,
    });

    let currentSettings = makeSettings({
      cloudAuthStatus: 'signed-in',
      cloudAuthAccessToken: 'initial-token',
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

    const op = vi.fn()
      .mockRejectedValueOnce(new Error('401 invalid session'))
      .mockResolvedValueOnce('success');

    const pending = withCloudAuth(op, {
      alreadyEmittedOutput: () => false,
    });

    await expect(pending).resolves.toBe('success');
    expect(mockRefreshCloudSession).toHaveBeenCalledOnce();
    expect(openCloudReLoginModal).not.toHaveBeenCalled();
    expect(updateSettings).toHaveBeenCalledWith(expect.objectContaining({
      cloudAuthAccessToken: 'renewed-token',
      cloudAuthRefreshToken: 'refresh-token',
      cloudAuthStatus: 'signed-in',
    }));
    expect(op).toHaveBeenCalledTimes(2);
    expect(op).toHaveBeenNthCalledWith(1, 'initial-token');
    expect(op).toHaveBeenNthCalledWith(2, 'renewed-token');
    cleanup();
  });

  it('does not open recovery for transport failures and throws CloudUnreachableError', async () => {
    const {
      registerCloudSessionController,
      withCloudAuth,
      CloudUnreachableError,
    } = await import('./cloudSessionManager');

    const openCloudReLoginModal = vi.fn();
    const cleanup = registerCloudSessionController({
      getSettings: () => makeSettings({
        cloudAuthStatus: 'signed-in',
        cloudAuthAccessToken: 'token',
        cloudAuthRefreshToken: 'refresh-token',
      }),
      updateSettings: vi.fn(),
      openCloudReLoginModal,
    });

    const pending = withCloudAuth(async () => {
      throw new TypeError('Failed to fetch');
    });

    await expect(pending).rejects.toBeInstanceOf(CloudUnreachableError);
    expect(openCloudReLoginModal).not.toHaveBeenCalled();
    cleanup();
  });

  it('rethrows 401 errors when output has already been emitted', async () => {
    const {
      registerCloudSessionController,
      withCloudAuth,
    } = await import('./cloudSessionManager');

    const openCloudReLoginModal = vi.fn();
    const cleanup = registerCloudSessionController({
      getSettings: () => makeSettings({
        cloudAuthStatus: 'signed-in',
        cloudAuthAccessToken: 'token',
        cloudAuthRefreshToken: 'refresh-token',
      }),
      updateSettings: vi.fn(),
      openCloudReLoginModal,
    });

    const authError = new Error('401 invalid session');
    const pending = withCloudAuth(
      async () => {
        throw authError;
      },
      { alreadyEmittedOutput: () => true },
    );

    await expect(pending).rejects.toBe(authError);
    expect(openCloudReLoginModal).not.toHaveBeenCalled();
    cleanup();
  });

  it('clears auth state and opens re-login for streamed Cloud LLM invalid-session strings', async () => {
    const {
      registerCloudSessionController,
      handleCloudSessionError,
    } = await import('./cloudSessionManager');

    let currentSettings = makeSettings({
      cloudAuthStatus: 'signed-in',
      cloudAuthAccessToken: 'stale-token',
      cloudAuthRefreshToken: 'stale-refresh',
      cloudAuthUserEmail: 'test@kikan.net',
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

    expect(handleCloudSessionError('Cloud LLM error: 401 Reason: Invalid session', true)).toBe(true);
    expect(updateSettings).toHaveBeenCalledWith(expect.objectContaining({
      cloudAuthAccessToken: '',
      cloudAuthRefreshToken: '',
      cloudAuthUserEmail: '',
      cloudAuthStatus: 'signed-out',
    }));
    expect(openCloudReLoginModal).toHaveBeenCalledOnce();
    cleanup();
  });

  it('throws CloudUnreachableError when refresh fails for transport reasons and no fallback token exists', async () => {
    const {
      registerCloudSessionController,
      ensureCloudAccessToken,
      CloudUnreachableError,
    } = await import('./cloudSessionManager');

    mockIsCloudAccessTokenExpiringSoon.mockReturnValue(true);
    mockRefreshCloudSession.mockRejectedValue(new Error('network timeout'));

    const cleanup = registerCloudSessionController({
      getSettings: () => makeSettings({
        cloudAuthStatus: 'signed-in',
        cloudAuthAccessToken: '',
        cloudAuthRefreshToken: 'refresh-token',
      }),
      updateSettings: vi.fn(),
      openCloudReLoginModal: vi.fn(),
    });

    await expect(ensureCloudAccessToken()).rejects.toBeInstanceOf(CloudUnreachableError);
    cleanup();
  });

  it('queues recovery before controller registers and opens modal on registration', async () => {
    const {
      registerCloudSessionController,
      ensureCloudAccessToken,
      syncCloudSessionState,
    } = await import('./cloudSessionManager');

    const pendingToken = ensureCloudAccessToken();

    const sentinel = Symbol('pending');
    expect(await Promise.race([pendingToken, Promise.resolve(sentinel)])).toBe(sentinel);

    let currentSettings = makeSettings({
      cloudAuthStatus: 'signed-out',
      cloudAuthAccessToken: '',
      cloudAuthRefreshToken: '',
    });
    const openCloudReLoginModal = vi.fn();

    const cleanup = registerCloudSessionController({
      getSettings: () => currentSettings,
      updateSettings: vi.fn(),
      openCloudReLoginModal,
    });

    expect(openCloudReLoginModal).toHaveBeenCalledOnce();

    currentSettings = makeSettings({
      cloudAuthStatus: 'signed-in',
      cloudAuthAccessToken: 'fresh-access-token',
    });
    syncCloudSessionState(currentSettings);

    await expect(pendingToken).resolves.toBe('fresh-access-token');
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

  it('opens re-login modal when refresh fails with session error even if cloudAuthStatus is not signed-in', async () => {
    const {
      registerCloudSessionController,
      ensureCloudAccessToken,
      syncCloudSessionState,
    } = await import('./cloudSessionManager');

    mockIsCloudAccessTokenExpiringSoon.mockReturnValue(true);
    mockRefreshCloudSession.mockRejectedValue(new Error('401 invalid session'));

    let currentSettings = makeSettings({
      cloudAuthStatus: 'signed-out',
      cloudAuthAccessToken: '',
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

  it('restores previous controller when a newer one unregisters', async () => {
    const {
      registerCloudSessionController,
      ensureCloudAccessToken,
      syncCloudSessionState,
    } = await import('./cloudSessionManager');

    let mainWindowSettings = makeSettings({
      cloudAuthStatus: 'signed-out',
      cloudAuthAccessToken: '',
      cloudAuthRefreshToken: '',
    });
    const mainOpenModal = vi.fn();
    const mainCleanup = registerCloudSessionController({
      getSettings: () => mainWindowSettings,
      updateSettings: vi.fn(),
      openCloudReLoginModal: mainOpenModal,
    });

    let settingsWindowSettings = makeSettings({
      cloudAuthStatus: 'signed-out',
      cloudAuthAccessToken: '',
      cloudAuthRefreshToken: '',
    });
    const settingsOpenModal = vi.fn();
    const settingsCleanup = registerCloudSessionController({
      getSettings: () => settingsWindowSettings,
      updateSettings: vi.fn(),
      openCloudReLoginModal: settingsOpenModal,
    });

    settingsCleanup();

    const pendingToken = ensureCloudAccessToken();

    expect(mainOpenModal).toHaveBeenCalledOnce();
    expect(settingsOpenModal).not.toHaveBeenCalled();

    const sentinel = Symbol('pending');
    expect(await Promise.race([pendingToken, Promise.resolve(sentinel)])).toBe(sentinel);

    mainWindowSettings = makeSettings({
      cloudAuthStatus: 'signed-in',
      cloudAuthAccessToken: 'fresh-token',
    });
    syncCloudSessionState(mainWindowSettings);

    await expect(pendingToken).resolves.toBe('fresh-token');
    mainCleanup();
  });
});
