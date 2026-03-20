import { vi, describe, it, expect, beforeEach } from 'vitest';

let localizationCb: (data: { locale: string; strings: Record<string, unknown> }) => void;
const localizationCleanup = vi.fn();

const mockBridge = {
  localization: {
    onLocalization: vi.fn(),
    getLocalization: vi.fn(),
    changeUILanguage: vi.fn(),
  },
};

function setupMockImplementations() {
  mockBridge.localization.onLocalization.mockImplementation(
    (cb: (data: { locale: string; strings: Record<string, unknown> }) => void) => {
      localizationCb = cb;
      return localizationCleanup;
    },
  );
}

vi.mock('../../shared/bridges', () => ({
  getBridge: () => mockBridge,
}));

type LocalizationCtx = {
  locale: () => string;
  t: (path: string, params?: Record<string, string | number>) => string;
  changeLanguage: (langCode: string) => void;
  isLoaded: () => boolean;
};

async function mountProvider() {
  const { createRoot, createComponent } = await import('solid-js');
  const { LocalizationProvider, useLocalization } = await import('./LocalizationContext');
  let ctx!: LocalizationCtx;
  let dispose!: () => void;
  createRoot((d) => {
    dispose = d;
    createComponent(LocalizationProvider, {
      get children() {
        ctx = useLocalization();
        return null;
      },
    });
  });
  return { ctx, dispose };
}

describe('LocalizationProvider behavior', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    setupMockImplementations();
  });

  it('useLocalization throws when used outside LocalizationProvider', async () => {
    const { createRoot } = await import('solid-js');
    const { useLocalization } = await import('./LocalizationContext');
    expect(() => {
      createRoot((dispose) => {
        try {
          useLocalization();
        } finally {
          dispose();
        }
      });
    }).toThrow('useLocalization must be used within a LocalizationProvider');
  });

  it('useT throws when used outside LocalizationProvider', async () => {
    const { createRoot } = await import('solid-js');
    const { useT } = await import('./LocalizationContext');
    expect(() => {
      createRoot((dispose) => {
        try {
          useT();
        } finally {
          dispose();
        }
      });
    }).toThrow('useLocalization must be used within a LocalizationProvider');
  });

  it('initial state: locale=en, isLoaded=false', async () => {
    const { ctx, dispose } = await mountProvider();
    expect(ctx.locale()).toBe('en');
    expect(ctx.isLoaded()).toBe(false);
    dispose();
  });

  it('registers IPC listener and calls getLocalization on mount', async () => {
    const { dispose } = await mountProvider();
    expect(mockBridge.localization.onLocalization).toHaveBeenCalledOnce();
    expect(mockBridge.localization.getLocalization).toHaveBeenCalledOnce();
    dispose();
  });

  it('after receiving localization data: locale updates, isLoaded=true', async () => {
    const { ctx, dispose } = await mountProvider();
    localizationCb({ locale: 'ja', strings: { mlearn: { Home: { Title: 'ホーム' } } } });
    expect(ctx.locale()).toBe('ja');
    expect(ctx.isLoaded()).toBe(true);
    dispose();
  });

  it('t() returns full path as fallback when strings not loaded', async () => {
    const { ctx, dispose } = await mountProvider();
    expect(ctx.t('mlearn.Home.Title')).toBe('mlearn.Home.Title');
    dispose();
  });

  it('t() returns correct nested string value after load', async () => {
    const { ctx, dispose } = await mountProvider();
    localizationCb({ locale: 'en', strings: { mlearn: { Home: { Title: 'Home' } } } });
    expect(ctx.t('mlearn.Home.Title')).toBe('Home');
    dispose();
  });

  it('t() with params interpolates correctly', async () => {
    const { ctx, dispose } = await mountProvider();
    localizationCb({ locale: 'en', strings: { mlearn: { Greeting: 'Hello {name}!' } } });
    expect(ctx.t('mlearn.Greeting', { name: 'World' })).toBe('Hello World!');
    dispose();
  });

  it('t() returns full path for missing keys after load', async () => {
    const { ctx, dispose } = await mountProvider();
    localizationCb({ locale: 'en', strings: { mlearn: { Existing: 'value' } } });
    expect(ctx.t('mlearn.NonExistent.Key')).toBe('mlearn.NonExistent.Key');
    dispose();
  });

  it('changeLanguage calls bridge.localization.changeUILanguage', async () => {
    const { ctx, dispose } = await mountProvider();
    ctx.changeLanguage('fr');
    expect(mockBridge.localization.changeUILanguage).toHaveBeenCalledWith('fr');
    dispose();
  });

  it('BroadcastChannel: localization-update message updates locale and strings', async () => {
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
    state.handler!({
      data: {
        type: 'localization-update',
        locale: 'de',
        strings: { mlearn: { Key: 'Wert' } },
      },
    } as MessageEvent);
    expect(ctx.locale()).toBe('de');
    dispose();
    vi.unstubAllGlobals();
  });

  it('BroadcastChannel: language-change triggers getLocalization', async () => {
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

    const { dispose } = await mountProvider();
    const callsBefore = mockBridge.localization.getLocalization.mock.calls.length;
    state.handler!({
      data: { type: 'language-change', locale: 'fr' },
    } as MessageEvent);
    expect(mockBridge.localization.getLocalization.mock.calls.length).toBeGreaterThan(callsBefore);
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
    expect(localizationCleanup).toHaveBeenCalledOnce();
    expect(closeFn).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });
});
