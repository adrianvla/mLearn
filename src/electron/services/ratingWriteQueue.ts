import type { FlashcardRatingCommand } from '../../shared/flashcardRating';

interface PendingRating {
  command: FlashcardRatingCommand;
  waiters: Array<{ resolve: (revision: number) => void; reject: (error: unknown) => void }>;
}

/** Main-process ownership survives a review window closing during the debounce. */
export class RatingWriteQueue {
  private readonly pending = new Map<string, PendingRating>();
  private readonly committed = new Map<string, number>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private active: Promise<void> | undefined;

  constructor(private readonly persist: (commands: readonly FlashcardRatingCommand[]) => Promise<number>) {}

  get hasPending(): boolean { return this.pending.size > 0; }

  enqueue(command: FlashcardRatingCommand): Promise<number> {
    const committedRevision = this.committed.get(command.attemptId);
    if (committedRevision !== undefined) return Promise.resolve(committedRevision);
    let entry = this.pending.get(command.attemptId);
    if (!entry) {
      entry = { command, waiters: [] };
      this.pending.set(command.attemptId, entry);
    }
    const result = new Promise<number>((resolve, reject) => entry!.waiters.push({ resolve, reject }));
    this.schedule();
    return result;
  }

  private schedule(): void {
    if (this.timer !== undefined || this.active || !this.hasPending) return;
    // Bound the batch from its first attempt; continuous rating cannot keep
    // resetting the debounce and postpone persistence indefinitely.
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.flush().catch(() => undefined); // Failed commands stay queued for explicit retry.
    }, 300);
  }

  async flush(): Promise<void> {
    if (this.timer !== undefined) { clearTimeout(this.timer); this.timer = undefined; }
    if (this.active) { await this.active; return this.flush(); }
    if (!this.hasPending) return;
    const batch = [...this.pending.values()];
    const write = (async () => {
      try {
        const revision = await this.persist(batch.map(entry => entry.command));
        for (const entry of batch) {
          this.committed.set(entry.command.attemptId, revision);
          this.pending.delete(entry.command.attemptId);
          for (const waiter of entry.waiters.splice(0)) waiter.resolve(revision);
        }
      } catch (error) {
        for (const entry of batch) for (const waiter of entry.waiters.splice(0)) waiter.reject(error);
        throw error;
      }
    })();
    this.active = write;
    try { await write; } finally { this.active = undefined; }
    if (this.hasPending) await this.flush();
  }
}
