import { batch, createEffect, createSignal, onCleanup, type Accessor } from 'solid-js';
import { getBridge } from '../../shared/bridges';
import type { KnowledgeProjection } from '../../shared/graph/ipc';
import { effectiveThresholds } from '../../shared/knowledge/effectiveKnowledge';
import type { KnowledgeProjectionRevision } from '../../shared/graph/ipc';
import { hashWordSync } from '../../shared/utils/wordHash';
import { getLogger } from '../../shared/utils/logger';
import { wordEventsVersion } from '../services/knowledgeEvents';
import { useSettings } from '../context/SettingsContext';
import { useWindowActivity } from './useWindowActivity';

const log = getLogger('renderer.hooks.useKnowledgeProjections');

/** Collection view of the canonical projection; stores payloads, never reinterprets evidence. */
export function useKnowledgeProjections(query: Accessor<{
  language: string;
  surfaces: readonly string[];
  /** Active journal and materialized keys. The graph selects authoritative sibling surfaces. */
  evidenceKeys?: readonly string[];
} | undefined>) {
  const { settings } = useSettings();
  const active = useWindowActivity();
  const [projections, setProjections] = createSignal<ReadonlyMap<string, KnowledgeProjection>>(new Map());
  const [loading, setLoading] = createSignal(false);
  const [ready, setReady] = createSignal(false);
  const [failed, setFailed] = createSignal(false);
  const [completedRevision, setCompletedRevision] = createSignal<KnowledgeProjectionRevision>();
  const [completedLanguage, setCompletedLanguage] = createSignal<string>();
  const [retryVersion, setRetryVersion] = createSignal(0);
  let settledKey: string | undefined;
  createEffect(() => {
    // Work admitted by the main-process collection service is allowed to
    // finish after blur. Focus consumes coalesced revisions and cache hits.
    if (!active()) { setLoading(false); return; }
    const input = query();
    const version = wordEventsVersion();
    const retry = retryVersion();
    const thresholds = effectiveThresholds(settings);
    const requestKey = JSON.stringify([input, version, retry, thresholds]);
    if (requestKey === settledKey) return;
    if (input && completedLanguage() !== undefined && completedLanguage() !== input.language) {
      setProjections(new Map());
      setCompletedRevision(undefined);
    }
    setReady(false);
    setFailed(false);
    if (!input) { settledKey = requestKey; setLoading(false); return; }
    if (input.surfaces.length === 0) {
      settledKey = requestKey;
      batch(() => { setProjections(new Map()); setCompletedLanguage(input.language); setCompletedRevision(undefined); setLoading(false); setReady(true); });
      return;
    }
    let disposed = false;
    onCleanup(() => { disposed = true; });
    setLoading(true);
    const requested = [...new Set(input.surfaces)];
    const requestId = hashWordSync(requestKey).slice(0, 12);
    const startedAt = performance.now();
    log.debug(`projection request started id=${requestId} surfaces=${requested.length} evidenceKeys=${input.evidenceKeys?.length ?? 0}`);
    void (async () => {
      try {
        const collection = await getBridge().graph.getKnowledgeProjectionCollection(
          input.language,
          requested,
          input.evidenceKeys === undefined ? undefined : [...input.evidenceKeys],
          thresholds,
        );
        const result = new Map<string, KnowledgeProjection>();
        for (const surface of requested) {
          const projection = collection.projections[surface];
          if (projection) result.set(surface, projection);
        }
        if (disposed) {
          log.debug(`projection request discarded id=${requestId} reason=subscriber-disposed durationMs=${Math.round(performance.now() - startedAt)}`);
          return;
        }
        batch(() => {
          settledKey = requestKey;
          setProjections(result);
          setCompletedLanguage(input.language);
          setCompletedRevision(collection.revision);
          setLoading(false);
          setReady([...result.values()].every(projection => projection.status === 'ready'));
          setFailed([...result.values()].some(projection => projection.status !== 'ready'));
        });
        log.debug(`projection request published id=${requestId} surfaces=${result.size} durationMs=${Math.round(performance.now() - startedAt)} revision=${collection.revision ? `${collection.revision.packageRevision}:${collection.revision.journalSequence}:${collection.revision.libraryRevision}` : 'platform-unknown'}`);
      } catch {
        if (disposed) {
          log.debug(`projection request discarded id=${requestId} reason=subscriber-disposed durationMs=${Math.round(performance.now() - startedAt)}`);
          return;
        }
        batch(() => {
          settledKey = requestKey;
          setLoading(false);
          setReady(false);
          setFailed(true);
        });
        log.debug(`projection request failed id=${requestId} durationMs=${Math.round(performance.now() - startedAt)}`);
      }
    })();
  });
  return { projections, loading, ready, failed, completedRevision, retry: () => setRetryVersion((value) => value + 1) };
}
