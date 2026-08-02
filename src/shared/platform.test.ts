import type { Platform } from './platform';

let mod: typeof import('./platform');

beforeEach(async () => {
  vi.resetModules();
  mod = await import('./platform');
});

afterEach(() => {
  delete (window as unknown as Record<string, unknown>).mLearnIPC;
  delete (window as unknown as Record<string, unknown>).Capacitor;
});

describe('getPlatform', () => {
  it('returns electron when window.mLearnIPC exists', async () => {
    Object.defineProperty(window, 'mLearnIPC', { value: {}, writable: true, configurable: true });
    vi.resetModules();
    mod = await import('./platform');
    expect(mod.getPlatform()).toBe('electron' satisfies Platform);
  });

  it('returns capacitor when window.Capacitor exists but not mLearnIPC', async () => {
    Object.defineProperty(window, 'Capacitor', { value: {}, writable: true, configurable: true });
    vi.resetModules();
    mod = await import('./platform');
    expect(mod.getPlatform()).toBe('capacitor' satisfies Platform);
  });

  it('returns web when neither mLearnIPC nor Capacitor exist', () => {
    expect(mod.getPlatform()).toBe('web' satisfies Platform);
  });

  it('caches result so second call returns same value without re-checking', () => {
    const first = mod.getPlatform();
    Object.defineProperty(window, 'mLearnIPC', { value: {}, writable: true, configurable: true });
    const second = mod.getPlatform();
    expect(second).toBe(first);
  });
});

describe('isElectron', () => {
  it('returns true when platform is electron', async () => {
    Object.defineProperty(window, 'mLearnIPC', { value: {}, writable: true, configurable: true });
    vi.resetModules();
    mod = await import('./platform');
    expect(mod.isElectron()).toBe(true);
  });

  it('returns false when platform is not electron', () => {
    expect(mod.isElectron()).toBe(false);
  });
});

describe('isCapacitor', () => {
  it('returns true when platform is capacitor', async () => {
    Object.defineProperty(window, 'Capacitor', { value: {}, writable: true, configurable: true });
    vi.resetModules();
    mod = await import('./platform');
    expect(mod.isCapacitor()).toBe(true);
  });

  it('returns false when platform is not capacitor', () => {
    expect(mod.isCapacitor()).toBe(false);
  });
});

describe('isWeb', () => {
  it('returns true when platform is web', () => {
    expect(mod.isWeb()).toBe(true);
  });

  it('returns false when platform is electron', async () => {
    Object.defineProperty(window, 'mLearnIPC', { value: {}, writable: true, configurable: true });
    vi.resetModules();
    mod = await import('./platform');
    expect(mod.isWeb()).toBe(false);
  });
});

describe('isMobile', () => {
  it('returns true when platform is capacitor', async () => {
    Object.defineProperty(window, 'Capacitor', { value: {}, writable: true, configurable: true });
    vi.resetModules();
    mod = await import('./platform');
    expect(mod.isMobile()).toBe(true);
  });

  it('returns false when platform is web', () => {
    expect(mod.isMobile()).toBe(false);
  });

  it('returns false when platform is electron', async () => {
    Object.defineProperty(window, 'mLearnIPC', { value: {}, writable: true, configurable: true });
    vi.resetModules();
    mod = await import('./platform');
    expect(mod.isMobile()).toBe(false);
  });
});

describe('isDesktop', () => {
  it('returns true when platform is electron', async () => {
    Object.defineProperty(window, 'mLearnIPC', { value: {}, writable: true, configurable: true });
    vi.resetModules();
    mod = await import('./platform');
    expect(mod.isDesktop()).toBe(true);
  });

  it('returns false when platform is web', () => {
    expect(mod.isDesktop()).toBe(false);
  });

  it('returns false when platform is capacitor', async () => {
    Object.defineProperty(window, 'Capacitor', { value: {}, writable: true, configurable: true });
    vi.resetModules();
    mod = await import('./platform');
    expect(mod.isDesktop()).toBe(false);
  });
});

function setUserAgent(ua: string): void {
  Object.defineProperty(navigator, 'userAgent', { value: ua, configurable: true });
}

describe('getOS', () => {
  it('detects windows from a Windows user agent', async () => {
    setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
    vi.resetModules();
    mod = await import('./platform');
    expect(mod.getOS()).toBe('windows');
  });

  it('detects mac from a Macintosh user agent', async () => {
    setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36');
    vi.resetModules();
    mod = await import('./platform');
    expect(mod.getOS()).toBe('mac');
  });

  it('detects linux from a Linux user agent', async () => {
    setUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36');
    vi.resetModules();
    mod = await import('./platform');
    expect(mod.getOS()).toBe('linux');
  });

  it('returns other for unknown user agents', async () => {
    setUserAgent('SomeUnknownAgent/1.0');
    vi.resetModules();
    mod = await import('./platform');
    expect(mod.getOS()).toBe('other');
  });
});

describe('initPlatformBodyClass', () => {
  it('adds platform-{os} to document.body', async () => {
    setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
    vi.resetModules();
    mod = await import('./platform');
    mod.initPlatformBodyClass();
    expect(document.body.classList.contains('platform-windows')).toBe(true);
  });
});
