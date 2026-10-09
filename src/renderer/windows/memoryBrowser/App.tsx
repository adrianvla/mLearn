/**
 * Memory Browser — perspective-first, read-only view of room memory.
 *
 * Opens the requested persistent room from the world snapshot, then renders one
 * perspective tab per room participant plus a room-level tab. Each tab shows
 * the projectionForCaller output for that caller verbatim: the participant's
 * own witness-scoped view of beliefs/open loops/episodes/relationships, or the
 * room's culture + relationships. Read-only by design — no editing, no
 * forget/correct affordances (that is a later phase).
 */

import { Component, For, Show, createMemo, createSignal, onMount, onCleanup } from 'solid-js';
import { useLocalization } from '../../context';
import { getBridge } from '../../../shared/bridges';
import { EmptyState, SkeletonRows, Select } from '../../components/common';
import { getLogger } from '../../../shared/utils/logger';
import { projectionForCaller, type RoomMemoryProjection } from '@shared/memoryProjection';
import { WORLD_CONTINUITY_ID, USER_ACTOR, type JournalEvent, type Participant, type Room, type Thread } from '@shared/world';
import './MemoryBrowser.css';

const log = getLogger('renderer.memoryBrowser.app');

/** Room-level tab id — the shared record as witnessed by the room's owner. */
const ROOM_TAB = '__room__';

interface MemorySectionProps {
  title: string;
  entries: Array<{ text: string; createdAt?: number }>;
}

const MemorySection: Component<MemorySectionProps> = (props) => (
  <section class="memory-browser-section">
    <h2 class="memory-browser-section-title">{props.title}</h2>
    <ul class="memory-browser-list">
      <For each={props.entries}>
        {(entry) => <li class="memory-browser-item">{entry.text}</li>}
      </For>
    </ul>
  </section>
);

function membershipEventsFor(participantId: string, events: JournalEvent[]): JournalEvent[] {
  return events.filter(
    (e) =>
      e.type === 'membership' &&
      typeof e.payload === 'object' &&
      e.payload !== null &&
      (e.payload as Record<string, unknown>).participantId === participantId,
  );
}

function callerCutoff(participantId: string, events: JournalEvent[]): number | undefined {
  const membership = membershipEventsFor(participantId, events);
  if (membership.length === 0) return undefined;
  const firstAdded = membership
    .filter((e) => (e.payload as Record<string, unknown>).action === 'added')
    .sort((a, b) => a.seq - b.seq)[0];
  return firstAdded?.seq;
}

