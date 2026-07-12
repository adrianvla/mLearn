import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import Analytics from './Analytics';

vi.mock('../groups/GroupScopeProvider', () => ({
  useGroupScope: () => ({ status: 'ready', selectedGroup: { id: 'german', name: 'German' }, can: () => true }),
}));

const values = { activeLearners: 2, sessions: 3, watchSeconds: 120, completions: 1, readerPages: 2, flashcardEvents: 3, llmRequests: 4, inputTokens: 10, outputTokens: 5, totalTokens: 15, costMicros: 1000, policyBlocks: 1 };
const history = { timezone: 'UTC', granularity: 'daily', primary: [{ start: 1_700_000_000_000, end: 1_700_086_400_000, coverage: 'complete' as const, values }], comparison: null };

function installFetch(overrides: Partial<Record<'history' | 'llm' | 'blocks', Response>> = {}) {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/api/analytics/history')) return overrides.history?.clone() ?? json(history);
    if (url.includes('/api/analytics/llm')) return overrides.llm?.clone() ?? json({ requests: 4, inputTokens: 10, outputTokens: 5, totalTokens: 15, costMicros: 1000 });
    if (url.includes('/api/analytics/policy-blocks')) return overrides.blocks?.clone() ?? json({ blocks: 1 });
    if (url.includes('/api/llm/usage')) return json({ buckets: [{ scopeKind: 'user', scopeId: 'u', remaining: 75 }] });
    if (url.includes('/learners')) return json({ items: [{ ...values, learnerId: 'u', displayName: 'Learner', lastActivityAt: 1_700_000_000_000 }] });
    if (url.includes('/content')) return json({ items: [{ ...values, key: 'content-1', title: 'First video', lastActivityAt: 1_700_000_000_000 }] });
    return json(values);
  }));
}

it('renders every scoped analytics view and requires export confirmation', async () => {
  installFetch();
  render(<Analytics />);

  expect(await screen.findByRole('img', { name: 'Activity history' })).toBeVisible();
  fireEvent.click(screen.getByRole('tab', { name: 'learners' }));
  expect((await screen.findAllByText('Learner')).length).toBeGreaterThanOrEqual(1);
  expect(screen.getByText('0.0010')).toBeVisible();
  expect(screen.getByText('75')).toBeVisible();
  fireEvent.click(screen.getByRole('tab', { name: 'content' }));
  expect(await screen.findByText('First video')).toBeVisible();
  fireEvent.click(screen.getByRole('tab', { name: 'llm usage' }));
  expect(screen.getByText('Input tokens')).toBeVisible();
  fireEvent.click(screen.getByRole('tab', { name: 'policy blocks' }));
  expect(screen.getByText('Blocked requests')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
  expect(screen.getByRole('dialog', { name: 'Export learner analytics?' })).toBeVisible();
  expect(fetch).toHaveBeenCalledWith(expect.stringContaining('groupId=german'), expect.anything());
});

it('loads a previous-period comparison and keeps chart and table values aligned', async () => {
  installFetch({ history: json({ ...history, comparison: [{ start: 1_699_913_600_000, end: 1_700_000_000_000, coverage: 'complete', values }] }) });
  render(<Analytics />);
  fireEvent.click(await screen.findByRole('button', { name: /Comparison/i }));
  fireEvent.click(screen.getByRole('option', { name: 'Previous period' }));

  expect(await screen.findByRole('img', { name: 'Activity history' })).toBeVisible();
  expect(screen.getByRole('table', { name: 'Activity history data' })).toHaveTextContent('Previous period');
});

it('keeps activity history visible when the LLM usage panel fails', async () => {
  installFetch({ llm: new Response(JSON.stringify({ error: 'LLM usage is unavailable.' }), { status: 503, headers: { 'Content-Type': 'application/json' } }) });
  render(<Analytics />);

  expect(await screen.findByRole('img', { name: 'Activity history' })).toBeVisible();
  expect(await screen.findByRole('alert')).toHaveTextContent('Unable to load llm usage. LLM usage is unavailable.');
  expect(screen.getByRole('img', { name: 'Activity history' })).toBeVisible();
});

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
