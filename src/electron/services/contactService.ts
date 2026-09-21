/**
 * V10 durable proactive-contact service.
 *
 * A contact is derived from one still-authoritative world cause, proposed by
 * one entitled persistent participant, and committed to the Room journal
 * before any external notification attempt. Prepared journal rows are hidden
 * until the contact ledger certifies their exact ids.
 */

import { createHash } from 'crypto';
import { intentionPayload, intentionStates, simulatedOccurrencePayload } from '../../shared/autonomyProjection';
import { compileContext, visibleEventsFor, type CompiledContext } from '../../shared/contextCompiler';
import { getInferencePolicy, type InferencePolicy } from '../../shared/inferencePolicy';
import { livingWorldEnabled } from '../../shared/livingWorld';
import { openLoopStates, tombstonedIds } from '../../shared/memoryProjection';
import { sanitizeModelSpeech } from '../../shared/modelContent';
import { isInQuietHours } from '../../shared/proactivity';
import { DEFAULT_SETTINGS, type Settings } from '../../shared/types';
import {
  USER_ACTOR,
  type ContactActionResult,
  type ContactModality,
  type ContactRecord,
  type JournalEvent,
  type JournalEventDraft,
  type Participant,
  type Room,
} from '../../shared/world';
import { appendEvent, readPreparedContactEvents, readSeaProjection } from './journalService';
import { loadSettings } from './settings';
import { loadWorld, saveWorld, withWorldMutation, type WorldState } from './worldStore';

export const CONTACT_LIMITS = {
  causesPerRoomPass: 1,
  sourceEvents: 12,
  modelRepairAttempts: 2,
  inputCharacters: 18_000,
  outputCharacters: 2_000,
  eligibilityDelayMs: 10_000,
  messageExpiryMs: 24 * 60 * 60_000,
  callExpiryMs: 60_000,
  messageCooldownMs: 4 * 60 * 60_000,
  callCooldownMs: 24 * 60 * 60_000,
  contactsPerDay: 2,
  deliveryAttempts: 2,
} as const;

export interface ContactDependencies {
  policy: InferencePolicy;
  llmFn: (prompt: string, participantId: string) => Promise<string>;
  now?: number;
  getSettings?: () => Settings;
}

export interface ContactPassResult {
  kind: 'waiting' | 'blocked' | 'nothing' | 'ready' | 'failed';
  contactId?: string;
}

export interface ContactDeliveryInput {
  contactId: string;
  notificationId: string;
  roomId: string;
  participantId: string;
  modality: ContactModality;
  title: string;
  body: string;
  messageEventId?: string;
  callId?: string;
}

export interface ContactDeliveryHandlers {
  onShown: () => void;
  onFailed: (error: string) => void;
  onActivated: () => void;
}

export interface ContactDeliveryDependencies {
  attempt: (
    input: ContactDeliveryInput,
    handlers: ContactDeliveryHandlers,
  ) => 'attempted' | 'denied' | 'unsupported';
  now?: number;
  getSettings?: () => Settings;
}

export interface ContactDeliveryResult {
  attempted: string[];
  unavailable: string[];
  expired: string[];
  suppressed: string[];
}


interface ContactCandidate {
  contactId: string;
  roomId: string;
  participantId: string;
  causeKind: ContactRecord['causeKind'];
  causeEventId: string;
  sourceEventIds: string[];
  sourceHash: string;
  effectiveAt: number;
  eligibleAt: number;
  foregroundHeadEventId?: string;
}

interface ContactProposal {
  decision: 'nothing' | ContactModality;
  text?: string;
  reason?: string;
  sourceEventIds: string[];
}

class ContactConflictError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function participantRevision(person: Participant): string {
  return hash(person);
}

function roomRevision(room: Room, participants: Participant[]): string {
  const { unreadCount: _unreadCount, ...semanticRoom } = room;
  return hash({ room: semanticRoom, participants: room.participantIds.map(id => participants.find(person => person.id === id) ?? id) });
}

function boundedText(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = sanitizeModelSpeech(value, true).trim();
  return text.length > 0 && text.length <= max ? text : undefined;
}

function stringArray(value: unknown, max: number): string[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > max
    || !value.every(item => typeof item === 'string')) return null;
  return [...new Set(value as string[])];
}

const PRESSURE_PATTERN = /\b(?:emergency|urgent|crisis|you owe|if you cared|prove (?:that )?you care|abandon(?:ed|ing)? me|jealous|guilty|last chance|relationship is (?:over|damaged)|everyone is waiting|do not let (?:me|us|them) down|don't let (?:me|us|them) down|cannot do this without you|can't do this without you|why have you not|why haven't you|do not ignore|don't ignore|answer me|disappointed in you)\b/i;
const EXTERNAL_ACTION_PATTERN = /\b(?:email|e-mail|sms|whats\s*app|telegram|signal|discord|instagram|facebook|messenger|cash\s*app|zelle|direct message|dm me|text your phone|phone number|purchase|buy|(?:send|transfer|wire) (?:money|cash|funds|payment)|venmo|paypal|bank transfer|open another app|visit (?:this |the )?(?:site|website)|click (?:this |the )?link|contact a third party|(?:call|phone|ring) (?:a|the|your) (?:doctor|bank|library|office|store|friend|family|third party))\b/i;
const HUMAN_ACTION_CLAIM = /\b(?:the user|the learner|you|human)\b.{0,60}\b(?:said|spoke|agreed|promised|approved|accepted|completed|performed|joined|witnessed|decided|consented)\b/i;

