/**
 * V09 autonomous living-world service.
 *
 * Deterministic eligibility never spends inference. A real candidate becomes
 * one durable main-owned job. Model output can either wait, originate one
 * grounded intention, or pursue one existing intention through a bounded
 * participant-specific episode. Validated drafts are appended under hidden
 * operation provenance and become canonical only when world.json atomically
 * marks the job committed.
 */

import { createHash } from 'crypto';
import { compileContext, visibleEventsFor, type CompiledContext } from '../../shared/contextCompiler';
import { intentionPayload, intentionStates } from '../../shared/autonomyProjection';
import { openLoopStates, tombstonedIds } from '../../shared/memoryProjection';
import { livingWorldEnabled } from '../../shared/livingWorld';
import { DEFAULT_SETTINGS, type Settings } from '../../shared/types';
import {
  USER_ACTOR,
  type AutonomyCandidateKind,
  type AutonomyJobRecord,
  type IntentionPayload,
  type IntentionStatus,
  type JournalEvent,
  type JournalEventDraft,
  type MessagePayload,
  type Participant,
  type Room,
  type SimulatedOccurrencePayload,
} from '../../shared/world';
import type { InferencePolicy } from '../../shared/inferencePolicy';
import { loadSettings } from './settings';
import { appendEvent, readPreparedAutonomyEvents, readSeaProjection } from './journalService';
import { loadWorld, saveWorld, withWorldMutation, type WorldState } from './worldStore';

export const AUTONOMY_LIMITS = {
  candidatesPerRoomPass: 1,
  peopleConsideredPerRoom: 4,
  participantsPerEpisode: 2,
  followThroughsPerIntention: 3,
  modelRepairAttempts: 2,
  durableJobAttempts: 2,
  sourceEvents: 24,
  inputCharacters: 24_000,
  outputCharacters: 6_000,
  interestDelayMs: 10_000,
  followThroughDelayMs: 10_000,
  retryBackoffMs: 60_000,
  maxCatchUpAgeMs: 7 * 24 * 60 * 60_000,
} as const;

export interface AutonomyDependencies {
  policy: InferencePolicy;
  llmFn: (prompt: string, participantId: string) => Promise<string>;
  now?: number;
  getSettings?: () => Settings;
}

export interface AutonomyPassResult {
  kind: 'waiting' | 'blocked' | 'deferred' | 'committed' | 'cancelled' | 'failed' | 'skipped';
  jobId?: string;
}

interface Candidate {
  jobId: string;
  roomId: string;
  kind: AutonomyCandidateKind;
  leadParticipantId: string;
  sourceEventIds: string[];
  candidateHash: string;
  eligibleAt: number;
  activeIntentionEventId?: string;
  openLoopEventId?: string;
}

interface IntentionProposal {
  decision: 'wait' | 'intend';
  text?: string;
  sourceEventIds: string[];
}

interface ActionProposal {
  decision: 'wait' | 'abandon' | 'act';
  text?: string;
  actionText?: string;
  leadMessage?: string;
  inviteParticipantId?: string;
  outcome?: 'pursued' | 'revised' | 'completed';
  revisedIntentionText?: string;
  sourceEventIds: string[];
  referencesUserContributionEventIds: string[];
  affectedParticipantIds: string[];
}

interface ParticipantReply {
  decision: 'accept' | 'decline';
  responseText: string;
}

class AutonomyConflictError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function boundedText(value: unknown, max = 600): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= max ? trimmed : undefined;
}

function stringArray(value: unknown, max: number): string[] | null {
  if (!Array.isArray(value) || value.length > max || !value.every(item => typeof item === 'string')) return null;
  return [...new Set(value as string[])];
}

function participantRevision(person: Participant): string {
  return hash(person);
}

function roomRevision(room: Room, participants: Participant[]): string {
  return hash({ room, participants: room.participantIds.map(id => participants.find(person => person.id === id) ?? id) });
}

function settingsAllowAutonomy(settings: Settings): boolean {
  return livingWorldEnabled(settings)
    && (settings.worldAutonomyEnabled ?? DEFAULT_SETTINGS.worldAutonomyEnabled)
    && (settings.llmEnabled ?? DEFAULT_SETTINGS.llmEnabled);
}

function foregroundEvents(events: JournalEvent[]): JournalEvent[] {
  return events.filter(event => event.provenance?.autonomyJobId === undefined
    && event.witnesses.includes(USER_ACTOR)
    && (event.type === 'message.user' || event.type === 'message.character'));
}

function hasRealExchange(events: JournalEvent[]): boolean {
  return events.some(event => event.type === 'message.user' && event.actorId === USER_ACTOR)
    && events.some(event => event.type === 'message.character' && event.actorId !== USER_ACTOR);
}

function jobIdentity(value: unknown): string {
  return `autonomy_${hash(value).slice(0, 32)}`;
}

function terminalJob(job: AutonomyJobRecord): boolean {
  return job.status === 'committed' || job.status === 'cancelled' || job.status === 'skipped'
    || (job.status === 'failed' && job.attempts >= AUTONOMY_LIMITS.durableJobAttempts);
}

