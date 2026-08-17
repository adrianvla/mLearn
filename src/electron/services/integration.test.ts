import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { createTempDir } from '../../../test/helpers/tempDir';
import type { TempDir } from '../../../test/helpers/tempDir';
import type { IntegrateThreadInput, Participant } from '../../shared/world';

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

describe('world integration', () => {
  beforeEach(async () => {
    tempDir = createTempDir();
    vi.resetModules();
    world = await import('./worldIpc');
    journal = await import('./journalService');
  });

  afterEach(() => tempDir.cleanup());

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
    const roomId = 'room-integration';
    const threadId = 'thread-integration';
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
    await journal.appendEvent(roomId, {
      roomId,
      scope: { kind: 'thread', threadId },
      type: 'message.user',
      actorId: 'user',
      witnesses: ['user'],
      payload: { text: 'thread source' },
    });
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
});
