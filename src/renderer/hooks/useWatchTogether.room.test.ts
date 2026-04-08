import { createRoot } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockWatchTogetherSend = vi.fn();
const mockIsWatchingTogether = vi.fn();
const mockUpdateWatchTogetherRoomState = vi.fn();

let launchCallback: (() => void) | null = null;
let requestCallback: ((raw: unknown) => void) | null = null;
let peerCallbacks: {
  onPeerConnected: (userId: string) => void;
  onPeerDisconnected: (userId: string) => void;
  onDataMessage: (fromUserId: string, message: unknown) => void;
  onBinaryChunk: (fromUserId: string, chunkType: number, chunkIndex: number, data: Uint8Array) => void;
  onSignalingError: (error: string) => void;
} | null = null;

vi.mock('../../shared/bridges', () => ({
  getBridge: () => ({
    watchTogether: {
      onWatchTogetherLaunch: vi.fn((cb: () => void) => {
        launchCallback = cb;
        return vi.fn();
      }),
      onWatchTogetherRequest: vi.fn((cb: (raw: unknown) => void) => {
        requestCallback = cb;
        return vi.fn();
      }),
      watchTogetherSend: (...args: unknown[]) => mockWatchTogetherSend(...args),
      isWatchingTogether: (...args: unknown[]) => mockIsWatchingTogether(...args),
    },
  }),
}));

vi.mock('../services/watchTogetherPeerService', () => ({
  createPeerService: vi.fn((_config, _localUserId, callbacks) => {
    peerCallbacks = callbacks;
    return {
      sendToAll: vi.fn(),
      sendBinaryToAll: vi.fn().mockResolvedValue(undefined),
      sendTo: vi.fn(),
      sendBinaryTo: vi.fn().mockResolvedValue(undefined),
      getConnectedPeerIds: vi.fn(() => []),
      destroy: vi.fn(),
    };
  }),
}));

vi.mock('../services/mediaDistributionService', () => ({
  createMediaDistribution: vi.fn(() => ({
    startDistribution: vi.fn(),
    cancelDistribution: vi.fn(),
    handleDataMessage: vi.fn(),
    handleBinaryChunk: vi.fn(),
    destroy: vi.fn(),
    isActive: vi.fn(() => false),
  })),
}));

vi.mock('../services/watchTogetherRoomService', () => ({
  closeWatchTogetherRoom: vi.fn().mockResolvedValue(undefined),
  leaveWatchTogetherRoom: vi.fn().mockResolvedValue(undefined),
  updateWatchTogetherRoomState: (...args: unknown[]) => mockUpdateWatchTogetherRoomState(...args),
}));

function createRoomSession(overrides?: Partial<Record<string, unknown>>) {
  return {
    role: 'owner',
    canControl: true,
    room: {
      roomId: 'room-1',
      roomCode: 'ROOM01',
      ownerUserId: 'owner-1',
      currentTime: 12,
      paused: false,
      playbackRate: 1,
      stateVersion: 1,
      status: 'active',
      lastUsedAt: '2026-04-01T12:00:00.000Z',
      createdAt: '2026-04-01T12:00:00.000Z',
      updatedAt: '2026-04-01T12:00:00.000Z',
      closedAt: null,
      ...(overrides?.room as Record<string, unknown> | undefined),
    },
    socket: {
      url: 'wss://cloud.example.com/api/watch-together/rooms/room-1/socket',
      protocol: 'mlearn-watch-v1',
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
      ...(overrides?.actions as Record<string, unknown> | undefined),
    },
    ...(overrides ?? {}),
  };
}

describe('useWatchTogether room mode', () => {
  beforeEach(() => {
    launchCallback = null;
    requestCallback = null;
    peerCallbacks = null;
    mockWatchTogetherSend.mockClear();
    mockIsWatchingTogether.mockClear();
    mockUpdateWatchTogetherRoomState.mockReset();
  });

  it('stores the incoming media URL even when the viewer has no video element yet', async () => {
    const { useWatchTogether } = await import('./useWatchTogether');

    createRoot((dispose) => {
      const hook = useWatchTogether({
        getVideo: () => null,
        getVideoSrc: () => '',
        getVideoTitle: () => '',
      });

      hook.activateRoomWithUserId(
        createRoomSession({ role: 'viewer', canControl: false }) as never,
        'viewer-token',
        'viewer-1',
      );

      peerCallbacks?.onDataMessage('owner-1', {
        type: 'sync-state',
        mediaUrl: 'https://media.example.com/lesson.mp4',
        mediaTitle: 'Lesson',
        currentTime: 24,
        paused: false,
        playbackRate: 1,
        subtitlesHtml: null,
        subtitleSize: null,
        subtitleWeight: null,
      });

      expect(hook.receivedMediaUrl()).toEqual({
        url: 'https://media.example.com/lesson.mp4',
        title: 'Lesson',
      });

      dispose();
    });
  });

  it('persists only playback state when the owner syncs room playback', async () => {
    const { useWatchTogether } = await import('./useWatchTogether');
    const roomSession = createRoomSession();
    const video = {
      currentTime: 42,
      paused: false,
      playbackRate: 1.25,
      play: vi.fn().mockResolvedValue(undefined),
      pause: vi.fn(),
    } as unknown as HTMLVideoElement;

    mockUpdateWatchTogetherRoomState.mockResolvedValue({
      ...roomSession,
      room: {
        ...roomSession.room,
        currentTime: 42,
        paused: false,
        playbackRate: 1.25,
        stateVersion: 2,
      },
    });

    await new Promise<void>((resolve) => {
      createRoot((dispose) => {
        const hook = useWatchTogether({
          getVideo: () => video,
          getVideoSrc: () => 'local-media:///Users/adrian/movie.mp4',
          getVideoTitle: () => 'Lesson',
        });

        hook.activateRoomWithUserId(roomSession as never, 'owner-token', 'owner-1');
        hook.sendPlay(42);

        queueMicrotask(() => {
          expect(mockUpdateWatchTogetherRoomState).toHaveBeenCalledWith(
            expect.objectContaining({ room: expect.objectContaining({ roomId: 'room-1' }) }),
            'owner-token',
            {
              currentTime: 42,
              paused: false,
              playbackRate: 1.25,
            },
          );

          dispose();
          resolve();
        });
      });
    });
  });
});