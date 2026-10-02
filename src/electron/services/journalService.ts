import { publishWorldChange } from './worldChanges';
/**
 * Journal Service — append-only per-room NDJSON event journal, single writer.
 *
 * One Sea stream per room (`journal/{roomId}/sea.ndjson`) plus one stream per
 * Thread (`journal/{roomId}/threads/{threadId}.ndjson`), so Threads purge
 * cleanly later without touching the Sea stream (Oracle ruling: a single
 * interleaved file cannot selectively purge a Thread).
 *
 * All mutations (and reads, for a consistent read-after-write view) are
 * serialized through a single promise write queue. Per-stream head seqs are
 * recovered from the file tail on first access and cached in memory.
 * Crash recovery: a trailing partial line is discarded on load, never failing
 * the whole stream.
 *
 * Contract: .sisyphus/plans/conversational-runtime-overhaul.md §4.
 * Renderer access: setupJournalIPC() (registered in setupAllIPC) → preload → bridges.
 */

import fs from 'fs';
import path from 'path';
import { app, ipcMain } from 'electron';
import { getUserDataPath } from '../utils/platform';
import { getLogger } from '../../shared/utils/logger';
import { IPC_CHANNELS } from '../../shared/constants';
import { HARNESS_ACTOR, USER_ACTOR } from '../../shared/world';
import { WORLD_CONTINUITY_ID } from '../../shared/world';
import { validVoiceDelivery, voiceDeliveries, validVoiceMemoryIntent, releasedVoiceMemoryEvents } from '../../shared/voiceDelivery';
import { tombstonedIds } from '../../shared/memoryProjection';
import { requireLivingWorld } from '../../shared/livingWorld';
import { loadWorld } from './worldStore';
import { loadSettings } from './settings';
import type { DeletionPayload, EventScope, JournalEvent, JournalEventDraft } from '../../shared/world';
import { guardianForWrites } from './guardian';

const log = getLogger('electron.journal');

// Per-stream head cache, keyed by `<roomId>:sea` / `<roomId>:thread:<threadId>`.
interface StreamState {
  headSeq: number;
  loaded: boolean;
}
const streamHeads = new Map<string, StreamState>();

// Single promise write queue — every journal mutation is serialized here.
let writeQueue: Promise<unknown> = Promise.resolve();
function enqueueWrite<T>(fn: () => Promise<T>): Promise<T> {
  const result = writeQueue.then(fn, fn);
  writeQueue = result.then(
    () => undefined,
    () => undefined
  );
  return result;
}

function seaFilePath(roomId: string): string {
  return path.join(getUserDataPath(), 'journal', roomId, 'sea.ndjson');
}

function threadFilePath(roomId: string, threadId: string): string {
  return path.join(getUserDataPath(), 'journal', roomId, 'threads', `${threadId}.ndjson`);
}

function streamKey(roomId: string, scope: EventScope): string {
  return scope.kind === 'sea' ? `${roomId}:sea` : `${roomId}:thread:${scope.threadId}`;
}

function streamFilePath(roomId: string, scope: EventScope): string {
  return scope.kind === 'sea' ? seaFilePath(roomId) : threadFilePath(roomId, scope.threadId);
}

/**
 * Load a stream's tail to recover its head seq, caching it in memory.
 * Only an unterminated malformed final line can be an interrupted append.
 * Corruption in committed lines fails closed, preserving the original file.
 * Must only be called from within the write queue.
 */
async function loadStreamHead(key: string, filePath: string): Promise<StreamState> {
  const cached = streamHeads.get(key);
  if (cached?.loaded) return cached;
  const state: StreamState = { headSeq: 0, loaded: true };
  let raw: string;
  try {
    raw = await fs.promises.readFile(filePath, 'utf-8');
  } catch (error) {
    if (typeof error !== 'object' || error === null || !('code' in error) || error.code !== 'ENOENT') throw error;
    streamHeads.set(key, state);
    return state;
  }
  const lines = raw.split('\n');
  const complete: string[] = [];
  let partialTail = false;
  for (const [index, line] of lines.entries()) {
    if (line.length === 0) continue;
    let event: JournalEvent;
    try {
      event = JSON.parse(line) as JournalEvent;
    } catch {
      if (index !== lines.length - 1) throw new Error('[journal] Corrupt committed record; history preserved');
      partialTail = true;
      break;
    }
    if (!event || !Number.isSafeInteger(event.seq) || event.seq <= state.headSeq) {
      throw new Error('[journal] Invalid record sequence; history preserved');
    }
    state.headSeq = event.seq;
    complete.push(line);
  }
  if (partialTail) {
    const recovered = complete.length > 0 ? `${complete.join('\n')}\n` : '';
    await fs.promises.writeFile(filePath, recovered, 'utf-8');
    log.warn(`[journal] Discarded partial tail of ${filePath} (crash recovery)`);
  } else if (raw.length > 0 && !raw.endsWith('\n')) {
    await fs.promises.appendFile(filePath, '\n', 'utf-8');
  }
  streamHeads.set(key, state);
  return state;
}

