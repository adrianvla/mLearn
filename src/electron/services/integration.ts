/**
 * Selective integration — destination-aware admission of saved-sandbox
 * consequences into the persistent world (Sea).
 *
 * Model:
 * - The caller only names a selection (source memory-event ids, sandbox-only
 *   people to adopt, scenario adoption) and a destination persistent Room.
 *   Admitted content is derived main-side from the canonical thread journal,
 *   so witnesses, owners and payloads cannot be fabricated by callers.
 * - W1 stores a private durable preparation; W2/W3/marker journal rows are
 *   hidden by every canonical Sea reader. A final atomic world.json save
 *   publishes topology and committed status together (the logical commit).
 *   Recovery replays the prepared content, independently of source lifetime.
 *
 * Queue contract: every exported entry point acquires the world mutation queue
 * exactly once for its whole operation; callers must not wrap them again.
 */

import { createHash } from 'crypto';
import { isDeepStrictEqual } from 'util';
import { applyMembershipChange } from '../../shared/roomOrchestrator';
import { tombstonedIds } from '../../shared/memoryProjection';
import { HARNESS_ACTOR, USER_ACTOR, WORLD_CONTINUITY_ID, threadContextId } from '../../shared/world';
import { requireLivingWorld, livingWorldEnabled } from '../../shared/livingWorld';
import type {
  IntegrationPayload,
  IntegrationPreview,
  IntegrationPreviewItem,
  IntegrationPreviewPerson,
  IntegrationRecord,
  IntegrateThreadInput,
  JournalEvent,
  JournalEventDraft,
  MemoryEventPayload,
  Participant,
  Room,
  ScenarioSpec,
  Thread,
} from '../../shared/world';
import type { WorldState } from './worldStore';
import { loadWorld, saveWorld, withWorldMutation } from './worldStore';
import { appendEvent, readSeaProjection, readPreparedIntegrationEvents, readThread } from './journalService';
import { loadSettings } from './settings';

/** Reserved actor ids are never roster entries or adoption targets. */
const RESERVED_ACTORS: Record<string, boolean> = { [USER_ACTOR]: true, [HARNESS_ACTOR]: true };

export interface IntegrationSelection {
  integrationId: string;
  threadId: string;
  destinationRoomId: string;
  memoryEventIds: string[];
  adoptParticipantIds: string[];
  includeScenario: boolean;
  selectionHash: string;
}

export interface DerivedIntegration {
  selection: IntegrationSelection;
  /** Destination-Sea drafts in deterministic source-journal order. */
  admissions: JournalEventDraft[];
  /** Participant upserts (stable ids) making sandbox-only people persistent. */
  adoptedParticipants: Participant[];
  /** Destination roster additions (membership events for exactly these). */
  rosterAdditions: string[];
  /** Sandbox-bound people the admitted material talks about. */
  referencedPersonIds: string[];
  scenarioAdopted: ScenarioSpec | null;
}

export interface IntegrationCatalog {
  items: IntegrationPreviewItem[];
  people: IntegrationPreviewPerson[];
  scenarioAvailable: boolean;
}

export type Derivation =
  | { ok: true; derived: DerivedIntegration; requiredAdoptions: string[] }
  | { ok: false; problems: string[]; requiredAdoptions: string[] };

function isMemoryPayload(value: unknown): value is MemoryEventPayload {
  if (typeof value !== 'object' || value === null) return false;
  const rec = value as Record<string, unknown>;
  return typeof rec.ownerId === 'string'
    && ['belief', 'episode', 'open-loop', 'relationship', 'fact'].includes(String(rec.kind))
    && typeof rec.text === 'string';
}

function validateInput(input: IntegrateThreadInput): void {
  if (typeof input.integrationId !== 'string' || !input.integrationId.trim()
      || typeof input.threadId !== 'string' || !input.threadId
      || typeof input.destinationRoomId !== 'string' || !input.destinationRoomId
      || typeof input.includeScenario !== 'boolean'
      || ![input.memoryEventIds, input.adoptParticipantIds].every(ids => Array.isArray(ids) && ids.every(id => typeof id === 'string' && id.length > 0))) {
    throw new Error('[world] invalid integration selection');
  }
}

function normalizeIds(value: unknown): string[] {
  const ids = Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];
  return [...new Set(ids)].sort();
}

