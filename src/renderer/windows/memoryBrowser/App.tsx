/**
 * Memory Browser Window — perspective-first, read-only view of room memory.
 *
 * Opens at the first room from the world snapshot, then renders one
 * perspective tab per room participant plus a room-level tab. Each tab shows
 * the projectionForCaller output for that caller verbatim: the participant's
 * own witness-scoped view of beliefs/open loops/episodes/relationships, or the
 * room's culture + relationships. Read-only by design — no editing, no
 * forget/correct affordances (that is a later phase).
 */

import { Component, For, Show, createMemo, createSignal, onMount } from 'solid-js';
import { WindowWrapper, useLocalization } from '../../context';
import { getBridge } from '../../../shared/bridges';
import { SkeletonRows } from '../../components/common';
import { getLogger } from '../../../shared/utils/logger';
import { projectionForCaller, type RoomMemoryProjection } from '@shared/memoryProjection';
import { USER_ACTOR, type JournalEvent, type Participant, type Room } from '@shared/world';
import './MemoryBrowser.css';

const log = getLogger('renderer.memoryBrowser.app');

/** Room-level tab id — the shared record as witnessed by the room's owner. */
const ROOM_TAB = '__room__';

interface MemorySectionProps {
  title: string;
  entries: Array<{ text: string; createdAt?: number }>;
  emptyLabel: string;
}

const MemorySection: Component<MemorySectionProps> = (props) => (
  <section class="memory-browser-section">
    <h2 class="memory-browser-section-title">{props.title}</h2>
    <Show
      when={props.entries.length > 0}
      fallback={<p class="memory-browser-section-empty">{props.emptyLabel}</p>}
    >
      <ul class="memory-browser-list">
        <For each={props.entries}>
          {(entry) => <li class="memory-browser-item">{entry.text}</li>}
        </For>
      </ul>
    </Show>
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

export const MemoryBrowserApp: Component = () => {
  const { t } = useLocalization();

  const [rooms, setRooms] = createSignal<Room[]>([]);
  const [participants, setParticipants] = createSignal<Participant[]>([]);
  const [selectedRoomId, setSelectedRoomId] = createSignal('');
  const [events, setEvents] = createSignal<JournalEvent[]>([]);
  const [activeTab, setActiveTab] = createSignal<string>(ROOM_TAB);
  const [isLoading, setIsLoading] = createSignal(true);

  const selectedRoom = createMemo(() => rooms().find((r) => r.id === selectedRoomId()) ?? null);

  const roomParticipants = createMemo<Participant[]>(() => {
    const room = selectedRoom();
    if (!room) return [];
    const byId = new Map(participants().map((p) => [p.id, p]));
    return room.participantIds
      .map((id) => byId.get(id))
      .filter((p): p is Participant => p !== undefined);
  });

  const tabs = createMemo(() => [
    ...roomParticipants().map((p) => ({ id: p.id, label: p.displayName })),
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

  // Room switches fetch a new journal projection: holding the previous
  // room's content under the new selection would show stale semantics, so
  // the body falls back to the skeleton until the fetch settles.
  const [roomLoading, setRoomLoading] = createSignal(false);
  const contentPending = () => isLoading() || roomLoading();

  const loadRoom = async (roomId: string): Promise<void> => {
    setSelectedRoomId(roomId);
    setActiveTab(ROOM_TAB);
    setRoomLoading(true);
    try {
      const seaEvents = await getBridge().journal.readSeaProjection(roomId);
      setEvents(seaEvents);
    } catch (err) {
      log.error('error', err);
      setEvents([]);
    } finally {
      setRoomLoading(false);
    }
  };

  onMount(() => {
    void (async () => {
      try {
        const snapshot = await getBridge().world.getWorldState();
        setRooms(snapshot.rooms);
        setParticipants(snapshot.participants);
        const first = snapshot.rooms[0];
        if (first) await loadRoom(first.id);
      } catch (err) {
        log.error('error', err);
      } finally {
        setIsLoading(false);
      }
    })();
  });

  return (
    <WindowWrapper showDragRegion={false}>
      <div class="memory-browser">
        <header class="memory-browser-header">
          <span class="memory-browser-title">{t('mlearn.MemoryBrowser.Title')}</span>
          <select
            class="memory-browser-room-select"
            value={selectedRoomId()}
            disabled={rooms().length === 0}
            onChange={(e) => void loadRoom((e.target as HTMLSelectElement).value)}
          >
            <For each={rooms()}>
              {(room) => <option value={room.id}>{room.title}</option>}
            </For>
          </select>
        </header>
        <div class="memory-browser-body">
          <Show
            when={!contentPending()}
            fallback={<div class="memory-browser-loading" aria-busy="true"><SkeletonRows rows={5} /></div>}
          >
            <Show
              when={selectedRoom()}
              fallback={<div class="memory-browser-empty">{t('mlearn.MemoryBrowser.Empty')}</div>}
            >
              <nav class="memory-browser-tabs">
                <For each={tabs()}>
                  {(tab) => (
                    <button
                      type="button"
                      class={`memory-browser-tab${tab.id === activeTab() ? ' memory-browser-tab--active' : ''}`}
                      onClick={() => setActiveTab(tab.id)}
                    >
                      {tab.label}
                    </button>
                  )}
                </For>
              </nav>
              <main class="memory-browser-content">
                <Show
                  when={projection()}
                  fallback={<div class="memory-browser-empty">{t('mlearn.MemoryBrowser.Empty')}</div>}
                >
                  {(proj) => (
                    <>
                      <Show when={activeTab() === ROOM_TAB}>
                        <MemorySection
                          title={t('mlearn.MemoryBrowser.Sections.RoomCulture')}
                          entries={proj().roomCulture}
                          emptyLabel={t('mlearn.MemoryBrowser.Empty')}
                        />
                        <MemorySection
                          title={t('mlearn.MemoryBrowser.Sections.Relationships')}
                          entries={proj().relationships}
                          emptyLabel={t('mlearn.MemoryBrowser.Empty')}
                        />
                      </Show>
                      <Show when={activeTab() !== ROOM_TAB}>
                        <MemorySection
                          title={t('mlearn.MemoryBrowser.Sections.Beliefs')}
                          entries={proj().beliefs}
                          emptyLabel={t('mlearn.MemoryBrowser.Empty')}
                        />
                        <MemorySection
                          title={t('mlearn.MemoryBrowser.Sections.OpenLoops')}
                          entries={proj().openLoops}
                          emptyLabel={t('mlearn.MemoryBrowser.Empty')}
                        />
                        <MemorySection
                          title={t('mlearn.MemoryBrowser.Sections.Episodes')}
                          entries={proj().episodes}
                          emptyLabel={t('mlearn.MemoryBrowser.Empty')}
                        />
                        <MemorySection
                          title={t('mlearn.MemoryBrowser.Sections.Relationships')}
                          entries={proj().relationships}
                          emptyLabel={t('mlearn.MemoryBrowser.Empty')}
                        />
                      </Show>
                    </>
                  )}
                </Show>
              </main>
            </Show>
          </Show>
        </div>
      </div>
    </WindowWrapper>
  );
};