async function readStreamUnlocked(roomId: string, scope: EventScope): Promise<JournalEvent[]> {
  const filePath = streamFilePath(roomId, scope);
  await loadStreamHead(streamKey(roomId, scope), filePath);
  try {
    const raw = await fs.promises.readFile(filePath, 'utf-8');
    const events: JournalEvent[] = [];
    for (const line of raw.split('\n')) {
      if (line.length === 0) continue;
      events.push(JSON.parse(line) as JournalEvent);
    }
    return events;
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') return [];
    log.error(`[journal] Failed to read stream ${filePath}:`, error);
    throw error;
  }
}

async function readStream(roomId: string, scope: EventScope): Promise<JournalEvent[]> {
  return enqueueWrite(async () => {
    await recoverVoiceDeliveriesUnlocked(roomId, scope);
    return readStreamUnlocked(roomId, scope);
  });
}

async function appendEventUnlocked(roomId: string, draft: JournalEventDraft): Promise<JournalEvent> {
  const filePath = streamFilePath(roomId, draft.scope);
  const state = await loadStreamHead(streamKey(roomId, draft.scope), filePath);
  const seq = state.headSeq + 1;
  const event: JournalEvent = {
    ...draft,
    id: `evt_${Date.now().toString(36)}_${seq}_${Math.random().toString(36).slice(2, 10)}`,
    seq,
    createdAt: Date.now(),
  };
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  try { await fs.promises.appendFile(filePath, `${JSON.stringify(event)}\n`, 'utf-8'); }
  catch (error) {
    // Rejected appends can have written a partial tail. Recheck disk on the
    // next read rather than keeping a cached head that bypasses repair.
    streamHeads.delete(streamKey(roomId, draft.scope));
    throw error;
  }
  state.headSeq = seq;
  guardianForWrites()?.recordJournalAppend(filePath, seq);
  publishWorldChange({ kind: 'journal', roomId, threadId: draft.scope.kind === 'thread' ? draft.scope.threadId : undefined });
  return event;
}

async function validateContext(roomId: string, draft: JournalEventDraft): Promise<void> {
  if ('inferenceAvailabilitySeq' in draft) throw new Error('[journal] inference availability is a derived projection field');
  if (draft.roomId !== roomId) throw new Error('[journal] context mismatch');
  const world = await loadWorld();
  const sandbox = world.threads.find(thread => thread.sandbox &&
    (thread.id === roomId || (draft.scope.kind === 'thread' && thread.id === draft.scope.threadId)));
  if (sandbox) {
    if (roomId !== sandbox.id || draft.scope.kind !== 'thread' || draft.scope.threadId !== sandbox.id) {
      throw new Error('[journal] sandbox events must stay in their own thread');
    }
    const bound = new Set([USER_ACTOR, HARNESS_ACTOR, ...sandbox.sandbox!.bindings.map(binding => binding.baseline.id)]);
    if (!bound.has(draft.actorId) || draft.witnesses.some(id => !bound.has(id))) {
      throw new Error('[journal] actor and witnesses must be bound to the sandbox');
    }
  } else if (draft.scope.kind === 'thread') {
    // Thread-scoped writes require a live Thread record with matching
    // journal context: erasing the record (sandbox deletion) stops further
    // thread-journal writes permanently.
    const threadId = draft.scope.threadId;
    const thread = world.threads.find(candidate => candidate.id === threadId);
    if (!thread || thread.roomId !== roomId) throw new Error('[journal] thread context no longer exists');
  }
}

