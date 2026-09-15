import { createSignal } from 'solid-js';
import { getBridge } from '../../../shared/bridges';
import { projectHistoryForParticipant } from '../../../shared/roomOrchestrator';
import { WORLD_CONTINUITY_ID, type JournalEvent, type JournalEventDraft, type Participant } from '../../../shared/world';
import type {
  ChatWidget,
  ConversationMessage,
  ConversationSafetyFlag,
  LLMChatMessage,
  MistakeWidgetData,
} from '../../../shared/types';
import { sanitizeJournalMessageText } from '../../../shared/modelContent';

type JournalDisplayMessage = ConversationMessage & {
  eventId: string;
  displayName: string;
  modality?: 'voice';
};

export interface JournalThreadSelection {
  roomId: string;
  threadId: string | null;
  continuityRoomIds?: string[];
  baselineHeads?: Record<string, number>;
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
  let selected: JournalThreadSelection | null = null;

  const teardown = (): void => {
    requestId++;
    selected = null;
    setThreadEvents([]);
    setSeaEvents([]);
  };

  return {
    async select(selection): Promise<void> {
      teardown();
      if (!selection) return;
      selected = selection;

      const currentRequest = requestId;
      const journal = getBridge().journal;
      const sea = (await Promise.all([...new Set([selection.roomId, WORLD_CONTINUITY_ID, ...(selection.continuityRoomIds ?? [])])]
        .map((roomId) => journal.readSeaProjection(roomId)))).flat().filter(event => !selection.baselineHeads || event.seq <= (selection.baselineHeads[event.roomId] ?? 0));
      const thread = selection.threadId
        ? await journal.readThread(selection.roomId, selection.threadId)
        : sea.filter(event => event.roomId === selection.roomId && event.witnesses.includes('user'));
      if (currentRequest !== requestId) return;

      setSeaEvents(sea);
      setThreadEvents(thread);
    },

    threadEvents,
    seaEvents,

    async append(draft): Promise<JournalEvent> {
      const session = requestId;
      const event = await getBridge().journal.appendEvent(draft.roomId, draft);
      if (session !== requestId || !selected) return event;
      if (event.scope.kind === 'sea') {
        setSeaEvents((events) => [...events, event]);
        if (!selected.threadId && event.roomId === selected.roomId && event.witnesses.includes('user')) {
          setThreadEvents((events) => [...events, event]);
        }
      } else if (event.roomId === selected.roomId && event.scope.threadId === selected.threadId) {
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
        timestamp: event.createdAt,
        content: sanitizeJournalMessageText(event.type, payload.text),
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
