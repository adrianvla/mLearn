/**
 * World model — conversational runtime overhaul ("Sea / Thread" architecture).
 *
 * Contract source: .sisyphus/plans/conversational-runtime-overhaul.md §4.
 * These types are the shared contract between the main-process journal/world
 * stores, the renderer orchestrator, and every later phase (memory v2, Dreamer,
 * proactivity, Scenario Director). Extend as phases land; do not fork.
 */

// ---------------------------------------------------------------------------
// Event journal
// ---------------------------------------------------------------------------

/** Retention scope. Sea ⟹ durable; Thread ⟹ disposable. Distinct from `witnesses`. */
export type EventScope = { kind: 'sea' } | { kind: 'thread'; threadId: string };

export type EventType =
  | 'message.user'
  | 'message.character'
  | 'memory.belief'
  | 'disclosure'
  | 'resolution'
  | 'schedule'
  | 'membership'
  | 'consolidation'
  | 'deletion'
  | 'integration'
  | 'proactive_requested'
  | 'proactive_fulfilled'
  | 'call_initiated'
  | 'call_accepted'
  | 'call_declined'
  | 'call_missed'
  | 'call_ended'
  | 'correction'
  | 'safety_flag'
  | 'scenario_evolved'
  | 'intention'
  | 'occurrence.simulated';

/** Reserved actor ids. Anything else is a Participant id. */
export const USER_ACTOR = 'user';
export const HARNESS_ACTOR = 'harness';
/** World continuity journal context; this is not a persistent Room. */
export const WORLD_CONTINUITY_ID = 'world-continuity';

export interface JournalEvent {
  id: string; // evt_<unique>
  seq: number; // per-stream monotonic (Sea stream and each Thread stream sequence independently)
  roomId: string;
  scope: EventScope;
  type: EventType;
  actorId: string; // USER_ACTOR | participantId | HARNESS_ACTOR
  witnesses: string[]; // explicit epistemic set; NOT derived from room membership
  payload: unknown; // type-specific
  createdAt: number;
  provenance?: {
    sourceThreadEventIds?: string[];
    integrationId?: string;
    stagedIntegration?: boolean;
    reflectionId?: string;
    /** Main-owned V09 autonomous occurrence operation. Rows remain hidden
     *  until the matching durable job reaches committed status. */
    autonomyJobId?: string;
  };
}

/** What callers supply; the journal assigns id/seq/createdAt. */
export type JournalEventDraft = Omit<JournalEvent, 'id' | 'seq' | 'createdAt'>;

// ---------------------------------------------------------------------------
// Event payload contracts (consumer-side; JournalEvent.payload stays unknown)
// ---------------------------------------------------------------------------

/** 'membership' — harness-recorded roster change; drives compiler absence intervals. */
export interface MembershipPayload {
  participantId: string;
  action: 'added' | 'removed';
}

/** 'message.user' / 'message.character'. */
export interface MessagePayload {
  text: string;
  widget?: unknown;
  widgets?: unknown[];
  modality?: 'text' | 'voice';
  replyToEventId?: string;
}

/** 'memory.belief' — carries every MemoryEntry kind despite the event-type name. */
export interface MemoryEventPayload {
  ownerId: string;
  kind: MemoryEntry['kind'];
  text: string;
  sourceMemoryId?: string;
  sourceEventIds?: string[];
  /** Prior derived personal state exposed to the inference. These are causal
   *  dependencies, not direct evidence and never widen witness authority. */
  dependencyEventIds?: string[];
  /** kind 'relationship' only: directional edge target + label (D5). */
  toId?: string;
  label?: string;
  /** kind 'belief' only, reflection-derived rows: this interpretation replaces
   *  the owner's earlier derived belief (semantic supersession; the replaced
   *  row stays in journal history but leaves the projection). */
  supersedesEventId?: string;
}

/** Terminal states a grounded resolution can give an open loop. */
export type LoopResolutionStatus = 'satisfied' | 'cancelled' | 'contradicted' | 'superseded';

/** 'resolution' — a participant's grounded close-out of an open loop they own.
 *  The loop row itself is history; this row is what changes its current state. */
export interface ResolutionPayload {
  ownerId: string;
  text: string;
  sourceEventIds: string[];
  /** Prior derived personal state used as context for this resolution. */
  dependencyEventIds?: string[];
  /** Open-loop memory event this resolution closes. Absent = free resolution note. */
  loopId?: string;
  /** Required when loopId is present; how the loop ends. */
  status?: LoopResolutionStatus;
}

