/**
 * Dreamer — deferred consolidation of journal history into durable beliefs,
 * resolved open loops, and salience projections.
 *
 * V08 scope (automatic scoped reflection):
 * - One scoped commit path for every journal context: Sea Rooms, world
 *   continuity, and sandbox Threads. Sandbox output stays thread-local (the
 *   journal scope enforces isolation; nothing here promotes it to Sea).
 * - Reflection is per-person: each cast member consolidates only their own
 *   witness/absence-filtered view of the window (KNOW-02/MEM-07). One model
 *   call per person with unconsolidated history; no shared omniscient prompt.
 *   Derived rows are validated against the context's cast: the model may only
 *   assign beliefs to the reflecting owner and cite events from that owner's
 *   view. Model output can never create identities or read another person's
 *   private events.
 * - Interpretation-only authority: reflection may derive beliefs, open loops,
 *   and relationships — never historical episodes or lore facts (those kinds
 *   stay reserved for user-authored memories). The output schema has no field
 *   for new occurrences, so model prose can never become event rows.
 * - Per-conclusion provenance: every belief and every resolution carries its
 *   own sourceEventIds, canonically validated as a subset of that owner's
 *   witnessed window view; any violation rejects the whole output.
 * - Typed loop resolution: a resolution must close one of the owner's
 *   currently-open loops by event id with a LoopResolutionStatus — free-text
 *   resolutions are not accepted.
 * - Belief supersession: a belief may replace one of the owner's prior derived
 *   beliefs (supersedesEventId); the projection tombstones the replaced row.
 * - Continuing-person context: each owner is prompted with their own derived
 *   beliefs and open loops carried across Rooms (Sea) — prior state is
 *   context, never source. Thread sandboxes stay thread-local.
 * - Crash-safe commit: a durable pending record (world.json ledger) is written
 *   BEFORE any journal row, and the validated derived drafts are persisted in
 *   that record before their first journal append. Every derived row and the
 *   window marker carry the operation id in provenance, so an interrupted run
 *   resumes all-or-nothing and can never re-derive (duplicate) a window.
 * - Reflection only derives subjective state from real history. It never
 *   fabricates occurrences: that boundary is enforced by output shape
 *   (memory.belief / resolution are interpretation event types) plus prompt
 *   constraints, and by excluding already-derived rows from every window.
 *
 * The maintenance ledger and marker helpers are shared with the Director's
 * scenario-evolution pass (same durable-recovery contract, distinct kind).
 */

import { createHash, randomUUID } from 'crypto';
import { livingWorldEnabled, requireLivingWorld } from '../../shared/livingWorld';
import { loadSettings } from './settings';
import type { InferencePolicy } from '../../shared/inferencePolicy';
import { HARNESS_ACTOR, USER_ACTOR, WORLD_CONTINUITY_ID } from '../../shared/world';
import type {
  ConsolidationPayload,
  JournalEvent,
  JournalEventDraft,
  LoopResolutionStatus,
  MemoryEventPayload,
  Participant,
  ReflectionRunRecord,
  ResolutionPayload,
} from '../../shared/world';
import { openLoopStates, tombstonedIds } from '../../shared/memoryProjection';
import { visibleEventsFor } from '../../shared/contextCompiler';
import { appendEvent, readSeaProjection, readThread, readPreparedMaintenanceEvents } from './journalService';
import { applyMaintenanceProjection } from './projectionStore';
import { getUserDataPath } from '../utils/platform';
import { loadWorld, saveWorld, withWorldMutation, type WorldState } from './worldStore';

export interface ReflectionContext {
  /** Journal context id: a Room id, world continuity, or a sandbox Thread id. */
  roomId: string;
  scopeKind: 'sea' | 'thread';
  threadId?: string;
}

/** Proven maintenance conflict (inconsistent prepared content). Terminal:
 *  settle failed and expose the note; never relabel published effects. */
export class MaintenanceConflictError extends Error {}

export interface DreamerDependencies {
  policy: InferencePolicy;
  llmFn: (prompt: string) => Promise<string>;
  now?: number;
  /** Cancellation surface (MEM-02): shutdown and context deletion abort a run
   *  at phase boundaries; a prepared publication finishes (idempotent) instead
   *  of stranding half-derived rows. */
  signal?: AbortSignal;
}

/** One derived interpretation the model proposed, speaking as one owner. */
interface DreamerBelief {
  ownerId: string;
  kind: MemoryEventPayload['kind'];
  text: string;
  toId?: string;
  label?: string;
  /** Per-conclusion provenance: the exact witnessed events supporting THIS item. */
  sourceEventIds: string[];
  /** Optional semantic supersession of one of the owner's prior derived beliefs. */
  supersedesEventId?: string;
}

/** A grounded close-out of one of the owner's currently-open loops. The model
 *  names the loop by its 1-based position in the prompt's openLoops list;
 *  canonical code maps that ordinal to the real journal event id — the model
 *  never handles loop identity. */
interface DreamerResolution {
  ownerId: string;
  loopIndex: number;
  status: LoopResolutionStatus;
  text: string;
  sourceEventIds: string[];
  /** Filled by validateDerived from the canonical open-loop list. */
  loopId?: string;
}

interface DreamerOutput {
  beliefs: DreamerBelief[];
  resolutions: DreamerResolution[];
}

/** Interpretation-only kinds: reflection derives the owner's subjective state.
 *  'episode'/'fact' stay reserved for user-authored memories (the worldIpc
 *  remember-this path), so model prose can never become episode/lore rows. */
const MEMORY_KINDS: ReadonlySet<MemoryEventPayload['kind']> = new Set<MemoryEventPayload['kind']>(['belief', 'open-loop', 'relationship']);

