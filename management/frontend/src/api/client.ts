import type {
  AiStatusDto,
  AnalyticsDto,
  ConfigDto,
  DistributionDto,
  LlmGatewayDto,
  LogsDto,
  OverviewDto,
  SchoolDto,
  ServiceActionResponse,
  ServiceDto,
  StorageDto,
  UsersDto,
} from './types';

type ServiceAction = 'start' | 'stop' | 'restart';
type RequestOptions = Omit<RequestInit, 'headers'> & { headers?: Record<string, string> };

export const AUTH_ERROR_EVENT = 'mlearn-management-auth-error';
export const TOKEN_KEY = 'mlearn_admin_token';

export class AuthError extends Error {
  constructor() {
    super('Unauthorized');
    this.name = 'AuthError';
  }
}

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export class ApiClient {
  private readonly baseUrl: string;
  private readonly getToken: () => string | null;

  constructor(baseUrl = '', getToken = defaultGetToken) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.getToken = getToken;
  }

  getOverview(): Promise<OverviewDto> {
    return this.request('/api/overview');
  }

  getServices(): Promise<ServiceDto[]> {
    return this.request('/api/services');
  }

  performAction(id: string, action: ServiceAction): Promise<ServiceActionResponse> {
    return this.request(`/api/services/${encodeURIComponent(id)}/${action}`, { method: 'POST' });
  }

  getLogs(id: string, tail?: number): Promise<LogsDto> {
    const query = tail === undefined ? '' : `?tail=${encodeURIComponent(String(tail))}`;
    return this.request(`/api/services/${encodeURIComponent(id)}/logs${query}`);
  }

  getConfig(): Promise<ConfigDto> {
    return this.request('/api/config');
  }

  getStorage(): Promise<StorageDto> {
    return this.request('/api/storage');
  }

  getAiStatus(): Promise<AiStatusDto> {
    return this.request('/api/ai-status');
  }

  getSchool(): Promise<SchoolDto> {
    return this.request('/api/school');
  }

  getUsers(): Promise<UsersDto> {
    return this.request('/api/users');
  }

  getDistribution(): Promise<DistributionDto> {
    return this.request('/api/distribution');
  }

  getLlmGateway(): Promise<LlmGatewayDto> {
    return this.request('/api/llm-gateway');
  }

  getAnalytics(): Promise<AnalyticsDto> {
    return this.request('/api/analytics');
  }

  private async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const token = this.getToken();
    const headers = token === null ? { ...options.headers } : { ...options.headers, Authorization: `Bearer ${token}` };
    const response = await fetch(`${this.baseUrl}${path}`, { ...options, headers });

    if (response.status === 401) {
      window.dispatchEvent(new CustomEvent(AUTH_ERROR_EVENT));
      throw new AuthError();
    }

    if (!response.ok) {
      throw new ApiError(response.status, await readErrorMessage(response));
    }

    return response.json() as Promise<T>;
  }
}

export function createApiClient(): ApiClient {
  return new ApiClient();
}

function defaultGetToken(): string | null {
  const token = localStorage.getItem(TOKEN_KEY);
  return token === null || token.trim().length === 0 ? null : token;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json();

    if (isRecord(body) && typeof body.error === 'string') {
      return body.error;
    }

    if (isRecord(body) && typeof body.message === 'string') {
      return body.message;
    }
  } catch {
    const text = await response.text().catch(() => '');

    if (text.length > 0) {
      return text;
    }
  }

  return `Request failed with status ${response.status}`;
}
