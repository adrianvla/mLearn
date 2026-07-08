import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClient, TOKEN_KEY } from './client';

describe('ApiClient', () => {
  const storage = new Map<string, string>();

  beforeEach(() => {
    storage.clear();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      clear: () => storage.clear(),
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ ok: true }),
        }),
      ),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends the stored admin token as a bearer token', async () => {
    storage.set(TOKEN_KEY, 'admin-token');
    const client = new ApiClient();

    await client.getOverview();

    expect(fetch).toHaveBeenCalledWith('/api/overview', {
      headers: { Authorization: 'Bearer admin-token' },
    });
  });

  it('uses the backend service action route', async () => {
    const client = new ApiClient();

    await client.performAction('api', 'restart');

    expect(fetch).toHaveBeenCalledWith('/api/services/api/restart', {
      method: 'POST',
      headers: {},
    });
  });
});
