/** Sea-only deferred consolidation. It is deliberately not wired to a scheduler here. */

import type { InferencePolicy } from '../../shared/inferencePolicy';
import { HARNESS_ACTOR } from '../../shared/world';
import type { ConsolidationPayload, JournalEvent, JournalEventDraft, MemoryEntry, MemoryEventPayload } from '../../shared/world';
import { appendEvent, queryEvents, readSeaProjection } from './journalService';
import { loadProjectionStore, saveProjectionStore } from './projectionStore';

export interface DreamerDependencies {
  policy: InferencePolicy;
  llmFn: (prompt: string) => Promise<string>;
  now?: number;
}

interface DreamerBelief {
  ownerId: string;
  kind: MemoryEntry['kind'];
  text: string;
  toId?: string;
  label?: string;
}

interface DreamerResolution {
  ownerId: string;
  text: string;
}

interface DreamerOutput {
  beliefs: DreamerBelief[];
  resolutions: DreamerResolution[];
}

interface ResolutionPayload {
  ownerId: string;
  text: string;
  sourceEventIds: string[];
}

const MEMORY_KINDS = new Set<MemoryEntry['kind']>(['belief', 'episode', 'open-loop', 'relationship', 'fact']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function parseDreamerOutput(raw: string): DreamerOutput | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.beliefs) || !Array.isArray(parsed.resolutions)) return null;

  const beliefs: DreamerBelief[] = [];
  for (const candidate of parsed.beliefs) {
    if (!isRecord(candidate) || !isNonEmptyString(candidate.ownerId) || !isNonEmptyString(candidate.text)) return null;
    if (typeof candidate.kind !== 'string' || !MEMORY_KINDS.has(candidate.kind as MemoryEntry['kind'])) return null;
    let toId: string | undefined;
    let label: string | undefined;
    if (candidate.toId !== undefined) {
      if (!isNonEmptyString(candidate.toId)) return null;
      toId = candidate.toId;
    }
    if (candidate.label !== undefined) {
      if (!isNonEmptyString(candidate.label)) return null;
      label = candidate.label;
    }
    if (candidate.kind === 'relationship' && (toId === undefined || label === undefined)) return null;
    if (candidate.kind !== 'relationship' && (toId !== undefined || label !== undefined)) return null;
    beliefs.push({
      ownerId: candidate.ownerId,
      kind: candidate.kind as MemoryEntry['kind'],
      text: candidate.text,
      ...(toId === undefined ? {} : { toId }),
      ...(label === undefined ? {} : { label }),
    });
  }

  const resolutions: DreamerResolution[] = [];
  for (const candidate of parsed.resolutions) {
    if (!isRecord(candidate) || !isNonEmptyString(candidate.ownerId) || !isNonEmptyString(candidate.text)) return null;
    resolutions.push({ ownerId: candidate.ownerId, text: candidate.text });
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

function isSeaEvent(event: JournalEvent): boolean {
  return event.scope.kind === 'sea';
}

function uniqueSeaEvents(events: JournalEvent[]): JournalEvent[] {
  return [...new Map(events.filter(isSeaEvent).map((event) => [event.id, event])).values()].sort(
    (left, right) => left.seq - right.seq
  );
}

function makePrompt(window: JournalEvent[]): string {
  return JSON.stringify({
    task: 'Consolidate these Sea events into durable beliefs and resolved open loops.',
    output: {
      beliefs: '[{ownerId, kind: belief|episode|open-loop|relationship|fact, text, toId?, label?}]',
      resolutions: '[{ownerId, text}]',
    },
    events: window,
  });
}

function memoryDraft(roomId: string, belief: DreamerBelief, sourceEventIds: string[]): JournalEventDraft {
  const payload: MemoryEventPayload = {
    ownerId: belief.ownerId,
    kind: belief.kind,
    text: belief.text,
    sourceEventIds,
    ...(belief.toId === undefined ? {} : { toId: belief.toId }),
    ...(belief.label === undefined ? {} : { label: belief.label }),
  };
  return {
    roomId,
    scope: { kind: 'sea' },
    type: 'memory.belief',
    actorId: HARNESS_ACTOR,
    witnesses: [belief.ownerId],
    payload,
  };
}

function resolutionDraft(roomId: string, resolution: DreamerResolution, sourceEventIds: string[]): JournalEventDraft {
  const payload: ResolutionPayload = { ...resolution, sourceEventIds };
  return {
    roomId,
    scope: { kind: 'sea' },
    type: 'resolution',
    actorId: HARNESS_ACTOR,
    witnesses: [resolution.ownerId],
    payload,
  };
}

async function updateProjections(roomId: string, touchedEventIds: Set<string>, now: number): Promise<void> {
  const store = await loadProjectionStore();
  const room = store[roomId] ?? {};
  for (const [eventId, entry] of Object.entries(room)) {
    room[eventId] = touchedEventIds.has(eventId)
      ? { salience: Math.min(1, entry.salience + 0.2), lastAccessed: now }
      : { ...entry, salience: entry.salience * 0.9 };
  }
  for (const eventId of touchedEventIds) {
    if (room[eventId] === undefined) room[eventId] = { salience: 1, lastAccessed: now };
  }
  store[roomId] = room;
  await saveProjectionStore(store);
}

export async function runDreamer(roomId: string, deps: DreamerDependencies): Promise<void> {
  if (!deps.policy.isPermitted('dreamer')) return;

  const [projection, queried] = await Promise.all([
    readSeaProjection(roomId),
    queryEvents(roomId, { limit: Number.MAX_SAFE_INTEGER }),
  ]);
  const seaEvents = uniqueSeaEvents([...projection, ...queried]);
  const markers: Array<{ event: JournalEvent; payload: ConsolidationPayload }> = [];
  for (const event of seaEvents) {
    if (event.type === 'consolidation' && isConsolidationPayload(event.payload)) {
      markers.push({ event, payload: event.payload });
    }
  }
  const lastWindowEnd = markers.reduce((latest, marker) => Math.max(latest, marker.payload.windowEnd), Number.NEGATIVE_INFINITY);
  const producedEventIds = new Set(markers.flatMap((marker) => marker.payload.producedEventIds));
  const window = seaEvents.filter(
    (event) => event.type !== 'consolidation' && !producedEventIds.has(event.id) && event.createdAt > lastWindowEnd
  );
  if (window.length === 0) return;

  const windowStart = window[0].createdAt;
  const windowEnd = window[window.length - 1].createdAt;
  if (markers.some((marker) => marker.payload.windowEnd >= windowEnd)) return;

  const output = parseDreamerOutput(await deps.llmFn(makePrompt(window)));
  if (output === null) return;

  const sourceEventIds = window.map((event) => event.id);
  const drafts = [
    ...output.beliefs.map((belief) => memoryDraft(roomId, belief, sourceEventIds)),
    ...output.resolutions.map((resolution) => resolutionDraft(roomId, resolution, sourceEventIds)),
  ];
  const produced = await Promise.all(drafts.map((draft) => appendEvent(roomId, draft)));
  const markerPayload: ConsolidationPayload = {
    windowStart,
    windowEnd,
    producedEventIds: produced.map((event) => event.id),
  };
  await appendEvent(roomId, {
    roomId,
    scope: { kind: 'sea' },
    type: 'consolidation',
    actorId: HARNESS_ACTOR,
    witnesses: [],
    payload: markerPayload,
  });

  const touched = new Set(
    [...window, ...produced]
      .filter((event) => event.type === 'memory.belief' || event.type === 'resolution')
      .map((event) => event.id)
  );
  await updateProjections(roomId, touched, deps.now ?? Date.now());
}
