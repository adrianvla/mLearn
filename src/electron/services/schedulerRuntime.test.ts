import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { createTempDir, type TempDir } from '../../../test/helpers/tempDir';
import type { Participant, Room } from '../../shared/world';

const powerMonitorOn = vi.fn();
const powerMonitorRemoveListener = vi.fn();

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/tmp/test'), isPackaged: false },
  Notification: { isSupported: vi.fn(() => false) },
  powerMonitor: { on: powerMonitorOn, removeListener: powerMonitorRemoveListener },
}));

vi.mock('./worldIpc', () => ({ openRoomAt: vi.fn() }));

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
    powerMonitorOn.mockClear();
    powerMonitorRemoveListener.mockClear();
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
});
