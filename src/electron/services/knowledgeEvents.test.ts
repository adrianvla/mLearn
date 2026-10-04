import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { createTempDir } from '../../../test/helpers/tempDir';
import type { TempDir } from '../../../test/helpers/tempDir';
import { IPC_CHANNELS } from '../../shared/constants';
import type { KnowledgeEvent, KnowledgeEventLog } from '../../shared/knowledgeEvents';
import { grammarEvidenceKey } from '../../shared/grammar/evidence';

let tempDir: TempDir;
const warn = vi.fn();
const ipcHandle = vi.fn();
const getAllWindows = vi.fn();

vi.mock('electron', () => ({
  ipcMain: { handle: ipcHandle, on: vi.fn() },
  BrowserWindow: { getAllWindows },
}));

vi.mock('../utils/platform', () => ({
  getUserDataPath: vi.fn(() => tempDir?.tmpDir ?? '/tmp/test'),
}));

vi.mock('../../shared/utils/logger', () => ({
  getLogger: () => ({ warn, error: vi.fn(), info: vi.fn() }),
}));

let mod: typeof import('./knowledgeEvents');

const DAY = 24 * 60 * 60 * 1000;
const now = Date.UTC(2026, 7, 15, 12);

function event(t: number, overrides: Partial<KnowledgeEvent> = {}): KnowledgeEvent {
  return {
    t,
    kind: 'rollup',
    source: 'passiveTracking',
    aspect: 'meaning',
    timesSeenDelta: 1,
    ...overrides,
  };
}

beforeEach(async () => {
  tempDir = createTempDir();
  warn.mockReset();
  ipcHandle.mockReset();
  getAllWindows.mockReset().mockReturnValue([]);
  vi.resetModules();
  mod = await import('./knowledgeEvents');
  await mod.loadKnowledgeEvents(now);
});

afterEach(() => {
  tempDir.cleanup();
});

