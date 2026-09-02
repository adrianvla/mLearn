import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Settings } from '../../shared/types';
import type { LogRecord } from '../../shared/utils/logger';

const mockRunDreamer = vi.fn();
vi.mock('./dreamerService', () => ({ runDreamer: mockRunDreamer }));

const mockComplete = vi.fn();
vi.mock('./dreamerLlm', () => ({ complete: mockComplete }));

// resetModules discards the statically-imported graph, so the module under
// test must be re-imported after the mocks are (re)applied.
let runtime: typeof import('./dreamerRuntime');
let logger: typeof import('../../shared/utils/logger');
let records: LogRecord[];

function settings(partial: Partial<Settings>): Settings {
  return {
    ...({ llmProvider: 'builtin', inferenceCloudTier: 'conservative' } as Settings),
    ...partial,
  };
}

describe('dreamerRuntime', () => {
  beforeEach(async () => {
    vi.resetModules();
    records = [];
    runtime = await import('./dreamerRuntime');
    // resetModules re-evaluates the logger too; bind the sink to the same
    // fresh instance the runtime module captured.
    logger = await import('../../shared/utils/logger');
    logger.setLogSink({ write: (record) => records.push(record) });
  });

  afterEach(() => logger.setLogSink(null));

  it('runs consolidation once for a permitted room, wiring the llm bridge', async () => {
    mockRunDreamer.mockResolvedValue(undefined);

    await runtime.consolidateRoom('room-a', { getSettings: () => settings({ llmProvider: 'ollama' }) });

    expect(mockRunDreamer).toHaveBeenCalledTimes(1);
    expect(mockRunDreamer).toHaveBeenCalledWith('room-a', {
      policy: expect.objectContaining({ kind: 'local' }),
      llmFn: mockComplete,
    });
  });

  it('never dreams on the conservative-cloud tier', async () => {
    await runtime.consolidateRoom('room-a', {
      getSettings: () => settings({ llmProvider: 'cloud', inferenceCloudTier: 'conservative' }),
    });

    expect(mockRunDreamer).not.toHaveBeenCalled();
    expect(mockComplete).not.toHaveBeenCalled();
    expect(records.filter((record) => record.level === 'ERROR')).toHaveLength(0);
  });

  it('dedupes concurrent calls for the same room to one run', async () => {
    const gate = Promise.withResolvers<void>();
    mockRunDreamer.mockImplementation(() => gate.promise);

    const first = runtime.consolidateRoom('room-a', { getSettings: () => settings({ llmProvider: 'builtin' }) });
    const second = runtime.consolidateRoom('room-a', { getSettings: () => settings({ llmProvider: 'builtin' }) });
    await second;

    expect(mockRunDreamer).toHaveBeenCalledTimes(1);

    gate.resolve();
    await first;
    await runtime.consolidateRoom('room-a', { getSettings: () => settings({ llmProvider: 'builtin' }) });
    expect(mockRunDreamer).toHaveBeenCalledTimes(2);
  });

  it('isolates run failures: no throw, error logged, room guard released', async () => {
    mockRunDreamer.mockRejectedValue(new Error('LLM unreachable'));

    await expect(
      runtime.consolidateRoom('room-a', { getSettings: () => settings({ llmProvider: 'builtin' }) })
    ).resolves.toBeUndefined();

    expect(records.filter((record) => record.level === 'ERROR')).toHaveLength(1);

    mockRunDreamer.mockResolvedValue(undefined);
    await runtime.consolidateRoom('room-a', { getSettings: () => settings({ llmProvider: 'builtin' }) });
    expect(mockRunDreamer).toHaveBeenCalledTimes(2);
  });
});
