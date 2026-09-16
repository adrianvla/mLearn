import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Settings } from '../../shared/types';
import type { LogRecord } from '../../shared/utils/logger';

vi.mock('../utils/platform', () => ({ getUserDataPath: () => '/tmp/test' }));
const mockRunReflection = vi.fn();
const mockReconcile = vi.fn();
vi.mock('./dreamerService', () => ({ runReflection: mockRunReflection, runDreamer: mockRunReflection, reconcilePendingReflections: () => mockReconcile() }));
const mockEvolve = vi.fn();
vi.mock('./scenarioDirector', () => ({ evolveScenario: mockEvolve, reconcilePendingScenarioEvolutions: () => mockEvolve() }));

const mockComplete = vi.fn();
vi.mock('./dreamerLlm', () => ({ complete: mockComplete }));

vi.mock('./settings', () => ({ loadSettings: () => ({ livingWorldEnabled: true }) }));

const mockLoadWorld = vi.fn(async () => ({ rooms: [{ id: 'room-a', title: 'Room', participantIds: [], createdAt: 1 }], threads: [], participants: [] }));
vi.mock('./worldStore', () => ({ loadWorld: () => mockLoadWorld() }));

// resetModules discards the statically-imported graph, so the module under
// test must be re-imported after the mocks are (re)applied.
let runtime: typeof import('./dreamerRuntime');
let logger: typeof import('../../shared/utils/logger');
let records: LogRecord[];

function settings(partial: Partial<Settings>): Settings {
  return {
    ...({ llmProvider: 'builtin', inferenceCloudTier: 'conservative', livingWorldEnabled: true } as Settings),
    ...partial,
  };
}

