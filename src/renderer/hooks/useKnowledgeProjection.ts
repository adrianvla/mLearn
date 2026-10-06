import { effectiveThresholds } from '../../shared/knowledge/effectiveKnowledge';
import { useSettings } from '../context/SettingsContext';
import { batch, untrack, createEffect, createMemo, createSignal, onCleanup, type Accessor } from 'solid-js';
import { getBridge } from '../../shared/bridges';
import type { KnowledgeProjection } from '../../shared/graph/ipc';
import { eventsVersion } from '../services/knowledgeEvents';

export interface ProjectionQuery {
  readonly language: string;
  readonly surface: string;
}

export interface KnowledgeProjectionState {
  readonly projection: Accessor<KnowledgeProjection | undefined>;
  readonly loading: Accessor<boolean>;
  readonly capabilities: Accessor<string[]>;
  readonly retry: () => void;
}

const targetKeyFor = (input: ProjectionQuery): string => JSON.stringify([input.language, input.surface]);

/** Active consumers request one surface, sharing in-flight queries within a journal revision. */
const pending = new Map<string, Promise<KnowledgeProjection>>();

export function useKnowledgeProjection(query: Accessor<ProjectionQuery | undefined>, encounter?: Accessor<unknown>): KnowledgeProjectionState {
  const { settings } = useSettings();
  const [projectionValue, setProjectionValue] = createSignal<KnowledgeProjection>();
  const [projectionTargetKey, setProjectionTargetKey] = createSignal<string>();
  const projection = createMemo(() => {
    const input = query();
    if (!input?.surface || projectionTargetKey() !== targetKeyFor(input)) return undefined;
    return projectionValue();
  });
  const [loading, setLoading] = createSignal(false);
  const [retryVersion, setRetryVersion] = createSignal(0);
  createEffect(() => {
    retryVersion();
    encounter?.();
    const input = query();
    // Review snapshots resolve once per physical encounter. Live inspectors
    // retain their normal revision/threshold subscriptions.
    const version = encounter ? untrack(eventsVersion) : eventsVersion();
    const thresholds = encounter ? untrack(() => effectiveThresholds(settings)) : effectiveThresholds(settings);
    if (!input?.surface) {
      batch(() => { setProjectionValue(undefined); setProjectionTargetKey(undefined); setLoading(false); });
      return;
    }
    let disposed = false;
    batch(() => {
      if (encounter) { setProjectionValue(undefined); setProjectionTargetKey(undefined); }
      setLoading(true);
    });
    const key = JSON.stringify([input.language, input.surface, version, thresholds.learning, thresholds.known]);
    let request = pending.get(key);
    if (!request) {
      request = getBridge().graph.getKnowledgeProjectionCollection(input.language, [input.surface], undefined, thresholds)
        .then(collection => collection.projections[input.surface] ?? {
          status: 'error' as const,
          targets: [],
          querySurface: input.surface,
        });
      pending.set(key, request);
      void request.finally(() => pending.delete(key)).catch(() => undefined);
    }
    void request.then((value) => {
      if (!disposed) batch(() => {
        setProjectionValue(value);
        setProjectionTargetKey(targetKeyFor(input));
        setLoading(false);
      });
    }, () => {
      if (!disposed) batch(() => {
        setProjectionValue({ status: 'error', targets: [], querySurface: input.surface });
        setProjectionTargetKey(targetKeyFor(input));
        setLoading(false);
      });
    });
    onCleanup(() => { disposed = true; });
  });
  // A same-target result remains available during revalidation. The projection
  // memo hides results bound to a different language/surface until that target
  // resolves, so old capabilities cannot be shown under a new heading.
  const capabilities = createMemo(() => [...new Set(projection()?.targets.flatMap((target) => target.applicableCapabilities) ?? [])]);
  return { projection, loading, capabilities, retry: () => setRetryVersion(value => value + 1) };
}
