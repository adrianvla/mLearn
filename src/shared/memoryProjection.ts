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

import type { JournalEvent, MemoryEntry } from './world';
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
  return ids;
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
        projection.openLoops.push(entry);
        break;
      case 'episode':
        projection.episodes.push(entry);
        break;
      case 'relationship': {
        const rec = e.payload as Record<string, unknown>;
        projection.relationships.push({
          fromId: typeof rec.fromId === 'string' ? rec.fromId : e.actorId,
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
  const bounded = cutoff === undefined ? visible : visible.filter((e) => e.seq >= cutoff);
  return deriveRoomProjection(bounded);
}