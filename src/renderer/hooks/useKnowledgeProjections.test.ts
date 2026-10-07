import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot, createSignal } from 'solid-js';
import { useKnowledgeProjections } from './useKnowledgeProjections';
import type { KnowledgeProjection } from '../../shared/graph/ipc';

const query = vi.hoisted(() => vi.fn());
const [version, setVersion] = createSignal(0);
const [active, setActive] = createSignal(true);
vi.mock('./useWindowActivity', () => ({ useWindowActivity: () => active }));
vi.mock('../context/SettingsContext', () => ({ useSettings: () => ({ settings: { easeThresholdLearning: 1.55, easeThresholdKnown: 1.8 } }) }));
vi.mock('../../shared/bridges', () => ({ getBridge: () => ({ graph: { getKnowledgeProjectionCollection: query } }) }));
vi.mock('../services/knowledgeEvents', () => ({ wordEventsVersion: () => version() }));
const payload: KnowledgeProjection = { status: 'ready', targets: [{ targetRef: { kind: 'surface', id: 'test:surface' }, applicableCapabilities: ['test:future-capability'], states: [] }] };
const collection = (...surfaces: string[]) => ({ projections: Object.fromEntries(surfaces.map(surface => [surface, payload])),
  revision: { packageRevision: 2, journalSequence: 3, libraryRevision: 4 } });

beforeEach(() => { query.mockReset(); setVersion(0); setActive(true); });

describe('canonical projection collections', () => {
  it('reuses a completed collection on clean focus and flattens deferred journal revisions', async () => {
    query.mockResolvedValue(collection('a'));
    const root = createRoot(dispose => ({ dispose, state: useKnowledgeProjections(() => ({ language: 'pkg', surfaces: ['a'], evidenceKeys: ['pkg:key'] })) }));
    await vi.waitFor(() => expect(root.state.ready()).toBe(true));
    const previous = root.state.projections();
    const completed = root.state.completedRevision();
    setActive(false);
    setActive(true);
    await Promise.resolve();
    expect(query).toHaveBeenCalledTimes(1);
    expect(root.state.projections()).toBe(previous);
    expect(root.state.ready()).toBe(true);
    expect(root.state.completedRevision()).toEqual(completed);
    setActive(false);
    setVersion(1);
    setVersion(2);
    setVersion(3);
    setActive(true);
    await vi.waitFor(() => expect(root.state.ready()).toBe(true));
    expect(query).toHaveBeenCalledTimes(2);
    root.dispose();
  });
  it('coalesces inactive revisions while admitted work continues after blur without stale publication', async () => {
    setActive(false);
    query.mockResolvedValue(collection('a'));
    const root = createRoot(dispose => ({ dispose, state: useKnowledgeProjections(() => ({ language: 'pkg', surfaces: ['a'], evidenceKeys: ['pkg:key'] })) }));
    await Promise.resolve();
    setVersion(1);
    setVersion(2);
    await Promise.resolve();
    expect(query).not.toHaveBeenCalled();
    setActive(true);
    await vi.waitFor(() => expect(root.state.ready()).toBe(true));
    expect(query).toHaveBeenCalledTimes(1);
    let finishSelection!: (surfaces: string[]) => void;
    query.mockImplementationOnce(() => new Promise(resolve => { finishSelection = () => resolve(collection('a')); })).mockResolvedValue(collection('a'));
    setVersion(3);
    await vi.waitFor(() => expect(query).toHaveBeenCalledTimes(2));
    expect(root.state.projections().size).toBe(1);
    setActive(false);
    finishSelection(['a']);
    await Promise.resolve();
    expect(root.state.projections().size).toBe(1);
    setVersion(4);
    setVersion(5);
    expect(root.state.loading()).toBe(false);
    setActive(true);
    await vi.waitFor(() => expect(root.state.ready()).toBe(true));
    expect(query).toHaveBeenCalledTimes(3);
    root.dispose();
  });
  it('distinguishes an inactive reader from a ready empty result', async () => {
    const [input, setInput] = createSignal<{ language: string; surfaces: string[] }>();
    const root = createRoot(dispose => ({ dispose, state: useKnowledgeProjections(input) }));
    await Promise.resolve();
    expect(root.state.loading()).toBe(false);
    expect(root.state.ready()).toBe(false);
    setInput({ language: 'test', surfaces: [] });
    await vi.waitFor(() => expect(root.state.ready()).toBe(true));
    expect(root.state.projections().size).toBe(0);
    root.dispose();
  });

  it('deduplicates exact surfaces and preserves the canonical payload without a second classifier', async () => {
    query.mockResolvedValue(collection('a', 'b'));
    const root = createRoot(dispose => ({ dispose, state: useKnowledgeProjections(() => ({ language: 'test', surfaces: ['a', 'a', 'b'] })) }));
    await vi.waitFor(() => expect(root.state.loading()).toBe(false));
    expect(query).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith('test', ['a', 'b'], undefined, { learning: 1.55, known: 1.8 });
    expect(root.state.projections().get('a')).toBe(payload);
    expect(root.state.projections().get('b')).toBe(payload);
    root.dispose();
  });

  it('delegates graph-relative evidence selection and projection to one collection request', async () => {
    query.mockResolvedValue(collection('form B'));
    const root = createRoot(dispose => ({
      dispose,
      state: useKnowledgeProjections(() => ({ language: 'test', surfaces: ['form A', 'form B', 'unmeasured'], evidenceKeys: ['test:hash'] })),
    }));
    await vi.waitFor(() => expect(root.state.ready()).toBe(true));
    expect(query).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith('test', ['form A', 'form B', 'unmeasured'], ['test:hash'], { learning: 1.55, known: 1.8 });
    expect([...root.state.projections().keys()]).toEqual(['form B']);
    expect(root.state.failed()).toBe(false);
    root.dispose();
  });

  it('retains the prior complete read view and rejects a stale in-flight collection', async () => {
    let resolveOld!: (value: ReturnType<typeof collection>) => void;
    query.mockResolvedValueOnce(collection('a')).mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; })).mockResolvedValue(collection('a'));
    const root = createRoot(dispose => ({ dispose, state: useKnowledgeProjections(() => ({ language: 'test', surfaces: ['a'] })) }));
    await vi.waitFor(() => expect(query).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(root.state.projections().get('a')).toBe(payload));
    setVersion(1);
    expect(root.state.projections().size).toBe(1);
    expect(root.state.completedRevision()).toEqual({ packageRevision: 2, journalSequence: 3, libraryRevision: 4 });
    await vi.waitFor(() => expect(query).toHaveBeenCalledTimes(2));
    resolveOld(collection('a'));
    await Promise.resolve();
    expect(root.state.projections().get('a')).toBe(payload);
    root.dispose();
  });

  it('does not expose partial counts while part of the universe is unresolved', async () => {
    let resolveSecond!: (value: ReturnType<typeof collection>) => void;
    query.mockImplementationOnce(() => new Promise(resolve => { resolveSecond = resolve; }));
    const root = createRoot(dispose => ({ dispose, state: useKnowledgeProjections(() => ({ language: 'test', surfaces: ['a', 'b'] })) }));
    await vi.waitFor(() => expect(query).toHaveBeenCalledTimes(1));
    expect(root.state.loading()).toBe(true);
    expect(root.state.ready()).toBe(false);
    expect(root.state.projections().size).toBe(0);
    resolveSecond(collection('a', 'b'));
    await vi.waitFor(() => expect(root.state.projections().size).toBe(2));
    expect(root.state.ready()).toBe(true);
    root.dispose();
  });

  it('exposes projection failures and can retry without waiting for a journal mutation', async () => {
    query.mockRejectedValueOnce(new Error('temporary graph read failure')).mockResolvedValue(collection('a'));
    const root = createRoot(dispose => ({
      dispose,
      state: useKnowledgeProjections(() => ({ language: 'test', surfaces: ['a'] })),
    }));

    await vi.waitFor(() => expect(root.state.loading()).toBe(false));
    expect(root.state.failed()).toBe(true);
    expect(root.state.ready()).toBe(false);

    root.state.retry();
    await vi.waitFor(() => expect(root.state.ready()).toBe(true));
    expect(root.state.failed()).toBe(false);
    expect(query).toHaveBeenCalledTimes(2);
    root.dispose();
  });

  it('clears the completed collection when the language scope changes', async () => {
    query.mockResolvedValue(collection('a'));
    const [language, setLanguage] = createSignal('first');
    const root = createRoot(dispose => ({ dispose, state: useKnowledgeProjections(() => ({ language: language(), surfaces: ['a'] })) }));
    await vi.waitFor(() => expect(root.state.ready()).toBe(true));
    setLanguage('second');
    expect(root.state.projections().size).toBe(0);
    expect(root.state.completedRevision()).toBeUndefined();
    await vi.waitFor(() => expect(query).toHaveBeenCalledTimes(2));
    root.dispose();
  });
});