/** Named maintenance bounds (TIME-07): one run processes at most this many events per person. */
export const REFLECTION_WINDOW_EVENTS = 40;
/** OPS-04: repeated invalid model output must terminate, not loop forever. */
export const MAX_MAINTENANCE_ATTEMPTS = 3;
const DERIVED_TEXT_LIMIT = 2000;
/** Continuing-person context caps: prior state is context, never source. */
const PRIOR_BELIEF_PROMPT_CAP = 12;
const OPEN_LOOP_PROMPT_CAP = 12;
/** Epistemic event types eligible for consolidation; operational markers are never sources. */
export const SOURCE_TYPES: ReadonlySet<JournalEvent['type']> = new Set([
  'message.user', 'message.character', 'memory.belief', 'disclosure', 'resolution', 'membership',
  'intention', 'occurrence.simulated',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

const LOOP_RESOLUTION_STATUSES: readonly LoopResolutionStatus[] = ['satisfied', 'cancelled', 'contradicted', 'superseded'];

function isLoopResolutionStatus(value: unknown): value is LoopResolutionStatus {
  return typeof value === 'string' && (LOOP_RESOLUTION_STATUSES as readonly string[]).includes(value);
}

/** Per-conclusion citations: at least one non-empty event id (membership is
 *  validated canonically against the owner's view in validateDerived). */
function parseCitations(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const ids: string[] = [];
  for (const id of value) {
    if (!isNonEmptyString(id)) return null;
    ids.push(id);
  }
  return ids;
}

function parseDreamerOutput(raw: string): DreamerOutput | null {
  if (raw.length > 12000) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/, '$1'));
  } catch {
    return null;
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.beliefs) || parsed.beliefs.length > 12 || (parsed.resolutions !== undefined && (!Array.isArray(parsed.resolutions) || parsed.resolutions.length > 12))) return null;

  const beliefs: DreamerBelief[] = [];
  for (const candidate of parsed.beliefs) {
    if (!isRecord(candidate) || !isNonEmptyString(candidate.ownerId) || !isNonEmptyString(candidate.text)) return null;
    if (typeof candidate.kind !== 'string' || !MEMORY_KINDS.has(candidate.kind as MemoryEventPayload['kind'])) return null;
    const sourceEventIds = parseCitations(candidate.sourceEventIds);
    if (sourceEventIds === null) return null;
    let toId: string | undefined;
    let label: string | undefined;
    if (candidate.toId !== undefined && candidate.toId !== null) {
      if (!isNonEmptyString(candidate.toId)) return null;
      toId = candidate.toId;
    }
    if (candidate.label !== undefined && candidate.label !== null) {
      if (!isNonEmptyString(candidate.label)) return null;
      label = candidate.label;
    }
    if (candidate.kind === 'relationship' && (toId === undefined || label === undefined)) return null;
    // A non-relationship belief carrying stray toId/label is kept with the
    // relation dropped (never promoted to a relationship edge) — the owner
    // identity is what validation guards.
    const isRelationship = candidate.kind === 'relationship';
    let supersedesEventId: string | undefined;
    if (candidate.supersedesEventId !== undefined && candidate.supersedesEventId !== null) {
      if (!isNonEmptyString(candidate.supersedesEventId)) return null;
      supersedesEventId = candidate.supersedesEventId;
    }
    beliefs.push({
      ownerId: candidate.ownerId,
      kind: candidate.kind as MemoryEventPayload['kind'],
      text: candidate.text,
      sourceEventIds,
      ...(isRelationship && toId !== undefined ? { toId } : {}),
      ...(isRelationship && label !== undefined ? { label } : {}),
      ...(supersedesEventId !== undefined ? { supersedesEventId } : {}),
    });
  }

  const resolutions: DreamerResolution[] = [];
  // An absent resolutions key (no open loops for this owner) parses as none.
  for (const candidate of parsed.resolutions ?? []) {
    if (!isRecord(candidate) || !isNonEmptyString(candidate.ownerId) || !isNonEmptyString(candidate.text)) return null;
    // A resolution must close one of the LISTED loops by 1-based position:
    // the model never handles loop journal ids; code maps the ordinal.
    // Small models emit the ordinal as a string; coerce, then range-check.
    const loopRaw = candidate.loop;
    const loopNum = typeof loopRaw === 'number'
      ? loopRaw
      : (typeof loopRaw === 'string' && /^-?\d+$/.test(loopRaw.trim()) ? Number(loopRaw.trim()) : NaN);
    if (!Number.isInteger(loopNum) || loopNum < 1 || loopNum > 99) return null;
    if (!isLoopResolutionStatus(candidate.status)) return null;
    const sourceEventIds = parseCitations(candidate.sourceEventIds);
    if (sourceEventIds === null) return null;
    resolutions.push({ ownerId: candidate.ownerId, loopIndex: loopNum, status: candidate.status, text: candidate.text, sourceEventIds });
  }
  return { beliefs, resolutions };
}

function isConsolidationPayload(payload: unknown): payload is ConsolidationPayload {
  return (
    isRecord(payload) &&
    typeof payload.windowStart === 'number' &&
    Number.isFinite(payload.windowStart) &&
    typeof payload.windowEnd === 'number' &&
    Number.isFinite(payload.windowEnd) &&
    Array.isArray(payload.producedEventIds) &&
    payload.producedEventIds.every((id) => typeof id === 'string')
  );
}

/** One journal context's canonical stream: Sea rooms/world continuity, or a sandbox Thread. */
export function readContextStream(context: ReflectionContext): Promise<JournalEvent[]> {
  if (context.scopeKind === 'thread') {
    return readThread(context.roomId, context.threadId!);
  }
  return readSeaProjection(context.roomId).then(uniqueSeaEvents);
}

function uniqueSeaEvents(events: JournalEvent[]): JournalEvent[] {
  return [...new Map(events.filter((event) => event.scope.kind === 'sea').map((event) => [event.id, event])).values()].sort(
    (left, right) => left.seq - right.seq
  );
}

/** One reflecting persona: id, display name, and persona text for the prompt. */
interface CastMember { id: string; name: string; personaText: string; }

interface ContextCast { owners: Participant[]; targets: string[]; names: CastMember[]; }

