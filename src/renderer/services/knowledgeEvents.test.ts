import { describe, it, expect, vi, beforeEach } from 'vitest';

const queryForLanguage = vi.fn();
const appendKnowledgeEvents = vi.fn();
const onKnowledgeEventsChanged = vi.fn();

vi.mock('../../shared/bridges', () => ({
  getBridge: () => ({
    knowledgeEvents: {
      queryKnowledgeEventsForLanguage: (...args: unknown[]) => queryForLanguage(...args),
      appendKnowledgeEvents: (...args: unknown[]) => appendKnowledgeEvents(...args),
      queryKnowledgeEvents: vi.fn().mockResolvedValue({}),
      onKnowledgeEventsChanged: (...args: unknown[]) => onKnowledgeEventsChanged(...args),
    },
  }),
}));

describe('knowledgeEvents language-log cache', () => {
  beforeEach(() => {
    vi.resetModules();
    queryForLanguage.mockReset();
    appendKnowledgeEvents.mockReset().mockResolvedValue(true);
    onKnowledgeEventsChanged.mockReset();
  });

  // Module-loading boundary: the service under test owns module-scoped cache
  // state, so each test must import a fresh instance after resetModules.
  async function importService() {
    return await import('./knowledgeEvents');
  }

  it('serves repeated reads within one events version from one IPC fetch', async () => {
    queryForLanguage.mockResolvedValue({ 'ja:h1': [{ t: 1, kind: 'rollup', source: 'passiveTracking' }] });
    const svc = await importService();

    const first = await svc.getEventLogForLanguage('ja');
    const second = await svc.getEventLogForLanguage('ja');
    const third = await svc.getEventsForLanguage('ja');

    expect(queryForLanguage).toHaveBeenCalledTimes(1);
    expect(first).toBe(second);
    expect(third).toHaveLength(1);
  });

  it('refetches once after a local append bumps the events version', async () => {
    queryForLanguage.mockResolvedValue({ 'ja:h1': [{ t: 1, kind: 'rollup', source: 'passiveTracking' }] });
    const svc = await importService();
    await svc.getEventLogForLanguage('ja');

    await svc.appendEvents({ 'ja:h2': [{ t: 2, kind: 'rollup', source: 'passiveTracking', timesSeenDelta: 1 }] });
    queryForLanguage.mockResolvedValue({
      'ja:h1': [{ t: 1, kind: 'rollup', source: 'passiveTracking' }],
      'ja:h2': [{ t: 2, kind: 'rollup', source: 'passiveTracking' }],
    });

    const refetched = await svc.getEventLogForLanguage('ja');
    expect(queryForLanguage).toHaveBeenCalledTimes(2);
    expect(Object.keys(refetched)).toContain('ja:h2');

    // Reads within the new version hit the cache again.
    await svc.getEventLogForLanguage('ja');
    expect(queryForLanguage).toHaveBeenCalledTimes(2);
  });

  it('keeps only the fresh response when a broadcast invalidates an in-flight fetch', async () => {
    const svc = await importService();
    const { promise: gated, resolve: releaseFirst } = Promise.withResolvers<{ 'ja:stale': { t: number; kind: string; source: string }[] }>();
    queryForLanguage.mockImplementationOnce(() => gated);
    const staleRead = svc.getEventLogForLanguage('ja');

    // Remote change lands while the first fetch is in flight: bumpVersion runs
    // via the registered bridge listener.
    expect(onKnowledgeEventsChanged).toHaveBeenCalled();
    const bump = onKnowledgeEventsChanged.mock.calls[0][0] as () => void;
    bump();

    const freshLog = { 'ja:fresh': [{ t: 9, kind: 'rollup', source: 'passiveTracking' }] };
    queryForLanguage.mockResolvedValue(freshLog);
    const freshRead = svc.getEventLogForLanguage('ja');

    // The stale fetch resolves LAST — its payload must not overwrite the fresh one.
    releaseFirst({ 'ja:stale': [{ t: 0, kind: 'rollup', source: 'passiveTracking' }] });
    await staleRead;
    const settled = await freshRead;

    expect(settled).toBe(freshLog);
    const after = await svc.getEventLogForLanguage('ja');
    expect(after).toBe(freshLog);
    expect(queryForLanguage).toHaveBeenCalledTimes(2);
  });
});
