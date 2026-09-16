import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { createTempDir } from '../../../test/helpers/tempDir';
import type { TempDir } from '../../../test/helpers/tempDir';
import { compileContext } from '../../shared/contextCompiler';
import type {
  IntegrateThreadInput,
  IntegrationPreview,
  JournalEvent,
  MemoryEventPayload,
  Participant,
  Room,
  ScenarioSpec,
  Thread,
} from '../../shared/world';
import { selectionHash } from './integration';

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/tmp/test'), isPackaged: false },
  ipcMain: { handle: vi.fn() },
}));

let tempDir: TempDir;
vi.mock('../utils/platform', () => ({ getUserDataPath: vi.fn(() => tempDir?.tmpDir ?? '/tmp/test') }));
vi.mock('./windowManager', () => ({ openManagedChildWindow: vi.fn() }));
const mockLoadSettings = vi.hoisted(() => vi.fn());
vi.mock('./settings', () => ({ loadSettings: mockLoadSettings }));
const mockConsolidateRoom = vi.fn();
vi.mock('./dreamerRuntime', () => ({
  consolidateRoom: mockConsolidateRoom,
  consolidateContext: vi.fn(async () => undefined),
  cancelMaintenanceContext: vi.fn(),
  reconcilePendingMaintenance: vi.fn(async () => undefined),
}));

let world: typeof import('./worldIpc');
let journal: typeof import('./journalService');
let integration: typeof import('./integration');

function writeWorld(state: unknown): void {
  const filePath = path.join(tempDir.tmpDir, 'world.json');
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(state, null, 2), 'utf-8');
}

function readWorld(): { rooms: Room[]; threads: Thread[]; participants: Participant[]; integrations?: unknown[] } {
  return JSON.parse(fs.readFileSync(path.join(tempDir.tmpDir, 'world.json'), 'utf-8'));
}

const person = (id: string, displayName: string, kind: 'persistent' | 'temporary' = 'persistent'): Participant => ({
  id, displayName, kind, personaText: `${displayName} persona`, setupComplete: true,
});

const sandboxThread = (id: string, bindings: Thread['sandbox'] extends undefined ? never : NonNullable<Thread['sandbox']>['bindings'], scenario?: ScenarioSpec): Thread => ({
  id,
  state: 'active',
  createdAt: 1,
  ...(scenario ? { scenario, scenarioRef: 'stage-1' } : {}),
  sandbox: { operationId: `op-${id}`, requestHash: 'hash', bindings, baselineHeads: {} },
});

async function sandboxMemory(
  threadId: string,
  payload: MemoryEventPayload,
  actorId: string,
  witnesses: string[],
): Promise<JournalEvent> {
  return journal.appendEvent(threadId, {
    roomId: threadId,
    scope: { kind: 'thread', threadId },
    type: 'memory.belief',
    actorId,
    witnesses,
    payload,
  });
}

function integrate(thread: Thread, destinationRoomId: string, selection: Partial<IntegrateThreadInput> = {}): Promise<unknown> {
  return world.integrateThread({
    integrationId: 'integration-1',
    threadId: thread.id,
    destinationRoomId,
    memoryEventIds: [],
    adoptParticipantIds: [],
    includeScenario: false,
    ...selection,
  });
}

