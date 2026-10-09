// @vitest-environment happy-dom

/**
 * Memory Browser content test — bridge boundary mocked, context layer stubbed,
 * routed content + the real projectionForCaller under test (room/App.test.tsx is
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
import { MemoryBrowserContent } from './App';
import { WORLD_CONTINUITY_ID } from '../../../shared/world';
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
  kvStore: { kvGet: vi.fn(async (_key: string): Promise<string | null> => null), kvSet: vi.fn(async (_key: string, _value: string) => {}) },
  journal: {
    readSeaProjection: vi.fn(async () => seaEvents),
    readThread: vi.fn(async (_contextId: string, _threadId: string): Promise<JournalEvent[]> => []),
  },
};

vi.mock('../../../shared/bridges', () => ({ getBridge: () => mockBridge }));

vi.mock('../../context', () => ({ useLocalization: () => ({ t: (key: string) => key }) }));

describe('memory browser content', () => {
  let container: HTMLDivElement;
  let dispose: () => void;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    vi.clearAllMocks(); mockBridge.kvStore.kvGet.mockReset().mockResolvedValue(null);
    mockBridge.world.getWorldState.mockResolvedValue({ rooms: [roomFixture], threads: [], participants: [p1, p2] });
    mockBridge.journal.readSeaProjection.mockResolvedValue(seaEvents);
  });

  afterEach(() => {
    dispose?.();
    container.remove();
  });

  it('waits for the snapshot and opens the exact requested room without reading the first room', async () => {
    let resolveWorld!: (value: { rooms: Room[]; threads: never[]; participants: Participant[] }) => void;
    mockBridge.world.getWorldState.mockReturnValueOnce(new Promise(resolve => { resolveWorld = resolve; }));
    const onReturn = vi.fn();
    dispose = render(() => <MemoryBrowserContent launchContext={{ roomId: 'room-2' }} onReturn={onReturn} />, container);
    expect(mockBridge.journal.readSeaProjection).not.toHaveBeenCalled();
    resolveWorld({ rooms: [roomFixture, { ...roomFixture, id: 'room-2', title: 'Studio' }], threads: [], participants: [p1, p2] });
    await vi.waitFor(() => expect(mockBridge.journal.readSeaProjection).toHaveBeenCalledExactlyOnceWith('room-2'));
    expect((container.querySelector('select') as HTMLSelectElement).value).toBe('room-2');
    (Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'mlearn.Global.Back') as HTMLButtonElement).click();
    expect(onReturn).toHaveBeenCalledOnce();
  });

  it('preserves an unavailable named room without exposing another room and retries its exact identity', async () => {
    dispose = render(() => <MemoryBrowserContent launchContext={{ roomId: 'missing' }} />, container);
    await vi.waitFor(() => expect(container.querySelector('[role="status"]')).not.toBeNull());
    expect(mockBridge.journal.readSeaProjection).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain('Room culture entry');
    expect(container.querySelector('.memory-browser-tabs')).toBeNull();
    expect((container.querySelector('select') as HTMLSelectElement).value).toBe('');
    mockBridge.world.getWorldState.mockResolvedValueOnce({ rooms: [roomFixture, { ...roomFixture, id: 'missing', title: 'Restored room' }], threads: [], participants: [p1, p2] });
    (container.querySelector('[role="status"] button') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(mockBridge.journal.readSeaProjection).toHaveBeenCalledExactlyOnceWith('missing'));
  });

  it('does not treat malformed requested room context as unscoped browsing', async () => {
    dispose = render(() => <MemoryBrowserContent launchContext={{ roomId: { id: 'room-1' } }} />, container);
    await vi.waitFor(() => expect(container.querySelector('[role="status"]')).not.toBeNull());
    expect(mockBridge.journal.readSeaProjection).not.toHaveBeenCalled();
    const picker = container.querySelector('select') as HTMLSelectElement;
    picker.value = 'room-1'; picker.dispatchEvent(new Event('change', { bubbles: true }));
    await vi.waitFor(() => expect(mockBridge.journal.readSeaProjection).toHaveBeenCalledExactlyOnceWith('room-1'));
  });

  it('keeps participant pre-join cutoffs in the requested room projection', async () => {
    mockBridge.journal.readSeaProjection.mockResolvedValueOnce([...seaEvents,
      { ...seaEvents[0], id: 'membership', type: 'membership', seq: 3, payload: { participantId: 'p2', action: 'added' } },
      { ...seaEvents[0], id: 'after-join', seq: 6, payload: { ownerId: 'p1', kind: 'belief', text: 'After joining' } },
    ]);
    dispose = render(() => <MemoryBrowserContent launchContext={{ roomId: 'room-1' }} />, container);
    await vi.waitFor(() => expect(container.querySelectorAll('.memory-browser-tab')).toHaveLength(3));
    (Array.from(container.querySelectorAll('.memory-browser-tab')).find(tab => tab.textContent === 'Bob') as HTMLButtonElement).click();
    expect(container.textContent).toContain('After joining');
    expect(container.textContent).not.toContain('Shared belief');
    expect(container.textContent).not.toContain('Alice-only belief');
  });

  it('keeps a failed memory read distinct from no memories and retries', async () => {
    mockBridge.journal.readSeaProjection.mockRejectedValueOnce(new Error('offline'));
    dispose = render(() => <MemoryBrowserContent launchContext={{ roomId: 'room-1' }} />, container);
    await vi.waitFor(() => expect(container.querySelector('[role="alert"]')).not.toBeNull());
    expect(container.textContent).not.toContain('mlearn.MemoryBrowser.Empty');
    (container.querySelector('[role="alert"] button') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(container.querySelector('[role="alert"]')).toBeNull());
    expect(mockBridge.journal.readSeaProjection).toHaveBeenCalledTimes(2);
  });

  it('never borrows a Room when the caller omitted a scope', async () => {
    dispose = render(() => <MemoryBrowserContent />, container);
    await vi.waitFor(() => expect(container.querySelector('.memory-browser-loading')).toBeNull());
    expect(mockBridge.journal.readSeaProjection).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain('Room culture entry');
  });

  it('reads only a separate-history thread and returns its exact selection', async () => {
    const thread = { id: 'thread-separate', state: 'active' as const, createdAt: 1,
      sandbox: { operationId: 'op', requestHash: 'hash', baselineHeads: {}, bindings: [{ baseline: p1 }] } };
    mockBridge.world.getWorldState.mockResolvedValue({ rooms: [roomFixture], threads: [thread], participants: [p1, p2] } as never);
    const onReturn = vi.fn();
    const returnContext = { roomId: thread.id, threadId: thread.id };
    dispose = render(() => <MemoryBrowserContent launchContext={{ memoryScope: { kind: 'thread', id: thread.id }, returnContext }} onReturn={onReturn} />, container);
    await vi.waitFor(() => expect(mockBridge.journal.readThread).toHaveBeenCalledWith(thread.id, thread.id));
    expect(mockBridge.journal.readSeaProjection).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain('Room culture entry');
    Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(button => button.textContent === 'mlearn.Global.Back')!.click();
    expect(onReturn).toHaveBeenCalledWith(returnContext);
  });

  it('disambiguates same-named Rooms and retains the chosen exact scope across reload', async () => {
    mockBridge.world.getWorldState.mockResolvedValue({ rooms: [roomFixture, { ...roomFixture, id: 'room-2' }], threads: [], participants: [p1, p2] });
    const context = { memoryScope: { kind: 'room', id: 'room-1' }, returnContext: { roomId: 'room-1', threadId: 'thread-1' } };
    dispose = render(() => <MemoryBrowserContent launchContext={context} />, container);
    await vi.waitFor(() => expect(mockBridge.journal.readSeaProjection).toHaveBeenCalledWith('room-1'));
    const selector = container.querySelector('select') as HTMLSelectElement;
    expect(Array.from(selector.options).filter(option => option.text.includes('Cafe')).map(option => option.text)).toEqual([
      'Cafe · mlearn.MemoryBrowser.Scope.room · room-1', 'Cafe · mlearn.MemoryBrowser.Scope.room · room-2']);
    selector.value = 'room-2'; selector.dispatchEvent(new Event('change', { bubbles: true }));
    await vi.waitFor(() => expect(mockBridge.kvStore.kvSet).toHaveBeenCalled());
    const [key, value] = mockBridge.kvStore.kvSet.mock.calls.at(-1)!;
    expect(JSON.parse(value)).toEqual({ kind: 'room', id: 'room-2' });
    mockBridge.kvStore.kvGet.mockImplementation(async requested => requested === key ? value : null);
    dispose(); mockBridge.journal.readSeaProjection.mockClear();
    dispose = render(() => <MemoryBrowserContent launchContext={context} />, container);
    await vi.waitFor(() => expect(mockBridge.journal.readSeaProjection).toHaveBeenCalledWith('room-2'));
    expect(mockBridge.journal.readSeaProjection).not.toHaveBeenCalledWith('room-1');
  });

  it('opens world memory only from an explicit world entry', async () => {
    dispose = render(() => <MemoryBrowserContent launchContext={{ memoryScope: { kind: 'world', id: WORLD_CONTINUITY_ID } }} />, container);
    await vi.waitFor(() => expect(container.querySelector('.memory-browser-loading')).toBeNull());
    expect(mockBridge.journal.readSeaProjection).toHaveBeenCalledWith(WORLD_CONTINUITY_ID);
    expect(mockBridge.journal.readSeaProjection).not.toHaveBeenCalledWith('room-1');
  });

  it('renders per-participant projections with perspective redaction and no editing affordances', async () => {
    dispose = render(() => <MemoryBrowserContent launchContext={{ roomId: 'room-1' }} />, container);

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

  it('shows one empty state and omits empty categories', async () => {
    mockBridge.journal.readSeaProjection.mockResolvedValueOnce([]);
    dispose = render(() => <MemoryBrowserContent launchContext={{ roomId: 'room-1' }} />, container);
    await vi.waitFor(() => expect(container.querySelector('.memory-browser-empty')).not.toBeNull());
    expect(container.querySelectorAll('.memory-browser-empty')).toHaveLength(1);
    expect(container.querySelectorAll('.memory-browser-section')).toHaveLength(0);
  });
});
