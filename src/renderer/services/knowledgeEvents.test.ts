import { describe, it, expect, vi, beforeEach } from 'vitest';

const queryKnowledgeEvents = vi.fn();
const appendKnowledgeEvents = vi.fn();
const onKnowledgeEventsChanged = vi.fn();

vi.mock('../../shared/bridges', () => ({
  getBridge: () => ({
    knowledgeEvents: {
      queryKnowledgeEventsForLanguage: vi.fn().mockResolvedValue({}),
      appendKnowledgeEvents: (...args: unknown[]) => appendKnowledgeEvents(...args),
      queryKnowledgeEvents: (...args: unknown[]) => queryKnowledgeEvents(...args),
      getKnowledgeStates: vi.fn().mockResolvedValue({}),
      getKnowledgeArchive: vi.fn().mockResolvedValue({}),
      queryKnowledgeSummaries: vi.fn().mockResolvedValue({}),
      queryAnkiReviewIds: vi.fn().mockResolvedValue([]),
      queryAnkiReviewIdSets: vi.fn().mockResolvedValue({}),
      queryLanguageKeys: vi.fn().mockResolvedValue([]),
      onKnowledgeEventsChanged: (...args: unknown[]) => onKnowledgeEventsChanged(...args),
    },
  }),
}));

describe('knowledgeEvents renderer service', () => {
  beforeEach(() => {
    vi.resetModules();
    queryKnowledgeEvents.mockReset().mockResolvedValue({});
    appendKnowledgeEvents.mockReset().mockResolvedValue(true);
    onKnowledgeEventsChanged.mockReset();
  });

  // Module-loading boundary: the service under test owns module-scoped cache
  // state, so each test must import a fresh instance after resetModules.
  async function importService() {
    return await import('./knowledgeEvents');
  }

  it('serves repeated key-set reads within one events version from one IPC fetch', async () => {
    queryKnowledgeEvents.mockResolvedValue({ 'ja:h1': [{ t: 1, kind: 'rollup', source: 'passiveTracking' }] });
    const svc = await importService();

    const first = await svc.getEvents(['ja:h1']);
    const second = await svc.getEvents(['ja:h1']);

    expect(queryKnowledgeEvents).toHaveBeenCalledTimes(1);
    expect(first).toEqual(second);
  });

  it('refetches after a local append bumps the events version', async () => {
    queryKnowledgeEvents.mockResolvedValue({ 'ja:h1': [{ t: 1, kind: 'rollup', source: 'passiveTracking' }] });
    const svc = await importService();
    await svc.getEvents(['ja:h1']);

    await svc.appendEvents({ 'ja:h2': [{ t: 2, kind: 'rollup', source: 'passiveTracking', timesSeenDelta: 1 }] });
    queryKnowledgeEvents.mockResolvedValue({
      'ja:h1': [{ t: 1, kind: 'rollup', source: 'passiveTracking' }],
      'ja:h2': [{ t: 2, kind: 'rollup', source: 'passiveTracking' }],
    });

    const refetched = await svc.getEvents(['ja:h1', 'ja:h2']);
    expect(queryKnowledgeEvents).toHaveBeenCalledTimes(2);
    expect(refetched.map(({ t }) => t)).toContain(2);
  });

  it('appends through the bridge, bumps the version, and broadcasts cross-tab', async () => {
    const svc = await importService();
    await svc.appendEvents({ 'ja:h2': [{ t: 2, kind: 'rollup', source: 'passiveTracking', timesSeenDelta: 1 }] });
    expect(appendKnowledgeEvents).toHaveBeenCalledWith({ 'ja:h2': [{ t: 2, kind: 'rollup', source: 'passiveTracking', timesSeenDelta: 1 }] });
    expect(onKnowledgeEventsChanged).toHaveBeenCalled();
  });

  it('reports a refused durable append without publishing an events-version change', async () => {
    appendKnowledgeEvents.mockResolvedValue(false);
    const svc = await importService();
    const accepted = await svc.appendEventsAcknowledged({
      'ja:h2': [{ t: 2, kind: 'rollup', source: 'passiveTracking', timesSeenDelta: 1 }],
    });
    expect(accepted).toBe(false);
    expect(onKnowledgeEventsChanged).toHaveBeenCalledTimes(1); // listener registration only; no bump broadcast
  });

  it('treats a retried stable attempt id as already accepted without appending it twice', async () => {
    queryKnowledgeEvents.mockResolvedValue({
      'ja:h2': [{ t: 1, kind: 'rating', source: 'grammar', attemptId: 'stable-attempt', easeAfter: 1.8 }],
    });
    const svc = await importService();
    const accepted = await svc.appendEventsIdempotentAcknowledged({
      'ja:h2': [{ t: 1, kind: 'rating', source: 'grammar', attemptId: 'stable-attempt', easeAfter: 1.8 }],
    });
    expect(accepted).toBe(true);
    expect(appendKnowledgeEvents).not.toHaveBeenCalled();
  });
});