function validateDelivery(stream: JournalEvent[], draft: JournalEventDraft): { candidate: JournalEvent; existing?: JournalEvent } {
  if (draft.provenance?.voiceMemoryMessageId !== undefined) throw new Error('[journal] invalid voice delivery provenance');
  const payload = draft.payload as { messageEventId?: unknown } | null;
  const message = stream.find(event => event.id === payload?.messageEventId);
  const candidate: JournalEvent = { ...draft, id: 'pending-delivery-validation', seq: (stream.at(-1)?.seq ?? 0) + 1, createdAt: Date.now() };
  if (!message || !validVoiceDelivery(message, candidate)) throw new Error('[journal] invalid voice delivery identity or payload');
  const existing = stream.find(event => event.type === 'delivery.voice' && validVoiceDelivery(message, event)
    && JSON.stringify(event.payload) === JSON.stringify(draft.payload));
  if (existing) return { candidate, existing };
  const previous = voiceDeliveries(stream).get(message.id);
  if (previous?.payload.state !== 'playing' && previous) {
    throw new Error('[journal] terminal voice delivery cannot be rewritten');
  }
  if (voiceDeliveries([...stream, candidate]).get(message.id) !== candidate) {
    throw new Error('[journal] voice delivery cannot regress');
  }
  return { candidate };
}

function deliveryOutboxPath(roomId: string, scope: EventScope): string {
  return `${streamFilePath(roomId, scope)}.voice-outbox.json`;
}

async function readDeliveryOutbox(roomId: string, scope: EventScope): Promise<JournalEventDraft[]> {
  try {
    const data: unknown = JSON.parse(await fs.promises.readFile(deliveryOutboxPath(roomId, scope), 'utf-8'));
    if (typeof data !== 'object' || data === null || !('version' in data) || data.version !== 1
      || !('drafts' in data) || !Array.isArray(data.drafts)) throw new Error('[journal] invalid voice recovery outbox; preserved');
    const drafts = data.drafts as JournalEventDraft[];
    if (drafts.some(draft => !draft || draft.type !== 'delivery.voice' || draft.roomId !== roomId
      || !draft.scope || draft.scope.kind !== scope.kind
      || (draft.scope.kind === 'thread' && scope.kind === 'thread' && draft.scope.threadId !== scope.threadId))) {
      throw new Error('[journal] invalid voice recovery scope; preserved');
    }
    return drafts;
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') return [];
    throw error;
  }
}

async function saveDeliveryOutbox(roomId: string, scope: EventScope, drafts: JournalEventDraft[]): Promise<void> {
  const filePath = deliveryOutboxPath(roomId, scope);
  if (!drafts.length) {
    for (const pendingPath of [filePath, `${filePath}.tmp`]) {
      try { await fs.promises.unlink(pendingPath); }
      catch (error) { if (typeof error !== 'object' || error === null || !('code' in error) || error.code !== 'ENOENT') throw error; }
    }
    return;
  }
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  await fs.promises.writeFile(`${filePath}.tmp`, JSON.stringify({ version: 1, drafts }), 'utf-8');
  await fs.promises.rename(`${filePath}.tmp`, filePath);
}

/** Main-owned, profile-local retry. It records observations; it never replays audio. */
async function recoverVoiceDeliveriesUnlocked(roomId: string, scope: EventScope): Promise<void> {
  const drafts = await readDeliveryOutbox(roomId, scope);
  if (!drafts.length) return;
  const stream = await readStreamUnlocked(roomId, scope);
  while (drafts.length) {
    const draft = drafts[0];
    await validateContext(roomId, draft);
    const { existing } = validateDelivery(stream, draft);
    if (!existing) stream.push(await appendEventUnlocked(roomId, draft));
    drafts.shift();
    try { await saveDeliveryOutbox(roomId, scope, drafts); }
    catch (error) {
      // The journal ACK already exists. A cleanup failure cannot negate it;
      // the unchanged outbox will match that exact row on the next read.
      log.warn('[journal] voice recovery cleanup deferred', error);
      return;
    }
  }
}

