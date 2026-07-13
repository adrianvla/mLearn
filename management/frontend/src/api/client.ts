import type {
  AiStatusDto, AnalyticsDto, AuthResponse, AuthSession, AuthorizedUser, ConfigDto,
  DistributionDto, LlmGatewayDto, LogsDto, OverviewDto, SchoolDto,
  ServiceActionResponse, ServiceDto, StorageDto, UsersDto,
} from './types';

type ServiceAction = 'start' | 'stop' | 'restart';
type RequestOptions = Omit<RequestInit, 'headers'> & { headers?: HeadersInit };

export const AUTH_SIGNED_OUT_EVENT = 'mlearn-management-signed-out';
export const AUTH_SESSION_UPDATED_EVENT = 'mlearn-management-session-updated';
export const AUTH_ERROR_EVENT = AUTH_SIGNED_OUT_EVENT;
export const SESSION_KEY = 'mlearn-management-session';
export const TOKEN_KEY = SESSION_KEY;

export interface SessionStore {
  accessToken(): string | null;
  refreshToken(): string | null;
  set(session: AuthSession): void;
  clear(): void;
}

export function createSessionStore(storage: Storage = sessionStorage): SessionStore {
  let memoryAccessToken: string | null = readSession(storage)?.accessToken ?? null;
  return {
    accessToken: () => memoryAccessToken,
    refreshToken: () => readSession(storage)?.refreshToken ?? null,
    set: (session) => {
      memoryAccessToken = session.accessToken;
      storage.setItem(SESSION_KEY, JSON.stringify(session));
    },
    clear: () => {
      memoryAccessToken = null;
      storage.removeItem(SESSION_KEY);
    },
  };
}

function readSession(storage: Storage): AuthSession | null {
  const raw = storage.getItem(SESSION_KEY);
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (isRecord(parsed) && typeof parsed.accessToken === 'string'
      && (typeof parsed.refreshToken === 'string' || parsed.refreshToken === null)
      && typeof parsed.expiresAt === 'number') return parsed as unknown as AuthSession;
  } catch { /* invalid session is removed by the caller on the next write */ }
  return null;
}

export class AuthError extends Error {
  constructor() { super('Unauthorized'); this.name = 'AuthError'; }
}

export class ApiError extends Error {
  constructor(public readonly status: number, message: string, public readonly body: unknown) {
    super(message); this.name = 'ApiError';
  }
}

const defaultStore = createSessionStore();

export function establishSession(session: AuthSession): void {
  defaultStore.set(session);
  window.dispatchEvent(new Event(AUTH_SESSION_UPDATED_EVENT));
}

export class ApiClient {
  private readonly baseUrl: string;
  private refreshPromise: Promise<boolean> | null = null;

  constructor(baseUrl = '', private readonly session = defaultStore) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  getOverview(): Promise<OverviewDto> { return this.get('/api/overview'); }
  getServices(): Promise<ServiceDto[]> { return this.get('/api/services'); }
  performAction(id: string, action: ServiceAction): Promise<ServiceActionResponse> {
    return this.request(`/api/services/${encodeURIComponent(id)}/${action}`, { method: 'POST' });
  }
  getLogs(id: string, tail?: number): Promise<LogsDto> {
    const query = tail === undefined ? '' : `?tail=${encodeURIComponent(String(tail))}`;
    return this.get(`/api/services/${encodeURIComponent(id)}/logs${query}`);
  }
  getConfig(): Promise<ConfigDto> { return this.get('/api/config'); }
  getStorage(): Promise<StorageDto> { return this.get('/api/storage'); }
  getAiStatus(): Promise<AiStatusDto> { return this.get('/api/ai-status'); }
  getSchool(): Promise<SchoolDto> { return this.get('/api/school'); }
  getUsers(): Promise<UsersDto> { return this.get('/api/users'); }
  getDistribution(): Promise<DistributionDto> { return this.get('/api/distribution'); }
  getLlmGateway(): Promise<LlmGatewayDto> { return this.get('/api/llm-gateway'); }
  getAnalytics(): Promise<AnalyticsDto> { return this.get('/api/analytics'); }

