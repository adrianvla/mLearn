import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import Logs from './Logs';

let capabilities = ['conversations.view', 'conversations.export'];
vi.mock('../groups/GroupScopeProvider', () => ({
  useGroupScope: () => ({
    status: 'ready',
    selectedGroup: { id: 'german-a', name: 'German A' },
    groups: [
      { id: 'german-a', name: 'German A' },
      { id: 'project', name: 'Project' },
    ],
    can: (capability: string) => capabilities.includes(capability),
  }),
}));
vi.mock('../components/DatePickerField', () => ({
  DatePickerField: ({ label, value, onChange }: { label: string; value: string; onChange(value: string): void }) => <input aria-label={label} value={value} onChange={(event) => onChange(event.currentTarget.value)} />,
}));
vi.mock('../components/console', async () => {
  const actual = await vi.importActual<typeof import('../components/console')>('../components/console');
  return { ...actual, ConsoleSelect: ({ label, selectedKey, onSelectionChange, options }: { label: string; selectedKey: string; onSelectionChange(value: string): void; options: Array<{ key: string; label: string }> }) => <select aria-label={label} value={selectedKey} onChange={(event) => onSelectionChange(event.currentTarget.value)}><option value="" />{options.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}</select> };
});

beforeEach(() => {
  capabilities = ['conversations.view', 'conversations.export'];
});

it('loads scoped summaries and renders decrypted detail response', async () => {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const summary = conversation();
    return json(url.endsWith('/c1')
      ? { summary, messages: [{ role: 'user', content: 'Encrypted at rest, visible after authorization', sequence: 0, truncated: false }] }
      : { items: [summary], nextCursor: null });
  }));
  render(<Logs />);
  fireEvent.click(await screen.findByRole('button', { name: 'learner' }));
  expect(await screen.findByText('Encrypted at rest, visible after authorization')).toBeVisible();
  expect(screen.getAllByText('openai / model')).toHaveLength(2);
});

it('sends every governance filter to the scoped query and confirms audited export', async () => {
  const fetchMock = vi.fn(async (_input: RequestInfo | URL) => json({ items: [conversation()], nextCursor: null }));
  vi.stubGlobal('fetch', fetchMock);
  render(<Logs />);
  await screen.findByRole('button', { name: 'learner' });
  fireEvent.change(screen.getByLabelText('Learner'), { target: { value: 'learner-2' } });
  fireEvent.change(screen.getByLabelText('Descendant group'), { target: { value: 'project' } });
  fireEvent.change(screen.getByLabelText('Provider'), { target: { value: 'openai' } });
  fireEvent.change(screen.getByLabelText('Model'), { target: { value: 'gpt-4.1' } });
  fireEvent.change(screen.getByLabelText('From date'), { target: { value: '2026-07-01' } });
  fireEvent.change(screen.getByLabelText('To date'), { target: { value: '2026-07-11' } });
  fireEvent.change(screen.getByLabelText('Conversation status'), { target: { value: 'policy-blocked' } });
  await waitFor(() => expect(fetchMock).toHaveBeenLastCalledWith(expect.stringMatching(/groupId=project/), expect.anything()));
  const lastUrl = String(fetchMock.mock.calls.at(-1)?.[0]);
  expect(lastUrl).toContain('learnerUserId=learner-2');
  expect(lastUrl).toContain('providerId=openai');
  expect(lastUrl).toContain('modelId=gpt-4.1');
  expect(lastUrl).toContain('policyBlocked=true');
  expect(lastUrl).toContain('from=');
  expect(lastUrl).toContain('to=');
  fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
  expect(screen.getByRole('dialog', { name: 'Export conversations?' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Confirm export' })).toBeEnabled();
});

it('hides export without conversations.export', async () => {
  capabilities = ['conversations.view'];
  vi.stubGlobal('fetch', vi.fn(async () => json({ items: [], nextCursor: null })));
  render(<Logs />);
  await waitFor(() => expect(fetch).toHaveBeenCalled());
  expect(screen.queryByRole('button', { name: 'Export CSV' })).not.toBeInTheDocument();
});

function conversation() {
  return { id: 'c1', groupId: 'german-a', learnerUserId: 'learner', status: 'completed', createdAt: 1_700_000_000, providerId: 'openai', modelId: 'model', inputTokens: 10, outputTokens: 5, costMicros: 1000, policyVersionId: 'policy', policyCompiledHash: 'hash', errorCode: null };
}

function json(body: unknown) {
  return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } }));
}