export function selectionHash(input: {
  threadId: string;
  destinationRoomId: string;
  memoryEventIds: string[];
  adoptParticipantIds: string[];
  includeScenario: boolean;
}): string {
  return createHash('sha256').update(JSON.stringify([
    input.threadId,
    input.destinationRoomId,
    normalizeIds(input.memoryEventIds),
    normalizeIds(input.adoptParticipantIds),
    input.includeScenario,
  ])).digest('hex');
}

/** Thread journal events this sandbox still contributes as durable consequences. */
function sourceMemories(threadEvents: JournalEvent[], thread: Thread): JournalEvent[] {
  const contextId = threadContextId(thread);
  const retracted = tombstonedIds(threadEvents);
  return threadEvents.filter(event =>
    !retracted.has(event.id) &&
    event.scope.kind === 'thread'
    && event.scope.threadId === thread.id
    && event.roomId === contextId
    && event.type === 'memory.belief'
    && isMemoryPayload(event.payload));
}

/** Source events already carried into the Sea, by any operation or manual admit. */
function alreadyAdmittedBy(seaEvents: JournalEvent[], records: IntegrationRecord[], threadId: string, destinationId: string, sources: JournalEvent[]): Map<string, string> {
  const claimed = new Map<string, string>();
  for (const event of seaEvents) {
    if (event.type !== 'memory.belief') continue;
    for (const sourceId of event.provenance?.sourceThreadEventIds ?? []) {
      const source = sources.find(item => item.id === sourceId);
      if (source && isDeepStrictEqual(source.payload, event.payload) && isDeepStrictEqual(source.witnesses, event.witnesses) && !claimed.has(sourceId)) claimed.set(sourceId, event.provenance?.integrationId ?? 'manual');
    }
  }
  for (const record of records) {
    if (record.sourceThreadId !== threadId || record.status !== 'committed' || record.destinationRoomId !== destinationId) continue;
    for (const sourceId of record.memoryEventIds) {
      if (!claimed.has(sourceId)) claimed.set(sourceId, record.integrationId);
    }
  }
  return claimed;
}

/** Journal routing context only; never inserted into world.rooms. */
function destinationContext(world: WorldState, id: string): Room | undefined {
  return id === WORLD_CONTINUITY_ID
    ? { id, title: 'My world', participantIds: [], createdAt: 0 }
    : world.rooms.find(room => room.id === id);
}

function personName(world: WorldState, id: string): string {
  return world.participants.find(person => person.id === id)?.displayName ?? id;
}
function baselineHash(person: Participant): string {
  const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical)
    : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => [k, canonical(v)])) : value;
  return createHash('sha256').update(JSON.stringify(canonical(person))).digest('hex');
}

/** Identity uses the immutable source link; only the pinned source is checked
 * for tampering. Current lived persona content is never an identity key. */
function promotedSandboxIds(world: WorldState, threadId: string, bindings: NonNullable<Thread['sandbox']>['bindings']): Set<string> {
  const promoted = new Set<string>();
  for (const binding of bindings) {
    if (binding.originId) continue;
    const id = binding.baseline.id;
    const existing = world.participants.find(person => person.id === id);
    if (!existing || existing.kind !== 'persistent') continue;
    if (existing.adoption?.sourceThreadId !== threadId || existing.adoption.baselineHash !== baselineHash(binding.baseline)) continue;
    promoted.add(id);
  }
  return promoted;
}

