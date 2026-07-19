import { vi, describe, it, expect, beforeEach } from 'vitest';
import type { Settings } from '../../shared/types';
import { DEFAULT_SETTINGS } from '../../shared/types';
import type { EffectiveManagementPolicy } from '../../shared/managementPolicy';
import policyFixture from '../../../test/fixtures/management-policy-v1.json';

let settingsCb: (s: Settings) => void;
let settingsSavedCb: (() => void) | undefined;
const settingsCleanup = vi.fn();
const settingsSavedCleanup = vi.fn();
const mockRestartBackend = vi.fn();
const mockForceRestartApp = vi.fn();

const mockBridge = {
  settings: {
    onSettings: vi.fn(),
    onSettingsSaved: vi.fn(),
    getSettings: vi.fn(),
    saveSettings: vi.fn(),
  },
  server: {
    restartBackend: vi.fn(() => mockRestartBackend()),
    forceRestartApp: vi.fn(() => mockForceRestartApp()),
  },
};

function setupMockImplementations() {
  mockBridge.settings.onSettings.mockImplementation((cb: (s: Settings) => void) => {
    settingsCb = cb;
    return settingsCleanup;
  });
  mockBridge.settings.onSettingsSaved.mockImplementation((cb: () => void) => {
    settingsSavedCb = cb;
    return settingsSavedCleanup;
  });
}

vi.mock('../../shared/bridges', () => ({
  getBridge: () => mockBridge,
}));

const mockGetBackend = vi.fn();
const mockResetBackend = vi.fn();
vi.mock('../../shared/backends', () => ({
  getBackend: (...args: unknown[]) => mockGetBackend(...args),
  resetBackend: () => mockResetBackend(),
  resolveCloudApiUrl: (settings: Settings) => settings.cloudApiUrl,
}));

vi.mock('../../shared/platform', () => ({
  isCapacitor: () => false,
}));

const mockResolveCloudAccessToken = vi.fn((settings: Settings) => (
  settings.cloudAuthAccessToken || settings.cloudAuthToken || ''
));
const mockRefreshCloudSession = vi.fn();
const mockNormalizeCloudAuthExpiresAt = vi.fn((expiresAt?: number) => expiresAt ?? 0);
const mockIsCloudAccessTokenExpiringSoon = vi.fn(() => false);
const mockLoadCachedEffectivePolicy = vi.fn();
const mockFetchEffectivePolicy = vi.fn();
const mockEnrollTrustedPublicKey = vi.fn();
const mockSaveCachedPolicyMonotonic = vi.fn();

vi.mock('../services/cloudAuthService', () => ({
  CLOUD_ACCESS_TOKEN_REFRESH_BUFFER_MS: 60_000,
  isCloudAccessTokenExpiringSoon: (...args: unknown[]) => mockIsCloudAccessTokenExpiringSoon(...args),
  normalizeCloudAuthExpiresAt: (...args: unknown[]) => mockNormalizeCloudAuthExpiresAt(...args),
  refreshCloudSession: (...args: unknown[]) => mockRefreshCloudSession(...args),
  resolveCloudAccessToken: (...args: unknown[]) => mockResolveCloudAccessToken(...args),
}));

vi.mock('../services/managementPolicyService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/managementPolicyService')>();
  return {
    ...actual,
    loadCachedEffectivePolicy: (...args: unknown[]) => mockLoadCachedEffectivePolicy(...args),
    fetchEffectivePolicy: (...args: unknown[]) => mockFetchEffectivePolicy(...args),
  };
});

vi.mock('../services/managementPolicyCache', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/managementPolicyCache')>();
  return {
    ...actual,
    enrollTrustedPublicKey: (...args: unknown[]) => mockEnrollTrustedPublicKey(...args),
    saveCachedPolicyMonotonic: (...args: unknown[]) => mockSaveCachedPolicyMonotonic(...args),
  };
});

type SettingsCtx = {
  settings: Settings;
  updateSetting: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  updateSettings: (partial: Partial<Settings>) => void;
  saveSettings: () => void;
  isLoading: () => boolean;
  isRuntimeRestartRequired: () => boolean;
  clearRuntimeRestartRequired: () => void;
  restartAppForRuntimeSettings: () => void;
  isCloudReLoginModalOpen: () => boolean;
  openCloudReLoginModal: () => void;
  closeCloudReLoginModal: () => void;
  showProsody: () => boolean;
  setProsodyVisible: (show: boolean) => void;
  managedPolicy: () => EffectiveManagementPolicy | null;
  isSettingManaged: (key: keyof Settings) => boolean;
  getManagedSettingSource: (key: keyof Settings) => { sourceGroupName: string } | null;
  hasFreshNetworkPolicy: () => boolean;
  policyAllowsFeature: (featureId: string) => boolean;
};

async function mountProvider() {
  const { createRoot, createComponent } = await import('solid-js');
  const { SettingsProvider, useSettings } = await import('./SettingsContext');
  let ctx!: SettingsCtx;
  let dispose!: () => void;
  createRoot((d) => {
    dispose = d;
    createComponent(SettingsProvider, {
      get children() {
        ctx = useSettings();
        return null;
      },
    });
  });
  return { ctx, dispose };
}

function makeSettings(overrides?: Partial<Settings>): Settings {
  return { ...DEFAULT_SETTINGS, ...overrides };
}

function freshPolicy(activeGroupId: string = 'german-a'): EffectiveManagementPolicy {
  const now = Date.now();
  return {
    ...policyFixture,
    activeGroupId,
    issuedAt: new Date(now - 1_000).toISOString(),
    expiresAt: new Date(now + 60_000).toISOString(),
  } as EffectiveManagementPolicy;
}

function fetchedCandidate(
  policy: EffectiveManagementPolicy,
  origin: string = 'https://school.example',
  userId: string = 'learner-1',
) {
  return {
    policy,
    fresh: true as const,
    source: 'network' as const,
    publicKey: {
      keyId: policy.keyId,
      algorithm: 'Ed25519' as const,
      publicKey: 'candidate-public-key',
    },
    origin,
    userId,
  };
}

