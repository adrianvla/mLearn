import { createEffect, createMemo, createSignal, onCleanup, type Accessor } from 'solid-js';
import { getBridge } from '../../shared/bridges';
import type { KnowledgeProjection } from '../../shared/graph/ipc';
import { eventsVersion } from '../services/knowledgeEvents';

export interface ProjectionQuery {
  readonly language: string;
  readonly surface: string;
}

/** Active consumers request one surface, sharing in-flight queries within a journal revision. */
const pending = new Map<string, Promise<KnowledgeProjection>>();

export function useKnowledgeProjection(query: Accessor<ProjectionQuery | undefined>) {
  const [projection, setProjection] = createSignal<KnowledgeProjection>();
  const [loading, setLoading] = createSignal(false);
  createEffect(() => {
    const input = query();
    const version = eventsVersion();
    setProjection(undefined);
    if (!input?.surface) { setLoading(false); return; }
    let disposed = false;
    setLoading(true);
    const key = JSON.stringify([input.language, input.surface, version]);
    let request = pending.get(key);
    if (!request) {
      request = getBridge().graph.getKnowledgeProjection(input.language, input.surface);
      pending.set(key, request);
      void request.finally(() => pending.delete(key)).catch(() => undefined);
    }
    void request.then((value) => {
      if (!disposed) { setProjection(value); setLoading(false); }
    }, () => {
      if (!disposed) { setProjection({ status: 'error', targets: [] }); setLoading(false); }
    });
    onCleanup(() => { disposed = true; });
  });
  const capabilities = createMemo(() => [...new Set(
    projection()?.targets.flatMap((target) => target.applicableCapabilities) ?? [],
  )]);
  return { projection, loading, capabilities };
}
