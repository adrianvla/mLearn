import { useEffect, useRef, useState } from 'react';
import type { DictionaryResult } from '@mlearn/contracts';
import { failure, type Failure } from '../failure';
import type { CaptureCandidate } from './CaptureList';

/** Looks up at most six targets; each source supplies its own scoped native read. */
export type MeaningLookup = (targetIds: string[]) => Promise<readonly DictionaryResult[]>;

/**
 * Nearby meanings for a view's capture candidates, read in bounded batches. A changed scope or
 * candidate set replaces the previous result rather than mixing entries from another view.
 */
export function useCandidateMeanings(lookup: MeaningLookup | null, scope: string, candidates: readonly CaptureCandidate[]) {
  const identity = JSON.stringify([scope, candidates.map(candidate => candidate.key)]);
  const [loaded, setLoaded] = useState<{ identity: string; items: readonly DictionaryResult[] } | null>(null);
  const [error, setError] = useState<{ identity: string; failure: Failure } | null>(null);
  const [reload, setReload] = useState(0);
  const current = useRef({ lookup, candidates });
  current.current = { lookup, candidates };
  const enabled = lookup !== null;
  useEffect(() => {
    const { lookup: load, candidates: selected } = current.current;
    if (!load) return;
    let active = true;
    setError(null);
    void (async () => {
      const items: DictionaryResult[] = [];
      const keys = selected.map(candidate => candidate.key);
      for (let offset = 0; offset < keys.length; offset += 6) {
        const batch = await load(keys.slice(offset, offset + 6));
        if (!active) return;
        items.push(...batch);
      }
      if (active) setLoaded({ identity, items });
    })().catch((cause: unknown) => {
      if (active) setError({ identity, failure: failure(cause, 'Dictionary entries for these words couldn’t be loaded.') });
    });
    return () => { active = false; };
  }, [identity, enabled, reload]);
  const items = loaded?.identity === identity ? loaded.items : [];
  const failed = error?.identity === identity ? error.failure : null;
  return {
    items,
    error: failed,
    pending: enabled && !failed && loaded?.identity !== identity,
    retry: () => setReload(value => value + 1),
    resolve(candidate: CaptureCandidate): CaptureCandidate | null {
      const entry = items.find(item => item.state === 'available' && item.summary.targetId === candidate.key);
      return entry?.state === 'available' ? { ...candidate, content: { ...candidate.content,
        reading: entry.summary.reading ?? '', meaning: entry.summary.summary } } : null;
    },
  };
}
