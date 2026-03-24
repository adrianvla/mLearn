import { vi, describe, it, expect, beforeEach } from 'vitest';
import type { Settings } from '../../shared/types';
import { DEFAULT_SETTINGS } from '../../shared/types';

let settingsCb: (s: Settings) => void;
const settingsCleanup = vi.fn();

const mockBridge = {
  settings: {
    onSettings: vi.fn(),
    getSettings: vi.fn(),
    saveSettings: vi.fn(),
  },
};

function setupMockImplementations() {
  mockBridge.settings.onSettings.mockImplementation((cb: (s: Settings) => void) => {
    settingsCb = cb;
    return settingsCleanup;
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

const mockValidateAndRefreshCloudSession = vi.fn();
vi.mock('../services/cloudAuthService', () => ({
  validateAndRefreshCloudSession: (...args: unknown[]) => mockValidateAndRefreshCloudSession(...args),
}));

const mockShowToast = vi.fn();
vi.mock('../components/common/Feedback/Toast', () => ({
  showToast: (...args: unknown[]) => mockShowToast(...args),
}));

const mockT = vi.fn((key: string) => key);
vi.mock('./LocalizationContext', () => ({
  useLocalization: () => ({ t: mockT }),
}));

type SettingsCtx = {
  settings: Settings;
  updateSetting: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  updateSettings: (partial: Partial<Settings>) => void;
  saveSettings: () => void;
  isLoading: () => boolean;
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
    setupMockImplementations();
    mockValidateAndRefreshCloudSession.mockResolvedValue({ status: 'valid' });
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
    expect(ctx.settings.theme).toBe(DEFAULT_SETTINGS.theme);
    expect(ctx.settings.language).toBe(DEFAULT_SETTINGS.language);
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
    mockValidateAndRefreshCloudSession.mockResolvedValue({
      status: 'refreshed',
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

  it('cloud session validation: expired clears auth fields', async () => {
    mockValidateAndRefreshCloudSession.mockResolvedValue({ status: 'expired' });
    const { ctx, dispose } = await mountProvider();
    settingsCb(makeSettings({
      cloudAuthStatus: 'signed-in',
      cloudAuthAccessToken: 'some-token',
    }));
    await vi.waitFor(() => {
      expect(ctx.settings.cloudAuthStatus).toBe('signed-out');
    });
    expect(ctx.settings.cloudAuthAccessToken).toBe('');
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
