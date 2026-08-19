import { Component, For, Show, createMemo } from 'solid-js';
import type { Room, Thread, WorldSnapshot } from '../../../shared/world';
import { Badge, Btn } from '../../components/common';
import { useLocalization } from '../../context';
import './RoomSidebar.css';

interface RoomSidebarProps {
  world: WorldSnapshot | null;
  roomId: string | null;
  threadId: string | null;
  onSelectRoom: (roomId: string) => void;
  onSelectThread: (threadId: string) => void;
  onNewThread: () => void;
  onNewConversation: () => void;
}

export const RoomSidebar: Component<RoomSidebarProps> = (props) => {
  const { t } = useLocalization();
  const selectedRoom = createMemo<Room | undefined>(() => props.world?.rooms.find((room) => room.id === props.roomId));
  const threads = createMemo<Thread[]>(() => (props.world?.threads ?? [])
    .filter((thread) => thread.roomId === props.roomId)
    .sort((a, b) => b.createdAt - a.createdAt));

  return (
    <aside class="room-sidebar">
      <div class="room-sidebar-header"><h3 class="room-sidebar-title">{t('mlearn.ConversationAgent.Sidebar.Title')}</h3></div>
      <Btn variant="primary" class="room-sidebar-new-conversation" onClick={() => props.onNewConversation()}>{t('mlearn.ConversationAgent.Sidebar.NewConversation')}</Btn>
      <div class="room-sidebar-rooms">
        <For each={props.world?.rooms ?? []}>
          {(room) => (
            <Btn
              variant="ghost"
              class={`room-sidebar-room ${room.id === props.roomId ? 'room-sidebar-room--active' : ''}`}
              onClick={() => props.onSelectRoom(room.id)}
            >
              <span>{room.title}</span>
              <Show when={(room.unreadCount ?? 0) > 0}>
                <Badge>{room.unreadCount}</Badge>
              </Show>
            </Btn>
          )}
        </For>
      </div>
      <Show when={selectedRoom()}>
        <div class="room-sidebar-threads">
          <div class="room-sidebar-thread-header">
            <span>{selectedRoom()!.title}</span>
            <Btn variant="ghost" size="sm" onClick={props.onNewThread}>{t('mlearn.ConversationAgent.Sidebar.NewThread')}</Btn>
          </div>
          <For each={threads()}>
            {(thread) => (
              <Btn
                variant="ghost"
                class={`room-sidebar-thread ${thread.id === props.threadId ? 'room-sidebar-thread--active' : ''}`}
                onClick={() => props.onSelectThread(thread.id)}
              >
                {thread.title || t('mlearn.ConversationAgent.Sidebar.UntitledThread')}
              </Btn>
            )}
          </For>
        </div>
      </Show>
    </aside>
  );
};
