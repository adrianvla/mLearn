/**
 * World IPC — main-process side of the world bridge (Phase 2).
 *
 * Handles WORLD_GET_STATE / WORLD_APPLY_MEMBERSHIP / WORLD_CREATE_SANDBOX /
 * WORLD_CREATE_PERSISTENT_ROOM and the OPEN_ROOM_EVENT broadcast (openRoomAt).
 * Entity persistence via worldStore ({userData}/world.json); membership/thread
 * journaling via journalService.
 *
 * Contract: .sisyphus/plans/conversational-runtime-overhaul.md §4.
 * Renderer access: setupWorldIPC() (registered in setupAllIPC) → preload → bridges.
 */

import { ipcMain } from 'electron';
import { createHash, randomUUID } from 'crypto';
import { isDeepStrictEqual } from 'util';
import { IPC_CHANNELS, WINDOW_TYPES } from '../../shared/constants';
import { applyMembershipChange } from '../../shared/roomOrchestrator';
import { HARNESS_ACTOR, threadContextId } from '../../shared/world';
import type {
  CreateCastInput,
  IntegrateThreadInput,
  IntegrateThreadResult,
  IntegrationPayload,
  JournalEvent,
  MembershipChangeResult,
  OpenRoomEventPayload,
  Participant,
  RememberThisInput,
  Room,
  Thread,
  WorldSnapshot,
} from '../../shared/world';
import { loadWorld, saveWorld, withWorldMutation } from './worldStore';
import { appendEvent, eraseThread, readSeaProjection, readThread } from './journalService';
import { openManagedChildWindow } from './windowManager';
import { loadSettings } from './settings';
import { consolidateRoom } from './dreamerRuntime';
import { prepareScenario, activateScenario, cancelScenario } from './scenarioDirector';

export async function getWorldState(): Promise<WorldSnapshot> {
  return withWorldMutation(loadWorld);
}

export async function createRoom(title: string): Promise<Room> {
  return withWorldMutation(async () => {
    const state = await loadWorld();
    const room: Room = {
      id: `room-${randomUUID()}`,
      title,
      participantIds: [],
      createdAt: Date.now(),
    };
    await saveWorld({ ...state, rooms: [...state.rooms, room] });
    return room;
  });
}

export async function applyMembership(
  roomId: string,
  participantId: string,
  kind: 'add' | 'remove',
): Promise<MembershipChangeResult> {
  return withWorldMutation(async () => {
    const state = await loadWorld();
    const room = state.rooms.find((r) => r.id === roomId);
    if (!room) {
      throw new Error(`[world] room not found: ${roomId}`);
    }
    const result = applyMembershipChange(room, participantId, kind);
    if (result.event === null) {
      return { room: result.room, event: null };
    }
    const updatedRoom = result.room;
    const event = await appendEvent(roomId, result.event);
    await saveWorld({ ...state, rooms: state.rooms.map((r) => (r.id === roomId ? updatedRoom : r)) });
    return { room: updatedRoom, event };
  });
}

/** Publish an independent cast and baseline in one atomic entity save. */
export async function createSandbox(input: CreateCastInput): Promise<Thread> {
  const request = structuredClone(input);
  return withWorldMutation(async () => {
    if (!request.operationId?.trim() || !request.participantIds.length) {
      throw new Error('[world] sandbox requires an operation ID and selected people');
    }
    const ids = [...new Set(request.participantIds)];
    const intent = request.intent?.trim() || undefined;
    const title = request.title?.trim() || undefined;
    const requestHash = createHash('sha256').update(JSON.stringify({ ids, intent, title })).digest('hex');
    const state = await loadWorld();
    const existing = state.threads.find(thread => thread.sandbox?.operationId === request.operationId);
    if (existing) {
      if (existing.sandbox?.requestHash !== requestHash) throw new Error('[world] sandbox creation conflict');
      return existing;
    }
    const bindings = ids.map(id => {
      const person = state.participants.find(candidate => candidate.id === id && candidate.kind === 'persistent');
      if (!person) throw new Error('[world] selected persistent person is unavailable');
      return { originId: id, baseline: structuredClone(person) };
    });
    const baselineHeads: Record<string, number> = {};
    for (const room of state.rooms) {
      const events = await readSeaProjection(room.id);
      baselineHeads[room.id] = events.at(-1)?.seq ?? 0;
    }
    const thread: Thread = {
      id: `thr_${randomUUID()}`, title, intent, state: 'active', createdAt: Date.now(),
      sandbox: { operationId: request.operationId, requestHash, bindings, baselineHeads },
    };
    await saveWorld({ ...state, threads: [...state.threads, thread] });
    return thread;
  });
}

