import { DEFAULT_CLOUD_ENDPOINT } from '../../shared/backends';
import type { Settings } from '../../shared/types';

export interface CloudLoginRequest {
  state: string;
  codeVerifier: string;
  loginUrl: string;
}

export interface CloudExchangeResult {
  accessToken: string;
  refreshToken: string;
  userId: string;
  userEmail: string;
}

function getAuthBaseUrl(settings: Settings): string {
  return (settings.overrideCloudEndpointUrl ? settings.backendUrl : DEFAULT_CLOUD_ENDPOINT).replace(/\/+$/, '');
}

function randomUrlSafeString(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function computeS256Challenge(verifier: string): Promise<string> {
  const data = new TextEncoder().encode(verifier);
  const hash = await crypto.subtle.digest('SHA-256', data);
  const bytes = new Uint8Array(hash);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export async function startCloudDesktopLogin(settings: Settings): Promise<CloudLoginRequest> {
  const state = randomUrlSafeString(24);
  const codeVerifier = randomUrlSafeString(64);
  const codeChallenge = await computeS256Challenge(codeVerifier);

  const response = await fetch(`${getAuthBaseUrl(settings)}/api/auth/desktop/init`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      state,
      codeChallenge,
      codeChallengeMethod: 'S256',
    }),
  });

  const payload = (await response.json().catch(() => ({}))) as { loginUrl?: string; error?: string };
  if (!response.ok || !payload.loginUrl) {
    throw new Error(payload.error || `Desktop login init failed: ${response.status}`);
  }

  return {
    state,
    codeVerifier,
    loginUrl: payload.loginUrl,
  };
}

export async function exchangeCloudDesktopCode(
  settings: Settings,
  code: string,
  codeVerifier: string,
): Promise<CloudExchangeResult> {
  const response = await fetch(`${getAuthBaseUrl(settings)}/api/auth/desktop/exchange`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, codeVerifier }),
  });
  const payload = (await response.json().catch(() => ({}))) as {
    session?: { accessToken?: string; refreshToken?: string };
    user?: { id?: string; email?: string | null };
    error?: string;
  };

  if (!response.ok || !payload.session?.accessToken || !payload.session.refreshToken || !payload.user?.id) {
    throw new Error(payload.error || `Desktop login exchange failed: ${response.status}`);
  }

  return {
    accessToken: payload.session.accessToken,
    refreshToken: payload.session.refreshToken,
    userId: payload.user.id,
    userEmail: payload.user.email || '',
  };
}

export async function refreshCloudSession(settings: Settings): Promise<{ accessToken: string; refreshToken: string; expiresAt?: number }> {
  const refreshToken = settings.cloudAuthRefreshToken;
  if (!refreshToken) {
    throw new Error('Missing cloud refresh token');
  }

  const response = await fetch(`${getAuthBaseUrl(settings)}/api/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  });
  const payload = (await response.json().catch(() => ({}))) as {
    session?: { accessToken?: string; refreshToken?: string; expiresAt?: number };
    error?: string;
  };

  if (!response.ok || !payload.session?.accessToken || !payload.session.refreshToken) {
    throw new Error(payload.error || `Session refresh failed: ${response.status}`);
  }

  return {
    accessToken: payload.session.accessToken,
    refreshToken: payload.session.refreshToken,
    expiresAt: payload.session.expiresAt,
  };
}

export function getCloudDashboardUrl(settings: Settings): string {
  return `${getAuthBaseUrl(settings)}/dashboard`;
}
