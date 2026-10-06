import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRoot, createSignal } from 'solid-js';
import { useKnowledgeProjection } from './useKnowledgeProjection';
import { effectiveThresholds } from '../../shared/knowledge/effectiveKnowledge';
import type { KnowledgeProjection } from '../../shared/graph/ipc';

const query = vi.hoisted(() => vi.fn());
const [revision, setRevision] = createSignal(0);
let settings: { easeThresholdLearning: number; easeThresholdKnown: number } = { easeThresholdLearning: 1.55, easeThresholdKnown: 1.8 };
vi.mock('../context/SettingsContext', () => ({ useSettings: () => ({ settings }) }));
vi.mock('../../shared/bridges', () => ({ getBridge: () => ({ graph: {
  getKnowledgeProjectionCollection: (language: string, surfaces: string[], _evidenceKeys?: string[], thresholds?: object) =>
    query(language, surfaces[0], thresholds).then((projection: KnowledgeProjection) => ({
      projections: { [surfaces[0]]: projection },
      revision: { packageRevision: 1, journalSequence: 0, libraryRevision: 0 },
    })),
} }) }));
vi.mock('../services/knowledgeEvents', () => ({ eventsVersion: () => revision() }));
const payload: KnowledgeProjection = { status: 'ready', targets: [{ targetRef: { kind: 'surface', id: 'surface-a' }, applicableCapabilities: ['x-test::novel'], states: [] }] };

afterEach(() => {
  query.mockReset();
  setRevision(0);
  settings = { easeThresholdLearning: 1.55, easeThresholdKnown: 1.8 };
});

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

  it('clears capabilities from the previous surface while the next surface is loading', async () => {
    let resolveNext: (value: KnowledgeProjection) => void = () => undefined;
    query.mockClear();
    query.mockResolvedValueOnce(payload).mockImplementationOnce(() => new Promise<KnowledgeProjection>((resolve) => { resolveNext = resolve; }));
    const root = createRoot((dispose) => {
      const [surface, setSurface] = createSignal('first');
      return { dispose, setSurface, state: useKnowledgeProjection(() => ({ language: 'test', surface: surface() })) };
    });
    await vi.waitFor(() => expect(root.state.capabilities()).toEqual(['x-test::novel']));

    root.setSurface('second');
    await vi.waitFor(() => expect(root.state.loading()).toBe(true));
    expect(root.state.projection()).toBeUndefined();
    expect(root.state.capabilities()).toEqual([]);

    resolveNext({ status: 'ready', targets: [{ targetRef: { kind: 'surface', id: 'surface-b' }, applicableCapabilities: ['x-test::known'], states: [] }] });
    await vi.waitFor(() => expect(root.state.capabilities()).toEqual(['x-test::known']));
    root.dispose();
  });

  it('does not expose one target projection under a different target while it resolves', async () => {
    let resolveSecond!: (value: KnowledgeProjection) => void;
    query.mockReset()
      .mockResolvedValueOnce({ ...payload, querySurface: 'first' })
      .mockImplementationOnce(() => new Promise<KnowledgeProjection>((resolve) => { resolveSecond = resolve; }));
    const root = createRoot((dispose) => {
      const [surface, setSurface] = createSignal('first');
      return { dispose, setSurface, state: useKnowledgeProjection(() => ({ language: 'test', surface: surface() })) };
    });
    await vi.waitFor(() => expect(root.state.projection()?.querySurface).toBe('first'));

    root.setSurface('second');
    await vi.waitFor(() => expect(root.state.loading()).toBe(true));
    expect(root.state.projection()).toBeUndefined();

    resolveSecond({ ...payload, querySurface: 'second' });
    await vi.waitFor(() => expect(root.state.projection()?.querySurface).toBe('second'));
    root.dispose();
  });

  it('keeps ready same-target data visible with an updating state during journal revalidation', async () => {
    let resolveRefresh!: (value: KnowledgeProjection) => void;
    query.mockResolvedValueOnce({ ...payload, querySurface: 'stable' })
      .mockImplementationOnce(() => new Promise<KnowledgeProjection>((resolve) => { resolveRefresh = resolve; }));
    const root = createRoot((dispose) => ({
      dispose,
      state: useKnowledgeProjection(() => ({ language: 'test', surface: 'stable' })),
    }));
    await vi.waitFor(() => expect(root.state.projection()?.querySurface).toBe('stable'));

    setRevision(1);
    await vi.waitFor(() => expect(query).toHaveBeenCalledTimes(2));
    expect(root.state.loading()).toBe(true);
    expect(root.state.projection()?.querySurface).toBe('stable');

    resolveRefresh({ ...payload, querySurface: 'stable' });
    await vi.waitFor(() => expect(root.state.loading()).toBe(false));
    expect(root.state.projection()?.querySurface).toBe('stable');
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

  it('freezes a review projection across threshold changes and refreshes on the next physical encounter', async () => {
    query.mockReset().mockResolvedValue(payload);
    const root = createRoot(dispose => {
      const [known, setKnown] = createSignal(1.8);
      const [encounter, setEncounter] = createSignal('first');
      settings = { easeThresholdLearning: 1.55, get easeThresholdKnown() { return known(); } };
      return { dispose, setKnown, setEncounter,
        state: useKnowledgeProjection(() => ({ language: 'pkg', surface: 'same-card' }), encounter) };
    });
    await vi.waitFor(() => expect(root.state.projection()).toEqual(payload));
    root.setKnown(2.4);
    await Promise.resolve();
    expect(query).toHaveBeenCalledTimes(1);
    expect(root.state.loading()).toBe(false);
    root.setEncounter('second');
    await vi.waitFor(() => expect(query).toHaveBeenCalledTimes(2));
    expect(query).toHaveBeenLastCalledWith('pkg', 'same-card', { learning: 1.55, known: 2.4 });
    root.dispose();
  });

});
