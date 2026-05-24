import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockFetch, mockChrome } = vi.hoisted(() => {
  const fetch = vi.fn((_url: string, init?: { signal?: AbortSignal }) => {
    return new Promise<Response>((resolve, reject) => {
      if (init?.signal?.aborted) {
        reject(new DOMException('AbortError', 'AbortError'));
        return;
      }
      const onAbort = () => {
        reject(new DOMException('AbortError', 'AbortError'));
      };
      init?.signal?.addEventListener('abort', onAbort, { once: true });
    });
  });
  const chrome = {
    alarms: {
      onAlarm: { addListener: vi.fn(), removeListener: vi.fn() },
      create: vi.fn(),
      clear: vi.fn().mockResolvedValue(undefined),
    },
    runtime: {
      onMessage: { addListener: vi.fn() },
      sendMessage: vi.fn().mockReturnValue(Promise.resolve()),
    },
    tabs: {
      onActivated: { addListener: vi.fn() },
      query: vi.fn().mockResolvedValue([]),
      sendMessage: vi.fn().mockReturnValue(Promise.resolve()),
      get: vi.fn(),
    },
    storage: {
      local: {
        get: vi.fn().mockResolvedValue({}),
        set: vi.fn().mockResolvedValue({}),
      },
    },
    windows: {
      get: vi.fn(),
    },
  };
  return { mockFetch: fetch, mockChrome: chrome };
});

vi.stubGlobal('fetch', mockFetch);
vi.stubGlobal('chrome', mockChrome);

const {
  fetchWithTimeout,
  fetchAuthTokenFromDesktop,
  initHeadlessMode,
  cleanupServiceWorker,
} = await import('./background');

describe('fetchWithTimeout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('resolves when fetch is fast', async () => {
    mockFetch.mockResolvedValue(new Response('ok', { status: 200 }));
    const r = await fetchWithTimeout('http://test', {}, 100);
    expect(r.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledWith(
      'http://test',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('rejects with Timeout AbortError when fetch hangs', async () => {
    mockFetch.mockImplementation((_url: string, init?: { signal?: AbortSignal }) => {
      return new Promise<Response>((resolve, reject) => {
        if (init?.signal?.aborted) {
          reject(new DOMException('AbortError', 'AbortError'));
          return;
        }
        const onAbort = () => {
          reject(new DOMException('AbortError', 'AbortError'));
        };
        init?.signal?.addEventListener('abort', onAbort, { once: true });
      });
    });
    await expect(fetchWithTimeout('http://test', {}, 10)).rejects.toThrow(
      'AbortError',
    );
  });

  it('respects an external AbortSignal', async () => {
    mockFetch.mockImplementation((_url: string, init?: { signal?: AbortSignal }) => {
      return new Promise<Response>((resolve, reject) => {
        if (init?.signal?.aborted) {
          reject(new DOMException('AbortError', 'AbortError'));
          return;
        }
        const onAbort = () => {
          reject(new DOMException('AbortError', 'AbortError'));
        };
        init?.signal?.addEventListener('abort', onAbort, { once: true });
      });
    });
    const ctrl = new AbortController();
    const p = fetchWithTimeout('http://test', { signal: ctrl.signal }, 1000);
    ctrl.abort();
    await expect(p).rejects.toThrow();
  });

  it('passes through method, headers, and body', async () => {
    mockFetch.mockResolvedValue(new Response('ok', { status: 200 }));
    await fetchWithTimeout('http://test', {
      method: 'POST',
      body: '{"x":1}',
      headers: { 'X-Custom': '1' },
    });
    expect(mockFetch).toHaveBeenCalledWith(
      'http://test',
      expect.objectContaining({
        method: 'POST',
        body: '{"x":1}',
        headers: { 'X-Custom': '1' },
      }),
    );
  });
});

describe('fetchAuthTokenFromDesktop', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('logs error on non-ok response', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockFetch.mockResolvedValue(
      new Response('fail', { status: 500, statusText: 'Server Error' }),
    );
    await fetchAuthTokenFromDesktop();
    expect(spy).toHaveBeenCalledWith(
      '[mLearn Background] fetchAuthTokenFromDesktop failed:',
      500,
      'Server Error',
    );
    spy.mockRestore();
  });

  it('logs error on network failure', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));
    await fetchAuthTokenFromDesktop();
    expect(spy).toHaveBeenCalledWith(
      '[mLearn Background] fetchAuthTokenFromDesktop error:',
      'ECONNREFUSED',
    );
    spy.mockRestore();
  });
});

describe('initHeadlessMode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cleanupServiceWorker();
  });

  it('notifies content scripts when headless is enabled and disconnected', async () => {
    vi.mocked(mockChrome.storage.local.get).mockResolvedValue({
      'mlearn-headless-mode': 'enabled',
    });
    vi.mocked(mockChrome.tabs.query).mockResolvedValue([{ id: 1 }]);
    await initHeadlessMode();
    expect(mockChrome.tabs.query).toHaveBeenCalled();
    expect(mockChrome.tabs.sendMessage).toHaveBeenCalledWith(
      expect.any(Number),
      expect.objectContaining({ type: 'HEADLESS_STATE_CHANGED', enabled: true }),
    );
  });

  it('does not notify when headless is disabled', async () => {
    vi.mocked(mockChrome.storage.local.get).mockResolvedValue({
      'mlearn-headless-mode': 'disabled',
    });
    await initHeadlessMode();
    expect(mockChrome.tabs.sendMessage).not.toHaveBeenCalled();
  });
});
