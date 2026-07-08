import { ApiClient, ApiError, AuthError } from './client';

const fetchMock = vi.fn<typeof fetch>();

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('ApiClient', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('includes Authorization header when token is set', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, []));
    const client = new ApiClient('https://admin.example', () => 'token-123');

    await client.getServices();

    expect(vi.mocked(fetch)).toHaveBeenCalledWith('https://admin.example/api/services', {
      headers: { Authorization: 'Bearer token-123' },
    });
  });

  it('omits Authorization header without a token', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, []));
    const client = new ApiClient('', () => null);

    await client.getServices();

    expect(vi.mocked(fetch)).toHaveBeenCalledWith('/api/services', {
      headers: {},
    });
  });

  it('throws AuthError on 401 responses', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(401, { error: 'Unauthorized' }));
    const client = new ApiClient('', () => null);

    await expect(client.getOverview()).rejects.toBeInstanceOf(AuthError);
  });

  it('throws ApiError with status on non-2xx responses', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(500, { error: 'Docker unavailable' }));
    const client = new ApiClient('', () => null);

    await expect(client.getOverview()).rejects.toMatchObject({
      name: 'ApiError',
      status: 500,
      message: 'Docker unavailable',
    } satisfies Partial<ApiError>);
  });

  it('returns parsed JSON on 200 responses', async () => {
    const overview = {
      version: '1.0.0',
      mlearn_version: '2.0.0',
      deployment_mode: 'local-only',
      docker_available: true,
      docker_error: null,
      compose_project: 'mlearn',
      service_count: { total: 1, running: 1, stopped: 0, error: 0 },
      exposed_ports: [],
      health: { healthy: 1, unhealthy: 0, starting: 0, none: 0 },
      management_auth_enabled: true,
      cloud_features_enabled: false,
    };
    fetchMock.mockResolvedValueOnce(jsonResponse(200, overview));
    const client = new ApiClient('', () => null);

    await expect(client.getOverview()).resolves.toEqual(overview);
  });

  it('performs service actions with POST', async () => {
    const response = { id: 'api', action: 'restart', status: 'running' };
    fetchMock.mockResolvedValueOnce(jsonResponse(200, response));
    const client = new ApiClient('', () => 'token-123');

    await expect(client.performAction('api', 'restart')).resolves.toEqual(response);
    expect(vi.mocked(fetch)).toHaveBeenCalledWith('/api/services/api/actions/restart', {
      method: 'POST',
      headers: { Authorization: 'Bearer token-123' },
    });
  });

  it('requests logs with optional tail query', async () => {
    const logs = { service_id: 'api', lines: [], truncated: false };
    fetchMock.mockResolvedValueOnce(jsonResponse(200, logs));
    const client = new ApiClient('', () => null);

    await expect(client.getLogs('api', 50)).resolves.toEqual(logs);
    expect(vi.mocked(fetch)).toHaveBeenCalledWith('/api/services/api/logs?tail=50', {
      headers: {},
    });
  });
});