/**
 * Deterministic persistent entry: one atomic entity save publishes the Room
 * with its permanent cast. Retry with the same operation ID returns the same
 * Room instead of duplicating topology; changed membership is a conflict.
 * Membership history events are appended after the entity save, so a crash
 * between them loses only cosmetic history, never the roster.
 */
export async function createPersistentRoom(input: CreateCastInput): Promise<Room> {
  const request = structuredClone(input);
  return withWorldMutation(async () => {
    if (!request.operationId?.trim() || !request.participantIds.length) {
      throw new Error('[world] persistent room requires an operation ID and selected people');
    }
    const ids = [...new Set(request.participantIds)];
    const state = await loadWorld();
    const existing = state.rooms.find(room => room.createdByOperation === request.operationId);
    if (existing) {
      const sortedIds = [...ids].sort();
      const sameRoster = existing.participantIds.length === sortedIds.length
        && [...existing.participantIds].sort().every((id, index) => id === sortedIds[index]);
      if (!sameRoster) throw new Error('[world] persistent room creation conflict');
      return existing;
    }
    const members = ids.map(id => {
      const person = state.participants.find(candidate => candidate.id === id && candidate.kind === 'persistent');
      if (!person) throw new Error('[world] selected persistent person is unavailable');
      return person;
    });
    const room: Room = {
      id: `room-${randomUUID()}`,
      title: request.title?.trim() || members.map(person => person.displayName).join(', '),
      participantIds: ids,
      createdByOperation: request.operationId,
      createdAt: Date.now(),
    };
    await saveWorld({ ...state, rooms: [...state.rooms, room] });
    // Draft events against the pre-membership roster: applyMembershipChange
    // no-ops for ids already present, so the final roster cannot be the input.
    let historyRoster: Room = { ...room, participantIds: [] };
    for (const id of ids) {
      const change = applyMembershipChange(historyRoster, id, 'add');
      historyRoster = change.room;
      if (change.event) await appendEvent(room.id, change.event);
    }
    return room;
  });
}

export async function updateThread(thread: Thread): Promise<Thread> {
  return withWorldMutation(async () => {
    const state = await loadWorld();
    const index = state.threads.findIndex((item) => item.id === thread.id);
    if (index === -1) {
      throw new Error(`[world] thread not found: ${thread.id}`);
    }
    const current = state.threads[index];
    if (!isDeepStrictEqual(current.sandbox, thread.sandbox) || current.roomId !== thread.roomId ||
        !isDeepStrictEqual(current.scenario, thread.scenario) || current.scenarioRef !== thread.scenarioRef) {
      throw new Error('[world] thread ownership and baseline cannot be replaced');
    }
    const threads = [...state.threads];
    threads[index] = thread;
    await saveWorld({ ...state, threads });
    return thread;
  });
}

/** Thread deletion is real erasure: the world record and the thread-scoped journal events both go. */
export async function deleteThread(roomId: string, threadId: string): Promise<void> {
  return withWorldMutation(async () => {
    const state = await loadWorld();
    const thread = state.threads.find(item => item.id === threadId);
    if (!thread || threadContextId(thread) !== roomId) throw new Error('[world] thread context mismatch');
    await saveWorld({ ...state, threads: state.threads.filter((item) => item.id !== threadId),
      ...(state.scenarioCreations ? { scenarioCreations: state.scenarioCreations.filter(item => item.threadId !== threadId) } : {}) });
    await eraseThread(roomId, threadId);
  });
}

