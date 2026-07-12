import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { AuthorizedUser } from '../api/types';
import { ApiError } from '../api/client';
import { AuthProvider, useAuth, type AuthApi } from './AuthProvider';

const USER: AuthorizedUser = { id: 'user-1', email: 'teacher@example.com', groups: [] };

function Probe() {
  const auth = useAuth();
  return <div>{auth.status === 'authenticated' ? auth.user.email : auth.status}</div>;
}

beforeEach(() => sessionStorage.clear());

it('exposes loading then restores an authenticated session', async () => {
  let resolveMe!: (user: AuthorizedUser) => void;
  const me = vi.fn(() => new Promise<AuthorizedUser>((resolve) => { resolveMe = resolve; }));
  const api: AuthApi = { me, login: vi.fn(), logout: vi.fn(), clearSession: vi.fn() };
  render(<AuthProvider api={api}><Probe /></AuthProvider>);
  expect(screen.getByText('loading')).toBeVisible();
  resolveMe(USER);
  expect(await screen.findByText(USER.email)).toBeVisible();
});

it('exposes an explicit error state when restoration fails without a 401', async () => {
  const api: AuthApi = {
    me: vi.fn().mockRejectedValue(new Error('network down')),
    login: vi.fn(), logout: vi.fn(), clearSession: vi.fn(),
  };
  render(<AuthProvider api={api}><Probe /></AuthProvider>);
  expect(await screen.findByText('error')).toBeVisible();
});

it('never accepts a bootstrap recovery credential into session state', async () => {
  const api: AuthApi = { me: vi.fn().mockResolvedValue(USER), login: vi.fn(), logout: vi.fn(), clearSession: vi.fn() };
  render(<AuthProvider api={api}><Probe /></AuthProvider>);
  await screen.findByText(USER.email);
  expect(sessionStorage.getItem('recovery-token')).toBeNull();
  await waitFor(() => expect(api.me).toHaveBeenCalledOnce());
});

it('restores authentication when bootstrap creates a session', async () => {
  const me = vi.fn()
    .mockRejectedValueOnce(new ApiError(401, 'Unauthorized', null))
    .mockResolvedValueOnce(USER);
  const api: AuthApi = { me, login: vi.fn(), logout: vi.fn(), clearSession: vi.fn() };
  render(<AuthProvider api={api}><Probe /></AuthProvider>);

  expect(await screen.findByText('signedOut')).toBeVisible();
  window.dispatchEvent(new Event('mlearn-management-session-updated'));

  expect(await screen.findByText(USER.email)).toBeVisible();
  expect(me).toHaveBeenCalledTimes(2);
});