/** 'consolidation' — Dreamer window marker; idempotency key for consolidation runs. */
export interface ConsolidationPayload {
  /** Which maintenance pass produced this marker; absent = reflection (the original format). */
  kind?: 'reflection' | 'scenario';
  windowStart: number; // first source sequence in this stream
  windowEnd: number; // last source sequence in this stream
  producedEventIds: string[]; // beliefs/resolutions this run appended (audit + resume)
}

/** 'proactive_requested' / 'proactive_fulfilled' — v1 fulfills from pre-authorized text only. */
export interface ProactivePayload {
  candidateId: string; // ProjectionStore candidate; intent piggybacked on normal inference
  text?: string; // pre-authorized text; absent candidate → drop ("nothing meaningful → nothing")
  messageEventId?: string; // fulfilled only — the message.character event it produced
}

/** 'call_initiated' / 'call_accepted' / 'call_declined' / 'call_missed' / 'call_ended' (D19+). */
export interface CallPayload {
  callId: string;
  reason?: string;
}

/** 'correction' — checker output on a user message; folded into the referenced message's display. */
export interface CorrectionPayload {
  messageEventId: string;
  corrections: unknown[]; // MistakeWidgetData[] — kept opaque here to avoid shared/type coupling
}

/** 'safety_flag' — checker safety verdict on any message; drives the safety lock UI. */
export interface SafetyFlagPayload {
  messageEventId: string;
  flag: unknown; // ConversationSafetyFlag — kept opaque here to avoid shared/type coupling
}

/** 'schedule' — a pending proactive intent; the main-process scheduler consumes these. */
export interface SchedulePayload {
  candidateId: string; // idempotency anchor — a fulfilled candidateId is never re-fired
  kind: 'message' | 'call';
  participantId: string;
  fireAt: number;
  text?: string; // pre-authorized text piggybacked on normal inference
  score?: number; // intent score from normal cognition; re-checked at fire time
  lastFiredAt?: number; // cooldown input
}

// ---------------------------------------------------------------------------
// V09 autonomous lives
// ---------------------------------------------------------------------------

export type IntentionStatus = 'created' | 'pursued' | 'revised' | 'completed' | 'abandoned';

/** 'intention' — durable state owned by one simulated individual. This is a
 *  supported decision/state transition, not an occurrence attributed to the
 *  human user and not permission for an external real-world action. */
export interface IntentionPayload {
  intentionId: string;
  ownerId: string;
  status: IntentionStatus;
  text: string;
  sourceEventIds: string[];
  previousEventId?: string;
  /** Stable grounding references let an interest-originated intention cite
   *  the exact participant revision without pretending persona prose is an
   *  observed event. */
  groundingRefs: string[];
}

/** 'occurrence.simulated' — an authoritative fictional Room occurrence
 * committed by the V09 validator. `actorIds` and journal witnesses are
 * code-owned; model output cannot add the user or an absent participant. */
export interface SimulatedOccurrencePayload {
  authority: 'simulated-occurrence';
  operationId: string;
  summary: string;
  actorIds: string[];
  sourceEventIds: string[];
  intentionId: string;
  outcome: Exclude<IntentionStatus, 'created'>;
  /** Fictional occurrence time. Recording/processing time remains the
   * JournalEvent.createdAt assigned by the journal writer. */
  effectiveAt: number;
}

export type AutonomyCandidateKind = 'agent-interest' | 'open-loop' | 'intention-follow-through';

/** Main-owned durable V09 work record. A pending job may hold validated
 * publication drafts, but its journal rows remain non-canonical until the
 * atomic world.json status transition to committed. */
export interface AutonomyJobRecord {
  jobId: string;
  roomId: string;
  candidateKind: AutonomyCandidateKind;
  leadParticipantId: string;
  participantIds: string[];
  sourceEventIds: string[];
  candidateHash: string;
  status: 'pending' | 'blocked' | 'deferred' | 'committed' | 'cancelled' | 'failed' | 'skipped';
  attempts: number;
  createdAt: number;
  eligibleAt: number;
  startedAt?: number;
  settledAt?: number;
  retryAt?: number;
  reason?: string;
  result?: 'intention' | 'episode' | 'nothing';
  /** Exact rows certified by the atomic committed transition. A row merely
   * claiming this job id is never canonical unless its id is listed here. */
  eventIds?: string[];
  participantContextHashes?: Record<string, string>;
  /** Private validated publication, removed at terminal settlement and never
   * sent to renderers. */
  prepared?: { expectedDrafts: JournalEventDraft[] };
}

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------

