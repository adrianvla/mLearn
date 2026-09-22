import { createStore, reconcile } from 'solid-js/store';
import type { OcrResult } from '../../../components/reader';

/** Page results and the lifetime of requests that may write them. */
export function createReaderOcrState() {
  const [results, setResults] = createStore<Record<string, OcrResult>>({});
  let generation = 0;
  return {
    results,
    reset() {
      generation += 1;
      setResults(reconcile({}));
    },
    capture() {
      const requestGeneration = generation;
      return {
        isCurrent: () => requestGeneration === generation,
        write(pageId: string, result: OcrResult) {
          if (requestGeneration !== generation) return false;
          setResults(pageId, result);
          return true;
        },
      };
    },
  };
}
