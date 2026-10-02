import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { createTempDir } from '../../../test/helpers/tempDir';
import type { TempDir } from '../../../test/helpers/tempDir';
import type { JournalEventDraft } from '../../shared/world';
import { IPC_CHANNELS } from '../../shared/constants';

const ipcHandlers = vi.hoisted(() => new Map<string, (...args: unknown[]) => unknown>());

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/tmp/test'),
    isPackaged: false,
    on: vi.fn(),
  },
  ipcMain: { handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => ipcHandlers.set(channel, handler)) },
}));

vi.mock('./settings', () => ({ loadSettings: () => ({ livingWorldEnabled: true }) }));

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

  /** Thread-scoped appends require a live Thread record with matching Room. */
  const seedThread = (threadId: string): void => {
    fs.writeFileSync(path.join(tempDir.tmpDir, 'world.json'), JSON.stringify({
      rooms: [],
      threads: [{ id: threadId, roomId, state: 'active', createdAt: 1 }],
      participants: [],
    }));
  };

  beforeEach(async () => {
    tempDir = createTempDir();
    ipcHandlers.clear();
    vi.resetModules();
    mod = await import('./journalService');
    roomId = 'room-test-1';
  });

  afterEach(() => {
    tempDir.cleanup();
  });

  it('assigns evt_ ids and monotonic per-stream seqs (Sea and Thread independent)', async () => {
    seedThread('t1');
    const sea1 = await mod.appendEvent(roomId, seaDraft());
    const sea2 = await mod.appendEvent(roomId, seaDraft());
    seedThread('t1');
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
    seedThread('t9');
    const sea = await mod.appendEvent(roomId, seaDraft());
    seedThread('t9');
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
    seedThread('t1');
    await mod.appendEvent(roomId, seaDraft({ type: 'membership', payload: { add: 'character-a' } }));
    seedThread('t1');
    await mod.appendEvent(roomId, seaDraft({ scope: { kind: 'thread', threadId: 't1' } }));

    const projection = await mod.readSeaProjection(roomId);
    expect(projection).toHaveLength(1);
    expect(projection[0].scope).toEqual({ kind: 'sea' });
    expect(projection[0].type).toBe('membership');
  });

  it('validates and persists exact-message voice delivery and rejects sibling or audience rewrites', async () => {
    const speech = await mod.appendEvent(roomId, seaDraft({ type: 'message.character', actorId: 'character-a',
      witnesses: ['user', 'character-a'], payload: { text: 'First. Second.', modality: 'voice', voiceSessionId: 'call', voiceDelivery: 'tracked' } }));
    const draft = seaDraft({ type: 'delivery.voice', actorId: 'harness', witnesses: speech.witnesses,
      payload: { messageEventId: speech.id, actorId: speech.actorId, voiceSessionId: 'call', state: 'interrupted',
        spokenText: 'First. Sec', confirmedText: 'First.', basis: 'playback-estimate' } });
    await expect(mod.appendEvent(roomId, { ...draft, payload: { ...(draft.payload as object), actorId: 'character-b' } })).rejects.toThrow('delivery');
    await expect(mod.appendEvent(roomId, { ...draft, witnesses: [...speech.witnesses, 'outsider'] })).rejects.toThrow('delivery');
    const saved = await mod.appendEvent(roomId, draft);
    expect((await mod.readSeaProjection(roomId)).map(event => event.id)).toEqual([speech.id, saved.id]);
    expect(await mod.appendEvent(roomId, draft)).toEqual(saved);
    await expect(mod.appendEvent(roomId, { ...draft, payload: { ...(draft.payload as object), state: 'completed',
      spokenText: 'First. Second.', confirmedText: 'First. Second.', basis: 'playback-complete' } })).rejects.toThrow('delivery');
    vi.resetModules();
    mod = await import('./journalService');
    expect((await mod.readSeaProjection(roomId))[1].payload).toEqual(draft.payload);
  });

  it('readThread returns only the requested thread stream', async () => {
    seedThread('ta');
    seedThread('tb');
    await mod.appendEvent(roomId, seaDraft());
    seedThread('ta');
    await mod.appendEvent(roomId, seaDraft({ scope: { kind: 'thread', threadId: 'ta' } }));
    seedThread('tb');
    await mod.appendEvent(roomId, seaDraft({ scope: { kind: 'thread', threadId: 'tb' } }));

    const ta = await mod.readThread(roomId, 'ta');
    expect(ta).toHaveLength(1);
    expect(ta[0].scope).toEqual({ kind: 'thread', threadId: 'ta' });

    const tb = await mod.readThread(roomId, 'tb');
    expect(tb).toHaveLength(1);
    expect(tb[0].scope).toEqual({ kind: 'thread', threadId: 'tb' });
  });

  it('keeps staged private voice notes hidden until completion and releases them after service restart', async () => {
    seedThread('voice-notes');
    const scope = { kind: 'thread' as const, threadId: 'voice-notes' };
    const speech = await mod.appendEvent(roomId, seaDraft({ scope, type: 'message.character', actorId: 'character-a',
      witnesses: ['user', 'character-a', 'character-b'], payload: { text: 'Noted.', modality: 'voice', voiceSessionId: 'call', voiceDelivery: 'tracked' } }));
    const note = await mod.appendEvent(roomId, seaDraft({ scope, type: 'memory.belief', actorId: 'harness',
      witnesses: ['user', 'character-a'], provenance: { voiceMemoryMessageId: speech.id },
      payload: { ownerId: 'character-a', kind: 'belief', text: 'Private reviewed note', sourceEventIds: [speech.id] } }));
    expect((await mod.readThread(roomId, scope.threadId)).map(event => event.id)).toEqual([speech.id]);
    await mod.appendEvent(roomId, seaDraft({ scope, type: 'delivery.voice', actorId: 'harness', witnesses: speech.witnesses,
      payload: { messageEventId: speech.id, actorId: speech.actorId, voiceSessionId: 'call', state: 'completed',
        spokenText: 'Noted.', confirmedText: 'Noted.', basis: 'playback-complete' } }));
    vi.resetModules(); mod = await import('./journalService');
    expect((await mod.readThread(roomId, scope.threadId)).find(event => event.id === note.id)).toMatchObject({
      witnesses: ['user', 'character-a'], inferenceAvailabilitySeq: 3, payload: { text: 'Private reviewed note' } });
    await mod.eraseThread(roomId, scope.threadId);
    expect(await mod.readThread(roomId, scope.threadId)).toEqual([]);
  });

  it('recovers a durably queued delivery after an append failure and restart without duplicating it', async () => {
    const speech = await mod.appendEvent(roomId, seaDraft({ type: 'message.character', actorId: 'character-a',
      witnesses: ['user', 'character-a'], payload: { text: 'Noted.', modality: 'voice', voiceSessionId: 'call', voiceDelivery: 'tracked' } }));
    const draft = seaDraft({ type: 'delivery.voice', actorId: 'harness', witnesses: speech.witnesses,
      payload: { messageEventId: speech.id, actorId: speech.actorId, voiceSessionId: 'call', state: 'completed',
        spokenText: 'Noted.', confirmedText: 'Noted.', basis: 'playback-complete' } });
    const append = vi.spyOn(fs.promises, 'appendFile').mockRejectedValueOnce(new Error('Journal write unavailable'));
    await expect(mod.appendEvent(roomId, draft)).rejects.toThrow('Journal write unavailable');
    append.mockRestore();
    vi.resetModules(); mod = await import('./journalService');
    const restored = await mod.readSeaProjection(roomId);
    expect(restored.filter(event => event.type === 'delivery.voice')).toHaveLength(1);
    const saved = restored.find(event => event.type === 'delivery.voice')!;
    expect(saved.payload).toEqual(draft.payload);
    expect(await mod.appendEvent(roomId, draft)).toEqual(saved);
    expect((await mod.readSeaProjection(roomId)).filter(event => event.type === 'delivery.voice')).toHaveLength(1);
  });

  it('repairs a torn rejected append and recovers delivery on the next read without restart', async () => {
    const speech = await mod.appendEvent(roomId, seaDraft({ type: 'message.character', actorId: 'character-a',
      witnesses: ['user', 'character-a'], payload: { text: 'Noted.', modality: 'voice', voiceSessionId: 'call', voiceDelivery: 'tracked' } }));
    const draft = seaDraft({ type: 'delivery.voice', actorId: 'harness', witnesses: speech.witnesses,
      payload: { messageEventId: speech.id, actorId: speech.actorId, voiceSessionId: 'call', state: 'completed',
        spokenText: 'Noted.', confirmedText: 'Noted.', basis: 'playback-complete' } });
    const original = fs.promises.appendFile.bind(fs.promises);
    const append = vi.spyOn(fs.promises, 'appendFile').mockImplementationOnce(async (file, data) => {
      await original(file, String(data).slice(0, 20), 'utf-8');
      throw new Error('Torn journal append');
    });
    await expect(mod.appendEvent(roomId, draft)).rejects.toThrow();
    append.mockRestore();
    const recovered = await mod.readSeaProjection(roomId);
    expect(recovered.map(event => event.type)).toEqual(['message.character', 'delivery.voice']);
    expect(recovered[1].payload).toEqual(draft.payload);
  });

  it('does not resurrect queued playback after disposable thread erasure', async () => {
    seedThread('failed-delivery');
    const scope = { kind: 'thread' as const, threadId: 'failed-delivery' };
    const speech = await mod.appendEvent(roomId, seaDraft({ scope, type: 'message.character', actorId: 'character-a',
      witnesses: ['user', 'character-a'], payload: { text: 'Noted.', modality: 'voice', voiceSessionId: 'call', voiceDelivery: 'tracked' } }));
    const append = vi.spyOn(fs.promises, 'appendFile').mockRejectedValueOnce(new Error('Journal write unavailable'));
    await expect(mod.appendEvent(roomId, seaDraft({ scope, type: 'delivery.voice', actorId: 'harness', witnesses: speech.witnesses,
      payload: { messageEventId: speech.id, actorId: speech.actorId, voiceSessionId: 'call', state: 'completed',
        spokenText: 'Noted.', confirmedText: 'Noted.', basis: 'playback-complete' } }))).rejects.toThrow();
    append.mockRestore();
    fs.writeFileSync(path.join(tempDir.tmpDir, 'journal', roomId, 'threads', 'failed-delivery.ndjson.voice-outbox.json.tmp'), 'private incomplete staging');
    await mod.eraseThread(roomId, scope.threadId);
    vi.resetModules(); mod = await import('./journalService');
    expect(await mod.readThread(roomId, scope.threadId)).toEqual([]);
    expect(fs.existsSync(path.join(tempDir.tmpDir, 'journal', roomId, 'threads', 'failed-delivery.ndjson'))).toBe(false);
    expect(fs.readdirSync(path.join(tempDir.tmpDir, 'journal', roomId, 'threads'))).toEqual([]);
  });

  it('keeps queued progress and terminal observations ordered across repeated journal failure', async () => {
    const speech = await mod.appendEvent(roomId, seaDraft({ type: 'message.character', actorId: 'character-a',
      witnesses: ['user', 'character-a'], payload: { text: 'First. Second.', modality: 'voice', voiceSessionId: 'call', voiceDelivery: 'tracked' } }));
    const base = seaDraft({ type: 'delivery.voice', actorId: 'harness', witnesses: speech.witnesses,
      payload: { messageEventId: speech.id, actorId: speech.actorId, voiceSessionId: 'call', state: 'playing',
        spokenText: 'First.', confirmedText: 'First.', basis: 'playback-complete' } });
    const final = { ...base, payload: { ...(base.payload as object), state: 'completed', spokenText: 'First. Second.', confirmedText: 'First. Second.' } };
    const append = vi.spyOn(fs.promises, 'appendFile').mockRejectedValue(new Error('Journal write unavailable'));
    await expect(mod.appendEvent(roomId, base)).rejects.toThrow('Journal write unavailable');
    await expect(mod.appendEvent(roomId, final)).rejects.toThrow('Journal write unavailable');
    await expect(mod.appendEvent(roomId, { ...base, payload: { ...(base.payload as object), state: 'stopped', spokenText: '', confirmedText: '' } })).rejects.toThrow('terminal');
    append.mockRestore();
    vi.resetModules(); mod = await import('./journalService');
    const deliveries = (await mod.readSeaProjection(roomId)).filter(event => event.type === 'delivery.voice');
    expect(deliveries.map(event => (event.payload as { state: string }).state)).toEqual(['playing', 'completed']);
    expect(await mod.appendEvent(roomId, base)).toEqual(deliveries[0]);
  });

  it('does not negate a committed delivery ACK when recovery cleanup fails', async () => {
    const speech = await mod.appendEvent(roomId, seaDraft({ type: 'message.character', actorId: 'character-a',
      witnesses: ['user', 'character-a'], payload: { text: 'Noted.', modality: 'voice', voiceSessionId: 'call', voiceDelivery: 'tracked' } }));
    const draft = seaDraft({ type: 'delivery.voice', actorId: 'harness', witnesses: speech.witnesses,
      payload: { messageEventId: speech.id, actorId: speech.actorId, voiceSessionId: 'call', state: 'completed',
        spokenText: 'Noted.', confirmedText: 'Noted.', basis: 'playback-complete' } });
    const unlink = vi.spyOn(fs.promises, 'unlink').mockRejectedValueOnce(new Error('Cleanup unavailable'));
    const saved = await mod.appendEvent(roomId, draft);
    unlink.mockRestore();
    vi.resetModules(); mod = await import('./journalService');
    const records = (await mod.readSeaProjection(roomId)).filter(event => event.type === 'delivery.voice');
    expect(records).toEqual([saved]);
  });

  it('rejects widened, unrelated, missing-source and restricted voice note dependencies', async () => {
    const user = await mod.appendEvent(roomId, seaDraft({ witnesses: ['user', 'character-a'], payload: { text: 'A private learner utterance' } }));
    const speech = await mod.appendEvent(roomId, seaDraft({ type: 'message.character', actorId: 'character-a',
      witnesses: ['user', 'character-a', 'character-b'], payload: { text: 'Noted.', modality: 'voice', voiceSessionId: 'call', voiceDelivery: 'tracked' } }));
    const note = seaDraft({ type: 'memory.belief', actorId: 'harness', witnesses: ['user', 'character-a'],
      provenance: { voiceMemoryMessageId: speech.id }, payload: { ownerId: speech.actorId, kind: 'belief', text: 'Reviewed note', sourceEventIds: [user.id, speech.id] } });
    await expect(mod.appendEvent(roomId, { ...note, witnesses: ['user', 'character-a', 'character-b'] })).rejects.toThrow('memory');
    await expect(mod.appendEvent(roomId, { ...note, payload: { ...(note.payload as object), ownerId: 'character-b' } })).rejects.toThrow('memory');
    await expect(mod.appendEvent(roomId, { ...note, payload: { ...(note.payload as object), sourceEventIds: ['missing', speech.id] } })).rejects.toThrow('memory');
    await mod.appendEvent(roomId, seaDraft({ type: 'review.boundary', actorId: 'harness', witnesses: ['user'], payload: { sourceEventId: user.id } }));
    await expect(mod.appendEvent(roomId, note)).rejects.toThrow('memory');
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

  it('preserves complete history when corruption is followed by valid events', async () => {
    await mod.appendEvent(roomId, seaDraft());
    await mod.appendEvent(roomId, seaDraft());
    const file = path.join(tempDir.tmpDir, 'journal', roomId, 'sea.ndjson');
    const [first, second] = fs.readFileSync(file, 'utf8').trimEnd().split('\n');
    const damaged = `${first}\n{broken}\n${second}\n`;
    fs.writeFileSync(file, damaged);
    vi.resetModules();
    mod = await import('./journalService');

    await expect(mod.readSeaProjection(roomId)).rejects.toThrow();
    await expect(mod.appendEvent(roomId, seaDraft())).rejects.toThrow();
    expect(fs.readFileSync(file, 'utf8')).toBe(damaged);
  });

  it('retries failed head recovery without restarting sequence numbers', async () => {
    await mod.appendEvent(roomId, seaDraft());
    await mod.appendEvent(roomId, seaDraft());
    vi.resetModules();
    mod = await import('./journalService');
    const read = vi.spyOn(fs.promises, 'readFile');
    read.mockRejectedValueOnce(Object.assign(new Error('temporarily unreadable'), { code: 'EIO' }));
    await expect(mod.readPreparedMaintenanceEvents(roomId, { kind: 'sea' }, 'unused')).rejects.toThrow();
    read.mockRestore();

    const next = await mod.appendEvent(roomId, seaDraft());
    expect(next.seq).toBe(3);
    expect((await mod.readSeaProjection(roomId)).map(event => event.seq)).toEqual([1, 2, 3]);
  });

  it('separates a complete final record without a newline before appending', async () => {
    await mod.appendEvent(roomId, seaDraft());
    const file = path.join(tempDir.tmpDir, 'journal', roomId, 'sea.ndjson');
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').trimEnd());
    vi.resetModules();
    mod = await import('./journalService');

    expect((await mod.appendEvent(roomId, seaDraft())).seq).toBe(2);
    expect((await mod.readSeaProjection(roomId)).map(event => event.seq)).toEqual([1, 2]);
  });

  it('rejects renderer attempts to claim autonomous occurrence authority', async () => {
    mod.setupJournalIPC();
    const append = ipcHandlers.get(IPC_CHANNELS.JOURNAL_APPEND)!;
    await expect(append({}, roomId, seaDraft({
      type: 'occurrence.simulated',
      actorId: 'participant-a',
      witnesses: ['participant-a'],
      payload: {},
      provenance: { autonomyJobId: 'forged-job' },
    }))).rejects.toThrow(/main-owned/);
    expect(await mod.readSeaProjection(roomId)).toEqual([]);
  });
});
