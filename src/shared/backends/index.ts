/**
 * Backend Adapter Factory
 *
 * Creates the appropriate BackendAdapter based on settings.
 * Cached per base URL — call `resetBackend()` when settings change.
 */

import { PYTHON_BACKEND_PORT, DEFAULT_CLOUD_LOGIN_URL, DEFAULT_CLOUD_API_URL } from '../constants';
import type { BackendAdapter, BackendMode } from './types';
import { HttpBackend } from './httpBackend';

export { CloudOCRAdapter } from './cloudOCRAdapter';
export { DEFAULT_CLOUD_LOGIN_URL, DEFAULT_CLOUD_API_URL };

interface CloudUrlSettings {
  overrideCloudEndpointUrl?: boolean;
  cloudLoginUrl?: string;
  cloudApiUrl?: string;
}

/** Resolve the cloud login/website URL from settings */
export function resolveCloudLoginUrl(settings: CloudUrlSettings): string {
  const url = settings.overrideCloudEndpointUrl && settings.cloudLoginUrl
    ? settings.cloudLoginUrl : DEFAULT_CLOUD_LOGIN_URL;
  return url.replace(/\/+$/, '');
}

/** Resolve the cloud API URL from settings */
export function resolveCloudApiUrl(settings: CloudUrlSettings): string {
  const url = settings.overrideCloudEndpointUrl && settings.cloudApiUrl
    ? settings.cloudApiUrl : DEFAULT_CLOUD_API_URL;
  return url.replace(/\/+$/, '');
}

let cached: BackendAdapter | null = null;
let cachedKey = '';

/**
 * Build the base URL for a given backend mode and optional user URL.
 */
function resolveBaseUrl(mode: BackendMode, userUrl?: string): string {
  switch (mode) {
    case 'tethered':
      return userUrl?.replace(/\/+$/, '') || `http://127.0.0.1:${PYTHON_BACKEND_PORT}`;
    case 'local':
    default:
      return `http://127.0.0.1:${PYTHON_BACKEND_PORT}`;
  }
}

export interface GetBackendOptions {
  mode?: BackendMode;
  url?: string;
  authToken?: string;
}

/**
 * Get (or create) the backend adapter singleton.
 *
 * Call with settings values:
 * ```ts
 * const backend = getBackend({
 *   mode: settings.backendMode,
 *   url: settings.backendUrl,
 *   authToken: settings.cloudAuthToken,
 * });
 * ```
 */
export function getBackend(opts: GetBackendOptions = {}): BackendAdapter {
  const mode = opts.mode || 'local';
  const baseUrl = resolveBaseUrl(mode, opts.url);
  const authToken = opts.authToken || '';
  const key = `${baseUrl}::${authToken}`;

  if (cached && cachedKey === key) return cached;

  cached = new HttpBackend(baseUrl, { authToken: authToken || undefined });
  cachedKey = key;
  return cached;
}

/**
 * Reset the cached backend adapter (e.g. when settings change).
 */
export function resetBackend(): void {
  cached = null;
  cachedKey = '';
}
