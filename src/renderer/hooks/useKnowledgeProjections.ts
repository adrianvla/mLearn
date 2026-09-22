import { batch, createEffect, createSignal, onCleanup, type Accessor } from 'solid-js';
import { getBridge } from '../../shared/bridges';
import type { KnowledgeProjection } from '../../shared/graph/ipc';
import { effectiveThresholds } from '../../shared/knowledge/effectiveKnowledge';
import { eventsVersion } from '../services/knowledgeEvents';
import { useSettings } from '../context/SettingsContext';

/** Collection view of the canonical projection; stores payloads, never reinterprets evidence. */
export function useKnowledgeProjections(query: Accessor<{ language: string; surfaces: readonly string[] } | undefined>) {
  const { settings } = useSettings();
  const [projections, setProjections] = createSignal<ReadonlyMap<string, KnowledgeProjection>>(new Map());
  const [loading, setLoading] = createSignal(false);
  const [ready, setReady] = createSignal(false);
  const [failed, setFailed] = createSignal(false);
  const [retryVersion, setRetryVersion] = createSignal(0);
  createEffect(() => {
    const input = query();
    eventsVersion();
    retryVersion();
    const thresholds = effectiveThresholds(settings);
    setReady(false);
    setFailed(false);
    setProjections(new Map());
    if (!input) { setLoading(false); return; }
    let disposed = false;
    onCleanup(() => { disposed = true; });
    setLoading(true);
    const surfaces = [...new Set(input.surfaces)];
    const result = new Map<string, KnowledgeProjection>();
    let cursor = 0;
    const worker = async () => {
      while (!disposed && cursor < surfaces.length) {
        const surface = surfaces[cursor++];
        try {
          result.set(surface, await getBridge().graph.getKnowledgeProjection(input.language, surface, thresholds));
        } catch {
          result.set(surface, { status: 'error', targets: [] });
        }
      }
    };
    void Promise.all(Array.from({ length: Math.min(8, surfaces.length) }, worker)).then(() => {
      if (!disposed) batch(() => {
        setProjections(result);
        setLoading(false);
        setReady([...result.values()].every(projection => projection.status === 'ready'));
        setFailed([...result.values()].some(projection => projection.status !== 'ready'));
      });
    });
  });
  return { projections, loading, ready, failed, retry: () => setRetryVersion((value) => value + 1) };
}
