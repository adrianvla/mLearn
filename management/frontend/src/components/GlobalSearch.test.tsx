import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import type { AuthorizedGroupNode, AuthorizedUser } from '../api/types';
import { AuthProvider, type AuthApi } from '../auth/AuthProvider';
import { GroupScopeProvider, useGroupScope, type GroupScopeApi } from '../groups/GroupScopeProvider';
import { GlobalSearch } from './GlobalSearch';

const GERMAN_A: AuthorizedGroupNode = { id: 'g1', name: 'German A', capabilities: ['members.view'] };
const GERMAN_B: AuthorizedGroupNode = { id: 'g2', name: 'German B', capabilities: ['members.view'] };

beforeEach(() => vi.stubGlobal('localStorage', memoryStorage()));

it('loads grouped results only for valid input and navigates after a selection', async () => {
  const fetchMock = vi.fn(async () => response({
    results: [
      { kind: 'user', id: 'u1', groupId: 'g1', title: 'Ada Learner', subtitle: 'ada@example.test', href: '/users?groupId=g1' },
      { kind: 'group', id: 'g1', groupId: 'g1', title: 'German A', subtitle: 'german-a', href: '/groups?groupId=g1' },
      { kind: 'policy', id: 'p1', groupId: 'g1', title: 'Safe learning', subtitle: 'German A', href: '/policies?groupId=g1' },
    ],
  }));
  vi.stubGlobal('fetch', fetchMock);

  renderSearch();
  await waitFor(() => expect(screen.getByTestId('selected-group')).toHaveTextContent('German A'));
  const input = screen.getByRole('combobox', { name: 'Search users, groups, and policies' });
  act(() => input.focus());
  fireEvent.change(input, { target: { value: 'a' } });
  expect(fetchMock).not.toHaveBeenCalled();
  expect(screen.getByTestId('location')).toHaveTextContent('/');

  fireEvent.change(input, { target: { value: 'ad' } });
  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/search?q=ad&limit=10', expect.anything()));
  expect(await screen.findByRole('heading', { name: 'Users' })).toBeVisible();
  expect(screen.getByRole('heading', { name: 'Groups' })).toBeVisible();
  expect(screen.getByRole('heading', { name: 'Policies' })).toBeVisible();
  expect(screen.getByRole('option', { name: /Ada Learner/ })).toBeVisible();
  expect(screen.getByTestId('location')).toHaveTextContent('/');

  fireEvent.click(screen.getByRole('option', { name: /Ada Learner/ }));
  await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/users'));
  expect(screen.getByRole('combobox', { name: 'Search users, groups, and policies' })).toHaveValue('');
});

it('navigates with ArrowDown and Enter then closes and clears the result overlay', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => response({
    results: [
      { kind: 'user', id: 'u1', groupId: 'g1', title: 'Ada Learner', subtitle: 'ada@example.test', href: '/users?groupId=g1' },
      { kind: 'group', id: 'g1', groupId: 'g1', title: 'German A', subtitle: 'german-a', href: '/groups?groupId=g1' },
    ],
  })));

  renderSearch();
  await waitFor(() => expect(screen.getByTestId('selected-group')).toHaveTextContent('German A'));
  const input = screen.getByRole('combobox', { name: 'Search users, groups, and policies' });
  act(() => input.focus());
  fireEvent.change(input, { target: { value: 'ad' } });
  await screen.findByRole('option', { name: /Ada Learner/ });

  fireEvent.keyDown(input, { key: 'ArrowDown' });
  fireEvent.keyDown(input, { key: 'Enter' });

  await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/users'));
  expect(screen.getByRole('combobox', { name: 'Search users, groups, and policies' })).toHaveValue('');
  expect(screen.queryByRole('listbox', { name: 'Search results' })).not.toBeInTheDocument();
});

