import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { createTempDir } from '../../../test/helpers/tempDir';
import type { TempDir } from '../../../test/helpers/tempDir';
import { HARNESS_ACTOR, USER_ACTOR } from '../../shared/world';

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

let mod: typeof import('./legacyMigration');
let worldMod: typeof import('./worldStore');
let journalMod: typeof import('./journalService');

const AGENT = {
  id: 'agent_123',
  agentName: 'Kaori',
  userName: 'Adrian',
  personality: 'roleplay',
  roleplayName: 'Kaori',
  roleplayLore: 'A gentle mentor from Kyoto.',
  roleplayContext: 'Teaches Japanese through conversation.',
  roleplayQuotes: ['Fall seven times, stand up eight.'],
  setupComplete: true,
  voiceSampleId: 'vs-1',
};

const SESSIONS_JA = [
  {
    id: 'sess_1',
    title: 'First lesson',
    agentId: 'agent_123',
    messages: [
      { role: 'user', content: 'こんにちは', timestamp: 1000 },
      { role: 'assistant', content: 'こんにちは！', timestamp: 2000 },
      { role: 'assistant', content: 'How can I help?', timestamp: 3000, widget: { type: 'quiz', data: { q: 'x' } } },
    ],
    llmHistory: [],
    createdAt: 900,
    updatedAt: 3000,
    messageCount: 3,
  },
  {
    id: 'sess_2',
    title: 'Second lesson',
    agentId: 'agent_123',
    messages: [
      { role: 'user', content: 'How do I say apple?', timestamp: 4000 },
      { role: 'assistant', content: 'りんご', timestamp: 5000 },
    ],
    llmHistory: [],
    createdAt: 3500,
    updatedAt: 5000,
    messageCount: 2,
  },
];

const MEMORIES_JA = [
  { id: 'mem_1', agentId: 'agent_123', content: 'User is learning Japanese for travel.', timestamp: 1500 },
  { id: 'mem_2', agentId: 'agent_123', content: 'User likes Studio Ghibli films.', timestamp: 2500 },
  { id: 'mem_3', agentId: 'agent_123', content: 'User struggles with counters.', timestamp: 4500 },
];

function kvStorePath(): string {
  return path.join(tempDir.tmpDir, 'kv-store.json');
}

function seedKvStore(): void {
  fs.writeFileSync(
    kvStorePath(),
    JSON.stringify(
      {
        'agent-configs': JSON.stringify([AGENT]),
        'conversation-sessions-ja': JSON.stringify(SESSIONS_JA),
        'agent-memories-ja': JSON.stringify(MEMORIES_JA),
        'unrelated-key': 'untouched',
      },
      null,
      2
    ),
    'utf-8'
  );
}

function readKvStore(): Record<string, string> {
  return JSON.parse(fs.readFileSync(kvStorePath(), 'utf-8')) as Record<string, string>;
}

beforeEach(async () => {
  tempDir = createTempDir();
  vi.resetModules();
  mod = await import('./legacyMigration');
  worldMod = await import('./worldStore');
  journalMod = await import('./journalService');
});

afterEach(() => {
  tempDir.cleanup();
});

