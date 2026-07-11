import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import { AppSidebar } from './AppSidebar';
import { BarChart } from './BarChart';
import { DataTableShell } from './DataTableShell';
import { LineChart } from './LineChart';

const can = vi.fn<(capability: string) => boolean>();
vi.mock('../groups/GroupScopeProvider', () => ({ useGroupScope: () => ({ status: 'ready', groups: [{ id: 'german-a', name: 'German A', capabilities: ['analytics.view'] }], selectedGroup: { id: 'german-a', name: 'German A', capabilities: ['analytics.view'] }, can }) }));
vi.mock('../auth/AuthProvider', () => ({ useAuth: () => ({ status: 'authenticated', user: { email: 'teacher@example.com' }, signOut: vi.fn() }) }));

beforeEach(() => can.mockImplementation((capability) => capability === 'analytics.view'));

it('shows only authorized navigation and keeps group scope visible', () => {
  render(<MemoryRouter><AppSidebar /></MemoryRouter>);
  expect(screen.getByRole('navigation', { name: 'Primary' })).toBeVisible();
  expect(screen.getByRole('link', { name: 'Analytics' })).toBeVisible();
  expect(screen.queryByRole('link', { name: 'LLM Gateway' })).not.toBeInTheDocument();
  expect(screen.getByText('German A')).toBeVisible();
});

it('gives chart series a visible key and screen-reader table', () => {
  render(<><LineChart title="Requests" data={[{ label: 'Mon', value: 4 }]} /><BarChart title="Tokens" data={[{ label: 'Mon', value: 9 }]} /></>);
  expect(screen.getByRole('img', { name: 'Requests' })).toBeVisible();
  expect(screen.getByRole('table', { name: 'Requests data' })).toHaveTextContent('Mon4');
  expect(screen.getByRole('table', { name: 'Tokens data' })).toHaveTextContent('Mon9');
});

it('renders explicit error and retry state for data surfaces', () => {
  const retry = vi.fn();
  render(<DataTableShell label="Users" error="Users could not be loaded" onRetry={retry} />);
  expect(screen.getByRole('alert')).toHaveTextContent('Users could not be loaded');
  screen.getByRole('button', { name: 'Retry' }).click();
  expect(retry).toHaveBeenCalledOnce();
});
