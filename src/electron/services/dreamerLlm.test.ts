import { beforeEach, describe, expect, it, vi } from 'vitest';
const { completeJob } = vi.hoisted(() => ({ completeJob: vi.fn() }));
vi.mock('./llmRouter', () => ({ completeJob }));
import { complete, MAINTENANCE_INPUT_CHARACTERS, MAINTENANCE_OUTPUT_CHARACTERS } from './dreamerLlm';
describe('maintenance provider boundary', () => {
  beforeEach(() => completeJob.mockReset());
  it('uses the shared queue with its own cancellation and output budget', async () => {
    completeJob.mockResolvedValue('result');
    const controller = new AbortController();
    expect(await complete('scoped input', controller.signal)).toBe('result');
    expect(completeJob).toHaveBeenCalledWith([{ role: 'user', content: 'scoped input' }], controller.signal, MAINTENANCE_OUTPUT_CHARACTERS);
  });
  it('refuses unbounded input before provider exposure', async () => {
    await expect(complete('x'.repeat(MAINTENANCE_INPUT_CHARACTERS + 1))).rejects.toThrow('budget');
    expect(completeJob).not.toHaveBeenCalled();
  });
});
