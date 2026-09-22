import { describe, expect, it, vi } from 'vitest';
import { createRoot, createSignal } from 'solid-js';
import { useKnowledgeProjection } from './useKnowledgeProjection';
import { effectiveThresholds } from '../../shared/knowledge/effectiveKnowledge';
import type { KnowledgeProjection } from '../../shared/graph/ipc';

const query = vi.hoisted(() => vi.fn());
let settings: { easeThresholdLearning: number; easeThresholdKnown: number } = { easeThresholdLearning: 1.55, easeThresholdKnown: 1.8 };
vi.mock('../context/SettingsContext', () => ({ useSettings: () => ({ settings }) }));
vi.mock('../../shared/bridges', () => ({ getBridge: () => ({ graph: { getKnowledgeProjection: query } }) }));
vi.mock('../services/knowledgeEvents', () => ({ eventsVersion: () => 0 }));
const payload: KnowledgeProjection = { status: 'ready', targets: [{ targetRef: { kind: 'surface', id: 'surface-a' }, applicableCapabilities: ['x-test::novel'], states: [] }] };

describe('useKnowledgeProjection', () => {
  it('derives unknown package capabilities from applicability even without state rows', async () => {
    query.mockResolvedValue(payload);
    const root = createRoot((dispose) => ({ dispose, state: useKnowledgeProjection(() => ({ language: 'test', surface: 'alpha' })) }));
    await vi.waitFor(() => expect(root.state.capabilities()).toEqual(['x-test::novel']));
    root.dispose();
  });

  it('ignores a stale response after the surface changes', async () => {
    let resolveFirst: (value: KnowledgeProjection) => void = () => undefined;
    query.mockImplementationOnce(() => new Promise<KnowledgeProjection>((resolve) => { resolveFirst = resolve; })).mockResolvedValue(payload);
    const root = createRoot((dispose) => {
      const [surface, setSurface] = createSignal('old');
      return { dispose, setSurface, state: useKnowledgeProjection(() => ({ language: 'test', surface: surface() })) };
    });
    await vi.waitFor(() => expect(query).toHaveBeenCalledWith('test', 'old', effectiveThresholds(settings)));
    root.setSurface('new');
    await vi.waitFor(() => expect(root.state.capabilities()).toEqual(['x-test::novel']));
    resolveFirst({ status: 'ready', targets: [] });
    await Promise.resolve();
    expect(root.state.capabilities()).toEqual(['x-test::novel']);
    root.dispose();
  });
  it('requeries changed thresholds and does not reuse or display the old pending classification', async () => {
    let resolveOld: (value: KnowledgeProjection) => void = () => undefined;
    query.mockClear();
    query.mockImplementationOnce(() => new Promise<KnowledgeProjection>(resolve => { resolveOld = resolve; })).mockResolvedValue(payload);
    const root = createRoot((dispose) => {
      const [known, setKnown] = createSignal(1.8);
      settings = { easeThresholdLearning: 1.55, get easeThresholdKnown() { return known(); } };
      return { dispose, setKnown, state: useKnowledgeProjection(() => ({ language: 'test', surface: 'threshold-change' })) };
    });
    await vi.waitFor(() => expect(query).toHaveBeenCalledTimes(1));
    root.setKnown(2.2);
    await vi.waitFor(() => expect(query).toHaveBeenLastCalledWith('test', 'threshold-change', { learning: 1.55, known: 2.2 }));
    await vi.waitFor(() => expect(root.state.capabilities()).toEqual(['x-test::novel']));
    resolveOld({ status: 'ready', targets: [] });
    await Promise.resolve();
    expect(root.state.capabilities()).toEqual(['x-test::novel']);
    root.dispose();
  });

  it('preserves a failed query and retries the same canonical identity', async () => {
    query.mockClear();
    query.mockRejectedValueOnce(new Error('offline')).mockResolvedValue(payload);
    const root = createRoot(dispose => ({ dispose, state: useKnowledgeProjection(() => ({ language: 'pkg', surface: 'retry-word' })) }));
    await vi.waitFor(() => expect(root.state.projection()?.status).toBe('error'));
    root.state.retry();
    await vi.waitFor(() => expect(root.state.projection()?.status).toBe('ready'));
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[0]).toEqual(query.mock.calls[1]);
    root.dispose();
  });

});
