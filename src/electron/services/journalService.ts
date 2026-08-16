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
import type { EventScope, JournalEvent, JournalEventDraft } from '../../shared/world';

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
 * Crash recovery: if a line fails JSON.parse (partial write), truncate the
 * file to the end of the last complete line and continue.
 * Must only be called from within the write queue.
 */
async function loadStreamHead(key: string, filePath: string): Promise<StreamState> {
  const cached = streamHeads.get(key);
  if (cached?.loaded) return cached;
  const state: StreamState = { headSeq: 0, loaded: true };
  streamHeads.set(key, state);
  try {
    await fs.promises.access(filePath);
  } catch {
    return state; // stream file does not exist yet
  }
  const raw = await fs.promises.readFile(filePath, 'utf-8');
  const lines = raw.split('\n');
  const complete: string[] = [];
  for (const line of lines) {
    if (line.length === 0) continue;
    try {
      JSON.parse(line);
      complete.push(line);
    } catch {
      break; // partial tail — discard everything after the last complete line
    }
  }
  if (complete.length < lines.length) {
    const recovered = complete.length > 0 ? `${complete.join('\n')}\n` : '';
    await fs.promises.writeFile(filePath, recovered, 'utf-8');
    log.warn(`[journal] Discarded partial tail of ${filePath} (crash recovery)`);
  }
  const last = complete[complete.length - 1];
  if (last !== undefined) {
    state.headSeq = (JSON.parse(last) as JournalEvent).seq;
  }
  return state;
}

async function readStream(roomId: string, scope: EventScope): Promise<JournalEvent[]> {
  return enqueueWrite(async () => {
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
      log.error(`[journal] Failed to read stream ${filePath}:`, error);
      return [];
    }
  });
}

/** Assigns id/seq/createdAt and appends one line to the scope's stream file. */
export async function appendEvent(roomId: string, draft: JournalEventDraft): Promise<JournalEvent> {
  return enqueueWrite(async () => {
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
    await fs.promises.appendFile(filePath, `${JSON.stringify(event)}\n`, 'utf-8');
    state.headSeq = seq;
    return event;
  });
}

export async function subscribeRoom(
  roomId: string,
  limit: number
): Promise<{ events: JournalEvent[]; headSeq: number }> {
  const events = await readStream(roomId, { kind: 'sea' });
  const tail = events.slice(Math.max(0, events.length - limit));
  const headSeq = events.length > 0 ? events[events.length - 1].seq : 0;
  return { events: tail, headSeq };
}

export async function queryEvents(
  roomId: string,
  opts: { beforeSeq?: number; limit: number }
): Promise<JournalEvent[]> {
  const events = await readStream(roomId, { kind: 'sea' });
  const before = opts.beforeSeq === undefined ? Number.POSITIVE_INFINITY : opts.beforeSeq;
  const eligible = events.filter((event) => event.seq < before);
  return eligible.slice(Math.max(0, eligible.length - opts.limit));
}

/** Sea-scope events only. Never returns thread-scoped events (structural: reads the Sea file only). */
export async function readSeaProjection(roomId: string, limit?: number): Promise<JournalEvent[]> {
  const events = await readStream(roomId, { kind: 'sea' });
  if (limit === undefined || limit >= events.length) return events;
  return events.slice(events.length - limit);
}

export async function readThread(roomId: string, threadId: string): Promise<JournalEvent[]> {
  return readStream(roomId, { kind: 'thread', threadId });
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

  ipcMain.handle(IPC_CHANNELS.JOURNAL_APPEND, async (_event, roomId: string, draft: JournalEventDraft): Promise<JournalEvent> =>
    appendEvent(roomId, draft)
  );

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
}
