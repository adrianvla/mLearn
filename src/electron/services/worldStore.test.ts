import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { createTempDir, type TempDir } from '../../../test/helpers/tempDir';
import { loadWorld, saveWorld, withWorldMutation } from './worldStore';

let tempDir: TempDir;
vi.mock('../utils/platform', () => ({ getUserDataPath: () => tempDir.tmpDir }));

const emptyWorld = { rooms: [], threads: [], participants: [] };
const room = { id: 'room-existing', title: 'Existing room', participantIds: [], createdAt: 1 };
const newRoom = { ...room, id: 'room-new', title: 'New room' };
const worldPath = () => path.join(tempDir.tmpDir, 'world.json');

function addRoom(): Promise<void> {
  return withWorldMutation(async () => {
    const state = await loadWorld();
    await saveWorld({ ...state, rooms: [...state.rooms, newRoom] });
  });
}

beforeEach(() => { tempDir = createTempDir('world-store-'); });
afterEach(() => { vi.restoreAllMocks(); tempDir.cleanup(); });

describe('world persistence', () => {
  it('initializes a missing world and persists its first mutation', async () => {
    expect(await loadWorld()).toEqual(emptyWorld);
    await addRoom();
    expect(await loadWorld()).toEqual({ ...emptyWorld, rooms: [newRoom] });
  });

  it.each([
    ['invalid JSON', '{unfinished'],
    ['null', 'null'],
    ['array', '[]'],
    ['missing required collections', '{}'],
    ['invalid required collection', JSON.stringify({ ...emptyWorld, rooms: {} })],
    ['invalid optional collection', JSON.stringify({ ...emptyWorld, contacts: {} })],
  ])('rejects %s without overwriting the existing file', async (_name, raw) => {
    fs.writeFileSync(worldPath(), raw);
    await expect(addRoom()).rejects.toThrow();
    expect(fs.readFileSync(worldPath(), 'utf-8')).toBe(raw);
    expect(fs.existsSync(`${worldPath()}.tmp`)).toBe(false);
  });

  it.each(['EACCES', 'EIO'])('propagates %s and lets the queued next mutation recover', async (code) => {
    const raw = JSON.stringify({ ...emptyWorld, rooms: [room] });
    fs.writeFileSync(worldPath(), raw);
    const failure = Object.assign(new Error('Cannot read world'), { code });
    vi.spyOn(fs.promises, 'readFile').mockRejectedValueOnce(failure);
    const failed = addRoom();
    const recovery = addRoom();
    await Promise.allSettled([failed, recovery]);
    await expect(failed).rejects.toBe(failure);
    await recovery;
    expect(await loadWorld()).toEqual({ ...emptyWorld, rooms: [room, newRoom] });
  });

  it('retains unknown top-level and nested data across an unrelated mutation', async () => {
    const existing = {
      ...emptyWorld,
      rooms: [{ ...room, 'third-party:context': { unfamiliar: ['one', { two: true }] } }],
      'third-party:ledger': { opaque: [{ arbitrary: 42 }] },
    };
    fs.writeFileSync(worldPath(), JSON.stringify(existing));
    await addRoom();
    expect(JSON.parse(fs.readFileSync(worldPath(), 'utf-8'))).toEqual({
      ...existing, rooms: [...existing.rooms, newRoom],
    });
  });

  it('preserves the previous file when publishing the temporary file fails', async () => {
    const raw = JSON.stringify({ ...emptyWorld, rooms: [room] });
    fs.writeFileSync(worldPath(), raw);
    const failure = Object.assign(new Error('Cannot rename world'), { code: 'EIO' });
    vi.spyOn(fs.promises, 'rename').mockRejectedValueOnce(failure);
    await expect(addRoom()).rejects.toBe(failure);
    expect(fs.readFileSync(worldPath(), 'utf-8')).toBe(raw);
    await addRoom();
    expect(await loadWorld()).toEqual({ ...emptyWorld, rooms: [room, newRoom] });
  });
});
