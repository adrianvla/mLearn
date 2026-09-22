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
  Thread,
  Room,
} from './world';
import { projectionForCaller, tombstonedIds, openLoopStates, type RoomMemoryProjection } from './memoryProjection';
import { authoritativeScenario } from './scenarioState';
import { intentionStates, simulatedOccurrencePayload } from './autonomyProjection';
import {
  rankRecentThreadEvents,
  recentTailWithinBudget,
  scoreMemoryEntries,
  selectWithinBudget,
} from './contextRanking';

/** Per-participant learner state merged into the compiled context (pass-through). */
export interface LearnerProjection {
  language?: string;
  failedWords?: string[];
  grammarPoints?: string[];
  /** Measured ability, only when backed by assessment. */
  levelEstimate?: string;
  /** Chosen curriculum goal; never an ability estimate. */
  learningTarget?: string;
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
  scenario?: {
    sharedFacts: string[];
    constraints: string[];
    goals: string[];
    knowledge: string[];
    /** Director-derived interpretations. Structurally distinct from established occurrences. */
    interpretations: { authority: 'interpretation'; text: string; createdAt: number }[];
    /** A concluded situation is shared past; later turns treat it as such. */
    concluded: boolean;
  };
  persona: { id?: string; displayName?: string; text: string; facets: Record<string, number | string> };
  canonBaseline?: { lore: string; quotes: string[]; context: string; coordinate: CanonCoordinate };
  negativeKnowledge: string[];
  relationships: { toId: string; label: string }[];
  memories: { kind: MemoryEntry['kind']; text: string; createdAt: number }[];
  openLoops: { text: string; createdAt: number }[];
  /** Current private intentions owned by this participant. */
  intentions: { intentionId: string; status: 'created' | 'pursued' | 'revised'; text: string; createdAt: number }[];
  /** Established simulated occurrences this participant actually witnessed. */
  witnessedOccurrences: { eventId: string; summary: string; actorIds: string[]; effectiveAt: number }[];
  learnerProjection?: LearnerProjection;
  threadIntent?: string;
  threadMedia?: ThreadMediaRef;
  recentThreadEvents: { seq: number; type: EventType; actorId: string; text?: string; createdAt: number }[];
  /** The caller's own witness-scoped view of the room's memory state. */
  callerProjection: RoomMemoryProjection;
}

/** Current-turn retrieval bounds; an absent turn means no ranking, no budgeting. */
export interface TurnContext {
  text: string;
  memoryBudgetTokens?: number;
  threadBudgetTokens?: number;
}

/** Everything compileContext needs to project one participant's context. */
export interface CompileContextInput {
  room?: Room;
  thread?: Thread;
  participant: Participant;
  participants: Participant[];
  seaEvents: JournalEvent[]; // full unfiltered sea stream; the compiler filters
  threadEvents?: JournalEvent[]; // active thread stream, unfiltered; the compiler filters
  grounding?: ScenarioGrounding; // per-participant doesNotKnow source
  learnerProjection?: LearnerProjection;
  threadIntent?: string;
  threadMedia?: ThreadMediaRef; // media the active thread was launched from
  turn?: TurnContext; // current-turn text + budget overrides; ranking/budgeting only when present
}

const MEMORY_KINDS: readonly MemoryEntry['kind'][] = [
  'belief',
  'episode',
  'open-loop',
  'relationship',
  'fact',
];

const DEFAULT_MEMORY_BUDGET_TOKENS = 350;
const DEFAULT_THREAD_BUDGET_TOKENS = 700;
/** Newest thread events always kept before turn relevance selects older ones. */
const THREAD_KEEP_LATEST = 12;

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
  return (capabilities?.witnessScope === 'all' || e.witnesses.includes(participantId)) && (Boolean(e.provenance?.integrationId) || !inAbsence(absence, e.seq));
}

function isMemoryKind(value: unknown): value is MemoryEntry['kind'] {
  return typeof value === 'string' && (MEMORY_KINDS as readonly string[]).includes(value);
}

function messageText(payload: unknown): string | undefined {
  if (typeof payload !== 'object' || payload === null) return undefined;
  const text = (payload as Record<string, unknown>).text;
  return typeof text === 'string' ? text : undefined;
}

