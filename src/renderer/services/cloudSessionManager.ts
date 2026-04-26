import type { Settings } from '../../shared/types';
import {
  CLOUD_ACCESS_TOKEN_REFRESH_BUFFER_MS,
  isCloudAccessTokenExpiringSoon,
  normalizeCloudAuthExpiresAt,
  refreshCloudSession,
  resolveCloudAccessToken,
} from './cloudAuthService';

export class CloudSessionCancelledError extends Error {
  readonly code = 'cloud_session_cancelled';

  constructor(message = 'Cloud sign-in canceled') {
    super(message);
    this.name = 'CloudSessionCancelledError';
  }
}

export class CloudUnreachableError extends Error {
  readonly code = 'cloud_unreachable';
  readonly cause?: unknown;

  constructor(message = 'Cloud is unreachable', cause?: unknown) {
    super(message);
    this.name = 'CloudUnreachableError';
    this.cause = cause;
  }
}

export interface WithCloudAuthOptions {
  /** When true (default), opens login modal on auth errors. When false, throws CloudSessionCancelledError instead. */
  interactive?: boolean;
  /** When true, signals that retry must NOT happen if any user-visible output has been emitted (streaming case). Caller decides. */
  alreadyEmittedOutput?: () => boolean;
}

interface CloudSessionController {
  getSettings: () => Settings;
  updateSettings: (partial: Partial<Settings>) => void;
  openCloudReLoginModal: () => void;
}

interface PendingCloudSessionRecovery {
  promise: Promise<string | null>;
  resolve: (token: string | null) => void;
}

const controllers: CloudSessionController[] = [];
let refreshInFlight: Promise<string | null> | null = null;
let pendingSessionRecovery: PendingCloudSessionRecovery | null = null;

function getActiveController(): CloudSessionController | null {
  return controllers.length > 0 ? controllers[controllers.length - 1] : null;
}

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

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  const record = getErrorRecord(error);
  if (typeof record?.message === 'string') {
    return record.message;
  }

  return String(error ?? 'Unknown cloud error');
}

function getErrorStatus(error: unknown): number | undefined {
  const record = getErrorRecord(error);
  return typeof record?.status === 'number'
    ? record.status
    : typeof record?.statusCode === 'number'
      ? record.statusCode
      : undefined;
}

function isCloudTransportError(error: unknown): boolean {
  if (error instanceof CloudUnreachableError) {
    return true;
  }

  if (isCloudSessionError(error)) {
    return false;
  }

  const status = getErrorStatus(error);
  if (typeof status === 'number') {
    return status >= 500;
  }

  const record = getErrorRecord(error);
  const code = typeof record?.code === 'string' ? record.code.toLowerCase() : '';
  const name = error instanceof Error ? error.name.toLowerCase() : String(record?.name ?? '').toLowerCase();
  const message = getErrorMessage(error).toLowerCase();

  return code.includes('network')
    || code.includes('timeout')
    || code === 'econnrefused'
    || code === 'econnreset'
    || code === 'enetunreach'
    || code === 'ehostunreach'
    || name === 'typeerror'
    || name === 'networkerror'
    || message.includes('network')
    || message.includes('failed to fetch')
    || message.includes('fetch failed')
    || message.includes('load failed')
    || message.includes('connection refused')
    || message.includes('unreachable')
    || message.includes('timed out')
    || message.includes('timeout');
}

function toCloudUnreachableError(error: unknown): CloudUnreachableError {
  if (error instanceof CloudUnreachableError) {
    return error;
  }

  return new CloudUnreachableError(getErrorMessage(error), error);
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
  controllers.push(next);
  if (pendingSessionRecovery) {
    next.openCloudReLoginModal();
  }
  return () => {
    const index = controllers.indexOf(next);
    if (index !== -1) {
      controllers.splice(index, 1);
    }
  };
}

export function hasSignedInCloudSession(settings: Settings): boolean {
  return settings.cloudAuthStatus === 'signed-in'
    && (!!resolveCloudAccessToken(settings) || !!settings.cloudAuthRefreshToken);
}

export function getCloudSessionSettings(): Settings | null {
  return getActiveController()?.getSettings() ?? null;
}

function resolvePendingSessionRecovery(token: string | null): void {
  if (!pendingSessionRecovery) {
    return;
  }

  const pending = pendingSessionRecovery;
  pendingSessionRecovery = null;
  pending.resolve(token);
}

