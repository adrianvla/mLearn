import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import Overview from './Overview';

vi.mock('../groups/GroupScopeProvider', () => ({ useGroupScope: () => ({ status: 'ready', selectedGroup: { id: 'german', name: 'German', capabilities: ['analytics.view'] }, groups: [], can: () => true }) }));

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/summary')) return response({ activeLearners: 12, sessions: 18, watchSeconds: 600, completions: 3, readerPages: 8, flashcardEvents: 4, llmRequests: 24, inputTokens: 400, outputTokens: 200, totalTokens: 600, costMicros: 120000, policyBlocks: 2 });
    if (url.includes('/timeseries')) return response([{ dayStart: 1_700_000_000_000, activeLearners: 4, sessions: 5, watchSeconds: 60, completions: 1, readerPages: 2, flashcardEvents: 1, llmRequests: 7, inputTokens: 100, outputTokens: 50, totalTokens: 150, costMicros: 30000, policyBlocks: 1 }]);
    if (url.includes('/llm')) return response({ requests: 24, inputTokens: 400, outputTokens: 200, totalTokens: 600, costMicros: 120000 });
    if (url.includes('/api/audit/events')) return response({ events: [{ id: 'audit-1', actor: 'teacher', action: 'policy.published', targetType: 'policy', targetId: 'reading', authorizedGroupId: 'german', timestamp: 1_700_000_000, requestId: null, metadata: null }], nextCursor: null });
    return response({ items: [{ learnerId: 'learner', displayName: 'Ada Learner', lastActivityAt: 1_700_000_000_000, activeLearners: 1, sessions: 2, watchSeconds: 120, completions: 1, readerPages: 2, flashcardEvents: 1, llmRequests: 3, inputTokens: 20, outputTokens: 10, totalTokens: 30, costMicros: 1000, policyBlocks: 0 }] });
  }));
});

it('renders the selected-group school dashboard without operational diagnostics', async () => {
  render(<Overview />);
  expect(await screen.findByText('policy.published')).toBeVisible();
  expect(screen.getAllByTestId('dashboard-metric')).toHaveLength(4);
  expect(screen.getByRole('region', { name: 'Dashboard analysis' })).toBeVisible();
  expect(screen.getByText('Active learners')).toBeVisible();
  expect(screen.getAllByText('LLM requests').length).toBeGreaterThanOrEqual(2);
  expect(screen.getByText('Policy blocks')).toBeVisible();
  expect(screen.getByText('Quota consumed')).toBeVisible();
  expect(screen.getByRole('img', { name: 'LLM requests' })).toBeVisible();
  expect(screen.getByText('School controls')).toBeVisible();
  expect(await screen.findByRole('heading', { name: 'Recent administrative activity' })).toBeVisible();
  expect(screen.getByRole('link', { name: 'View all activity' })).toHaveAttribute('href', '/activity');
  expect(screen.queryByText('Container logs')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('tab', { name: 'Usage' }));
  expect(screen.getByRole('tab', { name: 'Usage' })).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByRole('heading', { name: 'Token usage' })).toBeVisible();
  fireEvent.click(screen.getByRole('tab', { name: 'Security' }));
  expect(screen.getByRole('heading', { name: 'Policy enforcement' })).toBeVisible();
  expect(fetch).toHaveBeenCalledWith(expect.stringContaining('groupId=german'), expect.objectContaining({ signal: expect.any(AbortSignal) }));
  fireEvent.change(screen.getByLabelText('Date period'), { target: { value: '7' } });
  expect(await screen.findByLabelText('Date period')).toHaveValue('7');
  expect(fetch).toHaveBeenCalledWith(expect.stringMatching(/from=\d+&to=\d+/), expect.anything());
});

function response(body: unknown) { return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })); }
