import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import { createTempDir } from '../../../test/helpers/tempDir';
import type { TempDir } from '../../../test/helpers/tempDir';
import type { InferencePolicy, InferencePolicyKind } from '../../shared/inferencePolicy';
import type { JournalEvent } from '../../shared/world';

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/tmp/test'), isPackaged: false },
  ipcMain: { handle: vi.fn() },
}));

let tempDir: TempDir;
vi.mock('../utils/platform', () => ({ getUserDataPath: vi.fn(() => tempDir?.tmpDir ?? '/tmp/test') }));

let dreamer: typeof import('./dreamerService');
let journal: typeof import('./journalService');
let projections: typeof import('./projectionStore');

function policy(kind: InferencePolicyKind, permitted: boolean): InferencePolicy {
  return {
    kind,
    isPermitted: () => permitted,
    prefer: () => true,
  };
}

function validOutput(): string {
  return JSON.stringify({
    beliefs: [{ ownerId: 'owner', kind: 'belief', text: 'durable conclusion' }],
    resolutions: [{ ownerId: 'owner', text: 'resolved loop' }],
  });
}

async function seedSea(roomId: string, text = 'sea input'): Promise<JournalEvent> {
  return journal.appendEvent(roomId, {
    roomId,
    scope: { kind: 'sea' },
    type: 'message.user',
    actorId: 'user',
    witnesses: ['user'],
    payload: { text },
  });
}

describe('Dreamer service', () => {
  beforeEach(async () => {
    tempDir = createTempDir();
    vi.resetModules();
    [dreamer, journal, projections] = await Promise.all([
      import('./dreamerService'),
      import('./journalService'),
      import('./projectionStore'),
    ]);
  });

  afterEach(() => tempDir.cleanup());

  it('never reaches thread-scoped content', async () => {
    const roomId = 'room-thread-only';
    await journal.appendEvent(roomId, {
      roomId,
      scope: { kind: 'thread', threadId: 'thread-1' },
      type: 'message.user',
      actorId: 'user',
      witnesses: ['user'],
      payload: { text: 'THREAD_ONLY_SECRET' },
    });
    const before = await journal.readSeaProjection(roomId);
    const llmFn = vi.fn(async () => validOutput());

    await dreamer.runDreamer(roomId, { policy: policy('local', true), llmFn, now: 100 });

    expect(await journal.readSeaProjection(roomId)).toEqual(before);
    expect(llmFn).not.toHaveBeenCalled();
  });

  it('consolidates each Sea window once', async () => {
    const roomId = 'room-idempotent';
    await seedSea(roomId);
    const llmFn = vi.fn(async () => validOutput());

    await dreamer.runDreamer(roomId, { policy: policy('local', true), llmFn, now: 100 });
    const once = await journal.readSeaProjection(roomId);
    await dreamer.runDreamer(roomId, { policy: policy('local', true), llmFn, now: 200 });

    expect(await journal.readSeaProjection(roomId)).toEqual(once);
    expect(once.filter((event) => event.type === 'consolidation')).toHaveLength(1);
    expect(llmFn).toHaveBeenCalledTimes(1);
  });

  it('persists salience/access as projections, never journal events', async () => {
    const roomId = 'room-projections';
    await projections.saveProjectionStore({
      [roomId]: { oldMemory: { salience: 0.5, lastAccessed: 1 } },
    });
    await seedSea(roomId);

    await dreamer.runDreamer(roomId, { policy: policy('local', true), llmFn: async () => validOutput(), now: 123 });

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

  it('honors policies and records Sea provenance on every result', async () => {
    const blockedRoom = 'room-blocked';
    await seedSea(blockedRoom);
    const blockedLlm = vi.fn(async () => validOutput());
    await dreamer.runDreamer(blockedRoom, {
      policy: policy('conservative-cloud', false),
      llmFn: blockedLlm,
      now: 100,
    });
    expect(blockedLlm).not.toHaveBeenCalled();

    for (const kind of ['local', 'unrestricted-cloud'] as const) {
      const roomId = `room-${kind}`;
      const source = await seedSea(roomId);
      const llmFn = vi.fn(async () => validOutput());
      await dreamer.runDreamer(roomId, { policy: policy(kind, true), llmFn, now: 100 });
      expect(llmFn).toHaveBeenCalledTimes(1);
      const results = (await journal.readSeaProjection(roomId)).filter(
        (event) => event.type === 'memory.belief' || event.type === 'resolution'
      );
      expect(results).toHaveLength(2);
      for (const event of results) {
        expect(event.payload).toMatchObject({ sourceEventIds: [source.id] });
      }
    }
  });
});
