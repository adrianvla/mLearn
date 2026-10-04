import type { chooseHomeLearningChoice } from '../windows/main/routes/homeLearningDecision';

export type HomeChoiceInput = Parameters<typeof chooseHomeLearningChoice>;
export type HomeChoice = ReturnType<typeof chooseHomeLearningChoice>;

/** Numerical Home selection runs off the UI thread; stale work is cancelled without timers. */
export function chooseHomeOffThread(input: HomeChoiceInput, signal: AbortSignal): Promise<HomeChoice> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new Error('Home selection cancelled')); return; }
    let worker: Worker | undefined;
    let settled = false;
    const abort = () => {
      if (settled) return;
      settled = true; worker?.terminate(); reject(new Error('Home selection cancelled'));
    };
    const finish = (result: HomeChoice | undefined) => {
      if (settled) return;
      settled = true; signal.removeEventListener('abort', abort); worker?.terminate();
      if (result) resolve(result); else reject(new Error('Home selection unavailable'));
    };
    try {
      worker = new Worker(new URL('../workers/homeLearningChoice.worker.ts', import.meta.url), { type: 'module' });
      signal.addEventListener('abort', abort, { once: true });
      worker.onmessage = (event: MessageEvent<{ choice?: HomeChoice }>) => finish(event.data.choice);
      worker.onerror = () => finish(undefined);
      worker.postMessage(input);
    } catch (error) {
      signal.removeEventListener('abort', abort); worker?.terminate(); reject(error);
    }
  });
}
