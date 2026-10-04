import { describe, expect, it, vi } from 'vitest';
import { resumeQuitAfterCheckpoint } from './shutdownCheckpoint';

const nextTurn = (): Promise<void> => new Promise(resolve => setImmediate(resolve));

describe('shutdown checkpoint', () => {
  it('yields native quit dispatch even when no new snapshot is needed', async () => {
    const quit = vi.fn();
    resumeQuitAfterCheckpoint(Promise.resolve(), vi.fn(), quit);
    await Promise.resolve();
    await Promise.resolve();
    expect(quit).not.toHaveBeenCalled();
    await nextTurn();
    expect(quit).toHaveBeenCalledOnce();
  });

  it('waits for a pending snapshot before resuming quit', async () => {
    let finish!: () => void;
    const checkpoint = new Promise<void>(resolve => { finish = resolve; });
    const quit = vi.fn();
    resumeQuitAfterCheckpoint(checkpoint, vi.fn(), quit);
    await nextTurn();
    expect(quit).not.toHaveBeenCalled();
    finish();
    await nextTurn();
    await nextTurn();
    expect(quit).toHaveBeenCalledOnce();
  });

  it('reports snapshot failure and still permits shutdown', async () => {
    const error = new Error('snapshot unavailable');
    const report = vi.fn();
    const quit = vi.fn();
    resumeQuitAfterCheckpoint(Promise.reject(error), report, quit);
    await nextTurn();
    await nextTurn();
    expect(report).toHaveBeenCalledWith(error);
    expect(quit).toHaveBeenCalledOnce();
  });
});
