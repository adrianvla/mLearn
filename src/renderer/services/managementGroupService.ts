import { resolveCloudApiUrl } from '../../shared/backends';
import { DEFAULT_SETTINGS, type Settings } from '../../shared/types';
import { resolveCloudAccessToken } from './cloudAuthService';

export interface ManagementGroup {
  id: string;
  name: string;
}

export interface ActiveGroupResult {
  ready: boolean;
  needsSelection: boolean;
  id: string;
  name: string;
  groups: ManagementGroup[];
}

type UpdateSettings = (partial: Partial<Settings>) => void;

interface GroupReadinessCache {
  scope: string;
  activeGroupId: string;
  result: ActiveGroupResult;
}

let readinessCache: GroupReadinessCache | null = null;
const readinessRequests = new Map<string, Promise<ActiveGroupResult>>();

const CLEARED_ACTIVE_GROUP = {
  cloudAuthActiveGroupId: DEFAULT_SETTINGS.cloudAuthActiveGroupId,
  cloudAuthActiveGroupName: DEFAULT_SETTINGS.cloudAuthActiveGroupName,
};

function apiError(response: Response, payload: unknown, fallback: string): Error & { status?: number } {
  const message = payload && typeof payload === 'object' && 'error' in payload
    && typeof (payload as { error?: unknown }).error === 'string'
    ? (payload as { error: string }).error
    : `${fallback}: ${response.status}`;
  const error: Error & { status?: number } = new Error(message);
  error.status = response.status;
  return error;
}

async function responsePayload(response: Response): Promise<unknown> {
  return response.json().catch(() => ({}));
}

function validateGroups(payload: unknown): ManagementGroup[] {
  if (!payload || typeof payload !== 'object' || !Array.isArray((payload as { groups?: unknown }).groups)) {
    throw new Error('Management API returned invalid eligible groups');
  }

  const groups = (payload as { groups: unknown[] }).groups;
  if (!groups.every((candidate) => {
    if (!candidate || typeof candidate !== 'object') return false;
    const group = candidate as Record<string, unknown>;
    return typeof group.id === 'string' && group.id.trim().length > 0
      && typeof group.name === 'string' && group.name.trim().length > 0;
  })) {
    throw new Error('Management API returned invalid eligible groups');
  }

  return groups.map((candidate) => {
    const group = candidate as Record<string, unknown>;
    return { id: group.id as string, name: group.name as string };
  });
}

function tokenFor(settings: Settings, accessToken?: string): string {
  const token = (accessToken || resolveCloudAccessToken(settings)).trim();
  if (!token) throw new Error('Missing cloud access token');
  return token;
}

function readinessScope(settings: Settings, accessToken?: string): string {
  return `${resolveCloudApiUrl(settings)}\n${settings.cloudAuthUserId}\n${tokenFor(settings, accessToken)}`;
}

export function resetManagementGroupReadiness(): void {
  readinessCache = null;
  readinessRequests.clear();
}

export function requiresManagementGroup(settings: Settings): boolean {
  return settings.overrideCloudEndpointUrl
    && settings.cloudApiUrl.trim().length > 0;
}

export async function getEligibleGroups(
  settings: Settings,
  accessToken?: string,
): Promise<ManagementGroup[]> {
  const response = await fetch(`${resolveCloudApiUrl(settings)}/api/groups/eligible`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${tokenFor(settings, accessToken)}` },
  });
  const payload = await responsePayload(response);
  if (!response.ok) throw apiError(response, payload, 'Eligible groups request failed');
  return validateGroups(payload);
}

function readyResult(group: ManagementGroup, groups: ManagementGroup[]): ActiveGroupResult {
  return {
    ready: true,
    needsSelection: false,
    id: group.id,
    name: group.name,
    groups,
  };
}

export async function activateGroup(
  settings: Settings,
  group: ManagementGroup,
  updateSettings: UpdateSettings,
  accessToken?: string,
  groups: ManagementGroup[] = [group],
): Promise<ActiveGroupResult> {
  const response = await fetch(
    `${resolveCloudApiUrl(settings)}/api/groups/${encodeURIComponent(group.id)}/activate`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenFor(settings, accessToken)}` },
    },
  );
  if (!response.ok) {
    const payload = await responsePayload(response);
    throw apiError(response, payload, 'Group activation failed');
  }

  if (settings.cloudAuthActiveGroupId !== group.id
    || settings.cloudAuthActiveGroupName !== group.name) {
    updateSettings({
      cloudAuthActiveGroupId: group.id,
      cloudAuthActiveGroupName: group.name,
    });
  }
  const result = readyResult(group, groups);
  readinessCache = {
    scope: readinessScope(settings, accessToken),
    activeGroupId: group.id,
    result,
  };
  return result;
}

function clearActiveGroup(settings: Settings, updateSettings: UpdateSettings): void {
  if ((settings.cloudAuthActiveGroupId || DEFAULT_SETTINGS.cloudAuthActiveGroupId)
    || (settings.cloudAuthActiveGroupName || DEFAULT_SETTINGS.cloudAuthActiveGroupName)) {
    updateSettings(CLEARED_ACTIVE_GROUP);
  }
}

export async function ensureActiveGroup(
  settings: Settings,
  updateSettings: UpdateSettings,
  accessToken?: string,
): Promise<ActiveGroupResult> {
  if (settings.cloudAuthStatus !== 'signed-in') {
    resetManagementGroupReadiness();
    clearActiveGroup(settings, updateSettings);
    return { ready: false, needsSelection: false, id: '', name: '', groups: [] };
  }

  const scope = readinessScope(settings, accessToken);
  const activeGroupId = settings.cloudAuthActiveGroupId || DEFAULT_SETTINGS.cloudAuthActiveGroupId;
  if (readinessCache?.scope === scope && readinessCache.activeGroupId === activeGroupId) {
    return readinessCache.result;
  }
  const requestKey = `${scope}\n${activeGroupId}`;
  const pending = readinessRequests.get(requestKey);
  if (pending) return pending;

  const request = ensureActiveGroupUncached(settings, updateSettings, accessToken, scope);
  readinessRequests.set(requestKey, request);
  try {
    return await request;
  } finally {
    if (readinessRequests.get(requestKey) === request) readinessRequests.delete(requestKey);
  }
}

async function ensureActiveGroupUncached(
  settings: Settings,
  updateSettings: UpdateSettings,
  accessToken: string | undefined,
  scope: string,
): Promise<ActiveGroupResult> {
  const groups = await getEligibleGroups(settings, accessToken);
  const storedGroupId = settings.cloudAuthActiveGroupId || DEFAULT_SETTINGS.cloudAuthActiveGroupId;
  const storedGroup = groups.find((group) => group.id === storedGroupId);
  const selectedGroup = storedGroup ?? (groups.length === 1 ? groups[0] : undefined);

  if (!selectedGroup) {
    clearActiveGroup(settings, updateSettings);
    const result = {
      ready: false,
      needsSelection: groups.length > 1,
      id: '',
      name: '',
      groups,
    };
    readinessCache = { scope, activeGroupId: '', result };
    return result;
  }

  try {
    return await activateGroup(settings, selectedGroup, updateSettings, accessToken, groups);
  } catch (error) {
    clearActiveGroup(settings, updateSettings);
    throw error;
  }
}