export async function rememberThis(input: RememberThisInput): Promise<JournalEvent> {
  const source = (await readThread(input.roomId, input.threadId)).find(event => event.id === input.sourceEventId);
  if (!source || !source.witnesses.includes(input.ownerId)) {
    throw new Error('[world] memory must reference an event witnessed by its owner');
  }
  return appendEvent(input.roomId, {
    roomId: input.roomId,
    scope: { kind: 'sea' },
    type: 'memory.belief',
    actorId: HARNESS_ACTOR,
    witnesses: source.witnesses,
    payload: {
      ownerId: input.ownerId,
      kind: input.kind,
      text: input.text,
      sourceEventIds: [input.sourceEventId],
    },
    provenance: { sourceThreadEventIds: [input.sourceEventId] },
  });
}

export async function promoteParticipant(participantId: string): Promise<Participant> {
  return withWorldMutation(() => promoteParticipantUnlocked(participantId));
}

/** Caller holds the world mutation queue for the complete operation. */
async function promoteParticipantUnlocked(participantId: string): Promise<Participant> {
  const state = await loadWorld();
  const participant = state.participants.find((candidate) => candidate.id === participantId);
  if (!participant) throw new Error(`[world] participant not found: ${participantId}`);
  if (participant.kind === 'persistent') return participant;
  const updated: Participant = { ...participant, kind: 'persistent' };
  await saveWorld({
    ...state,
    participants: state.participants.map((candidate) => (candidate.id === participantId ? updated : candidate)),
  });
  return updated;
}

export async function integrateThread(input: IntegrateThreadInput): Promise<IntegrateThreadResult> {
  // Take a value snapshot before waiting; callers cannot change an admitted
  // selection while another world operation is in flight.
  const selection = structuredClone(input);
  return withWorldMutation(() => integrateThreadUnlocked(selection));
}

async function integrateThreadUnlocked(input: IntegrateThreadInput): Promise<IntegrateThreadResult> {
  if (!input.integrationId?.trim()) throw new Error('[world] integration requires an operation ID');
  const existing = (await readSeaProjection(input.roomId)).filter(
    (event) => event.provenance?.integrationId === input.integrationId
  );
  const admitted = existing.filter(event => event.type === 'memory.belief');
  for (const [index, event] of admitted.entries()) {
    const draft = input.drafts[index];
    if (!draft || event.actorId !== draft.actorId ||
        !isDeepStrictEqual(event.witnesses, draft.witnesses) || !isDeepStrictEqual(event.payload, draft.payload)) {
      throw new Error('[world] integration conflict: operation ID belongs to another selection');
    }
  }
  const marker = existing.find(event => event.type === 'integration');
  if (marker) {
    const payload = marker.payload as IntegrationPayload;
    if (payload.sourceThreadId !== input.threadId || admitted.length !== input.drafts.length ||
        !isDeepStrictEqual(payload.promotedParticipantIds, input.promoteParticipantIds)) {
      throw new Error('[world] integration conflict: operation ID belongs to another selection');
    }
    // A source sandbox may already have been discarded. An acknowledged
    // admission remains replayable without retaining its private source data.
    return { appended: existing, alreadyApplied: true };
  }
  const state = await loadWorld();
  const room = state.rooms.find(candidate => candidate.id === input.roomId);
  const thread = state.threads.find(candidate => candidate.id === input.threadId && candidate.roomId === input.roomId);
  if (!room || !thread) throw new Error('[world] integration thread does not belong to this room');
  for (const participantId of input.promoteParticipantIds) {
    if (!room.participantIds.includes(participantId) || !state.participants.some(person => person.id === participantId)) {
      throw new Error('[world] integration participant does not belong to the selected context');
    }
  }
  const sourceEvents = await readThread(input.roomId, input.threadId);
  const sourcesById = new Map(sourceEvents.map(event => [event.id, event]));
  // Validate the whole selection before the first write. Admission must not
  // widen the information audience supplied by the original source events.
  for (const draft of input.drafts) {
    const sourceIds = draft.payload.sourceEventIds;
    if (!sourceIds?.length) throw new Error('[world] integration requires explicit source event IDs');
    for (const sourceId of sourceIds) {
      const source = sourcesById.get(sourceId);
      if (!source) throw new Error('[world] integration source does not belong to this thread');
      if (!source.witnesses.includes(draft.payload.ownerId) ||
          !draft.witnesses.includes(draft.payload.ownerId) ||
          draft.witnesses.some(witness => !source.witnesses.includes(witness))) {
        throw new Error('[world] integration cannot grant knowledge to an unwitnessed owner or audience');
      }
    }
  }
  const appended = [...existing];
  for (const draft of input.drafts.slice(admitted.length)) {
    appended.push(
      await appendEvent(input.roomId, {
        roomId: input.roomId,
        scope: { kind: 'sea' },
        type: 'memory.belief',
        actorId: draft.actorId,
        witnesses: draft.witnesses,
        payload: draft.payload,
        provenance: { integrationId: input.integrationId, sourceThreadEventIds: draft.payload.sourceEventIds },
      })
    );
  }
  for (const participantId of input.promoteParticipantIds) await promoteParticipantUnlocked(participantId);

  const sourceEventIds = [...new Set(input.drafts.flatMap(draft => draft.payload.sourceEventIds ?? []))];
  const payload: IntegrationPayload = {
    integrationId: input.integrationId,
    sourceThreadId: input.threadId,
    sourceEventIds,
    promotedParticipantIds: input.promoteParticipantIds,
  };
  appended.push(
    await appendEvent(input.roomId, {
      roomId: input.roomId,
      scope: { kind: 'sea' },
      type: 'integration',
      actorId: HARNESS_ACTOR,
      witnesses: [],
      payload,
      provenance: { integrationId: input.integrationId, sourceThreadEventIds: sourceEventIds },
    })
  );
  return { appended, alreadyApplied: false };
}

