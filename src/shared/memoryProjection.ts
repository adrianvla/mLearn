/**
 * Memory projection — pure derivation of current memory state from journaled
 * Sea events. No I/O, no clock, no randomness.
 *
 * Contract source: .sisyphus/plans/conversational-runtime-overhaul.md §4 + Phase 3.
 *
 * Memory events are journaled as 'memory.belief' with the kind carried in the
 * payload (MemoryEventPayload.kind). 'deletion' and 'integration' markers are
 * excluded from projections. Correction events tombstone the memory event they
 * target (payload.targetId) without deleting journal history; a correction only
 * tombstones when its owner matches the target memory's owner.
 *
 * projectionForCaller(events, callerId, cutoff?) filters the stream by the
 * caller's witness set plus membership-derived absence intervals (same
 * semantics as visibleEventsFor in contextCompiler.ts), with an optional
 * pre-join seq cutoff. Witnesses are always explicit (world.ts contract) —
 * empty witness sets are degenerate and visible to no one.
 */

import type { JournalEvent, LoopResolutionStatus, MemoryEntry } from './world';
import { visibleEventsFor } from './contextCompiler';

export interface RelationshipEntry {
  fromId: string;
  toId: string;
  text: string;
  sourceEventId: string;
  createdAt: number;
}

export interface RoomMemoryProjection {
  beliefs: MemoryEntry[];
  openLoops: MemoryEntry[];
  episodes: MemoryEntry[];
  relationships: RelationshipEntry[];
  roomCulture: MemoryEntry[];
}

const MEMORY_KINDS: readonly MemoryEntry['kind'][] = [
  'belief',
  'episode',
  'open-loop',
  'relationship',
  'fact',
];

function isMemoryKind(value: unknown): value is MemoryEntry['kind'] {
  return typeof value === 'string' && (MEMORY_KINDS as readonly string[]).includes(value);
}

function memoryOwner(e: JournalEvent): string | undefined {
  if (e.type === 'message.user' || e.type === 'message.character' || e.type === 'disclosure' || e.type === 'occurrence.simulated') return e.actorId;
  const payload = e.payload;
  if (typeof payload !== 'object' || payload === null) return undefined;
  const ownerId = (payload as Record<string, unknown>).ownerId;
  return typeof ownerId === 'string' ? ownerId : undefined;
}

/**
 * Correction events tombstone the memory event they target (payload.targetId)
 * without deleting journal history. Ownership guard: a correction only
 * tombstones when its owner matches the target memory's owner, so one
 * participant can never erase another's memory.
 */
export function tombstonedIds(events: JournalEvent[]): Set<string> {
  const ids = new Set<string>();
  for (const e of events) {
    if (e.type === 'deletion' || e.type === 'integration') continue;
    const payload = e.payload;
    if (typeof payload !== 'object' || payload === null) continue;
    const rec = payload as Record<string, unknown>;
    const targetId = typeof rec.targetId === 'string' ? rec.targetId : undefined;
    if (targetId === undefined) continue;
    const ownerId = typeof rec.ownerId === 'string' ? rec.ownerId : e.actorId;
    const source = events.find((s) => s.id === targetId);
    if (source === undefined) continue;
    if (memoryOwner(source) !== ownerId) continue;
    ids.add(targetId);
  }
  const invalidateSources = (): void => {
    let changed = true;
    while (changed) {
      changed = false;
      for (const event of events) {
        if (!event.provenance?.reflectionId || ids.has(event.id)) continue;
        const payload = event.payload as { sourceEventIds?: unknown; dependencyEventIds?: unknown } | null;
        const sources = [payload?.sourceEventIds, payload?.dependencyEventIds]
          .flatMap(value => Array.isArray(value) ? value : []);
        if (sources.some(id => typeof id === 'string' && ids.has(id))) {
          ids.add(event.id); changed = true;
        }
      }
    }
  };
  invalidateSources();
  // Reflection supersession: a still-valid derived belief with
  // payload.supersedesEventId replaces the owner's earlier derived belief.
  // Only derived rows participate (reflection provenance on both sides), so
  // user-authored memories can never supersede each other here.
  const derived = new Map(events.filter((e) => e.provenance?.reflectionId !== undefined).map((e) => [e.id, e]));
  for (const e of derived.values()) {
    if (ids.has(e.id) || e.type !== 'memory.belief') continue;
    const supersedes = (e.payload as { supersedesEventId?: unknown } | null)?.supersedesEventId;
    if (typeof supersedes !== 'string' || !derived.has(supersedes)) continue;
    if (memoryOwner(derived.get(supersedes)!) !== memoryOwner(e)) continue;
    ids.add(supersedes);
  }
  invalidateSources();
  return ids;
}

/** Current lifecycle of one journaled open loop. */
export interface LoopState {
  loop: MemoryEntry;
  status: 'open' | LoopResolutionStatus;
  /** Present when closed: the grounded resolution row that ended it. */
  resolution?: {
    eventId: string;
    ownerId: string;
    text: string;
    status: LoopResolutionStatus;
    sourceEventIds: string[];
    createdAt: number;
  };
}

const LOOP_RESOLUTION_STATUSES: readonly LoopResolutionStatus[] = ['satisfied', 'cancelled', 'contradicted', 'superseded'];

function isLoopResolutionStatus(value: unknown): value is LoopResolutionStatus {
  return typeof value === 'string' && (LOOP_RESOLUTION_STATUSES as readonly string[]).includes(value);
}