/** Reviewable catalog: every selectable consequence and person of a sandbox. */
export function buildCatalog(
  world: WorldState,
  thread: Thread,
  destinationRoom: Room,
  threadEvents: JournalEvent[],
  seaEvents: JournalEvent[],
): IntegrationCatalog {
  const claimed = alreadyAdmittedBy(seaEvents, world.integrations ?? [], thread.id, destinationRoom.id, threadEvents);
  const bindings = thread.sandbox?.bindings ?? [];
  const promotedIds = promotedSandboxIds(world, thread.id, bindings);
  const items: IntegrationPreviewItem[] = sourceMemories(threadEvents, thread).map(event => {
    const payload = event.payload as MemoryEventPayload;
    const integratedBy = claimed.get(event.id);
    return {
      sourceEventId: event.id,
      ownerId: payload.ownerId,
      kind: payload.kind,
      text: payload.text,
      witnesses: [...event.witnesses],
      ...(typeof payload.toId === 'string' && payload.toId ? { toId: payload.toId } : {}),
      ...(typeof payload.label === 'string' && payload.label ? { label: payload.label } : {}),
      ...(integratedBy ? { integratedBy } : {}),
    };
  });
  const people: IntegrationPreviewPerson[] = bindings.map(binding => {
    const baseline = binding.baseline;
    const originId = binding.originId;
    if (originId) {
      const current = world.participants.find(person => person.id === originId);
      return {
        id: baseline.id,
        displayName: baseline.displayName,
        originId,
        action: 'reference' as const,
        required: false,
        ...(current && !isDeepStrictEqual(current, baseline) ? { baselineDrift: true } : {}),
        ...(!current ? { missing: true } : {}),
      };
    }
    if (promotedIds.has(baseline.id)) {
      return { id: baseline.id, displayName: baseline.displayName, action: 'reference' as const, required: false };
    }
    return { id: baseline.id, displayName: baseline.displayName, action: 'adopt' as const, required: false };
  });
  const scenarioAvailable = Boolean(thread.scenario) && destinationRoom.id !== WORLD_CONTINUITY_ID && !destinationRoom.scenario;
  return { items, people, scenarioAvailable };
}

/**
 * Derive (and fully validate) one selection against canonical state. Every
 * blocking problem is reported before any physical write happens.
 */