export interface Room {
  /** Persistent situation; survives individual encounters and Room return. */
  scenario?: ScenarioSpec;
  scenarioRef?: string;
  id: string;
  title: string; // auto-named from participants; sticky once user-renamed
  titleUserSet?: boolean;
  participantIds: string[];
  cultureRef?: string; // room-culture document id (later phases)
  unreadCount?: number; // proactive delivery while room window closed (Q3)
  /** Creation retry identity; a retried persistent creation returns this Room instead of duplicating it. */
  createdByOperation?: string;
  createdAt: number;
}

/** Media a thread was launched from — thread-scoped context, not a global signal. */
export interface ThreadMediaRef {
  mediaHash: string;
  mediaName: string;
  mediaType: 'video' | 'book';
  assessedLevelName?: string;
  subtitleHistory?: string[];
  characterContext?: string;
}

export interface Thread {
  id: string;
  roomId?: string;
  title?: string;
  scenarioRef?: string;
  scenario?: ScenarioSpec;
  intent?: string;
  mediaRef?: ThreadMediaRef;
  state: 'active' | 'archived' | 'integrated';
  createdAt: number;
  /** A durable sandbox has its own cast, never permanent Room membership. */
  sandbox?: {
    operationId: string;
    requestHash: string;
    bindings: { originId?: string; baseline: Participant; localOverride?: Participant }[];
    /** Pin lived history without duplicating private journal payloads. */
    baselineHeads: Record<string, number>;
  };
}

export interface CreateCastInput {
  operationId: string;
  participantIds: string[];
  intent?: string;
  title?: string;
  /** Absent = disposable practice sandbox. 'persistent' publishes a permanent Room. */
  scope?: 'persistent';
}

export type ScenarioActivation = Room | Thread;

export interface ScenarioCreation {
  operationId: string;
  requestHash: string;
  request: CreateCastInput;
  status: 'generating' | 'ready' | 'failed' | 'cancelled' | 'activated';
  origin: 'generated';
  createdAt: number;
  bindings: NonNullable<Thread['sandbox']>['bindings'];
  baselineHeads: Record<string, number>;
  scenario?: ScenarioSpec;
  error?: string;
  threadId?: string;
  roomId?: string;
}

/** Journal context key; an independent sandbox does not require a Room. */
export function threadContextId(thread: Thread): string {
  return thread.sandbox ? thread.id : (thread.roomId ?? thread.id);
}

export function threadParticipants(thread: Thread, participants: Participant[]): Participant[] {
  return thread.sandbox
    ? thread.sandbox.bindings.map(binding => binding.localOverride ?? binding.baseline)
    : participants;
}

/** Transient roster view for the shared turn engine, not a stored Room. */
export function sandboxContext(thread: Thread): Room | undefined {
  if (!thread.sandbox) return undefined;
  const participants = threadParticipants(thread, []);
  return { id: thread.id, title: thread.title ?? participants.map(person => person.displayName).join(', '),
    participantIds: participants.map(person => person.id), createdAt: thread.createdAt };
}

/** Persistent OR thread-temporary individual. Migrates from legacy AgentConfig. */
export interface Participant {
  /** Immutable adoption identity; ordinary profile edits must preserve it. */
  adoption?: { sourceThreadId: string; baselineHash: string };
  id: string; // legacy agent_* ids preserved
  displayName: string;
  kind: 'persistent' | 'temporary';
  personaText: string; // rich persona (was roleplayLore); plain tutors have plain descriptions
  facets?: Record<string, number | string>; // open-ended behavioral facets, provenance-tagged (D17+)
  canon?: CanonAnchor; // RP participants only
  snapshotOf?: string; // rewind snapshots → persistent participant id (D16+)
  capabilities?: { witnessScope?: 'room' | 'all' }; // harness flags, not identity (D17+)
  voiceSampleId?: string;
  profilePhoto?: string;
  setupComplete: boolean;
}

export interface CanonAnchor {
  workTitle: string;
  fandomBaseUrl: string;
  characterPageTitle: string;
  mediaType?: string;
  coordinate: CanonCoordinate; // current canon position of THIS individual
  baseline: CanonBaseline; // researched state at coordinate
}

export interface CanonCoordinate {
  kind: 'chapter' | 'episode' | 'arc' | 'season' | 'volume' | 'point';
  value: string;
}

export interface SourceRef {
  pageTitle: string;
  section?: string;
  fetchedAt: number;
}

