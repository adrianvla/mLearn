import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { configureBackend, getBackend, resetBackend, resolveCloudLoginUrl, resolveCloudApiUrl, requiresFirstPartyCloudLegalConsent } from './index';
import { HttpBackend } from './httpBackend';
import { PYTHON_BACKEND_PORT, PROXY_SERVER_PORT, DEFAULT_CLOUD_LOGIN_URL, DEFAULT_CLOUD_API_URL } from '../constants';

function expectHttpBackend(backend: ReturnType<typeof getBackend>): HttpBackend {
  expect(backend).toBeInstanceOf(HttpBackend);
  return backend as HttpBackend;
}

describe('getBackend', () => {
  beforeEach(() => {
    vi.stubGlobal('location', {
      protocol: 'http:',
      hostname: 'localhost',
      port: '3000',
    });
    resetBackend();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses the same-origin Vite proxy for local default backend calls in the dev renderer', () => {
    const backend = expectHttpBackend(getBackend());
    expect(backend.getBaseUrl()).toBe('');
    expect(backend.getAnkiBaseUrl()).toBe(`http://127.0.0.1:${PROXY_SERVER_PORT}`);
  });

  it('uses the same-origin Vite proxy for local backend calls in the dev renderer', () => {
    const backend = expectHttpBackend(getBackend({ mode: 'local' }));
    expect(backend.getBaseUrl()).toBe('');
  });

  it('uses the same-origin Vite proxy for a saved local Python URL in the dev renderer', () => {
    const backend = expectHttpBackend(getBackend({
      mode: 'tethered',
      url: `http://127.0.0.1:${PYTHON_BACKEND_PORT}`,
    }));

    expect(backend.getBaseUrl()).toBe('');
  });

  it('keeps real tethered URLs direct in the dev renderer', () => {
    const backend = expectHttpBackend(getBackend({
      mode: 'tethered',
      url: `http://192.168.1.10:${PYTHON_BACKEND_PORT}`,
    }));

    expect(backend.getBaseUrl()).toBe(`http://192.168.1.10:${PYTHON_BACKEND_PORT}`);
  });

  it('returns the direct local Python URL outside the dev renderer', () => {
    vi.stubGlobal('location', {
      protocol: 'file:',
      hostname: '',
      port: '',
    });

    const backend = expectHttpBackend(getBackend({ mode: 'local' }));

    expect(backend.getBaseUrl()).toBe(`http://127.0.0.1:${PYTHON_BACKEND_PORT}`);
    expect(backend.getAnkiBaseUrl()).toBe(`http://127.0.0.1:${PROXY_SERVER_PORT}`);
  });

  it('returns HttpBackend with provided URL in tethered mode', () => {
    const backend = expectHttpBackend(getBackend({ mode: 'tethered', url: 'http://192.168.1.10:7752' }));
    expect(backend.getBaseUrl()).toBe('http://192.168.1.10:7752');
    expect(backend.getAnkiBaseUrl()).toBe('http://192.168.1.10:7753');
  });

  it('uses provided node server URL for both backend and Anki when tethered URL targets 7753', () => {
    const backend = expectHttpBackend(getBackend({ mode: 'tethered', url: 'http://192.168.1.10:7753' }));
    expect(backend.getBaseUrl()).toBe('http://192.168.1.10:7753');
    expect(backend.getAnkiBaseUrl()).toBe('http://192.168.1.10:7753');
  });

  it('falls back to default local URL in tethered mode when no url provided', () => {
    const backend = expectHttpBackend(getBackend({ mode: 'tethered' }));
    expect(backend.getBaseUrl()).toBe(`http://127.0.0.1:${PYTHON_BACKEND_PORT}`);
  });

  it('strips trailing slash from tethered URL', () => {
    const backend = expectHttpBackend(getBackend({ mode: 'tethered', url: 'http://192.168.1.10:7752/' }));
    expect(backend.getBaseUrl()).toBe('http://192.168.1.10:7752');
  });

  it('returns cached instance when called again with same options', () => {
    const first = getBackend({ mode: 'local' });
    const second = getBackend({ mode: 'local' });
    expect(first).toBe(second);
  });

  it('creates a new instance when URL is different', () => {
    const first = getBackend({ mode: 'tethered', url: 'http://192.168.1.10:7752' });
    const second = getBackend({ mode: 'tethered', url: 'http://192.168.1.20:7752' });
    expect(first).not.toBe(second);
  });

  it('creates a new instance when backendToken is different', () => {
    const first = getBackend({ mode: 'local', backendToken: 'token-a' });
    const second = getBackend({ mode: 'local', backendToken: 'token-b' });
    expect(first).not.toBe(second);
  });

  it('returns the configured backend for bare getBackend() calls', () => {
    const configured = getBackend({ mode: 'local', backendToken: 'token-x' });
    const bare = getBackend();
    expect(bare).toBe(configured);
  });

  it('creates a new backend after resetBackend()', () => {
    const first = getBackend({ mode: 'local', backendToken: 'token-x' });
    resetBackend();
    const bare = getBackend();
    expect(bare).not.toBe(first);
  });
});

