import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { expect, it, vi } from 'vitest';
import AcceptInvitation from './AcceptInvitation';

it('accepts the invitation with a password without storing the invitation secret', async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  render(<MemoryRouter><AcceptInvitation /></MemoryRouter>);
  for (const [label, value] of [['Invitation code', 'one-time'], ['Email', 'learner@test'], ['Display name', 'Learner'], ['Password', 'Pilot password 123!']]) {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  }
  fireEvent.click(screen.getByRole('button', { name: 'Accept invitation' }));
  expect(await screen.findByRole('status')).toHaveTextContent('You can now sign in');
  expect(fetchMock).toHaveBeenCalledWith('/api/provisioning/invitations/accept', expect.objectContaining({ body: JSON.stringify({ token: 'one-time', email: 'learner@test', displayName: 'Learner', password: 'Pilot password 123!' }) }));
  expect(screen.queryByLabelText('Invitation code')).not.toBeInTheDocument();
});

it('keeps rejected invitations retryable', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })));
  render(<MemoryRouter><AcceptInvitation /></MemoryRouter>);
  fireEvent.submit(screen.getByRole('button', { name: 'Accept invitation' }).closest('form')!);
  expect(await screen.findByRole('alert')).toHaveTextContent('Unauthorized');
  expect(screen.getByRole('button', { name: 'Accept invitation' })).toBeEnabled();
});
