import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTempDir, type TempDir } from '../../../test/helpers/tempDir';
import { DEFAULT_SETTINGS } from '../../shared/types';
import { compileContext } from '../../shared/contextCompiler';
import { sandboxContext, threadParticipants } from '../../shared/world';
import { runRoomTurn } from '../../shared/roomOrchestrator';

let temp: TempDir;
const completion = vi.fn();
vi.mock('electron', () => ({ app: { getPath: () => '/tmp/test', isPackaged: false }, ipcMain: { handle: vi.fn() } }));
vi.mock('../utils/platform', () => ({ getUserDataPath: () => temp.tmpDir }));
vi.mock('./llmRouter', () => ({ completeJob: completion }));
vi.mock('./settings', () => ({ loadSettings: () => ({ ...DEFAULT_SETTINGS, llmProvider: 'ollama' }) }));
vi.mock('./windowManager', () => ({ openManagedChildWindow: vi.fn() }));
vi.mock('./dreamerRuntime', () => ({ consolidateRoom: vi.fn() }));

let director: typeof import('./scenarioDirector');
let world: typeof import('./worldIpc');
let journal: typeof import('./journalService');
const request = { operationId: 'garden-scene', participantIds: [], intent: 'Help two neighbors decide how to share a garden.' };
function proposal() {
  return {
    scene: { sharedFacts: ['A shared garden needs a plan.'], socialConstraints: ['Let everyone contribute.'] },
    participants: [
      { kind: 'temporary', localId: 'mara', profile: { name: 'Mara', personaText: 'A patient gardener who likes to plan carefully.',
        goals: ['Make room for herbs'], behaviorConstraints: [], initialKnowledge: [{ text: 'The tools need repairing', witnesses: ['mara'] }] } },
      { kind: 'temporary', localId: 'eli', profile: { name: 'Eli', personaText: 'A spontaneous neighbor who enjoys shared projects.',
        goals: ['Grow flowers'], behaviorConstraints: [], initialKnowledge: [] } },
    ], relationships: [{ fromId: 'mara', toId: 'eli', label: 'Unsure about reliability', directional: true }], adaptations: ['Generated fictional neighbors'],
  };
}

beforeEach(async () => {
  temp = createTempDir(); vi.resetModules(); completion.mockReset();
  completion.mockResolvedValue(JSON.stringify(proposal()));
  director = await import('./scenarioDirector'); world = await import('./worldIpc'); journal = await import('./journalService');
});
afterEach(() => temp.cleanup());

