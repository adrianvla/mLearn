import { describe, expect, it, vi } from 'vitest';
import { createRoot, createSignal } from 'solid-js';
import { useKnowledgeProjection } from './useKnowledgeProjection';
import type { KnowledgeProjection } from '../../shared/graph/ipc';

const query = vi.hoisted(() => vi.fn());
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
    await vi.waitFor(() => expect(query).toHaveBeenCalledWith('test', 'old'));
    root.setSurface('new');
    await vi.waitFor(() => expect(root.state.capabilities()).toEqual(['x-test::novel']));
    resolveFirst({ status: 'ready', targets: [] });
    await Promise.resolve();
    expect(root.state.capabilities()).toEqual(['x-test::novel']);
    root.dispose();
  });
});