function parseProposal(raw: string, allowedSources: ReadonlySet<string>, causeEventId: string): ContactProposal | null {
  const fenced = raw.trim().replace(/^```(?:json)?\s*/iu, '').replace(/\s*```$/u, '');
  let value: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(fenced);
    if (!isRecord(parsed)) return null;
    value = parsed;
  } catch {
    return null;
  }
  if (value.decision === 'nothing') return { decision: 'nothing', sourceEventIds: [] };
  if (value.decision !== 'message' && value.decision !== 'call') return null;
  const text = boundedText(value.text, 500);
  const reason = boundedText(value.reason, 300);
  const sourceEventIds = stringArray(value.sourceEventIds, CONTACT_LIMITS.sourceEvents);
  if (!text || !reason || !sourceEventIds || !sourceEventIds.includes(causeEventId)
    || !sourceEventIds.every(id => allowedSources.has(id))) return null;
  if (PRESSURE_PATTERN.test(text) || PRESSURE_PATTERN.test(reason)
    || EXTERNAL_ACTION_PATTERN.test(text) || HUMAN_ACTION_CLAIM.test(text)) return null;
  return { decision: value.decision, text, reason, sourceEventIds };
}

function eventText(event: JournalEvent): string | undefined {
  if (!isRecord(event.payload)) return undefined;
  const value = event.payload.text ?? event.payload.summary;
  return typeof value === 'string' ? value : undefined;
}

function leaksUnrelatedPrivateState(proposal: ContactProposal, visible: JournalEvent[]): boolean {
  if (!proposal.text) return false;
  const allowedSources = new Set(proposal.sourceEventIds);
  const output = proposal.text.toLocaleLowerCase();
  return visible.some(event => {
    if (allowedSources.has(event.id) || event.witnesses.includes(USER_ACTOR)) return false;
    if (event.type !== 'disclosure' && event.type !== 'memory.belief') return false;
    const privateText = eventText(event)?.trim().toLocaleLowerCase();
    return privateText !== undefined && privateText.length >= 16 && output.includes(privateText);
  });
}

function foregroundEvents(events: JournalEvent[]): JournalEvent[] {
  return events.filter(event => event.provenance?.contactId === undefined
    && event.provenance?.autonomyJobId === undefined
    && event.witnesses.includes(USER_ACTOR)
    && (event.type === 'message.user' || event.type === 'message.character'));
}

function hasRelationshipExchange(events: JournalEvent[], participantId: string): boolean {
  return events.some(event => event.type === 'message.user' && event.actorId === USER_ACTOR
      && event.witnesses.includes(participantId))
    && events.some(event => event.type === 'message.character' && event.actorId === participantId
      && event.witnesses.includes(USER_ACTOR));
}

function contactIdFor(value: unknown): string {
  return `contact_${hash(value).slice(0, 32)}`;
}

function enumerateCandidates(world: WorldState, room: Room, events: JournalEvent[], now: number): ContactCandidate[] {
  const roster = room.participantIds
    .map(id => world.participants.find(person => person.id === id && person.kind === 'persistent'))
    .filter((person): person is Participant => person !== undefined);
  const foreground = foregroundEvents(events);
  const foregroundHead = foreground.at(-1);
  const invalid = tombstonedIds(events);
  const candidates: ContactCandidate[] = [];
  const add = (person: Participant, causeKind: ContactCandidate['causeKind'], event: JournalEvent, sources: string[]): void => {
    if (!hasRelationshipExchange(foreground, person.id) || invalid.has(event.id)) return;
    const sourceEventIds = [...new Set([event.id, ...sources])].slice(0, CONTACT_LIMITS.sourceEvents);
    const semantic = { roomId: room.id, participantId: person.id, causeKind, causeEventId: event.id };
    candidates.push({
      contactId: contactIdFor(semantic),
      roomId: room.id,
      participantId: person.id,
      causeKind,
      causeEventId: event.id,
      sourceEventIds,
      sourceHash: hash(sourceEventIds.map(id => events.find(item => item.id === id))),
      effectiveAt: event.type === 'occurrence.simulated'
        ? simulatedOccurrencePayload(event)?.effectiveAt ?? event.createdAt
        : event.createdAt,
      eligibleAt: event.createdAt + CONTACT_LIMITS.eligibilityDelayMs,
      foregroundHeadEventId: foregroundHead?.id,
    });
  };

  for (const event of events) {
    const occurrence = simulatedOccurrencePayload(event);
    if (occurrence) {
      const person = roster.find(item => occurrence.actorIds.includes(item.id) && event.witnesses.includes(item.id));
      if (person) add(person, 'occurrence', event, occurrence.sourceEventIds);
    }
  }
  for (const [eventId, state] of openLoopStates(events)) {
    if (state.status !== 'open') continue;
    const event = events.find(item => item.id === eventId);
    const person = roster.find(item => item.id === state.loop.ownerId);
    if (event && person) add(person, 'open-loop', event, state.loop.sourceEventIds);
  }
  for (const state of intentionStates(events).values()) {
    if (!state.active) continue;
    const person = roster.find(item => item.id === state.payload.ownerId);
    if (person) add(person, 'intention', state.event, state.payload.sourceEventIds);
  }
  return candidates
    .filter(candidate => candidate.eligibleAt <= now)
    .sort((left, right) => right.effectiveAt - left.effectiveAt)
    .slice(0, CONTACT_LIMITS.causesPerRoomPass);
}

