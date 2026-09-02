// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import { compileContext } from '../../../shared/contextCompiler';
import type { JournalEvent, Participant, Room, WorldSnapshot } from '../../../shared/world';

const NOW = 1_700_000_000_000;

const alice: Participant = {
  id: 'alice',
  displayName: 'Alice',
  kind: 'persistent',
  personaText: 'Alice persona',
  canon: {
    workTitle: 'Test Work',
    fandomBaseUrl: 'https://example.com',
    characterPageTitle: 'Alice',
    coordinate: { kind: 'chapter', value: '1' },
    baseline: {
      lore: 'alice lore',
      quotes: ['quote one'],
      context: 'alice context',
      notYetHappened: ['the war has not started'],
      provenance: [],
      generatedFill: [],
    },
  },
  setupComplete: true,
};

const bob: Participant = {
  id: 'bob',
  displayName: 'Bob',
  kind: 'persistent',
  personaText: 'Bob persona',
  setupComplete: true,
};

const carol: Participant = {
  id: 'carol',
  displayName: 'Carol',
  kind: 'persistent',
  personaText: 'Carol persona',
  capabilities: { witnessScope: 'all' },
  setupComplete: true,
};

const roomA: Room = {
  id: 'room_a',
  title: 'Room A',
  participantIds: ['alice', 'bob', 'carol'],
  createdAt: NOW,
};

const roomB: Room = {
  id: 'room_b',
  title: 'Room B',
  participantIds: ['alice'],
  createdAt: NOW,
};

const roomAEvents: JournalEvent[] = [
  {
    id: 'evt_1',
    seq: 1,
    roomId: 'room_a',
    scope: { kind: 'sea' },
    type: 'message.user',
    actorId: 'user',
    witnesses: ['user'],
    payload: { text: 'hello' },
    createdAt: NOW + 1,
  },
  {
    id: 'evt_2',
    seq: 2,
    roomId: 'room_a',
    scope: { kind: 'sea' },
    type: 'message.character',
    actorId: 'alice',
    witnesses: ['alice', 'user'],
    payload: { text: 'hi there' },
    createdAt: NOW + 2,
  },
  {
    id: 'evt_3',
    seq: 3,
    roomId: 'room_a',
    scope: { kind: 'sea' },
    type: 'membership',
    actorId: 'harness',
    witnesses: ['harness', 'bob'],
    payload: { participantId: 'bob', action: 'added' },
    createdAt: NOW + 3,
  },
  {
    id: 'evt_4',
    seq: 4,
    roomId: 'room_a',
    scope: { kind: 'sea' },
    type: 'message.character',
    actorId: 'alice',
    witnesses: ['alice', 'user'],
    payload: { text: 'whisper' },
    createdAt: NOW + 4,
  },
  {
    id: 'evt_5',
    seq: 5,
    roomId: 'room_a',
    scope: { kind: 'sea' },
    type: 'memory.belief',
    actorId: 'alice',
    witnesses: ['alice', 'bob'],
    payload: { ownerId: 'alice', kind: 'belief', text: 'alice believes X' },
    createdAt: NOW + 5,
  },
  {
    id: 'evt_6',
    seq: 6,
    roomId: 'room_a',
    scope: { kind: 'sea' },
    type: 'memory.belief',
    actorId: 'alice',
    witnesses: ['alice', 'bob'],
    payload: { ownerId: 'alice', kind: 'relationship', toId: 'bob', label: 'friends', text: 'friends with bob' },
    createdAt: NOW + 6,
    provenance: { sourceThreadEventIds: ['evt_t1'] },
  },
  {
    id: 'evt_7',
    seq: 7,
    roomId: 'room_a',
    scope: { kind: 'sea' },
    type: 'message.character',
    actorId: 'alice',
    witnesses: ['alice', 'user', 'bob'],
    payload: { text: 'after memory' },
    createdAt: NOW + 7,
  },
];

const roomBEvents: JournalEvent[] = [
  {
    id: 'evt_b1',
    seq: 1,
    roomId: 'room_b',
    scope: { kind: 'sea' },
    type: 'message.user',
    actorId: 'user',
    witnesses: ['user'],
    payload: { text: 'room b hello' },
    createdAt: NOW + 1,
  },
];

const worldState: WorldSnapshot = {
  rooms: [roomA, roomB],
  threads: [],
  participants: [alice, bob, carol],
};

const mockGetWorldState = vi.fn<() => Promise<WorldSnapshot>>();
const mockReadSeaProjection = vi.fn<(roomId: string, limit?: number) => Promise<JournalEvent[]>>();