it('does not publish a retained collection under a different same-language query scope, even while inactive', async () => {
  query.mockResolvedValueOnce(collection('a')).mockImplementation(() => new Promise(() => {}));
  const [surfaces, setSurfaces] = createSignal(['a']);
  const root = createRoot(dispose => ({ dispose, state: useKnowledgeProjections(() => ({ language: 'test', surfaces: surfaces() })) }));
  await vi.waitFor(() => expect(root.state.ready()).toBe(true));
  setActive(false);
  setSurfaces(['b']);
  expect(root.state.projections().size).toBe(0);
  expect(root.state.ready()).toBe(false);
  expect(root.state.completedRevision()).toBeUndefined();
  setActive(true);
  expect(root.state.projections().size).toBe(0);
  root.dispose();
});

it('binds retained collections to the actual evidence-key scope', async () => {
  query.mockResolvedValueOnce(collection('a'));
  const [evidenceKeys, setEvidenceKeys] = createSignal(['test:old-source']);
  const root = createRoot(dispose => ({ dispose, state: useKnowledgeProjections(() => ({ language: 'test', surfaces: ['a'], evidenceKeys: evidenceKeys() })) }));
  await vi.waitFor(() => expect(root.state.ready()).toBe(true));
  setActive(false);
  setEvidenceKeys(['test:new-source']);
  expect(root.state.projections().size).toBe(0);
  expect(root.state.completedRevision()).toBeUndefined();
  root.dispose();
});