describe('Director production staging and activation', () => {
  it('reviews, atomically adopts and speaks through distinct scoped generated individuals', async () => {
    const stage = await director.prepareScenario(request);
    expect(stage.status).toBe('ready'); expect(stage.origin).toBe('generated');
    expect(await world.getWorldState()).toMatchObject({ rooms: [], participants: [], threads: [] });
    const [thread, again] = await Promise.all([director.activateScenario(stage.operationId), director.activateScenario(stage.operationId)]);
    expect(again).toEqual(thread);
    if ('participantIds' in thread) throw new Error('Expected sandbox');
    expect(thread.scenarioRef).toBe(stage.operationId);
    const state = await world.getWorldState();
    expect(state.rooms).toEqual([]); expect(state.participants).toEqual([]); expect(state.threads).toHaveLength(1);
    const cast = threadParticipants(thread, []);
    expect(cast).toHaveLength(2); expect(cast[0].id).not.toBe('mara');
    const contexts = cast.map(participant => compileContext({ participant, participants: cast, thread, seaEvents: [] }));
    expect(contexts[0].scenario?.knowledge).toEqual(['The tools need repairing']);
    expect(contexts[1].scenario?.knowledge).toEqual([]);
    expect(contexts[0].scenario?.goals).toEqual(['Make room for herbs']);
    expect(contexts[1].scenario?.goals).toEqual(['Grow flowers']);
    expect(contexts[0].relationships).toEqual([{ toId: cast[1].id, label: 'Unsure about reliability' }]);
    expect(contexts[1].relationships).toEqual([]);
    expect(JSON.stringify(contexts)).not.toContain(request.intent);
    const user = await journal.appendEvent(thread.id, { roomId: thread.id, scope: { kind: 'thread', threadId: thread.id },
      actorId: 'user', type: 'message.user', witnesses: ['user', ...cast.map(person => person.id)], payload: { text: 'Mara, what would you like to grow?' } });
    const run = vi.fn(async (_id, context) => { expect(context.scenario.sharedFacts).toEqual(['A shared garden needs a plan.']); return { text: 'Some herbs.' }; });
    await runRoomTurn({ thread, room: sandboxContext(thread)!, participants: [], seaEvents: [], threadEvents: [user],
      runAgentTurn: run, appendEvent: draft => journal.appendEvent(thread.id, draft), maxCharacterExchanges: 0 });
    expect(run).toHaveBeenCalledTimes(1);
    expect((await journal.readThread(thread.id, thread.id)).map(event => event.type)).toEqual(['message.user', 'message.character']);
    expect(completion).toHaveBeenCalledTimes(1);
  });

  it('cancels a live pending generation with no phantom cast or context', async () => {
    completion.mockImplementation((_messages, signal: AbortSignal) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true });
    }));
    const pending = director.prepareScenario(request);
    const rejected = expect(pending).rejects.toThrow(/cancel/);
    await vi.waitFor(() => expect(completion).toHaveBeenCalledOnce());
    await director.cancelScenario(request.operationId);
    await rejected;
    const state = await world.getWorldState();
    expect(state).toMatchObject({ rooms: [], participants: [], threads: [] });
    expect(state.scenarioCreations?.[0].status).toBe('cancelled');
    expect(state.scenarioCreations?.[0].bindings).toEqual([]);
    await expect(director.activateScenario(request.operationId)).rejects.toThrow(/not ready/);
  });

  it('rejects forged authority before publication and keeps a durable retryable failure', async () => {
    const bad = proposal(); bad.participants[0].localId = 'user';
    completion.mockResolvedValueOnce(JSON.stringify(bad));
    await expect(director.prepareScenario(request)).rejects.toThrow(/identity/);
    expect((await world.getWorldState()).scenarioCreations?.[0].status).toBe('failed');
    expect((await world.getWorldState()).threads).toEqual([]);
    await expect(director.prepareScenario(request)).resolves.toMatchObject({ status: 'ready' });
  });

  it('publishes a persistent Room-owned Scenario and permanent cast without a Thread', async () => {
    const stage = await director.prepareScenario({ ...request, scope: 'persistent' });
    expect(stage.status).toBe('ready');
    const before = await world.getWorldState();
    expect(before.rooms).toEqual([]); expect(before.participants).toEqual([]);
    const activated = await director.activateScenario(stage.operationId);
    if (!('participantIds' in activated)) throw new Error('Expected Room');
    const state = await world.getWorldState();
    expect(state.rooms).toHaveLength(1);
    expect(state.threads).toHaveLength(0);
    const room = state.rooms[0];
    expect(activated.id).toBe(room.id);
    expect(room.scenarioRef).toBe(stage.operationId);
    expect(room.participantIds).toHaveLength(2);
    expect(room.createdByOperation).toBe(stage.operationId);
    expect(state.participants.map(person => person.id)).toEqual(room.participantIds);
    expect(state.participants.every(person => person.kind === 'persistent' && person.setupComplete)).toBe(true);
    const mara = state.participants.find(person => person.displayName === 'Mara');
    expect(mara?.personaText).toContain('patient gardener');
    const membership = await journal.readSeaProjection(room.id);
    expect(membership.map(event => event.type)).toEqual(['membership', 'membership']);
    const again = await director.activateScenario(stage.operationId);
    expect(again.id).toBe(room.id);
    expect((await world.getWorldState()).rooms).toHaveLength(1);
  });

  it('compiles persistent scenario state per person through the shared compiler', async () => {
    const stage = await director.prepareScenario({ ...request, scope: 'persistent' });
    const activated = await director.activateScenario(stage.operationId);
    if (!('participantIds' in activated)) throw new Error('Expected Room');
    const state = await world.getWorldState();
    const room = state.rooms[0];
    const cast = state.participants;
    const contexts = cast.map(participant => compileContext({
      room, participant, participants: cast, seaEvents: [], threadEvents: [],
    }));
    expect(contexts[0].scenario?.goals).toEqual(['Make room for herbs']);
    expect(contexts[1].scenario?.goals).toEqual(['Grow flowers']);
    expect(contexts[0].scenario?.knowledge).toEqual(['The tools need repairing']);
    expect(contexts[1].scenario?.knowledge).toEqual([]);
    expect(contexts[0].scenario?.sharedFacts).toEqual(['A shared garden needs a plan.']);
    expect(JSON.stringify(contexts)).not.toContain(request.intent);
    // roster lookup for the turn engine resolves the new permanent people
    expect(room.participantIds).toEqual(cast.map(person => person.id));
  });

  it('keeps persistent intent in Sea and retains the situation on ordinary Room return', async () => {
    const stage = await director.prepareScenario({ ...request, scope: 'persistent' });
    const activated = await director.activateScenario(stage.operationId);
    const state = await world.getWorldState();
    const room = state.rooms[0];
    const user = await journal.appendEvent(room.id, { roomId: room.id, scope: { kind: 'sea' },
      actorId: 'user', type: 'message.user', witnesses: ['user', ...room.participantIds], payload: { text: 'Mara, what should we grow?' } });
    const result = await runRoomTurn({ room, participants: state.participants,
      ...('participantIds' in activated ? {} : { thread: activated }),
      seaEvents: await journal.readSeaProjection(room.id), threadEvents: [user],
      runAgentTurn: async () => ({ text: 'Some herbs.' }), appendEvent: draft => journal.appendEvent(room.id, draft), maxCharacterExchanges: 0 });
    expect(result.events[0].scope).toEqual({ kind: 'sea' });
    vi.resetModules();
    const reloaded = await (await import('./worldStore')).loadWorld();
    const context = compileContext({ room: reloaded.rooms[0], participant: reloaded.participants[0],
      participants: reloaded.participants, seaEvents: await journal.readSeaProjection(room.id) });
    expect(context.scenario?.goals).toEqual(['Make room for herbs']);
    expect(reloaded.threads).toEqual([]);
  });

  it('uses the current Room roster without rewriting historical witnesses or sharing private scenario knowledge', async () => {
    const stage = await director.prepareScenario({ ...request, scope: 'persistent' });
    await director.activateScenario(stage.operationId);
    const state = await world.getWorldState(), room = state.rooms[0];
    const [mara, eli] = state.participants;
    const first = await journal.appendEvent(room.id, { roomId: room.id, scope: { kind: 'sea' }, type: 'message.user',
      actorId: 'user', witnesses: ['user', mara.id, eli.id], payload: { text: 'Welcome both.' } });
    await world.applyMembership(room.id, mara.id, 'remove');
    const reloaded = await world.getWorldState();
    const currentRoom = reloaded.rooms[0];
    const user = await journal.appendEvent(room.id, { roomId: room.id, scope: { kind: 'sea' }, type: 'message.user',
      actorId: 'user', witnesses: ['user', ...currentRoom.participantIds], payload: { text: 'Eli, what do you want to grow?' } });
    const run = vi.fn(async (id, context) => {
      expect(id).toBe(eli.id); expect(context.scenario.goals).toEqual(['Grow flowers']);
      expect(JSON.stringify(context)).not.toContain('The tools need repairing');
      return { text: 'Flowers.' };
    });
    const result = await runRoomTurn({ room: currentRoom, participants: reloaded.participants,
      seaEvents: await journal.readSeaProjection(room.id), threadEvents: [user], runAgentTurn: run,
      appendEvent: draft => journal.appendEvent(room.id, draft), maxCharacterExchanges: 0 });
    expect(run).toHaveBeenCalledOnce();
    expect(result.events[0].witnesses).toEqual([eli.id, 'user']);
    expect((await journal.readSeaProjection(room.id)).find(event => event.id === first.id)?.witnesses).toEqual(['user', mara.id, eli.id]);
    expect(reloaded.participants.map(person => person.id)).toEqual([mara.id, eli.id]);
  });

  it('adds a selected existing person to the persistent roster without rewriting their identity', async () => {
    const person = await world.createParticipant({ displayName: 'Sam', kind: 'persistent', personaText: 'Original' });
    const spec = proposal();
    const raw = { ...spec, participants: [{ kind: 'existing', participantId: person.id }, ...spec.participants] };
    completion.mockResolvedValue(JSON.stringify(raw));
    const input = { ...request, scope: 'persistent' as const, participantIds: [person.id] };
    await director.prepareScenario(input);
    const thread = await director.activateScenario(input.operationId);
    const state = await world.getWorldState();
    const room = state.rooms[0];
    expect(room.participantIds).toContain(person.id);
    expect(room.participantIds).toHaveLength(3);
    expect(thread.id).toBe(room.id);
    expect(state.participants.find(candidate => candidate.id === person.id)?.personaText).toBe('Original');
  });

  it('leaves no permanent topology when a persistent proposal fails validation', async () => {
    const bad = proposal(); bad.participants[0].localId = 'user';
    completion.mockResolvedValueOnce(JSON.stringify(bad));
    await expect(director.prepareScenario({ ...request, scope: 'persistent' })).rejects.toThrow(/identity/);
    const state = await world.getWorldState();
    expect(state.rooms).toEqual([]); expect(state.participants).toEqual([]); expect(state.threads).toEqual([]);
    expect(state.scenarioCreations?.[0].status).toBe('failed');
  });

  it('survives service reload and refuses activation when a selected baseline changed', async () => {
    const person = await world.createParticipant({ displayName: 'Sam', kind: 'persistent', personaText: 'Original' });
    const spec = proposal();
    const raw = { ...spec, participants: [{ kind: 'existing', participantId: person.id }, ...spec.participants] };
    completion.mockResolvedValue(JSON.stringify(raw));
    const input = { ...request, participantIds: [person.id] };
    await director.prepareScenario(input);
    vi.resetModules(); director = await import('./scenarioDirector');
    await director.prepareScenario(input);
    expect(completion).toHaveBeenCalledTimes(1);
    await world.updateParticipant({ ...person, personaText: 'Changed' });
    await expect(director.activateScenario(input.operationId)).rejects.toThrow(/changed/);
    expect((await world.getWorldState()).threads).toEqual([]);
  });
});