function settingsAllowContact(settings: Settings, roomId: string, participantId: string, modality?: ContactModality): boolean {
  if (!livingWorldEnabled(settings) || !(settings.proactivityEnabled ?? DEFAULT_SETTINGS.proactivityEnabled)
    || !(settings.llmEnabled ?? DEFAULT_SETTINGS.llmEnabled)) return false;
  const policy = getInferencePolicy(settings);
  if (!policy.isPermitted('proactive') || !policy.prefer('deferred')) return false;
  const participantOptOuts = settings.proactiveOptOutParticipantIds ?? DEFAULT_SETTINGS.proactiveOptOutParticipantIds;
  if (participantOptOuts.includes(participantId)) return false;
  const roomOptOuts = settings.proactiveOptOutRoomIds ?? DEFAULT_SETTINGS.proactiveOptOutRoomIds;
  if (roomOptOuts.includes(roomId)) return false;
  const callOptOuts = settings.proactiveCallOptOutParticipantIds ?? DEFAULT_SETTINGS.proactiveCallOptOutParticipantIds;
  return modality !== 'call' || !callOptOuts.includes(participantId);
}

function contactRateLimited(
  world: WorldState,
  participantId: string,
  now: number,
  modality: ContactModality = 'message',
  excludeContactId?: string,
): boolean {
  const committed = (world.contacts ?? []).filter(record => record.contactId !== excludeContactId
    && record.participantId === participantId && record.eventIds?.length);
  const withinDay = committed.filter(record => now - record.createdAt < 24 * 60 * 60_000);
  if (withinDay.length >= CONTACT_LIMITS.contactsPerDay) return true;
  const cooldown = modality === 'call' ? CONTACT_LIMITS.callCooldownMs : CONTACT_LIMITS.messageCooldownMs;
  return committed.some(record => now - record.createdAt < cooldown);
}

function promptContext(context: CompiledContext): unknown {
  return {
    persona: context.persona,
    canonBaseline: context.canonBaseline,
    negativeKnowledge: context.negativeKnowledge,
    relationships: context.relationships,
    memories: context.memories,
    openLoops: context.openLoops,
    intentions: context.intentions,
    witnessedOccurrences: context.witnessedOccurrences,
    scenario: context.scenario,
    recentEvents: context.recentThreadEvents.slice(-10),
  };
}

function makePrompt(candidate: ContactCandidate, person: Participant, context: CompiledContext, sources: JournalEvent[]): string {
  const prompt = JSON.stringify({
    task: 'Decide conservatively whether this person has a meaningful existing-world reason to contact the user now. Nothing is a valid and preferred result when contact is not useful. Never invent urgency, danger, jealousy, guilt, dependency, relationship damage, or a crisis. Never claim the user acted when they did not. Never request email, SMS, real phone calls, purchases, other apps, or third-party contact. Use only information this person can know. A message should be natural and specific. A call is appropriate only when a timely synchronous conversation is genuinely more useful than a message.',
    participantId: person.id,
    roomId: candidate.roomId,
    causeKind: candidate.causeKind,
    perspective: promptContext(context),
    eligibleSources: sources.map(event => ({ id: event.id, type: event.type, actorId: event.actorId, text: eventText(event), createdAt: event.createdAt })),
    outputSchema: {
      decision: 'nothing | message | call',
      text: 'required for message/call, at most 500 characters',
      reason: 'required private audit explanation, at most 300 characters',
      sourceEventIds: ['exact eligible source ids, including the cause'],
    },
    validNothing: { decision: 'nothing' },
  });
  if (prompt.length > CONTACT_LIMITS.inputCharacters) throw new Error('Contact input exceeds its context budget');
  return prompt;
}

async function validProposal(
  prompt: string,
  candidate: ContactCandidate,
  llmFn: ContactDependencies['llmFn'],
): Promise<ContactProposal | null> {
  const allowed = new Set(candidate.sourceEventIds);
  for (let attempt = 0; attempt < CONTACT_LIMITS.modelRepairAttempts; attempt++) {
    const request = attempt === 0 ? prompt : JSON.stringify({
      ...(JSON.parse(prompt) as Record<string, unknown>),
      repair: 'The previous response was invalid. Return only one strict JSON object matching outputSchema. Use exact source ids and do not add urgency or unsupported facts.',
    });
    const raw = await llmFn(request, candidate.participantId);
    if (raw.length > CONTACT_LIMITS.outputCharacters) continue;
    const proposal = parseProposal(raw, allowed, candidate.causeEventId);
    if (proposal) return proposal;
  }
  return null;
}

function contactDraft(record: ContactRecord, proposal: ContactProposal): JournalEventDraft {
  const common = {
    roomId: record.roomId,
    scope: { kind: 'sea' } as const,
    actorId: record.participantId,
    witnesses: [record.participantId, USER_ACTOR],
    provenance: { contactId: record.contactId },
  };
  return proposal.decision === 'message'
    ? { ...common, type: 'message.character', payload: { text: proposal.text } }
    : { ...common, type: 'contact.invitation', payload: {
      contactId: record.contactId,
      callId: record.callId,
      modality: 'call',
      sourceEventIds: proposal.sourceEventIds,
    } };
}