async function queueVoiceDeliveryUnlocked(roomId: string, draft: JournalEventDraft): Promise<JournalEvent> {
  const stream = await readStreamUnlocked(roomId, draft.scope);
  const drafts = await readDeliveryOutbox(roomId, draft.scope);
  const virtual = [...stream];
  for (const pending of drafts) {
    await validateContext(roomId, pending);
    const validation = validateDelivery(virtual, pending);
    if (!validation.existing) virtual.push({ ...validation.candidate, id: `pending-delivery-${virtual.length}` });
  }
  const validation = validateDelivery(virtual, draft);
  if (validation.existing && stream.includes(validation.existing)) return validation.existing;
  if (!validation.existing) drafts.push(draft);
  await saveDeliveryOutbox(roomId, draft.scope, drafts);
  try { await recoverVoiceDeliveriesUnlocked(roomId, draft.scope); }
  catch (error) {
    const saved = validateDelivery(await readStreamUnlocked(roomId, draft.scope), draft).existing;
    if (saved) return saved;
    throw error;
  }
  const saved = validateDelivery(await readStreamUnlocked(roomId, draft.scope), draft).existing;
  if (!saved) throw new Error('[journal] voice delivery is saved for retry but not yet committed');
  return saved;
}

/** Assigns id/seq/createdAt and appends one line to the scope's stream file. */
export async function appendEvent(roomId: string, draft: JournalEventDraft): Promise<JournalEvent> {
  return enqueueWrite(async () => {
    await validateContext(roomId, draft);
    if (draft.type === 'delivery.voice') return queueVoiceDeliveryUnlocked(roomId, draft);
    if (draft.provenance?.voiceMemoryMessageId !== undefined) {
      const stream = await readStreamUnlocked(roomId, draft.scope);
      const source = stream.find(event => event.id === draft.provenance?.voiceMemoryMessageId);
      const candidate: JournalEvent = { ...draft, id: 'pending-memory-validation', seq: (stream.at(-1)?.seq ?? 0) + 1, createdAt: Date.now() };
      if (!source || !validVoiceMemoryIntent(source, candidate, stream)) throw new Error('[journal] invalid private voice memory dependency');
    }
    return appendEventUnlocked(roomId, draft);
  });
}

/** Main-only recovery reader. Never exposed through journal IPC. Only rows
 *  written by the staged hidden-preparation protocol are operation content. */
export async function readPreparedIntegrationEvents(roomId: string, integrationId: string): Promise<JournalEvent[]> {
  return (await readStream(roomId, { kind: 'sea' })).filter(event =>
    event.provenance?.integrationId === integrationId && event.provenance?.stagedIntegration === true);
}

/** Main-only recovery reader; prepared rows are never renderer context. */
export async function readPreparedMaintenanceEvents(roomId: string, scope: EventScope, reflectionId: string): Promise<JournalEvent[]> {
  return (await readStream(roomId, scope)).filter(event => event.provenance?.reflectionId === reflectionId);
}

/** Main-only recovery reader for V09. Autonomous rows are physically durable
 * before their logical commit but cannot enter any canonical read path until
 * the matching world-ledger job is committed. */
export async function readPreparedAutonomyEvents(roomId: string, jobId: string): Promise<JournalEvent[]> {
  return (await readStream(roomId, { kind: 'sea' })).filter(event => event.provenance?.autonomyJobId === jobId);
}

/** Main-only recovery reader for V10 contact publication. */
export async function readPreparedContactEvents(roomId: string, contactId: string): Promise<JournalEvent[]> {
  return (await readStream(roomId, { kind: 'sea' })).filter(event => event.provenance?.contactId === contactId);
}