function requestCloudSessionRecovery(openModal: boolean = true): Promise<string | null> {
  if (!pendingSessionRecovery) {
    let resolveRecovery: (token: string | null) => void = () => {};
    const promise = new Promise<string | null>((resolve) => {
      resolveRecovery = resolve;
    });

    pendingSessionRecovery = {
      promise,
      resolve: resolveRecovery,
    };
  }

  const active = getActiveController();
  if (openModal && active) {
    active.openCloudReLoginModal();
  }

  return pendingSessionRecovery.promise;
}

export function syncCloudSessionState(settings: Settings): void {
  const accessToken = resolveCloudAccessToken(settings);

  if (settings.cloudAuthStatus === 'signed-in' && accessToken) {
    resolvePendingSessionRecovery(accessToken);
  }
}

export function cancelCloudSessionRecovery(): void {
  resolvePendingSessionRecovery(null);
}

export function clearCloudSession(openModal: boolean = true): void {
  getActiveController()?.updateSettings(buildExpiredSessionPatch());

  if (openModal) {
    void requestCloudSessionRecovery(true);
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
  options: { forceRefresh?: boolean; openModalOnExpiry?: boolean; interactive?: boolean } = {},
): Promise<string | null> {
  const active = getActiveController();
  const initialSettings = active?.getSettings();
  const currentToken = initialSettings ? resolveCloudAccessToken(initialSettings) : null;
  const hasRefreshToken = !!initialSettings?.cloudAuthRefreshToken;
  const shouldOpenModal = options.interactive ?? options.openModalOnExpiry !== false;

  if (pendingSessionRecovery && (!currentToken || options.forceRefresh)) {
    return pendingSessionRecovery.promise;
  }

  if (!currentToken && !hasRefreshToken) {
    if (initialSettings?.cloudAuthStatus === 'signed-in') {
      clearCloudSession(false);
    }

    if (!shouldOpenModal) {
      return null;
    }

    return requestCloudSessionRecovery(true);
  }

  if (!options.forceRefresh && currentToken && initialSettings && !isCloudAccessTokenExpiringSoon(initialSettings, CLOUD_ACCESS_TOKEN_REFRESH_BUFFER_MS)) {
    return currentToken;
  }

  if (!hasRefreshToken) {
    if (initialSettings?.cloudAuthStatus === 'signed-in') {
      clearCloudSession(false);
    }

    if (!shouldOpenModal) {
      return null;
    }

    return requestCloudSessionRecovery(true);
  }

  if (!active) {
    return requestCloudSessionRecovery(shouldOpenModal);
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
      if (!options.forceRefresh && !isCloudSessionError(error) && fallbackToken && !isCloudAccessTokenExpiringSoon(latestSettings, 0)) {
        return fallbackToken;
      }

      if (isCloudSessionError(error)) {
        if (latestSettings.cloudAuthStatus === 'signed-in') {
          clearCloudSession(false);
        }

        if (shouldOpenModal) {
          return requestCloudSessionRecovery(true);
        }
      }

      if (!isCloudSessionError(error)) {
        throw toCloudUnreachableError(error);
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

/**
 * Run a cloud operation with automatic auth recovery + single retry.
 * - Acquires token via ensureCloudAccessToken().
 * - Runs `op(token)`.
 * - If `op` throws an auth (401) error AND no output has been emitted: triggers recovery, awaits new token, retries op once.
 * - If `op` throws a transport/network error: rethrows as CloudUnreachableError.
 * - If user cancels: throws CloudSessionCancelledError.
 */
export async function withCloudAuth<T>(
  op: (token: string) => Promise<T>,
  options: WithCloudAuthOptions = {},
): Promise<T> {
  const interactive = options.interactive !== false;

  const resolveToken = async (forceRefresh: boolean): Promise<string> => {
    const token = await ensureCloudAccessToken({
      forceRefresh,
      interactive,
      openModalOnExpiry: interactive,
    });

    if (!token) {
      throw new CloudSessionCancelledError();
    }

    return token;
  };

  const canRetry = () => !options.alreadyEmittedOutput?.();

  const execute = async (token: string): Promise<T> => {
    try {
      return await op(token);
    } catch (error) {
      if (isCloudTransportError(error)) {
        throw toCloudUnreachableError(error);
      }

      if (!isCloudSessionError(error) || !canRetry()) {
        throw error;
      }

      const recoveredToken = await resolveToken(true);

      try {
        return await op(recoveredToken);
      } catch (retryError) {
        if (isCloudTransportError(retryError)) {
          throw toCloudUnreachableError(retryError);
        }

        throw retryError;
      }
    }
  };

  const initialToken = await resolveToken(false);
  return execute(initialToken);
}
