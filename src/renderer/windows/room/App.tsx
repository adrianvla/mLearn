/**
 * Room Window — multi-character conversation room.
 *
 * Opens at a room from the window-context handshake or OPEN_ROOM_EVENT
 * broadcasts, renders the roster + active thread from the journal, and runs
 * turns via runRoomTurn with one AgentInstance per participant driven
 * sequentially through the compiled-context seam.
 */

import {
  Component,
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
} from 'solid-js';
import { WINDOW_TYPES } from '../../../shared/constants';
import { WindowWrapper, useSettings, useLocalization, useLanguage, useFlashcards } from '../../context';
import { getBridge } from '../../../shared/bridges';
import { getLogger } from '../../../shared/utils/logger';
import { getLanguagePromptName } from '../../../shared/languageFeatures';
import { runRoomTurn, type RoomAgentRunner } from '../../../shared/roomOrchestrator';
import { compileContext, type CompiledContext } from '../../../shared/contextCompiler';
import {
  USER_ACTOR,
  type JournalEvent,
  type JournalEventDraft,
  type MessagePayload,
  type OpenRoomEventPayload,
  type Participant,
  type Room,
} from '../../../shared/world';
import { createConversationAgent, type AgentInstance } from '../../services/conversationAgent';
import { projectMessages, renderCompiledContext } from './roomMessages';
import './App.css';

const log = getLogger('renderer.room.app');

const SEA_EVENT_LIMIT = 200;

const ROOM_DISABLED_TOOLS = new Set([
  'correct_mistake',
  'create_quiz',
  'fetch_url',
  'get_media_stats',
  'save_memory',
  'search_wikipedia',
  'search_fandom',
  'recall_backstory',
]);

function lastMessageText(context: CompiledContext): string {
  for (let i = context.recentThreadEvents.length - 1; i >= 0; i--) {
    const e = context.recentThreadEvents[i];
    if (e.type === 'message.user' || e.type === 'message.character') {
      return e.text ?? '';
    }
  }
  return '';
}