export function deriveIntegration(
  world: WorldState,
  thread: Thread,
  destinationRoom: Room,
  threadEvents: JournalEvent[],
  seaEvents: JournalEvent[],
  input: IntegrateThreadInput,
): Derivation {
  const problems: string[] = [];
  if (!input.integrationId?.trim()) problems.push('integration requires an operation ID');
  if (!thread.sandbox) problems.push('integration source must be a disposable sandbox Thread');
  const memoryEventIds = normalizeIds(input.memoryEventIds);
  const adoptParticipantIds = normalizeIds(input.adoptParticipantIds);
  const selection: IntegrationSelection = {
    integrationId: input.integrationId?.trim() ?? '',
    threadId: input.threadId,
    destinationRoomId: input.destinationRoomId,
    memoryEventIds,
    adoptParticipantIds,
    includeScenario: Boolean(input.includeScenario),
    selectionHash: selectionHash({
      threadId: input.threadId,
      destinationRoomId: input.destinationRoomId,
      memoryEventIds,
      adoptParticipantIds,
      includeScenario: input.includeScenario,
    }),
  };

  const catalog = buildCatalog(world, thread, destinationRoom, threadEvents, seaEvents);
  const itemById = new Map(catalog.items.map(item => [item.sourceEventId, item]));
  const selected = selection.memoryEventIds.map(id => itemById.get(id));
  selection.memoryEventIds.forEach((id, index) => {
    if (!selected[index]) problems.push(`selected source event is not part of this thread: ${id}`);
  });
  for (const item of catalog.items) {
    // The operation's own earlier writes are its replay, not a duplicate.
    if (item.integratedBy && item.integratedBy !== selection.integrationId
        && selection.memoryEventIds.includes(item.sourceEventId)) {
      problems.push(`source event was already admitted (${item.integratedBy}): ${item.sourceEventId}`);
    }
  }
  if (!selection.memoryEventIds.length && !selection.adoptParticipantIds.length && !selection.includeScenario) {
    problems.push('integration requires at least one selected consequence');
  }
  if ((world.integrations ?? []).some(record => record.status === 'pending'
      && record.integrationId !== selection.integrationId && record.sourceThreadId === thread.id
      && record.destinationRoomId === destinationRoom.id
      && record.memoryEventIds.some(id => selection.memoryEventIds.includes(id)))) {
    problems.push('selected consequence belongs to a pending integration; retry that operation first');
  }
  const bindings = thread.sandbox?.bindings ?? [];
  const bindingIds = new Set(bindings.map(binding => binding.baseline.id));
  const promotedIds = promotedSandboxIds(world, thread.id, bindings);

  for (const binding of bindings) {
    if (binding.originId && binding.originId !== binding.baseline.id) problems.push('sandbox origin identity mismatch');
  }
  // People closure: everyone the admitted consequences talk about.
  const referenced = new Set<string>();
  for (const item of selected) {
    if (!item) continue;
    for (const witness of item.witnesses) {
      if (!RESERVED_ACTORS[witness]) referenced.add(witness);
    }
    const source = threadEvents.find(event => event.id === item.sourceEventId)!;
    if (!RESERVED_ACTORS[source.actorId]) referenced.add(source.actorId);
    if (!RESERVED_ACTORS[item.ownerId]) referenced.add(item.ownerId);
    if (item.toId && !RESERVED_ACTORS[item.toId]) referenced.add(item.toId);
  }
  for (const id of referenced) {
    if (!bindingIds.has(id)) {
      problems.push(`selected consequence references a person outside this sandbox: ${personName(world, id)}`);
    }
  }

  const scenarioAdopted = selection.includeScenario ? thread.scenario ?? null : null;
  if (selection.includeScenario && destinationRoom.id === WORLD_CONTINUITY_ID) problems.push('situation adoption requires a destination Room');
  if (selection.includeScenario && !thread.scenario) problems.push('this Thread has no situation to bring into the Room');
  if (selection.includeScenario && destinationRoom.scenario) {
    // This operation's own earlier entity save is a resumable prefix, not a
    // conflict; any other scenario at the destination is.
    const ownScenarioWritten = destinationRoom.scenarioRef === selection.integrationId
      && isDeepStrictEqual(destinationRoom.scenario, thread.scenario);
    if (!ownScenarioWritten) problems.push('the destination Room already has its own situation');
  }
  const scenarioPersonIds = new Set<string>();
  if (scenarioAdopted) {
    for (const participant of scenarioAdopted.participants) {
      if (participant.kind === 'existing') {
        scenarioPersonIds.add(participant.participantId);
        if (!world.participants.some(person => person.id === participant.participantId && person.kind === 'persistent')) {
          problems.push(`the situation references a missing persistent person: ${participant.participantId}`);
        }
      } else {
        scenarioPersonIds.add(participant.localId);
        if (!bindingIds.has(participant.localId)) {
          problems.push(`the situation references a person outside this sandbox: ${participant.localId}`);
        }
      }
    }
    for (const relation of scenarioAdopted.relationships) {
      for (const endpoint of [relation.fromId, relation.toId]) {
        if (!RESERVED_ACTORS[endpoint]) referenced.add(endpoint);
        if (!RESERVED_ACTORS[endpoint] && !scenarioPersonIds.has(endpoint) && !bindingIds.has(endpoint)) {
          problems.push(`the situation references a person outside this sandbox: ${endpoint}`);
        }
      }
    }
  }

  // Adoption requirements: sandbox-only people the selection cannot exist
  // without. Already-promoted people resolve as references instead, so a
  // later operation on the same thread never re-adopts (or blocks on) them.
  // The commit input must contain every requirement (no silent expansion).
  const temporaryReferenced = [...referenced].filter(id => {
    if (promotedIds.has(id)) return false;
    const binding = bindings.find(candidate => candidate.baseline.id === id);
    return Boolean(binding && !binding.originId);
  });
  const requiredAdoptions = [...new Set([
    ...temporaryReferenced,
    ...(scenarioAdopted
      ? scenarioAdopted.participants
          .filter(participant => participant.kind === 'temporary')
          .map(participant => participant.localId)
          .filter(id => !promotedIds.has(id))
      : []),
  ])].sort();
  for (const id of requiredAdoptions) {
    if (!selection.adoptParticipantIds.includes(id)) {
      problems.push(`selection requires adopting sandbox person: ${personName(world, id)}`);
    }
  }
  for (const id of selection.adoptParticipantIds) {
    const binding = bindings.find(candidate => candidate.baseline.id === id);
    if (!binding) {
      problems.push(`adoption target is not part of this sandbox: ${personName(world, id)}`);
      continue;
    }
    if (binding.originId) {
      problems.push(`a persistent person cannot be adopted: ${personName(world, id)}`);
      continue;
    }
    if (promotedIds.has(id)) continue; // already our persistent person; re-listing is a no-op
    if (world.participants.some(person => person.id === id)) {
      problems.push(`participant id already exists in the persistent world: ${personName(world, id)}`);
    }
  }
  for (const person of catalog.people) {
    if (person.missing && (referenced.has(person.id) || scenarioPersonIds.has(person.id))) {
      problems.push(`selected consequence references a deleted person: ${person.displayName}`);
    }
  }

  if (problems.length) return { ok: false, problems, requiredAdoptions };

  const admissions: JournalEventDraft[] = selected
    .filter((item): item is IntegrationPreviewItem => Boolean(item))
    .map(item => {
      const source = threadEvents.find(event => event.id === item.sourceEventId)!;
      return {
        roomId: destinationRoom.id,
        scope: { kind: 'sea' },
        type: source.type,
        actorId: source.actorId,
        witnesses: [...source.witnesses],
        payload: structuredClone(source.payload),
        provenance: { integrationId: selection.integrationId, sourceThreadEventIds: [source.id] },
      };
    });

  const adoptedParticipants: Participant[] = selection.adoptParticipantIds.filter(id => !promotedIds.has(id)).map(id => {
    const binding = bindings.find(candidate => candidate.baseline.id === id)!;
    return { ...structuredClone(binding.baseline), kind: 'persistent' as const, adoption: { sourceThreadId: thread.id, baselineHash: baselineHash(binding.baseline) } };
  });

  // Only explicitly adopting the situation brings its cast into this Room.
  // Historical witnesshood and standalone person adoption are not membership.
  const referencedPersonIds = [...referenced].sort();
  const rosterAdditions = [...scenarioPersonIds]
    .filter(id => !RESERVED_ACTORS[id] && !destinationRoom.participantIds.includes(id))
    .sort();

  return {
    ok: true,
    requiredAdoptions,
    derived: {
      selection,
      admissions,
      adoptedParticipants,
      rosterAdditions,
      referencedPersonIds,
      scenarioAdopted,
    },
  };
}

