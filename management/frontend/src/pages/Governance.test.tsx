import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import Governance from './Governance';

vi.mock('../groups/GroupScopeProvider', () => ({
  useGroupScope: () => ({ status: 'ready', selectedGroup: { id: 'g', name: 'German' }, can: () => true }),
}));

it('renders only the lean governance sections with scoped links', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => json({
    policies: [{ name: 'Reading', status: 'Published', href: '/policies' }],
    usage: [{ label: 'Requests', detail: '8 of 10 used', href: '/llm-gateway' }],
    activity: [{ action: 'policy.published', timestamp: 1, href: '/activity' }],
  })));
  render(<MemoryRouter><Governance /></MemoryRouter>);

  expect(await screen.findByRole('heading', { name: 'Policies' })).toBeVisible();
  expect(screen.getByRole('heading', { name: 'Usage and limits' })).toBeVisible();
  expect(screen.getByRole('heading', { name: 'Recent governance activity' })).toBeVisible();
  expect(screen.getByRole('link', { name: /Reading/ })).toHaveAttribute('href', '/policies');
  expect(screen.getByRole('link', { name: /policy.published/ })).toHaveAttribute('href', '/activity');
  expect(screen.queryByText(/simulation|approval|drift|remediation/i)).not.toBeInTheDocument();
});

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