/** Open/focus the Conversation AI window at this room/thread, then broadcast OPEN_ROOM_EVENT to all windows. */
export function openRoomAt(payload: OpenRoomEventPayload): void {
  openManagedChildWindow(WINDOW_TYPES.CONVERSATION_AGENT, {}, { ...payload });
  const { BrowserWindow } = require('electron');
  const windows = BrowserWindow.getAllWindows();
  for (const win of windows) {
    if (!win.isDestroyed()) {
      win.webContents.send(IPC_CHANNELS.OPEN_ROOM_EVENT, payload);
    }
  }
}

/**
 * Registers the world IPC handlers (renderer-facing side of the bridge chain).
 * Call once from setupAllIPC() in main.ts.
 */
export function setupWorldIPC(): void {
  ipcMain.handle(IPC_CHANNELS.WORLD_PREPARE_SCENARIO, async (event, input: CreateCastInput) => {
    const cancel = (): void => { void cancelScenario(input.operationId); };
    event.sender.once('destroyed', cancel);
    try { return await prepareScenario(input); }
    finally { if (!event.sender.isDestroyed()) event.sender.removeListener('destroyed', cancel); }
  });
  ipcMain.handle(IPC_CHANNELS.WORLD_ACTIVATE_SCENARIO, async (_event, id: string) => activateScenario(id));
  ipcMain.handle(IPC_CHANNELS.WORLD_CANCEL_SCENARIO, async (_event, id: string) => cancelScenario(id));
  ipcMain.handle(IPC_CHANNELS.WORLD_CREATE_SANDBOX, async (_event, input: CreateCastInput): Promise<Thread> => createSandbox(input));
  ipcMain.handle(IPC_CHANNELS.WORLD_GET_STATE, async (): Promise<WorldSnapshot> => getWorldState());

  ipcMain.handle(IPC_CHANNELS.WORLD_CREATE_ROOM, async (_event, title: string): Promise<Room> => createRoom(title));

  ipcMain.handle(
    IPC_CHANNELS.WORLD_APPLY_MEMBERSHIP,
    async (_event, roomId: string, participantId: string, kind: 'add' | 'remove'): Promise<MembershipChangeResult> =>
      applyMembership(roomId, participantId, kind)
  );

  ipcMain.handle(IPC_CHANNELS.WORLD_CREATE_PERSISTENT_ROOM, async (_event, input: CreateCastInput): Promise<Room> =>
    createPersistentRoom(input)
  );

  ipcMain.handle(
    IPC_CHANNELS.WORLD_UPDATE_THREAD,
    async (_event, thread: Thread): Promise<Thread> => updateThread(thread)
  );

  ipcMain.handle(IPC_CHANNELS.WORLD_DELETE_THREAD, async (_event, roomId: string, threadId: string): Promise<void> => {
    await deleteThread(roomId, threadId);
  });

  ipcMain.handle(IPC_CHANNELS.WORLD_REMEMBER_THIS, async (_event, input: RememberThisInput): Promise<JournalEvent> =>
    rememberThis(input)
  );

  ipcMain.handle(
    IPC_CHANNELS.WORLD_INTEGRATE,
    async (_event, input: IntegrateThreadInput): Promise<IntegrateThreadResult> => {
      const result = await integrateThread(input);
      // Post-session consolidation: fire-and-forget, policy-gated, marker-idempotent. No live
      // Thread 'archived' transition exists yet (only legacy migration); when one lands, fire there too.
      void consolidateRoom(input.roomId, { getSettings: loadSettings });
      return result;
    }
  );

  ipcMain.handle(IPC_CHANNELS.WORLD_PROMOTE_PARTICIPANT, async (_event, participantId: string): Promise<Participant> =>
    promoteParticipant(participantId)
  );

  ipcMain.handle(
    IPC_CHANNELS.WORLD_CREATE_PARTICIPANT,
    async (_event, input: {
      displayName: string;
      kind: 'persistent' | 'temporary';
      personaText: string;
      facets?: Record<string, number | string>;
      canon?: Participant['canon'];
      voiceSampleId?: string;
      profilePhoto?: string;
    }): Promise<Participant> => createParticipant(input)
  );

  ipcMain.handle(
    IPC_CHANNELS.WORLD_UPDATE_PARTICIPANT,
    async (_event, participant: Participant, threadId?: string): Promise<Participant> => updateParticipant(participant, threadId)
  );

  ipcMain.handle(IPC_CHANNELS.WORLD_DELETE_PARTICIPANT, async (_event, participantId: string): Promise<void> => {
    await deleteParticipant(participantId);
  });

  ipcMain.handle(IPC_CHANNELS.WORLD_CLEAR_UNREAD, async (_event, roomId: string): Promise<void> => {
    await clearRoomUnread(roomId);
  });
}