export const MemoryBrowserContent: Component<{ launchContext?: Record<string, unknown>; onReturn?: (context?: Record<string, unknown>) => void }> = (props) => {
  const envelope = props.launchContext?.memoryScope;
  const explicit = envelope && typeof envelope === 'object' && !Array.isArray(envelope) ? envelope as Record<string, unknown> : undefined;
  const requestedScope = explicit && ['room', 'thread', 'world'].includes(String(explicit.kind)) && typeof explicit.id === 'string'
    ? { kind: explicit.kind as 'room' | 'thread' | 'world', id: explicit.id }
    : typeof props.launchContext?.roomId === 'string' ? { kind: 'room' as const, id: props.launchContext.roomId } : undefined;
  const returnContext = props.launchContext?.returnContext;
  const returning = returnContext && typeof returnContext === 'object' && !Array.isArray(returnContext) ? returnContext as Record<string, unknown> : undefined;
  const selectionKey = `memory-browser-scope:${JSON.stringify(returning ?? requestedScope ?? { entry: 'explicit-browser' })}`;
  const { t } = useLocalization();

  const [rooms, setRooms] = createSignal<Room[]>([]);
  const [threads, setThreads] = createSignal<Thread[]>([]);
  const [scopeKinds, setScopeKinds] = createSignal<Record<string, 'room' | 'thread' | 'world'>>({});
  const [participants, setParticipants] = createSignal<Participant[]>([]);
  const [selectedRoomId, setSelectedRoomId] = createSignal('');
  const [events, setEvents] = createSignal<JournalEvent[]>([]);
  const [activeTab, setActiveTab] = createSignal<string>(ROOM_TAB);
  const [isLoading, setIsLoading] = createSignal(true);
  const [roomUnavailable, setRoomUnavailable] = createSignal(false);

  const selectedRoom = createMemo(() => rooms().find((r) => r.id === selectedRoomId()) ?? null);

  const roomParticipants = createMemo<Participant[]>(() => {
    const room = selectedRoom();
    if (!room) return [];
    const separate = scopeKinds()[room.id] === 'thread' ? threads().find(thread => thread.id === room.id) : undefined;
    const profiles = separate?.sandbox ? separate.sandbox.bindings.map(binding => binding.localOverride ?? binding.baseline) : participants();
    const byId = new Map(profiles.map((p) => [p.id, p]));
    const relevantIds = new Set([...room.participantIds, ...events().flatMap(event => event.witnesses)]);
    return [...relevantIds]
      .map((id) => byId.get(id))
      .filter((p): p is Participant => p !== undefined);
  });

  const tabs = createMemo(() => [
    ...roomParticipants().map((p) => ({ id: p.id, label: roomParticipants().filter(other => other.displayName === p.displayName).length > 1 ? `${p.displayName} · ${p.id}` : p.displayName })),
    { id: ROOM_TAB, label: t('mlearn.MemoryBrowser.Tabs.Room') },
  ]);

  const projection = createMemo<RoomMemoryProjection | null>(() => {
    const evts = events();
    if (evts.length === 0) return null;
    const tab = activeTab();
    if (tab === ROOM_TAB) {
      // Room view: the room's shared record — events the owner witnessed.
      // Character-private memories stay in their own tabs (Q4).
      return projectionForCaller(evts, USER_ACTOR);
    }
    const cutoff = callerCutoff(tab, evts);
    return projectionForCaller(evts, tab, cutoff);
  });

  const visibleSections = createMemo(() => {
    const view = projection();
    if (!view) return [];
    const sections = activeTab() === ROOM_TAB
      ? [
          { title: t('mlearn.MemoryBrowser.Sections.RoomCulture'), entries: view.roomCulture },
          { title: t('mlearn.MemoryBrowser.Sections.Relationships'), entries: view.relationships },
        ]
      : [
          { title: t('mlearn.MemoryBrowser.Sections.Beliefs'), entries: view.beliefs },
          { title: t('mlearn.MemoryBrowser.Sections.OpenLoops'), entries: view.openLoops },
          { title: t('mlearn.MemoryBrowser.Sections.Episodes'), entries: view.episodes },
          { title: t('mlearn.MemoryBrowser.Sections.Relationships'), entries: view.relationships },
        ];
    return sections.filter((section) => section.entries.length > 0);
  });

  // Room switches fetch a new journal projection: holding the previous
  // room's content under the new selection would show stale semantics, so
  // the body falls back to the skeleton until the fetch settles.
  const [roomLoading, setRoomLoading] = createSignal(false);
  const [loadFailed, setLoadFailed] = createSignal<'world' | 'room' | null>(null);
  let roomRequest = 0;
  let worldRequest = 0;
  let selectionRevision = 0;
  let selectionWrite = Promise.resolve();
  onCleanup(() => { roomRequest++; worldRequest++; selectionRevision++; });
  const contentPending = () => isLoading() || roomLoading();

  const loadRoom = async (roomId: string): Promise<void> => {
    const request = ++roomRequest;
    setLoadFailed(null);
    setRoomUnavailable(false);
    setEvents([]);
    setSelectedRoomId(roomId);
    setActiveTab(ROOM_TAB);
    if (!rooms().some(room => room.id === roomId)) {
      setRoomUnavailable(true);
      setRoomLoading(false);
      return;
    }
    setRoomLoading(true);
    try {
      const thread = threads().find(item => item.id === roomId);
      const seaEvents = scopeKinds()[roomId] === 'thread' && thread
        ? await getBridge().journal.readThread(thread.id, thread.id)
        : await getBridge().journal.readSeaProjection(roomId);
      if (request === roomRequest) setEvents(seaEvents);
    } catch (err) {
      log.error('error', err);
      if (request === roomRequest) setLoadFailed('room');
    } finally {
      if (request === roomRequest) setRoomLoading(false);
    }
  };

  const loadWorld = async () => {
    const request = ++worldRequest;
    roomRequest++; selectionRevision++;
    setIsLoading(true);
    setLoadFailed(null);
    setEvents([]);
    setRoomLoading(false);
    setRoomUnavailable(false);
    setSelectedRoomId('');
    try {
      const snapshot = await getBridge().world.getWorldState();
      if (request !== worldRequest) return;
      const separate = snapshot.threads.filter(thread => thread.sandbox);
      setThreads(separate);
      setScopeKinds(Object.fromEntries([...snapshot.rooms.map(room => [room.id, 'room']), ...separate.map(thread => [thread.id, 'thread']), [WORLD_CONTINUITY_ID, 'world']]));
      const contexts = [...snapshot.rooms, ...separate.map(thread => ({ id: thread.id, title: thread.title ?? t('mlearn.ConversationAgent.Details.UntitledThread'), participantIds: thread.sandbox!.bindings.map(binding => binding.baseline.id), createdAt: thread.createdAt })), { id: WORLD_CONTINUITY_ID, title: t('mlearn.ConversationAgent.Integration.WorldDestination'), participantIds: snapshot.participants.map(person => person.id), createdAt: 0 }];
      setRooms(contexts);
      setParticipants(snapshot.participants);
      const retained = selectionKey ? await getBridge().kvStore.kvGet(selectionKey) : null;
      if (request !== worldRequest) return;
      const decoded: unknown = retained ? JSON.parse(retained) : requestedScope;
      const scope = decoded && typeof decoded === 'object' && !Array.isArray(decoded) ? decoded as Record<string, unknown> : undefined;
      const requested = scope ? contexts.find(room => room.id === scope.id && scopeKinds()[room.id] === scope.kind) : undefined;
      if (requested) await loadRoom(requested.id);
      else if (requestedScope || props.launchContext?.memoryScope !== undefined || props.launchContext?.roomId !== undefined) setRoomUnavailable(true);
    } catch (err) {
      log.error('error', err);
      if (request === worldRequest) setLoadFailed('world');
    } finally {
      if (request === worldRequest) setIsLoading(false);
    }
  };
  const chooseScope = async (id: string): Promise<void> => {
    const kind = scopeKinds()[id];
    if (!kind) return;
    const revision = ++selectionRevision;
    await loadRoom(id);
    if (revision !== selectionRevision) return;
    const save = async (): Promise<void> => {
      if (revision !== selectionRevision) return;
      await getBridge().kvStore.kvSet(selectionKey, JSON.stringify({ kind, id }));
    };
    selectionWrite = selectionWrite.then(save, save);
    try { await selectionWrite; }
    catch (error) { if (revision === selectionRevision) { log.error('Unable to retain memory selection', error); setLoadFailed('room'); } }
  };
  onMount(() => { void loadWorld(); });

  return (
      <div class="memory-browser">
        <header class="memory-browser-header">
          <Show when={props.onReturn}><button type="button" class="memory-browser-retry" onClick={() => props.onReturn?.(returning)}>{t('mlearn.Global.Back')}</button></Show>
          <span class="memory-browser-title">{t('mlearn.MemoryBrowser.Title')}</span>
          <Select
            aria-label={t('mlearn.MemoryBrowser.Tabs.Room')}
            class="memory-browser-room-select"
            value={selectedRoomId()}
            disabled={isLoading() || rooms().length === 0}
            options={[
              { value: '', label: t(roomUnavailable() ? 'mlearn.Home.Cards.Room.RoomNotFound' : 'mlearn.MemoryBrowser.ChooseScope'), disabled: true },
              ...rooms().map(room => ({ value: room.id, label: `${room.title} · ${t(`mlearn.MemoryBrowser.Scope.${scopeKinds()[room.id]}`)} · ${room.id}` })),
            ]}
            onChange={event => void chooseScope(event.currentTarget.value)}
          />
        </header>
        <div class="memory-browser-body">
          <Show when={!loadFailed()} fallback={
            <div class="memory-browser-error" role="alert"><p>{t('mlearn.MemoryBrowser.LoadError')}</p><button type="button" class="memory-browser-retry" onClick={() => { if (loadFailed() === 'world') void loadWorld(); else void loadRoom(selectedRoomId()); }}>{t('mlearn.Knowledge.Retry')}</button></div>
          }>
          <Show
            when={!contentPending()}
            fallback={<div class="memory-browser-loading" aria-busy="true"><SkeletonRows rows={5} /></div>}
          >
            <Show when={!roomUnavailable()} fallback={
              <div class="memory-browser-error" role="status">
                <p>{t('mlearn.Home.Cards.Room.RoomNotFound')}</p>
                <button type="button" class="memory-browser-retry" onClick={() => void loadWorld()}>{t('mlearn.Knowledge.Retry')}</button>
              </div>
            }>
            <Show
              when={selectedRoom()}
              fallback={<div class="memory-browser-empty">{t('mlearn.MemoryBrowser.ChooseScope')}</div>}
            >
              <nav class="memory-browser-tabs">
                <For each={tabs()}>
                  {(tab) => (
                    <button
                      type="button"
                      aria-pressed={tab.id === activeTab()}
                      class={`memory-browser-tab${tab.id === activeTab() ? ' memory-browser-tab--active' : ''}`}
                      onClick={() => setActiveTab(tab.id)}
                    >
                      {tab.label}
                    </button>
                  )}
                </For>
              </nav>
              <main class="memory-browser-content">
                <Show when={visibleSections().length > 0} fallback={<EmptyState title={t(scopeKinds()[selectedRoomId()] === 'thread' ? 'mlearn.MemoryBrowser.NoRetainedThreadMemory' : 'mlearn.MemoryBrowser.Empty')} variant="minimal" class="memory-browser-empty" />}>
                  <For each={visibleSections()}>{(section) => <MemorySection title={section.title} entries={section.entries} />}</For>
                </Show>
              </main>
            </Show>
            </Show>
          </Show>
          </Show>
        </div>
      </div>
  );
};