function draftMatches(draft: JournalEventDraft, event: JournalEvent): boolean {
  return event.roomId === draft.roomId
    && event.type === draft.type
    && event.actorId === draft.actorId
    && JSON.stringify(event.scope) === JSON.stringify(draft.scope)
    && JSON.stringify(event.witnesses) === JSON.stringify(draft.witnesses)
    && JSON.stringify(event.payload) === JSON.stringify(draft.payload)
    && event.provenance?.contactId === draft.provenance?.contactId;
}

function candidateStillValid(world: WorldState, record: ContactRecord, events: JournalEvent[]): boolean {
  const room = world.rooms.find(item => item.id === record.roomId);
  const person = world.participants.find(item => item.id === record.participantId && item.kind === 'persistent');
  if (!room || !person || !room.participantIds.includes(person.id)) return false;
  if (record.roomRevision !== roomRevision(room, world.participants)
    || record.participantRevision !== participantRevision(person)) return false;
  const invalid = tombstonedIds(events);
  if (record.sourceEventIds.some(id => invalid.has(id) || !events.some(event => event.id === id))) return false;
  if (record.sourceHash !== hash(record.sourceEventIds.map(id => events.find(event => event.id === id)))) return false;
  if (record.causeKind === 'open-loop' && openLoopStates(events).get(record.sourceEventIds[0])?.status !== 'open') return false;
  if (record.causeKind === 'intention') {
    const state = intentionStates(events).get(intentionPayload(events.find(event => event.id === record.sourceEventIds[0])!)?.intentionId ?? '');
    if (!state?.active) return false;
  }
  const foreground = foregroundEvents(events);
  const recordedHeadSeq = foreground.find(event => event.id === record.foregroundHeadEventId)?.seq ?? 0;
  const laterForeground = foreground.some(event => event.seq > recordedHeadSeq);
  return !laterForeground;
}

async function stageContact(candidate: ContactCandidate, now: number): Promise<ContactRecord> {
  return withWorldMutation(async () => {
    const current = await loadWorld();
    const existing = current.contacts?.find(record => record.contactId === candidate.contactId);
    if (existing) return existing;
    const room = current.rooms.find(item => item.id === candidate.roomId);
    const person = current.participants.find(item => item.id === candidate.participantId && item.kind === 'persistent');
    if (!room || !person) throw new ContactConflictError('Contact destination disappeared');
    const record: ContactRecord = {
      contactId: candidate.contactId,
      operationId: candidate.contactId,
      roomId: candidate.roomId,
      participantId: candidate.participantId,
      targetActorId: USER_ACTOR,
      causeKind: candidate.causeKind,
      sourceEventIds: candidate.sourceEventIds,
      sourceHash: candidate.sourceHash,
      status: 'proposed',
      revision: 1,
      history: [{ status: 'proposed', at: now }],
      createdAt: now,
      effectiveAt: candidate.effectiveAt,
      readyAt: now,
      expiresAt: now + CONTACT_LIMITS.messageExpiryMs,
      deliveryAttempts: 0,
      deliveryState: 'not-attempted',
      foregroundHeadEventId: candidate.foregroundHeadEventId,
      participantRevision: participantRevision(person),
      roomRevision: roomRevision(room, current.participants),
    };
    await saveWorld({ ...current, contacts: [...(current.contacts ?? []), record] });
    return record;
  });
}

async function settleWithoutPublication(contactId: string, reason: string, now: number): Promise<void> {
  await withWorldMutation(async () => {
    const world = await loadWorld();
    const record = world.contacts?.find(item => item.contactId === contactId);
    if (!record || record.eventIds) return;
    const updated: ContactRecord = {
      ...record,
      status: 'cancelled',
      revision: record.revision + 1,
      history: [...record.history, { status: 'cancelled', at: now, reason }],
      settledAt: now,
      reason,
      prepared: undefined,
    };
    await saveWorld({ ...world, contacts: world.contacts?.map(item => item.contactId === contactId ? updated : item) });
  });
}

async function prepareContact(record: ContactRecord, proposal: ContactProposal, now: number): Promise<void> {
  await withWorldMutation(async () => {
    const world = await loadWorld();
    const current = world.contacts?.find(item => item.contactId === record.contactId);
    if (!current || current.status !== 'proposed') throw new ContactConflictError('Contact proposal is no longer active');
    const events = await readSeaProjection(current.roomId);
    if (!candidateStillValid(world, current, events)) throw new ContactConflictError('Contact cause changed before publication');
    const callId = proposal.decision === 'call' ? `call_${hash(record.contactId).slice(0, 24)}` : undefined;
    const preparedRecord: ContactRecord = {
      ...current,
      modality: proposal.decision as ContactModality,
      reason: proposal.reason,
      messageText: proposal.text,
      callId,
      expiresAt: now + (proposal.decision === 'call' ? CONTACT_LIMITS.callExpiryMs : CONTACT_LIMITS.messageExpiryMs),
    };
    const draft = contactDraft(preparedRecord, proposal);
    preparedRecord.prepared = { expectedDrafts: [draft] };
    await saveWorld({ ...world, contacts: world.contacts?.map(item => item.contactId === record.contactId ? preparedRecord : item) });
  });
}

