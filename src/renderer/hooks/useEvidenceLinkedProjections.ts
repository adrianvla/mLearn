import { createMemo, createResource, type Accessor } from 'solid-js';
import { projectedWordStatus } from '../../shared/graph/targets';
import { queryLanguageKeys, wordEventsVersion } from '../services/knowledgeEvents';
import { useKnowledgeProjections } from './useKnowledgeProjections';

/** Shared collection-read contract for curriculum and learner summaries.
 * The graph owns identity transfer; UI surfaces do not merge spelling hashes.
 */
export function useEvidenceLinkedProjections(input: Accessor<{
  language: string;
  surfaces: readonly string[];
  materializedKeys: readonly string[];
} | undefined>) {
  const [journal, { refetch }] = createResource(
    () => { const source = input(); return source ? { language: source.language, version: wordEventsVersion() } : undefined; },
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
    retry: () => { void refetch(); projected.retry(); },
    resolveState: (word: string) => projectedWordStatus(projected.projections().get(word)),
  };
}
