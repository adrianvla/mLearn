import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { NotificationMenu } from './NotificationMenu';

it('uses a regular notification list with keyboard-reachable actions', async () => {
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === 'PATCH') return new Response(null, { status: 204 });
    return json({ items: [{ fingerprint: 'low-quota:g:requests', kind: 'lowQuota', severity: 'warning', groupId: 'g', message: 'Requests quota is low', href: '/llm-gateway', createdAt: 1, read: false, dismissed: false }] });
  });
  vi.stubGlobal('fetch', fetchMock);
  render(<MemoryRouter><NotificationMenu groupId="g" /></MemoryRouter>);

  fireEvent.click(await screen.findByRole('button', { name: 'Notifications (1 unread)' }));
  expect(screen.getByRole('list', { name: 'Notifications' })).toBeVisible();
  expect(screen.getByRole('listitem')).toContainElement(screen.getByRole('article'));
  const notificationLink = screen.getByRole('link', { name: 'Requests quota is low' });
  notificationLink.focus();
  expect(document.activeElement).toBe(notificationLink);
  const markRead = screen.getByRole('button', { name: 'Mark notification as read' });
  expect(markRead).toBeVisible();
  markRead.focus();
  fireEvent.keyDown(markRead, { key: 'Enter', code: 'Enter' });
  fireEvent.keyUp(markRead, { key: 'Enter', code: 'Enter' });
  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/notifications/low-quota%3Ag%3Arequests?groupId=g', expect.objectContaining({ method: 'PATCH' })));
  fireEvent.click(screen.getByRole('button', { name: 'Dismiss notification' }));
  expect(fetchMock).toHaveBeenCalledWith('/api/notifications/low-quota%3Ag%3Arequests?groupId=g', expect.objectContaining({ method: 'PATCH' }));
});

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
