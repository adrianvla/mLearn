import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { createTempDir, type TempDir } from '../../../test/helpers/tempDir';
import type { Participant, Room } from '../../shared/world';
import { DEFAULT_SETTINGS, type Settings } from '../../shared/types';

const powerMonitorOn = vi.fn();
const powerMonitorRemoveListener = vi.fn();

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/tmp/test'), isPackaged: false },
  Notification: { isSupported: vi.fn(() => false) },
  powerMonitor: { on: powerMonitorOn, removeListener: powerMonitorRemoveListener },
}));

vi.mock('./worldIpc', () => ({ openRoomAt: vi.fn() }));
const mockConsolidateContext = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock('./dreamerRuntime', () => ({ consolidateContext: mockConsolidateContext }));

// Living World consent default for the existing proactive-scheduler coverage;
// individual tests may flip it to verify the Threads-only boundary.
const mockLoadSettings = vi.hoisted(() => vi.fn());
vi.mock('./settings', () => ({ loadSettings: mockLoadSettings }));
const schedulerSettings = (livingWorldEnabled: boolean): Settings => ({ ...DEFAULT_SETTINGS, livingWorldEnabled });

let tempDir: TempDir;

vi.mock('../utils/platform', () => ({
  getUserDataPath: vi.fn(() => tempDir?.tmpDir ?? '/tmp/test'),
}));

async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) await new Promise((resolve) => setImmediate(resolve));
}

async function untilFulfilled(count: () => Promise<number>, expected: number, maxRounds = 500): Promise<number> {
  for (let i = 0; i < maxRounds; i++) {
    const value = await count();
    if (value === expected) return value;
    await new Promise((resolve) => setImmediate(resolve));
  }
  return await count();
}

describe('schedulerRuntime', () => {
  let runtime: typeof import('./schedulerRuntime');
  let journal: typeof import('./journalService');

  beforeEach(async () => {
    tempDir = createTempDir('mlearn-scheduler-runtime-test-');
    vi.resetModules();
    mockLoadSettings.mockReset();
    mockLoadSettings.mockReturnValue(schedulerSettings(true));
    powerMonitorOn.mockClear();
    powerMonitorRemoveListener.mockClear();
    mockConsolidateContext.mockClear();
    runtime = await import('./schedulerRuntime');
    journal = await import('./journalService');
    const room: Room = { id: 'room-1', title: 'Test room', participantIds: ['participant-1'], createdAt: 0 };
    const participant: Participant = {
      id: 'participant-1',
      displayName: 'Test participant',
      kind: 'persistent',
      personaText: '',
      setupComplete: true,
    };
    fs.writeFileSync(
      path.join(tempDir.tmpDir, 'world.json'),
      JSON.stringify({ rooms: [room], threads: [], participants: [participant] }, null, 2),
      'utf-8',
    );
  });

  afterEach(() => {
    runtime?.stopScheduler();
    tempDir.cleanup();
  });

  it('reconciles on startup and on powerMonitor suspend/resume without duplicates', async () => {
    await journal.appendEvent('room-1', {
      roomId: 'room-1',
      scope: { kind: 'sea' },
      type: 'schedule',
      actorId: 'harness',
      witnesses: ['user'],
      payload: { candidateId: 'wired', kind: 'message', participantId: 'participant-1', fireAt: Date.now() - 1000, text: 'Hello' },
    });

    runtime.startScheduler();
    await flush();

    const countFulfilled = async (): Promise<number> =>
      (await journal.readSeaProjection('room-1')).filter(
        (event) => event.type === 'proactive_fulfilled' && (event.payload as { candidateId: string }).candidateId === 'wired',
      ).length;
    expect(await untilFulfilled(countFulfilled, 1)).toBe(1);

    expect(powerMonitorOn).toHaveBeenCalledWith('suspend', expect.any(Function));
    expect(powerMonitorOn).toHaveBeenCalledWith('resume', expect.any(Function));
    const handlers = powerMonitorOn.mock.calls.filter(([event]) => event === 'suspend' || event === 'resume');
    for (const [, handler] of handlers) {
      (handler as () => void)();
    }
    await flush();

    expect(await countFulfilled()).toBe(1);
    runtime.stopScheduler();
    expect(powerMonitorRemoveListener).toHaveBeenCalledWith('suspend', expect.any(Function));
    expect(powerMonitorRemoveListener).toHaveBeenCalledWith('resume', expect.any(Function));
  });

  it('runs no proactive initiative and no maintenance while Living World consent is off', async () => {
    mockLoadSettings.mockReturnValue(schedulerSettings(false));
    await journal.appendEvent('room-1', {
      roomId: 'room-1',
      scope: { kind: 'sea' },
      type: 'schedule',
      actorId: 'harness',
      witnesses: ['user'],
      payload: { candidateId: 'wired', kind: 'message', participantId: 'participant-1', fireAt: Date.now() - 1000, text: 'Hello' },
    });

    runtime.startScheduler();
    await flush();
    // Force every reconcile path (startup, interval, suspend, resume) to run
    // against the disabled boundary.
    const handlers = powerMonitorOn.mock.calls.filter(([event]) => event === 'suspend' || event === 'resume');
    for (const [, handler] of handlers) (handler as () => void)();
    await flush();

    const events = await journal.readSeaProjection('room-1');
    expect(events.some((event) => event.type === 'proactive_fulfilled')).toBe(false);
    // No autonomous-world writes of any kind happened on the consented paths.
    expect(events.filter((event) => event.type === 'consolidation')).toHaveLength(0);
    runtime.stopScheduler();
  });

  it('bounds Room maintenance candidates per reconcile and advances fairly', async () => {
    const rooms = Array.from({ length: runtime.MAX_SCHEDULER_MAINTENANCE_ROOMS + 2 }, (_, index): Room => ({
      id: `room-${index}`, title: `Room ${index}`, participantIds: [], createdAt: index,
    }));
    fs.writeFileSync(path.join(tempDir.tmpDir, 'world.json'), JSON.stringify({ rooms, threads: [], participants: [] }), 'utf-8');

    runtime.startScheduler();
    await vi.waitFor(() => expect(mockConsolidateContext).toHaveBeenCalledTimes(runtime.MAX_SCHEDULER_MAINTENANCE_ROOMS));
    const resume = powerMonitorOn.mock.calls.find(([event]) => event === 'resume')?.[1] as (() => void);
    resume();
    await vi.waitFor(() => expect(new Set(mockConsolidateContext.mock.calls.map(([target]) => target.roomId))).toHaveLength(rooms.length));
  });
});
