import { createMemo, createResource, type Accessor } from 'solid-js';
import { fitLearningModel } from '../../shared/learningModel';
import { eventsVersion, queryLearningEvidence } from '../services/knowledgeEvents';
import { useWindowActivity } from './useWindowActivity';

/** One bounded read per language/journal revision, never per candidate.
 * Background changes coalesce on refocus; clean refocus retains the snapshot. */
export function useLearningModel(language: Accessor<string>) {
  const active = useWindowActivity();
  const request = createMemo<{ language: string; revision: number } | undefined>(previous => {
    if (!active()) return previous;
    const currentLanguage = language();
    return currentLanguage ? { language: currentLanguage, revision: eventsVersion() } : undefined;
  }, undefined, { equals: (a, b) => a?.language === b?.language && a?.revision === b?.revision });
  const [resource, { refetch }] = createResource(request, async source => ({
    language: source.language, evidence: await queryLearningEvidence(source.language),
  }));
  // A journal refresh updates forecasts in the background. An already fitted
  // same-language model still admits the next encounter while that read runs.
  // Never carry a different language's model through a language switch.
  const snapshot = createMemo(() => {
    if (resource.state === 'errored') return undefined;
    const latest = resource.latest;
    return latest?.language === language() ? latest.evidence : undefined;
  });
  const model = createMemo(() => {
    const current = snapshot();
    return current?.model ?? (current ? fitLearningModel(current.events, Date.now(), `journal:${current.sequence}:${current.firstT ?? 'empty'}:${current.truncated ? 'truncated' : 'exact'}`) : undefined);
  });
  return { model, snapshot, ready: () => snapshot() !== undefined, failed: () => resource.state === 'errored', retry: () => void refetch() };
}