async function publishPreparedContact(
  contactId: string,
  now: number,
  getSettings: () => Settings = loadSettings,
): Promise<ContactPassResult> {
  return withWorldMutation(async () => {
    const world = await loadWorld();
    const record = world.contacts?.find(item => item.contactId === contactId);
    if (!record) return { kind: 'failed' };
    if (record.eventIds) return { kind: 'ready', contactId };
    if (record.status !== 'proposed' || !record.prepared || !record.modality) return { kind: 'failed', contactId };
    const settings = getSettings();
    if (!settingsAllowContact(settings, record.roomId, record.participantId, record.modality)) {
      const cancelled: ContactRecord = { ...record, status: 'cancelled', revision: record.revision + 1,
        history: [...record.history, { status: 'cancelled', at: now, reason: 'Contact permission changed before commit' }],
        settledAt: now, prepared: undefined };
      await saveWorld({ ...world, contacts: world.contacts?.map(item => item.contactId === contactId ? cancelled : item) });
      return { kind: 'nothing', contactId };
    }
    const events = await readSeaProjection(record.roomId);
    if (!candidateStillValid(world, record, events)) {
      const superseded: ContactRecord = { ...record, status: 'superseded', revision: record.revision + 1,
        history: [...record.history, { status: 'superseded', at: now, reason: 'The cause changed before contact commit' }],
        settledAt: now, prepared: undefined };
      await saveWorld({ ...world, contacts: world.contacts?.map(item => item.contactId === contactId ? superseded : item) });
      return { kind: 'nothing', contactId };
    }
    const rows = await readPreparedContactEvents(record.roomId, contactId);
    if (rows.length > record.prepared.expectedDrafts.length
      || rows.some((row, index) => !draftMatches(record.prepared!.expectedDrafts[index], row))) {
      throw new ContactConflictError('Prepared contact publication is inconsistent');
    }
    const published = [...rows];
    for (const draft of record.prepared.expectedDrafts.slice(rows.length)) {
      published.push(await appendEvent(record.roomId, draft));
    }
    const latestWorld = await loadWorld();
    const latestEvents = await readSeaProjection(record.roomId);
    if (!candidateStillValid(latestWorld, record, latestEvents)) {
      const superseded: ContactRecord = { ...record, status: 'superseded', revision: record.revision + 1,
        history: [...record.history, { status: 'superseded', at: now, reason: 'The cause changed during contact publication' }],
        settledAt: now, prepared: undefined };
      await saveWorld({ ...latestWorld, contacts: latestWorld.contacts?.map(item => item.contactId === contactId ? superseded : item) });
      return { kind: 'nothing', contactId };
    }
    const ready: ContactRecord = {
      ...record,
      status: 'ready',
      revision: record.revision + 1,
      history: [...record.history, { status: 'ready', at: now }],
      eventIds: published.map(event => event.id),
      messageEventId: record.modality === 'message' ? published[0]?.id : undefined,
      prepared: undefined,
    };
    await saveWorld({
      ...latestWorld,
      rooms: latestWorld.rooms.map(room => room.id === record.roomId
        ? { ...room, unreadCount: (room.unreadCount ?? 0) + 1 }
        : room),
      contacts: latestWorld.contacts?.map(item => item.contactId === contactId ? ready : item),
    });
    return { kind: 'ready', contactId };
  });
}

async function runContactPassOnce(roomId: string, deps: ContactDependencies): Promise<ContactPassResult> {
  const now = deps.now ?? Date.now();
  const getSettings = deps.getSettings ?? loadSettings;
  const currentSettings = getSettings();
  if (!livingWorldEnabled(currentSettings) || !(currentSettings.proactivityEnabled ?? DEFAULT_SETTINGS.proactivityEnabled)) {
    return { kind: 'waiting' };
  }
  const world = await loadWorld();
  const room = world.rooms.find(item => item.id === roomId);
  if (!room) return { kind: 'waiting' };
  const prepared = world.contacts?.find(record => record.roomId === roomId && record.status === 'proposed' && record.prepared);
  if (prepared) return publishPreparedContact(prepared.contactId, now, getSettings);
  const events = await readSeaProjection(roomId);
  const candidate = enumerateCandidates(world, room, events, now)[0];
  if (!candidate) return { kind: 'waiting' };
  const existing = world.contacts?.find(record => record.contactId === candidate.contactId);
  if (existing) {
    return existing.eventIds ? { kind: 'ready', contactId: existing.contactId }
      : { kind: existing.status === 'cancelled' ? 'nothing' : 'failed', contactId: existing.contactId };
  }
  if (!settingsAllowContact(currentSettings, room.id, candidate.participantId)
    || contactRateLimited(world, candidate.participantId, now)
    || !deps.policy.isPermitted('proactive') || !deps.policy.prefer('deferred')) return { kind: 'blocked' };
  const record = await stageContact(candidate, now);
  const person = world.participants.find(item => item.id === candidate.participantId)!;
  const visible = visibleEventsFor(person.id, events, person.capabilities);
  const sourceSet = new Set(candidate.sourceEventIds);
  const sources = visible.filter(event => sourceSet.has(event.id));
  if (sources.length !== sourceSet.size) {
    await settleWithoutPublication(record.contactId, 'The contacting person lost access to the cause', now);
    return { kind: 'nothing', contactId: record.contactId };
  }
  const context = compileContext({ room, participant: person, participants: world.participants,
    seaEvents: events, threadEvents: events, turn: { text: 'whether to contact the user about this world cause' } });
  try {
    const proposal = await validProposal(makePrompt(candidate, person, context, sources), candidate, deps.llmFn);
    if (!proposal) throw new Error('No valid contact decision within the repair bound');
    if (proposal.decision === 'nothing') {
      await settleWithoutPublication(record.contactId, 'The grounded participant decided not to contact the user', now);
      return { kind: 'nothing', contactId: record.contactId };
    }
    if (leaksUnrelatedPrivateState(proposal, visible)) {
      throw new Error('Contact output disclosed unrelated participant-private state');
    }
    const latestSettings = getSettings();
    if (!settingsAllowContact(latestSettings, room.id, person.id, proposal.decision)) {
      await settleWithoutPublication(record.contactId, 'Contact permission changed during inference', now);
      return { kind: 'nothing', contactId: record.contactId };
    }
    if (contactRateLimited(await loadWorld(), person.id, now, proposal.decision, record.contactId)) {
      await settleWithoutPublication(record.contactId, 'Contact cooldown became active during inference', now);
      return { kind: 'nothing', contactId: record.contactId };
    }
    await prepareContact(record, proposal, now);
    return publishPreparedContact(record.contactId, now, getSettings);
  } catch (error) {
    if (error instanceof ContactConflictError) {
      await settleWithoutPublication(record.contactId, error.message, now);
      return { kind: 'nothing', contactId: record.contactId };
    }
    await settleWithoutPublication(record.contactId, error instanceof Error ? error.message : 'Contact generation failed', now);
    return { kind: 'failed', contactId: record.contactId };
  }
}

