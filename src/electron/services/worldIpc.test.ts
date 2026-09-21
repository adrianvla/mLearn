import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { createTempDir } from '../../../test/helpers/tempDir';
import type { TempDir } from '../../../test/helpers/tempDir';
import type { Participant, Room, Thread } from '../../shared/world';
import { IPC_CHANNELS } from '../../shared/constants';
import { compileContext } from '../../shared/contextCompiler';

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

let mod: typeof import('./worldIpc');
let journal: typeof import('./journalService');
vi.mock('./settings', () => ({ loadSettings: mockLoadSettings }));

function seedWorld(rooms: Room[], threads: Thread[] = [], participants: Participant[] = []): void {
  const filePath = path.join(tempDir.tmpDir, 'world.json');
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify({ rooms, threads, participants }, null, 2), 'utf-8');
}

const thread = (id: string, roomId: string): Thread => ({ id, roomId, state: 'active', createdAt: 1 });
const participant = (id: string, displayName: string): Participant => ({
  id, displayName, kind: 'persistent', personaText: '', setupComplete: true,
});


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
    // Persistent-entry gates read consent synchronously; existing coverage
    // runs with Living World enabled, off-cases override explicitly.
    mockLoadSettings.mockReturnValue({ livingWorldEnabled: true });
    vi.resetModules();
    mod = await import('./worldIpc');
    journal = await import('./journalService');
  });

  afterEach(() => {
    tempDir.cleanup();
  });

  it('serializes simultaneous world edits without losing rooms', async () => {
    seedWorld([]);
    await Promise.all([mod.createRoom('First'), mod.createRoom('Second')]);
    expect((await mod.getWorldState()).rooms.map(room => room.title).sort()).toEqual(['First', 'Second']);
  });

  it('creates and resumes independent practice with a pinned cast and no permanent topology', async () => {
    const person = await mod.createParticipant({ displayName: 'Sam', kind: 'persistent', personaText: 'Keeps a garden' });
    const original = await mod.getWorldState();
    const request = { operationId: 'practice-1', participantIds: [person.id], intent: 'Plan the garden' };
    const [first, retry] = await Promise.all([mod.createSandbox(request), mod.createSandbox(request)]);
    expect(retry.id).toBe(first.id);
    expect(first.roomId).toBeUndefined();
    expect(first.sandbox?.bindings).toEqual([{ originId: person.id, baseline: person }]);
    await mod.updateParticipant({ ...person, personaText: 'A later baseline' });
    const loaded = await mod.getWorldState();
    expect(loaded.rooms).toEqual(original.rooms);
    expect(loaded.participants).toHaveLength(1);
    expect(loaded.threads).toHaveLength(1);
    expect(loaded.threads[0].sandbox?.bindings[0].baseline.personaText).toBe('Keeps a garden');
    await mod.updateParticipant({ ...person, personaText: 'Practice override' }, first.id);
    const edited = await mod.getWorldState();
    expect(edited.participants[0].personaText).toBe('A later baseline');
    expect(edited.threads[0].sandbox?.bindings[0].localOverride?.personaText).toBe('Practice override');
    await expect(mod.updateThread({ ...edited.threads[0], sandbox: undefined })).rejects.toThrow(/ownership/);
    await expect(journal.appendEvent(first.id, { roomId: first.id, scope: { kind: 'sea' },
      type: 'memory.belief', actorId: person.id, witnesses: [person.id], payload: { text: 'Write-through' },
    })).rejects.toThrow(/sandbox/);
    await expect(journal.appendEvent(first.id, { roomId: first.id, scope: { kind: 'thread', threadId: first.id },
      type: 'message.character', actorId: 'outsider', witnesses: [person.id], payload: { text: 'Not in cast' },
    })).rejects.toThrow(/bound/);
    await expect(mod.createSandbox({ ...request, intent: 'Another request' })).rejects.toThrow(/conflict/);
  });

  it('compiles the pinned sandbox person and local memories without importing later world changes', async () => {
    const person = await mod.createParticipant({ displayName: 'Sam', kind: 'persistent', personaText: 'Original persona' });
    const room = await mod.createRoom('World');
    const before = await journal.appendEvent(room.id, { roomId: room.id, scope: { kind: 'sea' },
      actorId: 'harness', witnesses: [person.id], type: 'memory.belief',
      payload: { ownerId: person.id, kind: 'fact', text: 'Original memory' } });
    const thread = await mod.createSandbox({ operationId: 'pinned', participantIds: [person.id] });
    const after = await journal.appendEvent(room.id, { ...before, payload: {
      ownerId: person.id, kind: 'fact', text: 'Future memory',
    } });
    const local = await journal.appendEvent(thread.id, { roomId: thread.id, scope: { kind: 'thread', threadId: thread.id },
      actorId: 'harness', witnesses: [person.id], type: 'memory.belief',
      payload: { ownerId: person.id, kind: 'fact', text: 'Sandbox memory' } });
    const currentPerson = { ...person, personaText: 'Changed world persona' };
    const context = compileContext({ participant: currentPerson, participants: [currentPerson], thread,
      seaEvents: [before, after], threadEvents: [local] });
    expect(context.persona.text).toBe('Original persona');
    expect(context.memories.map(memory => memory.text)).toEqual(['Original memory', 'Sandbox memory']);
    const persistent = compileContext({ participant: currentPerson, participants: [currentPerson], seaEvents: [before, after] });
    expect(persistent.memories.map(memory => memory.text)).toEqual(['Original memory', 'Future memory']);
  });

  it('explicit memory promotion preserves source witnesses and rejects an unwitnessed owner', async () => {
    const t1 = thread('t1', 'r1'); seedWorld([room('r1', ['p1'])], [t1]);
    const source = await journal.appendEvent('r1', {
      roomId: 'r1', scope: { kind: 'thread', threadId: t1.id },
      type: 'message.user', actorId: 'user', witnesses: ['user', 'p1'],
      payload: { text: 'Meet tomorrow.' },
    });
    const input = {
      roomId: 'r1', threadId: t1.id, sourceEventId: source.id,
      ownerId: 'p1', kind: 'belief' as const, text: 'We plan to meet tomorrow.',
    };
    await expect(mod.rememberThis({ ...input, ownerId: 'absent' })).rejects.toThrow('witnessed');
    expect(await journal.readSeaProjection('r1')).toEqual([]);
    const memory = await mod.rememberThis(input);
    expect(memory.scope).toEqual({ kind: 'sea' });
    expect(memory.witnesses).toEqual(['user', 'p1']);
    expect(memory.provenance?.sourceThreadEventIds).toEqual([source.id]);
    expect(await journal.readThread('r1', t1.id)).toHaveLength(1);
  });

  it('getWorldState returns the persisted snapshot', async () => {
    seedWorld([room('r1', ['p1'])]);
    const state = await mod.getWorldState();
    expect(state.rooms).toHaveLength(1);
    expect(state.rooms[0].id).toBe('r1');
    expect(state.rooms[0].participantIds).toEqual(['p1']);
  });

  it('returns contact lifecycle state without exposing prepared publication drafts', async () => {
    const filePath = path.join(tempDir.tmpDir, 'world.json');
    const person = participant('p1', 'Pat');
    fs.writeFileSync(filePath, JSON.stringify({
      rooms: [room('r1', ['p1'])], threads: [], participants: [person], contacts: [{
        contactId: 'contact-1', operationId: 'contact-1', roomId: 'r1', participantId: 'p1', targetActorId: 'user',
        causeKind: 'open-loop', sourceEventIds: ['cause-1'], sourceHash: 'hash', status: 'proposed', revision: 1,
        history: [{ status: 'proposed', at: 1 }], createdAt: 1, effectiveAt: 1, readyAt: 1, expiresAt: 10,
        deliveryAttempts: 0, participantRevision: 'p', roomRevision: 'r',
        prepared: { expectedDrafts: [{ roomId: 'r1', scope: { kind: 'sea' }, type: 'message.character', actorId: 'p1', witnesses: ['p1', 'user'], payload: { text: 'private draft' } }] },
      }],
    }), 'utf-8');

    const state = await mod.getWorldState();
    expect(state.contacts).toHaveLength(1);
    expect(state.contacts?.[0]).not.toHaveProperty('prepared');
  });

  it('cancels nonterminal contact state when its participant is erased', async () => {
    const filePath = path.join(tempDir.tmpDir, 'world.json');
    const person = participant('p1', 'Pat');
    fs.writeFileSync(filePath, JSON.stringify({
      rooms: [room('r1', ['p1'])], threads: [], participants: [person], contacts: [{
        contactId: 'contact-1', operationId: 'contact-1', roomId: 'r1', participantId: 'p1', targetActorId: 'user',
        causeKind: 'open-loop', sourceEventIds: ['cause-1'], sourceHash: 'hash', status: 'ready', revision: 1,
        history: [{ status: 'ready', at: 1 }], createdAt: 1, effectiveAt: 1, readyAt: 1, expiresAt: Date.now() + 10_000,
        modality: 'message', eventIds: ['message-1'], deliveryAttempts: 0, participantRevision: 'p', roomRevision: 'r',
      }],
    }), 'utf-8');

    await mod.deleteParticipant('p1');
    const state = await mod.getWorldState();
    expect(state.participants).toEqual([]);
    expect(state.rooms[0].participantIds).toEqual([]);
    expect(state.contacts?.[0]).toMatchObject({ status: 'cancelled', reason: 'The contact destination was erased' });
  });

  it('membership add appends a membership event and persists the updated room', async () => {
    seedWorld([room('r1', ['p1'])]);
    const result = await mod.applyMembership('r1', 'p2', 'add');

    expect(result.event).not.toBeNull();
    expect(result.event!.type).toBe('membership');
    expect(result.event!.actorId).toBe('harness');
    expect(result.event!.scope).toEqual({ kind: 'sea' });
    expect(result.event!.payload).toEqual({ participantId: 'p2', action: 'added' });
    expect(result.event!.witnesses).toEqual(['p1', 'p2', 'user']);
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

  it('membership remove removes the participant and preserves witnesses including the departing person', async () => {
    seedWorld([room('r1', ['p1', 'p2'])]);
    const result = await mod.applyMembership('r1', 'p2', 'remove');

    expect(result.event).not.toBeNull();
    expect(result.event!.payload).toEqual({ participantId: 'p2', action: 'removed' });
    expect(result.event!.witnesses).toEqual(['p1', 'p2', 'user']);
    expect(result.room.participantIds).toEqual(['p1']);

    const state = await mod.getWorldState();
    expect(state.rooms[0].participantIds).toEqual(['p1']);
  });

  it('membership on a missing room throws', async () => {
    seedWorld([]);
    await expect(mod.applyMembership('nope', 'p1', 'add')).rejects.toThrow();
  });

  it('createPersistentRoom publishes the room and its roster in one admission and persists it', async () => {
    seedWorld([], [], [participant('p1', 'Pat')]);
    const created = await mod.createPersistentRoom({ operationId: 'persist-1', participantIds: ['p1'] });

    expect(created.id.startsWith('room-')).toBe(true);
    expect(created.participantIds).toEqual(['p1']);
    expect(created.createdByOperation).toBe('persist-1');

    const state = await mod.getWorldState();
    expect(state.rooms).toHaveLength(1);
    expect(state.threads).toEqual([]);
    const events = await journal.readSeaProjection(created.id);
    expect(events.map((event) => event.type)).toEqual(['membership']);
  });

  it('createPersistentRoom retry returns the same room and rejects a changed roster', async () => {
    seedWorld([], [], [participant('p1', 'Pat'), participant('p2', 'Rin')]);
    const first = await mod.createPersistentRoom({ operationId: 'persist-1', participantIds: ['p1'] });
    const retry = await mod.createPersistentRoom({ operationId: 'persist-1', participantIds: ['p1'] });
    expect(retry.id).toBe(first.id);
    await expect(mod.createPersistentRoom({ operationId: 'persist-1', participantIds: ['p1', 'p2'] }))
      .rejects.toThrow(/conflict/);
    const state = await mod.getWorldState();
    expect(state.rooms).toHaveLength(1);
  });

  it('createPersistentRoom on an unavailable or temporary person throws', async () => {
    seedWorld([], [], [{ ...participant('tmp', 'Temp'), kind: 'temporary' as const }]);
    await expect(mod.createPersistentRoom({ operationId: 'persist-2', participantIds: ['nope'] })).rejects.toThrow(/unavailable/);
    await expect(mod.createPersistentRoom({ operationId: 'persist-3', participantIds: ['tmp'] })).rejects.toThrow(/unavailable/);
  });

  it('createPersistentRoom requires selected people', async () => {
    seedWorld();
    await expect(mod.createPersistentRoom({ operationId: 'persist-4', participantIds: [] })).rejects.toThrow(/selected people/);
  });

  it('rejects persistent-world entry with the consent error while Living World is off', async () => {
    seedWorld([room('r1', ['p1'])], [thread('t1', 'r1')], [participant('p1', 'Pat')]);
    mockLoadSettings.mockReturnValue({ livingWorldEnabled: false });

    await expect(mod.createPersistentRoom({ operationId: 'persist-off', participantIds: ['p1'] }))
      .rejects.toThrow(/Living World is disabled/);
    await expect(mod.applyMembership('r1', 'p2', 'add')).rejects.toThrow(/Living World is disabled/);

    const source = await journal.appendEvent('r1', {
      roomId: 'r1', scope: { kind: 'thread', threadId: 't1' },
      type: 'message.user', actorId: 'user', witnesses: ['user', 'p1'],
      payload: { text: 'Meet tomorrow.' },
    });
    await expect(mod.rememberThis({
      roomId: 'r1', threadId: 't1', sourceEventId: source.id,
      ownerId: 'p1', kind: 'belief' as const, text: 'We plan to meet tomorrow.',
    })).rejects.toThrow(/Living World is disabled/);

    // No topology appeared and nothing leaked into the Sea.
    expect((await mod.getWorldState()).rooms).toHaveLength(1);
    expect(await journal.readSeaProjection('r1')).toEqual([]);
  });

  it('cannot promote a temporary person through updateParticipant without consent', async () => {
    const temporary = { ...participant('temp', 'Temp'), kind: 'temporary' as const };
    seedWorld([], [], [temporary]);
    mockLoadSettings.mockReturnValue({ livingWorldEnabled: false });
    await expect(mod.updateParticipant({ ...temporary, kind: 'persistent' })).rejects.toThrow(/Living World is disabled/);
    expect((await mod.getWorldState()).participants[0].kind).toBe('temporary');
  });

  it('rechecks consent after a persistent creation waits for the world queue', async () => {
    seedWorld();
    const { withWorldMutation } = await import('./worldStore');
    const gate = Promise.withResolvers<void>();
    const blocker = withWorldMutation(() => gate.promise);
    const pending = mod.createRoom('queued');
    mockLoadSettings.mockReturnValue({ livingWorldEnabled: false });
    gate.resolve();
    await blocker;
    await expect(pending).rejects.toThrow(/Living World is disabled/);
    expect((await mod.getWorldState()).rooms).toEqual([]);
  });

  it('createRoom refuses to extend topology while Living World is off', async () => {
    seedWorld([room('r1', ['p1'])]);
    mockLoadSettings.mockReturnValue({ livingWorldEnabled: false });

    await expect(mod.createRoom('Offlimits')).rejects.toThrow(/Living World is disabled/);

    const world = JSON.parse(fs.readFileSync(path.join(tempDir.tmpDir, 'world.json'), 'utf-8')) as { rooms: Room[] };
    expect(world.rooms.map(room => room.id)).toEqual(['r1']);
  });

  it('createRoom publishes and persists a room while Living World is on', async () => {
    seedWorld([]);
    const created = await mod.createRoom('Parlor');

    expect(created.id.startsWith('room-')).toBe(true);
    expect(created.title).toBe('Parlor');

    const state = await mod.getWorldState();
    expect(state.rooms).toHaveLength(1);
    expect(state.rooms[0].title).toBe('Parlor');
  });

  it('persistent createParticipant is consent-gated and writes nothing while Living World is off', async () => {
    seedWorld([]);
    mockLoadSettings.mockReturnValue({ livingWorldEnabled: false });

    await expect(mod.createParticipant({ displayName: 'Durable Dan', kind: 'persistent', personaText: '' }))
      .rejects.toThrow(/Living World is disabled/);

    expect((await mod.getWorldState()).participants).toEqual([]);
  });

  it('temporary createParticipant stays available while Living World is off', async () => {
    seedWorld([]);
    mockLoadSettings.mockReturnValue({ livingWorldEnabled: false });

    const created = await mod.createParticipant({ displayName: 'One-Scene Odette', kind: 'temporary', personaText: 'Disposable cast' });

    expect(created.kind).toBe('temporary');
    const state = await mod.getWorldState();
    expect(state.participants).toHaveLength(1);
    expect(state.participants[0].displayName).toBe('One-Scene Odette');
    expect(state.participants[0].kind).toBe('temporary');
  });

  it('keeps sandbox creation and roster removal usable while Living World is off', async () => {
    mockLoadSettings.mockReturnValue({ livingWorldEnabled: false });
    // Persistent person creation is consent-gated, so seed the roster directly.
    seedWorld([], [], [participant('p1', 'Sam')]);
    const thread = await mod.createSandbox({ operationId: 'sandbox-off', participantIds: ['p1'] });
    expect(thread.sandbox?.bindings[0].baseline.displayName).toBe('Sam');

    seedWorld([room('r1', ['p1'])]);
    const removed = await mod.applyMembership('r1', 'p1', 'remove');
    expect(removed.room.participantIds).toEqual([]);
    expect(removed.event).not.toBeNull();
  });

});