export const RoomApp: Component = () => {
  const { settings } = useSettings();
  const { t } = useLocalization();
  const { getLanguageFeatures, currentLangData } = useLanguage();
  const flashcardCtx = useFlashcards();

  const [isBooting, setIsBooting] = createSignal(true);
  const [room, setRoom] = createSignal<Room | null>(null);
  const [participants, setParticipants] = createSignal<Participant[]>([]);
  const [activeThreadId, setActiveThreadId] = createSignal<string | null>(null);
  const [threadEvents, setThreadEvents] = createSignal<JournalEvent[]>([]);
  const [seaEvents, setSeaEvents] = createSignal<JournalEvent[]>([]);
  const [inputText, setInputText] = createSignal('');
  const [isStreaming, setIsStreaming] = createSignal(false);
  const [liveStream, setLiveStream] = createSignal<{
    participantId: string;
    displayName: string;
    text: string;
  } | null>(null);
  const [candidateId, setCandidateId] = createSignal('');

  const agents = new Map<string, AgentInstance>();
  let currentCompiledContext: CompiledContext | null = null;
  let session = 0;
  let messagesRef: HTMLDivElement | undefined;
  let textareaRef: HTMLTextAreaElement | undefined;

  const promptLangName = () => getLanguagePromptName(settings.language, currentLangData());

  const roster = createMemo<Participant[]>(() => {
    const r = room();
    if (!r) return [];
    const byId = new Map(participants().map((p) => [p.id, p]));
    return r.participantIds
      .map((id) => byId.get(id))
      .filter((p): p is Participant => p !== undefined);
  });

  const candidateOptions = createMemo<Participant[]>(() => {
    const r = room();
    if (!r) return [];
    return participants().filter((p) => !r.participantIds.includes(p.id));
  });

  const messages = createMemo(() =>
    projectMessages(threadEvents(), participants(), t('mlearn.Room.You')),
  );

  const canSend = () =>
    !isStreaming() && activeThreadId() !== null && inputText().trim().length > 0;

  function clearAgents(): void {
    agents.clear();
    currentCompiledContext = null;
  }

  function getAgent(participant: Participant): AgentInstance {
    const cached = agents.get(participant.id);
    if (cached) return cached;
    const agent = createConversationAgent({
      getSettings: () => settings,
      getLanguage: () => settings.language,
      getLanguageName: () => promptLangName(),
      getLanguageFeatures: () => getLanguageFeatures(),
      getMediaContext: () => null,
      getSceneContext: () => '',
      flashcardCtx,
      getDisabledTools: () => ROOM_DISABLED_TOOLS,
      compileContext: () =>
        renderCompiledContext(
          currentCompiledContext ??
            compileContext({
              participant,
              participants: participants(),
              seaEvents: seaEvents(),
              threadEvents: threadEvents(),
            }),
          participants(),
          t('mlearn.Room.You'),
        ),
    });
    agents.set(participant.id, agent);
    return agent;
  }

  function runAgentMessage(
    agent: AgentInstance,
    text: string,
    participant: Participant,
  ): Promise<{ text: string }> {
    return new Promise((resolve, reject) => {
      agent.processMessage(text, [], {
        onChunk: (chunk) => {
          setLiveStream({ participantId: participant.id, displayName: participant.displayName, text: chunk });
        },
        onToolCall: () => {},
        onDone: (finalContent) => resolve({ text: finalContent }),
        onError: (error) => reject(new Error(error)),
      });
    });
  }

  const runAgentTurn: RoomAgentRunner = async (participantId, context) => {
    currentCompiledContext = context;
    const byId = new Map(participants().map((p) => [p.id, p]));
    const participant = byId.get(participantId);
    if (!participant) return { text: '' };
    return runAgentMessage(getAgent(participant), lastMessageText(context), participant);
  };

  const openRoom = async (roomId: string, threadId?: string): Promise<void> => {
    const mySession = ++session;
    setLiveStream(null);
    setThreadEvents([]);
    clearAgents();
    try {
      const snapshot = await getBridge().world.getWorldState();
      if (mySession !== session) return;
      const found = snapshot.rooms.find((r) => r.id === roomId) ?? null;
      setRoom(found);
      setParticipants(snapshot.participants);
      const resolvedThreadId =
        threadId ??
        snapshot.threads.find((th) => th.roomId === roomId && th.state === 'active')?.id ??
        null;
      setActiveThreadId(resolvedThreadId);
      if (found) {
        const { events } = await getBridge().journal.subscribeRoom(roomId, SEA_EVENT_LIMIT);
        if (mySession !== session) return;
        setSeaEvents(events);
        if (resolvedThreadId) {
          const history = await getBridge().journal.readThread(roomId, resolvedThreadId);
          if (mySession !== session) return;
          setThreadEvents(history);
        }
      }
    } catch (err) {
      log.error('error', err);
    } finally {
      if (mySession === session) setIsBooting(false);
    }
  };

  const handleNewThread = async (): Promise<void> => {
    const r = room();
    if (!r || isStreaming()) return;
    try {
      const thread = await getBridge().world.createThread(r.id);
      setActiveThreadId(thread.id);
      setThreadEvents([]);
      clearAgents();
    } catch (err) {
      log.error('error', err);
    }
  };

  const handleAddParticipant = async (participantId: string): Promise<void> => {
    const r = room();
    if (!r || !participantId) return;
    try {
      const result = await getBridge().world.applyMembership(r.id, participantId, 'add');
      setRoom(result.room);
      const event = result.event;
      if (event) setSeaEvents((prev) => [...prev, event]);
      setCandidateId('');
    } catch (err) {
      log.error('error', err);
    }
  };

  const handleRemoveParticipant = async (participantId: string): Promise<void> => {
    const r = room();
    if (!r) return;
    try {
      const result = await getBridge().world.applyMembership(r.id, participantId, 'remove');
      setRoom(result.room);
      const event = result.event;
      if (event) setSeaEvents((prev) => [...prev, event]);
    } catch (err) {
      log.error('error', err);
    }
  };

  const handleSend = async (): Promise<void> => {
    const text = inputText().trim();
    const r = room();
    const threadId = activeThreadId();
    if (!text || !r || !threadId || isStreaming()) return;
    setInputText('');
    setIsStreaming(true);
    setLiveStream(null);
    textareaRef?.focus();
    const mySession = session;
    const roomId = r.id;
    const witnesses = [...r.participantIds];
    try {
      const userEvent = await getBridge().journal.appendEvent(roomId, {
        roomId,
        scope: { kind: 'thread', threadId },
        type: 'message.user',
        actorId: USER_ACTOR,
        witnesses,
        payload: { text } satisfies MessagePayload,
      });
      if (mySession === session) setThreadEvents((prev) => [...prev, userEvent]);

      await runRoomTurn({
        room: r,
        participants: participants(),
        seaEvents: seaEvents(),
        threadEvents: [...threadEvents(), userEvent],
        runAgentTurn,
        appendEvent: async (draft: JournalEventDraft) => {
          const event = await getBridge().journal.appendEvent(roomId, draft);
          if (mySession === session) setThreadEvents((prev) => [...prev, event]);
          return event;
        },
      });
    } catch (err) {
      log.error('error', err);
    } finally {
      if (mySession === session) {
        setLiveStream(null);
        setIsStreaming(false);
      }
    }
  };

  onMount(() => {
    const bridge = getBridge();
    const cleanupContext = bridge.window.onWindowContext((ctx) => {
      const raw = (ctx ?? {}) as Record<string, unknown>;
      if (typeof raw.roomId === 'string') {
        const threadId = typeof raw.threadId === 'string' ? raw.threadId : undefined;
        void openRoom(raw.roomId, threadId);
      }
    });
    bridge.window.getWindowContext(WINDOW_TYPES.ROOM);
    if (cleanupContext) onCleanup(cleanupContext);

    const cleanupOpen = bridge.window.onOpenRoomEvent((payload: OpenRoomEventPayload) => {
      void openRoom(payload.roomId, payload.threadId);
    });
    if (cleanupOpen) onCleanup(cleanupOpen);
  });

  createEffect(() => {
    void messages();
    void liveStream();
    requestAnimationFrame(() => {
      if (messagesRef) {
        messagesRef.scrollTop = messagesRef.scrollHeight;
      }
    });
  });

  return (
    <WindowWrapper showDragRegion={false}>
      <div class="room">
        <header class="room-header">
          <span class="room-header-title">{room()?.title || t('mlearn.Room.Title')}</span>
          <div class="room-header-actions">
            <button
              type="button"
              class="room-header-icon"
              aria-label={t('mlearn.MemoryBrowser.Open')}
              title={t('mlearn.MemoryBrowser.Open')}
              disabled={!room()}
              onClick={() => getBridge().window.openWindow({ type: WINDOW_TYPES.MEMORY_BROWSER })}
            >
              <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                <path d="M2 3h12v10H2z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" />
                <path d="M2 8h12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
              </svg>
            </button>
            <button
              type="button"
              class="room-header-action"
              onClick={() => void handleNewThread()}
              disabled={!room() || isStreaming()}
            >
              {t('mlearn.Room.NewThread')}
            </button>
          </div>
        </header>
        <div class="room-body">
          <Show when={!isBooting()} fallback={<div class="room-loading">{t('mlearn.Room.Loading')}</div>}>
            <Show when={room()} fallback={<div class="room-empty">{t('mlearn.Room.RoomNotFound')}</div>}>
              <aside class="room-roster">
                <span class="room-roster-title">{t('mlearn.Room.Roster')}</span>
                <For each={roster()}>
                  {(p) => (
                    <div class="room-roster-item">
                      <span class="room-roster-name">{p.displayName}</span>
                      <button
                        type="button"
                        class="room-roster-remove"
                        aria-label={t('mlearn.Room.RemoveParticipant')}
                        disabled={isStreaming()}
                        onClick={() => void handleRemoveParticipant(p.id)}
                      >
                        <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
                          <path d="M3 8h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
                        </svg>
                      </button>
                    </div>
                  )}
                </For>
                <div class="room-roster-add">
                  <select
                    class="room-roster-select"
                    value={candidateId()}
                    disabled={candidateOptions().length === 0 || isStreaming()}
                    onChange={(e) => setCandidateId((e.target as HTMLSelectElement).value)}
                  >
                    <option value="">{t('mlearn.Room.SelectParticipant')}</option>
                    <For each={candidateOptions()}>
                      {(p) => <option value={p.id}>{p.displayName}</option>}
                    </For>
                  </select>
                  <button
                    type="button"
                    class="room-roster-add-btn"
                    aria-label={t('mlearn.Room.AddParticipant')}
                    disabled={!candidateId() || isStreaming()}
                    onClick={() => void handleAddParticipant(candidateId())}
                  >
                    <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
                      <path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
                    </svg>
                  </button>
                </div>
              </aside>
              <main class="room-chat">
                <div class="room-messages" ref={messagesRef}>
                  <Show
                    when={messages().length > 0 || liveStream() !== null}
                    fallback={
                      <div class="room-empty-thread">
                        <p>
                          {activeThreadId() ? t('mlearn.Room.EmptyThread') : t('mlearn.Room.NoThread')}
                        </p>
                        <button
                          type="button"
                          class="room-empty-action"
                          onClick={() => void handleNewThread()}
                          disabled={isStreaming()}
                        >
                          {t('mlearn.Room.NewThread')}
                        </button>
                      </div>
                    }
                  >
                    <For each={messages()}>
                      {(m) => (
                        <div class={`room-msg${m.isUser ? ' room-msg--user' : ''}`}>
                          <span class="room-msg-name">{m.displayName}</span>
                          <span class="room-msg-text">{m.text}</span>
                        </div>
                      )}
                    </For>
                    <Show when={liveStream()}>
                      {(live) => (
                        <div class="room-msg room-msg--streaming">
                          <span class="room-msg-name">{live().displayName}</span>
                          <span class="room-msg-text">{live().text}</span>
                        </div>
                      )}
                    </Show>
                  </Show>
                </div>
                <div class="room-input-area">
                  <textarea
                    class="room-input"
                    ref={(el) => {
                      textareaRef = el;
                    }}
                    placeholder={t('mlearn.Room.InputPlaceholder')}
                    value={inputText()}
                    disabled={isStreaming() || activeThreadId() === null}
                    onInput={(e) => setInputText((e.target as HTMLTextAreaElement).value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        void handleSend();
                      }
                    }}
                  />
                  <button
                    type="button"
                    class="room-send"
                    aria-label={t('mlearn.Room.Send')}
                    disabled={!canSend()}
                    onClick={() => void handleSend()}
                  >
                    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
                      <path d="M2 8l12-5-3 5 3 5-12-5z" fill="currentColor" />
                    </svg>
                  </button>
                </div>
              </main>
            </Show>
          </Show>
        </div>
      </div>
    </WindowWrapper>
  );
};
