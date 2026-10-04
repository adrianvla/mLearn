import { describe, expect, it, vi } from 'vitest';
import { discoverReviewRecordings } from './reviewRecordings';
describe('actual recording availability for Home admission', () => {
  it('checks the whole unique pool with bounded concurrency and distinguishes missing recordings', async () => {
    let active = 0; let maximum = 0;
    const lookup = vi.fn(async (id: string) => { active++; maximum = Math.max(maximum, active);
      await Promise.resolve(); active--; return id === 'late' ? 'flashcard-audio://late' : null; });
    const result = await discoverReviewRecordings([...Array.from({ length: 40 }, (_, i) => `card-${i}`), 'late', 'late'], lookup, new AbortController().signal);
    expect(result.late).toBe(true); expect(result['card-0']).toBe(false);
    expect(Object.keys(result)).toHaveLength(41); expect(lookup).toHaveBeenCalledTimes(41); expect(maximum).toBeLessThanOrEqual(4);
  });
  it('refuses a partial pool when recording discovery fails', async () => {
    const lookup = vi.fn(async (id: string) => { if (id === 'bad') throw new Error('unavailable'); return null; });
    await expect(discoverReviewRecordings(['ok', 'bad'], lookup, new AbortController().signal)).rejects.toThrow('unavailable');
  });
  it('stops scheduling stale lookups after cancellation', async () => {
    const controller = new AbortController(); let release!: () => void;
    const held = new Promise<string | null>(resolve => { release = () => resolve(null); });
    const lookup = vi.fn(() => held);
    const pending = discoverReviewRecordings(Array.from({ length: 40 }, (_, i) => String(i)), lookup, controller.signal);
    const assertion = expect(pending).rejects.toThrow('cancelled');
    controller.abort(); release(); await assertion;
    expect(lookup).toHaveBeenCalledTimes(4);
  });
});
