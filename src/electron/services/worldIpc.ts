/**
 * World IPC — main-process side of the world bridge (Phase 2).
 *
 * Handles WORLD_GET_STATE / WORLD_APPLY_MEMBERSHIP / WORLD_CREATE_THREAD and
 * the OPEN_ROOM_EVENT broadcast (openRoomAt). Entity persistence via worldStore
 * ({userData}/world.json); membership/thread journaling via journalService.
 *
 * Contract: .sisyphus/plans/conversational-runtime-overhaul.md §4.
 * Renderer access: setupWorldIPC() (registered in setupAllIPC) → preload → bridges.
 */

import { ipcMain } from 'electron';
import { IPC_CHANNELS, WINDOW_TYPES } from '../../shared/constants';
import { applyMembershipChange, makeThread } from '../../shared/roomOrchestrator';
import { HARNESS_ACTOR } from '../../shared/world';
import type {
  IntegrateThreadInput,
  IntegrateThreadResult,
  IntegrationPayload,
  JournalEvent,
  MembershipChangeResult,
  OpenRoomEventPayload,
  Participant,
  RememberThisInput,
  Thread,
  WorldSnapshot,
} from '../../shared/world';
import { loadWorld, saveWorld } from './worldStore';
import { appendEvent, readSeaProjection, readThread } from './journalService';
import { openManagedChildWindow } from './windowManager';

export async function getWorldState(): Promise<WorldSnapshot> {
  return loadWorld();
}

export async function applyMembership(
  roomId: string,
  participantId: string,
  kind: 'add' | 'remove',
): Promise<MembershipChangeResult> {
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
  // Witnesses = roster AFTER the change (contract: absence intervals derive from membership events).
  const event = await appendEvent(roomId, { ...result.event, witnesses: updatedRoom.participantIds });
  await saveWorld({ ...state, rooms: state.rooms.map((r) => (r.id === roomId ? updatedRoom : r)) });
  return { room: updatedRoom, event };
}

export async function createThread(roomId: string, title?: string): Promise<Thread> {
  const state = await loadWorld();
  const room = state.rooms.find((r) => r.id === roomId);
  if (!room) {
    throw new Error(`[world] room not found: ${roomId}`);
  }
  const thread = makeThread(
    roomId,
    `thr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`,
    Date.now(),
    title
  );
  await saveWorld({ ...state, threads: [...state.threads, thread] });
  return thread;
}

export async function rememberThis(input: RememberThisInput): Promise<JournalEvent> {
  return appendEvent(input.roomId, {
    roomId: input.roomId,
    scope: { kind: 'sea' },
    type: 'memory.belief',
    actorId: HARNESS_ACTOR,
    witnesses: [],
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
  const existing = (await readSeaProjection(input.roomId)).filter(
    (event) => event.provenance?.integrationId === input.integrationId
  );
  if (existing.some((event) => event.type === 'integration')) {
    return { appended: existing, alreadyApplied: true };
  }

  const appended = [...existing];
  for (const draft of input.drafts.slice(existing.length)) {
    appended.push(
      await appendEvent(input.roomId, {
        roomId: input.roomId,
        scope: { kind: 'sea' },
        type: 'memory.belief',
        actorId: draft.actorId,
        witnesses: draft.witnesses,
        payload: draft.payload,
        provenance: { integrationId: input.integrationId },
      })
    );
  }
  for (const participantId of input.promoteParticipantIds) await promoteParticipant(participantId);

  const sourceEventIds = (await readThread(input.roomId, input.threadId)).map((event) => event.id);
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

/** Open/focus the ROOM window at this room, then broadcast OPEN_ROOM_EVENT to all windows. */
export function openRoomAt(payload: OpenRoomEventPayload): void {
  openManagedChildWindow(WINDOW_TYPES.ROOM, {}, { ...payload });
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
  ipcMain.handle(IPC_CHANNELS.WORLD_GET_STATE, async (): Promise<WorldSnapshot> => getWorldState());

  ipcMain.handle(
    IPC_CHANNELS.WORLD_APPLY_MEMBERSHIP,
    async (_event, roomId: string, participantId: string, kind: 'add' | 'remove'): Promise<MembershipChangeResult> =>
      applyMembership(roomId, participantId, kind)
  );

  ipcMain.handle(
    IPC_CHANNELS.WORLD_CREATE_THREAD,
    async (_event, roomId: string, title?: string): Promise<Thread> => createThread(roomId, title)
  );

  ipcMain.handle(IPC_CHANNELS.WORLD_REMEMBER_THIS, async (_event, input: RememberThisInput): Promise<JournalEvent> =>
    rememberThis(input)
  );

  ipcMain.handle(
    IPC_CHANNELS.WORLD_INTEGRATE,
    async (_event, input: IntegrateThreadInput): Promise<IntegrateThreadResult> => integrateThread(input)
  );

  ipcMain.handle(IPC_CHANNELS.WORLD_PROMOTE_PARTICIPANT, async (_event, participantId: string): Promise<Participant> =>
    promoteParticipant(participantId)
  );
}
