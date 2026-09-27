import { expect, it, vi } from 'vitest';
import { runTtsRepairJobs } from './repairTtsJobs';

it('counts unique successful files separately from attempts and final failures', async () => {
  const generate = vi.fn(async (job: string) => job === 'a');
  const result = await runTtsRepairJobs(['a', 'b'], generate, () => {}, 3);
  expect(result).toEqual({ attempted: 2, attempts: 4, succeeded: 1, failed: 1 });
});

it('reports zero repaired when every attempt fails', async () => {
  const result = await runTtsRepairJobs(['a', 'b'], async () => false, () => {}, 3);
  expect(result).toEqual({ attempted: 2, attempts: 6, succeeded: 0, failed: 2 });
});

it('reports a local provider success without cloud authentication', async () => {
  const result = await runTtsRepairJobs(['local'], async () => true, () => {}, 3);
  expect(result).toEqual({ attempted: 1, attempts: 1, succeeded: 1, failed: 0 });
});
