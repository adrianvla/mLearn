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
const mockResetManagementGroupReadiness = vi.fn();

vi.mock('./cloudAuthService', () => ({
  CLOUD_ACCESS_TOKEN_REFRESH_BUFFER_MS: 60_000,
  isCloudAccessTokenExpiringSoon: (settings: Settings, bufferMs?: number) => mockIsCloudAccessTokenExpiringSoon(settings, bufferMs),
  normalizeCloudAuthExpiresAt: (expiresAt?: number, accessToken?: string) => mockNormalizeCloudAuthExpiresAt(expiresAt, accessToken),
  refreshCloudSession: (settings: Settings) => mockRefreshCloudSession(settings),
  resolveCloudAccessToken: (settings: Settings) => mockResolveCloudAccessToken(settings),
}));

vi.mock('./managementGroupService', () => ({
  ensureActiveGroup: (...args: unknown[]) => mockEnsureActiveGroup(...args),
  resetManagementGroupReadiness: () => mockResetManagementGroupReadiness(),
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
    mockResetManagementGroupReadiness.mockReset();
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

  it('clears group readiness when the cloud session is signed out', async () => {
    const { syncCloudSessionState } = await import('./cloudSessionManager');

    syncCloudSessionState(makeSettings({ cloudAuthStatus: 'signed-out' }));

    expect(mockResetManagementGroupReadiness).toHaveBeenCalledOnce();
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

  it('gates the first custom-management login waiter before returning its recovered token', async () => {
    const {
      CloudGroupSelectionRequiredError,
      ensureCloudAccessToken,
      registerCloudSessionController,
      syncCloudSessionState,
    } = await import('./cloudSessionManager');
    let currentSettings = makeSettings({
      overrideCloudEndpointUrl: true,
      cloudApiUrl: 'https://school.example',
      cloudAuthStatus: 'signed-out',
      cloudAuthAccessToken: '',
      cloudAuthRefreshToken: '',
    });
    const cleanup = registerCloudSessionController({
      getSettings: () => currentSettings,
      updateSettings: (partial) => { currentSettings = { ...currentSettings, ...partial }; },
      openCloudReLoginModal: vi.fn(),
    });
    mockEnsureActiveGroup.mockResolvedValueOnce({
      ready: false,
      needsSelection: true,
      id: '',
      name: '',
      groups: [{ id: 'german-a', name: 'German A' }, { id: 'german-b', name: 'German B' }],
    });

    const pending = ensureCloudAccessToken();
    currentSettings = makeSettings({
      overrideCloudEndpointUrl: true,
      cloudApiUrl: 'https://school.example',
      cloudAuthStatus: 'signed-in',
      cloudAuthAccessToken: 'recovered-token',
      cloudAuthRefreshToken: 'recovered-refresh',
    });
    syncCloudSessionState(currentSettings);

    await expect(pending).rejects.toBeInstanceOf(CloudGroupSelectionRequiredError);
    expect(mockEnsureActiveGroup).toHaveBeenCalledWith(
      expect.objectContaining({ cloudAuthAccessToken: 'recovered-token' }),
      expect.any(Function),
      'recovered-token',
    );
    cleanup();
  });

  it('gates the first refresh-failure reauthentication token before returning it', async () => {
    const {
      CloudGroupSelectionRequiredError,
      ensureCloudAccessToken,
      registerCloudSessionController,
      syncCloudSessionState,
    } = await import('./cloudSessionManager');
    mockIsCloudAccessTokenExpiringSoon.mockReturnValue(true);
    mockRefreshCloudSession.mockRejectedValueOnce(new Error('401 invalid session'));
    let currentSettings = makeSettings({
      overrideCloudEndpointUrl: true,
      cloudApiUrl: 'https://school.example',
      cloudAuthStatus: 'signed-in',
      cloudAuthAccessToken: 'expired-token',
      cloudAuthRefreshToken: 'expired-refresh',
    });
    const openCloudReLoginModal = vi.fn();
    const cleanup = registerCloudSessionController({
      getSettings: () => currentSettings,
      updateSettings: (partial) => { currentSettings = { ...currentSettings, ...partial }; },
      openCloudReLoginModal,
    });
    mockEnsureActiveGroup.mockResolvedValueOnce({
      ready: false,
      needsSelection: true,
      id: '',
      name: '',
      groups: [{ id: 'german-a', name: 'German A' }, { id: 'german-b', name: 'German B' }],
    });

    const pending = ensureCloudAccessToken();
    await vi.waitFor(() => expect(openCloudReLoginModal).toHaveBeenCalledOnce());
    currentSettings = makeSettings({
      overrideCloudEndpointUrl: true,
      cloudApiUrl: 'https://school.example',
      cloudAuthStatus: 'signed-in',
      cloudAuthAccessToken: 'reauthenticated-token',
      cloudAuthRefreshToken: 'reauthenticated-refresh',
    });
    syncCloudSessionState(currentSettings);

    await expect(pending).rejects.toBeInstanceOf(CloudGroupSelectionRequiredError);
    expect(mockEnsureActiveGroup).toHaveBeenCalledWith(
      expect.objectContaining({ cloudAuthAccessToken: 'reauthenticated-token' }),
      expect.any(Function),
      'reauthenticated-token',
    );
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

  it('notifies isolated listeners only after a successful refresh', async () => {
    const { registerCloudSessionController, ensureCloudAccessToken, subscribeCloudSessionRefresh } = await import('./cloudSessionManager');
    mockIsCloudAccessTokenExpiringSoon.mockReturnValue(true);
    mockRefreshCloudSession.mockResolvedValue({ accessToken: 'fresh', refreshToken: 'next', expiresAt: 2_000_000_000 });
    let current = makeSettings({ cloudAuthStatus: 'signed-in', cloudAuthAccessToken: 'old', cloudAuthRefreshToken: 'refresh' });
    const cleanup = registerCloudSessionController({
      getSettings: () => current,
      updateSettings: patch => { current = { ...current, ...patch }; },
      openCloudReLoginModal: vi.fn(),
    });
    const observed = vi.fn();
    const unsubscribeThrowing = subscribeCloudSessionRefresh(() => { throw new Error('observer failure'); });
    const unsubscribe = subscribeCloudSessionRefresh(observed);

    await expect(ensureCloudAccessToken()).resolves.toBe('fresh');
    expect(observed).toHaveBeenCalledOnce();
    unsubscribe(); unsubscribeThrowing(); cleanup();
  });

  it('does not resurrect a logged-out session when its refresh completes', async () => {
    const manager = await import('./cloudSessionManager');
    let finish!: (value: { accessToken: string; refreshToken: string }) => void;
    mockRefreshCloudSession.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    let current = makeSettings({ cloudAuthStatus: 'signed-in', cloudAuthUserId: 'first', cloudAuthAccessToken: 'old', cloudAuthRefreshToken: 'refresh' });
    const cleanup = manager.registerCloudSessionController({
      getSettings: () => current,
      updateSettings: patch => { current = { ...current, ...patch }; },
      openCloudReLoginModal: vi.fn(),
    });
    const pending = manager.ensureCloudAccessToken({ forceRefresh: true, interactive: false });
    current = makeSettings({ cloudAuthStatus: 'signed-out' });
    manager.syncCloudSessionState(current);
    finish({ accessToken: 'stale-refreshed', refreshToken: 'stale-refresh' });
    await expect(pending).resolves.toBeNull();
    expect(current.cloudAuthStatus).toBe('signed-out');
    expect(current.cloudAuthAccessToken).not.toBe('stale-refreshed');
    cleanup();
  });

  it('does not clear a new account after the previous refresh fails', async () => {
    const manager = await import('./cloudSessionManager');
    let fail!: (error: Error) => void;
    mockRefreshCloudSession.mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject; }));
    let current = makeSettings({ cloudAuthStatus: 'signed-in', cloudAuthUserId: 'first', cloudAuthAccessToken: 'old', cloudAuthRefreshToken: 'refresh' });
    const cleanup = manager.registerCloudSessionController({
      getSettings: () => current,
      updateSettings: patch => { current = { ...current, ...patch }; },
      openCloudReLoginModal: vi.fn(),
    });
    const pending = manager.ensureCloudAccessToken({ forceRefresh: true, interactive: false });
    current = makeSettings({ cloudAuthStatus: 'signed-in', cloudAuthUserId: 'second', cloudAuthAccessToken: 'new', cloudAuthRefreshToken: 'new-refresh' });
    manager.syncCloudSessionState(current);
    fail(new Error('401 invalid refresh token'));
    await expect(pending).resolves.toBeNull();
    expect(current).toMatchObject({ cloudAuthStatus: 'signed-in', cloudAuthUserId: 'second', cloudAuthAccessToken: 'new' });
    cleanup();
  });

  it('starts a separate refresh for the new origin instead of returning the old origin token', async () => {
    const manager = await import('./cloudSessionManager');
    let finishOld!: (value: { accessToken: string; refreshToken: string }) => void;
    mockRefreshCloudSession
      .mockImplementationOnce(() => new Promise((resolve) => { finishOld = resolve; }))
      .mockResolvedValueOnce({ accessToken: 'new-origin-token', refreshToken: 'new-origin-refresh' });
    let current = makeSettings({ overrideCloudEndpointUrl: true, cloudApiUrl: 'https://first.example', cloudAuthStatus: 'signed-in', cloudAuthAccessToken: 'old', cloudAuthRefreshToken: 'refresh' });
    const cleanup = manager.registerCloudSessionController({
      getSettings: () => current,
      updateSettings: patch => { current = { ...current, ...patch }; },
      openCloudReLoginModal: vi.fn(),
    });
    const first = manager.ensureCloudAccessToken({ forceRefresh: true, interactive: false });
    current = { ...current, cloudApiUrl: 'https://second.example' };
    manager.syncCloudSessionState(current);
    const second = manager.ensureCloudAccessToken({ forceRefresh: true, interactive: false });
    finishOld({ accessToken: 'old-origin-token', refreshToken: 'old-origin-refresh' });
    await expect(first).resolves.toBeNull();
    await expect(second).resolves.toBe('new-origin-token');
    expect(current.cloudAuthAccessToken).toBe('new-origin-token');
    cleanup();
  });

  it('shares refresh only while the same session remains current', async () => {
    const manager = await import('./cloudSessionManager');
    let finish!: (value: { accessToken: string; refreshToken: string }) => void;
    mockRefreshCloudSession.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    let current = makeSettings({ cloudAuthStatus: 'signed-in', cloudAuthAccessToken: 'old', cloudAuthRefreshToken: 'refresh' });
    const cleanup = manager.registerCloudSessionController({
      getSettings: () => current,
      updateSettings: patch => {
        current = { ...current, ...patch };
        manager.syncCloudSessionState(current);
      },
      openCloudReLoginModal: vi.fn(),
    });
    const first = manager.ensureCloudAccessToken({ forceRefresh: true, interactive: false });
    manager.syncCloudSessionState(current);
    const second = manager.ensureCloudAccessToken({ forceRefresh: true, interactive: false });
    finish({ accessToken: 'fresh', refreshToken: 'fresh-refresh' });
    await expect(Promise.all([first, second])).resolves.toEqual(['fresh', 'fresh']);
    expect(mockRefreshCloudSession).toHaveBeenCalledOnce();
    cleanup();
  });

  it('does not return a refreshed token after logout during group readiness', async () => {
    const manager = await import('./cloudSessionManager');
    let groupStarted!: () => void;
    const started = new Promise<void>((resolve) => { groupStarted = resolve; });
    let finishGroup!: (value: { ready: boolean }) => void;
    mockEnsureActiveGroup.mockImplementationOnce(() => {
      groupStarted();
      return new Promise((resolve) => { finishGroup = resolve; });
    });
    mockRefreshCloudSession.mockResolvedValueOnce({ accessToken: 'fresh', refreshToken: 'fresh-refresh' });
    let current = makeSettings({ overrideCloudEndpointUrl: true, cloudApiUrl: 'https://school.example', cloudAuthStatus: 'signed-in', cloudAuthAccessToken: 'old', cloudAuthRefreshToken: 'refresh' });
    const cleanup = manager.registerCloudSessionController({
      getSettings: () => current,
      updateSettings: patch => { current = { ...current, ...patch }; },
      openCloudReLoginModal: vi.fn(),
    });
    const pending = manager.ensureCloudAccessToken({ forceRefresh: true, interactive: false });
    await started;
    current = makeSettings({ cloudAuthStatus: 'signed-out' });
    manager.syncCloudSessionState(current);
    finishGroup({ ready: true });
    await expect(pending).resolves.toBeNull();
    cleanup();
  });
});
