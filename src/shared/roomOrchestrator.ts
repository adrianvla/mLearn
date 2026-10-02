/**
 * Room orchestrator — deterministic multi-character turn engine (Phase 2).
 *
 * Pure module: no I/O, no Electron, no renderer imports. All persistence and
 * streaming enter through injected functions (appendEvent, runAgentTurn).
 *
 * Contract source: .sisyphus/plans/conversational-runtime-overhaul.md Phase 2.
 * Roster = Room.participantIds (entity state); membership history lives only as
 * 'membership' journal events (contextCompiler derives absence intervals).
 */

import { compileContext, visibleEventsFor, type CompiledContext } from './contextCompiler';
import { splitConversationMessages } from './conversationMessageShape';
import { selectSpeaker } from './speakerSelection';
import { sanitizeJournalMessageText, sanitizeModelSpeech } from './modelContent';
import type { LLMChatMessage } from './types';
import {
  HARNESS_ACTOR,
  USER_ACTOR,
  sandboxContext,
  threadParticipants,
  type JournalEvent,
  type JournalEventDraft,
  type MembershipPayload,
  type MessagePayload,
  type Participant,
  type Room,
  type Thread,
} from './world';

// ---------------------------------------------------------------------------
// Membership
// ---------------------------------------------------------------------------

/**
 * Pure membership change: returns the updated room (participantIds with the id
 * added/removed) plus the membership Sea-event draft to append. 'add' when the
 * id is already present / 'remove' when absent → room unchanged, event null.
 * Witnesses = roster BEFORE the change ∪ { participantId, userActorId }.
 */
export function applyMembershipChange(
  room: Room,
  participantId: string,
  kind: 'add' | 'remove',
  userActorId: string = USER_ACTOR,
): { room: Room; event: JournalEventDraft | null } {
  const present = room.participantIds.includes(participantId);
  if ((kind === 'add' && present) || (kind === 'remove' && !present)) {
    return { room, event: null };
  }
  const participantIds =
    kind === 'add'
      ? [...room.participantIds, participantId]
      : room.participantIds.filter((id) => id !== participantId);
  const event: JournalEventDraft = {
    roomId: room.id,
    scope: { kind: 'sea' },
    type: 'membership',
    actorId: HARNESS_ACTOR,
    witnesses: unique([...room.participantIds, participantId, userActorId]),
    payload: { participantId, action: kind === 'add' ? 'added' : 'removed' } satisfies MembershipPayload,
  };
  return { room: { ...room, participantIds }, event };
}

// ---------------------------------------------------------------------------
// History projection
// ---------------------------------------------------------------------------

/**
 * Project thread events into an LLM history for one participant.
 * Role mapping: participant's own messages → assistant; user (actorId ===
 * USER_ACTOR) → user; other participants' messages → user role with content
 * prefixed `${displayName}: `. Non-message events are skipped. Events are
 * already witness-filtered by the caller/compiler.
 */
export function projectHistoryForParticipant(
  events: JournalEvent[],
  participantId: string,
  participants: Participant[],
): LLMChatMessage[] {
  const byId = new Map(participants.map((p) => [p.id, p]));
  const history: LLMChatMessage[] = [];
  for (const e of visibleEventsFor(participantId, events, byId.get(participantId)?.capabilities)) {
    if (e.type !== 'message.user' && e.type !== 'message.character') continue;
    const rawText = messageText(e.payload);
    if (rawText === undefined) continue;
    const text = sanitizeJournalMessageText(e.type, rawText);
    if (e.actorId === participantId) {
      history.push({ role: 'assistant', content: text });
    } else if (e.actorId === USER_ACTOR) {
      history.push({ role: 'user', content: text });
    } else {
      const name = byId.get(e.actorId)?.displayName ?? e.actorId;
      history.push({ role: 'user', content: `${name}: ${text}` });
    }
  }
  return history;
}

// ---------------------------------------------------------------------------
// Threads
// ---------------------------------------------------------------------------

/** Create a new Thread for a room (explicit thread creation; id/timestamps injected). */
export function makeThread(roomId: string, id: string, now: number, title?: string): Thread {
  return { id, roomId, title, state: 'active', createdAt: now };
}

// ---------------------------------------------------------------------------
// Turn engine
// ---------------------------------------------------------------------------

export interface RoomAgentRunResult {
  text: string;
  reviewEvent?: JournalEvent;
}

