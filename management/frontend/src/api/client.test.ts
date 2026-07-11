import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTH_SIGNED_OUT_EVENT, ApiClient, createSessionStore } from './client';

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('ApiClient sessions', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', memoryStorage());
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it('stores session credentials outside localStorage', () => {
    const store = createSessionStore();
    store.set({ accessToken: 'access', refreshToken: 'refresh', expiresAt: 42 });

    expect(store.accessToken()).toBe('access');
    expect(sessionStorage.getItem('mlearn-management-session')).toContain('refresh');
    expect(localStorage.getItem('mlearn-management-session')).toBeNull();
  });

  it('single-flights concurrent refreshes and retries each request once', async () => {
    const store = createSessionStore();
    store.set({ accessToken: 'expired', refreshToken: 'refresh', expiresAt: 1 });
    let refreshes = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/api/auth/refresh')) {
        refreshes += 1;
        await Promise.resolve();
        return jsonResponse({ session: { accessToken: 'fresh', refreshToken: 'rotated', expiresAt: 2 } });
      }
      const authorization = init?.headers;
      const token = new Headers(authorization).get('Authorization');
      return token === 'Bearer fresh' ? jsonResponse({ ok: true }) : jsonResponse({ error: 'Unauthorized' }, 401);
    }));
    const api = new ApiClient('', store);

    await expect(Promise.all([api.get<{ ok: boolean }>('/one'), api.get<{ ok: boolean }>('/two')]))
      .resolves.toEqual([{ ok: true }, { ok: true }]);
    expect(refreshes).toBe(1);
  });

  it('preserves abort signals across the refresh retry', async () => {
    const store = createSessionStore();
    store.set({ accessToken: 'expired', refreshToken: 'refresh', expiresAt: 1 });
    const controller = new AbortController();
    const signals: (AbortSignal | null)[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('/api/auth/refresh')) {
        return jsonResponse({ session: { accessToken: 'fresh', refreshToken: 'rotated', expiresAt: 2 } });
      }
      signals.push(init?.signal ?? null);
      return signals.length === 1 ? jsonResponse({ error: 'Unauthorized' }, 401) : jsonResponse({ ok: true });
    }));

    await new ApiClient('', store).get('/resource', { signal: controller.signal });
    expect(signals).toEqual([controller.signal, controller.signal]);
  });

  it('throws structured errors and emits signed-out after the terminal 401', async () => {
    const store = createSessionStore();
    store.set({ accessToken: 'expired', refreshToken: 'refresh', expiresAt: 1 });
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) =>
      String(input).endsWith('/api/auth/refresh')
        ? jsonResponse({ session: { accessToken: 'fresh', refreshToken: 'rotated', expiresAt: 2 } })
        : jsonResponse({ error: 'still unauthorized' }, 401)));
    const signedOut = vi.fn();
    window.addEventListener(AUTH_SIGNED_OUT_EVENT, signedOut);

    await expect(new ApiClient('', store).get('/resource')).rejects.toMatchObject({
      name: 'ApiError', status: 401, message: 'still unauthorized', body: { error: 'still unauthorized' },
    });
    expect(signedOut).toHaveBeenCalledOnce();
    expect(store.accessToken()).toBeNull();
  });
});

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key); },
    setItem: (key, value) => { values.set(key, value); },
  };
}