const activeRoomPasses = new Map<string, Promise<ContactPassResult>>();

/** Multiple scheduler/resume triggers for one Room join the same main-owned
 * decision. They cannot independently infer or publish duplicate contact. */
export function runContactPass(roomId: string, deps: ContactDependencies): Promise<ContactPassResult> {
  const running = activeRoomPasses.get(roomId);
  if (running) return running;
  const result = runContactPassOnce(roomId, deps).finally(() => activeRoomPasses.delete(roomId));
  activeRoomPasses.set(roomId, result);
  return result;
}

const TERMINAL_CONTACT_STATUSES = new Set<ContactRecord['status']>([
  'accepted', 'declined', 'missed', 'expired', 'cancelled', 'superseded',
]);

function publicContact(record: ContactRecord): Omit<ContactRecord, 'prepared'> {
  const { prepared: _prepared, ...visible } = record;
  return visible;
}

async function updateContact(
  contactId: string,
  update: (record: ContactRecord, world: WorldState) => ContactRecord,
): Promise<ContactRecord | undefined> {
  return withWorldMutation(async () => {
    const world = await loadWorld();
    const record = world.contacts?.find(item => item.contactId === contactId);
    if (!record) return undefined;
    const next = update(record, world);
    await saveWorld({ ...world, contacts: world.contacts?.map(item => item.contactId === contactId ? next : item) });
    return next;
  });
}

function withStatus(record: ContactRecord, status: ContactRecord['status'], at: number, reason?: string): ContactRecord {
  if (record.status === status) return record;
  return {
    ...record,
    status,
    revision: record.revision + 1,
    history: [...record.history, { status, at, ...(reason ? { reason } : {}) }],
    ...(reason ? { reason } : {}),
  };
}

function beginDeliveryAttempt(record: ContactRecord, at: number): ContactRecord {
  if (record.status === 'opened' || TERMINAL_CONTACT_STATUSES.has(record.status)) return record;
  return {
    ...withStatus(record, 'attempted', at),
    deliveryAttempts: record.deliveryAttempts + 1,
    attemptedAt: at,
    deliveryState: 'unknown',
  };
}

export async function markContactDelivered(contactId: string, at = Date.now()): Promise<ContactRecord | undefined> {
  return updateContact(contactId, record => {
    if (record.status === 'opened' || TERMINAL_CONTACT_STATUSES.has(record.status)) return record;
    return { ...withStatus(record, 'delivered', at), deliveryState: 'shown', deliveredAt: at, lastDeliveryError: undefined };
  });
}

export async function markContactDeliveryFailed(
  contactId: string,
  error: string,
  at = Date.now(),
): Promise<ContactRecord | undefined> {
  return updateContact(contactId, record => {
    if (record.status === 'opened' || TERMINAL_CONTACT_STATUSES.has(record.status)) return record;
    return {
      ...withStatus(record, 'delivery-unavailable', at, error),
      deliveryState: 'failed',
      lastDeliveryError: error,
    };
  });
}

function deliveryInput(record: ContactRecord, world: WorldState): ContactDeliveryInput | undefined {
  if (!record.modality) return undefined;
  const person = world.participants.find(item => item.id === record.participantId);
  if (!person) return undefined;
  return {
    contactId: record.contactId,
    notificationId: record.contactId,
    roomId: record.roomId,
    participantId: record.participantId,
    modality: record.modality,
    title: record.modality === 'call' ? 'Incoming call' : 'New message',
    // Notification previews deliberately contain no world/private message
    // content. The canonical Room event carries the actual communication.
    body: record.modality === 'call'
      ? `Incoming call from ${person.displayName}`
      : `${person.displayName} sent you a message`,
    messageEventId: record.messageEventId,
    callId: record.callId,
  };
}

async function expireContact(record: ContactRecord, now: number): Promise<ContactRecord | undefined> {
  return updateContact(record.contactId, current => {
    if (TERMINAL_CONTACT_STATUSES.has(current.status) || current.expiresAt > now) return current;
    const wasRinging = current.modality === 'call'
      && ['attempted', 'delivery-unknown', 'delivered', 'opened'].includes(current.status);
    return {
      ...withStatus(current, wasRinging ? 'missed' : 'expired', now, wasRinging
        ? 'The incoming call was not accepted before it expired'
        : 'The contact opportunity expired before delivery'),
      settledAt: now,
    };
  });
}