async function canonicalEvents(events: JournalEvent[], loadedWorld?: Awaited<ReturnType<typeof loadWorld>>): Promise<JournalEvent[]> {
  const world = loadedWorld ?? await loadWorld();
  const records = new Map((world.integrations ?? []).map(record => [record.integrationId, record]));
  const runs = new Map((world.reflectionRuns ?? []).map(record => [record.reflectionId, record]));
  const autonomyJobs = new Map((world.autonomyJobs ?? []).map(record => [record.jobId, record]));
  const contacts = new Map((world.contacts ?? []).map(record => [record.contactId, record]));
  const canonical = events.filter(event => {
    const autonomyJobId = event.provenance?.autonomyJobId;
    if (event.type === 'intention' || event.type === 'occurrence.simulated' || autonomyJobId) {
      if (!autonomyJobId) return false;
      const job = autonomyJobs.get(autonomyJobId);
      if (!job || job.roomId !== event.roomId || event.scope.kind !== 'sea' || job.status !== 'committed'
        || !job.eventIds?.includes(event.id)) return false;
    }
    const contactId = event.provenance?.contactId;
    if (event.type === 'contact.invitation' || contactId) {
      if (!contactId) return false;
      const contact = contacts.get(contactId);
      if (!contact || contact.roomId !== event.roomId || event.scope.kind !== 'sea'
        || !contact.eventIds?.includes(event.id)) return false;
    }
    const reflectionId = event.provenance?.reflectionId;
    if (reflectionId) {
      const run = runs.get(reflectionId);
      if (!run || run.contextId !== event.roomId || run.scopeKind !== event.scope.kind
        || (event.scope.kind === 'thread' && run.threadId !== event.scope.threadId)) return false;
      // Failed, exhausted windows retain only their empty progress marker.
      if (run.status !== 'committed' && !(run.status === 'failed' && event.type === 'consolidation')) return false;
    }
    const id = event.provenance?.integrationId;
    if (!id) return true;
    // Canonical only when the staged protocol wrote it AND the durable
    // ledger certified the operation. Anything else claiming an
    // integrationId (dev-era rows, foreign writes) stays quarantined.
    return event.provenance?.stagedIntegration === true
      && records.get(id)?.status === 'committed';
  });
  return releasedVoiceMemoryEvents(canonical);
}

function hasDerivedDependencies(event: JournalEvent): boolean {
  const payload = event.payload;
  return event.provenance?.reflectionId !== undefined
    && typeof payload === 'object' && payload !== null
    && Array.isArray((payload as { dependencyEventIds?: unknown }).dependencyEventIds);
}

async function readCanonicalSeaBase(roomId: string, world: Awaited<ReturnType<typeof loadWorld>>): Promise<JournalEvent[]> {
  return canonicalEvents(await readStream(roomId, { kind: 'sea' }), world);
}

async function readCanonicalSea(roomId: string): Promise<JournalEvent[]> {
  const world = await loadWorld();
  const current = await readCanonicalSeaBase(roomId, world);
  if (!current.some(hasDerivedDependencies)) return current;

  // A continuing person's derived state may depend on an entitled belief or
  // loop from another Room. Resolve those edges against the canonical Sea
  // union so a later correction cannot leave a stale descendant visible in
  // this Room. Raw NDJSON history is untouched; only the canonical projection
  // omits causally invalid derived rows.
  const contextIds = [...new Set([...world.rooms.map(room => room.id), WORLD_CONTINUITY_ID])];
  const streams = await Promise.all(contextIds.map(id => id === roomId
    ? Promise.resolve(current)
    : readCanonicalSeaBase(id, world)));
  const invalid = tombstonedIds(streams.flat());
  return current.filter(event => !invalid.has(event.id));
}

export async function subscribeRoom(
  roomId: string,
  limit: number
): Promise<{ events: JournalEvent[]; headSeq: number }> {
  const events = await readCanonicalSea(roomId);
  const tail = events.slice(Math.max(0, events.length - limit));
  const headSeq = events.length > 0 ? events[events.length - 1].seq : 0;
  return { events: tail, headSeq };
}

export async function queryEvents(
  roomId: string,
  opts: { beforeSeq?: number; limit: number }
): Promise<JournalEvent[]> {
  const events = await readCanonicalSea(roomId);
  const before = opts.beforeSeq === undefined ? Number.POSITIVE_INFINITY : opts.beforeSeq;
  const eligible = events.filter((event) => event.seq < before);
  return eligible.slice(Math.max(0, eligible.length - opts.limit));
}

/** Sea-scope events only. Never returns thread-scoped events (structural: reads the Sea file only). */
export async function readSeaProjection(roomId: string, limit?: number): Promise<JournalEvent[]> {
  const events = await readCanonicalSea(roomId);
  if (limit === undefined || limit >= events.length) return events;
  return events.slice(events.length - limit);
}

export async function readThread(roomId: string, threadId: string): Promise<JournalEvent[]> {
  return canonicalEvents(await readStream(roomId, { kind: 'thread', threadId }));
}

/** Main-only erasure preparation; never commits pending playback or exposes content. */
export async function readThreadErasureIds(roomId: string, threadId: string): Promise<string[]> {
  return enqueueWrite(async () => (await readStreamUnlocked(roomId, { kind: 'thread', threadId })).map(event => event.id));
}

