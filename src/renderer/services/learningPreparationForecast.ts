import { preparationTaskPool, type forecastLearningPreparation } from '../../shared/learningPreparation';
import { learningAddress } from '../../shared/learningModel';

type ForecastInput = Parameters<typeof forecastLearningPreparation>;
export type PreparationForecastResult = ReturnType<typeof forecastLearningPreparation> | { status: 'unavailable'; reason: string };

/** Handoff-time forecast. Keep numerical continuation off the UI thread and never ship a journal to the worker. */
export function forecastPreparationOffThread(...input: ForecastInput): Promise<PreparationForecastResult> {
  if (!input[3].assessmentAt || !Number.isFinite(input[3].assessmentAt) || input[3].assessmentAt <= input[3].nowMs) return Promise.resolve(undefined);
  if (typeof Worker === 'undefined') return Promise.resolve({ status: 'unavailable', reason: 'worker-not-supported' });
  const tasks = preparationTaskPool(input[1], input[2], input[5]);
  const addresses = new Set(tasks.flatMap(action => action.targets.map(learningAddress)));
  const model = { ...input[0], memories: Object.fromEntries(Object.entries(input[0].memories).filter(([address]) => addresses.has(address))) };
  return new Promise(resolve => {
    let worker: Worker;
    try {
      worker = new Worker(new URL('../workers/learningPreparation.worker.ts', import.meta.url), { type: 'module' });
      const finish = (value: PreparationForecastResult) => { worker.terminate(); resolve(value); };
      worker.onmessage = (event: MessageEvent<{ forecast?: ReturnType<typeof forecastLearningPreparation>; unavailable?: boolean }>) =>
        finish(event.data.unavailable ? { status: 'unavailable', reason: 'forecast-computation-failed' } : event.data.forecast);
      worker.onerror = () => finish({ status: 'unavailable', reason: 'forecast-worker-failed' });
      worker.postMessage([model, ...input.slice(1)]);
    } catch {
      worker!?.terminate(); resolve({ status: 'unavailable', reason: 'forecast-worker-unavailable' });
    }
  });
}