function stubGroupReadinessFetch(): void {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    return new Response(JSON.stringify(
      url.endsWith('/api/groups/eligible')
        ? { groups: [{ id: 'german-a', name: 'German A' }] }
        : {},
    ), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }));
}

describe('SettingsProvider', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    settingsSavedCb = undefined;
    setupMockImplementations();
    mockResolveCloudAccessToken.mockImplementation((settings: Settings) => (
      settings.cloudAuthAccessToken || settings.cloudAuthToken || ''
    ));
    mockNormalizeCloudAuthExpiresAt.mockImplementation((expiresAt?: number) => expiresAt ?? 0);
    mockIsCloudAccessTokenExpiringSoon.mockReturnValue(false);
    mockRefreshCloudSession.mockResolvedValue({
      accessToken: 'refreshed-access',
      refreshToken: 'refreshed-refresh',
      expiresAt: 0,
    });
    mockLoadCachedEffectivePolicy.mockResolvedValue(null);
    mockFetchEffectivePolicy.mockRejectedValue(new Error('management unavailable'));
    mockEnrollTrustedPublicKey.mockResolvedValue(undefined);
    mockSaveCachedPolicyMonotonic.mockResolvedValue(true);
  });

  it('useSettings throws when used outside SettingsProvider', async () => {
    const { createRoot } = await import('solid-js');
    const { useSettings } = await import('./SettingsContext');
    expect(() => {
      createRoot((dispose) => {
        try {
          useSettings();
        } finally {
          dispose();
        }
      });
    }).toThrow('useSettings must be used within a SettingsProvider');
  });

  it('initial state: isLoading=true, settings match DEFAULT_SETTINGS', async () => {
    const { ctx, dispose } = await mountProvider();
    expect(ctx.isLoading()).toBe(true);
    expect(ctx.isCloudReLoginModalOpen()).toBe(false);
    expect(ctx.settings.theme).toBe(DEFAULT_SETTINGS.theme);
    expect(ctx.settings.language).toBe(DEFAULT_SETTINGS.language);
    dispose();
  });

  it('cloud re-login modal helpers toggle modal visibility', async () => {
    const { ctx, dispose } = await mountProvider();
    expect(ctx.isCloudReLoginModalOpen()).toBe(false);
    ctx.openCloudReLoginModal();
    expect(ctx.isCloudReLoginModalOpen()).toBe(true);
    ctx.closeCloudReLoginModal();
    expect(ctx.isCloudReLoginModalOpen()).toBe(false);
    dispose();
  });

  it('runtime restart helpers expose and clear pending restart state', async () => {
    const { ctx, dispose } = await mountProvider();
    settingsCb(makeSettings({ language: 'ja' }));

    ctx.updateSetting('language', 'de');
    settingsSavedCb?.();

    expect(ctx.isRuntimeRestartRequired()).toBe(true);

    ctx.clearRuntimeRestartRequired();
    expect(ctx.isRuntimeRestartRequired()).toBe(false);

    ctx.restartAppForRuntimeSettings();
    expect(mockForceRestartApp).toHaveBeenCalledOnce();
    dispose();
  });

  it('registers IPC listener and calls getSettings on mount', async () => {
    const { dispose } = await mountProvider();
    expect(mockBridge.settings.onSettings).toHaveBeenCalledOnce();
    expect(mockBridge.settings.getSettings).toHaveBeenCalledOnce();
    dispose();
  });

  it('after receiving settings: isLoading=false, store updated', async () => {
    const { ctx, dispose } = await mountProvider();
    const loaded = makeSettings({ theme: 'dark', language: 'de' });
    settingsCb(loaded);
    expect(ctx.isLoading()).toBe(false);
    expect(ctx.settings.theme).toBe('dark');
    expect(ctx.settings.language).toBe('de');
    dispose();
  });

  it('migrates missing active-group settings to their declared defaults', async () => {
    const { ctx, dispose } = await mountProvider();
    const legacy = makeSettings() as Settings & {
      cloudAuthActiveGroupId?: string;
      cloudAuthActiveGroupName?: string;
    };
    delete legacy.cloudAuthActiveGroupId;
    delete legacy.cloudAuthActiveGroupName;

    settingsCb(legacy);

    expect(ctx.settings.cloudAuthActiveGroupId).toBe(DEFAULT_SETTINGS.cloudAuthActiveGroupId);
    expect(ctx.settings.cloudAuthActiveGroupName).toBe(DEFAULT_SETTINGS.cloudAuthActiveGroupName);
    expect(mockBridge.settings.saveSettings).toHaveBeenCalledWith(expect.objectContaining({
      cloudAuthActiveGroupId: DEFAULT_SETTINGS.cloudAuthActiveGroupId,
      cloudAuthActiveGroupName: DEFAULT_SETTINGS.cloudAuthActiveGroupName,
    }));
    dispose();
  });

  it('normalizes a persisted signed-out snapshot that still contains an active group', async () => {
    const { ctx, dispose } = await mountProvider();

    settingsCb(makeSettings({
      cloudAuthStatus: 'signed-out',
      cloudAuthActiveGroupId: 'stale-group',
      cloudAuthActiveGroupName: 'Stale Group',
    }));

    expect(ctx.settings.cloudAuthActiveGroupId).toBe(DEFAULT_SETTINGS.cloudAuthActiveGroupId);
    expect(ctx.settings.cloudAuthActiveGroupName).toBe(DEFAULT_SETTINGS.cloudAuthActiveGroupName);
    expect(mockBridge.settings.saveSettings).toHaveBeenCalledWith(expect.objectContaining({
      cloudAuthStatus: 'signed-out',
      cloudAuthActiveGroupId: '',
      cloudAuthActiveGroupName: '',
    }));
    dispose();
  });

  it('keeps a pre-load sign-out authoritative over an earlier pending active group', async () => {
    const { ctx, dispose } = await mountProvider();
    ctx.updateSettings({
      cloudAuthStatus: 'signed-in',
      cloudAuthActiveGroupId: 'german-a',
      cloudAuthActiveGroupName: 'German A',
    });
    ctx.updateSetting('cloudAuthStatus', 'signed-out');

    settingsCb(makeSettings({
      cloudAuthStatus: 'signed-in',
      cloudAuthActiveGroupId: 'server-group',
      cloudAuthActiveGroupName: 'Server Group',
    }));

    expect(ctx.settings.cloudAuthStatus).toBe('signed-out');
    expect(ctx.settings.cloudAuthActiveGroupId).toBe('');
    expect(ctx.settings.cloudAuthActiveGroupName).toBe('');
    expect(mockBridge.settings.saveSettings).toHaveBeenCalledWith(expect.objectContaining({
      cloudAuthStatus: 'signed-out',
      cloudAuthActiveGroupId: '',
      cloudAuthActiveGroupName: '',
    }));
    dispose();
  });

  it('clears the active group whenever the account is signed out', async () => {
    const { ctx, dispose } = await mountProvider();
    settingsCb(makeSettings({
      cloudAuthStatus: 'signed-in',
      cloudAuthAccessToken: 'access-token',
      cloudAuthActiveGroupId: 'german-a',
      cloudAuthActiveGroupName: 'German A',
    }));

    ctx.updateSettings({ cloudAuthStatus: 'signed-out' });

    expect(ctx.settings.cloudAuthActiveGroupId).toBe(DEFAULT_SETTINGS.cloudAuthActiveGroupId);
    expect(ctx.settings.cloudAuthActiveGroupName).toBe(DEFAULT_SETTINGS.cloudAuthActiveGroupName);
    dispose();
  });

  it('rejects a late group-only multi-setting write after loaded sign-out', async () => {
    const { ctx, dispose } = await mountProvider();
    settingsCb(makeSettings({ cloudAuthStatus: 'signed-out' }));

    ctx.updateSettings({
      cloudAuthActiveGroupId: 'late-group',
      cloudAuthActiveGroupName: 'Late Group',
    });

    expect(ctx.settings.cloudAuthStatus).toBe('signed-out');
    expect(ctx.settings.cloudAuthActiveGroupId).toBe('');
    expect(ctx.settings.cloudAuthActiveGroupName).toBe('');
    expect(mockBridge.settings.saveSettings).toHaveBeenLastCalledWith(expect.objectContaining({
      cloudAuthStatus: 'signed-out',
      cloudAuthActiveGroupId: '',
      cloudAuthActiveGroupName: '',
    }));
    dispose();
  });

  it('rejects late group-only single-setting writes while sign-out is pending before load', async () => {
    const { ctx, dispose } = await mountProvider();
    ctx.updateSetting('cloudAuthStatus', 'signed-out');

    ctx.updateSetting('cloudAuthActiveGroupId', 'late-group');
    ctx.updateSetting('cloudAuthActiveGroupName', 'Late Group');

    expect(ctx.settings.cloudAuthStatus).toBe('signed-out');
    expect(ctx.settings.cloudAuthActiveGroupId).toBe('');
    expect(ctx.settings.cloudAuthActiveGroupName).toBe('');
    settingsCb(makeSettings({ cloudAuthStatus: 'signed-out' }));
    expect(mockBridge.settings.saveSettings).toHaveBeenCalledWith(expect.objectContaining({
      cloudAuthStatus: 'signed-out',
      cloudAuthActiveGroupId: '',
      cloudAuthActiveGroupName: '',
    }));
    dispose();
  });

  it('after receiving settings: initializes backend adapter', async () => {
    const { dispose } = await mountProvider();
    const loaded = makeSettings({ backendMode: 'local', backendUrl: '' });
    settingsCb(loaded);
    expect(mockGetBackend).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'local' }),
    );
    dispose();
  });

  it('updateSetting: updates store and saves via bridge', async () => {
    const { ctx, dispose } = await mountProvider();
    settingsCb(makeSettings());
    ctx.updateSetting('theme', 'dark');
    expect(ctx.settings.theme).toBe('dark');
    expect(mockBridge.settings.saveSettings).toHaveBeenCalled();
    dispose();
  });

  it('updateSettings: merges partial and saves', async () => {
    const { ctx, dispose } = await mountProvider();
    settingsCb(makeSettings());
    ctx.updateSettings({ theme: 'darker', language: 'de' });
    expect(ctx.settings.theme).toBe('darker');
    expect(ctx.settings.language).toBe('de');
    expect(mockBridge.settings.saveSettings).toHaveBeenCalled();
    dispose();
  });

  it('normalizes conflicting persisted reader image appearance settings', async () => {
    const { ctx, dispose } = await mountProvider();
    settingsCb(makeSettings({
      readerSepiaEnabled: true,
      readerSharpenEnabled: true,
      readerSharpenTextEnabled: true,
    }));

    expect(ctx.settings.readerSepiaEnabled).toBe(true);
    expect(ctx.settings.readerSharpenEnabled).toBe(false);
    expect(ctx.settings.readerSharpenTextEnabled).toBe(false);
    expect(mockBridge.settings.saveSettings).toHaveBeenCalledWith(expect.objectContaining({
      readerSepiaEnabled: true,
      readerSharpenEnabled: false,
      readerSharpenTextEnabled: false,
    }));
    dispose();
  });

  it('keeps reader sharpening modes mutually exclusive through settings writes', async () => {
    const { ctx, dispose } = await mountProvider();
    settingsCb(makeSettings({ readerSharpenTextEnabled: true }));

    ctx.updateSetting('readerSharpenEnabled', true);

    expect(ctx.settings.readerSepiaEnabled).toBe(false);
    expect(ctx.settings.readerSharpenEnabled).toBe(true);
    expect(ctx.settings.readerSharpenTextEnabled).toBe(false);

    ctx.updateSettings({ readerSepiaEnabled: true });

    expect(ctx.settings.readerSepiaEnabled).toBe(true);
    expect(ctx.settings.readerSharpenEnabled).toBe(false);
    expect(ctx.settings.readerSharpenTextEnabled).toBe(false);
    dispose();
  });

  it('updateSetting with backendMode key triggers resetBackend + getBackend', async () => {
    const { ctx, dispose } = await mountProvider();
    settingsCb(makeSettings());
    mockResetBackend.mockClear();
    mockGetBackend.mockClear();
    ctx.updateSetting('backendMode', 'tethered');
    expect(mockResetBackend).toHaveBeenCalledOnce();
    expect(mockGetBackend).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'tethered' }),
    );
    dispose();
  });

  it('updateSetting with non-backend key does not trigger resetBackend', async () => {
    const { ctx, dispose } = await mountProvider();
    settingsCb(makeSettings());
    mockResetBackend.mockClear();
    ctx.updateSetting('theme', 'dark');
    expect(mockResetBackend).not.toHaveBeenCalled();
    expect(mockBridge.settings.onSettingsSaved).not.toHaveBeenCalled();
    dispose();
  });

  it('updateSetting with language key requires app restart after settings are saved', async () => {
    const { ctx, dispose } = await mountProvider();
    settingsCb(makeSettings({ language: 'ja' }));
    mockBridge.settings.onSettingsSaved.mockClear();
    mockRestartBackend.mockClear();
    settingsSavedCleanup.mockClear();

    ctx.updateSetting('language', 'de');

    expect(mockBridge.settings.saveSettings).toHaveBeenCalledWith(expect.objectContaining({ language: 'de' }));
    expect(mockBridge.settings.onSettingsSaved).toHaveBeenCalledOnce();
    expect(mockRestartBackend).not.toHaveBeenCalled();
    expect(ctx.isRuntimeRestartRequired()).toBe(false);

    settingsSavedCb?.();

    expect(settingsSavedCleanup).toHaveBeenCalledOnce();
    expect(mockRestartBackend).not.toHaveBeenCalled();
    expect(ctx.isRuntimeRestartRequired()).toBe(true);
    dispose();
  });

  it('updateSettings with dictionary target map requires app restart after settings are saved', async () => {
    const { ctx, dispose } = await mountProvider();
    settingsCb(makeSettings({ dictionaryTargetLanguages: { ja: 'en' } }));
    mockBridge.settings.onSettingsSaved.mockClear();
    mockRestartBackend.mockClear();
    settingsSavedCleanup.mockClear();

    ctx.updateSettings({ dictionaryTargetLanguages: { ja: 'fr' } });

    expect(mockBridge.settings.saveSettings).toHaveBeenCalledWith(expect.objectContaining({
      dictionaryTargetLanguages: { ja: 'fr' },
    }));
    expect(mockBridge.settings.onSettingsSaved).toHaveBeenCalledOnce();

    settingsSavedCb?.();

    expect(settingsSavedCleanup).toHaveBeenCalledOnce();
    expect(mockRestartBackend).not.toHaveBeenCalled();
    expect(ctx.isRuntimeRestartRequired()).toBe(true);
    dispose();
  });

  it('updateSettings does not restart Python backend when runtime language settings are unchanged', async () => {
    const { ctx, dispose } = await mountProvider();
    settingsCb(makeSettings({ dictionaryTargetLanguages: { ja: 'en' } }));
    mockBridge.settings.onSettingsSaved.mockClear();
    mockRestartBackend.mockClear();

    ctx.updateSettings({ dictionaryTargetLanguages: { ja: 'en' } });

    expect(mockBridge.settings.onSettingsSaved).not.toHaveBeenCalled();
    expect(mockRestartBackend).not.toHaveBeenCalled();
    dispose();
  });

  it('exposes a language-neutral prosody visibility helper over the persisted setting', async () => {
    const { ctx, dispose } = await mountProvider();
    settingsCb(makeSettings({ showProsody: true }));

    expect(ctx.showProsody()).toBe(true);

    ctx.setProsodyVisible(false);

    expect(ctx.showProsody()).toBe(false);
    expect(ctx.settings.showProsody).toBe(false);
    expect(mockBridge.settings.saveSettings).toHaveBeenCalledWith(expect.objectContaining({
      showProsody: false,
    }));
    dispose();
  });

  it('saveSettings before load queues as pending, saved after load', async () => {
    const { ctx, dispose } = await mountProvider();
    ctx.updateSettings({ theme: 'darker' });
    expect(mockBridge.settings.saveSettings).not.toHaveBeenCalled();
    settingsCb(makeSettings());
    expect(mockBridge.settings.saveSettings).toHaveBeenCalled();
    const savedArg = mockBridge.settings.saveSettings.mock.calls[0][0] as Settings;
    expect(savedArg.theme).toBe('darker');
    dispose();
  });

  it('applySettingsToDOM: sets CSS variables and theme class', async () => {
    const { ctx, dispose } = await mountProvider();
    settingsCb(makeSettings({
      theme: 'dark',
      subtitle_font_size: 32,
      subtitle_font_weight: 700,
      blur_amount: 10,
      readingAnnotationMoreContrast: true,
      readingAnnotationSizePercent: 130,
    }));
    const root = document.documentElement;
    expect(root.style.getPropertyValue('--subtitle-font-size')).toBe('32px');
    expect(root.style.getPropertyValue('--subtitle-font-weight')).toBe('700');
    expect(root.style.getPropertyValue('--word-blur-amount')).toBe('10px');
    expect(root.style.getPropertyValue('--reading-annotation-color')).toBe('var(--text-primary)');
    expect(root.style.getPropertyValue('--reading-annotation-scale')).toBe('1.3');
    expect(document.body.classList.contains('theme-dark')).toBe(true);
    ctx.updateSetting('theme', 'light');
    expect(document.body.classList.contains('theme-dark')).toBe(false);
    dispose();
  });

  it('cloud session validation: refreshed tokens are persisted', async () => {
    mockIsCloudAccessTokenExpiringSoon.mockReturnValue(true);
    mockRefreshCloudSession.mockResolvedValue({
      accessToken: 'new-access',
      refreshToken: 'new-refresh',
      expiresAt: 9999999999999,
    });
    const { ctx, dispose } = await mountProvider();
    settingsCb(makeSettings({
      cloudAuthStatus: 'signed-in',
      cloudAuthAccessToken: 'old-access',
      cloudAuthRefreshToken: 'old-refresh',
    }));
    await vi.waitFor(() => {
      expect(ctx.settings.cloudAuthAccessToken).toBe('new-access');
    });
    expect(ctx.settings.cloudAuthRefreshToken).toBe('new-refresh');
    dispose();
  });

  it('cloud session validation: expired clears auth fields and opens re-login modal for cloud features', async () => {
    mockIsCloudAccessTokenExpiringSoon.mockReturnValue(true);
    mockRefreshCloudSession.mockRejectedValue(new Error('401 invalid session'));
    const { ctx, dispose } = await mountProvider();
    settingsCb(makeSettings({
      cloudAuthStatus: 'signed-in',
      cloudAuthAccessToken: 'some-token',
      cloudAuthRefreshToken: 'refresh-token',
      llmProvider: 'cloud',
    }));
    await vi.waitFor(() => {
      expect(ctx.settings.cloudAuthStatus).toBe('signed-out');
    });
    expect(ctx.settings.cloudAuthAccessToken).toBe('');
    expect(ctx.isCloudReLoginModalOpen()).toBe(true);
    dispose();
  });

  it('BroadcastChannel: update message reconciles settings', async () => {
    const state: { handler: ((event: MessageEvent) => void) | null } = { handler: null };
    const closeFn = vi.fn();
    function MockBroadcastChannel() {
      return {
        postMessage: vi.fn(),
        close: closeFn,
        set onmessage(fn: ((event: MessageEvent) => void) | null) { state.handler = fn; },
        get onmessage() { return state.handler; },
      };
    }
    vi.stubGlobal('BroadcastChannel', MockBroadcastChannel);

    const { ctx, dispose } = await mountProvider();
    settingsCb(makeSettings());
    const updatedSettings = makeSettings({ theme: 'glass-dark' });
    state.handler!({ data: { type: 'update', settings: updatedSettings } } as MessageEvent);
    expect(ctx.settings.theme).toBe('glass-dark');
    dispose();
    vi.unstubAllGlobals();
  });

  it('BroadcastChannel: strips stale active-group state from signed-out input', async () => {
    const state: { handler: ((event: MessageEvent) => void) | null } = { handler: null };
    function MockBroadcastChannel() {
      return {
        postMessage: vi.fn(),
        close: vi.fn(),
        set onmessage(fn: ((event: MessageEvent) => void) | null) { state.handler = fn; },
        get onmessage() { return state.handler; },
      };
    }
    vi.stubGlobal('BroadcastChannel', MockBroadcastChannel);
    const { ctx, dispose } = await mountProvider();
    settingsCb(makeSettings({
      cloudAuthStatus: 'signed-in',
      cloudAuthActiveGroupId: 'german-a',
      cloudAuthActiveGroupName: 'German A',
    }));

    state.handler!({ data: { type: 'update', settings: makeSettings({
      cloudAuthStatus: 'signed-out',
      cloudAuthActiveGroupId: 'stale-group',
      cloudAuthActiveGroupName: 'Stale Group',
    }) } } as MessageEvent);

    expect(ctx.settings.cloudAuthStatus).toBe('signed-out');
    expect(ctx.settings.cloudAuthActiveGroupId).toBe('');
    expect(ctx.settings.cloudAuthActiveGroupName).toBe('');
    dispose();
    vi.unstubAllGlobals();
  });

  it('restores a cached managed value for local, multi-setting, and broadcast updates', async () => {
    const state: { handler: ((event: MessageEvent) => void) | null } = { handler: null };
    const postMessage = vi.fn();
    function MockBroadcastChannel() {
      return {
        postMessage,
        close: vi.fn(),
        set onmessage(fn: ((event: MessageEvent) => void) | null) { state.handler = fn; },
        get onmessage() { return state.handler; },
      };
    }
    vi.stubGlobal('BroadcastChannel', MockBroadcastChannel);
    const policy = policyFixture as EffectiveManagementPolicy;
    mockLoadCachedEffectivePolicy.mockResolvedValue({ policy, fresh: false, source: 'cache' });

    const { ctx, dispose } = await mountProvider();
    settingsCb(makeSettings({
      cloudAuthStatus: 'signed-in',
      cloudAuthUserId: 'learner-1',
      cloudAuthActiveGroupId: 'german-a',
      cloudAuthActiveGroupName: 'German A',
      overrideCloudEndpointUrl: true,
      cloudApiUrl: 'https://school.example',
      llmEnabled: true,
    }));
    await vi.waitFor(() => expect(ctx.settings.llmEnabled).toBe(false));

    ctx.updateSetting('llmEnabled', true);
    expect(ctx.settings.llmEnabled).toBe(false);
    ctx.updateSettings({ llmEnabled: true, maxNewCardsPerDay: 99 });
    expect(ctx.settings.llmEnabled).toBe(false);
    expect(ctx.settings.maxNewCardsPerDay).toBe(15);

    state.handler!({ data: { type: 'update', settings: makeSettings({
      cloudAuthStatus: 'signed-in',
      cloudAuthUserId: 'learner-1',
      cloudAuthActiveGroupId: 'german-a',
      cloudAuthActiveGroupName: 'German A',
      overrideCloudEndpointUrl: true,
      cloudApiUrl: 'https://school.example',
      llmEnabled: true,
    }) } } as MessageEvent);
    expect(ctx.settings.llmEnabled).toBe(false);
    expect(ctx.isSettingManaged('llmEnabled')).toBe(true);
    expect(ctx.getManagedSettingSource('llmEnabled')?.sourceGroupName).toBe('School');
    expect(mockBridge.settings.saveSettings).toHaveBeenLastCalledWith(
      expect.objectContaining({ llmEnabled: false }),
    );
    expect(postMessage).not.toHaveBeenCalledWith(expect.objectContaining({
      settings: expect.objectContaining({ llmEnabled: true }),
    }));
    dispose();
    vi.unstubAllGlobals();
  });

  it('keeps first-load settings private and unsaved until the cached policy resolves', async () => {
    const state: { handler: ((event: MessageEvent) => void) | null } = { handler: null };
    const postMessage = vi.fn();
    function MockBroadcastChannel() {
      return {
        postMessage,
        close: vi.fn(),
        set onmessage(fn: ((event: MessageEvent) => void) | null) { state.handler = fn; },
        get onmessage() { return state.handler; },
      };
    }
    vi.stubGlobal('BroadcastChannel', MockBroadcastChannel);
    let resolveCache!: (value: {
      policy: EffectiveManagementPolicy;
      fresh: false;
      source: 'cache';
    }) => void;
    mockLoadCachedEffectivePolicy.mockReturnValue(new Promise((resolve) => { resolveCache = resolve; }));
    const { ctx, dispose } = await mountProvider();

    settingsCb(makeSettings({
      theme: 'darker',
      llmEnabled: true,
      cloudAuthStatus: 'signed-in',
      cloudAuthUserId: 'learner-1',
      cloudAuthActiveGroupId: 'german-a',
      cloudAuthActiveGroupName: 'German A',
      overrideCloudEndpointUrl: true,
      cloudApiUrl: 'https://school.example',
    }));

    expect(ctx.isLoading()).toBe(true);
    expect(ctx.settings.theme).toBe(DEFAULT_SETTINGS.theme);
    expect(mockBridge.settings.saveSettings).not.toHaveBeenCalled();
    expect(postMessage).not.toHaveBeenCalled();
    ctx.updateSetting('llmEnabled', true);
    expect(mockBridge.settings.saveSettings).not.toHaveBeenCalled();
    expect(postMessage).not.toHaveBeenCalled();
    state.handler!({ data: { type: 'update', settings: makeSettings({
      theme: 'darker',
      llmEnabled: true,
      cloudAuthStatus: 'signed-in',
      cloudAuthUserId: 'learner-1',
      cloudAuthActiveGroupId: 'german-a',
      cloudAuthActiveGroupName: 'German A',
      overrideCloudEndpointUrl: true,
      cloudApiUrl: 'https://school.example',
    }) } } as MessageEvent);
    expect(ctx.isLoading()).toBe(true);
    expect(ctx.settings.theme).toBe(DEFAULT_SETTINGS.theme);
    expect(mockBridge.settings.saveSettings).not.toHaveBeenCalled();
    expect(postMessage).not.toHaveBeenCalled();

    resolveCache({
      policy: policyFixture as EffectiveManagementPolicy,
      fresh: false,
      source: 'cache',
    });
    await vi.waitFor(() => expect(ctx.isLoading()).toBe(false));
    expect(ctx.settings.theme).toBe('dark');
    expect(ctx.settings.llmEnabled).toBe(false);
    for (const [snapshot] of mockBridge.settings.saveSettings.mock.calls) {
      expect(snapshot).toEqual(expect.objectContaining({ theme: 'dark', llmEnabled: false }));
    }
    for (const [{ settings: snapshot }] of postMessage.mock.calls) {
      expect(snapshot).toEqual(expect.objectContaining({ theme: 'dark', llmEnabled: false }));
    }
    dispose();
    vi.unstubAllGlobals();
  });

  it('keeps stale cached restrictions locked but fails closed for network features', async () => {
    const policy = policyFixture as EffectiveManagementPolicy;
    mockLoadCachedEffectivePolicy.mockResolvedValue({ policy, fresh: false, source: 'cache' });
    const { ctx, dispose } = await mountProvider();
    settingsCb(makeSettings({
      cloudAuthStatus: 'signed-in',
      cloudAuthUserId: 'learner-1',
      cloudAuthActiveGroupId: 'german-a',
      cloudAuthActiveGroupName: 'German A',
      overrideCloudEndpointUrl: true,
      cloudApiUrl: 'https://school.example',
    }));
    await vi.waitFor(() => expect(ctx.managedPolicy()).toEqual(policy));

    expect(ctx.settings.llmEnabled).toBe(false);
    expect(ctx.hasFreshNetworkPolicy()).toBe(false);
    expect(ctx.policyAllowsFeature('cloud_tts')).toBe(false);
    expect(ctx.policyAllowsFeature('llm')).toBe(false);
    dispose();
  });

  it('applies a managed policy after merging pre-load mutations and persists only reconciled values', async () => {
    const policy = policyFixture as EffectiveManagementPolicy;
    mockLoadCachedEffectivePolicy.mockResolvedValue({ policy, fresh: false, source: 'cache' });
    const { ctx, dispose } = await mountProvider();
    ctx.updateSettings({
      cloudAuthStatus: 'signed-in',
      cloudAuthUserId: 'learner-1',
      cloudAuthActiveGroupId: 'german-a',
      cloudAuthActiveGroupName: 'German A',
      overrideCloudEndpointUrl: true,
      cloudApiUrl: 'https://school.example',
    });
    ctx.updateSetting('llmEnabled', true);

    settingsCb(makeSettings({ llmEnabled: true }));
    await vi.waitFor(() => expect(ctx.settings.llmEnabled).toBe(false));
    expect(mockBridge.settings.saveSettings).toHaveBeenLastCalledWith(
      expect.objectContaining({ llmEnabled: false }),
    );
    dispose();
  });

  it('allows a policy feature only while the verified snapshot is fresh', async () => {
    const now = Date.now();
    const policy = {
      ...policyFixture,
      issuedAt: new Date(now - 1_000).toISOString(),
      expiresAt: new Date(now + 60_000).toISOString(),
    } as EffectiveManagementPolicy;
    mockLoadCachedEffectivePolicy.mockResolvedValue({ policy, fresh: true, source: 'cache' });
    const { ctx, dispose } = await mountProvider();
    settingsCb(makeSettings({
      cloudAuthStatus: 'signed-in',
      cloudAuthUserId: 'learner-1',
      cloudAuthActiveGroupId: 'german-a',
      cloudAuthActiveGroupName: 'German A',
      overrideCloudEndpointUrl: true,
      cloudApiUrl: 'https://school.example',
    }));
    await vi.waitFor(() => expect(ctx.managedPolicy()).toEqual(policy));

    expect(ctx.hasFreshNetworkPolicy()).toBe(true);
    expect(ctx.policyAllowsFeature('llm')).toBe(true);
    expect(ctx.policyAllowsFeature('cloud_tts')).toBe(false);
    expect(ctx.policyAllowsFeature('unlisted_feature')).toBe(false);
    dispose();
  });

  it('drops network authorization on active-group change until that scope is verified', async () => {
    const now = Date.now();
    const firstPolicy = {
      ...policyFixture,
      issuedAt: new Date(now - 1_000).toISOString(),
      expiresAt: new Date(now + 60_000).toISOString(),
    } as EffectiveManagementPolicy;
    const secondPolicy = {
      ...firstPolicy,
      activeGroupId: 'german-b',
      ancestry: [
        ...firstPolicy.ancestry.slice(0, -1),
        { id: 'german-b', name: 'German B' },
      ],
    };
    let resolveSecond!: (value: {
      policy: EffectiveManagementPolicy;
      fresh: true;
      source: 'cache';
    }) => void;
    mockLoadCachedEffectivePolicy
      .mockResolvedValueOnce({ policy: firstPolicy, fresh: true, source: 'cache' })
      .mockReturnValueOnce(new Promise((resolve) => { resolveSecond = resolve; }));
    const { ctx, dispose } = await mountProvider();
    settingsCb(makeSettings({
      cloudAuthStatus: 'signed-in',
      cloudAuthUserId: 'learner-1',
      cloudAuthActiveGroupId: 'german-a',
      cloudAuthActiveGroupName: 'German A',
      overrideCloudEndpointUrl: true,
      cloudApiUrl: 'https://school.example',
    }));
    await vi.waitFor(() => expect(ctx.policyAllowsFeature('llm')).toBe(true));

    ctx.updateSettings({
      cloudAuthActiveGroupId: 'german-b',
      cloudAuthActiveGroupName: 'German B',
    });
    expect(ctx.managedPolicy()).toBeNull();
    expect(ctx.hasFreshNetworkPolicy()).toBe(false);
    expect(ctx.policyAllowsFeature('llm')).toBe(false);
    expect(mockLoadCachedEffectivePolicy).toHaveBeenLastCalledWith(
      expect.objectContaining({
        cloudAuthUserId: 'learner-1',
        cloudAuthActiveGroupId: 'german-b',
      }),
    );

    resolveSecond({ policy: secondPolicy, fresh: true, source: 'cache' });
    await vi.waitFor(() => expect(ctx.managedPolicy()).toEqual(secondPolicy));
    expect(ctx.policyAllowsFeature('llm')).toBe(true);
    dispose();
  });

  it.each([
    ['group', { cloudAuthActiveGroupId: 'german-b', cloudAuthActiveGroupName: 'German B' }],
    ['user', { cloudAuthUserId: 'learner-2' }],
    ['origin', { cloudApiUrl: 'https://second-school.example' }],
    ['token refresh', { cloudAuthAccessToken: 'token-2' }],
  ] as const)('discards an out-of-order %s response before durable trust or cache writes', async (_name, patch) => {
    stubGroupReadinessFetch();
    mockLoadCachedEffectivePolicy.mockResolvedValue(null);
    const resolvers: Array<(value: ReturnType<typeof fetchedCandidate>) => void> = [];
    mockFetchEffectivePolicy.mockImplementation(() => new Promise((resolve) => { resolvers.push(resolve); }));
    const { ctx, dispose } = await mountProvider();
    settingsCb(makeSettings({
      cloudAuthStatus: 'signed-in',
      cloudAuthAccessToken: 'token-1',
      cloudAuthUserId: 'learner-1',
      cloudAuthActiveGroupId: 'german-a',
      cloudAuthActiveGroupName: 'German A',
      overrideCloudEndpointUrl: true,
      cloudApiUrl: 'https://school.example',
    }));
    await vi.waitFor(() => expect(mockFetchEffectivePolicy).toHaveBeenCalledTimes(1));

    ctx.updateSettings(patch);
    await vi.waitFor(() => expect(mockFetchEffectivePolicy).toHaveBeenCalledTimes(2));
    resolvers[0](fetchedCandidate(freshPolicy('german-a')));
    await Promise.resolve();
    expect(mockEnrollTrustedPublicKey).not.toHaveBeenCalled();
    expect(mockSaveCachedPolicyMonotonic).not.toHaveBeenCalled();

    const currentGroup = ctx.settings.cloudAuthActiveGroupId;
    const currentOrigin = ctx.settings.cloudApiUrl.includes('second-school')
      ? 'https://second-school.example'
      : 'https://school.example';
    const currentUser = ctx.settings.cloudAuthUserId;
    const replacement = fetchedCandidate(freshPolicy(currentGroup), currentOrigin, currentUser);
    resolvers[1](replacement);
    await vi.waitFor(() => expect(mockEnrollTrustedPublicKey).toHaveBeenCalledOnce());
    expect(mockSaveCachedPolicyMonotonic).toHaveBeenCalledWith(
      replacement.origin,
      replacement.userId,
      replacement.policy,
      expect.any(AbortSignal),
    );
    dispose();
    vi.unstubAllGlobals();
  });

  it('drops an outstanding response on sign-out', async () => {
    stubGroupReadinessFetch();
    mockLoadCachedEffectivePolicy.mockResolvedValue(null);
    let resolveFetch!: (value: ReturnType<typeof fetchedCandidate>) => void;
    mockFetchEffectivePolicy.mockReturnValue(new Promise((resolve) => { resolveFetch = resolve; }));
    const { ctx, dispose } = await mountProvider();
    settingsCb(makeSettings({
      cloudAuthStatus: 'signed-in',
      cloudAuthAccessToken: 'token-1',
      cloudAuthUserId: 'learner-1',
      cloudAuthActiveGroupId: 'german-a',
      cloudAuthActiveGroupName: 'German A',
      overrideCloudEndpointUrl: true,
      cloudApiUrl: 'https://school.example',
    }));
    await vi.waitFor(() => expect(mockFetchEffectivePolicy).toHaveBeenCalledOnce());
    const signal = mockFetchEffectivePolicy.mock.calls[0][3] as AbortSignal;

    ctx.updateSetting('cloudAuthStatus', 'signed-out');
    expect(signal.aborted).toBe(true);
    resolveFetch(fetchedCandidate(freshPolicy()));
    await Promise.resolve();
    expect(mockEnrollTrustedPublicKey).not.toHaveBeenCalled();
    expect(mockSaveCachedPolicyMonotonic).not.toHaveBeenCalled();

    dispose();
    vi.unstubAllGlobals();
  });

  it('aborts outstanding policy work on provider cleanup before any durable write', async () => {
    stubGroupReadinessFetch();
    mockLoadCachedEffectivePolicy.mockResolvedValue(null);
    let resolveFetch!: (value: ReturnType<typeof fetchedCandidate>) => void;
    mockFetchEffectivePolicy.mockReturnValue(new Promise((resolve) => { resolveFetch = resolve; }));
    const { dispose } = await mountProvider();
    settingsCb(makeSettings({
      cloudAuthStatus: 'signed-in',
      cloudAuthAccessToken: 'token-1',
      cloudAuthUserId: 'learner-1',
      cloudAuthActiveGroupId: 'german-a',
      cloudAuthActiveGroupName: 'German A',
      overrideCloudEndpointUrl: true,
      cloudApiUrl: 'https://school.example',
    }));
    await vi.waitFor(() => expect(mockFetchEffectivePolicy).toHaveBeenCalledOnce());
    const signal = mockFetchEffectivePolicy.mock.calls[0][3] as AbortSignal;

    dispose();
    expect(signal.aborted).toBe(true);
    resolveFetch(fetchedCandidate(freshPolicy()));
    await Promise.resolve();
    expect(mockEnrollTrustedPublicKey).not.toHaveBeenCalled();
    expect(mockSaveCachedPolicyMonotonic).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('keeps a verified fresh policy enforced when its best-effort snapshot write fails', async () => {
    stubGroupReadinessFetch();
    mockLoadCachedEffectivePolicy.mockResolvedValue(null);
    const policy = freshPolicy();
    mockFetchEffectivePolicy.mockResolvedValue(fetchedCandidate(policy));
    mockSaveCachedPolicyMonotonic.mockRejectedValue(new Error('quota exceeded'));
    const { ctx, dispose } = await mountProvider();
    settingsCb(makeSettings({
      cloudAuthStatus: 'signed-in',
      cloudAuthAccessToken: 'token-1',
      cloudAuthUserId: 'learner-1',
      cloudAuthActiveGroupId: 'german-a',
      cloudAuthActiveGroupName: 'German A',
      overrideCloudEndpointUrl: true,
      cloudApiUrl: 'https://school.example',
      llmEnabled: true,
    }));

    await vi.waitFor(() => expect(ctx.managedPolicy()).toEqual(policy));
    await vi.waitFor(() => expect(mockSaveCachedPolicyMonotonic).toHaveBeenCalledOnce());
    expect(ctx.settings.llmEnabled).toBe(false);
    expect(ctx.hasFreshNetworkPolicy()).toBe(true);
    expect(ctx.policyAllowsFeature('llm')).toBe(true);
    dispose();
    vi.unstubAllGlobals();
  });

  it('fails closed when durable deployment-key trust cannot be established', async () => {
    stubGroupReadinessFetch();
    mockLoadCachedEffectivePolicy.mockResolvedValue(null);
    const policy = freshPolicy();
    mockFetchEffectivePolicy.mockResolvedValue(fetchedCandidate(policy));
    mockEnrollTrustedPublicKey.mockRejectedValue(new Error('key store unavailable'));
    const { ctx, dispose } = await mountProvider();
    settingsCb(makeSettings({
      cloudAuthStatus: 'signed-in',
      cloudAuthAccessToken: 'token-1',
      cloudAuthUserId: 'learner-1',
      cloudAuthActiveGroupId: 'german-a',
      cloudAuthActiveGroupName: 'German A',
      overrideCloudEndpointUrl: true,
      cloudApiUrl: 'https://school.example',
      llmEnabled: true,
    }));

    await vi.waitFor(() => expect(mockEnrollTrustedPublicKey).toHaveBeenCalledOnce());
    expect(ctx.managedPolicy()).toBeNull();
    expect(ctx.hasFreshNetworkPolicy()).toBe(false);
    expect(ctx.policyAllowsFeature('llm')).toBe(false);
    expect(mockSaveCachedPolicyMonotonic).not.toHaveBeenCalled();
    dispose();
    vi.unstubAllGlobals();
  });

  it('cleanup: IPC cleanups called and BroadcastChannel closed', async () => {
    const closeFn = vi.fn();
    function MockBroadcastChannel() {
      return {
        postMessage: vi.fn(),
        close: closeFn,
        set onmessage(_fn: ((event: MessageEvent) => void) | null) {},
        get onmessage(): ((event: MessageEvent) => void) | null { return null; },
      };
    }
    vi.stubGlobal('BroadcastChannel', MockBroadcastChannel);

    const { dispose } = await mountProvider();
    dispose();
    expect(settingsCleanup).toHaveBeenCalledOnce();
    expect(closeFn).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });
});
