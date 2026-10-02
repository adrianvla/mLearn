import { afterEach, describe, expect, it, vi } from 'vitest';
import { RatingWriteQueue } from './ratingWriteQueue';
import { RatingAdmissionRefusal, type FlashcardRatingCommand } from '../../shared/flashcardRating';

const command = (attemptId: string): FlashcardRatingCommand => ({ attemptId, events: {}, patch: { baseRev: 1, entries: [] } });

afterEach(() => vi.useRealTimers());

describe('RatingWriteQueue', () => {
  it('releases never-admitted refusals, saves independent responses and leaves later saves and quit unblocked', async () => {
    vi.useFakeTimers();
    const persist = vi.fn().mockRejectedValueOnce(new RatingAdmissionRefusal(['stale', 'dependent'])).mockResolvedValue(2);
    const queue = new RatingWriteQueue(persist);
    const stale = queue.enqueue(command('stale'));
    const dependent = queue.enqueue(command('dependent'));
    const independent = queue.enqueue(command('independent'));
    const refusals = [expect(stale).rejects.toThrow(/changed before admission/), expect(dependent).rejects.toThrow(/changed before admission/)];
    await expect(queue.flush()).rejects.toThrow(/changed before admission/);
    await Promise.all(refusals);
    expect(await independent).toBe(2);
    expect(persist.mock.calls[1][0]).toEqual([command('independent')]);
    expect(queue.hasPending).toBe(false);
    await expect(queue.flush()).resolves.toBeUndefined();
  });
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
