import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { expect, it, vi } from 'vitest';
import { GlobalSearch } from './GlobalSearch';

it('loads grouped results only for valid input and navigates after a selection', async () => {
  const fetchMock = vi.fn(async () => response({
    results: [
      { kind: 'user', id: 'u1', groupId: 'g1', title: 'Ada Learner', subtitle: 'ada@example.test', href: '/users?groupId=g1' },
      { kind: 'group', id: 'g1', groupId: 'g1', title: 'German A', subtitle: 'german-a', href: '/groups?groupId=g1' },
      { kind: 'policy', id: 'p1', groupId: 'g1', title: 'Safe learning', subtitle: 'German A', href: '/policies?groupId=g1' },
    ],
  }));
  vi.stubGlobal('fetch', fetchMock);

  render(<MemoryRouter><GlobalSearch /><Location /></MemoryRouter>);
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
  await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/users?groupId=g1'));
  expect(input).toHaveValue('');
});

it('navigates with ArrowDown and Enter then closes and clears the result overlay', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => response({
    results: [
      { kind: 'user', id: 'u1', groupId: 'g1', title: 'Ada Learner', subtitle: 'ada@example.test', href: '/users?groupId=g1' },
      { kind: 'group', id: 'g1', groupId: 'g1', title: 'German A', subtitle: 'german-a', href: '/groups?groupId=g1' },
    ],
  })));

  render(<MemoryRouter><GlobalSearch /><Location /></MemoryRouter>);
  const input = screen.getByRole('combobox', { name: 'Search users, groups, and policies' });
  act(() => input.focus());
  fireEvent.change(input, { target: { value: 'ad' } });
  await screen.findByRole('option', { name: /Ada Learner/ });

  fireEvent.keyDown(input, { key: 'ArrowDown' });
  fireEvent.keyDown(input, { key: 'Enter' });

  await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/users?groupId=g1'));
  expect(input).toHaveValue('');
  expect(screen.queryByRole('listbox', { name: 'Search results' })).not.toBeInTheDocument();
});

function Location() {
  const location = useLocation();
  return <output data-testid="location">{`${location.pathname}${location.search}`}</output>;
}

function response(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
