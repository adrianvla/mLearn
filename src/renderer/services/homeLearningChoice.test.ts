import { afterEach, describe, expect, it, vi } from 'vitest';
import { chooseHomeOffThread, type HomeChoiceInput } from './homeLearningChoice';
import { fitLearningModel } from '../../shared/learningModel';
import { chooseHomeLearningChoice } from '../windows/main/routes/homeLearningDecision';
let worker: TestWorker;
class TestWorker {
  onmessage?: (event: MessageEvent) => void;
  onerror?: () => void;
  terminate = vi.fn();
  postMessage = vi.fn();
  constructor() { worker = this; }
}
const input: HomeChoiceInput = [fitLearningModel([], 1000), [], { nowMs: 1000, horizonDays: 30, deferDays: 3 }, [60, 120, 300]];
afterEach(() => vi.unstubAllGlobals());
describe('Home asynchronous selection', () => {
  it('returns a serializable choice without running numerical selection on the caller', async () => {
    vi.stubGlobal('Worker', TestWorker);
    const pending = chooseHomeOffThread(input, new AbortController().signal);
    expect(worker.postMessage).toHaveBeenCalledWith(input);
    const choice = chooseHomeLearningChoice(...input);
    worker.onmessage!({ data: { choice } } as MessageEvent);
    expect(await pending).toEqual(choice);
    expect(worker.terminate).toHaveBeenCalledOnce();
  });
  it.each(['error', 'unavailable'])('rejects %s without inventing a synchronous choice', async mode => {
    vi.stubGlobal('Worker', TestWorker);
    const pending = chooseHomeOffThread(input, new AbortController().signal);
    const assertion = expect(pending).rejects.toThrow('unavailable');
    if (mode === 'error') worker.onerror!();
    else worker.onmessage!({ data: {} } as MessageEvent);
    await assertion;
    expect(worker.terminate).toHaveBeenCalledOnce();
  });
  it('cancels stale work and rejects a late result', async () => {
    vi.stubGlobal('Worker', TestWorker);
    const controller = new AbortController();
    const pending = chooseHomeOffThread(input, controller.signal);
    const assertion = expect(pending).rejects.toThrow('cancelled');
    controller.abort();
    worker.onmessage!({ data: { choice: chooseHomeLearningChoice(...input) } } as MessageEvent);
    await assertion;
    expect(worker.terminate).toHaveBeenCalledOnce();
  });
  it('does not create a worker for already cancelled admission', async () => {
    const constructor = vi.fn(); vi.stubGlobal('Worker', constructor);
    const controller = new AbortController(); controller.abort();
    await expect(chooseHomeOffThread(input, controller.signal)).rejects.toThrow('cancelled');
    expect(constructor).not.toHaveBeenCalled();
  });
  it('reports missing worker support without a fallback', async () => {
    vi.stubGlobal('Worker', undefined);
    await expect(chooseHomeOffThread(input, new AbortController().signal)).rejects.toThrow();
  });
});
