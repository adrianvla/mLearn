import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Settings } from '../../shared/types';
import {
  createWatchTogetherRoom,
  isShareableWatchTogetherUrl,
  joinWatchTogetherRoom,
  leaveWatchTogetherRoom,
  subscribeToWatchTogetherRoom,
  type WatchTogetherRoomSession,
  type WatchTogetherRoomState,
} from './watchTogetherRoomService';

vi.mock('../../shared/backends', () => ({
  resolveCloudApiUrl: vi.fn(() => 'https://cloud.example.com'),
}));

class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances: MockWebSocket[] = [];

  public readonly url: string;
  public readonly protocols: string[];
  public readyState = MockWebSocket.CONNECTING;
  public close = vi.fn(() => {
    this.readyState = MockWebSocket.CLOSED;
  });

  private readonly listeners = new Map<string, Array<(event: unknown) => void>>();

  constructor(url: string, protocols?: string | string[]) {
    this.url = url;
    this.protocols = Array.isArray(protocols) ? protocols : protocols ? [protocols] : [];
    MockWebSocket.instances.push(this);
  }

  addEventListener(type: string, callback: (event: unknown) => void): void {
    const callbacks = this.listeners.get(type) ?? [];
    callbacks.push(callback);
    this.listeners.set(type, callbacks);
  }

  emit(type: string, event: unknown): void {
    for (const callback of this.listeners.get(type) ?? []) {
      callback(event);
    }
  }
}

const mockFetch = vi.fn<typeof fetch>();

function createSessionResponse(roomOverrides: Partial<WatchTogetherRoomState> = {}) {
  return {
    data: {
      role: 'owner' as const,
      canControl: true,
      room: {
        roomId: 'room-1',
        roomCode: 'ABC123',
        ownerUserId: 'user-1',
        mediaUrl: 'https://media.example.com/lesson.mp4',
        mediaTitle: 'Lesson',
        currentTime: 12,
        paused: false,
        playbackRate: 1,
        subtitlesHtml: '<span>Hello</span>',
        subtitleSize: 32,
        subtitleWeight: 700,
        stateVersion: 1,
        status: 'active' as const,
        lastUsedAt: '2026-04-01T12:00:00.000Z',
        createdAt: '2026-04-01T12:00:00.000Z',
        updatedAt: '2026-04-01T12:00:00.000Z',
        closedAt: null,
        ...roomOverrides,
      },
      socket: {
        url: 'wss://cloud.example.com/api/watch-together/rooms/room-1/socket',
        protocol: 'mlearn-watch-v1',
      },
    },
    actions: {
      refresh: {
        method: 'GET',
        url: 'https://cloud.example.com/api/watch-together/rooms/room-1',
      },
      connect_socket: {
        method: 'GET',
        url: 'wss://cloud.example.com/api/watch-together/rooms/room-1/socket',
      },
      update_state: {
        method: 'POST',
        url: 'https://cloud.example.com/api/watch-together/rooms/room-1/state',
      },
      close_room: {
        method: 'DELETE',
        url: 'https://cloud.example.com/api/watch-together/rooms/room-1',
      },
    },
  };
}

describe('watchTogetherRoomService', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    MockWebSocket.instances = [];
    vi.stubGlobal('fetch', mockFetch);
    vi.stubGlobal('WebSocket', MockWebSocket as unknown as typeof WebSocket);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('createWatchTogetherRoom posts to the configured worker URL', async () => {
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify(createSessionResponse()), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));

    const session = await createWatchTogetherRoom({} as Settings, 'token-123', {
      mediaUrl: 'https://media.example.com/lesson.mp4',
      mediaTitle: 'Lesson',
      currentTime: 12,
      paused: false,
      playbackRate: 1,
      subtitlesHtml: null,
      subtitleSize: null,
      subtitleWeight: null,
    });

    expect(session.socket.url).toBe('wss://cloud.example.com/api/watch-together/rooms/room-1/socket');
    expect(mockFetch).toHaveBeenCalledWith(
      'https://cloud.example.com/api/watch-together/rooms',
      expect.objectContaining({
        method: 'POST',
        headers: expect.any(Headers),
      }),
    );

    const [, init] = mockFetch.mock.calls[0];
    expect((init?.headers as Headers).get('Authorization')).toBe('Bearer token-123');
  });

  it('joinWatchTogetherRoom normalizes the room code before sending it to the worker', async () => {
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify(createSessionResponse()), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));

    await joinWatchTogetherRoom({} as Settings, 'token-456', 'ab-c 123');

    const [, init] = mockFetch.mock.calls[0];
    expect(init?.body).toBe(JSON.stringify({ roomCode: 'ABC123' }));
  });

  it('leaveWatchTogetherRoom posts to the viewer leave action when available', async () => {
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 204 }));

    await leaveWatchTogetherRoom({
      role: 'viewer',
      canControl: false,
      room: createSessionResponse().data.room,
      socket: createSessionResponse().data.socket,
      actions: {
        refresh: createSessionResponse().actions.refresh,
        connect_socket: createSessionResponse().actions.connect_socket,
        leave_room: {
          method: 'POST',
          url: 'https://cloud.example.com/api/watch-together/rooms/room-1/leave',
        },
      },
    }, 'token-viewer');

    expect(mockFetch).toHaveBeenCalledWith(
      'https://cloud.example.com/api/watch-together/rooms/room-1/leave',
      expect.objectContaining({
        method: 'POST',
        headers: expect.any(Headers),
      }),
    );
  });

  it('subscribeToWatchTogetherRoom connects through the worker websocket endpoint and forwards room-state messages', () => {
    const session = createSessionResponse().data as WatchTogetherRoomSession['actions'] extends never ? never : WatchTogetherRoomSession;
    const onRoom = vi.fn();

    const unsubscribe = subscribeToWatchTogetherRoom(session, 'worker-access-token', onRoom);
    const socket = MockWebSocket.instances[0];

    expect(socket.url).toBe('wss://cloud.example.com/api/watch-together/rooms/room-1/socket');
    expect(socket.protocols).toEqual(['mlearn-watch-v1', 'worker-access-token']);

    socket.emit('message', {
      data: JSON.stringify({
        type: 'room-state',
        room: {
          ...createSessionResponse({ currentTime: 45, stateVersion: 2 }).data.room,
        },
      }),
    });

    expect(onRoom).toHaveBeenCalledWith(expect.objectContaining({
      currentTime: 45,
      stateVersion: 2,
    }));

    socket.readyState = MockWebSocket.OPEN;
    unsubscribe();
    expect(socket.close).toHaveBeenCalled();
  });

  it('only treats http and https URLs as shareable room sources', () => {
    expect(isShareableWatchTogetherUrl('https://media.example.com/lesson.mp4')).toBe(true);
    expect(isShareableWatchTogetherUrl('http://media.example.com/lesson.mp4')).toBe(true);
    expect(isShareableWatchTogetherUrl('local-media://Users/adrian/movie.mp4')).toBe(false);
    expect(isShareableWatchTogetherUrl('')).toBe(false);
  });
});