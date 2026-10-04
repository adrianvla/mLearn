import { afterEach, describe, expect, it, vi } from 'vitest';
import { forecastPreparationOffThread } from './learningPreparationForecast';
import { fitLearningModel, learningAddress, type LearningAction } from '../../shared/learningModel';
import { inferLearningOpportunities } from '../../shared/learningOpportunities';
import { chooseHomeLearningAction } from '../windows/main/routes/homeLearningDecision';
const target = { entityId: 'future:x', capability: 'arbitrary::access' };
const action: LearningAction = { key: 'x', family: 'task', targets: [target], mode: 'practice' };
const model = fitLearningModel([], 1000);
let instance: TestWorker;
class TestWorker {
  onmessage?: (event: MessageEvent) => void;
  onerror?: () => void;
  terminate = vi.fn();
  postMessage = vi.fn();
  constructor() { instance = this; }
}
afterEach(() => vi.unstubAllGlobals());
describe('preparation forecast worker admission', () => {
  it('carries Home Review exclusivity into the actual worker input without dropping declared constraints', async () => {
    vi.stubGlobal('Worker', TestWorker);
    const context = { nowMs: 1000, horizonDays: 10, deferDays: 3, assessmentAt: 1000000 };
    const choice = chooseHomeLearningAction(model, [
      { ...action, action: 'review', key: 'written', cardId: 'one-card', exclusiveOpportunityGroups: ['opaque:shared-slot'] },
      { ...action, action: 'review', key: 'sound', cardId: 'one-card', targets: [{ ...target, capability: 'future::sound' }] },
    ], context, [600], inferLearningOpportunities([], 1000));
    const pending = choice.preparationForecast();
    const input = structuredClone(instance.postMessage.mock.calls[0][0]);
    expect(input[1][0].exclusiveOpportunityGroups).toEqual(['opaque:shared-slot', 'review-card:one-card']);
    expect(input[1][1].exclusiveOpportunityGroups).toEqual(['review-card:one-card']);
    expect(input[2].exclusiveOpportunityGroups).toContain('review-card:one-card');
    instance.onmessage!({ data: { unavailable: true } } as MessageEvent);
    await pending;
  });
  it('sends fitted memory for later scope tasks as well as the initial offer', async () => {
    vi.stubGlobal('Worker', TestWorker);
    const future = { ...action, key: 'future', targets: [{ ...target, entityId: 'future:later' }] };
    const state = { particles: [], observations: 1, lastAt: 0, lastTask: 'test' };
    const fitted = { ...model, memories: { [learningAddress(future.targets[0])]: state, unrelated: state } };
    const pending = forecastPreparationOffThread(fitted, [action], action,
      { nowMs: 1000, horizonDays: 10, deferDays: 3, assessmentAt: 1000000 }, inferLearningOpportunities([], 1000), [future]);
    expect(Object.keys(instance.postMessage.mock.calls[0][0][0].memories)).toEqual([learningAddress(future.targets[0])]);
    expect(instance.postMessage.mock.calls[0][0][5]).toEqual([future]);
    instance.onmessage!({ data: { unavailable: true } } as MessageEvent);
    await pending;
  });
  it('keeps relevant fitted memory beyond the old 256-task admission cutoff', async () => {
    vi.stubGlobal('Worker', TestWorker);
    const scope = Array.from({ length: 300 }, (_, index) => ({ ...action, key: `scope:${index}`,
      targets: [{ ...target, entityId: `scope:${index}` }] }));
    const address = learningAddress(scope[299].targets[0]);
    const state = { particles: [], observations: 1, lastAt: 0, lastTask: 'test' };
    const pending = forecastPreparationOffThread({ ...model, memories: { [address]: state } }, [action], action,
      { nowMs: 1000, horizonDays: 10, deferDays: 3, assessmentAt: 1000000 }, inferLearningOpportunities([], 1000), scope);
    expect(instance.postMessage.mock.calls[0][0][0].memories).toHaveProperty(address);
    instance.onmessage!({ data: { unavailable: true } } as MessageEvent);
    await pending;
  });
  it('keeps the asynchronous task off the caller and sends only relevant fitted state', async () => {
    vi.stubGlobal('Worker', TestWorker);
    const state = { particles: [], observations: 0, lastAt: 0, lastTask: 'test' };
    const fitted = { ...model, memories: { [learningAddress(target)]: state, unrelated: state } };
    const pending = forecastPreparationOffThread(fitted, [action], action,
      { nowMs: 1000, horizonDays: 10, deferDays: 3, assessmentAt: 1000000 }, inferLearningOpportunities([], 1000));
    expect(instance.postMessage).toHaveBeenCalledOnce();
    expect(Object.keys(instance.postMessage.mock.calls[0][0][0].memories)).toEqual([learningAddress(target)]);
    const reply = { version: 'preparation-continuation@1' };
    instance.onmessage!({ data: { forecast: reply } } as MessageEvent);
    expect(await pending).toEqual(reply);
    expect(instance.terminate).toHaveBeenCalledOnce();
    expect(Object.keys(fitted.memories)).toHaveLength(2);
  });
  it.each(['error', 'unavailable'])('settles %s as unavailable so actual work can continue', async mode => {
    vi.stubGlobal('Worker', TestWorker);
    const pending = forecastPreparationOffThread(model, [action], action,
      { nowMs: 1000, horizonDays: 10, deferDays: 3, assessmentAt: 1000000 }, inferLearningOpportunities([], 1000));
    if (mode === 'error') instance.onerror!();
    else instance.onmessage!({ data: { unavailable: true } } as MessageEvent);
    expect(await pending).toMatchObject({ status: 'unavailable' });
    expect(instance.terminate).toHaveBeenCalledOnce();
  });
  it('does not start a worker without a future assessment constraint', async () => {
    const constructor = vi.fn();
    vi.stubGlobal('Worker', constructor);
    expect(await forecastPreparationOffThread(model, [action], action,
      { nowMs: 1000, horizonDays: 10, deferDays: 3 }, inferLearningOpportunities([], 1000))).toBeUndefined();
    expect(constructor).not.toHaveBeenCalled();
  });
  it('records missing support without a synchronous fallback or invented forecast', async () => {
    vi.stubGlobal('Worker', undefined);
    expect(await forecastPreparationOffThread(model, [action], action,
      { nowMs: 1000, horizonDays: 10, deferDays: 3, assessmentAt: 1000000 }, inferLearningOpportunities([], 1000)))
      .toEqual({ status: 'unavailable', reason: 'worker-not-supported' });
  });
});
