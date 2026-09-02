import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { createTempDir } from '../../../test/helpers/tempDir';
import type { TempDir } from '../../../test/helpers/tempDir';

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/tmp/test'), isPackaged: false },
  ipcMain: { handle: vi.fn() },
}));

let tempDir: TempDir;
vi.mock('../utils/platform', () => ({ getUserDataPath: vi.fn(() => tempDir?.tmpDir ?? '/tmp/test') }));

let journal: typeof import('./journalService');

describe('thread erasure', () => {
  beforeEach(async () => {
    tempDir = createTempDir();
    vi.resetModules();
    journal = await import('./journalService');
  });

  afterEach(() => tempDir.cleanup());

  it('removes thread payloads while retaining only source ids in a Sea erasure event', async () => {
    const roomId = 'room-erase';
    const threadId = 'thread-erase';
    await journal.appendEvent(roomId, {
      roomId,
      scope: { kind: 'sea' },
      type: 'message.user',
      actorId: 'user',
      witnesses: ['user'],
      payload: { text: 'durable sea event' },
    });
    const message = await journal.appendEvent(roomId, {
      roomId,
      scope: { kind: 'thread', threadId },
      type: 'message.user',
      actorId: 'user',
      witnesses: ['user'],
      payload: { text: 'DELETE_THIS_MESSAGE' },
    });
    const openLoop = await journal.appendEvent(roomId, {
      roomId,
      scope: { kind: 'thread', threadId },
      type: 'memory.belief',
      actorId: 'user',
      witnesses: ['user'],
      payload: { ownerId: 'user', kind: 'open-loop', text: 'DELETE_THIS_OPEN_LOOP' },
    });
    const projectionBefore = await journal.readSeaProjection(roomId);

    await expect(journal.eraseThread(roomId, threadId)).resolves.toEqual({ deletedCount: 2 });
    await expect(journal.readThread(roomId, threadId)).resolves.toEqual([]);

    const projectionAfter = await journal.readSeaProjection(roomId);
    expect(projectionAfter.filter((event) => event.type !== 'deletion')).toEqual(projectionBefore);
    const erasure = projectionAfter.find((event) => event.type === 'deletion');
    expect(erasure?.payload).toEqual({ threadId, sourceEventIds: [message.id, openLoop.id] });
    expect(erasure?.provenance).toEqual({ sourceThreadEventIds: [message.id, openLoop.id] });
    expect(JSON.stringify(erasure)).not.toContain('DELETE_THIS');

    const journalPath = path.join(tempDir.tmpDir, 'journal', roomId);
    const sea = fs.readFileSync(path.join(journalPath, 'sea.ndjson'), 'utf-8');
    expect(sea).not.toContain('DELETE_THIS_MESSAGE');
    expect(sea).not.toContain('DELETE_THIS_OPEN_LOOP');
    expect(fs.existsSync(path.join(journalPath, 'threads', `${threadId}.ndjson`))).toBe(false);
  });
});
