import { afterEach, describe, expect, it, vi } from 'vitest';
import { RatingWriteQueue } from './ratingWriteQueue';
import type { FlashcardRatingCommand } from '../../shared/flashcardRating';

const command = (attemptId: string): FlashcardRatingCommand => ({ attemptId, events: {}, patch: { baseRev: 1, entries: [] } });

afterEach(() => vi.useRealTimers());

describe('RatingWriteQueue', () => {
  it('batches rapid ratings at 300ms from the first attempt and acknowledges one write', async () => {
    vi.useFakeTimers();
    const persist = vi.fn().mockResolvedValue(2);
    const queue = new RatingWriteQueue(persist);
    const first = queue.enqueue(command('first'));
    await vi.advanceTimersByTimeAsync(250);
    const second = queue.enqueue(command('second'));
    expect(persist).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(50);
    expect(persist).toHaveBeenCalledExactlyOnceWith([command('first'), command('second')]);
    expect(await Promise.all([first, second])).toEqual([2, 2]);
    expect(queue.hasPending).toBe(false);
  });

  it('flushes on demand before the debounce and drains ratings arriving during a write', async () => {
    vi.useFakeTimers();
    let acknowledge!: (revision: number) => void;
    const persist = vi.fn().mockImplementationOnce(() => new Promise<number>(resolve => { acknowledge = resolve; })).mockResolvedValue(3);
    const queue = new RatingWriteQueue(persist);
    const first = queue.enqueue(command('first'));
    const flush = queue.flush();
    const second = queue.enqueue(command('second'));
    acknowledge(2);
    await flush;
    expect(await Promise.all([first, second])).toEqual([2, 3]);
    expect(persist).toHaveBeenCalledTimes(2);
    expect(queue.hasPending).toBe(false);
  });

  it('retains failed commands and retries stable ids without duplicating their patches', async () => {
    vi.useFakeTimers();
    const persist = vi.fn().mockRejectedValueOnce(new Error('disk full')).mockResolvedValue(2);
    const queue = new RatingWriteQueue(persist);
    const failed = queue.enqueue(command('first'));
    const rejection = expect(failed).rejects.toThrow('disk full');
    await expect(queue.flush()).rejects.toThrow('disk full');
    await rejection;
    expect(queue.hasPending).toBe(true);
    const retry = queue.enqueue(command('first'));
    await queue.flush();
    expect(await retry).toBe(2);
    expect(persist.mock.calls[1][0]).toEqual([command('first')]);
    expect(queue.hasPending).toBe(false);
  });

  it('acknowledges an already committed attempt without applying its counters again', async () => {
    vi.useFakeTimers();
    const persist = vi.fn().mockResolvedValue(2);
    const queue = new RatingWriteQueue(persist);
    const first = queue.enqueue(command('stable'));
    await queue.flush();
    expect(await first).toBe(2);
    expect(await queue.enqueue(command('stable'))).toBe(2);
    expect(persist).toHaveBeenCalledTimes(1);
    expect(queue.hasPending).toBe(false);
  });
});