describe('knowledge event storage', () => {
  it('routes learning-evidence IPC through the asynchronous reader without rebuilding on the main thread', async () => {
    const { LearningEvidenceReader } = await import('./learningEvidenceReader');
    const { KnowledgeHistoryStore } = await import('./knowledgeHistoryStore');
    let finish!: (value: import('../../shared/learningEvidence').LearningEvidenceSnapshot) => void;
    const read = vi.spyOn(LearningEvidenceReader.prototype, 'query').mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const synchronous = vi.spyOn(KnowledgeHistoryStore.prototype, 'getLearningEvidence').mockImplementation(() => {
      throw new Error('Full-history rebuild entered the main thread');
    });
    try {
      mod.setupKnowledgeEventsIPC();
      await mod.whenKnowledgeEventsReady();
      const handler = ipcHandle.mock.calls.find(([name]) => name === IPC_CHANNELS.LEARNING_EVIDENCE_QUERY)![1];
      const reply = handler(undefined, 'future');
      await Promise.resolve();
      expect(read).toHaveBeenCalledWith('future', 0);
      expect(synchronous).not.toHaveBeenCalled();
      const snapshot = { sequence: 0, events: [], truncated: false };
      finish(snapshot);
      await expect(reply).resolves.toBe(snapshot);
    } finally { read.mockRestore(); synchronous.mockRestore(); }
  });
  it('counts only inserted evidence in Guardian and does not notify windows for an idempotent retry', async () => {
    const { Guardian, activateGuardian, inspectGuardianData } = await import('./guardian');
    const guardian = new Guardian(tempDir.tmpDir);
    await guardian.preflight();
    activateGuardian(guardian);
    const send = vi.fn();
    getAllWindows.mockReturnValue([{ isDestroyed: () => false, webContents: { send } }]);
    const batch = { 'pkg:one': [event(now, { eventId: 'same-observation' })] };
    await mod.appendKnowledgeEvents(batch);
    await mod.appendKnowledgeEvents(batch);
    expect(guardian.status.metrics?.knowledgeEvidenceCount).toBe(inspectGuardianData(tempDir.tmpDir).knowledgeEvidenceCount);
    expect(send).toHaveBeenCalledTimes(1);
    await expect(new Guardian(tempDir.tmpDir).preflight()).resolves.toBeUndefined();
  });

  it('appends and queries events by key', async () => {
    await mod.appendKnowledgeEvents({ 'ja:one': [event(now, { kind: 'status', toStatus: 'learning' })] });

    expect(mod.getKnowledgeEvents(['ja:one', 'ja:missing'])).toEqual({
      'ja:one': [event(now, { kind: 'status', toStatus: 'learning' })],
    });
  });

  it('returns an empty log for an empty store', () => {
    expect(mod.getKnowledgeEvents(['ja:missing'])).toEqual({});
  });

  it('refuses oversized legacy object replies while serving the same rows in bounded pages', async () => {
    const key = 'xx:oversized';
    await mod.appendKnowledgeEvents({ [key]: [event(now, { origin: '漢字😀'.repeat(90_000) })] });
    mod.setupKnowledgeEventsIPC();
    const handler = (channel: string) => ipcHandle.mock.calls.find(([name]) => name === channel)?.[1] as (...args: unknown[]) => Promise<unknown>;
    await expect(handler(IPC_CHANNELS.KNOWLEDGE_EVENTS_QUERY)(undefined, [key]))
      .rejects.toThrow('use paged event reads');
    const page = await handler(IPC_CHANNELS.KNOWLEDGE_EVENTS_PAGE)(undefined, key, null) as { fragment?: { data: string } };
    expect(page.fragment?.data).toBeTypeOf('string');
    expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThanOrEqual(512 * 1024);
  });

  it('refreshes the compact grammar projection after an acknowledged append', async () => {
    const key = grammarEvidenceKey('xx', 'pattern', 'grammar-recognition');
    await mod.appendKnowledgeEvents({ [key]: [{ t: 1, kind: 'rating', source: 'grammar', aspect: 'grammar', easeAfter: 2 }] });
    expect(mod.queryGrammarProjections('xx')[key]?.ease).toBe(2);
    await mod.appendKnowledgeEvents({ [key]: [{ t: 2, kind: 'rating', source: 'grammar', aspect: 'grammar', easeAfter: 3 }] });
    expect(mod.queryGrammarProjections('xx')[key]?.ease).toBe(3);
  });

  it('queries all entries for one language while preserving their keys', async () => {
    const japanese = event(now, { kind: 'status', toStatus: 'learning' });
    const german = event(now + 1, { kind: 'status', toStatus: 'known' });
    await mod.appendKnowledgeEvents({ 'ja:one': [japanese], 'ja:two': [japanese], 'de:one': [german] });

    expect(mod.getKnowledgeEventsForLanguage('ja')).toEqual({
      'ja:one': [japanese],
      'ja:two': [japanese],
    });
  });

  it('never evicts status, review, or rating events', async () => {
    const protectedEvents = [
      event(now - 3 * DAY, { kind: 'status' }),
      event(now - 2 * DAY, { kind: 'review', rating: 'again' }),
      event(now - DAY, { kind: 'rating' }),
    ];
    const rollups = Array.from({ length: 501 }, (_, index) => event(now + index));

    await mod.appendKnowledgeEvents({ 'ja:one': [...protectedEvents, ...rollups] });

    expect(mod.getKnowledgeEvents(['ja:one'])['ja:one']).toEqual(expect.arrayContaining(protectedEvents));
  });

  it('preserves the first event as the acquisition anchor even when it is a rollup', async () => {
    const anchor = event(now - 600 * DAY);
    const rollups = Array.from({ length: 500 }, (_, index) => event(now - 500 * DAY + index));

    await mod.appendKnowledgeEvents({ 'ja:one': [anchor, ...rollups] });

    const events = mod.getKnowledgeEvents(['ja:one'])['ja:one'];
    expect(events).toContainEqual(anchor);
    expect(events.filter(({ kind }) => kind === 'rollup')).toHaveLength(501);
  });

describe('knowledge event validation on append', () => {
  it('keeps retraction tombstones, aspects, claims, migration rows, and provenance', async () => {
    const tombstone = event(now, { kind: 'retraction', source: 'manual', retracts: 'attempt-1' });
    const packageAspectEvent = event(now + 1, { kind: 'status', aspect: 'x-acme::classifier', toStatus: 'learning' });
    const orthographyEvent = event(now + 2, { kind: 'rating', source: 'manual', aspect: 'orthography' });
    const claim = event(now + 3, { kind: 'claim', source: 'manual', toStatus: 'known' });
    const migration = event(now + 4, { kind: 'status', source: 'migration', toStatus: 'known', easeAfter: 1.8 });
    const scaffolded = event(now + 5, {
      kind: 'rating',
      source: 'manual',
      aspect: 'meaning',
      taskType: 'srs-review',
      scaffolds: { reading: true, translation: false, 'x-acme::tone-ladder': true },
    });

    await mod.appendKnowledgeEvents({
      'ru:one': [tombstone, packageAspectEvent, orthographyEvent, claim, migration, scaffolded],
    });

    const kept = mod.getKnowledgeEvents(['ru:one'])['ru:one'];
    expect(kept).toContainEqual(tombstone);
    expect(kept).toContainEqual(packageAspectEvent);
    expect(kept).toContainEqual(orthographyEvent);
    expect(kept).toContainEqual(claim);
    expect(kept).toContainEqual(migration);
    expect(kept).toContainEqual(scaffolded);
  });

  it('drops malformed events on append (bad attemptId, empty taskType, non-boolean scaffolds)', async () => {
    await mod.appendKnowledgeEvents({
      'ja:x': [
        event(now),
        { t: now, kind: 'rating', source: 'manual', aspect: 'meaning', attemptId: { malformed: true } } as unknown as KnowledgeEvent,
        { t: now, kind: 'rating', source: 'manual', aspect: 'meaning', taskType: '' } as unknown as KnowledgeEvent,
        { t: now, kind: 'rating', source: 'manual', aspect: 'meaning', scaffolds: { reading: 'yes' } } as unknown as KnowledgeEvent,
        { t: now, kind: 'rating', source: 'manual', aspect: 'meaning', scaffolds: [true] } as unknown as KnowledgeEvent,
      ],
    });

    expect(mod.getKnowledgeEvents(['ja:x'])['ja:x']).toEqual([event(now)]);
  });
});

describe('knowledge event IPC readiness and broadcast', () => {
  it('notifies every browser window after an append', async () => {
    const sendFirst = vi.fn();
    const sendSecond = vi.fn();
    getAllWindows.mockReturnValue([
      { isDestroyed: () => false, webContents: { send: sendFirst } },
      { isDestroyed: () => false, webContents: { send: sendSecond } },
    ]);

    await mod.appendKnowledgeEvents({ 'ja:one': [event(now, { kind: 'status', toStatus: 'learning' })] });

    expect(sendFirst).toHaveBeenCalledWith(IPC_CHANNELS.KNOWLEDGE_EVENTS_CHANGED, ['ja:one']);
    expect(sendSecond).toHaveBeenCalledWith(IPC_CHANNELS.KNOWLEDGE_EVENTS_CHANGED, ['ja:one']);
  });

  it('migrates a legacy journal at first open and serves it to a query', async () => {
    // Fresh profile dir: the beforeEach already opened (and closed) the
    // store for this test, which marks migration done.
    tempDir = createTempDir();
    const stored = event(now, { kind: 'status', toStatus: 'learning' });
    fs.writeFileSync(path.join(tempDir.tmpDir, 'knowledge-events.json'), JSON.stringify({ 'ja:early': [stored] }));

    // Fresh module state: the JSON journal is present at first open.
    vi.resetModules();
    const fresh = await import('./knowledgeEvents');
    fresh.setupKnowledgeEventsIPC();
    const queryHandler = ipcHandle.mock.calls
      .find(([channel]) => channel === IPC_CHANNELS.KNOWLEDGE_EVENTS_QUERY)?.[1];
    expect(queryHandler).toBeTypeOf('function');

    await expect(
      (queryHandler as (_event: unknown, keys: string[]) => Promise<KnowledgeEventLog>)(undefined, ['ja:early']),
    ).resolves.toEqual({ 'ja:early': [stored] });
    expect(fs.existsSync(path.join(tempDir.tmpDir, 'knowledge-events.json.migrated'))).toBe(true);
  });
});
});