describe('resetBackend', () => {
  it('clears the cache so getBackend creates a new instance', () => {
    const first = getBackend({ mode: 'local' });
    resetBackend();
    const second = getBackend({ mode: 'local' });
    expect(first).not.toBe(second);
  });
});

describe('resolveCloudLoginUrl', () => {
  it('returns DEFAULT_CLOUD_LOGIN_URL when overrideCloudEndpointUrl is false', () => {
    expect(resolveCloudLoginUrl({ overrideCloudEndpointUrl: false })).toBe(DEFAULT_CLOUD_LOGIN_URL);
  });

  it('returns DEFAULT_CLOUD_LOGIN_URL when overrideCloudEndpointUrl is not set', () => {
    expect(resolveCloudLoginUrl({})).toBe(DEFAULT_CLOUD_LOGIN_URL);
  });

  it('returns custom URL when overrideCloudEndpointUrl is true and cloudLoginUrl is set', () => {
    expect(
      resolveCloudLoginUrl({ overrideCloudEndpointUrl: true, cloudLoginUrl: 'https://my-server.example.com' })
    ).toBe('https://my-server.example.com');
  });

  it('strips trailing slash from custom URL', () => {
    expect(
      resolveCloudLoginUrl({ overrideCloudEndpointUrl: true, cloudLoginUrl: 'https://my-server.example.com/' })
    ).toBe('https://my-server.example.com');
  });

  it('returns DEFAULT_CLOUD_LOGIN_URL when overrideCloudEndpointUrl is true but cloudLoginUrl is not set', () => {
    expect(resolveCloudLoginUrl({ overrideCloudEndpointUrl: true })).toBe(DEFAULT_CLOUD_LOGIN_URL);
  });
});

describe('resolveCloudApiUrl', () => {
  it('returns DEFAULT_CLOUD_API_URL when overrideCloudEndpointUrl is false', () => {
    expect(resolveCloudApiUrl({ overrideCloudEndpointUrl: false })).toBe(DEFAULT_CLOUD_API_URL);
  });

  it('returns DEFAULT_CLOUD_API_URL when overrideCloudEndpointUrl is not set', () => {
    expect(resolveCloudApiUrl({})).toBe(DEFAULT_CLOUD_API_URL);
  });

  it('returns custom URL when overrideCloudEndpointUrl is true and cloudApiUrl is set', () => {
    expect(
      resolveCloudApiUrl({ overrideCloudEndpointUrl: true, cloudApiUrl: 'https://api.my-server.example.com' })
    ).toBe('https://api.my-server.example.com');
  });

  it('strips trailing slash from custom API URL', () => {
    expect(
      resolveCloudApiUrl({ overrideCloudEndpointUrl: true, cloudApiUrl: 'https://api.my-server.example.com/' })
    ).toBe('https://api.my-server.example.com');
  });

  it('returns DEFAULT_CLOUD_API_URL when overrideCloudEndpointUrl is true but cloudApiUrl is not set', () => {
    expect(resolveCloudApiUrl({ overrideCloudEndpointUrl: true })).toBe(DEFAULT_CLOUD_API_URL);
  });
});

