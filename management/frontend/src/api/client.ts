import type {
  AiStatusDto,
  ConfigDto,
  LogsDto,
  OverviewDto,
  SchoolDto,
  ServiceActionResponse,
  ServiceDto,
  StorageDto,
} from './types';

type ServiceAction = 'start' | 'stop' | 'restart';
type RequestOptions = Omit<RequestInit, 'headers'> & { headers?: Record<string, string> };

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
  private baseUrl: string;
  private getToken: () => string | null;

  constructor(baseUrl = '', getToken = defaultGetToken) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.getToken = getToken;
  }

  async getOverview(): Promise<OverviewDto> {
    return this.request('/api/overview');
  }

  async getServices(): Promise<ServiceDto[]> {
    return this.request('/api/services');
  }

  async performAction(id: string, action: ServiceAction): Promise<ServiceActionResponse> {
    return this.request(`/api/services/${encodeURIComponent(id)}/actions/${action}`, { method: 'POST' });
  }

  async getLogs(id: string, tail?: number): Promise<LogsDto> {
    const query = tail === undefined ? '' : `?tail=${encodeURIComponent(String(tail))}`;
    return this.request(`/api/services/${encodeURIComponent(id)}/logs${query}`);
  }

  async getConfig(): Promise<ConfigDto> {
    return this.request('/api/config');
  }

  async getStorage(): Promise<StorageDto> {
    return this.request('/api/storage');
  }

  async getAiStatus(): Promise<AiStatusDto> {
    return this.request('/api/ai');
  }

  async getSchool(): Promise<SchoolDto> {
    return this.request('/api/school');
  }

  private async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const token = this.getToken();
    const headers = token === null ? { ...options.headers } : { ...options.headers, Authorization: `Bearer ${token}` };
    const response = await fetch(`${this.baseUrl}${path}`, { ...options, headers });

    if (response.status === 401) {
      throw new AuthError();
    }

    if (!response.ok) {
      throw new ApiError(response.status, await readErrorMessage(response));
    }

    return response.json() as Promise<T>;
  }
}

let singletonClient: ApiClient | null = null;

export function createApiClient(): ApiClient {
  if (singletonClient === null) {
    singletonClient = new ApiClient();
  }

  return singletonClient;
}

function defaultGetToken(): string | null {
  return localStorage.getItem('mlearn_admin_token');
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
