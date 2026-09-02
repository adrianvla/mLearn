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

import { compileContext, type CompiledContext } from './contextCompiler';
import { selectSpeaker } from './speakerSelection';
import type { LLMChatMessage } from './types';
import {
  HARNESS_ACTOR,
  USER_ACTOR,
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
  for (const e of events) {
    if (e.type !== 'message.user' && e.type !== 'message.character') continue;
    const text = messageText(e.payload);
    if (text === undefined) continue;
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
}

export type RoomAgentRunner = (
  participantId: string,
  context: CompiledContext,
) => Promise<RoomAgentRunResult>;

export interface RunRoomTurnInput {
  room: Room;
  participants: Participant[]; // all known participants (lookup by id)
  seaEvents: JournalEvent[]; // room sea stream (witness-relevant)
  threadEvents: JournalEvent[]; // active thread INCLUDING the triggering user message as the last event
  runAgentTurn: RoomAgentRunner; // injected (renderer supplies AgentInstance-backed runner)
  appendEvent: (draft: JournalEventDraft) => Promise<JournalEvent>;
  maxCharacterExchanges?: number; // default 3 — max character→character turns AFTER the first response
  compileContextFn?: typeof compileContext; // default: the real one
  userActorId?: string; // default USER_ACTOR
}

export interface RoomTurnResult {
  speakerIds: string[];
  events: JournalEvent[]; // events appended by the orchestrator (character messages)
  stoppedReason: 'no-eligible-speaker' | 'exchange-limit';
}

/**
 * Deterministic turn engine: one first response from the roster, then bounded
 * character→character interjections (each must directly address the next
 * speaker by name). Termination is guaranteed by the exchange cap.
 */
export async function runRoomTurn(input: RunRoomTurnInput): Promise<RoomTurnResult> {
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
    contexts.set(p.id, compileContextFn({ participant: p, participants, seaEvents, threadEvents }));
  }
  const firstSpeakerId = selectSpeaker(roster, {
    lastEventText: lastMessageText(threadEvents),
    lastSpeakerId: userActorId,
  });
  if (firstSpeakerId === null) {
    return { speakerIds: [], events: [], stoppedReason: 'no-eligible-speaker' };
  }

  const speakerIds: string[] = [];
  const events: JournalEvent[] = [];
  const currentThreadEvents = [...threadEvents];
  const threadId = threadIdOf(threadEvents);

  const runAndAppend = async (speakerId: string, context: CompiledContext): Promise<void> => {
    const result = await runAgentTurn(speakerId, context);
    const draft: JournalEventDraft = {
      roomId: room.id,
      scope: { kind: 'thread', threadId },
      type: 'message.character',
      actorId: speakerId,
      witnesses: unique([...room.participantIds, userActorId]),
      payload: { text: result.text } satisfies MessagePayload,
    };
    const appended = await appendEvent(draft);
    speakerIds.push(speakerId);
    events.push(appended);
    currentThreadEvents.push(appended);
  };

  await runAndAppend(firstSpeakerId, contexts.get(firstSpeakerId)!);

  // Bounded interjection loop: continue only while the last character message
  // directly addresses the next speaker by name (the same rule selectSpeaker
  // uses). The cap guarantees termination for adversarial inputs.
  const cap = maxCharacterExchanges ?? 3;
  let exchanges = 0;
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
      participant: nextParticipant,
      participants,
      seaEvents,
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

function threadIdOf(events: JournalEvent[]): string {
  for (const e of events) {
    if (e.scope.kind === 'thread') return e.scope.threadId;
  }
  throw new Error('runRoomTurn: threadEvents must contain a thread-scoped event');
}