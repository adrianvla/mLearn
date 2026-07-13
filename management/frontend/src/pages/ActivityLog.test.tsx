import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import ActivityLog from './ActivityLog';

vi.mock('../groups/GroupScopeProvider', () => ({
  useGroupScope: () => ({
    status: 'ready',
    selectedGroup: { id: 'german', name: 'German', capabilities: ['group.view'] },
    groups: [{ id: 'german', name: 'German', capabilities: ['group.view'] }],
    can: () => true,
  }),
}));

it('loads scoped audit events with safe filters and opens redacted event details', async () => {
  const fetchMock = vi.fn(async () => response({
    events: [{
      id: 'event-1', actor: 'teacher-1', action: 'llm.quota.updated',
      targetType: 'llm_quota', targetId: 'reading', authorizedGroupId: 'german',
      timestamp: 1_700_000_000, requestId: 'request-1',
      metadata: { summary: 'Updated reading access', apiKey: '[REDACTED]' },
    }],
    nextCursor: null,
  }));
  vi.stubGlobal('fetch', fetchMock);

  render(<ActivityLog />);

  expect(await screen.findByText('llm.quota.updated')).toBeVisible();
  fireEvent.change(screen.getByLabelText('Actor user ID'), { target: { value: 'teacher-1' } });
  fireEvent.change(screen.getByLabelText('Action'), { target: { value: 'llm.quota.updated' } });
  fireEvent.change(screen.getByLabelText('Target type'), { target: { value: 'llm_quota' } });
  fireEvent.change(screen.getByLabelText('Target ID'), { target: { value: 'reading' } });

  await waitFor(() => expect(fetchMock).toHaveBeenLastCalledWith(
    expect.stringContaining('groupId=german&actorUserId=teacher-1&action=llm.quota.updated&targetType=llm_quota&targetId=reading'),
    expect.objectContaining({ signal: expect.any(AbortSignal) }),
  ));

  fireEvent.click(screen.getByRole('button', { name: 'llm.quota.updated' }));
  const dialog = await screen.findByRole('dialog', { name: 'Activity event' });
  expect(dialog).toBeVisible();
  expect(screen.getByLabelText('Redacted event metadata')).toHaveTextContent('Updated reading access');
  expect(screen.getByLabelText('Redacted event metadata')).toHaveTextContent('[REDACTED]');

  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Activity event' })).not.toBeInTheDocument());
  fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
  await waitFor(() => expect(fetchMock).toHaveBeenLastCalledWith(
    '/api/audit/events?groupId=german',
    expect.objectContaining({ signal: expect.any(AbortSignal) }),
  ));
});

function response(body: unknown) {
  return Promise.resolve(new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  }));
}