function enumerateCandidates(world: WorldState, room: Room, events: JournalEvent[], now: number): Candidate[] {
  const roster = room.participantIds
    .map(id => world.participants.find(person => person.id === id && person.kind === 'persistent'))
    .filter((person): person is Participant => person !== undefined)
    .slice(0, AUTONOMY_LIMITS.peopleConsideredPerRoom);
  if (roster.length === 0) return [];
  const foreground = foregroundEvents(events);
  if (!hasRealExchange(foreground)) return [];
  const latestForeground = foreground.at(-1)!;
  const invalid = tombstonedIds(events);
  const candidates: Candidate[] = [];

  // Active intentions take priority and produce at most one bounded follow-up.
  for (const state of intentionStates(events).values()) {
    if (!state.active || !room.participantIds.includes(state.payload.ownerId)) continue;
    const lead = roster.find(person => person.id === state.payload.ownerId);
    if (!lead) continue;
    const priorFollowThroughs = events.filter(event => {
      const payload = intentionPayload(event);
      return payload?.intentionId === state.payload.intentionId && payload.status !== 'created';
    }).length;
    if (priorFollowThroughs >= AUTONOMY_LIMITS.followThroughsPerIntention) continue;
    const semantic = {
      roomId: room.id,
      kind: 'intention-follow-through' as const,
      leadParticipantId: lead.id,
      intentionEventId: state.event.id,
      intention: state.payload,
      roomRevision: roomRevision(room, roster),
      participantRevision: participantRevision(lead),
    };
    candidates.push({
      jobId: jobIdentity(semantic),
      roomId: room.id,
      kind: semantic.kind,
      leadParticipantId: lead.id,
      sourceEventIds: [...new Set([state.event.id, ...state.payload.sourceEventIds])],
      candidateHash: hash(semantic),
      eligibleAt: state.event.createdAt + AUTONOMY_LIMITS.followThroughDelayMs,
      activeIntentionEventId: state.event.id,
    });
  }

  // Existing unresolved commitments are legitimate causal opportunities.
  for (const [loopId, state] of openLoopStates(events)) {
    if (state.status !== 'open' || invalid.has(loopId)) continue;
    const lead = roster.find(person => person.id === state.loop.ownerId);
    if (!lead) continue;
    const event = events.find(item => item.id === loopId);
    if (!event) continue;
    const semantic = {
      roomId: room.id,
      kind: 'open-loop' as const,
      leadParticipantId: lead.id,
      loopId,
      loop: state.loop,
      roomRevision: roomRevision(room, roster),
      participantRevision: participantRevision(lead),
    };
    candidates.push({
      jobId: jobIdentity(semantic),
      roomId: room.id,
      kind: semantic.kind,
      leadParticipantId: lead.id,
      sourceEventIds: [...new Set([loopId, ...state.loop.sourceEventIds])],
      candidateHash: hash(semantic),
      eligibleAt: Math.max(event.createdAt, latestForeground.createdAt) + AUTONOMY_LIMITS.interestDelayMs,
      openLoopEventId: loopId,
    });
  }

  // A genuine agent-originated path: grounded persona/relationships plus a
  // completed real exchange may justify an intention. The exact participant
  // revision is durable provenance; the user did not assign this as a task.
  const priorCounts = new Map<string, number>();
  for (const job of world.autonomyJobs ?? []) {
    if (!terminalJob(job)) continue;
    priorCounts.set(job.leadParticipantId, (priorCounts.get(job.leadParticipantId) ?? 0) + 1);
  }
  const triggerJobs = (world.autonomyJobs ?? []).filter(job => job.candidateKind === 'agent-interest'
    && job.sourceEventIds.includes(latestForeground.id));
  const triggerProducedIntention = triggerJobs.some(job => job.status === 'committed' && job.result === 'intention');
  if (!triggerProducedIntention) {
    const exhaustedLeads = new Set(triggerJobs.filter(terminalJob).map(job => job.leadParticipantId));
    for (const lead of [...roster].sort((a, b) => (priorCounts.get(a.id) ?? 0) - (priorCounts.get(b.id) ?? 0))) {
      if (exhaustedLeads.has(lead.id)) continue;
      if (!lead.personaText.trim()) continue;
      const visible = visibleEventsFor(lead.id, foreground, lead.capabilities).slice(-AUTONOMY_LIMITS.sourceEvents);
      if (!hasRealExchange(visible)) continue;
      const sourceEventIds = visible.map(event => event.id);
      const semantic = {
        roomId: room.id,
        kind: 'agent-interest' as const,
        leadParticipantId: lead.id,
        latestForegroundEventId: latestForeground.id,
        sourceEventIds,
        roomRevision: roomRevision(room, roster),
        participantRevision: participantRevision(lead),
      };
      candidates.push({
        jobId: jobIdentity(semantic),
        roomId: room.id,
        kind: semantic.kind,
        leadParticipantId: lead.id,
        sourceEventIds,
        candidateHash: hash(semantic),
        eligibleAt: latestForeground.createdAt + AUTONOMY_LIMITS.interestDelayMs,
      });
      break;
    }
  }

  return candidates.filter(candidate => candidate.eligibleAt <= now
    && now - candidate.eligibleAt <= AUTONOMY_LIMITS.maxCatchUpAgeMs);
}

function candidateForJob(world: WorldState, room: Room, events: JournalEvent[], job: AutonomyJobRecord, now: number): Candidate | undefined {
  return enumerateCandidates(world, room, events, now).find(candidate => candidate.jobId === job.jobId
    && candidate.candidateHash === job.candidateHash);
}

function chooseCandidate(world: WorldState, room: Room, events: JournalEvent[], now: number): Candidate | undefined {
  const jobs = new Map((world.autonomyJobs ?? []).map(job => [job.jobId, job]));
  return enumerateCandidates(world, room, events, now).find(candidate => {
    const job = jobs.get(candidate.jobId);
    if (!job) return true;
    if (job.status === 'blocked') return (job.retryAt ?? 0) <= now;
    if (job.status === 'deferred') return (job.retryAt ?? 0) <= now;
    if (job.status === 'failed') return !terminalJob(job) && (job.retryAt ?? 0) <= now;
    return job.status === 'pending';
  });
}

