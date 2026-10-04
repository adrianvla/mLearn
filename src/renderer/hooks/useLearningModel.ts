import { createMemo, createResource, type Accessor } from 'solid-js';
import { fitLearningModel } from '../../shared/learningModel';
import { eventsVersion, queryLearningEvidence } from '../services/knowledgeEvents';
import { useWindowActivity } from './useWindowActivity';

/** One bounded read per foreground admission/revision, never per candidate.
 * Re-entry also refreshes elapsed-time predictions and recovers missed notifications. */
export function useLearningModel(language: Accessor<string>) {
  const active = useWindowActivity();
  let wasActive = false;
  let admission = 0;
  const request = createMemo<{ language: string; revision: number; admission: number } | undefined>(previous => {
    if (!active()) { wasActive = false; return previous; }
    if (!wasActive) admission++;
    wasActive = true;
    return language() ? { language: language(), revision: eventsVersion(), admission } : undefined;
  }, undefined, { equals: (a, b) => a?.language === b?.language && a?.revision === b?.revision && a?.admission === b?.admission });
  const [snapshot, { refetch }] = createResource(request, source => queryLearningEvidence(source.language));
  const model = createMemo(() => {
    const current = snapshot.state === 'ready' ? snapshot() : undefined;
    return current ? fitLearningModel(current.events, Date.now(), `journal:${current.sequence}:window:${request()?.revision}:${current.firstT ?? 'empty'}:${current.truncated ? 'truncated' : 'exact'}`) : undefined;
  });
  return { model, snapshot, ready: () => snapshot.state === 'ready', failed: () => snapshot.state === 'errored', retry: () => void refetch() };
}
