// @vitest-environment happy-dom
import { describe, it, vi, expect } from 'vitest';
import { createRoot } from 'solid-js';
import { useKnowledgeHistory } from './useKnowledgeHistory';
import type { KnowledgeEvent } from '../../shared/knowledgeEvents';
import { hashWordSync } from '../services/srsAlgorithm';
const mocks = vi.hoisted(() => ({ events: vi.fn(async (): Promise<KnowledgeEvent[]> => []), archive: vi.fn(async () => ({ archive: null })) }));
vi.mock('../context', () => ({
  useSettings: () => ({ settings: { language: 'ambient' } }),
  useLanguage: () => ({ langData: {}, currentLangData: () => null, getCanonicalFormForLanguage: () => 'canonical', getWordVariantsForLanguage: () => ['variant'] }),
}));
vi.mock('../services/knowledgeEvents', () => ({ eventsVersion: () => 0, getEvents: mocks.events, getKnowledgeArchive: mocks.archive }));
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

});
