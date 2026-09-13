import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot, createSignal } from 'solid-js';
import { useKnowledgeProjections } from './useKnowledgeProjections';
import type { KnowledgeProjection } from '../../shared/graph/ipc';

const query = vi.hoisted(() => vi.fn());
const [version, setVersion] = createSignal(0);
vi.mock('../context/SettingsContext', () => ({ useSettings: () => ({ settings: { easeThresholdLearning: 1.55, easeThresholdKnown: 1.8 } }) }));
vi.mock('../../shared/bridges', () => ({ getBridge: () => ({ graph: { getKnowledgeProjection: query } }) }));
vi.mock('../services/knowledgeEvents', () => ({ eventsVersion: () => version() }));
const payload: KnowledgeProjection = { status: 'ready', targets: [{ targetRef: { kind: 'surface', id: 'test:surface' }, applicableCapabilities: ['test:future-capability'], states: [] }] };

beforeEach(() => { query.mockReset(); setVersion(0); });

describe('canonical projection collections', () => {
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
    query.mockResolvedValue(payload);
    const root = createRoot(dispose => ({ dispose, state: useKnowledgeProjections(() => ({ language: 'test', surfaces: ['a', 'a', 'b'] })) }));
    await vi.waitFor(() => expect(root.state.loading()).toBe(false));
    expect(query).toHaveBeenCalledTimes(2);
    expect(query).toHaveBeenCalledWith('test', 'a', { learning: 1.55, known: 1.8 });
    expect(root.state.projections().get('a')).toBe(payload);
    expect(root.state.projections().get('b')).toBe(payload);
    root.dispose();
  });

  it('clears the entire read view on journal revision and rejects a stale in-flight response', async () => {
    let resolveOld!: (value: KnowledgeProjection) => void;
    query.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; })).mockResolvedValue(payload);
    const root = createRoot(dispose => ({ dispose, state: useKnowledgeProjections(() => ({ language: 'test', surfaces: ['a'] })) }));
    await vi.waitFor(() => expect(query).toHaveBeenCalledTimes(1));
    setVersion(1);
    expect(root.state.projections().size).toBe(0);
    await vi.waitFor(() => expect(root.state.projections().get('a')).toBe(payload));
    resolveOld({ status: 'ready', targets: [] });
    await Promise.resolve();
    expect(root.state.projections().get('a')).toBe(payload);
    root.dispose();
  });

  it('does not expose partial counts while part of the universe is unresolved', async () => {
    let resolveSecond!: (value: KnowledgeProjection) => void;
    query.mockResolvedValueOnce(payload).mockImplementationOnce(() => new Promise(resolve => { resolveSecond = resolve; }));
    const root = createRoot(dispose => ({ dispose, state: useKnowledgeProjections(() => ({ language: 'test', surfaces: ['a', 'b'] })) }));
    await vi.waitFor(() => expect(query).toHaveBeenCalledTimes(2));
    expect(root.state.loading()).toBe(true);
    expect(root.state.ready()).toBe(false);
    expect(root.state.projections().size).toBe(0);
    resolveSecond(payload);
    await vi.waitFor(() => expect(root.state.projections().size).toBe(2));
    expect(root.state.ready()).toBe(true);
    root.dispose();
  });
});
