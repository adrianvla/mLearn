import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { AuthorizedUser } from '../api/types';
import { AuthProvider, type AuthApi } from '../auth/AuthProvider';
import { GROUP_STORAGE_KEY, GroupScopeProvider, useGroupScope, type GroupScopeApi } from './GroupScopeProvider';

const GERMAN_A = { id: 'german-a', name: 'German A', capabilities: ['analytics.view'] as const };
const GERMAN_B = { id: 'german-b', name: 'German B', capabilities: [] };

function Probe() {
  const scope = useGroupScope();
  if (scope.status !== 'ready') return <div>{scope.status}</div>;
  return <><div>{scope.selectedGroup?.name ?? 'none'}</div><div>{scope.can('analytics.view') ? 'can analytics' : 'cannot analytics'}</div>
    <button onClick={() => void scope.selectGroup('german-b')}>Select B</button></>;
}

function Providers({ user, groupApi }: { user: AuthorizedUser; groupApi: GroupScopeApi }) {
  const authApi: AuthApi = { me: vi.fn().mockResolvedValue(user), login: vi.fn(), logout: vi.fn(), clearSession: vi.fn() };
  return <AuthProvider api={authApi}><GroupScopeProvider api={groupApi}><Probe /></GroupScopeProvider></AuthProvider>;
}

beforeEach(() => vi.stubGlobal('localStorage', memoryStorage()));

it('restores the session and selects only eligible group automatically', async () => {
  const activateGroup = vi.fn().mockResolvedValue(undefined);
  render(<Providers user={{ id: 'u', email: 'a@b.c', groups: [GERMAN_A] }} groupApi={{ activateGroup }} />);
  expect(await screen.findByText('German A')).toBeVisible();
  expect(screen.getByText('can analytics')).toBeVisible();
  expect(activateGroup).toHaveBeenCalledWith('german-a', expect.anything());
});

it('treats root administrators as holding every capability', async () => {
  const activateGroup = vi.fn().mockResolvedValue(undefined);
  render(<Providers user={{ id: 'root', email: 'root@school.test', isRoot: true, groups: [GERMAN_B] }} groupApi={{ activateGroup }} />);
  expect(await screen.findByText('German B')).toBeVisible();
  expect(screen.getByText('can analytics')).toBeVisible();
});

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; }, clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null, key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key); }, setItem: (key, value) => { values.set(key, value); },
  };
}

it('removes a forbidden selected group immediately after permission loss', async () => {
  localStorage.setItem(GROUP_STORAGE_KEY, 'german-b');
  const activateGroup = vi.fn().mockResolvedValue(undefined);
  render(<Providers user={{ id: 'u', email: 'a@b.c', groups: [GERMAN_A] }} groupApi={{ activateGroup }} />);
  await waitFor(() => expect(localStorage.getItem(GROUP_STORAGE_KEY)).toBe('german-a'));
  expect(await screen.findByText('German A')).toBeVisible();
});

it('does not render stale old-scope children while activating a new group', async () => {
  let finishSwitch!: () => void;
  const activateGroup = vi.fn((id: string) => id === 'german-b'
    ? new Promise<void>((resolve) => { finishSwitch = resolve; })
    : Promise.resolve());
  render(<Providers user={{ id: 'u', email: 'a@b.c', groups: [GERMAN_A, GERMAN_B] }} groupApi={{ activateGroup }} />);
  await screen.findByText('German A');
  fireEvent.click(screen.getByRole('button', { name: 'Select B' }));
  expect(await screen.findByText('loading')).toBeVisible();
  expect(screen.queryByText('German A')).not.toBeInTheDocument();
  await act(async () => finishSwitch());
  expect(await screen.findByText('German B')).toBeVisible();
  await waitFor(() => expect(localStorage.getItem(GROUP_STORAGE_KEY)).toBe('german-b'));
});