export async function createParticipant(input: {
  displayName: string;
  kind: 'persistent' | 'temporary';
  personaText: string;
  facets?: Record<string, number | string>;
  canon?: Participant['canon'];
  voiceSampleId?: string;
  profilePhoto?: string;
}): Promise<Participant> {
  return withWorldMutation(async () => {
    const world = await loadWorld();
    const participant: Participant = {
      id: `participant-${randomUUID()}`,
      displayName: input.displayName,
      kind: input.kind,
      personaText: input.personaText,
      facets: input.facets,
      canon: input.canon,
      voiceSampleId: input.voiceSampleId,
      profilePhoto: input.profilePhoto,
      setupComplete: true,
    };
    world.participants.push(participant);
    await saveWorld(world);
    return participant;
  });
}

export async function updateParticipant(participant: Participant, threadId?: string): Promise<Participant> {
  return withWorldMutation(async () => {
    const world = await loadWorld();
    if (threadId) {
      const thread = world.threads.find(item => item.id === threadId);
      const binding = thread?.sandbox?.bindings.find(item => item.baseline.id === participant.id);
      if (!binding) throw new Error('[world] person is not bound to the selected sandbox');
      binding.localOverride = { ...binding.baseline,
        displayName: participant.displayName, personaText: participant.personaText,
        profilePhoto: participant.profilePhoto, voiceSampleId: participant.voiceSampleId,
      };
      await saveWorld(world);
      return binding.localOverride;
    }
    const index = world.participants.findIndex((item) => item.id === participant.id);
    if (index === -1) throw new Error(`[world] participant not found: ${participant.id}`);
    world.participants[index] = participant;
    await saveWorld(world);
    return participant;
  });
}

export async function deleteParticipant(participantId: string): Promise<void> {
  return withWorldMutation(async () => {
    const world = await loadWorld();
    world.participants = world.participants.filter((item) => item.id !== participantId);
    for (const room of world.rooms) {
      room.participantIds = room.participantIds.filter((id) => id !== participantId);
    }
    await saveWorld(world);
  });
}

export async function clearRoomUnread(roomId: string): Promise<void> {
  return withWorldMutation(async () => {
    const world = await loadWorld();
    const room = world.rooms.find((item) => item.id === roomId);
    if (room === undefined) return;
    room.unreadCount = 0;
    await saveWorld(world);
  });
}
