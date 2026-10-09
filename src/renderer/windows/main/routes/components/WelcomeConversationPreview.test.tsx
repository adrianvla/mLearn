// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createSignal, type Accessor } from 'solid-js';
import { render } from 'solid-js/web';
import type { JournalEvent, WorldSnapshot } from '../../../../../shared/world';
const fixture = vi.hoisted(() => ({ world: { rooms: [], threads: [], participants: [] } as WorldSnapshot,
  selection: null as string | null, events: [] as JournalEvent[], getWorld: vi.fn(), readSea: vi.fn(), readThread: vi.fn(), active: (() => true) as Accessor<boolean>,
  changed: (() => {}) as (notice: import('../../../../../shared/runtimeInspection').WorldChangeNotice) => void }));
vi.mock('../../../../../shared/bridges', () => ({ getBridge: () => ({
  world: { getWorldState: fixture.getWorld, onChanged: (cb: typeof fixture.changed) => { fixture.changed = cb; return () => {}; } },
  kvStore: { kvGet: async () => fixture.selection }, journal: { readSeaProjection: fixture.readSea, readThread: fixture.readThread },
}) }));
vi.mock('../../../../hooks/useWindowActivity', () => ({ useWindowActivity: () => fixture.active }));
vi.mock('../../../../context', () => ({ useLocalization: () => ({ t: (key: string) => key }) }));
import { WelcomeConversationPreview } from './WelcomeConversationPreview';
let dispose: (() => void) | undefined;
beforeEach(() => { vi.clearAllMocks(); fixture.world = { rooms: [], threads: [], participants: [] }; fixture.selection = null; fixture.events = []; fixture.active = () => true;
  fixture.getWorld.mockImplementation(async () => fixture.world); fixture.readSea.mockImplementation(async () => fixture.events); fixture.readThread.mockImplementation(async () => fixture.events); });
afterEach(() => { dispose?.(); document.body.replaceChildren(); });
it('shows a real learner-visible local preview and opens the exact chosen context without a provider', async () => {
  fixture.world = { rooms: [{ id: 'room', title: 'Garden', participantIds: [], createdAt: 1 }], threads: [], participants: [] };
  fixture.selection = JSON.stringify({ roomId: 'room' });
  fixture.events = [{ id: 'public', type: 'message.character', seq: 1, createdAt: 1, actorId: 'person', roomId: 'room', scope: { kind: 'sea' }, witnesses: ['user'], payload: { text: 'Shared actual journal fixture.' } },
    { id: 'private', type: 'message.character', seq: 2, createdAt: 2, actorId: 'person', roomId: 'room', scope: { kind: 'sea' }, witnesses: ['person'], payload: { text: 'Private dialogue.' } }];
  const open = vi.fn(); dispose = render(() => <WelcomeConversationPreview onOpen={open} />, document.body);
  await vi.waitFor(() => expect(document.body.textContent).toContain('Shared actual journal fixture.'));
  expect(document.body.textContent).not.toContain('Private dialogue.');
  document.querySelector<HTMLButtonElement>('button')!.click(); expect(open).toHaveBeenCalledWith({ roomId: 'room' });
});
it('offers an honest no-conversation action without inventing messages', async () => {
  const open = vi.fn(); dispose = render(() => <WelcomeConversationPreview onOpen={open} />, document.body);
  await vi.waitFor(() => expect(document.body.textContent).toContain('mlearn.Home.Summary.NoConversation'));
  expect(document.querySelector('.welcome-conversation-message')).toBeNull();
  document.querySelector<HTMLButtonElement>('button')!.click(); expect(open).toHaveBeenCalledWith();
});
it('defers background preview work until the Home window becomes active', async () => {
  const [active, setActive] = createSignal(false); fixture.active = active;
  dispose = render(() => <WelcomeConversationPreview onOpen={vi.fn()} />, document.body);
  await Promise.resolve(); expect(fixture.getWorld).not.toHaveBeenCalled();
  setActive(true); await vi.waitFor(() => expect(fixture.getWorld).toHaveBeenCalledOnce());
});
