// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { createRoot, createSignal } from 'solid-js';
import type { GraphNeighborhood } from '../../shared/graph/ipc';
import type { GraphContextValue } from '../context/GraphContext';
import { useGraphNeighborhood } from './useGraphNeighborhood';
const value = (id: string): GraphNeighborhood => ({ center: { id, kind: 'surface', label: id }, centerDenseId: 0, relationCount: 2, relations: [{ id: `${id}:1`, kind: 'sense', relationType: 'has-sense' }] });
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
describe('graph neighborhood request ownership', () => {
  it('retains the explorer during navigation and ignores a late page from the old center', async () => {
    let resolvePage!: (result: GraphNeighborhood) => void;
    const getNeighborhood = vi.fn((query: { entityId: string; offset?: number }) => query.offset
      ? new Promise<GraphNeighborhood>((resolve) => { resolvePage = resolve; }) : Promise.resolve(value(query.entityId)));
    const [id, setId] = createSignal('a');
    let dispose!: () => void;
    const result = createRoot((cleanup) => { dispose = cleanup; return useGraphNeighborhood({ readiness: () => 'ready', getNeighborhood } as GraphContextValue, id); });
    await flush(); expect(result.neighborhood()?.center.id).toBe('a');
    void result.loadMore(); expect(result.loadingMore()).toBe(true);
    setId('b'); expect(result.neighborhood()?.center.id).toBe('a'); expect(result.pending()).toBe(true);
    await flush(); resolvePage({ ...value('a'), relations: [{ id: 'a:2', kind: 'sense', relationType: 'has-sense' }] });
    await flush(); expect(result.neighborhood()?.center.id).toBe('b'); expect(result.neighborhood()?.relations).toHaveLength(1); dispose();
  });
  it('appends requested pages without losing qualifiers and allows retry after failure', async () => {
    const getNeighborhood = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(value('a')).mockResolvedValueOnce({ ...value('a'), relations: [{ id: 'a:1', kind: 'sense', relationType: 'has-sense', order: 2 }] });
    let dispose!: () => void;
    const result = createRoot((cleanup) => { dispose = cleanup; return useGraphNeighborhood({ readiness: () => 'ready', getNeighborhood } as GraphContextValue, () => 'a'); });
    await flush(); expect(result.failed()).toBe(true); expect(result.pending()).toBe(false);
    result.retry(); await flush(); expect(result.failed()).toBe(false);
    await result.loadMore(); expect(getNeighborhood).toHaveBeenLastCalledWith({ entityId: 'a', depth: 1, offset: 1 });
    expect(result.neighborhood()?.relations).toHaveLength(2); expect(result.neighborhood()?.relations[1].order).toBe(2); dispose();
  });
  it('restores loaded connections beyond 200 before publishing a revisited neighborhood', async () => {
    const all = Array.from({ length: 324 }, (_, index) => ({ id: `a:${index}`, kind: 'sense', relationType: 'has-sense' }));
    const getNeighborhood = vi.fn(async (query: { entityId: string; offset?: number; limit?: number }) => query.entityId === 'a'
      ? { ...value('a'), relationCount: all.length, relations: all.slice(query.offset ?? 0, (query.offset ?? 0) + (query.limit ?? 80)) } : value('b'));
    const [id, setId] = createSignal('a');
    let dispose!: () => void;
    const result = createRoot((cleanup) => { dispose = cleanup; return useGraphNeighborhood({ readiness: () => 'ready', getNeighborhood } as GraphContextValue, id); });
    await flush();
    while (result.neighborhood()!.relations.length < all.length) await result.loadMore();
    setId('b'); await flush(); expect(result.neighborhood()?.center.id).toBe('b');
    setId('a'); expect(result.neighborhood()?.center.id).toBe('b'); await flush();
    expect(result.neighborhood()?.relations).toHaveLength(324);
    expect(getNeighborhood).toHaveBeenCalledWith({ entityId: 'a', depth: 1, limit: 200 });
    expect(getNeighborhood).toHaveBeenCalledWith({ entityId: 'a', depth: 1, offset: 200 });
    dispose();
  });

  it('clears the old language when graph readiness changes', async () => {
    const [readiness, setReadiness] = createSignal<'ready' | 'pending'>('ready');
    const getNeighborhood = vi.fn().mockResolvedValue(value('a'));
    let dispose!: () => void;
    const result = createRoot((cleanup) => { dispose = cleanup; return useGraphNeighborhood({ readiness, getNeighborhood } as GraphContextValue, () => 'a'); });
    await flush(); setReadiness('pending'); expect(result.neighborhood()).toBeNull(); expect(getNeighborhood).toHaveBeenCalledTimes(1); dispose();
  });
});