describe('world integration', () => {
  beforeEach(async () => {
    tempDir = createTempDir();
    vi.resetModules();
    // Persistent-entry gates read consent synchronously; existing coverage
    // runs with Living World enabled, off-cases override explicitly.
    mockLoadSettings.mockReturnValue({ livingWorldEnabled: true });
    world = await import('./worldIpc');
    journal = await import('./journalService');
    integration = await import('./integration');
  });

  afterEach(() => tempDir.cleanup());

  it('admits only the selected consequences, adopting their people, and leaves the rest sandbox-only', async () => {
    writeWorld({ rooms: [], threads: [], participants: [person('A', 'Ava')] });
    const thread = sandboxThread('thr_1', [
      { originId: 'A', baseline: person('A', 'Ava') },
      { baseline: person('B', 'Ben', 'temporary') },
      { baseline: person('C', 'Cleo', 'temporary') },
    ]);
    const current = readWorld();
    writeWorld({ ...current, threads: [thread] });
    const source = await sandboxMemory('thr_1',
      { ownerId: 'A', kind: 'episode', text: 'A and B prepared the presentation.', sourceEventIds: ['evt_src_1'] },
      'A', ['A', 'B', 'user']);
    await sandboxMemory('thr_1', { ownerId: 'C', kind: 'fact', text: 'C private note.' }, 'C', ['C']);
    const destination = await world.createRoom('My World');

    await integrate(thread, destination.id, {
      memoryEventIds: [source.id],
      adoptParticipantIds: ['B'],
    });

    const sea = await journal.readSeaProjection(destination.id);
    expect(sea.map(event => event.type)).toEqual(['memory.belief', 'integration']);
    const admitted = sea.find(event => event.type === 'memory.belief')!;
    expect(admitted.witnesses).toEqual(['A', 'B', 'user']);
    expect(admitted.payload).toEqual({ ownerId: 'A', kind: 'episode', text: 'A and B prepared the presentation.', sourceEventIds: ['evt_src_1'] });
    expect(admitted.provenance).toEqual({ integrationId: 'integration-1', sourceThreadEventIds: [source.id], stagedIntegration: true });
    expect(sea.filter(event => event.type === 'membership').map(event => (event.payload as { participantId: string }).participantId).sort())
      .toEqual([]);
    const marker = sea.find(event => event.type === 'integration')!;
    expect(marker.payload).toMatchObject({
      integrationId: 'integration-1',
      sourceThreadId: 'thr_1',
      sourceEventIds: [source.id],
      promotedParticipantIds: ['B'],
      destinationRoomId: destination.id,
      scenarioAdopted: false,
    });

    const state = await world.getWorldState();
    // Identity-preserving: the existing person A was referenced, never duplicated.
    expect(state.participants.filter(participant => participant.id === 'A')).toHaveLength(1);
    expect(state.participants.find(participant => participant.id === 'A')?.kind).toBe('persistent');
    // Selective adoption: B became persistent with a stable id; C never left the sandbox.
    expect(state.participants.find(participant => participant.id === 'B')?.kind).toBe('persistent');
    expect(state.participants.some(participant => participant.id === 'C')).toBe(false);
    expect(state.rooms.find(room => room.id === destination.id)?.participantIds.sort()).toEqual([]);
    // C's material is still sandbox-only; the selected source event stayed in the thread journal.
    expect(sea.some(event => JSON.stringify(event.payload).includes('C private note'))).toBe(false);
    const threadEvents = await journal.readThread('thr_1', 'thr_1');
    expect(threadEvents.map(event => event.id)).toContain(source.id);
    expect(threadEvents.some(event => JSON.stringify(event.payload).includes('C private note'))).toBe(true);
    expect(state.threads.find(item => item.id === 'thr_1')?.state).toBe('active');
  });

  it('keeps a private witness boundary after admission', async () => {
    writeWorld({ rooms: [], threads: [], participants: [person('A', 'Ava'), person('B', 'Ben')] });
    const thread = sandboxThread('thr_1', [
      { originId: 'A', baseline: person('A', 'Ava') },
      { originId: 'B', baseline: person('B', 'Ben') },
    ]);
    const current = readWorld();
    writeWorld({ ...current, threads: [thread] });
    const private_ = await sandboxMemory('thr_1',
      { ownerId: 'A', kind: 'belief', text: 'A private conviction.' },
      'A', ['A']);
    const destination = await world.createRoom('My World');

    await integrate(thread, destination.id, { memoryEventIds: [private_.id] });

    const sea = await journal.readSeaProjection(destination.id);
    const admitted = sea.find(event => event.type === 'memory.belief')!;
    expect(admitted.witnesses).toEqual(['A']);
    // B was never referenced, so B is not dragged into the destination roster.
    expect((await world.getWorldState()).rooms.find(room => room.id === destination.id)?.participantIds).toEqual([]);
    // Even after B later joins the Room, the admitted event stays A-only knowledge.
    await world.applyMembership(destination.id, 'B', 'add');
    const roomState = (await world.getWorldState()).rooms.find(room => room.id === destination.id)!;
    const bContext = compileContext({
      participant: person('B', 'Ben'),
      participants: [person('A', 'Ava'), person('B', 'Ben')],
      room: roomState,
      seaEvents: await journal.readSeaProjection(destination.id),
      threadEvents: [],
    });
    expect(bContext.memories).toEqual([]);
    const aContext = compileContext({
      participant: person('A', 'Ava'),
      participants: [person('A', 'Ava'), person('B', 'Ben')],
      room: roomState,
      seaEvents: await journal.readSeaProjection(destination.id),
      threadEvents: [],
    });
    expect(aContext.memories.map(memory => memory.text)).toEqual(['A private conviction.']);
  });

  it('is idempotent under sequential and concurrent retries of the same operation', async () => {
    writeWorld({ rooms: [], threads: [], participants: [person('A', 'Ava')] });
    const thread = sandboxThread('thr_1', [
      { originId: 'A', baseline: person('A', 'Ava') },
      { baseline: person('B', 'Ben', 'temporary') },
    ]);
    const current = readWorld();
    writeWorld({ ...current, threads: [thread] });
    const first = await sandboxMemory('thr_1', { ownerId: 'A', kind: 'fact', text: 'one.' }, 'A', ['A', 'user']);
    const second = await sandboxMemory('thr_1', { ownerId: 'B', kind: 'open-loop', text: 'two.' }, 'B', ['B', 'user']);
    const destination = await world.createRoom('My World');
    const input: Partial<IntegrateThreadInput> = {
      memoryEventIds: [first.id, second.id],
      adoptParticipantIds: ['B'],
    };

    const [concurrentFirst, concurrentRetry] = await Promise.all([
      integrate(thread, destination.id, input),
      integrate(thread, destination.id, input),
    ]);
    expect([concurrentFirst, concurrentRetry].map(result => (result as { alreadyApplied: boolean }).alreadyApplied).sort())
      .toEqual([false, true]);
    const replay = await integrate(thread, destination.id, input) as { alreadyApplied: boolean };
    expect(replay.alreadyApplied).toBe(true);

    const sea = await journal.readSeaProjection(destination.id);
    expect(sea.filter(event => event.type === 'memory.belief')).toHaveLength(2);
    expect(sea.filter(event => event.type === 'integration')).toHaveLength(1);
    expect(sea.filter(event => event.type === 'membership')).toHaveLength(0);
    expect((await world.getWorldState()).participants.filter(participant => participant.id === 'B')).toHaveLength(1);
    expect((readWorld().integrations ?? []).map(record => (record as { status: string }).status)).toEqual(['committed']);
  });

  it('resumes a partially admitted operation without duplicating events', async () => {
    writeWorld({ rooms: [], threads: [], participants: [person('A', 'Ava')] });
    const thread = sandboxThread('thr_1', [{ originId: 'A', baseline: person('A', 'Ava') }]);
    const current = readWorld();
    writeWorld({ ...current, threads: [thread] });
    const first = await sandboxMemory('thr_1', { ownerId: 'A', kind: 'fact', text: 'one.' }, 'A', ['A', 'user']);
    const second = await sandboxMemory('thr_1', { ownerId: 'A', kind: 'fact', text: 'two.' }, 'A', ['A', 'user']);
    const destination = await world.createRoom('My World');
    // Simulate a crash after the first Sea admission but before the marker.
    await journal.appendEvent(destination.id, {
      roomId: destination.id,
      scope: { kind: 'sea' },
      type: 'memory.belief',
      actorId: 'A',
      witnesses: ['A', 'user'],
      payload: { ownerId: 'A', kind: 'fact', text: 'one.' },
      provenance: { integrationId: 'integration-1', sourceThreadEventIds: [first.id], stagedIntegration: true },
    });

    const result = await integrate(thread, destination.id, { memoryEventIds: [first.id, second.id] }) as { alreadyApplied: boolean };
    expect(result.alreadyApplied).toBe(false);
    const sea = await journal.readSeaProjection(destination.id);
    expect(sea.filter(event => event.type === 'memory.belief')).toHaveLength(2);
    expect(sea.filter(event => event.type === 'integration')).toHaveLength(1);
  });

  it('settles a pending ledger record without a prepared before-image as interrupted and publishes nothing', async () => {
    writeWorld({ rooms: [], threads: [], participants: [person('A', 'Ava')] });
    const thread = sandboxThread('thr_1', [
      { originId: 'A', baseline: person('A', 'Ava') },
      { baseline: person('B', 'Ben', 'temporary') },
    ]);
    writeWorld({ ...readWorld(), threads: [thread] });
    const destination = await world.createRoom('My World');
    // A ledger entry no corrected operation could have written: pending with
    // no before-image. Recovery must fail closed, not certify or roll back.
    writeWorld({
      ...readWorld(),
      participants: [person('A', 'Ava'), { ...person('B', 'Ben', 'temporary'), kind: 'persistent' }],
      rooms: [{ ...destination, participantIds: ['A', 'B'] }],
      integrations: [{
        integrationId: 'integration-1',
        sourceThreadId: 'thr_1',
        destinationRoomId: destination.id,
        memoryEventIds: [],
        adoptParticipantIds: ['B'],
        includeScenario: false,
        selectionHash: selectionHash({
          threadId: 'thr_1', destinationRoomId: destination.id, memoryEventIds: [], adoptParticipantIds: ['B'], includeScenario: false,
        }),
        status: 'pending',
        createdAt: 1,
      }],
    });

    await integration.reconcilePendingIntegrations();

    expect(await journal.readSeaProjection(destination.id)).toEqual([]);
    expect((readWorld().integrations ?? [])[0]).toMatchObject({ status: 'interrupted', integrationId: 'integration-1' });
    // No guessed rollback either: the half-published topology stays as an
    // explicit interrupted state instead of being silently rewritten.
    expect((await world.getWorldState()).participants.find(person => person.id === 'B')?.kind).toBe('persistent');
    await expect(integrate(thread, destination.id, { adoptParticipantIds: ['B'] })).rejects.toThrow(/interrupted/);
  });

  it('rejects a changed selection for the same operation ID', async () => {
    writeWorld({ rooms: [], threads: [], participants: [person('A', 'Ava')] });
    const thread = sandboxThread('thr_1', [{ originId: 'A', baseline: person('A', 'Ava') }]);
    const current = readWorld();
    writeWorld({ ...current, threads: [thread] });
    const first = await sandboxMemory('thr_1', { ownerId: 'A', kind: 'fact', text: 'one.' }, 'A', ['A', 'user']);
    const second = await sandboxMemory('thr_1', { ownerId: 'A', kind: 'fact', text: 'two.' }, 'A', ['A', 'user']);
    const destination = await world.createRoom('My World');

    await integrate(thread, destination.id, { memoryEventIds: [first.id] });
    await expect(integrate(thread, destination.id, { memoryEventIds: [second.id] }))
      .rejects.toThrow(/conflict/);
    const sea = await journal.readSeaProjection(destination.id);
    expect(sea.filter(event => event.type === 'memory.belief')).toHaveLength(1);
  });

  it('refuses to admit a source event that another operation already carried into the Sea', async () => {
    writeWorld({ rooms: [], threads: [], participants: [person('A', 'Ava')] });
    const thread = sandboxThread('thr_1', [{ originId: 'A', baseline: person('A', 'Ava') }]);
    const current = readWorld();
    writeWorld({ ...current, threads: [thread] });
    const source = await sandboxMemory('thr_1', { ownerId: 'A', kind: 'fact', text: 'one.' }, 'A', ['A', 'user']);
    const destination = await world.createRoom('My World');

    await integrate(thread, destination.id, { memoryEventIds: [source.id] });
    await expect(integrate(thread, destination.id, { integrationId: 'integration-2', memoryEventIds: [source.id] }))
      .rejects.toThrow(/already admitted/);
    const sea = await journal.readSeaProjection(destination.id);
    expect(sea.filter(event => event.type === 'memory.belief')).toHaveLength(1);
  });

  it('replays an acknowledged operation after the source sandbox journal is erased', async () => {
    writeWorld({ rooms: [], threads: [], participants: [person('A', 'Ava')] });
    const thread = sandboxThread('thr_1', [{ originId: 'A', baseline: person('A', 'Ava') }]);
    const current = readWorld();
    writeWorld({ ...current, threads: [thread] });
    const source = await sandboxMemory('thr_1', { ownerId: 'A', kind: 'fact', text: 'one.' }, 'A', ['A', 'user']);
    const destination = await world.createRoom('My World');
    await integrate(thread, destination.id, { memoryEventIds: [source.id] });
    const seaBefore = await journal.readSeaProjection(destination.id);

    await journal.eraseThread('thr_1', 'thr_1');
    const replay = await integrate(thread, destination.id, { memoryEventIds: [source.id] }) as {
      alreadyApplied: boolean;
      appended: JournalEvent[];
    };
    expect(replay.alreadyApplied).toBe(true);
    expect(replay.appended.map(event => event.id))
      .toEqual(seaBefore.filter(event => event.provenance?.integrationId === 'integration-1').map(event => event.id));
  });

  it('previews the catalog, required adoptions and blocking problems without writing', async () => {
    writeWorld({ rooms: [], threads: [], participants: [person('A', 'Ava')] });
    const thread = sandboxThread('thr_1', [
      { originId: 'A', baseline: person('A', 'Ava') },
      { baseline: person('B', 'Ben', 'temporary') },
    ]);
    const current = readWorld();
    writeWorld({ ...current, threads: [thread] });
    const source = await sandboxMemory('thr_1', { ownerId: 'B', kind: 'episode', text: 'Ben episode.' }, 'B', ['B', 'user']);
    const destination = await world.createRoom('My World');

    const empty: IntegrationPreview = await world.previewIntegration({
      threadId: 'thr_1', destinationRoomId: destination.id, memoryEventIds: [], adoptParticipantIds: [], includeScenario: false,
    });
    expect(empty.items.map(item => item.sourceEventId)).toEqual([source.id]);
    expect(empty.items[0].witnesses).toEqual(['B', 'user']);
    expect(empty.people.map(person => person.id).sort()).toEqual(['A', 'B']);
    expect(empty.people.find(person => person.id === 'A')?.action).toBe('reference');
    expect(empty.people.find(person => person.id === 'B')?.action).toBe('adopt');

    const selection: IntegrationPreview = await world.previewIntegration({
      threadId: 'thr_1', destinationRoomId: destination.id, memoryEventIds: [source.id], adoptParticipantIds: [], includeScenario: false,
    });
    expect(selection.requiredAdoptions).toEqual(['B']);
    expect(selection.problems).toEqual([expect.stringContaining('adopting sandbox person')]);

    const complete: IntegrationPreview = await world.previewIntegration({
      threadId: 'thr_1', destinationRoomId: destination.id, memoryEventIds: [source.id], adoptParticipantIds: ['B'], includeScenario: false,
    });
    expect(complete.problems).toEqual([]);
    expect(complete.people.find(person => person.id === 'B')?.required).toBe(true);

    const seaBefore = await journal.readSeaProjection(destination.id);
    expect(seaBefore).toEqual([]);
    await expect(integrate(thread, destination.id, { memoryEventIds: [source.id] }))
      .rejects.toThrow(/adopting sandbox person/);
    expect(await journal.readSeaProjection(destination.id)).toEqual([]);
  });

  it('WORLD_INTEGRATE fires marker-idempotent consolidation on fresh commit and replay', async () => {
    writeWorld({ rooms: [], threads: [], participants: [person('A', 'Ava')] });
    const thread = sandboxThread('thr_1', [{ originId: 'A', baseline: person('A', 'Ava') }]);
    const current = readWorld();
    writeWorld({ ...current, threads: [thread] });
    const source = await sandboxMemory('thr_1', { ownerId: 'A', kind: 'fact', text: 'one.' }, 'A', ['A', 'user']);
    const destination = await world.createRoom('My World');

    world.setupWorldIPC();
    const handle = vi.mocked((await import('electron')).ipcMain.handle);
    const integrateHandler = handle.mock.calls.find((call) => call[0] === 'world-integrate')?.[1] as
      | ((event: unknown, input: IntegrateThreadInput) => Promise<unknown>)
      | undefined;
    const previewHandler = handle.mock.calls.find((call) => call[0] === 'world-preview-integration')?.[1] as
      | ((event: unknown, input: unknown) => Promise<unknown>)
      | undefined;
    expect(integrateHandler).toBeDefined();
    expect(previewHandler).toBeDefined();

    await integrateHandler({}, {
      integrationId: 'integration-1',
      threadId: thread.id,
      destinationRoomId: destination.id,
      memoryEventIds: [source.id],
      adoptParticipantIds: [],
      includeScenario: false,
    });
    const { promise, resolve } = Promise.withResolvers<void>();
    setImmediate(resolve);
    await promise;
    expect(mockConsolidateRoom).toHaveBeenCalledWith(destination.id, { getSettings: mockLoadSettings });

    mockConsolidateRoom.mockClear();
    await integrateHandler({}, {
      integrationId: 'integration-1',
      threadId: thread.id,
      destinationRoomId: destination.id,
      memoryEventIds: [source.id],
      adoptParticipantIds: [],
      includeScenario: false,
    });
    const deferred = Promise.withResolvers<void>();
    setImmediate(deferred.resolve);
    await deferred.promise;
    expect(mockConsolidateRoom).toHaveBeenCalledTimes(1);
    expect(mockConsolidateRoom).toHaveBeenCalledWith(destination.id, { getSettings: mockLoadSettings });
  });

  it('resolves an already-adopted sandbox person as a reference in later operations', async () => {
    writeWorld({ rooms: [], threads: [], participants: [person('A', 'Ava')] });
    const thread = sandboxThread('thr_1', [
      { originId: 'A', baseline: person('A', 'Ava') },
      { baseline: person('B', 'Ben', 'temporary') },
    ]);
    const current = readWorld();
    writeWorld({ ...current, threads: [thread] });
    const ownedByB = await sandboxMemory('thr_1', { ownerId: 'B', kind: 'fact', text: 'Ben fact.' }, 'B', ['B', 'user']);
    const ownedByA = await sandboxMemory('thr_1', { ownerId: 'A', kind: 'episode', text: 'A and B episode.' }, 'A', ['A', 'B', 'user']);
    const later = await sandboxMemory('thr_1', { ownerId: 'B', kind: 'open-loop', text: 'Ben later loop.' }, 'B', ['B', 'user']);
    const destination = await world.createRoom('My World');

    // Op 0: adoption-only — B becomes persistent and joins the destination roster.
    await integrate(thread, destination.id, { integrationId: 'integration-0', adoptParticipantIds: ['B'] });
    expect((await world.getWorldState()).rooms.find(room => room.id === destination.id)?.participantIds).toEqual([]);

    // Op 1: an episode referencing both people; B resolves as the same person.
    await integrate(thread, destination.id, { integrationId: 'integration-1', memoryEventIds: [ownedByB.id, ownedByA.id] });
    const preview: IntegrationPreview = await world.previewIntegration({
      threadId: 'thr_1', destinationRoomId: destination.id, memoryEventIds: [later.id], adoptParticipantIds: [], includeScenario: false,
    });
    expect(preview.requiredAdoptions).toEqual([]);
    expect(preview.problems).toEqual([]);
    expect(preview.people.find(person => person.id === 'B')?.action).toBe('reference');

    // Op 2: B's later development integrates without re-adoption or duplicates.
    await integrate(thread, destination.id, { integrationId: 'integration-2', memoryEventIds: [later.id] });
    const sea = await journal.readSeaProjection(destination.id);
    expect(sea.filter(event => event.type === 'memory.belief')).toHaveLength(3);
    expect(sea.filter(event => event.type === 'integration')).toHaveLength(3);
    expect(sea.filter(event => event.type === 'membership')).toHaveLength(0); // B (op0), A (op1)
    const state = await world.getWorldState();
    expect(state.participants.filter(participant => participant.id === 'B')).toHaveLength(1);
    expect(state.rooms.find(room => room.id === destination.id)?.participantIds.sort()).toEqual([]);
  });
  it('does not turn historical witnesses or an adopted person into current members', async () => {
    const thread = sandboxThread('history', [
      { originId: 'A', baseline: person('A', 'Ava') },
      { baseline: person('B', 'Ben', 'temporary') },
    ]);
    writeWorld({ rooms: [], threads: [thread], participants: [person('A', 'Ava')] });
    const source = await sandboxMemory(thread.id, { ownerId: 'A', kind: 'episode', text: 'Past encounter' }, 'A', ['A', 'B']);
    const destination = await world.createRoom('Destination');
    await integrate(thread, destination.id, { memoryEventIds: [source.id], adoptParticipantIds: ['B'] });
    expect((await world.getWorldState()).rooms[0].participantIds).toEqual([]);
    expect((await journal.readSeaProjection(destination.id)).filter(e => e.type === 'membership')).toEqual([]);
  });

  it('keeps the adoption identity after persistent persona edits and rejects a tampered binding', async () => {
    const thread = sandboxThread('identity', [{ baseline: person('B', 'Ben', 'temporary') }]);
    writeWorld({ rooms: [], threads: [thread], participants: [] });
    const destination = await world.createRoom('Destination');
    await integrate(thread, destination.id, { adoptParticipantIds: ['B'] });
    await world.updateParticipant({ ...person('B', 'Ben'), personaText: 'Developed persona' });
    const source = await sandboxMemory(thread.id, { ownerId: 'B', kind: 'fact', text: 'Later consequence' }, 'B', ['B']);
    await integrate(thread, destination.id, { integrationId: 'later', memoryEventIds: [source.id], adoptParticipantIds: ['B'] });
    expect((await world.getWorldState()).participants[0].personaText).toBe('Developed persona');
    const state = readWorld();
    state.threads[0].sandbox!.bindings[0].baseline.personaText = 'Impostor';
    writeWorld(state);
    await expect(integrate(thread, destination.id, { integrationId: 'tampered', adoptParticipantIds: ['B'] })).rejects.toThrow();
  });

  it('does not expose a real W3 prefix to world, Sea, subscribe, query or context readers', async () => {
    const thread = sandboxThread('crash', [{ baseline: person('B', 'Ben', 'temporary') }]);
    writeWorld({ rooms: [], threads: [thread], participants: [] });
    const destination = await world.createRoom('Destination');
    const source = await sandboxMemory(thread.id, { ownerId: 'B', kind: 'fact', text: 'Uncommitted secret' }, 'B', ['B']);
    const append = journal.appendEvent;
    const spy = vi.spyOn(journal, 'appendEvent').mockImplementation(async (id, draft) => {
      if (draft.type === 'integration') throw new Error('crash before marker');
      return append(id, draft);
    });
    await expect(integrate(thread, destination.id, { memoryEventIds: [source.id], adoptParticipantIds: ['B'] })).rejects.toThrow('crash before marker');
    spy.mockRestore();
    expect((await world.getWorldState()).participants).toEqual([]);
    expect(await journal.readSeaProjection(destination.id)).toEqual([]);
    expect((await journal.subscribeRoom(destination.id, 100)).events).toEqual([]);
    expect(await journal.queryEvents(destination.id, { limit: 100 })).toEqual([]);
    mockLoadSettings.mockReturnValue({ livingWorldEnabled: false });
    await integration.reconcilePendingIntegrations();
    expect((await world.getWorldState()).participants).toEqual([]);
    expect(await journal.readSeaProjection(destination.id)).toEqual([]);
    expect((await world.getWorldState()).integrations?.[0].status).toBe('pending');
    mockLoadSettings.mockReturnValue({ livingWorldEnabled: true });
    await integration.reconcilePendingIntegrations();
    expect((await world.getWorldState()).participants.map(p => p.id)).toEqual(['B']);
    expect((await journal.readSeaProjection(destination.id)).filter(e => e.type === 'memory.belief')).toHaveLength(1);
  });

  it('integrates people and distinct consequences into world continuity without creating a Room', async () => {
    const thread = sandboxThread('world-source', [{ baseline: person('B', 'Ben', 'temporary') }]);
    writeWorld({ rooms: [], threads: [thread], participants: [] });
    const source = await sandboxMemory(thread.id, { ownerId: 'B', kind: 'fact', text: 'Independent fact', sourceEventIds: ['shared-source'] }, 'B', ['B']);
    const second = await sandboxMemory(thread.id, { ownerId: 'B', kind: 'open-loop', text: 'Independent loop', sourceEventIds: ['shared-source'] }, 'B', ['B']);
    const excluded = await sandboxMemory(thread.id, { ownerId: 'B', kind: 'relationship', toId: 'user', label: 'trust', text: 'UNSELECTED_RELATIONSHIP' }, 'B', ['B']);
    await integrate(thread, 'world-continuity', { memoryEventIds: [source.id], adoptParticipantIds: ['B'] });
    await integrate(thread, 'world-continuity', { integrationId: 'independent', memoryEventIds: [second.id] });
    const destination = await world.createRoom('Another destination');
    await integrate(thread, destination.id, { integrationId: 'other-destination', memoryEventIds: [source.id] });
    expect((await world.getWorldState()).rooms).toHaveLength(1);
    expect((await world.getWorldState()).rooms[0].participantIds).toEqual([]);
    expect((await journal.readSeaProjection('world-continuity')).filter(e => e.type === 'memory.belief')).toHaveLength(2);
    expect((await journal.readThread(thread.id, thread.id)).map(e => e.id)).toContain(excluded.id);
    const { runDreamer } = await import('./dreamerService');
    const llmFn = vi.fn(async () => JSON.stringify({ beliefs: [], resolutions: [] }));
    await runDreamer('world-continuity', { policy: { kind: 'local', isPermitted: () => true, prefer: () => true }, llmFn });
    expect(llmFn).toHaveBeenCalled();
    expect(llmFn.mock.calls.flat().join()).not.toContain('UNSELECTED_RELATIONSHIP');
    expect(JSON.stringify(await journal.readSeaProjection('world-continuity'))).not.toContain('UNSELECTED_RELATIONSHIP');
  });

  it('does not globally consume a source because manual remember-this made a different consequence', async () => {
    const thread = sandboxThread('manual-source', [{ originId: 'A', baseline: person('A', 'Ava') }]);
    writeWorld({ rooms: [], threads: [thread], participants: [person('A', 'Ava')] });
    const destination = await world.createRoom('Destination');
    const source = await sandboxMemory(thread.id, { ownerId: 'A', kind: 'fact', text: 'Full selected consequence' }, 'A', ['A']);
    await journal.appendEvent(destination.id, { roomId: destination.id, scope: { kind: 'sea' }, type: 'memory.belief', actorId: 'A', witnesses: ['A'], payload: { ownerId: 'A', kind: 'belief', text: 'Different interpretation' }, provenance: { sourceThreadEventIds: [source.id] } });
    await integrate(thread, destination.id, { memoryEventIds: [source.id] });
    expect((await journal.readSeaProjection(destination.id)).filter(e => e.type === 'memory.belief')).toHaveLength(2);
  });

  it('preserves historical witness access without undoing a departure or broadening private knowledge', async () => {
    const thread = sandboxThread('history-source', [{ originId: 'A', baseline: person('A', 'Ava') }, { originId: 'B', baseline: person('B', 'Ben') }]);
    writeWorld({ rooms: [], threads: [thread], participants: [person('A', 'Ava'), person('B', 'Ben')] });
    const destination = await world.createRoom('Destination');
    await world.applyMembership(destination.id, 'A', 'add');
    await world.applyMembership(destination.id, 'A', 'remove');
    await world.applyMembership(destination.id, 'B', 'add');
    const source = await sandboxMemory(thread.id, { ownerId: 'A', kind: 'fact', text: 'Private past' }, 'A', ['A']);
    await integrate(thread, destination.id, { memoryEventIds: [source.id] });
    const state = await world.getWorldState();
    expect(state.rooms[0].participantIds).toEqual(['B']);
    const context = (id: string) => compileContext({ room: state.rooms[0], participant: state.participants.find(p => p.id === id)!, participants: state.participants, seaEvents: [], threadEvents: [] });
    const seaEvents = await journal.readSeaProjection(destination.id);
    expect(compileContext({ room: state.rooms[0], participant: state.participants[0], participants: state.participants, seaEvents, threadEvents: [] }).memories.map(m => m.text)).toEqual(['Private past']);
    expect(compileContext({ room: state.rooms[0], participant: state.participants[1], participants: state.participants, seaEvents, threadEvents: [] }).memories).toEqual(context('B').memories);
  });

  it('settles a conflicting prepared operation with no partial canonical effects', async () => {
    const thread = sandboxThread('conflict-source', [{ baseline: person('B', 'Ben', 'temporary') }]);
    writeWorld({ rooms: [], threads: [thread], participants: [] });
    const destination = await world.createRoom('Destination');
    const source = await sandboxMemory(thread.id, { ownerId: 'B', kind: 'fact', text: 'Never published' }, 'B', ['B']);
    const append = journal.appendEvent;
    const spy = vi.spyOn(journal, 'appendEvent').mockImplementation(async (id, draft) => {
      if (draft.type === 'integration') throw new Error('transient IO');
      return append(id, draft);
    });
    await expect(integrate(thread, destination.id, { memoryEventIds: [source.id], adoptParticipantIds: ['B'] })).rejects.toThrow('transient IO');
    spy.mockRestore();
    const state = readWorld(); state.rooms[0].title = 'Concurrent edit'; writeWorld(state);
    await integration.reconcilePendingIntegrations();
    const snapshot = await world.getWorldState();
    expect(snapshot.integrations?.[0]).toMatchObject({ status: 'interrupted', note: expect.stringContaining('No prepared effects') });
    expect(snapshot.integrations?.[0]).not.toHaveProperty('prepared');
    expect(snapshot.participants).toEqual([]);
    expect(snapshot.rooms[0].title).toBe('Concurrent edit');
    expect(await journal.readSeaProjection(destination.id)).toEqual([]);
    await integrate(thread, destination.id, { integrationId: 'fresh-reviewed-operation', memoryEventIds: [source.id], adoptParticipantIds: ['B'] });
    expect((await journal.readSeaProjection(destination.id)).filter(e => e.type === 'memory.belief')).toHaveLength(1);
  });

  it('excludes a retracted consequence from preview and commit', async () => {
    const thread = sandboxThread('retraction', [{ originId: 'A', baseline: person('A', 'Ava') }]);
    writeWorld({ rooms: [], threads: [thread], participants: [person('A', 'Ava')] });
    const source = await sandboxMemory(thread.id, { ownerId: 'A', kind: 'fact', text: 'Retracted' }, 'A', ['A']);
    await journal.appendEvent(thread.id, { roomId: thread.id, scope: { kind: 'thread', threadId: thread.id }, type: 'correction', actorId: 'A', witnesses: ['A'], payload: { ownerId: 'A', targetId: source.id } });
    const input = { threadId: thread.id, destinationRoomId: 'world-continuity', memoryEventIds: [source.id], adoptParticipantIds: [], includeScenario: false };
    expect((await world.previewIntegration(input)).items).toEqual([]);
    await expect(integration.integrateThread({ ...input, integrationId: 'retracted-operation' })).rejects.toThrow('not part');
  });

  it('rejects malformed input before preparing any effects', async () => {
    writeWorld({ rooms: [], threads: [], participants: [] });
    await expect(integration.integrateThread({ integrationId: 'malformed', threadId: 'source', destinationRoomId: 'world-continuity', memoryEventIds: [], adoptParticipantIds: [], includeScenario: 'yes' } as unknown as IntegrateThreadInput)).rejects.toThrow('invalid integration selection');
    expect(readWorld().integrations).toBeUndefined();
  });

  it('rejects integration before any world mutation while Living World is off', async () => {
    writeWorld({ rooms: [], threads: [], participants: [person('A', 'Ava')] });
    const thread = sandboxThread('thr_1', [{ originId: 'A', baseline: person('A', 'Ava') }]);
    writeWorld({ ...readWorld(), threads: [thread] });
    const source = await sandboxMemory('thr_1',
      { ownerId: 'A', kind: 'episode', text: 'A and B prepared the presentation.', sourceEventIds: ['evt_src_1'] },
      'A', ['A', 'user']);
    mockLoadSettings.mockReturnValue({ livingWorldEnabled: false });

    await expect(integrate(thread, 'world-continuity', { memoryEventIds: [source.id] }))
      .rejects.toThrow(/Living World is disabled/);

    // The rejection preceded every write: no pending record, no admitted rows.
    expect(readWorld().integrations).toBeUndefined();
    expect(await journal.readSeaProjection('world-continuity')).toEqual([]);
    // The preview is a read-only review surface and stays available.
    const input = { threadId: 'thr_1', destinationRoomId: 'world-continuity', memoryEventIds: [source.id], adoptParticipantIds: [], includeScenario: false };
    expect((await world.previewIntegration(input)).items).toHaveLength(1);
  });

});
