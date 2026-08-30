/**
 * Context compiler — per-participant redacted projection over raw journal streams.
 *
 * Contract source: .sisyphus/plans/conversational-runtime-overhaul.md §4 + Phase 1.
 * Pure and dependency-free: no I/O, no clock, no randomness. Nothing consumes
 * this yet; later phases (memory v2, Dreamer, Scenario Director) read its output.
 *
 * Visibility model (locked): visible(e, p) ⟺ p ∈ e.witnesses AND e.seq is not
 * inside any absence interval for p. Absence intervals derive from 'membership'
 * events (payload MembershipPayload), sorted by seq: 'removed' opens an interval
 * covering every seq AFTER that event (the removal event itself stays visible if
 * witnessed); 'added' closes it (the added event and later are visible again).
 * When p's earliest membership event is 'added' at seq s0, events with seq < s0
 * are excluded even if witnessed; with no membership events at all, the
 * membership rule allows everything through (witnesses still apply).
 */

import type {
  CanonCoordinate,
  EventType,
  JournalEvent,
  MemoryEntry,
  Participant,
  ScenarioGrounding,
  ThreadMediaRef,
} from './world';
import { projectionForCaller, type RoomMemoryProjection } from './memoryProjection';

/** Per-participant learner state merged into the compiled context (pass-through). */
export interface LearnerProjection {
  language?: string;
  failedWords?: string[];
  grammarPoints?: string[];
  levelEstimate?: string;
  /**
   * Epistemic provenance of each list. 'evidence' = direct user marks/claims
   * (failed markers, explicit tutor selections). 'prediction' = inferred
   * accessibility from heuristics (legacy ease bands, word-derived character
   * familiarity). Prediction must never be presented as measured failure.
   */
  wordsBasis?: 'evidence' | 'prediction';
  grammarBasis?: 'evidence' | 'prediction';
  /**
   * Patterns repeatedly passively encountered but never failed — exposure-ranked
   * practice candidates. Prediction/exposure signal only; must never be
   * presented as demonstrated failure (unlike grammarPoints).
   */
  grammarExposure?: string[];
}

/** One participant's redacted view of the world, ready for prompt assembly. */
export interface CompiledContext {
  persona: { text: string; facets: Record<string, number | string> };
  canonBaseline?: { lore: string; quotes: string[]; context: string; coordinate: CanonCoordinate };
  negativeKnowledge: string[];
  relationships: { toId: string; label: string }[];
  memories: { kind: MemoryEntry['kind']; text: string; createdAt: number }[];
  openLoops: { text: string; createdAt: number }[];
  learnerProjection?: LearnerProjection;
  threadMedia?: ThreadMediaRef;
  recentThreadEvents: { seq: number; type: EventType; actorId: string; text?: string; createdAt: number }[];
  /** The caller's own witness-scoped view of the room's memory state. */
  callerProjection: RoomMemoryProjection;
}

/** Everything compileContext needs to project one participant's context. */
export interface CompileContextInput {
  participant: Participant;
  participants: Participant[];
  seaEvents: JournalEvent[]; // full unfiltered sea stream; the compiler filters
  threadEvents?: JournalEvent[]; // active thread stream, unfiltered; the compiler filters
  grounding?: ScenarioGrounding; // per-participant doesNotKnow source
  learnerProjection?: LearnerProjection;
  threadMedia?: ThreadMediaRef; // media the active thread was launched from
}

const MEMORY_KINDS: readonly MemoryEntry['kind'][] = [
  'belief',
  'episode',
  'open-loop',
  'relationship',
  'fact',
];

interface AbsenceSource {
  events: { seq: number; action: 'added' | 'removed' }[];
}

function absenceSource(participantId: string, events: JournalEvent[]): AbsenceSource {
  const extracted = events
    .filter((e) => e.type === 'membership')
    .map((e) => {
      const payload = e.payload;
      if (typeof payload !== 'object' || payload === null) return undefined;
      const rec = payload as Record<string, unknown>;
      if (rec.participantId !== participantId) return undefined;
      if (rec.action !== 'added' && rec.action !== 'removed') return undefined;
      return { seq: e.seq, action: rec.action };
    })
    .filter((m): m is { seq: number; action: 'added' | 'removed' } => m !== undefined);
  return { events: extracted.sort((a, b) => a.seq - b.seq) };
}

