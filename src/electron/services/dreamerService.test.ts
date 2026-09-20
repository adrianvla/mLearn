import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { createTempDir } from '../../../test/helpers/tempDir';
import type { TempDir } from '../../../test/helpers/tempDir';
import type { InferencePolicy, InferencePolicyKind } from '../../shared/inferencePolicy';
import type { JournalEvent, Participant } from '../../shared/world';

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/tmp/test'), isPackaged: false },
  ipcMain: { handle: vi.fn() },
}));

const consent = { enabled: true };
vi.mock('./settings', () => ({ loadSettings: () => ({ livingWorldEnabled: consent.enabled }) }));

let tempDir: TempDir;
vi.mock('../utils/platform', () => ({ getUserDataPath: vi.fn(() => tempDir?.tmpDir ?? '/tmp/test') }));

let dreamer: typeof import('./dreamerService');
let journal: typeof import('./journalService');
let projections: typeof import('./projectionStore');

function policy(kind: InferencePolicyKind, permitted: boolean): Parameters<typeof dreamer.runReflection>[1]['policy'] {
  return {
    kind,
    isPermitted: () => permitted,
    prefer: () => true,
  };
}

function person(id: string, name: string): Participant {
  return { id, displayName: name, kind: 'persistent', personaText: `${name} persona`, setupComplete: true };
}

function seedWorld(world: Record<string, unknown>): void {
  fs.writeFileSync(path.join(tempDir.tmpDir, 'world.json'), JSON.stringify(world));
}

/** Prompt contract the reflection pass assembles (parse target for scripted models). */
interface PromptShape {
  task: string;
  persona: string;
  continuingContext: {
    priorBeliefs: { id: string; text: string; createdAt: number }[];
    openLoops: { loop: number; text: string }[];
  };
  /** Keys name the sections the model may emit; absent resolutions key ⇒ the
   *  owner has no open loops and the contract omits resolutions entirely. */
  outputSchema?: Record<string, unknown>;
  events: { id: string; type: string; actor: string; text?: string; createdAt: number; resolvesLoops?: number[] }[];
}

function parsePrompt(prompt: string): PromptShape {
  return JSON.parse(prompt) as PromptShape;
}

/** The scripted model always cites the newest event it was shown. */
function lastPromptEventId(prompt: string): string {
  const events = parsePrompt(prompt).events;
  return events[events.length - 1].id;
}

function beliefOut(ownerId: string, text: string, sourceEventIds: string[], extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ beliefs: [{ ownerId, kind: 'belief', text, sourceEventIds, ...extra }], resolutions: [] });
}

/** Resolution output names the loop by its 1-based position in the prompt's
 *  openLoops list; canonical code maps that ordinal to the journal id. */
function resolutionOut(ownerId: string, loop: number, sourceEventIds: string[], text = 'resolved'): string {
  return JSON.stringify({ beliefs: [], resolutions: [{ ownerId, loop, status: 'satisfied', text, sourceEventIds }] });
}

function emptyOut(): string {
  return JSON.stringify({ beliefs: [], resolutions: [] });
}

/** loop: 1-based position in the prompt's openLoops list (undefined ⇒ none). */
function validOutput(sourceEventIds: string[], loop?: number): string {
  return JSON.stringify({
    beliefs: [{ ownerId: 'owner', kind: 'belief', text: 'durable conclusion', sourceEventIds }],
    resolutions: loop === undefined
      ? []
      : [{ ownerId: 'owner', loop, status: 'satisfied', text: 'resolved loop', sourceEventIds }],
  });
}

async function seedSea(roomId: string, text = 'sea input', witnesses = ['user', 'owner'], payload: Record<string, unknown> = {}): Promise<JournalEvent> {
  return journal.appendEvent(roomId, {
    roomId,
    scope: { kind: 'sea' },
    type: 'message.user',
    actorId: 'user',
    witnesses,
    payload: { text, ...payload },
  });
}

/** User-authored open-loop row (the remember-this path writes the same shape). */
async function seedOpenLoop(roomId: string, text: string, ownerId = 'owner', sourceEventIds: string[] = []): Promise<JournalEvent> {
  return journal.appendEvent(roomId, {
    roomId,
    scope: { kind: 'sea' },
    type: 'memory.belief',
    actorId: ownerId,
    witnesses: [ownerId],
    payload: { ownerId, kind: 'open-loop', text, sourceEventIds },
  });
}

/** Room context with a one-person cast so reflection has a valid owner. */
function seedRoomWorld(roomId: string, ownerId = 'owner', name = 'Owner'): void {
  seedWorld({ rooms: [{ id: roomId, title: name, participantIds: [ownerId], createdAt: 1 }], threads: [], participants: [person(ownerId, name)] });
}

/** Reflection-derived rows only (provenance-marked interpretations). */
function derivedRows(stream: JournalEvent[]): JournalEvent[] {
  return stream.filter((event) => (event.type === 'memory.belief' || event.type === 'resolution') && event.provenance?.reflectionId !== undefined);
}

async function failedReflectionRunCount(): Promise<number> {
  const worldStore = await import('./worldStore');
  return ((await worldStore.loadWorld()).reflectionRuns ?? []).filter((run) => run.kind === 'reflection' && run.status === 'failed').length;
}

function payloadOf(event: JournalEvent): Record<string, unknown> {
  return event.payload as Record<string, unknown>; // journal rows are self-written JSON; shape checked by assertions below
}