export type RoomAgentRunner = (
  participantId: string,
  context: CompiledContext,
) => Promise<RoomAgentRunResult>;

export interface RunRoomTurnInput {
  thread?: Thread;
  room: Room;
  participants: Participant[]; // all known participants (lookup by id)
  seaEvents: JournalEvent[]; // room sea stream (witness-relevant)
  threadEvents: JournalEvent[]; // active thread INCLUDING the triggering user message as the last event
  runAgentTurn: RoomAgentRunner; // injected (renderer supplies AgentInstance-backed runner)
  appendEvent: (draft: JournalEventDraft, shape?: { index: number; count: number }) => Promise<JournalEvent>;
  contextTurn?: { text: string; threadId?: string };
  modality?: 'text' | 'voice';
  /** A trusted ingress (for example an accepted incoming call) may pin the
   * first response to the already-authoritative contacting participant. */
  initialSpeakerId?: string;
  maxCharacterExchanges?: number; // default 3 — total further group responses/interjections after the first
  compileContextFn?: typeof compileContext; // default: the real one
  userActorId?: string; // default USER_ACTOR
}

export interface RoomTurnResult {
  speakerIds: string[];
  events: JournalEvent[]; // events appended by the orchestrator (character messages)
  stoppedReason: 'no-eligible-speaker' | 'exchange-limit';
}

/**
 * Deterministic turn engine: directly addressed people respond; an unaddressed
 * group message gives eligible people a response opportunity. Responses and
 * named interjections share one bounded exchange budget.
 */
