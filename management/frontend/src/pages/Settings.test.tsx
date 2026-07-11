import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import Settings from './Settings';

let isRoot = false;
vi.mock('../auth/AuthProvider', () => ({ useAuth: () => ({ status: 'authenticated', user: { isRoot } }) }));
vi.mock('./Config', () => ({ default: () => <div>Redacted deployment configuration</div> }));

beforeEach(() => { isRoot = false; });

it('covers governed school settings while keeping diagnostics hidden from non-root users', () => {
  render(<MemoryRouter><Settings /></MemoryRouter>);
  expect(screen.getByText('Redacted deployment configuration')).toBeVisible();
  expect(screen.getByRole('heading', { name: 'School identity' })).toBeVisible();
  expect(screen.getByRole('heading', { name: 'Timezone and term calendar' })).toBeVisible();
  expect(screen.getByRole('heading', { name: 'Retention and security' })).toBeVisible();
  expect(screen.getByRole('heading', { name: 'Backups' })).toBeVisible();
  expect(screen.getByRole('link', { name: 'Review retention controls' })).toBeVisible();
  expect(screen.queryByRole('link', { name: 'Open Diagnostics' })).not.toBeInTheDocument();
});

it('configures the authoritative root-school timezone and term calendar', async () => {
  isRoot = true;
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === '/api/groups') return json({ groups: [{ id: 'school', parentId: null, name: 'School', slug: 'school', status: 'active' }] });
    return json({ rootGroupId: 'school', timezone: 'Europe/Zurich', termStartsAt: 1782864000, termEndsAt: 1798675200, version: 1 });
  });
  vi.stubGlobal('fetch', fetchMock);
  render(<MemoryRouter><Settings /></MemoryRouter>);
  fireEvent.change(await screen.findByLabelText('School timezone'), { target: { value: 'Europe/Zurich' } });
  fireEvent.change(screen.getByLabelText('Term starts'), { target: { value: '2026-07-01' } });
  fireEvent.change(screen.getByLabelText('Term ends'), { target: { value: '2026-12-31' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save school calendar' }));
  expect(await screen.findByRole('status')).toHaveTextContent('calendar saved');
  expect(fetchMock).toHaveBeenCalledWith('/api/llm/quota-calendar', expect.objectContaining({ method: 'PUT', body: expect.stringContaining('Europe/Zurich') }));
});

function json(body: unknown) { return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })); }
