import { fireEvent,render,screen } from '@testing-library/react';import { MemoryRouter } from 'react-router-dom';import { expect,it,vi } from 'vitest';import Bootstrap from './Bootstrap';const AUTH_SESSION_UPDATED_EVENT='mlearn-management-session-updated';it('requires recovery credential without persisting it',async()=>{sessionStorage.clear();vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({session:{accessToken:'a',refreshToken:'r',expiresAt:1}}),{status:200,headers:{'Content-Type':'application/json'}})));const sessionUpdated=vi.fn();window.addEventListener(AUTH_SESSION_UPDATED_EVENT,sessionUpdated);render(<MemoryRouter><Bootstrap/></MemoryRouter>);expect(screen.getByRole('button',{name:'Create administrator'})).toHaveAttribute('data-slot','button');fireEvent.change(screen.getByLabelText('Recovery credential'),{target:{value:'recovery-secret'}});fireEvent.change(screen.getByLabelText('Email'),{target:{value:'root@test'}});fireEvent.change(screen.getByLabelText('Password'),{target:{value:'long-password'}});fireEvent.change(screen.getByLabelText('Confirm password'),{target:{value:'long-password'}});fireEvent.click(screen.getByRole('button',{name:'Create administrator'}));await vi.waitFor(()=>expect(fetch).toHaveBeenCalledWith('/api/auth/bootstrap',expect.objectContaining({headers:expect.objectContaining({Authorization:'Bearer recovery-secret'})})));await vi.waitFor(()=>expect(sessionUpdated).toHaveBeenCalledOnce());expect(sessionStorage.getItem('recovery-token')).toBeNull();window.removeEventListener(AUTH_SESSION_UPDATED_EVENT,sessionUpdated)});

it('rejects a mismatched password confirmation before bootstrap', () => {
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  render(<MemoryRouter><Bootstrap /></MemoryRouter>);
  fireEvent.change(screen.getByLabelText('Recovery credential'), { target: { value: 'recovery-secret' } });
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'root@test' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'long-password' } });
  fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'different-password' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create administrator' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Passwords do not match.');
  expect(fetchMock).not.toHaveBeenCalled();
});

it('explains that bootstrap is unavailable after a root administrator exists', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'root administrator already exists' }), {
    status: 409,
    headers: { 'Content-Type': 'application/json' },
  })));
  render(<MemoryRouter><Bootstrap /></MemoryRouter>);
  fireEvent.change(screen.getByLabelText('Recovery credential'), { target: { value: 'recovery-secret' } });
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'root@test' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'long-password' } });
  fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'long-password' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create administrator' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('A root administrator already exists. Sign in instead.');
});

it('reports a network failure and permits retry', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
  render(<MemoryRouter><Bootstrap /></MemoryRouter>);
  fireEvent.submit(screen.getByRole('button', { name: 'Create administrator' }).closest('form')!);
  expect(await screen.findByRole('alert')).toHaveTextContent('Unable to reach Management');
  expect(screen.getByRole('button', { name: 'Create administrator' })).toBeEnabled();
});

it('recovers the root password through the recovery endpoint', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
  render(<MemoryRouter><Bootstrap recoveryMode /></MemoryRouter>);
  fireEvent.change(screen.getByLabelText('Recovery credential'), { target: { value: 'recovery' } });
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'root@test' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'New password 123!' } });
  fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'New password 123!' } });
  fireEvent.click(screen.getByRole('button', { name: 'Reset administrator password' }));
  expect(await screen.findByRole('status')).toHaveTextContent('Password reset');
  expect(fetch).toHaveBeenCalledWith('/api/auth/recover-root', expect.objectContaining({ method: 'POST' }));
});