export interface CanonBaseline {
  lore: string;
  quotes: string[];
  context: string;
  notYetHappened: string[]; // negative knowledge at coordinate
  provenance: SourceRef[];
  generatedFill: string[]; // flagged segments (never presented as canon)
}

export type ParticipantRef =
  | { kind: 'existing'; participantId: string; /** Situation-private goals for a continuing person; global persona is untouched. */ goals?: string[] }
  | { kind: 'temporary'; localId: string; profile: RuntimeProfile };

/** For temp participants; NOT a persistent identity. */
export interface RuntimeProfile {
  name: string;
  personaText: string;
  facets?: Record<string, number | string>;
  goals: string[]; // private
  behaviorConstraints: string[]; // private
  initialKnowledge: ThreadScopedFact[]; // strict witnesses
  // NO speakerRole enum — eligibility derived from facets (D17+)
  capabilities?: { witnessScope?: 'room' | 'all' }; // harness flags, not identity
}

export interface ThreadScopedFact {
  text: string;
  witnesses: string[];
}

// ---------------------------------------------------------------------------
// Memory (rebuilt with perspective)
// ---------------------------------------------------------------------------

export interface MemoryEntry {
  id: string;
  ownerId: string;
  kind: 'belief' | 'episode' | 'open-loop' | 'relationship' | 'fact';
  text: string;
  witnesses: string[]; // REBUILT: legacy AgentMemoryEntry had no witnesses
  durability: 'durable'; // only durable reaches Sea memory
  salience: number; // derived → ProjectionStore, not journal
  createdAt: number;
  sourceEventIds: string[];
}

// ---------------------------------------------------------------------------
// Scenario Director (Phase 6 contract; defined here so all phases share it)
// ---------------------------------------------------------------------------

/** One authorized Director development, derived from real journal history.
 *  Never a fabricated occurrence: sourceEventIds cite the supporting events and
 *  kinds are situation-state interpretations, not new canonical occurrences.
 *  'reopen' transitions a concluded situation back to active. There is no
 *  'fact' kind: historical occurrences are only ever real journal events. */
export interface ScenarioDevelopment {
  id: string;
  /** Generated V08 Scenario prose is derived interpretation, never an occurrence. */
  authority: 'interpretation';
  text: string;
  kind: 'progress' | 'complication' | 'resolution' | 'reopen';
  witnesses: string[];
  sourceEventIds: string[];
  createdAt: number;
}

/** A later real event retracting an earlier development: the wrong premise
 *  leaves the current situation view; journal history is never rewritten. */
export interface ScenarioRetraction {
  id: string;
  developmentId: string;
  text: string;
  sourceEventIds: string[];
  createdAt: number;
}

/** One validated goal delta for a situation participant (private per-person
 *  state; applied on top of the participant's base goals, never overwriting
 *  them). Sources cite the events that justified the change. */
export interface ScenarioGoalChange {
  id: string;
  participantId: string;
  add: string[];
  remove: string[];
  sourceEventIds: string[];
  createdAt: number;
}

/** Evolution output for a scenario pass; typed, citation-carrying state
 *  mutations only. `concluded` closes the situation, `reopened` revives one. */
export interface ScenarioEvolutionProposal {
  developments: { authority: 'interpretation'; text: string; kind: ScenarioDevelopment['kind']; sourceEventIds: string[] }[];
  goalUpdates: { participantId: string; add: string[]; remove: string[]; sourceEventIds: string[] }[];
  retractions: { developmentId: string; text: string; sourceEventIds: string[] }[];
  concluded: { text: string; sourceEventIds: string[] } | null;
  reopened: { text: string; sourceEventIds: string[] } | null;
}

/** 'scenario_evolved' — journal history of one accepted Director evolution. */
export interface ScenarioEvolutionPayload {
  developments: { authority: 'interpretation'; text: string; kind: ScenarioDevelopment['kind']; sourceEventIds: string[] }[];
  goalUpdates: { participantId: string; add: string[]; remove: string[]; sourceEventIds: string[] }[];
  retractions: { developmentId: string; text: string; sourceEventIds: string[] }[];
  concluded: { text: string; sourceEventIds: string[] } | null;
  reopened: { text: string; sourceEventIds: string[] } | null;
  /** Retained for provenance of window sources (union with per-item citations). */
  sourceEventIds: string[];
}

