import { createEffect, createSignal, onCleanup, type Accessor } from 'solid-js';
import type { GraphNeighborhood } from '../../shared/graph/ipc';
import type { GraphContextValue } from '../context/GraphContext';

/** Shared request ownership for both graph hosts. Keep the mounted explorer
 * during same-language navigation so its view/history survives asynchronous IO.
 */
export function useGraphNeighborhood(graph: GraphContextValue, entityId: Accessor<string | undefined>, enabled: Accessor<boolean> = () => true) {
  const [neighborhood, setNeighborhood] = createSignal<GraphNeighborhood | null>(null);
  const [pending, setPending] = createSignal(false);
  const [loadingMore, setLoadingMore] = createSignal(false);
  const [failed, setFailed] = createSignal(false);
  const [retryVersion, setRetryVersion] = createSignal(0);
  let generation = 0;
  // Remember only the loaded extent, never a stale graph/projection payload.
  const extents = new Map<string, number>();
  createEffect(() => {
    const id = entityId();
    const active = enabled();
    const ready = graph.readiness();
    retryVersion();
    const request = ++generation;
    onCleanup(() => { generation++; });
    setFailed(false); setLoadingMore(false);
    if (!active || !id || ready !== 'ready') { extents.clear(); setNeighborhood(null); setPending(false); return; }
    setPending(true);
    const extent = extents.get(id);
    void graph.getNeighborhood({ entityId: id, depth: 1, ...(extent !== undefined && extent > 80 ? { limit: Math.min(extent, 200) } : {}) }).then(async (next) => {
      if (request !== generation || !next) { if (request === generation) setNeighborhood(next); return; }
      const relations = [...next.relations];
      while (request === generation && relations.length < Math.min(extent ?? next.relations.length, next.relationCount)) {
        const page = await graph.getNeighborhood({ entityId: id, depth: 1, offset: relations.length });
        if (!page || page.center.id !== id || !page.relations.length) throw new Error('Graph page unavailable');
        relations.push(...page.relations);
      }
      if (request === generation) {
        extents.set(id, relations.length);
        setNeighborhood({ ...next, relations });
      }
    }).catch(() => { if (request === generation) setFailed(true); })
      .finally(() => { if (request === generation) setPending(false); });
  });
  const loadMore = async () => {
    const previous = neighborhood();
    if (!previous || loadingMore() || pending()) return;
    const request = generation;
    setLoadingMore(true); setFailed(false);
    try {
      const next = await graph.getNeighborhood({ entityId: previous.center.id, depth: 1, offset: previous.relations.length });
      if (request === generation) {
        if (!next || next.center.id !== previous.center.id || !next.relations.length) throw new Error('Graph page unavailable');
        const relations = [...previous.relations, ...next.relations];
        extents.set(previous.center.id, relations.length);
        setNeighborhood({ ...next, relations });
      }
    } catch { if (request === generation) setFailed(true); }
    finally { if (request === generation) setLoadingMore(false); }
  };
  return { neighborhood, pending, failed, loadingMore, loadMore, retry: () => setRetryVersion((value) => value + 1) };
}