function admissionMatches(event: JournalEvent, draft: JournalEventDraft): boolean {
  return event.roomId === draft.roomId
    && isDeepStrictEqual(event.scope, draft.scope)
    && event.type === draft.type
    && event.actorId === draft.actorId
    && isDeepStrictEqual(event.witnesses, draft.witnesses)
    && isDeepStrictEqual(event.payload, draft.payload)
    && event.provenance?.integrationId === draft.provenance?.integrationId
    && isDeepStrictEqual(event.provenance?.sourceThreadEventIds ?? [], draft.provenance?.sourceThreadEventIds ?? []);
}

export interface PublishResult {
  appended: JournalEvent[];
  alreadyApplied: boolean;
}

async function settleRecord(integrationId: string, status: 'committed' | 'interrupted', note?: string): Promise<void> {
  const world = await loadWorld();
  const existing = world.integrations?.find(item => item.integrationId === integrationId);
  if (!existing || (existing.status === status && !note)) return;
  const integrations = (world.integrations ?? []).map(item => item.integrationId === integrationId
    ? { ...item, status, note: note ?? undefined, settledAt: Date.now() }
    : item);
  await saveWorld({ ...world, integrations });
}

/** Finish a private, durable preparation. No source Thread is needed. */
async function finishPrepared(world: WorldState, record: IntegrationRecord): Promise<PublishResult> {
  requireLivingWorld(loadSettings());
  const plan = record.prepared!;
  if (!plan || !Array.isArray(plan.participants) || !Array.isArray(plan.events)
      || !plan.roomBefore || !plan.roomAfter || plan.roomAfter.id !== record.destinationRoomId
      || plan.events.at(-1)?.type !== 'integration'
      || (plan.events.at(-1)?.payload as IntegrationPayload)?.selectionHash !== record.selectionHash
      || plan.events.some(event => !event || event.roomId !== record.destinationRoomId || event.scope?.kind !== 'sea' || !Array.isArray(event.witnesses))) {
    await settleRecord(record.integrationId, 'interrupted', 'Prepared operation is corrupt. No prepared effects were published.');
    throw new Error('[world] integration preparation is corrupt');
  }
  const room = destinationContext(world, record.destinationRoomId);
  if (!isDeepStrictEqual(room, plan.roomBefore)
      || plan.participants.some(person => world.participants.some(existing => existing.id === person.id))
      || plan.events.some(event => {
        const payload = event.payload as Partial<MemoryEventPayload>;
        return [...event.witnesses, event.actorId, payload.ownerId, payload.toId].some(id => id && !RESERVED_ACTORS[id]
          && !plan.participants.some(person => person.id === id)
          && !world.participants.some(person => person.id === id && person.kind === 'persistent'));
      })) {
    await settleRecord(record.integrationId, 'interrupted', 'Destination changed before commit. No prepared effects were published.');
    throw new Error('[world] integration conflict: destination changed; no prepared effects were published');
  }
  const existing = await readPreparedIntegrationEvents(record.destinationRoomId, record.integrationId);
  if (existing.length > plan.events.length || existing.some((event, index) => !admissionMatches(event, plan.events[index]))) {
    await settleRecord(record.integrationId, 'interrupted', 'Prepared journal content is inconsistent. No prepared effects were published.');
    throw new Error('[world] integration conflict: prepared journal content is inconsistent');
  }
  const appended = [...existing];
  for (const draft of plan.events.slice(existing.length)) appended.push(await appendEvent(record.destinationRoomId, draft));
  requireLivingWorld(loadSettings());
  // The sole logical commit: entity effects and the visibility decision share
  // one atomic rename. Prior journal writes are preparation, including marker.
  await saveWorld({ ...world,
    participants: [...world.participants, ...plan.participants],
    rooms: world.rooms.map(item => item.id === record.destinationRoomId ? plan.roomAfter : item),
    integrations: world.integrations!.map(item => item.integrationId === record.integrationId
      ? { ...item, prepared: undefined, status: 'committed', note: undefined, settledAt: Date.now() } : item),
  });
  return { appended, alreadyApplied: false };
}