export interface ScenarioSpec {
  scene: { sharedFacts: string[]; userObjectivePrivate: string; socialConstraints: string[] };
  participants: ParticipantRef[];
  relationships: { fromId: string; toId: string; label: string; directional: true }[];
  grounding?: ScenarioGrounding; // when canon-sourced (D15+)
  adaptations: string[]; // user-requested deltas, thread-scoped
  /** Derived situation state; each entry cites its supporting events. */
  developments?: ScenarioDevelopment[];
  /** Later real events retracting earlier developments (wrong premises leave
   *  the current view; history is preserved). */
  retractions?: ScenarioRetraction[];
  /** Validated goal deltas on top of each participant's base goals. */
  goalChanges?: ScenarioGoalChange[];
  /** A concluded situation is history; later turns treat it as shared past.
   *  Authoritative consumers recompute this from the valid resolution
   *  developments (a retracted conclusion reopens the situation). */
  status?: 'active' | 'concluded';
}

/** Durable reflection/evolution maintenance record (world.json ledger). Written
 * before the run's first physical write so an interrupted run reconciles after
 * restart. Replay-safe: the derived journal rows carry the operation id in
 * provenance, so a restart never re-derives (duplicates) the same window. */
export interface ReflectionRunRecord {
  reflectionId: string;
  kind: 'reflection' | 'scenario';
  /** Journal context id: a Room id, world continuity, or a sandbox Thread id. */
  contextId: string;
  scopeKind: 'sea' | 'thread';
  threadId?: string;
  windowStart: number;
  windowEnd: number;
  sourceEventIds: string[];
  sourceHash?: string;
  castHash?: string;
  /** Exact owner context used for ordinal mapping and interpretation; rechecked before publication/recovery. */
  personalContextHashes?: Record<string, string>;
  status: 'pending' | 'committed' | 'failed';
  /** Explicit user/operator authorization to retry a terminal invalid window. */
  retryRequestedAt?: number;
  retryConsumedAt?: number;
  retryOf?: string;
  error?: string;
  createdAt: number;
  /** Stable timestamp used by the idempotent salience projection publication. */
  projectionAt?: number;
  settledAt?: number;
  /** Prepared publication, cleared on commit. Reflection persists its validated
   *  derived drafts (all-or-nothing resume); scenario persists its before/after
   *  entity state plus the history event. Never sent to renderers. */
  prepared?:
    | { kind: 'reflection'; expectedDrafts: JournalEventDraft[] }
    | { kind: 'scenario'; scenarioBefore: ScenarioSpec; scenarioAfter: ScenarioSpec; event: JournalEventDraft; entityId: string };
}

export interface ScenarioGrounding {
  coordinate?: CanonCoordinate;
  presentCharacters: string[];
  setting: string;
  priorEvents: string[];
  conflicts: string[];
  perParticipant: Record<
    string,
    {
      knows: string[];
      doesNotKnow: string[]; // negative knowledge = anti-leak section
      relationships: { toName: string; label: string }[];
      motivations: string[];
      speechTraits: string[];
    }
  >;
  provenance: SourceRef[];
  fillSegments: string[]; // generated fill, flagged
}

// ---------------------------------------------------------------------------
// World IPC contract (Phase 2)
// ---------------------------------------------------------------------------

/** Full entity snapshot handed to the renderer over WORLD_GET_STATE. */
export interface WorldSnapshot {
  integrations?: Omit<IntegrationRecord, 'prepared'>[];
  reflectionRuns?: Omit<ReflectionRunRecord, 'prepared'>[];
  autonomyJobs?: Omit<AutonomyJobRecord, 'prepared'>[];
  rooms: Room[];
  threads: Thread[];
  participants: Participant[];
  scenarioCreations?: ScenarioCreation[];
}

/** Result of WORLD_APPLY_MEMBERSHIP — updated room plus the journaled membership event. */
export interface MembershipChangeResult {
  room: Room;
  event: JournalEvent | null; // null when the change was a no-op (already present/absent)
}

/** Payload broadcast on OPEN_ROOM_EVENT: open/focus the room window at this room. */
export interface OpenRoomEventPayload {
  roomId: string;
  threadId?: string;
  eventId?: string; // deep-link target — room window scrolls to/highlights this event
  callId?: string; // D20+ — present when the open is a voice-call accept
}

// ---------------------------------------------------------------------------
// Phase 3 — erasure, integration, remember-this (D: threads disposable)
// ---------------------------------------------------------------------------

/**
 * 'deletion' — erasure record. Source ids ONLY, never content: the erased
 * payloads are physically removed from the journal file; this event is the
 * provenance that the erasure happened (journal is logically append-only).
 */