function resolutionFromEvent(e: JournalEvent): { ownerId: string; text: string; loopId?: string; status?: LoopResolutionStatus; sourceEventIds?: string[] } | null {
  const payload = e.payload;
  if (typeof payload !== 'object' || payload === null) return null;
  const rec = payload as Record<string, unknown>;
  if (typeof rec.ownerId !== 'string' || typeof rec.text !== 'string') return null;
  return {
    ownerId: rec.ownerId,
    text: rec.text,
    ...(typeof rec.loopId === 'string' ? { loopId: rec.loopId } : {}),
    ...(isLoopResolutionStatus(rec.status) ? { status: rec.status } : {}),
    ...(Array.isArray(rec.sourceEventIds) ? { sourceEventIds: rec.sourceEventIds.filter((x): x is string => typeof x === 'string') } : {}),
  };
}

/**
 * Derives each open loop's current state from the journaled stream: a loop row
 * (memory.belief, kind 'open-loop') stays open until a non-tombstoned
 * 'resolution' row owned by the same participant names its loopId. The latest
 * resolution by sequence wins; earlier resolutions remain history only.
 * Tombstoned loops (retracted or superseded) are omitted entirely.
 */
export function openLoopStates(events: JournalEvent[]): Map<string, LoopState> {
  const tombstoned = tombstonedIds(events);
  const states = new Map<string, LoopState>();
  for (const e of events) {
    if (e.type !== 'memory.belief' || tombstoned.has(e.id)) continue;
    const entry = memoryEntryFromEvent(e);
    if (entry?.kind !== 'open-loop') continue;
    states.set(e.id, { loop: entry, status: 'open' });
  }
  for (const e of events) {
    if (e.type !== 'resolution' || tombstoned.has(e.id)) continue;
    const resolution = resolutionFromEvent(e);
    if (!resolution?.loopId || !resolution.status) continue;
    const state = states.get(resolution.loopId);
    if (!state || state.loop.ownerId !== resolution.ownerId) continue;
    state.status = resolution.status;
    state.resolution = {
      eventId: e.id,
      ownerId: resolution.ownerId,
      text: resolution.text,
      status: resolution.status,
      sourceEventIds: resolution.sourceEventIds ?? [],
      createdAt: e.createdAt,
    };
  }
  return states;
}

function memoryEntryFromEvent(e: JournalEvent): MemoryEntry | null {
  const payload = e.payload;
  if (typeof payload !== 'object' || payload === null) return null;
  const rec = payload as Record<string, unknown>;
  if (typeof rec.ownerId !== 'string') return null;
  if (typeof rec.text !== 'string') return null;
  if (!isMemoryKind(rec.kind)) return null;
  return {
    id: e.id,
    ownerId: rec.ownerId,
    kind: rec.kind,
    text: rec.text,
    witnesses: e.witnesses,
    durability: 'durable',
    salience: 0, // derived → ProjectionStore, not journal
    createdAt: e.createdAt,
    sourceEventIds: Array.isArray(rec.sourceEventIds)
      ? rec.sourceEventIds.filter((x): x is string => typeof x === 'string')
      : [e.id],
  };
}

/**
 * Derives the current memory state of a Sea room from its journaled events.
 * Thread-scoped events are never input — the journal separates scopes by
 * construction. 'deletion' and 'integration' markers are excluded; tombstoned
 * memory events are excluded.
 */
export function deriveRoomProjection(events: JournalEvent[]): RoomMemoryProjection {
  const tombstoned = tombstonedIds(events);
  const loopStates = openLoopStates(events);
  const projection: RoomMemoryProjection = {
    beliefs: [],
    openLoops: [],
    episodes: [],
    relationships: [],
    roomCulture: [],
  };

  for (const e of events) {
    if (e.type === 'deletion' || e.type === 'integration') continue;
    if (e.type !== 'memory.belief') continue;
    if (tombstoned.has(e.id)) continue;
    const entry = memoryEntryFromEvent(e);
    if (!entry) continue;
    switch (entry.kind) {
      case 'belief':
        projection.beliefs.push(entry);
        break;
      case 'open-loop':
        // A loop with a grounded resolution keeps its history row but is no
        // longer unresolved: the projection exposes only currently-open loops.
        if (loopStates.get(e.id)?.status === 'open') projection.openLoops.push(entry);
        break;
      case 'episode':
        projection.episodes.push(entry);
        break;
      case 'relationship': {
        const rec = e.payload as Record<string, unknown>;
        projection.relationships.push({
          fromId: entry.ownerId,
          toId: typeof rec.toId === 'string' ? rec.toId : '',
          text: entry.text,
          sourceEventId: e.id,
          createdAt: e.createdAt,
        });
        break;
      }
      case 'fact':
        projection.roomCulture.push(entry);
        break;
    }
  }

  return projection;
}

/**
 * Projects the room's memory state as seen by one caller: events they
 * witnessed that are not inside any of their absence intervals (same semantics
 * as visibleEventsFor in contextCompiler.ts), optionally bounded by an explicit
 * joinedSeq cutoff.
 */
export function projectionForCaller(
  events: JournalEvent[],
  callerId: string,
  cutoff?: number,
): RoomMemoryProjection {
  const visible = visibleEventsFor(callerId, events);
  const bounded = cutoff === undefined ? visible : visible.filter((e) => Boolean(e.provenance?.integrationId) || e.seq >= cutoff);
  return deriveRoomProjection(bounded);
}
