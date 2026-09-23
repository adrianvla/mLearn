// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/splash/logo-data.js', () => ({ decodeLogo: async () => new Uint8Array(2) }));

let frames: Array<FrameRequestCallback>;
let disconnected: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  frames = [];
  disconnected = vi.fn();
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.push(callback);
    return frames.length;
  });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.stubGlobal('ResizeObserver', class {
    observe() { /* layout is supplied by the test host */ }
    disconnect() { disconnected(); }
  });
  vi.stubGlobal('matchMedia', () => ({
    matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(),
  }));
  Object.defineProperty(document, 'hidden', { configurable: true, value: false });
  document.body.innerHTML = '';
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function advanceBoot() {
  for (let step = 0; step < 2; step++) {
    const callbacks = frames.splice(0);
    callbacks.forEach((callback) => callback(step * 16));
  }
  await vi.runAllTimersAsync();
}

describe('procedural startup splash', () => {
  it('shows the app version under the wordmark and keeps progress in the footer', async () => {
    const { mountSplash } = await import('../src/splash/controller.js');
    const host = document.createElement('div');
    document.body.append(host);
    const splash = mountSplash(host, { version: '2.9.11' }, async () => { throw new Error('No GPU'); });
    expect(host.querySelector('.prism-name + .prism-version')?.textContent).toBe('v2.9.11');
    expect(host.querySelector('.prism-footer .prism-status')).not.toBeNull();
    expect(host.querySelector('.prism-footer .prism-track')).not.toBeNull();
    splash.destroy();
  });

  it('shows a second line under the version only in development mode', async () => {
    const { mountSplash } = await import('../src/splash/controller.js');
    const host = document.createElement('div');
    document.body.append(host);
    const devSplash = mountSplash(host, { version: '2.9.11', development: true }, async () => { throw new Error('No GPU'); });
    expect(host.querySelector('.prism-version + .prism-development')?.textContent).toBe('Development mode');
    devSplash.destroy();

    const productionSplash = mountSplash(host, { version: '2.9.11', development: false }, async () => { throw new Error('No GPU'); });
    expect(host.querySelector('.prism-development')).toBeNull();
    productionSplash.destroy();
  });

  it('keeps fallback and progress usable before and after GPU setup, then disposes', async () => {
    const { mountSplash } = await import('../src/splash/controller.js');
    const host = document.createElement('div');
    document.body.append(host);
    let resolveRenderer!: (value: { backend: string; resize: ReturnType<typeof vi.fn>; render: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn> }) => void;
    const renderer = { backend: 'vgpu', resize: vi.fn(), render: vi.fn(), destroy: vi.fn() };
    const factory = vi.fn(() => new Promise<typeof renderer>((resolve) => { resolveRenderer = resolve; }));
    const splash = mountSplash(host, {}, factory);
    expect(host.querySelector('.prism-fallback')).not.toBeNull();
    expect(host.querySelector('.prism-splash')?.getAttribute('data-rendered')).not.toBe('true');
    splash.updateStartup({ status: 'Opening library', progress: 42 });
    expect(host.querySelector('.prism-status')?.textContent).toBe('Opening library');
    expect(host.querySelector('.prism-track')?.getAttribute('aria-valuenow')).toBe('42');
    await advanceBoot();
    expect(factory).toHaveBeenCalledOnce();
    resolveRenderer(renderer);
    await Promise.resolve();
    await Promise.resolve();
    expect(await splash.ready).toBe(true);
    splash.updateStartup({ status: 'Preparing mLearn', progress: 90 });
    expect(host.querySelector('.prism-status')?.textContent).toBe('Preparing mLearn');
    expect(host.querySelector('.prism-track')?.getAttribute('aria-valuenow')).toBe('90');
    splash.destroy();
    expect(renderer.destroy).toHaveBeenCalledOnce();
    expect(disconnected).toHaveBeenCalledOnce();
    expect(host.querySelector('.prism-splash')).toBeNull();
  });

  it('keeps the static scene and startup bridge when WebGPU setup fails', async () => {
    const { mountSplash } = await import('../src/splash/controller.js');
    const host = document.createElement('div');
    document.body.append(host);
    const splash = mountSplash(host, {}, async () => { throw new Error('WebGPU unavailable'); });
    await advanceBoot();
    expect(await splash.ready).toBe(false);
    expect(splash.diagnostics.backend).toBe('static');
    expect(host.querySelector('.prism-fallback')).not.toBeNull();
    splash.updateStartup({ status: 'Checking records', progress: 65 });
    splash.updateStartup({ progress: 20 });
    expect(host.querySelector('.prism-status')?.textContent).toBe('Checking records');
    expect(host.querySelector('.prism-track')?.getAttribute('aria-valuenow')).toBe('65');
    splash.destroy();
  });

  it('renders one still frame and does not animate under reduced motion', async () => {
    vi.stubGlobal('matchMedia', () => ({
      matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    }));
    const { mountSplash } = await import('../src/splash/controller.js');
    const host = document.createElement('div');
    document.body.append(host);
    const renderer = { backend: 'vgpu', resize: vi.fn(), render: vi.fn(), destroy: vi.fn() };
    const splash = mountSplash(host, {}, async () => renderer);
    await advanceBoot();
    expect(await splash.ready).toBe(true);
    expect(splash.diagnostics.reducedMotion).toBe(true);
    expect(splash.diagnostics.time).toBe(0);
    expect(renderer.render).toHaveBeenCalledOnce();
    splash.destroy();
  });

  it('advances scene time while visible and stops submitting frames when hidden', async () => {
    const { mountSplash } = await import('../src/splash/controller.js');
    const host = document.createElement('div');
    document.body.append(host);
    const renderer = { backend: 'vgpu', resize: vi.fn(), render: vi.fn(), destroy: vi.fn() };
    const splash = mountSplash(host, {}, async () => renderer);
    await advanceBoot();
    expect(await splash.ready).toBe(true);
    for (const now of [100, 133, 166]) {
      const callbacks = frames.splice(0);
      callbacks.forEach(callback => callback(now));
    }
    expect(renderer.render.mock.lastCall?.[0].time).toBeGreaterThan(0);
    const renderCount = renderer.render.mock.calls.length;
    const sceneTime = splash.diagnostics.time;
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
    frames.splice(0).forEach(callback => callback(200));
    expect(renderer.render).toHaveBeenCalledTimes(renderCount);
    expect(splash.diagnostics.time).toBe(sceneTime);
    splash.destroy();
  });

  it('releases a GPU renderer that resolves after the splash is closed', async () => {
    const { mountSplash } = await import('../src/splash/controller.js');
    const host = document.createElement('div');
    document.body.append(host);
    const renderer = { backend: 'vgpu', resize: vi.fn(), render: vi.fn(), destroy: vi.fn() };
    let resolveRenderer!: (value: typeof renderer) => void;
    const splash = mountSplash(host, {}, () => new Promise<typeof renderer>((resolve) => { resolveRenderer = resolve; }));
    await advanceBoot();
    splash.destroy();
    resolveRenderer(renderer);
    await Promise.resolve();
    await Promise.resolve();
    expect(await splash.ready).toBe(false);
    expect(renderer.destroy).toHaveBeenCalledOnce();
  });

  it('restores the fallback and progress bridge after device loss', async () => {
    const { mountSplash } = await import('../src/splash/controller.js');
    const host = document.createElement('div');
    document.body.append(host);
    const renderer = { backend: 'vgpu', resize: vi.fn(), render: vi.fn(), destroy: vi.fn() };
    let deviceError!: (error: Error) => void;
    const splash = mountSplash(host, {}, async (_canvas: HTMLCanvasElement, options: { onDeviceError: (error: Error) => void }) => {
      deviceError = options.onDeviceError;
      return renderer;
    });
    await advanceBoot();
    expect(await splash.ready).toBe(true);
    deviceError(new Error('Device lost'));
    expect(splash.diagnostics.backend).toBe('static');
    expect(host.querySelector('.prism-splash')?.getAttribute('data-rendered')).toBe('false');
    expect(renderer.destroy).toHaveBeenCalledOnce();
    splash.updateStartup({ status: 'Loading library', progress: 88 });
    expect(host.querySelector('.prism-track')?.getAttribute('aria-valuenow')).toBe('88');
    splash.destroy();
  });

  it('turns pointer motion into a small smoothed camera input', async () => {
    const { mountSplash } = await import('../src/splash/controller.js');
    const host = document.createElement('div');
    document.body.append(host);
    const renderer = { backend: 'vgpu', resize: vi.fn(), render: vi.fn(), destroy: vi.fn() };
    const splash = mountSplash(host, {}, async () => renderer);
    const root = host.querySelector('.prism-splash') as HTMLElement;
    vi.spyOn(root, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 0, width: 560, height: 310,
    } as DOMRect);
    await advanceBoot();
    expect(await splash.ready).toBe(true);
    root.dispatchEvent(new PointerEvent('pointermove', { clientX: 420, clientY: 155 }));
    for (const now of [16, 32, 48]) {
      const callbacks = frames.splice(0);
      callbacks.forEach(callback => callback(now));
    }
    const pointer = renderer.render.mock.lastCall?.[0].pointer as number[];
    expect(pointer[0]).toBeGreaterThan(0);
    expect(pointer[0]).toBeLessThan(0.1);
    splash.destroy();
  });
});

describe('splash render size policy', () => {
  it('caps Retina DPR at 2 and bounds larger surfaces by the pixel budget', async () => {
    const { renderSize } = await import('../src/splash/policy.js');
    expect(renderSize(560, 310, 3)).toEqual({ width: 1120, height: 620, dpr: 2 });
    const large = renderSize(1920, 1080, 3);
    expect(large.width * large.height).toBeLessThanOrEqual(1_200_000);
    expect(large.width / large.height).toBeCloseTo(1920 / 1080, 2);
  });
});
