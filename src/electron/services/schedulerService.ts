import { randomUUID } from 'crypto';
import { appendEvent, readSeaProjection } from './journalService';
import { loadWorld, saveWorld } from './worldStore';
import {
  evaluateProactivity,
  isInQuietHours,
  nextCallEventType,
  type ProactiveCandidate,
  type ProactivityDecision,
} from '../../shared/proactivity';
import { HARNESS_ACTOR, USER_ACTOR, type CallPayload, type EventType, type SchedulePayload } from '../../shared/world';
import type { Settings } from '../../shared/types';

const STALE_MS = 24 * 60 * 60 * 1000;

interface SchedulerDeps {
  now: () => number;
  notify: (title: string, body: string, roomId: string) => void;
  getSettings: () => Settings;
  openRoomEvent?: (roomId: string, callId?: string) => void;
}

interface ReconcileResult {
  fired: string[];
  suppressed: string[];
  dropped: string[];
}

function isScheduledCandidate(payload: unknown): payload is SchedulePayload {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return false;
  const candidate = payload as Record<string, unknown>;
  return (
    typeof candidate.candidateId === 'string' &&
    (candidate.kind === 'message' || candidate.kind === 'call') &&
    typeof candidate.participantId === 'string' &&
    typeof candidate.fireAt === 'number' &&
    (candidate.text === undefined || typeof candidate.text === 'string')
  );
}

function decisionFor(
  candidate: ProactiveCandidate,
  settings: Settings,
  now: number,
  participantKinds: Record<string, 'persistent' | 'temporary'>
): ProactivityDecision {
  return evaluateProactivity([candidate], settings, { now, participantKinds });
}

function isEligible(decision: ProactivityDecision): boolean {
  return decision.kind !== 'nothing';
}

function suppressionReason(decision: ProactivityDecision): string | undefined {
  return decision.suppressedBy;
}

function callEventType(action: 'accepted' | 'declined' | 'missed' | 'ended'): EventType {
  return nextCallEventType(action);
}

export function createSchedulerService(deps: SchedulerDeps) {
  async function append(roomId: string, type: EventType, actorId: string, payload: unknown, witnesses: string[]): Promise<void> {
    await appendEvent(roomId, {
      roomId,
      scope: { kind: 'sea' },
      type,
      actorId,
      witnesses,
      payload,
    });
  }

  async function bumpUnread(roomId: string): Promise<void> {
    const world = await loadWorld();
    const room = world.rooms.find((item) => item.id === roomId);
    if (room === undefined) return;
    room.unreadCount = (room.unreadCount ?? 0) + 1;
    await saveWorld(world);
  }

  async function reconcile(roomId: string): Promise<ReconcileResult> {
    const now = deps.now();
    const world = await loadWorld();
    const participantKinds: Record<string, 'persistent' | 'temporary'> = Object.fromEntries(
      world.participants.map((participant) => [participant.id, participant.kind])
    );
    const events = await readSeaProjection(roomId);
    const fulfilled = new Set(
      events
        .filter((event) => event.type === 'proactive_fulfilled' && event.payload !== null && typeof event.payload === 'object')
        .map((event) => (event.payload as Record<string, unknown>).candidateId)
        .filter((candidateId): candidateId is string => typeof candidateId === 'string')
    );
    const result: ReconcileResult = { fired: [], suppressed: [], dropped: [] };

    for (const event of events) {
      if (event.type !== 'schedule' || !isScheduledCandidate(event.payload)) continue;
      const candidate = event.payload;
      if (fulfilled.has(candidate.candidateId) || now - candidate.fireAt > STALE_MS) {
        result.dropped.push(candidate.candidateId);
        continue;
      }
      if (candidate.fireAt > now) continue;
      if (candidate.kind === 'message' && candidate.text === undefined) {
        result.dropped.push(candidate.candidateId);
        continue;
      }

      const proactiveCandidate: ProactiveCandidate = {
        id: candidate.candidateId,
        participantId: candidate.participantId,
        kind: candidate.kind,
        text: candidate.text,
        score: candidate.score ?? 1,
        createdAt: event.createdAt,
        lastFiredAt: candidate.lastFiredAt,
      };
      const decision = decisionFor(proactiveCandidate, deps.getSettings(), now, participantKinds);
      const seenBy = [candidate.participantId, USER_ACTOR];
      if (isEligible(decision)) {
        if (candidate.kind === 'call') {
          const payload: CallPayload = { callId: randomUUID() };
          await append(roomId, 'call_initiated', candidate.participantId, payload, seenBy);
          deps.notify('Incoming call', candidate.participantId, roomId);
        } else {
          await append(roomId, 'proactive_requested', HARNESS_ACTOR, { candidateId: candidate.candidateId }, seenBy);
          const message = await appendEvent(roomId, {
            roomId,
            scope: { kind: 'sea' },
            type: 'message.character',
            actorId: candidate.participantId,
            witnesses: seenBy,
            payload: { text: candidate.text },
          });
          await append(roomId, 'proactive_fulfilled', HARNESS_ACTOR, {
            candidateId: candidate.candidateId,
            messageEventId: message.id,
          }, seenBy);
          deps.notify('New message', candidate.text!, roomId);
        }
        fulfilled.add(candidate.candidateId);
        result.fired.push(candidate.candidateId);
        continue;
      }

      if (suppressionReason(decision) === 'quiet-hours' && candidate.kind === 'message') {
        await append(roomId, 'proactive_requested', HARNESS_ACTOR, { candidateId: candidate.candidateId }, seenBy);
        const message = await appendEvent(roomId, {
          roomId,
          scope: { kind: 'sea' },
          type: 'message.character',
          actorId: candidate.participantId,
          witnesses: seenBy,
          payload: { text: candidate.text },
        });
        await append(roomId, 'proactive_fulfilled', HARNESS_ACTOR, {
          candidateId: candidate.candidateId,
          messageEventId: message.id,
        }, seenBy);
        await bumpUnread(roomId);
        fulfilled.add(candidate.candidateId);
        result.suppressed.push(candidate.candidateId);
      } else {
        result.dropped.push(candidate.candidateId);
      }
    }

    return result;
  }

  async function reconcileOnQuietHoursExpiry(roomId: string): Promise<ReconcileResult> {
    if (isInQuietHours(deps.getSettings(), deps.now())) return { fired: [], suppressed: [], dropped: [] };
    return reconcile(roomId);
  }

  async function transitionCall(roomId: string, callId: string, action: 'accepted' | 'declined' | 'missed' | 'ended'): Promise<void> {
    const payload: CallPayload = { callId };
    // ponytail: user-witnessed only; caller id would need a call_initiated lookup if character-perspective call logs matter
    await append(roomId, callEventType(action), HARNESS_ACTOR, payload, [USER_ACTOR]);
    if (action === 'accepted') deps.openRoomEvent?.(roomId, callId);
    if (action === 'missed') await bumpUnread(roomId);
  }

  return {
    reconcile,
    reconcileOnQuietHoursExpiry,
    acceptCall: (roomId: string, callId: string) => transitionCall(roomId, callId, 'accepted'),
    declineCall: (roomId: string, callId: string) => transitionCall(roomId, callId, 'declined'),
    missCall: (roomId: string, callId: string) => transitionCall(roomId, callId, 'missed'),
    endCall: (roomId: string, callId: string) => transitionCall(roomId, callId, 'ended'),
  };
}
