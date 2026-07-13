import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import Analytics from './Analytics';

vi.mock('../groups/GroupScopeProvider', () => ({
  useGroupScope: () => ({ status: 'ready', selectedGroup: { id: 'german', name: 'German' }, can: () => true }),
}));
vi.mock('../components/DatePickerField', () => ({
  DatePickerField: ({ label, value, onChange }: { label: string; value: string; onChange(value: string): void }) => <input aria-label={label} value={value} onChange={(event) => onChange(event.currentTarget.value)} />,
}));

const values = { activeLearners: 2, sessions: 3, watchSeconds: 120, completions: 1, readerPages: 2, flashcardEvents: 3, llmRequests: 4, inputTokens: 10, outputTokens: 5, totalTokens: 15, costMicros: 1000, policyBlocks: 1 };
const history = { timezone: 'UTC', granularity: 'daily', primary: [{ start: 1_700_000_000_000, end: 1_700_086_400_000, coverage: 'complete' as const, values }], comparison: null };

function installFetch(overrides: Partial<Record<'history' | 'llm' | 'blocks' | 'learners' | 'content', Response>> & { historyEvents?: Response | ((url: string) => Response) } = {}) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/api/analytics/views?')) return json({ items: [{ id: 'saved-learner-focus', name: 'Learner focus', definition: { groupId: 'german', from: history.primary[0].start, to: history.primary[0].end, preset: 'custom', comparison: 'none', granularity: 'daily', tab: 'learners', visibleMetrics: ['flashcardEvents'], breakdown: 'learners' }, createdAt: 1, updatedAt: 1 }] });
    if (url.includes('/api/analytics/history/events')) {
      const response = overrides.historyEvents;
      return typeof response === 'function' ? response(url) : response?.clone() ?? json({ from: history.primary[0].start, to: history.primary[0].end, coverage: 'complete', total: 1, items: [{ id: 'activity:1', occurredAt: history.primary[0].start, learnerId: 'u', activityKind: 'reader', eventType: 'activity.progressed', contentTitle: 'First reader', readerPage: 4, videoTimeMillis: null }], nextCursor: null });
    }
    if (url.includes('/api/analytics/history')) return overrides.history?.clone() ?? json(history);
    if (url.includes('/api/analytics/llm')) return overrides.llm?.clone() ?? json({ requests: 4, inputTokens: 10, outputTokens: 5, totalTokens: 15, costMicros: 1000 });
    if (url.includes('/api/analytics/policy-blocks')) return overrides.blocks?.clone() ?? json({ blocks: 1 });
    if (url.includes('/api/llm/usage')) return json({ buckets: [{ scopeKind: 'user', scopeId: 'u', remaining: 75 }] });
    if (url.includes('/learners')) return overrides.learners?.clone() ?? json({ items: [{ ...values, learnerId: 'u', displayName: 'Learner', lastActivityAt: 1_700_000_000_000 }] });
    if (url.includes('/content')) return overrides.content?.clone() ?? json({ items: [{ ...values, key: 'content-1', title: 'First video', lastActivityAt: 1_700_000_000_000 }] });
    return json(values);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

it('renders every scoped analytics view and requires export confirmation', async () => {
  installFetch();
  render(<Analytics />);

  expect(await screen.findByText('Active learners')).toBeVisible();
  expect(screen.getByText('2')).toBeVisible();
  expect(screen.getByRole('img', { name: 'Activity history' })).toBeVisible();
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
  expect(screen.getByRole('dialog', { name: 'Export analytics?' })).toBeVisible();
  expect(fetch).toHaveBeenCalledWith(expect.stringContaining('groupId=german'), expect.anything());
});

