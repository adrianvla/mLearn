import { expect, it } from 'vitest';
import { toUsageSeries } from './ProviderHistory';

it('charts latency and errors separately for every model and group history', () => {
  const series = toUsageSeries([{
    start: 1,
    end: 2,
    coverage: 'complete',
    values: [
      { modelId: 'model-a', modelKey: 'Model A', groupId: 'school', requests: 3, costMicros: 400, latencyMs: 120, errors: 2 },
      { modelId: 'model-b', modelKey: 'Model B', groupId: 'class-a', requests: 5, costMicros: 600, latencyMs: 250, errors: 1 },
    ],
  }]);

  expect(series).toHaveLength(8);
  expect(series.find((item) => item.key === 'latencyMs:model-a:school')?.values[0].value).toBe(120);
  expect(series.find((item) => item.key === 'errors:model-a:school')?.values[0].value).toBe(2);
  expect(series.find((item) => item.key === 'latencyMs:model-b:class-a')?.values[0].value).toBe(250);
  expect(series.find((item) => item.key === 'errors:model-b:class-a')?.values[0].value).toBe(1);
});