async function stageJob(candidate: Candidate, now: number): Promise<AutonomyJobRecord> {
  return withWorldMutation(async () => {
    const world = await loadWorld();
    const existing = world.autonomyJobs?.find(job => job.jobId === candidate.jobId);
    if (existing) {
      if (existing.candidateHash !== candidate.candidateHash) throw new AutonomyConflictError('Autonomy job identity conflict');
      if (terminalJob(existing)) return existing;
      const pending: AutonomyJobRecord = {
        ...existing,
        status: 'pending',
        attempts: existing.status === 'pending' ? existing.attempts : existing.attempts + 1,
        startedAt: now,
        reason: undefined,
        retryAt: undefined,
      };
      await saveWorld({ ...world, autonomyJobs: (world.autonomyJobs ?? []).map(job => job.jobId === pending.jobId ? pending : job) });
      return pending;
    }
    const record: AutonomyJobRecord = {
      jobId: candidate.jobId,
      roomId: candidate.roomId,
      candidateKind: candidate.kind,
      leadParticipantId: candidate.leadParticipantId,
      participantIds: [candidate.leadParticipantId],
      sourceEventIds: candidate.sourceEventIds,
      candidateHash: candidate.candidateHash,
      status: 'pending',
      attempts: 1,
      createdAt: now,
      eligibleAt: candidate.eligibleAt,
      startedAt: now,
    };
    await saveWorld({ ...world, autonomyJobs: [...(world.autonomyJobs ?? []), record] });
    return record;
  });
}

async function settleJob(
  jobId: string,
  status: Exclude<AutonomyJobRecord['status'], 'pending'>,
  now: number,
  reason?: string,
  result?: AutonomyJobRecord['result'],
): Promise<void> {
  await withWorldMutation(async () => {
    const world = await loadWorld();
    const current = world.autonomyJobs?.find(job => job.jobId === jobId);
    if (!current || current.status === 'committed') return;
    const retryAt = status === 'blocked' || status === 'deferred' || (status === 'failed' && current.attempts < AUTONOMY_LIMITS.durableJobAttempts)
      ? now + AUTONOMY_LIMITS.retryBackoffMs : undefined;
    const updated: AutonomyJobRecord = {
      ...current,
      status,
      settledAt: now,
      prepared: undefined,
      ...(reason ? { reason } : {}),
      ...(result ? { result } : {}),
      ...(retryAt !== undefined ? { retryAt } : {}),
    };
    await saveWorld({ ...world, autonomyJobs: world.autonomyJobs?.map(job => job.jobId === jobId ? updated : job) });
  });
}

