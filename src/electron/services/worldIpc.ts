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
import type { MembershipChangeResult, OpenRoomEventPayload, Thread, WorldSnapshot } from '../../shared/world';
import { loadWorld, saveWorld } from './worldStore';
import { appendEvent } from './journalService';
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
}