function makePrompt(
  owner: CastMember,
  view: JournalEvent[],
  cast: CastMember[],
  continuing: { priorBeliefs: { id: string; text: string; createdAt: number }[]; openLoops: OpenLoopChoice[] },
): string {
  // When the owner has no open loops, the output contract omits the
  // resolutions key entirely: the model must not be invited to invent loop
  // ids. Canonical code owns the shape; validation still rejects any
  // resolutions that appear without a matching entitled loop.
  const hasLoops = continuing.openLoops.length > 0;
  return JSON.stringify({
    task: `You speak only as ${owner.name} (${owner.id}). Consolidate the events below into ${owner.name}'s durable private beliefs${hasLoops ? ' and grounded resolutions of the listed open loops' : ''}. Every belief is ${owner.name}'s subjective interpretation of events ${owner.name} actually witnessed — never a new event or occurrence, never another person's private view, never an objective world fact.`,
    persona: owner.personaText,
    cast: cast.map((person) => ({ id: person.id, name: person.name })),
    continuingContext: {
      priorBeliefs: continuing.priorBeliefs,
      openLoops: continuing.openLoops.map(({ text }, index) => ({ loop: index + 1, text })),
    },
    output: hasLoops
      ? 'Return ONLY a JSON object (no markdown, no commentary) with exactly two keys: {"beliefs": [{ownerId, kind, text, sourceEventIds, toId?, label?, supersedesEventId?}], "resolutions": [{ownerId, loop, status, text, sourceEventIds}]}.'
      : 'Return ONLY a JSON object (no markdown, no commentary) with exactly one key: {"beliefs": [{ownerId, kind, text, sourceEventIds, toId?, label?, supersedesEventId?}]}. This person has no open loops, so there is no resolutions key.',
    outputSchema: hasLoops ? {
      beliefs: [{
        ownerId: owner.id,
        kind: 'belief',
        text: 'one durable private conclusion (toId and label MUST be omitted unless kind is exactly "relationship")',
        sourceEventIds: ['<exact id of a supplied event that supports this conclusion>'],
      }],
      resolutions: [{
        ownerId: owner.id,
        loop: '<1-based position of the openLoops entry this closes>',
        status: 'satisfied',
        text: 'how this loop ends',
        sourceEventIds: ['<exact id of a supplied event that supports this close-out>'],
      }],
    } : {
      beliefs: [{
        ownerId: owner.id,
        kind: 'belief',
        text: 'one durable private conclusion (toId and label MUST be omitted unless kind is exactly "relationship")',
        sourceEventIds: ['<exact id of a supplied event that supports this conclusion>'],
      }],
    },
    rules: [
      `Every ownerId must be exactly ${owner.id}. relationship entries need toId (another cast id, or the user) and a directional label.`,
      'kind must be belief, open-loop, or relationship — never episode or fact: you derive interpretations, not historical episodes or lore.',
      'Every belief and resolution must cite sourceEventIds: the exact ids of the supplied events that support it (at least one, copied verbatim).',
      ...(hasLoops ? [
        'Each resolution\'s loop is the 1-based position of the openLoops entry it closes; you may only close loops from that list.',
        'A resolution must cite a later supplied event whose resolvesLoops list contains that loop number. That structural link means the event replies to or corrects the loop (or its source), or is a validated occurrence causally sourced from it.',
        'Emit a resolution ONLY when the events show the listed loop genuinely ends; if it stays unresolved, omit it entirely — leaving a loop open is valid.',
      ] : []),
      'Optional fields are omitted when not applicable — never null, never invented status values.',
      `supersedesEventId is optional and only for beliefs: when a new belief replaces one of your priorBeliefs, cite that belief's id.`,
      'Derive only from the supplied events and your continuing context. Uncertain conclusions stay uncertain in the text. An empty output is valid when nothing durable can be concluded.',
      'Never assert new occurrences as events: there is no field for that — this output shape admits interpretation only.',
    ],
    events: view.map((event) => ({
      id: event.id,
      type: event.type,
      actor: event.actorId,
      text: eventText(event.payload),
      createdAt: event.createdAt,
      ...(hasLoops ? {
        resolvesLoops: continuing.openLoops.flatMap((loop, index) => (
          RESOLVING_EVIDENCE_TYPES.has(event.type)
          && event.provenance?.reflectionId === undefined
          && event.id !== loop.loopId
          && !loop.sourceEventIds.includes(event.id)
          && eventIsLaterThanLoop(event, loop)
          && eventIsLinkedToLoop(event, loop)
            ? [index + 1]
            : []
        )),
      } : {}),
    })),
  });
}

function repairPrompt(prompt: string): string {
  return JSON.stringify({
    ...(JSON.parse(prompt) as Record<string, unknown>),
    repair: 'The previous response was invalid. Return only one strict JSON object matching outputSchema. Copy every ownerId and sourceEventId exactly from this prompt. kind may only be belief, open-loop, or relationship. Use relationship only with both a valid toId and a non-empty directional label; otherwise use belief. Include resolutions only for listed openLoops, using the listed numeric loop and an event whose resolvesLoops includes it. Omit optional fields instead of null.',
  });
}

function eventText(payload: unknown): string | undefined {
  const text = isRecord(payload) ? payload.text : undefined;
  return typeof text === 'string' ? text : undefined;
}

function memoryDraft(context: ReflectionContext, reflectionId: string, belief: DreamerBelief, dependencyEventIds: string[]): JournalEventDraft {
  const payload: MemoryEventPayload = {
    ownerId: belief.ownerId,
    kind: belief.kind,
    text: belief.text,
    sourceEventIds: belief.sourceEventIds,
    ...(dependencyEventIds.length === 0 ? {} : { dependencyEventIds }),
    ...(belief.toId === undefined ? {} : { toId: belief.toId }),
    ...(belief.label === undefined ? {} : { label: belief.label }),
    ...(belief.supersedesEventId === undefined ? {} : { supersedesEventId: belief.supersedesEventId }),
  };
  return {
    roomId: context.roomId,
    scope: maintenanceScope(context),
    type: 'memory.belief',
    actorId: HARNESS_ACTOR,
    witnesses: [belief.ownerId],
    payload,
    provenance: { reflectionId },
  };
}

