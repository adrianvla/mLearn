import { Component, For, Show, createMemo, createSignal } from 'solid-js';
import type { Participant, Room, Thread, WorldSnapshot } from '../../../shared/world';
import { Button, Badge, PlusIcon, SearchIcon } from '../../components/common';
import { useLocalization, useSettings } from '../../context';
import './RoomSidebar.css';

interface RoomSidebarProps {
  world: WorldSnapshot | null;
  roomId: string | null;
  threadId: string | null;
  onSelectRoom: (roomId: string) => void;
  onSelectThread: (threadId: string) => void;
  onNewConversation: () => void;
}

const threadContext = (thread: Thread | undefined): string =>
  thread?.mediaRef?.mediaName || thread?.intent || thread?.title || '';

export const RoomSidebar: Component<RoomSidebarProps> = (props) => {
  const { t } = useLocalization();
  const { settings } = useSettings();
  const [query, setQuery] = createSignal('');
  const matches = (parts: Array<string | undefined>): boolean =>
    parts.some((part) => part?.toLocaleLowerCase().includes(query().trim().toLocaleLowerCase()));
  const selectedRoom = createMemo<Room | undefined>(() => props.world?.rooms.find((room) => room.id === props.roomId));
  const rooms = createMemo(() => (props.world?.rooms ?? [])
    .map((room) => ({
      room,
      participant: room.participantIds.length === 1
        ? props.world?.participants.find((person) => person.id === room.participantIds[0])
        : undefined,
      latestThread: [...(props.world?.threads ?? [])]
        .filter((thread) => thread.roomId === room.id && thread.state !== 'archived')
        .sort((a, b) => b.createdAt - a.createdAt)[0],
    }))
    .filter(({ room, participant, latestThread }) => matches([room.title, participant?.displayName, threadContext(latestThread)]))
    .sort((a, b) => b.room.createdAt - a.room.createdAt));
  const threads = createMemo<Thread[]>(() => (props.world?.threads ?? [])
    .filter((thread) => thread.roomId === props.roomId && thread.state !== 'archived')
    .filter((thread) => matches([thread.title, threadContext(thread)]))
    .sort((a, b) => b.createdAt - a.createdAt));
  const temporaryThreads = createMemo(() => (props.world?.threads ?? [])
    .filter((thread) => thread.sandbox && thread.state !== 'archived')
    .map((thread) => ({
      thread,
      participant: thread.sandbox?.bindings.length === 1
        ? (thread.sandbox.bindings[0].localOverride ?? thread.sandbox.bindings[0].baseline)
        : undefined,
      title: thread.title || thread.sandbox!.bindings
        .map((binding) => (binding.localOverride ?? binding.baseline).displayName).join(', '),
    }))
    .filter(({ title, thread, participant }) => matches([title, threadContext(thread), participant?.displayName]))
    .sort((a, b) => b.thread.createdAt - a.thread.createdAt));
  const started = (timestamp: number) => t('mlearn.ConversationAgent.Sidebar.Started', {
    date: new Date(timestamp).toLocaleString(settings.uiLanguage, { dateStyle: 'medium', timeStyle: 'short' }),
  });
  const avatar = (participant: Participant | undefined, title: string) => (
    <span class="room-sidebar-avatar" aria-hidden="true">
      <Show when={participant?.profilePhoto} fallback={Array.from(title)[0] ?? ''}>
        <img src={participant!.profilePhoto} alt="" />
      </Show>
    </span>
  );

  return (
    <aside class="room-sidebar">
      <div class="room-sidebar-header">
        <h3 class="room-sidebar-title">{t('mlearn.ConversationAgent.Sidebar.Title')}</h3>
        <Button variant="ghost" class="room-sidebar-new-conversation" onClick={props.onNewConversation}
          title={t('mlearn.ConversationAgent.Sidebar.NewConversation')}>
          <PlusIcon size={18} />
          <span>{t('mlearn.ConversationAgent.Sidebar.NewConversation')}</span>
        </Button>
      </div>
      <label class="room-sidebar-search">
        <SearchIcon size={16} />
        <input type="search" value={query()} onInput={(event) => setQuery(event.currentTarget.value)}
          placeholder={t('mlearn.Global.Search')} aria-label={t('mlearn.Global.Search')} />
      </label>
      <div class="room-sidebar-list">
        <For each={rooms()}>
          {({ room, participant, latestThread }) => (
            <Button variant="ghost" class={`room-sidebar-room ${room.id === props.roomId ? 'room-sidebar-room--active' : ''}`}
              aria-current={room.id === props.roomId ? 'true' : undefined}
              onClick={() => latestThread ? props.onSelectThread(latestThread.id) : props.onSelectRoom(room.id)}>
              {avatar(participant, room.title)}
              <span class="room-sidebar-row-copy">
                <span class="room-sidebar-row-title">{room.title}</span>
                <span class="room-sidebar-row-context">{threadContext(latestThread) || started(room.createdAt)}</span>
              </span>
              <Show when={(room.unreadCount ?? 0) > 0}><Badge>{room.unreadCount}</Badge></Show>
            </Button>
          )}
        </For>
        <Show when={temporaryThreads().length > 0}>
          <div class="room-sidebar-thread-header">{t('mlearn.ConversationAgent.Sidebar.TemporaryPractice')}</div>
          <For each={temporaryThreads()}>
            {({ thread, title, participant }) => (
              <Button variant="ghost" class={`room-sidebar-thread ${thread.id === props.threadId ? 'room-sidebar-thread--active' : ''}`}
                aria-current={thread.id === props.threadId ? 'true' : undefined}
                onClick={() => props.onSelectThread(thread.id)}>
                {avatar(participant, title)}
                <span class="room-sidebar-row-copy">
                  <span class="room-sidebar-row-title">{title}</span>
                  <span class="room-sidebar-row-context">{threadContext(thread) !== title ? threadContext(thread) : ''}{threadContext(thread) !== title && threadContext(thread) ? ' · ' : ''}{started(thread.createdAt)}</span>
                </span>
              </Button>
            )}
          </For>
        </Show>
        <Show when={selectedRoom() && threads().length > 0}>
          <div class="room-sidebar-thread-header">{selectedRoom()!.title}</div>
          <For each={threads()}>
            {(thread) => (
              <Button variant="ghost" class={`room-sidebar-thread ${thread.id === props.threadId ? 'room-sidebar-thread--active' : ''}`}
                aria-current={thread.id === props.threadId ? 'true' : undefined}
                onClick={() => props.onSelectThread(thread.id)}>
                <span class="room-sidebar-row-copy">
                  <span class="room-sidebar-row-title">{thread.title || threadContext(thread) || t('mlearn.ConversationAgent.Sidebar.UntitledThread')}</span>
                  <span class="room-sidebar-row-context">{started(thread.createdAt)}</span>
                </span>
              </Button>
            )}
          </For>
        </Show>
        <Show when={query().trim() && rooms().length === 0 && temporaryThreads().length === 0 && threads().length === 0}>
          <p class="room-sidebar-no-matches">{t('mlearn.ConversationAgent.Sidebar.NoMatches')}</p>
        </Show>
      </div>
    </aside>
  );
};
