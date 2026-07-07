import { vi, describe, it, expect, beforeEach } from 'vitest';
import type { Settings } from '../../shared/types';
import { DEFAULT_SETTINGS } from '../../shared/types';

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

vi.mock('../services/cloudAuthService', () => ({
  CLOUD_ACCESS_TOKEN_REFRESH_BUFFER_MS: 60_000,
  isCloudAccessTokenExpiringSoon: (...args: unknown[]) => mockIsCloudAccessTokenExpiringSoon(...args),
  normalizeCloudAuthExpiresAt: (...args: unknown[]) => mockNormalizeCloudAuthExpiresAt(...args),
  refreshCloudSession: (...args: unknown[]) => mockRefreshCloudSession(...args),
  resolveCloudAccessToken: (...args: unknown[]) => mockResolveCloudAccessToken(...args),
}));

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
    settingsCb(makeSettings({ theme: 'dark', subtitle_font_size: 32, subtitle_font_weight: 700, blur_amount: 10 }));
    const root = document.documentElement;
    expect(root.style.getPropertyValue('--subtitle-font-size')).toBe('32px');
    expect(root.style.getPropertyValue('--subtitle-font-weight')).toBe('700');
    expect(root.style.getPropertyValue('--word-blur-amount')).toBe('10px');
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
