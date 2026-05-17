import type {
  WatchTogetherRoomStateExt,
  WatchTogetherRoomSessionExt,
  WatchTogetherPlaybackPayloadExt,
} from '../types';

interface WatchTogetherRoomResponse {
  data: {
    role: 'owner' | 'viewer';
    canControl: boolean;
    room: WatchTogetherRoomStateExt;
    socket: {
      url: string;
      protocol: string;
    };
  };
  actions: {
    refresh: { method: string; url: string };
    connect_socket: { method: string; url: string };
    update_state?: { method: string; url: string };
    close_room?: { method: string; url: string };
    leave_room?: { method: string; url: string };
  };
}

interface WatchTogetherSocketMessage {
  type: 'room-state';
  room: WatchTogetherRoomStateExt;
}

interface WatchTogetherPeerJoinedMessage {
  type: 'peer-joined';
  room: WatchTogetherRoomStateExt;
  peerId: string;
}

interface WatchTogetherPeerLeftMessage {
  type: 'peer-left';
  room: WatchTogetherRoomStateExt;
  peerId: string;
}

const ROOM_HOSTABLE_PROTOCOLS = new Set(['http:', 'https:', 'blob:', 'local-media:']);

const PING_INTERVAL_MS = 30000;

function matchesAllowedWatchTogetherProtocols(url: string, protocols: ReadonlySet<string>): boolean {
  if (!url) return false;

  try {
    const parsed = new URL(url);
    return protocols.has(parsed.protocol);
  } catch {
    return false;
  }
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

function toSession(response: WatchTogetherRoomResponse): WatchTogetherRoomSessionExt {
  return {
    role: response.data.role,
    canControl: response.data.canControl,
    room: response.data.room,
    socket: response.data.socket,
    actions: response.actions,
  };
}

export function normalizeWatchTogetherRoomCode(roomCode: string): string {
  return roomCode.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

export function isShareableWatchTogetherUrl(url: string): boolean {
  return matchesAllowedWatchTogetherProtocols(url, ROOM_HOSTABLE_PROTOCOLS);
}

export async function createWatchTogetherRoom(
  apiUrl: string,
  accessToken: string,
  payload: WatchTogetherPlaybackPayloadExt,
): Promise<WatchTogetherRoomSessionExt> {
  const normalizedUrl = apiUrl.replace(/\/+$/, '');
  const response = await fetchWatchTogether<WatchTogetherRoomResponse>(
    `${normalizedUrl}/api/watch-together/rooms`,
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
  apiUrl: string,
  accessToken: string,
  roomCode: string,
): Promise<WatchTogetherRoomSessionExt> {
  const normalizedUrl = apiUrl.replace(/\/+$/, '');
  const response = await fetchWatchTogether<WatchTogetherRoomResponse>(
    `${normalizedUrl}/api/watch-together/rooms/join`,
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

export async function updateWatchTogetherRoomState(
  session: WatchTogetherRoomSessionExt,
  accessToken: string,
  payload: WatchTogetherPlaybackPayloadExt,
): Promise<WatchTogetherRoomSessionExt> {
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
  session: WatchTogetherRoomSessionExt,
  accessToken: string,
): Promise<WatchTogetherRoomSessionExt> {
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
  session: WatchTogetherRoomSessionExt,
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
  session: WatchTogetherRoomSessionExt,
  accessToken: string,
  onRoomState: (room: WatchTogetherRoomStateExt & { timestamp?: string }) => void,
  onPeerEvent?: (event: { type: 'joined' | 'left'; peerId: string; room: WatchTogetherRoomStateExt }) => void,
): () => void {
  const socket = new WebSocket(session.socket.url, [session.socket.protocol, accessToken]);
  let pingInterval: number | null = null;

  socket.addEventListener('open', () => {
    pingInterval = window.setInterval(() => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send('ping');
      }
    }, PING_INTERVAL_MS);
  });

  socket.addEventListener('message', (event) => {
    try {
      const payload = JSON.parse(String(event.data)) as
        | WatchTogetherSocketMessage
        | WatchTogetherPeerJoinedMessage
        | WatchTogetherPeerLeftMessage;
      if (payload.type === 'room-state') {
        onRoomState(payload.room);
      } else if (payload.type === 'peer-joined') {
        onRoomState(payload.room);
        onPeerEvent?.({ type: 'joined', peerId: payload.peerId, room: payload.room });
      } else if (payload.type === 'peer-left') {
        onRoomState(payload.room);
        onPeerEvent?.({ type: 'left', peerId: payload.peerId, room: payload.room });
      }
    } catch (error) {
      console.error('[WatchTogether] Failed to parse socket message', error);
    }
  });

  socket.addEventListener('error', (error) => {
    console.error('[WatchTogether] Socket error', error);
  });

  socket.addEventListener('close', (event) => {
    if (pingInterval !== null) {
      window.clearInterval(pingInterval);
      pingInterval = null;
    }
    if (event.wasClean) return;
    console.warn('[WatchTogether] Socket closed unexpectedly', event.code, event.reason);
  });

  return () => {
    if (pingInterval !== null) {
      window.clearInterval(pingInterval);
      pingInterval = null;
    }
    if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
      socket.close();
    }
  };
}
