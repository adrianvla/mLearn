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
  | 'call_ended';

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

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------

export interface Room {
  id: string;
  title: string; // auto-named from participants; sticky once user-renamed
  titleUserSet?: boolean;
  participantIds: string[];
  cultureRef?: string; // room-culture document id (later phases)
  createdAt: number;
}

export interface Thread {
  id: string;
  roomId?: string;
  title?: string;
  scenarioRef?: string;
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
