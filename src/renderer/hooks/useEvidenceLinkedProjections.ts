import { createMemo, createResource, createSignal, type Accessor } from 'solid-js';
import { projectedWordStatus } from '../../shared/graph/targets';
import { queryLanguageKeys, wordEventsVersion } from '../services/knowledgeEvents';
import { useKnowledgeProjections } from './useKnowledgeProjections';
import { useWindowActivity } from './useWindowActivity';

/** Shared collection-read contract for curriculum and learner summaries.
 * The graph owns identity transfer; UI surfaces do not merge spelling hashes.
 */
export function useEvidenceLinkedProjections(input: Accessor<{
  language: string;
  surfaces: readonly string[];
  materializedKeys: readonly string[];
} | undefined>) {
  const active = useWindowActivity();
  const [retryVersion, setRetryVersion] = createSignal(0);
  const desiredJournal = createMemo(() => {
    const source = input();
    return source ? { language: source.language, version: wordEventsVersion(), retry: retryVersion() } : undefined;
  }, undefined, { equals: (before, after) => before?.language === after?.language
    && before?.version === after?.version && before?.retry === after?.retry });
  // Retain the admitted request on blur. Multiple invalidations admit only
  // their latest version on focus; clean focus keeps the same resource.
  const journalRequest = createMemo<ReturnType<typeof desiredJournal>>(previous => active() ? desiredJournal() : previous);
  const [journal] = createResource(
    journalRequest,
    source => queryLanguageKeys(source.language),
  );
  const evidenceKeys = createMemo(() => [...new Set([...(journal.state === 'ready' ? journal() ?? [] : []), ...(input()?.materializedKeys ?? [])])]);
  const projected = useKnowledgeProjections(() => {
    const source = input();
    return source && journal.state === 'ready' ? { language: source.language, surfaces: source.surfaces, evidenceKeys: evidenceKeys() } : undefined;
  });
  return {
    ...projected,
    evidenceKeys,
    ready: () => journal.state === 'ready' && projected.ready(),
    failed: () => journal.state === 'errored' || projected.failed(),
    retry: () => { setRetryVersion(version => version + 1); projected.retry(); },
    resolveState: (word: string) => projectedWordStatus(projected.projections().get(word)),
  };
}
