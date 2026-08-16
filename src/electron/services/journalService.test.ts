import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { createTempDir } from '../../../test/helpers/tempDir';
import type { TempDir } from '../../../test/helpers/tempDir';
import type { JournalEventDraft } from '../../shared/world';

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/tmp/test'),
    isPackaged: false,
  },
}));

let tempDir: TempDir;

vi.mock('../utils/platform', () => ({
  getUserDataPath: vi.fn(() => tempDir?.tmpDir ?? '/tmp/test'),
}));

let mod: typeof import('./journalService');

describe('journalService', () => {
  let roomId: string;

  const seaDraft = (overrides: Partial<JournalEventDraft> = {}): JournalEventDraft => ({
    roomId,
    scope: { kind: 'sea' },
    type: 'message.user',
    actorId: 'user',
    witnesses: ['user'],
    payload: { text: 'hello' },
    ...overrides,
  });

  beforeEach(async () => {
    tempDir = createTempDir();
    vi.resetModules();
    mod = await import('./journalService');
    roomId = 'room-test-1';
  });

  afterEach(() => {
    tempDir.cleanup();
  });

  it('assigns evt_ ids and monotonic per-stream seqs (Sea and Thread independent)', async () => {
    const sea1 = await mod.appendEvent(roomId, seaDraft());
    const sea2 = await mod.appendEvent(roomId, seaDraft());
    const thread1 = await mod.appendEvent(roomId, seaDraft({ scope: { kind: 'thread', threadId: 't1' } }));
    const thread2 = await mod.appendEvent(roomId, seaDraft({ scope: { kind: 'thread', threadId: 't1' } }));
    const sea3 = await mod.appendEvent(roomId, seaDraft());

    for (const event of [sea1, sea2, thread1, thread2, sea3]) {
      expect(event.id.startsWith('evt_')).toBe(true);
    }
    expect([sea1.seq, sea2.seq, sea3.seq]).toEqual([1, 2, 3]);
    expect([thread1.seq, thread2.seq]).toEqual([1, 2]);
  });

  it('survives service restart — events readable from fresh module state', async () => {
    const sea = await mod.appendEvent(roomId, seaDraft());
    await mod.appendEvent(roomId, seaDraft({ scope: { kind: 'thread', threadId: 't9' } }));

    vi.resetModules();
    mod = await import('./journalService');

    const { events, headSeq } = await mod.subscribeRoom(roomId, 50);
    expect(headSeq).toBe(1);
    expect(events).toHaveLength(1);
    expect(events[0].id).toBe(sea.id);
    expect(events[0].scope).toEqual({ kind: 'sea' });

    const thread = await mod.readThread(roomId, 't9');
    expect(thread).toHaveLength(1);
    expect(thread[0].scope).toEqual({ kind: 'thread', threadId: 't9' });
  });

  it('readSeaProjection excludes thread-scoped events', async () => {
    await mod.appendEvent(roomId, seaDraft({ type: 'membership', payload: { add: 'character-a' } }));
    await mod.appendEvent(roomId, seaDraft({ scope: { kind: 'thread', threadId: 't1' } }));

    const projection = await mod.readSeaProjection(roomId);
    expect(projection).toHaveLength(1);
    expect(projection[0].scope).toEqual({ kind: 'sea' });
    expect(projection[0].type).toBe('membership');
  });

  it('readThread returns only the requested thread stream', async () => {
    await mod.appendEvent(roomId, seaDraft());
    await mod.appendEvent(roomId, seaDraft({ scope: { kind: 'thread', threadId: 'ta' } }));
    await mod.appendEvent(roomId, seaDraft({ scope: { kind: 'thread', threadId: 'tb' } }));

    const ta = await mod.readThread(roomId, 'ta');
    expect(ta).toHaveLength(1);
    expect(ta[0].scope).toEqual({ kind: 'thread', threadId: 'ta' });

    const tb = await mod.readThread(roomId, 'tb');
    expect(tb).toHaveLength(1);
    expect(tb[0].scope).toEqual({ kind: 'thread', threadId: 'tb' });
  });

  it('queryEvents paginates the Sea stream older-first', async () => {
    for (let i = 0; i < 5; i++) {
      await mod.appendEvent(roomId, seaDraft());
    }
    const page = await mod.queryEvents(roomId, { beforeSeq: 5, limit: 2 });
    expect(page.map((event) => event.seq)).toEqual([3, 4]);
  });

  it('subscribeRoom returns the tail and the current head seq', async () => {
    for (let i = 0; i < 4; i++) {
      await mod.appendEvent(roomId, seaDraft());
    }
    const { events, headSeq } = await mod.subscribeRoom(roomId, 2);
    expect(headSeq).toBe(4);
    expect(events.map((event) => event.seq)).toEqual([3, 4]);
  });

  it('subscribeRoom on an empty room returns empty tail with headSeq 0', async () => {
    const { events, headSeq } = await mod.subscribeRoom(roomId, 10);
    expect(events).toEqual([]);
    expect(headSeq).toBe(0);
  });

  it('recovers from a mid-line truncated file (simulated crash)', async () => {
    for (let i = 0; i < 3; i++) {
      await mod.appendEvent(roomId, seaDraft());
    }
    const seaFile = path.join(tempDir.tmpDir, 'journal', roomId, 'sea.ndjson');
    fs.appendFileSync(seaFile, '{"id":"evt_partial",');

    vi.resetModules();
    mod = await import('./journalService');

    const { events, headSeq } = await mod.subscribeRoom(roomId, 50);
    expect(events).toHaveLength(3);
    expect(headSeq).toBe(3);

    const after = fs.readFileSync(seaFile, 'utf-8');
    expect(after.includes('evt_partial')).toBe(false);
    expect(after.endsWith('}\n')).toBe(true);

    const next = await mod.appendEvent(roomId, seaDraft());
    expect(next.seq).toBe(4);
    const afterAppend = await mod.readSeaProjection(roomId);
    expect(afterAppend).toHaveLength(4);
  });

  it('flushJournal drains in-flight appends', async () => {
    const first = mod.appendEvent(roomId, seaDraft());
    const second = mod.appendEvent(roomId, seaDraft());
    await mod.flushJournal();
    await Promise.all([first, second]);

    const { events, headSeq } = await mod.subscribeRoom(roomId, 50);
    expect(headSeq).toBe(2);
    expect(events).toHaveLength(2);
  });
});
