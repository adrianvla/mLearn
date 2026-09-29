import { For, Show, createMemo, createSignal, type Component } from 'solid-js';
import { threadContextId, type Participant, type Thread, type WorldSnapshot } from '../../../shared/world';
import { Avatar, Badge, Button, Disclosure, Input, ListRow, PlusIcon, SearchIcon, TabContainer } from '../../components/common';
import { useLocalization, useSettings } from '../../context';
import { formatClockTime, formatDateShort } from '../../utils/timeFormatting';
import type { ConversationPreviews } from './conversationPreviews';
import './RoomSidebar.css';

interface RoomSidebarProps {
  world: WorldSnapshot | null;
  roomId: string | null;
  threadId: string | null;
  previews?: ConversationPreviews;
  previewsError?: string;
  onSelectRoom: (roomId: string) => void;
  onSelectThread: (threadId: string) => void;
  onNewConversation: () => void;
  onPractice: () => void;
  onStoryProgress: () => void;
  onAddContact: () => void;
  onSelectContact: (person: Participant) => void;
  onViewChange?: (view: 'chats' | 'contacts' | 'practice') => void;
}

export const RoomSidebar: Component<RoomSidebarProps> = (props) => {
  const { t } = useLocalization();
  const { settings } = useSettings();
  const [query, setQuery] = createSignal('');
  const [tab, setTab] = createSignal('chats');
  const matches = (...parts: (string | undefined)[]) => parts.some(part => part?.toLocaleLowerCase().includes(query().trim().toLocaleLowerCase()));
  const people = createMemo(() => (props.world?.participants ?? [])
    .filter(person => !person.archivedAt && matches(person.displayName, person.personaText))
    .sort((a, b) => a.displayName.localeCompare(b.displayName, settings.uiLanguage)));
  const archivedPeople = createMemo(() => (props.world?.participants ?? [])
    .filter(person => person.archivedAt && matches(person.displayName))
    .sort((a, b) => a.displayName.localeCompare(b.displayName, settings.uiLanguage)));
  const chats = createMemo(() => {
    const world = props.world;
    if (!world) return [];
    const persistent = world.rooms.map(room => {
      const threads = world.threads.filter(thread => thread.roomId === room.id && thread.state !== 'archived');
      const candidates = [props.previews?.[room.id], ...threads.map(thread => props.previews?.[`${room.id}/${thread.id}`])]
        .filter(item => item !== undefined).sort((a, b) => b.timestamp - a.timestamp);
      const preview = candidates[0];
      const latestThread = threads.slice().sort((a, b) => b.createdAt - a.createdAt)[0];
      const person = room.participantIds.length === 1 ? world.participants.find(item => item.id === room.participantIds[0]) : undefined;
      return { id: room.id, title: person?.displayName ?? room.title, person, preview,
        roomId: room.id, threadId: preview ? preview.threadId : latestThread?.id, sessionTitle: latestThread?.title,
        unread: room.unreadCount ?? 0, timestamp: preview?.timestamp ?? room.createdAt,
        temporary: false };
    });
    const temporary = world.threads.filter(thread => thread.sandbox && thread.state !== 'archived').map(thread => {
      const profiles = thread.sandbox!.bindings.map(binding => binding.localOverride ?? binding.baseline);
      const person = profiles.length === 1 ? profiles[0] : undefined;
      const title = thread.title || profiles.map(profile => profile.displayName).join(', ') || t('mlearn.ConversationAgent.Sidebar.UntitledThread');
      const preview = props.previews?.[`${thread.id}/${thread.id}`];
      return { id: thread.id, roomId: thread.id, threadId: thread.id, title, person, preview,
        timestamp: preview?.timestamp ?? thread.createdAt, unread: 0, temporary: true, sessionTitle: thread.title };
    });
    return [...persistent, ...temporary].filter(chat => chat.temporary === (tab() === 'practice') && matches(chat.title, chat.preview?.text, chat.sessionTitle))
      .sort((a, b) => b.timestamp - a.timestamp);
  });
  const earlierSessions = createMemo(() => {
    const selected = chats().find(chat => chat.roomId === props.roomId && !chat.temporary);
    return (props.world?.threads ?? []).filter(thread => thread.roomId === props.roomId && thread.state !== 'archived' && thread.id !== selected?.threadId)
      .sort((a, b) => b.createdAt - a.createdAt);
  });
  const timestamp = (value: number): string => {
    const date = new Date(value);
    const today = new Date();
    return date.toDateString() === today.toDateString()
      ? formatClockTime(date.getTime(), settings.uiLanguage)
      : formatDateShort(date, settings.uiLanguage);
  };
  const selectThread = (thread: Thread): void => props.onSelectThread(thread.id);

  return <nav class="room-sidebar" aria-label={t('mlearn.ConversationAgent.Sidebar.Title')}>
    <div class="room-sidebar-header">
      <h2 class="room-sidebar-title">{t(tab() === 'contacts' ? 'mlearn.ConversationAgent.Contacts.Tab' : tab() === 'practice' ? 'mlearn.ConversationAgent.Contacts.Practice' : 'mlearn.ConversationAgent.Contacts.Chats')}</h2>
      <Show when={tab() === 'contacts'} fallback={<Button buttonType="icon" size="sm" variant="ghost" icon={<PlusIcon size={20} />}
        aria-label={t(tab() === 'practice' ? 'mlearn.ConversationAgent.Contacts.NewPractice' : 'mlearn.ConversationAgent.Contacts.NewMessage')}
        onClick={() => tab() === 'practice' ? props.onPractice() : props.onNewConversation()} />}>
        <Button size="sm" variant="ghost" icon={<PlusIcon size={16} />} onClick={props.onAddContact}>{t('mlearn.ConversationAgent.Contacts.Add')}</Button>
      </Show>
    </div>
    <div class="room-sidebar-search">
      <Input type="search" size="sm" leftIcon={<SearchIcon size={16} />} value={query()} onInput={event => setQuery(event.currentTarget.value)}
        placeholder={t('mlearn.Global.Search')} aria-label={t('mlearn.Global.Search')} />
    </div>
    <TabContainer idBase="messenger" variant="segment" size="sm" class="room-sidebar-tabs" activeTab={tab()}
      onTabChange={value => { setTab(value); setQuery(''); props.onViewChange?.(value as 'chats' | 'contacts' | 'practice'); }}
      tabs={[{ id: 'chats', label: t('mlearn.ConversationAgent.Contacts.Chats') }, { id: 'contacts', label: t('mlearn.ConversationAgent.Contacts.Tab') },
        { id: 'practice', label: t('mlearn.ConversationAgent.Contacts.Practice') }]}>
      <div class="room-sidebar-list" role="tabpanel" id={`messenger-panel-${tab()}`} aria-labelledby={`messenger-tab-${tab()}`}>
        <Show when={tab() === 'contacts'} fallback={<>
          <Show when={props.previewsError}><p class="room-sidebar-notice" role="status">{t('mlearn.ConversationAgent.Contacts.PreviewUnavailable')}</p></Show>
          <For each={chats()}>{chat => <ListRow
            class={chat.temporary ? 'room-sidebar-thread' : 'room-sidebar-room'}
            selected={chat.threadId ? chat.threadId === props.threadId : chat.roomId === props.roomId && !props.threadId}
            aria-current={chat.threadId ? chat.threadId === props.threadId : chat.roomId === props.roomId && !props.threadId}
            leading={<Avatar name={chat.title} src={chat.person?.profilePhoto} />}
            headline={chat.title}
            description={chat.preview?.text || chat.sessionTitle || t(chat.temporary ? 'mlearn.ConversationAgent.Contacts.PracticeChat' : 'mlearn.ConversationAgent.Contacts.SayHello')}
            trailing={<><Show when={chat.preview}><time dateTime={new Date(chat.timestamp).toISOString()}>{timestamp(chat.timestamp)}</time></Show>
              <Show when={chat.unread > 0}><Badge>{chat.unread}</Badge></Show>
            </>}
            onClick={() => chat.threadId ? props.onSelectThread(chat.threadId) : props.onSelectRoom(chat.roomId)} />}</For>
          <Show when={earlierSessions().length > 0 && !query().trim()}>
            <Disclosure title={t('mlearn.ConversationAgent.Contacts.EarlierSessions')} class="room-sidebar-sessions">
              <For each={earlierSessions()}>{thread => <ListRow headline={thread.title || t('mlearn.ConversationAgent.Sidebar.UntitledThread')}
                description={props.previews?.[`${threadContextId(thread)}/${thread.id}`]?.text} selected={thread.id === props.threadId}
                onClick={() => selectThread(thread)} />}</For>
            </Disclosure>
          </Show>
          <Show when={chats().length === 0}><div class="room-sidebar-empty">
            <p>{t(query().trim() ? 'mlearn.ConversationAgent.Sidebar.NoMatches' : tab() === 'practice' ? 'mlearn.ConversationAgent.Contacts.EmptyPractice' : 'mlearn.ConversationAgent.Contacts.EmptyChats')}</p>
            <Show when={!query().trim()}><Button variant="ghost" size="sm" onClick={() => tab() === 'practice' ? props.onPractice() : props.onAddContact()}>
              {t(tab() === 'practice' ? 'mlearn.ConversationAgent.Contacts.NewPractice' : 'mlearn.ConversationAgent.Contacts.Add')}
            </Button></Show>
          </div></Show>
        </>}>
          <div class="room-sidebar-story-action"><Button variant="ghost" size="sm" onClick={props.onStoryProgress}>{t('mlearn.ConversationAgent.Story.Title')}</Button></div>
          <For each={people()}>{person => <ListRow leading={<Avatar name={person.displayName} src={person.profilePhoto} />}
            headline={person.displayName} description={t(person.kind === 'persistent' ? 'mlearn.ConversationAgent.Contacts.InWorld' : 'mlearn.ConversationAgent.Contacts.PracticeOnly')}
            onClick={() => props.onSelectContact(person)} />}</For>
          <Show when={archivedPeople().length > 0}><Disclosure title={t('mlearn.ConversationAgent.Contacts.Archived')}>
            <For each={archivedPeople()}>{person => <ListRow leading={<Avatar name={person.displayName} src={person.profilePhoto} />}
              headline={person.displayName} onClick={() => props.onSelectContact(person)} />}</For>
          </Disclosure></Show>
          <Show when={people().length === 0}><div class="room-sidebar-empty">
            <p>{t(query().trim() ? 'mlearn.ConversationAgent.Sidebar.NoMatches' : 'mlearn.ConversationAgent.Contacts.EmptyContacts')}</p>
          </div></Show>
        </Show>
      </div>
    </TabContainer>
  </nav>;
};