export async function reconcileContactDelivery(
  roomId: string,
  deps: ContactDeliveryDependencies,
): Promise<ContactDeliveryResult> {
  const now = deps.now ?? Date.now();
  const getSettings = deps.getSettings ?? loadSettings;
  const result: ContactDeliveryResult = { attempted: [], unavailable: [], expired: [], suppressed: [] };
  const snapshot = await loadWorld();
  let externalAttemptStarted = false;
  const records = (snapshot.contacts ?? []).filter(record => record.roomId === roomId
    && !TERMINAL_CONTACT_STATUSES.has(record.status));
  for (const record of records) {
    if (record.expiresAt <= now) {
      await expireContact(record, now);
      result.expired.push(record.contactId);
      continue;
    }
    const world = await loadWorld();
    const current = world.contacts?.find(item => item.contactId === record.contactId);
    if (!current || TERMINAL_CONTACT_STATUSES.has(current.status)) continue;
    // An opened message needs no more OS delivery. An opened call remains
    // eligible only for its timeout transition above; it never rings again.
    if (current.status === 'opened') continue;
    const settings = getSettings();
    if (!settingsAllowContact(settings, current.roomId, current.participantId, current.modality)) {
      await updateContact(current.contactId, item => ({
        ...withStatus(item, 'cancelled', now, 'Contact was muted or paused before delivery'),
        settledAt: now,
      }));
      result.suppressed.push(current.contactId);
      continue;
    }
    const events = await readSeaProjection(current.roomId);
    if (!candidateStillValid(world, current, events)) {
      await updateContact(current.contactId, item => ({
        ...withStatus(item, 'superseded', now, 'The underlying cause changed before delivery'),
        settledAt: now,
      }));
      result.suppressed.push(current.contactId);
      continue;
    }
    // Once the external side effect may have happened, never downgrade it to
    // scheduled or replay it merely because the clock/quiet-hours state
    // changed. Unknown delivery is intentionally conservative: canonical
    // contact remains usable, but macOS is not asked to display it again.
    if (['delivered', 'delivery-unknown', 'delivery-unavailable'].includes(current.status)) continue;
    if (isInQuietHours(settings, now)) {
      await updateContact(current.contactId, item => withStatus(item, 'scheduled', now, 'Waiting for quiet hours to end'));
      result.suppressed.push(current.contactId);
      continue;
    }
    if (current.deliveryAttempts >= CONTACT_LIMITS.deliveryAttempts
      || !['ready', 'scheduled', 'attempted'].includes(current.status)) continue;
    // One external side effect per Room reconciliation prevents a resume with
    // several durable contacts from becoming a notification burst. Expiry and
    // suppression still reconcile every record in the bounded Room.
    if (externalAttemptStarted) continue;
    const input = deliveryInput(current, world);
    if (!input) {
      await updateContact(current.contactId, item => ({
        ...withStatus(item, 'cancelled', now, 'The contact destination no longer exists'),
        settledAt: now,
      }));
      result.suppressed.push(current.contactId);
      continue;
    }
    const begun = await updateContact(current.contactId, item => beginDeliveryAttempt(item, now));
    // Activation can race the delivery reconcile after its snapshot read.
    // The serialized mutation above observes the live state; if activation
    // already opened the contact, do not emit or overwrite that transition.
    if (!begun || begun.status !== 'attempted' || begun.attemptedAt !== now) continue;
    externalAttemptStarted = true;
    let outcome: ReturnType<ContactDeliveryDependencies['attempt']>;
    try {
      outcome = deps.attempt(input, {
        onShown: () => { void markContactDelivered(current.contactId); },
        onFailed: error => { void markContactDeliveryFailed(current.contactId, error); },
        onActivated: () => { void activateContact(current.contactId); },
      });
    } catch (error) {
      outcome = 'unsupported';
      await markContactDeliveryFailed(current.contactId, error instanceof Error ? error.message : 'Notification delivery failed', now);
    }
    if (outcome === 'attempted') {
      await updateContact(current.contactId, item => item.status === 'attempted'
        ? { ...withStatus(item, 'delivery-unknown', now), deliveryState: 'unknown' }
        : item);
      result.attempted.push(current.contactId);
    } else {
      await updateContact(current.contactId, item => ({
        ...withStatus(item, 'delivery-unavailable', now,
          outcome === 'denied' ? 'OS notification permission was denied' : 'OS notifications are unsupported'),
        deliveryState: outcome,
      }));
      result.unavailable.push(current.contactId);
    }
  }
  return result;
}

