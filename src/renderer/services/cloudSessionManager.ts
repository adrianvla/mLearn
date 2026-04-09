import type { Settings } from '../../shared/types';
import {
  CLOUD_ACCESS_TOKEN_REFRESH_BUFFER_MS,
  isCloudAccessTokenExpiringSoon,
  normalizeCloudAuthExpiresAt,
  refreshCloudSession,
  resolveCloudAccessToken,
} from './cloudAuthService';

interface CloudSessionController {
  getSettings: () => Settings;
  updateSettings: (partial: Partial<Settings>) => void;
  openCloudReLoginModal: () => void;
}

let controller: CloudSessionController | null = null;
let refreshInFlight: Promise<string | null> | null = null;

function buildExpiredSessionPatch(): Partial<Settings> {
  return {
    cloudAuthAccessToken: '',
    cloudAuthToken: '',
    cloudAuthRefreshToken: '',
    cloudAuthUserId: '',
    cloudAuthUserEmail: '',
    cloudAuthExpiresAt: 0,
    cloudAuthStatus: 'signed-out',
  };
}

function getErrorRecord(error: unknown): Record<string, unknown> | null {
  return error && typeof error === 'object'
    ? error as Record<string, unknown>
    : null;
}

export function isCloudSessionError(error: unknown): boolean {
  const record = getErrorRecord(error);
  const status = typeof record?.status === 'number'
    ? record.status
    : typeof record?.statusCode === 'number'
      ? record.statusCode
      : undefined;
  const code = typeof record?.code === 'string' ? record.code.toLowerCase() : '';
  const message = error instanceof Error
    ? error.message.toLowerCase()
    : String(record?.message ?? error ?? '').toLowerCase();

  return status === 401
    || code === '401'
    || code === 'unauthorized'
    || code === 'invalid_session'
    || message.includes('401')
    || message.includes('unauthorized')
    || message.includes('invalid session')
    || message.includes('session expired')
    || message.includes('token expired')
    || message.includes('jwt expired');
}

export function registerCloudSessionController(next: CloudSessionController): () => void {
  controller = next;
  return () => {
    if (controller === next) {
      controller = null;
    }
  };
}

export function hasSignedInCloudSession(settings: Settings): boolean {
  return settings.cloudAuthStatus === 'signed-in'
    && (!!resolveCloudAccessToken(settings) || !!settings.cloudAuthRefreshToken);
}

export function getCloudSessionSettings(): Settings | null {
  return controller?.getSettings() ?? null;
}

export function clearCloudSession(openModal: boolean = true): void {
  const active = controller;
  if (!active) {
    return;
  }

  active.updateSettings(buildExpiredSessionPatch());

  if (openModal) {
    active.openCloudReLoginModal();
  }
}

export function handleCloudSessionError(error: unknown, openModal: boolean = true): boolean {
  if (!isCloudSessionError(error)) {
    return false;
  }

  clearCloudSession(openModal);
  return true;
}

export async function ensureCloudAccessToken(
  options: { forceRefresh?: boolean; openModalOnExpiry?: boolean } = {},
): Promise<string | null> {
  const active = controller;
  if (!active) {
    return null;
  }

  const initialSettings = active.getSettings();
  const currentToken = resolveCloudAccessToken(initialSettings);
  const hasRefreshToken = !!initialSettings.cloudAuthRefreshToken;
  const shouldOpenModal = options.openModalOnExpiry !== false;

  if (!currentToken && !hasRefreshToken) {
    if (initialSettings.cloudAuthStatus === 'signed-in') {
      clearCloudSession(shouldOpenModal);
    }
    return null;
  }

  if (!options.forceRefresh && currentToken && !isCloudAccessTokenExpiringSoon(initialSettings, CLOUD_ACCESS_TOKEN_REFRESH_BUFFER_MS)) {
    return currentToken;
  }

  if (!hasRefreshToken) {
    if (initialSettings.cloudAuthStatus === 'signed-in') {
      clearCloudSession(shouldOpenModal);
    }
    return null;
  }

  if (refreshInFlight) {
    return refreshInFlight;
  }

  let currentRefreshPromise: Promise<string | null> | null = null;

  const refreshPromise = (async (): Promise<string | null> => {
    const latestSettings = active.getSettings();
    const fallbackToken = resolveCloudAccessToken(latestSettings);

    try {
      const refreshed = await refreshCloudSession(latestSettings);
      const expiresAt = normalizeCloudAuthExpiresAt(refreshed.expiresAt, refreshed.accessToken);

      active.updateSettings({
        cloudAuthAccessToken: refreshed.accessToken,
        cloudAuthToken: '',
        cloudAuthRefreshToken: refreshed.refreshToken,
        cloudAuthExpiresAt: expiresAt,
        cloudAuthStatus: 'signed-in',
      });

      return refreshed.accessToken;
    } catch (error) {
      if (!isCloudSessionError(error) && fallbackToken && !isCloudAccessTokenExpiringSoon(latestSettings, 0)) {
        return fallbackToken;
      }

      if (isCloudSessionError(error) && latestSettings.cloudAuthStatus === 'signed-in') {
        clearCloudSession(shouldOpenModal);
      }

      return null;
    } finally {
      if (refreshInFlight === currentRefreshPromise) {
        refreshInFlight = null;
      }
    }
  })();

  currentRefreshPromise = refreshPromise;
  refreshInFlight = refreshPromise;
  return refreshPromise;
}