function maxCreatedAt(events: JournalEvent[]): number {
  let max = 0;
  for (const e of events) if (e.createdAt > max) max = e.createdAt;
  return max;
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
  const rooms = new Map<string, JournalEvent[]>();
  for (const event of events) {
    const key = `${event.roomId}:${event.scope.kind === 'sea' ? 'sea' : event.scope.threadId}`;
    rooms.set(key, [...(rooms.get(key) ?? []), event]);
  }
  return [...rooms.values()].flatMap((stream) => {
    const absence = absenceSource(participantId, stream);
    return stream.filter((event) => isVisibleFor(participantId, absence, event, capabilities));
  });
}

/**
 * Compiles a per-participant redacted context from raw sea/thread streams.
 * Membership-derived absence intervals come from the sea stream and apply to
 * both streams; malformed payloads are skipped defensively, never thrown. With
 * `turn`, memories, open loops, and recent thread events are additionally
 * ranked and token-budgeted for the current turn; filtering always precedes
 * budgeting (see contextRanking).
 */

/** Sea and Thread sequence numbers are independent. Cross-stream membership
 * intervals use timestamps; explicit witnesses remain the visibility authority. */
export function visibleThreadEventsFor(
  participant: Participant,
  threadEvents: JournalEvent[],
  seaEvents: JournalEvent[],
): JournalEvent[] {
  return threadEvents.filter((event) => {
    const membership = seaEvents.filter((item) => item.roomId === event.roomId)
      .map((item) => ({ ...item, seq: item.createdAt }));
    return isVisibleFor(participant.id, absenceSource(participant.id, membership),
      { ...event, seq: event.createdAt }, participant.capabilities);
  });
}

