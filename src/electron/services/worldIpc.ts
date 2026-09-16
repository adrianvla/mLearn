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

import { WORLD_CONTINUITY_ID } from '../../shared/world';
import { requireLivingWorld } from '../../shared/livingWorld';
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
  IntegrationPreview,
  JournalEvent,
  MembershipChangeResult,
  OpenRoomEventPayload,
  Participant,
  PreviewIntegrationInput,
  RememberThisInput,
  Room,
  Thread,
  WorldSnapshot,
} from '../../shared/world';
import { loadWorld, saveWorld, withWorldMutation } from './worldStore';
import { appendEvent, eraseThread, readSeaProjection, readThread } from './journalService';
import { openManagedChildWindow } from './windowManager';
import { loadSettings } from './settings';
import { consolidateRoom, consolidateContext, cancelMaintenanceContext } from './dreamerRuntime';
import { settleMaintenanceRunUnlocked } from './dreamerService';
import { prepareScenario, activateScenario, cancelScenario } from './scenarioDirector';
import * as integration from './integration';

export async function getWorldState(): Promise<WorldSnapshot> {
  return withWorldMutation(async () => {
    const world = await loadWorld();
    return {
      ...world,
      integrations: world.integrations?.map(({ prepared: _prepared, ...record }) => record),
      reflectionRuns: world.reflectionRuns?.map(({ prepared: _prepared, ...record }) => record),
    };
  });
}

export async function createRoom(title: string): Promise<Room> {
  // A persistent Room is Living World topology, whatever entry created it.
  requireLivingWorld(loadSettings());
  return withWorldMutation(async () => {
    requireLivingWorld(loadSettings());
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
  // Adding a member extends a persistent Room; leaving stays allowed so a
  // Threads-only user can still shrink a pre-consent roster.
  if (kind === 'add') requireLivingWorld(loadSettings());
  return withWorldMutation(async () => {
    if (kind === 'add') requireLivingWorld(loadSettings());
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
    const baselineHeads: Record<string, number> = { [WORLD_CONTINUITY_ID]: (await readSeaProjection(WORLD_CONTINUITY_ID)).at(-1)?.seq ?? 0 };
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
  // Persistent topology is Living World state; Threads-only users cannot create it.
  requireLivingWorld(loadSettings());
  const request = structuredClone(input);
  return withWorldMutation(async () => {
    requireLivingWorld(loadSettings());
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
    // Cancel any in-flight maintenance for this context and settle its durable
    // records: the journal is being erased, so nothing may recreate or resume it.
    cancelMaintenanceContext(threadId);
    for (const run of (state.reflectionRuns ?? []).filter(item => item.contextId === threadId && item.status === 'pending')) {
      await settleMaintenanceRunUnlocked(run.reflectionId, 'failed', 'The sandbox was deleted; the run is not recoverable.');
    }
    // Reload after settlement: the settled ledger must not be overwritten by
    // the pre-settle snapshot below.
    const fresh = await loadWorld();
    await saveWorld({ ...fresh, threads: fresh.threads.filter((item) => item.id !== threadId),
      reflectionRuns: fresh.reflectionRuns?.filter(run => run.threadId !== threadId),
      ...(fresh.scenarioCreations ? { scenarioCreations: fresh.scenarioCreations.filter(item => item.threadId !== threadId) } : {}) });
    await eraseThread(roomId, threadId);
  });
}

export async function rememberThis(input: RememberThisInput): Promise<JournalEvent> {
  // A promoted Sea belief extends the persistent world; consent first.
  requireLivingWorld(loadSettings());
  const source = (await readThread(input.roomId, input.threadId)).find(event => event.id === input.sourceEventId);
  if (!source || !source.witnesses.includes(input.ownerId)) {
    throw new Error('[world] memory must reference an event witnessed by its owner');
  }
  requireLivingWorld(loadSettings());
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

export function integrateThread(input: IntegrateThreadInput): Promise<IntegrateThreadResult> {
  return integration.integrateThread(input);
}

/** Main-owned review surface: what a selection would admit, and what blocks it. */
export function previewIntegration(input: PreviewIntegrationInput): Promise<IntegrationPreview> {
  return integration.previewIntegration(input);
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
      // Post-session consolidation: fire-and-forget, policy-gated, marker-idempotent.
      // Also fired on replay so a crash between marker and consolidation heals.
      void consolidateRoom(input.destinationRoomId, { getSettings: loadSettings });
      return result;
    }
  );

  ipcMain.handle(IPC_CHANNELS.WORLD_PREVIEW_INTEGRATION, async (_event, input: PreviewIntegrationInput): Promise<IntegrationPreview> =>
    previewIntegration(input)
  );

  // Crash recovery: re-drive pending integration operations left by an
  // interrupted publication. Fire-and-forget; failures settle their record.
  // Maintenance (reflection/evolution) recovery runs in main.initialize()
  // AFTER legacy migration so it never races or duplicates startup recovery.
  void integration.reconcilePendingIntegrations();

  ipcMain.handle(
    IPC_CHANNELS.WORLD_TRIGGER_REFLECTION,
    async (_event, input: { roomId?: string; threadId?: string }): Promise<boolean> => {
      const roomId = typeof input?.roomId === 'string' ? input.roomId : undefined;
      const threadId = typeof input?.threadId === 'string' && input.threadId ? input.threadId : undefined;
      if (!roomId && !threadId) throw new Error('[world] reflection trigger requires a context');
      await consolidateContext(threadId ? { roomId: threadId, threadId } : { roomId: roomId! }, { getSettings: loadSettings });
      return true;
    }
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
  // A persistent person is durable persona state: Living World consent governs
  // it. Temporary people (sandbox casts) remain freely creatable.
  if (input.kind === 'persistent') requireLivingWorld(loadSettings());
  return withWorldMutation(async () => {
    if (input.kind === 'persistent') requireLivingWorld(loadSettings());
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
    if (participant.kind === 'persistent' && world.participants[index].kind !== 'persistent') requireLivingWorld(loadSettings());
    participant = { ...participant, adoption: world.participants[index].adoption };
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