it('restores a saved view as one analytics state including filters, tab, metrics, and breakdown', async () => {
  installFetch();
  render(<Analytics />);

  const savedViewLabel = await screen.findByText('Saved view');
  fireEvent.click(savedViewLabel.parentElement?.querySelector('button') as HTMLButtonElement);
  fireEvent.click(screen.getByRole('option', { name: 'Learner focus' }));

  expect((await screen.findAllByText('Learner')).length).toBeGreaterThanOrEqual(1);
  expect(savedViewLabel.parentElement).toHaveTextContent('Learner focus');
  expect(screen.getByRole('heading', { name: 'Learner breakdown' })).toBeVisible();
  expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/api/analytics/learners?groupId=german&from=1700000000000&to=1700086400000'), expect.anything());
});

it('renders a factual workspace for each breakdown selection', async () => {
  installFetch();
  render(<Analytics />);

  expect(await screen.findByText('No breakdown selected.')).toBeVisible();
  fireEvent.click(breakdownButton());
  fireEvent.click(screen.getByRole('option', { name: 'Learners' }));
  expect(await screen.findByRole('heading', { name: 'Learner breakdown' })).toBeVisible();
  expect(screen.getByRole('table', { name: 'Learner breakdown' })).toHaveTextContent('Learner');
  fireEvent.click(breakdownButton());
  fireEvent.click(screen.getByRole('option', { name: 'Content' }));
  expect(await screen.findByRole('heading', { name: 'Content breakdown' })).toBeVisible();
  expect(screen.getByRole('table', { name: 'Content breakdown' })).toHaveTextContent('First video');
});