export function compileContext(input: CompileContextInput): CompiledContext {
  const { grounding, learnerProjection, threadMedia, turn } = input;
  const sandbox = input.thread?.sandbox;
  const binding = sandbox?.bindings.find(item => item.baseline.id === input.participant.id);
  if (sandbox && !binding) throw new Error('Participant is not bound to this sandbox');
  const participant = binding?.localOverride ?? binding?.baseline ?? input.participant;
  const seaEvents = sandbox
    ? (input.seaEvents ?? []).filter(event => event.scope.kind === 'sea' && event.seq <= (sandbox.baselineHeads[event.roomId] ?? 0))
    : (input.seaEvents ?? []);
  const threadEvents = input.thread
    ? input.threadEvents?.filter(event => event.scope.kind === 'thread' && event.scope.threadId === input.thread!.id)
    : input.threadEvents;
  const { capabilities } = participant;

  // Membership events are sea-scoped (durable roster changes); the intervals
  // they open apply to thread events too, so a removed participant sees
  // nothing of the gap in either stream.
  const visibleSea = visibleEventsFor(participant.id, seaEvents, capabilities);
  const visibleThread = visibleThreadEventsFor(participant, threadEvents ?? [], sandbox ? [] : seaEvents);

  const context: CompiledContext = {
    persona: { id: participant.id, displayName: participant.displayName, text: participant.personaText, facets: participant.facets ?? {} },
    negativeKnowledge: [],
    relationships: [],
    memories: [],
    openLoops: [],
    intentions: [],
    witnessedOccurrences: [],
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

  // Explicit saved Thread selection retains its historical scope. Ordinary
  // Room turns consume the persistent situation without selecting a Thread.
  const scenario = input.thread ? input.thread.scenario : input.room?.scenario;
  if (scenario) {
    // Authoritative current view: retracted/invalidated developments and goal
    // changes leave the situation state; the stored chain is never rewritten.
    const current = authoritativeScenario(scenario, [...seaEvents, ...(threadEvents ?? [])]);
    const invalidSources = tombstonedIds([...seaEvents, ...(threadEvents ?? [])]);
    const knownDevelopments = current.developments.filter(dev =>
      dev.witnesses?.includes(participant.id) && !dev.sourceEventIds.some(id => invalidSources.has(id)));
    const own = scenario.participants.find(item =>
      (item.kind === 'temporary' && item.localId === participant.id) || (item.kind === 'existing' && item.participantId === participant.id));
    context.scenario = {
      sharedFacts: scenario.scene.sharedFacts,
      constraints: [...scenario.scene.socialConstraints, ...(own?.kind === 'temporary' ? own.profile.behaviorConstraints : [])],
      goals: own !== undefined ? current.currentGoals[own.kind === 'temporary' ? own.localId : own.participantId] ?? [] : [],
      knowledge: scenario.participants.flatMap(item => item.kind === 'temporary'
        ? item.profile.initialKnowledge.filter(fact => fact.witnesses.includes(participant.id)).map(fact => fact.text) : []),
      interpretations: knownDevelopments.slice(-12).map(dev => ({ authority: dev.authority, text: dev.text, createdAt: dev.createdAt })),
      concluded: current.status === 'concluded' && knownDevelopments.some(dev => dev.kind === 'resolution'),
    };
    context.relationships.push(...scenario.relationships.filter(relation => relation.fromId === participant.id)
      .map(relation => ({ toId: relation.toId, label: relation.label })));
  }

  const groundingEntry =
    grounding?.perParticipant[participant.id] ?? grounding?.perParticipant[participant.displayName];
  if (groundingEntry) {
    context.negativeKnowledge.push(...groundingEntry.doesNotKnow);
  }

  // Tombstones derive from the visible stream: a correction this viewer never
  // saw has not erased the memory in their view (matches projectionForCaller).
  // Unconditional — applies with or without `turn`.
  const memoryEvents = [...new Map([...visibleSea, ...visibleThread].map(event => [
    JSON.stringify([event.roomId, event.scope, event.id]), event,
  ])).values()];
  const tombstoned = tombstonedIds(memoryEvents);
  const loopStates = openLoopStates(memoryEvents);

  for (const state of intentionStates(memoryEvents).values()) {
    if (!state.active || state.payload.ownerId !== participant.id) continue;
    context.intentions.push({
      intentionId: state.payload.intentionId,
      status: state.payload.status as 'created' | 'pursued' | 'revised',
      text: state.payload.text,
      createdAt: state.event.createdAt,
    });
  }
  context.intentions = context.intentions.sort((a, b) => a.createdAt - b.createdAt).slice(-8);
  context.witnessedOccurrences = memoryEvents.flatMap((event) => {
    if (tombstoned.has(event.id)) return [];
    const payload = simulatedOccurrencePayload(event);
    return payload ? [{
      eventId: event.id,
      summary: payload.summary,
      actorIds: payload.actorIds,
      effectiveAt: payload.effectiveAt,
    }] : [];
  }).sort((a, b) => a.effectiveAt - b.effectiveAt).slice(-8);

  for (const e of memoryEvents) {
    if (e.type !== 'memory.belief') continue;
    if (tombstoned.has(e.id)) continue;
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
      // Loop lifecycle: only loops without a grounded resolution compile as
      // open. Resolved/cancelled/contradicted/superseded loops stay history.
      if (loopStates.get(e.id)?.status !== 'open') continue;
      context.openLoops.push({ text, createdAt: e.createdAt });
      continue;
    }
    context.memories.push({ kind: rec.kind, text, createdAt: e.createdAt });
  }

  if (turn) {
    // Rank/budget strictly AFTER witness/absence/tombstone filtering: budget
    // pressure can drop visible entries but never resurrect invisible ones.
    const now = Math.max(maxCreatedAt(visibleSea), maxCreatedAt(visibleThread));
    const memoryBudget = turn.memoryBudgetTokens ?? DEFAULT_MEMORY_BUDGET_TOKENS;
    const threadBudget = turn.threadBudgetTokens ?? DEFAULT_THREAD_BUDGET_TOKENS;
    context.memories = selectWithinBudget(scoreMemoryEntries(context.memories, turn.text, now), memoryBudget);
    context.openLoops = selectWithinBudget(scoreMemoryEntries(context.openLoops, turn.text, now), memoryBudget);
    context.recentThreadEvents = recentTailWithinBudget(
      rankRecentThreadEvents(context.recentThreadEvents, turn.text, THREAD_KEEP_LATEST),
      threadBudget,
    );
  }

  if (learnerProjection) {
    context.learnerProjection = learnerProjection;
  }

  if (input.threadIntent && !scenario) context.threadIntent = input.threadIntent;

  if (threadMedia) {
    context.threadMedia = threadMedia;
  }

  return context;
}
