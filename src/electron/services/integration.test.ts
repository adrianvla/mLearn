import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { createTempDir } from '../../../test/helpers/tempDir';
import type { TempDir } from '../../../test/helpers/tempDir';
import type { IntegrateThreadInput, Participant, Thread } from '../../shared/world';

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/tmp/test'), isPackaged: false },
  ipcMain: { handle: vi.fn() },
}));

let tempDir: TempDir;
vi.mock('../utils/platform', () => ({ getUserDataPath: vi.fn(() => tempDir?.tmpDir ?? '/tmp/test') }));
vi.mock('./windowManager', () => ({ openManagedChildWindow: vi.fn() }));

let world: typeof import('./worldIpc');
let journal: typeof import('./journalService');

function seedParticipant(participant: Participant): void {
  fs.writeFileSync(
    path.join(tempDir.tmpDir, 'world.json'),
    JSON.stringify({ rooms: [], threads: [], participants: [participant] }),
    'utf-8'
  );
}

function seedThread(thread: Thread): void {
  const filePath = path.join(tempDir.tmpDir, 'world.json');
  const current = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as { threads: Thread[] };
  current.threads.push(thread);
  fs.writeFileSync(filePath, JSON.stringify(current), 'utf-8');
}

const newThread = (roomId: string): Thread => ({
  id: `thr_${Math.random().toString(36).slice(2, 10)}`, roomId, state: 'active', createdAt: Date.now(),
});

