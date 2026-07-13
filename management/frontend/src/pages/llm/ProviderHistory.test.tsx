import { expect, it } from 'vitest';
import { toUsageSeries } from './ProviderHistory';

it('charts provider latency and errors alongside requests and cost history', () => {
  const series = toUsageSeries([{
    start: 1,
    end: 2,
    coverage: 'complete',
    values: [{ modelId: 'model-a', modelKey: 'Model A', groupId: 'school', requests: 3, costMicros: 400, latencyMs: 120, errors: 2 }],
  }]);

  expect(series.map((item) => item.key)).toEqual(['requests', 'cost', 'latency', 'errors']);
  expect(series.find((item) => item.key === 'latency')?.values[0].value).toBe(120);
  expect(series.find((item) => item.key === 'errors')?.values[0].value).toBe(2);
});