export interface DeletionPayload {
  threadId?: string;
  sourceEventIds: string[];
  reason?: string;
}

/**
 * 'integration' — batch marker for one integrate-into-world run. Idempotency
 * key is integrationId; the marker carries ids and the selection hash only,
 * never transcript content. The marker completes journal preparation. Committed status and entity
 * publication in world.json are the durable logical commit.
 */
export interface IntegrationPayload {
  integrationId: string;
  sourceThreadId: string;
  /** Every source event the operation admitted (the selected consequences). */
  sourceEventIds: string[];
  /** Sandbox-only people adopted into the persistent world (stable ids). */
  promotedParticipantIds: string[];
  /** Persistent Room that received the selected consequences. */
  destinationRoomId: string;
  /** Hash of the normalized selection; a same-id retry with another selection conflicts. */
  selectionHash: string;
  scenarioAdopted: boolean;
}

/** Durable pending/committed operation record (world.json ledger). Written
 * before the operation's first physical write so a crash at any later point
 * is reconcilable after restart without relying on the renderer retrying. */
export interface IntegrationRecord {
  integrationId: string;
  sourceThreadId: string;
  destinationRoomId: string;
  memoryEventIds: string[];
  adoptParticipantIds: string[];
  includeScenario: boolean;
  selectionHash: string;
  status: 'pending' | 'committed' | 'interrupted';
  note?: string;
  createdAt: number;
  settledAt?: number;
  /** Private prepared publication; removed on commit, never sent to renderers. */
  prepared?: {
    participants: Participant[];
    roomBefore: Room;
    roomAfter: Room;
    events: JournalEventDraft[];
  };
}

/** WORLD_PREVIEW_INTEGRATION — main-owned preview of one integration selection. */
export interface PreviewIntegrationInput {
  threadId: string;
  destinationRoomId: string;
  /** Tentative selection; empty arrays request the reviewable catalog. */
  memoryEventIds: string[];
  adoptParticipantIds: string[];
  includeScenario: boolean;
}

/** One selectable thread consequence (a durable memory of any kind). */
export interface IntegrationPreviewItem {
  sourceEventId: string;
  ownerId: string;
  kind: MemoryEntry['kind'];
  text: string;
  witnesses: string[];
  /** kind 'relationship' only. */
  toId?: string;
  label?: string;
  /** Set when a prior operation already admitted this source event. */
  integratedBy?: string;
}

/** One sandbox person as the destination would see them. */
export interface IntegrationPreviewPerson {
  id: string;
  displayName: string;
  /** Present when the binding pins an existing persistent person. */
  originId?: string;
  /** 'reference' = already persistent; 'adopt' = sandbox-only, becomes persistent. */
  action: 'reference' | 'adopt';
  /** Required by the current selection (referenced or scenario cast). */
  required: boolean;
  /** The persistent person changed since the sandbox pinned its baseline. */
  baselineDrift?: boolean;
  /** The pinned origin person no longer exists in the persistent world. */
  missing?: boolean;
}

export interface IntegrationPreview {
  operations: Omit<IntegrationRecord, 'prepared'>[];
  threadId: string;
  threadTitle?: string;
  destinationRoomId: string;
  destinationRoomTitle: string;
  destinationHasScenario: boolean;
  items: IntegrationPreviewItem[];
  people: IntegrationPreviewPerson[];
  scenarioAvailable: boolean;
  /** Temporary people the current selection requires but the caller did not select. */
  requiredAdoptions: string[];
  /** Blocking problems with the tentative selection (empty = publishable). */
  problems: string[];
}

/** WORLD_REMEMBER_THIS — one-fact immediate Sea append referencing a thread event. */
export interface RememberThisInput {
  roomId: string;
  threadId: string;
  sourceEventId: string;
  ownerId: string;
  kind: MemoryEntry['kind'];
  text: string;
}

/** WORLD_INTEGRATE — selective, destination-aware, idempotent batch.
 * Content is derived main-side from the canonical source journal; the caller
 * only names the selection and the destination. */
export interface IntegrateThreadInput {
  integrationId: string;
  threadId: string;
  destinationRoomId: string;
  memoryEventIds: string[];
  adoptParticipantIds: string[];
  includeScenario: boolean;
}

export interface IntegrateThreadResult {
  appended: JournalEvent[];
  /** True when this integrationId was already fully applied (no-op resume). */
  alreadyApplied: boolean;
}
