// @vitest-environment happy-dom

/**
 * Memory Browser window test — bridge boundary mocked, context layer stubbed,
 * window code + the real projectionForCaller under test (room/App.test.tsx is
 * the precedent).
 *
 * Golden path: world snapshot (1 room, 2 participants) → first room loads →
 * readSeaProjection returns a synthetic sea stream → per-participant tabs
 * render the projection verbatim with witness-based redaction (Alice sees both
 * beliefs, Bob sees only the shared one), the Room tab surfaces the shared
 * record (witnessed by the user, character-private entries excluded), and no
 * editing affordances exist anywhere.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import type { JSX } from 'solid-js';
import type { JournalEvent, Participant, Room } from '../../../shared/world';

const p1: Participant = {
  id: 'p1',
  displayName: 'Alice',
  kind: 'persistent',
  personaText: 'Cheerful barista',
  setupComplete: true,
};
const p2: Participant = {
  id: 'p2',
  displayName: 'Bob',
  kind: 'persistent',
  personaText: 'Quiet poet',
  setupComplete: true,
};
const roomFixture: Room = { id: 'room-1', title: 'Cafe', participantIds: ['p1', 'p2'], createdAt: 1 };

const seaEvents: JournalEvent[] = [
  {
    id: 'evt_1',
    seq: 1,
    roomId: 'room-1',
    scope: { kind: 'sea' },
    type: 'memory.belief',
    actorId: 'p1',
    witnesses: ['p1', 'p2', 'user'],
    payload: { ownerId: 'p1', kind: 'belief', text: 'Shared belief' },
    createdAt: 1,
  },
  {
    id: 'evt_2',
    seq: 2,
    roomId: 'room-1',
    scope: { kind: 'sea' },
    type: 'memory.belief',
    actorId: 'p1',
    witnesses: ['p1'],
    payload: { ownerId: 'p1', kind: 'belief', text: 'Alice-only belief' },
    createdAt: 2,
  },
  {
    id: 'evt_3',
    seq: 3,
    roomId: 'room-1',
    scope: { kind: 'sea' },
    type: 'memory.belief',
    actorId: 'p1',
    witnesses: ['p1', 'p2', 'user'],
    payload: { ownerId: 'p1', kind: 'open-loop', text: 'Open loop item' },
    createdAt: 3,
  },
  {
    id: 'evt_4',
    seq: 4,
    roomId: 'room-1',
    scope: { kind: 'sea' },
    type: 'memory.belief',
    actorId: 'p1',
    witnesses: ['p1', 'p2', 'user'],
    payload: { ownerId: 'p1', kind: 'relationship', text: 'Alice trusts Bob', toId: 'p2', label: 'trusts' },
    createdAt: 4,
  },
  {
    id: 'evt_5',
    seq: 5,
    roomId: 'room-1',
    scope: { kind: 'sea' },
    type: 'memory.belief',
    actorId: 'harness',
    witnesses: ['p1', 'p2', 'user'],
    payload: { ownerId: 'harness', kind: 'fact', text: 'Room culture entry' },
    createdAt: 5,
  },
];

const mockBridge = {
  world: {
    getWorldState: vi.fn(async () => ({
      rooms: [roomFixture],
      threads: [],
      participants: [p1, p2],
    })),
  },
  journal: {
    readSeaProjection: vi.fn(async () => seaEvents),
  },
};

vi.mock('../../../shared/bridges', () => ({ getBridge: () => mockBridge }));

vi.mock('../../context', () => ({
  WindowWrapper: (props: { children?: JSX.Element }) => <div>{props.children}</div>,
  useLocalization: () => ({
    t: (key: string) => key,
  }),
}));

describe('memory browser window', () => {
  let container: HTMLDivElement;
  let dispose: () => void;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    vi.clearAllMocks();
  });

  afterEach(() => {
    dispose?.();
    container.remove();
  });

  it('renders per-participant projections with perspective redaction and no editing affordances', async () => {
    const { MemoryBrowserApp } = await import('./App');
    dispose = render(() => <MemoryBrowserApp />, container);

    await vi.waitFor(() => expect(mockBridge.journal.readSeaProjection).toHaveBeenCalledWith('room-1'));

    const tabs = () => Array.from(container.querySelectorAll('.memory-browser-tab')) as HTMLButtonElement[];
    await vi.waitFor(() => expect(tabs().length).toBe(3));

    // Room tab (default): the shared record surfaces; character-private entries do not.
    expect(container.textContent).toContain('Room culture entry');
    expect(container.textContent).toContain('Alice trusts Bob');
    expect(container.textContent).not.toContain('Alice-only belief');

    // Alice: both beliefs visible.
    tabs().find((b) => b.textContent === 'Alice')!.click();
    await vi.waitFor(() => expect(container.textContent).toContain('Shared belief'));
    expect(container.textContent).toContain('Alice-only belief');

    // Bob: only the shared belief — the Alice-only belief is redacted.
    tabs().find((b) => b.textContent === 'Bob')!.click();
    await vi.waitFor(() => expect(container.textContent).toContain('Shared belief'));
    expect(container.textContent).not.toContain('Alice-only belief');

    // Read-only surface: no inputs, textareas, or contenteditable anywhere.
    expect(container.querySelector('input, textarea, [contenteditable]')).toBeNull();
  });
});