describe('requiresFirstPartyCloudLegalConsent', () => {
  it('requires mLearn legal consent when the resolved cloud API is first-party', () => {
    expect(requiresFirstPartyCloudLegalConsent({ overrideCloudEndpointUrl: false })).toBe(true);
  });

  it('does not apply mLearn legal consent to a custom cloud API', () => {
    expect(requiresFirstPartyCloudLegalConsent({
      overrideCloudEndpointUrl: true,
      cloudApiUrl: 'https://cloud.example.com',
    })).toBe(false);
  });
});


describe('paired tethered Anki credentials', () => {
  const pairedNode = 'http://192.168.1.10:7753';
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ cards: [] }), { status: 200 }));
  beforeEach(() => {
    resetBackend();
    localStorage.setItem('mlearn-node-server-url', pairedNode);
    localStorage.setItem('mlearn-node-server-token', 'paired-token');
    fetchMock.mockClear();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    localStorage.removeItem('mlearn-node-server-url');
    localStorage.removeItem('mlearn-node-server-token');
    resetBackend();
    vi.unstubAllGlobals();
  });

  it('authenticates the real configured HttpBackend Anki request for the paired desktop', async () => {
    configureBackend({ mode: 'tethered', url: 'http://192.168.1.10:7752', backendToken: 'python-token' });
    await getBackend().getCard({ word: 'word' });
    expect(fetchMock).toHaveBeenCalledWith(`${pairedNode}/api/anki/card`, expect.objectContaining({
      headers: { 'Content-Type': 'application/json', 'X-Auth-Token': 'paired-token' },
    }));
  });

  it('refreshes and clears cached inferred credentials when pairing changes', async () => {
    configureBackend({ mode: 'tethered', url: 'http://192.168.1.10:7752' });
    localStorage.setItem('mlearn-node-server-token', 'rotated-token');
    await getBackend().getCard({ word: 'word' });
    expect(fetchMock).toHaveBeenLastCalledWith(`${pairedNode}/api/anki/card`, expect.objectContaining({
      headers: expect.objectContaining({ 'X-Auth-Token': 'rotated-token' }),
    }));
    localStorage.removeItem('mlearn-node-server-token');
    await getBackend().getCard({ word: 'word' });
    expect(fetchMock).toHaveBeenLastCalledWith(`${pairedNode}/api/anki/card`, expect.objectContaining({
      headers: { 'Content-Type': 'application/json' },
    }));
  });

  it('does not attach the saved pairing token to an unrelated tethered host', async () => {
    configureBackend({ mode: 'tethered', url: 'https://unrelated.example:7752' });
    await getBackend().getCard({ word: 'word' });
    expect(fetchMock).toHaveBeenCalledWith('https://unrelated.example:7753/api/anki/card', expect.objectContaining({
      headers: { 'Content-Type': 'application/json' },
    }));
  });

  it('preserves an explicit token override and an explicit empty token', async () => {
    configureBackend({ mode: 'tethered', url: 'http://192.168.1.10:7752', nodeAuthToken: 'explicit-token' });
    localStorage.setItem('mlearn-node-server-token', 'different-saved-token');
    await getBackend().getCard({ word: 'word' });
    expect(fetchMock).toHaveBeenLastCalledWith(`${pairedNode}/api/anki/card`, expect.objectContaining({
      headers: expect.objectContaining({ 'X-Auth-Token': 'explicit-token' }),
    }));
    configureBackend({ mode: 'tethered', url: 'http://192.168.1.10:7752', nodeAuthToken: '' });
    await getBackend().getCard({ word: 'word' });
    expect(fetchMock).toHaveBeenLastCalledWith(`${pairedNode}/api/anki/card`, expect.objectContaining({
      headers: { 'Content-Type': 'application/json' },
    }));
  });
});