it('shows a factual breakdown error instead of an empty learner table', async () => {
  installFetch({ learners: new Response(JSON.stringify({ error: 'Learner analytics is unavailable.' }), { status: 503, headers: { 'Content-Type': 'application/json' } }) });
  render(<Analytics />);

  await screen.findByText('Breakdown');
  fireEvent.click(breakdownButton());
  fireEvent.click(screen.getByRole('option', { name: 'Learners' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Unable to load learner breakdown. Learner analytics is unavailable.');
});

it('requires explicit confirmation before overwriting the selected saved view', async () => {
  const fetchMock = installFetch();
  render(<Analytics />);

  const savedViewLabel = await screen.findByText('Saved view');
  fireEvent.click(savedViewLabel.parentElement?.querySelector('button') as HTMLButtonElement);
  fireEvent.click(screen.getByRole('option', { name: 'Learner focus' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save view' }));

  expect(screen.getByRole('dialog', { name: 'Overwrite saved analytics view' })).toBeVisible();
  expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining('/api/analytics/views/saved-learner-focus'), expect.objectContaining({ method: 'PUT' }));
  fireEvent.click(screen.getByRole('button', { name: 'Overwrite view' }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/analytics/views/saved-learner-focus', expect.objectContaining({ method: 'PUT' })));
});

it('loads a previous-period comparison and keeps chart and table values aligned', async () => {
  installFetch({ history: json({ ...history, comparison: [{ start: 1_699_913_600_000, end: 1_700_000_000_000, coverage: 'complete', values }] }) });
  render(<Analytics />);
  fireEvent.click(await screen.findByRole('button', { name: /Comparison/i }));
  fireEvent.click(screen.getByRole('option', { name: 'Previous period' }));

  expect(await screen.findByRole('img', { name: 'Activity history' })).toBeVisible();
  expect(screen.getByRole('table', { name: 'Activity history data' })).toHaveTextContent('Previous period');
});

it('renders previous-year activity alongside the current period with each period date', async () => {
  const comparison = [{ start: 1_670_000_000_000, end: 1_670_086_400_000, coverage: 'complete', values }];
  installFetch({ history: json({ ...history, comparison }) });
  render(<Analytics />);
  fireEvent.click(await screen.findByRole('button', { name: /Comparison/i }));
  fireEvent.click(screen.getByRole('option', { name: 'Previous year' }));

  expect(await screen.findByTestId('stacked-bar-0-comparison')).toBeVisible();
  const table = screen.getByRole('table', { name: 'Activity history data' });
  expect(table).toHaveTextContent('Previous year');
  expect(table).toHaveTextContent(new Date(comparison[0].start).toLocaleDateString());
});

it('opens the factual event history drawer for a chart bucket and follows its cursor', async () => {
  const first = { id: 'activity:1', occurredAt: history.primary[0].start, learnerId: 'u', activityKind: 'reader', eventType: 'activity.progressed', contentTitle: 'First reader', readerPage: 4, videoTimeMillis: null };
  const second = { ...first, id: 'activity:2', occurredAt: history.primary[0].start - 1, eventType: 'activity.completed', contentTitle: 'Second reader', readerPage: null };
  installFetch({
    historyEvents: (url) => json(url.includes('cursor=next-page')
      ? { from: history.primary[0].start, to: history.primary[0].end, coverage: 'complete', total: 2, items: [second], nextCursor: null }
      : { from: history.primary[0].start, to: history.primary[0].end, coverage: 'complete', total: 2, items: [first], nextCursor: 'next-page' }),
  });
  render(<Analytics />);

  const periodName = `Open event history for ${new Date(history.primary[0].start).toLocaleDateString()} to ${new Date(history.primary[0].end).toLocaleDateString()}`;
  expect(document.querySelector('svg [role="button"]')).toBeNull();
  fireEvent.click(await screen.findByRole('button', { name: periodName }));
  expect(await screen.findByRole('dialog', { name: 'Recorded events' })).toBeVisible();
  await waitFor(() => expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/api/analytics/history/events'), expect.anything()));
  expect(await screen.findByText(/First reader/)).toBeVisible();
  expect(screen.getByText('1 of 2 recorded events')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Load more events' }));
  await waitFor(() => expect(fetch).toHaveBeenCalledWith(expect.stringContaining('cursor=next-page'), expect.anything()));
  expect(await screen.findByText(/Second reader/)).toBeVisible();
  expect(screen.getByText(/First reader/)).toBeVisible();
});

it('rejects an invalid custom range without replacing the loaded learner data', async () => {
  const fetchMock = installFetch();
  render(<Analytics />);
  await screen.findByRole('img', { name: 'Activity history' });
  fireEvent.click(screen.getByRole('tab', { name: 'learners' }));
  expect((await screen.findAllByText('Learner')).length).toBeGreaterThanOrEqual(1);
  fireEvent.click(screen.getByRole('button', { name: /Date range/ }));
  fireEvent.click(screen.getByRole('option', { name: 'Custom range' }));
  const requestCount = fetchMock.mock.calls.length;
  fireEvent.change(screen.getByLabelText('To date'), { target: { value: '2020-01-01' } });

  expect(await screen.findByRole('alert')).toHaveTextContent('Choose a range from one to 366 days.');
  expect(screen.getByRole('button', { name: 'Export CSV' })).toBeDisabled();
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(requestCount));
  expect(screen.getAllByText('Learner').length).toBeGreaterThanOrEqual(1);
});

it('rejects a pre-1970 custom start without replacing loaded learner data or fetching analytics', async () => {
  const fetchMock = installFetch();
  render(<Analytics />);
  await screen.findByRole('img', { name: 'Activity history' });
  fireEvent.click(screen.getByRole('tab', { name: 'learners' }));
  expect((await screen.findAllByText('Learner')).length).toBeGreaterThanOrEqual(1);
  fireEvent.click(screen.getByRole('button', { name: /Date range/ }));
  fireEvent.click(screen.getByRole('option', { name: 'Custom range' }));
  fireEvent.change(screen.getByLabelText('From date'), { target: { value: '1969-12-31' } });
  const requestCount = fetchMock.mock.calls.length;
  fireEvent.change(screen.getByLabelText('To date'), { target: { value: '1970-01-01' } });

  expect(await screen.findByRole('alert')).toHaveTextContent('Choose a range from one to 366 days.');
  expect(screen.getByRole('button', { name: 'Export CSV' })).toBeDisabled();
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(requestCount));
  expect(screen.getAllByText('Learner').length).toBeGreaterThanOrEqual(1);
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

function breakdownButton(): HTMLButtonElement {
  return screen.getByText('Breakdown').parentElement?.querySelector('button') as HTMLButtonElement;
}