vi.mock('../../../shared/bridges', () => ({
  getBridge: () => ({
    world: { getWorldState: mockGetWorldState },
    journal: { readSeaProjection: mockReadSeaProjection },
  }),
}));

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe('EventAuditPanel', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);

    mockGetWorldState.mockReset();
    mockGetWorldState.mockResolvedValue(worldState);
    mockReadSeaProjection.mockReset();
    mockReadSeaProjection.mockImplementation((roomId: string) =>
      Promise.resolve(roomId === 'room_a' ? roomAEvents : roomBEvents),
    );
  });

  afterEach(() => {
    container.remove();
  });

  async function renderPanel() {
    const { EventAuditPanel } = await import('./EventAuditPanel');
    const dispose = render(() => <EventAuditPanel />, container);
    await flushPromises();
    return { dispose };
  }

  it('renders the selected room events with type, scope, witnesses, and provenance', async () => {
    const { dispose } = await renderPanel();

    expect(mockGetWorldState).toHaveBeenCalledOnce();
    expect(mockReadSeaProjection).toHaveBeenCalledWith('room_a');

    const text = container.textContent ?? '';
    expect(text).toContain('message.user');
    expect(text).toContain('message.character');
    expect(text).toContain('membership');
    expect(text).toContain('memory.belief');
    expect(text).toContain('sea');
    expect(text).toContain('witnesses: alice, user');
    expect(text).toContain('witnesses: harness, bob');
    expect(text).toContain('provenance: none');
    expect(text).toContain('provenance: {"sourceThreadEventIds":["evt_t1"]}');
    expect(text).toContain('seq 7');
    expect(text).toContain(new Date(NOW + 7).toISOString());

    dispose();
  });

  it('swaps the event list when another room is selected', async () => {
    const { dispose } = await renderPanel();

    const select = container.querySelector('select.event-audit-room-select') as HTMLSelectElement;
    expect(select).toBeTruthy();
    select.value = 'room_b';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await flushPromises();

    expect(mockReadSeaProjection).toHaveBeenCalledWith('room_b');
    const text = container.textContent ?? '';
    expect(text).toContain('room b hello');
    expect(text).not.toContain('whisper');

    dispose();
  });

  it('renders the compiler context for the inspected message event', async () => {
    const { dispose } = await renderPanel();

    const row = container.querySelector('[data-event-id="evt_7"]');
    expect(row).toBeTruthy();
    const inspectButton = row!.querySelector('button.event-audit-inspect') as HTMLButtonElement;
    expect(inspectButton).toBeTruthy();
    inspectButton.click();
    await flushPromises();

    const expected = compileContext({
      participant: alice,
      participants: [alice, bob, carol],
      seaEvents: roomAEvents.filter((e) => e.seq <= 7),
    });

    const text = container.textContent ?? '';
    expect(text).toContain('persona');
    expect(text).toContain('Alice persona');
    expect(text).toContain('negativeKnowledge');
    expect(text).toContain('relationships');
    expect(text).toContain('memories');
    expect(text).toContain('openLoops');
    expect(text).toContain('recentThreadEvents');
    expect(text).toContain('callerProjection');

    for (const nk of expected.negativeKnowledge) {
      expect(text).toContain(nk);
    }
    for (const rel of expected.relationships) {
      expect(text).toContain(`${rel.toId} -> ${rel.label}`);
    }
    for (const mem of expected.memories) {
      expect(text).toContain(mem.text);
    }

    dispose();
  });

  it('filters the event list by participant perspective', async () => {
    const { dispose } = await renderPanel();

    const bobButton = Array.from(container.querySelectorAll('button.event-audit-perspective')).find((b) =>
      b.textContent?.includes('Bob'),
    );
    expect(bobButton).toBeTruthy();
    (bobButton as HTMLButtonElement).click();
    await flushPromises();

    const bobText = container.textContent ?? '';
    expect(bobText).not.toContain('whisper');
    expect(bobText).toContain('after memory');
    expect(bobText).toContain('alice believes X');

    const carolButton = Array.from(container.querySelectorAll('button.event-audit-perspective')).find((b) =>
      b.textContent?.includes('Carol'),
    );
    expect(carolButton).toBeTruthy();
    (carolButton as HTMLButtonElement).click();
    await flushPromises();

    const carolText = container.textContent ?? '';
    expect(carolText).toContain('whisper');

    dispose();
  });
});