export async function activateContact(contactId: string, now = Date.now()): Promise<ContactActionResult> {
  return withWorldMutation(async () => {
    const world = await loadWorld();
    const record = world.contacts?.find(item => item.contactId === contactId);
    if (!record) return { ok: false, reason: 'This contact no longer exists.' };
    if (TERMINAL_CONTACT_STATUSES.has(record.status)) {
      return { ok: false, reason: 'This contact is no longer active.', contact: publicContact(record) };
    }
    if (record.expiresAt <= now) {
      const wasRinging = record.modality === 'call'
        && ['attempted', 'delivery-unknown', 'delivered', 'opened'].includes(record.status);
      const expired = {
        ...withStatus(record, wasRinging ? 'missed' : 'expired', now, wasRinging
          ? 'The incoming call was not accepted before it expired'
          : 'The contact opportunity expired before activation'),
        settledAt: now,
      };
      await saveWorld({ ...world, contacts: world.contacts?.map(item => item.contactId === contactId ? expired : item) });
      return { ok: false, reason: 'This contact has expired.', contact: publicContact(expired) };
    }
    const room = world.rooms.find(item => item.id === record.roomId);
    const person = world.participants.find(item => item.id === record.participantId);
    if (!room || !person || !room.participantIds.includes(person.id)) {
      const cancelled = { ...withStatus(record, 'cancelled', now, 'The Room or person was erased'), settledAt: now };
      await saveWorld({ ...world, contacts: world.contacts?.map(item => item.contactId === contactId ? cancelled : item) });
      return { ok: false, reason: 'This conversation is no longer available.', contact: publicContact(cancelled) };
    }
    if (!settingsAllowContact(loadSettings(), record.roomId, record.participantId, record.modality)) {
      const cancelled = { ...withStatus(record, 'cancelled', now, 'Contact permission changed before activation'), settledAt: now };
      await saveWorld({ ...world, contacts: world.contacts?.map(item => item.contactId === contactId ? cancelled : item) });
      return { ok: false, reason: 'This contact is no longer allowed.', contact: publicContact(cancelled) };
    }
    const events = await readSeaProjection(record.roomId);
    if (!candidateStillValid(world, record, events)) {
      const superseded = { ...withStatus(record, 'superseded', now, 'The underlying cause changed before activation'), settledAt: now };
      await saveWorld({ ...world, contacts: world.contacts?.map(item => item.contactId === contactId ? superseded : item) });
      return { ok: false, reason: 'This contact was superseded.', contact: publicContact(superseded) };
    }
    if (record.status === 'opened') return { ok: true, contact: publicContact(record) };
    const opened = { ...withStatus(record, 'opened', now), openedAt: now };
    await saveWorld({ ...world, contacts: world.contacts?.map(item => item.contactId === contactId ? opened : item) });
    return { ok: true, contact: publicContact(opened) };
  });
}

export async function respondToContact(
  contactId: string,
  response: 'accept' | 'decline',
  now = Date.now(),
): Promise<ContactActionResult> {
  return withWorldMutation(async () => {
    const world = await loadWorld();
    const record = world.contacts?.find(item => item.contactId === contactId);
    if (!record) return { ok: false, reason: 'This call invitation no longer exists.' };
    if (record.modality !== 'call') return { ok: false, reason: 'This contact is not a call invitation.', contact: publicContact(record) };
    const desired = response === 'accept' ? 'accepted' : 'declined';
    if (record.status === desired) return { ok: true, contact: publicContact(record) };
    if (record.status === 'accepted') {
      return { ok: false, reason: 'This call was already accepted.', contact: publicContact(record) };
    }
    if (record.status === 'declined') {
      return { ok: false, reason: 'This call was already declined.', contact: publicContact(record) };
    }
    if (record.status !== 'opened') {
      return { ok: false, reason: 'The call invitation must be opened before responding.', contact: publicContact(record) };
    }
    if (record.expiresAt <= now) {
      const expired = {
        ...withStatus(record, 'missed', now, 'The incoming call was not accepted before it expired'),
        settledAt: now,
      };
      await saveWorld({ ...world, contacts: world.contacts?.map(item => item.contactId === contactId ? expired : item) });
      return { ok: false, reason: 'This call invitation has expired.', contact: publicContact(expired) };
    }
    const room = world.rooms.find(item => item.id === record.roomId);
    const person = world.participants.find(item => item.id === record.participantId);
    if (!room || !person || !room.participantIds.includes(person.id)) {
      const cancelled = { ...withStatus(record, 'cancelled', now, 'The Room or person was erased'), settledAt: now };
      await saveWorld({ ...world, contacts: world.contacts?.map(item => item.contactId === contactId ? cancelled : item) });
      return { ok: false, reason: 'This conversation is no longer available.', contact: publicContact(cancelled) };
    }
    if (!settingsAllowContact(loadSettings(), record.roomId, record.participantId, 'call')) {
      const cancelled = { ...withStatus(record, 'cancelled', now, 'Call permission changed before response'), settledAt: now };
      await saveWorld({ ...world, contacts: world.contacts?.map(item => item.contactId === contactId ? cancelled : item) });
      return { ok: false, reason: 'This call is no longer allowed.', contact: publicContact(cancelled) };
    }
    const events = await readSeaProjection(record.roomId);
    if (!candidateStillValid(world, record, events)) {
      const superseded = { ...withStatus(record, 'superseded', now, 'The underlying cause changed before response'), settledAt: now };
      await saveWorld({ ...world, contacts: world.contacts?.map(item => item.contactId === contactId ? superseded : item) });
      return { ok: false, reason: 'This call was superseded.', contact: publicContact(superseded) };
    }
    const updated = {
      ...withStatus(record, desired, now),
      ...(desired === 'declined' ? { settledAt: now } : {}),
    };
    await saveWorld({ ...world, contacts: world.contacts?.map(item => item.contactId === contactId ? updated : item) });
    return { ok: true, contact: publicContact(updated) };
  });
}

export const contactInternals = {
  enumerateCandidates,
  parseProposal,
  draftMatches,
  settingsAllowContact,
  contactRateLimited,
  beginDeliveryAttempt,
};