describe('world integration', () => {
  beforeEach(async () => {
    tempDir = createTempDir();
    vi.resetModules();
    world = await import('./worldIpc');
    journal = await import('./journalService');
  });

  afterEach(() => tempDir.cleanup());

  it('rejects a batch that grants an absent person a private source, before admitting any draft', async () => {
    const room = await world.createRoom('Private practice');
    const thread = newThread(room.id); seedThread(thread);
    const source = await journal.appendEvent(room.id, {
      roomId: room.id, scope: { kind: 'thread', threadId: thread.id },
      type: 'message.user', actorId: 'user', witnesses: ['user'],
      payload: { text: 'Private source' },
    });
    await expect(world.integrateThread({
      roomId: room.id, threadId: thread.id, integrationId: 'private-admission',
      promoteParticipantIds: [],
      drafts: [
        { actorId: 'user', witnesses: ['user'], payload: {
          ownerId: 'user', kind: 'fact', text: 'Selected fact', sourceEventIds: [source.id],
        } },
        { actorId: 'user', witnesses: ['user', 'absent'], payload: {
          ownerId: 'absent', kind: 'belief', text: 'Leaked fact', sourceEventIds: [source.id],
        } },
      ],
    })).rejects.toThrow(/witness/);
    expect(await journal.readSeaProjection(room.id)).toEqual([]);
    expect(await journal.readThread(room.id, thread.id)).toEqual([source]);
  });

  it('keeps remember-this Sea memory after its source thread is erased', async () => {
    const roomId = 'room-memory';
    const threadId = 'thread-memory';
    const source = await journal.appendEvent(roomId, {
      roomId,
      scope: { kind: 'thread', threadId },
      type: 'message.user',
      actorId: 'user',
      witnesses: ['user'],
      payload: { text: 'source' },
    });
    const remembered = await world.rememberThis({
      roomId,
      threadId,
      sourceEventId: source.id,
      ownerId: 'user',
      kind: 'fact',
      text: 'durable fact',
    });

    await journal.eraseThread(roomId, threadId);
    expect(await journal.readThread(roomId, threadId)).toEqual([]);
    expect(await journal.readSeaProjection(roomId)).toContainEqual(remembered);
    expect(remembered.provenance).toEqual({ sourceThreadEventIds: [source.id] });
  });

  it('is idempotent and resumes a partially persisted integration without duplicates', async () => {
    const roomId = (await world.createRoom('Integration')).id;
    const thread = newThread(roomId); seedThread(thread); const threadId = thread.id;
    const input: IntegrateThreadInput = {
      roomId,
      threadId,
      integrationId: 'integration-1',
      drafts: [
        { actorId: 'user', witnesses: ['user'], payload: { ownerId: 'user', kind: 'fact', text: 'one' } },
        { actorId: 'user', witnesses: ['user'], payload: { ownerId: 'user', kind: 'fact', text: 'two' } },
      ],
      promoteParticipantIds: [],
    };
    const source = await journal.appendEvent(roomId, {
      roomId,
      scope: { kind: 'thread', threadId },
      type: 'message.user',
      actorId: 'user',
      witnesses: ['user'],
      payload: { text: 'thread source' },
    });
    for (const draft of input.drafts) draft.payload.sourceEventIds = [source.id];
    // Simulate a process kill after the first draft was committed but before the batch marker.
    await journal.appendEvent(roomId, {
      roomId,
      scope: { kind: 'sea' },
      type: 'memory.belief',
      actorId: input.drafts[0].actorId,
      witnesses: input.drafts[0].witnesses,
      payload: input.drafts[0].payload,
      provenance: { integrationId: input.integrationId },
    });

    const resumed = await world.integrateThread(input);
    const repeated = await world.integrateThread(input);
    const integrated = (await journal.readSeaProjection(roomId)).filter(
      (event) => event.provenance?.integrationId === input.integrationId
    );
    expect(resumed.alreadyApplied).toBe(false);
    expect(repeated).toEqual({ appended: integrated, alreadyApplied: true });
    expect(integrated).toHaveLength(3);
    expect(integrated.filter((event) => event.type === 'memory.belief')).toHaveLength(2);
    expect(integrated.filter((event) => event.type === 'integration')).toHaveLength(1);
  });

  it('promotes a temporary participant without changing its id', async () => {
    seedParticipant({ id: 'temp-1', displayName: 'Temp', kind: 'temporary', personaText: 'persona', setupComplete: true });
    await expect(world.promoteParticipant('temp-1')).resolves.toMatchObject({ id: 'temp-1', kind: 'persistent' });
    await expect(world.getWorldState()).resolves.toMatchObject({ participants: [{ id: 'temp-1', kind: 'persistent' }] });
  });

  it('rejects a promotion outside the selected thread before writing memories', async () => {
    const outsider = await world.createParticipant({ displayName: 'Elsewhere', kind: 'temporary', personaText: 'Local elsewhere' });
    const room = await world.createRoom('Integration');
    const thread = newThread(room.id); seedThread(thread);
    const source = await journal.appendEvent(room.id, {
      roomId: room.id, scope: { kind: 'thread', threadId: thread.id },
      type: 'message.user', actorId: 'user', witnesses: ['user'], payload: { text: 'Source' },
    });
    const input: IntegrateThreadInput = {
      roomId: room.id, threadId: thread.id, integrationId: 'invalid-promotion',
      promoteParticipantIds: [outsider.id],
      drafts: [{ actorId: 'user', witnesses: ['user'], payload: {
        ownerId: 'user', kind: 'fact', text: 'Fact', sourceEventIds: [source.id],
      } }],
    };
    await expect(world.integrateThread(input)).rejects.toThrow(/participant/);
    expect(await journal.readSeaProjection(room.id)).toEqual([]);
    expect((await world.getWorldState()).participants.find(p => p.id === outsider.id)?.kind).toBe('temporary');
  });

  it('admits one selection once when two windows retry concurrently', async () => {
    const room = await world.createRoom('Integration');
    const thread = newThread(room.id); seedThread(thread);
    const source = await journal.appendEvent(room.id, {
      roomId: room.id, scope: { kind: 'thread', threadId: thread.id },
      type: 'message.user', actorId: 'user', witnesses: ['user'], payload: { text: 'Selected source' },
    });
    const input: IntegrateThreadInput = {
      roomId: room.id, threadId: thread.id, integrationId: 'concurrent-admission', promoteParticipantIds: [],
      drafts: [{ actorId: 'user', witnesses: ['user'], payload: {
        ownerId: 'user', kind: 'fact', text: 'Selected fact', sourceEventIds: [source.id],
      } }],
    };
    const results = await Promise.all([world.integrateThread(input), world.integrateThread(input)]);
    expect(results.map(result => result.alreadyApplied).sort()).toEqual([false, true]);
    const events = await journal.readSeaProjection(room.id);
    expect(events.map(event => event.type)).toEqual(['memory.belief', 'integration']);
    expect(events[0].provenance?.sourceThreadEventIds).toEqual([source.id]);
    await expect(world.integrateThread({ ...input, drafts: [{
      ...input.drafts[0], payload: { ...input.drafts[0].payload, text: 'Changed selection' },
    }] })).rejects.toThrow(/conflict/);
    await journal.eraseThread(room.id, thread.id);
    expect(await world.integrateThread(input)).toEqual({ appended: events, alreadyApplied: true });
  });
});