function resolutionDraft(context: ReflectionContext, reflectionId: string, resolution: DreamerResolution, dependencyEventIds: string[]): JournalEventDraft {
  // validateDerived filled loopId from the canonical open-loop list; a draft
  // without it would be a foreign resolution and must never exist.
  if (resolution.loopId === undefined) throw new Error('Resolution loop was not mapped to a canonical open loop');
  const payload: ResolutionPayload = {
    ownerId: resolution.ownerId,
    text: resolution.text,
    sourceEventIds: resolution.sourceEventIds,
    ...(dependencyEventIds.length === 0 ? {} : { dependencyEventIds }),
    loopId: resolution.loopId,
    status: resolution.status,
  };
  return {
    roomId: context.roomId,
    scope: maintenanceScope(context),
    type: 'resolution',
    actorId: HARNESS_ACTOR,
    witnesses: [resolution.ownerId],
    payload,
    provenance: { reflectionId },
  };
}

function maintenanceScope(context: ReflectionContext): JournalEventDraft['scope'] {
  return context.scopeKind === 'thread' ? { kind: 'thread', threadId: context.threadId! } : { kind: 'sea' };
}

/**
 * The cast whose private state this context may develop. Owners are AI cast
 * members only: the harness never derives the human user's beliefs autonomously
 * (their explicit remember-this path remains their memory route). The user may
 * still be a relationship *target* — perspective is directional.
 */
function castForContext(world: WorldState, context: ReflectionContext): ContextCast {
  if (context.scopeKind === 'thread') {
    const thread = world.threads.find(item => item.id === context.threadId && item.sandbox);
    const bindings = thread?.sandbox?.bindings ?? [];
    const owners = bindings.map(binding => binding.localOverride ?? binding.baseline).filter(person => person.id !== USER_ACTOR);
    return { owners, targets: [...owners.map(person => person.id), USER_ACTOR], names: owners.map(castMember) };
  }
  if (context.roomId === WORLD_CONTINUITY_ID) {
    const owners = world.participants.filter(person => person.kind === 'persistent');
    return { owners, targets: [...owners.map(person => person.id), USER_ACTOR], names: owners.map(castMember) };
  }
  const room = world.rooms.find(item => item.id === context.roomId);
  const owners = (room?.participantIds ?? [])
    .filter(id => id !== USER_ACTOR)
    .map(id => world.participants.find(person => person.id === id))
    .filter((person): person is Participant => person !== undefined);
  return { owners, targets: [...owners.map(person => person.id), USER_ACTOR], names: owners.map(castMember) };
}

/** Continuing-person persona: the cast Participant supplies displayName + personaText. */
function castMember(person: Participant): CastMember {
  return { id: person.id, name: person.displayName, personaText: person.personaText };
}

/** Per-owner canonical eligibility for one reflection attempt: what this owner
 *  may cite (witnessed window view), which open loops are theirs to resolve,
 *  and which prior derived beliefs they may supersede. Computed from the
 *  journal, never from the model's claims. */
interface OwnerEligibility {
  targets: Set<string>;
  citationIds: Set<string>;
  citationEvents: Map<string, JournalEvent>;
  /** The owner's currently-open loops, in prompt order (1-based). */
  openLoops: OpenLoopChoice[];
  priorBeliefIds: Set<string>;
}

interface OpenLoopChoice {
  loopId: string;
  text: string;
  roomId: string;
  scope: JournalEvent['scope'];
  seq: number;
  createdAt: number;
  sourceEventIds: string[];
}

const RESOLVING_EVIDENCE_TYPES: ReadonlySet<JournalEvent['type']> = new Set([
  'message.user', 'message.character', 'disclosure', 'membership', 'correction',
  'occurrence.simulated',
]);

function eventIsLaterThanLoop(event: JournalEvent, loop: OpenLoopChoice): boolean {
  const sameStream = event.roomId === loop.roomId && JSON.stringify(event.scope) === JSON.stringify(loop.scope);
  return sameStream ? event.seq > loop.seq : event.createdAt > loop.createdAt;
}

function eventIsLinkedToLoop(event: JournalEvent, loop: OpenLoopChoice): boolean {
  if (!isRecord(event.payload)) return false;
  const target = event.type === 'correction' ? event.payload.targetId : event.payload.replyToEventId;
  if (typeof target === 'string' && (target === loop.loopId || loop.sourceEventIds.includes(target))) return true;
  return event.type === 'occurrence.simulated'
    && Array.isArray(event.payload.sourceEventIds)
    && event.payload.sourceEventIds.some(id => id === loop.loopId || loop.sourceEventIds.includes(String(id)));
}

/** Model output must speak only as the reflecting owner, toward valid targets,
 *  cite only witnessed window events, resolve only the owner's open loops, and
 *  never exceed text bounds. Valid resolutions get their canonical loopId
 *  filled in from the owner's open-loop list (the model only supplies the
 *  1-based position). */
function validateDerived(output: DreamerOutput, ownerId: string, eligibility: OwnerEligibility): boolean {
  const cites = (ids: string[]) => ids.length > 0 && ids.every(id => eligibility.citationIds.has(id));
  return output.beliefs.every(belief =>
    belief.ownerId === ownerId
    && belief.text.length <= DERIVED_TEXT_LIMIT
    && (belief.toId === undefined || eligibility.targets.has(belief.toId))
    && cites(belief.sourceEventIds)
    && (belief.supersedesEventId === undefined || eligibility.priorBeliefIds.has(belief.supersedesEventId))
  ) && output.resolutions.every(resolution => {
    const loop = eligibility.openLoops[resolution.loopIndex - 1];
    if (!loop) return false;
    resolution.loopId = loop.loopId;
    const resolvingEvidence = resolution.sourceEventIds.some(id => {
      const event = eligibility.citationEvents.get(id);
      return event !== undefined
        && RESOLVING_EVIDENCE_TYPES.has(event.type)
        && event.provenance?.reflectionId === undefined
        && id !== loop.loopId
        && !loop.sourceEventIds.includes(id)
        && eventIsLaterThanLoop(event, loop)
        && eventIsLinkedToLoop(event, loop);
    });
    return resolution.ownerId === ownerId
      && resolution.text.length <= DERIVED_TEXT_LIMIT
      && cites(resolution.sourceEventIds)
      && resolvingEvidence;
  });
}

