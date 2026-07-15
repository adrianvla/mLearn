/**
 * Backend Adapter Factory
 *
 * Creates the appropriate BackendAdapter based on settings.
 * Cached per base URL — call `resetBackend()` when settings change.
 */

import { PYTHON_BACKEND_PORT, PROXY_SERVER_PORT, DEFAULT_CLOUD_LOGIN_URL, DEFAULT_CLOUD_API_URL } from '../constants';
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

/**
 * mLearn's legal acceptance applies only to mLearn-hosted cloud services.
 * A custom provider owns its own legal and consent flow.
 */
export function requiresFirstPartyCloudLegalConsent(settings: CloudUrlSettings): boolean {
  return resolveCloudLoginUrl(settings) === DEFAULT_CLOUD_LOGIN_URL
    && resolveCloudApiUrl(settings) === DEFAULT_CLOUD_API_URL;
}

let cached: BackendAdapter | null = null;
let cachedKey = '';

function isViteDevRendererOrigin(): boolean {
  const location = globalThis.location;
  if (!location) return false;
  return location.protocol === 'http:'
    && (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
    && location.port === '3000';
}

function isLocalPythonBackendUrl(userUrl?: string): boolean {
  if (!userUrl) return false;
  try {
    const parsed = new URL(userUrl);
    return (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1')
      && parsed.port === String(PYTHON_BACKEND_PORT);
  } catch {
    return false;
  }
}

/**
 * Build the base URL for a given backend mode and optional user URL.
 */
function resolveBaseUrl(mode: BackendMode, userUrl?: string): string {
  if (isViteDevRendererOrigin() && (mode === 'local' || isLocalPythonBackendUrl(userUrl))) {
    return '';
  }

  switch (mode) {
    case 'tethered':
      return userUrl?.replace(/\/+$/, '') || `http://127.0.0.1:${PYTHON_BACKEND_PORT}`;
    case 'local':
    default:
      return `http://127.0.0.1:${PYTHON_BACKEND_PORT}`;
  }
}

function resolveAnkiBaseUrl(mode: BackendMode, userUrl?: string): string {
  if (mode === 'tethered' && userUrl) {
    const trimmed = userUrl.replace(/\/+$/, '');
    try {
      const parsed = new URL(trimmed);
      parsed.port = String(PROXY_SERVER_PORT);
      return parsed.toString().replace(/\/+$/, '');
    } catch {
      return trimmed;
    }
  }
  return `http://127.0.0.1:${PROXY_SERVER_PORT}`;
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
  const ankiBaseUrl = resolveAnkiBaseUrl(mode, opts.url);
  const authToken = opts.authToken || '';
  const key = `${baseUrl}::${ankiBaseUrl}::${authToken}`;

  if (cached && cachedKey === key) return cached;

  cached = new HttpBackend(baseUrl, {
    authToken: authToken || undefined,
    ankiBaseUrl,
  });
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
