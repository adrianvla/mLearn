import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { createTempDir, type TempDir } from '../../../test/helpers/tempDir';
import { DEFAULT_SETTINGS } from '../../shared/types';
import type { CallPayload, Participant, Room } from '../../shared/world';

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/tmp/test'), isPackaged: false },
}));

let tempDir: TempDir;

vi.mock('../utils/platform', () => ({
  getUserDataPath: vi.fn(() => tempDir?.tmpDir ?? '/tmp/test'),
}));

let scheduler: typeof import('./schedulerService');
let journal: typeof import('./journalService');

const room = (id = 'room-1'): Room => ({
  id,
  title: 'Test room',
  participantIds: ['participant-1'],
  createdAt: 0,
});

const participant: Participant = {
  id: 'participant-1',
  displayName: 'Test participant',
  kind: 'persistent',
  personaText: '',
  setupComplete: true,
};

function seedWorld(rooms: Room[] = [room()], participants: Participant[] = [participant]): void {
  fs.writeFileSync(
    path.join(tempDir.tmpDir, 'world.json'),
    JSON.stringify({ rooms, threads: [], participants }, null, 2),
    'utf-8'
  );
}

async function schedule(roomId: string, candidateId: string, fireAt: number, kind: 'message' | 'call' = 'message', text?: string): Promise<void> {
  await journal.appendEvent(roomId, {
    roomId,
    scope: { kind: 'sea' },
    type: 'schedule',
    actorId: 'harness',
    witnesses: [],
    payload: { candidateId, kind, participantId: participant.id, fireAt, text },
  });
}

describe('schedulerService', () => {
  beforeEach(async () => {
    tempDir = createTempDir('mlearn-scheduler-test-');
    vi.resetModules();
    scheduler = await import('./schedulerService');
    journal = await import('./journalService');
    seedWorld();
  });

  afterEach(() => {
    tempDir.cleanup();
  });

  it('delivers eligible past schedules once and drops stale schedules', async () => {
    const now = 1_000_000;
    await schedule('room-1', 'deliver-once', now - 1, 'message', 'Hello');
    await schedule('room-1', 'stale', now - 24 * 60 * 60 * 1000 - 1, 'message', 'Old');
    const notify = vi.fn();
    const service = scheduler.createSchedulerService({ now: () => now, notify, getSettings: () => DEFAULT_SETTINGS });

    expect(await service.reconcile('room-1')).toEqual({ fired: ['deliver-once'], suppressed: [], dropped: ['stale'] });
    await service.reconcile('room-1');

    const events = await journal.readSeaProjection('room-1');
    expect(events.filter((event) => event.type === 'proactive_fulfilled' && (event.payload as { candidateId: string }).candidateId === 'deliver-once')).toHaveLength(1);
    expect(events.filter((event) => event.type === 'message.character')).toHaveLength(1);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('journals quiet-hour messages without notifying, then reevaluates fresh schedules on expiry', async () => {
    const quietNow = new Date(2026, 0, 1, 23).getTime();
    const expiry = new Date(2026, 0, 2, 9).getTime();
    let now = quietNow;
    const settings = {
      ...DEFAULT_SETTINGS,
      proactiveQuietHoursEnabled: true,
      proactiveQuietHoursStart: '22:00',
      proactiveQuietHoursEnd: '08:00',
    };
    await schedule('room-1', 'quiet', quietNow, 'message', 'Quiet hello');
    await schedule('room-1', 'fresh-after-expiry', expiry - 1, 'message', 'Morning hello');
    const notify = vi.fn();
    const service = scheduler.createSchedulerService({ now: () => now, notify, getSettings: () => settings });

    expect(await service.reconcile('room-1')).toEqual({ fired: [], suppressed: ['quiet'], dropped: [] });
    expect(notify).not.toHaveBeenCalled();
    expect((JSON.parse(fs.readFileSync(path.join(tempDir.tmpDir, 'world.json'), 'utf-8')) as { rooms: Room[] }).rooms[0].unreadCount).toBe(1);

    await schedule('room-1', 'stale-after-expiry', expiry - 24 * 60 * 60 * 1000 - 1, 'message', 'Old hello');
    now = expiry;
    expect(await service.reconcileOnQuietHoursExpiry('room-1')).toEqual({ fired: ['fresh-after-expiry'], suppressed: [], dropped: ['quiet', 'stale-after-expiry'] });
    expect(notify).toHaveBeenCalledWith('New message', 'Morning hello', 'room-1');
  });

  it('journals call lifecycle transitions and opens accepted calls', async () => {
    const now = 1_000_000;
    await schedule('room-1', 'call', now - 1, 'call');
    const notify = vi.fn();
    const openRoomEvent = vi.fn();
    const service = scheduler.createSchedulerService({ now: () => now, notify, getSettings: () => DEFAULT_SETTINGS, openRoomEvent });

    await service.reconcile('room-1');
    const initiated = (await journal.readSeaProjection('room-1')).find((event) => event.type === 'call_initiated');
    expect(initiated).toBeDefined();
    expect(notify).toHaveBeenCalledWith('Incoming call', participant.id, 'room-1');

    const callId = (initiated!.payload as CallPayload).callId;
    await service.acceptCall('room-1', callId);
    await service.declineCall('room-1', callId);
    await service.missCall('room-1', callId);
    await service.endCall('room-1', callId);

    const eventTypes = (await journal.readSeaProjection('room-1')).map((event) => event.type);
    expect(eventTypes).toEqual(['schedule', 'call_initiated', 'call_accepted', 'call_declined', 'call_missed', 'call_ended']);
    expect(openRoomEvent).toHaveBeenCalledWith('room-1', callId);
    expect((JSON.parse(fs.readFileSync(path.join(tempDir.tmpDir, 'world.json'), 'utf-8')) as { rooms: Room[] }).rooms[0].unreadCount).toBe(1);
  });
});