describe('dreamerRuntime', () => {
  beforeEach(async () => {
    vi.resetModules();
    mockRunReflection.mockReset().mockResolvedValue(undefined);
    mockEvolve.mockReset().mockResolvedValue(undefined);
    mockReconcile.mockReset().mockResolvedValue(undefined);
    mockLoadWorld.mockReset().mockResolvedValue({ rooms: [{ id: 'room-a', title: 'Room', participantIds: [], createdAt: 1 }], threads: [], participants: [] });
    records = [];
    runtime = await import('./dreamerRuntime');
    // resetModules re-evaluates the logger too; bind the sink to the same
    // fresh instance the runtime module captured.
    logger = await import('../../shared/utils/logger');
    logger.setLogSink({ write: (record) => records.push(record) });
  });

  afterEach(() => logger.setLogSink(null));

  it('runs reflection and evolution once for a permitted room, wiring the llm bridge', async () => {
    await runtime.consolidateContext({ roomId: 'room-a' }, { getSettings: () => settings({ llmProvider: 'ollama' }) });

    expect(mockRunReflection).toHaveBeenCalledTimes(1);
    expect(mockRunReflection).toHaveBeenCalledWith({ roomId: 'room-a', scopeKind: 'sea' }, {
      policy: expect.objectContaining({ kind: 'local' }),
      llmFn: expect.any(Function),
      signal: expect.anything(),
    });
    expect(mockEvolve).toHaveBeenCalledTimes(1);
  });

  it('never dreams on the conservative-cloud tier', async () => {
    await runtime.consolidateContext({ roomId: 'room-a' }, {
      getSettings: () => settings({ llmProvider: 'cloud', inferenceCloudTier: 'conservative' }),
    });

    expect(mockRunReflection).not.toHaveBeenCalled();
    expect(mockComplete).not.toHaveBeenCalled();
    expect(records.filter((record) => record.level === 'ERROR')).toHaveLength(0);
  });

  it('reflects a sandbox thread on its own journal scope', async () => {
    mockLoadWorld.mockResolvedValue({
      rooms: [],
      threads: [{ id: 'thr-1', state: 'active', createdAt: 1, sandbox: { operationId: 'op', requestHash: 'h', bindings: [], baselineHeads: {} } }],
      participants: [],
    });

    await runtime.consolidateContext({ roomId: 'thr-1', threadId: 'thr-1' }, { getSettings: () => settings({ llmProvider: 'builtin' }) });

    expect(mockRunReflection).toHaveBeenCalledWith({ roomId: 'thr-1', scopeKind: 'thread', threadId: 'thr-1' }, expect.anything());
  });

  it('never redirects a saved Room-linked Thread trigger into Sea', async () => {
    mockLoadWorld.mockResolvedValue({ rooms: [], participants: [],
      threads: [{ id: 'archive', roomId: 'room-a', state: 'active', createdAt: 1 }] });
    await runtime.consolidateContext({ roomId: 'room-a', threadId: 'archive' }, { getSettings: () => settings({ llmProvider: 'builtin' }) });
    expect(mockRunReflection).toHaveBeenCalledWith({ roomId: 'room-a', scopeKind: 'thread', threadId: 'archive' }, expect.anything());
  });

  it('dedupes concurrent calls for the same room to one run', async () => {
    const gate = Promise.withResolvers<void>();
    mockRunReflection.mockImplementation(() => gate.promise);

    const first = runtime.consolidateContext({ roomId: 'room-a' }, { getSettings: () => settings({ llmProvider: 'builtin' }) });
    // A concurrent trigger for the same context joins the in-flight run
    // instead of starting a second one.
    const second = runtime.consolidateContext({ roomId: 'room-a' }, { getSettings: () => settings({ llmProvider: 'builtin' }) });
    await vi.waitFor(() => expect(mockRunReflection).toHaveBeenCalledTimes(1));

    gate.resolve();
    await Promise.all([first, second]);
    await runtime.consolidateContext({ roomId: 'room-a' }, { getSettings: () => settings({ llmProvider: 'builtin' }) });
    expect(mockRunReflection).toHaveBeenCalledTimes(2);
  });

  it('isolates run failures: no throw, error logged, room guard released', async () => {
    mockRunReflection.mockRejectedValue(new Error('LLM unreachable'));

    await expect(
      runtime.consolidateContext({ roomId: 'room-a' }, { getSettings: () => settings({ llmProvider: 'builtin' }) })
    ).resolves.toBeUndefined();

    expect(records.filter((record) => record.level === 'ERROR')).toHaveLength(1);

    mockRunReflection.mockResolvedValue(undefined);
    await runtime.consolidateContext({ roomId: 'room-a' }, { getSettings: () => settings({ llmProvider: 'builtin' }) });
    expect(mockRunReflection).toHaveBeenCalledTimes(2);
  });

  it('recovery runs without throwing when the ledger cannot be read', async () => {
    mockReconcile.mockRejectedValue(new Error('I/O failure'));

    await expect(runtime.reconcilePendingMaintenance()).resolves.toBeUndefined();
    expect(records.filter((record) => record.level === 'ERROR')).toHaveLength(1);
  });

  it('skips Sea-room maintenance without any model call while Living World consent is off', async () => {
    await runtime.consolidateContext({ roomId: 'room-a' }, { getSettings: () => settings({ llmProvider: 'builtin', livingWorldEnabled: false }) });

    expect(mockRunReflection).not.toHaveBeenCalled();
    expect(mockEvolve).not.toHaveBeenCalled();
    expect(mockComplete).not.toHaveBeenCalled();
    expect(records.filter((record) => record.level === 'ERROR')).toHaveLength(0);
  });

  it('skips sandbox-thread maintenance without any model call while Living World consent is off', async () => {
    mockLoadWorld.mockResolvedValue({
      rooms: [],
      threads: [{ id: 'thr-1', state: 'active', createdAt: 1, sandbox: { operationId: 'op', requestHash: 'h', bindings: [], baselineHeads: {} } }],
      participants: [],
    });

    await runtime.consolidateContext({ roomId: 'thr-1', threadId: 'thr-1' }, { getSettings: () => settings({ llmProvider: 'builtin', livingWorldEnabled: false }) });

    expect(mockRunReflection).not.toHaveBeenCalled();
    expect(mockEvolve).not.toHaveBeenCalled();
    expect(mockComplete).not.toHaveBeenCalled();
    expect(records.filter((record) => record.level === 'ERROR')).toHaveLength(0);
  });
});
