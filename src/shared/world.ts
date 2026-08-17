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
  | 'safety_flag';

/** Reserved actor ids. Anything else is a Participant id. */
export const USER_ACTOR = 'user';
export const HARNESS_ACTOR = 'harness';

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
  provenance?: { sourceThreadEventIds?: string[]; integrationId?: string };
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
  /** kind 'relationship' only: directional edge target + label (D5). */
  toId?: string;
  label?: string;
}

/** 'consolidation' — Dreamer window marker; idempotency key for consolidation runs. */
export interface ConsolidationPayload {
  windowStart: number; // createdAt of oldest Sea event in the consolidated window
  windowEnd: number; // createdAt of newest; a run covering <= existing windowEnd is a no-op
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
// Entities
// ---------------------------------------------------------------------------

export interface Room {
  id: string;
  title: string; // auto-named from participants; sticky once user-renamed
  titleUserSet?: boolean;
  participantIds: string[];
  cultureRef?: string; // room-culture document id (later phases)
  unreadCount?: number; // proactive delivery while room window closed (Q3)
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
  mediaRef?: ThreadMediaRef;
  state: 'active' | 'archived' | 'integrated';
  createdAt: number;
}

/** Persistent OR thread-temporary individual. Migrates from legacy AgentConfig. */
export interface Participant {
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
  | { kind: 'existing'; participantId: string }
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

export interface ScenarioSpec {
  scene: { sharedFacts: string[]; userObjectivePrivate: string; socialConstraints: string[] };
  participants: ParticipantRef[];
  relationships: { fromId: string; toId: string; label: string; directional: true }[];
  grounding?: ScenarioGrounding; // when canon-sourced (D15+)
  adaptations: string[]; // user-requested deltas, thread-scoped
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
  rooms: Room[];
  threads: Thread[];
  participants: Participant[];
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
 * key is integrationId; the marker carries ids only, never transcript content.
 */
export interface IntegrationPayload {
  integrationId: string;
  sourceThreadId: string;
  sourceEventIds: string[];
  promotedParticipantIds: string[];
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

/** One Sea memory event the integration wants appended (witnesses explicit). */
export interface IntegrationDraft {
  actorId: string;
  witnesses: string[];
  payload: MemoryEventPayload;
}

/** WORLD_INTEGRATE — deterministic idempotent batch; renderer supplies drafts. */
export interface IntegrateThreadInput {
  roomId: string;
  threadId: string;
  integrationId: string;
  drafts: IntegrationDraft[];
  promoteParticipantIds: string[];
}

export interface IntegrateThreadResult {
  appended: JournalEvent[];
  /** True when this integrationId was already fully applied (no-op resume). */
  alreadyApplied: boolean;
}
