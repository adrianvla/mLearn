import { effectiveThresholds } from '../../shared/knowledge/effectiveKnowledge';
import { useSettings } from '../context/SettingsContext';
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
  const { settings } = useSettings();
  const [projection, setProjection] = createSignal<KnowledgeProjection>();
  const [loading, setLoading] = createSignal(false);
  const [retryVersion, setRetryVersion] = createSignal(0);
  createEffect(() => {
    retryVersion();
    const input = query();
    const version = eventsVersion();
    const thresholds = effectiveThresholds(settings);
    setProjection(undefined);
    if (!input?.surface) { setLoading(false); return; }
    let disposed = false;
    setLoading(true);
    const key = JSON.stringify([input.language, input.surface, version, thresholds.learning, thresholds.known]);
    let request = pending.get(key);
    if (!request) {
      request = getBridge().graph.getKnowledgeProjection(input.language, input.surface, thresholds);
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
  return { projection, loading, capabilities, retry: () => setRetryVersion(value => value + 1) };
}
