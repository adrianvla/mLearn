import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { expect, it, vi } from 'vitest';
import { AppSidebar } from '../components/AppSidebar';
import { GroupTree } from '../components/GroupTree';
import Layout from '../Layout';
import { useState } from 'react';

const can = vi.fn((capability: string) => ['members.view', 'group.view', 'policies.view', 'analytics.view', 'conversations.view'].includes(capability));
vi.mock('../groups/GroupScopeProvider', () => ({ useGroupScope: () => ({ status: 'ready', groups: [{ id: 'german-a', name: 'German A' }], selectedGroup: { id: 'german-a', name: 'German A', capabilities: [] }, can }) }));
vi.mock('../auth/AuthProvider', () => ({ useAuth: () => ({ status: 'authenticated', user: { email: 'teacher@test', isRoot: false }, signOut: vi.fn() }) }));

it('keeps the German A teacher inside the authorized subtree and navigation boundary', () => {
  render(<MemoryRouter><AppSidebar /><GroupTree groups={[{ id: 'german-a', parentId: null, name: 'German A', slug: 'german-a', status: 'active' }, { id: 'project', parentId: 'german-a', name: 'Project', slug: 'project', status: 'active' }]} selectedId="german-a" onSelect={vi.fn()} /></MemoryRouter>);
  expect(screen.getByRole('link', { name: 'Analytics' })).toBeVisible();
  expect(screen.getByRole('link', { name: 'Conversation Logs' })).toBeVisible();
  expect(screen.queryByRole('link', { name: 'LLM Gateway' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Projectactive' })).toBeVisible();
  expect(screen.queryByText('German B')).not.toBeInTheDocument();
});

it('restores focus to the navigation trigger after the drawer closes', () => {
  render(<MemoryRouter><Routes><Route element={<Layout />}><Route index element={<div>Dashboard content</div>} /></Route></Routes></MemoryRouter>);
  const trigger = screen.getByRole('button', { name: 'Open navigation' });
  fireEvent.click(trigger);
  fireEvent.click(screen.getAllByRole('button', { name: 'Close navigation' })[1]);
  expect(trigger).toHaveFocus();
});

it('moves focus into dialogs and restores the invoking control', async () => {
  function DialogProbe() {
    const [open, setOpen] = useState(false);
    return <><button onClick={() => setOpen(true)}>Open governed action</button>{open ? <section role="dialog" aria-modal="true" aria-label="Governed action"><button onClick={() => setOpen(false)}>Close governed action</button></section> : null}</>;
  }
  render(<MemoryRouter><Routes><Route element={<Layout />}><Route index element={<DialogProbe />} /></Route></Routes></MemoryRouter>);
  const trigger = screen.getByRole('button', { name: 'Open governed action' });
  trigger.focus();
  fireEvent.click(trigger);
  const close = screen.getByRole('button', { name: 'Close governed action' });
  await waitFor(() => expect(close).toHaveFocus());
  fireEvent.click(close);
  await waitFor(() => expect(trigger).toHaveFocus());
});