/** Physically removes a thread stream, retaining only its event ids in Sea provenance. */
export async function eraseThread(roomId: string, threadId: string, preparedSourceIds: readonly string[] = []): Promise<{ deletedCount: number }> {
  return enqueueWrite(async () => {
    const scope: EventScope = { kind: 'thread', threadId };
    const filePath = streamFilePath(roomId, scope);
    await loadStreamHead(streamKey(roomId, scope), filePath);
    // Erasure wins over previously staged retry work, even if the process restarts.
    await saveDeliveryOutbox(roomId, scope, []);
    let events: JournalEvent[] = [];
    try {
      const raw = await fs.promises.readFile(filePath, 'utf-8');
      events = raw
        .split('\n')
        .filter((line) => line.length > 0)
        .map((line) => JSON.parse(line) as JournalEvent);
      guardianForWrites()?.beginJournalErase(filePath);
      await fs.promises.unlink(filePath);
      guardianForWrites()?.finishJournalErase(filePath);
    } catch (error: unknown) {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error;
    }
    streamHeads.delete(streamKey(roomId, scope));
    const sourceEventIds = [...new Set([...preparedSourceIds, ...events.map(event => event.id)])];
    const payload: DeletionPayload = { threadId, sourceEventIds };
    const sea = await readStreamUnlocked(roomId, { kind: 'sea' });
    if (sea.some(event => event.type === 'deletion' && (event.payload as DeletionPayload | null)?.threadId === threadId
      && JSON.stringify((event.payload as DeletionPayload).sourceEventIds) === JSON.stringify(sourceEventIds))) {
      return { deletedCount: sourceEventIds.length };
    }
    await appendEventUnlocked(roomId, {
      roomId,
      scope: { kind: 'sea' },
      type: 'deletion',
      actorId: HARNESS_ACTOR,
      witnesses: [],
      payload,
      provenance: { sourceThreadEventIds: sourceEventIds },
    });
    return { deletedCount: sourceEventIds.length };
  });
}

export async function flushJournal(): Promise<void> {
  await writeQueue;
}

/**
 * Registers the journal IPC handlers (renderer-facing side of the bridge
 * chain). Flush-on-quit mirrors kvStore's before-quit pattern. Call once
 * from setupAllIPC() in main.ts.
 */
export function setupJournalIPC(): void {
  app.on('before-quit', () => {
    void flushJournal();
  });

  ipcMain.handle(IPC_CHANNELS.JOURNAL_APPEND, async (_event, roomId: string, draft: JournalEventDraft): Promise<JournalEvent> => {
    // Renderer Sea writes extend the persistent world. Main-internal
    // maintenance recovery calls appendEvent directly and stays unaffected.
    if (draft.scope.kind === 'sea') requireLivingWorld(loadSettings());
    if (draft.type === 'intention' || draft.type === 'occurrence.simulated' || draft.type === 'contact.invitation'
      || draft.provenance?.autonomyJobId || draft.provenance?.contactId) {
      throw new Error('[journal] autonomous and contact authority is main-owned');
    }
    return appendEvent(roomId, draft);
  });

  ipcMain.handle(IPC_CHANNELS.JOURNAL_SUBSCRIBE, async (_event, roomId: string, limit: number): Promise<{ events: JournalEvent[]; headSeq: number }> =>
    subscribeRoom(roomId, limit)
  );

  ipcMain.handle(IPC_CHANNELS.JOURNAL_QUERY, async (_event, roomId: string, opts: { beforeSeq?: number; limit: number }): Promise<JournalEvent[]> =>
    queryEvents(roomId, opts)
  );

  ipcMain.handle(IPC_CHANNELS.JOURNAL_READ_SEA, async (_event, roomId: string, limit?: number): Promise<JournalEvent[]> =>
    readSeaProjection(roomId, limit)
  );

  ipcMain.handle(IPC_CHANNELS.JOURNAL_READ_THREAD, async (_event, roomId: string, threadId: string): Promise<JournalEvent[]> =>
    readThread(roomId, threadId)
  );

  ipcMain.handle(
    IPC_CHANNELS.JOURNAL_ERASE_THREAD,
    async (_event, roomId: string, threadId: string): Promise<{ deletedCount: number }> => eraseThread(roomId, threadId)
  );
}
