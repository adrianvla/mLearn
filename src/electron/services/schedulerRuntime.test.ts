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
const mockRunRoomAutonomy = vi.hoisted(() => vi.fn(async () => ({ kind: 'waiting' as const })));
vi.mock('./autonomyRuntime', () => ({ runRoomAutonomy: mockRunRoomAutonomy }));
const mockRunRoomContact = vi.hoisted(() => vi.fn(async () => ({ kind: 'waiting' as const })));
const mockReconcileRoomContactDelivery = vi.hoisted(() => vi.fn(async () => ({
  attempted: [], unavailable: [], expired: [], suppressed: [],
})));
vi.mock('./contactRuntime', () => ({
  runRoomContact: mockRunRoomContact,
  reconcileRoomContactDelivery: mockReconcileRoomContactDelivery,
}));

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

describe('schedulerRuntime', () => {
  let runtime: typeof import('./schedulerRuntime');

  beforeEach(async () => {
    tempDir = createTempDir('mlearn-scheduler-runtime-test-');
    vi.resetModules();
    mockLoadSettings.mockReset();
    mockLoadSettings.mockReturnValue(schedulerSettings(true));
    powerMonitorOn.mockClear();
    powerMonitorRemoveListener.mockClear();
    mockConsolidateContext.mockClear();
    mockRunRoomAutonomy.mockClear();
    mockRunRoomContact.mockClear();
    mockReconcileRoomContactDelivery.mockClear();
    runtime = await import('./schedulerRuntime');
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

  afterEach(async () => {
    runtime?.stopScheduler();
    await flush();
    tempDir.cleanup();
  });

  it('reconciles durable contact delivery before bounded initiative on startup and resume', async () => {
    runtime.startScheduler();
    await vi.waitFor(() => expect(mockRunRoomContact).toHaveBeenCalledWith('room-1'));
    expect(mockReconcileRoomContactDelivery).toHaveBeenCalledWith('room-1');
    expect(mockReconcileRoomContactDelivery.mock.invocationCallOrder[0])
      .toBeLessThan(mockRunRoomContact.mock.invocationCallOrder[0]);

    expect(powerMonitorOn).toHaveBeenCalledWith('suspend', expect.any(Function));
    expect(powerMonitorOn).toHaveBeenCalledWith('resume', expect.any(Function));
    const resume = powerMonitorOn.mock.calls.find(([event]) => event === 'resume')?.[1] as (() => void);
    resume();
    await vi.waitFor(() => expect(mockRunRoomContact).toHaveBeenCalledTimes(2));
    runtime.stopScheduler();
    expect(powerMonitorRemoveListener).toHaveBeenCalledWith('suspend', expect.any(Function));
    expect(powerMonitorRemoveListener).toHaveBeenCalledWith('resume', expect.any(Function));
  });

  it('runs no proactive initiative and no maintenance while Living World consent is off', async () => {
    mockLoadSettings.mockReturnValue(schedulerSettings(false));
    mockRunRoomAutonomy.mockClear();
    runtime.startScheduler();
    await flush();
    // Force every reconcile path (startup, interval, suspend, resume) to run
    // against the disabled boundary.
    const handlers = powerMonitorOn.mock.calls.filter(([event]) => event === 'suspend' || event === 'resume');
    for (const [, handler] of handlers) (handler as () => void)();
    await flush();

    expect(mockRunRoomContact).not.toHaveBeenCalled();
    expect(mockReconcileRoomContactDelivery).not.toHaveBeenCalled();
    expect(mockConsolidateContext).not.toHaveBeenCalled();
    expect(mockRunRoomAutonomy).not.toHaveBeenCalled();
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

  it('bounds autonomous Room candidates per reconcile and advances fairly', async () => {
    const rooms = Array.from({ length: runtime.MAX_AUTONOMY_JOBS_PER_RECONCILE + 2 }, (_, index): Room => ({
      id: `room-${index}`, title: `Room ${index}`, participantIds: [], createdAt: index,
    }));
    fs.writeFileSync(path.join(tempDir.tmpDir, 'world.json'), JSON.stringify({ rooms, threads: [], participants: [] }), 'utf-8');

    runtime.startScheduler();
    await vi.waitFor(() => expect(mockRunRoomAutonomy).toHaveBeenCalledTimes(runtime.MAX_AUTONOMY_JOBS_PER_RECONCILE));
    const resume = powerMonitorOn.mock.calls.find(([event]) => event === 'resume')?.[1] as (() => void);
    resume();
    await vi.waitFor(() => expect(new Set(mockRunRoomAutonomy.mock.calls.map(([roomId]) => roomId))).toHaveLength(rooms.length));
  });

  it('bounds contact inference to one Room per reconcile and advances fairly', async () => {
    const rooms = Array.from({ length: runtime.MAX_CONTACT_ROOMS_PER_RECONCILE + 2 }, (_, index): Room => ({
      id: `room-${index}`, title: `Room ${index}`, participantIds: [], createdAt: index,
    }));
    fs.writeFileSync(path.join(tempDir.tmpDir, 'world.json'), JSON.stringify({ rooms, threads: [], participants: [] }), 'utf-8');

    runtime.startScheduler();
    await vi.waitFor(() => expect(mockRunRoomContact).toHaveBeenCalledTimes(runtime.MAX_CONTACT_ROOMS_PER_RECONCILE));
    expect(mockReconcileRoomContactDelivery).toHaveBeenCalledTimes(2);
    const resume = powerMonitorOn.mock.calls.find(([event]) => event === 'resume')?.[1] as (() => void);
    resume();
    await vi.waitFor(() => expect(new Set(mockRunRoomContact.mock.calls.map(([roomId]) => roomId))).toHaveLength(2));
  });

  it('does not reconcile a second external delivery after recovery already attempted one', async () => {
    mockReconcileRoomContactDelivery.mockResolvedValueOnce({
      attempted: ['existing-contact'], unavailable: [], expired: [], suppressed: [],
    });

    runtime.startScheduler();

    await vi.waitFor(() => expect(mockRunRoomContact).toHaveBeenCalledWith('room-1'));
    expect(mockReconcileRoomContactDelivery).toHaveBeenCalledTimes(1);
  });
});