/**
 * The owner's entitled personal state: derived memory rows and resolutions
 * they own AND witnessed. Sea contexts read across Rooms — the context's own
 * stream plus every other Room's Sea stream and world continuity — so a
 * person's conclusions follow them between situations. Thread contexts stay
 * thread-local: sandbox isolation never gains cross-Room history. Other
 * people's private rows and unwitnessed events are never included; tombstoned
 * and superseded rows drop out via tombstonedIds over the union.
 */
async function personalHistory(ownerId: string, context: ReflectionContext): Promise<JournalEvent[]> {
  if (context.scopeKind === 'thread') {
    return personalHistoryFrom([await readContextStream(context)], ownerId);
  }
  const world = await loadWorld();
  const streams: JournalEvent[][] = [await readContextStream(context)];
  for (const room of world.rooms) {
    if (room.id !== context.roomId) streams.push(await readSeaProjection(room.id));
  }
  if (context.roomId !== WORLD_CONTINUITY_ID) streams.push(await readSeaProjection(WORLD_CONTINUITY_ID));
  return personalHistoryFrom(streams, ownerId);
}

function personalHistoryFrom(streams: JournalEvent[][], ownerId: string): JournalEvent[] {
  const union = new Map<string, JournalEvent>();
  for (const stream of streams) {
    for (const event of stream) {
      if (!union.has(event.id)) union.set(event.id, event);
    }
  }
  const events = [...union.values()];
  const dead = tombstonedIds(events);
  return events
    .filter((event) =>
      (event.type === 'memory.belief' || event.type === 'resolution')
      && event.witnesses.includes(ownerId)
      && isRecord(event.payload) && event.payload.ownerId === ownerId
      && !dead.has(event.id))
    .sort((left, right) => left.createdAt - right.createdAt || (left.id < right.id ? -1 : 1));
}

/** Prior derived belief rows: the owner's earlier interpretations, the only
 *  lawful supersedesEventId targets and the continuing-context belief list. */
function isDerivedBeliefRow(event: JournalEvent): boolean {
  return event.type === 'memory.belief'
    && event.provenance?.reflectionId !== undefined
    && isRecord(event.payload)
    && event.payload.kind === 'belief'
    && eventText(event.payload) !== undefined;
}

function priorDerivedBeliefSummaries(history: JournalEvent[]): { id: string; text: string; createdAt: number }[] {
  return history
    .filter(isDerivedBeliefRow)
    .slice(-PRIOR_BELIEF_PROMPT_CAP)
    .map((event) => ({ id: event.id, text: eventText(event.payload) ?? '', createdAt: event.createdAt }));
}

/** The owner's currently-open loops, oldest first (stream order). */
function openLoopChoices(history: JournalEvent[]): OpenLoopChoice[] {
  return [...openLoopStates(history).entries()]
    .filter(([, state]) => state.status === 'open')
    .flatMap(([loopId, state]) => {
      const event = history.find(candidate => candidate.id === loopId);
      return event ? [{
        loopId,
        text: state.loop.text,
        roomId: event.roomId,
        scope: event.scope,
        seq: event.seq,
        createdAt: event.createdAt,
        sourceEventIds: state.loop.sourceEventIds,
      }] : [];
    });
}

// ---------------------------------------------------------------------------
// Shared maintenance ledger primitives (used by reflection AND the Director's
// scenario-evolution pass; one durable record family in world.json).
// ---------------------------------------------------------------------------

export async function settleMaintenanceRunUnlocked(reflectionId: string, status: 'committed' | 'failed', error?: string): Promise<void> {
  const world = await loadWorld();
  const run = world.reflectionRuns?.find(item => item.reflectionId === reflectionId);
  if (!run || run.status !== 'pending') return; // terminal records are never relabeled
  const runs = (world.reflectionRuns ?? []).map(item => item.reflectionId === reflectionId
    ? { ...item, status, ...(error !== undefined ? { error } : { error: undefined }), settledAt: Date.now(), prepared: undefined }
    : item);
  await saveWorld({ ...world, reflectionRuns: runs });
}

export async function settleMaintenanceRun(reflectionId: string, status: 'committed' | 'failed', error?: string): Promise<void> {
  return withWorldMutation(() => settleMaintenanceRunUnlocked(reflectionId, status, error));
}

export function maintenanceSourceHash(events: JournalEvent[]): string {
  return createHash('sha256').update(JSON.stringify(events)).digest('hex');
}

/** Revalidate the exact source and current audience after inference/restart. */
export async function maintenanceSourcesValid(record: ReflectionRunRecord): Promise<boolean> {
  if (!livingWorldEnabled(loadSettings())) return false;
  const context: ReflectionContext = { roomId: record.contextId, scopeKind: record.scopeKind, threadId: record.threadId };
  for (const [ownerId, hash] of Object.entries(record.personalContextHashes ?? {})) {
    if (maintenanceSourceHash(await personalHistory(ownerId, context)) !== hash) return false;
  }
  const world = await loadWorld();
  if (!contextIsLive(world, context)) return false;
  const stream = await readContextStream(context);
  const invalid = tombstonedIds(stream);
  const sources = record.sourceEventIds.map(id => stream.find(event => event.id === id));
  if (sources.some(event => !event || invalid.has(event.id))) return false;
  if (record.sourceHash && maintenanceSourceHash(sources as JournalEvent[]) !== record.sourceHash) return false;
  if (record.castHash && maintenanceSourceHashValue(castForContext(world, context)) !== record.castHash) return false;
  return true;
}

