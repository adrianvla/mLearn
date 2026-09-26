import { batch, createEffect, createSignal, onCleanup, type Accessor } from 'solid-js';
import { getBridge } from '../../shared/bridges';
import type { KnowledgeProjection } from '../../shared/graph/ipc';
import { effectiveThresholds } from '../../shared/knowledge/effectiveKnowledge';
import { wordEventsVersion } from '../services/knowledgeEvents';
import { useSettings } from '../context/SettingsContext';

/** Collection view of the canonical projection; stores payloads, never reinterprets evidence. */
export function useKnowledgeProjections(query: Accessor<{
  language: string;
  surfaces: readonly string[];
  /** Active journal and materialized keys. The graph selects authoritative sibling surfaces. */
  evidenceKeys?: readonly string[];
} | undefined>) {
  const { settings } = useSettings();
  const [projections, setProjections] = createSignal<ReadonlyMap<string, KnowledgeProjection>>(new Map());
  const [loading, setLoading] = createSignal(false);
  const [ready, setReady] = createSignal(false);
  const [failed, setFailed] = createSignal(false);
  const [retryVersion, setRetryVersion] = createSignal(0);
  createEffect(() => {
    const input = query();
    wordEventsVersion();
    retryVersion();
    const thresholds = effectiveThresholds(settings);
    setReady(false);
    setFailed(false);
    setProjections(new Map());
    if (!input) { setLoading(false); return; }
    let disposed = false;
    onCleanup(() => { disposed = true; });
    setLoading(true);
    const requested = [...new Set(input.surfaces)];
    void (async () => {
      try {
        const linked = input.evidenceKeys === undefined
          ? requested
          : await getBridge().graph.getEvidenceLinkedSurfaces(input.language, requested, [...input.evidenceKeys]);
        if (disposed) return;
        // Do not trust a bridge to add a surface the caller did not request.
        const selected = new Set(linked);
        const surfaces = requested.filter((surface) => selected.has(surface));
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
        await Promise.all(Array.from({ length: Math.min(8, surfaces.length) }, worker));
        if (!disposed) batch(() => {
          setProjections(result);
          setLoading(false);
          setReady([...result.values()].every(projection => projection.status === 'ready'));
          setFailed([...result.values()].some(projection => projection.status !== 'ready'));
        });
      } catch {
        if (!disposed) batch(() => {
          setProjections(new Map());
          setLoading(false);
          setReady(false);
          setFailed(true);
        });
      }
    })();
  });
  return { projections, loading, ready, failed, retry: () => setRetryVersion((value) => value + 1) };
}
