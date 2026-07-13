import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { NotificationMenu } from './NotificationMenu';

it('shows an unread count and records explicit read and dismissal actions', async () => {
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === 'PATCH') return new Response(null, { status: 204 });
    return json({ items: [{ fingerprint: 'low-quota:g:requests', kind: 'lowQuota', severity: 'warning', groupId: 'g', message: 'Requests quota is low', href: '/llm-gateway', createdAt: 1, read: false, dismissed: false }] });
  });
  vi.stubGlobal('fetch', fetchMock);
  render(<MemoryRouter><NotificationMenu groupId="g" /></MemoryRouter>);

  fireEvent.click(await screen.findByRole('button', { name: 'Notifications (1 unread)' }));
  fireEvent.click(screen.getByRole('button', { name: 'Mark notification as read' }));
  fireEvent.click(screen.getByRole('button', { name: 'Dismiss notification' }));
  expect(fetchMock).toHaveBeenCalledWith('/api/notifications/low-quota%3Ag%3Arequests?groupId=g', expect.objectContaining({ method: 'PATCH' }));
});

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