describe('runLegacyMigration', () => {
  it('migrates legacy kv data into participant, room, threads and Sea memory events', async () => {
    seedKvStore();

    const summary = await mod.runLegacyMigration();
    expect(summary).toEqual({
      migrated: true,
      rooms: 1,
      threads: 2,
      participants: 1,
      memoryEvents: 3,
      messageEvents: 5,
    });

    const world = await worldMod.loadWorld();

    expect(world.participants).toHaveLength(1);
    const participant = world.participants[0];
    expect(participant).toMatchObject({
      id: 'agent_123',
      displayName: 'Kaori',
      kind: 'persistent',
      setupComplete: true,
      voiceSampleId: 'vs-1',
    });
    expect(participant.personaText).toContain('A gentle mentor from Kyoto.');
    expect(participant.personaText).toContain('Fall seven times, stand up eight.');

    expect(world.rooms).toHaveLength(1);
    expect(world.rooms[0]).toEqual({
      id: 'room-legacy-agent_123',
      title: 'Kaori',
      participantIds: ['agent_123'],
      createdAt: 900,
    });

    expect(world.threads).toHaveLength(2);
    expect(world.threads[0]).toEqual({
      id: 'sess_1',
      roomId: 'room-legacy-agent_123',
      title: 'First lesson',
      state: 'archived',
      createdAt: 900,
    });
    expect(world.threads[1]).toEqual({
      id: 'sess_2',
      roomId: 'room-legacy-agent_123',
      title: 'Second lesson',
      state: 'archived',
      createdAt: 3500,
    });

    const sea = await journalMod.readSeaProjection('room-legacy-agent_123');
    expect(sea).toHaveLength(3);
    for (const [i, event] of sea.entries()) {
      expect(event.type).toBe('memory.belief');
      expect(event.scope).toEqual({ kind: 'sea' });
      expect(event.actorId).toBe(HARNESS_ACTOR);
      expect(event.witnesses).toEqual([USER_ACTOR, 'agent_123']);
      expect(event.payload).toEqual({
        ownerId: 'agent_123',
        kind: 'belief',
        text: MEMORIES_JA[i].content,
        sourceMemoryId: MEMORIES_JA[i].id,
      });
    }

    const thread1 = await journalMod.readThread('room-legacy-agent_123', 'sess_1');
    expect(thread1).toHaveLength(3);
    expect(thread1.map((event) => event.type)).toEqual(['message.user', 'message.character', 'message.character']);
    expect(thread1.map((event) => event.actorId)).toEqual([USER_ACTOR, 'agent_123', 'agent_123']);
    expect(thread1.map((event) => event.witnesses)).toEqual([
      [USER_ACTOR, 'agent_123'],
      [USER_ACTOR, 'agent_123'],
      [USER_ACTOR, 'agent_123'],
    ]);
    expect(thread1.map((event) => (event.payload as { text: string }).text)).toEqual([
      'こんにちは',
      'こんにちは！',
      'How can I help?',
    ]);
    expect((thread1[2].payload as { widget: { type: string } }).widget.type).toBe('quiz');

    const thread2 = await journalMod.readThread('room-legacy-agent_123', 'sess_2');
    expect(thread2.map((event) => (event.payload as { text: string }).text)).toEqual(['How do I say apple?', 'りんご']);

    const store = readKvStore();
    expect(store['world-migration-v1']).toBe('done');
    expect(store['agent-configs']).toBeDefined();
    expect(store['conversation-sessions-ja']).toBeDefined();
    expect(store['agent-memories-ja']).toBeDefined();
    expect(store['unrelated-key']).toBe('untouched');
  });

  it('second run short-circuits on the marker — identical world and no duplicate events', async () => {
    seedKvStore();

    await mod.runLegacyMigration();
    const worldJsonBefore = fs.readFileSync(path.join(tempDir.tmpDir, 'world.json'), 'utf-8');
    const seaBefore = await journalMod.readSeaProjection('room-legacy-agent_123');
    const threadBefore = await journalMod.readThread('room-legacy-agent_123', 'sess_1');

    const second = await mod.runLegacyMigration();
    expect(second).toEqual({
      migrated: false,
      rooms: 0,
      threads: 0,
      participants: 0,
      memoryEvents: 0,
      messageEvents: 0,
    });

    const worldJsonAfter = fs.readFileSync(path.join(tempDir.tmpDir, 'world.json'), 'utf-8');
    expect(worldJsonAfter).toBe(worldJsonBefore);
    expect(await journalMod.readSeaProjection('room-legacy-agent_123')).toHaveLength(seaBefore.length);
    expect(await journalMod.readThread('room-legacy-agent_123', 'sess_1')).toEqual(threadBefore);

    const world = await worldMod.loadWorld();
    expect(world.rooms).toHaveLength(1);
    expect(world.threads).toHaveLength(2);
    expect(world.participants).toHaveLength(1);
  });

  it('no-ops without error when there is no legacy kv data at all', async () => {
    const summary = await mod.runLegacyMigration();
    expect(summary.migrated).toBe(true);
    expect(summary.rooms).toBe(0);
    const world = await worldMod.loadWorld();
    expect(world.rooms).toEqual([]);
    expect(world.threads).toEqual([]);
    expect(world.participants).toEqual([]);
    expect(readKvStore()['world-migration-v1']).toBe('done');
  });

  it('skips sessions and memories whose agent has no config', async () => {
    fs.writeFileSync(
      kvStorePath(),
      JSON.stringify(
        {
          'agent-configs': JSON.stringify([AGENT]),
          'conversation-sessions-ja': JSON.stringify([
            { ...SESSIONS_JA[0], id: 'sess_orphan', agentId: 'agent_missing', title: 'Orphan' },
          ]),
          'agent-memories-ja': JSON.stringify([
            { id: 'mem_orphan', agentId: 'agent_missing', content: 'Ghost', timestamp: 10 },
          ]),
        },
        null,
        2
      ),
      'utf-8'
    );

    const summary = await mod.runLegacyMigration();
    expect(summary).toEqual({
      migrated: true,
      rooms: 1,
      threads: 0,
      participants: 1,
      memoryEvents: 0,
      messageEvents: 0,
    });
    const world = await worldMod.loadWorld();
    expect(world.threads).toEqual([]);
    expect(await journalMod.readSeaProjection('room-legacy-agent_123')).toEqual([]);
    expect(await journalMod.readSeaProjection('room-legacy-agent_missing')).toEqual([]);
  });
});