async function publishUnlocked(request: IntegrateThreadInput): Promise<PublishResult> {
  validateInput(request);
  const world = await loadWorld();
  const integrationId = request.integrationId.trim();
  const hash = selectionHash(request);
  const prior = world.integrations?.find(item => item.integrationId === integrationId);
  if (prior) {
    if (prior.selectionHash !== hash) throw new Error('[world] integration conflict: operation ID belongs to another selection');
    if (prior.status === 'committed') return { appended: await readPreparedIntegrationEvents(prior.destinationRoomId, integrationId), alreadyApplied: true };
    if (prior.status === 'interrupted') throw new Error(`[world] integration interrupted: ${prior.note ?? 'review required'}`);
    if (prior.prepared) return finishPrepared(world, prior);
    // A pending record without a before-image cannot be driven or rolled
    // back; never relabel its published effects as a committed operation.
    throw new Error('[world] pending integration has no prepared before-image; review required');
  }
  const destinationRoom = destinationContext(world, request.destinationRoomId);
  if (!destinationRoom) throw new Error('[world] integration destination Room does not exist');
  const thread = world.threads.find(candidate => candidate.id === request.threadId);
  if (!thread) throw new Error('[world] integration source Thread does not exist');
  const [threadEvents, seaEvents] = await Promise.all([
    readThread(threadContextId(thread), thread.id), readSeaProjection(destinationRoom.id),
  ]);
  const derivation = deriveIntegration(world, thread, destinationRoom, threadEvents, seaEvents, request);
  if (!derivation.ok) throw new Error(`[world] integration invalid: ${derivation.problems.join('; ')}`);
  const { derived } = derivation;
  let room = structuredClone(destinationRoom);
  const events: JournalEventDraft[] = [];
  for (const id of derived.rosterAdditions) {
    const change = applyMembershipChange(room, id, 'add');
    room = change.room;
    if (change.event) events.push(change.event);
  }
  if (derived.scenarioAdopted) room = { ...room, scenario: derived.scenarioAdopted, scenarioRef: integrationId };
  events.push(...derived.admissions);
  const payload: IntegrationPayload = {
    integrationId, sourceThreadId: thread.id, sourceEventIds: derived.selection.memoryEventIds,
    promotedParticipantIds: derived.selection.adoptParticipantIds, destinationRoomId: room.id,
    selectionHash: hash, scenarioAdopted: Boolean(derived.scenarioAdopted),
  };
  events.push({ roomId: room.id, scope: { kind: 'sea' }, type: 'integration', actorId: HARNESS_ACTOR, witnesses: [], payload });
  for (const event of events) event.provenance = { ...event.provenance, integrationId, stagedIntegration: true };
  const record: IntegrationRecord = {
    integrationId, sourceThreadId: thread.id, destinationRoomId: room.id,
    memoryEventIds: derived.selection.memoryEventIds, adoptParticipantIds: derived.selection.adoptParticipantIds,
    includeScenario: derived.selection.includeScenario, selectionHash: hash, status: 'pending', createdAt: Date.now(),
    prepared: { participants: derived.adoptedParticipants, roomBefore: destinationRoom, roomAfter: room, events },
  };
  const preparedWorld = { ...world, integrations: [...(world.integrations ?? []), record] };
  // W1 only persists intent, never canonical topology.
  await saveWorld(preparedWorld);
  return finishPrepared(preparedWorld, record);
}