function inAbsence(source: AbsenceSource, seq: number): boolean {
  const { events } = source;
  if (events.length === 0) return false;
  const first = events[0];
  if (first.action === 'added' && seq < first.seq) return true; // pre-join cutoff
  let removedAt = -1;
  for (const m of events) {
    if (m.action === 'removed') {
      removedAt = m.seq;
    } else if (removedAt >= 0) {
      if (seq > removedAt && seq < m.seq) return true; // gap between removal and re-add
      removedAt = -1;
    }
  }
  return removedAt >= 0 && seq > removedAt; // removed, never re-added
}

function isVisibleFor(
  participantId: string,
  absence: AbsenceSource,
  e: JournalEvent,
  capabilities?: Participant['capabilities'],
): boolean {
  return (capabilities?.witnessScope === 'all' || e.witnesses.includes(participantId)) && !inAbsence(absence, e.seq);
}

function isMemoryKind(value: unknown): value is MemoryEntry['kind'] {
  return typeof value === 'string' && (MEMORY_KINDS as readonly string[]).includes(value);
}

function messageText(payload: unknown): string | undefined {
  if (typeof payload !== 'object' || payload === null) return undefined;
  const text = (payload as Record<string, unknown>).text;
  return typeof text === 'string' ? text : undefined;
}

/**
 * Filters a journal stream down to what one participant can see: events they
 * witnessed that are not inside any of their absence intervals. Absence
 * intervals are derived from 'membership' events within `events` itself.
 */
export function visibleEventsFor(
  participantId: string,
  events: JournalEvent[],
  capabilities?: Participant['capabilities'],
): JournalEvent[] {
  const absence = absenceSource(participantId, events);
  return events.filter((e) => isVisibleFor(participantId, absence, e, capabilities));
}

/**
 * Compiles a per-participant redacted context from raw sea/thread streams.
 * Membership-derived absence intervals come from the sea stream and apply to
 * both streams; malformed payloads are skipped defensively, never thrown.
 */
export function compileContext(input: CompileContextInput): CompiledContext {
  const { participant, seaEvents, threadEvents, grounding, learnerProjection, threadMedia } = input;
  const { capabilities } = participant;

  // Membership events are sea-scoped (durable roster changes); the intervals
  // they open apply to thread events too, so a removed participant sees
  // nothing of the gap in either stream.
  const absence = absenceSource(participant.id, seaEvents);
  const visibleSea = seaEvents.filter((e) => isVisibleFor(participant.id, absence, e, capabilities));
  const visibleThread = (threadEvents ?? []).filter((e) => isVisibleFor(participant.id, absence, e, capabilities));

  const context: CompiledContext = {
    persona: { text: participant.personaText, facets: participant.facets ?? {} },
    negativeKnowledge: [],
    relationships: [],
    memories: [],
    openLoops: [],
    recentThreadEvents: visibleThread
      .slice()
      .sort((a, b) => a.seq - b.seq)
      .map((e) => ({
        seq: e.seq,
        type: e.type,
        actorId: e.actorId,
        text: messageText(e.payload),
        createdAt: e.createdAt,
      })),
    callerProjection: projectionForCaller(seaEvents, participant.id),
  };

  if (participant.canon) {
    context.canonBaseline = {
      lore: participant.canon.baseline.lore,
      quotes: participant.canon.baseline.quotes,
      context: participant.canon.baseline.context,
      coordinate: participant.canon.coordinate,
    };
    context.negativeKnowledge.push(...participant.canon.baseline.notYetHappened);
  }

  const groundingEntry =
    grounding?.perParticipant[participant.id] ?? grounding?.perParticipant[participant.displayName];
  if (groundingEntry) {
    context.negativeKnowledge.push(...groundingEntry.doesNotKnow);
  }

  for (const e of visibleSea) {
    if (e.type !== 'memory.belief') continue;
    const payload = e.payload;
    if (typeof payload !== 'object' || payload === null) continue;
    const rec = payload as Record<string, unknown>;
    if (rec.ownerId !== participant.id) continue;
    if (!isMemoryKind(rec.kind)) continue;
    const text = typeof rec.text === 'string' ? rec.text : undefined;
    if (rec.kind === 'relationship') {
      const label = typeof rec.label === 'string' ? rec.label : text;
      if (label === undefined) continue;
      context.relationships.push({
        toId: typeof rec.toId === 'string' ? rec.toId : '',
        label,
      });
      continue;
    }
    if (text === undefined) continue;
    if (rec.kind === 'open-loop') {
      context.openLoops.push({ text, createdAt: e.createdAt });
      continue;
    }
    context.memories.push({ kind: rec.kind, text, createdAt: e.createdAt });
  }

  if (learnerProjection) {
    context.learnerProjection = learnerProjection;
  }

  if (threadMedia) {
    context.threadMedia = threadMedia;
  }

  return context;
}