it('activates a result group before routing so the destination sees that scope', async () => {
  const activateGroup = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('fetch', vi.fn(async () => response({
    results: [{ kind: 'user', id: 'u2', groupId: 'g2', title: 'German learner', subtitle: 'learner@example.test', href: '/users' }],
  })));

  renderSearch({ groups: [GERMAN_A, GERMAN_B], groupApi: { activateGroup } });
  await waitFor(() => expect(screen.getByTestId('selected-group')).toHaveTextContent('German A'));
  const input = screen.getByRole('combobox', { name: 'Search users, groups, and policies' });
  act(() => input.focus());
  fireEvent.change(input, { target: { value: 'ge' } });
  fireEvent.click(await screen.findByRole('option', { name: /German learner/ }));

  await waitFor(() => expect(activateGroup).toHaveBeenLastCalledWith('g2', undefined));
  expect(await screen.findByTestId('selected-group')).toHaveTextContent('German B');
  expect(screen.getByTestId('location')).toHaveTextContent('/users');
});

it('uses a user result\'s supplied members-view ancestor scope before opening users', async () => {
  const activateGroup = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('fetch', vi.fn(async () => response({
    results: [{ kind: 'user', id: 'descendant-user', groupId: 'g1', title: 'Descendant learner', subtitle: 'descendant@example.test', href: '/users' }],
  })));

  renderSearch({ groups: [GERMAN_A], groupApi: { activateGroup } });
  await waitFor(() => expect(screen.getByTestId('selected-group')).toHaveTextContent('German A'));
  const input = screen.getByRole('combobox', { name: 'Search users, groups, and policies' });
  act(() => input.focus());
  fireEvent.change(input, { target: { value: 'de' } });
  fireEvent.click(await screen.findByRole('option', { name: /Descendant learner/ }));

  await waitFor(() => expect(activateGroup).toHaveBeenLastCalledWith('g1', undefined));
  await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/users'));
});

it('does not navigate when activating the result group is denied', async () => {
  const activateGroup = vi.fn((id: string) => id === 'g2'
    ? Promise.reject(new Error('forbidden'))
    : Promise.resolve());
  vi.stubGlobal('fetch', vi.fn(async () => response({
    results: [{ kind: 'group', id: 'g2', groupId: 'g2', title: 'German B', subtitle: 'german-b', href: '/groups' }],
  })));

  renderSearch({ groups: [GERMAN_A, GERMAN_B], groupApi: { activateGroup } });
  await waitFor(() => expect(screen.getByTestId('selected-group')).toHaveTextContent('German A'));
  const input = screen.getByRole('combobox', { name: 'Search users, groups, and policies' });
  act(() => input.focus());
  fireEvent.change(input, { target: { value: 'ge' } });
  fireEvent.click(await screen.findByRole('option', { name: /German B/ }));

  expect(await screen.findByRole('alert')).toHaveTextContent('Unable to switch to the selected group');
  expect(screen.getByTestId('location')).toHaveTextContent('/');
  expect(screen.getByTestId('selected-group')).toHaveTextContent('German A');
  expect(screen.getByRole('combobox', { name: 'Search users, groups, and policies' })).toHaveValue('ge');
});

function renderSearch({
  groups = [GERMAN_A],
  groupApi = { activateGroup: vi.fn().mockResolvedValue(undefined) },
}: {
  groups?: AuthorizedGroupNode[];
  groupApi?: GroupScopeApi;
} = {}) {
  const user: AuthorizedUser = { id: 'teacher', email: 'teacher@example.test', groups };
  const authApi: AuthApi = { me: vi.fn().mockResolvedValue(user), login: vi.fn(), logout: vi.fn(), clearSession: vi.fn() };
  return render(
    <MemoryRouter>
      <AuthProvider api={authApi}>
        <GroupScopeProvider api={groupApi}>
          <GlobalSearch />
          <Location />
          <ScopeProbe />
        </GroupScopeProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
}

function Location() {
  const location = useLocation();
  return <output data-testid="location">{`${location.pathname}${location.search}`}</output>;
}

function ScopeProbe() {
  const scope = useGroupScope();
  return <output data-testid="selected-group">{scope.status === 'ready' ? scope.selectedGroup?.name : scope.status}</output>;
}

function response(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; }, clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null, key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key); }, setItem: (key, value) => { values.set(key, value); },
  };
}
