import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { createTempDir } from '../../../test/helpers/tempDir';
import type { TempDir } from '../../../test/helpers/tempDir';
import { IPC_CHANNELS } from '../../shared/constants';
import type { KnowledgeEvent, KnowledgeEventLog } from '../../shared/knowledgeEvents';

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
  it('appends and queries events by key', async () => {
    await mod.appendKnowledgeEvents({ 'ja:one': [event(now, { kind: 'status', toStatus: 'learning' })] });

    expect(mod.getKnowledgeEvents(['ja:one', 'ja:missing'])).toEqual({
      'ja:one': [event(now, { kind: 'status', toStatus: 'learning' })],
    });
  });

  it('returns an empty log for an empty store', () => {
    expect(mod.getKnowledgeEvents(['ja:missing'])).toEqual({});
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

  it('consolidates old rollups into one ISO-week event with the latest values and summed encounters', async () => {
    const monday = Date.UTC(2026, 3, 6, 10);
    const wednesday = Date.UTC(2026, 3, 8, 10);
    const file = path.join(tempDir.tmpDir, 'knowledge-events.json');
    fs.writeFileSync(file, JSON.stringify({
      'ja:one': [
        event(monday - DAY, { kind: 'status' }),
        event(monday, { easeAfter: 1.4, timesSeenDelta: 2 }),
        event(wednesday, { easeAfter: 1.7, timesSeenDelta: 3 }),
      ],
    }));

    await mod.loadKnowledgeEvents(now);

    expect(mod.getKnowledgeEvents(['ja:one'])['ja:one']).toEqual([
      event(monday - DAY, { kind: 'status' }),
      event(wednesday, { easeAfter: 1.7, timesSeenDelta: 5 }),
    ]);
  });

  it('evicts the oldest rollups first while keeping protected events', async () => {
    const rollups = Array.from({ length: 501 }, (_, index) => event(now - (501 - index) * DAY));
    const protectedEvent = event(now, { kind: 'review', rating: 'good' });

    await mod.appendKnowledgeEvents({ 'ja:one': [protectedEvent, ...rollups] });

    const events = mod.getKnowledgeEvents(['ja:one'])['ja:one'];
    expect(events).toContainEqual(protectedEvent);
    expect(events.filter(({ kind }) => kind === 'rollup')).toHaveLength(500);
    expect(events).not.toContainEqual(rollups[0]);
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

  it('warns on save without losing events when a key exceeds 2000 total events', async () => {
    const events = Array.from({ length: 2001 }, (_, index) => event(now + index, { kind: 'status' }));
    await mod.appendKnowledgeEvents({ 'ja:one': events });

    await mod.saveKnowledgeEvents();

    expect(warn).toHaveBeenCalled();
    expect(mod.getKnowledgeEvents(['ja:one'])['ja:one']).toHaveLength(2001);
  });
});

describe('knowledge event validation on reload', () => {
  it('keeps retraction tombstones and every knowledge aspect through a reload', async () => {
    const tombstone = event(now, { kind: 'retraction', source: 'manual', retracts: 'attempt-1' });
    const genderEvent = event(now + 1, { kind: 'status', aspect: 'gender', toStatus: 'learning' });
    const orthographyEvent = event(now + 2, { kind: 'rating', source: 'manual', aspect: 'orthography' });

    await mod.appendKnowledgeEvents({ 'ru:one': [tombstone, genderEvent, orthographyEvent] });
    await mod.saveKnowledgeEvents();
    await mod.loadKnowledgeEvents(now);

    const kept = mod.getKnowledgeEvents(['ru:one'])['ru:one'];
    expect(kept).toContainEqual(tombstone);
    expect(kept).toContainEqual(genderEvent);
    expect(kept).toContainEqual(orthographyEvent);
  });

  it('keeps explicit claims and migration-sourced events through a reload', async () => {
    const claim = event(now, { kind: 'claim', source: 'manual', toStatus: 'known' });
    const migration = event(now + 1, { kind: 'status', source: 'migration', toStatus: 'known', easeAfter: 1.8 });

    await mod.appendKnowledgeEvents({ 'de:one': [claim, migration] });
    await mod.saveKnowledgeEvents();
    await mod.loadKnowledgeEvents(now);

    const kept = mod.getKnowledgeEvents(['de:one'])['de:one'];
    expect(kept).toContainEqual(claim);
    expect(kept).toContainEqual(migration);
  });

  it('drops malformed events on load (non-attempt-id attemptId)', async () => {
    const file = path.join(tempDir.tmpDir, 'knowledge-events.json');
    fs.writeFileSync(file, JSON.stringify({
      'ja:x': [
        event(now),
        { t: now, kind: 'rating', source: 'manual', aspect: 'meaning', attemptId: { malformed: true } },
      ],
    }));

    await mod.loadKnowledgeEvents(now);

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

    expect(sendFirst).toHaveBeenCalledWith(IPC_CHANNELS.KNOWLEDGE_EVENTS_CHANGED);
    expect(sendSecond).toHaveBeenCalledWith(IPC_CHANNELS.KNOWLEDGE_EVENTS_CHANGED);
  });

  it('serves events written to disk to a query that lands before the initial load finishes', async () => {
    const stored = event(now, { kind: 'status', toStatus: 'learning' });
    fs.writeFileSync(path.join(tempDir.tmpDir, 'knowledge-events.json'), JSON.stringify({ 'ja:early': [stored] }));

    mod.setupKnowledgeEventsIPC();
    const queryHandler = ipcHandle.mock.calls
      .find(([channel]) => channel === IPC_CHANNELS.KNOWLEDGE_EVENTS_QUERY)?.[1];
    expect(queryHandler).toBeTypeOf('function');

    await expect(
      (queryHandler as (_event: unknown, keys: string[]) => Promise<KnowledgeEventLog>)(undefined, ['ja:early']),
    ).resolves.toEqual({ 'ja:early': [stored] });
  });
});
