import { createSignal } from 'solid-js';
import { getBridge } from '../../../shared/bridges';
import { projectHistoryForParticipant } from '../../../shared/roomOrchestrator';
import { type JournalEvent, type JournalEventDraft, type Participant } from '../../../shared/world';
import type {
  ChatWidget,
  ConversationMessage,
  ConversationSafetyFlag,
  LLMChatMessage,
  MistakeWidgetData,
} from '../../../shared/types';

const SEA_EVENT_LIMIT = 200;

type JournalDisplayMessage = ConversationMessage & {
  eventId: string;
  displayName: string;
  modality?: 'voice';
};

export interface JournalThreadSelection {
  roomId: string;
  threadId: string;
}

export function createJournalThreadStore(): {
  select(selection: JournalThreadSelection | null): Promise<void>;
  threadEvents(): JournalEvent[];
  seaEvents(): JournalEvent[];
  append(draft: JournalEventDraft): Promise<JournalEvent>;
  teardown(): void;
} {
  const [threadEvents, setThreadEvents] = createSignal<JournalEvent[]>([]);
  const [seaEvents, setSeaEvents] = createSignal<JournalEvent[]>([]);
  let requestId = 0;
  let unsubscribe: (() => void) | undefined;

  const teardown = (): void => {
    requestId++;
    unsubscribe?.();
    unsubscribe = undefined;
    setThreadEvents([]);
    setSeaEvents([]);
  };

  return {
    async select(selection): Promise<void> {
      teardown();
      if (!selection) return;

      const currentRequest = requestId;
      const journal = getBridge().journal;
      const sea = await journal.readSeaProjection(selection.roomId);
      const subscription = await journal.subscribeRoom(selection.roomId, SEA_EVENT_LIMIT);
      const thread = await journal.readThread(selection.roomId, selection.threadId);
      if (currentRequest !== requestId) return;

      setSeaEvents(sea);
      setThreadEvents(thread);
      unsubscribe = subscriptionUnsubscribe(subscription);
    },

    threadEvents,
    seaEvents,

    async append(draft): Promise<JournalEvent> {
      const event = await getBridge().journal.appendEvent(draft.roomId, draft);
      if (event.scope.kind === 'sea') {
        setSeaEvents((events) => [...events, event]);
      } else {
        setThreadEvents((events) => [...events, event]);
      }
      return event;
    },

    teardown,
  };
}

/** Converts journal messages and their checker sidecars into the chat display model. */
export function eventsToDisplayMessages(
  events: JournalEvent[],
  participants: Participant[],
  youLabel: string,
): ConversationMessage[] {
  const participantsById = new Map(participants.map((participant) => [participant.id, participant]));
  const messagesByEventId = new Map<string, ConversationMessage>();
  const messages: ConversationMessage[] = [];

  for (const event of events) {
    if (event.type === 'message.user' || event.type === 'message.character') {
      const payload = messagePayload(event.payload);
      if (!payload) continue;

      const isUser = event.type === 'message.user';
      const message: JournalDisplayMessage = {
        eventId: event.id,
        displayName: isUser ? youLabel : (participantsById.get(event.actorId)?.displayName ?? event.actorId),
        role: isUser ? 'user' : 'assistant',
        content: payload.text,
        timestamp: event.createdAt,
      };
      if (payload.modality === 'voice') message.modality = 'voice';
      if (payload.widget) message.widget = payload.widget;
      if (payload.widgets) message.widgets = payload.widgets;
      messagesByEventId.set(event.id, message);
      messages.push(message);
      continue;
    }

    if (event.type === 'correction') {
      const payload = correctionPayload(event.payload);
      const message = payload && messagesByEventId.get(payload.messageEventId);
      if (message) message.corrections = payload.corrections;
      continue;
    }

    if (event.type === 'safety_flag') {
      const payload = safetyFlagPayload(event.payload);
      const message = payload && messagesByEventId.get(payload.messageEventId);
      if (message) message.safety = payload.flag;
    }
  }

  return messages;
}

/** Rebuilds an agent's chat history from persisted journal events. */
export function buildLLMHistory(
  events: JournalEvent[],
  participantId: string,
  participants: Participant[],
): LLMChatMessage[] {
  return projectHistoryForParticipant(events, participantId, participants);
}

function subscriptionUnsubscribe(value: unknown): (() => void) | undefined {
  if (!isRecord(value) || typeof value.unsubscribe !== 'function') return undefined;
  return value.unsubscribe as () => void;
}

function messagePayload(payload: unknown): { text: string; widget?: ChatWidget; widgets?: ChatWidget[]; modality?: 'voice' } | undefined {
  if (!isRecord(payload) || typeof payload.text !== 'string') return undefined;
  const widget = isChatWidget(payload.widget) ? payload.widget : undefined;
  const widgets = Array.isArray(payload.widgets) && payload.widgets.every(isChatWidget)
    ? payload.widgets
    : undefined;
  return { text: payload.text, widget, widgets, modality: payload.modality === 'voice' ? 'voice' : undefined };
}

function correctionPayload(payload: unknown): { messageEventId: string; corrections: MistakeWidgetData[] } | undefined {
  if (!isRecord(payload) || typeof payload.messageEventId !== 'string' || !Array.isArray(payload.corrections)) {
    return undefined;
  }
  if (!payload.corrections.every(isMistakeWidgetData)) return undefined;
  return { messageEventId: payload.messageEventId, corrections: payload.corrections };
}

function safetyFlagPayload(payload: unknown): { messageEventId: string; flag: ConversationSafetyFlag } | undefined {
  if (!isRecord(payload) || typeof payload.messageEventId !== 'string' || !isSafetyFlag(payload.flag)) {
    return undefined;
  }
  return { messageEventId: payload.messageEventId, flag: payload.flag };
}

function isChatWidget(value: unknown): value is ChatWidget {
  return isRecord(value)
    && (value.type === 'quiz' || value.type === 'mistake' || value.type === 'url-fetch' || value.type === 'stats')
    && isRecord(value.data)
    && (value.resolved === undefined || typeof value.resolved === 'boolean');
}

function isMistakeWidgetData(value: unknown): value is MistakeWidgetData {
  return isRecord(value)
    && typeof value.userMessageIndex === 'number'
    && typeof value.errorSpan === 'string'
    && typeof value.correction === 'string'
    && (value.errorType === 'grammar' || value.errorType === 'word' || value.errorType === 'typo' || value.errorType === 'unnatural' || value.errorType === 'other');
}

function isSafetyFlag(value: unknown): value is ConversationSafetyFlag {
  return isRecord(value)
    && (value.category === 'self-harm' || value.category === 'self-harm-related')
    && (value.severity === 'concern' || value.severity === 'urgent');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
