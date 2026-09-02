import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { createTempDir } from '../../../test/helpers/tempDir';
import type { TempDir } from '../../../test/helpers/tempDir';
import type { Room, Thread } from '../../shared/world';
import { IPC_CHANNELS } from '../../shared/constants';

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/tmp/test'),
    isPackaged: false,
  },
  ipcMain: {
    handle: vi.fn(),
  },
}));

let tempDir: TempDir;

vi.mock('../utils/platform', () => ({
  getUserDataPath: vi.fn(() => tempDir?.tmpDir ?? '/tmp/test'),
}));

vi.mock('./windowManager', () => ({
  openManagedChildWindow: vi.fn(),
}));

const mockConsolidateRoom = vi.fn();
vi.mock('./dreamerRuntime', () => ({ consolidateRoom: mockConsolidateRoom }));

const mockLoadSettings = vi.fn();
vi.mock('./settings', () => ({ loadSettings: mockLoadSettings }));

let mod: typeof import('./worldIpc');
let journal: typeof import('./journalService');

function seedWorld(rooms: Room[], threads: Thread[] = []): void {
  const filePath = path.join(tempDir.tmpDir, 'world.json');
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify({ rooms, threads, participants: [] }, null, 2), 'utf-8');
}

describe('worldIpc', () => {
  const room = (id: string, participantIds: string[]): Room => ({
    id,
    title: 'Test Room',
    participantIds,
    createdAt: 1,
  });

  beforeEach(async () => {
    tempDir = createTempDir();
    mockConsolidateRoom.mockReset();
    mockLoadSettings.mockReset();
    vi.resetModules();
    mod = await import('./worldIpc');
    journal = await import('./journalService');
  });

  afterEach(() => {
    tempDir.cleanup();
  });

  it('getWorldState returns the persisted snapshot', async () => {
    seedWorld([room('r1', ['p1'])]);
    const state = await mod.getWorldState();
    expect(state.rooms).toHaveLength(1);
    expect(state.rooms[0].id).toBe('r1');
    expect(state.rooms[0].participantIds).toEqual(['p1']);
  });

  it('membership add appends a membership event and persists the updated room', async () => {
    seedWorld([room('r1', ['p1'])]);
    const result = await mod.applyMembership('r1', 'p2', 'add');

    expect(result.event).not.toBeNull();
    expect(result.event!.type).toBe('membership');
    expect(result.event!.actorId).toBe('harness');
    expect(result.event!.scope).toEqual({ kind: 'sea' });
    expect(result.event!.payload).toEqual({ participantId: 'p2', action: 'added' });
    expect(result.event!.witnesses).toEqual(['p1', 'p2']);
    expect(result.room.participantIds).toEqual(['p1', 'p2']);

    const state = await mod.getWorldState();
    expect(state.rooms[0].participantIds).toEqual(['p1', 'p2']);

    const { events } = await journal.subscribeRoom('r1', 10);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('membership');
    expect(events[0].payload).toEqual({ participantId: 'p2', action: 'added' });
  });

  it('membership add when already present is a no-op (event null, room untouched)', async () => {
    seedWorld([room('r1', ['p1'])]);
    const result = await mod.applyMembership('r1', 'p1', 'add');

    expect(result.event).toBeNull();
    expect(result.room.participantIds).toEqual(['p1']);

    const { events } = await journal.subscribeRoom('r1', 10);
    expect(events).toHaveLength(0);
  });

  it('membership remove removes the participant and journals with post-change witnesses', async () => {
    seedWorld([room('r1', ['p1', 'p2'])]);
    const result = await mod.applyMembership('r1', 'p2', 'remove');

    expect(result.event).not.toBeNull();
    expect(result.event!.payload).toEqual({ participantId: 'p2', action: 'removed' });
    expect(result.event!.witnesses).toEqual(['p1']);
    expect(result.room.participantIds).toEqual(['p1']);

    const state = await mod.getWorldState();
    expect(state.rooms[0].participantIds).toEqual(['p1']);
  });

  it('membership on a missing room throws', async () => {
    seedWorld([]);
    await expect(mod.applyMembership('nope', 'p1', 'add')).rejects.toThrow();
  });

  it('createThread adds a thread to the room and persists it', async () => {
    seedWorld([room('r1', ['p1'])]);
    const thread = await mod.createThread('r1', 'My Thread');

    expect(thread.id.startsWith('thr_')).toBe(true);
    expect(thread.roomId).toBe('r1');
    expect(thread.title).toBe('My Thread');
    expect(thread.state).toBe('active');

    const state = await mod.getWorldState();
    expect(state.threads).toHaveLength(1);
    expect(state.threads[0].id).toBe(thread.id);
  });

  it('createThread on a missing room throws', async () => {
    seedWorld([]);
    await expect(mod.createThread('nope')).rejects.toThrow();
  });
  it('a completed WORLD_INTEGRATE fires one post-session dreamer consolidation', async () => {
    seedWorld([room('r1', ['p1'])]);
    mod.setupWorldIPC();
    const handle = vi.mocked((await import('electron')).ipcMain.handle);
    const integrate = handle.mock.calls.find((call) => call[0] === IPC_CHANNELS.WORLD_INTEGRATE)?.[1] as
      | (event: unknown, input: { roomId: string; threadId: string; integrationId: string; drafts: never[]; promoteParticipantIds: never[] }) => Promise<unknown>
      | undefined;
    if (!integrate) throw new Error('WORLD_INTEGRATE handler not registered');

    await integrate({}, { roomId: 'r1', threadId: 't1', integrationId: 'int-1', drafts: [], promoteParticipantIds: [] });
    await new Promise((resolve) => setImmediate(resolve));

    expect(mockConsolidateRoom).toHaveBeenCalledTimes(1);
    expect(mockConsolidateRoom).toHaveBeenCalledWith('r1', { getSettings: mockLoadSettings });
  });
});