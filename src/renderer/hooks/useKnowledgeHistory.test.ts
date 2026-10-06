// @vitest-environment happy-dom
import { beforeEach, describe, it, vi, expect } from 'vitest';
import { createRoot, createSignal } from 'solid-js';
import { useKnowledgeHistory, useWordEaseHistory } from './useKnowledgeHistory';
import type { KnowledgeEvent } from '../../shared/knowledgeEvents';
import { hashWordSync } from '../services/srsAlgorithm';
const mocks = vi.hoisted(() => ({ events: vi.fn(async (_keys: readonly string[]): Promise<KnowledgeEvent[]> => []), archive: vi.fn(async () => ({ archive: null })), version: () => 0 }));
vi.mock('../context', () => ({
  useSettings: () => ({ settings: { language: 'ambient' } }),
  useLanguage: () => ({ langData: {}, currentLangData: () => null, getCanonicalFormForLanguage: () => 'canonical', getWordVariantsForLanguage: () => ['variant'] }),
}));
vi.mock('../services/knowledgeEvents', () => ({ eventsVersion: () => mocks.version(), getEvents: mocks.events, getKnowledgeArchive: mocks.archive }));
beforeEach(() => { mocks.events.mockReset().mockResolvedValue([]); mocks.archive.mockReset().mockResolvedValue({ archive: null }); mocks.version = () => 0; });
describe('inspector history addressing', () => {
  it('keeps spelling history and its archive on the exact surface in the inspected language', async () => {
    mocks.events.mockClear(); mocks.archive.mockClear();
    const dispose = createRoot((dispose) => { useKnowledgeHistory(() => 'presented', () => 'surface-recognition', () => 'inspected'); return dispose; });
    const key = `inspected:${hashWordSync('presented')}`;
    await vi.waitFor(() => expect(mocks.archive).toHaveBeenCalledWith(key));
    expect(mocks.events).toHaveBeenCalledWith([key]);
    expect(mocks.events).toHaveBeenCalledTimes(1);
    expect(mocks.archive).toHaveBeenCalledTimes(1);
    dispose();
  });
  it('strips capability-less tombstones before filtering the selected capability', async () => {
    mocks.events.mockResolvedValueOnce([
      { t: 1, kind: 'rating', source: 'manual', aspect: 'meaning', attemptId: 'undone', easeAfter: 2.6 },
      { t: 2, kind: 'retraction', source: 'manual', retracts: 'undone' },
    ]);
    let result!: ReturnType<typeof useKnowledgeHistory>;
    const dispose = createRoot((dispose) => { result = useKnowledgeHistory(() => 'presented', () => 'sense-recognition'); return dispose; });
    await vi.waitFor(() => expect(result.events()).toEqual([]));
    dispose();
  });

  it('retains same-target history while refreshing and hides it immediately for a new target', async () => {
    const initial: KnowledgeEvent[] = [{ t: 1, kind: 'rating', source: 'manual', aspect: 'meaning', easeAfter: 2.2 }];
    const refreshed: KnowledgeEvent[] = [{ t: 2, kind: 'rating', source: 'manual', aspect: 'meaning', easeAfter: 2.4 }];
    const otherTarget: KnowledgeEvent[] = [{ t: 3, kind: 'rating', source: 'manual', aspect: 'meaning', easeAfter: 1.4 }];
    let resolveRefresh: (events: KnowledgeEvent[]) => void = () => undefined;
    mocks.events.mockResolvedValueOnce(initial).mockImplementationOnce(() => new Promise((resolve) => { resolveRefresh = resolve; }))
      .mockResolvedValueOnce(otherTarget);
    const [word, setWord] = createSignal('first');
    const [revision, setRevision] = createSignal(0);
    mocks.version = revision;
    let result!: ReturnType<typeof useKnowledgeHistory>;
    const dispose = createRoot((dispose) => { result = useKnowledgeHistory(word, () => 'sense-recognition', () => 'inspected'); return dispose; });

    await vi.waitFor(() => expect(result.events()).toEqual(initial));
    setRevision(1);
    await vi.waitFor(() => expect(mocks.events).toHaveBeenCalledTimes(2));
    expect(result.events()).toEqual(initial);

    setWord('second');
    expect(result.events()).toBeUndefined();
    await vi.waitFor(() => expect(result.events()).toEqual(otherTarget));
    resolveRefresh(refreshed);
    await Promise.resolve();
    expect(result.events()).toEqual(otherTarget);
    dispose();
  });

  it('does not expose a previous word ease snapshot under a new word', async () => {
    const [word, setWord] = createSignal('first');
    let result!: ReturnType<typeof useWordEaseHistory>;
    const dispose = createRoot((dispose) => { result = useWordEaseHistory(word, () => 'inspected'); return dispose; });
    await vi.waitFor(() => expect(result.entries()?.some((entry) => entry.word === 'first')).toBe(true));

    setWord('second');
    expect(result.entries()).toBeUndefined();
    await vi.waitFor(() => expect(result.entries()?.some((entry) => entry.word === 'second')).toBe(true));
    expect(result.entries()?.some((entry) => entry.word === 'first')).toBe(false);
    dispose();
  });

});
