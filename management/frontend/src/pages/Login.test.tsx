import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { expect, it, vi } from 'vitest';
import Login, { DesktopApproval } from './Login';

const login = vi.fn();
vi.mock('../auth/AuthProvider', () => ({ useAuth: () => ({ status: 'signedOut', login }) }));

it('submits normal credentials through the session provider', () => {
  render(<MemoryRouter><Login /></MemoryRouter>);
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'admin@test' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password' } });
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  expect(login).toHaveBeenCalledWith('admin@test', 'password');
});

it('requires explicit approval for the authenticated desktop request', async () => {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ code: 'desktop-request', state: 'desktop-state' }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
  vi.stubGlobal('fetch', fetchMock);
  render(<MemoryRouter initialEntries={['/login?request=desktop-request']}><DesktopApproval /></MemoryRouter>);
  fireEvent.click(screen.getByRole('button', { name: 'Approve desktop login' }));
  expect(await screen.findByRole('status')).toHaveTextContent('Desktop login approved');
  expect(fetchMock).toHaveBeenCalledWith('/api/auth/desktop/approve', expect.objectContaining({ method: 'POST', body: JSON.stringify({ requestId: 'desktop-request' }) }));
});
