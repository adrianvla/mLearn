import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AUTH_SESSION_UPDATED_EVENT, AUTH_SIGNED_OUT_EVENT, ApiClient, ApiError } from '../api/client';
import type { AuthorizedUser } from '../api/types';

export interface AuthApi {
  me(signal?: AbortSignal): Promise<AuthorizedUser>;
  login(email: string, password: string): Promise<AuthorizedUser>;
  logout(): Promise<void>;
  clearSession(): void;
}

interface AuthActions {
  login(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  retry(): void;
}

export type AuthValue = AuthActions & (
  | { status: 'loading'; user: null; error: null }
  | { status: 'authenticated'; user: AuthorizedUser; error: null }
  | { status: 'signedOut'; user: null; error: null }
  | { status: 'error'; user: null; error: Error }
);

const AuthContext = createContext<AuthValue | null>(null);
const defaultApi = new ApiClient();

export function AuthProvider({ children, api = defaultApi }: { children: ReactNode; api?: AuthApi }) {
  const [state, setState] = useState<Omit<AuthValue, keyof AuthActions>>({ status: 'loading', user: null, error: null });
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: 'loading', user: null, error: null });
    api.me(controller.signal).then((user) => {
      if (!controller.signal.aborted) setState({ status: 'authenticated', user, error: null });
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return;
      if (error instanceof ApiError && error.status === 401) setState({ status: 'signedOut', user: null, error: null });
      else setState({ status: 'error', user: null, error: error instanceof Error ? error : new Error('Session restoration failed') });
    });
    return () => controller.abort();
  }, [api, retryKey]);

  useEffect(() => {
    const signedOut = () => setState({ status: 'signedOut', user: null, error: null });
    const sessionUpdated = () => setRetryKey((key) => key + 1);
    window.addEventListener(AUTH_SIGNED_OUT_EVENT, signedOut);
    window.addEventListener(AUTH_SESSION_UPDATED_EVENT, sessionUpdated);
    return () => {
      window.removeEventListener(AUTH_SIGNED_OUT_EVENT, signedOut);
      window.removeEventListener(AUTH_SESSION_UPDATED_EVENT, sessionUpdated);
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    setState({ status: 'loading', user: null, error: null });
    try {
      const user = await api.login(email, password);
      setState({ status: 'authenticated', user, error: null });
    } catch (error) {
      setState({ status: 'error', user: null, error: error instanceof Error ? error : new Error('Login failed') });
    }
  }, [api]);

  const signOut = useCallback(async () => {
    try { await api.logout(); }
    finally {
      api.clearSession();
      setState({ status: 'signedOut', user: null, error: null });
    }
  }, [api]);

  const actions = useMemo<AuthActions>(() => ({ login, signOut, retry: () => setRetryKey((key) => key + 1) }), [login, signOut]);
  return <AuthContext.Provider value={{ ...state, ...actions } as AuthValue}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (value === null) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}
