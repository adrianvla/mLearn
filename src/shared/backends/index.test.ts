import { describe, it, expect, beforeEach } from 'vitest';
import { getBackend, resetBackend, resolveCloudLoginUrl, resolveCloudApiUrl } from './index';
import { HttpBackend } from './httpBackend';
import { PYTHON_BACKEND_PORT, DEFAULT_CLOUD_LOGIN_URL, DEFAULT_CLOUD_API_URL } from '../constants';

function expectHttpBackend(backend: ReturnType<typeof getBackend>): HttpBackend {
  expect(backend).toBeInstanceOf(HttpBackend);
  return backend as HttpBackend;
}

describe('getBackend', () => {
  beforeEach(() => {
    resetBackend();
  });

  it('returns HttpBackend with local default URL when called with no options', () => {
    const backend = expectHttpBackend(getBackend());
    expect(backend.getBaseUrl()).toBe(`http://127.0.0.1:${PYTHON_BACKEND_PORT}`);
  });

  it('returns HttpBackend with local URL when mode is local', () => {
    const backend = expectHttpBackend(getBackend({ mode: 'local' }));
    expect(backend.getBaseUrl()).toBe(`http://127.0.0.1:${PYTHON_BACKEND_PORT}`);
  });

  it('returns HttpBackend with provided URL in tethered mode', () => {
    const backend = expectHttpBackend(getBackend({ mode: 'tethered', url: 'http://192.168.1.10:7752' }));
    expect(backend.getBaseUrl()).toBe('http://192.168.1.10:7752');
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

  it('creates a new instance when authToken is different', () => {
    const first = getBackend({ mode: 'local', authToken: 'token-a' });
    const second = getBackend({ mode: 'local', authToken: 'token-b' });
    expect(first).not.toBe(second);
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