export async function runRoomTurn(input: RunRoomTurnInput): Promise<RoomTurnResult> {
  if (input.thread?.sandbox) {
    const context = sandboxContext(input.thread)!;
    if (input.room.id !== context.id) throw new Error('Sandbox turn context mismatch');
    input = { ...input, room: context, participants: threadParticipants(input.thread, []) };
  }
  const {
    room,
    participants,
    seaEvents,
    threadEvents,
    runAgentTurn,
    appendEvent,
    maxCharacterExchanges,
    compileContextFn = compileContext,
    userActorId = USER_ACTOR,
  } = input;

  const byId = new Map(participants.map((p) => [p.id, p]));
  const roster = room.participantIds
    .map((id) => byId.get(id))
    .filter((p): p is Participant => p !== undefined);

  // First response: compile a context for every roster participant, then pick
  // the speaker from the user's triggering message.
  const contexts = new Map<string, CompiledContext>();
  for (const p of roster) {
    contexts.set(p.id, compileContextFn({ room, thread: input.thread, participant: p, participants, seaEvents, threadEvents }));
  }
  const userText = input.contextTurn?.text ?? lastMessageText(threadEvents);
  const namedPeople = directlyAddressedPeople(roster, userText);
  const responseRoster = namedPeople.length ? namedPeople : roster;
  const firstSpeakerId = input.initialSpeakerId && roster.some(person => person.id === input.initialSpeakerId)
    ? input.initialSpeakerId
    : selectSpeaker(responseRoster, {
        lastEventText: userText,
        lastSpeakerId: userActorId,
      });
  if (firstSpeakerId === null) {
    return { speakerIds: [], events: [], stoppedReason: 'no-eligible-speaker' };
  }

  const speakerIds: string[] = [];
  const events: JournalEvent[] = [];
  const currentThreadEvents = [...threadEvents];
  const currentSeaEvents = [...seaEvents];
  const threadId = input.thread?.id ?? input.contextTurn?.threadId ?? threadIdOf(threadEvents);

  const runAndAppend = async (speakerId: string, context: CompiledContext): Promise<void> => {
    const result = await runAgentTurn(speakerId, context);
    if (result.reviewEvent) {
      currentThreadEvents.push(result.reviewEvent);
      if (result.reviewEvent.scope.kind === 'sea') currentSeaEvents.push(result.reviewEvent);
    }
    const speech = sanitizeModelSpeech(result.text);
    const beats = input.modality === 'voice' ? [speech] : splitConversationMessages(speech);
    const messages = beats.length ? beats : [''];
    speakerIds.push(speakerId);
    for (const [index, beat] of messages.entries()) {
      const draft: JournalEventDraft = {
        roomId: room.id,
        scope: threadId ? { kind: 'thread', threadId } : { kind: 'sea' },
        type: 'message.character',
        actorId: speakerId,
        witnesses: unique([...room.participantIds, userActorId]),
        payload: { text: sanitizeModelSpeech(beat), modality: input.modality ?? 'text' } satisfies MessagePayload,
      };
      const appended = await appendEvent(draft, { index, count: messages.length });
      events.push(appended);
      currentThreadEvents.push(appended);
    }
  };

  await runAndAppend(firstSpeakerId, contexts.get(firstSpeakerId)!);

  // Preserve the existing overall cap, including group replies. Within it,
  // prioritize people who have not spoken recently; quiet observers remain quiet
  // unless the learner names them. Accepted person-specific calls stay focused.
  const cap = Math.max(0, maxCharacterExchanges ?? 3);
  let exchanges = 0;
  const lastResponseIndex = (id: string): number => {
    for (let index = currentThreadEvents.length - 1; index >= 0; index--) {
      const event = currentThreadEvents[index];
      if (event.type === 'message.character' && event.actorId === id) return index;
    }
    return -1;
  };
  const pendingPeople = input.initialSpeakerId ? [] : responseRoster
    .filter(person => person.id !== firstSpeakerId && selectSpeaker([person], { lastEventText: userText }) !== null)
    .sort((a, b) => lastResponseIndex(a.id) - lastResponseIndex(b.id) || a.id.localeCompare(b.id));
  for (const person of pendingPeople) {
    if (exchanges >= cap) break;
    const context = compileContextFn({ room, thread: input.thread, participant: person, participants,
      seaEvents: currentSeaEvents, threadEvents: currentThreadEvents });
    await runAndAppend(person.id, context);
    exchanges++;
  }

  // Named character interjections use whatever remains of the same budget.
  let stoppedReason: RoomTurnResult['stoppedReason'] = 'no-eligible-speaker';
  while (exchanges < cap) {
    const last = events[events.length - 1];
    const lastText = messageText(last.payload);
    const next = selectSpeaker(roster, { lastEventText: lastText, lastSpeakerId: last.actorId });
    if (next === null || next === last.actorId) break;
    const nextParticipant = byId.get(next)!;
    if (
      lastText === undefined ||
      !lastText.toLowerCase().includes(nextParticipant.displayName.toLowerCase())
    ) {
      break;
    }
    const context = compileContextFn({
      room,
      thread: input.thread,
      participant: nextParticipant,
      participants,
      seaEvents: currentSeaEvents,
      threadEvents: currentThreadEvents,
    });
    await runAndAppend(next, context);
    exchanges++;
  }
  if (exchanges >= cap) stoppedReason = 'exchange-limit';

  return { speakerIds, events, stoppedReason };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A leading name followed by an address delimiter is an explicit audience.
 * A name elsewhere is merely a mention and must not exclude the rest of a group. */
function directlyAddressedPeople(roster: Participant[], text: string | undefined): Participant[] {
  let remaining = text?.trimStart().toLowerCase() ?? '';
  const addressed: Participant[] = [];
  while (remaining) {
    const matches = roster.filter(person => {
      const name = person.displayName.trim().toLowerCase();
      if (!name || !remaining.startsWith(name)) return false;
      const after = remaining.slice(name.length).trimStart();
      return after.startsWith(',') || after.startsWith(':');
    }).sort((a, b) => b.displayName.trim().length - a.displayName.trim().length);
    if (!matches.length) break;
    // Identical names do not resolve an identity unambiguously.
    if (matches[1]?.displayName.trim().length === matches[0].displayName.trim().length) return [];
    const person = matches[0];
    if (!addressed.some(item => item.id === person.id)) addressed.push(person);
    remaining = remaining.slice(person.displayName.trim().length).trimStart();
    if (remaining.startsWith(':')) break;
    remaining = remaining.slice(1).trimStart();
  }
  return addressed;
}

function unique(ids: string[]): string[] {
  return [...new Set(ids)];
}

function messageText(payload: unknown): string | undefined {
  if (typeof payload !== 'object' || payload === null) return undefined;
  const text = (payload as Record<string, unknown>).text;
  return typeof text === 'string' ? text : undefined;
}

function lastMessageText(events: JournalEvent[]): string | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.type === 'message.user' || e.type === 'message.character') {
      return messageText(e.payload);
    }
  }
  return undefined;
}

function threadIdOf(events: JournalEvent[]): string | undefined {
  for (const e of events) {
    if (e.scope.kind === 'thread') return e.scope.threadId;
  }
  return undefined;
}