function maintenanceSourceHashValue(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function readMaintenancePreparation(record: ReflectionRunRecord): Promise<JournalEvent[]> {
  return readPreparedMaintenanceEvents(record.contextId,
    record.scopeKind === 'sea' ? { kind: 'sea' } : { kind: 'thread', threadId: record.threadId! }, record.reflectionId);
}

export async function appendMaintenanceMarker(
  context: ReflectionContext,
  kind: 'reflection' | 'scenario',
  reflectionId: string,
  windowStart: number,
  windowEnd: number,
  produced: JournalEvent[],
): Promise<void> {
  const payload: ConsolidationPayload = { ...(kind === 'scenario' ? { kind } : {}), windowStart, windowEnd, producedEventIds: produced.map(event => event.id) };
  await appendEvent(context.roomId, {
    roomId: context.roomId,
    scope: maintenanceScope(context),
    type: 'consolidation',
    actorId: HARNESS_ACTOR,
    witnesses: [],
    payload,
    provenance: { reflectionId },
  });
}

/** Window markers of one maintenance kind for a context stream. */
export function maintenanceMarkers(stream: JournalEvent[], kind: 'reflection' | 'scenario'): ConsolidationPayload[] {
  return stream
    .filter(event => event.type === 'consolidation' && isConsolidationPayload(event.payload))
    .map(event => event.payload as ConsolidationPayload)
    .filter(payload => (payload.kind ?? 'reflection') === kind);
}

/** Eligible source events for a maintenance window: epistemic rows only,
 *  excluding tombstoned content and already-derived rows. */
export function maintenanceWindow(stream: JournalEvent[], lastWindowEnd: number): JournalEvent[] {
  const tombstoned = tombstonedIds(stream);
  return stream
    .filter(event => SOURCE_TYPES.has(event.type) && !tombstoned.has(event.id) && event.provenance?.reflectionId === undefined && event.seq > lastWindowEnd);
}

interface StagedRun {
  record: ReflectionRunRecord;
  cast: ContextCast;
}

/** Pending-record guard: a context never runs two windows of the same kind at
 *  once, and a committed run covering the same window replays instead of
 *  re-deriving. Returns 'busy' when a pending record exists for the context. */
export async function stageMaintenanceRun(
  context: ReflectionContext,
  kind: 'reflection' | 'scenario',
  window: JournalEvent[],
  retryOf?: string,
): Promise<'busy' | StagedRun> {
  const staged = await withWorldMutation(async (): Promise<'busy' | ReflectionRunRecord> => {
    const world = await loadWorld();
    const existing = (world.reflectionRuns ?? []).find(item =>
      item.kind === kind && item.contextId === context.roomId && item.scopeKind === context.scopeKind && item.threadId === context.threadId && item.status === 'pending');
    if (existing) return 'busy';
    const retry = retryOf === undefined ? undefined : (world.reflectionRuns ?? []).find(item =>
      item.reflectionId === retryOf && item.kind === kind && item.status === 'failed'
      && item.retryRequestedAt !== undefined && item.retryRequestedAt > (item.retryConsumedAt ?? 0));
    if (retryOf !== undefined && retry === undefined) return 'busy';
    const record: ReflectionRunRecord = {
      reflectionId: `refl_${randomUUID()}`,
      kind,
      contextId: context.roomId,
      scopeKind: context.scopeKind,
      ...(context.threadId !== undefined ? { threadId: context.threadId } : {}),
      windowStart: window[0].seq,
      windowEnd: window.at(-1)!.seq,
      sourceEventIds: window.map(event => event.id),
      sourceHash: maintenanceSourceHash(window),
      castHash: maintenanceSourceHashValue(castForContext(world, context)),
      status: 'pending',
      createdAt: Date.now(),
      ...(retryOf === undefined ? {} : { retryOf }),
    };
    const runs = (world.reflectionRuns ?? []).map(item => item.reflectionId === retryOf
      ? { ...item, retryConsumedAt: Date.now() }
      : item);
    await saveWorld({ ...world, reflectionRuns: [...runs, record] });
    return record;
  });
  if (staged === 'busy') return staged;
  return { record: staged, cast: castForContext(await loadWorld(), context) };
}

/** Deliberately reopen one terminal invalid-output window. Automatic triggers
 * keep honoring its seal until this durable request is consumed by a new run. */
export async function requestMaintenanceRetry(reflectionId: string): Promise<ReflectionRunRecord> {
  return withWorldMutation(async () => {
    requireLivingWorld(loadSettings());
    const world = await loadWorld();
    const target = world.reflectionRuns?.find(item => item.reflectionId === reflectionId);
    if (!target || target.status !== 'failed') throw new Error('Only a failed maintenance run can be retried');
    const updated = { ...target, retryRequestedAt: Date.now(), retryConsumedAt: undefined };
    await saveWorld({ ...world, reflectionRuns: world.reflectionRuns?.map(item => item.reflectionId === reflectionId ? updated : item) });
    return updated;
  });
}

export function requestedMaintenanceRetry(
  world: WorldState,
  context: ReflectionContext,
  kind: 'reflection' | 'scenario',
): ReflectionRunRecord | undefined {
  return (world.reflectionRuns ?? []).filter(item =>
    item.kind === kind && item.contextId === context.roomId && item.scopeKind === context.scopeKind
    && item.threadId === context.threadId && item.status === 'failed'
    && item.retryRequestedAt !== undefined && item.retryRequestedAt > (item.retryConsumedAt ?? 0))
    .at(-1);
}

export function maintenanceRetryWindow(record: ReflectionRunRecord, stream: JournalEvent[]): JournalEvent[] | null {
  const byId = new Map(stream.map(event => [event.id, event]));
  const events = record.sourceEventIds.map(id => byId.get(id));
  if (events.some(event => event === undefined)) return null;
  const invalid = tombstonedIds(stream);
  return (events as JournalEvent[]).every(event => !invalid.has(event.id)) ? events as JournalEvent[] : null;
}

/** Validated drafts/outputs are persisted before any journal append, so an
 *  interrupted publication resumes all-or-nothing from durable content. */
export async function prepareMaintenanceRun(record: ReflectionRunRecord, prepared: NonNullable<ReflectionRunRecord['prepared']>): Promise<void> {
  return withWorldMutation(async () => {
  if (!(await maintenanceSourcesValid(record))) throw new MaintenanceConflictError('Maintenance sources or cast changed');
  const world = await loadWorld();
  if (!world.reflectionRuns?.some(item => item.reflectionId === record.reflectionId && item.status === 'pending')) throw new MaintenanceConflictError('Maintenance was cancelled');
  const runs = (world.reflectionRuns ?? []).map(item => item.reflectionId === record.reflectionId
    ? { ...item, personalContextHashes: record.personalContextHashes, projectionAt: record.projectionAt, prepared }
    : item);
  await saveWorld({ ...world, reflectionRuns: runs });
  });
}

/** Rows already in the journal for this operation must match the prepared
 *  content exactly (idempotent resume; foreign rows fail closed). */
export function maintenanceDraftMatchesRow(draft: JournalEventDraft, event: JournalEvent): boolean {
  return event.roomId === draft.roomId
    && event.type === draft.type
    && event.actorId === draft.actorId
    && JSON.stringify(event.scope) === JSON.stringify(draft.scope)
    && JSON.stringify(event.witnesses) === JSON.stringify(draft.witnesses)
    && JSON.stringify(event.payload) === JSON.stringify(draft.payload)
    && event.provenance?.reflectionId === draft.provenance?.reflectionId;
}

/** How many failed attempts this (kind, context, window) already recorded. */
export async function maintenanceFailureCount(record: ReflectionRunRecord): Promise<number> {
  const world = await loadWorld();
  return (world.reflectionRuns ?? []).filter(item =>
    item.kind === record.kind && item.contextId === record.contextId
    && item.windowEnd === record.windowEnd && item.status === 'failed').length;
}

const activePasses = new Map<string, Promise<unknown>>();
/** Direct callers and runtime triggers share the same active operation. */
export function withMaintenancePass<T>(context: ReflectionContext, kind: string, work: () => Promise<T>): Promise<T> {
  const key = JSON.stringify([getUserDataPath(), context, kind]);
  const running = activePasses.get(key);
  if (running) return running as Promise<T>;
  const result = work().finally(() => activePasses.delete(key));
  activePasses.set(key, result);
  return result;
}

/**
 * Per-person reflection for one journal context. Idempotent per window via the
 * marker; interrupted runs recover from the ledger and provenance.
 */
export function runReflection(context: ReflectionContext, deps: DreamerDependencies): Promise<boolean> {
  return withMaintenancePass(context, 'reflection', () => runReflectionPass(context, deps));
}

async function runReflectionPass(context: ReflectionContext, deps: DreamerDependencies): Promise<boolean> {
  if (!livingWorldEnabled(loadSettings()) || !deps.policy.isPermitted('dreamer')) return false;
  if (deps.signal?.aborted) throw new Error('Reflection cancelled');

  // Finish a previous interrupted run for this context before opening a new window.
  const world0 = await loadWorld();
  const pending = (world0.reflectionRuns ?? []).find(item =>
    item.kind === 'reflection' && item.contextId === context.roomId && item.scopeKind === context.scopeKind && item.threadId === context.threadId && item.status === 'pending');
  if (pending && !(await completePendingReflection(pending))) return false;

  // Full stream: absence intervals and tombstones must see the whole history,
  // never just the bounded window being consolidated.
  const stream = await readContextStream(context);
  const retry = requestedMaintenanceRetry(world0, context, 'reflection');
  const lastWindowEnd = maintenanceMarkers(stream, 'reflection').reduce((latest, marker) => Math.max(latest, marker.windowEnd), Number.NEGATIVE_INFINITY);
  const window = retry ? maintenanceRetryWindow(retry, stream) : maintenanceWindow(stream, lastWindowEnd).slice(0, REFLECTION_WINDOW_EVENTS);
  if (window === null) return false;
  if (window.length === 0) return false;
  const windowEnd = window.at(-1)!.seq;
  if (!retry && maintenanceMarkers(stream, 'reflection').some((marker) => marker.windowEnd >= windowEnd)) return false;

  const staged = await stageMaintenanceRun(context, 'reflection', window, retry?.reflectionId);
  if (staged === 'busy') return false;
  const { record, cast } = staged;
  const targets = new Set(cast.targets);
  const windowIds = new Set(window.map(event => event.id));
  // Owner views derive absence intervals from the FULL stream, then intersect
  // the bounded window: a participant removed before the window never sees it.
  const ownerViews = new Map(cast.owners.map(owner => {
    const view = visibleEventsFor(owner.id, stream, owner.capabilities).filter(event => windowIds.has(event.id));
    return [owner.id, view] as const;
  }));

  let publicationPrepared = false;
  try {
    // Per-owner bounded retries: each owner gets up to the named bound of
    // invalid-output attempts; one owner's failure never consumes another
    // owner's budget. Publication itself stays all-or-nothing — if ANY owner
    // exhausts its budget, the window closes honestly with no derived rows
    // (no inference burn loop, no partial social state).
    const attemptsLeft = MAX_MAINTENANCE_ATTEMPTS;
    const drafts: JournalEventDraft[] = [];
    let exhausted: string | null = null;
    for (const owner of cast.owners) {
      const view = ownerViews.get(owner.id)!;
      if (view.length === 0) continue;
      // Canonical per-owner eligibility — citation authority, open loops,
      // and prior derived beliefs — comes from the owner's entitled
      // personal history and bounded view, never from the model's claims.
      const history = await personalHistory(owner.id, context);
      const openLoops = openLoopChoices(history).slice(-OPEN_LOOP_PROMPT_CAP);
      const priorBeliefs = priorDerivedBeliefSummaries(history);
      const dependencyEventIds = [...new Set([
        ...priorBeliefs.map(belief => belief.id),
        ...openLoops.map(loop => loop.loopId),
      ])];
      (record.personalContextHashes ??= {})[owner.id] = maintenanceSourceHash(history);
      const eligibility: OwnerEligibility = {
        targets,
        citationIds: new Set(view.map(event => event.id)),
        citationEvents: new Map(view.map(event => [event.id, event])),
        openLoops,
        priorBeliefIds: new Set(history.filter(isDerivedBeliefRow).map(event => event.id)),
      };
      const prompt = makePrompt(
        { id: owner.id, name: owner.displayName, personaText: owner.personaText },
        view,
        cast.names,
        { priorBeliefs, openLoops },
      );
      let ownerDrafts: JournalEventDraft[] | null = null;
      for (let attempt = 0; attempt < attemptsLeft && ownerDrafts === null; attempt++) {
        if (deps.signal?.aborted) throw new Error('Reflection cancelled');
        requireLivingWorld(loadSettings());
        const request = attempt === 0 ? prompt : repairPrompt(prompt);
        const output = parseDreamerOutput(await deps.llmFn(request));
        if (output !== null && validateDerived(output, owner.id, eligibility)) {
          ownerDrafts = [
            ...output.beliefs.map((belief) => memoryDraft(
              context,
              record.reflectionId,
              belief,
              dependencyEventIds.filter(id => id !== belief.supersedesEventId),
            )),
            ...output.resolutions.map((resolution) => resolutionDraft(context, record.reflectionId, resolution, dependencyEventIds)),
          ];
        }
      }
      if (ownerDrafts === null) { exhausted = owner.id; break; }
      drafts.push(...ownerDrafts);
    }
    if (exhausted !== null) {
      // The attempt budget is exhausted for an owner: close the window honestly.
      await appendMaintenanceMarker(context, 'reflection', record.reflectionId, record.windowStart, record.windowEnd, []);
      await settleMaintenanceRun(record.reflectionId, 'failed', `No valid reflection output after ${MAX_MAINTENANCE_ATTEMPTS} attempts for ${exhausted}; window closed.`);
      return true;
    }
    if (deps.signal?.aborted) throw new Error('Reflection cancelled');
    record.projectionAt = deps.now ?? Date.now();
    await prepareMaintenanceRun(record, { kind: 'reflection', expectedDrafts: drafts });
    publicationPrepared = true;
    await completePendingReflection({ ...record, prepared: { kind: 'reflection', expectedDrafts: drafts } });
    return true;
  } catch (error) {
    if (!publicationPrepared) {
      await settleMaintenanceRun(record.reflectionId, 'failed', error instanceof Error ? error.message : 'Reflection failed');
    }
    // Once prepared, the record stays pending: startup recovery resumes the
    // publication all-or-nothing instead of re-deriving (duplicating) rows.
    throw error;
  }
}

/** Settle every pending reflection record: resume a prepared publication
 *  (all-or-nothing), otherwise fail closed and let the window re-run. */
export async function reconcilePendingReflections(): Promise<void> {
  if (!livingWorldEnabled(loadSettings())) return;
  const world = await loadWorld();
  for (const record of (world.reflectionRuns ?? []).filter(item => item.kind === 'reflection' && item.status === 'pending')) {
    try {
      await completePendingReflection(record);
    } catch (error) {
      if (error instanceof MaintenanceConflictError) {
        await settleMaintenanceRun(record.reflectionId, 'failed', error.message).catch(() => undefined);
        continue;
      }
      // Transient I/O keeps the record pending; the recovery driver logs it.
      throw error;
    }
  }
}

/** A journal context is live while its Room/Thread entity record exists;
 *  deleted contexts settle failed instead of recreating erased journals. */
function contextIsLive(world: WorldState, context: ReflectionContext): boolean {
  if (context.scopeKind === 'thread') return world.threads.some(item => item.id === context.threadId);
  return context.roomId === WORLD_CONTINUITY_ID || world.rooms.some(room => room.id === context.roomId);
}

/**
 * Finish an interrupted reflection from its durable record. An existing marker
 * for this operation is verified (never duplicated); a prepared publication
 * resumes exactly to the expected drafts before the marker seals the window.
 */
async function completePendingReflection(record: ReflectionRunRecord): Promise<boolean> {
  return withWorldMutation(async () => {
    if (!livingWorldEnabled(loadSettings())) return false;
    const current = (await loadWorld()).reflectionRuns?.find(item => item.reflectionId === record.reflectionId);
    if (!current || current.status !== 'pending') return current?.status === 'committed';
    const context: ReflectionContext = { roomId: record.contextId, scopeKind: record.scopeKind, threadId: record.threadId };
    if (!(await maintenanceSourcesValid(current))) {
      await settleMaintenanceRunUnlocked(record.reflectionId, 'failed', 'Maintenance sources or cast changed; nothing was published.');
      return false;
    }
    const prepared = current.prepared;
    if (prepared?.kind !== 'reflection') {
      await settleMaintenanceRunUnlocked(record.reflectionId, 'failed', 'Reflection was interrupted before validated output; the window will re-run.');
      return false;
    }
    const events = await readMaintenancePreparation(record);
    const markers = events.filter(event => event.type === 'consolidation');
    const derived = events.filter(event => event.type !== 'consolidation');
    if (derived.length > prepared.expectedDrafts.length
      || derived.some((event, index) => !maintenanceDraftMatchesRow(prepared.expectedDrafts[index], event))) {
      throw new MaintenanceConflictError('prepared journal content is inconsistent');
    }
    const produced = [...derived];
    for (const draft of prepared.expectedDrafts.slice(derived.length)) produced.push(await appendEvent(context.roomId, draft));
    if (markers.length) {
      const payload = markers[0].payload;
      if (markers.length !== 1 || !isConsolidationPayload(payload)
        || payload.windowStart !== record.windowStart || payload.windowEnd !== record.windowEnd
        || JSON.stringify(payload.producedEventIds) !== JSON.stringify(produced.map(event => event.id))) {
        throw new MaintenanceConflictError('prepared journal marker is inconsistent');
      }
    } else {
      await appendMaintenanceMarker(context, 'reflection', record.reflectionId, record.windowStart, record.windowEnd, produced);
    }
    // Source retraction may have arrived through the journal queue during writes.
    if (!(await maintenanceSourcesValid(current))) {
      await settleMaintenanceRunUnlocked(record.reflectionId, 'failed', 'Maintenance sources or cast changed; nothing was published.');
      return false;
    }
    const stream = await readContextStream(context);
    const touched = new Set(
      [...stream.filter(event => current.sourceEventIds.includes(event.id)), ...produced]
        .filter(event => event.type === 'memory.belief' || event.type === 'resolution')
        .map(event => event.id)
    );
    await applyMaintenanceProjection(context.roomId, current.reflectionId, touched, current.projectionAt ?? current.createdAt);
    await settleMaintenanceRunUnlocked(record.reflectionId, 'committed');
    return true;
  });
}

// ---------------------------------------------------------------------------
// Legacy entry point: Sea-only reflection (kept for the integration trigger).
// ---------------------------------------------------------------------------

/** Sea-room consolidation. Sandbox contexts must use runReflection explicitly. */
export async function runDreamer(roomId: string, deps: DreamerDependencies): Promise<void> {
  await runReflection({ roomId, scopeKind: 'sea' }, deps);
}