describe('Dreamer service', () => {
  // NOTE: every `await import(...)` below is a deliberate post-`vi.resetModules()`
  // re-import — static imports would bind the pre-reset module instance and read
  // stale module state (journal heads, world caches) across tests.
  beforeEach(async () => {
    consent.enabled = true;
    tempDir = createTempDir();
    vi.resetModules();
    [dreamer, journal, projections] = await Promise.all([
      import('./dreamerService'),
      import('./journalService'),
      import('./projectionStore'),
    ]);
  });

  afterEach(() => tempDir.cleanup());

  it('blocks direct reflection and recovery without consent', async () => {
    seedRoomWorld('consent');
    const source = await seedSea('consent');
    consent.enabled = false;
    const llmFn = vi.fn(async () => validOutput([source.id]));
    await dreamer.runDreamer('consent', { policy: policy('local', true), llmFn });
    await dreamer.reconcilePendingReflections();
    expect(llmFn).not.toHaveBeenCalled();
    expect(derivedRows(await journal.readSeaProjection('consent'))).toEqual([]);
  });

  it('does not publish when consent is revoked during inference', async () => {
    seedRoomWorld('revoked');
    const source = await seedSea('revoked');
    await dreamer.runDreamer('revoked', { policy: policy('local', true), llmFn: async () => {
      consent.enabled = false;
      return validOutput([source.id]);
    } }).catch(() => undefined);
    expect(derivedRows(await journal.readSeaProjection('revoked'))).toEqual([]);
  });

  it('maps ordinals to exactly the bounded prompt list, without exposing loop IDs', async () => {
    seedRoomWorld('ordinal');
    const opener = await seedSea('ordinal', 'question source');
    for (let i = 0; i < 13; i++) await seedOpenLoop('ordinal', `loop ${i}`, 'owner', [opener.id]);
    const source = await seedSea('ordinal', 'later evidence', ['user', 'owner'], { replyToEventId: opener.id });
    let selectedText = '';
    let exposedIds = false;
    let eligibleLoopOrdinals: number[] = [];
    await dreamer.runDreamer('ordinal', { policy: policy('local', true), llmFn: async (prompt) => {
      const parsed = parsePrompt(prompt);
      const loops = parsed.continuingContext.openLoops;
      selectedText = loops[0].text;
      exposedIds = loops.some(loop => 'loopId' in loop);
      eligibleLoopOrdinals = parsed.events.find(event => event.id === source.id)?.resolvesLoops ?? [];
      return resolutionOut('owner', 1, [source.id]);
    } });
    const rows = await journal.readSeaProjection('ordinal');
    const resolution = derivedRows(rows).find(row => row.type === 'resolution')!;
    const target = rows.find(row => row.id === payloadOf(resolution).loopId)!;
    expect(payloadOf(target).text).toBe(selectedText);
    expect(exposedIds).toBe(false);
    expect(eligibleLoopOrdinals).toContain(1);
  });

  it('rejects stale cross-Room loop choices after another Room resolves the target', async () => {
    seedWorld({ rooms: ['a', 'b'].map(id => ({ id, title: id, participantIds: ['owner'], createdAt: 1 })),
      threads: [], participants: [person('owner', 'Owner')] });
    const loop = await seedOpenLoop('a', 'shared personal loop');
    const source = await seedSea('b', 'later evidence');
    await dreamer.runDreamer('b', { policy: policy('local', true), llmFn: async () => {
      await journal.appendEvent('a', { roomId: 'a', scope: { kind: 'sea' }, type: 'resolution',
        actorId: 'owner', witnesses: ['owner'], payload: { ownerId: 'owner', loopId: loop.id,
          status: 'cancelled', text: 'already cancelled', sourceEventIds: [loop.id] } });
      return resolutionOut('owner', 1, [source.id]);
    } }).catch(() => undefined);
    expect(derivedRows(await journal.readSeaProjection('b'))).toEqual([]);
  });

  it('never reaches thread-scoped content', async () => {
    const threadId = 'thread-1';
    seedThreadWorld(threadId);
    await journal.appendEvent(threadId, {
      roomId: threadId,
      scope: { kind: 'thread', threadId: 'thread-1' },
      type: 'message.user',
      actorId: 'user',
      witnesses: ['user'],
      payload: { text: 'THREAD_ONLY_SECRET' },
    });
    const before = await journal.readSeaProjection('room-thread-only');
    const llmFn = vi.fn(async () => validOutput([]));

    await dreamer.runDreamer('room-thread-only', { policy: policy('local', true), llmFn, now: 100 });

    expect(await journal.readSeaProjection('room-thread-only')).toEqual(before);
    expect(llmFn).not.toHaveBeenCalled();
  });

  it('consolidates each Sea window once', async () => {
    const roomId = 'room-idempotent';
    seedRoomWorld(roomId);
    const source = await seedSea(roomId);
    const llmFn = vi.fn(async () => validOutput([source.id]));

    await dreamer.runDreamer(roomId, { policy: policy('local', true), llmFn, now: 100 });
    const once = await journal.readSeaProjection(roomId);
    await dreamer.runDreamer(roomId, { policy: policy('local', true), llmFn, now: 200 });

    expect(await journal.readSeaProjection(roomId)).toEqual(once);
    expect(once.filter((event) => event.type === 'consolidation')).toHaveLength(1);
    expect(llmFn).toHaveBeenCalledTimes(1);
  });

  it('consolidates each person from their own witnessed view only', async () => {
    const roomId = 'room-private';
    seedWorld({
      rooms: [{ id: roomId, title: 'T', participantIds: ['a', 'b'], createdAt: 1 }],
      threads: [],
      participants: [person('a', 'Ava'), person('b', 'Ben')],
    });
    // A private disclosure b never witnessed.
    await journal.appendEvent(roomId, {
      roomId, scope: { kind: 'sea' }, type: 'disclosure', actorId: 'user',
      witnesses: ['a', 'user'], payload: { text: 'AVA_PRIVATE_SECRET' },
    });
    // Shared event so Ben also has a non-empty view (his call stays private).
    await seedSea(roomId, 'shared exchange', ['user', 'a', 'b']);
    let llmCalls = 0;
    const llmFn = vi.fn(async (prompt: string) => {
      // First call is Ava's view (owner order follows the roster); Ben reflects
      // on his own (secret-free) view and contributes nothing.
      llmCalls += 1;
      return llmCalls === 1 ? beliefOut('a', 'noted', [lastPromptEventId(prompt)]) : emptyOut();
    });

    await dreamer.runDreamer(roomId, { policy: policy('local', true), llmFn, now: 100 });

    // Ben's prompt never saw Ava's private disclosure.
    const prompts = llmFn.mock.calls.map((call) => call[0] as string);
    expect(prompts).toHaveLength(2);
    expect(prompts[0]).toContain('AVA_PRIVATE_SECRET');
    expect(prompts[1]).not.toContain('AVA_PRIVATE_SECRET');
    const derived = (await journal.readSeaProjection(roomId)).filter(event => event.type === 'memory.belief');
    expect(derived).toHaveLength(1);
    expect(derived[0].witnesses).toEqual(['a']);
  });

  it('rejects model output referencing identities outside the cast', async () => {
    const roomId = 'room-outside';
    seedRoomWorld(roomId);
    const source = await seedSea(roomId);
    const llmFn = vi.fn(async () => JSON.stringify({
      beliefs: [{ ownerId: 'stranger', kind: 'belief', text: 'fabricated belief', sourceEventIds: [source.id] }],
      resolutions: [],
    }));

    await dreamer.runDreamer(roomId, { policy: policy('local', true), llmFn, now: 100 });

    const derived = (await journal.readSeaProjection(roomId)).filter(event => event.type === 'memory.belief');
    expect(derived).toHaveLength(0);
    // Bounded in-pass retries exhaust and the window closes honestly with an
    // empty marker: repeated invalid output must never become derived rows.
    expect((await journal.readSeaProjection(roomId)).filter(event => event.type === 'consolidation')).toHaveLength(1);
    expect(await failedReflectionRunCount()).toBe(1);
  });

  it('rejects episode/fact kinds: nothing published, window closes honestly after the attempt bound', async () => {
    const roomId = 'room-kinds';
    seedRoomWorld(roomId);
    const source = await seedSea(roomId);
    const llmFn = vi.fn(async () => JSON.stringify({
      beliefs: [{ ownerId: 'owner', kind: 'episode', text: 'an episode row', sourceEventIds: [source.id] }],
      resolutions: [],
    }));

    await dreamer.runDreamer(roomId, { policy: policy('local', true), llmFn, now: 100 });

    let stream = await journal.readSeaProjection(roomId);
    expect(derivedRows(stream)).toHaveLength(0);
    expect(stream.filter(event => event.type === 'consolidation')).toHaveLength(1);
    expect(llmFn).toHaveBeenCalledTimes(3); // MAX_MAINTENANCE_ATTEMPTS, then honest close
    expect(await failedReflectionRunCount()).toBe(1);

    // Same for the lore 'fact' kind in a later window.
    const second = await seedSea(roomId, 'second window input');
    llmFn.mockImplementation(async () => JSON.stringify({
      beliefs: [{ ownerId: 'owner', kind: 'fact', text: 'a lore fact', sourceEventIds: [second.id] }],
      resolutions: [],
    }));
    await dreamer.runDreamer(roomId, { policy: policy('local', true), llmFn, now: 200 });

    stream = await journal.readSeaProjection(roomId);
    expect(derivedRows(stream)).toHaveLength(0);
    expect(stream.filter(event => event.type === 'consolidation')).toHaveLength(2);
  });

  it('reopens a terminal invalid-output window only after an explicit retry request', async () => {
    const roomId = 'room-explicit-retry';
    seedRoomWorld(roomId);
    const source = await seedSea(roomId);
    let response = JSON.stringify({
      beliefs: [{ ownerId: 'owner', kind: 'episode', text: 'invalid occurrence', sourceEventIds: [source.id] }],
      resolutions: [],
    });
    const llmFn = vi.fn(async () => response);
    await dreamer.runDreamer(roomId, { policy: policy('local', true), llmFn, now: 100 });
    const worldStore = await import('./worldStore');
    const failed = (await worldStore.loadWorld()).reflectionRuns?.find(run => run.status === 'failed');
    expect(failed).toBeDefined();

    // Ordinary automatic opportunities skip the sealed terminal window.
    await dreamer.runDreamer(roomId, { policy: policy('local', true), llmFn, now: 200 });
    expect(llmFn).toHaveBeenCalledTimes(3);

    response = validOutput([source.id]);
    await dreamer.requestMaintenanceRetry(failed!.reflectionId);
    await dreamer.runDreamer(roomId, { policy: policy('local', true), llmFn, now: 300 });
    expect(derivedRows(await journal.readSeaProjection(roomId))).toHaveLength(1);
    expect((await worldStore.loadWorld()).reflectionRuns?.filter(run => run.status === 'committed')).toHaveLength(1);
  });

  it('rejects beliefs citing events outside the owner’s witnessed view', async () => {
    const roomId = 'room-citation';
    seedWorld({
      rooms: [{ id: roomId, title: 'T', participantIds: ['a', 'b'], createdAt: 1 }],
      threads: [],
      participants: [person('a', 'Ava'), person('b', 'Ben')],
    });
    const privateEvent = await journal.appendEvent(roomId, {
      roomId, scope: { kind: 'sea' }, type: 'disclosure', actorId: 'user',
      witnesses: ['a', 'user'], payload: { text: 'AVA_PRIVATE_SECRET' },
    });
    await seedSea(roomId, 'shared exchange', ['user', 'a', 'b']);
    // Ava reflects honestly; Ben hallucinates a citation of Ava's private event.
    const llmFn = vi.fn(async (prompt: string) => {
      const owner = parsePrompt(prompt).task.includes('(a)') ? 'a' : 'b';
      return owner === 'a'
        ? beliefOut('a', 'noted', [lastPromptEventId(prompt)])
        : beliefOut('b', 'i definitely saw it', [privateEvent.id]);
    });

    await dreamer.runDreamer(roomId, { policy: policy('local', true), llmFn, now: 100 });

    // Ben's invalid citation rejects the whole attempt; the bound exhausts and
    // the window closes honestly — nothing is published, not even Ava's valid row.
    const stream = await journal.readSeaProjection(roomId);
    expect(derivedRows(stream)).toHaveLength(0);
    expect(stream.filter(event => event.type === 'consolidation')).toHaveLength(1);
    expect(await failedReflectionRunCount()).toBe(1);
  });

  it('rejects resolutions naming unknown, foreign-owner, or already-closed loops', async () => {
    const roomId = 'room-loopguard';
    seedRoomWorld(roomId);
    // Another person's open loop lives in the room's Sea history alongside the
    // reflecting owner's own loop.
    await journal.appendEvent(roomId, {
      roomId, scope: { kind: 'sea' }, type: 'memory.belief', actorId: 'other', witnesses: ['other'],
      payload: { ownerId: 'other', kind: 'open-loop', text: 'FOREIGN_LOOP', sourceEventIds: [] },
    });
    const mine = await seedOpenLoop(roomId, 'MY_LOOP');
    let respond = (prompt: string): string => resolutionOut('owner', 99, [lastPromptEventId(prompt)]);
    const llmFn = vi.fn(async (prompt: string) => respond(prompt));
    const run = (now: number) => dreamer.runDreamer(roomId, { policy: policy('local', true), llmFn, now });

    // Out-of-range ordinal: no listed loop sits at position 99 — the attempt
    // bound exhausts, the window seals, nothing is published.
    await run(100);
    expect(derivedRows(await journal.readSeaProjection(roomId))).toHaveLength(0);
    expect((await journal.readSeaProjection(roomId)).filter(event => event.type === 'consolidation')).toHaveLength(1);
    expect(llmFn).toHaveBeenCalledTimes(3); // MAX_MAINTENANCE_ATTEMPTS, then honest close

    // Foreign-owner loop: the prompt structurally offers only the reflecting
    // owner's loops — another person's loop is unnameable by position.
    await seedSea(roomId, 'window two');
    let offered: PromptShape['continuingContext']['openLoops'] = [];
    respond = (prompt) => {
      offered = parsePrompt(prompt).continuingContext.openLoops;
      return resolutionOut('owner', 99, [lastPromptEventId(prompt)]);
    };
    await run(200);
    expect(offered.map(entry => entry.text)).toEqual(['MY_LOOP']);
    expect(derivedRows(await journal.readSeaProjection(roomId))).toHaveLength(0);
    expect((await journal.readSeaProjection(roomId)).filter(event => event.type === 'consolidation')).toHaveLength(2);

    // Valid resolution: the model emits MY_LOOP's 1-based position only; the
    // committed row still carries the REAL journal id — proof canonical code
    // mapped the ordinal. The ordinal arrives as a STRING here: small models
    // quote it, and the parser must coerce numeric strings but reject
    // non-integer variants ("1.0").
    await seedSea(roomId, 'window three');
    respond = (prompt) => {
      const position = parsePrompt(prompt).continuingContext.openLoops.findIndex(entry => entry.text === 'MY_LOOP') + 1;
      if (position === 0) throw new Error('open loop was not offered in the prompt');
      return resolutionOut('owner', `${position}.0`, [lastPromptEventId(prompt)]);
    };
    await run(300);
    expect(derivedRows(await journal.readSeaProjection(roomId))).toHaveLength(0);
    expect((await journal.readSeaProjection(roomId)).filter(event => event.type === 'consolidation')).toHaveLength(3);

    await seedSea(roomId, 'window four', ['user', 'owner'], { replyToEventId: mine.id });
    respond = (prompt) => {
      const position = parsePrompt(prompt).continuingContext.openLoops.findIndex(entry => entry.text === 'MY_LOOP') + 1;
      if (position === 0) throw new Error('open loop was not offered in the prompt');
      return resolutionOut('owner', `${position}`, [lastPromptEventId(prompt)]);
    };
    await run(400);
    let stream = await journal.readSeaProjection(roomId);
    const resolutions = stream.filter(event => event.type === 'resolution');
    expect(resolutions).toHaveLength(1);
    expect(resolutions[0].payload).toMatchObject({ ownerId: 'owner', loopId: mine.id, status: 'satisfied' });
    expect(resolutions[0].actorId).toBe('harness');
    expect(resolutions[0].witnesses).toEqual(['owner']);

    // Already-closed loop: the later prompt offers an empty openLoops list and
    // omits the resolutions contract entirely; answering position 1 anyway is
    // invalid and publishes nothing.
    await seedSea(roomId, 'window four');
    respond = (prompt) => {
      const parsed = parsePrompt(prompt);
      expect(parsed.continuingContext.openLoops).toEqual([]);
      expect(Object.keys(parsed.outputSchema ?? {})).not.toContain('resolutions');
      return resolutionOut('owner', 1, [lastPromptEventId(prompt)]);
    };
    await run(400);
    stream = await journal.readSeaProjection(roomId);
    expect(stream.filter(event => event.type === 'resolution')).toHaveLength(1);
    // Markers: out-of-range, foreign, quoted-"1.0" seal, valid resolution, closed-loop seal.
    expect(stream.filter(event => event.type === 'consolidation')).toHaveLength(5);
    expect(await failedReflectionRunCount()).toBe(4);
  });

  it('rejects supersession targets that are not the owner’s prior derived beliefs', async () => {
    const roomId = 'room-superguard';
    seedWorld({
      rooms: [{ id: roomId, title: 'T', participantIds: ['a', 'b'], createdAt: 1 }],
      threads: [],
      participants: [person('a', 'Ava'), person('b', 'Ben')],
    });
    const shared = await seedSea(roomId, 'shared exchange', ['user', 'a', 'b']);
    let respond = (prompt: string): string => {
      const owner = parsePrompt(prompt).task.includes('(a)') ? 'a' : 'b';
      return beliefOut(owner, owner === 'a' ? 'A_PRIOR' : 'B_PRIOR', [shared.id]);
    };
    const llmFn = vi.fn(async (prompt: string) => respond(prompt));
    const run = (now: number) => dreamer.runDreamer(roomId, { policy: policy('local', true), llmFn, now });

    // Window 1 legitimately derives one belief per owner (the supersession targets).
    await run(100);
    let stream = await journal.readSeaProjection(roomId);
    const priorIds = new Map(stream.filter(event => event.type === 'memory.belief' && event.provenance?.reflectionId)
      .map(event => [payloadOf(event).text as string, event.id]));
    expect(priorIds.size).toBe(2);

    // Window 2: Ava tries to supersede Ben's derived row — foreign target.
    await seedSea(roomId, 'window two', ['user', 'a', 'b']);
    respond = (prompt) => {
      const owner = parsePrompt(prompt).task.includes('(a)') ? 'a' : 'b';
      return owner === 'a'
        ? beliefOut('a', 'A_GREEDY', [lastPromptEventId(prompt)], { supersedesEventId: priorIds.get('B_PRIOR') })
        : emptyOut();
    };
    await run(200);
    stream = await journal.readSeaProjection(roomId);
    expect(derivedRows(stream)).toHaveLength(2);

    // Window 3: Ava supersedes a USER-AUTHORED (non-derived) row — not a lawful target.
    const userRow = await journal.appendEvent(roomId, {
      roomId, scope: { kind: 'sea' }, type: 'memory.belief', actorId: 'a', witnesses: ['a'],
      payload: { ownerId: 'a', kind: 'belief', text: 'A_USER_ROW', sourceEventIds: [] },
    });
    respond = () => beliefOut('a', 'A_GREEDY_TWO', [userRow.id], { supersedesEventId: userRow.id });
    await run(300);
    stream = await journal.readSeaProjection(roomId);
    expect(derivedRows(stream)).toHaveLength(2);
    expect(stream.filter(event => event.type === 'consolidation')).toHaveLength(3);
    expect(await failedReflectionRunCount()).toBe(2);
    // The rejected supersessions tombstoned nothing: prior beliefs still project.
    const { projectionForCaller } = await import('../../shared/memoryProjection');
    const beliefs = projectionForCaller(stream, 'a').beliefs.map(belief => belief.text);
    expect(beliefs).toContain('A_PRIOR');
    expect(beliefs).not.toContain('A_GREEDY');
  });

  it('lands hallucinated third-party claims only as owner-scoped beliefs, never occurrences', async () => {
    const roomId = 'room-hallucination';
    seedRoomWorld(roomId);
    await seedSea(roomId, 'C mentioned the deadline to me');
    const llmFn = vi.fn(async (prompt: string) => beliefOut('owner', 'B told C that the deadline moved', [lastPromptEventId(prompt)]));

    await dreamer.runDreamer(roomId, { policy: policy('local', true), llmFn, now: 100 });

    // The committed journal (raw file, not just canonical readers) gained no
    // occurrence rows from the reflection — only interpretation rows exist.
    const rawJournal = fs.readFileSync(`${tempDir.tmpDir}/journal/${roomId}/sea.ndjson`, 'utf-8');
    const rows = rawJournal.trim().split('\n').filter(line => line.length > 0).map(line => JSON.parse(line) as JournalEvent);
    const occurrences = rows.filter(event =>
      (event.type.startsWith('message.') || event.type === 'disclosure') && event.provenance?.reflectionId !== undefined);
    expect(occurrences).toHaveLength(0);
    const belief = rows.find(event => event.type === 'memory.belief' && event.provenance?.reflectionId);
    expect(belief).toBeDefined();
    if (belief === undefined) throw new Error('expected belief event');
    expect(belief.witnesses).toEqual(['owner']);
    expect(belief.actorId).toBe('harness');
    expect(payloadOf(belief).text).toBe('B told C that the deadline moved');
  });

  it('runs the loop lifecycle: derive an open loop, then resolve it in a later window', async () => {
    const roomId = 'room-looplife';
    seedRoomWorld(roomId);
    const opening = await seedSea(roomId, 'I still need to pick a date');
    let respond = (prompt: string): string => JSON.stringify({
      beliefs: [{ ownerId: 'owner', kind: 'open-loop', text: 'OWNER_DATE_LOOP', sourceEventIds: [lastPromptEventId(prompt)] }],
      resolutions: [],
    });
    const llmFn = vi.fn(async (prompt: string) => respond(prompt));
    const run = (now: number) => dreamer.runDreamer(roomId, { policy: policy('local', true), llmFn, now });

    await run(100);
    let stream = await journal.readSeaProjection(roomId);
    const loopRow = stream.find(event => event.type === 'memory.belief' && payloadOf(event).kind === 'open-loop');
    expect(loopRow).toBeDefined();
    if (loopRow === undefined) throw new Error('expected open-loop row');

    const { openLoopStates, deriveRoomProjection } = await import('../../shared/memoryProjection');
    expect(openLoopStates(stream).get(loopRow.id)?.status).toBe('open');

    // Later window: the prompt lists the loop; the model resolves it by its
    // 1-based position and canonical code maps that to the journal id.
    await seedSea(roomId, 'the date is picked', ['user', 'owner'], { replyToEventId: opening.id });
    respond = (prompt) => {
      const position = parsePrompt(prompt).continuingContext.openLoops.findIndex(entry => entry.text === 'OWNER_DATE_LOOP') + 1;
      if (position === 0) throw new Error('open loop was not offered in the prompt');
      return resolutionOut('owner', position, [lastPromptEventId(prompt)], 'date confirmed');
    };
    await run(200);

    stream = await journal.readSeaProjection(roomId);
    expect(openLoopStates(stream).get(loopRow.id)?.status).toBe('satisfied');
    // No duplicate unresolved copy remains in the projection.
    expect(deriveRoomProjection(stream).openLoops).toHaveLength(0);
    const resolution = stream.find(event => event.type === 'resolution');
    expect(resolution).toBeDefined();
    if (resolution === undefined) throw new Error('expected resolution row');
    expect(resolution.payload).toMatchObject({ ownerId: 'owner', loopId: loopRow.id, status: 'satisfied', text: 'date confirmed' });
    expect(resolution.provenance?.reflectionId).toBeTruthy();
  });

  it('does not let the evidence that opened a loop satisfy that same loop', async () => {
    const roomId = 'room-loop-self-resolution';
    seedRoomWorld(roomId);
    const suspicion = await seedSea(roomId, 'A suspects B told C. Nobody has confirmed it.');
    const loop = await seedOpenLoop(roomId, 'Find out whether B told C.');
    const llmFn = vi.fn(async (prompt: string) => {
      const position = parsePrompt(prompt).continuingContext.openLoops.findIndex(entry => entry.text === 'Find out whether B told C.') + 1;
      return resolutionOut('owner', position, [suspicion.id], 'I will consider this question.');
    });

    await dreamer.runDreamer(roomId, { policy: policy('local', true), llmFn, now: 100 });

    const { openLoopStates } = await import('../../shared/memoryProjection');
    const stream = await journal.readSeaProjection(roomId);
    expect(openLoopStates(stream).get(loop.id)?.status).toBe('open');
    expect(stream.filter(event => event.type === 'resolution')).toEqual([]);
    expect(llmFn).toHaveBeenCalledTimes(3);
  });

  it('supersedes a prior derived belief: projection keeps only the successor, journal keeps both', async () => {
    const roomId = 'room-supersede';
    seedRoomWorld(roomId);
    await seedSea(roomId, 'initial signal');
    let respond = (prompt: string): string => beliefOut('owner', 'OWNER_WILL_LATE', [lastPromptEventId(prompt)]);
    const llmFn = vi.fn(async (prompt: string) => respond(prompt));
    const run = (now: number) => dreamer.runDreamer(roomId, { policy: policy('local', true), llmFn, now });

    await run(100);
    const prior = (await journal.readSeaProjection(roomId))
      .find(event => event.type === 'memory.belief' && event.provenance?.reflectionId !== undefined);
    expect(prior).toBeDefined();

    await seedSea(roomId, 'correcting signal');
    respond = (prompt) => {
      const successor = parsePrompt(prompt).continuingContext.priorBeliefs.find(entry => entry.text === 'OWNER_WILL_LATE');
      if (successor === undefined) throw new Error('prior belief was not offered in the prompt');
      return beliefOut('owner', 'OWNER_PUNCTUAL', [lastPromptEventId(prompt)], { supersedesEventId: successor.id });
    };
    await run(200);

    const stream = await journal.readSeaProjection(roomId);
    const derived = stream.filter(event => event.type === 'memory.belief' && event.provenance?.reflectionId !== undefined);
    expect(derived.map(event => payloadOf(event).text).sort()).toEqual(['OWNER_PUNCTUAL', 'OWNER_WILL_LATE']);
    expect(payloadOf(derived.find(event => payloadOf(event).text === 'OWNER_PUNCTUAL')!).supersedesEventId).toBe(prior!.id);
    const { projectionForCaller } = await import('../../shared/memoryProjection');
    expect(projectionForCaller(stream, 'owner').beliefs.map(belief => belief.text)).toEqual(['OWNER_PUNCTUAL']);
  });

  it('grounds continuing persons across Rooms: prior beliefs and loops travel, private rows never do', async () => {
    seedWorld({
      rooms: [
        { id: 'room-a', title: 'A', participantIds: ['mara', 'kai-a'], createdAt: 1 },
        { id: 'room-b', title: 'B', participantIds: ['mara', 'kai-b'], createdAt: 1 },
      ],
      threads: [],
      participants: [person('mara', 'Mara'), person('kai-a', 'Kai A'), person('kai-b', 'Kai B')],
    });
    await journal.appendEvent('room-a', {
      roomId: 'room-a', scope: { kind: 'sea' }, type: 'message.user', actorId: 'user',
      witnesses: ['user', 'mara'], payload: { text: 'MARA_ROOM_A_SOURCE' },
    });
    await journal.appendEvent('room-a', {
      roomId: 'room-a', scope: { kind: 'sea' }, type: 'disclosure', actorId: 'user',
      witnesses: ['kai-a', 'user'], payload: { text: 'KAI_A_PRIVATE' },
    });
    await seedOpenLoop('room-a', 'MARA_ROOM_A_LOOP', 'mara');

    // Room A: Mara derives a belief; Kai A contributes nothing.
    const llmA = vi.fn(async (prompt: string) => {
      const owner = parsePrompt(prompt).task.includes('(mara)') ? 'mara' : 'kai-a';
      return owner === 'mara' ? beliefOut('mara', 'MARA_ROOM_A_BELIEF', [parsePrompt(prompt).events[0].id]) : emptyOut();
    });
    await dreamer.runDreamer('room-a', { policy: policy('local', true), llmFn: llmA, now: 100 });
    const roomARows = await journal.readSeaProjection('room-a');
    const roomABelief = roomARows.find(event => event.type === 'memory.belief' && event.provenance?.reflectionId);
    expect(roomABelief).toBeDefined();

    // Room B: Mara's prompt must carry her Room A prior state as causal
    // context (not direct evidence) and never anyone else's private rows;
    // Kai B sees none of it.
    const roomBSource = await seedSea('room-b', 'ROOM_B_SHARED', ['user', 'mara', 'kai-b']);
    const llmB = vi.fn(async (prompt: string) => {
      const owner = parsePrompt(prompt).task.includes('(mara)') ? 'mara' : 'kai-b';
      return owner === 'mara' ? beliefOut('mara', 'MARA_ROOM_B_BELIEF', [roomBSource.id]) : emptyOut();
    });
    await dreamer.runDreamer('room-b', { policy: policy('local', true), llmFn: llmB, now: 200 });

    const prompts = llmB.mock.calls.map(call => call[0] as string);
    const maraPrompt = prompts.find(prompt => parsePrompt(prompt).task.includes('(mara)'));
    const kaiBPrompt = prompts.find(prompt => parsePrompt(prompt).task.includes('(kai-b)'));
    expect(maraPrompt).toBeDefined();
    expect(kaiBPrompt).toBeDefined();
    const maraContext = parsePrompt(maraPrompt!).continuingContext;
    expect(maraContext.priorBeliefs.map(entry => entry.text)).toEqual(['MARA_ROOM_A_BELIEF']);
    expect(maraContext.openLoops.map(entry => entry.text)).toEqual(['MARA_ROOM_A_LOOP']);
    expect(maraPrompt!).not.toContain('KAI_A_PRIVATE');
    expect(maraPrompt!).not.toContain('MARA_ROOM_A_SOURCE'); // prior state is context, never source
    expect(kaiBPrompt!).not.toContain('MARA_ROOM_A_BELIEF');
    expect(kaiBPrompt!).not.toContain('MARA_ROOM_A_LOOP');

    // Mara's Room B belief cites only her Room B window.
    const roomBRows = await journal.readSeaProjection('room-b');
    const bBelief = roomBRows.find(event => event.type === 'memory.belief' && event.provenance?.reflectionId !== undefined);
    expect(bBelief).toBeDefined();
    expect(payloadOf(bBelief!).sourceEventIds).toEqual([roomBSource.id]);
    const roomALoop = roomARows.find(event => payloadOf(event).text === 'MARA_ROOM_A_LOOP');
    expect(payloadOf(bBelief!).dependencyEventIds).toEqual([roomABelief!.id, roomALoop!.id]);
    expect(bBelief!.witnesses).toEqual(['mara']);

    // Later correction of the carried belief invalidates the already-published
    // Room B descendant through its durable dependency edge.
    await journal.appendEvent('room-a', {
      roomId: 'room-a', scope: { kind: 'sea' }, type: 'correction', actorId: 'mara', witnesses: ['mara'],
      payload: { ownerId: 'mara', targetId: roomABelief!.id },
    });
    expect((await journal.readSeaProjection('room-b')).some(event => event.id === bBelief!.id)).toBe(false);
  });

  it('reflects a sandbox thread from thread-local personal history only', async () => {
    const threadId = 'thread-reflect';
    seedWorld({
      rooms: [{ id: 'room-seaside', title: 'Sea', participantIds: ['owner'], createdAt: 1 }],
      threads: [{
        id: threadId, state: 'active', createdAt: 1,
        sandbox: { operationId: 'op', requestHash: 'hash', bindings: [{ baseline: person('owner', 'Owner') }], baselineHeads: {} },
      }],
      participants: [person('owner', 'Owner')],
    });
    await seedOpenLoop('room-seaside', 'SEA_SIDE_LOOP'); // Sea-side prior state must never leak into the sandbox
    const threadEvent = await journal.appendEvent(threadId, {
      roomId: threadId, scope: { kind: 'thread', threadId }, type: 'message.user', actorId: 'user',
      witnesses: ['user', 'owner'], payload: { text: 'THREAD_TALK' },
    });
    const prompts: string[] = [];
    const llmFn = vi.fn(async (prompt: string) => {
      prompts.push(prompt);
      return beliefOut('owner', 'THREAD_BELIEF', [lastPromptEventId(prompt)]);
    });

    await dreamer.runReflection({ roomId: threadId, scopeKind: 'thread', threadId }, { policy: policy('local', true), llmFn, now: 100 });

    expect(llmFn).toHaveBeenCalledTimes(1);
    expect(prompts[0]).toContain('THREAD_TALK');
    expect(prompts[0]).not.toContain('SEA_SIDE_LOOP');
    expect(parsePrompt(prompts[0]).continuingContext.priorBeliefs).toHaveLength(0);
    expect(parsePrompt(prompts[0]).continuingContext.openLoops).toHaveLength(0);
    const threadStream = await journal.readThread(threadId, threadId);
    const derived = threadStream.filter(event => event.type === 'memory.belief' && event.provenance?.reflectionId !== undefined);
    expect(derived).toHaveLength(1);
    expect(derived[0].scope).toEqual({ kind: 'thread', threadId });
    expect(derived[0].witnesses).toEqual(['owner']);
    // Nothing derived crossed scopes: the Sea stream holds only the seeded row.
    expect(await journal.readSeaProjection('room-seaside')).toHaveLength(1);
  });

  it('persists salience/access as projections, never journal events', async () => {
    const roomId = 'room-projections';
    seedRoomWorld(roomId);
    await projections.saveProjectionStore({
      [roomId]: { oldMemory: { salience: 0.5, lastAccessed: 1 } },
    });
    const source = await seedSea(roomId);

    await dreamer.runDreamer(roomId, { policy: policy('local', true), llmFn: async () => validOutput([source.id]), now: 123 });

    const events = await journal.readSeaProjection(roomId);
    const belief = events.find((event) => event.type === 'memory.belief');
    const store = await projections.loadProjectionStore();
    expect(store[roomId].oldMemory).toEqual({ salience: 0.45, lastAccessed: 1 });
    expect(belief).toBeDefined();
    if (belief === undefined) throw new Error('expected belief event');
    expect(store[roomId][belief.id]).toEqual({ salience: 1, lastAccessed: 123 });
    const rawJournal = fs.readFileSync(`${tempDir.tmpDir}/journal/${roomId}/sea.ndjson`, 'utf-8');
    expect(rawJournal).not.toContain('salience');
    expect(rawJournal).not.toContain('lastAccessed');
  });

  it('recovers an interrupted projection publication idempotently before settlement', async () => {
    const roomId = 'room-projection-recovery';
    seedRoomWorld(roomId);
    const source = await seedSea(roomId);
    const originalRename = fs.promises.rename.bind(fs.promises);
    let interrupted = false;
    const rename = vi.spyOn(fs.promises, 'rename').mockImplementation(async (...args) => {
      if (!interrupted && String(args[0]).endsWith('projection-store.json.tmp')) {
        interrupted = true;
        throw new Error('projection write interrupted');
      }
      return originalRename(...args);
    });

    await expect(dreamer.runDreamer(roomId, {
      policy: policy('local', true), llmFn: async () => validOutput([source.id]), now: 123,
    })).rejects.toThrow('projection write interrupted');
    expect((await (await import('./worldStore')).loadWorld()).reflectionRuns?.[0].status).toBe('pending');
    expect(await journal.readSeaProjection(roomId)).toEqual([source]);

    rename.mockRestore();
    await dreamer.reconcilePendingReflections();
    const once = await projections.loadProjectionStore();
    await dreamer.reconcilePendingReflections();
    expect(await projections.loadProjectionStore()).toEqual(once);
    expect((await (await import('./worldStore')).loadWorld()).reflectionRuns?.[0].status).toBe('committed');
  });

  it('honors policies and records provenance on every result', async () => {
    const blockedRoom = 'room-blocked';
    seedRoomWorld(blockedRoom);
    await seedSea(blockedRoom);
    const blockedLlm = vi.fn(async () => validOutput([]));
    await dreamer.runDreamer(blockedRoom, {
      policy: policy('conservative-cloud', false),
      llmFn: blockedLlm,
      now: 100,
    });
    expect(blockedLlm).not.toHaveBeenCalled();

    for (const kind of ['local', 'unrestricted-cloud'] as const) {
      const roomId = `room-${kind}`;
      seedRoomWorld(roomId);
      await seedSea(roomId);
      const policyLoop = await seedOpenLoop(roomId, 'POLICY_LOOP'); // exactly one open loop → ordinal 1 maps to it
      const resolving = await seedSea(roomId, 'The loop is now resolved.', ['user', 'owner'], { replyToEventId: policyLoop.id });
      const llmFn = vi.fn(async () => validOutput([resolving.id], 1));
      await dreamer.runDreamer(roomId, { policy: policy(kind, true), llmFn, now: 100 });
      expect(llmFn).toHaveBeenCalledTimes(1);
      const results = (await journal.readSeaProjection(roomId)).filter(
        (event) => (event.type === 'memory.belief' || event.type === 'resolution') && event.provenance?.reflectionId !== undefined
      );
      expect(results).toHaveLength(2);
      for (const event of results) {
        expect(event.payload).toMatchObject({ sourceEventIds: [resolving.id] });
        expect(event.provenance?.reflectionId).toBeTruthy();
      }
    }
  });

  it('recovers an interrupted prepared publication all-or-nothing', async () => {
    const roomId = 'room-recovery';
    seedRoomWorld(roomId);
    await seedSea(roomId, 'first');
    const draft = (text: string): object => ({
      roomId, scope: { kind: 'sea' }, type: 'memory.belief', actorId: 'harness',
      witnesses: ['owner'], payload: { ownerId: 'owner', kind: 'belief', text, sourceEventIds: [] },
      provenance: { reflectionId: 'refl_recovered' },
    });
    await journal.appendEvent(roomId, draft('first conclusion')); // only the first row landed

    // Simulated crash state: the durable record holds prepared drafts; only
    // the first derived row physically reached the journal before the crash.
    const seaEvents = await journal.readSeaProjection(roomId);
    const windowStart = seaEvents[0].createdAt;
    const windowEnd = seaEvents.at(-1)!.createdAt;
    const worldStore = await import('./worldStore');
    const current = await worldStore.loadWorld();
    await worldStore.saveWorld({
      ...current,
      reflectionRuns: [{
        reflectionId: 'refl_recovered', kind: 'reflection', contextId: roomId, scopeKind: 'sea',
        windowStart, windowEnd, sourceEventIds: seaEvents.map(event => event.id), status: 'pending', createdAt: 1,
        prepared: { kind: 'reflection', expectedDrafts: [draft('first conclusion'), draft('second conclusion')] },
      }],
    });

    // Restart path: recovery resumes to the exact prepared count, seals the
    // marker once, and never spends a model call on the window.
    const llmFn = vi.fn(async () => validOutput([]));
    await dreamer.reconcilePendingReflections();
    const events = await journal.readSeaProjection(roomId);
    expect(events.filter(event => event.type === 'memory.belief' || event.type === 'resolution')).toHaveLength(2);
    expect(events.filter(event => event.type === 'consolidation')).toHaveLength(1);
    expect(llmFn).not.toHaveBeenCalled();
    expect(((await worldStore.loadWorld()).reflectionRuns ?? [])[0]?.status).toBe('committed');

    // The window is sealed: a further run makes no model call.
    await dreamer.runDreamer(roomId, { policy: policy('local', true), llmFn, now: 200 });
    expect(llmFn).not.toHaveBeenCalled();
  });

  it('shares an active pass without recovering it out from under its model call', async () => {
    seedRoomWorld('concurrent');
    const source = await seedSea('concurrent');
    const gate = Promise.withResolvers<string>();
    const llmFn = vi.fn(() => gate.promise);
    const first = dreamer.runDreamer('concurrent', { policy: policy('local', true), llmFn });
    await vi.waitFor(() => expect(llmFn).toHaveBeenCalledTimes(1));
    const second = dreamer.runDreamer('concurrent', { policy: policy('local', true), llmFn });
    gate.resolve(validOutput([source.id]));
    await Promise.all([first, second]);
    expect(llmFn).toHaveBeenCalledTimes(1);
    const state = await (await import('./worldStore')).loadWorld();
    expect(state.reflectionRuns).toHaveLength(1);
    expect(state.reflectionRuns?.[0].status).toBe('committed');
  });

  it('retracts derived interpretations when their supporting memory is corrected', async () => {
    seedRoomWorld('retract');
    const source = await journal.appendEvent('retract', { roomId: 'retract', scope: { kind: 'sea' },
      type: 'memory.belief', actorId: 'owner', witnesses: ['owner'],
      payload: { ownerId: 'owner', kind: 'belief', text: 'Unsupported original claim', sourceEventIds: [] } });
    await dreamer.runDreamer('retract', { policy: policy('local', true), llmFn: async () => validOutput([source.id]) });
    await journal.appendEvent('retract', { roomId: 'retract', scope: { kind: 'sea' }, type: 'correction',
      actorId: 'owner', witnesses: ['owner'], payload: { ownerId: 'owner', targetId: source.id } });
    const { projectionForCaller } = await import('../../shared/memoryProjection');
    expect(projectionForCaller(await journal.readSeaProjection('retract'), 'owner').beliefs).toEqual([]);
  });

  it('does not skip same-millisecond sources across a bounded window', async () => {
    seedRoomWorld('clock');
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1000);
    try {
      for (let i = 0; i < 41; i++) await seedSea('clock', `source ${i}`);
      const llmFn = vi.fn(async (prompt: string) => beliefOut('owner', 'durable conclusion', [lastPromptEventId(prompt)]));
      await dreamer.runDreamer('clock', { policy: policy('local', true), llmFn });
      await dreamer.runDreamer('clock', { policy: policy('local', true), llmFn });
      expect(llmFn).toHaveBeenCalledTimes(2);
      expect(llmFn.mock.calls[1]?.[0]).toContain('source 40');
    } finally { clock.mockRestore(); }
  });

  it('hides a prepared prefix from canonical readers until publication commits', async () => {
    seedRoomWorld('atomic');
    await seedSea('atomic');
    const atomicLoop = await seedOpenLoop('atomic', 'ATOMIC_LOOP'); // exactly one open loop → ordinal 1 maps to it
    const resolving = await seedSea('atomic', 'The atomic loop is resolved.', ['user', 'owner'], { replyToEventId: atomicLoop.id });
    const original = fs.promises.appendFile.bind(fs.promises);
    const append = vi.spyOn(fs.promises, 'appendFile').mockImplementation(async (...args) => {
      if (String(args[1]).includes('"type":"resolution"')) throw new Error('injected interruption');
      return original(...args);
    });
    try {
      await expect(dreamer.runDreamer('atomic', { policy: policy('local', true), llmFn: async () => validOutput([resolving.id], 1) })).rejects.toThrow('interruption');
    } finally { append.mockRestore(); }
    expect((await journal.readSeaProjection('atomic')).filter(e => e.provenance?.reflectionId)).toEqual([]);
    expect((await journal.subscribeRoom('atomic', 100)).events.filter(e => e.provenance?.reflectionId)).toEqual([]);
    await dreamer.reconcilePendingReflections();
    expect((await journal.readSeaProjection('atomic')).filter(e => e.type === 'memory.belief' && e.provenance?.reflectionId)).toHaveLength(1);
  });

  it('refuses a completion whose source was retracted while the model ran', async () => {
    seedRoomWorld('stale');
    const source = await journal.appendEvent('stale', { roomId: 'stale', scope: { kind: 'sea' },
      type: 'memory.belief', actorId: 'owner', witnesses: ['owner'],
      payload: { ownerId: 'owner', kind: 'belief', text: 'Unreliable source', sourceEventIds: [] } });
    await dreamer.runDreamer('stale', { policy: policy('local', true), llmFn: async () => {
      await journal.appendEvent('stale', { roomId: 'stale', scope: { kind: 'sea' }, type: 'correction',
        actorId: 'owner', witnesses: ['owner'], payload: { ownerId: 'owner', targetId: source.id } });
      return validOutput([source.id]);
    } }).catch(() => undefined);
    expect((await journal.readSeaProjection('stale')).filter(e => e.type === 'memory.belief' && e.id !== source.id)).toEqual([]);
  });

  it('settle-pending fail-closed re-runs a window with no prepared output', async () => {
    const roomId = 'room-noprepared';
    seedRoomWorld(roomId);
    await seedSea(roomId);
    // Hand-author a pending record with no prepared output (interrupted before
    // validation): recovery must settle it failed and the window re-runs.
    const world = await import('./worldStore');
    const runs = (await world.loadWorld()).reflectionRuns ?? [];
    await (async () => {
      const current = await world.loadWorld();
      await world.saveWorld({
        ...current,
        reflectionRuns: [...runs, {
          reflectionId: 'refl_simulated', kind: 'reflection', contextId: roomId, scopeKind: 'sea',
          windowStart: 0, windowEnd: 1, sourceEventIds: [], status: 'pending', createdAt: 1,
        }],
      });
    })();

    await dreamer.reconcilePendingReflections();
    const settled = ((await world.loadWorld()).reflectionRuns ?? []).find(run => run.reflectionId === 'refl_simulated');
    expect(settled?.status).toBe('failed');
  });
});

/** Sandbox-thread world for thread-scope reflection tests. */
function seedThreadWorld(threadId: string): void {
  seedWorld({
    rooms: [],
    threads: [{
      id: threadId, state: 'active', createdAt: 1,
      sandbox: { operationId: 'op', requestHash: 'hash', bindings: [{ baseline: person('owner', 'Owner') }], baselineHeads: {} },
    }],
    participants: [person('owner', 'Owner')],
  });
}