  get<T>(path: string, options: RequestOptions = {}): Promise<T> { return this.request(path, options); }
  post<T>(path: string, body: unknown, options: RequestOptions = {}): Promise<T> {
    return this.request(path, { ...options, method: 'POST', body: JSON.stringify(body) });
  }
  put<T>(path: string, body: unknown, options: RequestOptions = {}): Promise<T> {
    return this.request(path, { ...options, method: 'PUT', body: JSON.stringify(body) });
  }
  delete<T>(path: string, options: RequestOptions = {}): Promise<T> {
    return this.request(path, { ...options, method: 'DELETE' });
  }

  async login(email: string, password: string): Promise<AuthorizedUser> {
    const response = await this.request<AuthResponse>('/api/auth/login', {
      method: 'POST', credentials: 'include', body: JSON.stringify({ email, password }),
    }, false);
    this.session.set(response.session);
    return this.me();
  }

  async me(signal?: AbortSignal): Promise<AuthorizedUser> {
    const user = await this.get<{ id: string; email: string; isRoot: boolean }>('/api/auth/me', { signal });
    const eligible = await this.get<{ groups: Array<{ id: string; name: string; capabilities: import('./types').Capability[] }> }>('/api/groups/eligible', { signal });
    return { ...user, groups: eligible.groups };
  }

  activateGroup(id: string, signal?: AbortSignal): Promise<void> {
    return this.request(`/api/groups/${encodeURIComponent(id)}/activate`, { method: 'POST', signal });
  }

  async logout(): Promise<void> {
    try { await this.request('/api/auth/logout', { method: 'POST', credentials: 'include' }, false); }
    finally { this.clearSession(); }
  }

  clearSession(): void { this.session.clear(); }

  private async request<T>(path: string, options: RequestOptions = {}, retry401 = true): Promise<T> {
    const response = await this.fetchWithAccess(path, options);
    if (response.status === 401 && retry401 && !path.endsWith('/api/auth/refresh')) {
      const refreshed = await this.refresh();
      if (refreshed) {
        const retried = await this.fetchWithAccess(path, options);
        if (retried.status !== 401) return this.readResponse<T>(retried);
        await this.terminalSignOut(retried);
      }
      await this.terminalSignOut(response);
    }
    if (response.status === 401) await this.terminalSignOut(response);
    return this.readResponse<T>(response);
  }

  private fetchWithAccess(path: string, options: RequestOptions): Promise<Response> {
    const headers = new Headers(options.headers);
    const token = this.session.accessToken();
    if (token !== null) headers.set('Authorization', `Bearer ${token}`);
    if (options.body !== undefined && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    return fetch(`${this.baseUrl}${path}`, { credentials: 'include', ...options, headers });
  }

  private refresh(): Promise<boolean> {
    if (this.refreshPromise !== null) return this.refreshPromise;
    this.refreshPromise = (async () => {
      const refreshToken = this.session.refreshToken();
      const response = await fetch(`${this.baseUrl}/api/auth/refresh`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(refreshToken === null ? {} : { refreshToken }),
      });
      if (!response.ok) return false;
      const body = await response.json() as { session: AuthSession };
      this.session.set(body.session);
      return true;
    })().catch(() => false).finally(() => { this.refreshPromise = null; });
    return this.refreshPromise;
  }

  private async terminalSignOut(response: Response): Promise<never> {
    this.session.clear();
    window.dispatchEvent(new CustomEvent(AUTH_SIGNED_OUT_EVENT));
    throw await toApiError(response);
  }

  private async readResponse<T>(response: Response): Promise<T> {
    if (!response.ok) throw await toApiError(response);
    if (response.status === 204) return undefined as T;
    return response.json() as Promise<T>;
  }
}

export function createApiClient(): ApiClient { return new ApiClient(); }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

async function toApiError(response: Response): Promise<ApiError> {
  let body: unknown = null;
  try { body = await response.clone().json(); }
  catch { body = await response.text().catch(() => ''); }
  const message = isRecord(body) && typeof body.error === 'string' ? body.error
    : isRecord(body) && typeof body.message === 'string' ? body.message
      : typeof body === 'string' && body.length > 0 ? body
        : `Request failed with status ${response.status}`;
  return new ApiError(response.status, message, body);
}
