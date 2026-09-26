import { describe, expect, it, vi } from 'vitest';
import { PYTHON_BACKEND_PORT, PROXY_SERVER_PORT } from '../../../shared/constants';

vi.mock('../pythonBackend', () => ({ getQuitToken: () => null }));

import { backendAuthHeaders } from './utils';

describe('diagnostic backend authentication', () => {
  it('sends the per-run token only to the local Python backend', () => {
    const token = 'private-per-run-token';
    expect(backendAuthHeaders(`http://127.0.0.1:${PYTHON_BACKEND_PORT}/tokenize`, token))
      .toEqual({ Authorization: `Bearer ${token}` });
    expect(backendAuthHeaders(`http://127.0.0.1:${PROXY_SERVER_PORT}/`, token)).toEqual({});
    expect(backendAuthHeaders('https://mlearn-cloud.kikan.net/api/health', token)).toEqual({});
    expect(backendAuthHeaders(`http://127.0.0.1:${PYTHON_BACKEND_PORT}/ocr`, null)).toEqual({});
  });
});
