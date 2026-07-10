// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type Settings } from '../../shared/types';
import {
  activateGroup,
  ensureActiveGroup,
  getEligibleGroups,
} from './managementGroupService';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function settings(overrides: Partial<Settings> = {}): Settings {
  return {
    ...DEFAULT_SETTINGS,
    overrideCloudEndpointUrl: true,
    cloudApiUrl: 'https://school.example/api-root/',
    cloudAuthStatus: 'signed-in',
    cloudAuthAccessToken: 'access-token',
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('managementGroupService', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('loads eligible groups from the resolved management API with the supplied refreshed token', async () => {
    mockFetch.mockResolvedValue(jsonResponse({
      groups: [{ id: 'german-a', parentId: 'german', name: 'German A', slug: 'german-a', status: 'active' }],
    }));

    await expect(getEligibleGroups(settings(), 'refreshed-token')).resolves.toEqual([
      { id: 'german-a', parentId: 'german', name: 'German A', slug: 'german-a', status: 'active' },
    ]);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://school.example/api-root/api/groups/eligible',
      expect.objectContaining({
        method: 'GET',
        headers: { Authorization: 'Bearer refreshed-token' },
      }),
    );
  });

  it('auto-selects the only eligible group only after activation succeeds', async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ groups: [{ id: 'german-a', name: 'German A' }] }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const updateSettings = vi.fn();

    const result = await ensureActiveGroup(settings(), updateSettings, 'refreshed-token');

    expect(result).toMatchObject({
      ready: true,
      needsSelection: false,
      id: 'german-a',
      name: 'German A',
    });
    expect(mockFetch).toHaveBeenNthCalledWith(
      2,
      'https://school.example/api-root/api/groups/german-a/activate',
      expect.objectContaining({
        method: 'POST',
        headers: { Authorization: 'Bearer refreshed-token' },
      }),
    );
    expect(updateSettings).toHaveBeenCalledWith({
      cloudAuthActiveGroupId: 'german-a',
      cloudAuthActiveGroupName: 'German A',
    });
  });

  it('does not persist the only eligible group when activation fails', async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ groups: [{ id: 'german-a', name: 'German A' }] }))
      .mockResolvedValueOnce(jsonResponse({ error: 'membership revoked' }, 403));
    const updateSettings = vi.fn();

    await expect(ensureActiveGroup(settings(), updateSettings, 'access-token')).rejects.toThrow('membership revoked');
    expect(updateSettings).not.toHaveBeenCalledWith(expect.objectContaining({
      cloudAuthActiveGroupId: 'german-a',
    }));
  });

  it('requires explicit selection when multiple groups are eligible and no valid selection is stored', async () => {
    mockFetch.mockResolvedValue(jsonResponse({
      groups: [
        { id: 'german-a', name: 'German A' },
        { id: 'german-b', name: 'German B' },
      ],
    }));
    const updateSettings = vi.fn();

    const result = await ensureActiveGroup(settings({
      cloudAuthActiveGroupId: 'revoked-group',
      cloudAuthActiveGroupName: 'Revoked Group',
    }), updateSettings, 'access-token');

    expect(result).toMatchObject({ ready: false, needsSelection: true, id: '', name: '' });
    expect(result.groups).toHaveLength(2);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(updateSettings).toHaveBeenCalledWith({
      cloudAuthActiveGroupId: '',
      cloudAuthActiveGroupName: '',
    });
  });

  it('reactivates a stored eligible group before reporting readiness', async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse({
        groups: [
          { id: 'german-a', name: 'German A' },
          { id: 'german-b', name: 'German B' },
        ],
      }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    const result = await ensureActiveGroup(settings({
      cloudAuthActiveGroupId: 'german-b',
      cloudAuthActiveGroupName: 'German B',
    }), vi.fn(), 'access-token');

    expect(result).toMatchObject({ ready: true, needsSelection: false, id: 'german-b' });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('clears a stored group when no eligible membership remains', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ groups: [] }));
    const updateSettings = vi.fn();

    const result = await ensureActiveGroup(settings({
      cloudAuthActiveGroupId: 'german-a',
      cloudAuthActiveGroupName: 'German A',
    }), updateSettings, 'access-token');

    expect(result).toMatchObject({ ready: false, needsSelection: false, id: '', name: '' });
    expect(updateSettings).toHaveBeenCalledWith({
      cloudAuthActiveGroupId: '',
      cloudAuthActiveGroupName: '',
    });
  });

  it('activation can be called explicitly by the later group selector', async () => {
    mockFetch.mockResolvedValue(new Response(null, { status: 204 }));
    const updateSettings = vi.fn();

    await expect(activateGroup(
      settings(),
      { id: 'german-a', name: 'German A' },
      updateSettings,
      'access-token',
    )).resolves.toMatchObject({ ready: true, id: 'german-a' });
    expect(updateSettings).toHaveBeenCalledWith({
      cloudAuthActiveGroupId: 'german-a',
      cloudAuthActiveGroupName: 'German A',
    });
  });

  it('rejects malformed eligible-group payloads instead of silently becoming ready', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ groups: [{ id: '', name: 'Broken' }] }));
    await expect(getEligibleGroups(settings(), 'access-token')).rejects.toThrow('eligible groups');
  });
});
