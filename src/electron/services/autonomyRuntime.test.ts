import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../../shared/types';

const mocks = vi.hoisted(() => ({
  loadSettings: vi.fn(),
  runAutonomyPass: vi.fn(),
  reconcilePendingAutonomy: vi.fn(),
  completeJob: vi.fn(),
  consolidateContext: vi.fn(),
  loadWorld: vi.fn(),
  getUserDataPath: vi.fn(() => '/tmp/autonomy-runtime'),
}));

vi.mock('./settings', () => ({ loadSettings: mocks.loadSettings }));
vi.mock('./autonomyService', () => ({
  AUTONOMY_LIMITS: { outputCharacters: 6000 },
  runAutonomyPass: mocks.runAutonomyPass,
  reconcilePendingAutonomy: mocks.reconcilePendingAutonomy,
}));
vi.mock('./llmRouter', () => ({ completeJob: mocks.completeJob }));
vi.mock('./dreamerRuntime', () => ({ consolidateContext: mocks.consolidateContext }));
vi.mock('./worldStore', () => ({ loadWorld: mocks.loadWorld }));
vi.mock('../utils/platform', () => ({ getUserDataPath: mocks.getUserDataPath }));

describe('V09 main-owned autonomy runtime', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.loadSettings.mockReturnValue({
      ...DEFAULT_SETTINGS,
      livingWorldEnabled: true,
      worldAutonomyEnabled: true,
      llmEnabled: true,
    });
    mocks.consolidateContext.mockResolvedValue(undefined);
    mocks.reconcilePendingAutonomy.mockResolvedValue([]);
    mocks.loadWorld.mockResolvedValue({ rooms: [], threads: [], participants: [], autonomyJobs: [] });
  });

  it('owns one background pass globally and does not start a second Room', async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    mocks.runAutonomyPass.mockImplementation(async () => {
      await gate;
      return { kind: 'waiting' };
    });
    const runtime = await import('./autonomyRuntime');
    const first = runtime.runRoomAutonomy('room-a');
    await vi.waitFor(() => expect(mocks.runAutonomyPass).toHaveBeenCalledTimes(1));
    await expect(runtime.runRoomAutonomy('room-b')).resolves.toEqual({ kind: 'waiting' });
    expect(mocks.runAutonomyPass).toHaveBeenCalledTimes(1);
    release();
    await expect(first).resolves.toEqual({ kind: 'waiting' });
  });

  it('routes generation as bounded background inference and runs ordinary reflection after commit', async () => {
    mocks.completeJob.mockResolvedValue('model result');
    mocks.runAutonomyPass.mockImplementation(async (_roomId: string, deps: { llmFn: (prompt: string, id: string) => Promise<string> }) => {
      expect(await deps.llmFn('bounded prompt', 'person-a')).toBe('model result');
      return { kind: 'committed', jobId: 'job-a' };
    });
    const runtime = await import('./autonomyRuntime');
    await expect(runtime.runRoomAutonomy('room-a')).resolves.toEqual({ kind: 'committed', jobId: 'job-a' });
    expect(mocks.completeJob).toHaveBeenCalledWith(
      [{ role: 'user', content: 'bounded prompt' }],
      expect.any(AbortSignal),
      6000,
      'background',
    );
    expect(mocks.consolidateContext).toHaveBeenCalledWith({ roomId: 'room-a' }, expect.any(Object));
  });

  it('does not enter production autonomy when the user pauses it', async () => {
    mocks.loadSettings.mockReturnValue({ ...DEFAULT_SETTINGS, livingWorldEnabled: true, worldAutonomyEnabled: false });
    const runtime = await import('./autonomyRuntime');
    await expect(runtime.runRoomAutonomy('room-a')).resolves.toEqual({ kind: 'waiting' });
    expect(mocks.runAutonomyPass).not.toHaveBeenCalled();
  });

  it('replays post-occurrence reflection for recovered committed publications', async () => {
    mocks.reconcilePendingAutonomy.mockResolvedValue(['job-a']);
    mocks.loadWorld.mockResolvedValue({
      rooms: [{ id: 'room-a' }], threads: [], participants: [],
      autonomyJobs: [{ jobId: 'job-a', roomId: 'room-a' }],
    });
    const runtime = await import('./autonomyRuntime');
    await runtime.reconcilePendingAutonomyRuntime();
    expect(mocks.consolidateContext).toHaveBeenCalledWith({ roomId: 'room-a' }, expect.any(Object));
  });

  it('heals the bounded post-commit/pre-reflection crash boundary on startup', async () => {
    mocks.reconcilePendingAutonomy.mockResolvedValue([]);
    mocks.loadWorld.mockResolvedValue({
      rooms: [{ id: 'room-a' }], threads: [], participants: [],
      autonomyJobs: [{ jobId: 'job-a', roomId: 'room-a', status: 'committed', result: 'episode', createdAt: 1, settledAt: 2 }],
    });
    const runtime = await import('./autonomyRuntime');
    await runtime.reconcilePendingAutonomyRuntime();
    expect(mocks.consolidateContext).toHaveBeenCalledWith({ roomId: 'room-a' }, expect.any(Object));
  });
});