/** WORLD_INTEGRATE — selective, idempotent, crash-safe publication. */
export async function integrateThread(input: IntegrateThreadInput): Promise<PublishResult> {
  // Selective admission extends the persistent world; consent is checked
  // before any queue wait or world read. Async so consent refusal REJECTS
  // (callers may reasonably expect a promise API, not a sync throw).
  requireLivingWorld(loadSettings());
  // Take a value snapshot before waiting; callers cannot change an admitted
  // selection while another world operation is in flight.
  const request = structuredClone(input);
  return withWorldMutation(() => {
    requireLivingWorld(loadSettings());
    return publishUnlocked(request);
  });
}

/**
 * Restart/first-use recovery: re-drive pending operations from the durable
 * ledger. Transient I/O remains pending and retryable. Proven conflicts and
 * prepared-less records are reported as interrupted (fail closed).
 */
export async function reconcilePendingIntegrations(): Promise<void> {
  if (!livingWorldEnabled(loadSettings())) return;
  await withWorldMutation(async () => {
    if (!livingWorldEnabled(loadSettings())) return;
    const world = await loadWorld();
    const pending = (world.integrations ?? []).filter(record => record.status === 'pending');
    for (const record of pending) {
      if (!livingWorldEnabled(loadSettings())) return;
      try {
        await publishUnlocked({
          integrationId: record.integrationId,
          threadId: record.sourceThreadId,
          destinationRoomId: record.destinationRoomId,
          memoryEventIds: record.memoryEventIds,
          adoptParticipantIds: record.adoptParticipantIds,
          includeScenario: record.includeScenario,
        });
      } catch (error) {
        // I/O failures remain retryable. Only a proven conflict (handled by
        // finishPrepared) or a prepared-less record is terminal.
        if (!record.prepared) await settleRecord(record.integrationId, 'interrupted', error instanceof Error ? error.message : 'integration recovery failed');
      }
    }
  });
}

/** Main-owned preview: what would enter the persistent world, and what blocks it. */
export function previewIntegration(input: {
  threadId: string;
  destinationRoomId: string;
  memoryEventIds: string[];
  adoptParticipantIds: string[];
  includeScenario: boolean;
}): Promise<IntegrationPreview> {
  const request = structuredClone(input);
  validateInput({ ...request, integrationId: 'preview' });
  return withWorldMutation(async () => {
    const world = await loadWorld();
    const thread = world.threads.find(candidate => candidate.id === request.threadId);
    if (!thread) throw new Error('[world] integration source Thread does not exist');
    const destinationRoom = destinationContext(world, request.destinationRoomId);
    if (!destinationRoom) throw new Error('[world] integration destination Room does not exist');
    const contextId = threadContextId(thread);
    const [threadEvents, seaEvents] = await Promise.all([
      readThread(contextId, thread.id),
      readSeaProjection(destinationRoom.id),
    ]);
    const catalog = buildCatalog(world, thread, destinationRoom, threadEvents, seaEvents);
    const derivation = deriveIntegration(world, thread, destinationRoom, threadEvents, seaEvents, {
      integrationId: 'preview',
      threadId: request.threadId,
      destinationRoomId: request.destinationRoomId,
      memoryEventIds: request.memoryEventIds,
      adoptParticipantIds: request.adoptParticipantIds,
      includeScenario: request.includeScenario,
    });
    const referencedBySelection = derivation.ok
      ? new Set(derivation.derived.referencedPersonIds)
      : new Set<string>();
    return {
      operations: (world.integrations ?? []).filter(record => record.sourceThreadId === thread.id).map(({ prepared: _prepared, ...record }) => record),
      threadId: thread.id,
      ...(thread.title ? { threadTitle: thread.title } : {}),
      destinationRoomId: destinationRoom.id,
      destinationRoomTitle: destinationRoom.title,
      destinationHasScenario: Boolean(destinationRoom.scenario),
      items: catalog.items,
      people: catalog.people.map(person => ({
        ...person,
        required: person.action === 'adopt'
          ? derivation.requiredAdoptions.includes(person.id) || request.adoptParticipantIds.includes(person.id)
          : referencedBySelection.has(person.id),
      })),
      scenarioAvailable: catalog.scenarioAvailable,
      requiredAdoptions: derivation.requiredAdoptions,
      problems: derivation.ok ? [] : derivation.problems,
    };
  });
}
