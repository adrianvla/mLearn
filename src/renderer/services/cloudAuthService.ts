import { resolveCloudApiUrl, resolveCloudLoginUrl } from '../../shared/backends';
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

/** Auth API calls go to the cloud API URL */
function getAuthApiUrl(settings: Settings): string {
  return resolveCloudApiUrl(settings);
}

/** Browser-facing pages (login, dashboard) go to the cloud login URL */
function getLoginSiteUrl(settings: Settings): string {
  return resolveCloudLoginUrl(settings);
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

  const response = await fetch(`${getAuthApiUrl(settings)}/api/auth/desktop/init`, {
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
  const response = await fetch(`${getAuthApiUrl(settings)}/api/auth/desktop/exchange`, {
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

  const response = await fetch(`${getAuthApiUrl(settings)}/api/auth/refresh`, {
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
  return `${getLoginSiteUrl(settings)}/dashboard`;
}

/**
 * Validate the current cloud access token by calling /api/auth/me.
 * Returns true if the token is valid (200), false otherwise.
 */
export async function validateCloudAccessToken(settings: Settings): Promise<boolean> {
  const accessToken = settings.cloudAuthAccessToken || settings.cloudAuthToken;
  if (!accessToken) return false;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);
    const response = await fetch(`${getAuthApiUrl(settings)}/api/auth/me`, {
      headers: { 'Authorization': `Bearer ${accessToken}` },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return response.ok;
  } catch (e) {
    console.error(e);
    return false;
  }
}

export interface CloudSessionValidation {
  status: 'valid' | 'refreshed' | 'expired';
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
}

/**
 * Validate the current session and attempt refresh if expired.
 * Returns whether the session is valid, was refreshed, or is fully expired
 * (meaning the user must re-authenticate).
 */
export async function validateAndRefreshCloudSession(settings: Settings): Promise<CloudSessionValidation> {
  // First, check if the current access token works
  const isValid = await validateCloudAccessToken(settings);
  if (isValid) return { status: 'valid' };

  // Access token invalid — try refreshing
  if (!settings.cloudAuthRefreshToken) {
    return { status: 'expired' };
  }

  try {
    const refreshed = await refreshCloudSession(settings);
    return {
      status: 'refreshed',
      accessToken: refreshed.accessToken,
      refreshToken: refreshed.refreshToken,
      expiresAt: refreshed.expiresAt,
    };
  } catch (e) {
    console.error(e);
    return { status: 'expired' };
  }
}
