import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTempDir, type TempDir } from '../../../test/helpers/tempDir';
import { DEFAULT_SETTINGS } from '../../shared/types';
import { compileContext } from '../../shared/contextCompiler';
import { authoritativeScenario } from '../../shared/scenarioState';
import { sandboxContext, threadParticipants } from '../../shared/world';
import type { JournalEvent, Participant, ScenarioSpec, Thread } from '../../shared/world';
import { runRoomTurn } from '../../shared/roomOrchestrator';

let temp: TempDir;
const completion = vi.fn();
vi.mock('electron', () => ({ app: { getPath: () => '/tmp/test', isPackaged: false }, ipcMain: { handle: vi.fn() } }));
vi.mock('../utils/platform', () => ({ getUserDataPath: () => temp.tmpDir }));
vi.mock('./llmRouter', () => ({ completeJob: completion }));
const consent = { livingWorld: true };
vi.mock('./settings', () => ({ loadSettings: () => ({ ...DEFAULT_SETTINGS, llmProvider: 'ollama', livingWorldEnabled: consent.livingWorld }) }));
vi.mock('./windowManager', () => ({ openManagedChildWindow: vi.fn() }));
vi.mock('./dreamerRuntime', () => ({
  consolidateRoom: vi.fn(),
  consolidateContext: vi.fn(async () => undefined),
  cancelMaintenanceContext: vi.fn(),
  reconcilePendingMaintenance: vi.fn(async () => undefined),
}));

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
  consent.livingWorld = true;
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

  it('does not publish persistent scenario preparation after consent is revoked', async () => {
    completion.mockImplementation(async () => { consent.livingWorld = false; return JSON.stringify(proposal()); });
    await expect(director.prepareScenario({ ...request, scope: 'persistent' })).rejects.toThrow(/Living World is disabled/);
    expect((await world.getWorldState()).scenarioCreations?.[0].status).toBe('failed');
    expect((await world.getWorldState()).rooms).toEqual([]);
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

  it('requires Living World consent to prepare or activate a persistent scenario', async () => {
    // A ready persistent operation is staged while consent holds…
    const stage = await director.prepareScenario({ ...request, scope: 'persistent' });
    expect(stage.status).toBe('ready');
    // …then withdrawn: further persistent preparation is refused at request time.
    consent.livingWorld = false;
    await expect(director.prepareScenario({ ...request, operationId: 'second-scene', scope: 'persistent' }))
      .rejects.toThrow(/Living World is disabled/);
    // Activating the already-staged ready operation is refused before any
    // Room or permanent cast topology is published.
    await expect(director.activateScenario(stage.operationId)).rejects.toThrow(/Living World is disabled/);
    const state = await world.getWorldState();
    expect(state.rooms).toEqual([]); expect(state.participants).toEqual([]); expect(state.threads).toEqual([]);
    expect(state.scenarioCreations).toHaveLength(1);
    expect(state.scenarioCreations?.[0]).toMatchObject({ operationId: stage.operationId, status: 'ready' });
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

describe('Director persistent scenario evolution', () => {
  interface EvolvedRefs { thread: Thread; cast: Participant[]; roomId: string }
  const policy = { kind: 'local' as const, isPermitted: () => true, prefer: () => true };
  const threadContext = (thread: EvolvedRefs['thread']) => ({ roomId: thread.id, scopeKind: 'thread' as const, threadId: thread.id });
  async function activatedSandbox(): Promise<EvolvedRefs> {
    const thread = await director.activateScenario((await director.prepareScenario(request)).operationId);
    if ('participantIds' in thread) throw new Error('Expected sandbox');
    const cast = threadParticipants(thread, []);
    return { thread, cast, roomId: thread.id };
  }
  const threadMessage = (thread: Thread, text: string, witnesses: string[], payload: Record<string, unknown> = {}): Promise<JournalEvent> =>
    journal.appendEvent(thread.id, { roomId: thread.id, scope: { kind: 'thread', threadId: thread.id }, actorId: 'user', type: 'message.user', witnesses, payload: { text, ...payload } });
  const castWitnesses = (cast: EvolvedRefs['cast']): string[] => ['user', ...cast.map(person => person.id)];
  /** llmFn that answers with a proposal citing the live shared-window event ids and development ids from the prompt. */
  const citing = (propose: (window: { eventIds: string[]; developmentIds: string[]; status?: string }) => unknown) =>
    async (prompt: string): Promise<string> => {
      const parsed = JSON.parse(prompt) as { events: { id: string }[]; situation: { developments: { id: string }[]; status?: string } };
      return JSON.stringify(propose({
        eventIds: parsed.events.map(event => event.id),
        developmentIds: parsed.situation.developments.map(dev => dev.id),
        status: parsed.situation.status,
      }));
    };
  const evolvedScenario = async (roomId: string): Promise<ScenarioSpec> => {
    const scenario = (await world.getWorldState()).threads.find(item => item.id === roomId)?.scenario;
    if (!scenario) throw new Error('Expected an evolved scenario');
    return scenario;
  };
  const evolvedRows = async (roomId: string): Promise<JournalEvent[]> =>
    (await journal.readThread(roomId, roomId)).filter(event => event.type === 'scenario_evolved');

  it.each([
    { participantId: 'A', add: ['New goal'], remove: [] },
    { participantId: 'A', add: 'New goal', remove: [], sourceEventIds: ['source'] },
  ])('rejects uncited or malformed goal deltas instead of normalizing them', update => {
    expect(() => director.parseEvolutionProposal(JSON.stringify({ developments: [], goalUpdates: [update],
      retractions: [], concluded: null, reopened: null }), new Set(['A']))).toThrow();
  });

  it('blocks direct evolution with consent off', async () => {
    const { thread, cast } = await activatedSandbox();
    await threadMessage(thread, 'We have a plan.', castWitnesses(cast));
    consent.livingWorld = false;
    const llmFn = vi.fn(citing(({ eventIds }) => ({ developments: [], goalUpdates: [], retractions: [],
      concluded: { text: 'Plan complete.', sourceEventIds: eventIds }, reopened: null })));
    await director.evolveScenario(threadContext(thread), { policy, llmFn });
    expect(llmFn).not.toHaveBeenCalled();
    expect(await evolvedRows(thread.id)).toEqual([]);
  });

  it('keeps private goals out of the shared evolution model context', async () => {
    const { thread, cast } = await activatedSandbox();
    await threadMessage(thread, 'Hello.', castWitnesses(cast));
    const prompts: string[] = [];
    await director.evolveScenario(threadContext(thread), { policy, llmFn: async prompt => {
      prompts.push(prompt);
      return JSON.stringify({ developments: [], goalUpdates: [], retractions: [], concluded: null, reopened: null });
    } });
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).not.toContain('Make room for herbs');
    expect(prompts[0]).not.toContain('Grow flowers');
  });

  it('does not expose pre-join developments to shared evolution after a new person joins', async () => {
    const activated = await director.activateScenario((await director.prepareScenario({ ...request, scope: 'persistent' })).operationId);
    if (!('participantIds' in activated)) throw new Error('Expected Room');
    const context = { roomId: activated.id, scopeKind: 'sea' as const };
    const first = await journal.appendEvent(activated.id, { roomId: activated.id, scope: { kind: 'sea' }, type: 'message.user',
      actorId: 'user', witnesses: ['user', ...activated.participantIds], payload: { text: 'AB_ONLY_SOURCE' } });
    await director.evolveScenario(context, { policy, llmFn: async () => JSON.stringify({
      developments: [{ text: 'AB_ONLY_INTERPRETATION', kind: 'progress', sourceEventIds: [first.id] }],
      goalUpdates: [], retractions: [], concluded: null, reopened: null }) });
    const newcomer = await world.createParticipant({ displayName: 'C', kind: 'persistent', personaText: 'New arrival' });
    await world.applyMembership(activated.id, newcomer.id, 'add');
    await journal.appendEvent(activated.id, { roomId: activated.id, scope: { kind: 'sea' }, type: 'message.user',
      actorId: 'user', witnesses: ['user', ...activated.participantIds, newcomer.id], payload: { text: 'Hello C' } });
    const prompts: string[] = [];
    await director.evolveScenario(context, { policy, llmFn: async prompt => {
      prompts.push(prompt);
      return JSON.stringify({ developments: [], goalUpdates: [], retractions: [], concluded: null, reopened: null });
    } });
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).not.toContain('AB_ONLY');
  });

  it('evolves a sandbox scenario from real events with validated identities and private goal deltas', async () => {
    const { thread, cast } = await activatedSandbox();
    const targetId = cast[0].id;
    const message = await threadMessage(thread, 'the seeds are in.', castWitnesses(cast));

    await director.evolveScenario(threadContext(thread), { policy, llmFn: citing(({ eventIds }) => ({
      developments: [{ text: 'Mara repaired the shared tools.', kind: 'progress', sourceEventIds: eventIds }],
      goalUpdates: [{ participantId: targetId, add: ['Plan the herb beds'], remove: [], sourceEventIds: eventIds }],
      retractions: [], concluded: null, reopened: null,
    })), now: 123 });

    const evolved = await evolvedScenario(thread.id);
    expect(evolved.developments?.map(dev => dev.text)).toEqual(['Mara repaired the shared tools.']);
    expect(evolved.developments?.[0].sourceEventIds).toEqual([message.id]);
    expect(evolved.developments?.[0].kind).toBe('progress');
    // Goal deltas append; base goals are never mutated in place.
    const change = evolved.goalChanges?.[0];
    expect(change).toMatchObject({ participantId: targetId, add: ['Plan the herb beds'], remove: [], sourceEventIds: [message.id] });
    expect(evolved.participants.find(item => item.kind === 'temporary' && item.localId === targetId)?.profile.goals).toEqual(['Make room for herbs']);
    expect(evolved.status).toBe('active');
    const stream = await journal.readThread(thread.id, thread.id);
    const current = authoritativeScenario(evolved, stream);
    expect(current.currentGoals[targetId]).toContain('Plan the herb beds');
    const newcomer = { ...cast[0], id: 'newcomer' };
    const newcomerContext = compileContext({ participant: newcomer, participants: [...cast, newcomer], seaEvents: [],
      room: { id: 'later-room', title: 'Later', createdAt: 1, participantIds: [...cast.map(person => person.id), newcomer.id], scenario: evolved } });
    expect(newcomerContext.scenario?.developments).toEqual([]);

    // The goal delta is private state: the other cast member's compiled
    // context (including the witnessed journal payload) never sees it.
    const other = cast.find(person => person.id !== targetId)!;
    const otherContext = compileContext({ participant: other, participants: cast, thread: { ...thread, scenario: evolved }, seaEvents: [] });
    expect(JSON.stringify(otherContext)).not.toContain('Plan the herb beds');
    const events = await evolvedRows(thread.id);
    expect(events).toHaveLength(1);
    expect(events[0].payload).toMatchObject({ sourceEventIds: [message.id] });
    expect(JSON.stringify(events[0].payload)).not.toContain('Plan the herb beds');
    // The window is sealed: an immediate second pass proposes nothing new.
    await director.evolveScenario(threadContext(thread), { policy, llmFn: async () => { throw new Error('no inference expected'); }, now: 200 });
  });

  it('rejects goal updates for unknown participants and commits nothing', async () => {
    const { thread, cast } = await activatedSandbox();
    await threadMessage(thread, 'the seeds are in.', castWitnesses(cast));
    await director.evolveScenario(threadContext(thread), { policy, llmFn: citing(({ eventIds }) => ({
      developments: [{ text: 'Mara repaired the shared tools.', kind: 'progress', sourceEventIds: eventIds }],
      goalUpdates: [{ participantId: 'mara', add: ['Plan the herb beds'], remove: [], sourceEventIds: eventIds }],
      retractions: [], concluded: null, reopened: null,
    })), now: 123 });

    const state = await world.getWorldState();
    // Nothing was committed: a never-evolved scenario stores no normalization.
    expect(state.threads.find(item => item.id === thread.id)?.scenario?.goalChanges).toBeUndefined();
    expect(await evolvedRows(thread.id)).toEqual([]);
  });

  it('concludes a situation durably with cited resolution consumed by the compiler', async () => {
    const { thread, cast } = await activatedSandbox();
    const message = await threadMessage(thread, 'we finished the plan.', castWitnesses(cast));
    await director.evolveScenario(threadContext(thread), { policy, llmFn: citing(({ eventIds }) => ({
      developments: [], goalUpdates: [], retractions: [],
      concluded: { text: 'The neighbors agreed on a shared plan.', sourceEventIds: eventIds }, reopened: null,
    })), now: 123 });

    const evolved = await evolvedScenario(thread.id);
    expect(evolved.status).toBe('concluded');
    expect(evolved.developments).toHaveLength(1);
    expect(evolved.developments?.[0]).toMatchObject({ kind: 'resolution', text: 'The neighbors agreed on a shared plan.', sourceEventIds: [message.id] });
    const contexts = cast.map(person => compileContext({ participant: person, participants: cast, thread: { ...thread, scenario: evolved }, seaEvents: [] }));
    expect(contexts.every(context => context.scenario?.concluded === true)).toBe(true);
    // Without new events no window forms: no further inference, even though a
    // concluded situation stays locatable for reopen/retraction.
    await director.evolveScenario(threadContext(thread), { policy, llmFn: async () => { throw new Error('no inference expected'); }, now: 300 });
  });

  it('reconciles correction tombstones: the invalidated development leaves the live scenario while history stays put', async () => {
    const { thread, cast } = await activatedSandbox();
    // Production message payloads have text, not a synthetic memory owner.
    const message = await threadMessage(thread, 'the seeds are in.', castWitnesses(cast));
    await director.evolveScenario(threadContext(thread), { policy, llmFn: citing(({ eventIds }) => ({
      developments: [{ text: 'Mara repaired the shared tools.', kind: 'progress', sourceEventIds: eventIds }],
      goalUpdates: [], retractions: [], concluded: null, reopened: null,
    })), now: 123 });
    const historyBefore = await evolvedRows(thread.id);
    expect(historyBefore).toHaveLength(1);

    await journal.appendEvent(thread.id, { roomId: thread.id, scope: { kind: 'thread', threadId: thread.id },
      type: 'correction', actorId: 'user', witnesses: ['user'], payload: { ownerId: 'user', targetId: message.id } });
    const streamBefore = await journal.readThread(thread.id, thread.id);

    // Correction is pure derivation: no write, no inference, no window.
    await director.evolveScenario(threadContext(thread), { policy, llmFn: async () => { throw new Error('no inference expected'); }, now: 200 });

    // The stored chain is never rewritten: the invalidated development stays
    // in the durable spec exactly as evolution wrote it, and the derivation
    // returns that stored spec untouched.
    const corrected = await evolvedScenario(thread.id);
    expect(corrected.developments).toHaveLength(1);
    const stream = await journal.readThread(thread.id, thread.id);
    const current = authoritativeScenario(corrected, stream);
    expect(current.spec).toEqual(corrected);
    // The current view drops the invalidated development and stays active.
    expect(current.developments).toEqual([]);
    expect(current.status).toBe('active');
    // Journal history untouched: the pre-existing row is present and unmodified, and the correction added no scenario rows.
    expect(stream.filter(event => event.type === 'scenario_evolved')).toEqual(historyBefore);
    expect(stream).toEqual(streamBefore);
  });

  it('reopens a concluded situation when a correction tombstones the conclusion sources', async () => {
    const { thread, cast } = await activatedSandbox();
    const conclusion = await threadMessage(thread, 'we finished the plan.', castWitnesses(cast));
    await director.evolveScenario(threadContext(thread), { policy, llmFn: citing(({ eventIds }) => ({
      developments: [], goalUpdates: [], retractions: [],
      concluded: { text: 'The neighbors agreed on a shared plan.', sourceEventIds: eventIds }, reopened: null,
    })), now: 123 });
    expect((await evolvedScenario(thread.id)).status).toBe('concluded');

    await journal.appendEvent(thread.id, { roomId: thread.id, scope: { kind: 'thread', threadId: thread.id },
      type: 'correction', actorId: 'user', witnesses: ['user'], payload: { ownerId: 'user', targetId: conclusion.id } });
    await director.evolveScenario(threadContext(thread), { policy, llmFn: async () => { throw new Error('no inference expected'); }, now: 200 });

    // The stored chain is never rewritten: the conclusion and its concluded
    // status remain exactly as evolution wrote them.
    const corrected = await evolvedScenario(thread.id);
    expect(corrected.status).toBe('concluded');
    expect(corrected.developments?.map(dev => dev.kind)).toEqual(['resolution']);
    // The derived view reopens: with the conclusion's sources tombstoned the
    // situation is active and no development stands.
    const current = authoritativeScenario(corrected, await journal.readThread(thread.id, thread.id));
    expect(current.status).toBe('active');
    expect(current.developments).toEqual([]);
    expect(await evolvedRows(thread.id)).toHaveLength(1); // the conclusion row stays as history
  });

  it('retracts a wrong premise from a later real event without appending contradictions', async () => {
    const { thread, cast } = await activatedSandbox();
    await threadMessage(thread, 'the seeds are in.', castWitnesses(cast));
    await director.evolveScenario(threadContext(thread), { policy, llmFn: citing(({ eventIds }) => ({
      developments: [{ text: 'Mara decided to give up the garden.', kind: 'complication', sourceEventIds: eventIds }],
      goalUpdates: [], retractions: [], concluded: null, reopened: null,
    })), now: 123 });
    const later = await threadMessage(thread, 'Actually Mara doubled the garden beds today.', castWitnesses(cast));

    await director.evolveScenario(threadContext(thread), { policy, llmFn: citing(({ eventIds, developmentIds }) => ({
      developments: [], goalUpdates: [],
      retractions: [{ developmentId: developmentIds[0], text: 'The premise that Mara gave up was wrong: she expanded the garden instead.', sourceEventIds: eventIds }],
      concluded: null, reopened: null,
    })), now: 456 });

    const stored = await evolvedScenario(thread.id);
    // Both history entries are kept; no contradictory development was appended.
    expect(stored.developments?.map(dev => dev.text)).toEqual(['Mara decided to give up the garden.']);
    expect(stored.retractions).toHaveLength(1);
    expect(stored.retractions?.[0]).toMatchObject({ developmentId: stored.developments?.[0].id, sourceEventIds: [later.id] });
    expect(stored.status).toBe('active');
    const current = authoritativeScenario(stored, await journal.readThread(thread.id, thread.id));
    expect(current.developments).toEqual([]); // the premise left the current view
    expect(await evolvedRows(thread.id)).toHaveLength(2);
  });

  it('reopens a concluded situation from post-conclusion events while retaining the conclusion history', async () => {
    const { thread, cast } = await activatedSandbox();
    await threadMessage(thread, 'we finished the plan.', castWitnesses(cast));
    await director.evolveScenario(threadContext(thread), { policy, llmFn: citing(({ eventIds }) => ({
      developments: [], goalUpdates: [], retractions: [],
      concluded: { text: 'The neighbors agreed on a shared plan.', sourceEventIds: eventIds }, reopened: null,
    })), now: 123 });
    const later = await threadMessage(thread, 'The city sent a new grant offer for the garden.', castWitnesses(cast));

    await director.evolveScenario(threadContext(thread), { policy, llmFn: citing(({ eventIds }) => ({
      developments: [], goalUpdates: [], retractions: [], concluded: null,
      reopened: { text: 'A new grant offer makes the garden plan relevant again.', sourceEventIds: eventIds },
    })), now: 456 });

    const stored = await evolvedScenario(thread.id);
    expect(stored.status).toBe('active');
    expect(stored.developments?.map(dev => dev.kind)).toEqual(['resolution', 'reopen']);
    expect(stored.developments?.[0].text).toBe('The neighbors agreed on a shared plan.'); // conclusion retained in history
    expect(stored.developments?.[1]).toMatchObject({ sourceEventIds: [later.id] });
    const current = authoritativeScenario(stored, await journal.readThread(thread.id, thread.id));
    expect(current.spec.status).toBe('active');
    expect(current.developments).toHaveLength(2);
    expect(await evolvedRows(thread.id)).toHaveLength(2);
  });

  it('applies goal deltas to existing participants without touching their base goals', async () => {
    const person = await world.createParticipant({ displayName: 'Sam', kind: 'persistent', personaText: 'Original' });
    const spec = proposal();
    completion.mockResolvedValue(JSON.stringify({ ...spec, participants: [{ kind: 'existing', participantId: person.id }, ...spec.participants] }));
    const input = { ...request, scope: 'persistent' as const, participantIds: [person.id] };
    await director.prepareScenario(input);
    const room = await director.activateScenario(input.operationId);
    if (!('participantIds' in room)) throw new Error('Expected Room');
    const message = await journal.appendEvent(room.id, { roomId: room.id, scope: { kind: 'sea' }, type: 'message.user',
      actorId: 'user', witnesses: ['user', ...room.participantIds], payload: { text: 'Sam, the fence needs fixing before winter.' } });

    await director.evolveScenario({ roomId: room.id, scopeKind: 'sea' }, { policy, llmFn: citing(({ eventIds }) => ({
      developments: [{ text: 'The fence repair became urgent.', kind: 'complication', sourceEventIds: eventIds }],
      goalUpdates: [{ participantId: person.id, add: ['Fix the fence before winter'], remove: [], sourceEventIds: eventIds }],
      retractions: [], concluded: null, reopened: null,
    })), now: 123 });

    const state = await world.getWorldState();
    const liveRoom = state.rooms.find(item => item.id === room.id)!;
    const stored = liveRoom.scenario!;
    expect(stored.goalChanges).toHaveLength(1);
    expect(stored.goalChanges?.[0]).toMatchObject({ participantId: person.id, add: ['Fix the fence before winter'], remove: [], sourceEventIds: [message.id] });
    // The existing person's scenario ref is untouched: no base-goal write.
    expect(stored.participants.find(item => item.kind === 'existing' && item.participantId === person.id)).toEqual({ kind: 'existing', participantId: person.id });
    const stream = await journal.readSeaProjection(room.id);
    const current = authoritativeScenario(stored, stream);
    expect(current.currentGoals[person.id]).toEqual(['Fix the fence before winter']);
    // The compiler consumes the same derivation, so the delta would surface there too.
    expect(current.currentGoals[person.id]).toEqual(compileContext({ room: liveRoom, participant: { id: person.id, displayName: 'Sam', kind: 'persistent', personaText: 'Original', setupComplete: true },
      participants: [], seaEvents: stream }).scenario?.goals);
    // The goal delta stays out of the witnessed journal payload.
    const rows = stream.filter(event => event.type === 'scenario_evolved');
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows[0].payload)).not.toContain('Fix the fence before winter');
  });

  it('rejects a fact-kind proposal as bounded invalid attempts and commits nothing', async () => {
    const { thread, cast } = await activatedSandbox();
    await threadMessage(thread, 'the seeds are in.', castWitnesses(cast));
    let calls = 0;
    await director.evolveScenario(threadContext(thread), { policy, llmFn: citing(({ eventIds }) => {
      calls++;
      return { developments: [{ text: 'Mara planted seeds.', kind: 'fact', sourceEventIds: eventIds }], goalUpdates: [], retractions: [], concluded: null, reopened: null };
    }), now: 123 });

    expect(calls).toBe(3); // MAX_MAINTENANCE_ATTEMPTS: the window closes honestly
    const stored = await evolvedScenario(thread.id);
    // Nothing was committed: the stored scenario keeps its intact prepared shape.
    expect(stored.developments).toBeUndefined();
    expect(stored.goalChanges).toBeUndefined();
    expect(await evolvedRows(thread.id)).toEqual([]);
    expect((await world.getWorldState()).reflectionRuns?.at(-1)).toMatchObject({ kind: 'scenario', status: 'failed' });
  });

  it('rejects citations outside the shared window and commits nothing', async () => {
    const { thread, cast } = await activatedSandbox();
    await threadMessage(thread, 'the seeds are in.', castWitnesses(cast));
    let calls = 0;
    await director.evolveScenario(threadContext(thread), { policy, llmFn: citing(() => {
      calls++;
      return { developments: [{ text: 'Mara repaired the shared tools.', kind: 'progress', sourceEventIds: ['evt_outside'] }], goalUpdates: [], retractions: [], concluded: null, reopened: null };
    }), now: 123 });

    expect(calls).toBe(3);
    expect((await evolvedScenario(thread.id)).developments).toBeUndefined();
    expect(await evolvedRows(thread.id)).toEqual([]);
  });

  it('rejects retractions of unknown developments and commits nothing', async () => {
    const { thread, cast } = await activatedSandbox();
    await threadMessage(thread, 'the seeds are in.', castWitnesses(cast));
    let calls = 0;
    await director.evolveScenario(threadContext(thread), { policy, llmFn: citing(({ eventIds }) => {
      calls++;
      return { developments: [], goalUpdates: [], retractions: [{ developmentId: 'dev_missing', text: 'Retracting something that never existed.', sourceEventIds: eventIds }], concluded: null, reopened: null };
    }), now: 123 });

    expect(calls).toBe(3);
    const stored = await evolvedScenario(thread.id);
    // Nothing was committed: the stored scenario keeps its intact prepared shape.
    expect(stored.developments).toBeUndefined();
    expect(stored.retractions).toBeUndefined();
    expect(await evolvedRows(thread.id)).toEqual([]);
  });

  it('keeps scenario and history unpublished on journal failure, then recovers once', async () => {
    const { thread, cast } = await activatedSandbox();
    await threadMessage(thread, 'The garden plan is settled.', castWitnesses(cast));
    const fs = await import('fs');
    const original = fs.promises.appendFile.bind(fs.promises);
    const fail = vi.spyOn(fs.promises, 'appendFile').mockImplementation(async (...args) => {
      if (String(args[1]).includes('"type":"consolidation"')) throw new Error('injected marker failure');
      return original(...args);
    });
    const llmFn = async (prompt: string) => {
      // Directional relationship state is still never shared generation input.
      expect(prompt).not.toContain('Unsure about reliability');
      const window = JSON.parse(prompt).events.map((event: { id: string }) => event.id);
      return JSON.stringify({ developments: [{ text: 'The user reports the plan is settled.', kind: 'progress', sourceEventIds: window }], goalUpdates: [], retractions: [], concluded: null, reopened: null });
    };
    try {
      await expect(director.evolveScenario(threadContext(thread), { policy, llmFn })).rejects.toThrow('marker failure');
    } finally { fail.mockRestore(); }
    // Nothing was published: the stored scenario stays exactly the prepared,
    // intact spec — recovery compares its pending record against this raw shape.
    expect((await world.getWorldState()).threads[0].scenario).toEqual(thread.scenario);
    // The prepared history row landed before the failed marker append, but it
    // stays unpublished while its run is pending — readers see nothing yet.
    expect((await journal.readThread(thread.id, thread.id)).filter(event => event.provenance?.reflectionId)).toEqual([]);
    await director.reconcilePendingScenarioEvolutions();
    await director.reconcilePendingScenarioEvolutions();
    const state = await world.getWorldState();
    expect(state.threads[0].scenario?.developments).toHaveLength(1);
    expect(state.reflectionRuns?.[0].status).toBe('committed');
    expect((await journal.readThread(thread.id, thread.id)).filter(event => event.type === 'scenario_evolved')).toHaveLength(1);
  });

  it('keeps the stored chain through conclude, reopen and retraction while the derived view follows', async () => {
    const { thread, cast } = await activatedSandbox();
    const view = async () => authoritativeScenario(await evolvedScenario(thread.id), await journal.readThread(thread.id, thread.id));

    const settled = await threadMessage(thread, 'we finished the plan.', castWitnesses(cast));
    await director.evolveScenario(threadContext(thread), { policy, llmFn: citing(({ eventIds }) => ({
      developments: [], goalUpdates: [], retractions: [],
      concluded: { text: 'The neighbors agreed on a shared plan.', sourceEventIds: eventIds }, reopened: null,
    })), now: 123 });
    const d1 = (await evolvedScenario(thread.id)).developments?.[0];
    expect(d1).toMatchObject({ kind: 'resolution', sourceEventIds: [settled.id] });
    expect((await evolvedScenario(thread.id)).status).toBe('concluded');
    expect((await view()).status).toBe('concluded');

    const grant = await threadMessage(thread, 'The city sent a new grant offer for the garden.', castWitnesses(cast));
    await director.evolveScenario(threadContext(thread), { policy, llmFn: citing(({ eventIds }) => ({
      developments: [], goalUpdates: [], retractions: [], concluded: null,
      reopened: { text: 'A new grant offer makes the garden plan relevant again.', sourceEventIds: eventIds },
    })), now: 456 });
    const d2 = (await evolvedScenario(thread.id)).developments?.[1];
    expect(d2).toMatchObject({ kind: 'reopen', sourceEventIds: [grant.id] });
    expect((await evolvedScenario(thread.id)).status).toBe('active');
    // The conclusion is retained history; the stored status reopened, so the
    // valid resolution no longer concludes the situation.
    expect((await view()).developments.map(dev => dev.id)).toEqual([d1!.id, d2!.id]);
    expect((await view()).status).toBe('active');

    const withdrawn = await threadMessage(thread, 'Actually the grant offer was withdrawn today.', castWitnesses(cast));
    await director.evolveScenario(threadContext(thread), { policy, llmFn: citing(({ eventIds }) => ({
      developments: [], goalUpdates: [],
      retractions: [{ developmentId: d2!.id, text: 'The grant offer was withdrawn; the reopen premise was wrong.', sourceEventIds: eventIds }],
      concluded: null, reopened: null,
    })), now: 789 });

    const stored = await evolvedScenario(thread.id);
    // D2 leaves the current view but stays in the stored chain; the retraction
    // is an ordinary pass, so the derived active status is re-stamped.
    expect(stored.developments?.map(dev => dev.id)).toEqual([d1!.id, d2!.id]);
    expect(stored.retractions).toHaveLength(1);
    expect(stored.retractions?.[0]).toMatchObject({ developmentId: d2!.id, sourceEventIds: [withdrawn.id] });
    expect(stored.status).toBe('active');
    const current = await view();
    expect(current.developments.map(dev => dev.id)).toEqual([d1!.id]);
    expect(current.retractions).toHaveLength(1);
    // Retracting the reopening restores the preceding valid conclusion.
    expect(current.status).toBe('concluded');
    expect(await evolvedRows(thread.id)).toHaveLength(3);
  });
});