function parseJson(raw: string): Record<string, unknown> | null {
  const fenced = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  try {
    const parsed: unknown = JSON.parse(fenced);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function subset(values: string[], allowed: ReadonlySet<string>): boolean {
  return values.length > 0 && values.every(value => allowed.has(value));
}

function parseIntentionProposal(raw: string, allowedSources: ReadonlySet<string>): IntentionProposal | null {
  const value = parseJson(raw);
  if (!value || (value.decision !== 'wait' && value.decision !== 'intend')) return null;
  if (value.decision === 'wait') return { decision: 'wait', sourceEventIds: [] };
  const text = boundedText(value.text);
  const sourceEventIds = stringArray(value.sourceEventIds, AUTONOMY_LIMITS.sourceEvents);
  if (!text || !sourceEventIds || !subset(sourceEventIds, allowedSources)) return null;
  return { decision: 'intend', text, sourceEventIds };
}

const HUMAN_ACTION_CLAIM = /\b(?:the user|the learner|you|human)\b.{0,60}\b(?:said|spoke|agreed|promised|approved|accepted|completed|performed|joined|witnessed|decided|consented)\b/i;

function parseActionProposal(
  raw: string,
  allowedSources: ReadonlySet<string>,
  rosterIds: ReadonlySet<string>,
  leadId: string,
  eventsById: ReadonlyMap<string, JournalEvent>,
): ActionProposal | null {
  const value = parseJson(raw);
  if (!value || !['wait', 'abandon', 'act'].includes(String(value.decision))) return null;
  const decision = value.decision as ActionProposal['decision'];
  if (decision === 'wait') return {
    decision,
    sourceEventIds: [],
    referencesUserContributionEventIds: [],
    affectedParticipantIds: [],
  };
  const sourceEventIds = stringArray(value.sourceEventIds, AUTONOMY_LIMITS.sourceEvents);
  if (!sourceEventIds || !subset(sourceEventIds, allowedSources)) return null;
  const references = value.referencesUserContributionEventIds === undefined
    ? []
    : stringArray(value.referencesUserContributionEventIds, 4);
  if (references === null || !references.every(id => sourceEventIds.includes(id)
    && eventsById.get(id)?.type === 'message.user' && eventsById.get(id)?.actorId === USER_ACTOR)) return null;
  if (decision === 'abandon') {
    const text = boundedText(value.text);
    if (!text || HUMAN_ACTION_CLAIM.test(text)) return null;
    return { decision, text, sourceEventIds, referencesUserContributionEventIds: references, affectedParticipantIds: [leadId] };
  }
  const actionText = boundedText(value.actionText);
  const leadMessage = value.leadMessage === undefined ? undefined : boundedText(value.leadMessage);
  const inviteParticipantId = value.inviteParticipantId === undefined ? undefined : String(value.inviteParticipantId);
  const outcome = value.outcome;
  const revisedIntentionText = value.revisedIntentionText === undefined ? undefined : boundedText(value.revisedIntentionText);
  const affectedParticipantIds = stringArray(value.affectedParticipantIds, AUTONOMY_LIMITS.participantsPerEpisode);
  if (!actionText || (outcome !== 'pursued' && outcome !== 'revised' && outcome !== 'completed')) return null;
  if (inviteParticipantId !== undefined && (!rosterIds.has(inviteParticipantId) || inviteParticipantId === leadId || !leadMessage)) return null;
  if (revisedIntentionText === undefined && outcome === 'revised') return null;
  if (!affectedParticipantIds || !affectedParticipantIds.includes(leadId)) return null;
  const permittedAffected = new Set([leadId, ...(inviteParticipantId ? [inviteParticipantId] : [])]);
  if (!affectedParticipantIds.every(id => permittedAffected.has(id))) return null;
  if ([actionText, leadMessage, revisedIntentionText].some(text => text && HUMAN_ACTION_CLAIM.test(text))) return null;
  return {
    decision,
    actionText,
    leadMessage,
    inviteParticipantId,
    outcome,
    revisedIntentionText,
    sourceEventIds,
    referencesUserContributionEventIds: references,
    affectedParticipantIds,
  };
}

function parseParticipantReply(raw: string): ParticipantReply | null {
  const value = parseJson(raw);
  if (!value || (value.decision !== 'accept' && value.decision !== 'decline')) return null;
  const responseText = boundedText(value.responseText);
  if (!responseText || HUMAN_ACTION_CLAIM.test(responseText)) return null;
  return { decision: value.decision, responseText };
}

function eventText(event: JournalEvent): string | undefined {
  if (!isRecord(event.payload)) return undefined;
  const text = event.payload.text ?? event.payload.summary;
  return typeof text === 'string' ? text : undefined;
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
    recentEvents: context.recentThreadEvents.slice(-12),
  };
}

function makePrompt(value: unknown): string {
  const prompt = JSON.stringify(value);
  if (prompt.length > AUTONOMY_LIMITS.inputCharacters) throw new Error('Autonomy input exceeds its context budget');
  return prompt;
}

async function validModelOutput<T>(
  prompt: string,
  participantId: string,
  llmFn: AutonomyDependencies['llmFn'],
  parse: (raw: string) => T | null,
): Promise<T | null> {
  for (let attempt = 0; attempt < AUTONOMY_LIMITS.modelRepairAttempts; attempt++) {
    const request = attempt === 0 ? prompt : JSON.stringify({
      ...(JSON.parse(prompt) as Record<string, unknown>),
      repair: 'The previous response was invalid. Return only one strict JSON object matching outputSchema and validExample. Use exact string event/participant ids, use arrays where shown, and omit optional fields instead of null. Do not copy instruction text into content fields.',
    });
    if (request.length > AUTONOMY_LIMITS.inputCharacters) return null;
    const raw = await llmFn(request, participantId);
    if (raw.length > AUTONOMY_LIMITS.outputCharacters) continue;
    const parsed = parse(raw);
    if (parsed !== null) return parsed;
  }
  return null;
}

function compileFor(person: Participant, room: Room, participants: Participant[], events: JournalEvent[], turn: string): CompiledContext {
  return compileContext({
    room,
    participant: person,
    participants,
    seaEvents: events,
    threadEvents: events,
    turn: { text: turn },
  });
}

function leaksPrivateSourceText(proposal: ActionProposal, leadView: JournalEvent[], inviteeView: JournalEvent[]): boolean {
  const inviteeIds = new Set(inviteeView.map(event => event.id));
  const sharedText = [proposal.actionText, proposal.leadMessage].filter((value): value is string => Boolean(value)).join('\n').toLocaleLowerCase();
  return leadView.some(event => {
    if (inviteeIds.has(event.id) || (event.type !== 'disclosure' && event.type !== 'memory.belief')) return false;
    const privateText = eventText(event)?.trim().toLocaleLowerCase();
    return privateText !== undefined && privateText.length >= 16 && sharedText.includes(privateText);
  });
}

function intentionPrompt(
  candidate: Candidate,
  lead: Participant,
  context: CompiledContext,
  sources: JournalEvent[],
): string {
  return makePrompt({
    task: 'Decide whether this person independently develops one ordinary, bounded Room-scoped intention from their own grounded interests, relationships, circumstances, or prior experience. If their entitled sources express a personal interest and establish a harmless practical opportunity, intend is appropriate; wait when personal grounding or a safe opportunity is absent. Do not transform a user reminder into an intention. Do not act yet. No external real-world actions and no new cast.',
    participantId: lead.id,
    candidateKind: candidate.kind,
    perspective: promptContext(context),
    eligibleSources: sources.map(event => ({ id: event.id, type: event.type, actorId: event.actorId, text: eventText(event), createdAt: event.createdAt })),
    outputSchema: {
      decision: 'wait | intend',
      text: 'required only for intend; first-person-neutral description of this person own intention',
      sourceEventIds: 'required only for intend; one or more exact eligible source ids',
    },
    validExample: {
      decision: 'intend',
      text: `${lead.displayName} intends to take one grounded ordinary step.`,
      sourceEventIds: [sources[0]?.id ?? '<exact-eligible-source-id>'],
    },
  });
}

function actionPrompt(
  candidate: Candidate,
  lead: Participant,
  context: CompiledContext,
  sources: JournalEvent[],
  roster: Participant[],
  processingAt: number,
): string {
  return makePrompt({
    task: 'Decide whether to wait, abandon, or take one ordinary bounded simulated Room action toward the active intention. If the established Room circumstances support a harmless concrete step now, act is appropriate; wait only when a concrete constraint or lack of grounding makes action unwarranted. Organizing or discussing established Room objects is permitted fictional activity, not an external real-world action. actionText describes only publicly observable action: never copy or paraphrase private thoughts/disclosures into actionText or leadMessage. The user is absent: never make the user speak, agree, promise, witness, approve, consent, or perform anything. You may reference an actual user contribution only by citing its message.user event id. Do not mutate another person private state, create people, contact the user, send notifications, or perform an external real-world action.',
    participantId: lead.id,
    candidateKind: candidate.kind,
    opportunity: { eligibleAt: candidate.eligibleAt, processingAt },
    perspective: promptContext(context),
    availableOtherParticipants: roster.filter(person => person.id !== lead.id).map(person => ({ id: person.id, name: person.displayName })),
    eligibleSources: sources.map(event => ({ id: event.id, type: event.type, actorId: event.actorId, text: eventText(event), createdAt: event.createdAt })),
    outputSchema: {
      decision: 'wait | abandon | act',
      text: 'required for abandon',
      actionText: 'required for act; publicly observable past-tense action by the lead, preferably a verb phrase without repeating the lead name',
      leadMessage: 'required when inviteParticipantId is present; what the lead directly says to that participant',
      inviteParticipantId: 'optional exact id of one available participant; never user',
      outcome: 'required for act: pursued | revised | completed',
      revisedIntentionText: 'required when outcome is revised',
      sourceEventIds: 'required for abandon/act; exact eligible ids including the active intention',
      referencesUserContributionEventIds: 'optional exact cited message.user ids; this never makes the user an episode actor or witness',
      affectedParticipantIds: 'required exact ids whose state the action affects; must include the lead and may include only the invited participant',
    },
    validExample: {
      decision: 'act',
      actionText: 'organized the established Room materials for one bounded step.',
      ...(roster.find(person => person.id !== lead.id) ? {
        leadMessage: 'Would you help with this one bounded step?',
        inviteParticipantId: roster.find(person => person.id !== lead.id)!.id,
      } : {}),
      outcome: 'pursued',
      sourceEventIds: sources.slice(0, 2).map(event => event.id),
      referencesUserContributionEventIds: [],
      affectedParticipantIds: [lead.id, ...roster.filter(person => person.id !== lead.id).slice(0, 1).map(person => person.id)],
    },
  });
}

function replyPrompt(person: Participant, context: CompiledContext, lead: Participant, proposal: ActionProposal): string {
  return makePrompt({
    task: `From only ${person.displayName}'s entitled perspective, accept or decline the direct proposal below and give one short in-character response. Do not claim the absent user spoke, agreed, witnessed, approved, or acted. Do not mutate anyone else's private state.`,
    participantId: person.id,
    perspective: promptContext(context),
    proposalFrom: { id: lead.id, name: lead.displayName, message: proposal.leadMessage },
    outputSchema: { decision: 'accept | decline', responseText: 'required short direct response' },
    validExample: { decision: 'accept', responseText: 'Yes, I can help with that step.' },
  });
}

function intentionDraft(job: AutonomyJobRecord, lead: Participant, proposal: IntentionProposal): JournalEventDraft {
  const intentionId = `intention_${job.jobId.slice('autonomy_'.length)}`;
  const payload: IntentionPayload = {
    intentionId,
    ownerId: lead.id,
    status: 'created',
    text: proposal.text!,
    sourceEventIds: [...new Set([...job.sourceEventIds, ...proposal.sourceEventIds])],
    groundingRefs: [`participant:${lead.id}:${participantRevision(lead)}`],
  };
  return {
    roomId: job.roomId,
    scope: { kind: 'sea' },
    type: 'intention',
    actorId: lead.id,
    witnesses: [lead.id],
    payload,
    provenance: { autonomyJobId: job.jobId },
  };
}

function leadActionSummary(lead: Participant, actionText: string): string {
  const text = actionText.trim();
  if (text.toLocaleLowerCase().startsWith(`${lead.displayName.toLocaleLowerCase()} `)) return text;
  if (/^i\s+/i.test(text)) return `${lead.displayName} ${text.replace(/^i\s+/i, '')}`;
  return `${lead.displayName} ${text}`;
}

function actionDrafts(
  job: AutonomyJobRecord,
  lead: Participant,
  activeEvent: JournalEvent,
  proposal: ActionProposal,
  reply: ParticipantReply | undefined,
  invitee: Participant | undefined,
  now: number,
): JournalEventDraft[] {
  const active = intentionPayload(activeEvent);
  if (!active) throw new AutonomyConflictError('Active intention disappeared');
  const episodeParticipants = invitee ? [lead.id, invitee.id] : [lead.id];
  const sourceEventIds = [...new Set([
    activeEvent.id,
    ...active.sourceEventIds,
    ...proposal.sourceEventIds,
    ...proposal.referencesUserContributionEventIds,
  ])];
  const drafts: JournalEventDraft[] = [];
  if (invitee && proposal.leadMessage) {
    drafts.push({
      roomId: job.roomId,
      scope: { kind: 'sea' },
      type: 'message.character',
      actorId: lead.id,
      witnesses: episodeParticipants,
      payload: { text: proposal.leadMessage, modality: 'text' } satisfies MessagePayload,
      provenance: { autonomyJobId: job.jobId },
    });
    drafts.push({
      roomId: job.roomId,
      scope: { kind: 'sea' },
      type: 'message.character',
      actorId: invitee.id,
      witnesses: episodeParticipants,
      payload: { text: reply!.responseText, modality: 'text' } satisfies MessagePayload,
      provenance: { autonomyJobId: job.jobId },
    });
  }
  const declined = reply?.decision === 'decline';
  const actionActors = invitee && !declined ? episodeParticipants : [lead.id];
  const outcome: Exclude<IntentionStatus, 'created'> = declined ? 'revised' : proposal.outcome!;
  const leadAction = leadActionSummary(lead, proposal.actionText!);
  const summary = declined
    ? `${leadAction.replace(/[.!?]+$/, '')}; ${invitee!.displayName} declined the proposal.`
    : leadAction;
  const occurrence: SimulatedOccurrencePayload = {
    authority: 'simulated-occurrence',
    operationId: job.jobId,
    summary,
    actorIds: actionActors,
    sourceEventIds,
    intentionId: active.intentionId,
    outcome,
    effectiveAt: now,
  };
  drafts.push({
    roomId: job.roomId,
    scope: { kind: 'sea' },
    type: 'occurrence.simulated',
    actorId: lead.id,
    witnesses: episodeParticipants,
    payload: occurrence,
    provenance: { autonomyJobId: job.jobId },
  });
  const lifecycle: IntentionPayload = {
    ...active,
    status: outcome,
    text: declined
      ? `${active.text} (reconsider after ${invitee!.displayName} declined)`
      : proposal.revisedIntentionText ?? active.text,
    sourceEventIds,
    previousEventId: activeEvent.id,
  };
  drafts.push({
    roomId: job.roomId,
    scope: { kind: 'sea' },
    type: 'intention',
    actorId: lead.id,
    witnesses: [lead.id],
    payload: lifecycle,
    provenance: { autonomyJobId: job.jobId },
  });
  return drafts;
}

function abandonDraft(job: AutonomyJobRecord, lead: Participant, activeEvent: JournalEvent, proposal: ActionProposal): JournalEventDraft {
  const active = intentionPayload(activeEvent);
  if (!active) throw new AutonomyConflictError('Active intention disappeared');
  const payload: IntentionPayload = {
    ...active,
    status: 'abandoned',
    text: proposal.text!,
    sourceEventIds: [...new Set([activeEvent.id, ...proposal.sourceEventIds])],
    previousEventId: activeEvent.id,
  };
  return {
    roomId: job.roomId,
    scope: { kind: 'sea' },
    type: 'intention',
    actorId: lead.id,
    witnesses: [lead.id],
    payload,
    provenance: { autonomyJobId: job.jobId },
  };
}

function draftMatches(draft: JournalEventDraft, event: JournalEvent): boolean {
  return event.roomId === draft.roomId
    && event.type === draft.type
    && event.actorId === draft.actorId
    && JSON.stringify(event.scope) === JSON.stringify(draft.scope)
    && JSON.stringify(event.witnesses) === JSON.stringify(draft.witnesses)
    && JSON.stringify(event.payload) === JSON.stringify(draft.payload)
    && event.provenance?.autonomyJobId === draft.provenance?.autonomyJobId;
}

async function prepareJob(
  jobId: string,
  drafts: JournalEventDraft[],
  participantIds: string[],
  contextHashes: Record<string, string>,
  result: AutonomyJobRecord['result'],
  now: number,
): Promise<void> {
  await withWorldMutation(async () => {
    const world = await loadWorld();
    const current = world.autonomyJobs?.find(job => job.jobId === jobId);
    if (!current || current.status !== 'pending') throw new AutonomyConflictError('Autonomy job was cancelled');
    const room = world.rooms.find(item => item.id === current.roomId);
    if (!room) throw new AutonomyConflictError('Autonomy Room disappeared');
    const events = await readSeaProjection(room.id);
    if (!candidateForJob(world, room, events, current, now)) throw new AutonomyConflictError('Autonomy prerequisite changed');
    const updated: AutonomyJobRecord = {
      ...current,
      participantIds,
      participantContextHashes: contextHashes,
      result,
      prepared: { expectedDrafts: drafts },
    };
    await saveWorld({ ...world, autonomyJobs: world.autonomyJobs?.map(job => job.jobId === jobId ? updated : job) });
  });
}

async function publishPreparedJob(jobId: string, now: number): Promise<boolean> {
  return withWorldMutation(async () => {
    const world = await loadWorld();
    const current = world.autonomyJobs?.find(job => job.jobId === jobId);
    if (!current) return false;
    if (current.status === 'committed') return true;
    if (current.status !== 'pending' || !current.prepared) return false;
    const settings = loadSettings();
    if (!settingsAllowAutonomy(settings)) {
      const cancelled = { ...current, status: 'cancelled' as const, settledAt: now, reason: 'Autonomy was paused before commit', prepared: undefined };
      await saveWorld({ ...world, autonomyJobs: world.autonomyJobs?.map(job => job.jobId === jobId ? cancelled : job) });
      return false;
    }
    const room = world.rooms.find(item => item.id === current.roomId);
    const events = room ? await readSeaProjection(room.id) : [];
    if (!room || !candidateForJob(world, room, events, current, now)) {
      const cancelled = { ...current, status: 'cancelled' as const, settledAt: now, reason: 'Autonomy prerequisite changed before commit', prepared: undefined };
      await saveWorld({ ...world, autonomyJobs: world.autonomyJobs?.map(job => job.jobId === jobId ? cancelled : job) });
      return false;
    }
    const rows = await readPreparedAutonomyEvents(current.roomId, jobId);
    if (rows.length > current.prepared.expectedDrafts.length
      || rows.some((row, index) => !draftMatches(current.prepared!.expectedDrafts[index], row))) {
      throw new AutonomyConflictError('Prepared autonomous occurrence is inconsistent');
    }
    const publishedRows = [...rows];
    for (const draft of current.prepared.expectedDrafts.slice(rows.length)) {
      publishedRows.push(await appendEvent(current.roomId, draft));
    }
    // Foreground journal work can race the entity queue. Re-read canonical
    // state immediately before the atomic status transition.
    const latestWorld = await loadWorld();
    const latestRoom = latestWorld.rooms.find(item => item.id === current.roomId);
    const latestEvents = latestRoom ? await readSeaProjection(latestRoom.id) : [];
    if (!latestRoom || !candidateForJob(latestWorld, latestRoom, latestEvents, current, now)) {
      const cancelled = { ...current, status: 'cancelled' as const, settledAt: now, reason: 'Autonomy prerequisite changed during publication', prepared: undefined };
      await saveWorld({ ...latestWorld, autonomyJobs: latestWorld.autonomyJobs?.map(job => job.jobId === jobId ? cancelled : job) });
      return false;
    }
    const committed: AutonomyJobRecord = {
      ...current,
      status: 'committed',
      settledAt: now,
      eventIds: publishedRows.map(event => event.id),
      prepared: undefined,
    };
    await saveWorld({ ...latestWorld, autonomyJobs: latestWorld.autonomyJobs?.map(job => job.jobId === jobId ? committed : job) });
    return true;
  });
}

async function runJob(job: AutonomyJobRecord, candidate: Candidate, deps: AutonomyDependencies, now: number): Promise<AutonomyPassResult> {
  const world = await loadWorld();
  const room = world.rooms.find(item => item.id === job.roomId);
  const roster = room?.participantIds.map(id => world.participants.find(person => person.id === id && person.kind === 'persistent'))
    .filter((person): person is Participant => person !== undefined)
    .slice(0, AUTONOMY_LIMITS.peopleConsideredPerRoom) ?? [];
  const lead = roster.find(person => person.id === job.leadParticipantId);
  const events = room ? await readSeaProjection(room.id) : [];
  if (!room || !lead || !candidateForJob(world, room, events, job, now)) {
    await settleJob(job.jobId, 'cancelled', now, 'Autonomy prerequisite changed before inference');
    return { kind: 'cancelled', jobId: job.jobId };
  }
  const visible = visibleEventsFor(lead.id, events, lead.capabilities);
  const sourceSet = new Set(candidate.sourceEventIds);
  const sources = visible.filter(event => sourceSet.has(event.id));
  if (sources.length !== sourceSet.size) {
    await settleJob(job.jobId, 'cancelled', now, 'Lead participant no longer has access to every causal source');
    return { kind: 'cancelled', jobId: job.jobId };
  }
  const context = compileFor(lead, room, roster, events, 'bounded autonomous living-world decision');
  const contextHashes: Record<string, string> = { [lead.id]: hash(context) };
  let publicationPrepared = false;
  try {
    if (candidate.kind !== 'intention-follow-through') {
      const prompt = intentionPrompt(candidate, lead, context, sources);
      const proposal = await validModelOutput(prompt, lead.id, deps.llmFn, raw => parseIntentionProposal(raw, sourceSet));
      if (!proposal) throw new Error('No valid autonomous intention output within the repair bound');
      if (proposal.decision === 'wait') {
        const finalWait = job.attempts >= AUTONOMY_LIMITS.durableJobAttempts;
        await settleJob(job.jobId, finalWait ? 'skipped' : 'deferred', now, 'The grounded participant decided to wait.', 'nothing');
        return { kind: finalWait ? 'skipped' : 'deferred', jobId: job.jobId };
      }
      await prepareJob(job.jobId, [intentionDraft(job, lead, proposal)], [lead.id], contextHashes, 'intention', now);
      publicationPrepared = true;
      const committed = await publishPreparedJob(job.jobId, now);
      return { kind: committed ? 'committed' : 'cancelled', jobId: job.jobId };
    }

    const activeEvent = events.find(event => event.id === candidate.activeIntentionEventId);
    if (!activeEvent) throw new AutonomyConflictError('Active intention source is missing');
    const actionSources = [...new Set([...sources, activeEvent].map(event => event.id))];
    const actionSourceSet = new Set(actionSources);
    const actionPromptText = actionPrompt(candidate, lead, context, visible.filter(event => actionSourceSet.has(event.id)), roster, now);
    const proposal = await validModelOutput(actionPromptText, lead.id, deps.llmFn, raw => {
      const parsed = parseActionProposal(raw, actionSourceSet, new Set(roster.map(person => person.id)), lead.id, new Map(events.map(event => [event.id, event])));
      if (!parsed?.inviteParticipantId) return parsed;
      const proposedInvitee = roster.find(person => person.id === parsed.inviteParticipantId);
      if (!proposedInvitee) return null;
      const inviteeView = visibleEventsFor(proposedInvitee.id, events, proposedInvitee.capabilities);
      return leaksPrivateSourceText(parsed, visible, inviteeView) ? null : parsed;
    });
    if (!proposal) throw new Error('No valid autonomous action output within the repair bound');
    if (proposal.decision === 'wait') {
      const finalWait = job.attempts >= AUTONOMY_LIMITS.durableJobAttempts;
      await settleJob(job.jobId, finalWait ? 'skipped' : 'deferred', now, 'The participant decided this was not the right time.', 'nothing');
      return { kind: finalWait ? 'skipped' : 'deferred', jobId: job.jobId };
    }
    if (proposal.decision === 'abandon') {
      await prepareJob(job.jobId, [abandonDraft(job, lead, activeEvent, proposal)], [lead.id], contextHashes, 'intention', now);
      publicationPrepared = true;
      const committed = await publishPreparedJob(job.jobId, now);
      return { kind: committed ? 'committed' : 'cancelled', jobId: job.jobId };
    }

    let invitee: Participant | undefined;
    let reply: ParticipantReply | undefined;
    if (proposal.inviteParticipantId) {
      invitee = roster.find(person => person.id === proposal.inviteParticipantId);
      if (!invitee) throw new AutonomyConflictError('Proposed participant is unavailable');
      const inviteeContext = compileFor(invitee, room, roster, events, proposal.leadMessage!);
      contextHashes[invitee.id] = hash(inviteeContext);
      reply = await validModelOutput(replyPrompt(invitee, inviteeContext, lead, proposal), invitee.id, deps.llmFn, parseParticipantReply) ?? undefined;
      if (!reply) throw new Error('No valid autonomous participant response within the repair bound');
    }
    const drafts = actionDrafts(job, lead, activeEvent, proposal, reply, invitee, now);
    await prepareJob(job.jobId, drafts, invitee ? [lead.id, invitee.id] : [lead.id], contextHashes, 'episode', now);
    publicationPrepared = true;
    const committed = await publishPreparedJob(job.jobId, now);
    return { kind: committed ? 'committed' : 'cancelled', jobId: job.jobId };
  } catch (error) {
    if (publicationPrepared) {
      // Validated drafts remain pending and hidden. Startup/retry resumes the
      // exact publication; re-inference would risk a duplicate episode.
      return { kind: 'failed', jobId: job.jobId };
    }
    if (error instanceof AutonomyConflictError) {
      await settleJob(job.jobId, 'cancelled', now, error.message);
      return { kind: 'cancelled', jobId: job.jobId };
    }
    await settleJob(job.jobId, 'failed', now, error instanceof Error ? error.message : 'Autonomy inference failed');
    return { kind: 'failed', jobId: job.jobId };
  }
}

/** Deterministic eligibility + one bounded durable job. */
async function runAutonomyPassOnce(roomId: string, deps: AutonomyDependencies): Promise<AutonomyPassResult> {
  const now = deps.now ?? Date.now();
  const getSettings = deps.getSettings ?? loadSettings;
  const settings = getSettings();
  if (!livingWorldEnabled(settings) || !(settings.worldAutonomyEnabled ?? DEFAULT_SETTINGS.worldAutonomyEnabled)) return { kind: 'waiting' };

  const world = await loadWorld();
  const room = world.rooms.find(item => item.id === roomId);
  if (!room) return { kind: 'waiting' };

  // Prepared jobs have priority: recovery never re-infers or creates a second
  // episode. Publication still revalidates consent and causal prerequisites.
  const prepared = world.autonomyJobs?.find(job => job.roomId === roomId && job.status === 'pending' && job.prepared);
  if (prepared) {
    const committed = await publishPreparedJob(prepared.jobId, now);
    return { kind: committed ? 'committed' : 'cancelled', jobId: prepared.jobId };
  }

  const events = await readSeaProjection(roomId);
  const candidate = chooseCandidate(world, room, events, now);
  if (!candidate) return { kind: 'waiting' };
  let job = await stageJob(candidate, now);
  if (terminalJob(job)) return { kind: job.status === 'committed' ? 'committed' : 'skipped', jobId: job.jobId };

  const currentSettings = getSettings();
  if (!settingsAllowAutonomy(currentSettings) || !deps.policy.isPermitted('autonomy')) {
    await settleJob(job.jobId, 'blocked', now, 'Autonomy is waiting for permitted inference resources.');
    return { kind: 'blocked', jobId: job.jobId };
  }
  // stageJob may have resumed a blocked/failed row; reload its durable attempt.
  job = (await loadWorld()).autonomyJobs?.find(item => item.jobId === job.jobId) ?? job;
  return runJob(job, candidate, deps, now);
}

const activeRoomPasses = new Map<string, Promise<AutonomyPassResult>>();

/** Multiple scheduler/lifecycle triggers for one Room join the same main-owned
 * pass. They cannot independently infer or publish duplicate work. */
export function runAutonomyPass(roomId: string, deps: AutonomyDependencies): Promise<AutonomyPassResult> {
  const running = activeRoomPasses.get(roomId);
  if (running) return running;
  const result = runAutonomyPassOnce(roomId, deps).finally(() => activeRoomPasses.delete(roomId));
  activeRoomPasses.set(roomId, result);
  return result;
}

/** Startup recovery publishes only already-validated drafts. Jobs interrupted
 * before validation remain durable and are reconsidered by the next bounded
 * scheduler pass; no inference is claimed while the app was terminated. */
export async function reconcilePendingAutonomy(now = Date.now()): Promise<string[]> {
  const settings = loadSettings();
  if (!livingWorldEnabled(settings) || !(settings.worldAutonomyEnabled ?? DEFAULT_SETTINGS.worldAutonomyEnabled)) return [];
  const world = await loadWorld();
  const committed: string[] = [];
  for (const job of (world.autonomyJobs ?? []).filter(item => item.status === 'pending' && item.prepared)) {
    if (await publishPreparedJob(job.jobId, now)) committed.push(job.jobId);
  }
  return committed;
}

/** Tests and process verifiers use this to assert exact operation replay. */
export const autonomyInternals = {
  enumerateCandidates,
  parseIntentionProposal,
  parseActionProposal,
  parseParticipantReply,
  draftMatches,
};
