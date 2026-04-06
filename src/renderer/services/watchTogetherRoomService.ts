import { resolveCloudApiUrl } from '../../shared/backends';
import type { Settings } from '../../shared/types';

export interface WatchTogetherAction {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: unknown;
  description?: string;
}

export interface WatchTogetherSocketConfig {
  url: string;
  protocol: string;
}

export interface WatchTogetherRoomState {
  roomId: string;
  roomCode: string;
  ownerUserId: string;
  currentTime: number;
  paused: boolean;
  playbackRate: number;
  stateVersion: number;
  status: 'active' | 'closed';
  lastUsedAt: string;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
}

export interface WatchTogetherRoomSession {
  role: 'owner' | 'viewer';
  canControl: boolean;
  room: WatchTogetherRoomState;
  socket: WatchTogetherSocketConfig;
  actions: {
    refresh: WatchTogetherAction;
    connect_socket: WatchTogetherAction;
    update_state?: WatchTogetherAction;
    close_room?: WatchTogetherAction;
    leave_room?: WatchTogetherAction;
  };
}

export interface WatchTogetherRoomPlaybackPayload {
  currentTime: number;
  paused: boolean;
  playbackRate: number;
}

interface WatchTogetherRoomResponse {
  data: {
    role: 'owner' | 'viewer';
    canControl: boolean;
    room: WatchTogetherRoomState;
    socket: WatchTogetherSocketConfig;
  };
  actions: {
    refresh: WatchTogetherAction;
    connect_socket: WatchTogetherAction;
    update_state?: WatchTogetherAction;
    close_room?: WatchTogetherAction;
    leave_room?: WatchTogetherAction;
  };
}

interface WatchTogetherSocketMessage {
  type: 'room-state';
  room: WatchTogetherRoomState;
}

function resolveWatchTogetherApiUrl(settings: Settings): string {
  return resolveCloudApiUrl(settings).replace(/\/+$/, '');
}

function buildAuthHeaders(accessToken: string, extraHeaders?: HeadersInit): Headers {
  const headers = new Headers(extraHeaders);
  headers.set('Authorization', `Bearer ${accessToken}`);
  return headers;
}

async function fetchWatchTogether<T>(
  url: string,
  accessToken: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: buildAuthHeaders(accessToken, init.headers),
  });

  const payload = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) {
    throw new Error(payload.error || `Watch-together request failed: ${response.status}`);
  }

  return payload;
}

function toSession(response: WatchTogetherRoomResponse): WatchTogetherRoomSession {
  return {
    role: response.data.role,
    canControl: response.data.canControl,
    room: response.data.room,
    socket: response.data.socket,
    actions: response.actions,
  };
}

const ROOM_HOSTABLE_PROTOCOLS = new Set(['http:', 'https:', 'blob:', 'local-media:']);
const REMOTE_PLAYABLE_PROTOCOLS = new Set(['http:', 'https:']);

function matchesAllowedWatchTogetherProtocols(url: string, protocols: ReadonlySet<string>): boolean {
  if (!url) return false;

  try {
    const parsed = new URL(url);
    return protocols.has(parsed.protocol);
  } catch {
    return false;
  }
}

export function normalizeWatchTogetherRoomCode(roomCode: string): string {
  return roomCode.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

export function isShareableWatchTogetherUrl(url: string): boolean {
  return matchesAllowedWatchTogetherProtocols(url, ROOM_HOSTABLE_PROTOCOLS);
}

export function isRemoteWatchTogetherUrl(url: string): boolean {
  return matchesAllowedWatchTogetherProtocols(url, REMOTE_PLAYABLE_PROTOCOLS);
}

export async function createWatchTogetherRoom(
  settings: Settings,
  accessToken: string,
  payload: WatchTogetherRoomPlaybackPayload,
): Promise<WatchTogetherRoomSession> {
  const response = await fetchWatchTogether<WatchTogetherRoomResponse>(
    `${resolveWatchTogetherApiUrl(settings)}/api/watch-together/rooms`,
    accessToken,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    },
  );

  return toSession(response);
}

export async function joinWatchTogetherRoom(
  settings: Settings,
  accessToken: string,
  roomCode: string,
): Promise<WatchTogetherRoomSession> {
  const response = await fetchWatchTogether<WatchTogetherRoomResponse>(
    `${resolveWatchTogetherApiUrl(settings)}/api/watch-together/rooms/join`,
    accessToken,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ roomCode: normalizeWatchTogetherRoomCode(roomCode) }),
    },
  );

  return toSession(response);
}

export async function refreshWatchTogetherRoom(
  session: WatchTogetherRoomSession,
  accessToken: string,
): Promise<WatchTogetherRoomSession> {
  const response = await fetchWatchTogether<WatchTogetherRoomResponse>(
    session.actions.refresh.url,
    accessToken,
  );

  return toSession(response);
}

export async function updateWatchTogetherRoomState(
  session: WatchTogetherRoomSession,
  accessToken: string,
  payload: WatchTogetherRoomPlaybackPayload,
): Promise<WatchTogetherRoomSession> {
  if (!session.actions.update_state) {
    throw new Error('This watch-together session cannot update room state');
  }

  const response = await fetchWatchTogether<WatchTogetherRoomResponse>(
    session.actions.update_state.url,
    accessToken,
    {
      method: session.actions.update_state.method,
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    },
  );

  return toSession(response);
}

export async function closeWatchTogetherRoom(
  session: WatchTogetherRoomSession,
  accessToken: string,
): Promise<WatchTogetherRoomSession> {
  if (!session.actions.close_room) {
    throw new Error('This watch-together session cannot be closed');
  }

  const response = await fetchWatchTogether<WatchTogetherRoomResponse>(
    session.actions.close_room.url,
    accessToken,
    {
      method: session.actions.close_room.method,
    },
  );

  return toSession(response);
}

export async function leaveWatchTogetherRoom(
  session: WatchTogetherRoomSession,
  accessToken: string,
): Promise<void> {
  if (!session.actions.leave_room) {
    return;
  }

  await fetchWatchTogether<Record<string, never>>(
    session.actions.leave_room.url,
    accessToken,
    {
      method: session.actions.leave_room.method,
    },
  );
}

export function subscribeToWatchTogetherRoom(
  session: WatchTogetherRoomSession,
  accessToken: string,
  callback: (room: WatchTogetherRoomState) => void,
): () => void {
  const socket = new WebSocket(session.socket.url, [session.socket.protocol, accessToken]);

  socket.addEventListener('message', (event) => {
    try {
      const payload = JSON.parse(String(event.data)) as WatchTogetherSocketMessage;
      if (payload.type === 'room-state') {
        callback(payload.room);
      }
    } catch (error) {
      console.error('[WatchTogether] Failed to parse Worker socket message', error);
    }
  });

  socket.addEventListener('error', (error) => {
    console.error('[WatchTogether] Worker socket error', error);
  });

  socket.addEventListener('close', (event) => {
    if (event.wasClean) return;
    console.warn('[WatchTogether] Worker socket closed unexpectedly', event.code, event.reason);
  });

  return () => {
    if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
      socket.close();
    }
  };
}